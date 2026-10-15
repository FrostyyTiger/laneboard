// Hub module (fleet plan §10 2.10/2.11, R10): the fleet Morning and the fleet archive.
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
//   GET /api/fleet/morning?window=&b=   mergeMorning() over every builder's /api/v1/morning
//                                       (b=<id>: that builder's result alone, fkeyed, unmerged)
//   GET /api/fleet/archive?q=&limit=&before=
//                                       /api/v1/archive fanned out to every builder that is not
//                                       down, merged newest retired first, rows tagged `builder`
//
// Builder reads go through §3 H12's signed read proxy (`readProxy.get`, 3 s each); a
// builder that is down, slow or answers badly is listed in `missing`, never dropped.
// The hub-side inputs come from the ctx services, each optional (a missing one gives an
// empty block): `reviewWaits` (O10 stats/open), `notify` (O9 digest), `alarms` (O8 live)
// plus the alarm history (events type `alarm` in the hub db, or its kv row), and the hub
// `audit` (approve/deny/release). Results are cached 15 s per (window, b).
//
// Route auth (direct or local) is the hub boot path's, as for every hub route.
// Imports only hub-safe modules: no server/state.mjs, db.mjs, config.mjs, routes/*.
import path from 'node:path';
import {
  mergeMorning, sanitizeBuilderMorning, fetchMorning, fetchArchive, mergeArchive,
  alarmIncidents, windowOf, sinceOf, FETCH_TIMEOUT_MS,
} from '../morning.mjs';
import { BUILDER_ID_RX } from '../../fleet/keys.mjs';
import { KV_HISTORY } from '../../fleet/alarms-store.mjs';
import { stateDir as defaultStateDir } from '../../fleet/paths.mjs';
import { createJsonKv } from '../reviewwait.mjs';

export const MORNING_PATH = '/api/fleet/morning';
export const ARCHIVE_PATH = '/api/fleet/archive';
export const CACHE_MS = 15_000;
export const Q_MAX = 200;
const AUDIT_PAGES = 5;
const HISTORY_LIMIT = 500;
const WINDOW_RE = /^[a-z0-9]{1,16}$/;

const isKv = (d) => !!d && typeof d.kvRead === 'function' && typeof d.kvWrite === 'function';

function opt(c, name) {
  try { return c && typeof c.has === 'function' && c.has(name) ? c.use(name) : null; } catch { return null; }
}

function params(req) {
  try { return new URL(req.url ?? '/', 'http://hub.invalid').searchParams; } catch { return new URLSearchParams(); }
}

/** Builders of the fleet store: [{id, code, state}] (the store's own config, never a builder's claim). */
function rosterOf(store, now) {
  if (!store) return [];
  try {
    if (typeof store.view === 'function') return store.view(now).builders.map((b) => ({ id: b.id, code: b.code, state: b.state }));
    if (typeof store.list === 'function') return store.list().map((e) => ({ id: e.id, code: e.code, state: e.conn?.state ?? 'unknown' }));
  } catch { /* fall through */ }
  return [];
}

/** Hub audit entries since `since`, paging the reader a few times. */
export function auditSince(audit, since) {
  if (!audit || typeof audit.read !== 'function') return [];
  const out = [];
  let after;
  for (let i = 0; i < AUDIT_PAGES; i++) {
    let r;
    try { r = after ? audit.read({ after, limit: 1000 }) : audit.read({ since, limit: 1000 }); } catch { break; }
    const entries = Array.isArray(r?.entries) ? r.entries : [];
    for (const e of entries) if (e && typeof e.ts === 'number' && e.ts >= since) out.push(e);
    if (!r?.more || !entries.length) break;
    after = entries[entries.length - 1]?.hash;
    if (typeof after !== 'string') break;
  }
  return out;
}

/** The alarm history: events type `alarm` (db.listEvents) or O8's kv row. */
export function alarmHistory(db) {
  try {
    if (db && typeof db.listEvents === 'function') return db.listEvents({ type: 'alarm', limit: HISTORY_LIMIT }) ?? [];
    if (isKv(db)) {
      const h = db.kvRead(KV_HISTORY, []);
      return Array.isArray(h) ? h : [];
    }
  } catch { /* none */ }
  return [];
}

