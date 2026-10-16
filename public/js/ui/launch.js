// The launch sheet (moved from public/app.js in fleet F1; fleet plan §8 2.7,
// task C14).
//
// Fields: lane id, repo (from the chosen builder's hello `repos`, otherwise
// the union across builders), branch (default feat/<lane>), plan path
// (default docs/plans/<lane>.md), model (default opus), permission mode (from
// hello `permissionModes`, default auto), and, for a direct user only (every
// hub user; a builder reached through serve), priority and budget usd. On a
// hub the builder is `auto` (the hub's placement picks the top eligible one
// for the repo) or an explicit builder.
//
// Transport:
//   hub        confirmAction (tier ask) -> POST /api/fleet/actions
//              {action:'launch', builder:null|id, target:<lane>, args}; the
//              job is followed through GET /api/fleet/:builder/v1/jobs/:id
//   v1 builder confirmAction -> act(lane, 'launch', args); GET /api/v1/jobs/:id
//   legacy     the form submit posts /api/lanes as before; GET /api/jobs/:id
//
// Validation errors (a taken id, no free slot, a plan that is not pushed)
// come back as the server's own sentence, shown as text. Hello fields come
// from builders (untrusted): repo names and modes are filtered to their
// patterns and reach the page as option text/values only.
import { $ as byId, el } from '../core/dom.js';
import { act as pageAct, hubAct as pageHubAct, tierOf } from '../core/actions.js';
import { fkey } from '../core/keys.js';
import { store } from '../core/store.js';
import { confirmAction as pageConfirm } from './confirm.js';

// ---------------------------------------------------------------- model

/** launch.mjs patterns (lane: builtin-actions LANE_RE). */
export const LAUNCH_LANE_RX = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const REPO_RX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;
const BRANCH_RX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/;
const PLAN_RX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}\.md$/;
const MODEL_RX = /^[A-Za-z0-9._[\]-]{1,40}$/;
const MODE_RX = /^[A-Za-z]{1,32}$/;
export const LAUNCH_PRIORITIES = Object.freeze(['low', 'normal', 'high']);
export const LAUNCH_MAX_BUDGET_USD = 100000;
/** builtin-actions DEFAULT_PERMISSION_MODES: the fallback before any hello. */
export const FALLBACK_PERMISSION_MODES = Object.freeze(['default', 'acceptEdits', 'plan', 'auto']);
export const AUTO_BUILDER = 'auto';

const strList = (v, re, max) => (Array.isArray(v)
  ? [...new Set(v.filter((x) => typeof x === 'string' && re.test(x) && !x.includes('..')))].slice(0, max)
  : []);

/** A hello body, reduced to what the form reads (untrusted input). */
export function launchHello(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    capabilities: strList(raw.capabilities, /^[a-z][a-z0-9:-]{0,40}$/, 64),
    repos: strList(raw.repos, REPO_RX, 200),
    permissionModes: strList(raw.permissionModes, MODE_RX, 16),
    authKind: typeof raw.auth?.kind === 'string' ? raw.auth.kind : null,
  };
}

/**
 * What the form offers. `hub`: on a hub; `hellos`: Map builder id -> launchHello
 * (hub), `localHello` (builder); `builderIds`: the builders the hub knows;
 * `chosen`: the builder select ('auto' or an id). Pure.
 * -> {hub, legacy, direct, builders:['auto', ...ids], chosen, repos, permissionModes, defaultMode}
 */
export function launchFormModel({ hub = false, hellos = new Map(), localHello = null, builderIds = [], chosen = AUTO_BUILDER } = {}) {
  let pool;
  let builders = [];
  if (hub) {
    const eligible = builderIds.filter((id) => {
      const h = hellos.get(id);
      return !h || h.capabilities.length === 0 || h.capabilities.includes('launch');
    }).sort();
    builders = [AUTO_BUILDER, ...eligible];
    if (!builders.includes(chosen)) chosen = AUTO_BUILDER;
    pool = (chosen === AUTO_BUILDER ? eligible : [chosen]).map((id) => hellos.get(id)).filter(Boolean);
  } else {
    chosen = null;
    pool = localHello ? [localHello] : [];
  }
  const repos = [...new Set(pool.flatMap((h) => h.repos))].sort();
  let permissionModes = [...new Set(pool.flatMap((h) => h.permissionModes))];
  if (!permissionModes.length) permissionModes = [...FALLBACK_PERMISSION_MODES];
  const defaultMode = permissionModes.includes('auto') ? 'auto' : permissionModes[0];
  const direct = hub || localHello?.authKind === 'direct';
  const legacy = !hub && !(localHello?.capabilities.includes('actions'));
  return { hub, legacy, direct, builders, chosen, repos, permissionModes, defaultMode };
}

