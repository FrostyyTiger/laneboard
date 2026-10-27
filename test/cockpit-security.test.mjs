// The cockpit's security scenarios that run under node:test (spec
// security.md §7). S-SEC-01: the room's start check (security.md §3, D209,
// D210) through an injected stat, as D111 injects uids, then real starts.
// S-SEC-01's `mcp.json` and `--mcp-config` steps come with the MCP server and
// the bridge (T35, after T9: PROGRESS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

import { boot, freePort } from './helpers/boot.mjs';
import {
  agentWalk, ancestors, canEnter, fileProblems, lookupAgent, modeLine, secretPaths,
} from '../server/cockpit/start-check.mjs';

const ROOM = 1000;
const AGENT_UID = 1001;
const TMP = '/tmp/lb-sec';
const STATE = `${TMP}/state`;
const AUDIT = `${STATE}/audit.jsonl`;
const AGENT = { command: ['node', 'test/cockpit/stand-ins/fake-agent.mjs'], allowSameUser: true, loginCheck: null };

/** An injected fs over a table {path: {uid, gid, mode, dir, link}}; the rest is ENOENT. */
function fakeFs(table) {
  const enoent = (p) => Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
  const statOf = (p, follow) => {
    let e = table[p];
    if (!e) throw enoent(p);
    if (follow && e.link) e = table[e.link] ?? (() => { throw enoent(e.link); })();
    return {
      uid: e.uid ?? ROOM,
      gid: e.gid ?? ROOM,
      mode: (e.dir ? 0o040000 : e.link && !follow ? 0o120000 : 0o100000) | (e.link && !follow ? 0o777 : e.mode),
      isDirectory: () => Boolean(e.dir) && !(e.link && !follow),
      isSymbolicLink: () => Boolean(e.link) && !follow,
    };
  };
  return {
    statSync: (p) => statOf(p, true),
    lstatSync: (p) => statOf(p, false),
    readdirSync: (p) => {
      if (!table[p]?.dir) throw enoent(p);
      const pre = `${p}/`;
      return Object.keys(table).filter((k) => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length));
    },
  };
}

/** Every path of security.md §3's list, right. */
function rightTable() {
  return {
    [`${TMP}/stt.token`]: { mode: 0o600 },
    [`${TMP}/infra.key`]: { mode: 0o600 },
    [`${STATE}/cockpit`]: { mode: 0o700, dir: true },
    [`${STATE}/cockpit/mcp.token`]: { mode: 0o600 },
    [`${STATE}/cockpit/session.json`]: { mode: 0o600 },
    [`${STATE}/cockpit/turns`]: { mode: 0o700, dir: true },
    [`${STATE}/cockpit/turns/t1.json`]: { mode: 0o600 },
    [AUDIT]: { mode: 0o600 },
    [STATE]: { mode: 0o700, dir: true },
  };
}

const CONFIG = {
  stateDir: STATE,
  cockpit: {
    agent: { user: 'lb-agent' },
    stt: { tokenFile: `${TMP}/stt.token` },
    infra: { key: `${TMP}/infra.key` },
  },
};

const problemsOf = (table) => fileProblems(secretPaths({ config: CONFIG, auditFile: AUDIT }), { uid: ROOM, fs: fakeFs(table) });

// Each listed path wrong once: owner 1001, mode 0640 (a file) or 0750 (a directory).
const ONE_WRONG = [
  ['cockpit.stt.tokenFile', `${TMP}/stt.token`, false, 'cockpit.stt.tokenFile: '],
  ['cockpit.infra.key', `${TMP}/infra.key`, false, 'cockpit.infra.key: '],
  ['{stateDir}/cockpit/', `${STATE}/cockpit`, true, ''],
  ['a file in {stateDir}/cockpit/', `${STATE}/cockpit/mcp.token`, false, ''],
  ['a directory in {stateDir}/cockpit/', `${STATE}/cockpit/turns`, true, ''],
  ['a file two deep in {stateDir}/cockpit/', `${STATE}/cockpit/turns/t1.json`, false, ''],
  ['the audit file', AUDIT, false, ''],
  ['the audit file\'s directory', STATE, true, ''],
];

