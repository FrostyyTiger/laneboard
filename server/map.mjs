// The Map: laneboard's lanes placed inside the infrastructure they run on.
//
// Three inputs, all optional, merged into one model the Map view draws:
//
//   topology   a JSON file naming the sites, rooms and services and how they
//              relate. Private to whoever runs laneboard; never in this repo.
//   feeds      snapshots other machines push into a directory, one file per
//              source (a hypervisor listing its guests, say). laneboard only
//              ever READS them: it reaches out to nothing it watches, so a
//              laneboard running somewhere untrusted gains no access by
//              drawing a map of what it cannot touch.
//   probes     HTTP checks laneboard runs itself, for what it can reach.
//
// Builders (fleet §5): each builder is a `builder:<id>` node, hung under the
// topology node that names it (`"builder": "<id>"`, or legacy `self` for this
// board's own id), else under a synthetic `__fleet` site. Its lanes and
// sessions hang under it, from its snapshot. Builder mode is a fleet of one
// (`build`); the hub passes every builder of its fleet store (`tickFleet`).
// With no topology at all the Map is this builder with its lanes around it.
//
// docs/map.md has the file formats; docs/fleet/map.md the fleet model.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { fkey, isFkey, BUILDER_ID_RX, deriveCode } from './fleet/keys.mjs';
import { loadPolicy, reachLinks, parseAddr } from './map/reach.mjs';
import { runNodes } from './map/runs.mjs';

export const KINDS = ['core', 'site', 'host', 'room', 'service', 'lane', 'pr', 'builder', 'session', 'repo', 'package', 'run'];
export const LINK_KINDS = ['dep', 'flow', 'share', 'touch', 'conflict', 'pkg', 'ci'];
// What a topology file may use: the rest are nodes and links laneboard makes.
export const TOPOLOGY_KINDS = ['core', 'site', 'host', 'room', 'service', 'lane', 'pr'];
export const TOPOLOGY_LINK_KINDS = ['dep', 'flow', 'share'];
// Id prefixes and synthetic ids laneboard owns; a topology may not use them.
const RESERVED_PREFIXES = ['lane:', 'builder:', 'sess:', 'repo:', 'pkg:', 'feed:', 'run:'];
const RESERVED_IDS = ['__core', '__fleet', '__repos'];
const SEVERITY = ['idle', 'unknown', 'ok', 'working', 'warn', 'attention', 'crit', 'down'];
const worse = (a, b) => (SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b);
const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined);
const clamp01 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined);

// ------------------------------------------------------------------ topology

export class TopologyError extends Error {}

/**
 * Check a topology document and return it normalised. Strict about what would
 * draw wrong (a duplicate id, a parent that does not exist, a cycle) and
 * silent about what it does not know, so a newer file still loads.
 */
export function parseTopology(doc, where = 'topology') {
  const bad = (msg) => { throw new TopologyError(`${where}: ${msg}`); };
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) bad('must be a JSON object');
  const nodes = doc.nodes ?? [];
  if (!Array.isArray(nodes)) bad('nodes must be a list');
  const ids = new Set();
  for (const [i, n] of nodes.entries()) {
    if (!n || typeof n.id !== 'string' || !n.id) bad(`nodes[${i}] needs an id`);
    const pre = RESERVED_PREFIXES.find((x) => n.id.startsWith(x));
    if (pre) bad(`nodes[${i}]: ids starting "${pre}" are laneboard's own`);
    if (RESERVED_IDS.includes(n.id)) bad(`nodes[${i}]: the id ${n.id} is laneboard's own`);
    if (ids.has(n.id)) bad(`nodes[${i}]: duplicate id ${JSON.stringify(n.id)}`);
    ids.add(n.id);
    if (n.kind && !TOPOLOGY_KINDS.includes(n.kind)) bad(`nodes[${i}] (${n.id}): kind must be one of ${TOPOLOGY_KINDS.join(', ')}`);
  }
  // `builder`: this node hosts that builder (fleet §5 2.1), at most one each.
  const claimed = new Map();
  for (const n of nodes) {
    if (n.builder == null) continue;
    if (typeof n.builder !== 'string' || !BUILDER_ID_RX.test(n.builder)) bad(`node ${n.id}: builder must be a builder id (a-z, 0-9, '-', 1-24 chars)`);
    if (claimed.has(n.builder)) bad(`node ${n.id}: builder ${n.builder} is already claimed by node ${claimed.get(n.builder)}`);
    claimed.set(n.builder, n.id);
  }
  // `ci`: this node is a CI runner for some builders (or "*" for all).
  for (const n of nodes) {
    if (n.ci == null) continue;
    const c = n.ci;
    if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.runner !== 'boolean') bad(`node ${n.id}: ci must be {"runner": true, "for": [...] | "*"}`);
    const f = c.for ?? '*';
    if (f !== '*' && !(Array.isArray(f) && f.every((x) => typeof x === 'string' && BUILDER_ID_RX.test(x)))) bad(`node ${n.id}: ci.for must be "*" or a list of builder ids`);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.parent != null && !byId.has(n.parent)) bad(`node ${n.id}: parent ${JSON.stringify(n.parent)} does not exist`);
    const seen = new Set([n.id]);
    for (let p = n.parent; p != null; p = byId.get(p)?.parent) {
      if (seen.has(p)) bad(`node ${n.id}: its parents form a loop`);
      seen.add(p);
    }
  }
  if (nodes.filter((n) => n.kind === 'core').length > 1) bad('at most one node may be the core');
  const links = doc.links ?? [];
  if (!Array.isArray(links)) bad('links must be a list');
  for (const [i, l] of links.entries()) {
    if (!l || !byId.has(l.from) || !byId.has(l.to)) bad(`links[${i}]: from and to must both name nodes`);
    if (l.kind && !TOPOLOGY_LINK_KINDS.includes(l.kind)) bad(`links[${i}]: kind must be one of ${TOPOLOGY_LINK_KINDS.join(', ')}`);
  }
  if (doc.self != null && !byId.has(doc.self)) bad(`self ${JSON.stringify(doc.self)} does not name a node`);
  const lanes = doc.lanes ?? {};
  if (lanes.show && !['active', 'all', 'none'].includes(lanes.show)) bad('lanes.show must be active, all or none');
  for (const [i, r] of (lanes.links ?? []).entries()) {
    if (!r?.match || !byId.has(r.to)) bad(`lanes.links[${i}] needs a match pattern and a "to" that names a node`);
    try { new RegExp(r.match); } catch (err) { bad(`lanes.links[${i}].match: ${err.message}`); }
  }
  for (const n of nodes) {
    if (n.probe && typeof n.probe.url !== 'string') bad(`node ${n.id}: probe.url must be a string`);
    if (n.probe?.url && !/^https?:\/\//.test(n.probe.url)) bad(`node ${n.id}: probe.url must be http(s)`);
  }
  return {
    title: typeof doc.title === 'string' ? doc.title : null,
    self: doc.self ?? null,
    nodes,
    links,
    lanes: { show: lanes.show ?? 'active', links: lanes.links ?? [] },
  };
}

let topoCache = { file: null, mtimeMs: -1, value: null, error: null };

/** The topology file, re-read when it changes. Missing is not an error. */
export function loadTopology(file = config.map.file) {
  let st;
  try { st = fs.statSync(file); } catch {
    topoCache = { file, mtimeMs: -1, value: null, error: null };
    return topoCache;
  }
  if (topoCache.file === file && topoCache.mtimeMs === st.mtimeMs) return topoCache;
  try {
    const value = parseTopology(JSON.parse(fs.readFileSync(file, 'utf8')), file);
    topoCache = { file, mtimeMs: st.mtimeMs, value, error: null };
  } catch (err) {
    // Keep drawing the last good map; say what is wrong on it.
    log.error('map topology rejected', String(err?.message || err));
    topoCache = { ...topoCache, file, mtimeMs: st.mtimeMs, error: String(err?.message || err) };
  }
  return topoCache;
}

// ------------------------------------------------------------------ feeds

const feedCache = new Map(); // file -> { mtimeMs, value }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Why a parsed feed cannot be drawn, or null. Checks only the shape the Map
 * leans on (docs/map.md "The feed format"); every field is optional and
 * unknown ones pass, so a newer feeder still loads. readFeeds skips a file
 * that fails; POST /api/map/feeds refuses the body (server/routes/feeds.mjs).
 */
