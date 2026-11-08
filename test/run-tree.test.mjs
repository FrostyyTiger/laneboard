import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, costBelow, defaultOpen, isOpen, mergeEvents, noteFailures, parseRunKey, placeEvents } from '../public/js/core/run-tree.js';

const n = (id, parent = null, state = 'planned', lastCheck = null) => ({ id, parent, state, lastCheck, level: 'task', title: id });
const FAIL = { name: 'x', pass: false, at: 5 };

test('parseRunKey takes <engine>/<run> and nothing else', () => {
  assert.deepEqual(parseRunKey('main/R-1'), { engine: 'main', id: 'R-1' });
  for (const v of ['R-1', 'main/', '/R-1', 'Main/R-1', 'main/a/b', 'main/../x', null, 3]) assert.equal(parseRunKey(v), null, String(v));
});

test('buildTree survives unknown parents, cycles, repeats and junk', () => {
  const t = buildTree([n('a'), n('b', 'a'), n('b', 'a'), n('c', 'gone'), { ...n('x', 'y') }, { ...n('y', 'x') }, null, 7]);
  assert.deepEqual(t.roots.map((r) => r.node.id).sort(), ['a', 'c', 'y']);
  assert.equal(t.byId.size, 5);
  assert.deepEqual(buildTree(null).roots, []);
});

test('defaultOpen: the path to what moves, a failing node itself, else the roots', () => {
  const t = buildTree([n('g'), n('f', 'g'), n('t', 'f', 'building'), n('f2', 'g'), n('t2', 'f2')]);
  assert.deepEqual([...defaultOpen(t)].sort(), ['f', 'g']);
  const idle = buildTree([n('g'), n('f', 'g')]);
  assert.deepEqual([...defaultOpen(idle)], ['g']);
  const bad = buildTree([n('g'), n('f', 'g'), n('t', 'f', 'reopened', FAIL)]);
  assert.deepEqual([...defaultOpen(bad)].sort(), ['f', 'g', 't']);
  const cur = buildTree([n('g'), n('f', 'g')]);
  assert.deepEqual([...defaultOpen(cur, 'f')], ['g']);
});

test('a dropped node\'s old failure opens nothing', () => {
  const t = buildTree([n('g'), n('f', 'g'), n('t', 'f', 'dropped', FAIL)]);
  assert.deepEqual([...defaultOpen(t)], ['g']);
});

test('a hand fold wins until a new failure on its path', () => {
  const t = buildTree([n('g'), n('t', 'g', 'reopened', FAIL)]);
  const over = new Map([['g', false]]);
  const seen = new Set(['t@5']);
  noteFailures(t, over, seen);
  assert.equal(isOpen('g', defaultOpen(t), over), false, 'an old failure leaves the fold alone');
  const later = buildTree([n('g'), n('t', 'g', 'reopened', { ...FAIL, at: 9 })]);
  noteFailures(later, over, seen);
  assert.equal(isOpen('g', defaultOpen(later), over), true);
});

test('placeEvents and costBelow', () => {
  const t = buildTree([n('g'), n('t', 'g')]);
  const ev = [{ node: 't', usd: 1 }, { node: 't', usd: 0.5 }, { node: null }, { node: 'gone', usd: 9 }];
  const p = placeEvents(t, ev);
  assert.equal(p.byNode.get('t').length, 2);
  assert.equal(p.run.length, 2);
  const c = costBelow(t, ev);
  assert.equal(c.get('t'), 1.5);
  assert.equal(c.get('g'), 1.5);
});

test('mergeEvents keeps one per seq, in order, the newest max', () => {
  assert.deepEqual(mergeEvents([{ seq: 2 }, { seq: 1 }], [{ seq: 2 }, { seq: 3 }], 2).map((e) => e.seq), [2, 3]);
});
