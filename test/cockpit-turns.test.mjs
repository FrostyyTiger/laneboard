// A turn in the pane (cockpit spec c1-talk.md §3 "Streaming", protocols.md §3.1-§3.2,
// D270): public/js/cockpit/turns.js on the fake DOM. The page-level timing (B4, B8)
// is S-C1-04's (e2e/cockpit/c1-turn.spec.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './helpers/fakedom.mjs';
import { createTurn, setDelivery, DELIVERY_WORDS, turnNode, firstSentenceDone } from '../public/js/cockpit/turns.js';
import { newClientId } from '../public/js/cockpit/pane.js';

const AT = '2026-10-27T07:02:04.130+01:00';
const doc = () => makeDocument();
const kids = (n) => n.children;
const replyOf = (v) => kids(v.node).find((c) => c.attrs?.['data-reply'] !== undefined || c.className === 'ck-reply');
const labels = (v) => kids(v.node).filter((c) => c.className === 'ck-label');
// The cursor sits on the element of the block's last character (md.js's blocks, reply.js).
const hasCursor = (n) => n.classList.contains('ck-streaming') || n.children.some(hasCursor);
const cursorOn = (v) => (replyOf(v)?.children ?? []).map(hasCursor);

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
  // A turn that started now: under 3 s its AGENT row carries no age (c1-talk.md §9).
  const at = new Date().toISOString();
  const v = createTurn(doc(), { turnId: 't-1', prompt: 'how did the night go?', at });
  assert.equal(replyOf(v), undefined, 'no reply before its first text');
  v.delta({ blockIndex: 0, text: 'Two ', sentAt: Date.parse(at) + 300 });
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
  v.draw(); // the pane's next frame
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

// Tool lines (c1-talk.md §5, §5.1, T20): placed by blockIndex, folded by the rule, drawn per frame.
const toolLines = (v) => (replyOf(v)?.children ?? []).filter((c) => c.attrs?.['data-tool-line'] !== undefined);
const wordsOfLine = (n) => n.children.find((c) => c.className === 'ck-tool-words').textContent;
const start = (blockIndex, id, tool, input, startedAt = AT) => ({ turnId: 't-1', blockIndex, toolUseId: id, tool, input, startedAt });

test('tool lines: a fold per tool, a new line for another tool, each at its first call\'s place', () => {
  const v = createTurn(doc(), { turnId: 't-1', prompt: 'how is the fleet?', at: AT });
  v.toolStart(start(0, 'tu-1', 'mcp__laneboard__fleet', { site: 'hv1' }));
  const [line] = toolLines(v);
  assert.equal(line.tagName, 'BUTTON');
  assert.equal(line.attrs.type, 'button');
  assert.equal(wordsOfLine(line), 'read the feed of hv1…', 'a new line comes with its words');
  assert.equal(line.attrs['data-running'], '', '● while the call runs');
  v.toolStart(start(1, 'tu-2', 'mcp__laneboard__fleet', { site: 'hv2' }));
  v.toolStart(start(2, 'tu-3', 'mcp__laneboard__ci', { branch: 'main' }));
  v.draw();
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['read 2 feeds…', 'looked at CI on main…']);
  v.toolEnd({ toolUseId: 'tu-3', endedAt: AT, isError: false, denied: false });
  v.toolEnd({ toolUseId: 'tu-2', endedAt: AT, isError: true, denied: false });
  v.draw();
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['read 2 feeds · 1 failed…', 'looked at CI on main']);
  assert.deepEqual(toolLines(v).map((n) => n.attrs['data-running'] !== undefined), [true, false]);
  // Text at a lower index arriving later sits above the lines (§5.1 "Place"); after text, a
  // fleet call starts a new line.
  v.block({ blockIndex: 3, text: 'hv1 is fine.' });
  v.toolStart(start(4, 'tu-4', 'mcp__laneboard__fleet', { site: 'hv3' }));
  v.draw();
  assert.equal(toolLines(v).length, 3, 'text between two calls of one tool: two lines');
  assert.deepEqual(replyOf(v).children.map((c) => (c.attrs?.['data-tool-line'] !== undefined ? 'tool' : 'text')), ['tool', 'tool', 'text', 'tool']);
  assert.equal(v.hasCall('tu-4'), true);
  assert.equal(v.hasCall('tu-9'), false);
  // The turn ends with tu-1 and tu-4 still running: their ● and … go (§5.1 turn.end).
  v.end({ state: 'done' });
  v.draw();
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['read 2 feeds · 1 failed', 'looked at CI on main', 'read the feed of hv3']);
  assert.deepEqual(toolLines(v).map((n) => n.attrs['data-running']), [undefined, undefined, undefined]);
});

