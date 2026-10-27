// The caption names only a target the camera is on (Wall plan night 3 T15,
// r4-film-ui galaxy 1): the galaxy's plate starts, and so types, no earlier
// than 0.9 of the leg's flight, and in a flight to a site every name but the
// destination's dims to `--text-3`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as THREE from '../public/vendor/three/three.module.js';
import {
  arrivedTimingFor, ARRIVED_CAPTION_TIMING, ARRIVED_DEMO_CAPTION_TIMING, captionLines, captionSchedule,
  CAPTION_FROM_K, CAPTION_TIMING, DEMO_CAPTION_TIMING, MAX_LINES,
} from '../public/js/wall/caption.js';
import { TIMING, DEMO_TIMING } from '../public/js/wall/tour.js';
import { createLabels, labelParts, labelText } from '../public/js/wall/galaxy/labels.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { overviewShot, FOV } from '../public/js/wall/galaxy/scene.js';
import { toneOf } from '../public/js/wall/galaxy/palette.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FLEET = JSON.parse(fs.readFileSync(new URL('./fixtures/wall-large-map.json', import.meta.url), 'utf8')).nodes;

test('arrivedTimingFor: the plate starts at 0.9 of the flight at the earliest, at both speeds, and still fits the leg', () => {
  assert.equal(CAPTION_FROM_K, 0.9);
  for (const [demo, tour] of [[true, DEMO_TIMING], [false, TIMING]]) {
    const timing = arrivedTimingFor(demo);
    assert.ok(Object.isFrozen(timing));
    const leg = { arriveMs: tour.flyMs, ms: tour.flyMs + tour.holdMs };
    const s = captionSchedule(leg, 'OFFICE-PRINTER', MAX_LINES, timing);
    assert.ok(s.startMs >= CAPTION_FROM_K * tour.flyMs, `plate from ${s.startMs} ms`);
    // The first letter comes one letter after nameAt.
    assert.ok(s.nameAt + timing.letterMs >= CAPTION_FROM_K * tour.flyMs);
    assert.ok(s.startMs <= leg.arriveMs, 'by the arrival');
    assert.ok(leg.ms - s.doneAt >= (demo ? 500 : 3000), `still for ${leg.ms - s.doneAt} ms (${demo ? 'demo' : 'normal'})`);
  }
  // The demo used to start at 0.64 of the flight; normal speed already waited for the camera.
  assert.ok(captionSchedule({ arriveMs: 2250 }, 'HV2', 3, DEMO_CAPTION_TIMING).startMs < 0.9 * 2250);
  assert.equal(captionSchedule({ arriveMs: 2250 }, 'HV2', 3, ARRIVED_DEMO_CAPTION_TIMING).startMs, 2025);
  assert.equal(captionSchedule({ arriveMs: 2250 }, 'HV2', 3, ARRIVED_CAPTION_TIMING).startMs, 2250);
  // No flight (a parked still, a tap on the site the camera is at): at once, as before.
  assert.equal(captionSchedule({ arriveMs: 0 }, 'HV2', 3, ARRIVED_DEMO_CAPTION_TIMING).startMs, 0);
  // Without fromK (wall.html's other variants) nothing changes.
  assert.equal(captionSchedule({ arriveMs: 2250 }, 'HV2', 3, DEMO_CAPTION_TIMING).startMs, 2250 - DEMO_CAPTION_TIMING.leadMs);
});

test('createCaption: on the galaxy\'s demo timing no character is typed and the plate is not up before 0.9 of the flight', async () => {
  const { makeDocument, makeEl } = await import('./helpers/fakedom.mjs');
  const { createCaption } = await import('../public/js/wall/caption.js');
  const prevDoc = globalThis.document;
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    e.animate = undefined;
    return e;
  };
  globalThis.document = doc;
  try {
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    const caption = createCaption(root, { timers, timing: ARRIVED_DEMO_CAPTION_TIMING });
    const find = (el, cls) => {
      if (el.className === cls) return el;
      for (const c of el.children ?? []) { const f = find(c, cls); if (f) return f; }
      return null;
    };
    const m = { nodes: FLEET };
    const site = FLEET.find((n) => n.kind === 'site' && n.label === 'hv2') ?? FLEET.find((n) => n.kind === 'site');
    const leg = { kind: 'site', id: site.id, index: 1, count: 5, arriveMs: DEMO_TIMING.flyMs };
    caption.show(leg, captionLines(site, m, 1, 5));
    const typed = find(caption.el, 'wall-caption-typed');
    assert.ok(typed, 'the typed span');
    const k = CAPTION_FROM_K * DEMO_TIMING.flyMs;
    // Run every beat due before 0.9 of the flight, in order.
    const due = waits.filter((w) => w.ms < k).sort((a, b) => a.ms - b.ms);
    assert.ok(due.length, 'the plate is built before (no room for it pops in later)');
    for (const w of due) w.fn();
    assert.equal(typed.textContent, '', 'nothing typed in the flight');
    assert.notEqual(caption.el.style.opacity, '1', 'the plate is not up in the flight');
    // From 0.9 on the plate comes and the name types.
    for (const w of waits.filter((x) => x.ms >= k).sort((a, b) => a.ms - b.ms)) w.fn();
    assert.equal(typed.textContent, captionLines(site, m, 1, 5).name);
    assert.equal(caption.el.style.opacity, '1');
  } finally {
    globalThis.document = prevDoc;
  }
});

