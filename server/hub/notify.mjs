// Hub notifications (fleet plan §7.3.6, O9): which alarm raises become a web
// push, quiet hours with a deferred digest for Morning, and the prefs.
//
// - Only a *raise* notifies (the alarms service's `raised` list, O8), never a
//   re-derivation: onRaised is fed from alarms.subscribe(), whose changes only
//   carry an alarm in `raised` when it was not live before.
// - shouldNotify(alarm, prefs, lastAt, now, tz) is the pure rule, in order:
//   unknown kind / kind toggled off -> no; target muted -> no; inside quiet
//   hours and the kind is not in quietBypass -> defer (to the digest);
//   another push for the same builder/target within 60 s -> coalesced (bypass
//   kinds are never coalesced: a `danger` must not hide behind a NEED push
//   for the same session, as today's push.onDanger).
// - On top of that, the service caps pushes at RATE_MAX per builder per
//   RATE_WINDOW_MS (S20): a builder that raises alarms for many distinct,
//   self-chosen targets cannot defeat coalescing. Over the cap the raise goes
//   to the digest (reason 'rate'). The cap applies to bypass kinds too.
// - Deferred raises live in kv `notify.deferred` (newest DEFERRED_MAX kept);
//   digest({since}) lists them for Morning (§10 R10, "while you were away").
// - Prefs: kv `notify.prefs` holds the user's overrides over config
//   `notify.*`; the wire shape is {kinds:{[kind]:bool}, quietHours,
//   mutedTargets:[fkey]} (GET/POST /api/notify/prefs, routes/notify.mjs).
// - Payload: {title:'<CODE> <kind>: <name>', body, tag:'lb-<alarm id>',
//   url:'#/inbox?sel=<encodeURIComponent(fkey)>'}. Every builder string is
//   stripped of control characters and length-capped (cleanText), and the
//   fkey is encoded as one component, so a hostile name cannot add
//   parameters or path segments to the deep link (S20).
//
// Sending is injected: `sender(payload) -> Promise<{sent, subscribers}>`.
// server/push.mjs imports the builder's config.mjs and db.mjs, so the hub
// never imports it; createWebPushSender below is a hub-safe equivalent of its
// sendTo/broadcast over injected subscriptions and VAPID keys.
//
// Hub-safe imports only: no server/config.mjs, db.mjs, state.mjs, push.mjs.
import { ALARM_KINDS, NOTIFY_DEFAULT_KINDS, QUIET_RX, quietMinutes } from '../config/observability.mjs';
import { cleanText } from '../fleet/alarms.mjs';
import { BUILDER_ID_RX, deriveCode, isFkey } from '../fleet/keys.mjs';

export const COALESCE_MS = 60_000;
export const RATE_MAX = 10;
export const RATE_WINDOW_MS = 10 * 60_000;
export const DEFERRED_MAX = 200;
export const KV_DEFERRED = 'notify.deferred';
export const KV_PREFS = 'notify.prefs';
export const NAME_MAX = 64;
export const TITLE_MAX = 100;
export const BODY_MAX = 160;
export const MUTED_MAX = 500;
export const FKEY_MAX = 225;
export const DEFAULT_BYPASS = Object.freeze(['danger', 'builder-down']);
const TRACK_MAX = 2000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPlain = (v) => isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const show = (v) => (JSON.stringify(v) ?? String(v)).slice(0, 60);

// --- prefs ---------------------------------------------------------------------

function defaultKinds() {
  return Object.fromEntries(ALARM_KINDS.map((k) => [k, NOTIFY_DEFAULT_KINDS.includes(k)]));
}

function validQuiet(q) {
  return q === null || (isObj(q) && typeof q.from === 'string' && typeof q.to === 'string'
    && QUIET_RX.test(q.from) && QUIET_RX.test(q.to) && q.from !== q.to);
}

/**
 * Effective prefs: config `notify` (cfg) overlaid with the stored overrides.
 * -> {kinds, quietHours, mutedTargets, quietBypass}
 */
