// The `islands` direction (docs/plans/wall/README.md §5): each site its own
// island, the islands set across the wide screen in rows, and the links
// between sites the long arcs from one island to another (the Map's own
// cross-links, which bow toward the middle of the screen).
//
// An island is set like a paragraph in a lens: its rooms are words on rows
// that are long in the middle and short at the top and bottom, each room a
// mark with its name flush left under it, what it holds (services, a
// builder and its lanes) a row of dots to its right. A faint coastline (an
// ellipse) goes round the island and the site's name sits on it, at the
// top, in the place the line leaves for it. The site's own mark is a word
// in the middle row, so the camera that flies to it lands in the middle of
// its island. Inside an island there are no branches: what is close
// belongs together.
//
// Sizes are in CSS px at the overview: the layout fills the safe area of a
// 912 px high screen (the tablet, 1368 x 912) at scale 1, so a gap here is
// a gap on the glass and the names (set in px) take the room counted for
// them. A fleet too big for that fits smaller.
//
// Labels are the radial direction's steps (sites big, rooms one step
// down, services dots at the overview); the Map's rings are off and the
// coastlines are the layout's `guides`. No turn: islands that turn leave
// the screen.
//
// Pure: no DOM, so test/wall-islands.test.mjs imports it directly.

import { labelSize as radialLabelSize, STEPS } from './radial.js';

/** The tablet's 2736 x 1824: what the layout stretches to when nobody says. */
export const ASPECT = 3 / 2;

/** The screen height (CSS px) the sizes are counted for. */
export const REF_H = 912;

/**
 * The share of the screen kept clear at each edge: T17's safe area (6 %
 * left and right), at the top 12 % (T17 asks 8 %; the frame's tag, top
 * right, reaches 11 % and an island's name there ran into it), and at the
 * bottom the band the frame's clock and fleet line sit in (T9).
 */
export const SAFE = Object.freeze({ side: 0.06, top: 0.12, bottom: 0.2 });

/**
 * Sizes in px. `mark` a room's outermost ring (gauges included), `below`
 * what its name takes under its centre (the Map sets it R + 6 + half a
 * line down), `lamps` the line of lamps under a builder's name, `dot` the step of the dots beside it and `dotX` where they
 * start, `perLine` dots before they wrap upward, `named` the name above a
 * named dot (a lane in trouble), `line` the step to the next such name, `word` the space after a room, `lead` between
 * rows, `site` the site mark's word, `coast` the air inside the coastline,
 * `title` half the site name's line (it sits on the coastline), `gap`
 * between islands.
 */
export const SIZES = Object.freeze({
  mark: 15, below: 50, lamps: 14, dot: 10, dotX: 24, perLine: 8, named: 30, line: 14,
  word: 14, lead: 4, site: 40, coast: 8, title: 16, gap: 18,
});

const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const PLACE = new Set(['site', 'host']);
/** What may be in trouble under a builder and is then named above its dot. */
const LOUD_KINDS = new Set(['lane', 'session', 'run']);

/**
 * A name's width at the room step: the label face is condensed, a caps
 * character takes about 0.44 em (`OFFICE-PRINTER` measures 97 px at 15 px
 * on the tablet), plus the Map's tracking.
 */
const nameW = (n) => String(n?.label ?? n?.id ?? '').length * (0.44 * STEPS.room + Math.max(1, Math.round(STEPS.room * 0.06)));

/** A site's name width at the site step (the same condensed face). */
const siteNameW = (n) => String(n?.label ?? n?.id ?? '').length * (0.44 * STEPS.site + Math.max(1, Math.round(STEPS.site * 0.06)));

/** The proportions an island is set to: wider than tall, as the screen is. */
const ISLE_ASPECT = 2;

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
 * The words for `n` and what it holds: `n` with the unnamed things under it
 * as its dots (depth first), then each named thing under it (a builder in a
 * room) as a word of its own, right after it.
 */
function wordsOf(n, kids, seen, sizes, out) {
  const dots = [];
  const named = [];
  const walk = (p) => {
    for (const c of kids.get(p.id) ?? []) {
      if (seen.has(c.id)) continue; // a parent cycle in bad data
      seen.add(c.id);
      if (NAMED.has(c.kind)) { named.push(c); continue; }
      dots.push(c);
      walk(c);
    }
  };
  walk(n);
  const lines = Math.ceil(dots.length / sizes.perLine);
  const across = Math.min(dots.length, sizes.perLine);
  // A lane in trouble is named above its dot, the names of neighbouring
  // dots a line apart: room for up to three of those lines.
  const loud = Math.min(3, dots.filter((d) => LOUD_KINDS.has(d.kind)).length);
  const w = Math.max(nameW(n), dots.length ? sizes.dotX + (across - 0.5) * sizes.dot : 0) + sizes.mark + sizes.word;
  const up = Math.max(sizes.mark, lines ? 6 + (lines - 1) * sizes.dot : 0) + (loud ? sizes.named + (loud - 1) * sizes.line : 0);
  // A builder's name carries its lamps on a second line.
  const down = sizes.below + (n.kind === 'builder' ? sizes.lamps : 0);
  out.push({ node: n, dots, w, up, down });
  for (const c of named) wordsOf(c, kids, seen, sizes, out);
  return out;
}

