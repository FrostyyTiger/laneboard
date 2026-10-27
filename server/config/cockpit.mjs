// Config fragment: the cockpit (spec docs/plans/cockpit/spec/: README "The
// room process", protocols.md §11.12, c2-voice.md §9, c3-see.md §1-§2).
//
//   cockpit.agent       null, or the agent block that makes this process a
//                       room (D17, D89, D128). Its keys (protocols.md §11.12):
//                       kind, command, cwd, user, allowSameUser, allowedTools,
//                       allowUnrestricted, env, loginCheck, maxTurnsPerHour;
//                       their defaults are filled in by finalize, per kind.
//   cockpit.forwarded   true: this board's or hub's front forwards
//                       /api/cockpit/ to a room (D129)
//   cockpit.board.url   the board the agent's read tools read (null: the own
//                       port on the one box, http://127.0.0.1:7777 for a room
//                       alone, D218)
//   cockpit.mcp.port    the MCP server's port on 127.0.0.1 (0: any free, D260)
//   cockpit.stt.*       the speech service (c2-voice.md §9)
//
// `mode: cockpit` (server/config/mode.mjs) is the room alone: its own port
// default 7778, 127.0.0.1 only. Every fatal line below is exact (the spec's
// tables); the process prints it after config.mjs's `refusing to start — <file>:`
// prefix (B37). REVIEW-REQUIRED (fenced.txt's last block: the fatal-at-start
// lines): each check names the decision it enforces.
// Like every fragment, this file must not import server/config.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const AGENT_KINDS = Object.freeze(['claude-code', 'bridge']);
export const ROOM_PORT = 7778;
export const MCP_PORT = 7790;
export const MAX_TURNS_PER_HOUR_MAX = 600;
export const DEFAULT_CWD = '{stateDir}/cockpit-agent';
const ROOM_ALONE_BOARD_URL = 'http://127.0.0.1:7777';

/** Per kind: the defaults protocols.md §11.12 gives (command none for bridge: required). */
const KIND_DEFAULTS = {
  'claude-code': {
    command: ['claude'],
    allowedTools: ['mcp__laneboard__*', 'Read', 'Grep', 'Glob'],
    loginCheck: ['claude', 'auth', 'status'],
  },
  bridge: {
    command: undefined,
    allowedTools: ['mcp__laneboard__*'],
    loginCheck: null,
  },
};

/** The agent's env variables, in §11.12's table order (D245 names the first one set). */
export const AGENT_ENV = Object.freeze({
  kind: 'LANEBOARD_COCKPIT_AGENT_KIND',
  command: 'LANEBOARD_COCKPIT_AGENT_COMMAND',
  cwd: 'LANEBOARD_COCKPIT_AGENT_CWD',
  user: 'LANEBOARD_COCKPIT_AGENT_USER',
  allowSameUser: 'LANEBOARD_COCKPIT_AGENT_ALLOW_SAME_USER',
  allowedTools: 'LANEBOARD_COCKPIT_AGENT_ALLOWED_TOOLS',
  allowUnrestricted: 'LANEBOARD_COCKPIT_AGENT_ALLOW_UNRESTRICTED',
  env: 'LANEBOARD_COCKPIT_AGENT_ENV',
  loginCheck: 'LANEBOARD_COCKPIT_AGENT_LOGIN_CHECK',
  maxTurnsPerHour: 'LANEBOARD_COCKPIT_AGENT_MAX_TURNS_PER_HOUR',
});

export function defaults() {
  return {
    cockpit: {
      agent: null,
      forwarded: false,
      board: { url: null },
      mcp: { port: MCP_PORT },
      stt: { url: 'none', language: ['en', 'de'], tokenFile: null, protocol: 'whisperlivekit' },
    },
  };
}

// --- the env layer -------------------------------------------------------------
// A value the parser cannot read is kept as the raw string, so validate names
// the key with the value it got rather than the default.

const list = (v) => String(v).split(',').map((a) => a.trim()).filter(Boolean);
const flag = (v) => (v === '1' ? true : v === '0' ? false : v);
function jsonArray(v) {
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : v;
  } catch {
    return v;
  }
}
const set = (v) => v !== undefined && v !== '';

