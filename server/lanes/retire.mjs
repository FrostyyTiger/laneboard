// Retire: the way back from a launch. Readiness is computed and shown, never
// acted on. Only when a human asks does anything happen, and then only:
//   agent-stack down <slot>, drop that slot's volumes, git worktree remove,
//   set retiredAt. The local branch stays; deleting branches is the human's.
//
// v3 hard rule 7: a dirty worktree or an unmerged branch is refused unless the
// human passes --force AND confirms by naming the lane. A live session is
// refused even then — killing it is a separate, deliberate act
// (`laneboard kill <lane>`), and removing a worktree from under a running Claude
// is never what anyone means.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.mjs';
import { slots as slotProvider } from '../providers/index.mjs';
import { log } from '../log.mjs';
import { run } from '../util.mjs';
import * as db from '../db.mjs';
import * as store from './store.mjs';
import { LaneError } from './launch.mjs';

let deps = null;
/** { state, broadcast, prFor(laneId) -> { state } | null } */
export function init(d) {
  deps = d;
}

// --- readiness ---------------------------------------------------------------

/**
 * Pure: facts -> { ready, reasons[], blockers[], dirtyFiles[] }.
 * facts: { liveSessions[], worktreeExists, dirtyFiles[], unpushed (number|null),
 *          merged (bool|null), prState ('OPEN'|'CLOSED'|'MERGED'|null) }
 */
