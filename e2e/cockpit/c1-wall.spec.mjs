// C1, build 7: the pane on the Wall page (spec c1-talk.md §1-§2, screens.md §2, §4, §9.1).
// C1 boots with `stt.url: none` (D265): no talk button, SEND in its rect (screens.md §4.1).
// The Wall page is drawn at `?ratio=0.5` (docs/wall.md's own switch, build B122): this
// machine draws WebGL in software, and a full-ratio frame (30-40 ms) is the galaxy's cost
// here, not the pane's; the 200 ms of B7 is asserted as written.
import { test, expect, rectOf, cockpitDecided, WALL_PAGE } from './fixtures.mjs';

const WALL_PANE = { x1: 760, x2: 1368, y1: 0, y2: 912 };
const OPENER = { x1: 1288, x2: 1336, y1: 760, y2: 808 };
const SEND_NONE = { x1: 1280, x2: 1344, y1: 824, y2: 888 }; // the talk button's rect (stt none)
const INPUT_NONE = { x1: 784, x2: 1264, y1: 824, y2: 888 };

async function openWall(page, room) {
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await page.waitForFunction(() => document.documentElement.dataset.wallState === 'tour' && Boolean(window.__cockpitView?.wall));
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit-layout', 'wall');
}

/** The next press of `type` on `selector` (or on the window) starts the clock (page ms). */
async function arm(page, selector, type = 'pointerdown') {
  await page.evaluate(([sel, t]) => {
    window.__t0 = null;
    const target = sel ? document.querySelector(sel) : window;
    target.addEventListener(t, () => { window.__t0 = performance.now(); }, { once: true, capture: true });
  }, [selector, type]);
}

/** Ms from the armed press until the pane is in place (`open`) or gone (`closed`), sampled every frame. */
async function msUntil(page, want) {
  const h = await page.waitForFunction((w) => {
    const root = document.documentElement;
    const p = document.querySelector('[data-cockpit-conversation]');
    const r = p.getBoundingClientRect();
    const ok = w === 'open'
      ? root.dataset.pane === 'open' && getComputedStyle(p).transform === 'none' && r.left === 760
      : root.dataset.pane === 'closed' && (p.hidden || r.left >= innerWidth);
    return ok && window.__t0 != null && Math.max(0.001, performance.now() - window.__t0);
  }, want, { polling: 'raf', timeout: 5000 });
  return h.jsonValue();
}

const lastTurnInSight = (page) => page.evaluate(() => {
  const convo = document.querySelector('[data-cockpit-conversation] .ck-convo');
  const turns = document.querySelectorAll('[data-turn-id]');
  if (!turns.length) return false;
  const last = turns[turns.length - 1].getBoundingClientRect();
  const box = convo.getBoundingClientRect();
  return last.bottom <= box.bottom && last.bottom > box.top;
});