export function effectivePrefs(cfg, stored) {
  const n = isObj(cfg) ? cfg : {};
  const s = isObj(stored) ? stored : {};
  const kinds = defaultKinds();
  for (const src of [n.kinds, s.kinds]) {
    if (!isObj(src)) continue;
    for (const k of ALARM_KINDS) if (typeof src[k] === 'boolean') kinds[k] = src[k];
  }
  let quietHours = validQuiet(n.quietHours ?? null) ? (n.quietHours ?? null) : null;
  if (Object.hasOwn(s, 'quietHours') && validQuiet(s.quietHours)) quietHours = s.quietHours;
  const mutedTargets = Array.isArray(s.mutedTargets) ? s.mutedTargets.filter((k) => typeof k === 'string' && isFkey(k)).slice(0, MUTED_MAX) : [];
  const quietBypass = Array.isArray(n.quietBypass) ? n.quietBypass.filter((k) => ALARM_KINDS.includes(k)) : [...DEFAULT_BYPASS];
  return {
    kinds,
    quietHours: quietHours ? { from: quietHours.from, to: quietHours.to } : null,
    mutedTargets,
    quietBypass,
  };
}

/** The wire shape (GET/POST /api/notify/prefs). */
export function wirePrefs(p) {
  return { kinds: { ...p.kinds }, quietHours: p.quietHours ? { ...p.quietHours } : null, mutedTargets: [...p.mutedTargets] };
}

/**
 * Validate a POST body: any of {kinds:{[kind]:bool}, quietHours:null|{from,to},
 * mutedTargets:[fkey]}. Unknown keys (including `__proto__`) are refused.
 * -> {ok:true, patch} | {ok:false, error}
 */
export function checkPrefs(body) {
  if (!isPlain(body)) return { ok: false, error: 'body must be a JSON object' };
  const patch = {};
  for (const key of Object.keys(body)) {
    if (key !== 'kinds' && key !== 'quietHours' && key !== 'mutedTargets') return { ok: false, error: `unknown key ${show(key)}` };
  }
  if (Object.hasOwn(body, 'kinds')) {
    const k = body.kinds;
    if (!isPlain(k)) return { ok: false, error: 'kinds must be an object' };
    patch.kinds = {};
    for (const [kind, on] of Object.entries(k)) {
      if (!ALARM_KINDS.includes(kind)) return { ok: false, error: `unknown kind ${show(kind)}` };
      if (typeof on !== 'boolean') return { ok: false, error: `kinds.${kind} must be true or false` };
      patch.kinds[kind] = on;
    }
  }
  if (Object.hasOwn(body, 'quietHours')) {
    const q = body.quietHours;
    if (q !== null) {
      if (!isPlain(q) || Object.keys(q).some((f) => f !== 'from' && f !== 'to')) return { ok: false, error: 'quietHours must be null or {from, to}' };
      if (!validQuiet(q)) return { ok: false, error: 'quietHours.from and .to must be distinct HH:MM times' };
    }
    patch.quietHours = q === null ? null : { from: q.from, to: q.to };
  }
  if (Object.hasOwn(body, 'mutedTargets')) {
    const m = body.mutedTargets;
    if (!Array.isArray(m)) return { ok: false, error: 'mutedTargets must be a list of fleet keys' };
    if (m.length > MUTED_MAX) return { ok: false, error: `mutedTargets takes at most ${MUTED_MAX} entries` };
    for (const k of m) {
      if (typeof k !== 'string' || k.length > FKEY_MAX || !isFkey(k)) return { ok: false, error: `mutedTargets has an invalid fleet key ${show(k)}` };
    }
    patch.mutedTargets = [...new Set(m)];
  }
  return { ok: true, patch };
}

// --- quiet hours ---------------------------------------------------------------

const fmtCache = new Map();
function formatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch {
      f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    if (fmtCache.size > 50) fmtCache.clear();
    fmtCache.set(tz, f);
  }
  return f;
}

/** Minutes since local midnight of `now` (ms) in time zone `tz` (bad tz -> UTC). */
export function localMinutes(now, tz) {
  let h = 0;
  let m = 0;
  for (const p of formatter(tz).formatToParts(new Date(now))) {
    if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
  }
  return h * 60 + m;
}

