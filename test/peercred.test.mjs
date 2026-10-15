import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseProcNetTcp, peerUid, socketPeerUid, peerUidMatches, peerUidSupported,
  PROC_NET_TCP, PROC_NET_TCP6, TCP_ESTABLISHED, LOOPBACK_ADDRS,
} from '../server/fleet/peercred.mjs';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'proc-net');
const TCP = fs.readFileSync(path.join(dir, 'tcp'), 'utf8');
const TCP6 = fs.readFileSync(path.join(dir, 'tcp6'), 'utf8');
const LE = { littleEndian: true };

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
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read, ...LE }), 0);
  assert.deepEqual(read.calls.map((c) => c[0]), [PROC_NET_TCP, PROC_NET_TCP6]);
  assert.equal(read.calls[0][1], 'utf8');
  // Another local process connecting to the ingress port: its own uid, which the caller then refuses.
  assert.equal(peerUid({ remotePort: 54322, localPort: 7778, read, ...LE }), 1001);
});

test('peerUid: v4-mapped and ::1 rows in tcp6 match', () => {
  assert.equal(peerUid({ remotePort: 54336, localPort: 7778, read: both(), ...LE }), 0);
  assert.equal(peerUid({ remotePort: 54337, localPort: 7778, read: both(), ...LE }), 0);
});

test('peerUid: missing or non-matching rows return null', () => {
  const read = both();
  assert.equal(peerUid({ remotePort: 60000, localPort: 7778, read, ...LE }), null); // no row
  assert.equal(peerUid({ remotePort: 54333, localPort: 7778, read, ...LE }), null); // TIME_WAIT only
  assert.equal(peerUid({ remotePort: 54324, localPort: 7778, read, ...LE }), null); // peer goes to 7777, not 7778
  assert.equal(peerUid({ remotePort: 54324, localPort: 7777, read, ...LE }), 0);
  assert.equal(peerUid({ remotePort: 54338, localPort: 7778, read, ...LE }), null); // non-loopback local end
  assert.equal(peerUid({ remotePort: 54325, localPort: 7778, read, ...LE }), null); // malformed row
});

test('peerUid: one file missing is tolerated, both missing is null', () => {
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: reader({ [PROC_NET_TCP]: TCP }), ...LE }), 0);
  assert.equal(peerUid({ remotePort: 54337, localPort: 7778, read: reader({ [PROC_NET_TCP6]: TCP6 }), ...LE }), 0);
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: reader({}), ...LE }), null);
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: () => { throw new Error('EACCES'); } }), null);
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: () => 42 }), null);
  // Buffers are accepted.
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: (p) => (p === PROC_NET_TCP ? Buffer.from(TCP) : ''), ...LE }), 0);
});

test('peerUid: ambiguous uids return null', () => {
  const dup = '   0: 0100007F:D431 0100007F:1E62 01 0:0 0:0 0     0 0 1 1 0\n'
    + '   1: 0100007F:D431 0100007F:1E62 01 0:0 0:0 0  1000 0 2 1 0\n';
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: reader({ [PROC_NET_TCP]: dup }), ...LE }), null);
  const same = dup.replace(' 1000 ', '    0 ');
  assert.equal(peerUid({ remotePort: 54321, localPort: 7778, read: reader({ [PROC_NET_TCP]: same }), ...LE }), 0);
});

test('peerUid: bad ports return null without reading', () => {
  for (const [remotePort, localPort] of [[undefined, 7778], [54321, undefined], [0, 7778], [65536, 7778], [1.5, 7778], ['54321', 7778], [-1, 7778]]) {
    const read = both();
    assert.equal(peerUid({ remotePort, localPort, read }), null);
    assert.equal(read.calls.length, 0);
  }
  assert.equal(peerUid(), null);
});

test('socketPeerUid / peerUidMatches: fail closed', () => {
  assert.equal(socketPeerUid({ remotePort: 54321, localPort: 7778 }, { lookup: (a) => (a.remotePort === 54321 && a.localPort === 7778 ? 0 : 5) }), 0);
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
    assert.equal(peerUid({ remotePort: sock.remotePort, localPort: sock.localPort }), process.getuid());
    sock.destroy();
  } finally {
    client.destroy();
    await new Promise((r) => server.close(r));
  }
});
