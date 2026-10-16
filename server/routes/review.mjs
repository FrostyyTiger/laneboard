// Route module: the builder's review reads (fleet plan §10 2.10, R7) and the
// send-review action registration. REVIEW-REQUIRED (SR20).
//
//   GET /api/v1/lanes/:id/diff?base=&mode=&path=                 laneDiff (R2)
//   GET /api/v1/sessions/:name/transcript?after=|before=&limit=  tailTranscript (R4)
//   GET /api/v1/sessions/:name/preview?n=                        {name, lines} raw ANSI, no html
//   GET /api/v1/morning?window=                                  morning.build() + builder
//
// Every route is a read (tier read). The request classification (local /
// direct / signed hub) is http.mjs's job (A8); these handlers never mutate
// anything. All diff, transcript and pane text is untrusted (written by an
// agent): it leaves as JSON string fields only, never as HTML, and errors are
// fixed strings or the reader's own DiffError/TranscriptError messages (never
// a stack or a raw git stderr). The client never sends a file path: the
// transcript file comes from the session, checked by resolveTranscriptFile
// against config.projectsDir; a diff `path` is only matched against the
// numstat list inside laneDiff.
//
// Deps are injectable (createHandlers) so tests run against temp repos and
// fixture transcripts without the live state.
import { config as liveConfig } from '../config.mjs';
import { log as liveLog } from '../log.mjs';
import { isSafeSessionName, WINDOWS } from '../util.mjs';
import { addCapability } from '../fleet/api-v1.mjs';
import * as diff from '../review/diff.mjs';
import { tailTranscript, resolveTranscriptFile, TranscriptError } from '../review/transcript.mjs';
import { transcriptPathFor } from '../collector/transcripts.mjs';
import * as morning from '../morning.mjs';
import * as store from '../lanes/store.mjs';
import { setReviewSent } from '../collector/review.mjs';
import { capturePane as tmuxCapturePane } from '../collector/tmux.mjs';
import { registerSendReview } from '../review/actions.mjs';

export const PREVIEW_DEFAULT = 40;
export const PREVIEW_MAX = 200;
/** Per-line cap of a preview line (raw ANSI). */
export const PREVIEW_LINE_CHARS = 2000;
const MORNING_MEMO_MS = 5000;
const WINDOW_RE = /^[a-z0-9]{1,16}$/;

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

/** Map a reader error to {status, body}: known statuses pass with their message, the rest is 500. */
export function errorResponse(err, log = liveLog) {
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status === 500 && !(err instanceof diff.DiffError) && !(err instanceof TranscriptError)) {
    log?.error?.('review route failed', String(err?.stack || err));
    return { status, body: { error: 'internal error' } };
  }
  return { status, body: { error: String(err?.message || 'error').toWellFormed().slice(0, 300) } };
}

/**
 * Handlers with injectable deps:
 *   state       {get(name), snapshot()}
 *   laneDiff    diff.laneDiff
 *   config      {projectsDir, transcript, fleet}
 *   buildMorning(opts) -> morning.build(opts)
 *   send        json writer (res, body, status)
 */
