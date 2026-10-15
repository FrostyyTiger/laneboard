// server/config/observability.mjs: stuck, health, push.local, notify, alarms (fleet plan §7, O2).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS, ConfigError } from '../server/config.mjs';
import * as obs from '../server/config/observability.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-obs-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const MISSING = path.join(tmp, 'no-such-config.json');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const frag = { name: 'observability', ...obs };
const cfg = (fileBody, env = {}) => build({ env, file: fileBody ? write(fileBody) : MISSING, fragments: [frag] });
const refused = (fileBody, re) => assert.throws(() => cfg(fileBody), (err) => {
  assert.ok(err instanceof ConfigError, `expected ConfigError, got ${err}`);
  assert.match(err.message, re);
  return true;
});

test('the fragment is loaded from server/config/ and contributes the contract defaults', () => {
  assert.ok(FRAGMENTS.some((f) => f.name === 'observability'), 'observability.mjs is a loaded fragment');
  const c = build({ env: {}, file: MISSING });
  assert.deepEqual(c.stuck, {
    enabled: true, autoPause: false, autoPauseRules: ['tool-loop', 'error-loop'],
    approvalWaitMin: 5, errorLoopCount: 3, errorLoopWindowMin: 15, toolLoopCount: 5, oscillationRepeats: 3,
    stalledMin: 10, stalledToolMin: 30, contextPct: 85, compactMin: 20, costWindowMin: 30, costUsd: 5, idleMin: 20,
  });
  const { thresholds, ...health } = c.health;
  assert.deepEqual(health, {
    sampleMs: 10000, historyMin: 60, dockerSocket: '/var/run/docker.sock', dockerRoot: '/var/lib/docker',
    worktreeDir: null, tailscale: true,
  });
  assert.deepEqual(thresholds, {
    swapInPerSec: { warn: 50, crit: 500 },
    memAvailPct: { warn: 15, crit: 5 },
    psiMemFull10: { warn: 5, crit: 20 },
    psiIoFull10: { warn: 10, crit: 30 },
    psiCpuSome10: { warn: 50, crit: 80 },
    loadPerCpu: { warn: 1.5, crit: 3 },
    fsUsedPct: { warn: 85, crit: 95 },
    dockerUnhealthy: { warn: 1, crit: null },
    rebootRequired: { warn: true, crit: null },
  });
  assert.deepEqual(c.push, { local: null });
  assert.equal(c.notify.quietHours, null);
  assert.deepEqual(c.notify.quietBypass, ['danger', 'builder-down']);
  const on = Object.entries(c.notify.kinds).filter(([, v]) => v).map(([k]) => k).sort();
  assert.deepEqual(on, ['approval', 'builder-down', 'danger', 'failed', 'needs-input', 'review', 'stuck']);
  assert.deepEqual(Object.keys(c.notify.kinds).sort(), [...obs.ALARM_KINDS].sort());
  assert.deepEqual(c.alarms, { evalMs: 1000, historyDays: 30 });
  assert.equal(c.port, 7777, 'core keys untouched');
});

test('the defaults are fresh objects and the fragment has no env layer', () => {
  const a = obs.defaults();
  a.stuck.autoPauseRules.push('stalled');
  a.notify.kinds.review = false;
  assert.deepEqual(obs.defaults().stuck.autoPauseRules, ['tool-loop', 'error-loop']);
  assert.equal(obs.defaults().notify.kinds.review, true);
  assert.deepEqual(obs.fromEnv({ LANEBOARD_MODE: 'hub' }), {});
});

test('defaults leave behaviour unchanged: badge only, no auto-pause, no quiet hours', () => {
  const c = cfg(null);
  assert.equal(c.stuck.autoPause, false);
  assert.equal(c.notify.quietHours, null);
  assert.equal(obs.resolvePushLocal(c), true, 'a standalone builder keeps its own pushes');
});

test('a file overrides single keys and the rest keep their defaults', () => {
  const c = cfg({
    stuck: { stalledMin: 15, autoPause: true, autoPauseRules: ['tool-loop'] },
    health: { worktreeDir: '/srv/code', dockerRoot: null, thresholds: { fsUsedPct: { warn: 80 } } },
    push: { local: false },
    notify: { kinds: { review: false, blocked: true }, quietHours: { from: '23:00', to: '07:30' } },
    alarms: { historyDays: 7 },
  });
  assert.equal(c.stuck.stalledMin, 15);
  assert.equal(c.stuck.stalledToolMin, 30);
  assert.equal(c.stuck.autoPause, true);
  assert.deepEqual(c.stuck.autoPauseRules, ['tool-loop'], 'a list replaces, never merges');
  assert.equal(c.health.worktreeDir, '/srv/code');
  assert.equal(c.health.dockerRoot, null);
  assert.deepEqual(c.health.thresholds.fsUsedPct, { warn: 80, crit: 95 });
  assert.deepEqual(c.health.thresholds.memAvailPct, { warn: 15, crit: 5 });
  assert.equal(c.push.local, false);
  assert.equal(c.notify.kinds.review, false);
  assert.equal(c.notify.kinds.blocked, true);
  assert.equal(c.notify.kinds.danger, true);
  assert.deepEqual(c.notify.quietHours, { from: '23:00', to: '07:30' });
  assert.equal(c.alarms.historyDays, 7);
  assert.equal(c.alarms.evalMs, 1000);
});

