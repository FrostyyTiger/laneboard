// The agent proposes, the owner decides (docs/cockpit-tools.md, propose).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';
import { boot, ROOM_UNDER_TEST, ROOT } from './helpers/boot.mjs';
import { createMcp } from '../server/cockpit/mcp.mjs';
import { checkMessage } from '../server/cockpit/protocol.mjs';
import { proposalPlan } from '../public/js/cockpit/propose.js';

const RUN = 'R-20261101-acme-shop-1';
const RECIPE = `${RUN}/recipe-2`;

async function setup(t, answer = { end: 'sent', ok: true }) {
  const b = await boot({ config: { engines: [{ id: 'demo', kind: 'fake' }] } });
  t.after(() => b.stop());
  const asked = [];
  const mcp = createMcp({ boardUrl: b.url, proposeTo: async (p) => { asked.push(p); return typeof answer === 'function' ? answer(p) : answer; } });
  return { asked, call: (args) => mcp.call('propose', args) };
}

const text = (r) => r.content[0].text;

test('an approve goes to the screen with the item read from the board; the yes is the answer', async (t) => {
  const { asked, call } = await setup(t);
  const r = await call({ item: RECIPE, decision: 'approve', why: 'The recipe matches the goal.' });
  assert.equal(r.isError, undefined);
  assert.match(text(r), /The owner said yes/);
  assert.deepEqual(asked, [{ engine: 'demo', item: RECIPE, decision: 'approve', choice: null, text: null, why: 'The recipe matches the goal.' }]);
});

test('no, a timeout and a failed send are said as they are; nothing claims success', async (t) => {
  for (const [out, re] of [
    [{ end: 'no' }, /^The owner said no\.$/],
    [{ end: 'timeout' }, /did not answer within 2 min/],
    [{ end: 'gone' }, /screen went away/],
    [{ end: 'sent', ok: false, text: 'reject cannot be sent from this machine itself.' }, /said yes, but it did not go through: reject cannot be sent/],
    [{ end: 'refused', text: 'No screen can show the proposal now.' }, /^No screen can show/],
  ]) {
    const { call } = await setup(t, out);
    const r = await call({ item: RECIPE, decision: 'reject', text: 'Too broad.', why: 'It touches billing.' });
    assert.equal(r.isError, true);
    assert.match(text(r), re);
  }
});

