// The bridge events' checks (spec protocols.md §11.3, §13: the `json bridge`
// fixture class; the protocol itself is docs/cockpit/protocol.md, D136).
// Every event between the room and its agent, after the Claude Code adapter
// (server/cockpit/agents/claude-code.mjs) or straight from a `kind: bridge`
// agent, is one entry of AGENT_EVENTS or ROOM_EVENTS below: its required
// fields, the "with X" ones, and the optional ones. Unknown fields are
// ignored; an unknown `type` is the caller's to log and skip (§11.3).
//
//   checkBridgeEvent(ev, dir)  dir 'from-agent' (agent → room) or 'to-agent'
//                              (room → agent) → {ok:true} or {ok:false,
//                              code ('bad-event' | 'unknown-type'), field, message}
//   AGENT_EVENTS, ROOM_EVENTS  the types per direction
//
// A `kind: bridge` agent is a program the room does not trust to be correct
// (§11.11): every line it sends passes here before the bridge acts on it.

export const ROOM_EVENTS = Object.freeze(['prompt', 'interrupt']);
export const AGENT_EVENTS = Object.freeze(['ready', 'taken', 'text.delta', 'text.block', 'tool.start',
  'tool.end', 'retrying', 'turn.end', 'interrupted']);
export const END_STATES = Object.freeze(['done', 'stopped', 'error']);
export const END_CODES = Object.freeze(['agent-exited', 'agent-down', 'not-logged-in', 'step-limit', 'failed']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (max = 1_000_000, min = 1) => (v) => (typeof v !== 'string' ? 'not a string'
  : v.length < min ? 'empty' : v.length > max ? `longer than ${max} characters` : null);
const int = (min = 0) => (v) => (!Number.isInteger(v) ? 'not an integer' : v < min ? `below ${min}` : null);
const num = (v) => (typeof v !== 'number' || !Number.isFinite(v) || v < 0 ? 'not a number >= 0' : null);
const bool = (v) => (typeof v === 'boolean' ? null : 'not true or false');
const oneOf = (...vals) => (v) => (vals.includes(v) ? null : `not one of ${vals.join(', ')}`);
const obj = (v) => (isObj(v) ? null : 'not an object');
const strList = (max = 1000) => (v) => {
  if (!Array.isArray(v)) return 'not a list';
  if (v.length > max) return `more than ${max} entries`;
  return v.some((s) => typeof s !== 'string' || s === '' || s.length > 256) ? 'not a list of names' : null;
};
const mcpState = (v) => {
  if (!isObj(v)) return 'not an object';
  return Object.values(v).some((s) => typeof s !== 'string' || s.length > 64) ? 'not names to states' : null;
};
// The room's prompt ids are UUID v4 (§11.3); an agent echoes them back.
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuid = (v) => (typeof v === 'string' && UUID_RX.test(v) ? null : 'not a UUID v4');
const anyId = str(200);

// A field: required unless `optional`; `when(ev)` makes it required in that
// case and absent otherwise (§11.3's "with `error` also `code`").
const f = (rule, o = {}) => ({ rule, ...o });
const opt = (rule) => f(rule, { optional: true });
const when = (cond, rule, o = {}) => f(rule, { when: cond, ...o });

const ROOM = {
  prompt: { id: f(uuid), text: f(str(10 * 1024 * 1024)), priority: f(oneOf('next', 'now', 'later')) },
  interrupt: { id: f(str(64)), cancelQueued: f(bool) },
};

const AGENT = {
  ready: {
    session: f(str(200)), tools: f(strList()), mcp: f(mcpState), canSteer: f(bool), canCancelQueued: f(bool),
    agent: opt(str(200)), allowlist: opt(strList()),
  },
  taken: { id: f(anyId) },
  'text.delta': { block: f(int(0)), text: f(str(16 * 1024 * 1024, 0)) },
  'text.block': { block: f(int(0)), text: f(str(16 * 1024 * 1024, 0)) },
  'tool.start': { block: f(int(0)), toolUseId: f(anyId), tool: f(str(200)), input: f(obj), denied: opt(bool) },
  'tool.end': { toolUseId: f(anyId), isError: f(bool), denied: opt(bool) },
  retrying: { attempt: f(int(1)), of: f(int(1)) },
  'turn.end': {
    state: f(oneOf(...END_STATES)),
    code: when((e) => e.state === 'error', oneOf(...END_CODES)),
    // `steps` is required with step-limit and optional otherwise (§11.3).
    steps: f(int(0), { optional: true, requiredWhen: (e) => e.state === 'error' && e.code === 'step-limit' }),
    detail: f(str(2000, 0), { optional: true, requiredWhen: (e) => e.state === 'error' && (e.code === 'agent-down' || e.code === 'failed') }),
    costUsd: opt(num), durationMs: opt(num),
  },
  interrupted: { id: f(str(64)), stillQueued: f(strList(10000)), cancelled: f(strList(10000)) },
};

const bad = (field, message) => ({ ok: false, code: 'bad-event', field, message: `${field}: ${message}` });

/** Checks one bridge event; `dir` 'from-agent' or 'to-agent'. */
export function checkBridgeEvent(ev, dir) {
  if (!isObj(ev)) return { ok: false, code: 'bad-event', field: null, message: 'not an object' };
  const table = dir === 'to-agent' ? ROOM : dir === 'from-agent' ? AGENT : null;
  if (!table) throw new RangeError(`checkBridgeEvent: dir must be from-agent or to-agent, got ${JSON.stringify(dir)}`);
  if (typeof ev.type !== 'string' || !Object.hasOwn(table, ev.type)) {
    return { ok: false, code: 'unknown-type', field: 'type', message: `unknown type ${JSON.stringify(ev.type)}` };
  }
  for (const [name, spec] of Object.entries(table[ev.type])) {
    const present = Object.hasOwn(ev, name) && ev[name] !== undefined;
    if (spec.when) {
      const applies = spec.when(ev);
      if (applies && !present) return bad(name, 'required here');
      if (!applies && present) return bad(name, 'not allowed here');
    } else if (!present) {
      if (spec.requiredWhen?.(ev)) return bad(name, 'required here');
      if (spec.optional) continue;
      return bad(name, 'required');
    }
    if (!present) continue;
    const why = spec.rule(ev[name]);
    if (why) return bad(name, why);
  }
  return { ok: true };
}
