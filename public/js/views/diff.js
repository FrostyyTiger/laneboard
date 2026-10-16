// The Diff view (fleet plan §10 2.12, R11): one lane's file list and unified
// diff, line comments, and an explicit "Send review".
//
// Opened as `#/diff?sel=<lane fkey>&base=<ref>`. Data:
//   builder  GET /api/v1/lanes/:id/diff?base=&mode=&path=
//   hub      GET /api/fleet/:builder/v1/lanes/:id/diff?...   (signed read proxy)
// in server/review/diff.mjs laneDiff's shape: {lane, base, mergeBase, head,
// headSha, source, mode, totals, truncated, files:[{path, oldPath, status,
// add, del, binary, generated, deferred, truncated, hunks:[{header, ...,
// lines:[{t, o, n, s}]}]}], untracked, untrackedTruncated}. Deferred files
// (generated, over the budget) load one at a time with `path=`.
//
// Comments: click a line number to select it, shift-click for a range, then
// `c` or the comment button. Drafts live in localStorage under
// `lb.review.<fkey>.<headSha>` (try/catch). "Send review (N)" opens a sheet
// with the exact formatReview text; only that sheet's Send button, after the
// confirm dialog (ui/confirm.js, tier ask), issues `send-review`. Nothing is
// sent on mount, on a route, or by a hotkey.
//
// Everything in a diff (file names included) is untrusted builder text: it
// reaches the page through textContent only, never as markup. Pure at import
// time; the pure model helpers are exported for test/view-diff.test.mjs.
import { panel, setPanel } from '../ui/components.js';
import { langOf, tokenize } from '../core/hl.js';
import { formatReview, pullCommands, MAX_COMMENTS, MAX_QUOTE_LINES, MAX_BODY_CHARS, MAX_NOTE_CHARS } from '../core/review-format.js';
import { parseFkey } from '../core/keys.js';
import { act, isDotSegment } from '../core/actions.js';
import { store } from '../core/store.js';
import { storeLookups } from '../core/review-queue.js';
import { confirmAction } from '../ui/confirm.js';

// ---------------------------------------------------------------------------
// Pure model

/** Files with more lines than this start collapsed. */
export const COLLAPSE_LINES = 1000;
/** Same as server/config/review.mjs BASE_RE (send-review's schema). */
export const BASE_RE = /^(origin\/[A-Za-z0-9._/-]{1,100}|[0-9a-f]{7,40})$/;
const QUOTE_LINE_MAX = 1000; // send-review's per-quote-line cap
const DRAFT_PREFIX = 'lb.review.';

/** The scope shown in the panel title: the builder filter, or ALL. */
export function diffScope(route) {
  const b = route?.b;
  return typeof b === 'string' && b && b !== 'all' ? b : 'all';
}

/** `base=` from a hash (the router keeps only its own keys), validated; else null. */
export function baseFromHash(hash) {
  const raw = String(hash ?? '');
  const q = raw.indexOf('?');
  if (q < 0) return null;
  for (const part of raw.slice(q + 1).split('&')) {
    if (!part.startsWith('base=')) continue;
    let v;
    try { v = decodeURIComponent(part.slice(5).replace(/\+/g, ' ')); } catch { return null; }
    return BASE_RE.test(v) && !v.includes('..') ? v : null;
  }
  return null;
}

/**
 * The diff URL for a lane, or null when the lane key cannot be addressed.
 * `hub` picks the hub's read proxy. Every segment and value is encoded.
 */
export function diffUrl({ hub = false, builder, laneId, base = null, mode = null, path = null } = {}) {
  if (typeof laneId !== 'string' || laneId === '' || isDotSegment(laneId) || laneId.includes('/')) return null;
  const enc = encodeURIComponent;
  let url;
  if (hub) {
    if (typeof builder !== 'string' || !/^[a-z0-9-]{1,24}$/.test(builder)) return null;
    url = `/api/fleet/${enc(builder)}/v1/lanes/${enc(laneId)}/diff`;
  } else {
    url = `/api/v1/lanes/${enc(laneId)}/diff`;
  }
  const qs = [];
  if (typeof base === 'string' && BASE_RE.test(base)) qs.push(`base=${enc(base)}`);
  if (mode === 'all' || mode === 'committed') qs.push(`mode=${enc(mode)}`);
  if (typeof path === 'string' && path !== '') qs.push(`path=${enc(path)}`);
  return qs.length ? `${url}?${qs.join('&')}` : url;
}

/** Status letter -> {shape, word}. The shape carries the meaning; no colour needed. */
export const STATUS = Object.freeze({
  A: { shape: '+', word: 'added' },
  D: { shape: '−', word: 'deleted' },
  M: { shape: '~', word: 'modified' },
  R: { shape: '→', word: 'renamed' },
  C: { shape: '⧉', word: 'copied' },
  T: { shape: '◆', word: 'type changed' },
});

