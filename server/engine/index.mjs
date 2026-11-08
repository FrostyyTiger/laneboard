// The run engines laneboard reads (docs/engines.md).
//
// An engine is a program that starts and drives runs; laneboard knows one
// only through the interface below, never by name. Like the providers
// (server/providers/index.mjs), each kind is a module in this folder with a
// `create(opts)` and a `none` that does nothing and says so.
//
// | kind | what |
// | --- | --- |
// | jsonl | today's run.jsonl runs (always on, needs no config) |
// | none | no engine |
// | fake | replays the contract's published examples |
// | foundry-cli | `foundry <verb> --json` through exec.mjs |
//
// Every engine has the same members: `id`, `kind`, `capabilities`, `hello()`,
// `health()`, `products()`, `runs()`, `run(id)`, `events(runId, since)`,
// `waiting(filter)`, `knowledge(product, filter)`, `act(verb, args, meta)`,
// `status()`. A member an engine lacks answers `{ok: false, code:
// 'unsupported'}`. Reads answer laneboard shapes (contract.mjs SHAPES).
import { config } from '../config.mjs';
import { ENGINE_KINDS } from '../config/engines.mjs';
import * as none from './none.mjs';
import * as fake from './fake.mjs';
import * as jsonl from './jsonl.mjs';
import * as foundryCli from './foundry-cli.mjs';

const TABLE = { none, fake, 'foundry-cli': foundryCli };

for (const k of Object.keys(TABLE).concat(ENGINE_KINDS)) {
  if (!TABLE[k] || !ENGINE_KINDS.includes(k)) throw new Error(`engines: config/engines.mjs and the engine table disagree about ${k}`);
}

/** The engines one config describes: `jsonl` first, then `engines` in order. */
export function build(cfg = config) {
  const out = [jsonl.create({ stateDir: cfg?.stateDir ?? null })];
  for (const e of Array.isArray(cfg?.engines) ? cfg.engines : []) {
    const mod = TABLE[e.kind];
    if (mod) out.push(mod.create({ ...e }));
  }
  return out;
}

let current = null;

/** Every engine, built from the config on first use. */
export function list() {
  current ??= build(config);
  return current;
}

/** One engine by id, or null. */
export function get(id) {
  return list().find((e) => e.id === id) ?? null;
}

/** Tests only: put a list of engines in place (null rebuilds from config). Returns the previous list. */
export function _set(engines) {
  const prev = current;
  current = engines;
  return prev;
}

/**
 * Runs across every engine, newest first. Each row gains `engine` (its id) and
 * `key` (`<engine>/<run>`, how a run is named across engines). An engine that
 * fails is listed in `errors` with its code; its runs are left out, its last
 * good answer (stale) is used when the adapter has one.
 */
export async function allRuns(engines = list()) {
  const answers = await Promise.all(engines.filter((e) => e.capabilities.includes('runs')).map(async (e) => [e, await e.runs()]));
  const runs = [];
  const errors = [];
  for (const [e, a] of answers) {
    if (!a.ok) { errors.push({ engine: e.id, code: a.code, reason: a.reason }); continue; }
    for (const r of a.data.runs) runs.push({ ...r, engine: e.id, key: `${e.id}/${r.id}`, stale: a.stale === true, age: a.age ?? null });
  }
  runs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return { runs, errors };
}
