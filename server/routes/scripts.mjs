// Route module: run scripts (fleet plan §10 2.7/2.8, R8). REVIEW-REQUIRED (SR20).
//
//   action `run-script`  tier ask, target lane, args {script, stop?}
//                        (server/review/scripts.mjs runScript / stopScript)
//   hello.scripts        {repo: [script names]}: names only, never commands
//   capability `scripts`
//
// The dispatcher (server/fleet/dispatch.mjs) does the shape, auth, hub-control,
// tier, rate-limit (5/min/user) and audit steps; this module only adds the
// action. The args schema is strict: `script` must match SCRIPT_NAME_RE and is
// then looked up in the builder's own config (an unknown name is 400
// `unknown_script`, nothing spawned). No command text is accepted from the
// wire, and neither the hub nor the API can add or change a script.
//
// Dispatch-time deps never reach the script runner wholesale (the builder ctx
// has unrelated services with the same names); only `deps.scripts`, an
// explicit override object, does (tests).
import { registerAction, has } from '../fleet/dispatch.mjs';
import { addCapability, addHelloField } from '../fleet/api-v1.mjs';
import { config as liveConfig } from '../config.mjs';
import { runScript, stopScript, scriptNames, setDeps, SCRIPT_NAME_RE } from '../review/scripts.mjs';

export const ACTION = 'run-script';

/** The strict args schema of run-script (README §3.5). */
export const ARGS = Object.freeze({
  script: { type: 'string', required: true, min: 1, max: 24, re: SCRIPT_NAME_RE },
  stop: { type: 'boolean', default: false },
});

/** The action body. */
export async function runScriptAction({ target, args, user, deps }) {
  const over = deps && typeof deps.scripts === 'object' && deps.scripts !== null ? deps.scripts : undefined;
  if (args.stop === true) return stopScript(target, args.script, user, over);
  return runScript(target, args.script, user, over);
}

/** Register run-script with the dispatcher. Idempotent. */
export function registerRunScript(deps) {
  if (deps) setDeps(deps);
  if (has(ACTION)) return false;
  registerAction(ACTION, {
    tier: 'ask',
    target: 'lane',
    args: ARGS,
    run: runScriptAction,
  });
  return true;
}

let helloAdded = false;

export default {
  name: 'scripts',
  modes: ['builder'],
  register(ctx) {
    registerRunScript();
    addCapability('scripts');
    if (!helloAdded) {
      const cfg = () => ctx?.config ?? liveConfig;
      try {
        addHelloField('scripts', () => scriptNames(cfg().repos));
        helloAdded = true;
      } catch (err) {
        if (!/already registered/.test(String(err?.message))) throw err;
        helloAdded = true;
      }
    }
  },
};
