// Hub packages merge (fleet §6 2.9, P11): run dedupe and `disputed`, branch
// join to a lane on another builder, overlap fallback vs textual override,
// Map edges, rows, and the service/route module (one broadcast per 2 s burst).
import test from 'node:test';
import assert from 'node:assert/strict';
import { merge, inputFromView, createPackagesService, DEBOUNCE_MS } from '../server/hub/packages.mjs';
import { createModule } from '../server/hub/routes/packages.mjs';
import defaultModule from '../server/hub/routes/packages.mjs';
import { createFleetStore } from '../server/hub/fleet-store.mjs';
import { createContext } from '../server/modules.mjs';

const T0 = Date.parse('2026-10-14T12:00:00Z');
const HEAD = 'a'.repeat(40);
const S1 = '1'.repeat(40);
const S2 = '2'.repeat(40);
const S3 = '3'.repeat(40);
const S4 = '4'.repeat(40);

function job(name, over = {}) {
  return { id: name, name, status: 'completed', conclusion: 'success', verdict: 'ok', partial: false, skippedNames: [], ...over };
}
function run(over = {}) {
  return {
    id: 101, attempt: 1, workflow: 'CI', file: 'ci.yml', sha: HEAD, event: 'push',
    status: 'completed', conclusion: 'success', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:05:00Z',
    jobs: [job('web-check'), job('api-test')], ...over,
  };
}
function repo(over = {}) {
  return {
    name: 'acme', slug: 'acme/acme', mainRef: 'origin/main', head: { sha: HEAD, at: '2026-10-14T10:00:00Z' },
    packages: [
      { name: 'web', paths: ['web/**'], source: 'config', kind: 'npm' },
      { name: 'api', paths: ['api/**'], source: 'config', kind: 'py' },
    ],
    workflows: [{ file: 'ci.yml', name: 'CI', jobs: [{ id: 'web-check', name: 'web-check', prOnly: false }, { id: 'api-test', name: 'api-test', prOnly: false }] }],
    jobMap: {
      'ci.yml#web-check': { packages: ['web'], via: 'name', prOnly: false },
      'ci.yml#api-test': { packages: ['api'], via: 'name', prOnly: false },
    },
    ci: { provider: 'gh', auth: true, at: '2026-10-14T10:06:00Z', rate: { remaining: 4900, low: false }, runs: [run()] },
    lastTested: {}, untested: {},
    branches: [], conflicts: [], deps: [], commits: {}, plans: { counts: {}, files: [] },
    ...over,
  };
}
function branch(name, sha, over = {}) {
  return {
    repo: 'acme', branch: name, sha, local: false, pushed: true, laneId: null, mergeBase: HEAD,
    ahead: 1, behind: 0, lastCommitAt: T0 - 3600_000, files: ['web/a.js'], packages: ['web'],
    size: { files: 1, ins: 3, del: 1 }, ...over,
  };
}
const lane = (id, over = {}) => ({ id, root: `/w/acme-${id}`, branch: id, sessions: ['s1'], idle: false, ...over });

/** A fleet store with builder-a and builder-b holding the given snapshots. */
function storeWith(snaps) {
  const st = createFleetStore({ builders: [{ id: 'builder-a', url: 'http://127.0.0.1:1' }, { id: 'builder-b', url: 'http://127.0.0.1:2' }] });
  for (const [id, snap] of Object.entries(snaps)) {
    st.setConn(id, { state: 'up', lastSeen: T0 });
    st.applySnapshot(id, { sessions: [], ...snap }, T0);
  }
  return st;
}
const mergedFrom = (st, now = T0) => merge(inputFromView(st.view(now)), { now });

// ---------------------------------------------------------------- runs

test('runs: deduped by (slug, id, attempt), the greater updatedAt wins, tagged via', () => {
  const st = storeWith({
    'builder-a': { repos: { acme: repo({ ci: { ...repo().ci, runs: [run({ status: 'in_progress', conclusion: null, updatedAt: '2026-10-14T10:01:00Z' })] } }) } },
    'builder-b': { repos: { acme: repo() } },
  });
  const out = mergedFrom(st);
  assert.equal(out.repos.length, 1);
  const runs = out.repos[0].ci.runs;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].conclusion, 'success');
  assert.equal(runs[0].via, 'builder-b');
  assert.equal(runs[0].disputed, undefined);
  assert.deepEqual(out.repos[0].builders, ['builder-a', 'builder-b']);

  // A second attempt of the same run id is a different run.
  const out2 = merge([
    { builder: 'builder-a', data: { repos: [repo({ ci: { ...repo().ci, runs: [run(), run({ attempt: 2, createdAt: '2026-10-14T11:00:00Z' })] } })] } },
  ], { now: T0 });
  assert.deepEqual(out2.repos[0].ci.runs.map((r) => r.attempt), [2, 1]);
});

