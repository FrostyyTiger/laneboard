// C1, build 14: the room's audit lines (spec screens.md §6.4, D164-D166). The room under test,
// alone, writes its own audit log (`booted.auditFile`, LANEBOARD_AUDIT_FILE, stand-ins.md §1.1);
// the fake agent on script `scr-room` (its 20 s night turn). The lines are read back with
// `bin/laneboard audit --json --file` and `audit verify --file` as child processes. C1 has no
// pairing (Q-O21 b): every line's `user` is `board`; the `Under Q-O21 a)` steps are the Pair
// slice's and are not written here (slices.md §3.1).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect, cockpitDecided } from './fixtures.mjs';
import { ROOT } from '../../test/helpers/boot.mjs';
import { fakeAgentLog } from '../../test/cockpit/stand-ins/fake-agent-log.mjs';
import { argsHashOf } from '../../server/fleet/audit.mjs';

const INPUT = '[data-cockpit-input]';
const SEND = '[data-cockpit-send]';
const HEADER = '[data-cockpit-turn]';
const STOPPED = '[data-turn-stopped]';
const NEW = '[data-cockpit-new]';
const START = '[data-newbar="start"]';
/** The slot's centre at 1368x912 in the `none` layout (screens.md §4.1, as c1-stop.spec.mjs). */
const SLOT_AT = { x: 1312, y: 856 };
const LANEBOARD = path.join(ROOT, 'bin', 'laneboard');
const NIGHT = 'how did the night go?';

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

