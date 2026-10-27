// The room process (spec README "The room process", protocols.md §1, D128,
// D129): `mode: cockpit` serves /healthz and /api/cockpit/* only, never loads
// the board; the one box's board makes the room on its ctx; every fatal line of
// D128, D129 and protocols.md §11.12 stops a real start: exit 1 within 2 s,
// the exact line on stderr, nothing listening.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import { boot, freePort } from './helpers/boot.mjs';
import { USER_RX } from '../server/config/cockpit.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAKE = ['node', 'test/cockpit/stand-ins/fake-agent.mjs'];
const AGENT = { command: FAKE, allowSameUser: true, loginCheck: null };

function loadedPaths(booted) {
  return booted.loadedUrls()
    .filter((u) => u.startsWith('file:'))
    .map((u) => fileURLToPath(u))
    .filter((p) => p.startsWith(ROOT))
    .map((p) => p.slice(ROOT.length + 1));
}

/** What a WebSocket upgrade on `p` gets: the refusal's status, or 'open'. */
function upgradeOutcome(booted, p) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${booted.port}${p}`, { origin: booted.url });
    ws.once('open', () => { ws.terminate(); resolve('open'); });
    ws.once('unexpected-response', (req, res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    ws.once('error', (err) => resolve({ error: err.message }));
  });
}

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

test('mode cockpit: /healthz and /api/cockpit/* only, no /ws, no board (protocols.md §1, D128)', { timeout: 30_000 }, async () => {
  const room = await boot({ mode: 'cockpit', config: { cockpit: { agent: AGENT } }, trace: true });
  try {
    assert.equal(room.health.ok, true);
    assert.equal(room.health.mode, 'cockpit');
    assert.equal((await fetch(`${room.url}/healthz`)).status, 200);
    for (const p of ['/', '/api/map', '/index.html', '/js/app.js', '/api/sessions', '/ws', '/api/v1/hello', '/x/y/z']) {
      const r = await fetch(`${room.url}${p}`);
      assert.equal(r.status, 404, p);
      assert.deepEqual(await r.json(), { error: 'not-found' }, p);
    }
    // The prefix reaches the room's router (T13 adds the link; until then a 404 of the router's own).
    const pre = await fetch(`${room.url}/api/cockpit/nothing-here`);
    assert.equal(pre.status, 404);
    assert.equal((await pre.json()).path, '/api/cockpit/nothing-here', 'answered past the room-alone filter');
    assert.deepEqual(await upgradeOutcome(room, '/ws'), { status: 404, body: '{"error":"not-found"}' });
    assert.deepEqual(await upgradeOutcome(room, '/ws/term/x'), { status: 404, body: '{"error":"not-found"}' });

    // The room's default cwd, made at start (D246, D209: 0755).
    const cwd = path.join(room.stateDir, 'cockpit-agent');
    assert.ok(fs.statSync(cwd).isDirectory());
    assert.equal(fs.statSync(cwd).mode & 0o777, 0o755);
    assert.match(room.logs(), /cockpit: the agent runs as you \(uid \d+\): it can read every file you can, ~\/\.ssh included\. Pairing is off \(agent-is-room\)\./);

    // No collectors, sessions, terminals, /ws or board routes in the process.
    const loaded = loadedPaths(room);
    assert.ok(loaded.includes('server/boot/cockpit.mjs'));
    for (const p of loaded) {
      for (const bad of ['server/state.mjs', 'server/terminals.mjs', 'server/ws.mjs', 'server/actions.mjs', 'server/push.mjs', 'server/db.mjs', 'server/boot/builder.mjs', 'server/boot/hub.mjs']) {
        assert.notEqual(p, bad, `the room loaded ${bad}`);
      }
      assert.ok(!/^server\/(routes|flags|collector|hub|map)\//.test(p), `the room loaded ${p}`);
    }
    assert.ok(!room.loadedUrls().some((u) => /(^|\/)node-pty(\/|$)/.test(u)), 'the room resolved node-pty');

    room.child.kill('SIGTERM');
    const [code] = await once(room.child, 'exit');
    assert.equal(code, 0, room.logs().slice(-2000));
    assert.ok(!/unhandledRejection|uncaughtException/.test(room.logs()), room.logs().slice(-2000));
  } finally {
    await room.stop();
  }
});

test('mode builder with cockpit.agent: the board as before, and the room on its ctx (the one box)', { timeout: 30_000 }, async () => {
  const box = await boot({ config: { cockpit: { agent: AGENT } } });
  try {
    const page = await fetch(`${box.url}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal((await fetch(`${box.url}/api/map`)).status, 200);
    assert.ok(fs.statSync(path.join(box.stateDir, 'cockpit-agent')).isDirectory());
    assert.match(box.logs(), /cockpit: room up \(agent claude-code, cwd /);
  } finally {
    await box.stop();
  }
});

