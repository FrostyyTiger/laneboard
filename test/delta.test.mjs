import test from 'node:test';
import assert from 'node:assert/strict';

import { diffSessions, forWire } from '../server/ws.mjs';

const s = (name, extra = {}) => ({ name, state: 'done', stateSince: 1, preview: ['raw', 'ansi'], ...extra });

test('forWire strips the raw ANSI preview but keeps the rendered one', () => {
  const w = forWire(s('a', { previewHtml: ['<span>x</span>'] }));
  assert.equal(w.preview, undefined);
  assert.deepEqual(w.previewHtml, ['<span>x</span>']);
  assert.equal(w.name, 'a');
});

test('the first diff reports every session as changed', () => {
  const { changed, removed } = diffSessions(new Map(), [s('a'), s('b')]);
  assert.deepEqual(changed.map((c) => c.name), ['a', 'b']);
  assert.deepEqual(removed, []);
});

test('an unchanged session is not resent', () => {
  const first = diffSessions(new Map(), [s('a'), s('b')]);
  const second = diffSessions(first.next, [s('a'), s('b')]);
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.removed, []);
});

test('only the session that actually changed is resent', () => {
  const first = diffSessions(new Map(), [s('a'), s('b')]);
  const second = diffSessions(first.next, [s('a'), s('b', { state: 'working' })]);
  assert.deepEqual(second.changed.map((c) => c.name), ['b']);
  assert.equal(second.changed[0].state, 'working');
});

test('a change only in the raw preview does not cause a resend', () => {
  // preview is stripped before diffing, so scrollback churn is not traffic.
  const first = diffSessions(new Map(), [s('a')]);
  const second = diffSessions(first.next, [s('a', { preview: ['totally', 'different'] })]);
  assert.deepEqual(second.changed, []);
});

test('a change in the rendered preview does cause a resend', () => {
  const first = diffSessions(new Map(), [s('a', { previewHtml: ['one'] })]);
  const second = diffSessions(first.next, [s('a', { previewHtml: ['two'] })]);
  assert.deepEqual(second.changed.map((c) => c.name), ['a']);
});

test('a vanished session is reported as removed exactly once', () => {
  const first = diffSessions(new Map(), [s('a'), s('b')]);
  const second = diffSessions(first.next, [s('a')]);
  assert.deepEqual(second.removed, ['b']);
  const third = diffSessions(second.next, [s('a')]);
  assert.deepEqual(third.removed, []);
});

test('a session appearing and disappearing in one step is handled', () => {
  const first = diffSessions(new Map(), [s('a')]);
  const second = diffSessions(first.next, [s('c')]);
  assert.deepEqual(second.changed.map((c) => c.name), ['c']);
  assert.deepEqual(second.removed, ['a']);
});

test('names with spaces and parentheses survive the round trip', () => {
  const name = 'Big research for Treuhand stuff (large)';
  const { changed } = diffSessions(new Map(), [s(name)]);
  assert.equal(changed[0].name, name);
});
