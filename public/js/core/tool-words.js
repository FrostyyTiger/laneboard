// The words of a tool line (cockpit spec c1-talk.md §5 "Words", "Targets from odd
// input", §5.1 "The fold rule", §5.2; D24, D126, D147). Pure, no imports, no DOM:
// the pane draws what these return, `test/tool-words.test.mjs` checks the table.
//
//   toolName(tool)                  `mcp__laneboard__fleet` → `fleet`; another server's tool kept
//   changesThings(tool)             Bash, Edit, Write, NotebookEdit and every tool not in the table (D126)
//   canFold(lastCall, call)         §5.1: the call joins the line whose last call is lastCall
//   shorten(text)                   §5 "Shortening": 32 code points, back to a space, `…`
//   callTarget(tool, input, opts)     the call's {target}, null when it has none
//   lineWords(calls, opts)          the collapsed text, without the glyph, ` · k failed` or `…`
//   lineText(calls, opts)           the whole collapsed text: words, ` · {k} failed`, `…` while running;
//                                   a refused call's `tried {tool}, not allowed` (§5.2, D125)
//   isDenied(calls)                 the line is §5.2's `tried` line (its one call refused)
//   wholeInput(call)                the opened row shows the whole input, wrapped (§5.2)
//   callRow(call)                   one opened row: `fleet  {"site":"hv1"}  800 ms  ok`
//
// A call is {tool, input, startedAt, endedAt?, isError?, denied?} as the room's
// `tool.start` / `tool.end` (or a snapshot item) carries it; its input is the
// room's redacted copy (§5.3), so a secret reads `[redacted]` here too.

const PREFIX = 'mcp__laneboard__';
const MAX_TARGET = 32;
const BACK_TO = 15; // a space at character 16 or later (index 15, counted from 0)
const MAX_INPUT = 120;
const INVALID = Symbol('invalid address');

/** The name the table is keyed by: the laneboard MCP tools without their prefix (§5). */
export function toolName(tool) {
  const t = String(tool ?? '');
  return t.startsWith(PREFIX) ? t.slice(PREFIX.length) : t;
}

/** `mcp__<server>__<tool>` of another MCP server as `<server>:<tool>`, else null. */
function otherServer(tool) {
  const t = String(tool ?? '');
  if (!t.startsWith('mcp__') || t.startsWith(PREFIX)) return null;
  const rest = t.slice(5);
  const cut = rest.indexOf('__');
  return cut > 0 ? `${rest.slice(0, cut)}:${rest.slice(cut + 2)}` : rest;
}

/** Each run of white space (newlines too) as one space, trimmed (§5 "Shortening"). */
const squash = (s) => s.split(/\s+/u).filter(Boolean).join(' ');

/**
 * §5 "Shortening" (D147): trimmed, white space squashed, at most 32 code points;
 * when more follow, back to the last space among those 32 if it stands at
 * character 16 or later, then `…`. Counted by code point, never half an emoji.
 */
export function shorten(text) {
  const chars = [...squash(String(text))];
  if (chars.length <= MAX_TARGET) return chars.join('');
  let keep = chars.slice(0, MAX_TARGET);
  const space = keep.lastIndexOf(' ');
  if (space >= BACK_TO) keep = keep.slice(0, space);
  return `${keep.join('')}…`;
}

/** A target field: a string as it is, a number as its text, anything else (or empty) none (D147). */
function inputField(input, key) {
  const v = input && typeof input === 'object' ? input[key] : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  return squash(v) === '' ? null : v;
}

/** `Read` / `Edit` paths: the last part after the last `/`, a trailing `/` ignored; `/` is `/`. */
function lastPart(p) {
  if (p === null) return null;
  const s = squash(p);
  if (/^\/+$/u.test(s)) return '/';
  const parts = s.replace(/\/+$/u, '').split('/');
  return parts.at(-1) || null;
}