/**
 * The words of an island: one per child of `site` and per named thing
 * under it (each with its dots after it), and the site's own mark in the
 * middle. A word is `{node, dots, w, up}`: `w` the width it takes with the
 * space after it, `up` how far it reaches above its centre.
 */
function words(site, kids, sizes) {
  const seen = new Set([site.id]);
  const list = [];
  for (const c of kids.get(site.id) ?? []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    wordsOf(c, kids, seen, sizes, list);
  }
  const mid = Math.floor(list.length / 2);
  list.splice(mid, 0, { node: site, dots: [], w: sizes.site, up: sizes.mark, down: sizes.below, site: true });
  return list;
}

/** Fills rows of max lengths `lens(r)` with `ws` in order; the rows, or null when they do not hold them. */
function fill(ws, R, lens) {
  const rows = Array.from({ length: R }, () => []);
  let r = 0, used = 0;
  for (const w of ws) {
    while (r < R && rows[r].length && used + w.w > lens(r)) { r++; used = 0; }
    if (r >= R) return null;
    rows[r].push(w);
    used += w.w;
  }
  return rows;
}

/**
 * One island around its site, in px with the site's mark at (0, 0) give or
 * take: `{ site, rows, place: Map id -> {x, y, dot, of}, coast: {x, y, rx, ry}, box: {x0, y0, x1, y1} }`.
 * Rows are tried from one to many; each takes the narrowest lens that holds
 * the words, and the island with the smallest coastline wins.
 */
export function island(site, kids, sizes = SIZES) {
  const ws = words(site, kids, sizes);
  const total = ws.reduce((s, w) => s + w.w, 0);
  const widest = Math.max(...ws.map((w) => w.w));
  let best = null;
  for (let R = 1; R <= Math.max(1, ws.length); R++) {
    // Row r's length on a lens of half width a: long in the middle, short at the ends.
    const lens = (a) => (r) => {
      const t = (2 * r + 1) / R - 1;
      return Math.max(widest, 2 * a * Math.sqrt(Math.max(0, 1 - t * t)));
    };
    let lo = widest / 2, hi = total;
    if (!fill(ws, R, lens(hi))) continue;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (fill(ws, R, lens(mid))) hi = mid; else lo = mid;
    }
    const rows = fill(ws, R, lens(hi)).filter((row) => row.length);
    const cand = setRows(site, rows, sizes);
    // The smallest coastline, a shape far from the screen's proportions counted larger.
    cand.cost = cand.coast.rx * cand.coast.ry * (1 + 0.5 * Math.abs(Math.log(cand.coast.rx / cand.coast.ry / ISLE_ASPECT)));
    if (!best || cand.cost < best.cost) best = cand;
    if (rows.length < R) break; // more rows would stay empty
  }
  return best;
}

