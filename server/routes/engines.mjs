// Route module: run engines, read-only (docs/engines.md).
//
//   GET /api/engines                        -> {accepts, engines: [status + capabilities]}
//   GET /api/engines/runs                   -> {runs, engines, errors}, every engine but jsonl (the Runs view)
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
// here: decisions go through the control plane (phase 4). Builder only, behind
// the normal request guards like every route.
import * as engines from '../engine/index.mjs';
import { ACCEPTED } from '../engine/contract.mjs';

export const LIST_PATH = '/api/engines';
export const RUNS_PATH = '/api/engines/runs';
const BASE = '/api/engine/:id';

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
    for (const p of a.data.products) for (const g of p.goals) titles.set(`${e.id}/${p.id}/${g.id}`, g.title);
  }));
  for (const r of runs) r.goalTitle ??= titles.get(`${r.engine}/${r.product}/${r.goal}`) ?? null;
  const states = contract.map((e) => { const s = e.status(); return { id: e.id, kind: e.kind, state: s.state, reason: s.reason ?? null }; });
  return { runs, engines: states, errors };
}

/** The read routes: [path suffix, (engine, req) -> answer promise]. */
export const READS = [
  ['/hello', (e) => e.hello()],
  ['/health', (e) => e.health()],
  ['/products', (e) => e.products()],
  ['/runs', (e) => e.runs()],
  ['/run/:run', (e, req) => e.run(req.params?.run)],
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
  register(ctx) {
    ctx.route('GET', LIST_PATH, async (req, res) => ctx.json(res, await listBody()));
    ctx.route('GET', RUNS_PATH, async (req, res) => ctx.json(res, await runsBody()));
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
