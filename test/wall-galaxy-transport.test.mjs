// The show commands, the dev adapter (Wall plan night 4 T38; aligned with the
// cockpit spec on 2026-10-27, protocols.md §4): the room's messages posted
// through a real BroadcastChannel and through postMessage reach show.js and
// are answered on their road; a wrong origin, another type, an answer and an
// oversized message are not shown and get no answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRANSPORT, createTransport, readWire, showOrigins } from '../public/js/wall/galaxy/transport.js';
import { createShow } from '../public/js/wall/galaxy/show.js';
import { makeEl } from './helpers/fakedom.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const SELF = 'http://127.0.0.1:7795';
let n = 0;
const show = (cmd, args) => ({ type: 'show', showId: `sh-w${++n}`, turnId: 't-1', cmd, args, receivedAt: 1793080932210 });
/** One of each message the Wall takes in (protocols.md §4). */
const shapes = () => [
  show('fly_to', { node: 'hv2' }),
  show('highlight', { nodes: ['hv1-a', 'hv2-a'], note: 'these break' }),
  show('pin', { node: 'hv1', card: { block: 'text', title: 'Disk', body: 'Full in 2 h' } }),
  show('clear', {}),
];

const NODES = new Set(['hv1', 'hv2', 'hv1-a', 'hv2-a']);

/** The page's show over fake camera ops, on a still clock; `wire` set once the transport exists. */
function stage(withWire) {
  const calls = [];
  const el = (tag) => {
    const e = makeEl(tag);
    e.replaceChildren = (...kids) => { e.children.length = 0; e.append(...kids); };
    return e;
  };
  let wire = null;
  const shows = createShow({
    marks: el('div'), doc: { createElement: el }, clock: () => 100_000, time: () => 1793080932210,
    send: (m, reply) => wire.send(m, reply),
    screenOf: (id) => (NODES.has(id) ? { x: 400, y: 300, r: 8 } : null),
    size: () => ({ W: 1600, H: 900 }),
    ops: { known: (id) => NODES.has(id), fly: (node) => calls.push(['fly', node]), fit: (nodes) => calls.push(['fit', nodes]) },
  });
  const seen = [];
  wire = withWire((msg, reply) => { seen.push(msg.showId ?? msg.type); shows.receive(msg, reply); });
  return { shows, calls, seen, wire };
}

/** A window whose `message` listeners run; `post(data, origin, source)` is a postMessage arriving. */
function fakeWin() {
  const on = new Set();
  return {
    on,
    addEventListener: (t, fn) => { if (t === 'message') on.add(fn); },
    removeEventListener: (t, fn) => { if (t === 'message') on.delete(fn); },
    post: (data, origin, source) => { for (const fn of on) fn({ data, origin, source }); },
  };
}
/** A sender window: what the Wall answers it, and the target origin it named. */
const sender = () => { const got = []; return { got, postMessage: (data, target) => got.push({ data, target }) }; };

/** Every message a BroadcastChannel hears until `count` have come. */
function hear(ch, count) {
  const got = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`heard ${got.length} of ${count}`)), 2000);
    ch.addEventListener('message', (ev) => {
      got.push(ev.data);
      if (got.length === count) { clearTimeout(t); resolve(got); }
    });
  });
}

test('BroadcastChannel: each show reaches the page and is answered show.result on the channel', async () => {
  const s = stage((receive) => createTransport({ receive, Channel: BroadcastChannel }));
  const room = new BroadcastChannel(TRANSPORT.ch);
  try {
    const msgs = shapes();
    const heard = hear(room, msgs.length);
    for (const m of msgs) room.postMessage(m);
    const got = await heard;
    assert.deepEqual(s.seen, msgs.map((m) => m.showId));
    assert.deepEqual(got.map((a) => [a.type, a.showId, a.state]), msgs.map((m) => ['show.result', m.showId, 'shown']));
    assert.deepEqual(got.map((a) => a.seq), [1, 2, 3, 4], 'the screen\'s own link counter');
    assert.deepEqual(s.calls, [['fly', 'hv2'], ['fit', ['hv1-a', 'hv2-a']]]);
    assert.equal(s.shows.state().pins.length, 1);
    assert.equal(s.shows.state().highlight, null, 'cleared');
    // show.undo and pin.remove come the same way; the page's own answers and other types are not taken in.
    const pinId = s.shows.state().pins[0].id;
    room.postMessage({ type: 'pin.remove', pin: pinId, by: 'desk' });
    room.postMessage({ type: 'show.result', showId: 'x', state: 'shown', seq: 9 });
    room.postMessage({ type: 'turn.end', turnId: 't-1' });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(s.shows.state().pins.length, 0);
    assert.deepEqual(s.seen.slice(-1), ['pin.remove']);
  } finally {
    room.close();
    s.wire.close();
  }
});

