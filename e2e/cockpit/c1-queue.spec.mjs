// C1, build 12: talking while the agent answers (spec c1-talk.md §8, protocols.md §3.4, D121-D124,
// D258, D268, D270; pending Q-O1, built as its recommendation d, steer). The room under test and
// the fake agent on script `c1-typing`; the page's room-link frames recorded both ways.
// C1 boots with `stt.url: none` (D265): SEND sits in the talk button's rect, x 1280-1344, so the
// scenario's taps at x 1232 (SEND's rect beside a talk button) land on SEND's centre, x 1312 (B192).
import { test, expect, cockpitDecided, rectOf, intersects } from './fixtures.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const OPENER = '[data-cockpit-open]';
const QUEUED = '[data-turn-delivery="queued"]';
/** The queued block: the prompt item under `[data-turn-id]` whose word is `QUEUED` (§8). */
const QUEUED_BLOCK = `[data-turn-id] .ck-pitem:has(${QUEUED})`;
/** SEND's centre at 1368x912 in the `none` layout (screens.md §4.1). */
const SEND_AT = { x: 1312, y: 856 };
const STEER = 'only the failed one';

/** Every frame on the room link, both ways, parsed: `{dir, at, msg}`; `closes` the link's close codes. */
function recordFrames(page) {
  const frames = [];
  frames.closes = [];
  page.on('websocket', (ws) => {
    if (!/\/api\/cockpit\/ws$/.test(ws.url())) return;
    const keep = (dir) => ({ payload }) => {
      let msg = null;
      try { msg = JSON.parse(String(payload)); } catch { /* not JSON */ }
      frames.push({ dir, at: Date.now(), msg });
    };
    ws.on('framesent', keep('sent'));
    ws.on('framereceived', keep('received'));
    ws.on('close', () => frames.closes.push(Date.now()));
  });
  return frames;
}
const received = (frames, type) => frames.filter((f) => f.dir === 'received' && f.msg?.type === type).map((f) => f.msg);
const sent = (frames, type) => frames.filter((f) => f.dir === 'sent' && f.msg?.type === type).map((f) => f.msg);

/** The app on `#/map`, the link live, the pane open, the input tapped (a touch screen: D20). */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await page.locator(INPUT).tap();
  await expect(page.locator(INPUT)).toBeFocused();
}

/** Type `text` and tap SEND; resolves with the test's clock at the tap. */
async function typeAndSend(page, text) {
  await page.locator(INPUT).fill(text);
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
  const at = Date.now();
  await page.touchscreen.tap(SEND_AT.x, SEND_AT.y);
  return at;
}

