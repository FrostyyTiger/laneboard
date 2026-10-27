// C4: POST /api/hook/permission intake, the hook token and GET /api/v1/approvals
// (fleet plan §8 2.2). Every token file lives under a temp state dir.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-c4-'));
process.env.LANEBOARD_STATE_DIR = path.join(tmpRoot, 'live-state');
process.env.LANEBOARD_AUDIT_FILE = path.join(tmpRoot, 'live-state', 'audit.jsonl');
process.on('exit', () => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const approvals = await import('../server/control/approvals.mjs');
const tokens = await import('../server/control/token.mjs');
const route = await import('../server/routes/approvals.mjs');
const hooks = await import('../server/collector/hooks.mjs');
const apiV1 = await import('../server/fleet/api-v1.mjs');
const { boot } = await import('./helpers/boot.mjs');

const NEEDS_CURL = spawnSync('curl', ['--version']).status === 0 ? false : 'curl not installed';
const SID = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';

let dirN = 0;
const freshDir = () => path.join(tmpRoot, `state-${++dirN}`);

function hookBody(over = {}) {
  return {
    session_id: SID,
    cwd: '/nonexistent-lb-cwd',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build' },
    ...over,
  };
}

const mode = (f) => fs.statSync(f).mode & 0o777;

// ---------------------------------------------------------------- token ----

test('ensureToken creates hook.token and hook.header with mode 0600 and is idempotent', () => {
  const dir = freshDir();
  const a = tokens.ensureToken(dir);
  assert.equal(a.created, true);
  assert.match(a.token, tokens.TOKEN_RE);
  assert.equal(mode(a.tokenFile), 0o600);
  assert.equal(mode(a.headerFile), 0o600);
  assert.equal(mode(dir), 0o700);
  assert.equal(fs.readFileSync(a.tokenFile, 'utf8'), `${a.token}\n`);
  assert.equal(fs.readFileSync(a.headerFile, 'utf8'), `X-Laneboard-Hook: ${a.token}\n`);
  const b = tokens.ensureToken(dir);
  assert.equal(b.created, false);
  assert.equal(b.token, a.token);
  assert.equal(tokens.readToken(dir), a.token);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['hook.header', 'hook.token'], 'no temp files left');
});

test('ensureToken replaces an unsafe or malformed token file and rewrites a stale header', () => {
  const dir = freshDir();
  const { token, tokenFile, headerFile } = tokens.ensureToken(dir);

  fs.chmodSync(tokenFile, 0o644); // readable by others: not trusted
  assert.equal(tokens.readToken(dir), null);
  const r1 = tokens.ensureToken(dir);
  assert.equal(r1.created, true);
  assert.notEqual(r1.token, token);
  assert.equal(mode(tokenFile), 0o600);

  fs.writeFileSync(headerFile, 'X-Laneboard-Hook: stale\n', { mode: 0o600 });
  assert.equal(tokens.ensureToken(dir).created, false);
  assert.equal(fs.readFileSync(headerFile, 'utf8'), tokens.headerLine(r1.token));

  fs.writeFileSync(tokenFile, 'not-a-token\n', { mode: 0o600 });
  assert.equal(tokens.readToken(dir), null);
  assert.equal(tokens.ensureToken(dir).created, true);

  // A planted symlink is never followed or written through.
  const target = path.join(tmpRoot, `elsewhere-${dirN}`);
  fs.writeFileSync(target, `${'a'.repeat(64)}\n`, { mode: 0o600 });
  fs.rmSync(tokenFile);
  fs.symlinkSync(target, tokenFile);
  assert.equal(tokens.readToken(dir), null);
  const r2 = tokens.ensureToken(dir);
  assert.equal(r2.created, true);
  assert.ok(!fs.lstatSync(tokenFile).isSymbolicLink());
  assert.equal(fs.readFileSync(target, 'utf8'), `${'a'.repeat(64)}\n`, 'symlink target untouched');
});

