// The room under test (spec stand-ins.md §1, §7 step 3): the room's clock
// (server/cockpit/clock.mjs), its fault hooks (server/cockpit/faults.mjs), the
// control API of §1.2 (one case per row it serves; the rows that wait for a
// later build answer 404 unknown-verb, each named below), and what
// test/helpers/boot.mjs gained for it (entry, stateFiles, auditFile, control,
// restart, mcp).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import * as clockMod from '../server/cockpit/clock.mjs';
import * as faults from '../server/cockpit/faults.mjs';
import { createRoomControl, isoInZone, SENT_MAX } from './cockpit/stand-ins/room-control.mjs';
import { boot, control, ROOM_UNDER_TEST } from './helpers/boot.mjs';

const T0 = Date.parse('2026-10-27T07:00:00+01:00');
const ZONE = 'Europe/Zurich';

/** A socket stand-in: destroy() records and emits close, as net.Socket does. */
function fakeSocket() {
  const s = new EventEmitter();
  s.destroyed = false;
  s.destroy = () => { if (!s.destroyed) { s.destroyed = true; s.emit('close'); } };
  return s;
}

function setup() {
  const clock = clockMod.createTestClock({ start: T0 });
  const c = createRoomControl({ clock, timeZone: ZONE });
  return { clock, c };
}

// --- the clock --------------------------------------------------------------

test('clock: real by default, setClock replaces it, null puts it back', () => {
  assert.equal(clockMod.getClock(), clockMod.realClock);
  assert.ok(Math.abs(clockMod.now() - Date.now()) < 50);
  const fake = { now: () => 42, setTimeout: () => 1, clearTimeout: () => {} };
  clockMod.setClock(fake);
  try {
    assert.equal(clockMod.now(), 42);
  } finally {
    clockMod.setClock(null);
  }
  assert.equal(clockMod.getClock(), clockMod.realClock);
  assert.throws(() => clockMod.setClock({ now: () => 1 }), /needs now\(\), setTimeout\(\) and clearTimeout\(\)/);
});

test('clock: manual stands still; advance fires due timers in time order, intervals repeat', async () => {
  const clock = clockMod.createTestClock({ start: T0 });
  clock.setMode('manual');
  clockMod.setClock(clock);
  try {
    const fired = [];
    clockMod.setTimeout(() => fired.push(['b', clockMod.now() - T0]), 8000);
    clockMod.setTimeout(() => fired.push(['a', clockMod.now() - T0]), 5000);
    const gone = clockMod.setTimeout(() => fired.push(['never']), 1000);
    clockMod.clearTimeout(gone);
    const iv = clockMod.setInterval(() => fired.push(['tick', clockMod.now() - T0]), 3000);
    assert.equal(clock.now(), T0);
    await clock.advance(4999);
    assert.deepEqual(fired, [['tick', 3000]]);
    await clock.advance(5001);
    assert.deepEqual(fired, [['tick', 3000], ['a', 5000], ['tick', 6000], ['b', 8000], ['tick', 9000]]);
    clockMod.clearInterval(iv);
    await clock.advance(10_000);
    assert.equal(fired.length, 5);
    assert.equal(clock.now(), T0 + 20_000);
    assert.equal(clock.pending(), 0);
  } finally {
    clockMod.setClock(null);
  }
});

test('clock: a timer set by a timer within the same advance fires in it; an async callback is awaited', async () => {
  const clock = clockMod.createTestClock({ start: T0 });
  clock.setMode('manual');
  const order = [];
  clock.setTimeout(async () => {
    order.push('first');
    await new Promise((res) => setImmediate(res));
    order.push('first done');
    clock.setTimeout(() => order.push('second'), 1000);
  }, 1000);
  await clock.advance(2000);
  assert.deepEqual(order, ['first', 'first done', 'second']);
});

