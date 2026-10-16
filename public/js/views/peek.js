// The PEEK inspector tab (fleet plan §10 2.12, R12), plus the small DIFF tab
// that links to the Diff view (§10 R11).
//
//   top      the pane tail: the last 40 lines from
//              builder  GET /api/v1/sessions/:name/preview?n=40
//              hub      GET /api/fleet/:builder/v1/sessions/:name/preview?n=40
//            polled every 2 s while the page is visible, rendered by
//            core/ansi.js previewToNodes (SGR -> spans, textContent only). An
//            older builder without the route falls back to the store's
//            previewLines.
//   middle   the transcript tail: GET .../sessions/:name/transcript (R4's
//            tailTranscript via R7's route). The first read is the backward
//            tail; it then polls `after=endOffset` every 3 s, and "Older"
//            fetches `before=startOffset`. Rows come from the pure
//            core/transcript-rows.js.
//   bottom   the reply box: `send-text` with `guardPrompt: true` (the builder
//            refuses 409 `prompting` when typing would answer a menu), after a
//            verb + Cancel confirm showing the exact text. Quick buttons:
//            `continue`, `/compact` (send-text, guarded) and Esc (send-keys
//            Escape). "Terminal" opens L4 through the inspector's openTerminal.
//
// Opening the tab on the hub sends `{type:'touch', fkey, how:'peek'}` (README
// §3.4; `peek` is one of §7 O10's HOWS) so the review-wait timer records it.
//
// Everything shown here (pane text, transcript, tool names, error strings) is
// untrusted builder text: it reaches the page through textContent and
// setAttribute only. Pure at import time: init() registers the tabs, and DOM
// work happens only inside mount(). The pure helpers are exported for
// test/transcript-rows.test.mjs.
import { el } from '../core/dom.js';
import { previewToNodes } from '../core/ansi.js';
import { isDotSegment } from '../core/actions.js';
import { BUILDER_ID_RX, fkey as makeFkey, parseFkey } from '../core/keys.js';
import { formatHash } from '../core/router.js';
import { currentSource } from '../core/net.js';
import { rowsFor, mergeTail, emptyTail, timeOf } from '../core/transcript-rows.js';
import { registerTab, resolveSel, touchMessage } from '../ui/inspector.js';
import { confirmAction } from '../ui/confirm.js';
import { toast } from '../ui/toast.js';

export const PREVIEW_N = 40;
export const PREVIEW_MS = 2000;
export const TRANSCRIPT_MS = 3000;
/** Entries asked for per page (the builder caps it at transcript.maxEntries). */
export const PAGE_LIMIT = 50;
/** send-text's args.text cap (server/fleet/builtin-actions.mjs). */
export const REPLY_MAX = 8000;
export const TOUCH_HOW_PEEK = 'peek';

/** The quick buttons (the QUICK_KEYS semantics of the old app.js). */
export const QUICK = Object.freeze([
  Object.freeze({ id: 'continue', label: 'continue', action: 'send-text', args: Object.freeze({ text: 'continue', guardPrompt: true }) }),
  Object.freeze({ id: 'compact', label: '/compact', action: 'send-text', args: Object.freeze({ text: '/compact', guardPrompt: true }) }),
  Object.freeze({ id: 'esc', label: 'Esc', action: 'send-keys', args: Object.freeze({ keys: Object.freeze(['Escape']) }) }),
]);

const PREVIEW_LINE_MAX = 2000;

// ---------------------------------------------------------------- pure

/**
 * What the tab talks to for `sel` in store `s`: {fkey, key, name, builder,
 * hub, laneKey} or null when no session can be named. `key` is the store
 * index key act() takes; `fkey` is the fleet key the touch carries. Pure.
 */