export function createHandlers(deps = {}) {
  const cfg = () => deps.config ?? liveConfig;
  const send = deps.json ?? json;
  const laneDiff = deps.laneDiff ?? diff.laneDiff;
  const buildMorning = deps.buildMorning ?? morning.build;
  const log = deps.log ?? liveLog;
  const fail = (res, err) => {
    const { status, body } = errorResponse(err, log);
    send(res, body, status);
  };
  const sessionOf = (req) => {
    const name = req.params?.name;
    if (!isSafeSessionName(name)) return { err: [{ error: 'invalid session name' }, 400] };
    const s = deps.state?.get?.(name);
    if (!s) return { err: [{ error: 'unknown session' }, 404] };
    return { s };
  };
  const builder = () => ({ id: cfg().fleet?.id ?? null, code: cfg().fleet?.code ?? null });
  const memos = new Map();

  return {
    async diff(req, res) {
      const q = query(req);
      const id = req.params?.id;
      if (!store.isLaneId(id)) return send(res, { error: 'bad lane id' }, 400);
      try {
        const r = await laneDiff({ laneId: id, base: qget(q, 'base'), mode: qget(q, 'mode') ?? 'all', path: qget(q, 'path') });
        send(res, r);
      } catch (err) {
        fail(res, err);
      }
    },

    async transcript(req, res) {
      const { s, err } = sessionOf(req);
      if (err) return send(res, ...err);
      const q = query(req);
      const after = qget(q, 'after');
      const before = qget(q, 'before');
      if (after !== null && before !== null) return send(res, { error: 'give after or before, not both' }, 400);
      for (const [k, v] of [['after', after], ['before', before], ['limit', qget(q, 'limit')]]) {
        if (v !== null && !/^\d{1,16}$/.test(v)) return send(res, { error: `bad ${k}` }, 400);
      }
      const c = cfg();
      try {
        const candidate = s.claude?.transcriptPath
          || (deps.transcriptPathFor ?? transcriptPathFor)({ sessionId: s.claude?.sessionId, dir: s.dir });
        // The projects dir from config first: no path reaches the reader unchecked.
        const file = await resolveTranscriptFile(candidate, c.projectsDir);
        const t = c.transcript ?? {};
        const r = await tailTranscript({
          file,
          after,
          before,
          limit: qget(q, 'limit') ?? t.maxEntries,
          maxBytes: t.tailMaxBytes,
          textCap: t.textCap,
        });
        send(res, { name: s.name, ...r });
      } catch (e) {
        fail(res, e);
      }
    },

    preview(req, res) {
      const { s, err } = sessionOf(req);
      if (err) return send(res, ...err);
      const raw = qget(query(req), 'n');
      let n = PREVIEW_DEFAULT;
      if (raw !== null) {
        if (!/^\d{1,6}$/.test(raw)) return send(res, { error: 'bad n' }, 400);
        n = Math.max(1, Math.min(PREVIEW_MAX, Number(raw)));
      }
      const lines = (Array.isArray(s.preview) ? s.preview : [])
        .slice(-n)
        .map((l) => String(l ?? '').toWellFormed().slice(0, PREVIEW_LINE_CHARS));
      send(res, { name: s.name, lines });
    },

    morning(req, res) {
      const raw = qget(query(req), 'window') ?? 'tonight';
      if (!WINDOW_RE.test(raw)) return send(res, { error: 'bad window' }, 400);
      const window = WINDOWS.includes(raw) ? raw : 'tonight';
      try {
        const now = Date.now();
        const hit = memos.get(window);
        if (hit && now - hit.at >= 0 && now - hit.at < MORNING_MEMO_MS) return send(res, hit.value);
        const value = buildMorning({ window, builder: builder(), snapshot: deps.state?.snapshot?.() ?? null });
        memos.set(window, { at: now, value });
        send(res, value);
      } catch (e) {
        fail(res, e);
      }
    },
  };
}

/** The route table (shape of api-v1 ROUTES): every entry is a GET read. */
export function routes(h) {
  return Object.freeze([
    { method: 'GET', path: '/api/v1/lanes/:id/diff', name: 'diff', tier: 'read', handler: h.diff },
    { method: 'GET', path: '/api/v1/sessions/:name/transcript', name: 'transcript', tier: 'read', handler: h.transcript },
    { method: 'GET', path: '/api/v1/sessions/:name/preview', name: 'preview', tier: 'read', handler: h.preview },
    { method: 'GET', path: '/api/v1/morning', name: 'morning', tier: 'read', handler: h.morning },
  ].map(Object.freeze));
}

/** The send-review deps built from the module ctx (dispatch-time deps still win). */
export function actionDeps(ctx) {
  return {
    state: ctx.state,
    actions: ctx.actions,
    config: ctx.config,
    capturePane: tmuxCapturePane,
    laneDiff: diff.laneDiff,
    setReviewSent,
    readLane: (id) => store.read(id),
    liveLanes: () => ctx.state?.snapshot?.().lanes ?? [],
  };
}

export default {
  name: 'review',
  modes: ['builder'],
  register(ctx) {
    const h = createHandlers({ state: ctx.state, config: ctx.config, json: ctx.json, log: ctx.log });
    for (const r of routes(h)) ctx.route(r.method, r.path, r.handler);
    addCapability('review');
    addCapability('morning');
    registerSendReview(actionDeps(ctx));
  },
};
