// The show commands, the transport (Wall plan night 4 T38, research Q16):
// each message shape posted through a real BroadcastChannel and through
// postMessage reaches show.js and is answered on its road; a wrong origin, a
// foreign channel, an answer and an oversized message are not shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TRANSPORT, createTransport, readWire, showOrigins } from '../public/js/wall/galaxy/transport.js';
import { createShow } from '../public/js/wall/galaxy/show.js';
import { createDirector } from '../public/js/wall/galaxy/director.js';
import { makeEl } from './helpers/fakedom.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const SELF = 'http://127.0.0.1:7795';
let n = 0;
const msg = (type, data, extra = {}) => ({ v: 1, ch: 'laneboard.show', id: `w${++n}`, src: 'agent:builder-a', type, data, ...extra });
/** One of each shape (show.js's header). */
const shapes = () => [
  msg('flyTo', { node: 'hv2' }),
  msg('highlight', { nodes: ['hv1-a', 'hv2-a'], note: 'these break' }),
  msg('pin', { node: 'hv1', card: { title: 'Disk', text: 'Full in 2 h' } }),
  msg('clear', {}),
];

const NODES = { hv1: 'hv1', hv2: 'hv2', 'hv1-a': 'hv1', 'hv2-a': 'hv2' };

/** The page's show over a real director and a counting camera, on a still clock. */
function stage() {
  const clock = () => 100_000;
  const cam = { calls: [], pose: () => ({ pos: { x: 0, y: 900, z: 900 }, look: { x: 0, y: 0, z: 0 } }) };
  for (const k of ['fit', 'focus', 'cut', 'fly', 'steer']) cam[k] = (...a) => { cam.calls.push([k, ...a]); };
  const director = createDirector(cam, { clock, resume: () => {} });
  const el = (tag) => {
    const e = makeEl(tag);
    e.replaceChildren = (...kids) => { e.children.length = 0; e.append(...kids); };
    return e;
  };
  const shows = createShow({
    block: el('div'), marks: el('div'), director, clock, doc: { createElement: el },
    busy: () => director.driver() === 'touch',
    labelOf: (id) => (id in NODES ? id.toUpperCase() : null),
    siteOf: (id) => NODES[id] ?? null,
    screenOf: (id) => (id in NODES ? { x: 400, y: 300, r: 8 } : null),
    size: () => ({ W: 1600, H: 900 }),
  });
  const seen = [];
  const send = (m) => { seen.push(m.id); return shows.send(m); };
  return { shows, director, cam, seen, send };
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

test('BroadcastChannel: each shape reaches the show and is answered on the channel', async () => {
  const s = stage();
  const wire = createTransport({ send: s.send, Channel: BroadcastChannel });
  const remote = new BroadcastChannel('laneboard.show');
  try {
    const [fly, hi, pin, clear] = shapes();
    const answers = hear(remote, 3);
    for (const m of [fly, hi, pin]) remote.postMessage(m);
    const got = await answers;
    assert.deepEqual(got, [fly, hi, pin].map((m) => ({ v: 1, ch: 'laneboard.show', re: m.id, ok: true })));
    assert.equal(s.director.driver(), 'show', 'the flyTo has the camera');
    assert.deepEqual(s.cam.calls.at(-1).slice(0, 2), ['focus', 'hv2']);
    assert.deepEqual(s.shows.state().items.map((it) => it.type).sort(), ['flyTo', 'highlight', 'pin']);

    const cleared = hear(remote, 1);
    remote.postMessage(clear);
    assert.deepEqual(await cleared, [{ v: 1, ch: 'laneboard.show', re: clear.id, ok: true }]);
    assert.equal(s.shows.state().items.length, 0, 'clear ended everything shown');
    assert.equal(s.director.driver(), 'tour');
  } finally {
    remote.close();
    wire.close();
  }
});

test('BroadcastChannel: an unknown node and a bad shape are answered; a foreign channel and answers are not', async () => {
  const s = stage();
  const wire = createTransport({ send: s.send, Channel: BroadcastChannel });
  const remote = new BroadcastChannel('laneboard.show');
  try {
    const unknown = msg('flyTo', { node: 'nowhere' });
    const bad = msg('wave', {});
    const answers = hear(remote, 2);
    remote.postMessage({ ...msg('flyTo', { node: 'hv1' }), ch: 'other.show' }); // not ours
    remote.postMessage({ v: 1, ch: 'laneboard.show', re: 'w0', ok: true }); // another screen's answer
    remote.postMessage(unknown);
    remote.postMessage(bad);
    const got = await answers;
    assert.deepEqual(got, [
      { v: 1, ch: 'laneboard.show', re: unknown.id, ok: false, code: 'unknown-node' },
      { v: 1, ch: 'laneboard.show', re: bad.id, ok: false, code: 'bad-shape' },
    ]);
    assert.deepEqual(s.seen, [unknown.id, bad.id], 'the foreign message and the answer never reached the show');
  } finally {
    remote.close();
    wire.close();
  }
});

test('postMessage: each shape from an allowed origin reaches the show, answered to its source with its origin', () => {
  const s = stage();
  const win = fakeWin();
  const wire = createTransport({ send: s.send, win, origins: showOrigins('https://hub.example.invalid', SELF) });
  for (const origin of [SELF, 'https://hub.example.invalid']) {
    for (const m of shapes()) {
      const from = sender();
      win.post(m, origin, from);
      assert.deepEqual(from.got, [{ data: { v: 1, ch: 'laneboard.show', re: m.id, ok: true }, target: origin }], `${m.type} from ${origin}`);
      assert.notEqual(from.got[0].target, '*');
    }
  }
  assert.equal(s.seen.length, 8);
  wire.close();
  assert.equal(win.on.size, 0, 'close() stops listening');
});

test('postMessage: a wrong origin is ignored: nothing shown, no answer', () => {
  const s = stage();
  const win = fakeWin();
  const wire = createTransport({ send: s.send, win, origins: showOrigins('https://hub.example.invalid', SELF) });
  const wrong = [
    'https://acme.example.invalid', 'http://hub.example.invalid', 'https://hub.example.invalid:8443',
    'https://evil.hub.example.invalid', 'null', '', undefined, 'http://127.0.0.1:7796',
  ];
  for (const origin of wrong) {
    for (const m of shapes()) {
      const from = sender();
      win.post(m, origin, from);
      assert.deepEqual(from.got, [], `${m.type} from ${origin}`);
    }
  }
  assert.deepEqual(s.seen, []);
  assert.equal(s.shows.state().items.length, 0);
  assert.equal(s.director.driver(), 'tour', 'the camera never moved');
  assert.deepEqual(s.cam.calls, []);
  wire.close();
});

test('postMessage: no allowed origin (a file: page) means no listener at all', () => {
  const s = stage();
  const win = fakeWin();
  createTransport({ send: s.send, win, origins: showOrigins('https://hub.example.invalid', 'null') });
  assert.equal(win.on.size, 0);
});

test('showOrigins: the own origin and exact http(s) origins only', () => {
  assert.deepEqual(showOrigins(null, SELF), [SELF]);
  assert.deepEqual(
    showOrigins(' https://hub.example.invalid , https://hub.example.invalid/,http://builder-a:8080', SELF),
    [SELF, 'https://hub.example.invalid', 'http://builder-a:8080'],
  );
  for (const bad of ['*', 'null', 'https://hub.example.invalid/x', 'https://u@hub.example.invalid', 'ftp://hub.example.invalid',
    'javascript:alert(1)', 'file:///tmp', 'hub.example.invalid', 'https://hub.example.invalid?x=1', 'https://HUB.example.invalid']) {
    assert.deepEqual(showOrigins(bad, SELF), [SELF], bad);
  }
  assert.deepEqual(showOrigins('https://hub.example.invalid', 'null'), [], 'an opaque own origin takes none');
  assert.deepEqual(showOrigins('https://hub.example.invalid', undefined), []);
});

test('readWire: oversized is bad-shape (with an id) or ignored; a cycle is not thrown', () => {
  const big = msg('pin', { node: 'hv1', card: { text: 'x'.repeat(TRANSPORT.maxBytes) } });
  assert.deepEqual(readWire(big), { answer: { v: 1, ch: 'laneboard.show', re: big.id, ok: false, code: 'bad-shape' } });
  assert.deepEqual(readWire({ ...big, id: undefined }), {});
  const loop = msg('flyTo', { node: 'hv1' });
  loop.data.self = loop; // structured clone carries cycles
  assert.equal(readWire(loop).answer.code, 'bad-shape');
  for (const x of [null, 'flyTo', 42, [], { v: 2, ch: 'laneboard.show' }, { v: 1, ch: 'laneboard.show', re: 'a', ok: true }]) {
    assert.deepEqual(readWire(x), {});
  }
  const ok = msg('clear', {});
  assert.equal(readWire(ok).pass, ok);
});

test('page wiring: main.js opens both roads into the show and names ?showOrigins=', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /import \{ createTransport, showOrigins \} from '\.\/transport\.js';/);
  assert.match(js, /send: shows\.send, win: window, Channel: globalThis\.BroadcastChannel \?\? null/);
  assert.match(js, /origins: showOrigins\(q\.get\('showOrigins'\), location\.origin\)/);
  const src = read('js/wall/galaxy/transport.js');
  assert.doesNotMatch(src, /postMessage\([^)]*'\*'/, 'never answers to *');
});