test('clock: set() moves the wall time in any mode and fires no timer', async () => {
  const clock = clockMod.createTestClock({ start: T0 });
  let fired = 0;
  clock.setMode('manual');
  clock.setTimeout(() => fired++, 1000);
  clock.set(T0 + 3_600_000);
  assert.equal(clock.now(), T0 + 3_600_000);
  assert.equal(fired, 0);
  await clock.advance(1000);
  assert.equal(fired, 1);
  clock.setMode('real');
  clock.set(T0);
  assert.ok(Math.abs(clock.now() - T0) < 50);
  await assert.rejects(clock.advance(10), /not-manual/);
});

test('clock: real mode runs timers in real time; switching to manual holds them, back to real lets them run', async () => {
  const clock = clockMod.createTestClock();
  const fired = [];
  clock.setTimeout(() => fired.push('soon'), 20);
  clock.setTimeout(() => fired.push('later'), 60);
  await new Promise((res) => setTimeout(res, 40));
  assert.deepEqual(fired, ['soon']);
  clock.setMode('manual');
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(fired, ['soon'], 'manual: time stands still');
  clock.setMode('real');
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(fired, ['soon', 'later']);
  clock.stop();
});

// --- the fault hooks --------------------------------------------------------

test('faults: no-ops by default; setFaults installs the points; null removes them', () => {
  const sock = fakeSocket();
  assert.equal(faults.atUpgrade({}, sock), false);
  assert.equal(faults.atInbound({ type: 'prompt' }), false);
  assert.equal(faults.atOutbound({ type: 'turn.end' }), false);
  assert.equal(sock.destroyed, false);
  const seen = [];
  faults.setFaults({
    upgrade: (req, s, kind) => { seen.push(['upgrade', kind]); return true; },
    inbound: (msg) => { seen.push(['in', msg.type]); return msg.type === 'prompt'; },
    outbound: (msg, link) => { seen.push(['out', msg.type, link]); return false; },
  });
  try {
    assert.equal(faults.atUpgrade({}, sock, 'http'), true);
    assert.equal(faults.atInbound({ type: 'prompt' }), true);
    assert.equal(faults.atInbound({ type: 'stop' }), false);
    assert.equal(faults.atOutbound({ type: 'welcome' }, 'L1'), false);
    assert.deepEqual(seen, [['upgrade', 'http'], ['in', 'prompt'], ['in', 'stop'], ['out', 'welcome', 'L1']]);
  } finally {
    faults.setFaults(null);
  }
  faults.atConnection({ atMs: 1, accepted: true, closeCode: null }); // no hook: nothing happens
  assert.equal(faults.atInbound({ type: 'prompt' }), false);
  assert.throws(() => faults.setFaults({ upgrade: 1 }), /upgrade must be a function/);
});

// --- the control API, one case per §1.2 row it serves -----------------------

test('isoInZone writes the wall time with its offset', () => {
  assert.equal(isoInZone(T0 + 300_000, ZONE), '2026-10-27T07:05:00+01:00');
  assert.equal(isoInZone(Date.parse('2026-07-01T12:00:00Z'), ZONE), '2026-07-01T14:00:00+02:00');
  assert.equal(isoInZone(T0, 'UTC'), '2026-10-27T06:00:00+00:00');
});

test('§1.2 move the room\'s clock: manual, advanceMs, real; advanceMs outside manual is 409 not-manual', async () => {
  const { clock, c } = setup();
  let fired = 0;
  clock.setTimeout(() => fired++, 300_000);
  assert.deepEqual(await c.handle('POST', '/clock', { advanceMs: 300_000 }), { status: 409, body: { error: 'not-manual' } });
  let r = await c.handle('POST', '/clock', { mode: 'manual' });
  assert.equal(r.status, 200);
  assert.match(r.body.now, /^2026-10-27T07:00:0\d\+01:00$/);
  clock.set(T0); // the real ms between setup and here, gone
  r = await c.handle('POST', '/clock', { advanceMs: 300_000 });
  assert.deepEqual(r, { status: 200, body: { now: '2026-10-27T07:05:00+01:00' } });
  assert.equal(fired, 1);
  r = await c.handle('POST', '/clock', { mode: 'real' });
  assert.equal(r.status, 200);
  assert.equal(clock.mode, 'real');
  assert.equal((await c.handle('POST', '/clock', { advanceMs: 1 })).status, 409);
});

