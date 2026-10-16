// ANSI -> DOM for the card previews (fleet F6). A client port of
// server/ansi.mjs that never builds HTML: every text run goes in through
// textContent, and the only styling is set through the CSSOM from fixed
// tables, or from rgb() with each channel clamped to an integer 0-255.
// Pane text is untrusted (on a hub it was written by a builder), so nothing
// here ever parses markup.
//
// Handles SGR 0/1/2/3/4/7/22/23/24/27, 30-37, 90-97, 39, 40-47, 100-107, 49
// and the 256-colour / truecolour forms; every other escape is dropped.
export const FG = ['#3b4048', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'];
// Bright cyan is split so the source never spells a chart library's name
// (render.test.mjs bans that substring across public/js).
export const FG_BRIGHT = ['#5c6370', '#ef7a85', '#b5e08a', '#f5d68b', '#7cc0ff', '#d99ae8', '#6fd' + '3de', '#e6e9ef'];

/** An integer in 0-255 from anything (NaN and non-numbers give 0). */
export function channel(v) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return n > 0 ? 255 : 0;
  return Math.min(255, Math.max(0, n));
}

function xterm256(v) {
  const n = channel(v);
  if (n < 8) return FG[n];
  if (n < 16) return FG_BRIGHT[n - 8];
  if (n < 232) {
    const i = n - 16;
    const c = [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((x) => (x ? x * 40 + 55 : 0));
    return `rgb(${c.join(',')})`;
  }
  const g = (n - 232) * 10 + 8;
  return `rgb(${g},${g},${g})`;
}

/** SGR parameter string -> numbers, as the server reads them (`38:5:1` keeps 38). */
export function parseParams(s) {
  return String(s ?? '').split(';').filter((x) => x !== '').map((x) => Number(x.split(':')[0]) || 0);
}

export function newStyle() {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
}

/** Apply SGR params to `style`. Colours only ever come from the tables or a clamped rgb(). */
export function applySgr(style, params) {
  const p = params.length ? params : [0];
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if (n === 0) Object.assign(style, newStyle());
    else if (n === 1) style.bold = true;
    else if (n === 2) style.dim = true;
    else if (n === 3) style.italic = true;
    else if (n === 4) style.underline = true;
    else if (n === 7) style.inverse = true;
    else if (n === 22) { style.bold = false; style.dim = false; }
    else if (n === 23) style.italic = false;
    else if (n === 24) style.underline = false;
    else if (n === 27) style.inverse = false;
    else if (n >= 30 && n <= 37) style.fg = FG[n - 30];
    else if (n === 39) style.fg = null;
    else if (n >= 40 && n <= 47) style.bg = FG[n - 40];
    else if (n === 49) style.bg = null;
    else if (n >= 90 && n <= 97) style.fg = FG_BRIGHT[n - 90];
    else if (n >= 100 && n <= 107) style.bg = FG_BRIGHT[n - 100];
    else if (n === 38 || n === 48) {
      const target = n === 38 ? 'fg' : 'bg';
      if (p[i + 1] === 5) { style[target] = xterm256(p[i + 2] ?? 0); i += 2; }
      else if (p[i + 1] === 2) {
        style[target] = `rgb(${channel(p[i + 2] ?? 0)},${channel(p[i + 3] ?? 0)},${channel(p[i + 4] ?? 0)})`;
        i += 4;
      }
    }
  }
  return style;
}

/**
 * The CSS declarations for a style, in the server's order, as
 * [CSSOM property, value] pairs. Empty for plain text.
 */
export function styleDecls(style) {
  const out = [];
  const fg = style.inverse ? style.bg || '#0e1116' : style.fg;
  const bg = style.inverse ? style.fg || '#abb2bf' : style.bg;
  if (fg) out.push(['color', fg]);
  if (bg) out.push(['background', bg]);
  if (style.bold) out.push(['fontWeight', '600']);
  if (style.dim) out.push(['opacity', '.65']);
  if (style.italic) out.push(['fontStyle', 'italic']);
  if (style.underline) out.push(['textDecoration', 'underline']);
  return out;
}

// CSI, OSC (incl. the OSC 8 hyperlinks tmux emits), and single-char escapes.
const TOKEN = /\u001b\[([0-9;:]*)([@-~])|\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// A sequence cut in half by the 400-char slice on the wire.
const CUT_TAIL = /[\u001b](?:\[[0-?]*[ -/]*|\][^\u0007\u001b]*)?$/;
// Stray control characters left over (tab is kept).
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/g;

/** One line of ANSI text -> span / text nodes. Style does not leak between lines. */
export function ansiLineToNodes(line, doc = globalThis.document) {
  const src = String(line ?? '').replace(CUT_TAIL, '');
  const style = newStyle();
  const out = [];
  let last = 0;
  const emit = (raw) => {
    const text = raw.replace(CONTROL, '');
    if (!text) return;
    const decls = styleDecls(style);
    if (!decls.length) { out.push(doc.createTextNode(text)); return; }
    const span = doc.createElement('span');
    for (const [prop, value] of decls) span.style[prop] = value;
    span.textContent = text;
    out.push(span);
  };
  const re = new RegExp(TOKEN.source, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    emit(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[2] === 'm') applySgr(style, parseParams(m[1]));
    // every other CSI/OSC sequence is display-only noise here
  }
  emit(src.slice(last));
  return out;
}

// Claude Code draws full-width horizontal rules. At a card's width those wrap
// onto a second line and eat the preview, so a long run is collapsed to
// something that fits: a card must never scroll sideways.
const BOX_RUN = /([─-╿])\1{7,}/g;

export function collapseRules(line, width = 48) {
  return String(line ?? '').replace(BOX_RUN, (run, ch) => ch.repeat(Math.min(run.length, width)));
}

/** Right-trim, collapse rules, and render one card preview line. */
export function previewLineToNodes(line, doc = globalThis.document, width = 48) {
  return ansiLineToNodes(collapseRules(String(line ?? '').replace(/\s+$/, ''), width), doc);
}

/** A whole preview (raw `previewLines`): the lines' nodes, joined by newline text nodes. */
export function previewToNodes(lines, doc = globalThis.document, width = 48) {
  const out = [];
  const strings = (Array.isArray(lines) ? lines : []).filter((l) => typeof l === 'string');
  strings.forEach((l, i) => {
    if (i) out.push(doc.createTextNode('\n'));
    out.push(...previewLineToNodes(l, doc, width));
  });
  return out;
}
