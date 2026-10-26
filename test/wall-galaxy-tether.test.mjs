// The tether (Wall plan night 2 T20): at the overview a hairline in the
// status hue runs from the far fleet line to the cluster it names, drawn in
// once (~600 ms) after the flight back out, then still; it goes on a site leg.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from '../public/vendor/three/three.module.js';
import { galaxyLayout } from '../public/js/wall/galaxy/layout.js';
import { overviewShot } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
import { TETHER, createTether, tetherLine, tetherProgress, tetherSite } from '../public/js/wall/galaxy/tether.js';
import { worstLine } from '../public/js/wall/frame.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';

const W = 1368, H = 912;

function nodes({ crit = 'hv2', warn = null } = {}) {
  const out = [{ id: '__core', kind: 'core', status: 'ok' }];
  for (const s of ['hv1', 'hv2', 'cloud', 'lab']) {
    out.push({ id: s, parent: '__core', kind: 'site', label: s, status: 'ok' });
    out.push({ id: `${s}-room`, parent: s, kind: 'room', label: `${s} room`, status: 'ok' });
    // Every site has a `builder-a`: the line's site part tells them apart.
    const st = s === crit ? 'crit' : s === warn ? 'warn' : 'ok';
    out.push({ id: `${s}-b`, parent: `${s}-room`, kind: 'builder', label: 'builder-a', status: st, why: st === 'ok' ? undefined : 'disk full' });
  }
  return out;
}

test('tetherSite: the site the fleet line names, by its words', () => {
  const m = { nodes: nodes({ crit: 'hv2', warn: 'lab' }) };
  assert.equal(worstLine(m).word, 'hv2 · builder-a');
  assert.deepEqual(tetherSite(m), { id: 'hv2', tone: 'crit' });
  // Only warn: the line names lab, in its hue.
  assert.deepEqual(tetherSite({ nodes: nodes({ crit: null, warn: 'lab' }) }), { id: 'lab', tone: 'warn' });
  // The site itself in trouble: the line is its name alone.
  const down = nodes({ crit: null });
  down.find((n) => n.id === 'cloud').status = 'crit';
  assert.deepEqual(tetherSite({ nodes: down }), { id: 'cloud', tone: 'crit' });
  // Calm, trouble in no site, a site not drawn: nothing to tie.
  assert.equal(tetherSite({ nodes: nodes({ crit: null }) }), null);
  assert.equal(tetherSite({ nodes: [{ id: '__core', kind: 'core', status: 'crit' }] }), null);
  assert.equal(tetherSite(m, ['hv1', 'lab']), null);
  assert.deepEqual(tetherSite(m, ['hv1', 'hv2']), { id: 'hv2', tone: 'crit' });
});

test('tetherLine: leaves the words from their top, never across the letters, and stops short of the star', () => {
  const from = { left: 700, top: 760, right: 1300, bottom: 860, glyph: 720 };
  const end = (g) => ({ x: g.x + Math.cos(g.angle) * g.len, y: g.y + Math.sin(g.angle) * g.len });

  // Up and left of the shape: from above the shape.
  const a = tetherLine(from, { x: 300, y: 300, r: 8 });
  assert.deepEqual([a.x, a.y], [720, 760 - TETHER.gap]);
  const ea = end(a);
  assert.ok(Math.abs(Math.hypot(ea.x - 300, ea.y - 300) - (8 + TETHER.gap)) < 1e-6, 'r + gap short of the star');

  // Up and right: from above the letters under it, so it never crosses them.
  const b = tetherLine(from, { x: 1000, y: 200, r: 8 });
  assert.deepEqual([b.x, b.y], [1000, 760 - TETHER.gap]);
  assert.ok(b.angle < 0 && b.angle > -Math.PI, 'upward');
  // Past the words' right end: from their top right corner.
  assert.equal(tetherLine(from, { x: 1360, y: 100, r: 8 }).x, 1300);

  // Beside the words: from their left edge, at their middle.
  const c = tetherLine(from, { x: 200, y: 820, r: 8 });
  assert.deepEqual([c.x, c.y], [700 - TETHER.gap, 810]);

  // Drawn in from the word: t is the share of the length.
  assert.ok(Math.abs(tetherLine(from, { x: 300, y: 300, r: 8 }, 0.5).len - a.len / 2) < 1e-9);
  assert.equal(tetherLine(from, { x: 300, y: 300, r: 8 }, 0).len, 0);
  // Too close to be worth a line, or nothing to start from.
  assert.equal(tetherLine(from, { x: 720, y: 735, r: 8 }), null);
  assert.equal(tetherLine(null, { x: 1, y: 1 }), null);
});

test('tetherProgress: eased from 0 to 1 over the draw, monotonic', () => {
  assert.equal(tetherProgress(0, 100), 0);
  assert.equal(tetherProgress(100, 100), 0);
  assert.equal(tetherProgress(100 + TETHER.drawMs, 100), 1);
  assert.equal(tetherProgress(1e9, 100), 1);
  let prev = -1;
  for (let t = 0; t <= TETHER.drawMs; t += 50) {
    const k = tetherProgress(100 + t, 100);
    assert.ok(k >= prev);
    prev = k;
  }
  assert.ok(tetherProgress(100 + TETHER.drawMs / 2, 100) > 0.5, 'fast from the word, settling on the place');
  assert.equal(tetherProgress(5, 5, 0), 1, 'no draw time: at once');
});

