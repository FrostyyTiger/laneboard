// Alarms (fleet plan §7.3.5, O8): derive / reconcile / ack, the kv store,
// the standalone builder module and the hub module.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  KINDS, LINK_KINDS, KIND_TO_TILE, TILES, ALARM_ID_RE, MAX_ALARMS,
  alarmId, priorityOf, derive, reconcile, ack, ackMany, fleetOfOne, cleanText, AlarmError,
} from '../server/fleet/alarms.mjs';
import { createAlarmStore, createMemoryKv, KV_LIVE, KV_HISTORY } from '../server/fleet/alarms-store.mjs';
import { ALARM_KINDS } from '../server/config/observability.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { dispatch, _reset as resetDispatch } from '../server/fleet/dispatch.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import hubModuleDefault, { createModule as createHubModule, createAlarmService, checkAck } from '../server/hub/routes/alarms.mjs';

// modules.mjs and the builder module pull in config/state/db: keep them on
// the test config and an in-memory db even when this file runs on its own
// (imported dynamically, after the env is set).
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= path.join(import.meta.dirname, 'fixtures', 'empty-config.json');
const { createContext } = await import('../server/modules.mjs');
const builderMod = await import('../server/routes/alarms.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-alarms-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
let auditN = 0;
const newAudit = (builder = 'builder-a') => openAudit({ file: path.join(tmp, `audit-${++auditN}.jsonl`), builder });
const BID = 'builder-a';
const T0 = 1_700_000_000_000;

function session(name, extra = {}) {
  return { name, state: 'working', stateSince: T0 - 1000, activity: { failure: null }, danger: null, ...extra };
}

/** A snapshot with one of every builder-side input. */
function richSnapshot() {
  return {
    sessions: [
      session('ask-1', { state: 'waiting_question' }),
      session('appr-1', { awaitingApproval: 'ap-1' }),
      session('blk-1', { lastMarker: { kind: 'blocked', text: 'BLOCKED: no creds', ts: T0, dismissed_at: null } }),
      session('need-1', { state: 'idle', lastMarker: { kind: 'need', text: 'NEED-HUMAN: pick one', ts: T0, dismissed_at: null } }),
      session('fail-1', { state: 'done', activity: { failure: { type: 'api_error', text: 'overloaded' } } }),
      session('dang-1', { danger: { reason: 'rm -rf outside the worktree' } }),
      session('stk-loop', { stuck: { rule: 'tool-loop', reason: 'same tool 5x', since: T0 } }),
      session('stk-idle', { stuck: { rule: 'idle-in-working', reason: 'idle 25 min', since: T0 } }),
      session('ok-1'),
    ],
    lanes: [{ id: 'lane-r', reviewReady: { ready: true, reasons: ['done-marker'], since: T0 } }, { id: 'lane-n', reviewReady: { ready: false } }],
    attention: [{ name: 'ask-1', state: 'waiting_question', score: 90 }],
    approvals: [{ id: 'ap-1', name: 'appr-1', status: 'pending', tool: 'Bash', summary: 'git push' }],
    budget: [{ scope: 'lane', key: 'lane-r', lane: 'lane-r', usd: 9, limit: 10, pct: 90, level: 'warn' }, { scope: 'builder', key: BID, usd: 21, limit: 20, pct: 105, level: 'exceeded' }],
  };
}

const HEALTH = {
  at: T0,
  rebootRequired: true,
  alarms: [
    { key: 'memAvailPct', level: 'crit', text: 'memory available 3%' },
    { key: 'fsUsedPct:/', level: 'warn', text: 'disk / 88% used' },
    { key: 'fsUsedPct:docker', level: 'crit', text: 'disk docker 97% used' },
    { key: 'rebootRequired', level: 'warn', text: 'reboot required' },
  ],
};

const kinds = (list) => list.map((a) => a.kind).sort();
const byKind = (list, k) => list.filter((a) => a.kind === k);

// ----------------------------------------------------------------- model

test('KINDS matches the config fragment and every kind has a priority and at most one tile', () => {
  assert.deepEqual(Object.keys(KINDS).sort(), [...ALARM_KINDS].sort());
  for (const k of ALARM_KINDS) {
    assert.match(priorityOf(k, 'tool-loop'), /^P[1-4]$/, k);
    if (k !== 'review') assert.ok(TILES.includes(KIND_TO_TILE[k]), `${k} has a tile`);
  }
  assert.equal(KIND_TO_TILE.review, undefined);
});

test('priorities per kind; stuck P2 for approval-wait/error-loop/tool-loop, else P3', () => {
  const want = {
    'danger': 'P1', 'builder-down': 'P1', 'budget-exceeded': 'P1', 'audit-fork': 'P1',
    'approval': 'P2', 'needs-input': 'P2', 'blocked': 'P2', 'failed': 'P2', 'health-crit': 'P2', 'ci-red-main': 'P2',
    'builder-stale': 'P3', 'health-warn': 'P3', 'ci-red': 'P3', 'conflict': 'P3', 'review-overdue': 'P3',
    'review': 'P4', 'budget-warn': 'P4', 'reboot': 'P4',
  };
  for (const [k, p] of Object.entries(want)) assert.equal(priorityOf(k), p, k);
  for (const r of ['approval-wait', 'error-loop', 'tool-loop']) assert.equal(priorityOf('stuck', r), 'P2', r);
  for (const r of ['oscillation', 'stalled', 'context-pressure', 'cost-no-progress', 'idle-in-working', null]) assert.equal(priorityOf('stuck', r), 'P3', String(r));
  assert.equal(priorityOf('nope'), null);

  const list = derive(fleetOfOne(richSnapshot(), HEALTH, T0, { builder: { id: BID } }), T0);
  const stuck = Object.fromEntries(byKind(list, 'stuck').map((a) => [a.target, a.priority]));
  assert.deepEqual(stuck, { 'stk-loop': 'P2', 'stk-idle': 'P3' });
  for (const a of list) assert.equal(a.priority, priorityOf(a.kind, a.kind === 'stuck' ? (a.target === 'stk-loop' ? 'tool-loop' : 'x') : undefined));
});

test('ids are deterministic, unique, and always pass the dispatcher alarm-id rule', () => {
  const cases = [
    ['stuck', BID, 'web'], ['health-warn', BID, 'fsUsedPct:/'], ['health-warn', BID, 'fsUsedPct:docker'],
    ['conflict', BID, 'lane-a', 'builder-b/lane-c'], ['conflict', BID, 'lane-a', 'main:acme'],
    ['ci-red-main', null, 'acme/api'], ['builder-down', BID, null], ['needs-input', BID, 'my_sess (2)'],
    ['needs-input', BID, 'my_5fsess (2)'], ['needs-input', BID, 'x'.repeat(200)], ['needs-input', BID, 'x'.repeat(201)],
    ['approval', BID, 'ünï/cødé'],
  ];
  const ids = new Set();
  for (const c of cases) {
    const id = alarmId(...c);
    assert.equal(id, alarmId(...c), 'same input, same id');
    assert.match(id, ALARM_ID_RE, id);
    assert.ok(id.length <= 128);
    assert.ok(!ids.has(id), `unique: ${id}`);
    ids.add(id);
  }
  assert.equal(alarmId('stuck', BID, 'web'), 'stuck:builder-a:web');
  assert.match(alarmId('needs-input', BID, 'x'.repeat(200)), /^needs-input\.[0-9a-f]{32}$/);

  const a = derive(fleetOfOne(richSnapshot(), HEALTH, T0, { builder: { id: BID } }), T0);
  const b = derive(fleetOfOne(richSnapshot(), HEALTH, T0 + 5000, { builder: { id: BID } }), T0 + 5000);
  assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id), 'deriving again is idempotent');
  assert.equal(new Set(a.map((x) => x.id)).size, a.length);
});

