// The room's audit lines (spec screens.md §6.4, D164-D166). REVIEW-REQUIRED:
// what the owner reads afterwards to answer "what did the cockpit do".
//
//   promptLine(audit, {user, turnId, text, result}) → {ok:true} | {ok:false, reason}
//   stopLine(audit, {user, turnId, cancelQueued})   → the same
//   newLine(audit, {conversation, from, stoppedTurn, reason}) → the same
//   createFailWarner({write, now, intervalMs})     → warn(action, reason)
//
// T13 wrote `cockpit.prompt`, T30 `cockpit.stop` and `cockpit.new`; the
// bounded `too-many` refusals are T23c's.
//
// Rules each line keeps:
//   - D164: the log is the board's own (`openAudit` of server/fleet/audit.mjs,
//     its file, its hash chain); the words go in only as `argsHash` (`args` is
//     hashed by `append`, never stored).
//   - `user` is `board` without pairing (Q-O21 b, security.md §2.3 point 3,
//     D212); `via` is `cockpit`; `target` the turn, `-` for a refusal.
//   - D166 (fails closed): a prompt whose line cannot be written is not sent;
//     the caller turns `{ok:false}` into `prompt.refused` `audit-unavailable`.
//     A stop or a new conversation whose line fails runs anyway (taking away
//     never waits for a broken log); the failure is one stderr line at most
//     every 10 s (createFailWarner).
//   - `cockpit.new` of a forced fresh start is the room's own (`user` `room`,
//     `result.reason` `forced`); the owner's `START` carries `stoppedTurn`.

/** The `user` of every C1 line: no pairing, the board decided who loads the page (D212). */
export const BOARD_USER = 'board';
/** The `user` of a line the room writes on its own (a forced fresh start, §6.4). */
export const ROOM_USER = 'room';

/**
 * One `cockpit.prompt` line. `result` is `{ok:true, source, delivery, chars}`
 * or `{ok:false, status}` (screens.md §6.4's table). No audit log (it could
 * not be opened) is a failure like a failed append.
 */
export function promptLine(audit, { user = BOARD_USER, turnId = null, text, result }) {
  return writeLine(audit, {
    user,
    action: 'cockpit.prompt',
    target: result?.ok === true && turnId ? turnId : '-',
    args: { text: String(text) },
    result,
  });
}

/** `cockpit.stop`: written when the room receives `stop`, before it asks the bridge (§6.4). */
export function stopLine(audit, { user = BOARD_USER, turnId, cancelQueued }) {
  return writeLine(audit, {
    user,
    action: 'cockpit.stop',
    target: turnId,
    args: {},
    result: { ok: true, cancelQueued: cancelQueued === true },
  });
}

/**
 * `cockpit.new`: written once the new conversation has started (its `ready`).
 * `reason` `owner` (START on the NEW bar) or `forced` (the room's own fresh
 * start, §11.7); `stoppedTurn` the turn the owner's NEW stopped, null when idle.
 */
export function newLine(audit, { user = BOARD_USER, conversation, from = null, stoppedTurn = null, reason = 'owner' }) {
  const forced = reason === 'forced';
  return writeLine(audit, {
    user: forced ? ROOM_USER : user,
    action: 'cockpit.new',
    target: conversation,
    args: {},
    result: forced ? { ok: true, from, reason: 'forced' } : { ok: true, from, stoppedTurn },
  });
}

/** §6.4: an audit failure that does not refuse is one stderr line at most this often. */
export const FAIL_WARN_MS = 10_000;

/**
 * `cockpit: audit append failed for <action>: <reason>`, at most one line
 * every FAIL_WARN_MS (§6.4); the rest are counted into the next line.
 */
export function createFailWarner({ write = (line) => process.stderr.write(`${line}\n`), now = Date.now, intervalMs = FAIL_WARN_MS } = {}) {
  let last = -Infinity;
  let held = 0;
  return function warn(action, reason) {
    const t = now();
    if (t - last < intervalMs) { held += 1; return false; }
    last = t;
    const more = held ? ` (${held} more since the last line)` : '';
    held = 0;
    write(`cockpit: audit append failed for ${action}: ${reason}${more}`);
    return true;
  };
}

function writeLine(audit, { user, action, target, args, result }) {
  if (!audit || typeof audit.append !== 'function') return { ok: false, reason: 'no audit log' };
  try {
    // `args` is hashed by append (argsHash) and never stored (D164).
    audit.append({ user, via: 'cockpit', action, target, args, result });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
  }
}
