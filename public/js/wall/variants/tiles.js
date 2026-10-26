// Sketch (not a loop task): mosaic's filled trouble tile over any direction.
// Every named place whose worst status (its own or that of the unnamed
// things under it) is warn or crit gets a hex tile round its mark and name,
// in its tone, as mosaic draws its tiles. `withTiles(base)` wraps a
// direction's module; `{ sunName: px }` also names the core (the hub) at px.

import { hexCorners } from './mosaic.js';
import { statusStyle } from '../../views/map/overlays.js';

const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const RANK = { low: 1, warn: 2, crit: 3 };

/** Hex circumradius round a mark and the name under it, and how far below the mark its centre sits. */
export const TILE = Object.freeze({ r: 44, dy: 16 });

function wrap(inner) {
  let memo = null;
  return function layout(nodes) {
    const out = inner(nodes);
    const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.id != null);
    const byId = new Map(list.map((n) => [n.id, n]));
    // The named place a node counts for: itself, or its nearest named ancestor.
    const owner = (n) => {
      let c = n, k = 0;
      while (c && !NAMED.has(c.kind) && k++ < 50) c = byId.get(c.parent);
      return c;
    };
    const worst = new Map();
    for (const n of list) {
      const t = statusStyle(n).tone, r = RANK[t] ?? 0;
      if (r < 2) continue;
      const o = owner(n);
      if (o && (worst.get(o.id)?.r ?? 0) < r) worst.set(o.id, { r, t });
    }
    const key = [...worst].map(([id, w]) => id + w.t).join('|');
    if (!memo || memo.key !== key || memo.base !== out.guides) {
      const tiles = [];
      for (const [id, w] of worst) {
        const p = out.pos.get(id);
        if (p) tiles.push({ pts: hexCorners(p.x, p.y + TILE.dy, TILE.r), tone: w.t });
      }
      memo = { key, base: out.guides, guides: [...(out.guides ?? []), ...tiles] };
    }
    return { ...out, guides: memo.guides };
  };
}

export function withTiles(base, { sunName = 0 } = {}) {
  const optionsFor = (aspect, screen) => {
    const o = base.optionsFor(aspect, screen);
    const own = o.labelSize;
    const labelSize = sunName > 0 && typeof own === 'function'
      ? (node, ctx) => (node?.kind === 'core' && !node.virtual ? sunName : own(node, ctx))
      : own;
    return { ...o, layout: wrap(o.layout), labelSize };
  };
  return { optionsFor, mapOptions: Object.freeze(optionsFor(base.ASPECT)), ambient: base.ambient };
}
