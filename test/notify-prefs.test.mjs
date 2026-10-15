// Notification prefs sheet (fleet plan §4 D14). Pure model exports of
// public/js/ui/notify-prefs.js (no document at import time); every body the
// sheet builds must pass the hub's own validation (O9 checkPrefs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  ALARM_KINDS, DEFAULT_KINDS, QUIET_BYPASS, KIND_LABELS, PREFS_PATH, MUTED_MAX, COMMAND,
  prefsModel, normQuiet, kindBody, quietBody, muteBody, sessionRows, pushModel, isHub,
  savePrefs, loadPrefs, unsubscribePush,
} from '../public/js/ui/notify-prefs.js';
import { ALARM_KINDS as SERVER_KINDS, NOTIFY_DEFAULT_KINDS } from '../server/config/observability.mjs';
import { checkPrefs, DEFAULT_BYPASS, effectivePrefs, wirePrefs } from '../server/hub/notify.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/js/ui/notify-prefs.js'), 'utf8');

test('kind lists match the server copies', () => {
  assert.deepEqual([...ALARM_KINDS], [...SERVER_KINDS]);
  assert.deepEqual([...DEFAULT_KINDS].sort(), [...NOTIFY_DEFAULT_KINDS].sort());
  assert.deepEqual([...QUIET_BYPASS].sort(), [...DEFAULT_BYPASS].sort());
  for (const k of ALARM_KINDS) assert.equal(typeof KIND_LABELS[k], 'string', k);
});

test('prefsModel: server defaults render as the default kinds, quiet off, nothing muted', () => {
  const wire = wirePrefs(effectivePrefs({}, null));
  const m = prefsModel(wire);
  assert.equal(m.kinds.length, ALARM_KINDS.length);
  for (const r of m.kinds) assert.equal(r.on, DEFAULT_KINDS.includes(r.kind), r.kind);
  assert.equal(m.kinds.find((r) => r.kind === 'danger').bypass, true);
  assert.equal(m.kinds.find((r) => r.kind === 'stuck').bypass, false);
  assert.equal(m.quiet.on, false);
  assert.deepEqual(m.muted, []);
});

test('prefsModel: stored values, kind subset, junk ignored', () => {
  const m = prefsModel({
    kinds: { stuck: false, reboot: true, bogus: true, review: 'yes' },
    quietHours: { from: '22:00', to: '06:30' },
    mutedTargets: ['builder-a/web', 'builder-a/web', 'not-a-key', 42, 'BAD/x'],
  }, ['stuck', 'reboot', 'review', 'bogus', '__proto__']);
  assert.deepEqual(m.kinds.map((r) => [r.kind, r.on]), [['stuck', false], ['reboot', true], ['review', true]]);
  assert.deepEqual(m.quiet, { on: true, from: '22:00', to: '06:30' });
  assert.deepEqual(m.muted, ['builder-a/web']);
  // inherited members never count as stored values
  const p = Object.create({ kinds: { stuck: false } });
  assert.equal(prefsModel(p).kinds.find((r) => r.kind === 'stuck').on, true);
  assert.equal(prefsModel(null).kinds.length, ALARM_KINDS.length);
  assert.equal(prefsModel({ quietHours: { from: '07:00', to: '07:00' } }).quiet.on, false);
});

test('normQuiet accepts only distinct HH:MM', () => {
  assert.deepEqual(normQuiet({ from: '23:00', to: '07:30' }), { from: '23:00', to: '07:30' });
  for (const q of [null, {}, { from: '24:00', to: '07:00' }, { from: '7:00', to: '08:00' }, { from: '10:00', to: '10:00' }, { from: '10:60', to: '11:00' }]) {
    assert.equal(normQuiet(q), null, JSON.stringify(q));
  }
});

test('every body the sheet builds passes O9 checkPrefs', () => {
  for (const k of ALARM_KINDS) {
    for (const on of [true, false]) {
      const b = kindBody(k, on);
      assert.ok(b.ok);
      const v = checkPrefs(b.body);
      assert.ok(v.ok, v.error);
      assert.deepEqual(v.patch, { kinds: { [k]: on } });
    }
  }
  assert.equal(kindBody('bogus', true).ok, false);
  assert.equal(kindBody('__proto__', true).ok, false);

  const q = quietBody(true, '23:00', '07:30');
  assert.ok(q.ok);
  assert.deepEqual(checkPrefs(q.body).patch, { quietHours: { from: '23:00', to: '07:30' } });
  const off = quietBody(false, 'garbage', '');
  assert.deepEqual(off.body, { quietHours: null });
  assert.ok(checkPrefs(off.body).ok);
  assert.equal(quietBody(true, '23:00', '23:00').ok, false);
  assert.equal(quietBody(true, '25:00', '07:00').ok, false);

  const mu = muteBody(['builder-a/web'], 'builder-a/api', true);
  assert.ok(mu.ok);
  assert.deepEqual(mu.body, { mutedTargets: ['builder-a/web', 'builder-a/api'] });
  assert.ok(checkPrefs(mu.body).ok);
  const un = muteBody(['builder-a/web', 'builder-a/api'], 'builder-a/web', false);
  assert.deepEqual(un.body, { mutedTargets: ['builder-a/api'] });
  assert.deepEqual(muteBody(['builder-a/web'], 'builder-a/web', true).body, { mutedTargets: ['builder-a/web'] });
  assert.equal(muteBody([], 'nope', true).ok, false);
  assert.equal(muteBody([], 'builder-a/' + 'x'.repeat(300), true).ok, false);
  // names with '/', '?' and '#' are fine fleet keys
  const odd = muteBody([], 'builder-a/a/b?c#d', true);
  assert.ok(odd.ok && checkPrefs(odd.body).ok);
  const full = Array.from({ length: MUTED_MAX }, (_, i) => `builder-a/s${i}`);
  assert.equal(muteBody(full, 'builder-a/one-more', true).ok, false);
  assert.ok(muteBody(full, 'builder-a/s1', false).ok);
});

