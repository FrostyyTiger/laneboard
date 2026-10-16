// An in-process fake builder speaking Builder API v1 (fleet plan README §3,
// §2 2.3/2.4/2.9, §3 H5, §11 X2), for hub tests that must not need a real
// builder (tmux, sessions, collectors).
//
//   const fb = await fakeBuilder({id: 'builder-a', hubKeys: [{key, id, scopes}]});
//   fb.url                      http://127.0.0.1:<port>  (put it in fleet.builders)
//   fb.hello                    the hello body (mutable: tests may change fields)
//   fb.snapshot()               the current v1 snapshot body
//   fb.push(msg)                stamp {builder, seq, epoch} and send to every stream
//   fb.actions                  every POST /api/v1/actions received: {envelope, body, kind, keyId, verified, status, response, headers}
//   fb.requests                 every HTTP request and upgrade: {method, url, headers, kind, status, at}
//   fb.received                 every message a stream client sent ({type:'visible'|'resync'|...})
//   fb.terms                    every terminal opened: {name, query, envelope, kind, ws}
//   fb.script.*                 gaps, drops, closes, epoch change, raw frames (see below)
//   await fb.close()            stop listening and drop every connection (the builder is "down")
//
// It verifies what a real builder verifies, with the real primitives
// (canonicalJson, keys-ed25519.verify, parseHubKeys, the nonce cache):
//   - identity (S6, as seen behind serve): Tailscale-User-Login → `direct`; a
//     signature → `hub` with the pinned key's scopes; both → 400 `ambiguous
//     identity`; neither → `local`, or 403 `unidentified` when enforcing
//     (default: enforce iff hubKeys are pinned). With `requireServe`, a
//     request without X-Forwarded-For + X-Forwarded-Proto: https → 403
//     `not-from-serve` (what the ingress listener answers).
//   - signed reads / stream upgrade: X-Laneboard-Ts/-Nonce/-Key/-Sig over
//     `v1 ${METHOD} ${builderId} ${req.url} ${ts} ${nonce}`; order key → sig →
//     ts → nonce; needs scope `read`; a signed request carrying Origin → 403.
//   - actions: envelope signature over canonicalJson(envelope) (X-Laneboard-Sig
//     + -Key), v/id/builder/ts/nonce/via/user checks, then hub control:
//     `hubControl:false` → 403 `control-disabled`, no `control` scope → 403
//     `scope-missing`. Mutations need X-Laneboard: 1.
//   - terminals: a hub needs a signed `term` envelope (X-Laneboard-Envelope,
//     base64url canonical JSON) whose target/args match the path and clamped
//     query, `hubControl` and scope `term`; a read signature → 403
//     `read-signature-not-allowed`. The terminal echoes every frame.
//
// Deviation from a real builder, on purpose: `hubControl` defaults to TRUE here
// (a real builder defaults to false), so relay/terminal tests work without
// ceremony; pass `hubControl: false` to test the master switch.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { canonicalJson, sha256Hex } from '../../server/fleet/canonical.mjs';
import { verify, sign, keyId as keyIdOf, publicKeyString } from '../../server/fleet/keys-ed25519.mjs';
import { parseHubKeys } from '../../server/config/fleet-auth.mjs';
import { createNonceCache } from '../../server/fleet/nonces.mjs';
import { fkey, deriveCode } from '../../server/fleet/keys.mjs';

const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'snapshot.json');
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_RX = /^[^\s]{1,128}$/;
const SIG_RX = /^ed25519 ([A-Za-z0-9+/]+={0,2})$/;
const MAX_BODY = 65536;
const RING = 500;
const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 400;

export const DEFAULT_ACTIONS = Object.freeze({
  'send-text': 'click', 'send-keys': 'click', interrupt: 'click', kill: 'confirm', restart: 'confirm',
  spawn: 'ask', launch: 'ask', retire: 'confirm', term: 'click', pause: 'click', resume: 'click',
});
export const DEFAULT_CAPABILITIES = Object.freeze(['snapshot', 'stream', 'actions', 'audit', 'term']);

class Refusal extends Error {
  constructor(status, error) { super(error); this.status = status; this.error = error; }
}

const clampDim = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** The fixture sessions, or sessions built from `sessions` (names or partial session objects). */
function baseSessions(sessions, fixture) {
  if (sessions === undefined) return structuredClone(fixture.sessions);
  const tmpl = fixture.sessions[0];
  return sessions.map((s) => {
    const over = typeof s === 'string' ? { name: s } : s;
    return { ...structuredClone(tmpl), state: 'idle', ...structuredClone(over) };
  });
}

