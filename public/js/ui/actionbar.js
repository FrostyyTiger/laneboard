// The inspector's action bar (fleet plan §4 D6 stub, §8 2.9 / task C14).
//
//   ACTIONBAR_BUTTONS          D6's button list, in bar order:
//                              resume pause approve deny terminal interrupt restart kill retire
//   CONTROL_BUTTONS            what C14 adds or replaces on top (installControlActions):
//                              send release budget run-script send-review broadcast archive,
//                              approve/deny/pause/resume gated on their capability, deny with a note,
//                              and kill opening the kill dialog (ui/killswitch.js) at lane level
//   registerAction(spec)       add or replace one button {id, icon, label, action?, order?, cap?,
//                              hubOnly?, when?(m), disabled?(m) -> reason|null, args?(m),
//                              collect?(m, ctx) -> extra args | null, consequence?(m, extra),
//                              run?(m, ctx), target?: 'lane'}
//   unregisterAction(id)       drop one (built-in or registered)
//   actionList()               the registry, in bar order
//   actionBarModel(m, opts)    pure: [{id, icon, label, action, tier, disabled, reason}]
//   renderActionBar(el, ctx)   the DOM bar inside `el`
//   runBarItem(item, m, ctx)   collect (popover) -> confirmAction (§4 tiers) -> act() (F8a)
//   promptFields(spec)         the small popover the collect steps use (text, note, usd, script)
//
// Every action goes through confirmAction by its tier before act(): Cancel at
// either step sends nothing. `m` is the inspector model (ui/inspector.js
// inspectorModel). Pure at import time: no `document` until a render or a
// popover runs. Every builder-supplied text (names, reasons) reaches the page
// through textContent/setAttribute only.
import { icon } from '../core/icons.js';
import { act as pageAct, tierOf } from '../core/actions.js';
import { store } from '../core/store.js';
import { navigate } from '../core/router.js';
import { confirmAction as pageConfirm } from './confirm.js';
import { openKillDialog } from './killswitch.js';
import { openBroadcast } from './broadcast.js';

/** A spec field that may be a function of the model. */
const call = (f, m, d) => (typeof f === 'function' ? f(m) : f ?? d);

const noSession = (m) => (!m.sessionKey ? 'no session' : m.dead ? 'the session has ended' : null);

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

/** send-text cap (the dispatcher's text limit). */
export const SEND_TEXT_MAX = 4000;
/** deny note cap (server/control/handlers.mjs NOTE_MAX). */
export const DENY_NOTE_MAX = 500;
/** set-budget ceiling (server/control/budget.mjs MAX_USD, the launch cap). */
export const BUDGET_MAX_USD = 100000;
/** run-script name (server/config/review.mjs SCRIPT_NAME_RE). */
export const SCRIPT_NAME_RX = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * C14's buttons (§8 2.9). Orders slot them between D6's (10 .. 90). `cap` is
 * the hello capability the builder must list; a builder whose list is known
 * and lacks it shows the button disabled with that reason.
 */
