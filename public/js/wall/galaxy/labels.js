// The galaxy's names (Wall plan night 2 T6, README §5, §7.A3): words in a
// layer over the WebGL canvas, so they always face the camera, stay crisp at
// any size and are drawn over everything in the scene (under the frame's
// vignette and the caption). Every frame each name is projected to the
// screen and a pure pass, `placeLabels`, keeps the ones that fit: trouble
// first, then sites (and the sun), then rooms and hosts, then the rest;
// a lower name that would overlap a higher one, the caption plate or the far
// fleet line tries its other sides and is hidden when none is free.
//
// Who is named: the sun and every site, always; a planet (room, host,
// builder, repo) once its system is opening; a dot (a service, a lane, a
// session) only in trouble or when the camera is close enough that its dot
// is big on screen (`dotNamed`). A folded cluster is one name: its site's,
// in the hue and with the shape of the worst it holds (caption.js GLYPH);
// once it opens, each thing in trouble names itself.
//
// Type (r8-film-ui 1): sites and the sun in the label face, caps, at the
// Wall's site step (type.js `stepsFor`); planets and dots in mono lowercase
// at the room step. No fourth step.
//
// `placeLabels`, `candidates`, `dotNamed`, `labelRank`, `labelText` and
// `labelSize` are pure (test/wall-galaxy-labels.test.mjs); `createLabels`
// is the small part that moves the spans.

import * as THREE from '../../../vendor/three/three.module.js';
import { GLYPH } from '../caption.js';
import { textW } from '../type.js';
import { toneOf, worseTone } from './palette.js';

/** Who wins a place: lower first. */
export const RANK = Object.freeze({ trouble: 0, site: 1, room: 2, rest: 3 });

/** Kinds named as a room or host (the third rank); other planets and dots are the rest. */
const ROOMISH = new Set(['host', 'room', 'builder']);

/** Gap (css px) between a thing on screen and its name, and between names. */
export const GAP = 6;

/** A dot is named when it is at least this many css px across on screen. */
export const DOT_NAMED_PX = 9;

/** A planet's name fades in over this part of its system's opening. */
export const OPEN_FADE = Object.freeze({ from: 0.45, to: 0.85 });

/** Line height of a name against its size. */
const LINE = 1.25;

/** Width of a mono character against the size, with the mono tracking (0.02em). */
const MONO_EM = 0.62;

/** True for warn and crit: the tones that need you (tour.js visits them first). */
const troubled = (tone) => tone === 'warn' || tone === 'crit';

/** The rank of a named thing: `kind` its node's kind, `tone` its tone (palette.js toneOf). */
export function labelRank(kind, tone) {
  if (troubled(tone)) return RANK.trouble;
  if (kind === 'site' || kind === 'core') return RANK.site;
  if (ROOMISH.has(kind)) return RANK.room;
  return RANK.rest;
}

/** A tone's shape (caption.js GLYPH, the Map's statusStyle shapes), null when calm. */
const SHAPE = Object.freeze({ crit: 'square', warn: 'tri', low: 'diamond' });
const shapeOf = (tone) => (SHAPE[tone] ? GLYPH[SHAPE[tone]] : null);

/** The words of a name in `tone`: sites caps, the rest lowercase; trouble leads with its shape. */
export function labelText(node, toneIn) {
  const tone = toneIn ?? toneOf(node);
  const raw = String(node?.label ?? node?.id ?? '').trim();
  const big = node?.kind === 'site' || node?.kind === 'core';
  const word = big ? raw.toUpperCase() : raw.toLowerCase();
  const glyph = shapeOf(tone);
  return glyph ? `${glyph} ${word}` : word;
}

/**
 * The box (css px) a name takes: `face` 'label' (condensed caps, type.js
 * textW) or 'mono', at `px`. Measured without the DOM, so the pass is the
 * same in a test and on the glass.
 */
export function labelSize(text, px, face) {
  const w = face === 'mono' ? [...String(text)].length * MONO_EM * px : textW(text, px);
  return { w: Math.ceil(w), h: Math.ceil(px * LINE) };
}

/** True when a dot of `tone`, `px` across on screen, is named. */
export const dotNamed = (tone, px) => tone !== 'calm' || px >= DOT_NAMED_PX;

/**
 * Where a name of `w` x `h` may sit round a thing drawn at `x, y`, `r` css px
 * in radius, best first: to its right, its left, above, below. Trouble gets
 * two more steps down (a stack under the thing) so a crowd of trouble still
 * names every one. Boxes are `{ x, y, w, h }`, top left.
 */