export function fromEnv(env = process.env) {
  const agent = {};
  const e = (k) => env[AGENT_ENV[k]];
  if (set(e('kind'))) agent.kind = String(e('kind')).trim();
  if (set(e('command'))) agent.command = jsonArray(e('command'));
  if (set(e('cwd'))) agent.cwd = e('cwd');
  if (set(e('user'))) agent.user = e('user');
  if (set(e('allowSameUser'))) agent.allowSameUser = flag(e('allowSameUser'));
  if (set(e('allowedTools'))) agent.allowedTools = list(e('allowedTools'));
  if (set(e('allowUnrestricted'))) agent.allowUnrestricted = flag(e('allowUnrestricted'));
  if (set(e('env'))) agent.env = list(e('env'));
  if (set(e('loginCheck'))) agent.loginCheck = e('loginCheck').trim() === 'null' ? null : jsonArray(e('loginCheck'));
  if (set(e('maxTurnsPerHour'))) {
    const v = String(e('maxTurnsPerHour')).trim();
    agent.maxTurnsPerHour = /^-?\d+$/.test(v) ? Number(v) : v;
  }
  const stt = {};
  if (set(env.LANEBOARD_COCKPIT_STT_URL)) stt.url = env.LANEBOARD_COCKPIT_STT_URL;
  if (set(env.LANEBOARD_COCKPIT_STT_LANGUAGE)) {
    const l = list(env.LANEBOARD_COCKPIT_STT_LANGUAGE);
    stt.language = l.length === 1 ? l[0] : l;
  }
  if (set(env.LANEBOARD_COCKPIT_STT_TOKEN_FILE)) stt.tokenFile = env.LANEBOARD_COCKPIT_STT_TOKEN_FILE;
  if (set(env.LANEBOARD_COCKPIT_STT_PROTOCOL)) stt.protocol = env.LANEBOARD_COCKPIT_STT_PROTOCOL;
  const out = {};
  if (Object.keys(agent).length) out.agent = agent;
  if (Object.keys(stt).length) out.stt = stt;
  if (set(env.LANEBOARD_COCKPIT_FORWARDED)) out.forwarded = flag(env.LANEBOARD_COCKPIT_FORWARDED);
  return Object.keys(out).length ? { cockpit: out } : {};
}

// --- finalize: the derived defaults ---------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

/**
 * The room alone's port (7778) and the board URL (D218); an agent block's
 * defaults per kind. Tolerates wrong types: validate reports them.
 */
export function finalize(c, layers = {}) {
  if (c.mode === 'cockpit' && !has(layers.file, 'port') && layers.env?.port === undefined) c.port = ROOM_PORT;
  const k = c.cockpit;
  if (!isObj(k)) return c;
  if (isObj(k.board) && (k.board.url === null || k.board.url === undefined)) {
    k.board.url = c.mode === 'cockpit' ? ROOM_ALONE_BOARD_URL : `http://127.0.0.1:${c.port}`;
  }
  if (isObj(k.agent)) {
    const a = { ...k.agent };
    if (a.kind === undefined) a.kind = 'claude-code';
    const d = KIND_DEFAULTS[a.kind] ?? KIND_DEFAULTS['claude-code'];
    if (a.command === undefined && d.command) a.command = [...d.command];
    if (a.cwd === undefined) a.cwd = DEFAULT_CWD;
    if (a.user === undefined) a.user = null;
    if (a.allowSameUser === undefined) a.allowSameUser = false;
    if (a.allowedTools === undefined) a.allowedTools = [...d.allowedTools];
    if (a.allowUnrestricted === undefined) a.allowUnrestricted = false;
    if (a.env === undefined) a.env = [];
    if (a.loginCheck === undefined) a.loginCheck = d.loginCheck ? [...d.loginCheck] : null;
    if (a.maxTurnsPerHour === undefined) a.maxTurnsPerHour = 20;
    k.agent = a;
  }
  return c;
}

// --- paths and users ------------------------------------------------------------

/** `cwd` with `{stateDir}` and a leading `~` filled in (protocols.md §11.12). */
export function fillPath(p, { stateDir, home = os.homedir() } = {}) {
  if (typeof p !== 'string') return p;
  let out = p.split('{stateDir}').join(stateDir ?? '');
  if (out === '~') out = home;
  else if (out.startsWith('~/')) out = path.join(home, out.slice(2));
  return out;
}

export const USER_RX = /^[a-z_][a-z0-9_-]{0,31}$/;

/**
 * The machine's user `name` as {uid}, or null when there is none. `getent`
 * (NSS: also directory users), else /etc/passwd. argv only, no shell; the name
 * is checked against USER_RX before it gets here.
 */