/** Wait on the test's clock until `t0 + ms`. */
async function until(t0, ms) {
  const left = t0 + ms - Date.now();
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** A colour against a token, through a probe styled `color: var(<token>)`. */
const tokenColour = (page, token) => page.evaluate((tok) => {
  const probe = document.createElement('span');
  probe.style.color = `var(${tok})`;
  document.body.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c;
}, token);

/** The prompt block holding `text`: its label, its text's colour, its word's look. */
const blockLook = (page, text) => page.evaluate((t) => {
  const items = [...document.querySelectorAll('[data-cockpit-conversation] .ck-prompt')].filter((n) => n.textContent === t);
  const n = items.at(-1);
  if (!n) return null;
  const item = n.closest('.ck-pitem') ?? n.closest('.ck-turn');
  const label = n.previousElementSibling;
  const word = label?.querySelector('[data-turn-delivery]');
  return {
    count: items.length,
    label: label?.textContent ?? null,
    colour: getComputedStyle(n).color,
    word: word ? { size: parseFloat(getComputedStyle(word).fontSize), colour: getComputedStyle(word).color } : null,
    turnId: n.closest('[data-turn-id]')?.dataset.turnId ?? null,
    queued: item?.closest('.ck-queue') !== null && item?.closest('.ck-queue') !== undefined,
  };
}, text);

/** The items of turn `turnId` in DOM order: `prompt:<text>`, `text:<words>`, `tool`, `agent`. */
const turnOrder = (page, turnId) => page.evaluate((id) => {
  const box = document.querySelector(`[data-turn-id="${id}"]`);
  const out = [];
  for (const n of box.querySelectorAll('.ck-label, .ck-prompt, .ck-block, [data-tool-line]')) {
    if (n.matches('.ck-label')) { if (n.textContent.startsWith('AGENT')) out.push('agent'); continue; }
    if (n.matches('.ck-prompt')) out.push(`prompt:${n.textContent}`);
    else if (n.matches('[data-tool-line]')) out.push('tool');
    else out.push(`text:${n.textContent.trim()}`);
  }
  return out;
}, turnId);

test('S-C1-16 Sending during an answer steers it: queued, then taken into the same turn (pending Q-O1)', async ({ page, room, fakeAgent }) => {
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  // The page's clock: a fake one, flowing until the steer, then moved by hand (`clock page`).
  await page.clock.install();
  await openPane(page, room);
  await page.evaluate(() => {
    // Every word the header showed, from here on.
    window.__words = [];
    const w = document.querySelector('[data-cockpit-turn]');
    new MutationObserver(() => window.__words.push(w.textContent)).observe(w, { childList: true, characterData: true, subtree: true });
  });
  const prompts = () => fakeAgentLog(fakeAgent.dir).prompts();

  const t0 = await typeAndSend(page, 'how did the night go');
  await expect(page.locator(':root')).not.toHaveAttribute('data-turn', 'idle');
  await expect(page.locator('[data-tool-line][data-running]')).toHaveCount(1, { timeout: 2_000 });
  const firstTurn = received(frames, 'turn.prompt')[0].turnId;

  await test.step('t = 2 s: `only the failed one` typed, the slot reads SEND, no hint line; SEND tapped', async () => {
    await page.locator(INPUT).fill(STEER);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
    await expect(page.locator('[data-cockpit-line][data-line="hint"]')).toHaveCount(0);
    await until(t0, 2_000);
    // From here the page's clock moves only by hand: t = 2.0 s is the tap.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
    await page.evaluate(() => {
      window.__atTap = null;
      // Read in the tap's own click task, after the pane's handler (bubbling to the document).
      document.addEventListener('click', () => {
        const blocks = [...document.querySelectorAll('[data-cockpit-conversation] .ck-prompt')];
        const last = blocks.at(-1);
        window.__atTap = {
          label: last?.previousElementSibling?.textContent ?? null,
          text: last?.textContent ?? null,
          lastInConvo: last?.closest('.ck-turn') === [...document.querySelectorAll('.ck-turns > .ck-turn')].at(-1),
        };
      }, { once: true });
    });
    await page.touchscreen.tap(SEND_AT.x, SEND_AT.y);
    const at = await (await page.waitForFunction(() => window.__atTap)).jsonValue();
    expect(at.label, 'by t = 2.1 s: drawn last with SENDING').toMatch(/^YOU · \d\d:\d\d · SENDING$/);
    expect(at.text).toBe(STEER);
    expect(at.lastInConvo).toBe(true);
  });

  let atTwo = null;
  await test.step('t = 2.05 s: the slot reads SEND in --text-3, data-send="wait"', async () => {
    await page.clock.runFor(50);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'wait');
    await expect(page.locator(SEND)).toHaveText('SEND');
    const look = await page.locator(SEND).evaluate((n) => ({ colour: getComputedStyle(n).color, aria: n.getAttribute('aria-disabled'), inert: n.inert }));
    expect(look).toEqual({ colour: await tokenColour(page, '--text-3'), aria: 'true', inert: true });
  });

  await test.step('t = 2.2 s: the fake agent read one prompt with priority next, about 2 s after the first', async () => {
    await page.clock.runFor(150);
    await expect.poll(() => prompts().length).toBe(2);
    atTwo = prompts();
    expect(atTwo[1].words).toBe(STEER);
    expect(atTwo[1].priority).toBe('next');
    const gap = atTwo[1].atMs - atTwo[0].atMs;
    expect(gap, `read ${gap} ms after the first`).toBeGreaterThan(1_500);
    expect(gap).toBeLessThan(2_600);
  });

  await test.step('t = 2.3 s: a tap on the slot sends nothing', async () => {
    await page.clock.runFor(100);
    await page.touchscreen.tap(SEND_AT.x, SEND_AT.y);
    await page.waitForTimeout(100);
    expect(sent(frames, 'stop'), 'no stop').toEqual([]);
    expect(sent(frames, 'prompt').length, 'no third prompt').toBe(2);
  });

  await test.step('t = 2.5 s: QUEUED, the text --text-2, the word 18 px --text-1, the block ends at y ≤ 744 clear of the opener', async () => {
    await page.clock.runFor(200);
    const look = await blockLook(page, STEER);
    expect(look.label).toMatch(/^YOU · \d\d:\d\d · QUEUED$/);
    expect(look.colour).toBe(await tokenColour(page, '--text-2'));
    expect(look.word.size).toBeGreaterThanOrEqual(18);
    expect(look.word.colour).toBe(await tokenColour(page, '--text-1'));
    expect(look.turnId, 'queued into the running turn').toBe(firstTurn);
    const pinned = await page.evaluate(() => { const c = document.querySelector('.ck-convo'); return c.scrollTop + c.clientHeight >= c.scrollHeight - 1; });
    expect(pinned, 'the conversation at its end').toBe(true);
    const block = await rectOf(page, QUEUED_BLOCK);
    expect(block.y2, `the queued block's bottom ${block.y2}`).toBeLessThanOrEqual(744);
    expect(intersects(block, await rectOf(page, OPENER)), 'clear of the opener (D267)').toBe(false);
  });

  const cdp = await page.context().newCDPSession(page);
  await test.step('t = 2.9 s pressed, 2.95 s `wait`, 3.05 s `■ STOP`, lifted at 3.1 s: nothing stops', async () => {
    await page.clock.runFor(400);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: SEND_AT.x, y: SEND_AT.y }] });
    await page.clock.runFor(50);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'wait');
    await page.clock.runFor(100);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'stop');
    await expect(page.locator(SEND)).toHaveText('■STOP');
    await expect(page.locator(SEND)).toHaveAccessibleName('Stop');
    await page.clock.runFor(50);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    expect(sent(frames, 'stop'), 'the press that began in the second stops nothing').toEqual([]);
    await expect(page.locator(':root')).not.toHaveAttribute('data-turn', 'stopping');
  });

  await test.step('the tool ends at t = 4.0 s: within 0.1 s QUEUED goes, the text --text-1, the block in its place in the turn', async () => {
    await page.clock.resume();
    await expect.poll(() => received(frames, 'prompt.taken').length, { timeout: 5_000 }).toBe(1);
    const taken = received(frames, 'prompt.taken')[0];
    expect([taken.turnId, taken.state]).toEqual([firstTurn, 'taken']);
    await expect(page.locator(QUEUED)).toHaveCount(0, { timeout: 100 });
    const look = await blockLook(page, STEER);
    expect(look.label).toMatch(/^YOU · \d\d:\d\d$/);
    expect(look.colour).toBe(await tokenColour(page, '--text-1'));
    expect(look.turnId).toBe(firstTurn);
    expect(prompts(), 'the fake agent read nothing more').toEqual(atTwo);
  });

  await test.step('`Only builder-a failed.` below the block in the same turn, one AGENT row above `Three runs ran last night.`', async () => {
    await expect(page.locator(`[data-turn-id="${firstTurn}"] .ck-block`, { hasText: 'Only builder-a failed.' })).toHaveCount(1, { timeout: 5_000 });
    const order = await turnOrder(page, firstTurn);
    expect(order).toEqual([
      'prompt:how did the night go', 'agent', 'text:Three runs ran last night.', 'tool', `prompt:${STEER}`, 'text:Only builder-a failed.',
    ]);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 5_000 });
  });

  await test.step('the header read ● WORKING throughout, never ● STOPPING; no STOPPED AT; the fake agent saw no interrupt', async () => {
    const words = await page.evaluate(() => window.__words);
    expect(words.filter((w) => w !== 'READY').every((w) => w === '● WORKING'), words.join(', ')).toBe(true);
    await expect(page.getByText('STOPPED AT')).toHaveCount(0);
    expect(fakeAgentLog(fakeAgent.dir).order('interrupt')).toEqual([]);
    expect(sent(frames, 'stop')).toEqual([]);
  });
  await cdp.detach();
});

