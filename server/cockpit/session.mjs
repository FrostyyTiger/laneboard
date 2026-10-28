// The session supervisor: the room's agent session over time (spec
// protocols.md §11.6-§11.7, D103, D104, D289). It owns the bridge
// (bridge.mjs) and decides what the bridge does not: the stop's 5.0 / 8.0 /
// 10.0 s steps, every restart (at once, then 2, 4, 8, 16, 30 s, then every
// 30 s), the 30 s `ready` limit, `new`, the forced fresh start after two
// failed resumes, and `{stateDir}/cockpit/session.json`. Every timer runs on
// the room clock (clock.mjs), so a test drives it in `manual` mode.
//
//   createSession(opts) → session
//     .start()            room start: `--resume` the session of session.json, else a new one
//     .prompt(p)          bridge.prompt while a session is up, else `agent-down` (§11.7, D31)
//     .stop(turnId)       §3.3 → {ok:true} | {ok:false, code:'unknown-id'|'not-now'}
//     .newConversation()  §3.6 → {ok:true} | {ok:false, code:'not-now'}
//     .close()            timers off, the child ended
//     .bridge, .conversation, .session, .phase ('starting'|'up'|'down'|'renewing'|'refused'|'closed')
//
// opts: `bridge` (the createBridge() options; `emit`, `log` are shared),
// `stateDir`, `emit(msg)`, `log(line)`, `condition(code, fields | null)` (a
// status condition set or cleared; by default status.mjs's arbiter of §3.5,
// which sends the highest as `status`), `createBridge` (injectable),
// `checkSpawn` (the login check's spawn, injectable; the check runs when
// `bridge.agent.loginCheck` is an argv, protocols.md §11.10, login.mjs), `onConversation(rec,
// reason, from)` (a conversation was written to session.json at a `ready`: `reason`
// null for the first, `owner`, `forced`; `from` the one before it or null; the
// store begins it, B84; the link writes its `cockpit.new` line, T30), `cutTurn`
// (the room went down mid-turn: `agent-back` at the first ready, §11.7.1 step 3).
//
// The conversation's turns on disk (`conversation.jsonl`, §11.7.1) are T12's;
// this module keeps only session.json.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { childEnv, createBridge as realCreateBridge } from './bridge.mjs';
import { fillPath } from '../config/cockpit.mjs';
import { checkArgv, createLoginWatch, hasLoginWords, runLoginCheck } from './login.mjs';
import { createStatus } from './status.mjs';
import * as clock from './clock.mjs';
import { isoAt } from './iso.mjs';

/** §11.6 (D32, D103, D283): the forced stop, the SIGTERM, the SIGKILL, from the stop. */
export const STOP_FORCE_MS = 5_000;
export const STOP_TERM_MS = 8_000;
export const STOP_KILL_MS = 10_000;
/** §11.7 (D104, D289): the waits before each restart; the last one repeats. */
export const RESTART_STEPS_S = Object.freeze([0, 2, 4, 8, 16, 30]);
/** §11.7: no `ready` this long after a spawn is a failed start. */
export const READY_WAIT_MS = 30_000;
/** §11.7: a `--resume` start that exits non-zero this soon counts toward the forced fresh start. */
export const RESUME_FAIL_MS = 10_000;
/** §11.7: two such resumes in a row and the session is given up. */
export const RESUME_FAILS_MAX = 2;
/** §11.7 `new`: the SIGTERM after the stdin is closed; SIGKILL STOP_KILL_MS - STOP_TERM_MS later (B81). */
export const NEW_TERM_MS = 5_000;
/** c1-talk.md §10.1 row 7: `agent-back` is news, cleared after this (NEWS_MS, B80). */
export const NEWS_MS = 5_000;

const CONVERSATION = /^c-(\d{4,})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const sessionFilePath = (stateDir) => path.join(stateDir, 'cockpit', 'session.json');