export function feedProblem(v) {
  if (!isObj(v)) return 'a feed must be a JSON object';
  if (v.source != null && typeof v.source !== 'string') return 'source must be a string';
  if (v.at != null && !(typeof v.at === 'number' && Number.isFinite(v.at))) return 'at must be a time in ms';
  if (v.every != null && !(typeof v.every === 'number' && v.every > 0)) return 'every must be a number of seconds';
  if (v.host != null && !isObj(v.host)) return 'host must be an object';
  if (v.guests != null && !(Array.isArray(v.guests) && v.guests.every(isObj))) return 'guests must be a list of objects';
  if (v.events != null && !Array.isArray(v.events)) return 'events must be a list';
  // A feed that names no machine is a typo, not an empty feed: `host: {}` or
  // `guests: []` is how a feeder says "nothing here" (the none feeder does).
  if (v.host == null && v.guests == null) return 'a feed needs a host object or a guests list';
  return null;
}

/** Every `*.json` in the feeds directory, keyed by its `source`. */
export function readFeeds(dir = config.map.feedsDir) {
  const out = new Map();
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      let hit = feedCache.get(file);
      if (!hit || hit.mtimeMs !== st.mtimeMs) {
        hit = { mtimeMs: st.mtimeMs, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
        feedCache.set(file, hit);
      }
      if (feedProblem(hit.value)) continue;
      const source = String(hit.value?.source || name.replace(/\.json$/, ''));
      out.set(source, { ...hit.value, source, receivedAt: st.mtimeMs });
    } catch {
      // A half-written file is simply not there this pass; the pusher writes
      // to a temp name and renames, so this is rare.
    }
  }
  return out;
}

/**
 * "hv1" is a host; "hv1/103" or {source, guest} is a guest of it;
 * "hv1/103/worker-1" or {source, guest, service} is a service that guest lists.
 */
export function feedRef(ref) {
  if (!ref) return null;
  const str = (v) => (v != null ? String(v) : null);
  if (typeof ref === 'object') return { source: String(ref.source), guest: str(ref.guest), service: ref.guest != null ? str(ref.service) : null };
  const [source, guest, ...service] = String(ref).split('/');
  return { source, guest: guest ?? null, service: guest != null && service.length ? service.join('/') : null };
}

// What a feed may say about one of a guest's services. `working` is busy
// (a runner on a job), `idle` is up with nothing to do.
const SERVICE_STATUS = ['ok', 'working', 'idle', 'warn', 'crit', 'down'];

/** One of a running guest's services, as the feed lists it. */
function fromService(g, ref) {
  const s = (Array.isArray(g.services) ? g.services : []).find((x) => x && String(x.name) === ref.service);
  if (!s) return { status: 'unknown', why: `${ref.guest} does not list ${ref.service}` };
  const status = SERVICE_STATUS.includes(s.status) ? s.status : 'unknown';
  return {
    status,
    why: s.why ?? (status === 'down' ? 'not running' : undefined),
    sub: s.sub,
    detail: s.detail && typeof s.detail === 'object' ? { ...s.detail } : undefined,
  };
}

const agoWords = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

const feedAge = (feed, now) => now - (Number(feed.at) || feed.receivedAt);

/** A feed is fresh until three of its intervals (or `map.feedStaleMs`) pass. */
export function feedFresh(feed, now) {
  if (!feed) return false;
  const every = Math.max(10, Number(feed.every) || 60) * 1000;
  return feedAge(feed, now) <= Math.max(3 * every, config.map.feedStaleMs);
}

/**
 * Declared against live (docs/map.md "Drift"): `missing` for a declared node
 * whose fresh feed does not list its guest, `undeclared` for a node only a
 * fresh feed knows. Needs a topology file (without one nothing is declared)
 * and a fresh feed (no data is not drift).
 */
export function driftOf(node, feeds, now, { declared = true } = {}) {
  if (!declared) return undefined;
  const ref = feedRef(node.feed);
  if (!ref || ref.service) return undefined;
  const feed = feeds.get(ref.source);
  if (!feedFresh(feed, now)) return undefined;
  if (node.discovered) return 'undeclared';
  if (ref.guest == null) return undefined;
  const listed = arr(feed.guests).some((x) => String(x.vmid) === ref.guest || x.name === ref.guest);
  return listed ? undefined : 'missing';
}

/** What a feed says about one node, or null when the node has no feed. */
export function fromFeed(node, feeds, now) {
  const ref = feedRef(node.feed);
  if (!ref) return null;
  const feed = feeds.get(ref.source);
  if (!feed) return { status: 'unknown', why: `no feed from ${ref.source} yet` };
  if (!feedFresh(feed, now)) {
    return { status: 'unknown', why: `no data from ${ref.source} for ${agoWords(feedAge(feed, now))}` };
  }
  if (!ref.guest) {
    const h = feed.host ?? {};
    const alerts = Array.isArray(h.alerts) ? h.alerts : [];
    let status = h.status ?? 'ok';
    for (const a of alerts) status = worse(status, a.level === 'crit' ? 'crit' : 'warn');
    return {
      status,
      why: alerts[0]?.text ?? h.why,
      sub: h.sub,
      metrics: { cpu: clamp01(h.cpu), mem: clamp01(h.mem), disk: clamp01(h.disk), gpu: clamp01(h.gpu) },
      detail: h.detail,
    };
  }
  const g = (feed.guests ?? []).find((x) => String(x.vmid) === ref.guest || x.name === ref.guest);
  if (!g) return { status: 'unknown', why: `${ref.source} does not list ${ref.guest}` };
  if (ref.service) {
    // A service cannot be up inside a guest that is not.
    if (g.status !== 'running') return { status: g.status === 'stopped' ? 'down' : 'unknown', why: `${ref.guest} is ${g.status ?? 'not reported'}` };
    return fromService(g, ref);
  }
  // A template never runs: stopped is its normal state, like `expect: "stopped"`.
  const expectStopped = node.expect === 'stopped' || g.template === true;
  let status = g.status === 'running' ? (expectStopped ? 'warn' : 'ok')
    : g.status === 'stopped' ? (expectStopped ? 'idle' : 'down')
      : g.status === 'paused' || g.status === 'suspended' ? 'warn' : 'unknown';
  let why = status === 'down' ? `${g.type === 'lxc' || g.type === 'container' ? 'container' : 'VM'} is stopped`
    : status === 'warn' && !expectStopped ? `guest is ${g.status}`
      : status === 'warn' ? 'running but expected to be stopped' : undefined;
  // Alerts from inside a running guest (its disk is full, say), as for a host.
  const alerts = g.status === 'running' && Array.isArray(g.alerts) ? g.alerts : [];
  for (const a of alerts) {
    const next = worse(status, a.level === 'crit' ? 'crit' : 'warn');
    if (next !== status) { status = next; why = a.text; }
  }
  const mem = g.maxmem ? g.mem / g.maxmem : g.memFrac;
  const detail = { ...(g.detail ?? {}) };
  if (g.vmid != null) detail.ID ??= g.vmid;
  if (g.uptime) detail.Uptime ??= agoWords(g.uptime * 1000).replace(/s$/, 's');
  return {
    status,
    why: g.why ?? why,
    sub: g.sub,
    metrics: g.status === 'running' && !expectStopped ? { cpu: clamp01(g.cpu), mem: clamp01(mem), disk: clamp01(g.disk), gpu: clamp01(g.gpu) } : undefined,
    // A VM's memory as its hypervisor sees it counts the guest's page cache:
    // shown, but never as a warning.
    memCache: Boolean(g.memCache),
    detail,
  };
}

// ------------------------------------------------------------------ probes

const probeResults = new Map(); // node id -> { ok, code, ms, at, error }
let probeTimer = null;

function expectOk(expect, code) {
  if (expect == null) return code >= 200 && code < 400;
  const list = Array.isArray(expect) ? expect : [expect];
  return list.some((e) => (typeof e === 'number' ? e === code : /^\dxx$/i.test(e) ? String(code)[0] === e[0] : Number(e) === code));
}

