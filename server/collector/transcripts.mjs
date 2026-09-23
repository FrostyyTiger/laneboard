// Incremental transcript tailing: cost, token counts, last prompt/reply.
//
// A transcript is append-only JSONL and can be 24 MB. Never read one whole into
// a string per tick (hard rule 8): keep a byte offset per file and stream only
// the new bytes, holding back any trailing partial line.
//
// The SAME message.id appears on one line per content block, each carrying the
// SAME usage — measured at 1.76x on the largest file here. Dedupe by
// message.id or the cost comes out that much too high.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { encodeProjectDir, truncate, startOfLocalDay } from '../util.mjs';
import { normaliseUsage, addUsage, EMPTY_USAGE, costByModel } from '../pricing.mjs';
import { readOffset, writeOffset } from '../db.mjs';

const MAX_SEEN_IDS = 5000;

/** path -> FileState */
const files = new Map();

function newState(p, sessionId) {
  return {
    path: p,
    sessionId,
    offset: 0,
    partial: '',
    seenIds: new Set(),
    seenOrder: [],
    byModel: {},        // modelId -> usage
    todayByModel: {},   // same, but only lines timestamped after local midnight
    dayKey: null,
    lastUserPrompt: '',
    lastAssistant: '',
    lastAssistantAt: null,
    lines: 0,
    dupes: 0,
    parsing: false,
    dirty: false,
  };
}

function dayKeyNow() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());
}

function remember(st, id) {
  if (st.seenIds.has(id)) return false;
  st.seenIds.add(id);
  st.seenOrder.push(id);
  if (st.seenOrder.length > MAX_SEEN_IDS) {
    // Transcripts are append-only, so an id far enough back can never recur.
    const drop = st.seenOrder.splice(0, st.seenOrder.length - MAX_SEEN_IDS);
    for (const d of drop) st.seenIds.delete(d);
  }
  return true;
}

/** Text of the last real user prompt: a string, or text blocks — never a tool_result. */
export function userPromptText(line) {
  const content = line?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return null;
    const text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
    return text || null;
  }
  return null;
}

export function assistantText(line) {
  const content = line?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
    return text || null;
  }
  return null;
}

/** Apply one parsed JSONL line to the running totals. Exported for tests. */
export function applyLine(st, line) {
  if (!line || typeof line !== 'object') return;
  st.lines++;
  if (line.type === 'assistant') {
    const id = line.message?.id;
    const usage = line.message?.usage;
    if (usage) {
      if (!id) {
        // No id to dedupe on — count it, it is the only sighting we get.
        accrue(st, line, normaliseUsage(usage));
      } else if (remember(st, id)) {
        accrue(st, line, normaliseUsage(usage));
      } else {
        st.dupes++;
      }
    }
    const text = assistantText(line);
    if (text) {
      st.lastAssistant = truncate(text, 300);
      st.lastAssistantAt = Date.parse(line.timestamp) || st.lastAssistantAt;
    }
  } else if (line.type === 'user') {
    const text = userPromptText(line);
    if (text) st.lastUserPrompt = truncate(text, 200);
  }
}

function accrue(st, line, usage) {
  // "<synthetic>" placeholder messages carry an all-zero usage block. Counting
  // them would add $0 but would wrongly flag the session as priced-as-opus.
  if (!usage.input && !usage.output && !usage.cacheRead && !usage.cacheWrite5m && !usage.cacheWrite1h) return;
  const model = line.message?.model || 'unknown';
  st.byModel[model] = addUsage(st.byModel[model] ?? EMPTY_USAGE(), usage);
  const ts = Date.parse(line.timestamp);
  if (Number.isFinite(ts) && ts >= startOfLocalDay(config.timezone)) {
    st.todayByModel[model] = addUsage(st.todayByModel[model] ?? EMPTY_USAGE(), usage);
  }
  st.dirty = true;
}

/** Stream the bytes between st.offset and the current size. */
async function readNew(st) {
  let size;
  try {
    size = (await fsp.stat(st.path)).size;
  } catch {
    return; // transcript not written yet
  }
  if (size < st.offset) {
    // Truncated or replaced — start over rather than mis-parse.
    log.warn(`transcript shrank, re-reading from 0: ${st.path}`);
    Object.assign(st, newState(st.path, st.sessionId));
  }
  if (size === st.offset) return;

  const start = st.offset;
  const stream = fs.createReadStream(st.path, { start, end: size - 1, encoding: 'utf8', highWaterMark: 1 << 20 });
  let consumed = start;
  let buf = st.partial;
  try {
    for await (const chunk of stream) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consumed += Buffer.byteLength(raw) + 1;
        if (!raw.trim()) continue;
        try { applyLine(st, JSON.parse(raw)); } catch { /* half-written line */ }
      }
    }
  } catch (err) {
    log.warn(`transcript read failed ${st.path}: ${err}`);
    return;
  }
  // Hold back the trailing partial line; the offset only advances past whole lines.
  st.partial = buf;
  st.offset = consumed;
  st.dirty = true;
}

