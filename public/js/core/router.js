// Views and the hash router. Moved from public/app.js (fleet F1); router v1
// (fleet F8a, plan §1 2.5; §4 D4 extends it and flips DEFAULT_VIEW to map).
//
// Grammar: #/<view>?b=<builderId|all>&s=<state filter>&q=<query>&sel=<fkey>&open=<term|transcript>
// Legacy forms keep working, because old push notifications already sit in
// notification centres: `#board`, `#map`, ... map to the view, and
// `#session=<name>` becomes {view:'board', sel: fkey(localId, name), open:'term'}.
//
// A route only selects and filters. Nothing parsed from a hash or URL ever
// dispatches an action (security review S20): this module does not import
// core/actions.js, and applyHash() only shows a view and opens the sheet.
import { $ } from './dom.js';
import { BUILDER_ID_RX, fkey, isFkey } from './keys.js';
import { localBuilderId, store, toIndexKey } from './store.js';
import { scheduleVisible } from './net.js';
import { fitAll } from '../ui/terminal.js';
import { openSheet } from '../ui/sheet.js';
import { loadMorning } from '../views/morning.js';
import { loadCredit } from '../views/credit.js';
import { renderBox } from '../views/box.js';
import { showMap } from '../views/map.js';

// ---------------------------------------------------------------- views
//
// One page, hash-routed. The Board keeps every behaviour it had; the others
// are sections that are simply hidden. Nothing is torn down when a view is
// hidden, so switching back is instant and the terminals in the dock survive —
// but an IntersectionObserver reports a display:none subtree as off-screen, so
// the capture-pane rate drops on its own while you are elsewhere.
// A view the page has no section for yet (inbox, packages, audit, diff until
// §4 D4 adds them) lands on the default view, as a stale #machine always did.
export const VIEWS = ['map', 'board', 'inbox', 'packages', 'morning', 'credit', 'box', 'audit'];
/** Drill-down views: routable, never in the nav. */
export const HIDDEN_VIEWS = ['diff'];
export const DEFAULT_VIEW = 'board';
export const VIEW_KEYS = { b: 'board', m: 'morning', c: 'credit', x: 'box', p: 'map' };
export const OPEN_KINDS = ['term', 'transcript'];

const ROUTABLE = new Set([...VIEWS, ...HIDDEN_VIEWS]);
const STATE_RX = new RegExp('^[a-z0-9_-]{1,24}(?:,[a-z0-9_-]{1,24}){0,15}$');
// eslint-disable-next-line no-control-regex
const CONTROL_RX = /[\u0000-\u001f\u007f]/;
const MAX_Q = 200;
const MAX_SEL = 300;

function safeDecode(v) {
  try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return null; }
}

/** An empty route on `view`: every parameter null. */
export function emptyRoute(view = DEFAULT_VIEW) {
  return { view, b: null, s: null, q: null, sel: null, open: null };
}

/** The query part (no `?`) -> {key: decoded value}; the first of a repeated key wins. */
function parseQuery(qs) {
  const out = {};
  for (const part of qs.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    if (Object.prototype.hasOwnProperty.call(out, k)) continue;
    const v = safeDecode(i < 0 ? '' : part.slice(i + 1));
    if (v !== null) out[k] = v;
  }
  return out;
}

/**
 * A hash (with or without the leading '#') -> {view, b, s, q, sel, open}.
 * Values that do not fit their parameter are dropped (null); an unknown view
 * becomes DEFAULT_VIEW. `localId` is the local builder, for `#session=`.
 */
export function parseHash(h, { localId } = {}) {
  const raw = String(h ?? '').replace(/^#/, '');
  const legacy = /^session=(.+)$/.exec(raw);
  if (legacy) {
    const name = safeDecode(legacy[1]);
    const r = emptyRoute('board');
    if (name && !CONTROL_RX.test(name) && !name.includes('/') && BUILDER_ID_RX.test(localId ?? '')) {
      r.sel = fkey(localId, name);
      r.open = 'term';
    }
    return r;
  }
  if (!raw.startsWith('/')) return emptyRoute(ROUTABLE.has(raw) ? raw : DEFAULT_VIEW);

  const qAt = raw.indexOf('?');
  const path = (qAt < 0 ? raw : raw.slice(0, qAt)).replace(/^\/+|\/+$/g, '');
  const r = emptyRoute(ROUTABLE.has(path) ? path : DEFAULT_VIEW);
  const p = parseQuery(qAt < 0 ? '' : raw.slice(qAt + 1));
  if (p.b === 'all' || BUILDER_ID_RX.test(p.b ?? '')) r.b = p.b;
  if (STATE_RX.test(p.s ?? '')) r.s = p.s;
  if (typeof p.q === 'string' && p.q !== '' && !CONTROL_RX.test(p.q)) r.q = p.q.slice(0, MAX_Q);
  if (typeof p.sel === 'string' && p.sel.length <= MAX_SEL && !CONTROL_RX.test(p.sel) && isFkey(p.sel)) r.sel = p.sel;
  if (OPEN_KINDS.includes(p.open)) r.open = p.open;
  return r;
}

/** A route -> its hash. Null/empty parameters are left out. */
export function formatHash(r = {}) {
  const view = ROUTABLE.has(r.view) ? r.view : DEFAULT_VIEW;
  const parts = [];
  for (const k of ['b', 's', 'q', 'sel', 'open']) {
    const v = r[k];
    if (v === null || v === undefined || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return `#/${view}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/** The current route, parsed against the store's local builder. */
export function currentRoute() {
  return parseHash(location.hash, { localId: localBuilderId(store) });
}

/** The view this page can actually show for `name`. */
function shownView(name) {
  return ROUTABLE.has(name) && $(`view-${name}`) ? name : DEFAULT_VIEW;
}

export function setView(name, { pushHash = true } = {}) {
  const view = shownView(name);
  store.view = view;
  for (const v of ROUTABLE) {
    const node = $(`view-${v}`);
    if (node) node.hidden = v !== view;
  }
  for (const btn of document.querySelectorAll('.view-tab, .tab')) {
    btn.classList.toggle('on', btn.dataset.view === view);
  }
  if (pushHash && !store.openSession) {
    // Keep the filters (b, s, q); a view switch drops the selection.
    const cur = currentRoute();
    const want = formatHash({ ...cur, view, sel: null, open: null });
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  if (view === 'morning') loadMorning();
  if (view === 'credit') loadCredit();
  if (view === 'box') renderBox();
  if (view === 'map') showMap();
  scheduleVisible();
  fitAll();
}

/**
 * One route parser for the load path and for hashchange. A selected session
 * (`sel`, or the push notification's legacy `#session=`) on the Board, or with
 * `open=term`, opens the sheet, whatever view was last shown. Routes only
 * select: no action is ever sent from here.
 */
export function applyHash() {
  const r = currentRoute();
  const key = r.sel ? toIndexKey(store, r.sel) : null;
  if (key && (r.open === 'term' || r.view === 'board')) {
    setView('board', { pushHash: false });
    openSheet(key);
    return;
  }
  setView(r.view, { pushHash: false });
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('hashchange', applyHash);
}
