// Hub notifications (fleet §7.3.6, O9): rules, quiet hours, digest, prefs.
// Fake clock and fake sender throughout; nothing is sent over the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  shouldNotify, effectivePrefs, checkPrefs, wirePrefs, inQuiet, localMinutes, buildPayload,
  createNotifier, createWebPushSender, COALESCE_MS, RATE_MAX, RATE_WINDOW_MS, DEFERRED_MAX,
  KV_DEFERRED, KV_PREFS, TITLE_MAX, BODY_MAX,
} from '../server/hub/notify.mjs';
import { createModule } from '../server/hub/routes/notify.mjs';
import { createAlarmStore, createMemoryKv } from '../server/fleet/alarms-store.mjs';
import { alarmId } from '../server/fleet/alarms.mjs';
import { defaults as obsDefaults } from '../server/config/observability.mjs';

const BID = 'builder-a';
// 2026-01-15 12:00 UTC: 13:00 in Europe/Berlin (CET, +1).
const NOON = Date.UTC(2026, 0, 15, 12, 0);
const BERLIN = 'Europe/Berlin';
const QUIET = { from: '23:00', to: '07:30' };

function alarm(kind, target = 'web', over = {}) {
  return {
    id: alarmId(kind, BID, target), kind, priority: 'P2', builder: BID, target,
    text: `${kind} text`, since: NOON, acked: false, ackedBy: null, ackedAt: null, cleared: null, ...over,
  };
}

function setup({ notify = {}, timezone = BERLIN, start = NOON, db = createMemoryKv() } = {}) {
  let t = start;
  const sent = [];
  const config = { timezone, notify: { ...obsDefaults().notify, ...notify } };
  const n = createNotifier({
    db,
    now: () => t,
    cfg: () => config,
    sender: async (p) => { sent.push(p); return { sent: 1, subscribers: 1 }; },
  });
  return { n, sent, db, config, at: (ms) => { t = ms; }, tick: (ms) => { t += ms; }, now: () => t };
}

// --- pure rules ------------------------------------------------------------------

test('shouldNotify: default kinds on, others off, unknown kinds refused', () => {
  const p = effectivePrefs(obsDefaults().notify, null);
  for (const k of ['needs-input', 'approval', 'failed', 'review', 'stuck', 'builder-down', 'danger']) {
    assert.equal(shouldNotify(alarm(k), p, null, NOON, 'UTC').notify, true, k);
  }
  for (const k of ['health-warn', 'conflict', 'budget-warn', 'reboot']) {
    assert.deepEqual(shouldNotify(alarm(k), p, null, NOON, 'UTC'), { notify: false, reason: 'kind off', defer: false });
  }
  assert.equal(shouldNotify(alarm('bogus'), p, null, NOON, 'UTC').reason, 'unknown kind');
  assert.equal(shouldNotify(null, p, null, NOON, 'UTC').notify, false);
});

test('shouldNotify: per-kind toggle off (config and stored prefs)', () => {
  const p1 = effectivePrefs({ ...obsDefaults().notify, kinds: { ...obsDefaults().notify.kinds, review: false } }, null);
  assert.equal(shouldNotify(alarm('review'), p1, null, NOON, 'UTC').reason, 'kind off');
  const p2 = effectivePrefs(obsDefaults().notify, { kinds: { stuck: false, conflict: true } });
  assert.equal(shouldNotify(alarm('stuck'), p2, null, NOON, 'UTC').reason, 'kind off');
  assert.equal(shouldNotify(alarm('conflict'), p2, null, NOON, 'UTC').notify, true);
});

test('shouldNotify: a muted target is not pushed', () => {
  const p = effectivePrefs(obsDefaults().notify, { mutedTargets: [`${BID}/web`] });
  assert.equal(shouldNotify(alarm('needs-input', 'web'), p, null, NOON, 'UTC').reason, 'muted');
  assert.equal(shouldNotify(alarm('needs-input', 'api'), p, null, NOON, 'UTC').notify, true);
});

