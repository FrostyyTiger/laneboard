#!/usr/bin/env node
// The morning preview (fleet plan §11 X5): a real hub (`node server/index.mjs`
// in mode "hub", booted by test/helpers/boot.mjs) in front of three in-process
// fake builders (test/helpers/fake-builder.mjs) carrying generic demo data,
// plus a small loopback forwarder that plays `tailscale serve`.
//
//   node test/tools/demo-fleet.mjs [--port 7795] [--builders 3] [--tick 4000] [--design <name>]
//
// Then open http://127.0.0.1:<port>/ (from another machine:
// `ssh -L <port>:127.0.0.1:<port> <host>`). Ctrl-C stops everything.
// `--design refined` lays docs/plans/runs/design/refined.css over the app's
// tokens: the forwarder appends it to /css/tokens.css (runs plan T10).
//
// What it shows:
//   builder-a  lanes in working / waiting (permission + question) / review-ready
//              states, an open approval, a budget warning
//   builder-b  a stuck session (tool loop), a danger finding, a lane on a
//              branch whose CI is red on main, a disk health warning
//   builder-c  a quiet builder that the script takes down and brings back
//              (stale, then down, then up again)
//   repo `acme` with packages web/api/docs, a red `api-test` job on main and
//   branches joined to the lanes above, so Packages, Map, Inbox and the
//   annunciator all have something to show. Session states cycle every tick.
//   the Map's infrastructure (test/helpers/demo-hub.mjs `writeDemoMap`): a
//              topology with a room per builder on hypervisor `hv1`, the
//              `hv1` feed (re-stamped every tick so it never goes stale) and
//              a Tailscale policy, so Drift (`backup` declared but not seen,
//              `scratch` seen but not declared) and Reach have something to draw
//   a run      the recorded run test/fixtures/runs/demo-run.jsonl, answered by
//              the forwarder at GET /api/runs and /api/runs/<id> (a hub has no
//              runs route; test/helpers/demo-hub.mjs `demoRunsAnswer`), and added
//              as `runs` to the hub's /api/fleet/morning (`demoMorningWithRuns`)
//
// Isolation (RULES 3): the hub runs with its own temp HOME, TMUX_TMPDIR,
// XDG_*_HOME, LANEBOARD_STATE_DIR, LANEBOARD_AUDIT_FILE, LANEBOARD_CONFIG and
// LANEBOARD_DB=:memory: (boot.mjs does that, and drops TMUX/TMUX_PANE and every
// inherited LANEBOARD_* variable). Its `hostname` is `demo-host`
// (test/helpers/demo-hub.mjs), so neither the header nor the Map's core node
// shows the name of the machine running the demo. The fakes and the forwarder live in this
// process; the only files it writes are the Map's, in its own temp dir, removed
// on stop. Nothing here talks to tmux.
//
// No auth bypass: the forwarder only adds what serve adds on the ingress
// listener (X-Forwarded-For/-Proto/-Host, Host = the public host,
// Tailscale-User-Login: demo@example.invalid), and the browser's own origin is
// listed in the hub's ordinary `fleet.allowedOrigins`. It binds 127.0.0.1 only
// and refuses ports below 7790 (7777 is the live board). The hub signs every
// relayed action with a throwaway key that the fakes pin with
// read/control/term scopes; actions land in the fake builders' logs.
import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { boot } from '../helpers/boot.mjs';
import { fakeBuilder } from '../helpers/fake-builder.mjs';
import { demoHubConfig, DEMO_HOSTNAME, writeDemoMap, writeDemoFeed, demoRunsAnswer, demoMorningWithRuns, FLEET_MORNING_PATH } from '../helpers/demo-hub.mjs';
import { generateHubKey, publicKeyString } from '../../server/fleet/keys-ed25519.mjs';

// `node --test` (npm test) runs every .mjs under test/, this file included.
// It is a long-running tool, not a test: under the runner it does nothing.
if (process.env.NODE_TEST_CONTEXT) process.exit(0);

