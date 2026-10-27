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
//   2. The `Origin`'s scheme (D182): `https:`, or `http:` on a loopback host,
//      unless `cockpit.allowInsecure` is exactly `true`: 4403 `insecure-origin`.
//   3. The link count (§8): 32 open links, the 33rd is 4503 `too-many-links`.
//   4. The credential (D212, Q-O21 b, no pairing in C1): the board's own
//      classification of the upgrade. Only `local` (the main port, a loopback
//      peer) or `direct` (the ingress listener with `fleet.allowedUsers`
//      applied by the board) gets the link; anything else (a `hub` kind, an
//      unauthenticated or missing classification) is 4401 `unpaired`, the
//      code for "no credential the room takes" (B92).
import { checkUpgrade } from '../security.mjs';
import { isAuthenticated } from '../http.mjs';
import { isIngress } from '../fleet/auth.mjs';

/** protocols.md §8: the most links a room holds at once. */
export const MAX_LINKS = 32;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/** D182: an `Origin` the room links: https, or http on a loopback host (screens.md §6.2.1). */
export function secureOrigin(origin) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && (LOOPBACK_HOSTS.has(u.hostname) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(u.hostname));
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
  if (allowInsecure !== true && !secureOrigin(headers.origin)) return refusal(4403, 'insecure-origin');
  // 3. §8: the 33rd link is refused and never counted.
  if (links >= MAX_LINKS) return refusal(4503, 'too-many-links');
  // 4. D212: the board's own people only, as the board classified them.
  const kind = isAuthenticated(req?.auth) ? req.auth.kind : null;
  if (kind !== 'local' && kind !== 'direct') return refusal(4401, 'unpaired');
  return null;
}

const refusal = (code, reason) => ({ code, reason });
