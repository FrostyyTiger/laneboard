// C1, build 7: the corner cluster per state (spec screens.md §4, §4.1, c1-talk.md §1.1,
// D116, D158, D159, D273). The room under test and the fake agent on script `c1-render`,
// 12 seeded turns so the conversation scrolls. C1 boots with `stt.url: none` (D265): no
// talk button and no language button in any state, `SEND` in the talk button's rect, the
// input from x 784 to x 1264 (§4.1's `none` rule). S-SCR-25's run with the fake speech and
// `cockpit.stt.language` (the talk and language buttons) is C2's (slices.md §3.1).
// The Wall page is drawn at `?ratio=0.5` (build B122).
import { test, expect, rectOf, cockpitDecided, WALL_PAGE } from './fixtures.mjs';

const OPENER = '[data-cockpit-open]';
const INPUT = '[data-cockpit-input]';
const FOLLOW = '[data-cockpit-follow]';
const LINE = '[data-cockpit-line]';

/**
 * The tappables of §4.1 the walk collects (the Test: line's list); a selector matching
 * several elements (the toasts' buttons) is read element by element.
 */
const TAPPABLES = [
  '[data-cockpit-close]', '[data-cockpit-new]', '[data-cockpit-screen]', '[data-cockpit-switch]',
  OPENER, '[data-cockpit-send]', '[data-talk]', '[data-talk-lang]', INPUT, FOLLOW,
  '[data-cockpit-chip-remove]', '.toasts button',
];

const r = (x1, x2, y1, y2) => ({ x1, x2, y1, y2 });
/** Keyboard up (state H): §1.1's stack moves up with the row's top edge, 808 → 444. */
const UP = 364;

/**
 * §4.1's rects at 1368x912 (H at 1368x532) with `stt.url: none`, per state. `null`: the
 * control must not be drawn. A visible tappable with no row here fails the walk.
 */
const TABLE = {
  A: {
    [OPENER]: r(1288, 1336, 760, 808),
    '[data-talk]': null,
  },
  B: {
    '[data-cockpit-close]': r(1256, 1352, 44, 92),
    '[data-cockpit-new]': r(1176, 1248, 44, 92),
    [OPENER]: r(1288, 1336, 760, 808),
    '[data-cockpit-send]': r(1280, 1344, 824, 888),
    [INPUT]: r(784, 1264, 824, 888),
    [FOLLOW]: r(1016, 1112, 712, 760), // a one-line message, no chip (c1-talk.md §1.1)
    '[data-talk]': null,
    '[data-talk-lang]': null,
  },
  D: {
    '[data-cockpit-close]': r(1256, 1352, 8, 56),
    '[data-cockpit-new]': r(1176, 1248, 8, 56), // before the Canvas slice: no `SCREEN`
    [OPENER]: r(1288, 1336, 760, 808),
    '[data-cockpit-send]': r(1280, 1344, 824, 888),
    [INPUT]: r(784, 1264, 824, 888),
    [FOLLOW]: r(1016, 1112, 712, 760),
    '[data-talk]': null,
    '[data-talk-lang]': null,
  },
};
/** H: the header at y 8-56 at B's (app) or D's (Wall) x, the rest moved up by 364 px. */
for (const from of ['B', 'D']) {
  const h = {};
  for (const [sel, want] of Object.entries(TABLE[from])) {
    if (want === null) { h[sel] = null; continue; }
    const header = sel === '[data-cockpit-close]' || sel === '[data-cockpit-new]';
    h[sel] = header ? r(want.x1, want.x2, 8, 56) : r(want.x1, want.x2, want.y1 - UP, want.y2 - UP);
  }
  TABLE[`H${from}`] = h;
}
TABLE.C = TABLE.A;
/** The line slot's rect per state (a text row: the stack's first item, §1.1). */
const LINE_Y = { B: [776, 808], D: [776, 808], HB: [412, 444], HD: [412, 444] };

/** Every visible element of TAPPABLES with its rect, in page px. */
const collect = (page) => page.evaluate((sels) => {
  const out = [];
  for (const sel of sels) {
    document.querySelectorAll(sel).forEach((n, i) => {
      if (n.closest('[hidden]') || n.getClientRects().length === 0) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const b = n.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      const q = (v) => Math.round(v * 2) / 2;
      out.push({ sel, i, x1: q(b.left), x2: q(b.right), y1: q(b.top), y2: q(b.bottom) });
    });
  }
  return out;
}, TAPPABLES);

const name = (e) => `${e.sel}${e.i ? `#${e.i}` : ''} ${JSON.stringify({ x1: e.x1, x2: e.x2, y1: e.y1, y2: e.y2 })}`;

/** The gap between two rects (0 when they touch or intersect). */
function gap(a, b) {
  const dx = Math.max(0, a.x1 - b.x2, b.x1 - a.x2);
  const dy = Math.max(0, a.y1 - b.y2, b.y1 - a.y2);
  return Math.hypot(dx, dy);
}
const intersects = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/**
 * The rect walk of S-SCR-25's Test: every visible tappable at its table rect (± 1 px), the
 * required ones present, the absent ones absent; then every pair: no intersection, ≥ 8 px.
 */
