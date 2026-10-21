// The Map view (fleet plan §5 2.7-2.8, task M5): the home view, wired into the
// shell. The canvas itself is views/map/index.js (createMap, loaded through the
// views/map-canvas.js shim the first time it is needed, so a page that never
// shows the Map never pays for the renderer).
//
//   registry     default export {id:'map', mount, unmount, update} for §4 D4
//   route        `b=` -> setScope, `sel=` -> select (fly); map clicks -> navigate({sel})
//   inspector    the single detail surface (§5 2.3): bindMap(api, {hairline:false})
//                (the map draws its own tether to anchorEl), setInsets follows it
//   split        `\` (D8) flips localStorage['lb.split'] and dispatches `lb:split`:
//                Map 60% left, the dense lane table (map/split.js) 40% right,
//                selection synced through the router, hover lit both ways
//   minimap      none: the minimap sits on the Map only (runs-n4 T14, README §7 Night 4
//                item 3), and the Map is its own overview, so no view mounts the
//                map/minimap.js PiP; the map loads the first time #/map shows
//   actions      nodeActions(node) (laneActions + run): the 2.8 list; the inspector runs them (its bar,
//                plus the map's own fold/peek buttons registered on it); results
//                pulse the node, status never changes optimistically
//   events       hook events from the store pulse `lane:<builder>/<lane>`
//
// Pure at import time. The pure parts (laneActions, mapEventFor, actionPulse,
// routePlan, splitState) are tested in test/map-view.test.mjs.
// Builder-supplied text reaches the page through textContent only.
import { $ } from '../core/dom.js';
import { store, toIndexKey } from '../core/store.js';
import { laneNodeId } from '../core/keys.js';
import { act, tierOf } from '../core/actions.js';
import { currentRoute, navigate, onRoute } from '../core/router.js';
import { anchorEl, bindMap, modelFor, openTerminal, registeredTabs, selected as inspSelected } from '../ui/inspector.js';
import { registerAction } from '../ui/actionbar.js';
import { confirmAction } from '../ui/confirm.js';
import { toast } from '../ui/toast.js';
import { idForSel } from './map/model.js';
import { createSplitTable, splitOn, canSplit, SPLIT_KEY } from './map/split.js';

// ---------------------------------------------------------------- pure

/**
 * The inline actions of a node (§5 2.8), in bar order. `info`: {paused,
 * approvalId, hasKids, tier(action)}. Lanes and sessions with a fleet key get
 * term/peek/send/pause|resume/approve+deny (only while an approval waits);
 * any node with children gets fold. Pure: no `run` here (mapActions adds it).
 */
export function laneActions(node, info = {}) {
  if (!node || typeof node !== 'object') return [];
  const tier = typeof info.tier === 'function' ? info.tier : (a) => tierOf(a);
  const out = [];
  const add = (id, icon, label, action) => out.push({ id, icon, label, action, tier: action ? tier(action) : 'none' });
  const laneLike = (node.kind === 'lane' || node.kind === 'session') && typeof node.fkey === 'string' && node.fkey !== '';
  if (laneLike) {
    add('term', 'terminal', 'Terminal', null);
    add('peek', 'inspector', 'Peek', null);
    add('send', 'send', 'Send text', 'send-text');
    if (info.paused || node.flags?.paused) add('resume', 'resume', 'Resume', 'resume');
    else add('pause', 'pause', 'Pause', 'pause');
    if (node.flags?.awaitingApproval && typeof info.approvalId === 'string' && info.approvalId) {
      add('approve', 'approve', 'Approve', 'approve');
      add('deny', 'deny', 'Deny', 'deny');
    }
  }
  if (info.hasKids) add('fold', 'chev-d', 'Fold / unfold', null);
  return out;
}

/** The args an action of the 2.8 list sends. Pure. */
export function actionArgs(id, { approvalId = null, text = null } = {}) {
  if (id === 'approve' || id === 'deny') return { approvalId };
  if (id === 'send') return { text, guardPrompt: true };
  return {};
}

/** The pulse an action result gives its node, or null (outcome unknown). Pure. */
export function actionPulse(node, label, result, now = Date.now()) {
  if (!node?.id || !result) return null;
  if (result.ok === 'unknown') return null;
  const ok = result.ok === true;
  return {
    at: now,
    node: node.id,
    kind: ok ? 'ok' : 'crit',
    text: `${label} ${ok ? '→' : 'failed:'} ${ok ? node.label ?? node.id : result.error ?? 'error'}`,
    silent: ok,
  };
}

