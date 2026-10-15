// Notification prefs sheet (fleet plan §4 task D14; data shapes §7.3.6 O9).
//
// Hub only. A dialog bound to GET/POST /api/notify/prefs:
//   {kinds:{[kind]:bool}, quietHours:null|{from:'HH:MM', to:'HH:MM'}, mutedTargets:[fkey]}
// with per-kind toggles, quiet hours from/to, per-session mute and the Web
// Push subscription (subscribe goes through the existing push button in
// ui/push.js; unsubscribe is DELETE /api/push/subscribe + the browser's own
// unsubscribe). Builder mode never mounts it: the builder keeps its existing
// push UI and quiet toggle.
//
// Entry points: the "Notification settings" button this module adds to the
// Notifications block (#push-box) once the source is a hub, and the palette's
// `ACT notifications` (COMMAND, registered with core/commands.js by init(),
// shown only while the source is a hub).
//
// Pure at import time: the model functions below are tested in
// test/notify-prefs.test.mjs; DOM code runs only from init()/openPrefs().
// Builder-provided text (session names, fkeys) reaches the DOM only via
// textContent / setAttribute. Every POST goes through net.js post()
// (X-Laneboard: 1); the server re-validates every body (O9 checkPrefs).
import { register as registerCommand } from '../core/commands.js';
import { el } from '../core/dom.js';
import { isFkey, parseFkey } from '../core/keys.js';
import { post } from '../core/net.js';
import { store, subscribe } from '../core/store.js';
import { toast } from './toast.js';

export const PREFS_PATH = '/api/notify/prefs';
export const SUBSCRIBE_PATH = '/api/push/subscribe';

/** Copy of server/config/observability.mjs ALARM_KINDS (a test keeps them equal). */
export const ALARM_KINDS = Object.freeze([
  'danger', 'builder-down', 'budget-exceeded', 'audit-fork',
  'approval', 'needs-input', 'blocked', 'failed', 'stuck', 'health-crit', 'ci-red-main',
  'builder-stale', 'health-warn', 'ci-red', 'conflict', 'review-overdue',
  'review', 'budget-warn', 'reboot',
]);
/** Copy of NOTIFY_DEFAULT_KINDS (the kinds on when nothing is stored). */
export const DEFAULT_KINDS = Object.freeze([
  'needs-input', 'approval', 'failed', 'review', 'stuck', 'builder-down', 'danger',
]);
/** Kinds sent even inside quiet hours (O9 DEFAULT_BYPASS). */
export const QUIET_BYPASS = Object.freeze(['danger', 'builder-down']);

export const KIND_LABELS = Object.freeze({
  'danger': 'Dangerous command',
  'builder-down': 'Builder down',
  'budget-exceeded': 'Budget exceeded',
  'audit-fork': 'Audit log fork',
  'approval': 'Approval waiting',
  'needs-input': 'Needs input',
  'blocked': 'Blocked',
  'failed': 'Failed',
  'stuck': 'Stuck',
  'health-crit': 'Machine health critical',
  'ci-red-main': 'CI red on main',
  'builder-stale': 'Builder stale',
  'health-warn': 'Machine health warning',
  'ci-red': 'CI red on a lane',
  'conflict': 'Lane conflict',
  'review-overdue': 'Review overdue',
  'review': 'Ready for review',
  'budget-warn': 'Budget warning',
  'reboot': 'Reboot required',
});

export const QUIET_RX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MUTED_MAX = 500;
export const FKEY_MAX = 225;
/** Most session rows the sheet lists (muted ones always show). */
export const SESSION_ROWS_MAX = 200;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.hasOwn(o, k);
const okKey = (k) => typeof k === 'string' && k.length <= FKEY_MAX && isFkey(k);

/** A valid quiet-hours value ({from,to} distinct HH:MM) or null. */
export function normQuiet(q) {
  if (!isObj(q) || typeof q.from !== 'string' || typeof q.to !== 'string') return null;
  if (!QUIET_RX.test(q.from) || !QUIET_RX.test(q.to) || q.from === q.to) return null;
  return { from: q.from, to: q.to };
}

