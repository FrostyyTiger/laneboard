// The Map view integration (fleet M5, plan §5 2.7-2.8): the view module's
// default export for the §4 registry, the route plan (b= / sel=), the 2.8
// inline action list and its pulses, hook events keyed `lane:<builder>/<lane>`,
// the split table's rows, sorting, formatting and virtual window (plus the
// table against a small fake DOM), and the minimap's transform, throttle and
// visibility (plus a draw against a fake canvas).
import test from 'node:test';
import assert from 'node:assert/strict';

import mapView, {
  laneActions, actionArgs, actionPulse, mapEventFor, routePlan, splitState, pipOffsets, getMapView, mapActions, nodeActions,
} from '../public/js/views/map.js';
import {
  SPLIT_KEY, SPLIT_MIN_W, ROW_H, VIRTUAL_FROM, COLUMNS, splitOn, canSplit, stateGlyph, stateWord,
  fmtCtx, fmtUsd, fmtAge, rowRank, compareRows, splitRows, rowCells, visibleWindow, createSplitTable,
} from '../public/js/views/map/split.js';
import {
  PIP_SIZE, PIP_FPS, PIP_FRAME_MS, PIP_MIN_VIEWPORT, pipVisible, pipTransform, hasTrouble, shouldRedraw,
  blinkPhase, dotsOf, ringsOf, createMinimap,
} from '../public/js/views/map/minimap.js';
import { SHAPE_CODE, TONE_CODE } from '../public/js/views/map/overlays.js';
import { RINGS } from '../public/js/views/map/layout.js';
import { isView } from '../public/js/views/index.js';

// --- fixtures ----------------------------------------------------------------

const MODEL = {
  title: 'fleet',
  fleet: { builders: [{ id: 'builder-a', code: 'B1', link: 'up' }, { id: 'builder-b', code: 'B2', link: 'up' }] },
  nodes: [
    { id: '__core', kind: 'core', label: 'core' },
    { id: 'builder:builder-a', kind: 'builder', parent: '__core', builder: 'builder-a', label: 'B1' },
    { id: 'builder:builder-b', kind: 'builder', parent: '__core', builder: 'builder-b', label: 'B2' },
    {
      id: 'lane:builder-a/pay', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', fkey: 'builder-a/pay',
      label: 'pay', status: 'working', sub: 'Edit api/charge.ts', session: 'builder-a/s1',
      m: { costUsd: 3.2, ctxPct: 61.4, ageMs: 5_400_000 },
    },
    {
      id: 'lane:builder-a/web', kind: 'lane', parent: 'builder:builder-a', builder: 'builder-a', fkey: 'builder-a/web',
      label: 'web', status: 'attention', sub: 'Bash', session: 'builder-a/s2', flags: { awaitingApproval: true },
      m: { costUsd: 0.4, ctxPct: 12, ageMs: 30_000 },
    },
    {
      id: 'lane:builder-b/api', kind: 'lane', parent: 'builder:builder-b', builder: 'builder-b', fkey: 'builder-b/api',
      label: 'api', status: 'idle', m: { ageMs: 90_000_000 },
    },
    { id: 'sess:builder-b/x1', kind: 'session', parent: 'lane:builder-b/api', builder: 'builder-b', fkey: 'builder-b/x1', label: 'x1', status: 'crit', m: { costUsd: 120.4 } },
    { id: 'sess:builder-b/x2', kind: 'session', parent: 'lane:builder-b/api', builder: 'builder-b', fkey: 'builder-b/x2', label: 'x2', status: 'ok', m: { ctxPct: 88 } },
  ],
  links: [],
  events: [],
};

// --- the view module -----------------------------------------------------------

test('views/map.js default export is a registry view with the nav metadata', () => {
  assert.ok(isView(mapView), 'id + mount/unmount/update');
  assert.equal(mapView.id, 'map');
  assert.equal(mapView.icon, 'map');
  assert.equal(mapView.short, 'MAP');
  assert.equal(getMapView(), null, 'no map until it is mounted');
  assert.deepEqual(mapActions(null), []);
  assert.deepEqual(nodeActions(null), []);
  assert.deepEqual(nodeActions({ id: 'hv', kind: 'host' }), [], 'a leaf machine offers nothing');
});