const PUBLIC_HOST = 'hub.example.invalid';
const DEMO_USER = 'demo@example.invalid';
const MIN_PORT = 7790;
const FORBIDDEN_PORTS = new Set([7777, 7778]);

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.DEMO_PORT ?? '7795' },
    builders: { type: 'string', default: '3' },
    tick: { type: 'string', default: '4000' },
    design: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (args.help) {
  process.stdout.write('usage: node test/tools/demo-fleet.mjs [--port 7795] [--builders 2|3] [--tick ms] [--design <name>]\n');
  process.exit(0);
}
const PORT = Number(args.port);
if (!Number.isInteger(PORT) || PORT < MIN_PORT || PORT > 65535 || FORBIDDEN_PORTS.has(PORT)) {
  process.stderr.write(`demo-fleet: --port must be an integer >= ${MIN_PORT} and not 7777/7778\n`);
  process.exit(2);
}
const N_BUILDERS = Math.max(2, Math.min(3, Number(args.builders) || 3));
const TICK_MS = Math.max(500, Number(args.tick) || 4000);

// A design direction (docs/plans/runs/design/<name>.css), read once at start.
const DESIGN_DIR = path.resolve(import.meta.dirname, '..', '..', 'docs', 'plans', 'runs', 'design');
let DESIGN = null;
if (args.design != null) {
  const have = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4));
  if (!have.includes(args.design)) {
    process.stderr.write(`demo-fleet: --design must be one of ${have.join(', ')}\n`);
    process.exit(2);
  }
  DESIGN = { name: args.design, css: fs.readFileSync(path.join(DESIGN_DIR, `${args.design}.css`), 'utf8') };
}

// --- demo data ---------------------------------------------------------------

const T0 = Date.now();
const MIN = 60_000;
const HEAD = 'a1b2c3d4'.repeat(5);
const sha = (c) => c.repeat(40);

/** A session in the fake's fixture shape, with plain generic text. */
function session(name, over = {}) {
  const lines = over.lines ?? [`  working on ${name}`, '', '❯ '];
  const { lines: _l, ...rest } = over;
  return {
    name,
    tmuxTarget: `%${name.length}`,
    paneId: `%${name.length}`,
    paneCmd: 'claude',
    dir: `/work/acme-${over.lane ?? 'main'}`,
    branch: over.lane ?? 'main',
    dirty: 0,
    ahead: 0,
    behind: 0,
    attached: false,
    createdAt: T0 - 90 * MIN,
    activityAt: T0 - MIN,
    stateSince: T0 - 3 * MIN,
    stateSource: 'hook',
    activity: { tool: null, toolInput: null, lastUserPrompt: '', lastAssistant: '', lastAssistantAt: null },
    context: { usedPct: 30 + (name.length * 7) % 50 },
    cost: { usd: Math.round((0.4 + (name.length % 7) * 0.9) * 100) / 100 },
    preview: lines,
    previewLines: lines,
    pinned: false,
    ...rest,
  };
}

const lane = (id, sessions, over = {}) => ({ id, repo: 'acme', root: `/work/acme-${id}`, branch: id, sessions, idle: false, ...over });

function job(name, conclusion = 'success') {
  return { id: name, name, status: 'completed', conclusion, verdict: conclusion === 'success' ? 'ok' : 'fail', partial: false, skippedNames: [] };
}

