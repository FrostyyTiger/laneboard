// The kill dialog (fleet plan §8 2.6 / 2.9, task C14).
//
// Scope radio lane / builder / fleet:
//   lane     `kill <session>`, typed confirm KILL <lane> (args.confirm = the
//            local name), the existing exact-target kill
//   builder  `kill *` on one builder, args {confirm:<builder id>, graceMs,
//            include:[names]?}: lists the victims (lane sessions) and offers
//            opt-in checkboxes for the non-lane sessions (never `_laneboard*`).
//            During the grace period a countdown with a Cancel button (the
//            same request with args.cancel:<job>). Remote-only on the builder.
//   fleet    hub-local `kill` with builder '*', target '*', typed `fleet`
//            (args.confirm:'fleet'; the hub rewrites it per builder). A 10 s
//            undo window follows: the countdown comes from GET /api/fleet/kill,
//            and Undo is the same request with args.cancel:<fleet job>.
//
// The typed confirm is the §4 confirmAction (ui/confirm.js) in its typed form:
// KILL <lane>, KILL <builder id>, KILL FLEET. Nothing is sent before it
// resolves ok. Session names and builder ids come from builders (untrusted):
// they reach the page as textContent only.
//
// Pure at import time.
import { act as pageAct, hubAct as pageHubAct } from '../core/actions.js';
import { parseFkey } from '../core/keys.js';
import { store } from '../core/store.js';
import { confirmAction as pageConfirm } from './confirm.js';

export const KILL_SCOPES = Object.freeze(['lane', 'builder', 'fleet']);
/** The builder's default grace before `kill *` kills (server/control/killswitch.mjs). */
export const BUILDER_GRACE_MS = 10_000;
/** The hub's fleet-kill undo window (server/hub/fleetkill.mjs UNDO_MS). */
export const FLEET_UNDO_MS = 10_000;
export const FLEET_KILL_PATH = '/api/fleet/kill';
/** Sessions `kill *` never touches (PROTECTED_PREFIXES). */
const PROTECTED = /^_laneboard/;
const ACTIVE_FLEET = new Set(['pausing', 'cancelling', 'pending', 'killing']);

const onHubSource = (s) => s?.source?.kind === 'hub';

/**
 * Which scopes the dialog offers for model `m`, each {scope, disabled, reason}.
 * Pure. `hub`: the page is on a hub (fleet scope needs it).
 */
export function killScopeOptions(m, { hub = false } = {}) {
  const lane = !m?.sessionKey ? 'no session' : m.dead ? 'already ended' : null;
  const builder = !m?.builder ? 'no builder' : null;
  const fleet = hub ? null : 'the fleet kill runs on the hub';
  return [
    { scope: 'lane', disabled: Boolean(lane), reason: lane },
    { scope: 'builder', disabled: Boolean(builder), reason: builder },
    { scope: 'fleet', disabled: Boolean(fleet), reason: fleet },
  ];
}

/** The first enabled scope, preferring `want`. */
export function pickScope(options, want) {
  const hit = options.find((o) => o.scope === want && !o.disabled);
  return hit ? hit.scope : options.find((o) => !o.disabled)?.scope ?? null;
}

/**
 * A builder's sessions split the way the builder's `kill *` sees them:
 * {victims: lane-bound names, others: non-lane names that may be opted in}.
 * `_laneboard*` sessions are in neither (never killed). Sorted. Pure.
 */
export function builderInventory(sessions) {
  const victims = new Set();
  const others = new Set();
  for (const sess of sessions ?? []) {
    if (!sess || typeof sess !== 'object') continue;
    const name = typeof sess.name === 'string' ? sess.name : null;
    if (!name || PROTECTED.test(name)) continue;
    if (sess.lane != null && sess.lane !== '') victims.add(name);
    else others.add(name);
  }
  return { victims: [...victims].sort(), others: [...others].sort() };
}

/** The sessions of builder `id` in store `s`. */
export function sessionsOfBuilder(s, id) {
  const out = [];
  const seen = new Set();
  const b = s?.builders?.get?.(id);
  for (const sess of b?.sessions?.values?.() ?? []) { out.push(sess); seen.add(sess?.name); }
  for (const sess of s?.sessions?.values?.() ?? []) {
    if (sess?.builder === id && !seen.has(sess.name)) out.push(sess);
  }
  return out;
}

/**
 * What a kill sends, before the confirm. {scope, confirmTargets, consequence,
 * send: {via:'act'|'hub', key?, builder?, target, args}} or {error}.
 * `include` (builder scope) keeps only names from `others`. Pure.
 */
