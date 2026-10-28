// C1, build 13: the status line and the agent's login check (spec c1-talk.md §10.1,
// protocols.md §3.5, §11.10, screens.md §7; D151, D152, D232). The room under test and the
// fake agent on script `c1-login`; C1's `stt.url: none` layout (D265): no talk button.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, WALL_PAGE, rectOf, cockpitDecided } from './fixtures.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';

const STATUS = '[data-cockpit-status]';
const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const OPENER = '[data-cockpit-open]';
const LOGGED_OUT_0315 = 'The agent is not logged in on the room since 03:15 (0 min). Log it in there.';

/** `HH:MM` of an ISO time in the page's zone (the harness's Europe/Zurich). */
const hhmmZurich = (iso) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

/**
 * Record, in the page, the status line in the first animation frame after each `welcome` on
 * the room link: `window.__afterWelcome` `[{status, text}]`.
 */
async function watchWelcomes(page) {
  await page.addInitScript(() => {
    if (window.__afterWelcome) return;
    window.__afterWelcome = [];
    const Base = window.WebSocket;
    window.WebSocket = class extends Base {
      constructor(...args) {
        super(...args);
        if (!/\/api\/cockpit\/ws$/.test(String(args[0]))) return;
        this.addEventListener('message', (ev) => {
          let type = null;
          try { type = JSON.parse(ev.data).type; } catch { return; }
          if (type !== 'welcome') return;
          requestAnimationFrame(() => {
            const s = document.querySelector('[data-cockpit-status]');
            window.__afterWelcome.push({ status: s?.dataset.status ?? null, text: s?.querySelector('.ck-status-text')?.textContent ?? null });
          });
        });
      }
    };
  });
}
const welcomes = (page) => page.evaluate(() => window.__afterWelcome.slice());

/**
 * The page's clock fixed at `iso`: `Date.now()` and `new Date()` only. Not `page.clock`: it
 * fakes the timers too, for the whole context, and its timers fall behind real time when the
 * machine is busy (seen: 1.2 s of page time in 26 s), so a 5 s grace (D139) never ran out
 * within the 7 s the step allows; S-C1-38 runs on clock `real`.
 */
async function fixPageDate(page, iso) {
  await page.addInitScript((at) => {
    const Real = Date;
    class Fixed extends Real {
      constructor(...args) { if (args.length) super(...args); else super(at); }
      static now() { return at; }
    }
    globalThis.Date = Fixed;
  }, Date.parse(iso));
}

/** Sample the slot every `every` ms (100, or finer) in the page: `window.__statusSamples` `[{t, n, status, text}]`. */
async function sampleStatus(page, every = 100) {
  await page.evaluate((ms) => {
    window.__statusSamples = [];
    const take = () => {
      const all = document.querySelectorAll('[data-cockpit-status]');
      const s = all[0];
      window.__statusSamples.push({ t: performance.now(), n: all.length, status: s?.dataset.status ?? null, text: s?.querySelector('.ck-status-text')?.textContent ?? null });
    };
    take();
    window.__statusTimer = setInterval(take, ms);
  }, every);
}
const samples = (page) => page.evaluate(() => window.__statusSamples.slice());

async function openWall(page, room) {
  await page.goto(`${room.url}${WALL_PAGE}?ratio=0.5`);
  await cockpitDecided(page);
  await page.waitForFunction(() => Boolean(window.__cockpitView?.wall));
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit-layout', 'wall');
}

async function openPane(page) {
  await page.locator(OPENER).tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
}

/** C1's layout (D265): no talk button; SEND enabled with a draft, the draft kept. */
async function sendEnabledWithDraft(page, enabled) {
  await expect(page.locator('[data-talk]'), 'no talk button in C1 (stt none)').toHaveCount(0);
  await page.locator(INPUT).fill('how is the night');
  if (enabled) await expect(page.locator(SEND)).toBeEnabled();
  else await expect(page.locator(SEND)).toBeDisabled();
  await expect(page.locator(INPUT)).toHaveValue('how is the night');
}

const advanceRoom = async (room, ms) => {
  const r = await room.control('POST', '/clock', { advanceMs: ms });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
};