function repoData(builderId, branches) {
  const at = new Date(T0 - 20 * MIN).toISOString();
  return {
    name: 'acme',
    slug: 'acme/acme',
    mainRef: 'origin/main',
    head: { sha: HEAD, at },
    packages: [
      { name: 'web', paths: ['web/**'], source: 'config', kind: 'npm' },
      { name: 'api', paths: ['api/**'], source: 'config', kind: 'py' },
      { name: 'docs', paths: ['docs/**'], source: 'config', kind: 'md' },
    ],
    workflows: [{
      file: 'ci.yml',
      name: 'CI',
      jobs: [
        { id: 'web-check', name: 'web-check', prOnly: false },
        { id: 'api-test', name: 'api-test', prOnly: false },
        { id: 'docs-lint', name: 'docs-lint', prOnly: false },
      ],
    }],
    jobMap: {
      'ci.yml#web-check': { packages: ['web'], via: 'name', prOnly: false },
      'ci.yml#api-test': { packages: ['api'], via: 'name', prOnly: false },
      'ci.yml#docs-lint': { packages: ['docs'], via: 'name', prOnly: false },
    },
    ci: {
      provider: 'gh',
      auth: true,
      at: new Date(T0 - 5 * MIN).toISOString(),
      rate: { remaining: 4800, low: false },
      runs: [{
        id: 4242,
        attempt: 1,
        workflow: 'CI',
        file: 'ci.yml',
        sha: HEAD,
        event: 'push',
        status: 'completed',
        conclusion: 'failure',
        createdAt: new Date(T0 - 18 * MIN).toISOString(),
        updatedAt: new Date(T0 - 9 * MIN).toISOString(),
        jobs: [job('web-check'), job('api-test', 'failure'), job('docs-lint')],
      }],
    },
    lastTested: {},
    untested: {},
    branches: branches.map(([branch, c, files, over = {}]) => ({
      repo: 'acme',
      branch,
      sha: sha(c),
      local: true,
      pushed: true,
      laneId: branch,
      mergeBase: HEAD,
      ahead: 2,
      behind: 1,
      lastCommitAt: T0 - 30 * MIN,
      files,
      packages: [...new Set(files.map((f) => f.split('/')[0]))],
      size: { files: files.length, ins: 12 * files.length, del: 3 * files.length },
      ...over,
    })),
    conflicts: [],
    deps: [],
    commits: {},
    plans: { counts: {}, files: [] },
  };
}

/**
 * Per builder: its sessions, lanes, extras pushed after connect, and a
 * `cycle(n)` that changes some states every tick.
 */
