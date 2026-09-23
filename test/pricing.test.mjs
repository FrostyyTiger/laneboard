import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { config } from '../server/config.mjs';

import { priceFor, normaliseUsage, cost, costByModel, addUsage, EMPTY_USAGE, isEmptyUsage } from '../server/pricing.mjs';
import { applyLine, userPromptText, assistantText, report, transcriptPathFor } from '../server/collector/transcripts.mjs';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

test('priceFor maps every model family', () => {
  assert.equal(priceFor('claude-opus-5').key, 'opus');
  assert.equal(priceFor('claude-opus-4-1').key, 'opus');
  assert.equal(priceFor('claude-sonnet-5').key, 'sonnet5');
  assert.equal(priceFor('claude-sonnet-4-6').key, 'sonnet4');
  assert.equal(priceFor('claude-sonnet-4-5').key, 'sonnet4');
  assert.equal(priceFor('claude-haiku-4-5-20251001').key, 'haiku45');
  assert.equal(priceFor('claude-fable-5').key, 'fable5');
});

test('the [1m] suffix does not change the price row', () => {
  // No long-context premium on 4.6+; opus[1m] is still opus rates.
  assert.equal(priceFor('claude-opus-5[1m]').key, 'opus');
  assert.equal(priceFor('claude-opus-5[1m]').pricedAsOpus, false);
});

test('an unknown model is priced as opus and flagged', () => {
  const p = priceFor('claude-something-9');
  assert.equal(p.key, 'opus');
  assert.equal(p.pricedAsOpus, true);
  assert.equal(priceFor('').pricedAsOpus, true);
  assert.equal(priceFor(undefined).pricedAsOpus, true);
});

test('normaliseUsage prefers the explicit 1h/5m cache split', () => {
  const u = normaliseUsage({
    input_tokens: 2,
    output_tokens: 396,
    cache_read_input_tokens: 22078,
    cache_creation_input_tokens: 15184,
    cache_creation: { ephemeral_1h_input_tokens: 15184, ephemeral_5m_input_tokens: 0 },
  });
  assert.deepEqual(u, { input: 2, output: 396, cacheRead: 22078, cacheWrite5m: 0, cacheWrite1h: 15184 });
});

test('without the split, all cache creation counts as a 5m write', () => {
  const u = normaliseUsage({ cache_creation_input_tokens: 1000 });
  assert.equal(u.cacheWrite5m, 1000);
  assert.equal(u.cacheWrite1h, 0);
});

test('a cache_creation total larger than its parts keeps the remainder', () => {
  // Guards against a future third cache tier silently vanishing from the bill.
  const u = normaliseUsage({
    cache_creation_input_tokens: 1000,
    cache_creation: { ephemeral_1h_input_tokens: 400, ephemeral_5m_input_tokens: 100 },
  });
  assert.equal(u.cacheWrite1h, 400);
  assert.equal(u.cacheWrite5m, 600);
});

test('normaliseUsage ignores junk and negative numbers', () => {
  assert.deepEqual(normaliseUsage(null), EMPTY_USAGE());
  assert.deepEqual(normaliseUsage({ input_tokens: -5, output_tokens: 'x' }), EMPTY_USAGE());
});

test('cost prices a known opus usage block exactly', () => {
  const usage = normaliseUsage({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 1_000_000 },
  });
  // 5 + 25 + 0.5 + 10 + 6.25
  near(cost(usage, 'claude-opus-5').usd, 46.75);
});

test('cost prices haiku and fable from the same table', () => {
  const u = normaliseUsage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
  near(cost(u, 'claude-haiku-4-5').usd, 6);
  near(cost(u, 'claude-fable-5').usd, 60);
  near(cost(u, 'claude-sonnet-5').usd, 12);
});

test('costByModel sums models and skips all-zero usage', () => {
  const r = costByModel({
    'claude-opus-5': normaliseUsage({ output_tokens: 1_000_000 }),
    '<synthetic>': normaliseUsage({ input_tokens: 0, output_tokens: 0 }),
  });
  near(r.usd, 25);
  assert.equal(r.pricedAsOpus, false, '<synthetic> must not raise the flag');
  assert.equal('<synthetic>' in r.byModel, false);
});

test('costByModel does raise the flag for a genuinely unknown model', () => {
  const r = costByModel({ 'claude-brand-new': normaliseUsage({ output_tokens: 1_000_000 }) });
  assert.equal(r.pricedAsOpus, true);
  near(r.usd, 25);
});