test('ensureToken refuses a relative state dir', () => {
  assert.throws(() => tokens.ensureToken('relative/dir'), TypeError);
});

test('the CLI creates the files for the installer and prints the header path', () => {
  const dir = freshDir();
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../server/control/token.mjs', import.meta.url)), dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(dir, 'hook.header'));
  assert.match(tokens.readToken(dir), tokens.TOKEN_RE);
  assert.ok(!r.stdout.includes(tokens.readToken(dir)), 'the token is never printed');
});

test('tokenMatches: exact token only, constant-time, never for malformed input', () => {
  const t = tokens.generateToken();
  assert.equal(tokens.tokenMatches(t, t), true);
  assert.equal(tokens.tokenMatches(` ${t.toUpperCase()} `, t), true);
  assert.equal(tokens.tokenMatches(tokens.generateToken(), t), false);
  assert.equal(tokens.tokenMatches(t.slice(1), t), false);
  assert.equal(tokens.tokenMatches(`${t}, ${t}`, t), false);
  assert.equal(tokens.tokenMatches(undefined, t), false);
  assert.equal(tokens.tokenMatches(['x'], t), false);
  assert.equal(tokens.tokenMatches(t, null), false);
  assert.equal(tokens.tokenMatches('', ''), false);
});

// --------------------------------------------------------- refuseReason ----

