// C1, build 11: the prompt rate (spec c1-talk.md §7 "Rate", §10 E9; protocols.md §3.1, §8;
// screens.md §6.4; D228, D264, D165). The room under test on a `manual` clock at 07:00:00, the
// fake agent on script `c1-typing` (a `done` turn in 0.2 s), one browser context with two pages:
// one screen, one count (C1 has no pairing, build B179). The audit lines are read back with
// `bin/laneboard audit --json --file`.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, cockpitDecided } from './fixtures.mjs';
import { ROOT } from '../../test/helpers/boot.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const HEADER = '[data-cockpit-turn]';
const BLOCKS = '[data-cockpit-conversation] .ck-turn';
const TOO_MANY = 'Too many messages from this screen; wait a minute.';
const LANEBOARD = path.join(ROOT, 'bin', 'laneboard');
const T0 = new Date('2026-10-27T07:00:00+01:00');

/** Every frame on the room link, both ways, parsed: `{dir, msg}`. */
function recordFrames(page) {
  const frames = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    const keep = (dir) => ({ payload }) => {
      let msg = null;
      try { msg = JSON.parse(String(payload)); } catch { /* not JSON */ }
      frames.push({ dir, msg });
    };
    ws.on('framesent', keep('sent'));
    ws.on('framereceived', keep('received'));
  });
  return frames;
}
const of = (frames, dir, type) => frames.filter((f) => f.dir === dir && f.msg?.type === type).map((f) => f.msg);

