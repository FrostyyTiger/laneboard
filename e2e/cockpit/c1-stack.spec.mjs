// C1, build 10: the stack above the input row (spec c1-talk.md §1.1; D133, D267; c3-see.md §9 for
// the chip). The room under test and the fake agent on script `c1-render` (its 30 lines over 6 s),
// 10 seeded turns, the Wall page; clock `page` (installed before the load: it runs with real time,
// and moves 15 s at once to bring the page's next try after the link starts again).
//
// The chip: S-C1-34's Given has it set by S-C3-10's `ASK ABOUT THIS`, the C3 slice. C1 draws the
// chip row (public/js/cockpit/chip.js, build B245); the test puts the chip there through the
// pane's own `setChip`, the call C3's menu makes, after the prompt that starts the stream (a send
// is C3's to clear the chip with, S-C3-11).
// C1 boots with `stt.url: none` (D265): no talk button, `SEND` in its rect (slices.md §3.1).
import { test, expect, rectOf, cockpitDecided, WALL_PAGE } from './fixtures.mjs';

const ROOT = ':root';
const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const OPENER = '[data-cockpit-open]';
const PANE = '[data-cockpit-conversation]';
const CONVO = `${PANE} .ck-convo`;
const LINE = '[data-cockpit-line]';
const CHIP = '[data-cockpit-chip]';
const CHIP_ROW = '.ck-chiprow';
const REMOVE = '[data-cockpit-chip-remove]';
const FOLLOW = '[data-cockpit-follow]';
/** The tappables S-C1-34 checks pairwise. */
const TAPPABLES = [FOLLOW, REMOVE, OPENER];

/** The gap between two rects (0 when they touch or intersect). */
function gap(a, b) {
  const dx = Math.max(0, a.x1 - b.x2, b.x1 - a.x2);
  const dy = Math.max(0, a.y1 - b.y2, b.y1 - a.y2);
  return Math.hypot(dx, dy);
}
const intersects = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/** `got` within ± 1 px of `want` on each edge given. */
function near(got, want, what) {
  expect(got, `${what} is drawn`).not.toBeNull();
  for (const k of Object.keys(want)) {
    expect(Math.abs(got[k] - want[k]), `${what} ${k} ${got[k]} (want ${want[k]})`).toBeLessThanOrEqual(1);
  }
}

/** No two of the shown tappables intersect or come closer than 8 px; one `[data-cockpit-line]`. */
async function pairwise(page, step) {
  const rects = [];
  for (const sel of TAPPABLES) {
    if (await page.locator(sel).isVisible()) rects.push({ sel, r: await rectOf(page, sel) });
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i], rects[j]];
      expect(intersects(a.r, b.r), `${step}: ${a.sel} and ${b.sel} intersect`).toBe(false);
      expect(gap(a.r, b.r), `${step}: ${a.sel} and ${b.sel} are ≥ 8 px apart`).toBeGreaterThanOrEqual(8);
    }
  }
  await expect(page.locator(LINE)).toHaveCount(1);
  return rects.map((x) => x.sel);
}

/**
 * A finger on the conversation moved down by `dy` px (the content follows it: the view
 * scrolls up), slow enough that no fling follows the release.
 */
async function touchDrag(page, context, { x, y, dy, steps = 20 }) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150); // held still before the release: no fling
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/**
 * The element at the conversation's top line (x 1064, 4 px under its top edge), whether it is the
 * first one seen there, and that one's top measured from the conversation's top edge (the status
 * line above moves the whole conversation down; the line stays at its top, §1.1).
 */
const topLine = (page) => page.evaluate(() => {
  const c = document.querySelector('[data-cockpit-conversation] .ck-convo').getBoundingClientRect();
  const n = document.elementFromPoint(1064, c.top + 4);
  window.__stackTop ??= n;
  return { same: n === window.__stackTop, text: n?.textContent?.slice(0, 60) ?? null, top: window.__stackTop.getBoundingClientRect().top - c.top };
});