/** Is `now` inside quietHours {from, to} (may cross midnight; `to` exclusive)? */
export function inQuiet(quietHours, now, tz) {
  if (!validQuiet(quietHours) || quietHours === null) return false;
  const from = quietMinutes(quietHours.from);
  const to = quietMinutes(quietHours.to);
  const t = localMinutes(now, tz);
  return from < to ? t >= from && t < to : t >= from || t < to;
}

// --- rules ---------------------------------------------------------------------

/** The fkey an alarm is about, or null (builder-wide or fleet-wide alarms). */
export function alarmFkey(alarm) {
  const b = alarm?.builder;
  const t = alarm?.target;
  if (typeof b !== 'string' || !BUILDER_ID_RX.test(b) || typeof t !== 'string' || t === '') return null;
  return `${b}/${t}`;
}

/** Coalescing key: builder/target (target may be absent). */
export function coalesceKey(alarm) {
  return `${alarm?.builder ?? ''}/${alarm?.target ?? ''}`;
}

/**
 * Pure: should this raised alarm be pushed now?
 *   prefs = effectivePrefs(...) ({kinds, quietHours, mutedTargets, quietBypass})
 *   lastAt = ms of the last push for the same builder/target, or null
 * -> {notify:bool, reason, defer:bool}
 */
export function shouldNotify(alarm, prefs, lastAt, now, tz) {
  const p = prefs ?? effectivePrefs(null, null);
  const kind = alarm?.kind;
  if (typeof kind !== 'string' || !ALARM_KINDS.includes(kind)) return { notify: false, reason: 'unknown kind', defer: false };
  if (p.kinds?.[kind] !== true) return { notify: false, reason: 'kind off', defer: false };
  const fk = alarmFkey(alarm);
  if (fk && Array.isArray(p.mutedTargets) && p.mutedTargets.includes(fk)) return { notify: false, reason: 'muted', defer: false };
  const bypass = Array.isArray(p.quietBypass) ? p.quietBypass.includes(kind) : DEFAULT_BYPASS.includes(kind);
  if (!bypass && inQuiet(p.quietHours, now, tz)) return { notify: false, reason: 'quiet', defer: true };
  if (!bypass && lastAt !== null && lastAt !== undefined && now - lastAt < COALESCE_MS) return { notify: false, reason: 'coalesced', defer: false };
  return { notify: true, reason: bypass ? 'bypass' : 'ok', defer: false };
}

/**
 * The push payload for an alarm. Builder strings are cleaned and capped; the
 * deep link carries the fkey as one encoded component.
 *   codeOf(builderId) -> 'BA' (default deriveCode)
 */
export function buildPayload(alarm, codeOf = deriveCode) {
  const kind = cleanText(alarm?.kind, 40) || 'alarm';
  const builder = typeof alarm?.builder === 'string' && BUILDER_ID_RX.test(alarm.builder) ? alarm.builder : null;
  let code = '';
  if (builder) {
    try { code = cleanText(codeOf(builder), 3); } catch { code = ''; }
    if (!/^[A-Z0-9]{2,3}$/.test(code)) code = deriveCode(builder);
  }
  const name = cleanText(alarm?.target, NAME_MAX) || builder || 'fleet';
  const title = cleanText(`${code ? `${code} ` : ''}${kind}: ${name}`, TITLE_MAX);
  const body = cleanText(alarm?.text, BODY_MAX) || title;
  const id = typeof alarm?.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(alarm.id) ? alarm.id : 'alarm';
  const fk = alarmFkey(alarm);
  const url = fk ? `#/inbox?sel=${encodeURIComponent(fk)}` : '#/inbox';
  return { title, body, tag: `lb-${id}`, url };
}

// --- the service ---------------------------------------------------------------

/**
 * createNotifier({db, now, cfg, sender, codeOf, log})
 *   db      {kvRead(key, fallback), kvWrite(key, value)}
 *   cfg     () -> config (reads cfg().notify and cfg().timezone on every call)
 *   sender     (payload) => Promise<{sent, subscribers}>, or
 *   getSender  () -> sender | null, resolved on every send (a sender the
 *              hub provides after this service starts is picked up)
 * -> {shouldNotify, onRaised(alarms) -> Promise<results>, digest({since}),
 *     prefs(), setPrefs(patch), setMuted(fkey, on), counters()}
 */