/** The map event for a hook event (stamped by the store with `key`), or null. */
export function mapEventFor(ev, s = null) {
  if (!ev?.key) return null;
  s ??= store;
  const sess = s.sessions?.get?.(ev.key);
  if (!sess?.lane || !sess.builder) return null;
  let node;
  try { node = laneNodeId(sess.builder, sess.lane); } catch { return null; }
  const waiting = ev.type === 'Notification' || ev.subtype === 'permission_prompt';
  return {
    node,
    kind: waiting ? 'attention' : 'working',
    text: `${sess.lane} · ${ev.subtype || ev.type}`,
    silent: !waiting,
  };
}

/**
 * What a route does to the map: {scope, select} where `select` is undefined
 * when the selection is already what the map shows (`last`), else the new
 * sel (null clears). Only the Map view applies it. Pure.
 */
export function routePlan(route, last) {
  const scope = typeof route?.b === 'string' && route.b ? route.b : 'all';
  const sel = typeof route?.sel === 'string' && route.sel ? route.sel : null;
  return { scope, select: sel === (last ?? null) ? undefined : sel };
}

/**
 * Split on or off for a stored `lb.split` value and a viewport width:
 * {want, on, refused}. `refused` when split is wanted but the window is
 * narrower than SPLIT_MIN_W (the map stays full). Pure.
 */
export function splitState(stored, width) {
  const want = splitOn(stored);
  const on = want && canSplit(width);
  return { want, on, refused: want && !on };
}

// ---------------------------------------------------------------- state

const page = {
  api: null,            // createMap API, once loaded
  loading: null,        // the import promise
  section: null,        // #view-map
  mounted: false,
  route: null,          // the last route seen
  lastSel: null,        // the sel the map shows (so our own clicks do not fly)
  split: null,          // createSplitTable instance while split is on
  splitToasted: false,
  inited: false,
};

/** The loaded map's API (createMap), or null: the hotkeys (ui/hotkeys.js, §4 D8) call it. */
export function getMapView() { return page.api; }

export function sizeMap() {
  const bar = document.querySelector('.topbar');
  if (bar) document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
}

const width = () => globalThis.innerWidth ?? 1200;
const readSplit = () => { try { return globalThis.localStorage?.getItem(SPLIT_KEY) ?? null; } catch { return null; } };
const writeSplit = (v) => { try { globalThis.localStorage?.setItem(SPLIT_KEY, v); } catch { /* private window */ } };
const routeNow = () => { try { return currentRoute(); } catch { return page.route ?? { view: store.view }; } };

/** Load the map into #map-root (once). Resolves the API, or null when it failed. */
function ensureMap() {
  if (page.api) return Promise.resolve(page.api);
  if (page.loading) return page.loading;
  const root = $('map-root');
  if (!root) return Promise.resolve(null);
  page.loading = import('./map-canvas.js').then((mod) => {
    const api = mod.createMap(root, {
      title: store.map?.title ?? 'Map',
      actions: nodeActions,
      // The inspector is the tether target (§5 2.3); the map draws the line.
      anchorEl: () => anchorEl(),
      // Old fold sets name lanes `lane:<x>`; they migrate to this builder's
      // `lane:<localId>/<x>` (map/index.js migrateFolds). Only once the
      // source has named its builder; a hub origin starts with none.
      localId: store.source.kind === 'local' ? store.source.id : null,
    });
    page.api = api;
    api.onSelect((sel, node, info) => onMapSelect(sel, info));
    api.onHover((sel, node) => page.split?.setHot(node?.id ?? null));
    bindMap(api, { root, hairline: false });
    if (store.map) api.update(store.map);
    else {
      fetch('/api/map').then((r) => r.json()).then((m) => {
        if (!store.map) store.map = m;
        updateMap(store.map);
      }).catch(() => {});
    }
    if (store.view === 'map') {
      applyMapRoute(routeNow());
      syncSplit();
    } else {
      api.setMode('pip');
    }
    return api;
  }).catch((err) => {
    page.loading = null;
    root.textContent = `The map could not load: ${err?.message || err}`;
    return null;
  });
  return page.loading;
}

/** The legacy entry (views/index.js adapter, kept for callers): show the map. */
export function showMap() {
  sizeMap();
  if (page.api) { page.api.resize(); return; }
  ensureMap();
}

// ---------------------------------------------------------------- selection and route

