// Touch on the galaxy (Wall plan night 3 T7, README §7 Night 3 C1, C6): the
// first touch anywhere on the stage stops the tour and eases the camera back
// to the overview (about 1.5 s); nothing under that first touch is activated,
// so a finger that only meant "wake up" never opens a system by accident.
//
// One state machine with an injected clock: `tour` (the screensaver runs) →
// `easing` (the camera flies out, FIT_MS) → `explore` (the finger has it).
// `touchStep` is pure (test/wall-galaxy-touch.test.mjs); `createTouch` puts
// one `pointerdown` listener on the stage and tells the page through `wake`.
// Later steps (drag, pinch, tap a site, back, the tour resuming) listen with
// `onPointer`, which never hears the waking pointer: not its down, not its
// move, not its up.
//
// The page itself never scrolls, zooms or shows a menu under a finger: the
// viewport has no user scaling (galaxy.html), the stage `touch-action: none`
// (wall.css), and the context menu (a long press) is refused here.

/** How long the camera takes from wherever it is back to the overview on the first touch (ms). */
export const TOUCH = Object.freeze({ fitMs: 1500 });

export const TOUCH_MODES = Object.freeze(['tour', 'easing', 'explore']);

/**
 * The next state after `event` at `now` (ms). `state` is `{ mode, since }`;
 * `event` is `'down'` (a pointer went down) or `'tick'` (time passed).
 * Returns `{ state, wake, swallow }`: `wake` when this down is the one that
 * stops the tour (the page fits the camera), `swallow` when the pointer must
 * not reach anything under it. Pure.
 */
export function touchStep(state, event, now, { fitMs = TOUCH.fitMs } = {}) {
  const s = state && TOUCH_MODES.includes(state.mode) ? state : { mode: 'tour', since: null };
  // `easing` ends on its own: any event after fitMs finds the camera out.
  const cur = s.mode === 'easing' && now - s.since >= fitMs ? { mode: 'explore', since: s.since + fitMs } : s;
  if (event === 'down' && cur.mode === 'tour') {
    return { state: { mode: 'easing', since: now }, wake: true, swallow: true };
  }
  return { state: cur, wake: false, swallow: false };
}

/**
 * `createTouch(stage, { wake, clock, fitMs })` → `{ mode(), onPointer(cb),
 * stop() }`. `stage` gets the listeners; `wake()` is called once per first
 * touch (the page stops the tour and fits the camera); `clock` is
 * `performance.now` by default. `onPointer(cb)` hears every pointer event
 * (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`) of every
 * pointer but the waking one, with the mode at the time.
 */
export function createTouch(stage, opts = {}) {
  const o = { wake: () => {}, clock: () => performance.now(), fitMs: TOUCH.fitMs, ...opts };
  const fitMs = o.fitMs;
  let state = { mode: 'tour', since: null };
  const waking = new Set(); // the pointers that woke the page: theirs never reach `onPointer`
  const cbs = new Set();
  const tell = (ev) => { for (const cb of cbs) cb(ev, state.mode); };

  const down = (ev) => {
    const r = touchStep(state, 'down', o.clock(), { fitMs });
    state = r.state;
    if (r.swallow) {
      waking.add(ev.pointerId);
      ev.preventDefault?.();
      ev.stopPropagation?.();
    }
    if (r.wake) o.wake();
    if (!r.swallow) tell(ev);
  };
  const rest = (ev) => {
    if (waking.has(ev.pointerId)) {
      if (ev.type === 'pointerup' || ev.type === 'pointercancel') waking.delete(ev.pointerId);
      ev.preventDefault?.();
      ev.stopPropagation?.();
      return;
    }
    tell(ev);
  };
  const menu = (ev) => ev.preventDefault?.();

  const on = [['pointerdown', down], ['pointermove', rest], ['pointerup', rest], ['pointercancel', rest], ['contextmenu', menu]];
  for (const [type, fn] of on) stage.addEventListener(type, fn);

  return {
    mode: () => {
      state = touchStep(state, 'tick', o.clock(), { fitMs }).state;
      return state.mode;
    },
    onPointer: (cb) => {
      if (typeof cb !== 'function') return () => {};
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
    stop: () => { for (const [type, fn] of on) stage.removeEventListener(type, fn); },
  };
}
