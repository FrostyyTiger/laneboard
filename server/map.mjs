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
// Lanes and sessions come from the board's own snapshot and are attached
// under the node the topology calls `self`. With no topology at all the Map is
// this host with its lanes around it, which is still a picture.
//
// docs/map.md has the file formats.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { log } from './log.mjs';

export const KINDS = ['core', 'site', 'host', 'room', 'service', 'lane', 'pr'];
export const LINK_KINDS = ['dep', 'flow', 'share'];
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
    if (n.id.startsWith('lane:')) bad(`nodes[${i}]: ids starting "lane:" are laneboard's own`);
    if (ids.has(n.id)) bad(`nodes[${i}]: duplicate id ${JSON.stringify(n.id)}`);
    ids.add(n.id);
    if (n.kind && !KINDS.includes(n.kind)) bad(`nodes[${i}] (${n.id}): kind must be one of ${KINDS.join(', ')}`);
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
    if (l.kind && !LINK_KINDS.includes(l.kind)) bad(`links[${i}]: kind must be one of ${LINK_KINDS.join(', ')}`);
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
      const source = String(hit.value?.source || name.replace(/\.json$/, ''));
      out.set(source, { ...hit.value, source, receivedAt: st.mtimeMs });
    } catch {
      // A half-written file is simply not there this pass; the pusher writes
      // to a temp name and renames, so this is rare.
    }
  }
  return out;
}

/** "hv1" is a host; "hv1/103" or {source, guest} is a guest of it. */
export function feedRef(ref) {
  if (!ref) return null;
  if (typeof ref === 'object') return { source: String(ref.source), guest: ref.guest != null ? String(ref.guest) : null };
  const [source, guest] = String(ref).split('/');
  return { source, guest: guest ?? null };
}

const agoWords = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

/** What a feed says about one node, or null when the node has no feed. */
export function fromFeed(node, feeds, now) {
  const ref = feedRef(node.feed);
  if (!ref) return null;
  const feed = feeds.get(ref.source);
  if (!feed) return { status: 'unknown', why: `no feed from ${ref.source} yet` };
  const at = Number(feed.at) || feed.receivedAt;
  const every = Math.max(10, Number(feed.every) || 60) * 1000;
  const age = now - at;
  if (age > Math.max(3 * every, config.map.feedStaleMs)) {
    return { status: 'unknown', why: `no data from ${ref.source} for ${agoWords(age)}` };
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
  const expectStopped = node.expect === 'stopped';
  const status = g.status === 'running' ? (expectStopped ? 'warn' : 'ok')
    : g.status === 'stopped' ? (expectStopped ? 'idle' : 'down')
      : g.status === 'paused' || g.status === 'suspended' ? 'warn' : 'unknown';
  const why = status === 'down' ? `${g.type === 'lxc' ? 'container' : 'VM'} is stopped`
    : status === 'warn' && !expectStopped ? `guest is ${g.status}`
      : status === 'warn' ? 'running but expected to be stopped' : undefined;
  const mem = g.maxmem ? g.mem / g.maxmem : g.memFrac;
  const detail = { ...(g.detail ?? {}) };
  if (g.vmid != null) detail.ID ??= g.vmid;
  if (g.uptime) detail.Uptime ??= agoWords(g.uptime * 1000).replace(/s$/, 's');
  return {
    status,
    why: g.why ?? why,
    sub: g.sub,
    metrics: status === 'ok' ? { cpu: clamp01(g.cpu), mem: clamp01(mem), disk: clamp01(g.disk), gpu: clamp01(g.gpu) } : undefined,
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
  return `${activity.tool}${arg ? ` ${arg.slice(0, 48)}` : ''}`;
}

/** One node per lane, its status the worst of its sessions. */
export function laneNodes(snapshot, { parent, show = 'active', now = Date.now() } = {}) {
  if (show === 'none') return [];
  const sessions = new Map((snapshot?.sessions ?? []).map((s) => [s.name, s]));
  const out = [];
  for (const lane of snapshot?.lanes ?? []) {
    const own = lane.sessions.map((n) => sessions.get(n)).filter(Boolean);
    const live = own.filter((s) => s.state !== 'dead');
    if (show === 'active' && !live.length) continue;
    let status = live.length ? 'idle' : 'idle';
    let why = live.length ? null : 'no session';
    let sub = null;
    for (const s of live) {
      const [st, w] = s.danger ? ['crit', `guard: ${s.danger.reason ?? s.danger}`] : SESSION_STATUS[s.state] ?? ['unknown', null];
      if (SEVERITY.indexOf(st) > SEVERITY.indexOf(status)) { status = st; why = w; }
      if (s.state === 'working') sub ??= toolLine(s.activity);
    }
    if (status === 'idle' && live.some((s) => s.state === 'done')) sub ??= 'done';
    const waitingSince = live.filter((s) => SESSION_STATUS[s.state]?.[0] === 'attention').map((s) => s.stateSince).filter(Boolean);
    if (waitingSince.length) why = `${why} · ${agoWords(now - Math.min(...waitingSince))}`;
    const detail = {};
    if (lane.branch) detail.Branch = lane.branch;
    if (own.length) detail.Sessions = own.map((s) => `${s.name} (${s.state})`).join(', ');
    if (lane.progress) detail.Plan = typeof lane.progress === 'string' ? lane.progress : lane.progress.label ?? `${lane.progress.done ?? '?'}/${lane.progress.total ?? '?'}`;
    if (lane.merged) detail.Merged = 'into main';
    out.push({
      id: `lane:${lane.id}`,
      parent,
      kind: 'lane',
      label: lane.id,
      status,
      why: ['attention', 'crit'].includes(status) ? why : undefined,
      sub: sub ?? (why && !['attention', 'crit'].includes(status) ? why : lane.branch ?? undefined),
      detail,
      session: own[0]?.name,
      branch: lane.branch,
    });
  }
  return out;
}

// ------------------------------------------------------------------ build

/**
 * The model. Pure: every input is passed in, so the whole merge is testable
 * without a feed on disk, a network, or a tmux server.
 */
export function build({ topology, feeds = new Map(), probes = new Map(), snapshot = null, hostname = config.hostname, now = Date.now(), topologyError = null }) {
  const topo = topology ?? { title: null, self: null, nodes: [], links: [], lanes: { show: 'active', links: [] } };
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
    let status, why, sub = n.sub, metrics, memCache = false, derived = false, detail = { ...(n.detail ?? {}) };
    if (f || p) {
      status = f && p ? worse(f.status, p.status) : (f ?? p).status;
      why = [f, p].filter((x) => x && x.status === status && x.why).map((x) => x.why)[0] ?? f?.why ?? p?.why;
      // A probe's latency is worth showing next to the topology's own line.
      sub = f?.sub ?? ([sub, p?.sub].filter(Boolean).join(' · ') || undefined);
      metrics = f?.metrics;
      memCache = Boolean(f?.memCache);
      Object.assign(detail, f?.detail ?? {}, p?.detail ?? {});
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
    if (n.id === topo.self && snapshot?.vitals) {
      const v = snapshot.vitals;
      metrics = {
        ...(metrics ?? {}),
        cpu: clamp01((v.cpuPct ?? 0) / 100),
        mem: v.mem?.totalMb ? clamp01(v.mem.usedMb / v.mem.totalMb) : undefined,
        disk: v.disk?.usedPct != null ? clamp01(v.disk.usedPct / 100) : undefined,
      };
      if (!f && !p) status = 'ok';
      const sessions = snapshot.sessions?.length ?? 0;
      sub ??= `${sessions} session${sessions === 1 ? '' : 's'} · this board`;
    }
    live.set(n.id, { status, sourced: Boolean(f || p || n.id === topo.self) });
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
    });
  }

  const coreId = hasCore ? topo.nodes.find((n) => n.kind === 'core').id : '__core';
  const lanes = laneNodes(snapshot, { parent: topo.self ?? coreId, show: topo.lanes.show, now });
  nodes.push(...lanes);

  const links = topo.links.map((l) => ({
    id: l.id ?? `${l.from}>${l.to}`, from: l.from, to: l.to, kind: l.kind ?? 'dep', label: l.label, live: Boolean(l.live),
  }));
  for (const rule of topo.lanes.links) {
    const re = new RegExp(rule.match);
    for (const ln of lanes) {
      if (re.test(ln.label) || (ln.branch && re.test(ln.branch))) {
        links.push({ id: `${ln.id}>${rule.to}`, from: ln.id, to: rule.to, kind: rule.kind ?? 'dep', label: rule.label, live: ln.status === 'working' });
      }
    }
  }
  for (const n of lanes) { delete n.branch; }

  return {
    title: topo.title ?? hostname,
    nodes,
    links,
    error: topologyError ?? undefined,
    generatedAt: now,
  };
}