export async function probeOnce(node, { fetchImpl = fetch } = {}) {
  const p = node.probe;
  const t0 = performance.now();
  try {
    const res = await fetchImpl(p.url, {
      method: p.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.min(30000, p.timeoutMs ?? 8000)),
      headers: { 'user-agent': 'laneboard-map-probe' },
    });
    try { await res.body?.cancel(); } catch { /* nothing to drain */ }
    const ms = Math.round(performance.now() - t0);
    return { ok: expectOk(p.expect, res.status), code: res.status, ms, at: Date.now() };
  } catch (err) {
    const name = err?.name === 'TimeoutError' ? `timeout after ${Math.round((p.timeoutMs ?? 8000) / 1000)}s`
      : err?.cause?.code === 'ECONNREFUSED' ? 'connection refused'
        : err?.cause?.code === 'ENOTFOUND' ? 'name does not resolve'
          : err?.cause?.code ?? err?.message ?? 'failed';
    return { ok: false, code: null, ms: null, at: Date.now(), error: String(name) };
  }
}

/** Run every probe the topology names, each on its own interval. */
export function startProbes() {
  const due = new Map();
  const run = async () => {
    const topo = loadTopology().value;
    const now = Date.now();
    const jobs = [];
    for (const n of topo?.nodes ?? []) {
      if (!n.probe?.url) continue;
      const every = Math.max(15, n.probe.every ?? config.map.probeEverySec) * 1000;
      if ((due.get(n.id) ?? 0) > now) continue;
      due.set(n.id, now + every);
      jobs.push(probeOnce(n).then((r) => probeResults.set(n.id, r)));
    }
    // Probes whose node left the topology stop being reported.
    const live = new Set((topo?.nodes ?? []).map((n) => n.id));
    for (const id of [...probeResults.keys()]) if (!live.has(id)) probeResults.delete(id);
    await Promise.allSettled(jobs);
  };
  run().catch(() => {});
  probeTimer = setInterval(() => run().catch(() => {}), 5000);
  probeTimer.unref();
  return () => clearInterval(probeTimer);
}

function fromProbe(node, results) {
  const r = results.get(node.id);
  if (!node.probe?.url) return null;
  if (!r) return { status: 'unknown', why: 'first check pending' };
  if (r.ok) return { status: 'ok', sub: `${r.code} · ${r.ms} ms`, detail: { Check: `${r.code} in ${r.ms} ms` } };
  return {
    status: node.probe.level === 'warn' ? 'warn' : 'crit',
    why: r.error ? `check failed: ${r.error}` : `check returned HTTP ${r.code}`,
    detail: { Check: r.error ?? `HTTP ${r.code}` },
  };
}

// ------------------------------------------------------------------ helpers

// Builder-provided text (labels, tool lines, reasons) is clipped here and
// rendered with textContent by the view; nothing here is ever HTML.
const MAX_TEXT = 200;
const clip = (v, n = MAX_TEXT) => (typeof v === 'string' && v !== '' ? (v.length > n ? `${v.slice(0, n - 1)}…` : v) : undefined);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v) => (Array.isArray(v) ? v : []);
/** The object without its undefined fields, or undefined when nothing is left. */
const compact = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const CODE_RX = /^[A-Z0-9]{2,3}$/;
const NAME_RX = /^[A-Za-z0-9][A-Za-z0-9._@/-]{0,99}$/;
const CI_WORDS = ['pass', 'fail', 'running', 'none'];
const EMPTY_TOPOLOGY = Object.freeze({ title: null, self: null, nodes: [], links: [], lanes: { show: 'active', links: [] } });

// ------------------------------------------------------------------ builders

export const LINKS = ['up', 'stale', 'down'];

/** A fleet-store connection state as a map link (fleet §5 2.1). */
export function linkOf(state) {
  if (state === 'up') return 'up';
  if (state === 'stale' || state === 'connecting') return 'stale';
  return 'down';
}

/** The status a builder link lends the node that hosts it. */
export function linkStatus(link) {
  return link === 'up' ? 'ok' : link === 'stale' ? 'unknown' : 'down';
}

// A health sample older than this is not used for gauges (§7: 10 s cadence).
const HEALTH_FRESH_MS = 60_000;

function freshHealth(h, now) {
  if (!h || typeof h !== 'object') return null;
  const at = num(h.at);
  return at !== undefined && now - at <= HEALTH_FRESH_MS ? h : null;
}

/** Gauges from a §7 health sample, or null when there is none fresh. */
export function healthMetrics(health, now) {
  const h = freshHealth(health, now);
  if (!h) return null;
  const root = arr(h.fs).find((x) => x && x.mount === '/');
  const mem = num(h.mem?.availPct) !== undefined ? 1 - h.mem.availPct / 100
    : num(h.mem?.totalMb) ? 1 - (num(h.mem.availMb) ?? 0) / h.mem.totalMb : undefined;
  const m = compact({
    cpu: round(clamp01(num(h.cpu?.busyPct) !== undefined ? h.cpu.busyPct / 100 : undefined)),
    mem: round(clamp01(mem)),
    disk: round(clamp01(num(root?.usedPct) !== undefined ? root.usedPct / 100 : undefined)),
    swap: round(clamp01(num(h.swap?.totalMb) ? (num(h.swap.usedMb) ?? 0) / h.swap.totalMb : undefined)),
  });
  return m ?? null;
}

function vitalsMetrics(v) {
  if (!v || typeof v !== 'object') return null;
  return compact({
    cpu: round(clamp01((num(v.cpuPct) ?? 0) / 100)),
    mem: round(v.mem?.totalMb ? clamp01(v.mem.usedMb / v.mem.totalMb) : undefined),
    disk: round(num(v.disk?.usedPct) !== undefined ? clamp01(v.disk.usedPct / 100) : undefined),
  }) ?? null;
}

/** The worst fresh health alarm as [status, why], or null. */
function healthLevel(health, now) {
  const h = freshHealth(health, now);
  const alarms = arr(h?.alarms).filter((a) => a && typeof a === 'object');
  const a = alarms.find((x) => x.level === 'crit') ?? alarms.find((x) => x.level === 'warn');
  return a ? [a.level, clip(a.text, 120)] : null;
}

/** Valid, de-duplicated builder entries with a link, in input order. */
function cleanBuilders(builders) {
  const out = [];
  const seen = new Set();
  for (const b of arr(builders)) {
    if (!b || typeof b.id !== 'string' || !BUILDER_ID_RX.test(b.id) || seen.has(b.id)) continue;
    seen.add(b.id);
    const link = LINKS.includes(b.link) ? b.link : linkOf(b.state);
    const snapshot = b.snapshot && typeof b.snapshot === 'object' ? b.snapshot : null;
    out.push({
      id: b.id,
      code: typeof b.code === 'string' && CODE_RX.test(b.code) ? b.code : deriveCode(b.id),
      link,
      state: typeof b.state === 'string' ? b.state : link,
      ageMs: num(b.ageMs),
      lastSeenMs: num(b.lastSeenMs),
      latencyMs: num(b.latencyMs),
      version: clip(b.version, 40),
      snapshot,
      health: b.health ?? snapshot?.health ?? null,
    });
  }
  return out;
}

function downWhy(b) {
  if (b.state === 'misconfigured') return 'misconfigured';
  if (b.state === 'incompatible') return 'incompatible version';
  const age = b.lastSeenMs ?? b.ageMs;
  return age !== undefined ? `no contact for ${agoWords(age)}` : 'no contact yet';
}

function staleWhy(b) {
  if (b.state === 'connecting') return 'connecting';
  const age = b.lastSeenMs ?? b.ageMs;
  return age !== undefined ? `no data for ${agoWords(age)}` : 'no data yet';
}

const guestOf = (feeds, ref) => {
  const feed = feeds?.get?.(ref.source);
  return arr(feed?.guests).find((x) => x && (String(x.vmid) === ref.guest || x.name === ref.guest)) ?? null;
};

/**
 * Which node each builder hangs under (fleet §5 2.1, attachment rule): the
 * topology node naming it in `builder`; else `self` for the local builder
 * (legacy builder-mode files); else a feed guest whose name is the builder id
 * (§7); else the synthetic `__fleet` site. Returns Map builderId -> parent id.
 */
