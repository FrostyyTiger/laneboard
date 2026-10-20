// server/config/runs.mjs: runs.files, runs.lanes, runs.maxEvents, runs.keepDays
// (docs/plans/runs/README.md §3 A1, T3).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as runs from '../server/config/runs.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-runs-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
  return f;
};
const frag = { name: 'runs', ...runs };
const cfg = (fileBody, env = {}) => build({ env, file: fileBody ? write(fileBody) : MISSING, fragments: [frag] });
const refused = (fileBody, re) => assert.throws(() => cfg(fileBody), (err) => {
  assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
  assert.match(err.message, re);
  return true;
});

test('the fragment is loaded from server/config/ and defaults to no run files', () => {
  assert.ok(FRAGMENTS.some((f) => f.name === 'runs'), 'runs.mjs is a loaded fragment');
  const c = build({ env: {}, file: MISSING });
  assert.deepEqual(c.runs, { files: [], lanes: true, maxEvents: 5000, keepDays: 30 });
  assert.equal(c.port, 7777, 'core keys untouched');
});

test('defaults are fresh objects each call', () => {
  const a = runs.defaults();
  a.runs.files.push('/x');
  assert.deepEqual(runs.defaults().runs.files, []);
});

test('no env layer', () => {
  assert.deepEqual(runs.fromEnv({ LANEBOARD_RUN_FILE: '/tmp/x.jsonl', LANEBOARD_RUNS_FILES: '/a' }), {});
  assert.deepEqual(cfg(null, { LANEBOARD_RUN_FILE: '/tmp/x.jsonl' }).runs.files, []);
});

test('the file sets every key; a half-set block keeps the other defaults', () => {
  const c = cfg({ runs: { files: ['/srv/runs/*/run.jsonl'], lanes: false } });
  assert.deepEqual(c.runs, { files: ['/srv/runs/*/run.jsonl'], lanes: false, maxEvents: 5000, keepDays: 30 });
  const d = cfg({ runs: { maxEvents: 100, keepDays: 3650 } });
  assert.equal(d.runs.maxEvents, 100);
  assert.equal(d.runs.keepDays, 3650);
});

test('a leading ~/ in runs.files is expanded to the home directory', () => {
  const c = cfg({ runs: { files: ['~/runs/*/run.jsonl', '/abs/run.jsonl', '~'] } });
  assert.deepEqual(c.runs.files, [path.join(os.homedir(), 'runs/*/run.jsonl'), '/abs/run.jsonl', os.homedir()]);
});

test('bad runs.files are a ConfigError naming the entry', () => {
  refused({ runs: { files: '/a/run.jsonl' } }, /runs\.files must be a list/);
  refused({ runs: { files: [''] } }, /runs\.files entry "" must be a non-empty string/);
  refused({ runs: { files: [3] } }, /runs\.files entry 3 must be a non-empty string/);
  refused({ runs: { files: ['runs/*.jsonl'] } }, /must be an absolute path/);
  refused({ runs: { files: ['~user/run.jsonl'] } }, /must be an absolute path/);
  refused({ runs: { files: ['/a/../etc/run.jsonl'] } }, /"\.\." segment/);
  refused({ runs: { files: ['/a/{b/run.jsonl'] } }, /not a valid glob/);
  refused({ runs: { files: Array.from({ length: runs.MAX_FILES + 1 }, (_, i) => `/r${i}.jsonl`) } }, /at most 64/);
});

test('bad runs.lanes, maxEvents and keepDays are a ConfigError', () => {
  refused({ runs: { lanes: 'yes' } }, /runs\.lanes must be true or false/);
  refused({ runs: { maxEvents: 99 } }, /runs\.maxEvents must be an integer from 100 to 100000/);
  refused({ runs: { maxEvents: 100001 } }, /runs\.maxEvents/);
  refused({ runs: { maxEvents: 1.5 } }, /runs\.maxEvents/);
  refused({ runs: { keepDays: 0 } }, /runs\.keepDays must be an integer from 1 to 3650/);
  refused({ runs: { keepDays: '7' } }, /runs\.keepDays/);
  refused({ runs: 'all' }, /runs must be an object/);
});

test('fileGlobProblem accepts the documented loop pattern after expansion', () => {
  assert.equal(runs.fileGlobProblem(path.join(os.homedir(), 'runs/*/run.jsonl')), null);
  assert.equal(runs.fileGlobProblem('/srv/{a,b}/.laneboard/run.jsonl'), null);
  assert.match(runs.fileGlobProblem('/a\0b'), /NUL/);
});
