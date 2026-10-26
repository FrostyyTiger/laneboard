// The Wall's target lock (docs/plans/wall/README.md §3): four corner brackets
// that close in around the node the camera flies to, as it arrives, and open
// and fade as it leaves. They follow the node every frame (`map.onDraw`,
// `map.screenOf`), so the Map's slow turn and settling layout carry them too.
//
// `lockGeometry`, `lockProgress` and `nodeScaleAt` are pure
// (test/wall-lock.test.mjs imports them); `createLock` is the DOM part: four
// small absolutely placed corners moved by transform only, so a frame costs
// four style writes and no layout. No work while nothing is locked.
//
// Colour follows laneboard's rule: the brackets are grey on a calm target and
// take the target's status colour only when it is in trouble.
//
// On a site in trouble the lock closes on the worst node inside it, the one
// the caption's trouble word names (`lockTarget`, T25), and a thin leader
// draws out from the plate, level with that word, to the bracket nearest it:
// the word and the place it is about, joined.

import { SIZE } from '../views/map/layout.js';
import { fitScaleOf } from '../views/map/interact.js';
import { TROUBLE, byIdOf } from '../views/map/model.js';
import { captionLines } from './caption.js';

/**
 * Normal and `?demo=1` speed alike: the brackets start closing `leadMs`
 * before the camera is there (the flight eases out, so the node is nearly
 * still by then), are shut `closeMs` later, and open and fade over `outMs`
 * when the camera leaves.
 */
export const LOCK_TIMING = Object.freeze({ leadMs: 600, closeMs: 700, outMs: 350 });

/** Shut at once, gone at once (prefers-reduced-motion; D5 is night 2's). */
export const STILL_LOCK_TIMING = Object.freeze({ leadMs: 0, closeMs: 0, outMs: 0 });

/**
 * Sizes as fractions of the screen's short side, so the lock reads the same
 * from a 12" tablet to a wall screen: the gap between the node's edge and a
 * shut bracket's corner, how much further out the brackets start, the arm
 * length of each L.
 */
export const LOCK_SIZE = Object.freeze({ gap: 0.022, open: 0.07, arm: 0.022, minArm: 8 });

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** Ease out cubic: fast in, settling on the node (one camera, no bounce). */
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * The Map's node scale at zoom `zoom` (render.js nodeScale: world scale
 * clamped 0.8..1.6), from the overview's scale (`fit`, the Map's
 * snapshotScene `fitScale`) or, without it, from the canvas size and the
 * layout's outer radius as the default fit takes them (index.js computeFit,
 * ambient: no insets).
 */
export function nodeScaleAt(W, H, outer, zoom, fit) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const k = Number.isFinite(fit) && fit > 0 ? fit : fitScaleOf(W, H, (Number.isFinite(outer) ? outer : 0) + 64);
  const s = k * z;
  return Math.min(1.6, Math.max(0.8, s));
}

/**
 * How shut the lock is at `now` (0 open and invisible, 1 shut), for a lock
 * that started closing at `startAt` and, if `leaveAt` is set, began opening
 * then. Opening runs from wherever closing had got to, so a short leg never
 * jumps.
 */
export function lockProgress(now, { startAt, leaveAt = null }, timing = LOCK_TIMING) {
  const closing = (t) => (timing.closeMs > 0 ? clamp01((t - startAt) / timing.closeMs) : (t >= startAt ? 1 : 0));
  if (leaveAt == null || now < leaveAt) return closing(now);
  const from = closing(leaveAt);
  return timing.outMs > 0 ? from * (1 - clamp01((now - leaveAt) / timing.outMs)) : 0;
}

/**
 * The brackets around a node of `kind` drawn at node scale `ns`, on a screen
 * whose short side is `side` px, at progress `t` (lockProgress). Returns
 * `{ r, d, arm, alpha }`: the node's drawn radius, the distance from its
 * centre to each bracket's corner along both axes, the length of each arm,
 * and the opacity. Pure.
 */
