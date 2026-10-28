// C1, build 12: STOP (spec c1-talk.md §8, protocols.md §3.3, §11.6; D32, D33, D262, D268;
// pending Q-O1, built as its recommendation d, steer). The room under test and the fake agent
// on script `c1-typing`; the page's room-link frames recorded both ways.
// C1 boots with `stt.url: none` (D265): the slot sits in the talk button's rect, x 1280-1344 (B192).
import { test, expect, cockpitDecided } from './fixtures.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const OPENER = '[data-cockpit-open]';
const HEADER = '[data-cockpit-turn]';
const STOPPED = '[data-turn-stopped]';
const QUEUED = '[data-turn-delivery="queued"]';
/** The slot's centre at 1368x912 in the `none` layout (screens.md §4.1). */
const SLOT_AT = { x: 1312, y: 856 };
const STEER = 'only the failed one';

/** Every frame on the room link, both ways, parsed: `{dir, at, msg}`. */
function recordFrames(page) {
  const frames = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    const keep = (dir) => ({ payload }) => {
      let msg = null;
      try { msg = JSON.parse(String(payload)); } catch { /* not JSON */ }
      frames.push({ dir, at: Date.now(), msg });
    };
    ws.on('framesent', keep('sent'));
    ws.on('framereceived', keep('received'));
  });
  return frames;
}
const received = (frames, type) => frames.filter((f) => f.dir === 'received' && f.msg?.type === type).map((f) => f.msg);
const sent = (frames, type) => frames.filter((f) => f.dir === 'sent' && f.msg?.type === type).map((f) => f.msg);

/** The app on `#/map`, the link live, the pane open, the input tapped (a touch screen: D20). */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await page.locator(INPUT).tap();
  await expect(page.locator(INPUT)).toBeFocused();
}

/** Type `text` and tap SEND; resolves with the test's clock at the tap. */
async function typeAndSend(page, text) {
  await page.locator(INPUT).fill(text);
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
  const at = Date.now();
  await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
  return at;
}

/** Wait on the test's clock until `t0 + ms`. */
async function until(t0, ms) {
  const left = t0 + ms - Date.now();
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/**
 * Watch the next STOP from the page itself, on its clock (`performance.now()`): the slot's
 * `pointerup` is t = 0; then the first `data-turn="stopping"`, the stopped line and `READY`,
 * and the running turn's reply text at the tap. Read with `stopTimes(page)`.
 */
const watchStop = (page) => page.evaluate(([send, stopped]) => {
  const root = document.documentElement;
  const w = { tap: null, stopping: null, line: null, ready: null, textAtTap: null };
  window.__stop = w;
  const reply = () => [...document.querySelectorAll('.ck-turns > .ck-turn')].at(-1)?.querySelector('[data-reply]')?.textContent ?? '';
  document.querySelector(send).addEventListener('pointerup', () => {
    if (w.tap !== null) return;
    w.tap = performance.now();
    w.textAtTap = reply();
  }, { capture: true });
  const seen = () => {
    if (w.tap === null) return;
    const t = performance.now() - w.tap;
    if (w.stopping === null && root.dataset.turn === 'stopping') w.stopping = t;
    if (w.line === null && document.querySelector(stopped)) w.line = t;
    if (w.ready === null && w.stopping !== null && root.dataset.turn === 'idle') w.ready = t;
  };
  new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  new MutationObserver(seen).observe(root, { attributes: true, attributeFilter: ['data-turn'] });
}, [SEND, STOPPED]);
const stopTimes = (page) => page.evaluate(() => window.__stop);

/** `HH:MM` of the page's clock now (c1-talk.md §8: the stopped line's time is the page's). */
const pageHhmm = (page) => page.evaluate(() => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
});

/** The stopped line: its text, its `text-transform`, and whether it is its turn's last child. */
const stoppedLook = (page) => page.locator(STOPPED).evaluate((n) => ({
  text: n.textContent,
  transform: getComputedStyle(n).textTransform,
  last: n.parentElement.lastElementChild === n,
  underText: n.previousElementSibling?.matches('[data-reply]') ?? false,
}));

