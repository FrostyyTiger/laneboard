// The run engine's contract, as laneboard reads it (docs/engines.md).
//
// Three things live here and nowhere else:
//
//   1. the version check: laneboard speaks contract major 1, any minor
//      (minors only add fields). Anything else is `incompatible`;
//   2. the envelope check: every engine answer is `{contract, engine, at, data}`;
//   3. laneboard shapes: what each verb's answer becomes before anything in
//      laneboard (a route, later a view or the cockpit) sees it. `toShape`
//      maps the engine's v1 `data` into them, keeping only the fields
//      laneboard knows (snake_case becomes camelCase, ISO times become epoch
//      ms). `checkShape` checks a laneboard shape, for any engine (the
//      contract suite runs it against `fake`, `jsonl` and a real engine).
//
// Rules for the mapping: a row (a run, a product, a waiting item, an event,
// a knowledge item) needs its id and the fields it is listed by; without them
// it is dropped and counted. Anything else malformed becomes null (or is left
// out of its list). A whole answer that is not the verb's shape is `degraded`.
// Nothing here throws on engine input: `toShape` and `parseEnvelope` return
// values.
import crypto from 'node:crypto';

// --- versions -----------------------------------------------------------------

export const ACCEPTS_MAJOR = 1;
/** What `laneboard engine check` and GET /api/engines print as the accepted range. */
export const ACCEPTED = '1.x';

/** `{ok, major, minor}` for a contract version laneboard speaks, else `{ok: false, reason}`. */
export function checkVersion(v) {
  const m = typeof v === 'string' ? /^([0-9]{1,4})\.([0-9]{1,4})$/.exec(v) : null;
  if (!m) return { ok: false, reason: `contract version ${(JSON.stringify(v) ?? String(v)).slice(0, 64)} is not MAJOR.MINOR` };
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== ACCEPTS_MAJOR) return { ok: false, reason: `engine speaks contract ${v}, laneboard accepts ${ACCEPTED}` };
  return { ok: true, major, minor };
}

// --- vocabulary (contract v1, closed lists) -----------------------------------

export const READ_VERBS = Object.freeze(['hello', 'health', 'products', 'runs', 'run', 'events', 'waiting', 'knowledge']);
export const WRITE_VERBS = Object.freeze(['approve', 'reject', 'answer', 'accept-risk', 'add-source', 'start', 'pause',
  'resume', 'stop', 'host-away', 'host-back']);
/** The engine's refusal codes (contract v1 "Result"). */
export const RESULT_CODES = Object.freeze(['not-found', 'already-decided', 'stale-revision', 'refused', 'busy', 'engine-error']);
/** laneboard's own codes, for answers the engine never gave. */
export const LOCAL_CODES = Object.freeze(['timeout', 'engine-down', 'incompatible', 'degraded', 'unsupported', 'bad-request']);

const set = (...a) => new Set(a);
export const VOCAB = Object.freeze({
  runState: set('waiting-approval', 'queued', 'running', 'at-gate', 'paused', 'done', 'stopped'),
  stopReason: set('done', 'stopped-by-person', 'budget', 'window-7d', 'no-progress', 'checks-red', 'errors', 'rejected'),
  nodeState: set('planned', 'ready', 'building', 'checking', 'passed', 'frozen', 'reopened', 'paused', 'blocked', 'dropped'),
  nodeLevel: set('goal', 'feature', 'task'),
  eventLevel: set('run', 'goal', 'feature', 'task'),
  hostState: set('up', 'gaming', 'away'),
  roomState: set('creating', 'up', 'paused', 'ending', 'ended'),
  prState: set('draft', 'open', 'merged', 'closed'),
  gateState: set('open', 'decided', 'withdrawn'),
  decision: set('approved', 'rejected'),
  waitingKind: set('requirement', 'recipe', 'variant', 'question', 'merge', 'deploy', 'proposal', 'repo', 'change'),
  readiness: set('ready', 'not-ready'),
  readinessKind: set('question-open', 'requirement-unapproved', 'low-claim', 'budget'),
  knowledgeType: set('claim', 'question', 'requirement', 'source'),
});

