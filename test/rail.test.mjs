// The builder rail (fleet plan §4 2.4, task D5): the pure row model (ALL row,
// per-builder lamp, code, lane count, mix), the rail order and the hotkey
// helpers, the collapse state, the DOM builder against a tiny fake document,
// and static checks over public/css/rail.css and public/js/ui/rail.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const R = await import('../public/js/ui/rail.js');
const { createStore, applyBuilders, applySnapshot, ingest, setSourceKind } = await import('../public/js/core/store.js');

// --- fixtures ----------------------------------------------------------------------

/** A hub store: builder-a live (3 lanes), builder-b down, builder-c stale. */
function fleet({ alarms = [] } = {}) {
  const s = createStore();
  setSourceKind(s, 'hub');
  applyBuilders(s, [
    { id: 'builder-a', code: 'b1', state: 'up' },
    { id: 'builder-b', code: 'B2', state: 'down' },
    { id: 'builder-c', state: 'stale' },
  ]);
  applySnapshot(s, 'builder-a', {
    sessions: [
      { name: 'auth', state: 'waiting_permission' },
      { name: 'api', state: 'working' },
      { name: 'docs', state: 'idle' },
    ],
  });
  applySnapshot(s, 'builder-b', { sessions: [{ name: 'web', state: 'working' }] });
  if (alarms.length) ingest(s, { type: 'alarms', alarms });
  return s;
}

// --- a minimal DOM, enough for buildRail ---------------------------------------------

function fakeDom() {
  const doc = { activeElement: null };
  function node(tag, ns = null) {
    const n = {
      tagName: String(tag).toUpperCase(), localName: tag, namespaceURI: ns, nodeType: 1,
      attributes: new Map(), children: [], parentNode: null, style: {}, dataset: {},
      listeners: {}, _text: '', hidden: false, className: '', title: '', tabIndex: 0, type: '',
    };
    n.classList = {
      add: (...c) => { const s = new Set(n.className.split(' ').filter(Boolean)); c.forEach((x) => s.add(x)); n.className = [...s].join(' '); },
      remove: (...c) => { n.className = n.className.split(' ').filter((x) => x && !c.includes(x)).join(' '); },
      contains: (c) => n.className.split(' ').includes(c),
      toggle: (c, on) => { const want = on ?? !n.classList.contains(c); if (want) n.classList.add(c); else n.classList.remove(c); return want; },
    };
    n.setAttribute = (k, v) => { n.attributes.set(k, String(v)); if (k === 'class') n.className = String(v); };
    n.getAttribute = (k) => (k === 'class' ? n.className : (n.attributes.has(k) ? n.attributes.get(k) : null));
    n.appendChild = (c) => { c.parentNode = n; n.children.push(c); return c; };
    n.append = (...cs) => { for (const c of cs) n.appendChild(c); };
    n.addEventListener = (t, fn) => { (n.listeners[t] ||= []).push(fn); };
    n.dispatch = (t, e = {}) => {
      const ev = { type: t, target: n, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { ev.stopped = true; }, ...e };
      for (let cur = n; cur; cur = cur.parentNode) for (const fn of cur.listeners[t] || []) fn(ev);
      return ev;
    };
    n.focus = () => { doc.activeElement = n; };
    n.all = (pred, out = []) => { for (const c of n.children) { if (pred(c)) out.push(c); c.all(pred, out); } return out; };
    n.find = (cls) => n.all((c) => c.classList.contains(cls));
    Object.defineProperty(n, 'textContent', {
      get: () => n._text + n.children.map((c) => c.textContent).join(''),
      set: (v) => { n.children = []; n._text = String(v); },
    });
    return n;
  }
  doc.createElement = (t) => node(t, 'http://www.w3.org/1999/xhtml');
  doc.createElementNS = (ns, t) => node(t, ns);
  return doc;
}

function withDom(fn) {
  const prev = globalThis.document;
  globalThis.document = fakeDom();
  try { return fn(globalThis.document); } finally { globalThis.document = prev; }
}

// --- the row model -------------------------------------------------------------------

test('railRows: ALL first with the fleet totals, then one row per builder in id order', () => {
  const rows = R.railRows(fleet(), { b: null });
  assert.deepEqual(rows.map((r) => r.id), ['all', 'builder-a', 'builder-b', 'builder-c']);
  const [all, a, b, c] = rows;
  assert.equal(all.code, 'ALL');
  assert.equal(all.n, 4, 'ALL counts every builder\'s lanes');
  assert.equal(all.mix.total, 4);
  assert.equal(all.mix.p1, 1);
  assert.equal(a.n, 3);
  assert.deepEqual([a.mix.p1, a.mix.run, a.mix.off], [1, 1, 1]);
  assert.equal(b.n, 1);
  assert.equal(b.mix.dead, 1, 'a down builder\'s lanes are drawn as dead (hatched)');
  assert.equal(c.n, 0);
  assert.equal(all.selected, true, 'no b= selects ALL');
  assert.ok(rows.slice(1).every((r) => !r.selected));
});

