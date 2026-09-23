// Tiny ANSI -> HTML converter for the card preview. No library (hard rule 7).
// Handles SGR 0/1/2/3/4/7/22/23/24/27, 30-37, 90-97, 39, 40-47, 100-107, 49
// and the 256-colour / truecolour forms; every other escape is dropped.
const FG = ['#3b4048', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'];
const FG_BRIGHT = ['#5c6370', '#ef7a85', '#b5e08a', '#f5d68b', '#7cc0ff', '#d99ae8', '#6fd3de', '#e6e9ef'];

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function xterm256(n) {
  if (n < 8) return FG[n];
  if (n < 16) return FG_BRIGHT[n - 8];
  if (n < 232) {
    const i = n - 16;
    const c = [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((v) => (v ? v * 40 + 55 : 0));
    return `rgb(${c.join(',')})`;
  }
  const g = (n - 232) * 10 + 8;
  return `rgb(${g},${g},${g})`;
}

function applySgr(style, params) {
  const p = params.length ? params : [0];
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if (n === 0) { style.fg = null; style.bg = null; style.bold = false; style.dim = false; style.italic = false; style.underline = false; style.inverse = false; }
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
      else if (p[i + 1] === 2) { style[target] = `rgb(${p[i + 2] ?? 0},${p[i + 3] ?? 0},${p[i + 4] ?? 0})`; i += 4; }
    }
  }
}

function styleAttr(style) {
  const bits = [];
  const fg = style.inverse ? style.bg || '#0e1116' : style.fg;
  const bg = style.inverse ? style.fg || '#abb2bf' : style.bg;
  if (fg) bits.push(`color:${fg}`);
  if (bg) bits.push(`background:${bg}`);
  if (style.bold) bits.push('font-weight:600');
  if (style.dim) bits.push('opacity:.65');
  if (style.italic) bits.push('font-style:italic');
  if (style.underline) bits.push('text-decoration:underline');
  return bits.join(';');
}

// CSI, OSC (incl. the OSC 8 hyperlinks tmux emits), and single-char escapes.
const TOKEN = /\u001b\[([0-9;:]*)([@-~])|\u001b\]([^\u0007\u001b]*)(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** Convert one line of ANSI text to HTML. Style does not leak between lines. */
export function ansiLineToHtml(line) {
  const style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
  let out = '';
  let last = 0;
  const emit = (text) => {
    if (!text) return;
    const attr = styleAttr(style);
    out += attr ? `<span style="${attr}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(line)) !== null) {
    emit(line.slice(last, m.index));
    last = TOKEN.lastIndex;
    if (m[2] === 'm') applySgr(style, (m[1] || '').split(';').filter((x) => x !== '').map((x) => Number(x.split(':')[0]) || 0));
    // every other CSI/OSC sequence is display-only noise here
  }
  emit(line.slice(last));
  return out;
}

export function ansiToHtml(lines) {
  return lines.map(ansiLineToHtml).join('\n');
}

// Claude Code draws full-width horizontal rules. At a card's width those wrap
// onto a second line and eat the preview, so a long run is collapsed to
// something that fits: a card must never scroll sideways.
const BOX_RUN = /([\u2500-\u257f])\1{7,}/g;

export function collapseRules(line, width = 48) {
  return line.replace(BOX_RUN, (run, ch) => ch.repeat(Math.min(run.length, width)));
}

/** Right-trim, collapse rules, and render — one card preview line. */
export function previewLineToHtml(line, width = 48) {
  return ansiLineToHtml(collapseRules(line.replace(/\s+$/, ''), width));
}
