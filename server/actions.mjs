// Actions: send keys/text, spawn, kill, restart. Every one is logged.
//
// Targeting rule (hard rule 1): a session is only ever acted on if it is in
// the CURRENT inventory, and the tmux target is the pane id ("%28"), never the
// name — `-t <name>` matches by prefix, so "kubic" would hit "kubic plan a".
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.mjs';
import { slots as slotProvider } from './providers/index.mjs';
import { log } from './log.mjs';
import { run, isSafeSessionName } from './util.mjs';
import { exactTarget, capturePane, runTmux } from './collector/tmux.mjs';
import { addEvent } from './db.mjs';
import * as state from './state.mjs';

export class ActionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * POSIX single-quote escaping: 'it'\''s'.
 *
 * The spawn command is handed to a shell. JSON.stringify leaves "$" live, so
 * anything user-supplied that ends up on the command line (a lane's slot env,
 * a path) is quoted with this instead.
 */
export function shellQuote(value) {
  return "'" + String(value).split("'").join("'\\''") + "'";
}

/** Resolve a name to a live session, or throw. */
export function requireSession(name) {
  if (!isSafeSessionName(name)) throw new ActionError('invalid session name', 400);
  const s = state.get(name);
  if (!s) throw new ActionError(`unknown session: ${name}`, 404);
  if (!s.paneId) throw new ActionError(`session ${name} has no pane`, 409);
  return s;
}

function record(type, name, payload, who) {
  addEvent({
    sessionName: name,
    sessionId: state.get(name)?.claude?.sessionId ?? null,
    type: 'action',
    subtype: type,
    payload: { ...payload, by: who || 'unknown' },
  });
  log.info(`action ${type} on ${JSON.stringify(name)} by ${who || 'unknown'}`, JSON.stringify(payload));
}

/**
 * tmux key names, e.g. ["Enter"], ["C-c"], ["1","Enter"].
 * Sent as separate arguments so tmux interprets each as one key.
 */
export async function sendKeys(name, keys, who) {
  const s = requireSession(name);
  if (!Array.isArray(keys) || !keys.length) throw new ActionError('keys must be a non-empty array');
  if (keys.length > 20) throw new ActionError('too many keys');
  for (const k of keys) {
    if (typeof k !== 'string' || !/^[A-Za-z0-9_.^-]{1,16}$/.test(k)) {
      throw new ActionError(`invalid key: ${JSON.stringify(k)}`);
    }
  }
  const r = await runTmux(['send-keys', '-t', s.paneId, ...keys]);
  if (!r.ok) throw new ActionError(`send-keys failed: ${r.stderr.trim()}`, 500);
  record('keys', name, { keys }, who);
  return { ok: true, keys };
}

/**
 * Literal text. `-l` stops tmux interpreting it as key names, so a prompt
 * containing "Enter" or ";" is typed verbatim.
 */
export async function sendText(name, text, enter, who) {
  const s = requireSession(name);
  if (typeof text !== 'string' || !text.length) throw new ActionError('text must be a non-empty string');
  if (text.length > 8000) throw new ActionError('text too long');
  const r = await runTmux(['send-keys', '-t', s.paneId, '-l', text]);
  if (!r.ok) throw new ActionError(`send-keys failed: ${r.stderr.trim()}`, 500);
  if (enter) {
    const e = await runTmux(['send-keys', '-t', s.paneId, 'Enter']);
    if (!e.ok) throw new ActionError(`send-keys Enter failed: ${e.stderr.trim()}`, 500);
  }
  record('text', name, { text: text.slice(0, 300), enter: Boolean(enter) }, who);
  return { ok: true };
}

async function waitForSession(name, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await runTmux(['has-session', '-t', exactTarget(name)]);
    if (r.ok) return true;
    await new Promise((res) => setTimeout(res, 150));
  }
  return false;
}

/**
 * `slot`: an agent-stack slot whose environment the session gets. The exports
 * are eval'd inside the tmux command, because a session the laneboard starts is
 * not a login shell and never reads ~/.profile (v3 hard rule 8). The caller
 * verifies the result from /proc/<pid>/environ.
 */
export async function spawn({ name, dir, prompt, model, resume, permissionMode, slot }, who) {
  if (!isSafeSessionName(name)) throw new ActionError('invalid session name');
  if (state.get(name)) throw new ActionError(`session ${name} already exists`, 409);
  if (name.startsWith('_laneboard') && name !== '_laneboard-test') {
    throw new ActionError('names starting with _laneboard are reserved', 400);
  }
  const target = path.resolve(dir || config.home);
  let st;
  try {
    st = await fsp.stat(target);
  } catch {
    throw new ActionError(`no such directory: ${target}`, 400);
  }
  if (!st.isDirectory()) throw new ActionError(`not a directory: ${target}`, 400);

  if (model && !/^[A-Za-z0-9._[\]-]{1,40}$/.test(model)) throw new ActionError('invalid model');
  if (resume && !/^[0-9a-f-]{8,40}$/i.test(resume)) throw new ActionError('invalid resume id');
  if (permissionMode && !/^[A-Za-z]{1,32}$/.test(permissionMode)) throw new ActionError('invalid permission mode');
  if (slot != null && !(Number.isInteger(slot) && slot >= 1 && slot <= 9)) throw new ActionError('invalid slot');

  // The server's PATH is the unit's, so put node and claude's dirs on it
  // explicitly. `exec bash` keeps the session alive if the agent exits, so a
  // crash is visible in the dashboard instead of the session silently vanishing.
  const pathPrefix = [config.nodeBin, path.dirname(config.claudeBin)].join(':');
  const claudeArgs = [];
  if (model) claudeArgs.push('--model', model);
  if (resume) claudeArgs.push('--resume', resume);
  claudeArgs.push('--permission-mode', permissionMode || 'default');
  const agentCmd = `${JSON.stringify(config.claudeBin)} ${claudeArgs.map((a) => JSON.stringify(a)).join(' ')}`;

  const envCmd = slot != null ? slotProvider.envCommand(slot, shellQuote) : '';
  const shellCmd =
    `PATH=${pathPrefix}:$PATH; ` +
    envCmd +
    `${agentCmd}; ` +
    `echo "[laneboard] claude exited with $?"; exec bash`;

  const r = await runTmux(['new-session', '-d', '-s', name, '-c', target, shellCmd], { timeout: 10000 });
  if (!r.ok) throw new ActionError(`tmux new-session failed: ${r.stderr.trim()}`, 500);
  if (!(await waitForSession(name))) throw new ActionError('session did not appear', 500);

  record('spawn', name, { dir: target, model: model || null, resume: resume || null, slot: slot ?? null, hasPrompt: Boolean(prompt) }, who);

  // The caller does not wait for this: a first Claude start can take 20 s, and
  // holding the HTTP request open meant a server restart mid-spawn looked like
  // "cannot reach the laneboard" even though the session had been created.
  const promptPending = Boolean(prompt);
  if (promptPending) {
    deliverPrompt(name, String(prompt), who).catch((err) =>
      log.error('prompt delivery failed', err?.stack || String(err))
    );
  }
  await state.tick();
  return { ok: true, name, dir: target, promptPending };
}

