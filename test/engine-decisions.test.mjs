// Decisions through the dispatcher: rules, audit, identity, retries, every refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatch, _reset } from '../server/fleet/dispatch.mjs';
import { openAudit } from '../server/fleet/audit.mjs';
import { createLimiter } from '../server/fleet/ratelimit.mjs';
import { ENGINE_ACTIONS, registerEngineActions } from '../server/engine/actions.mjs';
import { createContractEngine, safeUser } from '../server/engine/adapter.mjs';
import { argsFor } from '../server/engine/foundry-cli.mjs';

const BID = 'builder-a';
const REV = 'sha256:8ed771e8d2fc03fd';
const T = 'main/R-1/recipe-2';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-decide-'));
let n = 0;
const DIRECT = { kind: 'direct', user: 'alice@example.invalid' };
const LOCAL = { kind: 'local', user: 'local' };

function world({ answer = (v, a, m) => ({ ok: true, verb: v, target: a.target, request: m.requestId, by: m.user, via: m.via, replayed: false }), kind = 'fake', hubControl = true } = {}) {
  _reset();
  const calls = [];
  const engine = { id: 'main', kind, act: async (v, a, m) => { calls.push({ v, a, m }); return answer(v, a, m); } };
  registerEngineActions({ engineOf: (id) => (id === 'main' ? engine : undefined) });
  const audit = openAudit({ file: path.join(tmp, `a-${++n}.jsonl`), builder: BID });
  const config = { fleet: { id: BID, hubControl } };
  const go = (action, target, args, auth = DIRECT, id = crypto.randomUUID()) => dispatch(
    { v: 1, id, ts: Date.now(), builder: BID, action, target, args, user: 'evil@example.invalid', via: 'direct' },
    { auth, deps: { config }, audit, limiter: createLimiter({}), config },
  );
  return { calls, audit, go };
}
const approve = (extra = {}) => ['engine-approve', T, { expect: REV, confirm: T, ...extra }];

test('approve sends the verb, the revision, the real user and the envelope id', async () => {
  const w = world();
  const id = crypto.randomUUID();
  const r = await w.go(...approve(), DIRECT, id);
  assert.equal(r.ok, true);
  assert.deepEqual(w.calls[0], { v: 'approve', a: { target: 'R-1/recipe-2', expect: REV }, m: { requestId: id, user: 'alice@example.invalid', via: 'laneboard' } });
});

test('the audit has the start before the outcome, also for a refusal', async () => {
  const w = world({ answer: () => ({ ok: false, code: 'refused', reason: 'no' }) });
  const r = await w.go(...approve());
  assert.equal(r.status, 403);
  const phases = w.audit.read({ since: 0 }).entries.map((e) => e.result.phase);
  assert.deepEqual(phases, ['start', 'done']);
});

test('remote-only: refused from the machine itself, before the engine is called', async () => {
  for (const [name, def] of Object.entries(ENGINE_ACTIONS)) {
    if (!def.remoteOnly) continue;
    const w = world();
    const r = await w.go(name, T, {}, LOCAL);
    assert.equal(r.code, 'remote-only', name);
    assert.equal(w.calls.length, 0);
  }
});

test('pause and resume work from the machine itself; stop does not', async () => {
  const w = world();
  assert.equal((await w.go('engine-pause', 'main/R-1', {}, LOCAL)).ok, true);
  assert.equal((await w.go('engine-resume', 'main/R-1', {}, LOCAL)).ok, true);
  assert.equal((await w.go('engine-stop', 'main/R-1', { confirm: 'main/R-1' }, LOCAL)).code, 'remote-only');
});

test('confirm must equal the target; bad args never reach the engine', async () => {
  const w = world();
  assert.equal((await w.go(...approve({ confirm: 'main/other' }))).code, 'confirm_required');
  assert.equal((await w.go('engine-approve', T, { expect: 'nope', confirm: T })).code, 'bad_args');
  assert.equal((await w.go('engine-reject', T, { expect: REV, confirm: T })).code, 'bad_args');
  assert.equal((await w.go('engine-reject', T, { expect: REV, confirm: T, why: '\u0001 ' })).code, 'bad_args');
  assert.equal(w.calls.length, 0);
});

