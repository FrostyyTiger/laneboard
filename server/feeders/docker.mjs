// The `docker` feeder: the containers of the Docker Engine on this machine,
// from one request over its local unix socket, `GET /containers/json?all=1`
// (what `docker ps -a` shows). It sends that one GET and nothing else.
//
// The socket itself has no read-only mode: whoever may write to it is root
// on the machine. Running the feeder as a user in the `docker` group trusts
// this code not to send anything else; pointing `socket` at a GET-only proxy
// (docs/map.md "Pushing a feed") removes that trust.
//
// The list has health only in the `Status` text ("Up 2 hours (unhealthy)");
// a container without a healthcheck has none, which is never an alert. What
// never leaves this module: `Command` (it can hold a password), labels other
// than the compose project and service, mounts and network addresses.
import http from 'node:http';

export const name = 'docker';

const DEFAULT_EVERY = 60; // seconds
export const DEFAULT_SOCKET = '/var/run/docker.sock';
const PATH = '/containers/json?all=1';
const MAX_BODY = 16 * 1024 * 1024;
const PORTS_IN_SUB = 4;
const COMPOSE_PROJECT = 'com.docker.compose.project';
const COMPOSE_SERVICE = 'com.docker.compose.service';
// The trailing parenthesis of `Status`. "(Paused)" and "Exited (1)" are not health.
const HEALTH_RE = /\((healthy|unhealthy|health: starting)\)\s*$/;
const EXIT_RE = /^(?:Exited|Restarting) \((-?\d+)\)/;
const STOPPED = new Set(['exited', 'dead', 'created', 'removing']);