test('tool lines from a snapshot turn: its tool items folded and ended as they were', () => {
  const item = (blockIndex, toolUseId, site, more = {}) => ({ kind: 'tool', blockIndex, toolUseId, tool: 'mcp__laneboard__fleet', input: { site }, startedAt: AT, ...more });
  const v = createTurn(doc(), {
    turnId: 't-2', prompt: 'check the sites', at: AT, state: 'done', end: { state: 'done', at: AT },
    items: [
      item(1, 'tu-2', 'hv2', { endedAt: AT, isError: true }),
      item(0, 'tu-1', 'hv1', { endedAt: AT, isError: false }),
      { kind: 'text', blockIndex: 2, text: 'hv2 did not answer.' },
    ],
  });
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['read 2 feeds · 1 failed']);
  assert.equal(replyOf(v).children.length, 2, 'one line, then the text');
});

test('a refused call is a `tried` line of its own, data-denied, even when its start had folded (§5.2, B156)', () => {
  const v = createTurn(doc(), { turnId: 't-1', prompt: 'clean up the logs', at: AT });
  v.toolStart(start(0, 'tu-1', 'Bash', { command: 'rm -rf /var/log/laneboard/old && echo done' }));
  v.toolStart(start(1, 'tu-2', 'Bash', { command: 'ls /var/log' }));
  v.draw();
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['ran rm -rf /var/log/laneboard/old……', 'ran ls /var/log…'], 'Bash never folds (the cut\'s …, then the running …, B152)');
  v.toolEnd({ toolUseId: 'tu-1', endedAt: AT, isError: true, denied: true });
  v.toolEnd({ toolUseId: 'tu-2', endedAt: AT, isError: true, denied: true });
  v.draw();
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['tried Bash, not allowed', 'tried Bash, not allowed']);
  assert.deepEqual(toolLines(v).map((n) => [n.attrs['data-denied'], n.attrs['data-running']]), [['true', undefined], ['true', undefined]]);

  // Three WebFetch calls in parallel fold at their starts; the middle one refused leaves the line.
  const w = createTurn(doc(), { turnId: 't-1', prompt: 'fetch them', at: AT });
  for (const [i, h] of ['a', 'b', 'c'].entries()) w.toolStart(start(i, `tu-${i}`, 'WebFetch', { url: `https://${h}.example.invalid/` }));
  w.draw();
  assert.deepEqual(toolLines(w).map(wordsOfLine), ['fetched 3 pages…']);
  w.toolEnd({ toolUseId: 'tu-1', endedAt: AT, isError: true, denied: true });
  w.draw();
  assert.deepEqual(toolLines(w).map(wordsOfLine), ['fetched 2 pages…', 'tried WebFetch, not allowed']);
  // The first refused: the line it stands in becomes the tried line, the rest move below it.
  const x = createTurn(doc(), { turnId: 't-1', prompt: 'fetch them', at: AT });
  for (const [i, h] of ['a', 'b'].entries()) x.toolStart(start(i, `tu-${i}`, 'WebFetch', { url: `https://${h}.example.invalid/` }));
  x.toolEnd({ toolUseId: 'tu-0', endedAt: AT, isError: true, denied: true });
  x.toolEnd({ toolUseId: 'tu-1', endedAt: AT, isError: false, denied: false });
  x.draw();
  assert.deepEqual(toolLines(x).map(wordsOfLine), ['tried WebFetch, not allowed', 'fetched a page from b.example.invalid']);
  assert.deepEqual(toolLines(x).map((n) => n.attrs['data-denied']), ['true', undefined]);
});