const TOK = tokens.generateToken();
function fakeReq({ headers = {}, auth, remote = '127.0.0.1', localPort = 7800 } = {}) {
  const h = { host: '127.0.0.1:7800', 'x-laneboard-hook': TOK, ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const rawHeaders = Object.entries(h).flat();
  const req = { headers: h, rawHeaders, socket: { remoteAddress: remote, localPort } };
  if (auth !== undefined) req.auth = auth;
  return req;
}
const reason = (req, over = {}) => route.refuseReason(req, { config: { fleet: { ingressPort: 7801 } }, token: TOK, ...over });

test('refuseReason accepts only local, loopback, header-free, token-carrying requests', () => {
  assert.equal(reason(fakeReq()), null);
  assert.equal(reason(fakeReq({ remote: '::1' })), null);
  assert.equal(reason(fakeReq({ remote: '::ffff:127.0.0.1' })), null);
  assert.equal(reason(fakeReq({ auth: { kind: 'local' } })), null);

  assert.equal(reason(fakeReq({ auth: { kind: 'direct', user: 'u@example.invalid' } })), 'not-local');
  assert.equal(reason(fakeReq({ auth: { kind: 'hub' } })), 'not-local');
  assert.equal(reason(fakeReq({ auth: 'local' })), 'not-local');
  assert.equal(reason(fakeReq({ localPort: 7801 })), 'ingress');
  assert.equal(reason(fakeReq({ remote: '192.0.2.7' })), 'not-loopback');
  assert.equal(reason(fakeReq({ remote: '::ffff:10.0.0.1' })), 'not-loopback');
  assert.equal(reason(fakeReq({ remote: null })), 'not-loopback');
  assert.equal(reason(fakeReq({ headers: { 'tailscale-user-login': 'u@example.invalid' } })), 'serve-header');
  assert.equal(reason(fakeReq({ headers: { 'x-forwarded-for': '127.0.0.1' } })), 'serve-header');
  assert.equal(reason(fakeReq({ headers: { 'x-forwarded-proto': 'https' } })), 'serve-header');
  assert.equal(reason(fakeReq({ headers: { forwarded: 'for=127.0.0.1' } })), 'serve-header');
  assert.equal(reason(fakeReq({ headers: { origin: 'http://127.0.0.1:7800' } })), 'origin');
  assert.equal(reason(fakeReq({ headers: { 'x-laneboard-hook': undefined } })), 'token');
  assert.equal(reason(fakeReq({ headers: { 'x-laneboard-hook': tokens.generateToken() } })), 'token');
  assert.equal(reason(fakeReq(), { token: null }), 'token', 'no token available → refused');
});

test('refuseReason sees serve headers a classifier stripped from req.headers, and refuses a repeated token header', () => {
  const r = fakeReq();
  r.rawHeaders.push('Tailscale-User-Login', 'u@example.invalid'); // still in rawHeaders only
  assert.equal(reason(r), 'serve-header');
  const d = fakeReq();
  d.rawHeaders.push('X-Laneboard-Hook', TOK);
  assert.equal(reason(d), 'token');
});

test('refuseReason re-reads a rotated token once', () => {
  const fresh = tokens.generateToken();
  const req = fakeReq({ headers: { 'x-laneboard-hook': fresh } });
  assert.equal(reason(req, { reload: () => fresh }), null);
  assert.equal(reason(req, { reload: () => null }), 'token');
});

// ------------------------------------------------------ HTTP, in process ----

/** A plain http server running the route's handlers (no F5 layer here; boot() below has it). */
async function serve(over = {}) {
  const dir = freshDir();
  const { token, headerFile } = tokens.ensureToken(dir);
  const conf = { approvals: { enabled: true, holdSec: 600, onTimeout: 'prompt', previewMaxLines: 300 }, fleet: { id: 'builder-a', code: 'BA' }, ...over.config };
  const h = route.createHandlers({
    config: () => conf,
    token: () => token,
    holdMs: over.holdMs ? () => over.holdMs : undefined,
    bodyReadMs: over.bodyReadMs,
    state: { sessionNameBySessionId: (sid) => (sid === SID ? 'lane-a' : null), get: (n) => (n === 'lane-a' ? { lane: 'a' } : null) },
    log: { warn() {}, error() {}, info() {} },
  });
  const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const srv = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === route.INTAKE_PATH) return h.intake(req, res);
    if (req.method === 'GET' && req.url === route.LIST_PATH) return h.list(req, res, json);
    json(res, { error: 'not found' }, 404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  if (over.ingressIsThisPort) conf.fleet.ingressPort = port;
  return {
    port, token, headerFile, conf, handlers: h,
    async close() { srv.closeAllConnections?.(); await new Promise((r) => srv.close(r)); },
  };
}

/** Raw request; resolves {status, body}. `signal` aborts. */
function post(port, { headers = {}, body = hookBody(), signal } = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: route.INTAKE_PATH, headers: { 'content-type': 'application/json', ...headers }, signal }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

async function getJson(port, p) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`);
  return r.json();
}

async function until(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('403 with an empty body for a wrong or missing token, tailscale-user-login, x-forwarded-for, or the ingress port; nothing is opened', async () => {
  approvals._reset();
  const s = await serve();
  try {
    const cases = [
      {},
      { 'x-laneboard-hook': tokens.generateToken() },
      { 'x-laneboard-hook': s.token, 'tailscale-user-login': 'u@example.invalid' },
      { 'x-laneboard-hook': s.token, 'x-forwarded-for': '127.0.0.1' },
      { 'x-laneboard-hook': s.token, origin: `http://127.0.0.1:${s.port}` },
    ];
    for (const headers of cases) {
      const r = await post(s.port, { headers });
      assert.equal(r.status, 403, JSON.stringify(Object.keys(headers)));
      assert.equal(r.body, '');
      assert.equal(r.headers['content-length'], '0');
    }
    assert.deepEqual(approvals.pending(), []);
  } finally { await s.close(); }

  const ing = await serve({ ingressIsThisPort: true });
  try {
    const r = await post(ing.port, { headers: { 'x-laneboard-hook': ing.token } });
    assert.equal(r.status, 403);
    assert.equal(r.body, '');
    assert.deepEqual(approvals.pending(), []);
  } finally { await ing.close(); }
});

