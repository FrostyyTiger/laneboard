// Review-wait metric on the hub (fleet §7 7.3.7, O10): ready/touch upserts are
// idempotent, a wait closes exactly once on the first touch (UI, GitHub review
// or send-review), stats are correct, a touch without a user is ignored, the
// kv store round-trips, and the route module serves GET /api/review-waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createReviewWaits, createJsonKv, startReviewWaitService, summarize, cleanState,
  KV_KEY, CLOSED_MAX, WINDOW_MS,
} from '../server/hub/reviewwait.mjs';
import defaultModule, { createModule, parseSince } from '../server/hub/routes/review-waits.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { createContext } from '../server/modules.mjs';

const T0 = Date.parse('2026-10-14T12:00:00Z');
const MIN = 60_000;
const H = 3600_000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-reviewwait-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function memKv() {
  const m = new Map();
  let writes = 0;
  return {
    kvRead: (k, f = null) => (m.has(k) ? JSON.parse(m.get(k)) : f),
    kvWrite: (k, v) => { writes++; m.set(k, JSON.stringify(v)); },
    writes: () => writes,
    raw: (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
  };
}

function clock(t = T0) {
  const c = () => c.t;
  c.t = t;
  return c;
}

const ready = (since, reasons = ['done-marker']) => ({ ready: true, reasons, since });
const lane = (id, over = {}) => ({ id, branch: id, sessions: [`${id}-s1`], reviewReady: null, reviewSentAt: null, ...over });

test('ready opens one wait; the same lanes again change nothing (idempotent)', () => {
  const db = memKv();
  const now = clock();
  const w = createReviewWaits({ db, now });
  const lanes = [lane('feat', { reviewReady: ready(T0 - 10 * MIN, ['pr-green', 'stop-diff']) }), lane('idle')];
  const prs = { feat: { number: 42, state: 'OPEN', firstReviewAt: null } };
  assert.equal(w.onLanes('builder-a', lanes, { prs }), true);
  assert.equal(w.onLanes('builder-a', lanes, { prs }), false);
  assert.equal(w.onLanes('builder-a', structuredClone(lanes), { prs }), false);
  assert.equal(db.writes(), 1, 'only the change is written');
  assert.deepEqual(w.open(), [{ fkey: 'builder-a/feat', waitingMs: 10 * MIN, readyAt: T0 - 10 * MIN }]);
  assert.deepEqual(db.raw(KV_KEY).open['builder-a/feat'], {
    builder: 'builder-a', lane: 'feat', prNumber: 42, readyAt: T0 - 10 * MIN, readySource: 'pr-green',
  });
  // A later `since` for the same open wait keeps the first ready time.
  w.onLanes('builder-a', [lane('feat', { reviewReady: ready(T0 - 2 * MIN) })], { prs });
  assert.equal(w.open()[0].readyAt, T0 - 10 * MIN);
});

test('touch closes exactly once; a touch without a user or with a bad how is ignored', () => {
  const db = memKv();
  const now = clock();
  const w = createReviewWaits({ db, now });
  w.onLanes('builder-a', [lane('feat', { reviewReady: ready(T0 - 30 * MIN) })]);
  now.t = T0 + 5 * MIN;
  assert.equal(w.touch('builder-a/feat', 'peek', null), false, 'no user');
  assert.equal(w.touch('builder-a/feat', 'peek', ''), false, 'empty user');
  assert.equal(w.touch('builder-a/feat', 'stare', 'alice@example.invalid'), false, 'unknown how');
  assert.equal(w.touch('not a key', 'peek', 'alice@example.invalid'), false);
  assert.equal(w.open().length, 1);
  // A session of the lane counts as the lane.
  assert.equal(w.laneOf('builder-a/feat-s1'), 'builder-a/feat');
  assert.equal(w.touch('builder-a/feat-s1', 'inspect', 'alice@example.invalid'), true);
  now.t = T0 + 9 * MIN;
  assert.equal(w.touch('builder-a/feat', 'term', 'alice@example.invalid'), false, 'already closed');
  assert.deepEqual(w.open(), []);
  assert.deepEqual(w.closed(), [{ fkey: 'builder-a/feat', readyAt: T0 - 30 * MIN, touchedAt: T0 + 5 * MIN, touchSource: 'inspect' }]);
  // The lane is still ready with the same since: that episode is measured, no reopen.
  assert.equal(w.onLanes('builder-a', [lane('feat', { reviewReady: ready(T0 - 30 * MIN) })]), false);
  assert.deepEqual(w.open(), []);
  // A new episode (ready after the touch) opens a new wait.
  assert.equal(w.onLanes('builder-a', [lane('feat', { reviewReady: ready(T0 + 8 * MIN) })]), true);
  assert.equal(w.open()[0].readyAt, T0 + 8 * MIN);
});

test('GitHub review and send-review count as the touch, only when after the ready time', () => {
  const now = clock();
  const w = createReviewWaits({ db: memKv(), now });
  const since = T0 - H;
  // An older review (earlier episode) does not close.
  w.onLanes('builder-a', [lane('a', { reviewReady: ready(since) })], { prs: { a: { number: 1, firstReviewAt: since - MIN } } });
  assert.equal(w.open().length, 1);
  w.onLanes('builder-a', [lane('a', { reviewReady: ready(since) })], { prs: { a: { number: 1, firstReviewAt: since + 20 * MIN } } });
  assert.deepEqual(w.closed().map((c) => [c.fkey, c.touchSource, c.touchedAt - c.readyAt]), [['builder-a/a', 'github', 20 * MIN]]);

  // send-review: the lane stops being ready (R5) but carries reviewSentAt.
  w.onLanes('builder-a', [lane('b', { reviewReady: ready(since) })]);
  w.onLanes('builder-a', [lane('b', { reviewSentAt: since + 7 * MIN })]);
  const b = w.closed().find((c) => c.fkey === 'builder-a/b');
  assert.equal(b.touchSource, 'send-review');
  assert.equal(b.touchedAt - b.readyAt, 7 * MIN);

  // The earlier of both wins; lane.pr is the fallback when box.prs has no entry.
  w.onLanes('builder-a', [lane('c', { reviewReady: ready(since) })]);
  w.onLanes('builder-a', [lane('c', { reviewReady: ready(since), reviewSentAt: since + 9 * MIN, pr: { number: 3, firstReviewAt: since + 4 * MIN } })]);
  const c = w.closed().find((x) => x.fkey === 'builder-a/c');
  assert.equal(c.touchSource, 'github');
  assert.equal(c.touchedAt, since + 4 * MIN);
});

test('a lane that stops being ready or disappears without a touch drops its wait', () => {
  const w = createReviewWaits({ db: memKv(), now: clock() });
  w.onLanes('builder-a', [lane('x', { reviewReady: ready(T0 - H) }), lane('y', { reviewReady: ready(T0 - H) })]);
  w.onLanes('builder-b', [lane('x', { reviewReady: ready(T0 - H) })]);
  assert.equal(w.open().length, 3);
  w.onLanes('builder-a', [lane('x')]); // x not ready, y gone
  assert.deepEqual(w.open().map((o) => o.fkey), ['builder-b/x'], 'other builders untouched');
  assert.deepEqual(w.closed(), [], 'dropped waits are not measured');
});

test('untrusted input: future since clamped, bad reasons/numbers dropped, bad ids ignored', () => {
  const db = memKv();
  const w = createReviewWaits({ db, now: clock() });
  assert.equal(w.onLanes('Bad Id!', [lane('x', { reviewReady: ready(T0) })]), false);
  assert.equal(w.onLanes('builder-a', 'nope'), false);
  w.onLanes('builder-a', [
    lane('f', { reviewReady: { ready: true, reasons: ['<script>'], since: T0 + 10 * H } }),
    lane('g', { reviewReady: { ready: true, reasons: [], since: 'yesterday' } }),
    null, 42, { id: 7 },
  ], { prs: { f: { number: -1 } } });
  assert.deepEqual(w.open(), [{ fkey: 'builder-a/f', waitingMs: 0, readyAt: T0 }]);
  assert.deepEqual(db.raw(KV_KEY).open['builder-a/f'], { builder: 'builder-a', lane: 'f', prNumber: null, readyAt: T0, readySource: null });
});

test('stats: n, median and p90 over waits touched in the window (last 7 d floor)', () => {
  assert.deepEqual(summarize([]), { n: 0, medianMs: null, p90Ms: null });
  assert.deepEqual(summarize([5]), { n: 1, medianMs: 5, p90Ms: 5 });
  assert.deepEqual(summarize([4, 1, 3, 2]), { n: 4, medianMs: 3, p90Ms: 4 }); // (2+3)/2 rounds to 3
  assert.deepEqual(summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]), { n: 10, medianMs: 55, p90Ms: 90 });

  const now = clock(T0 - 10 * 24 * H);
  const w = createReviewWaits({ db: memKv(), now });
  // One old wait (10 d ago), then five recent ones of 1..5 minutes.
  w.onLanes('builder-a', [lane('old', { reviewReady: ready(now.t - MIN) })]);
  w.touch('builder-a/old', 'peek', 'alice@example.invalid');
  now.t = T0 - 2 * H;
  for (let i = 1; i <= 5; i++) {
    w.onLanes('builder-a', [lane(`l${i}`, { reviewReady: ready(now.t) })]);
    now.t += i * MIN;
    assert.equal(w.touch(`builder-a/l${i}`, 'inspect', 'alice@example.invalid'), true);
  }
  now.t = T0;
  assert.deepEqual(w.stats(), { n: 5, medianMs: 3 * MIN, p90Ms: 5 * MIN });
  assert.deepEqual(w.stats({ since: 0 }), { n: 5, medianMs: 3 * MIN, p90Ms: 5 * MIN }, '7 d is the floor');
  assert.equal(w.stats({ since: T0 - 2 * H + 5 * MIN }).n, 3, 'touched after +5 min: l3 (+6), l4 (+10), l5 (+15)');
  assert.equal(w.closed({ since: T0 - WINDOW_MS }).length, 5);
});