test('resolvePushLocal: a boolean wins; null is on iff fleet.hubKeys is empty', () => {
  assert.equal(obs.resolvePushLocal({ push: { local: null } }), true);
  assert.equal(obs.resolvePushLocal({ push: { local: null }, fleet: { hubKeys: [] } }), true);
  assert.equal(obs.resolvePushLocal({ push: { local: null }, fleet: { hubKeys: ['k'] } }), false);
  assert.equal(obs.resolvePushLocal({ push: { local: true }, fleet: { hubKeys: ['k'] } }), true);
  assert.equal(obs.resolvePushLocal({ push: { local: false }, fleet: { hubKeys: [] } }), false);
  assert.equal(obs.resolvePushLocal({}), true);
  assert.equal(obs.resolvePushLocal(undefined), true);
});

test('quiet hours may cross midnight; quietMinutes parses HH:MM', () => {
  assert.deepEqual(cfg({ notify: { quietHours: { from: '22:00', to: '06:00' } } }).notify.quietHours, { from: '22:00', to: '06:00' });
  assert.deepEqual(cfg({ notify: { quietHours: { from: '00:00', to: '23:59' } } }).notify.quietHours, { from: '00:00', to: '23:59' });
  assert.equal(obs.quietMinutes('07:30'), 450);
  assert.equal(obs.quietMinutes('00:00'), 0);
});

test('stuck: bad values are refused with a ConfigError', () => {
  refused({ stuck: { enabled: 'yes' } }, /stuck\.enabled must be true or false/);
  refused({ stuck: { autoPause: 1 } }, /stuck\.autoPause must be true or false/);
  refused({ stuck: { autoPauseRules: 'tool-loop' } }, /stuck\.autoPauseRules must be a list/);
  refused({ stuck: { autoPauseRules: ['kill-everything'] } }, /stuck\.autoPauseRules has an unknown rule "kill-everything"/);
  refused({ stuck: { approvalWaitMin: 0 } }, /stuck\.approvalWaitMin must be a positive number of minutes/);
  refused({ stuck: { idleMin: -3 } }, /stuck\.idleMin must be a positive/);
  refused({ stuck: { compactMin: '20' } }, /stuck\.compactMin must be a positive/);
  refused({ stuck: { errorLoopCount: 2.5 } }, /stuck\.errorLoopCount must be an integer of at least 2/);
  refused({ stuck: { toolLoopCount: 1 } }, /stuck\.toolLoopCount must be an integer of at least 2/);
  refused({ stuck: { oscillationRepeats: 0 } }, /stuck\.oscillationRepeats must be an integer/);
  refused({ stuck: { contextPct: 101 } }, /stuck\.contextPct must be a percentage/);
  refused({ stuck: { contextPct: 0 } }, /stuck\.contextPct must be a percentage/);
  refused({ stuck: { costUsd: 0 } }, /stuck\.costUsd must be a positive number of dollars/);
  refused({ stuck: { stalledMin: 40 } }, /stuck\.stalledToolMin \(30\) must not be below stuck\.stalledMin \(40\)/);
  refused({ stuck: null }, /stuck must be an object/);
});

test('every stuck rule is accepted for autoPauseRules', () => {
  const c = cfg({ stuck: { autoPauseRules: [...obs.STUCK_RULES] } });
  assert.deepEqual(c.stuck.autoPauseRules, [...obs.STUCK_RULES]);
  assert.deepEqual(cfg({ stuck: { autoPauseRules: [] } }).stuck.autoPauseRules, []);
});

