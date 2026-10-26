// The hub config the morning preview (test/tools/demo-fleet.mjs) boots, kept
// here so a test can boot the same thing (runs plan T3). `hostname` is set to
// a demo name: the header label and the Map's core node (`buildFleet` names
// the core `topo.title ?? config.hostname`) would otherwise show the machine
// the demo runs on.
//
// `writeDemoMap(dir)` gives the demo something for the Map's Drift and Reach
// overlays (runs plan night 3 T1): an invented topology, one hypervisor feed
// and a Tailscale policy, written into the demo's own temp dir.
//
// `demoRunsAnswer(method, url)` gives the demo a run to show (night 3 T2): a
// hub has no `/api/runs` (server/routes/runs.mjs is builder only, the hub
// routes are fenced), so the demo's forwarder answers `GET /api/runs` and
// `GET /api/runs/<id>` itself from the recorded run
// test/fixtures/runs/demo-run.jsonl, folded by the real `foldRun` and
// summarized by the real `summarize`. Its times are moved so it stopped
// `DEMO_RUN_AGO_MS` before now.
//
// Two more recorded runs keep it company (night 3 T45), so the Map's run
// nodes have each state to draw: `acme-docs` running on `vm-a` (a room of
// the topology), `acme-billing` running on `builder-b` and stuck (the same
// task failed twice). `demoMapWithRuns(map)` adds their nodes, through the
// real `runNodes` (server/map/runs.mjs), to the hub's Map; the forwarder
// does it to every `map` message on /ws (`demoWsText`), since a hub has no
// runs source and the Map reaches the browser over the WebSocket.
//
// `demoAttention(id, sessions)` is the attention queue a real builder sends
// with its snapshot (night 3 T17): the fake builders send none of their own,
// so without it the Board's "Needs you" said 0 next to PERM and QUES cards.
// Built by the real `attentionList` (server/state.mjs), keyed like the fake.
import fs from 'node:fs';
import path from 'node:path';
import { parseLines, foldRun } from '../../server/runs/protocol.mjs';
import { summarize } from '../../server/runs/summary.mjs';
import { bindRuns, withSessions } from '../../server/runs/bind.mjs';
import { runsInWindow } from '../../server/runs/digest.mjs';
import { runNodes } from '../../server/map/runs.mjs';
import { attentionList, attentionScore } from '../../server/state.mjs';
import { fkey } from '../../server/fleet/keys.mjs';

export const DEMO_HOSTNAME = 'demo-host';

/**
 * @param {{builders: {id: string, url: string}[], origins: string[], publicHost: string,
 *   map?: {file: string, feedsDir: string, policyFile: string}}} opts
 */
export function demoHubConfig({ builders, origins, publicHost, map }) {
  return {
    hostname: DEMO_HOSTNAME,
    publicUrl: `https://${publicHost}`,
    fleet: {
      builders,
      allowedOrigins: origins,
      staleMs: 6000,
      downMs: 15_000,
      pingMs: 2000,
    },
    ...(map ? { map: { file: map.file, feedsDir: map.feedsDir, policyFile: map.policyFile } } : {}),
  };
}

// One site `lab` on the hypervisor `hv1`, a room per builder, a CI room and a
// backup room. The feed lists every room but `backup` (declared, not seen:
// drift "missing") and adds `scratch` (seen, not declared: "undeclared").
export const DEMO_TOPOLOGY = {
  nodes: [
    { id: 'lab', kind: 'site', label: 'hv1', feed: 'hv1', sub: 'hypervisor' },
    { id: 'room-a', parent: 'lab', kind: 'room', label: 'vm-a', feed: 'hv1/101', builder: 'builder-a' },
    { id: 'room-b', parent: 'lab', kind: 'room', label: 'vm-b', feed: 'hv1/102', builder: 'builder-b' },
    { id: 'room-c', parent: 'lab', kind: 'room', label: 'vm-c', feed: 'hv1/103', builder: 'builder-c' },
    { id: 'ci', parent: 'lab', kind: 'room', label: 'ci', feed: 'hv1/104', ci: { runner: true, for: '*' } },
    { id: 'backup', parent: 'lab', kind: 'room', label: 'backup', feed: 'hv1/105', sub: 'nightly backups' },
  ],
};

const guest = (vmid, name, tags, ip, over = {}) => ({
  vmid, name, type: 'qemu', status: 'running', cpu: 0.1 + (vmid % 5) * 0.08, memFrac: 0.3 + (vmid % 4) * 0.1,
  uptime: 86_400, tags, ips: [ip], ...over,
});

