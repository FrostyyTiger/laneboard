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
import { promptLine } from '../server/cockpit/audit-lines.mjs';
import { createLink, cutForSnapshot, snapshotParts, languageList, PART_MAX_BYTES, TURN_MAX_BYTES } from '../server/cockpit/link.mjs';
import { checkMessage } from '../server/cockpit/protocol.mjs';
import { openAudit } from '../server/fleet/audit.mjs';

// --- the upgrade checks (link-checks.mjs) -----------------------------------

const PORT = 7801;
const CFG = { port: PORT };

function req({ headers = {}, auth } = {}) {
  const h = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const r = {
    method: 'GET', url: '/api/cockpit/ws', headers: h,
    rawHeaders: Object.entries(h).flatMap(([k, v]) => [k, v]),
    socket: { localPort: PORT, remoteAddress: '127.0.0.1' },
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
  for (const o of ['https://hub.example.invalid', 'http://127.0.0.1:7777', 'http://localhost:7777', 'http://[::1]:7777', 'http://127.1.2.3']) assert.equal(secureOrigin(o), true, o);
  for (const o of ['http://hub.example.invalid', 'ws://127.0.0.1', 'file:///x', 'nonsense', '']) assert.equal(secureOrigin(o), false, o);
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
    stop: (id) => (s.bridge.turn?.turnId === id ? { ok: true } : { ok: false, code: 'unknown-id' }),
    newConversation: () => ({ ok: false, code: 'not-now' }),
  };
  return s;
}

function standInStore(turns = []) {
  const applied = [];
  return { applied, apply: (m) => applied.push(m), turns: () => turns, conversation: 'c-0003', startedAt: '2026-10-27T06:12:00+01:00' };
}

async function inProcess(t, { session = standInSession(), store = standInStore(), audit, clientIds } = {}) {
  const lines = [];
  const auditLog = audit === undefined ? { entries: [], append(e) { this.entries.push(e); return e; } } : audit;
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const config = { port, cockpit: { stt: { url: 'none', language: ['en', 'de'] } } };
  const link = createLink({ session, store, audit: auditLog, config, log: (l) => lines.push(l), clientIds });
  session.emit = link.emit;
  server.on('upgrade', (r, socket, head) => {
    r.auth = classify(r, config, {});
    if (!link.handleUpgrade(r, socket, head, new URL(r.url, 'http://x'))) socket.destroy();
  });
  t.after(() => { link.close(); server.close(); });
  const open = (origin = `http://127.0.0.1:${port}`) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/cockpit/ws`, { origin });
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
      if (f.type === 'welcome') { clearTimeout(timer); resolve(frames); }
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
