// deploy/install-claude.sh (fleet plan §8 2.8, task C10). Every run uses a temp
// HOME, a temp state dir and LANEBOARD_CONFIG=/dev/null: the real ~/.claude is
// never touched. Skipped cleanly when jq is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(REPO, 'deploy', 'install-claude.sh');
const TMPL = path.join(REPO, 'deploy', 'hooks.json.tmpl');
const HAVE_JQ = spawnSync('jq', ['--version'], { stdio: 'ignore' }).status === 0;
const skip = HAVE_JQ ? false : 'jq is not installed';

// SR21 M2: the ownership marker is the explicit field, never a URL or path substring.
const isOurs = (h) => h?._laneboard === 'managed';

const FOREIGN_PRE = { matcher: 'Bash', hooks: [{ type: 'command', command: '~/bin/my-guard.sh', timeout: 7 }] };
const FOREIGN_STOP = { hooks: [{ type: 'command', command: 'notify-send done' }] };
const FOREIGN_CUSTOM = { matcher: 'x', hooks: [{ type: 'command', command: 'echo custom' }] };
const FIXTURE = {
  model: 'opus',
  permissions: { allow: ['Bash(ls:*)'] },
  hooks: { PreToolUse: [FOREIGN_PRE], Stop: [FOREIGN_STOP], MyEvent: [FOREIGN_CUSTOM] },
  statusLine: { type: 'command', command: '~/my-status.sh' },
};
const fmt = (o) => `${JSON.stringify(o, null, 2)}\n`; // jq's output format

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-installer-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const env = { ...process.env };
  delete env.TMUX; delete env.TMUX_PANE;
  Object.assign(env, {
    HOME: home,
    LANEBOARD_CONFIG: '/dev/null',
    LANEBOARD_DB: ':memory:',
    LANEBOARD_STATE_DIR: path.join(root, 'state'),
    LANEBOARD_AUDIT_FILE: path.join(root, 'audit.jsonl'),
    XDG_STATE_HOME: path.join(root, 'xdg-state'),
    XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    TMUX_TMPDIR: root,
  });
  const claude = path.join(home, '.claude');
  const settings = path.join(claude, 'settings.json');
  const run = (...args) => {
    const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8', cwd: root });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const ok = (...args) => {
    const r = run(...args);
    assert.equal(r.code, 0, `install-claude ${args.join(' ')} failed:\n${r.out}\n${r.err}`);
    return r;
  };
  const read = () => fs.readFileSync(settings, 'utf8');
  const backups = () => { try { return fs.readdirSync(path.join(claude, 'backups')).filter((f) => f.startsWith('settings.json.')); } catch { return []; } };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, home, claude, settings, state: env.LANEBOARD_STATE_DIR, run, ok, read, backups, cleanup };
}

function foreignOf(s) {
  const out = [];
  for (const [ev, groups] of Object.entries(s.hooks ?? {})) {
    for (const g of groups) if (!g.hooks.some(isOurs)) out.push(JSON.stringify([ev, g]));
  }
  return out;
}

test('template: 15 events, every entry carries the marker, sync gate and PermissionRequest hooks', () => {
  const t = JSON.parse(fs.readFileSync(TMPL, 'utf8'));
  assert.equal(Object.keys(t).length, 15);
  for (const [ev, groups] of Object.entries(t)) {
    for (const g of groups) for (const h of g.hooks) assert.ok(isOurs(h), `${ev}: ${h.command}`);
  }
  for (const ev of ['PreToolUse', 'UserPromptSubmit']) {
    const gate = t[ev].flatMap((g) => g.hooks).filter((h) => h.command.includes('.claude/laneboard/gate.sh'));
    assert.equal(gate.length, 1, ev);
    assert.equal(gate[0].timeout, 5);
    assert.equal(gate[0].async, undefined, `${ev} gate must be synchronous`);
  }
  const perm = t.PermissionRequest.flatMap((g) => g.hooks).filter((h) => h.command.includes('/api/hook/permission'));
  assert.equal(perm.length, 1);
  assert.equal(perm[0].async, undefined);
  assert.equal(perm[0].onFailure, undefined);
  assert.equal(perm[0].timeout, '@HOLD_TIMEOUT@');
  assert.match(perm[0].command, /^curl -sf --connect-timeout 1 -m @HOLD@ -H @@HEADER_FILE@ .*127\.0\.0\.1:@PORT@\/api\/hook\/permission \|\| true$/);
  assert.equal(fs.existsSync(path.join(REPO, 'deploy', 'hooks.json')), false, 'deploy/hooks.json is replaced by the template');
});

