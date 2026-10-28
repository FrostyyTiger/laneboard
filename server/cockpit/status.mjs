// The room's status slot (spec protocols.md §3.5, c1-talk.md §10.1, D152):
// the room holds every condition that applies and sends only the highest as
// one `status` message, a new one whenever what it shows changes, `null`
// when nothing holds.
//
//   const st = createStatus({ emit, log });
//   st.set(code, fields)   a condition holds (fields: since, detail, blocksSend)
//   st.set(code, null)     it no longer holds
//   st.shown               the `status` value last sent (or null)
//
// Rows 3-7 of §10.1's table are the room's; rows 1, 2 and 8 are the screen's
// own (public/js/cockpit/status.js).
import * as clock from './clock.mjs';
import { isoAt } from './iso.mjs';
import { hhmm } from '../../public/js/core/cockpit-time.js';

/** c1-talk.md §10.1 rows 3-7, highest first (D152). */
export const ROOM_ROWS = Object.freeze(['agent-down', 'not-logged-in', 'tools-down', 'board-down', 'agent-back']);
/** §10.1: news, not a state: outranked when it starts or while it shows, it is dropped (D152). */
const NEWS = new Set(['agent-back']);

const rank = (code) => ROOM_ROWS.indexOf(code);

export function createStatus({ emit = () => {}, log = () => {} } = {}) {
  const held = new Map(); // code → {since, detail?, blocksSend?}
  let shown = null;
  let shownText = 'null';

  function top() {
    let best = null;
    for (const code of held.keys()) if (best === null || rank(code) < rank(best)) best = code;
    return best;
  }

  function set(code, fields) {
    if (rank(code) < 0) throw new RangeError(`status: unknown code ${JSON.stringify(code)}`);
    if (fields === null) {
      if (!held.delete(code)) return;
    } else {
      const highest = top();
      // D152: news outranked when it starts is dropped, never shown later.
      if (NEWS.has(code) && highest !== null && rank(highest) < rank(code)) return;
      const was = held.get(code);
      const { since, ...rest } = fields;
      held.set(code, { since: since ?? was?.since ?? isoAt(clock.now()), ...rest });
      // D152: news that a higher condition outranks while it shows goes for good.
      for (const n of NEWS) if (held.has(n) && rank(code) < rank(n)) held.delete(n);
    }
    publish();
  }

  function publish() {
    const code = top();
    const next = code === null ? null : { code, ...held.get(code) };
    const text = JSON.stringify(next);
    if (text === shownText) return;
    const before = shown?.code ?? null;
    shown = next;
    shownText = text;
    // c1-talk.md §10.1: one room-log line per change of the slot's code.
    if (code !== before) {
      const at = next ? Date.parse(next.since) : NaN;
      log(code === null ? 'status none' : `status ${code}${Number.isFinite(at) ? ` since ${hhmm(at)}` : ''}`);
    }
    emit({ type: 'status', status: next });
  }

  return {
    set,
    has: (code) => held.has(code),
    get shown() { return shown; },
  };
}
