// The 2D fallback (Wall plan night 2 T7, README §5 "Fallback"): islands with
// trouble as filled hex tiles (variants/tiles.js, variants/islands-tiles.js),
// links only on the held site (`focusLinks`), and the galaxy sending a
// browser without WebGL there (galaxy/fallback.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withTiles, troublePlaces, focusLinks, siteOf, TILE } from '../public/js/wall/variants/tiles.js';
import * as islandsTiles from '../public/js/wall/variants/islands-tiles.js';
import * as islands from '../public/js/wall/variants/islands.js';
import { hexCorners } from '../public/js/wall/variants/mosaic.js';
import { demoAsked, fallbackHref, hasWebGL, FALLBACK_VARIANT } from '../public/js/wall/galaxy/fallback.js';

/** Two sites, rooms with services, a builder with a lane: all calm unless `status` says otherwise. */
function fleet(status = {}) {
  const nodes = [{ id: '__core', kind: 'core', label: 'acme', status: 'ok' }];
  for (const site of ['hv1', 'hv2']) {
    nodes.push({ id: site, kind: 'site', parent: '__core', label: site, status: 'ok' });
    for (let i = 0; i < 3; i++) {
      const room = `${site}/room-${i}`;
      nodes.push({ id: room, kind: 'room', parent: site, label: `room-${i}`, status: 'ok' });
      nodes.push({ id: `${room}/svc`, kind: 'service', parent: room, label: 'svc', status: 'ok' });
    }
  }
  nodes.push({ id: 'builder:builder-a', kind: 'builder', parent: 'hv1/room-0', label: 'builder-a', status: 'working' });
  nodes.push({ id: 'lane:a/0', kind: 'lane', parent: 'builder:builder-a', label: 'lane-0', status: 'working' });
  for (const n of nodes) if (status[n.id]) n.status = status[n.id];
  return nodes;
}

const tilesOf = (out) => out.guides.filter((g) => Array.isArray(g.pts));
const layoutOf = () => islandsTiles.optionsFor(islandsTiles.ASPECT).layout;

test('a calm fleet gets no tiles, only the islands\' coastlines', () => {
  const nodes = fleet();
  assert.equal(troublePlaces(nodes).size, 0);
  const out = layoutOf()(nodes);
  const base = islands.optionsFor(islands.ASPECT).layout(nodes);
  assert.equal(tilesOf(out).length, 0);
  assert.equal(out.guides.length, base.guides.length, 'the coastlines stay');
});

test('a warn or crit place gets a hex tile in its tone round its mark', () => {
  const nodes = fleet({ 'hv1/room-1': 'crit', 'hv2/room-2': 'warn' });
  const out = layoutOf()(nodes);
  const tiles = tilesOf(out);
  assert.equal(tiles.length, 2);
  const crit = tiles.find((t) => t.tone === 'crit');
  const warn = tiles.find((t) => t.tone === 'warn');
  const p = out.pos.get('hv1/room-1');
  assert.deepEqual(crit.pts, hexCorners(p.x, p.y + TILE.dy, TILE.r));
  const q = out.pos.get('hv2/room-2');
  assert.deepEqual(warn.pts, hexCorners(q.x, q.y + TILE.dy, TILE.r));
});

test('trouble under an unnamed node counts for its nearest named place, the worst tone wins', () => {
  // A service is not named: its room gets the tile. A lane counts for its builder.
  const nodes = fleet({ 'hv2/room-0/svc': 'down', 'lane:a/0': 'attention', 'hv1/room-2': 'warn', 'hv1/room-2/svc': 'crit' });
  const worst = troublePlaces(nodes);
  assert.equal(worst.get('hv2/room-0'), 'crit');
  assert.equal(worst.get('builder:builder-a'), 'warn');
  assert.equal(worst.get('hv1/room-2'), 'crit', 'crit beats warn');
  assert.equal(worst.has('hv2/room-0/svc'), false);
  assert.equal(worst.has('lane:a/0'), false);
  // `low` is not trouble enough for a tile.
  assert.equal(troublePlaces(fleet({ 'hv1/room-1': 'low' })).size, 0);
});

test('the tiles follow the status: same guides while nothing changes, new ones on a change', () => {
  const layout = layoutOf();
  const a = layout(fleet({ 'hv1/room-1': 'crit' }));
  const b = layout(fleet({ 'hv1/room-1': 'crit' }));
  assert.equal(a.guides, b.guides, 'no new guides for the same tones');
  const c = layout(fleet());
  assert.notEqual(c.guides, a.guides);
  assert.equal(tilesOf(c).length, 0, 'cleared trouble takes its tile away');
});