/**
 * S-C1-28's run: `first` at t = 0 on a turn whose `queued` drops the steer, STEER at 1 s.
 * The room's clock is `manual` from the queued echo on (the agent's turn plays on its own
 * time), so the 10 s count starts at `turn.end` exactly; it is moved by hand once the turn's
 * `done` is read.
 */
async function queueUnread(page, room, frames, first) {
  const before = received(frames, 'turn.end').length;
  const t0 = await typeAndSend(page, first);
  await until(t0, 1_000);
  await typeAndSend(page, STEER);
  await expect(page.locator(QUEUED)).toHaveCount(1, { timeout: 500 });
  expect((await room.control('POST', '/clock', { mode: 'manual' })).status).toBe(200);
  await expect.poll(() => received(frames, 'turn.end').length, { timeout: 6_000 }).toBe(before + 1);
}

/** The room's clock moved `ms` in steps of at most 10 s. */
async function advanceRoom(room, ms) {
  for (let left = ms; left > 0;) {
    const step = Math.min(10_000, left);
    left -= step;
    const r = await room.control('POST', '/clock', { advanceMs: step });
    expect(r.status, `the room's clock moved ${step} ms`).toBe(200);
  }
}

test('S-C1-28 A queued prompt the agent never reads is sent once more, then shown as not sent (pending Q-O1)', async ({ page, room, fakeAgent }) => {
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  await openPane(page, room);
  const steers = () => fakeAgentLog(fakeAgent.dir).prompts().filter((p) => p.words === STEER);
  const resendLines = () => room.booted.logs().split('\n').filter((l) => l.includes('prompt.resend'));

  await test.step('`ignore-once`: resent at 13 s with a new UUID, taken as a new turn by 13.5 s', async () => {
    await queueUnread(page, room, frames, 'count the runs');
    const block = sent(frames, 'prompt').find((m) => m.text === STEER);
    await advanceRoom(room, 9_900);
    await page.waitForTimeout(200);
    expect(steers().length, 'not resent before 13 s').toBe(1);
    await advanceRoom(room, 100);
    await expect.poll(() => steers().length).toBe(2);
    const [one, two] = steers();
    expect(two.uuid).not.toBe(one.uuid);
    expect(two.resendOf).toBe(one.uuid);
    expect(resendLines().length, 'one resend').toBe(1);
    expect(resendLines()[0]).toContain(`prompt.resend ${one.uuid} ${two.uuid}`);
    // by 13.5 s: QUEUED gone, the reply under its own AGENT row
    await expect(page.locator(QUEUED)).toHaveCount(0, { timeout: 500 });
    const fromQueued = received(frames, 'turn.prompt').find((m) => m.from === 'queued');
    expect(fromQueued).toMatchObject({ clientId: block.clientId, delivery: 'new', from: 'queued' });
    const idx = (pred) => frames.findIndex((f) => f.dir === 'received' && pred(f.msg));
    const iPrompt = idx((m) => m?.type === 'turn.prompt' && m.from === 'queued');
    const iTaken = idx((m) => m?.type === 'prompt.taken' && m.turnId === fromQueued.turnId);
    expect(iPrompt).toBeGreaterThanOrEqual(0);
    expect(iTaken, 'turn.prompt before its prompt.taken (D258)').toBeGreaterThan(iPrompt);
    expect(fromQueued.turnId).not.toBe(received(frames, 'turn.prompt')[0].turnId);
    await expect(page.locator(`[data-turn-id="${fromQueued.turnId}"] .ck-block`, { hasText: 'Only builder-a failed.' })).toHaveCount(1, { timeout: 3_000 });
    expect(await turnOrder(page, fromQueued.turnId)).toEqual([`prompt:${STEER}`, 'agent', 'text:Only builder-a failed.']);
    expect((await blockLook(page, STEER)).count, 'one prompt block with the text').toBe(1);
    expect(frames.closes, 'the link never closed (no 4000 gap)').toEqual([]);
    expect(sent(frames, 'hello').length, 'no second hello').toBe(1);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 3_000 });
    await advanceRoom(room, 20_000);
    await page.waitForTimeout(200);
    expect(steers().length, 'exactly one resend').toBe(2);
    expect(received(frames, 'prompt.taken').filter((m) => m.state === 'cancelled')).toEqual([]);
    expect((await room.control('POST', '/clock', { mode: 'real' })).status).toBe(200);
  });

  await test.step('`ignore`: the resend is not read either; at 23 s NOT SENT, `The agent did not read this.`, RETRY, EDIT', async () => {
    const was = steers().length;
    await queueUnread(page, room, frames, 'count the lanes');
    await advanceRoom(room, 10_000);
    await expect.poll(() => steers().length).toBe(was + 2);
    expect(steers().at(-1).resendOf).toBe(steers().at(-2).uuid);
    expect(resendLines().length).toBe(2);
    expect(resendLines()[1]).toContain(`prompt.resend ${steers().at(-2).uuid} ${steers().at(-1).uuid}`);
    await page.waitForTimeout(300);
    await expect(page.locator(QUEUED), 'still queued until 23 s').toHaveCount(1);
    await advanceRoom(room, 9_900);
    await page.waitForTimeout(200);
    await expect(page.locator(QUEUED), 'still queued at 22.9 s').toHaveCount(1);
    await advanceRoom(room, 100);
    const line = page.locator('[data-turn-error="not-sent"]');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('The agent did not read this.');
    await expect(line.getByRole('button', { name: 'RETRY' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'EDIT' })).toBeVisible();
    const look = await blockLook(page, STEER);
    expect(look.label).toMatch(/^YOU · \d\d:\d\d · NOT SENT$/);
    const cancel = received(frames, 'prompt.taken').filter((m) => m.state === 'cancelled');
    expect(cancel.map((m) => m.why)).toEqual(['not-taken']);
    await advanceRoom(room, 20_000);
    await page.waitForTimeout(200);
    expect(steers().length, 'exactly one resend').toBe(was + 2);
    expect((await room.control('POST', '/clock', { mode: 'real' })).status).toBe(200);
  });
});