/** `WebFetch`: the URL's host as the URL API gives it, http(s) only, else INVALID (§5, D22). */
function fetchHost(v) {
  if (v === null) return null;
  let u;
  try { u = new URL(v); } catch { return INVALID; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return INVALID;
  return u.hostname || INVALID;
}

/**
 * §5's table, keyed by the name without its prefix. `target(input)` is the raw
 * target (null: none); `one(t)` and `many(n)` the texts; `none` the no-target
 * text of a tool that takes one; `changes` a tool that changes things (§5.2).
 */
const TABLE = {
  fleet: { target: (i) => inputField(i, 'site'), one: (t) => `read the feed of ${t}`, none: 'looked at the fleet', many: (n) => `read ${n} feeds` },
  runs: { target: (i) => inputField(i, 'run'), one: (t) => `looked at run ${t}`, none: 'looked at the runs', many: (n) => `looked at ${n} runs` },
  lanes: { target: (i) => inputField(i, 'builder'), one: (t) => `looked at the lanes on ${t}`, none: 'looked at the lanes', many: (n) => `looked at lanes on ${n} builders` },
  ci: { target: (i) => inputField(i, 'branch'), one: (t) => `looked at CI on ${t}`, none: 'looked at CI', many: (n) => `looked at CI on ${n} branches` },
  alerts: { one: () => 'read the alerts', many: (n) => `read the alerts ${n}×` },
  morning: { target: (i) => inputField(i, 'window'), one: (t) => `read the Morning for ${t}`, none: 'read the Morning', many: (n) => `read the Morning ${n}×` },
  history: { target: (i) => inputField(i, 'node') ?? inputField(i, 'run'), one: (t) => `read the history of ${t}`, none: 'read the history', many: (n) => `read the history of ${n} nodes` },
  focus: {
    target: (i) => inputField(i, 'screen'),
    one: (t, opts) => (t === 'all' ? 'looked at the screens' : t === opts.screen ? 'looked at this screen' : `looked at screen ${t}`),
    none: 'looked at this screen',
    many: (n) => `looked at ${n} screens`,
  },
  Read: { target: (i) => lastPart(inputField(i, 'file_path')), one: (t) => `read ${t}`, none: 'read a file', many: (n) => `read ${n} files` },
  Grep: { one: () => 'searched the files', many: (n) => `searched the files ${n}×` },
  Glob: { one: () => 'searched the files', many: (n) => `searched the files ${n}×` },
  Bash: { target: (i) => inputField(i, 'command'), one: (t) => `ran ${t}`, none: 'ran a command', changes: true },
  WebFetch: {
    target: (i) => fetchHost(inputField(i, 'url')),
    one: (t) => `fetched a page from ${t === INVALID ? 'an invalid address' : t}`,
    none: 'fetched a page',
    many: (n) => `fetched ${n} pages`,
  },
  WebSearch: { one: () => 'searched the web', many: (n) => `searched the web ${n}×` },
  Edit: { target: (i) => lastPart(inputField(i, 'file_path')), one: (t) => `changed ${t}`, none: 'changed a file', changes: true },
  Write: { target: (i) => lastPart(inputField(i, 'file_path')), one: (t) => `changed ${t}`, none: 'changed a file', changes: true },
  NotebookEdit: { target: (i) => lastPart(inputField(i, 'notebook_path')), one: (t) => `changed ${t}`, none: 'changed a file', changes: true },
  Task: { one: () => 'asked a helper agent', many: (n) => `asked ${n} helper agents` },
};

const rowOf = (tool) => (Object.hasOwn(TABLE, toolName(tool)) ? TABLE[toolName(tool)] : null);

/** §5.2 (D126): Bash, Edit, Write, NotebookEdit and every tool under "any other tool". */
export function changesThings(tool) {
  const row = rowOf(tool);
  return !row || row.changes === true;
}

/**
 * §5.1 "The fold rule": a call joins the line whose last call has its
 * `blockIndex` minus one, of the same tool (prefix stripped), when that tool
 * does not change things.
 */
export function canFold(last, call) {
  if (!last || !call) return false;
  // §5.2 (D125): a refused call holds its own line; none joins it, it joins none.
  if (last.denied === true || call.denied === true) return false;
  if (last.blockIndex !== call.blockIndex - 1) return false;
  if (toolName(last.tool) !== toolName(call.tool)) return false;
  return !changesThings(call.tool);
}

/** The call's {target}: shortened, or INVALID for a WebFetch address, or null for none. */
export function callTarget(tool, input) {
  const row = rowOf(tool);
  if (!row?.target) return null;
  const t = row.target(input);
  if (t === null || t === INVALID) return t;
  return shorten(t);
}

/**
 * The collapsed words of a line (§5, §5.1): the `one` text while every call has
 * the same {target} (no target counts as one), else `many` with {n} the started
 * calls. A tool that changes things holds one call (it never folds).
 */
export function lineWords(calls, opts = {}) {
  const first = calls[0];
  const row = rowOf(first?.tool);
  if (!row) {
    const other = otherServer(first?.tool);
    return `used ${other ?? toolName(first?.tool)}`;
  }
  const targets = calls.map((c) => callTarget(c.tool, c.input));
  const same = targets.every((t) => t === targets[0]);
  if ((calls.length === 1 || (same && row.target)) || !row.many) {
    const t = targets[0];
    return t === null && row.target ? row.none : row.one(t, opts);
  }
  return row.many(calls.length);
}

/** Ended calls that failed: `isError:true` and not refused (§5 "Failures", §5.1). */
export const failedCount = (calls) => calls.filter((c) => c.endedAt != null && c.isError === true && c.denied !== true).length;

/** Any call of the line still running (started, not ended). */
export const anyRunning = (calls) => calls.some((c) => c.endedAt == null);

/** The name a `tried` line and an opened row show: `Bash`, `fleet`, `<server>:<tool>` (§5.2). */
const shownName = (tool) => otherServer(tool) ?? toolName(tool);

/** §5.2 (D125): the line holds a refused call (it holds that one call alone). */
export const isDenied = (calls) => calls.some((c) => c.denied === true);

/**
 * The whole collapsed text (no glyph, which is the line's own column): words, failures,
 * `…` while a call runs; `opts.stopped` (the turn ended under it, §5.1) drops the `…`,
 * and `opts.byStop` (it ended by STOP, c1-talk.md §8) ends a line still running in ` · stopped`.
 * A refused call: `tried {tool}, not allowed`, no `…`, no ` · failed` (§5.2, D125);
 * until its `tool.end` says so it reads as any running call.
 */
export function lineText(calls, opts = {}) {
  if (isDenied(calls)) return `tried ${shownName(calls.find((c) => c.denied === true).tool)}, not allowed`;
  const k = failedCount(calls);
  const running = anyRunning(calls);
  const dots = running && !opts.stopped ? '…' : '';
  const cut = running && opts.stopped && opts.byStop ? ' · stopped' : '';
  return `${lineWords(calls, opts)}${k ? ` · ${k} failed` : ''}${dots}${cut}`;
}

/** Whole ms from startedAt to endedAt (ISO strings or ms numbers), null when either is not a time. */
export function callMs(call) {
  const ms = (v) => (typeof v === 'number' ? v : Date.parse(v ?? ''));
  const d = ms(call.endedAt) - ms(call.startedAt);
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}

/** §5.2: a tool that changes things and a refused call show their whole input, wrapped. */
export const wholeInput = (call) => changesThings(call.tool) || call.denied === true;

/** Compact JSON cut at 120 code points with `…` (§5 "Open"); whole for wholeInput() (§5.2). */
function inputText(call) {
  let s;
  try { s = JSON.stringify(call.input ?? {}); } catch { s = '{}'; }
  if (s === undefined) s = '{}';
  if (wholeInput(call)) return s;
  const chars = [...s];
  return chars.length > MAX_INPUT ? `${chars.slice(0, MAX_INPUT).join('')}…` : s;
}

/**
 * One opened row (§5 "Open", §5.2): `<tool>  <input>  <ms> ms  ok|failed`, a refused
 * call `<tool>  <input>  refused`, a call still running `<tool>  <input>  …`, one the
 * turn's end cut (`opts.stopped`, it never ended) `<tool>  <input>` alone.
 */
export function callRow(call, opts = {}) {
  const head = `${shownName(call.tool)}  ${inputText(call)}`;
  if (call.denied === true) return `${head}  refused`;
  if (call.endedAt == null) return opts.stopped ? head : `${head}  …`;
  const ms = callMs(call);
  return `${head}  ${ms === null ? '?' : ms} ms  ${call.isError === true ? 'failed' : 'ok'}`;
}