const DEMO = {
  'builder-a': {
    sessions: [
      session('search api', { lane: 'feat-search', state: 'working', activity: { tool: 'Edit', toolInput: 'api/search.py', lastUserPrompt: 'add paging to the search endpoint', lastAssistant: 'Editing the handler.', lastAssistantAt: T0 - MIN }, lines: ['  Edit api/search.py', '  + def search(q, page=1, per_page=20):', '', '✻ Working… (42s)'] }),
      session('search ui', { lane: 'feat-search', state: 'waiting_permission', awaitingApproval: true, lines: ['  Bash(npm run build)', '', '  Do you want to proceed?', '  ❯ 1. Yes', '    2. No'] }),
      session('login fix', { lane: 'fix-login', state: 'waiting_question', lines: ['  Two ways to fix the redirect loop:', '  1. keep the session cookie', '  2. move the check to the router', '  Which one do you prefer?'] }),
      session('docs refresh', { lane: 'docs-refresh', state: 'idle', lines: ['  Updated docs/setup.md and docs/faq.md.', '  Ready for review.', '', '❯ '] }),
    ],
    lanes: [
      lane('feat-search', ['search api', 'search ui']),
      lane('fix-login', ['login fix']),
      lane('docs-refresh', ['docs refresh'], { idle: true, reviewReady: { ready: true, why: 'tests green, branch pushed' } }),
    ],
    branches: [
      ['feat-search', '1', ['api/search.py', 'web/search.js']],
      ['fix-login', '2', ['web/login.js']],
      ['docs-refresh', '3', ['docs/setup.md', 'docs/faq.md']],
    ],
    approvals: [{
      id: 'appr-0001',
      name: 'search ui',
      session: 'search ui',
      lane: 'feat-search',
      tool: 'Bash',
      summary: 'npm run build',
      status: 'pending',
      createdAt: T0 - 2 * MIN,
      expiresAt: T0 + 60 * MIN,
    }],
    budget: [{ scope: 'lane', lane: 'feat-search', usd: 8.2, limit: 10, pct: 82, level: 'warn' }],
    health: { level: 'ok', alarms: [] },
    cycle(n, s) {
      // search api: working -> idle -> working ...
      s[0].state = n % 3 === 2 ? 'idle' : 'working';
      s[0].stateSince = Date.now();
    },
  },
  'builder-b': {
    sessions: [
      session('ci retry', { lane: 'ci-retry', state: 'working', stuck: { rule: 'tool-loop', reason: 'same tool call 14x in 6m', since: T0 - 6 * MIN, evidence: [{ rule: 'tool-loop', detail: 'Bash(npm test) repeated' }], rules: ['tool-loop'] }, activity: { tool: 'Bash', toolInput: 'npm test', lastUserPrompt: 'make the api tests pass', lastAssistant: 'Running the tests again.', lastAssistantAt: T0 - MIN }, lines: ['  Bash(npm test)', '  ✖ api-test: 3 failing', '  Bash(npm test)', '  ✖ api-test: 3 failing'] }),
      session('deps bump', { lane: 'deps-bump', state: 'working', activity: { tool: 'Read', toolInput: 'package.json', lastUserPrompt: 'bump the minor versions', lastAssistant: '', lastAssistantAt: null } }),
      session('cleanup job', { state: 'waiting_permission', danger: { kind: 'guard', reason: 'delete outside the worktree' }, lines: ['  Bash(rm -rf ../shared-cache)', '', '  Do you want to proceed?'] }),
    ],
    lanes: [
      lane('ci-retry', ['ci retry']),
      lane('deps-bump', ['deps bump']),
    ],
    branches: [
      ['ci-retry', '4', ['api/tests/test_search.py', 'api/search.py']],
      ['deps-bump', '5', ['web/package.json', 'web/package-lock.json']],
    ],
    approvals: [],
    budget: [],
    health: { level: 'warn', alarms: [{ level: 'warn', text: 'disk / 91% used' }] },
    cycle(n, s) {
      // deps bump: working -> waiting_question -> idle ...
      s[1].state = ['working', 'waiting_question', 'idle'][n % 3];
      s[1].stateSince = Date.now();
    },
  },
  'builder-c': {
    sessions: [
      session('release notes', { lane: 'release-notes', state: 'idle', lines: ['  Drafted CHANGELOG entries for 1.4.', '', '❯ '] }),
      session('bench run', { state: 'working', activity: { tool: 'Bash', toolInput: 'npm run bench', lastUserPrompt: 'run the benchmarks', lastAssistant: '', lastAssistantAt: null } }),
    ],
    lanes: [lane('release-notes', ['release notes'], { idle: true })],
    branches: [['release-notes', '6', ['docs/changelog.md']]],
    approvals: [],
    budget: [],
    health: { level: 'ok', alarms: [] },
    cycle() {},
  },
};

// --- a pausable TCP hop, so a builder can go down and come back on the same URL