const CONTROL = [
  {
    id: 'resume', icon: 'resume', label: 'Resume', action: 'resume', cap: 'pause',
    when: (m) => Boolean(m.paused),
    disabled: (m) => (m.sessionKey ? null : 'no session to resume'),
  },
  {
    id: 'pause', icon: 'pause', label: 'Pause', action: 'pause', cap: 'pause',
    when: (m) => !m.paused,
    disabled: (m) => (!m.sessionKey ? 'no session to pause' : m.dead ? 'the session has ended' : null),
  },
  {
    id: 'approve', icon: 'approve', label: 'Approve', action: 'approve', cap: 'approvals',
    when: (m) => Boolean(m.approvalId),
    args: (m) => ({ approvalId: m.approvalId }),
  },
  {
    id: 'deny', icon: 'deny', label: 'Deny', action: 'deny', cap: 'approvals',
    when: (m) => Boolean(m.approvalId),
    args: (m) => ({ approvalId: m.approvalId }),
    collect: async (m, ctx) => {
      const v = await (ctx.prompt ?? promptFields)({
        title: `Deny ${m.title}`,
        submit: 'Deny',
        fields: [{ name: 'note', label: 'note to the agent (optional)', type: 'textarea', max: DENY_NOTE_MAX }],
      });
      if (!v) return null;
      const note = typeof v.note === 'string' ? v.note.trim().slice(0, DENY_NOTE_MAX) : '';
      return note ? { note } : {};
    },
  },
  {
    id: 'release', icon: 'external', label: 'Release to terminal', action: 'release', cap: 'approvals', order: 45,
    when: (m) => Boolean(m.approvalId),
    args: (m) => ({ approvalId: m.approvalId }),
  },
  {
    id: 'send', icon: 'send', label: 'Send…', action: 'send-text', order: 55,
    disabled: noSession,
    collect: async (m, ctx) => {
      const v = await (ctx.prompt ?? promptFields)({
        title: `Send to ${m.title}`,
        submit: 'Send',
        fields: [
          { name: 'text', label: 'text (typed into the pane exactly as written)', type: 'textarea', required: true, max: SEND_TEXT_MAX },
          { name: 'enter', label: 'press Enter after the text', type: 'checkbox', value: true },
        ],
      });
      return sendArgs(v);
    },
    consequence: (m, extra) => [`types ${extra.text.length} characters into ${m.title}${extra.enter ? ', then Enter' : ''}`],
  },
  {
    id: 'kill', icon: 'kill', label: 'Kill…', action: 'kill',
    disabled: (m) => (!m.sessionKey ? 'no session' : m.dead ? 'already ended' : null),
    run: (m, ctx) => (ctx.openKill ?? openKillDialog)({ scope: 'lane', model: m }),
  },
  {
    id: 'budget', icon: 'budget', label: 'Budget…', action: 'set-budget', cap: 'budget', target: 'lane', order: 92,
    disabled: (m) => (m.laneKey ? null : 'not a lane'),
    collect: async (m, ctx) => {
      const v = await (ctx.prompt ?? promptFields)({
        title: `Budget for ${m.title}`,
        submit: 'Set budget',
        fields: [{ name: 'usd', label: 'cap in USD (empty clears it)', type: 'number', max: BUDGET_MAX_USD }],
      });
      return budgetArgs(v);
    },
    consequence: (m, extra) => [extra.usd === null ? `clears the budget cap of ${m.title}` : `caps ${m.title} at $${extra.usd}`],
  },
  {
    id: 'run-script', icon: 'play', label: 'Run script…', action: 'run-script', cap: 'scripts', target: 'lane', order: 94,
    disabled: (m) => (m.laneKey ? null : 'not a lane'),
    collect: async (m, ctx) => {
      const v = await (ctx.prompt ?? promptFields)({
        title: `Run a script in ${m.title}`,
        submit: 'Run',
        fields: [{ name: 'script', label: 'script name (from the builder config)', type: 'text', required: true, max: 24, pattern: SCRIPT_NAME_RX }],
      });
      return scriptArgs(v);
    },
    consequence: (m, extra) => [`runs the configured script ${extra.script} in ${m.title}`],
  },
  {
    // The review is written in the diff view, which sends it through its own
    // confirm (tier ask); the bar only takes you there.
    id: 'send-review', icon: 'review', label: 'Review…', action: 'send-review', cap: 'review', target: 'lane', order: 96,
    disabled: (m) => (m.laneKey ? null : 'not a lane'),
    run: (m, ctx) => (ctx.navigate ?? navigate)({ view: 'diff', sel: m.laneKey }),
  },
  {
    id: 'broadcast', icon: 'broadcast', label: 'Broadcast…', action: 'broadcast', hubOnly: true, order: 98,
    run: (m, ctx) => (ctx.openBroadcast ?? openBroadcast)({ selection: m.sessionKey ? [m.sessionKey] : [] }),
  },
  {
    // R14: the Archive is a Board filter; this is its entry point from the inspector.
    id: 'archive', icon: 'search', label: 'Archive', action: null, order: 99,
    run: (m, ctx) => (ctx.navigate ?? navigate)({ view: 'board', s: 'archive', q: null }),
  },
];

/** C14's button ids (added to or replacing D6's). */
export const CONTROL_BUTTONS = Object.freeze(CONTROL.map((b) => b.id));

/** A send popover's values -> send-text args, or null. */
export function sendArgs(v) {
  if (!v || typeof v.text !== 'string') return null;
  const text = v.text.slice(0, SEND_TEXT_MAX);
  if (text.trim() === '') return null;
  return { text, enter: v.enter !== false };
}

/** A budget popover's values -> set-budget args, or null (bad number). Empty clears the cap. */
export function budgetArgs(v) {
  if (!v) return null;
  const raw = v.usd == null ? '' : String(v.usd).trim();
  if (raw === '') return { usd: null };
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0 || usd > BUDGET_MAX_USD) return null;
  return { usd: Math.round(usd * 100) / 100 };
}

/** A run-script popover's values -> run-script args, or null. */
export function scriptArgs(v) {
  const s = typeof v?.script === 'string' ? v.script.trim() : '';
  return SCRIPT_NAME_RX.test(s) ? { script: s } : null;
}

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