test('S-C1-17 STOP stops; a stuck stop is forced after 5 s', async ({ page, room, fakeAgent }) => {
  test.setTimeout(90_000);
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  // The page's clock: a fake one at 07:03:05, so the minute cannot turn during the test.
  await page.clock.install({ time: new Date(2026, 9, 27, 7, 3, 5) });
  await openPane(page, room);
  const log = fakeAgentLog(fakeAgent.dir);

  await test.step('first run: by 0.1 s `stopping`; the fake ends the turn at 0.3 s; by 0.4 s `STOPPED AT HH:MM`, READY, the slot SEND', async () => {
    await typeAndSend(page, 'count to fifty');
    await expect(page.locator('[data-reply]').last()).toContainText('3', { timeout: 5_000 });
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'stop');
    await expect(page.locator(INPUT)).toHaveValue('');
    await watchStop(page);
    await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
    await expect(page.locator(HEADER)).toHaveText('READY', { timeout: 3_000 });
    const t = await stopTimes(page);
    expect(t.stopping, `stopping at ${t.stopping} ms`).not.toBeNull();
    expect(t.stopping).toBeLessThanOrEqual(100);
    expect(t.line, `STOPPED AT at ${t.line} ms`).not.toBeNull();
    expect(t.line).toBeLessThanOrEqual(400);
    expect(t.ready, `READY at ${t.ready} ms`).toBeLessThanOrEqual(400);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
    await expect(page.locator(SEND)).toHaveText('SEND');
    const look = await stoppedLook(page);
    expect(look).toEqual({ text: `STOPPED AT ${await pageHhmm(page)}`, transform: 'none', last: true, underText: true });
    // D33: the text stays exactly as it was at the tap; nothing the turn sends later is drawn.
    expect(await page.locator('[data-reply]').last().textContent()).toBe(t.textAtTap);
    await expect(page.locator('.ck-streaming')).toHaveCount(0);
    expect(sent(frames, 'stop').length).toBe(1);
    const end = received(frames, 'turn.end').at(-1);
    expect([end.state, end.forced]).toEqual(['stopped', false]);
    expect(log.interrupts().length).toBe(1);
  });

  await test.step('second run, `onInterrupt` `ignore`: nothing ends the turn before 5.0 s; SIGINT at 5.0 s, `STOPPED AT HH:MM (FORCED)` and READY by 5.5 s; no SIGTERM', async () => {
    await typeAndSend(page, 'count slowly');
    await expect(page.locator('[data-reply]').last()).toContainText('One', { timeout: 5_000 });
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'stop', { timeout: 3_000 });
    // From the tap on, both clocks move only by hand (`advance`, stand-ins.md §1.1).
    expect((await room.control('POST', '/clock', { mode: 'manual' })).status).toBe(200);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
    const ends = received(frames, 'turn.end').length;
    await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
    await expect(page.locator(HEADER)).toHaveText('● STOPPING');
    await expect.poll(() => log.interrupts().length).toBe(2);
    expect(log.interrupts()[1].cancelled, 'no receipt from an `ignore` turn').toBeNull();

    const advance = async (ms) => {
      await page.clock.runFor(ms);
      expect((await room.control('POST', '/clock', { advanceMs: ms })).status).toBe(200);
    };
    await advance(4_900);
    await page.waitForTimeout(300);
    expect(received(frames, 'turn.end').length, 'no turn.end before 5.0 s').toBe(ends);
    expect(log.signals(), 'no signal before 5.0 s').toEqual([]);
    await expect(page.locator(HEADER)).toHaveText('● STOPPING');
    await expect(page.locator(STOPPED)).toHaveCount(1, { timeout: 1 }); // the first run's line only

    await advance(100);
    await expect.poll(() => received(frames, 'turn.end').length).toBe(ends + 1);
    const end = received(frames, 'turn.end').at(-1);
    expect([end.state, end.forced]).toEqual(['stopped', true]);
    await page.clock.runFor(400); // t = 5.5 s
    await expect(page.locator(HEADER)).toHaveText('READY', { timeout: 1 });
    await expect(page.locator(STOPPED)).toHaveCount(2, { timeout: 1 });
    const look = await page.locator(STOPPED).last().evaluate((n) => ({
      text: n.textContent, transform: getComputedStyle(n).textTransform, last: n.parentElement.lastElementChild === n,
    }));
    expect(look).toEqual({ text: `STOPPED AT ${await pageHhmm(page)} (FORCED)`, transform: 'none', last: true });
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
    await expect.poll(() => log.signals().map((s) => s.name)).toEqual(['SIGINT']);

    // On to 10 s from the tap: the SIGINT ended the fake's turn, so no SIGTERM follows (§11.6's 8.0 s row).
    await advance(5_000);
    await page.waitForTimeout(500);
    expect(log.signals().map((s) => s.name)).toEqual(['SIGINT']);
    expect(log.interrupts().length, 'one interrupt per stop').toBe(2);
    expect((await room.control('POST', '/clock', { mode: 'real' })).status).toBe(200);
  });
});

