// C1, build 16: the room down and back (spec screens.md §7, §7.1, D10, D11, D12, D139, D220, D257,
// D263). The room under test's link is stopped with `POST /link {"up":false}` (stand-ins.md §1.2):
// open links are destroyed with no close frame and every new upgrade is destroyed unread, so the
// page sees an unreachable room while the room itself runs on.
//
// On `page.clock` the clock is paused for the outage and moved by hand. A try's socket fails in
// real time, while the page's clock stands still, so the moments of §7.1's table stay exact: the
// test waits for each try's close (`cockpit:close` marks) before it moves past the next one.
// The clock is paused at the time of the loss itself (`lose()`: set 1 s short with
// `setSystemTime`, then `pauseAt` the loss), so the page's 06:41 is the loss's own minute (build B243).
// C1 boots with `stt.url: none` (D265): no talk button, `SEND` in its rect (slices.md §3.1).
import { test, expect, rectOf, cockpitDecided, WALL_PAGE } from './fixtures.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';

const ROOT = ':root';
const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const OPENER = '[data-cockpit-open]';
const PANE = '[data-cockpit-conversation]';
const STATUS = '[data-cockpit-status]';
const STATUS_TEXT = `${STATUS} .ck-status-text`;
const LINE = '[data-cockpit-line]';
const ROW = '.ck-row';

/** The loss at 06:41 on 28 Oct 2026 (CET, +01:00), as S-SCR-17 writes it. */
const LOSS = new Date('2026-10-28T06:41:00+01:00');
/** screens.md §7.1: each try's time after the loss (s), tries 1-8. */
const TRIES_S = [0.9, 2.52, 5.436, 10.6848, 20.1326, 35.1326, 50.1326, 65.1326];
/** §7.1: the delay before each try (ms), tries 1-8: the page computes these (no tolerance). */
const DELAYS_MS = [900, 1620, 2916, 5248.8, 9447.84, 15000, 15000, 15000];
/** §1's rects at 1368x912, `none` (screens.md §4.1). */
const SEND_RECT = { x1: 1280, x2: 1344, y1: 824, y2: 888 };

/** The page's marks of `name`, their `detail`s in order (the real clock's timeline). */
const marks = (page, name) => page.evaluate((n) => performance.getEntriesByName(n).map((e) => e.detail), name);

/**
 * `page.clock` stubs `performance.getEntriesByName` (it answers `[]`), so on the fake clock the
 * page's marks are copied as they are made: call after `page.clock.install()`, before the load
 * (build B243). `fakeMarks(page, name)` reads them.
 */
const recordMarks = (page) => page.addInitScript(() => {
  const made = [];
  window.__ckMarks = made;
  const mark = performance.mark.bind(performance);
  performance.mark = (name, opts) => { made.push({ name, detail: opts?.detail }); return mark(name, opts); };
});
const fakeMarks = (page, name) => page.evaluate((n) => window.__ckMarks.filter((m) => m.name === n).map((m) => m.detail), name);
const wallState = (page) => page.evaluate(() => document.documentElement.dataset.wallState);

/** The Wall page in `wall` layout, touring, the room link live. */
async function openWall(page, room) {
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await page.waitForFunction(() => document.documentElement.dataset.wallState === 'tour' && Boolean(window.__cockpitView?.wall));
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit-layout', 'wall');
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live');
}

async function openPane(page) {
  await page.locator(OPENER).tap();
  await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
  await expect(page.locator(PANE)).toHaveCSS('transform', 'none');
}

/**
 * The page's clock paused and its `Date` set to 06:41:00 (no timer fires), the room's link
 * stopped, and the page's loss seen (its socket's close). Returns the hand: `to(s)` moves the
 * page's clock to `s` seconds after the loss, try by try, waiting for each try's close.
 */