export function lockGeometry({ kind, ns = 1, side = 0, t = 1 }) {
  const r = (SIZE[kind] ?? 5) * (Number.isFinite(ns) ? ns : 1);
  const s = Number.isFinite(side) && side > 0 ? side : 0;
  const shut = r + Math.max(6, s * LOCK_SIZE.gap);
  const open = shut + Math.max(12, s * LOCK_SIZE.open);
  const e = easeOut(clamp01(t));
  return {
    r,
    d: open + (shut - open) * e,
    arm: Math.max(LOCK_SIZE.minArm, s * LOCK_SIZE.arm),
    alpha: e,
  };
}

/** The lock's tone: grey unless the target is in trouble (docs/design.md status language). */
export const lockTone = (status) => (status === 'crit' || status === 'down' ? 'crit'
  : TROUBLE.includes(status) ? 'warn' : 'calm');

/**
 * What the lock closes on for a toured `site` in `model` (a map model or its
 * nodes): the node the caption's trouble word names (the worst inside the
 * site, or the site itself), then its parents up to the site, as
 * `[{ id, kind }]`. The driver locks on the first of them the Map draws, so
 * a node folded away at the hold's zoom is found on its nearest drawn
 * parent. A calm site is just itself. Pure.
 */
export function lockTarget(site, model) {
  if (typeof site?.id !== 'string') return [];
  const nodes = (Array.isArray(model) ? model : Array.isArray(model?.nodes) ? model.nodes : [])
    .filter((n) => n && typeof n.id === 'string');
  const byId = byIdOf(nodes);
  const lead = captionLines(site, nodes).lines.find((l) => l.kind === 'trouble');
  const chain = [];
  const seen = new Set();
  for (let id = lead?.id; byId.has(id) && !seen.has(id); id = byId.get(id).parent) {
    seen.add(id);
    chain.push({ id, kind: byId.get(id).kind });
    if (id === site.id) break;
  }
  // Only a node inside the site counts; else the site alone.
  if (chain.at(-1)?.id !== site.id) return [{ id: site.id, kind: site.kind }];
  return chain;
}

/** The leader's length never under this many arms (shorter reads as a tick, not a line). */
export const LEADER_MIN_ARMS = 2;

/**
 * The leader from the plate's anchor `from` ({x, y}) to the bracket corner
 * nearest it, for brackets `d` from the node's centre `at`, drawn out to
 * fraction `t` (0..1, eased by the caller). Returns `{ x, y, len, angle }`
 * (start, drawn length, radians) or null when the node is not to the right
 * of the anchor (it would run back under the plate) or too close to it. Pure.
 */
export function leaderGeometry(from, at, d, arm, t = 1) {
  if (![from?.x, from?.y, at?.x, at?.y, d].every(Number.isFinite)) return null;
  const bx = at.x - d;
  const by = from.y < at.y ? at.y - d : at.y + d;
  const dx = bx - from.x, dy = by - from.y;
  const full = Math.hypot(dx, dy);
  if (dx <= 0 || full < LEADER_MIN_ARMS * (Number.isFinite(arm) ? arm : 0)) return null;
  return { x: from.x, y: from.y, len: full * clamp01(t), angle: Math.atan2(dy, dx) };
}

// --- the DOM part ------------------------------------------------------------

const CORNERS = ['tl', 'tr', 'bl', 'br'];

/**
 * The lock inside `root` (an empty element over the map), following `map`
 * (`onDraw`, `screenOf`, `snapshotScene`). `lockOn(leg, zoom)` locks onto a
 * site leg: on `leg.target` (lockTarget's chain) when given, else the site's
 * node (`leg.node`); `release()` opens the lock (an overview leg). The old
 * lock keeps opening on its node while the camera flies on; the new one
 * takes over when it starts closing. `leaderFrom()` says where the leader
 * leaves the caption plate (null: no leader); a calm target never has one.
 * `clock` and `size` are injectable.
 */
