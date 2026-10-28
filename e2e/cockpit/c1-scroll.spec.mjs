// C1, build 10: following a reply as it grows, reduced motion, long replies (spec
// c1-talk.md §1.1, §4, §9; D26, D35, D235). The room under test and the fake agent:
// S-C1-10 and S-C1-12 on script `c1-render`, clock `real`; S-C1-21 on `c1-long`,
// clock `page` (the fake agent keeps real time, stand-ins.md §1.1).
import { test, expect, cockpitDecided, rectOf, colourVsToken } from './fixtures.mjs';

/** The app on `#/map`, the room link live, the pane open. */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

async function send(page, text) {
  await page.locator('[data-cockpit-input]').fill(text);
  await expect(page.locator('[data-cockpit-send]')).toBeEnabled();
  await page.locator('[data-cockpit-send]').tap();
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
 * In the page, every 100 ms (S-C1-10's poll): the conversation's scrollTop, whether the
 * reply's last line box lies inside the conversation's rect, `↓ NEW` shown, `data-turn`.
 */
async function startSampler(page) {
  await page.evaluate(() => {
    const convo = document.querySelector('[data-cockpit-conversation] .ck-convo');
    const follow = document.querySelector('[data-cockpit-follow]');
    const rec = { samples: [], timer: null };
    const lastLine = () => {
      const reply = [...document.querySelectorAll('[data-cockpit-conversation] [data-reply]')].at(-1);
      if (!reply) return null;
      const w = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT);
      let last = null;
      while (w.nextNode()) if (w.currentNode.data.trim() !== '') last = w.currentNode;
      if (!last) return null;
      const r = document.createRange();
      r.selectNodeContents(last);
      const boxes = [...r.getClientRects()];
      return boxes.at(-1) ?? null;
    };
    rec.timer = setInterval(() => {
      const box = lastLine();
      const c = convo.getBoundingClientRect();
      rec.samples.push({
        t: performance.now(),
        scrollTop: convo.scrollTop,
        lastIn: box ? box.top >= c.top - 0.5 && box.bottom <= c.bottom + 0.5 : null,
        lastText: box ? true : false,
        follow: !follow.hidden && follow.getClientRects().length > 0,
        turn: document.documentElement.dataset.turn,
      });
    }, 100);
    window.__scrollRec = rec;
  });
}
async function takeSamples(page) {
  return page.evaluate(() => window.__scrollRec.samples.splice(0));
}

test('S-C1-10 Scrolled up during a reply: the view stays, `↓ NEW` brings it back', async ({ page, room, context }) => {
  await room.start({ turns: 10, script: 'c1-render' });
  await openPane(page, room);
  await expect(page.locator('[data-turn-id]')).toHaveCount(10);
  const convo = page.locator('[data-cockpit-conversation] .ck-convo');
  const follow = page.locator('[data-cockpit-follow]');
  await expect(follow).toBeHidden();

  const t0 = Date.now();
  await send(page, 'what ran tonight');
  await startSampler(page);

  await test.step('at t = 1 s a drag down by 600 px scrolls the conversation up and unpins it', async () => {
    await page.waitForTimeout(Math.max(0, t0 + 1000 - Date.now()));
    expect(await page.locator(':root').getAttribute('data-turn'), 'the reply is streaming').toBe('answering');
    const before = await convo.evaluate((n) => n.scrollTop);
    await touchDrag(page, context, { x: 1064, y: 160, dy: 600 });
    const after = await convo.evaluate((n) => n.scrollTop);
    const gap = await convo.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight);
    // The view follows the finger less the touch slop and the frames still pinned (within
    // 48 px of the end, c1-talk.md §4); then it is unpinned.
    expect(before - after, 'the view went up with the drag').toBeGreaterThan(48);
    expect(before - after).toBeLessThanOrEqual(600);
    expect(gap, 'more than 48 px from the end: unpinned').toBeGreaterThan(48);
    await takeSamples(page); // the drag's own frames are not "while text arrives"
  });

  await test.step('until t = 4 s the scrollTop does not change while text arrives; `↓ NEW` shows 16 px above the input row', async () => {
    const lines0 = await page.locator('[data-reply]').last().evaluate((n) => n.textContent.length);
    await page.waitForTimeout(Math.max(0, t0 + 4000 - Date.now()));
    const samples = await takeSamples(page);
    const lines1 = await page.locator('[data-reply]').last().evaluate((n) => n.textContent.length);
    expect(lines1, 'text kept arriving').toBeGreaterThan(lines0);
    expect(samples.length, 'sampled every 100 ms').toBeGreaterThan(15);
    const tops = new Set(samples.map((s) => s.scrollTop));
    expect([...tops], 'scrollTop stayed where the drag left it').toHaveLength(1);
    await expect(follow).toBeVisible();
    expect(await rectOf(page, '[data-cockpit-follow]'), '↓ NEW centred over the text column, 16 px above the row (y 808)')
      .toEqual({ x1: 1016, x2: 1112, y1: 744, y2: 792 });
    const row = await rectOf(page, '.ck-row');
    expect(row.y1).toBe(808);
  });

  await test.step('a tap on `↓ NEW` at t = 4 s puts the last line in sight, the following text keeps it there, `↓ NEW` is gone', async () => {
    await follow.tap();
    await expect(follow).toBeHidden();
    await takeSamples(page);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
    await page.waitForTimeout(200);
    const samples = await takeSamples(page);
    const streaming = samples.filter((s) => s.turn !== 'idle');
    expect(streaming.length, 'text still arrived after the tap').toBeGreaterThan(10);
    for (const s of samples) {
      expect(s.lastIn, `the last line inside the conversation at ${Math.round(s.t)} ms`).toBe(true);
      expect(s.follow, '↓ NEW stays gone').toBe(false);
    }
    const text = await page.locator('[data-reply]').last().textContent();
    expect(text).toContain('Line 30 of 30');
  });
  await page.evaluate(() => clearInterval(window.__scrollRec.timer));
});

