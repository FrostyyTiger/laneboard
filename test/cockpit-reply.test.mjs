// A reply's text drawn from md.js's blocks (cockpit spec c1-talk.md §3, D22, D23, D25,
// D225, D227): public/js/cockpit/reply.js on the fake DOM. Sizes, colours, the sideways
// scroll and the taps are the Playwright scenarios' (e2e/cockpit/c1-render.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { parse } from '../public/js/core/md.js';
import { drawText, CODE_LINES_SHOWN } from '../public/js/cockpit/reply.js';

const draw = (text, { done = true, ui = { expanded: new Set() } } = {}) => {
  const doc = makeDocument();
  const node = doc.createElement('div');
  const host = drawText(doc, node, parse(text, { done }), ui);
  return { node, host };
};
const all = (n) => [n, ...n.children.flatMap(all)];
const byClass = (n, c) => all(n).filter((x) => x.classList?.contains(c));

test('markup from the agent is text: no <a>, no href, no img, nothing through innerHTML (D22)', () => {
  const { node } = draw('<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>\n\n![chart](https://example.invalid/c.png)\n\n[the run](https://example.invalid/run/7)');
  const tags = new Set(all(node).map((x) => x.tagName));
  for (const t of ['A', 'IMG', 'SCRIPT']) assert.equal(tags.has(t), false, t);
  assert.ok(all(node).every((x) => x.innerHTML === '' && !('href' in x.attrs)));
  assert.equal(node.children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(node.children[1].textContent, '<script>alert(2)</script>');
  assert.equal(node.children[2].textContent, '[image: chart]');
  const [link] = all(node).filter((x) => x.attrs['data-link'] !== undefined);
  assert.equal(link.tagName, 'SPAN');
  assert.equal(link.textContent, 'the run');
  assert.equal(node.children[3].textContent, 'the run (example.invalid)');
});

test('each mark is its own [data-mark] with its lamp priority; the words around stay text (D25)', () => {
  const { node } = draw('■ builder-b is down. ▲ nightly-ci is stuck. ● 2 runs working.');
  const marks = all(node).filter((x) => x.attrs['data-mark'] !== undefined);
  assert.deepEqual(marks.map((m) => [m.textContent, m.attrs['data-mark']]), [['■', '1'], ['▲', '2'], ['●', 'run']]);
  assert.equal(node.textContent, '■ builder-b is down. ▲ nightly-ci is stuck. ● 2 runs working.');
});

test('a 40-line block: 12 lines shown and SHOW ALL 40 LINES; the open state survives a redraw', () => {
  const src = `\`\`\`sh\n${Array.from({ length: 40 }, (_, k) => `echo ${k + 1}`).join('\n')}\n\`\`\``;
  const ui = { expanded: new Set() };
  const { node } = draw(src, { ui });
  const lines = byClass(node, 'ck-md-line');
  assert.equal(lines.length, 40);
  assert.equal(lines.filter((l) => !l.hidden).length, CODE_LINES_SHOWN);
  const [more] = all(node).filter((x) => x.tagName === 'BUTTON');
  assert.equal(more.textContent, 'SHOW ALL 40 LINES');
  assert.equal(byClass(node, 'ck-md-lang')[0].textContent, 'SH');
  ui.expanded.add(0); // as a tap on it does
  const again = draw(src, { ui }).node;
  assert.equal(byClass(again, 'ck-md-line').filter((l) => !l.hidden).length, 40);
  assert.equal(all(again).find((x) => x.tagName === 'BUTTON').textContent, 'SHOW LESS');
  assert.equal(all(draw('```\na\n```').node).some((x) => x.tagName === 'BUTTON'), false, '12 lines or fewer: no button');
});

test('a table: th and td, the right-aligned column marked, every row drawn', () => {
  const { node } = draw('| run | time |\n| --- | --- |\n| acme-search | 1 h 12 |\n| acme-docs | 0 h 48 |');
  const ths = all(node).filter((x) => x.tagName === 'TH');
  const tds = all(node).filter((x) => x.tagName === 'TD');
  assert.deepEqual(ths.map((x) => x.textContent), ['run', 'time']);
  assert.equal(tds.length, 4);
  assert.deepEqual([...ths, ...tds].map((x) => x.classList.contains('ck-md-right')), [false, true, false, true, false, true]);
});

test('the cursor follows the last character: the tail joins its paragraph on its own line', () => {
  const { node, host } = draw('Line 1\nLine 2 of', { done: false });
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].textContent, 'Line 1\nLine 2 of');
  assert.equal(host, node.children[0]);
  const t = draw('| a | b |\n| - | - |\n| 1 | 2 |\n', { done: false });
  assert.equal(t.host.tagName, 'TD', 'after a table: its last cell');
});
