// What a `curl` visitor guesses (runs n5 T8): /api/health, a bogus Morning
// window, an unknown /api path and an unknown page path, through a real boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers/boot.mjs';
import { body, PATH } from '../server/routes/api-health.mjs';
import { VERSION } from '../server/version.mjs';

test('body: ok, the version and the mode, nothing else', () => {
  assert.equal(PATH, '/api/health');
  assert.deepEqual(body({ mode: 'builder' }), { ok: true, version: VERSION, mode: 'builder' });
  assert.deepEqual(body({ version: '9.9.9', mode: 'hub' }), { ok: true, version: '9.9.9', mode: 'hub' });
  assert.equal(body().mode, 'builder', 'no mode is a builder');
});

test('through boot(): /api/health 200 JSON, bogus window 400, /api/nope JSON 404, /nope the page', async () => {
  const b = await boot();
  try {
    const h = await fetch(`${b.url}/api/health`);
    assert.equal(h.status, 200);
    assert.match(h.headers.get('content-type') ?? '', /application\/json/);
    const hb = await h.json();
    assert.deepEqual(Object.keys(hb).sort(), ['mode', 'ok', 'version']);
    assert.equal(hb.ok, true);
    assert.equal(hb.version, VERSION);
    assert.equal(hb.mode, 'builder');

    const m = await fetch(`${b.url}/api/morning?window=bogus`);
    assert.equal(m.status, 400);
    const mb = await m.json();
    assert.match(mb.error, /unknown window "bogus"; one of 12h, tonight, 24h, 7d/);
    assert.deepEqual(mb.windows, ['12h', 'tonight', '24h', '7d']);
    assert.equal((await fetch(`${b.url}/api/morning?window=24h`)).status, 200);

    const n = await fetch(`${b.url}/api/nope`);
    assert.equal(n.status, 404);
    assert.match(n.headers.get('content-type') ?? '', /application\/json/);
    assert.equal((await n.json()).error, 'not found');

    const p = await fetch(`${b.url}/nope`);
    assert.equal(p.status, 200);
    assert.match(p.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await p.text(), /<html/i);
  } finally {
    await b.stop();
  }
});
