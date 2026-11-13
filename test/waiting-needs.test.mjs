// A blocked run as a waiting item of kind `needs` (docs/waiting.md): the
// contract accepts it, it decides nothing (Resume and Stop, never Approve), and
// the run with only such items still counts as blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, texts } from './helpers/fakedom.mjs';
import { revisionOf, toShape } from '../server/engine/contract.mjs';
import { decisionPlans, waitingKindWord } from '../public/js/views/inbox-waiting.js';
import { gatesNode, isBlocked, needsBand, toListRow } from '../public/js/views/runs-engine.js';
import { blockedRun } from '../public/js/core/loop.js';

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(); } finally { globalThis.document = prev; }
}

const content = { node: 'G1.F1', reason: 'blocked at G1.F1 (tests): the folder may not change.' };
const raw = { id: 'R/needs-1', kind: 'needs', for: 'owner', revision: revisionOf(content), title: 'G1.F1 is blocked', content, links: [], product: 'p', run: 'R', opened: '2026-11-13T10:00:00Z', updated: '2026-11-13T10:00:00Z' };

test('the contract accepts a needs item, its content as sent', () => {
  const a = toShape('waiting', { items: [raw] });
  assert.equal(a.ok, true, a.reason);
  assert.equal(a.value.items[0].kind, 'needs');
  assert.deepEqual(a.value.items[0].content, content);
});

test('a needs item offers Resume and Stop for its run, never Approve; with no run, nothing', () => {
  const item = toShape('waiting', { items: [raw] }).value.items[0];
  const plans = decisionPlans(item, 'main');
  assert.deepEqual(plans.map((p) => [p.label, p.action, p.target, p.tier]), [
    ['Resume', 'engine-resume', 'main/R', 'click'],
    ['Stop', 'engine-stop', 'main/R', 'confirm'],
  ]);
  assert.deepEqual(decisionPlans({ ...item, run: null }, 'main'), []);
  assert.equal(waitingKindWord('needs'), 'blocked');
});

test('a run whose only waiting items are needs is blocked; any other item is a decision', () => {
  const needs = { kind: 'needs' };
  assert.equal(isBlocked({ state: 'at-gate', waiting: [needs], gates: [] }), true);
  assert.equal(isBlocked({ state: 'at-gate', waiting: [needs, { kind: 'merge' }], gates: [] }), false);
  assert.equal(isBlocked({ state: 'at-gate', waiting: [], gates: [{ state: 'open', kind: 'needs' }] }), true);
  assert.equal(blockedRun({ state: 'at-gate', waiting: [needs], gates: [] }), true);
  assert.equal(blockedRun({ state: 'at-gate', waiting: [{ kind: 'recipe' }], gates: [] }), false);
});

test('on Runs the needs item is the blocked card, with Resume, not a gate row', () => withDom(() => {
  const row = toListRow({ id: 'R', key: 'main/R', engine: 'main', state: 'at-gate', reason: content.reason, waiting: [{ ...raw, kind: 'needs' }], rooms: [] });
  assert.equal(gatesNode(row), null);
  const band = needsBand([row], () => {}, 0);
  const t = texts(band).join(' | ');
  assert.match(t, /^Needs you \| blocked/);
  assert.match(t, /What is wrong/);
  assert.deepEqual(band.querySelectorAll('wt-btn').map((b) => b._text), ['Resume', 'Stop']);
}));