export function judge(f) {
  const reasons = [];
  const blockers = [];
  if (f.liveSessions?.length) blockers.push(`live session: ${f.liveSessions.join(', ')}`);
  else reasons.push('no live session');

  if (!f.worktreeExists) {
    reasons.push('worktree already gone');
  } else {
    if (f.dirtyFiles?.length) blockers.push(`worktree dirty: ${f.dirtyFiles.length} file${f.dirtyFiles.length > 1 ? 's' : ''}`);
    else reasons.push('worktree clean');
    if (f.unpushed == null) blockers.push('unpushed state unknown');
    else if (f.unpushed > 0) blockers.push(`${f.unpushed} commit${f.unpushed > 1 ? 's' : ''} not on any remote`);
    else reasons.push('nothing unpushed');
  }

  if (f.merged === true) reasons.push('merged into origin/main');
  else if (f.prState === 'MERGED') reasons.push('PR merged');
  else if (f.prState === 'CLOSED') reasons.push('PR closed');
  else if (f.merged === false) blockers.push('branch not merged into origin/main and no closed PR');
  else blockers.push('merge state unknown');

  return { ready: blockers.length === 0, reasons, blockers, dirtyFiles: f.dirtyFiles ?? [] };
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/** Read-only facts about one lane. git here never writes, fetches or checks out. */
export async function facts(rec) {
  const liveSessions = [];
  if ((await run('tmux', ['has-session', '-t', `=${rec.session || rec.id}`], { timeout: 3000 })).ok) {
    liveSessions.push(rec.session || rec.id);
  }
  for (const s of deps?.state?.all?.() ?? []) {
    if (s.lane === rec.id && !liveSessions.includes(s.name)) liveSessions.push(s.name);
  }
  const worktreeExists = await exists(rec.root);
  let dirtyFiles = [];
  let unpushed = null;
  let merged = null;
  if (worktreeExists) {
    const st = await run('git', ['-C', rec.root, 'status', '--porcelain'], { timeout: 10000 });
    if (st.ok) dirtyFiles = st.stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
    const rl = await run('git', ['-C', rec.root, 'rev-list', '--count', 'HEAD', '--not', '--remotes'], { timeout: 10000 });
    if (rl.ok) unpushed = Number(rl.stdout.trim());
    const mb = await run('git', ['-C', rec.root, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'], { timeout: 10000 });
    merged = mb.ok ? true : mb.code === 1 ? false : null;
  }
  const prState = deps?.prFor?.(rec.id)?.state ?? null;
  return { liveSessions, worktreeExists, dirtyFiles, unpushed, merged, prState };
}

export async function readiness(rec) {
  return judge(await facts(rec));
}

/** Readiness of every active lane, refreshed at 60 s for the cards. */
let cache = {};
export function cached() {
  return cache;
}
export async function refresh() {
  const next = {};
  for (const rec of store.active()) {
    try {
      next[rec.id] = { ...(await readiness(rec)), at: Date.now() };
    } catch (err) {
      log.error(`readiness failed for ${rec.id}`, String(err));
    }
  }
  cache = next;
  return cache;
}

export function start() {
  const first = setTimeout(() => refresh().catch(() => {}), 10_000);
  first.unref();
  const timer = setInterval(() => refresh().catch(() => {}), config.lanePollMs);
  timer.unref();
}

// --- the act -----------------------------------------------------------------

/**
 * The rail in front of the one destructive call in the program. A slot is
 * taken down and its volumes dropped only if it is a slot lanes are allowed
 * to take in the first place — never a reserved one, never a number that came
 * from somewhere unexpected.
 */
export function assertLaneSlot(slot) {
  const n = Number(slot);
  if (!Number.isInteger(n) || !config.slots.laneSlots.includes(n) || config.slots.reservedSlots.includes(n)) {
    throw new LaneError(`slot ${slot} is not a lane slot`, 400);
  }
  return n;
}

function stepper(job, lane) {
  return (step, ok = null, detail = null) => {
    db.addJobStep({ job, lane, kind: 'retire', step, ok, detail });
    db.addEvent({ sessionName: lane, type: 'lane', subtype: `retire-${step}`, payload: { job, ok, detail } });
    deps?.broadcast?.({ ts: Date.now(), session_name: lane, type: 'lane', subtype: `retire-${step}` });
    const msg = `retire ${lane}: ${step}${ok === false ? ' FAILED' : ''}${detail ? ` ${JSON.stringify(detail).slice(0, 300)}` : ''}`;
    if (ok === false) log.warn(msg); else log.info(msg);
  };
}

/**
 * Validate, then run. Retire is quick (seconds), so unlike launch it is run
 * to the end before answering; the steps still land in lane_jobs.
 */
export async function retire(id, { force = false, confirm = null } = {}, who = 'local') {
  if (!store.isLaneId(id)) throw new LaneError('invalid lane id', 400);
  const rec = store.read(id);
  if (!rec) throw new LaneError(`no launched lane ${id}`, 404);
  if (rec.retiredAt) throw new LaneError(`lane ${id} was retired at ${new Date(rec.retiredAt).toISOString()}`, 409);

  const f = await facts(rec);
  const verdict = judge(f);
  if (f.liveSessions.length) {
    throw new LaneError(`lane ${id} has a live session (${f.liveSessions.join(', ')}); kill it first with \`laneboard kill\` — retire never kills a session`, 409, verdict);
  }
  if (!verdict.ready && !force) {
    const files = verdict.dirtyFiles.length ? ` Dirty: ${verdict.dirtyFiles.slice(0, 20).join(', ')}${verdict.dirtyFiles.length > 20 ? ', …' : ''}.` : '';
    throw new LaneError(`lane ${id} is not ready to retire: ${verdict.blockers.join('; ')}.${files} Use --force to retire anyway.`, 409, verdict);
  }
  if (force && confirm !== id) {
    throw new LaneError(`--force needs confirmation: pass confirm="${id}"`, 400, verdict);
  }

  const job = `retire-${id}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  const step = stepper(job, id);
  step('validate', true, { force, by: who, blockers: verdict.blockers });

  // The slot down, then its volumes: `down` leaves about 200 MB behind.
  if (rec.slot != null) {
    assertLaneSlot(rec.slot);
    const down = await slotProvider.down(rec.slot);
    if (!down.ok) {
      step('slot', false, { error: down.error });
      step('failed', false, { step: 'slot' });
      return { ok: false, job };
    }
    const vols = await slotProvider.dropVolumes(rec.slot);
    if (!vols.ok) {
      step('slot', false, { error: vols.error, volumes: vols.volumes });
      step('failed', false, { step: 'slot' });
      return { ok: false, job };
    }
    step('slot', true, { slot: rec.slot, down: true, volumesRemoved: vols.removed, skipped: vols.skipped });
  }

  if (f.worktreeExists) {
    const mainRepo = path.join(config.codeDir, rec.repo);
    const args = ['-C', mainRepo, 'worktree', 'remove', ...(force ? ['--force'] : []), rec.root];
    const wt = await run('git', args, { timeout: 60000 });
    if (!wt.ok) {
      step('worktree', false, { error: wt.stderr.trim().slice(-300) });
      step('failed', false, { step: 'worktree' });
      return { ok: false, job };
    }
    step('worktree', true, { removed: rec.root, force });
  } else {
    step('worktree', true, { skipped: 'already gone' });
  }

  await store.write({ ...rec, retiredAt: Date.now() });
  step('record', true, { retiredAt: true, branchKept: rec.branch });
  step('done', true, { lane: id });
  delete cache[id];
  return { ok: true, job, lane: id, branchKept: rec.branch };
}