test('runs: equal updatedAt with a different conclusion is disputed, both reports shown', () => {
  const failing = run({ conclusion: 'failure', jobs: [job('web-check', { conclusion: 'failure', verdict: 'fail' }), job('api-test')] });
  const st = storeWith({
    'builder-a': { repos: { acme: repo() } },
    'builder-b': { repos: { acme: repo({ ci: { ...repo().ci, runs: [failing] } }) } },
  });
  const r = mergedFrom(st).repos[0].ci.runs[0];
  assert.deepEqual(r.disputed, ['builder-a', 'builder-b']);
  assert.deepEqual(r.reports, [
    { via: 'builder-a', status: 'completed', conclusion: 'success' },
    { via: 'builder-b', status: 'completed', conclusion: 'failure' },
  ]);
  // Same conclusion at the same time: not disputed.
  const st2 = storeWith({ 'builder-a': { repos: { acme: repo() } }, 'builder-b': { repos: { acme: repo() } } });
  assert.equal(mergedFrom(st2).repos[0].ci.runs[0].disputed, undefined);
});

test('untrusted tags from a builder are dropped and recomputed', () => {
  const lying = run({ via: 'builder-b', disputed: ['x'], reports: [{ via: 'evil' }] });
  const out = merge([
    { builder: 'builder-a', data: {
      repos: { acme: repo({
        via: 'builder-b', builders: ['evil'],
        ci: { ...repo().ci, via: 'builder-b', runs: [lying] },
        branches: [branch('feat-x', S1, { via: 'builder-b', fkey: 'builder-b/feat-x', laneFkey: 'builder-b/other', live: true })],
      }) },
    } },
    { builder: 'Not A Valid Id', data: { repos: { acme: repo() } } },
  ], { now: T0 });
  assert.deepEqual(out.builders, ['builder-a']);
  const r = out.repos[0];
  assert.equal(r.via, 'builder-a');
  assert.deepEqual(r.builders, ['builder-a']);
  assert.equal(r.ci.via, 'builder-a');
  assert.equal(r.ci.runs[0].via, 'builder-a');
  assert.equal(r.ci.runs[0].disputed, undefined);
  assert.equal(r.ci.runs[0].reports, undefined);
  const br = r.branches[0];
  assert.equal(br.via, 'builder-a');
  assert.equal(br.fkey, null, 'no lane works on it: the builder cannot claim one');
  assert.equal(br.laneFkey, undefined);
  assert.equal(br.live, undefined);
});

test('the fleet store strips routing keys before the merge sees them', () => {
  const st = storeWith({
    'builder-a': { repos: { acme: repo({ conflicts: [{ a: { branch: 'feat-x', sha: S1, fkey: 'builder-b/x' }, b: { main: true }, kind: 'textual', files: ['web/a.js'] }] }), __proto__x: repo() } },
  });
  const out = mergedFrom(st);
  const c = out.repos[0].conflicts[0];
  assert.equal(c.a.fkey, undefined);
  assert.equal(c.via, 'builder-a');
});

// ---------------------------------------------------------------- branches

