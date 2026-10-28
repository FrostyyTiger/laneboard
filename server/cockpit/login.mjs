// The agent's login check (spec protocols.md §11.10, c1-talk.md §10.1, D151):
// the room asks the agent's own CLI whether it is logged in, so a logged-out
// agent is named before the owner sends anything.
//
//   loginResult({ code, timedOut, error, output })   → 'ok' | 'not-logged-in' | 'unknown'
//   hasLoginWords(text)                               §11.10's login words, case-insensitive
//   checkArgv(agent, envNames)                        the argv, behind sudo with `user` (D214)
//   runLoginCheck({ argv, cwd, env, spawn })          → Promise<{ result, why }>
//   createLoginWatch(opts)                            the checks over time and the condition
//
// The check's output is never logged: it may name an account (§11.10 "Log").
import { spawn as nodeSpawn } from 'node:child_process';
import * as clock from './clock.mjs';
import { isoAt } from './iso.mjs';

/** §11.10: the check ends within 10 s, else SIGTERM. Real time: see B211. */
export const CHECK_TIMEOUT_MS = 10_000;
/** §11.10: stdout and stderr read up to 64 KB together. */
export const CHECK_OUTPUT_MAX = 64 * 1024;
/** §11.10 "When": every 900 s, every 60 s while the condition holds. */
export const CHECK_EVERY_MS = 900_000;
export const CHECK_HELD_MS = 60_000;

/**
 * §11.10's login words (research Q10 marks them a guess), plus the one the
 * build night pinned with a real run (B212): Claude Code 2.1.303's logged-out
 * `claude auth status` prints JSON with `"loggedIn": false` and none of the
 * six words.
 */
export const LOGIN_WORDS = Object.freeze(['not logged in', 'log in', 'login', '401', 'invalid api key', 'authentication']);
const PINNED = /"loggedIn"\s*:\s*false/i;

export function hasLoginWords(text) {
  const s = String(text ?? '');
  const low = s.toLowerCase();
  return LOGIN_WORDS.some((w) => low.includes(w)) || PINNED.test(s);
}

/** §11.10's result table. */
export function loginResult({ code = null, timedOut = false, error = null, output = '' } = {}) {
  if (timedOut || error) return 'unknown'; // a timeout, the command not found
  if (code === 0) return 'ok';
  if (Number.isInteger(code) && hasLoginWords(output)) return 'not-logged-in';
  return 'unknown'; // another exit, or a signal
}

/**
 * The check runs as the agent's child does (§11.10 "How it runs", §11.1):
 * the agent's user (sudo -n, D214), no shell. Its environment is the child's
 * (D108) without LANEBOARD_MCP_TOKEN: the check has no use for it (B213).
 */
export function checkArgv(agent, envNames = []) {
  const argv = [...agent.loginCheck];
  if (!agent.user) return argv;
  return ['sudo', '-n', '-u', agent.user, '-H', `--preserve-env=${envNames.join(',')}`, '--', ...argv];
}

/** One run of the check: `{result, why}`, `why` the log's bracket (`exit 1`, `timeout 10 s`). */
export function runLoginCheck({ argv, cwd, env, spawn = nodeSpawn, timeoutMs = CHECK_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let child;
    let output = '';
    let timedOut = false;
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    try {
      // §11.10: no shell, stdin closed.
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ result: 'unknown', why: `cannot start: ${err.code ?? err.message}` });
      return;
    }
    const take = (b) => { if (output.length < CHECK_OUTPUT_MAX) output = (output + b.toString('utf8')).slice(0, CHECK_OUTPUT_MAX); };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* gone */ }
      finish({ result: 'unknown', why: `timeout ${timeoutMs / 1000} s` });
    }, timeoutMs);
    timer.unref?.();
    child.on('error', (err) => finish({ result: 'unknown', why: `cannot start: ${err.code ?? err.message}` }));
    child.on('close', (code, signal) => {
      const result = loginResult({ code, timedOut, output });
      finish({ result, why: code === null ? `signal ${signal}` : `exit ${code}` });
    });
  });
}

