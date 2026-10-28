// C1, build 14: a new conversation, two pages on one conversation, a room restart (spec
// c1-talk.md §11-§12, protocols.md §3.6-§3.7, §11.7, §11.7.1; D36, D269; pending Q-O2, Q-O24,
// built as their recommendations). The room under test and the fake agent on script
// `c1-session`, clock `real`. C1 boots with `stt.url: none` (D265): SEND sits in the talk
// button's rect, x 1280-1344, y 824-888 at 1368x912 (screens.md §4.1).
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, rectOf, cockpitDecided, WALL_PAGE } from './fixtures.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';
import { seededTurns, SEEDED_SESSION } from '../../test/cockpit/fixtures/conversation.mjs';

const OPENER = '[data-cockpit-open]';
const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const HEADER = '[data-cockpit-turn]';
const NEW = '[data-cockpit-new]';
const BAR = '[data-cockpit-newbar]';
const START = '[data-newbar="start"]';
const KEEP = '[data-newbar="keep"]';
const DIVIDER = '[data-cockpit-divider]';
const QUEUED = '[data-turn-delivery="queued"]';
/** The slot's centre at 1368x912 in the `none` layout. */
const SLOT_AT = { x: 1312, y: 856 };

/** Every frame on the room link, both ways, parsed: `{dir, at, msg}` (`at` the test's clock). */
function recordFrames(page) {
  const frames = [];
  const closes = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    const keep = (dir) => ({ payload }) => {
      let msg = null;
      try { msg = JSON.parse(String(payload)); } catch { /* not JSON */ }
      frames.push({ dir, at: Date.now(), msg });
    };
    ws.on('framesent', keep('sent'));
    ws.on('framereceived', keep('received'));
    ws.on('close', () => closes.push(Date.now()));
  });
  frames.closes = closes;
  return frames;
}
const received = (frames, type) => frames.filter((f) => f.dir === 'received' && f.msg?.type === type);
const sent = (frames, type) => frames.filter((f) => f.dir === 'sent' && f.msg?.type === type);

