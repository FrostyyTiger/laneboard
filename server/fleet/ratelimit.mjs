// In-memory action rate limits (fleet plan §2 2.7).
//
// Each rule is a token bucket of `limit` tokens refilled evenly over `windowMs`, implemented as GCRA (one
// "theoretical arrival time" per bucket, integer maths for the default rules). Buckets are keyed
// (rule, user) or (rule, user, target) through JSON.stringify, so no separator in a user or target string can
// make two keys collide. Injected `now`, no timers.
//
// Which rules a take() consults:
//   kind 'local' (CLI, hooks)  -> only `global` (the plan: local is exempt from all but the global cap)
//   kind 'direct' (default)    -> the action's own rule, `all` when target is '*', `fanout`, `global`
//   kind 'hub'                 -> as 'direct', plus `hub` (one bucket shared by all hub traffic)
// `send-text` with a fanout parent: the parent counts once. The first child of a parent (per user) is charged
// against `fanout`, `global` and `hub` (and its own per-target bucket); later children of the same parent are
// charged only against their per-target bucket, and at most MAX_FANOUT children ride on one parent (the hub's
// broadcast cap is 30 targets). A parent is remembered for PARENT_TTL_MS; a late child is charged as a new parent.
//
// A take is all-or-nothing: tokens are consumed only when every consulted bucket has one, so refused requests
// never drain a bucket. When refused, retryAfterMs is the longest wait among the buckets that are empty.

export const DEFAULT_RULES = Object.freeze({
  'send-text': Object.freeze({ limit: 30, windowMs: 60000, per: 'target' }),
  'send-keys': Object.freeze({ limit: 30, windowMs: 60000, per: 'target' }),
  'interrupt': Object.freeze({ limit: 30, windowMs: 60000, per: 'target' }),
  'kill': Object.freeze({ limit: 5, windowMs: 60000, per: 'user' }),
  'restart': Object.freeze({ limit: 5, windowMs: 60000, per: 'user' }),
  'retire': Object.freeze({ limit: 5, windowMs: 60000, per: 'user' }),
  'run-script': Object.freeze({ limit: 5, windowMs: 60000, per: 'user' }),
  'send-review': Object.freeze({ limit: 5, windowMs: 60000, per: 'user' }),
  'spawn': Object.freeze({ limit: 3, windowMs: 60000, per: 'user' }),
  'launch': Object.freeze({ limit: 3, windowMs: 60000, per: 'user' }),
  // special rules
  'fanout': Object.freeze({ limit: 1, windowMs: 10000, per: 'user' }),   // distinct fan-out parents
  'all': Object.freeze({ limit: 1, windowMs: 10000, per: 'user' }),      // any target '*'
  'global': Object.freeze({ limit: 120, windowMs: 60000, per: 'user' }), // every action of one user
  'hub': Object.freeze({ limit: 300, windowMs: 60000, per: 'any' }),     // all hub traffic together
});

const SPECIAL = new Set(['fanout', 'all', 'global', 'hub']);
const KINDS = new Set(['local', 'direct', 'hub']);
const PERS = new Set(['user', 'target']);
const NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_FANOUT = 30;
export const PARENT_TTL_MS = 60000;
const SWEEP_EVERY = 1024;

function checkRule(name, r) {
  if (!Number.isSafeInteger(r.limit) || r.limit < 1) throw new TypeError(`rateLimits.${name}.limit must be a positive integer`);
  if (!Number.isSafeInteger(r.windowMs) || r.windowMs < 1) throw new TypeError(`rateLimits.${name}.windowMs must be a positive integer`);
  if (SPECIAL.has(name)) {
    if (r.per !== DEFAULT_RULES[name].per) throw new TypeError(`rateLimits.${name}.per cannot be changed`);
  } else if (!PERS.has(r.per)) {
    throw new TypeError(`rateLimits.${name}.per must be "user" or "target"`);
  }
}

/**
 * Merge `fleet.rateLimits` overrides onto DEFAULT_RULES. Each override is `{limit?, windowMs?, per?}` keyed by
 * an action name (a new action defaults to per 'user') or a special rule (`fanout`, `all`, `global`, `hub`).
 * Throws TypeError on anything else, so a typo never silently disables a limit.
 */