test('branches: the local report wins and a remote-only branch joins the fkey of a lane on another builder', () => {
  const st = storeWith({
    // builder-a sees feat-x only as a remote ref, with an older sha.
    'builder-a': { repos: { acme: repo({ branches: [branch('feat-x', S1), branch('feat-y', S3)] }) } },
    // builder-b runs the lane: local worktree, the true head.
    'builder-b': {
      lanes: [lane('feat-x')],
      repos: { acme: repo({ branches: [branch('feat-x', S2, { local: true, laneId: 'feat-x', pushed: false })] }) },
    },
  });
  const out = mergedFrom(st);
  const br = out.repos[0].branches.find((b) => b.branch === 'feat-x');
  assert.equal(br.sha, S2);
  assert.equal(br.local, true);
  assert.equal(br.via, 'builder-b');
  assert.equal(br.fkey, 'builder-b/feat-x');
  assert.equal(out.repos[0].branches.find((b) => b.branch === 'feat-y').fkey, null);

  // builder-b has the lane but reports no repo block: joined through its lanes.
  const st2 = storeWith({
    'builder-a': { repos: { acme: repo({ branches: [branch('feat-x', S1)] }) } },
    'builder-b': { lanes: [lane('feat-x')] },
  });
  const br2 = mergedFrom(st2).repos[0].branches[0];
  assert.equal(br2.via, 'builder-a');
  assert.equal(br2.fkey, 'builder-b/feat-x');
  // The row lists the lane by its fleet key.
  const row = mergedFrom(st2).rows.find((r) => r.package === 'web');
  assert.deepEqual(row.lanes, ['builder-b/feat-x']);
});

// ---------------------------------------------------------------- conflicts

test('overlap fallback for lanes no builder sees together; textual for the same sha pair overrides it', () => {
  const laneA = branch('feat-a', S1, { local: true, laneId: 'feat-a', pushed: false, files: ['web/a.js', 'web/b.js'] });
  const laneB = branch('feat-b', S2, { local: true, laneId: 'feat-b', pushed: false, files: ['web/b.js'] });
  const snaps = {
    'builder-a': { lanes: [lane('feat-a')], repos: { acme: repo({ branches: [laneA] }) } },
    'builder-b': { lanes: [lane('feat-b')], repos: { acme: repo({ branches: [laneB] }) } },
  };
  let out = mergedFrom(storeWith(snaps));
  let cs = out.repos[0].conflicts;
  assert.equal(cs.length, 1);
  assert.equal(cs[0].kind, 'overlap');
  assert.equal(cs[0].via, 'hub');
  assert.deepEqual(cs[0].files, ['web/b.js']);
  assert.deepEqual(out.edges, [{ a: 'builder-a/feat-a', b: 'builder-b/feat-b', kind: 'overlap', files: 1, repo: 'acme' }]);
  let row = out.rows.find((r) => r.package === 'web');
  assert.equal(row.conflicts.overlap, 1);
  assert.equal(row.lamp, 'low');

  // builder-b pushes; builder-a now sees feat-b as remote and its textual pass finds a conflict.
  snaps['builder-a'].repos.acme.branches = [laneA, branch('feat-b', S2, { files: ['web/b.js'] })];
  snaps['builder-a'].repos.acme.conflicts = [{ a: { branch: 'feat-a', sha: S1 }, b: { branch: 'feat-b', sha: S2 }, kind: 'textual', files: ['web/b.js'], at: T0 }];
  out = mergedFrom(storeWith(snaps));
  cs = out.repos[0].conflicts;
  assert.equal(cs.length, 1);
  assert.equal(cs[0].kind, 'textual');
  assert.equal(cs[0].a.fkey, 'builder-a/feat-a');
  assert.equal(cs[0].b.fkey, 'builder-b/feat-b');
  assert.deepEqual(out.edges, [{ a: 'builder-a/feat-a', b: 'builder-b/feat-b', kind: 'textual', files: 1, repo: 'acme' }]);
  row = out.rows.find((r) => r.package === 'web');
  assert.deepEqual([row.conflicts.textual, row.conflicts.overlap], [1, 0]);
  assert.equal(row.lamp, 'warn');

  // Both seen by one builder and no textual conflict: clean, no overlap added.
  snaps['builder-a'].repos.acme.conflicts = [];
  out = mergedFrom(storeWith(snaps));
  assert.deepEqual(out.repos[0].conflicts, []);
  assert.deepEqual(out.edges, []);
});

