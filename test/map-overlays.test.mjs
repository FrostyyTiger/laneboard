// The Map's overlays: bins, status override, cycling, link styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERLAYS, nextOverlay, validOverlay, costLevel, ageLevel, contextBin, statusStyle,
  nodeStyle, linkStyle, confirmedConflict, DIM, SHAPE_CODE, TONE_CODE, ACCENT_L,
  DRIFT_TEXT, driftText, driftCounts,
  availableOverlays, reachScope, reachLinkStyle, REACH_MARK,
} from '../public/js/views/map/overlays.js';

const lane = (status = 'working', m = {}, extra = {}) => ({ id: 'lane:builder-a/x', kind: 'lane', status, m, ...extra });
const MIN = 60e3, HOUR = 60 * MIN;

test('nextOverlay cycles both ways and wraps', () => {
  assert.deepEqual(OVERLAYS, ['status', 'ci', 'cost', 'context', 'age', 'drift', 'reach']);
  let o = 'status';
  const seen = [];
  for (let i = 0; i < OVERLAYS.length; i++) { o = nextOverlay(o); seen.push(o); }
  assert.deepEqual(seen, ['ci', 'cost', 'context', 'age', 'drift', 'reach', 'status']);
  assert.equal(nextOverlay('status', -1), 'reach');
  assert.equal(nextOverlay('age'), 'drift');
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

test('drift overlay: missing is a dashed warn ring, undeclared an accent ring, the rest dimmed', () => {
  const missing = { kind: 'room', status: 'unknown', drift: 'missing' };
  const undeclared = { kind: 'room', status: 'ok', drift: 'undeclared', discovered: true };
  const calm = { kind: 'room', status: 'ok' };
  const m = nodeStyle(missing, 'drift');
  assert.equal(m.mark.tone, 'warn');
  assert.ok(m.mark.dash.length === 2, 'dashed');
  assert.equal(m.alpha, 1);
  assert.equal(m.shape, 'ring', 'its unknown status still shows');
  const u = nodeStyle(undeclared, 'drift');
  assert.equal(u.mark.tone, 'accent');
  assert.deepEqual(u.mark.dash, [], 'solid');
  assert.equal(u.alpha, 1);
  assert.equal(nodeStyle(calm, 'drift').alpha, DIM);
  assert.equal(nodeStyle(calm, 'drift').mark, undefined);
  assert.equal(nodeStyle(lane('working'), 'drift').alpha, DIM, 'lanes dim too');
  // A crit node without drift keeps its hue, dimmed; no other overlay draws a mark.
  assert.equal(nodeStyle({ kind: 'room', status: 'crit' }, 'drift').tone, 'crit');
  for (const o of OVERLAYS.filter((x) => x !== 'drift')) assert.equal(nodeStyle(missing, o).mark, undefined, o);
  // The style is a copy: changing it does not change the next one.
  m.mark.dash.push(9);
  assert.equal(nodeStyle(missing, 'drift').mark.dash.length, 2);
});

test('drift words and counts', () => {
  assert.equal(driftText({ drift: 'missing' }), 'declared, not seen');
  assert.equal(driftText({ drift: 'undeclared' }), 'seen, not declared');
  assert.equal(driftText({}), null);
  assert.equal(driftText({ drift: 'toString' }), null);
  assert.deepEqual(Object.keys(DRIFT_TEXT), ['missing', 'undeclared']);
  assert.deepEqual(driftCounts([{ drift: 'missing' }, { drift: 'undeclared' }, { drift: 'undeclared' }, {}, null]), { missing: 1, undeclared: 2 });
  assert.deepEqual(driftCounts(undefined), { missing: 0, undeclared: 0 });
});

// --- reach (T12) ---------------------------------------------------------------

const REACH = [
  { id: 'reach:a>b', kind: 'reach', from: 'a', to: 'b', ports: ['tcp:22'], label: 'tcp:22' },
  { id: 'reach:a>c', kind: 'reach', from: 'a', to: 'c', ports: ['*'], label: '*' },
  { id: 'reach:c>d', kind: 'reach', from: 'c', to: 'd', ports: ['tcp:443'], label: 'tcp:443' },
];

test('reach is skipped by o (both ways) when the model has no reach links', () => {
  for (const m of [null, {}, { reach: null }, { reach: { links: [] } }, { reach: { links: 'x' } }]) {
    const av = availableOverlays(m);
    assert.ok(!av.includes('reach'), JSON.stringify(m));
    assert.equal(nextOverlay('drift', 1, av), 'status');
    assert.equal(nextOverlay('status', -1, av), 'drift');
    let o = 'status';
    for (let i = 0; i < 20; i++) { o = nextOverlay(o, 1, av); assert.notEqual(o, 'reach'); }
  }
  const av = availableOverlays({ reach: { links: REACH } });
  assert.deepEqual(av, OVERLAYS);
  assert.equal(nextOverlay('drift', 1, av), 'reach');
  assert.equal(nextOverlay('status', -1, av), 'reach');
  assert.equal(nextOverlay('reach', 1, av), 'status');
  // A stored reach with no links still moves on.
  assert.equal(nextOverlay('reach', 1, availableOverlays(null)), 'status');
  assert.equal(nextOverlay('reach', -1, availableOverlays(null)), 'drift');
});

test('reachScope: the focus and what it reaches directly; with no focus, every named node', () => {
  const none = reachScope(REACH);
  assert.deepEqual([...none.lit].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(none.touched.size, 0);
  assert.equal(none.links, 3);
  const a = reachScope(REACH, 'a');
  assert.deepEqual([...a.touched].sort(), ['b', 'c'], 'one hop: a does not touch d');
  assert.deepEqual([...a.lit].sort(), ['a', 'b', 'c']);
  const d = reachScope(REACH, 'd');
  assert.equal(d.touched.size, 0, 'd reaches nothing');
  assert.deepEqual([...d.lit], ['d'], 'a reached node is still lit as the focus');
  assert.equal(reachScope(REACH, 'zz').lit.size, 0, 'a node outside the policy lights nothing');
  assert.equal(reachScope(null).links, 0);
  assert.equal(reachScope([{ from: 'x', to: 'x' }, null]).links, 0, 'self-links and junk dropped');
});

test('reach arc style: thin grey, the focus\'s outgoing arcs in the accent, the rest faded', () => {
  const calm = reachLinkStyle(REACH[0]);
  assert.deepEqual(calm, { tone: 'grey', level: 0, width: 1, dash: [], alpha: 0.35 });
  const out = reachLinkStyle(REACH[0], 'a');
  assert.equal(out.tone, 'accent');
  assert.equal(out.width, 1.5);
  assert.deepEqual(out.dash, []);
  assert.ok(out.alpha >= 0.85);
  const other = reachLinkStyle(REACH[2], 'a');
  assert.equal(other.tone, 'grey');
  assert.ok(other.alpha < calm.alpha, 'unrelated arcs step back while something is selected');
  assert.equal(reachLinkStyle(REACH[0], 'b').tone, 'grey', 'incoming arcs are not what b can touch');
  assert.ok([calm, out, other].every((st) => st.width <= 1.5), 'thin');
});

test('reach node style: lit full, reachable ones marked, the rest dimmed, status kept', () => {
  const rs = reachScope(REACH, 'a');
  const node = (id, status = 'ok') => ({ id, kind: 'room', status });
  assert.equal(nodeStyle(node('a'), 'reach', null, { reach: rs }).alpha, 1);
  assert.equal(nodeStyle(node('a'), 'reach', null, { reach: rs }).mark, undefined, 'the focus itself is not marked');
  const b = nodeStyle(node('b'), 'reach', null, { reach: rs });
  assert.equal(b.alpha, 1);
  assert.deepEqual(b.mark, REACH_MARK);
  assert.equal(nodeStyle(node('d'), 'reach', null, { reach: rs }).alpha, DIM);
  const crit = nodeStyle(node('c', 'crit'), 'reach', null, { reach: rs });
  assert.deepEqual([crit.tone, crit.shape, crit.alpha], ['crit', 'square', 1], 'trouble keeps its own colour');
  assert.equal(nodeStyle(node('a'), 'reach').alpha, DIM, 'no reach scope: nothing lit');
  assert.equal(nodeStyle(node('b'), 'status', null, { reach: rs }).mark, undefined, 'no mark outside the overlay');
});
