// The `mosaic` direction (docs/plans/wall/README.md §5, the wild card;
// research/Q5-hex-mosaic-wild-card.md): a honeycomb that fills the screen,
// one hexagon per place (a site, a room, a builder), each site one
// connected region of tiles with an empty channel round it. The tile's size
// is fixed, so its name is too: every name has the room counted for it.
//
// What a place holds that has no name at the overview (services, lanes,
// sessions, packages) is a row of dots at the top of its tile, so a tile
// reads like a room card: dots, mark, name. A tile in trouble (its own
// status or a dot's) takes its tone on its edge and a faint fill: from three
// metres the trouble is a coloured cell in a grey wall, in its site.
//
// Inside a region the site's tile is in the middle (the camera that flies
// to it lands mid-region, its name big there), and the rooms spiral out
// from it worst first, each followed by its builders: trouble sits where the
// eye lands. The order is taken when the tree changes, not on a status
// change: a tile does not move because its status did; it changes colour.
//
// The regions sit in slots of a treemap of the screen (model order, the hub
// in the middle of it), grown on the grid one cell at a time, the site
// furthest behind its size first, never next to another site's cell.
//
// Q5 differs in two places, both for the fixed-name promise: a tile per
// place, not per node (114 nodes as tiles would not hold a 15 px name on the
// tablet), and no names on dots in trouble at the overview (the tile's
// colour and the caption say it; the Map names them once the camera is in).
//
// Pure: no DOM, so test/wall-mosaic.test.mjs imports it directly.

import { baseLabelSize as radialLabelSize, IN_SITE } from './radial.js';
import { statusStyle } from '../../views/map/overlays.js';

/** The tablet's 2736 x 1824: what the layout stretches to when nobody says. */
export const ASPECT = 3 / 2;

/** The screen height (CSS px) the sizes are counted for. */
export const REF_H = 912;

/** Kept clear at each edge: islands' (the tag top right, clock and fleet line at the bottom). */
export const SAFE = Object.freeze({ side: 0.06, top: 0.12, bottom: 0.2 });

/**
 * Sizes in px at scale 1. `hex` a tile's circumradius (pointy top: 87 px
 * across, a 12-character room name at 15 px), `tile` the share of it drawn
 * (the dark ground between tiles), `mark` / `siteMark` the mark's centre
 * below the tile's (a site's name is a step bigger, so its mark sits higher),
 * `dots` the row of dots above the mark, `dot` their step, `perLine` dots
 * before a row wraps upward.
 */
export const SIZES = Object.freeze({
  hex: 50, tile: 0.92, mark: -0.06, siteMark: -0.3, dots: -0.6, dot: 9, perLine: 7,
});

const SQ3 = Math.sqrt(3);
const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const PLACE = new Set(['site', 'host']);

/** Axial neighbours of a pointy-top hex. */
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

/** Axial (q, r) to the centre in px for circumradius `s`. */
export const hexToPx = (q, r, s) => ({ x: s * SQ3 * (q + r / 2), y: s * 1.5 * r });

/** Steps between two axial cells. */
export const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

/** The six corners of a pointy-top hex of circumradius `s` round (x, y). */
export function hexCorners(x, y, s) {
  const out = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    out.push([x + s * Math.cos(a), y + s * Math.sin(a)]);
  }
  return out;
}

/** Status words ranked: what goes nearest the middle of a region first. */
const RANK = { crit: 3, down: 3, attention: 2, warn: 2, low: 1 };
const rankOf = (n) => RANK[n?.status] ?? 0;

/**
 * The tree the Map's layouts use: parents from `parent`, roots and orphans
 * under the core (or a virtual one). Returns `{ kids, center }`.
 */
function tree(nodes) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && n.id != null);
  const byId = new Map(list.map((n) => [n.id, n]));
  const core = list.find((n) => n.kind === 'core');
  const kids = new Map();
  const roots = [];
  for (const n of list) {
    if (n === core) continue;
    const p = n.parent != null && byId.has(n.parent) && n.parent !== n.id ? n.parent : null;
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else roots.push(n);
  }
  const center = core ?? { id: '__core', kind: 'core', label: '', virtual: true };
  kids.set(center.id, [...(kids.get(center.id) ?? []), ...roots]);
  for (const l of kids.values()) l.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { kids, center };
}

/**
 * The tiles of one region: `{ node, dots, rank }` for `top` (its own tile
 * first) and each named thing under it, with the unnamed things under each
 * as its dots. Rooms are ordered worst first (their own and their dots' and
 * builders' status), then model order; a builder follows its room.
 */
