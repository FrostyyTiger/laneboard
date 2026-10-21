// The CSS reader and the guardrail checker of test/design-guardrails.test.mjs,
// shared with test/design-directions.test.mjs (runs plan T10), which checks the
// token override files under docs/plans/runs/design/ with the same rules.
// --- a small CSS reader ------------------------------------------------------

/** Split at `sep` outside (), [], quotes. */
export function splitTop(s, sep) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Every declaration as {prelude, at, prop, value}; `at` lists enclosing at-rules. */
export function declarations(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const keyframes = [];
  (function walk(src, at) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      const prelude = src.slice(i, open).replace(/\s+/g, ' ').trim();
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      i = j;
      const kf = /^@keyframes\s+([\w-]+)/.exec(prelude);
      if (kf) { keyframes.push(kf[1]); continue; }
      if (prelude.startsWith('@') && prelude !== '@font-face') { walk(body, [...at, prelude]); continue; }
      for (const d of splitTop(body, ';')) {
        const k = d.indexOf(':');
        if (k < 0) continue;
        out.push({ prelude, at, prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim().replace(/\s+/g, ' ') });
      }
    }
  })(css, []);
  return { decls: out, keyframes };
}

const GRADIENT = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const COLOUR_LITERAL = /\b(?:oklch|oklab|lch|lab|rgba?|hsla?|hwb|color)\(|#[0-9a-f]{3,8}\b/i;
const TEXTURE_TOKEN = /^--(?:tex-[\w-]+|bracket-img)$/;
const RADIUS_OK = new Set(['var(--radius)', '0', '50%']);
const TRANSITION_PROPS = new Set(['opacity', 'transform', 'width']);
const LAMP_GLOW = /^\.lamp\[data-p="[12]"\]$/;

function ms(t) {
  const m = /^([\d.]+)(ms|s)$/.exec(t);
  return m ? +m[1] * (m[2] === 's' ? 1000 : 1) : null;
}

/** Guardrail breaches in one sheet, as readable strings. */
export function violations(file, cssText, { tokens: isTokens = file === 'tokens.css' } = {}) {
  const { decls, keyframes } = declarations(cssText);
  const v = [];
  const where = (d) => `${file}: ${d.prelude} { ${d.prop}: ${d.value} }`;
  for (const kf of keyframes) if (kf !== 'lb-flash') v.push(`${file}: @keyframes ${kf} (only lb-flash) [6]`);
  for (const d of decls) {
    const { prop, value } = d;
    // 1. Gradients only inside the texture tokens.
    if (GRADIENT.test(value) && !(isTokens && TEXTURE_TOKEN.test(prop))) v.push(`${where(d)} gradient [1]`);
    // 2. No backdrop-filter, no glass.
    if (/^(-webkit-)?backdrop-filter$/.test(prop)) v.push(`${where(d)} backdrop-filter [2]`);
    // 3. No box-shadow; drop-shadow only as the p1/p2 lamp glow.
    if (prop === 'box-shadow' && value !== 'none') v.push(`${where(d)} box-shadow [3]`);
    if (/drop-shadow\(/.test(value) && !splitTop(d.prelude, ',').every((s) => LAMP_GLOW.test(s.trim()))) {
      v.push(`${where(d)} drop-shadow outside .lamp[data-p="1"|"2"] [3]`);
    }
    // 4. Colour literals only in tokens.css.
    if (!isTokens && COLOUR_LITERAL.test(value)) v.push(`${where(d)} colour literal [4]`);
    // 6. Transitions: 120ms or less, opacity/transform/width only; animation only lb-flash.
    if (prop === 'transition' || prop === 'transition-property' || prop === 'transition-duration') {
      for (const part of splitTop(value, ',')) {
        const words = part.trim().split(' ');
        for (const w of words) { const t = ms(w); if (t != null && t > 120) v.push(`${where(d)} ${w} > 120ms [6]`); }
        if (prop !== 'transition-duration' && words[0] !== 'none' && !TRANSITION_PROPS.has(words[0])) {
          v.push(`${where(d)} transitions ${words[0]} [6]`);
        }
      }
    }
    if ((prop === 'animation' || prop === 'animation-name') && !/^(none|lb-flash\b)/.test(value)) {
      v.push(`${where(d)} animation other than lb-flash [6]`);
    }
    // 7. Radius: var(--radius), 0 or 50%.
    if (/^border(-[a-z]+)*-radius$/.test(prop) && !value.split(/[ /]+/).every((p) => RADIUS_OK.has(p))) {
      v.push(`${where(d)} radius [7]`);
    }
    // 8. Fonts only through the two tokens (the @font-face names are their sources).
    if (prop === 'font-family' && d.prelude !== '@font-face' && !/^(var\(--font-(mono|label)\)|inherit)$/.test(value)) {
      v.push(`${where(d)} font-family [8]`);
    }
    if (prop === 'font' && !/^(inherit|var\(--font-(mono|label)\))$/.test(value) && !/var\(--font-(mono|label)\)/.test(value)) {
      v.push(`${where(d)} font shorthand without a font token [8]`);
    }
  }
  return v;
}

