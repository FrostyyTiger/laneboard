// Hub module (fleet §7.3.6, O9): fleet notifications and their prefs.
// Loaded by boot/hub.mjs through loadModules('hub/routes', ctx).
//
// - register: creates the notifier (server/hub/notify.mjs), provides it as
//   `notify` ({onRaised, digest({since}), prefs(), setPrefs, setMuted, ...};
//   §10 R10 lists digest() as Morning's `deferred`, H11 maps /api/push/quiet
//   onto setMuted), and serves GET/POST /api/notify/prefs.
// - start: subscribes to O8's `alarms` service; every change's `raised` list
//   (and only that: re-derivations and acks never notify) goes to onRaised.
// - Sending: a `pushSender` service ((payload) -> Promise<{sent,
//   subscribers}>) or `ctx.push.broadcast`, looked up on every send. The hub
//   never imports server/push.mjs (it pulls in the builder's config and db);
//   notify.mjs createWebPushSender is the hub-safe sender H11 can provide.
// - Persistence: the hub db's kv (`ctx.db`, or a provided `db` service), else
//   a JSON-file kv under `<stateDir>/hub/` (as review-waits does).
//
// Route auth (direct or local) is the hub boot path's, as for every hub route.
import path from 'node:path';
import { createNotifier, checkPrefs, wirePrefs } from '../notify.mjs';
import { createJsonKv } from '../reviewwait.mjs';
import { stateDir as defaultStateDir } from '../../fleet/paths.mjs';

export const PATH = '/api/notify/prefs';
export const BODY_LIMIT = 64 * 1024;

const isKv = (d) => !!d && typeof d.kvRead === 'function' && typeof d.kvWrite === 'function';

function opt(c, name) {
  try { return c && typeof c.has === 'function' && c.has(name) ? c.use(name) : null; } catch { return null; }
}

async function readLimited(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) {
      const err = new Error('body too large');
      err.status = 413;
      throw err;
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export function createModule() {
  let base = null;
  let backend = null;
  let notifier = null;
  let unsubscribe = null;

  function resolveDb() {
    if (backend) return backend;
    const c = base ?? {};
    if (isKv(c.db)) backend = c.db;
    else if (isKv(opt(c, 'db'))) backend = opt(c, 'db');
    else {
      const dir = typeof c.config?.stateDir === 'string' && c.config.stateDir ? c.config.stateDir : defaultStateDir();
      backend = createJsonKv(path.join(dir, 'hub'));
    }
    return backend;
  }

  const lazyDb = {
    kvRead: (k, f) => resolveDb().kvRead(k, f),
    kvWrite: (k, v) => resolveDb().kvWrite(k, v),
  };

  function getSender() {
    const s = opt(base, 'pushSender');
    if (typeof s === 'function') return s;
    if (s && typeof s.send === 'function') return (p) => s.send(p);
    const push = base?.push ?? opt(base, 'push');
    if (push && typeof push.broadcast === 'function') return (p) => push.broadcast(p);
    return null;
  }

  function codeOf(builder) {
    try {
      const b = base?.store?.view?.(Date.now())?.builders?.find?.((x) => x?.id === builder);
      if (typeof b?.code === 'string') return b.code;
    } catch { /* fall back to the derived code */ }
    return '';
  }

  function sendJson(ctx, res, body, status = 200) {
    return ctx.json(res, body, status);
  }

  return {
    name: 'hub-notify',
    modes: ['hub'],
    register(ctx) {
      base = ctx;
      notifier = createNotifier({
        db: lazyDb,
        now: typeof ctx.now === 'function' ? ctx.now : Date.now,
        cfg: () => base?.config ?? {},
        getSender,
        codeOf,
        log: ctx.log ?? null,
      });
      if (typeof ctx.provide === 'function') ctx.provide('notify', notifier);
      ctx.route('GET', PATH, (req, res) => sendJson(ctx, res, wirePrefs(notifier.prefs())));
      ctx.route('POST', PATH, async (req, res) => {
        let body;
        try {
          const buf = await readLimited(req, BODY_LIMIT);
          body = buf.length ? JSON.parse(buf.toString('utf8')) : {};
        } catch (err) {
          return sendJson(ctx, res, { error: err?.status === 413 ? 'body too large' : 'invalid JSON' }, err?.status === 413 ? 413 : 400);
        }
        const v = checkPrefs(body);
        if (!v.ok) return sendJson(ctx, res, { error: v.error }, 400);
        return sendJson(ctx, res, wirePrefs(notifier.setPrefs(v.patch)));
      });
    },
    start(ctx) {
      if (ctx) base = { ...base, ...ctx };
      if (unsubscribe) return;
      const alarms = opt(base, 'alarms');
      if (!alarms || typeof alarms.subscribe !== 'function') {
        base?.log?.warn?.('notify: no alarms service; hub notifications are off');
        return;
      }
      unsubscribe = alarms.subscribe((change) => {
        const raised = change?.raised;
        if (!Array.isArray(raised) || raised.length === 0) return;
        notifier.onRaised(raised).catch((err) => base?.log?.error?.('notify: onRaised failed', String(err?.message || err)));
      });
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
    },
    // for tests
    get notifier() { return notifier; },
  };
}

export default createModule();
