// The `builder` column and PRAGMA user_version 0 -> 1 (fleet F7), on a temp
// SQLite file pre-seeded with the v0 schema and rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-db-builder-'));
const file = path.join(dir, 'v0.db');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// The v0 schema of the six history tables, as db.mjs created it before F7.
const V0 = [
  `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, session_id TEXT,
     session_name TEXT, type TEXT NOT NULL, subtype TEXT, payload TEXT)`,
  `CREATE INDEX events_ts ON events(ts DESC)`,
  `CREATE TABLE cost_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, session_name TEXT,
     session_id TEXT, usd REAL, tokens TEXT, lane TEXT)`,
  `CREATE TABLE markers (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, lane TEXT, session_name TEXT,
     kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, dismissed_at INTEGER)`,
  `CREATE TABLE rate_limit_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, five_hour_pct REAL,
     five_hour_resets_at INTEGER, seven_day_pct REAL, seven_day_resets_at INTEGER, source_session TEXT)`,
  `CREATE TABLE lane_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, job TEXT NOT NULL,
     lane TEXT NOT NULL, kind TEXT NOT NULL, step TEXT NOT NULL, ok INTEGER, detail TEXT)`,
  `CREATE TABLE pr_samples (ts INTEGER NOT NULL, lane TEXT NOT NULL, number INTEGER, state TEXT, is_draft INTEGER,
     checks_passed INTEGER, checks_failed INTEGER, checks_pending INTEGER)`,
];

function seedV0(target, { withIndex }) {
  const d = new DatabaseSync(target);
  for (const sql of V0) d.exec(sql);
  if (withIndex) d.exec(`CREATE UNIQUE INDEX markers_key ON markers(IFNULL(lane, ''), IFNULL(session_name, ''), text)`);
  d.prepare('INSERT INTO events(ts, session_name, type) VALUES(?, ?, ?)').run(1000, 'web', 'Stop');
  d.prepare('INSERT INTO cost_snapshots(ts, session_name, usd, tokens) VALUES(?, ?, ?, ?)').run(1000, 'web', 1.5, '{}');
  d.prepare('INSERT INTO lane_jobs(ts, job, lane, kind, step) VALUES(?, ?, ?, ?, ?)').run(1000, 'j1', 'pay', 'launch', 'done');
  d.prepare('INSERT INTO pr_samples(ts, lane) VALUES(?, ?)').run(1000, 'pay');
  d.prepare('INSERT INTO rate_limit_samples(ts) VALUES(?)').run(1000);
  const m = d.prepare('INSERT INTO markers(ts, lane, session_name, kind, text, source) VALUES(?, ?, ?, ?, ?, ?)');
  m.run(1000, 'pay', 'web', 'need', 'NEED-HUMAN: look', 'pane');
  m.run(1001, null, 'web', 'done', 'DONE', 'pane');
  if (!withIndex) {
    // Duplicates a v0 database without its unique index could hold.
    m.run(1002, 'pay', 'web', 'need', 'NEED-HUMAN: look', 'pane');
    m.run(1003, null, 'web', 'done', 'DONE', 'log');
  }
  return d;
}

const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all();
const indexes = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);

// The real module, pointed at the seeded file. Every import below this line
// sees this database (each test file is its own process).
seedV0(file, { withIndex: true }).close();
process.env.LANEBOARD_DB = file;
const db = await import('../server/db.mjs');
const { config } = await import('../server/config.mjs');
const markers = await import('../server/collector/markers.mjs');

test('opening a v0 file migrates it: user_version 1, builder column on all six tables', () => {
  assert.equal(config.dbPath, file);
  assert.equal(db.userVersion(), 1);
  for (const t of db.BUILDER_TABLES) {
    const c = cols(db.db, t).find((x) => x.name === 'builder');
    assert.ok(c, `${t}.builder`);
    assert.equal(c.notnull, 1);
    assert.equal(c.dflt_value, "''");
  }
  const ix = indexes(db.db);
  assert.ok(ix.includes('markers_key_b'));
  assert.ok(ix.includes('events_builder'));
  assert.ok(!ix.includes('markers_key'), 'the legacy marker key is dropped');
});

