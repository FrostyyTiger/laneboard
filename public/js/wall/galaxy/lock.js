// The galaxy's target lock (Wall plan night 2 T9, README §3): the Wall's four
// corner brackets and leader (lock.js) on the 3D camera. They close in round
// the node the caption's trouble word names (`lockTarget`) as the camera
// arrives, follow it every frame (`cam.onDraw`, `cam.screenOf`) and open and
// fade when it leaves, with the Wall's timing, sizes and styles.
//
// Why not lock.js's `createLock` as it is: it sizes the brackets from the
// Map's node sizes at the hold's zoom, fixed when the lock starts. In 3D a
// planet's size on screen is its distance's, and it changes all through the
// approach, so the brackets here are sized each frame from `screenOf(id).r`
// (camera.js). Everything else (progress, leader, tone, target) is lock.js's.
//
// The leader (night 3 T16, r4-film-ui galaxy 4): not wall.html's straight
// hairline at any angle but one elbow, a level run out of the plate then a
// 45° (or 90°) leg into the bracket's corner, 2 px as the brackets. The
// route is chosen once a lock, round the names then on screen
// (`leaderPath`); from then on the names keep off it (`leaderCovers`, the
// lock's `covers()`, labels.js), so no word ever sits on the line.
//
// `lockGeometry3d` and `leaderPath` are pure (test/wall-galaxy-lock.test.mjs);
// `createGalaxyLock` is the DOM part, the same elements and classes as
// wall.html's lock; its `held()` keeps the names (labels.js) off the brackets.
// Like labels.js it writes a transform or the opacity only when its rounded
// value (0.1 px, opacity to 0.01) changed (night 4 T12): a held lock that
// does not move costs no style write a frame.

import { LEADER_MIN_ARMS, LOCK_SIZE, LOCK_TIMING, lockProgress, lockTone } from '../lock.js';

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
/** Ease out cubic, as lock.js: fast in, settling on the node. */
const easeOut = (t) => 1 - (1 - t) ** 3;

/**
 * The brackets round a thing drawn `r` css px in radius, on a screen whose
 * short side is `side` px, at progress `t` (lockProgress): `{ r, d, arm,
 * alpha }` as lock.js `lockGeometry`, with the same gaps. Pure.
 */
export function lockGeometry3d({ r = 0, side = 0, t = 1 }) {
  const rr = Number.isFinite(r) && r > 0 ? r : 0;
  const s = Number.isFinite(side) && side > 0 ? side : 0;
  const shut = rr + Math.max(6, s * LOCK_SIZE.gap);
  const open = shut + Math.max(12, s * LOCK_SIZE.open);
  const e = easeOut(clamp01(t));
  return { r: rr, d: open + (shut - open) * e, arm: Math.max(LOCK_SIZE.minArm, s * LOCK_SIZE.arm), alpha: e };
}

/**
 * The four corners where the brackets come to rest round `sp` (`{ x, y }`),
 * `shut` css px out with arms of `arm` px, as `{ x, y, w, h }` boxes (night 3
 * T26): no other name sits on a bracket, a trouble name either (it may take
 * a sphere's place, not a bracket's). Where they rest, not where they are
 * while closing, so no name hops away from a bracket passing by. Pure.
 */
export function cornerCovers(sp, shut, arm) {
  if (![sp?.x, sp?.y, shut, arm].every(Number.isFinite) || arm <= 0) return [];
  const x0 = sp.x - shut, x1 = sp.x + shut - arm, y0 = sp.y - shut, y1 = sp.y + shut - arm;
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => ({ x, y, w: arm, h: arm }));
}

/**
 * The leader's routes, in the order they are liked; `pad` css px kept clear
 * between it and a name; `tile` the css px of the squares that cover a
 * slanted leg for the names (leaderCovers).
 */
export const LEADER = Object.freeze({ routes: Object.freeze(['run-45', '45-run', 'run-90']), pad: 4, tile: 24 });

