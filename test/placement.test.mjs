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
  latencyMs = 10, caps = ['launch'], repos = ['acme'], allow = null, skew = 'same', needsYou = 0 } = {}) {
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

test('slotCounts counts free lane slots only (not reserved, taken or orphaned)', () => {
  assert.deepEqual(slotCounts({ slots: slots(4, 1, 1) }), { total: 4, free: 2 });
  assert.equal(slotCounts({}), null);
  assert.equal(metricsOf(row('a', { load: 6, cpus: 4 })).load, 1.5);
});

test('a builder with no free slot is ineligible whatever its memory', () => {
  const r = rank(view(row('builder-a', { free: 0, mem: 500000 }), row('builder-b', { free: 1, mem: 5000 })));
  assert.equal(r[0].builder, 'builder-b');
  const a = r.find((x) => x.builder === 'builder-a');
  assert.equal(a.eligible, false);
  assert.ok(a.reasons.includes('no free lane slot'));
  assert.equal(pick(view(row('builder-a', { free: 0, mem: 500000 }))), null);
});

test('high swap is ineligible; low memory, down, major skew and missing capability too', () => {
  const r = assess(row('builder-a', { swapUsed: 4000, swapTotal: 8000 }));
  assert.equal(r.eligible, false);
  assert.match(r.reasons.join(), /swap 50%/);
  assert.equal(assess(row('builder-a', { swapUsed: 3999, swapTotal: 8000 })).eligible, true);
  assert.equal(assess(row('builder-a', { swapTotal: 0, swapUsed: 0 })).eligible, true);
  assert.equal(assess(row('builder-a', { mem: 4000 })).eligible, false);
  assert.equal(assess(row('builder-a', { state: 'stale' })).eligible, false);
  assert.equal(assess(row('builder-a', { skew: 'major' })).eligible, false);
  assert.equal(assess(row('builder-a', { skew: 'minor' })).eligible, true);
  assert.equal(assess(row('builder-a', { caps: [] })).eligible, false);
  assert.equal(assess(row('builder-a', { caps: [] }), { need: null }).eligible, true);
  // Thresholds come from config.
  assert.equal(assess(row('builder-a', { mem: 3000 }), { cfg: { minFreeMemMb: 2048 } }).eligible, true);
  assert.equal(assess(row('builder-a', { swapUsed: 1000 }), { cfg: { maxSwapFrac: 0.1 } }).eligible, false);
});

test('with an equal slot count, more memory and less load wins', () => {
  const r = rank(view(
    row('builder-a', { mem: 6000, load: 3 }),
    row('builder-b', { mem: 12000, load: 3 }),
    row('builder-c', { mem: 12000, load: 0.5 }),
  ));
  assert.deepEqual(r.map((x) => x.builder), ['builder-c', 'builder-b', 'builder-a']);
  assert.ok(r.every((x) => x.eligible));
});

test('score follows the formula, and attention lowers it', () => {
  const r = assess(row('builder-a', { free: 2, total: 4, mem: 8192, load: 2, cpus: 4, swapUsed: 800, swapTotal: 8000 }));
  const expect = 0.4 * 0.5 + 0.3 * 0.5 + 0.2 * 0.5 + 0.1 * 0.9;
  assert.ok(Math.abs(r.score - expect) < 1e-3, `${r.score} vs ${expect}`);
  const busy = assess(row('builder-a', { free: 2, total: 4, mem: 8192, load: 2, cpus: 4, swapUsed: 800, swapTotal: 8000, needsYou: 2 }));
  assert.ok(Math.abs(busy.score - (expect - 0.1)) < 1e-3);
  // Hostile numbers from a builder cannot inflate the score.
  const liar = assess(row('builder-a', { mem: 1e12, load: -50, swapUsed: -10 }));
  assert.ok(liar.score <= 1.0001, String(liar.score));
});

test('ties break on latency, then config order', () => {
  const r = rank(view(row('builder-a', { latencyMs: 80 }), row('builder-b', { latencyMs: 20 }), row('builder-c', { latencyMs: 20 })));
  assert.deepEqual(r.map((x) => x.builder), ['builder-b', 'builder-c', 'builder-a']);
});

test('repo gate: needs the hello claim AND the hub-config allowlist (never the claim alone)', () => {
  const v = view(
    row('builder-a', { repos: ['acme', 'secret'], allow: ['acme'], mem: 16000, load: 0 }),
    row('builder-b', { repos: ['secret'], allow: null, mem: 6000 }),
  );
  const r = rank(v, { repo: 'secret' });
  assert.equal(r[0].builder, 'builder-b');
  const a = r.find((x) => x.builder === 'builder-a');
  assert.equal(a.eligible, false);
  assert.ok(a.reasons.some((x) => /not allowed by hub config/.test(x)));
  // No builder may be picked for a repo only claimed against the allowlist.
  assert.equal(pick(view(row('builder-a', { repos: ['secret'], allow: ['acme'] })), { repo: 'secret' }), null);
  // A builder that does not report repos is not eligible for a repo.
  assert.equal(assess(row('builder-a', { repos: null }), { repo: 'acme' }).eligible, false);
  assert.equal(assess(row('builder-a', { allow: ['acme'] }), { repo: 'acme' }).eligible, true);
});

test('an explicit ineligible choice is passed through with a warning', () => {
  const v = view(row('builder-a', { free: 0 }), row('builder-b'));
  const c = check(v, 'builder-a');
  assert.equal(c.builder, 'builder-a');
  assert.equal(c.eligible, false);
  assert.match(c.warning, /builder-a is not eligible: no free lane slot/);
  assert.equal(check(v, 'builder-b').warning, undefined);
  assert.equal(check(v, 'builder-q'), null);
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
