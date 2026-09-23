// Launch: plan on a branch -> worktree -> venv -> agent-stack slot -> tmux
// session running Claude with that slot's environment -> kickoff prompt.
//
// A launch is a job: every step lands in `lane_jobs` and as a `lane` event.
// Step 1 (validation) runs before the 202, so a refusal is an ordinary 4xx
// with the reason. The rest runs in the background.
//
// v3 hard rules this file carries:
//   6  `git fetch` and `git worktree add` happen here and in retire, nowhere else.
//   7  A failed step leaves what it made and says so. No rollback, no cleanup
//      that guesses; `laneboard retire --force` is the way back.
//   8  The session's environment is verified from /proc/<pid>/environ BEFORE
//      the prompt is typed; a session without its slot's DATABASE_ADMIN_URL,
//      or with one on :5432, is killed and the launch fails.
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { run, stripAnsi } from '../util.mjs';
import * as db from '../db.mjs';
import * as store from './store.mjs';
import { stageHeadings } from '../collector/progress.mjs';

export class LaneError extends Error {
  constructor(message, status = 400, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export const DEV_STACK_PORTS = [5432, 6379, 9000, 9001, 8000, 3000];
export const DB_VARS = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'DATABASE_APP_URL', 'DATABASE_READONLY_URL'];

// --- pure pieces, tested directly ---------------------------------------------

/** The port a URL points at, or null. `postgresql+asyncpg://…` parses fine. */
export function urlPort(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.port) return Number(u.port);
    return null;
  } catch {
    const m = /:(\d{2,5})(?:[/?#]|$)/.exec(String(value));
    return m ? Number(m[1]) : null;
  }
}

/** /proc/<pid>/environ bytes -> { NAME: value }. */
export function parseEnviron(buf) {
  const out = {};
  for (const pair of String(buf).split('\0')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

/**
 * Rule 8. Returns { ok, reason, ports } for a lane session's environment.
 * DATABASE_ADMIN_URL must be set and on the slot's Postgres port; no DB URL
 * may point at a dev-stack port.
 */
export function checkLaneEnv(env, expectPgPort) {
  const ports = Object.fromEntries(DB_VARS.map((k) => [k, urlPort(env[k])]));
  if (!env.DATABASE_ADMIN_URL) return { ok: false, reason: 'DATABASE_ADMIN_URL is unset', ports };
  for (const k of DB_VARS) {
    if (ports[k] != null && DEV_STACK_PORTS.includes(ports[k])) {
      return { ok: false, reason: `${k} points at :${ports[k]}, the dev stack`, ports };
    }
  }
  if (expectPgPort && ports.DATABASE_ADMIN_URL !== expectPgPort) {
    return { ok: false, reason: `DATABASE_ADMIN_URL is on :${ports.DATABASE_ADMIN_URL}, expected :${expectPgPort}`, ports };
  }
  return { ok: true, reason: null, ports };
}

/** `agent-stack env N` output -> the ports, never the passwords. */
export function portsFromEnv(text) {
  const env = {};
  for (const line of String(text).split('\n')) {
    const m = /^\s*export\s+([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return {
    pgPort: Number(env.PGPORT) || urlPort(env.DATABASE_ADMIN_URL),
    redisPort: urlPort(env.REDIS_URL),
    s3Port: urlPort(env.S3_ENDPOINT_URL),
  };
}

/** `agent-stack status` -> the slot numbers that have any container. */
export function slotsFromStatus(text) {
  const out = new Set();
  for (const line of String(text).split('\n')) {
    const m = /^agent(\d+)\b/.exec(line.trim());
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** The `--permission-mode` choices `claude --help` lists. */
export function permissionModesFromHelp(text) {
  const i = String(text).indexOf('--permission-mode');
  if (i < 0) return [];
  const m = /\(choices:([^)]*)\)/.exec(String(text).slice(i, i + 600));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
}

export function hasStages(planText) {
  return stageHeadings(planText).length > 0;
}

export function renderKickoff(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? `{{${k}}}` : String(vars[k])));
}

// --- the job ---------------------------------------------------------------

const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;
const PLAN_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.md$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
const MODEL_RE = /^[A-Za-z0-9._[\]-]{1,40}$/;

let deps = null;
/**
 * Set when the server is going down. `systemctl restart` signals the whole
 * cgroup, so a pip or agent-stack child dies with us and its failure lands a
 * moment before we exit; that is an interruption, not a failed step.
 */
let shuttingDown = false;
export function beginShutdown() {
  shuttingDown = true;
}
/** Injected at start (and by tests): { state, actions, broadcast }. */
export function init(d) {
  deps = d;
}

function stepper(job, lane, kind) {
  return (step, ok = null, detail = null) => {
    db.addJobStep({ job, lane, kind, step, ok, detail });
    db.addEvent({ sessionName: lane, type: 'lane', subtype: `${kind}-${step}`, payload: { job, ok, detail } });
    deps?.broadcast?.({ ts: Date.now(), session_name: lane, type: 'lane', subtype: `${kind}-${step}` });
    const msg = `${kind} ${lane}: ${step}${ok === false ? ' FAILED' : ''}${detail ? ` ${JSON.stringify(detail).slice(0, 300)}` : ''}`;
    if (ok === false) log.warn(msg); else log.info(msg);
  };
}

async function agentStackSlots() {
  const r = await run(config.slots.bin, ['status'], { timeout: 20000 });
  return r.ok ? slotsFromStatus(r.stdout) : null;
}

async function tmuxHas(name) {
  const r = await run('tmux', ['has-session', '-t', `=${name}`], { timeout: 3000 });
  return r.ok;
}

/**
 * Step 1. Everything that can be refused without touching anything.
 * Throws LaneError; returns the resolved request.
 */
export async function validate(req) {
  const lane = String(req.lane ?? '');
  if (!store.isLaneId(lane)) {
    throw new LaneError(`invalid lane id "${lane}": lowercase letters, digits, . _ -, at most 40, not starting with . or -`);
  }
  const repo = String(req.repo || config.defaultRepo || '');
  if (!repo) throw new LaneError('no repo given and no default repo configured');
  if (!REPO_RE.test(repo)) throw new LaneError(`invalid repo "${repo}"`);
  const branch = String(req.branch || `feat/${lane}`);
  if (!BRANCH_RE.test(branch) || branch.includes('..')) throw new LaneError(`invalid branch "${branch}"`);
  const plan = String(req.plan || `docs/plans/${lane}.md`);
  if (!PLAN_RE.test(plan) || plan.includes('..')) throw new LaneError(`invalid plan path "${plan}"`);
  const model = String(req.model || 'opus');
  if (!MODEL_RE.test(model)) throw new LaneError(`invalid model "${model}"`);
  const permissionMode = String(req.permissionMode || 'auto');

  const help = await run(config.claudeBin, ['--help'], { timeout: 15000 });
  const modes = permissionModesFromHelp(help.stdout);
  if (!modes.includes(permissionMode)) {
    throw new LaneError(`claude does not accept --permission-mode ${permissionMode} (it lists: ${modes.join(', ') || 'nothing'})`, 400);
  }

  const records = store.readAll();
  const existing = records.find((r) => r.id === lane);
  if (existing && !existing.retiredAt) throw new LaneError(`lane ${lane} already exists`, 409);
  if (existing) {
    throw new LaneError(`a retired lane ${lane} exists in ${store.laneDir(lane)}; pick another id`, 409);
  }
  if (deps?.state?.get(lane) || await tmuxHas(lane)) throw new LaneError(`a tmux session named ${lane} already exists`, 409);

  const mainRepo = path.join(config.codeDir, repo);
  try {
    await fsp.access(path.join(mainRepo, '.git'));
  } catch {
    throw new LaneError(`no checkout at ${mainRepo}`, 400);
  }
  const root = path.join(path.dirname(mainRepo), `${repo}-${lane}`);
  try {
    await fsp.access(root);
    throw new LaneError(`${root} already exists`, 409);
  } catch (err) {
    if (err instanceof LaneError) throw err;
  }

  const realSlots = await agentStackSlots();
  if (realSlots == null) throw new LaneError('agent-stack status failed; cannot tell which slots are free', 503);
  // Test only: pretend more slots are taken. It can only ever add to what the
  // agent stack reports, never make a slot in use look free.
  const faked = Array.isArray(req.fakeTakenSlots) ? req.fakeTakenSlots.map(Number).filter(Number.isInteger) : [];
  const stackSlots = [...new Set([...realSlots, ...faked])];
  const owners = store.slotOwners(records, stackSlots);
  const activeCount = store.active(records).length;
  const slot = store.freeSlot(owners);
  if (activeCount >= config.maxActiveLanes || slot == null) {
    const held = config.slots.laneSlots.map((n) => `slot ${n}: ${owners.get(n) ?? 'free'}`);
    throw new LaneError(`no free lane slot (${held.join('; ')})`, 409, { owners: Object.fromEntries(owners) });
  }

  return {
    lane, repo, branch, plan, model, permissionMode, slot, mainRepo, root,
    localBranch: Boolean(req.localBranch),
    promptOverride: typeof req.promptOverride === 'string' && req.promptOverride ? req.promptOverride.slice(0, 8000) : null,
  };
}

/** Validate, then run the rest in the background. Returns { ok, job, lane, slot }. */
/**
 * Validation and the record are one critical section: two launches at once
 * must not both see slot 2 free. validate() awaits (claude --help, agent-stack
 * status), so without this they would interleave.
 */
let gate = Promise.resolve();
function serialised(fn) {
  const run = gate.then(fn, fn);
  gate = run.catch(() => {});
  return run;
}

export async function launch(req, who = 'local') {
  // The record is written as soon as validation passes, not at the end: it is
  // what holds the slot, and it is what lets `retire --force` find and clean a
  // launch that failed or was cut off before its session existed.
  const v = await serialised(async () => {
    const valid = await validate(req);
    await store.write({
      id: valid.lane, repo: valid.repo, root: valid.root, branch: valid.branch, plan: valid.plan, slot: valid.slot,
      model: valid.model, permissionMode: valid.permissionMode, session: valid.lane,
      createdAt: Date.now(), retiredAt: null,
    });
    return valid;
  });
  const job = `launch-${v.lane}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  const step = stepper(job, v.lane, 'launch');
  step('validate', true, { repo: v.repo, branch: v.branch, plan: v.plan, slot: v.slot, model: v.model, permissionMode: v.permissionMode, by: who });
  step('record', true, { file: store.laneFile(v.lane) });
  runLaunch(v, step).catch((err) => {
    step('failed', false, { step: 'internal', error: String(err?.message || err) });
  });
  return { ok: true, job, lane: v.lane, slot: v.slot };
}

async function runLaunch(v, step) {
  const fail = (at, detail) => {
    if (shuttingDown || detail?.signal) {
      step('interrupted', false, { after: lastOk, during: at, signal: detail?.signal ?? null });
      return false;
    }
    step(at, false, detail);
    step('failed', false, { step: at });
    return false;
  };
  let lastOk = 'record';
  const ok = step;
  step = (name, okv = null, detail = null) => { if (okv !== false) lastOk = name; ok(name, okv, detail); };
  const git = (args, timeout = 60000) => run('git', ['-C', v.mainRepo, ...args], { timeout });

  // 2. The plan is on the branch, pushed from where it was written.
  let startRef;
  if (v.localBranch) {
    startRef = `refs/heads/${v.branch}`;
    step('fetch', true, { skipped: 'local branch (test only)' });
  } else {
    const f = await git(['fetch', 'origin'], 120000);
    if (!f.ok) return fail('fetch', { error: f.stderr.trim().slice(-400), signal: f.signal });
    startRef = `refs/remotes/origin/${v.branch}`;
    step('fetch', true, null);
  }
  const where = v.localBranch ? v.branch : `origin/${v.branch}`;
  if (!(await git(['rev-parse', '--verify', '--quiet', startRef])).ok) {
    return fail('plan', { error: `branch ${where} does not exist. The plan is pushed from where it was written: commit docs/plans/<lane>.md on the branch and push it, then launch.` });
  }
  const shown = await git(['show', `${startRef}:${v.plan}`]);
  if (!shown.ok) {
    return fail('plan', { error: `${v.plan} is not on ${where}. The plan is pushed from where it was written, not pasted into a chat.` });
  }
  if (!hasStages(shown.stdout)) return fail('plan', { error: `${v.plan} has no "## Stage N" heading` });
  step('plan', true, { stages: stageHeadings(shown.stdout).length, ref: where });

  // 3. The worktree.
  const hasLocal = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${v.branch}`])).ok;
  const wtArgs = hasLocal || v.localBranch
    ? ['worktree', 'add', v.root, v.branch]
    : ['worktree', 'add', '--track', '-b', v.branch, v.root, `origin/${v.branch}`];
  const wt = await git(wtArgs);
  if (!wt.ok) return fail('worktree', { error: wt.stderr.trim().slice(-400), signal: wt.signal });
  step('worktree', true, { root: v.root, localBranchExisted: hasLocal });

  // 4. Its own venv: an editable install points at the checkout it was made in.
  const laneDir = store.laneDir(v.lane);
  await fsp.mkdir(laneDir, { recursive: true });
  let hasPyproject = false;
  try { await fsp.access(path.join(v.root, 'pyproject.toml')); hasPyproject = true; } catch { /* not a python repo */ }
  if (hasPyproject) {
    const mk = await run('python3', ['-m', 'venv', '.venv'], { cwd: v.root, timeout: 120000 });
    if (!mk.ok) return fail('venv', { error: mk.stderr.trim().slice(-400), signal: mk.signal });
    const pip = await run(path.join(v.root, '.venv/bin/pip'), ['install', '-q', '-e', '.[dev]'], { cwd: v.root, timeout: 20 * 60000, maxBuffer: 64 * 1024 * 1024 });
    await fsp.writeFile(path.join(laneDir, 'pip.log'), `${pip.stdout}\n${pip.stderr}`);
    if (!pip.ok) return fail('venv', { error: `pip install failed, see ${path.join(laneDir, 'pip.log')}`, tail: pip.stderr.trim().slice(-300), signal: pip.signal });
    step('venv', true, { path: path.join(v.root, '.venv') });
  } else {
    step('venv', true, { skipped: 'no pyproject.toml' });
  }

  // 5. The slot.
  const up = await run(config.slots.bin, ['up', String(v.slot)], {
    timeout: 10 * 60000, env: { ...process.env, AGENT_REPO: v.root }, cwd: v.root, maxBuffer: 16 * 1024 * 1024,
  });
  await fsp.writeFile(path.join(laneDir, 'agent-stack.log'), `${up.stdout}\n${up.stderr}`);
  if (!up.ok) return fail('slot', { error: `agent-stack up ${v.slot} exited ${up.code}, see ${path.join(laneDir, 'agent-stack.log')}`, tail: up.stderr.trim().slice(-300), signal: up.signal });
  const envOut = await run(config.slots.bin, ['env', String(v.slot)], { timeout: 20000 });
  const ports = portsFromEnv(envOut.stdout);
  if (!ports.pgPort) return fail('slot', { error: `agent-stack env ${v.slot} gave no Postgres port` });
  step('slot', true, { slot: v.slot, ...ports });

  // 6. The kickoff prompt, next to the record in ~/lanes, never in the worktree.
  // A repo may name its own template; otherwise the one in config.
  const repoEntry = config.repos.find((r) => r.name === v.repo);
  const template = await fsp.readFile(repoEntry?.kickoff || config.kickoff, 'utf8');
  const prompt = v.promptOverride ?? renderKickoff(template, {
    lane: v.lane, plan: v.plan, root: v.root, branch: v.branch, slot: v.slot,
    human: config.human, ...ports,
  });
  await store.writePrompt(v.lane, prompt);
  step('kickoff', true, { file: path.join(store.laneDir(v.lane), 'prompt.txt') });

  // 7. The session, with the slot's environment eval'd in its own command.
  try {
    await deps.actions.spawn({
      name: v.lane, dir: v.root, model: v.model, permissionMode: v.permissionMode, slot: v.slot,
    }, 'launch');
  } catch (err) {
    return fail('session', { error: err.message });
  }
  step('session', true, { name: v.lane });

  // 8. Rule 8, before a single word is typed.
  const pid = await waitForClaudePid(v.lane, 45000);
  if (!pid) {
    await killLaneSession(v.lane);
    return fail('env', { error: 'claude never registered in 45 s; session killed' });
  }
  let env;
  try {
    env = parseEnviron(await fsp.readFile(`/proc/${pid}/environ`));
  } catch (err) {
    await killLaneSession(v.lane);
    return fail('env', { error: `cannot read /proc/${pid}/environ: ${err.code || err.message}; session killed` });
  }
  const verdict = checkLaneEnv(env, ports.pgPort);
  if (!verdict.ok) {
    await killLaneSession(v.lane);
    return fail('env', { error: `${verdict.reason}; session killed`, pid, ports: verdict.ports });
  }
  step('env', true, { pid, ports: verdict.ports });

  // The worktree is new, so Claude asks whether to trust it. The laneboard made
  // that directory a minute ago for this session; answering is the launch's job.
  const trust = await acceptTrustFor(v.lane, v.root, 60000);
  if (trust === 'accepted') step('trust', true, { dir: v.root });

  // Claude falls back to manual mode where auto is unavailable (measured: on
  // Haiku), and an unattended lane in manual mode sits on its first permission
  // prompt. Not fatal — the session is fine for a human — but said out loud.
  const mode = await shownMode(v.lane);
  if (mode && mode !== v.permissionMode) {
    step('mode', false, { warning: `asked for ${v.permissionMode}, the session shows ${mode} mode`, fatal: false });
  }

  const delivered = await deps.actions.deliverPrompt(v.lane, prompt, 'launch', { timeoutMs: 120000 });
  if (!delivered.ok) return fail('prompt', { error: delivered.reason });
  step('prompt', true, { chars: prompt.length });
  step('done', true, { lane: v.lane, slot: v.slot, root: v.root });
  return true;
}

async function waitForClaudePid(name, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await deps.state.tick();
    const pid = deps.state.get(name)?.claude?.pid;
    if (pid) return pid;
    // Before it registers (e.g. on the trust dialog) the pane's child is it.
    const child = await paneClaudePid(name);
    if (child) return child;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/** The claude process under the session's pane shell, found through /proc. */
async function paneClaudePid(name) {
  const r = await run('tmux', ['list-panes', '-t', `=${name}`, '-F', '#{pane_pid}'], { timeout: 3000 });
  const shell = Number(r.stdout.trim().split('\n')[0]);
  if (!r.ok || !shell) return null;
  try {
    const kids = (await fsp.readFile(`/proc/${shell}/task/${shell}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean);
    for (const k of kids) {
      const comm = (await fsp.readFile(`/proc/${k}/comm`, 'utf8')).trim();
      if (comm === 'claude' || comm.startsWith('claude')) return Number(k);
    }
  } catch { /* gone, or not yet */ }
  return null;
}

async function acceptTrustFor(name, dir, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    await deps.state.tick();
    const s = deps.state.get(name);
    if (!s?.paneId) continue;
    const lines = await deps.capturePane(s.paneId, { ansi: true });
    const readiness = deps.state.promptReadiness(lines);
    if (readiness === 'ready') return 'not-needed';
    if (readiness !== 'trust_dialog') continue;
    if (s.dir && path.resolve(s.dir) !== path.resolve(dir)) return 'wrong-dir';
    await run('tmux', ['send-keys', '-t', s.paneId, 'Enter'], { timeout: 3000 });
    return 'accepted';
  }
  return 'timeout';
}

/** The permission mode the TUI's footer shows ("auto mode on"), or null. */
export function modeFromPane(lines) {
  const text = lines.map((l) => stripAnsi(String(l))).join('\n');
  const m = /\b(auto|manual|plan|acceptEdits|bypassPermissions|dontAsk|accept edits|bypass permissions) mode on\b/i.exec(text);
  return m ? m[1].toLowerCase().replace('accept edits', 'acceptEdits').replace('bypass permissions', 'bypassPermissions') : null;
}

async function shownMode(name) {
  for (let i = 0; i < 10; i++) {
    const s = deps.state.get(name);
    if (s?.paneId) {
      const mode = modeFromPane(await deps.capturePane(s.paneId, { ansi: true }));
      if (mode) return mode;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

async function killLaneSession(name) {
  await run('tmux', ['kill-session', '-t', `=${name}`], { timeout: 5000 });
}

/**
 * On start: a job whose last step is not terminal was cut off by a restart.
 * It is marked interrupted at the step it reached, never resumed.
 */
export function markInterrupted() {
  for (const j of db.unfinishedJobs()) {
    const last = j.steps.at(-1);
    db.addJobStep({ job: j.job, lane: j.lane, kind: j.kind, step: 'interrupted', ok: false, detail: { after: last?.step } });
    log.warn(`${j.kind} ${j.lane} was interrupted by a restart after step ${last?.step}`);
  }
}

export function jobs({ lane = null } = {}) {
  return db.latestJobs({ lane });
}
