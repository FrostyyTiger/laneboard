// The Map's pure model logic: folding, shown, links, rollup, scope, sel=.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  SEVERITY, worse, normalize, kidsOf, byIdOf, foldState, autoFold, migrateFolded,
  visibleLinks, neighbours, rollup, scopeAlpha, SCOPE_GHOST, idForSel, selForId,
} from '../public/js/views/map/model.js';

const N = (id, parent, kind, extra = {}) => ({ id, parent, kind, label: id, status: 'ok', ...extra });

const fleet = () => [
  N('__core', null, 'core'),
  N('lab', '__core', 'site'),
  N('agents', 'lab', 'room'),
  N('builder:builder-a', 'agents', 'builder', { builder: 'builder-a' }),
  N('lane:builder-a/pay', 'builder:builder-a', 'lane', { builder: 'builder-a', fkey: 'builder-a/pay', status: 'working' }),
  N('sess:builder-a/s1', 'lane:builder-a/pay', 'session', { builder: 'builder-a', fkey: 'builder-a/s1' }),
  N('sess:builder-a/s2', 'lane:builder-a/pay', 'session', { builder: 'builder-a', fkey: 'builder-a/s2' }),
  N('lane:builder-a/web', 'builder:builder-a', 'lane', { builder: 'builder-a', fkey: 'builder-a/web', status: 'idle', session: 'builder-a/s3' }),
  N('__fleet', '__core', 'site'),
  N('builder:builder-b', '__fleet', 'builder', { builder: 'builder-b' }),
  N('lane:builder-b/api', 'builder:builder-b', 'lane', { builder: 'builder-b', fkey: 'builder-b/api', status: 'working' }),
  N('__repos', '__core', 'site'),
  N('repo:acme-app', '__repos', 'repo'),
  N('pkg:acme-app/api', 'repo:acme-app', 'package'),
];

test('severity order and worse()', () => {
  assert.equal(SEVERITY.at(-1), 'down');
  assert.equal(worse('ok', 'crit'), 'crit');
  assert.equal(worse('down', 'warn'), 'down');
  assert.equal(worse('attention', 'warn'), 'attention');
});

test('normalize fills the envelope and drops self-links and junk', () => {
  const m = normalize({ nodes: [{ id: 'a' }, null, { label: 'no id' }], links: [{ from: 'a', to: 'a' }, { from: 'a', to: 'b' }] });
  assert.deepEqual(m.nodes.map((n) => n.id), ['a']);
  assert.equal(m.links.length, 1);
  assert.deepEqual(m.events, []);
  assert.deepEqual(m.fleet, { builders: [] });
  assert.equal(m.error, null);
  assert.deepEqual(normalize(undefined).nodes, []);
});

test('normalize keeps reach.unresolved as a count, never a list', () => {
  assert.equal(normalize({ reach: { links: [], unresolved: 3 } }).reach.unresolved, 3);
  for (const bad of [[{ selector: 'group:x' }], -1, 1.5, 'x', undefined]) {
    assert.equal(normalize({ reach: { links: [], unresolved: bad } }).reach.unresolved, 0);
  }
});

test('kidsOf maps parents to children and ignores missing parents', () => {
  const k = kidsOf([N('a', null, 'site'), N('b', 'a', 'room'), N('c', 'gone', 'room')]);
  assert.deepEqual(k.get('a').map((n) => n.id), ['b']);
  assert.equal(k.has('gone'), false);
});

test('foldState hides the subtree of user folds and auto folds alike', () => {
  const nodes = fleet();
  const fs = foldState(nodes, ['builder:builder-b'], ['lane:builder-a/pay']);
  assert.ok(fs.hidden.has('lane:builder-b/api'));
  assert.ok(fs.hidden.has('sess:builder-a/s1') && fs.hidden.has('sess:builder-a/s2'));
  assert.ok(!fs.hidden.has('lane:builder-a/pay'), 'the folded node itself stays drawn');
  assert.ok(!fs.hidden.has('builder:builder-b'));
  assert.deepEqual([...fs.folded].sort(), ['builder:builder-b', 'lane:builder-a/pay']);
  // Unknown ids are ignored.
  assert.equal(foldState(nodes, ['nope'], []).hidden.size, 0);
});

test('shown climbs to the nearest folded ancestor', () => {
  const nodes = fleet();
  const { shown } = foldState(nodes, ['agents'], ['lane:builder-a/pay']);
  assert.equal(shown('sess:builder-a/s1'), 'agents', 'nested folds: the outermost wins');
  assert.equal(shown('lane:builder-a/pay'), 'agents');
  assert.equal(shown('lab'), 'lab');
  const inner = foldState(nodes, [], ['lane:builder-a/pay']);
  assert.equal(inner.shown('sess:builder-a/s2'), 'lane:builder-a/pay');
});