test('§1.2 set the room\'s clock: the time jumps there in any mode', async () => {
  const { clock, c } = setup();
  let r = await c.handle('POST', '/clock', { set: '2026-10-27T06:41:00+01:00' });
  assert.equal(r.status, 200);
  assert.match(r.body.now, /^2026-10-27T06:41:0\d\+01:00$/);
  clock.setMode('manual');
  r = await c.handle('POST', '/clock', { set: '2026-10-26T22:10:00+01:00' });
  assert.deepEqual(r, { status: 200, body: { now: '2026-10-26T22:10:00+01:00' } });
  r = await c.handle('POST', '/clock', { set: 'yesterday' });
  assert.deepEqual(r, { status: 400, body: { error: 'bad-body', detail: 'set: not ISO' } });
});

test('§1.2 step the room\'s clock: /tick runs the due timers in time order, then answers; 409 outside manual', async () => {
  const { clock, c } = setup();
  assert.deepEqual(await c.handle('POST', '/tick', { ms: 20_000 }), { status: 409, body: { error: 'not-manual' } });
  await c.handle('POST', '/clock', { mode: 'manual' });
  clock.set(Date.parse('2026-10-27T07:14:00+01:00'));
  const order = [];
  clock.setTimeout(() => order.push('speak-up 5 s'), 5000);
  clock.setInterval(() => order.push('watcher 15 s'), 15_000);
  clock.setTimeout(() => order.push('outside the step'), 25_000);
  const r = await c.handle('POST', '/tick', { ms: 20_000 });
  assert.deepEqual(r, { status: 200, body: { now: '2026-10-27T07:14:20+01:00' } });
  assert.deepEqual(order, ['speak-up 5 s', 'watcher 15 s']);
});

test('§1.2 stop the room\'s link: open links destroyed with no close frame, new upgrades and /api/cockpit requests destroyed unread', async () => {
  const { c } = setup();
  const a = fakeSocket();
  const b = fakeSocket();
  const closedByRoom = fakeSocket();
  for (const s of [a, b, closedByRoom]) assert.equal(c.hooks.upgrade({}, s, 'ws'), false);
  closedByRoom.destroy(); // a link that ended before: not counted
  const r = await c.handle('POST', '/link', { up: false });
  assert.deepEqual(r, { status: 200, body: { up: false, closed: 2 } });
  assert.ok(a.destroyed && b.destroyed);
  const late = fakeSocket();
  assert.equal(c.hooks.upgrade({}, late, 'ws'), true);
  assert.ok(late.destroyed);
  const req = fakeSocket();
  assert.equal(c.hooks.upgrade({}, req, 'http'), true);
  assert.ok(req.destroyed);
});

test('§1.2 start the room\'s link, and a blip: down, then up 2 s later accepts upgrades again', async () => {
  const { c } = setup();
  const before = fakeSocket();
  c.hooks.upgrade({}, before, 'ws');
  assert.deepEqual((await c.handle('POST', '/link', { up: false })).body, { up: false, closed: 1 });
  await new Promise((res) => setTimeout(res, 20)); // the blip's 2 s, shortened: the hooks keep no time
  assert.deepEqual(await c.handle('POST', '/link', { up: true }), { status: 200, body: { up: true } });
  const after = fakeSocket();
  assert.equal(c.hooks.upgrade({}, after, 'ws'), false);
  assert.equal(after.destroyed, false);
  assert.equal(c.hooks.upgrade({}, fakeSocket(), 'http'), false);
});

