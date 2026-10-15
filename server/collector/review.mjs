// Review collector (fleet plan §10 2.4, R5): per-lane diff stats and the
// bookkeeping behind the `reviewReady` lane flag.
//
// Every 60 s (first pass 50 s after boot, after the lanes 5 s, progress 20 s,
// markers 35 s and PR 45 s passes) it walks the known worktrees one at a time,
// skips main checkouts, and runs one `git diff --numstat -z <merge-base>`
// against the working tree. The merge base (lane HEAD vs the repo's review
// base, `repos[].base` or `review.base`) is cached by (root, HEAD sha, base
// sha). Every git call is read-only and runs with GIT_OPTIONAL_LOCKS=0, so it
// never refreshes the index of a worktree an agent is using.
//
// kv (one JSON object per key, lane id -> ms):
//   review.sentAt      set by the send-review action (setReviewSent) and when
//                      the lane's PR changes to MERGED
//   review.greenSince  first pass the PR was seen green; cleared on non-green
//   review.readySince  start of the current ready episode, so a restart does
//                      not reset the wait timer
//
// `decorate(lane, {now, sessions})` is the lane decorator server/flags/review.mjs
// registers; it owns reviewReady, reviewSentAt, diffStat, packages and costUsd.
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { run as defaultRun } from '../util.mjs';
import * as db from '../db.mjs';
import * as lanesCollector from './lanes.mjs';
import * as store from '../lanes/store.mjs';
import { Lru, isSha, packagesFor as packagesForFiles } from '../packages/branches.mjs';
import { reviewReadyOf, nextGreenSince, parseNumstat, prOf, MAX_PATHS } from '../review/ready.mjs';

export const FIRST_PASS_MS = 50_000;
export const KV_SENT = 'review.sentAt';
export const KV_GREEN = 'review.greenSince';
export const KV_READY = 'review.readySince';
const MARKER_CACHE_MS = 5000;
const DIFF_TIMEOUT_MS = 15_000;
const GIT_FLAGS = ['-c', 'core.quotepath=off', '-c', 'diff.external='];

// --- dependencies (injectable for tests) -------------------------------------

function defaultWorktrees() {
  // build([]) gives every known worktree with isMain/branch, no sessions.
  return lanesCollector.build([]).map((l) => ({ id: l.id, root: l.root, isMain: !!l.isMain }));
}

/** The repo name a lane belongs to: its launch record, else the worktree name. */
function defaultRepoFor(id, root) {
  try {
    const rec = store.read(id);
    if (rec?.repo) return rec.repo;
  } catch { /* no record */ }
  const base = path.basename(String(root ?? ''));
  for (const repo of lanesCollector.knownRepos()) {
    if (base === repo || base.startsWith(`${repo}-`)) return repo;
  }
  return null;
}

function defaultRepoConfig(name) {
  if (!name || !Array.isArray(config.repos)) return null;
  return config.repos.find((r) => r && r.name === name) ?? null;
}

function makeDefaults() {
  return {
    run: defaultRun,
    worktrees: defaultWorktrees,
    repoFor: defaultRepoFor,
    repoConfig: defaultRepoConfig,
    baseRef: () => config.review?.base ?? 'origin/main',
    prFor: () => null,
    dirtyFor: () => 0,
    // P9's packagesFor(repo, paths) when present; else configured globs only.
    packagesFor: (repo, paths, repoCfg) => (Array.isArray(repoCfg?.packages) ? packagesForFiles(paths, repoCfg.packages) : []),
    markersFor: (lane) => db.listMarkers({ lane, kinds: ['done'], limit: 20 }),
    kvRead: (k) => db.kvRead(k, {}),
    kvWrite: (k, v) => db.kvWrite(k, v),
  };
}

let deps = makeDefaults();

/**
 * Wire the collector. `d` may override any of: run, worktrees() -> [{id, root,
 * isMain}], repoFor(id, root), repoConfig(name), baseRef(), prFor(id),
 * dirtyFor(id) -> n, packagesFor(repo, paths, repoCfg) -> [name],
 * markersFor(id), kvRead(key), kvWrite(key, value).
 */
export function init(d = {}) {
  deps = { ...makeDefaults(), ...Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === 'function')) };
  loaded = false;
}

// --- state --------------------------------------------------------------------

