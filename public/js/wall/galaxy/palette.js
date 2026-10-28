// The galaxy's colours (Wall plan night 2 T3), read from laneboard's tokens:
// WebGL needs numbers, the tokens are CSS strings (oklch, and the Wall's
// brighter steps are color-mix of them), so this turns one into the other.
// The status hues are the only colours (docs/design.md: grey unless
// something needs you): crit --p1, warn --p2, low --p3; everything calm,
// the sun and the dust included, is a step of the greys.
//
// Pure: `paletteFrom(readVar)` takes a lookup of custom properties
// (`getComputedStyle(root).getPropertyValue` in the page), so
// test/wall-galaxy-palette.test.mjs runs it without a browser.

import { statusStyle } from '../../views/map/overlays.js';
import { TIGHT } from './layout.js';

/** The tokens' dark values, when a property is missing (as render.js's FALLBACK). */
const FALLBACK = Object.freeze({
  '--p1': 'oklch(62% 0.23 25)',
  '--p2': 'oklch(84% 0.16 95)',
  '--p3': 'oklch(74% 0.11 220)',
  '--text-1': 'oklch(96% 0.002 250)',
  '--text-2': 'oklch(78% 0.004 250)',
  '--text-3': 'oklch(62% 0.004 250)',
  '--bg-canvas': 'oklch(12% 0.004 250)',
  '--line-strong': 'oklch(100% 0 0 / 0.32)',
});

/** The four looks a thing in the galaxy can have, quietest first. */
export const TONES = Object.freeze(['calm', 'low', 'warn', 'crit']);

/**
 * A nebula per tone: how strong (additive opacity), how big (world units
 * across; the layout keeps stars MIN_SITE_GAP apart so these never meet)
 * and whether it breathes. Calm is a faint grey haze; trouble is the
 * loudest thing on screen, crit the only one that moves. Night 5 A1: at
 * TIGHT.neb (0.64x) of nights 1-4's, with the tighter arms.
 */
export const NEBULA = Object.freeze({
  calm: Object.freeze({ opacity: 0.2, size: 520 * TIGHT.neb, breathes: false }),
  low: Object.freeze({ opacity: 0.4, size: 560 * TIGHT.neb, breathes: false }),
  warn: Object.freeze({ opacity: 0.7, size: 640 * TIGHT.neb, breathes: false }),
  crit: Object.freeze({ opacity: 0.85, size: 680 * TIGHT.neb, breathes: true }),
});

/** A status word (or a node) to the galaxy's tone, by the Map's statusStyle. */
export function toneOf(status) {
  const node = status && typeof status === 'object' ? status : { status };
  const t = statusStyle(node).tone;
  return t === 'crit' || t === 'warn' || t === 'low' ? t : 'calm';
}

/** The louder of two tones. */
export const worseTone = (a, b) => (TONES.indexOf(b) > TONES.indexOf(a) ? b : a);

/** The nebula of a site whose worst status (tour.js `tourSites`) is `status`. */
export function nebulaFor(status) {
  const tone = toneOf(status);
  return { tone, ...NEBULA[tone] };
}

/**
 * How far the dust's grey sits from text-3 toward the ground (0: text-3, 1:
 * the ground), by the sun and at the rim: below every node mark, so a grain
 * never reads as a node (T26, reviews/r26-skeptic.md 5).
 */
export const DUST_INK = Object.freeze({ in: 0.4, out: 0.68 });

/** A lookup that knows no property. */
const unset = () => '';

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const num = (s, scale = 1) => {
  const t = String(s).trim();
  if (t.endsWith('%')) return (parseFloat(t) / 100) * scale;
  return parseFloat(t);
};

/** OKLCH (L 0..1, C, H degrees) to sRGB 0..1, clipped to the gamut. */
export function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => clamp01(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}

/** Split `a, b c, d(e, f)` at the commas outside parentheses. */
function splitTop(s) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  out.push(s.slice(from).trim());
  return out;
}

/** A colour and its share in a color-mix argument (`var 74%`), or null. */
function mixPart(s) {
  const m = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(s.trim());
  return m ? { colour: m[1].trim(), pct: m[2] != null ? Number(m[2]) / 100 : null } : null;
}

/** sRGB 0..1 back to OKLCH, for mixing the way color-mix(in oklch) does. */
function rgbToOklch([r, g, b]) {
  const lin = [r, g, b].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
  const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
  const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}