export function tilesOf(top, kids, seen = new Set([top.id])) {
  const tileOf = (n) => {
    const dots = [];
    const named = [];
    const walk = (p) => {
      for (const c of kids.get(p.id) ?? []) {
        if (seen.has(c.id)) continue; // a parent cycle in bad data
        seen.add(c.id);
        if (NAMED.has(c.kind)) named.push(c);
        else { dots.push(c); walk(c); }
      }
    };
    walk(n);
    return { node: n, dots, named, rank: Math.max(rankOf(n), ...dots.map(rankOf)) };
  };
  const group = (n) => {
    const t = tileOf(n);
    const after = t.named.flatMap(group);
    return [t, ...after];
  };
  const own = tileOf(top);
  const groups = own.named.map((c) => group(c));
  groups.forEach((g, i) => { g.at = i; g.rank = Math.max(...g.map((t) => t.rank)); });
  groups.sort((a, b) => b.rank - a.rank || a.at - b.at);
  return [own, ...groups.flat()];
}

/**
 * Slots for regions of `weights` in order, in a `w` x `h` rectangle centred
 * on (0, 0): the order cut into one to three rows, each row's height its
 * share of the weight, each slot's width its share of the row. Of the cuts
 * the one whose slots are nearest square wins. Returns `[{x, y, w, h}]`.
 */
export function slots(weights, w, h) {
  const n = weights.length;
  if (!n) return [];
  const total = weights.reduce((s, x) => s + x, 0) || 1;
  let best = null;
  const cuts = [];
  const walk = (from, cut) => {
    if (cut.length > 3) return;
    if (from === n) { cuts.push(cut); return; }
    for (let to = from + 1; to <= n; to++) walk(to, [...cut, [from, to]]);
  };
  walk(0, []);
  for (const rows of cuts) {
    const out = [];
    let y = -h / 2, cost = 0;
    for (const [a, b] of rows) {
      const rw = weights.slice(a, b).reduce((s, x) => s + x, 0);
      const rh = (h * rw) / total;
      let x = -w / 2;
      for (let i = a; i < b; i++) {
        const sw = (w * weights[i]) / rw;
        out.push({ x: x + sw / 2, y: y + rh / 2, w: sw, h: rh });
        cost += weights[i] * Math.abs(Math.log(sw / rh));
        x += sw;
      }
      y += rh;
    }
    if (!best || cost < best.cost - 1e-9) best = { cost, out };
  }
  return best.out;
}

/**
 * Grows regions of `need[i]` cells on a grid of `cols` x `rows` (odd rows
 * shifted right half a cell), each from the cell nearest its slot's centre
 * (px, circumradius `s`, grid centred on (0, 0)), one cell at a time to the
 * region furthest behind its size, never onto a cell next to another
 * region's. Returns each region's cells `[{q, r, x, y}]` in the order they
 * were taken, or null when a region runs out of room.
 */
export function grow(need, slotList, cols, rows, s) {
  const gw = SQ3 * s * (cols + 0.5), gh = 1.5 * s * (rows - 1) + 2 * s;
  const ox = -gw / 2 + (SQ3 * s) / 2, oy = -gh / 2 + s;
  const key = (q, r) => `${q},${r}`;
  const cells = new Map();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const q = col - (row - (row & 1)) / 2, r = row;
      cells.set(key(q, r), { q, r, x: ox + SQ3 * s * (col + 0.5 * (row & 1)), y: oy + 1.5 * s * row, owner: -1 });
    }
  }
  const free = (c, i) => c && c.owner < 0
    && NEIGHBOURS.every(([dq, dr]) => { const o = cells.get(key(c.q + dq, c.r + dr)); return !o || o.owner < 0 || o.owner === i; });
  // Nearest the slot's centre, measured in the slot's proportions, so a
  // region takes its slot's shape; ties by position (the same fleet, the same picture).
  const near = (c, sl) => ((c.x - sl.x) / Math.max(1, sl.w)) ** 2 + ((c.y - sl.y) / Math.max(1, sl.h)) ** 2;
  const better = (a, b, sl) => {
    const d = near(a, sl) - near(b, sl);
    return d < -1e-9 || (Math.abs(d) <= 1e-9 && (a.r < b.r || (a.r === b.r && a.q < b.q)));
  };
  const taken = need.map(() => []);
  const front = need.map(() => new Map());
  const claim = (i, c) => {
    c.owner = i;
    taken[i].push(c);
    front[i].delete(key(c.q, c.r));
    for (const [dq, dr] of NEIGHBOURS) {
      const o = cells.get(key(c.q + dq, c.r + dr));
      if (o && o.owner < 0) front[i].set(key(o.q, o.r), o);
    }
  };
  // Seeds in order: each the free cell nearest its slot's centre.
  for (let i = 0; i < need.length; i++) {
    if (need[i] <= 0) continue;
    let pick = null;
    for (const c of cells.values()) if (free(c, i) && (!pick || better(c, pick, slotList[i]))) pick = c;
    if (!pick) return null;
    claim(i, pick);
  }
  for (;;) {
    let i = -1, lag = Infinity;
    need.forEach((n, j) => {
      if (taken[j].length >= n) return;
      const share = taken[j].length / n;
      if (share < lag) { lag = share; i = j; }
    });
    if (i < 0) break;
    let pick = null;
    for (const c of front[i].values()) if (free(c, i) && (!pick || better(c, pick, slotList[i]))) pick = c;
    if (!pick) return null;
    claim(i, pick);
  }
  return taken;
}

