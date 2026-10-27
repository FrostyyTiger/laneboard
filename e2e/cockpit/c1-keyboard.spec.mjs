// C1, build 11: the on-screen keyboard (spec c1-talk.md §7.1, D130, D131, D132). The
// room under test and the fake agent on script `c1-typing`, 12 seeded turns. A 380 px
// keyboard is the viewport shrunk to 1368x532 (the layout viewport: what a browser that
// resizes content does, and a desktop window made shorter, §7.1), or at 1368x912 a stubbed
// `navigator.virtualKeyboard` (D130). C1 boots with `stt.url: none` (D265): no talk button,
// SEND in its rect, the input to 16 px left of it (slices.md §3.1).
// The Wall page is drawn at `?ratio=0.5` (build B122).
import { test, expect, rectOf, cockpitDecided, WALL_PAGE } from './fixtures.mjs';

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const PANE = '[data-cockpit-conversation]';
const CONVO = '[data-cockpit-conversation] .ck-convo';
const OPENER = '[data-cockpit-open]';
const HEAD_CLOSE = '[data-cockpit-close]';

/** §7.1 with the keyboard up at 1368x532, `stt.url: none` (the talk button's rect is SEND's). */
const UP = {
  pane: { x1: 760, x2: 1368, y1: 0, y2: 532 },
  input: { x1: 784, x2: 1264, y1: 460, y2: 524 },
  send: { x1: 1280, x2: 1344, y1: 460, y2: 524 },
  opener: { x1: 1288, x2: 1336, y1: 396, y2: 444 },
};
/** §1's rects at 1368x912 (screens.md §4.1, `none`). */
const DOWN = {
  input: { x1: 784, x2: 1264, y1: 824, y2: 888 },
  send: { x1: 1280, x2: 1344, y1: 824, y2: 888 },
  opener: { x1: 1288, x2: 1336, y1: 760, y2: 808 },
};

/** Each edge of `got` within ± 1 px of `want`. */
function near(got, want, what) {
  expect(got, `${what}: no element`).not.toBeNull();
  for (const k of ['x1', 'x2', 'y1', 'y2']) {
    expect(Math.abs(got[k] - want[k]), `${what} ${k}: ${got[k]}, want ${want[k]} (${JSON.stringify(got)})`).toBeLessThanOrEqual(1);
  }
}

const inside = (a, b) => a.x1 >= b.x1 - 0.5 && a.x2 <= b.x2 + 0.5 && a.y1 >= b.y1 - 0.5 && a.y2 <= b.y2 + 0.5;

/** The conversation's scroll area: height, pinned (`scrollTop + clientHeight ≥ scrollHeight − 1`), its rect. */
const convoRead = (page) => page.evaluate((sel) => {
  const c = document.querySelector(sel);
  const r = c.getBoundingClientRect();
  const turns = document.querySelectorAll('[data-turn-id], [data-cockpit-conversation] .ck-turn');
  const last = turns[turns.length - 1]?.getBoundingClientRect() ?? null;
  return {
    height: r.height,
    rect: { x1: r.left, x2: r.right, y1: r.top, y2: r.bottom },
    pinned: c.scrollTop + c.clientHeight >= c.scrollHeight - 1,
    lastIn: last ? last.bottom <= r.bottom + 0.5 && last.bottom > r.top : false,
  };
}, CONVO);

const focused = (page) => page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT);
const keyboardWord = (page) => page.locator(':root').getAttribute('data-keyboard');

async function openWall(page, room) {
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await page.waitForFunction(() => document.documentElement.dataset.wallState === 'tour' && Boolean(window.__cockpitView?.wall));
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit-layout', 'wall');
}

async function openApp(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
}

/** The pane open on the seeded conversation, scrolled to its end, the input empty. */
async function openPane(page, turns) {
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await expect(page.locator('[data-turn-id]')).toHaveCount(turns);
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await expect(page.locator(PANE)).toHaveCSS('transform', 'none');
  await expect.poll(async () => (await convoRead(page)).pinned, 'scrolled to its end').toBe(true);
  await expect(page.locator(INPUT)).toHaveValue('');
  await expect(page.locator(':root')).toHaveAttribute('data-keyboard', 'down');
}

