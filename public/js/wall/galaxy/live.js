// The galaxy's live data (Wall plan night 2 T8, README §7.A4): what a new
// model changes in the scene, and the timing of those changes, pure so
// test/wall-galaxy-live.test.mjs runs it without WebGL.
//
// A status change keeps every object and only recolours it: the meshes swap
// to the tone's shared material, the halos and the nebula ease to their new
// strength and size (LIVE.recolourMs). A tree change (a node added, gone or
// moved) folds the systems it touches, lays them out again while folded and
// opens them again; a site that came or went grows or shrinks on its spot,
// and every star whose place on the arms moved glides there. Nothing cuts:
// the camera reads the stars' homes as they glide.

import { ease } from './layout.js';

/** Timings (ms): a recolour, a fold before a relayout, the opening after it, a star's glide. */
export const LIVE = Object.freeze({ recolourMs: 700, foldMs: 700, reopenMs: 1100, glideMs: 1600 });

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The tree without its statuses: ids, parents and kinds, plus the sites shown (tour.js tourSites). */
export function treeKey(nodes, shownIds = []) {
  const tree = (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && n.id != null)
    .map((n) => `${n.id}/${n.parent}/${n.kind}`)
    .join('|');
  return `${tree}#${[...shownIds].join(',')}`;
}

/** One key per laid-out site (layout.js galaxyLayout) for what it holds: a member's id, parent and kind. */
export function siteKeys(sites) {
  const out = new Map();
  for (const s of sites ?? []) {
    out.set(s.id, s.members.map((m) => `${m.id}/${m.node?.parent}/${m.node?.kind}`).join('|'));
  }
  return out;
}

/**
 * What a tree change does to each site, from the old and the new siteKeys:
 * `kept` (the same members, at most a glide), `changed` (fold → relayout →
 * open), `added` (grows in), `removed` (shrinks away). Ids in model order.
 */
export function planLive(before, after) {
  const plan = { kept: [], changed: [], added: [], removed: [] };
  for (const [id, key] of after) {
    if (!before.has(id)) plan.added.push(id);
    else if (before.get(id) === key) plan.kept.push(id);
    else plan.changed.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) plan.removed.push(id);
  return plan;
}

/**
 * A relayout `t` ms after it started, from a squeeze of `from` (1 when the
 * system was not already folding): `{ squeeze, swap, done }`. The squeeze
 * multiplies the system's opening: it falls to 0 over `foldMs`, the new
 * layout swaps in there (`swap` from then on), and it rises back to 1 over
 * `reopenMs`. Pure.
 */
export function relayPhase(t, from = 1, live = LIVE) {
  if (t < live.foldMs) return { squeeze: from * (1 - ease(clamp01(t / live.foldMs))), swap: false, done: false };
  const k = clamp01((t - live.foldMs) / live.reopenMs);
  return { squeeze: ease(k), swap: true, done: k >= 1 };
}

/** `k` (0..1, eased here) of the way from `a` to `b`, either `number` or `{ x, y, z }`. Pure. */
export function glide(a, b, k) {
  if (k >= 1) return typeof b === 'number' ? b : { x: b.x, y: b.y, z: b.z };
  const e = ease(clamp01(k));
  if (typeof a === 'number') return a + (b - a) * e;
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e };
}