test('install keeps foreign hooks byte-identical, re-install is a no-op, uninstall restores', { skip }, () => {
  const sb = sandbox();
  try {
    const original = fmt(FIXTURE);
    fs.writeFileSync(sb.settings, original);

    sb.ok();
    const first = sb.read();
    const s = JSON.parse(first);
    // foreign hooks and everything else untouched, in place
    assert.deepEqual(foreignOf(s), foreignOf(FIXTURE));
    assert.equal(JSON.stringify(s.hooks.PreToolUse[0]), JSON.stringify(FOREIGN_PRE));
    assert.equal(JSON.stringify(s.hooks.Stop[0]), JSON.stringify(FOREIGN_STOP));
    assert.equal(JSON.stringify(s.hooks.MyEvent), JSON.stringify([FOREIGN_CUSTOM]));
    assert.deepEqual(s.statusLine, FIXTURE.statusLine);
    assert.deepEqual(s.permissions, FIXTURE.permissions);
    assert.equal(s.model, 'opus');
    // our entries: 15 events, each template entry exactly once, rendered
    const ourEvents = Object.keys(s.hooks).filter((ev) => s.hooks[ev].some((g) => g.hooks.some(isOurs)));
    assert.equal(ourEvents.length, 15);
    const tmpl = JSON.parse(fs.readFileSync(TMPL, 'utf8'));
    for (const [ev, groups] of Object.entries(tmpl)) {
      assert.equal(s.hooks[ev].filter((g) => g.hooks.some(isOurs)).length, groups.length, ev);
    }
    assert.doesNotMatch(first, /@[A-Z_]+@/);
    assert.match(first, /127\.0\.0\.1:7777\/api\/hook /);
    const perm = s.hooks.PermissionRequest.flatMap((g) => g.hooks).find((h) => h.command.includes('/api/hook/permission'));
    assert.equal(perm.timeout, 620); // holdSec 600 + 5 for curl -m, + 15 for the hook
    assert.ok(perm.command.includes(`-m 605 -H @'${path.join(sb.state, 'hook.header')}'`), perm.command);
    const gate = s.hooks.PreToolUse.flatMap((g) => g.hooks).find((h) => h.command.includes('gate.sh'));
    assert.equal(gate.command, `LANEBOARD_STATE_DIR='${sb.state}' "$HOME/.claude/laneboard/gate.sh"`);
    // side effects: backup of the original, gate copied 0755, token 0600
    assert.equal(sb.backups().length, 1);
    assert.equal(fs.readFileSync(path.join(sb.claude, 'backups', sb.backups()[0]), 'utf8'), original);
    const gateFile = path.join(sb.claude, 'laneboard', 'gate.sh');
    assert.equal(fs.readFileSync(gateFile, 'utf8'), fs.readFileSync(path.join(REPO, 'deploy', 'hooks', 'gate.sh'), 'utf8'));
    assert.equal(fs.statSync(gateFile).mode & 0o777, 0o755);
    const hdr = path.join(sb.state, 'hook.header');
    assert.equal(fs.statSync(hdr).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(hdr, 'utf8'), /^X-Laneboard-Hook: [0-9a-f]{64}\n$/);

    // re-install: byte-identical settings, one more backup
    sb.ok();
    assert.equal(sb.read(), first);
    assert.equal(sb.backups().length, 2);

    // uninstall: back to the original bytes, our dir gone, empty events dropped
    const u = sb.ok('--uninstall');
    assert.equal(sb.read(), original);
    assert.match(u.out, /PreToolUse: 0 laneboard, 1 other/);
    assert.equal(fs.existsSync(path.join(sb.claude, 'laneboard')), false);
    assert.equal(sb.backups().length, 3);

    // uninstall again: still the original
    sb.ok('--uninstall');
    assert.equal(sb.read(), original);
  } finally {
    sb.cleanup();
  }
});