test('S-C1-12 Reduced motion: the pane appears with no slide', async ({ page, room, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await room.start({ turns: 10, script: 'c1-render' });
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');

  /** Tap `selector`; in the next animation frame after the tap, what `read` returns. */
  const nextFrameAfterTap = async (selector, read) => {
    await page.evaluate(({ sel, fn }) => {
      window.__frameRead = null;
      const n = document.querySelector(sel);
      // eslint-disable-next-line no-new-func
      const f = new Function(`return (${fn})()`);
      n.addEventListener('click', () => requestAnimationFrame(() => { window.__frameRead = f(); }), { once: true });
    }, { sel: selector, fn: read.toString() });
    await page.locator(selector).first().tap();
    await page.waitForFunction(() => window.__frameRead !== null);
    return page.evaluate(() => window.__frameRead);
  };
  const paneRead = () => {
    const p = document.querySelector('[data-cockpit-conversation]');
    const r = p.getBoundingClientRect();
    return { hidden: p.hidden, x1: r.left, x2: r.right, y1: r.top, y2: r.bottom, dur: getComputedStyle(p).transitionDuration };
  };

  await test.step('the pane is in its final place in the first frame after the open tap, transition 0 s', async () => {
    const r = await nextFrameAfterTap('[data-cockpit-open]', paneRead);
    expect(r.dur).toBe('0s');
    expect(r).toMatchObject({ hidden: false, x1: 760, x2: 1368, y1: 36, y2: 888 });
  });

  await test.step('`↓ NEW` jumps to the end in the first frame, with no transition', async () => {
    await send(page, 'what ran tonight');
    await page.waitForTimeout(1000);
    await touchDrag(page, context, { x: 1064, y: 160, dy: 600 });
    const follow = page.locator('[data-cockpit-follow]');
    await expect(follow).toBeVisible();
    expect(await follow.evaluate((n) => getComputedStyle(n).transitionDuration)).toBe('0s');
    const r = await nextFrameAfterTap('[data-cockpit-follow]', () => {
      const c = document.querySelector('[data-cockpit-conversation] .ck-convo');
      return { gap: c.scrollHeight - c.scrollTop - c.clientHeight, behavior: getComputedStyle(c).scrollBehavior };
    });
    expect(r.behavior, 'no smooth scroll').toBe('auto');
    expect(r.gap, 'at the end in the first frame').toBeLessThanOrEqual(1);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
  });

  await test.step('a tool line opens with its rows in place in the first frame, no transition', async () => {
    await send(page, 'check the sites');
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
    const r = await nextFrameAfterTap('[data-turn-id]:last-child [data-tool-line]', () => {
      const line = [...document.querySelectorAll('[data-turn-id]')].at(-1).querySelector('[data-tool-line]');
      const rows = [...line.querySelectorAll('[data-tool-row]')];
      return {
        open: line.getAttribute('aria-expanded'),
        rows: rows.map((n) => ({ h: n.getBoundingClientRect().height, dur: getComputedStyle(n).transitionDuration })),
        line: getComputedStyle(line).transitionDuration,
      };
    });
    expect(r.open).toBe('true');
    expect(r.rows.length, 'the calls show').toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.dur).toBe('0s');
      expect(row.h, 'drawn at full height in the first frame').toBeGreaterThan(16);
    }
    expect(r.line).toBe('0s');
  });

  await test.step('the pane is gone in the first frame after the close tap', async () => {
    const r = await nextFrameAfterTap('[data-cockpit-open]', paneRead);
    expect(r.dur).toBe('0s');
    expect(r.hidden || r.x1 >= 1368, `closed in the first frame (x ${r.x1}, hidden ${r.hidden})`).toBe(true);
  });
});