async function until(t0, ms) {
  const left = t0 + ms - Date.now();
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** `HH:MM` of `iso` (or the page's now) on the page's clock and zone. */
const pageHhmm = (page, iso = null) => page.evaluate((s) => {
  const d = s ? new Date(s) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}, iso);

/** A colour against a token, through a probe styled `color: var(<token>)`. */
const tokenColour = (page, token) => page.evaluate((tok) => {
  const probe = document.createElement('span');
  probe.style.color = `var(${tok})`;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, token);

/** The app on `#/map`, the link live, the pane open. */
async function openApp(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

/** Type `text` and tap SEND; resolves with the test's clock at the tap. */
async function typeAndSend(page, text) {
  await page.locator(INPUT).fill(text);
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
  const at = Date.now();
  await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
  return at;
}

/**
 * From now on, on the page's clock (`Date.now()`, the machine's like the test's): every header
 * word seen, when `[data-cockpit-divider]` first shows, when the bar hides, when `data-turn`
 * first reads `stopping`. Read with `watched(page)`.
 */
const watch = (page) => page.evaluate(([header, divider, bar]) => {
  const root = document.documentElement;
  const w = { words: [document.querySelector(header).textContent], divider: null, barHidden: null, stopping: null, queued: null, queuedGone: null };
  window.__watch = w;
  const seen = () => {
    const word = document.querySelector(header).textContent;
    if (w.words.at(-1) !== word) w.words.push(word);
    if (w.divider === null && document.querySelectorAll(divider).length > (window.__dividers ?? 0)) w.divider = Date.now();
    const b = document.querySelector(bar);
    if (w.barHidden === null && b && b.hidden) w.barHidden = Date.now();
    if (w.stopping === null && root.dataset.turn === 'stopping') w.stopping = Date.now();
    const q = document.querySelectorAll('[data-turn-delivery="queued"]').length;
    if (q > 0 && w.queued === null) w.queued = Date.now();
    if (q === 0 && w.queued !== null && w.queuedGone === null) w.queuedGone = Date.now();
  };
  window.__dividers = document.querySelectorAll(divider).length;
  new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  new MutationObserver(seen).observe(root, { attributes: true, attributeFilter: ['data-turn'] });
}, [HEADER, DIVIDER, BAR]);
const watched = (page) => page.evaluate(() => window.__watch);

/** ± `tol` px. */
const near = (got, want, tol = 1) => Math.abs(got - want) <= tol;
/** Every edge of `got` ± 1 px of `want`. */
const expectRect = (got, want, name) => {
  for (const k of ['x1', 'x2', 'y1', 'y2']) expect(near(got[k], want[k]), `${name} ${k} ${got[k]}, want ${want[k]} ± 1`).toBe(true);
};

test('S-C1-22 A new conversation: asked, then started at once (pending Q-O2)', async ({ page, room, fakeAgent }) => {
  test.setTimeout(120_000);
  const frames = recordFrames(page);
  await room.start({ turns: 23, script: 'c1-session' });
  const log = fakeAgentLog(fakeAgent.dir);
  // The Wall page in `wall` at 1368x912 (`?ratio=0.5`: build B122).
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit-layout', 'wall');
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await expect(page.locator('[data-turn-id]')).toHaveCount(23);
  await expect(page.locator(NEW)).toBeEnabled();
  expect(log.starts().map((s) => [s.session, s.resumed])).toEqual([[SEEDED_SESSION, true]]);

  await test.step('a tap on NEW: the bar at x 760-1368, y 64-144, START x 1144-1240 and KEEP x 1256-1352 at y 80-128', async () => {
    await page.locator(NEW).tap();
    await expect(page.locator(BAR)).toBeVisible();
    await expect(page.locator(BAR)).toContainText('Start a new conversation? Cards, jobs and notes stay.');
    const bar = await rectOf(page, BAR);
    const start = await rectOf(page, START);
    const keep = await rectOf(page, KEEP);
    const text = await rectOf(page, '.ck-newbar-text');
    // ± 1 px on every edge: the bar starts inside the pane's 1 px left border (x 761).
    expectRect(bar, { x1: 760, x2: 1368, y1: 64, y2: 144 }, 'bar');
    expect(near(bar.y2 - bar.y1, 80), `bar height ${bar.y2 - bar.y1}`).toBe(true);
    expectRect(start, { x1: 1144, x2: 1240, y1: 80, y2: 128 }, 'START');
    expectRect(keep, { x1: 1256, x2: 1352, y1: 80, y2: 128 }, 'KEEP');
    expect(near(keep.x1 - start.x2, 16), 'START ends 16 px left of KEEP').toBe(true);
    expect(near(keep.x2, 1352), 'KEEP is the rightmost, 16 px from the edge').toBe(true);
    for (const r of [start, keep]) {
      expect(near(r.x2 - r.x1, 96) && near(r.y2 - r.y1, 48), `48x96: ${JSON.stringify(r)}`).toBe(true);
    }
    expect(near(text.x1, 784) && near(text.x2, 1128), `text x ${text.x1}-${text.x2}`).toBe(true);
    await expect(page.locator(START)).toHaveText('START');
    await expect(page.locator(KEEP)).toHaveText('KEEP');
    // It pushes the conversation down by 80 px, like the status line (§11).
    const convo = await rectOf(page, '[data-cockpit-conversation] .ck-band');
    expect(near(convo.y1, 144), `the conversation from y ${convo.y1}`).toBe(true);
  });

  await test.step('10 s without a tap: the bar goes and nothing changed (same session id, 23 turns)', async () => {
    // The bar's 10 s counted from that tap (the bar is still the one shown at the last step).
    await page.locator(KEEP).tap();
    await expect(page.locator(BAR)).toBeHidden();
    await watch(page);
    const tapped = page.evaluate((sel) => new Promise((resolve) => {
      document.querySelector(sel).addEventListener('click', () => resolve(Date.now()), { once: true, capture: true });
    }), NEW);
    await page.locator(NEW).tap();
    const at = await tapped;
    await expect(page.locator(BAR)).toBeVisible();
    await page.waitForTimeout(9_500 - (Date.now() - at));
    await expect(page.locator(BAR), 'still there at 9.5 s').toBeVisible();
    await expect(page.locator(BAR)).toBeHidden({ timeout: 1_500 });
    const w = await watched(page);
    const after = w.barHidden - at;
    expect(after, `the bar went ${after} ms after the tap`).toBeGreaterThanOrEqual(10_000);
    expect(after).toBeLessThanOrEqual(10_200);
    expect(sent(frames, 'new')).toHaveLength(0);
    expect(log.starts().map((s) => s.session)).toEqual([SEEDED_SESSION]);
    await expect(page.locator('[data-turn-id]')).toHaveCount(23);
    await expect(page.locator(DIVIDER)).toHaveCount(0);
    expect(w.words).toEqual(['READY']);
  });

  await test.step('NEW, then START: by 0.5 s the divider under the 23 turns, READY throughout, a new session id', async () => {
    const promptsBefore = log.prompts().length;
    await page.locator(NEW).tap();
    await expect(page.locator(BAR)).toBeVisible();
    await watch(page);
    const tapped = page.evaluate((sel) => new Promise((resolve) => {
      document.querySelector(sel).addEventListener('click', () => resolve(Date.now()), { once: true, capture: true });
    }), START);
    await page.locator(START).tap();
    const startAt = await tapped;
    await expect(page.locator(DIVIDER)).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator(BAR)).toBeHidden();
    const w = await watched(page);
    const conv = received(frames, 'conversation.new');
    expect(conv).toHaveLength(1);
    expect(conv[0].msg).toMatchObject({ conversation: 'c-0008', reason: 'owner' });
    // ≤ 0.5 s after the new session started (§11's divider, §16's table): the room's `at` is its
    // `ready`, on this machine's clock like the page's.
    const fromStart = w.divider - Date.parse(conv[0].msg.at);
    console.log(`S-C1-22: divider ${w.divider - startAt} ms after START, ${fromStart} ms after the new session's ready`);
    expect(fromStart).toBeLessThanOrEqual(500);
    expect(w.divider - startAt, 'divider by 0.5 s of START').toBeLessThanOrEqual(500);
    expect(sent(frames, 'new')).toHaveLength(1);
    await expect(page.locator(DIVIDER)).toHaveText(`NEW CONVERSATION · ${await pageHhmm(page, conv[0].msg.at)}`);
    // The 23 turns stay above it, unfolded, each with its reply.
    const above = await page.evaluate((sel) => {
      const d = document.querySelector(sel);
      return [...document.querySelectorAll('[data-turn-id]')].map((t) => ({
        before: Boolean(t.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING),
        shown: t.getClientRects().length > 0 && !t.closest('[hidden]'),
        reply: t.querySelector('[data-reply]')?.textContent.length ?? 0,
      }));
    }, DIVIDER);
    expect(above).toHaveLength(23);
    expect(above.every((t) => t.before && t.shown && t.reply > 0)).toBe(true);
    // The view scrolled so the divider is at the conversation's top (16 px padding).
    const div = await rectOf(page, DIVIDER);
    const band = await rectOf(page, '[data-cockpit-conversation] .ck-band');
    expect(near(div.y1 - band.y1, 16), `divider top ${div.y1}, conversation top ${band.y1}`).toBe(true);
    expect(near(div.y2 - div.y1, 48), 'the divider row is 48 px').toBe(true);
    // The header reads READY throughout.
    await page.waitForTimeout(1_000);
    expect((await watched(page)).words).toEqual(['READY']);
    // A new session id, started fresh; no prompt reached the agent since START.
    const starts = log.starts();
    expect(starts).toHaveLength(2);
    expect(starts[1].resumed).toBe(false);
    expect(starts[1].session).not.toBe(SEEDED_SESSION);
    expect(log.prompts()).toHaveLength(promptsBefore);
  });

  await test.step.skip('both cards are still on the canvas — waits for Canvas', async () => {
    // c4-cards' `one-card` and `second-card` turns put them there; the card count is asserted then.
  });

  await test.step("the owner's next prompt goes to the new session, under the divider", async () => {
    const promptsBefore = log.prompts().length;
    await typeAndSend(page, 'how is builder-a');
    await expect(page.locator('.ck-current [data-turn-id] [data-reply]').last()).toContainText('round 4.', { timeout: 5_000 });
    await expect(page.locator(HEADER)).toHaveText('READY');
    expect(log.prompts()).toHaveLength(promptsBefore + 1);
    const lines = log.lines();
    const lastStart = lines.findLastIndex((l) => l.kind === 'start');
    const prompt = lines.findLastIndex((l) => l.kind === 'prompt');
    expect(lines[lastStart].session).not.toBe(SEEDED_SESSION);
    expect(prompt, 'the prompt reached the child started on the new session').toBeGreaterThan(lastStart);
    expect(lines[prompt].words).toContain('how is builder-a');
  });

  await test.step('a turn running at START: ● STOPPING until its end arrives, then the divider', async () => {
    await typeAndSend(page, 'how is builder-a');
    await expect(page.locator('[data-reply]').last()).toContainText('builder-a', { timeout: 3_000 });
    await expect(page.locator(HEADER)).toHaveText('● WORKING');
    await page.locator(NEW).tap();
    await expect(page.locator(BAR)).toBeVisible();
    await watch(page);
    const tapped = page.evaluate((sel) => new Promise((resolve) => {
      document.querySelector(sel).addEventListener('click', () => resolve(Date.now()), { once: true, capture: true });
    }), START);
    await page.locator(START).tap();
    const startAt = await tapped;
    await expect(page.locator(DIVIDER)).toHaveCount(2, { timeout: 10_000 });
    const w = await watched(page);
    const end = received(frames, 'turn.end').at(-1);
    expect(end.msg.state).toBe('stopped');
    expect(w.stopping - startAt, '● STOPPING at the tap').toBeLessThanOrEqual(100);
    expect(w.words.slice(0, 3)).toEqual(['● WORKING', '● STOPPING', 'READY']);
    expect(w.divider, 'the divider after the turn ended').toBeGreaterThanOrEqual(end.at);
    await expect(page.locator(HEADER)).toHaveText('READY');
    expect(received(frames, 'conversation.new')).toHaveLength(2);
    // The earlier new conversation is history: no gap left where its box held the view.
    const gap = await page.evaluate(() => document.querySelectorAll('.ck-current')[0].style.minHeight);
    expect(gap).toBe('');
  });
});

test('S-C1-23 Two pages, one conversation: a second prompt queues, it does not stop', async ({ page, room, fakeAgent, browser }) => {
  test.setTimeout(90_000);
  await room.start({ script: 'c1-session' });
  const log = fakeAgentLog(fakeAgent.dir);
  const ctxB = await browser.newContext({
    viewport: { width: 1368, height: 912 }, deviceScaleFactor: 2, hasTouch: true, timezoneId: 'Europe/Zurich', locale: 'en-GB',
  });
  try {
    const pageB = await ctxB.newPage();
    const A = page;
    const B = pageB;
    const framesA = recordFrames(A);
    const framesB = recordFrames(B);
    await openApp(A, room);
    await openApp(B, room);
    for (const p of [A, B]) await watch(p);

    let t0 = 0;
    await test.step("A sends at t = 0: by 0.5 s after the room has it, B shows `YOU · HH:MM` over it; the reply streams on both", async () => {
      t0 = await typeAndSend(A, 'how is builder-a');
      await expect.poll(() => received(framesB, 'turn.prompt').length, { timeout: 2_000 }).toBe(1);
      const echoAt = received(framesB, 'turn.prompt')[0].at;
      const label = B.locator('[data-turn-id] .ck-label').first();
      await expect(B.locator('[data-turn-id] .ck-prompt')).toHaveText('how is builder-a', { timeout: Math.max(1, echoAt + 500 - Date.now()) });
      await expect(label).toHaveText(/^YOU · \d\d:\d\d$/);
      for (const p of [A, B]) await expect(p.locator('[data-reply]').last()).toContainText('builder-a', { timeout: 2_000 });
    });

    let queuedLabel = null;
    await test.step('B sends at t = 1.0 s: by 1.5 s both draw it last, `YOU · HH:MM · QUEUED`, --text-2; WORKING at 1.5 s and 2.0 s, never STOPPING', async () => {
      await until(t0, 1_000);
      await typeAndSend(B, 'and builder-b');
      await until(t0, 1_500);
      for (const p of [A, B]) {
        await expect(p.locator(QUEUED)).toHaveCount(1, { timeout: 1 });
        const look = await p.evaluate(() => {
          const items = [...document.querySelectorAll('[data-cockpit-conversation] .ck-prompt')];
          const n = items.at(-1);
          return { text: n.textContent, label: n.previousElementSibling?.textContent, colour: getComputedStyle(n).color };
        });
        expect(look.text).toBe('and builder-b');
        expect(look.label).toMatch(/^YOU · \d\d:\d\d · QUEUED$/);
        expect(look.colour).toBe(await tokenColour(p, '--text-2'));
        queuedLabel ??= look.label.replace(' · QUEUED', '');
        await expect(p.locator(HEADER)).toHaveText('● WORKING', { timeout: 1 });
        await expect(p.locator(':root')).not.toHaveAttribute('data-turn', 'stopping');
      }
      await until(t0, 1_950);
      for (const p of [A, B]) {
        await expect(p.locator(HEADER)).toHaveText('● WORKING', { timeout: 1 });
        await expect(p.getByText('STOPPED AT')).toHaveCount(0);
      }
    });

    await test.step("A's turn ends: within 0.1 s of the take one block on each page, QUEUED gone, --text-1, the same label time; `builder-b is idle.` on both", async () => {
      for (const p of [A, B]) await expect(p.locator(QUEUED)).toHaveCount(0, { timeout: 3_000 });
      const takeAt = (frames) => {
        const f = frames.find((x) => x.dir === 'received' && (x.msg?.type === 'prompt.taken' || (x.msg?.type === 'turn.prompt' && x.msg.from === 'queued')));
        return f?.at ?? null;
      };
      for (const [p, frames] of [[A, framesA], [B, framesB]]) {
        const gone = (await watched(p)).queuedGone;
        const take = takeAt(frames);
        expect(take, 'the take arrived').not.toBeNull();
        expect(gone - take, `QUEUED gone ${gone - take} ms after the take`).toBeLessThanOrEqual(100);
        const own = await p.evaluate(() => [...document.querySelectorAll('[data-cockpit-conversation] *')]
          .filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent === 'and builder-b')).length);
        expect(own, 'one block, no second copy').toBe(1);
        const look = await p.evaluate(() => {
          const n = [...document.querySelectorAll('[data-cockpit-conversation] .ck-prompt')].find((x) => x.textContent === 'and builder-b');
          return { label: n.previousElementSibling?.textContent, colour: getComputedStyle(n).color };
        });
        expect(look.label).toBe(queuedLabel);
        expect(look.colour).toBe(await tokenColour(p, '--text-1'));
        // A's reply whole, then builder-b's below the block.
        await expect(p.locator('[data-reply]').first()).toHaveText('builder-a is running acme-docs, round 4.');
        await expect(p.locator('[data-reply]').last()).toContainText('builder-b', { timeout: 1_000 });
      }
      for (const p of [A, B]) expect((await watched(p)).words).not.toContain('● STOPPING');
    });

    await test.step('t = 2.5 s a draft `stop` on A, t = 3.0 s STOP on B: never on B; both stopping within 0.5 s; STOPPED AT under the second turn; A reads SEND', async () => {
      await until(t0, 2_500);
      await A.locator(INPUT).fill('stop');
      await until(t0, 2_950);
      expect(log.order('interrupt'), 'no interrupt until 3.0 s').toEqual([]);
      await expect(B.locator(INPUT)).toHaveValue('');
      await expect(B.locator(SEND)).toHaveAttribute('data-send', 'stop');
      await until(t0, 3_000);
      const tap = Date.now();
      await B.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
      for (const p of [A, B]) {
        await expect(p.locator(':root')).toHaveAttribute('data-turn', 'stopping', { timeout: Math.max(1, tap + 500 - Date.now()) });
      }
      for (const p of [A, B]) {
        const w = await watched(p);
        expect(w.stopping - tap, 'stopping within 0.5 s of the tap').toBeLessThanOrEqual(500);
        await expect(p.locator('[data-turn-id]').last().locator('[data-turn-stopped]')).toHaveText(/^STOPPED AT \d\d:\d\d$/, { timeout: 3_000 });
        await expect(p.locator('[data-turn-stopped]')).toHaveCount(1);
      }
      await expect(B.locator(INPUT)).toHaveValue('');
      await expect(A.locator(INPUT)).toHaveValue('stop');
      await expect(A.locator(SEND)).toHaveAttribute('data-send', 'send');
      await expect(A.locator(SEND)).toHaveText('SEND');
      for (const p of [A, B]) await expect(p.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 3_000 });
      expect(log.order('interrupt')).toHaveLength(1);
      expect(log.order('prompt', 'turn-end').slice(0, 3)).toEqual(['prompt', 'prompt', 'turn-end']);
      expect(sent(framesA, 'stop')).toHaveLength(0);
      expect(sent(framesB, 'stop')).toHaveLength(1);
    });

    await test.step('NEW on A: the bar shows on A only', async () => {
      await A.locator(NEW).tap();
      await expect(A.locator(BAR)).toBeVisible();
      await B.waitForTimeout(500);
      await expect(B.locator(BAR)).toBeHidden();
      await A.locator(KEEP).tap();
      expect(sent(framesA, 'new')).toHaveLength(0);
    });
  } finally {
    await ctxB.close();
  }
});