test('a valid request is held, listed by GET /api/v1/approvals, and answered with allow JSON after approve', async () => {
  approvals._reset();
  const s = await serve();
  try {
    const p = post(s.port, { headers: { 'x-laneboard-hook': s.token } });
    const list = await until(async () => { const l = await getJson(s.port, route.LIST_PATH); return l.approvals.length ? l : null; });
    assert.deepEqual(list.builder, { id: 'builder-a', code: 'BA' });
    const a = list.approvals[0];
    assert.equal(a.status, 'pending');
    assert.equal(a.session, 'lane-a');
    assert.equal(a.lane, 'a');
    assert.equal(a.builder, 'builder-a');
    assert.equal(a.tool, 'Bash');
    approvals.decide(a.id, { behavior: 'allow', target: 'lane-a' }, 'op@example.invalid');
    const r = await p;
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
    assert.deepEqual((await getJson(s.port, route.LIST_PATH)).approvals, []);
  } finally { await s.close(); }
});

test('deny carries the message; release answers 200 with an empty body', async () => {
  approvals._reset();
  const s = await serve();
  try {
    let p = post(s.port, { headers: { 'x-laneboard-hook': s.token } });
    let a = await until(() => approvals.pending()[0]);
    approvals.decide(a.id, { behavior: 'deny', note: 'not now', interrupt: true }, 'op');
    let r = await p;
    const d = JSON.parse(r.body).hookSpecificOutput.decision;
    assert.equal(d.behavior, 'deny');
    assert.equal(d.message, 'Denied by op via laneboard: not now');
    assert.equal(d.interrupt, true);

    p = post(s.port, { headers: { 'x-laneboard-hook': s.token } });
    a = await until(() => approvals.pending()[0]);
    approvals.decide(a.id, { behavior: 'release' }, 'op');
    r = await p;
    assert.equal(r.status, 200);
    assert.equal(r.body, '');
  } finally { await s.close(); }
});

test('timeout answers 200 with an empty body (fall through to the prompt)', async () => {
  approvals._reset();
  const s = await serve({ holdMs: 150 });
  try {
    const r = await post(s.port, { headers: { 'x-laneboard-hook': s.token } });
    assert.equal(r.status, 200);
    assert.equal(r.body, '');
    assert.deepEqual(approvals.pending(), []);
  } finally { await s.close(); }
});

test('the client closing the connection abandons the approval', async () => {
  approvals._reset();
  const s = await serve();
  try {
    const ac = new AbortController();
    const p = post(s.port, { headers: { 'x-laneboard-hook': s.token }, signal: ac.signal }).catch((e) => e);
    const a = await until(() => approvals.pending()[0]);
    ac.abort();
    await p;
    await until(() => approvals.get(a.id)?.status === 'abandoned');
    assert.deepEqual(approvals.pending(), []);
  } finally { await s.close(); }
});

test('bad bodies and a disabled queue answer with an empty body and open nothing', async () => {
  approvals._reset();
  const s = await serve();
  try {
    const hdr = { 'x-laneboard-hook': s.token };
    let r = await post(s.port, { headers: hdr, body: '{not json' });
    assert.deepEqual([r.status, r.body], [400, '']);
    r = await post(s.port, { headers: hdr, body: hookBody({ hook_event_name: 'PreToolUse' }) });
    assert.deepEqual([r.status, r.body], [400, '']);
    r = await post(s.port, { headers: hdr, body: hookBody({ tool_name: undefined }) });
    assert.deepEqual([r.status, r.body], [400, '']);
    s.conf.approvals.enabled = false;
    r = await post(s.port, { headers: hdr });
    assert.deepEqual([r.status, r.body], [200, '']);
    assert.deepEqual(approvals.pending(), []);
  } finally { await s.close(); }
});

// ------------------------------------------------- SR15 H1: bounded intake --

/** A request whose body is streamed by the caller: returns {req, response}. */
function openStream(port, headers = {}) {
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: route.INTAKE_PATH, headers: { 'content-type': 'application/json', ...headers } });
  const response = new Promise((resolve) => {
    req.on('response', (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => resolve({ error: e.code || String(e) }));
  });
  req.flushHeaders();
  return { req, response };
}