test('a snapshot turn keeps a refused call as its own tried line', () => {
  const v = createTurn(doc(), {
    turnId: 't-3', prompt: 'find the token', at: AT, state: 'done', end: { state: 'done', at: AT },
    items: [
      { kind: 'tool', blockIndex: 0, toolUseId: 'tu-1', tool: 'WebFetch', input: { url: 'https://example.invalid/' }, startedAt: AT, endedAt: AT, isError: true, denied: true },
      { kind: 'tool', blockIndex: 1, toolUseId: 'tu-2', tool: 'WebFetch', input: { url: 'https://example.invalid/' }, startedAt: AT, endedAt: AT, isError: false },
    ],
  });
  assert.deepEqual(toolLines(v).map(wordsOfLine), ['tried WebFetch, not allowed', 'fetched a page from example.invalid']);
});

const ageOf = (v) => {
  const row = labels(v)[1];
  const age = row?.children.find((c) => c.attrs?.['data-turn-age'] !== undefined);
  return age ? age.textContent : null;
};

test('the age: no AGENT row before 3 s, the row with 0:03 at 3 s, counting, then the total (c1-talk.md §9, D235)', () => {
  const t0 = Date.now();
  const v = createTurn(doc(), { clientId: 'p-00000002', prompt: 'how did the night go?', at: t0, delivery: 'sending' });
  // The echo names the start on the room's clock; the page's clock runs 2 s ahead of the room's.
  const offset = 2000;
  const w = createTurn(doc(), { clientId: 'p-00000003', prompt: 'and now?', at: t0 }, { offset });
  w.confirm({ turnId: 't-9', delivery: 'new', at: new Date(t0 - offset + 500).toISOString() });
  assert.equal(w.startMs, t0 + 500, 'the echo\'s at moved onto the page\'s clock');
  assert.equal(v.tick(t0 + 2999), false);
  assert.equal(labels(v).length, 1, 'no AGENT row at 2.999 s');
  assert.equal(v.tick(t0 + 3000), true, 'the row is made at 3 s');
  assert.match(labels(v)[1].textContent, /^AGENT · \d\d:\d\d · 0:03$/);
  assert.equal(ageOf(v), '0:03');
  assert.equal(replyOf(v), undefined, 'nothing under the row yet');
  assert.equal(v.tick(t0 + 12_000), false);
  assert.equal(ageOf(v), '0:12');
  v.delta({ blockIndex: 0, text: 'Three runs ran last night.' });
  v.draw();
  assert.equal(labels(v).length, 2, 'the first text goes under the same row');
  assert.equal(replyOf(v).textContent, 'Three runs ran last night.');
  v.end({ at: new Date(t0 + 35_400).toISOString() });
  assert.equal(ageOf(v), '0:35', 'the total stays after the end');
  v.tick(t0 + 99_000);
  assert.equal(ageOf(v), '0:35');
});

test('the age: a turn under 3 s shows none; a snapshot turn shows its total', () => {
  const t0 = Date.parse(AT);
  const short = createTurn(doc(), {
    turnId: 't-1', prompt: 'hi', at: AT, items: [{ kind: 'text', blockIndex: 0, text: 'Hello.' }],
    end: { state: 'done', at: new Date(t0 + 900).toISOString() },
  });
  assert.equal(ageOf(short), null);
  assert.match(labels(short)[1].textContent, /^AGENT · \d\d:\d\d$/);
  const long = createTurn(doc(), {
    turnId: 't-2', prompt: 'hi', at: AT, items: [{ kind: 'text', blockIndex: 0, text: 'Hello.' }],
    end: { state: 'done', at: new Date(t0 + 108_000).toISOString() },
  });
  assert.equal(ageOf(long), '1:48');
});