test('S-C1-39 A room restart mid-conversation: the same turns, the same session (pending Q-O24)', async ({ page, room, fakeAgent }) => {
  test.setTimeout(120_000);
  const frames = recordFrames(page);
  // 20 done turns t-0101…t-0120, 60 to 41 min before now (stand-ins.md §1.1 `stateFiles`).
  await room.start({ script: 'c1-session', seeded: seededTurns(20, { first: 101, spacingMs: 60_000, lastAgoMs: 41 * 60_000 }) });
  const log = fakeAgentLog(fakeAgent.dir);
  const file = path.join(room.booted.stateDir, 'cockpit', 'conversation.jsonl');
  await openApp(page, room);
  await expect(page.locator('[data-turn-id]')).toHaveCount(20);

  await test.step('two answered turns, then a third streaming 1.0 s after its send', async () => {
    for (const n of [121, 122]) {
      await typeAndSend(page, 'how is builder-a');
      await expect(page.locator(`[data-turn-id="t-0${n}"] [data-reply]`)).toHaveText('builder-a is running acme-docs, round 4.', { timeout: 5_000 });
      await expect(page.locator(HEADER)).toHaveText('READY');
    }
    await expect(page.locator('[data-turn-id]')).toHaveCount(22);
    const sentAt = await typeAndSend(page, 'how is builder-a');
    await until(sentAt, 1_000);
    await expect(page.locator('[data-turn-id="t-0123"]')).toHaveCount(1);
  });

  let killAt = 0;
  await test.step('the room killed: room-down and its line 5 s after the link closes; the 23 turns stay', async () => {
    // When `data-cockpit` turns `room-down`, on the page's clock (the machine's, like the test's).
    await page.evaluate(() => {
      const root = document.documentElement;
      new MutationObserver(() => {
        if (root.dataset.cockpit === 'room-down') window.__downAt ??= Date.now();
      }).observe(root, { attributes: true, attributeFilter: ['data-cockpit'] });
    });
    killAt = Date.now();
    process.kill(-room.booted.pid, 'SIGKILL');
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'room-down', { timeout: 7_000 });
    const downAt = await page.evaluate(() => window.__downAt);
    const closedAt = frames.closes.at(-1);
    expect(closedAt - killAt, 'the link closed at the kill').toBeLessThanOrEqual(500);
    // "Within 5 s of the kill": the 5 s grace from the loss, which is the kill (screens.md §7,
    // D10; S-SCR-17's t = 5 s; build B223). Not before the grace, and at it.
    console.log(`S-C1-39: closed ${closedAt - killAt} ms after the kill, room-down ${downAt - closedAt} ms after the close`);
    expect(downAt - closedAt, `room-down ${downAt - closedAt} ms after the close`).toBeGreaterThanOrEqual(4_900);
    expect(downAt - closedAt).toBeLessThanOrEqual(5_100);
    await expect(page.locator('[data-cockpit-status]')).toHaveAttribute('data-status', 'room-down');
    await expect(page.locator('[data-turn-id]')).toHaveCount(23);
  });

  await test.step('the room restarted: within 10 s a new epoch, the snapshot of 23 turns from t-0101, c-0007, no divider; E2 then agent back with RETRY; READY; at the end', async () => {
    const welcomes = received(frames, 'welcome').length;
    // Every text of the cut turn's error line, from now on.
    await page.evaluate(() => {
      const seen = [];
      window.__e2 = seen;
      const look = () => {
        const n = document.querySelector('[data-turn-error="agent-exited"]');
        const t = n?.querySelector('.ck-errline, p')?.textContent ?? n?.textContent ?? null;
        if (t && seen.at(-1) !== t) seen.push(t);
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    // The restarted agent's `ready` after the page's reconnect (≤ 10 s), so the snapshot shows E2's
    // first line before the agent is back, as the scenario orders them (build B223).
    fakeAgent.edit((sc) => { sc.start.initAfterMs = 12_000; });
    await room.restart({ signal: 'SIGKILL' });
    const upAt = Date.now();
    await expect.poll(() => received(frames, 'welcome').length, { timeout: 10_000 }).toBe(welcomes + 1);
    const before = received(frames, 'welcome').at(-2).msg;
    const welcome = received(frames, 'welcome').at(-1);
    expect(welcome.at - upAt, 'reconnected within 10 s').toBeLessThanOrEqual(10_000);
    expect(welcome.msg.epoch).not.toBe(before.epoch);
    expect(welcome.msg.resume).toBe('snapshot');
    expect(welcome.msg.conversation).toBe('c-0007');
    const snaps = received(frames, 'snapshot').filter((f) => f.at >= welcome.at).map((f) => f.msg);
    expect(snaps.flatMap((s) => s.turns)).toHaveLength(23);
    expect(snaps.at(-1).olderTurns ?? 0).toBe(0);
    await expect(page.locator('[data-turn-id]')).toHaveCount(23);
    expect(await page.locator('[data-turn-id]').first().getAttribute('data-turn-id')).toBe('t-0101');
    await expect(page.locator(DIVIDER)).toHaveCount(0);
    const cut = page.locator('[data-turn-id="t-0123"]');
    await expect(cut.locator('.ck-prompt')).toHaveText('how is builder-a');
    expect(await cut.locator('[data-reply]').evaluateAll((ns) => ns.map((n) => n.textContent).join(''))).toBe('');
    const end = snaps.flatMap((s) => s.turns).find((t) => t.turnId === 't-0123').end;
    expect(end).toMatchObject({ state: 'error', code: 'agent-exited' });
    const hm = await pageHhmm(page, end.at);
    await expect(cut.locator('[data-turn-error="agent-exited"]')).toContainText(`The agent stopped unexpectedly at ${hm}. The room is starting it again.`);
    await expect(cut.locator('[data-turn-error="agent-exited"]')).toContainText(`The agent is back (${hm}). Your last message was not answered.`, { timeout: 15_000 });
    const seen = await page.evaluate(() => window.__e2);
    expect(seen[0]).toContain(`The agent stopped unexpectedly at ${hm}. The room is starting it again.`);
    expect(seen.at(-1)).toContain(`The agent is back (${hm}). Your last message was not answered.`);
    await expect(cut.getByRole('button', { name: 'RETRY' })).toBeVisible();
    await expect(page.locator(HEADER)).toHaveText('READY');
    const atEnd = await page.evaluate(() => {
      const c = document.querySelector('[data-cockpit-conversation] .ck-convo');
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 1;
    });
    expect(atEnd, 'the view at the end').toBe(true);
  });

  await test.step('RETRY: the same session resumed, the prompt once more as t-0124, answered in 2 s', async () => {
    const promptsBefore = log.prompts().length;
    await page.locator('[data-turn-id="t-0123"]').getByRole('button', { name: 'RETRY' }).tap();
    const at = Date.now();
    await expect(page.locator('[data-turn-id="t-0124"] [data-reply]')).toHaveText('builder-a is running acme-docs, round 4.', { timeout: 5_000 });
    await expect(page.locator(HEADER)).toHaveText('READY');
    expect(Date.now() - at).toBeLessThanOrEqual(2_000 + 1_000);
    const starts = log.starts();
    expect(starts).toHaveLength(2);
    expect(starts.map((s) => [s.session, s.resumed])).toEqual([[SEEDED_SESSION, true], [SEEDED_SESSION, true]]);
    const prompts = log.prompts();
    expect(prompts).toHaveLength(promptsBefore + 1);
    expect(prompts.at(-1).words).toContain('how is builder-a');
  });

  await test.step('conversation.jsonl: 0600, one conversation line, one turn line per turn of the rewrite, 24 turns, no other kind', async () => {
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.kind === 'conversation')).toHaveLength(1);
    expect(lines.every((l) => l.kind === 'conversation' || l.kind === 'turn')).toBe(true);
    const ids = lines.filter((l) => l.kind === 'turn').map((l) => l.turn.turnId);
    expect(new Set(ids).size).toBe(24);
    // The rewrite at the start left one line per turn; t-0124's own appends follow it
    // (§11.7.1: the last line of a turnId wins; build B223).
    for (let n = 101; n <= 123; n++) expect(ids.filter((id) => id === `t-0${n}`), `t-0${n}`).toHaveLength(1);
    const last = lines.filter((l) => l.kind === 'turn' && l.turn.turnId === 't-0124').at(-1);
    expect(last.turn.end?.state).toBe('done');
  });
});