/** Required content fields per waiting kind (contract v1 "Waiting items"). */
const CONTENT_NEEDS = {
  recipe: ['revision', 'text'], requirement: ['items'], variant: ['question', 'options'], question: ['question', 'context'],
  merge: ['report', 'pr'], deploy: ['target', 'what'], proposal: ['title', 'text'], repo: ['product', 'name', 'template'],
  change: ['chain', 'items'],
};

// --- small readers ------------------------------------------------------------

class Bad extends Error {}
const bad = (why) => { throw new Bad(why); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const TS = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;
const MAX_STR = 64 * 1024;

const str = (v) => (typeof v === 'string' && v.length <= MAX_STR ? v : null);
const need = (v, what) => str(v) ?? bad(`${what} missing`);
const oneOf = (v, vocab, what) => (vocab.has(v) ? v : bad(`${what} ${(JSON.stringify(v) ?? 'missing').slice(0, 64)} is not known`));
const maybeOf = (v, vocab) => (vocab.has(v) ? v : null);
const ms = (v) => (typeof v === 'string' && TS.test(v) ? Date.parse(v) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v) => (Number.isInteger(v) ? v : null);
const url = (v) => (typeof v === 'string' && /^https?:\/\//.test(v) && v.length <= 2048 ? v : null);
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 256) : []);
/** A list whose items `fn` maps; an item `fn` refuses (throws Bad) is left out and counted in `drop`. */
function rows(v, fn, drop) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    try { out.push(fn(x)); } catch (err) { if (!(err instanceof Bad)) throw err; if (drop) drop.n += 1; }
  }
  return out;
}

/** Plain JSON, depth- and size-bounded: what laneboard keeps of a free-form object (waiting content). */
export function plain(v, depth = 8) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.length <= MAX_STR ? v : v.slice(0, MAX_STR);
  if (depth <= 0) return null;
  if (Array.isArray(v)) return v.slice(0, 1000).map((x) => plain(x, depth - 1));
  if (isObj(v)) {
    const out = {};
    for (const k of Object.keys(v).slice(0, 200)) if (k !== '__proto__') out[k] = plain(v[k], depth - 1);
    return out;
  }
  return null;
}

/** Canonical JSON (keys sorted, no whitespace) and the contract's revision of it. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export function revisionOf(content) {
  return `sha256:${crypto.createHash('sha256').update(canonical(content)).digest('hex').slice(0, 16)}`;
}

// --- the envelope -------------------------------------------------------------

/** The most an engine may send for one answer (the CLI's output cap, engine.md §4). */
export const MAX_ANSWER = 4 * 1024 * 1024;

/**
 * Check one answer: `raw` is the CLI's stdout (a string) or a parsed object.
 * Returns `{ok: true, contract, engine, at, data}` or `{ok: false, code, reason}`
 * with code `incompatible` (another major) or `degraded` (not an envelope).
 */
export function parseEnvelope(raw) {
  let o = raw;
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    const text = String(raw);
    if (text.length > MAX_ANSWER) return { ok: false, code: 'degraded', reason: 'answer too large' };
    try { o = JSON.parse(text); } catch { return { ok: false, code: 'degraded', reason: 'answer is not JSON' }; }
  }
  if (!isObj(o)) return { ok: false, code: 'degraded', reason: 'answer is not an object' };
  for (const k of ['contract', 'engine', 'at', 'data']) {
    if (!(k in o)) return { ok: false, code: 'degraded', reason: `envelope has no ${k}` };
  }
  const v = checkVersion(o.contract);
  if (!v.ok) return { ok: false, code: 'incompatible', reason: v.reason };
  if (typeof o.engine !== 'string' || !o.engine) return { ok: false, code: 'degraded', reason: 'envelope engine is not a version' };
  const at = ms(o.at);
  if (at === null) return { ok: false, code: 'degraded', reason: 'envelope at is not an ISO time' };
  return { ok: true, contract: o.contract, engine: o.engine.slice(0, 64), at, data: o.data };
}

