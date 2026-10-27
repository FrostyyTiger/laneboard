// The show commands, the state (Wall plan night 4 T37, README D10, research
// Q16): flyTo, highlight, pin and clear in Q16's envelope, each display-only,
// each one row under `SHOWN BY <src>`, each undone by one tap on its ✕; a
// show during touch is refused, a show during a flight takes the camera
// through the director. All on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHOW, SHOW_TYPES, cardPlace, createShow, initialShow, readShow, showLines, showMarks, showStep, sourceName,
} from '../public/js/wall/galaxy/show.js';
import { IDLE, createDirector } from '../public/js/wall/galaxy/director.js';
import { makeEl } from './helpers/fakedom.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const t0 = 100_000;
let n = 0;
/** A message in Q16's envelope. */
const msg = (type, data, extra = {}) => ({ v: 1, ch: 'laneboard.show', id: `c${++n}`, src: 'agent:builder-a', type, data, ...extra });

/** Runs `events` (`[at, event, opts?]`) from an empty show, returning each step's result. */
function run(events, state = initialShow()) {
  const out = [];
  for (const [at, ev, opts] of events) {
    const r = showStep(state, ev, at, opts);
    out.push(r);
    state = r.state;
  }
  return out;
}

test('show: Q16\'s envelope and limits', () => {
  assert.deepEqual(SHOW_TYPES, ['flyTo', 'highlight', 'pin', 'clear']);
  assert.equal(SHOW.ch, 'laneboard.show');
  assert.equal(SHOW.xPx, 48, 'the ✕ is a 48 px target (night 1 Q6)');
  assert.equal(SHOW.ttlS, 60);
  assert.equal(SHOW.maxTtlS, 600);
});