export function candidates(x, y, r, w, h, trouble = false) {
  const d = Math.max(0, r) + GAP;
  const out = [
    { x: x + d, y: y - h / 2, w, h },
    { x: x - d - w, y: y - h / 2, w, h },
    { x: x - w / 2, y: y - d - h, w, h },
    { x: x - w / 2, y: y + d, w, h },
  ];
  if (trouble) for (let i = 1; i <= 2; i++) out.push({ x: x - w / 2, y: y + d + i * (h + GAP / 2), w, h });
  return out;
}

/** True when two boxes overlap (touching is not overlapping). */
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A box from `{ x, y, w, h }` or a cover's `{ left, top, right, bottom }` (caption.js coverOf), else null. */
export function boxOf(c) {
  if (!c) return null;
  if (Number.isFinite(c.left)) return { x: c.left, y: c.top, w: c.right - c.left, h: c.bottom - c.top };
  return Number.isFinite(c.x) ? { x: c.x, y: c.y, w: c.w, h: c.h } : null;
}

const inside = (b, W, H) => b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H;

/**
 * The screen pass. `items` are `{ id, rank, near, cands, prefer }`: `near`
 * orders a rank (bigger first: closer to the camera), `cands` the boxes it
 * may take (candidates), `prefer` the index it had last frame (it keeps it
 * when still free, so names do not hop while the camera drifts). Items that
 * were shown last frame (`was`) go before the others of their rank. `covers`
 * are boxes (or covers, `boxOf`) nothing may overlap (the caption plate, the fleet line), `W`/`H`
 * the screen, `bodies` the discs drawn on it (`{ x, y, w, h, owner }`): a
 * name covers no sphere but its own. Returns a Map id → `{ box, at }` of the shown ones. Pure.
 */