export function resolveRules(overrides) {
  const rules = Object.create(null);
  for (const [name, r] of Object.entries(DEFAULT_RULES)) rules[name] = { ...r };
  if (overrides == null) return rules;
  if (typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('rateLimits must be an object');
  for (const name of Object.keys(overrides)) {
    if (!NAME_RE.test(name)) throw new TypeError(`rateLimits: invalid rule name ${JSON.stringify(name)}`);
    const o = overrides[name];
    if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new TypeError(`rateLimits.${name} must be an object`);
    for (const k of Object.keys(o)) {
      if (k !== 'limit' && k !== 'windowMs' && k !== 'per') throw new TypeError(`rateLimits.${name}: unknown key ${JSON.stringify(k)}`);
    }
    const base = Object.hasOwn(rules, name) ? rules[name] : { limit: undefined, windowMs: undefined, per: 'user' };
    const merged = { ...base, ...o };
    checkRule(name, merged);
    rules[name] = merged;
  }
  return rules;
}

function nonEmptyString(what, v) {
  if (typeof v !== 'string' || v.length === 0) throw new TypeError(`rate limiter: ${what} must be a non-empty string`);
  return v;
}

/**
 * createLimiter(rules, now = Date.now) -> {take(user, action, target, ctx?), size()}
 *
 * rules: `fleet.rateLimits` overrides (or null for the defaults), see resolveRules.
 * take(user, action, target, {kind = 'direct', fanoutParent} = {}) -> {ok, retryAfterMs, rule?}
 *   ok:true -> retryAfterMs 0, the tokens are consumed.
 *   ok:false -> nothing consumed; `rule` names the bucket that waits longest; the caller answers
 *   429 {error:'rate_limited', retryAfterMs}.
 *   fanoutParent: the envelope's `args.fanout.parent` for `send-text` (ignored for other actions).
 */
export function createLimiter(rules, now = Date.now) {
  if (typeof now !== 'function') throw new TypeError('rate limiter: now must be a function');
  const R = resolveRules(rules);
  const tat = new Map();     // bucket key -> theoretical arrival time (ms)
  const parents = new Map(); // JSON [user, parent] -> {until, children}
  let takes = 0;

  const clock = () => {
    const t = now();
    if (!Number.isFinite(t)) throw new TypeError('rate limiter: now() must return a finite number');
    return t;
  };

  function sweep(t) {
    for (const [key, v] of tat) if (v <= t) tat.delete(key);       // a refilled bucket equals a fresh one
    for (const [key, p] of parents) if (p.until <= t) parents.delete(key);
  }

  // GCRA: interval T = windowMs/limit; a request is allowed when the new TAT is at most windowMs ahead of now.
  function probe(name, key, t) {
    const r = R[name];
    const T = r.windowMs / r.limit;
    let cur = tat.get(key);
    // after a backwards clock step, never wait longer than one full window; the clamp is stored so the
    // bucket refills from the new clock (an unstored clamp would re-apply on every probe and never refill)
    if (cur !== undefined && cur > t + r.windowMs) {
      cur = t + r.windowMs;
      tat.set(key, cur);
    }
    const next = Math.max(cur ?? t, t) + T;
    const wait = next - r.windowMs - t;
    return { name, key, next, wait: wait > 0 ? Math.ceil(wait) : 0 };
  }

  function take(user, action, target, ctx = {}) {
    nonEmptyString('user', user);
    nonEmptyString('action', action);
    nonEmptyString('target', target);
    const { kind = 'direct', fanoutParent } = ctx ?? {};
    if (!KINDS.has(kind)) throw new TypeError(`rate limiter: unknown kind ${JSON.stringify(kind)}`);
    const t = clock();
    if (++takes % SWEEP_EVERY === 0) sweep(t);

    const wanted = []; // [ruleName, bucketKey]
    const bucket = (name, ...parts) => wanted.push([name, JSON.stringify([name, ...parts])]);

    let parentKey = null;
    let parentHeld = null;
    if (kind === 'local') {
      bucket('global', user);
    } else {
      if (action === 'send-text' && fanoutParent !== undefined && fanoutParent !== null) {
        nonEmptyString('fanoutParent', fanoutParent);
        parentKey = JSON.stringify([user, fanoutParent]);
        const p = parents.get(parentKey);
        if (p && p.until > t && p.children < MAX_FANOUT) parentHeld = p;
      }
      if (Object.hasOwn(R, action) && !SPECIAL.has(action)) {
        const r = R[action];
        if (r.per === 'target') bucket(action, user, target);
        else if (!parentHeld) bucket(action, user);
      }
      if (!parentHeld) {
        if (target === '*') bucket('all', user);
        if (parentKey) bucket('fanout', user);
        bucket('global', user);
        if (kind === 'hub') bucket('hub');
      }
    }

    const probes = wanted.map(([name, key]) => probe(name, key, t));
    const blocked = probes.filter((p) => p.wait > 0);
    if (blocked.length) {
      const worst = blocked.reduce((a, b) => (b.wait > a.wait ? b : a));
      return { ok: false, retryAfterMs: worst.wait, rule: worst.name };
    }
    for (const p of probes) tat.set(p.key, p.next);
    if (parentKey) {
      if (parentHeld) parentHeld.children += 1;
      else parents.set(parentKey, { until: t + PARENT_TTL_MS, children: 1 });
    }
    return { ok: true, retryAfterMs: 0 };
  }

  function size() {
    sweep(clock());
    return tat.size + parents.size;
  }

  return { take, size };
}
