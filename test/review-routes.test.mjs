// Review routes and send-review (fleet R7: server/routes/review.mjs,
// server/review/actions.mjs, server/morning.mjs additions). Hermetic: a temp
// bare remote, a clone `acme` and a worktree `acme-lane1`, a copy of the
// synthetic transcript fixture under a temp projects dir, tmux stubbed
// (capturePane / sendText), an in-memory db and a throwaway audit sink.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-review-routes-'));
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));
process.env.LANEBOARD_LANES_DIR = path.join(tmp, 'lanes');
process.env.LANEBOARD_CODE_DIR = path.join(tmp, 'code');
process.env.LANEBOARD_AUDIT_FILE = path.join(tmp, 'audit.jsonl');
process.env.LANEBOARD_STATE_DIR = path.join(tmp, 'state');

const { config } = await import('../server/config.mjs');
const D = await import('../server/review/diff.mjs');
const store = await import('../server/lanes/store.mjs');
const stateMod = await import('../server/state.mjs');
const reviewCollector = await import('../server/collector/review.mjs');
const { createContext } = await import('../server/modules.mjs');
const dispatchMod = await import('../server/fleet/dispatch.mjs');
const apiV1 = await import('../server/fleet/api-v1.mjs');
const reviewModule = (await import('../server/routes/review.mjs')).default;
const routesMod = await import('../server/routes/review.mjs');
const actionsMod = await import('../server/review/actions.mjs');
const morning = await import('../server/morning.mjs');
const { reviewPointer } = await import('../public/js/core/review-format.js');

D.init({ lanes: () => [] });

// --- temp repos --------------------------------------------------------------

const code = path.join(tmp, 'code');
const remote = path.join(tmp, 'acme.git');
const mainRepo = path.join(code, 'acme');
const root = path.join(code, 'acme-lane1');
fs.mkdirSync(code, { recursive: true });
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const sh = (cwd, ...a) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...a], { stdio: 'pipe', env: gitEnv }).toString();
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';

execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: gitEnv });
execFileSync('git', ['clone', '-q', remote, mainRepo], { stdio: 'pipe', env: gitEnv });
fs.writeFileSync(path.join(mainRepo, 'a.txt'), lines(10));
sh(mainRepo, 'checkout', '-q', '-b', 'main');
sh(mainRepo, 'add', '.');
sh(mainRepo, 'commit', '-q', '-m', 'base');
sh(mainRepo, 'push', '-q', '-u', 'origin', 'main');
sh(mainRepo, 'worktree', 'add', '-q', '-b', 'feat/lane1', root);
fs.writeFileSync(path.join(root, 'a.txt'), lines(10).replace('line 3\n', 'line three\n'));
fs.writeFileSync(path.join(root, 'evil.js'), 'const s = "<img src=x onerror=alert(1)>";\n');
sh(root, 'add', '-A');
sh(root, 'commit', '-q', '-m', 'work');
await store.write({ id: 'lane1', repo: 'acme', root, branch: 'feat/lane1', session: 'builder-a-lane1', createdAt: 1, retiredAt: null });
const headSha = sh(root, 'rev-parse', 'HEAD').trim();
const mergeBase = sh(root, 'merge-base', 'origin/main', 'HEAD').trim();

// --- transcript fixture --------------------------------------------------------

const projects = path.join(tmp, 'projects');
fs.mkdirSync(path.join(projects, '-home-user-acme'), { recursive: true });
const transcript = path.join(projects, '-home-user-acme', 'sess.jsonl');
fs.copyFileSync(path.join(import.meta.dirname, 'fixtures', 'transcript', 'session.jsonl'), transcript);
const outside = path.join(tmp, 'outside.jsonl');
fs.copyFileSync(transcript, outside);
const link = path.join(projects, '-home-user-acme', 'link.jsonl');
fs.symlinkSync(outside, link);

// --- fake state / tmux -----------------------------------------------------------

