// C1, build 13: the error ends of a turn (spec c1-talk.md §10, protocols.md §3.2, §3.5, §11.4;
// D34, D57, D232, D259). The room under test and the fake agent on script `c1-errors`; the
// page's room-link frames recorded both ways; the room's clock `real`.
import { test, expect, cockpitDecided } from './fixtures.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const OPENER = '[data-cockpit-open]';
const HEADER = '[data-cockpit-turn]';
const ERR = '[data-turn-error]';
const RETRYING = '[data-turn-retrying]';

/** Every frame on the room link, both ways, parsed: `{dir, at, msg}`. */
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
const sent = (frames, type) => frames.filter((f) => f.dir === 'sent' && f.msg?.type === type).map((f) => f.msg);

/** The app on `#/map`, the link live, the pane open. */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

async function typeAndSend(page, text) {
  await page.locator(INPUT).fill(text);
  await expect(page.locator(SEND)).toBeEnabled();
  await page.locator(SEND).tap();
}

/** A token's computed colour (a probe styled with it), so the theme decides. */
const tokenColour = (page, token) => page.evaluate((tok) => {
  const p = document.createElement('span');
  p.style.color = `var(${tok})`;
  document.body.append(p);
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
}, token);

/**
 * Watch, from the page, every text the lines of `selector` show (and the root's `data-turn`
 * then), with the page's `Date.now()`: a line that is replaced within a second is still seen.
 */
const watchLines = (page, selector) => page.evaluate((sel) => {
  const seen = [];
  window.__lines = seen;
  const look = () => {
    for (const n of document.querySelectorAll(sel)) {
      const text = n.querySelector('.ck-err-text')?.textContent ?? n.textContent;
      const buttons = [...n.querySelectorAll('button')].map((b) => b.textContent);
      const last = seen.findLast((s) => s.text === text);
      if (!last || last.buttons.join() !== buttons.join()) {
        seen.push({ at: Date.now(), text, buttons, turn: document.documentElement.dataset.turn, colour: getComputedStyle(n).color });
      }
    }
  };
  new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  look();
}, selector);
const linesSeen = (page) => page.evaluate(() => window.__lines);

/** The last turn of the conversation. */
const lastTurn = (page) => page.locator('.ck-turns > .ck-turn').last();

test('S-C1-19 The agent\'s process dies mid-turn', async ({ page, room, fakeAgent }) => {
  await room.start({ script: 'c1-errors' });
  const frames = recordFrames(page);
  const log = fakeAgentLog(fakeAgent.dir);
  await openPane(page, room);
  // The room's clock at 07:04:00 on the screen's day, in the screen's zone (Europe/Zurich).
  const at0704 = await page.evaluate(() => { const d = new Date(); d.setHours(7, 4, 0, 0); return d.toISOString(); });
  expect((await room.control('POST', '/clock', { set: at0704 })).status).toBe(200);
  await watchLines(page, '[data-turn-error="agent-exited"]');

  const first = 'The agent stopped unexpectedly at 07:04. The room is starting it again.';
  const back = 'The agent is back (07:04). Your last message was not answered.';

  await test.step('a reply half drawn, then the agent exits with code 1', async () => {
    await typeAndSend(page, 'tell me about the night');
    await expect(lastTurn(page).locator('[data-reply]')).toContainText('Last night three runs');
  });

  await test.step('within 1 s: the stopped line, `data-turn="idle"`, no button', async () => {
    await expect.poll(async () => (await linesSeen(page)).length, { timeout: 5000 }).toBeGreaterThan(0);
    const seen = await linesSeen(page);
    const [p] = log.prompts();
    // The exit is the script's step at 800 ms of the turn, which starts at the prompt's receipt or later.
    const exitNoEarlierThan = p.atMs + 800;
    expect(seen[0].text).toBe(first);
    expect(seen[0].buttons, 'no RETRY before the agent is back').toEqual([]);
    expect(seen[0].at - exitNoEarlierThan, 'within 1 s of the exit').toBeLessThanOrEqual(1000);
    expect(seen[0].turn).toBe('idle');
    await expect(page.locator(HEADER)).toHaveText('READY');
  });

  await test.step('the room has restarted the agent: the back line and RETRY', async () => {
    const line = page.locator('[data-turn-error="agent-exited"]');
    await expect(line.locator('.ck-err-text')).toHaveText(back, { timeout: 10_000 });
    await expect(line.getByRole('button', { name: 'RETRY' })).toBeVisible();
    expect(log.starts().length, 'a second start').toBeGreaterThanOrEqual(2);
    // One `[data-turn-error]` in the turn: the same line, changed.
    await expect(lastTurn(page).locator(ERR)).toHaveCount(1);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle');
  });

  await test.step('nothing is sent until RETRY is tapped', async () => {
    await page.waitForTimeout(2000);
    expect(log.prompts().length, 'the received-turns log').toBe(1);
    expect(sent(frames, 'prompt').length).toBe(1);
    const failed = sent(frames, 'prompt')[0];
    await page.locator('[data-turn-error="agent-exited"]').getByRole('button', { name: 'RETRY' }).tap();
    await expect.poll(() => log.prompts().length, { timeout: 1000 }).toBe(2);
    expect(log.prompts()[1].raw).toContain('tell me about the night');
    const again = sent(frames, 'prompt')[1];
    expect(again.text).toBe('tell me about the night');
    expect(again.clientId, 'a new clientId (D259)').not.toBe(failed.clientId);
  });
});