test('derive: every builder input maps to its kind; disk per mount; reboot from health', () => {
  const list = derive(fleetOfOne(richSnapshot(), HEALTH, T0, { builder: { id: BID } }), T0);
  const t = (k) => byKind(list, k).map((a) => a.target).sort();
  assert.deepEqual(t('needs-input'), ['ask-1', 'need-1']);
  assert.deepEqual(t('approval'), ['appr-1']);
  assert.deepEqual(t('blocked'), ['blk-1']);
  assert.deepEqual(t('failed'), ['fail-1']);
  assert.deepEqual(t('danger'), ['dang-1']);
  assert.deepEqual(t('review'), ['lane-r']);
  assert.deepEqual(t('health-crit'), ['fsUsedPct:docker', 'memAvailPct']);
  assert.deepEqual(t('health-warn'), ['fsUsedPct:/']);
  assert.deepEqual(t('reboot'), ['rebootRequired']);
  assert.deepEqual(t('budget-warn'), ['lane-r']);
  assert.deepEqual(byKind(list, 'budget-exceeded').map((a) => [a.builder, a.target]), [[BID, null]]);
  assert.equal(byKind(list, 'failed')[0].text, 'api_error: overloaded');
  for (const a of list) {
    assert.equal(a.builder, BID);
    assert.equal(a.acked, false);
    assert.equal(a.cleared, null);
  }
  assert.ok(!list.some((a) => a.target === 'ok-1'));
  assert.ok(!list.some((a) => LINK_KINDS.includes(a.kind)), 'a fleet of one has no link kinds');
});

test('derive: a dismissed or answered marker is not live', () => {
  const s = (m, extra) => fleetOfOne({ sessions: [session('a', { lastMarker: m, ...extra })] }, null, T0, { builder: { id: BID } });
  assert.equal(derive(s({ kind: 'need', ts: T0, dismissed_at: T0 + 1 }), T0).length, 0);
  assert.equal(derive(s({ kind: 'need', ts: T0 - 5000 }, { state: 'working', stateSince: T0 - 1000 }), T0).length, 0);
  assert.equal(derive(s({ kind: 'need', ts: T0 }, { state: 'working', stateSince: T0 - 1000 }), T0).length, 1);
});

