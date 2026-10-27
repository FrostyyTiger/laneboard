// The focus a prompt carries (cockpit spec c3-see.md §8.1, protocols.md §3.1):
// public/js/cockpit/focus.js, checked against the room's own message check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { focusNow, routeOfHash } from '../public/js/cockpit/focus.js';
import { checkMessage } from '../server/cockpit/protocol.mjs';

const docWith = (dataset) => ({ documentElement: { dataset } });
const prompt = (focus) => ({
  type: 'prompt', seq: 1, clientId: 'p-3c1e0b2a', text: 'how did the night go?', source: 'typed',
  lang: null, about: null, sentAt: 1793080924120, focus,
});
const ok = (focus) => checkMessage(prompt(focus), 'in', { maxPromptChars: 8000, languages: ['en'] });

test('routeOfHash: the router grammar, defaults left out', () => {
  assert.deepEqual(routeOfHash(''), { view: 'map' });
  assert.deepEqual(routeOfHash('#/'), { view: 'map' });
  assert.deepEqual(routeOfHash('#/map?sel=node%3Aroom-b'), { view: 'map', sel: 'node:room-b' });
  assert.deepEqual(routeOfHash('#/board?b=all&s=working&q=auth'), { view: 'board', s: 'working', q: 'auth' });
  assert.deepEqual(routeOfHash('#/board?b=builder-a&open=term&sel=builder-a%2Fauth'), { view: 'board', b: 'builder-a', open: 'term', sel: 'builder-a/auth' });
  assert.deepEqual(routeOfHash('#/runs/acme-billing'), { view: 'runs', run: 'acme-billing' });
  assert.deepEqual(routeOfHash('#/board?open=shell'), { view: 'board' }, 'an open the router does not know is left out');
});

test('a key over the room\'s limit or with a control character is left out, so the prompt is never refused for it', () => {
  const r = routeOfHash(`#/board?q=${'x'.repeat(201)}&s=a%0Ab`);
  assert.deepEqual(r, { view: 'board' });
  assert.deepEqual(routeOfHash(`#/${'v'.repeat(40)}`), { view: 'map' });
});

test('the app\'s focus passes the room\'s check', () => {
  const f = focusNow({ page: 'app', doc: docWith({ pane: 'open' }), loc: { hash: '#/map?sel=node%3Aroom-b' } });
  assert.deepEqual(f, { page: 'app', route: { view: 'map', sel: 'node:room-b' }, wallState: null, layout: null, pane: 'open', inSight: [] });
  assert.equal(ok(f).ok, true, JSON.stringify(ok(f)));
});

test('the Wall page\'s focus: view wall, the Wall\'s state and the layout, and it passes', () => {
  const f = focusNow({ page: 'wall', doc: docWith({ pane: 'open', wallState: 'tour', cockpitLayout: 'wall' }), loc: { hash: '' } });
  assert.deepEqual(f, { page: 'wall', route: { view: 'wall' }, wallState: 'tour', layout: 'wall', pane: 'open', inSight: [] });
  assert.equal(ok(f).ok, true);
  const odd = focusNow({ page: 'wall', doc: docWith({ wallState: 'weird' }), loc: { hash: '' } });
  assert.equal(odd.wallState, null);
  assert.equal(odd.pane, 'closed');
  assert.equal(ok(odd).ok, true);
});

test('every long route the page could hold still passes', () => {
  for (const hash of [`#/board?q=${'q'.repeat(200)}`, `#/map?sel=node%3A${'n'.repeat(295)}`, `#/runs?run=${'r'.repeat(64)}`]) {
    const f = focusNow({ page: 'app', doc: docWith({ pane: 'open' }), loc: { hash } });
    assert.equal(ok(f).ok, true, `${hash.slice(0, 40)}: ${JSON.stringify(ok(f))}`);
  }
});