test('sessionRows: live sessions plus muted ones that are gone, sorted, capped', () => {
  const rows = sessionRows(['builder-a/web', 'acme/b1', 'local-name', 'builder-a/web'], ['builder-a/old', 'builder-a/web']);
  assert.deepEqual(rows.map((r) => [r.fkey, r.muted, r.live]), [
    ['acme/b1', false, true],
    ['builder-a/old', true, false],
    ['builder-a/web', true, true],
  ]);
  assert.deepEqual([rows[1].builder, rows[1].name], ['builder-a', 'old']);
  const many = Array.from({ length: 50 }, (_, i) => `builder-a/s${String(i).padStart(2, '0')}`);
  const capped = sessionRows(many, ['builder-a/s49'], 10);
  assert.equal(capped.length, 10);
  assert.ok(capped.some((r) => r.fkey === 'builder-a/s49' && r.muted), 'muted rows always kept');
  assert.deepEqual(sessionRows(null, null), []);
});

test('pushModel picks subscribe / unsubscribe / none', () => {
  assert.equal(pushModel({}).action, null);
  assert.equal(pushModel({ supported: true, secure: false }).action, null);
  assert.equal(pushModel({ supported: true, secure: true, subscribed: false, permission: 'default' }).action, 'subscribe');
  assert.equal(pushModel({ supported: true, secure: true, subscribed: false, permission: 'denied' }).action, null);
  assert.equal(pushModel({ supported: true, secure: true, subscribed: true }).action, 'unsubscribe');
});

test('hub only: isHub reads the source kind', () => {
  assert.equal(isHub({ source: { kind: 'hub' } }), true);
  assert.equal(isHub({ source: { kind: 'local' } }), false);
  assert.equal(isHub(null), false);
});

test('savePrefs posts to /api/notify/prefs through the injected net.js post', async () => {
  const calls = [];
  const fake = async (url, body) => { calls.push([url, body]); return { kinds: { stuck: false }, quietHours: null, mutedTargets: [] }; };
  const r = await savePrefs({ kinds: { stuck: false } }, fake);
  assert.deepEqual(calls, [[PREFS_PATH, { kinds: { stuck: false } }]]);
  assert.equal(r.kinds.stuck, false);
  assert.equal(await savePrefs({}, async () => null), null);
  assert.equal(await savePrefs({}, async () => ({ error: 'x' })), null);
});

test('loadPrefs GETs the route and survives failures', async () => {
  const ok = await loadPrefs(async (url) => {
    assert.equal(url, PREFS_PATH);
    return { ok: true, json: async () => ({ kinds: {}, quietHours: null, mutedTargets: [] }) };
  });
  assert.deepEqual(ok, { kinds: {}, quietHours: null, mutedTargets: [] });
  assert.equal(await loadPrefs(async () => ({ ok: false, json: async () => ({}) })), null);
  assert.equal(await loadPrefs(async () => { throw new Error('down'); }), null);
});

test('unsubscribePush sends DELETE with X-Laneboard and the endpoint, then unsubscribes', async () => {
  let req = null;
  let dropped = false;
  const sub = { endpoint: 'https://push.example.invalid/abc', unsubscribe: async () => { dropped = true; } };
  const ok = await unsubscribePush(sub, async (url, opts) => { req = [url, opts]; return { ok: true }; });
  assert.equal(ok, true);
  assert.equal(dropped, true);
  assert.equal(req[0], '/api/push/subscribe');
  assert.equal(req[1].method, 'DELETE');
  assert.equal(req[1].headers['x-laneboard'], '1');
  assert.deepEqual(JSON.parse(req[1].body), { endpoint: sub.endpoint });
  assert.equal(await unsubscribePush(null, async () => ({ ok: true })), false);
});

test('source rules: POSTs via net.js, no HTML sinks, palette command exported', () => {
  assert.match(SRC, /import \{ post \} from '\.\.\/core\/net\.js'/);
  assert.doesNotMatch(SRC, /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(SRC, /method:\s*'POST'/, 'POSTs go through net.js post()');
  assert.doesNotMatch(SRC, /\bd3|class\s+\w+|super\(/);
  assert.equal(COMMAND.id, 'notifications');
  assert.equal(typeof COMMAND.run, 'function');
});