export function attachBuilders(topology, builders, { localId = null, feeds = null } = {}) {
  const nodes = arr(topology?.nodes);
  const ids = new Set(arr(builders).map((b) => b?.id).filter(Boolean));
  const out = new Map();
  const used = new Set();
  const claim = (b, nodeId) => { out.set(b, nodeId); used.add(nodeId); };
  for (const n of nodes) {
    if (typeof n.builder === 'string' && ids.has(n.builder) && !out.has(n.builder)) claim(n.builder, n.id);
  }
  const self = topology?.self;
  if (localId && self && ids.has(localId) && !out.has(localId) && !used.has(self)
    && nodes.some((n) => n.id === self && n.builder == null)) claim(localId, self);
  if (feeds) {
    for (const n of nodes) {
      if (used.has(n.id) || n.builder != null || n.id === self) continue;
      const ref = feedRef(n.feed);
      if (!ref?.guest || ref.service) continue;
      const g = guestOf(feeds, ref);
      if (g && typeof g.name === 'string' && ids.has(g.name) && !out.has(g.name)) claim(g.name, n.id);
    }
  }
  for (const id of ids) if (!out.has(id)) out.set(id, '__fleet');
  return out;
}

// ------------------------------------------------------------------ discovery

const nameKey = (v) => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
const hasNumbers = (g) => [g.cpu, g.mem, g.maxmem, g.memFrac].some((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * The machines the feeds name: each source's host (named `host.name`, else
 * the source) and each guest (named `name`, else its vmid). A machine named
 * in two feeds (a tailnet peer that is also a PVE guest) is one machine.
 */
function feedMachines(feeds) {
  const out = [];
  const sources = [...(feeds?.keys?.() ?? [])].sort();
  for (const source of sources) {
    const feed = feeds.get(source);
    out.push({ source, guest: null, name: nameKey(feed?.host?.name) ?? nameKey(source) ?? source, label: feed?.host?.name ?? source, rank: 0 });
    for (const g of arr(feed?.guests)) {
      const key = g.vmid ?? g.name;
      if (key == null || key === '') continue;
      const label = typeof g.name === 'string' && g.name ? g.name : String(g.vmid);
      // The richer view of a machine leads: a hypervisor's numbers beat a
      // tailnet's "it is online".
      out.push({ source, guest: String(key), name: nameKey(label) ?? String(key), label, rank: hasNumbers(g) ? 1 : 2 });
    }
  }
  return out;
}

const refKey = (r) => `${r.source}/${r.guest ?? ''}`;
const refOf = (m) => (m.guest == null ? m.source : `${m.source}/${m.guest}`);

/**
 * The topology with what the feeds discovered merged in, by name
 * (docs/map.md "Discovered nodes"). A declared node claims a feed's host or
 * guest by its `feed` ref, or by its `label`/`id` equal to the machine's name
 * (case-insensitive); a claimed machine without a `feed` ref of its own gives
 * the node its live data. Every machine nobody claims becomes a node: a
 * `site` per feed source, a `room` per guest under it, `discovered: true`.
 * `coreLabel` is the synthetic core's name: a feed naming that machine hangs
 * its guests on the core instead of drawing the core twice.
 */
export function withDiscovered(topology, feeds, { coreLabel = null } = {}) {
  const topo = topology ?? EMPTY_TOPOLOGY;
  const machines = feedMachines(feeds);
  if (!machines.length) return topo;
  const groups = new Map(); // name -> machines, the best first
  for (const m of machines) {
    if (!groups.has(m.name)) groups.set(m.name, []);
    groups.get(m.name).push(m);
  }
  for (const g of groups.values()) g.sort((a, b) => a.rank - b.rank);
  const byRef = new Map(machines.map((m) => [refKey(m), m]));
  const owner = new Map(); // group name -> node id
  const nodes = topo.nodes.map((n) => ({ ...n }));
  const hasCore = nodes.some((n) => n.kind === 'core');
  // A `feed` ref claims first, so a name never steals what a ref names.
  for (const n of nodes) {
    const r = feedRef(n.feed);
    if (!r || r.service) continue;
    const m = byRef.get(refKey(r)) ?? (r.guest != null ? machines.find((x) => x.source === r.source && x.guest != null && nameKey(x.label) === nameKey(r.guest)) : null);
    if (m && !owner.has(m.name)) owner.set(m.name, n.id);
  }
  for (const n of nodes) {
    if (feedRef(n.feed)?.service) continue;
    for (const key of [nameKey(n.label), nameKey(n.id)]) {
      if (!key || !groups.has(key) || owner.has(key)) continue;
      owner.set(key, n.id);
      if (!n.feed) n.feed = refOf(groups.get(key)[0]);
      break;
    }
  }
  // The other feeds naming the same machine add what they know (its IPs, say).
  const claimed = new Map(nodes.map((n) => [n.id, n]));
  for (const [name, id] of owner) {
    const n = claimed.get(id);
    const own = feedRef(n.feed);
    const also = groups.get(name).filter((m) => !own || refKey(m) !== refKey(own)).map(refOf);
    if (also.length) n.also = [...(n.also ?? []), ...also];
  }
  const core = hasCore ? nodes.find((n) => n.kind === 'core').id : '__core';
  let coreRefs;
  if (!hasCore && nameKey(coreLabel) && groups.has(nameKey(coreLabel)) && !owner.has(nameKey(coreLabel))) {
    owner.set(nameKey(coreLabel), core);
    coreRefs = groups.get(nameKey(coreLabel)).map(refOf);
  }
  // The rest: hosts first, so a guest knows the node its source became.
  const ids = new Set(nodes.map((n) => n.id));
  const found = [];
  const place = (name) => {
    if (owner.has(name)) return;
    const [lead, ...rest] = groups.get(name);
    const id = `feed:${refOf(lead)}`;
    if (ids.has(id)) return;
    ids.add(id);
    owner.set(name, id);
    const hostNode = owner.get(machines.find((x) => x.source === lead.source && x.guest == null).name);
    const sources = [...new Set([lead, ...rest].map((x) => x.source))];
    found.push({
      id,
      parent: lead.guest != null && hostNode && hostNode !== id && hostNode !== '__core' ? hostNode : (hasCore ? core : undefined),
      kind: lead.guest == null ? 'site' : 'room',
      label: lead.label,
      feed: refOf(lead),
      discovered: true,
      also: rest.length ? rest.map(refOf) : undefined,
      detail: sources.length > 1 ? { 'Seen by': sources.join(', ') } : undefined,
    });
  };
  for (const m of machines) if (m.guest == null) place(m.name);
  for (const m of machines) if (m.guest != null) place(m.name);
  return { ...topo, nodes: [...nodes, ...found], coreRefs };
}

/**
 * What the feeds say about each node's tailnet identity, for Reach: a Map
 * node id -> `{tags: Set, ips: [parsed address]}`, from its `feed` ref and
 * the `also` refs of the same machine (the synthetic core from `coreRefs`).
 * A stale feed still counts: a node's tags and addresses outlive a missed push.
 */
export function nodeIdentities(topo, feeds) {
  const out = new Map();
  const add = (id, refs) => {
    const tags = new Set();
    const ips = [];
    for (const ref of refs) {
      const r = feedRef(ref);
      const feed = r && !r.service ? feeds?.get?.(r.source) : null;
      if (!feed) continue;
      const m = r.guest == null ? feed.host : arr(feed.guests).find((x) => String(x.vmid) === r.guest || x.name === r.guest);
      // Only tailnet tags: a hypervisor's own tags (`web`, `prod`) are not.
      for (const t of arr(m?.tags)) if (typeof t === 'string' && t.startsWith('tag:')) tags.add(t);
      for (const ip of arr(m?.ips)) { const a = parseAddr(ip); if (a) ips.push(a); }
    }
    if (tags.size || ips.length) out.set(id, { tags, ips });
  };
  for (const n of topo?.nodes ?? []) add(n.id, [n.feed, ...arr(n.also)].filter(Boolean));
  if (topo?.coreRefs) add('__core', topo.coreRefs);
  return out;
}

function builderNode(b, parent, lanes, now, { unclaimed }) {
  const metrics = healthMetrics(b.health, now) ?? vitalsMetrics(b.snapshot?.vitals) ?? undefined;
  let status = 'ok';
  let why;
  if (b.link === 'down') { status = 'down'; why = downWhy(b); }
  else if (b.link === 'stale') { status = 'unknown'; why = staleWhy(b); }
  else {
    const h = healthLevel(b.health, now);
    if (h) [status, why] = h;
  }
  const total = arr(b.snapshot?.lanes).length;
  const counts = {
    lanes: total,
    working: lanes.filter((l) => l.status === 'working').length,
    waiting: lanes.filter((l) => l.status === 'attention').length,
  };
  return {
    id: `builder:${b.id}`,
    parent,
    kind: 'builder',
    builder: b.id,
    label: b.code,
    status,
    why,
    sub: [b.id, plural(total, 'lane'), unclaimed ? 'not in topology' : null].filter(Boolean).join(' · '),
    metrics,
    counts,
    detail: compact({
      Version: b.version,
      Latency: b.latencyMs !== undefined ? `${Math.round(b.latencyMs)} ms` : undefined,
      'Last seen': b.lastSeenMs !== undefined ? `${agoWords(b.lastSeenMs)} ago` : undefined,
    }),
    stale: b.link !== 'up' || undefined,
    ageMs: b.link !== 'up' ? b.ageMs : undefined,
  };
}

// ------------------------------------------------------------------ lanes

const SESSION_STATUS = {
  waiting_permission: ['attention', 'waiting on a permission prompt'],
  waiting_question: ['attention', 'asked a question'],
  working: ['working', null],
  done: ['idle', 'done'],
  idle: ['idle', null],
  shell: ['idle', 'at a shell'],
  dead: ['idle', 'session ended'],
};

function toolLine(activity) {
  if (!activity?.tool) return null;
  const i = activity.toolInput;
  let arg = '';
  if (typeof i === 'string') arg = i;
  else if (i && typeof i === 'object') arg = i.file_path ?? i.command ?? i.pattern ?? i.path ?? i.description ?? '';
  arg = String(arg).split('\n')[0];
  if (arg.includes('/')) arg = arg.split('/').slice(-2).join('/');
  return `${String(activity.tool).slice(0, 40)}${arg ? ` ${arg.slice(0, 48)}` : ''}`;
}

function sessionStatus(s) {
  if (s.danger) return ['crit', `guard: ${String(s.danger.reason ?? s.danger).slice(0, 120)}`];
  return SESSION_STATUS[s.state] ?? ['unknown', null];
}

function sessionList(snapshot) {
  const s = snapshot?.sessions;
  const list = s instanceof Map ? [...s.values()] : arr(s);
  return list.filter((x) => x && typeof x.name === 'string' && x.name !== '');
}

const sessionCost = (s) => num(s.cost?.usd) ?? num(s.statuslineCostUsd);

function stuckOf(x) {
  if (!x || typeof x !== 'object') return null;
  return compact({ rule: clip(String(x.rule ?? ''), 40), reason: clip(String(x.reason ?? ''), 120), since: num(x.since) }) ?? null;
}

// Flags carry only what is set (most sessions have none), to keep the model small.
function sessionFlags(s) {
  return compact({
    stuck: stuckOf(s.stuck) ?? undefined,
    paused: s.paused ? true : undefined,
    awaitingApproval: typeof s.awaitingApproval === 'string' ? s.awaitingApproval.slice(0, 64) : undefined,
  });
}

/** `repo/pkg` names a lane touches: §6 facts first, else the lane's own list. */
function lanePackages(facts, lane) {
  const list = Array.isArray(facts?.packages) ? facts.packages : arr(lane.packages);
  return [...new Set(list.filter((p) => typeof p === 'string' && p.includes('/') && NAME_RX.test(p)))];
}

/**
 * One node per lane of one builder, its status the worst of its sessions,
 * plus one `session` child per live session when a lane has two or more.
 * Generalizes the builder-mode `laneNodes`: ids are `lane:<builder>/<lane>`
 * and `sess:<builder>/<name>`, every node carries `builder` and `fkey`.
 * A lane under a builder that is not `up` keeps its last status and gets
 * `stale: true` (and `ageMs`, the age of the snapshot it came from).
 */
export function fleetLaneNodes(snapshot, { builder = config.fleet?.id, parent, show = 'active', now = Date.now(), laneFacts = null, stale = false, ageMs } = {}) {
  if (show === 'none') return [];
  const sessions = new Map(sessionList(snapshot).map((s) => [s.name, s]));
  const out = [];
  for (const lane of arr(snapshot?.lanes)) {
    if (!lane || typeof lane.id !== 'string' || !lane.id) continue;
    let key;
    try { key = fkey(builder, lane.id); } catch { continue; }
    const id = `lane:${key}`;
    const own = arr(lane.sessions).map((n) => sessions.get(n)).filter(Boolean);
    const live = own.filter((s) => s.state !== 'dead');
    if (show === 'active' && !live.length) continue;
    let status = 'idle';
    let why = live.length ? null : 'no session';
    let sub = null;
    for (const s of live) {
      const [st, w] = sessionStatus(s);
      if (SEVERITY.indexOf(st) > SEVERITY.indexOf(status)) { status = st; why = w; }
      if (s.state === 'working') sub ??= toolLine(s.activity);
    }
    if (status === 'idle' && live.some((s) => s.state === 'done')) sub ??= 'done';
    const waitingSince = live.filter((s) => SESSION_STATUS[s.state]?.[0] === 'attention').map((s) => num(s.stateSince)).filter((v) => v !== undefined);
    if (waitingSince.length) why = `${why} · ${agoWords(now - Math.min(...waitingSince))}`;
    const branch = typeof lane.branch === 'string' ? lane.branch : undefined;
    const detail = {};
    if (branch) detail.Branch = clip(branch, 120);
    // With two or more live sessions they are child nodes and say it themselves.
    if (own.length && live.length < 2) detail.Sessions = clip(own.map((s) => `${s.name} (${s.state})`).join(', '));
    if (lane.progress) detail.Plan = clip(typeof lane.progress === 'string' ? lane.progress : String(lane.progress.label ?? `${lane.progress.done ?? '?'}/${lane.progress.total ?? '?'}`), 80);
    if (lane.merged) detail.Merged = 'into main';
    const facts = laneFacts?.get?.(key) ?? null;
    const costs = own.map(sessionCost).filter((v) => v !== undefined);
    const ctx = live.map((s) => num(s.context?.usedPct)).filter((v) => v !== undefined);
    const born = own.map((s) => num(s.createdAt)).filter((v) => v !== undefined);
    const lead = live.find((s) => s.stuck) ?? null;
    out.push({
      id,
      parent,
      kind: 'lane',
      builder,
      fkey: key,
      label: lane.id,
      status,
      why: ['attention', 'crit'].includes(status) ? why : undefined,
      sub: clip(sub ?? (why && !['attention', 'crit'].includes(status) ? why : branch ?? undefined)),
      detail,
      // The fleet key of its first session (the client store is keyed by it).
      session: own[0] ? fkey(builder, own[0].name) : undefined,
      flags: compact({
        stuck: stuckOf(lead?.stuck) ?? undefined,
        paused: live.some((s) => s.paused) || undefined,
        awaitingApproval: live.map((s) => s.awaitingApproval).find((v) => typeof v === 'string')?.slice(0, 64),
        reviewReady: lane.reviewReady?.ready ? true : undefined,
      }),
      m: compact({
        costUsd: round(num(facts?.costUsd) ?? num(lane.costUsd) ?? (costs.length ? costs.reduce((a, b) => a + b, 0) : undefined)),
        ctxPct: ctx.length ? Math.round(Math.max(...ctx)) : undefined,
        ageMs: born.length ? Math.max(0, now - Math.min(...born)) : undefined,
        ci: CI_WORDS.includes(facts?.ci) ? facts.ci : undefined,
      }),
      stale: stale || undefined,
      ageMs: stale ? num(ageMs) : undefined,
      // Internal, for links; removed before the model leaves buildFleet.
      branch,
      packages: lanePackages(facts, lane),
    });
    if (live.length < 2) continue;
    for (const s of live) {
      const k = fkey(builder, s.name);
      const [st, w] = sessionStatus(s);
      out.push({
        id: `sess:${k}`,
        parent: id,
        kind: 'session',
        builder,
        fkey: k,
        label: clip(s.name, 64),
        status: st,
        why: ['attention', 'crit'].includes(st) ? w : undefined,
        sub: s.state === 'working' ? clip(toolLine(s.activity)) : undefined,
        flags: sessionFlags(s),
        m: compact({ costUsd: round(sessionCost(s)), ctxPct: num(s.context?.usedPct) !== undefined ? Math.round(s.context.usedPct) : undefined }),
        stale: stale || undefined,
      });
    }
  }
  return out;
}

/** Builder-mode lane nodes only (fleet F7 signature), without session children. */
export function laneNodes(snapshot, { parent, show, now, builderId = config.fleet?.id, laneFacts } = {}) {
  return fleetLaneNodes(snapshot, { builder: builderId, parent, show, now, laneFacts }).filter((n) => n.kind === 'lane');
}

// ------------------------------------------------------------------ repos

const PKG_STATUS = { fail: 'crit', running: 'working', pass: 'ok', none: 'idle' };

/**
 * The repos island: `__repos`, then `repo:<name>` and `pkg:<repo>/<pkg>`
 * per §6 row. Empty when there are no repos.
 */
export function repoNodes(repos, { parent = '__core' } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of arr(repos)) {
    if (!r || typeof r.name !== 'string' || !NAME_RX.test(r.name)) continue;
    const rid = `repo:${r.name}`;
    if (seen.has(rid)) continue;
    seen.add(rid);
    const pkgs = [];
    for (const p of arr(r.packages)) {
      if (!p || typeof p.name !== 'string' || !NAME_RX.test(p.name)) continue;
      const pid = `pkg:${r.name}/${p.name}`;
      if (seen.has(pid)) continue;
      seen.add(pid);
      const ci = CI_WORDS.includes(p.ci) ? p.ci : undefined;
      const status = PKG_STATUS[ci] ?? 'unknown';
      pkgs.push({
        id: pid,
        parent: rid,
        kind: 'package',
        label: p.name,
        status,
        why: status === 'crit' ? clip(p.why, 120) ?? 'CI failed' : undefined,
        sub: status === 'crit' ? undefined : clip(p.why, 120),
        m: ci ? { ci } : undefined,
      });
    }
    out.push({ id: rid, parent: '__repos', kind: 'repo', label: r.name, status: 'ok' }, ...pkgs);
  }
  if (!out.length) return [];
  return [{ id: '__repos', parent, kind: 'site', label: 'REPOS', status: 'ok' }, ...out];
}

