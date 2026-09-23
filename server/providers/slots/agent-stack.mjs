// The agent-stack slot provider.
//
// An external script — `agent-stack up|env|down|status <slot>` — brings up a
// private Postgres/Redis/MinIO per slot as docker compose project `agent<N>`,
// with host ports 15432/16379/19000 shifted by 100 per slot. laneboard calls
// it and never copies, edits or reimplements it; the one thing it does behind
// the script's back is remove that project's volumes by compose label on
// retire, because `down` leaves them.
//
// Everything here is the code v3 ran, moved: the parsers are byte-for-byte.
import { config } from '../../config.mjs';
import { run } from '../../util.mjs';

export const name = 'agent-stack';
export const available = true;
export const slotCount = 5;

const BASE = { pg: 15432, redis: 16379, s3: 19000 };

/** Slot N's host ports: +100 per slot above 1. */
export function ports(n) {
  const d = (Number(n) - 1) * 100;
  return { pg: BASE.pg + d, redis: BASE.redis + d, s3: BASE.s3 + d };
}

/** The compose project a slot's containers and volumes carry. */
export function project(n) { return `agent${Number(n)}`; }

/** What a spawned session must eval to get the slot's environment. */
export function envCommand(n, quote) {
  return `eval "$(${quote(config.slots.bin)} env ${Number(n)})"; `;
}

/** "2026-09-21 08:54:26 +0000 UTC" -> ms, or NaN. */
export function parseDockerTime(text) {
  const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-])(\d\d)(\d\d)/.exec(String(text || '').trim());
  return m ? Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`) : NaN;
}

/**
 * `docker ps -a --format '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.State}}\t{{.CreatedAt}}'`
 * rows -> Map(slot -> { containers[], up, createdAt }).
 */
export function parseSlotRows(text) {
  const bySlot = new Map();
  for (const line of String(text).split('\n')) {
    const [proj, cname, state, created] = line.split('\t');
    const m = /^agent([1-9])$/.exec(proj || '');
    if (!m) continue;
    const n = Number(m[1]);
    if (!bySlot.has(n)) bySlot.set(n, { containers: [], up: false, createdAt: null });
    const s = bySlot.get(n);
    s.containers.push({ name: cname, state });
    if (state === 'running') s.up = true;
    const t = parseDockerTime(created);
    if (Number.isFinite(t) && (s.createdAt == null || t < s.createdAt)) s.createdAt = t;
  }
  return bySlot;
}

/** `agent-stack env N` output -> the ports, never the passwords. */
export function portsFromEnv(text) {
  const vars = {};
  for (const line of String(text).split('\n')) {
    const m = /^\s*export\s+([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return {
    pgPort: Number(vars.PGPORT) || urlPort(vars.DATABASE_ADMIN_URL),
    redisPort: urlPort(vars.REDIS_URL),
    s3Port: urlPort(vars.S3_ENDPOINT_URL),
  };
}

/** The port of a URL, or null. Shared with the launch environment check. */
export function urlPort(u) {
  if (!u) return null;
  const m = /:(\d{2,5})(?:\/|$|\?)/.exec(String(u));
  return m ? Number(m[1]) : null;
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

// --- the interface -----------------------------------------------------------

/** Every slot docker knows about, for the Box. */
export async function list() {
  const r = await run('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project',
    '--format', '{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.State}}\t{{.CreatedAt}}'], { timeout: 8000 });
  return r.ok ? { ok: true, bySlot: parseSlotRows(r.stdout) } : { ok: false, bySlot: new Map() };
}

/**
 * The slots that exist, asked of the stack itself rather than of docker.
 * `null` means "cannot tell" — and a launch refuses rather than guessing,
 * because two lanes on one slot is exactly what slots exist to prevent.
 */
export async function existing() {
  const r = await run(config.slots.bin, ['status'], { timeout: 20000 });
  return r.ok ? slotsFromStatus(r.stdout) : null;
}

export async function up(n, { cwd, env: childEnv } = {}) {
  const r = await run(config.slots.bin, ['up', String(n)], {
    timeout: 10 * 60000, env: childEnv, cwd, maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, code: r.code, signal: r.signal };
}

export async function env(n) {
  const r = await run(config.slots.bin, ['env', String(n)], { timeout: 20000 });
  if (!r.ok) return { ok: false, error: `agent-stack env ${n} exited ${r.code}`, ports: {} };
  const p = portsFromEnv(r.stdout);
  if (!p.pgPort) return { ok: false, error: `agent-stack env ${n} gave no Postgres port`, ports: p };
  return { ok: true, ports: p };
}

export async function down(n) {
  const r = await run(config.slots.bin, ['down', String(n)], { timeout: 120000 });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.trim().slice(-300) };
}

/**
 * `down` stops the containers and leaves the volumes — about 200 MB a slot.
 * They are removed by compose label, and then every name is checked against
 * the project prefix again before anything is deleted: belt and braces on the
 * one destructive call in the whole program.
 */
export async function dropVolumes(n) {
  const proj = project(n);
  const ls = await run('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${proj}`], { timeout: 20000 });
  const names = ls.ok ? ls.stdout.split('\n').map((v) => v.trim()).filter(Boolean) : [];
  const own = names.filter((v) => v.startsWith(`${proj}_`));
  const skipped = names.filter((v) => !own.includes(v));
  if (!own.length) return { ok: true, removed: [], skipped };
  const rm = await run('docker', ['volume', 'rm', ...own], { timeout: 60000 });
  return rm.ok
    ? { ok: true, removed: own, skipped }
    : { ok: false, error: rm.stderr.trim().slice(-300), removed: [], skipped, volumes: own };
}
