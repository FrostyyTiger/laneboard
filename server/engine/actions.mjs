// Decisions on run engines, through the dispatcher (docs/decisions.md; engine.md §5).
// REVIEW-REQUIRED: this is what lets a page change what an engine does.
//
// One door: every write to an engine is one of these actions, so the dispatcher's
// checks and its audit (start entry before the call, outcome after) apply. The
// engine is told who decided from the dispatcher's own record, never from a field
// the page sent, and the envelope's id is its --request-id: a retry applies once.
//
// Target: `<engine>/<item, run or product>`. Remote-only actions are refused from
// the machine itself, so an agent on it cannot approve its own work. On Linux they
// also need fleet.ingressPeerUid, without which that refusal can be got around.
import { ActionRefused, has, registerAction } from '../fleet/dispatch.mjs';
import * as engines from './index.mjs';
import { peerCheck } from './peer-check.mjs';

export const VIA = 'laneboard';
const REVISION_RE = /^sha256:[0-9a-f]{16}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TEXT_MAX = 4000;
const TARGET_MAX = 240;

/** What a refusal from an engine, or from the adapter, answers over HTTP. */
const STATUS = Object.freeze({
  'not-found': 404, 'already-decided': 409, 'stale-revision': 409, refused: 403, busy: 409, 'engine-error': 502,
  timeout: 504, 'engine-down': 503, incompatible: 502, degraded: 502, unsupported: 501, 'bad-request': 400,
});

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

function cleanText(v, what) {
  const s = String(v).replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
  if (!s) throw new ActionRefused(400, 'bad_args', `${what} is empty`);
  return s;
}

const REV = { type: 'string', required: true, max: 23, re: REVISION_RE };
const CONFIRM = { type: 'string', required: true, max: TARGET_MAX };
const TEXT = { type: 'string', required: true, min: 1, max: TEXT_MAX };

/** name -> what it sends. `to(args)` picks what the engine gets from the checked args. */
export const ENGINE_ACTIONS = Object.freeze({
  'engine-approve': { verb: 'approve', tier: 'confirm', remoteOnly: true, args: { expect: REV, confirm: CONFIRM }, to: (a) => ({ expect: a.expect }) },
  'engine-pick': { verb: 'approve', tier: 'confirm', remoteOnly: true, args: { expect: REV, choice: { type: 'string', required: true, max: 64, re: ID_RE }, confirm: CONFIRM }, to: (a) => ({ expect: a.expect, choice: a.choice }) },
  'engine-reject': { verb: 'reject', tier: 'confirm', remoteOnly: true, args: { expect: REV, why: TEXT, confirm: CONFIRM }, to: (a) => ({ expect: a.expect, why: cleanText(a.why, 'the reason') }) },
  'engine-answer': { verb: 'answer', tier: 'click', remoteOnly: true, args: { text: TEXT }, to: (a) => ({ text: cleanText(a.text, 'the answer') }) },
  'engine-start': { verb: 'start', tier: 'ask', remoteOnly: true, args: { goal: { type: 'string', required: true, max: 64, re: ID_RE } }, to: (a) => ({ goal: a.goal }) },
  'engine-pause': { verb: 'pause', tier: 'click', remoteOnly: false, args: {}, to: () => ({}) },
  'engine-resume': { verb: 'resume', tier: 'click', remoteOnly: false, args: {}, to: () => ({}) },
  'engine-stop': { verb: 'stop', tier: 'confirm', remoteOnly: true, args: { confirm: CONFIRM }, to: () => ({}) },
});

function refusal(a) {
  const code = typeof a?.code === 'string' ? a.code : 'degraded';
  const err = new ActionRefused(STATUS[code] ?? 403, code, a?.reason || 'the engine refused');
  if (typeof a?.current === 'string') err.result = { current: a.current };
  return err;
}

/** Register the actions once. `engineOf` is injectable for tests. */
export function registerEngineActions({ engineOf = engines.get, platform = process.platform } = {}) {
  for (const [name, def] of Object.entries(ENGINE_ACTIONS)) {
    if (has(name)) continue;
    registerAction(name, {
      tier: def.tier,
      target: 'engine',
      remoteOnly: def.remoteOnly,
      args: def.args,
      async run({ target, args, user, requestId, kind, config }) {
        // A signed-in user on the ingress port may be a program on this machine with forged headers.
        if (def.remoteOnly && kind === 'direct' && peerCheck(config, platform) === 'missing') {
          throw new ActionRefused(403, 'peer-check-off', 'decisions are off until fleet.ingressPeerUid is set on this server');
        }
        const slash = target.indexOf('/');
        const id = target.slice(0, slash);
        const engine = engineOf(id);
        // The jsonl engine has run files, not decisions.
        if (!engine || engine.kind === 'jsonl') throw new ActionRefused(404, 'not-found', 'no such engine');
        const a = await engine.act(def.verb, { target: target.slice(slash + 1), ...def.to(args) }, { requestId, user, via: VIA });
        if (!a?.ok) throw refusal(a);
        return { verb: a.verb ?? def.verb, target, replayed: a.replayed === true, result: a.result ?? null };
      },
    });
  }
}
