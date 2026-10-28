// C1, build 15: the Wall's tour and idle minute with the pane (spec screens.md §2, §9.1, D4, D5).
// Every run is on the Wall page in `wall` layout at `?ratio=0.5` (build B122), with the page's clock
// installed and the room's on `manual`: from the tap on, both move only by hand, 10 s at a time, so
// the room link hears a heartbeat in every step and stays live (build B235, B238). The page's clock
// is paused while it is moved by hand, so the Wall draws a frame only when the clock runs (`frames`).
import { test, expect, cockpitDecided, WALL_PAGE } from './fixtures.mjs';

const T0 = new Date('2026-10-28T07:00:00Z');
const ROOT = ':root';
const OPENER = '[data-cockpit-open]';
const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
/** Empty sky on the galaxy at 1368x912, left of where the pane opens, clear of the Wall's words (checked below). */
const SKY = { x: 380, y: 240 };

function heartbeats(page) {
  const seen = { n: 0 };
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    ws.on('framereceived', ({ payload }) => {
      try { if (JSON.parse(String(payload)).type === 'heartbeat') seen.n += 1; } catch { /* not JSON */ }
    });
  });
  return seen;
}

/** The Wall page touring, the room link live, the page's clock installed at T0 and running. */
async function openWall(page, room, opts = {}) {
  await room.start({ script: 'scr-room', clock: { set: T0.toISOString(), mode: 'manual' }, ...opts });
  await page.clock.install({ time: T0 });
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await page.waitForFunction(() => document.documentElement.dataset.wallState === 'tour' && Boolean(window.__cockpitView?.wall));
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit-layout', 'wall');
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live');
}

/**
 * The page's clock, paused from now on, and a hand that moves it with the room's: `to(s)` brings
 * both to `s` seconds after `t0` (the page's ms at the pause) in steps of at most 10 s, waiting for
 * each step's heartbeat on the page, then lets the page draw two frames (34 ms of page clock);
 * `to(s, {draw: false})` stops on `s` exactly, for a tap that the scenario puts at `s`.
 * `until(fn)` draws frames (16 ms each) until `fn()` resolves truthy.
 */
async function hand(page, room, beats) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
  const t0 = await page.evaluate(() => Date.now());
  let at = 0; // page ms after t0
  const frames = async (ms = 34) => { await page.clock.runFor(ms); at += ms; };
  const to = async (s, { draw = true } = {}) => {
    const want = s * 1000;
    expect(want, `the hand only moves forward (at ${at} ms)`).toBeGreaterThanOrEqual(at);
    while (at < want) {
      const step = Math.min(10_000, want - at);
      const n = beats.n;
      await page.clock.fastForward(step);
      at += step;
      const r = await room.control('POST', '/clock', { advanceMs: step });
      expect(r.status, `the room's clock moved ${step} ms`).toBe(200);
      if (step === 10_000) await expect.poll(() => beats.n, { message: 'a heartbeat each 10 s step', timeout: 5000 }).toBeGreaterThan(n);
    }
    if (draw) await frames();
  };
  const until = (fn, message, timeout = 5000) => expect.poll(async () => { await frames(16); return fn(); }, { message, timeout, intervals: [50] }).toBeTruthy();
  return { t0, to, frames, until, now: () => at };
}

const wallState = (page) => page.evaluate(() => document.documentElement.dataset.wallState);
const want = (page) => page.evaluate(() => window.__cockpitView.map.camera()?.want ?? null);

/** Run the page's clock (frames drawn) until the tour flies to a site: the moment its leg starts. */
async function untilTourFliesToSite(page) {
  await page.waitForFunction(() => window.__cockpitView.map.camera()?.want?.kind !== 'site', null, { timeout: 40_000, polling: 'raf' });
  return page.waitForFunction(() => {
    const w = window.__cockpitView.map.camera()?.want;
    return w?.kind === 'site' && w.id;
  }, null, { timeout: 40_000, polling: 'raf' }).then((h) => h.jsonValue());
}