/** The next case on a fresh room: the last one stopped, the fake's log and counter begun again (one agent dir per test). */
async function nextRoom(room, fakeAgent, opts) {
  await room.booted.stop();
  // stand-ins.md §2.6: the log and the `starts` counter (startFailures counts on it) begin again.
  for (const f of ['received.jsonl', 'starts']) fs.rmSync(path.join(fakeAgent.dir, f), { force: true });
  await room.start(opts);
}

const sentStatus = async (room) => (await room.control('GET', '/sent?type=status')).body.items.map((m) => m.status);

/**
 * S-C1-37's Given and first When: the room at 03:00 `manual` with `login` `ok`, then `failed`
 * and 900 s: the second check finds it; the page loaded at 03:15:00 (its clock fixed).
 */
async function loggedOutAt0315(page, room, fakeAgent) {
  await room.start({ script: 'c1-login', clock: { set: '2026-10-27T03:00:00+01:00', mode: 'manual' } });
  const log = fakeAgentLog(fakeAgent.dir);
  await expect.poll(() => log.loginChecks().length, { message: 'the check at the room\'s start' }).toBe(1);
  await expect.poll(() => log.starts().length).toBe(1);
  // The agent's `ready` before the 900 s: the room's 30 s ready limit is on the manual clock too.
  await expect.poll(() => /cockpit agent: ready/.test(room.booted.logs()), { timeout: 10_000 }).toBe(true);
  fakeAgent.edit((sc) => { sc.start.login = 'failed'; });
  await advanceRoom(room, 900_000);
  expect(log.loginChecks().length, 'a second login-check line').toBe(2);
  expect(log.loginChecks()[1].login).toBe('failed');
  await watchWelcomes(page);
  await fixPageDate(page, '2026-10-27T03:15:00+01:00');
  await openWall(page, room);
  await openPane(page);
  await expect.poll(() => welcomes(page).then((w) => w.length)).toBeGreaterThan(0);
  return log;
}

test('S-C1-37 A logged-out agent is named before any prompt, and the line goes after the login', async ({ page, room, fakeAgent, context }) => {
  let log;
  await test.step('login failed and 900 s: a page loaded now shows not-logged-in in its first frame after welcome, 80 px at y 64, 18 px, SEND enabled, nothing sent', async () => {
    log = await loggedOutAt0315(page, room, fakeAgent);
    expect((await welcomes(page))[0]).toEqual({ status: 'not-logged-in', text: LOGGED_OUT_0315 });
    const s = page.locator(STATUS);
    await expect(s).toHaveCount(1);
    await expect(s).toHaveAttribute('data-status', 'not-logged-in');
    await expect(s.locator('.ck-status-text')).toHaveText(LOGGED_OUT_0315);
    const r = await rectOf(page, STATUS);
    expect(r.y1, JSON.stringify(r)).toBe(64);
    expect(r.y2, JSON.stringify(r)).toBe(144);
    expect(await s.evaluate((n) => getComputedStyle(n).fontSize)).toBe('18px');
    expect(await s.locator('.ck-status-text').evaluate((n) => getComputedStyle(n).fontSize)).toBe('18px');
    await sendEnabledWithDraft(page, true);
    await page.locator(INPUT).fill('');
    expect(log.prompts().length, 'fakeAgent.prompts()').toBe(0);
  });

  await test.step('60 s three times: three more checks, the text unchanged (since 03:15)', async () => {
    for (let i = 0; i < 3; i += 1) await advanceRoom(room, 60_000);
    expect(log.loginChecks().length).toBe(5);
    await expect(page.locator(`${STATUS} .ck-status-text`)).toHaveText(LOGGED_OUT_0315);
  });

  await test.step('login ok and 60 s: within 1 s the line is gone, the conversation\'s top at y 64, the agent restarted (starts + 1)', async () => {
    const starts = log.starts().length;
    fakeAgent.edit((sc) => { sc.start.login = 'ok'; });
    await advanceRoom(room, 60_000);
    await expect(page.locator(STATUS)).toHaveCount(0, { timeout: 1000 });
    expect((await rectOf(page, '[data-cockpit-conversation] .ck-band')).y1).toBe(64);
    await expect.poll(() => log.starts().length, { timeout: 5000 }).toBe(starts + 1);
    expect(log.starts().at(-1).argv, 'with --resume').toContain('--resume');
    expect((await sentStatus(room)).map((s) => s?.code ?? null), JSON.stringify(await sentStatus(room))).toEqual(['not-logged-in', null]);
    expect(log.prompts().length).toBe(0);
  });

  await test.step('second case: the room started with login failed: a page loaded 2 s after shows the line with the room\'s start time, before anything is typed', async () => {
    const before = Date.now();
    await nextRoom(room, fakeAgent, { script: 'c1-login', edit: (sc) => { sc.start.login = 'failed'; } });
    const page = await context.newPage(); // the page's own clock, not the first case's fixed 03:15
    await watchWelcomes(page);
    await page.waitForTimeout(Math.max(0, before + 2000 - Date.now()));
    await openWall(page, room);
    await openPane(page);
    const [first] = await sentStatus(room);
    expect(first.code).toBe('not-logged-in');
    const since = Date.parse(first.since);
    expect(since).toBeGreaterThanOrEqual(before);
    expect(since - before, 'found at the room\'s start').toBeLessThan(5000);
    await expect.poll(() => welcomes(page).then((w) => w[0]?.status)).toBe('not-logged-in');
    await expect(page.locator(`${STATUS} .ck-status-text`)).toHaveText(`The agent is not logged in on the room since ${hhmmZurich(first.since)} (0 min). Log it in there.`);
    await expect(page.locator(INPUT)).toHaveValue('');
    expect(fakeAgentLog(fakeAgent.dir).prompts().length).toBe(0);
  });
});

