// The words of a tool line (cockpit spec c1-talk.md §5 "Words", "Targets from odd input",
// §5.1 "The fold rule", §5.2; D24, D126, D147): public/js/core/tool-words.js, table-driven.
// One case per row of §5's table (`one`, `many`, no target), S-C1-35's odd inputs as the
// scenario lists them, the fold rule and the opened rows. The pane's side is
// test/cockpit-turns.test.mjs and e2e/cockpit/c1-tools.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toolName, changesThings, canFold, shorten, callTarget, lineWords, lineText, callRow, callMs, failedCount, isDenied, wholeInput } from '../public/js/core/tool-words.js';

const L = 'mcp__laneboard__';
const call = (tool, input, more = {}) => ({ tool, input, startedAt: '2026-10-27T07:02:05.100Z', ...more });
const ended = (tool, input, more = {}) => call(tool, input, { endedAt: '2026-10-27T07:02:05.900Z', isError: false, ...more });
const words = (calls, opts) => lineWords(calls, opts);
const one = (tool, input, opts) => words([call(tool, input)], opts);

test('§5 table: every row\'s one, many and no-target text', () => {
  const ROWS = [
    // [tool, one input, one text, two inputs (different targets), many text, no-target text]
    [`${L}fleet`, { site: 'hv1' }, 'read the feed of hv1', [{ site: 'hv1' }, { site: 'hv2' }], 'read 2 feeds', 'looked at the fleet'],
    [`${L}runs`, { run: 'acme-docs' }, 'looked at run acme-docs', [{ run: 'a' }, { run: 'b' }], 'looked at 2 runs', 'looked at the runs'],
    [`${L}lanes`, { builder: 'builder-a' }, 'looked at the lanes on builder-a', [{ builder: 'a' }, { builder: 'b' }], 'looked at lanes on 2 builders', 'looked at the lanes'],
    [`${L}ci`, { branch: 'main' }, 'looked at CI on main', [{ branch: 'main' }, { branch: 'x' }], 'looked at CI on 2 branches', 'looked at CI'],
    [`${L}morning`, { window: 'tonight' }, 'read the Morning for tonight', [{ window: 'tonight' }, { window: 'week' }], 'read the Morning 2×', 'read the Morning'],
    [`${L}history`, { node: 'hv1' }, 'read the history of hv1', [{ node: 'hv1' }, { run: '7' }], 'read the history of 2 nodes', 'read the history'],
    ['Read', { file_path: '/etc/laneboard/config.json' }, 'read config.json', [{ file_path: '/a/x' }, { file_path: '/a/y' }], 'read 2 files', 'read a file'],
    ['WebFetch', { url: 'https://example.invalid/a' }, 'fetched a page from example.invalid', [{ url: 'https://a.example.invalid/' }, { url: 'https://b.example.invalid/' }], 'fetched 2 pages', 'fetched a page'],
  ];
  for (const [tool, input, oneText, twoInputs, manyText, noneText] of ROWS) {
    assert.equal(one(tool, input), oneText, `${tool} one`);
    assert.equal(words(twoInputs.map((i) => call(tool, i))), manyText, `${tool} many`);
    assert.equal(one(tool, {}), noneText, `${tool} no target`);
    assert.equal(words([call(tool, input), call(tool, input)]), oneText, `${tool}: two calls on one target keep the one text`);
    assert.equal(words([call(tool, input), call(tool, {})]), manyText, `${tool}: with and without a target folds as many`);
  }
});