test('the old installer\'s entries are replaced, not duplicated; mixed groups keep their foreign hooks', { skip }, () => {
  const sb = sandbox();
  try {
    const legacy = "curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:7777/api/hook >/dev/null 2>&1 || true";
    const mixed = { matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }, { type: 'command', command: legacy, async: true, timeout: 3 }] };
    const fixture = {
      hooks: {
        PreToolUse: [FOREIGN_PRE, { matcher: '*', hooks: [{ type: 'command', command: legacy, async: true, timeout: 3 }] }],
        PostToolUse: [mixed],
        SessionEnd: [{ hooks: [{ type: 'command', command: legacy, async: true, timeout: 3 }] }],
      },
    };
    fs.writeFileSync(sb.settings, fmt(fixture));
    sb.ok();
    const s = JSON.parse(sb.read());
    const tmpl = JSON.parse(fs.readFileSync(TMPL, 'utf8'));
    for (const [ev, groups] of Object.entries(tmpl)) {
      const n = s.hooks[ev].flatMap((g) => g.hooks).filter(isOurs).length;
      assert.equal(n, groups.reduce((a, g) => a + g.hooks.length, 0), ev);
    }
    assert.equal(JSON.stringify(s.hooks.PreToolUse[0]), JSON.stringify(FOREIGN_PRE));
    assert.equal(JSON.stringify(s.hooks.PostToolUse[0]), JSON.stringify({ matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }] }));

    sb.ok('--uninstall');
    const u = JSON.parse(sb.read());
    assert.deepEqual(Object.keys(u.hooks), ['PreToolUse', 'PostToolUse']); // SessionEnd ended up empty
    assert.equal(JSON.stringify(u.hooks.PreToolUse), JSON.stringify([FOREIGN_PRE]));
    assert.equal(JSON.stringify(u.hooks.PostToolUse), JSON.stringify([{ matcher: '*', hooks: [{ type: 'command', command: 'echo mine' }] }]));
    assert.equal(u.statusLine.command, '~/.claude/statusline-command.sh', 'statusLine kept without --statusline');
  } finally {
    sb.cleanup();
  }
});

test('SR21 M2: user hooks that look like laneboard\'s survive install, re-install and uninstall byte-identically', { skip }, () => {
  const sb = sandbox();
  try {
    const legacy = "curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:7777/api/hook >/dev/null 2>&1 || true";
    const mine = [
      { type: 'command', command: "curl -s -m 2 -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:9999/api/hook >/dev/null 2>&1 || true", async: true, timeout: 3 },
      { type: 'command', command: 'curl -s http://127.0.0.1:3000/api/hooks/audit' },
      { type: 'command', command: 'curl -s http://127.0.0.1:7777/api/hook' }, // laneboard's port, not the template command
      { type: 'command', command: `${legacy} ` }, // near-miss: trailing space
      { type: 'http', url: 'http://127.0.0.1:7777/api/hook' },
      { type: 'command', command: legacy, _laneboard: 'other' }, // a marker value that is not ours
    ];
    const pathy = { matcher: 'Edit', hooks: [{ type: 'command', command: 'cat ~/.claude/laneboard/notes.txt >> /tmp/x' }] };
    const gateLike = { hooks: [{ type: 'command', command: `LANEBOARD_STATE_DIR='/elsewhere' "$HOME/.claude/laneboard/gate.sh"`, timeout: 5 }] };
    const fixture = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [...mine, { type: 'command', command: 'echo mine' }] }, pathy],
        UserPromptSubmit: [gateLike],
        MyEvent: [{ hooks: [{ type: 'command', command: 'bash ~/.claude/laneboard/mine.sh' }] }],
      },
    };
    const original = fmt(fixture);
    fs.writeFileSync(sb.settings, original);
    const foreign = (s) => ({
      pre: s.hooks.PreToolUse.filter((g) => !g.hooks.some(isOurs)),
      ups: s.hooks.UserPromptSubmit.filter((g) => !g.hooks.some(isOurs)),
      my: s.hooks.MyEvent,
    });
    const want = { pre: fixture.hooks.PreToolUse, ups: fixture.hooks.UserPromptSubmit, my: fixture.hooks.MyEvent };

    const r = sb.ok();
    let s = JSON.parse(sb.read());
    assert.equal(JSON.stringify(foreign(s)), JSON.stringify(want));
    assert.match(r.out, /PreToolUse: 2 laneboard, 8 other/);
    const first = sb.read();
    sb.ok();
    assert.equal(sb.read(), first);
    s = JSON.parse(sb.read());
    assert.equal(JSON.stringify(foreign(s)), JSON.stringify(want));

    sb.ok('--uninstall');
    const u = JSON.parse(sb.read());
    delete u.statusLine; // the install added the default status line; uninstall keeps it without --statusline
    assert.equal(fmt(u), original);
    // uninstall straight from the user's file: nothing of theirs is removed
    fs.writeFileSync(sb.settings, original);
    sb.ok('--uninstall');
    assert.equal(sb.read(), original);
  } finally {
    sb.cleanup();
  }
});

