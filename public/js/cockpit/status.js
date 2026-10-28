// The pane's status line (cockpit spec c1-talk.md §10.1, protocols.md §3.5,
// screens.md §7, D152, D232): one slot, the highest row that holds.
//
//   pickStatus({ offline, roomDown, room, back })   → the row to show, or null
//   statusText(row, nowMs, tz?)                     its text, exact
//
// `offline` {since} while navigator.onLine is false (row 1); `roomDown` the
// link's state while it is `room-down` (row 2); `room` the room's last
// `status` (rows 3-7, the room sends only its highest); `back` {at} for the
// 5 s after the link came back (row 8). While row 1 or 2 shows, the room's
// last status is kept and shows again the moment they go.
import { clockText, sinceText } from '../core/cockpit-time.js';

/** c1-talk.md §10.1's table, highest first. */
export const STATUS_ROWS = Object.freeze([
  'offline', 'room-down', 'agent-down', 'not-logged-in', 'tools-down', 'board-down', 'agent-back', 'back',
]);
const ROOM_ROWS = new Set(STATUS_ROWS.slice(2, 7));

export function pickStatus({ offline = null, roomDown = null, room = null, back = null } = {}) {
  if (offline) return { code: 'offline', since: offline.since };
  if (roomDown) return { code: 'room-down', ...roomDown };
  if (room && ROOM_ROWS.has(room.code)) return { ...room, since: Date.parse(room.since) };
  if (back) return { code: 'back', at: back.at };
  return null;
}

/** The row's text (§10.1, exact): conditions read `since {clock} ({age})`, events the clock only. */
export function statusText(row, nowMs, timeZone) {
  const since = () => sinceText(row.since, nowMs, timeZone);
  switch (row.code) {
    case 'offline': return `This screen is offline ${since()}. Check its network.`;
    case 'room-down': {
      const head = `Cockpit room unreachable ${since()}.`;
      if (row.trying) return `${head} Retrying now…`;
      if (row.retryAt == null) return head;
      return `${head} Retrying in ${Math.max(0, Math.ceil((row.retryAt - nowMs) / 1000))} s.`;
    }
    case 'agent-down': return `Agent not running ${since()}.`;
    case 'not-logged-in': return `The agent is not logged in on the room ${since()}. Log it in there.`;
    case 'tools-down': return 'The agent cannot read the board: its laneboard tools did not start.';
    case 'board-down': return `Board unreachable ${since()}: the agent cannot read the fleet.`;
    case 'agent-back': return `The agent is back (${clockText(row.since, nowMs, timeZone)}). Your last message was not answered.`;
    case 'back': return `Back since ${clockText(row.at, nowMs, timeZone)}.`;
    default: return '';
  }
}

/** Rows 1-6 hold a condition with an age: redrawn every 1 s (§10.1). */
export const hasAge = (row) => row !== null && ['offline', 'room-down', 'agent-down', 'not-logged-in', 'board-down'].includes(row.code);