/** Resolve a transcript path: statusline value first, encoded cwd as fallback. */
export function transcriptPathFor({ transcriptPath, sessionId, dir }) {
  if (transcriptPath) return transcriptPath;
  if (!sessionId || !dir) return null;
  return path.join(config.projectsDir, encodeProjectDir(dir), `${sessionId}.jsonl`);
}

function restore(st) {
  const saved = readOffset(st.path);
  if (!saved) return;
  st.offset = saved.offset ?? 0;
  for (const id of saved.seenIds ?? []) remember(st, id);
  const u = saved.usage;
  if (u) {
    st.byModel = u.byModel ?? {};
    st.dayKey = u.dayKey ?? null;
    // Only trust "today" totals if they were saved on the same local day.
    st.todayByModel = st.dayKey === dayKeyNow() ? (u.todayByModel ?? {}) : {};
    st.lastUserPrompt = u.lastUserPrompt ?? '';
    st.lastAssistant = u.lastAssistant ?? '';
    st.lastAssistantAt = u.lastAssistantAt ?? null;
  }
}

export function persist(st) {
  if (!st.dirty) return;
  writeOffset(st.path, {
    offset: st.offset,
    sessionId: st.sessionId,
    seenIds: st.seenOrder,
    usage: {
      byModel: st.byModel,
      todayByModel: st.todayByModel,
      dayKey: st.dayKey ?? dayKeyNow(),
      lastUserPrompt: st.lastUserPrompt,
      lastAssistant: st.lastAssistant,
      lastAssistantAt: st.lastAssistantAt,
    },
  });
  st.dirty = false;
}

export function persistAll() {
  for (const st of files.values()) persist(st);
}

/** Roll `today` totals over at local midnight. */
function rollDay(st) {
  const key = dayKeyNow();
  if (st.dayKey && st.dayKey !== key) {
    st.todayByModel = {};
    st.dirty = true;
  }
  st.dayKey = key;
}

/** Update one session's transcript and return its cost object (plan §2.1). */
export async function update({ transcriptPath, sessionId, dir }) {
  const p = transcriptPathFor({ transcriptPath, sessionId, dir });
  if (!p) return null;
  let st = files.get(p);
  if (!st) {
    st = newState(p, sessionId);
    restore(st);
    files.set(p, st);
  }
  if (st.parsing) return report(st); // a first full parse can take a while
  st.parsing = true;
  try {
    rollDay(st);
    await readNew(st);
  } finally {
    st.parsing = false;
  }
  return report(st);
}

export function report(st) {
  const total = costByModel(st.byModel);
  const today = costByModel(st.todayByModel);
  let tokens = EMPTY_USAGE();
  for (const u of Object.values(st.byModel)) tokens = addUsage(tokens, u);
  return {
    usd: total.usd,
    usdToday: today.usd,
    tokens,
    byModel: total.byModel,
    pricedAsOpus: total.pricedAsOpus,
    lines: st.lines,
    dupesSkipped: st.dupes,
    transcriptPath: st.path,
    lastUserPrompt: st.lastUserPrompt,
    lastAssistant: st.lastAssistant,
    lastAssistantAt: st.lastAssistantAt,
  };
}

/** Hourly cost snapshots, so a restart mid-day keeps a history to plot. */
/**
 * Hourly cumulative cost per transcript.
 *
 * `sessionName` used to be hardcoded null here, and nothing read the column
 * until the Morning view tried to work out what a lane spent overnight — at
 * which point nine days of history turned out to be unattributable by name.
 * The caller resolves the name from the sessionId, which IS recorded.
 */
export function snapshotAll(addCostSnapshot) {
  for (const st of files.values()) {
    const r = report(st);
    if (!r.usd) continue;
    addCostSnapshot({ sessionId: st.sessionId, usd: r.usd, tokens: r.tokens });
  }
}

export function getState(p) { return files.get(p) ?? null; }
export function allStates() { return [...files.values()]; }

/** Totals across every tracked transcript. */
export function totals() {
  let byModel = {};
  let todayByModel = {};
  for (const st of files.values()) {
    for (const [m, u] of Object.entries(st.byModel)) byModel[m] = addUsage(byModel[m] ?? EMPTY_USAGE(), u);
    for (const [m, u] of Object.entries(st.todayByModel)) todayByModel[m] = addUsage(todayByModel[m] ?? EMPTY_USAGE(), u);
  }
  const all = costByModel(byModel);
  const today = costByModel(todayByModel);
  return { usd: all.usd, usdToday: today.usd, byModel: all.byModel, pricedAsOpus: all.pricedAsOpus };
}