/** The `hv1` feed as a feeder would push it, stamped `now`. */
export function demoFeed(now = Date.now()) {
  return {
    source: 'hv1',
    at: now,
    every: 30,
    host: { name: 'hv1', cpu: 0.27, mem: 0.58, disk: 0.44, sub: 'demo hypervisor', tags: ['tag:infra'], ips: ['192.0.2.10'] },
    guests: [
      guest(101, 'vm-a', ['tag:builder'], '192.0.2.11'),
      guest(102, 'vm-b', ['tag:builder'], '192.0.2.12'),
      guest(103, 'vm-c', ['tag:builder'], '192.0.2.13'),
      guest(104, 'ci', ['tag:ci'], '192.0.2.14'),
      guest(106, 'scratch', ['tag:builder'], '192.0.2.16', { sub: 'not in the topology' }),
    ],
  };
}

// HuJSON, as the admin console exports it. Builders reach CI over https, CI
// reaches the builders over ssh, the hypervisor's API is reachable from CI
// only; the admins' rule needs user data the Map does not have (unresolved).
export const DEMO_POLICY = `// An invented policy for the demo tailnet "acme" (docs/map.md "Reach").
{
  "groups": { "group:admins": ["admin@example.invalid"] },
  "tagOwners": {
    "tag:builder": ["group:admins"],
    "tag:ci":      ["group:admins"],
    "tag:infra":   ["group:admins"],
  },
  "hosts": { "hv1-api": "192.0.2.10" },
  "grants": [
    {"src": ["tag:builder"], "dst": ["tag:ci"], "ip": ["tcp:443"]},
    {"src": ["tag:ci"], "dst": ["tag:builder"], "ip": ["tcp:22"]},
    {"src": ["tag:ci"], "dst": ["hv1-api"], "ip": ["tcp:8006"]},
    {"src": ["group:admins"], "dst": ["tag:infra"], "ip": ["tcp:22"]},
  ],
}
`;

/** Write the feed into `feedsDir` (temp name, then rename, as a pusher does). */
export function writeDemoFeed(feedsDir, now = Date.now()) {
  const file = path.join(feedsDir, 'hv1.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(demoFeed(now), null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/** Topology, feed and policy under `dir`; returns the paths for `demoHubConfig({map})`. */
export function writeDemoMap(dir, now = Date.now()) {
  const file = path.join(dir, 'map.json');
  const feedsDir = path.join(dir, 'feeds');
  const policyFile = path.join(dir, 'policy.hujson');
  fs.mkdirSync(feedsDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(DEMO_TOPOLOGY, null, 2));
  fs.writeFileSync(policyFile, DEMO_POLICY);
  writeDemoFeed(feedsDir, now);
  return { file, feedsDir, policyFile };
}

/** server/routes/runs.mjs LIST_PATH (not imported: that module opens the database). */
export const RUNS_PATH = '/api/runs';
export const DEMO_RUN_FILE = path.resolve(import.meta.dirname, '..', 'fixtures', 'runs', 'demo-run.jsonl');
export const DEMO_RUN_AGO_MS = 25 * 60_000;

/**
 * The sessions the demo's board knows by id (runs T22): round 3 of
 * `acme-search` names the first in its `round.start`, so the run page shows
 * one round linked to its session (`search api` on builder-a).
 */
export const DEMO_RUN_SESSIONS = Object.freeze([
  Object.freeze({ sessionId: '5e1c0a7d-3b2f-4c19-9a6e-2d8f40b1c7e3', name: 'search api', cwd: null, firstAt: null, lastAt: null, usd: 1.84 }),
]);

/** Move a time by `d` ms, keeping its form (epoch ms, epoch s, ISO); anything else as is. */
function shiftTime(v, d) {
  if (typeof v === 'number') return v < 1e11 ? Math.round(v + d / 1000) : v + d;
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v) + d).toISOString();
  return v;
}

/** The recorded run's lines with every time moved so its last event is `now - agoMs`. */
export function demoRunText(now = Date.now(), text = fs.readFileSync(DEMO_RUN_FILE, 'utf8'), agoMs = DEMO_RUN_AGO_MS) {
  const objs = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const last = Math.max(...objs.map((o) => (typeof o.ts === 'number' ? o.ts : 0)));
  const d = now - agoMs - last;
  return objs.map((o) => {
    const x = { ...o };
    for (const k of ['ts', 'deadline', 'fiveHourResetsAt']) if (x[k] !== undefined) x[k] = shiftTime(x[k], d);
    return JSON.stringify(x);
  }).join('\n') + '\n';
}