/** lane id -> {files, add, del, paths[], repo, at} */
let stats = new Map();
const mbCache = new Lru(500);
/** lane id -> last PR state seen ('OPEN'|'MERGED'|...) */
const prStates = new Map();
/** lane id -> {at, list} */
const markerCache = new Map();
let maps = { [KV_SENT]: {}, [KV_GREEN]: {}, [KV_READY]: {} };
let loaded = false;
let passes = 0;
let running = null;
let refreshedAt = 0;
let timers = [];

function load() {
  if (loaded) return;
  loaded = true;
  for (const k of [KV_SENT, KV_GREEN, KV_READY]) {
    let v = null;
    try { v = deps.kvRead(k); } catch (err) { log.error(`review kv read ${k} failed`, String(err)); }
    maps[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {};
  }
}

function setKv(key, id, value) {
  load();
  const m = maps[key];
  const cur = Object.hasOwn(m, id) ? m[id] : null;
  if (value == null ? cur == null : cur === value) return;
  if (value == null) delete m[id];
  else m[id] = value;
  try { deps.kvWrite(key, m); } catch (err) { log.error(`review kv write ${key} failed`, String(err)); }
}

function getKv(key, id) {
  load();
  const v = Object.hasOwn(maps[key], id) ? maps[key][id] : null;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Tests only. */
export function _reset() {
  stats = new Map();
  mbCache.clear();
  prStates.clear();
  markerCache.clear();
  maps = { [KV_SENT]: {}, [KV_GREEN]: {}, [KV_READY]: {} };
  loaded = false;
  passes = 0;
  running = null;
  refreshedAt = 0;
  deps = makeDefaults();
}

// --- public getters / setters ---------------------------------------------------

/** When a review was last sent to the lane (kv review.sentAt), or null. */
export function reviewSentAt(id) {
  return getKv(KV_SENT, id);
}

/** Record that a review was sent to lane `id` (the send-review action). */
export function setReviewSent(id, ts = Date.now()) {
  if (typeof id !== 'string' || !id) return;
  setKv(KV_SENT, id, ts);
}

export function greenSince(id) {
  return getKv(KV_GREEN, id);
}

/** `{files, add, del}` for lane `id`, or null before its first pass. */
export function diffStatOf(id) {
  const s = stats.get(id);
  return s ? { files: s.files, add: s.add, del: s.del } : null;
}

/** Changed paths (<= 500) of lane `id`, for packagesFor. */
export function pathsOf(id) {
  return stats.get(id)?.paths ?? [];
}

export function health() {
  return { lanes: stats.size, passes, refreshedAt, mergeBases: mbCache.size };
}

// --- the 60 s pass ----------------------------------------------------------------

const gitEnv = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: '0' });

function git(root, args, timeout = 4000) {
  return deps.run('git', ['-C', root, ...GIT_FLAGS, ...args], { timeout, env: gitEnv() });
}

async function revParse(root, ref) {
  const r = await git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const sha = r.ok ? r.stdout.trim() : '';
  return isSha(sha) ? sha : null;
}

/** Merge base of HEAD and the base, cached by (root, HEAD sha, base sha). */
async function mergeBase(root, head, base) {
  const key = `${root}\0${head}\0${base}`;
  const hit = mbCache.get(key);
  if (hit) return hit;
  const r = await git(root, ['merge-base', base, head]);
  const mb = r.ok ? r.stdout.trim() : '';
  if (!isSha(mb)) return null;
  mbCache.set(key, mb);
  return mb;
}

/** Diff stats of one worktree against its merge base, or null. */
export async function laneDiff(root, baseRef) {
  const head = await revParse(root, 'HEAD');
  if (!head) return null;
  const base = await revParse(root, baseRef);
  if (!base) return null;
  const mb = await mergeBase(root, head, base);
  if (!mb) return null;
  const r = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', '--numstat', '-z', mb, '--'], DIFF_TIMEOUT_MS);
  if (!r.ok) return null;
  return parseNumstat(r.stdout, MAX_PATHS);
}

function trackPr(id, now) {
  let raw;
  try { raw = deps.prFor(id); } catch { raw = undefined; }
  const pr = prOf(raw);
  setKv(KV_GREEN, id, nextGreenSince(getKv(KV_GREEN, id), raw ?? null, now));
  if (!pr) return;
  const prev = prStates.get(id);
  prStates.set(id, pr.state);
  // A merge closes the review: it counts as the review being sent.
  if (pr.state === 'MERGED' && prev !== 'MERGED') {
    const sent = getKv(KV_SENT, id);
    if (prev !== undefined || sent == null) setKv(KV_SENT, id, now);
  }
}

