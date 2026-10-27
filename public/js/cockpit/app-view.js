// The cockpit's handle on the app (cockpit spec screens.md §9, D221, D222):
//
//   window.__cockpitView = { page: 'app', wall: null, map }
//
// `map` is null on a view without the Map (#/board, #/runs, …) and a new object each time the
// Map view mounts (views/map.js calls setAppMap). Display only: it moves the camera and reads
// positions, holds no token and sends nothing (security.md §2).
//
//   installAppView()           set the handle on the page (the cockpit's init, page 'app')
//   setAppMap(api, canvas)     the Map mounted: a new `map`; setAppMap(null) when it unmounts
//   mapHandle(api, canvasOf)   M1, M3, M5-M8 over createMap's API, points in page px (D222)
//
// Ids: a node id, or a builder's id for its `builder:<id>` node (B127); nodeAt answers a builder
// node by its builder id.

const BUILDER = 'builder:';

let map = null;

/** The node `x` names, as createMap knows it: its own id first, else the builder's node. */
function nodeOf(api, x) {
  if (typeof x !== 'string' || x === '') return null;
  if (x.startsWith(BUILDER) || api.screenOf(x)) return x;
  return api.screenOf(BUILDER + x) ? BUILDER + x : x;
}

/** The handle's `map` over a createMap API; `canvasOf()` -> the Map's canvas (its client rect). */
export function mapHandle(api, canvasOf) {
  const box = () => {
    const r = canvasOf()?.getBoundingClientRect?.();
    return r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
  };
  return {
    // M1: true when the flight lands, false when cut or the node is not drawn (nothing moves).
    flyTo: (id, z) => api.flyTo(nodeOf(api, id), z),
    // M3: {x, y, z, spin} in world units, a copy.
    camera: () => api.camera(),
    // M5: page px (D222): the Map's canvas px plus the canvas's client left and top.
    screenOf: (id) => {
      const at = api.screenOf(nodeOf(api, id));
      if (!at) return null;
      const b = box();
      return { x: at.x + b.left, y: at.y + b.top };
    },
    // M6: the node whose disc holds the page point, null off the canvas.
    nodeAt: (x, y) => {
      const b = box();
      const id = api.nodeAt(x - b.left, y - b.top);
      return typeof id === 'string' && id.startsWith(BUILDER) ? id.slice(BUILDER.length) : id ?? null;
    },
    // M7, M8 as the Map has them.
    onDraw: (cb) => api.onDraw(cb),
    emphasis: (id) => api.emphasis(nodeOf(api, id)),
  };
}

function write() {
  globalThis.__cockpitView = { page: 'app', wall: null, map };
}

/** Set the app's handle (before the cockpit's first `focus` message, c3-see.md §8.1). */
export function installAppView() {
  write();
}

/** The Map view mounted (`api` and its canvas) or unmounted (null): swap `map`. */
export function setAppMap(api, canvas = null) {
  map = api ? mapHandle(api, () => canvas) : null;
  if (globalThis.__cockpitView?.page === 'app') globalThis.__cockpitView.map = map;
}