test('railRows: b=<id> selects that row only; b=all selects ALL', () => {
  const s = fleet();
  const rows = R.railRows(s, { b: 'builder-b' });
  assert.deepEqual(rows.filter((r) => r.selected).map((r) => r.id), ['builder-b']);
  assert.deepEqual(R.railRows(s, { b: 'all' }).filter((r) => r.selected).map((r) => r.id), ['all']);
  assert.deepEqual(R.railRows(s, { b: 'nope' }).filter((r) => r.selected).map((r) => r.id), [], 'an unknown builder selects nothing');
});

test('codes: the row code is upper case and short, derived from the id when absent', () => {
  const [, a, b, c] = R.railRows(fleet(), {});
  assert.equal(a.code, 'B1');
  assert.equal(b.code, 'B2');
  assert.equal(c.code, 'BC', 'deriveCode(builder-c)');
  assert.equal(R.codeText('abcdefghij', 'x'), 'ABCDEF');
  assert.equal(R.codeText('a\u0000b\nc', 'x'), 'ABC', 'control characters are dropped');
  assert.equal(R.codeText('', 'builder-a'), 'BA');
  assert.equal(R.codeText('   ', 'builder-a'), 'BA');
});

test('lamp: down -> p1, stale -> p3, both hatched; live with no alarm -> working/ok', () => {
  const [all, a, b, c] = R.railRows(fleet(), {});
  assert.equal(b.p, '1');
  assert.equal(b.hatched, true);
  assert.equal(b.status, 'down');
  assert.equal(c.p, '3');
  assert.equal(c.hatched, true);
  assert.equal(c.status, 'stale');
  assert.equal(a.p, 'run', 'a live builder with a working lane and no alarm is grey "working"');
  assert.equal(a.hatched, false);
  assert.equal(all.p, '1', 'ALL takes the worst row');
  assert.equal(R.builderLamp({ id: 'x', status: 'live' }, [], { run: 0 }).p, 'ok');
  assert.equal(R.builderLamp({ id: 'x', status: 'connecting' }, []).p, 'off');
  assert.equal(R.builderLamp(null).p, 'off');
});

test('lamp: the worst alarm of that builder, unack while one at that priority is open', () => {
  const alarms = [
    { id: '1', kind: 'stuck', priority: 'P3', builder: 'builder-a', acked: false },
    { id: '2', kind: 'approval', priority: 'P2', builder: 'builder-a', acked: true },
    { id: '3', kind: 'needs-input', priority: 'P1', builder: 'builder-z', acked: false },
  ];
  const lp = R.builderLamp({ id: 'builder-a', status: 'live' }, alarms);
  assert.equal(lp.p, '2');
  assert.equal(lp.unack, false, 'the P2 is acked; the open P3 does not flash a P2 lamp');
  assert.equal(lp.n, 2, 'other builders\' alarms do not count');
  assert.match(lp.label, /2 alarms/);
  const open = R.builderLamp({ id: 'builder-a', status: 'live' }, [...alarms, { id: '4', priority: 'P2', builder: 'builder-a' }]);
  assert.equal(open.unack, true);
  assert.equal(R.builderLamp({ id: 'builder-a', status: 'live' }, [{ priority: 'P4', builder: 'builder-a' }]).p, '3', 'P4 -> 3');
  assert.equal(R.builderLamp({ id: 'builder-a', status: 'live' }, [{ priority: '<b>', builder: 'builder-a' }]).p, 'ok', 'junk priorities are ignored');
  // The health sample's own alarms count too.
  assert.equal(R.builderLamp({ id: 'h', status: 'live', health: { alarms: [{ key: 'memAvailPct', level: 'crit' }] } }, []).p, '1');
  assert.equal(R.builderLamp({ id: 'h', status: 'live', health: { alarms: [{ key: 'x', level: 'warn' }] } }, []).p, '2');
  // A down builder is p1 whatever its alarms say.
  assert.equal(R.builderLamp({ id: 'builder-a', status: 'down' }, alarms).p, '1');
});

test('railRows: alarms from the store reach the rows and the ALL row', () => {
  const s = fleet({ alarms: [{ id: '1', kind: 'approval', priority: 'P2', builder: 'builder-a', acked: false }] });
  applyBuilders(s, [{ id: 'builder-a', code: 'b1', state: 'up' }]);
  const [all, a] = R.railRows(s, {});
  assert.equal(a.p, '2');
  assert.equal(a.unack, true);
  assert.equal(all.p, '2');
  assert.equal(all.unack, true);
  assert.match(all.label, /All 1 builder/);
});

