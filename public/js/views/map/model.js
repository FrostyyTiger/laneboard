// The Map's model logic: what is drawn, what is folded away, which links show,
// how trouble rolls up, and how a router `sel=` value names a node.
//
// Pure: no DOM, no globals, no state of its own. Everything here was in
// views/map-canvas.js (folding and shown :407-432, folded links :435-448, the
// idle-lane rule :1227-1231, neighbours :506-515, rollup :575-587) and is
// extended for the fleet node contract (plan §5 2.1, 2.3, 2.4, 2.7): builder,
// session, repo and package nodes, fleet-key ids `lane:<builder>/<lane>` and
// `sess:<builder>/<name>`, auto-folded sessions and scope ghosting.

import { parseFkey, laneNodeId } from '../../core/keys.js';

/** Order of severity, worst last, for rollups and sorting. */
export const SEVERITY = ['idle', 'unknown', 'ok', 'working', 'low', 'warn', 'attention', 'crit', 'down'];

/** Statuses that roll up into a parent (and into a folded node). */
export const TROUBLE = ['warn', 'attention', 'crit', 'down'];

/** localStorage key of the user's folded node ids. */
export const FOLD_KEY = 'laneboard.map.folded';

/** At this zoom and closer, lanes show their sessions without being asked. */
export const AUTO_UNFOLD_ZOOM = 1.8;

/** Emphasis of a node outside the scoped builder's subtree. */
export const SCOPE_GHOST = 0.25;

/** The worse of two statuses (the first one on a tie). */
export const worse = (a, b) => (SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b);

/**
 * A model as GET /api/map or a `map` frame carries it, with the parts the
 * client relies on always present. Self-links are dropped (as before).
 */
export function normalize(model) {
  const m = model && typeof model === 'object' ? model : {};
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    title: typeof m.title === 'string' ? m.title : null,
    error: typeof m.error === 'string' && m.error ? m.error : null,
    generatedAt: Number.isFinite(m.generatedAt) ? m.generatedAt : null,
    fleet: m.fleet && Array.isArray(m.fleet.builders) ? { builders: m.fleet.builders } : { builders: [] },
    nodes: arr(m.nodes).filter((n) => n && typeof n.id === 'string'),
    links: arr(m.links).filter((l) => l && l.from != null && l.to != null && l.from !== l.to),
    events: arr(m.events),
    // Reach (T11) is drawn only by the reach overlay; links are kept as given.
    reach: m.reach && Array.isArray(m.reach.links)
      ? { links: m.reach.links.filter((l) => l && typeof l.from === 'string' && typeof l.to === 'string' && l.from !== l.to) }
      : null,
  };
}

/** id -> node, for every node. */
export const byIdOf = (nodes) => new Map(nodes.map((n) => [n.id, n]));

/** parent id -> child nodes, for every node whose parent exists. */
export function kidsOf(nodes, byId = byIdOf(nodes)) {
  const kids = new Map();
  for (const n of nodes) {
    if (!n.parent || !byId.has(n.parent)) continue;
    if (!kids.has(n.parent)) kids.set(n.parent, []);
    kids.get(n.parent).push(n);
  }
  return kids;
}

/**
 * What folding hides. `collapsed` holds the user's folds, `autoFold` the
 * lanes whose sessions are folded automatically (2.4); both are iterables of
 * node ids. Returns the hidden ids, the children map, and `shown(id)`: the
 * drawn node standing in for `id` (itself, or the folded node it is inside).
 */
export function foldState(nodes, collapsed = [], autoFold = []) {
  const byId = byIdOf(nodes);
  const kids = kidsOf(nodes, byId);
  const hidden = new Set();
  const hide = (id) => {
    for (const c of kids.get(id) ?? []) {
      if (hidden.has(c.id)) continue;
      hidden.add(c.id);
      hide(c.id);
    }
  };
  const folded = new Set();
  for (const src of [collapsed, autoFold]) {
    for (const id of src ?? []) {
      if (!byId.has(id)) continue;
      folded.add(id);
      hide(id);
    }
  }
  const shown = (id) => {
    let x = id;
    while (x != null && hidden.has(x)) x = byId.get(x)?.parent ?? null;
    return x;
  };
  return { hidden, folded, kids, byId, shown };
}

/**
 * The lanes whose sessions fold away by themselves (2.4): every lane with
 * session children, unless the lane or one of its sessions is selected, the
 * scope is that lane's builder, or the camera is zoomed in to `zoom >= 1.8`.
 */
export function autoFold(nodes, { selected = null, scope = 'all', zoom = 1 } = {}) {
  const out = new Set();
  if (zoom >= AUTO_UNFOLD_ZOOM) return out;
  const byId = byIdOf(nodes);
  const withSessions = new Set();
  for (const n of nodes) {
    if (n.kind === 'session' && byId.get(n.parent)?.kind === 'lane') withSessions.add(n.parent);
  }
  const selLane = selected == null ? null
    : byId.get(selected)?.kind === 'session' ? byId.get(selected).parent : selected;
  for (const id of withSessions) {
    if (id === selLane) continue;
    if (scope && scope !== 'all' && byId.get(id).builder === scope) continue;
    out.add(id);
  }
  return out;
}

/**
 * Stored fold ids, cleaned: strings only, and the legacy builder-mode lane ids
 * `lane:<x>` (from before lane ids carried the builder) dropped.
 */
export function migrateFolded(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((x) => typeof x === 'string' && x !== ''
    && !(x.startsWith('lane:') && parseFkey(x.slice(5)) === null));
}

const restingLane = (n) => n?.kind === 'lane' && (n.status === 'idle' || n.status === 'unknown');