const PANE_READY = ['some output', '\x1b[2m───\x1b[0m', '❯ '];
const sessions = new Map();
function addSession(name, over = {}) {
  sessions.set(name, {
    name, paneId: '%9', state: 'idle', dir: root, lane: 'lane1',
    claude: { sessionId: 'sess', transcriptPath: transcript },
    preview: Array.from({ length: 40 }, (_, i) => `\x1b[31mline ${i + 1}\x1b[0m`),
    ...over,
  });
}
addSession('builder-a-lane1');
addSession('builder-a-outside', { claude: { sessionId: 'x', transcriptPath: link } });
addSession('builder-a-nofile', { claude: { sessionId: 'y', transcriptPath: path.join(projects, 'nope.jsonl') } });

const snapLanes = [{
  id: 'lane1', hue: 10, branch: 'feat/lane1', merged: false, isMain: false, idle: false,
  lastCommitAt: Date.now() - 1000, progress: null, sessions: ['builder-a-lane1'],
  packages: ['core'], reviewReady: { ready: true, reasons: ['done-marker'], since: 5 }, reviewSentAt: 3,
}];
const fakeState = {
  get: (n) => sessions.get(n) ?? null,
  all: () => [...sessions.values()],
  snapshot: () => ({ sessions: [...sessions.values()], lanes: snapLanes, attention: [] }),
  promptReadiness: stateMod.promptReadiness,
};
let pane = PANE_READY;
const typed = [];
const fakeActions = {
  async sendText(name, text, enter, who) {
    typed.push({ name, text, enter, who });
    return { ok: true };
  },
};
const capturePane = async () => pane;

const testConfig = {
  ...config,
  projectsDir: projects,
  lanesDir: path.join(tmp, 'lanes'),
  codeDir: code,
  fleet: { ...(config.fleet ?? {}), id: 'builder-a', code: 'BA' },
};

// --- a small server over the module's routes -------------------------------------

