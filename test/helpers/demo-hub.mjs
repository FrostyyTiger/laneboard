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
import fs from 'node:fs';
import path from 'node:path';
import { parseLines, foldRun } from '../../server/runs/protocol.mjs';
import { summarize } from '../../server/runs/summary.mjs';
import { withSessions } from '../../server/runs/bind.mjs';

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

/** Move a time by `d` ms, keeping its form (epoch ms, epoch s, ISO); anything else as is. */
function shiftTime(v, d) {
  if (typeof v === 'number') return v < 1e11 ? Math.round(v + d / 1000) : v + d;
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(Date.parse(v) + d).toISOString();
  return v;
}

/** The recorded run's lines with every time moved so its last event is `now - DEMO_RUN_AGO_MS`. */
export function demoRunText(now = Date.now(), text = fs.readFileSync(DEMO_RUN_FILE, 'utf8')) {
  const objs = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const last = Math.max(...objs.map((o) => (typeof o.ts === 'number' ? o.ts : 0)));
  const d = now - DEMO_RUN_AGO_MS - last;
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

/**
 * What the runs routes would answer for the demo's one run, or null when the
 * request is not theirs (the forwarder then passes it to the hub). GET only:
 * `/api/runs` -> {runs: [summary]}, `/api/runs/<id>` -> {run} or 404.
 */
export function demoRunsAnswer(method, url, now = Date.now()) {
  if (method !== 'GET' || typeof url !== 'string') return null;
  const p = url.split('?')[0];
  if (p === RUNS_PATH) return { status: 200, body: { runs: [summarize(demoRun(now))] } };
  if (!p.startsWith(`${RUNS_PATH}/`)) return null;
  let id;
  try { id = decodeURIComponent(p.slice(RUNS_PATH.length + 1)); } catch { return { status: 404, body: { error: 'unknown run' } }; }
  const run = demoRun(now);
  if (id !== run.run) return { status: 404, body: { error: 'unknown run' } };
  return { status: 200, body: { run: withSessions(run, null) } };
}
