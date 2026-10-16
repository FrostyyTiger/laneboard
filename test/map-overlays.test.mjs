// The Map's overlays: bins, status override, cycling, link styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAYS, nextOverlay, validOverlay, costLevel, ageLevel, contextBin, statusStyle,
  nodeStyle, linkStyle, confirmedConflict, DIM, SHAPE_CODE, TONE_CODE, ACCENT_L,
} from '../public/js/views/map/overlays.js';

const lane = (status = 'working', m = {}, extra = {}) => ({ id: 'lane:builder-a/x', kind: 'lane', status, m, ...extra });
const MIN = 60e3, HOUR = 60 * MIN;

test('nextOverlay cycles both ways and wraps', () => {
  assert.deepEqual(OVERLAYS, ['status', 'ci', 'cost', 'context', 'age']);
  let o = 'status';
  const seen = [];
  for (let i = 0; i < OVERLAYS.length; i++) { o = nextOverlay(o); seen.push(o); }
  assert.deepEqual(seen, ['ci', 'cost', 'context', 'age', 'status']);
  assert.equal(nextOverlay('status', -1), 'age');
  assert.equal(nextOverlay('ci', -1), 'status');
  for (const x of OVERLAYS) assert.equal(nextOverlay(nextOverlay(x, 1), -1), x);
  assert.equal(nextOverlay('bogus'), 'status');
  assert.equal(validOverlay('cost'), 'cost');
  assert.equal(validOverlay('<b>'), 'status');
});

test('cost bins [0,1,5,20,50] USD', () => {
  const cases = [[0, 0], [0.99, 0], [1, 1], [4.99, 1], [5, 2], [19.99, 2], [20, 3], [49.99, 3], [50, 4], [500, 4], [undefined, 0], [NaN, 0], [-3, 0]];
  for (const [usd, level] of cases) assert.equal(costLevel(usd), level, `$${usd}`);
});

test('age bins <10m, <1h, <4h, <24h, ≥24h', () => {
  const cases = [[0, 0], [10 * MIN - 1, 0], [10 * MIN, 1], [HOUR - 1, 1], [HOUR, 2], [4 * HOUR - 1, 2], [4 * HOUR, 3], [24 * HOUR - 1, 3], [24 * HOUR, 4], [undefined, 0]];
  for (const [ms, level] of cases) assert.equal(ageLevel(ms), level, `${ms} ms`);
});

test('context bins <50 grey, 50-70 L1, 70-85 low diamond, ≥85 warn triangle', () => {
  assert.deepEqual(contextBin(49.9), { tone: 'grey', level: 0 });
  assert.deepEqual(contextBin(50), { tone: 'accent', level: 1 });
  assert.deepEqual(contextBin(69.9), { tone: 'accent', level: 1 });
  assert.deepEqual(contextBin(70), { tone: 'low', level: 0, shape: 'diamond' });
  assert.deepEqual(contextBin(84.9), { tone: 'low', level: 0, shape: 'diamond' });
  assert.deepEqual(contextBin(85), { tone: 'warn', level: 0, shape: 'tri' });
  assert.deepEqual(contextBin(undefined), { tone: 'grey', level: 0 });
});

test('status style: healthy grey, abnormal hue and shape', () => {
  assert.deepEqual(
    [statusStyle({ kind: 'service', status: 'ok' }).shape, statusStyle({ kind: 'lane', status: 'idle' }).shape],
    ['disc', 'diamond'], 'lanes keep their diamond when healthy');
  assert.equal(statusStyle(lane('working')).arc, true);
  assert.equal(statusStyle(lane('working')).tone, 'grey');
  assert.deepEqual([statusStyle(lane('crit')).tone, statusStyle(lane('crit')).shape], ['crit', 'square']);
  assert.deepEqual([statusStyle(lane('down')).tone, statusStyle(lane('down')).shape], ['crit', 'square']);
  assert.deepEqual([statusStyle(lane('attention')).tone, statusStyle(lane('attention')).shape], ['warn', 'tri']);
  assert.deepEqual([statusStyle(lane('warn')).tone, statusStyle(lane('warn')).shape], ['warn', 'tri']);
  assert.deepEqual([statusStyle(lane('low')).tone, statusStyle(lane('low')).shape], ['low', 'diamond']);
  assert.deepEqual([statusStyle(lane('unknown')).tone, statusStyle(lane('unknown')).shape], ['grey', 'ring']);
  assert.equal(statusStyle(lane('working', {}, { flags: { stuck: { rule: 'tool-loop' } } })).tone, 'warn');
  assert.equal(statusStyle(lane('idle', {}, { flags: { awaitingApproval: true } })).shape, 'tri');
});

test('abnormal status overrides every overlay', () => {
  const n = lane('crit', { costUsd: 0.1, ctxPct: 10, ageMs: 1, ci: 'pass' });
  for (const o of OVERLAYS) {
    const s = nodeStyle(n, o);
    assert.equal(s.tone, 'crit', o);
    assert.equal(s.shape, 'square', o);
  }
  const w = lane('attention', { costUsd: 60 });
  assert.equal(nodeStyle(w, 'cost').tone, 'warn');
  // A rolled-up status counts too.
  assert.equal(nodeStyle({ kind: 'site', status: 'ok' }, 'status', 'crit').tone, 'crit');
});

