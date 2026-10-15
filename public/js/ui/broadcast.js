// The broadcast dialog (fleet plan §8 2.4 / 2.9, task C14).
//
// Target picker (the current selection, or a filter: builder / state / repo),
// a text area, and a live preview computed with the same planner the hub runs
// (core/broadcast-plan.js, C8): exactly the text each pane will receive, the
// lanes it goes to, and every skipped lane with its reason.
//
// The hub's confirm contract (C8-fix, SR18 L1):
//   1. The first POST /api/fleet/actions {builder:'*', action:'broadcast',
//      target:'*', args:{targets, text, enter, confirmCount}} carries no
//      planHash; the hub answers 409 `plan-required` with result
//      {plan, preview, confirmCount, planHash}. Nothing is sent yet.
//   2. The dialog shows the hub's plan and asks for the typed count through
//      the §4 confirmAction (BROADCAST <n>).
//   3. The confirmed call echoes planHash and the typed confirmCount.
//      409 `plan-changed` / `confirm-mismatch` carry a fresh plan: it is shown
//      and asked for again. 409 `nothing-to-send`, 429 `rate-limited` /
//      `too-many-refusals` and every other refusal end the attempt with the
//      hub's reason.
//
// Untrusted text (lane keys, the hub's echo of the preview) reaches the page
// through textContent only. Pure at import time.
import {
  BROADCAST_LIMITS, PLAN_HASH_RE, isBroadcastKey, planBroadcast, previewBroadcast, validateBroadcast,
} from '../core/broadcast-plan.js';
import { store } from '../core/store.js';
import { confirmAction as pageConfirm } from './confirm.js';

/** Skip reasons (broadcast-plan SKIP_REASONS) in words. */
export const SKIP_WHY = Object.freeze({
  invalid: 'not a lane key',
  duplicate: 'listed twice',
  'builder-down': 'its builder is not reachable from the hub',
  unknown: 'its state is unknown',
  dead: 'the session has ended',
  shell: 'a shell, not a Claude session',
  prompting: 'a prompt, a question or a dialog is on screen',
  paused: 'paused',
});

/** The refusals the dialog explains, by code. */
export const REFUSAL_WHY = Object.freeze({
  'nothing-to-send': 'no target lane can be sent to now',
  'rate-limited': 'one broadcast per 10 s: wait and try again',
  'too-many-refusals': 'too many refused broadcasts in the last minute: wait and try again',
  'remote-only': 'broadcast is remote-only: open the hub through serve',
  'text-too-long': 'the text is longer than 2000 characters',
  'too-many-targets': 'at most 30 lanes per broadcast',
  'bad-text': 'the text is empty once cleaned',
  'bad-targets': 'a target is not a lane key',
  'bad-plan-hash': 'the hub plan was garbled: start again',
  'plan-unstable': 'the plan kept changing: try again',
});

export const BROADCAST_PATH = '/api/fleet/actions';
const MAX_ROUNDS = 3;

/** Why a skip reason applies, in words. */
export function skipWhy(reason) {
  return Object.hasOwn(SKIP_WHY, reason) ? SKIP_WHY[reason] : String(reason ?? 'skipped');
}

function laneRepo(s, sess) {
  if (typeof sess?.repo === 'string') return sess.repo;
  const lane = typeof sess?.lane === 'string' ? sess.lane : null;
  if (!lane) return null;
  const rec = (Array.isArray(s?.lanes) ? s.lanes : []).find((l) => l && l.id === lane && (l.builder == null || l.builder === sess.builder));
  return typeof rec?.repo === 'string' ? rec.repo : null;
}

/**
 * The target list. `pick`: {mode:'selection', selection:[fkey]} or
 * {mode:'filter', builder?, state?, repo?}. Filters match lane sessions only.
 * Returns {targets (≤30), total, truncated}. Pure over store `s`.
 */