test('conflicts dedupe by sorted sha pair across builders; vs-main edges point at main:<repo>', () => {
  const a = branch('feat-a', S1, { local: true, laneId: 'feat-a', files: ['api/x.py'] });
  const b = branch('feat-b', S2, { files: ['api/x.py'] });
  const pairAB = { a: { branch: 'feat-a', sha: S1 }, b: { branch: 'feat-b', sha: S2 }, kind: 'textual', files: ['api/x.py'] };
  const pairBA = { a: { branch: 'feat-b', sha: S2 }, b: { branch: 'feat-a', sha: S1 }, kind: 'textual', files: ['api/x.py'] };
  const vsMain = { a: { branch: 'feat-a', sha: S1 }, b: { main: true }, kind: 'textual', files: ['api/x.py', 'api/y.py'] };
  const out = merge([
    { builder: 'builder-a', data: { lanes: [lane('feat-a')], repos: [repo({ branches: [a, b], conflicts: [pairAB, vsMain] })] } },
    { builder: 'builder-b', data: { lanes: [lane('feat-b')], repos: [repo({ branches: [b, { ...a, local: false }], conflicts: [pairBA] })] } },
  ], { now: T0 });
  assert.equal(out.repos[0].conflicts.length, 2);
  const edges = [...out.edges].sort((x, y) => (x.b < y.b ? -1 : 1));
  assert.deepEqual(edges, [
    { a: 'builder-a/feat-a', b: 'builder-b/feat-b', kind: 'textual', files: 1, repo: 'acme' },
    { a: 'builder-a/feat-a', b: 'main:acme', kind: 'textual', files: 2, repo: 'acme' },
  ]);
  assert.ok(out.hotspots.some((h) => h.repo === 'acme' && h.file === 'api/x.py' && h.conflicts === 2));
});

// ---------------------------------------------------------------- order, stale, rows

test('order ranks candidate lanes; stale branches join liveness from lanes; rows cover the fleet', () => {
  const old = T0 - 30 * 86400_000;
  const out = merge([
    { builder: 'builder-a', data: {
      lanes: [lane('feat-a', { reviewReady: true }), lane('feat-c', { reviewReady: true }), lane('feat-old', { sessions: [], idle: true })],
      repos: { acme: repo({ branches: [
        branch('feat-a', S1, { local: true, laneId: 'feat-a', size: { files: 1, ins: 50, del: 0 } }),
        branch('feat-c', S2, { local: true, laneId: 'feat-c', files: ['api/z.py'], size: { files: 1, ins: 1, del: 0 } }),
        branch('feat-old', S3, { local: true, laneId: 'feat-old', files: ['api/q.py'], lastCommitAt: old }),
        branch('gone', S4, { files: ['docs/x.md'], lastCommitAt: old }),
      ] }) },
    } },
  ], { now: T0 });
  assert.deepEqual(out.order.map((o) => [o.repo, o.fkey, o.rank]), [['acme', 'builder-a/feat-c', 1], ['acme', 'builder-a/feat-a', 2]]);
  assert.deepEqual(out.stale.map((s) => [s.branch, s.laneFkey, s.suggestion]), [['feat-old', 'builder-a/feat-old', 'delete-branch'], ['gone', null, 'delete-branch']]);
  assert.ok(out.stale.every((s) => s.repo === 'acme'));
  assert.deepEqual(out.rows.map((r) => r.package).sort(), ['_other', 'api', 'web']);
  assert.equal(out.rows.find((r) => r.package === 'web').main.status, 'ok');
});

test('repos are keyed by slug; repo fields come from the freshest live report', () => {
  const out = merge([
    { builder: 'builder-a', stale: true, data: { repos: { acme: repo({ head: { sha: S1, at: '2026-10-14T11:00:00Z' } }) } } },
    { builder: 'builder-b', data: { repos: { 'acme-checkout': repo({ name: 'acme-checkout', head: { sha: HEAD, at: '2026-10-14T10:00:00Z' } }) } } },
  ], { now: T0 });
  assert.equal(out.repos.length, 1);
  assert.equal(out.repos[0].via, 'builder-b');
  assert.equal(out.repos[0].name, 'acme-checkout');
  assert.deepEqual(out.builders, ['builder-b', 'builder-a']);
  assert.deepEqual(merge([], { now: T0 }), { generatedAt: T0, builders: [], repos: [], rows: [], edges: [], hotspots: [], order: [], stale: [] });
});

// ---------------------------------------------------------------- service

function fakeTimers() {
  const q = [];
  return {
    q,
    setTimeout(fn, ms) { const t = { fn, ms, done: false }; q.push(t); return t; },
    clearTimeout(t) { if (t) t.done = true; },
    fire() { const t = q.find((x) => !x.done); if (!t) return false; t.done = true; t.fn(); return true; },
    pending() { return q.filter((x) => !x.done).length; },
  };
}