/** Does the segment a → b meet the box `{ x, y, w, h }` grown by `pad`? (Liang-Barsky.) Pure. */
export function segmentHitsBox(a, b, box, pad = 0) {
  const x0 = box.x - pad, x1 = box.x + box.w + pad, y0 = box.y - pad, y1 = box.y + box.h + pad;
  const dx = b.x - a.x, dy = b.y - a.y;
  let lo = 0, hi = 1;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) { if (r > hi) return false; if (r > lo) lo = r; } else { if (r < lo) return false; if (r < hi) hi = r; }
    }
  }
  return lo <= hi;
}

/** The corners of one route from `a` to `b` (b right of a), or null where it cannot be drawn. */
function routePoints(route, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, ady = Math.abs(dy);
  if (ady < 0.5) return [a, b];
  if (route === 'run-45') return dx >= ady ? [a, { x: b.x - ady, y: a.y }, b] : null;
  if (route === '45-run') return dx >= ady ? [a, { x: a.x + ady, y: b.y }, b] : null;
  if (route === 'run-90') return [a, { x: b.x, y: a.y }, b];
  return null;
}

/**
 * The leader from the plate's anchor `from` ({x, y}) to the corner of the
 * brackets `d` from the node's centre `at` nearest it (its left side, top
 * or bottom as the anchor is above or below), drawn out to fraction `t`.
 * One elbow: of `LEADER.routes` (`prefer` first, the route the lock
 * already drew) the first liked one whose legs meet none of the `avoid`
 * boxes (`{ x, y, w, h }`, the names on screen, grown by `LEADER.pad`),
 * else the one meeting fewest. Returns `{ route, points,
 * len, segs }`, `segs` the drawn legs `{ x, y, len, angle }` (the second
 * starts once the first is out), or null when the node is not right of the
 * anchor (the line would run back under the plate) or nearer than
 * LEADER_MIN_ARMS arms (as lock.js `leaderGeometry`). Pure.
 */
export function leaderPath(from, at, d, arm, t = 1, avoid = [], prefer = null) {
  if (![from?.x, from?.y, at?.x, at?.y, d].every(Number.isFinite)) return null;
  const b = { x: at.x - d, y: from.y < at.y ? at.y - d : at.y + d };
  const a = { x: from.x, y: from.y };
  if (b.x - a.x <= 0 || Math.hypot(b.x - a.x, b.y - a.y) < LEADER_MIN_ARMS * (Number.isFinite(arm) ? arm : 0)) return null;
  const boxes = Array.isArray(avoid) ? avoid.filter((x) => x && [x.x, x.y, x.w, x.h].every(Number.isFinite)) : [];
  let best = null;
  const routes = LEADER.routes.includes(prefer) ? [prefer, ...LEADER.routes.filter((r) => r !== prefer)] : LEADER.routes;
  for (const route of routes) {
    const points = routePoints(route, a, b);
    if (!points) continue;
    let hits = 0;
    for (const box of boxes) {
      for (let i = 1; i < points.length; i++) {
        if (segmentHitsBox(points[i - 1], points[i], box, LEADER.pad)) { hits++; break; }
      }
    }
    if (!best || hits < best.hits) best = { route, points, hits };
    if (hits === 0) break;
  }
  const { route, points } = best;
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1], q = points[i];
    legs.push({ x: p.x, y: p.y, full: Math.hypot(q.x - p.x, q.y - p.y), angle: Math.atan2(q.y - p.y, q.x - p.x) });
  }
  const len = legs.reduce((sum, l) => sum + l.full, 0);
  let left = len * clamp01(t);
  const segs = legs.map(({ x, y, full, angle }) => {
    const drawn = Math.min(full, left);
    left -= drawn;
    return { x, y, len: drawn, angle };
  });
  return { route, points, len, segs };
}

/**
 * The boxes `{ x, y, w, h }` the whole of a leader `path` (leaderPath; drawn
 * or not yet) takes, for the names to keep off: a level or upright leg one
 * thin box, a slanted one a row of `tile` px squares along it, each grown
 * by `pad`. Pure.
 */