export function lookupUser(name) {
  const r = spawnSync('getent', ['passwd', name], { encoding: 'utf8', timeout: 2000 });
  let text = null;
  if (!r.error) {
    if (r.status !== 0) return null;
    text = r.stdout;
  } else {
    try { text = fs.readFileSync('/etc/passwd', 'utf8'); } catch { return null; }
  }
  for (const line of String(text).split('\n')) {
    const f = line.split(':');
    if (f[0] === name && /^\d+$/.test(f[2] ?? '')) return { uid: Number(f[2]) };
  }
  return null;
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

const roomUid = () => (typeof process.getuid === 'function' ? process.getuid() : 1000);

// --- the checks -------------------------------------------------------------------

const q = (v) => JSON.stringify(v);
const isBool = (v) => v === true || v === false;
const LOOPBACK = (h) => h === 'localhost' || h === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
const TOOL_RX = /^[A-Za-z0-9_.-]{1,128}\*?$/;
const ENV_NAME_RX = /^[A-Z_][A-Z0-9_]{0,63}$/;
const ENV_RESERVED = new Set(['PATH', 'HOME', 'LANG', 'USER']);
const LANG_RX = /^[a-z]{2}$/;
const nonEmptyStrings = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== '');

/**
 * The first fatal line for the `cockpit` keys, or null. Pure apart from the
 * injected `deps` (S-ONE-12 injects them): `lookupUser(name) -> {uid}|null`,
 * `uid` (the room's own), `isDir(path)`, `home`. `layers` is config.mjs's
 * `{file, env}` (D245 needs to know which layer an agent key came from).
 */
export function cockpitProblem(c, layers = {}, deps = {}) {
  const look = deps.lookupUser ?? lookupUser;
  const uid = deps.uid ?? roomUid();
  const dirOk = deps.isDir ?? isDir;
  const k = c.cockpit;
  if (!isObj(k)) return 'cockpit must be an object';
  const fileAgent = has(layers.file?.cockpit, 'agent') && layers.file.cockpit.agent !== null;

  // D245: a room is made in the file; an env variable alone does not make one.
  if (!fileAgent && isObj(layers.env?.cockpit?.agent)) {
    const first = Object.keys(AGENT_ENV).find((key) => has(layers.env.cockpit.agent, key));
    if (first) return `${AGENT_ENV[first]} is set, but the config file has no cockpit.agent; a room is made in the file (docs/cockpit.md)`;
  }
  const agent = k.agent;
  if (agent !== null && !isObj(agent)) return 'cockpit.agent must be an object (protocols.md §11.12)';
  // D128: the room never runs inside a hub; a room alone needs its agent.
  if (agent && c.mode === 'hub') return 'cockpit.agent on a hub: run the room as its own process, mode cockpit (D91)';
  if (!agent && c.mode === 'cockpit') return 'mode cockpit needs cockpit.agent';
  // D129: forwarded is a boolean, and never together with the room itself.
  if (!isBool(k.forwarded)) return 'cockpit.forwarded: must be true or false';
  if (k.forwarded && agent) return 'cockpit.forwarded and cockpit.agent: this process is the room, drop forwarded';
  // D129: forwarded is the only key a hub's cockpit section may hold (B38).
  if (c.mode === 'hub' && isObj(layers.file?.cockpit)) {
    const other = Object.keys(layers.file.cockpit).find((key) => key !== 'forwarded');
    if (other) return `cockpit.${other} on a hub: a hub's cockpit section holds only cockpit.forwarded (D129)`;
  }
  // D128 and README "Ports": a room alone listens on 127.0.0.1 only (B39).
  if (c.mode === 'cockpit') {
    if (!Array.isArray(c.bind) || c.bind.length !== 1 || c.bind[0] !== '127.0.0.1') {
      return `bind: a room alone (mode cockpit) listens on 127.0.0.1 only, got ${q(c.bind)}`;
    }
    if (c.fleet?.ingressPort !== null && c.fleet?.ingressPort !== undefined) {
      return 'fleet.ingressPort: a room alone (mode cockpit) has no ingress listener; its front forwards /api/cockpit/ to 127.0.0.1 (D91)';
    }
  }
  // D58, D260: the MCP server's port, on 127.0.0.1; 0 is any free port.
  const mp = k.mcp?.port;
  if (!Number.isInteger(mp) || mp < 0 || mp > 65535) return `cockpit.mcp.port: must be a port number, or 0 for any free port, got ${q(mp)}`;
  // c3-see.md §2: the board the agent reads, over plain HTTP(S) (B40).
  const bu = k.board?.url;
  let u = null;
  try { u = new URL(bu); } catch { /* reported below */ }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || u.search || u.hash || String(bu).includes('?')) {
    return `cockpit.board.url: must be an http(s) URL with no credentials or query, got ${q(bu)}`;
  }
  const sttLine = sttProblem(k.stt);
  if (sttLine) return sttLine;
  return agent ? agentProblem(agent, { look, uid, dirOk, stateDir: c.stateDir, home: deps.home }) : null;
}

