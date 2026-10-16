// server/config/control.mjs: stateDir, approvals, budget (fleet plan §8, C1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as control from '../server/config/control.mjs';
import * as paths from '../server/fleet/paths.mjs';
import { defaultStateDir } from '../server/control/pause.mjs';
import { WINDOWS } from '../server/util.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-control-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const frag = { name: 'control', ...control };
const cfg = (fileBody, env = {}) => build({ env, file: fileBody ? write(fileBody) : MISSING, fragments: [frag] });
const refused = (fileBody, re, env = {}) => assert.throws(() => cfg(fileBody, env), (err) => {
  assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
  assert.match(err.message, re);
  return true;
});

test('the fragment is loaded from server/config/ and contributes the contract defaults', () => {
  assert.ok(FRAGMENTS.some((f) => f.name === 'control'), 'control.mjs is a loaded fragment');
  const c = build({ env: {}, file: MISSING });
  assert.equal(c.stateDir, paths.stateDir());
  assert.deepEqual(c.approvals, { enabled: true, holdSec: 600, onTimeout: 'prompt', previewMaxLines: 300 });
  assert.deepEqual(c.budget, {
    window: 'tonight', perLaneUsd: null, perBuilderUsd: null, warnPct: 80, pausePct: 100,
    quota: { enabled: false, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false },
  });
  assert.equal(c.port, 7777, 'core keys untouched');
});

test('defaults leave behaviour unchanged: no caps, quota guard off, timeout falls through', () => {
  const c = cfg(null);
  assert.equal(c.budget.perLaneUsd, null);
  assert.equal(c.budget.perBuilderUsd, null);
  assert.equal(c.budget.quota.enabled, false);
  assert.equal(c.budget.quota.autoResume, false);
  assert.equal(c.approvals.onTimeout, 'prompt');
});

test('stateDir default agrees with pause.mjs defaultStateDir when XDG_STATE_HOME is unset', () => {
  const env = { ...process.env };
  delete env.XDG_STATE_HOME;
  delete env.LANEBOARD_STATE_DIR;
  assert.equal(paths.stateDir({ env }), defaultStateDir(env));
});

test('LANEBOARD_STATE_DIR wins, as it does in pause.mjs', () => {
  const d = path.join(tmp, 'state');
  assert.deepEqual(control.fromEnv({ LANEBOARD_STATE_DIR: d }), { stateDir: d });
  assert.deepEqual(control.fromEnv({}), {});
  assert.deepEqual(control.fromEnv({ LANEBOARD_STATE_DIR: '' }), {});
  const c = cfg({ stateDir: '/srv/other' }, { LANEBOARD_STATE_DIR: d });
  assert.equal(c.stateDir, d);
  assert.equal(c.stateDir, defaultStateDir({ LANEBOARD_STATE_DIR: d }));
});

test('stateDir: ~ expanded, env-relative resolved, file-relative refused, normalized', () => {
  assert.equal(cfg({ stateDir: '~/st' }).stateDir, path.join(os.homedir(), 'st'));
  assert.equal(cfg({ stateDir: '/srv/a/../b' }).stateDir, '/srv/b');
  assert.equal(cfg(null, { LANEBOARD_STATE_DIR: 'rel/state' }).stateDir, path.resolve('rel/state'));
  refused({ stateDir: 'rel/state' }, /stateDir must be an absolute path/);
  refused({ stateDir: '' }, /stateDir must be a directory path/);
  refused({ stateDir: 42 }, /stateDir must be a directory path/);
  refused({ stateDir: '/a\u0000b' }, /NUL/);
});

test('approvals.holdSec is clamped to 30..1800', () => {
  assert.equal(cfg({ approvals: { holdSec: 5 } }).approvals.holdSec, 30);
  assert.equal(cfg({ approvals: { holdSec: 99999 } }).approvals.holdSec, 1800);
  assert.equal(cfg({ approvals: { holdSec: 120 } }).approvals.holdSec, 120);
  assert.equal(cfg({ approvals: { holdSec: 30 } }).approvals.holdSec, 30);
  refused({ approvals: { holdSec: '600' } }, /approvals\.holdSec must be a number/);
});

