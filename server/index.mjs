// Laneboard — single-process server: http + ws + static.
import http from 'node:http';
import fs from 'node:fs';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { handleRequest, route, json, readBody, readJson } from './http.mjs';
import { ansiLineToHtml } from './ansi.mjs';
import * as state from './state.mjs';
import * as db from './db.mjs';
import * as hooks from './collector/hooks.mjs';
import * as lanes from './collector/lanes.mjs';
import * as progress from './collector/progress.mjs';
import * as markerCollector from './collector/markers.mjs';
import * as morning from './morning.mjs';
import * as credit from './credit.mjs';
import * as transcripts from './collector/transcripts.mjs';
import * as ws from './ws.mjs';
import * as terminals from './terminals.mjs';
import * as actions from './actions.mjs';
import * as push from './push.mjs';
import * as laneStore from './lanes/store.mjs';
import * as launcher from './lanes/launch.mjs';
import * as retirer from './lanes/retire.mjs';
import * as prs from './collector/pr.mjs';
import * as devstack from './collector/devstack.mjs';
import * as slots from './collector/slots.mjs';
import { capturePane } from './collector/tmux.mjs';

process.on('unhandledRejection', (err) => log.error('unhandledRejection', err?.stack || String(err)));
process.on('uncaughtException', (err) => log.error('uncaughtException', err?.stack || String(err)));

fs.mkdirSync(config.dataDir, { recursive: true });

const startedAt = Date.now();

route('GET', '/healthz', (req, res) => {
  const m = process.memoryUsage();
  json(res, {
    ok: true,
    pid: process.pid,
    uptimeMs: Date.now() - startedAt,
    version: '1.0.0',
    // Exposed so a slow leak can be watched over days without a profiler:
    // if rssMb climbs while heapUsedMb stays flat, it is native (node-pty), and
    // if both climb together it is JS.
    memory: {
      rssMb: Math.round(m.rss / 1048576),
      heapUsedMb: Math.round(m.heapUsed / 1048576),
      heapTotalMb: Math.round(m.heapTotal / 1048576),
      externalMb: Math.round(m.external / 1048576),
    },
    terminals: terminals.liveCount(),
    wsClients: ws.clientCount(),
  });
});

route('GET', '/api/state', (req, res) => json(res, state.snapshot()));

// Lanes on their own, for the CLI and for anything that wants the worktree
// picture without a whole snapshot.
/**
 * Morning and Credit both subtract cost snapshots over a window, which means
 * reading thousands of rows and running the correlated baseline subquery. That
 * is cheap once and wasteful on every poll — and a 20-minute soak polling them
 * every 30 s pushed the process's RSS from 122 MB to 172 MB, over budget, with
 * the JS heap flat at 15 MB the whole time. It was never a leak; it was
 * transient allocation the allocator does not hand back.
 *
 * A few seconds of cache costs nothing in freshness — the underlying snapshots
 * are hourly — and removes the churn entirely.
 */
const MEMO_MS = 15_000;
const memos = new Map();
function memo(key, build) {
  const hit = memos.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value;
  const value = build();
  memos.set(key, { at: Date.now(), value });
  return value;
}

// Exactly what the Morning view renders, so `bin/laneboard morning` prints the
// same numbers the browser shows and the two cannot drift.
route('GET', '/api/morning', (req, res) => {
  const window = req.query.get('window') || 'tonight';
  json(res, memo(`morning:${window}`, () => morning.build({ window })));
});

route('GET', '/api/credit', (req, res) => json(res, memo('credit', () => credit.build())));

route('GET', '/api/markers', (req, res) => {
  const kinds = (req.query.get('kinds') || '').split(',').map((k) => k.trim()).filter(Boolean);
  json(res, {
    markers: db.listMarkers({
      lane: req.query.get('lane'),
      since: req.query.get('since'),
      kinds: kinds.length ? kinds : null,
      limit: Number(req.query.get('n') || req.query.get('limit') || 200),
      includeDismissed: req.query.get('dismissed') === 'true',
    }),
  });
});

