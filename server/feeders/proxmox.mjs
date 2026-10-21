// The `proxmox` feeder: a Proxmox VE host (or cluster) and its guests, from
// one read-only API call, `GET /api2/json/cluster/resources`. It needs an API
// token on a user with the built-in `PVEAuditor` role (docs/map.md "Pushing a
// feed from a Proxmox host"); it can read, never change, anything.
//
// The token secret comes from a file or the environment, never from a flag
// (flags show in `ps`), and never reaches an error message, a log or the
// feed. The default PVE certificate is self-signed: pass its CA with `ca`;
// there is deliberately no "skip verification" switch.
import fs from 'node:fs';
import https from 'node:https';

export const name = 'proxmox';

const DEFAULT_EVERY = 60; // seconds
const PATH = '/api2/json/cluster/resources';
const MAX_BODY = 16 * 1024 * 1024;
export const SECRET_ENV = 'LANEBOARD_PVE_SECRET';
const TOKEN_ID_RE = /^[^\s@!=]+@[^\s@!=]+![A-Za-z0-9][A-Za-z0-9._-]*$/;
// A storage this full is a host alert: thin pools stop guests when they fill.
const STORAGE_WARN = 0.9;
const STORAGE_CRIT = 0.97;
const GUEST_STATUS = ['running', 'stopped', 'paused', 'suspended'];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const frac = (used, max) => (num(used) != null && num(max) > 0 ? used / max : null);
const gb = (bytes) => (bytes < 2 ** 30 ? `${Math.round(bytes / 2 ** 20)} MB` : `${Math.round(bytes / 2 ** 30)} GB`);
const pct = (f) => `${Math.round(f * 100)}%`;
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** PVE keeps guest tags as one string, `;`-separated (the GUI also takes `,` and spaces). */
export function splitTags(v) {
  if (typeof v !== 'string') return [];
  return v.split(/[;,\s]+/).map((t) => t.trim()).filter(Boolean);
}

function rowsOf(input) {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.data) ? input.data : [];
  return rows.filter((r) => r && typeof r === 'object');
}

function toGuest(r, { multiNode }) {
  const vmid = num(r.vmid) ?? (Number.parseInt(String(r.id ?? '').split('/')[1], 10) || null);
  const g = { vmid, name: typeof r.name === 'string' && r.name ? r.name : String(vmid), type: r.type };
  g.status = typeof r.status === 'string' && r.status ? r.status : 'unknown';
  const template = r.template === 1 || r.template === true;
  if (template) g.template = true;
  if (g.status === 'running') {
    if (num(r.cpu) != null) g.cpu = r.cpu;
    // A qemu guest reports disk 0 unless its agent says more: no figure, not 0%.
    const disk = num(r.disk) > 0 ? frac(r.disk, r.maxdisk) : null;
    if (disk != null) g.disk = disk;
    if (num(r.uptime) > 0) g.uptime = r.uptime;
  }
  if (num(r.mem) != null) g.mem = r.mem;
  if (num(r.maxmem) != null) g.maxmem = r.maxmem;
  // The hypervisor's view of a guest's memory counts its page cache.
  g.memCache = true;
  const tags = splitTags(r.tags);
  if (tags.length) g.tags = tags;
  if (multiNode && typeof r.node === 'string') g.node = r.node;
  const detail = {};
  if (multiNode && g.node) detail.Node = g.node;
  if (num(r.maxcpu) != null) detail.CPU = `${r.maxcpu} ${r.maxcpu === 1 ? 'core' : 'cores'}`;
  if (num(r.maxmem) > 0) detail.RAM = gb(r.maxmem);
  if (tags.length) detail.Tags = tags.join(', ');
  if (typeof r.lock === 'string' && r.lock) detail.Lock = r.lock;
  if (typeof r.hastate === 'string' && r.hastate) detail.HA = r.hastate;
  if (template) detail.Template = 'yes';
  if (Object.keys(detail).length) g.detail = detail;
  g.alerts = [];
  if (!GUEST_STATUS.includes(g.status) && g.status !== 'unknown') g.why = `PVE says ${g.status}`;
  return g;
}