test('railRows: an empty store still has the ALL row', () => {
  const rows = R.railRows(createStore(), {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'all');
  assert.equal(rows[0].p, 'off');
  assert.equal(rows[0].n, 0);
});

test('worseP orders 1 > 2 > 3 > run > ok > off', () => {
  assert.equal(R.worseP('ok', '1'), '1');
  assert.equal(R.worseP('2', '3'), '2');
  assert.equal(R.worseP('run', 'ok'), 'run');
  assert.equal(R.worseP(null, 'off'), 'off');
  assert.equal(R.worseP('3', null), '3');
});

// --- order and hotkey helpers ----------------------------------------------------------

test('railOrder, scopeAt and stepScope: 0 = all, 1-9 = builder N, [ ] wrap', () => {
  const order = R.railOrder(fleet());
  assert.deepEqual(order, ['all', 'builder-a', 'builder-b', 'builder-c']);
  assert.equal(R.scopeAt(order, 0), 'all');
  assert.equal(R.scopeAt(order, 1), 'builder-a');
  assert.equal(R.scopeAt(order, 3), 'builder-c');
  assert.equal(R.scopeAt(order, 4), null);
  assert.equal(R.scopeAt(order, -1), null);
  assert.equal(R.scopeAt(order, 1.5), null);
  assert.equal(R.stepScope(order, 'all', 1), 'builder-a');
  assert.equal(R.stepScope(order, 'builder-c', 1), 'all', 'wraps down');
  assert.equal(R.stepScope(order, 'all', -1), 'builder-c', 'wraps up');
  assert.equal(R.stepScope(order, 'gone', 1), 'builder-a', 'an unknown scope steps from ALL');
  assert.equal(R.stepScope(order, null, -1), 'builder-c');
  assert.equal(typeof R.selectNext, 'function');
  assert.equal(typeof R.selectIndex, 'function');
  assert.equal(typeof R.toggleRail, 'function');
});

// --- collapse state --------------------------------------------------------------------

test('collapse state: localStorage lb.rail, open unless it says min', () => {
  const mem = {};
  const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } };
  assert.equal(R.RAIL_KEY, 'lb.rail');
  assert.equal(R.loadRailMode(storage), 'open');
  assert.equal(R.saveRailMode('min', storage), 'min');
  assert.equal(mem['lb.rail'], 'min');
  assert.equal(R.loadRailMode(storage), 'min');
  assert.equal(R.saveRailMode('<x>', storage), 'open');
  assert.equal(R.loadRailMode({ getItem() { throw new Error('private mode'); } }), 'open');
  assert.equal(R.saveRailMode('min', { setItem() { throw new Error('quota'); } }), 'min');
  assert.equal(R.loadRailMode(undefined), 'open');
  assert.deepEqual(R.RAIL_MODES, ['open', 'min']);
});

// --- DOM ---------------------------------------------------------------------------------

test('buildRail: a listbox of options with aria-selected, lamp, plate, count and segbar', () => withDom(() => {
  const root = R.buildRail(R.railRows(fleet(), { b: 'builder-a' }), { mode: 'open' });
  assert.equal(root.dataset.mode, 'open');
  const list = root.find('brail-list')[0];
  assert.equal(list.getAttribute('role'), 'listbox');
  assert.equal(list.getAttribute('aria-label'), 'Builders');
  const opts = list.children;
  assert.equal(opts.length, 4);
  assert.ok(opts.every((o) => o.getAttribute('role') === 'option'));
  assert.deepEqual(opts.map((o) => o.getAttribute('aria-selected')), ['false', 'true', 'false', 'false']);
  assert.deepEqual(opts.map((o) => o.tabIndex), [-1, 0, -1, -1], 'roving tabindex on the selected row');
  assert.ok(opts[1].classList.contains('sel'), 'the selected row carries the corner brackets');
  assert.deepEqual(opts.map((o) => o.dataset.b), ['all', 'builder-a', 'builder-b', 'builder-c']);
  const a = opts[1];
  assert.equal(a.find('lamp')[0].dataset.p, 'run');
  assert.equal(a.find('brail-code')[0].textContent, 'B1');
  assert.ok(a.find('brail-code')[0].classList.contains('plate'));
  assert.equal(a.find('brail-n')[0].textContent, '[3]');
  assert.ok(a.find('segbar')[0], 'segment bar');
  assert.equal(opts[0].find('brail-n')[0].textContent, '[4]', 'ALL shows the aggregate count');
  assert.ok(opts[2].classList.contains('brail-row--hatch'), 'down is hatched');
  assert.ok(opts[3].classList.contains('brail-row--hatch'), 'stale is hatched');
  assert.equal(opts[2].find('lamp')[0].dataset.p, '1');
  assert.equal(opts[3].find('lamp')[0].dataset.p, '3');
  const tog = root.find('brail-tog')[0];
  assert.equal(tog.getAttribute('aria-expanded'), 'true');
  assert.match(tog.getAttribute('aria-label'), /Collapse/);
}));

