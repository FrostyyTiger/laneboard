// The bridge: the room's side of its agent (spec protocols.md §11.1-§11.5,
// §11.9, §11.11; D100-D102, D105, D108, D240-D242). A module of the room
// process, not a process of its own: it starts one agent child per session,
// talks to it in JSON lines, and turns what it says into the screen messages
// of part 1 (§3.2), which it hands to `emit` without `seq` (the room link
// numbers and sends them, T13/T14).
//
//   createBridge(opts) → bridge
//     .start({session, resume})   spawns the child (§11.2 / §11.11); the
//                                 session is up at its `ready`
//     .prompt(p)                  a screen's prompt → Promise<{ok, turnId,
//                                 delivery} | {ok:false, code:'agent-down'}>
//     .interrupt({cancelQueued})  writes an `interrupt`, returns its id (§11.6
//                                 times it, T11)
//     .signal(name)               SIGINT/SIGTERM/SIGKILL to the child (§11.1)
//     .close()                    stdin closed, the child ended; resolves at its exit
//     .state                      'down' | 'starting' | 'up' | 'refused'
//     .session, .ready, .turn, .stderrTail(), .pid
//
// opts: `agent` (config.cockpit.agent, finalized), `stateDir`, `emit(msg)`,
// `log(line)`, `env` (the room's environment), `mcpToken`, `instructions`
// (§11.8's text), `spawn` (child_process.spawn, injectable), `redactText`,
// `redactInput` (T10's module, identity until then), `onReady(ev)`,
// `onExit({code, signal, beforeReady, why})`, `onCondition(code, fields)`
// (a status condition the bridge sets: a refused start's `agent-down`).
//
// Restarts, the stop timing and new sessions are §11.6-§11.7's (T11): the
// bridge restarts only the child it killed itself for §11.9 (B61).
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fillPath } from '../config/cockpit.mjs';
import { checkBridgeEvent } from './bridge-events.mjs';
import { createClaudeCodeAdapter, launchArgs, DETAIL_MAX } from './agents/claude-code.mjs';
import { standingInstructions } from './agents/instructions.mjs';
import { entryCovered, toolAllowed } from './allowlist.mjs';
import * as clock from './clock.mjs';
import { isoAt } from './iso.mjs';

/** §11.9 (D105): a turn with no stdout line at all for this long is dead. */
export const LIVENESS_MS = 300_000;
export const LIVENESS_DETAIL = 'no sign of life from the agent for 5 min';
/** §11.9: a `prompt` that cannot be written in this long. */
export const STDIN_WRITE_MS = 5_000;
/** §11.3: a line over this is dropped unread. */
export const MAX_LINE_BYTES = 16 * 1024 * 1024;
/** §11.1: the stderr lines kept for `detail`, and their length. */
export const STDERR_KEEP = 20;
/** §11.11: a refused start's SIGTERM after its stdin is closed. */
export const REFUSED_TERM_MS = 5_000;
/** D97: a tool input's strings and its whole JSON, as screens get them. */
export const INPUT_STRING_MAX = 200;
export const INPUT_JSON_MAX = 2_000;

/** D108: the only names of the room's environment the child gets, besides `cockpit.agent.env`. */
export const BASE_ENV = Object.freeze(['PATH', 'HOME', 'LANG', 'USER']);

const cut = (s, n = DETAIL_MAX) => (String(s).length > n ? String(s).slice(0, n) : String(s));
const pad = (n, w) => String(n).padStart(w, '0');

/**
 * The agent's `prompt.text` (§11.5): the about line (c3-see.md §9.4, D66: id
 * and screen as JSON strings, the id cut to 128), the spoken line (D106), then
 * the owner's words; joined by one `\n`.
 */