test('S-C1-38 One status line: the highest that holds wins, news never waits', async ({ page: first, room, fakeAgent, context }) => {
  let page = first;
  await test.step('S-C1-37\'s page with not-logged-in showing', async () => {
    await loggedOutAt0315(page, room, fakeAgent);
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'not-logged-in');
    // The rest runs on real time (the scenario's clock `real`); the room's 03:15 stays.
    expect((await room.control('POST', '/clock', { mode: 'real' })).status).toBe(200);
    await sampleStatus(page);
  });

  await test.step('the link stops and 5 s pass: room-down, its own clock; still one status element', async () => {
    expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'room-down', { timeout: 7000 });
    await expect(page.locator(`${STATUS} .ck-status-text`)).toHaveText(/^Cockpit room unreachable since 03:15 \(0 min\)\./);
    expect((await samples(page)).every((s) => s.n <= 1), 'never two status elements').toBe(true);
  });

  await test.step('the page offline: offline; online again: room-down', async () => {
    await context.setOffline(true);
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'offline');
    await expect(page.locator(`${STATUS} .ck-status-text`)).toHaveText('This screen is offline since 03:15 (0 min). Check its network.');
    await context.setOffline(false);
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'room-down');
  });

  await test.step('the link starts again: the first frame after welcome shows not-logged-in since 03:15, and no `Back since` to 6 s', async () => {
    const seen = (await welcomes(page)).length;
    expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
    // RETRY NOW (screens.md §7.1) so the wait is not the backoff's.
    await page.locator(`${STATUS} button`).tap();
    await expect.poll(() => welcomes(page).then((w) => w.length), { timeout: 20_000 }).toBeGreaterThan(seen);
    expect((await welcomes(page))[seen]).toEqual({ status: 'not-logged-in', text: LOGGED_OUT_0315 });
    const from = (await samples(page)).length;
    const t0 = (await samples(page)).at(-1).t;
    await expect.poll(async () => (await samples(page)).at(-1).t - t0, { timeout: 10_000 }).toBeGreaterThanOrEqual(6000);
    const after = (await samples(page)).slice(from);
    const gaps = after.slice(1).map((x, i) => x.t - after[i].t);
    expect(Math.max(...gaps), 'a sample at least every ~100 ms').toBeLessThan(300);
    expect(after.filter((s) => s.status === 'back' || /Back since/.test(s.text ?? '')), 'no Back since').toEqual([]);
    expect(after.every((s) => s.n === 1 && s.status === 'not-logged-in')).toBe(true);
    expect((await sentStatus(room)).map((s) => s?.code ?? null), 'one status message per change').toEqual(['not-logged-in']);
  });

  await context.setOffline(false);
  await nextRoom(room, fakeAgent, {
    script: 'c1-login',
    edit: (sc) => { sc.start.login = 'failed'; sc.start.startFailures = 3; sc.start.startStderr = 'claude: command not found'; },
  });
  const log = fakeAgentLog(fakeAgent.dir);
  await page.close();
  page = await context.newPage();
  await openWall(page, room);
  await openPane(page);
  await sampleStatus(page);

  await test.step('second case: after the second failed start: agent-down since the room\'s time of it, SEND and talk disabled', async () => {
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'agent-down', { timeout: 5000 });
    const down = (await sentStatus(room)).find((s) => s?.code === 'agent-down');
    expect(down.blocksSend).toBe(true);
    await expect(page.locator(`${STATUS} .ck-status-text`)).toHaveText(`Agent not running since ${hhmmZurich(down.since)} (0 min).`);
    await sendEnabledWithDraft(page, false);
  });

  await test.step('second case: at the fourth start\'s ready (about 6 s after the first): not-logged-in, SEND enabled again; no agent-back', async () => {
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'not-logged-in', { timeout: 12_000 });
    const starts = log.starts();
    expect(starts.length).toBe(4);
    expect(starts[3].atMs - starts[0].atMs, 'the 4th start ~6 s after the first (0, 2, 4 s)').toBeGreaterThan(5500);
    expect(starts[3].atMs - starts[0].atMs).toBeLessThan(8000);
    await expect(page.locator(SEND)).toBeEnabled();
    await expect(page.locator(INPUT)).toHaveValue('how is the night');
    await page.waitForTimeout(1000);
    const seen = await samples(page);
    expect(seen.some((s) => s.status === 'agent-back'), 'no agent-back while not-logged-in holds').toBe(false);
    expect(seen.every((s) => s.n <= 1)).toBe(true);
    const codes = (await sentStatus(room)).map((s) => s?.code ?? null);
    expect(codes.at(-1)).toBe('not-logged-in');
    expect(codes).toContain('agent-down');
    expect(codes).not.toContain('agent-back');
    for (let i = 1; i < codes.length; i += 1) expect(codes[i], 'one message per change').not.toBe(codes[i - 1]);
  });

  await nextRoom(room, fakeAgent, { script: 'c1-login' });
  await page.close();
  page = await context.newPage();
  await openWall(page, room);
  await openPane(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await expect(page.locator(STATUS)).toHaveCount(0);
  await sampleStatus(page, 20); // finer than 100 ms: the 5 s ± 0.2 s is measured

  await test.step('third case: login ok, no condition, the link blips 6 s: `Back since HH:MM.` (the page\'s clock) for 5 s ± 0.2 s, then nothing', async () => {
    expect((await room.control('POST', '/link', { up: false })).status).toBe(200);
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'room-down', { timeout: 7000 });
    await page.waitForTimeout(Math.max(0, 6000 - 5000));
    expect((await room.control('POST', '/link', { up: true })).status).toBe(200);
    await expect(page.locator(STATUS)).toHaveAttribute('data-status', 'back', { timeout: 20_000 });
    const hhmm = await page.evaluate(() => {
      const d = new Date();
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    await expect(page.locator(`${STATUS} .ck-status-text`)).toHaveText(`Back since ${hhmm}.`);
    await expect(page.locator(STATUS)).toHaveCount(0, { timeout: 7000 });
    await page.waitForTimeout(500);
    const all = await samples(page);
    const back = all.filter((s) => s.status === 'back');
    const shown = back.at(-1).t - back[0].t;
    expect(shown, `Back since shown ${Math.round(shown)} ms`).toBeGreaterThanOrEqual(4800 - 2 * 20); // two 20 ms samples of error
    expect(shown).toBeLessThanOrEqual(5200);
    const lastBack = all.lastIndexOf(back.at(-1));
    expect(all.slice(lastBack + 1).every((s) => s.n === 0), 'then nothing').toBe(true);
    expect((await sentStatus(room)), 'the room sent no status').toEqual([]);
  });
});