// The large demo's world and a camera on a site's shot (as wall-galaxy-labels.test.mjs).
function fakeDoc() {
  const el = () => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    return { style, dataset: {}, textContent: '', className: '', remove() {}, append: () => {} };
  };
  return { doc: { createElement: el }, root: el() };
}
function worldOf(openId) {
  const lay = galaxyLayout(FLEET);
  const sites = lay.sites.map((s) => {
    const open = s.id === openId ? 1 : 0;
    const members = s.members.map((mb) => {
      const k = open ? 1 : 0.16;
      const p = new THREE.Vector3(s.home.x + mb.off.x * k, s.home.y + mb.off.y * k, s.home.z + mb.off.z * k);
      return { ...mb, tone: toneOf(mb.node), mesh: { position: p } };
    });
    return { ...s, members, open, status: s.node.status };
  });
  return { core: lay.core, sites, byId: new Map(sites.map((s) => [s.id, s])) };
}
function galaxyAt(world, shot, W = 1368, H = 912) {
  const camera = new THREE.PerspectiveCamera(FOV, W / H, 1, 30000);
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  camera.updateMatrixWorld();
  return { world, camera, renderer: { domElement: { clientWidth: W, clientHeight: H } } };
}

test('createLabels: in a flight to a site every other name dims, the destination and what it holds stay full', () => {
  // Mid-flight from the overview: every site on screen, lab (the destination) still folded.
  const world = worldOf(null);
  const galaxy = galaxyAt(world, overviewShot(world.sites));
  const memberOf = new Map();
  for (const s of world.sites) { memberOf.set(s.id, s.id); for (const mb of s.members) memberOf.set(mb.id, s.id); }
  let flight = { k: 0.5, to: 'lab' };
  const { doc, root } = fakeDoc();
  const labels = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, flight: () => flight, doc });
  labels.draw();
  const shown = labels.shown();
  const others = shown.filter((s) => memberOf.get(s.id) !== 'lab');
  const own = shown.filter((s) => memberOf.get(s.id) === 'lab');
  assert.ok(others.length >= 1, 'some passing name is on screen');
  assert.ok(own.some((s) => s.id === 'lab'), 'the destination is named');
  for (const s of others) assert.equal(s.dim, true, `${s.text} dims in the flight`);
  for (const s of own) assert.equal(s.dim, false, `${s.text} stays full`);
  // On landing every name is full again.
  flight = null;
  labels.draw();
  for (const s of labels.shown()) assert.equal(s.dim, false, `${s.text} full at rest`);
  // A flight back out to the overview has no destination site: nothing dims.
  flight = { k: 0.3, to: null };
  labels.draw();
  for (const s of labels.shown()) assert.equal(s.dim, false, `${s.text} full in a flight out`);
});

test('createLabels: the dim mark is on the span (data-dim) only while it dims', () => {
  const world = worldOf(null);
  const galaxy = galaxyAt(world, overviewShot(world.sites));
  const made = [];
  const doc = { createElement: () => { const e = { style: { setProperty() {} }, dataset: {}, textContent: '', remove() {}, append() {} }; made.push(e); return e; } };
  let flight = { k: 0.2, to: 'lab' };
  const labels = createLabels(doc.createElement(), galaxy, { steps: { site: 26, room: 15 }, flight: () => flight, doc });
  labels.draw();
  const spans = made.slice(1).filter((e) => e.textContent);
  assert.ok(spans.some((e) => 'dim' in e.dataset), 'a passing name is marked');
  flight = null;
  labels.draw();
  assert.ok(spans.every((e) => !('dim' in e.dataset)), 'all marks gone at rest');
});