async function hop(targetPort) {
  const sockets = new Set();
  let server = null;
  let port = 0;
  const listen = () => new Promise((resolve, reject) => {
    server = net.createServer((client) => {
      const up = net.connect(targetPort, '127.0.0.1');
      sockets.add(client); sockets.add(up);
      const drop = () => { client.destroy(); up.destroy(); sockets.delete(client); sockets.delete(up); };
      client.on('error', drop); up.on('error', drop); client.on('close', drop); up.on('close', drop);
      client.pipe(up); up.pipe(client);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });
  await listen();
  return {
    get port() { return port; },
    get up() { return server !== null; },
    async down() {
      if (!server) return;
      const s = server; server = null;
      for (const x of sockets) x.destroy();
      sockets.clear();
      await new Promise((r) => s.close(() => r()));
    },
    async resume() { if (!server) await listen(); },
  };
}

// --- the "tailscale serve" forwarder -----------------------------------------

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade']);
const STRIP_IN = new Set(['host', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'x-laneboard-sig', 'x-laneboard-key', 'x-laneboard-ts', 'x-laneboard-nonce', 'x-laneboard-envelope']);

/** What serve sends: the client's headers minus identity spoofing, plus serve's own. */
function serveHeaders(inHeaders) {
  const h = {};
  for (const [k, v] of Object.entries(inHeaders)) {
    if (STRIP_IN.has(k) || HOP_BY_HOP.has(k)) continue;
    h[k] = v;
  }
  h.host = PUBLIC_HOST;
  h['x-forwarded-for'] = '127.0.0.1';
  h['x-forwarded-proto'] = 'https';
  h['x-forwarded-host'] = PUBLIC_HOST;
  h['tailscale-user-login'] = DEMO_USER;
  return h;
}

/** /css/tokens.css with the design direction appended, uncompressed and uncached. */
function designTokens(ingressPort, req, res) {
  const h = serveHeaders(req.headers);
  for (const k of ['accept-encoding', 'if-none-match', 'if-modified-since']) delete h[k];
  const up = http.request({ host: '127.0.0.1', port: ingressPort, method: 'GET', path: req.url, headers: h }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      if (r.statusCode !== 200) { res.writeHead(r.statusCode ?? 502, { 'content-type': 'text/plain' }); res.end(); return; }
      const body = Buffer.concat([...chunks, Buffer.from(`\n/* demo-fleet --design ${DESIGN.name} */\n${DESIGN.css}`)]);
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
    });
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('hub unreachable\n'); });
  up.end();
}

// The hub's Morning merge drops `runs` (fenced), so the forwarder adds the
// demo run's digest to /api/fleet/morning itself (night 3 T7).
function morningWithRuns(ingressPort, req, res) {
  const h = serveHeaders(req.headers);
  delete h['accept-encoding'];
  const up = http.request({ host: '127.0.0.1', port: ingressPort, method: 'GET', path: req.url, headers: h }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      let body = Buffer.concat(chunks);
      if (r.statusCode === 200) {
        try { body = Buffer.from(JSON.stringify(demoMorningWithRuns(JSON.parse(body.toString('utf8'))))); } catch { /* keep the hub's bytes */ }
      }
      res.writeHead(r.statusCode ?? 502, { 'content-type': r.headers['content-type'] ?? 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
    });
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('hub unreachable\n'); });
  up.end();
}

function forwarder(ingressPort) {
  const server = http.createServer((req, res) => {
    if (DESIGN && req.method === 'GET' && req.url.split('?')[0] === '/css/tokens.css') { designTokens(ingressPort, req, res); return; }
    const runs = demoRunsAnswer(req.method, req.url);
    if (runs) {
      const body = Buffer.from(JSON.stringify(runs.body));
      res.writeHead(runs.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (req.method === 'GET' && req.url.split('?')[0] === FLEET_MORNING_PATH) { morningWithRuns(ingressPort, req, res); return; }
    const up = http.request({ host: '127.0.0.1', port: ingressPort, method: req.method, path: req.url, headers: serveHeaders(req.headers) }, (r) => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!HOP_BY_HOP.has(k)) out[k] = v;
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }); res.end('hub unreachable\n'); });
    req.pipe(up);
  });
  server.on('upgrade', (req, socket, head) => {
    const h = serveHeaders(req.headers);
    h.connection = 'Upgrade';
    h.upgrade = req.headers.upgrade ?? 'websocket';
    const up = net.connect(ingressPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (const [k, v] of Object.entries(h)) {
        for (const one of Array.isArray(v) ? v : [v]) {
          if (/[\r\n]/.test(String(one))) continue;
          lines.push(`${k}: ${one}`);
        }
      }
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const drop = () => { socket.destroy(); up.destroy(); };
    up.on('error', drop);
    socket.on('error', drop);
  });
  return server;
}

// --- main --------------------------------------------------------------------

const log = (m) => process.stdout.write(`[demo-fleet] ${m}\n`);