// Dismiss is a tombstone, not a delete: the marker still happened, and a
// re-scan of the same pane must not resurrect it.
route('DELETE', '/api/markers/:id', action(async (req) => {
  const ok = db.dismissMarker(req.params.id);
  if (!ok) throw new actions.ActionError('no such marker, or already dismissed', 404);
  return { ok: true, id: Number(req.params.id) };
}));

route('GET', '/api/lanes', (req, res) => {
  const snap = state.snapshot();
  json(res, {
    lanes: snap.lanes,
    // v3: the records of launched lanes (retired ones included) and the
    // newest launch/retire job of each.
    launched: laneStore.readAll(),
    jobs: launcher.jobs(),
    // Retire readiness per active lane, at 60 s. Shown, never acted on.
    readiness: retirer.cached(),
    // PR + checks per lane branch, and the CI queue (gh, 60 s).
    ci: prs.snapshot(),
    health: { ...lanes.health(), progress: progress.health(), markers: markerCollector.health() },
    generatedAt: snap.generatedAt,
  });
});

/** A LaneError is a refusal with a reason, not a crash. */
function laneAction(handler, okStatus = 200) {
  return async (req, res) => {
    try {
      json(res, await handler(req), okStatus);
    } catch (err) {
      if (err instanceof launcher.LaneError) json(res, { error: err.message, ...(err.detail ? { detail: err.detail } : {}) }, err.status);
      else {
        log.error('lane action failed', err?.stack || String(err));
        json(res, { error: 'internal error' }, 500);
      }
    }
  };
}

// 202: validation has passed and the job is running. Its steps land in
// lane_jobs and /api/events; poll /api/jobs/:job.
route('POST', '/api/lanes', laneAction(async (req) => launcher.launch(await readJson(req), who(req)), 202));

// Only when a human asks. Body: { force?, confirm? } — force needs confirm = the lane id.
route('DELETE', '/api/lanes/:id', laneAction(async (req) => {
  const body = await readJson(req).catch(() => ({}));
  return retirer.retire(req.params.id, { force: body?.force === true, confirm: body?.confirm ?? null }, who(req));
}));

route('GET', '/api/ci', (req, res) => json(res, prs.snapshot()));
route('GET', '/api/devstack', (req, res) => json(res, devstack.snapshot()));
route('GET', '/api/slots', (req, res) => json(res, slots.snapshot()));

route('GET', '/api/jobs/:job', (req, res) => {
  const steps = db.jobSteps(req.params.job);
  if (!steps.length) return json(res, { error: 'no such job' }, 404);
  json(res, { job: req.params.job, lane: steps[0].lane, kind: steps[0].kind, steps });
});

// Hard rule 5: always 200, always fast, never block the session that called us.
route('POST', '/api/hook', (req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': 12 });
  res.end('{"ok":true}\n');
  readBody(req, 4 * 1024 * 1024)
    .then((buf) => {
      let body;
      try { body = JSON.parse(buf.toString('utf8')); } catch { return; }
      try {
        const r = hooks.ingest(body);
        ws.broadcastEvent({
          ts: Date.now(),
          session_name: r?.name ?? null,
          session_id: body.session_id ?? null,
          type: body.hook_event_name ?? 'unknown',
          subtype: hooks.subtypeOf(body),
        });
      } catch (err) { log.error('hook ingest failed', String(err)); }
    })
    .catch(() => {});
});

route('GET', '/api/sessions/:name/preview', (req, res) => {
  const s = state.get(req.params.name);
  if (!s) return json(res, { error: 'unknown session' }, 404);
  const n = Math.min(Number(req.query.get('n') || 40), 200);
  json(res, { name: s.name, lines: (s.preview || []).slice(-n), html: (s.preview || []).slice(-n).map(ansiLineToHtml) });
});

// --- actions ---------------------------------------------------------------

/** Wrap an action so every failure becomes a clean JSON status. */
function action(handler, okStatus = 200) {
  return async (req, res) => {
    try {
      json(res, await handler(req), okStatus);
    } catch (err) {
      if (err instanceof actions.ActionError) json(res, { error: err.message }, err.status);
      else {
        log.error('action failed', err?.stack || String(err));
        json(res, { error: 'internal error' }, 500);
      }
    }
  };
}

