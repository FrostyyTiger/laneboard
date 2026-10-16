// Ingress peer-uid lookup (fleet plan §2 2.2/2.3, SECURITY-FIXES S6 part c, task A11). REVIEW-REQUIRED.
//
// When `fleet.ingressPeerUid` is set, every connection on the ingress listener must come from a socket owned by
// that uid (the uid `tailscaled` runs as). Node exposes no SO_PEERCRED for TCP, so the owner is looked up in
// /proc/net/tcp and /proc/net/tcp6: the peer's socket is the row whose LOCAL end is exactly the accepted
// connection's remote address+port and whose REMOTE end is exactly its local address+port.
//
// Rules, each one load-bearing:
// - Pure parser, never throws: a malformed line is skipped. A lookup never throws either; every failure is `null`.
// - The caller (A8, `listenAll`) treats `null` as a mismatch: fail closed, never downgraded to `local`.
// - Only ESTABLISHED rows count (a TIME_WAIT row reports uid 0 for a socket nobody owns any more).
// - Both ends must be loopback (127.0.0.1, ::1, ::ffff:127.0.0.1): the ingress listener binds 127.0.0.1 only.
//   A peer address anywhere else in 127/8 (127.0.0.2, ...) is refused before any lookup.
// - SR21 H1: a row matches only on the FULL 4-tuple (both addresses AND both ports, v4-mapped v6 normalised to
//   plain v4). Ports alone are never enough: a local attacker can bind 127.0.0.2:<tailscaled's source port>,
//   connect, and would otherwise inherit tailscaled's row and uid.
// - Two matching rows with different uids are ambiguous → `null`.
// - The server's own accepted socket (local end = ingress port) is not the peer row as long as the caller passes
//   the accepted socket's own `remotePort`/`localPort` (socketPeerUid does): the peer row's local port must be
//   the connection's remote port.
//
// Address encoding in /proc/net/tcp*: IPv4 is one 32-bit word, IPv6 four 32-bit words, each printed as 8 hex
// digits in host byte order (little-endian on x86-64/arm64); ports are 4 hex digits in natural order.

import fs from 'node:fs';
import os from 'node:os';

