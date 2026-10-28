// The on-screen keyboard (cockpit spec c1-talk.md §7.1, D130, D131): how the page knows
// it is up, and how much room the input may take while it is. The numbers are pure, so
// node:test reads the same rules the page uses; `watchKeyboard` is the DOM half.
//
//   visibleBottom({ innerHeight, vvTop, vvHeight, vkHeight })   px from the layout top
//   keyboardWord({ height, focused, held })                     'up' | 'held' | 'down'
//   inputCap(left)               the input's tallest height while the keyboard is up
//   createTallest()              H: the largest innerHeight seen at the current width
//   watchKeyboard({ win, input, onChange })   data-keyboard and --ck-vv-top / --ck-kb-gap
import { inputHeight, INPUT_MAX_LINES, INPUT_ONE_LINE_PX } from './draft.js';

/** §7.1: `data-keyboard="up"` from a keyboard this tall, with the input focused. */
export const KEYBOARD_MIN_PX = 120;
/** §7.1: the input row on the keyboard's edge, 16 + 64 + 8 px. */
export const KEYBOARD_ROW_PX = 88;
/** §7.1 (D131): the conversation never under 200 px with a one-line input. */
export const CONVO_KEEP_PX = 200;

/**
 * §7.1 "Visible bottom": `min(innerHeight, visualViewport.offsetTop + .height)` minus the
 * `navigator.virtualKeyboard` rect's height (0 where the API is absent). Without a
 * visual viewport, the layout bottom (§1.2: `data-keyboard` then stays `down`).
 */
export function visibleBottom({ innerHeight, vvTop = 0, vvHeight = null, vkHeight = 0 }) {
  const seen = vvHeight == null ? innerHeight : Math.min(innerHeight, vvTop + vvHeight);
  return seen - (Number(vkHeight) || 0);
}

/**
 * §7.1: `held` during a talk press that started while it was `up` (C2), `up` while the
 * keyboard is at least 120 px tall and the input has the focus, else `down`.
 */
export function keyboardWord({ height, focused, held = false }) {
  if (held) return 'held';
  return focused && height >= KEYBOARD_MIN_PX ? 'up' : 'down';
}

/**
 * §7.1 "The input grows … only while the conversation keeps 200 px":
 * `clamp(64, 64 + left − 200, 182)`, `left` the conversation's height with a one-line
 * input (182 is §7's four lines, 181.6 px).
 */
export function inputCap(left) {
  const most = inputHeight(INPUT_MAX_LINES);
  const want = INPUT_ONE_LINE_PX + (Number(left) || 0) - CONVO_KEEP_PX;
  return Math.min(most, Math.max(INPUT_ONE_LINE_PX, want));
}

/**
 * §7.1 "H is the largest innerHeight seen at the current width since the load (a width
 * change resets it)". `seen(w, h)` takes one reading and returns H.
 */
export function createTallest() {
  let width = null;
  let tallest = 0;
  return {
    seen(w, h) {
      if (w !== width) { width = w; tallest = h; } else if (h > tallest) tallest = h;
      return tallest;
    },
  };
}

/**
 * The page's half (D130): `overlaysContent` where `navigator.virtualKeyboard` exists; the
 * visible bottom and the keyboard's height recomputed on visualViewport `resize`/`scroll`,
 * `geometrychange`, window `resize` and the input's focus, at most once per animation frame.
 * Sets the root's `data-keyboard` and, while it is `up` or `held`, `--ck-vv-top` (the
 * visible top) and `--ck-kb-gap` (layout bottom minus visible bottom) for cockpit.css;
 * calls `onChange(word)` after every reading that changed something.
 */
export function watchKeyboard(opts) {
  const { win, input } = opts;
  const onChange = opts.onChange ?? (() => {});
  const doc = win.document;
  const root = doc.documentElement;
  const vv = win.visualViewport ?? null;
  const vk = win.navigator?.virtualKeyboard ?? null;
  const tall = createTallest();
  let frame = null;
  let held = false;
  let last = '';

  /** H now, from the window as it is (pane.js reads it for the size floor, build B181). */
  const tallest = () => tall.seen(win.innerWidth, win.innerHeight);

  function read() {
    frame = null;
    const H = tallest();
    const focused = doc.activeElement === input;
    let word = 'down';
    let top = 0;
    let gap = 0;
    if (vv) {
      const bottom = visibleBottom({
        innerHeight: win.innerHeight, vvTop: vv.offsetTop, vvHeight: vv.height,
        vkHeight: vk?.boundingRect?.height ?? 0,
      });
      word = keyboardWord({ height: H - bottom, focused, held });
      top = vv.offsetTop;
      gap = Math.max(0, win.innerHeight - bottom);
    }
    const key = `${word}|${top}|${gap}`;
    if (key === last) return;
    last = key;
    root.dataset.keyboard = word;
    if (word === 'down') {
      root.style.removeProperty('--ck-vv-top');
      root.style.removeProperty('--ck-kb-gap');
    } else {
      root.style.setProperty('--ck-vv-top', `${top}px`);
      root.style.setProperty('--ck-kb-gap', `${gap}px`);
    }
    onChange(word);
  }

  const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(read); };

  root.dataset.keyboard = 'down';
  if (vk) {
    try { vk.overlaysContent = true; } catch { /* a browser that refuses: the visual viewport alone */ }
    vk.addEventListener?.('geometrychange', schedule);
  }
  if (vv) {
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
  }
  win.addEventListener('resize', schedule);
  input.addEventListener('focus', schedule);
  input.addEventListener('blur', schedule);
  tallest();

  return {
    tallest,
    word: () => root.dataset.keyboard,
    /** C2's talk press (§7.1): keep the layout from the `pointerdown` until the microphone closes. */
    hold: (on) => { held = Boolean(on) && root.dataset.keyboard !== 'down'; schedule(); },
  };
}
