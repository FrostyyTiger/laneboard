// Flag module: `paused` on sessions (fleet plan §8 2.3).
//
// A session decorator sets `paused: {scope:'session'|'all', kind, by, at}|null`
// from the pause sentinels under config.stateDir (server/control/pause.mjs).
// A builder-wide `paused/ALL` wins over a session's own pause, as in
// deploy/hooks/gate.sh. The tick hook runs pause.syncMirrors so every paused
// name has its `paused/sid-<claudeSessionId>` mirror for the gate.
//
// The sentinels are files any process of this uid may write (the CLI writes
// them with the server down), so their content is untrusted: pause.list()
// normalizes and bounds it, and only kind/by/at are put on the session.
import * as pause from '../control/pause.mjs';
import { config as globalConfig } from '../config.mjs';

// list() is one readdir (ENOENT when nothing is paused) plus one small read per
// sentinel. Cached for a second so a snapshot of N sessions reads the
// directory once; refreshed after every tick's syncMirrors.
export const CACHE_MS = 1000;

let stateDir = null;
let cache = null; // { at, entries }

function entries() {
  const t = Date.now();
  if (cache && t - cache.at >= 0 && t - cache.at < CACHE_MS) return cache.entries;
  let list = [];
  try {
    list = pause.list({ stateDir, mirrors: true });
  } catch {
    list = cache?.entries ?? [];
  }
  cache = { at: t, entries: list };
  return list;
}

/** Forget the cached sentinel list (after a pause/resume written in-process). */
export function invalidate() {
  cache = null;
}

/** The `paused` value for session `s`: {scope, kind, by, at} or null. */
export function pausedFor(s) {
  const list = entries();
  if (!list.length) return null;
  const sid = s?.claude?.sessionId ?? s?.sessionId ?? null;
  const hit = pause.isPaused(s?.name ?? null, typeof sid === 'string' && pause.SID_RE.test(sid) ? sid : null, list);
  return hit ? { scope: hit.scope, kind: hit.kind, by: hit.by ?? null, at: hit.at ?? null } : null;
}

/** Session decorator: owns `paused` on every call. */
export function decorate(s) {
  return { paused: pausedFor(s) };
}

/** Tick hook: mirror session pauses by Claude session id, then re-read. */
export function tick(ctx, now = Date.now()) {
  try {
    pause.syncMirrors(ctx?.sessions ?? [], { stateDir, now });
  } finally {
    invalidate();
  }
}

export default {
  name: 'flag-paused',
  modes: ['builder'],
  register(ctx) {
    stateDir = ctx.config?.stateDir ?? globalConfig.stateDir ?? pause.defaultStateDir();
    invalidate();
    ctx.state.addDecorator('paused', { session: decorate });
    ctx.state.onTick(tick);
  },
  stop() {
    invalidate();
  },
};
