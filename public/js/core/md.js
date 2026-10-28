// The reply renderer's parser (cockpit spec c1-talk.md §3 "What a reply may contain",
// D22, D23, D25, D146, D227).
//
// Pure ES module: no imports, no DOM, no dependency, in the style of hl.js.
// parse(text, {done}) -> an array of plain block objects:
//
//   {type:'p', runs}                      a paragraph; its lines are kept, joined by '\n' runs
//   {type:'h', level, runs}               `#`, `##`, `###` (one style, as written)
//   {type:'list', items:[{level, marker, runs}]}   level 1 or 2 (deeper draws at 2)
//   {type:'quote', lines:[runs]}
//   {type:'rule'}
//   {type:'code', lang, lines:[string], open}      `open` while the fence has not closed
//   {type:'table', head:[runs], rows:[[runs]], align:['left'|'right']}
//   {type:'tail', runs, joins}            the last line, no newline yet: plain text and marks;
//                                         `joins` when it goes on the paragraph above
//
// Inline runs: {type:'text', text}, {type:'bold', text}, {type:'code', text},
// {type:'link', text, host}, {type:'image', alt}, {type:'mark', text, p}.
// The pane builds the DOM from these with textContent only (public/js/cockpit/reply.js),
// so nothing in a reply is ever parsed as markup: raw HTML is plain text here (D22).
//
// Every reply is the agent's, and the agent reads fields anyone can write: untrusted.
//   - a line longer than MAX_LINE (2000) characters is one plain `p` run;
//   - parse walks the lines once; inline scanning moves left to right with indexOf;
//   - every regex is anchored with no nested quantifiers (D146), the numeric-cell
//     one included, so no input can make one backtrack.
// `done: true` (the block is complete) reads the last line as a whole line: no tail.

export const MAX_LINE = 2000;

/** The four status marks and their lamp priority (docs/design.md, marks.js): colour travels with the shape (D25). */
export const MARKS = Object.freeze({ '■': '1', '▲': '2', '●': 'run', '○': 'off' });

/** A numeric table cell (c1-talk.md §3 "Which columns are right-aligned", D146), verbatim. */
export const NUMERIC_CELL = /^(?:[-+−]?\$?\d+(?:[.,]\d+)?(?: ?(?:%|(?:[KMGT]i?)?B|ms|s|min|h|d))?|\d+ h \d{2}|\d{1,2}:\d{2}(?::\d{2})?)$/;

const HEADING = /^(#{1,3}) +(\S.*)$/;
const BULLET = /^( *)[-*+] +(\S.*)$/;
const NUMBERED = /^( *)(\d{1,9})([.)]) +(\S.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,}) *$/;
const FENCE = /^ {0,3}(\x60{3,}|~{3,}) *([^\x60\s]*)/; // \x60: a backtick
const SEP_CELL = /^:?-+:?$/;
const BARE_URL = /^https?:\/\/[^\s<>()]+/i;
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"']); // left out of a bare URL's end

/** Split a string into text and mark runs (D25: the marks take their colour wherever they appear). */
export function splitMarks(s, type = 'text') {
  const out = [];
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const p = MARKS[s[i]];
    if (p === undefined) continue;
    if (i > from) out.push({ type, text: s.slice(from, i) });
    out.push({ type: 'mark', text: s[i], p });
    from = i + 1;
  }
  if (from < s.length) out.push({ type, text: s.slice(from) });
  return out;
}

