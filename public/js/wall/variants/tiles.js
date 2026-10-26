// Trouble tiles over any direction (Wall plan night 2 T7, README §5
// "Fallback"; from the sketch docs/plans/wall/sketch/tiles.js): every named
// place whose worst status (its own or that of the unnamed things under it)
// is warn or crit gets a filled hex tile round its mark and name, in its
// tone, as mosaic draws its tiles (render.js polygon guides). Calm places get
// none: grey unless something needs you.
//
// `withTiles(base)` wraps a direction's module (`optionsFor`, `ASPECT`,
// `ambient`); `{ sunName: px }` also names the core (the hub) at px.
// `focusLinks(model, heldSite)` is the 2D page's link rule for a variant
// with `links: 'focus'`: no links at the overview, and while the camera holds
// a site only the links into or out of it.
//
// Pure: no DOM, so test/wall-tiles.test.mjs imports it directly.

import { hexCorners } from './mosaic.js';
import { statusStyle } from '../../views/map/overlays.js';

const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const RANK = { low: 1, warn: 2, crit: 3 };
const MAX_DEPTH = 50;

/** Hex circumradius round a mark and the name under it, and how far below the mark its centre sits. */
export const TILE = Object.freeze({ r: 44, dy: 16 });

/**
 * The tiles' places: id → tone ('warn' | 'crit') for every named place with
 * something at warn or worst in it, counted for its nearest named ancestor
 * (itself when it is named). Calm and `low` give none.
 */
export function troublePlaces(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.id != null);
  const byId = new Map(list.map((n) => [n.id, n]));
  const owner = (n) => {
    let c = n, k = 0;
    while (c && !NAMED.has(c.kind) && k++ < MAX_DEPTH) c = byId.get(c.parent);
    return c && NAMED.has(c.kind) ? c : null;
  };
  const worst = new Map();
  for (const n of list) {
    const t = statusStyle(n).tone, r = RANK[t] ?? 0;
    if (r < RANK.warn) continue;
    const o = owner(n);
    if (o && (RANK[worst.get(o.id)] ?? 0) < r) worst.set(o.id, t);
  }
  return worst;
}

/** A layout function with the trouble tiles added to its guides; new guides only when a tone or the base changes. */
function wrap(inner) {
  let memo = null;
  return function layout(nodes) {
    const out = inner(nodes);
    const worst = troublePlaces(nodes);
    const key = [...worst].map(([id, t]) => `${id}\u0000${t}`).join('|');
    if (!memo || memo.key !== key || memo.base !== out.guides || memo.pos !== out.pos) {
      const tiles = [];
      for (const [id, tone] of worst) {
        const p = out.pos.get(id);
        if (p) tiles.push({ pts: hexCorners(p.x, p.y + TILE.dy, TILE.r), tone });
      }
      memo = { key, base: out.guides, pos: out.pos, guides: [...(out.guides ?? []), ...tiles] };
    }
    return { ...out, guides: memo.guides };
  };
}

/** `base.optionsFor(aspect, screen)` with the trouble tiles over its layout (and the sun named at `sunName` px). */
export function tiledOptions(base, aspect, screen, { sunName = 0 } = {}) {
  const o = base.optionsFor(aspect, screen);
  const own = o.labelSize;
  const labelSize = sunName > 0 && typeof own === 'function'
    ? (node, ctx) => (node?.kind === 'core' && !node.virtual ? sunName : own(node, ctx))
    : own;
  return { ...o, layout: wrap(o.layout), labelSize };
}

/** A direction's module with trouble tiles: `{ optionsFor, mapOptions, ambient }`. */
export function withTiles(base, opts) {
  const optionsFor = (aspect, screen) => tiledOptions(base, aspect, screen, opts);
  return { optionsFor, mapOptions: Object.freeze(optionsFor(base.ASPECT)), ambient: base.ambient };
}

/** The site (or host) a node is in, by its parents; null when it is in none. */
export function siteOf(id, byId) {
  let n = byId.get(id), k = 0;
  while (n && n.kind !== 'site' && n.kind !== 'host' && k++ < MAX_DEPTH) n = byId.get(n.parent);
  return n && (n.kind === 'site' || n.kind === 'host') ? n.id : null;
}

/**
 * The model a `links: 'focus'` page draws: no links while nothing is held,
 * only the held site's own links (either end inside it) while one is. The
 * nodes are the model's; a model without links comes back as it is.
 */
export function focusLinks(model, heldSite) {
  if (!model || typeof model !== 'object') return model;
  if (heldSite == null) return { ...model, links: [] };
  const byId = new Map((model.nodes ?? []).map((n) => [n.id, n]));
  const links = (model.links ?? []).filter((l) => siteOf(l.from, byId) === heldSite || siteOf(l.to, byId) === heldSite);
  return { ...model, links };
}
