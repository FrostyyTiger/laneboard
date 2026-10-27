// The show demo (Wall plan night 4 T39, cockpit §5): `?show=demo` plays a
// recorded conversation's show commands over the large demo fleet (fly to the
// crit, pin a note, highlight what it breaks, clear), over and over with the
// tour between; a finger ends a cycle. All on a fake clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SHOW_DEMO, SHOW_DEMO_SCRIPT, createShowDemo, demoMessage, initialShowDemo, showDemoReply, showDemoStep, wantsShowDemo,
} from '../public/js/wall/galaxy/showdemo.js';
import { createShow, readShow } from '../public/js/wall/galaxy/show.js';
import { createDirector } from '../public/js/wall/galaxy/director.js';
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

test('the script is a conversation over the large demo: fly to the crit, pin it, the overview, highlight what it breaks, clear', () => {
  assert.deepEqual(SHOW_DEMO_SCRIPT.map((c) => c.type), ['flyTo', 'pin', 'flyTo', 'highlight', 'clear']);
  for (let i = 1; i < SHOW_DEMO_SCRIPT.length; i++) assert.ok(SHOW_DEMO_SCRIPT[i].atMs > SHOW_DEMO_SCRIPT[i - 1].atMs, 'in time order');
  // Every command is a good message (show.js reads it) with a fresh id per cycle.
  for (let i = 0; i < SHOW_DEMO_SCRIPT.length; i++) {
    const m = demoMessage(SHOW_DEMO_SCRIPT, 3, i);
    assert.equal(m.id, `demo-3-${i}`);
    assert.equal(m.src, 'agent:cockpit');
    assert.equal(readShow(m).ok, true, `command ${i} reads`);
  }
  // Its nodes are the large demo's; the first flight goes to its crit, the second to the hub (the overview).
  const ids = new Set(DEMO_TOPOLOGY_LARGE.nodes.map((n) => n.id));
  const crit = LARGE_TROUBLE.find((t) => t.level === 'crit');
  assert.equal(SHOW_DEMO_SCRIPT[0].data.node, crit.guest);
  assert.ok(ids.has(crit.guest));
  assert.equal(SHOW_DEMO_SCRIPT[1].data.node, crit.guest, 'the note pinned on the crit');
  assert.equal(SHOW_DEMO_SCRIPT[1].data.card.title, crit.text, 'it names the trouble as the feed does');
  assert.equal(SHOW_DEMO_SCRIPT[2].data.node, '__core', 'the hub: server/map.mjs names the core __core');
  // What it breaks: the crit and the rooms its links tie it to.
  const hi = SHOW_DEMO_SCRIPT[3].data.nodes;
  assert.equal(hi[0], crit.guest);
  for (const n of hi.slice(1)) {
    assert.ok(ids.has(n), n);
    assert.ok(DEMO_TOPOLOGY_LARGE.links.some((l) => (l.from === n && l.to === crit.guest) || (l.from === crit.guest && l.to === n)), `${n} is linked to ${crit.guest}`);
  }
  assert.ok(SHOW_DEMO_SCRIPT[last].atMs < 30_000, 'a cycle fits a 30 s film');
});

test('showDemoStep: nothing before startMs, each command at its time once, then the next cycle a gap after the clear', () => {
  let r = showDemoStep(initialShowDemo(), t0);
  assert.deepEqual(r.send, []);
  assert.equal(r.state.startAt, t0 + SHOW_DEMO.startMs);
  r = showDemoStep(r.state, at(0) - 1);
  assert.deepEqual(r.send, []);
  const sent = [];
  for (let i = 0; i <= last; i++) {
    r = showDemoStep(r.state, at(i));
    sent.push(...r.send.map((m) => m.id));
    r = showDemoStep(r.state, at(i) + 16); // the next frame says nothing again
    assert.deepEqual(r.send, []);
  }
  assert.deepEqual(sent, SHOW_DEMO_SCRIPT.map((_, i) => `demo-0-${i}`));
  assert.equal(r.state.cycle, 1);
  assert.equal(r.state.startAt, at(last) + SHOW_DEMO.gapMs);
  r = showDemoStep(r.state, at(last) + SHOW_DEMO.gapMs);
  assert.deepEqual(r.send.map((m) => m.id), ['demo-1-0'], 'the second cycle, new ids');
});

test('showDemoStep: a late frame sends every command due, in order', () => {
  let r = showDemoStep(initialShowDemo(), t0);
  r = showDemoStep(r.state, at(3));
  assert.deepEqual(r.send.map((m) => m.type), ['flyTo', 'pin', 'flyTo', 'highlight']);
});

test('showDemoReply: busy ends the cycle and waits a whole gap; another answer changes nothing', () => {
  const s = { cycle: 2, startAt: t0, next: 2 };
  assert.equal(showDemoReply(s, { ok: true }, t0 + 5), s);
  assert.equal(showDemoReply(s, { ok: false, code: 'unknown-node' }, t0 + 5), s);
  assert.equal(showDemoReply(s, null, t0 + 5), s);
  assert.deepEqual(showDemoReply(s, { ok: false, code: 'busy' }, t0 + 5), { cycle: 3, startAt: t0 + 5 + SHOW_DEMO.gapMs, next: 0 });
});