test('withTiles keeps the base module\'s ambient and labels, names the sun when asked', () => {
  assert.equal(islandsTiles.ambient, islands.ambient);
  assert.equal(islandsTiles.links, 'focus');
  assert.equal(typeof islandsTiles.mapOptions.layout, 'function');
  const sun = withTiles(islands, { sunName: 40 }).optionsFor(islands.ASPECT);
  assert.equal(sun.labelSize({ id: '__core', kind: 'core' }, {}), 40);
  const plain = islands.optionsFor(islands.ASPECT).labelSize({ id: 'hv1', kind: 'site' }, {});
  assert.deepEqual(sun.labelSize({ id: 'hv1', kind: 'site' }, {}), plain);
});

test('focusLinks: no links at the overview, only the held site\'s while it is held', () => {
  const nodes = fleet();
  nodes.push({ id: 'lab', kind: 'host', parent: '__core', label: 'lab', status: 'ok' });
  nodes.push({ id: 'lab/vm', kind: 'room', parent: 'lab', label: 'vm', status: 'ok' });
  const links = [
    { from: 'builder:builder-a', to: 'hv2/room-1', kind: 'deploys' },
    { from: 'hv2/room-0', to: 'lab/vm', kind: 'clones' },
    { from: 'hv1/room-2', to: 'hv1/room-1', kind: 'deploys' },
  ];
  const model = { nodes, links, events: [] };
  assert.deepEqual(focusLinks(model, null).links, []);
  assert.deepEqual(focusLinks(model, 'hv1').links, [links[0], links[2]]);
  assert.deepEqual(focusLinks(model, 'hv2').links, [links[0], links[1]]);
  assert.deepEqual(focusLinks(model, 'lab').links, [links[1]]);
  assert.deepEqual(focusLinks(model, 'nowhere').links, []);
  assert.equal(focusLinks(model, 'hv1').nodes, nodes, 'the nodes are untouched');
  assert.deepEqual(model.links, links, 'the model is not changed');
  assert.equal(focusLinks(null, 'hv1'), null);
  assert.deepEqual(focusLinks({ nodes }, 'hv1').links, []);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(siteOf('lane:a/0', byId), 'hv1');
  assert.equal(siteOf('__core', byId), null);
  assert.equal(siteOf('ghost', byId), null);
});

test('the galaxy sends a browser without WebGL to the 2D fallback, the demo speed along', () => {
  assert.equal(FALLBACK_VARIANT, 'islands-tiles');
  assert.equal(fallbackHref(''), 'wall.html?variant=islands-tiles');
  assert.equal(fallbackHref('?demo=1&at=hv1&fx=beacon'), 'wall.html?variant=islands-tiles&demo=1');
  assert.equal(fallbackHref('?demo'), 'wall.html?variant=islands-tiles&demo=1');
  assert.equal(fallbackHref('?demo=0'), 'wall.html?variant=islands-tiles', '?demo=0 is off, as on wall.html');
  const main = readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(main, /location\.replace\(fallbackHref\(location\.search\)\)/);
  assert.match(main, /hasWebGL\(/);
});

test('demoAsked: ?demo, ?demo=1 or any value but 0/false/no/off, as wall.html reads it', () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal(demoAsked(q('')), false);
  assert.equal(demoAsked(q('demo')), true);
  assert.equal(demoAsked(q('demo=1')), true);
  assert.equal(demoAsked(q('demo=yes')), true);
  for (const off of ['0', 'false', 'No', ' off ']) assert.equal(demoAsked(q(`demo=${off}`)), false, off);
  const main = readFileSync(new URL('../public/js/wall/galaxy/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(demoAsked\(q\)\) page\.dataset\.demo = '1';/);
});

test('hasWebGL: a context means yes (and is given back), none or a throw means no', () => {
  let lost = 0;
  const gl = { getExtension: (n) => (n === 'WEBGL_lose_context' ? { loseContext: () => { lost++; } } : null) };
  assert.equal(hasWebGL(() => ({ getContext: (k) => (k === 'webgl2' ? gl : null) })), true);
  assert.equal(lost, 1);
  assert.equal(hasWebGL(() => ({ getContext: (k) => (k === 'webgl' ? {} : null) })), true, 'webgl1 is enough');
  assert.equal(hasWebGL(() => ({ getContext: () => null })), false);
  assert.equal(hasWebGL(() => { throw new Error('no canvas'); }), false);
});
