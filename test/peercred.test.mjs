import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseProcNetTcp, peerUid, socketPeerUid, normAddr, peerUidMatches, peerUidSupported,
  PROC_NET_TCP, PROC_NET_TCP6, TCP_ESTABLISHED, LOOPBACK_ADDRS,
} from '../server/fleet/peercred.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'proc-net');
const TCP = fs.readFileSync(path.join(dir, 'tcp'), 'utf8');
const TCP6 = fs.readFileSync(path.join(dir, 'tcp6'), 'utf8');
const LE = { littleEndian: true };
const A4 = { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' };
const A6 = { remoteAddress: '::1', localAddress: '::1' };

function reader(files) {
  const calls = [];
  const read = (p, enc) => {
    calls.push([p, enc]);
    if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
    return files[p];
  };
  read.calls = calls;
  return read;
}
const both = () => reader({ [PROC_NET_TCP]: TCP, [PROC_NET_TCP6]: TCP6 });

test('parseProcNetTcp: IPv4 rows, header and malformed lines skipped', () => {
  const rows = parseProcNetTcp(TCP, LE);
  // 13 lines: header, 8 good rows (0-7), 4 malformed (bad hex, short, garbage, non-numeric uid).
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[0], { local: { addr: '127.0.0.1', port: 7778 }, remote: { addr: '0.0.0.0', port: 0 }, state: 10, uid: 1000 });
  assert.deepEqual(rows[1], { local: { addr: '127.0.0.1', port: 54321 }, remote: { addr: '127.0.0.1', port: 7778 }, state: TCP_ESTABLISHED, uid: 0 });
  assert.equal(rows[5].state, 6); // TIME_WAIT row parses (short trailing fields)
  assert.ok(!rows.some((r) => [54325, 54326, 54327].includes(r.local.port)));
});

test('parseProcNetTcp: IPv6 and v4-mapped rows parse', () => {
  const rows = parseProcNetTcp(TCP6, LE);
  assert.equal(rows.length, 6); // last row has a 16-hex-digit address: skipped
  assert.deepEqual(rows[0].local, { addr: '::', port: 7778 });
  assert.deepEqual(rows[1], { local: { addr: '::ffff:127.0.0.1', port: 54336 }, remote: { addr: '::ffff:127.0.0.1', port: 7778 }, state: 1, uid: 0 });
  assert.deepEqual(rows[3].local, { addr: '::1', port: 54337 });
  assert.equal(rows[5].local.addr, '2001:db8::1');
});

test('parseProcNetTcp: big-endian hosts decode words in natural order', () => {
  const rows = parseProcNetTcp('   0: 7F000001:1E62 7F000001:D431 01 00000000:00000000 00:00000000 00000000     0        0 1 1 0\n', { littleEndian: false });
  assert.deepEqual(rows[0].local, { addr: '127.0.0.1', port: 7778 });
});

test('parseProcNetTcp: never throws on junk', () => {
  for (const junk of [undefined, null, 42, {}, '', '\n\n', ':::: ::::', '0: a b c d e f g h i j', '   0: 0100007F:1E62:00 0100007F:D431 01 a b c 0 0 0']) {
    assert.deepEqual(parseProcNetTcp(junk), []);
  }
  assert.deepEqual(parseProcNetTcp('   0: 0100007F:1E62 0100007F:D431 01 a b c 99999999999 0 0', LE), []);
});

test('peerUid: established 127.0.0.1:<eph> -> 127.0.0.1:7778 returns the peer uid', () => {
  const read = both();
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read, ...LE }), 0);
  assert.deepEqual(read.calls.map((c) => c[0]), [PROC_NET_TCP, PROC_NET_TCP6]);
  assert.equal(read.calls[0][1], 'utf8');
  // Another local process connecting to the ingress port: its own uid, which the caller then refuses.
  assert.equal(peerUid({ ...A4, remotePort: 54322, localPort: 7778, read, ...LE }), 1001);
});

test('peerUid: v4-mapped and ::1 rows in tcp6 match', () => {
  assert.equal(peerUid({ ...A4, remotePort: 54336, localPort: 7778, read: both(), ...LE }), 0);
  assert.equal(peerUid({ ...A6, remotePort: 54337, localPort: 7778, read: both(), ...LE }), 0);
});

test('peerUid: missing or non-matching rows return null', () => {
  const read = both();
  assert.equal(peerUid({ ...A4, remotePort: 60000, localPort: 7778, read, ...LE }), null); // no row
  assert.equal(peerUid({ ...A4, remotePort: 54333, localPort: 7778, read, ...LE }), null); // TIME_WAIT only
  assert.equal(peerUid({ ...A4, remotePort: 54324, localPort: 7778, read, ...LE }), null); // peer goes to 7777, not 7778
  assert.equal(peerUid({ ...A4, remotePort: 54324, localPort: 7777, read, ...LE }), 0);
  assert.equal(peerUid({ ...A4, remotePort: 54338, localPort: 7778, read, ...LE }), null); // non-loopback local end
  assert.equal(peerUid({ ...A4, remotePort: 54325, localPort: 7778, read, ...LE }), null); // malformed row
});

