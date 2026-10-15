// The palette's fuzzy matcher and ranking (fleet plan §4 2.5, task D8):
// fuzzyScore(q, s) is a subsequence match scoring word-start +8, consecutive
// +5, case-exact +1 and gap -1; prefixes h:/host:, l:/lane:, p:/pkg:, >/act:
// narrow the type; recent ids come first; results are capped at 50.
import test from 'node:test';
import assert from 'node:assert/strict';

const { fuzzyScore, parsePrefix, rankItems, SCORE, CAP } = await import('../public/js/ui/fuzzy.js');
const pal = await import('../public/js/ui/palette.js');

test('the score weights are the plan\'s', () => {
  assert.deepEqual({ ...SCORE }, { wordStart: 8, consecutive: 5, caseExact: 1, gap: -1 });
  assert.equal(CAP, 50);
});

test('fuzzyScore: each rule on its own', () => {
  assert.equal(fuzzyScore('', 'anything'), 0, 'an empty query matches with 0');
  assert.equal(fuzzyScore('a', 'a'), 9, 'word start + exact case');
  assert.equal(fuzzyScore('A', 'a'), 8, 'word start, other case');
  assert.equal(fuzzyScore('b', 'ab'), 1, 'mid-word: only the case bonus');
  assert.equal(fuzzyScore('ab', 'ab'), 9 + 5 + 1, 'consecutive');
  assert.equal(fuzzyScore('ab', 'axb'), 9 - 1 + 1, 'one-char gap');
  assert.equal(fuzzyScore('ab', 'axxb'), 9 - 2 + 1, 'two-char gap');
  assert.equal(fuzzyScore('ab', 'a-b'), 9 - 1 + 9, 'b after a separator is a word start');
  assert.equal(fuzzyScore('ab', 'aB'), 9 + 5 + 8, 'camelCase step is a word start (case differs)');
  assert.equal(fuzzyScore('x', 'xa'), fuzzyScore('x', 'ax') + 8, 'a leading gap is free; the word start decides');
});

test('fuzzyScore: no match is null; it is a subsequence, case-insensitive', () => {
  assert.equal(fuzzyScore('z', 'board'), null);
  assert.equal(fuzzyScore('db', 'board'), null, 'order matters');
  assert.equal(fuzzyScore('boards', 'board'), null, 'longer than the candidate');
  assert.equal(typeof fuzzyScore('BRD', 'board'), 'number');
  assert.equal(fuzzyScore('a', null), null);
  assert.equal(fuzzyScore(null, 'a'), 0);
});

test('fuzzyScore takes the best alignment, not the first one', () => {
  // Greedy would take the first 'a' and pay the gap; the best uses the run "ab".
  // a(0) then b(6) scores 9 - 5 + 1 = 5; a(5) is a word start too, then b runs on.
  assert.equal(fuzzyScore('ab', 'axxx_ab'), 9 + 5 + 1);
});

test('fuzzyScore ranks the expected candidates first', () => {
  const order = (q, list) => list.map((s) => [s, fuzzyScore(q, s)]).filter(([, v]) => v !== null).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  assert.deepEqual(order('gm', ['go map', 'garbage m', 'xgm']), ['go map', 'garbage m', 'xgm']);
  assert.deepEqual(order('auth', ['oauth', 'auth-refactor']), ['auth-refactor', 'oauth'], 'a word-start run beats a mid-word one');
  assert.equal(order('ar', ['auth-refactor', 'archive'])[0], 'archive', 'a prefix run beats split word starts');
});

test('parsePrefix: every prefix, case-insensitive, trimmed', () => {
  assert.deepEqual(parsePrefix('h: builder'), { type: 'HOST', text: 'builder' });
  assert.deepEqual(parsePrefix('host:b'), { type: 'HOST', text: 'b' });
  assert.deepEqual(parsePrefix('l:auth'), { type: 'LANE', text: 'auth' });
  assert.deepEqual(parsePrefix('LANE: auth'), { type: 'LANE', text: 'auth' });
  assert.deepEqual(parsePrefix('p:acme'), { type: 'PKG', text: 'acme' });
  assert.deepEqual(parsePrefix('pkg: acme'), { type: 'PKG', text: 'acme' });
  assert.deepEqual(parsePrefix('>kill'), { type: 'ACT', text: 'kill' });
  assert.deepEqual(parsePrefix('act: kill'), { type: 'ACT', text: 'kill' });
  assert.deepEqual(parsePrefix('  board '), { type: null, text: 'board' });
  assert.deepEqual(parsePrefix(''), { type: null, text: '' });
  assert.deepEqual(parsePrefix(undefined), { type: null, text: '' });
});

const ITEMS = [
  { id: 'cmd:view.map', type: 'VIEW', label: 'Map' },
  { id: 'cmd:view.board', type: 'VIEW', label: 'Board' },
  { id: 'cmd:act.kill', type: 'ACT', label: 'Kill session' },
  { id: 'host:builder-a', type: 'HOST', label: 'builder-a', sub: 'B1 · live' },
  { id: 'lane:builder-a/auth', type: 'LANE', label: 'auth', sub: 'builder-a' },
  { id: 'lane:builder-a/api', type: 'LANE', label: 'api', sub: 'builder-a' },
  { id: 'pkg:acme', type: 'PKG', label: 'acme' },
];

test('rankItems: prefixes narrow the type; ACT includes views', () => {
  assert.deepEqual(rankItems(ITEMS, 'h:').map((i) => i.id), ['host:builder-a']);
  assert.deepEqual(rankItems(ITEMS, 'l:a').map((i) => i.id), ['lane:builder-a/auth', 'lane:builder-a/api']);
  assert.deepEqual(rankItems(ITEMS, 'p:').map((i) => i.id), ['pkg:acme']);
  assert.deepEqual(rankItems(ITEMS, '>').map((i) => i.type), ['VIEW', 'VIEW', 'ACT']);
  assert.deepEqual(rankItems(ITEMS, '>kil').map((i) => i.id), ['cmd:act.kill']);
});