const table = [];
const ctx = createContext(
  { mode: 'builder', config: testConfig, state: fakeState, actions: fakeActions, log: { info() {}, warn() {}, error() {} } },
  {
    route(method, pattern, handler) {
      const keys = [];
      const rx = new RegExp('^' + pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
      table.push({ method, rx, keys, handler });
    },
    upgradeHandlers: [],
  },
);
await reviewModule.register(ctx);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  req.query = url.searchParams;
  for (const r of table) {
    if (r.method !== req.method) continue;
    const m = r.rx.exec(url.pathname);
    if (!m) continue;
    req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return r.handler(req, res);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function get(p) {
  const r = await fetch(base + p);
  const text = await r.text();
  return { status: r.status, type: r.headers.get('content-type'), body: JSON.parse(text), text };
}

// --- registration ------------------------------------------------------------------

test('the module registers four GET reads, the capabilities and send-review (tier ask)', () => {
  assert.deepEqual(table.map((r) => r.method), ['GET', 'GET', 'GET', 'GET']);
  const hello = apiV1.hello();
  assert.ok(hello.capabilities.includes('review'));
  assert.ok(hello.capabilities.includes('morning'));
  assert.equal(dispatchMod.tiers()['send-review'], 'ask');
  for (const r of routesMod.routes(routesMod.createHandlers({}))) assert.equal(r.tier, 'read');
  // a second registration only swaps the deps
  assert.equal(actionsMod.registerSendReview(routesMod.actionDeps(ctx)), false);
});

// --- diff --------------------------------------------------------------------------

test('diff: structured JSON for the lane', async () => {
  const r = await get('/api/v1/lanes/lane1/diff?base=origin/main');
  assert.equal(r.status, 200);
  assert.match(r.type, /application\/json/);
  assert.equal(r.body.lane, 'lane1');
  assert.equal(r.body.headSha, headSha);
  const files = Object.fromEntries(r.body.files.map((f) => [f.path, f]));
  assert.equal(files['a.txt'].status, 'M');
  // untrusted text stays a plain JSON string
  const evil = files['evil.js'].hunks[0].lines.find((l) => l.t === '+');
  assert.equal(evil.s, 'const s = "<img src=x onerror=alert(1)>";');
  assert.ok(!('html' in r.body));
});

test('diff: single file, bad base, bad mode, bad lane id and unknown lane map DiffError to HTTP', async () => {
  const one = await get('/api/v1/lanes/lane1/diff?path=a.txt&mode=committed');
  assert.equal(one.status, 200);
  assert.deepEqual(one.body.files.map((f) => f.path), ['a.txt']);
  assert.equal((await get('/api/v1/lanes/lane1/diff?base=--output=/tmp/x')).status, 400);
  assert.equal((await get('/api/v1/lanes/lane1/diff?base=origin/main;rm')).status, 400);
  assert.equal((await get('/api/v1/lanes/lane1/diff?mode=weird')).status, 400);
  assert.equal((await get('/api/v1/lanes/lane1/diff?path=../etc/passwd')).status, 404);
  assert.equal((await get('/api/v1/lanes/..x/diff')).status, 400);
  const missing = await get('/api/v1/lanes/nolane/diff');
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.body.error, 'string');
});

test('errorResponse: an unexpected error is a fixed 500 text, a DiffError keeps its status', () => {
  const r = routesMod.errorResponse(new Error('secret /home/x stack'), null);
  assert.deepEqual(r, { status: 500, body: { error: 'internal error' } });
  assert.deepEqual(routesMod.errorResponse(new D.DiffError('busy', 429), null), { status: 429, body: { error: 'busy' } });
});

// --- transcript ----------------------------------------------------------------------

test('transcript: plain text entries from the session transcript', async () => {
  const r = await get('/api/v1/sessions/builder-a-lane1/transcript?limit=3');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'builder-a-lane1');
  assert.equal(r.body.entries.length, 3);
  for (const e of r.body.entries) {
    assert.equal(typeof e.text, 'string');
    assert.ok(!e.text.includes('\x1b'), 'ANSI stripped');
  }
  assert.ok(Number.isInteger(r.body.startOffset) && Number.isInteger(r.body.endOffset));
  // the page before has no overlap
  const prev = await get(`/api/v1/sessions/builder-a-lane1/transcript?before=${r.body.startOffset}&limit=2`);
  assert.equal(prev.status, 200);
  assert.ok(prev.body.entries.every((e) => e.off < r.body.startOffset));
  // forward from the end: nothing new
  const fwd = await get(`/api/v1/sessions/builder-a-lane1/transcript?after=${r.body.endOffset}`);
  assert.equal(fwd.status, 200);
  assert.deepEqual(fwd.body.entries, []);
});

test('transcript: <img stays literal text in the JSON', async () => {
  const r = await get('/api/v1/sessions/builder-a-lane1/transcript?limit=200');
  assert.equal(r.status, 200);
  assert.ok(r.body.entries.some((e) => e.text.includes('<img')));
});

test('transcript: outside projectsDir (symlink), missing file, unknown session, bad args', async () => {
  assert.equal((await get('/api/v1/sessions/builder-a-outside/transcript')).status, 404);
  assert.equal((await get('/api/v1/sessions/builder-a-nofile/transcript')).status, 404);
  assert.equal((await get('/api/v1/sessions/ghost/transcript')).status, 404);
  assert.equal((await get('/api/v1/sessions/builder-a-lane1/transcript?after=1&before=2')).status, 400);
  assert.equal((await get('/api/v1/sessions/builder-a-lane1/transcript?after=-1')).status, 400);
  assert.equal((await get('/api/v1/sessions/builder-a-lane1/transcript?limit=x')).status, 400);
  assert.equal((await get(`/api/v1/sessions/${encodeURIComponent('a;b')}/transcript`)).status, 400);
});