test('quiet window across midnight in the configured time zone', () => {
  // 22:30 UTC = 23:30 Berlin (quiet); 06:00 UTC = 07:00 Berlin (quiet);
  // 06:45 UTC = 07:45 Berlin (not); 22:30 UTC in UTC itself is not quiet.
  const at = (h, m) => Date.UTC(2026, 0, 15, h, m);
  assert.equal(localMinutes(at(22, 30), BERLIN), 23 * 60 + 30);
  assert.equal(inQuiet(QUIET, at(22, 30), BERLIN), true);
  assert.equal(inQuiet(QUIET, at(6, 0), BERLIN), true);
  assert.equal(inQuiet(QUIET, at(6, 29), BERLIN), true, '07:29 local');
  assert.equal(inQuiet(QUIET, at(6, 30), BERLIN), false, '07:30 local: to is exclusive');
  assert.equal(inQuiet(QUIET, at(6, 45), BERLIN), false);
  assert.equal(inQuiet(QUIET, at(12, 0), BERLIN), false);
  assert.equal(inQuiet(QUIET, at(21, 59), BERLIN), false, '22:59 local');
  assert.equal(inQuiet(QUIET, at(22, 30), 'UTC'), false);
  // Summer time: 21:30 UTC in July = 23:30 Berlin (CEST, +2).
  assert.equal(inQuiet(QUIET, Date.UTC(2026, 6, 15, 21, 30), BERLIN), true);
  // A same-day window, null and garbage.
  assert.equal(inQuiet({ from: '12:00', to: '14:00' }, at(12, 30), 'UTC'), true);
  assert.equal(inQuiet({ from: '12:00', to: '14:00' }, at(14, 0), 'UTC'), false);
  assert.equal(inQuiet(null, at(22, 30), BERLIN), false);
  assert.equal(inQuiet({ from: '25:00', to: '07:00' }, at(22, 30), BERLIN), false);
  // A bad time zone falls back to UTC instead of throwing.
  assert.equal(inQuiet(QUIET, at(23, 30), 'Not/AZone'), true);
});

test('shouldNotify: quiet raise is deferred, bypass kinds are sent', () => {
  const p = effectivePrefs({ ...obsDefaults().notify, quietHours: QUIET }, null);
  const night = Date.UTC(2026, 0, 15, 23, 0); // 00:00 Berlin
  assert.deepEqual(shouldNotify(alarm('needs-input'), p, null, night, BERLIN), { notify: false, reason: 'quiet', defer: true });
  assert.deepEqual(shouldNotify(alarm('danger'), p, null, night, BERLIN), { notify: true, reason: 'bypass', defer: false });
  assert.equal(shouldNotify(alarm('builder-down', null), p, null, night, BERLIN).notify, true);
  // A kind that is off stays off at night too (not deferred).
  assert.equal(shouldNotify(alarm('conflict'), p, null, night, BERLIN).defer, false);
});

test('shouldNotify: coalescing within 60 s, bypass kinds never coalesced', () => {
  const p = effectivePrefs(obsDefaults().notify, null);
  assert.equal(shouldNotify(alarm('approval'), p, NOON - 10_000, NOON, 'UTC').reason, 'coalesced');
  assert.equal(shouldNotify(alarm('approval'), p, NOON - COALESCE_MS, NOON, 'UTC').notify, true);
  assert.equal(shouldNotify(alarm('danger'), p, NOON - 10_000, NOON, 'UTC').notify, true);
});

// --- payload (S20) ---------------------------------------------------------------

test('payload: code, kind and name; tag from the alarm id; encoded deep link', () => {
  const p = buildPayload(alarm('needs-input', 'web'));
  assert.deepEqual(p, { title: 'BA needs-input: web', body: 'needs-input text', tag: `lb-${alarmId('needs-input', BID, 'web')}`, url: '#/inbox?sel=builder-a%2Fweb' });
  assert.equal(buildPayload(alarm('needs-input', 'web'), () => 'XY').title, 'XY needs-input: web');
  assert.equal(buildPayload(alarm('builder-down', null, { text: 'builder builder-a is down' })).url, '#/inbox');
  assert.equal(buildPayload(alarm('builder-down', null)).title, 'BA builder-down: builder-a');
  assert.equal(buildPayload({ kind: 'ci-red-main', builder: null, target: 'acme', id: 'x', text: '' }).title, 'ci-red-main: acme');
});

