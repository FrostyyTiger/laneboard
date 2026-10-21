// The Map's hands: pointer, wheel and pinch input, the spatial hit grid, and
// the camera maths they share (plan §5 2.2, 2.9, 2.10).
//
// Nothing here touches the DOM at module top level, so `node --test` imports
// it. The maths (hit grid, camera, pinch, fit, selection order) is pure; only
// `bindPointer` attaches listeners, to the canvas it is handed, and it drives
// the map through a small `host` object that index.js supplies.
//
// Moved from views/map-canvas.js: the pointer and wheel handlers (:842-929),
// toScreen/toWorld and holdAnchor (:395-397, :988-993). The linear hit scan
// (:844-856) became createHitGrid; pinch and long-press are new.

import { SEVERITY } from './model.js';

/** Zoom limits (cam.z), as the wheel had them. */
export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 6;

/** Hold a finger this long on a node to open its actions. */
export const LONG_PRESS_MS = 500;

/** A press that moves less than this (CSS px) is a tap, not a drag. */
export const TAP_SLOP = 3;
export const TAP_SLOP_TOUCH = 8;

export const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : 1));

// ------------------------------------------------------------------ camera

/**
 * The scale that fits a world of radius `outer` into W x H (a strip at the
 * bottom kept for the readout). Always > 0: a hidden map (measured at 0 or 1
 * px) would otherwise get a negative scale, and every radius drawn with it
 * would throw in ctx.arc (night-1 bug: leaving the Map). Not positive -> 1.
 */
export function fitScaleOf(W, H, outer) {
  const o = Number.isFinite(outer) && outer > 0 ? outer : 1;
  const s = Math.min(W / (2 * o), (H - (W < 720 ? 40 : 20)) / (2 * o));
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/**
 * The fit for a canvas whose top and bottom are covered (`inset` {top, bottom}
 * in CSS px: the HUD row, a phone's bottom bar): the scale that fits a world
 * of radius `outer` into the free height, and the camera's world y that puts
 * the centre in the middle of it. No inset is fitScaleOf with the centre at 0.
 */
export function fitFrame(W, H, outer, inset = {}) {
  const top = Math.max(0, Number(inset.top) || 0);
  const bottom = Math.max(0, Number(inset.bottom) || 0);
  if (!top && !bottom) return { s: fitScaleOf(W, H, outer), y: 0 };
  const o = Number.isFinite(outer) && outer > 0 ? outer : 1;
  const free = H - top - bottom;
  const k = Math.min(W / (2 * o), free / (2 * o));
  const s = Number.isFinite(k) && k > 0 ? k : fitScaleOf(W, H, outer);
  return { s, y: free > 0 ? (bottom - top) / (2 * s) : 0 };
}

/** World -> screen scale for a view `{W, H, fitScale}` and a camera `{x, y, z}`. */
export const viewScale = (view, cam) => (view.fitScale || 1) * cam.z;

/** A world point on the canvas, in CSS px. */
export function toScreen(view, cam, p) {
  const s = viewScale(view, cam);
  return { x: view.W / 2 + (p.x - cam.x) * s, y: view.H / 2 + (p.y - cam.y) * s };
}

/** The world point under canvas px (x, y). */
export function toWorld(view, cam, x, y) {
  const s = viewScale(view, cam);
  return { x: (x - view.W / 2) / s + cam.x, y: (y - view.H / 2) / s + cam.y };
}

/**
 * The camera at zoom `z` that keeps world point `w` under canvas px (sx, sy):
 * the wheel's and the pinch's anchor (map-canvas.js holdAnchor).
 */
export function anchored(view, w, sx, sy, z) {
  const s = (view.fitScale || 1) * z;
  return { x: w.x - (sx - view.W / 2) / s, y: w.y - (sy - view.H / 2) / s, z };
}

/** The smallest-ish circle around points `[{x, y, r?}]` (bounding box centre), or null. */
export function boundingCircle(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (const p of points ?? []) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    n++;
  }
  if (!n) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let r = 0;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    r = Math.max(r, Math.hypot(p.x - cx, p.y - cy) + (p.r ?? 0));
  }
  return { x: cx, y: cy, r };
}

/**
 * The camera that fits a world circle into the view, leaving `pad` world
 * units around it and the right inset (the inspector overlay, CSS px) clear.
 * Never zooms in past `maxZ`.
 */
export function fitCircle(circle, view, { pad = 60, right = 0, maxZ = 2.6 } = {}) {
  const fs = view.fitScale || 1;
  const availW = Math.max(1, view.W - right);
  const r = Math.max(1, (circle?.r ?? 0) + pad);
  const z = Math.min(maxZ, clampZoom(Math.min(availW, view.H) / (2 * r * fs)));
  return { x: (circle?.x ?? 0) + right / (2 * fs * z), y: circle?.y ?? 0, z };
}