test('§1.2 make the room\'s link silent: links stay open, nothing goes out, what comes in is dropped; up:true ends it', async () => {
  const { c } = setup();
  const open = fakeSocket();
  c.hooks.upgrade({}, open, 'ws');
  assert.deepEqual(await c.handle('POST', '/link', { up: 'silent' }), { status: 200, body: { up: 'silent' } });
  assert.equal(open.destroyed, false);
  for (const type of ['heartbeat', 'turn.delta', 'pong', 'welcome']) assert.equal(c.hooks.outbound({ type }, null), true, type);
  for (const type of ['prompt', 'ping', 'stop']) assert.equal(c.hooks.inbound({ type }), true, type);
  assert.equal(c.hooks.upgrade({}, fakeSocket(), 'ws'), false, 'upgrades still accepted (B20)');
  await c.handle('POST', '/link', { up: true });
  assert.equal(c.hooks.outbound({ type: 'heartbeat' }, null), false);
  assert.equal(c.hooks.inbound({ type: 'prompt' }), false);
});

test('§1.2 drop the next prompt: the next inbound prompt only, other messages pass', async () => {
  const { c } = setup();
  assert.deepEqual(await c.handle('POST', '/drop', { what: 'next-prompt' }), { status: 200, body: { armed: true } });
  assert.equal(c.hooks.inbound({ type: 'stop' }), false);
  assert.equal(c.hooks.inbound({ type: 'prompt', text: 'one' }), true);
  assert.equal(c.hooks.inbound({ type: 'prompt', text: 'two' }), false);
});

test('§1.2 drop the next message to a screen: the next outbound of that type, once', async () => {
  const { c } = setup();
  assert.deepEqual(await c.handle('POST', '/drop', { what: 'next-out', type: 'turn.end' }), { status: 200, body: { armed: true } });
  assert.equal(c.hooks.outbound({ type: 'turn.delta', seq: 40 }, null), false);
  assert.equal(c.hooks.outbound({ type: 'turn.end', seq: 41 }, null), true);
  assert.equal(c.hooks.outbound({ type: 'turn.end', seq: 42 }, null), false);
});

test('§1.2 GET /sent: the seq\'d messages for every link, oldest first, by type, the last 2 000 (D94)', async () => {
  const { c } = setup();
  assert.deepEqual(await c.handle('GET', '/sent'), { status: 200, body: { items: [] } });
  c.hooks.outbound({ type: 'turn.prompt', seq: 1 }, null);
  c.hooks.outbound({ type: 'error', re: 2, code: 'not-now' }, {}); // one link's answer: not a sent message
  c.hooks.outbound({ type: 'heartbeat', at: 'x' }, null); // no seq: nothing replays it
  await c.handle('POST', '/drop', { what: 'next-out', type: 'turn.end' });
  assert.equal(c.hooks.outbound({ type: 'turn.end', seq: 2 }, null), true, 'dropped to every link, still in seq and in the log');
  c.hooks.outbound({ type: 'turn.end', seq: 3 }, null);
  assert.deepEqual((await c.handle('GET', '/sent')).body.items.map((m) => m.seq), [1, 2, 3]);
  assert.deepEqual(await c.handle('GET', '/sent?type=turn.end'), { status: 200, body: { items: [{ type: 'turn.end', seq: 2 }, { type: 'turn.end', seq: 3 }] } });
  assert.deepEqual(await c.handle('GET', '/sent?kind=x'), { status: 400, body: { error: 'bad-body', detail: 'kind: unknown query key' } });
  for (let i = 4; i <= SENT_MAX + 10; i++) c.hooks.outbound({ type: 'status', seq: i }, null);
  const all = (await c.handle('GET', '/sent')).body.items;
  assert.equal(all.length, SENT_MAX);
  assert.equal(all[0].seq, 11);
});

