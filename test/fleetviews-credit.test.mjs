// Fleet O11: Credit fleet-wide. /api/v1/credit (builder), mergeCredit and
// /api/fleet/credit (hub, fan-out through the read proxy).
process.env.LANEBOARD_DB ??= ':memory:';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { mergeCredit, sanitizePart, withFkeys, accountSeries, MAX_LANES, MAX_USD } from '../server/hub/credit.mjs';
import creditModule, { createModule, createCreditService, PATH, UPSTREAM_PATH } from '../server/hub/routes/credit.mjs';
import { createReadProxy } from '../server/hub/read-proxy.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';

const NOW = Date.parse('2026-09-05T05:00:00Z');
const MIN = 60_000;
const H = 3600e3;

const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

// --- fixtures ------------------------------------------------------------------

function fixture({ id, five = [], seven = [], fiveRL, sevenRL, lanes = [], totals, rows = 10 }) {
  return {
    builder: id,
    now: NOW,
    charts: {
      sevenDay: { title: '7-day window', since: NOW - 7 * 24 * H, now: NOW, points: seven, resets: [NOW - 2 * H] },
      fiveHour: { title: '5-hour window', since: NOW - 24 * H, now: NOW, points: five, resets: [] },
    },
    lanes,
    totals: totals ?? { tonight: 1, day: 2, week: 3, allTime: 4 },
    rateLimits: { fiveHour: fiveRL ?? null, sevenDay: sevenRL ?? null },
    sampler: { rows, lastSampleAt: NOW - MIN, lastSampleAgeMs: MIN },
    label: 'API-equivalent',
  };
}

const lane = (name, usd, extra = {}) => ({
  lane: name, hue: 120, tonight: usd, day: usd * 2, week: usd * 3, allTime: usd * 4,
  tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, ...extra,
});

const A = fixture({
  id: 'builder-a',
  five: [{ t: NOW - 10 * MIN, v: 40 }, { t: NOW - 5 * MIN + 1000, v: 45 }],
  seven: [{ t: NOW - 10 * MIN, v: 8 }],
  fiveRL: { usedPct: 45, resetsAt: NOW + H },
  sevenRL: { usedPct: 8, resetsAt: NOW + 50 * H },
  lanes: [lane('web', 1.5), lane('api', 0.25)],
  totals: { tonight: 1.75, day: 3.5, week: 5.25, allTime: 7 },
});
const B = fixture({
  id: 'builder-b',
  five: [{ t: NOW - 10 * MIN + 20_000, v: 42 }, { t: NOW - 5 * MIN + 30_000, v: 44 }, { t: NOW - MIN, v: 47 }],
  seven: [{ t: NOW - 10 * MIN + 5000, v: 9 }],
  // B's statusline still shows the previous 5 h window (earlier resetsAt, higher %):
  // the latest window wins, its own max. Never summed.
  fiveRL: { usedPct: 97, resetsAt: NOW - H },
  sevenRL: { usedPct: 9, resetsAt: NOW + 50 * H },
  lanes: [lane('web', 2)],
  totals: { tonight: 2, day: 4, week: 6, allTime: 8 },
});

// --- the merge (plan done-when) ----------------------------------------------