test('buildRail: collapsed mode is marked for the CSS and the toggle says expand', () => withDom(() => {
  let toggled = 0;
  const root = R.buildRail(R.railRows(fleet(), {}), { mode: 'min', onToggle: () => { toggled++; } });
  assert.equal(root.dataset.mode, 'min');
  const tog = root.find('brail-tog')[0];
  assert.equal(tog.getAttribute('aria-expanded'), 'false');
  assert.match(tog.getAttribute('aria-label'), /Expand/);
  tog.dispatch('click');
  assert.equal(toggled, 1);
  // Lamp and code are in every row; the CSS hides the rest.
  for (const o of root.find('brail-row')) {
    assert.ok(o.find('lamp')[0] && o.find('brail-code')[0]);
  }
}));

test('buildRail: click and Enter/Space select; arrows, Home, End move the focus', () => withDom((doc) => {
  const picked = [];
  const root = R.buildRail(R.railRows(fleet(), {}), { onSelect: (id) => picked.push(id) });
  const opts = root.find('brail-list')[0].children;
  opts[2].dispatch('click');
  assert.deepEqual(picked, ['builder-b']);
  let ev = opts[0].dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(ev.defaultPrevented, true);
  assert.equal(doc.activeElement, opts[1]);
  assert.deepEqual(opts.map((o) => o.tabIndex), [-1, 0, -1, -1]);
  opts[1].dispatch('keydown', { key: 'End' });
  assert.equal(doc.activeElement, opts[3]);
  opts[3].dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(doc.activeElement, opts[3], 'no wrap past the end');
  opts[3].dispatch('keydown', { key: 'Home' });
  assert.equal(doc.activeElement, opts[0]);
  opts[0].dispatch('keydown', { key: 'ArrowUp' });
  assert.equal(doc.activeElement, opts[0]);
  opts[1].dispatch('keydown', { key: 'Enter' });
  opts[3].dispatch('keydown', { key: ' ' });
  assert.deepEqual(picked, ['builder-b', 'builder-a', 'builder-c']);
  ev = opts[0].dispatch('keydown', { key: 'x' });
  assert.notEqual(ev.defaultPrevented, true, 'other keys pass through to the hotkeys');
}));

test('buildRail: builder codes and ids are text, never markup', () => withDom(() => {
  const s = createStore();
  setSourceKind(s, 'hub');
  applyBuilders(s, [{ id: 'builder-a', code: '<img src=x onerror=alert(1)>', state: 'up' }]);
  const root = R.buildRail(R.railRows(s, {}), {});
  const row = root.find('brail-row')[1];
  const code = row.find('brail-code')[0];
  assert.equal(code.textContent, '<IMG S', 'the code is plain text, cut to CODE_MAX');
  assert.equal(code.children.length, 0, 'no element was parsed out of it');
  assert.match(row.getAttribute('aria-label'), /^<IMG S builder-a,/);
}));

test('buildRail: no row selected (unknown b) still leaves one row tabbable', () => withDom(() => {
  const root = R.buildRail(R.railRows(fleet(), { b: 'gone' }), {});
  assert.deepEqual(root.find('brail-row').map((o) => o.tabIndex), [0, -1, -1, -1]);
}));

// --- static ---------------------------------------------------------------------------------

test('rail.js: textContent only, no markup sinks, no rAF, importable without a document', () => {
  const src = read('public/js/ui/rail.js');
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(src, /setAttribute\(\s*['"]style/);
  assert.doesNotMatch(src, /requestAnimationFrame/);
  assert.equal(typeof globalThis.document, 'undefined', 'the import above ran with no document');
  assert.equal(R.initRail(), false, 'no document: the rail does not arm');
});

test('rail.css: collapsed rows hide count and segbar, stale/down rows are hatched, tablet overlays', () => {
  const css = read('public/css/rail.css');
  assert.match(css, /\.brail\[data-mode="min"\] \.brail-n,\s*\.brail\[data-mode="min"\] \.brail-seg \{ display: none; \}/);
  assert.match(css, /\.brail-row--hatch \{[^}]*var\(--tex-hatch\)/);
  assert.match(css, /\.shell\[data-rail="open"\] \.shell-rail \{[^}]*width: var\(--rail-w\)/);
  assert.match(css, /\.brail-row:focus-visible \{[^}]*var\(--accent\)/);
  assert.doesNotMatch(css, /oklch\(|#[0-9a-f]{3,8}\b|rgb\(|gradient\(|box-shadow|backdrop-filter|@keyframes/i, 'rail.css keeps the guardrails');
});