export function createLock(root, map, {
  timing = LOCK_TIMING, clock = globalThis.performance, size = null, leaderFrom = null,
} = {}) {
  const box = document.createElement('div');
  box.className = 'wall-lock';
  const corners = CORNERS.map((c) => {
    const e = document.createElement('span');
    e.className = `wall-lock-c wall-lock-${c}`;
    box.append(e);
    return e;
  });
  // One px wide, stretched by scaleX: a frame moves it without layout.
  const leader = document.createElement('span');
  leader.className = 'wall-lock-leader';
  leader.style.opacity = '0';
  box.append(leader);
  box.style.opacity = '0';
  root.append(box);

  const measure = size ?? (() => ({ W: root.clientWidth, H: root.clientHeight }));
  let cur = null;  // { id, kind, chain, ns, tone, startAt, leaveAt }: the lock on screen
  let next = null; // the one waiting for the camera
  let armPx = -1;
  let shown = false;
  let led = false;

  const hideLeader = () => {
    if (led) leader.style.opacity = '0';
    led = false;
  };
  const hideBox = () => {
    if (shown) box.style.opacity = '0';
    shown = false;
    hideLeader();
  };

  // The first node of the chain the Map draws now, and where.
  const drawn = (chain) => {
    for (const c of chain) {
      const sp = map.screenOf(c.id);
      if (sp) return { c, sp };
    }
    return null;
  };

  const paint = () => {
    const now = clock.now();
    if (next && now >= next.startAt) {
      cur = next;
      next = null;
      box.dataset.tone = cur.tone;
    }
    if (!cur) return;
    const t = lockProgress(now, cur, timing);
    if (cur.leaveAt != null && now >= cur.leaveAt + timing.outMs) {
      cur = null;
      hideBox();
      return;
    }
    const hit = t > 0 ? drawn(cur.chain) : null;
    if (!hit) { hideBox(); return; }
    const { sp } = hit;
    const { W, H } = measure();
    const g = lockGeometry({ kind: hit.c.kind, ns: cur.ns, side: Math.min(W, H), t });
    const arm = Math.round(g.arm);
    if (arm !== armPx) {
      armPx = arm;
      box.style.setProperty('--lock-arm', `${arm}px`);
    }
    const x0 = (sp.x - g.d).toFixed(1), x1 = (sp.x + g.d - arm).toFixed(1);
    const y0 = (sp.y - g.d).toFixed(1), y1 = (sp.y + g.d - arm).toFixed(1);
    corners[0].style.transform = `translate3d(${x0}px, ${y0}px, 0)`;
    corners[1].style.transform = `translate3d(${x1}px, ${y0}px, 0)`;
    corners[2].style.transform = `translate3d(${x0}px, ${y1}px, 0)`;
    corners[3].style.transform = `translate3d(${x1}px, ${y1}px, 0)`;
    box.style.opacity = g.alpha.toFixed(3);
    shown = true;
    // The leader draws out with the close and in with the open.
    const from = cur.tone !== 'calm' && typeof leaderFrom === 'function' ? leaderFrom() : null;
    const l = from ? leaderGeometry(from, sp, g.d, arm, g.alpha) : null;
    if (!l) { hideLeader(); return; }
    leader.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0) rotate(${l.angle.toFixed(4)}rad) scaleX(${l.len.toFixed(1)})`;
    if (!led) leader.style.opacity = '';
    led = true;
  };
  const off = map.onDraw(paint);

  const release = () => {
    next = null;
    if (cur && cur.leaveAt == null) cur.leaveAt = clock.now();
  };

  const lockOn = (leg, zoom) => {
    release();
    const node = leg?.node;
    if (typeof leg?.id !== 'string' || !node) return;
    const { W, H } = measure();
    const arrive = Number.isFinite(leg.arriveMs) ? leg.arriveMs : 0;
    const snap = map.snapshotScene?.();
    let startAt = clock.now() + Math.max(0, arrive - timing.leadMs);
    // Never take the box from a lock that is still opening.
    if (cur) startAt = Math.max(startAt, cur.leaveAt + timing.outMs);
    const chain = Array.isArray(leg.target) && leg.target.length ? leg.target : [{ id: leg.id, kind: node.kind }];
    next = {
      id: chain[0].id,
      kind: chain[0].kind,
      chain,
      ns: nodeScaleAt(W, H, snap?.outer, zoom, snap?.fitScale),
      tone: lockTone(leg.status),
      startAt,
      leaveAt: null,
    };
  };

  return {
    lockOn,
    release,
    /** The lock on screen and the one waiting, for tests and the console. */
    state: () => ({ cur: cur ? { ...cur } : null, next: next ? { ...next } : null }),
    el: box,
    destroy: () => { off?.(); box.remove(); },
  };
}