test('routePlan: b= becomes the scope; sel= selects only when it changed', () => {
  assert.deepEqual(routePlan({ view: 'map' }, null), { scope: 'all', select: undefined });
  assert.deepEqual(routePlan({ view: 'map', b: 'builder-a', sel: 'builder-a/pay' }, null), { scope: 'builder-a', select: 'builder-a/pay' });
  assert.equal(routePlan({ sel: 'builder-a/pay' }, 'builder-a/pay').select, undefined, 'our own click does not fly again');
  assert.equal(routePlan({ sel: null }, 'builder-a/pay').select, null, 'Esc clears');
  assert.equal(routePlan({ b: '' }).scope, 'all');
});

test('splitState: lb.split = "1" wants split; below 900px it is refused and the map stays full', () => {
  assert.equal(SPLIT_KEY, 'lb.split');
  assert.equal(SPLIT_MIN_W, 900);
  assert.deepEqual(splitState('1', 1400), { want: true, on: true, refused: false });
  assert.deepEqual(splitState('1', 899), { want: true, on: false, refused: true });
  assert.deepEqual(splitState('0', 1400), { want: false, on: false, refused: false });
  assert.deepEqual(splitState(null, 1400), { want: false, on: false, refused: false });
  assert.equal(splitOn('1'), true);
  assert.equal(splitOn('true'), false);
  assert.equal(canSplit(900), true);
  assert.equal(canSplit(NaN), false);
});

test('pipOffsets: above the tape, clear of an open inspector', () => {
  assert.deepEqual(pipOffsets({}), { right: 12, bottom: 40 });
  assert.deepEqual(pipOffsets({ inspW: 360, tapeH: 28 }), { right: 372, bottom: 40 });
  assert.deepEqual(pipOffsets({ inspW: NaN }), { right: 12, bottom: 40 });
});

// --- inline actions (2.8) ---------------------------------------------------------

const tier = (a) => ({ 'send-text': 'click', pause: 'click', resume: 'click', approve: 'click', deny: 'click' })[a] ?? 'confirm';
const lane = MODEL.nodes[3];
const waiting = MODEL.nodes[4];

test('laneActions: term, peek, send, pause for a working lane; tiers by name', () => {
  const list = laneActions(lane, { tier });
  assert.deepEqual(list.map((a) => a.id), ['term', 'peek', 'send', 'pause']);
  assert.deepEqual(list.map((a) => a.tier), ['none', 'none', 'click', 'click']);
  assert.equal(list.find((a) => a.id === 'send').action, 'send-text');
  for (const a of list) assert.equal(typeof a.icon, 'string');
});

test('laneActions: resume when paused; approve/deny only with a pending approval id', () => {
  assert.deepEqual(laneActions(lane, { tier, paused: true }).map((a) => a.id), ['term', 'peek', 'send', 'resume']);
  assert.deepEqual(laneActions({ ...lane, flags: { paused: true } }, { tier }).map((a) => a.id).at(-1), 'resume');
  assert.ok(!laneActions(waiting, { tier }).some((a) => a.id === 'approve'), 'flag without an id: nothing to approve');
  const ids = laneActions(waiting, { tier, approvalId: 'ap-1' }).map((a) => a.id);
  assert.deepEqual(ids.slice(-2), ['approve', 'deny']);
});

test('laneActions: fold for any node with children; nothing for a plain machine', () => {
  assert.deepEqual(laneActions(MODEL.nodes[1], { tier, hasKids: true }).map((a) => a.id), ['fold']);
  assert.deepEqual(laneActions(MODEL.nodes[1], { tier }), []);
  assert.deepEqual(laneActions({ id: 'lane:x', kind: 'lane' }, { tier }), [], 'a lane without a fleet key has no actions');
  assert.deepEqual(laneActions(null), []);
});

test('actionArgs: approvalId for approve/deny, guardPrompt on send', () => {
  assert.deepEqual(actionArgs('approve', { approvalId: 'ap-1' }), { approvalId: 'ap-1' });
  assert.deepEqual(actionArgs('deny', { approvalId: 'ap-1' }), { approvalId: 'ap-1' });
  assert.deepEqual(actionArgs('send', { text: 'hi' }), { text: 'hi', guardPrompt: true });
  assert.deepEqual(actionArgs('pause'), {});
});

test('actionPulse: ok pulses ok, a failure pulses crit, unknown outcome no pulse', () => {
  const ok = actionPulse(lane, 'Pause', { ok: true }, 5);
  assert.deepEqual(ok, { at: 5, node: 'lane:builder-a/pay', kind: 'ok', text: 'Pause → pay', silent: true });
  const bad = actionPulse(lane, 'Pause', { ok: false, error: 'denied' }, 6);
  assert.equal(bad.kind, 'crit');
  assert.match(bad.text, /denied/);
  assert.equal(actionPulse(lane, 'Pause', { ok: 'unknown' }), null);
  assert.equal(actionPulse(null, 'Pause', { ok: true }), null);
});