export function agentPromptText({ text, source, lang, about, screen }) {
  const out = [];
  if (about !== null && about !== undefined && about !== '') {
    out.push(`(The owner is asking about node ${JSON.stringify(String(about).slice(0, 128))} on screen ${JSON.stringify(String(screen ?? ''))}. Call focus to see it.)`);
  }
  if (source === 'spoken') {
    const said = lang === 'de' ? 'Spoken in German' : lang === 'en' ? 'Spoken in English' : 'Spoken';
    out.push(`(${said}; speech-to-text may have misheard a word.)`);
  }
  out.push(String(text));
  return out.join('\n');
}

/**
 * D97: every string of a tool's input cut to 200 characters, and the whole
 * object at most 2 000 characters of JSON, else `{"…":"cut"}`.
 */
export function shapeInput(input) {
  const walk = (v, depth) => {
    if (typeof v === 'string') return v.length > INPUT_STRING_MAX ? v.slice(0, INPUT_STRING_MAX) : v;
    if (v === null || typeof v !== 'object') return v;
    if (depth > 20) return '…';
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const o = {};
    for (const [k, x] of Object.entries(v)) o[walk(k, depth + 1)] = walk(x, depth + 1);
    return o;
  };
  const out = walk(input && typeof input === 'object' && !Array.isArray(input) ? input : {}, 0);
  return JSON.stringify(out).length > INPUT_JSON_MAX ? { '…': 'cut' } : out;
}

/**
 * The child's environment (D108): PATH, HOME, LANG, USER, LANEBOARD_MCP_TOKEN
 * and the names of `cockpit.agent.env` that the room's environment holds;
 * `extra` (a bridge agent's LANEBOARD_* names, D242) on top. Nothing else.
 */
export function childEnv({ env, names = [], mcpToken = null, extra = {} }) {
  const out = {};
  for (const k of [...BASE_ENV, ...names]) if (env[k] !== undefined) out[k] = env[k];
  if (mcpToken) out.LANEBOARD_MCP_TOKEN = mcpToken;
  return { ...out, ...extra };
}

/**
 * The argv the room spawns (§11.1, §11.2, §11.11), no shell: `{command…}`
 * and, for claude-code, §11.2's arguments; with `user`, behind
 * `sudo -n -u {user} -H --preserve-env=LANEBOARD_MCP_TOKEN,{names} --` (D214).
 */
export function spawnArgv({ agent, stateDir, instructions, session, resume, envNames }) {
  const argv = [...agent.command];
  if (agent.kind === 'claude-code') {
    argv.push(...launchArgs({
      mcpConfig: path.join(stateDir, 'cockpit-agent', 'mcp.json'),
      allowedTools: agent.allowedTools, instructions, session, resume,
    }));
  }
  if (!agent.user) return argv;
  return ['sudo', '-n', '-u', agent.user, '-H', `--preserve-env=${envNames.join(',')}`, '--', ...argv];
}