// ------------------------------------------------------------------ pinch

/** The midpoint and spread of two pointers. */
export function twoFinger(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}

/** Start a pinch: remember the spread, the zoom and the world point under the midpoint. */
export function pinchStart(a, b, view, cam) {
  const m = twoFinger(a, b);
  return { dist: m.dist, z: cam.z, w: toWorld(view, cam, m.x, m.y) };
}

/**
 * The camera during a pinch: zoom scales with the spread, and the world point
 * that was under the starting midpoint stays under the current midpoint, so
 * moving both fingers together pans.
 */
export function pinchMove(start, a, b, view) {
  const m = twoFinger(a, b);
  const z = clampZoom(start.z * (m.dist / start.dist));
  return anchored(view, start.w, m.x, m.y, z);
}

// ------------------------------------------------------------------ hit grid

/**
 * A spatial hash over screen-space discs, so a hit test looks at one cell
 * instead of every node (2.9). `rebuild(items, stamp)` takes `[{id, x, y, r}]`
 * in canvas px; `stale(stamp)` says whether a rebuild is due; `hit(x, y)`
 * returns the id of the nearest disc containing the point, or null.
 */
export function createHitGrid(cellPx = 48) {
  const cell = Math.max(4, cellPx);
  const cells = new Map();
  let items = [];
  let stamp;
  const key = (cx, cy) => `${cx},${cy}`;

  function rebuild(list, nextStamp) {
    cells.clear();
    items = [];
    for (const it of list ?? []) {
      if (!it || !Number.isFinite(it.x) || !Number.isFinite(it.y) || !(it.r > 0)) continue;
      const i = items.push(it) - 1;
      const cx0 = Math.floor((it.x - it.r) / cell), cx1 = Math.floor((it.x + it.r) / cell);
      const cy0 = Math.floor((it.y - it.r) / cell), cy1 = Math.floor((it.y + it.r) / cell);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const k = key(cx, cy);
          const bucket = cells.get(k);
          if (bucket) bucket.push(i); else cells.set(k, [i]);
        }
      }
    }
    stamp = nextStamp;
  }

  /** Indexes of the discs that may contain (x, y). */
  function candidates(x, y) {
    return cells.get(key(Math.floor(x / cell), Math.floor(y / cell))) ?? [];
  }

  function hit(x, y) {
    let best = null, bd = Infinity;
    for (const i of candidates(x, y)) {
      const it = items[i];
      const d = Math.hypot(it.x - x, it.y - y);
      if (d < it.r && d < bd) { best = it.id; bd = d; }
    }
    return best;
  }

  return {
    rebuild,
    hit,
    candidates,
    stale: (s) => s !== stamp,
    count: () => items.length,
    cellCount: () => cells.size,
    cellPx: cell,
  };
}

/** The hit radius of a node on screen (map-canvas.js hit, :851). */
export const hitRadius = (size, s) => Math.max(9, size * Math.max(0.8, s) + 6);

// ------------------------------------------------------------------ selection order

const TROUBLE_RANK = (s) => {
  const i = SEVERITY.indexOf(s ?? 'unknown');
  return i < 0 ? 0 : i;
};

/**
 * Lane ids in attention order (worst status first, then waiting, stuck, then
 * by label), for `j`/`k` on the map (§4 2.6, `selectNext`). `scope` limits the
 * list to one builder's lanes.
 */
export function laneOrder(nodes, { scope = 'all' } = {}) {
  const lanes = (nodes ?? []).filter((n) => n?.kind === 'lane'
    && (!scope || scope === 'all' || n.builder === scope));
  const weight = (n) => TROUBLE_RANK(n.status) * 4 + (n.flags?.awaitingApproval ? 2 : 0) + (n.flags?.stuck ? 1 : 0);
  return lanes
    .sort((a, b) => weight(b) - weight(a) || String(a.label ?? a.id).localeCompare(String(b.label ?? b.id)) || (a.id < b.id ? -1 : 1))
    .map((n) => n.id);
}

/** The id after `current` in `order` (dir 1) or before it (dir -1), wrapping; the first when current is not in it. */
export function nextInOrder(order, current, dir = 1) {
  if (!order?.length) return null;
  const i = order.indexOf(current);
  if (i < 0) return dir < 0 ? order[order.length - 1] : order[0];
  const n = order.length;
  return order[(((i + (dir < 0 ? -1 : 1)) % n) + n) % n];
}

// ------------------------------------------------------------------ pointer