async function pass(now) {
  load();
  const next = new Map();
  let trees = [];
  try { trees = deps.worktrees() ?? []; } catch (err) { log.error('review: worktrees failed', String(err)); }
  for (const t of trees) {
    if (!t?.id || !t.root || t.isMain) continue;
    trackPr(t.id, now);
    const repo = deps.repoFor(t.id, t.root);
    const repoCfg = deps.repoConfig(repo);
    const baseRef = repoCfg?.base || deps.baseRef();
    let d = null;
    try { d = await laneDiff(t.root, baseRef); } catch (err) { log.error(`review diff failed for ${t.id}`, String(err)); }
    if (d) next.set(t.id, { ...d, repo, at: now });
    else if (stats.has(t.id)) next.set(t.id, stats.get(t.id)); // keep the last good numbers
  }
  stats = next;
  passes += 1;
  refreshedAt = now;
  return health();
}

/** One collector pass (never two at once). */
export function refresh(now = Date.now()) {
  if (!running) running = pass(now).finally(() => { running = null; });
  return running;
}

export function start() {
  stop();
  const first = setTimeout(() => refresh().catch((err) => log.error('review refresh failed', String(err))), FIRST_PASS_MS);
  first.unref?.();
  const every = setInterval(() => refresh().catch((err) => log.error('review refresh failed', String(err))), config.lanePollMs || 60_000);
  every.unref?.();
  timers = [first, every];
}

export function stop() {
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  timers = [];
}

// --- the lane decorator -------------------------------------------------------------

function doneMarkers(id, now) {
  const hit = markerCache.get(id);
  if (hit && now - hit.at >= 0 && now - hit.at < MARKER_CACHE_MS) return hit.list;
  let list = [];
  try { list = deps.markersFor(id) ?? []; } catch (err) { log.error('review: markers failed', String(err)); }
  markerCache.set(id, { at: now, list });
  return list;
}

function laneSessions(lane, sessions) {
  const names = new Set(Array.isArray(lane.sessions) ? lane.sessions : []);
  return (Array.isArray(sessions) ? sessions : []).filter((s) => s && names.has(s.name));
}

/** The review-ready flag of `lane`, with the ready episode persisted. */
export function readyFor(lane, sessions, now = Date.now()) {
  const id = lane.id;
  const sentAt = getKv(KV_SENT, id);
  let pr = null;
  try { pr = deps.prFor(id); } catch { pr = null; }
  let dirtyCount = 0;
  try { dirtyCount = Number(deps.dirtyFor(id)) || 0; } catch { dirtyCount = 0; }
  const r = reviewReadyOf({
    lane,
    sessions,
    pr,
    doneMarkers: doneMarkers(id, now),
    diffStat: diffStatOf(id),
    dirtyCount,
    reviewSentAt: sentAt,
    greenSince: getKv(KV_GREEN, id),
  });
  // Before the first pass the diff stats are unknown: a stop-diff lane would
  // read as not ready, so the stored episode is neither cleared nor moved.
  if (!passes) {
    const stored = getKv(KV_READY, id);
    if (r && stored != null && stored <= (r.since ?? Infinity) && (sentAt == null || stored > sentAt)) r.since = stored;
    return r;
  }
  if (!r) {
    setKv(KV_READY, id, null);
    return null;
  }
  const stored = getKv(KV_READY, id);
  if (stored != null && (sentAt == null || stored > sentAt) && (r.since == null || stored <= r.since)) r.since = stored;
  else if (r.since == null) r.since = now;
  setKv(KV_READY, id, r.since);
  return r;
}

/** Lane decorator: owns reviewReady, reviewSentAt, diffStat, packages, costUsd. */
export function decorate(lane, { now = Date.now(), sessions = [] } = {}) {
  if (!lane?.id) return null;
  const mine = laneSessions(lane, sessions);
  let costUsd = 0;
  for (const s of mine) {
    const usd = s.cost?.usd;
    if (typeof usd === 'number' && Number.isFinite(usd)) costUsd += usd;
  }
  const st = stats.get(lane.id);
  let packages = [];
  if (st?.paths?.length) {
    try {
      const repoCfg = deps.repoConfig(st.repo);
      const p = deps.packagesFor(st.repo, st.paths, repoCfg);
      if (Array.isArray(p)) packages = p.filter((x) => typeof x === 'string');
    } catch { packages = []; }
  }
  return {
    reviewReady: readyFor(lane, mine, now),
    reviewSentAt: getKv(KV_SENT, lane.id),
    diffStat: diffStatOf(lane.id),
    packages,
    costUsd: Math.round(costUsd * 10000) / 10000,
  };
}
