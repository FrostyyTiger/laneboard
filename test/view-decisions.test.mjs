// The page side of a decision: what is asked, what is sent, what is said.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionOutcome, runDecision } from '../public/js/views/engine-actions.js';
import { decisionPlans } from '../public/js/views/inbox-waiting.js';
import { runControls } from '../public/js/views/runs-engine.js';

const REV = 'sha256:8ed771e8d2fc03fd';
const item = (o) => ({ id: 'R-1/x', title: 'A thing', revision: REV, kind: 'recipe', content: {}, ...o });

function io(result, { okCard = true, text = 'because' } = {}) {
  const log = { cards: [], sends: [], said: [] };
  let n = 0;
  return { log, opts: {
    ask: async (a) => { log.cards.push(a); return { ok: okCard }; },
    askText: async () => text,
    send: async (action, target, args, o) => { log.sends.push({ action, target, args, id: o.id }); return typeof result === 'function' ? result() : result; },
    say: (t, o) => log.said.push([t, o.kind]),
    newId: () => `id-${++n}`,
  } };
}

test('approve shows a one-button card with the revision and carries confirm', async () => {
  const { log, opts } = io({ ok: true });
  await runDecision(decisionPlans(item(), 'main')[0], opts);
  assert.equal(log.cards[0].tier, 'ask');
  assert.ok(log.cards[0].consequence.includes(`revision ${REV}`));
  assert.deepEqual(log.sends[0].args, { expect: REV, confirm: 'main/R-1/x' });
  assert.equal(log.sends[0].action, 'engine-approve');
});

test('cancel sends nothing', async () => {
  const { log, opts } = io({ ok: true }, { okCard: false });
  assert.equal(await runDecision(decisionPlans(item(), 'main')[0], opts), null);
  assert.equal(log.sends.length, 0);
});

test('reject asks why; an answer is shown back before it goes', async () => {
  const a = io({ ok: true });
  await runDecision(decisionPlans(item(), 'main')[1], a.opts);
  assert.equal(a.log.sends[0].args.why, 'because');
  const q = io({ ok: true }, { text: 'yes please' });
  await runDecision(decisionPlans(item({ kind: 'question', content: { question: 'Q?' } }), 'main')[0], q.opts);
  assert.ok(q.log.cards[0].consequence.includes('Your answer: yes please'));
  assert.deepEqual(q.log.sends[0].args, { text: 'yes please' });
});

test('a variant picks by option id', () => {
  const plans = decisionPlans(item({ kind: 'variant', content: { options: [{ id: 'a', title: 'One' }, { id: 'b' }] } }), 'main');
  assert.deepEqual(plans.map((p) => p.label), ['Pick One', 'Pick b', 'Reject']);
  assert.equal(plans[1].args.choice, 'b');
});

test('after an unknown outcome the same id is sent again, then forgotten', async () => {
  const answers = [{ ok: 'unknown' }, { ok: true, result: { replayed: true } }, { ok: true }];
  const { log, opts } = io(() => answers.shift());
  const plan = decisionPlans(item({ id: 'R-2/y' }), 'main')[0];
  await runDecision(plan, opts);
  await runDecision(plan, opts);
  await runDecision(plan, opts);
  assert.equal(log.sends[0].id, log.sends[1].id);
  assert.notEqual(log.sends[1].id, log.sends[2].id);
  assert.match(log.said[1][0], /already gone through/);
});

test('each failure says what happened', () => {
  const text = (code) => decisionOutcome('approve', { ok: false, code, error: 'e' }).text;
  assert.match(text('remote-only'), /normal sign-in/);
  assert.match(text('stale-revision'), /changed since/);
  assert.match(text('already-decided'), /already decided/);
  assert.match(text('engine-down'), /not sent/);
  assert.match(text('timeout'), /may have gone through/);
  assert.equal(decisionOutcome('x', { ok: false, code: 'timeout' }).retry, true);
  assert.equal(decisionOutcome('x', { ok: false, code: 'refused', error: 'e' }).retry, undefined);
});

test('run controls follow the state', () => {
  const labels = (state) => runControls('main/R-1', { state }).map((c) => c.label);
  assert.deepEqual(labels('running'), ['Pause', 'Stop']);
  assert.deepEqual(labels('at-gate'), ['Pause', 'Stop']);
  assert.deepEqual(labels('paused'), ['Resume', 'Stop']);
  assert.deepEqual(labels('waiting-approval'), ['Stop']);
  assert.deepEqual(labels('done'), []);
  assert.deepEqual(labels('stopped'), []);
});

test('a decision names the builder the server says it is, on /api/v1/actions', async () => {
  const { createActions } = await import('../public/js/core/actions.js');
  const posts = [];
  const res = (b) => ({ ok: true, status: 200, json: async () => b });
  const fetchImpl = async (url, init) => {
    if (url === '/api/v1/hello') return res({ id: 'demo', capabilities: ['actions'] });
    posts.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return res({ ok: true, result: {} });
  };
  const a = createActions({ store: { source: { kind: 'local', hello: null, id: null }, builders: new Map(), sessions: new Map() }, fetchImpl });
  await a.actEngine('engine-pause', 'main/R-1', {}, { id: 'abc' });
  assert.equal(posts[0].url, '/api/v1/actions');
  assert.equal(posts[0].body.builder, 'demo');
  assert.equal(posts[0].body.id, 'abc');
  const hub = createActions({ store: { source: { kind: 'hub' }, builders: new Map(), sessions: new Map() }, fetchImpl });
  assert.equal((await hub.actEngine('engine-pause', 'main/R-1')).code, 'unsupported');
});