test('peerUid: one file missing is tolerated, both missing is null', () => {
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: reader({ [PROC_NET_TCP]: TCP }), ...LE }), 0);
  assert.equal(peerUid({ ...A6, remotePort: 54337, localPort: 7778, read: reader({ [PROC_NET_TCP6]: TCP6 }), ...LE }), 0);
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: reader({}), ...LE }), null);
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: () => { throw new Error('EACCES'); } }), null);
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: () => 42 }), null);
  // Buffers are accepted.
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: (p) => (p === PROC_NET_TCP ? Buffer.from(TCP) : ''), ...LE }), 0);
});

test('peerUid: ambiguous uids return null', () => {
  const dup = '   0: 0100007F:D431 0100007F:1E62 01 0:0 0:0 0     0 0 1 1 0\n'
    + '   1: 0100007F:D431 0100007F:1E62 01 0:0 0:0 0  1000 0 2 1 0\n';
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: reader({ [PROC_NET_TCP]: dup }), ...LE }), null);
  const same = dup.replace(' 1000 ', '    0 ');
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: reader({ [PROC_NET_TCP]: same }), ...LE }), 0);
});

test('peerUid: bad ports return null without reading', () => {
  for (const [remotePort, localPort] of [[undefined, 7778], [54321, undefined], [0, 7778], [65536, 7778], [1.5, 7778], ['54321', 7778], [-1, 7778]]) {
    const read = both();
    assert.equal(peerUid({ ...A4, remotePort, localPort, read }), null);
    assert.equal(read.calls.length, 0);
  }
  assert.equal(peerUid(), null);
});

test('socketPeerUid / peerUidMatches: fail closed', () => {
  assert.equal(socketPeerUid({ remotePort: 54321, localPort: 7778 }, { lookup: (a) => (a.remotePort === 54321 && a.localPort === 7778 ? 0 : 5) }), 0);
  let args;
  socketPeerUid({ remoteAddress: '127.0.0.2', remotePort: 5, localAddress: '127.0.0.1', localPort: 6 }, { lookup: (a) => { args = a; return null; } });
  assert.deepEqual(args, { remoteAddress: '127.0.0.2', remotePort: 5, localAddress: '127.0.0.1', localPort: 6 });
  assert.equal(socketPeerUid({ remotePort: 1, localPort: 2 }, { lookup: () => { throw new Error('x'); } }), null);
  assert.equal(socketPeerUid({ remotePort: 1, localPort: 2 }, { lookup: () => 'root' }), null);
  assert.equal(socketPeerUid(null), null);
  let seen;
  const read = () => '';
  socketPeerUid({ remotePort: 1, localPort: 2 }, { read, lookup: (a) => { seen = a; return null; } });
  assert.equal(seen.read, read);
  assert.equal(peerUidMatches(0, 0), true);
  assert.equal(peerUidMatches(1000, 0), false);
  assert.equal(peerUidMatches(null, 0), false);
  assert.equal(peerUidMatches(undefined, undefined), false);
  assert.equal(peerUidMatches(null, null), false);
  assert.equal(peerUidMatches('0', 0), false);
});

// SR21 H1: tailscaled holds 127.0.0.1:54321 -> 127.0.0.1:7778 (uid 0). An attacker (uid 1001) binds
// 127.0.0.2:54321 (free on that address) and connects to the ingress port. Matching on ports alone left only
// tailscaled's row and handed the attacker uid 0.
const HIJACK = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:D431 0100007F:1E62 01 00000000:00000000 00:00000000 00000000     0        0 51001 1 0 20 4 30 10 -1', // tailscaled
  '   1: 0100007F:1E62 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 51002 1 0 20 4 30 10 -1', // server side
  '   2: 0200007F:D431 0100007F:1E62 01 00000000:00000000 00:00000000 00000000  1001        0 51003 1 0 20 4 30 10 -1', // attacker
  '   3: 0100007F:1E62 0200007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 51004 1 0 20 4 30 10 -1', // server side
  '',
].join('\n');
// Same attack through the v4-mapped tcp6 table (dual-stack listener).
const HIJACK6 = [
  '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0000000000000000FFFF00000100007F:D431 0000000000000000FFFF00000100007F:1E62 01 00000000:00000000 00:00000000 00000000     0        0 52001 1 0 20 4 30 10 -1',
  '   1: 0000000000000000FFFF00000200007F:D431 0000000000000000FFFF00000100007F:1E62 01 00000000:00000000 00:00000000 00000000  1001        0 52002 1 0 20 4 30 10 -1',
  '',
].join('\n');