/** The recorded run, folded as the collector would (`foldRun`). */
export function demoRun(now = Date.now()) {
  const { events, skipped } = parseLines(demoRunText(now));
  return foldRun(events, { skipped });
}

const fixture = (name) => path.resolve(import.meta.dirname, '..', 'fixtures', 'runs', name);

/** Every recorded run of the demo: its file and how long before now its last event is. */
export const DEMO_RUNS = Object.freeze([
  { file: DEMO_RUN_FILE, agoMs: DEMO_RUN_AGO_MS },
  { file: fixture('demo-run-docs.jsonl'), agoMs: 3 * 60_000 },
  { file: fixture('demo-run-billing.jsonl'), agoMs: 6 * 60_000 },
]);

/** Every demo run folded, `acme-search` (the stopped one) first. */
export function demoRuns(now = Date.now()) {
  return DEMO_RUNS.map(({ file, agoMs }) => {
    const { events, skipped } = parseLines(demoRunText(now, fs.readFileSync(file, 'utf8'), agoMs));
    return foldRun(events, { skipped });
  });
}

/**
 * What the runs routes would answer for the demo's one run, or null when the
 * request is not theirs (the forwarder then passes it to the hub). GET only:
 * `/api/runs` -> {runs: [summary]}, `/api/runs/<id>` -> {run} or 404.
 */
export function demoRunsAnswer(method, url, now = Date.now()) {
  if (method !== 'GET' || typeof url !== 'string') return null;
  const p = url.split('?')[0];
  if (p === RUNS_PATH) return { status: 200, body: { runs: demoRuns(now).map((r) => summarize(r, { now })) } };
  if (!p.startsWith(`${RUNS_PATH}/`)) return null;
  let id;
  try { id = decodeURIComponent(p.slice(RUNS_PATH.length + 1)); } catch { return { status: 404, body: { error: 'unknown run' } }; }
  const run = demoRuns(now).find((r) => r.run === id);
  if (!run) return { status: 404, body: { error: 'unknown run' } };
  return { status: 200, body: { run: withSessions(run, bindRuns([{ run, dirs: [] }], DEMO_RUN_SESSIONS, now)) } };
}

/** The hub's fleet Morning path (server/hub/routes, fenced; its merge drops `runs`). */
export const FLEET_MORNING_PATH = '/api/fleet/morning';

/**
 * The hub's /api/fleet/morning answer with the demo run's digest added as
 * `runs` (night 3 T7): the real `runsInWindow` over the window the hub
 * answered for. A body that is not an object, or already has `runs`, is kept.
 */
export function demoMorningWithRuns(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.runs !== undefined) return body;
  const since = typeof body.since === 'number' && Number.isFinite(body.since) ? body.since : now - 12 * 3600_000;
  if (!Array.isArray(body.builders)) return { ...body, runs: runsInWindow(demoRuns(now), { since, now }) };
  const builders = demoMovedLanes(body.builders, now);
  const answered = new Set(builders.filter((b) => b && !b.error).map((b) => b.id));
  const missing = Array.isArray(body.missing) ? body.missing.filter((id) => !answered.has(id)) : body.missing;
  return { ...body, builders, missing, runs: runsInWindow(demoRuns(now), { since, now }) };
}

/**
 * The demo builders serve no /api/morning (the hub merges `not found` for
 * each) and their sessions have no git lanes, so no builder block ever drew:
 * the first builder with no moved lane answers here with two (runs n5 T25b),
 * one with a done marker (Finished) and one with a session still working
 * (Still running), so the Morning shots show both blocks.
 */
function demoMovedLanes(builders, now) {
  const i = builders.findIndex((b) => b && typeof b === 'object' && Array.isArray(b.finished) && !b.finished.length);
  if (i < 0) return builders;
  const lane = (name, hue, extra) => ({
    lane: name, hue, branch: `lane/${name}`, merged: false, isMain: false, idle: false, progress: { n: 2, m: 3 },
    lastCommitAt: now - 40 * 60_000, newCommit: true, doneMarkers: [], pr: null, packages: ['web'], ...extra,
  });
  const finished = [
    lane('search-index', 200, {
      doneMarkers: [{ id: 1, ts: now - 50 * 60_000, text: 'PACKAGE-DONE: search index rebuilt', session: 'search-1' }],
      sessions: [{ name: 'search-1', state: 'idle', since: now - 45 * 60_000 }],
    }),
    lane('billing-export', 30, { sessions: [{ name: 'billing-1', state: 'working', since: now - 5 * 60_000 }] }),
  ];
  return builders.map((b, j) => (j === i ? { ...b, error: undefined, stale: false, finished } : b));
}