test('derive: missing or odd fields mean no alarm, never a throw', () => {
  const weird = [
    null, 42, 'x', [], {}, { builders: null }, { builders: [null, 1, { id: 'Bad Id' }, { id: BID }, { id: BID, snap: 'x' }] },
    { builders: [{ id: BID, snap: { sessions: [null, { name: 3 }, { name: 'a', danger: 0, stuck: 'yes', activity: 5, lastMarker: 'need' }], lanes: 'x', attention: [1], approvals: [{}], budget: [{ level: 'warn' }, 7], health: { alarms: [null, { key: 1 }, { key: 'k', level: 'meh' }] } } }],
      packages: { rows: [null, { main: null, prs: [{ verdict: 'red', fkey: 'nope' }] }], edges: [{ kind: 'textual', a: 'x' }] }, reviewWaits: [{ fkey: 3 }], auditForks: [5, { builder: 'BAD' }] },
  ];
  for (const f of weird) {
    const out = derive(f, T0);
    assert.ok(Array.isArray(out));
  }
  const out = derive(weird.at(-1), T0);
  assert.deepEqual(kinds(out), ['budget-warn'], 'only the well-formed budget entry raises');
});

test('derive: hub-only inputs (conn, packages, review waits, audit forks)', () => {
  const fleet = {
    builders: [
      { id: 'builder-a', state: 'down', snap: null },
      { id: 'builder-b', state: 'stale', snap: null },
      { id: 'builder-c', state: 'connecting', snap: null },
      { id: 'builder-d', state: 'up', snap: { sessions: [] } },
    ],
    packages: {
      rows: [
        { repo: 'acme', package: 'api', main: { status: 'fail' }, reasons: ['main red: test'], prs: [{ n: 7, fkey: 'builder-d/lane-x', verdict: 'red' }, { n: 8, fkey: 'builder-d/lane-y', verdict: 'green' }] },
        { repo: 'acme', package: 'web', main: { status: 'ok' }, prs: [{ n: 7, fkey: 'builder-d/lane-x', verdict: 'red' }] },
      ],
      edges: [
        { a: 'builder-d/lane-x', b: 'main:acme', kind: 'textual', files: 2, repo: 'acme' },
        { a: 'builder-d/lane-x', b: 'builder-a/lane-z', kind: 'textual', files: 1, repo: 'acme' },
        { a: 'builder-d/lane-y', b: 'builder-a/lane-z', kind: 'overlap', files: 1, repo: 'acme' },
      ],
    },
    reviewWaits: [{ fkey: 'builder-d/lane-r', waitingMs: 5 * 3_600_000 }],
    auditForks: [{ builder: 'builder-b' }],
  };
  const list = derive(fleet, T0);
  assert.deepEqual(kinds(list), ['audit-fork', 'builder-down', 'builder-stale', 'ci-red', 'ci-red-main', 'conflict', 'conflict', 'review-overdue']);
  const main = byKind(list, 'ci-red-main')[0];
  assert.equal(main.builder, null);
  assert.equal(main.target, 'acme/api');
  assert.equal(byKind(list, 'ci-red')[0].target, 'lane-x', 'one ci-red per lane, deduped across rows');
  assert.equal(byKind(list, 'review-overdue')[0].text, 'review waiting for 5 h');
  assert.equal(list[0].priority, 'P1', 'sorted worst first');
});

test('builder text is never interpreted: <img> round-trips as a string', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const snap = { sessions: [session('a', { stuck: { rule: 'stalled', reason: evil, since: T0 } }), session('b', { danger: { reason: `\u001b[31m${evil}‮` } })] };
  const list = derive(fleetOfOne(snap, null, T0, { builder: { id: BID } }), T0);
  const st = byKind(list, 'stuck')[0];
  assert.equal(typeof st.text, 'string');
  assert.equal(st.text, evil);
  const kv = createMemoryKv();
  const s1 = createAlarmStore({ db: kv, now: () => T0 });
  s1.apply(list);
  const back = createAlarmStore({ db: kv }).get(st.id);
  assert.equal(back.text, evil, 'stored and reloaded verbatim');
  const d = byKind(list, 'danger')[0].text;
  assert.ok(!/[\u0000-\u001f‮]/.test(d), 'control and bidi characters are stripped');
  assert.ok(d.includes(evil));
  assert.ok(cleanText('x'.repeat(1000)).length <= 300);
});

// ------------------------------------------------------------- lifecycle

test('reconcile: raise -> keep -> clear -> raise again gives a new unacked instance', () => {
  const one = (now) => derive({ builders: [{ id: BID, state: 'up', snap: { sessions: [session('a', { state: 'waiting_question' })] } }] }, now);
  let r = reconcile(new Map(), one(T0), T0);
  assert.equal(r.raised.length, 1);
  const id = r.raised[0].id;
  assert.equal(r.next.get(id).since, T0);
  assert.ok(ack(r.next, id, 'alice@example.invalid', T0 + 1).acked);

  r = reconcile(r.next, one(T0 + 10), T0 + 10);
  assert.equal(r.raised.length, 0);
  const kept = r.next.get(id);
  assert.equal(kept.since, T0, 'since is kept');
  assert.equal(kept.acked, true, 'ack is kept across reconcile');
  assert.equal(kept.ackedBy, 'alice@example.invalid');

  r = reconcile(r.next, [], T0 + 20);
  assert.equal(r.cleared.length, 1);
  assert.equal(r.cleared[0].cleared, T0 + 20);
  assert.equal(r.next.size, 0, 'cleared alarms leave the live set');

  r = reconcile(r.next, one(T0 + 30), T0 + 30);
  assert.equal(r.raised.length, 1);
  assert.equal(r.raised[0].id, id, 'same deterministic id');
  assert.equal(r.raised[0].acked, false, 'a new instance is unacked');
  assert.equal(r.raised[0].since, T0 + 30);
});