// --- per-verb mapping, engine v1 -> laneboard shape ---------------------------

const tokens = (t) => (isObj(t) && [t.in, t.out, t.cache_read, t.cache_write].every((x) => num(x) !== null)
  ? { in: t.in, out: t.out, cacheRead: t.cache_read, cacheWrite: t.cache_write } : null);
const slice = (s) => (isObj(s) ? { tokens: tokens(s.tokens), usd: num(s.usd_notional) } : null);
function slices(o) {
  const out = {};
  if (isObj(o)) for (const [k, v] of Object.entries(o)) { const s = slice(v); if (s && k.length <= 64) out[k] = s; }
  return out;
}
const usage = (u) => (isObj(u)
  ? { tokens: tokens(u.tokens), usd: num(u.usd_notional), byRole: slices(u.by_role), byTier: slices(u.by_tier) } : null);
const pr = (p) => (isObj(p) && str(p.id) && url(p.url)
  ? { id: p.id, url: p.url, state: maybeOf(p.state, VOCAB.prState), title: str(p.title), updatedAt: ms(p.updated) } : null);
const room = (r) => {
  if (!isObj(r)) bad('room is not an object');
  return { name: need(r.name, 'room name'), host: str(r.host), state: maybeOf(r.state, VOCAB.roomState),
    expiresAt: ms(r.expires), purpose: str(r.purpose) };
};
const recipe = (r) => (isObj(r) && str(r.id)
  ? { id: r.id, revision: int(r.revision), kind: str(r.kind), url: url(r.url) } : null);
const counts = (c) => (isObj(c) && [c.passed, c.failed, c.skipped].every((x) => int(x) !== null)
  ? { passed: c.passed, failed: c.failed, skipped: c.skipped } : null);
const check = (c) => (isObj(c) && str(c.name) && typeof c.pass === 'boolean'
  ? { name: c.name, pass: c.pass, counts: counts(c.counts), output: url(c.output), path: str(c.path), at: ms(c.at) } : null);

function runRow(r) {
  if (!isObj(r)) bad('run is not an object');
  return {
    id: need(r.id, 'run id'),
    product: need(r.product, 'run product'),
    goal: need(r.goal, 'run goal'),
    goalTitle: null,
    recipe: recipe(r.recipe),
    state: oneOf(r.state, VOCAB.runState, 'run state'),
    stop: maybeOf(r.stop_reason, VOCAB.stopReason),
    node: str(r.node),
    rooms: rows(r.rooms, room),
    usage: usage(r.usage),
    pr: pr(r.pr),
    lastSeq: int(r.last_seq),
    startedAt: ms(r.started),
    endedAt: ms(r.ended),
    url: url(r.url),
    updatedAt: ms(r.updated),
  };
}

function node(n) {
  if (!isObj(n)) bad('node is not an object');
  return {
    id: need(n.id, 'node id'),
    level: oneOf(n.level, VOCAB.nodeLevel, 'node level'),
    parent: str(n.parent),
    title: need(n.title, 'node title'),
    state: oneOf(n.state, VOCAB.nodeState, 'node state'),
    reason: str(n.reason),
    check: str(n.check),
    lastCheck: check(n.last_check),
    attempts: isObj(n.attempts) && int(n.attempts.rounds) !== null
      ? { rounds: n.attempts.rounds, tiers: strs(n.attempts.tiers) } : null,
    // A goal holds a list, a feature one id.
    requirements: strs(typeof n.requirements === 'string' ? [n.requirements] : n.requirements),
    acceptanceTests: strs(n.acceptance_tests),
    dependsOn: strs(n.depends_on),
    blockedBy: strs(n.blocked_by),
    url: url(n.url),
    updatedAt: ms(n.updated),
  };
}

