// The Map view wiring (the canvas itself is map-canvas.js). Moved from public/app.js (fleet F1).
import { $ } from '../core/dom.js';
import { store } from '../core/store.js';
import { openSheet } from '../ui/sheet.js';

// ---------------------------------------------------------------- map
//
// The Map view (views/map-canvas.js) is loaded the first time it is opened: the
// Board never pays for a canvas renderer it does not show. The model comes
// over the socket as `map` messages; tool events from the hooks become pulses
// on the lane they belong to.
let mapView = null;
let mapLoading = null;

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
    });
    if (store.map) mapView.update(store.map);
    else fetch('/api/map').then((r) => r.json()).then((m) => { store.map = m; mapView.update(m); }).catch(() => {});
  }).catch((err) => {
    mapLoading = null;
    $('map-root').textContent = `The map could not load: ${err?.message || err}`;
  });
}

/** What a node's panel offers: a lane's session can be opened in place. */
export function mapActions(node) {
  if (node.kind !== 'lane' || !node.session || !store.sessions.has(node.session)) return [];
  return [{ label: 'Open terminal', run: () => openSheet(node.session) }];
}

/** A new model from the socket. */
export function updateMap(model) {
  mapView?.update(model);
}

export function pulseMapFor(ev) {
  if (!mapView || !ev?.session_name) return;
  const s = store.sessions.get(ev.session_name);
  if (!s?.lane) return;
  const waiting = ev.type === 'Notification' || ev.subtype === 'permission_prompt';
  mapView.event({
    node: `lane:${s.lane}`,
    kind: waiting ? 'attention' : 'working',
    text: `${s.lane} · ${ev.subtype || ev.type}`,
    silent: !waiting,
  });
}

/** Top-level wiring from the old public/app.js, run once by boot(). */
export function init() {
  addEventListener('resize', () => { if (store.view === 'map') sizeMap(); });
}
