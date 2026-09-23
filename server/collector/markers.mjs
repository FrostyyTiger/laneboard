// Markers — the lines a lane prints when it wants something from a human.
//
// Three sources, in descending reliability:
//   (a) hooks    — every Stop hook's last_assistant_message and every
//                  Notification payload, scanned line by line;
//   (b) pane     — the 40-line preview already captured for the card, so this
//                  costs no new tmux call;
//   (c) watchlog — the lane's watcher log, tail 200 lines, at 60 s.
//
// A marker is stored once. The same line sits in a pane for hours and is
// re-read on every tick, so the unique key (lane, session, text) is what stops
// it multiplying — and an in-memory set of those keys keeps the common case
// (nothing new) from touching SQLite at all.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { stripAnsi, truncate } from '../util.mjs';
import * as db from '../db.mjs';

/** Compile config.markerPatterns once. */
export function compilePatterns(patterns = config.markerPatterns) {
  return patterns.map((p) => ({
    kind: p.kind,
    // Anchored patterns are case-sensitive: NEED-HUMAN is a token a lane
    // types deliberately, and "need" in prose is not a marker.
    re: p.anchored
      ? new RegExp(`^(?:${p.source}):`)
      : new RegExp(`(?:${p.source})`, 'i'),
    anchored: p.anchored,
  }));
}

let compiled = compilePatterns();

/**
 * Strip what a terminal puts in front of a line before its content: ANSI, a
 * Claude bullet, a quote marker, whitespace. Everything after this must be the
 * marker itself for an anchored pattern to fire — which is exactly why a lane's
 * prompt, where the markers appear inside backticks, does not match.
 */
export function stripLinePrefix(line) {
  return stripAnsi(String(line ?? '')).replace(/^[\s>●•*│|]+/, '').trimEnd();
}

/** `2026-09-04 21:18:43 MARKER ● PROGRESS: …` -> `● PROGRESS: …` */
export function stripWatchLogPrefix(line) {
  return String(line ?? '').replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+(?:MARKER\s+)?/, '');
}

/**
 * A captured pane row is a SCREEN row, and Claude Code renders columns. So one
 * row routinely holds a marker on the left and something unrelated on the
 * right, separated by a run of spaces:
 *
 *   NEED-HUMAN: pdftotext isn't installed …      13 +   * Panels, not tiles.
 *
 * Measured on this box, that caused two distinct faults:
 *   - ten near-identical rows for ONE marker, because the right-hand column
 *     changed between captures and the dedupe key is the text;
 *   - a `limit` marker for a line of this repository's own source, because the
 *     unanchored rate-limit phrases matched the pattern list being displayed.
 *
 * A marker is a sentence, and three consecutive spaces inside a sentence is
 * essentially never meaningful, while column separation always produces them.
 * So the text ends at the first run of three.
 */
export function cleanMarkerText(text) {
  // Trim FIRST: leading indentation is not a column gap, and splitting on it
  // would leave an empty first field and throw the marker away.
  return String(text).trim().split(/\s{3,}/)[0].replace(/\s+/g, ' ').trim();
}

/**
 * Does this line look like source code rather than something a lane said?
 *
 * Only consulted for the UNANCHORED patterns. The anchored ones are already
 * safe — a marker token has to start the line — but "rate limit" appearing
 * anywhere would otherwise fire on any file that mentions it, including this
 * one.
 */
export function looksLikeCode(text) {
  return /[;{}]|=>|\b(?:import|const|function|return|export)\b|^\s*\d+\s*[+-]/.test(text);
}

/** The marker on this line, or null. */
export function classifyLine(line, patterns = compiled) {
  const text = cleanMarkerText(stripLinePrefix(line));
  if (!text) return null;
  for (const p of patterns) {
    if (!p.re.test(text)) continue;
    if (!p.anchored && looksLikeCode(text)) continue;
    return { kind: p.kind, text: truncate(text, 300) };
  }
  return null;
}