test('merging 2 fixture builders: fkeys, summed totals, account series = per-minute max', () => {
  const out = mergeCredit([
    { builder: 'builder-a', account: 'default', data: A },
    { builder: 'builder-b', account: 'default', data: B },
  ], { now: NOW });

  // fkeys and builder on every cost row
  const keys = out.lanes.map((l) => l.lane).sort();
  assert.deepEqual(keys, ['builder-a/api', 'builder-a/web', 'builder-b/web']);
  for (const l of out.lanes) assert.equal(l.lane.startsWith(`${l.builder}/`), true);
  assert.equal(out.lanes.find((l) => l.lane === 'builder-b/web').localLane, 'web');

  // totals summed, per builder kept
  assert.deepEqual(out.totals, { tonight: 3.75, day: 7.5, week: 11.25, allTime: 15 });
  assert.deepEqual(out.totalsByBuilder['builder-a'], A.totals);
  assert.deepEqual(out.totalsByBuilder['builder-b'], B.totals);

  // charts per builder
  assert.deepEqual(Object.keys(out.charts.byBuilder).sort(), ['builder-a', 'builder-b']);
  assert.equal(out.charts.byBuilder['builder-b'].fiveHour.points.length, 3);

  // account series: aligned to the minute, max per minute
  const acc = out.charts.accounts.default;
  assert.deepEqual(acc.builders, ['builder-a', 'builder-b']);
  assert.deepEqual(acc.fiveHour.points, [
    { t: NOW - 10 * MIN, v: 42 },
    { t: NOW - 5 * MIN, v: 45 },
    { t: NOW - MIN, v: 47 },
  ]);
  assert.deepEqual(acc.sevenDay.points, [{ t: NOW - 10 * MIN, v: 9 }]);
  assert.deepEqual(acc.sevenDay.resets, [NOW - 2 * H]);
  for (const p of acc.fiveHour.points) assert.equal(p.v, Math.max(...[...A.charts.fiveHour.points, ...B.charts.fiveHour.points].filter((q) => Math.floor(q.t / MIN) * MIN === p.t).map((q) => q.v)));
  // the top-level series are the account's (the existing chart code reads them)
  assert.deepEqual(out.charts.fiveHour, acc.fiveHour);
  assert.equal(out.charts.account, 'default');

  // gauge: latest resetsAt window, then max usedPct; never summed
  assert.deepEqual(out.rateLimits.fiveHour, { usedPct: 45, resetsAt: NOW + H, builder: 'builder-a' });
  assert.deepEqual(out.rateLimits.sevenDay, { usedPct: 9, resetsAt: NOW + 50 * H, builder: 'builder-b' });

  assert.deepEqual(out.missing, []);
  assert.equal(out.partial, false);
  assert.equal(out.sampler.rows, 20);
  assert.equal(out.label, 'API-equivalent');
});

test('accounts are merged separately; the worst account leads', () => {
  const out = mergeCredit([
    { builder: 'builder-a', account: 'acme-1', data: A },
    { builder: 'builder-b', account: 'acme-2', data: fixture({ id: 'builder-b', fiveRL: { usedPct: 80, resetsAt: NOW + H }, five: [{ t: NOW, v: 80 }] }) },
  ], { now: NOW });
  assert.deepEqual(Object.keys(out.rateLimits.accounts).sort(), ['acme-1', 'acme-2']);
  assert.equal(out.rateLimits.accounts['acme-1'].fiveHour.usedPct, 45);
  assert.equal(out.rateLimits.account, 'acme-2');
  assert.equal(out.rateLimits.fiveHour.usedPct, 80);
  assert.deepEqual(out.charts.fiveHour.points, [{ t: NOW, v: 80 }]);
  assert.equal(out.charts.accounts['acme-1'].fiveHour.points.length, 2);
});

test('missing and stale builders are marked, not fatal', () => {
  const out = mergeCredit([
    { builder: 'builder-a', data: A },
    { builder: 'builder-b', data: B, stale: true, ageMs: 20_000, error: 'builder timeout' },
    { builder: 'builder-c', data: null, stale: true, error: 'builder down' },
    { builder: 'not valid!', data: A },
    { builder: 'builder-a', data: B }, // duplicate id ignored
  ], { now: NOW });
  assert.deepEqual(out.missing, ['builder-c']);
  assert.deepEqual(out.stale, ['builder-b']);
  assert.equal(out.partial, true);
  assert.deepEqual(out.builders.map((b) => [b.id, b.ok, b.stale]), [
    ['builder-a', true, false], ['builder-b', false, true], ['builder-c', false, true],
  ]);
  assert.equal(out.builders[1].error, 'builder timeout');
  assert.equal(out.totals.allTime, 15); // stale last-good data still counts
});

