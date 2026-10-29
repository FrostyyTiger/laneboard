// The node card's place (Wall plan night 5 T17, README §7 Night 5 D1): a tapped
// planet or moon gets a card beside it, joined to it by a thin leader, instead
// of the left-hand sheet the plate used to become. The card stands beside the
// node, level with it and past its open ring of moons, on the side away from
// the nearer screen edge first; it comes as the camera lands; it docks to the
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
// What it says (T18, README §7 Night 5 D2) is `describe`'s, pure: the
// header, the parent path, the node's status word and why, the problems
// below it by name (r40-stranger #3: the sheet's words must not be lost),
// 3-4 key stats where only the off value takes a hue, and a Below strip of
// child chips (a tap selects that node and flies there, `onPick`). Its
// actions and its manners (fade, the dim, the ways it closes) are T19-T20's.

/**
 * The card's numbers, css px: `w` its width (`h` the height assumed until it
 * is measured), `gap` from the node's hit circle (`hitPx`, a finger's reach)
 * to the card, `edge` kept clear of the frame's edges, `pad` round every
 * cover and planet, `bodyPx` the least radius a planet counts with, `spot`
 * the leader's ring round the node.
 */
export const CARD = Object.freeze({ w: 360, h: 200, gap: 24, hitPx: 24, edge: 16, pad: 8, bodyPx: 10, spot: 14 });

import { GLYPH } from '../caption.js';
import { SEVERITY, TROUBLE } from '../../views/map/model.js';
import { statusStyle } from '../../views/map/overlays.js';
import { toneOf, worseTone } from './palette.js';

/**
 * What the card holds at most: `stats` key numbers, `problems` named below
 * the status line (the plate's three, NAMED_PROBLEMS), `below` child chips
 * before a `+N`.
 */