async function main() {
  const { privateKey: hubKey } = generateHubKey();
  const pin = [{ key: publicKeyString(hubKey), id: 'hub', scopes: ['read', 'control', 'term'] }];
  const ids = Object.keys(DEMO).slice(0, N_BUILDERS);

  const fakes = new Map();
  const hops = new Map();
  for (const id of ids) {
    const d = DEMO[id];
    const fb = await fakeBuilder({
      id,
      hubKeys: pin,
      hubControl: true,
      sessions: d.sessions,
      helloFields: { repos: ['acme'] },
      audit: [],
    });
    fakes.set(id, fb);
    hops.set(id, await hop(fb.port));
  }

  const mapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-demo-map-'));
  const map = writeDemoMap(mapDir);
  const origins = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`];
  const hub = await boot({
    mode: 'hub',
    hubKey,
    timeoutMs: 20_000,
    config: demoHubConfig({
      builders: ids.map((id) => ({ id, url: `http://127.0.0.1:${hops.get(id).port}` })),
      origins,
      publicHost: PUBLIC_HOST,
      map,
    }),
  });

  const fwd = forwarder(hub.ingressPort);
  await new Promise((resolve, reject) => {
    fwd.once('error', reject);
    fwd.listen(PORT, '127.0.0.1', resolve);
  });

  /** Everything a real builder streams besides sessions. */
  function pushExtras(id) {
    const fb = fakes.get(id);
    const d = DEMO[id];
    fb.push({ type: 'delta', sessions: fb.sessions, lanes: d.lanes, budget: d.budget, generatedAt: Date.now() });
    fb.push({ type: 'health', health: d.health });
    for (const a of d.approvals) fb.push({ type: 'approval', op: 'open', approval: a });
    for (const s of fb.sessions) if (s.stuck) fb.push({ type: 'stuck', name: s.name, stuck: s.stuck });
    fb.push({ type: 'repos', repo: 'acme', data: repoData(id, d.branches) });
  }

  let n = 0;
  const tick = async () => {
    n++;
    try { writeDemoFeed(map.feedsDir); } catch (e) { log(`feed write failed: ${e.message}`); }
    for (const id of ids) {
      const fb = fakes.get(id);
      DEMO[id].cycle(n, fb.sessions);
      if (hops.get(id).up) pushExtras(id);
    }
    // builder-c: up for 10 ticks, then down long enough to go stale and down.
    const c = hops.get('builder-c');
    if (c) {
      const phase = n % 16;
      if (phase === 10 && c.up) { await c.down(); log('builder-c went offline (stale, then down)'); }
      if (phase === 0 && !c.up) { await c.resume(); log('builder-c is back'); }
    }
  };
  // First push as soon as the hub has the streams, then every tick.
  setTimeout(() => { for (const id of ids) pushExtras(id); }, 1500);
  const timer = setInterval(() => { tick().catch((e) => log(`tick failed: ${e.message}`)); }, TICK_MS);

  log(`hub "${DEMO_HOSTNAME}" (mode hub) + ${ids.join(', ')}`);
  log(`open  http://127.0.0.1:${PORT}/   (signed in as ${DEMO_USER} via the serve-like forwarder)`);
  if (DESIGN) log(`design direction "${DESIGN.name}" laid over /css/tokens.css`);
  log(`hub local listener http://127.0.0.1:${hub.port}/ (read-only), ingress ${hub.ingressPort}`);
  log('Ctrl-C to stop');

  let stopping = false;
  const stop = async (sig) => {
    if (stopping) return;
    stopping = true;
    log(`${sig}: stopping`);
    clearInterval(timer);
    fwd.closeAllConnections?.();
    fwd.close();
    await hub.stop().catch(() => {});
    for (const h of hops.values()) await h.down().catch(() => {});
    await Promise.all([...fakes.values()].map((f) => f.close().catch(() => {})));
    fs.rmSync(mapDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('SIGHUP'));
}

main().catch((err) => {
  process.stderr.write(`demo-fleet: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
