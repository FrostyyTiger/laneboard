// The room's audit lines (spec screens.md §6.4, D164-D166). REVIEW-REQUIRED:
// what the owner reads afterwards to answer "what did the cockpit do".
//
//   promptLine(audit, {user, turnId, text, result}) → {ok:true} | {ok:false, reason}
//
// T13 writes `cockpit.prompt`; `cockpit.stop`, `cockpit.new` and the bounded
// `too-many` refusals are T30's.
//
// Rules each line keeps:
//   - D164: the log is the board's own (`openAudit` of server/fleet/audit.mjs,
//     its file, its hash chain); the words go in only as `argsHash` (`args` is
//     hashed by `append`, never stored).
//   - `user` is `board` without pairing (Q-O21 b, security.md §2.3 point 3,
//     D212); `via` is `cockpit`; `target` the turn, `-` for a refusal.
//   - D166 (fails closed): a prompt whose line cannot be written is not sent;
//     the caller turns `{ok:false}` into `prompt.refused` `audit-unavailable`.

/** The `user` of every C1 line: no pairing, the board decided who loads the page (D212). */
export const BOARD_USER = 'board';

/**
 * One `cockpit.prompt` line. `result` is `{ok:true, source, delivery, chars}`
 * or `{ok:false, status}` (screens.md §6.4's table). No audit log (it could
 * not be opened) is a failure like a failed append.
 */
export function promptLine(audit, { user = BOARD_USER, turnId = null, text, result }) {
  if (!audit || typeof audit.append !== 'function') return { ok: false, reason: 'no audit log' };
  try {
    audit.append({
      user,
      via: 'cockpit',
      action: 'cockpit.prompt',
      target: result?.ok === true && turnId ? turnId : '-',
      args: { text: String(text) },
      result,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.code ?? err?.message ?? String(err) };
  }
}
