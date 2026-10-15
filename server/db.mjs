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
  //
  // Fleet F7: the one sanctioned edit to this append-only list. From schema
  // version 1 the key also holds `builder` (index markers_key_b, created by
  // migrateToV1 below), so this legacy index must not be re-created on every
  // start once the database is at version 1: it carries `untilVersion`.
  {
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS markers_key
     ON markers(IFNULL(lane, ''), IFNULL(session_name, ''), text)`,
    untilVersion: 1,
  },
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
  // fleet P9 (§6 2.4). The jobs of a completed CI run never change, so they are
  // read from the forge once per (run, attempt) and kept here. A cache, not
  // history: builder-local, no `builder` column, no user_version bump (the
  // CREATE is re-runnable like every entry above).
  `CREATE TABLE IF NOT EXISTS ci_jobs (
     run_id INTEGER NOT NULL,
     attempt INTEGER NOT NULL,
     slug TEXT NOT NULL,
     json TEXT NOT NULL,
     at INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY(run_id, attempt)
   )`,
  // fleet R9 (§10 2.9). One row per retired lane, written by retire (captured
  // before the worktree goes) or by the startup backfill. Never pruned: it
  // keeps its own copy of the markers so it outlives marker retention.
  // Builder-local like ci_jobs: no `builder` column, no user_version bump.
  `CREATE TABLE IF NOT EXISTS lane_archive (
     lane TEXT PRIMARY KEY, repo TEXT, branch TEXT, plan_path TEXT, plan_title TEXT, plan_head TEXT,
     created_at INTEGER, retired_at INTEGER NOT NULL, duration_ms INTEGER,
     cost_usd REAL, tokens INTEGER, stage_n INTEGER, stage_m INTEGER,
     pr_number INTEGER, pr_url TEXT, pr_state TEXT, merged INTEGER,
     markers TEXT, summary TEXT, record TEXT, restored_as TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS lane_archive_retired ON lane_archive(retired_at DESC)`,
];

/** The schema version this file migrates to (`PRAGMA user_version`). */
export const SCHEMA_VERSION = 1;

/** Tables that carry a `builder` column from schema version 1 (fleet F7). */
export const BUILDER_TABLES = ['events', 'cost_snapshots', 'markers', 'lane_jobs', 'pr_samples', 'rate_limit_samples'];

export function userVersion(database = db) {
  return Number(database.prepare('PRAGMA user_version').get()?.user_version ?? 0);
}

/**
 * Add a column to an existing table, once. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, and the migration list is append-only and must
 * stay re-runnable, so the guard is a PRAGMA rather than a caught exception.
 */
function addColumn(table, column, decl, database = db) {
  const has = database.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

/**
 * Schema 0 -> 1 (fleet F7): a `builder` column on the six history tables.
 * `''` means this process's own builder, resolved at read time to
 * config.fleet.id, so renaming fleet.id never orphans a row. The marker key
 * becomes builder-aware. One transaction: a crash half way leaves version 0,
 * and every step is re-runnable.
 */
function migrateToV1(database) {
  database.exec('BEGIN');
  try {
    for (const t of BUILDER_TABLES) addColumn(t, 'builder', "TEXT NOT NULL DEFAULT ''", database);
    database.exec('DROP INDEX IF EXISTS markers_key');
    // A v0 database that somehow lost its unique index may hold duplicates;
    // keep the oldest row of each key, or the new unique index cannot be built.
    database.exec(`DELETE FROM markers WHERE id NOT IN (
      SELECT MIN(id) FROM markers GROUP BY builder, IFNULL(lane, ''), IFNULL(session_name, ''), text)`);
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS markers_key_b
      ON markers(builder, IFNULL(lane, ''), IFNULL(session_name, ''), text)`);
    database.exec('CREATE INDEX IF NOT EXISTS events_builder ON events(builder, session_name, ts DESC)');
    database.exec('PRAGMA user_version = 1');
    database.exec('COMMIT');
  } catch (err) {
    try { database.exec('ROLLBACK'); } catch { /* nothing open */ }
    throw err;
  }
}

