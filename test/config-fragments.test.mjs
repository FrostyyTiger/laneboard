// server/config.mjs fragments (server/config/<area>.mjs) and the `mode` fragment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  build, defaults, fromEnv, loadFragments, mergedDefaults, FRAGMENTS, FRAGMENTS_DIR, ConfigError,
} from '../server/config.mjs';
import * as modeFragment from '../server/config/mode.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-fragments-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
  return f;
};

/** A fragment in the shape a later task ships. */
const frag = (name, d, { env = () => ({}), validate = () => {}, finalize } = {}) => ({
  name, defaults: () => structuredClone(d), fromEnv: env, validate, ...(finalize ? { finalize } : {}),
});

const alpha = frag('alpha', { fleet: { id: 'builder-a', allowedOrigins: [] } }, {
  env: (e) => (e.LB_TEST_FLEET_ID ? { fleet: { id: e.LB_TEST_FLEET_ID } } : {}),
  validate: (c, bad) => { if (!/^[a-z0-9-]{1,24}$/.test(c.fleet.id)) bad(`fleet.id must be a slug, got ${JSON.stringify(c.fleet.id)}`); },
});
const beta = frag('beta', { fleet: { hubKeys: [], clockSkewMs: 60000 }, budget: { warnPct: 80 } });

// --- merge -------------------------------------------------------------------

test('fragment defaults deep-merge with the core and with each other', () => {
  const c = build({ env: {}, file: MISSING, fragments: [alpha, beta] });
  assert.equal(c.port, 7777, 'core keys untouched');
  assert.deepEqual(c.fleet, { id: 'builder-a', allowedOrigins: [], hubKeys: [], clockSkewMs: 60000 });
  assert.equal(c.budget.warnPct, 80);
});

test('the file and the env override fragment keys, leaf by leaf', () => {
  const file = write({ fleet: { hubKeys: ['ed25519:AAAA'] }, budget: { warnPct: 90 } });
  const c = build({ env: { LB_TEST_FLEET_ID: 'builder-b' }, file, fragments: [alpha, beta] });
  assert.equal(c.fleet.id, 'builder-b', 'env wins');
  assert.deepEqual(c.fleet.hubKeys, ['ed25519:AAAA'], 'file wins over the default');
  assert.equal(c.fleet.clockSkewMs, 60000, 'a half-set block keeps the rest of its defaults');
  assert.deepEqual(c.fleet.allowedOrigins, []);
  assert.equal(c.budget.warnPct, 90);
});

test('a fragment that sets no env keys contributes nothing to the env layer', () => {
  assert.deepEqual(fromEnv({}), {});
  assert.deepEqual(fromEnv({ LANEBOARD_REPOS: '', LANEBOARD_MODE: '' }), {});
});

test('two fragments defining the same leaf key is a ConfigError', () => {
  const clash = frag('clash', { fleet: { id: 'other' } });
  assert.throws(() => build({ env: {}, file: MISSING, fragments: [alpha, clash] }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /fleet\.id is defined by both server\/config\/alpha\.mjs and server\/config\/clash\.mjs/);
    return true;
  });
});

test('a fragment redefining a core key, or clashing leaf against object, is a ConfigError', () => {
  assert.throws(() => mergedDefaults([frag('port', { port: 9000 })]), /config key port is defined by both server\/config\.mjs/);
  assert.throws(() => mergedDefaults([frag('slots', { slots: { provider: 'x' } })]), /slots\.provider/);
  // `fleet` an object in one, a leaf in another.
  assert.throws(() => mergedDefaults([alpha, frag('flat', { fleet: true })]), /config key fleet is defined by both/);
  assert.throws(() => mergedDefaults([frag('flat', { fleet: 'x' }), alpha]), /config key fleet is defined by both/);
  // A new key inside an existing core object is fine.
  assert.equal(mergedDefaults([frag('mapx', { map: { hubIngest: true } })]).map.hubIngest, true);
});

test('fragment validate runs after the core checks, with bad() naming the file', () => {
  const file = write({ fleet: { id: 'Bad Id' } });
  assert.throws(() => build({ env: {}, file, fragments: [alpha] }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.message, `${file}: fleet.id must be a slug, got "Bad Id"`);
    return true;
  });
  // A core error is reported first.
  const both = write({ port: 'x', fleet: { id: 'Bad Id' } });
  assert.throws(() => build({ env: {}, file: both, fragments: [alpha] }), /port must be a port number/);
});

test('validate and finalize see the raw file and env layers', () => {
  const seen = [];
  const probe = frag('probe', { fleet: { ingressPort: undefined } }, {
    validate: (c, bad, layers) => seen.push(['validate', layers.file, layers.env, typeof layers.bad, layers.path]),
    finalize: (c, layers) => { seen.push(['finalize', layers.file]); },
  });
  const file = write({ fleet: {} });
  build({ env: { LANEBOARD_PORT: '7801' }, file, fragments: [probe] });
  assert.deepEqual(seen[0], ['finalize', { fleet: {} }]);
  assert.deepEqual(seen[1], ['validate', { fleet: {} }, { port: 7801 }, 'function', file]);
});

