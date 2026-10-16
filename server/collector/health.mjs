// Builder health (fleet plan §7.3.3, O6): a 10 s sampler with a 1 h ring.
//
// Separate from vitals.mjs (which keeps feeding the existing card). Everything
// here is read-only: /proc files, fs.statfs, an optional GET on the Docker
// socket, and an optional `tailscale status` at most once per 60 s. The
// parsers are pure and the sampler takes injectable deps, so tests run on the
// fixtures under test/fixtures/proc/ and never need Docker or Tailscale.
//
// What goes on the wire is numbers and booleans only, plus the configured
// paths of the measured filesystems. Tailscale is reduced to {online,
// backendState}: no IPs, no hostnames, no DNS names.
//
// Thresholds come from config.health.thresholds (server/config/observability.mjs,
// O2). A level is raised only once it has held for 2 consecutive samples, and
// at the lower of the two levels (warn then crit raises warn; crit twice
// raises crit). It clears as soon as one sample is below it.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { HEALTH_THRESHOLDS, defaults as obsDefaults } from '../config/observability.mjs';
import { log } from '../log.mjs';
import { run } from '../util.mjs';

export const RING_MAX = 360; // 10 s × 1 h with the default config
export const RING_HARD_MAX = 3600; // whatever the config says
export const HISTORY_POINTS = 120; // the thinned history the route returns
export const DOCKER_TIMEOUT_MS = 2000;
export const DOCKER_MAX_BYTES = 4 * 1024 * 1024;
export const TAILSCALE_EVERY_MS = 60_000;
export const REBOOT_REQUIRED_FILE = '/var/run/reboot-required';

const PROC = {
  stat: '/proc/stat',
  meminfo: '/proc/meminfo',
  vmstat: '/proc/vmstat',
  loadavg: '/proc/loadavg',
  uptime: '/proc/uptime',
  psiCpu: '/proc/pressure/cpu',
  psiMemory: '/proc/pressure/memory',
  psiIo: '/proc/pressure/io',
};
export const PROC_FILES = Object.freeze({ ...PROC });

const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MIB = 1024 * 1024;

// --- pure parsers --------------------------------------------------------------

/** {total, idle, iowait, steal} (jiffies) from the aggregate 'cpu ' line, or null. */
export function parseStat(text) {
  const line = String(text ?? '').split('\n').find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  if (f.length < 4 || f.some((n) => !Number.isFinite(n))) return null;
  // user nice system idle iowait irq softirq steal [guest guest_nice]: guest
  // time is already counted in user/nice, so only the first 8 make the total.
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  return { total: user + nice + system + idle + iowait + irq + softirq + steal, idle, iowait, steal };
}

/** {busyPct, iowaitPct, stealPct} between two parseStat results (nulls when unknown). */
export function cpuDelta(prev, next) {
  const none = { busyPct: null, iowaitPct: null, stealPct: null };
  if (!prev || !next) return none;
  const dt = next.total - prev.total;
  if (!(dt > 0)) return none;
  const di = Math.max(0, next.idle - prev.idle);
  const dw = Math.max(0, next.iowait - prev.iowait);
  const ds = Math.max(0, next.steal - prev.steal);
  const pct = (n) => r1(Math.min(100, Math.max(0, (n / dt) * 100)));
  return { busyPct: pct(dt - di - dw), iowaitPct: pct(dw), stealPct: pct(ds) };
}

/** {memTotalKb, memAvailableKb, swapTotalKb, swapFreeKb} from /proc/meminfo. */
export function parseMeminfo(text) {
  const kv = {};
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kv[m[1]] = Number(m[2]);
  }
  return {
    memTotalKb: kv.MemTotal ?? null,
    memAvailableKb: kv.MemAvailable ?? null,
    swapTotalKb: kv.SwapTotal ?? null,
    swapFreeKb: kv.SwapFree ?? null,
  };
}