test('autoFold folds lanes with sessions unless selected, scoped or zoomed', () => {
  const nodes = fleet();
  assert.deepEqual([...autoFold(nodes)], ['lane:builder-a/pay']);
  assert.equal(autoFold(nodes, { selected: 'lane:builder-a/pay' }).size, 0);
  assert.equal(autoFold(nodes, { selected: 'sess:builder-a/s2' }).size, 0);
  assert.equal(autoFold(nodes, { scope: 'builder-a' }).size, 0);
  assert.equal(autoFold(nodes, { scope: 'builder-b' }).size, 1);
  assert.equal(autoFold(nodes, { zoom: 1.8 }).size, 0);
  assert.equal(autoFold(nodes, { zoom: 1.79 }).size, 1);
});

test('migrateFolded drops legacy lane ids and non-strings', () => {
  assert.deepEqual(
    migrateFolded(['lane:payments', 'lane:builder-a/pay', 'agents', 3, null, '']),
    ['lane:builder-a/pay', 'agents'],
  );
  assert.deepEqual(migrateFolded('nope'), []);
});

test('visibleLinks re-targets folded ends and merges per pair', () => {
  const nodes = fleet();
  const byId = byIdOf(nodes);
  const { shown } = foldState(nodes, ['builder:builder-b'], ['lane:builder-a/pay']);
  const links = [
    { id: 'c1', kind: 'conflict', from: 'sess:builder-a/s1', to: 'lane:builder-b/api', predicted: true, severity: 'warn' },
    { id: 'c2', kind: 'conflict', from: 'sess:builder-a/s2', to: 'lane:builder-b/api', predicted: false, severity: 'crit', live: true },
    { id: 'd', kind: 'dep', from: 'lab', to: 'agents' },
    { id: 'self', kind: 'dep', from: 'sess:builder-a/s1', to: 'lane:builder-a/pay' },
  ];
  const v = visibleLinks(links, shown, { byId });
  const folded = v.filter((l) => l.folded);
  assert.equal(folded.length, 1, 'two conflicts between the same folded ends merge');
  assert.equal(folded[0].from, 'lane:builder-a/pay');
  assert.equal(folded[0].to, 'builder:builder-b');
  assert.equal(folded[0].predicted, false, 'a confirmed conflict wins');
  assert.equal(folded[0].severity, 'crit');
  assert.equal(folded[0].live, true);
  assert.ok(v.some((l) => l.id === 'd'), 'untouched links pass as they are');
  assert.ok(!v.some((l) => l.id === 'self'), 'a link folded onto itself goes');
  // The original link objects are not mutated.
  assert.equal(links[0].from, 'sess:builder-a/s1');
});

test('visibleLinks keeps only links between drawn nodes when told which are drawn', () => {
  const nodes = fleet();
  const { shown } = foldState(nodes);
  const v = visibleLinks([{ id: 'd', kind: 'dep', from: 'lab', to: 'agents' }], shown, { drawn: new Set(['lab']) });
  assert.equal(v.length, 0);
});

test('visibleLinks hides pkg edges without focus, scope or the ci overlay', () => {
  const nodes = fleet();
  const byId = byIdOf(nodes);
  const { shown } = foldState(nodes);
  const links = [{ id: 'p', kind: 'pkg', from: 'lane:builder-a/pay', to: 'pkg:acme-app/api', live: true }];
  assert.equal(visibleLinks(links, shown, { byId }).length, 0);
  assert.equal(visibleLinks(links, shown, { byId, focus: 'pkg:acme-app/api' }).length, 1);
  assert.equal(visibleLinks(links, shown, { byId, focus: 'lane:builder-a/pay' }).length, 1);
  assert.equal(visibleLinks(links, shown, { byId, overlay: 'ci' }).length, 1);
  assert.equal(visibleLinks(links, shown, { byId, scope: 'builder-a' }).length, 1);
  assert.equal(visibleLinks(links, shown, { byId, scope: 'builder-b' }).length, 0);
});

test('visibleLinks hides a resting lane\'s links unless an end is the focus', () => {
  const nodes = fleet();
  const byId = byIdOf(nodes);
  const { shown } = foldState(nodes);
  const links = [{ id: 't', kind: 'touch', from: 'lane:builder-a/web', to: 'lane:builder-b/api' }];
  assert.equal(visibleLinks(links, shown, { byId }).length, 0);
  assert.equal(visibleLinks(links, shown, { byId, focus: 'lane:builder-b/api' }).length, 1);
});

