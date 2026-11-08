// The `foundry-cli` engine: a run engine's CLI, `<verb> … --json`, through
// exec.mjs (docs/engines.md). createContractEngine does the handshake, the
// checks, the timeout, the last good answer and "no two calls of a read at once".
//
// The child gets a fixed argument list per verb, no shell, its `cwd` from config
// and exactly `{PATH, FOUNDRY_CONFIG}` as its environment: nothing else of
// laneboard's is inherited. `act` is here for the contract suite; no route calls
// it until decisions go through the control plane (phase 4).
import { createContractEngine } from './adapter.mjs';
import { execJson } from './exec.mjs';
import { READ_VERBS } from './contract.mjs';

export const kind = 'foundry-cli';

/** The flags each write verb takes from `args`: [flag, key]. */
const WRITE_FLAGS = Object.freeze({
  approve: [['--expect', 'expect'], ['--choice', 'choice']],
  reject: [['--expect', 'expect'], ['--why', 'why']],
  answer: [['--text', 'text']],
  'accept-risk': [['--why', 'why']],
});

const refused = (what) => Object.assign(new Error(`${what} is not a value this engine takes`), { code: 'not-found' });

/** A value that would read as a flag is never passed on. */
function plain(v) {
  const s = String(v);
  if (s.startsWith('-')) throw refused('a leading "-"');
  return s;
}

/** The argument list of one call. Throws for a value that could read as a flag. */
export function argsFor(verb, args = {}, meta = {}) {
  const out = [verb];
  if (READ_VERBS.includes(verb)) {
    if (verb === 'run' || verb === 'events') out.push(plain(args.id));
    if (verb === 'knowledge') out.push(plain(args.product));
    if (verb === 'events') out.push('--since', plain(args.since ?? 0));
    for (const k of ['for', 'kind', 'status', 'limit', 'cursor']) if (args[k] !== undefined) out.push(`--${k}`, plain(args[k]));
    if (verb === 'knowledge' && args.id !== undefined) out.push('--id', plain(args.id));
  } else {
    if (verb === 'start') out.push(plain(args.target), plain(args.goal));
    else out.push(plain(args.target));
    for (const [flag, key] of WRITE_FLAGS[verb] ?? []) if (args[key] !== undefined) out.push(flag, String(args[key]));
    out.push('--by', plain(meta.user), '--via', plain(meta.via), '--request-id', plain(meta.requestId));
  }
  out.push('--json');
  return out;
}

/** The child's whole environment. */
export function envFor(config, path = process.env.PATH ?? '') {
  return config ? { PATH: path, FOUNDRY_CONFIG: config } : { PATH: path };
}

export function create({ id = 'foundry', bin, config, cwd, timeoutMs, staleMs, downMs, now, exec = execJson } = {}) {
  const env = envFor(config);
  async function call(verb, args, meta) {
    return exec(bin, argsFor(verb, args, meta), { timeoutMs, cwd, env });
  }
  return createContractEngine({ id, kind, call, timeoutMs, staleMs, downMs, now });
}