/** The running turn of a `snapshot` frame received after index `from`. */
const snapshotAfter = (frames, from) => frames.slice(from).filter((f) => f.dir === 'received' && f.msg?.type === 'snapshot').map((f) => f.msg).at(-1);

test('S-C1-29 A queued prompt survives a reload (pending Q-O1)', async ({ page, room, fakeAgent }) => {
  test.setTimeout(120_000);
  const frames = recordFrames(page);
  await room.start({ script: 'c1-typing' });
  await openPane(page, room);
  const steers = () => fakeAgentLog(fakeAgent.dir).prompts().filter((p) => p.words === STEER);

  await test.step('queued, reloaded at 3 s: by 5 s the snapshot shows the tool line with ● and the block last, QUEUED, the same HH:MM', async () => {
    const t0 = await typeAndSend(page, 'check all lanes');
    await until(t0, 1_000);
    await typeAndSend(page, STEER);
    await expect(page.locator(QUEUED)).toHaveCount(1, { timeout: 500 });
    const block = sent(frames, 'prompt').find((m) => m.text === STEER);
    const before = await blockLook(page, STEER);
    await until(t0, 3_000);
    const from = frames.length;
    await page.reload();
    await cockpitDecided(page);
    await page.locator(OPENER).tap();
    await expect(page.locator(QUEUED)).toHaveCount(1, { timeout: 2_000 });
    expect(Date.now() - t0, 'drawn by 5 s').toBeLessThanOrEqual(5_000);
    const snap = snapshotAfter(frames, from);
    const running = snap.turns.find((t) => !t.end);
    expect(running.items.filter((it) => it.kind === 'prompt')).toEqual([
      expect.objectContaining({ kind: 'prompt', state: 'queued', clientId: block.clientId }),
    ]);
    await expect(page.locator(`[data-turn-id="${running.turnId}"] [data-tool-line][data-running]`)).toHaveCount(1);
    const after = await blockLook(page, STEER);
    expect(after.label, 'the same HH:MM as before').toBe(before.label);
    expect(after.colour).toBe(await tokenColour(page, '--text-2'));
    const last = await page.evaluate(() => [...document.querySelectorAll('.ck-turns .ck-prompt')].at(-1)?.textContent);
    expect(last, 'the conversation\'s last block').toBe(STEER);
    // At 20 s the agent takes it: by 20.1 s QUEUED gone, --text-1, above the text that follows.
    await expect.poll(() => received(frames, 'prompt.taken').length, { timeout: 20_000 }).toBe(1);
    await expect(page.locator(QUEUED)).toHaveCount(0, { timeout: 100 });
    expect((await blockLook(page, STEER)).colour).toBe(await tokenColour(page, '--text-1'));
    await expect(page.locator(`[data-turn-id="${running.turnId}"] .ck-block`, { hasText: 'Only builder-a failed.' })).toHaveCount(1, { timeout: 3_000 });
    expect(await turnOrder(page, running.turnId)).toEqual(['prompt:check all lanes', 'agent', 'tool', `prompt:${STEER}`, 'text:Only builder-a failed.']);
    expect(steers().length).toBe(1);
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 3_000 });
  });

  // The second case on a fresh room: the fake agent's long turn plays once a room (its log
  // goes on in the same file, so the counts below are the second room's).
  const earlier = steers().length;
  // 6 seeded turns, so the conversation scrolls and the line must keep it at its end.
  await room.start({ turns: 6, script: 'c1-typing' });
  await openPane(page, room);

  await test.step('second case: STOP at 3 s: NOT SENT, `Dropped by STOP.`; reloaded at 5 s: by 7 s the same label, line, RETRY and EDIT', async () => {
    const t0 = await typeAndSend(page, 'check all lanes');
    await until(t0, 1_000);
    await typeAndSend(page, STEER);
    await expect(page.locator(QUEUED)).toHaveCount(1, { timeout: 500 });
    const block = sent(frames, 'prompt').filter((m) => m.text === STEER).at(-1);
    await until(t0, 3_000);
    await expect(page.locator(SEND)).toHaveAttribute('data-send', 'stop');
    await page.touchscreen.tap(SEND_AT.x, SEND_AT.y);
    const line = page.locator('[data-turn-error="not-sent"]');
    await expect(line).toContainText('Dropped by STOP.', { timeout: 2_000 });
    const before = await blockLook(page, STEER);
    expect(before.label).toMatch(/^YOU · \d\d:\d\d · NOT SENT$/);
    // The line and its buttons in sight: the conversation stays at its end (§4), no `↓ NEW`.
    await expect.poll(() => page.evaluate(() => { const c = document.querySelector('.ck-convo'); return c.scrollTop + c.clientHeight >= c.scrollHeight - 1; })).toBe(true);
    await expect(page.locator('[data-cockpit-follow]')).toBeHidden();
    await expect(page.locator(':root')).toHaveAttribute('data-turn', 'idle', { timeout: 2_000 });
    await until(t0, 5_000);
    const from = frames.length;
    await page.reload();
    await cockpitDecided(page);
    await page.locator(OPENER).tap();
    await expect(line).toContainText('Dropped by STOP.', { timeout: 2_000 });
    expect(Date.now() - t0, 'drawn by 7 s').toBeLessThanOrEqual(7_000);
    const snap = snapshotAfter(frames, from);
    const items = snap.turns.flatMap((t) => t.items).filter((it) => it.kind === 'prompt');
    expect(items).toEqual([expect.objectContaining({ clientId: block.clientId, state: 'cancelled', why: 'stopped' })]);
    expect((await blockLook(page, STEER)).label).toBe(before.label);
    await expect(line.getByRole('button', { name: 'RETRY' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'EDIT' })).toBeVisible();
  });

  await test.step('RETRY sends `only the failed one` as a new turn with a new clientId', async () => {
    const was = sent(frames, 'prompt').length;
    await page.locator('[data-turn-error="not-sent"]').getByRole('button', { name: 'RETRY' }).tap();
    await expect.poll(() => sent(frames, 'prompt').length).toBe(was + 1);
    const again = sent(frames, 'prompt').at(-1);
    const first = sent(frames, 'prompt').filter((m) => m.text === STEER).at(-2);
    expect(again.text).toBe(STEER);
    expect(again.clientId).not.toBe(first.clientId);
    await expect.poll(() => steers().length, 'prompts() 2 after RETRY').toBe(earlier + 2);
    await expect.poll(() => received(frames, 'turn.prompt').filter((m) => m.clientId === again.clientId).length).toBe(1);
    expect(received(frames, 'turn.prompt').find((m) => m.clientId === again.clientId).delivery).toBe('new');
  });
});