test('BroadcastChannel: a node not drawn, compare and a bad shape are answered skipped with why', async () => {
  const s = stage((receive) => createTransport({ receive, Channel: BroadcastChannel }));
  const room = new BroadcastChannel(TRANSPORT.ch);
  try {
    const heard = hear(room, 3);
    room.postMessage(show('fly_to', { node: 'ghost' }));
    room.postMessage(show('compare', { a: 'hv1', b: 'hv2' }));
    room.postMessage(show('highlight', { nodes: [] }));
    const got = await heard;
    assert.deepEqual(got.map((a) => [a.state, a.why]), [['skipped', 'not drawn'], ['skipped', 'unsupported'], ['skipped', 'bad-args']]);
    assert.deepEqual(s.calls, []);
  } finally {
    room.close();
    s.wire.close();
  }
});

test('postMessage: each show from an allowed origin reaches the page, answered to its source with its origin', () => {
  const win = fakeWin();
  const s = stage((receive) => createTransport({ receive, win, origins: [SELF, 'https://hub.example.invalid'] }));
  const from = sender();
  const msgs = shapes();
  for (const [i, m] of msgs.entries()) win.post(m, i % 2 ? 'https://hub.example.invalid' : SELF, from);
  assert.deepEqual(s.seen, msgs.map((m) => m.showId));
  assert.deepEqual(from.got.map((g) => [g.data.showId, g.data.state, g.target]),
    msgs.map((m, i) => [m.showId, 'shown', i % 2 ? 'https://hub.example.invalid' : SELF]));
  assert.ok(from.got.every((g) => g.target !== '*'));
  // A later answer (waiting → shown) goes back the same road: the page keeps it per showId.
  s.shows.receive({ type: 'show.undo', showId: msgs[1].showId });
  assert.equal(from.got.length, msgs.length, 'an undo is not answered');
  s.wire.close();
  assert.equal(win.on.size, 0);
});

test('postMessage: a wrong origin is ignored: nothing shown, no answer', () => {
  const win = fakeWin();
  const s = stage((receive) => createTransport({ receive, win, origins: [SELF] }));
  const from = sender();
  for (const origin of ['http://127.0.0.1:7796', 'https://127.0.0.1:7795', 'http://evil.127.0.0.1:7795', 'null', '', undefined, 'http://localhost:7795']) {
    win.post(show('fly_to', { node: 'hv2' }), origin, from);
  }
  assert.deepEqual(s.seen, []);
  assert.deepEqual(from.got, []);
  assert.deepEqual(s.calls, []);
});

test('postMessage: no allowed origin (a file: page) means no listener at all', () => {
  const win = fakeWin();
  const t = createTransport({ receive: () => assert.fail('nothing should arrive'), win, origins: showOrigins('', 'null') });
  assert.equal(win.on.size, 0);
  t.close();
});

test('showOrigins: the own origin and exact http(s) origins only', () => {
  assert.deepEqual(showOrigins(null, SELF), [SELF]);
  assert.deepEqual(showOrigins('https://hub.example.invalid, http://10.0.0.5:8080', SELF), [SELF, 'https://hub.example.invalid', 'http://10.0.0.5:8080']);
  for (const bad of ['*', 'null', 'https://hub.example.invalid/path', 'ftp://hub.example.invalid', 'https://user@hub.example.invalid', 'hub.example.invalid', 'https://HUB.example.invalid']) {
    assert.deepEqual(showOrigins(bad, SELF), [SELF], bad);
  }
  assert.deepEqual(showOrigins('https://hub.example.invalid', 'null'), [], 'an opaque own origin: none');
});

test('readWire: only the types the Wall takes in, at most 4 KB; a cycle is not thrown', () => {
  for (const m of [...shapes(), { type: 'show.undo', showId: 'x' }, { type: 'pin.put', pin: {} }, { type: 'pin.remove', pin: 'p' }]) assert.equal(readWire(m), m);
  for (const m of [null, 'show', {}, { type: 'show.result' }, { type: 'pin.close' }, { type: 'welcome' }]) assert.equal(readWire(m), null);
  const big = show('highlight', { nodes: ['hv1'], note: 'x'.repeat(TRANSPORT.maxBytes) });
  assert.equal(readWire(big), null);
  const loop = show('fly_to', { node: 'hv1' });
  loop.args.self = loop;
  assert.equal(readWire(loop), null);
});

test('page wiring: main.js opens both roads into the show\'s receive and names ?showOrigins=', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createTransport\(\{\s*receive: shows\.receive, win: window, Channel: globalThis\.BroadcastChannel \?\? null,\s*origins: showOrigins\(q\.get\('showOrigins'\), location\.origin\),/);
  assert.match(js, /send: \(msg, reply\) => wire\?\.send\(msg, reply\)/);
});