/** Sets `rows` of words: each centred, the rows one under the other, the coastline round them. */
function setRows(site, rows, sizes) {
  const place = new Map();
  const boxes = [];
  let y = 0;
  let siteAt = { x: 0, y: 0 };
  rows.forEach((row, i) => {
    const up = Math.max(...row.map((w) => w.up));
    const down = Math.max(...row.map((w) => w.down));
    if (i > 0) y += up;
    const len = row.reduce((s, w) => s + w.w, 0) - sizes.word;
    let x = -len / 2;
    for (const w of row) {
      const cx = x + sizes.mark;
      place.set(w.node.id, { x: cx, y, word: true });
      if (w.site) siteAt = { x: cx, y };
      w.dots.forEach((d, j) => {
        const line = Math.floor(j / sizes.perLine);
        place.set(d.id, {
          x: cx + sizes.dotX + (j % sizes.perLine) * sizes.dot,
          y: y - line * sizes.dot, dot: true, of: w.node.id, kind: d.kind,
        });
      });
      boxes.push({ x0: x, x1: x + w.w - sizes.word, y0: y - up, y1: y + down });
      x += w.w;
    }
    y += down + sizes.lead;
  });
  // Around the site's mark: the camera lands on it.
  for (const p of place.values()) { p.x -= siteAt.x; p.y -= siteAt.y; }
  for (const b of boxes) { b.x0 -= siteAt.x; b.x1 -= siteAt.x; b.y0 -= siteAt.y; b.y1 -= siteAt.y; }
  const x0 = Math.min(...boxes.map((b) => b.x0)), x1 = Math.max(...boxes.map((b) => b.x1));
  const y0 = Math.min(...boxes.map((b) => b.y0)), y1 = Math.max(...boxes.map((b) => b.y1));
  // The coastline: of the ellipses through the farthest corner, near the
  // words' own proportions, the smallest, plus air.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const q0 = Math.max(1, (x1 - x0)) / Math.max(1, (y1 - y0));
  let coast = null;
  for (let f = 0.6; f <= 1.8001; f += 0.05) {
    const q = q0 * f;
    let r = 0;
    for (const b of boxes) {
      for (const [px, py] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
        r = Math.max(r, Math.hypot((px - cx) / q, py - cy));
      }
    }
    const c = { x: cx, y: cy, rx: q * r + sizes.coast, ry: r + sizes.coast };
    if (!coast || c.rx * c.ry < coast.rx * coast.ry) coast = c;
  }
  const box = { x0: cx - coast.rx, x1: cx + coast.rx, y0: cy - coast.ry - sizes.title, y1: cy + coast.ry };
  return { site, rows, place, coast, box };
}

/**
 * The hub (the core, and what hangs on it that is no place, a run) as a
 * small island of its own, no coastline: its mark and a row of dots.
 */
function hubIsland(center, inner, sizes) {
  const place = new Map([[center.id, { x: 0, y: 0, word: true }]]);
  inner.forEach((n, j) => place.set(n.id, { x: sizes.dotX + 6 + j * 2 * sizes.dot, y: 0, dot: true, of: center.id, kind: n.kind, run: true }));
  const x1 = inner.length ? sizes.dotX + 6 + (inner.length - 1) * 2 * sizes.dot + sizes.mark : sizes.mark;
  return { site: center, hub: true, place, coast: null, box: { x0: -sizes.mark - 4, x1: x1 + 4, y0: -sizes.mark - 4, y1: sizes.mark + 4 } };
}

const wOf = (b) => b.x1 - b.x0;
const hOf = (b) => b.y1 - b.y0;

/**
 * An island's outline for keeping islands apart, in its own coordinates:
 * its coastline (the hub: a circle round its box) and the site name's
 * line on top of it (`title`, a box, or null).
 */
export function shapeOf(isle, sizes = SIZES) {
  const b = isle.box;
  if (!isle.coast) {
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, rx: wOf(b) / 2, ry: hOf(b) / 2, title: null, box: b };
  }
  const c = isle.coast;
  const tw = (siteNameW(isle.site) + 16) / 2;
  return {
    x: c.x, y: c.y, rx: c.rx, ry: c.ry, box: b,
    title: { x0: c.x - tw, x1: c.x + tw, y0: c.y - c.ry - sizes.title, y1: c.y - c.ry + sizes.title },
  };
}

const SAMPLES = Array.from({ length: 40 }, (_, i) => [Math.cos((i / 40) * Math.PI * 2), Math.sin((i / 40) * Math.PI * 2)]);
const inEllipse = (px, py, e, ox, oy, pad) => ((px - ox - e.x) / (e.rx + pad)) ** 2 + ((py - oy - e.y) / (e.ry + pad)) ** 2 < 1;
const corners = (t) => [[t.x0, t.y0], [t.x1, t.y0], [t.x0, t.y1], [t.x1, t.y1], [(t.x0 + t.x1) / 2, t.y0], [(t.x0 + t.x1) / 2, t.y1]];

/**
 * Whether outlines `a` at offset `oa` and `b` at `ob` keep `gap` apart: no
 * point of either coastline (grown by half the gap) inside the other's, no
 * name's line inside the other coastline or on the other name.
 */