const str = (v) => (typeof v === 'string' && v ? v : null);
const num = (v) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** The container's name: the first of `Names` without its leading slash, else a short id. */
export function containerName(c) {
  const first = Array.isArray(c?.Names) ? c.Names.find((n) => typeof n === 'string' && n.replace(/^\//, '')) : null;
  if (first) return first.replace(/^\//, '');
  return str(c?.Id) ? c.Id.slice(0, 12) : '';
}

/** `healthy`, `unhealthy`, `starting`, or null (no healthcheck), from the `Status` text. */
export function healthOf(status) {
  const m = typeof status === 'string' ? HEALTH_RE.exec(status) : null;
  if (!m) return null;
  return m[1] === 'health: starting' ? 'starting' : m[1];
}

/**
 * The published ports, one per (public port, protocol): a port published on
 * IPv4 and IPv6 is listed twice by Docker. Exposed-only ports (no
 * `PublicPort`) cannot be reached from the machine and are left out.
 */
export function publishedPorts(ports) {
  const out = [];
  for (const p of Array.isArray(ports) ? ports : []) {
    const pub = num(p?.PublicPort);
    if (pub == null || pub < 1 || pub > 65535) continue;
    const type = str(p.Type) ?? 'tcp';
    const ip = str(p.IP);
    const prev = out.find((x) => x.port === pub && x.type === type);
    // Bound to one address only (127.0.0.1, say) is worth saying; the wildcards are not.
    const local = ip && ip !== '0.0.0.0' && ip !== '::' ? ip : null;
    if (prev) { if (!local) prev.ip = null; continue; }
    out.push({ port: pub, type, private: num(p.PrivatePort), ip: local });
  }
  return out.sort((a, b) => a.port - b.port || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

function serviceStatus(state, health) {
  if (state === 'running') return health === 'unhealthy' ? 'crit' : health === 'starting' ? 'warn' : 'ok';
  return state === 'paused' ? 'warn' : 'down';
}

function toGuest(c) {
  const state = (str(c.State) ?? '').toLowerCase();
  const statusText = str(c.Status);
  const health = healthOf(statusText);
  const exit = statusText ? EXIT_RE.exec(statusText) : null;
  const g = { name: containerName(c), type: 'container' };
  g.status = state === 'running' || state === 'restarting' ? 'running'
    : state === 'paused' ? 'paused'
      : STOPPED.has(state) ? 'stopped' : 'unknown';
  const ports = publishedPorts(c.Ports);
  const image = str(c.Image);
  g.sub = [image, ports.map((p) => `:${p.port}`).filter((w, i, a) => a.indexOf(w) === i).slice(0, PORTS_IN_SUB).join(' ')]
    .filter(Boolean).join(' · ');
  if (!g.sub) delete g.sub;

  const labels = c.Labels && typeof c.Labels === 'object' ? c.Labels : {};
  const project = str(labels[COMPOSE_PROJECT]);
  const service = str(labels[COMPOSE_SERVICE]);
  const detail = {};
  if (image) detail.Image = image;
  if (project) detail.Compose = service ? `${project} / ${service}` : project;
  if (statusText) detail.Status = statusText;
  if (health) detail.Health = health;
  if (ports.length) {
    detail.Ports = ports.map((p) => `${p.ip ? `${p.ip}:` : ''}${p.port}${p.private != null ? `→${p.private}` : ''}/${p.type}`).join(', ');
  }
  if (str(c.Id)) detail.ID = c.Id.slice(0, 12);
  if (Object.keys(detail).length) g.detail = detail;

  g.alerts = [];
  if (state === 'restarting') g.alerts.push({ level: 'crit', text: exit ? `restarting (exit ${exit[1]})` : 'restarting' });
  if (state === 'running' && health === 'unhealthy') g.alerts.push({ level: 'crit', text: 'healthcheck failing' });
  if (state === 'exited') g.why = exit ? `exited with code ${exit[1]}` : 'exited';
  else if (state === 'created') g.why = 'created, never started';
  else if (state === 'dead') g.why = 'dead (Docker could not stop or remove it)';

  g.services = ports.map((p) => {
    const s = { name: `${p.port}/${p.type}`, port: p.port, status: serviceStatus(state, health) };
    s.sub = [p.private != null ? `→ ${p.private}/${p.type}` : null, p.ip ? `on ${p.ip} only` : null].filter(Boolean).join(' ');
    if (!s.sub) delete s.sub;
    return s;
  });
  if (!g.services.length) delete g.services;
  return g;
}

/**
 * `GET /containers/json?all=1` (an array) -> one feed. Pure. Every
 * container is a guest of `type: "container"`; the host is this Docker
 * Engine, named by the feed's source.
 */
export function toFeed(input, { source = 'docker', now = Date.now(), every = DEFAULT_EVERY } = {}) {
  const rows = (Array.isArray(input) ? input : []).filter((c) => c && typeof c === 'object');
  const guests = rows.map(toGuest).filter((g) => g.name).sort(byName);
  const running = guests.filter((g) => g.status === 'running').length;
  const host = { sub: `docker · ${running}/${guests.length} containers running`, alerts: [] };
  return { source, at: now, every, host, guests, events: [] };
}

function netError(err, socket, timeoutMs) {
  const code = err?.code;
  if (code === 'ETIMEDOUT') return `${socket} did not answer in ${Math.round(timeoutMs / 100) / 10}s`;
  if (code === 'ENOENT') return `no socket at ${socket} (is Docker running here?)`;
  if (code === 'EACCES' || code === 'EPERM') return `no permission on ${socket} (this user is not in the docker group; or use a GET-only proxy)`;
  if (code === 'ECONNREFUSED') return `${socket}: connection refused (is Docker running?)`;
  if (code === 'ENOTSOCK') return `${socket} is not a socket`;
  return `${socket}: ${code || 'request failed'}`;
}

/**
 * GET the container list once over the unix socket `socket`. Never throws:
 * a missing socket, no permission, a timeout, a non-2xx answer (a proxy's
 * 403) or a body that is not a JSON list is `{ok:false, error}`. An empty
 * list is an answer: this Engine has no containers.
 */
export async function read({ socket = DEFAULT_SOCKET, timeoutMs = 10000 } = {}) {
  if (typeof socket !== 'string' || !socket || /[\0\r\n]/.test(socket)) return { ok: false, error: 'docker: the socket must be a path' };
  const res = await new Promise((resolve) => {
    let req;
    try {
      req = http.request({
        socketPath: socket,
        path: PATH,
        method: 'GET',
        headers: { host: 'docker', accept: 'application/json', 'user-agent': 'laneboard-feed' },
        timeout: timeoutMs,
      }, (r) => {
        const chunks = [];
        let size = 0;
        r.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) { r.destroy(); resolve({ error: `${socket}: answer over ${MAX_BODY / 1024 / 1024} MiB` }); return; }
          chunks.push(c);
        });
        r.on('end', () => resolve({ code: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        r.on('error', (err) => resolve({ error: netError(err, socket, timeoutMs) }));
      });
    } catch (err) {
      resolve({ error: netError(err, socket, timeoutMs) });
      return;
    }
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => resolve({ error: netError(err, socket, timeoutMs) }));
    req.end();
  });
  if (res.error) return { ok: false, error: `docker: ${res.error}` };
  if (res.code === 403) return { ok: false, error: `docker: ${socket} forbids the container list (403); a socket proxy needs CONTAINERS=1` };
  if (res.code < 200 || res.code >= 300) return { ok: false, error: `docker: ${socket} answered ${res.code}` };
  let body;
  try { body = JSON.parse(res.body); } catch { return { ok: false, error: `docker: ${socket} did not answer JSON` }; }
  if (!Array.isArray(body)) return { ok: false, error: `docker: ${socket} did not answer a container list` };
  return { ok: true, input: body };
}
