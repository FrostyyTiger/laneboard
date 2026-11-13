// Route module: run engines, read-only (docs/engines.md).
//
//   GET /api/engines                        -> {accepts, engines: [status + capabilities]}
//   GET /api/engines/runs                   -> {runs, engines, errors}, every engine but jsonl (the Runs view);
//                                              each engine with its foreman `health` and `questions` (items for no
//                                              run), each run with its `waiting` items, `productTitle` and `name`;
//                                              a live run with a known loop pattern also has `loop`, its spot (loopSpots)
//   GET /api/engines/products               -> {products, engines}, every engine (the Products view)
//   GET /api/engines/waiting                -> {items, engines}, every engine (the Inbox, Morning)
//   GET /api/engine/:id/hello               -> {engine, at, stale, age, dropped, data}
//   GET /api/engine/:id/health              ... the same envelope for every read;
//   GET /api/engine/:id/products            `data` is the laneboard shape of the verb
//   GET /api/engine/:id/runs                (server/engine/contract.mjs SHAPES), never
//   GET /api/engine/:id/run/:run            the engine's own JSON
//   GET /api/engine/:id/events/:run?since=<seq>
//   GET /api/engine/:id/waiting?for=<role>
//   GET /api/engine/:id/knowledge/:product?kind=&status=&id=&limit=&cursor=
//
// A refusal is `{error, code}`: 400 bad-request, 404 unknown engine, not-found
// or unsupported, 502 incompatible or degraded, 503 engine-down. No writes
// here: decisions are actions (server/engine/actions.mjs). Builder only, behind
// the normal request guards like every route.
import * as engines from '../engine/index.mjs';
import { ACCEPTED } from '../engine/contract.mjs';
import { setEngineRuns } from '../map.mjs';
import { registerEngineActions } from '../engine/actions.mjs';
import { glyphOf, loopPosition, paramsOf, patternOf } from '../../public/js/core/loop.js';

export const LIST_PATH = '/api/engines';
export const RUNS_PATH = '/api/engines/runs';
export const PRODUCTS_PATH = '/api/engines/products';
export const WAITING_PATH = '/api/engines/waiting';
const BASE = '/api/engine/:id';
/** How often the Map's engine runs are read. */
const MAP_POLL_MS = 15_000;
let mapPoll = null;

const STATUS = { 'bad-request': 400, 'not-found': 404, unsupported: 404, incompatible: 502, degraded: 502, 'engine-down': 503 };

const query = (req) => req.query ?? new URL(req.url ?? '/', 'http://localhost').searchParams;

/** A member's answer as an HTTP body and status. */
export function reply(engineId, a) {
  if (!a?.ok) return { status: STATUS[a?.code] ?? 502, body: { error: a?.reason ?? 'no answer', code: a?.code ?? 'degraded' } };
  return {
    status: 200,
    body: { engine: engineId, at: a.at ?? null, stale: a.stale === true, age: a.age ?? null, dropped: a.dropped ?? 0, data: a.data },
  };
}

/** The body of GET /api/engines: every engine's status, after one hello each. */
export async function listBody(list = engines.list()) {
  const out = [];
  for (const e of list) {
    await e.hello();
    out.push({ ...e.status(), capabilities: e.capabilities });
  }
  return { accepts: ACCEPTED, engines: out };
}

/**
 * The body of GET /api/engines/runs: every contract engine's runs, each with its
 * goal's title from `products`. The `jsonl` engine's runs are left to GET /api/runs.
 */
export async function runsBody(list = engines.list()) {
  const contract = list.filter((e) => e.kind !== 'jsonl');
  const { runs, errors } = await engines.allRuns(contract);
  const titles = new Map();
  await Promise.all(contract.filter((e) => e.capabilities.includes('products')).map(async (e) => {
    const a = await e.products();
    if (!a.ok) return;
    for (const p of a.data.products) {
      if (p.title) titles.set(`${e.id}/${p.id}`, p.title);
      for (const g of p.goals) titles.set(`${e.id}/${p.id}/${g.id}`, g.title);
    }
  }));
  const waiting = new Map(); // `<engine>/<run>` -> items
  const health = new Map();
  const questions = new Map(); // engine -> items that belong to no run
  await Promise.all(contract.map(async (e) => {
    if (e.capabilities.includes('health')) health.set(e.id, foremanOf(await e.health()));
    if (!e.capabilities.includes('waiting')) return;
    const a = await e.waiting({});
    if (!a.ok) return;
    questions.set(e.id, a.data.items.filter((it) => !it.run).length);
    for (const it of a.data.items) {
      if (!it.run) continue;
      const k = `${e.id}/${it.run}`;
      if (!waiting.has(k)) waiting.set(k, []);
      waiting.get(k).push(it);
    }
  }));
  for (const r of runs) {
    r.goalTitle ??= titles.get(`${r.engine}/${r.product}/${r.goal}`) ?? null;
    r.productTitle = titles.get(`${r.engine}/${r.product}`) ?? null;
    r.waiting = waiting.get(r.key) ?? [];
  }
  nameRuns(runs);
  await loopSpots(contract, runs);
  const states = contract.map((e) => {
    const s = e.status();
    return {
      id: e.id, kind: e.kind, state: s.state, reason: s.reason ?? null, health: health.get(e.id) ?? null,
      questions: questions.get(e.id) ?? null,
    };
  });
  return { runs, engines: states, errors };
}