test('reconcile: hold keeps an alarm without clearing it', () => {
  const prev = reconcile(new Map(), derive({ builders: [{ id: BID, state: 'up', snap: { sessions: [session('a', { state: 'waiting_question' })] } }] }, T0), T0).next;
  const r = reconcile(prev, [], T0 + 1, { hold: (a) => a.builder === BID });
  assert.equal(r.cleared.length, 0);
  assert.equal(r.next.size, 1);
  assert.equal(reconcile(prev, [], T0 + 1, { hold: () => { throw new Error('x'); } }).cleared.length, 1, 'a throwing hold clears');
});

test('ack: unknown id is an error; ack is idempotent', () => {
  const m = reconcile(new Map(), derive({ builders: [{ id: BID, state: 'down' }] }, T0), T0).next;
  const e = ack(m, 'nope:x:y', 'alice', T0);
  assert.ok(e instanceof AlarmError);
  assert.equal(e.status, 404);
  assert.equal(e.code, 'unknown_alarm');
  const id = [...m.keys()][0];
  const a1 = ack(m, id, 'alice', T0 + 1);
  const a2 = ack(m, id, 'bob', T0 + 2);
  assert.equal(a2.ackedBy, 'alice');
  assert.equal(a2.ackedAt, a1.ackedAt);
});

test('ackMany by tile and by builder', () => {
  const fleet = {
    builders: [
      { id: 'builder-a', state: 'up', snap: { sessions: [session('s1', { stuck: { rule: 'stalled' } }), session('s2', { state: 'waiting_question' })] } },
      { id: 'builder-b', state: 'up', snap: { sessions: [session('s3', { stuck: { rule: 'tool-loop' } }), session('s4', { awaitingApproval: 'x' })] } },
    ],
  };
  const fresh = () => reconcile(new Map(), derive(fleet, T0), T0).next;
  let m = fresh();
  let out = ackMany(m, { tile: 'STCK' }, 'alice', T0 + 1);
  assert.deepEqual(out.map((a) => a.kind), ['stuck', 'stuck']);
  assert.ok([...m.values()].filter((a) => a.kind !== 'stuck').every((a) => !a.acked));
  assert.deepEqual(ackMany(m, { tile: 'STCK' }, 'alice', T0 + 2), [], 'already acked: nothing new');

  m = fresh();
  out = ackMany(m, { builder: 'builder-b' }, 'alice', T0 + 1);
  assert.deepEqual(out.map((a) => a.target).sort(), ['s3', 's4']);
  m = fresh();
  out = ackMany(m, { tile: 'STCK', builder: 'builder-a' }, 'alice', T0 + 1);
  assert.deepEqual(out.map((a) => a.target), ['s1']);
  m = fresh();
  assert.equal(ackMany(m, {}, 'alice', T0 + 1).length, 4, 'no scope acks all');
});

// ----------------------------------------------------------------- store

test('store: ack survives a kv reload; history is written per raise/clear/ack', () => {
  const kv = createMemoryKv();
  const events = [];
  const db = { ...kv, addEvent: (e) => events.push(e) };
  let t = T0;
  const fleet = (stuck) => ({ builders: [{ id: BID, state: 'up', snap: { sessions: [session('s1', { stuck: stuck ? { rule: 'tool-loop' } : null }), session('s2', { state: 'waiting_question' })] } }] });
  const s1 = createAlarmStore({ db, now: () => t });
  let r = s1.apply(derive(fleet(true), t));
  assert.equal(r.raised.length, 2);
  assert.ok(r.changed);
  const stuckId = alarmId('stuck', BID, 's1');
  t += 1;
  assert.equal(s1.ack(stuckId, 'alice@example.invalid').acked, true);
  assert.ok(s1.ack('missing', 'x') instanceof AlarmError);

  // restart: a new store over the same kv
  t += 1;
  const s2 = createAlarmStore({ db, now: () => t });
  const back = s2.get(stuckId);
  assert.equal(back.acked, true);
  assert.equal(back.ackedBy, 'alice@example.invalid');
  r = s2.apply(derive(fleet(true), t));
  assert.equal(r.raised.length, 0);
  assert.equal(r.changed, false, 'nothing moved: no write');
  assert.equal(s2.get(stuckId).acked, true, 'ack persists across reconcile after reload');
  assert.equal(s2.get(stuckId).since, T0);

  t += 1;
  r = s2.apply(derive(fleet(false), t));
  assert.equal(r.cleared.length, 1);
  assert.deepEqual(kv.kvRead(KV_LIVE).map((a) => a.kind), ['needs-input']);
  assert.deepEqual(events.map((e) => [e.type, e.subtype, e.payload.kind]).sort(), [
    ['alarm', 'acked', 'stuck'], ['alarm', 'cleared', 'stuck'], ['alarm', 'raised', 'needs-input'], ['alarm', 'raised', 'stuck'],
  ]);
  assert.equal(events.at(-1).payload.cleared, t);
});

