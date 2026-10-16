// The lane archive (fleet §10 2.9, R9): what a lane was, kept after retire
// removes its worktree.
//
//   capture(rec, facts?)  read-only; collects the plan head, progress, PR,
//                         markers (dismissed included), summary, cost and the
//                         merged fact. Called by retire BEFORE the worktree is
//                         removed. Never throws: a missing piece is null.
//   commit(snap, retiredAt)  writes the row (db.addArchive). Called by retire
//                         only after the record says retiredAt, so a failed
//                         retire writes no row.
//   backfill()            once at startup: a row for every retired record that
//                         has none, from whatever survives (the plan is read
//                         from the kept local branch when the worktree is gone).
//   restoreId(id)         the first free `<id>-r<N>`: launch.validate refuses
//                         retired ids, so a restore is a new lane.
//
// Everything stored here was written by an agent (plan, markers, summary):
// it leaves only as JSON string fields; the views escape it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { run } from '../util.mjs';
import * as db from '../db.mjs';
import * as store from './store.mjs';
import * as progressCollector from '../collector/progress.mjs';
import { stageHeadings } from '../collector/progress.mjs';

/** The plan head kept per row. */
export const PLAN_HEAD_BYTES = 64 * 1024;
export const MARKERS_KEPT = 50;
const RECORD_MAX_CHARS = 16 * 1024;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;
const PLAN_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.md$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

let deps = {};
/**
 * { progress: {get}, prFor(id) }: retire.init passes its prFor, the archive
 * route module the ctx's PR collector; tests inject fakes. Merged, so two
 * callers can each give what they have.
 */
export function init(d = {}) {
  for (const [k, v] of Object.entries(d)) if (v !== undefined) deps[k] = v;
}
/** Tests only. */
export function _reset() {
  deps = {};
}

const progressOf = (id) => (deps.progress ?? progressCollector).get(id);
const prOf = (id) => (deps.prFor ? deps.prFor(id) : null);

/** First `# ` heading of a markdown text, trimmed to 200 chars. */
export function planTitle(text) {
  const m = /^#\s+(.+?)\s*#*\s*$/m.exec(String(text ?? ''));
  return m ? m[1].slice(0, 200) : null;
}

/** Cut a string to at most `max` UTF-8 bytes without splitting a character. */
export function headBytes(text, max = PLAN_HEAD_BYTES) {
  const buf = Buffer.from(String(text), 'utf8');
  if (buf.length <= max) return String(text);
  return buf.subarray(0, max).toString('utf8').replace(/�$/, '');
}

const safePlan = (p) => typeof p === 'string' && PLAN_RE.test(p) && !p.includes('..');

/** The plan's first 64 KiB from the worktree, else from the kept local branch, else null. */
async function readPlanHead(rec) {
  if (!safePlan(rec.plan)) return null;
  if (typeof rec.root === 'string' && rec.root) {
    const file = path.resolve(rec.root, rec.plan);
    if (file.startsWith(path.resolve(rec.root) + path.sep)) {
      let fh = null;
      try {
        fh = await fs.open(file, 'r');
        const st = await fh.stat();
        if (st.isFile()) {
          const buf = Buffer.alloc(Math.min(st.size, PLAN_HEAD_BYTES));
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          return headBytes(buf.subarray(0, bytesRead).toString('utf8'));
        }
      } catch { /* worktree gone: try the branch */ } finally {
        await fh?.close().catch(() => {});
      }
    }
  }
  if (typeof rec.repo === 'string' && REPO_RE.test(rec.repo) && typeof rec.branch === 'string'
    && BRANCH_RE.test(rec.branch) && !rec.branch.includes('..')) {
    const r = await run('git', ['-C', path.join(config.codeDir, rec.repo), 'show', `refs/heads/${rec.branch}:${rec.plan}`],
      { timeout: 10000 });
    if (r.ok) return headBytes(r.stdout);
  }
  return null;
}

function prFacts(id) {
  let pr = null;
  try { pr = prOf(id); } catch { pr = null; }
  if (pr && !pr.none && !pr.error && (pr.number != null || pr.state)) {
    return { number: pr.number ?? null, url: typeof pr.url === 'string' ? pr.url : null, state: pr.state ?? null };
  }
  try {
    const s = db.listPrSamples({ lane: id, limit: 1 })[0];
    if (s) return { number: s.number ?? null, url: null, state: s.state ?? null };
  } catch { /* no samples */ }
  return { number: null, url: null, state: null };
}

/** The record as stored, capped (a hand-edited lane.json could be huge). */
function recordCopy(rec) {
  try {
    const s = JSON.stringify(rec);
    return s.length <= RECORD_MAX_CHARS ? s : JSON.stringify({ id: rec.id, repo: rec.repo, branch: rec.branch, plan: rec.plan, truncated: true });
  } catch {
    return null;
  }
}