test('readShow: each command\'s shape, its words on one line, the ttl clamped; anything else is a bad shape', () => {
  const fly = readShow(msg('flyTo', { node: 'hv1' }));
  assert.equal(fly.ok, true);
  assert.deepEqual(fly.cmd.data, { node: 'hv1' });
  assert.equal(fly.cmd.ttlMs, 60000, 'ttl defaults to 60 s');
  assert.equal(fly.cmd.src, 'agent:builder-a');

  const hi = readShow(msg('highlight', { nodes: ['hv1-a', 'hv1-b', 'hv1-a'], note: '  storage   is\nfull ' }, { ttl: 9999 }));
  assert.deepEqual(hi.cmd.data, { nodes: ['hv1-a', 'hv1-b'], note: 'storage is full' }, 'repeats go, white space is one space');
  assert.equal(hi.cmd.ttlMs, 600000, 'at most 600 s');

  const pin = readShow(msg('pin', { node: 'hv2-a', card: { title: 'Disk', text: 'Fills in 2 h' } }, { ttl: 0 }));
  assert.deepEqual(pin.cmd.data, { node: 'hv2-a', card: { title: 'Disk', text: 'Fills in 2 h' } });
  assert.equal(pin.cmd.ttlMs, null, 'ttl 0: until undone');

  assert.deepEqual(readShow(msg('clear', {})).cmd.data, {});
  assert.deepEqual(readShow(msg('clear', { id: 'c1' })).cmd.data, { id: 'c1' });
  assert.equal(readShow(msg('flyTo', { node: 'hv1' }, { src: undefined })).cmd.src, 'agent');

  const bad = [
    msg('explode', { node: 'hv1' }),
    msg('flyTo', {}),
    msg('flyTo', { node: 'hv1' }, { ttl: -1 }),
    msg('highlight', { nodes: [] }),
    msg('highlight', { nodes: Array.from({ length: 17 }, (_, i) => `n${i}`) }),
    msg('highlight', { nodes: ['hv1'], note: 'x'.repeat(141) }),
    msg('highlight', { nodes: ['hv1'], note: { html: '<b>' } }),
    msg('pin', { node: 'hv1' }),
    msg('pin', { node: 'hv1', card: { text: '' } }),
    msg('pin', { node: 'hv1', card: { text: 'ok', title: 't'.repeat(41) } }),
  ];
  for (const m of bad) {
    const r = readShow(m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(r.code, 'bad-shape');
    assert.equal(r.id, m.id, 'the id comes back for the reply');
  }
  // Not ours: another channel or version gets no answer at all.
  for (const m of [null, 'flyTo', { ...msg('flyTo', { node: 'hv1' }), ch: 'other' }, { ...msg('flyTo', { node: 'hv1' }), v: 2 }]) {
    assert.deepEqual(readShow(m), { ok: false, code: null, id: null });
  }
  assert.equal(readShow({ ...msg('flyTo', { node: 'hv1' }), id: '' }).code, 'bad-shape');
});

test('showStep flyTo: the director\'s item, held as long as the director holds (min of ttl and the minute)', () => {
  const [a, b] = run([
    [t0, { type: 'msg', msg: msg('flyTo', { node: 'hv1' }, { ttl: 600 }) }],
    [t0 + 1000, { type: 'msg', msg: msg('flyTo', { node: 'hv2' }, { ttl: 20 }) }],
  ]);
  assert.equal(a.reply.ok, true);
  assert.equal(a.fly.data.node, 'hv1');
  assert.equal(a.fly.until, t0 + IDLE.ms, 'never longer than the director holds its camera');
  assert.equal(b.fly.until, t0 + 1000 + 20000);
  assert.deepEqual(b.ended, [a.fly.id], 'a newer flyTo replaces the older: one flight at a time');
  assert.deepEqual(b.state.items.map((it) => it.data.node), ['hv2']);
});

test('showStep highlight: the known nodes marked, a newer highlight replaces the older; none known is unknown-node', () => {
  const known = (id) => id !== 'ghost';
  const [a, b, c] = run([
    [t0, { type: 'msg', msg: msg('highlight', { nodes: ['hv1-a', 'ghost'], note: 'breaks the build' }) }, { known }],
    [t0 + 10, { type: 'msg', msg: msg('highlight', { nodes: ['hv2-a'] }) }, { known }],
    [t0 + 20, { type: 'msg', msg: msg('highlight', { nodes: ['ghost'] }) }, { known }],
  ]);
  assert.equal(a.reply.ok, true);
  assert.equal(a.fly, null, 'a highlight never moves the camera');
  assert.deepEqual(a.state.items[0].data.nodes, ['hv1-a']);
  assert.equal(a.state.items[0].until, t0 + 60000);
  assert.deepEqual(b.ended, [a.state.items[0].id]);
  assert.deepEqual(c.reply, { v: 1, ch: 'laneboard.show', re: c.reply.re, ok: false, code: 'unknown-node' });
  assert.deepEqual(c.state.items, b.state.items, 'a refused command leaves the screen as it was');
});

test('showStep pin: one card per node, at most SHOW.pins, the oldest goes; ttl 0 stays until undone', () => {
  const [a, b, c, d] = run([
    [t0, { type: 'msg', msg: msg('pin', { node: 'hv1', card: { text: 'one' } }, { ttl: 0 }) }],
    [t0 + 1, { type: 'msg', msg: msg('pin', { node: 'hv1', card: { text: 'two' } }, { ttl: 0 }) }],
    [t0 + 2, { type: 'msg', msg: msg('pin', { node: 'hv2', card: { text: 'three' } }) }],
    [t0 + 3, { type: 'msg', msg: msg('pin', { node: 'cloud', card: { text: 'four' } }) }],
  ]);
  assert.equal(a.state.items[0].until, null);
  assert.deepEqual(b.ended, [a.state.items[0].id], 'a pin on the same node replaces it');
  assert.equal(c.state.items.length, 2);
  assert.deepEqual(d.ended, [b.state.items[0].id], 'a third pin: the oldest goes');
  assert.deepEqual(d.state.items.map((it) => it.data.card.text), ['three', 'four']);
  // Hours later the ttl-0 pin would still be there; the 60 s ones go on the tick.
  const [late] = run([[t0 + 61000, { type: 'tick' }]], d.state);
  assert.deepEqual(late.ended, d.state.items.map((it) => it.id));
});

test('showStep clear: one command by its id or everything; a repeated id is neither shown nor answered twice', () => {
  const fly = msg('flyTo', { node: 'hv1' });
  const hi = msg('highlight', { nodes: ['hv1-a'] });
  const [, b, c, d, e] = run([
    [t0, { type: 'msg', msg: fly }],
    [t0 + 1, { type: 'msg', msg: hi }],
    [t0 + 2, { type: 'msg', msg: fly }],
    [t0 + 3, { type: 'msg', msg: msg('clear', { id: fly.id }) }],
    [t0 + 4, { type: 'msg', msg: msg('clear', {}) }],
  ]);
  assert.equal(b.state.items.length, 2);
  assert.equal(c.reply, null, 'a repeat (another tab, a retry) is ignored');
  assert.equal(c.state.items.length, 2);
  assert.deepEqual(d.ended, [fly.id]);
  assert.equal(d.reply.ok, true);
  assert.deepEqual(e.ended, [hi.id]);
  assert.deepEqual(e.state.items, []);
});

test('showStep: the one-tap undo ends that command only; a drop (a first touch) ends all', () => {
  const [a, b, c] = run([
    [t0, { type: 'msg', msg: msg('flyTo', { node: 'hv1' }) }],
    [t0 + 1, { type: 'msg', msg: msg('pin', { node: 'hv1', card: { text: 'look' } }) }],
    [t0 + 2, { type: 'undo', id: 'nope' }],
  ]);
  assert.equal(c.state, b.state, 'an unknown id changes nothing');
  const [undo] = run([[t0 + 3, { type: 'undo', id: a.fly.id }]], b.state);
  assert.deepEqual(undo.ended, [a.fly.id]);
  assert.deepEqual(undo.state.items.map((it) => it.type), ['pin']);
  const [drop] = run([[t0 + 4, { type: 'drop' }]], b.state);
  assert.equal(drop.ended.length, 2);
  assert.deepEqual(drop.state.items, []);
});

test('showStep during touch: every command but clear is refused busy, nothing is shown', () => {
  const [a, b, c] = run([
    [t0, { type: 'msg', msg: msg('flyTo', { node: 'hv1' }) }, { busy: true }],
    [t0, { type: 'msg', msg: msg('highlight', { nodes: ['hv1'] }) }, { busy: true }],
    [t0, { type: 'msg', msg: msg('clear', {}) }, { busy: true }],
  ]);
  assert.equal(a.reply.code, 'busy');
  assert.equal(a.fly, null);
  assert.equal(b.reply.code, 'busy');
  assert.deepEqual(b.state.items, []);
  assert.equal(c.reply.ok, true, 'clearing is always allowed');
});

test('showLines: SHOWN BY the source, one row per command newest first, seconds only in the last ten', () => {
  assert.equal(showLines(initialShow(), t0), null);
  assert.equal(sourceName('agent:builder-a'), 'builder-a');
  assert.equal(sourceName('hub'), 'hub');
  const label = (id) => ({ hv1: 'HV1', 'hv2-a': 'builder-a' }[id] ?? id);
  const [, , c] = run([
    [t0, { type: 'msg', msg: msg('flyTo', { node: 'hv1' }) }],
    [t0, { type: 'msg', msg: msg('highlight', { nodes: ['hv1', 'hv2-a', 'cloud'] }, { src: 'agent:cockpit' }) }],
    [t0, { type: 'msg', msg: msg('pin', { node: 'hv2-a', card: { text: 'x' } }, { ttl: 0, src: 'agent:cockpit' }) }],
  ]);
  const lines = showLines(c.state, t0 + 1000, label);
  assert.equal(lines.head, 'shown by cockpit +1');
  assert.deepEqual(lines.rows.map((r) => r.text), ['note on builder-a', '3 marked', 'at HV1']);
  const late = showLines(c.state, t0 + 51_200, label);
  assert.deepEqual(late.rows.map((r) => r.text), ['note on builder-a', '3 marked · 0:09', 'at HV1 · 0:09']);
});

test('showMarks and cardPlace: rings once per node, cards for pins and notes, a card kept on the stage', () => {
  const [, , c] = run([
    [t0, { type: 'msg', msg: msg('highlight', { nodes: ['a', 'b'], note: 'these two' }) }],
    [t0, { type: 'msg', msg: msg('pin', { node: 'b', card: { title: 'Why', text: 'disk' } }) }],
    [t0, { type: 'msg', msg: msg('flyTo', { node: 'a' }) }],
  ]);
  const m = showMarks(c.state);
  assert.deepEqual(m.rings, ['a', 'b']);
  assert.deepEqual(m.cards.map((k) => [k.node, k.title, k.text]), [['a', '', 'these two'], ['b', 'Why', 'disk']]);

  const W = 1600, H = 900;
  assert.deepEqual(cardPlace({ x: 400, y: 300, r: 10 }, 200, 80, { W, H }), { x: 430, y: 260, side: 'right' });
  assert.deepEqual(cardPlace({ x: 1500, y: 300, r: 10 }, 200, 80, { W, H }), { x: 1270, y: 260, side: 'left' });
  const low = cardPlace({ x: 400, y: 890, r: 0 }, 200, 80, { W, H });
  assert.equal(low.y, H - 16 - 80, 'kept inside the stage');
});

// ---- createShow: the page's part, over the director and a counting camera ----

/** An element whose listeners run (fakedom's are no-ops). */
function liveEl(tag) {
  const el = makeEl(tag);
  const on = new Map();
  el.addEventListener = (type, fn) => { if (!on.has(type)) on.set(type, new Set()); on.get(type).add(fn); };
  el.dispatch = (type) => {
    const ev = { type, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    for (const fn of on.get(type) ?? []) fn(ev);
    return ev;
  };
  el.replaceChildren = (...kids) => { el.children.length = 0; el.append(...kids); };
  return el;
}

function countingCam() {
  const calls = [];
  const cam = { calls, pose: () => ({ pos: { x: 0, y: 900, z: 900 }, look: { x: 0, y: 0, z: 0 } }) };
  for (const k of ['fit', 'focus', 'cut', 'fly', 'steer']) cam[k] = (...args) => { calls.push([k, ...args]); };
  return cam;
}

const NODES = { hv1: 'hv1', hv2: 'hv2', 'hv1-a': 'hv1', 'hv2-a': 'hv2' };

function page() {
  let now = t0;
  const clock = () => now;
  const cam = countingCam();
  const resumed = [];
  const director = createDirector(cam, { clock, resume: (from) => resumed.push(from) });
  const block = liveEl('div'), marks = liveEl('div');
  const doc = { createElement: (tag) => liveEl(tag) };
  const shows = createShow({
    block, marks, director, clock, doc,
    busy: () => director.driver() === 'touch',
    labelOf: (id) => (id in NODES ? id.toUpperCase() : null),
    siteOf: (id) => NODES[id] ?? null,
    screenOf: (id) => (id in NODES ? { x: 400, y: 300, r: 8 } : null),
    size: () => ({ W: 1600, H: 900 }),
  });
  const rows = () => block.children.filter((c) => c.classList.contains('galaxy-show-row'));
  const xOf = (id) => rows().find((r) => r.dataset.id === id).children[1];
  return { shows, director, cam, block, marks, rows, xOf, resumed, at: (ms) => { now = t0 + ms; } };
}

test('createShow: each command on screen, the flyTo through the director; one tap on ✕ undoes it and the tour has the camera back', () => {
  const p = page();
  assert.equal(p.block.hidden, true, 'nothing shown: no line');
  const fly = msg('flyTo', { node: 'hv2-a' });
  assert.deepEqual(p.shows.send(fly), { v: 1, ch: 'laneboard.show', re: fly.id, ok: true });
  assert.deepEqual(p.cam.calls.at(-1).slice(0, 2), ['focus', 'hv2'], 'a planet\'s flyTo flies to its site');
  assert.equal(p.director.driver(), 'show');
  p.shows.send(msg('highlight', { nodes: ['hv1-a', 'hv2-a'], note: 'these break' }));
  p.shows.send(msg('pin', { node: 'hv2', card: { title: 'Disk', text: 'Full in 2 h' } }));

  assert.equal(p.block.hidden, false);
  assert.equal(p.block.children[0].textContent, 'shown by builder-a');
  assert.deepEqual(p.rows().map((r) => r.children[0].textContent), ['note on HV2', '2 marked', 'at HV2-A']);
  for (const r of p.rows()) {
    const x = r.children[1];
    assert.equal(x.tagName, 'BUTTON');
    assert.equal(x.textContent, '✕');
  }
  assert.equal(p.marks.hidden, false);
  assert.equal(p.marks.children.filter((c) => c.classList.contains('galaxy-show-ring')).length, 2);
  const cards = p.marks.children.filter((c) => c.classList.contains('galaxy-show-card'));
  assert.deepEqual(cards.map((c) => c.textContent), ['these break', 'DiskFull in 2 h']);
  assert.match(cards[0].style.transform, /^translate3d\(/, 'drawn beside its node');

  // The ✕'s press never reaches the stage (it is not a first touch), and its click undoes the flyTo alone.
  const x = p.xOf(fly.id);
  assert.equal(x.dispatch('pointerdown').stopped, true);
  x.dispatch('click');
  assert.equal(p.director.driver(), 'tour', 'the director\'s show is cleared');
  assert.deepEqual(p.resumed, ['show'], 'and the tour asked for its next leg');
  assert.deepEqual(p.rows().map((r) => r.children[0].textContent), ['note on HV2', '2 marked']);

  x.dispatch('click'); // a second tap on the gone row's ✕ changes nothing
  assert.equal(p.rows().length, 2);
  // The highlight's ✕: its rings and its note go; the pin stays.
  const hi = p.rows()[1].dataset.id;
  p.xOf(hi).dispatch('click');
  assert.equal(p.marks.children.filter((c) => c.classList.contains('galaxy-show-ring')).length, 0);
  assert.deepEqual(p.marks.children.map((c) => c.textContent), ['DiskFull in 2 h']);
  p.xOf(p.rows()[0].dataset.id).dispatch('click');
  assert.equal(p.block.hidden, true);
  assert.equal(p.marks.hidden, true);
});

test('createShow during touch: refused busy, nothing drawn, the camera stays the finger\'s; a first touch drops what was shown', () => {
  const p = page();
  p.shows.send(msg('pin', { node: 'hv1', card: { text: 'look here' } }));
  p.shows.send(msg('flyTo', { node: 'hv1' }));
  // The finger wakes the page: the page drops the show with the director's.
  p.director.as('touch').fit({ ms: 1500 });
  p.shows.drop();
  assert.equal(p.director.driver(), 'touch');
  assert.equal(p.block.hidden, true);
  assert.equal(p.marks.hidden, true);
  const calls = p.cam.calls.length;
  for (const m of [msg('flyTo', { node: 'hv2' }), msg('highlight', { nodes: ['hv2'] }), msg('pin', { node: 'hv2', card: { text: 'x' } })]) {
    assert.equal(p.shows.send(m).code, 'busy', m.type);
  }
  assert.equal(p.cam.calls.length, calls, 'nothing moved under the finger');
  assert.equal(p.block.hidden, true);
  assert.deepEqual(p.shows.state().items, []);
});

test('createShow during a flight: the flyTo takes the camera from the tour mid-flight; the row goes when the director\'s hold does', () => {
  const p = page();
  p.director.as('tour').focus('hv1', 2.3); // the tour flies to hv1
  p.at(900);
  const fly = msg('flyTo', { node: 'hv2' }, { ttl: 20 });
  assert.equal(p.shows.send(fly).ok, true);
  assert.deepEqual(p.cam.calls.map((c) => c.slice(0, 2)), [['focus', 'hv1'], ['focus', 'hv2']], 'the show\'s flight from where the tour\'s was');
  p.director.as('tour').fit(); // the tour's next leg under the show is not played
  assert.equal(p.cam.calls.length, 2);
  // A second flyTo during the show's own flight replaces it, with no hand-back to the tour between.
  p.at(1500);
  const next = msg('flyTo', { node: 'hv1-a' }, { ttl: 20 });
  p.shows.send(next);
  assert.deepEqual(p.resumed, [], 'the tour never got the camera between the two');
  assert.deepEqual(p.rows().map((r) => r.dataset.id), [next.id]);
  p.at(1500 + 20000);
  p.director.tick();
  p.shows.tick();
  assert.equal(p.director.driver(), 'tour');
  assert.deepEqual(p.resumed, ['show']);
  assert.equal(p.block.hidden, true, 'the line goes with the camera');
});

test('createShow: a refused or bad message changes nothing on screen; the countdown row shows its seconds', () => {
  const p = page();
  assert.equal(p.shows.send(msg('flyTo', { node: 'ghost' })).code, 'unknown-node');
  assert.equal(p.shows.send({ v: 1, ch: 'laneboard.show', id: 'z', type: 'flyTo', data: {} }).code, 'bad-shape');
  assert.equal(p.shows.send({ ch: 'elsewhere' }), null, 'not ours: no answer');
  assert.equal(p.block.hidden, true);
  p.shows.send(msg('highlight', { nodes: ['hv1'] }, { ttl: 30 }));
  p.at(25_000);
  p.shows.tick();
  assert.equal(p.rows()[0].children[0].textContent, '1 marked · 0:05');
  p.at(30_000);
  p.shows.tick();
  assert.equal(p.block.hidden, true);
});

test('galaxy.html has the show layers; main.js builds the show over the director, drops it on a wake and ticks it', () => {
  const html = read('galaxy.html');
  assert.match(html, /<div class="galaxy-show-marks" id="galaxy-show-marks" aria-hidden="true" hidden><\/div>/);
  assert.match(html, /<div class="galaxy-show" id="galaxy-show" role="status" hidden><\/div>/);
  assert.ok(html.indexOf('id="wall-lock"') < html.indexOf('id="galaxy-show-marks"'));
  assert.ok(html.indexOf('id="galaxy-show-marks"') < html.indexOf('id="wall-caption"'), 'the marks under the words');
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /createShow\(\{/);
  assert.match(js, /director: \{ show: \(cmd\) => show\(cmd\), clear: \(id\) => director\.clear\(id\) \}/);
  assert.match(js, /busy: \(\) => director\.driver\(\) === 'touch'/);
  assert.match(js, /shows\?\.drop\(\)/);
  assert.match(js, /shows\?\.tick\(\)/);
  assert.match(js, /cam\.onDraw\(shows\.draw\)/);
  const css = read('css/wall.css');
  assert.match(css, /\.galaxy-show-x \{[^}]*width: 48px;[^}]*height: 48px;/);
});
