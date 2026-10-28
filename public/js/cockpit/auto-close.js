// The pane closes itself (cockpit spec screens.md §2, c1-talk.md §2, D5, pending Q-O12 a):
// after PANE_IDLE_S (300 s) with no touch, never while a turn runs; the conversation and a
// typed draft stay (the close is CLOSE's). Only the pane over the Wall or an app view: a
// column (`split`, `canvas`, `switch`) never closes, and C1 draws no column. The microphone's
// rule (closed, D5) is C2's. Pure: the page's timer functions come in.
//
//   const auto = createAutoClose({ setTimer, clearTimer, close, ms })
//   ms                    default PANE_IDLE_S * 1000 (D150); 0 is the owner's "never" (D5's overrule)
//   auto.opened(open)     the pane opened (the 300 s start) or closed (no timer)
//   auto.turn(running)    a turn started (no timer) or ended (the 300 s start again)
//   auto.touched()        a touch, a key or the wheel anywhere on the page: the 300 s start again
//   auto.armed()          whether the timer runs now (tests)
import { PANE_IDLE_S } from '../core/cockpit-constants.js';

export function createAutoClose(opts) {
  const setTimer = opts.setTimer;
  const clearTimer = opts.clearTimer;
  const close = opts.close;
  const ms = opts.ms ?? PANE_IDLE_S * 1000;
  let open = false;
  let running = false;
  let timer = null;
  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const arm = () => {
    stop();
    if (!open || running || !(ms > 0)) return;
    timer = setTimer(() => {
      timer = null;
      if (open && !running) close();
    }, ms);
  };
  const opened = (want) => { open = want === true; arm(); };
  const turn = (want) => {
    if ((want === true) === running) return;
    running = want === true;
    arm();
  };
  const touched = () => { if (timer !== null) arm(); };
  return { opened, turn, touched, armed: () => timer !== null };
}
