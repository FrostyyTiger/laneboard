// Config fragment: observability (fleet plan §7, O2). Stuck detection, builder
// health, local web push, fleet notifications and alarms.
//
//   stuck    the builder's stuck detector (server/fleet/stuck.mjs, O4): the
//            rule thresholds, and whether a matching rule may auto-pause
//            (autoPause, only for the rules in autoPauseRules)
//   health   the builder health sampler (server/collector/health.mjs, O6):
//            sampleMs, historyMin (ring length), dockerSocket / dockerRoot
//            (null = skip), worktreeDir (null = codeDir), tailscale, and
//            thresholds {key: {warn, crit}} (crit null = warn only)
//   push     push.local: true/false forces the builder's own web push on or
//            off; null (the default) = auto, true iff fleet.hubKeys is empty
//            (resolvePushLocal below; the guard lives in server/push.mjs, O3)
//   notify   hub notifications (server/hub/notify.mjs, O9): kinds {kind:
//            bool}, quietHours null | {from:'HH:MM', to:'HH:MM'} (in
//            config.timezone, may cross midnight), quietBypass [kind]
//   alarms   hub alarm evaluation: evalMs (throttle), historyDays
//
// No env layer. Every default leaves today's behaviour as it is: stuck only
// shows a badge, nothing auto-pauses, quiet hours are off, and a standalone
// builder keeps sending its own pushes. This file must not import
// server/config.mjs (see the fragment notes there).
import path from 'node:path';

/** The stuck rules, in priority order (mirrors server/fleet/stuck.mjs RULES). */
export const STUCK_RULES = Object.freeze([
  'approval-wait', 'error-loop', 'tool-loop', 'oscillation', 'stalled',
  'context-pressure', 'cost-no-progress', 'idle-in-working',
]);

/** Every alarm kind (mirrors server/fleet/alarms.mjs KINDS, §7.3.5). */
export const ALARM_KINDS = Object.freeze([
  'danger', 'builder-down', 'budget-exceeded', 'audit-fork',
  'approval', 'needs-input', 'blocked', 'failed', 'stuck', 'health-crit', 'ci-red-main',
  'builder-stale', 'health-warn', 'ci-red', 'conflict', 'review-overdue',
  'review', 'budget-warn', 'reboot',
]);

/** The kinds that notify by default (§7.3.6). */
export const NOTIFY_DEFAULT_KINDS = Object.freeze([
  'needs-input', 'approval', 'failed', 'review', 'stuck', 'builder-down', 'danger',
]);

/**
 * Health thresholds (table 7.3.3). `dir` says which way is worse: 'up' means
 * a value at or above the threshold raises, 'down' at or below. `pct` keys
 * are bounded by 100. `crit: null` means the key only ever warns.
 */
export const HEALTH_THRESHOLDS = Object.freeze({
  swapInPerSec: { dir: 'up', pct: false },
  memAvailPct: { dir: 'down', pct: true },
  psiMemFull10: { dir: 'up', pct: true },
  psiIoFull10: { dir: 'up', pct: true },
  psiCpuSome10: { dir: 'up', pct: true },
  loadPerCpu: { dir: 'up', pct: false },
  fsUsedPct: { dir: 'up', pct: true },
  dockerUnhealthy: { dir: 'up', pct: false },
  rebootRequired: { dir: 'flag', pct: false },
});

export const QUIET_RX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SAMPLE_MS_MIN = 1000;
export const EVAL_MS_MIN = 100;

