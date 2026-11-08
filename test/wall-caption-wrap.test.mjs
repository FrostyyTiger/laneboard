// Night 5 T24 (r10-film-ui 4, r40-stranger 5): the plate's text is never cut. A long line wraps and the plate
// grows by whole lines; rows that would run past the frame's clock give way at the end to `+N MORE`, so no line
// is clipped through its letters. A trouble plate reads on three levels: the word, its subject (why and name),
// its facts (count and next problems, white with only shape and status word in hue).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STEPS, PLATE, PLATE_FIT, MAX_TEXT, captionLines, plateHeight, plateRoom, fitPlate, heroSize, createCaption, CAPTION_TIMING,
} from '../public/js/wall/caption.js';
import { makeDocument, makeEl } from './helpers/fakedom.mjs';

const W = 1368;
const H = 912;
const VMIN = Math.min(W, H) / 100;

// HV1 with a lane waiting on a long prompt, three more problems and facts: more than a plate's room once wrapped.
function model({ problems = 2, why = 'waiting on a permission prompt for the deploy key · 3m' } = {}) {
  const nodes = [
    { id: 'hv1', kind: 'site', label: 'HV1', status: 'ok', detail: { hardware: 'demo hypervisor', where: 'rack 2 · upper shelf', uptime: '41 d' } },
    { id: 'ba', parent: 'hv1', kind: 'builder', label: 'ba', status: 'ok', metrics: { cpu: 0.4, mem: 0.6 } },
    { id: 'l1', parent: 'ba', kind: 'lane', label: 'feat-search', status: 'attention', why },
  ];
  for (let i = 0; i < problems; i++) {
    nodes.push({ id: `p${i}`, parent: 'ba', kind: 'lane', label: `acme-billing-${i}`, status: 'warn', why: 'task T2 failed in rounds 3 and 4 after a merge conflict' });
  }
  return { nodes };
}

test('T24: three levels on one scale, the word, its subject, its facts', () => {
  const k = (v) => v / STEPS.hero;
  assert.ok(Math.abs(k(STEPS.subject) - 0.42) < 0.05, `subject ${k(STEPS.subject)} of the word`);
  assert.ok(Math.abs(k(STEPS.fact) - 0.28) < 0.05, `facts ${k(STEPS.fact)} of the word`);
  assert.ok(STEPS.heroMin / STEPS.subject >= 1.6 && STEPS.subject / STEPS.fact >= 1.5, 'each level a clear step, even at the least word');
  assert.equal(PLATE.sub, STEPS.subject, 'the why at the subject step');
  assert.equal(PLATE.rows.trouble, STEPS.fact, 'the count and the problems at the fact step');
  assert.ok(STEPS.fact > STEPS.line, 'facts still over the plain line step');
  // The name under a word is the subject's size: never bigger than its why, never under it.
  const c = captionLines(model().nodes[0], model());
  const calm = { ...c, lines: c.lines.filter((l) => l.step !== 'hero') };
  const delta = plateHeight(c, 0, 12) - plateHeight(calm, 0);
  const expect = PLATE.heroAbove + 12 * PLATE.heroLead + PLATE.subGap + PLATE.sub + Math.max(PLATE.heroBelow, PLATE.nameAbove)
    - PLATE.nameAbove + (STEPS.subject - STEPS.name) * PLATE.nameLead;
  assert.ok(Math.abs(delta - expect) < 0.01, `${delta} vs ${expect}`);
});

test('T24: a long why or fact is kept whole, and a wrapped line is whole lines of the plate', () => {
  const m = model();
  const c = captionLines(m.nodes[0], m);
  for (const l of c.lines) assert.doesNotMatch(`${l.text ?? ''}${l.sub ?? ''}${l.word ?? ''}`, /…/, `${l.kind} not cut`);
  assert.ok(MAX_TEXT >= 80, 'only a runaway string is clipped');
  const rows = c.lines.filter((l) => l.step !== 'hero');
  const one = plateHeight(c, Infinity, 12);
  const wrapped = plateHeight(c, Infinity, 12, { sub: 2, rows: rows.map((_, i) => (i === 1 ? 2 : 1)) });
  const second = PLATE.rows[rows[1].step];
  assert.ok(Math.abs(wrapped - one - PLATE.sub - second) < 0.01, 'one more line of the why, one more of row 2');
  assert.equal(plateHeight(c, Infinity, 12, { rows: [] }), one, 'unknown wraps are one line');
  assert.equal(plateHeight(c, Infinity, 12, { sub: 0.2, rows: [NaN, -1] }), one, 'nonsense is one line');
});