/**
 * The cells of a region in spiral order from its first (the site's): by
 * steps from it, then clockwise from twelve o'clock.
 */
function spiral(cells) {
  const [c0] = cells;
  const ang = (c) => {
    const a = Math.atan2(c.x - c0.x, -(c.y - c0.y));
    return a < 0 ? a + 2 * Math.PI : a;
  };
  return [c0, ...cells.slice(1).sort((a, b) => hexDist(a, c0) - hexDist(b, c0) || ang(a) - ang(b))];
}

/** What the layout depends on: each node's id, parent, kind, name and order. */
function shapeKey(nodes) {
  let k = '';
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (n && n.id != null) k += `${n.id}\u0001${n.parent ?? ''}\u0001${n.kind ?? ''}\u0001${n.label ?? ''}\u0001${n.order ?? ''}\u0002`;
  }
  return k;
}

/**
 * The tiles of the whole fleet laid on the grid for a free area of aspect
 * `A`: `{ tiles: [{node, dots, cell, region}], regions: [{site, cells}], W, H }`
 * in px, centred on (0, 0). The smallest grid (in rows, its columns from
 * the aspect) that holds every region wins: the largest tiles.
 */
export function mosaic(nodes, A = ASPECT, sizes = SIZES) {
  const { kids, center } = tree(nodes);
  const top = kids.get(center.id) ?? [];
  const sites = top.filter((n) => PLACE.has(n.kind));
  const seen = new Set([center.id, ...sites.map((n) => n.id)]);
  const groups = sites.map((site) => ({ site, tiles: tilesOf(site, kids, seen) }));
  // The hub: the core's tile, and what hangs on it that is no place (a run) as its dots.
  const hub = { site: center, hub: true, tiles: [{ node: center, dots: top.filter((n) => !PLACE.has(n.kind)), rank: 0 }] };
  groups.splice(Math.floor(groups.length / 2), 0, hub);
  const need = groups.map((g) => g.tiles.length);
  const s = sizes.hex;
  const total = need.reduce((a, b) => a + b, 0);
  for (let rows = Math.max(2, Math.floor(Math.sqrt(total / A))); rows < 200; rows++) {
    const gh = 1.5 * s * (rows - 1) + 2 * s;
    const cols = Math.max(2, Math.floor((gh * A) / (SQ3 * s) - 0.5));
    if (cols * rows < total * 1.15) continue;
    const gw = SQ3 * s * (cols + 0.5);
    // Each region weighs its tiles and the channel round it.
    const sl = slots(need.map((n) => n + 2 * Math.sqrt(n) + 2), gw, gh);
    const taken = grow(need, sl, cols, rows, s);
    if (!taken) continue;
    const tiles = [];
    const regions = [];
    groups.forEach((g, i) => {
      const cells = spiral(taken[i]);
      regions.push({ site: g.site, hub: Boolean(g.hub), cells });
      g.tiles.forEach((t, j) => tiles.push({ ...t, cell: cells[j], region: i }));
    });
    // Trimmed to the tiles drawn: an empty edge row is no use.
    const xs = tiles.map((t) => t.cell.x), ys = tiles.map((t) => t.cell.y);
    const x0 = Math.min(...xs) - (SQ3 * s) / 2, x1 = Math.max(...xs) + (SQ3 * s) / 2;
    const y0 = Math.min(...ys) - s, y1 = Math.max(...ys) + s;
    const dx = (x0 + x1) / 2, dy = (y0 + y1) / 2;
    for (const t of tiles) t.cell = { ...t.cell, x: t.cell.x - dx, y: t.cell.y - dy };
    return { tiles, regions, W: x1 - x0, H: y1 - y0, s };
  }
  return { tiles: [], regions: [], W: 0, H: 0, s };
}