/** `laneboard audit verify --file f`: `{status, stdout}`. */
function auditVerify(file) {
  const r = spawnSync(process.execPath, [LANEBOARD, 'audit', 'verify', '--file', file], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** The lines in the file now (0 before the room wrote any). */
const countNow = (file) => (fs.existsSync(file) ? auditLines(file).length : 0);

/** Wait on the test's clock until `t0 + ms`. */
async function until(t0, ms) {
  const left = t0 + ms - Date.now();
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}

/** The app on `#/map`, the link live, the pane open, the input tapped (a touch screen: D20). */
async function openPane(page, room) {
  await page.goto(`${room.url}/#/map`);
  await cockpitDecided(page);
  await expect(page.locator(':root')).toHaveAttribute('data-cockpit', 'live');
  await page.locator('[data-cockpit-open]').tap();
  await expect(page.locator(':root')).toHaveAttribute('data-pane', 'open');
  await page.locator(INPUT).tap();
  await expect(page.locator(INPUT)).toBeFocused();
}

/** Type `text` and tap SEND; resolves with the test's clock at the tap. */
async function typeAndSend(page, text) {
  await page.locator(INPUT).fill(text);
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'send');
  const at = Date.now();
  await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
  return at;
}

/** Tap the slot as STOP (the input empty); resolves with the test's clock at the tap. */
async function tapStop(page) {
  await expect(page.locator(INPUT)).toHaveValue('');
  await expect(page.locator(SEND)).toHaveAttribute('data-send', 'stop');
  const at = Date.now();
  await page.touchscreen.tap(SLOT_AT.x, SLOT_AT.y);
  return at;
}

/**
 * The page's link helper (public/js/cockpit/link.js `createRoomLink`), a second link from the
 * same page: welcomed, it sends `prompt` as given (D95: a known `clientId`) and resolves with
 * every message the room answered within `waitMs`.
 */
const resendFromPage = (page, prompt, waitMs = 1_500) => page.evaluate(async ([msg, ms]) => {
  const { createRoomLink } = await import('/js/cockpit/link.js');
  const got = [];
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/cockpit/ws`;
  let live;
  const isLive = new Promise((r) => { live = r; });
  const link = createRoomLink({ url, page: 'app', onState: (s) => { if (s.status === 'live') live(); }, onMessage: (m) => got.push(m) });
  link.start();
  try {
    await isLive;
    link.send(msg);
    await new Promise((r) => setTimeout(r, ms));
    return got.filter((m) => m.type !== 'snapshot' && m.type !== 'heartbeat');
  } finally {
    link.stop();
  }
}, [prompt, waitMs]);

test('S-SCR-30 After a prompt and a stop, `laneboard audit` shows each once, without the words', async ({ page, room, fakeAgent }) => {
  test.setTimeout(90_000);
  const frames = recordFrames(page);
  await room.start({ script: 'scr-room' });
  const file = room.booted.auditFile;
  await page.clock.install({ time: new Date('2026-10-27T07:02:00+01:00') });
  await openPane(page, room);
  const before = countNow(file);
  const welcome = of(frames, 'received', 'welcome').at(-1);

  let turnId = null;
  await test.step('the typed prompt at t = 0 s, STOP with the input empty at t = 2 s', async () => {
    const t0 = await typeAndSend(page, NIGHT);
    await expect.poll(() => of(frames, 'received', 'turn.prompt').length).toBe(1);
    turnId = of(frames, 'received', 'turn.prompt')[0].turnId;
    await until(t0, 2_000);
    await tapStop(page);
    await expect(page.locator(STOPPED)).toHaveCount(1, { timeout: 6_500 });
    await expect(page.locator(HEADER)).toHaveText('READY');
  });

  await test.step('`laneboard audit --json` prints exactly two new lines: cockpit.prompt, then cockpit.stop; the words only hashed', async () => {
    const fresh = auditLines(file).slice(before);
    expect(fresh.map((e) => e.action)).toEqual(['cockpit.prompt', 'cockpit.stop']);
    const [p, s] = fresh;
    expect([p.user, p.via, p.target]).toEqual(['board', 'cockpit', turnId]);
    expect(p.result).toEqual({ ok: true, source: 'typed', delivery: 'new', chars: 21 });
    expect(p.argsHash).toBe(argsHashOf({ text: NIGHT }));
    expect([s.user, s.via, s.target, s.result.ok]).toEqual(['board', 'cockpit', turnId, true]);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('night');
    const v = auditVerify(file);
    expect(v.status, v.stderr).toBe(0);
    expect(v.stdout).toMatch(/^ok \d+ entries/);
  });

  await test.step('the same prompt again with the same clientId (D95): no third line', async () => {
    const { seq: _seq, ...again } = of(frames, 'sent', 'prompt')[0];
    const answers = await resendFromPage(page, again);
    const echo = answers.find((m) => m.type === 'turn.prompt');
    expect(echo?.turnId, 'the room answers with the same echo').toBe(turnId);
    expect(echo.seq, 'the repeat has no seq').toBeUndefined();
    expect(auditLines(file).slice(before).map((e) => e.action)).toEqual(['cockpit.prompt', 'cockpit.stop']);
    expect(fakeAgentLog(fakeAgent.dir).prompts().length, 'nothing more reached the agent').toBe(1);
  });

  await test.step('NEW, then START: one cockpit.new line, `target` the new conversation, `result.from` the old one', async () => {
    await page.locator(NEW).tap();
    await page.locator(START).tap();
    await expect.poll(() => of(frames, 'received', 'conversation.new').length, { timeout: 10_000 }).toBe(1);
    const cn = of(frames, 'received', 'conversation.new')[0];
    await expect.poll(() => auditLines(file).slice(before).length).toBe(3);
    const n = auditLines(file).slice(before)[2];
    expect([n.user, n.via, n.action, n.target]).toEqual(['board', 'cockpit', 'cockpit.new', cn.conversation]);
    expect(n.result).toEqual({ ok: true, from: welcome.conversation, stoppedTurn: null });
    expect(auditVerify(file).status).toBe(0);
  });
});

test('S-SCR-31 With the audit log gone, a prompt is not sent but `STOP` still works', async ({ page, room, fakeAgent }) => {
  test.setTimeout(90_000);
  const frames = recordFrames(page);
  // The room clock and the page clock both at 07:02:00, both running.
  const at = new Date('2026-10-27T07:02:00+01:00');
  await room.start({ script: 'scr-room', clock: { set: at.toISOString() } });
  const file = room.booted.auditFile;
  await page.clock.install({ time: at });
  await openPane(page, room);

  await test.step('given a turn running, sent before the break', async () => {
    await typeAndSend(page, NIGHT);
    await expect.poll(() => of(frames, 'received', 'turn.prompt').length).toBe(1);
    await expect(page.locator('[data-reply]').last()).toContainText('Night part 1.', { timeout: 5_000 });
  });

  let t0 = null;
  await test.step('the audit file renamed away at t = 0 s, STOP at t = 1 s: `STOPPED AT 07:02` by t = 6.5 s, one stderr line', async () => {
    t0 = Date.now();
    fs.renameSync(file, `${file}.away`);
    await until(t0, 1_000);
    await tapStop(page);
    await expect(page.locator(STOPPED)).toHaveText(/^STOPPED AT 07:02/, { timeout: Math.max(1, t0 + 6_500 - Date.now()) });
    await expect(page.locator(HEADER)).toHaveText('READY');
    const lines = room.booted.logs().split('\n').filter((l) => l.includes('audit append failed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^cockpit: audit append failed for cockpit\.stop: /);
  });

  await test.step('the typed `and the builds?` at t = 8 s: `YOU · 07:02 · NOT SENT`, the audit line, RETRY and EDIT; nothing reaches the agent', async () => {
    await until(t0, 8_000);
    await typeAndSend(page, 'and the builds?');
    await expect.poll(() => of(frames, 'received', 'prompt.refused').length).toBe(1);
    expect(of(frames, 'received', 'prompt.refused')[0].code).toBe('audit-unavailable');
    const block = page.locator('[data-cockpit-conversation] .ck-turn').last();
    await expect(block.locator('[data-turn-label]').first()).toHaveText('YOU · 07:02 · NOT SENT');
    await expect(block.locator('[data-turn-delivery="not-sent"]')).toHaveCount(1);
    const line = page.locator('[data-turn-error="not-sent"]');
    await expect(line).toContainText('Not sent: the room cannot write its audit log.');
    await expect(line.getByRole('button', { name: 'RETRY' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'EDIT' })).toBeVisible();
    const stdin = fakeAgentLog(fakeAgent.dir).lines().filter((l) => l.kind === 'stdin');
    expect(stdin.some((l) => String(l.line).includes('and the builds?'))).toBe(false);
    expect(JSON.stringify(fakeAgentLog(fakeAgent.dir).prompts())).not.toContain('and the builds?');
  });
});
