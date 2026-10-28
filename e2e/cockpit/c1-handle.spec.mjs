// C1, build 7: the cockpit's handle `window.__cockpitView` on every page (spec screens.md §9,
// §9.1-§9.3, D221, D222). On the app: `{page: 'app', wall: null, map}`, `map` swapped by the
// router, M1 flyTo / M3 camera / M5 screenOf / M6 nodeAt in page px (public/js/cockpit/app-view.js
// over createMap). On the Wall page: T16's W1-W6 (build B123). Every value through
// `page.evaluate` on the handle, with `page.clock.install()`. The Wall page is drawn at
// `?ratio=0.5` (build B122).
import { test, expect, cockpitDecided, WALL_PAGE } from './fixtures.mjs';

/** The Map's own screenOf of the node the handle calls `builder-a` (its id `builder:builder-a`, B127). */
const MAP_ID = 'builder:builder-a';

test('S-SCR-35 One handle on every page: what it holds where (Wall contract)', async ({ page, room }) => {
  await room.start();
  await page.clock.install();
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  // The Map has drawn its first frame with builder-a on it, and the handle holds it.
  await page.waitForFunction(async (id) => {
    const m = await import('/js/views/map.js');
    return Boolean(m.getMapView()?.screenOf(id) && window.__cockpitView?.map);
  }, MAP_ID, { timeout: 10_000 });

  // New nodes grow out of their parent in beats (map/index.js): builder-a starts at the core and
  // is drawn over it until it has swung out, so the steps read once it is at rest (B128).
  await expect.poll(() => page.evaluate(async () => {
    const m = window.__cockpitView.map;
    if (!m) return false; // the router may swap it while the app settles
    const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const a = m.screenOf('builder-a');
    await frames(30);
    const b = m.screenOf('builder-a');
    const core = m.screenOf('__core');
    return Boolean(a && b && core) && Math.hypot(a.x - b.x, a.y - b.y) < 0.5 && Math.hypot(b.x - core.x, b.y - core.y) > 20;
  }), { message: 'the Map comes to rest, builder-a out of the core', timeout: 15_000 }).toBe(true);

  await test.step('on #/map: page app, no wall, screenOf in page px, nodeAt on it and null off the Map', async () => {
    const got = await page.evaluate(async (id) => {
      const v = window.__cockpitView;
      const own = (await import('/js/views/map.js')).getMapView().screenOf(id);
      const c = document.querySelector('#map-root canvas.map-canvas').getBoundingClientRect();
      const p = v.map.screenOf('builder-a');
      return {
        page: v.page, wall: v.wall, p, want: { x: own.x + c.left, y: own.y + c.top },
        at: v.map.nodeAt(p.x, p.y), corner: v.map.nodeAt(2, 2), canvasTop: c.top,
      };
    }, MAP_ID);
    expect(got.page).toBe('app');
    expect(got.wall).toBeNull();
    expect(got.canvasTop, 'on the app the canvas starts below the header').toBeGreaterThan(0);
    expect(Math.abs(got.p.x - got.want.x), 'x: the Map\'s own plus the canvas left').toBeLessThanOrEqual(0.5);
    expect(Math.abs(got.p.y - got.want.y), 'y: the Map\'s own plus the canvas top').toBeLessThanOrEqual(0.5);
    expect(got.at).toBe('builder-a');
    expect(got.corner).toBeNull();
  });

  await test.step('flyTo builder-a: true within 0.9 s, the node at the centre of the part in sight; vm-x: false, camera unchanged', async () => {
    const got = await page.evaluate(async () => {
      const m = window.__cockpitView.map;
      const t0 = performance.now();
      const ok = await m.flyTo('builder-a');
      const ms = performance.now() - t0;
      const at = m.screenOf('builder-a');
      const c = document.querySelector('#map-root canvas.map-canvas').getBoundingClientRect();
      const insp = document.querySelector('#shell')?.dataset.insp ?? null;
      const before = m.camera();
      const miss = await m.flyTo('vm-x');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { ok, ms, at, centre: { x: c.left + c.width / 2, y: c.top + c.height / 2 }, insp, miss, before, after: m.camera() };
    });
    expect(got.ok).toBe(true);
    expect(got.ms, 'resolves within 0.9 s').toBeLessThanOrEqual(900);
    expect(got.insp, 'nothing covers the Map: the part in sight is the whole canvas').not.toBe('open');
    expect(Math.abs(got.at.x - got.centre.x), 'x at the centre').toBeLessThanOrEqual(2);
    expect(Math.abs(got.at.y - got.centre.y), 'y at the centre').toBeLessThanOrEqual(2);
    expect(got.miss).toBe(false);
    expect(got.after).toEqual(got.before);
  });

  await test.step('#/board: map null within one frame; back on #/map a new object with the same functions', async () => {
    const off = await page.evaluate(async () => {
      window.__oldMap = window.__cockpitView.map;
      const changed = new Promise((r) => addEventListener('hashchange', r, { once: true }));
      location.hash = '#/board';
      await changed;
      await new Promise((r) => requestAnimationFrame(r));
      return window.__cockpitView.map;
    });
    expect(off).toBeNull();
    await page.evaluate(() => { location.hash = '#/map'; });
    await page.waitForFunction(() => window.__cockpitView.map !== null);
    const back = await page.evaluate(() => {
      const a = window.__oldMap, b = window.__cockpitView.map;
      const fns = (o) => Object.keys(o).filter((k) => typeof o[k] === 'function').sort();
      return { same: a === b, a: fns(a), b: fns(b) };
    });
    expect(back.same, 'a new object').toBe(false);
    expect(back.b).toEqual(back.a);
    expect(back.b).toEqual(expect.arrayContaining(['flyTo', 'camera', 'screenOf', 'nodeAt']));
  });

  await test.step('the Wall page, touring: state, pause, the idle minute, hold, restart(5000) back to tour by idle', async () => {
    const wallUp = await page.request.get(`${room.url}${WALL_PAGE}`);
    expect(wallUp.status(), 'WALL_PAGE answers (the Wall is merged, §9.3)').toBe(200);
    await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
    await cockpitDecided(page);
    await page.waitForFunction(() => document.documentElement.dataset.wallState === 'tour' && Boolean(window.__cockpitView?.wall));
    const touring = await page.evaluate(() => {
      const v = window.__cockpitView;
      return { page: v.page, state: v.wall.state(), attr: document.documentElement.dataset.wallState };
    });
    expect(touring).toEqual({ page: 'wall', state: 'tour', attr: 'tour' });

    const paused = await page.evaluate(async () => {
      const w = window.__cockpitView.wall;
      window.__calls = [];
      w.onState((state, info) => window.__calls.push([state, info]));
      w.tour.pause();
      await new Promise((r) => requestAnimationFrame(r));
      return { state: w.state(), attr: document.documentElement.dataset.wallState, left: w.idle.remaining() };
    });
    expect(paused.state).toBe('explore');
    expect(paused.attr).toBe('explore');
    expect(Math.abs(paused.left - 60000), 'the idle minute').toBeLessThanOrEqual(100);

    const held = await page.evaluate(() => {
      const w = window.__cockpitView.wall;
      window.__calls = [];
      w.idle.hold();
      const left = w.idle.remaining();
      w.idle.restart(5000);
      return left;
    });
    expect(held).toBeNull();
    await page.clock.runFor(5000);
    // The Wall says its state in its next drawn frame (W1: the frame the state changes).
    const after = await page.evaluate(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        state: window.__cockpitView.wall.state(),
        attr: document.documentElement.dataset.wallState,
        calls: window.__calls,
      };
    });
    expect(after.state).toBe('tour');
    expect(after.attr).toBe('tour');
    expect(after.calls).toEqual([['tour', { by: 'idle' }]]);
  });
});
