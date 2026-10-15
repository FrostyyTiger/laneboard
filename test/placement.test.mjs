// Placement scoring (fleet plan §3 2.11, H8).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rank, pick, check, assess, slotCounts, metricsOf } from '../server/hub/placement.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';

function slots(total, used, orphans = 0) {
  const out = [{ slot: 0, laneSlot: false, lane: null, orphan: false }];
  for (let i = 0; i < total; i++) out.push({ slot: i + 1, laneSlot: true, lane: i < used ? `l${i}` : null, orphan: i >= used && i < used + orphans });
  return out;
}

/** A fleet-store view row. */
function row(id, { state = 'up', free = 2, total = 4, mem = 8000, swapUsed = 0, swapTotal = 8000, load = 1, cpus = 4,
  latencyMs = 10, caps = ['launch'], repos = ['acme'], allow = ['acme'], skew = 'same', needsYou = 0 } = {}) {
  const sessions = new Map();
  for (let i = 0; i < needsYou; i++) sessions.set(`s${i}`, { name: `s${i}`, state: 'waiting_permission' });
  return {
    id, state, conn: { state, latencyMs }, versionSkew: skew, repos: allow,
    hello: { capabilities: caps, repos },
    snap: {
      sessions,
      box: { slots: slots(total, total - free), launched: [] },
      vitals: { mem: { availableMb: mem, swapUsedMb: swapUsed, swapTotalMb: swapTotal }, load: [load, load, load], cpus },
    },
  };
}
const view = (...builders) => ({ now: 0, builders });
const R = Object.freeze({ repo: 'acme' });

test('slotCounts counts free lane slots only (not reserved, taken or orphaned)', () => {
  assert.deepEqual(slotCounts({ slots: slots(4, 1, 1) }), { total: 4, free: 2 });
  assert.equal(slotCounts({}), null);
  assert.equal(metricsOf(row('a', { load: 6, cpus: 4 })).load, 1.5);
});

test('a builder with no free slot is ineligible whatever its memory', () => {
  const r = rank(view(row('builder-a', { free: 0, mem: 500000 }), row('builder-b', { free: 1, mem: 5000 })), R);
  assert.equal(r[0].builder, 'builder-b');
  const a = r.find((x) => x.builder === 'builder-a');
  assert.equal(a.eligible, false);
  assert.ok(a.reasons.includes('no free lane slot'));
  assert.equal(pick(view(row('builder-a', { free: 0, mem: 500000 })), R), null);
});

test('high swap is ineligible; low memory, down, major skew and missing capability too', () => {
  const r = assess(row('builder-a', { swapUsed: 4000, swapTotal: 8000 }), R);
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(), /swap 50%/);
  assert.equal(assess(row('builder-a', { swapUsed: 3999, swapTotal: 8000 }), R).eligible, true);
  assert.equal(assess(row('builder-a', { swapTotal: 0, swapUsed: 0 }), R).eligible, true);
  assert.equal(assess(row('builder-a', { mem: 4000 }), R).eligible, false);
  assert.equal(assess(row('builder-a', { state: 'stale' }), R).eligible, false);
  assert.equal(assess(row('builder-a', { skew: 'major' }), R).eligible, false);
  assert.equal(assess(row('builder-a', { skew: 'minor' }), R).eligible, true);
  assert.equal(assess(row('builder-a', { caps: [] }), R).eligible, false);
  assert.equal(assess(row('builder-a', { caps: [] }), { ...R, need: null }).eligible, true);
  // Thresholds come from config.
  assert.equal(assess(row('builder-a', { mem: 3000 }), { ...R, cfg: { minFreeMemMb: 2048 } }).eligible, true);
  assert.equal(assess(row('builder-a', { swapUsed: 1000 }), { ...R, cfg: { maxSwapFrac: 0.1 } }).eligible, false);
});