export function leaderCovers(path, { pad = LEADER.pad, tile = LEADER.tile } = {}) {
  const pts = path?.points;
  if (!Array.isArray(pts) || pts.length < 2) return [];
  const out = [];
  const square = (x0, y0, x1, y1) => {
    const x = Math.min(x0, x1) - pad, y = Math.min(y0, y1) - pad;
    out.push({ x, y, w: Math.abs(x1 - x0) + 2 * pad, h: Math.abs(y1 - y0) + 2 * pad });
  };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const n = Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5 ? 1 : Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / tile));
    for (let k = 0; k < n; k++) square(a.x + dx * k / n, a.y + dy * k / n, a.x + dx * (k + 1) / n, a.y + dy * (k + 1) / n);
  }
  return out;
}

const CORNERS = ['tl', 'tr', 'bl', 'br'];

/**
 * The lock inside `root` over the galaxy camera `cam` (camera.js: `onDraw`,
 * `screenOf`). `lockOn(leg)` locks onto a site leg's `target` chain
 * (lockTarget; the first id the camera can place wins), else the site;
 * `release()` opens it; a leg with `cut` (a tap, night 3 T10) takes the box
 * at once instead of waiting for the last lock to open. `leaderFrom()` says where the leader leaves the
 * caption plate (null: none); a calm target never has one; `avoid()` gives
 * the boxes it routes round (the names shown, labels.js `shown`). `clock`
 * and `size` are injectable.
 */