/** `laneboard audit --json --file f`: every line, parsed. */
function auditLines(file) {
  const out = execFileSync(process.execPath, [LANEBOARD, 'audit', '--json', '-n', '1000', '--file', file], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** The app on `#/map`, the room link live, the pane open, the input tapped (a touch screen: D20). */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await page.locator(INPUT).tap();
  await expect(page.locator(INPUT)).toBeFocused();
}

/** Type `text` and tap SEND; resolves once the block is drawn. */
async function send(page, text) {
  await page.locator(INPUT).fill(text);
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
  await page.locator(SEND).tap();
}

/** The room's clock forward by `ms`, in steps of at most 10 s (each a heartbeat to every page). */
async function roomAdvance(room, ms) {
  for (let left = ms; left > 0;) {
    const step = Math.min(10_000, left);
    left -= step;
    const r = await room.control('POST', '/clock', { advanceMs: step });
    expect(r.status, `the room's clock moved ${step} ms`).toBe(200);
  }
}

/** Page A's clock and the room's together, 10 s at a time, so the link hears its heartbeat (B235). */
async function advanceBoth(page, room, ms) {
  for (let left = ms; left > 0;) {
    const step = Math.min(10_000, left);
    left -= step;
    await page.clock.runFor(step);
    await roomAdvance(room, step);
  }
}

/** The E9 block's parts on `page`: the last block, its label, its line and buttons. */
function e9(page) {
  const line = page.locator('[data-turn-error]').filter({ hasText: TOO_MANY });
  const block = page.locator(BLOCKS).filter({ has: line });
  return {
    block,
    line,
    label: block.locator('[data-turn-label]').first(),
    retry: line.getByRole('button', { name: 'RETRY' }),
    edit: line.getByRole('button', { name: 'EDIT' }),
  };
}

/** Tap the centre of a locator's box with the touchscreen (works on a disabled button too). */
async function tapAt(page, locator) {
  const b = await locator.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
}

test('S-C1-43 The 11th prompt in a minute is not sent', async ({ page, room, fakeAgent }) => {
  test.setTimeout(120_000);
  await room.start({ script: 'c1-typing', clock: { set: T0.toISOString(), mode: 'manual' } });
  const file = room.booted.auditFile;
  const prompts = () => fakeAgentLog(fakeAgent.dir).prompts();
  const pageA = page;
  const pageB = await page.context().newPage();
  const framesA = recordFrames(pageA);
  const framesB = recordFrames(pageB);
  // Page A's clock installed before any send (the E9 wait runs on it, D264); page B's is the browser's.
  await pageA.clock.install({ time: T0 });
  await openPane(pageA, room);
  await openPane(pageB, room);
  const before = auditLines(file).length;

  await test.step('page A sends ping 1 to ping 6 and page B ping 7 to ping 10, 2 s apart on the room clock: all answered', async () => {
    for (let n = 1; n <= 10; n++) {
      if (n > 1) await roomAdvance(room, 2_000);
      const p = n <= 6 ? pageA : pageB;
      await send(p, `ping ${n}`);
      // Each after the previous one's `· SENDING` went (and its `done` turn ended).
      await expect(p.locator('[data-turn-delivery="sending"]')).toHaveCount(0);
      await expect(p.locator(HEADER)).toHaveText('READY');
    }
    const done = of(framesA, 'received', 'turn.end').filter((m) => m.state === 'done');
    expect(done.length, 'ten done turns on page A').toBe(10);
    expect(of(framesA, 'received', 'turn.prompt').map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, i) => `ping ${i + 1}`));
    expect(prompts().length).toBe(10);
  });

  let refusedId = null;
  await test.step('at 07:00:20 page A sends ping 11: NOT SENT within 0.5 s with E9\'s line, RETRY and EDIT, on both pages', async () => {
    await roomAdvance(room, 2_000);
    // The moment this screen draws the refusal, on page A's clock (D264: the 60 s count from it).
    await pageA.evaluate((text) => {
      window.__e9At = null;
      const seen = new MutationObserver(() => {
        if ([...document.querySelectorAll('[data-turn-error]')].some((n) => n.textContent.includes(text))) {
          window.__e9At = Date.now();
          seen.disconnect();
        }
      });
      seen.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, TOO_MANY);
    const sentAt = Date.now();
    await send(pageA, 'ping 11');
    const a = e9(pageA);
    await expect(a.label).toHaveText('YOU · 07:00 · NOT SENT', { timeout: Math.max(1, sentAt + 500 - Date.now()) });
    await expect(a.block.locator('[data-turn-delivery="not-sent"]')).toHaveCount(1);
    await expect(a.line.locator('.ck-err-text')).toHaveText(TOO_MANY);
    await expect(a.retry).toBeVisible();
    await expect(a.edit).toBeVisible();
    await expect(a.block.locator('.ck-prompt')).toHaveText('ping 11');
    const sent = of(framesA, 'sent', 'prompt').at(-1);
    expect(sent.text).toBe('ping 11');
    refusedId = sent.clientId;
    const refusal = of(framesA, 'received', 'prompt.refused');
    expect(refusal).toEqual([{ type: 'prompt.refused', re: sent.seq, clientId: refusedId, code: 'too-many' }]);

    const b = e9(pageB);
    await expect(b.label).toHaveText('YOU · 07:00 · NOT SENT');
    await expect(b.block.locator('[data-turn-delivery="not-sent"]')).toHaveCount(1);
    await expect(b.line.locator('.ck-err-text')).toHaveText(TOO_MANY);
    await expect(b.block.locator('.ck-prompt')).toHaveText('ping 11');
    await expect(b.retry).toBeVisible();
    await expect(b.retry).toBeDisabled();
    await expect(b.edit).toBeVisible();
    await expect(pageB.locator(BLOCKS).last()).toContainText('ping 11', { useInnerText: true });
    expect(of(framesB, 'sent', 'prompt').map((m) => m.text)).toEqual(['ping 7', 'ping 8', 'ping 9', 'ping 10']);

    expect(prompts().length, 'nothing reached the agent').toBe(10);
    const fresh = auditLines(file).slice(before);
    const refusals = fresh.filter((e) => e.action === 'cockpit.prompt' && e.result?.ok === false);
    expect(refusals.length, 'one refusal line (D165)').toBe(1);
    expect([refusals[0].user, refusals[0].via, refusals[0].target]).toEqual(['board', 'cockpit', '-']);
    expect(refusals[0].result).toEqual({ ok: false, status: 'too-many' });
    expect(fresh.filter((e) => e.result?.ok === true).length).toBe(10);
    await expect(pageA.locator(HEADER)).toHaveText('READY');
    await expect(pageB.locator(HEADER)).toHaveText('READY');
  });

  await test.step('at 07:01:00.5 (ping 1 more than 60 s old) page A sends ping 12: answered, prompts() holds 11', async () => {
    await advanceBoth(pageA, room, 40_500);
    await send(pageA, 'ping 12');
    await expect.poll(() => of(framesA, 'received', 'turn.prompt').filter((m) => m.text === 'ping 12').length).toBe(1);
    await expect(pageA.locator(HEADER)).toHaveText('READY');
    await expect.poll(() => prompts().length).toBe(11);
  });

  await test.step('RETRY is disabled from the refusal: a tap sends no frame; still disabled at 59 s, enabled at 60 s (D264)', async () => {
    const a = e9(pageA);
    expect(await a.retry.evaluate((n) => n.disabled)).toBe(true);
    const sentBefore = of(framesA, 'sent', 'prompt').length;
    await tapAt(pageA, a.retry);
    await pageA.waitForTimeout(300);
    expect(of(framesA, 'sent', 'prompt').length, 'no frame').toBe(sentBefore);
    expect(prompts().length).toBe(11);
    // The room on to 07:01:10.5 (a heartbeat), page A's clock to 59 s after it drew the refusal.
    await roomAdvance(room, 10_000);
    const drawnAt = await pageA.evaluate(() => window.__e9At);
    expect(drawnAt).not.toBeNull();
    const left = drawnAt + 59_000 - await pageA.evaluate(() => Date.now());
    expect(left, 'page A is short of 59 s since the refusal').toBeGreaterThan(0);
    expect(left).toBeLessThan(25_000);
    await pageA.clock.runFor(left);
    expect(await a.retry.evaluate((n) => n.disabled), 'disabled at 59 s').toBe(true);
    await pageA.clock.runFor(1_000);
    expect(await a.retry.evaluate((n) => n.disabled), 'enabled at 60 s').toBe(false);
  });

  await test.step('at 07:01:20.5 RETRY sends ping 11 with a new clientId: answered, prompts() holds 12, the refused block above it', async () => {
    await roomAdvance(room, 10_000);
    await expect(pageA.locator(':root')).toHaveAttribute('data-cockpit', 'live');
    const a = e9(pageA);
    await a.retry.tap();
    await expect.poll(() => of(framesA, 'received', 'turn.prompt').filter((m) => m.text === 'ping 11').length).toBe(1);
    const retried = of(framesA, 'sent', 'prompt').at(-1);
    expect(retried.text).toBe('ping 11');
    expect(retried.clientId, 'E9 RETRY makes a new clientId (D259)').not.toBe(refusedId);
    await expect(pageA.locator(HEADER)).toHaveText('READY');
    await expect.poll(() => prompts().length).toBe(12);
    const blocks = pageA.locator(BLOCKS);
    await expect(blocks.last().locator('.ck-prompt')).toHaveText('ping 11');
    await expect(blocks.last().locator('[data-turn-delivery]')).toHaveCount(0);
    // The refused block stays where it was (ping 12 came between), above the new one.
    await expect(a.line).toHaveCount(1);
    const order = await blocks.evaluateAll((all, text) => all.map((n) => [...n.querySelectorAll('[data-turn-error]')].some((e) => e.textContent.includes(text))), TOO_MANY);
    expect(order.indexOf(true), 'the refused block').toBe(order.length - 3);
    await expect(blocks.nth(order.length - 2).locator('.ck-prompt')).toHaveText('ping 12');
  });

  await test.step('EDIT on ping 11 puts ping 11 back into the input (as E1)', async () => {
    const a = e9(pageA);
    await pageA.locator(INPUT).fill('');
    await a.edit.tap();
    await expect(pageA.locator(INPUT)).toHaveValue('ping 11');
    await expect(pageA.locator(INPUT)).toBeFocused();
    await expect(a.line).toHaveCount(0);
  });
  await pageB.close();
});