/** A tile's tone: its worst status (its own or a dot's) as the Map draws it. */
function toneOf(t, byId) {
  let worst = null, rank = -1;
  for (const n of [t.node, ...t.dots]) {
    const cur = byId.get(n.id) ?? n;
    const st = statusStyle(cur);
    const k = st.tone === 'crit' ? 3 : st.tone === 'warn' ? 2 : st.tone === 'low' ? 1 : 0;
    if (k > rank) { rank = k; worst = st.tone; }
  }
  return rank > 0 ? worst : undefined;
}

/**
 * The mosaic layout for a screen of `aspect` (width / height), in the
 * shape of views/map/layout.js `layout` plus what polarLayout passes on:
 * `{ pos, center, kids, guides, bounds }`. Each tile is a guide polygon
 * (`pts`, its `tone` when in trouble); no branches; names below their marks.
 */
export function layoutFor(aspect = ASPECT, sizes = SIZES) {
  const A0 = Number.isFinite(aspect) && aspect > 0 ? aspect : ASPECT;
  // The free area's proportions: the screen less the safe area.
  const A = (A0 * (1 - 2 * SAFE.side)) / (1 - SAFE.top - SAFE.bottom);
  let memo = null;
  return function layout(nodes) {
    const { kids, center } = tree(nodes);
    const key = shapeKey(nodes);
    if (!memo || memo.key !== key) {
      const m = mosaic(nodes, A, sizes);
      const s = m.s;
      const pos = new Map();
      for (const t of m.tiles) {
        const { x, y } = t.cell;
        const site = PLACE.has(t.node.kind) || t.node.kind === 'core';
        pos.set(t.node.id, {
          x, y: y + s * (site && t.node.kind !== 'core' ? sizes.siteMark : sizes.mark),
          ring: t.node.kind === 'core' ? 0 : site ? 1 : 2, depth: site ? 1 : 2,
          branch: 'none', labelAngle: Math.PI / 2,
        });
        const across = Math.min(t.dots.length, sizes.perLine);
        t.dots.forEach((d, j) => {
          const line = Math.floor(j / sizes.perLine);
          pos.set(d.id, {
            x: x + ((j % sizes.perLine) - (across - 1) / 2) * sizes.dot,
            y: y + s * sizes.dots - line * sizes.dot,
            ring: 3, depth: 3, branch: 'none', labelAngle: -Math.PI / 2,
          });
        });
      }
      const pts = m.tiles.map((t) => hexCorners(t.cell.x, t.cell.y, s * sizes.tile));
      // The overview's view: the tiles plus the safe area, the camera below
      // the origin by what the bottom band takes more than the top.
      const by = m.H / 2 / (1 - SAFE.top - SAFE.bottom);
      const bounds = { x: m.W / 2 / (1 - 2 * SAFE.side), y: by, cy: (SAFE.bottom - SAFE.top) * by };
      memo = { key, m, pos, pts, bounds, tones: null, guides: null };
    }
    // The tiles' tones follow the statuses: new guides only when one changes.
    const byId = new Map((Array.isArray(nodes) ? nodes : []).filter((n) => n && n.id != null).map((n) => [n.id, n]));
    const tones = memo.m.tiles.map((t) => toneOf(t, byId));
    if (!memo.guides || tones.some((x, i) => x !== memo.tones[i])) {
      memo.tones = tones;
      memo.guides = memo.pts.map((p, i) => (tones[i] ? { pts: p, tone: tones[i] } : { pts: p }));
    }
    return { pos: memo.pos, center, kids, guides: memo.guides, bounds: memo.bounds };
  };
}

/** The layout for the tablet's aspect. */
export const layout = layoutFor(ASPECT);

/**
 * The radial direction's steps (sites big, rooms and builders one step
 * down), each name centred under its mark; a dot in trouble is named only
 * once the camera is in its site (at the overview its tile's colour says it).
 */
export function labelSize(node, ctx = {}) {
  const v = radialLabelSize(node, ctx);
  if (v && typeof v === 'object') return v.px;
  if (!NAMED.has(node?.kind) && node?.kind !== 'core' && !((ctx.s ?? 1) > IN_SITE)) return 0;
  return v;
}

/** The Map's options for a screen of `aspect`, next to the page's `ambient`. */
export function optionsFor(aspect = ASPECT) {
  return { layout: layoutFor(aspect), labelSize, rings: false };
}

/** What `createMap` takes for this direction at the tablet's aspect. */
export const mapOptions = Object.freeze(optionsFor(ASPECT));

/** The Map's ambient settings for this direction: no turn (a turning honeycomb leaves the screen). */
export const ambient = Object.freeze({ drift: 0 });
