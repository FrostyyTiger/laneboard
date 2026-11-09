// The lanes flag: config layers, the module gate, and the Inbox's lane groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, fromEnv, lanesOn } from '../server/config/lanes.mjs';
import { buildInbox, LANE_GROUPS } from '../public/js/core/inbox-model.js';
import features from '../server/routes/features.mjs';
import { createStore } from '../public/js/core/store.js';

test('lanes are off by default; env turns them on and off', () => {
  assert.equal(defaults().lanes.enabled, false);
  assert.deepEqual(fromEnv({ LANEBOARD_LANES: '1' }), { lanes: { enabled: true } });
  assert.deepEqual(fromEnv({ LANEBOARD_LANES: '0' }), { lanes: { enabled: false } });
  assert.deepEqual(fromEnv({}), {});
});

test('only an explicit false is off', () => {
  assert.equal(lanesOn({ lanes: { enabled: false } }), false);
  assert.equal(lanesOn({ lanes: { enabled: true } }), true);
  assert.equal(lanesOn({}), true);
});

test('GET /api/features says what the config says', () => {
  for (const enabled of [true, false]) {
    let handler;
    let body;
    features.register({ config: { lanes: { enabled } }, route: (m, p, h) => { handler = h; }, json: (res, b) => { body = b; } });
    handler({}, {});
    assert.equal(body.lanes, enabled);
    assert.ok(['on', 'missing', 'unavailable'].includes(body.peerCheck));
  }
});

test('the Inbox drops the lane groups only when lanes are off', () => {
  const ids = (o) => buildInbox(createStore({ keyMode: 'name' }), o).groups.map((g) => g.id);
  for (const g of LANE_GROUPS) {
    assert.ok(ids({}).includes(g));
    assert.ok(!ids({ lanes: false }).includes(g));
  }
});