test('body limits: default 256 KiB, configurable, clamped to 1 MiB', () => {
  assert.equal(route.BODY_LIMIT, 256 * 1024);
  assert.equal(route.bodyLimitOf({}), 256 * 1024);
  assert.equal(route.bodyLimitOf({ approvals: { maxBodyBytes: 64 * 1024 } }), 64 * 1024);
  assert.equal(route.bodyLimitOf({ approvals: { maxBodyBytes: 50 * 1024 * 1024 } }), 1024 * 1024);
  assert.equal(route.bodyLimitOf({ approvals: { maxBodyBytes: 'big' } }), 256 * 1024);
  assert.equal(route.maxInFlightOf({}), 16);
  assert.equal(route.maxInFlightOf({ approvals: { maxInFlight: 1000 } }), route.MAX_IN_FLIGHT_HARD);
  assert.equal(route.maxInFlightOf({ approvals: { maxInFlight: 0 } }), 1);
});

test('a body over the limit gets 413 with an empty body (declared or streamed) and opens nothing', async () => {
  approvals._reset();
  const s = await serve();
  try {
    const hdr = { 'x-laneboard-hook': s.token };
    const big = JSON.stringify(hookBody({ tool_input: { command: 'x'.repeat(300 * 1024) } }));
    let r = await post(s.port, { headers: hdr, body: big });
    assert.deepEqual([r.status, r.body], [413, '']);
    // Chunked, no Content-Length: refused as soon as it crosses the limit.
    const st = openStream(s.port, hdr);
    st.req.write(big.slice(0, 200 * 1024));
    st.req.end(big.slice(200 * 1024));
    r = await st.response;
    if (!r.error) assert.deepEqual([r.status, r.body], [413, '']);
    // A configured lower limit applies; a body under it is accepted.
    s.conf.approvals.maxBodyBytes = 2048;
    r = await post(s.port, { headers: hdr, body: hookBody({ tool_input: { command: 'y'.repeat(4096) } }) });
    assert.deepEqual([r.status, r.body], [413, '']);
    assert.deepEqual(approvals.pending(), []);
    assert.equal(s.handlers.inFlight(), 0);
    delete s.conf.approvals.maxBodyBytes;
    const ok = post(s.port, { headers: hdr, body: hookBody({ tool_input: { command: 'z'.repeat(200 * 1024) } }) });
    const a = await until(() => approvals.pending()[0]);
    approvals.decide(a.id, { behavior: 'release' }, 'op');
    assert.equal((await ok).status, 200);
  } finally { await s.close(); }
});

test('the in-flight semaphore answers 429 before reading the body; held requests do not count', async () => {
  approvals._reset();
  const s = await serve({ config: { approvals: { enabled: true, holdSec: 600, maxInFlight: 2 } } });
  try {
    const hdr = { 'x-laneboard-hook': s.token };
    const json = JSON.stringify(hookBody());
    const a = openStream(s.port, hdr);
    const b = openStream(s.port, hdr);
    a.req.write(json.slice(0, 10));
    b.req.write(json.slice(0, 10));
    await until(() => s.handlers.inFlight() === 2);
    // The third one never sends its body, yet is answered: refused before readBody.
    const c = openStream(s.port, hdr);
    const rc = await c.response;
    assert.deepEqual([rc.status, rc.body], [429, '']);
    c.req.destroy();
    assert.deepEqual(approvals.pending(), []);
    // Finishing the two opens them; once opened (held) they free their slots.
    a.req.end(json.slice(10));
    b.req.end(json.slice(10));
    await until(() => approvals.pending().length === 2);
    assert.equal(s.handlers.inFlight(), 0);
    const d = post(s.port, { headers: hdr });
    await until(() => approvals.pending().length === 3);
    for (const x of approvals.pending()) approvals.decide(x.id, { behavior: 'release' }, 'op');
    assert.deepEqual((await Promise.all([a.response, b.response, d])).map((r) => r.status), [200, 200, 200]);
  } finally { await s.close(); }
});