export function peekTarget(s, sel) {
  if (!s || typeof sel !== 'string' || sel === '') return null;
  const r = resolveSel(s, sel);
  const hub = s.source?.kind === 'hub';
  const sess = r.session;
  const name = typeof sess?.name === 'string' ? sess.name : null;
  if (!name) return null;
  const builder = typeof sess.builder === 'string' ? sess.builder : r.builder;
  const laneKey = r.lane?.key ?? sess.laneKey ?? null;
  const fkey = typeof sess.key === 'string' && parseFkey(sess.key) ? sess.key
    : (builder && BUILDER_ID_RX.test(builder) ? makeFkey(builder, name) : r.key);
  return { fkey, key: r.sessionKey ?? r.key, name, builder: builder ?? null, hub, laneKey };
}

const safeName = (n) => typeof n === 'string' && n !== '' && n.length <= 200 && !n.includes('/') && !isDotSegment(n);

/**
 * The URL of a session read (`kind` 'preview' | 'transcript') on the builder
 * or the hub's read proxy, or null when it cannot be addressed. `query` is a
 * plain object; only finite non-negative integers pass. Pure.
 */
export function sessionUrl({ hub = false, builder = null, name, kind, query = {} } = {}) {
  if (kind !== 'preview' && kind !== 'transcript') return null;
  if (!safeName(name)) return null;
  const enc = encodeURIComponent;
  let url;
  if (hub) {
    if (typeof builder !== 'string' || !BUILDER_ID_RX.test(builder)) return null;
    url = `/api/fleet/${enc(builder)}/v1/sessions/${enc(name)}/${kind}`;
  } else {
    url = `/api/v1/sessions/${enc(name)}/${kind}`;
  }
  const qs = [];
  for (const k of ['n', 'after', 'before', 'limit']) {
    const v = query?.[k];
    if (Number.isSafeInteger(v) && v >= 0) qs.push(`${k}=${v}`);
  }
  return qs.length ? `${url}?${qs.join('&')}` : url;
}

/** The send-text args for a reply, or null when there is nothing to send. Pure. */
export function replyArgs(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!t.trim() || t.length > REPLY_MAX) return null;
  return { text: t, guardPrompt: true };
}

/** A failed act() result -> one short sentence for the operator. Pure. */
export function refusalText(res) {
  const code = res?.code;
  if (code === 'prompting') return 'The session is on a prompt; answer it first.';
  if (code === 'paused') return 'The session is paused.';
  if (code === 'not_claude') return 'This is not a live Claude session.';
  if (code === 'no_pane') return 'The session has no pane.';
  if (res?.ok === 'unknown') return 'No answer in time; it may still arrive.';
  const e = typeof res?.error === 'string' && res.error ? res.error : 'failed';
  return `Not sent: ${e.slice(0, 200)}`;
}

/** The Diff view hash for a lane fleet key, or null. Pure. */
export function diffHref(laneKey) {
  const p = parseFkey(laneKey);
  if (!p || p.name.includes('/') || isDotSegment(p.name)) return null;
  return formatHash({ view: 'diff', sel: laneKey });
}

/** Preview response -> its lines (strings, capped), or null for a bad body. Pure. */
export function previewLinesOf(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.lines)) return null;
  return body.lines.slice(-PREVIEW_N).map((l) => String(l ?? '').slice(0, PREVIEW_LINE_MAX));
}

// ---------------------------------------------------------------- DOM

function peekButton(text, cls, onClick, title = null) {
  const b = el('button', cls ? `btn btn--s ${cls}` : 'btn btn--s', text);
  b.type = 'button';
  if (title) b.title = title;
  b.onclick = onClick;
  return b;
}

async function peekJson(fetchImpl, url) {
  let r;
  try {
    r = await fetchImpl(url, { headers: { 'x-laneboard': '1', accept: 'application/json' } });
  } catch (err) {
    return { error: err?.message || 'network error', status: 0 };
  }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) return { error: (j && typeof j.error === 'string' && j.error) || `HTTP ${r.status}`, status: r.status };
  if (!j || typeof j !== 'object') return { error: 'unexpected response', status: r.status };
  return { data: j };
}

const pageHidden = () => {
  try { return globalThis.document?.visibilityState === 'hidden'; } catch { return false; }
};

