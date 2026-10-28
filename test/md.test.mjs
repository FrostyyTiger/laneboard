// The reply renderer's parser (cockpit spec c1-talk.md §3 "What a reply may contain",
// D22, D23, D25, D146, D227): public/js/core/md.js, table-driven. One case per row of
// the subset table, the numeric/not-numeric cells, a fence open at the end, three-level
// lists drawn at level 2, a table row still being written (a `tail`) and S-C1-09's four
// hostile strings. The DOM side is reply.js's (test/cockpit-reply.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, inline, cellKind, columnAlign, cellsOf, hostOf, splitMarks, MAX_LINE, NUMERIC_CELL } from '../public/js/core/md.js';

const T = (text) => ({ type: 'text', text });
const done = (s) => parse(s, { done: true });

const SUBSET = [
  ['paragraph', 'Two of three runs finished.', [{ type: 'p', runs: [T('Two of three runs finished.')] }]],
  ['a paragraph keeps its lines', 'one\ntwo', [{ type: 'p', runs: [T('one'), T('\n'), T('two')] }]],
  ['blocks split on a blank line', 'one\n\ntwo', [{ type: 'p', runs: [T('one')] }, { type: 'p', runs: [T('two')] }]],
  ['# heading', '# Tonight', [{ type: 'h', level: 1, runs: [T('Tonight')] }]],
  ['## heading', '## Not sent', [{ type: 'h', level: 2, runs: [T('Not sent')] }]],
  ['### heading, as written', '### YOU · 07:02', [{ type: 'h', level: 3, runs: [T('YOU · 07:02')] }]],
  ['#### is plain text', '#### deep', [{ type: 'p', runs: [T('#### deep')] }]],
  ['closing hashes go', '## Runs ##', [{ type: 'h', level: 2, runs: [T('Runs')] }]],
  ['**bold**', 'a **12** b', [{ type: 'p', runs: [T('a '), { type: 'bold', text: '12' }, T(' b')] }]],
  ['*italic* is plain', 'a *b* c', [{ type: 'p', runs: [T('a *b* c')] }]],
  ['`code` inline', 'run `ls -l` now', [{ type: 'p', runs: [T('run '), { type: 'code', text: 'ls -l' }, T(' now')] }]],
  ['bullet list', '- one\n* two', [{ type: 'list', items: [{ level: 1, marker: '·', runs: [T('one')] }, { level: 1, marker: '·', runs: [T('two')] }] }]],
  ['numbered list', '1. one\n2) two', [{ type: 'list', items: [{ level: 1, marker: '1.', runs: [T('one')] }, { level: 1, marker: '2)', runs: [T('two')] }] }]],
  ['three levels draw at level 2', '- a\n  - b\n    - c', [{ type: 'list', items: [
    { level: 1, marker: '·', runs: [T('a')] }, { level: 2, marker: '·', runs: [T('b')] }, { level: 2, marker: '·', runs: [T('c')] }] }]],
  ['> quote', '> Not sent: the room did not confirm within 5 s.\n> again', [{ type: 'quote', lines: [[T('Not sent: the room did not confirm within 5 s.')], [T('again')]] }]],
  ['--- rule', 'a\n\n---\n\nb', [{ type: 'p', runs: [T('a')] }, { type: 'rule' }, { type: 'p', runs: [T('b')] }]],
  ['fenced code with its language', '```sh\nls\n\necho "hi"\n```', [{ type: 'code', lang: 'sh', lines: ['ls', '', 'echo "hi"'], open: false }]],
  ['fenced code, no language, markup inside stays', '```\n# not a heading\n**x**\n```', [{ type: 'code', lang: null, lines: ['# not a heading', '**x**'], open: false }]],
  ['a table', '| run | time |\n| --- | --- |\n| acme | 1 h 12 |', [{ type: 'table', head: [[T('run')], [T('time')]], rows: [[[T('acme')], [T('1 h 12')]]], align: ['left', 'right'] }]],
  ['[text](url)', 'See [the run](https://example.invalid/run/7).', [{ type: 'p', runs: [T('See '), { type: 'link', text: 'the run', host: 'example.invalid' }, T('.')] }]],
  ['a bare URL, trailing dot left out', 'at https://Example.Invalid:8443/a?x=1.', [{ type: 'p', runs: [T('at '), { type: 'link', text: 'https://Example.Invalid:8443/a?x=1', host: 'example.invalid' }, T('.')] }]],
  ['a link to javascript: has no host', '[x](javascript:alert(1))', [{ type: 'p', runs: [{ type: 'link', text: 'x', host: '' }, T(')')] }]],
  ['![alt](url)', '![chart](https://example.invalid/c.png)', [{ type: 'p', runs: [{ type: 'image', alt: 'chart' }] }]],
  ['raw HTML is text', '<b>hi</b>', [{ type: 'p', runs: [T('<b>hi</b>')] }]],
  ['marks are their own runs', '■ hv1 down ▲ ● ○', [{ type: 'p', runs: [
    { type: 'mark', text: '■', p: '1' }, T(' hv1 down '), { type: 'mark', text: '▲', p: '2' }, T(' '),
    { type: 'mark', text: '●', p: 'run' }, T(' '), { type: 'mark', text: '○', p: 'off' }] }]],
];