test('old rows survive with builder "" and read back as this builder', () => {
  assert.equal(db.db.prepare('SELECT COUNT(*) c FROM markers').get().c, 2);
  for (const t of db.BUILDER_TABLES) {
    assert.ok(db.db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE builder = ''`).get().c >= 1, t);
  }
  const ev = db.listEvents({ session: 'web' });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].builder, config.fleet.id);
  assert.ok(db.listMarkers().every((m) => m.builder === config.fleet.id));
});

test('the migration is idempotent: running it again changes nothing', () => {
  const before = db.db.prepare('SELECT COUNT(*) c FROM markers').get().c;
  db.migrate(db.db);
  db.migrate(db.db);
  assert.equal(db.userVersion(), 1);
  assert.equal(db.db.prepare('SELECT COUNT(*) c FROM markers').get().c, before);
  assert.ok(!indexes(db.db).includes('markers_key'), 'the legacy index is not re-created at version 1');
  assert.equal(cols(db.db, 'markers').filter((c) => c.name === 'builder').length, 1);
});

test('the same marker for builders "" and builder-b gives two rows; twice for one builder gives one', () => {
  const base = { lane: 'pay', sessionName: 'api', kind: 'blocked', text: 'BLOCKED: tests', source: 'pane' };
  assert.ok(db.addMarker(base));
  assert.equal(db.addMarker(base), null, 'same builder, same key');
  assert.ok(db.addMarker({ ...base, builder: 'builder-b' }));
  assert.equal(db.addMarker({ ...base, builder: 'builder-b' }), null);
  // This builder's own id is stored as '' and so is the same key as ''.
  assert.equal(db.addMarker({ ...base, builder: config.fleet.id }), null);
  const rows = db.db.prepare("SELECT builder FROM markers WHERE text = 'BLOCKED: tests' ORDER BY builder").all();
  assert.deepEqual(rows.map((r) => r.builder), ['', 'builder-b']);
});

test('listMarkers/listEvents filter by builder; null means every builder', () => {
  db.addEvent({ type: 'Stop', sessionName: 'remote', builder: 'builder-b' });
  assert.equal(db.listEvents({ session: 'remote' }).length, 0, 'default is this builder only');
  const b = db.listEvents({ session: 'remote', builder: 'builder-b' });
  assert.equal(b.length, 1);
  assert.equal(b[0].builder, 'builder-b');
  assert.equal(db.listEvents({ session: 'remote', builder: null }).length, 1);
  const own = db.listMarkers({ lane: 'pay' }).filter((m) => m.text === 'BLOCKED: tests');
  assert.equal(own.length, 1);
  assert.equal(db.listMarkers({ lane: 'pay', builder: 'builder-b' }).length, 1);
  assert.equal(db.listMarkers({ lane: 'pay', builder: null }).filter((m) => m.text === 'BLOCKED: tests').length, 2);
});

test('addCostSnapshot takes an optional builder', () => {
  db.addCostSnapshot({ sessionName: 'remote', sessionId: 'r1', usd: 2, tokens: {}, builder: 'builder-b' });
  db.addCostSnapshot({ sessionName: 'local', sessionId: 'l1', usd: 1, tokens: {} });
  const rows = db.db.prepare("SELECT session_name, builder FROM cost_snapshots WHERE session_name IN ('remote', 'local') ORDER BY session_name").all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ session_name: 'local', builder: '' }, { session_name: 'remote', builder: 'builder-b' }]);
});

test('markerKeys returns the builder, and the collector dedupes per builder', () => {
  const keys = db.markerKeys();
  assert.ok(keys.includes(markers.keyOf('pay', 'api', 'BLOCKED: tests', '')));
  assert.ok(keys.includes(markers.keyOf('pay', 'api', 'BLOCKED: tests', 'builder-b')));
  markers._reset?.();
  const rec = { lane: 'q', sessionName: 's', kind: 'need', text: 'NEED-HUMAN: q', source: 'pane' };
  assert.ok(markers.record(rec));
  assert.equal(markers.record(rec), null);
  assert.ok(markers.record({ ...rec, builder: 'builder-c' }));
  assert.equal(markers.record({ ...rec, builder: 'builder-c' }), null);
});

test('a v0 file without its unique index and with duplicate markers migrates, keeping the oldest', () => {
  const f2 = path.join(dir, 'dupes.db');
  const d = seedV0(f2, { withIndex: false });
  assert.equal(d.prepare('SELECT COUNT(*) c FROM markers').get().c, 4);
  db.migrate(d);
  assert.equal(db.userVersion(d), 1);
  const rows = d.prepare('SELECT ts, builder FROM markers ORDER BY ts').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ ts: 1000, builder: '' }, { ts: 1001, builder: '' }]);
  db.migrate(d);
  assert.equal(d.prepare('SELECT COUNT(*) c FROM markers').get().c, 2);
  d.close();
});