async function walk(page, state, required) {
  const table = TABLE[state];
  const seen = await collect(page);
  for (const sel of required) {
    expect(seen.some((e) => e.sel === sel), `${state}: ${sel} is drawn`).toBe(true);
  }
  for (const e of seen) {
    if (e.sel === '.toasts button') continue; // the toasts' own rule is checked on the stack
    expect(e.sel in table, `${state}: ${name(e)} has no row in §4.1's table`).toBe(true);
    const want = table[e.sel];
    expect(want, `${state}: ${name(e)} must not be drawn`).not.toBeNull();
    for (const k of ['x1', 'x2', 'y1', 'y2']) {
      expect(Math.abs(e[k] - want[k]), `${state}: ${name(e)} ${k}, want ${want[k]}`).toBeLessThanOrEqual(1);
    }
  }
  for (let a = 0; a < seen.length; a++) {
    for (let b = a + 1; b < seen.length; b++) {
      const [p, q] = [seen[a], seen[b]];
      expect(intersects(p, q), `${state}: ${name(p)} and ${name(q)} intersect`).toBe(false);
      expect(gap(p, q), `${state}: ${name(p)} and ${name(q)} closer than 8 px`).toBeGreaterThanOrEqual(8);
    }
  }
  return seen;
}

/** The line slot: one message, left-aligned at x 784, ending at x ≤ 1264, at the state's y. */
async function lineAt(page, state) {
  await expect(page.locator(LINE)).toHaveAttribute('data-line', 'room-down');
  await expect(page.locator(LINE)).toHaveText('Sending and voice come back with the room.');
  const l = await rectOf(page, LINE);
  const [y1, y2] = LINE_Y[state];
  expect(Math.abs(l.y1 - y1) <= 1 && Math.abs(l.y2 - y2) <= 1, `${state}: the line slot y ${y1}-${y2}, got ${JSON.stringify(l)}`).toBe(true);
  // The text's box (the slot's padding reaches the pane's edges): from x 784, ending ≤ x 1264.
  const t = await page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    const b = range.getBoundingClientRect();
    return { x1: b.left, x2: b.right };
  }, LINE);
  expect(Math.abs(t.x1 - 784), `${state}: the line's text from x 784, got ${JSON.stringify(t)}`).toBeLessThanOrEqual(1);
  expect(t.x2, `${state}: the line's text ends at x ≤ 1264, got ${JSON.stringify(t)}`).toBeLessThanOrEqual(1264.5);
}

/**
 * D273: the opener's label in the vendored face is one line, its text box ≤ 40 px wide and
 * centred within ± 1 px of x 1312.
 */
async function labelBox(page, word) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.fonts.check('500 16px "Barlow Condensed"'));
  await expect(page.locator(OPENER)).toHaveText(word);
  const box = await page.evaluate((sel) => {
    const n = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(n);
    const lines = [...range.getClientRects()].filter((b) => b.width > 0);
    const b = range.getBoundingClientRect();
    return { lines: new Set(lines.map((x) => Math.round(x.top))).size, width: b.width, centre: (b.left + b.right) / 2 };
  }, OPENER);
  expect(box.lines, `${word}: one line`).toBe(1);
  expect(box.width, `${word}: text box ≤ 40 px wide, got ${box.width}`).toBeLessThanOrEqual(40);
  expect(Math.abs(box.centre - 1312), `${word}: centred on x 1312, got ${box.centre}`).toBeLessThanOrEqual(1);
}

/** A toast with an action, through the app's own module (the Test: line). */
const showToast = (page) => page.evaluate(async () => {
  const { toast } = await import('/js/ui/toast.js');
  toast('x', { action: { label: 'UNDO', run() {} }, timeout: 60_000 });
});

/** The toast stack's rect, or null when the page has none drawn. */
const stackRect = (page) => page.evaluate(() => {
  const s = document.querySelector('.toasts');
  if (!s || s.hidden || !s.querySelector('.toast')) return null;
  const b = s.getBoundingClientRect();
  return { x2: b.right, y2: b.bottom };
});

/**
 * A finger on the conversation moved down by `dy` px (the view scrolls up), slow enough
 * that no fling follows the release (as in c1-scroll.spec.mjs).
 */
async function touchDrag(page, context, { x, y, dy, steps = 20 }) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / steps }] });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(150);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await cdp.detach();
  }
}

/**
 * State B (or D): the pane open, a reply streaming while the owner drags the conversation
 * up so `↓ NEW` shows, then the room's link stopped until the line slot reads `room-down`.
 */
