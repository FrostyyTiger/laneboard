// C1, build 7: smaller screens and the browser floor (spec c1-talk.md §1.2, D249, D250).
// C1 boots with `stt.url: none` (D265): no talk button, SEND in its rect and the input to
// 16 px left of it (screens.md §4.1; at 800 wide SEND x 712-776). S-C1-45 runs with T18b
// (build B130): its last step sends a prompt and reads the reply, which T18 draws.
import { test, expect, rectOf, cockpitDecided, seedLane } from './fixtures.mjs';

/** The next `type` event on `selector` (or the window) starts the clock (page ms). */
async function arm(page, selector, type = 'pointerdown') {
  await page.evaluate(([sel, t]) => {
    window.__t0 = null;
    const target = sel ? document.querySelector(sel) : window;
    target.addEventListener(t, () => { window.__t0 = performance.now(); }, { once: true, capture: true });
  }, [selector, type]);
}

/** Ms from the armed event until the pane is open and in place at `left`, sampled every frame. */
async function msUntil(page, left) {
  const h = await page.waitForFunction((x) => {
    const p = document.querySelector('[data-cockpit-conversation]');
    const ok = document.documentElement.dataset.pane === 'open'
      && getComputedStyle(p).transform === 'none' && p.getBoundingClientRect().left === x;
    return ok && window.__t0 != null && Math.max(0.001, performance.now() - window.__t0);
  }, left, { polling: 'raf', timeout: 5000 });
  return h.jsonValue();
}

/** The rect lies inside 0..innerWidth x 0..innerHeight. */
const inside = (page, r) => page.evaluate((q) => q.x1 >= 0 && q.y1 >= 0 && q.x2 <= innerWidth && q.y2 <= innerHeight, r);

/** The Map's node `id` in page px, or null (the Map's own screenOf, as S-C1-03 reads it). */
const mapNode = (page, id) => page.evaluate(async (nid) => {
  const m = await import('/js/views/map.js');
  const at = m.getMapView()?.screenOf(nid);
  if (!at) return null;
  const c = document.querySelector('#map-root canvas').getBoundingClientRect();
  return { x: at.x + c.left, y: at.y + c.top };
}, id);