/** SKY is empty sky: the stage is under it and no site is drawn within 80 px. */
async function skyIsEmpty(page) {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const stage = document.getElementById('galaxy-stage');
    const v = window.__cockpitView.map;
    const near = ['lab', 'hv1'].map((id) => v.screenOf(id)).filter(Boolean).some((p) => Math.hypot(p.x - x, p.y - y) < 80);
    return Boolean(stage?.contains(el)) && !near;
  }, SKY);
}

test('S-SCR-02 A tap leaves the tour, a minute alone brings it back', async ({ page, room }) => {
  test.setTimeout(120_000);
  const beats = heartbeats(page);
  await openWall(page, room);
  await untilTourFliesToSite(page);
  expect(await skyIsEmpty(page), 'the tap lands on empty sky').toBe(true);

  await test.step('a tap at t = 0: explore and the tour\'s flight stopped by 0.2 s; explore at 59 s, tour at 60 s with the overview', async () => {
    const h = await hand(page, room, beats);
    expect((await want(page))?.kind, 'the tour is flying to a site').toBe('site');
    await page.touchscreen.tap(SKY.x, SKY.y);
    await h.frames(200);
    expect(await wallState(page)).toBe('explore');
    // The tour's leg is cut: the camera eases out to the overview (the waking touch, docs/wall.md).
    expect((await want(page))?.kind, 'the tour\'s flight has stopped').toBe('overview');
    await h.to(59);
    expect(await wallState(page)).toBe('explore');
    await h.to(60);
    expect(await wallState(page)).toBe('tour');
    // The tour starts with the overview: a hand-back flies from the overview, the camera there now.
    expect((await want(page))?.kind).toBe('overview');
  });

  await test.step('second run: a tap at 0 and again at 40 s moves the return to 100 s (99 s explore, 100 s tour)', async () => {
    await page.clock.runFor(2000); // the tour flies on; the hand restarts at the next tap
    const h = await hand(page, room, beats);
    await page.touchscreen.tap(SKY.x, SKY.y);
    await h.frames(200);
    expect(await wallState(page)).toBe('explore');
    await h.to(39);
    expect(await wallState(page)).toBe('explore');
    await h.to(40, { draw: false });
    await page.touchscreen.tap(SKY.x, SKY.y);
    await h.to(60);
    expect(await wallState(page), 'the first tap\'s minute is gone').toBe('explore');
    await h.to(99);
    expect(await wallState(page)).toBe('explore');
    await h.to(100);
    expect(await wallState(page)).toBe('tour');
  });
});

test('S-SCR-03 Opening the pane stops the tour where it is and holds it', async ({ page, room }) => {
  test.setTimeout(120_000);
  const beats = heartbeats(page);
  await openWall(page, room);
  const site = await untilTourFliesToSite(page);
  const h = await hand(page, room, beats);
  const at = () => page.evaluate((id) => window.__cockpitView.map.screenOf(id), site);

  let still;
  await test.step('CHAT at t = 0 mid-flight: the pane open, explore, the camera holding the frame it had', async () => {
    expect((await want(page))?.kind, 'the tour mid-flight to the site').toBe('site');
    await page.locator(OPENER).tap();
    await h.frames(200);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
    await expect(page.locator(OPENER)).toHaveText('CLOSE');
    expect(await wallState(page)).toBe('explore');
    still = await at();
    expect(still, `${site} is drawn`).not.toBeNull();
  });

  await test.step('at 120 s still explore (the idle timer paused while the pane is open), the camera moved < 1 px', async () => {
    await h.to(120);
    expect(await wallState(page)).toBe('explore');
    expect(await page.evaluate(() => window.__cockpitView.wall.idle.remaining()), 'held').toBeNull();
    const now = await at();
    expect(Math.hypot(now.x - still.x, now.y - still.y)).toBeLessThan(1);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
  });

  await test.step('CLOSE at 130 s: explore at 189 s, the tour at 190 s', async () => {
    await h.to(129.8);
    const now = await at();
    expect(Math.hypot(now.x - still.x, now.y - still.y), 'still the frame of the tap').toBeLessThan(1);
    await h.to(130, { draw: false });
    await page.locator(OPENER).tap();
    await h.frames(166); // the tap at 130 s, the slide out drawn
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'closed');
    await expect(page.locator(OPENER)).toHaveText('CHAT');
    await h.to(189);
    expect(await wallState(page)).toBe('explore');
    await h.to(190);
    expect(await wallState(page)).toBe('tour');
  });
});

