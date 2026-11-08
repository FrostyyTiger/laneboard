// server/config/engines.mjs: the `engines` list (docs/engines.md, docs/config.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as engines from '../server/config/engines.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-engines-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const frag = { name: 'engines', ...engines };
const cfg = (body) => build({ env: {}, file: body ? write(body) : MISSING, fragments: [frag] });
const refused = (body, re) => assert.throws(() => cfg(body), (err) => {
  assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
  assert.match(err.message, re);
  return true;
});

test('the fragment is loaded and defaults to no engines', () => {
  assert.ok(FRAGMENTS.some((f) => f.name === 'engines'));
  assert.deepEqual(build({ env: {}, file: MISSING }).engines, []);
});

test('a good list is kept as written', () => {
  const list = [{ id: 'main', kind: 'fake', dir: tmp, timeoutMs: 5000, staleMs: 10000, downMs: 60000 }, { id: 'off', kind: 'none' }];
  assert.deepEqual(cfg({ engines: list }).engines, list);
});

test('bad entries are refused, each with a clear message', () => {
  refused({ engines: {} }, /engines must be a list/);
  refused({ engines: ['main'] }, /engines\[0\] must be an object/);
  refused({ engines: [{ id: 'Main', kind: 'fake' }] }, /engines\[0\]\.id must be a lower-case slug/);
  refused({ engines: [{ id: 'jsonl', kind: 'fake' }] }, /reserved/);
  refused({ engines: [{ id: 'a', kind: 'fake' }, { id: 'a', kind: 'none' }] }, /used twice/);
  refused({ engines: [{ id: 'a', kind: 'foundry' }] }, /kind must be one of none, fake/);
  refused({ engines: [{ id: 'a', kind: 'fake', bin: '/x' }] }, /engines\[0\]\.bin is not a known key/);
  refused({ engines: [{ id: 'a', kind: 'none', dir: tmp }] }, /dir is only for kind fake/);
  refused({ engines: [{ id: 'a', kind: 'fake', dir: 'relative' }] }, /dir must be an absolute path/);
  refused({ engines: [{ id: 'a', kind: 'fake', timeoutMs: 5 }] }, /timeoutMs must be an integer from 100/);
  refused({ engines: [{ id: 'a', kind: 'fake', staleMs: 60000, downMs: 5000 }] }, /downMs must not be below staleMs/);
  refused({ engines: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, kind: 'none' })) }, /at most 8/);
});
