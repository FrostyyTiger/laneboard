// One state, one mark (runs night 4 T23, docs/design.md "The colour rule").
// Every view that draws a lane's or an item's state takes its lamp priority
// from here, so the Inbox rows, the Board's NEEDS YOU list and cards, the
// phone bar and the rail agree: wants you (a permission, an approval, a
// question, a need, stuck) is the amber ▲ ('2'), broken (blocked, down, the
// guard's danger) the red ■ ('1'), working grey ● ('run'), idle grey ○.
// Pure, importable by node --test.

/** State or item kind -> lamp `data-p`. Unknown states are grey ○ ('off'). */
export const STATE_MARK = Object.freeze({
  waiting_permission: '2', permission: '2', approval: '2',
  waiting_question: '2', question: '2', need: '2', stuck: '2',
  blocked: '1', down: '1', danger: '1',
  working: 'run', done: 'ok', idle: 'off', shell: 'off', dead: 'off',
});

/** The lamp priority of a state or kind; 'off' when it is not one. */
export function markP(state) {
  return Object.hasOwn(STATE_MARK, state) ? STATE_MARK[state] : 'off';
}

/** A session-like item's mark: danger wins, then an approval it holds, then stuck, then its state. */
export function itemP(s) {
  if (!s || typeof s !== 'object') return 'off';
  if (s.danger) return '1';
  const own = markP(s.state);
  if (own === '1' || own === '2') return own;
  if (s.awaitingApproval || s.stuck) return '2';
  return own;
}

/** The 4-character state words (fleet plan §4 2.7). */
export const STATE_WORD = Object.freeze({
  waiting_permission: 'PERM', waiting_question: 'QUES', working: 'WORK',
  done: 'DONE', idle: 'IDLE', shell: 'SHEL', dead: 'DEAD',
});

/**
 * The word beside a session's mark (review 6-designer Across 1): when a flag,
 * not the state, raised the amber ▲ (an approval held, a stuck session), the
 * word names the flag with the header tile's word (`APPR`, `STCK`), never
 * `WORK` beside a ▲. Else the state's word. The Board card, the NEEDS YOU
 * list, the phone chip and the Inbox rows (runs n5 T27) all print this.
 */
export function markWord(s) {
  const state = typeof s?.state === 'string' ? s.state : null;
  const own = state ? markP(state) : 'off';
  if (own !== '1' && own !== '2') {
    if (s?.awaitingApproval) return 'APPR';
    if (s?.stuck) return 'STCK';
  }
  return state ? (STATE_WORD[state] ?? state.slice(0, 4).toUpperCase()) : '—';
}