/**
 * Tap the input at t = 0 (page clock: performance.now() at its pointerdown) and note when
 * `data-keyboard` first reads `up`; `raise()` brings the keyboard 0.1 s after the tap.
 * Returns the ms from the tap to `up`.
 */
async function tapInputThenKeyboard(page, raise) {
  await page.evaluate((sel) => {
    window.__kb = { t0: null, upAt: null };
    const input = document.querySelector(sel);
    input.addEventListener('pointerdown', () => { window.__kb.t0 = performance.now(); }, { once: true, capture: true });
    new MutationObserver((_, obs) => {
      if (document.documentElement.dataset.keyboard === 'up' && window.__kb.upAt === null) {
        window.__kb.upAt = performance.now();
        obs.disconnect();
      }
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-keyboard'] });
  }, INPUT);
  const tapped = Date.now();
  await page.locator(INPUT).tap();
  await page.waitForTimeout(Math.max(0, tapped + 100 - Date.now()));
  await raise();
  await page.waitForFunction(() => window.__kb.upAt !== null, null, { timeout: 2000 });
  return page.evaluate(() => window.__kb.upAt - window.__kb.t0);
}

/** A finger on the conversation moved by `dy` px and back, slow enough that no fling follows. */
async function flick(page, context, { x, y, dy }) {
  const cdp = await context.newCDPSession(page);
  try {
    const at = (yy) => [{ x, y: yy }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(y) });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y + (dy * i) / 10) });
      await page.waitForTimeout(16);
    }
    for (let i = 9; i >= 0; i--) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(y + (dy * i) / 10) });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/** Every rect of S-C1-32's first Then, with the keyboard up. */
async function expectUpLayout(page, where) {
  expect(await keyboardWord(page), `${where}: data-keyboard`).toBe('up');
  near(await rectOf(page, PANE), UP.pane, `${where}: [data-cockpit-conversation]`);
  near(await rectOf(page, INPUT), UP.input, `${where}: the input`);
  near(await rectOf(page, SEND), UP.send, `${where}: SEND in the talk button's rect`);
  await expect(page.locator('[data-talk]'), 'no talk button with stt none').toHaveCount(0);
  await expect(page.locator(OPENER)).toHaveText('CLOSE');
  near(await rectOf(page, OPENER), UP.opener, `${where}: the opener`);
  const head = await rectOf(page, HEAD_CLOSE);
  expect(Math.abs(head.y1 - 8) <= 1 && Math.abs(head.y2 - 56) <= 1, `${where}: header CLOSE y 8-56, got ${JSON.stringify(head)}`).toBe(true);
  const c = await convoRead(page);
  expect(Math.abs(c.height - 380), `${where}: the conversation 380 px tall, got ${c.height}`).toBeLessThanOrEqual(1);
  expect(c.pinned, `${where}: scrolled to its end`).toBe(true);
  expect(c.lastIn, `${where}: the last turn's last line inside it`).toBe(true);
}

/** §1's rects back at 1368x912, the conversation at its end. */
async function expectDownLayout(page, where) {
  await expect(page.locator(':root')).toHaveAttribute('data-keyboard', 'down');
  await expect.poll(async () => (await rectOf(page, INPUT)).y1, `${where}: the input back on the row`).toBeCloseTo(DOWN.input.y1, 0);
  near(await rectOf(page, INPUT), DOWN.input, `${where}: the input`);
  near(await rectOf(page, SEND), DOWN.send, `${where}: SEND`);
  near(await rectOf(page, OPENER), DOWN.opener, `${where}: the opener CLOSE`);
  await expect.poll(async () => (await convoRead(page)).pinned, `${where}: the conversation at its end`).toBe(true);
}