test('store: kv history fallback (no addEvent) is bounded; bad kv rows are dropped on load', () => {
  const kv = createMemoryKv();
  kv.kvWrite(KV_LIVE, [null, { id: 'bad id', kind: 'stuck', priority: 'P2' }, { id: 'x:y', kind: 'nope', priority: 'P2' },
    { id: 'stuck:builder-a:s', kind: 'stuck', priority: 'P2', builder: 'builder-a', target: 's', text: 't', since: T0, acked: true, ackedBy: 'a', ackedAt: T0 }]);
  const s = createAlarmStore({ db: kv, now: () => T0 });
  assert.deepEqual(s.live().map((a) => a.id), ['stuck:builder-a:s']);
  s.apply([]);
  const h = s.history();
  assert.equal(h.length, 1);
  assert.equal(h[0].subtype, 'cleared');
  assert.ok(Array.isArray(kv.kvRead(KV_HISTORY)));
  const failing = { kvRead: () => { throw new Error('io'); }, kvWrite: () => { throw new Error('io'); } };
  const sf = createAlarmStore({ db: failing });
  assert.doesNotThrow(() => sf.apply(derive({ builders: [{ id: BID, state: 'down' }] }, T0)));
  assert.ok(sf.counters().writeErrors > 0);
  assert.throws(() => createAlarmStore({}), TypeError);
});

test('derive caps the live set', () => {
  const sessions = [];
  for (let i = 0; i < 500; i++) sessions.push(session(`s${i}`, { state: 'waiting_question', danger: { reason: 'x' }, awaitingApproval: 'a', activity: { failure: 'f' }, stuck: { rule: 'stalled' }, lastMarker: { kind: 'blocked', ts: T0 } }));
  const builders = [];
  for (let b = 0; b < 3; b++) builders.push({ id: `builder-${b}`, state: 'up', snap: { sessions } });
  const out = derive({ builders }, T0);
  assert.equal(out.length, MAX_ALARMS);
  assert.equal(out[0].priority, 'P1');
});

// --------------------------------------------- fleet of one == hub view

test('fleetOfOne derives the same alarms as the hub for one builder (minus link kinds)', () => {
  const snap = richSnapshot();
  const local = derive(fleetOfOne({ ...snap, builder: { id: BID, code: 'BA' } }, HEALTH, T0), T0);

  const store = createFleetStore({ builders: [{ id: BID, url: 'https://builder-a.example.invalid' }] });
  // what the builder puts on the wire: its snapshot with fleet keys
  const wire = structuredClone(snap);
  for (const s of wire.sessions) { s.key = `${BID}/${s.name}`; s.builder = 'someone-else'; }
  store.applySnapshot(BID, { type: 'snapshot', ...wire }, T0);
  store.applyEvent(BID, { type: 'health', health: HEALTH }, T0);
  store.setConn(BID, { state: 'down', lastSeen: T0 });
  const hub = derive(store.view(T0), T0);

  const strip = (l) => l.filter((a) => !LINK_KINDS.includes(a.kind)).map((a) => ({ ...a }));
  assert.deepEqual(strip(hub), local);
  assert.ok(hub.some((a) => a.kind === 'builder-down'), 'the hub adds the link kind');
});

// ------------------------------------------------------- builder module

function builderSetup({ hubControl = true } = {}) {
  resetDispatch();
  const mod = builderMod.createModule();
  const sent = [];
  const routes = new Map();
  const kv = createMemoryKv();
  const config = { mode: 'builder', fleet: { id: BID, hubControl }, alarms: { evalMs: 1000, historyDays: 30 } };
  const ctx = createContext({ mode: 'builder', config, db: kv, ws: { send: (m) => sent.push(m) } }, {
    route: (method, p, h) => routes.set(`${method} ${p}`, h),
  });
  mod.register(ctx);
  const audit = newAudit();
  const go = (env, auth = { kind: 'direct', user: 'alice@example.invalid' }) => dispatch(env, { auth, deps: { config }, audit, config });
  const env = (target, args = {}) => ({ v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: BID, action: 'ack-alarm', target, args, user: 'alice@example.invalid', via: 'direct' });
  return { mod, sent, routes, kv, go, env, audit };
}

test('builder: ack-alarm from a signed hub request -> 403 local-only', async () => {
  const s = builderSetup({ hubControl: true });
  s.mod.evaluate(richSnapshot(), T0);
  const id = alarmId('stuck', BID, 'stk-loop');
  const r = await s.go(s.env(id), { kind: 'hub', scopes: new Set(['read', 'control']), keyLabel: 'hub-main', verified: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.code, 'local-only');
  assert.equal(s.mod.store().get(id).acked, false);
  const r2 = await s.go(s.env('*', { tile: 'STCK' }), { kind: 'hub', scopes: new Set(['read', 'control']), keyLabel: 'hub-main', verified: true });
  assert.equal(r2.code, 'local-only');
});

test('builder: ack-alarm * with {tile:"STCK"} acks only stuck alarms, needs no builder-id confirm', async () => {
  const s = builderSetup();
  const res = s.mod.evaluate(richSnapshot(), T0);
  assert.ok(res.changed);
  assert.equal(s.sent.at(-1).type, 'alarms');
  const before = s.sent.length;
  const r = await s.go(s.env('*', { tile: 'STCK' }));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.n, 2);
  const live = s.mod.store().live();
  for (const a of live) assert.equal(a.acked, a.kind === 'stuck', a.id);
  assert.equal(s.sent.length, before + 1, 'the new live set is sent');
  assert.equal(s.sent.at(-1).alarms.filter((a) => a.acked).length, 2);
  assert.ok(r.auditId, 'audited');
});