test('isEmptyUsage and addUsage behave', () => {
  assert.equal(isEmptyUsage(EMPTY_USAGE()), true);
  assert.equal(isEmptyUsage(null), true);
  assert.equal(isEmptyUsage({ ...EMPTY_USAGE(), output: 1 }), false);
  const sum = addUsage(normaliseUsage({ input_tokens: 1 }), normaliseUsage({ input_tokens: 2, output_tokens: 5 }));
  assert.deepEqual(sum, { input: 3, output: 5, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
});

// --- transcript line handling ------------------------------------------------

function freshState() {
  return {
    path: '/x', sessionId: 's', offset: 0, partial: '',
    seenIds: new Set(), seenOrder: [], byModel: {}, todayByModel: {}, dayKey: null,
    lastUserPrompt: '', lastAssistant: '', lastAssistantAt: null, lines: 0, dupes: 0,
    parsing: false, dirty: false,
  };
}

const assistantLine = (id, out, extra = {}) => ({
  type: 'assistant',
  timestamp: '2020-01-01T00:00:00.000Z',
  message: { id, model: 'claude-opus-5', usage: { output_tokens: out }, content: [], ...extra },
});

test('duplicate message.ids are counted once', () => {
  // The real fixture: one line per content block, all carrying the same usage.
  const st = freshState();
  for (let i = 0; i < 5; i++) applyLine(st, assistantLine('msg_1', 1_000_000));
  applyLine(st, assistantLine('msg_2', 1_000_000));
  near(report(st).usd, 50);
  assert.equal(st.dupes, 4);
});

test('a 1h cache write is priced at the 1h rate', () => {
  const st = freshState();
  applyLine(st, {
    type: 'assistant',
    timestamp: '2020-01-01T00:00:00.000Z',
    message: {
      id: 'm',
      model: 'claude-opus-5',
      content: [],
      usage: {
        cache_creation_input_tokens: 1_000_000,
        cache_creation: { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 },
      },
    },
  });
  near(report(st).usd, 10); // 1h rate, not the 6.25 5m rate
});

test('an all-zero synthetic message adds nothing and raises no flag', () => {
  const st = freshState();
  applyLine(st, { type: 'assistant', timestamp: '2020-01-01T00:00:00.000Z', message: { id: 's1', model: '<synthetic>', content: [], usage: { input_tokens: 0, output_tokens: 0 } } });
  const r = report(st);
  near(r.usd, 0);
  assert.equal(r.pricedAsOpus, false);
});

test('a line without usage or a message is skipped safely', () => {
  const st = freshState();
  applyLine(st, { type: 'assistant', message: { id: 'x', content: [] } });
  applyLine(st, { type: 'ai-title' });
  applyLine(st, null);
  applyLine(st, 'not an object');
  near(report(st).usd, 0);
});

test('the last user prompt ignores tool_result turns', () => {
  const st = freshState();
  applyLine(st, { type: 'user', message: { content: 'the real question' } });
  applyLine(st, { type: 'user', message: { content: [{ type: 'tool_result', content: 'output' }] } });
  assert.equal(st.lastUserPrompt, 'the real question');
});

test('userPromptText and assistantText read both content shapes', () => {
  assert.equal(userPromptText({ message: { content: 'hi' } }), 'hi');
  assert.equal(userPromptText({ message: { content: [{ type: 'text', text: 'hi' }] } }), 'hi');
  assert.equal(userPromptText({ message: { content: [{ type: 'tool_result' }] } }), null);
  assert.equal(assistantText({ message: { content: [{ type: 'thinking' }, { type: 'text', text: 'out' }] } }), 'out');
  assert.equal(assistantText({ message: { content: [{ type: 'tool_use' }] } }), null);
});

test('the last assistant reply is captured and truncated', () => {
  const st = freshState();
  applyLine(st, assistantLine('a', 1, { content: [{ type: 'text', text: 'x'.repeat(1000) }] }));
  assert.ok(st.lastAssistant.length <= 300);
});

test('the seen-id set stays bounded', () => {
  const st = freshState();
  for (let i = 0; i < 5200; i++) applyLine(st, assistantLine(`id_${i}`, 1));
  assert.ok(st.seenOrder.length <= 5000, `${st.seenOrder.length}`);
  assert.equal(st.seenIds.size, st.seenOrder.length);
});

test('transcriptPathFor prefers the statusline path', () => {
  assert.equal(transcriptPathFor({ transcriptPath: '/exact/path.jsonl', sessionId: 's', dir: '/d' }), '/exact/path.jsonl');
});

test('transcriptPathFor falls back to the encoded cwd', () => {
  assert.equal(
    transcriptPathFor({ sessionId: 'abc', dir: '/home/user' }),
    path.join(config.projectsDir, '-home-user', 'abc.jsonl')
  );
  assert.equal(transcriptPathFor({ sessionId: null, dir: '/d' }), null);
});