export function broadcastTargets(s, pick = {}) {
  let keys;
  if (pick.mode === 'filter') {
    keys = [];
    for (const [k, sess] of s?.sessions ?? []) {
      if (!sess || typeof sess !== 'object') continue;
      if (sess.lane == null || sess.lane === '') continue;
      if (pick.builder && sess.builder !== pick.builder) continue;
      if (pick.state && sess.state !== pick.state) continue;
      if (pick.repo && laneRepo(s, sess) !== pick.repo) continue;
      if (isBroadcastKey(k)) keys.push(k);
    }
    keys.sort();
  } else {
    keys = [...new Set((Array.isArray(pick.selection) ? pick.selection : []).filter((k) => typeof k === 'string'))];
  }
  const max = BROADCAST_LIMITS.maxTargets;
  return { targets: keys.slice(0, max), total: keys.length, truncated: keys.length > max };
}

/** Is builder `id` controllable from the hub now (the planner's builderUp)? */
export function builderUpIn(s, id) {
  const b = s?.builders?.get?.(id);
  if (!b) return false;
  if (b.status === 'down' || b.status === 'stale' || b.stale === true) return false;
  return b.controls !== false;
}

/**
 * The live preview: the same plan the hub will compute from its view (it may
 * differ if a lane changes state meanwhile; the hub's 409 plan is what gets
 * confirmed). {plan, preview, error, confirmCount, skips:[{key, reason, why}]}.
 */
export function broadcastPreview(s, targets, text, enter = true) {
  const sessions = new Map();
  for (const k of targets) {
    const sess = s?.sessions?.get?.(k);
    if (sess) sessions.set(k, sess);
  }
  const plan = planBroadcast(targets, sessions, { builderUp: (id) => builderUpIn(s, id) });
  const preview = previewBroadcast(text, enter);
  const confirmCount = plan.send.length;
  let error = validateBroadcast({ targets, text, enter, confirmCount: Math.max(1, confirmCount) });
  if (!error && confirmCount === 0) error = 'nothing-to-send';
  return { plan, preview, confirmCount, error, skips: plan.skip.map((x) => ({ ...x, why: skipWhy(x.reason) })) };
}

/** The request body of one broadcast call. */
export function broadcastBody({ targets, text, enter, confirmCount, planHash }) {
  const args = { targets: [...targets], text, enter: enter !== false, confirmCount };
  if (planHash !== undefined) args.planHash = planHash;
  return { builder: '*', action: 'broadcast', target: '*', args };
}

/** A hub 409 plan (result {plan, preview, confirmCount, planHash}), checked; or null. */
export function hubPlanOf(r) {
  const res = r?.result;
  if (!res || typeof res !== 'object') return null;
  const plan = res.plan;
  if (!plan || !Array.isArray(plan.send) || !Array.isArray(plan.skip)) return null;
  const send = plan.send.filter((k) => typeof k === 'string');
  const skip = plan.skip.filter((x) => x && typeof x.key === 'string').map((x) => ({ key: x.key, reason: String(x.reason ?? ''), why: skipWhy(x.reason) }));
  const preview = res.preview && typeof res.preview.text === 'string'
    ? { text: res.preview.text, enter: res.preview.enter !== false, chars: res.preview.text.length, lines: res.preview.text === '' ? 0 : res.preview.text.split('\n').length }
    : null;
  const planHash = typeof res.planHash === 'string' && PLAN_HASH_RE.test(res.planHash) ? res.planHash : null;
  const confirmCount = Number.isInteger(res.confirmCount) ? res.confirmCount : send.length;
  return { plan: { send, skip }, preview, planHash, confirmCount };
}

/** POST one broadcast call; keeps the hub's `result` on a refusal (the 409 plan). */
export async function postBroadcast(body, fetcher = null) {
  const send = typeof fetcher === 'function' ? fetcher : (u, i) => fetch(u, i);
  let r;
  try {
    r = await send(BROADCAST_PATH, { method: 'POST', headers: { 'content-type': 'application/json', 'x-laneboard': '1' }, body: JSON.stringify(body) });
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || 'network error' };
  }
  let json = null;
  try { json = await r.json(); } catch { /* not JSON */ }
  const out = json && typeof json === 'object' ? { ...json } : {};
  out.status = Number.isInteger(r.status) ? r.status : (r.ok ? 200 : 500);
  if (!('ok' in out)) out.ok = r.ok === true;
  if (!out.ok && typeof out.error !== 'string') out.error = `HTTP ${out.status}`;
  return out;
}