test('payload: a 500-char session name gives a capped title and body (S20)', () => {
  const long = 'n'.repeat(500);
  const p = buildPayload(alarm('needs-input', long, { text: 't'.repeat(500) }));
  assert.ok(p.title.length <= TITLE_MAX, `title ${p.title.length}`);
  assert.ok(p.body.length <= BODY_MAX, `body ${p.body.length}`);
  assert.ok(p.title.startsWith('BA needs-input: nnn'));
  assert.ok(p.url.length < 600);
  assert.equal(decodeURIComponent(p.url.slice('#/inbox?sel='.length)), `${BID}/${long}`);
});

test('payload: a name with / ? # and control chars stays one encoded component (S20)', () => {
  const name = 'evil/x?sel=other#/settings\u0007‮';
  const p = buildPayload(alarm('approval', name, { text: 'line1\nline2\u0000' }));
  const q = p.url.slice('#/inbox?sel='.length);
  assert.ok(p.url.startsWith('#/inbox?sel='));
  assert.ok(!/[/?#&=]/.test(q), q);
  assert.equal(decodeURIComponent(q), `${BID}/${name}`);
  assert.ok(!/[\u0000-\u001f‮]/.test(p.title), JSON.stringify(p.title));
  assert.equal(p.body, 'line1 line2');
  // <img> text is carried as text, never interpreted.
  assert.equal(buildPayload(alarm('approval', 'w', { text: '<img src=x onerror=1>' })).body, '<img src=x onerror=1>');
});

// --- service ---------------------------------------------------------------------

test('onRaised: only raises notify (re-derivation and acks do not)', async () => {
  const s = setup();
  const kv = createMemoryKv();
  const store = createAlarmStore({ db: kv, now: s.now });
  const a = alarm('needs-input');
  let r = store.apply([a]);
  assert.equal(r.raised.length, 1);
  await s.n.onRaised(r.raised);
  assert.equal(s.sent.length, 1);
  s.tick(5 * 60_000);
  r = store.apply([{ ...a, text: 'changed text' }]); // re-derived, live: not a raise
  assert.equal(r.raised.length, 0);
  await s.n.onRaised(r.raised);
  store.ack(a.id, 'alice@example.invalid');
  r = store.apply([a]);
  await s.n.onRaised(r.raised);
  assert.equal(s.sent.length, 1);
  // Cleared and raised again: a new instance, pushed again.
  store.apply([]);
  r = store.apply([a]);
  assert.equal(r.raised.length, 1);
  await s.n.onRaised(r.raised);
  assert.equal(s.sent.length, 2);
  assert.deepEqual(await s.n.onRaised([]), []);
  assert.deepEqual(await s.n.onRaised(undefined), []);
});

test('onRaised: coalescing within 60 s per builder/target', async () => {
  const s = setup();
  await s.n.onRaised([alarm('approval', 'web')]);
  s.tick(30_000);
  const r = await s.n.onRaised([alarm('needs-input', 'web'), alarm('needs-input', 'api')]);
  assert.deepEqual(r.map((x) => x.reason), ['coalesced', 'ok']);
  assert.equal(s.sent.length, 2);
  s.tick(31_000);
  await s.n.onRaised([alarm('needs-input', 'web')]);
  assert.equal(s.sent.length, 3);
  // Same target twice in one batch: the second one is coalesced.
  s.tick(120_000);
  const r2 = await s.n.onRaised([alarm('approval', 'db'), alarm('failed', 'db')]);
  assert.deepEqual(r2.map((x) => x.reason), ['ok', 'coalesced']);
  assert.equal(s.n.counters().coalesced, 2);
});

test('quiet hours: a raise is deferred into the digest; bypass kinds are sent', async () => {
  const night = Date.UTC(2026, 0, 15, 23, 0); // 00:00 Berlin
  const s = setup({ notify: { quietHours: QUIET }, start: night });
  const r = await s.n.onRaised([alarm('needs-input', 'web'), alarm('danger', 'web'), alarm('builder-down', null)]);
  assert.deepEqual(r.map((x) => [x.reason, x.defer]), [['quiet', true], ['bypass', false], ['bypass', false]]);
  assert.deepEqual(s.sent.map((p) => p.title), ['BA danger: web', 'BA builder-down: builder-a']);
  const d = s.n.digest({ since: night - 1 });
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'needs-input');
  assert.equal(d[0].fkey, `${BID}/web`);
  assert.equal(d[0].reason, 'quiet');
  assert.equal(d[0].url, '#/inbox?sel=builder-a%2Fweb');
  assert.equal(d[0].at, night);
  assert.equal(s.n.digest({ since: night + 1 }).length, 0);
  // In the morning, the same kind is pushed again.
  s.at(Date.UTC(2026, 0, 16, 7, 0)); // 08:00 Berlin
  await s.n.onRaised([alarm('needs-input', 'api')]);
  assert.equal(s.sent.length, 3);
});

test('the deferred list persists in kv, is bounded, and survives a restart', async () => {
  const db = createMemoryKv();
  const night = Date.UTC(2026, 0, 15, 23, 0);
  const s = setup({ notify: { quietHours: QUIET }, start: night, db });
  const many = Array.from({ length: DEFERRED_MAX + 25 }, (_, i) => alarm('needs-input', `s${i}`));
  await s.n.onRaised(many);
  assert.equal(s.sent.length, 0);
  assert.equal(db.kvRead(KV_DEFERRED).length, DEFERRED_MAX);
  const s2 = setup({ notify: { quietHours: QUIET }, start: night, db });
  const d = s2.n.digest();
  assert.equal(d.length, DEFERRED_MAX);
  assert.equal(d[0].target, 's25', 'oldest dropped first');
  assert.equal(d.at(-1).target, `s${DEFERRED_MAX + 24}`);
});

test('rate cap: 15 raises from one builder, 15 targets, inside 10 min -> 10 pushes, 5 to the digest (S20)', async () => {
  const s = setup();
  const results = [];
  for (let i = 0; i < 15; i++) {
    results.push(...await s.n.onRaised([alarm('needs-input', `t${i}`)]));
    s.tick(30_000); // 15 raises over 7.5 min
  }
  assert.equal(s.sent.length, RATE_MAX);
  assert.equal(results.filter((r) => r.reason === 'rate').length, 5);
  const d = s.n.digest();
  assert.equal(d.length, 5);
  assert.ok(d.every((e) => e.reason === 'rate'));
  assert.deepEqual(d.map((e) => e.target), ['t10', 't11', 't12', 't13', 't14']);
  // Another builder is not affected.
  await s.n.onRaised([{ ...alarm('needs-input', 'x'), builder: 'builder-b', id: alarmId('needs-input', 'builder-b', 'x') }]);
  assert.equal(s.sent.length, RATE_MAX + 1);
  // The cap covers bypass kinds as well.
  await s.n.onRaised([alarm('danger', 'zz')]);
  assert.equal(s.sent.length, RATE_MAX + 1);
  // Once the window has moved on, pushes resume.
  s.tick(RATE_WINDOW_MS);
  await s.n.onRaised([alarm('needs-input', 'later')]);
  assert.equal(s.sent.length, RATE_MAX + 2);
});

test('sender failures and a missing sender never throw', async () => {
  const warns = [];
  const n = createNotifier({ now: () => NOON, cfg: () => ({}), sender: async () => { throw new Error('boom'); }, log: { warn: (...a) => warns.push(a.join(' ')) } });
  const r = await n.onRaised([alarm('approval')]);
  assert.equal(r[0].error, 'send failed');
  assert.equal(n.counters().failed, 1);
  const n2 = createNotifier({ now: () => NOON, cfg: () => ({}), getSender: () => null, log: { warn: (...a) => warns.push(a.join(' ')) } });
  const r2 = await n2.onRaised([alarm('approval')]);
  assert.equal(r2[0].error, 'no sender');
  assert.ok(warns.some((w) => w.includes('no push sender')));
});

// --- prefs -----------------------------------------------------------------------

test('checkPrefs: strict validation', () => {
  assert.equal(checkPrefs({ kinds: { review: false } }).ok, true);
  assert.equal(checkPrefs({ quietHours: null }).ok, true);
  assert.deepEqual(checkPrefs({ quietHours: { from: '22:00', to: '06:00' } }).patch, { quietHours: { from: '22:00', to: '06:00' } });
  assert.deepEqual(checkPrefs({ mutedTargets: ['builder-a/web', 'builder-a/web'] }).patch, { mutedTargets: ['builder-a/web'] });
  for (const bad of [
    null, [], 'x', { other: 1 }, JSON.parse('{"__proto__": {"x": 1}}'), { kinds: { bogus: true } },
    { kinds: JSON.parse('{"__proto__": true}') }, { kinds: { review: 'yes' } }, { quietHours: { from: '7:00', to: '08:00' } },
    { quietHours: { from: '08:00', to: '08:00' } }, { quietHours: { from: '08:00', to: '09:00', x: 1 } },
    { mutedTargets: 'builder-a/web' }, { mutedTargets: ['no-slash'] }, { mutedTargets: ['Bad_ID/web'] },
    { mutedTargets: Array.from({ length: 501 }, (_, i) => `builder-a/s${i}`) },
  ]) assert.equal(checkPrefs(bad).ok, false, JSON.stringify(bad));
});

test('prefs: stored overrides over config; setMuted', () => {
  const db = createMemoryKv();
  const s = setup({ db });
  assert.deepEqual(Object.keys(wirePrefs(s.n.prefs())).sort(), ['kinds', 'mutedTargets', 'quietHours']);
  s.n.setPrefs({ kinds: { review: false }, quietHours: QUIET });
  assert.equal(s.n.prefs().kinds.review, false);
  assert.equal(s.n.prefs().kinds.approval, true);
  assert.deepEqual(s.n.prefs().quietHours, QUIET);
  s.n.setMuted('builder-a/web', true);
  s.n.setMuted('builder-a/api', true);
  s.n.setMuted('builder-a/api', false);
  assert.deepEqual(s.n.prefs().mutedTargets, ['builder-a/web']);
  assert.throws(() => s.n.setMuted('nope', true));
  assert.deepEqual(db.kvRead(KV_PREFS).kinds, { review: false });
  // An explicit null quietHours overrides a config window.
  const s2 = setup({ db, notify: { quietHours: { from: '01:00', to: '02:00' } } });
  assert.deepEqual(s2.n.prefs().quietHours, QUIET);
  s2.n.setPrefs({ quietHours: null });
  assert.equal(s2.n.prefs().quietHours, null);
});

// --- module ----------------------------------------------------------------------

const DIRECT = Object.freeze({ kind: 'direct', user: 'alice@example.invalid', readOnly: false });
function req(body, auth = DIRECT) {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  r.url = '/api/notify/prefs';
  r.auth = auth;
  return r;
}

function moduleSetup({ withAlarms = true } = {}) {
  const routes = new Map();
  const provided = new Map();
  const listeners = new Set();
  const sent = [];
  const alarms = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  if (withAlarms) provided.set('alarms', alarms);
  provided.set('pushSender', async (p) => { sent.push(p); return { sent: 1, subscribers: 1 }; });
  const ctx = {
    mode: 'hub',
    config: { timezone: 'UTC', notify: obsDefaults().notify },
    db: createMemoryKv(),
    now: () => NOON,
    log: { warn() {}, error() {}, info() {} },
    route: (m, p, h) => routes.set(`${m} ${p}`, h),
    json: (res, body, status = 200) => { res.status = status; res.body = body; },
    provide: (k, v) => provided.set(k, v),
    has: (k) => provided.has(k),
    use: (k) => provided.get(k),
  };
  const mod = createModule();
  mod.register(ctx);
  mod.start(ctx);
  const emit = (change) => { for (const fn of listeners) fn(change); };
  const call = async (method, body, auth) => { const res = {}; await routes.get(`${method} /api/notify/prefs`)(req(body, auth), res); return res; };
  return { mod, ctx, provided, sent, emit, call, listeners };
}

test('module: provides notify, subscribes to alarms raises only, serves prefs', async () => {
  const m = moduleSetup();
  assert.equal(typeof m.provided.get('notify').digest, 'function');
  assert.equal(m.listeners.size, 1);
  m.emit({ raised: [], cleared: [alarm('approval')], acked: [] });
  m.emit({ raised: [], cleared: [], acked: [alarm('approval')] });
  m.emit({ raised: [alarm('approval')], cleared: [], acked: [] });
  await new Promise((r) => setImmediate(r));
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].url, '#/inbox?sel=builder-a%2Fweb');

  let res = await m.call('GET');
  assert.equal(res.status, 200);
  assert.equal(res.body.kinds.approval, true);
  assert.equal(res.body.quietHours, null);
  assert.deepEqual(res.body.mutedTargets, []);

  res = await m.call('POST', { kinds: { approval: false }, mutedTargets: ['builder-a/api'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.kinds.approval, false);
  assert.deepEqual(res.body.mutedTargets, ['builder-a/api']);
  res = await m.call('POST', { kinds: { bogus: true } });
  assert.equal(res.status, 400);
  res = await m.call('POST', '{not json');
  assert.equal(res.status, 400);
  res = await m.call('POST', 'x'.repeat(70 * 1024));
  assert.equal(res.status, 413);
  res = await m.call('GET');
  assert.equal(res.body.kinds.approval, false);

  m.mod.stop();
  assert.equal(m.listeners.size, 0);
});

test('module: without an alarms service it still serves prefs', async () => {
  const m = moduleSetup({ withAlarms: false });
  assert.equal((await m.call('GET')).status, 200);
});

// --- hub-safe web-push sender ----------------------------------------------------

test('createWebPushSender: sends to every subscription, drops 410s, never touches the builder push module', async () => {
  const calls = [];
  const removed = [];
  const webpush = {
    async sendNotification(sub, body, opts) {
      calls.push({ sub, body, opts });
      if (sub.endpoint === 'https://push.example.invalid/gone') { const e = new Error('gone'); e.statusCode = 410; throw e; }
    },
  };
  const send = createWebPushSender({
    webpush,
    vapid: () => ({ publicKey: 'pub', privateKey: 'priv' }),
    subject: 'https://hub.example.invalid/',
    subscriptions: {
      list: () => [{ endpoint: 'https://push.example.invalid/a', sub: { endpoint: 'https://push.example.invalid/a' } }, { endpoint: 'https://push.example.invalid/gone' }],
      remove: (e) => removed.push(e),
    },
  });
  const r = await send({ title: 't', body: 'b', tag: 'lb-x', url: '#/inbox' });
  assert.deepEqual(r, { sent: 1, subscribers: 2 });
  assert.deepEqual(removed, ['https://push.example.invalid/gone']);
  assert.equal(calls[0].opts.vapidDetails.subject, 'https://hub.example.invalid/');
  assert.deepEqual(JSON.parse(calls[0].body), { title: 't', body: 'b', tag: 'lb-x', url: '#/inbox' });
});

test('hub notify modules do not import builder-only modules', async () => {
  const fs = await import('node:fs');
  for (const f of ['server/hub/notify.mjs', 'server/hub/routes/notify.mjs']) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(specs.length > 0);
    for (const spec of specs) assert.ok(!/(^|\/)(push|config|db|state|log)\.mjs$/.test(spec), `${f} imports ${spec}`);
  }
});

test('SR13 L1: a prefs write (mute) needs a direct user; local keeps the read', async () => {
  const m = moduleSetup();
  const LOCAL = { kind: 'local', user: 'local' };
  for (const auth of [LOCAL, { kind: 'direct', user: 'local' }, { kind: 'direct', user: 'a', readOnly: true }, null]) {
    const res = await m.call('POST', { mutedTargets: ['builder-a/api'] }, auth);
    assert.equal(res.status, 403, JSON.stringify(auth));
  }
  assert.deepEqual((await m.call('GET', undefined, LOCAL)).body.mutedTargets, [], 'nothing was muted');
  assert.equal((await m.call('POST', { mutedTargets: ['builder-a/api'] })).status, 200);
  m.mod.stop();
});
