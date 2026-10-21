// Run files (docs/plans/runs/README.md §3 A1, T4; the protocol is docs/runs.md).
//
// Finds the run.jsonl files laneboard is told to read, tails each one and
// feeds the lines to the store (server/runs/store.mjs):
//
//   - `runs.files` globs (already `~`-expanded by server/config/runs.mjs),
//     walked from each glob's literal directory prefix;
//   - `<lane root>/.laneboard/run.jsonl` for every lane, when `runs.lanes`;
//   - `<stateDir>/runs/*.jsonl`, where `POST /api/runs/events` appends.
//
// Tailing is by byte offset: only what was appended since the last read is
// read, a half-written last line waits for its newline, and a file that
// shrank or was replaced (another inode) is dropped from the store and read
// again from the start; so is a file that left discovery (or was deleted)
// and came back, its old events dropped first. Reads are bounded per tick
// so a huge file catches up over several ticks instead of blocking one.
//
// With no config (`files: []`) and no lane holding a .laneboard/run.jsonl
// nothing is read and the store stays empty.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { globPrefix, matchGlob } from '../packages/glob.mjs';
import { parseLine, MAX_LINE } from '../runs/protocol.mjs';
import { createStore } from '../runs/store.mjs';
import { log } from '../log.mjs';

export const LANE_FILE = path.join('.laneboard', 'run.jsonl');
export const TICK_MS = 2000;
export const DISCOVER_MS = 30_000;
export const READ_MAX = 4 * 1024 * 1024;   // bytes read from one file per tick
export const WALK_MAX = 5000;              // directory entries looked at per glob
export const WALK_DEPTH = 12;
export const FILES_MAX = 256;              // files tailed at once
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const NL = 0x0a;

/** Absolute paths matching one absolute glob, walked from its literal prefix. */
export async function expandGlob(glob, { fsImpl = fsp } = {}) {
  const prefix = `/${globPrefix(glob)}`;
  const target = glob.replace(/^\/+/, '');
  const out = [];
  let seen = 0;
  async function walk(dir, depth) {
    if (depth > WALK_DEPTH || seen >= WALK_MAX) return;
    let entries;
    try { entries = await fsImpl.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of entries) {
      if (++seen > WALK_MAX) return;
      const p = path.join(dir, d.name);
      if (d.isFile() || d.isSymbolicLink()) {
        if (matchGlob(target, p.slice(1))) out.push(p);
      } else if (d.isDirectory() && !SKIP_DIRS.has(d.name)) {
        await walk(p, depth + 1);
      }
    }
  }
  // A glob without wildcards names one file.
  if (prefix === `/${target}`) {
    try { if ((await fsImpl.stat(glob)).isFile()) out.push(path.normalize(glob)); } catch { /* not there */ }
    return out;
  }
  await walk(prefix, 0);
  return out;
}

/** Every file to tail: the configured globs, the lanes' own files, the API's dir. Sorted, unique. */
export async function findFiles({ files = [], lanes = true, laneRoots = [], stateDir = null, fsImpl = fsp } = {}) {
  const found = new Set();
  for (const g of files) for (const p of await expandGlob(g, { fsImpl })) found.add(p);
  const exists = async (p) => { try { return (await fsImpl.stat(p)).isFile(); } catch { return false; } };
  if (lanes) {
    for (const root of laneRoots) {
      if (typeof root !== 'string' || !path.isAbsolute(root)) continue;
      const p = path.join(root, LANE_FILE);
      if (await exists(p)) found.add(p);
    }
  }
  if (stateDir) for (const p of await expandGlob(path.join(stateDir, 'runs', '*.jsonl'), { fsImpl })) found.add(p);
  return [...found].sort().slice(0, FILES_MAX);
}

/**
 * Read what was appended to `file` since `tail` (`{ino, dev, offset, rest}`,
 * null the first time). Returns `{tail, lines, reset}`: the complete new
 * lines, and whether the file must be read from the start (it shrank or was
 * replaced). A missing file returns `{tail: null, lines: [], gone: true}`.
 */