test('SR21 M2: only exact pre-marker template commands are migrated; marked entries from another port are replaced', { skip }, () => {
  const sb = sandbox();
  try {
    const legacyGate = (sd) => `LANEBOARD_STATE_DIR='${sd}' "$HOME/.claude/laneboard/gate.sh"`;
    const oldPort = { _laneboard: 'managed', type: 'command', command: 'curl http://127.0.0.1:7000/api/hook || true', async: true, timeout: 3 };
    const fixture = {
      hooks: {
        PreToolUse: [
          { matcher: '*', hooks: [{ type: 'command', command: legacyGate(sb.state), timeout: 5 }] }, // previous installer
          { matcher: '*', hooks: [{ type: 'command', command: legacyGate('/other/state'), timeout: 5 }] }, // not ours to judge
          { matcher: '*', hooks: [oldPort] },
        ],
      },
    };
    fs.writeFileSync(sb.settings, fmt(fixture));
    sb.ok();
    const s = JSON.parse(sb.read());
    const pre = s.hooks.PreToolUse.flatMap((g) => g.hooks);
    assert.equal(pre.filter((h) => h.command === legacyGate(sb.state)).length, 1);
    assert.ok(isOurs(pre.find((h) => h.command === legacyGate(sb.state))), 'the migrated gate is the marked one');
    assert.equal(pre.filter((h) => h.command === legacyGate('/other/state')).length, 1);
    assert.equal(pre.some((h) => h.command === oldPort.command), false);
    sb.ok('--uninstall');
    const u = JSON.parse(sb.read());
    assert.equal(JSON.stringify(u.hooks), JSON.stringify({ PreToolUse: [fixture.hooks.PreToolUse[1]] }));
  } finally {
    sb.cleanup();
  }
});

test('--dry-run prints the diff and writes nothing', { skip }, () => {
  const sb = sandbox();
  try {
    const original = fmt(FIXTURE);
    fs.writeFileSync(sb.settings, original);
    const r = sb.ok('--dry-run');
    assert.match(r.out, /^\+.*\/api\/hook\/permission/m);
    assert.equal(sb.read(), original);
    assert.equal(sb.backups().length, 0);
    assert.equal(fs.existsSync(path.join(sb.claude, 'laneboard')), false);
    assert.equal(fs.existsSync(sb.state), false, 'no token created');
    assert.equal(fs.existsSync(path.join(sb.claude, 'statusline-command.sh')), false);

    sb.ok();
    const installed = sb.read();
    const u = sb.ok('--uninstall', '--dry-run');
    assert.match(u.out, /^-.*\/api\/hook\/permission/m);
    assert.equal(sb.read(), installed);
    assert.equal(fs.existsSync(path.join(sb.claude, 'laneboard')), true);
  } finally {
    sb.cleanup();
  }
});

test('fresh HOME: settings created with statusLine; --uninstall --statusline removes ours', { skip }, () => {
  const sb = sandbox();
  try {
    sb.ok();
    const s = JSON.parse(sb.read());
    assert.deepEqual(s.statusLine, { type: 'command', command: '~/.claude/statusline-command.sh' });
    assert.equal(Object.keys(s.hooks).length, 15);
    assert.equal(fs.existsSync(path.join(sb.claude, 'statusline-command.sh')), true);

    sb.ok('--uninstall');
    assert.deepEqual(JSON.parse(sb.read()), { statusLine: s.statusLine });
    sb.ok('--uninstall', '--statusline');
    assert.deepEqual(JSON.parse(sb.read()), {});
  } finally {
    sb.cleanup();
  }
});

test('refuses a malformed settings file and leaves it unchanged', { skip }, () => {
  const sb = sandbox();
  try {
    for (const bad of ['{"hooks": {"PreToolUse": {"oops": 1}}}\n', '[1, 2]\n', '{ not json\n']) {
      fs.writeFileSync(sb.settings, bad);
      const r = sb.run();
      assert.notEqual(r.code, 0, bad);
      assert.equal(sb.read(), bad);
      assert.equal(sb.backups().length, 0);
    }
    assert.notEqual(sb.run('--bogus').code, 0);
    assert.notEqual(sb.run('--statusline').code, 0);
  } finally {
    sb.cleanup();
  }
});
