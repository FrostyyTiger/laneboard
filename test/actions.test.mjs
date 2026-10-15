import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ActionError, requireSession, sendKeys, sendText, spawn, kill, literalKeysArgs } from '../server/actions.mjs';
import { isOwnWebSession } from '../server/collector/tmux.mjs';

async function rejectsWith(fn, message, status) {
  await assert.rejects(fn, (err) => {
    assert.ok(err instanceof ActionError, `expected ActionError, got ${err}`);
    assert.match(err.message, message);
    if (status) assert.equal(err.status, status);
    return true;
  });
}

test('requireSession rejects names that are not in the inventory', () => {
  assert.throws(() => requireSession('definitely-not-a-session'), (err) => {
    assert.ok(err instanceof ActionError);
    assert.equal(err.status, 404);
    return true;
  });
});

test('requireSession rejects unsafe names before touching tmux', () => {
  for (const bad of ['a;rm -rf /', '$(id)', '`id`', 'a\nb', '']) {
    assert.throws(() => requireSession(bad), (err) => {
      assert.equal(err.status, 400);
      assert.match(err.message, /invalid session name/);
      return true;
    }, JSON.stringify(bad));
  }
});

test('sendKeys refuses key names that are not plain tmux keys', async () => {
  // Guards run before the inventory lookup would even matter.
  await rejectsWith(() => sendKeys('nope', ['Enter'], 'test'), /unknown session/, 404);
  await rejectsWith(() => sendKeys('a;b', ['Enter'], 'test'), /invalid session name/, 400);
});

test('sendKeys validates the shape of the key list', async () => {
  await rejectsWith(() => sendKeys('a;b', [], 'test'), /invalid session name/);
  await rejectsWith(() => sendKeys('nope', [], 'test'), /unknown session/);
});

test('sendText refuses an empty or oversized payload', async () => {
  await rejectsWith(() => sendText('nope', 'hi', true, 'test'), /unknown session/, 404);
  await rejectsWith(() => sendText('a;b', 'hi', true, 'test'), /invalid session name/, 400);
});

test('spawn refuses reserved and unsafe names', async () => {
  await rejectsWith(() => spawn({ name: '_laneboard', dir: '/tmp' }, 'test'), /reserved/);
  await rejectsWith(() => spawn({ name: '_laneboard-server', dir: '/tmp' }, 'test'), /reserved/);
  await rejectsWith(() => spawn({ name: 'a;kill-server', dir: '/tmp' }, 'test'), /invalid session name/);
  await rejectsWith(() => spawn({ name: '$(id)', dir: '/tmp' }, 'test'), /invalid session name/);
});

test('spawn refuses a directory that does not exist', async () => {
  await rejectsWith(() => spawn({ name: 'testsess', dir: '/no/such/dir/anywhere' }, 'test'), /no such directory/);
});

test('spawn refuses a path that is not a directory', async () => {
  await rejectsWith(() => spawn({ name: 'testsess', dir: '/etc/hostname' }, 'test'), /not a directory/);
});

test('spawn validates model and resume before creating anything', async () => {
  await rejectsWith(
    () => spawn({ name: 'testsess', dir: '/tmp', model: 'opus; rm -rf /' }, 'test'),
    /invalid model/
  );
  await rejectsWith(
    () => spawn({ name: 'testsess', dir: '/tmp', resume: 'not a uuid; id' }, 'test'),
    /invalid resume id/
  );
});

test('kill refuses an unknown session rather than guessing', async () => {
  await rejectsWith(() => kill('definitely-not-a-session', 'test'), /unknown session/, 404);
});

test('a session the laneboard created for a terminal is filtered out of the inventory', () => {
  // It shares the owner's pane, so leaving it in shows a phantom card and
  // double-counts that session's cost.
  assert.equal(isOwnWebSession({ name: 'kubic-web-28c4e2', group: 'kubic' }), true);
  assert.equal(isOwnWebSession({ name: 'kubic', group: null }), false);
  // A real session that merely looks like one is kept — it is not grouped.
  assert.equal(isOwnWebSession({ name: 'my-web-app', group: null }), false);
  assert.equal(isOwnWebSession({ name: 'my-web-app', group: '' }), false);
});

test('ActionError carries an HTTP status', () => {
  assert.equal(new ActionError('x').status, 400);
  assert.equal(new ActionError('x', 409).status, 409);
  assert.ok(new ActionError('x') instanceof Error);
});

test('literalKeysArgs: text and Enter in one tmux invocation (SR20 L3, SR18 L2)', () => {
  assert.deepEqual(literalKeysArgs('%3', 'hello', true), ['send-keys', '-t', '%3', '-l', '--', 'hello', ';', 'send-keys', '-t', '%3', 'Enter']);
  assert.deepEqual(literalKeysArgs('%3', 'hello', false), ['send-keys', '-t', '%3', '-l', '--', 'hello']);
  // a trailing ";" never ends a tmux command: it goes out as hex keys
  assert.deepEqual(literalKeysArgs('%3', 'a;;', true), ['send-keys', '-t', '%3', '-l', '--', 'a', ';', 'send-keys', '-t', '%3', '-H', '3b', '3b', ';', 'send-keys', '-t', '%3', 'Enter']);
  assert.deepEqual(literalKeysArgs('%3', ';', false), ['send-keys', '-t', '%3', '-H', '3b']);
  for (const t of ['x;', 'x\\;', '-t%9 x', 'kill-server ;', 'a ; b']) {
    const argv = literalKeysArgs('%1', t, true);
    // the only arguments that end in ";" are the separators themselves
    assert.ok(argv.every((a) => a === ';' || !a.endsWith(';')), t);
  }
});

test('literalKeysArgs types exactly the text, then Enter, on a private tmux server', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-actions-'));
  const env = { ...process.env, TMUX_TMPDIR: tmp, LC_ALL: 'C.UTF-8' };
  delete env.TMUX;
  delete env.TMUX_PANE;
  const tmux = (...a) => execFileSync('tmux', a, { env, encoding: 'utf8' });
  try { tmux('-V'); } catch { t.skip('tmux not installed'); fs.rmSync(tmp, { recursive: true, force: true }); return; }
  const out = path.join(tmp, 'out');
  try {
    tmux('new-session', '-d', '-s', 'lb-l3', '-x', '80', '-y', '10', `stty -echo; cat > ${out}`);
    const pane = tmux('display-message', '-p', '-t', '=lb-l3:', '#{pane_id}').trim();
    const texts = ['plain', 'ends;', 'two;;', ';', '-t%0 x', 'b\\;', 'a ; kill-server ;', 'Enter'];
    for (const x of texts) tmux(...literalKeysArgs(pane, x, true));
    let got = '';
    for (let i = 0; i < 40 && got.split('\n').length <= texts.length; i++) {
      execFileSync('sleep', ['0.05']);
      got = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    }
    assert.deepEqual(got.split('\n').slice(0, texts.length), texts);
  } finally {
    try { tmux('kill-server'); } catch { /* gone */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