/**
 * Build the PEEK tab into `host` for `sel`. `ctx` is the inspector's tab ctx
 * ({store, act, openTerminal, ...}); tests add `fetch`, `confirm`, `toast`,
 * `send` (the touch), `every` (timer factory; return a stop function) and
 * `doc`. Returns a controller: {refreshPreview, refreshTranscript, older,
 * sendReply, quick, stop, state}.
 */
export function mountPeek(host, sel, ctx = {}) {
  const s = ctx.store;
  const doc = ctx.doc ?? globalThis.document;
  const fetchImpl = ctx.fetch ?? ((u, i) => globalThis.fetch(u, i));
  const ask = ctx.confirm ?? confirmAction;
  const say = ctx.toast ?? toast;
  const every = ctx.every ?? ((fn, ms) => { const t = setInterval(fn, ms); return () => clearInterval(t); });
  const later = ctx.later ?? ((fn, ms) => setTimeout(fn, ms));
  const send = ctx.send ?? ((msg) => currentSource()?.send?.(msg));
  const target = peekTarget(s, sel);

  host.textContent = '';
  const root = el('div', 'insp-ovw peek');
  host.append(root);
  if (!target) {
    root.append(el('p', 'insp-empty', 'No session to peek at for this selection.'));
    return { stop: () => {}, state: null };
  }

  const st = {
    target,
    tail: emptyTail(),
    previewLines: null,
    previewErr: null,
    txErr: null,
    txStopped: false,
    busy: { preview: false, tx: false, older: false, send: false },
    stops: [],
    stopped: false,
  };

  // --- layout
  const prevBox = el('div', 'insp-preview peek-preview');
  prevBox.setAttribute('aria-label', 'Pane tail');
  const prevNote = el('p', 'insp-empty peek-note');
  prevNote.hidden = true;

  const txHead = el('div', 'insp-row peek-txhead');
  const olderBtn = peekButton('Older', 'peek-older', () => { older(); }, 'Load older transcript entries');
  olderBtn.hidden = true;
  txHead.append(el('span', 'insp-k', 'TRANSCRIPT'), olderBtn);
  const txBox = el('div', 'peek-tx');
  txBox.setAttribute('aria-label', 'Transcript tail');
  txBox.setAttribute('aria-live', 'off');
  const txNote = el('p', 'insp-empty peek-note');
  txNote.hidden = true;

  const form = el('div', 'peek-reply');
  const box = el('textarea', 'peek-input');
  box.setAttribute('aria-label', `Reply to ${target.name}`);
  box.setAttribute('rows', '2');
  box.setAttribute('maxlength', String(REPLY_MAX));
  box.placeholder = 'Reply…';
  const sendBtn = peekButton('Send', 'btn--primary peek-send', () => { sendReply(); }, 'Type this into the session');
  const quickRow = el('div', 'peek-quick');
  for (const q of QUICK) quickRow.append(peekButton(q.label, 'peek-q', () => { quick(q.id); }, `${q.action} ${q.label}`));
  if (typeof ctx.openTerminal === 'function' && target.key) {
    quickRow.append(peekButton('Terminal', 'peek-term', () => { ctx.openTerminal(target.key); }, 'Open the terminal'));
  }
  const status = el('p', 'peek-status');
  status.setAttribute('role', 'status');
  form.append(box, sendBtn, quickRow, status);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault?.(); sendReply(); }
  });

  root.append(prevBox, prevNote, txHead, txBox, txNote, form);

  // --- render
  function renderPreview() {
    let lines = st.previewLines;
    if (!lines) {
      const sess = s?.sessions?.get?.(target.key);
      lines = Array.isArray(sess?.previewLines) ? sess.previewLines.slice(-PREVIEW_N) : [];
    }
    prevBox.textContent = '';
    prevBox.append(...previewToNodes(lines, doc, 80));
    prevNote.hidden = !st.previewErr;
    prevNote.textContent = st.previewErr ? `Pane: ${st.previewErr}` : '';
  }

  function renderTranscript() {
    const atBottom = !(txBox.scrollHeight > 0) || txBox.scrollTop + txBox.clientHeight >= txBox.scrollHeight - 8;
    txBox.textContent = '';
    for (const r of rowsFor(st.tail.entries)) {
      const row = el('div', `peek-row peek-${r.cls}${r.truncated ? ' is-cut' : ''}`);
      row.dataset.kind = r.cls;
      const label = el('span', 'insp-tname peek-label', r.label);
      const t = timeOf(r.ts);
      if (t) label.title = t;
      row.append(label, el('span', r.cls === 'user' ? 'insp-say insp-say-user peek-text' : 'insp-say peek-text', r.text));
      txBox.append(row);
    }
    olderBtn.hidden = !st.tail.hasOlder;
    const empty = !st.tail.entries.length && !st.txErr;
    txNote.hidden = !st.txErr && !empty;
    txNote.textContent = st.txErr ? `Transcript: ${st.txErr}` : empty ? 'No transcript entries yet.' : '';
    if (atBottom && txBox.scrollHeight > 0) txBox.scrollTop = txBox.scrollHeight;
  }

  // --- reads
  async function refreshPreview() {
    if (st.stopped || st.busy.preview) return;
    const url = sessionUrl({ hub: target.hub, builder: target.builder, name: target.name, kind: 'preview', query: { n: PREVIEW_N } });
    if (!url) { st.previewErr = 'cannot be addressed'; renderPreview(); return; }
    st.busy.preview = true;
    try {
      const res = await peekJson(fetchImpl, url);
      if (st.stopped) return;
      const lines = res.data ? previewLinesOf(res.data) : null;
      st.previewLines = lines;
      st.previewErr = lines ? null : res.status === 404 ? null : (res.error ?? 'bad response');
      renderPreview();
    } finally {
      st.busy.preview = false;
    }
  }

  async function readTranscript(dir) {
    const q = { limit: PAGE_LIMIT };
    if (dir === 'after') q.after = st.tail.endOffset;
    if (dir === 'before') q.before = st.tail.startOffset;
    const url = sessionUrl({ hub: target.hub, builder: target.builder, name: target.name, kind: 'transcript', query: q });
    if (!url) return { error: 'cannot be addressed', status: 400 };
    return peekJson(fetchImpl, url);
  }

  async function refreshTranscript() {
    if (st.stopped || st.busy.tx || st.txStopped) return;
    st.busy.tx = true;
    try {
      const dir = st.tail.endOffset == null ? 'tail' : 'after';
      let res = await readTranscript(dir);
      if (st.stopped) return;
      if (res.data?.reset === true) {
        st.tail = emptyTail();
        res = await readTranscript('tail');
        if (st.stopped) return;
      }
      if (res.data) {
        const before = st.tail.entries.length;
        st.tail = mergeTail(st.tail, res.data, st.tail.endOffset == null ? 'tail' : 'after');
        const changed = st.txErr !== null || st.tail.entries.length !== before || dir === 'tail';
        st.txErr = null;
        if (changed) renderTranscript();
      } else {
        st.txErr = res.error ?? 'failed';
        // A 4xx (no transcript, unknown session, old builder) will not fix
        // itself in 3 s: stop polling until the tab is opened again.
        if (res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 429) st.txStopped = true;
        renderTranscript();
      }
    } finally {
      st.busy.tx = false;
    }
  }

  async function older() {
    if (st.stopped || st.busy.older || !st.tail.hasOlder) return;
    st.busy.older = true;
    try {
      const res = await readTranscript('before');
      if (st.stopped) return;
      if (res.data && res.data.reset !== true) {
        const keep = Math.max(st.tail.entries.length + PAGE_LIMIT, 400);
        st.tail = mergeTail(st.tail, res.data, 'before', keep);
        renderTranscript();
      } else if (res.error) {
        status.textContent = `Older: ${String(res.error).slice(0, 200)}`;
      }
    } finally {
      st.busy.older = false;
    }
  }

  // --- writes
  async function run(action, args, label) {
    if (st.busy.send) return null;
    st.busy.send = true;
    sendBtn.disabled = true;
    try {
      const actFn = ctx.act;
      if (typeof actFn !== 'function') return null;
      const res = await actFn(target.key, action, args);
      if (st.stopped) return res;
      if (res && res.ok === true) {
        status.textContent = `Sent ${label}.`;
        later(() => { refreshPreview(); }, 300);
      } else {
        const msg = refusalText(res);
        status.textContent = msg;
        try { say(msg, { kind: 'err' }); } catch { /* no toast host */ }
      }
      return res;
    } finally {
      st.busy.send = false;
      sendBtn.disabled = false;
    }
  }

  async function sendReply() {
    const args = replyArgs(box.value);
    if (!args) {
      status.textContent = box.value.length > REPLY_MAX ? `Too long (max ${REPLY_MAX} characters).` : 'Nothing to send.';
      return null;
    }
    const c = await ask({
      action: 'send-text',
      targets: [target.fkey],
      tier: 'ask',
      consequence: [`Type into ${target.name} and press Enter:`, args.text],
    });
    if (!c?.ok || st.stopped) return null;
    const res = await run('send-text', args, 'the reply');
    if (res?.ok === true) box.value = '';
    return res;
  }

  function quick(id) {
    const q = QUICK.find((x) => x.id === id);
    if (!q) return null;
    const args = q.action === 'send-keys' ? { keys: [...q.args.keys] } : { ...q.args };
    return run(q.action, args, q.label);
  }

  function stop() {
    st.stopped = true;
    for (const f of st.stops.splice(0)) { try { f(); } catch { /* gone */ } }
  }

  // --- start
  renderPreview();
  renderTranscript();
  if (target.hub && parseFkey(target.fkey)) {
    try { send(touchMessage(target.fkey, TOUCH_HOW_PEEK)); } catch { /* best effort */ }
  }
  st.stops.push(every(() => { if (!pageHidden()) refreshPreview(); }, PREVIEW_MS));
  st.stops.push(every(() => { if (!pageHidden()) refreshTranscript(); }, TRANSCRIPT_MS));
  refreshPreview();
  refreshTranscript();

  return { refreshPreview, refreshTranscript, older, sendReply, quick, stop, state: st, input: box };
}