export function killPlan({ scope, model: m = null, builder = null, include = [], others = [], victims = [], hub = false } = {}) {
  if (scope === 'lane') {
    if (!m?.sessionKey) return { error: 'no session' };
    const label = m.sessionName ?? m.title ?? m.sessionKey;
    return {
      scope,
      confirmTargets: [m.sessionKey],
      consequence: [`kills the tmux session ${label}`, 'the worktree, branch and lane record stay'],
      send: { via: 'act', key: m.sessionKey, action: 'kill', args: {} },
    };
  }
  if (scope === 'builder') {
    const id = builder ?? m?.builder ?? null;
    if (!id) return { error: 'no builder' };
    const allowed = new Set(others);
    const inc = [...new Set((include ?? []).filter((n) => allowed.has(n)))].sort();
    const args = { graceMs: BUILDER_GRACE_MS };
    if (inc.length) args.include = inc;
    const lines = [
      `pauses and interrupts every lane on ${id}, then kills them after ${BUILDER_GRACE_MS / 1000} s unless cancelled`,
      `${victims.length} lane session${victims.length === 1 ? '' : 's'}${victims.length ? `: ${victims.slice(0, 12).join(', ')}${victims.length > 12 ? ', …' : ''}` : ''}`,
    ];
    if (inc.length) lines.push(`also the non-lane session${inc.length === 1 ? '' : 's'} ${inc.join(', ')}`);
    return {
      scope,
      builder: id,
      confirmTargets: [{ label: id, confirm: id }],
      consequence: lines,
      send: hub
        ? { via: 'hub', builder: id, action: 'kill', target: '*', args }
        : { via: 'act', key: '*', action: 'kill', args },
    };
  }
  if (scope === 'fleet') {
    if (!hub) return { error: 'the fleet kill runs on the hub' };
    return {
      scope,
      confirmTargets: ['*'],
      consequence: [
        'pauses and interrupts every lane on every reachable builder now',
        `kills them all in ${FLEET_UNDO_MS / 1000} s unless you press Undo`,
      ],
      send: { via: 'hub', builder: '*', action: 'kill', target: '*', args: {} },
    };
  }
  return { error: 'bad scope' };
}

/** The result object inside an act()/hubAct() answer (relay or builder shape). */
export function killResultOf(r) {
  const res = r?.result;
  if (res && typeof res === 'object' && res.result && typeof res.result === 'object' && !Array.isArray(res.result)) return res.result;
  return res && typeof res === 'object' ? res : {};
}

/**
 * Send a planned kill: confirmAction first (typed), then act()/hubAct().
 * Resolves {ok, cancelled?, plan, confirm, r, job, deadline}. `deps`:
 * {confirmAction, act, hubAct, now}.
 */
export async function runKill(plan, deps = {}) {
  if (!plan || plan.error) return { ok: false, error: plan?.error ?? 'no plan' };
  const ask = deps.confirmAction ?? pageConfirm;
  const answer = await ask({
    action: 'kill', targets: plan.confirmTargets, tier: 'confirm', consequence: plan.consequence,
    builder: plan.scope === 'fleet' ? null : plan.builder ?? null,
  });
  if (!answer?.ok || typeof answer.confirm !== 'string' || answer.confirm === '') return { ok: false, cancelled: true };
  const args = { ...plan.send.args, confirm: answer.confirm };
  const now = deps.now ?? Date.now;
  let r;
  if (plan.send.via === 'hub') {
    r = await (deps.hubAct ?? pageHubAct)({ builder: plan.send.builder, action: 'kill', target: '*', args });
  } else {
    r = await (deps.act ?? pageAct)(plan.send.key, 'kill', args);
  }
  const res = killResultOf(r);
  const job = typeof res.job === 'string' ? res.job : null;
  const windowMs = plan.scope === 'fleet'
    ? (Number.isFinite(res.undoMs) ? res.undoMs : FLEET_UNDO_MS)
    : plan.scope === 'builder' ? (Number.isFinite(res.graceMs) ? res.graceMs : BUILDER_GRACE_MS) : 0;
  return { ok: r?.ok === true, r, plan, confirm: answer.confirm, job, deadline: job && windowMs > 0 ? now() + windowMs : null };
}

/**
 * Cancel (builder grace) or Undo (fleet window) a running kill. No new typed
 * confirm: it repeats the confirm already typed and only stops a kill.
 */