/**
 * Type the initial prompt once the session is genuinely ready: the registry
 * file exists AND the pane is showing the input box, not a dialog.
 * Records action/spawn-prompt-delivered or -failed either way.
 */
export async function deliverPrompt(name, prompt, who, { timeoutMs = 60000 } = {}) {
  const until = Date.now() + timeoutMs;
  let lastReason = 'timeout';

  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 700));
    await state.tick();
    const s = state.get(name);
    if (!s) { lastReason = 'session vanished'; break; }
    if (!s.paneId) { lastReason = 'no pane'; continue; }

    // Check the pane BEFORE requiring a registry entry: Claude does not
    // register at all while it sits on the trust dialog, so a plain
    // "never registered" would hide the real reason.
    const readiness = state.promptReadiness(await capturePane(s.paneId, { ansi: true }));
    if (readiness === 'trust_dialog') {
      // Typing here would answer the DIALOG, not Claude.
      lastReason = 'the session is on the "trust this folder" dialog - answer it, then send the prompt';
      break;
    }
    if (!s.claude?.sessionId) { lastReason = 'has not registered yet'; continue; }
    if (readiness !== 'ready') { lastReason = `pane not ready (${readiness})`; continue; }

    const t = await runTmux(['send-keys', '-t', s.paneId, '-l', prompt.slice(0, 8000)]);
    if (!t.ok) { lastReason = `send-keys failed: ${t.stderr.trim()}`; break; }
    const e = await runTmux(['send-keys', '-t', s.paneId, 'Enter']);
    if (!e.ok) { lastReason = `send-keys Enter failed: ${e.stderr.trim()}`; break; }

    record('spawn-prompt-delivered', name, { prompt: prompt.slice(0, 300) }, who);
    return { ok: true };
  }

  record('spawn-prompt-failed', name, { prompt: prompt.slice(0, 300), reason: lastReason }, who);
  log.warn(`prompt not delivered to ${name}: ${lastReason}`);
  return { ok: false, reason: lastReason };
}

export async function kill(name, who) {
  if (!isSafeSessionName(name)) throw new ActionError('invalid session name', 400);
  const s = state.get(name);
  if (!s) throw new ActionError(`unknown session: ${name}`, 404);
  if (!s.paneId) throw new ActionError(`session ${name} has no pane`, 409);

  const r = await runTmux(['kill-session', '-t', exactTarget(name)]);
  if (!r.ok) throw new ActionError(`kill-session failed: ${r.stderr.trim()}`, 500);
  record('kill', name, { sessionId: s.claude?.sessionId ?? null }, who);
  await state.tick();
  return { ok: true, name };
}

/**
 * Kill and re-spawn in the same directory, resuming the same conversation:
 * `claude --resume <sessionId>`.
 */
export async function restart(name, who) {
  const s = requireSession(name);
  const dir = s.dir || config.home;
  const resumeId = s.claude?.sessionId ?? null;
  const model = s.claude?.modelId ?? null;
  await runTmux(['kill-session', '-t', exactTarget(name)]);
  for (let i = 0; i < 40 && state.get(name); i++) {
    await new Promise((res) => setTimeout(res, 100));
    await state.tick();
  }
  await spawn({
    name,
    dir,
    resume: resumeId || undefined,
    model: model || undefined,
  }, who);
  record('restart', name, { dir, resumed: resumeId }, who);
  return { ok: true, name, resumed: resumeId };
}

/** Git repositories under the configured roots, depth 2, for the spawn picker. */
export async function listDirs() {
  const roots = new Set(config.dirRoots);
  const found = new Map();
  const consider = async (dir, depth) => {
    if (found.size > 200) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch { return; }
    const isRepo = entries.some((e) => e.name === '.git');
    if (isRepo) {
      const branch = await run('git', ['-C', dir, 'branch', '--show-current'], { timeout: 2000 });
      found.set(dir, { dir, name: path.basename(dir), branch: branch.ok ? branch.stdout.trim() : null });
      return; // do not descend into a repo
    }
    if (depth <= 0) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      await consider(path.join(dir, e.name), depth - 1);
    }
  };
  for (const root of roots) await consider(root, 2);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
