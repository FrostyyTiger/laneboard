// The room link /api/cockpit/ws (spec protocols.md §2.1-§2.2, §3.1;
// security.md §2.3, S-SEC-06; D135, D182, D212): its upgrade checks
// (server/cockpit/link-checks.mjs), the prompt's audit line
// (server/cockpit/audit-lines.mjs), the link itself in-process against a
// stand-in session (server/cockpit/link.mjs), then S-SEC-06 through a real
// board and room in one process.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import WebSocket from 'ws';

import { boot, control, ingressWs, ROOM_UNDER_TEST, ROOT } from './helpers/boot.mjs';
import { classify } from '../server/fleet/auth.mjs';
import { linkRefusal, MAX_LINKS, secureOrigin } from '../server/cockpit/link-checks.mjs';
import { createFailWarner, newLine, promptLine, stopLine } from '../server/cockpit/audit-lines.mjs';
import {
  createLink, cutForSnapshot, snapshotParts, languageList, PART_MAX_BYTES, TURN_MAX_BYTES,
  HEARTBEAT_MS, HELLO_MS, INBOUND_PER_SEC, MAX_BINARY_BYTES, MAX_TEXT_BYTES, REPLAY_MAX,
} from '../server/cockpit/link.mjs';
import * as clockMod from '../server/cockpit/clock.mjs';
import { setFaults } from '../server/cockpit/faults.mjs';
import { checkMessage } from '../server/cockpit/protocol.mjs';
import { argsHashOf, openAudit } from '../server/fleet/audit.mjs';

// --- the upgrade checks (link-checks.mjs) -----------------------------------

const PORT = 7801;
const CFG = { port: PORT };

function req({ headers = {}, auth, remoteAddress = '127.0.0.1' } = {}) {
  const h = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const r = {
    method: 'GET', url: '/api/cockpit/ws', headers: h,
    rawHeaders: Object.entries(h).flatMap(([k, v]) => [k, v]),
    // remoteAddress null: a socket that reports none.
    socket: { localPort: PORT, ...(remoteAddress === null ? {} : { remoteAddress }) },
  };
  r.auth = auth === undefined ? classify(r, CFG, {}) : auth;
  return r;
}

test('link checks: a loopback page of the board opens (local, D212)', () => {
  assert.equal(linkRefusal(req(), { config: CFG }), null);
});

test('link checks: Host, Origin and Sec-Fetch-Site close 4403 with their reason (screens.md §6.2)', () => {
  assert.deepEqual(linkRefusal(req({ headers: { host: 'evil.example.invalid' } }), { config: CFG }), { code: 4403, reason: 'bad-host' });
  assert.deepEqual(linkRefusal(req({ headers: { origin: 'https://evil.example.invalid' } }), { config: CFG }), { code: 4403, reason: 'bad-origin' });
  assert.deepEqual(linkRefusal(req({ headers: { origin: 'null' } }), { config: CFG }), { code: 4403, reason: 'bad-origin' });
  assert.deepEqual(linkRefusal(req({ headers: { origin: undefined } }), { config: CFG }), { code: 4403, reason: 'no-origin' });
  assert.deepEqual(linkRefusal(req({ headers: { 'sec-fetch-site': 'same-site' } }), { config: CFG }), { code: 4403, reason: 'sec-fetch-site' });
  assert.deepEqual(linkRefusal(req({ headers: { 'sec-fetch-site': 'cross-site' } }), { config: CFG }), { code: 4403, reason: 'sec-fetch-site' });
  assert.equal(linkRefusal(req({ headers: { 'sec-fetch-site': 'same-origin' } }), { config: CFG }), null);
  assert.equal(linkRefusal(req({ headers: { 'sec-fetch-site': 'none' } }), { config: CFG }), null);
});

test('link checks: a plain-HTTP Origin off loopback is 4403 insecure-origin unless cockpit.allowInsecure is true (D182)', () => {
  const cfg = { port: PORT, fleet: { allowedOrigins: ['http://desk.example.invalid:7777'] } };
  const r = req({ headers: { origin: 'http://desk.example.invalid:7777' } });
  assert.deepEqual(linkRefusal(r, { config: cfg }), { code: 4403, reason: 'insecure-origin' });
  assert.deepEqual(linkRefusal(r, { config: cfg, allowInsecure: 'true' }), { code: 4403, reason: 'insecure-origin' }, 'only exactly true');
  assert.equal(linkRefusal(r, { config: cfg, allowInsecure: true }), null);
  for (const o of ['https://hub.example.invalid', 'http://127.0.0.1:7777', 'http://localhost:7777', 'http://[::1]:7777', 'http://127.1.2.3']) assert.equal(secureOrigin(o, '127.0.0.1'), true, o);
  for (const o of ['http://hub.example.invalid', 'ws://127.0.0.1', 'file:///x', 'nonsense', '']) assert.equal(secureOrigin(o, '127.0.0.1'), false, o);
  // The loopback of plain http is the TCP peer's, not the Origin text's.
  assert.equal(secureOrigin('https://hub.example.invalid', '192.0.2.5'), true, 'https needs no loopback peer');
  for (const a of ['192.0.2.5', '::ffff:192.0.2.5', undefined, '', 'nonsense']) assert.equal(secureOrigin('http://127.0.0.1:7777', a), false, String(a));
  for (const a of ['127.0.0.1', '127.9.8.7', '::1', '::ffff:127.0.0.1']) assert.equal(secureOrigin('http://127.0.0.1:7777', a), true, a);
});

test('link checks: an http loopback Origin from a LAN peer is 4403 insecure-origin, before the credential (D182, B-T52)', () => {
  const r = req({ remoteAddress: '192.0.2.5' });
  assert.equal(r.auth?.kind, 'local', 'the board classifies it local (no fleet block)');
  assert.deepEqual(linkRefusal(r, { config: CFG }), { code: 4403, reason: 'insecure-origin' });
  // With allowInsecure the scheme check passes, and the loopback-peer rule of `local` still refuses.
  assert.deepEqual(linkRefusal(r, { config: CFG, allowInsecure: true }), { code: 4401, reason: 'unpaired' });
});

test('link checks: the 33rd link is 4503 too-many-links (§8)', () => {
  assert.equal(linkRefusal(req(), { config: CFG, links: MAX_LINKS - 1 }), null);
  assert.deepEqual(linkRefusal(req(), { config: CFG, links: MAX_LINKS }), { code: 4503, reason: 'too-many-links' });
});

test('link checks: without a board classification of local or direct the link is 4401 (D212)', () => {
  assert.deepEqual(linkRefusal(req({ auth: null }), { config: CFG }), { code: 4401, reason: 'unpaired' });
  // A look-alike object the auth module did not issue is no credential.
  assert.deepEqual(linkRefusal(req({ auth: { kind: 'local', user: 'local' } }), { config: CFG }), { code: 4401, reason: 'unpaired' });
  assert.deepEqual(linkRefusal(req({ auth: { kind: 'hub', user: null } }), { config: CFG }), { code: 4401, reason: 'unpaired' });
});

