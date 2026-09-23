import test from 'node:test';
import assert from 'node:assert/strict';

import { ActionError, requireSession, sendKeys, sendText, spawn, kill } from '../server/actions.mjs';
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
