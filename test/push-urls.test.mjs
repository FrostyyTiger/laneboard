// Push deep links carry fleet keys (fleet F7): `/#/board?sel=<fkey>` for a
// session, `/#/box` for the guard. Run with LANEBOARD_DB=:memory: (npm test).
import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';

import { config } from '../server/config.mjs';
import * as db from '../server/db.mjs';
import { sessionUrl, boxUrl, onTransition, onMarker, onDanger, resetCoalescing, setQuiet } from '../server/push.mjs';
import { fkey, parseFkey } from '../server/fleet/keys.mjs';

const sent = [];
webpush.sendNotification = async (sub, body) => { sent.push(JSON.parse(body)); return {}; };
webpush.setVapidDetails = () => {}; // the test publicUrl is http, which web-push refuses as a subject
db.addSubscription({ endpoint: 'https://push.example.invalid/x', keys: { p256dh: 'p', auth: 'a' } });
setQuiet({ global: false });

function selOf(url) {
  const m = /^\/#\/board\?sel=([^&#]*)$/.exec(url);
  assert.ok(m, `not a board deep link: ${url}`);
  return decodeURIComponent(m[1]);
}

test('sessionUrl is the board with the session fkey selected', () => {
  assert.equal(sessionUrl('web', 'builder-a'), '/#/board?sel=builder-a%2Fweb');
  assert.equal(selOf(sessionUrl('web')), fkey(config.fleet.id, 'web'));
});

test('a hostile session name cannot add parameters or escape the fragment', () => {
  const name = 'x&b=evil#/box?sel=y z';
  const url = sessionUrl(name, 'builder-a');
  assert.ok(!url.slice('/#/board?sel='.length).match(/[&#?= ]/), url);
  assert.deepEqual(parseFkey(selOf(url)), { builder: 'builder-a', name });
});

test('boxUrl is the Box view, and an unusable name falls back to it', () => {
  assert.equal(boxUrl(), '/#/box');
  assert.equal(sessionUrl('', 'builder-a'), '/#/box');
  assert.equal(sessionUrl('web', 'NOT A BUILDER'), '/#/box');
});

test('a transition push links to the session by fkey', async () => {
  resetCoalescing();
  sent.length = 0;
  await onTransition({ name: 'web', from: 'working', to: 'waiting_permission', stateSince: 0, activity: {} });
  assert.equal(sent.length, 1);
  assert.equal(selOf(sent[0].url), fkey(config.fleet.id, 'web'));
});

test('a marker push links to the session by fkey', async () => {
  resetCoalescing();
  sent.length = 0;
  await onMarker({ session_name: 'lane/1', kind: 'need', text: 'NEED-HUMAN: look' });
  assert.equal(sent.length, 1);
  assert.equal(selOf(sent[0].url), fkey(config.fleet.id, 'lane/1'));
});

test('a danger push links to the session, or to the Box with no session', async () => {
  sent.length = 0;
  await onDanger({ session_name: 'api', text: 'guard' });
  await onDanger({ session_name: null, text: 'guard' });
  assert.equal(sent.length, 2);
  assert.equal(selOf(sent[0].url), fkey(config.fleet.id, 'api'));
  assert.equal(sent[1].url, '/#/box');
});