test('rankItems: best score first, sub-labels match at a discount, recent breaks ties', () => {
  assert.equal(rankItems(ITEMS, 'map')[0].id, 'cmd:view.map');
  // 'builder' matches the host label and both lanes' sub-label: the label wins.
  const b = rankItems(ITEMS, 'builder').map((i) => i.id);
  assert.equal(b[0], 'host:builder-a');
  assert.deepEqual(b.slice(1).sort(), ['lane:builder-a/api', 'lane:builder-a/auth']);
  // Same score: the recent one first.
  const tie = rankItems(ITEMS, 'l:a', { recent: ['lane:builder-a/api'] }).map((i) => i.id);
  assert.equal(fuzzyScore('a', 'auth'), fuzzyScore('a', 'api'));
  assert.deepEqual(tie, ['lane:builder-a/api', 'lane:builder-a/auth']);
  assert.deepEqual(rankItems(ITEMS, 'zzz'), []);
});

test('rankItems: an empty query keeps the order with recent first, newest first', () => {
  const ids = rankItems(ITEMS, '', { recent: ['pkg:acme', 'host:builder-a'] }).map((i) => i.id);
  assert.deepEqual(ids.slice(0, 3), ['pkg:acme', 'host:builder-a', 'cmd:view.map']);
});

test('rankItems caps the results at 50', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `lane:builder-a/l${i}`, type: 'LANE', label: `lane-${i}` }));
  assert.equal(rankItems(many, 'lane').length, 50);
  assert.equal(rankItems(many, '').length, 50);
  assert.equal(rankItems(many, 'lane', { cap: 5 }).length, 5);
});

test('palette rows: an empty query is recent, then alarm lanes, then views', () => {
  const rows = pal.paletteRows(ITEMS, '', { recent: ['pkg:acme'], alarmKeys: ['builder-a/api', 'builder-b/gone'] });
  assert.deepEqual(rows.map((r) => r.id), ['pkg:acme', 'lane:builder-a/api', 'cmd:view.map', 'cmd:view.board']);
  // A bare prefix lists that type.
  assert.deepEqual(pal.paletteRows(ITEMS, 'l:', {}).map((r) => r.id), ['lane:builder-a/auth', 'lane:builder-a/api']);
  assert.equal(pal.paletteRows(ITEMS, 'kill', {})[0].id, 'cmd:act.kill');
});

test('palette recent list: parsed defensively, newest first, at most 20', () => {
  assert.deepEqual(pal.parseRecent('not json'), []);
  assert.deepEqual(pal.parseRecent('{"a":1}'), []);
  assert.deepEqual(pal.parseRecent(JSON.stringify(['a', 7, 'a', '', 'b', 'x'.repeat(400)])), ['a', 'b']);
  assert.equal(pal.parseRecent(JSON.stringify(Array.from({ length: 40 }, (_, i) => `id${i}`))).length, pal.RECENT_MAX);
  assert.deepEqual(pal.pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.equal(pal.pushRecent(Array.from({ length: 20 }, (_, i) => `id${i}`), 'new').length, 20);
  assert.equal(pal.RECENT_KEY, 'lb.pal.recent');
});

test('palette items: names stay text, keys are fleet keys, actions sit behind commands', async () => {
  const { createStore } = await import('../public/js/core/store.js');
  const s = createStore();
  s.builders.set('builder-a', { id: 'builder-a', code: 'B1', status: 'live', sessions: new Map() });
  s.lanes = [{ id: '<img src=x onerror=alert(1)>', builder: 'builder-a', key: 'builder-a/<img src=x onerror=alert(1)>' }, { id: 'auth', builder: 'builder-a', key: 'auth' }];
  s.sessions.set('builder-a/w1', { name: 'w1', builder: 'builder-a', key: 'builder-a/w1', lane: 'auth' });
  s.packages = { repos: [{ slug: 'acme/app' }, { name: 'acme/app' }, { name: 'tools' }] };
  pal.registerPaletteCommands();
  const items = pal.paletteItems({ store: s, view: 'board', route: { sel: null } });
  const byType = (t) => items.filter((i) => i.type === t);
  assert.deepEqual(byType('HOST').map((i) => [i.id, i.label]), [['host:builder-a', 'builder-a']]);
  const lanes = byType('LANE');
  assert.ok(lanes.some((i) => i.label === '<img src=x onerror=alert(1)>'), 'the raw name is the label (rendered with textContent)');
  assert.ok(lanes.some((i) => i.id === 'lane:builder-a/auth'), 'a bare lane key becomes a fleet key');
  assert.ok(lanes.some((i) => i.id === 'lane:builder-a/w1' && i.sub === 'auth · builder-a'));
  assert.deepEqual(byType('PKG').map((i) => i.label), ['acme/app', 'tools']);
  for (const it of items) assert.equal(typeof it.run, 'function');
  // Without a selected session, no session action is offered.
  assert.ok(!items.some((i) => i.id === 'cmd:act.kill'));
  const withSel = pal.paletteItems({ store: s, view: 'board', route: { sel: 'builder-a/w1' } });
  assert.ok(withSel.some((i) => i.id === 'cmd:act.kill'), 'kill is offered on the selected session');
  // The DOM code never parses markup.
  const fs = await import('node:fs');
  for (const f of ['public/js/ui/palette.js', 'public/js/ui/hotkeys.js']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/, f);
  }
});