// ------------------------------------------------------------------ events

const STATUS_WORDS = {
  ok: 'is up', working: 'is working', warn: 'is degraded', attention: 'needs you', crit: 'is failing',
  down: 'is down', idle: 'is idle', unknown: 'stopped reporting',
};

/**
 * Status changes between two models, as events. A lane going from working to
 * working is not news; a room going down is.
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
  const out = [];
  for (const n of next.nodes) {
    if (n.derived || sameAsParent(n)) continue;
    const was = before.get(n.id);
    if (was === undefined) {
      if (n.kind === 'lane') out.push({ at: now, node: n.id, kind: n.status, text: `${n.label} started` });
      continue;
    }
    if (was === n.status) continue;
    if (was === 'unknown' && n.status === 'ok') continue; // first data in, not a recovery
    const text = `${n.label} ${STATUS_WORDS[n.status] ?? n.status}${n.why ? ` · ${n.why}` : ''}`;
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
    if (r) nodesByRef.set(`${r.source}/${r.guest ?? ''}`, n.id);
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

/** Rebuild from the latest snapshot. Returns a message worth sending, or null. */
export function tick(snapshot, now = Date.now()) {
  const t = loadTopology();
  const feeds = readFeeds();
  const next = build({ topology: t.value, feeds, probes: probeResults, snapshot, now, topologyError: t.error });
  const fresh = [...diffEvents(current, next, now), ...feedEvents(feeds, t.value, feedSeen)];
  if (fresh.length) events = [...events, ...fresh].slice(-80);
  current = next;
  // Statuses, labels and structure go out at once; metrics that only jitter
  // go out at most every 5 s.
  const shape = JSON.stringify(next.nodes.map((n) => [n.id, n.status, n.why, n.sub, n.label, n.parent]).concat(next.links.map((l) => [l.id, l.live])));
  const changed = shape !== lastShape;
  if (!changed && !fresh.length && now - lastSentAt < 5000) return null;
  lastShape = shape;
  lastSentAt = now;
  return { type: 'map', map: model() };
}

export function model() {
  return current ? { ...current, events } : { title: config.hostname, nodes: [], links: [], events: [], generatedAt: Date.now() };
}

export function start() {
  return startProbes();
}
