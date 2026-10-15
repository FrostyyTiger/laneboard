// The component kit (fleet plan §4 2.5, task D3): the pure models behind the
// lamp, segment bar, sparkline, panel, data table, toast and confirm dialog,
// plus the DOM builders run against a tiny fake document, and static checks
// over public/css/components.css and public/dev/kit.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const C = await import('../public/js/ui/components.js');
const S = await import('../public/js/ui/spark.js');
const T = await import('../public/js/ui/toast.js');
const K = await import('../public/js/ui/confirm.js');
const { ACTION_TIERS } = await import('../public/js/core/actions.js');
const { createStore, applyBuilders, applySnapshot, setSourceKind } = await import('../public/js/core/store.js');

// --- a minimal DOM, enough for the builders -----------------------------------

function fakeDom() {
  class Node {
    constructor(tag, ns = null) {
      this.tagName = String(tag).toUpperCase();
      this.localName = tag;
      this.namespaceURI = ns;
      this.nodeType = 1;
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.dataset = {};
      this.listeners = {};
      this._text = '';
      this.hidden = false;
      const self = this;
      this.classList = {
        add: (...c) => { const s = new Set(self.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(' '); },
        remove: (...c) => { self.className = self.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
        contains: (c) => self.className.split(' ').includes(c),
        toggle: (c, on) => { const has = self.classList.contains(c); const want = on ?? !has; if (want) self.classList.add(c); else self.classList.remove(c); return want; },
      };
      this.className = '';
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); if (k === 'class') this.className = String(v); if (k === 'id') this.id = String(v); }
    getAttribute(k) { return k === 'class' ? this.className : (this.attributes.has(k) ? this.attributes.get(k) : null); }
    hasAttribute(k) { return this.attributes.has(k); }
    appendChild(c) { if (typeof c === 'string') c = textNode(c); c.parentNode = this; this.children.push(c); return c; }
    append(...cs) { for (const c of cs) this.appendChild(c); }
    replaceChildren(...cs) { this.children = []; this._text = ''; this.append(...cs); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    dispatch(t, e = {}) { const ev = { type: t, target: this, preventDefault() { ev.defaultPrevented = true; }, ...e }; for (const fn of this.listeners[t] || []) fn(ev); return ev; }
    focus() { doc.activeElement = this; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
    set textContent(v) { this.children = []; this._text = String(v); }
    get rows() { return this.children.filter((c) => c.tagName === 'TR'); }
    all(pred, out = []) { for (const c of this.children) { if (c.nodeType === 1) { if (pred(c)) out.push(c); c.all(pred, out); } } return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
    querySelectorAll(sel) {
      const m = /^([a-z]*)(?:\.([\w-]+))?(?::not\(\.([\w-]+)\))?(?:\[type="(\w+)"\])?$/.exec(sel);
      if (!m) throw new Error(`fake dom: selector ${sel}`);
      return this.all((n) => (!m[1] || n.localName === m[1]) && (!m[2] || n.classList.contains(m[2]))
        && (!m[3] || !n.classList.contains(m[3])) && (!m[4] || n.type === m[4]));
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch('close'); }
  }
  function textNode(s) { return { nodeType: 3, textContent: String(s) }; }
  const body = new Node('body');
  const toastEl = new Node('div');
  toastEl.id = 'toast';
  toastEl.hidden = true;
  body.appendChild(toastEl);
  const doc = {
    body,
    activeElement: null,
    createElement: (t) => new Node(t, 'http://www.w3.org/1999/xhtml'),
    createElementNS: (ns, t) => new Node(t, ns),
    getElementById: (id) => body.all((n) => n.id === id)[0] ?? null,
  };
  return doc;
}

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = fakeDom();
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
}

// --- lamp -----------------------------------------------------------------------

test('normP maps priorities, alarm levels and session states to lamp values', () => {
  assert.equal(C.normP(1), '1');
  assert.equal(C.normP('2'), '2');
  assert.equal(C.normP('p3'), '3');
  assert.equal(C.normP('P1'), '1');
  assert.equal(C.normP('P4'), '3', 'P4 -> 3 (§4 2.5)');
  assert.equal(C.normP('ok'), 'ok');
  assert.equal(C.normP('stale'), 'stale');
  assert.equal(C.normP('waiting_permission'), '1');
  assert.equal(C.normP('waiting_question'), '2');
  assert.equal(C.normP('working'), 'run');
  assert.equal(C.normP('done'), 'ok');
  assert.equal(C.normP('idle'), 'off');
  assert.equal(C.normP('dead'), 'off');
  assert.equal(C.normP('<script>'), 'off', 'unknown never gets a colour');
  assert.equal(C.normP(undefined), 'off');
  for (const p of Object.keys(C.P_WORDS)) assert.ok(C.P_SHAPE[p], `${p} has a shape`);
});

test('lampLabel names the priority and the unacknowledged state', () => {
  assert.equal(C.lampLabel(1), 'critical');
  assert.equal(C.lampLabel('1', { unack: true, label: 'permission' }), 'permission, unacknowledged');
  assert.equal(C.lampLabel('run'), 'working');
});

test('flashDelay puts every flashing node on the shared 1 Hz phase', () => {
  assert.equal(C.flashDelay(0), '0ms');
  assert.equal(C.flashDelay(1250), '-250ms');
  assert.equal(C.flashDelay(98765.4), '-765ms');
  assert.equal(C.flashDelay(NaN), '0ms');
});

test('lamp() builds a span with data-p, role, aria-label and a synced flash', () => withDom(() => {
  const n = C.lamp('P1', { unack: true, label: 'permission' });
  assert.equal(n.className, 'lamp');
  assert.equal(n.dataset.p, '1');
  assert.equal(n.getAttribute('role'), 'img');
  assert.equal(n.getAttribute('aria-label'), 'permission, unacknowledged');
  assert.ok('unack' in n.dataset);
  assert.match(n.style.animationDelay, /^-?\d+ms$/);
  const quiet = C.lamp('ok');
  assert.ok(!('unack' in quiet.dataset));
  assert.equal(quiet.style.animationDelay, undefined);
}));

// --- laneMix / segbar -------------------------------------------------------------

test('laneMix counts sessions into p1 p2 run ok off dead', () => {
  const mix = C.laneMix([
    { state: 'waiting_permission' }, { state: 'idle', awaitingApproval: true },
    { state: 'waiting_question' }, { state: 'question' },
    { state: 'working' }, { state: 'working' }, { state: 'done' },
    { state: 'idle' }, { state: 'shell' }, { state: 'weird' },
    { state: 'dead' }, { state: 'working', stale: true },
  ]);
  assert.deepEqual(mix, { p1: 2, p2: 2, run: 2, ok: 1, off: 3, dead: 2, total: 12 });
  assert.deepEqual(C.laneMix([]), { p1: 0, p2: 0, run: 0, ok: 0, off: 0, dead: 0, total: 0 });
  assert.deepEqual(C.laneMix(null).total, 0);
  assert.deepEqual(C.MIX_ORDER, ['p1', 'p2', 'run', 'ok', 'off', 'dead']);
});

test('mixLabel reads like the plan example and omits empty buckets', () => {
  const mix = { p1: 1, p2: 2, run: 6, ok: 0, off: 3, dead: 0, total: 12 };
  assert.equal(C.mixLabel(mix), '12 lanes: 1 permission, 2 question, 6 working, 3 idle');
  assert.equal(C.mixLabel(C.laneMix([])), '0 lanes');
  assert.equal(C.mixLabel(C.laneMix([{ state: 'done' }])), '1 lane: 1 done');
});

test('segbar() renders segments in order with flex-grow and an aria-label', () => withDom(() => {
  const bar = C.segbar([{ state: 'idle' }, { state: 'waiting_permission' }, { state: 'working' }, { state: 'working' }]);
  assert.equal(bar.className, 'segbar');
  assert.equal(bar.getAttribute('role'), 'img');
  assert.equal(bar.getAttribute('aria-label'), '4 lanes: 1 permission, 2 working, 1 idle');
  assert.deepEqual(bar.children.map((i) => [i.dataset.p, i.style.flexGrow]), [['1', '1'], ['run', '2'], ['off', '1']]);
  const empty = C.segbar([]);
  assert.match(empty.className, /segbar--empty/);
  assert.equal(empty.children.length, 0);
}));

test('scopeSessions reads the F8a store per builder and marks down builders stale', () => {
  const s = createStore();
  setSourceKind(s, 'hub');
  applyBuilders(s, [{ id: 'builder-a', state: 'up' }, { id: 'builder-b', state: 'down' }]);
  applySnapshot(s, 'builder-a', { sessions: [{ name: 'auth', state: 'working' }, { name: 'api', state: 'waiting_question' }] });
  applySnapshot(s, 'builder-b', { sessions: [{ name: 'web', state: 'working' }] });
  const all = C.laneMix(C.scopeSessions(s));
  assert.equal(all.total, 3);
  const a = C.laneMix(C.scopeSessions(s, 'builder-a'));
  assert.deepEqual([a.run, a.p2, a.total], [1, 1, 2]);
  const b = C.scopeSessions(s, 'builder-b');
  assert.equal(s.builders.get('builder-b').status, 'down');
  assert.equal(C.laneMix(b).dead, 1, 'a down builder hatches its lanes');
  assert.deepEqual(C.scopeSessions(null), []);
});

// --- sparkline ---------------------------------------------------------------------

test('sparkPoints spreads values over 60x16 with the high values on top', () => {
  const pts = S.sparkPoints([0, 50, 100], 60, 16).split(' ').map((p) => p.split(',').map(Number));
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => p[0]), [1, 30, 59], 'x from 1 to w-1');
  assert.deepEqual(pts.map((p) => p[1]), [15, 8, 1], 'y: max at the top, inside 1px padding');
});

test('sparkPoints honours min/max, clamps, skips gaps and handles flat and empty series', () => {
  assert.equal(S.sparkPoints([50], 60, 16, { min: 0, max: 100 }), '59,8');
  assert.equal(S.sparkPoints([200, -5], 60, 16, { min: 0, max: 100 }), '1,1 59,15', 'clamped into the box');
  assert.equal(S.sparkPoints([3, 3, 3], 60, 16), '1,8 30,8 59,8', 'flat sits on the middle line');
  assert.equal(S.sparkPoints([1, null, 3], 60, 16), '1,15 59,1', 'a gap keeps its slot');
  assert.equal(S.sparkPoints([], 60, 16), '');
  assert.equal(S.sparkPoints([NaN, undefined], 60, 16), '');
  assert.equal(S.sparkPoints(null), '');
  for (const p of S.sparkPoints([0.123, 7.777, 1 / 3]).split(' ')) assert.match(p, /^\d+(\.\d{1,2})?,\d+(\.\d{1,2})?$/);
});

test('sparkTrend and sparkLabel give the accessible name', () => {
  assert.equal(S.sparkTrend([1, 2, 5]), 'rising');
  assert.equal(S.sparkTrend([5, 2, 1]), 'falling');
  assert.equal(S.sparkTrend([5, 9, 5]), 'flat');
  assert.equal(S.sparkTrend([5]), 'flat');
  assert.equal(S.sparkLabel('ctx 64%', [10, 64]), 'ctx 64%, rising');
  assert.equal(S.sparkLabel('cpu', []), 'cpu, no data');
});

test('sparkline() builds the SVG with DOM APIs: polyline, last point, threshold', () => withDom(() => {
  const svg = S.sparkline([10, 20, 64], { label: 'ctx 64%', threshold: 65, min: 0, max: 100 });
  assert.equal(svg.localName, 'svg');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 60 16');
  assert.equal(svg.getAttribute('width'), '60');
  assert.equal(svg.getAttribute('height'), '16');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(svg.getAttribute('aria-label'), 'ctx 64%, rising');
  const kinds = svg.children.map((c) => c.localName);
  assert.deepEqual(kinds, ['title', 'line', 'polyline', 'rect']);
  assert.equal(svg.children[1].getAttribute('class'), 'spark-th');
  assert.equal(svg.children[2].getAttribute('points'), S.sparkPoints([10, 20, 64], 60, 16, { min: 0, max: 100 }));
  assert.equal(svg.children[3].getAttribute('width'), '2');
  const none = S.sparkline([], { label: 'x' });
  assert.deepEqual(none.children.map((c) => c.localName), ['title']);
}));

// --- panel, plate, brackets ------------------------------------------------------------

test('panelTitle reads LANES · ALL [42]', () => {
  assert.equal(C.panelTitle({ name: 'lanes', scope: 'all', n: 42 }), 'LANES · ALL [42]');
  assert.equal(C.panelTitle({ name: 'Box' }), 'BOX');
  assert.equal(C.panelTitle({ name: 'audit', n: 0 }), 'AUDIT [0]');
  assert.equal(C.countTag(null), '');
});

test('panel() builds the inset title, and setPanel updates it in place', () => withDom(() => {
  const { root, title, body } = C.panel({ name: 'lanes', scope: 'all', n: 42, id: 'p-lanes' });
  assert.equal(root.localName, 'section');
  assert.equal(root.className, 'panel');
  assert.equal(root.getAttribute('aria-labelledby'), 'p-lanes');
  assert.equal(title.localName, 'h2');
  assert.equal(title.id, 'p-lanes');
  assert.deepEqual(title.children.map((c) => c.className), ['panel-name', 'panel-scope', 'panel-n', 'panel-tools']);
  assert.equal(title.textContent, 'LANES· ALL[42]');
  assert.equal(body.className, 'panel-b');
  C.setPanel(root, { scope: 'B1', n: 7 });
  assert.equal(root.querySelector('.panel-n').textContent, '[7]');
  assert.equal(root.querySelector('.panel-scope').textContent, '· B1');
  C.setPanel(root, { scope: null });
  assert.equal(root.querySelector('.panel-scope').hidden, true);
}));

test('plate() and markSel() set only classes and text', () => withDom(() => {
  const p = C.plate('<b>B1</b>', { kind: 'p1' });
  assert.equal(p.className, 'plate plate--p1');
  assert.equal(p.textContent, '<b>B1</b>', 'builder text stays text');
  assert.equal(C.plate('B2', { kind: 'bogus' }).className, 'plate');
  const n = C.markSel(C.plate('x'));
  assert.ok(n.classList.contains('sel'));
  C.markSel(n, false);
  assert.ok(!n.classList.contains('sel'));
}));

// --- sortRows / data table -----------------------------------------------------------------

test('sortRows is stable, numeric-aware and puts nulls last in both directions', () => {
  const rows = [
    { id: 'a', n: 3 }, { id: 'b', n: null }, { id: 'c', n: 1 }, { id: 'd', n: 3 },
    { id: 'e' }, { id: 'f', n: 2 }, { id: 'g', n: NaN },
  ];
  assert.deepEqual(C.sortRows(rows, 'n').map((r) => r.id), ['c', 'f', 'a', 'd', 'b', 'e', 'g']);
  assert.deepEqual(C.sortRows(rows, 'n', 'desc').map((r) => r.id), ['a', 'd', 'f', 'c', 'b', 'e', 'g']);
  const names = [{ s: 'lane10' }, { s: 'lane2' }, { s: 'Lane1' }, { s: '' }];
  assert.deepEqual(C.sortRows(names, 's').map((r) => r.s), ['Lane1', 'lane2', 'lane10', '']);
  assert.deepEqual(C.sortRows(rows, (r) => r.id, 'desc').map((r) => r.id)[0], 'g', 'a function key');
  assert.notEqual(C.sortRows(rows, 'n'), rows, 'a new array');
  assert.deepEqual(rows.map((r) => r.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'input untouched');
  assert.deepEqual(C.sortRows(null, 'n'), []);
});

test('nextSort flips the same column and rowMove walks the roving cursor', () => {
  assert.deepEqual(C.nextSort(null, 'age'), { key: 'age', dir: 'asc' });
  assert.deepEqual(C.nextSort({ key: 'age', dir: 'asc' }, 'age'), { key: 'age', dir: 'desc' });
  assert.deepEqual(C.nextSort({ key: 'age', dir: 'desc' }, 'b'), { key: 'b', dir: 'asc' });
  assert.equal(C.rowMove('j', 0, 3), 1);
  assert.equal(C.rowMove('ArrowDown', 2, 3), 2);
  assert.equal(C.rowMove('k', 0, 3), 0);
  assert.equal(C.rowMove('Home', 2, 3), 0);
  assert.equal(C.rowMove('End', 0, 3), 2);
  assert.equal(C.rowMove('x', 0, 3), null);
  assert.equal(C.rowMove('j', 0, 0), null);
});

test('dataTable() renders sorted rows, aria-sort, stale rows and text-only cells', () => withDom(() => {
  let opened = null;
  const t = C.dataTable({
    columns: [{ key: 'id', label: 'Lane' }, { key: 'n', label: 'N', num: true }],
    rows: [{ id: 'b', n: 2 }, { id: '<img src=x>', n: 1, stale: true }, { id: 'c' }],
    sort: { key: 'n', dir: 'asc' },
    rowKey: (r) => r.id,
    stale: (r) => r.stale,
    onOpen: (r) => { opened = r; },
    select: true,
  });
  const tbody = t.table.children[1];
  assert.deepEqual(tbody.rows.map((r) => r.dataset.key), ['<img src=x>', 'b', 'c']);
  assert.ok(tbody.rows[0].classList.contains('is-stale'));
  assert.equal(tbody.rows[0].children[1].textContent, '<img src=x>');
  assert.equal(tbody.rows[2].children[2].textContent, '—', 'missing data renders —');
  assert.equal(t.table.getAttribute('aria-rowcount'), '4');
  const ths = t.table.children[0].children[0].children;
  assert.equal(ths[2].getAttribute('aria-sort'), 'ascending');
  assert.equal(ths[1].getAttribute('aria-sort'), 'none');
  tbody.rows[1].dispatch('keydown', { key: ' ' });
  assert.deepEqual([...t.selected()], ['b']);
  tbody.rows[1].dispatch('keydown', { key: 'Enter' });
  assert.equal(opened.id, 'b');
  ths[2].children[0].dispatch('click');
  assert.deepEqual(t.table.children[1].rows.map((r) => r.dataset.key), ['b', '<img src=x>', 'c'], 'flipped to desc, null last');
}));

test('scopeChip() has a lamp, text, an x icon and an aria-label', () => withDom(() => {
  let removed = null;
  const chip = C.scopeChip('STCK', { param: 's', p: 2, onRemove: (p) => { removed = p; } });
  assert.equal(chip.className, 'chip');
  assert.equal(chip.dataset.param, 's');
  assert.equal(chip.children[0].className, 'lamp');
  assert.equal(chip.children[2].localName, 'svg');
  assert.match(chip.getAttribute('aria-label'), /STCK/);
  chip.dispatch('click');
  assert.equal(removed, 's');
}));

// --- toast -------------------------------------------------------------------------------------

test('toast kinds, durations and the 3-deep stack', () => {
  assert.equal(T.toastKind('err'), 'err');
  assert.equal(T.toastKind('error'), 'err');
  assert.equal(T.toastKind('nope'), 'info');
  assert.equal(T.toastDuration('info'), 4000);
  assert.equal(T.toastDuration('ok'), 4000);
  assert.equal(T.toastDuration('err'), 8000);
  assert.deepEqual(T.stackAfter([1, 2], 3), { keep: [1, 2, 3], drop: [] });
  assert.deepEqual(T.stackAfter([1, 2, 3], 4), { keep: [2, 3, 4], drop: [1] });
  assert.deepEqual(T.stackAfter([], 'a', 1), { keep: ['a'], drop: [] });
});

test('toast() stacks at most 3 in #toast, errors are role=alert, text stays text', () => withDom((doc) => {
  const made = [];
  for (let i = 0; i < 4; i++) made.push(T.toast(`<b>msg ${i}</b>`, { kind: i === 3 ? 'err' : 'info', timeout: 0 }));
  const box = doc.getElementById('toast');
  assert.ok(box.classList.contains('toasts'));
  assert.equal(box.getAttribute('aria-live'), 'polite');
  assert.equal(box.hidden, false);
  const live = box.querySelectorAll('div.toast:not(.is-out)');
  assert.equal(live.length, 3);
  assert.ok(made[0].node.classList.contains('is-out'), 'the oldest fades');
  const err = made[3].node;
  assert.equal(err.getAttribute('role'), 'alert');
  assert.equal(err.dataset.kind, 'err');
  assert.equal(err.querySelector('span.toast-m').textContent, '<b>msg 3</b>');
  made[1].close();
  assert.ok(made[1].node.classList.contains('is-out'));
  let ran = 0;
  const withAction = T.toast('undo?', { action: { label: 'Undo', run: () => { ran++; } }, timeout: 0 });
  withAction.node.querySelector('button').dispatch('click');
  assert.equal(ran, 1);
}));

// --- confirm -------------------------------------------------------------------------------------

test('typedOk matches `${VERB} ${target}` exactly (case-sensitive, trims only the ends)', () => {
  assert.equal(K.typedOk('KILL B1/auth', 'kill', 'B1/auth'), true);
  assert.equal(K.typedOk('  KILL B1/auth\n', 'kill', 'B1/auth'), true, 'a pasted newline is fine');
  assert.equal(K.typedOk('kill B1/auth', 'kill', 'B1/auth'), false, 'the verb is upper case');
  assert.equal(K.typedOk('KILL b1/auth', 'kill', 'B1/auth'), false, 'the target is exact');
  assert.equal(K.typedOk('KILL  B1/auth', 'kill', 'B1/auth'), false, 'one space');
  assert.equal(K.typedOk('KILL B1/aut', 'kill', 'B1/auth'), false);
  assert.equal(K.typedOk('KILL', 'kill', ''), false, 'no target, no match');
  assert.equal(K.typedOk(null, 'kill', 'x'), false);
  assert.equal(K.typedOk('PAUSE FLEET', 'pause', 'FLEET'), true);
  assert.equal(K.typedOk('BROADCAST 7', 'broadcast', 7), true);
  assert.equal(K.typedOk('SET-BUDGET B1', 'set-budget', 'B1'), true);
});

test('confirmSpec follows the tiers: read/click none, ask verb+Cancel, confirm typed', () => {
  assert.equal(K.confirmSpec({ action: 'send-text', targets: ['builder-a/auth'], tier: 'click' }).mode, 'none');
  assert.equal(K.confirmSpec({ action: 'x', targets: ['a'], tier: 'read' }).mode, 'none');
  const ask = K.confirmSpec({ action: 'spawn', targets: ['builder-a/new'], tier: 'ask' });
  assert.equal(ask.mode, 'ask');
  assert.equal(ask.confirm, 'new');
  const kill = K.confirmSpec({ action: 'kill', targets: ['builder-a/auth'], tier: ACTION_TIERS.kill });
  assert.equal(kill.mode, 'typed');
  assert.equal(kill.phrase, 'KILL builder-a/auth');
  assert.equal(kill.confirm, 'auth', 'args.confirm is the local target name');
  assert.equal(kill.destructive, true);
  const shown = K.confirmSpec({ action: 'kill', targets: [{ label: 'B1/auth', confirm: 'auth' }], tier: 'confirm' });
  assert.equal(shown.phrase, 'KILL B1/auth');
  assert.equal(shown.confirm, 'auth');
});

test('confirmSpec: target * and fan-outs are typed whatever the tier (S13)', () => {
  const fleet = K.confirmSpec({ action: 'pause', targets: ['*'], tier: 'click' });
  assert.equal(fleet.mode, 'typed');
  assert.equal(fleet.phrase, 'PAUSE FLEET');
  assert.equal(fleet.confirm, 'fleet', 'the hub checks fleet and rewrites it per builder');
  const local = K.confirmSpec({ action: 'pause', targets: ['*'], tier: 'click', builder: 'builder-a' });
  assert.equal(local.phrase, 'PAUSE builder-a');
  assert.equal(local.confirm, 'builder-a', 'a builder accepts only its own id');
  const builderWide = K.confirmSpec({ action: 'pause', targets: [{ label: 'B1', confirm: 'builder-a' }], tier: 'confirm' });
  assert.equal(builderWide.phrase, 'PAUSE B1');
  const fan = K.confirmSpec({ action: 'broadcast', targets: ['builder-a/a', 'builder-a/b', 'builder-b/c'], tier: 'confirm' });
  assert.equal(fan.phrase, 'BROADCAST 3');
  assert.equal(fan.confirmCount, 3);
  assert.deepEqual(fan.confirms, ['a', 'b', 'c']);
  assert.equal(fan.confirm, null);
  const many = K.confirmSpec({ action: 'send-text', targets: ['builder-a/a', 'builder-a/b'], tier: 'click' });
  assert.equal(many.mode, 'typed', 'several targets always type the count');
  const ack = K.confirmSpec({ action: 'ack-alarm', targets: ['*'], tier: 'click' });
  assert.equal(ack.mode, 'none', 'ack-alarm on * stays click (§2)');
});

test('confirmAction resolves without a dialog for click, and the typed dialog gates the verb', async () => {
  const prev = globalThis.document;
  globalThis.document = fakeDom();
  try {
    assert.deepEqual(await K.confirmAction({ action: 'send-text', targets: ['builder-a/auth'], tier: 'click' }), { ok: true, confirm: 'auth' });
    assert.equal(document.body.querySelectorAll('dialog').length, 0);

    const p = K.confirmAction({ action: 'kill', targets: [{ label: 'B1/auth', confirm: 'auth' }], consequence: ['<b>ends the session</b>'] });
    const dlg = document.body.querySelector('dialog');
    assert.equal(dlg.className, 'cfm');
    assert.equal(dlg.getAttribute('role'), 'alertdialog');
    assert.equal(dlg.open, true);
    assert.ok(dlg.getAttribute('aria-describedby'));
    assert.equal(dlg.querySelector('li').textContent, '<b>ends the session</b>', 'consequence is text');
    assert.equal(dlg.querySelector('span.plate').textContent, 'B1/auth', 'targets as plates');
    const input = dlg.querySelector('input');
    const [cancel, ok] = dlg.querySelectorAll('button');
    assert.match(ok.className, /btn--danger/);
    assert.equal(document.activeElement, input);
    assert.equal(ok.disabled, true);
    input.value = 'KILL b1/auth';
    input.dispatch('input');
    assert.equal(ok.disabled, true);
    ok.dispatch('click');
    input.value = 'KILL B1/auth';
    input.dispatch('input');
    assert.equal(ok.disabled, false);
    ok.dispatch('click');
    assert.deepEqual(await p, { ok: true, confirm: 'auth' });
    assert.equal(document.body.querySelectorAll('dialog').length, 0, 'removed after use');
    assert.ok(cancel);

    const q = K.confirmAction({ action: 'spawn', targets: ['builder-a/x'], tier: 'ask' });
    const d2 = document.body.querySelector('dialog');
    assert.equal(d2.querySelector('input'), null, 'ask has no input');
    const [c2] = d2.querySelectorAll('button');
    assert.equal(document.activeElement, c2, 'ask focuses Cancel');
    d2.dispatch('cancel');
    assert.deepEqual(await q, { ok: false, confirm: null });

    const r = K.confirmAction({ action: 'broadcast', targets: ['builder-a/a', 'builder-b/b'] });
    const d3 = document.body.querySelector('dialog');
    const in3 = d3.querySelector('input');
    in3.value = 'BROADCAST 2';
    in3.dispatch('input');
    in3.dispatch('keydown', { key: 'Enter' });
    assert.deepEqual(await r, { ok: true, confirm: null, confirmCount: 2, confirms: ['a', 'b'] });
  } finally {
    globalThis.document = prev;
  }
});

test('confirmAction takes the tier from the live table (tierOf) when none is given', async () => {
  const prev = globalThis.document;
  globalThis.document = fakeDom();
  try {
    // ACTION_TIERS.interrupt is click: no dialog.
    const res = await K.confirmAction({ action: 'interrupt', targets: ['builder-a/auth'] });
    assert.deepEqual(res, { ok: true, confirm: 'auth' });
  } finally {
    globalThis.document = prev;
  }
});

// --- static checks ------------------------------------------------------------------------------

test('the kit modules are pure at import time and build no markup from strings', () => {
  for (const f of ['components.js', 'spark.js', 'toast.js', 'confirm.js']) {
    const src = read(`public/js/ui/${f}`);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style/.test(src), `${f}: no markup sinks`);
    assert.ok(!/requestAnimationFrame/.test(src), `${f}: no rAF in ui/ (guardrail 6)`);
  }
  assert.match(read('public/js/ui/spark.js'), /createElementNS/, 'the sparkline is real SVG nodes');
});

test('components.css styles every component of the kit', () => {
  const css = read('public/css/components.css');
  for (const sel of ['.lamp', '.lamp[data-p="1"]', '.lamp[data-p="2"]', '.lamp[data-p="3"]', '.lamp[data-p="stale"]',
    '.plate', '.plate--solid', '.sel::after', '.panel', '.panel-t', '.segbar', '.spark', '.dt', '.chip', '.btn',
    '.toasts', '.toast', '.cfm', '[data-unack]']) {
    assert.ok(css.includes(sel), `components.css has ${sel}`);
  }
  assert.match(css, /clip-path:\s*polygon\(50% 0, 100% 100%, 0 100%\)/, 'p2 is a triangle');
  assert.match(css, /rotate\(45deg\)/, 'p3 is a diamond');
  assert.match(css, /var\(--bracket-img\)/);
  assert.match(css, /top:\s*-0\.65em/, 'the panel title sits on the border');
});

test('public/dev/kit.html shows every component in both themes, with no script and no network', () => {
  const html = read('public/dev/kit.html');
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.ok(!/<script/i.test(html), 'static: no script (CSP script-src self, and no data)');
  assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'no network');
  for (const sheet of ['tokens.css', 'base.css', 'components.css']) assert.match(html, new RegExp(`href="\\.\\./css/${sheet}"`));
  assert.ok(html.includes('data-theme="dark"') && html.includes('data-theme="light"'));
  for (const theme of ['dark', 'light']) {
    const start = html.indexOf(`data-theme="${theme}"`);
    const part = html.slice(start);
    for (const p of ['1', '2', '3', 'ok', 'run', 'off', 'stale']) assert.ok(part.includes(`class="lamp" data-p="${p}"`), `${theme}: lamp ${p}`);
    for (const cls of ['class="panel"', 'class="segbar"', 'class="spark"', 'class="plate', 'sel', 'class="toast"', 'class="cfm', 'class="dt"', 'class="chip"', 'data-unack']) {
      assert.ok(part.includes(cls), `${theme}: ${cls}`);
    }
  }
  assert.match(html, /LANES<\/span><span class="panel-scope">· ALL<\/span><span class="panel-n">\[42\]/);
});