test('with an equal slot count, more memory and less load wins', () => {
  const r = rank(view(
    row('builder-a', { mem: 6000, load: 3 }),
    row('builder-b', { mem: 12000, load: 3 }),
    row('builder-c', { mem: 12000, load: 0.5 }),
  ), R);
  assert.deepEqual(r.map((x) => x.builder), ['builder-c', 'builder-b', 'builder-a']);
  assert.ok(r.every((x) => x.eligible));
});

test('score follows the formula, and attention lowers it', () => {
  const r = assess(row('builder-a', { free: 2, total: 4, mem: 8192, load: 2, cpus: 4, swapUsed: 800, swapTotal: 8000 }), R);
  const expect = 0.4 * 0.5 + 0.3 * 0.5 + 0.2 * 0.5 + 0.1 * 0.9;
  assert.ok(Math.abs(r.score - expect) < 1e-3, `${r.score} vs ${expect}`);
  const busy = assess(row('builder-a', { free: 2, total: 4, mem: 8192, load: 2, cpus: 4, swapUsed: 800, swapTotal: 8000, needsYou: 2 }), R);
  assert.ok(Math.abs(busy.score - (expect - 0.1)) < 1e-3);
  // Hostile numbers from a builder cannot inflate the score.
  const liar = assess(row('builder-a', { mem: 1e12, load: -50, swapUsed: -10 }), R);
  assert.ok(liar.score <= 1.0001, String(liar.score));
});

test('ties break on latency, then config order', () => {
  const r = rank(view(row('builder-a', { latencyMs: 80 }), row('builder-b', { latencyMs: 20 }), row('builder-c', { latencyMs: 20 })), R);
  assert.deepEqual(r.map((x) => x.builder), ['builder-b', 'builder-c', 'builder-a']);
});

test('repo gate: needs the hello claim AND the hub-config allowlist (never the claim alone)', () => {
  const v = view(
    row('builder-a', { repos: ['acme', 'secret'], allow: ['acme'], mem: 16000, load: 0 }),
    row('builder-b', { repos: ['secret'], allow: ['secret'], mem: 6000 }),
  );
  const r = rank(v, { repo: 'secret' });
  assert.equal(r[0].builder, 'builder-b');
  const a = r.find((x) => x.builder === 'builder-a');
  assert.equal(a.eligible, false);
  assert.ok(a.reasons.some((x) => /not allowed by hub config/.test(x)));
  // No builder may be picked for a repo only claimed against the allowlist.
  assert.equal(pick(view(row('builder-a', { repos: ['secret'], allow: ['acme'] })), { repo: 'secret' }), null);
  // A builder that does not report repos is not eligible for a repo (hello can only narrow).
  assert.equal(assess(row('builder-a', { repos: null }), R).eligible, false);
  assert.equal(assess(row('builder-a', { repos: ['other'] }), R).eligible, false);
  assert.equal(assess(row('builder-a', { allow: ['acme'] }), R).eligible, true);
});

test('SR11 M2: a builder with no hub-config allowlist is never auto-placed unless placement.any', () => {
  // Partial allowlist: builder-x has none, claims acme and reports perfect numbers.
  const v = view(
    row('builder-a', { allow: ['acme'], mem: 5000, load: 3, free: 1 }),
    row('builder-x', { allow: null, repos: ['acme'], mem: 1e9, load: 0, free: 4, swapUsed: 0 }),
  );
  const r = rank(v, R);
  assert.equal(r[0].builder, 'builder-a');
  const x = r.find((y) => y.builder === 'builder-x');
  assert.equal(x.eligible, false);
  assert.ok(x.reasons.includes('no hub-config repos allowlist for builder'));
  assert.equal(pick(view(row('builder-x', { allow: null })), R), null);
  // Only an explicit hub-config opt-in makes an unlisted builder eligible; hello still narrows.
  assert.equal(assess(row('builder-x', { allow: null }), { ...R, cfg: { any: true } }).eligible, true);
  assert.equal(assess(row('builder-x', { allow: null }), { ...R, cfg: { any: 'yes' } }).eligible, false);
  assert.equal(assess(row('builder-x', { allow: null, repos: ['other'] }), { ...R, cfg: { any: true } }).eligible, false);
  // any never widens a configured list.
  assert.equal(assess(row('builder-a', { allow: ['other'] }), { ...R, cfg: { any: true } }).eligible, false);
});

