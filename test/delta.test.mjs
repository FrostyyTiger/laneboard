import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffSessions, forWire, visibleNames, helloMessage, stamp, currentSeq, send, eventForWire,
} from '../server/ws.mjs';
import { fkey } from '../server/fleet/keys.mjs';
import { config } from '../server/config.mjs';

const s = (name, extra = {}) => ({ name, state: 'done', stateSince: 1, preview: ['raw', 'ansi'], ...extra });

test('forWire strips the raw preview and any HTML preview, keeps previewLines', () => {
  const w = forWire(s('a', { previewHtml: ['<span>x</span>'], previewLines: ['\x1b[31mred\x1b[0m'] }));
  assert.equal(w.preview, undefined);
  assert.equal('previewHtml' in w, false);
  assert.deepEqual(w.previewLines, ['\x1b[31mred\x1b[0m']);
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

test('a change in previewLines does cause a resend', () => {
  const first = diffSessions(new Map(), [s('a', { previewLines: ['one'] })]);
  const second = diffSessions(first.next, [s('a', { previewLines: ['two'] })]);
  assert.deepEqual(second.changed.map((c) => c.name), ['a']);
});

test('a change only in a stray previewHtml does not cause a resend', () => {
  const first = diffSessions(new Map(), [s('a', { previewHtml: ['one'] })]);
  const second = diffSessions(first.next, [s('a', { previewHtml: ['two'] })]);
  assert.deepEqual(second.changed, []);
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

// --- fleet keys (F7) --------------------------------------------------------

test('diffSessions with a keyOf keys the baseline and removals by fkey', () => {
  const keyOf = (x) => fkey('b', x.name);
  const first = diffSessions(new Map(), [s('a'), s('c')], keyOf);
  assert.deepEqual([...first.next.keys()], ['b/a', 'b/c']);
  assert.deepEqual(first.changed.map((c) => c.name), ['a', 'c']);
  const second = diffSessions(first.next, [s('a', { state: 'working' })], keyOf);
  assert.deepEqual(second.changed.map((c) => c.name), ['a']);
  assert.deepEqual(second.removed, ['b/c']);
});

test('two builders with the same session name do not collide under an fkey keyOf', () => {
  const keyOf = (x) => fkey(x.builder, x.name);
  const { changed, next } = diffSessions(new Map(), [s('web', { builder: 'b1' }), s('web', { builder: 'b2' })], keyOf);
  assert.equal(changed.length, 2);
  assert.deepEqual([...next.keys()], ['b1/web', 'b2/web']);
});

test('visible: fkeys of this builder map to local names, foreign keys are dropped', () => {
  const v = visibleNames({ type: 'visible', keys: ['builder-a/web', 'builder-b/web', 'builder-a/x/y', 'nope', 7] }, 'builder-a');
  assert.deepEqual([...v], ['web', 'x/y']);
});

test('visible: the legacy `names` is still accepted, and junk is ignored', () => {
  assert.deepEqual([...visibleNames({ names: ['a', 'b', 3] }, 'builder-a')], ['a', 'b']);
  assert.equal(visibleNames({ type: 'visible' }, 'builder-a'), null);
  assert.equal(visibleNames({ keys: Array.from({ length: 100 }, (_, i) => `builder-a/s${i}`) }, 'builder-a').size, 64);
});

test('hello carries builder {id, code}, mode, version and apiVersion 1', () => {
  const h = helloMessage();
  assert.equal(h.type, 'hello');
  assert.deepEqual(h.builder, { id: config.fleet.id, code: config.fleet.code });
  assert.equal(h.mode, 'builder');
  assert.equal(typeof h.version, 'string');
  assert.equal(h.apiVersion, 1);
});

test('every frame is stamped with builder and seq; send() advances seq', () => {
  const before = currentSeq();
  send({ type: 'delta' }); // no clients: nothing is written, the counter still moves
  send({ type: 'delta' });
  assert.equal(currentSeq(), before + 2);
  const m = stamp({ type: 'map', map: {} });
  assert.equal(m.builder, config.fleet.id);
  assert.equal(m.seq, before + 2);
  assert.equal(m.type, 'map');
});

test('an event on the wire carries the fkey of its session', () => {
  const e = eventForWire({ ts: 1, session_name: 'web', type: 'Stop' });
  assert.equal(e.key, fkey(config.fleet.id, 'web'));
  assert.equal(eventForWire({ ts: 1, session_name: null, type: 'x' }).key, null);
});