// ------------------------------------------------------------------ links

/**
 * §6 P11 `edges` ([{a, b, kind: 'textual'|'overlap', files, repo}]) as the
 * map's `overlaps`: textual -> conflict (confirmed), overlap -> touch. Edges
 * to `main:<repo>` (no lane on the other end) are dropped. Already-normalized
 * kinds (touch, predicted, conflict) pass through.
 */
export function normalizeOverlaps(edges) {
  const KIND = { textual: 'conflict', conflict: 'conflict', predicted: 'predicted', overlap: 'touch', touch: 'touch' };
  const out = [];
  for (const e of arr(edges)) {
    if (!e || !isFkey(e.a) || !isFkey(e.b) || e.a === e.b) continue;
    const kind = KIND[e.kind];
    if (!kind) continue;
    out.push({
      a: e.a,
      b: e.b,
      kind,
      files: Math.max(0, Math.floor(num(e.files) ?? (Array.isArray(e.files) ? e.files.length : 0))),
      packages: arr(e.packages).filter((p) => typeof p === 'string' && NAME_RX.test(p)),
      label: clip(e.label, 80),
      repo: typeof e.repo === 'string' && NAME_RX.test(e.repo) ? e.repo : undefined,
    });
  }
  return out;
}

const OVERLAP_RANK = { touch: 0, predicted: 1, conflict: 2 };
const RUNNING = new Set(['running', 'in_progress', 'queued']);
const shortPkgs = (list) => list.slice(0, 3).map((p) => p.split('/').pop()).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');