export function clearOf(a, oa, b, ob, gap = SIZES.gap) {
  // Far apart by their boxes: clear without looking closer.
  if (oa.x + a.box.x1 + gap <= ob.x + b.box.x0 || ob.x + b.box.x1 + gap <= oa.x + a.box.x0
    || oa.y + a.box.y1 + gap <= ob.y + b.box.y0 || ob.y + b.box.y1 + gap <= oa.y + a.box.y0) return true;
  const h = gap / 2;
  for (const [c, s] of SAMPLES) {
    if (inEllipse(oa.x + a.x + c * (a.rx + h), oa.y + a.y + s * (a.ry + h), b, ob.x, ob.y, h)) return false;
    if (inEllipse(ob.x + b.x + c * (b.rx + h), ob.y + b.y + s * (b.ry + h), a, oa.x, oa.y, h)) return false;
  }
  for (const [p, q, oq, op] of [[a, b, ob, oa], [b, a, oa, ob]]) {
    if (!p.title) continue;
    for (const [x, y] of corners(p.title)) if (inEllipse(op.x + x, op.y + y, q, oq.x, oq.y, gap)) return false;
    const t = q.title;
    if (t && op.x + p.title.x0 < oq.x + t.x1 + gap && oq.x + t.x0 < op.x + p.title.x1 + gap
      && op.y + p.title.y0 < oq.y + t.y1 + gap && oq.y + t.y0 < op.y + p.title.y1 + gap) return false;
  }
  return true;
}

/**
 * Islands in rows across width `W`: each row's islands spread from edge to
 * edge (a lone one in the middle), centred on the row's line; the first
 * row's tops at 0, each next row as high as it goes with every island
 * clear of those above (the islands are ellipses: a row tucks into the
 * corners of the one above). Returns `{ at: [{x, y}], H }`.
 */
function setIslands(shapes, rows, rw, W, sizes) {
  const at = new Array(shapes.length);
  const placed = [];
  let bottom = 0;
  rows.forEach(([a, b], i) => {
    const row = shapes.slice(a, b);
    const spare = W - rw[i];
    const step = row.length > 1 ? spare / (row.length - 1) : 0;
    let x = -W / 2 + (row.length > 1 ? 0 : spare / 2);
    const xs = row.map((sh) => { const o = x - sh.box.x0; x += wOf(sh.box) + sizes.gap + step; return o; });
    const half = Math.max(...row.map((sh) => hOf(sh.box))) / 2;
    // The row's line: each island's box centred on it.
    const put = (line) => row.map((sh, j) => ({ x: xs[j], y: line - (sh.box.y0 + sh.box.y1) / 2 }));
    let line = half;
    if (i > 0) {
      const fits = (l) => put(l).every((o, j) => placed.every((p) => clearOf(row[j], o, p.sh, p.o, sizes.gap)));
      let lo = placed.reduce((m, p) => Math.max(m, p.o.y + (p.sh.box.y0 + p.sh.box.y1) / 2), 0);
      let hi = bottom + sizes.gap + half;
      if (fits(lo)) hi = lo;
      for (let k = 0; k < 18 && hi - lo > 0.5; k++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid; else lo = mid;
      }
      line = hi;
    }
    put(line).forEach((o, j) => {
      at[a + j] = o;
      placed.push({ sh: row[j], o });
      bottom = Math.max(bottom, o.y + row[j].box.y1);
    });
  });
  return { at, H: bottom };
}

/**
 * Where the islands go: in rows, in model order, each row from the left to
 * the right edge of the free area, the rows tucked under each other and
 * spread over its height. Of every way to break the order into one to
 * three rows, the one that fits the free area (`fw` x `fh`) at the largest
 * scale wins. `shapes` are shapeOf's. Returns `{ scale, W, H, at: [{x, y}] }`:
 * each island's offset (its own origin) in an area `W` x `H` centred on
 * (0, 0), the free area or, when the islands need more, larger.
 */
