// Run scripts (fleet R8): resolveScript, runScript/stopScript argv with a
// stubbed tmux, the forbidden-port refusal, the run-script dispatcher entry,
// tmux inventory mainPane, and the terminal `window` param. The end-to-end
// cases use a PRIVATE tmux server (TMUX_TMPDIR in a temp dir, TMUX unset),
// never the default socket.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-scripts-'));
process.env.TMUX_TMPDIR = path.join(tmp, 'tmux');
fs.mkdirSync(process.env.TMUX_TMPDIR, { mode: 0o700 });
delete process.env.TMUX;
delete process.env.TMUX_PANE;

const tmuxEnv = { ...process.env, LC_ALL: 'C.UTF-8' };
const tmux = (...args) => execFileSync('tmux', args, { env: tmuxEnv, encoding: 'utf8' });
let hasTmux = true;
try { execFileSync('tmux', ['-V'], { env: tmuxEnv }); } catch { hasTmux = false; }

after(() => {
  try { execFileSync('tmux', ['kill-server'], { env: tmuxEnv, stdio: 'ignore' }); } catch { /* no server */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const scripts = await import('../server/review/scripts.mjs');
const routes = await import('../server/routes/scripts.mjs');
const tmuxMod = await import('../server/collector/tmux.mjs');
const terminals = await import('../server/terminals.mjs');
const dispatchMod = await import('../server/fleet/dispatch.mjs');
const { finalize } = await import('../server/config/review.mjs');
const { WINDOW_RE: AUTH_WINDOW_RE } = await import('../server/fleet/auth.mjs');

const codeDir = path.join(tmp, 'code');
const root = path.join(codeDir, 'acme-lane-a');
fs.mkdirSync(root, { recursive: true });

const repos = finalize({ repos: [
  { name: 'acme', scripts: { test: 'npm test', dev: 'npm run dev -- --port 3000 # local' } },
  { name: 'other', scripts: { lint: 'eslint .' } },
] }).repos;

const laneRec = (over = {}) => ({ id: 'lane-a', repo: 'acme', root, branch: 'feat/a', slot: 2, session: 'lane-a', ...over });

/** What tmux prints for one row of a -F format: each #{name} replaced, literal text kept. */
function fillFormat(fmt, vals) {
  return fmt.replace(/#\{([a-z_]+)\}/g, (m, k) => String(vals[k] ?? ''));
}

/** A tmux stub: records every argv, answers list-windows from `windows`. */
function stubRun({ windows = [{ id: '@1', index: 0, dead: false, name: 'claude' }], newIndex = 3, fail = new Set() } = {}) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const verb = args[0];
    if (fail.has(verb)) return { ok: false, stdout: '', stderr: 'boom' };
    if (verb === 'list-windows') {
      return { ok: true, stdout: windows.map((w) => fillFormat(args[args.indexOf('-F') + 1], { window_id: w.id, window_index: w.index, pane_dead: w.dead ? '1' : '0', window_name: w.name })).join('\n') + '\n' };
    }
    if (verb === 'new-window') return { ok: true, stdout: `${newIndex}\n` };
    return { ok: true, stdout: '' };
  };
  fn.calls = calls;
  return fn;
}

const stubSlots = {
  envCommand: (n, quote) => `eval "$(${quote('/opt/agent-stack')} env ${Number(n)})"; `,
  ports: (n) => ({ pg: 15432 + (n - 1) * 100 }),
};

function deps(over = {}) {
  const probes = [];
  return {
    run: stubRun(),
    readLane: (id) => (id === 'lane-a' ? laneRec() : null),
    repos,
    slots: stubSlots,
    codeDir,
    nodeBin: '/usr/bin',
    forbiddenPorts: () => [5432],
    probeEnv: async (prefix, cwd) => {
      probes.push({ prefix, cwd });
      return { DATABASE_ADMIN_URL: 'postgresql://a@localhost:15532/x', DATABASE_URL: 'postgresql://a@localhost:15532/x' };
    },
    probes,
    ...over,
  };
}

const refused = async (p, status, code) => {
  await assert.rejects(p, (err) => {
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });
};

// ---------------------------------------------------------------------------------------------------------
// resolveScript

test('resolveScript returns the configured command and refuses unknown names', () => {
  assert.deepEqual(scripts.resolveScript(laneRec(), 'test', repos), { cmd: 'npm test', root, repo: 'acme' });
  for (const name of ['lint', 'nope', 'build']) {
    assert.throws(() => scripts.resolveScript(laneRec(), name, repos), (e) => e.status === 400 && e.code === 'unknown_script', name);
  }
  for (const name of ['', 'Test', 'a;b', '../x', 'x'.repeat(25), '__proto__', 'run-test x', 7, null]) {
    assert.throws(() => scripts.resolveScript(laneRec(), name, repos), (e) => e.status === 400, String(name));
  }
});

test('resolveScript finds nothing on the prototype of the frozen scripts object', () => {
  assert.equal(Object.getPrototypeOf(repos[0].scripts), null);
  assert.ok(Object.isFrozen(repos[0].scripts));
  for (const name of ['constructor', 'tostring', 'hasownproperty', 'valueof']) {
    assert.throws(() => scripts.resolveScript(laneRec(), name, repos), (e) => e.code === 'unknown_script', name);
  }
  // Even a plain (non-finalized) object: hasOwn, not `in`.
  const plain = [{ name: 'acme', scripts: { test: 'npm test' } }];
  assert.throws(() => scripts.resolveScript(laneRec(), 'constructor', plain), (e) => e.code === 'unknown_script');
});

test('resolveScript uses only config: commands or scripts in the lane record are ignored', () => {
  const rec = laneRec({ scripts: { evil: 'rm -rf /' }, cmd: 'rm -rf /' });
  assert.throws(() => scripts.resolveScript(rec, 'evil', repos), (e) => e.code === 'unknown_script');
  assert.equal(scripts.resolveScript(rec, 'test', repos).cmd, 'npm test');
  // A repo the lane is not in does not lend its scripts.
  assert.throws(() => scripts.resolveScript(laneRec({ repo: 'nope' }), 'test', repos), (e) => e.code === 'unknown_script');
  assert.throws(() => scripts.resolveScript(laneRec(), 'test', []), (e) => e.code === 'unknown_script');
});

test('resolveScript refuses retired lanes and unusable roots', () => {
  assert.throws(() => scripts.resolveScript(laneRec({ retiredAt: 1 }), 'test', repos), (e) => e.status === 409);
  for (const bad of [null, 'relative/dir', `${root}/../x`, '']) {
    assert.throws(() => scripts.resolveScript(laneRec({ root: bad }), 'test', repos), (e) => e.status === 409, String(bad));
  }
});

test('scriptNames: names only, sorted, never the commands', () => {
  const out = scripts.scriptNames(repos);
  assert.deepEqual(out, { acme: ['dev', 'test'], other: ['lint'] });
  assert.ok(!JSON.stringify(out).includes('npm'));
  assert.deepEqual(scripts.scriptNames(undefined), {});
});

// ---------------------------------------------------------------------------------------------------------
// runScript / stopScript with a stubbed tmux

test('runScript: the exact tmux argv (-d, -c root, remain-on-exit, exact targets)', async () => {
  const d = deps();
  const r = await scripts.runScript('lane-a', 'test', 'alice', d);
  assert.deepEqual(r, { ok: true, window: 'run-test', windowIndex: 3, alreadyRunning: false });
  const calls = d.run.calls;
  assert.deepEqual(calls[0].slice(0, 4), ['list-windows', '-t', `${tmuxMod.exactTarget('lane-a')}:`, '-F']);
  assert.match(calls[0][4], /^#\{window_id\}<lb:[0-9a-f]{16}:f>#\{window_index\}<lb:[0-9a-f]{16}:f>#\{pane_dead\}<lb:[0-9a-f]{16}:f>#\{window_name\}<lb:[0-9a-f]{16}:r>$/);
  assert.equal(calls[0].length, 5);
  const nw = calls.find((a) => a[0] === 'new-window');
  const script = nw[nw.indexOf('sh') + 2];
  assert.deepEqual(nw, [
    'new-window', '-d', '-P', '-F', '#{window_index}', '-t', '=lane-a:', '-n', 'run-test', '-c', root,
    '--', 'sh', '-c', script,
    ';', 'set-option', '-w', '-t', '=lane-a:=run-test', 'remain-on-exit', 'on',
  ]);
  assert.equal(script, [
    "PATH='/usr/bin':\"$PATH\"; export PATH",
    `eval "$('/opt/agent-stack' env 2)"; `,
    '(',
    'npm test',
    ')',
    's=$?',
    'echo',
    'echo "[test exited $s]"',
  ].join('\n'));
  assert.equal(calls.length, 2, 'list-windows, new-window: nothing else');
  // The probe evaluated the same slot prefix in the worktree.
  assert.equal(d.probes.length, 1);
  assert.equal(d.probes[0].cwd, root);
  assert.ok(d.probes[0].prefix.includes(`eval "$('/opt/agent-stack' env 2)"`));
});

test('runScript: a command with a comment cannot swallow the exit line', async () => {
  const d = deps();
  await scripts.runScript('lane-a', 'dev', 'alice', d);
  const nw = d.run.calls.find((a) => a[0] === 'new-window');
  const script = nw[nw.indexOf('sh') + 2];
  assert.ok(script.split('\n').includes('npm run dev -- --port 3000 # local'));
  assert.ok(script.split('\n').includes('echo "[dev exited $s]"'));
});

test('runScript: an unknown script is a 400 and nothing is spawned or probed', async () => {
  const d = deps();
  await refused(scripts.runScript('lane-a', 'lint', 'alice', d), 400, 'unknown_script');
  await refused(scripts.runScript('lane-a', 'x;rm', 'alice', d), 400);
  assert.equal(d.run.calls.length, 0);
  assert.equal(d.probes.length, 0);
});

test('runScript: a forbidden port refuses the run before any window opens', async () => {
  const d = deps({ probeEnv: async () => ({ DATABASE_ADMIN_URL: 'postgresql://a@localhost:15532/x', DATABASE_URL: 'postgresql://a@localhost:5432/prod' }) });
  await refused(scripts.runScript('lane-a', 'test', 'alice', d), 409, 'forbidden_env');
  assert.ok(!d.run.calls.some((a) => a[0] === 'new-window'));

  const wrongSlot = deps({ probeEnv: async () => ({ DATABASE_ADMIN_URL: 'postgresql://a@localhost:15432/x' }) });
  await refused(scripts.runScript('lane-a', 'test', 'alice', wrongSlot), 409, 'forbidden_env');
  const noEnv = deps({ probeEnv: async () => null });
  await refused(scripts.runScript('lane-a', 'test', 'alice', noEnv), 409, 'forbidden_env');
  for (const x of [wrongSlot, noEnv]) assert.ok(!x.run.calls.some((a) => a[0] === 'new-window'));

  // No slot: only the forbidden ports count.
  const noSlot = deps({ readLane: () => laneRec({ slot: null }), probeEnv: async () => ({ DATABASE_URL: 'postgres://x@h:5432/y' }) });
  await refused(scripts.runScript('lane-a', 'test', 'alice', noSlot), 409, 'forbidden_env');
  const fine = deps({ readLane: () => laneRec({ slot: null }), probeEnv: async () => ({}) });
  assert.equal((await scripts.runScript('lane-a', 'test', 'alice', fine)).ok, true);
});

test('runScript: a live window is alreadyRunning, a dead one is replaced by id', async () => {
  const live = deps({ run: stubRun({ windows: [{ id: '@1', index: 0, dead: false, name: 'claude' }, { id: '@4', index: 2, dead: false, name: 'run-test' }] }) });
  assert.deepEqual(await scripts.runScript('lane-a', 'test', 'alice', live), { ok: true, window: 'run-test', windowIndex: 2, alreadyRunning: true });
  assert.equal(live.run.calls.length, 1);

  const dead = deps({ run: stubRun({ windows: [{ id: '@1', index: 0, dead: false, name: 'claude' }, { id: '@4', index: 2, dead: true, name: 'run-test' }] }) });
  const r = await scripts.runScript('lane-a', 'test', 'alice', dead);
  assert.equal(r.alreadyRunning, false);
  assert.deepEqual(dead.run.calls.map((a) => a[0]), ['list-windows', 'kill-window', 'new-window']);
  assert.deepEqual(dead.run.calls[1], ['kill-window', '-t', '@4']);
});

test('runScript: unknown, retired, sessionless and out-of-tree lanes are refused', async () => {
  await refused(scripts.runScript('nope', 'test', 'a', deps()), 404, 'unknown_lane');
  await refused(scripts.runScript('Bad Id', 'test', 'a', deps()), 400);
  await refused(scripts.runScript('lane-a', 'test', 'a', deps({ readLane: () => laneRec({ retiredAt: 5 }) })), 409);
  await refused(scripts.runScript('lane-a', 'test', 'a', deps({ run: stubRun({ fail: new Set(['list-windows']) }) })), 409, 'no_session');
  const outside = fs.mkdtempSync(path.join(tmp, 'outside-'));
  await refused(scripts.runScript('lane-a', 'test', 'a', deps({ readLane: () => laneRec({ root: outside }) })), 409, 'no_worktree');
  await refused(scripts.runScript('lane-a', 'test', 'a', deps({ readLane: () => laneRec({ root: path.join(codeDir, 'missing') }) })), 409, 'no_worktree');
  await refused(scripts.runScript('lane-a', 'test', 'a', deps({ readLane: () => laneRec({ session: 'x;y:z' }) })), 409);
});

test('stopScript refuses non-run-* windows and kills only the exact run-<name> window by id', async () => {
  const windows = [
    { id: '@1', index: 0, dead: false, name: 'claude' },
    { id: '@4', index: 2, dead: false, name: 'run-test' },
    { id: '@5', index: 3, dead: false, name: 'run-tests' },
    { id: '@6', index: 4, dead: false, name: 'test' },
  ];
  for (const name of ['', 'claude', 'Test', 'run-;x', 'a b', '0']) {
    if (name === 'claude') continue;
    const d = deps({ run: stubRun({ windows }) });
    await refused(scripts.stopScript('lane-a', name, 'a', d), 400);
    assert.equal(d.run.calls.length, 0, name);
  }
  // A window named exactly like a non-run window is never a target.
  const d0 = deps({ run: stubRun({ windows }) });
  const r0 = await scripts.stopScript('lane-a', 'claude', 'a', d0);
  assert.equal(r0.stopped, false);
  assert.ok(!d0.run.calls.some((a) => a[0] === 'kill-window'));

  const d = deps({ run: stubRun({ windows }) });
  assert.deepEqual(await scripts.stopScript('lane-a', 'test', 'a', d), { ok: true, window: 'run-test', stopped: true });
  assert.deepEqual(d.run.calls.filter((a) => a[0] === 'kill-window'), [['kill-window', '-t', '@4']]);
});

// ---------------------------------------------------------------------------------------------------------
// The dispatcher entry

function ctxFor(over) {
  const entries = [];
  return {
    entries,
    ctx: {
      auth: { kind: 'local' },
      deps: { scripts: over, slots: { bogus: true }, run: () => { throw new Error('dispatch deps must not reach the runner'); } },
      config: {},
      audit: { append: (e) => { entries.push(e); return { hash: `h${entries.length}` }; } },
    },
  };
}
const envelope = (args, target = 'lane-a') => ({ v: 1, id: crypto.randomUUID(), ts: Date.now(), builder: 'builder-a', action: 'run-script', target, args, user: 'alice', via: 'direct' });

test('run-script is registered at tier ask on target lane, and audited', async () => {
  dispatchMod._reset();
  routes.default.register({ config: { repos } });
  routes.default.register({ config: { repos } }); // idempotent
  assert.equal(dispatchMod.tiers()['run-script'], 'ask');
  const d = deps();
  const { ctx, entries } = ctxFor(d);
  const out = await dispatchMod.dispatch(envelope({ script: 'test' }), ctx);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.result.window, 'run-test');
  assert.deepEqual(entries.map((e) => e.result.phase), ['start', 'done']);
  assert.equal(entries[0].action, 'run-script');
  assert.equal(entries[0].target, 'lane-a');
});

test('run-script: a name not in repos[].scripts is 400 and nothing is spawned', async () => {
  dispatchMod._reset();
  routes.registerRunScript();
  for (const args of [{ script: 'lint' }, { script: 'nope' }, { script: 'a;b' }, { script: '__proto__' }, { script: 'test', cmd: 'id' }, {}, { script: 'test', stop: 'yes' }]) {
    const d = deps();
    const { ctx, entries } = ctxFor(d);
    const out = await dispatchMod.dispatch(envelope(args), ctx);
    assert.equal(out.ok, false, JSON.stringify(args));
    assert.equal(out.status, 400, JSON.stringify(args));
    assert.equal(d.run.calls.length, 0, JSON.stringify(args));
    assert.ok(entries.length >= 1, 'a refusal is audited too');
  }
  const { ctx } = ctxFor(deps());
  assert.equal((await dispatchMod.dispatch(envelope({ script: 'test' }, '*'), ctx)).status, 400);
  assert.equal((await dispatchMod.dispatch(envelope({ script: 'test' }, '../x'), ctx)).status, 400);
});

test('run-script with stop:true stops the window', async () => {
  dispatchMod._reset();
  routes.registerRunScript();
  const d = deps({ run: stubRun({ windows: [{ id: '@1', index: 0, dead: false, name: 'claude' }, { id: '@9', index: 1, dead: true, name: 'run-test' }] }) });
  const { ctx } = ctxFor(d);
  const out = await dispatchMod.dispatch(envelope({ script: 'test', stop: true }), ctx);
  assert.equal(out.ok, true);
  assert.deepEqual(out.result, { ok: true, window: 'run-test', stopped: true });
  assert.deepEqual(d.run.calls.at(-1), ['kill-window', '-t', '@9']);
  dispatchMod._reset();
});

// ---------------------------------------------------------------------------------------------------------
// tmux inventory mainPane

test('one window rule: RUN_WINDOW_RE agrees with the auth term check', () => {
  assert.equal(String(tmuxMod.RUN_WINDOW_RE), String(AUTH_WINDOW_RE));
  assert.equal(tmuxMod.isRunWindow('run-test'), true);
  assert.equal(tmuxMod.isRunWindow('run-'), false);
  assert.equal(tmuxMod.isRunWindow('run-;x'), false);
  assert.equal(tmuxMod.isRunWindow('claude'), false);
});

test('pickMainPane: the active pane of the lowest non-run-* window', () => {
  const p = (windowIndex, paneIndex, active, windowName) => ({ windowIndex, paneIndex, active, windowName, paneId: `%${windowIndex}${paneIndex}` });
  assert.equal(tmuxMod.pickMainPane([]), null);
  assert.equal(tmuxMod.pickMainPane(undefined), null);
  // run-* listed first (lower index) and active: ignored.
  assert.equal(tmuxMod.pickMainPane([p(0, 0, true, 'run-dev'), p(1, 0, false, 'claude'), p(1, 1, true, 'claude')]).paneId, '%11');
  // Every window has an active pane; the lowest work window wins.
  assert.equal(tmuxMod.pickMainPane([p(2, 0, true, 'bash'), p(1, 0, true, 'claude'), p(3, 0, true, 'run-test')]).paneId, '%10');
  // Only run-* windows: fall back to the old rule.
  assert.equal(tmuxMod.pickMainPane([p(0, 0, false, 'run-a'), p(1, 0, true, 'run-b')]).paneId, '%10');
  // A window name that merely contains "run-" is a work window.
  assert.equal(tmuxMod.pickMainPane([p(0, 0, true, 'my-run-x'), p(1, 0, true, 'claude')]).paneId, '%00');
});

test('inventory mainPane ignores a run-* window (private tmux server)', { skip: !hasTmux && 'tmux not installed' }, async () => {
  tmux('new-session', '-d', '-s', 'inv-a', '-n', 'run-dev', '-x', '80', '-y', '24', 'sleep 300');
  tmux('new-window', '-d', '-t', '=inv-a:', '-n', 'claude', 'sleep 300');
  const inv = await tmuxMod.inventory();
  const s = inv.get('inv-a');
  assert.ok(s, 'session listed');
  assert.equal(s.panes.length, 2);
  assert.deepEqual(s.panes.map((x) => x.windowName).sort(), ['claude', 'run-dev']);
  assert.equal(s.mainPane.windowName, 'claude');
  assert.equal(s.mainPane.windowIndex, 1);
  tmux('kill-session', '-t', '=inv-a');
});

/**
 * The pane's text once it shows `needle`, once the pane is dead (its last
 * output read), or what it shows at the deadline. The budget is generous:
 * under the full parallel suite a loaded host can take longer than the old
 * 5 s poll for a script window to print its exit line.
 */
async function waitPane(target, needle, ms = 20000) {
  const end = Date.now() + ms;
  let out = '';
  for (;;) {
    const dead = tmux('display-message', '-p', '-t', target, '#{pane_dead}').trim() === '1';
    out = tmux('capture-pane', '-p', '-S', '-100', '-t', target);
    if (out.includes(needle) || dead || Date.now() > end) return out;
    await new Promise((res) => setTimeout(res, 100));
  }
}

/**
 * The pane's text for script `name`, run again (at most twice) when its window
 * died without `needle`. A shell that writes and exits within microseconds can
 * hang up its pty before tmux has read the last lines (seen twice under the
 * full suite: `pwd` shown, the rest never), which is the host, not runScript.
 * A run that never prints `needle` still fails every try.
 */
async function paneAfterRun(name, needle, out, d) {
  const target = `=lane-a:=run-${name}`;
  for (let i = 0; i < 2 && !out.includes(needle); i++) {
    const r = await scripts.runScript('lane-a', name, 'alice', d);
    assert.equal(r.alreadyRunning, false, out);
    out = await waitPane(target, needle);
  }
  return out;
}

test('runScript end to end on a private tmux server: window, remain-on-exit, agent window stays current', { skip: !hasTmux && 'tmux not installed' }, async () => {
  tmux('new-session', '-d', '-s', 'lane-a', '-n', 'claude', '-x', '80', '-y', '24', 'sleep 300');
  const d = {
    readLane: () => laneRec({ slot: null }),
    repos: finalize({ repos: [{ name: 'acme', scripts: { test: 'pwd; echo out-$((40+2))', fail: 'exit 3' } }] }).repos,
    slots: { envCommand: () => '' },
    codeDir,
    nodeBin: null,
    forbiddenPorts: () => [5432],
  };
  const r = await scripts.runScript('lane-a', 'test', 'alice', d);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyRunning, false);
  assert.equal(r.window, 'run-test');
  assert.equal(r.windowIndex, 1);
  assert.equal(tmux('display-message', '-p', '-t', '=lane-a:', '#{window_name}').trim(), 'claude', 'the agent window stays current');
  let out = await paneAfterRun('test', '[test exited 0]', await waitPane('=lane-a:=run-test', '[test exited 0]'), d);
  assert.ok(out.includes(root), out);
  assert.ok(out.includes('out-42'), out);
  assert.ok(out.includes('[test exited 0]'), out);
  assert.equal(tmux('show-options', '-w', '-v', '-t', '=lane-a:=run-test', 'remain-on-exit').trim(), 'on');

  // The window is dead now: a second run replaces it.
  const again = await scripts.runScript('lane-a', 'test', 'alice', d);
  assert.equal(again.alreadyRunning, false);
  const names = tmux('list-windows', '-t', '=lane-a:', '-F', '#{window_name}').trim().split('\n');
  assert.deepEqual(names, ['claude', 'run-test']);

  await scripts.runScript('lane-a', 'fail', 'alice', d);
  out = await paneAfterRun('fail', '[fail exited 3]', await waitPane('=lane-a:=run-fail', '[fail exited 3]'), d);
  assert.ok(out.includes('[fail exited 3]'), out);

  const inv = await tmuxMod.inventory();
  assert.equal(inv.get('lane-a').mainPane.windowName, 'claude');

  assert.equal((await scripts.stopScript('lane-a', 'test', 'alice', d)).stopped, true);
  assert.equal((await scripts.stopScript('lane-a', 'test', 'alice', d)).stopped, false);
  assert.deepEqual(tmux('list-windows', '-t', '=lane-a:', '-F', '#{window_name}').trim().split('\n'), ['claude', 'run-fail']);
  tmux('kill-session', '-t', '=lane-a');
});

// ---------------------------------------------------------------------------------------------------------
// The terminal window param

function fakeSocket() {
  const s = { written: '', destroyed: false };
  s.write = (x) => { s.written += String(x); return true; };
  s.destroy = () => { s.destroyed = true; };
  return s;
}

test('windowParam: absent, valid, invalid', () => {
  const u = (q) => new URL(`http://x/ws/term/a${q}`);
  assert.equal(terminals.windowParam(u('')), undefined);
  assert.equal(terminals.windowParam(u('?cols=80')), undefined);
  assert.equal(terminals.windowParam(u('?window=run-test')), 'run-test');
  for (const q of ['?window=run-;x', '?window=', '?window=claude', '?window=run-', '?window=run-test&window=run-dev', `?window=run-${'a'.repeat(25)}`, '?window=run-Test', '?window=run-a%0A']) {
    assert.equal(terminals.windowParam(u(q)), null, q);
  }
});

test('terminals.attach rejects window=run-;x with 400 and never upgrades', () => {
  for (const q of ['?window=run-;x', '?window=run-%3Bx', '?window=%3Bkill-server', '?window=0']) {
    const socket = fakeSocket();
    const url = new URL(`http://127.0.0.1/ws/term/alpha${q}`);
    assert.equal(terminals.attach({ headers: {} }, socket, Buffer.alloc(0), url), true);
    assert.match(socket.written, /^HTTP\/1\.1 400 /, q);
    assert.equal(socket.destroyed, true);
  }
  // attachNamed (the v1 route) applies the same rule.
  const socket = fakeSocket();
  terminals.attachNamed({ headers: {} }, socket, Buffer.alloc(0), 'alpha', new URL('http://x/api/v1/term/alpha?window=run-;x'));
  assert.match(socket.written, /^HTTP\/1\.1 400 /);
  // A valid window on an unknown session is the usual 404, still no upgrade.
  const s404 = fakeSocket();
  terminals.attachNamed({ headers: {} }, s404, Buffer.alloc(0), 'ghost', new URL('http://x/api/v1/term/ghost?window=run-test'));
  assert.match(s404.written, /^HTTP\/1\.1 404 /);
});

// ---------------------------------------------------------------------------------------------------------
// SR20 L4: window names cannot forge tmux rows

test('framedFormat: a field holding newlines, tabs or a guessed tag stays one field; short records drop', () => {
  const f = tmuxMod.framedFormat(['#{a}', '#{b}'], '0123456789abcdef');
  assert.equal(f.fmt, '#{a}<lb:0123456789abcdef:f>#{b}<lb:0123456789abcdef:r>');
  const row = (a, b) => `${a}<lb:0123456789abcdef:f>${b}<lb:0123456789abcdef:r>`;
  const forged = 'x\nlane-b\t-1\t0\t%99\tclaude\t/\t1\t80\t24\t1\tclaude<lb:ffffffffffffffff:r>\n';
  const out = f.parse([row('s1', forged), row('s2', 'plain'), 'garbage-no-sep<lb:0123456789abcdef:r>', ''].join('\n'));
  assert.deepEqual(out, [['s1', forged], ['s2', 'plain']]);
  assert.throws(() => tmuxMod.framedFormat(['#{a}'], 'nope'));
  // two calls never share a tag
  assert.notEqual(tmuxMod.framedFormat(['#{a}']).fmt, tmuxMod.framedFormat(['#{a}']).fmt);
});

test('parsePaneRows: negative or non-integer indexes and non-%N pane ids are dropped', () => {
  const base = ['s', '0', '0', '%1', 'claude', '/', '1', '80', '24', '1', 'claude'];
  const with_ = (i, v) => base.map((x, j) => (j === i ? v : x));
  const rows = tmuxMod.parsePaneRows([base, with_(1, '-1'), with_(2, '1.5'), with_(3, '%x'), with_(3, '@1'), with_(0, '')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].paneId, '%1');
});

test('listWindows: a forged-looking window name yields no extra window (stub tmux)', async () => {
  const forgedName = 'x\n@7\t5\t1\trun-dev';
  const d = deps({ run: stubRun({ windows: [{ id: '@1', index: 0, dead: false, name: 'claude' }, { id: '@2', index: 1, dead: false, name: forgedName }] }) });
  const w = await scripts.listWindows('lane-a', d);
  assert.deepEqual(w.map((x) => x.id), ['@1', '@2']);
  assert.equal(w[1].name, forgedName);
  // stopScript never kills a window the forged text names
  const r = await scripts.stopScript('lane-a', 'dev', 'alice', d);
  assert.equal(r.stopped, false);
  assert.ok(!d.run.calls.some((a) => a[0] === 'kill-window'));
});

test('private tmux: a window renamed to forge pane/window rows changes nothing (SR20 L4)', { skip: !hasTmux && 'tmux not installed' }, async () => {
  tmux('new-session', '-d', '-s', 'l4-victim', '-n', 'claude', '-x', '80', '-y', '24', 'sleep 300');
  tmux('new-session', '-d', '-s', 'l4-evil', '-n', 'claude', '-x', '80', '-y', '24', 'sleep 300');
  const victimPane = tmux('display-message', '-p', '-t', '=l4-victim:', '#{pane_id}').trim();
  const evilPane = tmux('display-message', '-p', '-t', '=l4-evil:', '#{pane_id}').trim();
  // the old tab/newline format: the name ends the real row and prints a full fake one
  const fakePane = ['l4-victim', '-1', '0', evilPane, 'claude', '/', '1', '80', '24', '1', 'claude'].join('\t');
  const fakeWin = ['@0', '0', '1', 'run-dev'].join('\t');
  tmux('new-window', '-d', '-t', '=l4-evil:', '-n', `x\n${fakePane}\n${fakeWin}\ty`, 'sleep 300');
  try {
    const raw = tmux('list-panes', '-a', '-F', '#{session_name}\t#{window_index}\t#{window_name}');
    assert.ok(raw.includes(`\n${fakePane}`), 'this tmux prints the newline unescaped (the attack precondition)');

    const panes = await tmuxMod.listPanes();
    assert.equal(panes.filter((p) => p.session === 'l4-victim').length, 1);
    assert.ok(panes.every((p) => p.windowIndex >= 0));
    const inv = await tmuxMod.inventory();
    assert.equal(inv.get('l4-victim').mainPane.paneId, victimPane);
    assert.equal(inv.get('l4-evil').mainPane.paneId, evilPane);
    assert.equal(inv.get('l4-evil').panes.length, 2);

    const wins = await scripts.listWindows('l4-evil', { run: tmuxMod.runTmux });
    assert.equal(wins.length, 2);
    assert.ok(wins.every((w) => w.id !== '@0' || w.name === 'claude'));
    assert.ok(!wins.some((w) => w.name === 'run-dev'));
  } finally {
    tmux('kill-session', '-t', '=l4-victim');
    tmux('kill-session', '-t', '=l4-evil');
  }
});
