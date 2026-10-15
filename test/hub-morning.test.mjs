// Fleet R10: the hub Morning merge (server/hub/morning.mjs) and the hub routes
// GET /api/fleet/morning and GET /api/fleet/archive (server/hub/routes/review.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  mergeMorning, sanitizeBuilderMorning, costByPackage, approvalsOf, alarmIncidents,
  fetchMorning, mergeArchive, archiveRowOf, median, NONE_PACKAGE, LIMITS,
} from '../server/hub/morning.mjs';
import defaultModule, { createModule, auditSince, MORNING_PATH, ARCHIVE_PATH } from '../server/hub/routes/review.mjs';
import { createReadProxy, isAllowed } from '../server/hub/read-proxy.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { createContext } from '../server/modules.mjs';

const T0 = Date.parse('2026-10-15T07:00:00Z');
const H = 3600_000;
const MIN = 60_000;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-hub-morning-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A builder's /api/v1/morning answer (server/morning.mjs build() shape). */
function built({ needs = [], finished = [], lanes = [] } = {}) {
  return {
    window: 'tonight', label: 'Tonight', since: T0 - 12 * H, now: T0,
    needsYou: needs, finished,
    cost: { lanes, totalUsd: lanes.reduce((a, l) => a + l.usd, 0), totalTokens: 0, label: 'API-equivalent' },
    rateLimits: null,
    builder: { id: 'spoofed', code: 'XX' },
  };
}
const need = (name, kind, at, extra = {}) => ({ source: 'attention', id: `attention:${name}`, name, lane: 'feat', hue: 120, state: 'waiting', at, kind, text: 't', ...extra });
const fin = (lane, extra = {}) => ({ lane, hue: 10, branch: `lane/${lane}`, merged: false, isMain: false, idle: false, progress: { n: 1, m: 3 }, lastCommitAt: T0 - H, newCommit: true, doneMarkers: [], pr: null, sessions: [{ name: `${lane}-1`, state: 'idle', since: T0 - H }], packages: [], reviewReady: null, reviewSentAt: null, ...extra });
const costLane = (lane, usd, packages = [], extra = {}) => ({ lane, usd, tokens: 100, sessions: [`${lane}-1`], hue: 5, packages, reviewReady: null, reviewSentAt: null, ...extra });

const fixture = () => new Map([
  ['builder-a', built({
    needs: [need('a-1', 'need', T0 - 2 * H), need('a-2', 'danger', T0 - 5 * H)],
    finished: [fin('feat', { doneMarkers: [{ id: 1, ts: T0 - H, text: 'done', session: 'feat-1' }] }), fin('old', { lastCommitAt: T0 - 3 * H })],
    lanes: [costLane('feat', 3, ['web', 'api']), costLane('old', 1, ['web']), costLane(null, 0.5)],
  })],
  ['builder-b', { error: 'builder timeout' }],
  ['builder-c', built({
    needs: [need('c-1', 'need', T0 - MIN)],
    lanes: [costLane('ui', 2, ['web', 'api', 'docs']), { lane: '(ended sessions)', usd: 4, tokens: 1, sessions: [] }],
  })],
]);

test('merge: two builders and one in error; fkeys, builder tags, ordering, missing', () => {
  const m = mergeMorning({ perBuilder: fixture(), window: 'tonight', since: T0 - 12 * H, now: T0 });
  assert.deepEqual(m.builders.map((b) => b.id), ['builder-a', 'builder-c', 'builder-b']);
  const b = m.builders.find((x) => x.id === 'builder-b');
  assert.equal(b.error, 'builder timeout');
  assert.equal(b.stale, true);
  assert.deepEqual(b.needsYou, []);
  assert.deepEqual(m.missing, ['builder-b']);
  // the payload's own builder claim is ignored
  assert.equal(m.builders[0].code, 'BA');
  // needsYou concatenated and re-sorted: danger first, then newest
  assert.deepEqual(m.needsYou.map((n) => n.name), ['builder-a/a-2', 'builder-c/c-1', 'builder-a/a-1']);
  assert.equal(m.needsYou[0].builder, 'builder-a');
  assert.equal(m.needsYou[0].lane, 'builder-a/feat');
  assert.equal(m.needsYou[0].id, 'builder-a/attention:a-2');
  // finished: news (done marker) first
  assert.deepEqual(m.finished.map((f) => f.lane), ['builder-a/feat', 'builder-a/old']);
  assert.equal(m.finished[0].doneMarkers[0].session, 'builder-a/feat-1');
  assert.deepEqual(m.finished[0].sessions.map((s) => s.name), ['builder-a/feat-1']);
  // cost rows: a non-lane label keeps its label and no lane fkey
  const ended = m.builders.find((x) => x.id === 'builder-c').cost.lanes.find((l) => l.label === '(ended sessions)');
  assert.equal(ended.lane, null);
  assert.equal(typeof m.label, 'string');
});