function onMapSelect(sel, info = {}) {
  page.lastSel = sel ?? null;
  page.split?.setSelected(page.lastSel);
  // A long press (phone) opens the inspector straight away: same route.
  if (store.view !== 'map') return;
  const cur = routeNow();
  if ((cur.sel ?? null) === page.lastSel && info?.via !== 'longpress') return;
  navigate({ sel: page.lastSel });
}

/** A route reached the page (router onRoute). */
function applyMapRoute(route) {
  page.route = route;
  if (route?.view === 'map' && page.api) {
    const plan = routePlan(route, page.lastSel);
    const prevScope = page.api.scope?.();
    page.api.setScope(plan.scope);
    if (plan.select !== undefined) {
      page.lastSel = plan.select;
      page.api.select(plan.select, { fly: Boolean(plan.select) });
    }
    page.split?.setSelected(route.sel ?? null);
    if (page.split && prevScope !== plan.scope) page.split.update(store.map, { scope: plan.scope });
  }
}

// ---------------------------------------------------------------- split

function syncSplit({ fromKey = false } = {}) {
  const sec = page.section ?? $('view-map');
  page.section = sec;
  const st = splitState(readSplit(), width());
  if (st.refused && fromKey) {
    // Below 900px the split is refused: the map stays full (§5 2.7).
    writeSplit('0');
    if (!page.splitToasted) toast('Split view needs a window at least 900px wide', { kind: 'info' });
    page.splitToasted = true;
  }
  const on = st.on && store.view === 'map' && Boolean(sec);
  if (on && !page.split) {
    sec.classList.add('map-split');
    sec.style.display = 'grid';
    sec.style.gridTemplateColumns = '3fr 2fr';
    sec.style.gridTemplateRows = 'minmax(0, 1fr)';
    page.split = createSplitTable(sec, {
      onSelect: (sel) => navigate({ sel }),
      onHover: (id) => page.api?.highlight(id),
    });
    const r = routeNow();
    page.split.update(store.map, { scope: routePlan(r).scope });
    page.split.setSelected(r.sel ?? null);
    page.api?.setMode('split');
  } else if (!on && page.split) {
    teardownSplit();
    if (store.view === 'map') page.api?.setMode('full');
  }
}

/** Drop the table and the grid; the map root fills the section again. */
function teardownSplit() {
  page.split?.destroy();
  page.split = null;
  page.api?.highlight(null);
  const sec = page.section;
  if (!sec) return;
  sec.classList.remove('map-split');
  sec.style.display = '';
  sec.style.gridTemplateColumns = '';
  sec.style.gridTemplateRows = '';
}

// ---------------------------------------------------------------- actions

const nodesOf = () => (Array.isArray(store.map?.nodes) ? store.map.nodes : []);
const byIdOfMap = () => new Map(nodesOf().filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n]));
const hasKids = (id) => Boolean(id) && nodesOf().some((n) => n?.parent === id);

/** The node a `sel` names in the current model, or null. */
function nodeForSel(sel) {
  if (!sel) return null;
  const byId = byIdOfMap();
  const id = idForSel(String(sel), byId);
  return id ? byId.get(id) ?? null : null;
}

function infoFor(node) {
  const sel = node?.fkey ?? node?.id ?? null;
  let m = null;
  try { m = sel ? modelFor(store, sel) : null; } catch { m = null; }
  return {
    m,
    paused: Boolean(m?.paused),
    approvalId: m?.approvalId ?? null,
    hasKids: hasKids(node?.id),
  };
}

/** Open the inspector's PEEK tab for `sel` (§10 R12), when that tab exists. */
function peek(sel) {
  if (!sel) return;
  const click = () => $('shell-insp')?.querySelector?.('.insp-tab[data-tab="peek"]')?.click();
  if ((routeNow().sel ?? null) === sel) { click(); return; }
  // The inspector opens on the route; click the tab once it has.
  const off = onRoute(() => { off(); click(); });
  navigate({ sel });
}

/**
 * Run one item of the 2.8 list for `node`. Click-tier and up ask first
 * (confirmAction), then act() on the session; the result pulses the node.
 * `extra.text` carries the send-text input. Resolves the act() result.
 */
