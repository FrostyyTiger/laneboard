// Replay cache for signed hub requests (fleet plan §2 2.4). REVIEW-REQUIRED.
//
// An insertion-ordered Map id -> retainFrom (ms). The caller (auth.mjs) inserts a nonce only AFTER the
// signature and the ts window have been verified, so nothing unauthenticated ever enters this cache.
//
// Rules, each one load-bearing for replay protection:
// - `add` is check-and-insert in one call: a nonce already held answers `replay`, never `ok`.
// - A live (unexpired) nonce is NEVER evicted. When `max` unexpired nonces are held, `add` answers `full`
//   (the caller turns that into 503 `nonce cache full`): evicting a live nonce would re-open its replay window.
// - Retention: an entry is kept for `ttlMs` from max(ts, now at insertion), the future part clamped to `ttlMs`.
//   So a nonce is always held at least `ttlMs` after it was accepted and at least `ttlMs` after its own ts.
//   With ttlMs (5 min) > 2 x clockSkewMs (2 x 60 s) every nonce outlives the window in which its ts is accepted.
// - A clock that steps backwards only makes entries live longer (fail closed).
// - Ids are compared case-insensitively (UUIDs): two spellings of one UUID are one nonce.
//
// No timers: expired entries are dropped from the head on each `add`, and the whole Map is swept before
// `full` is ever answered, so `full` always means `max` live nonces.

const MAX_ID_LENGTH = 128;

function positiveInt(name, v) {
  if (!Number.isSafeInteger(v) || v <= 0) throw new TypeError(`nonce cache: ${name} must be a positive integer`);
  return v;
}

function normId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    throw new TypeError('nonce cache: id must be a non-empty string of at most 128 characters');
  }
  return id.toLowerCase();
}

/**
 * createNonceCache({max = 10000, ttlMs = 300000, now = Date.now}) -> {seen(id), add(id, ts), size()}
 *
 * - seen(id) -> boolean: the id is held and not expired (no insert).
 * - add(id, ts) -> {ok: true} | {ok: false, error: 'replay' | 'full'}
 *   ts: the request's (already verified) timestamp in ms; a non-finite ts counts as "now".
 * - size() -> number of live (unexpired) nonces held.
 */
export function createNonceCache({ max = 10000, ttlMs = 300000, now = Date.now } = {}) {
  positiveInt('max', max);
  positiveInt('ttlMs', ttlMs);
  if (typeof now !== 'function') throw new TypeError('nonce cache: now must be a function');

  const entries = new Map(); // normalized id -> retainFrom

  const clock = () => {
    const t = now();
    if (!Number.isFinite(t)) throw new TypeError('nonce cache: now() must return a finite number');
    return t;
  };
  const expired = (retainFrom, t) => t - retainFrom > ttlMs;

  function pruneHead(t) {
    for (const [id, retainFrom] of entries) {
      if (!expired(retainFrom, t)) break;
      entries.delete(id);
    }
  }

  function sweep(t) {
    for (const [id, retainFrom] of entries) {
      if (expired(retainFrom, t)) entries.delete(id);
    }
  }

  function seen(id) {
    const key = normId(id);
    const retainFrom = entries.get(key);
    if (retainFrom === undefined) return false;
    return !expired(retainFrom, clock());
  }

  function add(id, ts) {
    const key = normId(id);
    const t = clock();
    pruneHead(t);
    const held = entries.get(key);
    if (held !== undefined) {
      if (!expired(held, t)) return { ok: false, error: 'replay' };
      entries.delete(key);
    }
    if (entries.size >= max) {
      sweep(t);
      if (entries.size >= max) return { ok: false, error: 'full' };
    }
    const base = Number.isFinite(ts) ? Math.max(ts, t) : t;
    entries.set(key, Math.min(base, t + ttlMs));
    return { ok: true };
  }

  function size() {
    sweep(clock());
    return entries.size;
  }

  return { seen, add, size };
}