test('link checks: an issued local auth needs a loopback TCP peer (security.md §2.3 point 2, D212)', () => {
  const https = { origin: `https://127.0.0.1:${PORT}` };
  const cfg = { port: PORT, fleet: { allowedOrigins: [`https://127.0.0.1:${PORT}`] } };
  for (const a of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) {
    const r = req({ headers: https, remoteAddress: a });
    assert.equal(r.auth?.kind, 'local', a);
    assert.equal(linkRefusal(r, { config: cfg }), null, a);
  }
  for (const a of ['192.0.2.5', '::ffff:192.0.2.5', '2001:db8::5', null, 'nonsense']) {
    const r = req({ headers: https, remoteAddress: a });
    // Classify on a loopback request, then swap the peer: the issued object stays a `local` auth.
    const issued = req({ headers: https }).auth;
    r.auth = issued;
    assert.equal(r.auth.kind, 'local');
    assert.deepEqual(linkRefusal(r, { config: cfg }), { code: 4401, reason: 'unpaired' }, String(a));
  }
});

// --- the prompt's audit line (audit-lines.mjs) ------------------------------

function tmpDir(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-link-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('audit: cockpit.prompt as screens.md §6.4 writes it: user board, via cockpit, the turn, the words only hashed', (t) => {
  const file = path.join(tmpDir(t), 'audit', 'audit.jsonl');
  const audit = openAudit({ file, builder: 'builder-a' });
  t.after(() => audit.close());
  assert.deepEqual(promptLine(audit, { turnId: 't-0132', text: 'how did the night go?', result: { ok: true, source: 'typed', delivery: 'new', chars: 21 } }), { ok: true });
  assert.deepEqual(promptLine(audit, { turnId: 't-0133', text: 'and now?', result: { ok: false, status: 'agent-down' } }), { ok: true });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('night'), 'the words never reach the log');
  const [a, b] = raw.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(a.user, 'board');
  assert.equal(a.via, 'cockpit');
  assert.equal(a.action, 'cockpit.prompt');
  assert.equal(a.target, 't-0132');
  assert.equal(a.builder, 'builder-a');
  assert.match(a.argsHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.result, { ok: true, source: 'typed', delivery: 'new', chars: 21 });
  assert.equal(b.target, '-', 'a refusal has no turn');
  assert.deepEqual(b.result, { ok: false, status: 'agent-down' });
});

test('audit: no log, or an append that throws, is a failure the caller refuses on (D166)', () => {
  assert.equal(promptLine(null, { text: 'x', result: { ok: true } }).ok, false);
  const broken = { append() { const e = new Error('chain'); e.code = 'AUDIT_CHAIN_INVALID'; throw e; } };
  assert.deepEqual(promptLine(broken, { text: 'x', result: { ok: true } }), { ok: false, reason: 'AUDIT_CHAIN_INVALID' });
});

test('audit: cockpit.stop and cockpit.new as screens.md §6.4 writes them (T30)', (t) => {
  const file = path.join(tmpDir(t), 'audit', 'audit.jsonl');
  const audit = openAudit({ file, builder: 'builder-a' });
  t.after(() => audit.close());
  assert.deepEqual(stopLine(audit, { turnId: 't-0132', cancelQueued: true }), { ok: true });
  assert.deepEqual(newLine(audit, { conversation: 'c-0008', from: 'c-0007', stoppedTurn: 't-0139', reason: 'owner' }), { ok: true });
  assert.deepEqual(newLine(audit, { conversation: 'c-0009', from: 'c-0008', reason: 'forced' }), { ok: true });
  assert.deepEqual(newLine(audit, { conversation: 'c-0010', from: 'c-0009' }), { ok: true });
  const [stop, owner, forced, idle] = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([stop.user, stop.via, stop.action, stop.target], ['board', 'cockpit', 'cockpit.stop', 't-0132']);
  assert.deepEqual(stop.result, { ok: true, cancelQueued: true });
  assert.equal(stop.argsHash, argsHashOf({}));
  assert.deepEqual([owner.user, owner.action, owner.target], ['board', 'cockpit.new', 'c-0008']);
  assert.deepEqual(owner.result, { ok: true, from: 'c-0007', stoppedTurn: 't-0139' });
  assert.deepEqual([forced.user, forced.target], ['room', 'c-0009'], 'a forced fresh start is the room\'s own');
  assert.deepEqual(forced.result, { ok: true, from: 'c-0008', reason: 'forced' });
  assert.deepEqual(idle.result, { ok: true, from: 'c-0009', stoppedTurn: null }, 'null when idle');
  assert.equal(audit.verifyAll().ok, true);
});

test('audit: a failed append that does not refuse is one line at most every 10 s, the rest counted (§6.4)', () => {
  const out = [];
  let now = 1_000;
  const warn = createFailWarner({ write: (l) => out.push(l), now: () => now });
  assert.equal(warn('cockpit.stop', 'AUDIT_DETACHED'), true);
  now += 7_000;
  assert.equal(warn('cockpit.prompt', 'AUDIT_DETACHED'), false);
  now += 2_999;
  assert.equal(warn('cockpit.new', 'AUDIT_DETACHED'), false);
  now += 1;
  assert.equal(warn('cockpit.stop', 'AUDIT_DETACHED'), true);
  assert.deepEqual(out, [
    'cockpit: audit append failed for cockpit.stop: AUDIT_DETACHED',
    'cockpit: audit append failed for cockpit.stop: AUDIT_DETACHED (2 more since the last line)',
  ]);
});

// --- snapshots (§2.2, D140) -------------------------------------------------

const turnOf = (n, extra = {}) => ({
  turnId: `t-${String(n).padStart(4, '0')}`, clientId: null, source: 'typed', lang: null, about: null,
  prompt: `prompt ${n}`, at: '2026-10-27T07:00:04+01:00', state: 'done',
  items: [{ kind: 'text', blockIndex: 0, text: `reply ${n}` }],
  end: { state: 'done', at: '2026-10-27T07:00:12+01:00' }, ...extra,
});
const SNAP = { seq: 7, conversation: 'c-0001', startedAt: '2026-10-27T06:12:00+01:00' };

test('snapshot: the last 50 turns, olderTurns the rest, every part valid alone', () => {
  const turns = Array.from({ length: 62 }, (_, i) => turnOf(i + 1));
  const parts = snapshotParts({ ...SNAP, turns });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].turns.length, 50);
  assert.equal(parts[0].turns[0].turnId, 't-0013');
  assert.equal(parts[0].olderTurns, 12);
  assert.deepEqual(checkMessage(parts[0], 'out'), { ok: true });
  assert.deepEqual(snapshotParts({ ...SNAP, turns: [] })[0].turns, []);
});

test('snapshot: frames of at most 512 KB, cut between turns, oldest first; an oversize turn is cut for the snapshot only', () => {
  const big = (n) => turnOf(n, { items: [{ kind: 'text', blockIndex: 0, text: 'x'.repeat(200_000) }] });
  const turns = [big(1), big(2), big(3), big(4)];
  const parts = snapshotParts({ ...SNAP, turns });
  assert.ok(parts.length >= 2);
  assert.deepEqual(parts.flatMap((p) => p.turns.map((t) => t.turnId)), ['t-0001', 't-0002', 't-0003', 't-0004']);
  for (const p of parts) {
    assert.ok(Buffer.byteLength(JSON.stringify(p)) <= PART_MAX_BYTES, `part ${p.part}`);
    assert.equal(p.parts, parts.length);
    assert.deepEqual(checkMessage(p, 'out'), { ok: true }, `part ${p.part}`);
  }
  const huge = turnOf(9, {
    items: [
      { kind: 'tool', blockIndex: 0, toolUseId: 'tu-01', tool: 'Read', input: { path: 'y'.repeat(100) }, startedAt: '2026-10-27T07:00:05+01:00', endedAt: '2026-10-27T07:00:06+01:00', isError: false },
      { kind: 'text', blockIndex: 1, text: 'z'.repeat(600_000) },
    ],
  });
  const cut = cutForSnapshot(huge);
  assert.ok(Buffer.byteLength(JSON.stringify(cut)) <= TURN_MAX_BYTES);
  assert.deepEqual(cut.items[0].input, { '…': 'cut' });
  assert.equal(cut.items[1].text, `… ${'z'.repeat(4000)}`);
  assert.equal(huge.items[1].text.length, 600_000, 'the room keeps the whole turn');
  assert.equal(cutForSnapshot(turnOf(1)).items[0].text, 'reply 1', 'a small turn is left as it is');
});