/**
 * Every link of the model: the topology's own, lane rules, then lane-lane
 * `touch`/`conflict` (one per pair, the worst wins), lane->package `pkg`, and
 * builder->runner `ci`.
 */
export function fleetLinks({ lanes = [], overlaps = [], topology = null, builders = [], ciRuns = [], nodeIds = null } = {}) {
  const topo = topology ?? EMPTY_TOPOLOGY;
  const links = topo.links.map((l) => ({
    id: l.id ?? `${l.from}>${l.to}`, from: l.from, to: l.to, kind: l.kind ?? 'dep', label: l.label, live: Boolean(l.live),
  }));
  for (const rule of topo.lanes?.links ?? []) {
    const re = new RegExp(rule.match);
    for (const ln of lanes) {
      if (re.test(ln.label) || (ln.branch && re.test(ln.branch))) {
        links.push({ id: `${ln.id}>${rule.to}`, from: ln.id, to: rule.to, kind: rule.kind ?? 'dep', label: rule.label, live: ln.status === 'working' });
      }
    }
  }

  const laneByKey = new Map(lanes.map((l) => [l.fkey, l]));
  const pairs = new Map();
  for (const o of arr(overlaps)) {
    const A = laneByKey.get(o?.a);
    const B = laneByKey.get(o?.b);
    if (!A || !B || A === B || !(o.kind in OVERLAP_RANK)) continue;
    const [from, to] = [A.id, B.id].sort();
    const key = `${from}|${to}`;
    const cur = pairs.get(key);
    const files = num(o.files) ?? 0;
    const packages = arr(o.packages);
    if (cur && OVERLAP_RANK[cur.kind] > OVERLAP_RANK[o.kind]) continue;
    if (cur && cur.kind === o.kind) {
      cur.files = Math.max(cur.files, files);
      cur.packages = [...new Set([...cur.packages, ...packages])];
      cur.label ??= o.label;
      continue;
    }
    pairs.set(key, { kind: o.kind, from, to, files, packages: [...new Set(packages)], label: o.label });
  }
  for (const [key, p] of [...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const fileWords = plural(p.files, 'file');
    if (p.kind === 'touch') {
      links.push({
        id: `touch:${key}`, kind: 'touch', from: p.from, to: p.to, files: p.files,
        packages: p.packages.length ? p.packages : undefined,
        label: p.label ?? (p.packages.length ? `${fileWords} · ${shortPkgs(p.packages)}` : fileWords),
        live: false,
      });
    } else {
      const predicted = p.kind === 'predicted';
      links.push({
        id: `conflict:${key}`, kind: 'conflict', from: p.from, to: p.to, predicted, severity: predicted ? 'warn' : 'crit',
        files: p.files, packages: p.packages.length ? p.packages : undefined,
        label: p.label ?? `${predicted ? 'merge risk' : 'merge conflict'} · ${fileWords}`,
        live: false,
      });
    }
  }

  const has = (id) => !nodeIds || nodeIds.has(id);
  const seen = new Set();
  for (const ln of lanes) {
    for (const p of arr(ln.packages)) {
      const to = `pkg:${p}`;
      const id = `pkg:${ln.id}>${to}`;
      if (!has(to) || seen.has(id)) continue;
      seen.add(id);
      links.push({ id, kind: 'pkg', from: ln.id, to, live: ln.status === 'working' });
    }
  }

  const branchesOf = new Map();
  for (const ln of lanes) {
    if (!branchesOf.has(ln.builder)) branchesOf.set(ln.builder, new Set());
    if (ln.branch) branchesOf.get(ln.builder).add(ln.branch);
  }
  for (const r of topo.nodes) {
    if (r.ci?.runner !== true) continue;
    const f = r.ci.for ?? '*';
    for (const b of builders) {
      if (f !== '*' && !f.includes(b.id)) continue;
      const from = `builder:${b.id}`;
      if (!has(from)) continue;
      const live = arr(ciRuns).some((run) => run && run.runner === r.id && run.builder === b.id && RUNNING.has(run.status)
        && (!run.branch || branchesOf.get(b.id)?.has(run.branch)));
      links.push({ id: `ci:${from}>${r.id}`, kind: 'ci', from, to: r.id, live });
    }
  }
  return links;
}

// ------------------------------------------------------------------ build

/**
 * The fleet model. Pure: every input is passed in, so the whole merge is
 * testable without a feed on disk, a network, a hub or a tmux server.
 *
 *   builders  [{id, code, link|state, ageMs, lastSeenMs?, latencyMs?, version?, snapshot, health?}]
 *   repos     [{name, packages: [{name, ci, why?}]}]          (§6 rows)
 *   laneFacts Map<fkey, {packages: ['repo/pkg'], costUsd, ci}> (§6)
 *   overlaps  [{a, b, kind: touch|predicted|conflict, files, packages}] (normalizeOverlaps)
 *   ciRuns    [{runner, builder, branch, status}]
 *   localId   the builder `self` aliases (builder mode); on a hub, none
 *   feedsOff  this board does not read feeds (a builder a hub watches)
 *   policy    a parsed policy file (map/reach.mjs), or null: no Reach
 *   runs      folded runs (the runs store's list), each a `run:<id>` node (map/runs.mjs)
 *   runsCfg   `config.runs` (`mapKeepMin`, `stuck`)
 */
export function buildFleet({
  topology, feeds = new Map(), probes = new Map(), now = Date.now(), topologyError = null, hostname = config.hostname,
  builders = [], repos = [], laneFacts = null, overlaps = [], ciRuns = [], localId = null, feedsOff = false,
  policy = null, policyError = null, runs = [], runsCfg = config.runs,
} = {}) {
  const topo = withDiscovered(topology, feeds, { coreLabel: topology?.title ?? hostname });
  const fleet = cleanBuilders(builders);
  const byBuilder = new Map(fleet.map((b) => [b.id, b]));
  const anchors = attachBuilders(topo, fleet, { localId, feeds });
  const hostOf = new Map();
  for (const [b, p] of anchors) if (p !== '__fleet') hostOf.set(p, b);
  const facts = laneFacts instanceof Map ? laneFacts
    : laneFacts && typeof laneFacts === 'object' ? new Map(Object.entries(laneFacts)) : null;

  const nodes = [];
  const hasCore = topo.nodes.some((n) => n.kind === 'core');
  if (!hasCore) nodes.push({ id: '__core', kind: 'core', label: topo.title ?? hostname, status: 'ok' });

  const live = new Map(); // id -> merged live view, so children can inherit
  const byId = new Map(topo.nodes.map((n) => [n.id, n]));
  const order = [];
  const visit = (n) => { if (live.has(n.id) || order.includes(n)) return; if (n.parent && byId.has(n.parent)) visit(byId.get(n.parent)); order.push(n); };
  topo.nodes.forEach(visit);

  for (const n of order) {
    const f = fromFeed(n, feeds, now);
    const p = fromProbe(n, probes);
    const hosted = hostOf.has(n.id) ? byBuilder.get(hostOf.get(n.id)) : null;
    let status, why, sub = n.sub, metrics, memCache = false, derived = false, detail = { ...(n.detail ?? {}) };
    if (f || p) {
      status = f && p ? worse(f.status, p.status) : (f ?? p).status;
      why = [f, p].filter((x) => x && x.status === status && x.why).map((x) => x.why)[0] ?? f?.why ?? p?.why;
      // A probe's latency is worth showing next to the topology's own line.
      sub = f?.sub ?? ([sub, p?.sub].filter(Boolean).join(' · ') || undefined);
      metrics = f?.metrics;
      memCache = Boolean(f?.memCache);
      Object.assign(detail, f?.detail ?? {}, p?.detail ?? {});
      for (const ref of arr(n.also)) {
        const o = fromFeed({ feed: ref }, feeds, now);
        for (const [k, v] of Object.entries(o?.detail ?? {})) if (!(k in detail)) detail[k] = v;
      }
      if (hosted) {
        // §7: a room that hosts a builder is as bad as its feed or its link.
        const ls = linkStatus(hosted.link);
        const next = worse(status, ls);
        if (next !== status) { status = next; why = `${hosted.id} ${ls === 'down' ? downWhy(hosted) : staleWhy(hosted)}`; }
      }
    } else if (hosted) {
      // No feed of its own: the builder link is its source.
      status = linkStatus(hosted.link);
      why = status === 'down' ? `${hosted.id} ${downWhy(hosted)}` : undefined;
    } else if (n.kind === 'core' || n.kind === 'site') {
      // A place has no status of its own; the view rolls its children up.
      status = 'ok';
    } else if (n.parent && live.has(n.parent) && live.get(n.parent).sourced) {
      // No check of its own: it is as up as the thing it runs inside.
      derived = true;
      const ps = live.get(n.parent).status;
      status = ps === 'down' || ps === 'unknown' ? ps : 'ok';
      why = ps === 'down' ? `${byId.get(n.parent).label ?? n.parent} is down` : undefined;
    } else {
      status = n.status ?? 'unknown';
    }
    if (hosted) {
      // The builder's own fresh health beats the hypervisor's view of it.
      const hm = healthMetrics(hosted.health, now);
      if (hm) metrics = { ...(metrics ?? {}), ...hm };
    }
    live.set(n.id, { status, sourced: Boolean(f || p || hosted) });
    const m = metrics ? Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, round(v)]).filter(([, v]) => v !== undefined)) : undefined;
    nodes.push({
      id: n.id,
      parent: n.parent ?? (hasCore || n.kind === 'core' ? null : '__core'),
      kind: n.kind ?? (n.parent ? 'service' : 'site'),
      label: n.label ?? n.id,
      order: n.order,
      status,
      why,
      sub,
      metrics: m && Object.keys(m).length ? m : undefined,
      memCache: memCache || undefined,
      // Its status is its parent's: the parent's event already says it.
      derived: derived || undefined,
      detail: Object.keys(detail).length ? detail : undefined,
      href: n.href,
      // The builder this node hosts; its events are the builder node's.
      hosts: hosted?.id,
      // No topology node names it: a feed found it (docs/map.md "Discovered nodes").
      discovered: n.discovered || undefined,
      drift: driftOf(n, feeds, now, { declared: topology != null }),
    });
  }

  const coreId = hasCore ? topo.nodes.find((n) => n.kind === 'core').id : '__core';
  if (fleet.some((b) => anchors.get(b.id) === '__fleet')) {
    nodes.push({ id: '__fleet', kind: 'site', parent: coreId, label: 'FLEET', status: 'ok' });
  }
  const lanes = [];
  for (const b of fleet) {
    const parent = anchors.get(b.id);
    const mine = fleetLaneNodes(b.snapshot, {
      builder: b.id, parent: `builder:${b.id}`, show: topo.lanes?.show ?? 'active', now, laneFacts: facts, stale: b.link !== 'up', ageMs: b.ageMs,
    });
    const laneList = mine.filter((n) => n.kind === 'lane');
    nodes.push(builderNode(b, parent, laneList, now, { unclaimed: parent === '__fleet' && topology != null }));
    nodes.push(...mine);
    lanes.push(...laneList);
  }
  nodes.push(...repoNodes(repos, { parent: coreId }));
  nodes.push(...runNodes(runs, { nodes, coreId, now, keepMin: runsCfg?.mapKeepMin, stuck: runsCfg?.stuck }));

  const links = fleetLinks({ lanes, overlaps, topology: topo, builders: fleet, ciRuns, nodeIds: new Set(nodes.map((n) => n.id)) });
  for (const n of lanes) { delete n.branch; delete n.packages; }
  // Reach is opt-in and kept out of `links`: only its overlay draws it.
  let reach;
  if (policy || policyError) {
    const ids = new Set(nodes.map((n) => n.id));
    const r = policy ? reachLinks(policy, nodeIdentities(topo, feeds)) : { links: [], rules: 0, unresolved: [] };
    r.links = r.links.filter((l) => ids.has(l.from) && ids.has(l.to));
    reach = { ...r, error: policyError ?? undefined };
  }

  return {
    title: topo.title ?? hostname,
    fleet: { builders: fleet.map((b) => ({ id: b.id, code: b.code, link: b.link })) },
    nodes,
    links,
    error: topologyError ?? undefined,
    feeds: feedsOff ? false : undefined,
    reach,
    generatedAt: now,
  };
}