export async function readTail(file, tail, { fsImpl = fsp, readMax = READ_MAX } = {}) {
  let st;
  try { st = await fsImpl.stat(file); } catch { return { tail: null, lines: [], reset: false, gone: true }; }
  let reset = false;
  let t = tail;
  if (t && (st.ino !== t.ino || st.dev !== t.dev || st.size < t.offset)) { reset = true; t = null; }
  if (!t) t = { ino: st.ino, dev: st.dev, offset: 0, rest: Buffer.alloc(0), longLine: false };
  if (st.size === t.offset) return { tail: t, lines: [], reset };

  const len = Math.min(st.size - t.offset, readMax);
  const buf = Buffer.alloc(len);
  let fh;
  let got = 0;
  try {
    fh = await fsImpl.open(file, 'r');
    while (got < len) {
      const { bytesRead } = await fh.read(buf, got, len - got, t.offset + got);
      if (!bytesRead) break;
      got += bytesRead;
    }
  } catch {
    return { tail: t, lines: [], reset };
  } finally {
    await fh?.close();
  }
  const next = { ...t, offset: t.offset + got };
  const data = Buffer.concat([t.rest, buf.subarray(0, got)]);
  const cut = data.lastIndexOf(NL);
  const lines = [];
  if (cut >= 0) {
    const text = data.subarray(0, cut).toString('utf8');
    const parts = text.split('\n');
    // The tail of an over-long line we already gave up on: drop it, it is not a line start.
    if (next.longLine) { parts.shift(); next.longLine = false; }
    for (const l of parts) lines.push(l.endsWith('\r') ? l.slice(0, -1) : l);
    next.rest = data.subarray(cut + 1);
  } else {
    next.rest = data;
  }
  // A partial line that is already too long will be skipped anyway: do not keep growing it.
  if (next.rest.length > MAX_LINE * 4) {
    if (!next.longLine) lines.push(null);
    next.rest = Buffer.alloc(0);
    next.longLine = true;
  }
  return { tail: next, lines, reset };
}

/** Parse tailed lines for store.ingest: events plus where the skipped lines were. */
export function parseTailLines(lines) {
  const events = [];
  const skippedAt = [];
  for (const l of lines) {
    if (l === null) { skippedAt.push(events.length); continue; }
    if (!l.trim()) continue;
    const r = parseLine(l);
    if (r.ok) events.push(r.event);
    else skippedAt.push(events.length);
  }
  return { events, skippedAt };
}

/**
 * A collector: `tick()` reads every known file once (and looks for new files
 * every `discoverMs`); `start()`/`stop()` run it on a timer. `opts.cfg` is
 * `config.runs`, `laneRoots()` gives the lane roots, `stateDir` is the API's
 * directory. Everything is injectable for tests.
 */
export function createCollector(opts = {}) {
  const cfg = opts.cfg ?? {};
  const fsImpl = opts.fsImpl ?? fsp;
  const now = opts.now ?? (() => Date.now());
  const discoverMs = opts.discoverMs ?? DISCOVER_MS;
  const store = opts.store ?? createStore({ maxEvents: cfg.maxEvents, keepDays: cfg.keepDays, now });
  const tails = new Map(); // file -> tail
  let files = [];
  let discoveredAt = -Infinity;
  let timer = null;
  let busy = false;

  async function discover() {
    const roots = (() => { try { return opts.laneRoots?.() ?? []; } catch { return []; } })();
    files = await findFiles({ files: cfg.files ?? [], lanes: cfg.lanes !== false, laneRoots: roots, stateDir: opts.stateDir ?? null, fsImpl });
    discoveredAt = now();
  }

  async function readOne(file) {
    const saved = tails.get(file) ?? null;
    const r = await readTail(file, saved, { fsImpl, readMax: opts.readMax });
    if (r.gone) { tails.delete(file); return; }
    // No saved position means a read from the start: drop what the store still
    // holds from this file (it left discovery or was deleted and came back),
    // or every line it read before is counted twice.
    if (r.reset || !saved) store.reset(file);
    tails.set(file, r.tail);
    if (r.lines.length) {
      const { events, skippedAt } = parseTailLines(r.lines);
      store.ingest(file, events, skippedAt);
    }
  }

  let running = null; // the tick in progress, so track() can wait for it

  async function tick({ discover: force = false } = {}) {
    if (busy) return;
    busy = true;
    running = (async () => {
      if (force || now() - discoveredAt >= discoverMs) await discover();
      for (const f of files) await readOne(f);
      for (const f of [...tails.keys()]) if (!files.includes(f)) tails.delete(f);
      store.prune();
    })();
    try {
      await running;
    } finally {
      busy = false;
      running = null;
    }
  }

  /**
   * Read `file` now (the API just appended to it) instead of waiting up to
   * `discoverMs` for discovery to find it. A file over FILES_MAX is not added.
   */
  async function track(file) {
    if (!files.includes(file)) {
      if (files.length >= FILES_MAX) return false;
      files = [...files, file].sort();
    }
    // One reader at a time: wait for a tick in progress, then read the file.
    while (busy) await running.catch(() => {});
    busy = true;
    running = readOne(file);
    try { await running; } finally { busy = false; running = null; }
    return true;
  }

  function start(intervalMs = TICK_MS) {
    if (timer) return;
    const run = () => tick().catch((err) => log.warn('runs collector tick failed', err?.message || String(err)));
    run();
    timer = setInterval(run, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { store, tick, track, start, stop, files: () => [...files] };
}

// The one collector the builder runs, started by a module (server/routes/runs.mjs).
let current = null;

export function start(opts = {}) {
  stop();
  current = createCollector(opts);
  current.start(opts.intervalMs);
  return current;
}

export function stop() {
  current?.stop();
  current = null;
}

/** Read a file the API just wrote, on the running collector (no-op before start). */
export async function track(file) {
  return current ? current.track(file) : false;
}

/** The running collector's store, or null before start. */
export function store() {
  return current?.store ?? null;
}
