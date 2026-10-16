// Config fragment: control (fleet plan §8). Pause sentinels, held permission
// approvals and budget caps.
//
//   stateDir    where pause/ceiling sentinels (and §2's audit log) live.
//               Default paths.stateDir() ($XDG_STATE_HOME/laneboard, else
//               ~/.local/state/laneboard, the same as server/control/pause.mjs
//               defaultStateDir()); env LANEBOARD_STATE_DIR wins, as it does
//               there. A leading `~/` is expanded; a relative path from the
//               env resolves against the working directory, one from the
//               config file is refused.
//   approvals   {enabled, holdSec (clamped to 30..1800), onTimeout
//               'prompt'|'deny', previewMaxLines}
//   budget      {window (a util.WINDOWS name), perLaneUsd, perBuilderUsd
//               (null = no cap), warnPct, pausePct, quota: {enabled,
//               fiveHourPct, resumeBelowPct, autoResume}}
//
// Every default leaves behaviour as it was: approvals fall through to the
// terminal prompt on timeout, no caps are set and the quota guard is off.
// This file must not import server/config.mjs (see the fragment notes there).
import os from 'node:os';
import path from 'node:path';

import * as paths from '../fleet/paths.mjs';
import { WINDOWS } from '../util.mjs';

export const HOLD_MIN_SEC = 30;
export const HOLD_MAX_SEC = 1800;
export const ON_TIMEOUT = Object.freeze(['prompt', 'deny']);
export const PREVIEW_MAX_LINES = 5000;
export const PAUSE_PCT_MAX = 1000;

export function defaults() {
  return {
    stateDir: paths.stateDir(),
    approvals: { enabled: true, holdSec: 600, onTimeout: 'prompt', previewMaxLines: 300 },
    budget: {
      window: 'tonight',
      perLaneUsd: null,
      perBuilderUsd: null,
      warnPct: 80,
      pausePct: 100,
      quota: { enabled: false, fiveHourPct: 90, resumeBelowPct: 70, autoResume: false },
    },
  };
}

export function fromEnv(env = process.env) {
  const v = env.LANEBOARD_STATE_DIR;
  return typeof v === 'string' && v !== '' ? { stateDir: v } : {};
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Derived values: `~` expansion, env-relative stateDir, the holdSec clamp. */
export function finalize(c, layers = {}) {
  if (typeof c.stateDir === 'string' && c.stateDir !== '') {
    let p = expandHome(c.stateDir.trim());
    const fromEnvLayer = layers.env?.stateDir !== undefined;
    if (fromEnvLayer && !path.isAbsolute(p)) p = path.resolve(p);
    c.stateDir = path.isAbsolute(p) ? path.normalize(p) : p;
  }
  if (isObj(c.approvals) && isNum(c.approvals.holdSec)) {
    c.approvals.holdSec = Math.min(HOLD_MAX_SEC, Math.max(HOLD_MIN_SEC, Math.round(c.approvals.holdSec)));
  }
  return c;
}

const show = (v) => JSON.stringify(v) ?? String(v);

function pct(bad, key, v, lo, hi) {
  if (!isNum(v) || v < lo || v > hi) bad(`${key} must be a number from ${lo} to ${hi}, got ${show(v)}`);
}

function bool(bad, key, v) {
  if (typeof v !== 'boolean') bad(`${key} must be true or false, got ${show(v)}`);
}

function usd(bad, key, v) {
  if (v !== null && (!isNum(v) || v <= 0)) bad(`${key} must be a positive number of dollars or null, got ${show(v)}`);
}

export function validate(c, bad) {
  if (typeof c.stateDir !== 'string' || c.stateDir === '') {
    bad(`stateDir must be a directory path, got ${show(c.stateDir)}`);
  }
  if (!path.isAbsolute(c.stateDir)) {
    bad(`stateDir must be an absolute path (or start with ~/), got ${show(c.stateDir)}`);
  }
  if (c.stateDir.includes('\0')) bad('stateDir must not contain a NUL byte');

  const a = c.approvals;
  if (!isObj(a)) bad(`approvals must be an object, got ${show(a)}`);
  bool(bad, 'approvals.enabled', a.enabled);
  if (!isNum(a.holdSec)) bad(`approvals.holdSec must be a number of seconds (${HOLD_MIN_SEC}..${HOLD_MAX_SEC}), got ${show(a.holdSec)}`);
  if (!ON_TIMEOUT.includes(a.onTimeout)) {
    bad(`approvals.onTimeout must be one of ${ON_TIMEOUT.join(', ')}, got ${show(a.onTimeout)}`);
  }
  if (!Number.isInteger(a.previewMaxLines) || a.previewMaxLines < 1 || a.previewMaxLines > PREVIEW_MAX_LINES) {
    bad(`approvals.previewMaxLines must be an integer from 1 to ${PREVIEW_MAX_LINES}, got ${show(a.previewMaxLines)}`);
  }

  const b = c.budget;
  if (!isObj(b)) bad(`budget must be an object, got ${show(b)}`);
  if (!WINDOWS.includes(b.window)) bad(`budget.window must be one of ${WINDOWS.join(', ')}, got ${show(b.window)}`);
  usd(bad, 'budget.perLaneUsd', b.perLaneUsd);
  usd(bad, 'budget.perBuilderUsd', b.perBuilderUsd);
  pct(bad, 'budget.warnPct', b.warnPct, 1, 100);
  pct(bad, 'budget.pausePct', b.pausePct, 1, PAUSE_PCT_MAX);
  if (b.warnPct > b.pausePct) bad(`budget.warnPct (${b.warnPct}) must not exceed budget.pausePct (${b.pausePct})`);

  const q = b.quota;
  if (!isObj(q)) bad(`budget.quota must be an object, got ${show(q)}`);
  bool(bad, 'budget.quota.enabled', q.enabled);
  pct(bad, 'budget.quota.fiveHourPct', q.fiveHourPct, 1, 100);
  pct(bad, 'budget.quota.resumeBelowPct', q.resumeBelowPct, 0, 100);
  if (q.resumeBelowPct >= q.fiveHourPct) {
    bad(`budget.quota.resumeBelowPct (${q.resumeBelowPct}) must be below budget.quota.fiveHourPct (${q.fiveHourPct})`);
  }
  bool(bad, 'budget.quota.autoResume', q.autoResume);
}
