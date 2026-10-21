// Sessions tied to rounds (docs/plans/runs/README.md §3 A1, T12): by the round's
// `session` field, or by cwd + time window (server/runs/bind.mjs); the sessions
// come from the hook events and cost snapshots (db.sessionsSeen); the run page
// lists them per round.
import test from 'node:test';
import assert from 'node:assert/strict';

import { runDirs, inDir, roundWindows, bindRuns, withSessions } from '../server/runs/bind.mjs';
import { parseLine, foldRun } from '../server/runs/protocol.mjs';
import { runWithSessions } from '../server/routes/runs.mjs';
import { addEvent, addCostSnapshot, sessionsSeen } from '../server/db.mjs';
import { roundSessions, renderRunPage } from '../public/js/views/runs.js';
import { makeDocument } from './helpers/fakedom.mjs';

const MIN = 60_000;

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = makeDocument();
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
}

const byClass = (node, cls) => node.querySelectorAll(`.${cls}`);
const T0 = 1_792_520_000_000;

/** A folded run from protocol lines (objects), so the shapes are the real ones. */
function fold(lines) {
  return foldRun(lines.map((o) => {
    const r = parseLine(JSON.stringify({ v: 1, ...o }));
    assert.equal(r.ok, true, JSON.stringify(o));
    return r.event;
  }));
}

/** A run `id` with rounds 1 (T0..+10m) and 2 (+10m.., no end), started in `cwd`. */
function twoRounds(id, { cwd = null, at = T0, stop = false } = {}) {
  return fold([
    { t: 'run.start', run: id, ts: at, goal: 'g', ...(cwd ? { cwd } : {}) },
    { t: 'round.start', run: id, ts: at + 1000, n: 1, role: 'planner' },
    { t: 'round.end', run: id, ts: at + 10 * MIN, n: 1, outcome: 'kept' },
    { t: 'round.start', run: id, ts: at + 10 * MIN + 1000, n: 2, role: 'builder' },
    ...(stop ? [{ t: 'run.stop', run: id, ts: at + 30 * MIN, reason: 'done' }] : []),
  ]);
}

const ses = (sessionId, cwd, firstAt, usd = null, extra = {}) =>
  ({ sessionId, name: null, cwd, firstAt, lastAt: firstAt + MIN, usd, ...extra });

test('the protocol keeps cwd on run.start and session on round events', () => {
  const start = parseLine(JSON.stringify({ t: 'run.start', run: 'r', cwd: '/work/acme/' })).event;
  assert.equal(start.cwd, '/work/acme', 'a trailing slash goes');
  assert.equal(parseLine(JSON.stringify({ t: 'run.start', run: 'r', cwd: 'acme' })).event.cwd, null, 'relative: dropped');
  assert.equal(parseLine(JSON.stringify({ t: 'run.start', run: 'r', cwd: `/${'a'.repeat(2000)}` })).event.cwd, null, 'too long: dropped, not cut');
  assert.equal(parseLine(JSON.stringify({ t: 'run.start', run: 'r', cwd: '/a\nb' })).event.cwd, null);
  const id = '6f1c2a3b-0000-4000-8000-000000000001';
  assert.equal(parseLine(JSON.stringify({ t: 'round.start', run: 'r', n: 1, session: id })).event.session, id);
  assert.equal(parseLine(JSON.stringify({ t: 'round.end', run: 'r', n: 1, session: id })).event.session, id);
  assert.equal(parseLine(JSON.stringify({ t: 'round.end', run: 'r', n: 1, session: 'no spaces' })).event.session, null);
  const run = fold([
    { t: 'run.start', run: 'r', cwd: '/work/acme' },
    { t: 'round.start', run: 'r', n: 1, session: id },
    { t: 'round.end', run: 'r', n: 1, session: id },
    { t: 'round.start', run: 'r', n: 2 },
  ]);
  assert.equal(run.cwd, '/work/acme');
  assert.deepEqual(run.rounds.map((r) => r.sessions), [[id], []]);
});