test('cost by package: equal split, (none) bucket, totals add up to totalUsd', () => {
  const m = mergeMorning({ perBuilder: fixture(), since: T0 - 12 * H, now: T0 });
  near(m.totalUsd, 3 + 1 + 0.5 + 2 + 4);
  const by = Object.fromEntries(m.costByPackage.map((p) => [p.package, p]));
  near(by.web.usd, 1.5 + 1 + 2 / 3);
  near(by.api.usd, 1.5 + 2 / 3);
  near(by.docs.usd, 2 / 3);
  near(by[NONE_PACKAGE].usd, 0.5 + 4);
  assert.equal(by.web.lanes, 3);
  near(m.costByPackage.reduce((a, p) => a + p.usd, 0), m.totalUsd);
  assert.equal(m.costByPackage[0].package, NONE_PACKAGE);
  // empty input: empty list, zero total
  assert.deepEqual(costByPackage([]), []);
  assert.equal(mergeMorning({}).totalUsd, 0);
});

test('untrusted builder data: numbers clamped, strings capped, counts capped, bad ids dropped', () => {
  const raw = built({
    needs: Array.from({ length: LIMITS.needsYou + 50 }, (_, i) => need(`s${i}`, 'need', T0 - i, { text: 'x'.repeat(5000) + '\u001b[31m' })),
    finished: [fin('../etc'), fin('ok', { pr: { number: 5, url: 'javascript:alert(1)', checks: { passed: 1, __proto__x: 2, nested: { a: 1 } } }, packages: Array(100).fill('p').map((p, i) => p + i) })],
    lanes: [costLane('ok', 1e30), costLane('neg', -5), costLane('nan', Number.NaN)],
  });
  raw.cost.totalUsd = 1e40;
  const r = sanitizeBuilderMorning('builder-a', raw);
  assert.equal(r.needsYou.length, LIMITS.needsYou);
  assert.ok(r.needsYou[0].text.length <= LIMITS.text);
  assert.ok(!r.needsYou[0].text.includes('\u001b'));
  assert.deepEqual(r.finished.map((f) => f.lane), ['builder-a/ok']);
  assert.equal(r.finished[0].pr.url, null);
  assert.equal(r.finished[0].pr.checks.passed, 1);
  assert.equal(r.finished[0].pr.checks.nested, undefined);
  assert.equal(r.finished[0].packages.length, LIMITS.packages);
  assert.equal(r.cost.lanes.find((l) => l.lane === 'builder-a/ok').usd, 1e6);
  assert.equal(r.cost.lanes.find((l) => l.lane === 'builder-a/neg').usd, 0);
  assert.equal(r.cost.lanes.find((l) => l.lane === 'builder-a/nan').usd, 0);
  assert.equal(r.cost.totalUsd, 1e6); // recomputed, not the claimed 1e40
  // a JSON __proto__ key does not pollute anything
  const evil = JSON.parse('{"needsYou":[{"__proto__":{"polluted":1},"name":"x","kind":"need"}],"finished":[],"cost":{"lanes":[]}}');
  const e = sanitizeBuilderMorning('builder-a', evil);
  assert.equal(({}).polluted, undefined);
  assert.equal(e.needsYou[0].polluted, undefined);
  // non-object answers are errors, not crashes
  assert.equal(sanitizeBuilderMorning('builder-a', [1, 2]).error, 'bad response');
  assert.equal(sanitizeBuilderMorning('builder-a', 'x').stale, true);
  assert.equal(sanitizeBuilderMorning('builder-a', { error: 'e'.repeat(1000) }).error.length, LIMITS.error);
});