test('finalize runs after the merge and before validation; it may mutate or return', () => {
  const order = [];
  const derive = frag('derive', { fleet: { code: '' } }, {
    finalize: (c) => { order.push('finalize'); c.fleet.code ||= c.fleet.id.slice(0, 2).toUpperCase(); },
    validate: (c, bad) => { order.push('validate'); if (c.fleet.code.length > 3) bad('fleet.code must be 2-3 chars'); },
  });
  const replace = frag('replace', { extra: 1 }, { finalize: (c) => ({ ...c, extra: c.extra + 1 }) });
  const c = build({ env: { LB_TEST_FLEET_ID: 'zeta' }, file: MISSING, fragments: [alpha, derive, replace] });
  assert.equal(c.fleet.code, 'ZE', 'derived from the env-merged id');
  assert.equal(c.extra, 2, 'a returned object replaces the config');
  assert.deepEqual(order, ['finalize', 'validate']);
  // An explicit value is kept, and still validated.
  assert.throws(() => build({ env: {}, file: write({ fleet: { code: 'TOOLONG' } }), fragments: [alpha, derive] }), /fleet\.code must be 2-3 chars/);
});

test('a fragment missing one of its functions is refused', () => {
  assert.throws(() => build({ env: {}, file: MISSING, fragments: [{ name: 'half', defaults: () => ({}) }] }), /must export fromEnv\(\)/);
  assert.throws(() => build({ env: {}, file: MISSING, fragments: [{ ...beta, finalize: 'x' }] }), /finalize must be a function/);
});

// --- discovery -----------------------------------------------------------------

test('fragments are discovered from a directory in filename order', async () => {
  const dir = path.join(tmp, 'frags');
  fs.mkdirSync(dir);
  const src = (key) => `export const defaults = () => ({ ${key}: { on: true } });
export const fromEnv = () => ({});
export const validate = () => {};`;
  fs.writeFileSync(path.join(dir, 'zeta.mjs'), src('zeta'));
  fs.writeFileSync(path.join(dir, 'alpha.mjs'), src('alpha'));
  fs.writeFileSync(path.join(dir, 'README.txt'), 'not a fragment');
  const found = await loadFragments(dir);
  assert.deepEqual(found.map((f) => f.name), ['alpha', 'zeta']);
  const c = build({ env: {}, file: MISSING, fragments: found });
  assert.equal(c.alpha.on, true);
  assert.equal(c.zeta.on, true);
  assert.deepEqual(await loadFragments(path.join(tmp, 'nope')), []);
});

test('a fragment file that fails to load or lacks an export is a ConfigError naming it', async () => {
  const dir = path.join(tmp, 'broken');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export const defaults = () => ({});');
  await assert.rejects(loadFragments(dir), (err) => err instanceof ConfigError && /bad\.mjs must export fromEnv/.test(err.message));
  // A new directory and name: the ESM loader caches by URL.
  const dir2 = path.join(tmp, 'broken2');
  fs.mkdirSync(dir2);
  fs.writeFileSync(path.join(dir2, 'syntax.mjs'), 'this is not javascript (');
  await assert.rejects(loadFragments(dir2), (err) => err instanceof ConfigError && /syntax\.mjs failed to load/.test(err.message));
});

test('the shipped fragments are the files in server/config/, mode among them', () => {
  const files = fs.readdirSync(FRAGMENTS_DIR).filter((f) => f.endsWith('.mjs')).sort();
  assert.deepEqual(FRAGMENTS.map((f) => `${f.name}.mjs`), files);
  assert.ok(FRAGMENTS.some((f) => f.name === 'mode'));
  // Together they define no key twice (this is what the real start runs).
  assert.doesNotThrow(() => defaults());
});

// --- mode ------------------------------------------------------------------------

test('mode defaults to builder', () => {
  assert.equal(build({ env: {}, file: MISSING }).mode, 'builder');
  assert.equal(defaults().mode, 'builder');
  assert.deepEqual(modeFragment.defaults(), { mode: 'builder' });
});

test('mode comes from the file or LANEBOARD_MODE, env winning', () => {
  assert.equal(build({ env: {}, file: write({ mode: 'hub' }) }).mode, 'hub');
  assert.equal(build({ env: { LANEBOARD_MODE: 'hub' }, file: MISSING }).mode, 'hub');
  assert.equal(build({ env: { LANEBOARD_MODE: 'builder' }, file: write({ mode: 'hub' }) }).mode, 'builder');
  assert.deepEqual(fromEnv({ LANEBOARD_MODE: 'hub' }), { mode: 'hub' });
});

test('mode "both" is refused with a message that says what to do', () => {
  for (const args of [{ env: {}, file: write({ mode: 'both' }) }, { env: { LANEBOARD_MODE: 'both' }, file: MISSING }]) {
    assert.throws(() => build(args), (err) => {
      assert.ok(err instanceof ConfigError);
      assert.match(err.message, /mode "both" is not supported/);
      assert.match(err.message, /run two laneboard processes/);
      return true;
    });
  }
});

test('any other mode is refused', () => {
  for (const mode of ['Hub', 'standalone', '', 7, null]) {
    assert.throws(() => build({ env: {}, file: write({ mode }) }), /mode must be one of builder, hub/, JSON.stringify(mode));
  }
});

test('the suite itself runs in builder mode', async () => {
  const { config } = await import('../server/config.mjs');
  assert.equal(config.mode, 'builder');
});