test('runDirs: run.start cwd plus the dir of every <dir>/.laneboard/run.jsonl', () => {
  assert.deepEqual(runDirs({ cwd: '/work/acme' }, ['/work/acme/.laneboard/run.jsonl', '/srv/runs/x/run.jsonl', '/state/runs/x.jsonl']),
    ['/work/acme']);
  assert.deepEqual(runDirs({ cwd: null }, ['/work/b/.laneboard/run.jsonl', '/work/a/.laneboard/run.jsonl', 'rel/.laneboard/run.jsonl']),
    ['/work/a', '/work/b']);
  assert.deepEqual(runDirs({ cwd: null }, ['/srv/runs/x/run.jsonl']), [], 'a file outside the run dir names no dir');
  assert.deepEqual(runDirs(null, null), []);
});

test('inDir: the dir itself or below it, by path segment', () => {
  assert.equal(inDir('/work/acme', '/work/acme'), true);
  assert.equal(inDir('/work/acme/sub/x', '/work/acme'), true);
  assert.equal(inDir('/work/acme-2', '/work/acme'), false, 'not a string prefix');
  assert.equal(inDir('/work', '/work/acme'), false);
  assert.equal(inDir('acme', '/work'), false);
  assert.equal(inDir(null, '/work'), false);
  assert.equal(inDir('/x', '/'), true);
});

test('roundWindows: to the end, else the next start, else the stop, else now', () => {
  const run = twoRounds('a');
  assert.deepEqual(roundWindows(run, T0 + 60 * MIN), [
    { n: 1, from: T0 + 1000, to: T0 + 10 * MIN },
    { n: 2, from: T0 + 10 * MIN + 1000, to: T0 + 60 * MIN },
  ]);
  const stopped = twoRounds('a', { stop: true });
  assert.equal(roundWindows(stopped, T0 + 60 * MIN)[1].to, T0 + 30 * MIN);
  const noEnd = fold([
    { t: 'round.start', run: 'a', ts: T0, n: 1 },
    { t: 'round.start', run: 'a', ts: T0 + 5 * MIN, n: 2 },
  ]);
  assert.equal(roundWindows(noEnd, T0 + 9 * MIN)[0].to, T0 + 5 * MIN, 'a round with no end runs to the next start');
  assert.deepEqual(roundWindows(fold([{ t: 'round.start', run: 'a', n: 1 }]), T0), [], 'no start time, no window');
});

test('bind by cwd + window: inside, outside, before the first round, another dir', () => {
  const run = twoRounds('a', { cwd: '/work/acme' });
  const sessions = [
    ses('s-in-1', '/work/acme', T0 + 2 * MIN, 0.5),
    ses('s-in-2', '/work/acme/sub', T0 + 20 * MIN, 1.25),
    ses('s-before', '/work/acme', T0 - 5 * MIN, 9),
    ses('s-other-dir', '/work/other', T0 + 3 * MIN, 9),
    ses('s-sibling', '/work/acme-2', T0 + 3 * MIN, 9),
    ses('s-after-stop', '/work/acme', T0 + 40 * MIN, 9),
    ses('s-no-cwd', null, T0 + 3 * MIN, 9),
  ];
  const stopped = twoRounds('a', { cwd: '/work/acme', stop: true });
  const bound = bindRuns([{ run: stopped, dirs: runDirs(stopped) }], sessions, T0 + 60 * MIN);
  const m = bound.get('a');
  assert.deepEqual(m.get(1).map((e) => e.sessionId), ['s-in-1']);
  assert.deepEqual(m.get(2).map((e) => e.sessionId), ['s-in-2']);
  assert.equal(m.get(1)[0].how, 'cwd');
  assert.equal(m.get(1)[0].maybe, false);
  assert.equal(m.get(1)[0].usd, 0.5);
  // still running: round 2 runs to now, so the later session is in it
  const live = bindRuns([{ run, dirs: runDirs(run) }], sessions, T0 + 60 * MIN).get('a');
  assert.deepEqual(live.get(2).map((e) => e.sessionId), ['s-in-2', 's-after-stop']);
  // no dirs: nothing is guessed
  assert.equal(bindRuns([{ run, dirs: [] }], sessions, T0 + 60 * MIN).get('a'), undefined);
});

