// A reply's text block drawn from md.js's blocks (cockpit spec c1-talk.md §3 "What a
// reply may contain", "The cockpit's own lines"; D22, D23, D25, D146, D225, D227).
// textContent only, never innerHTML: nothing an agent writes is parsed as markup here.
//
//   const host = drawText(doc, node, blocks, ui)   // node's children replaced; host takes the cursor
//
// `ui` lives as long as the text block: `ui.expanded` holds the code blocks (by their
// order in the text) whose SHOW ALL was tapped, so a redraw while the block streams
// keeps them open.
//
// D227: nothing drawn here uses `--line-strong` (that left rule is the cockpit's own
// lines'): a quote's rule and a code block's are `--line`, inline code and table rows
// `--line-weak`, headings 28 px as written, never 16 px caps (cockpit.css `.ck-md-*`).
import { MAX_LINE, splitMarks } from '../core/md.js';

/** A code block shows this many lines, the rest behind `SHOW ALL <n> LINES` (D23). */
export const CODE_LINES_SHOWN = 12;

const el = (doc, tag, cls, attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

const lastKid = (n) => n.children[n.children.length - 1] ?? null;

/** One status mark in its colour (D25): `[data-mark]` with the lamp priority of marks.js. */
function mark(doc, text, p) {
  const n = el(doc, 'span', 'ck-md-mark', { 'data-mark': p });
  n.textContent = text;
  return n;
}

/** Inline runs into `parent` (c1-talk.md §3's table). */
export function drawRuns(doc, parent, runs) {
  for (const r of runs) {
    if (r.type === 'mark') { parent.append(mark(doc, r.text, r.p)); continue; }
    if (r.type === 'text') { parent.append(doc.createTextNode(r.text)); continue; }
    if (r.type === 'bold') {
      const n = el(doc, 'span', 'ck-md-b');
      n.textContent = r.text;
      parent.append(n);
    } else if (r.type === 'code') {
      const n = el(doc, 'span', 'ck-md-ic');
      n.textContent = r.text;
      parent.append(n);
    } else if (r.type === 'link') {
      // D22, D225: a span, never an <a>, no href; not tappable, no pressed state.
      const n = el(doc, 'span', 'ck-md-link', { 'data-link': '' });
      n.textContent = r.text;
      parent.append(n);
      if (r.host) {
        const h = el(doc, 'span', 'ck-md-host');
        h.textContent = ` (${r.host})`;
        parent.append(h);
      }
    } else if (r.type === 'image') {
      // Nothing is fetched: the alt text only (D22).
      const n = el(doc, 'span', 'ck-md-img');
      n.textContent = `[image: ${r.alt}]`;
      parent.append(n);
    }
  }
}

/** A code line with its marks coloured (D25); a line over 2 000 characters stays one text node. */
function codeLine(doc, text) {
  const n = el(doc, 'span', 'ck-md-line');
  if (text.length > MAX_LINE) n.textContent = text;
  else for (const r of splitMarks(text)) n.append(r.type === 'mark' ? mark(doc, r.text, r.p) : doc.createTextNode(r.text));
  if (text === '') n.textContent = '​'; // an empty line keeps its height
  return n;
}

/**
 * Code (c1-talk.md §3 "Code", D23): the `pre`, mono 18 px, never wrapping, scrolling sideways
 * on its own; the fence's language top right; past 12 lines the first 12 and a full-width button.
 */
function codeBlock(doc, b, key, ui) {
  const box = el(doc, 'div', 'ck-md-codebox');
  const pre = el(doc, 'pre', 'ck-md-code');
  const lines = b.lines.map((l) => codeLine(doc, l));
  pre.append(...lines);
  // The block is as wide as its longest line, the folded ones included, so it scrolls
  // sideways the same folded or open (S-C1-08); 1ch is one mono character (CSSOM, no style attribute).
  const widest = b.lines.reduce((w, l) => Math.max(w, Math.min(l.length, MAX_LINE * 4)), 0);
  pre.style.setProperty('--ck-code-ch', String(widest));
  box.append(pre);
  if (b.lang) {
    const lang = el(doc, 'span', 'ck-md-lang');
    lang.textContent = b.lang.toUpperCase(); // 16 px caps (D21's floor)
    box.append(lang);
  }
  let host = lines.at(-1) ?? pre;
  if (lines.length > CODE_LINES_SHOWN) {
    const more = el(doc, 'button', 'ck-md-more', { type: 'button' });
    const show = (all) => {
      lines.forEach((l, k) => { l.hidden = !all && k >= CODE_LINES_SHOWN; });
      more.textContent = all ? 'SHOW LESS' : `SHOW ALL ${lines.length} LINES`;
      more.setAttribute('aria-expanded', String(all));
    };
    show(ui.expanded.has(key));
    more.addEventListener('click', () => {
      const all = !ui.expanded.has(key);
      if (all) ui.expanded.add(key); else ui.expanded.delete(key);
      show(all);
    });
    box.append(more);
    if (!ui.expanded.has(key)) host = lines[CODE_LINES_SHOWN - 1];
  }
  return { node: box, host };
}

/** Tables (c1-talk.md §3 "Tables", D23, D146): every row, sideways scroll, the first column fixed. */
function tableBlock(doc, b) {
  const box = el(doc, 'div', 'ck-md-tablebox');
  const t = el(doc, 'table', 'ck-md-table');
  const row = (cells, tag) => {
    const tr = el(doc, 'tr');
    cells.forEach((runs, k) => {
      const c = el(doc, tag, b.align[k] === 'right' ? 'ck-md-right' : null);
      drawRuns(doc, c, runs);
      tr.append(c);
    });
    return tr;
  };
  const head = el(doc, 'thead');
  head.append(row(b.head, 'th'));
  const body = el(doc, 'tbody');
  for (const r of b.rows) body.append(row(r, 'td'));
  t.append(head, body);
  box.append(t);
  const lastRow = lastKid(body) ?? lastKid(head);
  return { node: box, host: lastKid(lastRow) };
}

/** One block of md.js into its element and the element the streaming cursor follows. */
function blockNode(doc, b, key, ui) {
  switch (b.type) {
    case 'h': {
      const n = el(doc, 'div', 'ck-md-h', { role: 'heading', 'aria-level': String(b.level + 2) });
      drawRuns(doc, n, b.runs);
      return { node: n, host: n };
    }
    case 'list': {
      const n = el(doc, 'div', 'ck-md-list', { role: 'list' });
      let host = n;
      for (const it of b.items) {
        const li = el(doc, 'div', 'ck-md-li', { role: 'listitem', 'data-level': String(it.level) });
        const m = el(doc, 'span', 'ck-md-marker');
        m.textContent = it.marker;
        const body = el(doc, 'span', 'ck-md-item');
        drawRuns(doc, body, it.runs);
        li.append(m, body);
        n.append(li);
        host = body;
      }
      return { node: n, host };
    }
    case 'quote': {
      const n = el(doc, 'div', 'ck-md-quote');
      b.lines.forEach((runs, k) => {
        if (k > 0) n.append(doc.createTextNode('\n'));
        drawRuns(doc, n, runs);
      });
      return { node: n, host: n };
    }
    case 'rule': {
      const n = el(doc, 'div', 'ck-md-rule', { role: 'separator' });
      return { node: n, host: null };
    }
    case 'code': return codeBlock(doc, b, key, ui);
    case 'table': return tableBlock(doc, b);
    default: { // 'p' and 'tail'
      const n = el(doc, 'p', 'ck-md-p');
      drawRuns(doc, n, b.runs);
      return { node: n, host: n };
    }
  }
}

/**
 * Replace `node`'s children with the blocks; returns the element the cursor follows (the
 * last character's, c1-talk.md §3 "Streaming"). A `tail` that `joins` goes on the paragraph
 * above it, on its own line, so a line still being written does not jump when it ends.
 */
export function drawText(doc, node, blocks, ui) {
  const nodes = [];
  let host = null;
  let last = null;
  let codes = 0;
  for (const b of blocks) {
    if (b.type === 'tail' && b.joins && last?.classList.contains('ck-md-p')) {
      last.append(doc.createTextNode('\n'));
      drawRuns(doc, last, b.runs);
      host = last;
      continue;
    }
    const key = b.type === 'code' ? codes++ : null;
    const d = blockNode(doc, b, key, ui);
    nodes.push(d.node);
    last = d.node;
    host = d.host ?? host;
  }
  node.textContent = '';
  node.append(...nodes);
  for (const box of node.querySelectorAll('.ck-md-tablebox')) {
    // The first column is fixed on --bg-elevated only once the table is wider than its block.
    box.classList.toggle('ck-md-wide', box.scrollWidth > box.clientWidth);
  }
  return host;
}