// --- preview ---------------------------------------------------------------------------

test('preview: {name, lines} raw ANSI, no html, n capped', async () => {
  const r = await get('/api/v1/sessions/builder-a-lane1/preview?n=3');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['lines', 'name']);
  assert.deepEqual(r.body.lines, ['\x1b[31mline 38\x1b[0m', '\x1b[31mline 39\x1b[0m', '\x1b[31mline 40\x1b[0m']);
  assert.equal((await get('/api/v1/sessions/builder-a-lane1/preview')).body.lines.length, 40);
  assert.equal((await get('/api/v1/sessions/builder-a-lane1/preview?n=9999')).body.lines.length, 40);
  assert.equal((await get('/api/v1/sessions/builder-a-lane1/preview?n=abc')).status, 400);
  assert.equal((await get('/api/v1/sessions/ghost/preview')).status, 404);
});

// --- morning ------------------------------------------------------------------------------

test('morning: build() + builder, finished[] and cost.lanes[] carry the review fields', async () => {
  const r = await get('/api/v1/morning?window=12h');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.builder, { id: 'builder-a', code: 'BA' });
  assert.equal(r.body.window, '12h');
  const f = r.body.finished.find((x) => x.lane === 'lane1');
  assert.ok(f, 'lane1 is in finished');
  assert.deepEqual(f.packages, ['core']);
  assert.deepEqual(f.reviewReady, { ready: true, reasons: ['done-marker'], since: 5 });
  assert.equal(f.reviewSentAt, 3);
  assert.equal((await get('/api/v1/morning?window=<x>')).status, 400);
});

test('morning.build: review fields default when the lane has none; cost lanes get them by lane id', () => {
  const now = Date.now();
  const snap = {
    sessions: [{ name: 's1', lane: 'l1', state: 'idle', stateSince: now - 1000, cost: { usd: 2, tokens: { in: 5 } }, activity: {} }],
    lanes: [
      { id: 'l1', hue: 1, branch: 'feat/l1', sessions: ['s1'], merged: false, isMain: false, idle: false, lastCommitAt: now - 500, progress: null, packages: ['web', 7], reviewSentAt: 9 },
      { id: 'l2', hue: 2, branch: 'feat/l2', sessions: [], merged: false, isMain: false, idle: false, lastCommitAt: now - 500, progress: null },
    ],
    attention: [],
  };
  const m = morning.build({ window: '12h', now, snapshot: snap, prFor: () => null });
  assert.ok(!('builder' in m), 'no builder echo unless asked');
  const l2 = m.finished.find((x) => x.lane === 'l2');
  assert.deepEqual([l2.packages, l2.reviewReady, l2.reviewSentAt], [[], null, null]);
  const c1 = m.cost.lanes.find((x) => x.lane === 'l1');
  assert.deepEqual([c1.packages, c1.reviewSentAt], [['web'], 9]);
  assert.deepEqual(morning.build({ window: '12h', now, snapshot: snap, prFor: () => null, builder: { id: 'b', code: 'B' } }).builder, { id: 'b', code: 'B' });
});

// --- send-review ----------------------------------------------------------------------------

const auditEntries = [];
const audit = { append: (e) => { auditEntries.push(e); return { hash: `h${auditEntries.length}` }; } };
const deps = { state: fakeState, actions: fakeActions, capturePane };

function review(over = {}) {
  return {
    base: 'origin/main',
    mergeBase,
    headSha,
    comments: [
      { path: 'evil.js', line: 1, quote: ['const s = "<img src=x onerror=alert(1)>";'], body: 'Do not build HTML from strings.' },
      { path: 'a.txt', side: 'new', line: 3, endLine: 3, quote: ['line three'], body: 'Keep "line 3".\x1b[31m' },
    ],
    ...over,
  };
}

