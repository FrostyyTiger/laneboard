// The page's room link (public/js/cockpit/link.js; spec protocols.md §2.2-§2.3,
// screens.md §7, §7.1, c1-talk.md §5.1, D10, D11, D94, D118, D139, D220, D263)
// against a fake WebSocket on a virtual clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomLink } from '../public/js/cockpit/link.js';
import { BACKOFF_START_MS, nextBackoff } from '../public/js/core/net.js';

function harness({ page = 'app' } = {}) {
  let t = 0;
  let timers = [];
  let nextId = 1;
  const socks = [];
  const marks = [];
  const states = [];
  const msgs = [];
  const warns = [];
  class FakeWS {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      this.closedWith = null;
      this.ls = {};
      socks.push(this);
    }
    addEventListener(k, fn) { (this.ls[k] ??= []).push(fn); }
    fire(k, ev = {}) { for (const fn of this.ls[k] ?? []) fn(ev); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close(code, reason) { this.closedWith ??= { code, reason }; this.readyState = 3; }
    // test side
    accept() { this.readyState = 1; this.fire('open'); }
    frame(obj) { this.fire('message', { data: JSON.stringify(obj) }); }
    drop(code = 1006, reason = '') { this.readyState = 3; this.fire('close', { code, reason }); }
  }
  const link = createRoomLink({
    url: 'ws://127.0.0.1:7777/api/cockpit/ws', page,
    WebSocketImpl: FakeWS,
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, at: t + ms, fn }); return id; },
    clearTimer: (id) => { timers = timers.filter((x) => x.id !== id); },
    now: () => t,
    mark: (name, o) => marks.push([name, o?.detail]),
    warn: (...a) => warns.push(a),
    onState: (s) => states.push(s),
    onMessage: (m) => msgs.push(m),
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const due = timers[0];
      if (!due || due.at > end) break;
      timers.shift();
      t = due.at;
      due.fn();
    }
    t = end;
  };
  return { link, socks, marks, states, msgs, warns, advance, now: () => t, last: () => socks[socks.length - 1], state: () => link.state() };
}

const WELCOME = { type: 'welcome', re: 1, protocol: 1, screen: 'local', epoch: 'r-1', seq: 10, conversation: 'c-0007', resume: 'snapshot', config: { stt: 'none' }, status: null };
const snap = (seq, turns = [], part = 1, parts = 1) => ({ type: 'snapshot', seq, part, parts, conversation: 'c-0007', startedAt: '2026-10-27T06:12:00+01:00', olderTurns: 0, turns, pins: [], cards: [] });

function live(h) {
  h.link.start();
  const s = h.last();
  s.accept();
  s.frame(WELCOME);
  s.frame(snap(10, [{ turnId: 't-0001' }]));
  return s;
}

test('link: a fresh page sends hello without epoch or lastSeq, is connecting until the last snapshot part, then live', () => {
  const h = harness({ page: 'wall' });
  h.link.start();
  assert.equal(h.state().status, 'connecting');
  const s = h.last();
  assert.equal(s.url, 'ws://127.0.0.1:7777/api/cockpit/ws');
  s.accept();
  assert.deepEqual(s.sent, [{ type: 'hello', seq: 1, page: 'wall', protocol: 1 }]);
  s.frame(WELCOME);
  s.frame(snap(10, [{ turnId: 't-0001' }], 1, 2));
  assert.equal(h.state().status, 'connecting', 'not before the last part');
  s.frame({ type: 'turn.state', seq: 11, turnId: 't-0002', state: 'thinking' }); // held until the last part
  s.frame(snap(10, [{ turnId: 't-0002' }], 2, 2));
  assert.equal(h.state().status, 'live');
  const types = h.msgs.map((m) => m.type);
  assert.deepEqual(types, ['welcome', 'snapshot', 'turn.state']);
  assert.deepEqual(h.msgs[1].turns.map((x) => x.turnId), ['t-0001', 't-0002'], 'parts joined, oldest first');
  assert.equal(h.marks.filter(([n]) => n === 'cockpit:retry').length, 0, 'the first link of a load is not a retry');
});