test('builder: ack by id, unknown id, bad args; local CLI may ack', async () => {
  const s = builderSetup();
  s.mod.evaluate(richSnapshot(), T0);
  const id = alarmId('approval', BID, 'appr-1');
  let r = await s.go(s.env(id), { kind: 'local', user: 'local' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.acked, [id]);
  assert.equal(s.mod.store().get(id).ackedBy, 'local');
  r = await s.go(s.env('stuck:builder-a:nope'));
  assert.equal(r.status, 404);
  assert.equal(r.code, 'unknown_alarm');
  r = await s.go(s.env('has/slash'));
  assert.equal(r.code, 'bad_target');
  r = await s.go(s.env('*', { tile: 'NOPE' }));
  assert.equal(r.code, 'bad_args');
  r = await s.go(s.env('*', { extra: 1 }));
  assert.equal(r.code, 'bad_args');
  r = await s.go(s.env(id, { tile: 'STCK' }));
  assert.equal(r.code, 'bad_args', 'scope args only with *');
});

test('builder: GET /api/alarms, ack survives a module restart over the same kv, clears on recovery', async () => {
  const s = builderSetup();
  s.mod.evaluate(richSnapshot(), T0);
  const id = alarmId('blocked', BID, 'blk-1');
  await s.go(s.env(id));
  let body;
  const res = { writeHead() {}, setHeader() {}, end(b) { body = JSON.parse(b); } };
  s.routes.get('GET /api/alarms')({ url: '/api/alarms' }, res);
  assert.equal(body.builder.id, BID);
  assert.ok(body.alarms.some((a) => a.id === id && a.acked));

  resetDispatch();
  const mod2 = builderMod.createModule();
  mod2.register(createContext({ mode: 'builder', config: { fleet: { id: BID } }, db: s.kv, ws: { send() {} } }, { route() {} }));
  assert.equal(mod2.store().get(id).acked, true, 'ack reloaded from kv');
  mod2.evaluate(richSnapshot(), T0 + 5000);
  assert.equal(mod2.store().get(id).acked, true);
  mod2.evaluate({ sessions: [] }, T0 + 10000);
  assert.equal(mod2.store().live().length, 0);
});

test('builder: start() hooks the tick, throttled', () => {
  resetDispatch();
  const mod = builderMod.createModule();
  const ticks = [];
  let snaps = 0;
  const state = { onTick: (fn) => ticks.push(fn), snapshot: () => { snaps++; return { sessions: [] }; } };
  const ctx = createContext({ mode: 'builder', config: { fleet: { id: BID }, alarms: { evalMs: 1000 } }, db: createMemoryKv(), state, ws: { send() {} } }, { route() {} });
  mod.register(ctx);
  mod.start(ctx);
  assert.equal(ticks.length, 1);
  ticks[0]({}, T0);
  ticks[0]({}, T0 + 2000);
  ticks[0]({}, T0 + builderMod.BUILDER_EVAL_MS);
  assert.equal(snaps, 2);
});

// ----------------------------------------------------------- hub module

function hubSetup({ audit = newAudit(null), now = () => T0 } = {}) {
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid' }, { id: 'builder-b', url: 'https://b.example.invalid' }] });
  const sent = [];
  const alarmStore = createAlarmStore({ db: createMemoryKv(), now });
  const fake = { setTimeout: () => null, clearTimeout() {}, setInterval: () => null, clearInterval() {} };
  const svc = createAlarmService({ fleetStore: store, alarmStore, broadcast: (m) => sent.push(m), now, audit, timers: fake });
  return { store, sent, alarmStore, svc, audit };
}

test('hub: evaluates the store view, broadcasts {type:"alarms"} on change only', () => {
  const h = hubSetup();
  h.store.applySnapshot('builder-a', { sessions: [session('web', { state: 'waiting_question' })] }, T0);
  h.store.setConn('builder-a', { state: 'up', lastSeen: T0 });
  h.store.setConn('builder-b', { state: 'down', lastSeen: T0 - 120_000 });
  const r = h.svc.evaluate();
  assert.deepEqual(kinds(r.raised), ['builder-down', 'needs-input']);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'alarms');
  assert.equal(h.sent[0].alarms[0].kind, 'builder-down');
  h.svc.evaluate();
  assert.equal(h.sent.length, 1, 'no change, no frame');
  // builder `alarms` frames are not something the store keeps
  assert.equal(h.store.applyEvent('builder-a', { type: 'alarms', alarms: [{ id: 'x', kind: 'danger' }] }, T0), null);
});