/**
 * The form values -> {ok:true, lane, builder, args} or {ok:false, error}.
 * Empty optional fields are left out, so the server's defaults apply. Priority
 * and budget only for a direct user. Pure.
 */
export function launchArgs(f = {}, model = launchFormModel()) {
  const t = (v) => (typeof v === 'string' ? v.trim() : '');
  const lane = t(f.lane);
  if (!LAUNCH_LANE_RX.test(lane)) return { ok: false, error: 'lane id: 1-40 of a-z 0-9 . _ - (starting with a letter or digit)' };
  const args = {};
  let repo = t(f.repo);
  if (!repo && !model.legacy && model.repos.length === 1) repo = model.repos[0];
  if (repo) {
    if (!REPO_RX.test(repo) || repo.includes('..')) return { ok: false, error: 'repo: not a repo name' };
    if (!model.legacy && model.repos.length && !model.repos.includes(repo)) {
      return { ok: false, error: `repo ${repo} is not on ${model.hub && model.chosen !== AUTO_BUILDER ? model.chosen : 'any launch builder'}` };
    }
    args.repo = repo;
  } else if (!model.legacy) {
    return { ok: false, error: 'repo: required' };
  }
  const branch = t(f.branch);
  if (branch) {
    if (!BRANCH_RX.test(branch) || branch.includes('..')) return { ok: false, error: 'branch: not a branch name' };
    args.branch = branch;
  }
  const plan = t(f.plan) || `docs/plans/${lane}.md`;
  if (!PLAN_RX.test(plan) || plan.includes('..')) return { ok: false, error: 'plan: a repo-relative path ending in .md' };
  args.plan = plan;
  const mdl = t(f.model) || 'opus';
  if (!MODEL_RX.test(mdl)) return { ok: false, error: 'model: not a model name' };
  args.model = mdl;
  const mode = t(f.permissionMode);
  if (mode) {
    if (!model.permissionModes.includes(mode)) return { ok: false, error: `permission mode ${mode.slice(0, 32)} is not offered` };
    if (!model.legacy || mode !== 'auto') args.permissionMode = mode;
  }
  if (model.direct) {
    const pr = t(f.priority);
    if (pr) {
      if (!LAUNCH_PRIORITIES.includes(pr)) return { ok: false, error: 'priority: low, normal or high' };
      args.priority = pr;
    }
    const b = t(f.budgetUsd);
    if (b) {
      const usd = Number(b);
      if (!Number.isFinite(usd) || usd <= 0 || usd > LAUNCH_MAX_BUDGET_USD) return { ok: false, error: `budget: dollars above 0, at most ${LAUNCH_MAX_BUDGET_USD}` };
      args.budgetUsd = Math.round(usd * 100) / 100;
    }
  }
  const builder = model.hub && model.chosen && model.chosen !== AUTO_BUILDER ? model.chosen : null;
  return { ok: true, lane, builder, args };
}

/** The confirm dialog's lines for a launch. */
export function launchLines(v) {
  const a = v.args;
  const lines = [
    `${v.builder ? `on ${v.builder}` : 'on the builder the hub places it on'}: repo ${a.repo ?? '(default)'}, branch ${a.branch ?? `feat/${v.lane}`}`,
    `plan ${a.plan}, model ${a.model}${a.permissionMode ? `, mode ${a.permissionMode}` : ''}`,
  ];
  if (a.priority || a.budgetUsd != null) lines.push(`priority ${a.priority ?? 'normal'}${a.budgetUsd != null ? `, budget $${a.budgetUsd}` : ''}`);
  return lines;
}

/** Where a launch job's steps are read. */
export function launchJobUrl(job, { hub = false, legacy = false, builder = null } = {}) {
  const j = encodeURIComponent(job);
  if (hub) return builder ? `/api/fleet/${encodeURIComponent(builder)}/v1/jobs/${j}` : null;
  return legacy ? `/api/jobs/${j}` : `/api/v1/jobs/${j}`;
}

// ---------------------------------------------------------------- page state

let launchPoll = null;
const launchCtx = { hellos: new Map(), localHello: null, loaded: false };

