// Boot a real laneboard (`node server/index.mjs`) in a child process, fully
// isolated from the live service and from the user's files (fleet plan §11 X2).
//
//   boot({mode, config, env, trace}) -> {url, port, ingressPort, publicHost,
//        child, tmp, config, logs(), loadedUrls(), stop()}
//   ingressFetch(booted, path, {user, ...init})   a request "through tailscale serve"
//   ingressWs(booted, path, {user, ...opts})       the same for a WebSocket
//   freePort()                                     a free loopback port >= 7790
//
// Isolation (RULES 3): every child gets its own temp dir holding HOME,
// TMUX_TMPDIR, XDG_{STATE,CONFIG,CACHE}_HOME, LANEBOARD_STATE_DIR,
// LANEBOARD_AUDIT_FILE and the LANEBOARD_CONFIG it was given, plus
// LANEBOARD_DB=:memory:. TMUX and TMUX_PANE are removed from its environment:
// tmux prefers the socket named in $TMUX over TMUX_TMPDIR, so a test run from
// inside a tmux pane would otherwise reach the live tmux server, where a
// builder's terminals.sweepStale() kills the live board's `*-web-*` sessions.
// Every inherited LANEBOARD_* variable is dropped as well, so the child sees
// only what the test passed. The port is never 7777.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { generateHubKey, writePrivateKey } from '../../server/fleet/keys-ed25519.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ENTRY = path.join(ROOT, 'server', 'index.mjs');
const LIVE_PORT = 7777;
const PORT_MIN = 7790;
const PORT_MAX = 9790;

/** Children still running, killed if the test process exits without stop(). */
const live = new Set();
process.on('exit', () => {
  for (const b of live) b.killNow();
});

function canListen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

const handedOut = new Set();

/**
 * A loopback port >= 7790 (never 7777) that is free right now and that this
 * process has not handed out before. Random start, so parallel test files
 * rarely collide; boot() retries if the child still loses the race.
 */
