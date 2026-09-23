// How far a lane has got: "Stage 4 of 8".
//
// Three read-only sources per lane, all at 60 s and sequential across
// directories (hard rule 4). Nothing here writes, fetches or checks out.
//
//   plan    docs/plans/<id>.md    -> the highest `## Stage N` heading = M
//   status  docs/status/<id>.md   -> the highest `## Stage N` heading
//   commits git log origin/main..HEAD -> the highest stage in a subject
//
// N is the higher of the last two, because a lane writes its status doc and
// commits at different moments and either can be ahead.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { run } from '../util.mjs';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import * as lanes from './lanes.mjs';
import * as store from '../lanes/store.mjs';

/** `## Stage 4 — the thing`, at heading levels 2 to 4. */
const HEADING_RE = /^#{2,4}\s*Stage\s+(\d+)/gm;

/**
 * The plan's commit convention is `Stage 4: <title>`.
 *
 * The lanes on this box do not use it. Measured 2026-09-04, every staged commit
 * in ~/Kubik-* is a conventional commit — `feat(horizon): stage 2 - …`, and
 * sometimes a range, `feat(creatures): stages 6-7 - …`. Matching only the plan's
 * form would have made the commit source dead code on the machine it was
 * written for, so both are tried and the higher number wins.
 */
const SUBJECT_STRICT = /^Stage\s+(\d+)\b/;
const SUBJECT_LOOSE = /\bstages?\s+(\d+)(?:\s*[-–—]\s*(\d+))?\b/i;

export function stageFromSubject(subject) {
  const s = String(subject ?? '');
  const strict = SUBJECT_STRICT.exec(s);
  if (strict) return Number(strict[1]);
  const loose = SUBJECT_LOOSE.exec(s);
  if (!loose) return null;
  // "stages 6-7" has finished 7.
  return Math.max(Number(loose[1]), loose[2] ? Number(loose[2]) : Number(loose[1]));
}

/** Every `Stage N` heading number in a markdown document. */
export function stageHeadings(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(HEADING_RE)) out.push(Number(m[1]));
  return out;
}

/** `## Stage 4 — the thing` -> Map(4 -> 'the thing'). */
export function stageTitles(text) {
  const out = new Map();
  for (const m of String(text ?? '').matchAll(/^#{2,4}\s*Stage\s+(\d+)\s*[—–:.-]*\s*(.*)$/gm)) {
    if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2].trim().slice(0, 80));
  }
  return out;
}

/** The stage being worked on: the lowest stage above n (or the lowest at all). */
export function currentStage(titles, n) {
  const nums = [...titles.keys()].sort((a, b) => a - b);
  const next = nums.find((x) => n == null || x > n);
  if (next == null) return { n: null, title: 'all stages done' };
  return { n: next, title: titles.get(next) || '' };
}

const MAX_DOC_BYTES = 1024 * 1024;

async function readDoc(file) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile() || st.size > MAX_DOC_BYTES) return null;
    return await fsp.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** id -> { n, m, source, at, planPath, statusPath, commits } */
let progress = new Map();
let refreshedAt = 0;

export function get(laneId) {
  return laneId ? (progress.get(laneId) ?? null) : null;
}

export function all() {
  return Object.fromEntries(progress);
}

/** One lane. Exported so a test can drive it against a real worktree. */
export async function readLane({ id, root }) {
  // A launched lane's record names its plan; anything else follows the
  // docs/plans/<id>.md convention.
  const rec = store.read(id);
  const planRel = rec?.root === root && rec.plan ? rec.plan : path.join('docs', 'plans', `${id}.md`);
  const planPath = path.join(root, planRel);
  const plan = await readDoc(planPath);
  // No plan, no progress. "Stage 4" without a total is a number without a
  // scale, and the pill's whole job is to say how far through the lane is.
  if (plan == null) return null;
  const planStages = stageHeadings(plan);
  if (!planStages.length) return null;
  const m = Math.max(...planStages);

  const statusPath = path.join(root, 'docs', 'status', `${id}.md`);
  const status = await readDoc(statusPath);
  const statusStages = status ? stageHeadings(status) : [];
  const fromStatus = statusStages.length ? Math.max(...statusStages) : null;

  // `origin/main..HEAD` is exactly "commits on this branch that main does not
  // have" — the merge-base is implied. The remote-tracking ref is read as it
  // stands on disk; `git fetch` is not ours to run (hard rule 4).
  let fromCommit = null;
  let commitAt = null;
  let commits = 0;
  const r = await run(
    'git',
    ['-C', root, 'log', '-n', '200', '--format=%ct%x09%s', 'origin/main..HEAD'],
    { timeout: 5000 }
  );
  if (r.ok) {
    for (const line of r.stdout.split('\n')) {
      if (!line.trim()) continue;
      commits++;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      const stage = stageFromSubject(line.slice(tab + 1));
      if (stage == null) continue;
      if (fromCommit == null || stage > fromCommit) {
        fromCommit = stage;
        commitAt = Number(line.slice(0, tab)) * 1000;
      }
    }
  }

  const titles = stageTitles(plan);
  if (fromStatus == null && fromCommit == null) {
    return { n: null, m, source: null, at: null, planPath, statusPath, commits, current: currentStage(titles, null) };
  }
  const n = Math.max(fromStatus ?? -1, fromCommit ?? -1);
  // Which source actually produced N — worth recording, because "the status
  // doc says 3 but the branch only has stage 1 committed" is a real situation
  // and the answer to "is this lane finished?" differs between them.
  const source = fromCommit != null && fromCommit >= (fromStatus ?? -1) ? 'commit' : 'status';
  return {
    n,
    m,
    source,
    at: source === 'commit' ? commitAt : null,
    planPath,
    statusPath,
    commits,
    current: currentStage(titles, n),
  };
}

export async function refresh() {
  const next = new Map();
  // Sequential across directories: hard rule 4.
  for (const { id, root } of lanes.knownWorktrees()) {
    if (next.has(id)) continue;
    try {
      const p = await readLane({ id, root });
      if (p) next.set(id, p);
    } catch (err) {
      log.error(`progress failed for ${id}`, String(err));
    }
  }
  progress = next;
  refreshedAt = Date.now();
}

export function health() {
  return { lanes: progress.size, refreshedAt };
}

export function start() {
  // Offset from the lanes pass so the two 60 s scans never overlap, and late
  // enough that lanes has resolved its worktrees at least once.
  const first = setTimeout(() => refresh().catch((err) => log.error('progress refresh failed', String(err))), 20000);
  first.unref();
  const timer = setInterval(
    () => refresh().catch((err) => log.error('progress refresh failed', String(err))),
    config.lanePollMs
  );
  timer.unref();
  return () => clearInterval(timer);
}