export function createGalaxyLock(root, cam, {
  timing = LOCK_TIMING, clock = globalThis.performance, size = null, leaderFrom = null, avoid = null,
} = {}) {
  const box = document.createElement('div');
  box.className = 'wall-lock';
  const corners = CORNERS.map((c) => {
    const e = document.createElement('span');
    e.className = `wall-lock-c wall-lock-${c}`;
    box.append(e);
    return e;
  });
  // The leader's two legs, one span each, drawn as wall.html's (scaleX of a 1 px span from its left end).
  const legs = [0, 1].map(() => {
    const e = document.createElement('span');
    e.className = 'wall-lock-leader';
    e.style.opacity = '0';
    box.append(e);
    return e;
  });
  const legOn = [false, false];
  // The last value written per element and property: a frame writes only what changed.
  const wrote = new Map();
  const put = (e, prop, v) => {
    let w = wrote.get(e);
    if (!w) wrote.set(e, (w = {}));
    if (w[prop] === v) return;
    w[prop] = v;
    e.style[prop] = v;
  };
  box.style.opacity = '0';
  root.append(box);

  const measure = size ?? (() => ({ W: root.clientWidth, H: root.clientHeight }));
  let cur = null;  // { id, chain, tone, startAt, leaveAt }
  let next = null;
  let armPx = -1;
  let shown = false;
  let led = false;
  let last = null; // what the last frame drew, for tests and the console

  const hideLeg = (i) => {
    if (legOn[i]) put(legs[i], 'opacity', '0');
    legOn[i] = false;
  };
  const hideLeader = () => {
    if (led) { hideLeg(0); hideLeg(1); }
    led = false;
  };
  const hideBox = () => {
    if (shown) put(box, 'opacity', '0');
    shown = false;
    last = null;
    hideLeader();
  };

  const drawn = (chain) => {
    for (const c of chain) {
      const sp = cam.screenOf(c.id);
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
    if (cur.leaveAt != null && now >= cur.leaveAt + timing.outMs) {
      cur = null;
      hideBox();
      return;
    }
    const t = lockProgress(now, cur, timing);
    const hit = t > 0 ? drawn(cur.chain) : null;
    if (!hit) { hideBox(); return; }
    const { sp } = hit;
    const { W, H } = measure();
    const g = lockGeometry3d({ r: sp.r, side: Math.min(W, H), t });
    const arm = Math.round(g.arm);
    if (arm !== armPx) {
      armPx = arm;
      box.style.setProperty('--lock-arm', `${arm}px`);
    }
    const x0 = (sp.x - g.d).toFixed(1), x1 = (sp.x + g.d - arm).toFixed(1);
    const y0 = (sp.y - g.d).toFixed(1), y1 = (sp.y + g.d - arm).toFixed(1);
    put(corners[0], 'transform', `translate3d(${x0}px, ${y0}px, 0)`);
    put(corners[1], 'transform', `translate3d(${x1}px, ${y0}px, 0)`);
    put(corners[2], 'transform', `translate3d(${x0}px, ${y1}px, 0)`);
    put(corners[3], 'transform', `translate3d(${x1}px, ${y1}px, 0)`);
    put(box, 'opacity', g.alpha.toFixed(2));
    shown = true;
    const from = cur.tone !== 'calm' && typeof leaderFrom === 'function' ? leaderFrom() : null;
    const l = from ? leaderPath(from, sp, g.d, arm, g.alpha, typeof avoid === 'function' ? avoid() : [], cur.route) : null;
    if (l) cur.route = l.route;
    const shut = lockGeometry3d({ r: sp.r, side: Math.min(W, H), t: 1 }).d;
    last = {
      id: hit.c.id, x: sp.x, y: sp.y, r: g.r, d: g.d, shut, alpha: g.alpha, leader: l,
      covers: [...cornerCovers(sp, shut, arm), ...(l ? leaderCovers(l) : [])],
    };
    if (!l) { hideLeader(); return; }
    for (let i = 0; i < legs.length; i++) {
      const sg = l.segs[i];
      if (!sg || sg.len <= 0) { hideLeg(i); continue; }
      // A leg with the next one drawn runs on one px (half the stroke) so the elbow has no notch.
      const len = sg.len + (l.segs[i + 1]?.len > 0 ? 1 : 0);
      put(legs[i], 'transform', `translate3d(${sg.x.toFixed(1)}px, ${sg.y.toFixed(1)}px, 0) rotate(${sg.angle.toFixed(4)}rad) scaleX(${len.toFixed(1)})`);
      if (!legOn[i]) put(legs[i], 'opacity', '');
      legOn[i] = true;
    }
    led = true;
  };
  const off = cam.onDraw(paint);

  const release = () => {
    next = null;
    if (cur && cur.leaveAt == null) cur.leaveAt = clock.now();
  };

  const lockOn = (leg) => {
    release();
    if (typeof leg?.id !== 'string') return;
    const arrive = Number.isFinite(leg.arriveMs) ? leg.arriveMs : 0;
    let startAt = clock.now() + Math.max(0, arrive - timing.leadMs);
    // Never take the box from a lock that is still opening, unless a finger
    // chose the target (night 3 T10, `leg.cut`): an answer comes at once.
    if (cur && leg.cut) cur = null;
    else if (cur) startAt = Math.max(startAt, cur.leaveAt + timing.outMs);
    const chain = Array.isArray(leg.target) && leg.target.length ? leg.target : [{ id: leg.id }];
    next = { id: chain[0].id, chain, tone: lockTone(leg.status), startAt, leaveAt: null };
  };

  return {
    lockOn,
    release,
    /**
     * What the brackets hold while they show, `{ id, r }` with `r` the css px
     * from its centre to the shut brackets, else null: its name goes outside
     * them (labels.js `held`), none sits on a bracket, and it does not move
     * while they close.
     */
    held: () => (last ? { id: last.id, r: last.shut } : null),
    /** The boxes the shut brackets (cornerCovers) and the leader take this frame, the leader whole even while it draws out (leaderCovers): no name goes there. */
    covers: () => last?.covers ?? [],
    /** The lock on screen and the one waiting, and what the last frame drew. */
    state: () => ({ cur: cur ? { ...cur } : null, next: next ? { ...next } : null, drawn: last }),
    el: box,
    destroy: () => { off?.(); box.remove(); },
  };
}