function gate(g) {
  if (!isObj(g)) bad('gate is not an object');
  const d = g.decided;
  return {
    id: need(g.id, 'gate id'),
    kind: oneOf(g.kind, VOCAB.waitingKind, 'gate kind'),
    state: oneOf(g.state, VOCAB.gateState, 'gate state'),
    for: str(g.for),
    openedAt: ms(g.opened),
    decided: isObj(d) && VOCAB.decision.has(d.decision)
      ? { decision: d.decision, choice: str(d.choice), by: str(d.by), via: str(d.via), at: ms(d.at), request: str(d.request) } : null,
    updatedAt: ms(g.updated),
  };
}

const EVENT_SCALARS = ['title', 'state', 'reason', 'role', 'tier', 'round', 'result', 'what', 'ok', 'name', 'pass',
  'output', 'path', 'gate', 'kind', 'for', 'decision', 'by', 'via', 'choice', 'request', 'text', 'url', 'room', 'expires'];
const CAMEL = { usd_notional: 'usd', window_5h: 'window5h', window_7d: 'window7d' };

function event(e) {
  if (!isObj(e)) bad('event is not an object');
  const seq = int(e.seq);
  if (seq === null || seq < 1) bad('event seq missing');
  const out = {
    seq,
    at: ms(e.ts) ?? bad('event ts missing'),
    type: typeof e.type === 'string' && /^[a-z]+(\.[a-z]+)?$/.test(e.type) ? e.type : bad('event type missing'),
    level: oneOf(e.level, VOCAB.eventLevel, 'event level'),
    node: str(e.node),
    parent: str(e.parent),
  };
  for (const k of EVENT_SCALARS) {
    const v = e[k];
    if (typeof v === 'string' || typeof v === 'boolean' || num(v) !== null) out[k] = typeof v === 'string' ? v.slice(0, 4096) : v;
  }
  // A round's cost sits in `usage` ({tokens, usd_notional}); older lines had it on the event.
  const u = isObj(e.usage) ? e.usage : e;
  for (const [k, to] of Object.entries(CAMEL)) if (num(u[k]) !== null) out[to] = u[k];
  if (counts(e.counts)) out.counts = counts(e.counts);
  if (tokens(u.tokens)) out.tokens = tokens(u.tokens);
  return out;
}

function waitingItem(it) {
  if (!isObj(it)) bad('item is not an object');
  const kind = oneOf(it.kind, VOCAB.waitingKind, 'item kind');
  const revision = typeof it.revision === 'string' && /^sha256:[0-9a-f]{16}$/.test(it.revision) ? it.revision : bad('item revision missing');
  if (!isObj(it.content)) bad('item content is not an object');
  for (const k of CONTENT_NEEDS[kind]) if (!(k in it.content)) bad(`${kind} content has no ${k}`);
  // The revision is what a decision will name (--expect): one that is not the
  // hash of what laneboard would show is not shown.
  if (revisionOf(it.content) !== revision) bad('item revision is not the hash of its content');
  return {
    id: need(it.id, 'item id'),
    kind,
    for: str(it.for),
    revision,
    title: need(it.title, 'item title'),
    content: plain(it.content),
    links: rows(it.links, (l) => (isObj(l) && str(l.rel) && (str(l.ref) || url(l.url))
      ? { rel: l.rel, ref: str(l.ref), url: url(l.url) } : bad('bad link'))),
    product: str(it.product),
    run: str(it.run),
    openedAt: ms(it.opened),
    url: url(it.url),
    updatedAt: ms(it.updated),
  };
}

function reason(r) {
  if (!isObj(r)) bad('reason is not an object');
  return { kind: oneOf(r.kind, VOCAB.readinessKind, 'reason kind'), ref: str(r.ref), text: need(r.text, 'reason text'), url: url(r.url) };
}

function goal(g) {
  if (!isObj(g)) bad('goal is not an object');
  return {
    id: need(g.id, 'goal id'),
    title: str(g.title),
    readiness: oneOf(g.readiness, VOCAB.readiness, 'readiness'),
    reasons: rows(g.reasons, reason),
    requirements: strs(g.requirements),
    runs: strs(g.runs),
    url: url(g.url),
    updatedAt: ms(g.updated),
  };
}