test('S-C1-32 The on-screen keyboard: the input row sits on its edge, the conversation stays pinned', async ({ page, room, context }) => {
  await room.start({ turns: 12, script: 'c1-typing' });

  // Run 1 on the app's #/map first (screens.md §9.3), then on the Wall page in `wall`.
  // Each run's prompt adds a turn to the one conversation: 12, then 13, then 14.
  for (const [where, turns] of [['app', 12], ['wall', 13]]) {
    await test.step(`${where}: the input tapped at t = 0, the viewport 1368x532 at 0.1 s: by 0.2 s data-keyboard up and every rect of §7.1`, async () => {
      await page.setViewportSize({ width: 1368, height: 912 });
      if (where === 'app') await openApp(page, room); else await openWall(page, room);
      await openPane(page, turns);
      const ms = await tapInputThenKeyboard(page, () => page.setViewportSize({ width: 1368, height: 532 }));
      expect(ms, 'data-keyboard="up" by t = 0.2 s').toBeLessThanOrEqual(200);
      expect(await focused(page)).toBe(true);
      await expectUpLayout(page, where);
    });

    await test.step(`${where}: \`and builder-a?\` and a tap on SEND: the focus stays, up stays, the block inside the conversation`, async () => {
      await page.keyboard.type('and builder-a?');
      await expect(page.locator(SEND)).toBeEnabled();
      const before = await page.locator('[data-cockpit-conversation] .ck-turn').count();
      await page.locator(SEND).tap();
      await expect(page.locator('[data-cockpit-conversation] .ck-turn')).toHaveCount(before + 1);
      expect(await focused(page), 'the input keeps the focus (D132)').toBe(true);
      expect(await keyboardWord(page)).toBe('up');
      const block = await page.evaluate(() => {
        const t = [...document.querySelectorAll('[data-cockpit-conversation] .ck-turn')].at(-1);
        const label = t.querySelector('[data-turn-label]').getBoundingClientRect();
        const prompt = t.querySelector('.ck-prompt').getBoundingClientRect();
        return { x1: Math.min(label.left, prompt.left), x2: Math.max(label.right, prompt.right), y1: label.top, y2: prompt.bottom, text: t.querySelector('.ck-prompt').textContent };
      });
      expect(block.text).toBe('and builder-a?');
      const c = await convoRead(page);
      expect(inside(block, c.rect), `the prompt block ${JSON.stringify(block)} inside the conversation ${JSON.stringify(c.rect)}`).toBe(true);
      await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
      expect(await focused(page)).toBe(true);
      expect(await keyboardWord(page)).toBe('up');
    });

    await test.step(`${where}: a flick 60 px down and back keeps the focus`, async () => {
      await flick(page, context, { x: 1064, y: 200, dy: 60 });
      expect(await focused(page), 'a drag that scrolls does not blur').toBe(true);
      expect(await keyboardWord(page)).toBe('up');
    });

    await test.step(`${where}: a tap on the conversation's text at (1000, 200) blurs the input, data-keyboard down; at 1368x912 §1's rects, at its end`, async () => {
      const hit = await page.evaluate(() => {
        const n = document.elementFromPoint(1000, 200);
        return { inConvo: Boolean(n?.closest('.ck-convo')), control: Boolean(n?.closest('button, [data-tool-line]')) };
      });
      expect(hit, 'the conversation\'s text, not a tool line').toEqual({ inConvo: true, control: false });
      await page.touchscreen.tap(1000, 200);
      await expect.poll(() => focused(page), 'the input lost the focus').toBe(false);
      await expect(page.locator(':root')).toHaveAttribute('data-keyboard', 'down');
      await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
      await page.setViewportSize({ width: 1368, height: 912 });
      await expectDownLayout(page, where);
    });
  }

  await test.step('second run: 1368x912 with a stubbed navigator.virtualKeyboard (380 px, one geometrychange after the tap): the same rects', async () => {
    const vk = await context.newPage();
    try {
      await vk.addInitScript(() => {
        const kb = new EventTarget();
        let h = 0;
        kb.overlaysContent = false;
        Object.defineProperty(kb, 'boundingRect', { get: () => new DOMRect(0, innerHeight - h, innerWidth, h) });
        Object.defineProperty(navigator, 'virtualKeyboard', { value: kb, configurable: true });
        window.__keyboardTo = (px) => { h = px; kb.dispatchEvent(new Event('geometrychange')); };
      });
      await openWall(vk, room);
      await openPane(vk, 14);
      expect(await vk.evaluate(() => navigator.virtualKeyboard.overlaysContent), 'overlaysContent set (D130)').toBe(true);
      const ms = await tapInputThenKeyboard(vk, () => vk.evaluate(() => window.__keyboardTo(380)));
      expect(ms, 'data-keyboard="up" by t = 0.2 s').toBeLessThanOrEqual(200);
      expect(await vk.evaluate(() => innerHeight), 'the layout viewport untouched').toBe(912);
      await expectUpLayout(vk, 'virtualKeyboard');
      await vk.touchscreen.tap(1000, 200);
      await expect(vk.locator(':root')).toHaveAttribute('data-keyboard', 'down');
      await vk.evaluate(() => window.__keyboardTo(0));
      await expectDownLayout(vk, 'virtualKeyboard');
    } finally {
      await vk.close();
    }
  });
});