test('bind by the round\'s session field: exact, whatever the dir, never guessed elsewhere', () => {
  const id = 'b8f0e8d2-0000-4000-8000-000000000002';
  const run = fold([
    { t: 'run.start', run: 'a', ts: T0, cwd: '/work/acme' },
    { t: 'round.start', run: 'a', ts: T0 + 1000, n: 1, session: id },
    { t: 'round.end', run: 'a', ts: T0 + 10 * MIN, n: 1 },
    { t: 'round.start', run: 'a', ts: T0 + 10 * MIN + 1000, n: 2 },
  ]);
  // the session's hooks say it was first seen during round 2, in another dir
  const sessions = [ses(id, '/elsewhere', T0 + 11 * MIN, 2), ses('s-x', '/work/acme', T0 + 12 * MIN)];
  const m = bindRuns([{ run, dirs: runDirs(run) }], sessions, T0 + 60 * MIN).get('a');
  assert.deepEqual(m.get(1).map((e) => [e.sessionId, e.how, e.usd]), [[id, 'id', 2]]);
  assert.deepEqual(m.get(2).map((e) => e.sessionId), ['s-x']);
  // a named session laneboard never heard from is still listed, with no cost
  const alone = bindRuns([{ run, dirs: [] }], [], T0).get('a').get(1);
  assert.deepEqual(alone.map((e) => [e.sessionId, e.usd]), [[id, null]]);
});

test('two runs in one dir: apart in time each gets its own, at the same time both say maybe', () => {
  const a = twoRounds('a', { cwd: '/work/acme', stop: true });                    // T0 .. T0+30m
  const b = twoRounds('b', { cwd: '/work/acme', at: T0 + 60 * MIN, stop: true }); // T0+60m .. T0+90m
  const sessions = [ses('s-a', '/work/acme', T0 + 2 * MIN, 1), ses('s-b', '/work/acme', T0 + 62 * MIN, 2)];
  const runs = [{ run: a, dirs: runDirs(a) }, { run: b, dirs: runDirs(b) }];
  const apart = bindRuns(runs, sessions, T0 + 120 * MIN);
  assert.deepEqual(apart.get('a').get(1).map((e) => [e.sessionId, e.maybe]), [['s-a', false]]);
  assert.deepEqual(apart.get('b').get(1).map((e) => [e.sessionId, e.maybe]), [['s-b', false]]);
  assert.equal(apart.get('a').get(2), undefined);

  const c = twoRounds('c', { cwd: '/work/acme', at: T0 + 30_000 }); // overlaps a
  const both = bindRuns([{ run: a, dirs: runDirs(a) }, { run: c, dirs: runDirs(c) }], sessions, T0 + 120 * MIN);
  assert.deepEqual(both.get('a').get(1).map((e) => [e.sessionId, e.maybe]), [['s-a', true]]);
  assert.deepEqual(both.get('c').get(1).map((e) => [e.sessionId, e.maybe]), [['s-a', true]]);
  // a run in a dir below is the same dir for the guess
  const d = twoRounds('d', { cwd: '/work', at: T0 + 30_000 });
  const nested = bindRuns([{ run: a, dirs: runDirs(a) }, { run: d, dirs: runDirs(d) }], sessions, T0 + 120 * MIN);
  assert.equal(nested.get('a').get(1)[0].maybe, true);
});

test('withSessions: rounds carry their entries and their summed cost', () => {
  const run = twoRounds('a', { cwd: '/work/acme' });
  const bound = bindRuns([{ run, dirs: runDirs(run) }],
    [ses('s1', '/work/acme', T0 + MIN, 0.25), ses('s2', '/work/acme', T0 + 2 * MIN, 0.5), ses('s3', '/work/acme', T0 + 3 * MIN)],
    T0 + 60 * MIN);
  const out = withSessions(run, bound);
  assert.deepEqual(out.rounds[0].sessions.map((s) => s.sessionId), ['s1', 's2', 's3']);
  assert.equal(out.rounds[0].sessionsUsd, 0.75);
  assert.deepEqual(out.rounds[1].sessions, []);
  assert.equal(out.rounds[1].sessionsUsd, null);
  assert.deepEqual(run.rounds[0].sessions, [], 'the fold is not changed');
  assert.deepEqual(withSessions(run, null).rounds.map((r) => r.sessions), [[], []]);
});