test('§1.2 a bad body is 400 bad-body with its detail', async () => {
  const { c } = setup();
  const cases = [
    ['/clock', {}, 'body: one of mode, advanceMs, set'],
    ['/clock', { mode: 'fast' }, 'mode: real or manual'],
    ['/clock', { advanceMs: -1 }, 'advanceMs: a number >= 0'],
    ['/clock', { speed: 2 }, 'speed: unknown key'],
    ['/tick', { ms: '20s' }, 'ms: a number >= 0'],
    ['/link', { up: 'maybe' }, 'up: true, false or "silent"'],
    ['/drop', { what: 'everything' }, 'what: next-prompt or next-out'],
    ['/drop', { what: 'next-out' }, 'type: a message type'],
    ['/link', [true], 'body: not an object'],
  ];
  for (const [p, body, detail] of cases) {
    assert.deepEqual(await c.handle('POST', p, body), { status: 400, body: { error: 'bad-body', detail } }, `${p} ${JSON.stringify(body)}`);
  }
});

test('§1.2 GET /connections: every upgrade the link reported, oldest first, closeCode as the link last set it', async () => {
  const { c } = setup();
  assert.deepEqual(await c.handle('GET', '/connections'), { status: 200, body: { items: [] } });
  const at = Date.parse('2026-10-27T07:01:01.123+01:00');
  const first = { atMs: at, accepted: true, closeCode: null };
  c.hooks.connection(first);
  c.hooks.connection({ atMs: at + 500, accepted: false, closeCode: 4403 });
  first.closeCode = 1000; // the link closed later
  const r = await c.handle('GET', '/connections');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, [
    { at: '2026-10-27T07:01:01+01:00', atMs: at, accepted: true, closeCode: 1000 },
    { at: '2026-10-27T07:01:01+01:00', atMs: at + 500, accepted: false, closeCode: 4403 },
  ]);
});

test('§1.2 the rows that wait for a later build answer 404 unknown-verb', async () => {
  const { c } = setup();
  const waiting = [
    ['POST', '/pair', { code: 'K7M4QX', name: 'desk' }], // pairing (`laneboard cockpit pair`, §1.3)
    ['POST', '/unpair', { name: 'desk' }], // pairing
    ['POST', '/button', { add: 'hall', screen: 'desk' }], // C2b
    ['POST', '/jobs', { items: [] }], // Jobs slice
    ['POST', '/alarms', { items: [] }], // the watcher (coworker.md §1)
    ['GET', '/clock', undefined], // a known path with another method is no verb either
    ['POST', '/nope', {}],
  ];
  for (const [m, p, body] of waiting) {
    assert.deepEqual(await c.handle(m, p, body), { status: 404, body: { error: 'unknown-verb' } }, `${m} ${p}`);
  }
});

test('control server: JSON over loopback, a bad JSON body is 400', async () => {
  const { c } = setup();
  const addr = await c.listen();
  try {
    assert.match(addr, /^127\.0\.0\.1:\d+$/);
    let r = await fetch(`http://${addr}/drop`, { method: 'POST', body: '{"what":"next-prompt"}' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { armed: true });
    r = await fetch(`http://${addr}/drop`, { method: 'POST', body: '{nope' });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'bad-body', detail: 'not JSON' });
    r = await fetch(`http://${addr}/pair`, { method: 'POST', body: '{}' });
    assert.equal(r.status, 404);
    r = await fetch(`http://${addr}/sent?type=turn.end`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { items: [] });
  } finally {
    await c.close();
  }
});

// --- boot({entry: ROOM_UNDER_TEST}) -----------------------------------------