test('S-C1-33 Keyboard up with the status line and a long draft: the conversation keeps 200 px', async ({ page, room }) => {
  await page.clock.install();
  await room.start({ turns: 12, script: 'c1-typing' });
  await openWall(page, room);
  await openPane(page, 12);

  await test.step('the room down (the 80 px status line) and the viewport at 1368x532 after a tap in the input', async () => {
    expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
    await page.locator(INPUT).tap();
    await page.setViewportSize({ width: 1368, height: 532 });
    await expect(page.locator(':root')).toHaveAttribute('data-keyboard', 'up');
    // The 5 s to room-down on the page's clock (screens.md §7).
    await page.clock.runFor(5100);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'room-down');
    await expect(page.locator('[data-cockpit-status]')).toBeVisible();
  });

  await test.step('8 214 characters pasted: status y 64-144, the note above the row, the input 132 px ending at y 524, scrolled to its end, the conversation 200 px', async () => {
    const words = 'the night run on builder-a ';
    const text = words.repeat(Math.ceil(8214 / words.length)).slice(0, 8214);
    await page.locator(INPUT).fill(text);
    await expect(page.locator(INPUT)).toHaveValue(text);
    expect(await keyboardWord(page)).toBe('up');
    const status = await rectOf(page, '[data-cockpit-status]');
    expect(Math.abs(status.y1 - 64) <= 1 && Math.abs(status.y2 - 144) <= 1, `status y 64-144, got ${JSON.stringify(status)}`).toBe(true);
    const line = page.locator('[data-cockpit-line][data-line="length"]');
    await expect(line).toHaveText('8 214 / 8 000 CHARACTERS');
    const input = await rectOf(page, INPUT);
    const slot = await rectOf(page, '[data-cockpit-line]');
    const row = await rectOf(page, '.ck-row');
    expect(Math.abs(input.y2 - input.y1 - 132), `the input 132 px (clamp(64, 64 + 268 − 200, 182)), got ${input.y2 - input.y1}`).toBeLessThanOrEqual(1);
    expect(Math.abs(input.y2 - 524), `its bottom at y 524, got ${input.y2}`).toBeLessThanOrEqual(1);
    expect(Math.abs(slot.y2 - row.y1), `the note on the row's top edge: slot ${JSON.stringify(slot)}, row ${JSON.stringify(row)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(slot.y2 - slot.y1 - 32), 'a one-line note, 32 px').toBeLessThanOrEqual(1);
    const scroll = await page.evaluate((sel) => {
      const n = document.querySelector(sel);
      return { end: n.scrollTop + n.clientHeight >= n.scrollHeight - 1, caret: n.selectionEnd, len: n.value.length };
    }, INPUT);
    expect(scroll.end, 'the input scrolled to its end').toBe(true);
    expect(scroll.caret, 'the caret at the end, on its last visible line').toBe(scroll.len);
    const convo = await page.evaluate((sel) => document.querySelector(sel).clientHeight, CONVO);
    expect(Math.abs(convo - 200), `the conversation 200 px, got ${convo}`).toBeLessThanOrEqual(1);
  });

  await test.step('back at 1368x912 and the input blurred: data-keyboard down, the input 182 px with its bottom at y 888', async () => {
    await page.setViewportSize({ width: 1368, height: 912 });
    await page.locator(INPUT).blur();
    await expect(page.locator(':root')).toHaveAttribute('data-keyboard', 'down');
    await expect.poll(async () => { const r = await rectOf(page, INPUT); return r.y2 - r.y1; }).toBeGreaterThan(180);
    const input = await rectOf(page, INPUT);
    expect(Math.abs(input.y2 - input.y1 - 181.6), `the input 4 lines (181.6 px), got ${input.y2 - input.y1}`).toBeLessThanOrEqual(1);
    expect(Math.abs(input.y2 - 888), `its bottom at y 888, got ${input.y2}`).toBeLessThanOrEqual(1);
  });
});