export const CARD_SAYS = Object.freeze({ stats: 4, problems: 3, below: 6 });

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
  const hits = (list, r) => list.filter((b) => circleIn(b, Math.max(b.r ?? 0, o.bodyPx) + o.pad, r)).length;
  // The heights a card at `x` may stand at, nearest `want` first: centred on it, or just past a cover's or a body's edge.
  const ys = (want, list) => {
    const lo = o.edge, hi = H - o.edge - h;
    const past = list.map((b) => ({ y: b.y, r: Math.max(b.r ?? 0, o.bodyPx) + o.pad + 1 }));
    const all = [want, ...pads.flatMap((c) => [c.bottom, c.top - h]), ...past.flatMap((b) => [b.y + b.r, b.y - b.r - h])]
      .map((y) => clamp(Math.round(y), lo, hi));
    return [...new Set(all)].sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
  };
  const standAt = (x, want, list, ok) => {
    for (const y of ys(want, list)) {
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
      const at2 = standAt(xs[s], at.y - h / 2, round, (r) => level(r) && clearOfWords(r) && !hits(round, r));
      if (at2 != null) { side = s; x = xs[s]; y = at2; break; }
    }
  }
  if (side === 'dock') {
    const want = seen ? at.y - h / 2 : (H - h) / 2;
    // Docked it never covers its own node (T18: a taller card docked over a moon, its leader gone), then keeps off
    // the words; of the heights that do, the one over the fewest planets. The right edge first, else the left.
    const self = seen ? [{ x: at.x, y: at.y, r: Math.max(at.r ?? 0, o.hitPx) }] : [];
    const list = [...round, ...self];
    const edges = [x, Math.round(o.edge)];
    let best = null;
    for (const ex of edges) {
      const c = standAt(ex, want, list, (r) => clearOfWords(r) && !hits(list, r));
      if (c != null) { best = { x: ex, y: c }; break; }
    }
    if (!best) {
      let fewest = Infinity;
      for (const ex of edges) {
        for (const c of ys(want, list)) {
          const r = rectAt(ex, c, w, h);
          if (!inside(r) || !clearOfWords(r)) continue;
          const n = hits(self, r) * 1000 + hits(round, r);
          if (n < fewest) { fewest = n; best = { x: ex, y: c }; }
        }
      }
    }
    if (best) ({ x, y } = best);
    else y = clamp(Math.round((H - h) / 2), o.edge, H - o.edge - h);
  }
  let leader = null;
  if (seen) {
    const r = rectAt(x, y, w, h);
    // Docked above or below its node, the leader meets the card's near edge, not its inside.
    const over = side === 'dock' && at.x > r.left && at.x < r.right;
    const x2 = side === 'right' ? r.left : side === 'left' ? r.right : over ? at.x : at.x < r.left ? r.left : r.right;
    const y2 = over ? (at.y < r.top ? r.top : r.bottom) : clamp(at.y, r.top + o.spot, r.bottom - o.spot);
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

const KIND_WORD = { site: 'SITE', host: 'HOST', room: 'ROOM', builder: 'BUILDER', service: 'SERVICE', lane: 'LANE', session: 'SESSION' };
const pct = (v) => `${Math.round(v * 100)}%`;
// A load is off at 85 % (warn) and at 95 % (crit); below that it has no hue.
const loadTone = (v) => (v >= 0.95 ? 'crit' : v >= 0.85 ? 'warn' : null);
const rank = (status) => SEVERITY.indexOf(status);
const word = (s) => String(s ?? 'unknown').toUpperCase();
const ago = (ms) => (ms >= 86_400_000 ? `${Math.floor(ms / 86_400_000)}d` : ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h` : `${Math.max(1, Math.floor(ms / 60_000))}m`);

/**
 * What the card says about `sel` (`{ id, site }`, a site or one of its
 * members) in `world` (scene.js's): `{ id, site, name, kind, tone, chip,
 * path, status, problems, more, stats, below, belowMore }`, null when it is
 * not drawn. `tone` the dot's, the worse of its own and the worst below it;
 * `chip` the kind word (`ROOM · 101` with a Proxmox id); `path` its parents
 * from the site down (`hv1 › vm-a`, null for a site); `status` `{ word,
 * text, tone }` its own status word and why (or what it is); `problems` the
 * troubles below it, worst first, one per problem (a lane and its waiting
 * session are one, as the plate counts them), each `{ id, glyph, tone, word,
 * text }` (`word` its status, `text` `NAME · why`), at most
 * CARD_SAYS.problems, `more` how many are not named; `stats` at most
 * CARD_SAYS.stats `{ label, value, tone }` from the model, `tone` null
 * unless the value is off; `below` its children as chips `{ id, label, tone }`,
 * worst first (each by the worst in it), `belowMore` the ones past
 * CARD_SAYS.below. Pure.
 */
export function describe(sel, world) {
  const site = world?.byId?.get(sel?.site);
  if (!site?.node || sel?.id == null) return null;
  const isSite = sel.id === site.id;
  const node = isSite ? site.node : site.members?.find((m) => m.id === sel.id)?.node;
  if (!node) return null;
  const nodes = [site.node, ...(site.members ?? []).map((m) => m.node).filter((n) => n && n.id != null)];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of nodes) {
    if (n === site.node) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  const under = (id) => {
    const out = [];
    const walk = (p, k) => { for (const c of kids.get(p) ?? []) { out.push(c); if (k < 50) walk(c.id, k + 1); } };
    walk(id, 0);
    return out;
  };
  const bad = (n) => Boolean(n) && TROUBLE.includes(n.status);
  const worstIn = (n) => under(n.id).reduce((w, c) => (rank(c.status) > rank(w) ? c.status : w), n.status);

  // The problems below it, as the plate counts them: a node in trouble whose parent (below this one) is not.
  const roots = under(node.id).filter((u) => bad(u) && !(u.parent !== node.id && bad(byId.get(u.parent))));
  const problems = roots.map((root, i) => {
    const worst = [root, ...under(root.id)].reduce((w, c) => (bad(c) && rank(c.status) > rank(w.status) ? c : w), root);
    return { root, worst, i };
  }).sort((a, b) => rank(b.worst.status) - rank(a.worst.status) || a.i - b.i).map(({ worst }) => {
    const st = statusStyle(worst);
    const why = worst.why ?? worst.sub;
    return {
      id: worst.id, glyph: GLYPH[st.shape] ?? GLYPH.square, tone: toneOf(worst), word: word(worst.status),
      text: [String(worst.label ?? worst.id).toUpperCase(), why].filter(Boolean).join(' · '),
    };
  });
  const own = toneOf(node);
  const tone = problems.reduce((t, p) => worseTone(t, p.tone), own);

  const path = [];
  if (!isSite) {
    const seen = new Set();
    for (let p = byId.get(node.parent); p && !seen.has(p.id); p = byId.get(p.parent)) {
      seen.add(p.id);
      path.unshift(p.label ?? p.id);
      if (p === site.node) break;
    }
  }

  const stats = [];
  const add = (label, value, t = null) => { if (stats.length < CARD_SAYS.stats) stats.push({ label, value: String(value), tone: t }); };
  const direct = kids.get(node.id) ?? [];
  if (isSite) {
    const rooms = direct.filter((n) => n.kind === 'room' || n.kind === 'host');
    const up = rooms.filter((n) => n.status !== 'down').length;
    if (rooms.length) add('rooms up', `${up}/${rooms.length}`, up < rooms.length ? 'crit' : null);
  }
  if (node.counts && typeof node.counts === 'object') {
    const c = node.counts;
    if (Number.isFinite(c.lanes)) add('lanes', c.lanes);
    if (c.waiting > 0) add('waiting', c.waiting, toneOf('attention'));
    else if (Number.isFinite(c.working)) add('working', c.working);
  }
  const met = node.metrics && typeof node.metrics === 'object' ? node.metrics : {};
  for (const k of ['cpu', 'mem', 'disk']) if (Number.isFinite(met[k])) add(k, pct(met[k]), loadTone(met[k]));
  const m = node.m && typeof node.m === 'object' ? node.m : {};
  if (Number.isFinite(m.costUsd)) add('cost', `$${m.costUsd.toFixed(2)}`);
  if (Number.isFinite(m.ctxPct)) add('context', `${Math.round(m.ctxPct)}%`, m.ctxPct >= 85 ? 'warn' : null);
  if (Number.isFinite(m.ageMs)) add('age', ago(m.ageMs));
  const detail = node.detail && typeof node.detail === 'object' && !Array.isArray(node.detail) ? node.detail : {};
  for (const [k, v] of Object.entries(detail)) {
    if (k === 'ID' || !(typeof v === 'string' ? v.trim() : Number.isFinite(v))) continue;
    add(k.toLowerCase(), v);
  }

  const chips = direct.map((n, i) => ({ id: n.id, label: n.label ?? n.id, status: worstIn(n), i }))
    .map((c) => ({ ...c, off: bad(c) }))
    // Trouble first, worst first; the calm ones keep the model's order.
    .sort((a, b) => (b.off - a.off) || (a.off ? rank(b.status) - rank(a.status) : 0) || a.i - b.i);
  const kind = isSite ? 'site' : node.kind ?? 'node';
  const id = detail.ID != null && String(detail.ID).trim() ? String(detail.ID) : null;
  return {
    id: sel.id, site: site.id, name: node.label ?? sel.id, kind, tone,
    chip: [KIND_WORD[kind] ?? word(kind), id].filter(Boolean).join(' · '),
    path: path.length ? path.join(' › ') : null,
    status: { word: word(node.status), text: node.why ?? node.sub ?? null, tone: own },
    problems: problems.slice(0, CARD_SAYS.problems),
    more: Math.max(0, problems.length - CARD_SAYS.problems),
    stats,
    below: chips.slice(0, CARD_SAYS.below).map((c) => ({ id: c.id, label: c.label, tone: toneOf(c.status) })),
    belowMore: Math.max(0, chips.length - CARD_SAYS.below),
  };
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
 * when its × is pressed, `onPick(id)` when a Below chip is (select it, fly
 * there). `open(info)` (`describe`'s, or a bare `{ id, name, kind, tone }`), `close()`,
 * `flying()` true while the camera flies (a new card waits for the landing),
 * `draw()` (each frame, after the camera), `shown()`, `selected()` (the id),
 * `cover()` (its box, for the names) and `place()` (the last cardPlace).
 */
export function createCard(root, opts = {}) {
  const o = { covers: () => [], bodies: () => [], ring: () => 0, flying: () => false, onClose: () => {}, onPick: () => {}, doc: globalThis.document, ...opts };
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
  // What it says below the header (T18): rebuilt on each open, from `describe`.
  const body = make('div', 'galaxy-card-body');
  card.append(head, body);
  const toned = (e, tone) => { if (tone && tone !== 'calm') e.dataset.tone = tone; return e; };
  const label = (text) => make('span', 'galaxy-card-label', text);
  const say = (info) => {
    body.textContent = '';
    if (info.path) body.append(make('div', 'galaxy-card-path', info.path));
    if (info.status) {
      const row = make('div', 'galaxy-card-status');
      row.append(toned(make('span', 'galaxy-card-word', info.status.word), info.status.tone));
      if (info.status.text) row.append(make('span', 'galaxy-card-why', info.status.text));
      body.append(row);
    }
    if (info.problems?.length) {
      const list = make('div', 'galaxy-card-problems');
      for (const p of info.problems) {
        const row = toned(make('div', 'galaxy-card-problem'), p.tone);
        const glyph = make('span', 'galaxy-card-glyph', p.glyph);
        glyph.setAttribute('aria-hidden', 'true');
        row.append(glyph, make('span', 'galaxy-card-word', p.word), make('span', 'galaxy-card-why', p.text));
        list.append(row);
      }
      if (info.more > 0) list.append(make('div', 'galaxy-card-more', `+${info.more} MORE`));
      body.append(list);
    }
    if (info.stats?.length) {
      const grid = make('div', 'galaxy-card-stats');
      for (const st of info.stats) {
        const cell = make('div', 'galaxy-card-stat');
        if (String(st.value).length > 6) cell.dataset.wide = '1'; // a word (a branch, a version) takes two columns, unbroken
        cell.append(label(st.label), toned(make('span', 'galaxy-card-value', st.value), st.tone));
        grid.append(cell);
      }
      body.append(grid);
    }
    if (info.below?.length) {
      const strip = make('div', 'galaxy-card-below');
      strip.append(label('below'));
      for (const c of info.below) {
        const chip = toned(make('button', 'galaxy-card-chip', c.label), c.tone);
        chip.type = 'button';
        chip.dataset.id = c.id;
        chip.setAttribute('aria-label', `Fly to ${c.label}`);
        chip.addEventListener('click', (ev) => { ev.stopPropagation?.(); o.onPick(c.id); });
        strip.append(chip);
      }
      if (info.belowMore > 0) strip.append(make('span', 'galaxy-card-chip-more', `+${info.belowMore}`));
      body.append(strip);
    }
  };
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
    kind.textContent = info.chip ?? String(info.kind ?? '').toUpperCase();
    say(info);
    card.dataset.kind = info.kind ?? '';
    card.dataset.tone = info.tone ?? 'calm';
    card.setAttribute('aria-label', `${info.name ?? info.id}, ${info.kind ?? 'node'}`);
    if (!same) { last = null; show(card, false); show(leader, false); show(spot, false); } // a new node: its side afresh
    measured = null; // its content changed: measured again on the next draw (after the camera's request)
  };
  const draw = () => {
    if (!sel) return;
    // It comes as the camera lands (as the plate did): no card placed for a node still flying in, then jumping.
    if (!last && o.flying()) return;
    show(card, true);
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