test('neighbours joins drawn parents, children and link ends', () => {
  const nodes = fleet();
  const byId = byIdOf(nodes);
  const nb = neighbours(['lab', 'agents', 'builder:builder-a'], byId, [{ from: 'lab', to: 'x' }]);
  assert.deepEqual([...nb.get('agents')].sort(), ['builder:builder-a', 'lab']);
  assert.ok(nb.get('lab').has('x') && nb.get('x').has('lab'));
});

test('rollup lifts trouble from folded descendants, down arrives as crit', () => {
  const nodes = fleet();
  nodes.find((n) => n.id === 'sess:builder-a/s2').status = 'down';
  nodes.find((n) => n.id === 'lane:builder-b/api').status = 'attention';
  const byId = byIdOf(nodes);
  const kids = kidsOf(nodes, byId);
  const memo = new Map();
  assert.equal(rollup('lane:builder-a/pay', byId, kids, memo), 'crit');
  assert.equal(rollup('builder:builder-b', byId, kids, memo), 'attention');
  assert.equal(rollup('__core', byId, kids, memo), 'crit');
  assert.equal(rollup('__repos', byId, kids, memo), 'ok');
  assert.equal(rollup('lane:builder-a/web', byId, kids, memo), 'ok', 'idle reads as ok');
  nodes.find((n) => n.id === 'pkg:acme-app/api').status = 'unknown';
  assert.equal(rollup('pkg:acme-app/api', byId, kids), 'unknown');
});

test('rollup survives a parent cycle', () => {
  const nodes = [N('a', 'b', 'room'), N('b', 'a', 'room', { status: 'crit' })];
  const byId = byIdOf(nodes);
  assert.equal(rollup('a', byId, kidsOf(nodes, byId)), 'crit');
});

test('scopeAlpha ghosts other builders but not the path to the core', () => {
  const nodes = fleet();
  const byId = byIdOf(nodes);
  const a = (id, scope = 'builder-a') => scopeAlpha(byId.get(id), scope, byId);
  assert.equal(a('lane:builder-a/pay'), 1);
  assert.equal(a('sess:builder-a/s1'), 1);
  assert.equal(a('builder:builder-a'), 1);
  assert.equal(a('agents'), 1, 'the room on the path');
  assert.equal(a('lab'), 1, 'the site on the path');
  assert.equal(a('__core'), 1);
  assert.equal(a('builder:builder-b'), SCOPE_GHOST);
  assert.equal(a('lane:builder-b/api'), SCOPE_GHOST);
  assert.equal(a('__fleet'), SCOPE_GHOST);
  assert.equal(a('pkg:acme-app/api'), SCOPE_GHOST);
  assert.equal(a('lane:builder-b/api', 'all'), 1);
  assert.equal(a('lane:builder-b/api', 'nope'), 1, 'an unknown builder ghosts nothing');
  assert.equal(a('__fleet', 'builder-b'), 1);
});

test('idForSel and selForId round trip', () => {
  const nodes = fleet();
  const byId = byIdOf(nodes);
  assert.equal(idForSel('builder-a/pay', byId), 'lane:builder-a/pay');
  assert.equal(idForSel('builder-a/s1', byId), 'sess:builder-a/s1');
  assert.equal(idForSel('builder-a/s3', byId), 'lane:builder-a/web', 'a single-session lane is its session');
  assert.equal(idForSel('builder:builder-a', byId), 'builder:builder-a');
  assert.equal(idForSel('pkg:acme-app/api', byId), 'pkg:acme-app/api');
  assert.equal(idForSel('lab', byId), 'lab');
  assert.equal(idForSel('builder-a/missing', byId), null);
  assert.equal(idForSel('', byId), null);
  assert.equal(idForSel(undefined, byId), null);
  for (const n of nodes) {
    assert.equal(idForSel(selForId(n.id), byId), n.id, `round trip ${n.id}`);
  }
  assert.equal(selForId('lane:builder-a/pay'), 'builder-a/pay');
  assert.equal(selForId('sess:builder-a/s1'), 'builder-a/s1');
  assert.equal(selForId('builder:builder-a'), 'builder:builder-a');
  assert.equal(selForId('lane:legacy'), 'lane:legacy');
});

test('the pure map modules import with no DOM and leave no globals behind', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'public', 'js', 'views', 'map');
  const script = `const before = new Set(Object.getOwnPropertyNames(globalThis));
    await Promise.all(['model.js', 'layout.js', 'overlays.js'].map((f) => import(${JSON.stringify('file://' + dir + '/')} + f)));
    const added = Object.getOwnPropertyNames(globalThis).filter((x) => !before.has(x));
    process.stdout.write(JSON.stringify({ added, document: typeof document }));`;
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.deepEqual(out, { added: [], document: 'undefined' });
});
