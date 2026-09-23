// Lane identity — which worktree a session is working in.
//
// A lane is the git worktree root of a pane's cwd. Its label is the basename
// with the name of its main checkout stripped, because a lane's worktree is
// named <repo>-<lane> beside the repo it came from: with ~/code/acme checked
// out, ~/code/acme-horizon-v1 is the lane "horizon-v1". Nothing is configured
// for this: the main checkouts are whatever directories in `codeDir` are git
// repositories, re-read on the 60 s pass.
//
// Hard rule 4 (v2 plan): no new git call on the 15 s path. A cwd -> worktree
// root mapping essentially never changes, so `--show-toplevel` is resolved once
// per directory and cached for the process lifetime; everything slower
// (`worktree list`, merged-into-main, last commit) runs at 60 s, sequentially,
// and is strictly read-only. Nothing here writes, fetches, checks out, or
// touches the index in any worktree.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { run } from '../util.mjs';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import * as store from '../lanes/store.mjs';

/**
 * The main checkouts a lane can be a worktree of, longest name first so that
 * `acme-web` is tried before `acme`. Seeded from `config.repos` — which a
 * host lists for `launch` anyway — and then replaced by what is actually on
 * disk under `codeDir`. A main checkout keeps its own name as its lane id:
 * that is honest, it is not a lane of anything.
 */
let mainCheckouts = sortByLength(config.repoNames);

function sortByLength(names) {
  return [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
}

/** What the last scan found, for the tests and for /healthz. */
export function knownRepos() { return [...mainCheckouts]; }

/** Used by the tests and by `scanRepos`; never by a collector directly. */
export function setRepos(names) { mainCheckouts = sortByLength(names); }

/**
 * Every directory under `codeDir` that is a git repository, plus the ones
 * `config.repos` names. A worktree added by `launch` has a `.git` FILE rather
 * than a directory, and is not a main checkout — but it is also named
 * <repo>-<lane>, so the longest-first match still resolves it correctly.
 */
export async function scanRepos() {
  const found = [];
  let entries = [];
  try { entries = await fsp.readdir(config.codeDir, { withFileTypes: true }); } catch { /* no codeDir yet */ }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const st = await fsp.stat(path.join(config.codeDir, e.name, '.git'));
      if (st.isDirectory()) found.push(e.name);
    } catch { /* not a checkout */ }
  }
  setRepos([...config.repoNames, ...found]);
  return knownRepos();
}

/** dir -> worktree root (or null when the dir is not in a repo). Never expires. */
const roots = new Map();
const pending = [];
let draining = null;

/** worktree path -> { path, branch, merged, lastCommitAt, isMain }. Refreshed at 60 s. */
let trees = new Map();
let refreshedAt = 0;

// --- identity ---------------------------------------------------------------

export function laneIdFor(root) {
  if (!root) return null;
  // A launched lane's record knows its own id, whatever the repo prefix.
  const launched = store.idForRoot(root);
  if (launched) return launched;
  const base = path.basename(root);
  // A main checkout is not a lane OF anything, so it keeps its own name.
  if (mainCheckouts.includes(base)) return base;
  for (const repo of mainCheckouts) {
    const prefix = `${repo}-`;
    if (base.startsWith(prefix) && base.length > prefix.length) return base.slice(prefix.length);
  }
  return base;
}

/**
 * A stable hue per lane id: same colour across restarts, across browsers, and
 * without a config file or a database column (lanes plan hard rule 4).
 *
 * TODO: this is the trivial version and it can put two lanes on
 * neighbouring hues. The interesting fix is not a better hash but *repulsion* —
 * pick from a fixed set of well-separated hues and assign by stable order, so a
 * collision becomes impossible rather than merely unlikely. The fallback here
 * works; swapping it changes only this function.
 */
export function hueFor(id) {
  if (!id) return 0;
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h % 360;
}

// --- worktree roots ---------------------------------------------------------

/**
 * Ask for a directory's worktree root. Resolved at most once per directory for
 * the life of the process, and drained one call at a time so the first tick
 * cannot fire fifteen `git rev-parse` at once on an i5-8400.
 */
export function wantRoot(dir) {
  if (!dir || typeof dir !== 'string') return;
  if (roots.has(dir) || pending.includes(dir)) return;
  pending.push(dir);
  if (!draining) draining = drain().finally(() => { draining = null; });
}

async function drain() {
  while (pending.length) {
    const dir = pending.shift();
    if (roots.has(dir)) continue;
    const r = await run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 4000 });
    roots.set(dir, r.ok ? r.stdout.trim() || null : null);
  }
}

export function rootOf(dir) {
  return dir ? (roots.get(dir) ?? null) : null;
}

/** The lane id for a pane cwd, or null when it is not inside a repo. */
export function laneOf(dir) {
  return laneIdFor(rootOf(dir));
}

// --- the 60 s pass ----------------------------------------------------------

/** Parse `git worktree list --porcelain`. */
export function parseWorktreeList(stdout) {
  const out = [];
  let cur = null;
  for (const line of String(stdout).split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length).trim(), branch: null, head: null, detached: false };
      out.push(cur);
    } else if (!cur) continue;
    else if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length).trim();
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
  }
  return out.filter((w) => w.path);
}

const MAIN_BRANCHES = new Set(['main', 'master']);

/**
 * Lanes that are separate clones rather than worktrees — a lane can be
 * one — are invisible to `worktree list`, so a finished lane clone with no
 * session could never appear. They follow the same naming convention as the
 * worktrees, so a sibling directory with a matching prefix and a `.git` is one.
 * Pure readdir; no git call is spent finding them.
 */
