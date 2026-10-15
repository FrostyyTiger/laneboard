/**
 * Pause sentinels (fleet plan §8 2.3). Pure filesystem code with no server
 * imports beyond util.mjs, so `bin/laneboard` can pause and resume with the
 * server down.
 *
 * Layout under `stateDir` (default ~/.local/state/laneboard):
 *   paused/ALL            builder-wide pause
 *   paused/<sessionName>  one session
 *   paused/sid-<id>       mirror of a session pause keyed by Claude session id,
 *                         rewritten by syncMirrors() so deploy/hooks/gate.sh
 *                         does not depend on tmux
 *   ceiling/sid-<id>      JSON number: statusline cost at which the session
 *                         stops (written by the budget module via syncCeilings)
 *
 * Each sentinel holds `{"kind":"operator"|"budget"|"quota","by","at","reason"}`
 * (mirrors add `name`). Both directories are removed once empty so the gate's
 * fast path stays one `stat`.
 *
 * These are cooperative controls: anything running as this uid can delete the
 * files. The remote-only rules live in the dispatcher (C6/C7), not here.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import { isSafeSessionName } from '../util.mjs';

export const KINDS = Object.freeze(['operator', 'quota', 'budget']);
// A pause never downgrades: an operator pause written over a budget pause
// would otherwise let a plain operator resume lift the budget hold.
const RANK = { operator: 0, quota: 1, budget: 2 };

export const SID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MIRROR_PREFIX = 'sid-';
const MAX_BY = 128;
const MAX_REASON = 500;
const MAX_FILE = 4096;
const STALE_TMP_MS = 60_000;

export class PauseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PauseError';
    this.status = status;
  }
}

/** Default state dir; callers normally pass config.stateDir. */
export function defaultStateDir(env = process.env) {
  return env.LANEBOARD_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'laneboard');
}

function requireStateDir(stateDir) {
  if (typeof stateDir !== 'string' || !stateDir) throw new PauseError('stateDir required', 500);
  return stateDir;
}

const pausedDir = (stateDir) => path.join(requireStateDir(stateDir), 'paused');
const ceilingDir = (stateDir) => path.join(requireStateDir(stateDir), 'ceiling');

/**
 * A scope is 'ALL' or a session name. Names that would collide with the
 * layout (dot names, `sid-` mirrors, `ALL` itself is the builder scope) are
 * refused, as is anything isSafeSessionName refuses (so never a slash).
 */
export function isValidScope(scope) {
  if (scope === 'ALL') return true;
  if (!isSafeSessionName(scope)) return false;
  if (scope.startsWith('.') || scope.startsWith(MIRROR_PREFIX)) return false;
  return true;
}

export function pausePath(stateDir, scope) {
  if (!isValidScope(scope)) throw new PauseError('invalid pause scope');
  return path.join(pausedDir(stateDir), scope);
}

export function mirrorPath(stateDir, sessionId) {
  if (typeof sessionId !== 'string' || !SID_RE.test(sessionId)) throw new PauseError('invalid session id');
  return path.join(pausedDir(stateDir), MIRROR_PREFIX + sessionId);
}

export function ceilingPath(stateDir, sessionId) {
  if (typeof sessionId !== 'string' || !SID_RE.test(sessionId)) throw new PauseError('invalid session id');
  return path.join(ceilingDir(stateDir), MIRROR_PREFIX + sessionId);
}

function clampStr(v, max) {
  if (v == null) return null;
  return String(v).slice(0, max);
}

/** Atomic write (tmp + rename) into `dir`, creating it 0700 if needed. */
function writeAtomic(dir, file, content) {
  for (let attempt = 0; ; attempt++) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
      fs.writeFileSync(tmp, content, { mode: 0o600, flag: 'wx' });
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* already gone */ }
      // Another process may have removed the empty directory between mkdir
      // and write: retry once.
      if (err.code === 'ENOENT' && attempt === 0) continue;
      throw err;
    }
  }
}