test('a body that never completes is dropped after the read deadline and frees its slot', async () => {
  approvals._reset();
  const s = await serve({ bodyReadMs: 100 });
  try {
    const st = openStream(s.port, { 'x-laneboard-hook': s.token });
    st.req.write('{"session_id":');
    await until(() => s.handlers.inFlight() === 1);
    await until(() => s.handlers.inFlight() === 0, 3000);
    st.req.destroy();
    assert.deepEqual(approvals.pending(), []);
  } finally { await s.close(); }
});

// ------------------------------------------------- the real curl hook ------

function runHook(port, headerFile, maxSec, payload = JSON.stringify(hookBody())) {
  const cmd = `curl -sf --connect-timeout 1 -m ${maxSec} -H @${headerFile} ` +
    `-H 'content-type: application/json' --data-binary @- ` +
    `http://127.0.0.1:${port}/api/hook/permission || true`;
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', cmd], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(payload);
  });
}

test('curl hook: allow JSON after approve, empty on timeout, empty (exit 0) on a 403', { skip: NEEDS_CURL }, async () => {
  approvals._reset();
  const s = await serve({ holdMs: 300 });
  try {
    // timeout
    let r = await runHook(s.port, s.headerFile, 5);
    assert.deepEqual(r, { code: 0, out: '' });
    // approve
    s.conf.approvals.holdSec = 600;
    const p = runHook(s.port, s.headerFile, 10);
    const a = await until(() => approvals.pending()[0]);
    approvals.decide(a.id, { behavior: 'allow' }, 'op');
    r = await p;
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).hookSpecificOutput.decision.behavior, 'allow');
    // wrong token file → 403 → empty stdout, exit 0
    const bad = path.join(freshDir() + '-hdr');
    fs.writeFileSync(bad, `X-Laneboard-Hook: ${tokens.generateToken()}\n`, { mode: 0o600 });
    r = await runHook(s.port, bad, 5);
    assert.deepEqual(r, { code: 0, out: '' });
  } finally { await s.close(); }
});

test('curl hook falls through (empty stdout, exit 0) on 413 and on 429', { skip: NEEDS_CURL }, async () => {
  approvals._reset();
  const s = await serve({ config: { approvals: { enabled: true, holdSec: 600, maxInFlight: 1 } } });
  try {
    const big = JSON.stringify(hookBody({ tool_input: { command: 'x'.repeat(300 * 1024) } }));
    let r = await runHook(s.port, s.headerFile, 5, big);
    assert.deepEqual(r, { code: 0, out: '' });
    const hold = openStream(s.port, { 'x-laneboard-hook': s.token });
    hold.req.write('{');
    await until(() => s.handlers.inFlight() === 1);
    r = await runHook(s.port, s.headerFile, 5);
    assert.deepEqual(r, { code: 0, out: '' });
    hold.req.destroy();
    assert.deepEqual(approvals.pending(), []);
  } finally { await s.close(); }
});

// ------------------------------------------------- module wiring ------------

