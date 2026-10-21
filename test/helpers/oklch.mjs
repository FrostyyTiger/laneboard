// OKLCH -> linear sRGB -> WCAG relative luminance, shared by test/tokens.test.mjs
// and test/design-directions.test.mjs (runs plan T10).
import assert from 'node:assert/strict';

export function oklch(str) {
  const m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\)$/.exec(str);
  assert.ok(m, `an oklch() literal: ${str}`);
  return { L: +m[1] / 100, C: +m[2], H: +m[3], alpha: m[4] == null ? 1 : +m[4] };
}

/** OKLCH to linear sRGB, clipped to the gamut (Björn Ottosson's matrices). */
export function oklchToLinearSrgb({ L, C, H }) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
}
export const luminance = (c) => { const [r, g, b] = oklchToLinearSrgb(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