test('approvals counted from hub audit fixtures', () => {
  const since = T0 - 12 * H;
  const audit = [
    { id: 'e1', ts: T0 - H, action: 'approve', result: { phase: 'sent' } },
    { id: 'e1', ts: T0 - H, action: 'approve', result: { phase: 'done', ok: true } },
    { id: 'e2', ts: T0 - H, action: 'deny', result: { phase: 'done', ok: true } },
    { id: 'e3', ts: T0 - H, action: 'release', result: { phase: 'done', ok: true } },
    { id: 'e4', ts: T0 - H, action: 'approve', result: { phase: 'done', ok: false } },
    { id: 'e5', ts: T0 - 20 * H, action: 'approve', result: { phase: 'done', ok: true } },
    { id: 'e6', ts: T0 - H, action: 'pause', result: { phase: 'done', ok: true } },
    { id: 'e1', ts: T0 - H, action: 'approve', result: { phase: 'done', ok: true } },
  ];
  assert.deepEqual(approvalsOf(audit, { since, answerTimes: [MIN, 3 * MIN, 2 * MIN] }), {
    answered: 3, approved: 1, denied: 1, released: 1, medianAnswerMs: 2 * MIN,
  });
  const m = mergeMorning({ perBuilder: new Map(), audit, since, answerTimes: [] });
  assert.equal(m.approvals.answered, 3);
  assert.equal(m.approvals.medianAnswerMs, null);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('stuck list passes through; incidents built from alarm history', () => {
  const stuck = [{ fkey: 'builder-a/a-1', builder: 'builder-a', reason: 'tool-loop', since: T0 - 2 * H, resolvedAt: T0 - H }];
  assert.deepEqual(mergeMorning({ stuck }).stuck, stuck);
  const pay = (id, since, extra = {}) => ({ id, kind: 'stuck', builder: 'builder-a', target: 'a-1', text: 'tool loop', since, ...extra });
  const history = [
    { ts: T0 - 3 * H, subtype: 'raised', payload: pay('stuck:builder-a:a-1', T0 - 3 * H) },
    { ts: T0 - 2 * H, subtype: 'cleared', payload: JSON.stringify(pay('stuck:builder-a:a-1', T0 - 3 * H)) },
    { ts: T0 - 30 * H, subtype: 'raised', payload: pay('stuck:old', T0 - 30 * H) },
    { ts: T0 - 29 * H, subtype: 'cleared', payload: pay('stuck:old', T0 - 30 * H) },
    { ts: T0 - H, subtype: 'raised', payload: { ...pay('x', T0 - H), kind: 'approval' } },
  ];
  const live = [pay('stuck:builder-a:a-2', T0 - 10 * MIN, { target: 'a-2' })];
  const inc = alarmIncidents(history, { kind: 'stuck', since: T0 - 12 * H, live });
  assert.deepEqual(inc.map((i) => [i.fkey, i.since, i.resolvedAt]), [
    ['builder-a/a-2', T0 - 10 * MIN, null],
    ['builder-a/a-1', T0 - 3 * H, T0 - 2 * H],
  ]);
});

test('review waits and the notify digest are folded in and bounded', () => {
  const waits = {
    stats: { n: 4, medianMs: 30 * MIN, p90Ms: 2 * H },
    open: Array.from({ length: 9 }, (_, i) => ({ fkey: `builder-a/l${i}`, waitingMs: i * MIN, readyAt: T0 - i * MIN })),
  };
  const deferred = [
    { id: 'a1', kind: 'need', builder: 'builder-a', target: 'a-1', fkey: 'builder-a/a-1', title: 'Needs you', body: 'b', url: '#/inbox', reason: 'quiet', at: T0 - H },
    { id: 'a2', kind: 'need', builder: 'builder-a', target: 'a-2', fkey: 'builder-a/a-2', title: 'x', body: 'b', url: 'https://evil.example.invalid', reason: 'rate', at: T0 - H },
  ];
  const m = mergeMorning({ waits, deferred });
  assert.deepEqual(m.review, {
    n: 4, waiting: 9, medianWaitMs: 30 * MIN, p90WaitMs: 2 * H,
    longest: [8, 7, 6, 5, 4].map((i) => ({ fkey: `builder-a/l${i}`, waitMs: i * MIN })),
  });
  assert.deepEqual(m.deferred.map((d) => [d.id, d.reason, d.url]), [['a1', 'quiet', '#/inbox'], ['a2', 'rate', null]]);
  assert.deepEqual(mergeMorning({}).review, { n: 0, waiting: 0, medianWaitMs: null, p90WaitMs: null, longest: [] });
});

// --- fan-out through the real read proxy -----------------------------------------

const hubKey = crypto.generateKeyPairSync('ed25519').privateKey;

function upStore(ids, t = Date.now()) {
  const store = createFleetStore({ builders: ids.map((id) => ({ id, url: `http://${id}.example.invalid:7777` })) });
  for (const id of ids) store.setConn(id, { state: 'up', lastSeen: t });
  return store;
}

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('allowlist: /api/v1/morning and /api/v1/archive are proxied reads', () => {
  for (const r of ['morning', 'morning?window=tonight', 'archive', 'archive?q=x&limit=5', 'archive/feat']) assert.ok(isAllowed(r), r);
});

test('fetchMorning: a builder timing out (3 s budget) is listed in missing; signed GET of /api/v1/morning', async () => {
  const seen = [];
  const fetchImpl = (url, { signal, headers }) => {
    seen.push({ url, headers });
    if (url.includes('builder-b')) {
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    }
    return Promise.resolve(jsonRes(built({ needs: [need('a-1', 'need', T0)] })));
  };
  const store = upStore(['builder-a', 'builder-b']);
  const proxy = createReadProxy({ store, key: hubKey, fetchImpl });
  const t = Date.now();
  const per = await fetchMorning({ readProxy: proxy, ids: ['builder-a', 'builder-b'], window: 'tonight', timeoutMs: 80 });
  assert.ok(Date.now() - t < 2000);
  assert.equal(per.get('builder-b').error, 'builder timeout');
  assert.ok(seen.some((s) => s.url === 'http://builder-a.example.invalid:7777/api/v1/morning?window=tonight'));
  assert.ok(seen.every((s) => Object.keys(s.headers).some((h) => /sig/i.test(h))));
  const m = mergeMorning({ perBuilder: per, builders: [{ id: 'builder-a', code: 'BA' }, { id: 'builder-b', code: 'BB' }] });
  assert.deepEqual(m.missing, ['builder-b']);
  assert.equal(m.builders.find((b) => b.id === 'builder-b').stale, true);
  assert.equal(m.needsYou[0].name, 'builder-a/a-1');
});

// --- archive ------------------------------------------------------------------------

const arow = (lane, retired, extra = {}) => ({ lane, repo: 'acme', branch: `lane/${lane}`, plan_path: 'p.md', plan_title: 'P', created_at: retired - H, retired_at: retired, duration_ms: H, cost_usd: 1.25, tokens: 10, stage_n: 1, stage_m: 2, pr_number: 3, pr_url: 'https://github.com/acme/x/pull/3', pr_state: 'MERGED', merged: true, summary: 's', restored_as: null, ...extra });

test('archive merge: newest retired first, rows tagged with builder, bad rows dropped, missing listed', () => {
  const per = new Map([
    ['builder-a', { rows: [arow('a', T0 - 3 * H), arow('../x', T0), arow('b', T0 - H, { pr_url: 'javascript:x', cost_usd: -1 })] }],
    ['builder-b', { rows: [arow('a', T0 - 2 * H)] }],
    ['builder-c', { error: 'builder down' }],
  ]);
  const out = mergeArchive(per, { limit: 50 });
  assert.deepEqual(out.rows.map((r) => [r.builder, r.lane, r.fkey]), [
    ['builder-a', 'b', 'builder-a/b'], ['builder-b', 'a', 'builder-b/a'], ['builder-a', 'a', 'builder-a/a'],
  ]);
  assert.equal(out.rows[0].pr_url, null);
  assert.equal(out.rows[0].cost_usd, 0);
  assert.deepEqual(out.missing, ['builder-c']);
  assert.equal(mergeArchive(per, { limit: 1 }).rows.length, 1);
  assert.equal(archiveRowOf('builder-a', null), null);
});

// --- route module ---------------------------------------------------------------------

function fakeRes() {
  return {
    status: null, headers: null, body: '',
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = String(b ?? ''); },
  };
}

async function mount({ answers, states = {}, services = {}, now = () => T0 } = {}) {
  const ids = Object.keys(answers);
  const store = createFleetStore({ builders: ids.map((id) => ({ id, url: `http://${id}.example.invalid` })) });
  for (const id of ids) store.setConn(id, { state: states[id] ?? 'up', lastSeen: T0 });
  const calls = [];
  const readProxy = {
    async get(id, p, opts) {
      calls.push({ id, p, timeoutMs: opts?.timeoutMs });
      const a = answers[id];
      return typeof a === 'function' ? a(p) : a;
    },
  };
  const routes = [];
  const ctx = createContext({ mode: 'hub', store, now, config: { stateDir: path.join(tmp, 'state'), timezone: 'UTC' } }, {
    route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
    upgradeHandlers: [],
  });
  ctx.provide('readProxy', readProxy);
  for (const [k, v] of Object.entries(services)) ctx.provide(k, v);
  const mod = createModule();
  await mod.register(ctx);
  ctx._phase('start');
  await mod.start(ctx);
  const call = async (url) => {
    const r = routes.find((x) => url.split('?')[0] === x.pattern);
    const res = fakeRes();
    await r.handler({ url, method: 'GET' }, res, {});
    return { status: res.status, body: JSON.parse(res.body) };
  };
  return { routes, calls, call, mod };
}

test('route: GET /api/fleet/morning merges builders and hub services, caches 15 s', async () => {
  assert.equal(defaultModule.name, 'hub-review');
  assert.deepEqual(defaultModule.modes, ['hub']);
  const audit = {
    read: ({ since }) => ({ entries: [{ id: 'e1', ts: T0 - H, action: 'approve', result: { phase: 'done', ok: true } }].filter((e) => e.ts >= since), more: false }),
  };
  const services = {
    reviewWaits: { stats: () => ({ n: 2, medianMs: 10 * MIN, p90Ms: 20 * MIN }), open: () => [{ fkey: 'builder-a/feat', waitingMs: 5 * MIN, readyAt: T0 - 5 * MIN }] },
    notify: { digest: ({ since }) => [{ id: 'd', kind: 'need', reason: 'quiet', at: since + 1, title: 't', body: 'b' }] },
    alarms: { live: () => [{ id: 'stuck:x', kind: 'stuck', builder: 'builder-a', target: 'a-1', text: 'stalled', since: T0 - MIN }] },
    audit,
  };
  const m = await mount({
    answers: {
      'builder-a': { status: 200, json: fixture().get('builder-a') },
      'builder-b': { status: 504, json: { ok: false, error: 'builder timeout' } },
    },
    services,
  });
  assert.deepEqual(m.routes.map((r) => `${r.method} ${r.pattern}`), [`GET ${MORNING_PATH}`, `GET ${ARCHIVE_PATH}`]);
  const r = await m.call('/api/fleet/morning?window=24h');
  assert.equal(r.status, 200);
  assert.equal(r.body.window, '24h');
  assert.equal(r.body.since, T0 - 24 * H);
  assert.deepEqual(r.body.missing, ['builder-b']);
  assert.equal(r.body.approvals.approved, 1);
  assert.equal(r.body.review.waiting, 1);
  assert.equal(r.body.deferred.length, 1);
  assert.deepEqual(r.body.stuck.map((s) => s.fkey), ['builder-a/a-1']);
  near(r.body.costByPackage.reduce((a, p) => a + p.usd, 0), r.body.totalUsd);
  assert.ok(m.calls.every((c) => c.timeoutMs === 3000));
  assert.deepEqual(m.calls.map((c) => c.p).sort(), ['/api/v1/morning?window=24h', '/api/v1/morning?window=24h']);
  await m.call('/api/fleet/morning?window=24h');
  assert.equal(m.calls.length, 2, 'served from the 15 s cache');
  assert.equal((await m.call('/api/fleet/morning?window=../x')).status, 400);
});

test('route: b=<id> returns that builder alone, fkeyed; bad and unknown ids refused', async () => {
  const m = await mount({ answers: { 'builder-a': { status: 200, json: fixture().get('builder-a') }, 'builder-b': { status: 200, json: built() } } });
  const r = await m.call('/api/fleet/morning?b=builder-a');
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 'builder-a');
  assert.equal(r.body.needsYou[0].name, 'builder-a/a-2');
  assert.deepEqual(m.calls.map((c) => c.id), ['builder-a']);
  assert.equal((await m.call('/api/fleet/morning?b=Bad!')).status, 400);
  assert.equal((await m.call('/api/fleet/morning?b=builder-z')).status, 404);
});