/** {pswpin, pswpout} (pages, cumulative) from /proc/vmstat. */
export function parseVmstat(text) {
  const out = { pswpin: null, pswpout: null };
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(pswpin|pswpout)\s+(\d+)/.exec(line);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** {inPerSec, outPerSec} (pages/s) between two parseVmstat results. */
export function swapRate(prev, next, dtMs) {
  const none = { inPerSec: null, outPerSec: null };
  if (!prev || !next || !(dtMs > 0)) return none;
  const rate = (a, b) => (isNum(a) && isNum(b) && b >= a ? r1((b - a) / (dtMs / 1000)) : null);
  return { inPerSec: rate(prev.pswpin, next.pswpin), outPerSec: rate(prev.pswpout, next.pswpout) };
}

function pressureLine(line) {
  const out = {};
  for (const m of line.matchAll(/(avg10|avg60|avg300|total)=([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return ['avg10', 'avg60', 'avg300', 'total'].every((k) => isNum(out[k])) ? out : null;
}

/** {some:{avg10,avg60,avg300,total}, full:{...}|null}; `full` is absent for cpu on older kernels. */
export function parsePressure(text) {
  let some = null;
  let full = null;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('some ')) some = pressureLine(line);
    else if (line.startsWith('full ')) full = pressureLine(line);
  }
  return some ? { some, full } : null;
}

/** [l1, l5, l15] from /proc/loadavg, or null. */
export function parseLoadavg(text) {
  const f = String(text ?? '').trim().split(/\s+/).slice(0, 3).map(Number);
  return f.length === 3 && f.every(Number.isFinite) ? f : null;
}

/** Seconds since boot from /proc/uptime, or null. */
export function parseUptime(text) {
  const w = String(text ?? '').trim().split(/\s+/)[0];
  const n = w ? Number(w) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** {online, backendState} from `tailscale status --json`, nothing else. */
export function parseTailscale(text) {
  let j;
  try {
    j = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const st = typeof j.BackendState === 'string' ? j.BackendState.slice(0, 32) : null;
  return { online: j.Self?.Online === true, backendState: st };
}

/** {ok, running, unhealthy, restarting} from GET /containers/json; ok = none unhealthy or restarting. */
export function dockerCounts(list) {
  if (!Array.isArray(list)) return null;
  let running = 0;
  let unhealthy = 0;
  let restarting = 0;
  for (const c of list) {
    if (c?.State === 'running') running++;
    if (c?.State === 'restarting') restarting++;
    if (typeof c?.Status === 'string' && c.Status.includes('(unhealthy)')) unhealthy++;
  }
  return { ok: unhealthy === 0 && restarting === 0, running, unhealthy, restarting };
}

/** {mount, path, sizeMb, availMb, usedPct} from an fs.statfs result (df's arithmetic). */
export function fsEntry(mount, p, st) {
  const bs = Number(st.bsize);
  const blocks = Number(st.blocks);
  const bfree = Number(st.bfree);
  const bavail = Number(st.bavail);
  const used = blocks - bfree;
  const denom = used + bavail;
  return {
    mount,
    path: p,
    sizeMb: Math.round((blocks * bs) / MIB),
    availMb: Math.round((bavail * bs) / MIB),
    usedPct: denom > 0 ? r1((used / denom) * 100) : null,
  };
}

// --- thresholds ---------------------------------------------------------------

const LEVELS = { warn: 1, crit: 2 };

const LABEL = {
  swapInPerSec: (v) => `swap-in ${v} pages/s`,
  memAvailPct: (v) => `memory available ${v}%`,
  psiMemFull10: (v) => `memory pressure (full) ${v}%`,
  psiIoFull10: (v) => `io pressure (full) ${v}%`,
  psiCpuSome10: (v) => `cpu pressure ${v}%`,
  loadPerCpu: (v) => `load ${v} per cpu`,
  dockerUnhealthy: (v) => `${v} docker container(s) unhealthy`,
  rebootRequired: () => 'reboot required',
};

function levelFor(dir, value, t) {
  if (!t) return null;
  if (dir === 'flag') {
    if (value !== true) return null;
    if (t.crit === true) return { level: 'crit', threshold: true };
    return t.warn === true ? { level: 'warn', threshold: true } : null;
  }
  if (!isNum(value)) return null;
  const hit = (th) => isNum(th) && (dir === 'down' ? value < th : value >= th);
  if (hit(t.crit)) return { level: 'crit', threshold: t.crit };
  if (hit(t.warn)) return { level: 'warn', threshold: t.warn };
  return null;
}

/** The threshold inputs of a sample: [[key, thresholdKey, value]]. */
function inputs(s) {
  const out = [
    ['swapInPerSec', 'swapInPerSec', s.swap?.inPerSec],
    ['memAvailPct', 'memAvailPct', s.mem?.availPct],
    ['psiMemFull10', 'psiMemFull10', s.psi?.memory?.full10],
    ['psiIoFull10', 'psiIoFull10', s.psi?.io?.full10],
    ['psiCpuSome10', 'psiCpuSome10', s.psi?.cpu?.some10],
    ['loadPerCpu', 'loadPerCpu', s.loadPerCpu],
    ['dockerUnhealthy', 'dockerUnhealthy', s.docker ? s.docker.unhealthy : null],
    ['rebootRequired', 'rebootRequired', s.rebootRequired === true],
  ];
  for (const f of s.fs ?? []) out.push([`fsUsedPct:${f.mount}`, 'fsUsedPct', f.usedPct]);
  return out;
}

/**
 * Raw (undebounced) threshold breaches of one sample:
 * [{key, level:'warn'|'crit', value, threshold, text}]. `cfg` is config.health
 * (or just its thresholds).
 */
export function evaluate(sample, cfg) {
  const th = cfg?.thresholds ?? cfg ?? {};
  const out = [];
  for (const [key, tk, value] of inputs(sample ?? {})) {
    const spec = HEALTH_THRESHOLDS[tk];
    const hit = spec && levelFor(spec.dir, value, th[tk]);
    if (!hit) continue;
    const text = tk === 'fsUsedPct' ? `disk ${key.slice('fsUsedPct:'.length)} ${value}% used` : LABEL[tk](value);
    out.push({ key, level: hit.level, value, threshold: hit.threshold, text });
  }
  return out;
}

/**
 * The 2-sample debounce. `push(raw)` takes evaluate()'s result and returns the
 * raised alarms: a key raised at the lower of its last two raw levels.
 */
export function createDebounce(need = 2) {
  let past = []; // Map key -> raw alarm, newest last
  return {
    push(raw) {
      const now = new Map((raw ?? []).map((a) => [a.key, a]));
      past.push(now);
      if (past.length > need) past = past.slice(-need);
      if (past.length < need) return [];
      const out = [];
      for (const [key, a] of now) {
        const all = past.map((m) => m.get(key));
        if (all.some((x) => !x)) continue;
        const low = all.reduce((m, x) => (LEVELS[x.level] < LEVELS[m.level] ? x : m));
        out.push(low === a ? a : { ...a, level: low.level, threshold: low.threshold });
      }
      return out;
    },
    reset() {
      past = [];
    },
  };
}

// --- ring ----------------------------------------------------------------------

export function createRing(cap = RING_MAX) {
  const size = Math.max(1, Math.min(RING_HARD_MAX, Math.floor(cap)));
  const buf = [];
  return {
    size,
    push(x) {
      buf.push(x);
      if (buf.length > size) buf.splice(0, buf.length - size);
    },
    list() {
      return buf.slice();
    },
    get length() {
      return buf.length;
    },
    last() {
      return buf.length ? buf[buf.length - 1] : null;
    },
    clear() {
      buf.length = 0;
    },
  };
}

/** Every k-th entry so at most `max` remain; the newest is always kept. */
export function thin(list, max = HISTORY_POINTS) {
  if (list.length <= max) return list.slice();
  const k = Math.ceil(list.length / max);
  const out = [];
  for (let i = list.length - 1; i >= 0 && out.length < max; i -= k) out.push(list[i]);
  return out.reverse();
}

// --- default IO (read-only) ------------------------------------------------------

/**
 * GET /containers/json on the Docker socket, nothing else. Resolves the parsed
 * list; rejects on any error (the caller turns that into `docker: null`).
 */
export function dockerGet(socketPath, { request = http.request, timeoutMs = DOCKER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (!done) {
        done = true;
        fn(v);
      }
    };
    const req = request(
      { socketPath, path: '/containers/json', method: 'GET', timeout: timeoutMs, headers: { accept: 'application/json' } },
      (res) => {
        const chunks = [];
        let n = 0;
        res.on('data', (c) => {
          n += c.length;
          if (n > DOCKER_MAX_BYTES) {
            req.destroy(new Error('docker response too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (res.statusCode !== 200) return finish(reject, new Error(`docker status ${res.statusCode}`));
          try {
            finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            finish(reject, err);
          }
        });
        res.on('error', (err) => finish(reject, err));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('docker timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => finish(reject, err));
    req.end();
  });
}

/** `tailscale status --json --self --peers=false` reduced to {online, backendState}. */
export async function tailscaleStatus({ runner = run } = {}) {
  const r = await runner('tailscale', ['status', '--json', '--self', '--peers=false'], { timeout: 5000 });
  // `tailscale status` exits non-zero when stopped but still prints JSON.
  const parsed = r?.stdout ? parseTailscale(r.stdout) : null;
  if (!parsed) throw new Error(r?.ok ? 'tailscale: unparseable status' : 'tailscale: status failed');
  return parsed;
}

/** A tailscale getter that runs `fn` at most once per `everyMs` and caches the result. */
export function throttled(fn, everyMs = TAILSCALE_EVERY_MS) {
  let at = -Infinity;
  let value = null;
  let error = null;
  return async (now = Date.now()) => {
    if (now - at >= everyMs) {
      at = now;
      try {
        value = await fn();
        error = null;
      } catch (err) {
        value = null;
        error = err;
      }
    }
    if (error) throw error;
    return value;
  };
}

// --- sampler -----------------------------------------------------------------

const logged = new Set();
function logOnce(key, msg) {
  if (logged.has(key)) return;
  logged.add(key);
  log.warn(msg);
}

async function readOrNull(readFile, p) {
  try {
    return String(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

function psiOf(p, full) {
  if (!p) return full ? { some10: null, full10: null } : { some10: null };
  const o = { some10: p.some.avg10 };
  if (full) o.full10 = p.full ? p.full.avg10 : null;
  return o;
}

/**
 * One health sample. `deps` (all optional, injectable for tests):
 *   readFile(path, 'utf8')  async /proc reader
 *   statfs(path)            async fs.statfs
 *   exists(path)            reboot-required check
 *   dockerGet()             async container list, or null to skip Docker
 *   tailscale(now)          async {online, backendState}, or null to skip
 *   slots()                 collector/slots.mjs snapshot().slots (array)
 *   now()                   ms clock
 *   vcpu                    cpu count
 *   cfg                     config.health (thresholds, dockerRoot, worktreeDir)
 *   worktreeDir             fallback for cfg.worktreeDir (config.codeDir)
 *   state                   {prev, debounce} carried between samples
 * `alarms` is debounced through state.debounce when given, else raw.
 */
export async function sampleOnce(deps = {}) {
  const readFile = deps.readFile ?? fs.promises.readFile;
  const statfs = deps.statfs ?? fs.promises.statfs;
  const exists = deps.exists ?? fs.existsSync;
  const now = deps.now ?? Date.now;
  const cfg = deps.cfg ?? obsDefaults().health;
  const st = deps.state ?? {};
  const vcpu = deps.vcpu ?? os.availableParallelism();
  const at = now();

  const [statT, memT, vmT, loadT, upT, pc, pm, pi] = await Promise.all(
    [PROC.stat, PROC.meminfo, PROC.vmstat, PROC.loadavg, PROC.uptime, PROC.psiCpu, PROC.psiMemory, PROC.psiIo]
      .map((p) => readOrNull(readFile, p)),
  );
  const stat = parseStat(statT);
  const vm = parseVmstat(vmT);
  const mi = parseMeminfo(memT);
  const load = parseLoadavg(loadT);
  const prev = st.prev ?? null;

  const cpu = cpuDelta(prev?.stat, stat);
  const sr = swapRate(prev?.vm, vm, prev ? at - prev.at : 0);
  st.prev = { at, stat, vm };

  const kbMb = (kb) => (isNum(kb) ? Math.round(kb / 1024) : null);
  const mem = {
    totalMb: kbMb(mi.memTotalKb),
    availMb: kbMb(mi.memAvailableKb),
    availPct: isNum(mi.memTotalKb) && mi.memTotalKb > 0 && isNum(mi.memAvailableKb)
      ? r1((mi.memAvailableKb / mi.memTotalKb) * 100) : null,
  };
  const swap = {
    totalMb: kbMb(mi.swapTotalKb),
    usedMb: isNum(mi.swapTotalKb) && isNum(mi.swapFreeKb) ? kbMb(mi.swapTotalKb - mi.swapFreeKb) : null,
    inPerSec: sr.inPerSec,
    outPerSec: sr.outPerSec,
  };

  const mounts = [['/', '/'], ['docker', cfg.dockerRoot], ['worktrees', cfg.worktreeDir ?? deps.worktreeDir ?? null]];
  const fsOut = [];
  for (const [mount, p] of mounts) {
    if (!p) continue;
    try {
      fsOut.push(fsEntry(mount, p, await statfs(p)));
    } catch (err) {
      // A missing docker root is normal (no Docker on this box): skip it.
      if (err?.code !== 'ENOENT') logOnce(`statfs:${mount}:${err?.code}`, `health: statfs ${mount} failed: ${err?.code || err?.message}`);
    }
  }

  let docker = null;
  if (deps.dockerGet !== null) {
    const get = deps.dockerGet ?? (cfg.dockerSocket ? () => dockerGet(cfg.dockerSocket) : null);
    if (get) {
      try {
        docker = dockerCounts(await get());
      } catch (err) {
        logOnce(`docker:${err?.code ?? 'error'}`, `health: docker unavailable (${err?.code || err?.message}); reporting docker: null`);
        docker = null;
      }
    }
  }

  let tailscale = null;
  if (deps.tailscale) {
    try {
      const t = await deps.tailscale(at);
      tailscale = t ? { online: t.online === true, backendState: typeof t.backendState === 'string' ? t.backendState : null } : null;
    } catch {
      tailscale = null;
    }
  }

  let slots = null;
  if (deps.slots) {
    try {
      const list = deps.slots();
      if (Array.isArray(list)) slots = { total: list.length, inUse: list.filter((x) => x?.lane).length };
    } catch {
      slots = null;
    }
  }

  let rebootRequired = false;
  try {
    rebootRequired = Boolean(exists(REBOOT_REQUIRED_FILE));
  } catch {
    rebootRequired = false;
  }

  const sample = {
    at,
    uptimeS: parseUptime(upT),
    vcpu,
    cpu,
    load,
    loadPerCpu: load && vcpu > 0 ? Math.round((load[0] / vcpu) * 100) / 100 : null,
    mem,
    swap,
    psi: {
      cpu: psiOf(parsePressure(pc), false),
      memory: psiOf(parsePressure(pm), true),
      io: psiOf(parsePressure(pi), true),
    },
    fs: fsOut,
    docker,
    slots,
    rebootRequired,
    tailscale,
    alarms: [],
  };
  const raw = evaluate(sample, cfg);
  const raised = st.debounce ? st.debounce.push(raw) : raw;
  sample.alarms = raised.map(({ key, level, text }) => ({ key, level, text }));
  return sample;
}

// --- module-level sampler (one per process) ------------------------------------

let ring = createRing(RING_MAX);
let timer = null;
let state = { prev: null, debounce: createDebounce(2) };
let running = false;

/**
 * Start sampling. opts: {cfg (config.health), worktreeDir (config.codeDir),
 * slots(), onSample(sample), deps (overrides for sampleOnce)}. Idempotent.
 */
export function start(opts = {}) {
  if (timer) return;
  const cfg = opts.cfg ?? obsDefaults().health;
  const sampleMs = Math.max(1000, Number(cfg.sampleMs) || 10000);
  ring = createRing(Math.ceil(((Number(cfg.historyMin) || 60) * 60_000) / sampleMs));
  state = { prev: null, debounce: createDebounce(2) };
  const tailscale = opts.deps?.tailscale !== undefined
    ? opts.deps.tailscale
    : (cfg.tailscale ? throttled(() => tailscaleStatus()) : null);
  const deps = { cfg, worktreeDir: opts.worktreeDir, slots: opts.slots, ...opts.deps, tailscale, state };
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await sampleOnce(deps);
      ring.push(s);
      try {
        opts.onSample?.(s);
      } catch (err) {
        log.error('health onSample failed', String(err?.message || err));
      }
    } catch (err) {
      log.error('health sample failed', String(err?.message || err));
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, sampleMs);
  timer.unref?.();
  tick();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** The newest sample, or null before the first. */
export function latest() {
  return ring.last();
}

/** The ring (oldest first), optionally from `since` (ms) on, thinned to `max` points. */
export function history({ since = null, max = HISTORY_POINTS } = {}) {
  let list = ring.list();
  if (isNum(since)) list = list.filter((s) => s.at >= since);
  return thin(list, max);
}

/** Tests only: push a sample straight into the ring. */
export function _push(s) {
  ring.push(s);
}

/** Tests only. */
export function _reset(cap = RING_MAX) {
  stop();
  ring = createRing(cap);
  state = { prev: null, debounce: createDebounce(2) };
  logged.clear();
}

export function _ringSize() {
  return ring.size;
}
