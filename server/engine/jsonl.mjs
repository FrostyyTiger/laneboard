// The `jsonl` engine: today's run.jsonl protocol (docs/runs.md) behind the
// engine interface. It reads the store the runs collector already fills
// (server/collector/runs.mjs); it starts nothing and changes nothing about
// GET /api/runs, which keeps answering from the same store as before.
//
// Members: `runs` and `run` in laneboard's shapes (contract.mjs SHAPES), and
// `act('ack', {target: <run>, ref}, meta)`, which appends the `needs.ack` line
// `laneboard run ack` and POST /api/runs/events write (`by` is `meta.via`:
// `inbox`, `run page` or `owner` close a fence need). Every other member is
// `unsupported`. Nothing calls `act` in phase 0: decisions go through the
// control plane from phase 4 on.
import { RUN_ID, parseLine, ackTarget, FENCE_ACK_BY } from '../runs/protocol.mjs';
import * as collector from '../collector/runs.mjs';
import { refuse, unsupportedMembers, why } from './adapter.mjs';

export const kind = 'jsonl';
export const ID = 'jsonl';

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const VIA = /^[a-z][a-z -]{0,31}$/;
const msOrNull = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

function prOf(a) {
  if (!a || typeof a.url !== 'string') return null;
  const num = /\/pull\/([0-9]+)/.exec(a.url)?.[1] ?? a.url;
  return { id: num, url: a.url, state: a.state ?? null, title: a.title ?? null, updatedAt: msOrNull(a.ts) };
}

/** One folded run (server/runs/protocol.mjs foldRun) as a laneboard run row. */
export function runRow(run) {
  const prs = (run.artifacts ?? []).filter((a) => a.kind === 'pr').map(prOf).filter(Boolean);
  const usd = typeof run.cost?.usd === 'number' && run.cost.usd > 0 ? run.cost.usd : null;
  return {
    id: run.run,
    product: null,
    goal: null,
    goalTitle: run.goal ?? null,
    recipe: null,
    state: run.state,
    stop: run.stop?.reason ?? null,
    reason: null,
    node: null,
    rooms: [],
    usage: usd === null ? null : { tokens: null, usd, byRole: {}, byTier: {} },
    pr: prs.at(-1) ?? null,
    lastSeq: null,
    startedAt: msOrNull(run.startedAt),
    endedAt: msOrNull(run.stop?.ts),
    url: null,
    updatedAt: msOrNull(run.updatedAt),
  };
}

/**
 * opts: `{id, store, stateDir, append}`; `store()` gives the runs store (default:
 * the running collector's), `append(stateDir, run, line)` writes one line and
 * resolves the file (default: server/routes/runs.mjs appendEvent + track).
 */
export function create({ id = ID, store = collector.store, stateDir = null, append = null, now = () => Date.now() } = {}) {
  const replays = new Map();
  const getStore = () => { try { return store(); } catch { return null; } };
  let lastGoodAt = null;

  const ok = (data) => { lastGoodAt = now(); return { ok: true, data, at: lastGoodAt, dropped: 0 }; };
  const noStore = () => refuse('engine-down', 'the runs collector is not running');

  async function defaultAppend(dir, run, line) {
    const routes = await import('../routes/runs.mjs');
    const file = await routes.appendEvent(dir, run, line);
    await collector.track(file).catch(() => {});
    return file;
  }

  async function act(verb, args = {}, meta = {}) {
    try {
      if (verb !== 'ack') return refuse('unsupported', `engine ${id} has no ${String(verb).slice(0, 32)}`);
      if (typeof meta.requestId !== 'string' || !REQUEST_ID.test(meta.requestId)) return refuse('bad-request', 'requestId missing or malformed');
      if (typeof meta.via !== 'string' || !VIA.test(meta.via)) return refuse('bad-request', 'via missing or malformed');
      const seen = replays.get(meta.requestId);
      if (seen) return { ...seen, replayed: true };
      const head = { verb: 'ack', target: args.target ?? null, request: meta.requestId, by: meta.user ?? null, via: meta.via, replayed: false };
      const answer = (data) => { const a = { ...head, ...data }; replays.set(meta.requestId, a); return a; };
      const s = getStore();
      if (!s) return noStore();
      const run = typeof args.target === 'string' && RUN_ID.test(args.target) ? s.get(args.target) : null;
      if (!run) return answer({ ok: false, code: 'not-found', reason: `no run ${String(args.target ?? '').slice(0, 64)}` });
      const text = JSON.stringify({ v: 1, t: 'needs.ack', run: run.run, ref: args.ref, by: meta.via, ts: now() });
      const parsed = parseLine(text);
      if (!parsed.ok) return refuse('bad-request', parsed.reason);
      const needItem = ackTarget(run.needs, parsed.event);
      if (!needItem) return answer({ ok: false, code: 'not-found', reason: `run ${run.run} has no need ${String(args.ref)}` });
      if (needItem.acked) return answer({ ok: false, code: 'already-decided', reason: `that need was acknowledged by ${needItem.by ?? 'someone'}` });
      if (needItem.kind === 'fence' && !FENCE_ACK_BY.includes(meta.via)) {
        return answer({ ok: false, code: 'refused', reason: `a fence need closes only from ${FENCE_ACK_BY.join(', ')}` });
      }
      await (append ?? defaultAppend)(stateDir, run.run, `${text}\n`);
      return answer({ ok: true, result: { run: run.run, need: run.needs.indexOf(needItem) } });
    } catch (err) {
      // Not written: no replay is recorded, the same request may be sent again.
      return { ok: false, verb: 'ack', target: args?.target ?? null, request: meta?.requestId ?? null, by: meta?.user ?? null,
        via: meta?.via ?? null, replayed: false, code: 'engine-error', reason: why(err) };
    }
  }

  return {
    ...unsupportedMembers(id),
    id,
    kind,
    capabilities: ['hello', 'runs', 'run', 'act'],
    async hello() {
      return ok({ contract: null, version: null, oldest: null, served: [], verbs: ['runs', 'run', 'ack'] });
    },
    async runs() {
      const s = getStore();
      if (!s) return noStore();
      return ok({ runs: s.list().map(runRow) });
    },
    async run(runId) {
      const s = getStore();
      if (!s) return noStore();
      const run = typeof runId === 'string' && RUN_ID.test(runId) ? s.get(runId) : null;
      if (!run) return refuse('not-found', `no run ${String(runId ?? '').slice(0, 64)}`);
      const row = runRow(run);
      const prs = (run.artifacts ?? []).filter((a) => a.kind === 'pr').map(prOf).filter(Boolean);
      // No tree: a run.jsonl run has rounds, which GET /api/runs/<id> keeps showing.
      return ok({ run: { ...row, tree: null, gates: [], prs, report: null } });
    },
    act,
    status() {
      const s = getStore();
      return {
        id, kind, state: s ? 'up' : 'down', reason: s ? null : 'the runs collector is not running', accepts: 'run.jsonl v1',
        contract: null, version: null, lastGoodAt, lastFailAt: null, dropped: {},
      };
    },
  };
}