export async function freePort({ exclude = [] } = {}) {
  const span = PORT_MAX - PORT_MIN;
  const start = Math.floor(Math.random() * span);
  for (let i = 0; i < span; i++) {
    const port = PORT_MIN + ((start + i) % span);
    if (port === LIVE_PORT || handedOut.has(port) || exclude.includes(port)) continue;
    if (await canListen(port)) {
      handedOut.add(port);
      return port;
    }
  }
  throw new Error(`no free port in ${PORT_MIN}-${PORT_MAX}`);
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function loopbackHost(h) {
  return h === 'localhost' || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/** The Host serve would send: fleet.publicHosts[0], else the host of a non-loopback publicUrl. */
function publicHostOf(cfg, ingressPort) {
  const hosts = cfg?.fleet?.publicHosts;
  if (Array.isArray(hosts) && typeof hosts[0] === 'string') return hosts[0];
  if (typeof cfg?.publicUrl === 'string') {
    try {
      const u = new URL(cfg.publicUrl);
      if (u.host && !loopbackHost(u.hostname)) return u.host;
    } catch { /* fall through */ }
  }
  return ingressPort ? `127.0.0.1:${ingressPort}` : null;
}

// Loaded with --import into a traced child: records every resolved module URL
// (ESM and require) to $LANEBOARD_TEST_TRACE, one per line.
const TRACE_HOOK = 'data:text/javascript,' + encodeURIComponent(`
import fs from 'node:fs';
import { registerHooks } from 'node:module';
const out = process.env.LANEBOARD_TEST_TRACE;
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    try { fs.appendFileSync(out, r.url + '\\n'); } catch {}
    return r;
  },
});
`);

function childEnv(base, extra) {
  const env = {};
  for (const [k, v] of Object.entries(base)) {
    if (k === 'TMUX' || k === 'TMUX_PANE' || k.startsWith('LANEBOARD_')) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

async function waitHealthy(url, child, timeoutMs, logs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const err = new Error(`laneboard exited (${child.exitCode ?? child.signalCode}) before /healthz answered\n${logs().slice(-4000)}`);
      err.exited = true;
      throw err;
    }
    try {
      const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return await r.json();
      lastErr = new Error(`/healthz answered ${r.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`laneboard did not answer /healthz within ${timeoutMs} ms (${lastErr?.message})\n${logs().slice(-4000)}`);
}

async function bootOnce({ mode, config, env, trace, timeoutMs, hubKey }) {
  // Refuse before anything is created.
  if (Number(env.LANEBOARD_PORT) === LIVE_PORT) throw new Error('boot: refusing to start a test laneboard on the live port 7777');
  if (env.TMUX !== undefined || env.TMUX_PANE !== undefined) throw new Error('boot: TMUX must not reach the child (it would point tmux at the live server)');
  if (env.LANEBOARD_DB !== undefined && env.LANEBOARD_DB !== ':memory:') throw new Error('boot: LANEBOARD_DB must stay :memory:');
  // A short base: the tmux socket path under it must stay below 108 bytes.
  const base = os.tmpdir().length <= 40 ? os.tmpdir() : '/tmp';
  const tmp = fs.mkdtempSync(path.join(base, 'lb-boot-'));
  const dirs = {
    home: path.join(tmp, 'home'),
    tmux: path.join(tmp, 'tmux'),
    state: path.join(tmp, 'state'),
    config: path.join(tmp, 'config'),
    cache: path.join(tmp, 'cache'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });

  const port = await freePort();
  let cfg = config === null || config === undefined ? null : structuredClone(config);
  if (mode && mode !== 'builder') cfg = { ...(cfg ?? {}), mode };
  else if (mode === 'builder' && cfg && cfg.mode === undefined) cfg.mode = 'builder';
  // A fleet block or hub mode needs fleet.ingressPort (S6); give it a free one
  // unless the test chose its own (including an explicit null, to test that).
  let ingressPort = null;
  if (cfg && (isObj(cfg.fleet) || cfg.mode === 'hub')) {
    cfg.fleet = isObj(cfg.fleet) ? cfg.fleet : {};
    if (cfg.fleet.ingressPort === undefined) cfg.fleet.ingressPort = await freePort({ exclude: [port] });
    ingressPort = cfg.fleet.ingressPort;
    // A hub on Linux must pin tailscaled's uid (SR12 M3); in tests the "serve" client is this process.
    if (cfg.mode === 'hub' && cfg.fleet.ingressPeerUid === undefined && process.platform === 'linux') cfg.fleet.ingressPeerUid = process.getuid();
  }
  // No config at all means no file: exactly a fresh install.
  const configFile = path.join(dirs.config, 'laneboard', 'config.json');
  if (cfg) {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
  }
  // A hub refuses to boot without its signing key (fleet H11): unless the
  // config names its own fleet.hubKeyFile, write `hubKey` (or a fresh key) at
  // the default path, $XDG_CONFIG_HOME/laneboard/hub.key, mode 0600.
  let hubPrivateKey = null;
  if (cfg?.mode === 'hub' && cfg.fleet?.hubKeyFile === undefined) {
    const file = path.join(dirs.config, 'laneboard', 'hub.key');
    if (hubKey) writePrivateKey(file, hubKey);
    hubPrivateKey = hubKey ?? generateHubKey({ file }).privateKey;
  }
  const traceFile = trace ? path.join(tmp, 'modules.txt') : null;

  const e = childEnv(process.env, {
    HOME: dirs.home,
    TMUX_TMPDIR: dirs.tmux,
    XDG_STATE_HOME: dirs.state,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache,
    LANEBOARD_STATE_DIR: path.join(dirs.state, 'laneboard'),
    LANEBOARD_AUDIT_FILE: path.join(dirs.state, 'laneboard', 'audit.jsonl'),
    LANEBOARD_DB: ':memory:',
    LANEBOARD_CONFIG: configFile,
    LANEBOARD_PORT: String(port),
    ...(traceFile ? { LANEBOARD_TEST_TRACE: traceFile } : {}),
    ...env,
  });

  const args = [...(traceFile ? ['--import', TRACE_HOOK] : []), ENTRY];
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: e,
    detached: true, // own process group, so stop() takes any grandchildren too
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const cap = (buf) => { out += buf; if (out.length > 200_000) out = out.slice(-100_000); };
  child.stdout.on('data', cap);
  child.stderr.on('data', cap);
  const logs = () => out;

  const exited = new Promise((resolve) => child.once('exit', resolve));
  const killGroup = (sig) => {
    try { process.kill(-child.pid, sig); } catch { /* gone */ }
  };
  const tmuxSocket = path.join(dirs.tmux, `tmux-${process.getuid?.() ?? 0}`, 'default');
  const cleanup = () => {
    // A tmux server the child started lives on OUR socket only; -S pins that.
    if (fs.existsSync(tmuxSocket)) {
      spawnSync('tmux', ['-S', tmuxSocket, 'kill-server'], { env: childEnv(process.env, {}), stdio: 'ignore', timeout: 3000 });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  const handle = {
    killNow() {
      killGroup('SIGKILL');
      try { cleanup(); } catch { /* best effort at exit */ }
    },
  };
  live.add(handle);

  let stopped = null;
  const stop = () => {
    stopped ??= (async () => {
      live.delete(handle);
      if (child.exitCode === null && child.signalCode === null) {
        killGroup('SIGTERM');
        const t = setTimeout(() => killGroup('SIGKILL'), 3000);
        await exited;
        clearTimeout(t);
      }
      killGroup('SIGKILL'); // stragglers in the group
      cleanup();
    })();
    return stopped;
  };

  const url = `http://127.0.0.1:${port}`;
  let health;
  try {
    health = await waitHealthy(url, child, timeoutMs, logs);
  } catch (err) {
    await stop();
    throw err;
  }
  return {
    url,
    port,
    ingressPort,
    publicHost: publicHostOf(cfg, ingressPort),
    health,
    child,
    pid: child.pid,
    tmp,
    configFile: cfg ? configFile : null,
    config: cfg,
    env: e,
    /** The hub's private key (hub mode with the default key file), else null. */
    hubKey: hubPrivateKey,
    logs,
    /** Resolved module URLs (needs boot({trace: true})). */
    loadedUrls() {
      if (!traceFile) throw new Error('boot({trace: true}) to record loaded modules');
      try { return [...new Set(fs.readFileSync(traceFile, 'utf8').split('\n').filter(Boolean))]; } catch { return []; }
    },
    stop,
  };
}

/**
 * Start laneboard in `mode` ('builder' default, or 'hub') with `config` (an
 * object written as its config file; null/undefined = no file) and extra
 * `env`. Resolves once /healthz answers (10 s), else rejects with the log
 * tail. Retries twice when the child dies early (a lost port race). In hub
 * mode `hubKey` (an Ed25519 private KeyObject; default a fresh one) is
 * written as the hub key unless the config sets fleet.hubKeyFile.
 */
export async function boot({ mode = 'builder', config = null, env = {}, trace = false, timeoutMs = 10_000, hubKey = null } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await bootOnce({ mode, config, env, trace, timeoutMs, hubKey });
    } catch (err) {
      lastErr = err;
      if (!err.exited || !/EADDRINUSE/.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

/** The headers tailscale serve adds to a request it forwards (and the user it vouches for). */
export function serveHeaders(booted, user) {
  const host = booted.publicHost ?? `127.0.0.1:${booted.ingressPort}`;
  return {
    host,
    'x-forwarded-for': '127.0.0.1',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': host,
    ...(user ? { 'tailscale-user-login': user } : {}),
  };
}

function ingressTarget(booted, p) {
  if (!booted?.ingressPort) throw new Error('ingress: this laneboard has no fleet.ingressPort (boot it with a fleet block or as a hub)');
  if (typeof p !== 'string' || !p.startsWith('/')) throw new Error('ingress: path must start with /');
  return { port: booted.ingressPort, path: p };
}

/**
 * A request on the ingress listener exactly as `tailscale serve` forwards it:
 * X-Forwarded-For/-Proto/-Host, Host = the configured public host, and
 * Tailscale-User-Login (`user: null` sends none, i.e. a tagged node). Resolves
 * to {status, headers, text, json(), body}. Uses node:http because fetch
 * refuses to send a Host header.
 */
export function ingressFetch(booted, p, { user = 'tester@example.invalid', headers = {}, method, body, signal } = {}) {
  const t = ingressTarget(booted, p);
  const m = (method ?? 'GET').toUpperCase();
  let payload = body;
  const h = { ...serveHeaders(booted, user), ...lower(headers) };
  if (payload !== undefined && payload !== null && typeof payload !== 'string' && !(payload instanceof Uint8Array)) {
    payload = JSON.stringify(payload);
    h['content-type'] ??= 'application/json';
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: t.port, path: t.path, method: m, headers: h, signal }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          body: buf,
          text,
          json: () => JSON.parse(text),
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload !== undefined && payload !== null) req.write(payload);
    req.end();
  });
}

/**
 * A WebSocket on the ingress listener with serve's headers (see ingressFetch).
 * The Origin defaults to https://<public host> (browsers always send one).
 * Returns the `ws` client; await `once(ws, 'open')` or `'unexpected-response'`.
 */
export function ingressWs(booted, p, { user = 'tester@example.invalid', headers = {}, origin, ...opts } = {}) {
  const t = ingressTarget(booted, p);
  const sh = serveHeaders(booted, user);
  const h = { ...sh, ...lower(headers) };
  return new WebSocket(`ws://127.0.0.1:${t.port}${t.path}`, {
    ...opts,
    headers: h,
    origin: origin === undefined ? `https://${sh.host}` : origin ?? undefined,
  });
}

function lower(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k.toLowerCase()] = v;
  return out;
}
