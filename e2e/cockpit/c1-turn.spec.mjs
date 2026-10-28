// C1, build 8: a turn in the pane (spec c1-talk.md §3 "Streaming", §7 "On send";
// protocols.md §3.1-§3.2; security.md §5, S-SEC-02). The room under test and the
// fake agent on clock `real`; the page's received frames recorded off the room link.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, cockpitDecided } from './fixtures.mjs';

/** Every frame the page receives on the room link, parsed, with the test's receive time. */
function recordFrames(page) {
  const frames = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    ws.on('framereceived', ({ payload }) => {
      const text = String(payload);
      let msg = null;
      try { msg = JSON.parse(text); } catch { /* not JSON: kept as text */ }
      frames.push({ at: Date.now(), text, msg });
    });
  });
  return frames;
}

/** The app on `#/map`, the room link live, the pane open. */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

/**
 * In the page: a 50 ms sample of the reply, the cursor, `data-turn` and the header
 * (the scenario's poll), plus the exact moments things first appear (a
 * MutationObserver, so the budgets are read to the frame and not to the poll).
 * Times are the page's `Date.now()`, the same clock as the room's `sentAt` here.
 */
async function startRecorder(page) {
  await page.evaluate(() => {
    const root = document.documentElement;
    const turnWord = document.querySelector('[data-cockpit-turn]');
    // The last turn: the parent of the conversation's last label row (a block drawn at the tap
    // has no turnId until the room's echo).
    const lastTurn = () => [...document.querySelectorAll('[data-cockpit-conversation] [data-turn-label]')].at(-1)?.parentElement ?? null;
    const rec = { tapAt: null, samples: [], firstPromptAt: null, thinkingAt: null, firstTextAt: null, timer: null, obs: null };
    const look = () => {
      const turn = lastTurn();
      const reply = turn?.querySelector('[data-reply]') ?? null;
      const blocks = reply ? [...reply.children] : [];
      // The cursor: a `▍` ::after on the element that holds the reply's last character (md.js's
      // blocks drawn by reply.js put it on the paragraph, the code line or the cell being written).
      const withCursor = reply ? [...reply.querySelectorAll('*')].filter((n) => getComputedStyle(n, '::after').content === '"▍"') : [];
      const walker = reply ? document.createTreeWalker(reply, NodeFilter.SHOW_TEXT) : null;
      let lastText = null;
      while (walker?.nextNode()) if (walker.currentNode.data !== '') lastText = walker.currentNode;
      const last = withCursor[0] ?? blocks.at(-1) ?? null;
      let cursor = last ? getComputedStyle(last, '::after').content : 'none';
      if (withCursor.length > 1) cursor = `${withCursor.length} cursors`;
      else if (withCursor.length === 1 && !(lastText && last.contains(lastText))) cursor = 'not after the last character';
      return {
        t: Date.now(),
        turn: root.dataset.turn ?? null,
        word: turnWord?.textContent ?? null,
        sending: Boolean(turn?.querySelector('[data-turn-delivery="sending"]')),
        reply: reply ? reply.textContent : null,
        blocks: blocks.map((b) => b.textContent),
        cursor,
        cursorColour: last ? getComputedStyle(last, '::after').color : null,
      };
    };
    const onChange = () => {
      const s = look();
      if (rec.tapAt !== null && rec.firstPromptAt === null && s.sending) rec.firstPromptAt = s.t;
      if (rec.tapAt !== null && rec.thinkingAt === null && s.turn === 'thinking' && s.word === '● WORKING') rec.thinkingAt = s.t;
      if (rec.firstTextAt === null && s.reply) rec.firstTextAt = s.t;
    };
    rec.obs = new MutationObserver(onChange);
    rec.obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-turn', 'class'] });
    rec.timer = setInterval(() => rec.samples.push(look()), 50);
    document.querySelector('[data-cockpit-send]').addEventListener('pointerdown', () => { rec.tapAt ??= Date.now(); }, { capture: true });
    document.querySelector('[data-cockpit-send]').addEventListener('click', () => { rec.tapAt ??= Date.now(); }, { capture: true });
    rec.look = look;
    window.__turnRec = rec;
  });
}

const stopRecorder = (page) => page.evaluate(() => {
  const r = window.__turnRec;
  clearInterval(r.timer);
  r.obs.disconnect();
  r.samples.push(r.look());
  const { tapAt, samples, firstPromptAt, thinkingAt, firstTextAt } = r;
  window.__turnRec = null;
  return { tapAt, samples, firstPromptAt, thinkingAt, firstTextAt };
});

async function typeAndSend(page, text) {
  await page.locator('[data-cockpit-input]').fill(text);
  await expect(page.locator('[data-cockpit-send]')).toBeEnabled();
  await page.locator('[data-cockpit-send]').tap();
}

const ofTurn = (frames, turnId, type) => frames.filter((f) => f.msg?.type === type && f.msg.turnId === turnId);