/** Run every migration against `database`. Exported for the migration test. */
export function migrate(database = db) {
  const version = userVersion(database);
  for (const m of MIGRATIONS) {
    const sql = typeof m === 'string' ? m : m.sql;
    if (typeof m === 'object' && m.untilVersion != null) {
      if (version >= m.untilVersion) continue;
      // About to be replaced by a later version: a failure here (a v0 database
      // with duplicate rows) must not stop the migration that fixes it.
      try { database.exec(sql); } catch (err) { log.warn(`legacy migration skipped: ${String(err)}`); }
      continue;
    }
    database.exec(sql);
  }
  // Which lane a snapshot's spend belongs to. Rows written before this existed
  // keep NULL and are attributed by session name at query time instead.
  addColumn('cost_snapshots', 'lane', 'TEXT', database);
  if (version < 1) migrateToV1(database);
}

migrate(db);

/** `''` (and this builder's own id) are stored as `''`; another id as itself. */
function storedBuilder(builder) {
  if (builder == null || builder === '' || builder === config.fleet?.id) return '';
  return String(builder);
}
/** A row's stored builder, resolved: `''` is this process's own builder. */
function resolvedBuilder(stored) {
  return stored ? stored : (config.fleet?.id ?? '');
}
/** WHERE fragment for an optional builder filter; `null` means every builder. */
function builderWhere(builder, where, args) {
  if (builder === null) return;
  where.push('builder = ?');
  args.push(storedBuilder(builder));
}

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
  'INSERT INTO events(ts, session_id, session_name, type, subtype, payload, builder) VALUES(?, ?, ?, ?, ?, ?, ?)'
);

export function addEvent({ ts = Date.now(), sessionId = null, sessionName = null, type, subtype = null, payload = null, builder = '' }) {
  try {
    insertEvent.run(ts, sessionId, sessionName, type, subtype, payload == null ? null : JSON.stringify(payload), storedBuilder(builder));
  } catch (err) {
    log.error('addEvent failed', String(err));
  }
}