for (const [name, src, want] of SUBSET) {
  test(`subset: ${name}`, () => {
    assert.deepEqual(done(src), want);
  });
}

test('S-C1-09\'s four hostile strings are text, an image alt and a link with its host', () => {
  assert.deepEqual(done('<img src=x onerror=alert(1)>'), [{ type: 'p', runs: [T('<img src=x onerror=alert(1)>')] }]);
  assert.deepEqual(done('<script>alert(2)</script>'), [{ type: 'p', runs: [T('<script>alert(2)</script>')] }]);
  assert.deepEqual(done('![chart](https://example.invalid/c.png)'), [{ type: 'p', runs: [{ type: 'image', alt: 'chart' }] }]);
  assert.deepEqual(done('[the run](https://example.invalid/run/7)'), [{ type: 'p', runs: [{ type: 'link', text: 'the run', host: 'example.invalid' }] }]);
});

const NUMERIC = ['12', '-3', '+2', '3.4 GB', '3,4 GB', '12 MiB', '41 %', '41%', '250 ms', '45 s', '12 min', '3 d', '$0.42', '1 h 12', '03:12', '3:12:05'];
const NOT_NUMERIC = ['hv1', 'v2', '1.2.3', '12 GB free', '~3 min', '03:12 UTC', '1e5', '1 234', '12/40'];

test('the numeric cells of c1-talk.md §3, and the ones that are not (D146)', () => {
  for (const c of NUMERIC) assert.equal(cellKind(c), 'numeric', c);
  for (const c of NOT_NUMERIC) assert.equal(cellKind(c), 'other', c);
  for (const c of ['', '-', '—', '  ']) assert.equal(cellKind(c), 'neutral', JSON.stringify(c));
  assert.equal(cellKind('1'.repeat(41)), 'other', 'over 40 characters is never numeric');
});

test('a column is right-aligned by the rule, GFM\'s ---: and :--- win, :---: and --- leave it to the rule', () => {
  assert.equal(columnAlign('---', ['12', '-', '3 d']), 'right');
  assert.equal(columnAlign('---', ['12', 'hv1']), 'left');
  assert.equal(columnAlign('---', ['-', '']), 'left', 'neutral cells alone do not make a number column');
  assert.equal(columnAlign(':---:', ['12']), 'right');
  assert.equal(columnAlign('---:', ['hv1']), 'right');
  assert.equal(columnAlign(':---', ['12']), 'left');
  const [t] = done('| n | name |\n| --- | --- |\n| **12** | a |\n| 3 | b |');
  assert.deepEqual(t.align, ['right', 'left'], '`**12**` counts as 12');
});

test('table cells: pipes split, an escaped pipe stays, short rows are filled, long rows cut', () => {
  assert.deepEqual(cellsOf('| a | b \\| c |'), ['a', 'b | c']);
  assert.deepEqual(cellsOf('a | b'), ['a', 'b']);
  const [t] = done('| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |');
  assert.deepEqual(t.rows.map((r) => r.map((c) => c.map((x) => x.text).join(''))), [['1', ''], ['1', '2']]);
});