test('§5 table: the rows with no target, the focus row, the tools that never fold', () => {
  assert.equal(one(`${L}alerts`, {}), 'read the alerts');
  assert.equal(words([call(`${L}alerts`, {}), call(`${L}alerts`, {})]), 'read the alerts 2×');
  for (const t of ['Grep', 'Glob']) {
    assert.equal(one(t, { pattern: 'x' }), 'searched the files');
    assert.equal(words([call(t, {}), call(t, {}), call(t, {})]), 'searched the files 3×');
  }
  assert.equal(one('WebSearch', { query: 'x' }), 'searched the web');
  assert.equal(words([call('WebSearch', {}), call('WebSearch', {})]), 'searched the web 2×');
  assert.equal(one('Task', {}), 'asked a helper agent');
  assert.equal(words([call('Task', {}), call('Task', {})]), 'asked 2 helper agents');

  assert.equal(one(`${L}focus`, { screen: 'desk' }, { screen: 'desk' }), 'looked at this screen');
  assert.equal(one(`${L}focus`, { screen: 'wall' }, { screen: 'desk' }), 'looked at screen wall');
  assert.equal(one(`${L}focus`, { screen: 'all' }), 'looked at the screens');
  assert.equal(one(`${L}focus`, {}), 'looked at this screen');
  assert.equal(words([call(`${L}focus`, { screen: 'a' }), call(`${L}focus`, { screen: 'b' })]), 'looked at 2 screens');

  assert.equal(one('Edit', { file_path: '/srv/app/main.js' }), 'changed main.js');
  assert.equal(one('Write', {}), 'changed a file');
  assert.equal(one('NotebookEdit', { notebook_path: '/n/x.ipynb' }), 'changed x.ipynb');
  assert.equal(one('mcp__github__create_issue', { title: 'x' }), 'used github:create_issue');
  assert.equal(one('SomethingNew', {}), 'used SomethingNew');
  for (const t of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'mcp__github__create_issue', 'SomethingNew']) assert.equal(changesThings(t), true, t);
  for (const t of [`${L}fleet`, 'Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'Task']) assert.equal(changesThings(t), false, t);
  assert.equal(toolName(`${L}fleet`), 'fleet');
  assert.equal(toolName('mcp__github__x'), 'mcp__github__x');
});

test('S-C1-35 Tool lines from odd input, and the words module\'s unit test', () => {
  // The scenario's own four lines (its Playwright half reads them in the pane).
  assert.equal(one('Read', { file_path: '/etc/laneboard/' }), 'read laneboard');
  assert.equal(one(`${L}runs`, { run: 7 }), 'looked at run 7');
  assert.equal(one(`${L}lanes`, {}), 'looked at the lanes');
  assert.equal(one(`${L}ci`, { branch: 'ci-fix/very-long-branch-name-for-the-night-run' }), 'looked at CI on ci-fix/very-long-branch-name-for…');
  // The unit cases as the scenario writes them.
  assert.equal(one('Bash', { command: 'cd /srv/app && npm test' }), 'ran cd /srv/app && npm test');
  assert.equal(one('Bash', { command: 'PGPASSWORD=[redacted] psql -h db' }), 'ran PGPASSWORD=[redacted] psql -h db');
  assert.equal(one('Bash', { command: 'rm -rf /var/log/laneboard/old && echo done' }), 'ran rm -rf /var/log/laneboard/old…');
  assert.equal(one('Bash', { command: 'echo a\n\n  echo b' }), 'ran echo a echo b');
  assert.equal(one('Bash', {}), 'ran a command');
  assert.equal(one('WebFetch', { url: 'https://Example.Invalid:8443/a?x=1' }), 'fetched a page from example.invalid');
  for (const url of ['javascript:alert(1)', 'not a url', 42]) {
    assert.equal(one('WebFetch', { url }), 'fetched a page from an invalid address', String(url));
  }
  assert.equal(words([call('WebFetch', { url: 'https://example.invalid/a' }), call('WebFetch', { url: 'https://example.invalid/b' })]), 'fetched a page from example.invalid');
  assert.equal(words([call('WebFetch', { url: 'https://example.invalid/a' }), call('WebFetch', { url: 'https://acme.example.invalid/b' })]), 'fetched 2 pages');
  assert.equal(one('Read', { file_path: '/' }), 'read /');
  const emoji = '🙂'.repeat(40);
  const cut = callTarget(`${L}ci`, { branch: emoji });
  assert.equal(cut, `${'🙂'.repeat(32)}…`, '32 code points kept, then …');
  assert.equal([...cut].length, 33);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(cut), false, 'no lone surrogate');
});

test('§5 "Shortening": squash, 32 code points, back to a space at character 16 or later', () => {
  assert.equal(shorten('  a \n\t b  '), 'a b');
  assert.equal(shorten('x'.repeat(32)), 'x'.repeat(32), '32 kept whole');
  assert.equal(shorten('x'.repeat(33)), `${'x'.repeat(32)}…`);
  // A space at character 16 (index 15): the cut goes back to it.
  assert.equal(shorten(`${'a'.repeat(15)} ${'b'.repeat(30)}`), `${'a'.repeat(15)}…`);
  // A space at character 15 (index 14) is too early: 32 kept.
  assert.equal(shorten(`${'a'.repeat(14)} ${'b'.repeat(30)}`), `${'a'.repeat(14)} ${'b'.repeat(17)}…`);
  // A target that is only white space is no target.
  assert.equal(one(`${L}ci`, { branch: ' \n ' }), 'looked at CI');
  assert.equal(one(`${L}ci`, { branch: ['main'] }), 'looked at CI', 'not a string: no target');
  assert.equal(one('Read', { file_path: '/etc/laneboard//' }), 'read laneboard');
});

test('§5.1 the fold rule: one index apart, the same tool, not a tool that changes things', () => {
  const at = (tool, blockIndex) => ({ tool, blockIndex });
  assert.equal(canFold(at(`${L}fleet`, 0), at(`${L}fleet`, 1)), true);
  assert.equal(canFold(at(`${L}fleet`, 0), at('fleet', 1)), true, 'the prefix is stripped');
  assert.equal(canFold(at(`${L}fleet`, 0), at(`${L}fleet`, 2)), false, 'text between them');
  assert.equal(canFold(at(`${L}fleet`, 0), at(`${L}ci`, 1)), false, 'another tool');
  assert.equal(canFold(at('Bash', 0), at('Bash', 1)), false, 'Bash never folds');
  assert.equal(canFold(at('Edit', 0), at('Edit', 1)), false);
  assert.equal(canFold(at('mcp__x__y', 0), at('mcp__x__y', 1)), false, 'any other tool never folds');
  assert.equal(canFold(null, at('Read', 1)), false);
});