test('S-C1-46 At 800x1280 the pane is the whole screen and CLOSE is the way back (T77, D249)', async ({ page, room }) => {
  await room.start(); // c1-render, no turn played
  await page.setViewportSize({ width: 800, height: 1280 });

  await test.step('given the app on #/map at 800x1280 portrait with a node selected, the pane closed', async () => {
    await page.goto(`${room.url}/#/map`);
    await cockpitDecided(page);
    await expect(page.locator(':root')).toHaveAttribute('data-layout', 'tablet');
    await expect.poll(() => mapNode(page, 'room-b'), { timeout: 10_000 }).not.toBeNull();
    const sel = await seedLane(page);
    await page.evaluate((k) => { location.hash = `#/map?sel=${k}`; }, sel);
    await expect(page.locator('#shell')).toHaveAttribute('data-insp', 'open');
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
  });

  await test.step('a tap on CHAT: by 200 ms the pane is x 0-800, y 36-1256, no left border; the Map inert', async () => {
    await arm(page, '[data-cockpit-open]');
    await page.locator('[data-cockpit-open]').tap();
    expect(await msUntil(page, 0), 'in place ≤ 200 ms after the tap').toBeLessThanOrEqual(200);
    expect(await rectOf(page, '[data-cockpit-conversation]')).toEqual({ x1: 0, x2: 800, y1: 36, y2: 1256 });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-cockpit-conversation]')).borderLeftWidth),
      'no left border').toBe('0px');
    // The talk button's place: SEND in it with stt none, the input to 16 px left (D265).
    await expect(page.locator('[data-talk]'), 'no talk button with stt none').toHaveCount(0);
    const rects = {
      input: [await rectOf(page, '[data-cockpit-input]'), { x1: 24, x2: 696, y1: 1192, y2: 1256 }],
      SEND: [await rectOf(page, '[data-cockpit-send]'), { x1: 712, x2: 776, y1: 1192, y2: 1256 }],
      'corner CLOSE': [await rectOf(page, '[data-cockpit-open]'), { x1: 720, x2: 768, y1: 1128, y2: 1176 }],
      'header CLOSE': [await rectOf(page, '[data-cockpit-close]'), { x1: 688, x2: 784, y1: 44, y2: 92 }],
    };
    for (const [name, [got, want]] of Object.entries(rects)) {
      expect(got, name).toEqual(want);
      expect(await inside(page, got), `${name} inside the viewport`).toBe(true);
    }
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CLOSE');
    // The Map's container is the app's shell (build B131): inert, with the Map in it.
    expect(await page.evaluate(() => document.getElementById('shell').hasAttribute('inert')), 'the shell is inert').toBe(true);
    expect(await page.evaluate(() => document.getElementById('map-root').closest('[inert]')?.id), 'the Map under it').toBe('shell');
    expect(await page.evaluate(() => Boolean(document.elementFromPoint(300, 400)?.closest('[data-cockpit-conversation]'))),
      'elementFromPoint(300, 400) is in the pane').toBe(true);
  });

  test.step.skip('the fake agent shows builder-a: the pane stays open with its show line; after CLOSE builder-a at x 400 ± 24 — waits for Show', async () => {});

  await test.step('CLOSE: the inert attribute is gone and a tap at (300, 400) reaches the Map', async () => {
    await page.locator('[data-cockpit-close]').tap();
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
    expect(await page.evaluate(() => document.querySelectorAll('[inert]:not([data-cockpit-conversation])').length),
      'nothing of the page is inert').toBe(0);
    expect(await page.evaluate(() => Boolean(document.elementFromPoint(300, 400)?.closest('#map-root'))),
      'the Map is under (300, 400)').toBe(true);
    await page.evaluate(() => {
      window.__mapGot = false;
      document.getElementById('map-root').addEventListener('pointerdown', () => { window.__mapGot = true; }, { once: true });
    });
    await page.touchscreen.tap(300, 400);
    expect(await page.evaluate(() => window.__mapGot), 'the tap reached the Map').toBe(true);
  });

  await test.step('turned to 1280x800 with the pane open and the draft next: x 672-1280 in the next frame, its border back, the Map usable', async () => {
    await page.locator('[data-cockpit-open]').tap();
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
    await page.waitForFunction(() => {
      const p = document.querySelector('[data-cockpit-conversation]');
      return getComputedStyle(p).transform === 'none' && p.getBoundingClientRect().left === 0;
    }, null, { polling: 'raf' });
    await page.locator('[data-cockpit-input]').fill('next');
    expect(await page.evaluate(() => document.getElementById('shell').hasAttribute('inert'))).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    // One frame after the resize: the new rect, no slide under way.
    const next = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      const p = document.querySelector('[data-cockpit-conversation]');
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      resolve({
        x1: r.left, x2: r.right, transform: cs.transform, border: cs.borderLeftWidth,
        inert: document.getElementById('shell').hasAttribute('inert'),
        draft: document.querySelector('[data-cockpit-input]').value,
        pane: document.documentElement.dataset.pane,
      });
    })));
    expect(next).toEqual({ x1: 672, x2: 1280, transform: 'none', border: '1px', inert: false, draft: 'next', pane: 'open' });
  });
});

