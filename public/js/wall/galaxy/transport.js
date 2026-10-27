// The show commands, a dev adapter (Wall plan night 4 T38; aligned with the
// cockpit spec on 2026-10-27). The real road is the cockpit's room link
// (protocols.md §2, §4): the room sends `show`, `show.undo`, `pin.put` and
// `pin.remove`, the screen answers `show.result` and `pin.close`. Until the
// Wall is a paired screen, this carries the same messages, unchanged, from a
// page standing in for the room:
// - `BroadcastChannel('laneboard.show')`: pages of the same origin (another
//   tab, a controller page on the same hub). The browser keeps other origins
//   out. Answers go to the channel (match them by `showId`).
// - `window.postMessage`: a page that embeds the Wall in a frame or opened it.
//   Only from an allowed origin, compared as an exact string: the Wall's own
//   and those named by `?showOrigins=` (comma-separated `https://host[:port]`;
//   `*`, `null`, a path or another scheme are refused). The answer goes back
//   to `event.source` with the sender's origin as its target, never `*`. A
//   page served from `file:` has no origin to check: it takes no postMessage.
//
// Not ours, no answer: a type the Wall does not take in (show.js INBOUND:
// its own answers among them, so two Walls never loop), a wrong origin, a
// message over TRANSPORT.maxBytes as JSON (or not JSON at all). The room's
// `seq`, `welcome` and resume are the room link's, not this adapter's: every
// Wall that hears a command shows it.
//
// `showOrigins`, `readWire` are pure; `createTransport` takes the window and
// the channel class as arguments (test/wall-galaxy-transport.test.mjs).

import { INBOUND } from './show.js';

/** The channel's name, and `maxBytes` a whole message as JSON (a pin's card needs far less). */
export const TRANSPORT = Object.freeze({ ch: 'laneboard.show', maxBytes: 4096 });

/**
 * The origins whose postMessage the Wall takes: its own (`self`, e.g.
 * `location.origin`) and the exact `http(s)://host[:port]` strings in
 * `param` (`?showOrigins=`, comma-separated). Anything else is left out:
 * `*`, `null`, a path, a user, another scheme. An opaque own origin (`null`,
 * a `file:` page) gives an empty list: no postMessage at all. Pure.
 */
export function showOrigins(param, self) {
  const out = new Set();
  const take = (x) => {
    const s = String(x ?? '').trim();
    if (!s || s === '*' || s === 'null') return;
    let u;
    try { u = new URL(s); } catch { return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    if (u.origin !== s.replace(/\/$/, '')) return; // a path, a user, a query: not an origin
    out.add(u.origin);
  };
  take(self);
  if (!out.size) return [];
  for (const x of String(param ?? '').split(',')) take(x);
  return [...out];
}

/** `data` that came by a road: the message to hand to show.js, or null (not ours: ignore, no answer). Pure. */
export function readWire(data) {
  if (!data || typeof data !== 'object' || !INBOUND.includes(data.type)) return null;
  let size;
  try { size = JSON.stringify(data).length; } catch { size = Infinity; } // a cycle, a BigInt
  return size > TRANSPORT.maxBytes ? null : data;
}

/**
 * Listens on both roads and hands each message to `receive(msg, reply)`;
 * `reply(answer)` posts on the road it came by. Options: `win` (the window:
 * `addEventListener`, `removeEventListener`), `Channel` (the BroadcastChannel
 * class; absent: no channel), `origins` (showOrigins' list; empty: no
 * postMessage listener). Returns `{ send(answer, reply?), close() }`: `send`
 * posts by `reply`, or on the channel when it has none.
 */
export function createTransport(opts = {}) {
  const { win = null, Channel = null, origins = [] } = opts;
  const allowed = new Set(origins);

  let channel = null;
  const toChannel = (answer) => channel?.postMessage(answer);
  if (Channel) {
    channel = new Channel(TRANSPORT.ch);
    channel.addEventListener('message', (ev) => {
      const msg = readWire(ev.data);
      if (msg) opts.receive(msg, toChannel);
    });
  }

  // Not even listened for when no origin may send (MDN: no listener if none is expected).
  const onMessage = (ev) => {
    if (!allowed.has(ev.origin)) return;
    const msg = readWire(ev.data);
    if (!msg) return;
    const { source, origin } = ev;
    const reply = source && typeof source.postMessage === 'function' ? (answer) => source.postMessage(answer, origin) : toChannel;
    opts.receive(msg, reply);
  };
  const listening = Boolean(win && allowed.size);
  if (listening) win.addEventListener('message', onMessage);

  return {
    send: (answer, reply = null) => (reply ?? toChannel)(answer),
    close: () => {
      channel?.close();
      channel = null;
      if (listening) win.removeEventListener('message', onMessage);
    },
  };
}
