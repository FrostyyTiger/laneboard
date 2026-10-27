// A turn in the pane (cockpit spec c1-talk.md §3 "Streaming", protocols.md §3.1-§3.2,
// D270): public/js/cockpit/turns.js on the fake DOM. The page-level timing (B4, B8)
// is S-C1-04's (e2e/cockpit/c1-turn.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { createTurn, setDelivery, DELIVERY_WORDS, turnNode } from '../public/js/cockpit/turns.js';
import { newClientId } from '../public/js/cockpit/pane.js';

const AT = '2026-10-27T07:02:04.130+01:00';
const doc = () => makeDocument();
const kids = (n) => n.children;
const replyOf = (v) => kids(v.node).find((c) => c.attrs?.['data-reply'] !== undefined || c.className === 'ck-reply');
const labels = (v) => kids(v.node).filter((c) => c.className === 'ck-label');
const cursorOn = (v) => (replyOf(v)?.children ?? []).map((b) => b.classList.contains('ck-streaming'));

test('a prompt drawn at the tap reads YOU · HH:MM · SENDING until the echo, then the turn has its id', () => {
  const v = createTurn(doc(), { clientId: 'p-3c1e0b2a', prompt: 'how did the night go?', at: Date.parse(AT), delivery: 'sending' });
  assert.equal(v.turnId, null);
  assert.equal(v.node.attrs?.['data-turn-id'], undefined);
  const [you] = labels(v);
  assert.match(you.textContent, /^YOU · \d\d:\d\d · SENDING$/);
  assert.equal(you.children.at(-1).attrs['data-turn-delivery'], 'sending');
  v.confirm({ turnId: 't-0132', delivery: 'new' });
  assert.equal(v.turnId, 't-0132');
  assert.equal(v.node.attrs['data-turn-id'], 't-0132');
  assert.match(you.textContent, /^YOU · \d\d:\d\d$/, 'the delivery word and its separator go');
  assert.equal(you.children.length, 0);
});

test('a queued echo keeps the block and says QUEUED', () => {
  const v = createTurn(doc(), { clientId: 'p-00000001', prompt: 'and hv2?', at: AT, delivery: 'sending' });
  v.confirm({ turnId: 't-0132', delivery: 'queued' });
  assert.match(labels(v)[0].textContent, / · QUEUED$/);
});

test('setDelivery: each word of D270, and null leaves no span', () => {
  const d = doc();
  const row = d.createElement('div');
  row.textContent = 'YOU · 07:02';
  for (const [k, w] of Object.entries(DELIVERY_WORDS)) {
    setDelivery(d, row, k);
    assert.equal(row.textContent, `YOU · 07:02 · ${w}`);
    assert.equal(row.children.length, 2);
  }
  setDelivery(d, row, null);
  assert.equal(row.textContent, 'YOU · 07:02');
  setDelivery(d, row, 'bogus');
  assert.equal(row.children.length, 0);
});

test('deltas append once drawn, the cursor follows the streaming block, the complete block replaces', () => {
  const v = createTurn(doc(), { turnId: 't-1', prompt: 'how did the night go?', at: AT });
  assert.equal(replyOf(v), undefined, 'no reply before its first text');
  v.delta({ blockIndex: 0, text: 'Two ', sentAt: Date.parse(AT) + 300 });
  assert.equal(replyOf(v).textContent, '', 'kept until the frame draws it');
  v.draw();
  assert.equal(replyOf(v).textContent, 'Two ');
  assert.deepEqual(cursorOn(v), [true]);
  assert.match(labels(v)[1].textContent, /^AGENT · \d\d:\d\d$/);
  v.delta({ blockIndex: 0, text: 'of three finished.' }); // delta 4 lost
  v.draw();
  assert.equal(replyOf(v).textContent, 'Two of three finished.');
  v.block({ blockIndex: 0, text: 'Two of three runs finished.' });
  v.draw();
  assert.equal(replyOf(v).textContent, 'Two of three runs finished.', 'a lost delta cannot leave wrong text');
  assert.deepEqual(cursorOn(v), [false], 'the complete block ends the cursor');
  v.end({ state: 'done' });
  assert.equal(v.ended, true);
});

test('blocks sit by blockIndex whatever the order they come in, the cursor on the newest', () => {
  const v = createTurn(doc(), { turnId: 't-2', prompt: 'x', at: AT });
  v.delta({ blockIndex: 3, text: 'third' });
  v.delta({ blockIndex: 1, text: 'first' });
  v.draw();
  assert.deepEqual(replyOf(v).children.map((b) => b.textContent), ['first', 'third']);
  assert.deepEqual(cursorOn(v), [true, false]);
  v.end({ state: 'done' });
  assert.deepEqual(cursorOn(v), [false, false], 'turn.end takes the cursor away');
  v.delta({ blockIndex: 1, text: ' late' });
  v.draw();
  assert.equal(replyOf(v).children[0].textContent, 'first', 'nothing is appended after the end');
});

test('text goes in as text: markup in a delta stays its characters', () => {
  const v = createTurn(doc(), { turnId: 't-3', prompt: '<b>hi</b>', at: AT });
  v.delta({ blockIndex: 0, text: '<img src=x onerror=alert(1)>' });
  v.draw();
  assert.equal(replyOf(v).textContent, '<img src=x onerror=alert(1)>');
  assert.equal(replyOf(v).children[0].innerHTML, '');
});

test('a snapshot turn: prompt, reply blocks in order, the cursor only while it answers', () => {
  const turn = {
    turnId: 't-4', prompt: 'q', at: AT, state: 'answering',
    items: [{ kind: 'text', blockIndex: 2, text: 'b' }, { kind: 'text', blockIndex: 0, text: 'a' }],
  };
  const v = createTurn(doc(), turn);
  assert.deepEqual(replyOf(v).children.map((b) => b.textContent), ['a', 'b']);
  assert.deepEqual(cursorOn(v), [false, true]);
  const done = createTurn(doc(), { ...turn, state: 'done', end: { state: 'done', at: AT } });
  assert.deepEqual(cursorOn(done), [false, false]);
  assert.equal(turnNode(doc(), turn).attrs['data-turn-id'], 't-4');
});

test('newClientId: p- and 8 hex characters (protocols.md §3.1)', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const id = newClientId();
    assert.match(id, /^p-[0-9a-f]{8}$/);
    seen.add(id);
  }
  assert.ok(seen.size > 45);
  assert.equal(newClientId({ getRandomValues: (a) => a.fill(0xab) }), 'p-abababab');
});
