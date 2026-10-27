// Feature modules: how later work adds endpoints, flags and hub services
// without editing a boot file.
//
// A module is a file `server/<dir>/<name>.mjs` whose default export is
//
//   { name, modes: ['builder'|'hub'|'cockpit', ...], register(ctx), start?(ctx), stop?() }
//
// (a module namespace exporting the same names works too). Builder mode loads
// `routes` and `flags`; hub mode loads `hub/routes` (from H11 on).
//
// Rules:
//   - every `register` runs (filename order, dirs in the order given), then
//     every `start` (same order), so file names never decide dependencies;
//   - services: `ctx.provide(name, value)` in register, `ctx.use(name)` in start
//     or in a request handler; `ctx.has(name)` for optional ones;
//   - `ctx.route(method, path, handler)` is http.mjs `route`, refusing a second
//     module route with the same method and path shape;
//   - `ctx.upgrade(fn)` adds a WebSocket upgrade handler (boot/common.mjs);
//   - `stop()` hooks run on shutdown, newest module first, before the boot
//     path's own hooks (so the database is still open).
// Builder-side registries (dispatch, api-v1) are module singletons imported
// directly, never taken from ctx.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from './config.mjs';
import { log } from './log.mjs';
import { route as httpRoute, json, readBody, readJson } from './http.mjs';
import { upgradeHandlers, shutdownHooks } from './boot/common.mjs';

export const SERVER_DIR = import.meta.dirname;
export const MODES = ['builder', 'hub', 'cockpit'];

export class ModuleError extends Error {}

/** `/api/x/:id` and `/api/x/:name` are the same route. */
const routeShape = (method, pattern) => `${String(method).toUpperCase()} ${String(pattern).replace(/:[A-Za-z0-9_]+/g, ':')}`;

/**
 * The one ctx object every module sees: the boot path's `base` services plus
 * route/json/readBody/readJson/upgrade and the provide/has/use registry.
 * Frozen; the registry behind provide/use is the only mutable part.
 *
 * `opts.route`, `opts.upgradeHandlers` exist for tests.
 */
export function createContext(base = {}, opts = {}) {
  const services = new Map();
  const routes = new Set();
  const addRoute = opts.route ?? httpRoute;
  const upgrades = opts.upgradeHandlers ?? upgradeHandlers;
  let phase = 'register';
  const ctx = {
    ...base,
    route(method, pattern, handler) {
      const key = routeShape(method, pattern);
      if (routes.has(key)) throw new ModuleError(`duplicate route ${key}`);
      routes.add(key);
      return addRoute(method, pattern, handler);
    },
    json,
    readBody,
    readJson,
    upgrade(fn) {
      if (typeof fn !== 'function') throw new ModuleError('upgrade handler must be a function');
      upgrades.push(fn);
    },
    provide(name, value) {
      if (phase !== 'register') throw new ModuleError(`provide('${name}') after register: provide in register, use in start`);
      if (services.has(name)) throw new ModuleError(`service '${name}' is already provided`);
      services.set(name, value);
      return value;
    },
    has(name) {
      return services.has(name);
    },
    use(name) {
      if (!services.has(name)) throw new ModuleError(`service '${name}' is not provided`);
      return services.get(name);
    },
  };
  // Internal: startModules flips the phase so a late provide is caught.
  Object.defineProperty(ctx, '_phase', { value: (p) => { phase = p; }, enumerable: false });
  return Object.freeze(ctx);
}

/** The *.mjs files of one module dir, sorted by filename. A missing dir is empty. */
export function moduleFiles(dir, root = SERVER_DIR) {
  const abs = path.isAbsolute(dir) ? dir : path.join(root, dir);
  let names;
  try {
    names = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((d) => d.isFile() && d.name.endsWith('.mjs'))
    .map((d) => d.name)
    .sort()
    .map((n) => path.join(abs, n));
}

function shapeOf(ns, file) {
  const mod = ns.default && typeof ns.default === 'object' ? ns.default : ns;
  const where = path.relative(SERVER_DIR, file) || file;
  if (!mod || typeof mod.name !== 'string' || !mod.name) throw new ModuleError(`${where}: a module needs a name`);
  if (!Array.isArray(mod.modes) || !mod.modes.length || !mod.modes.every((m) => MODES.includes(m))) {
    throw new ModuleError(`${where}: modes must be a non-empty list of ${MODES.join('|')}`);
  }
  if (typeof mod.register !== 'function') throw new ModuleError(`${where}: register(ctx) is required`);
  for (const k of ['start', 'stop']) {
    if (mod[k] !== undefined && typeof mod[k] !== 'function') throw new ModuleError(`${where}: ${k} must be a function`);
  }
  return mod;
}

/**
 * Import and register every module of `dirs` (a dir or a list, relative to
 * server/) that runs in `opts.mode` (default `config.mode`). Returns the
 * registered modules, in order; call startModules() with them.
 */
export async function registerModules(dirs, ctx, opts = {}) {
  const mode = opts.mode ?? ctx.mode ?? config.mode;
  const root = opts.root ?? SERVER_DIR;
  const hooks = opts.shutdownHooks ?? shutdownHooks;
  const list = [];
  const names = new Set();
  for (const dir of [].concat(dirs)) {
    for (const file of moduleFiles(dir, root)) {
      const mod = shapeOf(await import(pathToFileURL(file).href), file);
      if (names.has(mod.name)) throw new ModuleError(`duplicate module name '${mod.name}' (${file})`);
      names.add(mod.name);
      if (!mod.modes.includes(mode)) continue;
      try {
        await mod.register(ctx);
      } catch (err) {
        throw wrap(err, `module ${mod.name}: register failed`);
      }
      list.push(mod);
    }
  }
  // Newest first, ahead of the boot path's own hooks.
  const stops = list.filter((m) => m.stop).map((m) => async () => m.stop());
  hooks.unshift(...stops.reverse());
  return list;
}

/** Run every registered module's start(ctx), in order. */
export async function startModules(list, ctx) {
  ctx._phase?.('start');
  for (const mod of list) {
    if (!mod.start) continue;
    try {
      await mod.start(ctx);
    } catch (err) {
      throw wrap(err, `module ${mod.name}: start failed`);
    }
  }
  if (list.length) log.info(`modules: ${list.map((m) => m.name).join(', ')}`);
  return list;
}

/** register then start, for one dir or a list: `loadModules('hub/routes', ctx)`. */
export async function loadModules(dirs, ctx, opts = {}) {
  return startModules(await registerModules(dirs, ctx, opts), ctx);
}

function wrap(err, msg) {
  if (err instanceof ModuleError) return err;
  const e = new ModuleError(`${msg}: ${err?.message || err}`);
  e.cause = err;
  return e;
}