function storageAlerts(storages) {
  // A shared storage is listed once per node: one alert, at its fullest.
  const seen = new Map();
  for (const s of storages) {
    const f = frac(s.disk, s.maxdisk);
    if (f == null) continue;
    const key = s.shared === 1 || s.shared === true ? `shared:${s.storage}` : `${s.node}:${s.storage}`;
    const prev = seen.get(key);
    if (!prev || f > prev.f) seen.set(key, { f, name: s.storage ?? s.id });
  }
  const alerts = [];
  for (const { f, name: storage } of [...seen.values()].sort((a, b) => b.f - a.f)) {
    if (f >= STORAGE_CRIT) alerts.push({ level: 'crit', text: `storage ${storage} ${pct(f)} full` });
    else if (f >= STORAGE_WARN) alerts.push({ level: 'warn', text: `storage ${storage} ${pct(f)} full` });
  }
  return alerts;
}

/**
 * `/cluster/resources` (the `{data}` body or its array) -> one feed. Pure.
 * One node: it is the host. Several: `node` (an option, or `input.node`)
 * picks one and its guests; without it the host is the cluster (metrics
 * summed over the online nodes) and every guest carries its `node`.
 * Templates are guests with `template: true`: listed, never trouble.
 */
export function toFeed(input, { source = 'proxmox', now = Date.now(), every = DEFAULT_EVERY, node } = {}) {
  const rows = rowsOf(input);
  const pick = node ?? (typeof input?.node === 'string' ? input.node : null);
  const inScope = (r) => !pick || r.node === pick;
  const nodes = rows.filter((r) => r.type === 'node' && inScope(r));
  const multiNode = nodes.length > 1;
  const guests = rows.filter((r) => (r.type === 'qemu' || r.type === 'lxc') && inScope(r))
    .map((r) => toGuest(r, { multiNode }))
    .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0) || byName(a.name, b.name));

  const online = nodes.filter((n) => n.status === 'online');
  const host = {};
  if (nodes.length === 1) host.name = String(nodes[0].node);
  const sum = (k) => online.reduce((s, n) => s + (num(n[k]) ?? 0), 0);
  const cores = sum('maxcpu');
  const cpu = cores > 0 ? online.reduce((s, n) => s + (num(n.cpu) ?? 0) * (num(n.maxcpu) ?? 0), 0) / cores : null;
  if (online.length && cpu != null) host.cpu = cpu;
  const mem = frac(sum('mem'), sum('maxmem'));
  if (online.length && mem != null) host.mem = mem;
  const disk = frac(sum('disk'), sum('maxdisk'));
  if (online.length && disk != null) host.disk = disk;

  const vms = guests.filter((g) => !g.template);
  const running = vms.filter((g) => g.status === 'running').length;
  const ram = sum('maxmem');
  const head = multiNode ? `PVE cluster · ${online.length}/${nodes.length} nodes` : 'PVE';
  host.sub = [head, ram > 0 ? gb(ram) : null, `${running}/${vms.length} guests running`].filter(Boolean).join(' · ');

  const detail = {};
  if (cores > 0) detail.CPU = `${cores} cores`;
  if (nodes.length === 1 && num(nodes[0].uptime) > 0) detail.Uptime = `${Math.round(nodes[0].uptime / 86400)}d`;
  const templates = guests.length - vms.length;
  if (templates) detail.Templates = String(templates);
  if (Object.keys(detail).length) host.detail = detail;

  host.alerts = [];
  for (const n of nodes) {
    if (n.status !== 'online') host.alerts.push({ level: multiNode ? 'warn' : 'crit', text: `node ${n.node} is ${n.status || 'not reported'}` });
  }
  const storages = rows.filter((r) => r.type === 'storage' && inScope(r));
  host.alerts.push(...storageAlerts(storages));
  return { source, at: now, every, host, guests, events: [] };
}