test('S-SEC-01 The agent\'s user cannot read the room\'s secrets, and the room will not start if it could', async (t) => {
  await t.test('every path right: no line', () => {
    assert.deepEqual(problemsOf(rightTable()), []);
  });

  await t.test('the scenario\'s line: cockpit.stt.tokenFile at 0640', () => {
    const table = rightTable();
    table[`${TMP}/stt.token`].mode = 0o640;
    assert.deepEqual(problemsOf(table).map((p) => p.line), [
      `cockpit.stt.tokenFile: ${TMP}/stt.token can be read by others; make it 0600 and owned by the room's user`,
    ]);
  });

  for (const [name, p, dir, prefix] of ONE_WRONG) {
    await t.test(`${name}: owner 1001, then mode ${dir ? '0750' : '0640'}, then one other bit`, () => {
      const owned = rightTable();
      owned[p].uid = AGENT_UID;
      assert.deepEqual(problemsOf(owned).map((x) => x.line), [`${prefix}${p} is owned by uid 1001, not you`]);

      const wide = rightTable();
      wide[p].mode = dir ? 0o750 : 0o640;
      assert.deepEqual(problemsOf(wide).map((x) => x.line), [
        `${prefix}${p} can be read by others; make it ${dir ? '0700' : '0600'} and owned by the room's user`,
      ]);

      // D210: any group or other bit, not only read.
      const exec = rightTable();
      exec[p].mode = (dir ? 0o700 : 0o600) | 0o001;
      assert.equal(problemsOf(exec).length, 1);
    });
  }

  await t.test('several wrong: one line each, in security.md §3\'s order; the room prints the first', () => {
    const table = rightTable();
    table[AUDIT].mode = 0o644;
    table[`${STATE}/cockpit/mcp.token`].mode = 0o644;
    table[`${TMP}/stt.token`].uid = AGENT_UID;
    table[`${TMP}/infra.key`].mode = 0o604;
    assert.deepEqual(problemsOf(table).map((x) => x.line), [
      `cockpit.stt.tokenFile: ${TMP}/stt.token is owned by uid 1001, not you`,
      `cockpit.infra.key: ${TMP}/infra.key can be read by others; make it 0600 and owned by the room's user`,
      `${STATE}/cockpit/mcp.token can be read by others; make it 0600 and owned by the room's user`,
      `${AUDIT} can be read by others; make it 0600 and owned by the room's user`,
    ]);
  });

  await t.test('a path that is not there is no problem; unset keys are not listed', () => {
    const table = rightTable();
    delete table[`${TMP}/stt.token`];
    delete table[AUDIT];
    assert.deepEqual(problemsOf(table), []);
    const bare = secretPaths({ config: { stateDir: STATE, cockpit: { stt: { tokenFile: null } } }, auditFile: AUDIT });
    assert.deepEqual(bare.map((e) => e.path), [`${STATE}/cockpit`, AUDIT, STATE]);
  });

  await t.test('a link in {stateDir}/cockpit/ is judged by what it points at, never entered', () => {
    const table = rightTable();
    table[`${STATE}/cockpit/x`] = { link: `${TMP}/elsewhere` };
    table[`${TMP}/elsewhere`] = { mode: 0o644 };
    assert.deepEqual(problemsOf(table).map((x) => x.line), [
      `${STATE}/cockpit/x can be read by others; make it 0600 and owned by the room's user`,
    ]);
    table[`${TMP}/elsewhere`] = { mode: 0o755, dir: true };
    table[`${TMP}/elsewhere/open`] = { mode: 0o644 };
    assert.deepEqual(problemsOf(table).map((x) => x.line), [
      `${STATE}/cockpit/x can be read by others; make it 0700 and owned by the room's user`,
    ]);
  });

  await t.test('a path the room cannot stat is not known closed: a line', () => {
    const fsx = fakeFs(rightTable());
    const inner = fsx.statSync;
    fsx.statSync = (p) => {
      if (p === `${TMP}/stt.token`) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return inner(p);
    };
    const got = fileProblems(secretPaths({ config: CONFIG, auditFile: AUDIT }), { uid: ROOM, fs: fsx });
    assert.deepEqual(got.map((x) => x.line), [`cockpit.stt.tokenFile: ${TMP}/stt.token cannot be checked (EACCES)`]);
  });

  await t.test('real start: the token file at 0640 stops the room alone in 2 s, nothing listening', { timeout: 20_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-sec01-'));
    try {
      const token = path.join(dir, 'stt.token');
      fs.writeFileSync(token, 'secret\n', { mode: 0o640 });
      fs.chmodSync(token, 0o640);
      const port = await freePort();
      const config = { cockpit: { agent: AGENT, stt: { tokenFile: token } } };
      const t0 = Date.now();
      const err = await boot({ mode: 'cockpit', config, env: { LANEBOARD_PORT: String(port) }, timeoutMs: 5000 })
        .then(async (b) => { await b.stop(); return null; }, (e) => e);
      const ms = Date.now() - t0;
      assert.ok(err, 'the room started');
      assert.match(err.message, /laneboard exited \(1\) before \/healthz answered/);
      const line = `cockpit.stt.tokenFile: ${token} can be read by others; make it 0600 and owned by the room's user`;
      assert.ok(err.message.split('\n').includes(line), err.message);
      assert.ok(ms < 2000, `exited after ${ms} ms`);
      assert.equal(await canConnect(port), false);

      // When the mode is 0600 and the room starts again: D209's modes.
      fs.chmodSync(token, 0o600);
      const room = await boot({ mode: 'cockpit', config });
      try {
        const mode = (p) => fs.statSync(p).mode & 0o777;
        assert.equal(mode(path.join(room.stateDir, 'cockpit')), 0o700);
        for (const f of filesUnder(path.join(room.stateDir, 'cockpit'))) assert.equal(mode(f), 0o600, f);
        assert.equal(mode(path.join(room.stateDir, 'cockpit-agent')), 0o755);
        assert.equal(fs.statSync(path.join(room.stateDir, 'cockpit-agent')).uid, process.getuid());
      } finally {
        await room.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('real start: a wide file in {stateDir}/cockpit/ stops the one box before its board listens', { timeout: 20_000 }, async () => {
    const port = await freePort();
    const box = await boot({ config: { cockpit: { agent: AGENT } }, env: { LANEBOARD_PORT: String(port) } });
    const file = path.join(box.stateDir, 'cockpit', 'cards.json');
    fs.writeFileSync(file, '{}', { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    const err = await box.restart().then(() => null, (e) => e);
    try {
      assert.ok(err, 'the box started');
      assert.ok(err.message.split('\n').includes(`${file} can be read by others; make it 0600 and owned by the room's user`), err.message);
      assert.equal(await canConnect(port), false);
    } finally {
      await box.stop();
    }
  });
});

function canConnect(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

function filesUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p)); else out.push(p);
  }
  return out;
}

// --- single-machine.md §3.3: the agent's way to cockpit-agent/ and its cwd ---------

test('the agent\'s way to its files: one line per directory it cannot enter, not fatal (single-machine.md §3.3)', async (t) => {
  const agent = { name: 'lb-agent', uid: AGENT_UID, gids: [AGENT_UID] };
  const table = {
    '/': { mode: 0o755, dir: true, uid: 0, gid: 0 },
    '/home': { mode: 0o755, dir: true, uid: 0, gid: 0 },
    '/home/user': { mode: 0o750, dir: true },
    '/home/user/.local': { mode: 0o755, dir: true },
    '/home/user/.local/state': { mode: 0o700, dir: true },
    '/home/user/.local/state/laneboard': { mode: 0o711, dir: true },
    '/home/user/.local/state/laneboard/cockpit-agent': { mode: 0o755, dir: true },
    '/srv': { mode: 0o755, dir: true, uid: 0, gid: 0 },
    '/srv/infra': { mode: 0o750, dir: true, gid: AGENT_UID },
  };
  const targets = ['/home/user/.local/state/laneboard/cockpit-agent', '/srv/infra'];

  await t.test('the spec\'s line, once per directory, in walk order', () => {
    assert.deepEqual(agentWalk(targets, { agent, fs: fakeFs(table), readAcl: () => null }), [
      'cockpit: lb-agent cannot enter /home/user (mode 0750); its tools will not start. Run: setfacl -m u:lb-agent:x /home/user',
      'cockpit: lb-agent cannot enter /home/user/.local/state (mode 0700); its tools will not start. Run: setfacl -m u:lb-agent:x /home/user/.local/state',
    ]);
  });

  await t.test('the printed fix silences the line (a named-user ACL entry under the mask)', () => {
    const acl = (dir) => (dir === '/home/user'
      ? [{ tag: 'user', id: null, perms: 'rwx' }, { tag: 'user', id: AGENT_UID, perms: '--x' }, { tag: 'group', id: null, perms: 'r-x' }, { tag: 'mask', id: null, perms: 'r-x' }, { tag: 'other', id: null, perms: '---' }]
      : null);
    const got = agentWalk(targets, { agent, fs: fakeFs(table), readAcl: acl });
    assert.equal(got.length, 1);
    assert.match(got[0], /\/home\/user\/\.local\/state /);
    // A mask without x still keeps it out.
    const masked = (dir) => (dir === '/home/user' ? [{ tag: 'user', id: AGENT_UID, perms: '--x' }, { tag: 'mask', id: null, perms: 'r--' }] : null);
    assert.equal(agentWalk(targets, { agent, fs: fakeFs(table), readAcl: masked }).length, 2);
  });

  await t.test('owner, group and other bits as the kernel applies them', () => {
    const st = (uid, gid, mode) => ({ uid, gid, mode });
    assert.equal(canEnter(st(AGENT_UID, 1, 0o100), agent, null), true);
    assert.equal(canEnter(st(AGENT_UID, 1, 0o011), agent, null), false, 'the owner bits decide for the owner');
    assert.equal(canEnter(st(ROOM, AGENT_UID, 0o010), agent, null), true);
    assert.equal(canEnter(st(ROOM, AGENT_UID, 0o701), agent, null), false, 'the group bits decide for a member');
    assert.equal(canEnter(st(ROOM, ROOM, 0o711), agent, null), true);
    assert.equal(canEnter(st(ROOM, ROOM, 0o770), agent, null), false);
  });

  await t.test('a directory not there yet is skipped; ancestors run from /', () => {
    assert.deepEqual(ancestors('/a/b/'), ['/', '/a', '/a/b']);
    assert.deepEqual(agentWalk(['/nowhere/x'], { agent, fs: fakeFs(table), readAcl: () => null }), []);
  });

  await t.test('lookupAgent: this machine\'s own user, and none for a name that is not there', () => {
    const me = os.userInfo().username;
    const got = lookupAgent(me);
    if (got) {
      assert.equal(got.uid, process.getuid());
      assert.ok(got.gids.includes(process.getgid()));
    }
    assert.equal(lookupAgent('lb-no-such-user-x'), null);
  });

  await t.test('modeLine is security.md §3\'s example', () => {
    assert.equal(modeLine({ key: 'cockpit.stt.tokenFile', path: '/etc/laneboard/stt.token', dir: false }),
      'cockpit.stt.tokenFile: /etc/laneboard/stt.token can be read by others; make it 0600 and owned by the room\'s user');
  });
});