test('an empty fleet merges to an empty, well-formed view', () => {
  const out = mergeCredit([], { now: NOW });
  assert.deepEqual(out.lanes, []);
  assert.deepEqual(out.totals, { tonight: 0, day: 0, week: 0, allTime: 0 });
  assert.deepEqual(out.charts.fiveHour.points, []);
  assert.equal(out.rateLimits.fiveHour, null);
});

// --- untrusted input -------------------------------------------------------------

test('builder numbers are clamped and unknown fields dropped', () => {
  const raw = JSON.parse(JSON.stringify(fixture({
    id: 'builder-a',
    five: [{ t: NOW, v: 150 }, { t: NOW + 1, v: -5 }, { t: 'x', v: 3 }, { t: NOW + 2, v: null }, { t: 1e20, v: 1 }],
    fiveRL: { usedPct: 1e9, resetsAt: NOW },
    sevenRL: { usedPct: 5, resetsAt: -1 },
    lanes: [
      lane('x'.repeat(5000), -3, { allTime: Infinity, hue: '<b>', extra: 'drop' }),
      { lane: 7, tonight: 1e30, day: 'NaN', week: null, allTime: null, tokens: { input: -1, output: 1e99 } },
      'junk',
    ],
    totals: { tonight: -1, day: 1e30, week: 'a', allTime: 2 },
  })));
  raw.evil = '<script>';
  raw.__proto__ = { polluted: true };
  raw.sampler = { rows: -4, lastSampleAt: 'soon' };
  const p = sanitizePart(raw);
  assert.deepEqual(p.charts.fiveHour.points, [{ t: NOW, v: 100 }, { t: NOW + 1, v: 0 }]);
  assert.deepEqual(p.rateLimits, { fiveHour: { usedPct: 100, resetsAt: NOW }, sevenDay: null });
  assert.equal(p.lanes.length, 2);
  assert.equal(p.lanes[0].lane.length, 200);
  assert.equal(p.lanes[0].tonight, 0);
  assert.equal(p.lanes[0].allTime, null); // Infinity is not a number we keep
  assert.equal(p.lanes[0].hue, '<b>'); // a capped string; the view escapes it
  assert.equal('extra' in p.lanes[0], false);
  assert.equal(p.lanes[1].lane, null);
  assert.equal(p.lanes[1].tonight, MAX_USD);
  assert.equal(p.lanes[1].day, 0);
  assert.equal(p.lanes[1].allTime, null); // the builder's "unknown" stays null
  assert.deepEqual(p.lanes[1].tokens, { input: 0, output: 1e15, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(p.totals, { tonight: 0, day: MAX_USD, week: 0, allTime: 2 });
  assert.deepEqual(p.sampler, { rows: 0, lastSampleAt: null, lastSampleAgeMs: null });
  assert.equal('evil' in p, false);
  assert.equal({}.polluted, undefined);
  assert.equal(sanitizePart('nope'), null);
  assert.equal(sanitizePart([1, 2]), null);
});

test('lists from a builder are capped before they are walked', () => {
  const lanes = Array.from({ length: MAX_LANES + 50 }, (_, i) => lane(`l${i}`, 1));
  const p = sanitizePart(fixture({ id: 'builder-a', lanes }));
  assert.equal(p.lanes.length, MAX_LANES);
  const series = accountSeries([sanitizePart(fixture({ id: 'builder-a', five: Array.from({ length: 900 }, (_, i) => ({ t: NOW - i * MIN, v: i % 100 })) })).charts.fiveHour], 'fiveHour');
  assert.ok(series.points.length <= 240 && series.points.length > 200, String(series.points.length));
});

test('withFkeys: one builder unmerged except for the fleet keys', () => {
  const out = withFkeys(A, 'builder-a');
  assert.equal(out.builder, 'builder-a');
  assert.deepEqual(out.lanes.map((l) => l.lane), ['builder-a/web', 'builder-a/api']);
  assert.deepEqual(out.charts.fiveHour.points, A.charts.fiveHour.points);
  assert.deepEqual(out.totals, A.totals);
});

// --- builder: credit.build echo and GET /api/v1/credit ---------------------------

test('credit.build echoes an optional builder and is otherwise unchanged', async () => {
  const { build } = await import('../server/credit.mjs');
  const snapshot = { sessions: [], lanes: [], attention: [] };
  const plain = build({ now: NOW, snapshot });
  assert.equal('builder' in plain, false);
  const tagged = build({ now: NOW, snapshot, builder: 'builder-a' });
  assert.equal(tagged.builder, 'builder-a');
  const { builder, ...rest } = tagged;
  assert.deepEqual(rest.totals, plain.totals);
  assert.deepEqual(Object.keys(rest), Object.keys(plain));
});

test('GET /api/v1/credit: a read with capability `credit`, tagged with the builder id, memoized 15 s', async () => {
  const v1 = await import('../server/routes/v1-credit.mjs');
  const { capabilityList } = await import('../server/fleet/api-v1.mjs');
  let t = NOW;
  let calls = 0;
  const mod = v1.createModule({
    build: ({ now, builder }) => { calls++; return { now, builder, totals: { tonight: calls } }; },
    now: () => t,
  });
  const routes = [];
  const sent = [];
  mod.register({
    config: { fleet: { id: 'builder-a' } },
    route: (m, p, h) => routes.push({ m, p, h }),
    json: (res, body, status = 200) => sent.push({ body, status }),
  });
  assert.deepEqual(routes.map((r) => [r.m, r.p]), [['GET', '/api/v1/credit']]);
  assert.equal(capabilityList().includes('credit'), true);
  assert.deepEqual(mod.modes, ['builder']);
  routes[0].h({ url: '/api/v1/credit' }, {});
  t += 10_000;
  routes[0].h({ url: '/api/v1/credit' }, {});
  t += 6_000;
  routes[0].h({ url: '/api/v1/credit' }, {});
  assert.equal(calls, 2);
  assert.equal(sent[0].body.builder, 'builder-a');
  assert.equal(sent[1].body, sent[0].body);
  assert.equal(sent[2].body.totals.tonight, 2);
  assert.equal(v1.builderId({ fleet: {} }), null);
});

// --- hub: the fan-out service --------------------------------------------------

function fakeGet(table) {
  const calls = [];
  const get = async (id, p, opts) => {
    calls.push({ id, p, opts });
    const r = table[id];
    return typeof r === 'function' ? r() : r;
  };
  return { get, calls };
}

const list = (...ids) => () => ids.map((id) => ({ id, code: null, account: 'default' }));

test('service: fans out with a 3 s timeout, merges, caches 15 s', async () => {
  let t = NOW;
  const { get, calls } = fakeGet({
    'builder-a': { status: 200, json: A },
    'builder-b': { status: 200, json: B },
  });
  const svc = createCreditService({ get, builders: list('builder-a', 'builder-b'), now: () => t });
  const out = await svc.fleet();
  assert.deepEqual(calls.map((c) => [c.id, c.p, c.opts.timeoutMs]), [
    ['builder-a', UPSTREAM_PATH, 3000], ['builder-b', UPSTREAM_PATH, 3000],
  ]);
  assert.equal(UPSTREAM_PATH, '/api/v1/credit');
  assert.equal(out.totals.allTime, 15);
  t += 5000;
  assert.equal(await svc.fleet(), out);
  assert.equal(calls.length, 2);
  t += 11_000;
  await svc.fleet();
  assert.equal(calls.length, 4);
});

test('service: a down builder is missing, a failing one keeps its last good answer marked stale', async () => {
  let t = NOW;
  let bOk = true;
  const { get } = fakeGet({
    'builder-a': { status: 200, json: A },
    'builder-b': () => (bOk ? { status: 200, json: B } : { status: 504, json: { ok: false, error: 'builder timeout' } }),
    'builder-c': { status: 503, json: { ok: false, error: 'builder down', state: 'down' } },
  });
  const svc = createCreditService({ get, builders: list('builder-a', 'builder-b', 'builder-c'), now: () => t });
  let out = await svc.fleet();
  assert.deepEqual(out.missing, ['builder-c']);
  assert.equal(out.builders.find((b) => b.id === 'builder-c').error, 'builder down');
  bOk = false;
  t += 20_000;
  out = await svc.fleet();
  const b = out.builders.find((x) => x.id === 'builder-b');
  assert.equal(b.stale, true);
  assert.equal(b.ageMs, 20_000);
  assert.equal(b.error, 'builder timeout');
  assert.deepEqual(out.stale, ['builder-b']);
  assert.equal(out.totals.allTime, 15);
  assert.equal(out.lanes.some((l) => l.lane === 'builder-b/web'), true);
});

test('service: a get that throws or returns non-JSON garbage does not fail the merge', async () => {
  const svc = createCreditService({
    get: async (id) => { if (id === 'builder-b') throw new Error('boom'); return { status: 200, json: 'garbage' }; },
    builders: list('builder-a', 'builder-b'),
  });
  const out = await svc.fleet();
  assert.deepEqual(out.missing, ['builder-a', 'builder-b']);
});

test('service.one: unmerged with fkeys; unknown 404; never answered 503', async () => {
  const { get } = fakeGet({
    'builder-a': { status: 200, json: A },
    'builder-b': { status: 503, json: { ok: false, error: 'builder down' } },
  });
  const svc = createCreditService({ get, builders: list('builder-a', 'builder-b') });
  const a = await svc.one('builder-a');
  assert.equal(a.status, 200);
  assert.equal(a.body.builder, 'builder-a');
  assert.equal(a.body.stale, false);
  assert.deepEqual(a.body.lanes.map((l) => l.lane), ['builder-a/web', 'builder-a/api']);
  assert.equal('byBuilder' in a.body.charts, false);
  assert.equal((await svc.one('builder-b')).status, 503);
  assert.equal((await svc.one('builder-z')).status, 404);
});

// --- hub: the route module -----------------------------------------------------

function routeHarness(opts) {
  const mod = createModule(opts);
  const routes = new Map();
  mod.register({
    route: (m, p, h) => routes.set(`${m} ${p}`, h),
    json: (res, body, status = 200) => { res.status = status; res.body = body; },
  });
  const call = async (url) => { const res = {}; await routes.get(`GET ${PATH}`)({ url }, res); return res; };
  return { mod, routes, call };
}

test('route GET /api/fleet/credit: merged, ?b=, bad ids, not ready', async () => {
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'http://127.0.0.1:1' }, { id: 'builder-b', url: 'http://127.0.0.1:1', account: 'acme' }] });
  const { get } = fakeGet({ 'builder-a': { status: 200, json: A }, 'builder-b': { status: 200, json: B } });
  const { mod, routes, call } = routeHarness({ readProxy: { get }, store });
  assert.deepEqual([...routes.keys()], ['GET /api/fleet/credit']);
  assert.deepEqual(mod.modes, ['hub']);
  let r = await call('/api/fleet/credit');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.charts.accounts).sort(), ['acme', 'default']);
  r = await call('/api/fleet/credit?b=builder-b');
  assert.equal(r.status, 200);
  assert.equal(r.body.account, 'acme');
  assert.deepEqual(r.body.lanes.map((l) => l.lane), ['builder-b/web']);
  assert.equal((await call('/api/fleet/credit?b=../x')).status, 404);
  assert.equal((await call('/api/fleet/credit?b=builder-q')).status, 404);

  const none = routeHarness({});
  assert.equal((await none.call('/api/fleet/credit')).status, 503);
  assert.equal(creditModule.name, 'hub-credit');
});