test('S-C1-34 Chip, line slot and `↓ NEW` stack without overlapping', async ({ page, room, context }) => {
  test.setTimeout(90_000);
  await room.start({ turns: 10, script: 'c1-render' });
  await page.clock.install({ time: new Date() });
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await page.waitForFunction(() => Boolean(window.__cockpitView?.wall));
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit-layout', 'wall');
  await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live');
  await page.locator(OPENER).tap();
  await expect(page.locator(ROOT)).toHaveAttribute('data-pane', 'open');
  await expect(page.locator(PANE)).toHaveCSS('transform', 'none');
  await expect(page.locator('[data-turn-id]')).toHaveCount(10);

  // The 30-line reply over 6 s, then the chip for `vm-b` as `ASK ABOUT THIS` puts it (c3-see.md §9.4).
  await page.locator(INPUT).fill('what ran tonight');
  await page.locator(SEND).tap();
  const t0 = Date.now();
  await page.locator(INPUT).blur();
  const set = await page.evaluate(async () => {
    const { initCockpit } = await import('/js/cockpit/main.js');
    return initCockpit().pane.setChip({ id: 'vm-b', label: 'vm-b', kind: 'room' });
  });
  expect(set).toBe(true);
  await expect(page.locator(CHIP)).toHaveAttribute('data-node', 'vm-b');

  await test.step('t = 1 s, dragged down 600 px: `↓ NEW` x 1168-1264 y 680-728, the chip row y 744-808 (chip y 752-800), its `✕` ending x ≤ 1264, clear of `CLOSE`', async () => {
    await page.waitForTimeout(Math.max(0, t0 + 1000 - Date.now()));
    expect(await page.locator(ROOT).getAttribute('data-turn'), 'the reply is streaming').toBe('answering');
    await touchDrag(page, context, { x: 1064, y: 160, dy: 600 });
    const gapToEnd = await page.locator(CONVO).evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight);
    expect(gapToEnd, 'scrolled up: unpinned').toBeGreaterThan(48);
    await expect(page.locator(FOLLOW)).toBeVisible();
    near(await rectOf(page, FOLLOW), { x1: 1168, x2: 1264, y1: 680, y2: 728 }, '↓ NEW');
    near(await rectOf(page, CHIP_ROW), { y1: 744, y2: 808 }, 'the chip row');
    near(await rectOf(page, CHIP), { x1: 784, y1: 752, y2: 800 }, 'the chip');
    const remove = await rectOf(page, REMOVE);
    expect(remove.x2, 'the `✕` ends at x ≤ 1264').toBeLessThanOrEqual(1264);
    near(remove, { y1: 752, y2: 800 }, 'the `✕`');
    expect(remove.x2 - remove.x1).toBe(48);
    near(await rectOf(page, OPENER), { x1: 1288, x2: 1336, y1: 760, y2: 808 }, 'CLOSE');
    await expect(page.locator(OPENER)).toHaveText('CLOSE');
    await expect(page.locator(LINE)).toBeHidden();
    expect(await pairwise(page, 'scrolled up')).toEqual(TAPPABLES);
  });

  await test.step('t = 2 s the link stops; at room-down one line slot `room-down` y 776-808, the chip row y 712-776, `↓ NEW` y 648-696, the conversation ending y 712, its top line kept', async () => {
    await page.waitForTimeout(Math.max(0, t0 + 2000 - Date.now()));
    const before = await topLine(page);
    expect(before.text, 'a line at the conversation\'s top').toBeTruthy();
    expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
    await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'room-down', { timeout: 10_000 });
    await expect(page.locator(LINE)).toHaveAttribute('data-line', 'room-down');
    await expect(page.locator(LINE)).toHaveText('Sending and voice come back with the room.');
    near(await rectOf(page, LINE), { y1: 776, y2: 808 }, 'the line slot');
    near(await rectOf(page, CHIP_ROW), { y1: 712, y2: 776 }, 'the chip row');
    near(await rectOf(page, CHIP), { x1: 784, y1: 720, y2: 768 }, 'the chip');
    near(await rectOf(page, FOLLOW), { x1: 1168, x2: 1264, y1: 648, y2: 696 }, '↓ NEW');
    near(await rectOf(page, CONVO), { y2: 712 }, 'the conversation');
    const after = await topLine(page);
    expect(after.same, 'the line at the conversation\'s top is still there').toBe(true);
    expect(Math.abs(after.top - before.top), 'at the same place in the conversation').toBeLessThanOrEqual(1);
    await pairwise(page, 'room-down');
  });

  const long = 'x'.repeat(8214);
  await test.step('8 214 characters pasted: the input 182 px, the slot still `room-down` y 658-690, the chip row y 594-658, `↓ NEW` y 530-578', async () => {
    await page.locator(INPUT).fill(long);
    const input = await rectOf(page, INPUT);
    expect(Math.abs(input.y2 - input.y1 - 182), `the input is ${input.y2 - input.y1} px`).toBeLessThanOrEqual(1);
    await expect(page.locator(LINE)).toHaveAttribute('data-line', 'room-down');
    near(await rectOf(page, LINE), { y1: 658, y2: 690 }, 'the line slot');
    near(await rectOf(page, CHIP_ROW), { y1: 594, y2: 658 }, 'the chip row');
    near(await rectOf(page, FOLLOW), { x1: 1168, x2: 1264, y1: 530, y2: 578 }, '↓ NEW');
    await pairwise(page, 'pasted');
  });

  await test.step('the link starts again, `live`: the slot shows `length`, `8 214 / 8 000 CHARACTERS`, at the same rect', async () => {
    expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
    await page.clock.runFor(15_000); // the next try is due (screens.md §7.1: at most 15 s apart)
    await expect(page.locator(ROOT)).toHaveAttribute('data-cockpit', 'live', { timeout: 10_000 });
    await expect(page.locator(LINE)).toHaveAttribute('data-line', 'length');
    await expect(page.locator(LINE)).toHaveText('8 214 / 8 000 CHARACTERS');
    near(await rectOf(page, LINE), { y1: 658, y2: 690 }, 'the line slot');
    near(await rectOf(page, CHIP_ROW), { y1: 594, y2: 658 }, 'the chip row');
    await expect(page.locator(FOLLOW)).toBeVisible();
    near(await rectOf(page, FOLLOW), { x1: 1168, x2: 1264, y1: 530, y2: 578 }, '↓ NEW');
    await pairwise(page, 'live');
  });

  await test.step('a tap on `↓ NEW`: the chip still there, the last line in sight, `↓ NEW` gone', async () => {
    await expect(page.locator('[data-reply]').last()).toContainText('Line 30 of 30', { timeout: 10_000 });
    await page.locator(FOLLOW).tap();
    await expect(page.locator(FOLLOW)).toBeHidden();
    await expect(page.locator(CHIP)).toHaveCount(1);
    await expect(page.locator(CHIP)).toHaveAttribute('data-node', 'vm-b');
    const inSight = await page.evaluate(() => {
      const reply = [...document.querySelectorAll('[data-cockpit-conversation] [data-reply]')].at(-1);
      const w = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT);
      let last = null;
      while (w.nextNode()) if (w.currentNode.data.trim() !== '') last = w.currentNode;
      const r = document.createRange();
      r.selectNodeContents(last);
      const box = [...r.getClientRects()].at(-1);
      const c = document.querySelector('[data-cockpit-conversation] .ck-convo').getBoundingClientRect();
      return { text: last.data, inside: box.top >= c.top - 0.5 && box.bottom <= c.bottom + 0.5 };
    });
    expect(inSight.text).toContain('Line 30 of 30');
    expect(inSight.inside, 'the last line is in sight').toBe(true);
    await expect(page.locator(INPUT)).toHaveValue(long);
    await pairwise(page, 'at the end');
  });
});