test('S-C1-47 Below the floor and in an old browser the board stays and says why (T77, D250)', async ({ page, room, browser }) => {
  // The phone shell's parts and what a finger meets on a grid, to compare with the board as today.
  const shellNow = () => page.evaluate(() => {
    const rect = (sel) => {
      const n = document.querySelector(sel);
      if (!n || !n.getClientRects().length) return null;
      const r = n.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom].map(Math.round);
    };
    const parts = {};
    for (const s of ['header.shell-head', '.shell-strip', '.shell-sheet', '#shell-main', 'footer.shell-bar', '.toasts']) parts[s] = rect(s);
    const grid = [];
    for (let x = 40; x < innerWidth; x += 120) {
      for (let y = 40; y < innerHeight; y += 160) {
        const n = document.elementFromPoint(x, y);
        grid.push(n ? `${n.tagName}#${n.id}.${n.className?.baseVal ?? n.className}` : '-');
      }
    }
    return { layout: document.documentElement.dataset.layout, parts, grid };
  });

  let today = null;
  await test.step('the board as today at 640x900: no cockpit configured', async () => {
    await room.start({ cockpit: false });
    await page.setViewportSize({ width: 640, height: 900 });
    await page.goto(`${room.url}/#/map`);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'unconfigured');
    await page.waitForTimeout(1000); // the phone shell has drawn its strip and sheet
    today = await shellNow();
    expect(today.layout).toBe('phone');
  });

  await test.step('the app at 640x900 with the cockpit configured: neither control, the phone shell unchanged', async () => {
    await room.start();
    await page.goto(`${room.url}/#/map`);
    await cockpitDecided(page);
    await expect(page.locator(':root')).not.toHaveAttribute('data-cockpit', 'unconfigured');
    await expect(page.locator('[data-talk]')).toHaveCount(0);
    await expect(page.locator('[data-cockpit-open]')).toHaveCount(0);
    await expect(page.locator('[data-cockpit-conversation]')).toBeHidden();
    await expect.poll(shellNow, { message: 'the phone shell as without a cockpit', timeout: 5000 }).toEqual(today);
  });

  await test.step('grown to 1024x768: both controls at §1.2\'s rects within 0.5 s, data-pane closed', async () => {
    await arm(page, null, 'resize');
    await page.setViewportSize({ width: 1024, height: 768 });
    const ms = await page.waitForFunction(() => {
      const n = document.querySelector('[data-cockpit-open]');
      if (!n) return false;
      const r = n.getBoundingClientRect();
      const ok = r.left === 944 && r.right === 992 && r.top === 616 && r.bottom === 664;
      return ok && window.__t0 != null && Math.max(0.001, performance.now() - window.__t0);
    }, null, { polling: 'raf', timeout: 5000 }).then((h) => h.jsonValue());
    expect(ms, 'drawn within 0.5 s').toBeLessThanOrEqual(500);
    const opener = await rectOf(page, '[data-cockpit-open]');
    expect(opener, 'CHAT at x 944-992, y 616-664').toEqual({ x1: 944, x2: 992, y1: 616, y2: 664 });
    expect(await inside(page, opener)).toBe(true);
    await expect(page.locator('[data-cockpit-open]')).toHaveText('CHAT');
    // The talk button is C2's (D265): with stt none it is not drawn here either.
    await expect(page.locator('[data-talk]')).toHaveCount(0);
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
  });

  await test.step('a browser without inert at 1368x912: the pane says it is too old, no input, no link', async () => {
    await room.start(); // a room no page has linked to
    const ctx = await browser.newContext({ viewport: { width: 1368, height: 912 }, hasTouch: true });
    try {
      await ctx.addInitScript(() => { delete HTMLElement.prototype.inert; });
      const p2 = await ctx.newPage();
      const sockets = [];
      p2.on('websocket', (ws) => { if (ws.url().includes('/api/cockpit/ws')) sockets.push(ws.url()); });
      await p2.goto(`${room.url}/#/map`);
      expect(await p2.evaluate(() => 'inert' in HTMLElement.prototype)).toBe(false);
      await cockpitDecided(p2);
      await p2.locator('[data-cockpit-open]').tap();
      await expect(p2.locator(':root')).toHaveAttribute('data-pane', 'open');
      const old = p2.locator('[data-cockpit-conversation] [data-cockpit-unsupported]');
      await expect(old).toHaveText('This browser is too old for the cockpit. It needs Chrome 108 or Safari 16 or newer.');
      await expect(p2.locator('[data-cockpit-conversation] header [data-cockpit-close]'), 'the header is there').toBeVisible();
      await expect(p2.locator('[data-cockpit-input]')).toHaveCount(0);
      await expect(p2.locator('[data-talk]')).toHaveCount(0);
      await p2.waitForTimeout(1000); // a link the page might open late
      expect(sockets, 'the page opened no room link').toEqual([]);
      const conn = await room.control('GET', '/connections');
      expect(conn.status).toBe(200);
      expect(conn.body.items, 'the room saw no link').toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