/** Tailscale puts the identity in a header when the request came via serve. */
const who = (req) => req.tsUser || 'local';

route('POST', '/api/sessions/:name/keys', action(async (req) => {
  const body = await readJson(req);
  return actions.sendKeys(req.params.name, body.keys, who(req));
}));

route('POST', '/api/sessions/:name/text', action(async (req) => {
  const body = await readJson(req);
  return actions.sendText(req.params.name, body.text, body.enter !== false, who(req));
}));

// 202: the tmux session exists when this returns, but the initial prompt is
// still being delivered in the background. Clients poll /api/state.
route('POST', '/api/sessions', action(async (req) => {
  const body = await readJson(req);
  return actions.spawn(body, who(req));
}, 202));

route('DELETE', '/api/sessions/:name', action(async (req) => actions.kill(req.params.name, who(req))));

route('POST', '/api/sessions/:name/restart', action(async (req) => actions.restart(req.params.name, who(req))));

// --- push ------------------------------------------------------------------

route('GET', '/api/push/key', (req, res) =>
  json(res, {
    publicKey: push.publicKey(),
    // iOS only offers the permission prompt to an installed PWA on HTTPS.
    secureContext: true,
    quiet: push.getQuiet(),
  })
);

route('POST', '/api/push/subscribe', action(async (req) => {
  const body = await readJson(req);
  if (!body?.endpoint || !body?.keys) throw new actions.ActionError('not a push subscription');
  db.addSubscription(body, req.headers['user-agent'] || null);
  log.info(`push subscription added (${db.listSubscriptions().length} total)`);
  return { ok: true, subscribers: db.listSubscriptions().length };
}));

route('DELETE', '/api/push/subscribe', action(async (req) => {
  const body = await readJson(req);
  if (body?.endpoint) db.removeSubscription(body.endpoint);
  return { ok: true, subscribers: db.listSubscriptions().length };
}));

route('POST', '/api/push/test', action(async () => {
  const r = await push.broadcast({
    title: 'Laneboard test',
    body: 'Push is working.',
    tag: 'laneboard-test',
    url: '/',
  });
  return r;
}));

route('POST', '/api/push/quiet', action(async (req) => {
  const body = await readJson(req);
  return push.setQuiet(body);
}));

// The browser reports how long its renders take. Kept because the 16 ms
// budget cannot honestly be measured anywhere but a real browser.
route('POST', '/api/client-metrics', action(async (req) => {
  const body = await readJson(req);
  const sample = {
    at: Date.now(),
    count: Number(body.count) || 0,
    averageMs: Number(body.averageMs) || 0,
    worstMs: Number(body.worstMs) || 0,
    sessions: Number(body.sessions) || 0,
    terminals: Number(body.terminals) || 0,
    viewport: String(body.viewport || '').slice(0, 20),
    dpr: Number(body.dpr) || 1,
    ua: String(body.ua || '').slice(0, 120),
  };
  const history = db.kvRead('client.render', []) || [];
  history.push(sample);
  db.kvWrite('client.render', history.slice(-50));
  log.info(
    `client render: avg ${sample.averageMs}ms worst ${sample.worstMs}ms ` +
    `over ${sample.count} renders, ${sample.sessions} sessions, ` +
    `${sample.terminals} terminals, ${sample.viewport} @${sample.dpr}x`
  );
  return { ok: true };
}));

route('GET', '/api/client-metrics', (req, res) => json(res, { samples: db.kvRead('client.render', []) || [] }));

route('GET', '/api/dirs', action(async () => ({ dirs: await actions.listDirs() })));