test('firstSentenceDone: a sentence end after 12 characters, a paragraph end, or the block complete (README B9)', () => {
  assert.equal(firstSentenceDone('Three runs ran last night.'), false, 'no white space after the dot yet');
  assert.equal(firstSentenceDone('Three runs ran last night.\nRound 1'), true);
  assert.equal(firstSentenceDone('Three runs ran last night. Round'), true);
  assert.equal(firstSentenceDone('Hi. It went well'), false, 'the dot comes before 12 characters');
  assert.equal(firstSentenceDone('It used 1.5 GB of the disk'), false, 'no space after the dot');
  assert.equal(firstSentenceDone('A table follows\n\n| a |'), true, 'the first paragraph ended');
  assert.equal(firstSentenceDone('Short', true), true, 'the block complete');
  assert.equal(firstSentenceDone('', true), false);
});

test('onFirstSentence fires once, when the drawn text holds the first sentence', () => {
  let n = 0;
  const v = createTurn(doc(), { turnId: 't-1', prompt: 'p', at: new Date().toISOString() }, { onFirstSentence: () => { n += 1; } });
  v.delta({ blockIndex: 0, text: 'Three runs ran last night.' });
  v.draw();
  assert.equal(n, 0);
  v.delta({ blockIndex: 0, text: '\nRound 1: it went. More. ' });
  assert.equal(n, 0, 'not before the frame draws it');
  v.draw();
  v.delta({ blockIndex: 0, text: 'Even more. ' });
  v.draw();
  assert.equal(n, 1);
});

test('E1: the not-sent line under the prompt block, NOT SENT on the label, gone again with the echo', () => {
  const v = createTurn(doc(), { clientId: 'p-3c1e0b2a', prompt: 'restart the tour', at: Date.now(), delivery: 'sending' });
  assert.equal(v.prompt, 'restart the tour');
  assert.equal(v.clientId, 'p-3c1e0b2a');
  v.fail('not-sent', 'Not sent: the room did not confirm within 5 s.', [{ label: 'RETRY', onTap() {} }, { label: 'EDIT', onTap() {} }]);
  assert.equal(v.hasError(), true);
  const [you] = labels(v);
  assert.match(you.textContent, /^YOU · \d\d:\d\d · NOT SENT$/);
  const kidsNow = kids(v.node).map((c) => c.className);
  assert.deepEqual(kidsNow, ['ck-label', 'ck-prompt', 'ck-err'], 'the line right under the prompt block');
  const line = kids(v.node)[2];
  assert.equal(line.attrs['data-turn-error'], 'not-sent');
  assert.equal(line.children[0].textContent, 'Not sent: the room did not confirm within 5 s.');
  assert.deepEqual(line.children[1].children.map((b) => [b.tagName, b.textContent]), [['BUTTON', 'RETRY'], ['BUTTON', 'EDIT']]);
  v.confirm({ turnId: 't-0007', delivery: 'new' });
  assert.equal(v.hasError(), false);
  assert.deepEqual(kids(v.node).map((c) => c.className), ['ck-label', 'ck-prompt']);
  assert.match(labels(v)[0].textContent, /^YOU · \d\d:\d\d$/);
});

test('E1: the AGENT row the 3 s age made while the block waited goes, and no age comes back', () => {
  const sentAt = Date.now();
  const v = createTurn(doc(), { clientId: 'p-3c1e0b2b', prompt: 'restart the tour', at: sentAt, delivery: 'sending' });
  assert.equal(v.tick(sentAt + 3000), true, 'the AGENT row at 3 s');
  assert.equal(labels(v).length, 2);
  v.fail('not-sent', 'Not sent: the room did not confirm within 5 s.', []);
  assert.deepEqual(kids(v.node).map((c) => c.className), ['ck-label', 'ck-prompt', 'ck-err']);
  assert.equal(v.tick(sentAt + 9000), false);
  assert.equal(labels(v).length, 1, 'only the prompt\'s label row');
});
