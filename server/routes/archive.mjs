// Route module: the lane archive reads (fleet plan §10 2.9/2.10, R9).
//
//   GET /api/v1/archive?q=&limit=&before=   {rows}  newest first, no plan head/markers/record
//   GET /api/v1/archive/:lane               one row: markers and record parsed, plan_head
//                                           included, plus `restore` (the launch a restore
//                                           would send: the first free `<id>-r<N>` and
//                                           whether the branch still exists)
//   capability `archive`; start(): archive.backfill() once.
//
// Reads only (tier read): restore itself is the dispatcher's `launch` action
// with `restoredFrom`, never a route here. Every stored text (plan, markers,
// summary) was written by an agent and leaves as JSON string fields only.
import { log as liveLog } from '../log.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import * as db from '../db.mjs';
import * as store from '../lanes/store.mjs';
import * as archive from '../lanes/archive.mjs';

export const Q_MAX = 200;

const json = (res, body, status = 200) => {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' });
  res.end(buf);
};
const query = (req) => req.query ?? new URL(req.url, 'http://localhost').searchParams;
const qget = (q, k) => {
  const v = q.get(k);
  return v === null || v === '' ? null : v;
};

/** Handlers with injectable deps: { json, log, branchExists(repo, branch) }. */
export function createHandlers(deps = {}) {
  const send = deps.json ?? json;
  const log = deps.log ?? liveLog;
  const branchExists = deps.branchExists ?? archive.branchExists;
  const fail = (res, err) => {
    log?.error?.('archive route failed', String(err?.stack || err));
    send(res, { error: 'internal error' }, 500);
  };
  return {
    list(req, res) {
      const q = query(req);
      const text = qget(q, 'q');
      if (text !== null && (text.length > Q_MAX || text.includes('\0'))) return send(res, { error: 'bad q' }, 400);
      for (const [k, v] of [['limit', qget(q, 'limit')], ['before', qget(q, 'before')]]) {
        if (v !== null && !/^\d{1,16}$/.test(v)) return send(res, { error: `bad ${k}` }, 400);
      }
      try {
        const rows = db.listArchive({ q: text, limit: qget(q, 'limit') ?? 50, before: qget(q, 'before') });
        send(res, { rows });
      } catch (err) {
        fail(res, err);
      }
    },

    async one(req, res) {
      const lane = req.params?.lane;
      if (!store.isLaneId(lane)) return send(res, { error: 'bad lane id' }, 400);
      try {
        const row = db.getArchive(lane);
        if (!row) return send(res, { error: 'not archived' }, 404);
        const rec = row.record && typeof row.record === 'object' ? row.record : {};
        const restore = {
          lane: archive.restoreId(lane),
          repo: row.repo, branch: row.branch, plan: row.plan_path,
          model: typeof rec.model === 'string' ? rec.model : null,
          permissionMode: typeof rec.permissionMode === 'string' ? rec.permissionMode : null,
          restoredFrom: lane,
          branchExists: await branchExists(row.repo, row.branch),
        };
        send(res, { ...row, restore });
      } catch (err) {
        fail(res, err);
      }
    },
  };
}

export function routes(h) {
  return Object.freeze([
    { method: 'GET', path: '/api/v1/archive', name: 'archive', tier: 'read', handler: h.list },
    { method: 'GET', path: '/api/v1/archive/:lane', name: 'archive-lane', tier: 'read', handler: h.one },
  ].map(Object.freeze));
}

export default {
  name: 'archive',
  modes: ['builder'],
  register(ctx) {
    const h = createHandlers({ json: ctx.json, log: ctx.log });
    for (const r of routes(h)) ctx.route(r.method, r.path, r.handler);
    addCapability('archive');
  },
  start(ctx) {
    if (ctx?.prs?.get) archive.init({ prFor: (id) => ctx.prs.get(id) });
    // Once, in the background: a slow disk must not hold up the boot.
    archive.backfill().catch((err) => (ctx?.log ?? liveLog).warn(`archive backfill failed: ${String(err?.message || err)}`));
  },
};