/**
 * The hub's Map with a node per demo run added by the real `runNodes`, hung
 * on the node its `host` names, else on the core. A map that is not an
 * object with `nodes`, or already has run nodes, is kept.
 */
export function demoMapWithRuns(map, now = Date.now()) {
  if (!map || typeof map !== 'object' || !Array.isArray(map.nodes)) return map;
  if (map.nodes.some((n) => n?.kind === 'run')) return map;
  const coreId = map.nodes.find((n) => n?.kind === 'core')?.id ?? '__core';
  return { ...map, nodes: [...map.nodes, ...runNodes(demoRuns(now), { nodes: map.nodes, coreId, now })] };
}

/**
 * One text frame the hub sends on /ws, as the forwarder passes it on: a
 * `map` message gets the run nodes, anything else (or text that is not
 * JSON) goes through unchanged.
 */
export function demoWsText(text, now = Date.now()) {
  if (typeof text !== 'string' || !text.includes('"map"')) return text;
  let msg;
  try { msg = JSON.parse(text); } catch { return text; }
  if (!msg || msg.type !== 'map' || !msg.map) return text;
  return JSON.stringify({ ...msg, map: demoMapWithRuns(msg.map, now) });
}

/**
 * `--quiet-after <s>` (Wall plan night 3 T5): from `quietAfterMs` after the
 * demo started the relay drops every `map` message, so the page sees a hub
 * that is up (the socket stays open, /api/map answers) whose map frames have
 * stopped: a stale feed, to film. True when `text` is to be dropped `elapsedMs`
 * after the start; never without a quiet time. Other messages always pass.
 */
export function demoQuiet(text, elapsedMs, quietAfterMs) {
  if (quietAfterMs == null || !Number.isFinite(quietAfterMs) || elapsedMs < quietAfterMs) return false;
  if (typeof text !== 'string' || !text.includes('"map"')) return false;
  try { return JSON.parse(text)?.type === 'map'; } catch { return false; }
}

/**
 * The attention queue builder `id` would send for `sessions` (danger, waiting,
 * stuck first). Like a real builder's snapshot (`decorateSessions`) it first
 * rescores every session in place: the fake's sessions inherit the fixture
 * template's `attentionScore: 100`, which would put every lane in the queue.
 */
export function demoAttention(id, sessions, now = Date.now()) {
  for (const s of sessions) s.attentionScore = attentionScore(s, now);
  return attentionList(sessions, (name) => fkey(id, name), now).map((a) => ({ ...a, builder: id }));
}

// ------------------------------------------------------------ the large fleet
//
// `--size large` (Wall plan T1, docs/plans/wall/README.md §7.1): the Wall is
// judged on a fleet the size of a real one, 100-150 nodes over five sites.
// One table per site drives both the topology and that site's feed, so the
// two always agree: `hv1` (the small demo's rooms, the builders and CI, plus
// the house services), `hv2` (storage, media, a GPU box, a small cluster),
// `cloud` (edges, the production API, its database), `remote` (tailnet peers
// at an office, one laptop asleep) and `home` (lights and a 3D printer, the
// nodes that carry Wall's `glow` and `ring` extras, T2). Guest names are unique
// across sources: the Map merges same-named machines of different feeds.
// Calm on its own; the trouble that comes and goes is the live part (T3).

const room = (id, vmid, sub, services = [], over = {}) => ({ id, vmid, sub, services, ...over });
const svc = (name, sub, status = 'ok') => ({ name, sub, status });

