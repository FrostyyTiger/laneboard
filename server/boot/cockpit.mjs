// The room's entry point (spec README "The room process", D128).
//
//   startRoom(ctx)  the room inside a process that already listens: the one
//                   box, called by server/boot/builder.mjs after its own
//                   modules when `cockpit.agent` is set. Registers the room's
//                   routes and upgrades through `ctx` (later tasks: the room
//                   link, the bridge, the MCP server) and returns the room.
//   startRoom()     the process itself, as server/index.mjs and the room under
//                   test's wrapper (test/cockpit/stand-ins/room-under-test.mjs)
//                   call it: `mode: cockpit` is the room alone (listenAll,
//                   registerHealthz, startRoom, installSignalHandlers); `mode:
//                   builder` boots the board, which calls startRoom(ctx) (B1).
//
// The room alone answers /healthz and /api/cockpit/* and nothing else: every
// other path is 404 {"error":"not-found"} and an upgrade on any other path
// (`/ws`) is refused the same way (protocols.md §1). It never imports state,
// ws, terminals, the collectors or the board's routes (test/cockpit-room.test.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.mjs';
import { log } from '../log.mjs';
import { DEFAULT_CWD, fillPath, startLines } from '../config/cockpit.mjs';
import { auditFile } from '../fleet/paths.mjs';
import { agentWalk, fileProblems, lookupAgent, secretPaths } from '../cockpit/start-check.mjs';
import { createSession, readSessionFile } from '../cockpit/session.mjs';
import { createStore } from '../cockpit/store.mjs';
import { createLink } from '../cockpit/link.mjs';
import { roomSecrets } from '../cockpit/redact.mjs';
import { openAudit } from '../fleet/audit.mjs';
import * as roomClock from '../cockpit/clock.mjs';

/** The room's path on the page's origin, on both sides (D93). Not a config key. */
export const COCKPIT_PREFIX = '/api/cockpit';

const NOT_FOUND = JSON.stringify({ error: 'not-found' });

/** True for the paths a room alone serves: /healthz and the prefix (raw target, never decoded). */
export function isRoomPath(target) {
  const p = String(target ?? '').split('?')[0];
  return p === '/healthz' || p === COCKPIT_PREFIX || p.startsWith(`${COCKPIT_PREFIX}/`);
}

/**
 * The room inside a listening process. `ctx` is server/modules.mjs's
 * (route, upgrade, provide/use); `opts.env` the environment the start lines
 * look at. Returns the room: `{ cwd, stop() }`.
 */
export async function startRoom(ctx = null, opts = {}) {
  if (!ctx) return bootProcess();
  const agent = config.cockpit?.agent;
  if (!agent) return null;
  prepareRoomFiles();
  for (const line of startLines(config, { env: opts.env ?? process.env })) process.stderr.write(`${line}\n`);
  const cwd = fillPath(agent.cwd, { stateDir: config.stateDir });
  // protocols.md §11.7.1 "At room start", before the link accepts an upgrade
  // (the room alone listens only after this returns): the conversation read
  // back, repaired and trimmed, then the retention timer (every 3 600 s).
  const say = (line) => log.info(line);
  const store = createStore({ stateDir: config.stateDir, log: say });
  const started = roomClock.now();
  const loaded = store.load({ now: started, session: readSessionFile(config.stateDir, say) });
  store.retain(started);
  store.every();
  log.info(`cockpit: conversation ${loaded.conversation ?? '(new)'} with ${loaded.turns.length} turns`);
  // screens.md §6.4 (D164): the board's audit log on one box (its one
  // openAudit instance), the room's own file when it runs alone. A log that
  // cannot be opened refuses every prompt (D166), it does not stop the room.
  const ownAudit = ctx.audit ? null : openRoomAudit();
  const audit = ctx.audit ?? ownAudit;
  const env = opts.env ?? process.env;
  // B84: the link is the session's `emit`; the store folds every message,
  // begins the first conversation, and seeds the turn counter and the
  // once-only memory from what it loaded.
  let link = null;
  const session = createSession({
    stateDir: config.stateDir,
    emit: (msg) => link.emit(msg),
    log: say,
    cutTurn: loaded.cutTurn,
    onConversation: (rec, reason) => store.begin({ conversation: rec.conversation, startedAt: rec.startedAt, reason: reason ?? 'first' }),
    bridge: {
      agent, stateDir: config.stateDir, env, mcpToken: null, turnCounter: loaded.lastTurn,
      secrets: roomSecrets({ sttTokenFile: config.cockpit.stt?.tokenFile ?? null }),
    },
  });
  link = createLink({ session, store, audit, config, log: say, clientIds: loaded.clientIds });
  ctx.upgrade((req, socket, head, url) => link.handleUpgrade(req, socket, head, url));
  session.start();
  log.info(`cockpit: room up (agent ${agent.kind}, cwd ${cwd})`);
  return {
    cwd, store, loaded, session, link,
    stop: async () => {
      link.close();
      store.close();
      await session.close();
      try { ownAudit?.close(); } catch { /* already closed */ }
    },
  };
}

