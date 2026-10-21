// Views and the hash router. Moved from public/app.js (fleet F1); router v1
// (fleet F8a, plan §1 2.5), extended by §4 D4: the Map is home (DEFAULT_VIEW),
// views mount through the registry (views/index.js), and navigate/onRoute/
// current give the shell and later views one way to move.
//
// Grammar: #/<view>?b=<builderId|all>&s=<state filter>&q=<query>&sel=<fkey>&open=<term|transcript>&run=<run id>
// (`run` is a run id as the protocol checks it: the Runs view opens that run's page).
// `sel` is a lane/session fkey, or `run:<run id>` for a run node on the Map (T10).
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
import { activateView } from '../views/index.js';

// ---------------------------------------------------------------- views
//
// One page, hash-routed. The Board keeps every behaviour it had; the others
// are sections that are simply hidden. Nothing is torn down when a view is
// hidden, so switching back is instant and the terminals in the dock survive —
// but an IntersectionObserver reports a display:none subtree as off-screen, so
// the capture-pane rate drops on its own while you are elsewhere.
// Every view has a section (index.html `#view-<id>`) and a registry entry; a
// view the page has no section for still lands on the default view.
export const VIEWS = ['map', 'board', 'inbox', 'packages', 'morning', 'credit', 'box', 'audit', 'runs'];
/** Drill-down views: routable, never in the nav. */
export const HIDDEN_VIEWS = ['diff'];
export const DEFAULT_VIEW = 'map';
/**
 * The `g <key>` view chord (plan §4 2.6, authoritative). `g m` is the map now
 * and morning moved to `g o`; `g p` is packages (it was the map); `g r` is runs. ui/hotkeys.js
 * (D8) reads this table; the router only registers the routes.
 */
export const VIEW_KEYS = Object.freeze({ m: 'map', b: 'board', i: 'inbox', p: 'packages', x: 'box', a: 'audit', c: 'credit', o: 'morning', r: 'runs' });
export const OPEN_KINDS = ['term', 'transcript'];

const ROUTABLE = new Set([...VIEWS, ...HIDDEN_VIEWS]);
const STATE_RX = new RegExp('^[a-z0-9_-]{1,24}(?:,[a-z0-9_-]{1,24}){0,15}$');
// eslint-disable-next-line no-control-regex
const CONTROL_RX = /[\u0000-\u001f\u007f]/;
const MAX_Q = 200;
const MAX_SEL = 300;
/** A run id, the protocol's own pattern (server/runs/protocol.mjs RUN_ID). */
export const RUN_RX = new RegExp('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$');
/** A Map run node's `sel`, `run:<run id>` (server/map/runs.mjs). */
export const isRunSel = (v) => typeof v === 'string' && v.startsWith('run:') && RUN_RX.test(v.slice(4));

function safeDecode(v) {
  try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return null; }
}

/** An empty route on `view`: every parameter null. */
export function emptyRoute(view = DEFAULT_VIEW) {
  return { view, b: null, s: null, q: null, sel: null, open: null, run: null };
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
 * A hash (with or without the leading '#') -> {view, b, s, q, sel, open, run}.
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
  if (typeof p.sel === 'string' && p.sel.length <= MAX_SEL && !CONTROL_RX.test(p.sel) && (isFkey(p.sel) || isRunSel(p.sel))) r.sel = p.sel;
  if (OPEN_KINDS.includes(p.open)) r.open = p.open;
  if (RUN_RX.test(p.run ?? '')) r.run = p.run;
  return r;
}

/**
 * A route -> its hash, in the stable key order view, b, s, q, sel, open, run.
 * Defaults are left out: null/empty parameters, `b=all`, and the home view,
 * so the plain map is `#/`.
 */
export function formatHash(r = {}) {
  const view = ROUTABLE.has(r.view) ? r.view : DEFAULT_VIEW;
  const parts = [];
  for (const k of ['b', 's', 'q', 'sel', 'open', 'run']) {
    const v = r[k];
    if (v === null || v === undefined || v === '') continue;
    if (k === 'b' && v === 'all') continue;
    parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  const path = view === DEFAULT_VIEW ? '' : view;
  return `#/${path}${parts.length ? `?${parts.join('&')}` : ''}`;
}

/** The current route, parsed against the store's local builder. */
export function currentRoute() {
  return parseHash(location.hash, { localId: localBuilderId(store) });
}

/** Alias of currentRoute (plan §4 2.6 names it `current()`). */
export function current() {
  return currentRoute();
}

/**
 * The route after applying `patch` to `route`: only the routing keys, and a
 * view switch drops the selection (sel, open, run) unless the patch sets it. Pure.
 */
export function patchRoute(route, patch = {}) {
  const base = { ...emptyRoute(route?.view ?? DEFAULT_VIEW), ...pickRoute(route) };
  const p = pickRoute(patch);
  const next = { ...base, ...p };
  if ('view' in p && p.view !== base.view) {
    if (!('sel' in p)) next.sel = null;
    if (!('open' in p)) next.open = null;
    if (!('run' in p)) next.run = null;
  }
  return next;
}

const ROUTE_KEYS = ['view', 'b', 's', 'q', 'sel', 'open', 'run'];
function pickRoute(r) {
  const out = {};
  if (!r || typeof r !== 'object') return out;
  for (const k of ROUTE_KEYS) if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k];
  return out;
}

const routeListeners = new Set();

/** Run fn(route) after every applied route. Returns an unsubscribe. */
export function onRoute(fn) {
  routeListeners.add(fn);
  return () => { routeListeners.delete(fn); };
}

/**
 * Move to `{...current, ...patch}` (patchRoute). A push sets location.hash and
 * the hashchange applies it; `replace` rewrites the entry and applies it at
 * once (replaceState fires no hashchange). Routes only select and filter.
 */
export function navigate(patch = {}, { replace = false } = {}) {
  const want = formatHash(patchRoute(currentRoute(), patch));
  if (replace) {
    history.replaceState(null, '', want);
    applyHash();
    return want;
  }
  if (location.hash !== want) location.hash = want;
  else applyHash();
  return want;
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
  for (const btn of $('views')?.children ?? []) {
    if (!btn.dataset?.view) continue;
    const on = btn.dataset.view === view;
    btn.classList.toggle('on', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute?.('aria-current');
  }
  const cur = currentRoute();
  if (pushHash && !store.openSession) {
    // Keep the filters (b, s, q); a view switch drops the selection.
    const want = formatHash({ ...cur, view, sel: null, open: null, run: null });
    if (location.hash !== want) history.replaceState(null, '', want);
  }
  // The registry mounts the view (a legacy adapter for the F1-moved ones runs
  // their old show/load function) and unmounts the one it replaces.
  activateView(view, $(`view-${view}`), { store, route: { ...cur, view }, navigate });
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
  } else {
    setView(r.view, { pushHash: false });
  }
  const shown = { ...r, view: store.view };
  for (const fn of [...routeListeners]) {
    try { fn(shown); } catch { /* a listener never breaks routing */ }
  }
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('hashchange', applyHash);
}