test('closed keeps the last 500; a stored value reloads; bad stored data is dropped', () => {
  const db = memKv();
  const now = clock();
  const w = createReviewWaits({ db, now });
  for (let i = 0; i < CLOSED_MAX + 20; i++) {
    w.onLanes('builder-a', [lane(`l${i}`, { reviewReady: ready(now.t) })]);
    now.t += 1;
    w.touch(`builder-a/l${i}`, 'peek', 'alice@example.invalid');
  }
  w.onLanes('builder-a', [lane('pending', { reviewReady: ready(now.t - 5 * H) })]);
  assert.equal(db.raw(KV_KEY).closed.length, CLOSED_MAX);
  assert.equal(db.raw(KV_KEY).closed[0].fkey, 'builder-a/l20');

  const w2 = createReviewWaits({ db, now });
  assert.equal(w2.closed().length, CLOSED_MAX);
  assert.deepEqual(w2.open().map((o) => o.fkey), ['builder-a/pending']);
  // The session index is memory-only, but the lane key itself still closes it.
  assert.equal(w2.touch('builder-a/pending', 'term', 'bob@example.invalid'), true);

  const s = cleanState({ open: { 'x': { readyAt: 1 }, 'builder-a/ok': { readyAt: 1, readySource: 'evil', prNumber: 'n' }, 'builder-a/bad': { readyAt: 'z' } }, closed: [{ fkey: 'builder-a/c', readyAt: 1, touchedAt: 2, touchSource: 'peek' }, { fkey: 'q' }, null] });
  assert.deepEqual(Object.keys(s.open), ['builder-a/ok']);
  assert.equal(s.open['builder-a/ok'].readySource, null);
  assert.equal(s.closed.length, 1);
  const g = cleanState('garbage');
  assert.deepEqual([Object.keys(g.open), g.closed], [[], []]);
});