/** Every site of the large demo: its host as the feed says it, its rooms with their services. */
export const DEMO_SITES_LARGE = Object.freeze([
  {
    id: 'lab', source: 'hv1', label: 'hv1', sub: 'hypervisor', ip: '192.0.2.10',
    host: { cpu: 0.34, mem: 0.62, disk: 0.48, sub: 'demo hypervisor · 128 GB', detail: { Hardware: '2× 16-core · 128 GB', Where: 'rack 1' } },
    rooms: [
      room('room-a', 101, undefined, [], { label: 'vm-a', builder: 'builder-a', tags: ['tag:builder'] }),
      room('room-b', 102, undefined, [], { label: 'vm-b', builder: 'builder-b', tags: ['tag:builder'] }),
      room('room-c', 103, undefined, [], { label: 'vm-c', builder: 'builder-c', tags: ['tag:builder'] }),
      room('ci', 104, 'CI runners', [svc('runner-1', 'job · 4m', 'working'), svc('runner-2', 'waiting for a job', 'idle'), svc('runner-3', 'waiting for a job', 'idle')], { tags: ['tag:ci'], ci: { runner: true, for: '*' } }),
      room('backup', 105, 'nightly backups', [], { unlisted: true }),
      room('proxy', 110, 'reverse proxy', [svc('ingress', 'tls · 42 routes'), svc('certs', 'renews in 41d')]),
      room('db', 111, 'databases', [svc('postgres', '14 dbs'), svc('redis', 'cache'), svc('db-dumps', 'hourly')]),
      room('monitor', 112, 'metrics and logs', [svc('metrics', '1.2k series'), svc('logs', '9 GB/day'), svc('alerting', '12 rules')]),
      room('dns', 113, 'resolver', [svc('resolver', 'cache 94%'), svc('dhcp', '61 leases')]),
      room('git-mirror', 114, 'git mirror', [svc('mirror', '38 repos')]),
      room('registry', 115, 'images', [svc('images', '212 tags')]),
      room('template', 199, 'base image', [], { expect: 'stopped', stopped: true }),
    ],
  },
  {
    id: 'hv2', source: 'hv2', label: 'hv2', sub: 'hypervisor', ip: '192.0.2.20',
    host: { cpu: 0.41, mem: 0.71, disk: 0.66, gpu: 0.38, sub: 'demo hypervisor · GPU', detail: { Hardware: '24-core · 192 GB · 1 GPU', Where: 'rack 2' } },
    rooms: [
      room('storage', 201, 'file server', [svc('nfs', '18 TB'), svc('smb', '4 shares'), svc('scrub', 'weekly', 'idle')]),
      room('media', 202, 'media', [svc('library', '3.1k items'), svc('transcode', 'idle', 'idle')]),
      room('gpu-box', 203, 'inference', [svc('inference', '2 models', 'working'), svc('queue', '0 waiting', 'idle'), svc('trainer', 'idle', 'idle')]),
      room('k8s-1', 204, 'cluster node', [svc('ingress-1', 'nginx'), svc('apps-1', '23 pods')]),
      room('k8s-2', 205, 'cluster node', [svc('apps-2', '19 pods')]),
      room('k8s-3', 206, 'cluster node', [svc('apps-3', '21 pods')]),
      room('secrets', 207, 'secrets', [svc('vault', 'unsealed'), svc('audit-log', 'shipping')]),
      room('build-cache', 208, 'build cache', [svc('cache', '61% hit')]),
      room('sandbox', 209, 'scratch VM', [], { expect: 'stopped', stopped: true }),
    ],
  },
  {
    id: 'cloud', source: 'cloud', label: 'cloud', sub: 'provider · eu-1', ip: '198.51.100.10',
    host: { cpu: 0.22, mem: 0.47, sub: 'provider · eu-1', detail: { Where: 'eu-1' } },
    rooms: [
      room('edge-1', 'edge-1', 'edge', [svc('cdn-1', '98% cached'), svc('waf-1', '3 rules hit')], { type: 'cloud' }),
      room('edge-2', 'edge-2', 'edge', [svc('cdn-2', '97% cached')], { type: 'cloud' }),
      room('api-prod', 'api-prod', 'production', [svc('api', '420 req/s'), svc('worker', '3 jobs', 'working'), svc('scheduler', '14 cron')], { type: 'cloud' }),
      room('api-staging', 'api-staging', 'staging', [svc('api-stg', '4 req/s')], { type: 'cloud' }),
      room('db-prod', 'db-prod', 'database', [svc('primary', 'lag 0s'), svc('replica', 'lag 1s')], { type: 'cloud' }),
      room('object-store', 'object-store', 'buckets', [svc('buckets', '7 buckets')], { type: 'cloud' }),
      room('mail', 'mail', 'mail', [svc('smtp', 'queue 0'), svc('imap', '12 users')], { type: 'cloud' }),
      room('status-page', 'status-page', 'status page', [], { type: 'cloud' }),
    ],
  },
  {
    id: 'remote', source: 'remote', label: 'remote', sub: 'office · tailnet', ip: '203.0.113.10',
    host: { cpu: 0.12, mem: 0.33, sub: 'office gateway', detail: { Where: 'office' } },
    rooms: [
      room('office-nas', 'office-nas', 'office storage', [svc('restic', 'last 2h ago'), svc('verify', 'weekly', 'idle')], { type: 'tailnet' }),
      room('office-printer', 'office-printer', 'printer', [], { type: 'tailnet' }),
      room('laptop-1', 'laptop-1', 'laptop', [], { type: 'tailnet' }),
      room('laptop-2', 'laptop-2', 'laptop', [], { type: 'tailnet', offline: true }),
      room('phone-1', 'phone-1', 'phone', [], { type: 'tailnet' }),
      room('vpn-gw', 'vpn-gw', 'exit node', [], { type: 'tailnet' }),
    ],
  },
  {
    id: 'home', source: 'home', label: 'home', sub: 'house', ip: '203.0.113.20',
    host: { cpu: 0.09, mem: 0.41, sub: 'home hub', detail: { Where: 'hallway closet' } },
    rooms: [
      room('automation', 'automation', 'home automation', [svc('zigbee', '23 devices'), svc('rules', '31 rules')], { type: 'device' }),
      room('hall-light', 'hall-light', 'light', [], { type: 'device', glow: { rgb: [255, 196, 137], level: 0.35 } }),
      room('desk-light', 'desk-light', 'light', [], { type: 'device', glow: { rgb: [255, 214, 170], level: 0.9 } }),
      room('living-light', 'living-light', 'light', [], { type: 'device', glow: { rgb: [140, 120, 255], level: 0.6 } }),
      room('kitchen-light', 'kitchen-light', 'light', [], { type: 'device', glow: { rgb: [235, 242, 255], level: 1 } }),
      room('porch-light', 'porch-light', 'light', [], { type: 'device' }),
      room('printer-3d', 'printer-3d', '3D printer', [svc('print-job', 'printing', 'working')], { type: 'device', printing: true }),
      room('thermostat', 'thermostat', 'heating', [], { type: 'device' }),
      room('front-door', 'front-door', 'door sensor', [], { type: 'device' }),
    ],
  },
]);

