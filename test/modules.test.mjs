// server/modules.mjs: the feature-module loader every later fleet task uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createContext, registerModules, startModules, loadModules, moduleFiles, ModuleError,
} from '../server/modules.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-modules-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let seq = 0;
/** A fresh module dir holding `files` ({ 'name.mjs': source }). */
function dir(files) {
  const d = path.join(tmp, `d${++seq}`);
  fs.mkdirSync(d, { recursive: true });
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(d, name), src);
  return d;
}

/** A module that records its calls on globalThis.__lbLog. */
const recorder = (name, { modes = "['builder']", extra = '' } = {}) => `
export default {
  name: '${name}',
  modes: ${modes},
  register(ctx) { (globalThis.__lbLog ??= []).push('register:${name}'); ${extra} },
  start(ctx) { globalThis.__lbLog.push('start:${name}'); },
  stop() { globalThis.__lbLog.push('stop:${name}'); },
};
`;

/** A ctx whose routes and upgrades land in plain arrays, not the real http table. */
function testCtx(base = {}) {
  const routes = [];
  const upgrades = [];
  const ctx = createContext({ mode: 'builder', ...base }, {
    route: (method, pattern, handler) => routes.push({ method, pattern, handler }),
    upgradeHandlers: upgrades,
  });
  return { ctx, routes, upgrades };
}

test('every register runs in filename order, then every start', async () => {
  globalThis.__lbLog = [];
  const d = dir({ 'b.mjs': recorder('b'), 'a.mjs': recorder('a'), 'c.mjs': recorder('c'), 'notes.txt': 'ignored' });
  const { ctx } = testCtx();
  const mods = await loadModules(d, ctx, { shutdownHooks: [] });
  assert.deepEqual(mods.map((m) => m.name), ['a', 'b', 'c']);
  assert.deepEqual(globalThis.__lbLog, ['register:a', 'register:b', 'register:c', 'start:a', 'start:b', 'start:c']);
});

test('several dirs register together before anything starts', async () => {
  globalThis.__lbLog = [];
  const routes = dir({ 'z.mjs': recorder('z') });
  const flags = dir({ 'a.mjs': recorder('flag-a') });
  const { ctx } = testCtx();
  await loadModules([routes, flags], ctx, { shutdownHooks: [] });
  assert.deepEqual(globalThis.__lbLog, ['register:z', 'register:flag-a', 'start:z', 'start:flag-a']);
});

test('modules whose modes exclude the running mode are skipped', async () => {
  globalThis.__lbLog = [];
  const d = dir({
    '1-builder.mjs': recorder('only-builder'),
    '2-hub.mjs': recorder('only-hub', { modes: "['hub']" }),
    '3-both.mjs': recorder('both', { modes: "['builder', 'hub']" }),
  });
  const { ctx } = testCtx({ mode: 'hub' });
  const mods = await loadModules(d, ctx, { shutdownHooks: [] });
  assert.deepEqual(mods.map((m) => m.name), ['only-hub', 'both']);
  assert.ok(!globalThis.__lbLog.includes('register:only-builder'));

  globalThis.__lbLog = [];
  const asBuilder = await loadModules(d, testCtx().ctx, { shutdownHooks: [] });
  assert.deepEqual(asBuilder.map((m) => m.name), ['only-builder', 'both']);
});

test('stop hooks are collected newest first, ahead of the boot path\'s own', async () => {
  globalThis.__lbLog = [];
  const d = dir({ 'a.mjs': recorder('a'), 'b.mjs': recorder('b'), 'c.mjs': `export default { name: 'nostop', modes: ['builder'], register() {} };` });
  const hooks = [() => globalThis.__lbLog.push('core:db.close')];
  await loadModules(d, testCtx().ctx, { shutdownHooks: hooks });
  assert.equal(hooks.length, 3, 'one hook per module with a stop, plus the core one');
  globalThis.__lbLog = [];
  for (const fn of hooks) await fn();
  assert.deepEqual(globalThis.__lbLog, ['stop:b', 'stop:a', 'core:db.close']);
});

test('a second module route with the same method and path shape is refused', async () => {
  const { ctx, routes } = testCtx();
  ctx.route('GET', '/api/v1/thing/:id', () => {});
  ctx.route('POST', '/api/v1/thing/:id', () => {});
  assert.throws(() => ctx.route('GET', '/api/v1/thing/:name', () => {}), (err) => {
    assert.ok(err instanceof ModuleError);
    assert.match(err.message, /duplicate route GET \/api\/v1\/thing\/:/);
    return true;
  });
  assert.equal(routes.length, 2, 'the duplicate never reached the router');

  // The same through the loader: the boot fails, naming the route.
  const d = dir({
    'a.mjs': `export default { name: 'a', modes: ['builder'], register(ctx) { ctx.route('GET', '/api/dup', () => {}); } };`,
    'b.mjs': `export default { name: 'b', modes: ['builder'], register(ctx) { ctx.route('GET', '/api/dup', () => {}); } };`,
  });
  await assert.rejects(loadModules(d, testCtx().ctx, { shutdownHooks: [] }), /duplicate route GET \/api\/dup/);
});

test('ctx.route reaches the real router by default', async () => {
  const { handleRequest } = await import('../server/http.mjs');
  const ctx = createContext({ mode: 'builder' });
  ctx.route('GET', '/api/_modules-test/:x', (req, res) => ctx.json(res, { x: req.params.x }));
  let status = 0; let body = '';
  const res = {
    headersSent: false,
    writeHead(s) { status = s; },
    end(b) { body = String(b); },
  };
  await handleRequest({ method: 'GET', url: '/api/_modules-test/hello', headers: {} }, res);
  assert.equal(status, 200);
  assert.deepEqual(JSON.parse(body), { x: 'hello' });
});