export function defaults() {
  return {
    stuck: {
      enabled: true,
      autoPause: false,
      autoPauseRules: ['tool-loop', 'error-loop'],
      approvalWaitMin: 5,
      errorLoopCount: 3,
      errorLoopWindowMin: 15,
      toolLoopCount: 5,
      oscillationRepeats: 3,
      stalledMin: 10,
      stalledToolMin: 30,
      contextPct: 85,
      compactMin: 20,
      costWindowMin: 30,
      costUsd: 5,
      idleMin: 20,
    },
    health: {
      sampleMs: 10000,
      historyMin: 60,
      dockerSocket: '/var/run/docker.sock',
      dockerRoot: '/var/lib/docker',
      worktreeDir: null,
      tailscale: true,
      thresholds: {
        swapInPerSec: { warn: 50, crit: 500 },
        memAvailPct: { warn: 15, crit: 5 },
        psiMemFull10: { warn: 5, crit: 20 },
        psiIoFull10: { warn: 10, crit: 30 },
        psiCpuSome10: { warn: 50, crit: 80 },
        loadPerCpu: { warn: 1.5, crit: 3 },
        fsUsedPct: { warn: 85, crit: 95 },
        dockerUnhealthy: { warn: 1, crit: null },
        rebootRequired: { warn: true, crit: null },
      },
    },
    push: { local: null },
    notify: {
      kinds: Object.fromEntries(ALARM_KINDS.map((k) => [k, NOTIFY_DEFAULT_KINDS.includes(k)])),
      quietHours: null,
      quietBypass: ['danger', 'builder-down'],
    },
    alarms: { evalMs: 1000, historyDays: 30 },
  };
}

export function fromEnv() {
  return {};
}

/**
 * Whether this builder sends its own web pushes: push.local when it is a
 * boolean, else true iff no hub key is configured (fleet.hubKeys empty).
 */
export function resolvePushLocal(c) {
  const v = c?.push?.local;
  if (typeof v === 'boolean') return v;
  const keys = c?.fleet?.hubKeys;
  return !(Array.isArray(keys) && keys.length > 0);
}

/** Minutes since midnight for an 'HH:MM' string (assumes QUIET_RX matched). */
export function quietMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const show = (v) => JSON.stringify(v) ?? String(v);

function obj(bad, key, v) {
  if (!isObj(v)) bad(`${key} must be an object, got ${show(v)}`);
}

function bool(bad, key, v) {
  if (typeof v !== 'boolean') bad(`${key} must be true or false, got ${show(v)}`);
}

function positive(bad, key, v, what = 'a positive number') {
  if (!isNum(v) || v <= 0) bad(`${key} must be ${what}, got ${show(v)}`);
}

function posInt(bad, key, v, min = 1) {
  if (!Number.isInteger(v) || v < min) bad(`${key} must be an integer of at least ${min}, got ${show(v)}`);
}

function pct(bad, key, v) {
  if (!isNum(v) || v <= 0 || v > 100) bad(`${key} must be a percentage above 0 and at most 100, got ${show(v)}`);
}

function absPathOrNull(bad, key, v) {
  if (v === null) return;
  if (typeof v !== 'string' || v === '' || v.includes('\0') || !path.isAbsolute(v)) {
    bad(`${key} must be an absolute path or null, got ${show(v)}`);
  }
}

function kindList(bad, key, v, known, what) {
  if (!Array.isArray(v)) bad(`${key} must be a list, got ${show(v)}`);
  for (const k of v) {
    if (!known.includes(k)) bad(`${key} has an unknown ${what} ${show(k)}; known: ${known.join(', ')}`);
  }
}

function validateStuck(s, bad) {
  obj(bad, 'stuck', s);
  bool(bad, 'stuck.enabled', s.enabled);
  bool(bad, 'stuck.autoPause', s.autoPause);
  kindList(bad, 'stuck.autoPauseRules', s.autoPauseRules, STUCK_RULES, 'rule');
  for (const k of ['approvalWaitMin', 'errorLoopWindowMin', 'stalledMin', 'stalledToolMin', 'compactMin', 'costWindowMin', 'idleMin']) {
    positive(bad, `stuck.${k}`, s[k], 'a positive number of minutes');
  }
  posInt(bad, 'stuck.errorLoopCount', s.errorLoopCount, 2);
  posInt(bad, 'stuck.toolLoopCount', s.toolLoopCount, 2);
  posInt(bad, 'stuck.oscillationRepeats', s.oscillationRepeats, 2);
  pct(bad, 'stuck.contextPct', s.contextPct);
  positive(bad, 'stuck.costUsd', s.costUsd, 'a positive number of dollars');
  if (s.stalledToolMin < s.stalledMin) {
    bad(`stuck.stalledToolMin (${s.stalledToolMin}) must not be below stuck.stalledMin (${s.stalledMin})`);
  }
}