test('link: seq at or below the last is dropped; a jump closes 4000 gap and reconnects at once for a snapshot', () => {
  const h = harness();
  const s = live(h);
  s.frame({ type: 'text.delta', seq: 11, turnId: 't-0001', blockIndex: 0, text: 'a' });
  s.frame({ type: 'text.delta', seq: 11, turnId: 't-0001', blockIndex: 0, text: 'a' });
  s.frame({ type: 'text.delta', seq: 9, turnId: 't-0001', blockIndex: 0, text: 'old' });
  s.frame({ type: 'heartbeat', at: 'x' }); // no seq: at once
  assert.deepEqual(h.msgs.slice(2).map((m) => m.seq ?? m.type), [11, 'heartbeat']);
  s.frame({ type: 'text.delta', seq: 13, turnId: 't-0001', blockIndex: 0, text: 'b' });
  assert.deepEqual(s.closedWith, { code: 4000, reason: 'gap' });
  assert.equal(h.socks.length, 2, 'at once, no backoff');
  h.last().accept();
  assert.deepEqual(h.last().sent[0], { type: 'hello', seq: 1, page: 'app', protocol: 1 }, 'no epoch: the room sends a snapshot');
  assert.equal(h.state().status, 'live', 'a gap shows nothing');
});

test('link: a reconnect brings epoch and lastSeq; replay goes on from there', () => {
  const h = harness();
  const s = live(h);
  s.frame({ type: 'turn.state', seq: 11, turnId: 't-0001', state: 'idle' });
  s.drop(1006);
  h.advance(900);
  const s2 = h.last();
  assert.notEqual(s2, s);
  s2.accept();
  assert.deepEqual(s2.sent[0], { type: 'hello', seq: 1, page: 'app', protocol: 1, epoch: 'r-1', lastSeq: 11 });
  s2.frame({ ...WELCOME, seq: 12, resume: 'replay' });
  s2.frame({ type: 'turn.state', seq: 12, turnId: 't-0001', state: 'thinking' });
  assert.equal(h.msgs.at(-1).seq, 12);
  assert.equal(h.state().status, 'live');
  assert.ok(h.marks.some(([n, d]) => n === 'cockpit:retry' && d.attempt === 1 && d.delayMs === 900));
});

test('link: a loss shows room-down only after 5 s, since the loss; back within 5 s shows nothing (D10, D139)', () => {
  const h = harness();
  const s = live(h);
  h.advance(1000);
  s.drop(1006);
  const lostAt = h.now();
  // tries at 0.9 s and 2.52 s fail
  h.advance(900); h.last().drop(1006);
  h.advance(1620); h.last().drop(1006);
  h.advance(4999 - 2520);
  assert.equal(h.state().status, 'live', 'nothing at 4.999 s');
  h.advance(1);
  assert.equal(h.state().status, 'room-down');
  assert.equal(h.state().since, lostAt);
  assert.equal(h.state().retryAt, lostAt + 5436, 'the third try at 5.436 s');
  // a blip: a new loss after a welcome within 5 s shows nothing
  const b = harness();
  const s1 = live(b);
  s1.drop(1006);
  b.advance(900);
  b.last().accept();
  b.last().frame({ ...WELCOME, resume: 'replay' });
  b.advance(10_000);
  assert.equal(b.state().status, 'live');
  assert.equal(b.states.some((x) => x.status === 'room-down'), false);
});

test('link: the delays follow net.js nextBackoff from 500 ms, and a link that opens resets them (screens.md §7.1)', () => {
  const h = harness();
  live(h).drop(1006);
  const want = [];
  let d = BACKOFF_START_MS;
  for (let i = 0; i < 8; i++) { d = nextBackoff(d); want.push(d); }
  const got = [];
  for (let i = 0; i < 8; i++) {
    h.advance(want[i]);
    const m = h.marks.filter(([n]) => n === 'cockpit:retry').at(-1);
    got.push(m[1].delayMs);
    assert.equal(m[1].attempt, i + 1);
    h.last().drop(1006);
  }
  assert.deepEqual(got, [900, 1620, 2916, 5248.8, 9447.84, 15000, 15000, 15000].map((x, i) => (i < 5 ? want[i] : x)));
  h.advance(15000);
  h.last().accept();
  h.last().frame({ ...WELCOME, resume: 'replay' });
  h.last().drop(1006);
  h.advance(900);
  assert.equal(h.marks.filter(([n]) => n === 'cockpit:retry').at(-1)[1].delayMs, 900);
});