test('hub: alarms of a builder that has not reported yet are held, link kinds are not', () => {
  const kv = createMemoryKv();
  const pre = createAlarmStore({ db: kv, now: () => T0 });
  pre.apply(derive({ builders: [{ id: 'builder-a', state: 'up', snap: { sessions: [session('web', { state: 'waiting_question' })] } }, { id: 'builder-b', state: 'down' }] }, T0));
  pre.ack(alarmId('needs-input', 'builder-a', 'web'), 'alice');
  // hub restart: both builders still connecting
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid' }, { id: 'builder-b', url: 'https://b.example.invalid' }] });
  const fake = { setTimeout: () => null, clearTimeout() {}, setInterval: () => null, clearInterval() {} };
  const svc = createAlarmService({ fleetStore: store, alarmStore: createAlarmStore({ db: kv, now: () => T0 + 1 }), now: () => T0 + 1, timers: fake });
  const r = svc.evaluate();
  assert.deepEqual(r.cleared.map((a) => a.kind), ['builder-down']);
  const live = svc.live();
  assert.equal(live.length, 1);
  assert.equal(live[0].acked, true, 'the ack survived the hub restart');
});

test('hub: ack-alarm is hub-local, needs direct, is audited, never relayed', async () => {
  const relayCalls = [];
  const registered = new Map();
  const relay = {
    registerHubAction: (name, def) => registered.set(name, def),
    relay: async (...a) => { relayCalls.push(a); return { ok: true }; },
  };
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid' }] });
  store.applySnapshot('builder-a', { sessions: [session('s1', { stuck: { rule: 'stalled' } }), session('s2', { state: 'waiting_question' })] }, T0);
  store.setConn('builder-a', { state: 'up', lastSeen: T0 });
  const audit = newAudit(null);
  const sent = [];
  const routes = new Map();
  const mod = createHubModule();
  const ctx = createContext({
    mode: 'hub', config: { alarms: { evalMs: 1000 } }, db: createMemoryKv(), store, relay, audit,
    broadcast: (m) => sent.push(m), now: () => T0,
  }, { route: (m, p, h) => routes.set(`${m} ${p}`, h) });
  await mod.register(ctx);
  assert.ok(ctx.has('alarms'));
  mod.start(ctx);
  try {
    mod.api.subscribe(() => {});
    assert.ok(registered.has('ack-alarm'));
    // the service ran once on start (scheduled); evaluate directly for determinism
    const run = registered.get('ack-alarm').run;
    const raised = [];
    mod.api.subscribe((c) => raised.push(c));
    // force an evaluation through a store event + the service's schedule is async: call ack after one eval
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(mod.api.live().length >= 2, 'alarms derived');

    let r = run({ builder: null, action: 'ack-alarm', target: '*', args: { tile: 'STCK' }, user: 'local' });
    assert.equal(r.status, 403);
    assert.equal(r.code, 'remote-only');
    r = run({ action: 'ack-alarm', target: '*', args: { tile: 'STCK' }, auth: { kind: 'local', user: 'x' } });
    assert.equal(r.code, 'remote-only');
    r = run({ action: 'ack-alarm', target: '*', args: { tile: 'STCK' } });
    assert.equal(r.code, 'remote-only', 'no user, no ack');
    r = run({ action: 'ack-alarm', target: '*', args: { tile: 'STCK', extra: 1 }, user: 'alice@example.invalid' });
    assert.equal(r.code, 'bad_args');
    r = run({ action: 'ack-alarm', target: 'a/b', args: {}, user: 'alice@example.invalid' });
    assert.equal(r.code, 'bad_target');

    const framesBefore = sent.length;
    r = run({ builder: 'builder-a', action: 'ack-alarm', target: '*', args: { tile: 'STCK' } }, 'alice@example.invalid');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.n, 1);
    assert.ok(r.auditId);
    assert.equal(sent.length, framesBefore + 1);
    assert.equal(sent.at(-1).type, 'alarms');
    assert.ok(raised.some((c) => c.acked.length === 1 && c.acked[0].kind === 'stuck'));
    const live = mod.api.live();
    for (const a of live) assert.equal(a.acked, a.kind === 'stuck');

    r = run({ action: 'ack-alarm', target: alarmId('needs-input', 'builder-a', 's2'), args: {}, user: 'alice@example.invalid', auth: { kind: 'direct' } });
    assert.equal(r.ok, true, r.error);
    r = run({ action: 'ack-alarm', target: 'needs-input:builder-a:zz', args: {}, user: 'alice@example.invalid' });
    assert.equal(r.status, 404);
    assert.equal(relayCalls.length, 0, 'never relayed to a builder');

    const lines = fs.readFileSync(audit.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const acks = lines.filter((e) => e.action === 'ack-alarm');
    assert.ok(acks.some((e) => e.result?.phase === 'start' && e.user === 'alice@example.invalid' && e.via === 'direct'));
    assert.ok(acks.some((e) => e.result?.phase === 'done' && e.result.ok === true));
    assert.ok(acks.some((e) => e.result?.code === 'unknown_alarm'));
    assert.ok(!acks.some((e) => e.user === 'local'), 'a refused local request acks nothing and writes nothing');

    let body;
    routes.get('GET /api/alarms')({ url: '/api/alarms' }, { writeHead() {}, setHeader() {}, end(b) { body = JSON.parse(b); } });
    assert.ok(Array.isArray(body.alarms));
  } finally {
    mod.stop();
  }
});

