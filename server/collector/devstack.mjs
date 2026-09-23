// A live stack next to us, watched from outside, and the guard that keeps
// agents off it.
//
// Read-only by construction. What this file does, all of it: an HTTP GET
// against each configured health probe, `docker ps` filtered by name,
// `ss -Htnp state established`, and /proc reads. It never connects to a
// guarded port, never touches a container, never acts.
//
// The guard, two checks, both producing `danger` markers:
//   preventive  every Claude session's /proc/<pid>/environ: a DATABASE_* URL on
//               a guarded port, or none at all in a session working in a
//               checkout of the repo whose tests would fall back to one
//   detective   an established connection from one of OUR processes to a
//               guarded port. A live stack's own traffic stays inside its
//               Docker network, so the expected count is zero.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { run } from '../util.mjs';
import * as markers from './markers.mjs';
import { parseEnviron, urlPort, DB_VARS } from '../lanes/launch.mjs';

// --- pure --------------------------------------------------------------------

/**
 * Preventive verdict for one session's environment, or null when it is fine.
 * `platform`: the session works in a checkout of `config.platformRepo`, whose
 * test suites fall back to a shared database when no DATABASE_* is set.
 */
export function envDanger(env, { platform }) {
  for (const k of DB_VARS) {
    if (urlPort(env[k]) === 5432) return `${k} points at :5432, the dev stack`;
  }
  if (platform && !env.DATABASE_ADMIN_URL && !env.DATABASE_URL) {
    return 'no DATABASE_* in a platform checkout: its tests would fall back to :5432';
  }
  return null;
}

/** "127.0.0.1:5432" / "[::1]:5432" / "[::ffff:127.0.0.1]:5432" -> { host, port } */
export function splitAddr(a) {
  const m = /^\[?(.*?)\]?:(\d+)$/.exec(String(a).trim());
  return m ? { host: m[1], port: Number(m[2]) } : { host: null, port: null };
}

/** Loopback, or an address on a Docker bridge (172.16/12), where a container port could be reached directly. */
export function isLocalish(host) {
  const h = String(host || '').replace(/^::ffff:/, '');
  if (h === '127.0.0.1' || h === '::1' || h === 'localhost' || h.startsWith('127.')) return true;
  const m = /^172\.(\d+)\./.exec(h);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

/**
 * `ss -Htnp state established` -> connections to a watched port. Only rows
 * with a users:(…) field are kept: ss shows the owner only for processes of
 * our own user, which is exactly the set we are responsible for.
 */
export function parseSs(text, ports) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    // With `state established` the State column is dropped: Recv-Q Send-Q Local Peer [Process]
    const [, , local, peer, ...rest] = cols;
    const p = splitAddr(peer);
    if (!ports.includes(p.port) || !isLocalish(p.host)) continue;
    const proc = rest.join(' ');
    const m = /users:\(\("([^"]+)",pid=(\d+)/.exec(proc);
    if (!m) continue;
    out.push({ local, peer, port: p.port, comm: m[1], pid: Number(m[2]) });
  }
  return out;
}

/** `docker ps` rows -> { name, state, status }. */
export function parseDockerPs(text) {
  return String(text).split('\n').filter(Boolean).map((l) => {
    const [name, state, status] = l.split('\t');
    return { name, state, status };
  });
}

/** Is this directory a platform checkout (main or a lane worktree)? */
export function isPlatformDir(dir, repo = config.platformRepo) {
  if (!dir || !repo) return false;
  const parts = path.resolve(dir).split(path.sep);
  return parts.some((p) => p === repo || p.startsWith(`${repo}-`));
}

// --- live --------------------------------------------------------------------

let deps = { state: null, onDanger: () => {} };
export function init(d) { deps = { ...deps, ...d }; }

let snap = {
  health: null, containers: [],
  guard: { ok: true, preventive: [], detective: [], checkedAt: 0 },
  at: 0,
};

export function snapshot() { return snap; }

/** Danger per session name, for the attention score. */
export function dangerFor(name) {
  const g = snap.guard;
  return g.preventive.find((d) => d.session === name) || g.detective.find((d) => d.session === name) || null;
}

async function probe(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'manual' });
    // Drain without reading much; the status is what matters.
    res.body?.cancel?.().catch?.(() => {});
    return { ok: res.status >= 200 && res.status < 400, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - t0, error: err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code || err?.message) };
  }
}