/**
 * Builder mode: this board's snapshot as a fleet of one, id `config.fleet.id`,
 * always `up`. Same code path as the hub (fleet conventions).
 */
export function build({ snapshot = null, builderId = config.fleet?.id, code, ...rest } = {}) {
  code ??= builderId === config.fleet?.id ? config.fleet?.code : undefined;
  const builders = typeof builderId === 'string' && BUILDER_ID_RX.test(builderId)
    ? [{ id: builderId, code, link: 'up', state: 'up', ageMs: 0, snapshot }]
    : [];
  return buildFleet({ ...rest, builders, localId: builderId });
}

/**
 * The map's fleet input from the hub fleet store's `view(now)` (H3): link
 * from the connection state, the cached snapshot in the wire shape (sessions
 * as a list), the latest health sample.
 */
export function toMapFleet(view, now = num(view?.now) ?? Date.now()) {
  const builders = [];
  for (const b of arr(view?.builders)) {
    if (!b || typeof b.id !== 'string') continue;
    const snap = b.snap && typeof b.snap === 'object' ? b.snap : null;
    const lastSeen = num(b.conn?.lastSeen);
    builders.push({
      id: b.id,
      code: b.code,
      state: b.state,
      link: linkOf(b.state),
      ageMs: num(b.ageMs),
      lastSeenMs: lastSeen !== undefined ? Math.max(0, now - lastSeen) : undefined,
      latencyMs: num(b.conn?.latencyMs),
      version: b.hello?.version ?? undefined,
      snapshot: snap ? { ...snap, sessions: sessionList(snap), lanes: arr(snap.lanes) } : null,
      health: snap?.health ?? null,
    });
  }
  return { builders };
}