export function createModule({ now: nowOpt } = {}) {
  let base = null;
  let backend = null;
  const cache = new Map(); // key -> {at, value: Promise}

  const clock = () => (typeof nowOpt === 'function' ? nowOpt() : typeof base?.now === 'function' ? base.now() : Date.now());
  const svc = (name) => base?.[name] ?? opt(base, name);

  function db() {
    if (backend) return backend;
    const c = base ?? {};
    const d = c.db ?? opt(c, 'db');
    if (isKv(d) || typeof d?.listEvents === 'function') backend = d;
    else {
      const dir = typeof c.config?.stateDir === 'string' && c.config.stateDir ? c.config.stateDir : defaultStateDir();
      backend = createJsonKv(path.join(dir, 'hub'));
    }
    return backend;
  }

  function cached(key, build) {
    const t = clock();
    const hit = cache.get(key);
    if (hit && t - hit.at >= 0 && t - hit.at < CACHE_MS) return hit.value;
    const value = build(t);
    cache.set(key, { at: t, value });
    value.catch(() => cache.delete(key));
    if (cache.size > 64) for (const [k, v] of cache) if (t - v.at >= CACHE_MS) cache.delete(k);
    return value;
  }

  async function morning(window, t) {
    const readProxy = svc('readProxy');
    const roster = rosterOf(svc('store'), t);
    const since = sinceOf(window, base?.config?.timezone, t);
    const perBuilder = readProxy && typeof readProxy.get === 'function'
      ? await fetchMorning({ readProxy, ids: roster.map((b) => b.id), window, timeoutMs: FETCH_TIMEOUT_MS })
      : new Map();

    const waitsSvc = svc('reviewWaits');
    let waits = null;
    try { if (waitsSvc) waits = { stats: waitsSvc.stats({ since }), open: waitsSvc.open() }; } catch { waits = null; }

    const notify = svc('notify');
    let deferred = [];
    try { if (notify && typeof notify.digest === 'function') deferred = notify.digest({ since }); } catch { deferred = []; }

    const history = alarmHistory(db());
    let live = [];
    try { const a = svc('alarms'); if (a && typeof a.live === 'function') live = a.live(); } catch { live = []; }
    const stuck = alarmIncidents(history, { kind: 'stuck', since, live });
    const answerTimes = alarmIncidents(history, { kind: 'approval', since })
      .filter((i) => i.resolvedAt !== null && i.since !== null && i.resolvedAt >= since)
      .map((i) => i.resolvedAt - i.since);

    return mergeMorning({
      perBuilder, builders: roster, waits, stuck, audit: auditSince(svc('audit'), since), deferred, answerTimes,
      window, since, now: t,
    });
  }

  async function single(id, window, t) {
    const readProxy = svc('readProxy');
    const roster = rosterOf(svc('store'), t);
    const entry = roster.find((b) => b.id === id);
    const perBuilder = readProxy && typeof readProxy.get === 'function'
      ? await fetchMorning({ readProxy, ids: [id], window, timeoutMs: FETCH_TIMEOUT_MS })
      : new Map([[id, { error: 'no read proxy' }]]);
    const row = sanitizeBuilderMorning(id, perBuilder.get(id), entry?.code ?? null);
    return { ...row, window: windowOf(window), since: row.since ?? sinceOf(window, base?.config?.timezone, t), now: t, missing: row.error ? [id] : [] };
  }

  async function onMorning(req, res) {
    const q = params(req);
    const raw = q.get('window') || 'tonight';
    if (!WINDOW_RE.test(raw)) return base.json(res, { error: 'bad window' }, 400);
    const window = windowOf(raw);
    const b = q.get('b');
    if (b !== null && b !== '') {
      if (!BUILDER_ID_RX.test(b)) return base.json(res, { error: 'bad builder' }, 400);
      if (!rosterOf(svc('store'), clock()).some((x) => x.id === b)) return base.json(res, { error: 'unknown builder' }, 404);
    }
    try {
      const body = await cached(`${window}|${b || ''}`, (t) => (b ? single(b, window, t) : morning(window, t)));
      return base.json(res, body);
    } catch (err) {
      base.log?.error?.('fleet morning failed', String(err?.message || err));
      return base.json(res, { error: 'internal error' }, 500);
    }
  }

  async function onArchive(req, res) {
    const q = params(req);
    const text = q.get('q');
    if (text !== null && (text.length > Q_MAX || text.includes('\0'))) return base.json(res, { error: 'bad q' }, 400);
    const limit = q.get('limit');
    const before = q.get('before');
    for (const [k, v] of [['limit', limit], ['before', before]]) {
      if (v !== null && v !== '' && !/^\d{1,16}$/.test(v)) return base.json(res, { error: `bad ${k}` }, 400);
    }
    const fwd = new URLSearchParams();
    if (text) fwd.set('q', text);
    if (limit) fwd.set('limit', limit);
    if (before) fwd.set('before', before);
    try {
      const t = clock();
      const readProxy = svc('readProxy');
      const roster = rosterOf(svc('store'), t);
      const live = roster.filter((b) => b.state !== 'down').map((b) => b.id);
      const per = readProxy && typeof readProxy.get === 'function'
        ? await fetchArchive({ readProxy, ids: live, query: fwd.toString(), timeoutMs: FETCH_TIMEOUT_MS })
        : new Map();
      const out = mergeArchive(per, { limit: limit ? Number(limit) : 50 });
      const down = roster.filter((b) => b.state === 'down').map((b) => b.id);
      return base.json(res, { rows: out.rows, missing: [...new Set([...out.missing, ...down])].sort() });
    } catch (err) {
      base.log?.error?.('fleet archive failed', String(err?.message || err));
      return base.json(res, { error: 'internal error' }, 500);
    }
  }

  return {
    name: 'hub-review',
    modes: ['hub'],
    register(ctx) {
      base = ctx;
      ctx.route('GET', MORNING_PATH, onMorning);
      ctx.route('GET', ARCHIVE_PATH, onArchive);
    },
    start(ctx) {
      // Services provided by later modules are read lazily through ctx.use; keep
      // the start ctx's direct fields (store, readProxy, audit) when it has them.
      base = { ...base, ...ctx, has: base?.has ?? ctx.has, use: base?.use ?? ctx.use, json: base?.json ?? ctx.json };
    },
    stop() {
      cache.clear();
    },
  };
}

export default createModule();
