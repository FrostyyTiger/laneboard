// The generic adapter for an engine that speaks the contract (docs/engines.md).
//
// `createContractEngine({id, kind, call})` turns one function, `call(verb,
// args, meta)` (resolves to the engine's raw answer: the CLI's stdout or a
// parsed envelope), into a laneboard engine with every member of the
// interface. `fake` gives it a call that reads fixtures; the `foundry-cli`
// adapter (phase 9) gives it one that runs `execJson` (exec.mjs).
//
// What it adds around `call`:
//   - the version handshake: `hello` first, and again after the engine was
//     unreachable; another major is `incompatible`: no reads, no writes;
//   - the envelope and shape checks of contract.mjs, the dropped-row counts
//     and `degraded` for an answer that is not its verb's shape;
//   - a timeout on every call, and no two reads of the same verb and
//     arguments at once (a slow call is waited out, not stacked);
//   - the last good answer per read, served with `stale: true` and its age
//     while the engine does not answer;
//   - `status()`: up, stale, down, degraded, incompatible or unknown.
//
// Every read resolves to `{ok: true, data, at, ...}` or `{ok: false, code,
// reason}`; `act` to the engine's result (`{ok, verb, target, request, by,
// via, replayed, result | code + reason}`) or to a local refusal `{ok: false,
// code, reason}` (contract.mjs LOCAL_CODES). Nothing throws, whatever `call` does.
import {
  ACCEPTED, READ_VERBS, WRITE_VERBS, checkVersion, parseEnvelope, toShape,
} from './contract.mjs';

export const DEFAULTS = Object.freeze({ timeoutMs: 10_000, staleMs: 30_000, downMs: 120_000 });

/** Every member the interface has, in the order GET /api/engines lists them. */
export const MEMBERS = Object.freeze(['hello', 'health', 'products', 'runs', 'run', 'events', 'waiting', 'knowledge', 'act']);

/** An argument that may reach an engine's argument list: no flag, no path tricks, bounded. */
const ARG = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
export const safeArg = (v) => typeof v === 'string' && ARG.test(v) && !v.includes('..');

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;

export const refuse = (code, reason) => ({ ok: false, code, reason });
export const unsupported = (id, member) => refuse('unsupported', `engine ${id} has no ${member}`);

/** A message from anything thrown, short and single-line. */
export const why = (err) => String(err?.message ?? err ?? 'error').split('\n')[0].slice(0, 300);

function withTimeout(promise, ms) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: 'timeout' })), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/** Check a knowledge filter: `{kind, status, id, limit, cursor}`, each optional. */
function knowledgeFilter(f = {}) {
  const out = {};
  for (const k of ['kind', 'status', 'id', 'cursor']) {
    if (f[k] === undefined || f[k] === null || f[k] === '') continue;
    if (!safeArg(f[k])) return null;
    out[k] = f[k];
  }
  if (f.limit !== undefined && f.limit !== null && f.limit !== '') {
    const n = Number(f.limit);
    if (!Number.isInteger(n) || n < 1 || n > 500) return null;
    out.limit = n;
  }
  return out;
}

/**
 * opts: `{id, kind, call, timeoutMs, staleMs, downMs, now}`. `call` may
 * return, throw, reject or never settle; an error with `code: 'not-found'`
 * is the engine saying the thing asked for does not exist (the CLI's exit 2),
 * anything else means the engine did not answer.
 */
