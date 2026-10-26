// No frame reads layout (Wall plan night 2 T29, reviews/r37-performance.md 3):
// the canvas's size is read once and again only when a ResizeObserver says
// it changed (stage.js); the tag's and the fleet line's boxes only when their
// words or the stage change (hud.js). Before, every frame read the canvas's
// clientWidth/Height four times and the tag's offset box twice, after the
// lock's and the labels' style writes: two forced layouts a frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStageSize, sizeOf } from '../public/js/wall/galaxy/stage.js';
import { createGalaxyScene } from '../public/js/wall/galaxy/scene.js';
import { createGalaxyCamera } from '../public/js/wall/galaxy/camera.js';
import { createLabels } from '../public/js/wall/galaxy/labels.js';
import { createHud } from '../public/js/wall/galaxy/hud.js';
import { paletteFrom } from '../public/js/wall/galaxy/palette.js';

// An element whose layout properties count their reads.
function measured(box) {
  const reads = { n: 0 };
  const el = { reads, textContent: '', dataset: {} };
  for (const [k, v] of Object.entries(box)) {
    Object.defineProperty(el, k, { get() { reads.n++; return box[k]; }, enumerable: true });
    box[k] = v;
  }
  el.set = (k, v) => { box[k] = v; };
  return el;
}

// A ResizeObserver you fire by hand.
function fakeObserver() {
  const made = [];
  class Observer {
    constructor(cb) { this.cb = cb; this.els = []; this.off = false; made.push(this); }
    observe(el) { this.els.push(el); }
    disconnect() { this.off = true; }
    fire() { this.cb(this.els.map((target) => ({ target }))); }
  }
  return { Observer, made };
}

test('createStageSize: read once, again only when the observer fires, and the version moves with a new size', () => {
  const el = measured({ clientWidth: 1600, clientHeight: 900 });
  const { Observer, made } = fakeObserver();
  const stage = createStageSize(el, { Observer });
  assert.equal(el.reads.n, 2);
  for (let i = 0; i < 50; i++) assert.deepEqual(stage.get(), { W: 1600, H: 900 });
  assert.equal(el.reads.n, 2, 'no read per call');
  const v = stage.version();
  made[0].fire();
  assert.equal(stage.version(), v, 'the same size is not a new one');
  el.set('clientWidth', 1200);
  made[0].fire();
  assert.deepEqual(stage.get(), { W: 1200, H: 900 });
  assert.equal(stage.version(), v + 1);
  stage.stop();
  assert.equal(made[0].off, true);
});

test('createStageSize without a ResizeObserver reads the element each time (plain objects in tests)', () => {
  const el = measured({ clientWidth: 800, clientHeight: 600 });
  const stage = createStageSize(el, { Observer: undefined });
  assert.deepEqual(stage.get(), { W: 800, H: 600 });
  el.set('clientHeight', 500);
  assert.deepEqual(stage.get(), { W: 800, H: 500 });
  assert.deepEqual(sizeOf({ renderer: { domElement: { clientWidth: 3, clientHeight: 4 } } }), { W: 3, H: 4 });
  assert.deepEqual(sizeOf({ size: () => ({ W: 5, H: 6 }) }), { W: 5, H: 6 });
});

const fakeDoc = {
  createElement: () => {
    const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    return {
      width: 0, height: 0, style, dataset: {}, textContent: '', className: '', remove() {}, append() {},
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {}, set fillStyle(_) {}, set globalCompositeOperation(_) {},
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
      }),
    };
  },
};

const MODEL = {
  title: 'acme',
  nodes: [
    { id: '__core', kind: 'core', status: 'ok' },
    { id: 'hv1', parent: '__core', kind: 'site', label: 'hv1', status: 'ok' },
    { id: 'hv1-b', parent: 'hv1', kind: 'builder', label: 'builder-a', status: 'ok' },
    { id: 'lab', parent: '__core', kind: 'site', label: 'lab', status: 'crit' },
    { id: 'lab-b', parent: 'lab', kind: 'builder', label: 'builder-b', status: 'crit', why: 'disk full' },
  ],
};

test('a frame of the galaxy (scene, camera, screenOf, labels, covers) reads no layout after the first', () => {
  const canvas = measured({ clientWidth: 1600, clientHeight: 900 });
  const { Observer, made } = fakeObserver();
  const sizes = [];
  const galaxy = createGalaxyScene(canvas, {
    palette: paletteFrom(),
    doc: fakeDoc,
    clock: () => 1000,
    stage: createStageSize(canvas, { Observer }),
    makeRenderer: (c) => ({
      domElement: c, setPixelRatio() {}, setClearColor() {}, setSize: (w, h) => sizes.push([w, h]), dispose() {}, render() {},
    }),
  });
  galaxy.update(MODEL);
  const cam = createGalaxyCamera(galaxy);
  const root = fakeDoc.createElement();
  const tag = measured({ offsetLeft: 1400, offsetTop: 20, offsetWidth: 180, offsetHeight: 30 });
  tag.textContent = 'laneboard · acme live';
  const frame = { update() {}, live() {}, cover: () => null, el: { tag } };
  const caption = { show() {}, hide() {}, cover: () => null };
  const hud = createHud({ caption, frame, size: galaxy.size });
  const labels = createLabels(root, galaxy, { steps: { site: 26, room: 15 }, covers: hud.covers, doc: fakeDoc });
  cam.focus('lab', 2.3);
  const at = (now) => {
    cam.frame(now);
    hud.tagCover(); // freeBox's
    galaxy.frame(now);
    cam.screenOf('lab-b');
    labels.draw(); // covers() once more
  };
  at(1000);
  const first = { canvas: canvas.reads.n, tag: tag.reads.n };
  assert.equal(first.canvas, 2, 'the canvas read once, at the start');
  assert.equal(first.tag, 4, "the tag's box read once");
  for (let t = 1033; t < 1600; t += 33) at(t);
  assert.deepEqual({ canvas: canvas.reads.n, tag: tag.reads.n }, first, 'nothing read per frame');
  assert.deepEqual(sizes, [[1600, 900]]);

  // The tag's words change (offline): its box once more, then quiet again.
  tag.textContent = 'laneboard · acme offline';
  at(1700);
  at(1733);
  assert.equal(tag.reads.n, 8);

  // The stage resizes: the observer reads the canvas, the renderer and the tag follow on the next frame.
  canvas.set('clientWidth', 1200);
  made[0].fire();
  at(1766);
  at(1800);
  assert.equal(canvas.reads.n, 4);
  assert.deepEqual(sizes, [[1600, 900], [1200, 900]]);
  assert.equal(galaxy.camera.aspect, 1200 / 900);
  assert.equal(tag.reads.n, 12, 'the tag read again for the new stage');
});

test('galaxy/main.js hands the one stage size to the lock and the hud and reads no canvas size itself', () => {
  const js = fs.readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /canvas\.client(Width|Height)/);
  assert.match(js.match(/createGalaxyLock\([\s\S]*?\n {2}\}\);/)?.[0] ?? '', /size: galaxy\.size/);
  assert.match(js, /createHud\(\{[^}]*size: galaxy\.size/);
  for (const f of ['scene', 'camera', 'labels', 'hud']) {
    const src = fs.readFileSync(new URL(`../public/js/wall/galaxy/${f}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /client(Width|Height)/, `${f}.js reads the stage through stage.js`);
  }
});