test('hub: ack refuses without an audit log (fail closed)', () => {
  const h = hubSetup({ audit: null });
  h.store.applySnapshot('builder-a', { sessions: [session('s1', { stuck: { rule: 'stalled' } })] }, T0);
  h.svc.evaluate();
  const r = h.svc.handleAck({ action: 'ack-alarm', target: '*', args: {} }, 'alice@example.invalid');
  assert.equal(r.status, 503);
  assert.equal(h.alarmStore.live()[0].acked, false);
  const bad = { append: () => { throw new Error('disk full'); } };
  const h2 = hubSetup({ audit: bad });
  h2.store.applySnapshot('builder-a', { sessions: [session('s1', { stuck: { rule: 'stalled' } })] }, T0);
  h2.svc.evaluate();
  assert.equal(h2.svc.handleAck({ action: 'ack-alarm', target: '*', args: {} }, 'alice@example.invalid').code, 'audit-unavailable');
  assert.equal(h2.alarmStore.live()[0].acked, false);
});

test('hub: checkAck validation and review waits / packages inputs', () => {
  assert.equal(checkAck('*', undefined).ok, true);
  assert.equal(checkAck('*', { builder: 'Bad' }).code, 'bad_args');
  assert.equal(checkAck(5, {}).code, 'bad_target');
  assert.equal(checkAck('*', []).code, 'bad_args');
  assert.equal(checkAck('*', Object.create({ tile: 'STCK' })).code, 'bad_args');
  assert.deepEqual(checkAck('*', { tile: 'CONF', builder: 'builder-a' }).args, { tile: 'CONF', builder: 'builder-a' });

  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid' }] });
  store.applySnapshot('builder-a', { sessions: [] }, T0);
  store.setConn('builder-a', { state: 'up', lastSeen: T0 });
  const fake = { setTimeout: () => null, clearTimeout() {}, setInterval: () => null, clearInterval() {} };
  const svc = createAlarmService({
    fleetStore: store, alarmStore: createAlarmStore({ db: createMemoryKv(), now: () => T0 }), now: () => T0, timers: fake,
    reviewWaits: { overdue: () => [{ fkey: 'builder-a/lane-r', waitingMs: 6 * 3_600_000 }] },
    auditForks: () => [{ builder: 'builder-a' }],
  });
  assert.deepEqual(kinds(svc.evaluate().raised), ['audit-fork', 'review-overdue']);
});

test('the hub module never imports builder-only modules', () => {
  const read = (p) => fs.readFileSync(path.join(import.meta.dirname, '..', p), 'utf8');
  const importsOf = (src) => [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm), ...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  // builder-only: the process-wide state, db, config, terminals, ws, log, and the builder module dirs
  const bad = /(^|\/)(state|db|config|terminals|ws|log|api-v1|dispatch)\.mjs$|(^|\/)\.\.\/\.\.\/(routes|flags|collector)\/|^\.\.\/(flags|collector)\//;
  for (const f of ['server/hub/routes/alarms.mjs', 'server/fleet/alarms.mjs', 'server/fleet/alarms-store.mjs']) {
    for (const spec of importsOf(read(f))) {
      if (spec.startsWith('node:')) continue;
      assert.ok(!bad.test(spec), `${f} imports ${spec}`);
    }
  }
  assert.equal(hubModuleDefault.name, 'hub-alarms');
  assert.deepEqual(hubModuleDefault.modes, ['hub']);
  assert.deepEqual(builderMod.default.modes, ['builder']);
});

test('hub: ack-alarm works end to end through the real relay (SR20 L1)', async () => {
  const { createRelay } = await import('../server/hub/relay.mjs');
  const store = createFleetStore({ builders: [{ id: 'builder-a', url: 'https://a.example.invalid' }] });
  store.applySnapshot('builder-a', { sessions: [session('s1', { stuck: { rule: 'stalled' } }), session('s2', { state: 'waiting_question' })] }, T0);
  store.setConn('builder-a', { state: 'up', lastSeen: T0 });
  const audit = newAudit(null);
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  let fetched = 0;
  const relay = createRelay({ store, key: privateKey, audit, fetchImpl: async () => { fetched++; throw new Error('no network'); } });
  const mod = createHubModule();
  const ctx = createContext({
    mode: 'hub', config: { alarms: { evalMs: 1000 } }, db: createMemoryKv(), store, relay, audit,
    broadcast: () => {}, now: () => T0,
  }, { route: () => {} });
  await mod.register(ctx);
  mod.start(ctx);
  try {
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(mod.api.live().length >= 2, 'alarms derived');
    const user = 'alice@example.invalid';
    // the relay itself refuses a non-direct caller before the handler runs
    let r = await relay.relay({ action: 'ack-alarm', target: '*', args: { tile: 'STCK' } }, { kind: 'local', user });
    assert.equal(r.status, 403);
    assert.ok(mod.api.live().every((a) => !a.acked));

    r = await relay.relay({ action: 'ack-alarm', target: '*', args: { tile: 'STCK' } }, { kind: 'direct', user });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.status, 200);
    assert.equal(r.result.n, 1);
    for (const a of mod.api.live()) assert.equal(a.acked, a.kind === 'stuck');

    r = await relay.relay({ action: 'ack-alarm', target: alarmId('needs-input', 'builder-a', 's2'), args: {} }, { kind: 'direct', user });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(mod.api.live().every((a) => a.acked));
    assert.equal(fetched, 0, 'never relayed to a builder');

    const lines = fs.readFileSync(audit.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.some((e) => e.action === 'ack-alarm' && e.result?.phase === 'start' && e.user === user && e.via === 'direct'));
  } finally {
    mod.stop();
  }
});
