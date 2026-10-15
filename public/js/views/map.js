// The Map view wiring (the canvas itself is map-canvas.js). Moved from public/app.js (fleet F1).
import { $ } from '../core/dom.js';
import { store, toIndexKey } from '../core/store.js';
import { laneNodeId } from '../core/keys.js';
import { openSheet } from '../ui/sheet.js';

// ---------------------------------------------------------------- map
//
// The Map view (views/map-canvas.js) is loaded the first time it is opened: the
// Board never pays for a canvas renderer it does not show. The model comes
// over the socket as `map` messages; tool events from the hooks become pulses
// on the lane they belong to.
let mapView = null;
let mapLoading = null;

/** The loaded map's API (createMap), or null: the hotkeys (ui/hotkeys.js, §4 D8) call it. */
export function getMapView() { return mapView; }

export function sizeMap() {
  const bar = document.querySelector('.topbar');
  if (bar) document.documentElement.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
}

export function showMap() {
  sizeMap();
  if (mapView) { mapView.resize(); return; }
  if (mapLoading) return;
  mapLoading = import('./map-canvas.js').then((mod) => {
    mapView = mod.createMap($('map-root'), {
      title: store.map?.title ?? 'Map',
      actions: mapActions,
      // Old fold sets name lanes `lane:<x>`; they migrate to this builder's
      // `lane:<localId>/<x>` (map-canvas.js migrateFolds). Only once the
      // source has named its builder; a hub origin starts with none.
      localId: store.source.kind === 'local' ? store.source.id : null,
    });
    if (store.map) mapView.update(store.map);
    else fetch('/api/map').then((r) => r.json()).then((m) => { store.map = m; mapView.update(m); }).catch(() => {});
  }).catch((err) => {
    mapLoading = null;
    $('map-root').textContent = `The map could not load: ${err?.message || err}`;
  });
}

/**
 * What a node's panel offers: a lane's session can be opened in place.
 * `node.session` is the fleet key of the lane's first session (server/map.mjs).
 */
export function mapActions(node) {
  if (node?.kind !== 'lane' || typeof node.session !== 'string') return [];
  const k = toIndexKey(store, node.session);
  if (!k || !store.sessions.has(k)) return [];
  return [{ label: 'Open terminal', run: () => openSheet(k) }];
}

/** A new model from the socket. */
export function updateMap(model) {
  mapView?.update(model);
}

/** The map event for a hook event (stamped by the store with `key`), or null. */
export function mapEventFor(ev) {
  if (!ev?.key) return null;
  const s = store.sessions.get(ev.key);
  if (!s?.lane || !s.builder) return null;
  let node;
  try { node = laneNodeId(s.builder, s.lane); } catch { return null; }
  const waiting = ev.type === 'Notification' || ev.subtype === 'permission_prompt';
  return {
    node,
    kind: waiting ? 'attention' : 'working',
    text: `${s.lane} · ${ev.subtype || ev.type}`,
    silent: !waiting,
  };
}

export function pulseMapFor(ev) {
  if (!mapView) return;
  const e = mapEventFor(ev);
  if (e) mapView.event(e);
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('resize', () => { if (store.view === 'map') sizeMap(); });
}
