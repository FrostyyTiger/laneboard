// runs-n4 T7: the run page's sessionsSeen must not walk the whole events
// table. Two indexes on (builder, ts, session_id) and (builder, session_id, ts)
// serve its window lookup and its per-session reads; the rows it returns are
// the same as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, migrate, addEvent, addCostSnapshot, sessionsSeen } from '../server/db.mjs';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);

// The SQL sessionsSeen ran before T7, kept here as the reference for its rows.
const OLD = `SELECT session_id, MAX(session_name) AS name, MIN(ts) AS first_at, MAX(ts) AS last_at,
            (SELECT json_extract(e2.payload, '$.cwd') FROM events e2
              WHERE e2.session_id = e.session_id AND e2.builder = ?
                AND json_extract(e2.payload, '$.cwd') IS NOT NULL
              ORDER BY e2.ts ASC, e2.id ASC LIMIT 1) AS cwd
       FROM events e
      WHERE e.builder = ? AND e.session_id IN (
        SELECT DISTINCT session_id FROM events
         WHERE builder = ? AND session_id IS NOT NULL AND ts >= ? AND ts <= ?)
      GROUP BY e.session_id
      ORDER BY first_at ASC
      LIMIT ?`;

const indexes = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'").all().map((r) => r.name);

test('the migration creates both indexes, and running it again is harmless', () => {
  assert.ok(indexes().includes('events_builder_ts'));
  assert.ok(indexes().includes('events_builder_sid'));
  migrate(db);
  assert.equal(indexes().filter((n) => n.startsWith('events_builder_')).length, 2);
});

test('the query plan seeks by index and never scans events', () => {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${OLD}`).all('', '', '', T0, T0 + MIN, 10).map((r) => r.detail);
  const text = plan.join('\n');
  // Loose matches: SQLite's plan wording may change between releases.
  assert.match(text, /USING (COVERING )?INDEX events_builder_ts \(builder=\? AND ts>\? AND ts<\?\)/, text);
  assert.match(text, /USING (COVERING )?INDEX events_builder_sid \(builder=\? AND session_id=\?\)/, text);
  assert.ok(!plan.some((d) => /^SCAN e(vents|2)?\b/.test(d)), text);
});

test('sessionsSeen returns the same rows as the old query on several sessions', () => {
  const base = T0 + 5000 * MIN;
  for (let s = 0; s < 6; s++) {
    for (let i = 0; i < 5; i++) {
      addEvent({
        ts: base + (s * 7 + i * 3 - 10) * MIN,
        sessionId: `seen-${s}`,
        sessionName: i === 2 ? `lane-${s}` : null,
        type: 'hook',
        payload: { cwd: i === 0 && s % 2 ? null : `/work/acme/${s}/${i}` },
      });
    }
    if (s % 3 === 0) addCostSnapshot({ ts: base + s * MIN, sessionId: `seen-${s}`, sessionName: `lane-${s}`, usd: s + 0.5 });
  }
  // Another builder's events and an event without a session stay out.
  addEvent({ ts: base + MIN, sessionId: 'seen-0', type: 'hook', payload: { cwd: '/elsewhere' }, builder: 'builder-b' });
  addEvent({ ts: base + 2 * MIN, sessionId: 'remote-1', type: 'hook', builder: 'builder-b' });
  addEvent({ ts: base + 3 * MIN, sessionId: null, type: 'hook', payload: { cwd: '/work/acme' } });

  const since = base;
  const until = base + 20 * MIN;
  const old = db.prepare(OLD).all('', '', '', since, until, 2000);
  const got = sessionsSeen(since, until);
  assert.ok(got.length >= 3, 'the fixture spans several sessions');
  assert.deepEqual(got.map((s) => [s.sessionId, s.name, s.cwd, s.firstAt, s.lastAt]),
    old.map((r) => [r.session_id, r.name, r.cwd, r.first_at, r.last_at]));
  assert.ok(!got.some((s) => s.sessionId === 'remote-1'));
  assert.equal(got.find((s) => s.sessionId === 'seen-0').cwd, '/work/acme/0/0');
  assert.equal(got.find((s) => s.sessionId === 'seen-0').usd, 0.5);
});