const LIVE_ROW = new Set(['running', 'at-gate', 'waiting-approval', 'paused', 'queued']);
const SPOT_PAGES = 10;
const SPOT_EVENTS = 5000;
/** `<engine>/<run>` -> {seq, updatedAt, events, next, loop}: a live run's events, read again only when it moves. */
const spots = new Map();

/**
 * Each live run's spot in its loop, in place: `loop {station, label, node, at,
 * marks, blocked, exact}` for the Runs row glyph (docs/run-loop.md). A run's
 * page and events are read only when its `lastSeq` or `updatedAt` moved since the
 * last time, and then only the new events. A run with no known pattern gets none.
 */
export async function loopSpots(list, runs) {
  const byId = new Map(list.map((e) => [e.id, e]));
  const keep = new Set();
  await Promise.all(runs.map(async (r) => {
    if (!LIVE_ROW.has(r.state)) return;
    const { pattern } = patternOf(r);
    const e = byId.get(r.engine);
    if (!pattern || !e) return;
    keep.add(r.key);
    const m = spots.get(r.key);
    if (m && m.seq === r.lastSeq && m.updatedAt === r.updatedAt) { r.loop = m.loop; return; }
    const a = await e.run(r.id);
    if (!a?.ok || !a.data?.run) { if (m) r.loop = m.loop; return; }
    let events = m?.events ?? [];
    let next = m?.next ?? 0;
    for (let i = 0; i < SPOT_PAGES; i += 1) {
      const b = await e.events(r.id, next);
      if (!b?.ok) break;
      events = events.concat(b.data.events);
      next = b.data.next;
      if (!b.data.more) break;
    }
    events = events.slice(-SPOT_EVENTS);
    const run = { ...a.data.run, waiting: r.waiting };
    const pos = loopPosition(run, events, pattern, paramsOf(run, pattern));
    const g = glyphOf(pattern, pos);
    const station = pattern.stations.find((s) => s.id === pos.current);
    const loop = {
      station: pos.current, label: station?.label ?? null, node: pos.node,
      at: g.at, marks: g.dots.map((d) => d.mark), words: g.dots.map((d) => d.word), blocked: pos.blocked, exact: pos.exact,
    };
    spots.set(r.key, { seq: r.lastSeq, updatedAt: r.updatedAt, events, next, loop });
    r.loop = loop;
  }));
  for (const k of spots.keys()) if (!keep.has(k)) spots.delete(k);
  return runs;
}

/** A run's kind as its name says it: the recipe's kind, else `run`. */
const kindOf = (r) => (typeof r.recipe?.kind === 'string' && r.recipe.kind ? r.recipe.kind : 'run');
const startOf = (r) => (typeof r.startedAt === 'number' ? r.startedAt : Infinity);

/**
 * One plain name per run, in place: `<product title> · <kind> #<n>`, n counting
 * that product's runs of that kind on that engine, oldest first ("Bauplan ·
 * build #2" is its second build run). The run id's own number counts runs of a
 * day, of any kind, so it is not used. Returns `runs`.
 */
export function nameRuns(runs) {
  const groups = new Map();
  for (const r of runs) {
    const k = `${r.engine}/${r.product}/${kindOf(r)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (startOf(a) - startOf(b)) || String(a.id).localeCompare(String(b.id)));
    list.forEach((r, i) => { r.name = `${r.productTitle ?? r.product} · ${kindOf(r)} #${i + 1}`; });
  }
  return runs;
}

/**
 * A run page's answer with the names the list has: `name`, `productTitle` and
 * `goalTitle`, from the engine's runs and products only (both from the read
 * memory, so no extra call while the list is polled). A run the list does not know keeps
 * what it has.
 */
export async function namedRun(e, a) {
  if (!a?.ok || !a.data?.run) return a;
  const [runs, products, waiting] = await Promise.all([e.runs(), e.products(),
    e.capabilities.includes('waiting') ? e.waiting({}) : null]);
  if (!runs.ok) return a;
  const titles = new Map();
  if (products.ok) for (const p of products.data.products) titles.set(p.id, { title: p.title, goals: new Map(p.goals.map((g) => [g.id, g.title])) });
  const rows = runs.data.runs.map((r) => ({ ...r, engine: e.id, productTitle: titles.get(r.product)?.title ?? null }));
  nameRuns(rows);
  const row = rows.find((r) => r.id === a.data.run.id);
  if (!row) return a;
  const run = a.data.run;
  const named = { ...run, name: row.name, productTitle: row.productTitle, goalTitle: run.goalTitle ?? titles.get(run.product)?.goals.get(run.goal) ?? null,
    waiting: waiting?.ok ? waiting.data.items.filter((it) => it.run === run.id) : [] };
  return { ...a, data: { ...a.data, run: named } };
}

