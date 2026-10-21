// The minimap PiP renderer (fleet plan §5 2.7, task M5): a 240x240 canvas of the
// Map's scene. No view mounts it since runs-n4 T14 (the owner's taste call
// "the minimap on the Map only": it covered the end of other views, and the Map
// is its own overview); the renderer stays for a Map-side overview later.
//
// It draws the rings and one dot per node (status shape, 2-3 px); no labels, no comets. The points come from the main map's
// snapshotScene() (`{version, pts: Float32Array [x, y, shapeCode, toneCode]...,
// outer}`), the goals of its layout: no springs are computed here.
//
// Redraw throttle: at most PIP_FPS frames a second, driven by a slow
// interval, and only when the scene's version changed or a pulse is due (a
// node in trouble blinks once a second). No animation-frame loop.
// Reduced motion: no blink, draw on change only.
//
// Pure parts (transform, redraw decision, dot list) are tested in
// test/map-view.test.mjs.
import { RINGS } from './layout.js';
import { SHAPE_CODE, TONE_CODE } from './overlays.js';
import { readPalette } from './render.js';

/** Edge of the PiP canvas, CSS px. */
export const PIP_SIZE = 240;
/** Most frames a second the PiP draws. */
export const PIP_FPS = 2;
/** Minimum time between two PiP frames, ms. */
export const PIP_FRAME_MS = 1000 / PIP_FPS;
/** Padding inside the canvas around the outermost ring, px. */
const PAD = 10;

const invert = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
let codes = null;
/** code -> name tables, built on first use (pure at import time). */
function codeNames() {
  codes ||= { shape: invert(SHAPE_CODE), tone: invert(TONE_CODE), trouble: new Set([TONE_CODE.crit, TONE_CODE.warn]) };
  return codes;
}

/** World -> PiP px: scale and centre for a scene whose outermost radius is `outer`. Pure. */
export function pipTransform(outer, size = PIP_SIZE, pad = PAD) {
  const r = Number.isFinite(outer) && outer > 0 ? outer : RINGS[2];
  const s = Math.max(0.0001, (size / 2 - pad) / (r + 24));
  return { s, cx: size / 2, cy: size / 2 };
}

/** True when the scene has a node in trouble (it blinks). Pure. */
export function hasTrouble(scene) {
  const pts = scene?.pts;
  if (!pts || typeof pts.length !== 'number') return false;
  for (let i = 3; i < pts.length; i += 4) if (codeNames().trouble.has(pts[i])) return true;
  return false;
}

/**
 * Should the PiP draw now? `last` = {version, at, phase} of the last frame
 * (null: never drawn). Never twice within PIP_FRAME_MS; then on a new scene
 * version, or when the blink phase (one per second) flipped and something is
 * in trouble. Pure.
 */
export function shouldRedraw(last, scene, now, { reduced = false } = {}) {
  if (!scene) return false;
  if (!last) return true;
  if (now - last.at < PIP_FRAME_MS) return false;
  if (scene.version !== last.version) return true;
  if (reduced) return false;
  return blinkPhase(now) !== last.phase && hasTrouble(scene);
}

/** 0 or 1, flipping once a second. Pure. */
export function blinkPhase(now) {
  return Math.floor(now / 1000) % 2;
}

/** The dots to draw, in PiP px: [{x, y, shape, tone}]. Pure. */
export function dotsOf(scene, tf) {
  const out = [];
  const pts = scene?.pts;
  if (!pts) return out;
  for (let i = 0; i + 3 < pts.length; i += 4) {
    const x = pts[i], y = pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      x: tf.cx + x * tf.s,
      y: tf.cy + y * tf.s,
      shape: codeNames().shape[pts[i + 2]] ?? 'disc',
      tone: codeNames().tone[pts[i + 3]] ?? 'grey',
    });
  }
  return out;
}

/** The ring radii (PiP px) up to the scene's outermost radius. Pure. */
export function ringsOf(outer, tf) {
  const out = [];
  if (!(tf?.s > 0)) return out;
  for (const r of RINGS) if (r > 0 && r <= (outer ?? 0) + 1) out.push(r * tf.s);
  return out;
}

// ---------------------------------------------------------------- DOM

/** A radius ctx.arc accepts: finite and >= 0 (the browser throws on a negative one). */
const safeRadius = (r) => (Number.isFinite(r) && r > 0 ? r : 0);

const toneColour = (pal, tone) => (tone === 'crit' ? pal.crit : tone === 'warn' ? pal.warn
  : tone === 'low' ? pal.low : tone === 'accent' ? pal.accent : pal.t3);

