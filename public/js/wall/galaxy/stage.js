// The stage's size, read once and kept (Wall plan night 2 T29,
// reviews/r37-performance.md 3). The scene's resize, the camera's `screenOf`,
// the labels, the lock and the free box all want the canvas's css size every
// frame; `clientWidth`/`clientHeight` read after the lock's and the labels'
// style writes force a layout each time. One `ResizeObserver` on the canvas
// reads it again when it really changes (its callback runs after layout, so
// that read is free), and every frame gets the kept numbers.
//
// Without a ResizeObserver (node tests with plain objects) `get()` reads the
// element each call, as the modules did before.

/**
 * `createStageSize(el, { Observer })` → `{ get() → { W, H }, version(),
 * stop() }`. `version()` grows with every new size, for caches keyed on it
 * (hud.js's tag and fleet boxes).
 */
export function createStageSize(el, { Observer = globalThis.ResizeObserver } = {}) {
  const read = () => ({ W: el?.clientWidth ?? 0, H: el?.clientHeight ?? 0 });
  if (typeof Observer !== 'function') {
    let last = null, v = 0;
    const get = () => {
      const now = read();
      if (!last || now.W !== last.W || now.H !== last.H) { last = now; v++; }
      return last;
    };
    return { get, version: () => (get(), v), stop: () => {} };
  }
  let size = read();
  let v = 1;
  const ro = new Observer(() => {
    const now = read();
    if (now.W === size.W && now.H === size.H) return;
    size = now;
    v++;
  });
  ro.observe(el);
  return { get: () => size, version: () => v, stop: () => ro.disconnect() };
}

/** `galaxy.size()` when the scene keeps one, else the canvas read now (fake galaxies in tests). */
export function sizeOf(galaxy) {
  if (typeof galaxy?.size === 'function') return galaxy.size();
  const el = galaxy?.renderer?.domElement;
  return { W: el?.clientWidth ?? 0, H: el?.clientHeight ?? 0 };
}
