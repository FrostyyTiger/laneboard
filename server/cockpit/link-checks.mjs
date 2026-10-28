// The room link's upgrade checks (spec protocols.md §2.3, screens.md §6.2,
// §6.2.1, security.md §2.3; D135, D182, D212). REVIEW-REQUIRED: this decides
// who may talk to the agent.
//
//   linkRefusal(req, opts) → null (the link may open) or {code, reason}
//
// The room accepts every upgrade on /api/cockpit/ws and then refuses with a
// close code (D135: a browser cannot read a refused upgrade's status). The
// board's upgrade guard (server/boot/common.mjs → auth.guardUpgrade) has
// already run before this: Host, the request's classification, the kind rules,
// an `Origin` that is present, `Sec-Fetch-Site`. These checks repeat the
// Host/Origin ones (the room never trusts that a caller ran them), then add
// what only the room asks, in §2.3's order:
//   1. Host and Origin (`checkUpgrade`, server/security.mjs): 4403 `bad-host`,
//      `bad-origin`; no `Origin` at all: 4403 `no-origin` (screens.md §6.2: a
//      browser always sends one, so an upgrade without it is not a page);
//      `Sec-Fetch-Site` other than `same-origin`/`none`: 4403 `sec-fetch-site`.
//   2. The `Origin`'s scheme (D182): `https:`, or `http:` on a loopback host
//      from a loopback TCP peer (the `Origin` is text any script sets, the peer
//      address is not), unless `cockpit.allowInsecure` is exactly `true`:
//      4403 `insecure-origin`.
//   3. The link count (§8): 32 open links, the 33rd is 4503 `too-many-links`.
//   4. The credential (D212, Q-O21 b, no pairing in C1): the board's own
//      classification of the upgrade. Only `local` (the main port, from a
//      loopback peer the room checks itself, security.md §2.3 point 2) or
//      `direct` (the ingress listener with `fleet.allowedUsers` applied by
//      the board) gets the link; anything else (a `hub` kind, a `local` from
//      a non-loopback or unknown peer, an unauthenticated or missing
//      classification) is 4401 `unpaired`, the code for "no credential the
//      room takes" (B92).
import net from 'node:net';

import { checkUpgrade } from '../security.mjs';
import { isAuthenticated } from '../http.mjs';
import { isIngress } from '../fleet/auth.mjs';

/** protocols.md §8: the most links a room holds at once. */
export const MAX_LINKS = 32;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * Is the TCP peer a loopback address (127.0.0.0/8, ::1, ::ffff:127.*)? An
 * unknown or non-IP address is false: fail closed, as server/fleet/auth.mjs's
 * own peer check (security.md §2.3 point 2, D212).
 */
export function loopbackPeer(remoteAddress) {
  if (typeof remoteAddress !== 'string') return false;
  let a = remoteAddress.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) a = mapped[1];
  if (net.isIPv4(a)) return a.startsWith('127.');
  return net.isIPv6(a) && a === '::1';
}

/**
 * D182: an `Origin` the room links (screens.md §6.2.1): https, or http on a
 * loopback host when the TCP peer (`remoteAddress`) is loopback too. The
 * `Origin` text alone never proves plain HTTP stayed on the machine.
 */
export function secureOrigin(origin, remoteAddress) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol === 'https:') return true;
  if (u.protocol !== 'http:') return false;
  const loopbackHost = LOOPBACK_HOSTS.has(u.hostname) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname);
  return loopbackHost && loopbackPeer(remoteAddress);
}

/**
 * `opts`: `config` (the room's, for Host/Origin), `links` (how many links are
 * open now), `allowInsecure` (`cockpit.allowInsecure`), `ctx` (checkUpgrade's
 * listener context; default from the request's socket).
 */
export function linkRefusal(req, { config, links = 0, allowInsecure = false, ctx } = {}) {
  const headers = req?.headers ?? {};
  // 1. Host and the exact Origin (screens.md §6.2 rows 1-3).
  // The same listener context auth.guardUpgrade gives checkOrigin.
  const c = ctx ?? { trustForwardedProto: isIngress(req, config), ...(Number.isInteger(req?.socket?.localPort) ? { listenPort: req.socket.localPort } : {}) };
  const hostOrOrigin = checkUpgrade(req, config, c);
  if (hostOrOrigin === 'bad-host') return refusal(4403, 'bad-host');
  if (headers.origin === undefined || headers.origin === '') return refusal(4403, 'no-origin');
  if (hostOrOrigin) return refusal(4403, 'bad-origin');
  const sfs = headers['sec-fetch-site'];
  if (sfs !== undefined && sfs !== 'same-origin' && sfs !== 'none') return refusal(4403, 'sec-fetch-site');
  // 2. D182: never a token or a conversation over plain HTTP off loopback.
  const peer = req?.socket?.remoteAddress;
  if (allowInsecure !== true && !secureOrigin(headers.origin, peer)) return refusal(4403, 'insecure-origin');
  // 3. §8: the 33rd link is refused and never counted.
  if (links >= MAX_LINKS) return refusal(4503, 'too-many-links');
  // 4. D212: the board's own people only, as the board classified them.
  const kind = isAuthenticated(req?.auth) ? req.auth.kind : null;
  if (kind !== 'local' && kind !== 'direct') return refusal(4401, 'unpaired');
  // security.md §2.3 point 2, D212: `local` is "the main port, a loopback
  // peer". The board can classify a request on a non-loopback bind as `local`
  // (no fleet block), so the room asks the socket itself; unknown is refused.
  if (kind === 'local' && !loopbackPeer(peer)) return refusal(4401, 'unpaired');
  return null;
}

const refusal = (code, reason) => ({ code, reason });
