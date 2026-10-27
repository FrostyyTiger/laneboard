// Fault hooks: the three points where the room under test can break the room
// link on purpose (spec stand-ins.md §1.1, §1.2). The link handler and the
// /api/cockpit/* routes call them; by default every hook is a no-op and the
// room behaves exactly as without this module. Nothing in server/ ever calls
// setFaults(): only the room under test's wrapper does (D109), so production
// has no switch for any of this.
//
//   atUpgrade(req, socket, kind)   before an upgrade ('ws') or an HTTP request
//                                  ('http') under /api/cockpit is read; true =
//                                  the hook took the socket, the caller stops
//   atInbound(msg, link)           each inbound text message, parsed; true =
//                                  drop it unread (no echo, nothing to the agent)
//   atOutbound(msg, link)          each outbound message, after its `seq` was
//                                  given; `link` null for one sent to every
//                                  link; true = send it to no link (B18)
//   atConnection(rec)              each upgrade the link saw, once decided:
//                                  `rec` {atMs, accepted, closeCode}, the
//                                  link sets `closeCode` again at its close
//                                  (stand-ins.md §1.2 `GET /connections`)

const NONE = Object.freeze({});
let hooks = NONE;

/** Install `{upgrade?, inbound?, outbound?, connection?}` (null: back to none). */
export function setFaults(h) {
  if (h !== null && (typeof h !== 'object' || Array.isArray(h))) throw new TypeError('setFaults: hooks must be an object or null');
  for (const k of ['upgrade', 'inbound', 'outbound', 'connection']) {
    if (h?.[k] !== undefined && typeof h[k] !== 'function') throw new TypeError(`setFaults: ${k} must be a function`);
  }
  hooks = h ?? NONE;
}

export const atUpgrade = (req, socket, kind = 'ws') => hooks.upgrade?.(req, socket, kind) === true;
export const atInbound = (msg, link = null) => hooks.inbound?.(msg, link) === true;
export const atOutbound = (msg, link = null) => hooks.outbound?.(msg, link) === true;
export const atConnection = (rec) => { hooks.connection?.(rec); };