test('welcome languages: cockpit.stt.language as a list', () => {
  assert.deepEqual(languageList(['en', 'de']), ['en', 'de']);
  assert.deepEqual(languageList('de'), ['de']);
  assert.deepEqual(languageList('auto'), ['auto']);
  assert.deepEqual(languageList(undefined), ['auto']);
});

// --- the link in-process, against a stand-in session ------------------------

/** A session as link.mjs sees it: phase, the bridge's turn and counter, prompt/stop/new. */
function standInSession() {
  const s = {
    phase: 'up', conversation: 'c-0003', startedAt: '2026-10-27T06:12:00+01:00',
    prompts: [], emit: null,
    bridge: { turn: null, turnCount: 41 },
    async prompt(p) {
      s.prompts.push(p);
      const delivery = s.bridge.turn ? 'queued' : 'new';
      if (!s.bridge.turn) { s.bridge.turnCount += 1; s.bridge.turn = { turnId: `t-${String(s.bridge.turnCount).padStart(4, '0')}` }; }
      const turnId = s.bridge.turn.turnId;
      s.emit({ type: 'turn.prompt', turnId, clientId: p.clientId, screen: p.screen, text: p.text, source: p.source, lang: p.lang, about: p.about, at: '2026-10-27T07:02:04.130+01:00', receivedAt: p.receivedAt, delivery });
      return { ok: true, turnId, delivery };
    },
    stopping: null, // session.mjs's getter: the stop that runs, {turnId}
    stop: (id) => {
      if (s.bridge.turn?.turnId !== id) return { ok: false, code: 'unknown-id' };
      s.stopping ??= { turnId: id };
      return { ok: true };
    },
    newConversation: () => ({ ok: false, code: 'not-now' }),
  };
  return s;
}

function standInStore(turns = []) {
  const applied = [];
  return { applied, apply: (m) => applied.push(m), turns: () => turns, conversation: 'c-0003', startedAt: '2026-10-27T06:12:00+01:00' };
}

