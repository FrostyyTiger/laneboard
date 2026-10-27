// What lies over the Map on the Wall (Wall plan T24): the caption plate and
// the far fleet block are Map covers, so no map name is cut by their edge or
// shows through them as a ghost. The Map's `covers` option defaults off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, el } from './helpers/fake-map-dom.mjs';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';
import { coverOf, createCaption, captionLines, CAPTION_TIMING } from '../public/js/wall/caption.js';
import { createFrame } from '../public/js/wall/frame.js';
import { readFileSync } from 'node:fs';

function model() {
  return {
    title: 'acme',
    nodes: [
      { id: '__core', kind: 'core', label: 'acme', status: 'ok' },
      { id: 'hv1', kind: 'site', parent: '__core', label: 'hv1', status: 'ok' },
      { id: 'hv2', kind: 'site', parent: '__core', label: 'hv2', status: 'ok' },
      { id: 'hv1/rack', kind: 'room', parent: 'hv1', label: 'rack', status: 'ok' },
      { id: 'hv2/storage', kind: 'room', parent: 'hv2', label: 'storage', status: 'crit', why: 'pool 97% full' },
    ],
    links: [],
    events: [],
  };
}

/** hv1 and its room on the left half of a 1200 px canvas, hv2 and its room on the right. */
const WHERE = {
  __core: { x: 0, y: 0 }, hv1: { x: -300, y: 0 }, hv2: { x: 300, y: 0 },
  'hv1/rack': { x: -300, y: 150 }, 'hv2/storage': { x: 300, y: 150 },
};
function gridLayout(nodes) {
  const center = nodes.find((n) => n.kind === 'core');
  const kids = new Map();
  for (const n of nodes) {
    if (n === center || !n.parent) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  return { pos: new Map(nodes.map((n) => [n.id, { ...WHERE[n.id] }])), center, kids };
}

async function drawn(opts, then = () => {}, m = model()) {
  const dom = installDom();
  const { createMap } = await import('../public/js/views/map/index.js');
  const root = el('div', 1200, 800);
  const map = createMap(root, { layout: gridLayout, ...opts });
  const canvas = root.children.find((c) => c.tagName === 'CANVAS');
  map.update(m);
  then(map);
  dom.flush(40);
  const text = new Set(canvas.ctx.calls.text);
  map.destroy();
  dom.restore();
  return text;
}

test('coverOf: an offset box as a cover, nothing for a box that takes no room', () => {
  assert.deepEqual(coverOf({ left: 82, top: 64, width: 400, height: 300 }), { left: 82, top: 64, right: 482, bottom: 364 });
  assert.equal(coverOf({ left: 0, top: 0, width: 0, height: 300 }), null);
  assert.equal(coverOf({ left: 0, top: 0, width: 10, height: NaN }), null);
  assert.equal(coverOf(null), null);
});

test('createMap { covers }: names under a cover are not drawn, the rest are; off by default', async () => {
  const plain = await drawn({});
  for (const name of ['HV1', 'HV2', 'RACK', 'STORAGE']) assert.ok(plain.has(name), `${name} drawn without covers`);

  let asked = 0;
  const left = await drawn({ covers: () => { asked++; return [{ left: 0, top: 0, right: 600, bottom: 800 }]; } });
  assert.ok(asked > 0, 'asked every frame');
  assert.ok(!left.has('HV1') && !left.has('RACK'), 'the left half is covered: its names go');
  assert.ok(left.has('HV2') && left.has('STORAGE'), 'the right half keeps its names');

  const odd = await drawn({ covers: () => 'nothing' });
  assert.ok(odd.has('HV1'), 'a cover function that answers no list covers nothing');
});

/** The fake document, with the one DOM call it lacks that the caption makes. */
function captionDocument() {
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    return e;
  };
  return doc;
}

test('createMap { covers }: a link label touching a page cover is not drawn', async () => {
  const linked = () => ({ ...model(), links: [{ from: 'hv1', to: 'hv2', kind: 'flow', label: 'clones' }] });
  const hot = (map) => map.select('hv1');
  const plain = await drawn({}, hot, linked());
  assert.ok(plain.has('clones'), 'the hot link is labelled without covers');
  const mid = await drawn({ covers: () => [{ left: 450, top: 250, right: 750, bottom: 550 }] }, hot, linked());
  assert.ok(!mid.has('clones'), 'its label sits under the cover in the middle');
  assert.ok(mid.has('HV1'), 'names clear of the cover stay');
  const corner = await drawn({ covers: () => [{ left: 0, top: 0, right: 40, bottom: 40 }] }, hot, linked());
  assert.ok(corner.has('clones'), 'a cover elsewhere leaves it');
});

