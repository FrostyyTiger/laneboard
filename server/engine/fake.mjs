// The fake engine: replays the contract's published example answers
// (test/fixtures/engine/v1/, copied verbatim from the engine's repo) through
// the same adapter a real engine uses (adapter.mjs). For the contract suite,
// and later the demo.
//
// What it answers:
//   hello, health, products, runs   the fixture file as it is
//   run <id>                        run.json for its run; any other id is not-found
//   events <id> --since <seq>       events.json for its own `since`, else the
//                                   lines of events.jsonl after `seq`
//   waiting [--for]                 waiting.json, filtered by `for`
//   knowledge <product> [filter]    knowledge.json for its product, filtered by
//                                   kind, status, id and limit; any other product
//                                   is not-found
//   act                             the result-*.json whose verb and target match,
//                                   with the request's id, by and via; no match is
//                                   not-found. The same request id twice answers
//                                   the first result again, `replayed: true`
//                                   (except engine-error: nothing was applied).
//
// `override` (tests only) replaces one verb's answer: a raw value, or a
// function `(args, meta)` that may return, throw or never settle.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createContractEngine } from './adapter.mjs';

export const kind = 'fake';
export const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'test', 'fixtures', 'engine', 'v1');

const notFound = (what) => Object.assign(new Error(`${what} not found`), { code: 'not-found' });

export function create({ id = 'fake', dir = FIXTURES, override = {}, timeoutMs, staleMs, downMs, now } = {}) {
  const read = (name) => fsp.readFile(path.join(dir, name), 'utf8');
  const json = async (name) => JSON.parse(await read(name));
  const replays = new Map(); // requestId -> answer
  let results = null;

  async function resultTemplates() {
    if (results) return results;
    const names = (await fsp.readdir(dir)).filter((n) => /^result-[a-z-]+\.json$/.test(n)).sort();
    results = await Promise.all(names.map(json));
    return results;
  }

  async function act(verb, args, meta) {
    const seen = replays.get(meta.requestId);
    if (seen) return { ...seen, data: { ...seen.data, replayed: true } };
    const all = await resultTemplates();
    const hit = all.find((r) => r.data?.verb === verb && r.data?.target === args.target);
    const base = hit ?? all.find((r) => r.data?.code === 'not-found');
    const answer = {
      ...base,
      data: {
        ...base.data, verb, target: args.target, request: meta.requestId, by: meta.user, via: meta.via, replayed: false,
        ...(hit ? {} : { reason: `No waiting item ${args.target}.` }),
      },
    };
    if (answer.data.code !== 'engine-error') replays.set(meta.requestId, answer);
    return answer;
  }

  async function call(verb, args = {}, meta = {}) {
    if (Object.hasOwn(override, verb)) {
      const o = override[verb];
      return typeof o === 'function' ? o(args, meta) : o;
    }
    switch (verb) {
      case 'hello': case 'health': case 'products': case 'runs':
        return read(`${verb}.json`);
      case 'run': {
        const a = await json('run.json');
        if (a.data?.run?.id !== args.id) throw notFound(`run ${args.id}`);
        return a;
      }
      case 'events': {
        const a = await json('events.json');
        if (a.data?.run !== args.id) throw notFound(`run ${args.id}`);
        if (args.since === a.data.since) return a;
        const lines = (await read('events.jsonl')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const events = lines.filter((e) => e.run === args.id && e.seq > args.since);
        return { ...a, data: { run: args.id, since: args.since, events, next: events.at(-1)?.seq ?? args.since, more: false } };
      }
      case 'waiting': {
        const a = await json('waiting.json');
        if (!args.for) return a;
        return { ...a, data: { ...a.data, for: args.for, items: a.data.items.filter((i) => i.for === args.for) } };
      }
      case 'knowledge': {
        const a = await json('knowledge.json');
        if (a.data?.product !== args.product) throw notFound(`product ${args.product}`);
        let items = a.data.items;
        if (args.kind) items = items.filter((i) => i.type === args.kind);
        if (args.status) items = items.filter((i) => i.status === args.status);
        if (args.id) items = items.filter((i) => i.id === args.id);
        if (args.limit) items = items.slice(0, args.limit);
        const filter = Object.fromEntries(['kind', 'status', 'id', 'limit'].filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
        return { ...a, data: { ...a.data, filter, items } };
      }
      default:
        return act(verb, args, meta);
    }
  }

  return createContractEngine({ id, kind, call, timeoutMs, staleMs, downMs, now });
}
