// A small fake DOM for mounting the Map (createMap) in node: elements with
// listeners, a canvas whose 2D context accepts every call and records the
// text it fills, and globals (document, rAF, matchMedia) installed and
// restored. A copy of the one in test/map-interact.test.mjs, which is fenced
// for the Wall loop and cannot import from here.

export function target(obj = {}) {
  const ls = new Map();
  obj.listeners = ls;
  obj.addEventListener = (type, fn) => { if (!ls.has(type)) ls.set(type, new Set()); ls.get(type).add(fn); };
  obj.removeEventListener = (type, fn) => { ls.get(type)?.delete(fn); };
  obj.dispatch = (type, ev = {}) => { for (const fn of [...(ls.get(type) ?? [])]) fn({ type, preventDefault() {}, ...ev }); };
  obj.count = (type) => ls.get(type)?.size ?? 0;
  return obj;
}

/** A 2D context that accepts every call and property. */
export function fakeCtx() {
  const calls = { draw: 0, text: [] };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
      if (k === 'clearRect') return () => { calls.draw++; };
      if (k === 'fillText') return (s) => { calls.text.push(String(s)); };
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

export function el(tag, W, H) {
  const e = target({
    tagName: tag.toUpperCase(),
    children: [],
    className: '',
    hidden: false,
    textContent: '',
    style: {},
    dataset: {},
    attrs: {},
    isConnected: true,
    offsetParent: {},
    offsetWidth: 120,
    offsetHeight: 30,
    value: '',
  });
  e.classList = {
    add: (...c) => { const s = new Set(e.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); e.className = [...s].join(' '); },
    remove: (...c) => { e.className = e.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
    contains: (c) => e.className.split(' ').includes(c),
  };
  e.append = (...k) => { for (const c of k) e.children.push(c); };
  e.replaceChildren = (...k) => { e.children = [...k]; };
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
  e.getBoundingClientRect = () => ({ left: 0, top: 0, width: W ?? 0, height: H ?? 0, right: W ?? 0, bottom: H ?? 0 });
  e.focus = () => { e.focused = true; };
  e.blur = () => { e.focused = false; };
  e.select = () => {};
  e.setPointerCapture = () => {};
  if (tag === 'canvas') {
    e.ctx = fakeCtx();
    e.getContext = () => e.ctx;
    e.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
  }
  return e;
}

/** Every element under `e`, depth first. */
export function all(e, out = []) {
  for (const c of e.children ?? []) { out.push(c); all(c, out); }
  return out;
}
export const byClass = (root, cls) => all(root).find((x) => x.className?.split(' ').includes(cls));

export function installDom({ reduced = true } = {}) {
  const storage = new Map();
  const win = target({});
  const doc = target({
    visibilityState: 'visible',
    documentElement: el('html'),
    createElement: (tag) => el(tag),
    createTextNode: (text) => ({ textContent: String(text), nodeType: 3 }),
  });
  const frames = [];
  let paletteReads = 0;
  const saved = {};
  const g = {
    document: doc,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    matchMedia: (q) => ({ matches: q.includes('reduced-motion') ? reduced : false, addEventListener() {}, removeEventListener() {} }),
    getComputedStyle: () => { paletteReads++; return { getPropertyValue: () => '' }; },
    requestAnimationFrame: (cb) => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: () => {},
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
    devicePixelRatio: 1,
    ResizeObserver: undefined,
    MutationObserver: undefined,
  };
  for (const k of Object.keys(g)) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  for (const [k, v] of Object.entries(g)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  // Frame times share performance.now()'s timebase, as rAF timestamps do in a browser.
  let t = performance.now();
  return {
    storage, win, doc, frames,
    get paletteReads() { return paletteReads; },
    /** Run queued animation frames (each may queue the next). */
    flush(n = 40) {
      for (let i = 0; i < n && frames.length; i++) {
        const cb = frames.shift();
        t += 16;
        cb(t);
      }
    },
    restore() {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
      }
    },
  };
}
