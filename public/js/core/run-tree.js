// The run tree's model (docs/runs-home.md): goal -> feature -> task, built from
// the flat node list an engine answers. Pure: no DOM, nothing at import time.
//
// Folding: open down to the level that is moving, closed elsewhere; a failing
// check opens its path. What the person folds by hand wins until that node's
// path gets a new failure.

const RUN = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const KEY_RX = new RegExp(`^([a-z0-9][a-z0-9-]{0,31})/(${RUN})$`);

/** `<engine>/<run>` -> {engine, id}, or null. */
export function parseRunKey(v) {
  const m = typeof v === 'string' ? KEY_RX.exec(v) : null;
  return m ? { engine: m[1], id: m[2] } : null;
}

const MOVING = new Set(['building', 'checking']);

/** Flat nodes -> {roots, byId}. An unknown parent or a cycle makes the node a root; a repeated id is dropped. */
export function buildTree(nodes) {
  const byId = new Map();
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (n && typeof n.id === 'string' && !byId.has(n.id)) byId.set(n.id, { node: n, children: [], parent: null });
  }
  const roots = [];
  for (const item of byId.values()) {
    let p = byId.get(item.node.parent) ?? null;
    for (let at = p; at; at = at.parent) if (at === item) { p = null; break; }
    item.parent = p;
    (p ? p.children : roots).push(item);
  }
  return { roots, byId };
}

const failed = (item) => item.node.lastCheck?.pass === false && item.node.state !== 'dropped';

function openPath(item, out) {
  for (let at = item.parent; at; at = at.parent) out.add(at.node.id);
}

/**
 * The ids open by default. Each moving node's ancestors are open, so the moving
 * level is what you see; a failing node is open itself. With nothing moving or
 * failing the roots are open.
 */
export function defaultOpen(tree, currentNode = null) {
  const open = new Set();
  for (const item of tree.byId.values()) {
    if (item.node.id === currentNode || MOVING.has(item.node.state)) openPath(item, open);
    if (failed(item)) { openPath(item, open); open.add(item.node.id); }
  }
  if (!open.size) for (const r of tree.roots) open.add(r.node.id);
  return open;
}

/** A hand fold (`overrides`, id -> bool) wins over the default. */
export const isOpen = (id, defaults, overrides) => (overrides.has(id) ? overrides.get(id) : defaults.has(id));

/**
 * Clears hand folds on the path of a failure not seen before, so it opens even
 * where the person had folded. `seen` (a Set of `<id>@<at>`) and `overrides` are
 * updated in place. The first call only records: nothing has been folded yet.
 */
export function noteFailures(tree, overrides, seen) {
  for (const item of tree.byId.values()) {
    if (!failed(item)) continue;
    const sig = `${item.node.id}@${item.node.lastCheck.at ?? ''}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    overrides.delete(item.node.id);
    for (let at = item.parent; at; at = at.parent) overrides.delete(at.node.id);
  }
}

/** Events -> {byNode: Map id -> events, run: events naming no known node}. */
export function placeEvents(tree, events) {
  const byNode = new Map();
  const run = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (e?.node && tree.byId.has(e.node)) {
      if (!byNode.has(e.node)) byNode.set(e.node, []);
      byNode.get(e.node).push(e);
    } else if (e) run.push(e);
  }
  return { byNode, run };
}

/** id -> the USD spent at that node and below it, from the events' usage. */
export function costBelow(tree, events) {
  const out = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (typeof e?.usd !== 'number' || !Number.isFinite(e.usd)) continue;
    for (let at = tree.byId.get(e.node) ?? null; at; at = at.parent) out.set(at.node.id, (out.get(at.node.id) ?? 0) + e.usd);
  }
  return out;
}

/** Retries of a node: rounds after the first. */
export const retriesOf = (node) => Math.max(0, (node?.attempts?.rounds ?? 0) - 1);

/** New events merged by seq, oldest first, the newest `max` kept. */
export function mergeEvents(have, more, max = 2000) {
  const bySeq = new Map();
  for (const e of [...(have ?? []), ...(more ?? [])]) if (Number.isInteger(e?.seq)) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-max);
}