test('mapEventFor: hook events pulse lane:<builder>/<lane>; a permission prompt is attention', () => {
  const s = { sessions: new Map([['builder-a/s1', { lane: 'pay', builder: 'builder-a' }], ['loose', { builder: 'builder-a' }]]) };
  assert.deepEqual(mapEventFor({ key: 'builder-a/s1', type: 'PreToolUse' }, s), {
    node: 'lane:builder-a/pay', kind: 'working', text: 'pay · PreToolUse', silent: true,
  });
  const ask = mapEventFor({ key: 'builder-a/s1', type: 'Notification', subtype: 'permission_prompt' }, s);
  assert.equal(ask.kind, 'attention');
  assert.equal(ask.silent, false);
  assert.equal(mapEventFor({ key: 'loose', type: 'x' }, s), null, 'no lane: no node');
  assert.equal(mapEventFor({ type: 'x' }, s), null);
  assert.equal(mapEventFor({ key: 'nope' }, s), null);
});

// --- split table (pure) ---------------------------------------------------------

test('split columns follow the plan', () => {
  assert.deepEqual(COLUMNS.map((c) => c[0]), ['state', 'b', 'lane', 'sess', 'sub', 'ctx', 'usd', 'age']);
  assert.equal(ROW_H, 22);
  assert.equal(VIRTUAL_FROM, 80);
});

test('splitRows: lanes, or their sessions when a lane has session nodes; worst first', () => {
  const rows = splitRows(MODEL);
  assert.deepEqual(rows.map((r) => r.id), ['sess:builder-b/x1', 'lane:builder-a/web', 'lane:builder-a/pay', 'sess:builder-b/x2']);
  const x1 = rows[0];
  assert.equal(x1.lane, 'api', 'a session row names its lane');
  assert.equal(x1.sess, 'x1');
  assert.equal(x1.code, 'B2');
  assert.equal(x1.sel, 'builder-b/x1', 'rows select by fleet key');
  assert.equal(x1.age, 90_000_000, 'age falls back to the lane');
  const pay = rows.find((r) => r.id === 'lane:builder-a/pay');
  assert.equal(pay.sess, 's1', 'a lane row names its session');
  assert.equal(pay.sub, 'Edit api/charge.ts');
});

test('splitRows: scope keeps one builder; junk input gives no rows', () => {
  assert.deepEqual(splitRows(MODEL, { scope: 'builder-a' }).map((r) => r.builder), ['builder-a', 'builder-a']);
  assert.deepEqual(splitRows(null), []);
  assert.deepEqual(splitRows({ nodes: [null, 3, { kind: 'lane' }] }), []);
});

test('rowRank/compareRows: status first, then flags, then names', () => {
  const base = { builder: 'b', lane: 'l', sess: '', id: 'x', flags: {} };
  assert.ok(rowRank({ ...base, status: 'crit' }) > rowRank({ ...base, status: 'attention' }));
  assert.ok(rowRank({ ...base, status: 'working', flags: { awaitingApproval: true } }) > rowRank({ ...base, status: 'working' }));
  const a = { ...base, status: 'ok', lane: 'a' }, b = { ...base, status: 'ok', lane: 'b' };
  assert.ok(compareRows(a, b) < 0);
});

test('row cells: glyph + word, code, names, ctx%, $24h, age', () => {
  const rows = splitRows(MODEL);
  assert.deepEqual(rowCells(rows[0]), ['■ CRIT', 'B2', 'api', 'x1', '', '—', '$120', '25h']);
  assert.deepEqual(rowCells(rows[2]), ['· WORK', 'B1', 'pay', 's1', 'Edit api/charge.ts', '61', '$3.20', '1h']);
  assert.equal(stateGlyph('attention'), '▲');
  assert.equal(stateGlyph('low'), '◆');
  assert.equal(stateGlyph('unknown'), '○');
  assert.equal(stateWord('nope'), 'UNKN');
  assert.equal(fmtCtx(null), '—');
  assert.equal(fmtUsd(-1), '$0.00');
  assert.equal(fmtAge(45_000), '45s');
  assert.equal(fmtAge(12 * 60_000), '12m');
  assert.equal(fmtAge(3 * 86_400_000), '3d');
  assert.equal(fmtAge(-1), '—');
});