/**
 * The checks over time and the `not-logged-in` condition (§11.10).
 *
 * opts: `run()` (one check → {result, why}), `condition(code, fields|null)`
 * (status.mjs's set), `log`, `idle()` (no turn runs and a session is up),
 * `relogin()` (restart the idle child with `--resume`).
 *
 *   .start()                 the room's start: a check now, then every 900 s
 *   .turnEnded(msg)          a turn.end: E4 sets the condition, `done` clears it
 *   .startFailed(detail)     a start that failed with the login words (§11.4's last row)
 *   .sessionUp()             a session is up: `blocksSend` goes
 *   .checkNow()              one check (the timers call it), → Promise
 *   .close()
 */
export function createLoginWatch({ run, condition, log = () => {}, idle = () => false, relogin = () => {} }) {
  // Who set the condition (§11.10 "Other ways in"): 'check', 'start', 'turn'.
  const by = new Set();
  let since = null;
  let blocksSend = false;
  let running = null;
  let timer = null;
  let lastResult = null;
  let closed = false;

  const holds = () => by.size > 0;

  function show() {
    if (holds()) condition('not-logged-in', { since, ...(blocksSend ? { blocksSend: true } : {}) });
    else condition('not-logged-in', null);
  }

  function setBy(source, { blocks = false } = {}) {
    // §11.10: `since` now, if not already set; an earlier `since` stays.
    if (!holds()) since = isoAt(clock.now());
    by.add(source);
    if (blocks) blocksSend = true;
    show();
  }

  function clearAll() {
    if (!holds()) return;
    by.clear();
    since = null;
    blocksSend = false;
    show();
  }

  function schedule() {
    if (closed) return;
    if (timer) clock.clearTimeout(timer);
    // §11.10 "When": every 60 s while the condition holds, else every 900 s.
    timer = clock.setTimeout(() => { timer = null; return checkNow(); }, holds() ? CHECK_HELD_MS : CHECK_EVERY_MS);
  }

  function checkNow() {
    // §11.10: it never runs twice at once.
    if (running || closed) return running ?? Promise.resolve();
    running = (async () => {
      let r;
      try { r = await run(); } catch (err) { r = { result: 'unknown', why: err?.message ?? 'error' }; }
      running = null;
      if (closed) return;
      // §11.10 "Log": one line per change of the result, never one per run.
      if (r.result !== lastResult) log(`login check: ${r.result} (${r.why})`);
      lastResult = r.result;
      if (r.result === 'not-logged-in') setBy('check');
      else if (r.result === 'ok') {
        // A condition set by a turn clears only on a turn ending `done`.
        const was = holds();
        by.delete('check');
        by.delete('start');
        if (was && !holds()) {
          since = null;
          blocksSend = false;
          show();
          // §11.10: the idle child restarts with `--resume` to read the new login; no `agent-back`.
          if (idle()) relogin();
        }
      }
      schedule();
    })();
    return running;
  }

  return {
    start() { checkNow(); schedule(); },
    checkNow,
    turnEnded(msg) {
      if (msg?.state === 'done') {
        clearAll();
        if (timer) schedule(); // back to every 900 s
      } else if (msg?.state === 'error' && msg.code === 'not-logged-in') {
        setBy('turn');
        if (timer) schedule(); // every 60 s now
      }
    },
    startFailed() {
      setBy('start', { blocks: true });
      if (timer) schedule();
    },
    sessionUp() {
      // §11.4's last row: `blocksSend` only until a session is up.
      if (!blocksSend) return;
      blocksSend = false;
      show();
    },
    get holds() { return holds(); },
    close() {
      closed = true;
      if (timer) clock.clearTimeout(timer);
      timer = null;
    },
  };
}