test('T24: rows past the room give way at the end to `+N MORE`, never a cut line', () => {
  const room = plateRoom(W, H);
  const expectRoom = (H * (1 - (PLATE_FIT.topVh + PLATE_FIT.bottomVh) / 100)) / VMIN - PLATE_FIT.clockVmin;
  assert.ok(Math.abs(room - expectRoom) < 1e-9);
  assert.equal(plateRoom(0, 0), Infinity, 'no stage, no fit');
  const m = model({ problems: 3 });
  const c = captionLines(m.nodes[0], m);
  const rows = c.lines.filter((l) => l.step !== 'hero');
  const hero = heroSize(c.lines[0].word, W, H);
  // Wrapped onto three lines each, it no longer fits.
  const wraps = { hero: 1, sub: 2, name: 1, rows: rows.map(() => 3) };
  assert.ok(plateHeight(c, Infinity, hero, wraps) > room, 'the fixture runs past the room');
  const fit = fitPlate(c, hero, wraps, room);
  assert.ok(fit.dropped > 0);
  assert.ok(plateHeight(fit.cap, Infinity, hero, fit.wraps) <= room, 'the kept plate fits');
  const kept = fit.cap.lines.filter((l) => l.step !== 'hero');
  assert.deepEqual(kept.slice(0, -1), rows.slice(0, rows.length - fit.dropped), 'the first rows kept as they were, in order');
  assert.deepEqual(kept.at(-1), { kind: 'more', step: 'small', label: '', text: `+${fit.dropped} MORE` });
  assert.equal(fit.wraps.rows.length, kept.length);
  // As many as fit: one more row would not.
  if (fit.dropped > 1) {
    const more = fitPlate(c, hero, wraps, plateHeight(fit.cap, Infinity, hero, fit.wraps) - 0.01);
    assert.ok(more.dropped > fit.dropped);
  }
  // A plate that fits is untouched.
  const whole = fitPlate(c, hero, { rows: [] }, Infinity);
  assert.equal(whole.dropped, 0);
  assert.deepEqual(whole.cap.lines, c.lines);
});

// The page: a fake layout where a row's height is its wrapped lines (36 letters a line at the fact step, 30 for the why).
function page() {
  const doc = makeDocument();
  const make = doc.createElement.bind(doc);
  doc.createElement = (tag) => {
    const e = make(tag);
    e.replaceChildren = (...kids) => { e.textContent = ''; e.append(...kids); };
    Object.defineProperty(e, 'scrollHeight', {
      get() {
        const n = (per) => Math.max(1, Math.ceil(this.textContent.length / per));
        if (this.className === 'wall-caption-line') {
          const row = PLATE.rows[this.dataset.step] ?? PLATE.rows.line;
          return n(this.dataset.step === 'small' ? 70 : 36) * row * VMIN;
        }
        if (this.className === 'wall-caption-hero-sub') return n(30) * PLATE.sub * VMIN;
        return undefined;
      },
    });
    return e;
  };
  return doc;
}