test('a target must name an engine and something safe', async () => {
  const w = world();
  for (const t of ['*', 'main', '-x/y', 'main/-flag', 'main/a/../b', 'MAIN/x', 'main/a b']) {
    assert.equal((await w.go('engine-pause', t, {})).code, 'bad_target', t);
  }
  assert.equal((await w.go('engine-pause', 'other/R-1', {})).code, 'not-found');
  assert.equal(w.calls.length, 0);
});

test('the jsonl engine takes no decisions', async () => {
  const w = world({ kind: 'jsonl' });
  assert.equal((await w.go('engine-pause', 'main/R-1', {})).code, 'not-found');
  assert.equal(w.calls.length, 0);
});

test('a hub needs hub control and the control scope', async () => {
  const hub = (scopes) => ({ kind: 'hub', scopes: new Set(scopes), keyLabel: 'k', verified: true });
  assert.equal((await world({ hubControl: false }).go(...approve(), hub(['control']))).code, 'control-disabled');
  assert.equal((await world().go(...approve(), hub(['read']))).code, 'scope-missing');
  assert.equal((await world().go(...approve(), hub(['control']))).ok, true);
});

for (const [code, status] of [['not-found', 404], ['already-decided', 409], ['stale-revision', 409], ['refused', 403], ['busy', 409], ['engine-error', 502], ['engine-down', 503], ['timeout', 504], ['something-new', 403]]) {
  test(`engine answer ${code} is ${status}`, async () => {
    const r = await world({ answer: () => ({ ok: false, code, reason: 'because', current: 'sha256:0' }) }).go(...approve());
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.equal(r.code, code);
    assert.equal(r.error, 'because');
    assert.deepEqual(r.result, { current: 'sha256:0' });
  });
}

test('a retried id reaches the engine with the same request id and reports replayed', async () => {
  const seen = new Set();
  const w = world({ answer: (v, a, m) => { const replayed = seen.has(m.requestId); seen.add(m.requestId); return { ok: true, replayed }; } });
  const id = crypto.randomUUID();
  await w.go(...approve(), DIRECT, id);
  const again = await w.go(...approve(), DIRECT, id);
  assert.equal(again.result.replayed, true);
  assert.equal(w.calls[0].m.requestId, w.calls[1].m.requestId);
});

test('the reason is cleaned before it goes out', async () => {
  const w = world();
  await w.go('engine-reject', T, { expect: REV, confirm: T, why: ' too\u0007 big\r\nreally ' });
  assert.equal(w.calls[0].a.why, 'too big\nreally');
});

test('the CLI gets start and flags in the contract form, and a flag-like target is refused', () => {
  const meta = { user: 'a@example.invalid', via: 'laneboard', requestId: 'id-1' };
  assert.deepEqual(argsFor('start', { target: 'acme', goal: 'G1' }, meta).slice(0, 3), ['start', 'acme', 'G1']);
  assert.deepEqual(argsFor('approve', { target: 'R/1', expect: REV, choice: 'b' }, meta).slice(0, 6), ['approve', 'R/1', '--expect', REV, '--choice', 'b']);
  assert.throws(() => argsFor('pause', { target: '-x' }, meta));
});

test('a signed-in email is a valid decider; anything flag-like is not', () => {
  assert.ok(safeUser('alice@example.invalid'));
  assert.ok(safeUser('local'));
  for (const v of ['-x', '--by', 'a b', 'a..b', '', null]) assert.ok(!safeUser(v), String(v));
});

test('a write that times out is unknown, not down', async () => {
  const e = createContractEngine({
    id: 'x', kind: 'fake', timeoutMs: 20,
    call: (v) => (v === 'hello' ? JSON.parse(fs.readFileSync(new URL('./fixtures/engine/v1/hello.json', import.meta.url), 'utf8')) : new Promise(() => {})),
  });
  const r = await e.act('pause', { target: 'R-1' }, { requestId: crypto.randomUUID(), user: 'a', via: 'laneboard' });
  assert.equal(r.code, 'timeout');
});