route('GET', '/api/cost', (req, res) => {
  const sessions = state.all().map((s) => ({
    name: s.name,
    sessionId: s.claude?.sessionId ?? null,
    model: s.claude?.model ?? null,
    usd: s.cost?.usd ?? 0,
    usdToday: s.cost?.usdToday ?? 0,
    tokens: s.cost?.tokens ?? null,
    pricedAsOpus: s.cost?.pricedAsOpus ?? false,
    statuslineUsd: s.statuslineCostUsd,
    // The statusline number is authoritative; ours covers sessions it never fired for.
    deltaPct:
      s.statuslineCostUsd && s.cost?.usd
        ? Math.round(((s.cost.usd - s.statuslineCostUsd) / s.statuslineCostUsd) * 1000) / 10
        : null,
  }));
  json(res, {
    sessions,
    totals: transcripts.totals(),
    statuslineTotalUsd: sessions.reduce((a, s) => a + (s.statuslineUsd || 0), 0),
    label: 'API-equivalent',
    generatedAt: Date.now(),
  });
});

route('GET', '/api/events', (req, res) => {
  const events = db.listEvents({
    session: req.query.get('session'),
    type: req.query.get('type'),
    before: req.query.get('before'),
    limit: Number(req.query.get('n') || req.query.get('limit') || 50),
  });
  // SessionStart hooks arrive before the registry knows the name; resolve now.
  for (const e of events) {
    if (!e.session_name && e.session_id) e.session_name = state.sessionNameBySessionId(e.session_id);
  }
  json(res, { events });
});

// --- v3: the Box and the lane cards' extras --------------------------------

/** What each lane spent in the last 5 h, API-equivalent, from hourly snapshots + live cost. */
function laneBurn5h() {
  const snap = { sessions: state.all() };
  const since = Date.now() - 5 * 3600 * 1000;
  const live = new Map();
  const idToName = new Map();
  for (const s of snap.sessions) {
    if (s.cost) live.set(s.name, s.cost);
    if (s.claude?.sessionId) idToName.set(s.claude.sessionId, s.name);
  }
  const nameOf = (r) => r.session_name || idToName.get(r.session_id) || r.session_id || null;
  const spend = morning.spendBySession({ rows: db.costRowsForWindow(since), since, live, nameOf });
  const byName = new Map(snap.sessions.map((s) => [s.name, s]));
  const out = {};
  for (const l of morning.spendByLane(spend, morning.laneResolver(byName)).lanes) {
    if (l.lane) out[l.lane] = Math.round(l.usd * 100) / 100;
  }
  return out;
}

/**
 * Built at most every 3 s (the tick is 2 s) and burn at most every 60 s: the
 * sources change on 15-60 s beats, and the payload is compared as JSON on
 * every tick to decide whether it rides the next delta.
 */
let boxMemo = { at: 0, value: null };
let burnMemo = { at: 0, value: {} };
function boxPayload() {
  const now = Date.now();
  if (now - boxMemo.at < 3000) return boxMemo.value;
  if (now - burnMemo.at > 60_000) {
    try { burnMemo = { at: now, value: laneBurn5h() }; } catch (err) { log.error('lane burn failed', String(err)); burnMemo.at = now; }
  }
  const ci = prs.snapshot();
  const records = laneStore.readAll();
  const activeIds = new Set(records.filter((r) => !r.retiredAt).map((r) => r.id));
  const dev = devstack.snapshot();
  boxMemo = {
    at: now,
    value: {
      launched: records.filter((r) => !r.retiredAt),
      readiness: retirer.cached(),
      // A job is interesting while its lane is active, or for an hour after.
      jobs: launcher.jobs().filter((j) => activeIds.has(j.lane) || now - (j.steps.at(-1)?.ts ?? 0) < 3600e3)
        .map((j) => ({ job: j.job, lane: j.lane, kind: j.kind, last: j.steps.at(-1) })),
      prs: ci.prs,
      ci: { queue: ci.queue, auth: ci.auth },
      burn5h: burnMemo.value,
      // Without the per-probe timings, which would change the JSON every 15 s for nothing.
      devstack: {
        health: dev.health.map((h) => ({ name: h.name, ok: h.ok, status: h.status })),
        containers: dev.containers,
        guard: { ok: dev.guard.ok, preventive: dev.guard.preventive, detective: dev.guard.detective, ssOk: dev.guard.ssOk },
      },
      slots: slots.snapshot().slots,
    },
  };
  return boxMemo.value;
}
state.setExtras(boxPayload);

