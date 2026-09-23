// SQLite via node:sqlite. Events, cost snapshots, push subscriptions, kv.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';
import { log } from './log.mjs';

const inMemory = config.dbPath === ':memory:';
if (!inMemory) fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

// WAL is pointless for an in-memory database and errors on some builds.
if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA busy_timeout = 3000');

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     session_id TEXT,
     session_name TEXT,
     type TEXT NOT NULL,
     subtype TEXT,
     payload TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS events_ts ON events(ts DESC)`,
  `CREATE INDEX IF NOT EXISTS events_session ON events(session_name, ts DESC)`,
  `CREATE TABLE IF NOT EXISTS cost_snapshots (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     session_name TEXT,
     session_id TEXT,
     usd REAL,
     tokens TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS cost_ts ON cost_snapshots(ts DESC)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
     endpoint TEXT PRIMARY KEY,
     subscription TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_ok_at INTEGER,
     user_agent TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS kv (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS markers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     lane TEXT,
     session_name TEXT,
     kind TEXT NOT NULL,
     text TEXT NOT NULL,
     source TEXT NOT NULL,
     dismissed_at INTEGER
   )`,
  // The same marker is re-read from the pane on every tick and from the watch
  // log every minute, so the key is what stops it multiplying. IFNULL is not
  // optional: SQLite treats two NULLs as distinct in a UNIQUE index, so a
  // session with no lane would insert a fresh row every two seconds.
  `CREATE UNIQUE INDEX IF NOT EXISTS markers_key
     ON markers(IFNULL(lane, ''), IFNULL(session_name, ''), text)`,
  `CREATE INDEX IF NOT EXISTS markers_ts ON markers(ts DESC)`,
  `CREATE TABLE IF NOT EXISTS rate_limit_samples (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     five_hour_pct REAL,
     five_hour_resets_at INTEGER,
     seven_day_pct REAL,
     seven_day_resets_at INTEGER,
     source_session TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS rate_limit_ts ON rate_limit_samples(ts DESC)`,
  // v2's Files feature. Removed in v3; the table stays, unused, because a
  // migration is never edited.
  `CREATE TABLE IF NOT EXISTS filings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     original_name TEXT NOT NULL,
     size INTEGER,
     mime TEXT,
     from_path TEXT,
     to_path TEXT,
     folder_created TEXT,
     reason TEXT,
     model TEXT,
     overridden_to TEXT,
     overridden_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS filings_ts ON filings(ts DESC)`,
  `CREATE TABLE IF NOT EXISTS transcript_offsets (
     path TEXT PRIMARY KEY,
     offset INTEGER NOT NULL,
     session_id TEXT,
     seen_ids TEXT,
     usage TEXT,
     updated_at INTEGER NOT NULL
   )`,
  // v3. One row per step of a launch or retire; `job` groups them (an
  // addition to the plan's columns, so the 202 has something to hand back).
  `CREATE TABLE IF NOT EXISTS lane_jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     job TEXT NOT NULL,
     lane TEXT NOT NULL,
     kind TEXT NOT NULL,
     step TEXT NOT NULL,
     ok INTEGER,
     detail TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS lane_jobs_job ON lane_jobs(job, id)`,
  `CREATE INDEX IF NOT EXISTS lane_jobs_lane ON lane_jobs(lane, ts DESC)`,
  // v3. A row only when a lane's PR state changes.
  `CREATE TABLE IF NOT EXISTS pr_samples (
     ts INTEGER NOT NULL,
     lane TEXT NOT NULL,
     number INTEGER,
     state TEXT,
     is_draft INTEGER,
     checks_passed INTEGER,
     checks_failed INTEGER,
     checks_pending INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS pr_samples_lane ON pr_samples(lane, ts DESC)`,
];

for (const sql of MIGRATIONS) db.exec(sql);

/**
 * Add a column to an existing table, once. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, and the migration list is append-only and must
 * stay re-runnable, so the guard is a PRAGMA rather than a caught exception.
 */
function addColumn(table, column, decl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// Which lane a snapshot's spend belongs to. Rows written before this existed
// keep NULL and are attributed by session name at query time instead.
addColumn('cost_snapshots', 'lane', 'TEXT');

// --- kv ---------------------------------------------------------------------

const kvGet = db.prepare('SELECT value FROM kv WHERE key = ?');
const kvSet = db.prepare(
  'INSERT INTO kv(key, value, updated_at) VALUES(?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
);

export function kvRead(key, fallback = null) {
  const row = kvGet.get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
export function kvWrite(key, value) {
  kvSet.run(key, JSON.stringify(value), Date.now());
}

// --- events -----------------------------------------------------------------

const insertEvent = db.prepare(
  'INSERT INTO events(ts, session_id, session_name, type, subtype, payload) VALUES(?, ?, ?, ?, ?, ?)'
);

export function addEvent({ ts = Date.now(), sessionId = null, sessionName = null, type, subtype = null, payload = null }) {
  try {
    insertEvent.run(ts, sessionId, sessionName, type, subtype, payload == null ? null : JSON.stringify(payload));
  } catch (err) {
    log.error('addEvent failed', String(err));
  }
}

export function listEvents({ session = null, limit = 50, before = null, type = null } = {}) {
  const where = [];
  const args = [];
  if (session) { where.push('session_name = ?'); args.push(session); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (before) { where.push('ts < ?'); args.push(Number(before)); }
  const sql =
    'SELECT id, ts, session_id, session_name, type, subtype, payload FROM events' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY ts DESC, id DESC LIMIT ?';
  args.push(Math.min(Number(limit) || 50, 500));
  return db.prepare(sql).all(...args).map((r) => ({
    ...r,
    payload: r.payload ? safeParse(r.payload) : null,
  }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- cost snapshots ---------------------------------------------------------

const insertSnapshot = db.prepare(
  'INSERT INTO cost_snapshots(ts, session_name, session_id, usd, tokens, lane) VALUES(?, ?, ?, ?, ?, ?)'
);
export function addCostSnapshot({ ts = Date.now(), sessionName, sessionId, usd, tokens, lane = null }) {
  insertSnapshot.run(ts, sessionName ?? null, sessionId ?? null, usd ?? 0, JSON.stringify(tokens ?? {}), lane);
}

/**
 * Every snapshot at or after `since`, plus the last one BEFORE it per session.
 * The earlier row is the baseline: a session's cost is cumulative, so what it
 * spent in a window is the last value in the window minus the last value
 * before it. Without the baseline, a session that was already running looks
 * like it spent its whole lifetime total tonight.
 */
export function costRowsForWindow(since) {
  return db.prepare(
    `SELECT ts, session_name, session_id, usd, tokens, lane FROM cost_snapshots
      WHERE ts >= ?
      UNION ALL
      SELECT ts, session_name, session_id, usd, tokens, lane FROM cost_snapshots c
      WHERE ts = (SELECT MAX(ts) FROM cost_snapshots
                   WHERE IFNULL(session_name, session_id) IS IFNULL(c.session_name, c.session_id)
                     AND ts < ?)
      ORDER BY ts`
  ).all(Number(since), Number(since)).map((r) => ({ ...r, tokens: safeParse(r.tokens) }));
}

/** Latest snapshot at or before `ts` per session — the basis for usdToday. */
export function snapshotsAt(ts) {
  return db
    .prepare(
      `SELECT session_name, session_id, usd, tokens, ts FROM cost_snapshots c
       WHERE ts = (SELECT MAX(ts) FROM cost_snapshots WHERE session_name IS c.session_name AND ts <= ?)`
    )
    .all(ts)
    .map((r) => ({ ...r, tokens: safeParse(r.tokens) }));
}

// --- transcript offsets -----------------------------------------------------

const getOffset = db.prepare('SELECT offset, seen_ids, usage, session_id FROM transcript_offsets WHERE path = ?');
const setOffset = db.prepare(
  'INSERT INTO transcript_offsets(path, offset, session_id, seen_ids, usage, updated_at) VALUES(?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(path) DO UPDATE SET offset = excluded.offset, session_id = excluded.session_id, ' +
    'seen_ids = excluded.seen_ids, usage = excluded.usage, updated_at = excluded.updated_at'
);

export function readOffset(path) {
  const row = getOffset.get(path);
  if (!row) return null;
  return { offset: row.offset, seenIds: safeParse(row.seen_ids) || [], usage: safeParse(row.usage) || null, sessionId: row.session_id };
}
export function writeOffset(path, { offset, seenIds, usage, sessionId }) {
  setOffset.run(path, offset, sessionId ?? null, JSON.stringify(seenIds ?? []), JSON.stringify(usage ?? null), Date.now());
}

// --- push subscriptions -----------------------------------------------------

export function addSubscription(sub, userAgent = null) {
  db.prepare(
    'INSERT INTO push_subscriptions(endpoint, subscription, created_at, user_agent) VALUES(?, ?, ?, ?) ' +
      'ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription'
  ).run(sub.endpoint, JSON.stringify(sub), Date.now(), userAgent);
}
export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}
export function listSubscriptions() {
  return db.prepare('SELECT endpoint, subscription FROM push_subscriptions').all()
    .map((r) => ({ endpoint: r.endpoint, sub: safeParse(r.subscription) }))
    .filter((r) => r.sub);
}
export function markSubscriptionOk(endpoint) {
  db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?').run(Date.now(), endpoint);
}

// --- retention --------------------------------------------------------------

export function pruneOldRows() {
  const cutoff = Date.now() - config.eventRetentionDays * 24 * 3600 * 1000;
  try {
    const e = db.prepare('DELETE FROM events WHERE ts < ?').run(cutoff);
    const c = db.prepare('DELETE FROM cost_snapshots WHERE ts < ?').run(cutoff);
    const m = db.prepare('DELETE FROM markers WHERE ts < ?').run(cutoff);
    const rl = db.prepare('DELETE FROM rate_limit_samples WHERE ts < ?').run(cutoff);
    if (e.changes || c.changes || m.changes || rl.changes) {
      log.info(
        `retention: pruned ${e.changes} events, ${c.changes} cost snapshots, ` +
        `${m.changes} markers, ${rl.changes} rate-limit samples`
      );
    }
  } catch (err) {
    log.error('retention prune failed', String(err));
  }
}

export function startRetention() {
  pruneOldRows();
  const timer = setInterval(pruneOldRows, 24 * 3600 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

export function close() {
  try { db.close(); } catch { /* already closed */ }
}

// --- markers ----------------------------------------------------------------

const insertMarker = db.prepare(
  'INSERT OR IGNORE INTO markers(ts, lane, session_name, kind, text, source) VALUES(?, ?, ?, ?, ?, ?)'
);

/**
 * Record a marker. Returns the new row id, or null when the key already
 * existed — which is how the caller knows whether to push a notification.
 */
export function addMarker({ ts = Date.now(), lane = null, sessionName = null, kind, text, source }) {
  try {
    const r = insertMarker.run(ts, lane, sessionName, kind, text, source);
    return r.changes ? Number(r.lastInsertRowid) : null;
  } catch (err) {
    log.error('addMarker failed', String(err));
    return null;
  }
}

/** Every marker key already stored, so a re-scan need not ask SQLite per line. */
export function markerKeys() {
  const sql = "SELECT IFNULL(lane, '') AS lane, IFNULL(session_name, '') AS s, text FROM markers";
  return db.prepare(sql).all().map((r) => `${r.lane}\u0000${r.s}\u0000${r.text}`);
}

export function listMarkers({ lane = null, since = null, kinds = null, limit = 200, includeDismissed = false } = {}) {
  const where = [];
  const args = [];
  if (lane) { where.push('lane = ?'); args.push(lane); }
  if (since) { where.push('ts >= ?'); args.push(Number(since)); }
  if (kinds?.length) {
    where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    args.push(...kinds);
  }
  if (!includeDismissed) where.push('dismissed_at IS NULL');
  const sql =
    'SELECT id, ts, lane, session_name, kind, text, source, dismissed_at FROM markers' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY ts DESC, id DESC LIMIT ?';
  args.push(Math.min(Number(limit) || 200, 1000));
  return db.prepare(sql).all(...args);
}

/** Dismiss is a tombstone, never a delete: the marker still happened. */
export function dismissMarker(id) {
  const r = db.prepare('UPDATE markers SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL')
    .run(Date.now(), Number(id));
  return r.changes > 0;
}

// --- rate limit samples -----------------------------------------------------

const insertRateLimit = db.prepare(
  `INSERT INTO rate_limit_samples(ts, five_hour_pct, five_hour_resets_at,
     seven_day_pct, seven_day_resets_at, source_session) VALUES(?, ?, ?, ?, ?, ?)`
);

export function addRateLimitSample({ ts = Date.now(), fiveHourPct, fiveHourResetsAt, sevenDayPct, sevenDayResetsAt, sourceSession }) {
  try {
    insertRateLimit.run(ts, fiveHourPct ?? null, fiveHourResetsAt ?? null,
      sevenDayPct ?? null, sevenDayResetsAt ?? null, sourceSession ?? null);
  } catch (err) {
    log.error('addRateLimitSample failed', String(err));
  }
}

/** When the last cost snapshot was taken, or 0. */
export function lastCostSnapshotAt() {
  return db.prepare('SELECT MAX(ts) t FROM cost_snapshots').get()?.t ?? 0;
}

export function lastRateLimitSample() {
  return db.prepare('SELECT * FROM rate_limit_samples ORDER BY ts DESC LIMIT 1').get() ?? null;
}

export function countRateLimitSamples() {
  return db.prepare('SELECT COUNT(*) c FROM rate_limit_samples').get().c;
}

export function rateLimitSamples({ since = 0, limit = 5000 } = {}) {
  return db.prepare(
    'SELECT ts, five_hour_pct, five_hour_resets_at, seven_day_pct, seven_day_resets_at, source_session' +
    ' FROM rate_limit_samples WHERE ts >= ? ORDER BY ts ASC LIMIT ?'
  ).all(Number(since) || 0, Math.min(Number(limit) || 5000, 20000));
}

// --- lane jobs (v3) -----------------------------------------------------------

const insertJobStep = db.prepare(
  'INSERT INTO lane_jobs(ts, job, lane, kind, step, ok, detail) VALUES(?, ?, ?, ?, ?, ?, ?)'
);

/** ok: true / false / null (in progress). detail: any JSON-able value. */
export function addJobStep({ ts = Date.now(), job, lane, kind, step, ok = null, detail = null }) {
  const r = insertJobStep.run(ts, job, lane, kind, step, ok == null ? null : ok ? 1 : 0,
    detail == null ? null : JSON.stringify(detail));
  return Number(r.lastInsertRowid);
}

const jobRow = (r) => ({
  ...r,
  ok: r.ok == null ? null : Boolean(r.ok),
  detail: r.detail == null ? null : (() => { try { return JSON.parse(r.detail); } catch { return r.detail; } })(),
});

export function jobSteps(job) {
  return db.prepare('SELECT * FROM lane_jobs WHERE job = ? ORDER BY id').all(String(job)).map(jobRow);
}

/** The newest job per lane, or for one lane, as { job, lane, kind, steps[] }. */
export function latestJobs({ lane = null } = {}) {
  const heads = lane
    ? db.prepare('SELECT job FROM lane_jobs WHERE lane = ? ORDER BY id DESC LIMIT 1').all(lane)
    : db.prepare('SELECT job FROM lane_jobs WHERE id IN (SELECT MAX(id) FROM lane_jobs GROUP BY lane)').all();
  return heads.map(({ job }) => {
    const steps = jobSteps(job);
    return { job, lane: steps[0]?.lane, kind: steps[0]?.kind, steps };
  });
}

/** Jobs whose last step is neither `done` nor `failed` nor `interrupted`. */
export function unfinishedJobs() {
  return latestJobs().filter((j) => !['done', 'failed', 'interrupted'].includes(j.steps.at(-1)?.step));
}

// --- pr samples (v3) ----------------------------------------------------------

const insertPrSample = db.prepare(
  'INSERT INTO pr_samples(ts, lane, number, state, is_draft, checks_passed, checks_failed, checks_pending) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
);

/** Called only when a lane's PR state changed (collector/pr.mjs decides). */
export function addPrSample({ ts = Date.now(), lane, number, state, isDraft, checks }) {
  insertPrSample.run(ts, lane, number ?? null, state ?? null, isDraft ? 1 : 0,
    checks?.passed ?? 0, checks?.failed ?? 0, checks?.pending ?? 0);
}

export function listPrSamples({ lane = null, limit = 100 } = {}) {
  const sql = 'SELECT * FROM pr_samples' + (lane ? ' WHERE lane = ?' : '') + ' ORDER BY ts DESC LIMIT ?';
  const args = lane ? [lane, Math.min(Number(limit) || 100, 1000)] : [Math.min(Number(limit) || 100, 1000)];
  return db.prepare(sql).all(...args);
}