test('approvals: a half-set block keeps its other defaults', () => {
  const c = cfg({ approvals: { onTimeout: 'deny' } });
  assert.deepEqual(c.approvals, { enabled: true, holdSec: 600, onTimeout: 'deny', previewMaxLines: 300 });
});

test('approvals validation', () => {
  refused({ approvals: { enabled: 'yes' } }, /approvals\.enabled must be true or false/);
  refused({ approvals: { onTimeout: 'allow' } }, /approvals\.onTimeout must be one of prompt, deny/);
  refused({ approvals: { previewMaxLines: 0 } }, /approvals\.previewMaxLines/);
  refused({ approvals: { previewMaxLines: 2.5 } }, /approvals\.previewMaxLines/);
  refused({ approvals: { previewMaxLines: 1e6 } }, /approvals\.previewMaxLines/);
  refused({ approvals: 'off' }, /approvals must be an object/);
  refused({ approvals: null }, /approvals must be an object/);
});

test('budget: every util.WINDOWS name is accepted, anything else refused', () => {
  for (const w of WINDOWS) assert.equal(cfg({ budget: { window: w } }).budget.window, w);
  refused({ budget: { window: '1y' } }, /budget\.window must be one of/);
});

test('budget caps: null or a positive number', () => {
  const c = cfg({ budget: { perLaneUsd: 12.5, perBuilderUsd: 100 } });
  assert.equal(c.budget.perLaneUsd, 12.5);
  assert.equal(c.budget.perBuilderUsd, 100);
  assert.equal(c.budget.warnPct, 80, 'the rest keeps its defaults');
  refused({ budget: { perLaneUsd: 0 } }, /budget\.perLaneUsd must be a positive number/);
  refused({ budget: { perLaneUsd: -1 } }, /budget\.perLaneUsd/);
  refused({ budget: { perBuilderUsd: '5' } }, /budget\.perBuilderUsd/);
});

test('budget percentages', () => {
  assert.equal(cfg({ budget: { warnPct: 100, pausePct: 100 } }).budget.warnPct, 100);
  assert.equal(cfg({ budget: { pausePct: 150 } }).budget.pausePct, 150, 'pause above the cap is allowed');
  refused({ budget: { warnPct: 0 } }, /budget\.warnPct must be a number from 1 to 100/);
  refused({ budget: { warnPct: 101 } }, /budget\.warnPct/);
  refused({ budget: { warnPct: 90, pausePct: 80 } }, /warnPct \(90\) must not exceed budget\.pausePct \(80\)/);
  refused({ budget: { pausePct: 5000 } }, /budget\.pausePct/);
  refused({ budget: [] }, /budget must be an object/);
});

test('budget.quota validation', () => {
  const c = cfg({ budget: { quota: { enabled: true, autoResume: true } } });
  assert.deepEqual(c.budget.quota, { enabled: true, fiveHourPct: 90, resumeBelowPct: 70, autoResume: true });
  refused({ budget: { quota: { enabled: 1 } } }, /budget\.quota\.enabled/);
  refused({ budget: { quota: { autoResume: 'no' } } }, /budget\.quota\.autoResume/);
  refused({ budget: { quota: { fiveHourPct: 120 } } }, /budget\.quota\.fiveHourPct/);
  refused({ budget: { quota: { resumeBelowPct: -1 } } }, /budget\.quota\.resumeBelowPct/);
  refused({ budget: { quota: { fiveHourPct: 60, resumeBelowPct: 70 } } }, /resumeBelowPct \(70\) must be below/);
  refused({ budget: { quota: null } }, /budget\.quota must be an object/);
});

test('errors name the config file', () => {
  const f = write({ approvals: { onTimeout: 'nope' } });
  assert.throws(() => build({ env: {}, file: f, fragments: [frag] }), (err) => err.message.startsWith(`${f}:`));
});

test('finalize tolerates wrong types and leaves them for validate', () => {
  for (const bad of [{ stateDir: null, approvals: null, budget: 3 }, { approvals: { holdSec: 'x' } }, {}]) {
    assert.doesNotThrow(() => control.finalize(structuredClone(bad), { env: {} }));
  }
});
