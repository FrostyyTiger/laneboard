# Q15 — SQLite index for "rows per session in a time window"

## Answer
- For `WHERE ts BETWEEN ? AND ? GROUP BY session_id`, **`(ts, session_id)` is the one that serves the
  WHERE**: the range sits on the leading column, so SQLite seeks into it. `session_id` is in the index,
  so with `SELECT session_id, count(*)` the index is covering (no table lookup).
- `(session_id, ts)` cannot seek on `ts` (the leading column is unconstrained). The planner would at
  best scan the whole index (covering) and filter; it gives grouped order for free but reads every row.
  Skip-scan is possible only after `ANALYZE` shows many duplicates in `session_id`; do not rely on it.
- Either way expect `GROUP BY` after a `ts` range to need `USE TEMP B-TREE FOR GROUP BY` with
  `(ts, session_id)`, because rows arrive in `ts` order, not `session_id` order. That is cheap for a window.
- `node:sqlite` has no documented caveat for DDL in a transaction (see below); `CREATE INDEX IF NOT EXISTS`
  is plain SQL through `exec`. Not run here (no shell): the builder should assert it in a test.

## Details
- Rule (optoverview §2): an index is used left to right without gaps; equalities first; "the right-most
  column that is used can employ inequalities… up to two inequalities that must sandwich" the values;
  columns to the right of an inequality column are not used for seeking.
- Plan lines SQLite prints (format "may change between releases", so tests must match loosely, e.g. a
  regex on `USING (COVERING )?INDEX idx_name` and not on the whole string):
  - seek with range: `SEARCH t USING INDEX i2 (a=? AND b>?)` (doc example); expected here
    `SEARCH events USING COVERING INDEX idx_events_ts_session (ts>? AND ts<?)` (the BETWEEN form; this exact
    line is my inference from the doc's pattern, not quoted).
  - full scan of covering index: `SCAN t USING COVERING INDEX i2` (doc example).
  - group/sort in temp storage: `USE TEMP B-TREE FOR GROUP BY` (doc: detail string
    "USE TEMP B-TREE FOR xxx", xxx is ORDER BY, GROUP BY or DISTINCT).
  - no index: `SCAN t`.
- To get the plan from node: `db.prepare('EXPLAIN QUERY PLAN SELECT …').all(a, b)`; rows have `detail`.
  (Column name `detail` is in the EQP doc; I did not run it under node.)
- If the query needs "per session over all time" as well, `(session_id, ts)` is the right second index;
  one index per access path. Add the other only when a query needs it.
- `node:sqlite`: class `DatabaseSync` is now a deprecated alias of `Database` (DEP0210); added v22.5.0;
  stability 1.2 release candidate since v25.7.0; no flag on current versions. `exec(sql)` runs one or more
  statements, no results, wraps `sqlite3_exec()`; `isTransaction` (v24.0.0/v22.16.0) wraps
  `sqlite3_get_autocommit()`. The docs show no transaction helper: use `exec('BEGIN')` … `exec('COMMIT')`
  / `ROLLBACK` in try/catch. SQLite itself allows `CREATE INDEX` inside a transaction (I know this from
  SQLite behaviour, not from a page I read today). Laneboard targets Node 24, so use whichever of the two
  class names the repo already uses; check `package.json`/existing code.

## What laneboard could take
- Migration: `CREATE INDEX IF NOT EXISTS idx_<table>_ts_session ON <table>(ts, session_id)`.
- Test: assert the plan `detail` matches `/USING (COVERING )?INDEX idx_/` and not `/^SCAN/`.
- Could not confirm: real plan text on the repo's bundled SQLite version; planner choice without `ANALYZE`.

## Sources
- https://www.sqlite.org/optoverview.html (read 2026-10-21)
- https://www.sqlite.org/eqp.html (read 2026-10-21)
- https://www.sqlite.org/queryplanner.html (read 2026-10-21; covering-index part only)
- https://nodejs.org/api/sqlite.html (read 2026-10-21; first 100000 characters)