test('overlay mapping for healthy lanes', () => {
  assert.deepEqual(
    [nodeStyle(lane('working', { costUsd: 7 }), 'cost').tone, nodeStyle(lane('working', { costUsd: 7 }), 'cost').level],
    ['accent', 2]);
  assert.equal(nodeStyle(lane('working', { costUsd: 9 }), 'cost', null, { budgetUsd: 10 }).tone, 'low');
  assert.equal(nodeStyle(lane('working', { costUsd: 9 }), 'cost', null, { budgetUsd: 10 }).shape, 'diamond');
  assert.equal(nodeStyle(lane('working', { costUsd: 10 }), 'cost', null, { budgetUsd: 10 }).tone, 'crit');
  assert.equal(nodeStyle(lane('working', { costUsd: 7 }), 'cost', null, { budgetUsd: 10 }).tone, 'accent');
  assert.equal(nodeStyle(lane('working', { ctxPct: 90 }), 'context').tone, 'warn');
  assert.equal(nodeStyle(lane('working', { ctxPct: 30 }), 'context').shape, 'diamond');
  assert.equal(nodeStyle(lane('working', { ageMs: 2 * HOUR }), 'age').level, 2);
  assert.equal(nodeStyle(lane('working', { ageMs: 1 }), 'age').tone, 'grey');
  assert.equal(nodeStyle(lane('ok', { ci: 'fail' }), 'ci').tone, 'crit');
  assert.equal(nodeStyle(lane('ok', { ci: 'running' }), 'ci').arc, true);
  assert.equal(nodeStyle(lane('ok', { ci: 'pass' }), 'ci').tone, 'grey');
  assert.equal(nodeStyle(lane('ok', {}), 'ci').shape, 'ring', 'ci none is a ring');
  assert.equal(nodeStyle({ kind: 'package', status: 'ok', m: { ci: 'fail' } }, 'ci').tone, 'crit');
});

test('non-lane nodes dim in non-status overlays', () => {
  const room = { kind: 'room', status: 'ok' };
  assert.equal(nodeStyle(room, 'status').alpha, 1);
  for (const o of ['ci', 'cost', 'context', 'age']) assert.equal(nodeStyle(room, o).alpha, DIM, o);
  assert.equal(nodeStyle(lane(), 'cost').alpha, 1);
  assert.equal(nodeStyle({ kind: 'session', status: 'ok', m: {} }, 'cost').alpha, 1);
  assert.equal(nodeStyle({ kind: 'package', status: 'ok', m: {} }, 'ci').alpha, 1);
  assert.equal(nodeStyle({ kind: 'package', status: 'ok', m: {} }, 'cost').alpha, DIM);
});

test('linkStyle: only a confirmed conflict is crit, a predicted one dashed warn', () => {
  const confirmed = linkStyle({ kind: 'conflict', predicted: false, severity: 'crit' });
  assert.deepEqual([confirmed.tone, confirmed.width, confirmed.dash], ['crit', 1.5, []]);
  const predicted = linkStyle({ kind: 'conflict', predicted: true, severity: 'warn' });
  assert.deepEqual([predicted.tone, predicted.dash], ['warn', [4, 3]]);
  assert.equal(confirmedConflict({ kind: 'conflict', severity: 'crit' }), true);
  const others = [
    { kind: 'touch' }, { kind: 'pkg', live: true }, { kind: 'ci', live: true }, { kind: 'tree' },
    { kind: 'dep', status: 'crit' }, { kind: 'flow', status: 'down', live: true }, { kind: 'share' },
  ];
  for (const l of others) assert.notEqual(linkStyle(l).tone, 'crit', l.kind);
  for (const o of OVERLAYS) assert.equal(linkStyle({ kind: 'conflict', predicted: false }, o).tone, 'crit');
});

test('linkStyle dash patterns and animation', () => {
  assert.deepEqual(linkStyle({ kind: 'touch' }), { tone: 'grey', width: 1, dash: [], alpha: 0.35, animate: false });
  assert.deepEqual(linkStyle({ kind: 'pkg' }).dash, [1, 3]);
  assert.ok(linkStyle({ kind: 'pkg' }, 'ci').alpha > linkStyle({ kind: 'pkg' }).alpha);
  assert.equal(linkStyle({ kind: 'ci', live: true }).animate, true);
  assert.equal(linkStyle({ kind: 'ci', live: false }).animate, false);
  assert.deepEqual(linkStyle({ kind: 'share' }).dash, [1, 3]);
  assert.deepEqual(linkStyle({ kind: 'dep' }).dash, [4, 4]);
  assert.deepEqual(linkStyle({ kind: 'flow', live: true }).dash, []);
  assert.equal(linkStyle({ kind: 'flow', live: true }).animate, true);
  assert.equal(linkStyle({ kind: 'dep', status: 'warn' }).tone, 'warn');
  assert.equal(linkStyle({ kind: 'dep', status: 'ok' }).tone, 'grey');
  assert.equal(linkStyle({ kind: 'tree' }).tone, 'line');
});

test('codes for the packed minimap scene are distinct', () => {
  assert.equal(new Set(Object.values(SHAPE_CODE)).size, Object.keys(SHAPE_CODE).length);
  assert.equal(new Set(Object.values(TONE_CODE)).size, Object.keys(TONE_CODE).length);
  assert.equal(ACCENT_L.length, 5);
});
