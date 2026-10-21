// Find (T11): ⌘K reaches Map nodes, services and ports. palette.js nodeItems
// turns the last Map model into NODE rows (one per machine, one per service,
// their ports in the sub text); a row moves to the Map with `sel=node:<id>`,
// which the router keeps, the Map resolves and the inspector leaves alone.
import test from 'node:test';
import assert from 'node:assert/strict';

const { nodeItems, paletteItems, paletteRows } = await import('../public/js/ui/palette.js');
const { parsePrefix } = await import('../public/js/ui/fuzzy.js');
const { parseHash, formatHash, isNodeSel } = await import('../public/js/core/router.js');
const { idForSel, byIdOf } = await import('../public/js/views/map/model.js');
const { selTarget } = await import('../public/js/ui/inspector.js');

const MODEL = {
  nodes: [
    { id: '__core', kind: 'core', label: 'hub', status: 'ok' },
    { id: 'lab', parent: '__core', kind: 'site', label: 'hv1', status: 'ok', sub: 'a hypervisor' },
    { id: 'db', parent: 'lab', kind: 'room', label: 'db', status: 'ok' },
    { id: 'db-pg', parent: 'db', kind: 'service', label: 'postgres', status: 'ok', ports: [5432] },
    { id: 'db-redis', parent: 'db', kind: 'service', label: 'redis', status: 'ok', ports: ['tcp:6379'] },
    { id: 'web', parent: 'lab', kind: 'room', label: 'web', status: 'ok', href: 'https://web.example.invalid:8443/' },
    { id: 'pgadmin', parent: 'lab', kind: 'room', label: 'pg-tools', status: 'ok' },
    { id: 'builder:builder-a', parent: 'db', kind: 'builder', builder: 'builder-a', label: 'BA', status: 'ok' },
    { id: 'lane:builder-a/x', parent: 'builder:builder-a', kind: 'lane', builder: 'builder-a', label: 'x', status: 'idle' },
  ],
  reach: { links: [{ from: 'web', to: 'db', ports: ['tcp:22'] }] },
};

const STORE = { lanes: [], sessions: new Map(), builders: new Map(), packages: null };

test('nodeItems: one NODE row per machine and service, builders and lanes left to their own types', () => {
  const items = nodeItems(MODEL);
  assert.deepEqual(items.map((it) => it.id), ['node:__core', 'node:lab', 'node:db', 'node:db-pg', 'node:db-redis', 'node:web', 'node:pgadmin']);
  assert.ok(items.every((it) => it.type === 'NODE'));
  const by = Object.fromEntries(items.map((it) => [it.id, it]));
  assert.equal(by['node:db-pg'].label, 'postgres');
  assert.equal(by['node:db-pg'].sub, ':5432 on hv1/db', 'the service row says its port and where it runs');
  assert.equal(by['node:db-redis'].sub, ':6379 on hv1/db', '"tcp:6379" is port 6379');
  assert.equal(by['node:db'].sub, 'room · hv1 · :22', 'a Reach link into the node names its port');
  assert.equal(by['node:web'].sub, 'room · hv1 · :8443', 'the port in the href');
  assert.equal(by['node:lab'].sub, 'site · a hypervisor', 'the core is not part of the path');
});

test('"postgres" ranks the node that runs it first; ":5432" finds it', () => {
  const items = nodeItems(MODEL);
  const top = paletteRows(items, 'postgres')[0];
  assert.equal(top.id, 'node:db-pg');
  assert.match(top.sub, /hv1\/db/);
  const port = paletteRows(items, ':5432');
  assert.equal(port[0].id, 'node:db-pg');
  assert.ok(!port.some((it) => it.id === 'node:db-redis'), 'another port does not match');
  assert.equal(paletteRows(items, ':22')[0].id, 'node:db');
  assert.deepEqual(parsePrefix('n: db'), { type: 'NODE', text: 'db' });
  assert.ok(paletteRows(items, 'node:').every((it) => it.type === 'NODE'));
});