test('mode builder without a cockpit section: no room', { timeout: 30_000 }, async () => {
  const board = await boot({});
  try {
    assert.doesNotMatch(board.logs(), /cockpit: room up/);
    assert.equal(fs.existsSync(path.join(board.stateDir, 'cockpit-agent')), false);
  } finally {
    await board.stop();
  }
});

// --- every fatal line, through a real start -------------------------------------------

const me = os.userInfo().username;
const uid = process.getuid();
const ag = (a, extra = {}) => ({ cockpit: { agent: { command: FAKE, allowSameUser: true, ...a } }, ...extra });

const FATAL = [
  ['agent on a hub (D128)', { mode: 'hub', config: ag({}, { fleet: { builders: [{ id: 'builder-a', url: 'http://127.0.0.1:9' }] } }) },
    'cockpit.agent on a hub: run the room as its own process, mode cockpit (D91)'],
  ['mode cockpit without cockpit.agent (D128)', { mode: 'cockpit', config: {} }, 'mode cockpit needs cockpit.agent'],
  ['forwarded and agent (D129)', { config: { cockpit: { agent: AGENT, forwarded: true } } },
    'cockpit.forwarded and cockpit.agent: this process is the room, drop forwarded'],
  ['kind', { config: ag({ kind: 'acme' }) }, 'cockpit.agent.kind: "acme" is not supported; use "claude-code" or "bridge" (docs/cockpit.md)'],
  ['command missing for bridge', { config: ag({ kind: 'bridge', command: undefined }) },
    'cockpit.agent.command: required for kind bridge (the argv of a program that speaks the bridge protocol, docs/cockpit.md)'],
  ['command not an array (env)', { config: ag({ command: undefined }), env: { LANEBOARD_COCKPIT_AGENT_COMMAND: 'claude --x' } },
    'cockpit.agent.command: must be an array of strings, one per argument (["claude"])'],
  ['command with a flag', { config: ag({ command: ['node', 'fake-agent.mjs', '--model', 'x'] }) },
    'cockpit.agent.command: "--model" is a flag; for kind claude-code the room sets the flags itself (protocols.md §11.2); a model goes in cockpit.agent.env (ANTHROPIC_MODEL)'],
  ['command relative with user (D217)', { config: ag({ user: 'lb-agent' }) },
    'cockpit.agent.command: with cockpit.agent.user the program needs an absolute path (/var/lib/lb-agent/.local/bin/claude)'],
  ['cwd not absolute', { config: ag({ cwd: 'work' }) }, 'cockpit.agent.cwd: "work" must be an absolute path'],
  ['cwd not a directory', { config: ag({ cwd: '/nonexistent/notes' }) }, 'cockpit.agent.cwd: /nonexistent/notes is not a directory'],
  ['user not a name', { config: ag({ user: 'Lb Agent', command: [process.execPath] }) }, 'cockpit.agent.user: "Lb Agent" is not a user name'],
  ['user unknown', { config: ag({ user: 'nobody-here', command: [process.execPath] }) },
    'cockpit.agent.user: no user "nobody-here" on this machine (laneboard cockpit agent-user prints the commands to make one)'],
  ['user root', { config: ag({ user: 'root', command: [process.execPath] }) },
    'cockpit.agent.user: "root" would give the agent every file and process; give it its own user (laneboard cockpit agent-user)'],
  ...(USER_RX.test(me) && uid !== 0 ? [['user the room\'s own', { config: ag({ user: me, command: [process.execPath] }) },
    `cockpit.agent.user: "${me}" is the room's own user; give the agent its own (laneboard cockpit agent-user), or leave it unset and see cockpit.agent.allowSameUser`]] : []),
  ['allowSameUser not a boolean', { config: ag({}), env: { LANEBOARD_COCKPIT_AGENT_ALLOW_SAME_USER: 'yes' } }, 'cockpit.agent.allowSameUser: must be true or false'],
  ['user unset, allowSameUser not true (Q-O36)', { config: ag({ allowSameUser: undefined }) },
    `cockpit.agent.user is not set: the agent would run as you (uid ${uid}) and read every file you can. Give it its own user (laneboard cockpit agent-user), or set cockpit.agent.allowSameUser: true to accept that (docs/cockpit.md).`],
  ['allowUnrestricted with claude-code', { config: ag({ allowUnrestricted: true }) },
    'cockpit.agent.allowUnrestricted: only for kind bridge; claude-code is limited by cockpit.agent.allowedTools'],
  ['allowUnrestricted without user', { config: ag({ kind: 'bridge', allowUnrestricted: true }) },
    'cockpit.agent.allowUnrestricted needs cockpit.agent.user: an agent with no tool limit must not run as you'],
  ['allowedTools', { config: ag({ allowedTools: ['Bash(*)'] }) }, 'cockpit.agent.allowedTools: "Bash(*)" is not a tool name or a prefix ending in *'],
  ['env name', { config: ag({ env: ['acme-model'] }) }, 'cockpit.agent.env: "acme-model" is not an environment variable name'],
  ['env reserved', { config: ag({ env: ['LANEBOARD_MCP_TOKEN'] }) }, 'cockpit.agent.env: LANEBOARD_MCP_TOKEN is set by the room itself'],
  ['loginCheck', { config: ag({ loginCheck: 'claude auth status' }) }, 'cockpit.agent.loginCheck: must be null or an array of strings (["claude","auth","status"])'],
  ['maxTurnsPerHour', { config: ag({ maxTurnsPerHour: 1000 }) }, 'cockpit.agent.maxTurnsPerHour: 1000 is not a whole number from 0 to 600'],
  ['env without a file agent (D245)', { config: {}, env: { LANEBOARD_COCKPIT_AGENT_KIND: 'bridge' } },
    'LANEBOARD_COCKPIT_AGENT_KIND is set, but the config file has no cockpit.agent; a room is made in the file (docs/cockpit.md)'],
  ['two bad keys: the first only', { config: ag({ kind: 'acme', maxTurnsPerHour: 1000 }) },
    'cockpit.agent.kind: "acme" is not supported; use "claude-code" or "bridge" (docs/cockpit.md)'],
];

for (const [name, opts, line] of FATAL) {
  test(`fatal at start: ${name}`, { timeout: 20_000 }, async () => {
    const t0 = Date.now();
    const err = await boot({ timeoutMs: 5000, ...opts }).then(
      async (b) => { await b.stop(); return null; },
      (e) => e,
    );
    const ms = Date.now() - t0;
    assert.ok(err, 'the process started');
    assert.match(err.message, /laneboard exited \(1\) before \/healthz answered/);
    const got = /refusing to start — .*?config\.json: (.*)$/m.exec(err.message)?.[1];
    assert.equal(got, line);
    assert.equal(err.message.split('\n').filter((l) => l.includes('refusing to start')).length, 1, 'one line');
    assert.ok(ms < 2000, `exited after ${ms} ms`);
  });
}

test('fatal at start: nothing listens on the room\'s port', { timeout: 20_000 }, async () => {
  const port = await freePort();
  await assert.rejects(boot({ mode: 'cockpit', config: {}, env: { LANEBOARD_PORT: String(port) }, timeoutMs: 5000 }), /mode cockpit needs cockpit\.agent/);
  assert.equal(await canConnect(port), false);
});