/** c2-voice.md §9: the speech service's keys. */
function sttProblem(s) {
  if (!isObj(s)) return 'cockpit.stt must be an object';
  if (s.url !== 'none') {
    let u = null;
    try { u = new URL(s.url); } catch { /* below */ }
    if (!u || (u.protocol !== 'ws:' && u.protocol !== 'wss:')) return `cockpit.stt.url: must be "none" or a ws:// or wss:// URL, got ${q(s.url)}`;
    if (u.username || u.password) return 'cockpit.stt.url: must not carry credentials (put the token in cockpit.stt.tokenFile)';
    if (u.search || u.hash || String(s.url).includes('?')) return 'cockpit.stt.url: must have no query or fragment (the room adds language and mode itself)';
    if (u.protocol === 'ws:' && !LOOPBACK(u.hostname)) return 'cockpit.stt.url: ws:// only on a loopback host; use wss://';
  }
  const lang = s.language;
  const langOk = lang === 'auto' || (typeof lang === 'string' && LANG_RX.test(lang))
    || (Array.isArray(lang) && lang.length > 0 && lang.every((x) => typeof x === 'string' && LANG_RX.test(x)));
  if (!langOk) return `cockpit.stt.language: must be "auto", a two-letter code or a list of them ("en" or ["en","de"]), got ${q(lang)}`;
  if (s.tokenFile !== null && (typeof s.tokenFile !== 'string' || s.tokenFile === '')) return 'cockpit.stt.tokenFile: must be a path or unset';
  // D183: v1 speaks one protocol; ignored when url is none.
  if (s.url !== 'none' && s.protocol !== 'whisperlivekit') {
    return `cockpit.stt.protocol: ${q(s.protocol)} is not supported; v1 speaks "whisperlivekit" only (put a shim in front of another service, docs/cockpit.md)`;
  }
  return null;
}