test('visibleWindow: everything up to 80 rows, a padded window above', () => {
  assert.deepEqual(visibleWindow(80, 500, 300), { start: 0, end: 80, padTop: 0, padBottom: 0 });
  const w = visibleWindow(1000, 22 * 100, 22 * 20);
  assert.equal(w.start, 92);
  assert.equal(w.end, 128);
  assert.equal(w.padTop, 92 * 22);
  assert.equal(w.padBottom, (1000 - 128) * 22);
  assert.equal(visibleWindow(1000, 0, 0).start, 0);
  assert.equal(visibleWindow(1000, 1e9, 400).end, 1000);
});

// --- split table against a fake DOM ---------------------------------------------

function fakeDoc() {
  const doc = {
    createElement(tag) {
      const e = {
        tagName: tag.toUpperCase(), ownerDocument: doc, children: [], parent: null, listeners: {},
        className: '', textContent: '', hidden: false, title: '', tabIndex: 0, scope: '',
        style: {}, dataset: {}, attrs: {}, scrollTop: 0, clientHeight: 200,
        classList: {
          set: new Set(),
          toggle(c, on) { if (on ?? !this.set.has(c)) this.set.add(c); else this.set.delete(c); },
          add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); },
        },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        append(...xs) { for (const x of xs) { x.parent = this; this.children.push(x); } },
        replaceChildren(...xs) { this.children = []; this.append(...xs); },
        remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; },
        addEventListener(t, f) { (this.listeners[t] ||= []).push(f); },
        removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] ?? []).filter((g) => g !== f); },
        fire(t, ev = {}) { for (const f of this.listeners[t] ?? []) f(ev); },
      };
      return e;
    },
  };
  return doc;
}
const tbodyOf = (pane) => pane.children[0].children[0].children[1];
const textOf = (e) => (e.children.length ? e.children.map(textOf).join('|') : e.textContent);

test('split table: rows worst first, text only, click selects, hover lights both ways', () => {
  const doc = fakeDoc();
  const host = doc.createElement('section');
  const picked = [];
  const hovered = [];
  const t = createSplitTable(host, { onSelect: (s) => picked.push(s), onHover: (id) => hovered.push(id) });
  const evil = { ...MODEL, nodes: MODEL.nodes.map((n) => (n.id === 'lane:builder-a/pay' ? { ...n, label: '<img src=x onerror=alert(1)>' } : n)) };
  t.update(evil);
  const body = tbodyOf(t.el);
  assert.equal(body.children.length, 4);
  assert.equal(body.children[0].dataset.node, 'sess:builder-b/x1');
  const payRow = body.children.find((r) => r.dataset.node === 'lane:builder-a/pay');
  assert.equal(payRow.children[2].textContent, '<img src=x onerror=alert(1)>', 'builder text lands as text');
  assert.equal(payRow.style.height, '22px');
  payRow.fire('click');
  assert.deepEqual(picked, ['builder-a/pay']);
  payRow.fire('mouseenter');
  payRow.fire('mouseenter');
  body.fire('mouseleave');
  assert.deepEqual(hovered, ['lane:builder-a/pay', null], 'row hover lights the map node, once');
  t.setSelected('builder-a/pay');
  assert.equal(payRow.getAttribute('aria-selected'), 'true');
  assert.equal(body.children[0].getAttribute('aria-selected'), 'false');
  t.setHot('lane:builder-a/pay');
  assert.ok(payRow.classList.contains('is-hot'), 'map hover marks the row');
  t.setHot(null);
  assert.ok(!payRow.classList.contains('is-hot'));
  t.update(MODEL, { scope: 'builder-b' });
  assert.equal(tbodyOf(t.el).children.length, 2);
  t.update({ nodes: [] });
  assert.equal(t.el.children[1].hidden, false, 'the empty note shows');
  t.destroy();
  assert.equal(host.children.length, 0);
});

test('split table: above 80 rows only a window is rendered, with spacers', () => {
  const doc = fakeDoc();
  const host = doc.createElement('section');
  const nodes = [];
  for (let i = 0; i < 500; i++) nodes.push({ id: `lane:builder-a/l${i}`, kind: 'lane', builder: 'builder-a', fkey: `builder-a/l${i}`, label: `l${i}`, status: 'ok' });
  const t = createSplitTable(host, {});
  t.update({ nodes });
  const body = tbodyOf(t.el);
  assert.ok(body.children.length < 60, `rendered ${body.children.length}`);
  assert.equal(body.children.at(-1).className, 'map-split-pad');
  assert.equal(t.rows().length, 500);
  textOf(body);
});