test('overdue: open waits older than review.overdueHours (default 4 h)', () => {
  const now = clock();
  const w = createReviewWaits({ db: memKv(), now, cfg: { review: { overdueHours: 4 } } });
  w.onLanes('builder-a', [lane('slow', { reviewReady: ready(T0 - 5 * H) }), lane('fast', { reviewReady: ready(T0 - H) })], { prs: { slow: { number: 9 } } });
  assert.equal(w.overdueMs, 4 * H);
  assert.deepEqual(w.overdue(), [{ fkey: 'builder-a/slow', waitingMs: 5 * H, readyAt: T0 - 5 * H, builder: 'builder-a', lane: 'slow', prNumber: 9, readySource: 'done-marker' }]);
  now.t = T0 + 3.5 * H;
  assert.deepEqual(w.overdue().map((o) => o.fkey), ['builder-a/slow', 'builder-a/fast']);
  assert.equal(createReviewWaits({ cfg: {} }).overdueMs, 4 * H);
  assert.equal(createReviewWaits({ cfg: { overdueHours: 1 } }).overdueMs, H);
});

test('json kv: atomic file per key, 0600, missing file reads the fallback', () => {
  const dir = path.join(tmp, 'kv');
  const kv = createJsonKv(dir);
  assert.equal(kv.kvRead(KV_KEY, 'fb'), 'fb');
  kv.kvWrite(KV_KEY, { open: {}, closed: [] });
  assert.deepEqual(kv.kvRead(KV_KEY), { open: {}, closed: [] });
  const f = path.join(dir, 'review.waits.json');
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dir), ['review.waits.json']);
});