test('S-SCR-04 The pane closes itself after five idle minutes, never during a turn', async ({ page, room, fakeAgent }) => {
  test.setTimeout(180_000);
  const beats = heartbeats(page);
  await openWall(page, room);
  // B34's `stay a while` streams for 400 s of the fake agent's real ms; it has no room clock, so
  // the turn is kept running in real time (a line every 2 s) until the page's clock is past 400 s,
  // and then it ends (build B238).
  fakeAgent.edit((sc) => {
    const turn = sc.turns.find((t) => t.match === 'stay a while');
    turn.steps = [
      ...Array.from({ length: 30 }, (_, i) => ({ at: i * 2000, text: `Still here, ${(i + 1) * 20} s in.\n` })),
      { at: 60_000, end: 'done' },
    ];
  });
  await page.locator(OPENER).tap();
  await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
  await page.locator(INPUT).fill('stay a while');
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
  const h = await hand(page, room, beats);
  // The page's clock at the moment the turn is drawn as over (B235's way of reading it).
  await page.evaluate(() => {
    window.__endedAt = null;
    const root = document.documentElement;
    new MutationObserver(() => {
      if (root.dataset.turn === 'idle' && window.__sentAt != null && window.__endedAt == null) window.__endedAt = Date.now();
    }).observe(root, { attributes: true, attributeFilter: ['data-turn'] });
  });

  await test.step('a prompt at t = 0: the turn runs; the pane still open at 400 s; a draft typed meanwhile', async () => {
    await page.evaluate(() => { window.__sentAt = Date.now(); });
    await page.locator(SEND).tap();
    await h.frames(100);
    await h.until(() => page.evaluate(() => document.documentElement.dataset.turn !== 'idle'), 'the turn runs');
    await h.until(() => page.locator('[data-reply]').last().textContent().then((t) => t.includes('Still here')), 'the reply streams in');
    await page.locator(INPUT).fill('and the backups?');
    await h.to(300);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
    await h.to(400);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
    await expect(page.locator(ROOT), 'a turn is running at 400 s').not.toHaveAttribute('data-turn', 'idle');
    expect(await wallState(page)).toBe('explore');
  });

  let end;
  await test.step('the turn ends at 400 s: open at 699 s, closed at 700 s (300 s later)', async () => {
    // The page's clock stays at 400 s while the fake agent's turn runs out in real time.
    await expect.poll(async () => { await h.frames(1); return page.evaluate(() => window.__endedAt); }, { timeout: 90_000, intervals: [500] }).not.toBeNull();
    end = (await page.evaluate(() => window.__endedAt - window.__sentAt)) / 1000;
    expect(end, 'the turn drawn as over at 400 s').toBeGreaterThanOrEqual(400);
    expect(end).toBeLessThan(400.2);
    await h.to(end + 299);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
    expect(await wallState(page)).toBe('explore');
    await h.to(end + 300);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'closed');
    await expect(page.locator(OPENER)).toHaveText('CHAT');
  });

  await test.step('the tour resumes 60 s after the close: explore at 759 s, tour at 760 s', async () => {
    await h.to(end + 359);
    expect(await wallState(page)).toBe('explore');
    await h.to(end + 360);
    expect(await wallState(page)).toBe('tour');
  });

  await test.step('reopened: the draft typed before the close is in the input', async () => {
    await page.locator(OPENER).tap();
    await h.frames(200);
    await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
    await expect(page.locator(INPUT)).toHaveValue('and the backups?');
  });
});