async function sendReview(args, { cfg = testConfig, target = 'lane1', auth = { kind: 'direct', user: 'op@example.invalid' } } = {}) {
  return dispatchMod.dispatch(
    { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: 'builder-a', action: 'send-review', target, args, user: 'op@example.invalid', via: 'direct' },
    { auth, deps, config: cfg, audit },
  );
}

const reviewsDir = path.join(tmp, 'lanes', 'lane1', 'reviews');
const reviewFiles = () => { try { return fs.readdirSync(reviewsDir); } catch { return []; } };

test('send-review inline: one typed message, sorted comments, control chars stripped, sentAt set', async () => {
  typed.length = 0;
  pane = PANE_READY;
  const before = Date.now();
  const r = await sendReview({ review: review() });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.inline, true);
  assert.equal(r.result.comments, 2);
  assert.equal(r.result.file, undefined);
  assert.equal(typed.length, 1);
  const t = typed[0];
  assert.equal(t.name, 'builder-a-lane1');
  assert.equal(t.enter, true);
  assert.equal(t.who, 'op@example.invalid');
  assert.match(t.text, /^REVIEW of feat\/lane1 \(origin\/main @ [0-9a-f]{7} \.\. [0-9a-f]{7}\), 2 comments\./);
  assert.ok(t.text.indexOf('1. a.txt:3') < t.text.indexOf('2. evil.js:1'), 'sorted by path');
  assert.ok(!t.text.includes('\x1b'), 'ESC stripped');
  assert.equal(r.result.textHash, crypto.createHash('sha256').update(t.text).digest('hex'));
  assert.ok(reviewCollector.reviewSentAt('lane1') >= before);
  assert.deepEqual(reviewFiles(), []);
  // audited: a start and a done entry, no review text in the chain
  const last = auditEntries.slice(-2);
  assert.deepEqual(last.map((e) => e.result.phase), ['start', 'done']);
  assert.ok(!JSON.stringify(last).includes('line three'));
});

test('send-review over inlineMaxChars: written to a 0600 file under lanesDir, only the pointer is typed', async () => {
  typed.length = 0;
  pane = PANE_READY;
  const cfg = { ...testConfig, review: { ...testConfig.review, inlineMaxChars: 100 } };
  const r = await sendReview({ review: review({ note: 'Please be thorough.' }) }, { cfg });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.inline, false);
  const file = r.result.file;
  assert.ok(file.startsWith(fs.realpathSync(reviewsDir) + path.sep));
  assert.match(path.basename(file), /^\d+(-\d+)?\.md$/);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(reviewsDir).mode & 0o777, 0o700);
  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /^REVIEW of feat\/lane1/);
  assert.match(content, /Please be thorough\./);
  assert.equal(r.result.textHash, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(typed.length, 1);
  assert.equal(typed[0].text, reviewPointer(2, file));
  assert.ok(!typed[0].text.includes('\n'));
  assert.ok(!typed[0].text.includes('line three'));
  // the worktree stays clean
  assert.equal(sh(root, 'status', '--porcelain'), '');
});

test('send-review refuses a session on a dialog (409) and leaves no file behind', async () => {
  typed.length = 0;
  pane = ['Do you want to proceed?', '❯ 1. Yes', '  2. No'];
  const n = reviewFiles().length;
  const cfg = { ...testConfig, review: { ...testConfig.review, inlineMaxChars: 100 } };
  const r = await sendReview({ review: review() }, { cfg });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.code, 'prompting');
  assert.equal(reviewFiles().length, n);
  pane = ['Do you trust this folder?', 'Yes, I trust this folder'];
  assert.equal((await sendReview({ review: review() })).status, 409);
  assert.equal(typed.length, 0);
  pane = PANE_READY;
});