/**
 * The whole confirm round trip (pure over its deps): {targets, text, enter} and
 * deps {post(body), confirm(hubPlan, code) -> {ok, confirmCount?}, onPlan?(hubPlan, code)}.
 * Resolves {kind:'done'|'cancelled'|'nothing'|'refused', result?, code?, plan?, retryAfterMs?}.
 * Never sends a planHash the hub did not give, and never a confirmed call
 * without a typed confirm.
 */
export async function sendBroadcast({ targets, text, enter = true, confirmCount = 1 }, deps) {
  let count = Number.isInteger(confirmCount) && confirmCount > 0 ? confirmCount : 1;
  let planHash;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const r = await deps.post(broadcastBody({ targets, text, enter, confirmCount: count, planHash }));
    if (r?.status === 200 && r.result && typeof r.result === 'object') {
      return { kind: 'done', ok: r.ok === true, result: r.result };
    }
    const code = typeof r?.error === 'string' ? r.error : null;
    if (r?.status === 409) {
      const hp = hubPlanOf(r);
      if (hp) deps.onPlan?.(hp, code);
      if (code === 'nothing-to-send') return { kind: 'nothing', code, plan: hp };
      if (hp && hp.planHash && ['plan-required', 'plan-changed', 'confirm-mismatch'].includes(code)) {
        if (round === MAX_ROUNDS) break;
        const ans = await deps.confirm(hp, code);
        if (!ans?.ok) return { kind: 'cancelled', plan: hp };
        const typed = Number.isInteger(ans.confirmCount) ? ans.confirmCount : (hp.plan.send.length === 1 ? 1 : null);
        if (typed == null) return { kind: 'cancelled', plan: hp };
        count = typed;
        planHash = hp.planHash;
        continue;
      }
    }
    const out = { kind: 'refused', code: code ?? `HTTP ${r?.status ?? 0}`, detail: typeof r?.detail === 'string' ? r.detail : null };
    if (Number.isFinite(r?.retryAfterMs)) out.retryAfterMs = r.retryAfterMs;
    return out;
  }
  return { kind: 'refused', code: 'plan-unstable' };
}

/** The typed confirm for a hub plan: the §4 typed form, BROADCAST <n>. */
export function confirmBroadcastPlan(hp, code, ask = null) {
  const lines = [];
  if (code === 'plan-changed') lines.push('The plan changed since the preview: check it again.');
  if (code === 'confirm-mismatch') lines.push('The count did not match the plan: check it again.');
  lines.push(`types ${hp.preview?.chars ?? 0} characters${hp.preview?.enter ? ', then Enter,' : ''} into ${hp.plan.send.length} lane${hp.plan.send.length === 1 ? '' : 's'}`);
  if (hp.plan.skip.length) lines.push(`skips ${hp.plan.skip.length}: ${hp.plan.skip.slice(0, 6).map((x) => `${x.key} (${x.why})`).join(', ')}${hp.plan.skip.length > 6 ? ', …' : ''}`);
  return (ask ?? pageConfirm)({ action: 'broadcast', targets: hp.plan.send, tier: 'confirm', consequence: lines });
}

/** A refusal in words. */
export function refusalText(out) {
  const why = Object.hasOwn(REFUSAL_WHY, out?.code) ? REFUSAL_WHY[out.code] : (out?.detail ?? out?.code ?? 'refused');
  const wait = Number.isFinite(out?.retryAfterMs) ? ` (retry in ${Math.ceil(out.retryAfterMs / 1000)} s)` : '';
  return `${why}${wait}`;
}

// ---------------------------------------------------------------- dialog

function bcEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

/**
 * Draw a plan into `box` (cleared first): the exact typed text, the lanes it
 * goes to and the skipped ones with their reasons. All textContent.
 */
