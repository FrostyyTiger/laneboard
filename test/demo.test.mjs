// The demo build: the real frontend plus the simulation, and nothing that
// would outlive the page on someone else's origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from '../bin/demo.mjs';

test('the demo build is the real page with the engine in front of app.js', (t) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'laneboard-demo-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  build(out);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const world = html.indexOf('demo/world.js'), engine = html.indexOf('demo/engine.js'), app = html.indexOf('src="app.js"');
  assert.ok(world > 0 && world < engine && engine < app, 'world, then engine, then app');
  for (const f of ['app.js', 'map.js', 'terminal.js', 'styles.css', 'vendor/xterm.js', 'vendor/xterm.css', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} is in the build`);
  }
  assert.ok(!fs.existsSync(path.join(out, 'sw.js')), 'no service worker on a demo origin');
  // Classic scripts: they must parse as plain scripts, not modules.
  for (const f of ['demo/world.js', 'demo/engine.js']) new Function(fs.readFileSync(path.join(out, f), 'utf8'));
});

test('the page loads everything by relative path, so it works under a subpath', () => {
  const html = fs.readFileSync(path.resolve(import.meta.dirname, '../public/index.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]), []);
  const app = fs.readFileSync(path.resolve(import.meta.dirname, '../public/app.js'), 'utf8');
  assert.ok(!/import\(['"]\/|from ['"]\/|register\(['"]\//.test(app), 'no absolute module or worker paths');
});