test('send-review: waiting_permission or awaitingApproval is refused; a working pane is allowed', async () => {
  typed.length = 0;
  const s = sessions.get('builder-a-lane1');
  s.state = 'waiting_permission';
  assert.equal((await sendReview({ review: review() })).status, 409);
  s.state = 'working';
  s.awaitingApproval = { id: 'x' };
  assert.equal((await sendReview({ review: review() })).status, 409);
  delete s.awaitingApproval;
  pane = ['⏺ Running tests…', '  esc to interrupt'];
  const ok = await sendReview({ review: review() });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(typed.length, 1);
  s.state = 'idle';
  pane = PANE_READY;
});

test('send-review: a comment path outside the lane diff is 400 and nothing is typed', async () => {
  typed.length = 0;
  const r = await sendReview({ review: review({ comments: [{ path: '/etc/passwd', line: 1, body: 'read me' }] }) });
  assert.equal(r.status, 400);
  assert.equal(r.code, 'bad_review');
  const r2 = await sendReview({ review: review({ comments: [{ path: 'a.txt\x1b[2J', line: 1, body: 'x' }] }) });
  assert.equal(r2.status, 400);
  assert.equal(typed.length, 0);
});

test('send-review: strict args', async () => {
  typed.length = 0;
  const many = Array.from({ length: 101 }, () => ({ path: 'a.txt', line: 1, body: 'x' }));
  const cases = [
    { review: review({ comments: many }) },
    { review: review({ base: '--output=/tmp/x' }) },
    { review: review({ base: 'origin/main;rm' }) },
    { review: review({ mergeBase: '$(id)' }) },
    { review: review({ headSha: 'HEAD' }) },
    { review: review({ comments: [{ path: 'a.txt', line: 0, body: 'x' }] }) },
    { review: review({ comments: [{ path: 'a.txt', line: 5, endLine: 2, body: 'x' }] }) },
    { review: review({ comments: [{ path: 'a.txt', line: 1, body: 'x', cmd: 'rm' }] }) },
    { review: review({ comments: [], note: '  ' }) },
    { review: review(), file: '/tmp/x' },
    { review: { ...review(), extra: 1 } },
    {},
  ];
  for (const args of cases) {
    const r = await sendReview(args);
    assert.equal(r.status, 400, JSON.stringify(args).slice(0, 200));
  }
  assert.equal(typed.length, 0);
});

test('send-review: unknown lane 404, bad lane id 400, hub without control 403', async () => {
  assert.equal((await sendReview({ review: review() }, { target: 'ghost' })).status, 404);
  assert.equal((await sendReview({ review: review() }, { target: '../x' })).status, 400);
  const hub = await sendReview({ review: review() }, { auth: { kind: 'hub', scopes: ['read'], keyLabel: 'k' } });
  assert.equal(hub.status, 403);
  assert.equal(hub.code, 'control-disabled');
});

test('send-review: a note-only review is typed', async () => {
  typed.length = 0;
  const r = await sendReview({ review: review({ comments: [], note: 'Rebase on main please.' }) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(typed[0].text, /0 comments\.[\s\S]*Rebase on main please\./);
});

test('writeReviewFile refuses a lane dir that is a symlink out of lanesDir', async () => {
  const lanesDir = path.join(tmp, 'lanes2');
  const elsewhere = path.join(tmp, 'elsewhere');
  fs.mkdirSync(lanesDir, { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.symlinkSync(elsewhere, path.join(lanesDir, 'lane9'));
  await assert.rejects(actionsMod.writeReviewFile(lanesDir, 'lane9', 'x', 1), (e) => e.code === 'review_dir');
  assert.deepEqual(fs.readdirSync(path.join(elsewhere, 'reviews')).length, 0);
  // two writes in the same ms get distinct files
  const a = await actionsMod.writeReviewFile(lanesDir, 'lane8', 'one', 7);
  const b = await actionsMod.writeReviewFile(lanesDir, 'lane8', 'two', 7);
  assert.notEqual(a, b);
  assert.equal(fs.readFileSync(b, 'utf8'), 'two');
});