test('route module finds readProxy and store through ctx.use and the services hook', async () => {
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'http://127.0.0.1:1' }] });
  const { get } = fakeGet({ 'builder-a': { status: 200, json: A } });
  // ctx.use
  const m1 = createModule();
  const routes1 = new Map();
  const services = new Map([['readProxy', { get }], ['store', store]]);
  m1.register({
    route: (m, p, h) => routes1.set(p, h), json: (res, body, status = 200) => Object.assign(res, { body, status }),
    has: (n) => services.has(n), use: (n) => services.get(n),
  });
  const res1 = {};
  await routes1.get(PATH)({ url: PATH }, res1);
  assert.equal(res1.status, 200);
  assert.equal(res1.body.totals.allTime, 7);
  // services hook start ctx
  const m2 = createModule();
  const routes2 = new Map();
  const registered = [];
  m2.register({
    route: (m, p, h) => routes2.set(p, h), json: (res, body, status = 200) => Object.assign(res, { body, status }),
    services: { register: (s) => registered.push(s) },
  });
  const res2a = {};
  await routes2.get(PATH)({ url: PATH }, res2a);
  assert.equal(res2a.status, 503);
  assert.equal(registered[0].name, 'credit');
  registered[0].start({ readProxy: { get }, store });
  const res2b = {};
  await routes2.get(PATH)({ url: PATH }, res2b);
  assert.equal(res2b.status, 200);
});