function dot(ctx, d, size) {
  ctx.beginPath();
  switch (d.shape) {
    case 'square': ctx.rect(d.x - size, d.y - size, size * 2, size * 2); ctx.fill(); return;
    case 'tri':
      ctx.moveTo(d.x, d.y - size * 1.2); ctx.lineTo(d.x + size * 1.1, d.y + size * 0.8); ctx.lineTo(d.x - size * 1.1, d.y + size * 0.8);
      ctx.closePath(); ctx.fill(); return;
    case 'diamond':
      ctx.moveTo(d.x, d.y - size * 1.2); ctx.lineTo(d.x + size * 1.2, d.y); ctx.lineTo(d.x, d.y + size * 1.2); ctx.lineTo(d.x - size * 1.2, d.y);
      ctx.closePath(); ctx.fill(); return;
    case 'ring': ctx.arc(d.x, d.y, safeRadius(size), 0, Math.PI * 2); ctx.stroke(); return;
    default: ctx.arc(d.x, d.y, safeRadius(size * 0.8), 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Drive `canvas` from `sceneSource()` (the main map's snapshotScene, or null).
 * `opts`: {onClick(), size, reduced(), now()}. Returns
 * {start(), stop(), draw(force), running(), destroy()}.
 */
export function createMinimap(canvas, sceneSource, opts = {}) {
  const size = opts.size ?? PIP_SIZE;
  const now = opts.now ?? (() => Date.now());
  const reduced = opts.reduced ?? (() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const ctx = canvas.getContext?.('2d') ?? null;
  let last = null;
  let timer = 0;
  let pal = null;
  let palKey = null;

  // The theme the cached palette was read under: <html>'s data-theme and the
  // OS scheme. A draw under another key re-reads the tokens, so the PiP
  // follows the theme even when no `lb:theme` event reached it.
  const themeKey = () => {
    const html = globalThis.document?.documentElement;
    const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
    return `${html?.dataset?.theme ?? html?.getAttribute?.('data-theme') ?? ''}|${html?.className ?? ''}|${dark ? 'dark' : 'light'}`;
  };
  const palette = () => {
    const key = themeKey();
    if (!pal || key !== palKey) { pal = readPalette(canvas); palKey = key; }
    return pal;
  };

  function draw(force = false) {
    let scene = null;
    try { scene = sceneSource?.() ?? null; } catch { scene = null; }
    const t = now();
    if (!scene || !ctx) return false;
    if (!force && !shouldRedraw(last, scene, t, { reduced: reduced() })) return false;
    const phase = blinkPhase(t);
    last = { version: scene.version, at: t, phase };
    const pal = palette();
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (canvas.width !== px) canvas.width = px;
    if (canvas.height !== px) canvas.height = px;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, size, size);
    const tf = pipTransform(scene.outer, size);
    ctx.strokeStyle = pal.line;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    for (const r of ringsOf(scene.outer, tf)) {
      ctx.beginPath();
      ctx.arc(tf.cx, tf.cy, safeRadius(r), 0, Math.PI * 2);
      ctx.stroke();
    }
    const blinkOff = !reduced() && phase === 1;
    for (const d of dotsOf(scene, tf)) {
      const trouble = d.tone === 'crit' || d.tone === 'warn';
      ctx.globalAlpha = trouble && blinkOff ? 0.45 : d.tone === 'grey' ? 0.7 : 1;
      const c = toneColour(pal, d.tone);
      ctx.fillStyle = c;
      ctx.strokeStyle = c;
      dot(ctx, d, trouble ? 2.5 : 1.6);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = pal.line;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    return true;
  }

  const onClick = () => opts.onClick?.();
  canvas.addEventListener?.('click', onClick);
  // Theme changes repaint with the new tokens: the shell's `lb:theme`, any
  // other change of <html>'s theme attributes, and the OS scheme.
  const onTheme = () => { pal = null; draw(true); };
  globalThis.addEventListener?.('lb:theme', onTheme);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(onTheme) : null;
  const html = globalThis.document?.documentElement;
  if (html) mo?.observe(html, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', onTheme);

  function start() {
    if (timer) return;
    pal = null;
    draw(true);
    timer = setInterval(() => draw(false), PIP_FRAME_MS);
  }
  function stop() {
    clearInterval(timer);
    timer = 0;
  }
  function destroy() {
    stop();
    canvas.removeEventListener?.('click', onClick);
    globalThis.removeEventListener?.('lb:theme', onTheme);
    mo?.disconnect();
    mq?.removeEventListener?.('change', onTheme);
  }
  return { start, stop, draw, running: () => Boolean(timer), destroy };
}