test('a header row with no separator yet is a paragraph; the row still being written is a tail', () => {
  assert.deepEqual(parse('| run | time |\n'), [{ type: 'p', runs: [T('| run | time |')] }]);
  const b = parse('| run | time |\n| --- | ---: |\n| acme | 1 h 12 |\n| acme-do');
  assert.equal(b.length, 2);
  assert.equal(b[0].type, 'table');
  assert.equal(b[0].rows.length, 1);
  assert.deepEqual(b[1], { type: 'tail', runs: [T('| acme-do')], joins: false });
});

test('the last line with no newline is a plain tail; done reads it whole', () => {
  assert.deepEqual(parse('Two **of'), [{ type: 'tail', runs: [T('Two **of')], joins: false }]);
  assert.deepEqual(parse('■ builder-b is'), [{ type: 'tail', runs: [{ type: 'mark', text: '■', p: '1' }, T(' builder-b is')], joins: false }]);
  assert.deepEqual(parse('Line 1\nLine 2 of'), [{ type: 'p', runs: [T('Line 1')] }, { type: 'tail', runs: [T('Line 2 of')], joins: true }]);
  assert.deepEqual(parse('Line 1\n\nLine 2 of').at(-1).joins, false);
  assert.deepEqual(parse('done.\n'), [{ type: 'p', runs: [T('done.')] }]);
  assert.deepEqual(parse(''), []);
  assert.deepEqual(done('a **b**'), [{ type: 'p', runs: [T('a '), { type: 'bold', text: 'b' }] }]);
});

test('a fence open at the end is a code block with open: true, its line being written included', () => {
  assert.deepEqual(parse('```sh\nls\necho h'), [{ type: 'code', lang: 'sh', lines: ['ls', 'echo h'], open: true }]);
  assert.deepEqual(parse('```sh\nls\n``'), [{ type: 'code', lang: 'sh', lines: ['ls'], open: true }], 'a closing fence being written is not a line');
  assert.deepEqual(done('```sh\nls'), [{ type: 'code', lang: 'sh', lines: ['ls'], open: true }]);
  assert.deepEqual(done('```sh\nls\n```'), [{ type: 'code', lang: 'sh', lines: ['ls'], open: false }]);
  assert.deepEqual(done('~~~\na\n```\n~~~'), [{ type: 'code', lang: null, lines: ['a', '```'], open: false }], 'closed by its own fence only');
});

test('S-C1-42\'s look-alike reply: headings, a quote, a code block and a mark, nothing more', () => {
  const b = done('### YOU · 07:02\n## Not sent\n> Not sent: the room did not confirm within 5 s.\n\n```\nPaired as desk2.\n```\n■ hv1 down');
  assert.deepEqual(b.map((x) => x.type), ['h', 'h', 'quote', 'code', 'p']);
  assert.deepEqual(b[4].runs[0], { type: 'mark', text: '■', p: '1' });
});

test('a line over 2 000 characters is one plain p run, and nothing backtracks', () => {
  const long = `**${'a'.repeat(MAX_LINE)}**`;
  assert.deepEqual(done(long), [{ type: 'p', runs: [T(long)] }]);
  // Hostile shapes, each under the line limit, parse in linear time.
  const t0 = performance.now();
  for (const s of ['|'.repeat(1999), '-'.repeat(1999) + 'x', ' '.repeat(1998) + '#', '1'.repeat(1999) + '1 h',
    '[' .repeat(1999), '**'.repeat(999), '`'.repeat(1999), 'http://' + 'a'.repeat(1990), '# ' + ' #'.repeat(998)]) {
    done(`${s}\n${s}\n${s}`);
    NUMERIC_CELL.test(s);
  }
  assert.ok(performance.now() - t0 < 1000, 'hostile lines parse fast');
});

test('helpers: hostOf, splitMarks, inline never yields an empty text run', () => {
  assert.equal(hostOf('https://example.invalid/run/7'), 'example.invalid');
  assert.equal(hostOf('not a url'), '');
  assert.equal(hostOf('ftp://example.invalid/'), '');
  assert.deepEqual(splitMarks('■'), [{ type: 'mark', text: '■', p: '1' }]);
  assert.ok(inline('[a](b) `c` **d** ■').every((r) => r.type !== 'text' || r.text !== ''));
  assert.deepEqual(inline('[open'), [T('[open')]);
  assert.deepEqual(inline('`open'), [T('`open')]);
});