test('S-C1-21 A long reply: its age shows, and it is drawn whole', async ({ page, room }) => {
  test.setTimeout(120_000);
  // The page's Date.now() at each `welcome` and `turn.prompt` the page gets, so the test
  // knows the turn's start on the page's clock exactly as the pane does (c1-talk.md §9).
  await page.addInitScript(() => {
    window.__realPerformance = window.performance;
    const W = window.WebSocket;
    window.__roomFrames = [];
    window.WebSocket = class extends W {
      constructor(...a) {
        super(...a);
        if (!String(a[0]).includes('/api/cockpit/ws')) return;
        this.addEventListener('message', (e) => {
          let m = null;
          try { m = JSON.parse(e.data); } catch { return; }
          if (['welcome', 'turn.prompt', 'text.delta', 'text.block', 'turn.end'].includes(m.type)) {
            window.__roomFrames.push({ pageNow: Date.now(), type: m.type, now: m.now, at: m.at, text: m.text ?? null });
          }
        });
      }
    };
  });
  await page.clock.install();
  // page.clock's fake `performance` makes mark/measure no-ops and every getEntries* empty;
  // the page's B9 marks go to the real one again, its `now` stays the fake (build B163).
  await page.addInitScript(() => {
    const real = window.__realPerformance;
    for (const k of ['mark', 'measure', 'getEntriesByName', 'getEntriesByType', 'getEntries', 'clearMarks', 'clearMeasures']) {
      window.performance[k] = real[k].bind(real);
    }
  });
  await room.start({ script: 'c1-long' });
  await openPane(page, room);
  await send(page, 'how did the night go');

  const frames = () => page.evaluate(() => window.__roomFrames);
  await expect.poll(async () => (await frames()).some((f) => f.type === 'turn.prompt'), { timeout: 5000 }).toBe(true);
  const t0 = await page.evaluate(() => {
    const f = window.__roomFrames;
    const w = f.findLast((x) => x.type === 'welcome');
    const p = f.findLast((x) => x.type === 'turn.prompt');
    return Date.parse(p.at) + (w.pageNow - Date.parse(w.now));
  });
  const turn = page.locator('[data-turn-id]').last();
  const agentRows = turn.locator('[data-turn-label]', { hasText: /^AGENT/ });
  const age = turn.locator('[data-turn-age]');
  const header = page.locator('[data-cockpit-turn]');
  const b9 = () => page.evaluate(() => performance.getEntriesByName('cockpit:B9', 'measure').length);
  // "At t = 3 s" (and 12 s, 15 s) is read 5 ms after it: the page's own reading of the welcome may
  // be 1-2 ms later than the recorder's in the same task (build B161).
  const SLACK = 5;

  await test.step('at t = 2.9 s there is no AGENT label row', async () => {
    await page.clock.pauseAt(t0 + 2900);
    await expect(agentRows).toHaveCount(0);
    await expect(header).toHaveText('● WORKING');
  });

  await test.step('at t = 3 s the row reads AGENT · HH:MM · 0:03 with nothing under it, the age in --text-2, the header ● WORKING', async () => {
    await page.clock.runFor(100 + SLACK);
    await expect(agentRows).toHaveCount(1);
    await expect(agentRows.first()).toHaveText(/^AGENT · \d\d:\d\d · 0:03$/);
    await expect(age).toHaveText('0:03');
    const c = await colourVsToken(page, '[data-turn-id]:last-child [data-turn-age]', '--text-2');
    expect(c.got).toBe(c.want);
    await expect(turn.locator('[data-reply]')).toHaveCount(0);
    expect(await agentRows.first().evaluate((n) => n.nextElementSibling)).toBeNull();
    await expect(header).toHaveText('● WORKING');
    expect(await b9()).toBe(0);
  });

  await test.step('at t = 12 s the age reads 0:12, the header still ● WORKING', async () => {
    await page.clock.runFor(9000);
    await expect(age).toHaveText('0:12');
    await expect(agentRows.first()).toHaveText(/^AGENT · \d\d:\d\d · 0:12$/);
    await expect(header).toHaveText('● WORKING');
    expect(await b9()).toBe(0);
  });

  await test.step('at t = 15 s the first reply text is drawn under that same row; one B9 measure', async () => {
    // The fake agent keeps real time: its first text comes 15 s after the prompt (c1-long).
    await expect.poll(async () => (await frames()).some((f) => f.type === 'text.delta'), { timeout: 20_000 }).toBe(true);
    expect(await b9(), 'nothing drawn while the page\'s clock stands before 15 s').toBe(0);
    await page.clock.runFor(3000);
    await expect(agentRows).toHaveCount(1);
    await expect(age).toHaveText('0:15');
    await expect(turn.locator('[data-reply]')).toContainText('Three runs ran last night.');
    expect(await b9()).toBe(1);
  });

  await test.step('after the turn: the age keeps 0:35, all 26 000 characters drawn, 30 table rows, no button, READY', async () => {
    await expect.poll(async () => (await frames()).some((f) => f.type === 'turn.end'), { timeout: 30_000 }).toBe(true);
    await page.clock.runFor(1000);
    await expect(header).toHaveText('READY');
    await expect(age).toHaveText('0:35');
    await expect(agentRows).toHaveCount(1);
    // What the room sent, all of it, and what md.js draws of all of it (spec contradiction
    // noted under For the owner: a table's pipes are not drawn, so the drawn textContent
    // of 26 000 characters of markdown is shorter; build B162).
    const m = await page.evaluate(async () => {
      const f = window.__roomFrames;
      const blocks = f.filter((x) => x.type === 'text.block');
      const sent = blocks.length ? blocks.at(-1).text : f.filter((x) => x.type === 'text.delta').map((x) => x.text).join('');
      const { parse } = await import('/js/core/md.js');
      const { drawText } = await import('/js/cockpit/reply.js');
      const whole = document.createElement('div');
      drawText(document, whole, parse(sent, { done: true }), { expanded: new Set() });
      const reply = [...document.querySelectorAll('[data-turn-id]')].at(-1).querySelector('[data-reply]');
      return {
        sentLength: sent.length,
        drawn: reply.textContent,
        whole: whole.textContent,
        rows: reply.querySelectorAll('table tbody tr').length || reply.querySelectorAll('table tr').length - 1,
        buttons: reply.querySelectorAll('button').length,
      };
    });
    expect(m.sentLength, 'the room sent the whole reply').toBe(26_000);
    expect(m.drawn.length, 'the reply drawn whole').toBe(m.whole.length);
    expect(m.drawn).toBe(m.whole);
    expect(m.rows, 'the table has 30 body rows').toBe(30);
    expect(m.buttons, 'no button in the reply (no code block here)').toBe(0);
    expect(await b9(), 'one B9 measure for the turn').toBe(1);
  });
});
