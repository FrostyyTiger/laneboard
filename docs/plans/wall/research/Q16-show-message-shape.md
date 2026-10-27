# Q16 — The show interface's message shape

## Answer

- Every real system I read uses the same small envelope: a **type/name**, a **request id** the sender makes up, an
  optional **data object**, and a **channel/namespace** string (obs-websocket `op`+`d` with `requestType`/`requestId`;
  Cast custom messages in a `urn:x-cast:` namespace with a `senderId`; reveal.js multiplex payload with `socketId`,
  `state`, `content`). None of them has a ttl; expiry and undo are left to the receiver. So the Wall owns those.
- Recommended: one JSON-clonable object `{ v:1, ch:'laneboard.show', id, src, type, ttl?, data }` over
  `BroadcastChannel` (same origin only) and `window.postMessage` (check `event.origin` against an allowlist and
  `event.source`, validate the shape, never `'*'` when sending).
- The screen says who drives it with one line of text (`shown by <src>`) and every command is undone by an `✕` and by
  its own `ttl`. `clear` is the remote undo.

## What the builder needs

### Transports (facts)
- `BroadcastChannel`: same origin **and** same storage partition only; data is structured-cloned; the API gives
  messages no meaning, so sender and receiver must agree a format. `close()` leaves. A page on another origin cannot
  use it, so the cross-origin case needs `postMessage`. (MDN.)
- `postMessage`: MDN says always give a specific `targetOrigin` (never `*` if known), compare `event.origin` exactly
  (scheme + host + non-default port; string equality, not `indexOf`/regex), check `event.source` when you expect a
  particular window (the opener, an iframe), and "always verify the syntax of the received message". If you do not
  expect messages, add no listener. `origin` is the sender's origin at call time. `file:` pages need `*` and are not a
  security boundary, so the Wall should not accept `postMessage` commands when served from `file:`.
- WebSocket topic: the obs-websocket and Cast shapes show how a hub would carry it later (cockpit work, not this
  night); the same envelope should travel unchanged.

### Envelope (recommended)
```
{ v: 1,                      // protocol version; unknown v is dropped
  ch: 'laneboard.show',      // channel/namespace, like Cast's urn:x-cast:… ; other ch is ignored
  id: 'a1b2',                // sender-made string, unique per command; echoed in the reply and used to dedupe
  src: 'agent:builder-a',    // who drives; shown on screen as "shown by builder-a"
  type: 'flyTo' | 'highlight' | 'clear' | 'pin',
  ttl: 60,                   // seconds, optional; default 60, max 600; 0 = until undone
  data: { … } }              // per type below
```
- `flyTo`: `data:{ node }`. `highlight`: `data:{ nodes:[…], note }`. `pin`: `data:{ node, card:{ title, text } }`.
  `clear`: `data:{ id? }` (one command by its id, or everything shown if omitted).
- Limits: whole message under about 4 KB (Cast caps point-to-point at 64 KB; a Wall card needs far less); `nodes`
  at most 16; `note`/`card.text` plain text, at most 140 characters, rendered with `textContent`, never HTML.
- Reply (optional, over the same channel): `{ v:1, ch, re:id, ok:true|false, code }`, shaped like obs-websocket's
  `requestStatus {result, code, comment}`. Useful codes: `unknown-node`, `bad-shape`, `busy` (a finger holds the
  screen), `expired`.
- Unknown fields are ignored; an unknown `type` gets `ok:false, code:'bad-shape'`.

### Expiry, undo, who is driving
- OBS and Cast define no expiry; reveal.js multiplex has none (its client only applies `state`). Grafana kiosk is a
  mode with a manual exit (the current docs say Esc or the settings icon), which is the same "a human takes it back"
  idea. So: ttl is Wall policy. Each command carries its own timer; `clear` or a tap on `✕` ends it at once; a newer
  `flyTo` replaces the older one (last wins, one flight at a time, as the director already does).
- A finger always wins: while touch holds the screen a command is queued (up to its ttl) or answered `busy`; it
  never moves the view under a finger.
- Who is driving: one mono line near the commanded thing: `shown by builder-a · 42 s`, with the `✕` (48 px target,
  Q6). Nothing silent: the screen does not change without that line. The remaining seconds mean something, so the
  line is allowed to tick once a second; it need not tick below the fold of the ttl (show seconds only in the last 10).
- Dedupe by `id` (keep the last 64 ids); `BroadcastChannel` also delivers to other tabs, so every screen may act, and
  a screen that is not meant to act must ignore a `dst` that is not its own (optional `dst` field; absent = all).

### Origin and trust
- Same origin `BroadcastChannel`: no origin check available or needed, but still validate the shape.
- `postMessage`: allowlist from a documented list (default: same origin only; extra origins by `?showOrigins=` with
  exact `https://host[:port]` strings, parsed with `new URL(x).origin`, rejecting `*` and `null`). Check
  `event.source === window.parent || window.opener` when the Wall is embedded or opened by a controller.
- The Wall is display-only: a command may move the camera and add text. It cannot change data, call the hub or open
  a URL. That limits what a forged message can do to a shown lie, which the `shown by` line makes visible.
  The README's "display only" rule matches this.

## What laneboard's Wall could take (concretely)
1. `galaxy/show.js` stays pure: `apply(state, msg, now)` → new state, plus `expire(state, now)`. State holds a list of
   active commands `{id, src, type, data, until}`; the renderer shows one `shown by` line per active command (or one
   merged line when more than one: `shown by builder-a (+2)`).
2. A separate `transport.js` (B2) validates `v`, `ch`, `type`, sizes and string lengths, then calls `apply`. Tests:
   foreign origin dropped, `*`/`null` allowlist entries rejected, oversized dropped, duplicate `id` ignored,
   `ttl` clamped, `clear` ends one or all, `busy` while held.
3. The recorded demo (B3) is a list of `{at, msg}` in the same envelope, so the demo drives the same code path as a real
   sender.
4. The envelope fits the director's `show` source: `flyTo` becomes a director request with source `show`; its ttl
   becomes the hold time.

## Could not confirm
- reveal.js multiplex: I read only `client.js` of the standalone plugin; the master side and the secret handling were
  not seen. The web search snippet about an `event.origin` condition in a fork is unverified.
- Grafana kiosk exit key differs by version in the sources (Esc in current docs, `d k`/`d v` in v5–v8 docs); no
  Grafana remote-control protocol was found (a forum thread asks about it; I did not read it).
- No digital signage vendor (Yodeck, Xibo, Screenly) was read; their player protocols are mostly proprietary or
  polling. The recommended shape is a synthesis from OBS, Cast, reveal.js and MDN, not an existing standard.
- obs-browser custom events: the page says `emit_event` delivers `event.detail` to all browser sources but not the
  payload format.

## Sources (all read 2026-10-27)
- MDN, Window.postMessage — https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage
- MDN, Broadcast Channel API — https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
- reveal.js multiplex client — https://github.com/reveal/multiplex/blob/master/client.js
- obs-websocket protocol — https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
  (first 100,000 of 166,319 characters read)
- obs-browser README (custom events via `emit_event`, `event.detail`) — https://github.com/obsproject/obs-browser
- Google Cast Web Receiver, custom messages — https://developers.google.com/cast/docs/web_receiver/core_features
- Grafana playlist/kiosk docs, via search results — https://grafana.com/docs/grafana/v8.2/dashboards/playlist
  and https://www.mintlify.com/grafana/grafana/dashboards/playlists (a mirror; not the official page)
- CodeQL, missing origin verification in postMessage — https://codeql.github.com/codeql-query-help/javascript/js-missing-origin-check/