/**
 * The sheet's view model from the wire prefs. `kinds` is the list to show
 * (default ALARM_KINDS); a kind missing or non-boolean in prefs takes its
 * default. -> {kinds:[{kind,label,on,bypass}], quiet:{on,from,to}, muted:[fkey]}
 */
export function prefsModel(prefs, kinds = ALARM_KINDS) {
  const src = isObj(prefs) ? prefs : {};
  // own members only: an inherited `kinds` never counts as a stored value
  const p = { kinds: own(src, 'kinds') ? src.kinds : null, quietHours: own(src, 'quietHours') ? src.quietHours : null, mutedTargets: own(src, 'mutedTargets') ? src.mutedTargets : null };
  const list = Array.isArray(kinds) ? kinds.filter((k) => typeof k === 'string' && ALARM_KINDS.includes(k)) : [...ALARM_KINDS];
  const rows = [...new Set(list)].map((kind) => ({
    kind,
    label: KIND_LABELS[kind] ?? kind,
    on: own(p.kinds, kind) && typeof p.kinds[kind] === 'boolean' ? p.kinds[kind] : DEFAULT_KINDS.includes(kind),
    bypass: QUIET_BYPASS.includes(kind),
  }));
  const q = normQuiet(p.quietHours);
  const muted = Array.isArray(p.mutedTargets) ? [...new Set(p.mutedTargets.filter(okKey))].slice(0, MUTED_MAX) : [];
  return {
    kinds: rows,
    quiet: q ? { on: true, from: q.from, to: q.to } : { on: false, from: '23:00', to: '07:30' },
    muted,
  };
}

/** POST body for one kind toggle. */
export function kindBody(kind, on) {
  if (!ALARM_KINDS.includes(kind)) return { ok: false, error: `unknown kind ${String(kind).slice(0, 40)}` };
  return { ok: true, body: { kinds: { [kind]: on === true } } };
}

/** POST body for quiet hours; off -> null. -> {ok, body} | {ok:false, error} */
export function quietBody(on, from, to) {
  if (!on) return { ok: true, body: { quietHours: null } };
  const q = normQuiet({ from, to });
  if (!q) return { ok: false, error: 'Quiet hours need two different times as HH:MM' };
  return { ok: true, body: { quietHours: q } };
}

/** POST body muting (or unmuting) one fkey, given the current muted list. */
export function muteBody(muted, k, on) {
  if (!okKey(k)) return { ok: false, error: 'not a session key' };
  const cur = Array.isArray(muted) ? muted.filter(okKey) : [];
  const next = on ? [...new Set([...cur, k])] : cur.filter((x) => x !== k);
  if (next.length > MUTED_MAX) return { ok: false, error: `At most ${MUTED_MAX} muted sessions` };
  return { ok: true, body: { mutedTargets: next } };
}

/**
 * Session rows for the mute list: every known fkey (sorted) plus muted fkeys
 * that are not live any more. -> [{fkey, builder, name, muted, live}]
 */
export function sessionRows(keys, muted, max = SESSION_ROWS_MAX) {
  const m = new Set(Array.isArray(muted) ? muted.filter(okKey) : []);
  const live = new Set();
  for (const k of keys ?? []) if (okKey(k)) live.add(k);
  const all = [...new Set([...m, ...live])].sort();
  const rows = all.map((k) => {
    const p = parseFkey(k);
    return { fkey: k, builder: p.builder, name: p.name, muted: m.has(k), live: live.has(k) };
  });
  const keep = rows.filter((r) => r.muted);
  const rest = rows.filter((r) => !r.muted).slice(0, Math.max(0, max - keep.length));
  return [...keep, ...rest].sort((a, b) => (a.fkey < b.fkey ? -1 : a.fkey > b.fkey ? 1 : 0));
}

/**
 * The push row: {label, action:'subscribe'|'unsubscribe'|null, note}.
 * env {supported, secure, subscribed, permission}.
 */
