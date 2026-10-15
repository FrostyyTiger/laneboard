// No HTML from data anywhere in the client (fleet F6; covers §10 T10.17).
// Everything a builder sends is untrusted text: it reaches the page through
// textContent and the CSSOM only. This scans every module under public/js/**
// (and the service worker) for the sinks that would parse a string as markup
// or code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

const FORBIDDEN = [
  // The plan's `innerHTML\s*=\s*(?!['"]{2})`, tightened: the only allowed
  // write clears the node (`= ''` and nothing appended to it).
  ['innerHTML assignment (other than clearing to \'\')', /innerHTML\s*=(?!=)(?!\s*(['"])\1\s*(?:[;,)}]|$))/],
  ['innerHTML +=', /innerHTML\s*\+=/],
  ['outerHTML assignment', /outerHTML\s*\+?=/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\.write/],
  ['new Function', /new\s+Function\b/],
  ['eval(', /(?<![\w$.])eval\s*\(/],
  ['createContextualFragment', /createContextualFragment/],
  ['setHTMLUnsafe', /setHTMLUnsafe/],
  ['srcdoc', /srcdoc/],
];

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.m?js$/.test(e.name)) out.push(p);
  }
  return out;
}

function violations(src) {
  const found = [];
  src.split('\n').forEach((line, i) => {
    for (const [what, re] of FORBIDDEN) if (re.test(line)) found.push({ line: i + 1, what });
  });
  return found;
}

test('the lint catches every forbidden sink and lets the safe forms through', () => {
  const bad = [
    "pre.innerHTML = s.previewHtml.join('\\n');",
    'el.innerHTML=html',
    'el.innerHTML += x',
    "el.innerHTML = '' + data;",
    "el.outerHTML = '<b>'",
    "el.insertAdjacentHTML('beforeend', x)",
    'document.write(x)',
    'document.writeln(x)',
    "const f = new Function('return 1')",
    'eval(code)',
    'range.createContextualFragment(x)',
    'el.setHTMLUnsafe(x)',
    'frame.srcdoc = x',
  ];
  for (const b of bad) assert.ok(violations(b).length, `must be flagged: ${b}`);
  const ok = [
    "root.innerHTML = '';",
    'root.innerHTML = "";',
    'root.replaceChildren();',
    'n.textContent = text;',
    'span.style.color = c;',
    'const medieval = 1; retrieval(x);',
  ];
  for (const g of ok) assert.deepEqual(violations(g), [], `must pass: ${g}`);
});

test('no module under public/js builds HTML or code from strings', () => {
  const files = [...walk(JS), path.join(ROOT, 'public', 'sw.js')].filter((f) => fs.existsSync(f));
  assert.ok(files.length > 10, 'the scan must actually see the client modules');
  const bad = [];
  for (const f of files) {
    for (const v of violations(fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(ROOT, f)}:${v.line} ${v.what}`);
  }
  assert.deepEqual(bad, [], `forbidden sinks:\n${bad.join('\n')}`);
});

test('the card preview is built by core/ansi.js, not from a previewHtml string', () => {
  const card = fs.readFileSync(path.join(JS, 'views', 'board-card.js'), 'utf8');
  assert.match(card, /from '\.\.\/core\/ansi\.js'/);
  assert.match(card, /previewToNodes\(s\.previewLines/);
  assert.doesNotMatch(card, /s\.previewHtml/);
});
