import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The approvals core logs to the db: keep a targeted run (`node --test
// test/approvals.test.mjs`) off the real database and config, as `npm test` does.
process.env.LANEBOARD_DB ??= ':memory:';
process.env.LANEBOARD_CONFIG ??= fileURLToPath(new URL('./fixtures/empty-config.json', import.meta.url));
const approvals = await import('../server/control/approvals.mjs');
const { ActionError } = await import('../server/actions.mjs');
const db = await import('../server/db.mjs');

const SID = '0b5e9d3a-1c2f-4e7a-9b8d-123456789abc';
const SID2 = '7f00aa11-2222-4333-8444-555566667777';

function body(over = {}) {
  return {
    session_id: SID,
    transcript_path: '/tmp/x.jsonl',
    cwd: '/nonexistent-lb-cwd',
    permission_mode: 'default',
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'rm -rf build', description: 'clean' },
    permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }],
    ...over,
  };
}
const opts = (over = {}) => ({
  timeoutMs: 60_000,
  nameOf: (sid) => (sid === SID ? 'lane-a' : sid === SID2 ? 'lane-b' : null),
  laneOf: (name) => (name === 'lane-a' ? 'a' : null),
  builder: 'builder-a',
  ...over,
});

test.beforeEach(() => approvals._reset());
test.after(() => approvals._reset());

function rejects(fn, status) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.equal(err.status, status);
    return true;
  });
}

test('open creates a pending entry with a truncated input, kept as plain text', () => {
  const big = '<b>' + 'x'.repeat(10_000) + '</b>';
  const { approval, wait } = approvals.open(body({ tool_input: { command: big } }), opts({ now: 1000 }));
  assert.ok(wait instanceof Promise);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.session, 'lane-a');
  assert.equal(approval.lane, 'a');
  assert.equal(approval.sessionId, SID);
  assert.equal(approval.builder, 'builder-a');
  assert.equal(approval.tool, 'Bash');
  assert.equal(approval.permissionMode, 'default');
  assert.equal(approval.createdAt, 1000);
  assert.equal(approval.expiresAt, 61_000);
  assert.ok(Buffer.byteLength(approval.input) <= 4096);
  assert.equal(approval.inputTruncated, true);
  assert.ok(approval.input.startsWith('{"command":"<b>xxx'), 'plain JSON text, nothing escaped');
  assert.ok(!approval.input.includes('&lt;'));
  assert.equal(approval.summary.length <= 200, true);
  assert.equal(approval.preview.kind, 'text');
  assert.equal(approval.suggestions.length, 1);
  assert.match(approval.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(approvals.pending().map((a) => a.id), [approval.id]);
  assert.equal(approvals.get(approval.id).status, 'pending');

  const small = approvals.open(body({ session_id: SID2 }), opts()).approval;
  assert.equal(small.input, JSON.stringify(body().tool_input));
  assert.equal(small.inputTruncated, false);
  assert.equal(small.lane, null);
});

test('open validates the body and bounds what it keeps', () => {
  rejects(() => approvals.open(null, opts()), 400);
  rejects(() => approvals.open([], opts()), 400);
  rejects(() => approvals.open(body({ tool_name: undefined }), opts()), 400);
  rejects(() => approvals.open(body({ hook_event_name: 'PreToolUse' }), opts()), 400);
  const a = approvals.open(body({
    session_id: '../../etc',
    tool_name: 'Bash\u001b[31m',
    cwd: 'c'.repeat(10_000),
    permission_suggestions: [1, 'x', { big: 'y'.repeat(10_000) }, { ok: true }],
  }), opts({ nameOf: () => { throw new Error('boom'); } })).approval;
  assert.equal(a.sessionId, null, 'an unsafe session id is dropped');
  assert.equal(a.session, null);
  assert.ok(!a.tool.includes('\u001b'));
  assert.ok(a.cwd.length <= 4096);
  assert.deepEqual(a.suggestions, [{ ok: true }]);
  // a returned approval is a copy
  a.status = 'allowed';
  assert.equal(approvals.get(a.id).status, 'pending');
});

test('decide(allow) resolves wait with the exact hookOutput JSON', async () => {
  const { approval, wait } = approvals.open(body(), opts());
  const events = [];
  approvals.onChange((m) => events.push(m));
  const closed = approvals.decide(approval.id, { behavior: 'allow' }, 'user@example.invalid');
  assert.equal(closed.status, 'allowed');
  assert.equal(closed.decidedBy, 'user@example.invalid');
  assert.ok(closed.decidedAt > 0);
  const d = await wait;
  assert.equal(d.behavior, 'allow');
  const expected = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.equal(d.output, expected);
  assert.equal(approvals.hookOutput(d, 'user@example.invalid'), expected);
  assert.deepEqual(JSON.parse(d.output).hookSpecificOutput.decision, { behavior: 'allow' });
  assert.deepEqual(approvals.pending(), []);
  assert.deepEqual(events.map((e) => [e.op, e.approval.status]), [['close', 'allowed']]);
});

