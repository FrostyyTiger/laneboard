// three.js is vendored for the Wall's galaxy (Wall plan D8): one pinned file with its MIT licence,
// served by the /vendor/ fall-through to public/vendor/ like the fonts and icons.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const THREE = path.resolve(import.meta.dirname, '..', 'public', 'vendor', 'three');
const read = (f) => fs.readFileSync(path.join(THREE, f), 'utf8');

async function serve(url) {
  // Never read a real config from a bare `node --test`.
  process.env.LANEBOARD_CONFIG ??= path.join(import.meta.dirname, 'fixtures', 'empty-config.json');
  const { handleRequest } = await import('../server/http.mjs');
  const { PassThrough } = await import('node:stream');
  const res = new PassThrough();
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  let status = 0;
  let headers = {};
  res.writeHead = (s, h = {}) => { status = s; headers = h; };
  const done = new Promise((resolve) => res.on('end', resolve));
  await handleRequest({ method: 'GET', url, headers: {} }, res);
  await done;
  return { status, type: headers['content-type'] ?? '', headers, body: Buffer.concat(chunks).toString('utf8') };
}

test('three.module.js is r170, the pinned 0.170.0', () => {
  assert.match(read('three.module.js'), /^const REVISION = '170';$/m);
});

test('three.js carries its MIT licence', () => {
  const licence = read('LICENSE');
  assert.match(licence, /^The MIT License/);
  assert.match(licence, /three\.js authors/);
  assert.match(read('three.module.js'), /SPDX-License-Identifier: MIT/);
});

test('SOURCES.txt pins the file by its sha256', () => {
  const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(THREE, 'three.module.js'))).digest('hex');
  assert.match(read('SOURCES.txt'), new RegExp(`${sum}  three\\.module\\.js`));
});

test('GET /vendor/three/three.module.js is served as JavaScript, immutable', async () => {
  const r = await serve('/vendor/three/three.module.js');
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/javascript/);
  assert.match(r.headers['cache-control'], /immutable/);
  assert.match(r.body, /const REVISION = '170';/);
});