/** protocols.md §11.12's fatal table, first row that holds wins. */
function agentProblem(a, { look, uid, dirOk, stateDir, home }) {
  // D243: two dialects.
  if (!AGENT_KINDS.includes(a.kind)) return `cockpit.agent.kind: ${q(a.kind)} is not supported; use "claude-code" or "bridge" (docs/cockpit.md)`;
  // D244: the argv, no shell; the room sets claude-code's flags itself.
  if (a.command === undefined && a.kind === 'bridge') {
    return 'cockpit.agent.command: required for kind bridge (the argv of a program that speaks the bridge protocol, docs/cockpit.md)';
  }
  if (!nonEmptyStrings(a.command)) return 'cockpit.agent.command: must be an array of strings, one per argument (["claude"])';
  if (a.kind === 'claude-code') {
    const f = a.command.slice(1).find((x) => x.startsWith('-'));
    if (f !== undefined) {
      return `cockpit.agent.command: ${q(f)} is a flag; for kind claude-code the room sets the flags itself (protocols.md §11.2); a model goes in cockpit.agent.env (ANTHROPIC_MODEL)`;
    }
  }
  const userSet = a.user !== null && a.user !== undefined;
  // D217: sudo's secure_path; the sudoers rule names one exact program.
  if (userSet && !path.isAbsolute(a.command[0])) {
    return 'cockpit.agent.command: with cockpit.agent.user the program needs an absolute path (/var/lib/lb-agent/.local/bin/claude)';
  }
  // D246: an absolute, existing cwd; the default is made by the room at start.
  const cwd = fillPath(a.cwd, { stateDir, home });
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return `cockpit.agent.cwd: ${q(a.cwd)} must be an absolute path`;
  if (a.cwd !== DEFAULT_CWD && !dirOk(cwd)) return `cockpit.agent.cwd: ${cwd} is not a directory`;
  // D214: the agent's own unix user, never root, never the room's.
  if (userSet) {
    if (typeof a.user !== 'string' || !USER_RX.test(a.user)) return `cockpit.agent.user: ${q(a.user)} is not a user name`;
    const u = look(a.user);
    if (!u) return `cockpit.agent.user: no user ${q(a.user)} on this machine (laneboard cockpit agent-user prints the commands to make one)`;
    if (u.uid === 0) return `cockpit.agent.user: ${q(a.user)} would give the agent every file and process; give it its own user (laneboard cockpit agent-user)`;
    if (u.uid === uid) {
      return `cockpit.agent.user: ${q(a.user)} is the room's own user; give the agent its own (laneboard cockpit agent-user), or leave it unset and see cockpit.agent.allowSameUser`;
    }
  }
  for (const key of ['allowSameUser', 'allowUnrestricted']) {
    if (!isBool(a[key])) return `cockpit.agent.${key}: must be true or false`;
  }
  // Q-O36 b): the agent on the room's own user only when the owner says so.
  if (!userSet && a.allowSameUser !== true) {
    return `cockpit.agent.user is not set: the agent would run as you (uid ${uid}) and read every file you can. Give it its own user (laneboard cockpit agent-user), or set cockpit.agent.allowSameUser: true to accept that (docs/cockpit.md).`;
  }
  // D241: no tool limit only for a bridge agent on its own user.
  if (a.allowUnrestricted === true && a.kind === 'claude-code') {
    return 'cockpit.agent.allowUnrestricted: only for kind bridge; claude-code is limited by cockpit.agent.allowedTools';
  }
  if (a.allowUnrestricted === true && !userSet) {
    return 'cockpit.agent.allowUnrestricted needs cockpit.agent.user: an agent with no tool limit must not run as you';
  }
  // D240, Q-O23 a): tool names, or a prefix ending in *.
  if (!Array.isArray(a.allowedTools) || !a.allowedTools.length) return `cockpit.agent.allowedTools: ${q(a.allowedTools)} is not a tool name or a prefix ending in *`;
  const badTool = a.allowedTools.find((t) => typeof t !== 'string' || !TOOL_RX.test(t));
  if (badTool !== undefined) return `cockpit.agent.allowedTools: ${q(badTool)} is not a tool name or a prefix ending in *`;
  // D108: names only; the room's own variables stay the room's.
  if (!Array.isArray(a.env)) return `cockpit.agent.env: ${q(a.env)} is not an environment variable name`;
  const badName = a.env.find((n) => typeof n !== 'string' || !ENV_NAME_RX.test(n));
  if (badName !== undefined) return `cockpit.agent.env: ${q(badName)} is not an environment variable name`;
  const reserved = a.env.find((n) => ENV_RESERVED.has(n) || n.startsWith('LANEBOARD_'));
  if (reserved !== undefined) return `cockpit.agent.env: ${reserved} is set by the room itself`;
  // D151: the login check's argv.
  if (a.loginCheck !== null && !nonEmptyStrings(a.loginCheck)) return 'cockpit.agent.loginCheck: must be null or an array of strings (["claude","auth","status"])';
  // D247, pending Q-O28.
  const m = a.maxTurnsPerHour;
  if (!Number.isInteger(m) || m < 0 || m > MAX_TURNS_PER_HOUR_MAX) return `cockpit.agent.maxTurnsPerHour: ${q(m)} is not a whole number from 0 to ${MAX_TURNS_PER_HOUR_MAX}`;
  return null;
}

export function validate(c, bad, layers = {}) {
  const line = cockpitProblem(c, layers);
  if (line) bad(line);
}

/**
 * The lines the room prints once on stderr at start, not fatal (protocols.md
 * §11.12, §11.11, single-machine.md §4). `env` is the room's environment.
 */
export function startLines(c, { env = process.env, uid = roomUid() } = {}) {
  const a = c.cockpit?.agent;
  if (!isObj(a)) return [];
  const out = [];
  for (const n of a.env ?? []) {
    if (env[n] === undefined) out.push(`cockpit.agent.env: ${n} is not set here; the agent starts without it`);
  }
  if ((a.user === null || a.user === undefined) && a.allowSameUser === true) {
    out.push(`cockpit: the agent runs as you (uid ${uid}): it can read every file you can, ~/.ssh included. Pairing is off (agent-is-room).`);
  }
  if (a.allowUnrestricted === true) {
    out.push(`cockpit.agent.allowUnrestricted is true: the agent's tools are not limited; only its own user (${a.user}) keeps it off your files and the board's state.`);
  }
  return out;
}

/** What the page's `hello.cockpit` says (D17, D93, D129): this process is a room, or forwards to one. */
export function cockpitConfigured(c) {
  return isObj(c?.cockpit?.agent) || c?.cockpit?.forwarded === true;
}