async function inProcess(t, { session = standInSession(), store = standInStore(), audit, clientIds, pingMs } = {}) {
  const lines = [];
  const auditLog = audit === undefined ? { entries: [], append(e) { this.entries.push(e); return e; } } : audit;
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const config = { port, cockpit: { stt: { url: 'none', language: ['en', 'de'] } } };
  const link = createLink({ session, store, audit: auditLog, config, log: (l) => lines.push(l), clientIds, pingMs });
  session.emit = link.emit;
  server.on('upgrade', (r, socket, head) => {
    r.auth = r.headers['x-test-no-auth'] ? null : classify(r, config, {});
    if (!link.handleUpgrade(r, socket, head, new URL(r.url, 'http://x'))) socket.destroy();
  });
  t.after(() => { link.close(); server.close(); });
  const open = (origin = `http://127.0.0.1:${port}`, opts = {}) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cockpit/ws`, { origin, ...opts });
    const frames = [];
    ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
    t.after(() => ws.terminate());
    return { ws, frames };
  };
  return { link, session, store, audit: auditLog, lines, open, port };
}

async function until(pred, what, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const HELLO = { type: 'hello', seq: 1, page: 'app', protocol: 1 };
const PROMPT = {
  type: 'prompt', seq: 2, clientId: 'p-3c1e0b2a', text: '  how did the night go?  ', source: 'typed', lang: null, about: null,
  sentAt: 1793080924120, focus: { page: 'wall', route: { view: 'wall' }, wallState: 'tour', layout: 'split', pane: 'open', inSight: [] },
};

test('link: hello → welcome then one snapshot, both valid; nothing before the hello', async (t) => {
  const store = standInStore([turnOf(40), turnOf(41)]);
  const room = await inProcess(t, { store });
  const c = room.open();
  await once(c.ws, 'open');
  c.ws.send(JSON.stringify(PROMPT)); // before the hello: dropped
  room.link.emit({ type: 'status', status: null }); // seq 1, to no link yet
  c.ws.send(JSON.stringify(HELLO));
  await until(() => c.frames.length >= 2, 'welcome and snapshot');
  const [welcome, snap] = c.frames;
  assert.deepEqual(checkMessage(welcome, 'out'), { ok: true });
  assert.equal(welcome.type, 'welcome');
  assert.equal(welcome.re, 1);
  assert.equal(welcome.protocol, 1);
  assert.equal(welcome.screen, 'board');
  assert.match(welcome.epoch, /^r-[0-9a-f]{6}$/);
  assert.equal(welcome.seq, 1);
  assert.equal(welcome.conversation, 'c-0003');
  assert.equal(welcome.resume, 'snapshot');
  assert.deepEqual(welcome.config, { stt: 'none', languages: ['en', 'de'], maxPromptChars: 8000 });
  assert.equal(welcome.status, null);
  assert.equal(snap.type, 'snapshot');
  assert.equal(snap.seq, 1);
  assert.deepEqual(snap.turns.map((x) => x.turnId), ['t-0040', 't-0041']);
  assert.deepEqual(checkMessage(snap, 'out'), { ok: true });
  assert.equal(room.session.prompts.length, 0, 'the prompt before the hello never reached the session');
});

test('link: a prompt is audited, then echoed to every link with seq (§3.1); its turn messages follow', async (t) => {
  const room = await inProcess(t);
  const a = room.open();
  const b = room.open();
  await Promise.all([once(a.ws, 'open'), once(b.ws, 'open')]);
  for (const c of [a, b]) c.ws.send(JSON.stringify(HELLO));
  await until(() => a.frames.length >= 2 && b.frames.length >= 2, 'both welcomed');
  a.ws.send(JSON.stringify(PROMPT));
  await until(() => b.frames.some((f) => f.type === 'turn.prompt'), 'the echo on the other link');
  const echo = b.frames.find((f) => f.type === 'turn.prompt');
  assert.deepEqual(checkMessage(echo, 'out'), { ok: true });
  assert.equal(echo.seq, 1);
  assert.equal(echo.turnId, 't-0042', 'the next turn after the bridge counter');
  assert.equal(echo.text, 'how did the night go?');
  assert.equal(echo.delivery, 'new');
  assert.ok(a.frames.some((f) => f.type === 'turn.prompt' && f.seq === 1), 'the sender gets it too');
  assert.equal(room.session.prompts[0].text, 'how did the night go?');
  assert.equal(room.session.prompts[0].screen, 'board');
  assert.equal(room.audit.entries.length, 1);
  assert.deepEqual(room.audit.entries[0], {
    user: 'board', via: 'cockpit', action: 'cockpit.prompt', target: 't-0042',
    args: { text: 'how did the night go?' }, result: { ok: true, source: 'typed', delivery: 'new', chars: 21 },
  });
  assert.equal(room.store.applied[0].type, 'turn.prompt', 'the store folds every message');
  room.link.emit({ type: 'turn.state', turnId: 't-0042', state: 'thinking' });
  await until(() => a.frames.some((f) => f.type === 'turn.state'), 'turn.state');
  assert.equal(a.frames.find((f) => f.type === 'turn.state').seq, 2);

  // A second prompt while the turn runs is `queued` in the running turn.
  b.ws.send(JSON.stringify({ ...PROMPT, seq: 2, clientId: 'p-77aa01c3', text: 'only the failed one' }));
  await until(() => a.frames.filter((f) => f.type === 'turn.prompt').length === 2, 'the queued echo');
  const queued = a.frames.filter((f) => f.type === 'turn.prompt')[1];
  assert.equal(queued.delivery, 'queued');
  assert.equal(queued.turnId, 't-0042');
  assert.equal(room.audit.entries[1].target, 't-0042');
  assert.equal(room.audit.entries[1].result.delivery, 'queued');
});

test('link: a known clientId starts nothing; the same echo to that link only, without seq (D95)', async (t) => {
  const room = await inProcess(t);
  const a = room.open();
  const b = room.open();
  await Promise.all([once(a.ws, 'open'), once(b.ws, 'open')]);
  for (const c of [a, b]) c.ws.send(JSON.stringify(HELLO));
  await until(() => a.frames.length >= 2 && b.frames.length >= 2, 'both welcomed');
  a.ws.send(JSON.stringify(PROMPT));
  await until(() => a.frames.some((f) => f.type === 'turn.prompt'), 'the echo');
  a.ws.send(JSON.stringify({ ...PROMPT, seq: 3 }));
  await until(() => a.frames.filter((f) => f.type === 'turn.prompt').length === 2, 'the repeat');
  const [first, repeat] = a.frames.filter((f) => f.type === 'turn.prompt');
  const { seq, ...rest } = first;
  assert.equal(seq, 1);
  assert.deepEqual(repeat, rest);
  assert.deepEqual(checkMessage(repeat, 'out'), { ok: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(b.frames.filter((f) => f.type === 'turn.prompt').length, 1, 'the other link saw one echo');
  assert.equal(room.session.prompts.length, 1);
  assert.equal(room.audit.entries.length, 1, 'once per prompt (screens.md §6.4)');
});

test('link: a clientId the room loaded from disk is known too (§11.7.1 step 6)', async (t) => {
  const store = standInStore([turnOf(41, { clientId: 'p-3c1e0b2a', at: new Date().toISOString() })]);
  const room = await inProcess(t, { store, clientIds: ['p-3c1e0b2a'] });
  const a = room.open();
  await once(a.ws, 'open');
  a.ws.send(JSON.stringify(HELLO));
  await until(() => a.frames.length >= 2, 'welcome');
  a.ws.send(JSON.stringify(PROMPT));
  await until(() => a.frames.some((f) => f.type === 'turn.prompt'), 'the repeat');
  const repeat = a.frames.find((f) => f.type === 'turn.prompt');
  assert.equal(repeat.turnId, 't-0041');
  assert.equal(repeat.seq, undefined);
  assert.equal(room.session.prompts.length, 0);
});

test('link: no session up is prompt.refused agent-down, audited as refused; a log that fails refuses audit-unavailable (D166)', async (t) => {
  const session = standInSession();
  session.phase = 'down';
  const room = await inProcess(t, { session });
  const a = room.open();
  await once(a.ws, 'open');
  a.ws.send(JSON.stringify(HELLO));
  await until(() => a.frames.length >= 2, 'welcome');
  a.ws.send(JSON.stringify(PROMPT));
  await until(() => a.frames.some((f) => f.type === 'prompt.refused'), 'the refusal');
  const r = a.frames.find((f) => f.type === 'prompt.refused');
  assert.deepEqual(r, { type: 'prompt.refused', re: 2, clientId: 'p-3c1e0b2a', code: 'agent-down' });
  assert.deepEqual(checkMessage(r, 'out'), { ok: true });
  assert.equal(room.audit.entries[0].target, '-');
  assert.deepEqual(room.audit.entries[0].result, { ok: false, status: 'agent-down' });

  const broken = await inProcess(t, { audit: { append() { throw Object.assign(new Error('x'), { code: 'AUDIT_FAILED' }); } } });
  const b = broken.open();
  await once(b.ws, 'open');
  b.ws.send(JSON.stringify(HELLO));
  await until(() => b.frames.length >= 2, 'welcome');
  b.ws.send(JSON.stringify(PROMPT));
  await until(() => b.frames.some((f) => f.type === 'prompt.refused'), 'the refusal');
  assert.equal(b.frames.find((f) => f.type === 'prompt.refused').code, 'audit-unavailable');
  assert.equal(broken.session.prompts.length, 0, 'nothing went to the agent');
  assert.ok(broken.lines.some((l) => l === 'cockpit: audit append failed for cockpit.prompt: AUDIT_FAILED'));
});

test('link: a stop of the running turn is audited before the session hears it; a refused stop writes nothing (§6.4, T30)', async (t) => {
  const session = standInSession();
  const order = [];
  const stop = session.stop;
  session.stop = (id) => { order.push(`stop ${id}`); return stop(id); };
  session.bridge.ready = { canCancelQueued: true };
  const room = await inProcess(t, { session });
  const append = room.audit.append.bind(room.audit);
  room.audit.append = (e) => { order.push(e.action); return append(e); };
  const a = await welcomed(room);
  a.ws.send(JSON.stringify(PROMPT));
  await until(() => a.frames.some((f) => f.type === 'turn.prompt'), 'the echo');
  a.ws.send(JSON.stringify({ type: 'stop', seq: 3, turnId: 't-0999' }));
  a.ws.send(JSON.stringify({ type: 'stop', seq: 4, turnId: 't-0042' }));
  await until(() => order.includes('stop t-0042'), 'the stop');
  assert.deepEqual(order, ['cockpit.prompt', 'stop t-0999', 'cockpit.stop', 'stop t-0042']);
  assert.deepEqual(room.audit.entries[1], {
    user: 'board', via: 'cockpit', action: 'cockpit.stop', target: 't-0042', args: {}, result: { ok: true, cancelQueued: true },
  });
});

test('link: three stop frames for one running turn are one cockpit.stop line; with a failing log the stop still runs (D165, T60)', async (t) => {
  const session = standInSession();
  const stops = [];
  const stop = session.stop;
  session.stop = (id) => { stops.push(id); return stop(id); };
  const room = await inProcess(t, { session });
  const a = await welcomed(room);
  a.ws.send(JSON.stringify(PROMPT));
  await until(() => a.frames.some((f) => f.type === 'turn.prompt'), 'the echo');
  for (const seq of [3, 4, 5]) a.ws.send(JSON.stringify({ type: 'stop', seq, turnId: 't-0042' }));
  await until(() => stops.length === 3, 'the three stops');
  assert.deepEqual(room.audit.entries.map((e) => e.action), ['cockpit.prompt', 'cockpit.stop'], 'one line for the one stop');
  assert.equal(a.frames.filter((f) => f.type === 'error').length, 0, 'each frame answered ok');

  const failing = standInSession();
  failing.bridge.turn = { turnId: 't-0041' };
  const ran = [];
  const stop2 = failing.stop;
  failing.stop = (id) => { ran.push(id); return stop2(id); };
  let tries = 0;
  const audit = { append() { tries += 1; throw Object.assign(new Error('x'), { code: 'AUDIT_DETACHED' }); } };
  const broken = await inProcess(t, { session: failing, audit });
  const b = await welcomed(broken);
  for (const seq of [2, 3, 4]) b.ws.send(JSON.stringify({ type: 'stop', seq, turnId: 't-0041' }));
  await until(() => ran.length === 3, 'the three stops');
  assert.equal(failing.stopping?.turnId, 't-0041', 'the stop runs although the log failed');
  assert.equal(tries, 1, 'one try at the line, not one per frame');
});

test('link: a stop and a new run although the log fails, with one stderr line (D166); the new line once the conversation is up', async (t) => {
  const session = standInSession();
  session.bridge.turn = { turnId: 't-0041' };
  let renewed = 0;
  session.newConversation = () => { renewed += 1; return { ok: true }; };
  const stops = [];
  session.stop = (id) => { stops.push(id); return { ok: true }; };
  let failing = true;
  const entries = [];
  const audit = { entries, append(e) { if (failing) throw Object.assign(new Error('x'), { code: 'AUDIT_DETACHED' }); entries.push(e); return e; } };
  const room = await inProcess(t, { session, audit });
  const a = await welcomed(room);
  a.ws.send(JSON.stringify({ type: 'stop', seq: 2, turnId: 't-0041' }));
  a.ws.send(JSON.stringify({ type: 'new', seq: 3 }));
  await until(() => stops.length === 1 && renewed === 1, 'stop and new reached the session');
  assert.deepEqual(room.lines.filter((l) => l.startsWith('cockpit: audit')), ['cockpit: audit append failed for cockpit.stop: AUDIT_DETACHED']);
  assert.equal(a.frames.filter((f) => f.type === 'error').length, 0, 'nothing shown on the screens');

  failing = false;
  room.link.conversationStarted({ conversation: 'c-0004', reason: 'owner', from: 'c-0003' });
  room.link.conversationStarted({ conversation: 'c-0005', reason: 'forced', from: 'c-0004' });
  room.link.conversationStarted({ conversation: 'c-0001', reason: null, from: null });
  assert.deepEqual(entries.map((e) => [e.user, e.action, e.target, e.result]), [
    ['board', 'cockpit.new', 'c-0004', { ok: true, from: 'c-0003', stoppedTurn: 't-0041' }],
    ['room', 'cockpit.new', 'c-0005', { ok: true, from: 'c-0004', reason: 'forced' }],
  ], 'the first conversation of a room is no new');
});

test('link: bad messages are error bad-message / unknown-type with re; stop and new answer the session\'s codes', async (t) => {
  const room = await inProcess(t);
  const a = room.open();
  await once(a.ws, 'open');
  a.ws.send(JSON.stringify(HELLO));
  await until(() => a.frames.length >= 2, 'welcome');
  a.ws.send(JSON.stringify({ ...PROMPT, seq: 5, text: '   ' }));
  a.ws.send(JSON.stringify({ type: 'nonsense', seq: 6 }));
  a.ws.send(JSON.stringify({ type: 'stop', seq: 7, turnId: 't-0999' }));
  a.ws.send(JSON.stringify({ type: 'new', seq: 8 }));
  a.ws.send(JSON.stringify({ type: 'hello', seq: 9, page: 'app', protocol: 1 }));
  await until(() => a.frames.filter((f) => f.type === 'error').length === 5, 'five errors');
  const errors = a.frames.filter((f) => f.type === 'error');
  for (const e of errors) assert.deepEqual(checkMessage(e, 'out'), { ok: true });
  assert.deepEqual(errors.map((e) => [e.re, e.code]), [[5, 'bad-message'], [6, 'unknown-type'], [7, 'unknown-id'], [8, 'not-now'], [9, 'not-now']]);
  assert.equal(errors[0].message, 'prompt.text: empty');
  assert.equal(room.session.prompts.length, 0);
});

test('link: another protocol closes 4002 `protocol 2`; a refused upgrade gets its close and no frame', async (t) => {
  const room = await inProcess(t);
  const a = room.open();
  await once(a.ws, 'open');
  a.ws.send(JSON.stringify({ ...HELLO, protocol: 2 }));
  const [code, reason] = await once(a.ws, 'close');
  assert.equal(code, 4002);
  assert.equal(reason.toString(), 'protocol 2');
  assert.deepEqual(a.frames, []);

  const evil = room.open('https://evil.example.invalid');
  evil.ws.on('open', () => evil.ws.send(JSON.stringify(HELLO)));
  const [c2, r2] = await once(evil.ws, 'close');
  assert.equal(c2, 4403);
  assert.equal(r2.toString(), 'bad-origin');
  assert.deepEqual(evil.frames, [], 'no welcome, nothing of the conversation');
  assert.equal(room.link.count, 0, 'never counted');
});

// --- T14: seq, resume, heartbeat and silence, close codes (§2.2-§2.3, §8) ----

/** The room's clock as a manual test clock for this test; the real one after. */
function manualClock(t) {
  const clock = clockMod.createTestClock({ start: Date.parse('2026-10-27T07:00:00+01:00') });
  clock.setMode('manual');
  clockMod.setClock(clock);
  t.after(() => clockMod.setClock(null));
  return clock;
}

/** Opened and welcomed with this hello; resolves when the welcome is in. */
async function welcomed(room, hello = HELLO) {
  const c = room.open();
  await once(c.ws, 'open');
  c.ws.send(JSON.stringify(hello));
  await until(() => c.frames.some((f) => f.type === 'welcome'), 'welcome');
  return c;
}

const closed = async (ws) => {
  const [code, reason] = await once(ws, 'close');
  return [code, reason.toString()];
};
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('seq: one counter for every link, +1 per session message; answers to one link carry none (§2.1)', async (t) => {
  const room = await inProcess(t);
  const a = await welcomed(room);
  const b = await welcomed(room);
  for (const state of ['thinking', 'working', 'answering']) room.link.emit({ type: 'turn.state', turnId: 't-0042', state });
  await until(() => a.frames.length >= 5 && b.frames.length >= 5, 'three states each');
  for (const c of [a, b]) assert.deepEqual(c.frames.filter((f) => f.type === 'turn.state').map((f) => f.seq), [1, 2, 3]);
  a.ws.send(JSON.stringify({ type: 'stop', seq: 2, turnId: 't-0999' }));
  await until(() => a.frames.some((f) => f.type === 'error'), 'the error');
  assert.equal(a.frames.find((f) => f.type === 'error').seq, undefined);
  assert.equal(room.link.seq, 3);
});

test('resume without a gap: the same epoch and a kept lastSeq get welcome `replay` and exactly the missed messages', async (t) => {
  const room = await inProcess(t);
  const a = await welcomed(room);
  const epoch = a.frames[0].epoch;
  room.link.emit({ type: 'turn.state', turnId: 't-0042', state: 'thinking' }); // seq 1
  await until(() => a.frames.some((f) => f.seq === 1 && f.type === 'turn.state'), 'seq 1');
  a.ws.close(1000, 'bye');
  await once(a.ws, 'close');
  room.link.emit({ type: 'turn.state', turnId: 't-0042', state: 'working' }); // seq 2, while away
  room.link.emit({ type: 'status', status: null }); // seq 3
  const back = await welcomed(room, { ...HELLO, epoch, lastSeq: 1 });
  await until(() => back.frames.length >= 3, 'the replay');
  await settle();
  const [welcome, ...rest] = back.frames;
  assert.deepEqual(checkMessage(welcome, 'out'), { ok: true });
  assert.equal(welcome.resume, 'replay');
  assert.equal(welcome.seq, 3);
  assert.deepEqual(rest.map((f) => [f.seq, f.type]), [[2, 'turn.state'], [3, 'status']], 'no snapshot, nothing applied twice');
  // Up to date: replay of nothing.
  const same = await welcomed(room, { ...HELLO, epoch, lastSeq: 3 });
  await settle();
  assert.equal(same.frames[0].resume, 'replay');
  assert.deepEqual(same.frames.slice(1), []);
  // Later messages reach the resumed links as usual.
  room.link.emit({ type: 'status', status: null });
  await until(() => back.frames.some((f) => f.seq === 4) && same.frames.some((f) => f.seq === 4), 'seq 4 on both');
});

test('resume with a gap: a message dropped to every link still counts and replays; too far behind, another epoch or a fresh page get a snapshot', async (t) => {
  const room = await inProcess(t);
  t.after(() => setFaults(null));
  const a = await welcomed(room);
  const epoch = a.frames[0].epoch;
  room.link.emit({ type: 'turn.state', turnId: 't-0042', state: 'thinking' }); // seq 1
  setFaults({ outbound: (m, l) => l === null && m.type === 'turn.end' });
  room.link.emit({ type: 'turn.end', turnId: 't-0042', state: 'done', at: '2026-10-27T07:00:12+01:00' }); // seq 2, to no link
  setFaults(null);
  room.link.emit({ type: 'status', status: null }); // seq 3
  await until(() => a.frames.some((f) => f.seq === 3), 'seq 3');
  assert.deepEqual(a.frames.filter((f) => f.seq).map((f) => f.seq), [1, 3], 'the screen sees a gap');
  // §2.2: the screen closes 4000 `gap`; the room takes the close as any other.
  a.ws.close(4000, 'gap');
  await once(a.ws, 'close');
  await until(() => room.link.count === 0, 'the link gone');
  // Reconnecting with the last applied seq before the gap replays from it.
  const r = await welcomed(room, { ...HELLO, epoch, lastSeq: 1 });
  await until(() => r.frames.length >= 3, 'the replay');
  assert.deepEqual(r.frames.slice(1).map((f) => [f.seq, f.type]), [[2, 'turn.end'], [3, 'status']]);
  // A fresh page (no epoch), another epoch, a lastSeq the room never sent: one snapshot.
  for (const hello of [HELLO, { ...HELLO, epoch: 'r-000000', lastSeq: 1 }, { ...HELLO, epoch, lastSeq: 99 }]) {
    const c = await welcomed(room, hello);
    await until(() => c.frames.length >= 2, 'the snapshot');
    assert.equal(c.frames[0].resume, 'snapshot', JSON.stringify(hello));
    assert.equal(c.frames[1].type, 'snapshot');
    assert.equal(c.frames[1].seq, 3);
  }
  // Too far behind: past the last 2 000 kept.
  for (let i = 0; i < REPLAY_MAX; i++) room.link.emit({ type: 'status', status: null });
  const far = await welcomed(room, { ...HELLO, epoch, lastSeq: 2 });
  await until(() => far.frames.length >= 2, 'the snapshot');
  assert.equal(far.frames[0].resume, 'snapshot');
  const near = await welcomed(room, { ...HELLO, epoch, lastSeq: 3 });
  await until(() => near.frames.length >= 1 + REPLAY_MAX, 'the whole replay');
  assert.equal(near.frames[0].resume, 'replay');
  assert.equal(near.frames[1].seq, 4);
  assert.equal(near.frames.at(-1).seq, 3 + REPLAY_MAX);
});

test('heartbeat every 10 s on the room clock, no seq; a silent link gets nothing and stays open (§2.2, D10, D139)', async (t) => {
  const clock = manualClock(t);
  const room = await inProcess(t);
  t.after(() => setFaults(null));
  const a = await welcomed(room);
  const before = a.frames.length;
  await clock.advance(HEARTBEAT_MS - 1);
  await settle();
  assert.equal(a.frames.length, before, 'nothing before 10 s');
  await clock.advance(1);
  await until(() => a.frames.length === before + 1, 'the heartbeat');
  const hb = a.frames.at(-1);
  assert.deepEqual(Object.keys(hb), ['type', 'at']);
  assert.equal(Date.parse(hb.at), Date.parse('2026-10-27T07:00:10+01:00'), 'the room clock\'s time');
  assert.deepEqual(checkMessage(hb, 'out'), { ok: true });
  await clock.advance(HEARTBEAT_MS * 2);
  await until(() => a.frames.filter((f) => f.type === 'heartbeat').length === 3, 'two more');
  // Silent (stand-ins.md §1.2 `POST /link {"up":"silent"}`): no heartbeat, no event, inbound dropped.
  setFaults({ inbound: () => true, outbound: () => true });
  const quiet = a.frames.length;
  await clock.advance(HEARTBEAT_MS * 3);
  room.link.emit({ type: 'status', status: null });
  a.ws.send(JSON.stringify({ type: 'stop', seq: 2, turnId: 't-0999' }));
  await settle(100);
  assert.equal(a.frames.length, quiet, 'the page sees only silence');
  assert.equal(a.ws.readyState, WebSocket.OPEN, 'and no close');
  setFaults(null);
  await clock.advance(HEARTBEAT_MS);
  await until(() => a.frames.length === quiet + 1 && a.frames.at(-1).type === 'heartbeat', 'heartbeats again');
});

test('close 4001 `no hello`: 5 s after the open without a hello, on the room clock (§2.3)', async (t) => {
  const clock = manualClock(t);
  const room = await inProcess(t);
  const a = room.open();
  await once(a.ws, 'open');
  await clock.advance(HELLO_MS - 1);
  await settle();
  assert.equal(a.ws.readyState, WebSocket.OPEN);
  const done = closed(a.ws);
  await clock.advance(1);
  assert.deepEqual(await done, [4001, 'no hello']);
  // A hello in time keeps the link past 5 s.
  const b = await welcomed(room);
  await clock.advance(HELLO_MS * 2);
  await settle();
  assert.equal(b.ws.readyState, WebSocket.OPEN);
});

test('close 1001 `room stopping` on every link at shutdown (§2.3)', async (t) => {
  const room = await inProcess(t);
  const a = await welcomed(room);
  const b = room.open();
  await once(b.ws, 'open');
  const both = Promise.all([closed(a.ws), closed(b.ws)]);
  room.link.close();
  assert.deepEqual(await both, [[1001, 'room stopping'], [1001, 'room stopping']]);
});

test('close 4401 `unpaired`: no credential the room takes, right after the upgrade, no frame (§2.3, D212)', async (t) => {
  const room = await inProcess(t);
  const a = room.open(undefined, { headers: { 'x-test-no-auth': '1' } });
  a.ws.on('open', () => a.ws.send(JSON.stringify(HELLO)));
  assert.deepEqual(await closed(a.ws), [4401, 'unpaired']);
  assert.deepEqual(a.frames, []);
  assert.equal(room.link.count, 0);
});

test('close 4503 `too-many-links`: the 33rd link, never counted (§2.3, §8)', async (t) => {
  const room = await inProcess(t);
  const open = [];
  for (let i = 0; i < 32; i++) {
    const c = room.open();
    await once(c.ws, 'open');
    open.push(c);
  }
  assert.equal(room.link.count, 32);
  const extra = room.open();
  extra.ws.on('open', () => extra.ws.send(JSON.stringify(HELLO)));
  assert.deepEqual(await closed(extra.ws), [4503, 'too-many-links']);
  assert.deepEqual(extra.frames, []);
  assert.equal(room.link.count, 32);
  assert.ok(open.every((c) => c.ws.readyState === WebSocket.OPEN));
});

test('close 4413 `too big`: a text frame over 64 KB or a binary frame over 6 400 bytes; at the limit the link stays (§8)', async (t) => {
  const room = await inProcess(t);
  const a = await welcomed(room);
  // Exactly 64 KB is read (and answered, it is no message the room knows).
  const atLimit = JSON.stringify({ type: 'nonsense', seq: 2, pad: '' });
  a.ws.send(JSON.stringify({ type: 'nonsense', seq: 2, pad: 'x'.repeat(MAX_TEXT_BYTES - Buffer.byteLength(atLimit)) }));
  a.ws.send(Buffer.alloc(MAX_BINARY_BYTES));
  await until(() => a.frames.some((f) => f.type === 'error'), 'the 64 KB frame answered');
  assert.equal(a.frames.find((f) => f.type === 'error').code, 'unknown-type');
  const text = await welcomed(room);
  const t1 = closed(text.ws);
  text.ws.send('x'.repeat(MAX_TEXT_BYTES + 1));
  assert.deepEqual(await t1, [4413, 'too big']);
  const bin = await welcomed(room);
  const t2 = closed(bin.ws);
  bin.ws.send(Buffer.alloc(MAX_BINARY_BYTES + 1));
  assert.deepEqual(await t2, [4413, 'too big']);
  assert.equal(a.ws.readyState, WebSocket.OPEN);
});

test('close 4408 `too slow`: a link whose unsent data passes 4 MB (§8)', { timeout: 30_000 }, async (t) => {
  const room = await inProcess(t);
  const a = await welcomed(room);
  const b = await welcomed(room);
  a.ws._socket.pause(); // a screen that stops reading
  const done = closed(a.ws);
  const big = 'x'.repeat(500_000);
  for (let i = 0; i < 40 && room.link.count === 2 && !room.lines.some((l) => l.includes('4408')); i++) {
    room.link.emit({ type: 'text.delta', turnId: 't-0042', blockIndex: 0, text: big, sentAt: 1 });
    await settle(5);
  }
  assert.ok(room.lines.some((l) => /cockpit: link too slow \(\d+ bytes unsent\), closed 4408/.test(l)), room.lines.join('\n'));
  a.ws._socket.resume();
  assert.deepEqual(await done, [4408, 'too slow']);
  assert.equal(b.ws.readyState, WebSocket.OPEN, 'the reading link stays');
});

test('rate: over 50 messages a second is `error` `too-many`, dropped; the third pass in 60 s closes 4429 `too many` (§8)', { timeout: 15_000 }, async (t) => {
  const room = await inProcess(t);
  const a = await welcomed(room);
  const done = closed(a.ws);
  const burst = (from) => {
    for (let i = 0; i <= INBOUND_PER_SEC; i++) a.ws.send(JSON.stringify({ type: 'stop', seq: from + i, turnId: 't-0999' }));
  };
  burst(2);
  await until(() => a.frames.some((f) => f.code === 'too-many'), 'the first too-many');
  const tooMany = a.frames.filter((f) => f.code === 'too-many');
  assert.ok(tooMany.length >= 1);
  assert.deepEqual(checkMessage(tooMany[0], 'out'), { ok: true });
  assert.equal(room.session.prompts.length, 0);
  assert.equal(a.ws.readyState, WebSocket.OPEN, 'one pass: the link stays');
  await settle(1050);
  burst(200);
  await settle(1050);
  assert.equal(a.ws.readyState, WebSocket.OPEN, 'two passes: the link stays');
  burst(400);
  assert.deepEqual(await done, [4429, 'too many']);
});

test('close 1011 `internal`: an exception in the handler (§2.3)', async (t) => {
  const session = standInSession();
  session.stop = () => { throw new Error('boom'); };
  const room = await inProcess(t, { session });
  const a = await welcomed(room);
  const done = closed(a.ws);
  a.ws.send(JSON.stringify({ type: 'stop', seq: 2, turnId: 't-0042' }));
  assert.deepEqual(await done, [1011, 'internal']);
  assert.ok(room.lines.includes('cockpit: link handler failed: boom'));
});

test('ping: a link that does not answer the previous ping is dropped; one that answers stays (§2.2)', async (t) => {
  const room = await inProcess(t, { pingMs: 100 });
  const answers = await welcomed(room);
  const mute = room.open(undefined, { autoPong: false });
  await once(mute.ws, 'open');
  mute.ws.send(JSON.stringify(HELLO));
  const done = once(mute.ws, 'close');
  const [code] = await done;
  assert.equal(code, 1006, 'terminated, no close frame');
  assert.ok(room.lines.includes('cockpit: link did not answer its ping, dropped'));
  assert.equal(answers.ws.readyState, WebSocket.OPEN);
  // The room answers the screen's ping, except on a silent link.
  t.after(() => setFaults(null));
  const pong = once(answers.ws, 'pong');
  answers.ws.ping('a');
  assert.equal(String((await pong)[0]), 'a');
  setFaults({ outbound: () => true });
  let pongs = 0;
  answers.ws.on('pong', () => { pongs += 1; });
  answers.ws.ping('b');
  await settle(80);
  assert.equal(pongs, 0, 'a silent link answers no ping (stand-ins.md §1.2)');
});

// The close codes the room sends that C1 does not: 4402 `revoked` comes with pairing (Q-O21, `screens.md` §6).

// --- S-SEC-06 through a real board and room in one process -------------------

const FAKE = path.join(ROOT, 'test', 'cockpit', 'stand-ins', 'fake-agent.mjs');

test('S-SEC-06 Without pairing, only the board\'s own people get the room link (pending Q-O21)', { timeout: 60_000 }, async (t) => {
  const fakeDir = tmpDir(t);
  fs.copyFileSync(path.join(ROOT, 'test', 'cockpit', 'scripts', 'c1-render.json'), path.join(fakeDir, 'script.json'));
  const box = await boot({
    mode: 'builder', entry: ROOM_UNDER_TEST,
    config: {
      fleet: { id: 'builder-a', code: 'BA', publicHosts: ['hub.example.invalid'], allowedUsers: ['owner@example.invalid'] },
      cockpit: { agent: { command: [process.execPath, FAKE], env: ['FAKE_AGENT_DIR'], allowSameUser: true, loginCheck: null } },
    },
    env: { FAKE_AGENT_DIR: fakeDir },
  });
  t.after(() => box.stop());
  const connections = async () => (await control(box, 'GET', '/connections')).body.items;
  const welcomed = (ws) => new Promise((resolve, reject) => {
    const frames = [];
    const timer = setTimeout(() => reject(new Error(`no welcome within 1.0 s; frames ${JSON.stringify(frames)}`)), 1000);
    ws.on('message', (d) => {
      const f = JSON.parse(d.toString());
      frames.push(f);
      // A copy: frames that share the welcome's TCP chunk (the snapshot parts) arrive in the same tick.
      if (f.type === 'welcome') { clearTimeout(timer); resolve(frames.slice()); }
    });
  });
  // The session is up before the prompt goes (`ready` of the fake, 200 ms after its start).
  const deadline = Date.now() + 10_000;
  while (!/cockpit agent: ready/.test(box.logs())) {
    if (Date.now() > deadline) throw new Error(`the agent never became ready\n${box.logs().slice(-3000)}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  // Given a room with no pairing (Q-O21 b), behind a board with fleet.ingressPort and fleet.allowedUsers.
  // When an upgrade arrives on the ingress port with Tailscale-User-Login: guest@example.invalid …
  const guest = ingressWs(box, '/api/cockpit/ws', { user: 'guest@example.invalid' });
  const status = await Promise.race([
    once(guest, 'unexpected-response').then(([, res]) => res.statusCode),
    once(guest, 'open').then(() => 'open'),
  ]);
  guest.terminate();
  // … the board answers 403 user-not-allowed and the room's connection log has no accepted link.
  assert.equal(status, 403);
  assert.match(box.logs(), /refused upgrade \(upgrade-user-not-allowed\)/);
  assert.equal((await connections()).filter((c) => c.accepted).length, 0);

  // When the same upgrade arrives with owner@example.invalid, the link opens, welcome within 1.0 s …
  const owner = ingressWs(box, '/api/cockpit/ws', { user: 'owner@example.invalid' });
  t.after(() => owner.terminate());
  await once(owner, 'open');
  const gotWelcome = welcomed(owner);
  const sentHello = Date.now();
  owner.send(JSON.stringify(HELLO));
  const frames = await gotWelcome;
  assert.ok(Date.now() - sentHello <= 1000);
  assert.equal(frames.at(-1).screen, 'board');
  // … and a prompt sent on it writes one cockpit.prompt line with user board.
  const echoed = new Promise((resolve) => owner.on('message', (d) => {
    const f = JSON.parse(d.toString());
    if (f.type === 'turn.prompt') resolve(f);
  }));
  owner.send(JSON.stringify({ ...PROMPT, text: 'how did the night go?' }));
  const echo = await echoed;
  const lines = fs.readFileSync(box.auditFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .filter((e) => e.action === 'cockpit.prompt');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].user, 'board');
  assert.equal(lines[0].via, 'cockpit');
  assert.equal(lines[0].target, echo.turnId);
  assert.ok(!fs.readFileSync(box.auditFile, 'utf8').includes('night'), 'the words only as argsHash');

  // When an upgrade arrives on the main port from loopback with Origin the page's origin, the link opens (local).
  const local = new WebSocket(`ws://127.0.0.1:${box.port}/api/cockpit/ws`, { origin: `http://127.0.0.1:${box.port}` });
  t.after(() => local.terminate());
  await once(local, 'open');
  const localWelcome = welcomed(local);
  local.send(JSON.stringify(HELLO));
  await localWelcome;
  const accepted = (await connections()).filter((c) => c.accepted);
  assert.equal(accepted.length, 2, 'the owner\'s link and the local one');
  assert.match(box.logs(), /cockpit: link open \(direct, 1 open\)/);
  assert.match(box.logs(), /cockpit: link open \(local, 2 open\)/);
});