/**
 * Everything the row needs that would not survive the worktree. Read-only and
 * total: each piece that cannot be read is null. `facts` is retire's facts()
 * result when there is one (for the merged fact).
 */
export async function capture(rec, facts = null) {
  const id = rec.id;
  const head = await readPlanHead(rec).catch(() => null);

  let n = null;
  let m = null;
  try {
    const p = progressOf(id);
    if (p) { n = p.n ?? null; m = p.m ?? null; }
  } catch { /* no progress */ }
  if (m == null && head) {
    const st = stageHeadings(head);
    if (st.length) m = Math.max(...st);
  }

  const pr = prFacts(id);

  let markers = [];
  try {
    markers = db.listMarkers({ lane: id, includeDismissed: true, limit: MARKERS_KEPT })
      .map((r) => ({ id: r.id, ts: r.ts, kind: r.kind, text: r.text, source: r.source, session_name: r.session_name, dismissed_at: r.dismissed_at }));
  } catch { markers = []; }
  const done = markers.find((r) => r.kind === 'done');

  let cost = { usd: null, tokens: null };
  try {
    const names = [rec.session, id].filter((s) => typeof s === 'string' && s);
    const c = db.laneCostAllTime(id, names);
    cost = { usd: c.usd, tokens: c.tokens };
  } catch { /* no cost */ }

  let merged = null;
  if (facts?.merged === true || facts?.prState === 'MERGED' || pr.state === 'MERGED') merged = true;
  else if (facts?.merged === false) merged = false;

  return {
    lane: id,
    repo: rec.repo ?? null,
    branch: rec.branch ?? null,
    plan_path: rec.plan ?? null,
    plan_title: head ? planTitle(head) : null,
    plan_head: head,
    created_at: Number.isFinite(Number(rec.createdAt)) ? Number(rec.createdAt) : null,
    cost_usd: cost.usd,
    tokens: cost.tokens,
    stage_n: n,
    stage_m: m,
    pr_number: pr.number,
    pr_url: pr.url,
    pr_state: pr.state ?? facts?.prState ?? null,
    merged,
    markers,
    summary: done ? String(done.text).slice(0, 2000) : null,
    record: recordCopy(rec),
  };
}

/** Write the row for a lane retired at `retiredAt`. */
export function commit(snap, retiredAt) {
  const at = Number(retiredAt);
  const created = snap.created_at;
  db.addArchive({
    ...snap,
    retired_at: at,
    duration_ms: created != null && Number.isFinite(at) && at >= created ? at - created : null,
  });
  return snap.lane;
}

/** The smallest row retire can write when capture itself failed. */
export function minimal(rec) {
  return {
    lane: rec.id, repo: rec.repo ?? null, branch: rec.branch ?? null, plan_path: rec.plan ?? null,
    created_at: Number.isFinite(Number(rec.createdAt)) ? Number(rec.createdAt) : null,
    markers: [], record: recordCopy(rec),
  };
}

/** A row for every retired record that has none. Idempotent. -> { added: [ids] } */
export async function backfill(records = store.readAll()) {
  const have = db.archivedLanes();
  const added = [];
  for (const rec of records) {
    if (!rec?.retiredAt || !store.isLaneId(rec.id) || have.has(rec.id)) continue;
    try {
      const snap = await capture(rec).catch(() => minimal(rec));
      commit(snap, rec.retiredAt);
      have.add(rec.id);
      added.push(rec.id);
    } catch (err) {
      log.warn(`archive backfill failed for ${rec.id}: ${String(err?.message || err)}`);
    }
  }
  if (added.length) log.info(`archive: backfilled ${added.length} retired lane${added.length > 1 ? 's' : ''}`);
  return { added };
}

/**
 * The id a restore of `id` launches under: the first N >= 1 for which
 * `<id>-r<N>` is a valid lane id with no record and no archive row. Null when
 * no such id fits in a lane id.
 */
export function restoreId(id, records = store.readAll()) {
  const taken = new Set(records.map((r) => r.id));
  const archived = db.archivedLanes();
  for (let n = 1; n < 1000; n++) {
    const cand = `${id}-r${n}`;
    if (!store.isLaneId(cand)) return null;
    if (!taken.has(cand) && !archived.has(cand)) return cand;
  }
  return null;
}

/** Does `branch` exist in `<codeDir>/<repo>` locally or as origin/<branch>? */
export async function branchExists(repo, branch) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) return false;
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch) || branch.includes('..')) return false;
  const dir = path.join(config.codeDir, repo);
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    if ((await run('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', ref], { timeout: 5000 })).ok) return true;
  }
  return false;
}