export async function runMapAction(item, node, extra = {}) {
  const info = infoFor(node);
  const sel = node?.fkey ?? node?.id ?? null;
  switch (item?.id) {
    case 'term': {
      const k = info.m?.sessionKey ?? (typeof node?.session === 'string' ? toIndexKey(store, node.session) : null);
      if (k) openTerminal(k);
      return { ok: Boolean(k) };
    }
    case 'peek': peek(sel); return { ok: true };
    case 'fold': page.api?.toggleFold(node.id); return { ok: true };
    default: break;
  }
  if (!item?.action) return { ok: false, error: 'unknown action' };
  if (item.id === 'send' && (typeof extra.text !== 'string' || !extra.text.trim())) return { ok: false, error: 'no text' };
  const target = info.m?.sessionKey ?? sel;
  if (!target) return { ok: false, error: 'no target' };
  const answer = await confirmAction({ action: item.action, targets: [target], tier: item.tier, builder: node.builder ?? null });
  if (!answer?.ok) return { ok: false, cancelled: true };
  const r = await act(target, item.action, actionArgs(item.id, { approvalId: info.approvalId, text: extra.text ?? null }));
  if (r?.ok === true) toast(`${item.label} → ${node.label ?? sel}`, { kind: 'ok' });
  else if (r?.ok === 'unknown') toast(`${item.label}: sent, outcome unknown`, { kind: 'info' });
  else toast(`${item.label} failed: ${r?.error ?? 'error'}`, { kind: 'err' });
  const pulse = actionPulse(node, item.label, r);
  if (pulse) page.api?.event(pulse);
  return r;
}

/** What a node offers (createMap opts.actions): the 2.8 list with run(). */
export function nodeActions(node) {
  if (!node) return [];
  return laneActions(node, infoFor(node)).map((it) => ({ ...it, run: () => runMapAction(it, node) }));
}

/**
 * The pre-M5 contract (F8b, test/render-fleet.test.mjs): a lane whose
 * session (`node.session`, a fleet key) is in the store can open it in place.
 */
export function mapActions(node) {
  if (node?.kind !== 'lane' || typeof node.session !== 'string') return [];
  const k = toIndexKey(store, node.session);
  if (!k || !store.sessions.has(k)) return [];
  return [{ id: 'term', icon: 'terminal', label: 'Open terminal', run: () => openTerminal(k) }];
}

/**
 * The map's own buttons on the inspector's action bar (§4 D6 registry): fold
 * on the Map, and PEEK once that tab is registered. The bar already carries
 * pause/resume/approve/deny/terminal.
 */
function registerBarActions() {
  try {
    registerAction({
      id: 'map-fold', icon: 'chev-d', label: 'Fold / unfold on the map',
      when: () => store.view === 'map' && Boolean(page.api) && hasKids(nodeForSel(inspSelected())?.id),
      run: () => { const n = nodeForSel(inspSelected()); if (n) page.api?.toggleFold(n.id); },
    });
    registerAction({
      id: 'map-peek', icon: 'inspector', label: 'Peek',
      when: () => registeredTabs().some((t) => t?.id === 'peek'),
      run: () => peek(inspSelected()),
    });
  } catch { /* a bar without a registry still works */ }
}

// ---------------------------------------------------------------- store feed

/** A new model from the socket. */
export function updateMap(model) {
  page.api?.update(model);
  if (page.split) page.split.update(model, { scope: routePlan(page.route ?? routeNow()).scope });
}

export function pulseMapFor(ev) {
  if (!page.api) return;
  const e = mapEventFor(ev);
  if (e) page.api.event(e);
}

// ---------------------------------------------------------------- the view

function mountMap(el) {
  page.section = el ?? $('view-map');
  page.mounted = true;
  // One task later, so the shell is laid out before the map measures.
  setTimeout(() => {
    if (!page.mounted) return;
    sizeMap();
    ensureMap().then((api) => {
      if (!api || !page.mounted) return;
      api.setMode(page.split ? 'split' : 'full');
      bindMap(api, { root: $('map-root'), hairline: false });
      applyMapRoute(routeNow());
      syncSplit();
      api.resize();
    });
  }, 0);
}

function unmountMap() {
  page.mounted = false;
  // The map stays loaded, idle off screen: switching back is instant.
  teardownSplit();
  page.api?.setMode('pip');
}

// The model arrives as `map` messages (updateMap); nothing per store change.
const noop = () => {};

export default { id: 'map', icon: 'map', title: 'Map', short: 'MAP', mount: mountMap, unmount: unmountMap, update: noop };

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  if (page.inited) return;
  page.inited = true;
  addEventListener('resize', () => {
    if (store.view === 'map') { sizeMap(); syncSplit(); }
  });
  addEventListener('lb:split', () => syncSplit({ fromKey: true }));
  onRoute((r) => applyMapRoute(r));
  registerBarActions();
}