function product(p, drop) {
  if (!isObj(p)) bad('product is not an object');
  return {
    id: need(p.id, 'product id'),
    title: str(p.title),
    url: url(p.url),
    repo: url(p.repo),
    goals: rows(p.goals, goal, drop),
    updatedAt: ms(p.updated),
  };
}

const written = (k) => ({ writtenBy: str(k.written_by), date: str(k.date), url: url(k.url), updatedAt: ms(k.updated) });
const KNOWLEDGE = {
  claim: (k) => ({
    kind: str(k.kind), statement: need(k.statement, 'claim statement'),
    evidence: rows(k.evidence, (e) => (isObj(e) && str(e.source) ? { source: e.source, at: str(e.at), says: str(e.says) } : bad('bad evidence'))),
    confidence: str(k.confidence), status: str(k.status), supersededBy: str(k.superseded_by), decidedBy: str(k.decided_by),
  }),
  question: (k) => ({
    question: need(k.question, 'question text'), ask: str(k.ask), status: str(k.status), blocks: strs(k.blocks),
    answer: str(k.answer), for: str(k.for), reason: str(k.reason),
  }),
  requirement: (k) => ({
    title: need(k.title, 'requirement title'), status: str(k.status), because: strs(k.because), approvedBy: str(k.approved_by),
    approvedOn: str(k.approved_on), sections: isObj(k.sections) ? plain(k.sections) : null, open: strs(k.open),
  }),
  // Headers and summaries only (contract v1 "Knowledge privacy"): a `ref` or a
  // body is never kept, even if an engine sent one.
  source: (k) => ({
    kind: str(k.kind), date: str(k.date), who: str(k.who), addedBy: str(k.added_by), via: str(k.via),
    storage: str(k.storage), language: str(k.language), summary: str(k.summary),
  }),
};

function knowledgeItem(k) {
  if (!isObj(k)) bad('item is not an object');
  const type = oneOf(k.type, VOCAB.knowledgeType, 'knowledge type');
  return { type, id: need(k.id, 'knowledge id'), ...KNOWLEDGE[type](k), ...written(k) };
}

const MAP = {
  hello(d) {
    return {
      contract: need(d.contract, 'contract version'),
      version: need(d.engine, 'engine version'),
      oldest: need(d.oldest_contract, 'oldest contract'),
      served: rows(d.served, (s) => (isObj(s) && str(s.contract) ? { contract: s.contract, until: ms(s.until) } : bad('bad served'))),
      verbs: strs(d.verbs),
    };
  },
  health(d, drop) {
    if (!Array.isArray(d.hosts)) bad('health has no hosts');
    const w = (x) => (isObj(x) && num(x.used_pct) !== null ? { usedPct: x.used_pct, resetsAt: ms(x.resets_at), known: x.known !== false } : null);
    return {
      heartbeatAt: ms(d.heartbeat) ?? bad('health heartbeat missing'),
      hosts: rows(d.hosts, (h) => (isObj(h) && str(h.id)
        ? { id: h.id, role: str(h.role), state: oneOf(h.state, VOCAB.hostState, 'host state'), updatedAt: ms(h.updated) }
        : bad('bad host')), drop),
      queue: int(d.queue) ?? bad('health queue missing'),
      active: int(d.active),
      windows: isObj(d.windows) ? { window5h: w(d.windows.window_5h), window7d: w(d.windows.window_7d) } : null,
    };
  },
  products(d, drop) {
    if (!Array.isArray(d.products)) bad('no products list');
    return { products: rows(d.products, (p) => product(p, drop), drop) };
  },
  runs(d, drop) {
    if (!Array.isArray(d.runs)) bad('no runs list');
    return { runs: rows(d.runs, runRow, drop) };
  },
  run(d, drop) {
    const r = d.run;
    if (!isObj(r) || !Array.isArray(r.tree)) bad('no run with a tree');
    const report = isObj(r.report) && url(r.report.url)
      ? { url: r.report.url, summary: str(r.report.summary), needs: strs(r.report.needs) } : null;
    return {
      run: {
        ...runRow(r),
        tree: rows(r.tree, node, drop),
        gates: rows(r.gates, gate, drop),
        prs: rows(r.prs, (p) => pr(p) ?? bad('bad pr'), drop),
        report,
      },
    };
  },
  events(d, drop) {
    if (!Array.isArray(d.events)) bad('no events list');
    return {
      run: need(d.run, 'events run'),
      since: int(d.since) ?? 0,
      events: rows(d.events, event, drop),
      next: int(d.next) ?? bad('events next missing'),
      more: d.more === true,
    };
  },
  waiting(d, drop) {
    if (!Array.isArray(d.items)) bad('no items list');
    return { for: str(d.for), items: rows(d.items, waitingItem, drop) };
  },
  knowledge(d, drop) {
    if (!Array.isArray(d.items)) bad('no items list');
    return { product: need(d.product, 'knowledge product'), items: rows(d.items, knowledgeItem, drop), nextCursor: str(d.next_cursor) };
  },
  result(d) {
    if (typeof d.ok !== 'boolean') bad('result has no ok');
    const out = {
      ok: d.ok, verb: str(d.verb), target: str(d.target), request: str(d.request), by: str(d.by), via: str(d.via),
      replayed: d.replayed === true,
    };
    if (d.ok) return { ...out, result: isObj(d.result) ? plain(d.result) : null };
    // A later minor may add codes: an unknown one is kept, laneboard treats it as a refusal.
    const code = typeof d.code === 'string' && /^[a-z][a-z-]{0,31}$/.test(d.code) ? d.code : bad('refusal has no code');
    return { ...out, code, reason: str(d.reason) ?? '', current: str(d.current) };
  },
};

