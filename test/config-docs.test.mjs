// docs/config.md documents every config fragment key (fleet plan §11 X4,
// README §5 DoD item 6): scripts/check-config-docs.mjs as a test.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkRepo, checkConfigDocs, leafKeys, backticked, isDocumented, envVarsOf, RUNTIME_KEYS,
} from '../scripts/check-config-docs.mjs';

test('docs/config.md documents every fragment key, runtime key and env var', async () => {
  const { missing, checked } = await checkRepo();
  assert.ok(checked > 100, `expected the full fragment key set, got ${checked}`);
  assert.deepEqual(missing.map((m) => `${m.key} (${m.owner})`), []);
});

test('leaf keys walk plain objects; arrays, empty objects and null are leaves', () => {
  assert.deepEqual(
    leafKeys({ a: { b: 1, c: { d: [1] } }, e: {}, f: null }),
    ['a.b', 'a.c.d', 'e', 'f'],
  );
});

test('a missing key is reported with its owner', () => {
  const fragments = [{ name: 'alpha', defaults: () => ({ fleet: { id: 'x', code: '' } }) }];
  const { missing } = checkConfigDocs({ fragments, docs: '| `fleet.id` | x |', runtimeKeys: [] });
  assert.deepEqual(missing, [{ key: 'fleet.code', owner: 'server/config/alpha.mjs' }]);
});

test('a mention inside prose without backticks does not count', () => {
  const fragments = [{ name: 'alpha', defaults: () => ({ budget: { warnPct: 80 } }) }];
  assert.equal(checkConfigDocs({ fragments, docs: 'budget.warnPct is 80', runtimeKeys: [] }).missing.length, 1);
});

test('a <placeholder> pattern covers a key only when the concrete segment is named too', () => {
  const spans = backticked('`notify.kinds.<kind>` with kinds `danger`, `stuck`');
  assert.equal(isDocumented('notify.kinds.danger', spans), true);
  assert.equal(isDocumented('notify.kinds.reboot', spans), false);
  const two = backticked('`health.thresholds.<key>.warn` for `memAvailPct`');
  assert.equal(isDocumented('health.thresholds.memAvailPct.warn', two), true);
  assert.equal(isDocumented('health.thresholds.memAvailPct.crit', two), false);
});

test('env vars a fragment reads must be documented too', () => {
  assert.deepEqual(envVarsOf('const v = env.LANEBOARD_MODE; env.LANEBOARD_MODE; env.OTHER'), ['LANEBOARD_MODE']);
  const fragments = [{ name: 'mode', defaults: () => ({ mode: 'builder' }), source: 'env.LANEBOARD_MODE' }];
  const { missing } = checkConfigDocs({ fragments, docs: '`mode`', runtimeKeys: [] });
  assert.deepEqual(missing.map((m) => m.key), ['LANEBOARD_MODE']);
});

test('runtime keys without a fragment default are part of the check', () => {
  for (const k of ['approvals.maxBodyBytes', 'approvals.maxInFlight', 'fleet.placement.any', 'push.allowedEndpointHosts']) {
    assert.ok(RUNTIME_KEYS.includes(k), k);
  }
});