test('SR21 H1: another loopback address reusing tailscaled\'s source port never inherits its uid', () => {
  const read = reader({ [PROC_NET_TCP]: HIJACK });
  // The attacker's accepted socket: remote 127.0.0.2:54321, local 127.0.0.1:7778 -> refused before any lookup.
  assert.equal(peerUid({ remoteAddress: '127.0.0.2', remotePort: 54321, localAddress: '127.0.0.1', localPort: 7778, read, ...LE }), null);
  assert.equal(read.calls.length, 0);
  assert.equal(peerUid({ remoteAddress: '::ffff:127.0.0.2', remotePort: 54321, localAddress: '::ffff:127.0.0.1', localPort: 7778, read, ...LE }), null);
  // tailscaled itself still matches, on the exact 4-tuple only.
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read, ...LE }), 0);
  assert.equal(peerUid({ remoteAddress: '::ffff:127.0.0.1', remotePort: 54321, localAddress: '::ffff:127.0.0.1', localPort: 7778, read, ...LE }), 0);
  // Without the 127.0.0.1-only gate the exact match still keeps the rows apart (the attacker's row has 127.0.0.2).
  const only = reader({ [PROC_NET_TCP]: HIJACK.split('\n').filter((l) => !l.includes('51001')).join('\n') });
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: only, ...LE }), null);
  // The listener's own address must match the row's remote end too.
  assert.equal(peerUid({ remoteAddress: '127.0.0.1', remotePort: 54321, localAddress: '::1', localPort: 7778, read, ...LE }), null);
  // v4-mapped tcp6 rows: the attacker row (::ffff:127.0.0.2) never satisfies a 127.0.0.1 socket and vice versa.
  const r6 = reader({ [PROC_NET_TCP6]: HIJACK6 });
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: r6, ...LE }), 0);
  const r6only = reader({ [PROC_NET_TCP6]: HIJACK6.split('\n').filter((l) => !l.includes('52001')).join('\n') });
  assert.equal(peerUid({ ...A4, remotePort: 54321, localPort: 7778, read: r6only, ...LE }), null);
});

test('peerUid: missing or bad addresses return null without reading', () => {
  for (const [remoteAddress, localAddress] of [[undefined, '127.0.0.1'], ['127.0.0.1', undefined], ['10.0.0.1', '127.0.0.1'], ['127.0.0.1', '0.0.0.0'], [42, '127.0.0.1'], ['127.1', '127.0.0.1'], ['', '127.0.0.1']]) {
    const read = both();
    assert.equal(peerUid({ remoteAddress, remotePort: 54321, localAddress, localPort: 7778, read, ...LE }), null);
    assert.equal(read.calls.length, 0);
  }
  assert.equal(normAddr('::FFFF:127.0.0.1'), '127.0.0.1');
  assert.equal(normAddr('::1'), '::1');
  assert.equal(normAddr(null), null);
});

test('live: an accepted socket from 127.0.0.2 reusing an open connection\'s source port gets no uid', { skip: process.platform !== 'linux' || !fs.existsSync(PROC_NET_TCP) }, async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const conns = [];
  server.on('connection', (s) => conns.push(s));
  const legit = net.connect(port, '127.0.0.1');
  await new Promise((r) => legit.once('connect', r));
  let attacker;
  try {
    attacker = net.connect({ port, host: '127.0.0.1', localAddress: '127.0.0.2', localPort: legit.localPort });
    const ok = await new Promise((r) => { attacker.once('connect', () => r(true)); attacker.once('error', () => r(false)); });
    if (!ok) return; // 127.0.0.2 not bindable here: the fixture test above covers it
    while (conns.length < 2) await new Promise((r) => setTimeout(r, 5));
    const a = conns.find((s) => s.remoteAddress === '127.0.0.2' || s.remoteAddress === '::ffff:127.0.0.2');
    const l = conns.find((s) => s !== a);
    assert.equal(socketPeerUid(a), null);
    assert.equal(socketPeerUid(l), process.getuid());
  } finally {
    attacker?.destroy();
    legit.destroy();
    for (const s of conns) s.destroy();
    await new Promise((r) => server.close(r));
  }
});

test('constants', () => {
  assert.deepEqual([...LOOPBACK_ADDRS], ['127.0.0.1', '::1', '::ffff:127.0.0.1']);
  assert.equal(peerUidSupported('linux'), true);
  assert.equal(peerUidSupported('darwin'), false);
});

test('live: finds the uid of a real loopback client socket owned by this process', { skip: process.platform !== 'linux' || !fs.existsSync(PROC_NET_TCP) }, async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const accepted = new Promise((r) => server.once('connection', r));
  const client = net.connect(server.address().port, '127.0.0.1');
  try {
    const sock = await accepted;
    const uid = socketPeerUid(sock);
    assert.equal(uid, process.getuid());
    assert.equal(peerUid({ remoteAddress: sock.remoteAddress, remotePort: sock.remotePort, localAddress: sock.localAddress, localPort: sock.localPort }), process.getuid());
    sock.destroy();
  } finally {
    client.destroy();
    await new Promise((r) => server.close(r));
  }
});