// Links that say how the sites depend on each other: a few long ones between
// sites, so a layout has something to bundle.
const LARGE_LINKS = [
  { from: 'ci', to: 'registry', kind: 'flow', label: 'pushes images' },
  { from: 'ci', to: 'git-mirror', kind: 'dep', label: 'clones' },
  { from: 'registry', to: 'k8s-1', kind: 'flow', label: 'deploys' },
  { from: 'ci', to: 'api-staging', kind: 'flow', label: 'deploys' },
  { from: 'api-staging', to: 'api-prod', kind: 'flow', label: 'promotes' },
  { from: 'api-prod', to: 'db-prod', kind: 'dep', label: 'reads and writes' },
  { from: 'edge-1', to: 'api-prod', kind: 'dep' },
  { from: 'edge-2', to: 'api-prod', kind: 'dep' },
  { from: 'db', to: 'storage', kind: 'flow', label: 'dumps' },
  { from: 'storage', to: 'office-nas', kind: 'flow', label: 'offsite copy' },
  { from: 'monitor', to: 'status-page', kind: 'flow', label: 'publishes' },
  { from: 'gpu-box', to: 'build-cache', kind: 'share', label: 'same NVMe' },
  { from: 'automation', to: 'monitor', kind: 'flow', label: 'sensor data' },
  { from: 'proxy', to: 'k8s-1', kind: 'dep' },
];

const svcId = (r, s) => `${r.id}-${s.name}`;
const refOf = (site, r) => `${site.source}/${r.vmid}`;

/** The large demo's topology: five sites, their rooms and services, and links. */
export const DEMO_TOPOLOGY_LARGE = Object.freeze({
  nodes: DEMO_SITES_LARGE.flatMap((site) => [
    { id: site.id, kind: 'site', label: site.label, feed: site.source, sub: site.sub },
    ...site.rooms.flatMap((r) => [
      {
        id: r.id, parent: site.id, kind: 'room', label: r.label ?? r.id, feed: refOf(site, r),
        ...(r.sub ? { sub: r.sub } : {}), ...(r.builder ? { builder: r.builder } : {}), ...(r.ci ? { ci: r.ci } : {}),
        ...(r.expect ? { expect: r.expect } : {}),
      },
      ...r.services.map((s) => ({ id: svcId(r, s), parent: r.id, kind: 'service', label: s.name, feed: `${refOf(site, r)}/${s.name}` })),
    ]),
  ]),
  links: LARGE_LINKS,
});