test('caption: the plate covers the map from its fade-in with its full box, until its fade-out ends', () => {
  const prevDoc = globalThis.document;
  globalThis.document = captionDocument();
  try {
    let waits = [];
    const timers = {
      setTimeout: (fn, ms) => { const w = { fn, ms, done: false }; waits.push(w); return w; },
      clearTimeout: (w) => { if (w) w.done = true; },
    };
    const run = (upTo) => {
      for (const w of [...waits].sort((a, b) => a.ms - b.ms)) {
        if (!w.done && w.ms <= upTo) { w.done = true; w.fn(); }
      }
    };
    const root = makeEl('div');
    root.clientWidth = 1368;
    root.clientHeight = 912;
    const caption = createCaption(root, { timers, timing: CAPTION_TIMING });
    const plate = caption.el;
    Object.assign(plate, { offsetLeft: 82, offsetTop: 73, offsetWidth: 520, offsetHeight: 440 });
    assert.equal(caption.cover(), null, 'no plate yet, no cover');

    const m = model();
    const leg = { kind: 'site', id: 'hv2', index: 1, count: 2, arriveMs: 1200 };
    caption.show(leg, captionLines(m.nodes[2], m, 1, 2));
    run(0);
    assert.equal(caption.cover(), null, 'built but not yet fading in');
    run(1200);
    assert.deepEqual(caption.cover(), { left: 82, top: 73, right: 602, bottom: 513 }, 'the full plate from its fade-in');

    waits = [];
    caption.hide();
    assert.ok(caption.cover(), 'still covering while it fades out');
    caption.hide();
    run(CAPTION_TIMING.outMs);
    assert.equal(caption.cover(), null, 'names come back once it has gone, a second hide does not hold it');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('frame: the far fleet block covers the map only at the far step, its box read again when its words change', () => {
  const prevDoc = globalThis.document;
  globalThis.document = makeDocument();
  try {
    const timers = { setTimeout: () => 0, clearTimeout() {} };
    const root = makeEl('div');
    const frame = createFrame(root, { timers, now: () => 0 });
    const box = frame.el.fleet;
    let reads = 0;
    let top = 700;
    Object.defineProperty(box, 'offsetTop', { get: () => { reads++; return top; } });
    Object.assign(box, { offsetLeft: 500, offsetWidth: 868, offsetHeight: 212 });

    const fleet = (storage) => {
      const m = model();
      m.nodes[4] = { ...m.nodes[4], ...storage };
      return m;
    };
    frame.update(fleet({ status: 'ok', why: null }));
    assert.equal(frame.cover(), null, 'calm: the line covers nothing');

    frame.update(fleet({}));
    assert.equal(box.dataset.step, 'far');
    assert.deepEqual(frame.cover(), { left: 500, top: 700, right: 1368, bottom: 912 });
    frame.cover();
    frame.update(fleet({}));
    frame.cover();
    assert.equal(reads, 1, 'same words: the box is not read again');
    top = 650;
    frame.update(fleet({ why: 'pool 99% full' }));
    assert.equal(frame.cover().top, 650, 'new words: read again');
  } finally {
    globalThis.document = prevDoc;
  }
});

// Night 4 T10 (r46-skeptic galaxy 3): no dark rectangle over the galaxy. The
// plate's and the far fleet block's grounds are tokens.css gradients that fall
// off to nothing across the padding (as --tex-vignette, only wall.css uses
// them); neither has a flat fill whose edge cuts a star, a nebula or a label,
// and neither is masked (the corner brackets stay the only hard lines).
const sheet = (name) => readFileSync(new URL(`../public/css/${name}`, import.meta.url), 'utf8');
const ruleOf = (css, sel) => {
  const at = css.indexOf(`\n${sel} {`);
  assert.ok(at >= 0, sel);
  return css.slice(at, css.indexOf('\n}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
};
const tokenLayers = (name) => {
  const m = sheet('tokens.css').match(new RegExp(`\\n  ${name}:([\\s\\S]*?);\\n`));
  assert.ok(m, name);
  return m[1].split(/,\s*\n(?=\s*(?:linear|radial)-gradient)/).map((l) => l.trim());
};

test('wall.css: the plate is at least 95 % opaque under its words', () => {
  const [band] = tokenLayers('--tex-plate');
  const shares = [...band.matchAll(/var\(--bg-canvas\) (\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
  const share = Math.max(...shares);
  assert.ok(share >= 95, `plate ground ${share} %`);
  assert.match(band, new RegExp(`var\\(--bg-canvas\\) ${share}%, transparent\\) 2\\.4vmin,`), 'full from the feather in');
});

test('wall.css: the plate and the far fleet block have feathered grounds, no hard-edged fill (night 4 T10)', () => {
  const css = sheet('wall.css');
  const grounds = { '.wall-caption': '--tex-plate', '.wall-fleet[data-step="far"]': '--tex-plate-corner' };
  for (const [sel, token] of Object.entries(grounds)) {
    const block = ruleOf(css, sel);
    assert.match(block, new RegExp(`\\n  background: var\\(${token}\\);`), `${sel} stands on ${token}`);
    assert.doesNotMatch(block, /\bmask|box-shadow|border(-\w+)?:/, `${sel}: not masked, no edge line`);
    const layers = tokenLayers(token);
    assert.ok(layers.length >= 3, `${token}: layered (${layers.length})`);
    for (const layer of layers) {
      assert.match(layer, /^(linear|radial)-gradient\(/, `${token}: every layer a gradient`);
      assert.match(layer, /transparent (0|100%)[,)]/, `${token}: every layer falls off to nothing`);
      assert.match(layer, /no-repeat$/, `${token}: no tile repeats`);
    }
  }
  assert.equal(tokenLayers('--tex-plate').length, 7, 'a band, two edge ramps, four corners');
  assert.equal(tokenLayers('--tex-plate-corner').length, 3, 'a band, the top ramp, the top-left corner');
  // The fleet's top and left padding is the feather, so the words stand on the full ground;
  // the plate's padding (--cap-pad) is the same 2.4vmin.
  assert.match(ruleOf(css, '.wall-fleet[data-step="far"]'), /padding: 2\.4vmin var\(--frame-x\) var\(--frame-y\) 2\.4vmin;/);
  assert.match(ruleOf(css, '.wall-caption'), /--cap-pad: 2\.4vmin;/);
});