export function cancelKill(sent, deps = {}) {
  if (!sent?.job || !sent.plan) return Promise.resolve({ ok: false, error: 'nothing to cancel' });
  const args = { confirm: sent.confirm, cancel: sent.job };
  if (sent.plan.send.via === 'hub') {
    return (deps.hubAct ?? pageHubAct)({ builder: sent.plan.send.builder, action: 'kill', target: '*', args });
  }
  return (deps.act ?? pageAct)(sent.plan.send.key, 'kill', args);
}

/** The job `id` in a GET /api/fleet/kill body, or null. */
export function fleetJobFrom(body, id) {
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];
  return jobs.find((j) => j && j.job === id) ?? null;
}

/**
 * The countdown line for a running kill. `job` is the hub's fleet job (or
 * null), `deadline` the local deadline. {leftMs, seconds, state, canUndo,
 * text}. Pure.
 */
export function killCountdown({ scope, job = null, deadline = null, now = Date.now(), cancelled = false } = {}) {
  const state = cancelled ? 'cancelled' : (typeof job?.state === 'string' ? job.state : (scope === 'fleet' ? 'pending' : 'grace'));
  const leftMs = deadline == null ? 0 : Math.max(0, deadline - now);
  const seconds = Math.ceil(leftMs / 1000);
  const live = scope === 'fleet' ? (state === 'pausing' || state === 'pending') : state === 'grace';
  const canUndo = live && leftMs > 0;
  let text;
  if (state === 'cancelled') text = scope === 'fleet' ? 'Undone: nothing was killed; the lanes stay paused until resumed' : 'Cancelled: nothing was killed; the lanes stay paused';
  else if (state === 'failed') text = 'The pause reached no builder: nothing will be killed';
  else if (state === 'killed') text = 'Killed';
  else if (state === 'killing') text = 'Killing…';
  else if (!canUndo && live) text = scope === 'fleet' ? 'Killing…' : 'Grace over: the builder kills the lanes now';
  else if (state === 'aborted') text = 'The hub stopped inside the window: nothing was killed, the fleet stays paused';
  else text = `${scope === 'fleet' ? 'Fleet' : 'Builder'} kill in ${seconds} s`;
  return { leftMs, seconds, state, canUndo, text, active: ACTIVE_FLEET.has(state) || state === 'grace' };
}

