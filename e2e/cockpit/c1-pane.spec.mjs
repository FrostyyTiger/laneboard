// C1, build 7: the cockpit button and the pane on the app (spec c1-talk.md §1-§2,
// §5.1; screens.md §4, §7). C1 boots with `stt.url: none` (D265): no talk button,
// SEND in its rect (screens.md §4.1).
import { test, expect, VIEWS, WALL_PAGE, rectOf, cockpitDecided, intersects, holdOutbound, seedLane, colourVsToken } from './fixtures.mjs';

// screens.md §4 / §4.1 at 1368x912
const CHAT = { x1: 1288, x2: 1336, y1: 760, y2: 808 };
const SEND_NONE = { x1: 1280, x2: 1344, y1: 824, y2: 888 }; // SEND in the talk button's rect (stt none)
const INPUT_NONE = { x1: 784, x2: 1264, y1: 824, y2: 888 };
const APP_PANE = { x1: 760, x2: 1368, y1: 36, y2: 888 };

const pageMs = (page) => page.evaluate(() => performance.now());

/** The `stt.url: none` layout in the talk button's place (slices.md §3.1, D265, screens.md §4.1). */
async function expectNoneLayout(page, where = '') {
  await expect(page.locator('[data-talk]'), `${where}: no talk button`).toHaveCount(0);
  expect(await rectOf(page, '[data-cockpit-send]'), `${where}: SEND in the talk button's rect`).toEqual(SEND_NONE);
  expect(await rectOf(page, '[data-cockpit-input]'), `${where}: the input to 16 px left of SEND`).toEqual(INPUT_NONE);
}

async function openApp(page, room, hash = '#/map') {
  await page.goto(`${room.url}/${hash}`);
  await cockpitDecided(page);
}

test('S-SCR-09 The cockpit button on every app view, in the same place as on the Wall (pending Q-O11)', async ({ page, room }) => {
  await test.step('configured: one CHAT on every view, at its rect, clear of the bar, the header and the toasts', async () => {
    await room.start({ turns: 3 });
    // The Wall page's rects first (S-SCR-01 reads them there; B119): the app's must equal them.
    await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
    await cockpitDecided(page);
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CHAT');
    const wallChat = await rectOf(page, '[data-cockpit-open]');
    expect(wallChat, 'the Wall page: CHAT at screens.md §4\'s rect').toEqual(CHAT);
    await expect(page.locator('[data-talk]'), 'the Wall page: no talk button with stt none').toHaveCount(0);
    await page.locator('[data-cockpit-open]').tap();
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CLOSE');
    await expect.poll(() => rectOf(page, '[data-cockpit-conversation]'), 'the Wall page: the pane in place')
      .toEqual({ x1: 760, x2: 1368, y1: 0, y2: 912 });
    const wallClose = await rectOf(page, '[data-cockpit-open]');
    const wallSend = await rectOf(page, '[data-cockpit-send]');
    await openApp(page, room);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', /connecting|live/);
    await page.evaluate(() => import('/js/ui/toast.js').then((m) => { m.toast('A toast to keep in sight', { timeout: 0 }); }));
    for (const view of VIEWS) {
      await page.evaluate((v) => { location.hash = `#/${v}`; }, view);
      await page.waitForFunction((v) => location.hash.startsWith(`#/${v}`), view);
      // The talk button's half is C2's (D265): with stt none no [data-talk] is drawn.
      await expect(page.locator('[data-talk]'), `${view}: no talk button with stt none`).toHaveCount(0);
      await expect(page.locator('[data-cockpit-open]'), view).toHaveCount(1);
      await expect(page.locator('[data-cockpit-open]'), view).toHaveText('CHAT');
      // The rects of screens.md §4, the Wall page's (D116), to the pixel.
      const chat = await rectOf(page, '[data-cockpit-open]');
      expect(chat, `${view}: CHAT rect`).toEqual(CHAT);
      expect(chat, `${view}: CHAT where the Wall page has it, to the pixel`).toEqual(wallChat);
      const bar = await rectOf(page, 'footer.shell-bar');
      expect(bar.y1, `${view}: the bar at y 888`).toBe(888);
      expect(intersects(chat, bar), `${view}: CHAT clear of the bar`).toBe(false);
      const head = await rectOf(page, 'header.shell-head');
      expect(intersects(chat, head), `${view}: CHAT clear of the header`).toBe(false);
      const toasts = await rectOf(page, '.toasts');
      expect(toasts.y2, `${view}: the toast stack ends at y ≤ 736`).toBeLessThanOrEqual(736);
      expect(intersects(chat, toasts), `${view}: CHAT clear of the toasts`).toBe(false);
      // A tap opens the pane over the view; CHAT reads CLOSE in the same rect; the hash stays.
      const hash = await page.evaluate(() => location.hash);
      await page.locator('[data-cockpit-open]').tap();
      await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
      await expect(page.locator('[data-cockpit-open]')).toHaveText('CLOSE');
      expect(await rectOf(page, '[data-cockpit-open]'), `${view}: CLOSE in CHAT's rect`).toEqual(CHAT);
      expect(await rectOf(page, '[data-cockpit-open]'), `${view}: CLOSE where the Wall page has it`).toEqual(wallClose);
      await expect.poll(() => rectOf(page, '[data-cockpit-conversation]'), `${view}: the pane over the view`).toEqual(APP_PANE);
      expect(await rectOf(page, '[data-cockpit-send]'), `${view}: SEND where the Wall page has it`).toEqual(wallSend);
      await expectNoneLayout(page, view);
      expect(await page.evaluate(() => location.hash), `${view}: the hash is unchanged`).toBe(hash);
      await page.locator('[data-cockpit-open]').tap();
      await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
      expect(await page.evaluate(() => location.hash)).toBe(hash);
    }
  });

  await test.step('not configured: no view has either control, the toast stack where it is today', async () => {
    await room.start({ cockpit: false });
    await openApp(page, room);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'unconfigured');
    await page.evaluate(() => import('/js/ui/toast.js').then((m) => { m.toast('A toast to keep in sight', { timeout: 0 }); }));
    for (const view of VIEWS) {
      await page.evaluate((v) => { location.hash = `#/${v}`; }, view);
      await page.waitForFunction((v) => location.hash.startsWith(`#/${v}`), view);
      await expect(page.locator('[data-talk]'), view).toHaveCount(0);
      await expect(page.locator('[data-cockpit-open]'), view).toHaveCount(0);
      // Today: components.css `.toasts { bottom: calc(var(--tape-h) + var(--sp-2)) }`.
      const today = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return innerHeight - parseFloat(cs.getPropertyValue('--tape-h')) - parseFloat(cs.getPropertyValue('--sp-2'));
      });
      expect((await rectOf(page, '.toasts')).y2, `${view}: the toast stack as today`).toBe(today);
    }
  });
});