export function placeLabels(items, { W = Infinity, H = Infinity, covers = [], was = null, bodies = [] } = {}) {
  const order = [...items].sort((a, b) => (a.rank - b.rank)
    || ((was?.has(b.id) ? 1 : 0) - (was?.has(a.id) ? 1 : 0))
    || ((b.near ?? 0) - (a.near ?? 0))
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = covers.map(boxOf).filter(Boolean);
  const shown = new Map();
  const free = (b, id, solid) => inside(b, W, H) && !taken.some((t) => overlaps(b, t))
    && !(solid && bodies.some((o) => o.owner !== id && overlaps(b, o)));
  for (const it of order) {
    const cs = it.cands ?? [];
    const tries = Number.isInteger(it.prefer) && cs[it.prefer] ? [it.prefer, ...cs.keys()] : [...cs.keys()];
    // Trouble that finds no side clear of the spheres takes one over a sphere:
    // its name matters more than the sphere it covers.
    const passes = it.rank === RANK.trouble ? [true, false] : [true];
    for (const i of passes.flatMap((solid) => tries.map((t) => [t, solid]))) {
      const b = cs[i[0]];
      if (!free(b, it.id, i[1])) continue;
      // Keep the gap between names too.
      taken.push({ x: b.x - GAP / 2, y: b.y - GAP / 4, w: b.w + GAP, h: b.h + GAP / 2 });
      shown.set(it.id, { box: b, at: i[0] });
      break;
    }
  }
  return shown;
}

/**
 * The names over `galaxy` (scene.js: `world`, `camera`, `renderer`), in
 * `root` (an empty layer over the canvas). `steps` are type.js stepsFor's
 * `{ site, room }` (css px); `covers()` the boxes the words over the canvas
 * take (hud.js). Call `draw()` after the scene renders (camera.js `onDraw`).
 */
export function createLabels(root, galaxy, { steps, covers = () => [], doc = globalThis.document } = {}) {
  root.style.setProperty('--gl-site', `${steps.site}px`);
  root.style.setProperty('--gl-room', `${steps.room}px`);
  const pool = new Map(); // id → { el, text, tone, size, x, y, alpha }
  let last = new Map();
  const v = new THREE.Vector3();
  // Every id the world names, made again when the galaxy is laid out again.
  let idsWorld = null, ids = new Set();
  const idsOf = (w) => {
    if (w !== idsWorld) {
      idsWorld = w;
      ids = new Set(w.core ? [w.core.id] : []);
      for (const s of w.sites) { ids.add(s.id); for (const m of s.members) ids.add(m.id); }
    }
    return ids;
  };

  const spanFor = (id, text, tone, face) => {
    let p = pool.get(id);
    if (!p) {
      const el = doc.createElement('span');
      el.className = 'galaxy-label';
      el.style.opacity = '0';
      root.append(el);
      p = { el, text: null, tone: null, face: null, key: '', alpha: 0 };
      pool.set(id, p);
    }
    if (p.text !== text) { p.el.textContent = text; p.text = text; }
    if (p.tone !== tone) { p.el.dataset.tone = tone; p.tone = tone; }
    if (p.face !== face) { p.el.dataset.face = face; p.face = face; }
    return p;
  };

  // A world point to css px, its depth, and css px per world unit there.
  const project = (p, W, H) => {
    const cam = galaxy.camera;
    v.set(p.x, p.y, p.z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    if (depth <= cam.near) return null;
    v.applyMatrix4(cam.projectionMatrix);
    const x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * H;
    const unit = H / (2 * Math.tan((cam.fov * Math.PI) / 360) * depth);
    return { x, y, unit };
  };

  const draw = () => {
    const w = galaxy.world;
    const el = galaxy.renderer?.domElement;
    const W = el?.clientWidth ?? 0, H = el?.clientHeight ?? 0;
    if (!w || !W || !H) return;
    galaxy.camera.updateMatrixWorld();
    const items = [];
    const meta = new Map();
    const bodies = [];
    const body = (id, sp, r) => { if (r >= 2) bodies.push({ x: sp.x - r, y: sp.y - r, w: 2 * r, h: 2 * r, owner: id }); };
    const add = (id, node, pos, radius, alpha, kind = node?.kind, toneIn = null) => {
      const tone = toneIn ?? toneOf(node);
      const sp = project(pos, W, H);
      if (!sp || sp.x < -W || sp.x > 2 * W || sp.y < -H || sp.y > 2 * H) return;
      const big = kind === 'site' || kind === 'core';
      const face = big ? 'label' : 'mono';
      const text = labelText(node, tone);
      const { w: bw, h: bh } = labelSize(text, big ? steps.site : steps.room, face);
      const rank = labelRank(kind, tone);
      const r = radius * sp.unit;
      body(id, sp, r);
      items.push({ id, rank, near: r, prefer: last.get(id)?.at, cands: candidates(sp.x, sp.y, r, bw, bh, rank === RANK.trouble) });
      meta.set(id, { text, tone, face, alpha });
    };

    if (w.core) add(w.core.id, w.core, { x: 0, y: 0, z: 0 }, w.sunRadius ?? 60, 1, 'core');
    for (const s of w.sites) {
      const k = Math.max(0, Math.min(1, s.open));
      const fade = Math.max(0, Math.min(1, (k - OPEN_FADE.from) / (OPEN_FADE.to - OPEN_FADE.from)));
      // Folded, the site's name carries the worst of what it holds (its
      // nebula's tone); open, each thing in trouble names itself.
      const folded = fade <= 0;
      add(s.id, s.node, s.home, s.starRadius ?? 24, 1, 'site', folded ? worseTone(toneOf(s.node), toneOf(s.status)) : toneOf(s.node));
      if (folded) continue;
      for (const m of s.members) {
        const t = m.tone ?? toneOf(m.node);
        const trouble = troubled(t);
        if (m.planet) {
          add(m.id, m.node, m.mesh.position, m.radius ?? 15, trouble ? 1 : fade);
          continue;
        }
        const sp = project(m.mesh.position, W, H);
        if (!sp) continue;
        if (!dotNamed(t, 2 * (m.radius ?? 4) * sp.unit)) { body(m.id, sp, (m.radius ?? 4) * sp.unit); continue; }
        add(m.id, m.node, m.mesh.position, m.radius ?? 4, trouble ? 1 : fade);
      }
    }

    const was = new Set(last.keys());
    const shown = placeLabels(items, { W, H, covers: covers(), was, bodies });
    for (const [id, { box }] of shown) {
      const m = meta.get(id);
      const p = spanFor(id, m.text, m.tone, m.face);
      const key = `${box.x.toFixed(1)},${box.y.toFixed(1)}`;
      if (key !== p.key) { p.el.style.transform = `translate3d(${key.replace(',', 'px, ')}px, 0)`; p.key = key; }
      const a = Math.round(m.alpha * 20) / 20;
      if (a !== p.alpha) { p.el.style.opacity = String(a); p.alpha = a; }
    }
    for (const [id, p] of pool) {
      if (shown.has(id)) continue;
      if (p.alpha !== 0) { p.el.style.opacity = '0'; p.alpha = 0; }
      // A name the galaxy no longer has goes for good.
      if (!idsOf(w).has(id)) {
        p.el.remove();
        pool.delete(id);
      }
    }
    last = shown;
  };

  return {
    draw,
    /** The names on screen now: `[{ id, text, tone, box }]`, for tests, stills and the console. */
    shown: () => [...last].map(([id, { box }]) => ({ id, text: pool.get(id)?.text, tone: pool.get(id)?.tone, box: { ...box } })),
    destroy: () => { for (const p of pool.values()) p.el.remove(); pool.clear(); },
  };
}
