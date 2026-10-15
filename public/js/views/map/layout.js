// The Map's geometry: rings by kind, leaf-weighted sectors, ring labels and
// the degree dial.
//
// Pure: no DOM, no globals. `layout` is views/map-canvas.js `layout` (:139-203)
// with a node's radius taken from its kind (plan §5 2.4) instead of its depth,
// so a builder sits on the BUILDER ring whether a topology room claims it or
// it hangs under the synthetic `__fleet` site.

/** Distance from the centre of each ring, in world units. */
export const RINGS = [0, 150, 290, 420, 540, 640];

/** The ring each kind sits on; unknown kinds fall back to their tree depth. */
export const RING_OF = {
  core: 0, site: 1, host: 1, room: 2, repo: 2,
  builder: 3, service: 3, package: 3, lane: 4, pr: 5, session: 5,
};

/** Radius of a node's dot, by kind. */
export const SIZE = {
  core: 15, site: 10, host: 9, room: 6.5, repo: 6, builder: 7,
  service: 4.2, package: 4, lane: 5, pr: 3.6, session: 3.4,
};

/** Rings from this index on stagger crowded neighbours in and out. */
export const STAGGER_FROM = 3;

/** Angle kept clear at twelve o'clock, where the ring labels sit. */
export const CLEARANCE = 0.26;

/** Ring label word per kind, in the order the words are joined. */
export const RING_WORD = [
  ['site', 'SITE'], ['host', 'HOST'], ['room', 'ROOM'], ['repo', 'REPO'],
  ['builder', 'BUILDER'], ['service', 'SVC'], ['package', 'PKG'],
  ['lane', 'LANE'], ['pr', 'PR'], ['session', 'SESSION'],
];

const TAU = Math.PI * 2;
const LAST = RINGS.length - 1;

export const polar = (r, a) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });

/**
 * Lay the tree out on rings. Each node gets an angular sector proportional to
 * the leaves under it, so a room with twelve lanes gets the room it needs and
 * a room with nothing inside it does not waste an arc. Siblings on the first
 * level get a gap between them so the sites read as separate islands.
 *
 * A node's ring is RING_OF[kind] (its depth for unknown kinds), but always
 * outside its parent's ring while there is a ring left.
 *
 * Returns `{pos, center, kids}`: pos maps id -> `{x, y, angle, depth, ring, r,
 * a0, a1}` (depth = tree depth, ring = ring index), center is the core node
 * (or a virtual one when the model has none), kids maps id -> child nodes.
 */
export function layout(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  const core = nodes.find((n) => n.kind === 'core');
  const roots = [];
  for (const n of nodes) {
    if (n === core) continue;
    const p = n.parent && byId.has(n.parent) && n.parent !== n.id ? n.parent : null;
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else roots.push(n);
  }
  const center = core ?? { id: '__core', kind: 'core', label: '', virtual: true };
  kids.set(center.id, [...(kids.get(center.id) ?? []), ...roots]);

  const weight = new Map();
  const visiting = new Set();
  const w = (n) => {
    if (weight.has(n.id)) return weight.get(n.id);
    if (visiting.has(n.id)) return 0; // a parent cycle in bad data
    visiting.add(n.id);
    const ch = kids.get(n.id) ?? [];
    const own = n.kind === 'lane' || n.kind === 'pr' || n.kind === 'session' ? 0.8 : 1;
    const v = ch.length ? Math.max(own, ch.reduce((s, c) => s + w(c), 0)) : own;
    weight.set(n.id, v);
    return v;
  };
  w(center);

  const placed = new Map();
  const place = (n, depth, parentRing, a0, a1) => {
    if (placed.has(n.id)) return;
    const want = depth === 0 ? 0 : RING_OF[n.kind] ?? Math.min(depth, LAST);
    const ring = depth === 0 ? 0 : Math.min(LAST, Math.max(want, parentRing + 1));
    placed.set(n.id, { depth, ring, angle: (a0 + a1) / 2, a0, a1 });
    const ch = (kids.get(n.id) ?? []).filter((c) => weight.has(c.id))
      .sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    if (!ch.length) return;
    const total = ch.reduce((s, c) => s + weight.get(c.id), 0) || 1;
    const gap = depth === 0 ? 0.09 : depth === 1 ? 0.025 : 0;
    const span = a1 - a0 - gap * ch.length;
    let a = a0 + gap / 2;
    for (const c of ch) {
      const share = (weight.get(c.id) / total) * span;
      place(c, depth + 1, ring, a, a + share);
      a += share + gap;
    }
  };
  const start = -Math.PI / 2 + CLEARANCE / 2;
  place(center, 0, 0, start, start + TAU - CLEARANCE);

  // Crowded outer rings stagger in and out so neighbours' labels do not touch.
  const perRing = new Map();
  for (const [id, p] of placed) {
    if (!perRing.has(p.ring)) perRing.set(p.ring, []);
    perRing.get(p.ring).push([id, p]);
  }
  const pos = new Map();
  for (const [ring, list] of [...perRing].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a[1].angle - b[1].angle);
    const r = RINGS[ring];
    list.forEach(([id, p], i) => {
      const crowded = ring >= STAGGER_FROM && (p.a1 - p.a0) * r < 34;
      const rr = ring === 0 ? 0 : r + (crowded ? (i % 2 ? 16 : -10) : 0);
      pos.set(id, { ...polar(rr, p.angle), angle: p.angle, depth: p.depth, ring, r: rr, a0: p.a0, a1: p.a1 });
    });
  }
  return { pos, center, kids };
}

/**
 * The label of each occupied ring: the kinds on it, joined in RING_WORD order
 * (`BUILDER · SVC · PKG`). `nodes` is an array or an id -> node map. Ring 0
 * and virtual nodes carry no label. Returns `[{ring, r, kinds, label}]`.
 */
export function ringLabels(pos, nodes) {
  const byId = nodes instanceof Map ? nodes : new Map((nodes ?? []).map((n) => [n.id, n]));
  const kinds = new Map();
  for (const [id, p] of pos) {
    const n = byId.get(id);
    if (!n || n.virtual || !p.ring) continue;
    if (!kinds.has(p.ring)) kinds.set(p.ring, new Set());
    kinds.get(p.ring).add(n.kind);
  }
  const out = [];
  for (const ring of [...kinds.keys()].sort((a, b) => a - b)) {
    const present = kinds.get(ring);
    const known = RING_WORD.filter(([k]) => present.has(k));
    const other = [...present].filter((k) => !RING_WORD.some(([w]) => w === k)).sort();
    const words = [...known.map(([, word]) => word), ...other.map((k) => String(k).toUpperCase())];
    out.push({ ring, r: RINGS[ring], kinds: [...known.map(([k]) => k), ...other], label: words.join(' · ') });
  }
  return out;
}

/**
 * The dial outside the outermost ring: a tick every five degrees, longer every
 * thirty, with numeric bearings `000 090 180 270` at the long ticks every 90°.
 * Bearings run clockwise from twelve o'clock; `a` is the canvas angle.
 * Returns `[{a, bearing, r0, r1, long, label}]` (label null off the quarters).
 */
export function ticks(outerR) {
  const out = [];
  for (let i = 0; i < 72; i++) {
    const bearing = i * 5;
    const long = i % 6 === 0;
    out.push({
      a: -Math.PI / 2 + (bearing / 360) * TAU,
      bearing,
      r0: outerR,
      r1: outerR + (long ? 7 : 3),
      long,
      label: bearing % 90 === 0 ? String(bearing).padStart(3, '0') : null,
    });
  }
  return out;
}