/** A fleet store with builder-a and builder-b. */
function store() {
  const st = createFleetStore({ builders: [{ id: 'builder-a', url: 'http://127.0.0.1:1' }, { id: 'builder-b', url: 'http://127.0.0.1:2' }] });
  st.setConn('builder-a', { state: 'up', lastSeen: T0 });
  return st;
}

function fakeClientWs() {
  const handlers = new Map();
  return {
    onClientMessage(type, fn) {
      handlers.set(type, fn);
      return () => handlers.delete(type);
    },
    send(msg, meta) { handlers.get(msg.type)?.(msg, meta); },
    handlers,
  };
}

test('service: feeds lanes and box.prs from the store; touch counts only for direct users', () => {
  const st = store();
  st.applySnapshot('builder-a', { sessions: [{ name: 'feat-s1', state: 'done', lane: 'feat' }], lanes: [lane('feat', { reviewReady: ready(T0 - H) })], box: { prs: { feat: { number: 5 } } } }, T0);
  const now = clock();
  const w = createReviewWaits({ db: memKv(), now });
  const cws = fakeClientWs();
  const stop = startReviewWaitService({ waits: w, store: st, onClientMessage: cws.onClientMessage });
  assert.deepEqual(w.open().map((o) => o.fkey), ['builder-a/feat'], 'initial feed on start');

  // A lane delta with a GitHub review closes it.
  st.applySnapshot('builder-a', { sessions: [], lanes: [lane('other', { reviewReady: ready(T0 - 2 * H) })] }, T0);
  assert.deepEqual(w.open().map((o) => o.fkey), ['builder-a/other']);

  cws.send({ type: 'touch', fkey: 'builder-a/other', how: 'peek' }, { user: 'local', kind: 'local' });
  cws.send({ type: 'touch', fkey: 'builder-a/other', how: 'peek' }, { user: null, kind: 'direct' });
  assert.equal(w.open().length, 1, 'local and user-less touches are ignored');
  cws.send({ type: 'touch', fkey: 'builder-a/other-s1', how: 'term' }, { user: 'alice@example.invalid', kind: 'direct' });
  assert.deepEqual(w.open(), []);
  assert.equal(w.closed()[0].touchSource, 'term');

  st.applyDelta('builder-a', { lanes: [lane('third', { reviewReady: ready(T0 - MIN) })] }, T0);
  assert.deepEqual(w.open().map((o) => o.fkey), ['builder-a/third'], 'delta with lanes feeds');

  stop();
  assert.equal(cws.handlers.size, 0, 'stop unregisters the touch handler');
  st.applyDelta('builder-a', { lanes: [] }, T0);
  assert.equal(w.open().length, 1, 'stop unsubscribes from the store');
});