export function createNotifier({ db = null, now = Date.now, cfg = () => ({}), sender = null, getSender = null, codeOf = deriveCode, log = null } = {}) {
  const clock = typeof now === 'function' ? now : Date.now;
  const conf = typeof cfg === 'function' ? cfg : () => cfg;
  const senderOf = typeof getSender === 'function' ? getSender : () => sender;
  const lastAt = new Map(); // coalesceKey -> ms
  const sends = new Map(); // builder -> [ms]
  let deferred = null;
  let stored = null;
  let warnedNoSender = false;
  const n = { sent: 0, deferred: 0, coalesced: 0, rated: 0, failed: 0 };

  const read = (key, fallback) => {
    try { return db && typeof db.kvRead === 'function' ? db.kvRead(key, fallback) : fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { if (db && typeof db.kvWrite === 'function') db.kvWrite(key, value); } catch (err) { log?.warn?.(`notify: kv write ${key} failed`, String(err?.message || err)); }
  };

  function storedPrefs() {
    if (stored === null) {
      const v = read(KV_PREFS, null);
      stored = isObj(v) ? v : {};
    }
    return stored;
  }

  function prefs() {
    return effectivePrefs(conf()?.notify, storedPrefs());
  }

  function tz() {
    const t = conf()?.timezone;
    return typeof t === 'string' && t ? t : 'UTC';
  }

  function deferredList() {
    if (deferred === null) {
      const v = read(KV_DEFERRED, []);
      deferred = Array.isArray(v) ? v.filter(isObj).slice(-DEFERRED_MAX) : [];
    }
    return deferred;
  }

  function defer(alarm, payload, reason, t) {
    const list = deferredList();
    list.push({
      id: payload.tag.slice(3),
      kind: alarm.kind,
      builder: typeof alarm.builder === 'string' ? alarm.builder : null,
      target: alarm.target == null ? null : cleanText(alarm.target),
      fkey: alarmFkey(alarm),
      title: payload.title,
      body: payload.body,
      url: payload.url,
      reason,
      at: t,
    });
    if (list.length > DEFERRED_MAX) list.splice(0, list.length - DEFERRED_MAX);
    n.deferred++;
  }

  function prune(t) {
    if (lastAt.size > TRACK_MAX) for (const [k, at] of lastAt) if (t - at >= COALESCE_MS) lastAt.delete(k);
    if (sends.size > TRACK_MAX) for (const [k, l] of sends) if (!l.some((at) => t - at < RATE_WINDOW_MS)) sends.delete(k);
  }

  /** Room under the per-builder cap? Records the send when there is. */
  function takeRate(builder, t) {
    const key = builder ?? '';
    const recent = (sends.get(key) ?? []).filter((at) => t - at < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) { sends.set(key, recent); return false; }
    recent.push(t);
    sends.set(key, recent);
    return true;
  }

  async function deliver(payload) {
    const send = senderOf();
    if (typeof send !== 'function') {
      if (!warnedNoSender) log?.warn?.('notify: no push sender on this hub; raises are not pushed');
      warnedNoSender = true;
      return { sent: 0, subscribers: 0, error: 'no sender' };
    }
    try {
      const r = await send(payload);
      return { sent: Number(r?.sent) || 0, subscribers: Number(r?.subscribers) || 0 };
    } catch (err) {
      n.failed++;
      log?.warn?.('notify: push send failed', String(err?.message || err).slice(0, 200));
      return { sent: 0, subscribers: 0, error: 'send failed' };
    }
  }

  /**
   * Raised alarms (alarms.subscribe change.raised). Decisions are made
   * synchronously, in order, before any send is awaited.
   * -> Promise<[{id, notify, reason, defer, sent?, subscribers?}]>
   */
  async function onRaised(alarms) {
    if (!Array.isArray(alarms) || alarms.length === 0) return [];
    const t = clock();
    const p = prefs();
    const zone = tz();
    const out = [];
    const jobs = [];
    const before = n.deferred;
    for (const alarm of alarms) {
      if (!isObj(alarm)) continue;
      const key = coalesceKey(alarm);
      const v = shouldNotify(alarm, p, lastAt.get(key) ?? null, t, zone);
      const payload = buildPayload(alarm, codeOf);
      const res = { id: payload.tag.slice(3), ...v };
      if (v.defer) defer(alarm, payload, 'quiet', t);
      else if (v.notify) {
        if (!takeRate(alarm.builder, t)) {
          n.rated++;
          defer(alarm, payload, 'rate', t);
          Object.assign(res, { notify: false, reason: 'rate', defer: true });
        } else {
          lastAt.set(key, t);
          n.sent++;
          jobs.push(deliver(payload).then((r) => Object.assign(res, r)));
        }
      } else if (v.reason === 'coalesced') n.coalesced++;
      out.push(res);
    }
    if (n.deferred !== before) write(KV_DEFERRED, deferredList()); // one kv write per batch
    prune(t);
    await Promise.all(jobs);
    return out;
  }

  /** Raises deferred (quiet hours or the rate cap) since `since` (ms), oldest first. */
  function digest({ since = 0 } = {}) {
    const s = Number.isFinite(Number(since)) ? Number(since) : 0;
    return deferredList().filter((e) => Number(e.at) >= s).map((e) => ({ ...e }));
  }

  function setPrefs(patch) {
    const cur = { ...storedPrefs() };
    if (patch.kinds) cur.kinds = { ...(isObj(cur.kinds) ? cur.kinds : {}), ...patch.kinds };
    if (Object.hasOwn(patch, 'quietHours')) cur.quietHours = patch.quietHours;
    if (patch.mutedTargets) cur.mutedTargets = patch.mutedTargets.slice(0, MUTED_MAX);
    stored = cur;
    write(KV_PREFS, cur);
    return prefs();
  }

  /** Mute or unmute one fkey (the hub's mapping of /api/push/quiet {session, quiet}). */
  function setMuted(fk, on) {
    if (typeof fk !== 'string' || fk.length > FKEY_MAX || !isFkey(fk)) throw new TypeError('setMuted: not a fleet key');
    const set = new Set(prefs().mutedTargets);
    if (on) set.add(fk); else set.delete(fk);
    if (set.size > MUTED_MAX) throw new RangeError(`at most ${MUTED_MAX} muted targets`);
    return setPrefs({ mutedTargets: [...set] });
  }

  return {
    shouldNotify,
    onRaised,
    digest,
    prefs,
    setPrefs,
    setMuted,
    counters: () => ({ ...n }),
  };
}

// --- a hub-safe web-push sender ------------------------------------------------

/**
 * What server/push.mjs sendTo/broadcast do, without its builder imports.
 *   webpush        the `web-push` module (default: imported on first send)
 *   vapid          () -> {publicKey, privateKey} (or the object itself)
 *   subject        'https://hub.example.invalid/' or 'mailto:...'
 *   subscriptions  {list() -> [{endpoint, sub}|PushSubscription], remove(endpoint), markOk?(endpoint)}
 * -> (payload) => Promise<{sent, subscribers}>
 */
export function createWebPushSender({ webpush = null, vapid, subject, subscriptions, log = null, ttl = 300 } = {}) {
  if (!subscriptions || typeof subscriptions.list !== 'function') throw new TypeError('web push sender: subscriptions.list required');
  let wp = webpush;
  return async function send(payload) {
    if (!wp) wp = (await import('web-push')).default;
    const keys = typeof vapid === 'function' ? vapid() : vapid;
    if (!keys?.publicKey || !keys?.privateKey) throw new Error('no VAPID keys');
    const subs = subscriptions.list() ?? [];
    const opts = { TTL: ttl, vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey } };
    const body = JSON.stringify(payload);
    const results = await Promise.all(subs.map(async (s) => {
      const sub = s?.sub ?? s;
      const endpoint = s?.endpoint ?? sub?.endpoint;
      try {
        await wp.sendNotification(sub, body, opts);
        try { subscriptions.markOk?.(endpoint); } catch { /* bookkeeping only */ }
        return true;
      } catch (err) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          try { subscriptions.remove?.(endpoint); } catch { /* already gone */ }
          log?.info?.(`notify: dropped an expired push subscription (${code})`);
        } else log?.warn?.(`notify: push failed (${code ?? 'no status'})`);
        return false;
      }
    }));
    return { sent: results.filter(Boolean).length, subscribers: subs.length };
  };
}