async function siblingClones(known) {
  const parents = new Set(known.map((p) => path.dirname(p)));
  const found = [];
  for (const parent of parents) {
    let entries;
    try { entries = await fsp.readdir(parent, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (!mainCheckouts.some((r) => e.name.startsWith(`${r}-`) && e.name.length > r.length + 1)) continue;
      const dir = path.join(parent, e.name);
      try { await fsp.stat(path.join(dir, '.git')); } catch { continue; }
      found.push(dir);
    }
  }
  return found;
}

/** exit 0 = merged, exit 1 = not, anything else (no origin/main) = unknown. */
async function mergedIntoMain(dir) {
  const r = await run('git', ['-C', dir, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { timeout: 4000 });
  if (r.ok) return true;
  return r.code === 1 ? false : null;
}

export async function refresh() {
  // The repos first: every lane id below is derived against them.
  await scanRepos();
  const seeds = [...new Set([...roots.values()].filter(Boolean))];
  const discovered = new Map();
  const covered = new Set();
  // One `worktree list` per repo, not per worktree: every worktree of a repo
  // reports the same list, so the first one covers all its siblings.
  for (const root of seeds) {
    if (covered.has(root)) continue;
    covered.add(root);
    const r = await run('git', ['-C', root, 'worktree', 'list', '--porcelain'], { timeout: 5000 });
    if (!r.ok) { discovered.set(root, { path: root, branch: null }); continue; }
    for (const wt of parseWorktreeList(r.stdout)) {
      discovered.set(wt.path, wt);
      covered.add(wt.path);
    }
  }
  for (const dir of await siblingClones([...discovered.keys()])) {
    if (!discovered.has(dir)) discovered.set(dir, { path: dir, branch: null });
  }

  const next = new Map();
  // Sequential across directories: hard rule 4. Each call is ~6 ms.
  for (const [p, wt] of discovered) {
    const prev = trees.get(p);
    let branch = wt.branch;
    if (!branch) {
      const b = await run('git', ['-C', p, 'branch', '--show-current'], { timeout: 4000 });
      branch = (b.ok && b.stdout.trim()) || null;
    }
    const merged = await mergedIntoMain(p);
    const lg = await run('git', ['-C', p, 'log', '-1', '--format=%ct'], { timeout: 4000 });
    const lastCommitAt = lg.ok && lg.stdout.trim()
      ? Number(lg.stdout.trim()) * 1000
      : prev?.lastCommitAt ?? null;
    next.set(p, {
      path: p,
      branch,
      // A main checkout is always "merged into main" and saying so is noise.
      isMain: branch ? MAIN_BRANCHES.has(branch) : false,
      merged,
      lastCommitAt: Number.isFinite(lastCommitAt) ? lastCommitAt : null,
    });
  }
  trees = next;
  refreshedAt = Date.now();
}

// --- the lanes array --------------------------------------------------------

/**
 * Build `lanes` for /api/state. An idle lane is a worktree with no live
 * session: it is information (finished and mergeable, or abandoned), but it is
 * NOT a session — separate array, no state, no attention score, never a card
 * (lanes plan hard rule 6).
 */
export function build(sessions, { progressFor = () => null } = {}) {
  const byId = new Map();
  const touch = (root) => {
    const id = laneIdFor(root);
    if (!id) return null;
    if (!byId.has(id)) {
      const info = trees.get(root);
      byId.set(id, {
        id,
        root,
        branch: info?.branch ?? null,
        hue: hueFor(id),
        sessions: [],
        merged: info?.merged ?? null,
        isMain: info?.isMain ?? false,
        lastCommitAt: info?.lastCommitAt ?? null,
        // "Stage 4 of 8", or null when the lane has no plan document.
        // Injected rather than imported: progress.mjs reads knownWorktrees()
        // from here, and a module cycle between the two would be a trap for
        // whoever next moves an import to the top of a file.
        progress: progressFor(id),
        idle: true,
      });
    }
    return byId.get(id);
  };

  for (const s of sessions) {
    const lane = touch(rootOf(s.dir));
    if (!lane) continue;
    lane.sessions.push(s.name);
    lane.idle = false;
    if (!lane.branch) lane.branch = s.branch ?? null;
  }
  for (const p of trees.keys()) touch(p);

  return [...byId.values()].sort(
    // Active lanes first, then alphabetical. This orders the RAIL, never the
    // grid — the grid's sort is attention's and stays untouched.
    (a, b) => Number(a.idle) - Number(b.idle) || a.id.localeCompare(b.id)
  );
}

/** Every worktree the 60 s pass knows, as { id, root }. Drives progress.mjs. */
export function knownWorktrees() {
  return [...trees.keys()].map((root) => ({ id: laneIdFor(root), root }));
}

export function health() {
  return { lanes: trees.size, roots: roots.size, repos: mainCheckouts.length, refreshedAt };
}

export function start() {
  // The first pass is seeded by the worktree roots, which are themselves
  // resolved from the first tick — running it immediately would find nothing
  // and leave the board without lanes for a whole minute.
  // The repos are needed before the first lane id is asked for, which happens
  // on the first tick; the full pass waits for the worktree roots.
  scanRepos().catch((err) => log.error('repo scan failed', String(err)));
  const first = setTimeout(
    () => refresh().catch((err) => log.error('lanes refresh failed', String(err))),
    5000
  );
  first.unref();
  const timer = setInterval(
    () => refresh().catch((err) => log.error('lanes refresh failed', String(err))),
    config.lanePollMs
  );
  timer.unref();
  return () => clearInterval(timer);
}