/** `builder`: '' (default) = this builder's rows, an id = that builder's, null = all. */
export function listEvents({ session = null, limit = 50, before = null, type = null, builder = '' } = {}) {
  const where = [];
  const args = [];
  builderWhere(builder, where, args);
  if (session) { where.push('session_name = ?'); args.push(session); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (before) { where.push('ts < ?'); args.push(Number(before)); }
  const sql =
    'SELECT id, ts, session_id, session_name, type, subtype, payload, builder FROM events' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY ts DESC, id DESC LIMIT ?';
  args.push(Math.min(Number(limit) || 50, 500));
  return db.prepare(sql).all(...args).map((r) => ({
    ...r,
    builder: resolvedBuilder(r.builder),
    payload: r.payload ? safeParse(r.payload) : null,
  }));
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

// --- cost snapshots ---------------------------------------------------------

const insertSnapshot = db.prepare(
  'INSERT INTO cost_snapshots(ts, session_name, session_id, usd, tokens, lane, builder) VALUES(?, ?, ?, ?, ?, ?, ?)'
);
export function addCostSnapshot({ ts = Date.now(), sessionName, sessionId, usd, tokens, lane = null, builder = '' }) {
  insertSnapshot.run(ts, sessionName ?? null, sessionId ?? null, usd ?? 0, JSON.stringify(tokens ?? {}), lane, storedBuilder(builder));
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
  'INSERT OR IGNORE INTO markers(ts, lane, session_name, kind, text, source, builder) VALUES(?, ?, ?, ?, ?, ?, ?)'
);

/**
 * Record a marker. Returns the new row id, or null when the key already
 * existed — which is how the caller knows whether to push a notification.
 */
export function addMarker({ ts = Date.now(), lane = null, sessionName = null, kind, text, source, builder = '' }) {
  try {
    const r = insertMarker.run(ts, lane, sessionName, kind, text, source, storedBuilder(builder));
    return r.changes ? Number(r.lastInsertRowid) : null;
  } catch (err) {
    log.error('addMarker failed', String(err));
    return null;
  }
}

/**
 * Every marker key already stored, so a re-scan need not ask SQLite per line.
 * `builder\0lane\0session\0text`, builder as stored ('' = this builder),
 * matching collector/markers.mjs keyOf().
 */
export function markerKeys() {
  const sql = "SELECT builder, IFNULL(lane, '') AS lane, IFNULL(session_name, '') AS s, text FROM markers";
  return db.prepare(sql).all().map((r) => `${r.builder}\u0000${r.lane}\u0000${r.s}\u0000${r.text}`);
}

/** `builder`: '' (default) = this builder's rows, an id = that builder's, null = all. */
export function listMarkers({ lane = null, since = null, kinds = null, limit = 200, includeDismissed = false, builder = '' } = {}) {
  const where = [];
  const args = [];
  builderWhere(builder, where, args);
  if (lane) { where.push('lane = ?'); args.push(lane); }
  if (since) { where.push('ts >= ?'); args.push(Number(since)); }
  if (kinds?.length) {
    where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    args.push(...kinds);
  }
  if (!includeDismissed) where.push('dismissed_at IS NULL');
  const sql =
    'SELECT id, ts, lane, session_name, kind, text, source, dismissed_at, builder FROM markers' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY ts DESC, id DESC LIMIT ?';
  args.push(Math.min(Number(limit) || 200, 1000));
  return db.prepare(sql).all(...args).map((r) => ({ ...r, builder: resolvedBuilder(r.builder) }));
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

// --- ci jobs (fleet P9) ---------------------------------------------------------

const getCiJobs = db.prepare('SELECT slug, json FROM ci_jobs WHERE run_id = ? AND attempt = ?');
const putCiJobs = db.prepare(
  'INSERT INTO ci_jobs(run_id, attempt, slug, json, at) VALUES(?, ?, ?, ?, ?) ' +
    'ON CONFLICT(run_id, attempt) DO UPDATE SET slug = excluded.slug, json = excluded.json, at = excluded.at'
);

/**
 * The cached jobs of a completed run, or null. A row stored under another
 * slug is not this run (run ids are global on GitHub, but a cache must never
 * hand one repo another repo's data).
 */
export function ciJobsGet({ runId, attempt = 1, slug }) {
  try {
    const r = getCiJobs.get(Number(runId), Number(attempt) || 1);
    if (!r || r.slug !== String(slug)) return null;
    const jobs = JSON.parse(r.json);
    return Array.isArray(jobs) ? jobs : null;
  } catch (err) {
    log.error('ciJobsGet failed', String(err));
    return null;
  }
}

/** Keep the jobs of a completed run (the collector calls this only once it completed). */
export function ciJobsPut({ runId, attempt = 1, slug, jobs, at = Date.now() }) {
  if (!Number.isSafeInteger(Number(runId)) || !Array.isArray(jobs) || typeof slug !== 'string' || !slug) return false;
  try {
    putCiJobs.run(Number(runId), Number(attempt) || 1, slug, JSON.stringify(jobs), at);
    return true;
  } catch (err) {
    log.error('ciJobsPut failed', String(err));
    return false;
  }
}

// --- lane archive (fleet R9) ---------------------------------------------------

export const ARCHIVE_COLUMNS = Object.freeze([
  'lane', 'repo', 'branch', 'plan_path', 'plan_title', 'plan_head', 'created_at', 'retired_at', 'duration_ms',
  'cost_usd', 'tokens', 'stage_n', 'stage_m', 'pr_number', 'pr_url', 'pr_state', 'merged',
  'markers', 'summary', 'record', 'restored_as',
]);
/** What a listing returns: everything but the bulky plan head, markers and record. */
export const ARCHIVE_LIST_COLUMNS = Object.freeze(
  ARCHIVE_COLUMNS.filter((c) => !['plan_head', 'markers', 'record'].includes(c)),
);
export const ARCHIVE_LIST_MAX = 200;

const archiveUpsert = db.prepare(
  `INSERT INTO lane_archive(${ARCHIVE_COLUMNS.join(', ')}) VALUES(${ARCHIVE_COLUMNS.map(() => '?').join(', ')}) ` +
    `ON CONFLICT(lane) DO UPDATE SET ${ARCHIVE_COLUMNS.filter((c) => c !== 'lane' && c !== 'restored_as')
      .map((c) => `${c} = excluded.${c}`).join(', ')}, restored_as = IFNULL(excluded.restored_as, lane_archive.restored_as)`
);

const intOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const strOrNull = (v) => (v == null ? null : String(v));
const jsonOrNull = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Upsert one archive row. `markers` and `record` may be objects (stored as
 * JSON). A re-archive never clears `restored_as`. Returns true when written.
 */
export function addArchive(row) {
  if (!row || typeof row.lane !== 'string' || !row.lane || !Number.isFinite(Number(row.retired_at))) {
    throw new Error('addArchive needs lane and retired_at');
  }
  const merged = row.merged == null ? null : row.merged ? 1 : 0;
  archiveUpsert.run(
    row.lane, strOrNull(row.repo), strOrNull(row.branch), strOrNull(row.plan_path), strOrNull(row.plan_title),
    strOrNull(row.plan_head), intOrNull(row.created_at), Math.trunc(Number(row.retired_at)), intOrNull(row.duration_ms),
    numOrNull(row.cost_usd), intOrNull(row.tokens), intOrNull(row.stage_n), intOrNull(row.stage_m),
    intOrNull(row.pr_number), strOrNull(row.pr_url), strOrNull(row.pr_state), merged,
    jsonOrNull(row.markers), strOrNull(row.summary), jsonOrNull(row.record), strOrNull(row.restored_as),
  );
  return true;
}

/** `%` and `_` (and the escape itself) match literally. */
export function likeEscape(q) {
  return String(q).replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Newest first. `q` searches lane, branch, repo, plan_title and summary; `before` is a retired_at bound. */
export function listArchive({ q = null, limit = 50, before = null } = {}) {
  const where = [];
  const args = [];
  if (q != null && String(q) !== '') {
    const pat = `%${likeEscape(q)}%`;
    where.push(`(${['lane', 'branch', 'repo', 'plan_title', 'summary'].map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    args.push(pat, pat, pat, pat, pat);
  }
  if (before != null && Number.isFinite(Number(before))) { where.push('retired_at < ?'); args.push(Number(before)); }
  const n = Math.max(1, Math.min(Math.trunc(Number(limit)) || 50, ARCHIVE_LIST_MAX));
  const sql = `SELECT ${ARCHIVE_LIST_COLUMNS.join(', ')} FROM lane_archive` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY retired_at DESC, lane ASC LIMIT ?';
  return db.prepare(sql).all(...args, n).map((r) => ({ ...r, merged: r.merged == null ? null : Boolean(r.merged) }));
}

/** One full row, `markers` and `record` parsed, or null. */
export function getArchive(lane) {
  const r = db.prepare(`SELECT ${ARCHIVE_COLUMNS.join(', ')} FROM lane_archive WHERE lane = ?`).get(String(lane));
  if (!r) return null;
  const markers = r.markers ? safeParse(r.markers) : null;
  return {
    ...r,
    merged: r.merged == null ? null : Boolean(r.merged),
    markers: Array.isArray(markers) ? markers : [],
    record: r.record ? safeParse(r.record) : null,
  };
}

/** Every archived lane id (the backfill's "already has a row" test). */
export function archivedLanes() {
  return new Set(db.prepare('SELECT lane FROM lane_archive').all().map((r) => r.lane));
}

/** Record which lane restored this one. False when there is no row. */
export function setRestoredAs(lane, newId) {
  return db.prepare('UPDATE lane_archive SET restored_as = ? WHERE lane = ?').run(String(newId), String(lane)).changes > 0;
}

/**
 * A lane's whole-life spend: snapshots are cumulative per transcript, so the
 * cost is the sum over sessions (name + id) of each one's MAX(usd), over rows
 * attributed to the lane or written by one of its session names. Tokens are
 * summed from each session's newest row. -> { usd, tokens, sessions }
 */
export function laneCostAllTime(lane, sessionNames = []) {
  const names = [...new Set((Array.isArray(sessionNames) ? sessionNames : []).filter((s) => typeof s === 'string' && s))].slice(0, 50);
  const cond = ['lane = ?', ...(names.length ? [`session_name IN (${names.map(() => '?').join(',')})`] : [])].join(' OR ');
  const rows = db.prepare(
    `SELECT IFNULL(session_name, '') || char(0) || IFNULL(session_id, '') AS k, usd, tokens, ts
       FROM cost_snapshots WHERE ${cond} ORDER BY ts ASC, id ASC`
  ).all(String(lane), ...names);
  const per = new Map();
  for (const r of rows) {
    const e = per.get(r.k) ?? { usd: 0, tokens: null };
    e.usd = Math.max(e.usd, Number(r.usd) || 0);
    e.tokens = r.tokens;
    per.set(r.k, e);
  }
  let usd = 0;
  let tokens = 0;
  for (const e of per.values()) {
    usd += e.usd;
    const t = e.tokens ? safeParse(e.tokens) : null;
    if (t && typeof t === 'object') for (const v of Object.values(t)) tokens += Number(v) || 0;
  }
  return { usd, tokens, sessions: per.size };
}