test('S-C1-03 The pane over the Map leaves the Map usable', async ({ page, room }) => {
  await room.start();
  await openApp(page, room, '#/map');
  const mapNode = (id) => page.evaluate(async (nid) => {
    const m = await import('/js/views/map.js');
    const at = m.getMapView()?.screenOf(nid);
    if (!at) return null;
    const c = document.querySelector('#map-root canvas').getBoundingClientRect();
    return { x: at.x + c.left, y: at.y + c.top };
  }, id);
  await expect.poll(() => mapNode('room-b'), { timeout: 10_000 }).not.toBeNull();
  // Given a node selected and the inspector open (B114: the lane is handed to the page's store).
  const sel = await seedLane(page);
  await page.evaluate((k) => { location.hash = `#/map?sel=${k}`; }, sel);
  await expect(page.locator('#shell')).toHaveAttribute('data-insp', 'open');
  const hash = await page.evaluate(() => location.hash);

  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await expect.poll(() => rectOf(page, '[data-cockpit-conversation]')).toEqual(APP_PANE);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-cockpit-conversation]')).zIndex)).toBe('35');
  // The header and the tape are not covered; the inspector is under the pane.
  const pane = await rectOf(page, '[data-cockpit-conversation]');
  expect(intersects(pane, await rectOf(page, 'header.shell-head'))).toBe(false);
  expect(intersects(pane, await rectOf(page, 'footer.shell-bar'))).toBe(false);
  const insp = await page.evaluate(() => {
    const n = document.querySelector('#shell-insp, .shell-insp, [data-insp-panel]');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const x = Math.min(r.right - 4, innerWidth - 4);
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { right: r.right, z: getComputedStyle(n).zIndex, under: Boolean(top?.closest('[data-cockpit-conversation]')) };
  });
  expect(insp, 'the inspector is drawn').not.toBeNull();
  expect(insp.under, 'the pane is on top of the inspector').toBe(true);
  expect(await page.evaluate(() => location.hash), 'the hash is unchanged').toBe(hash);

  // A drag on the Map at (300, 400) pans it, with the pane still open.
  const before = await mapNode('room-a');
  await page.mouse.move(300, 400);
  await page.mouse.down();
  await page.mouse.move(360, 440, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const after = await mapNode('room-a');
    return Math.hypot(after.x - before.x, after.y - before.y);
  }, { message: 'the drag panned the Map' }).toBeGreaterThan(20);
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');

  // A tap on another node at x < 760 selects it, with the pane still open.
  // Let the pan's glide settle before aiming at a node.
  let prev = null;
  await expect.poll(async () => {
    const at = await mapNode('room-a');
    const still = prev && Math.hypot(at.x - prev.x, at.y - prev.y) < 0.5;
    prev = at;
    return still;
  }, { message: 'the Map comes to rest', intervals: [150] }).toBe(true);
  let other = null;
  for (const id of ['room-b', 'room-c', 'room-a', 'ci', 'backup']) {
    const at = await mapNode(id);
    if (at && at.x < 760 && at.x > 40 && at.y > 60 && at.y < 870) { other = { id, ...at }; break; }
  }
  expect(other, 'a node in sight left of the pane').not.toBeNull();
  await page.touchscreen.tap(other.x, other.y);
  await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toMatch(new RegExp(`[?&]sel=${other.id}(&|$)`));
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
});

