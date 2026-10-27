// The room under test's control API (spec stand-ins.md §1.2): the clock verbs
// and the fault hooks behind `/link` and `/drop`, on a loopback port of its
// own, never on the room's port (D109). Kept apart from the wrapper so
// test/cockpit-room-under-test.test.mjs can drive the hooks in-process.
//
//   const control = createRoomControl({ clock, timeZone });
//   setFaults(control.hooks);                // server/cockpit/faults.mjs
//   const address = await control.listen();  // '127.0.0.1:<port>'
//   await control.handle('POST', '/clock', { mode: 'manual' });  // {status, body}
//
// Verbs served now: /clock, /tick, /link, /drop, /connections (T13: the link
// reports each upgrade through the `connection` hook), /sent (T14: every
// `seq`'d message the link numbered, through the `outbound` hook). The rest
// wait for the build that gives them something to act on and answer 404
// unknown-verb until then (B19): /pair, /unpair (pairing), /button (C2b),
// /jobs (Jobs), /alarms (the watcher).
import http from 'node:http';
import { freePort } from '../../helpers/boot.mjs';

/** stand-ins.md §1.2 `GET /sent`: the last 2 000, as the room keeps them (D94). */
export const SENT_MAX = 2_000;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** `2026-10-27T07:05:00+01:00`: ms as a wall time with its offset in `timeZone`. */
export function isoInZone(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const off = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

class BadBody extends Error {}
const bad = (detail) => { throw new BadBody(detail); };

function onlyKeys(body, keys) {
  if (!isObj(body)) bad('body: not an object');
  for (const k of Object.keys(body)) if (!keys.includes(k)) bad(`${k}: unknown key`);
}

export function createRoomControl({ clock, timeZone = 'UTC' } = {}) {
  let up = true; // true | false | 'silent'
  const links = new Set(); // sockets of upgrades let through, while open
  let dropPrompts = 0;
  const dropOut = new Map(); // type -> how many more to drop
  const connections = []; // the link's records, oldest first: {atMs, accepted, closeCode}
  const sent = []; // the link's `seq`'d messages, oldest first, the last SENT_MAX (B105)

  const hooks = {
    // /link {"up":false}: every new upgrade and every /api/cockpit/* request
    // has its socket destroyed unread. `silent` lets upgrades through (B20).
    upgrade(req, socket, kind) {
      if (up === false) {
        socket.destroy();
        return true;
      }
      if (kind === 'ws') {
        links.add(socket);
        socket.once('close', () => links.delete(socket));
      }
      return false;
    },
    inbound(msg) {
      if (up === 'silent') return true;
      if (dropPrompts > 0 && msg?.type === 'prompt') {
        dropPrompts--;
        return true;
      }
      return false;
    },
    // Each upgrade the link decided on; the link updates `closeCode` at its close.
    connection(rec) {
      connections.push(rec);
    },
    outbound(msg, link) {
      // A message for every link (`link` null) has its `seq`: what the room sent (D94).
      if (link === null && Number.isInteger(msg?.seq)) {
        sent.push(msg);
        if (sent.length > SENT_MAX) sent.shift();
      }
      if (up === 'silent') return true;
      const n = dropOut.get(msg?.type) ?? 0;
      if (n > 0) {
        if (n === 1) dropOut.delete(msg.type);
        else dropOut.set(msg.type, n - 1);
        return true;
      }
      return false;
    },
  };

  const nowBody = () => ({ now: isoInZone(clock.now(), timeZone) });

  async function advance(ms) {
    if (clock.mode !== 'manual') return { status: 409, body: { error: 'not-manual' } };
    await clock.advance(ms);
    return { status: 200, body: nowBody() };
  }

  const verbs = {
    async 'POST /clock'(body) {
      onlyKeys(body, ['mode', 'advanceMs', 'set']);
      if (body.mode === undefined && body.advanceMs === undefined && body.set === undefined) bad('body: one of mode, advanceMs, set');
      if (body.mode !== undefined && body.mode !== 'real' && body.mode !== 'manual') bad('mode: real or manual');
      if (body.advanceMs !== undefined && !(Number.isFinite(body.advanceMs) && body.advanceMs >= 0)) bad('advanceMs: a number >= 0');
      let at = null;
      if (body.set !== undefined) {
        at = typeof body.set === 'string' ? Date.parse(body.set) : NaN;
        if (!Number.isFinite(at)) bad('set: not ISO');
      }
      if (body.mode !== undefined) clock.setMode(body.mode);
      if (at !== null) clock.set(at);
      if (body.advanceMs !== undefined) return advance(body.advanceMs);
      return { status: 200, body: nowBody() };
    },
    async 'POST /tick'(body) {
      onlyKeys(body, ['ms']);
      if (!(Number.isFinite(body.ms) && body.ms >= 0)) bad('ms: a number >= 0');
      return advance(body.ms);
    },
    async 'POST /link'(body) {
      onlyKeys(body, ['up']);
      if (body.up !== true && body.up !== false && body.up !== 'silent') bad('up: true, false or "silent"');
      up = body.up;
      if (up !== false) return { status: 200, body: { up } };
      // Destroyed with no close frame: the page sees an unreachable room.
      const open = [...links];
      links.clear();
      for (const s of open) s.destroy();
      return { status: 200, body: { up: false, closed: open.length } };
    },
    async 'GET /sent'(_body, query) {
      for (const k of query.keys()) if (k !== 'type') bad(`${k}: unknown query key`);
      const type = query.get('type');
      return { status: 200, body: { items: type === null ? sent.slice() : sent.filter((m) => m.type === type) } };
    },
    async 'GET /connections'() {
      const items = connections.map((r) => ({ at: isoInZone(r.atMs, timeZone), atMs: r.atMs, accepted: r.accepted, closeCode: r.closeCode }));
      return { status: 200, body: { items } };
    },
    async 'POST /drop'(body) {
      onlyKeys(body, ['what', 'type']);
      if (body.what === 'next-prompt') {
        if (body.type !== undefined) bad('type: only with next-out');
        dropPrompts++;
      } else if (body.what === 'next-out') {
        if (typeof body.type !== 'string' || !body.type) bad('type: a message type');
        dropOut.set(body.type, (dropOut.get(body.type) ?? 0) + 1);
      } else bad('what: next-prompt or next-out');
      return { status: 200, body: { armed: true } };
    },
  };

  /** One call: `{status, body}`; never throws for a bad request. */
  async function handle(method, path, body) {
    const url = new URL(path, 'http://x');
    const verb = verbs[`${method} ${url.pathname}`];
    if (!verb) return { status: 404, body: { error: 'unknown-verb' } };
    try {
      return await verb(body ?? {}, url.searchParams);
    } catch (err) {
      if (err instanceof BadBody || err instanceof RangeError) return { status: 400, body: { error: 'bad-body', detail: err.message } };
      return { status: 500, body: { error: 'failed', detail: String(err?.message ?? err) } };
    }
  }

  let server = null;

  function serve(req, res) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let out;
      if (text.trim() === '') out = await handle(req.method, req.url, undefined);
      else {
        let body;
        try { body = JSON.parse(text); } catch { out = { status: 400, body: { error: 'bad-body', detail: 'not JSON' } }; }
        out ??= await handle(req.method, req.url, body);
      }
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  }

  /** Listen on 127.0.0.1 at a port from freePort(); resolves '127.0.0.1:<port>'. */
  async function listen() {
    for (let attempt = 0; ; attempt++) {
      const port = await freePort();
      server = http.createServer(serve);
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(port, '127.0.0.1', resolve);
        });
        return `127.0.0.1:${port}`;
      } catch (err) {
        if (err.code !== 'EADDRINUSE' || attempt >= 4) throw err;
      }
    }
  }

  function close() {
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  return { hooks, handle, listen, close, get up() { return up; } };
}