test('wall.css: a dimmed name is --text-3, after the tone rules so it wins over them', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/wall.css'), 'utf8');
  const dim = css.indexOf('.galaxy-label[data-dim] { color: var(--text-3); }');
  assert.ok(dim > 0, 'the rule');
  for (const tone of ['crit', 'warn', 'low']) {
    const at = css.indexOf(`.galaxy-label[data-tone="${tone}"]`);
    assert.ok(at > 0 && at < dim, `after the ${tone} rule`);
  }
  assert.ok(css.indexOf('.galaxy-label[data-face="label"]') < dim, 'after the label face\'s --text-2');
});

test('labelParts: the shape and the word of a name, as labelText joins them (night 4 T6)', () => {
  assert.deepEqual(labelParts('■ HV2'), { glyph: '■', word: 'HV2' });
  assert.deepEqual(labelParts('▲ feat-search'), { glyph: '▲', word: 'feat-search' });
  assert.deepEqual(labelParts('◆ LAB'), { glyph: '◆', word: 'LAB' });
  assert.deepEqual(labelParts('HUB'), { glyph: null, word: 'HUB' });
  assert.deepEqual(labelParts('■x'), { glyph: null, word: '■x' }, 'a shape is a shape and a space');
  for (const tone of ['crit', 'warn', 'low', 'calm']) {
    const text = labelText({ id: 'hv2', kind: 'site', label: 'hv2' }, tone, 'label');
    const { glyph, word } = labelParts(text);
    assert.equal(glyph ? `${glyph} ${word}` : word, text, `${tone} round trips`);
  }
});

test('createLabels: a dimmed crit keeps its shape as its own mark (data-glyph), the span holds only the word (night 4 T6)', () => {
  const world = worldOf(null);
  // Folded, a site is named in its worst member's tone (the scene's status): hv2 holds the crit storage.
  for (const site of world.sites) if (site.members.some((mb) => mb.tone === 'crit')) site.status = { status: 'crit' };
  const galaxy = galaxyAt(world, overviewShot(world.sites));
  // A flight to each site in turn until a crit name is passed by (dimmed).
  let made, labels, s;
  for (const site of world.sites) {
    made = [];
    const doc = { createElement: () => { const e = { style: { setProperty() {} }, dataset: {}, textContent: '', remove() {}, append() {} }; made.push(e); return e; } };
    labels = createLabels(doc.createElement(), galaxy, { steps: { site: 26, room: 15 }, flight: () => ({ k: 0.5, to: site.id }), doc });
    labels.draw();
    s = labels.shown().find((x) => x.tone === 'crit' && x.dim);
    if (s) break;
  }
  assert.ok(s, 'a crit name dims in some flight of the large fleet');
  assert.match(s.text, /^■ /, 'shown() keeps the whole name');
  const span = made.slice(1).find((e) => e.textContent === s.text.slice(2));
  assert.ok(span, 'the span holds the word without its shape');
  assert.equal(span.dataset.glyph, '■');
  assert.equal(span.dataset.tone, 'crit');
  assert.ok('dim' in span.dataset);
  // A calm name has no shape mark.
  const calm = labels.shown().find((x) => x.tone === 'calm');
  const calmSpan = made.slice(1).find((e) => e.textContent === calm.text);
  assert.ok(calmSpan && !('glyph' in calmSpan.dataset), `${calm.text}: no shape`);
});

test('wall.css: a dimmed crit/warn name is --text-3, its shape keeps the crit/warn hue (night 4 T6)', () => {
  const css = fs.readFileSync(path.join(ROOT, 'public/css/wall.css'), 'utf8');
  assert.match(css, /\.galaxy-label\[data-glyph\]::before \{ content: attr\(data-glyph\) " "; \}/);
  for (const [tone, token] of [['crit', '--crit'], ['warn', '--warn'], ['low', '--p3']]) {
    assert.ok(css.includes(`.galaxy-label[data-tone="${tone}"]::before { color: var(${token}); }`), `${tone} shape in ${token}`);
  }
  // Nothing greys the shape: no dim rule reaches the ::before.
  assert.doesNotMatch(css, /\[data-dim\][^{]*::before/);
  assert.ok(css.includes('.galaxy-label[data-dim] { color: var(--text-3); }'), 'the word dims');
});

test('galaxy main.js: the caption waits for 0.9 of the flight and the names hear the flight', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/wall/galaxy/main.js'), 'utf8');
  assert.match(src, /timing: still \? STILL_CAPTION_TIMING : arrivedTimingFor\(fast\)/);
  const at = src.indexOf('const labels = createLabels(');
  assert.ok(at > 0 && src.indexOf('flight: cam.flight,', at) > at && src.indexOf('flight: cam.flight,', at) < src.indexOf('});', at));
});