test('S-C1-27 STOP during a turn drops a queued prompt and says so (pending Q-O1)', async ({ page, room, fakeAgent }) => {
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  await openPane(page, room);
  const log = fakeAgentLog(fakeAgent.dir);
  const steers = () => log.prompts().filter((p) => p.words === STEER);

  const t0 = await typeAndSend(page, 'check all runs');
  await until(t0, 1_000);
  await typeAndSend(page, STEER);
  await expect(page.locator(QUEUED)).toHaveCount(1, { timeout: 1_000 });
  const queued = sent(frames, 'prompt').find((m) => m.text === STEER);

  await test.step('STOP at 3 s: by 3.1 s `● STOPPING`; the fake agent\'s interrupt line has cancelQueued and the queued uuid', async () => {
    await until(t0, 3_000);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'stop');
    await watchStop(page);
    await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
    await expect(page.locator(HEADER)).toHaveText('READY', { timeout: 3_000 });
    const t = await stopTimes(page);
    expect(t.stopping, `● STOPPING at ${t.stopping} ms`).not.toBeNull();
    expect(t.stopping).toBeLessThanOrEqual(100);
    const [i] = log.interrupts();
    expect(i.cancelQueued).toBe(true);
    expect(i.cancelled).toEqual([steers()[0].uuid]);
    expect(sent(frames, 'stop')).toEqual([expect.objectContaining({ type: 'stop', turnId: received(frames, 'turn.prompt')[0].turnId })]);
  });

  await test.step('by 3.5 s: `STOPPED AT HH:MM`, READY, the block `YOU · HH:MM · NOT SENT` with `Dropped by STOP.`, RETRY and EDIT; nothing more sent', async () => {
    const t = await stopTimes(page);
    expect(t.line, `STOPPED AT at ${t.line} ms`).not.toBeNull();
    expect(t.line).toBeLessThanOrEqual(500);
    expect(t.ready, `READY at ${t.ready} ms`).toBeLessThanOrEqual(500);
    await expect(page.locator(STOPPED)).toHaveText(/^STOPPED AT \d\d:\d\d$/);
    const word = page.locator('[data-turn-delivery="not-sent"]');
    await expect(word).toHaveCount(1);
    await expect(word.locator('xpath=..')).toHaveText(/^YOU · \d\d:\d\d · NOT SENT$/);
    const line = page.locator('[data-turn-error="not-sent"]');
    await expect(line).toContainText('Dropped by STOP.');
    await expect(line.getByRole('button', { name: 'RETRY' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'EDIT' })).toBeVisible();
    const cancelled = received(frames, 'prompt.taken').filter((m) => m.state === 'cancelled');
    expect(cancelled).toEqual([expect.objectContaining({ clientId: queued.clientId, why: 'stopped' })]);
    await page.waitForTimeout(1_500);
    expect(steers().length, 'prompts() 1 before RETRY').toBe(1);
    expect(log.prompts().length, 'nothing more sent to the agent').toBe(2);
  });

  await test.step('RETRY at 5 s sends `only the failed one` with a new clientId as a new turn', async () => {
    await until(t0, 5_000);
    await page.locator('[data-turn-error="not-sent"]').getByRole('button', { name: 'RETRY' }).tap();
    await expect.poll(() => sent(frames, 'prompt').length).toBe(3);
    const again = sent(frames, 'prompt').at(-1);
    expect(again.text).toBe(STEER);
    expect(again.clientId).not.toBe(queued.clientId);
    await expect.poll(() => steers().length, 'prompts() 2 after RETRY').toBe(2);
    await expect.poll(() => received(frames, 'turn.prompt').find((m) => m.clientId === again.clientId)?.delivery).toBe('new');
  });
});
