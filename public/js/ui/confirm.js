// Confirm dialog with typed confirmation tiers (plan §4 2.5, README §3.5,
// security review S13).
//
//   read / click  no dialog
//   ask           verb button + Cancel, focus on Cancel
//   confirm       consequence list (targets as plates) and an input that must
//                 equal `${VERB} ${target}` exactly: KILL B1/auth, PAUSE B1,
//                 PAUSE FLEET, BROADCAST 7 (a fan-out types the count)
//
// Any action on target `*` or on several targets takes the typed form, whatever
// its tier (ack-alarm excepted: it is click even fleet-wide). The returned
// `confirm` is what the caller puts into args.confirm: the local target name,
// the builder id, or `fleet` (the hub checks it and rewrites it per builder;
// a builder accepts only its own id). A fan-out returns `confirmCount` and the
// per-target `confirms`.
//
// Pure at import time. confirmSpec/typedOk are tested in test/components.test.mjs.
import { tierOf } from '../core/actions.js';
import { parseFkey } from '../core/keys.js';
import { icon } from '../core/icons.js';
import { plate } from './components.js';

/** Actions whose verb button is drawn as the p1 outline. */
export const DESTRUCTIVE = Object.freeze(new Set(['kill', 'restart', 'retire', 'interrupt', 'deny']));
/** Fleet-wide on purpose without a typed confirm (§2: `*` needs args.confirm except ack-alarm). */
const NO_TYPED_FLEET = new Set(['ack-alarm']);

/** 'set-budget' -> 'SET-BUDGET'. */
export function verbOf(action) {
  return String(action ?? '').trim().toUpperCase();
}

/**
 * Does the typed text match `${VERB} ${target}`? Exact and case-sensitive;
 * only surrounding whitespace (a pasted newline) is forgiven.
 */
export function typedOk(input, verb, target) {
  if (typeof input !== 'string') return false;
  const v = verbOf(verb);
  const t = String(target ?? '');
  if (!v || !t) return false;
  return input.trim() === `${v} ${t}`;
}

/**
 * One target -> {label, confirm}. '*' / 'fleet' is FLEET/'fleet' on a hub, or
 * the builder id on a standalone builder (`builder` option). A fleet key
 * 'builder-a/auth' shows as typed and confirms the local name 'auth'. An
 * object {label, confirm} passes through.
 */
export function targetOf(t, { builder = null } = {}) {
  if (t && typeof t === 'object') {
    const label = String(t.label ?? t.confirm ?? '');
    return { label, confirm: String(t.confirm ?? label) };
  }
  const s = String(t ?? '');
  if (s === '*' || s.toLowerCase() === 'fleet') {
    return builder ? { label: String(builder), confirm: String(builder) } : { label: 'FLEET', confirm: 'fleet' };
  }
  const p = parseFkey(s);
  if (p) return { label: s, confirm: p.name };
  return { label: s, confirm: s };
}

/**
 * The dialog plan for an action:
 * {mode: 'none'|'ask'|'typed', tier, verb, phrase, targets:[{label, confirm}],
 *  confirm, confirmCount, confirms, destructive}
 * `phrase` is what the user must type (typed mode).
 */
export function confirmSpec({ action, targets = [], tier = 'confirm', builder = null } = {}) {
  const list = (Array.isArray(targets) ? targets : [targets]).filter((t) => t != null && t !== '');
  const tg = list.map((t) => targetOf(t, { builder }));
  const verb = verbOf(action);
  const fleet = list.some((t) => t === '*' || (typeof t === 'string' && t.toLowerCase() === 'fleet'));
  const many = tg.length > 1;
  const typed = tier === 'confirm' || ((fleet || many) && !NO_TYPED_FLEET.has(String(action)));
  const mode = typed ? 'typed' : tier === 'ask' ? 'ask' : 'none';
  const spec = {
    mode, tier, verb, targets: tg,
    destructive: DESTRUCTIVE.has(String(action)),
    phrase: null, confirm: null, confirmCount: null, confirms: tg.map((t) => t.confirm),
  };
  if (many) {
    spec.confirmCount = tg.length;
    spec.phrase = `${verb} ${tg.length}`;
  } else if (tg.length === 1) {
    spec.confirm = tg[0].confirm;
    spec.phrase = `${verb} ${tg[0].label}`;
  } else {
    spec.phrase = verb;
  }
  return spec;
}