/**
 * Attach pointer, wheel and double-click handling to `canvas`. One pointer
 * drags (and glides on release), two pinch-zoom and pan, a short press is a
 * tap, a 500 ms hold on a node is a long press. `host` is the map:
 *
 *   cam                      the camera object, mutated while dragging/pinching
 *   view() -> {W, H, fitScale}
 *   grab()                   stop flights, glides and wheel zooms
 *   moved()                  the user moved the camera
 *   kick()                   schedule a frame
 *   hit(x, y) -> id|null     badgeAt(x, y) -> id|null
 *   tap(id, pointerType)     fold(id)  dbl(id|null)  longPress(id)
 *   hover(id, x, y)          leave()
 *   glide({vx, vy})          wheel(x, y, k)   reduced() -> bool
 *   now() -> ms
 *
 * Returns an `unbind()` that removes every listener and timer.
 */
export function bindPointer(canvas, host) {
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let pressTimer = 0;
  const now = () => (host.now ? host.now() : Date.now());

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = 0; };

  function startDrag(p, type) {
    drag = { x: p.x, y: p.y, cx: host.cam.x, cy: host.cam.y, moved: false, trail: [], type, used: false };
  }

  function down(e) {
    canvas.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    // Grabbing the map stops whatever it was doing.
    host.grab();
    cancelPress();
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      pinch = pinchStart(a, b, host.view(), host.cam);
      drag = null;
      return;
    }
    startDrag(p, e.pointerType);
    if (e.pointerType !== 'mouse') {
      pressTimer = setTimeout(() => {
        pressTimer = 0;
        if (!drag || drag.moved || pinch) return;
        const id = host.hit(drag.x, drag.y);
        if (id) { drag.used = true; host.longPress(id); }
      }, LONG_PRESS_MS);
    }
  }

  function move(e) {
    const p = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      Object.assign(host.cam, pinchMove(pinch, a, b, host.view()));
      host.moved();
      host.kick();
      return;
    }
    if (drag) {
      const dx = p.x - drag.x, dy = p.y - drag.y;
      const slop = drag.type === 'mouse' ? TAP_SLOP : TAP_SLOP_TOUCH;
      if (!drag.moved && Math.hypot(dx, dy) > slop) { drag.moved = true; cancelPress(); }
      if (drag.moved) {
        const s = viewScale(host.view(), host.cam);
        host.cam.x = drag.cx - dx / s;
        host.cam.y = drag.cy - dy / s;
        host.moved();
        // The last few samples give the speed to glide on with.
        const t = now();
        drag.trail.push({ t, x: host.cam.x, y: host.cam.y });
        while (drag.trail.length > 2 && t - drag.trail[0].t > 90) drag.trail.shift();
        host.kick();
      }
      return;
    }
    host.hover(host.hit(p.x, p.y), p.x, p.y, Boolean(host.badgeAt(p.x, p.y)));
  }

  function up(e) {
    const p = local(e);
    pointers.delete(e.pointerId);
    cancelPress();
    if (pinch) {
      // Lifting one of two fingers ends the pinch; the other keeps panning, never taps.
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        startDrag([...pointers.values()][0], e.pointerType);
        drag.moved = true;
      } else drag = null;
      return;
    }
    const d = drag;
    drag = null;
    if (!d || d.used) return;
    if (!d.moved) {
      const badge = host.badgeAt(p.x, p.y);
      if (badge) { host.fold(badge); return; }
      host.tap(host.hit(p.x, p.y), e.pointerType);
      return;
    }
    if (host.reduced()) return;
    const tr = d.trail, t = now();
    const a = tr[0], b = tr[tr.length - 1];
    // A drag that came to rest before release does not glide.
    if (a && b && b.t > a.t && t - b.t < 60) {
      const vx = (b.x - a.x) / (b.t - a.t), vy = (b.y - a.y) / (b.t - a.t);
      if (Math.hypot(vx, vy) * viewScale(host.view(), host.cam) > 0.12) host.glide({ vx, vy });
    }
  }

  function cancel(e) {
    pointers.delete(e.pointerId);
    cancelPress();
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) drag = null;
  }

  function leave() {
    if (!drag && !pinch) host.leave();
  }

  function dbl(e) {
    const p = local(e);
    host.dbl(host.hit(p.x, p.y));
  }

  function wheel(e) {
    e.preventDefault();
    const p = local(e);
    // Line-mode wheels (Firefox) report lines, not pixels.
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    host.wheel(p.x, p.y, -dy * (e.ctrlKey ? 0.01 : 0.0022));
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('dblclick', dbl);
  canvas.addEventListener('wheel', wheel, { passive: false });

  return function unbind() {
    cancelPress();
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('pointerleave', leave);
    canvas.removeEventListener('dblclick', dbl);
    canvas.removeEventListener('wheel', wheel);
  };
}
