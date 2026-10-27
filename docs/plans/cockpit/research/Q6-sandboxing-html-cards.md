# Q6 Sandboxing agent-written HTML cards

## Answer

- Put each card in an `<iframe sandbox="allow-scripts">` and **never** add `allow-same-origin`: with both, the card can remove its own sandbox (MDN). Without it the card gets an opaque origin: no cookies, no storage, no DOM access to the cockpit.
- Block the network with a CSP. `connect-src 'none'` covers `fetch`, XHR, `WebSocket`, `EventSource`, `sendBeacon` and `<a ping>`, but not images, forms, navigation or WebRTC, so use `default-src 'none'` plus explicit allowances, `form-action 'none'`, `base-uri 'none'`.
- Deliver the CSP as an HTTP header on a card route, not only via `srcdoc`. A `srcdoc`/`blob:`/`data:` document **inherits a copy of the embedder's CSP** (CSP3 §7.8) and cannot be given a stricter one except through the experimental iframe `csp` attribute, which is not Baseline.
- Data goes in and out only through `postMessage` (parent checks `event.source`; origin of messages from a sandboxed frame is the string `"null"`).
- Known gaps a CSP does not close: WebRTC (see below), navigation of the frame itself, and timing or resource-exhaustion attacks. The spec must say so and not claim "no exfiltration".

## What the spec needs

Iframe attributes (MDN `iframe`, read 2026-10-27):
- `sandbox=""` applies all restrictions; tokens lift them one by one: `allow-scripts`, `allow-same-origin`, `allow-forms`, `allow-modals`, `allow-popups`, `allow-top-navigation*`, `allow-downloads`, `allow-pointer-lock`, `allow-orientation-lock`, `allow-presentation`, `allow-popups-to-escape-sandbox`, `allow-storage-access-by-user-activation`.
- Cockpit card: `sandbox="allow-scripts"` only. No `allow-modals` (an `alert()` would block a touch screen), no popups, no top navigation, no forms, no downloads.
- `srcdoc` frames have location `about:srcdoc`; relative URLs resolve against the embedder.

CSP (MDN `connect-src`, CSP3, read 2026-10-27):
- `connect-src 'none'` blocks `fetch()`, XHR, `WebSocket`, `EventSource`, `sendBeacon`, `ping`. If absent it falls back to `default-src`.
- `'self'` does not match `ws:`/`wss:` in all browsers (irrelevant here, we allow none).
- Recommended header for the card route (my proposal, built from the directives above, not copied from a source):
  `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts`
  The `sandbox` CSP directive (CSP3 §6.3.2, body not read) applies the sandbox even if the page is opened outside the iframe. `unsafe-inline` is acceptable because the card is the untrusted part; the CSP blocks what it can reach, not what it can run.
- Inheritance (CSP3 §7.8): local-scheme documents (`srcdoc`, `blob:`, `data:`, `about:blank`) get a snapshot copy of the creator's policies. So a `srcdoc` card under the cockpit's own CSP either runs under the cockpit's (probably too loose or too strict) policy. A server route with its own header avoids this.
- `HTMLIFrameElement.csp` / `<iframe csp="…">` (Embedded Enforcement): MDN marks it experimental, limited availability; I could not read the compatibility table. Do not rely on it; at most add it as a second layer.

`srcdoc` vs blob vs route:
| way | origin with `sandbox="allow-scripts"` | own CSP | note |
|---|---|---|---|
| `srcdoc` | opaque | no, inherits parent | simplest, needs parent CSP to fit |
| `blob:` URL | opaque (sandbox flag), blob created by cockpit origin | no, inherits | leaks nothing extra, must be revoked |
| `src="/card/<id>"` + header | opaque (sandbox flag in iframe and CSP) | **yes** | recommended; needs a server route |

`postMessage` bridge:
- Parent to card: `frame.contentWindow.postMessage(msg, "*")` (the target origin of an opaque-origin frame can only be `"*"`; send only data meant for that card, nothing secret).
- Card to parent: `parent.postMessage(msg, "*")`; the parent handler checks `event.source === frame.contentWindow` (origin is `"null"` and proves nothing), validates the message against a fixed schema (type, size cap), and ignores everything else. Parent never uses `innerHTML`, `eval` or navigation from card data.
- Suggested caps (my choice, to log in DECISIONS): card HTML 200 KB, message 64 KB, 10 messages per second.

Known escapes and gaps:
- `allow-scripts` + `allow-same-origin` on same-origin content: sandbox removable (MDN).
- WebRTC: `connect-src` does not cover it (public-webrtc list thread 2018, WebAppSec issue 92). Data can leave through ICE/TURN username fields without a connection. A `webrtc` CSP directive exists in the CSP3 index (§6.2.1) but I did not read its body or confirm Chromium ships it. Mitigations to test, not assume: add `webrtc 'block'` to the header, and the kiosk may disable WebRTC by Chromium policy `WebRtcIPHandling`/`WebRtcUdpPortRange` (names from memory, **unconfirmed**).
- Image, CSS and DNS-prefetch leaks are closed only if `default-src 'none'` is present and `img-src` is `data:`; `<link rel=prefetch>` from a `Link` response header is not blocked by a meta CSP (CSP3 §3.3), another reason for a header and not `<meta>`.
- Top navigation: closed by omitting `allow-top-navigation*`. The frame can still navigate itself; `default-src 'none'` does not stop a navigation request, and `navigate-to` was not found in the spec text read, so assume it is not available. Put no secrets in the card URL.
- CPU and memory exhaustion (infinite loop, huge DOM) are not stopped; the cockpit needs a close button outside the frame and a "card is not responding" path. Not researched further.

## What the cockpit could take

1. Cards are rendered via `<iframe sandbox="allow-scripts" src="/card/<id>">` served with the header above; the server stores the agent's HTML and serves it with that header only.
2. A test (T17): a stand-in card tries `fetch`, `new WebSocket`, `new Image().src`, `window.top.location`, `localStorage`, `document.cookie`, `parent.document`, `alert`, `new RTCPeerConnection`; the test asserts the first eight fail or are blocked and records the WebRTC result as known (a spec decision, not a pass by assumption).
3. The data bridge: one message type each way, `{type:"card:data", v:1, data:<json>}` to the card and `{type:"card:tap", v:1, id:<string ≤64>}` back, size-capped, schema-checked.
4. Say in the safety section that the sandbox limits damage and exfiltration paths but is not a guarantee against WebRTC; show cards from untrusted-ish sources only after the owner enabled them (a question for the owner if not settled).

## Could not confirm

- Bodies of CSP3 §6.2.1 (`webrtc`) and §6.3.2 (`sandbox`), and whether Chromium ships `webrtc`.
- Browser compatibility of iframe `csp`.
- Chromium policy names for disabling WebRTC.
- Current (2026) state of the WebRTC gap; sources found are from 2015-2018.

## Sources (read 2026-10-27)

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLIFrameElement/csp
- https://w3c.github.io/webappsec-csp/ and https://www.w3.org/TR/CSP3/ (§3.3, §4.2, §7.8; partial reads)
- https://github.com/w3c/webappsec-csp/issues/92 and public-webrtc list threads 2018 Jan (e.g. https://lists.w3.org/Archives/Public/public-webrtc/2018Jan/0109.html), via search snippets only
- The MDN `webrtc` directive page returned 404; no page tried to instruct me.
