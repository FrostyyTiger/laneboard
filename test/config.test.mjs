// The config loader: defaults, then the file, then the environment.
//
// Nothing here imports `config` itself — that is built once at import time from
// the real environment. Everything is tested through `build({ env, file })`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, defaults, loadFile, fromEnv, configPath, markerPatterns, ConfigError } from '../server/config.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-config-'));
const write = (name, text) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, text);
  return p;
};
const MISSING = path.join(tmp, 'there-is-no-such-file.json');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// --- the three layers --------------------------------------------------------

test('with no file and no environment, the defaults run', () => {
  const c = build({ env: {}, file: MISSING });
  assert.equal(c.port, 7777);
  assert.deepEqual(c.bindAddresses, ['127.0.0.1']);
  assert.equal(c.publicUrl, 'http://127.0.0.1:7777');
  // Every provider off: a fresh install is a board of sessions and terminals.
  assert.equal(c.slots.provider, 'none');
  assert.equal(c.guard.provider, 'none');
  assert.equal(c.ci.provider, 'none');
  assert.deepEqual(c.repos, []);
  assert.equal(c.defaultRepo, '');
  assert.deepEqual(c.guard.forbiddenPorts, []);
});

test('a missing config file is not an error, and says where it looked', () => {
  const c = build({ env: {}, file: MISSING });
  assert.equal(c.configPath, MISSING);
  assert.deepEqual(loadFile(MISSING), {});
});

test('the file beats the defaults', () => {
  const file = write('file.json', JSON.stringify({
    port: 8123,
    publicUrl: 'https://board.example.invalid',
    repos: [{ name: 'alpha' }, { name: 'beta' }],
    slots: { provider: 'agent-stack', laneSlots: [3, 4, 5] },
  }));
  const c = build({ env: {}, file });
  assert.equal(c.port, 8123);
  assert.equal(c.publicUrl, 'https://board.example.invalid');
  assert.equal(c.defaultRepo, 'alpha');
  assert.deepEqual(c.repoNames, ['alpha', 'beta']);
  assert.equal(c.slots.provider, 'agent-stack');
  assert.deepEqual(c.slots.laneSlots, [3, 4, 5]);
  assert.equal(c.maxActiveLanes, 3);
  // A nested object the file only half-sets keeps the rest of its defaults.
  assert.deepEqual(c.slots.reservedSlots, [1]);
  assert.equal(c.slots.bin, defaults().slots.bin);
});

test('the environment beats the file', () => {
  const file = write('env.json', JSON.stringify({
    port: 8123, publicUrl: 'https://file.example.invalid',
    slots: { provider: 'agent-stack', laneSlots: [3, 4, 5] },
  }));
  const c = build({ env: { LANEBOARD_PORT: '9001', LANEBOARD_LANE_SLOTS: '7' }, file });
  assert.equal(c.port, 9001);
  assert.deepEqual(c.slots.laneSlots, [7]);
  // And leaves everything the environment did not mention alone.
  assert.equal(c.publicUrl, 'https://file.example.invalid');
  assert.equal(c.slots.provider, 'agent-stack');
});

test('an unset variable never overrides the file with a default', () => {
  // The bug this prevents: reading every LANEBOARD_* with `?? default` makes
  // the env layer a full config, and the file stops meaning anything.
  const env = fromEnv({ LANEBOARD_PORT: '9001' });
  assert.deepEqual(Object.keys(env), ['port']);
  assert.equal(fromEnv({}).slots, undefined);
});

test('an empty string is not a value', () => {
  assert.deepEqual(fromEnv({ LANEBOARD_REPOS: '', LANEBOARD_PORT: '' }), {});
});

// --- a config that cannot be read --------------------------------------------

test('a malformed config file refuses to start, naming the file and the line', () => {
  const file = write('bad.json', '{\n  "port": 7777,\n  "bind": [,]\n}\n');
  assert.throws(() => build({ env: {}, file }), (err) => {
    assert.ok(err instanceof ConfigError, `${err.name} is not a ConfigError`);
    assert.match(err.message, /bad\.json:3/, `no file:line in ${err.message}`);
    assert.match(err.message, /not valid JSON/);
    return true;
  });
});