test('the module registers both routes and the capability, supersedes on hook events and fans out approval messages', async () => {
  approvals._reset();
  apiV1._reset();
  const dir = freshDir();
  const routes = [];
  const sent = [];
  const ctx = {
    config: { stateDir: dir, approvals: { enabled: true, holdSec: 600 }, fleet: { id: 'builder-a' } },
    state: { sessionNameBySessionId: () => null, get: () => null },
    log: { warn() {}, error() {}, info() {} },
    ws: { send: (m) => sent.push(m) },
    json() {},
    route: (method, p) => routes.push(`${method} ${p}`),
  };
  const mod = route.default;
  assert.deepEqual(mod.modes, ['builder']);
  mod.register(ctx);
  assert.deepEqual(routes.sort(), ['GET /api/v1/approvals', 'POST /api/hook/permission']);
  assert.ok(apiV1.capabilityList().includes('approvals'));
  mod.start(ctx);
  try {
    assert.equal(mode(path.join(dir, 'hook.token')), 0o600);
    assert.equal(mode(path.join(dir, 'hook.header')), 0o600);

    const TP = '/nonexistent-lb/projects/x/session.jsonl';
    const { approval } = approvals.open(hookBody({ transcript_path: TP }), { timeoutMs: 60_000 });
    assert.deepEqual(sent.map((m) => [m.type, m.op, m.approval.id]), [['approval', 'open', approval.id]]);

    hooks.ingest({ hook_event_name: 'PreToolUse', session_id: SID, transcript_path: TP, tool_name: 'Bash', tool_input: {} });
    assert.equal(approvals.get(approval.id).status, 'pending', 'PreToolUse does not supersede');
    // SR15 L1: a forged collector event that knows only the session id cannot cancel it.
    hooks.ingest({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Bash', tool_input: {} });
    assert.equal(approvals.get(approval.id).status, 'pending', 'no transcript_path → no supersede');
    hooks.ingest({ hook_event_name: 'Stop', session_id: SID, transcript_path: '/nonexistent-lb/other.jsonl' });
    assert.equal(approvals.get(approval.id).status, 'pending', 'another transcript → no supersede');
    hooks.ingest({ hook_event_name: 'PostToolUse', session_id: SID, transcript_path: TP, tool_name: 'Bash', tool_input: {} });
    assert.equal(approvals.get(approval.id).status, 'superseded');
    assert.deepEqual(sent.map((m) => m.op), ['open', 'close']);
  } finally {
    mod.stop();
  }
  const { approval: b } = approvals.open(hookBody({ transcript_path: '/nonexistent-lb/t.jsonl' }), { timeoutMs: 60_000 });
  hooks.ingest({ hook_event_name: 'Stop', session_id: SID, transcript_path: '/nonexistent-lb/t.jsonl' });
  assert.equal(approvals.get(b.id).status, 'pending', 'after stop() nothing is subscribed');
  approvals._reset();
});

// ------------------------------------------------- a real laneboard ---------

test('booted builder: token 0600 in the state dir, 403 empty without it or with serve headers, held request listed and abandoned', { timeout: 30_000 }, async () => {
  const b = await boot();
  try {
    const stateDir = path.join(b.tmp, 'state', 'laneboard');
    const tokenFile = path.join(stateDir, 'hook.token');
    const headerFile = path.join(stateDir, 'hook.header');
    // ensureToken writes hook.token, then hook.header: wait for both.
    await until(() => fs.existsSync(tokenFile) && fs.existsSync(headerFile), 5000);
    assert.equal(mode(tokenFile), 0o600);
    assert.equal(mode(headerFile), 0o600);
    const token = tokens.readToken(stateDir);
    assert.match(token, tokens.TOKEN_RE);

    const host = { host: `127.0.0.1:${b.port}` };
    let r = await post(b.port, { headers: host });
    assert.deepEqual([r.status, r.body], [403, '']);
    r = await post(b.port, { headers: { ...host, 'x-laneboard-hook': token, 'tailscale-user-login': 'u@example.invalid' } });
    assert.deepEqual([r.status, r.body], [403, '']);
    r = await post(b.port, { headers: { ...host, 'x-laneboard-hook': token, 'x-forwarded-for': '127.0.0.1' } });
    assert.deepEqual([r.status, r.body], [403, '']);

    const hello = await getJson(b.port, '/api/v1/hello');
    assert.ok(hello.capabilities.includes('approvals'));

    const ac = new AbortController();
    const p = post(b.port, { headers: { ...host, 'x-laneboard-hook': token }, signal: ac.signal }).catch((e) => e);
    const held = await until(async () => { const l = await getJson(b.port, '/api/v1/approvals'); return l.approvals.length ? l.approvals : null; }, 5000);
    assert.equal(held.length, 1);
    assert.equal(held[0].tool, 'Bash');
    ac.abort();
    await p;
    await until(async () => (await getJson(b.port, '/api/v1/approvals')).approvals.length === 0, 5000);
  } finally {
    await b.stop();
  }
});