/** True when `node` sits under `builder:<scope>` (or carries that builder). */
function inBuilder(node, scope, byId) {
  if (!node) return false;
  if (node.builder === scope) return true;
  const root = `builder:${scope}`;
  for (let x = node, guard = 0; x && guard < 64; x = byId.get(x.parent), guard++) {
    if (x.id === root) return true;
  }
  return false;
}

/**
 * The links to draw. A link whose end is folded away attaches to the folded
 * node instead (merged per pair and kind; `live` if any is, a confirmed
 * conflict wins over a predicted one, the worse severity is kept). Dropped:
 * links with an end not drawn (`drawn`, a Set or Map of drawn ids, when
 * given), a resting lane's links unless an end is the focus, and `pkg` links
 * unless an end is the focus, the lane is in scope, or the overlay is `ci`.
 */
export function visibleLinks(links, shown, { focus = null, overlay = 'status', scope = 'all', byId = new Map(), drawn = null } = {}) {
  const out = [];
  const merged = new Map();
  const isFocus = (l) => focus != null && (l.from === focus || l.to === focus);
  for (const l of links ?? []) {
    const from = shown(l.from), to = shown(l.to);
    if (from == null || to == null || from === to) continue;
    if (drawn && (!drawn.has(from) || !drawn.has(to))) continue;
    let v = l;
    if (from !== l.from || to !== l.to) {
      const id = `${from}>${to}~${l.kind ?? ''}`;
      const had = merged.get(id);
      if (had) {
        had.live = Boolean(had.live || l.live);
        if (l.predicted === false) had.predicted = false;
        if (l.severity) had.severity = had.severity ? worse(had.severity, l.severity) : l.severity;
        continue;
      }
      v = { ...l, id, from, to, folded: true };
      merged.set(id, v);
    }
    out.push(v);
  }
  return out.filter((l) => {
    // A resting lane's links are drawn only when asked for: a dozen idle
    // worktrees would otherwise web the middle for nothing.
    if (restingLane(byId.get(l.from)) && !isFocus(l)) return false;
    if (l.kind === 'pkg') {
      if (overlay === 'ci' || isFocus(l)) return true;
      if (scope && scope !== 'all' && inBuilder(byId.get(l.from), scope, byId)) return true;
      return false;
    }
    return true;
  });
}

/** id -> Set of ids next to it: its drawn parent and children, and link ends. */
export function neighbours(drawnIds, byId, links = []) {
  const out = new Map();
  const add = (a, b) => {
    if (!out.has(a)) out.set(a, new Set());
    out.get(a).add(b);
  };
  const drawn = drawnIds instanceof Set || drawnIds instanceof Map ? drawnIds : new Set(drawnIds);
  for (const id of drawn.keys()) {
    const n = byId.get(id);
    if (n?.parent && drawn.has(n.parent)) { add(id, n.parent); add(n.parent, id); }
  }
  for (const l of links) { add(l.from, l.to); add(l.to, l.from); }
  return out;
}

/**
 * The status a node shows with its subtree's trouble folded in: its own
 * status, calm statuses read as `ok` (unknown stays unknown), and any
 * warn/attention/crit/down below it rolled up (`down` arrives as `crit`).
 * `kids` is the full children map, folded nodes included, so trouble inside
 * a fold still shows on it.
 */
export function rollup(id, byId, kids, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  memo.set(id, 'unknown'); // a cycle in bad data must not recurse forever
  const n = byId.get(id);
  let s = n?.status ?? 'unknown';
  if (s === 'working' || s === 'idle' || s === 'low') s = 'ok';
  if (!SEVERITY.includes(s)) s = 'unknown';
  for (const c of kids.get(id) ?? []) {
    const cs = rollup(c.id, byId, kids, memo);
    if (TROUBLE.includes(cs)) s = worse(s, cs === 'down' ? 'crit' : cs);
  }
  memo.set(id, s);
  return s;
}

/**
 * Emphasis of a node under a rail scope (2.7): 1 with no scope, inside the
 * scoped builder's subtree, or on the path from that builder to the core;
 * SCOPE_GHOST otherwise. With an unknown builder nothing is ghosted.
 */
export function scopeAlpha(node, scope, byId) {
  if (!scope || scope === 'all' || !node) return 1;
  const root = byId.get(`builder:${scope}`);
  if (!root) return 1;
  if (inBuilder(node, scope, byId)) return 1;
  for (let x = byId.get(root.parent), guard = 0; x && guard < 64; x = byId.get(x.parent), guard++) {
    if (x.id === node.id) return 1;
  }
  return node.kind === 'core' || node.virtual ? 1 : SCOPE_GHOST;
}

/**
 * The node a router `sel=` value names (2.3). A fleet key resolves to its
 * lane, then its session node, then the lane whose only session it is; any
 * other value is a raw node id. Null when nothing matches.
 */
export function idForSel(sel, byId) {
  if (typeof sel !== 'string' || sel === '') return null;
  if (byId.has(sel)) return sel;
  const p = parseFkey(sel);
  if (!p) return null;
  const lane = laneNodeId(p.builder, p.name);
  if (byId.has(lane)) return lane;
  const sess = `sess:${sel}`;
  if (byId.has(sess)) return sess;
  for (const n of byId.values()) if (n.kind === 'lane' && n.session === sel) return n.id;
  return null;
}

/** The `sel=` value for a node id: the fleet key for lanes and sessions, else the id. */
export function selForId(id) {
  if (typeof id !== 'string') return null;
  for (const prefix of ['lane:', 'sess:']) {
    if (id.startsWith(prefix) && parseFkey(id.slice(prefix.length))) return id.slice(prefix.length);
  }
  return id;
}