export function createBridge(opts) {
  const {
    agent, stateDir, emit = () => {}, log = () => {}, env = process.env, mcpToken = null,
    instructions = standingInstructions(), spawn = nodeSpawn,
    redactText = (s) => s, redactInput = (o) => o,
    onReady = () => {}, onExit = () => {},
  } = opts;
  if (!agent || (agent.kind !== 'claude-code' && agent.kind !== 'bridge')) throw new TypeError('createBridge: agent.kind must be claude-code or bridge');
  const onCondition = opts.onCondition ?? ((code, fields) => emit({ type: 'status', status: { code, since: isoAt(clock.now()), ...fields } }));
  const cwd = fillPath(agent.cwd, { stateDir });
  // §11.11 fence 3 runs for a bridge agent unless the owner lifted it (D241).
  const checkTools = agent.kind === 'bridge' && agent.allowUnrestricted !== true;

  let child = null;
  let state = 'down';
  let session = null;
  let readyEv = null;
  let refused = false;
  let killedFor = null; // 'liveness' | 'stdin' | 'refused' | 'close'
  let adapter = null;
  const stderrLines = [];
  let interruptCounter = 0;
  let turnCounter = 0;
  let turn = null;
  // Prompts written (or held for a session that cannot steer), by bridge id.
  const prompts = new Map();
  const held = [];
  let livenessTimer = null;

  // ------------------------------------------------------------------ child

  function start({ session: id = randomUUID(), resume = false } = {}) {
    if (refused) return false; // §11.11: no restart until the room starts again
    if (child) throw new Error('bridge.start: a child is running');
    session = id;
    readyEv = null;
    killedFor = null;
    const extra = {};
    if (agent.kind === 'bridge') {
      // D242 and §11.8: a bridge agent's session, allowlist and instructions.
      extra.LANEBOARD_SESSION = id;
      if (resume) extra.LANEBOARD_SESSION_RESUME = '1';
      extra.LANEBOARD_ALLOWED_TOOLS = JSON.stringify(agent.allowedTools);
      const file = path.join(stateDir, 'cockpit-agent', 'instructions.txt');
      writeInstructions(file);
      extra.LANEBOARD_COCKPIT_INSTRUCTIONS = file;
    }
    const names = (agent.env ?? []).filter((n) => env[n] !== undefined);
    const childEnvironment = childEnv({ env, names, mcpToken, extra });
    // sudo passes on only what --preserve-env names (and sets HOME, USER itself with -H).
    const envNames = ['LANEBOARD_MCP_TOKEN', ...names, ...Object.keys(extra)];
    const argv = spawnArgv({ agent, stateDir, instructions, session: id, resume, envNames });
    adapter = agent.kind === 'claude-code'
      ? createClaudeCodeAdapter({ allowedTools: agent.allowedTools, write: (o) => writeLine(o), log })
      : null;
    state = 'starting';
    let c;
    try {
      // §11.1: no shell; its own process group when the room may signal it.
      c = spawn(argv[0], argv.slice(1), { cwd, env: childEnvironment, stdio: ['pipe', 'pipe', 'pipe'], detached: !agent.user });
    } catch (err) {
      state = 'down';
      log(`cockpit agent: cannot start ${argv[0]}: ${err.message}`);
      queueMicrotask(() => onExit({ code: null, signal: null, beforeReady: true, why: 'spawn', error: err.message }));
      return false;
    }
    child = c;
    readLines(c.stdout, (line) => fromAgent(line));
    readLines(c.stderr, (line) => {
      log(`cockpit agent stderr: ${line.slice(0, 500)}`);
      stderrLines.push(cut(line));
      if (stderrLines.length > STDERR_KEEP) stderrLines.shift();
    }, { quiet: true });
    c.stdin.on('error', (err) => log(`cockpit agent: stdin ${err.code ?? err.message}`));
    c.on('error', (err) => {
      log(`cockpit agent: ${err.message}`);
      stderrLines.push(cut(err.message));
      if (stderrLines.length > STDERR_KEEP) stderrLines.shift();
    });
    c.on('close', (code, signal) => exited(c, code, signal));
    log(`cockpit agent: started pid ${c.pid} (${agent.kind}, ${resume ? 'resume' : 'new'} session ${id})`);
    return true;
  }

  function writeInstructions(file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
      // The agent's user reads it (D209: the directory is 0755, the room's).
      fs.writeFileSync(file, `${instructions}\n`, { mode: 0o644 });
    } catch (err) {
      log(`cockpit agent: cannot write ${file}: ${err.message}`);
    }
  }

  /** One JSON line per call, `\n` ended; resolves true once written, false after 5 s or an error. */
  function writeLine(obj) {
    const c = child;
    if (!c || !c.stdin.writable) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clock.clearTimeout(timer);
        resolve(ok);
      };
      const timer = clock.setTimeout(() => finish(false), STDIN_WRITE_MS);
      try {
        c.stdin.write(`${JSON.stringify(obj)}\n`, (err) => finish(!err));
      } catch {
        finish(false);
      }
    });
  }

  function toAgent(ev) {
    return writeLine(adapter ? adapter.toAgent(ev) : ev);
  }

  /** §11.1 "Signals": the process group without `user`, else the sudo process. */
  function signal(name) {
    const c = child;
    if (!c || c.exitCode !== null || c.signalCode !== null) return false;
    try {
      if (!agent.user && c.pid) process.kill(-c.pid, name);
      else c.kill(name);
      return true;
    } catch {
      try { return c.kill(name); } catch { return false; }
    }
  }

  function exited(c, code, signalName) {
    if (c !== child) return;
    child = null;
    disarmLiveness();
    const beforeReady = state === 'starting';
    const why = killedFor;
    if (state !== 'refused') state = 'down';
    if (turn && why !== 'liveness') endTurn({ state: 'error', code: 'agent-exited' });
    for (const [id, p] of prompts) if (!p.taken) prompts.delete(id);
    log(`cockpit agent: exited (${signalName ?? `code ${code}`})${why ? ` after ${why}` : ''}`);
    onExit({ code, signal: signalName, beforeReady, why });
    // §11.9: the child the bridge killed for silence or a stuck stdin goes on
    // with its session at once; every other restart is §11.7's (T11).
    if ((why === 'liveness' || why === 'stdin') && session) start({ session, resume: true });
  }

  function close() {
    const c = child;
    if (!c) return Promise.resolve();
    killedFor = killedFor ?? 'close';
    return new Promise((resolve) => {
      c.once('close', () => resolve());
      try { c.stdin.end(); } catch { /* gone */ }
      signal('SIGTERM');
      const t = setTimeout(() => signal('SIGKILL'), 2000);
      t.unref?.();
      c.once('close', () => clearTimeout(t));
    });
  }

  // ------------------------------------------------------------- stdout lines

  /** Splits a stream into lines; a line over 16 MB is dropped unread and logged (§11.3). */
  function readLines(stream, onLine, { quiet = false } = {}) {
    let parts = [];
    let size = 0;
    let dropping = false;
    stream.on('data', (chunk) => {
      let from = 0;
      for (;;) {
        const nl = chunk.indexOf(10, from);
        const piece = chunk.subarray(from, nl < 0 ? chunk.length : nl);
        if (!dropping) {
          size += piece.length;
          if (size > MAX_LINE_BYTES) {
            dropping = true;
            parts = [];
            if (!quiet) log('cockpit agent: a line over 16 MB dropped unread');
          } else parts.push(piece);
        }
        if (nl < 0) break;
        if (!dropping) {
          const line = Buffer.concat(parts).toString('utf8');
          if (line.trim()) onLine(line);
        }
        parts = [];
        size = 0;
        dropping = false;
        from = nl + 1;
      }
      // Any line at all is a sign of life (§11.9); a long one counts while it comes.
      if (!quiet) seenLife();
    });
    stream.on('error', () => {});
  }

  function fromAgent(raw) {
    let o;
    try { o = JSON.parse(raw); } catch { o = null; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.type !== 'string') {
      log(`cockpit agent: not understood: ${raw.slice(0, 200)}`);
      return;
    }
    if (adapter) {
      for (const ev of adapter.fromAgent(o)) handle(ev);
      return;
    }
    const chk = checkBridgeEvent(o, 'from-agent');
    if (!chk.ok) {
      log(`cockpit agent: ${chk.code === 'unknown-type' ? 'unknown type' : chk.message}: ${raw.slice(0, 200)}`);
      return;
    }
    handle(o);
  }

  // ------------------------------------------------------------------ liveness

  function armLiveness() {
    disarmLiveness();
    livenessTimer = clock.setTimeout(silent, LIVENESS_MS);
  }
  function disarmLiveness() {
    if (livenessTimer) clock.clearTimeout(livenessTimer);
    livenessTimer = null;
  }
  function seenLife() {
    if (turn) armLiveness();
  }
  function silent() {
    livenessTimer = null;
    if (!turn) return;
    // D105: E8, then the session goes on (resumed at the exit).
    log(`cockpit agent: no line for ${LIVENESS_MS / 1000} s in turn ${turn.turnId}; SIGTERM`);
    endTurn({ state: 'error', code: 'failed', detail: LIVENESS_DETAIL });
    killedFor = 'liveness';
    signal('SIGTERM');
  }

  // ------------------------------------------------------------------- events

  function handle(ev) {
    switch (ev.type) {
      case 'ready': return onReadyEvent(ev);
      case 'taken': return onTaken(ev.id);
      case 'interrupted': return onInterrupted(ev);
      default: break;
    }
    if (!turn || !turn.started) {
      // D33: what an agent says outside a turn the room holds is logged, never shown.
      log(`cockpit agent: ${ev.type} outside a turn, dropped`);
      return;
    }
    switch (ev.type) {
      case 'text.delta': {
        seeBlock(ev.block);
        setState('answering');
        send({ type: 'text.delta', turnId: turn.turnId, blockIndex: ev.block, text: redactText(ev.text), sentAt: clock.now() });
        break;
      }
      case 'text.block':
        seeBlock(ev.block);
        send({ type: 'text.block', turnId: turn.turnId, blockIndex: ev.block, text: redactText(ev.text) });
        break;
      case 'tool.start': return onToolStart(ev);
      case 'tool.end': return onToolEnd(ev);
      case 'retrying':
        send({ type: 'turn.retrying', turnId: turn.turnId, attempt: ev.attempt, of: ev.of });
        break;
      case 'turn.end':
        endTurn(ev);
        break;
      default:
        break;
    }
  }

  function onReadyEvent(ev) {
    if (state !== 'starting') {
      log('cockpit agent: a second ready, ignored');
      return;
    }
    if (checkTools) {
      // §11.11 fence 3, at ready (D240): the list the agent says it enforces
      // must be there and inside cockpit.agent.allowedTools.
      if (!Array.isArray(ev.allowlist)) return refuse('the agent declares no tool allowlist (see cockpit.agent.allowUnrestricted)');
      const wider = ev.allowlist.find((e) => !entryCovered(e, agent.allowedTools));
      if (wider !== undefined) return refuse(`the agent allows ${wider}, outside cockpit.agent.allowedTools`);
    }
    readyEv = ev;
    state = 'up';
    log(`cockpit agent: ready (${ev.agent ?? agent.kind}, session ${ev.session}, mcp ${ev.mcp?.laneboard ?? 'none'})`);
    onReady(ev);
  }

  function onToolStart(ev) {
    seeBlock(ev.block);
    if (checkTools && ev.denied !== true && !toolAllowed(ev.tool, agent.allowedTools)) {
      // §11.11 fence 3, the tripwire (D240): nothing drawn, the turn ends E8,
      // the child is stopped as a refused start.
      const detail = cut(`the agent called ${ev.tool}, outside its allowlist`);
      toAgent({ type: 'interrupt', id: nextInterruptId(), cancelQueued: true });
      endTurn({ state: 'error', code: 'failed', detail });
      refuse(detail);
      return;
    }
    const tu = `tu-${pad(++turn.tools.counter, 2)}`;
    const startedAt = isoAt(clock.now());
    const input = shapeInput(redactInput(ev.input));
    if (ev.denied === true) {
      // A bridge agent's own refusal: one tool.start with denied and no tool.end
      // (D242); the screens get the pair a refused call always has (B62).
      send({ type: 'tool.start', turnId: turn.turnId, blockIndex: ev.block, toolUseId: tu, tool: ev.tool, input, startedAt });
      send({ type: 'tool.end', turnId: turn.turnId, toolUseId: tu, endedAt: startedAt, isError: true, denied: true });
      return;
    }
    turn.tools.byId.set(ev.toolUseId, { tu, running: true });
    turn.tools.running += 1;
    setState('working');
    send({ type: 'tool.start', turnId: turn.turnId, blockIndex: ev.block, toolUseId: tu, tool: ev.tool, input, startedAt });
  }

  function onToolEnd(ev) {
    const rec = turn.tools.byId.get(ev.toolUseId);
    if (!rec || !rec.running) {
      log(`cockpit agent: tool.end for ${String(ev.toolUseId).slice(0, 64)} with no running call, dropped`);
      return;
    }
    rec.running = false;
    turn.tools.running -= 1;
    const denied = ev.denied === true;
    send({ type: 'tool.end', turnId: turn.turnId, toolUseId: rec.tu, endedAt: isoAt(clock.now()), isError: ev.isError === true || denied, denied });
    if (turn.tools.running === 0) setState('thinking');
  }

  function onTaken(id) {
    const p = prompts.get(id);
    if (!p) {
      log(`cockpit agent: taken for an unknown prompt ${String(id).slice(0, 64)}`);
      return;
    }
    if (p.taken) return;
    p.taken = true;
    if (turn && !turn.started && turn.prompt === id) {
      turn.started = true;
      setState('thinking');
    } else if (turn && turn.started) {
      // A steer into the running turn (§3.4).
      send({ type: 'prompt.taken', turnId: turn.turnId, clientId: p.clientId, state: 'taken', atBlock: turn.nextBlock });
    } else {
      // Taken as the next turn (§3.4, D258): the prompt, its take, its state.
      turn = newTurn(id);
      turn.started = true;
      send(turnPrompt(p, { turnId: turn.turnId, delivery: 'new', from: 'queued' }));
      send({ type: 'prompt.taken', turnId: turn.turnId, clientId: p.clientId, state: 'taken', atBlock: 0 });
      setState('thinking');
    }
  }

  function onInterrupted(ev) {
    log(`cockpit agent: interrupt ${ev.id} receipt: ${ev.cancelled.length} cancelled, ${ev.stillQueued.length} still queued`);
    for (const id of ev.cancelled) {
      const p = prompts.get(id);
      if (!p || p.taken) continue;
      prompts.delete(id);
      if (p.clientId) send({ type: 'prompt.taken', turnId: p.turnId, clientId: p.clientId, state: 'cancelled', why: 'stopped' });
    }
  }

  // --------------------------------------------------------------------- turns

  function newTurn(promptId) {
    turnCounter += 1;
    const t = { turnId: `t-${pad(turnCounter, 4)}`, prompt: promptId, started: false, state: null, nextBlock: 0,
      tools: { counter: 0, running: 0, byId: new Map() } };
    turn = t;
    armLiveness();
    return t;
  }

  function seeBlock(block) {
    if (Number.isInteger(block) && block + 1 > turn.nextBlock) turn.nextBlock = block + 1;
  }

  function setState(s) {
    if (!turn || turn.state === s) return;
    turn.state = s;
    send({ type: 'turn.state', turnId: turn.turnId, state: s });
  }

  function endTurn(ev) {
    if (!turn) return;
    const t = turn;
    turn = null;
    disarmLiveness();
    const msg = { type: 'turn.end', turnId: t.turnId, state: ev.state, at: isoAt(clock.now()) };
    if (ev.state === 'stopped') msg.forced = ev.forced === true;
    if (ev.state === 'error') {
      msg.code = ev.code;
      if (ev.code === 'step-limit') msg.steps = Number.isInteger(ev.steps) ? ev.steps : 0;
      if (ev.code === 'agent-down' || ev.code === 'failed') msg.detail = cut(ev.detail ?? ev.code);
    }
    // §11.4: one log line per turn with what it cost (`null` when the agent says nothing).
    log(`cockpit turn ${t.turnId}: ${ev.state}${ev.code ? ` ${ev.code}` : ''} steps ${ev.steps ?? null} costUsd ${ev.costUsd ?? null} durationMs ${ev.durationMs ?? null}`);
    send(msg);
    for (const [id, p] of prompts) if (p.taken || p.turnId === t.turnId && p.id === t.prompt) prompts.delete(id);
    // §3.4: a session that cannot steer gets its held prompts after the turn.
    for (const p of held.splice(0)) toAgent({ type: 'prompt', id: p.id, text: p.agentText, priority: 'next' });
  }

  function turnPrompt(p, { turnId, delivery, from }) {
    return {
      type: 'turn.prompt', turnId, clientId: p.clientId, screen: p.screen, text: p.text, source: p.source,
      lang: p.lang, about: p.about, at: p.at, receivedAt: p.receivedAt, delivery, ...(from ? { from } : {}),
    };
  }

  const send = (msg) => emit(msg);

  /**
   * A screen's prompt (already checked, protocol.mjs): `{clientId, screen,
   * text, source, lang, about, receivedAt}`. Written to the agent first; the
   * `turn.prompt` echo goes out once the line is written (§13.1: 2.96, 2.97).
   */
  async function prompt(p) {
    if (state !== 'up' || !child) return { ok: false, code: 'agent-down' }; // §11.7: never held
    const receivedAt = p.receivedAt ?? clock.now();
    const rec = {
      id: randomUUID(), clientId: p.clientId ?? null, screen: p.screen ?? null, text: String(p.text),
      source: p.source ?? 'typed', lang: p.lang ?? null, about: p.about ?? null,
      at: isoAt(receivedAt), receivedAt, taken: false, turnId: null,
    };
    rec.agentText = agentPromptText(rec);
    const delivery = turn ? 'queued' : 'new';
    if (delivery === 'new') newTurn(rec.id);
    rec.turnId = turn.turnId;
    prompts.set(rec.id, rec);
    if (delivery === 'queued' && readyEv?.canSteer === false) {
      held.push(rec);
      send(turnPrompt(rec, { turnId: rec.turnId, delivery }));
      return { ok: true, turnId: rec.turnId, delivery };
    }
    const ok = await toAgent({ type: 'prompt', id: rec.id, text: rec.agentText, priority: 'next' });
    if (!ok) {
      // §11.9: a prompt that cannot be written in 5 s; the child is killed and goes on resumed.
      prompts.delete(rec.id);
      if (delivery === 'new' && turn?.prompt === rec.id && !turn.started) { turn = null; disarmLiveness(); turnCounter -= 1; }
      log('cockpit agent: a prompt could not be written in 5 s; the child is killed');
      killedFor = 'stdin';
      signal('SIGKILL');
      return { ok: false, code: 'agent-down' };
    }
    send(turnPrompt(rec, { turnId: rec.turnId, delivery }));
    return { ok: true, turnId: rec.turnId, delivery };
  }

  function nextInterruptId() {
    interruptCounter += 1;
    return `i-${pad(interruptCounter, 4)}`;
  }

  function interrupt({ cancelQueued = true } = {}) {
    const id = nextInterruptId();
    toAgent({ type: 'interrupt', id, cancelQueued: cancelQueued === true });
    return id;
  }

  /** §11.11's refused start: stdin closed, SIGTERM after 5 s, no restart, `agent-down`. */
  function refuse(detail) {
    refused = true;
    state = 'refused';
    killedFor = 'refused';
    log(`agent refused: ${detail}`);
    try { child?.stdin.end(); } catch { /* gone */ }
    const c = child;
    const t = clock.setTimeout(() => { if (c === child) signal('SIGTERM'); }, REFUSED_TERM_MS);
    c?.once('close', () => clock.clearTimeout(t));
    onCondition('agent-down', { detail: cut(detail), blocksSend: true });
  }

  return {
    start, prompt, interrupt, signal, close,
    get state() { return state; },
    get session() { return session; },
    get ready() { return readyEv; },
    get turn() { return turn ? { turnId: turn.turnId, state: turn.state, started: turn.started } : null; },
    get pid() { return child?.pid ?? null; },
    stderrTail: () => [...stderrLines],
  };
}