/** A session as it goes on the v1 wire: keyed, no preview/previewHtml, bounded previewLines. */
function wireSession(s, id) {
  const { preview, previewHtml, ...rest } = s;
  const lines = Array.isArray(s.previewLines) ? s.previewLines : Array.isArray(preview) ? preview : [];
  return {
    ...rest,
    builder: id,
    key: fkey(id, s.name),
    previewLines: lines.slice(-PREVIEW_LINES).map((l) => String(l).slice(0, PREVIEW_CHARS)),
  };
}

function decodeB64url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return Buffer.from(s, 'base64url').toString('utf8');
}

/**
 * Sign like the hub does, for tests that drive the fake directly (the hub
 * itself must use server/fleet/auth.mjs). `privateKey` is an Ed25519 KeyObject.
 */
export function hubSigner(privateKey) {
  const kid = keyIdOf(privateKey);
  return {
    keyId: kid,
    publicKey: publicKeyString(privateKey),
    /** The four signed-read headers for `METHOD pathWithQuery` on builder `builderId`. */
    readHeaders(method, builderId, pathWithQuery, { ts = Date.now(), nonce = crypto.randomUUID() } = {}) {
      const data = `v1 ${method.toUpperCase()} ${builderId} ${pathWithQuery} ${ts} ${nonce}`;
      return {
        'x-laneboard-ts': String(ts),
        'x-laneboard-nonce': nonce,
        'x-laneboard-key': kid,
        'x-laneboard-sig': `ed25519 ${sign(data, privateKey)}`,
      };
    },
    /** A fresh envelope; `fields` override (builder, action, target, args, user...). */
    envelope(fields = {}) {
      return { v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: '', action: '', target: '', args: {}, user: 'tester@example.invalid', via: 'hub', ...fields };
    },
    /** Headers for POST /api/v1/actions carrying `envelope` as the body. */
    actionHeaders(envelope) {
      return {
        'content-type': 'application/json',
        'x-laneboard': '1',
        'x-laneboard-key': kid,
        'x-laneboard-sig': `ed25519 ${sign(canonicalJson(envelope), privateKey)}`,
      };
    },
    /** Headers for a hub terminal upgrade carrying the `term` envelope. */
    termHeaders(envelope) {
      const text = canonicalJson(envelope);
      return {
        'x-laneboard-envelope': Buffer.from(text, 'utf8').toString('base64url'),
        'x-laneboard-key': kid,
        'x-laneboard-sig': `ed25519 ${sign(text, privateKey)}`,
      };
    },
  };
}

/**
 * Start a fake builder on 127.0.0.1 (ephemeral port).
 *
 * Options: id ('builder-a'), code (derived), sessions (names or partial
 * session objects; default the fixture's), version ('0.1.0'), apiVersion (1),
 * mode ('builder'), capabilities, actions (name → tier), helloFields (merged
 * into hello), hubKeys (bare strings or {key, id, scopes}), hubControl (true),
 * enforce (hubKeys non-empty), requireServe (false), allowedUsers ([]),
 * clockSkewMs (60000), now (() => ms), onAction(envelope, info) → body |
 * {status, body} (may be async; default {ok:true, result:{}, auditId}),
 * reads ({'/api/v1/<path>': (req, url) → body | {status, body}}), audit
 * (entries for GET /api/v1/audit).
 */