async function lose(page, room) {
  // The running clock is set 1 s short of the loss, then paused at the loss itself: the pause
  // lands on 06:41:00.000 whatever the round trips take. (Pausing at "the page's now + 50 ms",
  // read in one round trip and applied in the next, threw "Cannot fast-forward to the past"
  // when a trip took longer than 50 ms.) The 1 s jump fires only timers due in it, once.
  await page.clock.setSystemTime(LOSS.getTime() - 1_000);
  await page.clock.pauseAt(LOSS);
  expect(await page.evaluate(() => Date.now()), 'the page paused at the loss').toBe(LOSS.getTime());
  // The loss under test is the link's first: a close before it would leave its own "since" in
  // place (link.js keeps `lossAt` until a welcome), and the line would not read 06:41.
  const closes = (await fakeMarks(page, 'cockpit:close')).length;
  expect(closes, 'no loss before the one under test').toBe(0);
  expect(await fakeMarks(page, 'cockpit:retry'), 'no retry before the loss').toEqual([]);
  expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
  await expect.poll(async () => (await fakeMarks(page, 'cockpit:close')).length, { message: 'the page saw the loss', intervals: [20, 50, 100] }).toBe(closes + 1);
  let at = 0; // ms after the loss
  let opened = Infinity; // the try that the room accepted: no try after it
  const tried = () => Math.min(opened, TRIES_S.filter((s) => Math.round(s * 1000) + 1 <= at).length);
  return {
    /**
     * The page's clock to `s` s after the loss; every try due meanwhile has failed by the return.
     * `failing: false` once the room accepts again: the next try opens, none comes after it.
     */
    async to(s, { failing = true } = {}) {
      const want = Math.round(s * 1000);
      expect(want).toBeGreaterThanOrEqual(at);
      while (at < want) {
        const next = TRIES_S.map((t) => Math.round(t * 1000) + 1).find((t) => t > at && t <= want) ?? want;
        await page.clock.runFor(next - at);
        at = next;
        const n = tried();
        await expect.poll(async () => (await fakeMarks(page, 'cockpit:retry')).length, { message: `try ${n} made`, intervals: [20, 50, 100] }).toBe(n);
        if (!failing && n > 0) opened = Math.min(opened, n);
        else if (n > 0 && n < opened) {
          await expect.poll(async () => (await fakeMarks(page, 'cockpit:close')).length, { message: `try ${n} failed`, intervals: [20, 50, 100] }).toBe(closes + 1 + n);
        }
      }
    },
    at: () => at,
    closes,
  };
}