/** `https://hv1.example.invalid:8006` (any path) -> the resources URL, or null. */
export function resourcesUrl(base) {
  let u;
  try { u = new URL(String(base)); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  return new URL(PATH, u.origin);
}

function readSecret({ secretFile, env }) {
  if (secretFile) {
    try { return { secret: fs.readFileSync(secretFile, 'utf8').trim() }; } catch (err) {
      return { error: `cannot read the token secret file (${err.code || 'error'})` };
    }
  }
  const v = env?.[SECRET_ENV];
  return typeof v === 'string' && v.trim() ? { secret: v.trim() } : { error: `no token secret: give a secret file or set ${SECRET_ENV}` };
}

const TLS_CODES = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']);

function netError(err, host, timeoutMs) {
  const code = err?.code;
  if (code === 'ETIMEDOUT' || err?.name === 'TimeoutError') return `${host} did not answer in ${Math.round(timeoutMs / 100) / 10}s`;
  if (code === 'ECONNREFUSED') return `${host}: connection refused`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `${host}: name does not resolve`;
  if (TLS_CODES.has(code)) return `${host}: certificate not trusted (${code}); pass the PVE CA file`;
  return `${host}: ${code || 'request failed'}`;
}

/**
 * Fetch `/cluster/resources` once. `url` is the PVE API's https origin,
 * `tokenId` is `user@realm!name`, the secret is read from `secretFile` or
 * `LANEBOARD_PVE_SECRET`; `ca` is a PEM file to trust. Never throws.
 */
export async function read({ url, tokenId, secretFile, ca, node, timeoutMs = 10000, env = process.env } = {}) {
  const target = resourcesUrl(url);
  if (!target) return { ok: false, error: 'proxmox: an https URL of the PVE API is needed (https://<host>:8006)' };
  if (typeof tokenId !== 'string' || !TOKEN_ID_RE.test(tokenId)) {
    return { ok: false, error: 'proxmox: the token id must look like user@realm!name' };
  }
  const s = readSecret({ secretFile, env });
  if (s.error) return { ok: false, error: `proxmox: ${s.error}` };
  if (!s.secret || /[\r\n]/.test(s.secret)) return { ok: false, error: 'proxmox: the token secret is empty or not one line' };
  let caPem;
  if (ca) {
    try { caPem = fs.readFileSync(ca); } catch (err) { return { ok: false, error: `proxmox: cannot read the CA file (${err.code || 'error'})` }; }
  }
  const host = target.host;
  const res = await new Promise((resolve) => {
    const onResponse = (r) => {
      const chunks = [];
      let size = 0;
      r.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { r.destroy(); resolve({ error: `${host}: answer over ${MAX_BODY / 1024 / 1024} MiB` }); return; }
        chunks.push(c);
      });
      r.on('end', () => resolve({ code: r.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      r.on('error', (err) => resolve({ error: netError(err, host, timeoutMs) }));
    };
    let req;
    try {
      req = https.request(target, {
        method: 'GET',
        headers: { authorization: `PVEAPIToken=${tokenId}=${s.secret}`, accept: 'application/json', 'user-agent': 'laneboard-feed' },
        ca: caPem,
        timeout: timeoutMs,
      }, onResponse);
    } catch (err) {
      // A bad header byte is refused before anything is sent; say which, not what.
      resolve({ error: `${host}: ${err?.code || 'request refused'}` });
      return;
    }
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (err) => resolve({ error: netError(err, host, timeoutMs) }));
    req.end();
  });
  if (res.error) return { ok: false, error: `proxmox: ${res.error}` };
  if (res.code === 401) return { ok: false, error: `proxmox: ${host} refused the token (401): check the token id, secret and expiry` };
  if (res.code === 403) return { ok: false, error: `proxmox: ${host} forbids this token (403): give it PVEAuditor on /` };
  if (res.code < 200 || res.code >= 300) return { ok: false, error: `proxmox: ${host} answered ${res.code}` };
  let body;
  try { body = JSON.parse(res.body); } catch { return { ok: false, error: `proxmox: ${host} did not answer JSON` }; }
  if (!Array.isArray(body?.data)) return { ok: false, error: `proxmox: ${host} answered without a data list` };
  const nodes = body.data.filter((r) => r?.type === 'node');
  // Node rows are listed for every token; none means this is not a PVE API.
  if (!nodes.length) return { ok: false, error: `proxmox: ${host} lists no nodes` };
  if (node && !nodes.some((r) => r.node === node)) return { ok: false, error: `proxmox: ${host} has no node ${node}` };
  return { ok: true, input: node ? { data: body.data, node } : { data: body.data } };
}