function launchFetchJson(url) {
  return fetch(url, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Load the hellos the form reads (once per open). */
async function loadLaunchHellos() {
  const hub = store.source?.kind === 'hub';
  if (hub) {
    const ids = [...(store.builders?.keys?.() ?? [])].slice(0, 32);
    const got = await Promise.all(ids.map((id) => launchFetchJson(`/api/fleet/${encodeURIComponent(id)}/v1/hello`)));
    launchCtx.hellos = new Map();
    ids.forEach((id, i) => { const h = launchHello(got[i]); if (h) launchCtx.hellos.set(id, h); });
  } else {
    launchCtx.localHello = launchHello(await launchFetchJson('/api/v1/hello'));
  }
  launchCtx.loaded = true;
}

function currentLaunchModel() {
  const hub = store.source?.kind === 'hub';
  return launchFormModel({
    hub,
    hellos: launchCtx.hellos,
    localHello: launchCtx.localHello,
    builderIds: hub ? [...(store.builders?.keys?.() ?? [])] : [],
    chosen: byId('lf-builder')?.value || AUTO_BUILDER,
  });
}

function launchField(label, node) {
  const l = el('label', 'lf-extra');
  l.append(`${label} `, node);
  return l;
}

/** Add the fleet fields to the static form once (builder, mode, priority, budget). */
function ensureLaunchFields() {
  if (byId('lf-builder')) return;
  const form = byId('launch-form');
  const submit = byId('lf-submit');
  if (!form) return;
  const builder = document.createElement('select');
  builder.id = 'lf-builder';
  builder.onchange = () => fillLaunchOptions();
  const perm = document.createElement('select');
  perm.id = 'lf-perm';
  const prio = document.createElement('select');
  prio.id = 'lf-priority';
  for (const v of ['', ...LAUNCH_PRIORITIES]) {
    const o = el('option', null, v || 'normal (default)');
    o.value = v;
    prio.append(o);
  }
  const budget = document.createElement('input');
  budget.id = 'lf-budget';
  budget.type = 'number';
  budget.min = '0';
  budget.step = '0.01';
  budget.placeholder = 'usd (optional)';
  const repos = document.createElement('datalist');
  repos.id = 'lf-repos';
  byId('lf-repo')?.setAttribute('list', 'lf-repos');
  const note = el('p', 'empty');
  note.id = 'lf-note';
  const rows = [
    launchField('builder', builder), launchField('permission mode', perm),
    launchField('priority', prio), launchField('budget', budget), repos, note,
  ];
  rows[0].id = 'lf-builder-row';
  rows[2].id = 'lf-priority-row';
  rows[3].id = 'lf-budget-row';
  for (const r of rows) {
    if (submit && submit.parentNode === form) form.insertBefore(r, submit);
    else form.append(r);
  }
}

function fillSelect(sel, values, selected, label = (v) => v) {
  if (!sel) return;
  const keep = sel.value;
  sel.textContent = '';
  for (const v of values) {
    const o = el('option', null, label(v));
    o.value = v;
    sel.append(o);
  }
  sel.value = values.includes(keep) ? keep : selected;
}

/** Refill builder / repo / mode options from the hellos. */
function fillLaunchOptions() {
  const m = currentLaunchModel();
  const bRow = byId('lf-builder-row');
  if (bRow) bRow.hidden = !m.hub;
  fillSelect(byId('lf-builder'), m.builders, AUTO_BUILDER, (v) => (v === AUTO_BUILDER ? 'auto (hub placement)' : v));
  fillSelect(byId('lf-perm'), m.permissionModes, m.defaultMode);
  const list = byId('lf-repos');
  if (list) {
    list.textContent = '';
    for (const r of m.repos) { const o = el('option'); o.value = r; list.append(o); }
  }
  for (const id of ['lf-priority-row', 'lf-budget-row']) { const r = byId(id); if (r) r.hidden = !m.direct; }
  const note = byId('lf-note');
  if (note) {
    note.textContent = m.hub
      ? (m.chosen === AUTO_BUILDER ? 'auto: the hub picks the top-ranked builder for the repo.' : `Launches on ${m.chosen}.`)
      : (m.direct ? '' : 'Priority and budget need a direct user (the board through serve).');
  }
}

export function openLaunch() {
  byId('launch-sheet').hidden = false;
  byId('lf-steps').textContent = '';
  byId('lf-submit').disabled = false;
  ensureLaunchFields();
  fillLaunchOptions();
  loadLaunchHellos().then(fillLaunchOptions).catch(() => {});
  byId('lf-lane').focus();
}

export function closeLaunch() {
  byId('launch-sheet').hidden = true;
  clearTimeout(launchPoll);
  launchPoll = null;
}

function launchStep(text, cls) {
  const li = el('li', cls || null, text);
  byId('lf-steps').append(li);
  return li;
}

function readLaunchFields() {
  const v = (id) => byId(id)?.value;
  return {
    lane: v('lf-lane'), repo: v('lf-repo'), branch: v('lf-branch'), plan: v('lf-plan'), model: v('lf-model'),
    permissionMode: v('lf-perm'), priority: v('lf-priority'), budgetUsd: v('lf-budget'),
  };
}

/**
 * Send a checked launch through the confirm (tier ask) and act()/hubAct().
 * `deps`: {confirmAction, act, hubAct}. Resolves {ok, cancelled?, r, job, builder}.
 */
export async function sendLaunch(v, model, deps = {}) {
  const target = model.hub && v.builder ? fkey(v.builder, v.lane) : v.lane;
  const ans = await (deps.confirmAction ?? pageConfirm)({
    action: 'launch', targets: [target], tier: tierOf('launch'), consequence: launchLines(v), builder: v.builder,
  });
  if (!ans?.ok) return { ok: false, cancelled: true };
  const r = model.hub
    ? await (deps.hubAct ?? pageHubAct)({ builder: v.builder, action: 'launch', target: v.lane, args: v.args })
    : await (deps.act ?? pageAct)(v.lane, 'launch', v.args);
  const inner = r?.result && typeof r.result === 'object' && r.result.result && typeof r.result.result === 'object' ? r.result.result : r?.result ?? {};
  const builder = typeof r?.builder === 'string' ? r.builder : v.builder;
  return { ok: r?.ok === true, r, res: inner, job: typeof inner.job === 'string' ? inner.job : null, builder };
}

export async function submitLaunch(e) {
  e?.preventDefault?.();
  const model = currentLaunchModel();
  const v = launchArgs(readLaunchFields(), model);
  byId('lf-steps').textContent = '';
  if (!v.ok) {
    launchStep(`refused: ${v.error}`, 'bad');
    return;
  }
  byId('lf-submit').disabled = true;
  if (!model.legacy) {
    const out = await sendLaunch(v, model);
    if (out.cancelled) {
      launchStep('cancelled: nothing was sent', 'dim');
      byId('lf-submit').disabled = false;
      return;
    }
    if (!out.ok) {
      launchStep(out.r?.ok === 'unknown' ? 'sent, outcome unknown' : `refused: ${out.r?.error ?? 'error'}`, 'bad');
      byId('lf-submit').disabled = false;
      return;
    }
    const placed = out.r?.placedBy === 'hub' ? ' (placed by the hub)' : '';
    launchStep(`${out.res.lane ?? v.lane}${out.builder ? ` on ${out.builder}` : ''} slot ${out.res.slot ?? '?'} — job ${out.job ?? '?'}${placed}`, 'dim');
    const url = out.job ? launchJobUrl(out.job, { hub: model.hub, builder: out.builder }) : null;
    if (url) followLaunch(out.job, new Set(), url);
    else byId('lf-submit').disabled = false;
    return;
  }
  const body = { lane: v.lane, ...v.args };
  let res;
  try {
    const r = await fetch('/api/lanes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-laneboard': '1' }, body: JSON.stringify(body) });
    res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || `HTTP ${r.status}`);
  } catch (err) {
    launchStep(`refused: ${err.message}`, 'bad');
    byId('lf-submit').disabled = false;
    return;
  }
  launchStep(`${res.lane} on slot ${res.slot} — job ${res.job}`, 'dim');
  followLaunch(res.job, new Set());
}

export async function followLaunch(job, seen, url = launchJobUrl(job, { legacy: true })) {
  let data = null;
  try {
    const r = await fetch(url);
    if (r.ok) data = await r.json();
  } catch { /* a restart mid-launch: keep polling */ }
  for (const st of data?.steps ?? []) {
    if (seen.has(st.id)) continue;
    seen.add(st.id);
    const why = st.detail?.error || st.detail?.warning || '';
    launchStep(`${st.ok === false ? '✗' : '✓'} ${st.step}${why ? ` — ${why}` : ''}`, st.ok === false ? 'bad' : 'ok');
    if (['done', 'failed', 'interrupted'].includes(st.step)) {
      byId('lf-submit').disabled = false;
      return;
    }
  }
  if (byId('launch-sheet').hidden) return;
  launchPoll = setTimeout(() => followLaunch(job, seen, url), 1500);
}