test('deny carries message and interrupt', async () => {
  const { approval, wait } = approvals.open(body(), opts());
  approvals.decide(approval.id, { behavior: 'deny', note: 'use the\nscratch dir', interrupt: true }, { user: 'op' });
  const d = await wait;
  const out = JSON.parse(d.output);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PermissionRequest');
  assert.deepEqual(out.hookSpecificOutput.decision, {
    behavior: 'deny', message: 'Denied by op via laneboard: use the scratch dir', interrupt: true,
  });
  assert.equal(approvals.get(approval.id).status, 'denied');
  assert.equal(approvals.get(approval.id).note, 'use the scratch dir');

  const b = approvals.open(body(), opts());
  approvals.decide(b.approval.id, { behavior: 'deny' }, 'op');
  assert.deepEqual(JSON.parse((await b.wait).output).hookSpecificOutput.decision,
    { behavior: 'deny', message: 'Denied by op via laneboard', interrupt: false });
});

test('a second decide → 409; unknown id → 404; bad behavior → 400', () => {
  const { approval } = approvals.open(body(), opts());
  approvals.decide(approval.id, { behavior: 'allow' }, 'op');
  rejects(() => approvals.decide(approval.id, { behavior: 'deny' }, 'op'), 409);
  rejects(() => approvals.decide('nope', { behavior: 'allow' }, 'op'), 404);
  const b = approvals.open(body(), opts()).approval;
  rejects(() => approvals.decide(b.id, { behavior: 'maybe' }, 'op'), 400);
  rejects(() => approvals.decide(undefined, { behavior: 'allow' }, 'op'), 400);
  assert.equal(approvals.get(b.id).status, 'pending');
});

test('decide refuses a target/approval mismatch (409) and the approval stays pending', async () => {
  const { approval, wait } = approvals.open(body(), opts());
  rejects(() => approvals.decide(approval.id, { behavior: 'allow', target: 'lane-b' }, 'op'), 409);
  assert.equal(approvals.get(approval.id).status, 'pending');
  // an approval whose session name is unknown matches no target
  const anon = approvals.open(body({ session_id: 'ffffffff-0000-4000-8000-000000000000' }), opts()).approval;
  rejects(() => approvals.decide(anon.id, { behavior: 'allow', target: 'lane-a' }, 'op'), 409);
  rejects(() => approvals.decide(anon.id, { behavior: 'allow', target: null }, 'op'), 409);
  // the right target works
  approvals.decide(approval.id, { behavior: 'allow', target: 'lane-a' }, 'op');
  assert.equal((await wait).behavior, 'allow');
});

test('timeout → wait resolves null, status timeout, hookOutput \'\'', async () => {
  const events = [];
  approvals.onChange((m) => events.push(m));
  const { approval, wait } = approvals.open(body(), opts({ timeoutMs: 20 }));
  const d = await wait;
  assert.equal(d, null);
  assert.equal(approvals.hookOutput(d), '');
  assert.equal(approvals.get(approval.id).status, 'timeout');
  assert.deepEqual(approvals.pending(), []);
  assert.deepEqual(events.map((e) => e.op), ['open', 'close']);
  rejects(() => approvals.decide(approval.id, { behavior: 'allow' }, 'op'), 409);
});

test('onTimeout:\'deny\' gives deny JSON', async () => {
  const { approval, wait } = approvals.open(body(), opts({ timeoutMs: 20, onTimeout: 'deny' }));
  const d = await wait;
  const out = JSON.parse(d.output);
  assert.equal(out.hookSpecificOutput.decision.behavior, 'deny');
  assert.match(out.hookSpecificOutput.decision.message, /^Denied by laneboard via laneboard: no decision within/);
  assert.equal(out.hookSpecificOutput.decision.interrupt, false);
  const a = approvals.get(approval.id);
  assert.equal(a.status, 'timeout');
  assert.equal(a.decidedBy, 'laneboard');
});

test('release → \'\' immediately', async () => {
  const { approval, wait } = approvals.open(body(), opts());
  const t0 = Date.now();
  const a = approvals.decide(approval.id, { behavior: 'release', note: 'ignored' }, 'op');
  assert.equal(a.status, 'released');
  const d = await wait;
  assert.ok(Date.now() - t0 < 100);
  assert.equal(d.behavior, 'release');
  assert.equal(d.output, '');
  assert.equal(approvals.hookOutput(d, 'op'), '');
  assert.equal(approvals.hookOutput(null), '');
  assert.equal(approvals.hookOutput({ behavior: 'weird' }), '');
});

test('supersede(sessionId) closes the pending ones of that session only', async () => {
  const a = approvals.open(body(), opts());
  const b = approvals.open(body(), opts());
  const c = approvals.open(body({ session_id: SID2 }), opts());
  const closed = approvals.supersede(SID, 'PostToolUse');
  assert.deepEqual(closed.map((x) => x.id).sort(), [a.approval.id, b.approval.id].sort());
  assert.equal(await a.wait, null);
  assert.equal(await b.wait, null);
  assert.equal(approvals.get(a.approval.id).status, 'superseded');
  assert.equal(approvals.get(a.approval.id).note, 'PostToolUse');
  assert.deepEqual(approvals.pending().map((x) => x.id), [c.approval.id]);
  assert.deepEqual(approvals.supersede(SID), []);
  assert.deepEqual(approvals.supersede(null), []);
});

