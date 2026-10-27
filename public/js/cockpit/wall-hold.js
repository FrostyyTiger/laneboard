// What the pane does to the Wall (cockpit spec screens.md §2, c1-talk.md §2, D4), through
// the Wall's handle only (screens.md §9.1, D221): the cockpit names no Wall file.
//
//   paneOnWall(view, open)   view = window.__cockpitView
//
// The pane opens: the tour stops where the camera is (W3) and the idle timer is held (W5).
// The pane closes: the timer restarts at 60 s (W5), the state stays as it is.
// On the app (`view.wall` null) and before the Wall has set its handle, nothing.

/** The idle timer's length after the pane closes (screens.md §2: "restarts at 60 s"). */
export const PANE_CLOSED_IDLE_MS = 60_000;

export function paneOnWall(view, open) {
  const wall = view?.wall;
  if (!wall) return false;
  if (open) {
    wall.tour?.pause?.();
    wall.idle?.hold?.();
  } else {
    wall.idle?.restart?.(PANE_CLOSED_IDLE_MS);
  }
  return true;
}
