// The galaxy's frame budget (Wall plan night 2 T10, README §7.A6, §2.4): the
// sketch held 60 fps on the tablet and the real page must stay there with
// labels, lock and effects on top. Frames are timed in windows; when the
// windows keep missing the budget the scene steps down a level (fewer sphere
// segments, less dust, fewer far stars); when they keep holding it with room
// to spare it steps back up, waiting longer after every step that had to be
// taken back, so a page on the edge settles instead of popping its dust.
//
// Pure: the caller passes the clock and the numbers (main.js feeds it, the
// `?perf=1` overlay prints `perfLine`).

/** The quality levels, best first: fractions of the full segments, dust and far stars. */
export const LEVELS = Object.freeze([
  Object.freeze({ seg: 1, dust: 1, stars: 1 }),
  Object.freeze({ seg: 0.65, dust: 0.6, stars: 0.6 }),
  Object.freeze({ seg: 0.45, dust: 0.35, stars: 0.35 }),
]);

/**
 * The budget: a window of `windowMs`; a window misses when its mean frame
 * gap is over `missMs` (a 60 Hz frame and a quarter); it has room when the
 * gap holds `easyMs` and the script took under `roomMs`. `downAfter`
 * missing windows step down, `upAfter` roomy ones step up, and every step
 * back down after a step up doubles that wait, up to `upMax`.
 */
export const BUDGET = Object.freeze({
  windowMs: 1000,
  missMs: 1000 / 60 * 1.25,
  easyMs: 1000 / 60 * 1.08,
  roomMs: 6,
  downAfter: 3,
  upAfter: 20,
  upMax: 320,
});

/** Where a page starts: the best level, nothing counted. */
export const budgetStart = () => ({ level: 0, down: 0, up: 0, wait: BUDGET.upAfter, rose: false });

/**
 * One window's verdict. `state` is budgetStart's shape; `sample` is
 * `{ frameMs, scriptMs }`, the window's mean frame gap and script time.
 * Returns the next state (a new object); `level` is the one to draw at.
 */
export function budgetStep(state, sample, budget = BUDGET, levels = LEVELS.length) {
  const s = { ...budgetStart(), ...state };
  const frameMs = Number(sample?.frameMs), scriptMs = Number(sample?.scriptMs) || 0;
  if (!Number.isFinite(frameMs) || frameMs <= 0) return s;
  if (frameMs > budget.missMs) {
    s.up = 0;
    s.down += 1;
    if (s.down >= budget.downAfter && s.level < levels - 1) {
      // A step up that did not hold: wait twice as long before the next.
      if (s.rose) s.wait = Math.min(budget.upMax, s.wait * 2);
      s.level += 1;
      s.down = 0;
      s.rose = false;
    }
    return s;
  }
  s.down = 0;
  if (frameMs <= budget.easyMs && scriptMs < budget.roomMs) {
    s.up += 1;
    if (s.up >= s.wait && s.level > 0) {
      s.level -= 1;
      s.up = 0;
      s.rose = true;
    }
  } else s.up = 0;
  return s;
}

/**
 * Times frames into windows: `frame(now, scriptMs)` after each drawn frame
 * returns the closed window `{ frameMs, scriptMs, fps, frames }` once
 * `windowMs` has passed, else null. `pause()` after the page was hidden:
 * that gap is not a slow frame.
 */
export function createFrameWindow(windowMs = BUDGET.windowMs) {
  let last = null, t0 = null, frames = 0, gaps = 0, script = 0;
  return {
    frame: (now, scriptMs = 0) => {
      if (last != null) { gaps += now - last; frames += 1; script += scriptMs; }
      if (t0 == null) t0 = now;
      last = now;
      if (now - t0 < windowMs || frames === 0) return null;
      const out = {
        frameMs: gaps / frames,
        scriptMs: script / frames,
        fps: (frames * 1000) / gaps,
        frames,
      };
      t0 = now; frames = 0; gaps = 0; script = 0;
      return out;
    },
    pause: () => { last = null; t0 = null; frames = 0; gaps = 0; script = 0; },
  };
}

const fixed = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

/**
 * The overlay's lines: `w` a closed window, `level`, `info` three's
 * `renderer.info`, `memory` `performance.memory` when the browser has it.
 */
export function perfLine({ w, level = 0, info = null, memory = null } = {}) {
  const lines = [
    `${fixed(w?.scriptMs, 2)} ms script · ${fixed(w?.frameMs)} ms/frame · ${fixed(w?.fps, 0)} fps · L${level}`,
  ];
  if (info) {
    lines.push(`${info.render?.calls ?? '–'} calls · ${info.memory?.geometries ?? '–'} geo · ${info.memory?.textures ?? '–'} tex`);
  }
  if (memory && Number.isFinite(memory.usedJSHeapSize)) {
    lines.push(`${fixed(memory.usedJSHeapSize / 1048576, 0)} MB heap`);
  }
  return lines;
}
