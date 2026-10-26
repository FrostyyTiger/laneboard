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
// `lockGeometry3d` is pure (test/wall-galaxy-lock.test.mjs); `createGalaxyLock`
// is the DOM part, the same elements and classes as wall.html's lock; its
// `held()` keeps the names (labels.js) off the brackets.

import { LOCK_SIZE, LOCK_TIMING, leaderGeometry, lockProgress, lockTone } from '../lock.js';

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

const CORNERS = ['tl', 'tr', 'bl', 'br'];

/**
 * The lock inside `root` over the galaxy camera `cam` (camera.js: `onDraw`,
 * `screenOf`). `lockOn(leg)` locks onto a site leg's `target` chain
 * (lockTarget; the first id the camera can place wins), else the site;
 * `release()` opens it; a leg with `cut` (a tap, night 3 T10) takes the box
 * at once instead of waiting for the last lock to open. `leaderFrom()` says where the leader leaves the
 * caption plate (null: none); a calm target never has one. `clock` and
 * `size` are injectable.
 */
export function createGalaxyLock(root, cam, {
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
  const leader = document.createElement('span');
  leader.className = 'wall-lock-leader';
  leader.style.opacity = '0';
  box.append(leader);
  box.style.opacity = '0';
  root.append(box);

  const measure = size ?? (() => ({ W: root.clientWidth, H: root.clientHeight }));
  let cur = null;  // { id, chain, tone, startAt, leaveAt }
  let next = null;
  let armPx = -1;
  let shown = false;
  let led = false;
  let last = null; // what the last frame drew, for tests and the console

  const hideLeader = () => {
    if (led) leader.style.opacity = '0';
    led = false;
  };
  const hideBox = () => {
    if (shown) box.style.opacity = '0';
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
    corners[0].style.transform = `translate3d(${x0}px, ${y0}px, 0)`;
    corners[1].style.transform = `translate3d(${x1}px, ${y0}px, 0)`;
    corners[2].style.transform = `translate3d(${x0}px, ${y1}px, 0)`;
    corners[3].style.transform = `translate3d(${x1}px, ${y1}px, 0)`;
    box.style.opacity = g.alpha.toFixed(3);
    shown = true;
    const from = cur.tone !== 'calm' && typeof leaderFrom === 'function' ? leaderFrom() : null;
    const l = from ? leaderGeometry(from, sp, g.d, arm, g.alpha) : null;
    last = { id: hit.c.id, x: sp.x, y: sp.y, r: g.r, d: g.d, shut: lockGeometry3d({ r: sp.r, side: Math.min(W, H), t: 1 }).d, alpha: g.alpha, leader: l };
    if (!l) { hideLeader(); return; }
    leader.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0) rotate(${l.angle.toFixed(4)}rad) scaleX(${l.len.toFixed(1)})`;
    if (!led) leader.style.opacity = '';
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
    /** The lock on screen and the one waiting, and what the last frame drew. */
    state: () => ({ cur: cur ? { ...cur } : null, next: next ? { ...next } : null, drawn: last }),
    el: box,
    destroy: () => { off?.(); box.remove(); },
  };
}