test('T24: the page wraps a long why and rows, counts their lines in its height, and fits the room with `+N MORE`', () => {
  const prevDoc = globalThis.document;
  globalThis.document = page();
  try {
    const root = makeEl('div');
    root.clientWidth = W;
    root.clientHeight = H;
    const waits = [];
    const timers = { setTimeout: (fn, ms) => { waits.push({ fn, ms }); return waits.length; }, clearTimeout: () => {} };
    const cap = createCaption(root, { timers, timing: CAPTION_TIMING });
    const find = (e, pred, out = []) => { if (pred(e)) out.push(e); for (const c of e.children ?? []) find(c, pred, out); return out; };
    const plate = find(root, (e) => e.className === 'wall-caption')[0];
    const rowsOf = () => find(root, (e) => e.className === 'wall-caption-line');

    // One more problem: everything fits, wrapped.
    const m = model({ problems: 1 });
    const c = captionLines(m.nodes[0], m);
    cap.show({ kind: 'site', id: 'hv1', arriveMs: 0, sheet: true }, { ...c, sheet: true });
    for (const w of waits.splice(0)) w.fn();
    const rows = rowsOf();
    assert.equal(rows.length, c.lines.length - 1, 'every row kept');
    assert.ok(rows.every((r) => !/…/.test(r.textContent)), 'no row cut');
    const sub = find(root, (e) => e.className === 'wall-caption-hero-sub')[0];
    assert.match(sub.textContent, /deploy key · 3m$/, 'the why whole');
    const hero = heroSize(c.lines[0].word, W, H);
    const lineCount = (r) => Math.round(r.scrollHeight / ((PLATE.rows[r.dataset.step] ?? PLATE.rows.line) * VMIN));
    const wraps = { sub: 2, rows: rows.map(lineCount) };
    assert.ok(wraps.rows.some((n) => n > 1), 'some row wrapped');
    const height = Number(plate.style.height.replace('vmin', ''));
    assert.equal(height, plateHeight(c, Infinity, hero, wraps), 'the plate counts every wrapped line');
    assert.ok(height > plateHeight(c, Infinity, hero), 'taller than unwrapped');
    assert.ok(height <= plateRoom(W, H), 'inside the frame');

    // Four problems and long facts: the last rows give way.
    const big = model({ problems: 4 });
    big.nodes[0].detail.where = 'rack 2 · upper shelf behind the printer in the hallway cupboard by the door';
    const c2 = captionLines(big.nodes[0], big);
    cap.show({ kind: 'site', id: 'hv1', arriveMs: 0, sheet: true }, { ...c2, sheet: true });
    for (const w of waits.splice(0)) w.fn();
    const rows2 = rowsOf();
    const last = rows2.at(-1);
    assert.equal(last.dataset.kind, 'more');
    const dropped = Number(last.textContent.match(/^\+(\d+) MORE$/)?.[1]);
    assert.ok(dropped > 0, last.textContent);
    assert.equal(rows2.length - 1 + dropped, c2.lines.length - 1, 'kept + dropped = all rows');
    assert.ok(Number(plate.style.height.replace('vmin', '')) <= plateRoom(W, H), 'inside the frame');
    assert.ok(rows2.every((r) => !r.hidden && !/…/.test(r.textContent)));
  } finally {
    globalThis.document = prevDoc;
  }
});

test('T24: wall.css cuts no plate text and lets it wrap; a problem\'s words are white, its shape and word in hue', () => {
  const css = readFileSync(new URL('../public/css/wall.css', import.meta.url), 'utf8');
  const caption = css.slice(css.indexOf('\n.wall-caption-layer {'), css.indexOf('Target lock (js/wall/lock.js)'));
  assert.doesNotMatch(caption, /text-overflow/, 'no ellipsis on the plate');
  const rule = (sel) => {
    const at = css.indexOf(`\n${sel} {`);
    assert.ok(at >= 0, sel);
    return css.slice(at, css.indexOf('}', at));
  };
  for (const sel of ['.wall-caption-val', '.wall-caption-hero-sub', '.wall-caption-name']) {
    assert.doesNotMatch(rule(sel), /white-space: nowrap|overflow: hidden/, sel);
    assert.match(rule(sel), /overflow-wrap: anywhere/, sel);
  }
  assert.match(rule('.wall-caption-hero-text'), /white-space: normal/);
  // A wrapped row is a whole number of rows: each text's line height is its row's.
  assert.match(rule('.wall-caption-val'), new RegExp(`line-height: ${PLATE.rows.line}vmin`));
  assert.match(rule('.wall-caption-line[data-step="small"] .wall-caption-val'), new RegExp(`line-height: ${PLATE.rows.small}vmin`));
  assert.match(rule('.wall-caption-line[data-step="trouble"] .wall-caption-val'), /line-height: 1;/);
  assert.match(rule('.wall-caption-hero-sub'), /line-height: 1;/);
  for (const sel of ['.wall-caption-line', '.wall-caption-line[data-step="small"]', '.wall-caption-line[data-step="trouble"]',
    '.wall-caption-hero-sub', '.wall-caption-name', '.wall-caption-hero-word']) {
    assert.match(rule(sel), /height: calc\(.* \* var\(--lines, 1\)\)/, `${sel} grows by whole lines`);
  }
  assert.match(rule('.wall-caption[data-hero]'), new RegExp(`--cap-name: ${STEPS.subject}vmin`));
  // The problem's words in --text-1, after the hue rules so they win; the key keeps the hue.
  const white = css.indexOf('.wall-caption-line[data-kind="problem"] .wall-caption-val { color: var(--text-1); }');
  assert.ok(white > css.indexOf('.wall-caption-line[data-kind="problem"][data-tone="low"] > *'));
});