test('S-C1-01 The pane opens from the Wall in 0.2 s and leaves the wall in sight (pending Q-O11)', async ({ page, room, browser }) => {
  await room.start({ turns: 3 });

  await test.step('a tap on CHAT: in place by 200 ms, the tour held, the input not focused', async () => {
    await openWall(page, room);
    await page.waitForFunction(() => document.querySelectorAll('[data-turn-id]').length === 3);
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CHAT');
    await arm(page, '[data-cockpit-open]');
    await page.locator('[data-cockpit-open]').tap();
    const ms = await msUntil(page, 'open');
    expect(ms, 'the pane in place ≤ 0.2 s after the tap (B7)').toBeLessThanOrEqual(200);
    expect(await rectOf(page, '[data-cockpit-conversation]')).toEqual(WALL_PANE);
    const pane = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[data-cockpit-conversation]'));
      return { transform: cs.transform, duration: cs.transitionDuration };
    });
    expect(pane.transform).toBe('none');
    expect(pane.duration, 'the slide is 120 ms').toBe('0.12s');
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CLOSE');
    expect(await rectOf(page, '[data-cockpit-open]')).toEqual(OPENER);
    // The talk button's half is C2's (D265): its rect holds SEND, the input to 16 px left of it.
    await expect(page.locator('[data-talk]')).toHaveCount(0);
    expect(await rectOf(page, '[data-cockpit-send]')).toEqual(SEND_NONE);
    expect(await rectOf(page, '[data-cockpit-input]')).toEqual(INPUT_NONE);
    await expect(page.locator(':root')).toHaveAttribute('data-wall-state', 'explore');
    expect(await lastTurnInSight(page), 'the latest turn\'s last line in sight').toBe(true);
    const focused = await page.evaluate(() => document.activeElement?.matches('[data-cockpit-input]') ?? false);
    expect(focused, 'a touch does not focus the input (D20)').toBe(false);
  });

  await test.step('a mouse click on CHAT: the input has the focus', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1368, height: 912 }, hasTouch: false });
    try {
      const p2 = await ctx.newPage();
      await openWall(p2, room);
      await p2.locator('[data-cockpit-open]').click();
      await expect(p2.locator(':root')).toHaveAttribute('data-pane', 'open');
      await expect(p2.locator('[data-cockpit-input]')).toBeFocused();
      await expect(p2.locator(':root')).toHaveAttribute('data-wall-state', 'explore');
    } finally {
      await ctx.close();
    }
  });
});

test('S-C1-02 Closing: both CLOSE controls and Esc close it, a tap on the wall does not', async ({ page, room }) => {
  await room.start({ turns: 0 });
  await openWall(page, room);
  // The tour holds a site left of where the pane will be (the overview's only site is under it).
  const site = await page.waitForFunction(() => {
    const v = window.__cockpitView;
    const want = v.map.camera()?.want;
    if (want?.kind !== 'site') return false;
    const at = v.map.screenOf(want.id);
    return at && at.x > 40 && at.x < 720 && at.y > 60 && at.y < 850 && want.id;
  }, null, { timeout: 40_000, polling: 200 }).then((h) => h.jsonValue());

  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await page.locator('[data-cockpit-input]').fill('how is');

  await test.step('a tap on the wall at (400, 480): the pane stays open, the Wall explores', async () => {
    await page.touchscreen.tap(400, 480);
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
    await expect(page.locator(':root')).toHaveAttribute('data-wall-state', 'explore');
  });

  await test.step('a tap on what the wall shows left of the pane: the camera goes to the tap (B121)', async () => {
    const at = await page.evaluate((id) => window.__cockpitView.map.screenOf(id), site);
    expect(at.x, 'the site is in sight left of the pane').toBeLessThan(760);
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => page.evaluate(() => {
      const w = window.__cockpitView.map.camera()?.want;
      return w?.kind === 'site' ? w.id : null;
    }), { timeout: 2000 }).toBe(site);
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
    await expect(page.locator(':root')).toHaveAttribute('data-wall-state', 'explore');
  });

  await test.step('the header CLOSE: closed by 200 ms, off screen, the opener reads CHAT', async () => {
    await arm(page, '[data-cockpit-close]');
    await page.locator('[data-cockpit-close]').tap();
    expect(await msUntil(page, 'closed')).toBeLessThanOrEqual(200);
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CHAT');
  });

  await test.step('opened again the draft is there; the opener reading CLOSE at (1312, 784) closes it by 200 ms', async () => {
    await page.locator('[data-cockpit-open]').tap();
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
    await expect(page.locator('[data-cockpit-input]')).toHaveValue('how is');
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CLOSE');
    await arm(page, '[data-cockpit-open]');
    await page.touchscreen.tap(1312, 784);
    expect(await msUntil(page, 'closed')).toBeLessThanOrEqual(200);
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CHAT');
  });

  await test.step('opened once more, Esc on a keyboard closes it', async () => {
    await page.locator('[data-cockpit-open]').tap();
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
    await page.keyboard.press('Escape');
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CHAT');
    await expect(page.locator('[data-cockpit-input]')).toHaveValue('how is');
  });
});