export function arrange(shapes, fw, fh, sizes = SIZES) {
  const n = shapes.length;
  if (!n) return { scale: 1, W: fw, H: fh, at: [] };
  const splits = [];
  const walk = (from, cut) => {
    if (cut.length > 3) return;
    if (from === n) { splits.push(cut); return; }
    for (let to = from + 1; to <= n; to++) walk(to, [...cut, [from, to]]);
  };
  walk(0, []);
  let best = null;
  for (const rows of splits) {
    const rw = rows.map(([a, b]) => shapes.slice(a, b).reduce((s, x) => s + wOf(x.box), 0) + (b - a - 1) * sizes.gap);
    const need = Math.max(...rw);
    // The width the rows spread over depends on the scale and the scale on
    // the height that spreading leaves: a few rounds settle it.
    let W = Math.max(need, fw), set = null, scale = 1;
    for (let k = 0; k < 3; k++) {
      set = setIslands(shapes, rows, rw, W, sizes);
      scale = Math.min(fw / W, fh / set.H, fw / need);
      const next = Math.max(need, fw / Math.min(1, scale));
      if (Math.abs(next - W) < 1) break;
      W = next;
    }
    const even = Math.min(...rw) / need;
    if (!best || scale > best.scale * 1.02 || (scale > best.scale * 0.98 && even > best.even)) best = { scale, rows, W, set, even };
  }
  const k = Math.min(1, best.scale);
  const W = best.W, H = Math.max(best.set.H, fh / k);
  // What height is left goes between the rows (all of it round a lone row).
  const nr = best.rows.length;
  const spare = H - best.set.H;
  const at = best.set.at.map((o, i) => {
    const r = best.rows.findIndex(([a, b]) => i >= a && i < b);
    const dy = nr > 1 ? (spare * r) / (nr - 1) : spare / 2;
    return { x: o.x, y: o.y - H / 2 + dy };
  });
  return { scale: best.scale, W, H, at };
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
 * The islands layout for a screen of `aspect` (width / height), in the
 * shape of views/map/layout.js `layout` plus what polarLayout passes on:
 * `{ pos, center, kids, guides, bounds }`. No branches inside an island
 * (`branch: 'none'`); each room's name flush left under it
 * (`labelAngle` straight down), a dot's name above it, the site's name on
 * its coastline (`labelAt`).
 */
export function layoutFor(aspect = ASPECT, sizes = SIZES) {
  const A = Number.isFinite(aspect) && aspect > 0 ? aspect : ASPECT;
  // The search runs again only when the tree or a name changes, not on
  // every model frame (a status is no reason to move an island).
  let memo = null;
  return function layout(nodes) {
    const { kids, center } = tree(nodes);
    const key = shapeKey(nodes);
    if (memo && memo.key === key) return { pos: memo.pos, center, kids, guides: memo.guides, bounds: memo.bounds };
    const top = kids.get(center.id) ?? [];
    const sites = top.filter((n) => PLACE.has(n.kind));
    const inner = top.filter((n) => !PLACE.has(n.kind));
    const isles = sites.map((s) => island(s, kids, sizes));
    // The hub sits among the islands, in the middle of the order.
    isles.splice(Math.floor(isles.length / 2), 0, hubIsland(center, inner, sizes));
    const fh = REF_H * (1 - SAFE.top - SAFE.bottom);
    const fw = REF_H * A * (1 - 2 * SAFE.side);
    const { W, H, at } = arrange(isles.map((i) => shapeOf(i, sizes)), fw, fh, sizes);
    const pos = new Map();
    const guides = [];
    isles.forEach((isle, i) => {
      const o = at[i];
      const id = isle.site.id;
      for (const [nid, p] of isle.place) {
        const x = o.x + p.x, y = o.y + p.y;
        if (nid === id) {
          pos.set(nid, {
            x, y, ring: isle.hub ? 0 : 1, depth: isle.hub ? 0 : 1, branch: 'none', labelAngle: -Math.PI / 2,
            ...(isle.coast ? { labelAt: { x: o.x + isle.coast.x, y: o.y + isle.coast.y - isle.coast.ry } } : {}),
          });
        } else if (p.dot) {
          pos.set(nid, { x, y, ring: p.run ? 1 : 3, depth: p.run ? 1 : 3, branch: 'none', labelAngle: -Math.PI / 2 });
        } else {
          pos.set(nid, { x, y, ring: 2, depth: 2, branch: 'none', labelAngle: Math.PI / 2 });
        }
      }
      if (isle.coast) guides.push({ x: o.x + isle.coast.x, y: o.y + isle.coast.y, rx: isle.coast.rx, ry: isle.coast.ry });
    });
    // The overview's view: the free area plus the safe area, the camera
    // below the origin by what the bottom band takes more than the top.
    const y = H / 2 / (1 - SAFE.top - SAFE.bottom);
    const bounds = { x: W / 2 / (1 - 2 * SAFE.side), y, cy: (SAFE.bottom - SAFE.top) * y };
    memo = { key, pos, guides, bounds };
    return { pos, center, kids, guides, bounds };
  };
}

/** The layout for the tablet's aspect. */
export const layout = layoutFor(ASPECT);

/**
 * The radial direction's steps, with every place's name on its coastline
 * (the hub's grouping `__repos` too, at the room step).
 */
export function labelSize(node, ctx = {}) {
  const v = radialLabelSize(node, ctx);
  if (PLACE.has(node?.kind) && typeof v === 'number' && v > 0) return { px: v, inward: true };
  return v;
}

/** The Map's options for a screen of `aspect`, next to the page's `ambient`. */
export function optionsFor(aspect = ASPECT) {
  return { layout: layoutFor(aspect), labelSize, rings: false };
}

/** What `createMap` takes for this direction at the tablet's aspect. */
export const mapOptions = Object.freeze(optionsFor(ASPECT));

/** The Map's ambient settings for this direction: no turn. */
export const ambient = Object.freeze({ drift: 0 });
