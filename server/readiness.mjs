// Is a session safe to let go of, and why? Kept from v2's Machine view, whose
// page went in v3; `retire`'s readiness check builds on it.
//
// Nothing here acts. Everything is a flag and a reason; a human decides,
// through DELETE /api/sessions/:name or `laneboard retire`. Nothing in this file
// kills, signals, or writes anything at all.

const DAY = 24 * 3600 * 1000;

/** States that mean "this session is not in the middle of anything". */
export const QUIET_STATES = new Set(['done', 'idle', 'shell']);

/**
 * Is this session safe to kill, and why?
 *
 * The rule (plan §5): quiet for at least 24 h, AND either it has no repo at all
 * or its branch is merged into origin/main with nothing uncommitted and nothing
 * unpushed. Every clause is reported, whether it passed or not, because the
 * flag is only useful if you can see what it is claiming.
 *
 * Deliberately conservative in one direction: anything unknown counts against
 * killing. An unresolved merge state is not "merged".
 */
export function safeToKill(session, now = Date.now()) {
  const reasons = [];
  const blockers = [];

  const quiet = QUIET_STATES.has(session.state);
  const idleFor = now - (session.stateSince ?? now);
  if (!quiet) blockers.push(`state is ${session.state}`);
  else if (idleFor < DAY) blockers.push(`only ${Math.round(idleFor / 3600000)} h idle`);
  else reasons.push(`${Math.round(idleFor / DAY)} d idle in ${session.state}`);

  const hasRepo = Boolean(session.dir && session.branch);
  if (!hasRepo) {
    reasons.push('no repo to lose');
  } else {
    // "Is the branch merged into main?" is not a question you can ask of a main
    // checkout — it is trivially true and reporting it as "unknown" blocked
    // every session working in a main checkout. What matters
    // on main is only whether anything is uncommitted or unpushed, which the
    // clauses below already check.
    if (session.isMain) reasons.push(`on ${session.branch}, nothing to merge`);
    else if (session.merged === true) reasons.push(`${session.branch} is merged into origin/main`);
    else if (session.merged === false) blockers.push(`${session.branch} is not merged`);
    else blockers.push(`${session.branch} merge state unknown`);

    if (session.dirty) blockers.push(`${session.dirty} uncommitted`);
    else reasons.push('working tree clean');

    if (session.ahead) blockers.push(`${session.ahead} unpushed`);
  }

  return { safe: blockers.length === 0 && reasons.length > 0, reasons, blockers };
}