/**
 * A CSS colour to `[r, g, b, alpha]` (sRGB, 0..1), or null for what it
 * cannot read. Reads what the tokens use: `oklch()`, `rgb()`, `#hex`,
 * `transparent` and `color-mix(in oklch, A p%, B)`; `vars` resolves a
 * `var(--x)` inside a mix.
 */
export function parseColor(css, vars = unset) {
  const s = String(css ?? '').trim();
  if (!s) return null;
  if (s === 'transparent') return [0, 0, 0, 0];
  const v = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.*))?\)$/.exec(s);
  if (v) return parseColor(vars(v[1]) || v[2] || '', vars);
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).concat(1);
  }
  m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const rgb = oklchToRgb(num(m[1]), num(m[2], 0.4), Number(m[3]));
    return [...rgb, m[4] != null ? clamp01(num(m[4])) : 1];
  }
  m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const c = [m[1], m[2], m[3]].map((x) => clamp01(x.endsWith('%') ? num(x) : Number(x) / 255));
    return [...c, m[4] != null ? clamp01(num(m[4])) : 1];
  }
  m = /^color-mix\(\s*in\s+oklch\s*,(.*)\)$/i.exec(s);
  if (m) {
    const parts = splitTop(m[1]).map(mixPart);
    if (parts.length !== 2 || parts.some((p) => !p)) return null;
    const [p, q] = parts;
    const wp = p.pct ?? (q.pct != null ? 1 - q.pct : 0.5);
    const A = parseColor(p.colour, vars), B = parseColor(q.colour, vars);
    if (!A || !B) return null;
    if (B[3] === 0) return [A[0], A[1], A[2], A[3] * wp];
    if (A[3] === 0) return [B[0], B[1], B[2], B[3] * (1 - wp)];
    const a = rgbToOklch(A), b = rgbToOklch(B);
    // Hue the shorter way round; an achromatic side takes the other's hue.
    let ha = a[2], hb = b[2];
    if (a[1] < 1e-4) ha = hb;
    if (b[1] < 1e-4) hb = ha;
    if (hb - ha > 180) ha += 360; else if (ha - hb > 180) hb += 360;
    const mix = (x, y) => x * wp + y * (1 - wp);
    return [...oklchToRgb(mix(a[0], b[0]), mix(a[1], b[1]), mix(ha, hb) % 360), mix(A[3], B[3])];
  }
  return null;
}

/** `a` toward `b` by `k` (0..1), in sRGB: for a ramp between two greys. */
export const mixRgb = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);

/**
 * The galaxy's palette from the tokens. `readVar(name)` returns a custom
 * property's value as a string (empty when unset). Every entry is
 * `[r, g, b]` in sRGB 0..1; `line` also carries its alpha.
 */
export function paletteFrom(readVar = unset) {
  const raw = (name) => {
    const got = typeof readVar === 'function' ? readVar(name) : '';
    return typeof got === 'string' && got.trim() ? got.trim() : '';
  };
  const read = (name) => parseColor(raw(name), raw) ?? parseColor(FALLBACK[name]);
  const rgb = (name) => read(name).slice(0, 3);
  const bg = rgb('--bg-canvas');
  const t1 = rgb('--text-1'), t2 = rgb('--text-2'), t3 = rgb('--text-3');
  const line = read('--line-strong');
  return {
    crit: rgb('--p1'),
    warn: rgb('--p2'),
    low: rgb('--p3'),
    calm: t3,
    bright: t2,
    sun: t1,
    // The sun's own disc and halo: a step down from the light it gives (r8-film-ui 2).
    sunCore: t2,
    // The sun once the data is old (night 3 T6): cold, the text-3 grey, never a trouble hue.
    sunCold: t3,
    bg,
    line: { rgb: line.slice(0, 3), alpha: line[3] },
    // The dust: a backdrop, so darker than the dimmest node (calm, text-3) even
    // by the sun, fading further toward the ground at the rim (T26, r26-skeptic 5).
    dustIn: mixRgb(t3, bg, DUST_INK.in),
    dustOut: mixRgb(t3, bg, DUST_INK.out),
    // The arm ribbon (night 3 T3): text-3 at most, drawn at a few per cent under the dust.
    arm: t3,
    // Far stars: a dim grey, behind everything.
    stars: mixRgb(t3, bg, 0.35),
  };
}