test('SR11 M1: no repo or a malformed repo makes every builder ineligible', () => {
  for (const repo of [undefined, null, '', ['acme'], { toString: () => 'acme' }, '../acme', '__proto__']) {
    const a = assess(row('builder-a'), { repo });
    assert.equal(a.eligible, false, String(repo));
    assert.ok(a.reasons.includes('repo required'));
  }
  assert.equal(pick(view(row('builder-a'), row('builder-b')), {}), null);
});

test('SR11 L6: self-reported numbers are clamped; a liar at best ties an honest idle builder', () => {
  const honest = assess(row('builder-a', { free: 4, total: 4, mem: 16384, load: 0, swapUsed: 0 }), R);
  assert.equal(honest.score, 1);
  const liar = assess(row('builder-x', { free: 4, total: 4, mem: 1e15, load: -1e9, cpus: 1e12, swapUsed: -1e9, swapTotal: 1 }), R);
  assert.ok(liar.score <= honest.score, String(liar.score));
  assert.ok(liar.metrics.mem <= 16 * 1024 * 1024);
  assert.ok(liar.metrics.load >= 0);
  assert.equal(liar.selfReported, true);
  // availableMb cannot exceed a reported totalMb.
  const b = row('builder-a');
  b.snap.vitals.mem.totalMb = 2000;
  b.snap.vitals.mem.availableMb = 900000;
  assert.equal(metricsOf(b).mem, 2000);
  // Ties break on latency then config order, never on an inflated number.
  const r = rank(view(row('builder-a', { free: 4, mem: 16384, load: 0, latencyMs: 5 }), row('builder-x', { free: 4, mem: 1e15, load: -5, latencyMs: 5 })), R);
  assert.equal(r[0].builder, 'builder-a');
});

test('an explicit ineligible choice is passed through with a warning', () => {
  const v = view(row('builder-a', { free: 0 }), row('builder-b'));
  const c = check(v, 'builder-a', R);
  assert.equal(c.builder, 'builder-a');
  assert.equal(c.eligible, false);
  assert.match(c.warning, /builder-a is not eligible: no free lane slot/);
  assert.equal(check(v, 'builder-b', R).warning, undefined);
  assert.equal(check(v, 'builder-q', R), null);
});

test('works on a real fleet-store view; missing cpus does not gate', () => {
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'http://127.0.0.1:1', repos: ['acme'] }], hubVersion: '0.1.0' });
  const t = Date.now();
  store.setConn('builder-a', { state: 'up', lastSeen: t, latencyMs: 5, hello: { version: '0.1.0', apiVersion: 1, capabilities: ['launch'], repos: ['acme'] } });
  store.applySnapshot('builder-a', {
    sessions: [{ name: 'web', state: 'waiting_permission' }],
    box: { slots: slots(2, 0), launched: [] },
    vitals: { mem: { availableMb: 9000, swapTotalMb: 0, swapUsedMb: 0 }, load: [1, 2, 3] },
  }, t);
  const [r] = rank(store.view(t), { repo: 'acme' });
  assert.equal(r.eligible, true, r.reasons.join());
  assert.ok(r.reasons.includes('load unknown'));
  assert.equal(r.metrics.needsYou, 1);
  assert.equal(r.latencyMs, 5);
});

test('vitals carry cpus (os.availableParallelism) for load per vCPU', async () => {
  process.env.LANEBOARD_CONFIG ??= '/dev/null';
  process.env.LANEBOARD_DB ??= ':memory:';
  const os = await import('node:os');
  const { sample } = await import('../server/collector/vitals.mjs');
  const v = await sample();
  assert.equal(v.cpus, os.availableParallelism());
  assert.ok(Number.isInteger(v.cpus) && v.cpus >= 1);
});
