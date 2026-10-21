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
  return { ...body, runs: runsInWindow(demoRuns(now), { since, now }) };
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
 * The attention queue builder `id` would send for `sessions` (danger, waiting,
 * stuck first). Like a real builder's snapshot (`decorateSessions`) it first
 * rescores every session in place: the fake's sessions inherit the fixture
 * template's `attentionScore: 100`, which would put every lane in the queue.
 */
export function demoAttention(id, sessions, now = Date.now()) {
  for (const s of sessions) s.attentionScore = attentionScore(s, now);
  return attentionList(sessions, (name) => fkey(id, name), now).map((a) => ({ ...a, builder: id }));
}