// ------------------------------------------------------------------ events

const STATUS_WORDS = {
  ok: 'is up', working: 'is working', warn: 'is degraded', attention: 'needs you', crit: 'is failing',
  down: 'is down', idle: 'is idle', unknown: 'stopped reporting',
};

/**
 * Status changes between two models, as events. A lane going from working to
 * working is not news; a room going down is. A builder going down is one
 * event: its lanes (which keep their last status) and the room hosting it say
 * nothing in the same tick.
 */
export function diffEvents(prev, next, now = Date.now()) {
  if (!prev) return [];
  const before = new Map(prev.nodes.map((n) => [n.id, n.status]));
  const byId = new Map(next.nodes.map((n) => [n.id, n]));
  // When a feed drops, its host and every guest change together: one line for
  // the host says it, twenty for the guests bury everything else.
  const sameAsParent = (n) => {
    const p = n.parent && byId.get(n.parent);
    return p && before.has(p.id) && before.get(p.id) !== p.status && p.status === n.status;
  };
  // The builder node changed (or appeared) this tick: it speaks for its own.
  const builderMoved = (b) => {
    const bn = b != null && byId.get(`builder:${b}`);
    return Boolean(bn) && before.get(bn.id) !== bn.status;
  };
  const multi = (next.fleet?.builders?.length ?? 0) > 1;
  const nameOf = (n) => {
    if (n.kind === 'builder') return `builder ${n.builder}`;
    if (multi && n.builder) return `${byId.get(`builder:${n.builder}`)?.label ?? n.builder} ${n.label}`;
    return n.label;
  };
  const out = [];
  for (const n of next.nodes) {
    if (n.derived) continue;
    if (n.kind !== 'builder' && (builderMoved(n.builder ?? n.hosts) || sameAsParent(n))) continue;
    const was = before.get(n.id);
    if (was === undefined) {
      if (n.kind === 'lane') out.push({ at: now, node: n.id, kind: n.status, text: `${nameOf(n)} started` });
      continue;
    }
    if (was === n.status) continue;
    if (was === 'unknown' && n.status === 'ok') continue; // first data in, not a recovery
    const text = `${nameOf(n)} ${STATUS_WORDS[n.status] ?? n.status}${n.why ? ` · ${n.why}` : ''}`;
    out.push({ at: now, node: n.id, kind: n.status === 'idle' && was === 'working' ? 'ok' : n.status, text });
  }
  return out;
}

/** Events a feed carries itself (a backup finished), newest first, once each. */
export function feedEvents(feeds, topology, seen) {
  const out = [];
  const nodesByRef = new Map();
  for (const n of topology?.nodes ?? []) {
    const r = feedRef(n.feed);
    // A feed's events name a guest, never one of its services.
    if (r && !r.service) nodesByRef.set(`${r.source}/${r.guest ?? ''}`, n.id);
  }
  for (const [source, feed] of feeds) {
    const last = seen.get(source);
    let newest = last ?? 0;
    const mine = [];
    for (const e of feed.events ?? []) {
      const at = Number(e.at);
      if (!at || at <= (last ?? 0)) continue;
      newest = Math.max(newest, at);
      const node = nodesByRef.get(`${source}/${e.guest ?? ''}`) ?? nodesByRef.get(`${source}/`);
      mine.push({ at, node, kind: e.kind ?? 'ok', text: String(e.text ?? '').slice(0, 200) });
    }
    seen.set(source, newest);
    // The first read of a feed sets the mark without replaying its history.
    if (last !== undefined) out.push(...mine);
  }
  return out;
}

// ------------------------------------------------------------------ live

let current = null;
let events = [];
const feedSeen = new Map();
let lastSentAt = 0;
let lastShape = '';

/** What, when it changes, is sent at once (metrics that only jitter are not). */
export function shapeKey(m) {
  return JSON.stringify(
    m.nodes.map((n) => [n.id, n.status, n.why, n.sub, n.label, n.parent, n.flags ?? null, n.stale ?? null])
      .concat(m.links.map((l) => [l.id, l.live, l.severity ?? null, l.predicted ?? null, l.label ?? null]))
      .concat([(m.fleet?.builders ?? []).map((b) => [b.id, b.link])])
      .concat([(m.reach?.links ?? []).map((l) => [l.id, l.label]), m.reach?.error ?? null]),
  );
}

function emit(next, feeds, topology, now, resendMs) {
  const fresh = [...diffEvents(current, next, now), ...feedEvents(feeds, topology, feedSeen)];
  if (fresh.length) events = [...events, ...fresh].slice(-80);
  current = next;
  // Statuses, labels and structure go out at once; metrics that only jitter
  // go out at most every `resendMs`.
  const shape = shapeKey(next);
  const changed = shape !== lastShape;
  if (!changed && !fresh.length && now - lastSentAt < resendMs) return null;
  lastShape = shape;
  lastSentAt = now;
  return { type: 'map', map: model() };
}

/** False on a builder a hub watches (`fleet.hubKeys` set): the hub reads the feeds (§7). */
export function feedsEnabled(c = config) {
  const keys = c?.fleet?.hubKeys;
  return !(Array.isArray(keys) && keys.length > 0);
}

// Where builder mode takes its runs: set by the runs route module
// (server/routes/runs.mjs, builder only), so this file, which the hub loads
// too, imports no collector. Unset = no runs.
let runsSource = null;

/** `fn()` gives the folded runs to draw (the runs store's list), or null to stop. */
export function setRunsSource(fn) {
  runsSource = typeof fn === 'function' ? fn : null;
}

/** Builder mode: rebuild from the latest snapshot. Returns a message worth sending, or null. */
export function tick(snapshot, now = Date.now()) {
  const t = loadTopology();
  const on = feedsEnabled();
  const feeds = on ? readFeeds() : new Map();
  const p = loadPolicy(config.map.policyFile);
  let runs = [];
  try { runs = runsSource?.() ?? []; } catch { runs = []; }
  const next = build({ topology: t.value, feeds, probes: probeResults, snapshot, now, topologyError: t.error, feedsOff: !on, policy: p.value, policyError: p.error, runs });
  return emit(next, feeds, withDiscovered(t.value, feeds, { coreLabel: next.title }), now, 5000);
}

/**
 * Hub mode (called by the hub map loop, H11): rebuild from the fleet.
 * `fleet` is `toMapFleet(store.view(now))` (a raw `view` is accepted too)
 * plus optional `repos`, `laneFacts`, `overlaps` (or P11 `edges`), `ciRuns`.
 */
export function tickFleet(fleet, now = Date.now()) {
  const t = loadTopology();
  const feeds = readFeeds();
  const raw = fleet ?? {};
  const f = arr(raw.builders).some((b) => b && 'snap' in b && !('snapshot' in b)) ? { ...raw, ...toMapFleet(raw, now) } : raw;
  const p = loadPolicy(config.map.policyFile);
  const next = buildFleet({
    topology: t.value, feeds, probes: probeResults, now, topologyError: t.error, policy: p.value, policyError: p.error,
    builders: f.builders, repos: f.repos, laneFacts: f.laneFacts,
    overlaps: f.overlaps ?? normalizeOverlaps(f.edges), ciRuns: f.ciRuns,
  });
  return emit(next, feeds, withDiscovered(t.value, feeds, { coreLabel: next.title }), now, 10_000);
}

export function model() {
  return current ? { ...current, events } : { title: config.hostname, fleet: { builders: [] }, nodes: [], links: [], events: [], generatedAt: Date.now() };
}

export function start() {
  return startProbes();
}