export function createContractEngine(opts) {
  const { id, kind, call } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const staleMs = opts.staleMs ?? DEFAULTS.staleMs;
  const downMs = opts.downMs ?? DEFAULTS.downMs;
  const now = opts.now ?? (() => Date.now());

  const st = {
    hello: null,            // the accepted hello (laneboard shape), null until the handshake
    incompatible: null,     // the reason, while the engine speaks another major
    degraded: new Map(),    // verb -> reason, until that verb answers well again
    dropped: {},            // verb -> rows dropped so far
    lastGoodAt: null,
    lastFailAt: null,
    lastError: null,
    cannotStart: false,
  };
  const snapshots = new Map(); // read key -> {data, at, gotAt}
  const inflight = new Map();  // read key -> promise of the raw answer

  function good() { st.lastGoodAt = now(); st.lastError = null; }
  function fail(err) {
    st.lastFailAt = now();
    st.lastError = why(err);
    st.cannotStart = err?.code === 'ENOENT' || err?.code === 'EACCES';
    st.hello = null;
  }

  /** One call to the engine, deduplicated per key, under the timeout. Resolves `{raw}` or `{err}`. */
  function send(key, verb, args, meta) {
    // One underlying call per key, kept until the engine itself settles, so a
    // slow engine is waited out, never stacked. The timeout is the caller's.
    let underlying = inflight.get(key);
    if (!underlying) {
      underlying = Promise.resolve().then(() => call(verb, args, meta))
        .then((raw) => ({ raw }), (err) => ({ err }))
        .finally(() => inflight.delete(key));
      inflight.set(key, underlying);
    }
    return withTimeout(underlying, timeoutMs).catch((err) => ({ err }));
  }

  function fromSnapshot(key, code, reason) {
    const s = snapshots.get(key);
    if (!s) return refuse(code, reason);
    return { ok: true, data: s.data, at: s.at, stale: true, age: now() - s.gotAt, reason };
  }

  /** Raw answer -> laneboard shape, updating the status. */
  function accept(verb, raw) {
    const env = parseEnvelope(raw);
    if (!env.ok) {
      if (env.code === 'incompatible') { st.incompatible = env.reason; st.hello = null; return refuse('incompatible', env.reason); }
      st.degraded.set(verb, env.reason);
      good();
      return refuse('degraded', env.reason);
    }
    good();
    const shaped = toShape(verb === 'act' ? 'result' : verb, env.data);
    if (!shaped.ok) { st.degraded.set(verb, shaped.reason); return refuse('degraded', shaped.reason); }
    st.degraded.delete(verb);
    if (shaped.dropped) st.dropped[verb] = (st.dropped[verb] ?? 0) + shaped.dropped;
    return { ok: true, data: shaped.value, at: env.at, contract: env.contract, engineVersion: env.engine, dropped: shaped.dropped };
  }

  async function handshake() {
    const r = await send('hello', 'hello', {});
    if (r.err) { fail(r.err); return refuse('engine-down', st.lastError); }
    const a = accept('hello', r.raw);
    if (!a.ok) return a;
    // The envelope's version passed; hello's own `contract` is what the engine
    // says it speaks, and must pass too.
    const v = checkVersion(a.data.contract);
    if (!v.ok) { st.incompatible = v.reason; return refuse('incompatible', v.reason); }
    if (a.data.contract !== a.contract) {
      // The hello schema says both are the same version; an engine that
      // disagrees with itself is not one laneboard can trust.
      const reason = `hello says contract ${a.data.contract} but its envelope says ${a.contract}`;
      st.incompatible = reason;
      return refuse('incompatible', reason);
    }
    st.incompatible = null;
    st.hello = { ...a.data, at: a.at };
    snapshots.set('hello', { data: a.data, at: a.at, gotAt: now() });
    return a;
  }

  async function read(verb, args = {}, key = verb) {
    try {
      if (verb === 'hello') {
        const h = await handshake();
        return h.ok || h.code !== 'engine-down' ? h : fromSnapshot('hello', h.code, h.reason);
      }
      if (!st.hello) {
        const h = await handshake();
        if (!h.ok) return h.code === 'engine-down' ? fromSnapshot(key, h.code, h.reason) : h;
      }
      if (st.incompatible) return refuse('incompatible', st.incompatible);
      const r = await send(key, verb, args);
      if (r.err) {
        if (r.err?.code === 'not-found') { good(); return refuse('not-found', why(r.err)); }
        fail(r.err);
        return fromSnapshot(key, 'engine-down', st.lastError);
      }
      const a = accept(verb, r.raw);
      if (a.ok) snapshots.set(key, { data: a.data, at: a.at, gotAt: now() });
      return a;
    } catch (err) {
      // Nothing above should throw; if it does, it is laneboard's bug, not the engine's.
      return refuse('degraded', `adapter error: ${why(err)}`);
    }
  }

  async function act(verb, args = {}, meta = {}) {
    try {
      if (!WRITE_VERBS.includes(verb)) return refuse('bad-request', `unknown write verb ${String(verb).slice(0, 32)}`);
      if (typeof meta?.requestId !== 'string' || !REQUEST_ID.test(meta.requestId)) return refuse('bad-request', 'requestId missing or malformed');
      if (!safeArg(meta.user) || !safeArg(meta.via)) return refuse('bad-request', 'user and via are required');
      if (typeof args?.target !== 'string' || !safeArg(args.target)) return refuse('bad-request', 'target missing or malformed');
      if (!st.hello) {
        const h = await handshake();
        if (!h.ok) return h;
      }
      if (st.incompatible) return refuse('incompatible', st.incompatible);
      // Never queued: an engine that does not answer refuses the decision now.
      const r = await send(`act:${meta.requestId}`, verb, args, meta);
      if (r.err) { fail(r.err); return refuse('engine-down', st.lastError); }
      // The engine's result (laneboard shape `result`), refusals included.
      const a = accept('act', r.raw);
      return a.ok ? a.data : a;
    } catch (err) {
      return refuse('degraded', `adapter error: ${why(err)}`);
    }
  }

  function status() {
    let state = 'unknown';
    let reason = null;
    if (st.incompatible) { state = 'incompatible'; reason = st.incompatible; }
    else if (st.lastFailAt !== null && (st.lastGoodAt === null || st.lastFailAt >= st.lastGoodAt)) {
      // No good answer for staleMs is stale, for downMs (or ever, or a CLI that
      // cannot start) is down; a failure inside staleMs is a blip, still up.
      const age = st.lastGoodAt === null || st.cannotStart ? Infinity : now() - st.lastGoodAt;
      state = age >= downMs ? 'down' : age >= staleMs ? 'stale' : 'up';
      reason = st.lastError;
    } else if (st.degraded.size) { state = 'degraded'; reason = [...st.degraded].map(([v, r]) => `${v}: ${r}`).join('; '); }
    else if (st.lastGoodAt !== null) state = 'up';
    return {
      id, kind, state, reason, accepts: ACCEPTED,
      contract: st.hello?.contract ?? null, version: st.hello?.version ?? null,
      lastGoodAt: st.lastGoodAt, lastFailAt: st.lastFailAt, dropped: { ...st.dropped },
    };
  }

  const engine = {
    id, kind,
    capabilities: [...READ_VERBS, 'act'],
    hello: () => read('hello'),
    health: () => read('health'),
    products: () => read('products'),
    runs: () => read('runs'),
    run: (runId) => (safeArg(runId) ? read('run', { id: runId }, `run:${runId}`) : Promise.resolve(refuse('bad-request', 'bad run id'))),
    events: (runId, since = 0) => {
      const n = since === undefined || since === null || since === '' ? 0 : Number(since);
      if (!safeArg(runId) || !Number.isInteger(n) || n < 0) return Promise.resolve(refuse('bad-request', 'bad run id or since'));
      return read('events', { id: runId, since: n }, `events:${runId}:${n}`);
    },
    waiting: (filter = {}) => {
      if (filter.for !== undefined && filter.for !== null && !safeArg(filter.for)) return Promise.resolve(refuse('bad-request', 'bad for'));
      const args = filter.for ? { for: filter.for } : {};
      return read('waiting', args, `waiting:${args.for ?? ''}`);
    },
    knowledge: (productId, filter = {}) => {
      const f = knowledgeFilter(filter ?? {});
      if (!safeArg(productId) || !f) return Promise.resolve(refuse('bad-request', 'bad product or filter'));
      return read('knowledge', { product: productId, ...f }, `knowledge:${productId}:${JSON.stringify(f)}`);
    },
    act,
    status,
  };
  return engine;
}

/** Helper for engines without a member: every one of MEMBERS, answering `unsupported`. */
export function unsupportedMembers(id) {
  const out = {};
  for (const m of MEMBERS) out[m] = async () => unsupported(id, m);
  return out;
}