/** Add C14's buttons on top of D6's (idempotent). Runs once at import; tests call it after _resetActions. */
export function installControlActions() {
  for (const spec of CONTROL) registerAction(spec);
  return actionList().map((a) => a.id);
}

/** Tests only: back to the plan's (D6) buttons, without C14's. */
export function _resetActions() {
  registry.clear();
  nextOrder = 0;
  for (const b of BUILTIN) add(b, (nextOrder += 10));
}

installControlActions();

/**
 * The capability list of the model's builder, or null when it is not known
 * (no hello yet): an unknown list gates nothing, a known one gates by `cap`.
 * `opts.capabilities` (array) or `opts.capsOf(builder)` override the store.
 */
export function capabilitiesFor(m, opts = {}) {
  let caps;
  if (Array.isArray(opts.capabilities)) caps = opts.capabilities;
  else if (typeof opts.capsOf === 'function') caps = opts.capsOf(m?.builder ?? null);
  else {
    const s = opts.store ?? store;
    const local = s?.source?.kind !== 'hub' && Array.isArray(s?.source?.hello?.capabilities) ? s.source.hello.capabilities : null;
    const b = m?.builder && typeof s?.builders?.get === 'function' ? s.builders.get(m.builder) : null;
    caps = local ?? b?.capabilities;
  }
  return Array.isArray(caps) && caps.length > 0 ? caps : null;
}

/** Is the page (or `opts`) on a hub? */
function barOnHub(opts) {
  if (typeof opts.hub === 'boolean') return opts.hub;
  const s = opts.store ?? store;
  return s?.source?.kind === 'hub';
}

/**
 * The bar for model `m`: the buttons whose `when` holds, each with its tier
 * (live hello.actions, fallback ACTION_TIERS) and a disabled reason. A
 * builder that is down or stale disables every action button (the terminal
 * too: it would not connect). A button whose capability the builder does not
 * list is disabled with that reason; a hub-only one off the hub likewise.
 * `opts.tierOf(action)` overrides the lookup. Pure.
 */
