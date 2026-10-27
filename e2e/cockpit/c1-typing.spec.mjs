// C1, build 11: typing and sending (spec c1-talk.md §7, §10 E1; protocols.md §3.1; D30, D31).
// The room under test and the fake agent on script `c1-typing`, clock `real`; the page's
// sent and received frames recorded off the room link.
import { test, expect, cockpitDecided, rectOf } from './fixtures.mjs';

/** Every frame on the room link, both ways, parsed: `{dir: 'sent'|'received', msg}`. */
function recordFrames(page) {
  const frames = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    const keep = (dir) => ({ payload }) => {
      let msg = null;
      try { msg = JSON.parse(String(payload)); } catch { /* not JSON */ }
      frames.push({ dir, at: Date.now(), msg });
    };
    ws.on('framesent', keep('sent'));
    ws.on('framereceived', keep('received'));
  });
  return frames;
}
const promptsSent = (frames) => frames.filter((f) => f.dir === 'sent' && f.msg?.type === 'prompt');

/** The app on `#/map`, the room link live, the pane open, the input tapped (a touch screen: D20). */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await page.locator('[data-cockpit-input]').tap();
  await expect(page.locator('[data-cockpit-input]')).toBeFocused();
}

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';

test('S-C1-14 Typing: Enter sends, Shift+Enter breaks the line, the input grows to 4 lines', async ({ page, room, fakeAgent }) => {
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  await openPane(page, room);
  const prompts = () => fakeAgent.log().filter((l) => l.kind === 'prompt');

  await test.step('SEND is disabled on an empty input and on three spaces', async () => {
    await expect(page.locator(INPUT)).toHaveValue('');
    await expect(page.locator(SEND)).toBeDisabled();
    await page.keyboard.type('   ');
    await expect(page.locator(INPUT)).toHaveValue('   ');
    await expect(page.locator(SEND)).toBeDisabled();
  });

  const rowBefore = await rectOf(page, INPUT);
  const sendBefore = await rectOf(page, SEND);

  await test.step('`how is`, Shift+Enter, `builder-a`, Enter: by 0.1 s the two-line block with SENDING, the input empty and 64 px, data-turn thinking', async () => {
    await page.keyboard.type('how is');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('builder-a');
    await expect(page.locator(INPUT)).toHaveValue('   how is\nbuilder-a');
    // Two lines while typing: 103.2 px (§7).
    const two = await rectOf(page, INPUT);
    expect(Math.abs(two.y2 - two.y1 - 103.2), `two lines: ${two.y2 - two.y1} px`).toBeLessThanOrEqual(1);
    // t = 0 is the Enter's keydown; the page reads the block, the input and data-turn in the
    // next task after it, on its own clock (B8).
    await page.evaluate(() => {
      const input = document.querySelector('[data-cockpit-input]');
      window.__afterEnter = null;
      let t0 = null;
      const look = () => {
        const turn = [...document.querySelectorAll('[data-cockpit-conversation] .ck-turn')].at(-1);
        return {
          ms: performance.now() - t0,
          label: turn?.querySelector('[data-turn-label]')?.textContent ?? null,
          sending: Boolean(turn?.querySelector('[data-turn-delivery="sending"]')),
          prompt: turn?.querySelector('.ck-prompt')?.textContent ?? null,
          value: input.value,
          height: input.getBoundingClientRect().height,
          turn: document.documentElement.dataset.turn,
        };
      };
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || t0 !== null) return;
        t0 = performance.now();
        setTimeout(() => { window.__afterEnter = look(); }, 0);
      }, { capture: true });
    });
    await page.keyboard.press('Enter');
    const at = await (await page.waitForFunction(() => window.__afterEnter)).jsonValue();
    expect(at.ms, 'read within 0.1 s of the Enter (B8)').toBeLessThanOrEqual(100);
    expect(at.label).toMatch(/^YOU · \d\d:\d\d · SENDING$/);
    expect(at.sending).toBe(true);
    expect(at.prompt, 'the two lines, trimmed at both ends, unchanged inside').toBe('how is\nbuilder-a');
    expect(at.value).toBe('');
    expect(Math.abs(at.height - 64), `the input back to 64 px: ${at.height}`).toBeLessThanOrEqual(1);
    expect(at.turn).toBe('thinking');
  });

  await test.step('the room confirms: · SENDING goes; the fake agent has `how is\\nbuilder-a`; one prompt frame', async () => {
    const block = page.locator('[data-cockpit-conversation] .ck-turn').last();
    await expect(block.locator('[data-turn-delivery="sending"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(block.locator('[data-turn-label]').first()).toHaveText(/^YOU · \d\d:\d\d$/);
    await expect.poll(() => prompts().length).toBe(1);
    expect(prompts()[0].words).toBe('how is\nbuilder-a');
    expect(promptsSent(frames).map((f) => f.msg.text)).toEqual(['how is\nbuilder-a']);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 10_000 });
    await expect(page.locator(INPUT), 'the focus stays in the input (§7 "On send")').toBeFocused();
  });

  await test.step('six lines: the input 182 px with its own scrollbar, its bottom where it was, SEND at the row\'s bottom', async () => {
    for (let i = 1; i <= 6; i += 1) {
      await page.keyboard.type(`line ${i}`);
      if (i < 6) await page.keyboard.press('Shift+Enter');
    }
    await expect(page.locator(INPUT)).toHaveValue('line 1\nline 2\nline 3\nline 4\nline 5\nline 6');
    const r = await rectOf(page, INPUT);
    expect(Math.abs(r.y2 - r.y1 - 182), `the input's height: ${r.y2 - r.y1}`).toBeLessThanOrEqual(1);
    expect(Math.abs(r.y2 - rowBefore.y2), `its bottom ${r.y2}, was ${rowBefore.y2}`).toBeLessThanOrEqual(1);
    const scroll = await page.locator(INPUT).evaluate((n) => ({ sh: n.scrollHeight, ch: n.clientHeight, oy: getComputedStyle(n).overflowY }));
    expect(scroll.sh, 'the text scrolls inside the input').toBeGreaterThan(scroll.ch);
    expect(scroll.oy).toBe('auto');
    const s = await rectOf(page, SEND);
    expect(s, 'SEND where it was, at the row\'s bottom').toEqual(sendBefore);
    expect(promptsSent(frames).length, 'still one prompt frame').toBe(1);
  });
});

