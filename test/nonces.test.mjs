import test from 'node:test';
import assert from 'node:assert/strict';

import { createNonceCache } from '../server/fleet/nonces.mjs';

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('add inserts a fresh nonce once; the second add is a replay', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  assert.equal(cache.seen(uuid(1)), false);
  assert.deepEqual(cache.add(uuid(1), c.t), { ok: true });
  assert.equal(cache.seen(uuid(1)), true);
  assert.deepEqual(cache.add(uuid(1), c.t), { ok: false, error: 'replay' });
  assert.deepEqual(cache.add(uuid(1), c.t + 5000), { ok: false, error: 'replay' }, 'a different ts does not make it new');
  assert.equal(cache.size(), 1);
});

test('defaults are max 10000 and ttl 5 min', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  cache.add(uuid(1), c.t);
  c.t += 300000;
  assert.equal(cache.seen(uuid(1)), true, 'still held at exactly ttl');
  c.t += 1;
  assert.equal(cache.seen(uuid(1)), false);
  for (let i = 0; i < 10000; i++) assert.equal(cache.add(uuid(100 + i), c.t).ok, true);
  assert.deepEqual(cache.add(uuid(99999), c.t), { ok: false, error: 'full' });
});

test('seen does not insert', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  assert.equal(cache.seen(uuid(1)), false);
  assert.equal(cache.size(), 0);
  assert.deepEqual(cache.add(uuid(1), c.t), { ok: true });
});

test('ids compare case-insensitively (one UUID, two spellings)', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  const id = 'ABCDEF01-2345-4789-8abc-DEF012345678';
  assert.equal(cache.add(id, c.t).ok, true);
  assert.equal(cache.seen(id.toLowerCase()), true);
  assert.deepEqual(cache.add(id.toLowerCase(), c.t), { ok: false, error: 'replay' });
});

test('an expired nonce can be added again', () => {
  const c = clock();
  const cache = createNonceCache({ ttlMs: 1000, now: c.now });
  cache.add(uuid(1), c.t);
  c.t += 1001;
  assert.equal(cache.seen(uuid(1)), false);
  assert.deepEqual(cache.add(uuid(1), c.t), { ok: true });
  assert.deepEqual(cache.add(uuid(1), c.t), { ok: false, error: 'replay' });
});

test('full: never evicts a live nonce, answers full, and keeps refusing replays', () => {
  const c = clock();
  const cache = createNonceCache({ max: 3, ttlMs: 1000, now: c.now });
  for (let i = 1; i <= 3; i++) assert.deepEqual(cache.add(uuid(i), c.t), { ok: true });
  assert.deepEqual(cache.add(uuid(4), c.t), { ok: false, error: 'full' });
  assert.equal(cache.seen(uuid(4)), false, 'a refused nonce is not recorded');
  for (let i = 1; i <= 3; i++) {
    assert.equal(cache.seen(uuid(i)), true, `live nonce ${i} survives a full cache`);
    assert.deepEqual(cache.add(uuid(i), c.t), { ok: false, error: 'replay' }, 'replay wins over full');
  }
  assert.equal(cache.size(), 3);
});

test('full frees up as soon as entries expire', () => {
  const c = clock();
  const cache = createNonceCache({ max: 2, ttlMs: 1000, now: c.now });
  cache.add(uuid(1), c.t);
  c.t += 500;
  cache.add(uuid(2), c.t);
  assert.equal(cache.add(uuid(3), c.t).error, 'full');
  c.t += 501; // uuid(1) expired, uuid(2) live
  assert.deepEqual(cache.add(uuid(3), c.t), { ok: true });
  assert.equal(cache.seen(uuid(2)), true);
  assert.equal(cache.add(uuid(4), c.t).error, 'full');
});

test('full is decided on live entries only, even when expired ones sit behind a live head', () => {
  const c = clock();
  const cache = createNonceCache({ max: 2, ttlMs: 1000, now: c.now });
  // first entry carries a future ts (retained longer), second one a plain ts: insertion order != expiry order
  cache.add(uuid(1), c.t + 900);
  cache.add(uuid(2), c.t);
  c.t += 1001; // uuid(2) expired, uuid(1) (head) still live
  assert.equal(cache.seen(uuid(1)), true);
  assert.equal(cache.seen(uuid(2)), false);
  assert.deepEqual(cache.add(uuid(3), c.t), { ok: true }, 'the expired entry behind the head is swept, not counted');
  assert.equal(cache.size(), 2);
});