const LARGE_DAY = 86_400;
// The printer's job runs ten minutes and starts over, so its ring (T2) moves
// on every tick of the demo, whatever the tick.
export const LARGE_PRINT_MS = 10 * 60_000;
const printProgress = (now) => Math.round(((now % LARGE_PRINT_MS) / LARGE_PRINT_MS) * 1000) / 1000;

/** One site's feed as its feeder would push it, stamped `now`. */
function siteFeed(site, now) {
  const ip = site.ip.split('.');
  const guests = site.rooms.filter((r) => !r.unlisted).map((r, i) => {
    const n = typeof r.vmid === 'number' ? r.vmid : 7 * (i + 1);
    const g = {
      vmid: typeof r.vmid === 'number' ? r.vmid : undefined,
      name: r.label ?? r.id,
      type: r.type ?? 'qemu',
      status: r.stopped ? 'stopped' : r.offline ? 'offline' : 'running',
      cpu: Math.round((0.04 + (n % 7) * 0.07) * 100) / 100,
      memFrac: Math.round((0.22 + (n % 5) * 0.11) * 100) / 100,
      uptime: LARGE_DAY * (1 + (n % 23)),
      tags: r.tags ?? [],
      ips: [`${ip.slice(0, 3).join('.')}.${Number(ip[3]) + i + 1}`],
    };
    if (r.offline) { g.lastSeen = now - 3 * 3600_000; delete g.cpu; delete g.memFrac; }
    if (r.services.length) g.services = r.services.map((s) => ({ ...s }));
    // Feed extras the Wall paints (T2): a light's colour, a print's progress.
    if (r.glow) g.glow = { rgb: [...r.glow.rgb], level: r.glow.level };
    if (r.printing) {
      const progress = printProgress(now);
      g.ring = { progress };
      for (const s of g.services ?? []) s.sub = `printing · ${Math.round(progress * 100)}%`;
    }
    return g;
  });
  if (site.source === 'hv1') {
    guests.push({ vmid: 106, name: 'scratch', type: 'qemu', status: 'running', cpu: 0.18, memFrac: 0.3, uptime: 3600, tags: ['tag:builder'], ips: ['192.0.2.16'], sub: 'not in the topology' });
  }
  return {
    source: site.source,
    at: now,
    every: 30,
    host: { name: site.label, tags: site.source === 'hv1' ? ['tag:infra'] : [], ips: [site.ip], ...site.host },
    guests,
  };
}

/** The `hv1` feed of the large demo (the small demo's rooms and more), stamped `now`. */
export const demoFeedHv1 = (now = Date.now()) => siteFeed(DEMO_SITES_LARGE[0], now);
/** The `hv2` feed: storage, media, a GPU box, a three-node cluster. */
export const demoFeedHv2 = (now = Date.now()) => siteFeed(DEMO_SITES_LARGE[1], now);
/** The `cloud` feed: edges, the production API and its database. */
export const demoFeedCloud = (now = Date.now()) => siteFeed(DEMO_SITES_LARGE[2], now);
/** The `remote` feed: tailnet peers at an office, one laptop asleep. */
export const demoFeedRemote = (now = Date.now()) => siteFeed(DEMO_SITES_LARGE[3], now);
/** The `home` feed: the automation hub, lights, a 3D printer, a door sensor. */
export const demoFeedHome = (now = Date.now()) => siteFeed(DEMO_SITES_LARGE[4], now);

/** Every feed of the large demo, one per source. */
export function demoFeedsLarge(now = Date.now()) {
  return [demoFeedHv1(now), demoFeedHv2(now), demoFeedCloud(now), demoFeedRemote(now), demoFeedHome(now)];
}

// The live part of the large demo (Wall plan T3): trouble that comes and goes
// and things that happen, counted in demo ticks (4 s by default) so a slower
// `--tick` slows all of it. Over one period of 90 ticks (six minutes):
//   crit       hv2 `storage`, ticks 0-39     its pool fills up
//   attention  remote `office-printer`, 27-66   a paper jam a person must clear
//   warn       cloud `api-prod`, 54-84       slow answers
// so trouble overlaps, every one clears and returns, and ticks 85-89 are calm.
// The front door opens three times a period (tick 5, 35, 65), and every third
// tick something travels one of the topology's flow links, round robin: a feed
// event with `link`, which the Map draws as a comet.
export const LARGE_PERIOD_TICKS = 90;