function fakeRes() {
  return {
    status: null, headers: null, body: '',
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = String(b ?? ''); },
  };
}

test('route module: provides reviewWaits, serves GET /api/review-waits, persists to the state dir', async () => {
  assert.equal(defaultModule.name, 'hub-review-waits');
  assert.deepEqual(defaultModule.modes, ['hub']);
  const st = store();
  st.applySnapshot('builder-a', { sessions: [], lanes: [lane('feat', { reviewReady: ready(T0 - 5 * H) })] }, T0);
  const routes = [];
  const cws = fakeClientWs();
  const stateDir = path.join(tmp, 'state');
  const ctx = createContext({ mode: 'hub', store: st, now: () => T0, onClientMessage: cws.onClientMessage, config: { stateDir, review: { overdueHours: 4 } } }, {
    route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
    upgradeHandlers: [],
  });
  const mod = createModule();
  await mod.register(ctx);
  assert.deepEqual(routes.map((r) => `${r.method} ${r.pattern}`), ['GET /api/review-waits']);
  assert.equal(ctx.has('reviewWaits'), true);
  ctx._phase('start');
  await mod.start(ctx);
  const waits = ctx.use('reviewWaits');
  assert.deepEqual(waits.overdue().map((o) => o.fkey), ['builder-a/feat']);

  let res = fakeRes();
  await routes[0].handler({ url: '/api/review-waits' }, res, {});
  assert.equal(res.status, 200);
  let body = JSON.parse(res.body);
  assert.deepEqual(body.open, [{ fkey: 'builder-a/feat', waitingMs: 5 * H }]);
  assert.deepEqual(body.stats, { n: 0, medianMs: null, p90Ms: null });
  assert.equal(body.overdueMs, 4 * H);

  cws.send({ type: 'touch', fkey: 'builder-a/feat', how: 'inspect' }, { user: 'alice@example.invalid', kind: 'direct' });
  res = fakeRes();
  await routes[0].handler({ url: `/api/review-waits?since=${T0 - H}` }, res, {});
  body = JSON.parse(res.body);
  assert.deepEqual(body.open, []);
  assert.deepEqual(body.stats, { n: 1, medianMs: 5 * H, p90Ms: 5 * H });
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'hub', 'review.waits.json'), 'utf8'));
  assert.equal(saved.closed[0].touchSource, 'inspect');
  mod.stop();
});

test('route module: uses ctx.db kv and the services hook when present', async () => {
  const db = memKv();
  const registered = [];
  const routes = [];
  const ctx = createContext({ mode: 'hub', db, services: { register: (s) => registered.push(s) } }, {
    route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
    upgradeHandlers: [],
  });
  const mod = createModule();
  await mod.register(ctx);
  await mod.start(ctx); // no-op: the hook owns the lifecycle
  assert.deepEqual(registered.map((s) => s.name), ['review-waits']);
  const st = store();
  st.applySnapshot('builder-a', { sessions: [], lanes: [lane('feat', { reviewReady: ready(T0 - H) })] }, T0);
  const cws = fakeClientWs();
  const stop = registered[0].start({ store: st, onClientMessage: cws.onClientMessage, now: () => T0 });
  assert.ok(db.raw(KV_KEY).open['builder-a/feat'], 'written to the injected kv');
  assert.equal(cws.handlers.has('touch'), true);
  stop();
  assert.equal(cws.handlers.has('touch'), false);
});

test('parseSince: ms or ISO, anything else is the default', () => {
  assert.equal(parseSince(String(T0)), T0);
  assert.equal(parseSince('2026-10-14T12:00:00Z'), T0);
  assert.equal(parseSince(''), undefined);
  assert.equal(parseSince('soon'), undefined);
  assert.equal(parseSince(undefined), undefined);
  assert.equal(parseSince('9'.repeat(41)), undefined);
});
