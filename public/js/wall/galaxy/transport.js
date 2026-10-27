// The show commands, the transport (Wall plan night 4 T38, §7 Night 4 B;
// research Q16): how a sender's message reaches show.js and how its answer
// goes back. The message is show.js's envelope, unchanged on every road:
//   { v: 1, ch: 'laneboard.show', id, src, type, ttl?, data }
// and the answer `{ v: 1, ch: 'laneboard.show', re: id, ok, code? }`.
//
// Two roads, both into the same `send(msg)` (createShow's), both answered on
// the road the message came by:
// - `BroadcastChannel('laneboard.show')`: pages of the same origin (another
//   tab, a controller page on the same hub). The browser keeps other origins
//   out; the shape is still checked (show.js readShow). The answer goes to
//   the channel, so every listener there hears it (match it by `re`).
// - `window.postMessage`: a page that embeds the Wall in a frame or opened it.
//   Only from an allowed origin, compared as an exact string: the Wall's own
//   and those named by `?showOrigins=` (comma-separated `https://host[:port]`;
//   `*`, `null`, a path or another scheme are refused). The answer goes back
//   to `event.source` with the sender's origin as its target, never `*`. A
//   page served from `file:` has no origin to check: it takes no postMessage.
//
// Not ours, no answer: a message on another channel or version, an answer
// (it has `re`), a wrong origin. Too big (over TRANSPORT.maxBytes as JSON, or
// not JSON at all): `bad-shape` when it carried an id. The relay room → hub →
// screens is cockpit work (fenced hub files), so a screen has no name yet and
// Q16's `dst` is not read: every screen that hears a command shows it.
//
// `showOrigins`, `readWire` are pure; `createTransport` takes the window and
// the channel class as arguments (test/wall-galaxy-transport.test.mjs).

import { SHOW } from './show.js';

/** `maxBytes` a whole message as JSON (Q16: about 4 KB; a card needs far less). */
export const TRANSPORT = Object.freeze({ maxBytes: 4096 });

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

/**
 * What the transport does with `data` that came by a road: `{ pass: msg }`
 * to hand to show.js, `{ answer }` (a `bad-shape` for an oversized message
 * that carried an id) or `{}` (not ours: ignore, no answer). Pure.
 */
export function readWire(data) {
  if (!data || typeof data !== 'object' || data.ch !== SHOW.ch || data.v !== SHOW.v) return {};
  if ('re' in data) return {}; // an answer, ours or another screen's
  let size;
  try { size = JSON.stringify(data).length; } catch { size = Infinity; } // a cycle, a BigInt
  if (size > TRANSPORT.maxBytes) {
    const id = typeof data.id === 'string' && data.id.length <= SHOW.maxId && data.id.trim() ? data.id : null;
    return id ? { answer: { v: SHOW.v, ch: SHOW.ch, re: id, ok: false, code: 'bad-shape' } } : {};
  }
  return { pass: data };
}

/**
 * Listens on both roads and hands each message to `send(msg)` (returns the
 * answer or null). Options: `win` (the window: `addEventListener`,
 * `removeEventListener`), `Channel` (the BroadcastChannel class; absent: no
 * channel), `origins` (showOrigins' list; empty: no postMessage listener).
 * Returns `{ close() }`.
 */
export function createTransport(opts = {}) {
  const { win = null, Channel = null, origins = [] } = opts;
  const allowed = new Set(origins);
  const take = (data) => {
    const w = readWire(data);
    if (w.answer) return w.answer;
    return w.pass ? opts.send(w.pass) : null;
  };

  let channel = null;
  if (Channel) {
    channel = new Channel(SHOW.ch);
    channel.addEventListener('message', (ev) => {
      const answer = take(ev.data);
      if (answer) channel.postMessage(answer);
    });
  }

  // Not even listened for when no origin may send (Q16, MDN: no listener if none is expected).
  const onMessage = (ev) => {
    if (!allowed.has(ev.origin)) return;
    const answer = take(ev.data);
    if (answer && ev.source && typeof ev.source.postMessage === 'function') ev.source.postMessage(answer, ev.origin);
  };
  const listening = Boolean(win && allowed.size);
  if (listening) win.addEventListener('message', onMessage);

  return {
    close: () => {
      channel?.close();
      channel = null;
      if (listening) win.removeEventListener('message', onMessage);
    },
  };
}