export const PROC_NET_TCP = '/proc/net/tcp';
export const PROC_NET_TCP6 = '/proc/net/tcp6';
/** TCP state code of an established connection (include/net/tcp_states.h). */
export const TCP_ESTABLISHED = 1;
export const LOOPBACK_ADDRS = Object.freeze(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const HEX8 = /^[0-9A-Fa-f]{8}$/;
const HEX32 = /^[0-9A-Fa-f]{32}$/;
const HEX4 = /^[0-9A-Fa-f]{4}$/;
const HEX2 = /^[0-9A-Fa-f]{2}$/;
const DEC = /^\d{1,10}$/;

/** True where the lookup can work at all (the config fragment refuses `ingressPeerUid` elsewhere). */
export function peerUidSupported(platform = process.platform) {
  return platform === 'linux';
}

// One 32-bit word as printed by the kernel -> 4 bytes in memory (network) order.
function wordBytes(hex8, littleEndian) {
  const b = [0, 2, 4, 6].map((i) => parseInt(hex8.slice(i, i + 2), 16));
  return littleEndian ? b.reverse() : b;
}

function formatV6(bytes) {
  // v4-mapped: ::ffff:a.b.c.d
  if (bytes.slice(0, 10).every((x) => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return `::ffff:${bytes.slice(12).join('.')}`;
  }
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);
  // RFC 5952: compress the longest run (>= 2) of zero groups, the first one on a tie.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best < 0) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

// "0100007F:1E62" -> {addr: '127.0.0.1', port: 7778} | null
function parseEndpoint(s, littleEndian) {
  const colon = s.indexOf(':');
  if (colon < 0 || colon !== s.lastIndexOf(':')) return null;
  const a = s.slice(0, colon);
  const p = s.slice(colon + 1);
  if (!HEX4.test(p)) return null;
  const port = parseInt(p, 16);
  if (HEX8.test(a)) return { addr: wordBytes(a, littleEndian).join('.'), port };
  if (HEX32.test(a)) {
    const bytes = [];
    for (let i = 0; i < 32; i += 8) bytes.push(...wordBytes(a.slice(i, i + 8), littleEndian));
    return { addr: formatV6(bytes), port };
  }
  return null;
}

/**
 * parseProcNetTcp(text, {littleEndian}) -> [{local:{addr,port}, remote:{addr,port}, state, uid}]
 *
 * Parses the text of /proc/net/tcp or /proc/net/tcp6 (IPv4 and IPv6 rows both accepted). `state` is the
 * numeric TCP state (1 = ESTABLISHED, 10 = LISTEN, ...). The header and every malformed line are skipped.
 * Never throws; a non-string input yields [].
 */
export function parseProcNetTcp(text, { littleEndian = os.endianness() === 'LE' } = {}) {
  if (typeof text !== 'string') return [];
  const rows = [];
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    // sl local rem st tx:rx tr:when retrnsmt uid timeout inode ...
    if (f.length < 10 || !/^\d+:$/.test(f[0])) continue;
    const local = parseEndpoint(f[1], littleEndian);
    const remote = parseEndpoint(f[2], littleEndian);
    if (!local || !remote || !HEX2.test(f[3]) || !DEC.test(f[7])) continue;
    const uid = Number(f[7]);
    if (!Number.isSafeInteger(uid) || uid > 0xffffffff) continue;
    rows.push({ local, remote, state: parseInt(f[3], 16), uid });
  }
  return rows;
}

/**
 * normAddr(a) -> canonical address string | null: lower-cased, `::ffff:a.b.c.d` -> `a.b.c.d`. Not a string → null.
 */
export function normAddr(a) {
  if (typeof a !== 'string' || a.length === 0 || a.length > 64) return null;
  const s = a.toLowerCase();
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  return m ? m[1] : s;
}

/** Normalised loopback addresses a peer or the listener may have (127/8 beyond .1 is refused on purpose). */
const LOOPBACK_NORM = new Set(['127.0.0.1', '::1']);

function validPort(p) {
  return Number.isInteger(p) && p > 0 && p <= 65535;
}

function readText(read, path) {
  try {
    const t = read(path, 'utf8');
    return typeof t === 'string' ? t : Buffer.isBuffer(t) ? t.toString('utf8') : null;
  } catch {
    return null;
  }
}

/**
 * peerUid({remoteAddress, remotePort, localAddress, localPort, read = fs.readFileSync, littleEndian}) -> uid | null
 *
 * remoteAddress/remotePort: the accepted socket's peer end (the peer's ephemeral port); localAddress/localPort:
 * its own end (the ingress listener). All four are required. Both addresses must normalise to exactly
 * 127.0.0.1 or ::1. Reads /proc/net/tcp and /proc/net/tcp6 (either may be missing, not both) and returns the uid
 * of the single ESTABLISHED row whose local end is exactly remoteAddress:remotePort and whose remote end is
 * exactly localAddress:localPort (SR21 H1). Anything else (bad ports or addresses, both reads failing, no row,
 * ambiguous uids) → null. Never throws. Callers MUST treat null as "not from serve" (fail closed).
 */
export function peerUid({ remoteAddress, remotePort, localAddress, localPort, read = fs.readFileSync, littleEndian } = {}) {
  try {
    if (!validPort(remotePort) || !validPort(localPort)) return null;
    const peerAddr = normAddr(remoteAddress);
    const selfAddr = normAddr(localAddress);
    if (!LOOPBACK_NORM.has(peerAddr) || !LOOPBACK_NORM.has(selfAddr)) return null;
    const texts = [PROC_NET_TCP, PROC_NET_TCP6].map((p) => readText(read, p)).filter((t) => t !== null);
    if (texts.length === 0) return null;
    const opts = littleEndian === undefined ? undefined : { littleEndian };
    const uids = new Set();
    for (const text of texts) {
      for (const r of parseProcNetTcp(text, opts)) {
        if (r.state !== TCP_ESTABLISHED) continue;
        if (r.local.port !== remotePort || r.remote.port !== localPort) continue;
        if (normAddr(r.local.addr) !== peerAddr || normAddr(r.remote.addr) !== selfAddr) continue;
        uids.add(r.uid);
      }
    }
    return uids.size === 1 ? [...uids][0] : null;
  } catch {
    return null;
  }
}

/**
 * socketPeerUid(socket, {read, lookup = peerUid}) -> uid | null — convenience for `listenAll` (A8): looks up the
 * peer of an accepted socket on its `connection` event. Never throws.
 */
export function socketPeerUid(socket, { read, lookup = peerUid } = {}) {
  try {
    const args = {
      remoteAddress: socket?.remoteAddress, remotePort: socket?.remotePort,
      localAddress: socket?.localAddress, localPort: socket?.localPort,
    };
    if (read) args.read = read;
    const uid = lookup(args);
    return Number.isInteger(uid) ? uid : null;
  } catch {
    return null;
  }
}

/**
 * peerUidMatches(uid, expected) -> boolean: the fail-closed comparison. A null/undefined/non-integer uid never
 * matches, whatever `expected` is.
 */
export function peerUidMatches(uid, expected) {
  return Number.isInteger(uid) && Number.isInteger(expected) && uid === expected;
}
