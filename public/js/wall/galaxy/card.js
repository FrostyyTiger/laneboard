// The node card's place (Wall plan night 5 T17, README §7 Night 5 D1): a tapped
// planet or moon gets a card beside it, joined to it by a thin leader, instead
// of the left-hand sheet the plate used to become. The card stands beside the
// node, on the side away from the nearer screen edge first; it docks to the
// right edge when it fits on neither side or would cover a planet of the open
// system (the thing it describes stays in sight, research Q20); it never
// stands over the fleet line, the tag or the touch controls (`covers`).
// While the camera moves it keeps its side as long as that side still fits
// (no flip mid-flight, Q20's usual jitter source), and it is written only
// when its rounded place changes.
//
// `cardPlace` is pure (test/wall-galaxy-card.test.mjs). `createCard` is the
// DOM shell main.js puts under the stage: a labelled region with the node's
// status dot, name, kind and a 48 px ×; its pointers never reach the stage
// (touch.js listens there), so a press on it is neither a tap nor a turn.
// What the card says beyond its header (stats, the Below strip, actions)
// and its manners (fade, the dim, the ways it closes) are T18-T20's.

/**
 * The card's numbers, css px: `w` its width (`h` the height assumed until it
 * is measured), `gap` from the node's hit circle (`hitPx`, a finger's reach)
 * to the card, `edge` kept clear of the frame's edges, `pad` round every
 * cover and planet, `bodyPx` the least radius a planet counts with, `spot`
 * the leader's ring round the node.
 */
export const CARD = Object.freeze({ w: 360, h: 200, gap: 16, hitPx: 24, edge: 16, pad: 8, bodyPx: 10, spot: 14 });

import { toneOf } from './palette.js';

const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const rectAt = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const circleIn = (c, r, rect) => {
  const dx = c.x - clamp(c.x, rect.left, rect.right), dy = c.y - clamp(c.y, rect.top, rect.bottom);
  return dx * dx + dy * dy < r * r;
};

/**
 * Where the card goes. `at` the node's screen point `{ x, y, r }` (null when
 * it is not drawn), `size` the card's `{ w, h }`, `W`×`H` the stage, `covers`
 * the words and controls it keeps off (`{left, top, right, bottom}`), `bodies`
 * the open system's other planets and moons (`{ x, y, r }`), `prev` the side
 * it stood on last (kept while it fits), `ring` how far the node's own open
 * moons reach from it on screen (the card stands past them). Returns `{ side, x, y, w, h, leader }`:
 * `side` `right`, `left` or `dock`, `x`/`y` its top left (whole px), `leader`
 * `{ x1, y1, x2, y2 }` from the node's edge to the card's nearest edge (null
 * when the node is off the frame). Pure.
 */