// --- T23c: the prompt rate (c1-talk.md §7 "Rate", screens.md §6.4; D228, D165) ---

test('rate: the 11th prompt in 60 s from the one screen is prompt.refused too-many, one refusal line, the held ones counted into the next line (D228, D165)', async (t) => {
  const clock = manualClock(t);
  const room = await inProcess(t);
  const a = await welcomed(room);
  const b = await welcomed(room);
  const id = (n) => `p-${n.toString(16).padStart(8, '0')}`;
  let seq = 2;
  const send = (c, n) => c.ws.send(JSON.stringify({ ...PROMPT, seq: seq++, clientId: id(n), text: `ping ${n}` }));
  const answered = (c, n) => c.frames.find((f) => (f.type === 'turn.prompt' || f.type === 'prompt.refused') && f.clientId === id(n));
  // ping 1-6 from link a, 7-10 from link b, 2 s apart on the room clock (ping 10 at 07:00:18).
  for (let n = 1; n <= 10; n++) {
    if (n > 1) await clock.advance(2_000);
    const c = n <= 6 ? a : b;
    send(c, n);
    await until(() => answered(c, n), `ping ${n} answered`);
    assert.equal(answered(c, n).type, 'turn.prompt', `ping ${n} taken`);
  }
  await clock.advance(2_000); // 07:00:20
  send(a, 11);
  await until(() => answered(a, 11), 'ping 11 answered');
  const refused = answered(a, 11);
  assert.deepEqual(refused, { type: 'prompt.refused', re: seq - 1, clientId: id(11), code: 'too-many' });
  assert.deepEqual(checkMessage(refused, 'out'), { ok: true });
  assert.equal(room.session.prompts.length, 10, 'nothing reached the agent');
  const line = room.audit.entries.at(-1);
  assert.equal(room.audit.entries.length, 11);
  assert.deepEqual(line, { user: 'board', via: 'cockpit', action: 'cockpit.prompt', target: '-', args: { text: 'ping 11' }, result: { ok: false, status: 'too-many' } });

  // A resend with a known clientId (E1's RETRY, D95) is not counted and not refused.
  a.ws.send(JSON.stringify({ ...PROMPT, seq: seq++, clientId: id(1), text: 'ping 1' }));
  await until(() => a.frames.filter((f) => f.type === 'turn.prompt' && f.clientId === id(1)).length === 2, 'the same echo');
  // Two more refusals in that minute, from either link: no line, held.
  await clock.advance(1_000);
  send(a, 12);
  send(b, 13);
  await until(() => answered(a, 12) && answered(b, 13), 'both refused');
  assert.equal(answered(a, 12).code, 'too-many');
  assert.equal(answered(b, 13).code, 'too-many', 'the pages of one screen share its 10');
  assert.equal(room.audit.entries.length, 11, 'one refusal line a minute (D165)');

  // 07:01:00.5: ping 1 is more than 60 s old, one prompt may go; its line carries the two held.
  await clock.advance(39_500);
  send(a, 14);
  await until(() => answered(a, 14), 'ping 14 answered');
  assert.equal(answered(a, 14).type, 'turn.prompt');
  assert.equal(room.session.prompts.length, 11);
  assert.deepEqual(room.audit.entries.at(-1).result, { ok: true, source: 'typed', delivery: 'queued', chars: 7, refusedSince: 2 });
  send(b, 15);
  await until(() => answered(b, 15), 'ping 15 answered');
  assert.equal(answered(b, 15).code, 'too-many', 'the window is full again');
  assert.equal(room.audit.entries.length, 12, 'still the minute of the 07:00:20 line: held');
  // 07:01:20: ping 2-10 out of the window too; the next line carries the one held since.
  await clock.advance(19_500);
  send(b, 16);
  await until(() => answered(b, 16), 'ping 16 answered');
  assert.equal(answered(b, 16).type, 'turn.prompt');
  assert.deepEqual(room.audit.entries.at(-1).result, { ok: true, source: 'typed', delivery: 'queued', chars: 7, refusedSince: 1 });
});

test('rate: a prompt refused agent-down or audit-unavailable is not counted (D228)', async (t) => {
  manualClock(t);
  const session = standInSession();
  const room = await inProcess(t, { session });
  const a = await welcomed(room);
  let seq = 2;
  const send = (n) => a.ws.send(JSON.stringify({ ...PROMPT, seq: seq++, clientId: `p-${n.toString(16).padStart(8, '0')}`, text: `ping ${n}` }));
  const codes = () => a.frames.filter((f) => f.type === 'prompt.refused').map((f) => f.code);
  session.phase = 'down';
  for (let n = 1; n <= 12; n++) send(n);
  await until(() => codes().length === 12, 'twelve refusals');
  assert.deepEqual(codes(), Array(12).fill('agent-down'));
  session.phase = 'up';
  for (let n = 13; n <= 22; n++) send(n);
  await until(() => a.frames.filter((f) => f.type === 'turn.prompt').length === 10, 'ten taken');
  send(23);
  await until(() => codes().length === 13, 'the 11th');
  assert.equal(codes().at(-1), 'too-many');
  assert.equal(session.prompts.length, 10);
});