test('boot(): the room under test boots with its control port, seeded state files and restarts on the same port', async (t) => {
  const config = {
    port: 0,
    timezone: ZONE,
    cockpit: {
      agent: {
        kind: 'claude-code', command: ['node', 'test/cockpit/stand-ins/fake-agent.mjs'],
        env: ['FAKE_AGENT_DIR'], allowSameUser: true,
        loginCheck: ['node', 'test/cockpit/stand-ins/fake-agent.mjs', 'auth', 'status'],
      },
      stt: { url: 'none' },
      mcp: { port: 0 },
    },
  };
  const session = { sessionId: 'S-1', turns: [] };
  const room = await boot({
    mode: 'builder', config, entry: ROOM_UNDER_TEST,
    stateFiles: { 'cockpit/session.json': session, 'cockpit/turns/a.json': '{}' },
  });
  t.after(() => room.stop());

  await t.test('control is announced and answers', async () => {
    assert.match(room.control, /^127\.0\.0\.1:\d+$/);
    assert.notEqual(Number(room.control.split(':')[1]), room.port, 'never on the room\'s own port');
    let r = await control(room, 'POST', '/clock', { mode: 'manual' });
    assert.equal(r.status, 200);
    r = await control(room, 'POST', '/clock', { set: '2026-10-27T07:00:00+01:00' });
    assert.deepEqual(r, { status: 200, body: { now: '2026-10-27T07:00:00+01:00' } });
    r = await control(room, 'POST', '/tick', { ms: 300_000 });
    assert.deepEqual(r, { status: 200, body: { now: '2026-10-27T07:05:00+01:00' } });
    r = await control(room, 'GET', '/sent?type=turn.end');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.items));
    // The room's own port has no control verb (D109).
    const own = await fetch(`${room.url}/clock`, { method: 'POST', body: '{"mode":"real"}' });
    assert.notEqual(own.status, 200);
  });

  await t.test('stateFiles are written 0600 under 0700 dirs; auditFile is the child\'s audit log', () => {
    const file = path.join(room.stateDir, 'cockpit', 'session.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), session);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(room.stateDir, 'cockpit')).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(room.stateDir, 'cockpit', 'turns')).mode & 0o777, 0o700);
    assert.equal(room.auditFile, room.env.LANEBOARD_AUDIT_FILE);
    assert.ok(room.auditFile.startsWith(room.tmp + path.sep));
  });

  await t.test('mcp() reads the url and the token the room wrote', () => {
    assert.throws(() => room.mcp(), /ENOENT/); // the MCP server comes with T35
    fs.mkdirSync(path.join(room.stateDir, 'cockpit-agent'), { recursive: true });
    fs.writeFileSync(path.join(room.stateDir, 'cockpit-agent', 'mcp.json'), JSON.stringify({ url: 'http://127.0.0.1:7791/mcp' }));
    // 0600 as the room writes it (D209): the restarts below run its start check (D210).
    fs.writeFileSync(path.join(room.stateDir, 'cockpit', 'mcp.token'), 'tok\n', { mode: 0o600 });
    assert.deepEqual(room.mcp(), { url: 'http://127.0.0.1:7791/mcp', token: 'tok' });
  });

  await t.test('restart (SIGTERM, then SIGKILL as a crash): same port and dirs, a new control port, a fresh clock', async () => {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      const oldPid = room.pid;
      const addr = await room.restart({ signal });
      assert.equal(addr, room.control);
      assert.match(addr, /^127\.0\.0\.1:\d+$/);
      assert.notEqual(room.pid, oldPid);
      assert.equal((await fetch(`${room.url}/healthz`)).status, 200, `${signal}: same room port`);
      assert.ok(fs.existsSync(path.join(room.stateDir, 'cockpit', 'session.json')), `${signal}: state kept`);
      const r = await control(room, 'POST', '/tick', { ms: 1 });
      assert.deepEqual(r, { status: 409, body: { error: 'not-manual' } }, `${signal}: the new process starts on a real clock`);
    }
  });
});

test('boot(): stateFiles may not leave the state dir', async () => {
  await assert.rejects(boot({ entry: ROOM_UNDER_TEST, stateFiles: { '../escape.json': '{}' } }), /leaves the state dir/);
});

test('the wrapper started without boot()\'s isolation prints its usage and exits 0 (node --test runs it too)', () => {
  const env = { ...process.env };
  delete env.LANEBOARD_STATE_DIR;
  const r = spawnSync(process.execPath, [ROOM_UNDER_TEST], { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: started by test\/helpers\/boot\.mjs/);
});