/** S-C1-20's rows: the prompt that plays the row's script turn, then what its turn shows. */
const ROWS = [
  { prompt: 'error overloaded', code: 'failed', text: 'The answer failed: overloaded.', buttons: ['RETRY'] },
  { prompt: 'error step limit', code: 'step-limit', text: "Stopped after 40 steps, the agent's limit.", buttons: ['GO ON'] },
  { prompt: 'error boom', code: 'failed', text: 'The answer failed: boom.', buttons: ['RETRY'], retry: true },
  { prompt: 'error long detail', code: 'failed', long: true, buttons: ['RETRY'] },
  { prompt: 'error login', code: 'not-logged-in', text: 'The agent is not logged in on the room. Log it in there, then send again.', buttons: [] },
];

test('S-C1-20 Each error end of a turn has its exact message, in grey', async ({ page, room, fakeAgent }) => {
  await room.start({ script: 'c1-errors' });
  const frames = recordFrames(page);
  const log = fakeAgentLog(fakeAgent.dir);
  await openPane(page, room);
  const p1 = await tokenColour(page, '--p1');
  const p2 = await tokenColour(page, '--p2');
  const text1 = await tokenColour(page, '--text-1');
  const text3 = await tokenColour(page, '--text-3');

  /** No element of the pane in --p1 or --p2: text, background or border. */
  const noAlarm = async () => {
    const used = await page.locator('[data-cockpit-conversation]').evaluate((pane) => {
      const out = new Set();
      for (const n of [pane, ...pane.querySelectorAll('*')]) {
        const s = getComputedStyle(n);
        for (const v of [s.color, s.backgroundColor, s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor]) out.add(v);
      }
      return [...out];
    });
    expect(used, 'no --p1').not.toContain(p1);
    expect(used, 'no --p2').not.toContain(p2);
  };

  for (const row of ROWS) {
    await test.step(`${row.prompt}: ${row.long ? 'a 300-character detail shows its first 120' : row.text}`, async () => {
      await typeAndSend(page, row.prompt);
      const turn = lastTurn(page);
      const line = turn.locator(`[data-turn-error="${row.code}"]`);
      await expect(line).toHaveCount(1, { timeout: 10_000 });
      if (row.long) {
        const detail = (await fakeAgentScriptDetail()).slice(0, 120);
        await expect(line.locator('.ck-err-text')).toHaveText(`The answer failed: ${detail}.`);
      } else {
        await expect(line.locator('.ck-err-text')).toHaveText(row.text);
      }
      expect(await line.locator('button').allTextContents()).toEqual(row.buttons);
      await expect(turn.locator(ERR), 'one error line per turn').toHaveCount(1);
      await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle');
      await expect(page.locator(HEADER)).toHaveText('READY');
      expect(await line.locator('.ck-err-text').evaluate((n) => getComputedStyle(n).color), 'the text --text-1').toBe(text1);
      await noAlarm();
    });

    if (row.retry) {
      await test.step('after E8 `boom`, RETRY: one prompt more within 1 s, a new clientId, a new turn under the failed one', async () => {
        const failedTurn = lastTurn(page);
        const failedId = await failedTurn.getAttribute('data-turn-id');
        const before = log.prompts().length;
        const failedClient = sent(frames, 'prompt').at(-1).clientId;
        const t0 = Date.now();
        await failedTurn.locator(ERR).getByRole('button', { name: 'RETRY' }).tap();
        await expect.poll(() => log.prompts().length, { timeout: 1000 }).toBe(before + 1);
        expect(Date.now() - t0).toBeLessThanOrEqual(1000);
        const again = sent(frames, 'prompt').at(-1);
        expect(again.text).toBe('error boom');
        expect(again.clientId, 'a clientId other than the failed turn\'s (D259)').not.toBe(failedClient);
        // The failed turn stays; the new one with the same text is drawn under it.
        await expect(page.locator(`[data-turn-id="${failedId}"] [data-turn-error="failed"]`)).toHaveCount(1);
        const next = lastTurn(page);
        await expect(next.locator('.ck-prompt').first()).toHaveText('error boom');
        await expect(next).not.toHaveAttribute('data-turn-id', failedId);
        // The retried turn fails the same way (the script repeats); wait for its end.
        await expect(next.locator('[data-turn-error="failed"]')).toHaveCount(1, { timeout: 10_000 });
        await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle');
      });
    }
  }

  await test.step('two retries before text: the row `(2 of 10)`, gone once text arrives', async () => {
    await watchLines(page, RETRYING);
    await typeAndSend(page, 'error retries');
    const turn = lastTurn(page);
    await expect(turn.locator('[data-reply]')).toContainText('The service answered at last', { timeout: 10_000 });
    const seen = await linesSeen(page);
    expect(seen.map((s) => s.text)).toContain('the model service is busy, retrying (2 of 10)');
    expect(seen.map((s) => s.text), 'one row, replaced on each retry').toContain('the model service is busy, retrying (1 of 10)');
    for (const s of seen) expect(s.colour, 'the row in --text-3').toBe(text3);
    await expect(turn.locator(RETRYING), 'gone once text arrives').toHaveCount(0);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 5000 });
    await expect(turn.locator(ERR)).toHaveCount(0);
    await expect(page.locator(HEADER)).toHaveText('READY');
    await noAlarm();
  });

  /** The long row's detail as the script writes it (300 characters). */
  async function fakeAgentScriptDetail() {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const script = JSON.parse(fs.readFileSync(path.join(fakeAgent.dir, 'script.json'), 'utf8'));
    const d = script.turns.find((t) => t.match === 'error long detail').steps[0].detail;
    expect([...d].length, 'the script\'s detail is 300 characters').toBe(300);
    return d;
  }
});