// --- minimap -----------------------------------------------------------------------

const scene = (version, tones = [TONE_CODE.grey]) => {
  const pts = new Float32Array(tones.length * 4);
  tones.forEach((tone, i) => { pts[i * 4] = i * 100; pts[i * 4 + 1] = -i * 50; pts[i * 4 + 2] = SHAPE_CODE.disc; pts[i * 4 + 3] = tone; });
  return { version, pts, count: tones.length, outer: 540 };
};

test('pip constants: 240 px, 2 fps, hidden under 700 px', () => {
  assert.equal(PIP_SIZE, 240);
  assert.equal(PIP_FPS, 2);
  assert.equal(PIP_FRAME_MS, 500);
  assert.equal(PIP_MIN_VIEWPORT, 700);
});

test('pipVisible: only in other views, wide windows, a visible document, a loaded map', () => {
  assert.equal(pipVisible({ view: 'board', width: 1400, hasMap: true }), true);
  assert.equal(pipVisible({ view: 'map', width: 1400, hasMap: true }), false);
  assert.equal(pipVisible({ view: 'board', width: 699, hasMap: true }), false);
  assert.equal(pipVisible({ view: 'board', width: 1400, hidden: true, hasMap: true }), false);
  assert.equal(pipVisible({ view: 'board', width: 1400, hasMap: false }), false);
});

test('pipTransform/ringsOf/dotsOf: the scene fits the canvas, centred', () => {
  const tf = pipTransform(540);
  assert.equal(tf.cx, 120);
  assert.equal(tf.cy, 120);
  assert.ok((540 + 24) * tf.s <= 110 + 1e-9);
  assert.deepEqual(ringsOf(540, tf).length, RINGS.filter((r) => r > 0 && r <= 541).length);
  const dots = dotsOf(scene(1, [TONE_CODE.grey, TONE_CODE.crit]), tf);
  assert.equal(dots.length, 2);
  assert.deepEqual(dots[0], { x: 120, y: 120, shape: 'disc', tone: 'grey' });
  assert.equal(dots[1].tone, 'crit');
  assert.ok(pipTransform(0).s > 0, 'no outer: a default radius');
});

test('shouldRedraw: at most 2 fps, only on a new version or a due blink', () => {
  const s1 = scene(1);
  assert.equal(shouldRedraw(null, s1, 0), true, 'first frame');
  assert.equal(shouldRedraw(null, null, 0), false, 'no scene');
  const last = { version: 1, at: 1000, phase: blinkPhase(1000) };
  assert.equal(shouldRedraw(last, scene(2), 1200), false, 'within 500 ms');
  assert.equal(shouldRedraw(last, scene(2), 1500), true, 'new version');
  assert.equal(shouldRedraw(last, s1, 5000), false, 'nothing changed, nothing in trouble');
  const trouble = scene(1, [TONE_CODE.warn]);
  assert.equal(hasTrouble(trouble), true);
  assert.equal(shouldRedraw(last, trouble, 1600), false, 'same blink phase');
  assert.equal(shouldRedraw(last, trouble, 2100), true, 'blink flipped');
  assert.equal(shouldRedraw(last, trouble, 2100, { reduced: true }), false, 'reduced motion: change only');
});

test('createMinimap: draws from the scene source, throttled; click returns', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const listeners = {};
  const canvas = { width: 0, height: 0, getContext: () => ctx, addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: () => {} };
  let t = 10_000;
  let sc = scene(1, [TONE_CODE.grey, TONE_CODE.crit]);
  let clicked = 0;
  const mini = createMinimap(canvas, () => sc, { now: () => t, reduced: () => false, onClick: () => clicked++ });
  assert.equal(mini.draw(), true);
  assert.equal(canvas.width, 240);
  assert.ok(calls.some((c) => c[0] === 'arc'), 'rings and dots');
  assert.ok(!calls.some((c) => c[0] === 'fillText'), 'no labels');
  assert.equal(mini.draw(), false, 'throttled');
  t += 600; sc = scene(2);
  assert.equal(mini.draw(), true);
  t += 600;
  assert.equal(mini.draw(), false, 'same version, calm');
  listeners.click();
  assert.equal(clicked, 1);
  assert.equal(mini.running(), false);
  mini.destroy();
  const none = createMinimap(canvas, () => null, { now: () => t });
  assert.equal(none.draw(true), false, 'no scene, no draw');
});