/** Kept diff lines of a file (from its hunks), else add + del from numstat. */
export function fileLineCount(f) {
  const hunks = Array.isArray(f?.hunks) ? f.hunks : [];
  if (hunks.length) return hunks.reduce((n, h) => n + (Array.isArray(h?.lines) ? h.lines.length : 0), 0);
  return (Number(f?.add) || 0) + (Number(f?.del) || 0);
}

/** One row per file for the list: shape, counts, markers, initial collapse. */
export function fileRows(diff) {
  const files = Array.isArray(diff?.files) ? diff.files : [];
  return files.map((f, idx) => {
    const st = Object.hasOwn(STATUS, f?.status) ? f.status : 'M';
    const markers = [];
    if (f?.binary) markers.push('bin');
    if (f?.generated) markers.push('gen');
    if (f?.deferred) markers.push('deferred');
    if (f?.truncated) markers.push('trunc');
    const lines = fileLineCount(f);
    return {
      idx,
      path: String(f?.path ?? ''),
      oldPath: f?.oldPath == null ? null : String(f.oldPath),
      status: st,
      shape: STATUS[st].shape,
      word: STATUS[st].word,
      add: Number(f?.add) || 0,
      del: Number(f?.del) || 0,
      markers,
      lines,
      // Deferred and binary files show their load / binary note instead.
      collapsed: lines > COLLAPSE_LINES && !f?.deferred && !f?.binary,
    };
  });
}

/**
 * A file's hunks flattened into display rows:
 * {kind:'hunk', s} | {kind:'line', t, o, n, s}. Row indexes address lines
 * for selection and comments.
 */
export function flatRows(file) {
  const out = [];
  for (const h of Array.isArray(file?.hunks) ? file.hunks : []) {
    out.push({ kind: 'hunk', s: String(h?.header ?? '') });
    for (const l of Array.isArray(h?.lines) ? h.lines : []) {
      const t = ['+', '-', ' ', '\\'].includes(l?.t) ? l.t : ' ';
      out.push({ kind: 'line', t, o: Number.isSafeInteger(l?.o) ? l.o : null, n: Number.isSafeInteger(l?.n) ? l.n : null, s: String(l?.s ?? '') });
    }
  }
  return out;
}

/** Click on a line number: a new selection, or (shift) a range from the anchor in the same file. */
export function selectLine(sel, { file, row, shift = false }) {
  if (shift && sel && sel.file === file) {
    return { file, anchor: sel.anchor, a: Math.min(sel.anchor, row), b: Math.max(sel.anchor, row) };
  }
  return { file, anchor: row, a: row, b: row };
}

/**
 * The comment anchor for rows a..b of a file: side 'old' when every selected
 * line is a deletion, else 'new' over the lines that have a new number.
 * -> {path, side, line, endLine, quote} or null (nothing commentable).
 */
export function anchorFor(file, rows, a, b) {
  const picked = rows.slice(Math.max(0, a), b + 1).filter((r) => r.kind === 'line' && r.t !== '\\');
  if (!picked.length) return null;
  const allOld = picked.every((r) => r.t === '-');
  const side = allOld ? 'old' : 'new';
  const nums = picked.map((r) => (allOld ? r.o : r.n)).filter((x) => Number.isSafeInteger(x) && x > 0);
  if (!nums.length) return null;
  const quote = picked.slice(0, MAX_QUOTE_LINES).map((r) => r.s.slice(0, QUOTE_LINE_MAX));
  return { path: String(file.path), side, line: Math.min(...nums), endLine: Math.max(...nums), quote };
}

/** The row a draft is drawn under: the last row of its range on its side, or -1. */
export function anchorRow(rows, d) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.kind !== 'line' || r.t === '\\') continue;
    if (d.side === 'old' ? r.t === '-' && r.o === d.endLine : r.t !== '-' && r.n === d.endLine) return i;
  }
  return -1;
}

const isPos = (n) => Number.isSafeInteger(n) && n > 0;

/** A stored draft, checked and reduced to its fields; null when unusable. */
export function cleanDraft(d) {
  if (!d || typeof d !== 'object') return null;
  if (typeof d.path !== 'string' || !d.path || d.path.length > 4096) return null;
  const side = d.side === 'old' ? 'old' : 'new';
  if (!isPos(d.line)) return null;
  const endLine = isPos(d.endLine) && d.endLine >= d.line ? d.endLine : d.line;
  const quote = Array.isArray(d.quote) ? d.quote.slice(0, MAX_QUOTE_LINES).map((q) => String(q).slice(0, QUOTE_LINE_MAX)) : [];
  const body = typeof d.body === 'string' ? d.body.slice(0, MAX_BODY_CHARS) : '';
  return { path: d.path, side, line: d.line, endLine, quote, body };
}

export function draftKey(fkey, headSha) {
  return `${DRAFT_PREFIX}${fkey}.${headSha}`;
}