/** The text the input must equal, split back into (verb, target) for typedOk. */
function phraseTarget(spec) {
  return spec.phrase.slice(spec.verb.length + 1);
}

/** The value confirmAction resolves with on OK. */
function okResult(spec) {
  const r = { ok: true, confirm: spec.confirm };
  if (spec.confirmCount != null) {
    r.confirmCount = spec.confirmCount;
    r.confirms = spec.confirms;
  }
  return r;
}

let seq = 0;

/**
 * Ask the user, by tier. Resolves {ok, confirm, confirmCount?, confirms?};
 * Cancel, Esc and closing resolve {ok:false}. `tier` defaults to the live
 * hello.actions table (fallback ACTION_TIERS, §1 F8a). `consequence` is a
 * string or a list of strings, shown as text.
 */
export function confirmAction({ action, targets = [], tier = null, consequence = null, builder = null, root = null } = {}) {
  const spec = confirmSpec({ action, targets, tier: tier ?? tierOf(action), builder });
  if (spec.mode === 'none') return Promise.resolve(okResult(spec));
  return new Promise((resolve) => {
    const n = ++seq;
    const dlg = document.createElement('dialog');
    dlg.className = 'cfm';
    dlg.setAttribute('role', 'alertdialog');
    dlg.dataset.mode = spec.mode;
    const titleId = `cfm-t-${n}`;
    const descId = `cfm-d-${n}`;
    dlg.setAttribute('aria-labelledby', titleId);
    dlg.setAttribute('aria-describedby', descId);

    const head = document.createElement('h2');
    head.className = 'cfm-t';
    head.id = titleId;
    head.appendChild(icon(spec.destructive ? 'alarm' : 'command', { size: 's' }));
    const verbEl = document.createElement('span');
    verbEl.textContent = spec.verb;
    head.appendChild(verbEl);
    for (const t of spec.targets.slice(0, 12)) head.appendChild(plate(t.label));
    if (spec.targets.length > 12) head.appendChild(plate(`+${spec.targets.length - 12}`));

    const desc = document.createElement('div');
    desc.className = 'cfm-d';
    desc.id = descId;
    const lines = consequence == null ? [] : (Array.isArray(consequence) ? consequence : [consequence]);
    if (lines.length) {
      const ul = document.createElement('ul');
      ul.className = 'cfm-list';
      for (const line of lines) {
        const li = document.createElement('li');
        li.textContent = String(line);
        ul.appendChild(li);
      }
      desc.appendChild(ul);
    } else {
      const p = document.createElement('p');
      p.textContent = spec.targets.length > 1
        ? `${spec.verb} ${spec.targets.length} targets.`
        : `${spec.verb} ${spec.targets[0]?.label ?? ''}`.trim() + '?';
      desc.appendChild(p);
    }

    const row = document.createElement('div');
    row.className = 'cfm-b';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = spec.destructive ? 'btn btn--danger' : 'btn btn--primary';
    ok.textContent = spec.verb;
    row.append(cancel, ok);

    let input = null;
    if (spec.mode === 'typed') {
      const lab = document.createElement('label');
      lab.className = 'cfm-in';
      const hint = document.createElement('span');
      hint.className = 'cfm-hint';
      hint.append('Type ');
      const code = document.createElement('code');
      code.textContent = spec.phrase;
      hint.appendChild(code);
      hint.append(' to confirm');
      input = document.createElement('input');
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('aria-label', `Type ${spec.phrase} to confirm`);
      lab.append(hint, input);
      desc.appendChild(lab);
      ok.disabled = true;
    }
    dlg.append(head, desc, row);

    let done = false;
    const matches = () => !input || typedOk(input.value, spec.verb, phraseTarget(spec));
    const finish = (yes) => {
      if (done) return;
      done = true;
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
      dlg.remove();
      resolve(yes ? okResult(spec) : { ok: false, confirm: null });
    };
    if (input) {
      input.addEventListener('input', () => { ok.disabled = !matches(); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (matches()) finish(true); }
      });
    }
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => { if (matches()) finish(true); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(false); });
    dlg.addEventListener('close', () => finish(false));

    (root ?? document.body).appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    (input ?? cancel).focus();
  });
}