/**
 * Map one verb's `data` (from a checked envelope) into its laneboard shape.
 * `{ok: true, value, dropped}` (`dropped`: rows left out), or `{ok: false, reason}`
 * when the whole answer is not the verb's shape. Never throws.
 */
export function toShape(verb, data) {
  const fn = MAP[verb];
  if (!fn) return { ok: false, reason: `no shape for ${verb}` };
  if (!isObj(data)) return { ok: false, reason: `${verb}: data is not an object` };
  const drop = { n: 0 };
  try {
    return { ok: true, value: fn(data, drop), dropped: drop.n };
  } catch (err) {
    return { ok: false, reason: `${verb}: ${err instanceof Bad ? err.message : 'unreadable answer'}` };
  }
}

// --- laneboard shapes, checked ------------------------------------------------
//
// A tiny declarative check, so the contract suite can hold any engine's
// answer against the same shapes. Specs: 'str' 'num' 'int' 'bool' 'ms' 'obj'
// 'any', a trailing '?' allows null; a Set is an enum; [spec] a list of spec;
// a plain object an object with at least those keys.

const S = {
  tokens: { in: 'num', out: 'num', cacheRead: 'num', cacheWrite: 'num' },
};
S.usage = { tokens: ['nullable', S.tokens], usd: 'num?', byRole: 'obj', byTier: 'obj' };
S.pr = { id: 'str', url: 'str', state: 'str?', title: 'str?', updatedAt: 'ms?' };
S.room = { name: 'str', host: 'str?', state: 'str?', expiresAt: 'ms?', purpose: 'str?' };
S.runRow = {
  id: 'str', product: 'str?', goal: 'str?', goalTitle: 'str?', recipe: 'obj?', state: 'str', stop: 'str?', node: 'str?',
  rooms: [S.room], usage: ['nullable', S.usage], pr: ['nullable', S.pr], lastSeq: 'int?', startedAt: 'ms?', endedAt: 'ms?',
  url: 'str?', updatedAt: 'ms?',
};
S.node = { id: 'str', level: VOCAB.nodeLevel, parent: 'str?', title: 'str', state: VOCAB.nodeState, lastCheck: 'obj?', url: 'str?' };
S.gate = { id: 'str', kind: VOCAB.waitingKind, state: VOCAB.gateState, decided: 'obj?' };