/** Every marker in a block of text. */
export function scanText(text, patterns = compiled) {
  const out = [];
  if (!text) return out;
  for (const line of String(text).split('\n')) {
    const hit = classifyLine(line, patterns);
    if (hit) out.push(hit);
  }
  return out;
}

// --- storage ----------------------------------------------------------------

/** lane\0session\0text for everything already stored. Bounded by retention. */
let seen = new Set();
let loaded = false;

function ensureLoaded() {
  if (loaded) return;
  try { seen = new Set(db.markerKeys()); } catch (err) { log.error('marker keys failed', String(err)); }
  loaded = true;
}

export function keyOf(lane, sessionName, text) {
  // NUL-separated, matching db.markerKeys(): a space separator would let lane
  // "a" + session "b c" collide with lane "a b" + session "c".
  return `${lane ?? ''}\u0000${sessionName ?? ''}\u0000${text}`;
}

/**
 * Store a marker if it is new. Returns the row id when it was, else null —
 * which is what the push path uses to notify exactly once.
 */
export function record({ lane = null, sessionName = null, kind, text, source, ts = Date.now() }) {
  ensureLoaded();
  const key = keyOf(lane, sessionName, text);
  if (seen.has(key)) return null;
  seen.add(key);
  const id = db.addMarker({ ts, lane, sessionName, kind, text, source });
  // A null id means another path won the race and the row already existed;
  // the key is in `seen` either way, so it will not be tried again.
  return id;
}

/** Scan one source and record everything new. Returns the new markers. */
export function ingest({ lane, sessionName, source, text, ts = Date.now() }) {
  const fresh = [];
  for (const hit of scanText(text)) {
    const id = record({ lane, sessionName, kind: hit.kind, text: hit.text, source, ts });
    if (id) fresh.push({ id, lane, sessionName, kind: hit.kind, text: hit.text, source, ts });
  }
  return fresh;
}

// --- watch logs -------------------------------------------------------------

/**
 * Where a lane's watcher writes. `~/lanes/<id>/watch.log` is the layout now;
 * the lanes that were already running when it changed still have theirs as
 * `~/<id>-watch.log`, so both are tried (v2 plan §0).
 */
export function watchLogPaths(laneId) {
  if (!laneId) return [];
  return [
    path.join(config.home, 'lanes', laneId, 'watch.log'),
    path.join(config.home, `${laneId}-watch.log`),
  ];
}

const TAIL_LINES = 200;
const TAIL_BYTES = 64 * 1024;

/** Last N lines of a file, read from the end — these logs grow all night. */
export async function tailFile(file, lines = TAIL_LINES) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    // A partial first line when the file is longer than the window.
    const all = text.split('\n');
    if (start > 0) all.shift();
    return all.slice(-lines);
  } catch {
    return [];
  } finally {
    await fh?.close().catch(() => {});
  }
}

/** Read a lane's watch log and record what it shouts. Sequential by caller. */
export async function scanWatchLog(laneId, sessionName) {
  const fresh = [];
  for (const file of watchLogPaths(laneId)) {
    if (!fs.existsSync(file)) continue;
    const lines = await tailFile(file);
    for (const raw of lines) {
      const hit = classifyLine(stripWatchLogPrefix(raw));
      if (!hit) continue;
      const id = record({ lane: laneId, sessionName, kind: hit.kind, text: hit.text, source: 'watchlog' });
      if (id) fresh.push({ id, lane: laneId, sessionName, kind: hit.kind, text: hit.text, source: 'watchlog' });
    }
    // The first path that exists wins; the two are the same log under two
    // names, and reading both would double-count nothing but waste the read.
    break;
  }
  return fresh;
}

/** Reset for tests. */
export function _reset() {
  seen = new Set();
  loaded = false;
  compiled = compilePatterns();
}

export function health() {
  ensureLoaded();
  return { keys: seen.size };
}