test('S-SCR-17 The room goes down: the cockpit says so after 5 s, the board keeps going', async ({ page, room }) => {
  test.setTimeout(120_000);
  await room.start({ turns: 2, script: 'scr-room' });
  await page.clock.install({ time: new Date(LOSS.getTime() - 30_000) });
  await recordMarks(page);
  await openWall(page, room);
  await openPane(page);
  await page.locator(INPUT).fill('how is the');
  // S-SCR-03: the open pane holds the Wall where it is. The room going down changes nothing of the
  // Wall (D257: "unchanged"), so its state is asserted unchanged from here (build B243).
  const wallBefore = await wallState(page);
  expect(wallBefore).toBe('explore');
  const hand = await lose(page, room);

  await test.step('at t = 4.9 s nothing has changed', async () => {
    await hand.to(4.9);
    await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live');
    await expect(page.locator(STATUS)).toHaveCount(0);
    await expect(page.locator(LINE)).toBeHidden();
    await expect(page.locator(SEND)).toBeEnabled();
    expect(await wallState(page)).toBe(wallBefore);
  });

  await test.step('at t = 5 s room-down: the 80 px status line with RETRY NOW, the line above the row, SEND disabled, no talk button', async () => {
    await hand.to(5);
    await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'room-down');
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'room-down');
    // The next try is at 5.436 s: 0.436 s left, rounded up (§7.1 "The countdown").
    await expect(page.locator(STATUS_TEXT)).toHaveText('Cockpit room unreachable since 06:41 (0 min). Retrying in 1 s.');
    const status = await rectOf(page, STATUS);
    expect(Math.abs(status.y2 - status.y1 - 80), `the status line 80 ± 1 px, got ${JSON.stringify(status)}`).toBeLessThanOrEqual(1);
    const retry = page.locator(STATUS).getByRole('button', { name: 'RETRY NOW' });
    await expect(retry).toBeVisible();
    const r = await retry.evaluate((n) => { const b = n.getBoundingClientRect(); return { x1: b.left, x2: b.right, y1: b.top, y2: b.bottom }; });
    const pane = await rectOf(page, PANE);
    expect(Math.abs(r.y2 - r.y1 - 48), `RETRY NOW 48 px tall, got ${JSON.stringify(r)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(pane.x2 - 16 - r.x2), `RETRY NOW at the line's right end, 16 px from the pane's edge (${JSON.stringify(r)})`).toBeLessThanOrEqual(1);
    expect(r.y1 >= status.y1 && r.y2 <= status.y2, 'RETRY NOW inside the status line').toBe(true);

    const line = page.locator(`${LINE}[data-line="room-down"]`);
    await expect(line).toHaveText('Sending and voice come back with the room.');
    const slot = await rectOf(page, LINE);
    const row = await rectOf(page, ROW);
    expect(slot.y2, `the line above the input row: slot ${JSON.stringify(slot)}, row ${JSON.stringify(row)}`).toBeLessThanOrEqual(row.y1 + 1);

    await expect(page.locator(SEND)).toBeDisabled();
    // C1's `none` layout (D265): no talk button, SEND in its rect.
    await expect(page.locator('[data-talk]')).toHaveCount(0);
    const send = await rectOf(page, SEND);
    for (const k of ['x1', 'x2', 'y1', 'y2']) expect(Math.abs(send[k] - SEND_RECT[k]), `SEND ${k} ${JSON.stringify(send)}`).toBeLessThanOrEqual(1);
    expect(await wallState(page)).toBe(wallBefore);
  });

  await test.step('the draft is still `how is the` and editable: typing ` night` makes it `how is the night`', async () => {
    await expect(page.locator(INPUT)).toHaveValue('how is the');
    await expect(page.locator(INPUT)).toBeEditable();
    await page.locator(INPUT).focus();
    await page.locator(INPUT).press('End');
    await page.keyboard.type(' night');
    await expect(page.locator(INPUT)).toHaveValue('how is the night');
    await expect(page.locator(SEND)).toBeDisabled();
  });

  await test.step('the board keeps going: the pane closed, the Wall tours and flies a minute later, the room still down', async () => {
    await page.locator(OPENER).tap();
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'closed');
    // §2: the pane closes, the idle minute starts; the tour takes over at 60 s (S-SCR-03's 130/190 s).
    await hand.to(66);
    await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'room-down');
    expect(await wallState(page)).toBe('tour');
    // The camera (M3, `camera()`) moves: the tour flies over the board while the room is away.
    const where = () => page.evaluate(() => {
      const c = window.__cockpitView.map.camera();
      return { x: c.x, y: c.y, z: c.z, spin: c.spin ?? 0 };
    });
    // The tour starts with the overview (its hold, Wall plan §3), then flies to a site.
    const leg = () => page.evaluate(() => window.__cockpitView.map.camera()?.want?.kind ?? null);
    await expect.poll(async () => { await page.clock.runFor(500); return leg(); }, { message: 'the tour flies to a site', timeout: 30_000, intervals: [20] }).toBe('site');
    const a = await where();
    await page.clock.runFor(500);
    const b = await where();
    const moved = ['x', 'y', 'z', 'spin'].some((k) => Math.abs(a[k] - b[k]) > 1e-6);
    expect(moved, `the camera flies (${JSON.stringify(a)} then ${JSON.stringify(b)})`).toBe(true);
  });
});

test('S-SCR-18 A blip under 5 s shows nothing', async ({ page, room }) => {
  await room.start({ turns: 2, script: 'scr-room' });
  let welcomes = 0;
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    ws.on('framereceived', ({ payload }) => {
      try { if (JSON.parse(String(payload)).type === 'welcome') welcomes += 1; } catch { /* not JSON */ }
    });
  });
  await page.clock.install({ time: new Date(LOSS.getTime() - 30_000) });
  await recordMarks(page);
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live');
  await openPane(page);
  const firstWelcomes = welcomes;
  const hand = await lose(page, room);
  const samples = [];
  const sample = async () => samples.push(await page.evaluate(() => ({
    cockpit: document.documentElement.dataset.cockpit,
    down: document.querySelectorAll('[data-cockpit-down]').length,
    status: document.querySelectorAll('[data-cockpit-status]').length,
  })));

  await test.step('every 0.5 s from 0 to 10 s: live, no status line, no strip; the reconnect accepted at 2 s', async () => {
    await sample();
    for (let s = 0.5; s <= 10; s += 0.5) {
      if (s === 2.5) {
        // t = 2 s: the room accepts again; the next try (2.52 s) is the one that opens.
        expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
      }
      await hand.to(s, { failing: s < 2.52 });
      if (s === 3) await expect.poll(() => welcomes, { message: 'the try at 2.52 s was welcomed' }).toBe(firstWelcomes + 1);
      await sample();
    }
    expect(samples).toHaveLength(21);
    for (const [i, x] of samples.entries()) {
      expect(x, `at ${i * 0.5} s`).toEqual({ cockpit: 'live', down: 0, status: 0 });
    }
  });
});

test.describe('S-SCR-19 The room comes back: the screen catches up, the draft is not sent', () => {
  test('the series, on the real clock @slow', async ({ page, room }) => {
    test.setTimeout(180_000);
    await room.start({ turns: 2, script: 'scr-room' });
    await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
    await cockpitDecided(page);
    await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live');
    await openPane(page);
    const attemptsSince = async (t0) => (await room.control('GET', '/connections')).body.items.filter((c) => c.atMs >= t0);

    await test.step('stopped, then started at t = 60 s: tries at §7.1\'s delays ± 100 ms, the 8th accepted, marks exact', async () => {
      const stopAt = Date.now();
      expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
      await new Promise((r) => setTimeout(r, Math.max(0, stopAt + 60_000 - Date.now())));
      expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
      await expect.poll(async () => (await attemptsSince(stopAt)).length, { timeout: 15_000 }).toBe(8);
      await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live', { timeout: 5_000 });
      const items = await attemptsSince(stopAt);
      const at = items.map((c) => c.atMs);
      expect(Math.abs(at[0] - stopAt - 900), `the first try 900 ± 100 ms after the stop (${at[0] - stopAt} ms)`).toBeLessThanOrEqual(100);
      for (let k = 1; k < 8; k++) {
        const gap = at[k] - at[k - 1];
        expect(Math.abs(gap - DELAYS_MS[k]), `try ${k + 1}: ${gap} ms after try ${k}, want ${DELAYS_MS[k]}`).toBeLessThanOrEqual(100);
      }
      expect(items.map((c) => c.accepted)).toEqual([false, false, false, false, false, false, false, true]);
      const m = await marks(page, 'cockpit:retry');
      expect(m.map((d) => d.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(m.map((d) => d.delayMs)).toEqual(DELAYS_MS);
    });

    await test.step('a later outage: RETRY NOW 3 s after the 3rd try tries at once (attempt 4, delayMs 0), then 9447.84 ms to attempt 5', async () => {
      const marksBefore = (await marks(page, 'cockpit:retry')).length;
      const stopAt = Date.now();
      expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
      await expect.poll(async () => (await attemptsSince(stopAt)).length, { timeout: 10_000 }).toBe(3);
      const third = (await attemptsSince(stopAt))[2].atMs;
      const retry = page.locator(STATUS).getByRole('button', { name: 'RETRY NOW' });
      await expect(retry).toBeVisible(); // room-down since 5 s; the 3rd try was at 5.436 s
      await new Promise((r) => setTimeout(r, Math.max(0, third + 3000 - Date.now())));
      const tapAt = Date.now();
      await retry.tap();
      await expect.poll(async () => (await attemptsSince(stopAt)).length, { timeout: 2_000 }).toBe(4);
      const fourth = (await attemptsSince(stopAt))[3].atMs;
      expect(fourth - tapAt, `the 4th try ${fourth - tapAt} ms after the tap`).toBeLessThanOrEqual(300);
      await expect.poll(async () => (await attemptsSince(stopAt)).length, { timeout: 12_000 }).toBe(5);
      const fifth = (await attemptsSince(stopAt))[4].atMs;
      expect(Math.abs(fifth - fourth - 9447.84), `the 5th try ${fifth - fourth} ms after the 4th`).toBeLessThanOrEqual(100);
      const m = (await marks(page, 'cockpit:retry')).slice(marksBefore);
      expect(m.slice(3, 5)).toEqual([{ attempt: 4, delayMs: 0 }, { attempt: 5, delayMs: 9447.84 }]);
      expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
    });
  });

  test('what the screen shows, on page.clock', async ({ page, room, fakeAgent }) => {
    test.setTimeout(150_000);
    await room.start({ turns: 2, script: 'scr-room' });
    await page.clock.install({ time: new Date(LOSS.getTime() - 30_000) });
  await recordMarks(page);
    await openWall(page, room);
    await openPane(page);
    const log = fakeAgentLog(fakeAgent.dir);

    // The turn the room answers meanwhile (build B244): asked just before the loss, it streams on
    // the fake agent's real 20 s while the link is down; the page has its first part only.
    await page.locator(INPUT).fill('tell me everything');
    await page.locator(SEND).tap();
    await expect(page.locator('[data-turn-id]')).toHaveCount(3);
    await expect(page.locator('[data-turn-id]').last()).toContainText('Part 1 of the long answer.');
    await page.locator(INPUT).fill('how is the');
    const prompts = log.prompts().length;
    expect(prompts).toBe(1);
    const hand = await lose(page, room);

    await test.step('room-down at 5 s, then the minutes count and the retry counts down to the 8th try', async () => {
      await hand.to(5);
      await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'room-down');
      await expect(page.locator(STATUS_TEXT)).toHaveText('Cockpit room unreachable since 06:41 (0 min). Retrying in 1 s.');
      await hand.to(36);
      await expect(page.locator(STATUS_TEXT)).toHaveText('Cockpit room unreachable since 06:41 (0 min). Retrying in 15 s.');
      // Meanwhile the room finished the turn on its own (real time).
      await expect.poll(async () => (await room.control('GET', '/sent?type=turn.end')).body.items.length, { timeout: 30_000 }).toBeGreaterThan(0);
      await hand.to(60);
      await expect(page.locator(STATUS_TEXT)).toHaveText('Cockpit room unreachable since 06:41 (1 min). Retrying in 6 s.');
      await expect(page.locator(INPUT)).toHaveValue('how is the');
    });

    await test.step('started at 60 s: the 8th try (65.1326 s) is accepted, live by 66.2 s, `Back since 06:42.` for 5 s', async () => {
      expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
      await hand.to(65.2, { failing: false });
      // The handshake runs in real time; the page draws a frame each 16 ms of its clock.
      await expect.poll(async () => {
        if ((await page.evaluate(() => document.documentElement.dataset.cockpit)) === 'live') return true;
        if (hand.at() < 66_200) { await page.clock.runFor(16); return false; }
        return 'late';
      }, { timeout: 10_000, intervals: [50] }).toBe(true);
      await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'back');
      await expect(page.locator(STATUS_TEXT)).toHaveText('Back since 06:42.');
      const shownAt = await page.evaluate(() => Date.now());
      await page.clock.runFor(Math.max(0, shownAt + 4_900 - (await page.evaluate(() => Date.now()))));
      await expect(page.locator(STATUS_TEXT)).toHaveText('Back since 06:42.');
      await page.clock.runFor(200);
      await expect(page.locator(STATUS)).toHaveCount(0);
    });

    await test.step('the missed turn whole and in order, SEND enabled, the draft in the input, no prompt sent', async () => {
      const last = page.locator('[data-turn-id]').last();
      await expect(page.locator('[data-turn-id]')).toHaveCount(3);
      await expect(page.locator(ROOT)).toHaveAttribute('data-turn', 'idle');
      const text = await last.innerText();
      const parts = [...text.matchAll(/Part (\d+) of the long answer\./g)].map((m) => Number(m[1]));
      expect(parts).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
      await expect(page.locator(SEND)).toBeEnabled();
      await expect(page.locator('[data-talk]')).toHaveCount(0);
      await expect(page.locator(INPUT)).toHaveValue('how is the');
      expect(log.prompts().length, 'the fake agent got no new user turn').toBe(prompts);
    });
  });
});
