// server/config/cockpit.mjs: the cockpit's keys, their defaults, the env layer
// and every fatal-at-start line (spec protocols.md §11.12, c2-voice.md §9,
// D128, D129, D245). The user lookup is injected (S-ONE-12's way): `lb-agent`
// uid 998, `root` uid 0, the room's own `user` uid 1000.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build, FRAGMENTS } from '../server/config.mjs';
import {
  cockpitProblem, startLines, cockpitConfigured, fillPath, fromEnv, lookupUser,
  DEFAULT_CWD, ROOM_PORT,
} from '../server/config/cockpit.mjs';
import { isRoomPath, COCKPIT_PREFIX } from '../server/boot/cockpit.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-config-cockpit-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const STATE = path.join(tmp, 'state');
let n = 0;
const write = (body) => {
  const f = path.join(tmp, `c${++n}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  return f;
};
const ENV = { LANEBOARD_STATE_DIR: STATE };
const conf = (body, env = {}) => build({ env: { ...ENV, ...env }, file: write(body), fragments: FRAGMENTS });

const USERS = { 'lb-agent': { uid: 998 }, root: { uid: 0 }, user: { uid: 1000 } };
const DEPS = { lookupUser: (name) => USERS[name] ?? null, uid: 1000, isDir: (p) => p === tmp || p === '/srv/notes' };
const FAKE = ['node', 'fake-agent.mjs'];

/**
 * The cockpit's first fatal line for a config file `body` (and env), through
 * build()'s real merge, with the injected users; null when it has none. Other
 * fragments may refuse the config after it (a hub with no builders): ignored.
 */
function problem(body, env = {}, deps = DEPS) {
  let line = null;
  const fragments = FRAGMENTS.map((f) => (f.name !== 'cockpit' ? f : {
    ...f, validate: (c, bad, layers) => { line = cockpitProblem(c, layers, deps); },
  }));
  try {
    build({ env: { ...ENV, ...env }, file: write(body), fragments });
  } catch { /* another fragment's refusal */ }
  return line;
}
const agent = (a, extra = {}) => ({ cockpit: { agent: { command: FAKE, allowSameUser: true, ...a } }, ...extra });

// --- defaults -----------------------------------------------------------------------

test('no cockpit section: the board as today, nothing configured (D17)', () => {
  const c = conf({});
  assert.equal(c.cockpit.agent, null);
  assert.equal(c.cockpit.forwarded, false);
  assert.equal(c.cockpit.mcp.port, 7790);
  assert.deepEqual(c.cockpit.stt, { url: 'none', language: ['en', 'de'], tokenFile: null, protocol: 'whisperlivekit' });
  assert.equal(cockpitConfigured(c), false);
  assert.equal(c.port, 7777);
});

test('an agent block gets its kind\'s defaults (protocols.md §11.12)', () => {
  const c = conf({ cockpit: { agent: { allowSameUser: true } } });
  assert.deepEqual(c.cockpit.agent, {
    kind: 'claude-code', command: ['claude'], cwd: DEFAULT_CWD, user: null, allowSameUser: true,
    allowedTools: ['mcp__laneboard__*', 'Read', 'Grep', 'Glob'], allowUnrestricted: false, env: [],
    loginCheck: ['claude', 'auth', 'status'], maxTurnsPerHour: 20,
  });
  assert.equal(cockpitConfigured(c), true);
  const b = conf({ cockpit: { agent: { kind: 'bridge', command: ['/opt/acme-agent/bin/acme-agent', '--bridge'], allowSameUser: true } } });
  assert.deepEqual(b.cockpit.agent.allowedTools, ['mcp__laneboard__*']);
  assert.equal(b.cockpit.agent.loginCheck, null);
  assert.deepEqual(b.cockpit.agent.command, ['/opt/acme-agent/bin/acme-agent', '--bridge'], 'a bridge flag is the agent\'s own');
  assert.equal(conf(agent({ loginCheck: null })).cockpit.agent.loginCheck, null, 'an explicit null stays');
});

test('the board URL: the own port on the one box, 7777 for a room alone (D218)', () => {
  assert.equal(conf(agent({}), { LANEBOARD_PORT: '7801' }).cockpit.board.url, 'http://127.0.0.1:7801');
  assert.equal(conf(agent({}, { mode: 'cockpit' }), { LANEBOARD_PORT: '7801' }).cockpit.board.url, 'http://127.0.0.1:7777');
  assert.equal(conf(agent({}, { mode: 'cockpit' })).cockpit.board.url, 'http://127.0.0.1:7777');
  assert.equal(conf({ cockpit: { ...agent({}).cockpit, board: { url: 'http://127.0.0.1:9100' } } }).cockpit.board.url, 'http://127.0.0.1:9100');
});

test('mode cockpit: its own port 7778 unless the file or the env sets one (README "Ports")', () => {
  assert.equal(conf(agent({}, { mode: 'cockpit' })).port, ROOM_PORT);
  assert.equal(conf(agent({}, { mode: 'cockpit', port: 7900 })).port, 7900);
  assert.equal(conf(agent({}, { mode: 'cockpit' }), { LANEBOARD_PORT: '7901' }).port, 7901);
  assert.equal(conf(agent({})).port, 7777, 'the one box keeps the board\'s port');
});

test('forwarded alone is a configured cockpit with no room (D129)', () => {
  const c = conf({ cockpit: { forwarded: true } });
  assert.equal(c.cockpit.agent, null);
  assert.equal(cockpitConfigured(c), true);
  assert.equal(conf({}, { LANEBOARD_COCKPIT_FORWARDED: '1' }).cockpit.forwarded, true);
});

test('the env layer: JSON arrays, comma lists, 1/0, null; a value it cannot read is kept for the check', () => {
  const e = fromEnv({
    LANEBOARD_COCKPIT_AGENT_KIND: ' bridge ',
    LANEBOARD_COCKPIT_AGENT_COMMAND: '["/opt/acme-agent/bin/acme-agent","--bridge"]',
    LANEBOARD_COCKPIT_AGENT_ALLOWED_TOOLS: 'mcp__laneboard__*, Read',
    LANEBOARD_COCKPIT_AGENT_ENV: 'ANTHROPIC_MODEL,ACME_AGENT_MODEL',
    LANEBOARD_COCKPIT_AGENT_ALLOW_SAME_USER: '1',
    LANEBOARD_COCKPIT_AGENT_ALLOW_UNRESTRICTED: '0',
    LANEBOARD_COCKPIT_AGENT_LOGIN_CHECK: 'null',
    LANEBOARD_COCKPIT_AGENT_MAX_TURNS_PER_HOUR: '12',
    LANEBOARD_COCKPIT_STT_URL: 'wss://stt.example.invalid/asr',
    LANEBOARD_COCKPIT_STT_LANGUAGE: 'en',
  });
  assert.deepEqual(e.cockpit.agent, {
    kind: 'bridge', command: ['/opt/acme-agent/bin/acme-agent', '--bridge'], allowSameUser: true,
    allowedTools: ['mcp__laneboard__*', 'Read'], allowUnrestricted: false, env: ['ANTHROPIC_MODEL', 'ACME_AGENT_MODEL'],
    loginCheck: null, maxTurnsPerHour: 12,
  });
  assert.deepEqual(e.cockpit.stt, { url: 'wss://stt.example.invalid/asr', language: 'en' });
  const raw = fromEnv({ LANEBOARD_COCKPIT_AGENT_COMMAND: 'claude --x', LANEBOARD_COCKPIT_AGENT_ALLOW_SAME_USER: 'yes', LANEBOARD_COCKPIT_AGENT_MAX_TURNS_PER_HOUR: 'lots' });
  assert.deepEqual(raw.cockpit.agent, { command: 'claude --x', allowSameUser: 'yes', maxTurnsPerHour: 'lots' });
  assert.deepEqual(fromEnv({}), {});
});

test('fillPath fills {stateDir} and a leading ~', () => {
  assert.equal(fillPath(DEFAULT_CWD, { stateDir: '/var/lib/laneboard' }), '/var/lib/laneboard/cockpit-agent');
  assert.equal(fillPath('~/notes', { home: '/home/user' }), '/home/user/notes');
  assert.equal(fillPath('work', { stateDir: '/x' }), 'work');
});

// --- the fatal lines, in §11.12's table order ------------------------------------------

const LINES = [
  // D128, D129 and the section's own keys
  ['agent on a hub (D128)', agent({}, { mode: 'hub' }), {}, 'cockpit.agent on a hub: run the room as its own process, mode cockpit (D91)'],
  ['mode cockpit without an agent (D128)', { mode: 'cockpit' }, {}, 'mode cockpit needs cockpit.agent'],
  ['forwarded with agent (D129)', { cockpit: { ...agent({}).cockpit, forwarded: true } }, {}, 'cockpit.forwarded and cockpit.agent: this process is the room, drop forwarded'],
  ['forwarded not a boolean', { cockpit: { forwarded: 'yes' } }, {}, 'cockpit.forwarded: must be true or false'],
  ['a hub holds forwarded only (B38)', { mode: 'hub', cockpit: { forwarded: true, mcp: { port: 7790 } } }, {}, 'cockpit.mcp on a hub: a hub\'s cockpit section holds only cockpit.forwarded (D129)'],
  ['a room alone on another address (B39)', agent({}, { mode: 'cockpit', bind: ['0.0.0.0'] }), {}, 'bind: a room alone (mode cockpit) listens on 127.0.0.1 only, got ["0.0.0.0"]'],
  ['mcp.port', { cockpit: { mcp: { port: 70000 } } }, {}, 'cockpit.mcp.port: must be a port number, or 0 for any free port, got 70000'],
  ['board.url', { cockpit: { board: { url: 'ftp://hub' } } }, {}, 'cockpit.board.url: must be an http(s) URL with no credentials or query, got "ftp://hub"'],
  // c2-voice.md §9
  ['stt.protocol', { cockpit: { stt: { url: 'wss://stt.example.invalid/asr', protocol: 'deepgram' } } }, {},
    'cockpit.stt.protocol: "deepgram" is not supported; v1 speaks "whisperlivekit" only (put a shim in front of another service, docs/cockpit.md)'],
  ['stt.url ws:// off loopback', { cockpit: { stt: { url: 'ws://stt.example.invalid/asr' } } }, {}, 'cockpit.stt.url: ws:// only on a loopback host; use wss://'],
  ['stt.url with a query', { cockpit: { stt: { url: 'wss://stt.example.invalid/asr?token=x' } } }, {}, 'cockpit.stt.url: must have no query or fragment (the room adds language and mode itself)'],
  ['stt.url with credentials', { cockpit: { stt: { url: 'wss://a:b@stt.example.invalid/asr' } } }, {}, 'cockpit.stt.url: must not carry credentials (put the token in cockpit.stt.tokenFile)'],
  ['stt.language', { cockpit: { stt: { language: 'english' } } }, {}, 'cockpit.stt.language: must be "auto", a two-letter code or a list of them ("en" or ["en","de"]), got "english"'],
  // protocols.md §11.12
  ['(a) kind', agent({ kind: 'acme' }), {}, 'cockpit.agent.kind: "acme" is not supported; use "claude-code" or "bridge" (docs/cockpit.md)'],
  ['(b) bridge without command', { cockpit: { agent: { kind: 'bridge', allowSameUser: true } } }, {},
    'cockpit.agent.command: required for kind bridge (the argv of a program that speaks the bridge protocol, docs/cockpit.md)'],
  ['command not an array', agent({ command: 'claude' }), {}, 'cockpit.agent.command: must be an array of strings, one per argument (["claude"])'],
  ['command env not a JSON array', { cockpit: { agent: { allowSameUser: true } } }, { LANEBOARD_COCKPIT_AGENT_COMMAND: 'claude --x' },
    'cockpit.agent.command: must be an array of strings, one per argument (["claude"])'],
  ['command with an empty entry', agent({ command: ['node', ''] }), {}, 'cockpit.agent.command: must be an array of strings, one per argument (["claude"])'],
  ['(c) a flag for claude-code', agent({ command: ['node', 'fake-agent.mjs', '--model', 'x'] }), {},
    'cockpit.agent.command: "--model" is a flag; for kind claude-code the room sets the flags itself (protocols.md §11.2); a model goes in cockpit.agent.env (ANTHROPIC_MODEL)'],
  ['D217 user with a relative program', agent({ user: 'lb-agent' }), {},
    'cockpit.agent.command: with cockpit.agent.user the program needs an absolute path (/var/lib/lb-agent/.local/bin/claude)'],
  ['cwd relative', agent({ cwd: 'work' }), {}, 'cockpit.agent.cwd: "work" must be an absolute path'],
  ['(d) cwd missing', agent({ cwd: '/nonexistent/notes' }), {}, 'cockpit.agent.cwd: /nonexistent/notes is not a directory'],
  ['user not a name', agent({ user: 'Lb Agent', command: ['/usr/bin/node'] }), {}, 'cockpit.agent.user: "Lb Agent" is not a user name'],
  ['(e) no such user', agent({ user: 'nobody-here', command: ['/usr/bin/node'] }), {},
    'cockpit.agent.user: no user "nobody-here" on this machine (laneboard cockpit agent-user prints the commands to make one)'],
  ['(f) root', agent({ user: 'root', command: ['/usr/bin/node'] }), {},
    'cockpit.agent.user: "root" would give the agent every file and process; give it its own user (laneboard cockpit agent-user)'],
  ['(g) the room\'s own user', agent({ user: 'user', command: ['/usr/bin/node'] }), {},
    'cockpit.agent.user: "user" is the room\'s own user; give the agent its own (laneboard cockpit agent-user), or leave it unset and see cockpit.agent.allowSameUser'],
  ['allowSameUser not a boolean', agent({ allowSameUser: 'yes' }), {}, 'cockpit.agent.allowSameUser: must be true or false'],
  ['allowSameUser env not 1 or 0', { cockpit: { agent: { command: FAKE } } }, { LANEBOARD_COCKPIT_AGENT_ALLOW_SAME_USER: 'yes' }, 'cockpit.agent.allowSameUser: must be true or false'],
  ['allowUnrestricted not a boolean', agent({ allowUnrestricted: 1 }), {}, 'cockpit.agent.allowUnrestricted: must be true or false'],
  ['user unset, allowSameUser not true (Q-O36 b)', { cockpit: { agent: { command: FAKE } } }, {},
    'cockpit.agent.user is not set: the agent would run as you (uid 1000) and read every file you can. Give it its own user (laneboard cockpit agent-user), or set cockpit.agent.allowSameUser: true to accept that (docs/cockpit.md).'],
  ['allowUnrestricted with claude-code (D241)', agent({ allowUnrestricted: true }), {},
    'cockpit.agent.allowUnrestricted: only for kind bridge; claude-code is limited by cockpit.agent.allowedTools'],
  ['allowUnrestricted without user (D241)', agent({ kind: 'bridge', allowUnrestricted: true }), {},
    'cockpit.agent.allowUnrestricted needs cockpit.agent.user: an agent with no tool limit must not run as you'],
  ['(h) allowedTools', agent({ allowedTools: ['Bash(*)'] }), {}, 'cockpit.agent.allowedTools: "Bash(*)" is not a tool name or a prefix ending in *'],
  ['allowedTools empty', agent({ allowedTools: [] }), {}, 'cockpit.agent.allowedTools: [] is not a tool name or a prefix ending in *'],
  ['allowedTools * in the middle', agent({ allowedTools: ['mcp__*__x'] }), {}, 'cockpit.agent.allowedTools: "mcp__*__x" is not a tool name or a prefix ending in *'],
  ['env name', agent({ env: ['acme-model'] }), {}, 'cockpit.agent.env: "acme-model" is not an environment variable name'],
  ['(i) env reserved', agent({ env: ['LANEBOARD_MCP_TOKEN'] }), {}, 'cockpit.agent.env: LANEBOARD_MCP_TOKEN is set by the room itself'],
  ['env PATH', agent({ env: ['ANTHROPIC_MODEL', 'PATH'] }), {}, 'cockpit.agent.env: PATH is set by the room itself'],
  ['loginCheck', agent({ loginCheck: 'claude auth status' }), {}, 'cockpit.agent.loginCheck: must be null or an array of strings (["claude","auth","status"])'],
  ['loginCheck empty', agent({ loginCheck: [] }), {}, 'cockpit.agent.loginCheck: must be null or an array of strings (["claude","auth","status"])'],
  ['(j) maxTurnsPerHour', agent({ maxTurnsPerHour: 1000 }), {}, 'cockpit.agent.maxTurnsPerHour: 1000 is not a whole number from 0 to 600'],
  ['maxTurnsPerHour env', agent({}), { LANEBOARD_COCKPIT_AGENT_MAX_TURNS_PER_HOUR: 'lots' }, 'cockpit.agent.maxTurnsPerHour: "lots" is not a whole number from 0 to 600'],
  ['(k) env without a file agent (D245)', {}, { LANEBOARD_COCKPIT_AGENT_KIND: 'bridge' },
    'LANEBOARD_COCKPIT_AGENT_KIND is set, but the config file has no cockpit.agent; a room is made in the file (docs/cockpit.md)'],
  ['(l) kind and maxTurnsPerHour: only the first', agent({ kind: 'acme', maxTurnsPerHour: 1000 }), {},
    'cockpit.agent.kind: "acme" is not supported; use "claude-code" or "bridge" (docs/cockpit.md)'],
];

for (const [name, body, env, line] of LINES) {
  test(`fatal: ${name}`, () => {
    assert.equal(problem(body, env), line);
  });
}

test('valid configs pass: the stand-in\'s, a bridge on its own user, the one box\'s defaults', () => {
  assert.equal(problem(agent({ cwd: tmp, env: ['FAKE_AGENT_DIR'], loginCheck: ['node', 'fake-agent.mjs', 'auth', 'status'] })), null);
  assert.equal(problem({ cockpit: { agent: { command: FAKE, cwd: tmp, env: ['FAKE_AGENT_DIR'], allowSameUser: true }, stt: { url: 'none' }, board: { url: 'http://127.0.0.1:9100' }, mcp: { port: 0 } } }), null);
  assert.equal(problem({ cockpit: { agent: { kind: 'bridge', command: ['/opt/acme-agent/bin/acme-agent'], user: 'lb-agent', allowUnrestricted: true } } }), null);
  assert.equal(problem({ cockpit: { agent: { command: ['/usr/bin/claude'], user: 'lb-agent', cwd: '/srv/notes' } } }), null);
  assert.equal(problem(agent({}, { mode: 'cockpit' })), null);
  assert.equal(problem({ mode: 'hub', cockpit: { forwarded: true } }), null);
  assert.equal(problem({ cockpit: { stt: { url: 'ws://127.0.0.1:8000/asr', language: 'auto' } } }), null);
  assert.equal(problem({}), null);
});

test('build() refuses a bad cockpit key with the line, after the file name', () => {
  const file = write(agent({ kind: 'acme' }));
  assert.throws(() => build({ env: ENV, file, fragments: FRAGMENTS }),
    (err) => err.message === `${file}: cockpit.agent.kind: "acme" is not supported; use "claude-code" or "bridge" (docs/cockpit.md)`);
});

test('the real user lookup: root is uid 0, a made-up name is nobody', () => {
  assert.deepEqual(lookupUser('root'), { uid: 0 });
  assert.equal(lookupUser('nobody-here-lb'), null);
});

// --- the start lines (not fatal) ----------------------------------------------------------

test('start lines: an env name not set here, the agent on the room\'s user, no tool limit', () => {
  const c = conf(agent({ env: ['ANTHROPIC_MODEL', 'ACME_AGENT_MODEL'] }));
  assert.deepEqual(startLines(c, { env: { ANTHROPIC_MODEL: 'x' }, uid: 1000 }), [
    'cockpit.agent.env: ACME_AGENT_MODEL is not set here; the agent starts without it',
    'cockpit: the agent runs as you (uid 1000): it can read every file you can, ~/.ssh included. Pairing is off (agent-is-room).',
  ]);
  const u = { cockpit: { agent: { kind: 'bridge', command: ['/opt/acme-agent/bin/acme-agent'], user: 'lb-agent', allowUnrestricted: true, allowSameUser: false, env: [] } } };
  assert.deepEqual(startLines(u, { env: {}, uid: 1000 }), [
    'cockpit.agent.allowUnrestricted is true: the agent\'s tools are not limited; only its own user (lb-agent) keeps it off your files and the board\'s state.',
  ]);
  assert.deepEqual(startLines(conf({}), { env: {} }), []);
});

test('isRoomPath: /healthz and the prefix, raw, nothing else', () => {
  assert.equal(COCKPIT_PREFIX, '/api/cockpit');
  for (const p of ['/healthz', '/healthz?x=1', '/api/cockpit', '/api/cockpit/ws', '/api/cockpit/pair/K7M4QX']) assert.equal(isRoomPath(p), true, p);
  for (const p of ['/', '/ws', '/api/map', '/api/cockpitx', '/api/%63ockpit/ws', 'http://hub/api/cockpit/ws', '*', '/healthz/x', '/index.html']) assert.equal(isRoomPath(p), false, p);
});