test('sessionsSeen: hook events give id, cwd and first/last seen; cost snapshots the usd', () => {
  const base = T0 + 1000 * MIN; // away from other tests' rows
  addEvent({ ts: base - 10 * MIN, sessionId: 'db-early', type: 'hook', payload: { cwd: '/work/acme' } });
  addEvent({ ts: base + MIN, sessionId: 'db-early', type: 'hook', payload: { cwd: '/work/acme/sub' } });
  addEvent({ ts: base + 2 * MIN, sessionId: 'db-new', sessionName: 'acme', type: 'hook', payload: { cwd: null } });
  addEvent({ ts: base + 3 * MIN, sessionId: 'db-new', type: 'hook', payload: { cwd: '/work/acme' } });
  addEvent({ ts: base + 50 * MIN, sessionId: 'db-later', type: 'hook', payload: { cwd: '/work/acme' } });
  addEvent({ ts: base + 4 * MIN, sessionId: null, type: 'hook', payload: { cwd: '/work/acme' } });
  addCostSnapshot({ ts: base + 2 * MIN, sessionId: 'db-new', sessionName: 'acme', usd: 0.4 });
  addCostSnapshot({ ts: base + 3 * MIN, sessionId: 'db-new', sessionName: 'acme', usd: 0.9 });
  const got = sessionsSeen(base, base + 10 * MIN);
  assert.deepEqual(got.map((s) => [s.sessionId, s.name, s.cwd, s.firstAt, s.lastAt, s.usd]), [
    ['db-early', null, '/work/acme', base - 10 * MIN, base + MIN, null],
    ['db-new', 'acme', '/work/acme', base + 2 * MIN, base + 3 * MIN, 0.9],
  ]);
  assert.deepEqual(sessionsSeen(base + 100 * MIN, base + 200 * MIN), []);
});

test('runWithSessions: the route binds against every run of the store', () => {
  const a = twoRounds('a', { stop: true });
  const b = twoRounds('b', { at: T0 + 30_000 });
  const store = {
    list: () => [b, a],
    filesOf: (id) => [`/work/acme/.laneboard/run.jsonl`, `/state/runs/${id}.jsonl`],
  };
  let asked = null;
  const seen = (since, until) => { asked = [since, until]; return [ses('s1', '/work/acme', T0 + MIN, 1)]; };
  const out = runWithSessions(store, a, { seen, now: T0 + 60 * MIN });
  assert.deepEqual(asked, [T0, T0 + 30 * MIN], 'the sessions heard from while the run was active');
  assert.deepEqual(out.rounds[0].sessions.map((s) => [s.sessionId, s.maybe]), [['s1', true]], 'b works in the same dir then');
  const failing = runWithSessions(store, a, { seen: () => { throw new Error('db'); }, now: T0 });
  assert.deepEqual(failing.rounds.map((r) => r.sessions), [[], []]);
});

test('the run page lists a round\'s sessions with their cost, a guess shared with another run marked', () => {
  const rows = roundSessions({
    sessions: [
      { sessionId: '6f1c2a3b-0000-4000-8000-000000000001', name: null, usd: 0.9, how: 'cwd', maybe: false, cwd: '/work/acme' },
      { sessionId: 'abcdef0123', name: 'acme <b>', usd: null, how: 'id', maybe: true },
      'bare-id-from-fold', null, { sessionId: 7 },
    ],
  });
  assert.deepEqual(rows.map((r) => [r.label, r.cost, r.maybe]), [
    ['6f1c2a3b', '$0.90', false], ['acme <b>', '—', true], ['bare-id-', '—', false],
  ]);
  assert.match(rows[0].title, /by its dir and time · \/work\/acme/);
  assert.match(rows[1].title, /possibly: another run worked in this dir/);
  assert.deepEqual(roundSessions({}), []);
  withDom(() => {
    const run = twoRounds('a', { cwd: '/work/acme', stop: true });
    const bound = bindRuns([{ run, dirs: runDirs(run) }], [ses('6f1c2a3b-9', '/work/acme', T0 + MIN, 1.5)], T0);
    const page = renderRunPage(null, withSessions(run, bound), { status: 'ok' }, T0 + 60 * MIN);
    const cells = byClass(page, 'rn-tl-ses');
    assert.equal(cells.length, 2);
    const chips = byClass(cells[0], 'rn-tl-s');
    assert.equal(chips.length, 1);
    assert.equal(chips[0].textContent, '6f1c2a3b $1.50');
    assert.equal(chips[0].dataset.session, '6f1c2a3b-9');
    assert.equal(cells[1].textContent, '—');
  });
});
