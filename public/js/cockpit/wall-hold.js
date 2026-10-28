// What the pane does to the Wall (cockpit spec screens.md §2, c1-talk.md §2, D4), through
// the Wall's handle only (screens.md §9.1, D221): the cockpit names no Wall file.
//
//   const hold = createWallHold(() => window.__cockpitView)
//   hold.pane(open)      the pane opened or closed
//   hold.turn(running)   a turn started or ended (c1-talk.md §2 `data-turn` other than `idle`)
//
// screens.md §2's table, the cockpit's rows:
// - the pane opens: the tour stops where the camera is (W3) and the idle timer is held (W5);
// - a turn runs: the timer is held, the Wall's state unchanged;
// - the pane closes, or the turn ends: the timer restarts at 60 s (W5) once nothing holds it
//   (the pane closed and no turn running); the state stays as it is.
// The microphone's row is C2's. On the app (`view.wall` null) and before the Wall has set its
// handle, nothing.
import { EXPLORE_IDLE_S } from '../core/cockpit-constants.js';

export function createWallHold(handle) {
  const view = handle ?? (() => globalThis.__cockpitView);
  let open = false;
  let running = false;
  const wall = () => view()?.wall ?? null;
  const held = () => open || running;
  const change = (was, pause) => {
    const w = wall();
    if (!w) return false;
    if (pause) w.tour?.pause?.();
    if (held() && !was) w.idle?.hold?.();
    // screens.md §2: "restarts at 60 s" (EXPLORE_IDLE_S, D150).
    else if (!held() && was) w.idle?.restart?.(EXPLORE_IDLE_S * 1000);
    return true;
  };
  const pane = (want) => {
    if ((want === true) === open) return false;
    const was = held();
    open = want === true;
    // D4: opening the pane stops the tour where the camera is, whether or not a turn held the timer.
    return change(was, open);
  };
  const turn = (want) => {
    if ((want === true) === running) return false;
    const was = held();
    running = want === true;
    return change(was, false);
  };
  return { pane, turn, held };
}