export function actionBarModel(m, opts = {}) {
  if (!m || !m.found) return [];
  const tier = opts.tierOf ?? ((a) => tierOf(a));
  const caps = capabilitiesFor(m, opts);
  const hub = barOnHub(opts);
  const out = [];
  for (const spec of actionList()) {
    let shown;
    try { shown = call(spec.when, m, true); } catch { shown = false; }
    if (!shown) continue;
    let reason = null;
    try { reason = call(spec.disabled, m, null); } catch { reason = 'unavailable'; }
    if (!reason && spec.hubOnly && !hub) reason = `${spec.action ?? spec.id} runs on the hub`;
    if (!reason && spec.cap && caps && !caps.includes(spec.cap)) {
      reason = `builder ${m.builder ?? ''} has no ${spec.cap} capability`.replace('  ', ' ');
    }
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

/** A refusal code -> what the operator can do about it. */
export function refusalHint(r) {
  const code = r?.code ?? r?.error;
  if (code === 'remote-only' || r?.error === 'remote-only') return 'remote-only: use the board through serve or the hub';
  if (code === 'hub-control-disabled') return 'this builder does not take hub control';
  if (code === 'rate-limited' || code === 429) return 'rate-limited: try again shortly';
  return r?.error ?? 'error';
}

/**
 * Run one bar item for model `m`. `ctx`: {act, confirmAction, prompt, toast,
 * openTerminal, openKill, openBroadcast, navigate}. Order: the item's own
 * popover (collect), then confirmAction by tier, then act(). Cancel at either
 * step sends nothing. Resolves the act() result, or {ok:false, cancelled:true}.
 */
export async function runBarItem(item, m, ctx = {}) {
  const spec = registry.get(item?.id);
  if (!spec || item.disabled) return { ok: false, error: item?.reason ?? 'unavailable' };
  if (typeof spec.run === 'function') {
    await spec.run(m, ctx);
    return { ok: true };
  }
  const target = actionTarget(spec, m);
  if (!target) return { ok: false, error: 'no target' };
  let extra = {};
  if (typeof spec.collect === 'function') {
    extra = await spec.collect(m, ctx);
    if (!extra) return { ok: false, cancelled: true };
  }
  const ask = ctx.confirmAction ?? pageConfirm;
  const send = ctx.act ?? pageAct;
  let consequence = null;
  try { consequence = typeof spec.consequence === 'function' ? spec.consequence(m, extra) : null; } catch { consequence = null; }
  const q = { action: spec.action, targets: [target], tier: item.tier, builder: m.builder ?? null };
  if (consequence) q.consequence = consequence;
  const answer = await ask(q);
  if (!answer?.ok) return { ok: false, cancelled: true };
  const args = { ...(call(spec.args, m, null) ?? {}), ...extra };
  if (answer.confirm != null && item.tier === 'confirm') args.confirm = answer.confirm;
  const r = await send(target, spec.action, args);
  if (ctx.toast) {
    if (r?.ok === true) ctx.toast(`${spec.label} → ${m.title}`, { kind: 'ok' });
    else if (r?.ok === 'unknown') ctx.toast(`${spec.label}: sent, outcome unknown`, { kind: 'info' });
    else ctx.toast(`${spec.label} failed: ${refusalHint(r)}`, { kind: 'err' });
  }
  return r;
}

/**
 * Render the bar into `el` (replacing what was there). `ctx.model` is the
 * inspector model; the rest is passed to runBarItem. Returns the items drawn.
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
    b.onclick = () => { runBarItem(it, m, ctx).catch(() => {}); };
    el.append(b);
  }
  el.hidden = items.length === 0;
  return items;
}

// ---------------------------------------------------------------- popover

/**
 * Check popover values against their field specs. Returns an error sentence
 * or null. Pure.
 */
export function fieldsError(fields, values) {
  for (const f of fields ?? []) {
    const v = values?.[f.name];
    if (f.type === 'checkbox') continue;
    const s = v == null ? '' : String(v);
    if (f.required && s.trim() === '') return `${f.label}: required`;
    if (f.max && f.type !== 'number' && s.length > f.max) return `${f.label}: at most ${f.max} characters`;
    if (f.type === 'number' && s.trim() !== '') {
      const n = Number(s);
      if (!Number.isFinite(n) || n <= 0 || (f.max && n > f.max)) return `${f.label}: a number above 0${f.max ? ` and at most ${f.max}` : ''}`;
    }
    if (f.pattern && s !== '' && !f.pattern.test(s.trim())) return `${f.label}: not a valid name`;
  }
  return null;
}

/**
 * A small modal form: {title, submit, fields:[{name, label, type:'text'|
 * 'textarea'|'number'|'checkbox', value?, required?, max?, pattern?}]}.
 * Resolves {name: value} on submit, null on Cancel/Esc. Labels and values go
 * in as textContent / .value only.
 */
export function promptFields({ title = '', submit = 'OK', fields = [], root = null } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'cfm ab-pop';
    const head = document.createElement('h2');
    head.className = 'cfm-t';
    head.textContent = String(title);
    const body = document.createElement('div');
    body.className = 'cfm-d';
    const inputs = new Map();
    for (const f of fields) {
      const lab = document.createElement('label');
      lab.className = 'cfm-in';
      const hint = document.createElement('span');
      hint.className = 'cfm-hint';
      hint.textContent = String(f.label ?? f.name);
      let input;
      if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 4;
      } else {
        input = document.createElement('input');
        input.type = f.type === 'checkbox' ? 'checkbox' : f.type === 'number' ? 'number' : 'text';
        if (f.type === 'number') { input.min = '0'; input.step = '0.01'; }
      }
      if (f.max && f.type !== 'number' && f.type !== 'checkbox') input.maxLength = f.max;
      if (f.type === 'checkbox') input.checked = f.value !== false;
      else if (f.value != null) input.value = String(f.value);
      input.autocomplete = 'off';
      input.spellcheck = false;
      lab.append(hint, input);
      body.append(lab);
      inputs.set(f.name, { f, input });
    }
    const err = document.createElement('p');
    err.className = 'cfm-err';
    err.setAttribute('role', 'status');
    body.append(err);
    const row = document.createElement('div');
    row.className = 'cfm-b';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn btn--primary';
    ok.textContent = String(submit);
    row.append(cancel, ok);
    dlg.append(head, body, row);

    let done = false;
    const values = () => {
      const v = {};
      for (const [name, { f, input }] of inputs) v[name] = f.type === 'checkbox' ? Boolean(input.checked) : input.value;
      return v;
    };
    const finish = (out) => {
      if (done) return;
      done = true;
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
      dlg.remove();
      resolve(out);
    };
    const submitNow = () => {
      const v = values();
      const e = fieldsError(fields, v);
      if (e) { err.textContent = e; return; }
      finish(v);
    };
    cancel.onclick = () => finish(null);
    ok.onclick = submitNow;
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('close', () => finish(null));
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || e.target?.tagName !== 'TEXTAREA')) { e.preventDefault(); submitNow(); }
    });
    (root ?? document.body).appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    (inputs.values().next().value?.input ?? cancel).focus();
  });
}
