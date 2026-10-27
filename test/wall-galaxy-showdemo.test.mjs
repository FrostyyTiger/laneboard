// The show demo (Wall plan night 4 T39, cockpit §5; re-recorded on 2026-10-27
// in the cockpit's message shape, protocols.md §4): `?show=demo` plays a
// recorded conversation's room messages over the large demo fleet (fly to the
// crit, pin a note, highlight what it breaks, clear, the owner's UNDO on the
// pin), over and over with the tour between. All on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHOW_DEMO, SHOW_DEMO_SCRIPT, createShowDemo, demoMessage, initialShowDemo, showDemoStep, wantsShowDemo,
} from '../public/js/wall/galaxy/showdemo.js';
import { SHOW_CMDS, createShow, readShow } from '../public/js/wall/galaxy/show.js';
import { DEMO_TOPOLOGY_LARGE, LARGE_TROUBLE } from './helpers/demo-hub.mjs';
import { makeEl } from './helpers/fakedom.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const t0 = 50_000;
const at = (i) => t0 + SHOW_DEMO.startMs + SHOW_DEMO_SCRIPT[i].atMs;
const last = SHOW_DEMO_SCRIPT.length - 1;

test('wantsShowDemo: only ?show=demo', () => {
  assert.equal(wantsShowDemo(new URLSearchParams('demo=1&show=demo')), true);
  assert.equal(wantsShowDemo(new URLSearchParams('show=demo')), true);
  for (const s of ['demo=1', 'show=1', 'show=Demo', '']) assert.equal(wantsShowDemo(new URLSearchParams(s)), false, s);
});

test('the script is a conversation over the large demo in the room\'s messages: fly to the crit, pin it, highlight what it breaks, clear, undo the pin', () => {
  assert.deepEqual(SHOW_DEMO_SCRIPT.map((c) => c.cmd ?? 'undo'), ['fly_to', 'pin', 'highlight', 'clear', 'undo']);
  assert.deepEqual([...new Set(SHOW_DEMO_SCRIPT.filter((c) => c.cmd).map((c) => c.cmd))].sort(), [...SHOW_CMDS].sort(), 'every command the Wall draws');
  for (let i = 1; i < SHOW_DEMO_SCRIPT.length; i++) assert.ok(SHOW_DEMO_SCRIPT[i].atMs > SHOW_DEMO_SCRIPT[i - 1].atMs, 'in time order');
  // Every show is a good message (show.js reads it) with a fresh showId per cycle; the undo names the pin's.
  for (let i = 0; i < last; i++) {
    const m = demoMessage(SHOW_DEMO_SCRIPT, 3, i);
    assert.equal(m.type, 'show');
    assert.equal(m.showId, `demo-3-${i}`);
    assert.equal(m.turnId, 'demo-turn-3');
    assert.equal(readShow(m).ok, true, `line ${i} reads`);
  }
  assert.deepEqual(demoMessage(SHOW_DEMO_SCRIPT, 3, last), { type: 'show.undo', showId: 'demo-3-1' });
  // Its nodes are the large demo's; the flight goes to its crit, the note pinned on it names the trouble.
  const ids = new Set(DEMO_TOPOLOGY_LARGE.nodes.map((n) => n.id));
  const crit = LARGE_TROUBLE.find((t) => t.level === 'crit');
  assert.equal(SHOW_DEMO_SCRIPT[0].args.node, crit.guest);
  assert.ok(ids.has(crit.guest));
  assert.equal(SHOW_DEMO_SCRIPT[1].args.node, crit.guest);
  assert.equal(SHOW_DEMO_SCRIPT[1].args.card.title, crit.text, 'it names the trouble as the feed does');
  // What it breaks: the crit and the rooms its links tie it to.
  const hi = SHOW_DEMO_SCRIPT[2].args.nodes;
  assert.equal(hi[0], crit.guest);
  for (const n of hi.slice(1)) {
    assert.ok(ids.has(n), n);
    assert.ok(DEMO_TOPOLOGY_LARGE.links.some((l) => (l.from === n && l.to === crit.guest) || (l.from === crit.guest && l.to === n)), `${n} is linked to ${crit.guest}`);
  }
  assert.ok(SHOW_DEMO_SCRIPT[2].args.note.length <= 120);
  assert.ok(SHOW_DEMO_SCRIPT[last].atMs < 30_000, 'a cycle\'s words fit a 30 s film');
  assert.ok(SHOW_DEMO.cycleMs > SHOW_DEMO_SCRIPT[2].atMs + 60_000 + 20_000, 'the idle minute after the highlight, then the tour, before the next');
});

