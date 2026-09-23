// Web Push. VAPID keys are generated on first run and kept in SQLite.
//
// The rules (plan §2.6):
//   * notify on every transition into waiting_permission / waiting_question;
//   * notify on `done` only if the session had been working for >= 5 min;
//   * at most one notification per session per 60 s;
//   * a per-session quiet toggle and a global one.
import webpush from 'web-push';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { kvRead, kvWrite, listSubscriptions, removeSubscription, markSubscriptionOk } from './db.mjs';

const COALESCE_MS = 60_000;
const MIN_WORKING_MS = 5 * 60_000;

let vapid = null;

export function ensureVapid() {
  if (vapid) return vapid;
  vapid = kvRead('push.vapid');
  if (!vapid?.publicKey || !vapid?.privateKey) {
    vapid = webpush.generateVAPIDKeys();
    kvWrite('push.vapid', vapid);
    log.info('generated a new VAPID key pair');
  }
  webpush.setVapidDetails(`${new URL(config.publicUrl).origin}/`, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export function publicKey() {
  return ensureVapid().publicKey;
}

// --- quiet toggles ----------------------------------------------------------

export function getQuiet() {
  return kvRead('push.quiet', { global: false, sessions: [] }) || { global: false, sessions: [] };
}

export function setQuiet({ global, session, quiet }) {
  const cur = getQuiet();
  if (typeof global === 'boolean') cur.global = global;
  if (session) {
    const set = new Set(cur.sessions);
    if (quiet) set.add(session);
    else set.delete(session);
    cur.sessions = [...set];
  }
  kvWrite('push.quiet', cur);
  return cur;
}

export function isQuiet(name) {
  const q = getQuiet();
  return q.global || q.sessions.includes(name);
}

// --- rules ------------------------------------------------------------------

const lastSentAt = new Map(); // session name -> ms

/**
 * Decide whether a state transition deserves a notification.
 * Pure apart from the coalescing clock, so it is testable.
 */
export function shouldNotify({ name, from, to, workingForMs = 0, lastAt = null, now = Date.now(), quiet = false }) {
  if (quiet) return { notify: false, reason: 'quiet' };
  if (from === to) return { notify: false, reason: 'no transition' };

  let wanted = false;
  let title = null;
  if (to === 'waiting_permission') { wanted = true; title = 'Needs permission'; }
  else if (to === 'waiting_question') { wanted = true; title = 'Needs an answer'; }
  else if (to === 'done') {
    if (workingForMs >= MIN_WORKING_MS) { wanted = true; title = 'Finished'; }
    else return { notify: false, reason: 'finished too quickly' };
  }
  if (!wanted) return { notify: false, reason: 'state not notifiable' };

  if (lastAt != null && now - lastAt < COALESCE_MS) return { notify: false, reason: 'coalesced' };
  return { notify: true, title, reason: 'ok' };
}

// --- sending ----------------------------------------------------------------

export async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification(sub.sub ?? sub, JSON.stringify(payload), { TTL: 300 });
    markSubscriptionOk(sub.endpoint ?? sub.sub?.endpoint);
    return { ok: true };
  } catch (err) {
    const code = err?.statusCode;
    // 404/410 mean the browser dropped the subscription; stop retrying it.
    if (code === 404 || code === 410) {
      removeSubscription(sub.endpoint ?? sub.sub?.endpoint);
      log.info(`dropped an expired push subscription (${code})`);
      return { ok: false, gone: true };
    }
    log.warn(`push failed (${code ?? 'no status'}): ${err?.body || err?.message || err}`);
    return { ok: false };
  }
}

export async function broadcast(payload) {
  ensureVapid();
  const subs = listSubscriptions();
  if (!subs.length) return { sent: 0, subscribers: 0 };
  const results = await Promise.all(subs.map((s) => sendTo(s, payload)));
  return { sent: results.filter((r) => r.ok).length, subscribers: subs.length };
}

/** Called by state on every transition. Applies the rules, then sends. */
export async function onTransition({ name, from, to, stateSince, activity }) {
  const now = Date.now();
  const verdict = shouldNotify({
    name,
    from,
    to,
    workingForMs: from === 'working' ? now - (stateSince ?? now) : 0,
    lastAt: lastSentAt.get(name) ?? null,
    now,
    quiet: isQuiet(name),
  });
  if (!verdict.notify) return verdict;

  lastSentAt.set(name, now);
  const body = activity?.toolInput
    ? `${activity.tool ?? ''} ${activity.toolInput}`.trim()
    : (activity?.lastAssistant || '').slice(0, 140) || name;
  const r = await broadcast({
    title: `${verdict.title}: ${name}`,
    body,
    tag: `laneboard-${name}`,
    url: `/#session=${encodeURIComponent(name)}`,
    session: name,
    state: to,
  });
  log.info(`push "${verdict.title}" for ${name} -> ${r.sent}/${r.subscribers}`);
  return { ...verdict, ...r };
}

/**
 * A lane shouting for a human. Shares `lastSentAt` with onTransition on
 * purpose: the plan asks for "the same coalescing rules as waiting_permission",
 * and a session that goes waiting_permission AND prints NEED-HUMAN in the same
 * breath should buzz the phone once, not twice.
 */
export async function onMarker({ session_name: name, kind, text }) {
  if (!name) return { notify: false, reason: 'no session' };
  if (isQuiet(name)) return { notify: false, reason: 'quiet' };
  const now = Date.now();
  const lastAt = lastSentAt.get(name) ?? null;
  if (lastAt != null && now - lastAt < COALESCE_MS) return { notify: false, reason: 'coalesced' };
  lastSentAt.set(name, now);
  const title = kind === 'blocked' ? 'Blocked' : kind === 'limit' ? 'Hit a limit' : 'Needs you';
  const r = await broadcast({
    title: `${title}: ${name}`,
    body: String(text).slice(0, 140),
    tag: `laneboard-${name}`,
    url: `/#session=${encodeURIComponent(name)}`,
    session: name,
    state: kind,
  });
  log.info(`push "${title}" for ${name} -> ${r.sent}/${r.subscribers}`);
  return { notify: true, ...r };
}

/**
 * v3: a `danger` marker (the dev-stack guard). Pushed at once: not coalesced
 * with anything, and not silenced by a quiet toggle, because it is about data
 * other people are using, not about this session's own progress.
 */
export async function onDanger({ session_name: name, sessionName, text }) {
  const who = name ?? sessionName ?? null;
  const r = await broadcast({
    title: `DANGER: ${who || 'dev stack guard'}`,
    body: String(text).slice(0, 160),
    tag: `laneboard-danger-${who || 'guard'}-${Date.now()}`,
    url: who ? `/#session=${encodeURIComponent(who)}` : '/#box',
    session: who,
    state: 'danger',
  });
  log.warn(`push "DANGER" for ${who || 'guard'} -> ${r.sent}/${r.subscribers}`);
  return { notify: true, ...r };
}

export function resetCoalescing() {
  lastSentAt.clear();
}