export function cardPlace({ at = null, size = {}, W, H, covers = [], bodies = [], ring = 0, prev = null } = {}) {
  const o = CARD;
  const w = Math.min(size.w > 0 ? size.w : o.w, W - 2 * o.edge), h = Math.min(size.h > 0 ? size.h : o.h, H - 2 * o.edge);
  const pads = (covers ?? []).filter((c) => c && [c.left, c.top, c.right, c.bottom].every(Number.isFinite))
    .map((c) => ({ left: c.left - o.pad, top: c.top - o.pad, right: c.right + o.pad, bottom: c.bottom + o.pad }));
  const round = (bodies ?? []).filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y));
  const seen = at != null && Number.isFinite(at.x) && Number.isFinite(at.y) && at.x >= 0 && at.x <= W && at.y >= 0 && at.y <= H;
  const inside = (r) => r.left >= o.edge - 0.5 && r.top >= o.edge - 0.5 && r.right <= W - o.edge + 0.5 && r.bottom <= H - o.edge + 0.5;
  const clearOfWords = (r) => !pads.some((c) => overlaps(r, c));
  const clearOfBodies = (r) => !round.some((b) => circleIn(b, Math.max(b.r ?? 0, o.bodyPx) + o.pad, r));
  // The heights a card at `x` may stand at, nearest `want` first: centred on it, or just past a cover's or a planet's edge.
  const ys = (want) => {
    const lo = o.edge, hi = H - o.edge - h;
    const past = round.map((b) => ({ y: b.y, r: Math.max(b.r ?? 0, o.bodyPx) + o.pad + 1 }));
    const all = [want, ...pads.flatMap((c) => [c.bottom, c.top - h]), ...past.flatMap((b) => [b.y + b.r, b.y - b.r - h])]
      .map((y) => clamp(Math.round(y), lo, hi));
    return [...new Set(all)].sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
  };
  const standAt = (x, want, ok) => {
    for (const y of ys(want)) {
      const r = rectAt(x, y, w, h);
      if (inside(r) && ok(r)) return y;
    }
    return null;
  };
  let side = 'dock', x = Math.round(W - o.edge - w), y = null;
  if (seen) {
    const reach = Math.max(at.r ?? 0, o.hitPx, ring > 0 ? ring : 0) + o.gap;
    const xs = { right: Math.round(at.x + reach), left: Math.round(at.x - reach - w) };
    const away = at.x <= W / 2 ? ['right', 'left'] : ['left', 'right'];
    const order = prev === 'left' || prev === 'right' ? [prev, ...away.filter((s) => s !== prev)] : away;
    for (const s of order) {
      // Beside means level with it: the node's height stays within the card's (the leader runs across).
      const level = (r) => at.y >= r.top + o.spot && at.y <= r.bottom - o.spot;
      const at2 = standAt(xs[s], at.y - h / 2, (r) => level(r) && clearOfWords(r) && clearOfBodies(r));
      if (at2 != null) { side = s; x = xs[s]; y = at2; break; }
    }
  }
  if (side === 'dock') {
    const want = seen ? at.y - h / 2 : (H - h) / 2;
    // Docked it keeps off the words; of the heights that do, the one over the fewest planets.
    y = standAt(x, want, (r) => clearOfWords(r) && clearOfBodies(r));
    if (y == null) {
      let fewest = Infinity;
      for (const c of ys(want)) {
        const r = rectAt(x, c, w, h);
        if (!inside(r) || !clearOfWords(r)) continue;
        const n = round.filter((b) => circleIn(b, Math.max(b.r ?? 0, o.bodyPx) + o.pad, r)).length;
        if (n < fewest) { fewest = n; y = c; }
      }
    }
    if (y == null) y = clamp(Math.round((H - h) / 2), o.edge, H - o.edge - h);
  }
  let leader = null;
  if (seen) {
    const r = rectAt(x, y, w, h);
    const x2 = side === 'right' ? r.left : side === 'left' ? r.right : clamp(at.x, r.left, r.right);
    const y2 = clamp(at.y, r.top + o.spot, r.bottom - o.spot);
    const dx = x2 - at.x, dy = y2 - at.y, d = Math.hypot(dx, dy);
    const from = Math.min(o.spot, d);
    leader = d > 0 ? { x1: at.x + (dx / d) * from, y1: at.y + (dy / d) * from, x2, y2 } : null;
  }
  return { side, x, y, w, h, leader };
}

/** The card's box as a cover (`{left, top, right, bottom}`), or null. Pure. */
export function cardCover(place) {
  return place ? rectAt(place.x, place.y, place.w, place.h) : null;
}

/**
 * What the card's header says for member `id` of site `site` in `world`
 * (scene.js's): `{ id, site, name, kind, tone }`, null when it is not drawn.
 * Pure.
 */
export function cardInfo(world, site, id) {
  const m = world?.byId?.get(site)?.members?.find((x) => x.id === id);
  if (!m?.node) return null;
  return { id, site, name: m.node.label ?? id, kind: m.node.kind ?? 'node', tone: toneOf(m.node) };
}

/**
 * The open system's other planets and moons on screen, the bodies the card
 * keeps off (`{ x, y, r }`); none when the site is folded. Pure.
 */
export function cardBodies(world, site, id, screenOf) {
  const s = world?.byId?.get(site);
  if (!s || s.gone || !((s.open ?? 0) >= 0.5)) return [];
  const out = [];
  for (const m of s.members ?? []) {
    if (m.id === id) continue;
    const sp = screenOf(m.id);
    if (sp) out.push({ x: sp.x, y: sp.y, r: sp.r ?? 0 });
  }
  return out;
}

/**
 * How far planet `id`'s open ring reaches from it on screen (its moons'
 * centres plus their radius, css px), 0 for a moon or a folded ring. Pure.
 */
export function cardRing(world, site, id, screenOf) {
  const members = world?.byId?.get(site)?.members ?? [];
  const at = screenOf(id);
  if (!at) return 0;
  let reach = 0;
  for (const m of members) {
    if (!m.moon || !m.ringOpen || (m.moon.host?.id ?? m.moon.host) !== id) continue;
    const sp = screenOf(m.id);
    if (sp) reach = Math.max(reach, Math.hypot(sp.x - at.x, sp.y - at.y) + Math.max(sp.r ?? 0, CARD.bodyPx));
  }
  return reach;
}