test('link: no snapshot 5 s after the load is room-down since the load (D118)', () => {
  const h = harness();
  h.link.start();
  h.last().accept(); // open, but the room never welcomes
  h.advance(4999);
  assert.equal(h.state().status, 'connecting');
  h.advance(1);
  assert.equal(h.state().status, 'room-down');
  assert.equal(h.state().since, 0);
  // a room that refuses every upgrade: the same, since the load
  const g = harness();
  g.advance(60_000);
  g.link.start();
  g.advance(10);
  g.last().drop(1006);
  g.advance(4990);
  assert.equal(g.state().status, 'room-down');
  assert.equal(g.state().since, 60_000);
});

test('link: 25 s without a frame is a loss at that moment, then the grace (D139)', () => {
  const h = harness();
  const s = live(h);
  h.advance(24_999);
  assert.equal(s.closedWith, null);
  h.advance(1);
  assert.ok(s.closedWith, 'the silent socket is closed');
  h.advance(4999);
  assert.equal(h.state().status, 'live');
  h.advance(1);
  assert.equal(h.state().status, 'room-down');
  assert.equal(h.state().since, 25_000);
});

test('link: 4401 and 4402 are unpaired, 4002 and 4403 room-down, none retried; each marked and warned once', () => {
  for (const [code, reason, status] of [[4401, 'unpaired', 'unpaired'], [4402, 'revoked', 'unpaired'], [4403, 'insecure-origin', 'unpaired'], [4403, 'bad-origin', 'room-down'], [4002, 'protocol 2', 'room-down']]) {
    const h = harness();
    h.link.start();
    h.last().accept();
    h.last().drop(code, reason);
    assert.equal(h.state().status, status, `${code} ${reason}`);
    assert.deepEqual(h.state().refused, { code, reason });
    h.advance(120_000);
    assert.equal(h.socks.length, 1, `${code}: no retry`);
    assert.equal(h.link.retryNow(), false);
    assert.deepEqual(h.marks.filter(([n]) => n === 'cockpit:close'), [['cockpit:close', { code, reason }]]);
    assert.equal(h.warns.length, code === 4002 ? 0 : 1);
  }
});

test('link: 4503 is room-down at once and tries every 30 s with no backoff', () => {
  const h = harness();
  live(h);
  h.advance(1000);
  h.last().drop(4503, 'too-many-links');
  assert.equal(h.state().status, 'room-down');
  assert.equal(h.state().since, 1000);
  h.advance(30_000);
  assert.equal(h.socks.length, 2);
  h.last().accept();
  h.last().drop(4503, 'too-many-links');
  h.advance(29_999);
  assert.equal(h.socks.length, 2);
  h.advance(1);
  assert.equal(h.socks.length, 3);
});

test('link: RETRY NOW tries at once; a failure goes on from the cancelled delay (D220)', () => {
  const h = harness();
  live(h).drop(1006);
  h.advance(900); h.last().drop(1006); // pending: 1620
  h.advance(100);
  assert.equal(h.link.retryNow(), true);
  assert.deepEqual(h.marks.filter(([n]) => n === 'cockpit:retry').at(-1)[1], { attempt: 2, delayMs: 0 });
  assert.equal(h.state().trying, true);
  h.last().drop(1006);
  assert.equal(h.state().retryAt, h.now() + nextBackoff(1620));
});

test('link: send adds the link\'s own seq and refuses before a welcome', () => {
  const h = harness();
  h.link.start();
  h.last().accept();
  assert.equal(h.link.send({ type: 'focus' }), false);
  h.last().frame(WELCOME);
  assert.equal(h.link.send({ type: 'focus', pane: 'open' }), 2);
  assert.deepEqual(h.last().sent.at(-1), { type: 'focus', pane: 'open', seq: 2 });
});