function readJson(file) {
  let text;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_FILE) return { exists: true, data: null };
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { exists: false, data: null };
    return { exists: true, data: null };
  }
  try {
    return { exists: true, data: JSON.parse(text) };
  } catch {
    return { exists: true, data: null };
  }
}

/**
 * Normalize sentinel content. An unreadable sentinel still pauses (the gate
 * only checks existence); it is reported as kind 'operator', the default.
 */
function normalize(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    kind: KINDS.includes(d.kind) ? d.kind : 'operator',
    by: typeof d.by === 'string' ? d.by.slice(0, MAX_BY) : null,
    at: Number.isFinite(d.at) ? d.at : null,
    reason: typeof d.reason === 'string' ? d.reason.slice(0, MAX_REASON) : null,
  };
}

function removeDirIfEmpty(dir) {
  try {
    fs.rmdirSync(dir);
  } catch {
    /* not empty or already gone */
  }
}

function readEntries(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Write (or keep) the sentinel for `scope`. Never lowers an existing kind. */
export function pause(scope, { kind = 'operator', by = null, reason = null } = {}, { stateDir, now = Date.now() } = {}) {
  const file = pausePath(stateDir, scope);
  if (!KINDS.includes(kind)) throw new PauseError('invalid pause kind');
  const prev = readJson(file);
  if (prev.exists) {
    const old = normalize(prev.data);
    if (RANK[old.kind] > RANK[kind]) return { ok: true, scope, file, kept: true, kind: old.kind };
  }
  const entry = { kind, by: clampStr(by, MAX_BY), at: now, reason: clampStr(reason, MAX_REASON) };
  writeAtomic(path.dirname(file), file, JSON.stringify(entry) + '\n');
  return { ok: true, scope, file, kind };
}

/**
 * Remove the sentinel for `scope` when its kind is in `kinds` (all kinds when
 * omitted). A session resume also drops that session's sid- mirrors, so the
 * gate releases it before the next tick. 'ALL' removes only the builder-wide
 * sentinel; session pauses stay.
 */
export function resume(scope, { kinds } = {}, { stateDir } = {}) {
  const file = pausePath(stateDir, scope);
  const dir = path.dirname(file);
  const removed = [];
  const kept = [];
  const allow = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  const cur = readJson(file);
  if (cur.exists) {
    const { kind } = normalize(cur.data);
    if (allow && !allow.has(kind)) {
      kept.push({ scope, kind });
    } else {
      try {
        fs.unlinkSync(file);
        removed.push(scope);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }
  if (scope !== 'ALL' && !kept.length) {
    for (const f of readEntries(dir)) {
      if (!f.startsWith(MIRROR_PREFIX)) continue;
      const m = readJson(path.join(dir, f));
      if (m.data && m.data.name === scope) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* gone */ }
      }
    }
  }
  removeDirIfEmpty(dir);
  return { ok: true, removed, kept };
}

/**
 * Current pauses: [{scope, kind, by, at, reason}], 'ALL' first, then names
 * sorted. Mirrors are derived state and only listed with `mirrors: true`
 * (as {scope:'sid-<id>', mirror:true, name, ...}).
 */
export function list({ stateDir, mirrors = false } = {}) {
  const dir = pausedDir(stateDir);
  const out = [];
  for (const f of readEntries(dir).sort()) {
    if (f.startsWith('.')) continue;
    const isMirror = f.startsWith(MIRROR_PREFIX);
    if (isMirror ? !mirrors : !isValidScope(f)) continue;
    const { data } = readJson(path.join(dir, f));
    const entry = { scope: f, ...normalize(data) };
    if (isMirror) {
      entry.mirror = true;
      entry.name = data && typeof data.name === 'string' ? data.name : null;
    }
    out.push(entry);
  }
  out.sort((a, b) => (a.scope === 'ALL' ? -1 : b.scope === 'ALL' ? 1 : 0));
  return out;
}

/** Kind of the sentinel for `scope` ('ALL' or a name), or null. */
export function kindOf(scope, { stateDir } = {}) {
  if (!isValidScope(scope)) return null;
  const r = readJson(pausePath(stateDir, scope));
  return r.exists ? normalize(r.data).kind : null;
}

function sessionIdOf(s) {
  const id = s?.sessionId ?? s?.claude?.sessionId ?? null;
  return typeof id === 'string' && SID_RE.test(id) ? id : null;
}

/**
 * Each tick: write `sid-<id>` for every session whose name is paused, and
 * delete every other mirror (orphans, resumed sessions). `sessions` is an
 * iterable of {name, sessionId} or state sessions ({name, claude:{sessionId}}).
 * Unchanged mirrors are not rewritten.
 */
export function syncMirrors(sessions, { stateDir, now = Date.now() } = {}) {
  const dir = pausedDir(stateDir);
  const names = readEntries(dir);
  if (!names.length) return { written: [], removed: [] };
  const want = new Map();
  for (const s of sessions ?? []) {
    const name = s?.name;
    const sid = sessionIdOf(s);
    if (!sid || !isValidScope(name) || name === 'ALL') continue;
    const r = readJson(path.join(dir, name));
    if (!r.exists) continue;
    want.set(MIRROR_PREFIX + sid, JSON.stringify({ ...normalize(r.data), name }) + '\n');
  }
  const written = [];
  const removed = [];
  for (const [f, content] of want) {
    const file = path.join(dir, f);
    let cur = null;
    try { cur = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (cur === content) continue;
    writeAtomic(dir, file, content);
    written.push(f);
  }
  for (const f of names) {
    const file = path.join(dir, f);
    if (f.startsWith(MIRROR_PREFIX) && !want.has(f)) {
      try { fs.unlinkSync(file); removed.push(f); } catch { /* gone */ }
    } else if (f.startsWith('.') && f.endsWith('.tmp')) {
      // Leftover from a crashed writer: it would keep the directory alive.
      try {
        if (now - fs.lstatSync(file).mtimeMs > STALE_TMP_MS) fs.unlinkSync(file);
      } catch { /* gone */ }
    }
  }
  removeDirIfEmpty(dir);
  return { written, removed };
}

/**
 * Pure: is `name` / `sessionId` paused according to `entries` (from list(),
 * optionally with mirrors)? Builder-wide wins, as in the gate.
 * Returns {scope:'all'|'session', kind, by, at, reason} or null.
 */
export function isPaused(name, sessionId, entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const pick = (e, scope) => ({ scope, kind: e.kind, by: e.by ?? null, at: e.at ?? null, reason: e.reason ?? null });
  const all = entries.find((e) => e.scope === 'ALL');
  if (all) return pick(all, 'all');
  if (name && name !== 'ALL') {
    const own = entries.find((e) => e.scope === name && !e.mirror);
    if (own) return pick(own, 'session');
  }
  if (sessionId) {
    const m = entries.find((e) => e.scope === MIRROR_PREFIX + sessionId);
    if (m) return pick(m, 'session');
  }
  return null;
}

/**
 * Replace the ceiling files with `ceilings` (Map or object sessionId -> usd).
 * Sessions not in the map lose their ceiling; the directory goes when empty.
 */
export function syncCeilings(ceilings, { stateDir } = {}) {
  const dir = ceilingDir(stateDir);
  const want = new Map();
  const entries = ceilings instanceof Map ? ceilings : Object.entries(ceilings ?? {});
  for (const [sid, usd] of entries) {
    if (typeof sid !== 'string' || !SID_RE.test(sid) || !Number.isFinite(usd)) continue;
    want.set(MIRROR_PREFIX + sid, JSON.stringify(usd) + '\n');
  }
  const written = [];
  const removed = [];
  for (const [f, content] of want) {
    const file = path.join(dir, f);
    let cur = null;
    try { cur = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (cur === content) continue;
    writeAtomic(dir, file, content);
    written.push(f);
  }
  for (const f of readEntries(dir)) {
    if (f.startsWith(MIRROR_PREFIX) && !want.has(f)) {
      try { fs.unlinkSync(path.join(dir, f)); removed.push(f); } catch { /* gone */ }
    }
  }
  removeDirIfEmpty(dir);
  return { written, removed };
}