/** The DIFF tab body: a link to `#/diff?sel=<lane fkey>`. */
export function mountDiffLink(host, sel, ctx = {}) {
  host.textContent = '';
  const root = el('div', 'insp-ovw peek-diff');
  host.append(root);
  const r = ctx.store ? resolveSel(ctx.store, sel) : null;
  const laneKey = r?.lane?.key ?? r?.session?.laneKey ?? null;
  const href = laneKey ? diffHref(laneKey) : null;
  if (!href) {
    root.append(el('p', 'insp-empty', 'No lane, so no diff, for this selection.'));
    return null;
  }
  const a = el('a', 'btn btn--s peek-difflink', 'Open diff review');
  a.setAttribute('href', href);
  root.append(el('p', 'insp-empty', `Lane ${laneKey}: file list, unified diff and line comments.`), a);
  return href;
}

// ---------------------------------------------------------------- tabs

let live = null;
let unregister = null;

export const peekTab = Object.freeze({
  id: 'peek',
  title: 'Peek',
  long: 'Peek & reply',
  mount: (host, sel, ctx) => {
    live?.stop();
    live = mountPeek(host, sel, ctx);
  },
  unmount: () => {
    live?.stop();
    live = null;
  },
  // The polls keep it current; nothing to do on a store tick.
  update: () => {},
});

export const diffTab = Object.freeze({
  id: 'diff',
  title: 'Diff',
  long: 'Diff review',
  mount: (host, sel, ctx) => { mountDiffLink(host, sel, ctx); },
  unmount: () => {},
});

/** Register PEEK and DIFF with the inspector. Idempotent; returns an unregister function. */
export function init() {
  if (unregister) return unregister;
  const offs = [registerTab(peekTab), registerTab(diffTab)];
  unregister = () => { offs.forEach((f) => f()); unregister = null; };
  return unregister;
}