export function renderBroadcastPlan(box, { plan, preview, skips }, { heading = 'Preview' } = {}) {
  box.textContent = '';
  box.append(bcEl('p', 'bc-h', heading));
  const pre = bcEl('pre', 'bc-text', preview?.text ?? '');
  pre.setAttribute('aria-label', 'Exactly what is typed');
  box.append(pre);
  box.append(bcEl('p', 'bc-meta', `${preview?.chars ?? 0} characters, ${preview?.lines ?? 0} line${preview?.lines === 1 ? '' : 's'}${preview?.enter ? ', then Enter' : ', no Enter'}`));
  box.append(bcEl('p', 'bc-h', `Sends to ${plan.send.length} lane${plan.send.length === 1 ? '' : 's'}`));
  const to = bcEl('ul', 'bc-send');
  for (const k of plan.send) to.append(bcEl('li', null, k));
  box.append(to);
  const list = skips ?? plan.skip;
  if (list.length) {
    box.append(bcEl('p', 'bc-h', `Skips ${list.length}`));
    const sk = bcEl('ul', 'bc-skip');
    for (const x of list) sk.append(bcEl('li', null, `${x.key}: ${x.why ?? skipWhy(x.reason)}`));
    box.append(sk);
  }
  return box;
}

/** The outcome lists of a done broadcast, as lines. */
export function outcomeLines(result) {
  const sent = Array.isArray(result?.sent) ? result.sent : [];
  const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
  const failed = Array.isArray(result?.failed) ? result.failed : [];
  const lines = [`Sent to ${sent.length}${sent.length ? `: ${sent.join(', ')}` : ''}`];
  if (skipped.length) lines.push(`Skipped ${skipped.length}: ${skipped.map((x) => `${x?.key} (${skipWhy(x?.reason)})`).join(', ')}`);
  if (failed.length) lines.push(`Failed ${failed.length}: ${failed.map((x) => `${x?.key} (${x?.error ?? 'error'}${x?.outcome === 'unknown' ? ', outcome unknown' : ''})`).join(', ')}`);
  return lines;
}

let bcSeq = 0;

/**
 * Open the broadcast dialog. `opts`: {selection:[fkey], store, deps:{post,
 * confirmAction}}. Off the hub it explains that broadcast runs there.
 * Resolves the last sendBroadcast outcome (or null) when it closes.
 */
