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
  assert.match(parts[2], /^minmax\(\d+(\.\d+)?em, max-content\)$/, 'the label column has a floor');
  assert.equal(parts[3], 'minmax(0, 1fr)', 'the sub column takes what is left');
});
