// The client store and pins. Moved from public/app.js (fleet F1).

// ---------------------------------------------------------------- store

export const store = {
  sessions: new Map(),
  map: null,             // the Map's model, from `map` messages
  attention: [],
  lanes: [],
  // Which lanes the grid is filtered to. Empty = show everything.
  //
  // UI-local by design (lanes plan hard rule 5): not on the server, not in
  // SQLite, not in localStorage. A filter you forgot you set is a board that
  // lies to you, and this board's whole job is to be believed.
  laneFilter: new Set(),
  vitals: null,
  // v3: lane records, PRs, slots, the dev stack, readiness, jobs (server box payload).
  box: null,
  generatedAt: 0,
  connected: false,
  cursor: null,           // session name the keyboard is on
  pinned: loadPinned(),   // Set of names, persisted
  dockLayout: null,      // null = auto (stacked for 1-2 pins, 2x2 for 3-4)
  openSession: null,      // name shown in the sheet
  view: 'board',          // board | morning | credit | box
  /** Set when the box payload changed, so lane heads and the Box re-render. */
  boxDirty: true,
};

export function loadPinned() {
  try {
    const raw = localStorage.getItem('laneboard.pinned');
    if (raw === null) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}
export function savePinned() {
  try { localStorage.setItem('laneboard.pinned', JSON.stringify([...store.pinned])); } catch { /* private mode */ }
}

/** Lane id -> the lane object the server sent. */
export function laneById(id) {
  if (!id) return null;
  return store.lanes.find((l) => l.id === id) ?? null;
}

/** Is this session shown under the current lane filter? */
export function laneVisible(s) {
  if (!store.laneFilter.size) return true;
  return Boolean(s.lane) && store.laneFilter.has(s.lane);
}