/** The room alone's audit log (screens.md §6.4: `$LANEBOARD_AUDIT_FILE`, else the state default). */
function openRoomAudit() {
  try {
    return openAudit({ file: auditFile(), builder: config.fleet?.id ?? null });
  } catch (err) {
    log.error(`cockpit: cannot open the audit log (${err?.code ?? err?.message}); every prompt is refused until the room restarts`);
    return null;
  }
}

let prepared = false;

/**
 * The room's directories and its start check, once per process, before any
 * port listens: the room alone calls it from startRoom(ctx) ahead of
 * listenAll, the one box from server/boot/builder.mjs ahead of its own.
 *
 * D209: `{stateDir}/cockpit/` 0700 and `{stateDir}/cockpit-agent/` 0755 (the
 * default cwd), both the room's; the state dir and the audit log's directory
 * 0700 when the room makes them (as server/fleet/audit.mjs does). A directory
 * that is there already keeps its mode: the check below judges it.
 * D210: a secret or state path another user could read stops the room, exit 1
 * and the one line (security.md §3, S-SEC-01). single-machine.md §3.3: with
 * `cockpit.agent.user`, one stderr line per directory on the agent's way to
 * its files that it cannot enter; not fatal.
 */
export function prepareRoomFiles({ env = process.env, exit = (code) => process.exit(code) } = {}) {
  const agent = config.cockpit?.agent;
  if (prepared || !agent) return;
  prepared = true;
  const stateDir = config.stateDir;
  const audit = auditFile({ env });
  fs.mkdirSync(path.dirname(audit), { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(stateDir, 'cockpit'), { recursive: true, mode: 0o700 });
  const agentDir = fillPath(DEFAULT_CWD, { stateDir });
  fs.mkdirSync(agentDir, { recursive: true, mode: 0o755 });
  // D246, D209: the agent's directory is the room's, 0755; a cwd the owner
  // set exists (config/cockpit.mjs) and is never written to.
  try { fs.chmodSync(agentDir, 0o755); } catch { /* not ours: the walk below names it */ }
  if (typeof process.getuid === 'function') {
    const problems = fileProblems(secretPaths({ config, auditFile: audit }), { uid: process.getuid() });
    if (problems.length) {
      process.stderr.write(`${problems[0].line}\n`);
      exit(1);
      return;
    }
  }
  if (agent.user) {
    const who = lookupAgent(agent.user);
    const cwd = fillPath(agent.cwd, { stateDir });
    if (who) for (const line of agentWalk([agentDir, cwd], { agent: who })) process.stderr.write(`${line}\n`);
  }
}

/** startRoom() without a ctx: this process is the room alone, or the board that holds it. */
async function bootProcess() {
  // server/index.mjs installs these first; the room under test's wrapper does not.
  if (!process.listenerCount('unhandledRejection')) {
    process.on('unhandledRejection', (err) => log.error('unhandledRejection', err?.stack || String(err)));
  }
  if (!process.listenerCount('uncaughtException')) {
    process.on('uncaughtException', (err) => log.error('uncaughtException', err?.stack || String(err)));
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (config.mode === 'builder') {
    await import('./builder.mjs');
    return null;
  }
  if (config.mode !== 'cockpit') throw new Error(`startRoom: mode ${JSON.stringify(config.mode)} has no room`);
  return bootRoomAlone();
}

async function bootRoomAlone() {
  const { listenAll, registerHealthz, installSignalHandlers, servers, shutdownHooks } = await import('./common.mjs');
  const { json } = await import('../http.mjs');
  const { createContext } = await import('../modules.mjs');
  registerHealthz(() => ({ mode: 'cockpit' }));
  const ctx = createContext({ config, log, mode: 'cockpit' });
  const room = await startRoom(ctx);
  shutdownHooks.push(() => room.stop());
  await listenAll({ onUpgrade: refuseOtherUpgrades });
  // http.mjs (fenced) serves public/ and the SPA fallback to any GET its
  // routes do not take; the room alone serves no page, so every listener's
  // request handler is wrapped to answer 404 off the room's paths. bind is
  // 127.0.0.1 alone and there is no ingress listener (config/cockpit.mjs), so
  // listenAll returns in the same tick as the one listen: no request comes in
  // before the wrap (B41).
  for (const server of servers) {
    const inner = server.listeners('request');
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      if (!isRoomPath(req.url)) return json(res, { error: 'not-found' }, 404);
      for (const fn of inner) fn.call(server, req, res);
    });
  }
  installSignalHandlers();
  log.info(`laneboard room up, pid ${process.pid}`);
  return room;
}

/** The room alone's own upgrade routing: off the prefix, a 404 like any other path. */
function refuseOtherUpgrades(req, socket) {
  if (isRoomPath(req.url) && String(req.url).split('?')[0] !== '/healthz') return false;
  try {
    socket.once('finish', () => socket.destroy());
    setTimeout(() => socket.destroy(), 1000).unref();
    socket.end(`HTTP/1.1 404 Not Found\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(NOT_FOUND)}\r\nConnection: close\r\n\r\n${NOT_FOUND}`);
  } catch {
    socket.destroy();
  }
  return true;
}