/** Each trouble of the period: where (feed source, guest name), its alert, its window in ticks. */
export const LARGE_TROUBLE = Object.freeze([
  { source: 'hv2', guest: 'storage', level: 'crit', text: 'pool 97% full', from: 0, to: 40 },
  { source: 'remote', guest: 'office-printer', level: 'attention', text: 'paper jam, needs a person', from: 27, to: 67 },
  { source: 'cloud', guest: 'api-prod', level: 'warn', text: 'p95 latency 1.8 s', from: 54, to: 85 },
]);

const DOOR_TICKS = [5, 35, 65];
const LARGE_FLOWS = LARGE_LINKS.filter((l) => l.kind === 'flow');
// Which feed and guest a flow event belongs to: its link's `from` room, named
// as its topology ref names it (the hub finds the node by `source/guest`).
const roomSource = new Map(DEMO_SITES_LARGE.flatMap((site) => site.rooms.map((r) => [r.id, { source: site.source, guest: String(r.vmid) }])));

/**
 * What the large demo does on tick `n`: the alerts standing now and the
 * events that happen on this tick (`{source, guest, kind, text, link?}`).
 */
export function demoLargeCycle(n) {
  const t = ((n % LARGE_PERIOD_TICKS) + LARGE_PERIOD_TICKS) % LARGE_PERIOD_TICKS;
  const alerts = LARGE_TROUBLE.filter((x) => t >= x.from && t < x.to)
    .map(({ source, guest, level, text }) => ({ source, guest, level, text }));
  const events = [];
  if (DOOR_TICKS.includes(t)) events.push({ source: 'home', guest: 'front-door', kind: 'ok', text: 'front door opened' });
  if (n % 3 === 0) {
    const l = LARGE_FLOWS[(n / 3) % LARGE_FLOWS.length];
    events.push({ ...roomSource.get(l.from), kind: 'ok', text: `${l.from} ${l.label} → ${l.to}`, link: `${l.from}>${l.to}` });
  }
  return { alerts, events };
}

/**
 * The large demo's feeds on tick `n` at `now`: the static feeds with the
 * cycle's alerts on their guests and the last few events (`keep` of them),
 * each stamped once when it happened so the hub reads it once.
 */
export function createLargeLive({ keep = 8 } = {}) {
  let recent = [];
  return function feedsAt(n, now = Date.now()) {
    const { alerts, events } = demoLargeCycle(n);
    recent = [...recent, ...events.map((e, i) => ({ ...e, at: now + i }))].slice(-keep);
    return demoFeedsLarge(now).map((feed) => {
      for (const g of feed.guests) {
        const mine = alerts.filter((a) => a.source === feed.source && a.guest === g.name);
        if (mine.length) g.alerts = mine.map(({ level, text }) => ({ level, text }));
      }
      const own = recent.filter((e) => e.source === feed.source);
      if (own.length) feed.events = own.map(({ at, kind, text, guest, link }) => ({ at, kind, text, guest, ...(link ? { link } : {}) }));
      return feed;
    });
  };
}

/**
 * Write the feeds of a demo size into `feedsDir`, each to a temp name then
 * renamed. `feeds` replaces the large demo's static ones (`createLargeLive`).
 */
export function writeDemoFeeds(feedsDir, now = Date.now(), size = 'small', feeds = null) {
  if (size !== 'large') { writeDemoFeed(feedsDir, now); return; }
  for (const feed of feeds ?? demoFeedsLarge(now)) {
    const file = path.join(feedsDir, `${feed.source}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(feed, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }
}

/** `writeDemoMap` for the large demo: its topology, its five feeds, the same policy. */
export function writeDemoMapLarge(dir, now = Date.now()) {
  const file = path.join(dir, 'map.json');
  const feedsDir = path.join(dir, 'feeds');
  const policyFile = path.join(dir, 'policy.hujson');
  fs.mkdirSync(feedsDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(DEMO_TOPOLOGY_LARGE, null, 2));
  fs.writeFileSync(policyFile, DEMO_POLICY);
  writeDemoFeeds(feedsDir, now, 'large');
  return { file, feedsDir, policyFile };
}
