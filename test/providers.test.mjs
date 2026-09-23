// The provider registry: what config picks, and what a `none` costs.
import test from 'node:test';
import assert from 'node:assert/strict';

const providers = await import('../server/providers/index.mjs');

test('with nothing configured, every provider is the none one', () => {
  assert.equal(providers.slots.name, 'none');
  assert.equal(providers.guard.name, 'none');
  assert.equal(providers.ci.name, 'none');
  assert.equal(providers.slots.available, false);
  assert.equal(providers.guard.active, false);
  assert.equal(providers.ci.active, false);
});

test('a provider can be swapped, and put back', () => {
  const fake = { name: 'fake', available: true };
  const before = providers._set('slots', fake);
  assert.equal(providers.slots.name, 'fake');
  providers._set('slots', before);
  assert.equal(providers.slots.name, 'none');
  assert.throws(() => providers._set('nonsense', fake), /no such provider kind/);
});

test('every provider of a kind exports the same names', async () => {
  const shapes = {
    slots: ['name', 'available', 'slotCount', 'ports', 'envCommand', 'list', 'existing', 'up', 'env', 'down', 'dropVolumes'],
    guard: ['name', 'active', 'forbiddenPorts', 'healthProbes', 'containerFilter', 'health', 'containers', 'preventive', 'detective'],
    ci: ['name', 'active', 'prForBranch', 'runs'],
  };
  const paths = {
    slots: ['none', 'agent-stack'],
    guard: ['none', 'ports'],
    ci: ['none', 'gh'],
  };
  for (const [kind, names] of Object.entries(paths)) {
    for (const n of names) {
      const mod = await import(`../server/providers/${kind}/${n}.mjs`);
      for (const key of shapes[kind]) {
        assert.ok(key in mod, `${kind}/${n} is missing ${key}`);
      }
      assert.equal(mod.name, n, `${kind}/${n} should call itself ${n}`);
    }
  }
});

test('a none provider never runs an external command', async () => {
  // The whole promise of `none`: a laneboard with no site around it shells
  // out to nothing at all on these paths.
  for (const kind of ['slots', 'guard', 'ci']) {
    const mod = await import(`../server/providers/${kind}/none.mjs`);
    const src = await (await import('node:fs/promises')).readFile(
      new URL(`../server/providers/${kind}/none.mjs`, import.meta.url), 'utf8'
    );
    assert.ok(!/\brun\(|execFile|spawn\(|fetch\(/.test(src), `${kind}/none.mjs shells out`);
    assert.equal(typeof mod.name, 'string');
  }
});
