// The inspector's action bar (fleet plan §4 D6 stub; §8 C14 owns this file
// afterwards and fills it with the kill dialog, the budget popover, Send…).
//
// What the stub gives C14 to build on:
//   ACTIONBAR_BUTTONS          the plan's button list, in bar order:
//                              resume pause approve deny terminal interrupt restart kill retire
//   registerAction(spec)       add or replace one button {id, icon, label, action?, order?,
//                              when?(m), disabled?(m) -> reason|null, args?(m), run?(m, ctx)}
//   unregisterAction(id)       drop one (built-in or registered)
//   actionList()               the registry, in bar order
//   actionBarModel(m, opts)    pure: [{id, icon, label, action, tier, disabled, reason}]
//   renderActionBar(el, ctx)   the DOM bar inside `el`
//   runAction(item, m, ctx)    confirmAction (§4 D3) then act() (§1 F8a)
//
// `m` is the inspector model (ui/inspector.js inspectorModel). Pure at import
// time: no `document` until renderActionBar runs. Every builder-supplied text
// (names, reasons) reaches the page through textContent/setAttribute only.
import { icon } from '../core/icons.js';
import { act as pageAct, tierOf } from '../core/actions.js';
import { confirmAction as pageConfirm } from './confirm.js';

/** A spec field that may be a function of the model. */
const call = (f, m, d) => (typeof f === 'function' ? f(m) : f ?? d);

/**
 * The plan's buttons (§4 D6). `when` hides a button that makes no sense for
 * this lane (approve without a pending approval); `disabled` keeps it visible
 * but greyed, with the reason as its tooltip (§8: "disabled with the reason").
 */
const BUILTIN = [
  {
    id: 'resume', icon: 'resume', label: 'Resume', action: 'resume',
    when: (m) => Boolean(m.paused),
    disabled: (m) => (m.sessionKey ? null : 'no session to resume'),
  },
  {
    id: 'pause', icon: 'pause', label: 'Pause', action: 'pause',
    when: (m) => !m.paused,
    disabled: (m) => (!m.sessionKey ? 'no session to pause' : m.dead ? 'the session has ended' : null),
  },
  {
    id: 'approve', icon: 'approve', label: 'Approve', action: 'approve',
    when: (m) => Boolean(m.approvalId),
    args: (m) => ({ approvalId: m.approvalId }),
  },
  {
    id: 'deny', icon: 'deny', label: 'Deny', action: 'deny',
    when: (m) => Boolean(m.approvalId),
    args: (m) => ({ approvalId: m.approvalId }),
  },
  {
    id: 'terminal', icon: 'terminal', label: 'Terminal', action: null,
    disabled: (m) => (!m.sessionKey ? 'no session' : m.dead ? 'the session has ended' : null),
    run: (m, ctx) => ctx.openTerminal?.(m.sessionKey),
  },
  {
    id: 'interrupt', icon: 'interrupt', label: 'Interrupt (Esc)', action: 'interrupt',
    disabled: (m) => (!m.sessionKey ? 'no session' : m.dead ? 'the session has ended' : null),
  },
  {
    id: 'restart', icon: 'restart', label: 'Restart', action: 'restart',
    disabled: (m) => (m.sessionKey ? null : 'no session'),
  },
  {
    id: 'kill', icon: 'kill', label: 'Kill', action: 'kill',
    disabled: (m) => (!m.sessionKey ? 'no session' : m.dead ? 'already ended' : null),
  },
  {
    id: 'retire', icon: 'retire', label: 'Retire lane', action: 'retire', target: 'lane',
    disabled: (m) => (!m.laneKey ? 'not a lane' : m.isMain ? 'the main checkout is never retired' : null),
  },
];

/** The plan's button ids, in bar order. */
export const ACTIONBAR_BUTTONS = Object.freeze(BUILTIN.map((b) => b.id));

const ID_RX = /^[a-z][a-z0-9-]{0,31}$/;
const registry = new Map();
let nextOrder = 0;

function add(spec, order) {
  registry.set(spec.id, Object.freeze({ ...spec, order }));
}
for (const b of BUILTIN) add(b, (nextOrder += 10));

/**
 * Add or replace a button. A replaced button keeps its place unless `order`
 * is given; a new one goes at the end. Returns an unregister function.
 */