export const SHAPES = Object.freeze({
  hello: { contract: 'str?', version: 'str?', oldest: 'str?', served: ['obj'], verbs: ['str'] },
  health: { heartbeatAt: 'ms', hosts: [{ id: 'str', role: 'str?', state: VOCAB.hostState, updatedAt: 'ms?' }], queue: 'int', active: 'int?', windows: 'obj?' },
  products: { products: [{ id: 'str', title: 'str?', url: 'str?', repo: 'str?', updatedAt: 'ms?',
    goals: [{ id: 'str', title: 'str?', readiness: VOCAB.readiness, requirements: ['str'], runs: ['str'], url: 'str?',
      reasons: [{ kind: VOCAB.readinessKind, ref: 'str?', text: 'str', url: 'str?' }] }] }] },
  runs: { runs: [S.runRow] },
  run: { run: { ...S.runRow, tree: ['nullable', [S.node]], gates: [S.gate], prs: [S.pr], report: 'obj?' } },
  events: { run: 'str', since: 'int', next: 'int', more: 'bool',
    events: [{ seq: 'int', at: 'ms', type: 'str', level: VOCAB.eventLevel, node: 'str?', parent: 'str?' }] },
  waiting: { for: 'str?', items: [{ id: 'str', kind: VOCAB.waitingKind, for: 'str?', revision: 'str', title: 'str',
    content: 'obj', links: [{ rel: 'str', ref: 'str?', url: 'str?' }], product: 'str?', run: 'str?', openedAt: 'ms?', url: 'str?', updatedAt: 'ms?' }] },
  knowledge: { product: 'str', nextCursor: 'str?', items: [{ type: VOCAB.knowledgeType, id: 'str', url: 'str?', updatedAt: 'ms?' }] },
  result: { ok: 'bool', verb: 'str?', target: 'str?', request: 'str?', by: 'str?', via: 'str?', replayed: 'bool' },
});

function checkSpec(v, spec, at, out) {
  if (out.length > 50) return;
  if (Array.isArray(spec) && spec[0] === 'nullable') { if (v !== null) checkSpec(v, spec[1], at, out); return; }
  if (spec instanceof Set) { if (!spec.has(v)) out.push(`${at}: ${JSON.stringify(v)} is not one of ${[...spec].join('|')}`); return; }
  if (Array.isArray(spec)) {
    if (!Array.isArray(v)) { out.push(`${at}: not a list`); return; }
    v.forEach((x, i) => checkSpec(x, spec[0], `${at}[${i}]`, out));
    return;
  }
  if (isObj(spec)) {
    if (!isObj(v)) { out.push(`${at}: not an object`); return; }
    for (const [k, s] of Object.entries(spec)) {
      if (!(k in v)) out.push(`${at}.${k}: missing`);
      else checkSpec(v[k], s, `${at}.${k}`, out);
    }
    return;
  }
  const opt = spec.endsWith('?');
  const t = opt ? spec.slice(0, -1) : spec;
  if (v === null && opt) return;
  const ok = {
    str: typeof v === 'string', num: num(v) !== null, int: int(v) !== null, bool: typeof v === 'boolean',
    ms: int(v) !== null && v >= 0, obj: isObj(v), any: v !== undefined,
  }[t];
  if (!ok) out.push(`${at}: ${JSON.stringify(v)?.slice(0, 60)} is not ${spec}`);
}

/** Problems with a laneboard shape for `verb` (empty = fine). */
export function checkShape(verb, value) {
  const spec = SHAPES[verb];
  if (!spec) return [`no shape for ${verb}`];
  const out = [];
  checkSpec(value, spec, verb, out);
  if (verb === 'result' && isObj(value)) {
    if (value.ok === false && typeof value.code !== 'string') out.push('result.code: missing');
    if (value.ok === false && typeof value.reason !== 'string') out.push('result.reason: missing');
  }
  return out;
}