test('S-C1-04 A reply streams in, then settles', async ({ page, room }) => {
  const frames = recordFrames(page);
  await room.start({ script: 'c1-render' });
  await openPane(page, room);
  const WANT = 'Two of three runs finished.';

  await test.step('the reply streams in after the prompt, with the cursor, then settles on the complete block', async () => {
    await startRecorder(page);
    await typeAndSend(page, 'how did the night go?');
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
    await expect(page.locator('[data-cockpit-turn]')).toHaveText('READY');
    const rec = await stopRecorder(page);
    expect(rec.tapAt, 'the SEND tap was seen').not.toBeNull();

    // B8: the prompt block and `data-turn="thinking"` with `● WORKING` within 0.1 s of SEND.
    expect(rec.firstPromptAt, 'the prompt block drawn with · SENDING').not.toBeNull();
    expect(rec.firstPromptAt - rec.tapAt, 'B8: the prompt block ≤ 0.1 s after SEND').toBeLessThanOrEqual(100);
    expect(rec.thinkingAt, 'data-turn thinking with ● WORKING').not.toBeNull();
    expect(rec.thinkingAt - rec.tapAt, 'B8: data-turn thinking and ● WORKING ≤ 0.1 s after SEND').toBeLessThanOrEqual(100);

    // The turn's frames as the room sent them (framereceived).
    const echo = frames.find((f) => f.msg?.type === 'turn.prompt' && f.msg.text === 'how did the night go?');
    expect(echo, 'the room echoed the prompt').toBeTruthy();
    const turnId = echo.msg.turnId;
    const deltas = ofTurn(frames, turnId, 'text.delta');
    expect(deltas.length, 'the room sent the reply in deltas').toBeGreaterThanOrEqual(2);
    // The script's six pieces 100 ms apart: the room's deltas follow its send times
    // (the room holds an unfinished word until the next white space, D211).
    expect(deltas.map((d) => d.msg.text).join(''), 'the deltas carry the whole text').toBe(WANT);
    const span = deltas.at(-1).msg.sentAt - deltas[0].msg.sentAt;
    expect(span, 'the deltas spread over the script\'s 0.3-0.8 s').toBeGreaterThanOrEqual(150);

    // B4: the first words on screen ≤ 0.5 s after the first delta's sentAt, and `answering`.
    expect(rec.firstTextAt, 'reply text drawn').not.toBeNull();
    expect(rec.firstTextAt - deltas[0].msg.sentAt, 'B4: the first text ≤ 0.5 s after the first text.delta').toBeLessThanOrEqual(500);
    const streaming = rec.samples.filter((s) => s.reply && s.reply !== WANT);
    expect(streaming.length, 'samples taken while the reply streamed (50 ms poll)').toBeGreaterThan(0);
    for (const s of streaming) {
      expect(s.turn, `data-turn while streaming at "${s.reply}"`).toBe('answering');
      expect(s.word, 'the header while streaming').toBe('● WORKING');
      expect(s.cursor, `the cursor ▍ follows "${s.reply}"`).toBe('"▍"');
      expect(WANT.startsWith(s.reply), `the drawn text "${s.reply}" is the reply so far`).toBe(true);
    }
    // The cursor is --text-3.
    const probe = await page.evaluate(() => {
      const p = document.createElement('span');
      p.style.color = 'var(--text-3)';
      document.body.append(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    });
    expect(streaming[0].cursorColour, 'the cursor in --text-3').toBe(probe);
    // Before the first text: thinking, ● WORKING.
    const before = rec.samples.filter((s) => s.t > rec.thinkingAt && s.t < rec.firstTextAt);
    for (const s of before) expect([s.turn, s.word], 'before the first delta').toEqual(['thinking', '● WORKING']);

    // After the complete block: the exact text, no cursor, READY.
    const block = ofTurn(frames, turnId, 'text.block');
    expect(block.length, 'the complete block').toBe(1);
    expect(ofTurn(frames, turnId, 'turn.end')[0]?.msg.state, 'the turn ends done').toBe('done');
    const reply = page.locator(`[data-turn-id="${turnId}"] [data-reply]`);
    await expect(reply).toHaveText(WANT, { useInnerText: false });
    expect(await reply.evaluate((n) => n.textContent)).toBe(WANT);
    expect(await reply.evaluate((n) => [n, ...n.querySelectorAll('*')].filter((e) => getComputedStyle(e, '::after').content !== 'none').length), 'the cursor is gone').toBe(0);
    await expect(page.locator('[data-cockpit-turn]')).toHaveText('READY');
    // The label rows: YOU over the prompt with no delivery word left, AGENT over the reply.
    const labels = page.locator(`[data-turn-id="${turnId}"] [data-turn-label]`);
    await expect(labels).toHaveCount(2);
    await expect(labels.nth(0)).toHaveText(/^YOU · \d\d:\d\d$/);
    await expect(labels.nth(1)).toHaveText(/^AGENT · \d\d:\d\d$/);
    await expect(page.locator(`[data-turn-id="${turnId}"] [data-turn-delivery]`)).toHaveCount(0);
  });

  await test.step('a script that drops delta 4 still ends with the exact text, from the complete block', async () => {
    const from = frames.length;
    await typeAndSend(page, 'how did the night go?');
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
    const mine = frames.slice(from);
    const echo = mine.find((f) => f.msg?.type === 'turn.prompt' && f.msg.text === 'how did the night go?');
    expect(echo, 'the second prompt echoed').toBeTruthy();
    const turnId = echo.msg.turnId;
    const joined = ofTurn(mine, turnId, 'text.delta').map((d) => d.msg.text).join('');
    expect(joined, 'delta 4 (`runs `) never reached the page').toBe('Two of three finished.');
    expect(ofTurn(mine, turnId, 'text.block')[0]?.msg.text).toBe(WANT);
    const reply = page.locator(`[data-turn-id="${turnId}"] [data-reply]`);
    expect(await reply.evaluate((n) => n.textContent), 'the exact text, from the complete block').toBe(WANT);
    expect(await reply.evaluate((n) => [n, ...n.querySelectorAll('*')].filter((e) => getComputedStyle(e, '::after').content !== 'none').length), 'no cursor').toBe(0);
    await expect(page.locator('[data-cockpit-turn]')).toHaveText('READY');
  });
});

test('S-SEC-02 A secret in a reply never reaches a screen or the room\'s files, even split across deltas', async ({ page, room }) => {
  // C1: the "paired screen" is a `local` page with a room link (security.md S-SEC-03's note, Q-O21 b).
  const frames = recordFrames(page);
  await room.start({ script: 'sec-reply' });
  await openPane(page, room);
  const FIRST = 'The token in /etc/acme/env is [redacted] and the key is below.';

  await startRecorder(page);
  await typeAndSend(page, 'what is in /etc/acme/env?');
  await expect.poll(() => frames.some((f) => f.msg?.type === 'turn.prompt')).toBe(true);
  const turnId = frames.find((f) => f.msg?.type === 'turn.prompt').msg.turnId;

  await test.step('within 1.0 s of the last delta the reply reads the redacted text, the next block [redacted]', async () => {
    const reply = page.locator(`[data-turn-id="${turnId}"] [data-reply]`);
    await expect(reply.locator(':scope > *').nth(0)).toHaveText(FIRST, { timeout: 5_000 });
    await expect(reply.locator(':scope > *').nth(1)).toHaveText('[redacted]', { timeout: 5_000 });
    const readAt = await page.evaluate(() => Date.now());
    const rec = await stopRecorder(page);
    const first = rec.samples.find((s) => s.blocks[0] === FIRST);
    const both = rec.samples.find((s) => s.blocks[0] === FIRST && s.blocks[1] === '[redacted]');
    expect(await reply.evaluate((n) => n.children[0].textContent), 'the first block exactly').toBe(FIRST);
    expect(await reply.evaluate((n) => n.children[1].textContent), 'the next block exactly').toBe('[redacted]');
    const deltas = ofTurn(frames, turnId, 'text.delta').filter((d) => d.msg.blockIndex === 0);
    expect(deltas.length, 'the first block came in deltas').toBeGreaterThanOrEqual(2);
    const lastDelta = deltas.at(-1).msg.sentAt;
    const shownAt = (both ?? first)?.t ?? readAt;
    expect(shownAt - lastDelta, 'shown ≤ 1.0 s after the last delta').toBeLessThanOrEqual(1000);
    // Never on screen at any sample: the token's piece or the key's words.
    for (const s of rec.samples) {
      for (const b of s.blocks) {
        expect(b.includes('ghp_9xQ2'), `drawn: ${b}`).toBe(false);
        expect(b.includes('PRIVATE KEY'), `drawn: ${b}`).toBe(false);
      }
    }
  });

  await test.step('the turn ends done; no frame and no line of conversation.jsonl holds the secret', async () => {
    await expect.poll(() => ofTurn(frames, turnId, 'turn.end')[0]?.msg.state ?? null, { timeout: 5_000 }).toBe('done');
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle');
    // A reload's snapshot is a frame the page receives too.
    await page.reload();
    await cockpitDecided(page);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
    await expect.poll(() => frames.some((f) => f.msg?.type === 'snapshot' && f.text.includes(turnId))).toBe(true);
    expect(frames.length, 'frames recorded').toBeGreaterThan(5);
    for (const f of frames) {
      expect(f.text.includes('ghp_9xQ2'), `a frame holds the token: ${f.text.slice(0, 200)}`).toBe(false);
      expect(f.text.includes('PRIVATE KEY'), `a frame holds the key: ${f.text.slice(0, 200)}`).toBe(false);
    }
    const file = path.join(room.booted.stateDir, 'cockpit', 'conversation.jsonl');
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    expect(lines.some((l) => l.includes(turnId)), 'the turn is in conversation.jsonl').toBe(true);
    for (const l of lines) {
      expect(l.includes('ghp_9xQ2'), `conversation.jsonl holds the token: ${l.slice(0, 200)}`).toBe(false);
      expect(l.includes('PRIVATE KEY'), `conversation.jsonl holds the key: ${l.slice(0, 200)}`).toBe(false);
    }
  });
});