async function openScrolledRoomDown(page, context, room) {
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await expect(page.locator('[data-cockpit-conversation]')).toHaveCSS('transform', 'none');
  await page.locator(INPUT).fill('what ran tonight'); // c1-render: 30 lines over 6 s
  await page.locator('[data-cockpit-send]').tap();
  await page.waitForTimeout(800);
  await touchDrag(page, context, { x: 1064, y: 160, dy: 600 });
  await expect(page.locator(FOLLOW)).toBeVisible();
  expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
  await page.waitForFunction(() => document.documentElement.dataset.cockpit === 'room-down', null, { timeout: 10_000 });
  await expect(page.locator(FOLLOW), '↓ NEW still shows').toBeVisible();
}

/** State H: the input focused, the viewport 1368x532. */
async function keyboardUp(page) {
  await page.locator(INPUT).focus();
  await page.setViewportSize({ width: 1368, height: 532 });
  await expect(page.locator(':root')).toHaveAttribute('data-keyboard', 'up');
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

test('S-SCR-25 The corner cluster in the app and on the Wall: every control at its rect, none closer than 8 px', async ({ page, context, room }) => {
  test.setTimeout(120_000);
  await room.start({ turns: 12, script: 'c1-render' });

  await test.step('A, the app on #/map with a toast: CHAT x 1288-1336 y 760-808, no talk button, the toast stack ending at y 736 and x 1356', async () => {
    await page.goto(`${room.url}/#/map`);
    await cockpitDecided(page);
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
    await expect(page.locator(':root')).toHaveAttribute('data-pane', 'closed');
    await showToast(page);
    await expect(page.locator('.toasts button')).toBeVisible();
    await walk(page, 'A', [OPENER, '.toasts button']);
    await expect(page.locator('[data-talk]')).toHaveCount(0);
    const s = await stackRect(page);
    expect(Math.abs(s.y2 - 736), `the toast stack's bottom at y 736, got ${JSON.stringify(s)}`).toBeLessThanOrEqual(1);
    expect(Math.abs(s.x2 - 1356), `its right edge at x 1356, got ${JSON.stringify(s)}`).toBeLessThanOrEqual(1);
    await labelBox(page, 'CHAT');
  });

  await test.step('B, the pane open, the room down, `↓ NEW` showing and a toast: §4.1 B\'s rects, the toast left of x 744', async () => {
    await openScrolledRoomDown(page, context, room);
    await showToast(page);
    await walk(page, 'B', ['[data-cockpit-close]', '[data-cockpit-new]', OPENER, '[data-cockpit-send]', INPUT, FOLLOW, '.toasts button']);
    await lineAt(page, 'B');
    const s = await stackRect(page);
    expect(s.x2, `the toast stack's right edge ≤ x 744, got ${JSON.stringify(s)}`).toBeLessThanOrEqual(744.5);
    expect(Math.abs(s.y2 - 736), `its bottom at y 736, got ${JSON.stringify(s)}`).toBeLessThanOrEqual(1);
    await labelBox(page, 'CLOSE');
  });

  await test.step('H in the app, 1368x532 with the input focused: the header y 8-56, the opener y 396-444, SEND y 460-524, the line slot y 412-444', async () => {
    await keyboardUp(page);
    await walk(page, 'HB', ['[data-cockpit-close]', '[data-cockpit-new]', OPENER, '[data-cockpit-send]', INPUT]);
    await lineAt(page, 'HB');
  });

  await test.step('C, the Wall page in `wall`: CHAT as in A, no talk button, the Wall\'s status lines ending at x ≤ 1256', async () => {
    await page.setViewportSize({ width: 1368, height: 912 });
    await room.start({ turns: 12, script: 'c1-render' });
    await page.goto('about:blank');
    await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
    await cockpitDecided(page);
    await page.waitForFunction(() => document.documentElement.dataset.wallState === 'tour' && Boolean(window.__cockpitView?.wall));
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit-layout', 'wall');
    await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
    await walk(page, 'C', [OPENER]);
    const fleet = await rectOf(page, '.wall-fleet');
    expect(fleet, 'the Wall\'s status lines').not.toBeNull();
    expect(fleet.x2, `the Wall's status lines end at x ≤ 1256, got ${JSON.stringify(fleet)}`).toBeLessThanOrEqual(1256.5);
    await labelBox(page, 'CHAT');
  });

  await test.step('D, the pane open on the Wall, the room down, `↓ NEW` showing: §4.1 D\'s rects', async () => {
    await openScrolledRoomDown(page, context, room);
    await walk(page, 'D', ['[data-cockpit-close]', '[data-cockpit-new]', OPENER, '[data-cockpit-send]', INPUT, FOLLOW]);
    await lineAt(page, 'D');
    await labelBox(page, 'CLOSE');
  });

  await test.step('H on the Wall, 1368x532 with the input focused: the header y 8-56 at D\'s x, the opener y 396-444, SEND y 460-524, the line slot y 412-444', async () => {
    await keyboardUp(page);
    await walk(page, 'HD', ['[data-cockpit-close]', '[data-cockpit-new]', OPENER, '[data-cockpit-send]', INPUT]);
    await lineAt(page, 'HD');
  });
});