async function ppid(pid) {
  try {
    const stat = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
    // comm can contain spaces and parens; fields resume after the last ')'.
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch {
    return null;
  }
}

/** Walk up from a pid to the tmux pane it runs in; returns the session name or null. */
async function sessionOfPid(pid, paneByPid) {
  let p = pid;
  for (let i = 0; i < 40 && p && p > 1; i++) {
    if (paneByPid.has(p)) return paneByPid.get(p);
    p = await ppid(p);
  }
  return null;
}

async function paneMap() {
  const r = await run('tmux', ['list-panes', '-a', '-F', '#{pane_pid}\t#{session_name}'], { timeout: 3000 });
  const map = new Map();
  if (!r.ok) return map;
  for (const line of r.stdout.split('\n')) {
    const [pid, name] = line.split('\t');
    if (pid && name) map.set(Number(pid), name);
  }
  return map;
}

async function preventive() {
  const found = [];
  for (const s of deps.state?.all?.() ?? []) {
    const pid = s.claude?.pid;
    if (!pid) continue;
    let env;
    try { env = parseEnviron(await fsp.readFile(`/proc/${pid}/environ`)); } catch { continue; }
    const reason = envDanger(env, { platform: isPlatformDir(s.dir) });
    if (reason) found.push({ session: s.name, lane: s.lane ?? null, pid, reason });
  }
  return found;
}

async function detective() {
  const r = await run('ss', ['-Htnp', 'state', 'established'], { timeout: 5000 });
  if (!r.ok) return null;
  const hits = parseSs(r.stdout, config.guardPorts);
  if (!hits.length) return [];
  const panes = await paneMap();
  const out = [];
  for (const h of hits) {
    const session = await sessionOfPid(h.pid, panes);
    const lane = session ? deps.state?.get?.(session)?.lane ?? null : null;
    out.push({ ...h, session, lane, reason: `${h.comm} (pid ${h.pid}) is connected to :${h.port}` });
  }
  return out;
}

function raise(d, check) {
  const who = d.session ? d.session : `pid ${d.pid}`;
  const text = `DANGER: ${check} guard: ${d.reason}${d.session ? '' : ` (${who}, no tmux session)`}`;
  const ts = Date.now();
  // The marker key includes the text, and the text includes the pid, so a new
  // offender is a new marker and the same one is not re-pushed every 15 s.
  const id = markers.record({ lane: d.lane ?? null, sessionName: d.session ?? null, kind: 'danger', text: `${text} [pid ${d.pid}]`, source: 'guard', ts });
  if (id) {
    const row = { id, ts, lane: d.lane ?? null, sessionName: d.session ?? null, kind: 'danger', text: `${text} [pid ${d.pid}]`, source: 'guard' };
    log.warn(row.text);
    deps.onDanger(row);
  }
}

export async function refresh() {
  const [api, web, ps] = await Promise.all([
    probe(`http://127.0.0.1:${config.devStack.apiPort}${config.devStack.apiPath}`),
    probe(`http://127.0.0.1:${config.devStack.webPort}${config.devStack.webPath}`),
    config.devStack.containerFilter
      ? run('docker', ['ps', '-a', '--filter', `name=${config.devStack.containerFilter}`, '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'], { timeout: 8000 })
      : Promise.resolve({ ok: true, stdout: '' }),
  ]);
  const prev = await preventive();
  const det = await detective();
  for (const d of prev) raise(d, 'preventive');
  for (const d of det ?? []) raise(d, 'detective');
  snap = {
    health: { api, web },
    containers: ps.ok ? parseDockerPs(ps.stdout) : snap.containers,
    dockerOk: ps.ok,
    guard: {
      ok: prev.length === 0 && (det?.length ?? 0) === 0,
      preventive: prev,
      detective: det ?? [],
      ssOk: det != null,
      ports: config.guardPorts,
      checkedAt: Date.now(),
    },
    at: Date.now(),
  };
  return snap;
}

export function start() {
  const tick = () => refresh().catch((err) => log.error('devstack refresh failed', String(err)));
  const first = setTimeout(tick, 3000);
  first.unref();
  const timer = setInterval(tick, config.devStackPollMs);
  timer.unref();
}