test('health: bad values are refused with a ConfigError', () => {
  refused({ health: { sampleMs: 500 } }, /health\.sampleMs must be an integer of at least 1000/);
  refused({ health: { sampleMs: 'fast' } }, /health\.sampleMs must be an integer/);
  refused({ health: { historyMin: 0 } }, /health\.historyMin must be a positive number of minutes/);
  refused({ health: { dockerSocket: 'docker.sock' } }, /health\.dockerSocket must be an absolute path or null/);
  refused({ health: { dockerRoot: '' } }, /health\.dockerRoot must be an absolute path or null/);
  refused({ health: { worktreeDir: 'code' } }, /health\.worktreeDir must be an absolute path or null/);
  refused({ health: { worktreeDir: '/a\u0000b' } }, /health\.worktreeDir must be an absolute path/);
  refused({ health: { tailscale: 'off' } }, /health\.tailscale must be true or false/);
  refused({ health: { thresholds: 3 } }, /health\.thresholds must be an object/);
  refused({ health: { thresholds: { cpuTemp: { warn: 80, crit: 90 } } } }, /health\.thresholds has an unknown key "cpuTemp"/);
  refused({ health: { thresholds: { fsUsedPct: { warn: 120 } } } }, /health\.thresholds\.fsUsedPct\.warn must be a percentage/);
  refused({ health: { thresholds: { fsUsedPct: { warn: 96 } } } }, /fsUsedPct\.warn \(96\) must not exceed health\.thresholds\.fsUsedPct\.crit \(95\)/);
  refused({ health: { thresholds: { memAvailPct: { warn: 3 } } } }, /memAvailPct\.warn \(3\) must not be below .*lower is worse/);
  refused({ health: { thresholds: { loadPerCpu: { crit: -1 } } } }, /loadPerCpu\.crit must be a positive number/);
  refused({ health: { thresholds: { swapInPerSec: { warn: 50, crit: 500, extra: 1 } } } }, /swapInPerSec has an unknown field "extra"/);
  refused({ health: { thresholds: { swapInPerSec: null } } }, /health\.thresholds\.swapInPerSec must be an object/);
  refused({ health: { thresholds: { rebootRequired: { warn: 'yes' } } } }, /rebootRequired\.warn must be true or false/);
  refused({ health: { thresholds: { rebootRequired: { crit: 1 } } } }, /rebootRequired\.crit must be true, false or null/);
});

test('health: a crit of null means warn only, and paths may be null to skip', () => {
  const c = cfg({ health: { dockerSocket: null, thresholds: { psiIoFull10: { crit: null }, rebootRequired: { warn: false } } } });
  assert.equal(c.health.dockerSocket, null);
  assert.deepEqual(c.health.thresholds.psiIoFull10, { warn: 10, crit: null });
  assert.deepEqual(c.health.thresholds.rebootRequired, { warn: false, crit: null });
});

test('push.local: only true, false or null', () => {
  refused({ push: { local: 'auto' } }, /push\.local must be true, false or null/);
  refused({ push: { local: 0 } }, /push\.local must be true, false or null/);
  refused({ push: 'on' }, /push must be an object/);
  assert.equal(cfg({ push: { local: true } }).push.local, true);
});

test('notify: bad values are refused with a ConfigError', () => {
  refused({ notify: { kinds: { 'not-a-kind': true } } }, /notify\.kinds has an unknown kind "not-a-kind"/);
  refused({ notify: { kinds: { review: 'no' } } }, /notify\.kinds\.review must be true or false/);
  refused({ notify: { kinds: [] } }, /notify\.kinds must be an object/);
  refused({ notify: { quietHours: '23:00-07:30' } }, /notify\.quietHours must be an object/);
  refused({ notify: { quietHours: { from: '23:00' } } }, /notify\.quietHours\.to must be a time as HH:MM/);
  refused({ notify: { quietHours: { from: '24:00', to: '07:00' } } }, /notify\.quietHours\.from must be a time as HH:MM/);
  refused({ notify: { quietHours: { from: '7:30', to: '08:00' } } }, /notify\.quietHours\.from must be a time as HH:MM/);
  refused({ notify: { quietHours: { from: '23:00', to: '07:60' } } }, /notify\.quietHours\.to must be a time as HH:MM/);
  refused({ notify: { quietHours: { from: '23:00', to: '23:00' } } }, /must differ/);
  refused({ notify: { quietHours: { from: '23:00', to: '07:00', tz: 'UTC' } } }, /notify\.quietHours has an unknown field "tz"/);
  refused({ notify: { quietBypass: 'danger' } }, /notify\.quietBypass must be a list/);
  refused({ notify: { quietBypass: ['danger', 'everything'] } }, /notify\.quietBypass has an unknown kind "everything"/);
});

test('alarms: bad values are refused with a ConfigError', () => {
  refused({ alarms: { evalMs: 10 } }, /alarms\.evalMs must be an integer of at least 100/);
  refused({ alarms: { evalMs: 1000.5 } }, /alarms\.evalMs must be an integer/);
  refused({ alarms: { historyDays: 0 } }, /alarms\.historyDays must be an integer of at least 1/);
  refused({ alarms: [] }, /alarms must be an object/);
});

test('the fragment does not import server/config.mjs', () => {
  const src = fs.readFileSync(new URL('../server/config/observability.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from\s+['"][./]*config\.mjs['"]/);
  assert.doesNotMatch(src, /import\(\s*['"][./]*config\.mjs['"]/);
});