export async function fakeBuilder(opts = {}) {
  const {
    id = 'builder-a',
    version = '0.1.0',
    apiVersion = 1,
    mode = 'builder',
    capabilities = [...DEFAULT_CAPABILITIES],
    actions: tiers = { ...DEFAULT_ACTIONS },
    helloFields = {},
    hubKeys = [],
    hubControl = true,
    requireServe = false,
    allowedUsers = [],
    clockSkewMs = 60_000,
    now = Date.now,
    onAction = null,
    reads = {},
  } = opts;
  const code = opts.code ?? deriveCode(id);
  const enforce = opts.enforce ?? hubKeys.length > 0;
  const ring = parseHubKeys(hubKeys);
  const byKeyId = new Map(ring.map((k) => [k.keyId, k]));
  const nonces = createNonceCache({ now });
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

  let epoch = crypto.randomBytes(6).toString('hex');
  let seq = 0;
  let skip = 0; // seq numbers to burn before the next push (a gap)
  let drop = 0; // pushes to stamp but not send (a gap the receiver sees)
  const frames = []; // last RING stamped frames, for resync replay
  let sessions = baseSessions(opts.sessions, fixture);
  const auditEntries = structuredClone(opts.audit ?? []);

  const requests = [];
  const actionLog = [];
  const received = [];
  const terms = [];
  const streams = new Set();
  const sockets = new Set();

  const hello = {
    id, code, version, apiVersion, mode, capabilities, actions: tiers, time: 0, auth: { kind: 'local' }, ...helloFields,
  };

  function snapshot() {
    const wire = sessions.map((s) => wireSession(s, id));
    const names = new Set(wire.map((s) => s.name));
    const attention = (fixture.attention ?? [])
      .filter((a) => names.has(a.name))
      .map((a) => ({ ...structuredClone(a), builder: id, key: fkey(id, a.name) }));
    return {
      sessions: wire,
      vitals: structuredClone(fixture.vitals ?? null),
      attention,
      lanes: [],
      generatedAt: now(),
      builder: { id, code },
      seq,
      epoch,
    };
  }

  // --- identity ---------------------------------------------------------------

  /** {kind, keyId?, scopes?, user?} for a request, or throws Refusal. */
  function classify(req, { method, signedAs = 'read' }) {
    const h = req.headers;
    if (requireServe && !(h['x-forwarded-for'] && h['x-forwarded-proto'] === 'https')) throw new Refusal(403, 'not-from-serve');
    const user = h['tailscale-user-login'];
    const sig = h['x-laneboard-sig'];
    if (user && sig) throw new Refusal(400, 'ambiguous identity');
    if (user) {
      if (allowedUsers.length && !allowedUsers.includes(user)) throw new Refusal(403, 'user-not-allowed');
      return { kind: 'direct', user };
    }
    if (sig) {
      if (h.origin !== undefined) throw new Refusal(403, 'origin not allowed for hub requests');
      if (signedAs === 'read') return verifyRead(req, method);
      return { kind: 'hub', pending: signedAs }; // envelope checks happen in the handler
    }
    if (enforce) throw new Refusal(403, 'unidentified');
    return { kind: 'local', user: 'local' };
  }

  function keyFor(h) {
    const kid = h['x-laneboard-key'];
    if (typeof kid !== 'string' || !kid) throw new Refusal(401, 'missing signature headers');
    const k = byKeyId.get(kid);
    if (!k) throw new Refusal(403, 'unknown key');
    return k;
  }

  function sigOf(h) {
    const m = SIG_RX.exec(h['x-laneboard-sig'] ?? '');
    if (!m) throw new Refusal(401, 'malformed signature');
    return m[1];
  }

  function checkTs(ts) {
    if (!Number.isSafeInteger(ts) || Math.abs(now() - ts) > clockSkewMs) throw new Refusal(401, 'stale timestamp');
  }

  function useNonce(nonce, ts) {
    const r = nonces.add(nonce, ts);
    if (!r.ok) throw r.error === 'full' ? new Refusal(503, 'nonce cache full') : new Refusal(401, 'replay');
  }

  function verifyRead(req, method) {
    const h = req.headers;
    const tsText = h['x-laneboard-ts'];
    const nonce = h['x-laneboard-nonce'];
    if (typeof tsText !== 'string' || !/^\d{1,16}$/.test(tsText) || typeof nonce !== 'string' || !UUID_RX.test(nonce)) {
      throw new Refusal(401, 'missing signature headers');
    }
    const sig = sigOf(h);
    const k = keyFor(h);
    const data = `v1 ${method} ${id} ${req.url} ${tsText} ${nonce}`;
    if (!verify(data, sig, k.pub)) throw new Refusal(401, 'bad signature');
    const ts = Number(tsText);
    checkTs(ts);
    useNonce(nonce, ts);
    if (!k.scopes.has('read')) throw new Refusal(403, 'scope-missing');
    return { kind: 'hub', keyId: k.keyId, keyLabel: k.label, scopes: [...k.scopes] };
  }

  /** Verify a signed envelope (text = its canonical JSON as signed). */
  function verifyEnvelope(env, text, h, { action } = {}) {
    const sig = sigOf(h);
    const k = keyFor(h);
    if (!verify(text, sig, k.pub)) throw new Refusal(401, 'bad signature');
    if (env.v !== 1) throw new Refusal(400, 'bad envelope: v');
    if (typeof env.id !== 'string' || !UUID_RX.test(env.id)) throw new Refusal(400, 'bad envelope: id');
    if (env.builder !== id) throw new Refusal(403, 'wrong builder');
    checkTs(env.ts);
    useNonce(env.id, env.ts);
    if (env.via !== 'hub') throw new Refusal(400, 'bad envelope: via');
    if (typeof env.user !== 'string' || !USER_RX.test(env.user)) throw new Refusal(400, 'bad envelope: user');
    if (action && env.action !== action) throw new Refusal(400, `bad envelope: action must be ${action}`);
    const scope = env.action === 'term' ? 'term' : 'control';
    if (!hubControl) throw new Refusal(403, 'control-disabled');
    if (!k.scopes.has(scope)) throw new Refusal(403, 'scope-missing');
    return { kind: 'hub', keyId: k.keyId, keyLabel: k.label, scopes: [...k.scopes] };
  }

  // --- audit ----------------------------------------------------------------------

  function appendAudit(entry) {
    const prevHash = auditEntries.length ? auditEntries[auditEntries.length - 1].hash : null;
    const e = { ts: now(), id: crypto.randomUUID(), prevHash, ...entry };
    e.hash = sha256Hex(canonicalJson(e));
    auditEntries.push(e);
    return e;
  }

  // --- HTTP -------------------------------------------------------------------------

  const send = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  async function readBody(req) {
    const chunks = [];
    let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > MAX_BODY) throw new Refusal(413, 'body too large');
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function handle(req, res, rec) {
    const url = new URL(req.url, 'http://fake.invalid');
    const method = req.method;
    if (method === 'OPTIONS') throw new Refusal(405, 'method not allowed');

    if (method === 'GET' && url.pathname === '/healthz') return [200, { ok: true, version, fake: true }];

    if (method === 'POST' && url.pathname === '/api/v1/actions') {
      if (req.headers['x-laneboard'] !== '1') throw new Refusal(403, 'missing X-Laneboard header');
      const entry = { envelope: null, body: null, kind: null, keyId: null, verified: false, status: null, response: null, headers: { ...req.headers }, at: now() };
      actionLog.push(entry);
      try {
        const who = classify(req, { method, signedAs: 'action' });
        entry.kind = who.kind;
        const text = await readBody(req);
        let body;
        try { body = JSON.parse(text); } catch { throw new Refusal(400, 'body is not JSON'); }
        entry.body = body;
        let info = who;
        if (who.kind === 'hub') {
          if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Refusal(400, 'bad envelope');
          let canon;
          try { canon = canonicalJson(body); } catch { throw new Refusal(400, 'bad envelope: not canonicalizable'); }
          entry.envelope = body;
          info = verifyEnvelope(body, canon, req.headers);
          entry.keyId = info.keyId;
          entry.verified = true;
        } else {
          entry.envelope = body;
        }
        let out = onAction ? await onAction(entry.envelope, { ...info, headers: req.headers }) : undefined;
        if (out === undefined) out = { ok: true, result: {} };
        const status = out && Number.isInteger(out.status) && 'body' in out ? out.status : 200;
        let resBody = out && Number.isInteger(out.status) && 'body' in out ? out.body : out;
        const a = appendAudit({
          user: entry.envelope?.user ?? who.user ?? 'local',
          via: who.kind === 'hub' ? 'hub' : 'direct',
          builder: id,
          action: entry.envelope?.action ?? null,
          target: entry.envelope?.target ?? null,
          argsHash: sha256Hex(canonicalJson(entry.envelope?.args ?? {})),
          result: status < 300 ? 'ok' : 'error',
        });
        if (resBody && typeof resBody === 'object' && !Array.isArray(resBody) && resBody.auditId === undefined) resBody = { ...resBody, auditId: a.id };
        entry.status = status;
        entry.response = resBody;
        return [status, resBody];
      } catch (err) {
        if (err instanceof Refusal) {
          entry.status = err.status;
          entry.response = { ok: false, error: err.error };
          throw err;
        }
        throw err;
      }
    }

    if (method !== 'GET' && method !== 'HEAD') {
      if (req.headers['x-laneboard'] !== '1') throw new Refusal(403, 'missing X-Laneboard header');
      throw new Refusal(404, 'not found');
    }

    const who = classify(req, { method });
    rec.kind = who.kind;
    if (url.pathname === '/api/v1/hello') return [200, { ...hello, time: now(), auth: { kind: who.kind } }];
    if (url.pathname === '/api/v1/snapshot') return [200, snapshot()];
    if (url.pathname === '/api/v1/audit') {
      const since = Number(url.searchParams.get('since') ?? 0) || 0;
      const after = url.searchParams.get('after');
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit') ?? 500) || 500));
      let list = auditEntries.filter((e) => e.ts >= since);
      if (after) {
        const i = list.findIndex((e) => e.id === after);
        if (i >= 0) list = list.slice(i + 1);
      }
      const last = auditEntries[auditEntries.length - 1];
      return [200, {
        builder: id,
        head: { hash: last?.hash ?? null, count: auditEntries.length },
        entries: list.slice(0, limit),
        more: list.length > limit,
      }];
    }
    const custom = reads[url.pathname];
    if (custom) {
      const out = await custom(req, url, who);
      if (out && Number.isInteger(out.status) && 'body' in out) return [out.status, out.body];
      return [200, out];
    }
    throw new Refusal(404, 'not found');
  }

  const server = http.createServer((req, res) => {
    const rec = { method: req.method, url: req.url, headers: { ...req.headers }, kind: null, status: null, at: now() };
    requests.push(rec);
    handle(req, res, rec).then(([status, body]) => {
      rec.status = status;
      send(res, status, body);
    }, (err) => {
      if (err instanceof Refusal) {
        rec.status = err.status;
        send(res, err.status, { ok: false, error: err.error });
      } else {
        rec.status = 500;
        send(res, 500, { ok: false, error: 'internal error' });
      }
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
  });

  // --- WebSockets -----------------------------------------------------------------

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });

  const refuseUpgrade = (socket, status, error) => {
    const text = JSON.stringify({ ok: false, error });
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? 'Error'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(text)}\r\nConnection: close\r\n\r\n${text}`);
  };

  function stamp(msg) {
    seq += 1 + skip;
    skip = 0;
    const frame = { ...msg, builder: id, seq, epoch };
    frames.push(frame);
    if (frames.length > RING) frames.shift();
    return frame;
  }

  // On the stream every frame carries `builder` as the id string (README 3.4,
  // §2 2.9), the snapshot frame included: its seq is the current one, not a new one.
  function snapshotFrame() {
    return { type: 'snapshot', ...snapshot(), builder: id, seq, epoch };
  }

  function sendTo(ws, frame) {
    if (ws.readyState === ws.OPEN) ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  function onStream(ws) {
    streams.add(ws);
    ws.once('close', () => streams.delete(ws));
    sendTo(ws, snapshotFrame());
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      received.push(msg);
      if (msg.type === 'ping') sendTo(ws, { type: 'pong' });
      else if (msg.type === 'resync') {
        // Replay fromSeq+1..now when the ring still holds it, else a fresh snapshot.
        const from = Number(msg.fromSeq);
        if (Number.isInteger(from) && frames.length && from >= frames[0].seq - 1 && from <= seq) {
          for (const f of frames) if (f.seq > from) sendTo(ws, f);
        } else {
          sendTo(ws, snapshotFrame());
        }
      }
    });
  }

  function onTerm(ws, name, query, envelope, kind) {
    const t = { name, query, envelope, kind, ws, frames: [] };
    terms.push(t);
    ws.on('message', (data, isBinary) => {
      t.frames.push({ data, isBinary });
      if (ws.readyState === ws.OPEN) ws.send(data, { binary: isBinary });
    });
  }

  server.on('upgrade', (req, socket, head) => {
    const rec = { method: 'UPGRADE', url: req.url, headers: { ...req.headers }, kind: null, status: null, at: now() };
    requests.push(rec);
    const url = new URL(req.url, 'http://fake.invalid');
    try {
      if (url.pathname === '/api/v1/stream') {
        const who = classify(req, { method: 'GET' });
        rec.kind = who.kind;
        rec.status = 101;
        wss.handleUpgrade(req, socket, head, (ws) => onStream(ws));
        return;
      }
      const m = /^\/api\/v1\/term\/([^/]+)$/.exec(url.pathname);
      if (m) {
        let name;
        try { name = decodeURIComponent(m[1]); } catch { throw new Refusal(404, 'not found'); }
        const h = req.headers;
        let envelope = null;
        let who;
        if (h['x-laneboard-envelope'] !== undefined) {
          if (h['tailscale-user-login']) throw new Refusal(400, 'ambiguous identity');
          if (h.origin !== undefined) throw new Refusal(403, 'origin not allowed for hub requests');
          const text = decodeB64url(h['x-laneboard-envelope']);
          if (text === null) throw new Refusal(400, 'bad envelope');
          try { envelope = JSON.parse(text); } catch { throw new Refusal(400, 'bad envelope'); }
          if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Refusal(400, 'bad envelope');
          let canon;
          try { canon = canonicalJson(envelope); } catch { throw new Refusal(400, 'bad envelope'); }
          if (canon !== text) throw new Refusal(400, 'bad envelope: not canonical');
          if (requireServe && !(h['x-forwarded-for'] && h['x-forwarded-proto'] === 'https')) throw new Refusal(403, 'not-from-serve');
          who = verifyEnvelope(envelope, text, h, { action: 'term' });
          if (envelope.target !== name) throw new Refusal(403, 'envelope target does not match the path');
          const args = envelope.args ?? {};
          if (url.searchParams.has('cols') && args.cols !== clampDim(url.searchParams.get('cols'), 20, 500, null)) throw new Refusal(403, 'envelope args do not match the query');
          if (url.searchParams.has('rows') && args.rows !== clampDim(url.searchParams.get('rows'), 5, 200, null)) throw new Refusal(403, 'envelope args do not match the query');
          if ((url.searchParams.get('window') ?? undefined) !== (args.window ?? undefined)) throw new Refusal(403, 'envelope args do not match the query');
        } else if (h['x-laneboard-sig'] !== undefined && !h['tailscale-user-login']) {
          throw new Refusal(403, 'read-signature-not-allowed');
        } else {
          who = classify(req, { method: 'GET' });
        }
        rec.kind = who.kind;
        if (!sessions.some((s) => s.name === name)) throw new Refusal(404, 'unknown session');
        rec.status = 101;
        const query = Object.fromEntries(url.searchParams);
        wss.handleUpgrade(req, socket, head, (ws) => onTerm(ws, name, query, envelope, who.kind));
        return;
      }
      throw new Refusal(404, 'not found');
    } catch (err) {
      const status = err instanceof Refusal ? err.status : 500;
      rec.status = status;
      refuseUpgrade(socket, status, err instanceof Refusal ? err.error : 'internal error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  let closed = null;

  const fb = {
    id,
    code,
    port,
    url: `http://127.0.0.1:${port}`,
    hello,
    get epoch() { return epoch; },
    get seq() { return seq; },
    get sessions() { return sessions; },
    set sessions(v) { sessions = baseSessions(v, fixture); },
    snapshot,
    actions: actionLog,
    requests,
    received,
    terms,
    streams,
    audit: auditEntries,
    /** Headers of every request received, in order (upgrades included). */
    get headers() { return requests.map((r) => r.headers); },
    /** Stamp `msg` with {builder, seq, epoch}, keep it for resync, send it to every stream. Returns the frame. */
    push(msg) {
      const frame = stamp(msg);
      if (drop > 0) { drop--; return frame; }
      for (const ws of streams) sendTo(ws, frame);
      return frame;
    },
    script: {
      /** The next push skips `n` seq numbers (a gap the receiver must resync on). */
      gap(n = 1) { skip += n; },
      /** The next `n` pushes are stamped and kept for resync but not sent. */
      drop(n = 1) { drop += n; },
      /** A new process epoch (as after a restart); the ring is cleared. */
      newEpoch() { epoch = crypto.randomBytes(6).toString('hex'); seq = 0; frames.length = 0; return epoch; },
      /** Send `frame` to every stream as is: an object (JSON) or a raw string. No stamping. */
      raw(frame) { for (const ws of streams) sendTo(ws, frame); },
      /** Close every stream with `code` (default 1000). */
      closeStreams(code = 1000, reason = '') { for (const ws of streams) ws.close(code, reason); },
      /** Drop every stream at the TCP level (no close frame). */
      killStreams() { for (const ws of streams) ws.terminate(); },
      /** Close every open terminal with `code`. */
      closeTerms(code = 1000, reason = '') { for (const t of terms) if (t.ws.readyState === t.ws.OPEN) t.ws.close(code, reason); },
    },
    /** Stop listening and drop every connection: the builder is down. Idempotent. */
    close() {
      closed ??= new Promise((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
        for (const s of sockets) s.destroy();
      });
      return closed;
    },
  };
  return fb;
}