test('showDemoStep: nothing before startMs, each line at its time once, then the next cycle cycleMs after the start', () => {
  let s = initialShowDemo();
  const sent = [];
  const tick = (now) => { const r = showDemoStep(s, now); s = r.state; sent.push(...r.send.map((m) => [now, m.type === 'show' ? m.showId : m.type])); };
  tick(t0);
  tick(t0 + SHOW_DEMO.startMs - 1);
  assert.deepEqual(sent, []);
  for (let i = 0; i <= last; i++) { tick(at(i) - 1); tick(at(i)); tick(at(i) + 16); }
  assert.deepEqual(sent.map((x) => x[0]), SHOW_DEMO_SCRIPT.map((_, i) => at(i)));
  assert.deepEqual(sent.map((x) => x[1]), ['demo-0-0', 'demo-0-1', 'demo-0-2', 'demo-0-3', 'show.undo']);
  assert.equal(s.cycle, 1);
  assert.equal(s.startAt, t0 + SHOW_DEMO.startMs + SHOW_DEMO.cycleMs);
  tick(s.startAt);
  assert.equal(sent.at(-1)[1], 'demo-1-0');
});

test('showDemoStep: a late frame sends every line due, in order; after a long gap the next cycle starts from now', () => {
  const r = showDemoStep(showDemoStep(initialShowDemo(), t0).state, at(last) + 5000);
  assert.deepEqual(r.send.map((m) => m.showId), ['demo-0-0', 'demo-0-1', 'demo-0-2', 'demo-0-3', 'demo-0-1']);
  const late = showDemoStep(showDemoStep(initialShowDemo(), t0).state, t0 + 10 * SHOW_DEMO.cycleMs);
  assert.equal(late.state.startAt, t0 + 10 * SHOW_DEMO.cycleMs);
});

test('createShowDemo on the page: flies to the crit, pins the note, highlights what it breaks, clears, the pin goes', () => {
  let now = t0;
  const calls = [];
  const el = (tag) => {
    const e = makeEl(tag);
    e.replaceChildren = (...kids) => { e.children.length = 0; e.append(...kids); };
    return e;
  };
  const known = new Set(DEMO_TOPOLOGY_LARGE.nodes.map((nd) => nd.id));
  const sent = [];
  const shows = createShow({
    marks: el('div'), doc: { createElement: el }, clock: () => now, send: (m) => sent.push(m),
    screenOf: () => ({ x: 400, y: 300, r: 8 }), size: () => ({ W: 1368, H: 912 }),
    ops: { known: (id) => known.has(id), fly: (node) => calls.push(['fly', node]), fit: (nodes) => calls.push(['fit', nodes]), stay: () => calls.push(['stay']) },
  });
  const demo = createShowDemo({ receive: shows.receive, clock: () => now });
  const run = (to) => { for (; now <= to; now += 100) demo.tick(); };
  run(at(0));
  assert.deepEqual(calls, [['fly', 'storage']]);
  run(at(1));
  assert.equal(shows.state().pins.length, 1);
  run(at(2));
  assert.deepEqual(calls.at(-1), ['fit', ['storage', 'db', 'office-nas']]);
  assert.deepEqual(shows.state().highlight.nodes, ['storage', 'db', 'office-nas']);
  run(at(3));
  assert.equal(shows.state().highlight, null);
  run(at(4));
  assert.equal(shows.state().pins.length, 0, 'the owner\'s UNDO on the pin\'s line');
  assert.deepEqual(sent.map((m) => m.state), ['shown', 'shown', 'shown', 'shown']);
});

test('main.js plays ?show=demo into the show\'s receive and ticks it each frame', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /const showDemo = shows && wantsShowDemo\(q\) \? createShowDemo\(\{ receive: shows\.receive \}\) : null;/);
  assert.match(js, /showDemo\?\.tick\(\);/);
});