export function registerAction(spec) {
  if (!spec || typeof spec !== 'object' || !ID_RX.test(String(spec.id))) throw new TypeError('registerAction: bad id');
  if (typeof spec.icon !== 'string' || typeof spec.label !== 'string') throw new TypeError('registerAction: icon and label are strings');
  if (spec.action == null && typeof spec.run !== 'function') throw new TypeError('registerAction: needs an action or a run()');
  const old = registry.get(spec.id);
  const order = Number.isFinite(spec.order) ? spec.order : old ? old.order : (nextOrder += 10);
  add(spec, order);
  const mine = registry.get(spec.id);
  return () => { if (registry.get(spec.id) === mine) registry.delete(spec.id); };
}

/** Drop a button. Returns true when it was there. */
export function unregisterAction(id) {
  return registry.delete(id);
}

/** The registry in bar order. */
export function actionList() {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

/** Tests only: back to the plan's buttons. */
export function _resetActions() {
  registry.clear();
  nextOrder = 0;
  for (const b of BUILTIN) add(b, (nextOrder += 10));
}

/**
 * The bar for model `m`: the buttons whose `when` holds, each with its tier
 * (live hello.actions, fallback ACTION_TIERS) and a disabled reason. A
 * builder that is down or stale disables every action button (the terminal
 * too: it would not connect). `opts.tierOf(action)` overrides the lookup. Pure.
 */
export function actionBarModel(m, opts = {}) {
  if (!m || !m.found) return [];
  const tier = opts.tierOf ?? ((a) => tierOf(a));
  const out = [];
  for (const spec of actionList()) {
    let shown;
    try { shown = call(spec.when, m, true); } catch { shown = false; }
    if (!shown) continue;
    let reason = null;
    try { reason = call(spec.disabled, m, null); } catch { reason = 'unavailable'; }
    if (!reason && m.builderDown) reason = `builder ${m.builder ?? ''} is not reachable`.replace('  ', ' ');
    out.push({
      id: spec.id,
      icon: spec.icon,
      label: spec.label,
      action: spec.action ?? null,
      tier: spec.action ? tier(spec.action) : 'read',
      disabled: Boolean(reason),
      reason: reason ? String(reason) : null,
    });
  }
  return out;
}

/** The key an action addresses: the session, or the lane for lane actions. */
export function actionTarget(spec, m) {
  if (spec?.target === 'lane') return m.laneKey ?? null;
  return m.sessionKey ?? m.laneKey ?? null;
}

/**
 * Run one bar item for model `m`. `ctx`: {act, confirmAction, toast,
 * openTerminal}. Asks by tier first; Cancel sends nothing. Resolves the act()
 * result, or {ok:false, cancelled:true}.
 */
export async function runAction(item, m, ctx = {}) {
  const spec = registry.get(item?.id);
  if (!spec || item.disabled) return { ok: false, error: item?.reason ?? 'unavailable' };
  if (typeof spec.run === 'function') {
    await spec.run(m, ctx);
    return { ok: true };
  }
  const target = actionTarget(spec, m);
  if (!target) return { ok: false, error: 'no target' };
  const ask = ctx.confirmAction ?? pageConfirm;
  const send = ctx.act ?? pageAct;
  const answer = await ask({ action: spec.action, targets: [target], tier: item.tier, builder: m.builder ?? null });
  if (!answer?.ok) return { ok: false, cancelled: true };
  const args = { ...(call(spec.args, m, null) ?? {}) };
  if (answer.confirm != null && item.tier === 'confirm') args.confirm = answer.confirm;
  const r = await send(target, spec.action, args);
  if (ctx.toast) {
    if (r?.ok === true) ctx.toast(`${spec.label} → ${m.title}`, { kind: 'ok' });
    else if (r?.ok === 'unknown') ctx.toast(`${spec.label}: sent, outcome unknown`, { kind: 'info' });
    else ctx.toast(`${spec.label} failed: ${r?.error ?? 'error'}`, { kind: 'err' });
  }
  return r;
}

/**
 * Render the bar into `el` (replacing what was there). `ctx.model` is the
 * inspector model; the rest is passed to runAction. Returns the items drawn.
 */
export function renderActionBar(el, ctx = {}) {
  const m = ctx.model;
  const doc = el.ownerDocument ?? globalThis.document;
  el.textContent = '';
  el.className = 'insp-actions';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Actions');
  const items = actionBarModel(m, ctx);
  for (const it of items) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'insp-act';
    b.dataset.action = it.id;
    if (it.tier === 'confirm') b.dataset.tier = 'confirm';
    const name = it.reason ? `${it.label}: ${it.reason}` : it.label;
    b.setAttribute('aria-label', name);
    b.title = name;
    b.disabled = it.disabled;
    b.append(icon(it.icon, { size: 'm' }));
    b.onclick = () => { runAction(it, m, ctx).catch(() => {}); };
    el.append(b);
  }
  el.hidden = items.length === 0;
  return items;
}
