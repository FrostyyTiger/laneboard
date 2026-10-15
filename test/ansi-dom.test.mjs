// public/js/core/ansi.js: the client-side ANSI renderer (fleet F6). It must
// match server/ansi.mjs once serialised, and it must never let pane text
// become markup: text goes in through textContent, colours only from the
// tables or a clamped rgb().
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeDocument } from './helpers/fakedom.mjs';
import { ansiLineToHtml, escapeHtml, previewLineToHtml, collapseRules as serverCollapse } from '../server/ansi.mjs';
import {
  ansiLineToNodes, previewLineToNodes, previewToNodes, collapseRules, applySgr, parseParams, newStyle, channel,
} from '../public/js/core/ansi.js';

const ESC = '\u001b';
const doc = makeDocument();

// CSSOM property -> CSS name, in the order server/ansi.mjs writes them.
const CSS = [['color', 'color'], ['background', 'background'], ['fontWeight', 'font-weight'],
  ['opacity', 'opacity'], ['fontStyle', 'font-style'], ['textDecoration', 'text-decoration']];

function serialise(nodes) {
  return nodes.map((n) => {
    if (n.tagName === '#TEXT') return escapeHtml(n.textContent);
    assert.equal(n.tagName, 'SPAN');
    assert.equal(n.children.length, 0, 'a span holds text only');
    const attr = CSS.filter(([p]) => n.style[p]).map(([p, css]) => `${css}:${n.style[p]}`).join(';');
    return `<span style="${attr}">${escapeHtml(n.textContent)}</span>`;
  }).join('');
}

test('markup in pane text stays one literal span with no element children', () => {
  const nodes = ansiLineToNodes(`${ESC}[31m<img src=x onerror=alert(1)>`, doc);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].tagName, 'SPAN');
  assert.equal(nodes[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(nodes[0].children.length, 0);
  assert.equal(nodes[0].innerHTML, '', 'innerHTML is never written');
  assert.equal(nodes[0].style.color, '#e06c75');
});

test('truecolour channels are clamped to integers 0-255', () => {
  const style = applySgr(newStyle(), parseParams('38;2;999;-1;abc'));
  assert.equal(style.fg, 'rgb(255,0,0)');
  assert.equal(applySgr(newStyle(), [48, 2, 12.7, 1e9, -5]).bg, 'rgb(12,255,0)');
  assert.equal(applySgr(newStyle(), [38, 2, Infinity, NaN, -Infinity]).fg, 'rgb(255,0,0)');
  const [span] = ansiLineToNodes(`${ESC}[38;2;999;300;7mx`, doc);
  assert.equal(span.style.color, 'rgb(255,255,7)');
  assert.equal(channel('abc'), 0);
});

test('256-colour indexes out of range are clamped, never echoed', () => {
  assert.equal(applySgr(newStyle(), [38, 5, 9999]).fg, 'rgb(238,238,238)');
  assert.equal(applySgr(newStyle(), [38, 5, -3]).fg, '#3b4048');
});

test('colour values only come from the tables or rgb()', () => {
  const lines = [`${ESC}[31;42mx`, `${ESC}[38;5;200mx`, `${ESC}[48;5;250mx`, `${ESC}[7mx`, `${ESC}[38;2;1;2;3mx`, `${ESC}[95;105mx`];
  for (const l of lines) {
    for (const n of ansiLineToNodes(l, doc)) {
      for (const v of [n.style.color, n.style.background].filter(Boolean)) {
        assert.match(v, /^(#[0-9a-f]{6}|rgb\(\d{1,3},\d{1,3},\d{1,3}\))$/, v);
      }
    }
  }
});

const VECTORS = [
  'hello world',
  '',
  '<script>alert(1)</script>',
  `${ESC}[31m<b>&</b>`,
  `${ESC}[32mgreen${ESC}[0m`,
  `${ESC}[91mbright${ESC}[39m plain`,
  `${ESC}[1mbold${ESC}[22m ${ESC}[2mdim${ESC}[0m`,
  `${ESC}[3mitalic${ESC}[23m ${ESC}[4munder${ESC}[24m`,
  `${ESC}[7minverse${ESC}[27m back`,
  `${ESC}[31;7mred inverse`,
  `${ESC}[44mbg blue${ESC}[49m none`,
  `${ESC}[103mbright bg`,
  `${ESC}[38;5;3mtable${ESC}[38;5;12mbright${ESC}[38;5;100mcube${ESC}[38;5;240mgrey`,
  `${ESC}[48;5;196mcube bg`,
  `${ESC}[38;2;10;20;30mtrue${ESC}[48;2;255;0;128mcolour`,
  `${ESC}[38:5:2mcolon form`,
  `${ESC}]8;;https://example.invalid${ESC}\\link${ESC}]8;;${ESC}\\ done`,
  `${ESC}[2K${ESC}[1Gcursor noise ${ESC}Dindex`,
  `"quotes" & 'apostrophes'`,
  `${ESC}[2m${ESC}[32muser@host${ESC}[0m${ESC}[37m:${ESC}[2m${ESC}[34m/home/user${ESC}[0m`,
];

test('output equals server/ansi.mjs for 20 vectors once serialised', () => {
  assert.equal(VECTORS.length, 20);
  for (const v of VECTORS) assert.equal(serialise(ansiLineToNodes(v, doc)), ansiLineToHtml(v), JSON.stringify(v));
});

test('preview lines trim and collapse rules like the server', () => {
  const rule = `${ESC}[37m${'─'.repeat(120)}   `;
  assert.equal(serialise(previewLineToNodes(rule, doc)), previewLineToHtml(rule));
  assert.equal(collapseRules('━'.repeat(100), 10), serverCollapse('━'.repeat(100), 10));
  assert.equal(collapseRules('──'), '──');
});

test('a sequence cut by the 400-char slice and stray controls are dropped', () => {
  assert.equal(ansiLineToNodes(`ok${ESC}[38;2;1`, doc).map((n) => n.textContent).join(''), 'ok');
  assert.equal(ansiLineToNodes(`a\u0000b\u0008c\td${ESC}`, doc).map((n) => n.textContent).join(''), 'abc\td');
});

test('style never leaks from one line to the next', () => {
  const nodes = previewToNodes([`${ESC}[31mred`, 'plain'], doc);
  assert.equal(nodes.map((n) => n.textContent).join(''), 'red\nplain');
  assert.equal(nodes.at(-1).tagName, '#TEXT');
});

test('previewToNodes ignores junk and joins lines with newlines', () => {
  assert.deepEqual(previewToNodes(undefined, doc), []);
  assert.deepEqual(previewToNodes('nope', doc), []);
  const nodes = previewToNodes(['a', 42, null, 'b'], doc);
  assert.equal(nodes.map((n) => n.textContent).join(''), 'a\nb');
});