export function pushModel(env = {}) {
  if (!env.supported) return { label: 'Push unavailable', action: null, note: 'This browser has no Web Push support.' };
  if (!env.secure) return { label: 'Push needs HTTPS', action: null, note: 'Open the hub over HTTPS and add it to the Home Screen.' };
  if (env.subscribed) return { label: 'Turn off push on this device', action: 'unsubscribe', note: 'This device receives notifications.' };
  if (env.permission === 'denied') return { label: 'Push blocked', action: null, note: 'Blocked in the browser settings.' };
  return { label: 'Turn on push on this device', action: 'subscribe', note: 'This device does not receive notifications.' };
}

/** Whether the sheet applies: hub sources only. */
export function isHub(s = null) {
  return (s ?? store)?.source?.kind === 'hub';
}

/** POST a body to the prefs route through net.js; -> wire prefs or null. */
export async function savePrefs(body, postFn = null) {
  const r = await (postFn ?? post)(PREFS_PATH, body);
  return isObj(r) && isObj(r.kinds) ? r : null;
}

/** GET the prefs; -> wire prefs or null. */
export async function loadPrefs(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(PREFS_PATH, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return isObj(j) ? j : null;
  } catch {
    return null;
  }
}

/** Drop this device's push subscription (server first, then the browser). */
export async function unsubscribePush(sub, fetchFn = globalThis.fetch) {
  if (!sub || typeof sub.endpoint !== 'string') return false;
  try {
    const r = await fetchFn(SUBSCRIBE_PATH, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-laneboard': '1' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (err) {
    toast(`Failed: ${err.message}`);
    return false;
  }
  try { await sub.unsubscribe(); } catch { /* the server side is gone already */ }
  return true;
}

// ---------------------------------------------------------------- DOM (runtime only)

let dlg = null;
let state = null; // wire prefs as last seen

async function pushEnv() {
  const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window;
  const secure = typeof isSecureContext !== 'undefined' ? isSecureContext : false;
  let sub = null;
  if (supported && secure) {
    try { sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription(); } catch { sub = null; }
  }
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  return { supported, secure, subscribed: !!sub, permission, sub };
}

function section(title) {
  const box = el('section', 'np-sec');
  box.appendChild(el('h3', 'rail-h', title));
  return box;
}

function checkRow(label, checked, onChange, { hint = null, name = null } = {}) {
  const lab = el('label', 'np-row');
  lab.style.display = 'flex';
  lab.style.gap = '8px';
  lab.style.alignItems = 'center';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  if (name) box.name = name;
  box.addEventListener('change', () => onChange(box.checked, box));
  lab.append(box, el('span', null, label));
  if (hint) lab.appendChild(el('span', 'empty', hint));
  return lab;
}

async function apply(body) {
  const r = await savePrefs(body);
  if (r) state = r;
  renderPrefsSheet();
  return !!r;
}

async function renderPrefsSheet() {
  if (!dlg) return;
  const body = dlg.querySelector('.cfm-d');
  const m = prefsModel(state);
  const parts = [];

  // Push on this device.
  const env = await pushEnv();
  const pm = pushModel(env);
  const pushSec = section('This device');
  const pbtn = el('button', 'btn', pm.label);
  pbtn.type = 'button';
  pbtn.disabled = !pm.action;
  pbtn.addEventListener('click', async () => {
    if (pm.action === 'subscribe') {
      // The existing push UI owns permission + subscribe (ui/push.js).
      const b = document.getElementById('btn-push');
      if (b) b.click();
      else toast('Push button not found');
      setTimeout(renderPrefsSheet, 1500);
    } else if (pm.action === 'unsubscribe') {
      if (await unsubscribePush(env.sub)) toast('Push turned off on this device');
      renderPrefsSheet();
    }
  });
  pushSec.append(pbtn, el('p', 'empty', pm.note));
  parts.push(pushSec);

  // Kinds.
  const kindSec = section('Alarm kinds');
  for (const r of m.kinds) {
    kindSec.appendChild(checkRow(r.label, r.on, async (on, box) => {
      const b = kindBody(r.kind, on);
      if (!b.ok) { toast(b.error); box.checked = !on; return; }
      if (!(await apply(b.body))) box.checked = !on;
    }, { hint: r.bypass ? 'ignores quiet hours' : null, name: `kind-${r.kind}` }));
  }
  parts.push(kindSec);

  // Quiet hours.
  const qSec = section('Quiet hours');
  const from = document.createElement('input');
  const to = document.createElement('input');
  for (const [inp, v, lab] of [[from, m.quiet.from, 'from'], [to, m.quiet.to, 'to']]) {
    inp.type = 'time';
    inp.value = v;
    inp.setAttribute('aria-label', `Quiet hours ${lab}`);
    inp.disabled = !m.quiet.on;
  }
  const qOn = checkRow('Hold notifications between', m.quiet.on, (on) => {
    from.disabled = !on;
    to.disabled = !on;
    if (!on) apply({ quietHours: null });
  }, { name: 'quiet-on' });
  const qSave = el('button', 'btn', 'Save');
  qSave.type = 'button';
  qSave.addEventListener('click', () => {
    const b = quietBody(qOn.querySelector('input').checked, from.value, to.value);
    if (!b.ok) { toast(b.error); return; }
    apply(b.body);
  });
  const qRow = el('div', 'np-row');
  qRow.style.display = 'flex';
  qRow.style.gap = '8px';
  qRow.style.alignItems = 'center';
  qRow.append(from, el('span', null, '–'), to, qSave);
  qSec.append(qOn, qRow, el('p', 'empty', 'Held notifications are listed in Morning. Dangerous commands and builders going down are sent anyway.'));
  parts.push(qSec);

  // Per-session mute.
  const mSec = section('Muted sessions');
  const rows = sessionRows([...store.sessions.keys()], m.muted);
  if (!rows.length) mSec.appendChild(el('p', 'empty', 'No sessions yet.'));
  for (const r of rows) {
    const label = r.live ? r.fkey : `${r.fkey} (gone)`;
    mSec.appendChild(checkRow(label, r.muted, async (on, box) => {
      const b = muteBody(m.muted, r.fkey, on);
      if (!b.ok) { toast(b.error); box.checked = !on; return; }
      if (!(await apply(b.body))) box.checked = !on;
    }));
  }
  parts.push(mSec);

  body.replaceChildren(...parts);
}

/** Open the sheet (hub only). */
export async function openPrefs() {
  if (!isHub()) { toast('Notification settings live on the hub'); return; }
  if (dlg) return;
  dlg = document.createElement('dialog');
  dlg.className = 'cfm np';
  dlg.setAttribute('aria-labelledby', 'np-t');
  const head = el('h2', 'cfm-t', 'Notifications');
  head.id = 'np-t';
  const body = el('div', 'cfm-d', 'Loading…');
  body.style.maxHeight = '70vh';
  body.style.overflowY = 'auto';
  const row = el('div', 'cfm-b');
  const close = el('button', 'btn btn--primary', 'Done');
  close.type = 'button';
  row.appendChild(close);
  dlg.append(head, body, row);
  const finish = () => {
    if (!dlg) return;
    const d = dlg;
    dlg = null;
    if (d.open && typeof d.close === 'function') d.close();
    d.remove();
  };
  close.addEventListener('click', finish);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(); });
  dlg.addEventListener('close', finish);
  document.body.appendChild(dlg);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  state = await loadPrefs();
  if (!state) {
    body.textContent = 'Could not load the notification settings.';
    return;
  }
  renderPrefsSheet();
}

/** The palette entry `ACT notifications` (hub only). */
export const COMMAND = Object.freeze({
  id: 'notifications', title: 'Notifications', icon: 'bell', sub: 'kinds, quiet hours, muted sessions',
  when: () => isHub(), run: () => { openPrefs(); return true; },
});

let entry = null;

function mountEntry() {
  const want = isHub();
  if (want && !entry) {
    const box = document.getElementById('push-box');
    if (!box) return;
    entry = el('button', 'btn', 'Notification settings…');
    entry.type = 'button';
    entry.id = 'btn-notify-prefs';
    entry.addEventListener('click', () => openPrefs());
    box.appendChild(entry);
  } else if (!want && entry) {
    entry.remove();
    entry = null;
  }
}

/** Runtime wiring, called once by app.js boot(). */
export function init() {
  registerCommand({ ...COMMAND });
  mountEntry();
  subscribe(() => mountEntry());
}