test('what an item cannot take is refused before any card', async (t) => {
  const { asked, call } = await setup(t);
  const cases = [
    [{ item: 'acme-shop:Q-3', decision: 'approve', why: 'x' }, /A question takes answer/],
    [{ item: 'acme-shop:Q-3', decision: 'answer', why: 'x' }, /answer needs text/],
    [{ item: `${RUN}/variant-1`, decision: 'pick', choice: 'v9', why: 'x' }, /choice must be one of: v1, v2/],
    [{ item: `${RUN}/variant-1`, decision: 'approve', why: 'x' }, /A variant takes pick/],
    [{ item: RECIPE, decision: 'pick', choice: 'v1', why: 'x' }, /Only a variant item takes pick/],
    [{ item: RECIPE, decision: 'stop', why: 'x' }, /For an item the decision is/],
    [{ item: 'nope-1', decision: 'approve', why: 'x' }, /Nothing waits as "nope-1"/],
    [{ run: 'R-20261024-acme-shop-1', decision: 'stop', why: 'x' }, /is done; it cannot stop now/],
    [{ run: RUN, decision: 'resume', why: 'x' }, /is running; it cannot resume now/],
    [{ item: RECIPE, run: RUN, decision: 'approve', why: 'x' }, /one of them/],
  ];
  for (const [args, re] of cases) {
    const r = await call(args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(text(r), re);
  }
  assert.deepEqual(asked, []);
  const ok = await call({ item: `demo/${RUN}/variant-1`, decision: 'pick', choice: 'v2', why: 'Cheaper.' });
  assert.equal(ok.isError, undefined);
  const stop = await call({ run: `demo/${RUN}`, decision: 'pause', why: 'It loops.' });
  assert.equal(stop.isError, undefined);
  assert.deepEqual(asked.map((p) => [p.decision, p.choice, p.item ?? p.run]), [['pick', 'v2', `${RUN}/variant-1`], ['pause', null, RUN]]);
});

test('without a room there is no card', async () => {
  const mcp = createMcp({ boardUrl: 'http://x', fetchImpl: async () => { throw new Error('never read'); } });
  const r = await mcp.call('propose', { item: RECIPE, decision: 'approve', why: 'x' });
  assert.match(text(r), /^No screen can show/);
});

test('the page builds the board\'s own plan, with the agent named and its why', () => {
  const item = { id: RECIPE, kind: 'recipe', title: 'Recipe for G1', revision: 'sha256:ab' };
  const msg = { engine: 'demo', item: RECIPE, run: null, decision: 'approve', choice: null, why: 'Fits the goal.' };
  const plan = proposalPlan(msg, { item });
  assert.equal(plan.action, 'engine-approve');
  assert.equal(plan.target, `demo/${RECIPE}`);
  assert.deepEqual(plan.args, { expect: 'sha256:ab' });
  assert.equal(plan.lines[0], 'Asked by the agent');
  assert.equal(plan.lines.at(-1), "Why, in the agent's words: Fits the goal.");
  const variant = { id: 'v', kind: 'variant', title: 'V', revision: 'r', content: { options: [{ id: 'v1', title: 'one' }, { id: 'v2', title: 'two' }] } };
  assert.equal(proposalPlan({ ...msg, item: 'v', decision: 'pick', choice: 'v2' }, { item: variant }).args.choice, 'v2');
  assert.equal(proposalPlan({ ...msg, item: 'v', decision: 'pick', choice: 'v3' }, { item: variant }), null);
  assert.equal(proposalPlan(msg, { item: null }), null, 'gone from the list: no card');
  const run = proposalPlan({ ...msg, item: null, run: RUN, decision: 'stop' }, { run: { state: 'running' } });
  assert.equal(run.action, 'engine-stop');
  assert.equal(run.target, `demo/${RUN}`);
  assert.equal(proposalPlan({ ...msg, item: null, run: RUN, decision: 'resume' }, { run: { state: 'running' } }), null);
});

test('the messages', () => {
  const open = { type: 'propose.open', proposalId: 'pr-0001', turnId: 't-0001', engine: 'demo', item: RECIPE, run: null, decision: 'approve', choice: null, text: null, why: 'w', openedAt: '2026-11-11T10:00:00.000+01:00', expiresAt: '2026-11-11T10:02:00.000+01:00' };
  assert.deepEqual(checkMessage(open, 'out'), { ok: true });
  assert.equal(checkMessage({ ...open, decision: 'release' }, 'out').ok, false);
  assert.deepEqual(checkMessage({ type: 'propose.end', proposalId: 'pr-0001', end: 'timeout' }, 'out'), { ok: true });
  assert.deepEqual(checkMessage({ type: 'propose.answer', seq: 3, proposalId: 'pr-0001', answer: 'sent', ok: true, code: null, text: 'approve: done' }, 'in'), { ok: true });
});

test('a real room: the card goes to the screen that asked; its answer ends the call; one audit line', { timeout: 60_000 }, async (t) => {
  const fakeDir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'lb-prop-'));
  t.after(() => fs.rmSync(fakeDir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(ROOT, 'test/cockpit/scripts/c1-render.json'), path.join(fakeDir, 'script.json'));
  const box = await boot({
    mode: 'builder', entry: ROOM_UNDER_TEST,
    config: { engines: [{ id: 'demo', kind: 'fake' }], cockpit: { mcp: { port: 0 }, agent: { command: [process.execPath, path.join(ROOT, 'test/cockpit/stand-ins/fake-agent.mjs')], env: ['FAKE_AGENT_DIR'], allowSameUser: true, loginCheck: null } } },
    env: { FAKE_AGENT_DIR: fakeDir },
  });
  t.after(() => box.stop());
  const mcpFile = path.join(box.stateDir, 'cockpit-agent/mcp.json');
  for (let i = 0; i < 200 && !fs.existsSync(mcpFile); i += 1) await new Promise((ok) => setTimeout(ok, 25));
  const { url, token } = box.mcp();
  const call = (args) => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'propose', arguments: args } }) }).then((r) => r.json());

  const ws = new WebSocket(`ws://127.0.0.1:${box.port}/api/cockpit/ws`, { origin: `http://127.0.0.1:${box.port}` });
  t.after(() => ws.terminate());
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d))));
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'hello', seq: 1, page: 'app', protocol: 1 }));
  for (let i = 0; i < 100 && !got.some((m) => m.type === 'welcome'); i += 1) await new Promise((ok) => setTimeout(ok, 20));

  const pending = call({ item: RECIPE, decision: 'approve', why: 'Fits the goal.' });
  let card = null;
  for (let i = 0; i < 200 && !card; i += 1) { card = got.find((m) => m.type === 'propose.open'); if (!card) await new Promise((ok) => setTimeout(ok, 25)); }
  assert.ok(card, 'the screen got the card');
  assert.deepEqual(checkMessage(card, 'out'), { ok: true });
  assert.equal(card.item, RECIPE);
  assert.equal(card.why, 'Fits the goal.');
  const second = await call({ item: RECIPE, decision: 'reject', text: 'no', why: 'x' });
  assert.match(second.result.content[0].text, /Another proposal is open/);
  ws.send(JSON.stringify({ type: 'propose.answer', seq: 2, proposalId: card.proposalId, answer: 'no', ok: false, code: null, text: null }));
  const r = await pending;
  assert.equal(r.result.content[0].text, 'The owner said no.');
  assert.ok(got.some((m) => m.type === 'propose.end' && m.end === 'no'));
  ws.send(JSON.stringify({ type: 'propose.answer', seq: 3, proposalId: card.proposalId, answer: 'sent', ok: true, code: null, text: null }));
  for (let i = 0; i < 100 && !got.some((m) => m.type === 'error' && m.re === 3); i += 1) await new Promise((ok) => setTimeout(ok, 20));
  assert.equal(got.find((m) => m.type === 'error' && m.re === 3)?.code, 'too-late');
  // The agent gives up on the call: the card goes.
  const gaveUp = new AbortController();
  const dropped = fetch(url, { method: 'POST', signal: gaveUp.signal, headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'propose', arguments: { item: RECIPE, decision: 'approve', why: 'again' } } }) }).catch(() => null);
  for (let i = 0; i < 200 && got.filter((m) => m.type === 'propose.open').length < 2; i += 1) await new Promise((ok) => setTimeout(ok, 25));
  gaveUp.abort();
  await dropped;
  for (let i = 0; i < 200 && !got.some((m) => m.type === 'propose.end' && m.end === 'gone'); i += 1) await new Promise((ok) => setTimeout(ok, 25));
  assert.ok(got.some((m) => m.type === 'propose.end' && m.end === 'gone'), 'the card went with the call');
  const auditFile = fs.readdirSync(box.stateDir, { recursive: true }).map(String).filter((f) => /audit/.test(f) && fs.statSync(path.join(box.stateDir, f)).isFile());
  const lines = auditFile.flatMap((f) => fs.readFileSync(path.join(box.stateDir, f), 'utf8').split('\n')).filter((l) => l.includes('cockpit.propose'));
  assert.equal(lines.length, 2, auditFile.join(','));
  assert.match(lines[0], /"status":"no"/);
  assert.match(lines[1], /"status":"gone"/);
});
