// The `ports` guard provider: a live stack next to us, watched from outside.
//
// Read-only by construction. What this file does, all of it: an HTTP GET
// against each configured health probe, `docker ps` filtered by name,
// `ss -Htnp state established`, and /proc reads. It never connects to a
// guarded port, never touches a container, never acts. collector/guard.mjs
// owns the timer and turns what comes back into markers.
//
// Two checks, both producing `danger`:
//   preventive  every Claude session's /proc/<pid>/environ: a DATABASE_* URL
//               on a forbidden port, or none at all in a session working in a
//               checkout of the repo whose tests would fall back to one
//   detective   an established connection from one of OUR processes to a
//               forbidden port. A live stack's own traffic stays inside its
//               Docker network, so the expected count is zero.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.mjs';
import { run } from '../../util.mjs';
import { parseEnviron, DB_VARS } from '../../lanes/launch.mjs';

export const name = 'ports';
export const active = true;

export function forbiddenPorts() { return config.guard.forbiddenPorts ?? []; }
export function healthProbes() { return config.guard.healthProbes ?? []; }
export function containerFilter() { return config.guard.containerFilter || ''; }

// --- pure --------------------------------------------------------------------

/**
 * Preventive verdict for one session's environment, or null when it is fine.
 * `platform`: the session works in a checkout of `config.guard.platformRepo`, whose
 * test suites fall back to a shared database when no DATABASE_* is set.
 */
export function envDanger(env, { platform, ports = forbiddenPorts() } = {}) {
  for (const k of DB_VARS) {
    const p = portOf(env[k]);
    if (p != null && ports.includes(p)) return `${k} points at :${p}, which is forbidden`;
  }
  if (platform && !env.DATABASE_ADMIN_URL && !env.DATABASE_URL) {
    return `no DATABASE_* in a ${config.guard.platformRepo} checkout: its tests would fall back to a shared database`;
  }
  return null;
}

/** The port of a URL, or null. */
export function portOf(u) {
  if (!u) return null;
  const m = /:(\d{2,5})(?:\/|$|\?)/.exec(String(u));
  return m ? Number(m[1]) : null;
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
export function isPlatformDir(dir, repo = config.guard.platformRepo) {
  if (!dir || !repo) return false;
  const parts = path.resolve(dir).split(path.sep);
  return parts.some((p) => p === repo || p.startsWith(`${repo}-`));
}

// --- live --------------------------------------------------------------------

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

/** Every configured probe, as the Box shows them. */
export async function health() {
  return Promise.all(healthProbes().map(async (p) => ({ name: p.name || p.url, url: p.url, ...(await probe(p.url)) })));
}

/** The containers matching the configured name filter. Empty filter, no call. */
export async function containers() {
  const filter = containerFilter();
  if (!filter) return { ok: true, list: [] };
  const r = await run('docker', ['ps', '-a', '--filter', `name=${filter}`, '--format', '{{.Names}}\t{{.State}}\t{{.Status}}'], { timeout: 8000 });
  return { ok: r.ok, list: r.ok ? parseDockerPs(r.stdout) : null };
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

/** The environment of every live Claude session, checked against the rules. */
export async function preventive(sessions) {
  const found = [];
  for (const s of sessions ?? []) {
    const pid = s.claude?.pid;
    if (!pid) continue;
    let env;
    try { env = parseEnviron(await fsp.readFile(`/proc/${pid}/environ`)); } catch { continue; }
    const reason = envDanger(env, { platform: isPlatformDir(s.dir) });
    if (reason) found.push({ session: s.name, lane: s.lane ?? null, pid, reason });
  }
  return found;
}

/**
 * Established connections to a forbidden port. `null` means ss could not be
 * run, which is a state and not a finding. `laneOf` maps a session name to
 * its lane, so a hit lands on the right card.
 */
export async function detective(laneOf = () => null) {
  const ports = forbiddenPorts();
  if (!ports.length) return [];
  const r = await run('ss', ['-Htnp', 'state', 'established'], { timeout: 5000 });
  if (!r.ok) return null;
  const hits = parseSs(r.stdout, ports);
  if (!hits.length) return [];
  const panes = await paneMap();
  const out = [];
  for (const h of hits) {
    const session = await sessionOfPid(h.pid, panes);
    out.push({ ...h, session, lane: session ? laneOf(session) : null, reason: `${h.comm} (pid ${h.pid}) is connected to :${h.port}` });
  }
  return out;
}