test('service: one packages broadcast per 2 s burst, none when nothing changed', () => {
  const st = storeWith({ 'builder-a': { repos: { acme: repo() } } });
  const timers = fakeTimers();
  const sent = [];
  const svc = createPackagesService({ store: st, broadcast: (m) => sent.push(m), now: () => T0, timers });
  svc.start();
  assert.equal(timers.pending(), 1);
  assert.equal(timers.q[0].ms, DEBOUNCE_MS);
  // A burst of store changes inside the window coalesces into the one timer.
  for (let i = 0; i < 5; i++) st.applyEvent('builder-a', { type: 'repos', repo: 'acme', data: repo({ untested: { web: i } }) }, T0 + i * 300);
  st.applyDelta('builder-a', { sessions: [] }, T0); // no lanes flag: not relevant
  assert.equal(timers.pending(), 1);
  timers.fire();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'packages');
  assert.equal(sent[0].data.repos[0].untested.web, 4);

  // A change that does not alter the merged data broadcasts nothing.
  st.setConn('builder-a', { latencyMs: 12 });
  st.applyEvent('builder-a', { type: 'repos', repo: 'acme', data: repo({ untested: { web: 4 } }) }, T0 + 5000);
  assert.equal(timers.pending(), 1);
  timers.fire();
  assert.equal(sent.length, 1);

  // The next real change is its own burst.
  st.applyDelta('builder-a', { sessions: [], lanes: [lane('feat-x')] }, T0 + 6000);
  st.applyEvent('builder-a', { type: 'repos', repo: 'acme', data: repo({ branches: [branch('feat-x', S1)] }) }, T0 + 6100);
  timers.fire();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].data.repos[0].branches[0].fkey, 'builder-a/feat-x');
  assert.equal(svc.current().repos[0].branches[0].fkey, 'builder-a/feat-x');

  svc.stop();
  st.applyEvent('builder-a', { type: 'repos', repo: 'acme', data: repo() }, T0 + 9000);
  assert.equal(timers.pending(), 0);
});

// ---------------------------------------------------------------- route module

function fakeRes() {
  return {
    status: null, headers: null, body: '',
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = String(b ?? ''); },
  };
}

test('route module: GET /api/packages serves the merge (direct start without the services hook)', async () => {
  assert.equal(defaultModule.name, 'hub-packages');
  assert.deepEqual(defaultModule.modes, ['hub']);
  const st = storeWith({ 'builder-a': { repos: { acme: repo() } } });
  const routes = [];
  const sent = [];
  const ctx = createContext({ mode: 'hub', store: st, broadcast: (m) => sent.push(m), now: () => T0 }, {
    route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
    upgradeHandlers: [],
  });
  const mod = createModule();
  await mod.register(ctx);
  assert.deepEqual(routes.map((r) => `${r.method} ${r.pattern}`), ['GET /api/packages']);
  let res = fakeRes();
  await routes[0].handler({}, res, {});
  assert.equal(res.status, 503, 'not started yet');

  ctx._phase('start');
  await mod.start(ctx);
  res = fakeRes();
  await routes[0].handler({}, res, {});
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.repos[0].slug, 'acme/acme');
  assert.ok(Array.isArray(body.rows) && body.rows.length === 2);
  assert.deepEqual(Object.keys(body).sort(), ['builders', 'edges', 'generatedAt', 'hotspots', 'order', 'repos', 'rows', 'stale']);
  mod.stop();
});

test('route module: registers its service on the §3 services hook and broadcasts through it', async () => {
  const st = storeWith({ 'builder-b': { repos: { acme: repo() } } });
  const registered = [];
  const services = { register: (s) => registered.push(s) };
  const routes = [];
  const ctx = createContext({ mode: 'hub', services }, {
    route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
    upgradeHandlers: [],
  });
  const mod = createModule();
  await mod.register(ctx);
  await mod.start(ctx); // no-op: the hook owns the lifecycle
  assert.deepEqual(registered.map((s) => s.name), ['packages']);
  const sent = [];
  const stop = registered[0].start({ store: st, broadcast: (m) => sent.push(m), now: () => T0, config: { packages: { staleDays: 7 } } });
  assert.equal(typeof stop, 'function');
  const res = fakeRes();
  await routes[0].handler({}, res, {});
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body).builders, ['builder-b']);
  stop();
  mod.stop();
  assert.equal(sent.length, 0, 'the debounced broadcast was cancelled by stop');
});