/** GET /api/fleet/kill, defensively. */
export async function fetchFleetKills(fetcher = null) {
  const get = typeof fetcher === 'function' ? fetcher : (u, i) => fetch(u, i);
  try {
    const r = await get(FLEET_KILL_PATH, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- dialog

function kswEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function kswButton(text, cls) {
  const b = kswEl('button', cls ?? 'btn', text);
  b.type = 'button';
  return b;
}

let kswSeq = 0;

/**
 * Open the kill dialog. `opts`: {scope, model, builder, store, deps}. The
 * model is the inspector's (lane scope); builder defaults to its builder.
 * Resolves when the dialog closes, with the last runKill result (or null).
 */
export function openKillDialog(opts = {}) {
  const s = opts.store ?? store;
  const deps = opts.deps ?? {};
  const hub = onHubSource(s);
  const m = opts.model ?? null;
  const options = killScopeOptions(m, { hub });
  let scope = pickScope(options, opts.scope ?? 'lane');
  let builderId = opts.builder ?? m?.builder ?? parseFkey(m?.sessionKey ?? '')?.builder ?? null;
  const include = new Set();
  let sent = null;
  let timer = null;

  return new Promise((resolve) => {
    const n = ++kswSeq;
    const dlg = kswEl('dialog', 'cfm ksw');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-labelledby', `ksw-t-${n}`);
    const head = kswEl('h2', 'cfm-t', 'KILL');
    head.id = `ksw-t-${n}`;
    const radios = kswEl('div', 'ksw-scopes');
    radios.setAttribute('role', 'radiogroup');
    radios.setAttribute('aria-label', 'Scope');
    const body = kswEl('div', 'cfm-d');
    const status = kswEl('p', 'ksw-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const row = kswEl('div', 'cfm-b');
    const close = kswButton('Close');
    const go = kswButton('Kill…', 'btn btn--danger');
    const undo = kswButton('Cancel kill', 'btn btn--primary');
    undo.hidden = true;
    row.append(close, undo, go);
    dlg.append(head, radios, body, status, row);

    const finish = () => {
      clearInterval(timer);
      timer = null;
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
      dlg.remove();
      resolve(sent);
    };

    const drawScopes = () => {
      radios.textContent = '';
      for (const o of options) {
        const lab = kswEl('label', 'ksw-scope');
        const r = document.createElement('input');
        r.type = 'radio';
        r.name = `ksw-scope-${n}`;
        r.value = o.scope;
        r.checked = o.scope === scope;
        r.disabled = o.disabled || sent != null;
        r.onchange = () => { scope = o.scope; drawBody(); };
        lab.title = o.reason ?? '';
        lab.append(r, kswEl('span', null, o.scope === 'fleet' ? 'fleet' : o.scope));
        radios.append(lab);
      }
    };

    const currentPlan = () => {
      const inv = scope === 'builder' && builderId ? builderInventory(sessionsOfBuilder(s, builderId)) : { victims: [], others: [] };
      return { inv, plan: killPlan({ scope, model: m, builder: builderId, include: [...include], others: inv.others, victims: inv.victims, hub }) };
    };

    const drawBody = () => {
      body.textContent = '';
      const { inv, plan } = currentPlan();
      if (scope === 'builder') {
        if (hub && s.builders?.size > 1) {
          const lab = kswEl('label', 'ksw-builder', 'builder ');
          const sel = document.createElement('select');
          for (const id of [...s.builders.keys()].sort()) {
            const o = kswEl('option', null, id);
            o.value = id;
            o.selected = id === builderId;
            sel.append(o);
          }
          sel.onchange = () => { builderId = sel.value; include.clear(); drawBody(); };
          lab.append(sel);
          body.append(lab);
        }
        body.append(kswEl('p', 'ksw-h', `Lane sessions (${inv.victims.length})`));
        const ul = kswEl('ul', 'ksw-victims');
        for (const v of inv.victims) ul.append(kswEl('li', null, v));
        if (!inv.victims.length) ul.append(kswEl('li', 'dim', 'none'));
        body.append(ul);
        if (inv.others.length) {
          body.append(kswEl('p', 'ksw-h', 'Also kill these non-lane sessions (opt in)'));
          const box = kswEl('div', 'ksw-include');
          for (const name of inv.others) {
            const lab = kswEl('label', 'ksw-inc');
            const c = document.createElement('input');
            c.type = 'checkbox';
            c.checked = include.has(name);
            c.disabled = sent != null;
            c.onchange = () => { if (c.checked) include.add(name); else include.delete(name); };
            lab.append(c, kswEl('span', null, name));
            box.append(lab);
          }
          body.append(box);
        }
      }
      if (plan.error) {
        body.append(kswEl('p', 'cfm-err', plan.error));
      } else {
        const ul = kswEl('ul', 'cfm-list');
        for (const line of plan.consequence) ul.append(kswEl('li', null, line));
        body.append(ul);
      }
      go.disabled = Boolean(plan.error) || sent != null;
    };

    const tick = async () => {
      if (!sent) return;
      let job = null;
      if (sent.plan.scope === 'fleet') job = fleetJobFrom(await fetchFleetKills(deps.fetch), sent.job);
      const c = killCountdown({ scope: sent.plan.scope, job, deadline: sent.deadline, now: Date.now(), cancelled: sent.cancelled });
      status.textContent = c.text;
      undo.hidden = !c.canUndo;
      if (!c.canUndo && !(sent.plan.scope === 'fleet' && c.active)) { clearInterval(timer); timer = null; }
    };

    go.onclick = async () => {
      const { plan } = currentPlan();
      go.disabled = true;
      const out = await runKill(plan, deps);
      if (out.cancelled) { go.disabled = false; return; }
      if (!out.ok) {
        status.textContent = `Refused: ${out.r?.error ?? out.error ?? 'error'}`;
        go.disabled = false;
        return;
      }
      sent = out;
      drawScopes();
      drawBody();
      if (plan.scope === 'lane' || !out.job) {
        status.textContent = plan.scope === 'lane' ? 'Killed' : 'Kill sent';
        return;
      }
      undo.textContent = plan.scope === 'fleet' ? 'Undo' : 'Cancel kill';
      tick();
      timer = setInterval(tick, 1000);
    };

    undo.onclick = async () => {
      if (!sent) return;
      undo.disabled = true;
      const r = await cancelKill(sent, deps);
      undo.disabled = false;
      if (r?.ok === true) {
        sent.cancelled = true;
        undo.hidden = true;
        status.textContent = killCountdown({ scope: sent.plan.scope, cancelled: true }).text;
        clearInterval(timer);
        timer = null;
      } else {
        status.textContent = `Cancel refused: ${r?.error ?? 'error'}`;
      }
    };

    close.onclick = finish;
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });

    drawScopes();
    drawBody();
    (opts.root ?? document.body).appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    close.focus();
  });
}
