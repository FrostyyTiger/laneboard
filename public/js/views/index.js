// The view registry (fleet plan §4 D4; README §3: views/index.js).
//
// Each view module's `default` export is a view:
//   { id, icon, title, short, mount(el, ctx), unmount(), update(store, ctx) }
// `el` is the view's section (`#view-<id>` in index.html), `ctx` is
// { store, route, navigate }. The router calls activateView() on every route:
// switching views unmounts the old one and mounts the new one; the same view
// again only gets update().
//
// The views §1 F1 moved out of app.js have no default export yet. Until their
// owner adds one (it is picked up here with no change to this file), a legacy
// adapter wraps the old functions:
//   board    mount: nothing (ui/render.js renderAll paints the board on every
//            snapshot/delta, view or not)           update: nothing (renderAll)
//   map      mount: showMap(), deferred one task so the shell is laid out
//            before the map measures the header      update: nothing (`map` messages)
//   morning  mount: loadMorning()                    update: nothing (own fetch)
//   credit   mount: loadCredit()                     update: nothing (own fetch)
//   box      mount: renderBox()                      update: nothing (renderAll)
//   unmount is a no-op for all five: nothing is torn down when a legacy view is
//   hidden, so switching back is instant and the dock's terminals survive.
// The stubs (inbox, packages, audit, diff) are real default exports; their
// owners (C13, P12, D12, R11) replace the files.
//
// Pure at import time: the registry is built on first use, because the view
// modules sit in an import cycle with the router and their default exports
// are not initialised while this module evaluates.
import * as boardModule from './board.js';
import * as mapModule from './map.js';
import * as morningModule from './morning.js';
import * as creditModule from './credit.js';
import * as boxModule from './box.js';
import * as inboxModule from './inbox.js';
import * as packagesModule from './packages.js';
import * as auditModule from './audit.js';
import * as diffModule from './diff.js';
import * as runsModule from './runs.js';

/**
 * Nav metadata per view, in nav order: icon concept (core/icons.js), the long
 * title (title/aria-label) and the 3-4 character label shown from 1440px.
 */
export const VIEW_META = Object.freeze({
  map: { icon: 'map', title: 'Map', short: 'MAP' },
  board: { icon: 'board', title: 'Board', short: 'BRD' },
  inbox: { icon: 'inbox', title: 'Inbox', short: 'INBX' },
  packages: { icon: 'packages', title: 'Packages', short: 'PKG' },
  morning: { icon: 'morning', title: 'Morning', short: 'MORN' },
  credit: { icon: 'credit', title: 'Credit', short: 'CRED' },
  box: { icon: 'box', title: 'Box', short: 'BOX' },
  audit: { icon: 'audit', title: 'Audit', short: 'AUD' },
  runs: { icon: 'runs', title: 'Runs', short: 'RUNS' },
  diff: { icon: 'review', title: 'Diff', short: 'DIFF' },
});

const noop = () => {};

/** A legacy view: `show` runs on mount, everything else is a no-op. */
export function legacyView(id, show = noop) {
  const meta = VIEW_META[id] ?? { icon: 'alarm', title: id, short: id.toUpperCase() };
  return { id, ...meta, legacy: true, mount: () => show(), unmount: noop, update: noop };
}

/** True when `v` has the view shape (id plus mount/unmount/update functions). */
export function isView(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.id === 'string'
    && ['mount', 'unmount', 'update'].every((k) => typeof v[k] === 'function');
}

/** `mod.default` when it is a view, else the legacy adapter. */
function pick(mod, fallback) {
  const d = mod?.default;
  return isView(d) ? d : fallback;
}

let registry = null;

/** id -> view, built on first use (see the header). */
export function views() {
  if (registry) return registry;
  registry = new Map();
  // The view object itself, never a copy: a view may keep state on `this`.
  const add = (id, view) => registry.set(id, view);
  add('map', pick(mapModule, legacyView('map', () => setTimeout(() => mapModule.showMap(), 0))));
  add('board', pick(boardModule, legacyView('board')));
  add('inbox', pick(inboxModule, legacyView('inbox')));
  add('packages', pick(packagesModule, legacyView('packages')));
  add('morning', pick(morningModule, legacyView('morning', () => morningModule.loadMorning())));
  add('credit', pick(creditModule, legacyView('credit', () => creditModule.loadCredit())));
  add('box', pick(boxModule, legacyView('box', () => boxModule.renderBox())));
  add('audit', pick(auditModule, legacyView('audit')));
  add('runs', pick(runsModule, legacyView('runs')));
  add('diff', pick(diffModule, legacyView('diff')));
  return registry;
}

/** The view for `id`, or null. */
export function getView(id) {
  return views().get(id) ?? null;
}

let active = null; // { id, view, el }
const errors = [];

/** Errors thrown by a view's mount/unmount/update, newest last (bounded). */
export function viewErrors() {
  return errors.slice();
}

function guarded(id, what, fn) {
  try {
    fn();
    return true;
  } catch (err) {
    errors.push({ id, what, message: String(err?.message ?? err) });
    if (errors.length > 20) errors.shift();
    console.error('[laneboard] view', id, what, err);
    return false;
  }
}

/**
 * Show view `id` in `el`: unmount the previous view when it changes, then
 * mount; the same view again gets update(store, ctx). Returns the id shown,
 * or null for an unknown id. A throwing view never breaks the router.
 */
export function activateView(id, el, ctx = {}) {
  const view = getView(id);
  if (!view) return null;
  if (active && active.id === id) {
    guarded(id, 'update', () => view.update(ctx.store, ctx));
    return id;
  }
  if (active) {
    const prev = active;
    guarded(prev.id, 'unmount', () => prev.view.unmount());
  }
  active = { id, view, el };
  guarded(id, 'mount', () => view.mount(el, ctx));
  return id;
}

/** The id of the mounted view, or null. */
export function activeView() {
  return active?.id ?? null;
}

/** Forward a store change to the mounted view. */
export function updateActive(store, ctx = {}) {
  if (!active) return;
  const { id, view } = active;
  guarded(id, 'update', () => view.update(store, { store, ...ctx }));
}