/** The host of a URL, lower case; '' when it has none (then no ` (host)` is drawn). */
export function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Inline markup of one line, left to right (c1-talk.md §3's table; `*italic*` stays plain). */
export function inline(s) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(...splitMarks(buf)); buf = ''; } };
  // Once a closer is not found ahead, it is not looked for again: the scan stays linear.
  let noTick = false;
  let noBold = false;
  let noLink = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '`' && !noTick) {
      const end = s.indexOf('`', i + 1);
      if (end < 0) noTick = true;
      if (end > i + 1) { flush(); out.push({ type: 'code', text: s.slice(i + 1, end) }); i = end + 1; continue; }
    } else if (c === '*' && s[i + 1] === '*' && !noBold) {
      const end = s.indexOf('**', i + 2);
      if (end < 0) noBold = true;
      if (end > i + 2) { flush(); out.push(...splitMarks(s.slice(i + 2, end), 'bold')); i = end + 2; continue; }
    } else if ((c === '[' || (c === '!' && s[i + 1] === '[')) && !noLink) {
      const img = c === '!';
      const open = img ? i + 1 : i;
      const close = s.indexOf('](', open + 1);
      const end = close < 0 ? -1 : s.indexOf(')', close + 2);
      if (end < 0) noLink = true;
      const label = close < 0 ? '' : s.slice(open + 1, close);
      if (end > 0 && !label.includes(']')) {
        flush();
        const url = s.slice(close + 2, end).trim();
        out.push(img ? { type: 'image', alt: label } : { type: 'link', text: label, host: hostOf(url) });
        i = end + 1;
        continue;
      }
    } else if ((c === 'h' || c === 'H') && (i === 0 || !/\w/.test(s[i - 1]))) {
      const m = BARE_URL.exec(s.slice(i, i + MAX_LINE));
      if (m) {
        let url = m[0];
        while (TRAILING.has(url.at(-1))) url = url.slice(0, -1);
        flush();
        out.push({ type: 'link', text: url, host: hostOf(url) });
        i += url.length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** The plain text of runs (a cell's text with its inline markup taken off). */
export function plainText(runs) {
  return runs.map((r) => (r.type === 'image' ? `[image: ${r.alt}]` : r.text)).join('');
}

/** The cells of a table line: `| a | b |` -> ['a', 'b'] (an escaped `\|` stays in its cell). */
export function cellsOf(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isSeparator = (line) => line.includes('-') && cellsOf(line).every((c) => SEP_CELL.test(c));
const isTableStart = (line, next) => line.includes('|') && next !== undefined && isSeparator(next)
  && cellsOf(next).length === cellsOf(line).length;

/** numeric | neutral | other (D146). */
export function cellKind(text) {
  const t = text.trim();
  if (t === '' || t === '-' || t === '—') return 'neutral';
  return t.length <= 40 && NUMERIC_CELL.test(t) ? 'numeric' : 'other';
}

/**
 * A column's alignment (D146): GFM's `---:` right and `:---` left win; `:---:` and `---`
 * leave it to the rule: right when one body cell is numeric and every other is numeric or neutral.
 */
export function columnAlign(sep, bodyTexts) {
  const left = sep.startsWith(':');
  const right = sep.endsWith(':');
  if (right && !left) return 'right';
  if (left && !right) return 'left';
  const kinds = bodyTexts.map(cellKind);
  return kinds.includes('numeric') && !kinds.includes('other') ? 'right' : 'left';
}

function tableOf(head, sep, body) {
  const n = head.length;
  const fit = (cells) => Array.from({ length: n }, (_, k) => cells[k] ?? '');
  const rows = body.map((l) => fit(cellsOf(l)));
  return {
    type: 'table',
    head: head.map(inline),
    rows: rows.map((r) => r.map(inline)),
    align: sep.map((s, k) => columnAlign(s, rows.map((r) => plainText(inline(r[k]))))),
  };
}

/** `## Title ##` -> `Title`: the closing hashes go when a space stands before them (a loop, not a regex). */
function dropClosingHashes(s) {
  const end = s.trimEnd().length;
  let k = end;
  while (k > 0 && s[k - 1] === '#') k--;
  if (k === end || (k > 0 && s[k - 1] !== ' ')) return s.slice(0, end);
  return k === 0 ? '' : s.slice(0, k).trimEnd();
}

/** The reply's text as blocks (see the top of this file). */
export function parse(text, { done = false } = {}) {
  const src = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  const lines = src.split('\n');
  let tail = null;
  if (!done) tail = lines.pop(); // '' when the text ends on a newline
  else if (lines.at(-1) === '') lines.pop();

  const blocks = [];
  let para = null;
  let list = null;
  let quote = null;
  let code = null;
  const close = () => { para = null; list = null; quote = null; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (code) {
      const m = FENCE.exec(line);
      if (m && m[1][0] === code.fence[0] && m[1].length >= code.fence.length && m[2] === '' && line.trim() === m[1]) {
        code.open = false;
        delete code.fence;
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    if (line.length > MAX_LINE) {
      close();
      blocks.push({ type: 'p', runs: [{ type: 'text', text: line }] });
      continue;
    }
    if (line.trim() === '') { close(); continue; }
    const next = i + 1 < lines.length ? lines[i + 1] : undefined;
    let m;
    if ((m = FENCE.exec(line))) {
      close();
      code = { type: 'code', lang: m[2] || null, lines: [], open: true, fence: m[1] };
      blocks.push(code);
    } else if ((m = HEADING.exec(line))) {
      close();
      blocks.push({ type: 'h', level: m[1].length, runs: inline(dropClosingHashes(m[2])) });
    } else if (RULE.test(line)) {
      close();
      blocks.push({ type: 'rule' });
    } else if (isTableStart(line, next)) {
      close();
      const body = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '' && lines[j].length <= MAX_LINE) body.push(lines[j++]);
      blocks.push(tableOf(cellsOf(line), cellsOf(next), body));
      i = j - 1;
    } else if ((m = BULLET.exec(line)) || (m = NUMBERED.exec(line))) {
      const numbered = m.length === 5;
      if (!list) { para = null; quote = null; list = { type: 'list', items: [] }; blocks.push(list); }
      list.items.push({
        level: m[1].length >= 2 ? 2 : 1, // three levels and deeper draw at level 2
        marker: numbered ? `${m[2]}${m[3]}` : '·',
        runs: inline(numbered ? m[4] : m[2]),
      });
    } else if ((m = QUOTE.exec(line))) {
      if (!quote) { para = null; list = null; quote = { type: 'quote', lines: [] }; blocks.push(quote); }
      quote.lines.push(inline(m[1]));
    } else if (para) {
      para.runs.push({ type: 'text', text: '\n' }, ...inline(line));
    } else {
      close();
      para = { type: 'p', runs: inline(line) };
      blocks.push(para);
    }
  }

  if (tail) {
    if (code) {
      // A closing fence still being written is not a line of the block.
      const t = tail.trim();
      if (!(t.length > 0 && t.length <= code.fence.length && [...t].every((ch) => ch === code.fence[0]))) code.lines.push(tail);
    } else {
      const runs = tail.length > MAX_LINE ? [{ type: 'text', text: tail }] : splitMarks(tail);
      blocks.push({ type: 'tail', runs, joins: Boolean(para) && blocks.at(-1) === para });
    }
  }
  if (code) delete code.fence;
  return blocks;
}