export function openBroadcast(opts = {}) {
  const s = opts.store ?? store;
  const deps = opts.deps ?? {};
  const hub = s?.source?.kind === 'hub';
  const selection = Array.isArray(opts.selection) ? opts.selection : [];
  const pick = { mode: selection.length ? 'selection' : 'filter', selection, builder: '', state: '', repo: '' };
  let outcome = null;
  let busy = false;

  return new Promise((resolve) => {
    const n = ++bcSeq;
    const dlg = bcEl('dialog', 'cfm bc');
    dlg.setAttribute('aria-labelledby', `bc-t-${n}`);
    const head = bcEl('h2', 'cfm-t', 'BROADCAST');
    head.id = `bc-t-${n}`;
    const body = bcEl('div', 'cfm-d');
    const status = bcEl('p', 'bc-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const row = bcEl('div', 'cfm-b');
    const cancel = bcEl('button', 'btn', 'Close');
    cancel.type = 'button';
    const send = bcEl('button', 'btn btn--primary', 'Send…');
    send.type = 'button';
    row.append(cancel, send);
    dlg.append(head, body, status, row);

    const finish = () => {
      if (dlg.open && typeof dlg.close === 'function') dlg.close();
      dlg.remove();
      resolve(outcome);
    };
    cancel.onclick = finish;
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });

    if (!hub) {
      body.append(bcEl('p', null, 'Broadcast runs on the hub: open the fleet board to send one text to several lanes.'));
      send.disabled = true;
    } else {
      // target picker
      const scopes = bcEl('div', 'bc-scope');
      scopes.setAttribute('role', 'radiogroup');
      scopes.setAttribute('aria-label', 'Targets');
      const filters = bcEl('div', 'bc-filters');
      const mk = (label, node) => { const l = bcEl('label', null, `${label} `); l.append(node); return l; };
      const bSel = document.createElement('select');
      bSel.append(Object.assign(bcEl('option', null, 'any builder'), { value: '' }));
      for (const id of [...(s.builders?.keys?.() ?? [])].sort()) bSel.append(Object.assign(bcEl('option', null, id), { value: id }));
      const stSel = document.createElement('select');
      for (const v of ['', 'idle', 'done', 'working']) stSel.append(Object.assign(bcEl('option', null, v || 'any state'), { value: v }));
      const repoIn = document.createElement('input');
      repoIn.type = 'text';
      repoIn.placeholder = 'repo';
      repoIn.spellcheck = false;
      filters.append(mk('builder', bSel), mk('state', stSel), mk('repo', repoIn));
      for (const mode of ['selection', 'filter']) {
        const lab = bcEl('label', 'bc-mode');
        const r = document.createElement('input');
        r.type = 'radio';
        r.name = `bc-mode-${n}`;
        r.value = mode;
        r.checked = pick.mode === mode;
        r.disabled = mode === 'selection' && !selection.length;
        r.onchange = () => { pick.mode = mode; redraw(); };
        lab.append(r, bcEl('span', null, mode === 'selection' ? `current selection (${selection.length})` : 'filter'));
        scopes.append(lab);
      }
      const text = document.createElement('textarea');
      text.rows = 5;
      text.maxLength = BROADCAST_LIMITS.maxText;
      text.spellcheck = false;
      text.setAttribute('aria-label', 'Text to type into every target');
      const enterLab = bcEl('label', 'bc-enter');
      const enter = document.createElement('input');
      enter.type = 'checkbox';
      enter.checked = true;
      enterLab.append(enter, bcEl('span', null, 'press Enter after the text'));
      const count = bcEl('p', 'bc-count');
      const planBox = bcEl('div', 'bc-plan');
      body.append(scopes, filters, text, enterLab, count, planBox);

      let current = null;
      const redraw = () => {
        if (busy) return;
        pick.builder = bSel.value;
        pick.state = stSel.value;
        pick.repo = repoIn.value.trim();
        filters.hidden = pick.mode !== 'filter';
        const t = broadcastTargets(s, pick);
        current = { ...t, ...broadcastPreview(s, t.targets, text.value, enter.checked) };
        count.textContent = `${t.targets.length} target${t.targets.length === 1 ? '' : 's'}${t.truncated ? ` (the first ${BROADCAST_LIMITS.maxTargets} of ${t.total})` : ''}`;
        renderBroadcastPlan(planBox, current);
        status.textContent = current.error && text.value !== '' ? refusalText({ code: current.error }) : '';
        send.disabled = Boolean(current.error);
      };
      bSel.onchange = redraw;
      stSel.onchange = redraw;
      repoIn.oninput = redraw;
      text.oninput = redraw;
      enter.onchange = redraw;

      send.onclick = async () => {
        if (!current || current.error || busy) return;
        busy = true;
        send.disabled = true;
        status.textContent = 'Asking the hub for its plan…';
        const out = await sendBroadcast(
          { targets: current.targets, text: text.value, enter: enter.checked, confirmCount: current.confirmCount },
          {
            post: deps.post ?? ((b) => postBroadcast(b, deps.fetch)),
            confirm: (hp, code) => confirmBroadcastPlan(hp, code, deps.confirmAction ?? pageConfirm),
            onPlan: (hp, code) => {
              renderBroadcastPlan(planBox, { plan: hp.plan, preview: hp.preview ?? current.preview, skips: hp.plan.skip }, {
                heading: code === 'plan-changed' ? 'The hub plan changed' : 'The hub plan',
              });
            },
          },
        );
        outcome = out;
        busy = false;
        if (out.kind === 'done') {
          planBox.textContent = '';
          for (const line of outcomeLines(out.result)) planBox.append(bcEl('p', null, line));
          status.textContent = out.ok ? 'Sent' : 'Sent, with failures';
          send.hidden = true;
          return;
        }
        if (out.kind === 'cancelled') status.textContent = 'Cancelled: nothing was sent';
        else status.textContent = `Not sent: ${refusalText(out)}`;
        send.disabled = false;
      };
      redraw();
    }

    (opts.root ?? document.body).appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    cancel.focus();
  });
}