test('choosing a row moves to the Map with sel=node:<id>', () => {
  const went = [];
  const items = nodeItems(MODEL, { go: (sel) => went.push(sel) });
  items.find((it) => it.id === 'node:db-pg').run();
  assert.deepEqual(went, ['node:db-pg']);
  // The router keeps it, the Map resolves it, the inspector opens no lane panel for it.
  const hash = formatHash({ view: 'map', sel: 'node:db-pg' });
  assert.equal(parseHash(hash).sel, 'node:db-pg');
  assert.equal(parseHash('#/map?sel=node%3Afeed%3Ahv1%2F106').sel, 'node:feed:hv1/106', 'a discovered node id survives');
  assert.equal(parseHash('#/map?sel=node%3A').sel, null);
  assert.equal(parseHash('#/map?sel=node%3Aa%0Ab').sel, null, 'no control characters');
  assert.equal(isNodeSel(`node:${'x'.repeat(400)}`), false, 'capped');
  assert.equal(idForSel('node:db-pg', byIdOf(MODEL.nodes)), 'db-pg');
  assert.equal(idForSel('node:gone', byIdOf(MODEL.nodes)), null);
  assert.equal(selTarget('node:db-pg'), null);
});

test('no Map model: no NODE rows', () => {
  assert.deepEqual(nodeItems(null), []);
  assert.deepEqual(nodeItems({}), []);
  assert.deepEqual(nodeItems({ nodes: 'x' }), []);
  const items = paletteItems({ store: STORE, view: 'board' });
  assert.ok(!items.some((it) => it.type === 'NODE'));
  const withMap = paletteItems({ store: { ...STORE, map: MODEL }, view: 'board' });
  assert.equal(withMap.filter((it) => it.type === 'NODE').length, 7);
});

test('a palette row keeps its label when the sub line is long (the sub ellipsizes)', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/css/palette.css', import.meta.url), 'utf8');
  const cols = /\.pal-o\s*\{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)?.[1] ?? '';
  const parts = cols.match(/minmax\([^)]*\)|\S+/g);
  assert.match(parts[1], /^minmax\(\d+(\.\d+)?em, max-content\)$/, 'the label column has a floor');
  assert.equal(parts[2], 'minmax(0, 1fr)', 'the sub column takes what is left');
});

// T52 (runs n5, n3 T49): no trailing `—` cell, one kind marker, the match marked,
// the meta on a second line at 390.
const { rowModel, markPieces } = await import('../public/js/ui/palette.js');
const { fuzzyRanges, fuzzyScore } = await import('../public/js/ui/fuzzy.js');

test('T52 fuzzyRanges: the best alignment as merged ranges, the same nulls as fuzzyScore', () => {
  assert.deepEqual(fuzzyRanges('pos', 'postgres'), [[0, 3]]);
  assert.deepEqual(fuzzyRanges(':5432', ':5432 on hv1/db'), [[0, 5]]);
  assert.deepEqual(fuzzyRanges('pg', 'pg-tools'), [[0, 2]]);
  assert.deepEqual(fuzzyRanges('dt', 'db-tools'), [[0, 1], [3, 4]], 'word starts win over the nearest letter');
  assert.deepEqual(fuzzyRanges('', 'x'), []);
  assert.equal(fuzzyRanges('zz', 'postgres'), null);
  assert.equal(fuzzyRanges('longer', 'ab'), null);
  for (const [q, s] of [['pos', 'postgres'], ['dt', 'db-tools'], ['hv', 'site · hv1'], ['zz', 'ab']]) {
    assert.equal(fuzzyRanges(q, s) === null, fuzzyScore(q, s) === null, `${q} in ${s}`);
  }
});