test('§5 "Failures": ` · k failed` in the line, refused calls not counted, `…` while running', () => {
  const f = `${L}fleet`;
  const calls = [ended(f, { site: 'hv1' }), ended(f, { site: 'hv2' }, { isError: true }), call(f, { site: 'hv3' })];
  assert.equal(lineText(calls), 'read 3 feeds · 1 failed…');
  calls[2] = ended(f, { site: 'hv3' });
  assert.equal(lineText(calls), 'read 3 feeds · 1 failed');
  assert.equal(lineText([ended(f, { site: 'hv1' }, { isError: true }), ended(f, { site: 'hv2' }, { isError: true })]), 'read 2 feeds · 2 failed');
  assert.equal(failedCount([ended('Bash', {}, { isError: true, denied: true })]), 0, 'a refused call is not a failure');
  assert.equal(lineText([call(f, { site: 'hv1' })]), 'read the feed of hv1…');
  assert.equal(lineText([call(f, { site: 'hv1' })], { stopped: true }), 'read the feed of hv1', 'the turn ended under it: no …');
  // c1-talk.md §8: a line still running when STOP ended its turn ends in ` · stopped`; an ended one does not.
  assert.equal(lineText([call(f, { site: 'hv1' })], { stopped: true, byStop: true }), 'read the feed of hv1 · stopped');
  assert.equal(lineText([ended(f, { site: 'hv1' })], { stopped: true, byStop: true }), 'read the feed of hv1');
});

test('§5 "Open": one row per call, compact JSON cut at 120, its ms and ok|failed', () => {
  assert.equal(callRow(ended(`${L}fleet`, { site: 'hv1' })), 'fleet  {"site":"hv1"}  800 ms  ok');
  assert.equal(callRow(ended(`${L}fleet`, { site: 'hv2' }, { isError: true })), 'fleet  {"site":"hv2"}  800 ms  failed');
  assert.equal(callRow(call(`${L}fleet`, { site: 'hv3' })), 'fleet  {"site":"hv3"}  …', 'still running');
  assert.equal(callRow(call(`${L}fleet`, { site: 'hv3' }), { stopped: true }), 'fleet  {"site":"hv3"}', 'never ended: no ms, no word');
  assert.equal(callRow(ended('Bash', { command: 'ls' }, { isError: true, denied: true })), 'Bash  {"command":"ls"}  refused');
  assert.equal(callRow(ended('mcp__github__x', {})), 'github:x  {}  800 ms  ok');
  const long = { pattern: 'p'.repeat(200) };
  const row = callRow(ended('Grep', long));
  assert.equal(row, `Grep  ${JSON.stringify(long).slice(0, 120)}…  800 ms  ok`, 'cut at 120 characters');
  const cmd = { command: 'c'.repeat(200) };
  assert.equal(callRow(ended('Bash', cmd)), `Bash  ${JSON.stringify(cmd)}  800 ms  ok`, 'a tool that changes things: the whole input (§5.2)');
  assert.equal(callMs({ startedAt: '2026-10-27T07:02:05.100Z', endedAt: '2026-10-27T07:02:05.390Z' }), 290);
  assert.equal(callMs({ startedAt: 'x', endedAt: 'y' }), null);
});

test('§5.2 a refused call: the `tried` line, never folded, its whole input and `refused` (D125)', () => {
  const refused = (tool, input) => ended(tool, input, { isError: true, denied: true });
  assert.equal(lineText([refused('Bash', { command: 'ls /var/log' })]), 'tried Bash, not allowed');
  assert.equal(lineText([refused('WebFetch', { url: 'https://example.invalid/' })]), 'tried WebFetch, not allowed', 'not the table\'s words');
  assert.equal(lineText([refused('mcp__github__create_issue', {})]), 'tried github:create_issue, not allowed', 'another MCP server');
  assert.equal(lineText([refused(`${L}fleet`, { site: 'hv1' })]), 'tried fleet, not allowed', 'laneboard\'s prefix stripped');
  assert.equal(lineText([call('WebFetch', { url: 'https://example.invalid/' })]), 'fetched a page from example.invalid…', 'before its tool.end: the running text');
  assert.equal(isDenied([refused('Bash', {})]), true);
  assert.equal(isDenied([ended('Bash', {}, { isError: true })]), false, 'a failure is not a refusal');
  const at = (tool, blockIndex, more = {}) => ({ tool, blockIndex, ...more });
  assert.equal(canFold(at('WebFetch', 0, { denied: true }), at('WebFetch', 1)), false, 'no call joins a tried line');
  assert.equal(canFold(at('WebFetch', 0), at('WebFetch', 1, { denied: true })), false, 'a refused call joins none');
  assert.equal(canFold(at('WebFetch', 0), at('WebFetch', 1)), true);
  const long = { url: `https://example.invalid/${'a'.repeat(200)}` };
  assert.equal(wholeInput(refused('WebFetch', long)), true);
  assert.equal(callRow(refused('WebFetch', long)), `WebFetch  ${JSON.stringify(long)}  refused`, 'whole, never cut at 120');
});