function readList(storage, key) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(cleanDraft).filter(Boolean).slice(0, MAX_COMMENTS) : null;
  } catch {
    return null;
  }
}

/**
 * Drafts for a lane at `headSha`: that key first; else the drafts saved
 * under another head of the same lane (the branch moved: `stale`, anchors
 * kept). -> {sha, drafts, stale}
 */
export function loadDrafts(storage, fkey, headSha) {
  const exact = readList(storage, draftKey(fkey, headSha));
  if (exact && exact.length) return { sha: headSha, drafts: exact, stale: false };
  try {
    const prefix = `${DRAFT_PREFIX}${fkey}.`;
    const n = Number(storage?.length) || 0;
    for (let i = 0; i < n; i++) {
      const k = storage.key(i);
      if (typeof k !== 'string' || !k.startsWith(prefix)) continue;
      const sha = k.slice(prefix.length);
      if (!/^[0-9a-f]{7,64}$/.test(sha) || sha === headSha) continue;
      const list = readList(storage, k);
      if (list && list.length) return { sha, drafts: list, stale: true };
    }
  } catch { /* storage unavailable */ }
  return { sha: headSha, drafts: [], stale: false };
}

/** Save (or, when empty, remove) a lane's drafts. Never throws. */
export function saveDrafts(storage, fkey, headSha, drafts) {
  try {
    const key = draftKey(fkey, headSha);
    if (!drafts.length) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(drafts.map(cleanDraft).filter(Boolean)));
    return true;
  } catch {
    return false;
  }
}

/** Drafts sorted like formatReview sorts them (path, line, endLine). */
export function sortDrafts(drafts) {
  return [...drafts].sort((a, b) => (a.path !== b.path ? (a.path < b.path ? -1 : 1) : a.line - b.line || a.endLine - b.endLine));
}

/** The exact `send-review` args (README §3.5 schema): nothing but the review. */
export function reviewArgs(diff, drafts, note = '') {
  const review = {
    base: String(diff?.base ?? ''),
    mergeBase: String(diff?.mergeBase ?? ''),
    headSha: String(diff?.headSha ?? ''),
    comments: sortDrafts(drafts.map(cleanDraft).filter(Boolean)),
  };
  const n = typeof note === 'string' ? note.slice(0, MAX_NOTE_CHARS) : '';
  if (n.trim()) review.note = n;
  return { review };
}

/** Every path a comment may name: the diff's new and old names. */
export function diffPaths(diff) {
  const out = new Set();
  for (const f of Array.isArray(diff?.files) ? diff.files : []) {
    if (typeof f?.path === 'string') out.add(f.path);
    if (typeof f?.oldPath === 'string') out.add(f.oldPath);
  }
  return out;
}