test('T52 rowModel: no empty trailing cell, one kind marker, the mark where the row matched', () => {
  const items = nodeItems(MODEL);
  for (const it of items) {
    const m = rowModel(it, 'n:');
    assert.equal(m.hint, null, 'a NODE row has no hint, so no kbd cell (the old trailing `—`)');
    assert.ok(m.sub === null || m.sub.map((p) => p.text).join('').trim() !== '', 'no empty sub cell');
    assert.equal(m.icon, 'map', 'the icon is the one kind marker');
    assert.ok(!('plate' in m) && !('chip' in m), 'no second chip');
  }
  const pg = rowModel(items.find((it) => it.id === 'node:db-pg'), 'postgres');
  assert.deepEqual(pg.label, [{ text: 'postgres', hit: true }]);
  assert.deepEqual(pg.sub, [{ text: ':5432 on hv1/db', hit: false }], 'the label matched, so the sub is plain');
  const port = rowModel(items.find((it) => it.id === 'node:db-pg'), ':5432');
  assert.deepEqual(port.label, [{ text: 'postgres', hit: false }]);
  assert.deepEqual(port.sub, [{ text: ':5432', hit: true }, { text: ' on hv1/db', hit: false }], 'the port is marked in the meta');
  const pre = rowModel(items.find((it) => it.id === 'node:db'), 'n: db');
  assert.deepEqual(pre.label, [{ text: 'db', hit: true }], 'the prefix is not part of the match');
  assert.equal(rowModel({ type: 'ACT', label: 'Go', sub: '', hint: 'g b' }, '').sub, null, 'an empty sub is no cell');
  assert.equal(rowModel({ type: 'ACT', label: 'Go', hint: 'g b' }, '').hint, 'g b');
  assert.deepEqual(markPieces('abc', [[1, 2], [5, 9]]), [{ text: 'a', hit: false }, { text: 'b', hit: true }, { text: 'c', hit: false }], 'an out-of-range range is ignored');
  assert.deepEqual(markPieces('', null), [{ text: '', hit: false }]);
});

test('T52 the palette DOM: icon, label, sub and a hint only when there is one, marks as <mark>', async () => {
  const { makeDocument } = await import('./helpers/fakedom.mjs');
  const doc = makeDocument();
  const mk = doc.createElement;
  doc.createElement = (t) => {
    const el = mk(t);
    el.hasAttribute = (n) => Object.hasOwn(el.attrs, n);
    el.removeAttribute = (n) => { delete el.attrs[n]; };
    return el;
  };
  const saved = { document: globalThis.document, localStorage: globalThis.localStorage };
  const mem = new Map();
  globalThis.document = doc;
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  try {
    const pal = await import('../public/js/ui/palette.js');
    pal.openPalette({ preset: ':5432', ctx: { store: { ...STORE, map: MODEL }, view: 'map', route: { sel: null } } });
    const dlg = doc.body.children.find((c) => c.className === 'pal');
    const rows = dlg.children[1].children;
    assert.equal(rows[0].dataset.type, 'NODE');
    const cls = rows[0].children.map((c) => c.className);
    assert.deepEqual(cls, ['i i-s pal-i', 'pal-l', 'pal-s'], 'no type chip, no empty kbd at the end');
    const sub = rows[0].children[2];
    const marks = sub.children.filter((c) => c.tagName === 'MARK');
    assert.deepEqual(marks.map((c) => c.textContent), [':5432']);
    assert.equal(sub.textContent, ':5432 on hv1/db');
    pal.closePalette();
  } finally {
    globalThis.document = saved.document;
    globalThis.localStorage = saved.localStorage;
  }
});

test('T52 at 390 the meta is a second line under the name', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../public/css/palette.css', import.meta.url), 'utf8');
  const phone = /@media \(max-width: 699px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(phone, /grid-template-areas:\s*"i l k"\s*"i s k"/);
  assert.match(css, /\.pal-m\s*\{[^}]*font-weight/, 'the match is marked');
});