test('a config that is not an object is refused by shape', () => {
  const file = write('array.json', '[1, 2, 3]');
  assert.throws(() => build({ env: {}, file }), /must be a JSON object, not an array/);
});

test('a value that would break at 03:00 is refused at start', () => {
  const bad = (obj, re) => {
    const file = write(`bad-${Math.random().toString(36).slice(2)}.json`, JSON.stringify(obj));
    assert.throws(() => build({ env: {}, file }), re);
  };
  bad({ port: 'seven' }, /port must be a port number/);
  bad({ port: 99999 }, /port must be a port number/);
  bad({ bind: [] }, /bind must be a non-empty list/);
  bad({ repos: [{ kickoff: 'x' }] }, /every entry of repos needs a name/);
  bad({ slots: { provider: 'magic' } }, /slots\.provider must be one of none, agent-stack/);
  bad({ guard: { provider: 'magic' } }, /guard\.provider must be one of none, ports/);
  bad({ ci: { provider: 'magic' } }, /ci\.provider must be one of none, gh/);
  bad({ markers: { need: 'NEED-(' } }, /markers\.need is not a valid regular expression/);
});

// --- derived ------------------------------------------------------------------

test('the config file path is the documented one, and LANEBOARD_CONFIG wins', () => {
  assert.equal(configPath({}), path.join(os.homedir(), '.config', 'laneboard', 'config.json'));
  assert.equal(configPath({ LANEBOARD_CONFIG: '/x/y.json' }), '/x/y.json');
});

test('markers compile from the config, and a repo can add its own', () => {
  const pats = markerPatterns(
    { need: 'NEED-HUMAN', limit: 'usage limit' },
    [{ name: 'alpha', markers: { need: 'NEED-ALEX' } }, { name: 'beta' }]
  );
  const need = pats.find((p) => p.kind === 'need');
  assert.equal(need.source, 'NEED-HUMAN|NEED-ALEX');
  // Anchored: a typed token at the start of a line. `limit` is prose.
  assert.equal(need.anchored, true);
  assert.equal(pats.find((p) => p.kind === 'limit').anchored, false);
  // A kind a repo invents comes through on its own.
  const only = markerPatterns({}, [{ name: 'a', markers: { review: 'REVIEW-ME' } }]);
  assert.deepEqual(only, [{ kind: 'review', source: 'REVIEW-ME', anchored: true }]);
});

test('the marker patterns a default config produces are the generic ones', () => {
  const c = build({ env: {}, file: MISSING });
  const need = c.markerPatterns.find((p) => p.kind === 'need');
  assert.equal(need.source, 'NEED-HUMAN|NEED-OWNER');
  assert.deepEqual(c.markerPatterns.map((p) => p.kind).sort(), ['blocked', 'done', 'limit', 'need', 'progress']);
});

test('the paths under $HOME and the repo are derived, not configured', () => {
  const file = write('paths.json', JSON.stringify({ home: '/nope', dbPath: '/nope' }));
  const c = build({ env: {}, file });
  assert.equal(c.home, os.homedir());
  assert.equal(c.statusCacheDir, path.join(os.homedir(), '.cache', 'laneboard', 'status'));
  assert.equal(c.dbPath, path.join(c.repoRoot, 'data', 'laneboard.db'));
  assert.equal(build({ env: { LANEBOARD_DB: ':memory:' }, file: MISSING }).dbPath, ':memory:');
});

test('a long malformed file gives the same line, from a byte position', () => {
  // V8 reports a position rather than a snippet once the document is big
  // enough; both paths have to land on the same line.
  const filler = `  "comment": "${'x'.repeat(200)}",\n`;
  const file = write('big.json', `{\n${filler}  "bind": [,]\n}\n`);
  assert.throws(() => build({ env: {}, file }), /big\.json:3/);
});

test('an empty config file is a config with no keys set', () => {
  for (const text of ['', '   \n\n']) {
    const file = write(`empty-${text.length}.json`, text);
    assert.deepEqual(loadFile(file), {});
    assert.equal(build({ env: {}, file }).port, 7777);
  }
});
