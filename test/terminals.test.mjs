import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafeSessionName } from '../server/util.mjs';
import { exactTarget } from '../server/collector/tmux.mjs';
import { WEB_SUFFIX, clampDim } from '../server/terminals.mjs';

test('grouped session names are recognised by the sweeper', () => {
  assert.equal(WEB_SUFFIX.test('kubic-web-27xak0'), true);
  assert.equal(WEB_SUFFIX.test('Big research for Treuhand stuff (large)-web-1a'), true);
});

test('the sweeper does not match ordinary session names', () => {
  for (const name of [
    'kubic', 'kubic plan a', 'main', 'ADCS project', 'laneboard',
    'Big research for Treuhand stuff (large)', 'web', 'website',
  ]) {
    assert.equal(WEB_SUFFIX.test(name), false, name);
  }
});

test('the name suffix ALONE is not a safe sweep test', () => {
  // A user session called "my-web-app" matches the suffix, which is why
  // sweepStale() also requires a session group and no attached client.
  assert.equal(WEB_SUFFIX.test('my-web-app'), true);
  assert.equal(WEB_SUFFIX.test('foo-web-ui'), true);
});

test('clampDim keeps pty geometry sane', () => {
  assert.equal(clampDim(120, 20, 500, 80), 120);
  assert.equal(clampDim(5, 20, 500, 80), 20, 'floor');
  assert.equal(clampDim(9999, 20, 500, 80), 500, 'ceiling');
  assert.equal(clampDim(NaN, 20, 500, 80), 80, 'fallback');
  assert.equal(clampDim(undefined, 20, 500, 80), 80);
  assert.equal(clampDim('130', 20, 500, 80), 130);
});

test('session-name targets are exact, defeating tmux prefix matching', () => {
  // `kill-session -t _laneboard` also kills `_laneboard-test` without this.
  assert.equal(exactTarget('_laneboard'), '=_laneboard');
  assert.equal(exactTarget('kubic'), '=kubic');
  assert.equal(exactTarget('kubic plan a'), '=kubic plan a');
});

test('names that could inject shell or tmux syntax are rejected', () => {
  // node-pty runs tmux via execvp, not a shell, but the guard keeps a
  // hostile name from ever reaching a tmux target expression.
  for (const bad of ['a;kill-session -a', '$(whoami)', '`id`', 'a\nb', 'a:b', '../etc', '']) {
    assert.equal(isSafeSessionName(bad), false, JSON.stringify(bad));
  }
});

test('the real session names on this box are all accepted', () => {
  for (const good of [
    'kubic', 'kubic plan a', 'main', 'ADCS project',
    'Big research for Treuhand stuff (large)', 'Website wording change',
    '_laneboard-test', 'voice control', 'master',
  ]) {
    assert.equal(isSafeSessionName(good), true, good);
  }
});

test('a grouped session name stays a legal session name', () => {
  // So that killing it, and the sweeper, both work on the names we generate.
  const generated = 'Big research for Treuhand stuff (large)-web-27xak0';
  assert.equal(isSafeSessionName(generated), true);
  assert.equal(WEB_SUFFIX.test(generated), true);
});