// --- end to end through the real read proxy ------------------------------------

async function rawBuilder(handler) {
  const reqs = [];
  const srv = http.createServer((req, res) => { reqs.push({ url: req.url, headers: { ...req.headers } }); handler(req, res); });
  const sockets = new Set();
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(() => r()); }));
  return { url: `http://127.0.0.1:${srv.address().port}`, reqs };
}

const sendJson = (res, body) => { const b = JSON.stringify(body); res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };

test('e2e: signed fan-out through the read proxy; slow and garbage builders are stale/missing, not fatal', async () => {
  const good = await rawBuilder((req, res) => sendJson(res, A));
  const slow = await rawBuilder(() => { /* never answers */ });
  const bad = await rawBuilder((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>'); });
  const store = createFleetStore({ builders: [
    { id: 'builder-a', url: good.url }, { id: 'builder-b', url: slow.url }, { id: 'builder-c', url: bad.url }, { id: 'builder-d', url: good.url },
  ] });
  for (const id of ['builder-a', 'builder-b', 'builder-c']) store.setConn(id, { state: 'up', lastSeen: Date.now() });
  store.setConn('builder-d', { state: 'down', lastSeen: Date.now() - 600_000 });
  const key = crypto.generateKeyPairSync('ed25519').privateKey;
  const proxy = createReadProxy({ store, key });
  const svc = createCreditService({ get: proxy.get, builders: () => store.list(), timeoutMs: 300 });
  const t0 = Date.now();
  const out = await svc.fleet();
  assert.ok(Date.now() - t0 < 2500, 'a slow builder is bounded by the timeout');
  assert.deepEqual(out.missing.sort(), ['builder-b', 'builder-c', 'builder-d']);
  assert.equal(out.builders.find((b) => b.id === 'builder-b').error, 'builder timeout');
  assert.equal(out.totals.allTime, 7);
  assert.deepEqual(out.lanes.map((l) => l.lane).sort(), ['builder-a/api', 'builder-a/web']);
  // the builder saw a signed GET of exactly /api/v1/credit
  assert.equal(good.reqs.length, 1);
  assert.equal(good.reqs[0].url, '/api/v1/credit');
  for (const h of ['x-laneboard-ts', 'x-laneboard-nonce', 'x-laneboard-sig']) assert.ok(good.reqs[0].headers[h], h);
});

// --- module boundaries ---------------------------------------------------------

test('hub modules import only hub and fleet modules', () => {
  const root = path.join(import.meta.dirname, '..', 'server', 'hub');
  for (const f of ['credit.mjs', 'routes/credit.mjs']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const s of specs) {
      if (s.startsWith('node:')) continue;
      const abs = path.resolve(path.dirname(path.join(root, f)), s);
      const rel = path.relative(path.join(root, '..'), abs);
      assert.ok(rel.startsWith('hub/') || rel.startsWith('fleet/'), `${f} imports ${s}`);
    }
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML/);
  }
});