test('route: GET /api/fleet/archive fans out to builders not down and forwards the query', async () => {
  const m = await mount({
    answers: {
      'builder-a': { status: 200, json: { rows: [arow('a', T0 - H)] } },
      'builder-b': { status: 200, json: { rows: [arow('b', T0)] } },
      'builder-c': { status: 200, json: { rows: [arow('c', T0)] } },
    },
    states: { 'builder-c': 'down' },
  });
  const r = await m.call('/api/fleet/archive?q=a%26b&limit=10');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rows.map((x) => x.fkey), ['builder-b/b', 'builder-a/a']);
  assert.deepEqual(r.body.missing, ['builder-c']);
  assert.deepEqual([...new Set(m.calls.map((c) => c.p))], ['/api/v1/archive?q=a%26b&limit=10']);
  assert.ok(!m.calls.some((c) => c.id === 'builder-c'));
  for (const q of ['?limit=x', `?q=${'x'.repeat(201)}`, '?before=-1']) assert.equal((await m.call(`/api/fleet/archive${q}`)).status, 400, q);
});

test('auditSince pages the hub audit reader', () => {
  const pages = [
    { entries: [{ ts: T0, hash: 'h1' }], more: true },
    { entries: [{ ts: T0 + 1, hash: 'h2' }], more: false },
  ];
  let i = 0;
  const args = [];
  const out = auditSince({ read: (a) => { args.push(a); return pages[i++]; } }, T0 - H);
  assert.equal(out.length, 2);
  assert.deepEqual(args[1], { after: 'h1', limit: 1000 });
  assert.deepEqual(auditSince(null, 0), []);
});

test('hub morning modules do not import builder-only modules', () => {
  const server = path.resolve(new URL('../server/', import.meta.url).pathname);
  for (const f of ['server/hub/morning.mjs', 'server/hub/routes/review.mjs']) {
    const file = new URL(`../${f}`, import.meta.url).pathname;
    const src = fs.readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(specs.length > 0);
    for (const spec of specs) {
      if (!spec.startsWith('.')) { assert.ok(spec.startsWith('node:'), `${f} imports ${spec}`); continue; }
      const rel = path.relative(server, path.resolve(path.dirname(file), spec));
      assert.ok(!/^(push|config|db|state|log|morning|terminals)\.mjs$/.test(rel), `${f} imports ${rel}`);
      assert.ok(!/^(collector|routes|flags|lanes|control)\//.test(rel), `${f} imports ${rel}`);
    }
  }
});