/** The text the builder will type: formatReview over the args. -> {text} | {error} */
export function reviewText({ branch, diff, drafts, note }) {
  const { review } = reviewArgs(diff, drafts, note);
  if (!review.comments.length && !review.note) return { error: 'Add a comment or a note first.' };
  try {
    return { text: formatReview({ branch, ...review, files: diffPaths(diff) }) };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

/** Pull commands for a lane record (store lane + box lookups); [] when anything fails validation. */
export function pullFor(lane, lookups = {}) {
  if (!lane) return [];
  const pr = typeof lookups.prFor === 'function' ? lookups.prFor(lane, lane.builder) : lane.pr ?? null;
  const repo = typeof lookups.repoFor === 'function' ? lookups.repoFor(lane, lane.builder) : lane.repo ?? null;
  const prNum = pr && typeof pr === 'object' ? pr.number : pr;
  const ciRepo = pr && typeof pr === 'object' && typeof pr.repo === 'string' ? pr.repo : undefined;
  return pullCommands({ repo, branch: lane.branch, laneId: lane.id, pr: prNum ?? undefined, ciRepo });
}

// ---------------------------------------------------------------------------
// DOM

let S = null; // the mounted view's state

function dvEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function button(text, cls, onClick, title = null) {
  const b = dvEl('button', cls ? `btn btn--s ${cls}` : 'btn btn--s', text);
  b.type = 'button';
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function storage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function laneOf(key) {
  return (store.lanes ?? []).find((l) => l && l.key === key) ?? null;
}

async function getJson(url) {
  let r;
  try {
    r = await fetch(url, { headers: { 'x-laneboard': '1', accept: 'application/json' } });
  } catch (err) {
    return { error: err?.message || 'network error' };
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) return { error: (j && typeof j.error === 'string' && j.error) || `HTTP ${r.status}`, status: r.status };
  if (!j || typeof j !== 'object' || !Array.isArray(j.files)) return { error: 'unexpected diff response' };
  return { data: j };
}

function urlFor(extra = {}) {
  return diffUrl({ hub: store.source?.kind === 'hub', builder: S.builder, laneId: S.laneId, base: S.base, mode: S.mode === 'committed' ? 'committed' : null, ...extra });
}

async function load() {
  if (!S || !S.key) return;
  const url = urlFor();
  const seq = ++S.seq;
  if (!url) { S.err = 'This lane cannot be addressed.'; render(); return; }
  S.loading = true;
  renderHead();
  const res = await getJson(url);
  if (!S || seq !== S.seq) return;
  S.loading = false;
  if (res.error) { S.err = res.error; render(); return; }
  S.err = null;
  const prevSha = S.diff?.headSha ?? null;
  S.diff = res.data;
  S.rows = fileRows(S.diff);
  S.flat = new Map();
  const sha = String(S.diff.headSha ?? '');
  if (S.drafts.length && S.draftsSha && S.draftsSha !== sha) {
    S.stale = true; // branch moved under live drafts: keep them and their anchors
  } else if (!S.drafts.length || prevSha === null) {
    const got = loadDrafts(storage(), S.key, sha);
    S.drafts = got.drafts;
    S.draftsSha = got.sha;
    S.stale = got.stale;
  }
  render();
}

async function loadFile(fi) {
  const f = S?.diff?.files?.[fi];
  if (!f) return;
  const seq = S.seq;
  const url = urlFor({ path: f.path });
  if (!url) return;
  const node = S.fileNodes[fi];
  if (node) { node.body.textContent = ''; node.body.append(dvEl('p', 'dv-msg', 'Loading…')); }
  const res = await getJson(url);
  if (!S || seq !== S.seq) return;
  const got = res.data?.files?.[0];
  if (res.error || !got || got.path !== f.path) {
    if (node) { node.body.textContent = ''; node.body.append(dvEl('p', 'dv-msg dv-err', res.error || 'File not in the diff any more.')); }
    return;
  }
  S.diff.files[fi] = { ...f, ...got, deferred: false };
  S.rows[fi] = fileRows({ files: [S.diff.files[fi]] })[0];
  S.rows[fi].idx = fi;
  S.rows[fi].collapsed = false;
  S.flat.delete(fi);
  renderFileBody(fi);
}

function rowsOf(fi) {
  if (!S.flat.has(fi)) S.flat.set(fi, flatRows(S.diff.files[fi]));
  return S.flat.get(fi);
}

// ---- header ----------------------------------------------------------------

function renderHead() {
  if (!S) return;
  const t = S.panel.tools;
  t.textContent = '';
  if (!S.key) return;
  const modeBtn = button(S.mode === 'committed' ? 'COMMITTED' : 'ALL', 'dv-mode', () => {
    S.mode = S.mode === 'committed' ? 'all' : 'committed';
    load();
  }, 'Toggle: working tree (all) or committed only');
  const refresh = button(S.loading ? '…' : '↻', 'dv-refresh', () => load(), 'Reload the diff');
  const pull = button('Pull', 'dv-pull-b', () => togglePull(), 'Commands to check this branch out locally');
  const n = S.drafts.length;
  const count = dvEl('span', 'dv-count', n ? `${n} draft${n === 1 ? '' : 's'}` : 'no drafts');
  const send = button(`Send review (${n})`, 'btn--primary dv-send-b', () => openSendSheet());
  send.disabled = !S.diff;
  t.append(modeBtn, refresh, pull, count, send);
  setPanel(S.panel.root, { n: S.diff ? S.rows.length : undefined });
}

function togglePull() {
  if (S.pullNode) { S.pullNode.remove(); S.pullNode = null; return; }
  const box = dvEl('div', 'dv-pop');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Pull to local');
  const cmds = pullFor(laneOf(S.key), storeLookups(store));
  if (!cmds.length) box.append(dvEl('p', 'dv-msg', 'No pull command: the lane record is missing or did not pass validation.'));
  for (const c of cmds) {
    const row = dvEl('div', 'dv-pop-row');
    row.append(dvEl('div', 'dv-pop-l', c.label));
    const code = dvEl('code', 'dv-pop-c', c.cmd);
    const copy = button('Copy', '', async () => {
      try { await navigator.clipboard.writeText(c.cmd); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
    });
    row.append(code, copy);
    box.append(row);
  }
  box.append(button('Close', '', () => togglePull()));
  S.pullNode = box;
  S.banners.after(box);
}

// ---- body ------------------------------------------------------------------

function render() {
  if (!S) return;
  renderHead();
  const body = S.panel.body;
  body.textContent = '';
  S.banners = dvEl('div', 'dv-banners');
  body.append(S.banners);
  S.pullNode = null;
  if (S.observer) { try { S.observer.disconnect(); } catch { /* gone */ } S.observer = null; }
  S.fileNodes = [];
  S.sel = null;
  S.editor = null;

  if (!S.key) { body.append(dvEl('p', 'empty', 'Select a lane to see its diff.')); return; }
  if (S.err) { S.banners.append(dvEl('p', 'dv-banner dv-err', `Diff unavailable: ${S.err}`)); return; }
  if (!S.diff) { body.append(dvEl('p', 'dv-msg', 'Loading the diff…')); return; }
  const d = S.diff;

  const meta = dvEl('p', 'dv-meta');
  meta.textContent = `${S.laneId} · ${String(d.base ?? '')} @ ${String(d.mergeBase ?? '').slice(0, 7)} .. ${String(d.headSha ?? '').slice(0, 7)} · ${d.source === 'remote' ? 'origin' : 'worktree'} · ${d.mode === 'committed' ? 'committed' : 'all'} · ${Number(d.totals?.files) || 0} files +${Number(d.totals?.add) || 0} −${Number(d.totals?.del) || 0}`;
  S.banners.append(meta);
  if (S.stale) {
    const b = dvEl('p', 'dv-banner dv-warn', 'Branch moved; comments may be stale. ');
    b.append(button('Keep on new head', '', () => {
      saveDrafts(storage(), S.key, S.draftsSha, []);
      S.draftsSha = String(S.diff.headSha ?? '');
      S.stale = false;
      persist();
      render();
    }));
    S.banners.append(b);
  }
  if (d.truncated) S.banners.append(dvEl('p', 'dv-banner', 'The diff is over the size caps: some files are deferred or cut; load them one by one.'));
  const orphan = S.drafts.filter((x) => !diffPaths(d).has(x.path));
  if (orphan.length) S.banners.append(dvEl('p', 'dv-banner dv-warn', `${orphan.length} draft${orphan.length === 1 ? '' : 's'} on files no longer in this diff: delete ${orphan.length === 1 ? 'it' : 'them'} before sending.`));
  for (const x of orphan) S.banners.append(draftNode(x, null));

  const grid = dvEl('div', 'dv');
  const list = dvEl('nav', 'dv-files');
  list.setAttribute('aria-label', 'Changed files');
  const main = dvEl('div', 'dv-main');
  grid.append(list, main);
  body.append(grid);

  if (!S.rows.length) main.append(dvEl('p', 'empty', 'No changes against the base.'));
  for (const r of S.rows) {
    list.append(fileItem(r));
    main.append(fileSection(r));
  }
  if (Array.isArray(d.untracked) && d.untracked.length) {
    const u = dvEl('div', 'dv-untracked');
    u.append(dvEl('h3', 'dv-sub', `Untracked (${d.untracked.length}${d.untrackedTruncated ? '+' : ''}, names only)`));
    for (const name of d.untracked) u.append(dvEl('div', 'dv-path', name));
    main.append(u);
  }

  main.addEventListener('click', onMainClick);
  observeFiles();
}

function fileItem(r) {
  const b = dvEl('button', 'dv-fi');
  b.type = 'button';
  b.title = `${r.word}: ${r.oldPath ? `${r.oldPath} → ` : ''}${r.path}`;
  b.append(dvEl('span', `dv-st dv-st-${r.status}`, r.shape), dvEl('span', 'dv-fi-p', r.path), dvEl('span', 'dv-fi-n', `+${r.add} −${r.del}`));
  for (const m of r.markers) b.append(dvEl('span', `dv-mk dv-mk-${m}`, m));
  b.addEventListener('click', () => {
    const node = S.fileNodes[r.idx];
    if (!node) return;
    if (r.collapsed) toggleFile(r.idx);
    node.root.scrollIntoView?.({ block: 'start' });
  });
  return b;
}

function fileSection(r) {
  const root = dvEl('section', 'dv-file');
  root.dataset.f = String(r.idx);
  const head = dvEl('button', 'dv-fh');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(!r.collapsed));
  head.append(dvEl('span', `dv-st dv-st-${r.status}`, r.shape));
  if (r.oldPath) head.append(dvEl('span', 'dv-path dv-old', r.oldPath), dvEl('span', 'dv-arrow', '→'));
  head.append(dvEl('span', 'dv-path', r.path), dvEl('span', 'dv-fi-n', `+${r.add} −${r.del}`));
  for (const m of r.markers) head.append(dvEl('span', `dv-mk dv-mk-${m}`, m));
  head.addEventListener('click', () => toggleFile(r.idx));
  const body = dvEl('div', 'dv-hunks');
  root.append(head, body);
  const node = { root, head, body, rendered: false, rowNodes: [] };
  S.fileNodes[r.idx] = node;
  placeholder(r.idx);
  return root;
}

function placeholder(fi) {
  const r = S.rows[fi];
  const f = S.diff.files[fi];
  const node = S.fileNodes[fi];
  node.body.textContent = '';
  node.rendered = false;
  node.rowNodes = [];
  if (r.collapsed) {
    node.body.append(dvEl('p', 'dv-msg', `${r.lines} lines, collapsed. Click the file name to show.`));
    return;
  }
  if (f.binary) { node.body.append(dvEl('p', 'dv-msg', 'Binary file.')); node.rendered = true; return; }
  if (f.deferred) {
    const p = dvEl('p', 'dv-msg', f.generated ? 'Generated file, not loaded. ' : 'Over the diff budget, not loaded. ');
    p.append(button('Load file', '', () => loadFile(fi)));
    node.body.append(p);
    node.rendered = true;
    return;
  }
  if (!Array.isArray(f.hunks) || !f.hunks.length) { node.body.append(dvEl('p', 'dv-msg', 'No text changes (mode or rename only).')); node.rendered = true; return; }
  node.body.append(dvEl('p', 'dv-msg dv-lazy', `${r.lines} lines`));
}

function toggleFile(fi) {
  const r = S.rows[fi];
  r.collapsed = !r.collapsed;
  S.fileNodes[fi].head.setAttribute('aria-expanded', String(!r.collapsed));
  if (S.sel?.file === fi) clearSel();
  placeholder(fi);
  if (!r.collapsed) {
    if (S.observer) S.observer.observe(S.fileNodes[fi].root);
    else renderFileBody(fi);
  }
}

/** Lazy rendering: a file's hunks are drawn when it nears the viewport. */
function observeFiles() {
  const IO = globalThis.IntersectionObserver;
  if (typeof IO !== 'function') {
    S.fileNodes.forEach((n, fi) => { if (n && !n.rendered && !S.rows[fi].collapsed) renderFileBody(fi); });
    return;
  }
  const obs = new IO((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const fi = Number(e.target.dataset.f);
      obs.unobserve(e.target);
      if (S && S.observer === obs && S.fileNodes[fi] && !S.fileNodes[fi].rendered && !S.rows[fi].collapsed) renderFileBody(fi);
    }
  }, { rootMargin: '800px 0px' });
  S.observer = obs;
  S.fileNodes.forEach((n, fi) => { if (n && !n.rendered && !S.rows[fi].collapsed) obs.observe(n.root); });
}

function codeNodes(text, lang) {
  const frag = dvEl('span', 'dv-code');
  for (const tok of tokenize(text, lang)) {
    if (tok.k) frag.append(dvEl('span', `hl-${tok.k}`, tok.s));
    else frag.append(document.createTextNode(tok.s));
  }
  return frag;
}

const ROW_CLASS = { '+': 'dv-add', '-': 'dv-del', ' ': 'dv-ctx', '\\': 'dv-eof' };
const SIGN = { '+': '+', '-': '−', ' ': ' ', '\\': '\\' };

function renderFileBody(fi) {
  const f = S.diff.files[fi];
  const node = S.fileNodes[fi];
  if (!node) return;
  if (S.rows[fi].collapsed) { placeholder(fi); return; }
  if (f.binary || f.deferred || !Array.isArray(f.hunks) || !f.hunks.length) { placeholder(fi); return; }
  node.body.textContent = '';
  node.rowNodes = [];
  const lang = langOf(f.path);
  const rows = rowsOf(fi);
  const byRow = new Map();
  const loose = [];
  for (const d of S.drafts) {
    if (d.path !== f.path && d.path !== f.oldPath) continue;
    const at = anchorRow(rows, d);
    if (at < 0) loose.push(d);
    else { if (!byRow.has(at)) byRow.set(at, []); byRow.get(at).push(d); }
  }
  for (const d of loose) node.body.append(draftNode(d, 'not on a line of this diff'));
  rows.forEach((r, i) => {
    let row;
    if (r.kind === 'hunk') {
      row = dvEl('div', 'dv-row dv-hunk');
      row.append(dvEl('span', 'dv-hh', r.s));
    } else {
      row = dvEl('div', `dv-row ${ROW_CLASS[r.t]}`);
      const no = dvEl('button', 'dv-no');
      no.type = 'button';
      no.dataset.r = String(i);
      no.append(dvEl('span', 'dv-o', r.o ?? ''), dvEl('span', 'dv-n', r.n ?? ''));
      if (r.t === '\\') no.disabled = true;
      else no.setAttribute('aria-label', `line ${r.t === '-' ? `old ${r.o}` : `${r.n}`}`);
      row.append(no, dvEl('span', 'dv-sign', SIGN[r.t]), r.t === '\\' ? dvEl('span', 'dv-code', r.s) : codeNodes(r.s, lang));
    }
    row.dataset.r = String(i);
    node.rowNodes[i] = row;
    node.body.append(row);
    for (const d of byRow.get(i) ?? []) node.body.append(draftNode(d, null));
  });
  if (f.truncated) node.body.append(dvEl('p', 'dv-msg', 'File cut at the per-file cap.'));
  node.rendered = true;
}

function draftNode(d, note) {
  const box = dvEl('div', 'dv-cmt');
  const head = dvEl('div', 'dv-cmt-h');
  const range = d.endLine > d.line ? `${d.line}-${d.endLine}` : `${d.line}`;
  head.append(dvEl('span', 'dv-path', `${d.path}:${range}${d.side === 'old' ? ' (old)' : ''}`));
  if (note) head.append(dvEl('span', 'dv-cmt-note', note));
  head.append(button('Delete', '', () => {
    S.drafts = S.drafts.filter((x) => x !== d);
    persist();
    render();
  }));
  box.append(head, dvEl('div', 'dv-cmt-b', d.body));
  return box;
}

function persist() {
  if (!S || !S.key) return;
  const sha = S.draftsSha || String(S.diff?.headSha ?? '');
  if (sha) saveDrafts(storage(), S.key, sha, S.drafts);
  renderHead();
}

// ---- selection and the inline editor -----------------------------------------

function clearSel() {
  if (!S?.sel) return;
  const node = S.fileNodes[S.sel.file];
  for (let i = S.sel.a; i <= S.sel.b; i++) node?.rowNodes[i]?.classList.remove('dv-sel');
  S.sel = null;
  if (S.selBtn) { S.selBtn.remove(); S.selBtn = null; }
}

function showSel() {
  const node = S.fileNodes[S.sel.file];
  for (let i = S.sel.a; i <= S.sel.b; i++) node?.rowNodes[i]?.classList.add('dv-sel');
  const last = node?.rowNodes[S.sel.b];
  if (!last) return;
  const b = button('Comment (c)', 'dv-cbtn', () => openEditor());
  S.selBtn = b;
  last.append(b);
}

function onMainClick(e) {
  const no = e.target?.closest?.('.dv-no');
  if (!no || no.disabled) return;
  const sec = no.closest('.dv-file');
  const fi = Number(sec?.dataset.f);
  const row = Number(no.dataset.r);
  if (!Number.isInteger(fi) || !Number.isInteger(row)) return;
  const next = selectLine(S.sel, { file: fi, row, shift: e.shiftKey });
  clearSel();
  S.sel = next;
  showSel();
}

function onKey(e) {
  if (!S || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target?.matches?.('input, textarea, select')) return;
  if (e.key === 'c' && S.sel) { e.preventDefault(); e.stopPropagation(); openEditor(); }
  else if (e.key === 'Escape' && (S.sel || S.editor)) { closeEditor(); clearSel(); }
}

function closeEditor() {
  if (S?.editor) { S.editor.remove(); S.editor = null; }
}

function openEditor() {
  if (!S?.sel) return;
  closeEditor();
  const { file: fi, a, b } = S.sel;
  const f = S.diff.files[fi];
  const anchor = anchorFor(f, rowsOf(fi), a, b);
  if (!anchor) return;
  if (S.drafts.length >= MAX_COMMENTS) { S.banners.append(dvEl('p', 'dv-banner dv-warn', `At most ${MAX_COMMENTS} comments per review.`)); return; }
  const box = dvEl('div', 'dv-edit');
  const range = anchor.endLine > anchor.line ? `${anchor.line}-${anchor.endLine}` : `${anchor.line}`;
  box.append(dvEl('div', 'dv-cmt-h', `${anchor.path}:${range}${anchor.side === 'old' ? ' (old)' : ''}`));
  const ta = dvEl('textarea', 'dv-ta');
  ta.rows = 3;
  ta.maxLength = MAX_BODY_CHARS;
  ta.setAttribute('aria-label', 'Comment');
  const save = button('Save draft', 'btn--primary', () => {
    const body = ta.value.trim();
    if (!body) { ta.focus(); return; }
    const d = cleanDraft({ ...anchor, body });
    if (!d) return;
    if (!S.draftsSha) S.draftsSha = String(S.diff.headSha ?? '');
    S.drafts.push(d);
    persist();
    closeEditor();
    clearSel();
    renderFileBody(fi);
  });
  const cancel = button('Cancel', '', () => { closeEditor(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save.click(); }
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
  });
  const btns = dvEl('div', 'dv-edit-b');
  btns.append(cancel, save);
  box.append(ta, btns);
  const last = S.fileNodes[fi].rowNodes[b];
  last.after(box);
  S.editor = box;
  ta.focus();
}

// ---- the send sheet ------------------------------------------------------------

function openSendSheet() {
  if (!S?.diff) return;
  S.sheet?.remove();
  const lane = laneOf(S.key);
  const sheet = dvEl('div', 'dv-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Send review');
  const title = dvEl('h3', 'dv-sub', `Send review to ${S.laneId}`);
  const noteLab = dvEl('label', 'dv-note');
  noteLab.append(dvEl('span', 'dv-msg', 'Note (optional)'));
  const note = dvEl('textarea', 'dv-ta');
  note.rows = 2;
  note.maxLength = MAX_NOTE_CHARS;
  note.value = S.note ?? '';
  noteLab.append(note);
  sheet.append(title, noteLab);
  const pre = dvEl('pre', 'dv-pre');
  const status = dvEl('p', 'dv-msg');
  const cancel = button('Cancel', '', () => { sheet.remove(); S.sheet = null; });
  const send = button('Send', 'btn--primary', () => doSend(lane, send, status));
  const refresh = () => {
    S.note = note.value;
    const r = reviewText({ branch: lane?.branch ?? S.laneId, diff: S.diff, drafts: S.drafts, note: note.value });
    pre.textContent = r.text ?? '';
    status.textContent = r.error ?? `${S.drafts.length} comment${S.drafts.length === 1 ? '' : 's'}, ${(r.text ?? '').length} characters. This exact text is typed into the lane's session.`;
    status.classList.toggle('dv-err', Boolean(r.error));
    send.disabled = Boolean(r.error) || S.sending;
  };
  note.addEventListener('input', refresh);
  const btns = dvEl('div', 'dv-edit-b');
  btns.append(cancel, send);
  sheet.append(pre, status, btns);
  S.sheet = sheet;
  S.panel.root.append(sheet);
  refresh();
}

async function doSend(lane, sendBtn, status) {
  if (!S || S.sending) return;
  const key = S.key;
  const r = reviewText({ branch: lane?.branch ?? S.laneId, diff: S.diff, drafts: S.drafts, note: S.note });
  if (r.error) { status.textContent = r.error; return; }
  const args = reviewArgs(S.diff, S.drafts, S.note);
  const n = args.review.comments.length;
  const ok = await confirmAction({
    action: 'send-review',
    targets: [key],
    consequence: [`Types a review with ${n} comment${n === 1 ? '' : 's'} into ${S.laneId}'s session.`, 'Long reviews go to a file in the lane directory and only a pointer is typed.'],
  });
  if (!ok?.ok || !S || S.key !== key) return;
  S.sending = true;
  sendBtn.disabled = true;
  status.textContent = 'Sending…';
  const res = await act(key, 'send-review', args);
  if (!S || S.key !== key) return;
  S.sending = false;
  if (res?.ok === true) {
    S.drafts = [];
    S.note = '';
    persist();
    S.sheet?.remove();
    S.sheet = null;
    render();
    const inline = res.result?.inline ?? res.inline;
    S.banners.append(dvEl('p', 'dv-banner', inline === false ? 'Review sent (written to a file; a pointer was typed).' : 'Review sent.'));
  } else if (res?.ok === 'unknown') {
    status.textContent = 'Sent, outcome unknown. Check the session before sending again.';
  } else {
    sendBtn.disabled = false;
    status.textContent = `Not sent: ${String(res?.error ?? 'error')}`;
    status.classList.add('dv-err');
  }
}

// ---------------------------------------------------------------------------
// The view

function laneFromRoute(route) {
  const sel = route?.sel;
  const p = parseFkey(sel);
  if (!p || p.name.includes('/') || isDotSegment(p.name)) return null;
  return { key: sel, builder: p.builder, laneId: p.name };
}

function mountView(el, ctx = {}) {
  if (!el) return;
  el.textContent = '';
  const p = panel({ name: 'DIFF', scope: diffScope(ctx.route) });
  el.append(p.root);
  const lane = laneFromRoute(ctx.route);
  let hash = '';
  try { hash = globalThis.location?.hash ?? ''; } catch { /* no location */ }
  S = {
    el, panel: p, key: lane?.key ?? null, builder: lane?.builder ?? null, laneId: lane?.laneId ?? null,
    base: baseFromHash(hash), mode: 'all', diff: null, rows: [], flat: new Map(), err: null, loading: false,
    drafts: [], draftsSha: null, stale: false, note: '', sel: null, selBtn: null, editor: null,
    sheet: null, sending: false, fileNodes: [], observer: null, seq: 0, banners: null, pullNode: null,
  };
  el.addEventListener('keydown', onKey);
  render();
  if (S.key) load();
}

function teardown() {
  if (!S) return null;
  const el = S.el;
  if (S.observer) { try { S.observer.disconnect(); } catch { /* gone */ } }
  el.removeEventListener('keydown', onKey);
  S = null;
  return el;
}

export default {
  id: 'diff',
  icon: 'review',
  title: 'Diff',
  /** Render the panel into the view's section; fetch the diff when the route names a lane. */
  mount: (el, ctx = {}) => mountView(el, ctx),
  unmount: () => {
    const el = teardown();
    if (el) el.textContent = '';
  },
  /** Store ticks change nothing (the diff is fetched on demand); another lane in the route starts over. */
  update: (_store, ctx = {}) => {
    if (!S || !ctx.route) return;
    const lane = laneFromRoute(ctx.route);
    if ((lane?.key ?? null) === S.key) return;
    const el = teardown();
    mountView(el, ctx);
  },
};