/**
 * The card's DOM shell under `root` (the stage). `screenOf(id)` the node's
 * screen point, `size()` the stage's `{ W, H }`, `covers()` the boxes it keeps
 * off, `bodies(id)` the open system's other planets and moons, `ring(id)`
 * its own open ring's reach (cardRing), `onClose()`
 * when its × is pressed. `open({ id, name, kind, tone })`, `close()`,
 * `draw()` (each frame, after the camera), `shown()`, `selected()` (the id),
 * `cover()` (its box, for the names) and `place()` (the last cardPlace).
 */
export function createCard(root, opts = {}) {
  const o = { covers: () => [], bodies: () => [], ring: () => 0, onClose: () => {}, doc: globalThis.document, ...opts };
  const make = (tag, cls, text) => {
    const e = o.doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const card = make('section', 'galaxy-card');
  card.hidden = true;
  card.setAttribute('role', 'region');
  const head = make('div', 'galaxy-card-head');
  const dot = make('span', 'galaxy-card-dot');
  dot.setAttribute('aria-hidden', 'true');
  const name = make('span', 'galaxy-card-name');
  const kind = make('span', 'galaxy-card-kind');
  const x = make('button', 'galaxy-card-x', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close');
  head.append(dot, name, kind, x);
  card.append(head);
  // The leader: a 1 px span scaled along its length from its left end (as the lock's), and a ring on the node.
  const leader = make('span', 'galaxy-card-leader');
  const spot = make('span', 'galaxy-card-spot');
  for (const e of [leader, spot]) { e.hidden = true; e.setAttribute('aria-hidden', 'true'); }
  root.append(leader, spot, card);
  const keep = (ev) => ev.stopPropagation?.();
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    card.addEventListener(type, keep);
  }
  x.addEventListener('click', (ev) => { ev.stopPropagation?.(); o.onClose(); });

  let sel = null, measured = null, last = null, wrote = {};
  const put = (e, key, prop, v) => {
    if (wrote[key] === v) return;
    wrote[key] = v;
    e.style[prop] = v;
  };
  const show = (e, on) => { if (e.hidden === on) e.hidden = !on; };
  const close = () => {
    if (!sel) return;
    sel = null;
    last = null;
    show(card, false);
    show(leader, false);
    show(spot, false);
  };
  const open = (info) => {
    if (!info?.id) { close(); return; }
    const same = sel?.id === info.id;
    sel = { ...info };
    name.textContent = info.name ?? info.id;
    kind.textContent = String(info.kind ?? '').toUpperCase();
    card.dataset.kind = info.kind ?? '';
    card.dataset.tone = info.tone ?? 'calm';
    card.setAttribute('aria-label', `${info.name ?? info.id}, ${info.kind ?? 'node'}`);
    if (!same) last = null; // a new node: its side is chosen afresh
    show(card, true);
    measured = null; // its content changed: measured again on the next draw
    draw();
  };
  const draw = () => {
    if (!sel) return;
    if (!measured) {
      const w = card.offsetWidth, h = card.offsetHeight;
      measured = { w: w > 0 ? w : CARD.w, h: h > 0 ? h : CARD.h };
    }
    const { W, H } = o.size();
    const at = o.screenOf(sel.id);
    last = cardPlace({ at, size: measured, W, H, covers: o.covers(), bodies: o.bodies(sel.id), ring: o.ring(sel.id), prev: last?.side ?? null });
    card.dataset.side = last.side;
    put(card, 'card', 'transform', `translate(${last.x}px, ${last.y}px)`);
    const l = last.leader;
    show(leader, l != null);
    show(spot, l != null);
    if (!l) return;
    const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1), ang = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
    put(leader, 'leader', 'transform', `translate(${l.x1.toFixed(1)}px, ${l.y1.toFixed(1)}px) rotate(${ang.toFixed(4)}rad) scaleX(${len.toFixed(1)})`);
    put(spot, 'spot', 'transform', `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`);
  };
  return {
    open, close, draw,
    shown: () => sel != null,
    selected: () => sel?.id ?? null,
    cover: () => (sel && last ? cardCover(last) : null),
    place: () => last,
    el: card,
    leaderEl: leader,
  };
}