test('S-C1-26 A fresh screen says it is connecting, then never shows a blank pane', async ({ page, room }) => {
  await test.step('welcome held back 2 s: connecting, then the 3 turns with the last one\'s end in sight', async () => {
    await room.start({ turns: 3 });
    await holdOutbound(page, { type: 'welcome', ms: 2000 });
    await page.goto(`${room.url}/#/map`);
    await cockpitDecided(page);
    // At 0.5 s the owner opens the pane.
    const now = await pageMs(page);
    if (now < 500) await page.waitForTimeout(500 - now);
    await page.locator('[data-cockpit-open]').tap();
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'connecting');
    await expect(page.locator('[data-cockpit-conversation] .ck-convo')).toHaveText('Connecting to the cockpit room…');
    await expect(page.locator('[data-cockpit-send]')).toBeDisabled();
    // c1-talk.md §5.1: the header shows READY greyed until the room is live (review 18-owner, finding 4).
    await expect(page.locator('[data-cockpit-turn]')).toHaveText('READY');
    const greyed = await colourVsToken(page, '[data-cockpit-turn]', '--text-3');
    expect(greyed.got, 'READY greyed (--text-3) while connecting').toBe(greyed.want);
    await page.locator('[data-cockpit-input]').fill('how is');
    await expect(page.locator('[data-cockpit-input]')).toHaveValue('how is');
    await expect(page.locator('[data-cockpit-send]'), 'SEND stays disabled while connecting').toBeDisabled();
    // By 2.5 s the 3 turns are drawn with the last one's end in sight and the line is gone.
    await expect.poll(() => rectOf(page, '[data-cockpit-conversation]')).toEqual(APP_PANE);
    await expectNoneLayout(page, 'connecting');
    await page.waitForFunction(() => document.querySelectorAll('[data-turn-id]').length === 3, null, { timeout: 3000 });
    expect(await pageMs(page), 'drawn by 2.5 s').toBeLessThanOrEqual(2500);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
    await expect(page.getByText('Connecting to the cockpit room…')).toBeHidden();
    const lit = await colourVsToken(page, '[data-cockpit-turn]', '--text-2');
    expect(lit.got, 'READY in --text-2 once live').toBe(lit.want);
    const endInSight = await page.evaluate(() => {
      const convo = document.querySelector('[data-cockpit-conversation] .ck-convo');
      const turns = document.querySelectorAll('[data-turn-id]');
      const last = turns[turns.length - 1].getBoundingClientRect();
      const box = convo.getBoundingClientRect();
      return last.bottom <= box.bottom && last.bottom > box.top;
    });
    expect(endInSight, 'the last turn\'s end in sight').toBe(true);
  });

  await test.step('an empty conversation: the none variant of the empty line, until a prompt is sent', async () => {
    await room.start({ turns: 0 });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.goto(`${room.url}/#/map`);
    await cockpitDecided(page);
    await page.locator('[data-cockpit-open]').tap();
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
    await expect(page.locator('[data-cockpit-conversation] .ck-convo')).toHaveText('Nothing said yet. Type a question below.');
    await expect(page.locator('[data-turn-id]')).toHaveCount(0);
    await expectNoneLayout(page, 'empty');
  });

  await test.step('the room not answering at all: at 5 s room-down, the status line since the load\'s HH:MM', async () => {
    expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
    await page.goto('about:blank'); // a fresh load, not a hash change on the same page
    await page.goto(`${room.url}/#/map`);
    const loadHHMM = await page.evaluate(() => {
      const d = new Date(performance.timeOrigin);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    await cockpitDecided(page);
    await page.locator('[data-cockpit-open]').tap();
    const at = await pageMs(page);
    expect(at).toBeLessThan(5000);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'connecting');
    await page.waitForFunction(() => document.documentElement.dataset.cockpit === 'room-down', null, { timeout: 7000 });
    const downAt = await pageMs(page);
    expect(downAt, 'room-down at 5 s').toBeGreaterThanOrEqual(4950);
    expect(downAt, 'room-down at 5 s').toBeLessThanOrEqual(5300);
    const status = page.locator('[data-cockpit-status]');
    await expect(status).toHaveAttribute('data-status', 'room-down');
    await expect(status).toContainText(`Cockpit room unreachable since ${loadHHMM}`);
    await expect(page.getByText('Connecting to the cockpit room…')).toBeHidden();
    await expect(page.locator('[data-cockpit-send]')).toBeDisabled();
    const greyed = await colourVsToken(page, '[data-cockpit-turn]', '--text-3');
    expect(greyed.got, 'READY greyed (--text-3) while the room is down').toBe(greyed.want);
  });
});