test('abandon closes with status abandoned and no decision', async () => {
  const { approval, wait } = approvals.open(body(), opts());
  assert.equal(approvals.abandon(approval.id).status, 'abandoned');
  assert.equal(await wait, null);
  assert.equal(approvals.abandon(approval.id), null);
  rejects(() => approvals.decide(approval.id, { behavior: 'allow' }, 'op'), 409);
});

test('pending is oldest first; onChange unsubscribes; a throwing listener is harmless', () => {
  const seen = [];
  approvals.onChange(() => { throw new Error('listener'); });
  const off = approvals.onChange((m) => seen.push(m.op));
  const late = approvals.open(body(), opts({ now: 2000 })).approval;
  const early = approvals.open(body(), opts({ now: 1000 })).approval;
  assert.deepEqual(approvals.pending().map((a) => a.id), [early.id, late.id]);
  off();
  approvals.decide(early.id, { behavior: 'allow' }, 'op');
  assert.deepEqual(seen, ['open', 'open']);
});

test('pending count is capped (429 falls through to the dialog)', () => {
  for (let i = 0; i < approvals.APPROVAL_LIMITS.maxPending; i++) approvals.open(body(), opts());
  rejects(() => approvals.open(body(), opts()), 429);
});

test('every open and close is written as an approval event', () => {
  const { approval } = approvals.open(body(), opts());
  approvals.decide(approval.id, { behavior: 'deny', note: 'n' }, 'op');
  const ev = db.listEvents({ type: 'approval', limit: 500 })
    .filter((e) => e.payload?.id === approval.id);
  assert.deepEqual(ev.map((e) => e.subtype).sort(), ['denied', 'pending']);
  assert.ok(ev.every((e) => e.session_name === 'lane-a' && e.session_id === SID));
  assert.ok(ev.every((e) => !('input' in e.payload)), 'events stay small: no tool input');
});

test('truncateBytes never splits a UTF-8 character', () => {
  const { text, truncated } = approvals.truncateBytes('é'.repeat(5000), 4096);
  assert.equal(truncated, true);
  assert.ok(Buffer.byteLength(text) <= 4096);
  assert.ok(!text.includes('�'));
});

// --- fail-open of the hook command (§8 2.2), against real sockets ---

const HAS_CURL = spawnSync('curl', ['--version'], { stdio: 'ignore' }).status === 0;
const NEEDS_CURL = HAS_CURL ? false : 'curl is not installed';

const hdrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-approvals-'));
test.after(() => fs.rmSync(hdrDir, { recursive: true, force: true }));
const HEADER = path.join(hdrDir, 'hook.header');
fs.writeFileSync(HEADER, 'X-Laneboard-Hook: ' + '0'.repeat(64) + '\n', { mode: 0o600 });

/** The PermissionRequest hook command of the plan, rendered for a port and -m. */
function hookCommand(port, maxSec) {
  return `curl -sf --connect-timeout 1 -m ${maxSec} -H @${HEADER} ` +
    `-H 'content-type: application/json' --data-binary @- ` +
    `http://127.0.0.1:${port}/api/hook/permission || true`;
}

function runHook(port, maxSec) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('sh', ['-c', hookCommand(port, maxSec)], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 }));
    child.stdin.end(JSON.stringify(body()));
  });
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('fail-open: nothing listening → exit 0, empty stdout, < 1.5 s', { skip: NEEDS_CURL }, async () => {
  const srv = await listen(() => {});
  const { port } = srv.address();
  await new Promise((r) => srv.close(r)); // the port is now unused
  const r = await runHook(port, 2);
  assert.equal(r.code, 0);
  assert.equal(r.out, '');
  assert.ok(r.ms < 1500, `took ${r.ms} ms`);
});

test('fail-open: a server that accepts but never answers → exit 0, empty stdout within -m 2', { skip: NEEDS_CURL }, async () => {
  const held = [];
  const srv = await listen((req, res) => { held.push(res); });
  try {
    const r = await runHook(srv.address().port, 2);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
    assert.ok(r.ms < 3000, `took ${r.ms} ms`);
  } finally {
    for (const res of held) res.destroy();
    srv.closeAllConnections?.();
    await new Promise((r) => srv.close(r));
  }
});

test('fail-open: a 403 with a body → exit 0, empty stdout; 200 passes the decision through', { skip: NEEDS_CURL }, async () => {
  let reply = { status: 403, text: 'forbidden' };
  const srv = await listen((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(reply.text); });
  });
  try {
    const r = await runHook(srv.address().port, 2);
    assert.equal(r.code, 0);
    assert.equal(r.out, '');
    const allow = approvals.hookOutput({ behavior: 'allow' }, 'op');
    reply = { status: 200, text: allow };
    const ok = await runHook(srv.address().port, 2);
    assert.equal(ok.code, 0);
    assert.equal(ok.out, allow);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