/** The overview as the camera sees it, folded sites, a real three camera, no WebGL. */
function fakeGalaxy(list) {
  const lay = galaxyLayout(list);
  const sites = lay.sites.map((s) => ({
    id: s.id, node: s.node, home: s.home, reach: s.reach, open: 0, alive: 1, members: [],
  }));
  const camera = new THREE.PerspectiveCamera(42, W / H, 1, 30000);
  const shot = overviewShot(sites);
  camera.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
  camera.lookAt(shot.look.x, shot.look.y, shot.look.z);
  return {
    world: { sites, byId: new Map(sites.map((s) => [s.id, s])) },
    setOpen() {},
    camera,
    renderer: { domElement: { clientWidth: W, clientHeight: H } },
  };
}

test('createTether: the fleet line\'s named site is the hairline\'s far end, drawn in after the flight, then still', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    let now = 1000;
    const list = nodes({ crit: 'hv2' });
    const galaxy = fakeGalaxy(list);
    const cam = createGalaxyCamera(galaxy);
    const word = { left: 600, top: 740, right: 1286, bottom: 860, glyph: 630 };
    let reads = 0;
    const t = createTether(makeEl('div'), cam, { anchor: () => { reads += 1; return word; }, clock: { now: () => now } });
    t.update({ nodes: list }, galaxy.world.byId.keys());
    assert.equal(t.el.dataset.tone, 'crit');

    // An overview leg: nothing while the camera flies back out.
    t.show(2250);
    now += 2000;
    cam.drawn();
    assert.equal(t.state().drawn, null);
    assert.equal(t.el.style.opacity, '0');

    // Halfway through the draw-in, then all of it.
    now += 250 + TETHER.drawMs / 2;
    cam.drawn();
    const half = t.state().drawn;
    now += TETHER.drawMs;
    cam.drawn();
    const full = t.state().drawn;
    assert.ok(half.len > 0 && half.len < full.len);
    assert.equal(t.el.style.opacity, '', 'shown at the stylesheet\'s strength');
    const star = cam.screenOf('hv2');
    const end = { x: full.x + Math.cos(full.angle) * full.len, y: full.y + Math.sin(full.angle) * full.len };
    assert.ok(Math.abs(Math.hypot(end.x - star.x, end.y - star.y) - (star.r + TETHER.gap)) < 1e-6, 'ends at hv2, short of its rim');
    assert.equal(full.id, 'hv2');
    assert.ok(full.y <= word.top, 'from the words');

    // Still: more frames write nothing new and read the words no more.
    const tf = t.el.style.transform;
    now += 5000;
    cam.drawn(); cam.drawn();
    assert.equal(t.el.style.transform, tf);
    assert.equal(reads, 1, 'the words\' box read once, not per frame');

    // The line names another site: drawn in again from the word, to it.
    const next = nodes({ crit: 'cloud' });
    t.update({ nodes: next }, galaxy.world.byId.keys());
    cam.drawn();
    assert.ok(t.state().drawn == null || t.state().drawn.len < 1, 'starts again');
    now += TETHER.drawMs;
    cam.drawn();
    assert.equal(t.state().drawn.id, 'cloud');

    // A site leg: it fades over outMs (by script: the sheet has no transitions), then is gone.
    const ks = [];
    t.el.style.setProperty = (k, v) => { if (k === '--tether-k') ks.push(Number(v)); };
    t.hide();
    now += TETHER.outMs / 2;
    cam.drawn();
    assert.ok(t.state().drawn, 'still there, fading');
    assert.ok(ks.at(-1) > 0.3 && ks.at(-1) < 0.7, `half faded: ${ks.at(-1)}`);
    now += TETHER.outMs / 2 + 1;
    cam.drawn();
    assert.equal(t.state().drawn, null);
    assert.equal(t.el.style.opacity, '0');
    // Back at the overview: full strength again.
    t.show(0);
    now += TETHER.drawMs;
    cam.drawn();
    assert.equal(ks.at(-1), 1);
    t.hide();
    now += TETHER.outMs + 1;
    cam.drawn();
    t.update({ nodes: nodes({ crit: null }) }, galaxy.world.byId.keys());
    t.show(0);
    now += TETHER.drawMs;
    cam.drawn();
    assert.equal(t.state().drawn, null);
  } finally {
    globalThis.document = prevDoc;
  }
});

test('galaxy.html has the tether layer between the frame and the lock; main.js draws it on overview legs', () => {
  const pub = path.resolve(import.meta.dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'galaxy.html'), 'utf8');
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.match(html, /class="galaxy-tether-layer" id="galaxy-tether"/);
  assert.ok(at('wall-frame') < at('galaxy-tether') && at('galaxy-tether') < at('wall-lock'));
  const main = fs.readFileSync(path.join(pub, 'js/wall/galaxy/main.js'), 'utf8');
  assert.match(main, /createTether\(tetherRoot, cam/);
  assert.match(main, /if \(leg\.kind === 'overview'\) tether\.show\(fromSite && !reduced \? FLIGHT\.ms : 0\)/);
  assert.match(main, /tether\.update\(model/);
  const css = fs.readFileSync(path.join(pub, 'css/wall.css'), 'utf8');
  assert.match(css, /\.galaxy-tether \{[^}]*opacity: calc\(0\.7 \* var\(--tether-k, 1\)\)/);
});