/** The conversation after `id` (`c-0007` → `c-0008`); `c-0001` when there is none. */
export function nextConversation(id) {
  const m = CONVERSATION.exec(id ?? '');
  return `c-${String(m ? Number(m[1]) + 1 : 1).padStart(4, '0')}`;
}

/** session.json (§11.7), or null when it is missing or not one (logged). */
export function readSessionFile(stateDir, log = () => {}) {
  const file = sessionFilePath(stateDir);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code !== 'ENOENT') log(`cockpit session: cannot read ${file}: ${err.code ?? err.message}`);
    return null;
  }
  let o;
  try { o = JSON.parse(raw); } catch { o = null; }
  if (!o || typeof o !== 'object' || !CONVERSATION.test(o.conversation ?? '') || !UUID.test(o.session ?? '') || typeof o.startedAt !== 'string') {
    log(`cockpit session: ${file} is not a session file, a new session starts`);
    return null;
  }
  return { conversation: o.conversation, session: o.session, startedAt: o.startedAt };
}

/** session.json written whole (a temporary file renamed over it), mode 0600 in a 0700 directory. */
export function writeSessionFile(stateDir, rec) {
  const file = sessionFilePath(stateDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ conversation: rec.conversation, session: rec.session, startedAt: rec.startedAt })}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function createSession(opts) {
  const {
    stateDir, emit = () => {}, log = () => {}, createBridge = realCreateBridge,
    onConversation = () => {},
  } = opts;
  // protocols.md §3.5 (D152): every condition into one slot, the highest sent.
  const status = opts.condition ? null : createStatus({ emit, log });
  const condition = opts.condition ?? ((code, fields) => status.set(code, fields));

  let phase = 'down';
  let closed = false;
  let current = null; // session.json's record once a session was up: {conversation, session, startedAt}
  // What the next start asks for: resume `current.session`, or a new session (and why).
  let want = { resume: false, reason: null };
  let attempt = null; // the start in flight: {session, resume, at}
  let step = 0; // index into RESTART_STEPS_S for the next restart
  let failedStarts = 0;
  let resumeFails = 0;
  let downSince = null;
  let downShown = false;
  let cutTurn = opts.cutTurn === true; // an exit cut a turn (E2): `agent-back` at the next ready
  let stopping = null; // {turnId, timers[]}
  let renewing = null; // {timers[], waitTurn}
  let restartTimer = null;
  let readyTimer = null;
  let newsTimer = null;
  let replaceForced = false;
  let reloginTimer = null;
  let loginBlocked = false; // a failed start said the login words (§11.4's last row)

  const bridge = createBridge({
    ...opts.bridge, emit, log, restartOnKill: false, onCondition: condition,
    onReady, onExit, onTurnEnd,
  });
  const login = loginWatch();

  /** protocols.md §11.10: the login check, when `cockpit.agent.loginCheck` names one. */
  function loginWatch() {
    const agent = opts.bridge?.agent;
    if (!Array.isArray(agent?.loginCheck) || agent.loginCheck.length === 0) return null;
    const env = opts.bridge.env ?? process.env;
    const names = (agent.env ?? []).filter((n) => env[n] !== undefined);
    const run = () => runLoginCheck({
      argv: checkArgv(agent, names), cwd: fillPath(agent.cwd, { stateDir }),
      env: childEnv({ env, names }), ...(opts.checkSpawn ? { spawn: opts.checkSpawn } : {}),
    });
    return createLoginWatch({
      run, condition, log,
      idle: () => phase === 'up' && !bridge.turn && !stopping && !renewing && bridge.pid !== null,
      relogin: restartForLogin,
    });
  }

  /** §11.10: the login is back and no turn runs: the child restarts with `--resume`, no `agent-back`. */
  function restartForLogin() {
    if (phase !== 'up' || bridge.turn || stopping || renewing || bridge.pid === null) return;
    log('cockpit session: the login is back; the agent restarts with --resume to read it');
    want = { resume: current !== null, reason: null };
    replaceForced = true;
    bridge.closeStdin('login');
    // As `new` (B81): SIGTERM 5 s after a closed stdin without an exit.
    reloginTimer = later(() => { reloginTimer = null; if (replaceForced) bridge.signal('SIGTERM'); }, NEW_TERM_MS);
  }

  const later = (fn, ms) => clock.setTimeout(() => { if (!closed) fn(); }, ms);
  const clear = (h) => { if (h) clock.clearTimeout(h); };

  // ------------------------------------------------------------------ starts

  function start() {
    if (phase !== 'down') return;
    const file = readSessionFile(stateDir, log);
    if (file) {
      current = file;
      want = { resume: true, reason: null };
    } else {
      want = { resume: false, reason: null };
    }
    login?.start(); // §11.10: at the room's start, beside the first spawn
    spawnNow();
  }

  function spawnNow() {
    clear(restartTimer);
    restartTimer = null;
    if (closed) return;
    const resume = want.resume && current !== null;
    const id = resume ? current.session : randomUUID();
    attempt = { session: id, resume, at: clock.now() };
    phase = 'starting';
    const ok = bridge.start({ session: id, resume });
    if (bridge.state === 'refused') { phase = 'refused'; return; }
    // §11.7: no `ready` 30 s after the spawn is a failed start; the child is killed.
    if (ok) readyTimer = later(() => {
      readyTimer = null;
      if (bridge.state !== 'starting') return;
      log(`cockpit session: no ready ${READY_WAIT_MS / 1000} s after the start; the agent is killed`);
      bridge.kill('ready-wait');
    }, READY_WAIT_MS);
  }

  function scheduleRestart() {
    const wait = RESTART_STEPS_S[Math.min(step, RESTART_STEPS_S.length - 1)] * 1000;
    step += 1;
    phase = 'down';
    log(`cockpit session: restart in ${wait / 1000} s (${want.resume ? `resume ${current.session}` : 'new session'})`);
    if (wait === 0) spawnNow();
    else restartTimer = later(spawnNow, wait);
  }

  function onReady(ev) {
    clear(readyTimer);
    readyTimer = null;
    const asked = attempt;
    attempt = null;
    if (asked?.resume && ev.session !== asked.session) {
      // §11.7: the agent went on with another session than the one asked for.
      log(`cockpit session: asked to resume ${asked.session}, the agent says ${String(ev.session).slice(0, 64)}; a new session starts`);
      want = { resume: false, reason: 'forced' };
      replaceForced = true;
      bridge.kill('session-mismatch');
      return;
    }
    phase = 'up';
    step = 0;
    failedStarts = 0;
    resumeFails = 0;
    const isNew = !asked?.resume;
    if (isNew) {
      // A session is only written once its `ready` has come (§11.7).
      const reason = want.reason;
      const from = current?.conversation ?? null;
      const conversation = current ? nextConversation(current.conversation) : nextConversation(null);
      current = { conversation, session: asked?.session ?? ev.session, startedAt: isoAt(clock.now()) };
      try { writeSessionFile(stateDir, current); } catch (err) { log(`cockpit session: cannot write session.json: ${err.code ?? err.message}`); }
      log(`cockpit session: ${conversation} on session ${current.session}${reason ? ` (${reason})` : ''}`);
      onConversation(current, reason, from);
      if (reason) emit({ type: 'conversation.new', conversation, reason, at: current.startedAt });
      want = { resume: true, reason: null };
    }
    if (downShown) {
      downShown = false;
      condition('agent-down', null);
    }
    loginBlocked = false;
    login?.sessionUp();
    downSince = null;
    if (cutTurn) {
      // E2's second line (c1-talk.md §10.1 row 7): news, it goes after 5 s.
      cutTurn = false;
      condition('agent-back', {});
      clear(newsTimer);
      newsTimer = later(() => { newsTimer = null; condition('agent-back', null); }, NEWS_MS);
    }
  }

  function onExit({ code, beforeReady, why, turnId }) {
    clear(readyTimer);
    readyTimer = null;
    clear(reloginTimer);
    reloginTimer = null;
    const asked = attempt;
    attempt = null;
    if (closed) { phase = 'closed'; return; }
    if (why === 'refused' || bridge.state === 'refused') { phase = 'refused'; return; } // §11.11: no restart
    if (renewing) return renewNow();
    if (replaceForced) {
      replaceForced = false;
      return spawnNow();
    }
    if (stopping) {
      // §11.6 8.0 s: the stop ends with the session resumed at once, no status line.
      endStop();
      want = { resume: current !== null, reason: want.reason };
      phase = 'down';
      return spawnNow();
    }
    if (turnId) cutTurn = true;
    if (!beforeReady) {
      // The child exited outside a stop (E2 when a turn ran): resume, at once first.
      downSince = clock.now();
      step = 0;
      failedStarts = 0;
      resumeFails = 0;
      want = { resume: current !== null, reason: null };
      return scheduleRestart();
    }
    // A failed start: an exit before `ready`, or no `ready` in 30 s.
    failedStarts += 1;
    downSince ??= asked?.at ?? clock.now();
    const quick = asked && clock.now() - asked.at <= RESUME_FAIL_MS;
    if (asked?.resume && code !== 0 && code !== null && quick) resumeFails += 1;
    else resumeFails = 0;
    if (asked?.resume && resumeFails >= RESUME_FAILS_MAX) {
      // §11.7: two resumes in a row failed at once; the session is given up.
      log(`cockpit session: ${RESUME_FAILS_MAX} resumes of ${asked.session} failed; a new session starts`);
      want = { resume: false, reason: 'forced' };
      resumeFails = 0;
    }
    const lastLine = bridge.stderrTail().at(-1) ?? null;
    if (failedStarts >= 2 && login && !loginBlocked && hasLoginWords(lastLine)) {
      // §11.4's last row: a start that fails with the login words is `not-logged-in`
      // with `blocksSend` until a session is up, instead of `agent-down` (B214).
      loginBlocked = true;
      login.startFailed();
    } else if (failedStarts >= 2 && !downShown && !loginBlocked) {
      // E3 from the second failed start on, with the last stderr line (§11.7).
      downShown = true;
      condition('agent-down', { since: isoAt(downSince), detail: lastLine ?? `the agent exited (code ${code})`, blocksSend: true });
    }
    scheduleRestart();
  }

  // -------------------------------------------------------------------- stop

  function stop(turnId) {
    const t = bridge.turn;
    if (!t || t.turnId !== turnId) {
      const m = /^t-(\d{4,})$/.exec(turnId ?? '');
      return { ok: false, code: m && Number(m[1]) <= bridge.turnCount ? 'not-now' : 'unknown-id' };
    }
    if (stopping) return { ok: true }; // the stop of this turn runs already
    beginStop(turnId);
    return { ok: true };
  }

  function beginStop(turnId) {
    const cancelQueued = bridge.ready?.canCancelQueued === true;
    stopping = { turnId, timers: [], endsAtSigint: null };
    // 0.0 s: `stopping` to every link, `interrupt` to the agent.
    bridge.markStopping({ cancelQueued });
    bridge.interrupt({ cancelQueued });
    log(`cockpit stop ${turnId}: interrupt (cancelQueued ${cancelQueued})`);
    stopping.timers.push(later(() => {
      if (!stopping || bridge.turn?.turnId !== turnId) return endStop();
      // 5.0 s: SIGINT, and the turn ends forced on every screen (D32).
      log(`cockpit stop ${turnId}: no turn.end in ${STOP_FORCE_MS / 1000} s; SIGINT, forced`);
      stopping.endsAtSigint = bridge.agentEnds;
      bridge.signal('SIGINT');
      bridge.forceStop();
    }, STOP_FORCE_MS));
    stopping.timers.push(later(() => {
      if (!stopping || stopping.endsAtSigint === null) return endStop();
      if (renewing) return; // `new` replaces the child anyway
      if (bridge.agentEnds > stopping.endsAtSigint) return endStop(); // the result came after the SIGINT
      // 8.0 s: SIGTERM; the session is resumed at the exit (onExit).
      log(`cockpit stop ${turnId}: no result ${(STOP_TERM_MS - STOP_FORCE_MS) / 1000} s after the SIGINT; SIGTERM`);
      bridge.signal('SIGTERM');
    }, STOP_TERM_MS));
    stopping.timers.push(later(() => {
      if (!stopping || renewing) return;
      // 10.0 s: the child still runs: SIGKILL, its pipes closed (D283).
      log(`cockpit stop ${turnId}: the agent still runs; SIGKILL`);
      bridge.kill('stop');
    }, STOP_KILL_MS));
  }

  function endStop() {
    if (!stopping) return;
    for (const h of stopping.timers) clear(h);
    stopping = null;
  }

  function onTurnEnd(msg) {
    login?.turnEnded(msg); // §11.10 "Other ways in": E4 sets the condition, `done` clears it
    // A turn ended by the child's exit: onExit, called right after, decides.
    if (bridge.pid === null) {
      if (renewing) renewing.waitTurn = false;
      return;
    }
    // A stop whose turn ended before 5.0 s needs no more steps.
    if (stopping && stopping.endsAtSigint === null) endStop();
    if (renewing?.waitTurn) {
      renewing.waitTurn = false;
      closeForNew();
    }
  }

  // --------------------------------------------------------------------- new

  function newConversation() {
    if (renewing || phase === 'refused' || closed) return { ok: false, code: 'not-now' };
    if (phase === 'starting' && want.reason) return { ok: false, code: 'not-now' }; // a new one is starting
    renewing = { timers: [], waitTurn: false };
    log('cockpit session: new conversation asked');
    const t = bridge.turn;
    if (t) {
      // §11.7 `new`: the running turn is stopped first (§11.6).
      renewing.waitTurn = true;
      if (!stopping) beginStop(t.turnId);
    } else closeForNew();
    return { ok: true };
  }

  function closeForNew() {
    if (bridge.pid === null) return renewNow(); // no child: the new session starts now
    // stdin closed; SIGTERM after 5 s without an exit; SIGKILL 2 s later (B81).
    bridge.closeStdin('new');
    renewing.timers.push(later(() => { log('cockpit session: the agent did not exit on a closed stdin; SIGTERM'); bridge.signal('SIGTERM'); }, NEW_TERM_MS));
    renewing.timers.push(later(() => bridge.kill('new'), NEW_TERM_MS + STOP_KILL_MS - STOP_TERM_MS));
  }

  function renewNow() {
    for (const h of renewing?.timers ?? []) clear(h);
    renewing = null;
    endStop();
    clear(restartTimer);
    restartTimer = null;
    if (bridge.pid !== null) {
      // A start still in flight (a restart's): let it go, the new session replaces it.
      replaceForced = true;
      want = { resume: false, reason: 'owner' };
      bridge.kill('new');
      return;
    }
    want = { resume: false, reason: 'owner' };
    step = 0;
    failedStarts = 0;
    resumeFails = 0;
    spawnNow();
  }

  // ------------------------------------------------------------------ prompts

  function prompt(p) {
    // §11.7 (D31): no session up, no prompt held for later.
    if (phase !== 'up' || renewing) return Promise.resolve({ ok: false, code: 'agent-down' });
    return bridge.prompt(p);
  }

  function close() {
    closed = true;
    phase = 'closed';
    endStop();
    for (const h of renewing?.timers ?? []) clear(h);
    renewing = null;
    for (const h of [restartTimer, readyTimer, newsTimer, reloginTimer]) clear(h);
    restartTimer = readyTimer = newsTimer = reloginTimer = null;
    login?.close();
    return bridge.close();
  }

  return {
    start, prompt, stop, newConversation, close, bridge,
    get phase() { return phase; },
    get conversation() { return current?.conversation ?? null; },
    get session() { return current?.session ?? null; },
    get startedAt() { return current?.startedAt ?? null; },
  };
}