// The page: the player into a real show over a real director, on a fake clock.
function liveEl(tag) {
  const el = makeEl(tag);
  el.replaceChildren = (...kids) => { el.children.length = 0; el.append(...kids); };
  return el;
}

const SITES = { storage: 'hv2', db: 'lab', 'office-nas': 'remote', __core: null, hv2: 'hv2', lab: 'lab', remote: 'remote' };

function page() {
  let now = t0;
  const clock = () => now;
  const calls = [];
  const cam = { pose: () => ({ pos: { x: 0, y: 900, z: 900 }, look: { x: 0, y: 0, z: 0 } }) };
  for (const k of ['fit', 'focus', 'cut', 'fly', 'steer']) cam[k] = (...a) => { calls.push([k, ...a]); };
  const resumed = [];
  const director = createDirector(cam, { clock, resume: (from) => resumed.push(from) });
  const block = liveEl('div'), marks = liveEl('div');
  const shows = createShow({
    block, marks, director, clock, doc: { createElement: liveEl },
    busy: () => director.driver() === 'touch',
    labelOf: (id) => (id in SITES ? (id === '__core' ? 'demo-host' : id) : null),
    siteOf: (id) => SITES[id] ?? null,
    screenOf: (id) => (id in SITES ? { x: 600, y: 400, r: 10 } : null),
    size: () => ({ W: 1368, H: 912 }),
  });
  const replies = [];
  const demo = createShowDemo({ send: (m) => { const r = shows.send(m); replies.push(r); return r; }, clock });
  const frame = (ms) => { now = ms; director.tick(); shows.tick(); demo.tick(); };
  const cards = () => marks.children.filter((c) => c.classList.contains('galaxy-show-card')).map((c) => c.textContent);
  const rings = () => marks.children.filter((c) => c.classList.contains('galaxy-show-ring')).length;
  return { shows, director, demo, calls, block, frame, cards, rings, replies, resumed };
}

test('createShowDemo on the page: flies to the crit, pins the note, flies out and highlights what it breaks, clears; the tour has the page back', () => {
  const p = page();
  p.frame(t0);
  p.frame(at(0) - 1);
  assert.equal(p.director.driver(), 'tour', 'the tour is seen first');
  assert.equal(p.block.hidden, true);

  p.frame(at(0));
  assert.equal(p.director.driver(), 'show');
  assert.deepEqual(p.calls.at(-1).slice(0, 2), ['focus', 'hv2'], 'the fly-to: the crit\'s system');
  assert.equal(p.block.children[0].textContent, 'shown by cockpit');

  p.frame(at(1));
  assert.deepEqual(p.cards(), ['pool 97% fullFull in about 2 h at tonight’s rate'], 'the pinned note');

  p.frame(at(2));
  assert.equal(p.director.driver(), 'show');
  assert.equal(p.calls.at(-1)[0], 'fit', 'the second flight: out to the overview');
  p.frame(at(3));
  assert.equal(p.rings(), 3, 'the crit and the two it breaks');
  assert.equal(p.cards().length, 2, 'the pin and the highlight\'s note');
  assert.ok(p.cards().includes('Dumps from db and the offsite copy stop when the pool fills'));
  assert.ok(p.replies.every((r) => r.ok), JSON.stringify(p.replies));

  p.frame(at(last));
  assert.equal(p.block.hidden, true, 'cleared');
  assert.equal(p.rings(), 0);
  assert.equal(p.director.driver(), 'tour');
  assert.ok(p.resumed.includes('show'), 'the tour takes its next leg');

  p.frame(at(last) + SHOW_DEMO.gapMs);
  assert.equal(p.director.driver(), 'show', 'and the conversation plays again');
  assert.equal(p.demo.state().cycle, 1);
});

test('createShowDemo under a finger: the drop ends the show, the busy answer ends the cycle, the next waits a gap', () => {
  const p = page();
  p.frame(t0);
  p.frame(at(1));
  assert.equal(p.cards().length, 1);
  // A finger takes the page: the page drops the show with the director's.
  p.director.as('touch').fit({ ms: 1500 });
  p.shows.drop();
  assert.equal(p.block.hidden, true);
  p.frame(at(2));
  assert.equal(p.replies.at(-1).code, 'busy');
  assert.equal(p.director.driver(), 'touch', 'nothing moved under the finger');
  assert.deepEqual(p.demo.state(), { cycle: 1, startAt: at(2) + SHOW_DEMO.gapMs, next: 0 });
  const n = p.replies.length;
  p.frame(at(3));
  assert.equal(p.replies.length, n, 'the rest of that cycle is not said');
});

test('main.js plays ?show=demo into the show\'s send and ticks it each frame', () => {
  const js = read('js/wall/galaxy/main.js');
  assert.match(js, /import \{ createShowDemo, wantsShowDemo \} from '\.\/showdemo\.js';/);
  assert.match(js, /shows && wantsShowDemo\(q\) \? createShowDemo\(\{ send: shows\.send \}\) : null/);
  assert.match(js, /shows\?\.tick\(\);\n\s*showDemo\?\.tick\(\);/);
});