const servers = [];

async function listenAll() {
  for (const addr of config.bindAddresses) {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        log.error('request failed', req.method, req.url, err?.stack || String(err));
        if (!res.headersSent) json(res, { error: 'internal error' }, 500);
        else res.end();
      });
    });
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/ws') return ws.attach(req, socket, head);
      if (url.pathname.startsWith('/ws/term/')) {
        if (terminals.attach(req, socket, head, url)) return;
      }
      for (const h of upgradeHandlers) {
        if (h(req, socket, head, url)) return;
      }
      socket.destroy();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, addr, () => {
        log.info(`listening on http://${addr}:${config.port}`);
        resolve();
      });
    });
    servers.push(server);
  }
}

/** Stage 4/5 register WebSocket upgrade handlers here. Return true if handled. */
export const upgradeHandlers = [];

async function shutdown(signal) {
  log.info(`shutting down (${signal})`);
  for (const fn of shutdownHooks) {
    try { await fn(); } catch (err) { log.error('shutdown hook failed', err?.stack || String(err)); }
  }
  for (const s of servers) s.close();
  setTimeout(() => process.exit(0), 500).unref();
}
// launcher.beginShutdown first: a launch step whose child dies with us is an
// interruption, not a failure.
export const shutdownHooks = [() => launcher.beginShutdown(), () => terminals.shutdown(), () => transcripts.persistAll(), () => db.close()];
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(sig));

await listenAll();
// Any "<name>-web-<id>" session still around is from a crashed run of ours.
await terminals.sweepStale();
db.startRetention();
state.start(ws.broadcastFrom);
launcher.init({ state, actions, capturePane, broadcast: ws.broadcastEvent });
// A launch cut off by a restart is shown as interrupted at its step, never resumed.
launcher.markInterrupted();
prs.init({ noteMarker: state.noteMarkerFromHook });
// A danger marker goes on the card like any marker, and is pushed at once,
// outside the coalescing window (push.onDanger).
devstack.init({
  state,
  onDanger: (row) => {
    state.noteMarkerFromHook(row);
    push.onDanger(row).catch((err) => log.error('danger push failed', String(err)));
  },
});
devstack.start();
slots.start();
prs.start();
retirer.init({ state, broadcast: ws.broadcastEvent, prFor: (id) => prs.get(id) });
retirer.start();

/**
 * Hourly cost snapshots + a periodic offset flush, so a restart never re-reads
 * 24 MB of transcript and never loses the running totals.
 *
 * The interval is reset by every restart, so a day of frequent restarts used to
 * record NOTHING — which matters more in v2, because the Morning and Credit
 * views subtract these rows to work out what a window cost. So the first one is
 * taken shortly after start, unless an hour has not yet passed since the last.
 */
const HOUR_MS = 3600 * 1000;
function takeCostSnapshot() {
  try {
    transcripts.snapshotAll((row) => {
      const name = row.sessionName || state.sessionNameBySessionId(row.sessionId);
      db.addCostSnapshot({ ...row, sessionName: name, lane: name ? state.get(name)?.lane ?? null : null });
    });
    transcripts.persistAll();
  } catch (err) {
    log.error('cost snapshot failed', String(err));
  }
}
const firstSnapshot = setTimeout(() => {
  if (Date.now() - db.lastCostSnapshotAt() >= HOUR_MS) takeCostSnapshot();
}, 45_000);
firstSnapshot.unref();

// Resolve the session name and lane on every row, so a snapshot stays
// attributable after the session is gone. The name was never written before v2
// and the whole column was NULL; sessionId is the key that always worked.
const costTimer = setInterval(takeCostSnapshot, HOUR_MS);
costTimer.unref();
const flushTimer = setInterval(() => transcripts.persistAll(), 60 * 1000);
flushTimer.unref();

log.info(`laneboard up, pid ${process.pid}`);