test('ctx.upgrade adds a WebSocket upgrade handler', () => {
  const { ctx, upgrades } = testCtx();
  const fn = () => false;
  ctx.upgrade(fn);
  assert.deepEqual(upgrades, [fn]);
  assert.throws(() => ctx.upgrade('nope'), ModuleError);
});

test('services: provide in register, use in start; late provide and missing use throw', async () => {
  const d = dir({
    'a-consumer.mjs': `export default { name: 'consumer', modes: ['builder'],
      register(ctx) {}, start(ctx) { globalThis.__lbUsed = ctx.use('store').id; } };`,
    'b-provider.mjs': `export default { name: 'provider', modes: ['builder'],
      register(ctx) { ctx.provide('store', { id: 42 }); } };`,
  });
  const { ctx } = testCtx();
  await loadModules(d, ctx, { shutdownHooks: [] });
  // The consumer sorts first and still sees the provider's service.
  assert.equal(globalThis.__lbUsed, 42);
  assert.equal(ctx.has('store'), true);
  assert.equal(ctx.has('relay'), false);
  assert.throws(() => ctx.use('relay'), /service 'relay' is not provided/);
  assert.throws(() => ctx.provide('late', 1), /provide in register, use in start/);
});

test('a service provided twice is refused', () => {
  const { ctx } = testCtx();
  ctx.provide('audit', {});
  assert.throws(() => ctx.provide('audit', {}), /already provided/);
});

test('the ctx carries the boot path\'s services and the http helpers, frozen', () => {
  const state = { snapshot() {} };
  const { ctx } = testCtx({ state, version: '9.9.9' });
  assert.equal(ctx.state, state);
  assert.equal(ctx.version, '9.9.9');
  for (const k of ['route', 'json', 'readBody', 'readJson', 'upgrade', 'provide', 'has', 'use']) {
    assert.equal(typeof ctx[k], 'function', k);
  }
  assert.ok(Object.isFrozen(ctx));
});

test('a malformed module fails the boot with its file named', async () => {
  const cases = [
    [`export default { modes: ['builder'], register() {} };`, /needs a name/],
    [`export default { name: 'x', register() {} };`, /modes must be/],
    [`export default { name: 'x', modes: ['both'], register() {} };`, /modes must be/],
    [`export default { name: 'x', modes: ['builder'] };`, /register\(ctx\) is required/],
    [`export default { name: 'x', modes: ['builder'], register() {}, start: 5 };`, /start must be a function/],
  ];
  for (const [src, re] of cases) {
    const d = dir({ 'bad.mjs': src });
    await assert.rejects(loadModules(d, testCtx().ctx, { shutdownHooks: [] }), (err) => {
      assert.ok(err instanceof ModuleError);
      assert.match(err.message, re);
      assert.match(err.message, /bad\.mjs/);
      return true;
    });
  }
});

test('duplicate module names are refused', async () => {
  const d = dir({ 'a.mjs': recorder('same'), 'b.mjs': recorder('same') });
  await assert.rejects(loadModules(d, testCtx().ctx, { shutdownHooks: [] }), /duplicate module name 'same'/);
});

test('a failing register or start names the module', async () => {
  const r = dir({ 'a.mjs': `export default { name: 'boom', modes: ['builder'], register() { throw new Error('nope'); } };` });
  await assert.rejects(loadModules(r, testCtx().ctx, { shutdownHooks: [] }), /module boom: register failed: nope/);
  const s = dir({ 'a.mjs': `export default { name: 'boom2', modes: ['builder'], register() {}, async start() { throw new Error('late'); } };` });
  await assert.rejects(loadModules(s, testCtx().ctx, { shutdownHooks: [] }), /module boom2: start failed: late/);
});

test('a module namespace without a default export works too', async () => {
  const d = dir({ 'ns.mjs': `export const name = 'ns'; export const modes = ['builder']; export function register() { globalThis.__lbNs = true; }` });
  const mods = await loadModules(d, testCtx().ctx, { shutdownHooks: [] });
  assert.deepEqual(mods.map((m) => m.name), ['ns']);
  assert.equal(globalThis.__lbNs, true);
});

test('register and start can be split, as boot/builder.mjs does', async () => {
  globalThis.__lbLog = [];
  const d = dir({ 'a.mjs': recorder('a') });
  const { ctx } = testCtx();
  const mods = await registerModules(d, ctx, { shutdownHooks: [] });
  assert.deepEqual(globalThis.__lbLog, ['register:a']);
  await startModules(mods, ctx);
  assert.deepEqual(globalThis.__lbLog, ['register:a', 'start:a']);
});

test('a missing module dir is empty, and the shipped dirs hold no stray modules', () => {
  assert.deepEqual(moduleFiles(path.join(tmp, 'does-not-exist')), []);
  // routes/, flags/ and hub/routes/ exist (a .gitkeep each); .gitkeep is not a module.
  for (const d of ['routes', 'flags', 'hub/routes']) {
    assert.ok(fs.existsSync(path.join(import.meta.dirname, '..', 'server', d)), d);
    for (const f of moduleFiles(d)) assert.ok(f.endsWith('.mjs'));
  }
});
