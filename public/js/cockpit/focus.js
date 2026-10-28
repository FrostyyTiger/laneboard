// The screen's focus as a `prompt` carries it (cockpit spec c3-see.md §8.1,
// protocols.md §3.1): page, route, wallState, layout, pane, inSight. Pure, so
// node:test drives it with a plain object for `doc` and `loc`.
//
//   focusNow({ page: 'app' | 'wall', doc, loc }) → {page, route, wallState, layout, pane, inSight}
//
// The app's route is read from the hash with the router's grammar
// (public/js/core/router.js header: `#/<view>?b=&s=&q=&sel=&open=&run=`,
// `#/runs/<id>`), not by importing the router: the Wall page runs this module
// too and the router pulls in the app's shell (build B135). A key over the
// room's limit (protocols.md §2.4, server/cockpit/protocol.mjs ROUTE) is left
// out, so a long search box never costs the prompt a `bad-message`.
// `inSight` is C3's (the Map's and the Wall's nodes in sight): `[]` in C1.

const ROUTE_KEYS = ['b', 's', 'q', 'sel', 'open', 'run'];
/** The room's longest value per key (server/cockpit/protocol.mjs ROUTE: MAX_Q, MAX_SEL, 64). */
const MAX_LEN = Object.freeze({ view: 32, b: 64, s: 400, q: 200, sel: 300, open: 16, run: 64 });
const OPEN = new Set(['term', 'transcript']);
const CONTROL = /[\u0000-\u001f\u007f]/;

const fits = (k, v) => typeof v === 'string' && v.length >= 1 && v.length <= MAX_LEN[k] && !CONTROL.test(v);

/** The app's route from `location.hash`: its non-default keys, as formatHash writes them. */
export function routeOfHash(hash) {
  const h = String(hash ?? '').replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [view0, rest] = path.split('/');
  const view = view0 || 'map';
  const route = { view: fits('view', view) ? view : 'map' };
  let params;
  try { params = new URLSearchParams(query); } catch { params = new URLSearchParams(); }
  for (const k of ROUTE_KEYS) {
    const v = params.get(k);
    if (v === null || v === '' || (k === 'b' && v === 'all')) continue;
    if (k === 'open' && !OPEN.has(v)) continue;
    if (fits(k, v)) route[k] = v;
  }
  // `#/runs/<id>` is the run's page (router.js, T24).
  if (route.view === 'runs' && rest && !route.run) {
    let id = rest;
    try { id = decodeURIComponent(rest); } catch { /* as written */ }
    if (fits('run', id)) route.run = id;
  }
  return route;
}

export function focusNow({ page = 'app', doc = globalThis.document, loc = globalThis.location } = {}) {
  const ds = doc?.documentElement?.dataset ?? {};
  const pane = ['open', 'closed', 'column'].includes(ds.pane) ? ds.pane : 'closed';
  if (page === 'wall') {
    const ws = ds.wallState;
    const layout = ds.cockpitLayout;
    return {
      page: 'wall',
      route: { view: 'wall' },
      wallState: ws === 'tour' || ws === 'explore' ? ws : null,
      layout: ['wall', 'switch', 'split', 'canvas'].includes(layout) ? layout : 'wall',
      pane,
      inSight: [],
    };
  }
  return { page: 'app', route: routeOfHash(loc?.hash), wallState: null, layout: null, pane, inSight: [] };
}