test('S-C1-15 Too long a prompt cannot be sent', async ({ page, room, fakeAgent }) => {
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  await openPane(page, room);
  const LINE = '[data-cockpit-line][data-line="length"]';
  const long = 'abcdefghij '.repeat(747).slice(0, 8214);

  await test.step('8 214 characters pasted: all kept, the note, SEND disabled, Enter sends nothing', async () => {
    await page.locator(INPUT).fill(long);
    const len = await page.locator(INPUT).evaluate((n) => n.value.length);
    expect(len).toBe(8214);
    await expect(page.locator(LINE)).toHaveText('8 214 / 8 000 CHARACTERS');
    await expect(page.locator(LINE)).toBeVisible();
    await expect(page.locator(SEND)).toBeDisabled();
    await page.locator(INPUT).press('Enter');
    await page.waitForTimeout(500);
    expect(promptsSent(frames), 'no prompt frame').toEqual([]);
    expect(fakeAgent.log().filter((l) => l.kind === 'prompt'), 'nothing reached the agent').toEqual([]);
    expect(await page.locator(INPUT).evaluate((n) => n.value.length), 'Enter added nothing').toBe(8214);
    // The note in the line slot's type: 18 px caps --text-1 (§1.1, D167), on the row's top edge.
    const look = await page.locator(LINE).evaluate((n) => {
      const cs = getComputedStyle(n);
      const row = document.querySelector('.ck-row').getBoundingClientRect();
      const r = n.getBoundingClientRect();
      return { size: cs.fontSize, transform: cs.textTransform, bottom: r.bottom, rowTop: row.top, height: r.height };
    });
    expect(look.size).toBe('18px');
    expect(look.transform).toBe('uppercase');
    expect(Math.abs(look.bottom - look.rowTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(look.height - 32), `one line: 32 px, got ${look.height}`).toBeLessThanOrEqual(1);
  });

  await test.step('deleting 214 characters enables SEND and the note goes', async () => {
    await page.locator(INPUT).press('Control+End');
    for (let i = 0; i < 214; i += 1) await page.keyboard.press('Backspace');
    expect(await page.locator(INPUT).evaluate((n) => n.value.length)).toBe(8000);
    await expect(page.locator(SEND)).toBeEnabled();
    await expect(page.locator('[data-cockpit-line]')).toBeHidden();
    await expect(page.locator(LINE)).toHaveCount(0);
    expect(promptsSent(frames)).toEqual([]);
    expect(fakeAgent.log().filter((l) => l.kind === 'prompt')).toEqual([]);
  });
});