test('retention: at least ttl after acceptance, even for an old ts (preload) ', () => {
  const c = clock();
  const cache = createNonceCache({ ttlMs: 1000, now: c.now });
  cache.add(uuid(1), c.t - 999_999); // a ts far in the past is retained from now
  c.t += 1000;
  assert.equal(cache.seen(uuid(1)), true);
  assert.equal(cache.add(uuid(1), c.t).error, 'replay');
  c.t += 1;
  assert.equal(cache.seen(uuid(1)), false);
});

test('retention: at least ttl after a future ts, clamped to 2 x ttl', () => {
  const c = clock();
  const cache = createNonceCache({ ttlMs: 1000, now: c.now });
  const start = c.t;
  cache.add(uuid(1), start + 600); // within the skew window ahead
  cache.add(uuid(2), start + 1e12); // absurd future ts: clamped, cannot pin a slot forever
  c.t = start + 1600;
  assert.equal(cache.seen(uuid(1)), true);
  c.t = start + 1601;
  assert.equal(cache.seen(uuid(1)), false);
  c.t = start + 2000;
  assert.equal(cache.seen(uuid(2)), true);
  c.t = start + 2001;
  assert.equal(cache.seen(uuid(2)), false);
});

test('every nonce outlives the ±60 s ts window with the default ttl', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  const skew = 60000;
  // oldest acceptable ts and newest acceptable ts
  cache.add(uuid(1), c.t - skew);
  cache.add(uuid(2), c.t + skew);
  const start = c.t;
  // ts uuid(2) stays acceptable until real time ts + skew = start + 2*skew
  for (const dt of [0, skew, 2 * skew]) {
    c.t = start + dt;
    assert.equal(cache.add(uuid(1), c.t - skew).error, 'replay', `uuid(1) at +${dt}`);
    assert.equal(cache.add(uuid(2), c.t).error, 'replay', `uuid(2) at +${dt}`);
  }
});

test('a non-finite ts counts as now', () => {
  const c = clock();
  const cache = createNonceCache({ ttlMs: 1000, now: c.now });
  for (const [i, ts] of [[1, NaN], [2, undefined], [3, Infinity], [4, -Infinity], [5, '123']]) {
    assert.deepEqual(cache.add(uuid(i), ts), { ok: true });
  }
  c.t += 1000;
  for (let i = 1; i <= 5; i++) assert.equal(cache.seen(uuid(i)), true);
  c.t += 1;
  assert.equal(cache.size(), 0);
});

test('a clock stepping backwards only keeps nonces longer', () => {
  const c = clock();
  const cache = createNonceCache({ ttlMs: 1000, now: c.now });
  cache.add(uuid(1), c.t);
  c.t -= 50_000;
  assert.equal(cache.seen(uuid(1)), true);
  assert.equal(cache.add(uuid(1), c.t).error, 'replay');
});

test('invalid ids throw and never enter the cache', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  for (const bad of [undefined, null, 42, '', 'x'.repeat(129), {}, ['a']]) {
    assert.throws(() => cache.add(bad, c.t), TypeError, JSON.stringify(bad));
    assert.throws(() => cache.seen(bad), TypeError);
  }
  assert.equal(cache.size(), 0);
  assert.equal(cache.add('x'.repeat(128), c.t).ok, true);
});

test('prototype-ish ids are plain keys', () => {
  const c = clock();
  const cache = createNonceCache({ now: c.now });
  for (const id of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
    assert.equal(cache.seen(id), false);
    assert.equal(cache.add(id, c.t).ok, true);
    assert.equal(cache.add(id, c.t).error, 'replay');
  }
});

test('invalid options throw', () => {
  for (const opts of [{ max: 0 }, { max: -1 }, { max: 1.5 }, { max: '10' }, { ttlMs: 0 }, { ttlMs: NaN }, { now: 5 }]) {
    assert.throws(() => createNonceCache(opts), TypeError, JSON.stringify(opts));
  }
  assert.throws(() => createNonceCache({ now: () => NaN }).add(uuid(1), 0), TypeError);
});

test('defaults to Date.now', () => {
  const cache = createNonceCache();
  assert.equal(cache.add(uuid(1), Date.now()).ok, true);
  assert.equal(cache.seen(uuid(1)), true);
});

test('many adds stay bounded by ttl, not by count', () => {
  const c = clock();
  const cache = createNonceCache({ max: 100, ttlMs: 1000, now: c.now });
  for (let i = 0; i < 5000; i++) {
    c.t += 20; // 50 live at a time
    assert.equal(cache.add(uuid(i), c.t).ok, true, `add ${i}`);
  }
  assert.ok(cache.size() <= 51);
});