function validateThresholds(t, bad) {
  obj(bad, 'health.thresholds', t);
  for (const k of Object.keys(t)) {
    if (!Object.hasOwn(HEALTH_THRESHOLDS, k)) {
      bad(`health.thresholds has an unknown key ${show(k)}; known: ${Object.keys(HEALTH_THRESHOLDS).join(', ')}`);
    }
  }
  for (const [k, spec] of Object.entries(HEALTH_THRESHOLDS)) {
    const key = `health.thresholds.${k}`;
    const v = t[k];
    obj(bad, key, v);
    for (const f of Object.keys(v)) {
      if (f !== 'warn' && f !== 'crit') bad(`${key} has an unknown field ${show(f)}; it takes warn and crit`);
    }
    if (spec.dir === 'flag') {
      bool(bad, `${key}.warn`, v.warn);
      if (v.crit !== null && typeof v.crit !== 'boolean') bad(`${key}.crit must be true, false or null, got ${show(v.crit)}`);
      continue;
    }
    const check = spec.pct ? pct : (b, kk, x) => positive(b, kk, x);
    check(bad, `${key}.warn`, v.warn);
    if (v.crit === null) continue;
    check(bad, `${key}.crit`, v.crit);
    if (spec.dir === 'up' && v.warn > v.crit) bad(`${key}.warn (${v.warn}) must not exceed ${key}.crit (${v.crit})`);
    if (spec.dir === 'down' && v.warn < v.crit) bad(`${key}.warn (${v.warn}) must not be below ${key}.crit (${v.crit}): lower is worse`);
  }
}

function validateHealth(h, bad) {
  obj(bad, 'health', h);
  posInt(bad, 'health.sampleMs', h.sampleMs, SAMPLE_MS_MIN);
  positive(bad, 'health.historyMin', h.historyMin, 'a positive number of minutes');
  absPathOrNull(bad, 'health.dockerSocket', h.dockerSocket);
  absPathOrNull(bad, 'health.dockerRoot', h.dockerRoot);
  absPathOrNull(bad, 'health.worktreeDir', h.worktreeDir);
  bool(bad, 'health.tailscale', h.tailscale);
  validateThresholds(h.thresholds, bad);
}

function validateNotify(n, bad) {
  obj(bad, 'notify', n);
  obj(bad, 'notify.kinds', n.kinds);
  for (const [k, v] of Object.entries(n.kinds)) {
    if (!ALARM_KINDS.includes(k)) bad(`notify.kinds has an unknown kind ${show(k)}; known: ${ALARM_KINDS.join(', ')}`);
    bool(bad, `notify.kinds.${k}`, v);
  }
  const q = n.quietHours;
  if (q !== null) {
    obj(bad, 'notify.quietHours', q);
    for (const f of Object.keys(q)) {
      if (f !== 'from' && f !== 'to') bad(`notify.quietHours has an unknown field ${show(f)}; it takes from and to`);
    }
    for (const f of ['from', 'to']) {
      if (typeof q[f] !== 'string' || !QUIET_RX.test(q[f])) bad(`notify.quietHours.${f} must be a time as HH:MM (00:00..23:59), got ${show(q[f])}`);
    }
    if (q.from === q.to) bad(`notify.quietHours.from and .to must differ (both ${q.from}); use null for no quiet hours`);
  }
  kindList(bad, 'notify.quietBypass', n.quietBypass, ALARM_KINDS, 'kind');
}

export function validate(c, bad) {
  validateStuck(c.stuck, bad);
  validateHealth(c.health, bad);
  obj(bad, 'push', c.push);
  if (c.push.local !== null && typeof c.push.local !== 'boolean') {
    bad(`push.local must be true, false or null (auto: on iff fleet.hubKeys is empty), got ${show(c.push.local)}`);
  }
  validateNotify(c.notify, bad);
  const a = c.alarms;
  obj(bad, 'alarms', a);
  posInt(bad, 'alarms.evalMs', a.evalMs, EVAL_MS_MIN);
  posInt(bad, 'alarms.historyDays', a.historyDays, 1);
}