/** The foreman's heartbeat is this old (by the engine's own clock) and still counts as up, or as stale. */
export const BEAT_UP_MS = 60_000;
export const BEAT_STALE_MS = 300_000;

/**
 * An engine's `health` answer -> what the Runs view shows: `foreman` is up,
 * stale or down by the heartbeat's age when the engine answered (its own clock,
 * so no skew), or unknown when laneboard has no fresh answer.
 */
export function foremanOf(a) {
  if (!a?.ok) return { foreman: 'unknown', reason: a?.reason ?? 'no answer', beatAge: null };
  const d = a.data;
  const beatAge = typeof a.at === 'number' && typeof d.heartbeatAt === 'number' ? Math.max(0, a.at - d.heartbeatAt) : null;
  let foreman = beatAge === null ? 'unknown' : beatAge <= BEAT_UP_MS ? 'up' : beatAge <= BEAT_STALE_MS ? 'stale' : 'down';
  if (a.stale === true) foreman = 'unknown';
  return {
    foreman, beatAge, heartbeatAt: d.heartbeatAt, at: a.at ?? null, stale: a.stale === true, age: a.age ?? null,
    queue: d.queue, active: d.active ?? null, hosts: d.hosts, windows: d.windows,
    reason: a.stale === true ? (a.reason ?? 'the last good answer') : null,
  };
}

/** The body of GET /api/engines/products: every engine's products, each with `engine`, and the engines' states. */
export async function productsBody(list = engines.list()) {
  const able = list.filter((e) => e.capabilities.includes('products'));
  const products = [];
  await Promise.all(able.map(async (e) => {
    const a = await e.products();
    if (a.ok) for (const p of a.data.products) products.push({ ...p, engine: e.id, stale: a.stale === true, age: a.age ?? null });
  }));
  products.sort((x, y) => x.id.localeCompare(y.id));
  const states = able.map((e) => { const s = e.status(); return { id: e.id, kind: e.kind, state: s.state, reason: s.reason ?? null }; });
  return { products, engines: states };
}

/** The body of GET /api/engines/waiting: what waits for a person, every engine, oldest first, each with `engine`. */
export async function waitingBody(list = engines.list()) {
  const able = list.filter((e) => e.capabilities.includes('waiting'));
  const items = [];
  await Promise.all(able.map(async (e) => {
    const a = await e.waiting({});
    if (a.ok) for (const it of a.data.items) items.push({ ...it, engine: e.id, stale: a.stale === true });
  }));
  items.sort((x, y) => (x.openedAt ?? 0) - (y.openedAt ?? 0));
  const states = able.map((e) => { const s = e.status(); return { id: e.id, kind: e.kind, state: s.state, reason: s.reason ?? null }; });
  return { items, engines: states };
}

/** The read routes: [path suffix, (engine, req) -> answer promise]. */
export const READS = [
  ['/hello', (e) => e.hello()],
  ['/health', (e) => e.health()],
  ['/products', (e) => e.products()],
  ['/runs', (e) => e.runs()],
  ['/run/:run', async (e, req) => namedRun(e, await e.run(req.params?.run))],
  ['/events/:run', (e, req) => e.events(req.params?.run, query(req).get('since') ?? 0)],
  ['/waiting', (e, req) => e.waiting({ for: query(req).get('for') ?? undefined })],
  ['/knowledge/:product', (e, req) => {
    const q = query(req);
    const f = {};
    for (const k of ['kind', 'status', 'id', 'limit', 'cursor']) if (q.get(k) !== null) f[k] = q.get(k);
    return e.knowledge(req.params?.product, f);
  }],
];

export default {
  name: 'engines',
  modes: ['builder'],
  start() {
    if (!engines.list().some((e) => e.kind !== 'jsonl')) return;
    const read = () => runsBody().then((b) => setEngineRuns(b.runs)).catch(() => {});
    read();
    mapPoll = setInterval(read, MAP_POLL_MS);
    mapPoll.unref?.();
  },
  stop() {
    clearInterval(mapPoll);
    mapPoll = null;
  },
  register(ctx) {
    registerEngineActions();
    ctx.route('GET', LIST_PATH, async (req, res) => ctx.json(res, await listBody()));
    ctx.route('GET', RUNS_PATH, async (req, res) => ctx.json(res, await runsBody()));
    ctx.route('GET', WAITING_PATH, async (req, res) => ctx.json(res, await waitingBody()));
    ctx.route('GET', PRODUCTS_PATH, async (req, res) => ctx.json(res, await productsBody()));
    for (const [suffix, fn] of READS) {
      ctx.route('GET', `${BASE}${suffix}`, async (req, res) => {
        const e = engines.get(req.params?.id);
        if (!e) return ctx.json(res, { error: `no engine ${String(req.params?.id ?? '').slice(0, 32)}; the list is GET ${LIST_PATH}`, code: 'not-found' }, 404);
        const { status, body } = reply(e.id, await fn(e, req));
        return ctx.json(res, body, status);
      });
    }
  },
};
