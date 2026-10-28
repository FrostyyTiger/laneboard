// The room's clock: the one module every room timer and every `now()` goes
// through (pairing codes, stop at 5.0/8.0 s, restarts, heartbeat, liveness;
// spec stand-ins.md §1.1). By default it is the real clock and nothing in
// server/ ever replaces it: only the room under test's wrapper calls
// setClock() (test/cockpit/stand-ins/room-under-test.mjs, D109).
//
// A clock is any object with now() (ms since the epoch), setTimeout(fn, ms)
// and clearTimeout(handle); setInterval/clearInterval are built on those here
// when the clock has none. The fake speech takes the same shape (B12).
//
// createTestClock() is the clock the wrapper installs: `real` (the default,
// time runs) or `manual` (time stands still; timers fire only in advance(ms),
// due ones in time order). set(ms) moves the wall time only, never timers, as
// Playwright's page.clock.setSystemTime does (B17).

export const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h),
});

let current = realClock;

/** Replace the room's clock (null: back to the real one). */
export function setClock(clock) {
  if (clock !== null && (typeof clock?.now !== 'function' || typeof clock.setTimeout !== 'function' || typeof clock.clearTimeout !== 'function')) {
    throw new TypeError('setClock: a clock needs now(), setTimeout() and clearTimeout()');
  }
  current = clock ?? realClock;
}

export function getClock() {
  return current;
}

export const now = () => current.now();

const setTimeout_ = (fn, ms, ...args) => current.setTimeout(() => fn(...args), ms);
const clearTimeout_ = (h) => current.clearTimeout(h);
export { setTimeout_ as setTimeout, clearTimeout_ as clearTimeout };

/** An interval on the current clock; its handle is cleared with clearInterval. */
export function setInterval(fn, ms, ...args) {
  if (typeof current.setInterval === 'function') return { clock: current, inner: current.setInterval(() => fn(...args), ms) };
  const clock = current;
  const handle = { clock, inner: null, stopped: false };
  const arm = () => {
    handle.inner = clock.setTimeout(() => {
      if (handle.stopped) return;
      arm();
      fn(...args);
    }, ms);
  };
  arm();
  return handle;
}

export function clearInterval(handle) {
  if (!handle) return;
  if (typeof handle.clock.clearInterval === 'function' && !('stopped' in handle)) {
    handle.clock.clearInterval(handle.inner);
    return;
  }
  handle.stopped = true;
  handle.clock.clearTimeout(handle.inner);
}

/**
 * A clock for tests: `real` or `manual` (stand-ins.md §1.1).
 *   now()            wall time, ms
 *   mode             'real' | 'manual'
 *   setMode(m)       switch; time continues from where it is
 *   set(ms)          the wall time jumps there (any mode); timers keep their delays
 *   advance(ms)      manual only: run every timer due within ms, in time order
 * Timers count on their own timeline (elapsed ms), so set() never fires them.
 */
export function createTestClock({ start = Date.now() } = {}) {
  let mode = 'real';
  // The timeline timers run on: performance-like ms. In real mode it is
  // base + (performance.now() - realStart); in manual it stands at `frozen`.
  let realStart = performance.now();
  let base = 0;
  let frozen = 0;
  let wallOffset = start; // wall = elapsed() + wallOffset
  let nextId = 1;
  const timers = new Map(); // id -> {id, due, fn, every}
  let realTimer = null;

  const elapsed = () => (mode === 'manual' ? frozen : base + (performance.now() - realStart));

  function earliest() {
    let best = null;
    for (const t of timers.values()) if (!best || t.due < best.due || (t.due === best.due && t.id < best.id)) best = t;
    return best;
  }

  // Real mode: one real timer, armed for the earliest due.
  function rearm() {
    if (realTimer) globalThis.clearTimeout(realTimer);
    realTimer = null;
    if (mode !== 'real') return;
    const t = earliest();
    if (!t) return;
    realTimer = globalThis.setTimeout(fireDueReal, Math.max(0, t.due - elapsed()));
  }

  function fireDueReal() {
    realTimer = null;
    for (;;) {
      const t = earliest();
      if (!t || t.due > elapsed()) break;
      fire(t);
    }
    rearm();
  }

  function fire(t) {
    if (t.every !== null) t.due += t.every;
    else timers.delete(t.id);
    try {
      return t.fn();
    } catch (err) {
      queueMicrotask(() => { throw err; });
      return undefined;
    }
  }

  function add(fn, ms, every) {
    if (typeof fn !== 'function') throw new TypeError('timer callback must be a function');
    const delay = Math.max(0, Number(ms) || 0);
    const t = { id: nextId++, due: elapsed() + delay, fn, every: every ? Math.max(1, delay) : null };
    timers.set(t.id, t);
    rearm();
    return { id: t.id, unref() { return this; }, ref() { return this; }, hasRef: () => true };
  }

  function remove(h) {
    const id = typeof h === 'object' && h !== null ? h.id : h;
    if (timers.delete(id)) rearm();
  }

  return {
    get mode() { return mode; },
    now: () => Math.round(elapsed() + wallOffset),
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearTimeout: remove,
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: remove,
    pending: () => timers.size,
    setMode(m) {
      if (m !== 'real' && m !== 'manual') throw new RangeError(`clock mode must be real or manual, got ${JSON.stringify(m)}`);
      if (m === mode) return;
      const e = elapsed();
      mode = m;
      if (m === 'manual') frozen = e;
      else { base = e; realStart = performance.now(); }
      rearm();
    },
    set(ms) {
      if (!Number.isFinite(ms)) throw new RangeError('clock set: not a time');
      wallOffset = ms - elapsed();
    },
    /** Manual only. Fires due timers in time order, awaiting a callback's promise. */
    async advance(ms) {
      if (mode !== 'manual') throw Object.assign(new Error('not-manual'), { code: 'not-manual' });
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError('advance: ms must be >= 0');
      const target = frozen + ms;
      for (;;) {
        const t = earliest();
        // The timeline is fractional ms in real mode: allow float rounding.
        if (!t || t.due > target + 1e-6) break;
        frozen = Math.max(frozen, t.due);
        const r = fire(t);
        if (r && typeof r.then === 'function') await r.catch(() => {});
        // Let what the callback started (a promise chain, a new timer) settle first.
        await new Promise((res) => setImmediate(res));
      }
      frozen = target;
    },
    stop() {
      timers.clear();
      rearm();
    },
  };
}
