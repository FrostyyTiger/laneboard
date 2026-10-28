// The galaxy's scene (Wall plan night 2 T3, README §5): what three.js draws
// from the layout (layout.js). The hub is the sun; the sites are star
// clusters on two arms in a band of dust, a hyperlane from the sun to each;
// at the overview a cluster is folded inside a nebula in its worst status;
// opened, its rooms and builders are lit planets on inclined orbits, each
// on a stem down to the system's plane with a small ring where it lands.
//
// Colours come from the palette (palette.js, the tokens), never from here.
// Geometries, materials and textures shared by every site are made once;
// what belongs to one site is disposed when the site goes or is laid out
// again. Live data (T8, live.js): a status change recolours the same
// objects, a tree change folds, re-lays and opens the systems it touches.
//
// The camera is the page's to move (camera.js); this module only draws:
// `update(model)`, `setOpen(id, k)`, `frame(now)`.

import * as THREE from '../../../vendor/three/three.module.js';
import { armBand, armRibbon, galaxyLayout, dustPoints, farStars, foldAt, rng, hash, ease, CLOSED } from './layout.js';
import { tourOrder, tourSites } from '../tour.js';
import { TONES, nebulaFor, toneOf } from './palette.js';
import { LIVE, glide, planLive, relayPhase, siteKeys, treeKey } from './live.js';
import { LEVELS, pixelRatioFor } from './budget.js';
import { breathWave, dustTurn } from './still.js';
import { SUN, easeToward } from './fresh.js';
import { createStageSize } from './stage.js';
import { LOBES, armTangent, nebulaLobes, nebulaPeaks } from './nebula.js';
import { FRAMING, fitDistance, freeCentre, panShot } from './framing.js';
import {
  ACTIVITY, AFTERGLOW, BEACON, SWEEP, WARP, activityLook, afterglowAt, afterglows, beaconAt, beaconNear, beaconScale, beamProfile, coreProfile, jobAt, trackJobs, trackWork,
  warpAt, workAt,
} from './fx.js';

/**
 * World sizes: the sun, a site's star, a planet (named kind), a dot (the
 * rest). The sun is 70 % of the sketch's 60 and its halo narrower than a
 * crit nebula (r8-film-ui 2: the sun outshouted the trouble); night 5 A1
 * scales the halo with the nebulae (layout.js TIGHT.neb, 0.64; a literal,
 * as nothing imported is read at evaluation time; the layout test pins it).
 */
export const SIZE = Object.freeze({ sun: 42, sunHalo: 640 * 0.64, star: 24, planet: 15, dot: 4, landing: 7 });

/**
 * The sun's halo strength: at most half the crit nebula's 0.85 (README
 * §2.1: trouble is the loudest thing; test/wall-galaxy-sun.test.mjs).
 */
export const SUN_HALO = 0.3;

/** A halo's size against its sphere, and its resting strength, per tone. */
const HALO = Object.freeze({
  calm: { k: 4, opacity: 0.22 },
  low: { k: 5, opacity: 0.5 },
  warn: { k: 7, opacity: 0.8 },
  crit: { k: 9, opacity: 0.9 },
});

/** True for the tones that need you (tour.js visits them first). */
const troubled = (t) => t === 'warn' || t === 'crit';

/**
 * A member's drawn radius: a planet (named kind) at the planet size, and
 * so is anything in trouble (r8-film-ui 3: a problem is never the smallest
 * thing in the frame); the rest are dots.
 */
export const memberRadius = (planet, tone) => (planet || troubled(tone) ? SIZE.planet : SIZE.dot);

/**
 * A member's drawn radius with what it carries (night 5 A3, layout.js
 * carryScale): a planet's size times its `carry`; the rest are not carried.
 * The tone only decides planet size or dot, never the carry. Pure.
 */
export const bodyRadius = (m, tone) => memberRadius(m.planet, tone) * (m.planet ? m.carry ?? 1 : 1);

/** The shape a trouble member carries on its sphere (docs/design.md: ▲ wants you, ■ broken), null when calm. */
export const MARK_SHAPE = Object.freeze({ warn: 'tri', crit: 'square' });

/** The mark's size against its sphere's diameter, and how open its system must be before it shows. */
export const MARK = Object.freeze({ k: 0.6, from: 0.25, to: 0.6 });

/**
 * The dust round a held system thins so what it holds stands above it
 * (r8-film-ui 3): to `floor` out to `inner` times its reach, back to whole
 * at `outer` times it (never nearer than `min`). Measured along the line of
 * sight (dustSightDist), so the grains behind the system and in front of it
 * thin too: on screen they lie on it just the same.
 */
export const DUST_FADE = Object.freeze({ floor: 0.2, inner: 1.05, outer: 1.4, min: 160 });

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How far from the star `s` a grain at `p` looks, seen from `cam` (all
 * world points): the distance, at the star's depth, between the star and
 * the grain's line of sight. Behind the camera: Infinity. The dust shader
 * does the same sum in view space.
 */
export function dustSightDist(p, s, cam) {
  const P = [p.x - cam.x, p.y - cam.y, p.z - cam.z], S = [s.x - cam.x, s.y - cam.y, s.z - cam.z];
  const lp = Math.hypot(...P), ls = Math.hypot(...S);
  if (!lp || !ls) return 0;
  const c = (P[0] * S[0] + P[1] * S[1] + P[2] * S[2]) / (lp * ls);
  if (c <= 1e-3) return Infinity;
  return (ls * Math.sqrt(Math.max(0, 1 - c * c))) / c;
}

/** The dust fade's radius round a system that reaches `reach`. */
export const dustFadeRadius = (reach) => Math.max(DUST_FADE.min, (Number(reach) || 0) * DUST_FADE.outer);

/** Where the fade starts back up, as a share of dustFadeRadius. */
const DUST_EDGE = DUST_FADE.inner / DUST_FADE.outer;

/**
 * How bright a dust grain `dist` (dustSightDist) from a held system's star is drawn (1:
 * as ever), the system reaching `reach` and open `open` (0..1, eased by
 * the caller). The dust shader does the same sum on the GPU.
 */
export function dustFade(dist, reach, open = 1) {
  const r = dustFadeRadius(reach);
  const inside = 1 - smoothstep(r * DUST_EDGE, r, dist);
  return 1 - (1 - DUST_FADE.floor) * inside * Math.max(0, Math.min(1, open));
}

/** Trouble breathes: one slow period (ms), crit deep, warn shallow. */
export const PULSE = Object.freeze({ periodMs: 2600, crit: 0.4, warn: 0.15, nebula: 0.08 });

/**
 * Sphere segments (width, height) at the best level; budget.js's levels
 * scale them. `bigStar` (night 5 A3): a star that carries more than
 * BIG_STAR is drawn up to 2.2x, and a 20-gon that size shows its corners;
 * 26x18 keeps a star of up to 1.65x as round at its edge as a 1x star at
 * 20x14 (test/wall-galaxy-carry.test.mjs) for 364 more triangles a star.
 * Stars are flat-shaded, so only the edge can look faceted; planets are
 * already 32x22, round enough at 2.2x.
 */
const SEGS = Object.freeze({ sun: [32, 20], star: [20, 14], bigStar: [26, 18], planet: [32, 22], dot: [10, 8] });

/** Each sphere geometry's radius: a big star is the star's sphere, scaled by its carry like any star. */
const SPHERE_R = Object.freeze({ sun: SIZE.sun, star: SIZE.star, bigStar: SIZE.star, planet: SIZE.planet, dot: SIZE.dot });

/** A star's radius factor above which it takes the `bigStar` sphere. */
export const BIG_STAR = 1.2;

/** Which sphere a star carrying `carry` is drawn with. Pure. */
export const starSphere = (carry) => (carry > BIG_STAR ? 'bigStar' : 'star');

/**
 * A member dot's segments never exceed 8x6 (night 4 T12, r56-performance 3a):
 * a ball 2-6 px on screen looks the same at 8x6 as at 10x8. A cap, not a
 * fixed count: the lower levels already draw fewer (7x5, 6x4), and a fixed
 * 8x6 put 1.7k triangles back on the struggling device (lab open at L2:
 * 12.2k before, 13.9k with it).
 */
const DOT_CAP = Object.freeze([8, 6]);

/**
 * The segments `[width, height]` of a `kind`'s sphere (`sun`, `star`,
 * `planet`, `dot`) at a budget.js level's `seg` fraction. Pure.
 */
export function sphereSegs(kind, seg = 1) {
  const [w, h] = SEGS[kind];
  const out = [Math.max(6, Math.round(w * seg)), Math.max(4, Math.round(h * seg))];
  return kind === 'dot' ? [Math.min(out[0], DOT_CAP[0]), Math.min(out[1], DOT_CAP[1])] : out;
}

/**
 * A dust grain on screen: its size in world units, attenuated by distance,
 * and never more than `maxPx` css px across (the soft disc shows about 2 px
 * of it), so close up, where the nodes are big, a grain stays a speck
 * (T26, reviews/r26-skeptic.md 5).
 */
export const DUST_LOOK = Object.freeze({ size: 20, maxPx: 3 });

/**
 * What the camera passes close to fades (night 3 T2, r54-film-ui 3): a
 * nebula lobe, a star or the sun's halo taller than `from` of the frame's
 * height is a smash cut nobody asked for, so it fades out, gone at `to`.
 */
export const NEAR_FADE = Object.freeze({ from: 0.4, to: 0.7 });

/**
 * How much of a thing `size` world units across, `dist` from the camera
 * with a vertical field of view `fov` (degrees), is drawn: 1 up to
 * NEAR_FADE.from of the frame's height, 0 from NEAR_FADE.to, smooth between.
 */
export function nearFade(size, dist, fov = FOV) {
  if (!(size > 0)) return 1;
  if (!(dist > 0)) return 0;
  const share = size / (2 * Math.tan((fov * Math.PI) / 360) * dist);
  return 1 - smoothstep(NEAR_FADE.from, NEAR_FADE.to, share);
}

/**
 * No red without a name (night 4 T7, r41-operator galaxy 6): in a flight a
 * crit or warn nebula whose star has left the frame (or swung out on screen
 * faster than its star) was a red smear at the edge with no name near it,
 * since a name stands beside its star or not at all (labels.js, night 3
 * T17). So a lobe is held on a leash to its star's point, in the nebula's
 * reach on screen there (nebula.js LOBES.reach of its size, at the star's
 * depth): whole while its centre is within `from` reach of the star, gone
 * at `to`; and the whole nebula fades as its star comes within `edge` reach
 * (never more than `edge` of the frame's height) of the frame's edge, gone as
 * the star, and so its name, leaves it.
 */
export const LOBE_LEASH = Object.freeze({ from: 1, to: 1.5, edge: 0.25 });

/** The nebula tones held on the leash: the ones in a hue. */
const LEASHED = new Set(['crit', 'warn']);

/**
 * How much of a lobe whose centre is `d` css px from its star's point on
 * screen is drawn, the nebula reaching `reachPx` css px there and the star
 * `inset` css px inside the frame's nearest edge (negative: outside) in a
 * frame `height` css px tall: 1 up to LOBE_LEASH.from of that reach and
 * LOBE_LEASH.edge of it (or of the height, the less) from the edge, 0 from
 * LOBE_LEASH.to or at the edge, smooth between.
 */
export function lobeLeash(d, reachPx, inset = Infinity, height = Infinity) {
  if (!(reachPx > 0)) return 0;
  const near = 1 - smoothstep(LOBE_LEASH.from, LOBE_LEASH.to, d / reachPx);
  const band = LOBE_LEASH.edge * Math.min(reachPx, height);
  return inset >= band ? near : near * smoothstep(0, band, inset);
}

/**
 * The arm ribbon's strength at the fit (night 3 T3, r59-dreamer 2): a few
 * per cent of the text-3 grey, added under the dust, so the arms read as a
 * shape at the overview and never as data. It fades out as a system opens.
 */
export const RIBBON = Object.freeze({ opacity: 0.05 });

/** The ribbon's opacity with the most open system at `open` (0..1, eased). */
export const ribbonOpacity = (open) => RIBBON.opacity * (1 - Math.max(0, Math.min(1, Number(open) || 0)));

/**
 * The near-site bands' strength at the fit (T19, r11-dreamer galaxy 2): the
 * same text-3 grey, a few per cent brighter than the ribbon, only on the
 * spine round each site. Fades out with the ribbon as a system opens.
 */
export const BAND = Object.freeze({ opacity: 0.09 });

/** The bands' opacity with the most open system at `open` (0..1, eased). */
export const bandOpacity = (open) => BAND.opacity * (1 - Math.max(0, Math.min(1, Number(open) || 0)));

/** The far stars and dust grains at the best level. */
const STARS = 2500, DUST = 9000;
/**
 * How many far stars and dust grains streak under fx=warp (night 3 T12): the first of each, an even thinning;
 * night 4 T21 keeps WARP.share of night 3's 800 and 1500, and the cone takes most of those off the screen.
 */
export const WARP_STARS = 400, WARP_DUST = 750;
/** The dust's own opacity (fx=warp thins it from there while the camera flies). */
const DUST_OPACITY = 0.7;

/** Segments of a landing ring (a small circle under a planet, on the plane). */
const RING_SEGS = 16;

/** Segments of a hyperlane (a bowed line from the sun to a star). */
const LANE_SEGS = 40;

/** The camera's field of view (degrees) and the far plane. */
export const FOV = 42;

/** The overview's margin past the farthest site's star (world units): 400 at nights 1-4's scale. */
export const OVERVIEW_MARGIN = 400 * 0.5; // layout.js TIGHT.arm, pinned by the layout test

/**
 * Where the camera sits for the whole galaxy: above, at an angle, and always
 * the same pose (T24, reviews/r26-skeptic.md 7). It used to turn once in about
 * 7 minutes, so every name stood somewhere else at each overview and the
 * hallway had to find HOME again; depth comes from the drift round a held
 * system (`siteShot`), the overview holds still. Snug (night 5 A1): the
 * margin past the farthest star is OVERVIEW_MARGIN, at the arms' scale.
 */
export function overviewShot(sites, fov = FOV) {
  let r = 0;
  for (const s of sites) r = Math.max(r, Math.hypot(s.home.x, s.home.z));
  const d = ((r + OVERVIEW_MARGIN) / Math.tan((fov * Math.PI) / 360)) * 0.9;
  return {
    pos: { x: 0, y: d * 0.78, z: d * 0.62 },
    look: { x: 0, y: 0, z: 0 },
  };
}

/**
 * Where the camera sits for one open system: on the sun's side of it, up,
 * looking out across it, so the sun is behind and below the camera and
 * never in the frame (r8-film-ui 2), and the sun lights the faces we see.
 * The drift sways round that side (±SWAY rad, about 2.6 min a swing)
 * rather than circling, so a long hold never brings the sun round.
 */
export const SITE_SHOT = Object.freeze({ jitter: 0.7, sway: 0.5, speed: 0.00002 });
/**
 * With a `view` (`{ fov, aspect, free, scale }`, T18) the star sits at the
 * middle of the `free` box (framing.js `freeRect`: the frame minus the
 * caption plate and the fleet block) and the camera stands back just far
 * enough for the open system's reach to fit it; `scale` (the tour's zoom,
 * camera.js) moves it closer before it aims. Without one, the star is at
 * the frame's middle, as before.
 */
export function siteShot(site, now = 0, view = null) {
  const { jitter, sway, speed } = SITE_SHOT;
  // Framed, a big system close to the hub needs the camera farther back than
  // the hub is: from the sun's side it would hang over the sun, and looking in
  // from outside (nights 2-4) puts the sun at the frame's top, on the tag, once
  // the galaxy is snug (night 5 T1b). So it looks across from the side, the
  // sun off the frame's right edge past the free box (framing.js FRAMING.aside),
  // with no per-site jitter, which would bring the sun back in.
  const aside = view?.free && site.reach > FRAMING.inward * Math.hypot(site.home.x, site.home.z);
  const turn = aside ? FRAMING.aside : (hash(site.id) - 0.5) * jitter;
  const out = Math.atan2(-site.home.x, -site.home.z) + turn + sway * Math.sin((now * speed) / sway);
  // `d` is the camera's offset along the plane; it stands 0.75 d up, so 1.25 d from the star.
  let d = Math.max(560, site.reach * 1.9);
  if (view?.free) d = Math.max(560, fitDistance(site.reach, view.free, view.fov ?? FOV, view.aspect) / 1.25);
  if (view?.scale > 0) d *= view.scale;
  const shot = {
    pos: { x: site.home.x + Math.sin(out) * d, y: site.home.y + d * 0.75, z: site.home.z + Math.cos(out) * d },
    look: { ...site.home },
  };
  return view?.free ? panShot(shot, site.home, freeCentre(view.free), view.fov ?? FOV, view.aspect) : shot;
}

/** What `update` must notice: ids, parents, kinds and tones (a metric alone changes nothing). */
export function sceneKey(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter((n) => n && n.id != null)
    .map((n) => `${n.id}/${n.parent}/${n.kind}/${toneOf(n)}`)
    .join('|');
}

/** A soft round sprite: white falling off to nothing, tinted by the material. */
function glowTexture(doc) {
  const c = doc.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgb(255 255 255 / 1)');
  g.addColorStop(0.2, 'rgb(255 255 255 / 0.5)');
  g.addColorStop(1, 'rgb(255 255 255 / 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A thin soft ring (fx=activity): its line at 0.85 of the half-width, nothing inside or out. */
function ringTexture(doc) {
  const c = doc.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgb(255 255 255 / 0)');
  g.addColorStop(0.74, 'rgb(255 255 255 / 0)');
  g.addColorStop(0.85, 'rgb(255 255 255 / 1)');
  g.addColorStop(0.96, 'rgb(255 255 255 / 0)');
  g.addColorStop(1, 'rgb(255 255 255 / 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A dust grain: a smaller, softer disc. */
function dotTexture(doc) {
  const c = doc.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgb(255 255 255 / 1)');
  g.addColorStop(1, 'rgb(255 255 255 / 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** A status shape (MARK_SHAPE) in white, flat, to tint: ▲ or ■ filling most of the square. */
function markTexture(doc, shape) {
  const c = doc.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(255 255 255 / 1)';
  if (shape === 'square') {
    x.fillRect(12, 12, 40, 40);
  } else {
    // An even triangle, its centre of mass on the sphere's.
    x.beginPath();
    x.moveTo(32, 6);
    x.lineTo(60, 54);
    x.lineTo(4, 54);
    x.closePath();
    x.fill();
  }
  return new THREE.CanvasTexture(c);
}

/**
 * A beacon's pillar (fx=beacon): a soft band across (`peak` its middle's
 * strength), up its height by `profile` (fx.js beamProfile for the sheath,
 * coreProfile for the white-hot core). Canvas top is the pillar's tip.
 */
function beamTexture(doc, profile, peak) {
  const c = doc.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 32, 0);
  g.addColorStop(0, 'rgb(255 255 255 / 0)');
  g.addColorStop(0.3, `rgb(255 255 255 / ${0.25 * peak})`);
  g.addColorStop(0.5, `rgb(255 255 255 / ${peak})`);
  g.addColorStop(0.7, `rgb(255 255 255 / ${0.25 * peak})`);
  g.addColorStop(1, 'rgb(255 255 255 / 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 128);
  x.globalCompositeOperation = 'destination-in';
  const v = x.createLinearGradient(0, 0, 0, 128);
  for (let i = 0; i <= 16; i++) v.addColorStop(i / 16, `rgb(0 0 0 / ${profile(1 - i / 16).toFixed(3)})`);
  x.fillStyle = v;
  x.fillRect(0, 0, 32, 128);
  return new THREE.CanvasTexture(c);
}

/** A nebula: a lumpy cloud of a few offset blobs inside a round mask, the same on every load. */
function cloudTexture(doc, seed = 3) {
  const rand = rng(seed);
  const c = doc.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const cx = 128 + (rand() - 0.5) * 80, cy = 128 + (rand() - 0.5) * 80, r = 40 + rand() * 40;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgb(255 255 255 / 0.22)');
    g.addColorStop(1, 'rgb(255 255 255 / 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
  }
  // No blob ever meets the square's edge.
  x.globalCompositeOperation = 'destination-in';
  const m = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  m.addColorStop(0, 'rgb(0 0 0 / 1)');
  m.addColorStop(0.6, 'rgb(0 0 0 / 0.8)');
  m.addColorStop(1, 'rgb(0 0 0 / 0)');
  x.fillStyle = m;
  x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const webgl = (canvas) => new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const pageClock = () => globalThis.performance.now();

/**
 * The sweep's line (night 4 T18) as a flat sector on the plane, its bright
 * edge along +x and its trail behind it (toward -z: the line turns from +x
 * toward +z), from `inner` to `R` world units: `{ positions, shade, index }`,
 * `shade` each vertex's light 0..1 (the edge 1, the trail from
 * `trailShare` down to 0, both radial ends 0 so it has no hard end).
 */
export function sweepShape(R, timing = null, steps = 16) {
  timing ??= SWEEP;
  const angles = [0, timing.head];
  for (let i = 1; i <= steps; i++) angles.push(timing.head + ((timing.trail - timing.head) * i) / steps);
  const light = (a) => (a <= timing.head ? 1 : timing.trailShare * (1 - (a - timing.head) / (timing.trail - timing.head)) ** 2);
  const inner = Math.min(timing.inner, R * 0.5);
  const radii = [inner, inner + (R - inner) * 0.1, inner + (R - inner) * 0.8, R];
  const weight = [0, 1, 1, 0];
  const positions = new Float32Array(angles.length * radii.length * 3);
  const shade = new Float32Array(angles.length * radii.length);
  let v = 0;
  for (const a of angles) {
    for (let j = 0; j < radii.length; j++) {
      positions[v * 3] = radii[j] * Math.cos(a);
      positions[v * 3 + 2] = -radii[j] * Math.sin(a);
      shade[v] = light(a) * weight[j];
      v++;
    }
  }
  const index = [];
  for (let i = 0; i + 1 < angles.length; i++) {
    for (let j = 0; j + 1 < radii.length; j++) {
      const a = i * radii.length + j, b = a + radii.length;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions, shade, index };
}

/**
 * The scene on `canvas`. `palette` is paletteFrom's; `doc` makes the
 * sprite textures; `clock` is the time the eases count in (the frames'
 * `now`), `makeRenderer` the WebGL renderer (both injectable for tests).
 * `still` (reduced motion, still.js): trouble glows without breathing, the dust stays put.
 * `fx` (fx.js `parseFx`): the effects asked for; `activity` lights `setActivity`' planets and plays `setJobs`' jobs,
 * `beacon` stands a pillar over each crit cluster (`setCritAges` dates them),
 * `warp` streaks the sky while `setWarp` says the camera flies,
 * `afterglow` rings a cluster whose trouble cleared (it remembers the tones from one `update` to the next),
 * `sweep` turns a faint line round the plane and rings the clusters `setSweep` says pinged (none in still mode).
 * Returns `{ update, setOpen, setSun, setActivity, setJobs, setCritAges, setWarp, setSweep, drawn, planets, beams, frame, resize,
 * setQuality, size, camera, world, quality, pixelRatio, activity, jobs, beacons, afterglows, sweep, warp, renderer, dispose }`.
 * `ratio` pins the pixel ratio (`?ratio=`, for filming); else each quality level brings its own.
 * `stage` (stage.js, T29) keeps the canvas's css size so no frame reads layout; `size()` gives it to the
 * camera, the labels and the lock.
 */
export function createGalaxyScene(canvas, {
  palette, doc = globalThis.document, dpr = globalThis.devicePixelRatio || 1,
  clock = pageClock, makeRenderer = webgl, still = false, fx = null, ratio = null,
  stage = null,
} = {}) {
  const col = (rgb) => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  const tone = Object.fromEntries(TONES.map((t) => [t, col(palette[t])]));
  const bg = col(palette.bg);

  const sized = stage ?? createStageSize(canvas);
  const renderer = makeRenderer(canvas);
  let pixelRatio = pixelRatioFor(0, dpr, ratio);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(bg, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(bg, 0.00008);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 30000);

  // One light from the sun, a soft fill, and a key from above so the
  // planets read as spheres from any side.
  const white = col(palette.sun);
  scene.add(new THREE.PointLight(white, 2.2, 0, 0));
  scene.add(new THREE.AmbientLight(col(palette.calm), 0.55));
  const key = new THREE.DirectionalLight(white, 0.9);
  key.position.set(0.3, 1, 0.2);
  scene.add(key);

  // --- shared: textures, geometries, materials -----------------------------
  const glowTex = glowTexture(doc);
  const dotTex = dotTexture(doc);
  const cloudTex = cloudTexture(doc);
  const spheres = (seg) => Object.fromEntries(Object.keys(SEGS).map((k) => [
    k, new THREE.SphereGeometry(SPHERE_R[k], ...sphereSegs(k, seg)),
  ]));
  const geo = spheres(1);
  // A nebula lobe: a flat square in the galaxy's plane, stretched by its scale (nebula.js).
  const lobeGeo = new THREE.PlaneGeometry(1, 1);
  lobeGeo.rotateX(-Math.PI / 2);
  const shared = [glowTex, dotTex, cloudTex, lobeGeo];
  const keep = (m) => { shared.push(m); return m; };
  const flatMat = Object.fromEntries(TONES.map((t) => [t, keep(new THREE.MeshBasicMaterial({ color: tone[t] }))]));
  // Calm planets are matte grey with a faint glow of their own; trouble
  // glows from inside in its hue.
  const planetMat = Object.fromEntries(TONES.map((t) => [t, keep(new THREE.MeshStandardMaterial({
    color: tone[t], roughness: 0.75, metalness: 0.05,
    emissive: t === 'calm' ? bg : tone[t], emissiveIntensity: t === 'calm' ? 1 : 0.45,
  }))]));
  const haloMat = Object.fromEntries(TONES.map((t) => [t, keep(new THREE.SpriteMaterial({
    map: glowTex, color: tone[t], transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: HALO[t].opacity,
  }))]));

  // A trouble member's shape: dark on its lit sphere, facing the camera, over it.
  const markMat = Object.fromEntries(Object.entries(MARK_SHAPE).map(([t, shape]) => {
    const tex = keep(markTexture(doc, shape));
    return [t, keep(new THREE.SpriteMaterial({ map: tex, color: bg.clone(), transparent: true, depthTest: false, depthWrite: false }))];
  }));

  // --- the sky: far stars and the dust band, never rebuilt ------------------
  // Both are in random order, so a shorter draw range is an even thinning (setQuality).
  const stars = (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(farStars(STARS), 3));
    const m = new THREE.PointsMaterial({ color: col(palette.stars), size: 7, fog: false });
    const pts = new THREE.Points(g, m);
    scene.add(pts);
    shared.push(g, m);
    return pts;
  })();
  const dustHold = { value: new THREE.Vector4(0, 0, 0, 1) }, dustOpen = { value: 0 };
  // The cap in device px (gl_PointSize is), at the renderer's pixel ratio (setQuality keeps it so).
  const dustCap = { value: DUST_LOOK.maxPx * pixelRatio };
  const dust = (() => {
    const { positions, t } = dustPoints(DUST);
    const colours = new Float32Array(t.length * 3);
    const a = col(palette.dustIn), b = col(palette.dustOut), c = new THREE.Color();
    for (let i = 0; i < t.length; i++) {
      c.copy(a).lerp(b, t[i]);
      colours[i * 3] = c.r; colours[i * 3 + 1] = c.g; colours[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    const m = new THREE.PointsMaterial({
      size: DUST_LOOK.size, map: dotTex, vertexColors: true, transparent: true, opacity: DUST_OPACITY,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    // dustFade on the GPU: the grains round the held system thin to the floor.
    m.onBeforeCompile = (sh) => {
      sh.uniforms.dustHold = dustHold;
      sh.uniforms.dustOpen = dustOpen;
      sh.uniforms.dustCap = dustCap;
      sh.vertexShader = `uniform vec4 dustHold;\nuniform float dustOpen;\nuniform float dustCap;\n${sh.vertexShader}`
        .replace('#include <logdepthbuf_vertex>', 'gl_PointSize = min(gl_PointSize, dustCap);\n#include <logdepthbuf_vertex>')
        .replace('#include <project_vertex>', [
        '#include <project_vertex>',
        // dustSightDist in view space (the camera at the origin).
        'vec3 dustS = (viewMatrix * vec4(dustHold.xyz, 1.0)).xyz;',
        'float dustC = dot(normalize(mvPosition.xyz), normalize(dustS));',
        'float dustD = dustC > 0.001 ? length(dustS) * sqrt(max(0.0, 1.0 - dustC * dustC)) / dustC : 1e9;',
        'float dustIn = 1.0 - smoothstep(dustHold.w * EDGE, dustHold.w, dustD);',
        'vColor *= 1.0 - (1.0 - FLOOR) * dustIn * dustOpen;',
      ].join('\n').replace('EDGE', DUST_EDGE.toFixed(4)).replace('FLOOR', DUST_FADE.floor.toFixed(3)));
    };
    const pts = new THREE.Points(g, m);
    pts.name = 'dust';
    scene.add(pts);
    shared.push(g, m);
    return pts;
  })();

  // The arm ribbon (T3) and the near-site bands (T19): still shapes along the
  // arms' spines, under the dust (drawn first, no depth write), rebuilt only
  // when the site count changes.
  const armMesh = (name, opacity) => {
    const m = new THREE.MeshBasicMaterial({
      color: col(palette.arm), vertexColors: true, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    mesh.name = name;
    mesh.renderOrder = -1;
    mesh.userData.sites = -1;
    scene.add(mesh);
    shared.push(m);
    return mesh;
  };
  const ribbon = armMesh('arm-ribbon', RIBBON.opacity);
  const band = armMesh('arm-band', BAND.opacity);
  const shapeArm = (mesh, n, build) => {
    if (mesh.userData.sites === n) return;
    mesh.userData.sites = n;
    const { positions, shade, index } = build(n);
    const colours = new Float32Array(shade.length * 3);
    for (let i = 0; i < shade.length; i++) colours[i * 3] = colours[i * 3 + 1] = colours[i * 3 + 2] = shade[i];
    mesh.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    g.setIndex(index);
    mesh.geometry = g;
  };

  // The sun: the hub, at the origin. Its halo is a soft grey, quieter
  // than any nebula in trouble (README §2.1: trouble is the loudest thing).
  // The core is the text-2 grey, not white (r8-film-ui 2); the light stays white.
  // The dust is depth-tested (PointsMaterial's default), so no grain is drawn over the core.
  const sunCore = col(palette.sunCore);
  const sun = new THREE.Mesh(geo.sun, keep(new THREE.MeshBasicMaterial({ color: sunCore })));
  const sunHalo = new THREE.Sprite(keep(new THREE.SpriteMaterial({
    map: glowTex, color: sunCore, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: SUN_HALO,
  })));
  sunHalo.scale.setScalar(SIZE.sunHalo);
  scene.add(sun, sunHalo);
  // How fresh the data is shows on the sun (night 3 T6, fresh.js `sunLook`):
  // `setSun` gives the look asked for, each frame eases the drawn one toward it.
  const sunCold = col(palette.sunCold ?? palette.calm);
  let sunWant = { scale: 1, glow: 1, cold: 0 };
  const sunShown = { scale: 1, glow: 1, cold: 0 };
  let sunAt = null;
  const easeSun = (now) => {
    const dt = sunAt == null ? 0 : now - sunAt;
    sunAt = now;
    const was = sunShown.cold;
    sunShown.scale = easeToward(sunShown.scale, sunWant.scale, dt, SUN.ease.swellMs);
    sunShown.glow = easeToward(sunShown.glow, sunWant.glow, dt, SUN.ease.swellMs);
    sunShown.cold = easeToward(sunShown.cold, sunWant.cold, dt, SUN.ease.coldMs);
    sunHalo.scale.setScalar(SIZE.sunHalo * sunShown.scale);
    if (sunShown.cold !== was) {
      sun.material.color.copy(sunCore).lerp(sunCold, sunShown.cold);
      sunHalo.material.color.copy(sun.material.color);
    }
  };

  // --- the galaxy: built once, then kept up to date (T8, live.js) ----------
  // A status change recolours the same objects; a tree change folds the
  // systems it touches, lays them out again and opens them; a site that
  // came or went grows or shrinks on its spot; moved stars glide.
  let world = null;
  const lineMat = (rgb, opacity) => new THREE.LineBasicMaterial({ color: col(rgb), transparent: true, opacity, depthWrite: false });
  const group = new THREE.Group();
  scene.add(group);
  // Running eases, by `<site>:<what>`: a new one for the same thing takes over from where the old one is.
  const tweens = new Map();
  let dirty = true;
  const tween = (key, ms, apply, done = null) => {
    tweens.set(key, { t0: clock(), ms, apply, done });
    dirty = true;
  };

  const haloSize = (m, t) => (m.planet || troubled(t) ? bodyRadius(m, t) * HALO[t].k : t === 'calm' ? 0 : SIZE.dot * 2 * HALO[t].k);
  const sphereOf = (m) => (m.radius > SIZE.dot ? geo.planet : geo.dot);
  const laneLook = (t) => (t === 'calm'
    ? { color: col(palette.line.rgb), opacity: palette.line.alpha * 0.6 }
    : { color: tone[t].clone(), opacity: 0.5 });

  /** A member's tone: its mesh swaps to the shared material; its halo eases to its new size. */
  const paintMember = (s, m, t, ms) => {
    m.tone = t;
    const r0 = m.size ?? bodyRadius(m, t);
    m.radius = bodyRadius(m, t);
    // The sphere for the larger of the two sizes, so one growing in is never a coarse dot blown up.
    m.mesh.geometry = sphereOf({ radius: Math.max(r0, m.radius) });
    m.mesh.material = m.planet || troubled(t) ? planetMat[t] : flatMat[t];
    m.halo.material = haloMat[t];
    m.mark.material = markMat[t] ?? markMat.crit;
    dress(s, m, ms);
    const from = m.haloSize, to = haloSize(m, t);
    if (!ms || (from === to && r0 === m.radius)) {
      m.haloSize = to; m.size = m.radius; m.mesh.geometry = sphereOf(m); dirty = true; return;
    }
    tween(`${s.id}:halo:${m.id}`, ms, (k) => {
      m.haloSize = glide(from, to, k);
      m.size = glide(r0, m.radius, k);
      if (k >= 1) m.mesh.geometry = sphereOf(m);
    });
  };

  /** A site's star, nebula and hyperlane to its tone and status, eased over `ms` (0: at once). */
  const paintSite = (s, ms) => {
    const t = toneOf(s.node);
    s.star.material = flatMat[t];
    s.starHalo.material = haloMat[t];
    const neb = nebulaFor(s.status);
    if (neb.tone !== s.nebula?.tone) s.since = clock(); // how old its trouble is (nebulaPeaks)
    s.nebula = neb;
    const nebTo = { color: tone[neb.tone].clone(), opacity: neb.opacity, size: neb.size };
    const starTo = SIZE.star * s.carryTo * HALO[t].k;
    const laneEnd = laneLook(neb.tone);
    const set = (k) => {
      const nf = s.nebFrom, lf = s.laneFrom;
      s.neb.color.lerpColors(nf.color, nebTo.color, ease(k));
      s.neb.opacity = glide(nf.opacity, nebTo.opacity, k);
      s.neb.size = glide(nf.size, nebTo.size, k);
      s.starHaloSize = glide(s.starHaloFrom, starTo, k);
      s.lane.material.color.lerpColors(lf.color, laneEnd.color, ease(k));
      s.lane.material.opacity = glide(lf.opacity, laneEnd.opacity, k);
      for (const l of s.lobes) l.mesh.material.color.copy(s.neb.color);
    };
    s.nebFrom = { color: s.neb.color.clone(), opacity: s.neb.opacity, size: s.neb.size };
    s.laneFrom = { color: s.lane.material.color.clone(), opacity: s.lane.material.opacity };
    s.starHaloFrom = s.starHaloSize;
    if (!ms) { set(1); dirty = true; return; }
    tween(`${s.id}:paint`, ms, set);
  };

  /**
   * A site's members from its layout (`lay`: one of galaxyLayout's sites):
   * the old ones go, the new ones come at their tones; its star takes the
   * size its planets give it, eased over `ms` when it had one (0: at once).
   */
  const setMembers = (s, lay, ms = 0) => {
    const list = lay.members;
    for (const m of s.members) group.remove(m.mesh, m.halo, m.mark);
    for (const key of tweens.keys()) if (key.startsWith(`${s.id}:halo:`)) tweens.delete(key);
    const carry = lay.carry ?? 1, from = s.carry;
    s.carryTo = carry;
    s.star.geometry = geo[starSphere(carry)];
    // starRadius: what labels.js stands a site's name beside.
    if (!ms || from == null || from === carry) { s.carry = carry; s.starRadius = SIZE.star * carry; }
    else tween(`${s.id}:carry`, ms, (k) => { s.carry = glide(from, carry, k); s.starRadius = SIZE.star * s.carry; });
    s.members = list.map((lm) => {
      const m = { id: lm.id, node: lm.node, off: { ...lm.off }, planet: lm.planet, carry: lm.carry ?? 1, tone: 'calm', haloSize: 0 };
      m.mesh = new THREE.Mesh(m.planet ? geo.planet : geo.dot, flatMat.calm);
      m.halo = new THREE.Sprite(haloMat.calm);
      m.mark = new THREE.Sprite(markMat.crit);
      m.mark.name = 'mark';
      m.mark.renderOrder = 2;
      group.add(m.mesh, m.halo, m.mark);
      paintMember(s, m, toneOf(lm.node), 0);
      return m;
    });
    // Orbit spokes, stems and landing rings: one line set per system, sized for its planets.
    const planets = s.members.filter((m) => m.planet).length;
    const old = s.lines.geometry;
    s.lines.geometry = new THREE.BufferGeometry();
    s.lines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(planets * (4 + RING_SEGS * 2) * 3), 3));
    old.dispose();
    s.reach = Math.max(0, ...s.members.map((m) => Math.hypot(m.off.x, m.off.y, m.off.z)));
    dirty = true;
  };

  /** The hyperlane from the sun to a site's star, bowed along the arm. */
  const drawLane = (s) => {
    const end = new THREE.Vector3(s.home.x, s.home.y, s.home.z);
    const mid = end.clone().multiplyScalar(0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.35);
    const pts = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), mid, end).getPoints(LANE_SEGS);
    const attr = s.lane.geometry.attributes.position;
    if (!attr) { s.lane.geometry.setFromPoints(pts); return; }
    for (let i = 0; i < pts.length; i++) attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
    attr.needsUpdate = true;
    s.lane.geometry.computeBoundingSphere();
  };

  /** A site's objects (lay: one of galaxyLayout's sites), added to the galaxy. */
  const makeSite = (lay, status) => {
    const neb = nebulaFor(status);
    const star = new THREE.Mesh(geo.star, flatMat.calm);
    const starHalo = new THREE.Sprite(haloMat.calm);
    // The nebula round the cluster (T17): two or three lobes flat in the plane, each its own
    // material, stretched along the arm; it thins as the system opens.
    // forceSinglePass (T27): three draws a transparent DoubleSide material twice, back then front,
    // and flags it for a new program before each pass, every frame; an additive flat quad needs no
    // sort of its own faces, so one pass draws the same thing.
    const lobes = nebulaLobes(lay.id).map((shape) => {
      const mesh = new THREE.Mesh(lobeGeo, new THREE.MeshBasicMaterial({
        map: cloudTex, color: tone[neb.tone], transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
        blending: THREE.AdditiveBlending, opacity: neb.opacity * shape.share,
      }));
      mesh.name = 'nebula';
      return { shape, mesh };
    });
    const nebulaSprite = lobes[0].mesh;
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(palette.line.rgb, 0));
    lines.frustumCulled = false;
    // The system's plane: one thin circle round its star.
    const plane = new THREE.Mesh(new THREE.RingGeometry(1, 1.006, 128), new THREE.MeshBasicMaterial({
      color: col(palette.line.rgb), side: THREE.DoubleSide, forceSinglePass: true, transparent: true, opacity: 0,
      depthWrite: false,
    }));
    plane.rotation.x = -Math.PI / 2;
    const lane = new THREE.Line(new THREE.BufferGeometry(), lineMat(palette.line.rgb, 0));
    group.add(star, starHalo, ...lobes.map((l) => l.mesh), lines, plane, lane);
    const s = {
      id: lay.id, node: lay.node, home: { ...lay.home }, reach: lay.reach, status, nebula: null, since: clock(), peak: 1,
      star, starHalo, members: [], nebulaSprite, lobes, lines, plane, lane,
      open: 0, squeeze: 1, alive: 1, unfold: 0, relay: null, gone: false,
      neb: { color: tone[neb.tone].clone(), opacity: neb.opacity, size: neb.size }, starHaloSize: 0,
    };
    drawLane(s);
    setMembers(s, lay);
    paintSite(s, 0);
    return s;
  };

  const dropSite = (s) => {
    for (const key of tweens.keys()) if (key.startsWith(`${s.id}:`)) tweens.delete(key);
    for (const m of s.members) group.remove(m.mesh, m.halo, m.mark);
    group.remove(s.star, s.starHalo, ...s.lobes.map((l) => l.mesh), s.lines, s.plane, s.lane);
    for (const o of [...s.lobes.map((l) => l.mesh.material), s.lines.geometry, s.lines.material, s.plane.geometry, s.plane.material, s.lane.geometry, s.lane.material]) o.dispose();
  };

  const index = (sites, core) => {
    world = { sites, core, byId: new Map(sites.map((s) => [s.id, s])), version: (world?.version ?? 0) + 1, sunRadius: SIZE.sun };
    dirty = true;
  };

  /** A site's nebula lobes on its star, lying along the arm there; `breath` scales them (frame). */
  const basis = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0), tx = new THREE.Vector3(), nx = new THREE.Vector3();
  const lobeTwist = new THREE.Quaternion();
  const lobeTurn = [0, Math.PI].map((r) => new THREE.Quaternion().setFromAxisAngle(up, r));
  const placeLobes = (s, breath = s.breath ?? 1) => {
    const t = armTangent(s.home);
    tx.set(t.x, 0, t.z);
    nx.set(-t.z, 0, t.x); // tx × up: a right-handed basis, so no lobe is a mirror by accident
    basis.makeBasis(tx, up, nx);
    const size = s.neb.size * breath * s.alive;
    for (const { shape, mesh } of s.lobes) {
      mesh.position.set(
        s.home.x + (tx.x * shape.along + nx.x * shape.across) * size,
        s.home.y,
        s.home.z + (tx.z * shape.along + nx.z * shape.across) * size,
      );
      lobeTwist.setFromAxisAngle(up, shape.turn);
      mesh.quaternion.setFromRotationMatrix(basis).multiply(lobeTwist).multiply(lobeTurn[shape.flip & 1]);
      mesh.scale.set(Math.max(1e-3, shape.len * size), 1, Math.max(1e-3, shape.wid * size) * (shape.flip & 2 ? -1 : 1));
    }
  };

  /**
   * The crits ranked by age, the newest the hottest (nebula.js nebulaPeaks), a tie in the tour's
   * order (`order`: site ids, tourOrder); each site's peak eases there over `ms`.
   */
  const rankPeaks = (order, ms = LIVE.recolourMs) => {
    const at = new Map(order.map((id, i) => [id, i]));
    const live = world.sites.filter((s) => !s.gone).sort((a, b) => (at.get(a.id) ?? 1e9) - (at.get(b.id) ?? 1e9));
    const peaks = nebulaPeaks(live.map((s) => ({ id: s.id, tone: s.nebula.tone, since: s.since })));
    for (const s of world.sites) {
      const to = peaks.get(s.id) ?? 1, from = s.peak;
      if (to === from) continue;
      if (!ms) { s.peak = to; dirty = true; continue; }
      tween(`${s.id}:peak`, ms, (k) => { s.peak = glide(from, to, k); });
    }
  };

  /** Puts every member where its system's opening (times a relayout's squeeze) says. */
  const place = () => {
    for (const s of world.sites) {
      const k = Math.max(0, Math.min(1, s.open)) * s.squeeze;
      s.unfold = k;
      const a = s.alive;
      s.star.position.set(s.home.x, s.home.y, s.home.z);
      s.starHalo.position.copy(s.star.position);
      placeLobes(s);
      s.plane.position.copy(s.star.position);
      const arr = s.lines.geometry.attributes.position.array;
      let j = 0;
      const push = (x, y, z) => { arr[j++] = x; arr[j++] = y; arr[j++] = z; };
      const e = ease(k);
      const spread = CLOSED + (1 - CLOSED) * e;
      for (const m of s.members) {
        const o = foldAt(k, m.off);
        const x = s.home.x + o.x * a, y = s.home.y + o.y * a, z = s.home.z + o.z * a;
        m.mesh.position.set(x, y, z);
        m.mesh.scale.setScalar((a * m.size * (m.lift ?? 1)) / m.mesh.geometry.parameters.radius);
        m.halo.position.set(x, y, z);
        m.halo.visible = m.haloSize * a > 0.5;
        m.halo.scale.setScalar(Math.max(1e-3, m.haloSize * a));
        // The shape shows as the system opens (folded, the nebula and the site's name carry it).
        m.mark.position.set(x, y, z);
        m.markShown = MARK_SHAPE[m.tone] ? smoothstep(MARK.from, MARK.to, k) * a : 0;
        m.mark.scale.setScalar(Math.max(1e-3, m.size * 2 * MARK.k * m.markShown));
        m.mark.visible = m.markShown > 0.02;
        if (!m.planet) continue;
        push(s.home.x, s.home.y, s.home.z); push(x, y, z); // the spoke to its star
        push(x, y, z); push(x, s.home.y, z); // the stem down to the plane
        const r = SIZE.landing * spread * a;
        for (let i = 0; i < RING_SEGS; i++) {
          const a0 = (i / RING_SEGS) * Math.PI * 2, a1 = ((i + 1) / RING_SEGS) * Math.PI * 2;
          push(x + Math.cos(a0) * r, s.home.y, z + Math.sin(a0) * r);
          push(x + Math.cos(a1) * r, s.home.y, z + Math.sin(a1) * r);
        }
      }
      s.lines.geometry.setDrawRange(0, j / 3);
      s.lines.geometry.attributes.position.needsUpdate = true;
      s.lines.material.opacity = palette.line.alpha * (0.3 + 1.2 * e) * a;
      s.plane.scale.setScalar(Math.max(60, s.reach * 0.9) * spread + 20);
      s.plane.material.opacity = palette.line.alpha * 0.6 * e * a;
      fadeNear(s);
    }
    dirty = false;
  };

  /** The first model: every site at once, folded. */
  const build = (lay, shown) => {
    const sites = lay.sites.filter((s) => shown.has(s.id)).map((s) => makeSite(s, shown.get(s.id)));
    index(sites, lay.core);
  };

  /** A status change: the same objects, new tones. */
  const recolour = (lay, shown, ms = LIVE.recolourMs) => {
    const layById = new Map(lay.sites.map((s) => [s.id, s]));
    for (const s of world.sites) {
      const ls = layById.get(s.id);
      if (!ls || s.gone) continue;
      s.node = ls.node;
      s.status = shown.get(s.id) ?? s.status;
      paintSite(s, ms);
      // A site in the middle of a relayout gets its members' tones when they swap in.
      if (s.relay && !s.relay.swapped) { s.relay.lay = ls; continue; }
      const nodeOf = new Map(ls.members.map((m) => [m.id, m.node]));
      for (const m of s.members) {
        const n = nodeOf.get(m.id);
        if (!n) continue;
        m.node = n;
        const t = toneOf(n);
        if (t !== m.tone) paintMember(s, m, t, ms);
      }
    }
    world.core = lay.core;
  };

  /** A tree change: fold → relayout → open the sites it touches, grow the new ones, shrink the gone. */
  const relive = (lay, shown) => {
    const before = siteKeys(world.sites.filter((s) => !s.gone));
    const laid = lay.sites.filter((s) => shown.has(s.id));
    const plan = planLive(before, siteKeys(laid));
    const now = clock();
    const sites = [];
    for (const ls of laid) {
      let s = world.byId.get(ls.id);
      if (plan.added.includes(ls.id) || !s) {
        if (s) { dropSite(s); s.dropped = true; } // it was on its way out: start again
        s = makeSite(ls, shown.get(ls.id));
        s.alive = 0;
        tween(`${s.id}:alive`, LIVE.foldMs, (k) => { s.alive = glide(0, 1, k); });
        sites.push(s);
        continue;
      }
      sites.push(s);
      // A star whose place moved glides there; the camera reads `home` as it goes.
      const from = { ...s.home }, to = ls.home;
      if (from.x !== to.x || from.y !== to.y || from.z !== to.z) {
        tween(`${s.id}:home`, LIVE.glideMs, (k) => { Object.assign(s.home, glide(from, to, k)); drawLane(s); });
      }
      if (plan.changed.includes(ls.id)) {
        const r = s.relay;
        // Already folding: the new layout waits at the bottom; already opening again: fold from where it is.
        if (r && !r.swapped) r.lay = ls;
        else s.relay = { t0: now, from: s.squeeze, lay: ls, swapped: false };
        dirty = true;
      } else {
        // The same members: their open places may still shift a little in the new layout.
        const offOf = new Map(ls.members.map((m) => [m.id, m.off]));
        const moves = s.members.map((m) => ({ m, from: { ...m.off }, to: offOf.get(m.id) ?? m.off }));
        if (moves.some(({ from: a, to: b }) => a.x !== b.x || a.y !== b.y || a.z !== b.z)) {
          tween(`${s.id}:offs`, LIVE.glideMs, (k) => { for (const { m, from: a, to: b } of moves) m.off = glide(a, b, k); });
        }
        s.reach = ls.reach;
      }
    }
    for (const id of plan.removed) {
      const s = world.byId.get(id);
      s.gone = true;
      const a0 = s.alive;
      tween(`${s.id}:alive`, LIVE.foldMs, (k) => { s.alive = glide(a0, 0, k); }, () => {
        dropSite(s);
        index(world.sites.filter((x) => x !== s), world.core);
      });
      sites.push(s);
    }
    // Sites already shrinking away stay until they are gone.
    for (const s of world.sites) if (s.gone && !s.dropped && !sites.includes(s)) sites.push(s);
    index(sites, lay.core);
    recolour(lay, shown);
  };

  /** Runs the eases and relayouts at `now`; places the members when anything moved. */
  const advance = (now) => {
    for (const [key, t] of tweens) {
      const k = Math.max(0, Math.min(1, (now - t.t0) / t.ms));
      t.apply(k);
      dirty = true;
      if (k >= 1) {
        tweens.delete(key);
        t.done?.();
      }
    }
    for (const s of world?.sites ?? []) {
      if (!s.relay) continue;
      const r = s.relay;
      const ph = relayPhase(now - r.t0, r.from);
      if (ph.swap && !r.swapped) {
        r.swapped = true;
        setMembers(s, r.lay, LIVE.recolourMs);
        paintSite(s, LIVE.recolourMs);
        world.version += 1;
      }
      s.squeeze = ph.squeeze;
      if (ph.done) { s.squeeze = 1; s.relay = null; }
      dirty = true;
    }
    if (world && dirty) place();
  };

  /** Each site's, member's and the core's node swapped for the one of the same id in `nodes`. */
  const repoint = (nodes) => {
    if (!world) return;
    const byId = new Map(nodes.filter((n) => n && n.id != null).map((n) => [n.id, n]));
    for (const s of world.sites) {
      s.node = byId.get(s.id) ?? s.node;
      for (const m of s.members) m.node = byId.get(m.id) ?? m.node;
    }
    if (world.core) world.core = byId.get(world.core.id) ?? world.core;
  };

  let lastKey = null, lastTree = null;
  const update = (model) => {
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const k = sceneKey(nodes);
    if (k === lastKey) {
      // Same tree, same tones: no repaint, but the drawn things hold this model's nodes, so
      // what the names read from them (a countdown's `at`, a renamed label) is not a frame old.
      repoint(nodes);
      return false;
    }
    lastKey = k;
    const shown = new Map(tourSites(nodes).map((s) => [s.id, s.status]));
    const tree = treeKey(nodes, shown.keys());
    // Only the shown sites take the rosette's slots (layout.js), so a hidden one leaves no gap.
    const lay = galaxyLayout(nodes, undefined, shown.keys());
    if (!world) build(lay, shown);
    else if (tree === lastTree) recolour(lay, shown);
    else relive(lay, shown);
    rankPeaks(tourOrder(nodes).map((s) => s.id), lastTree === null ? 0 : LIVE.recolourMs);
    lastTree = tree;
    place();
    trackAfterglows();
    return true;
  };

  const setOpen = (id, k) => {
    const s = world?.byId.get(id);
    if (!s) return;
    s.open = Math.max(0, Math.min(1, Number(k) || 0));
    place();
  };

  let cw = 0, ch = 0;
  const resize = (w = sized.get().W, h = sized.get().H) => {
    if (w === cw && h === ch) return;
    cw = w; ch = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  /** Every id the galaxy draws (its sites and their members): flowJobs' `drawn`. */
  const drawn = () => new Set((world?.sites ?? []).filter((s) => !s.gone).flatMap((s) => [s.id, ...s.members.map((m) => m.id)]));
  /** Every id the galaxy draws as a sphere (its stars and planets): workingPlanets' `planets`. */
  const planets = () => new Set((world?.sites ?? []).filter((s) => !s.gone).flatMap((s) => [s.id, ...s.members.filter((m) => m.planet).map((m) => m.id)]));
  // What is drawn where, by id (`{ pos, site, member }`), rebuilt when the world's members change.
  let where = null, whereVersion = -1;
  const thingOf = (id) => {
    if (whereVersion !== world.version) {
      where = new Map();
      for (const s of world.sites) {
        if (s.gone) continue;
        where.set(s.id, { pos: s.star.position, site: s, member: null });
        for (const m of s.members) where.set(m.id, { pos: m.mesh.position, site: s, member: m });
      }
      whereVersion = world.version;
    }
    return where.get(id) ?? null;
  };
  const pointOf = (id, siteId) => (thingOf(id) ?? thingOf(siteId))?.pos ?? null;
  // --- fx=activity (night 4 T17, fx.js): what is at work comes forward -----
  // Pools made once: per lit planet a glow and a thin ring (facing the
  // camera, on the sphere, following it as its system opens), per job a
  // flash ring on its target or a grain that stops short of it. A lit calm
  // planet takes the busy material and grows a step (`m.lift`, eased, read
  // by place()); a calm planet with nothing at work takes the quiet one.
  // Trouble is never touched: its own material, no glow, no ring (it
  // breathes already). Under reduced motion the ring is steady and a job is
  // its end state, held for as long as it would play.
  const activity = Boolean(fx?.has('activity'));
  let work = new Map();
  let jobs = { playing: [], seen: new Set() };
  const glows = [], loops = [], flashes = [], misses = [];
  const actMat = {};
  if (activity) {
    const ringTex = keep(ringTexture(doc));
    const light = col(palette.sun);
    const pool = (list, n, name, map) => {
      for (let i = 0; i < n; i++) {
        const sp = new THREE.Sprite(keep(new THREE.SpriteMaterial({
          map, color: light, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
        })));
        sp.name = name;
        sp.visible = false;
        list.push(sp);
        scene.add(sp);
      }
    };
    pool(glows, ACTIVITY.max, 'fx-activity', glowTex);
    pool(loops, ACTIVITY.max, 'fx-activity-ring', ringTex);
    pool(flashes, ACTIVITY.jobs, 'fx-land', ringTex);
    pool(misses, ACTIVITY.jobs, 'fx-miss', glowTex);
    // Busy: its own grey lit a little from inside. Quiet: a step toward the ground.
    actMat.busy = keep(planetMat.calm.clone());
    actMat.busy.emissive = tone.calm.clone().lerp(bg, 0.55);
    actMat.quiet = keep(planetMat.calm.clone());
    actMat.quiet.color = tone.calm.clone().lerp(bg, 1 - ACTIVITY.quiet);
  }
  /** Whether a planet is at work now (lit, not fading out). */
  const atWork = (id) => work.get(id)?.until === Infinity;
  /** A calm planet's activity look: the busy or quiet material, and its size step eased over `ms` (0: at once). */
  const dress = (s, m, ms) => {
    if (!activity) return;
    const on = m.planet && m.tone === 'calm';
    if (on) m.mesh.material = atWork(m.id) ? actMat.busy : actMat.quiet;
    const to = on && atWork(m.id) ? activityLook(work.get(m.id).count).grow : 1;
    if (m.liftTo === to) return;
    const from = m.lift ?? 1;
    m.liftTo = to;
    if (!ms || still) { m.lift = to; dirty = true; return; }
    tween(`${s.id}:lift:${m.id}`, ms, (k) => { m.lift = glide(from, to, k); });
  };
  /** The planets at work (fx.js `workingPlanets`); ignored unless `fx=activity`. */
  const setActivity = (list) => {
    if (!activity) return;
    work = trackWork(work, list, clock());
    for (const s of world?.sites ?? []) for (const m of s.members) dress(s, m, LIVE.recolourMs);
  };
  /** The jobs in the last model (fx.js `flowJobs`); ignored unless `fx=activity`. */
  const setJobs = (list) => {
    if (!activity) return;
    jobs = trackJobs(jobs, list, clock());
  };
  // The ring texture's line sits at RING_AT of its half-width: a sprite `d` wide shows a ring `d * RING_AT / 2` round.
  const RING_AT = 0.85;
  const drawActivity = (now) => {
    for (const sp of glows) sp.visible = false;
    for (const sp of loops) sp.visible = false;
    if (!world) return;
    // One frame height in world units at a point's depth: the floor for what must read from far.
    const tall = 2 * Math.tan((camera.fov * Math.PI) / 360);
    let i = 0;
    for (const [id, w] of work) {
      const lit = workAt(w, now, ACTIVITY, still);
      if (lit === undefined) { work.delete(id); continue; }
      const at = thingOf(id);
      if (i >= glows.length || !at || at.site.gone) continue;
      const t = at.member ? at.member.tone : toneOf(at.site.node);
      if (t !== 'calm') continue;
      const look = activityLook(w.count);
      const r = (at.member ? at.member.size * (at.member.lift ?? 1) : SIZE.star * (at.site.carry ?? 1)) * at.site.alive;
      const glow = glows[i], ring = loops[i];
      i += 1;
      const far = tall * camera.position.distanceTo(at.pos) * at.site.alive;
      glow.position.copy(at.pos);
      glow.scale.setScalar(Math.max(1e-3, r * ACTIVITY.glow, 2 * far * ACTIVITY.minGlow));
      glow.material.opacity = look.glow * lit.k;
      glow.visible = glow.material.opacity > 0.005;
      ring.position.copy(at.pos);
      ring.scale.setScalar(Math.max(1e-3, (2 * Math.max(r * ACTIVITY.ring, far * ACTIVITY.minRing)) / RING_AT));
      ring.material.opacity = ACTIVITY.ringOpacity * look.ring * lit.k * (ACTIVITY.ringFloor + (1 - ACTIVITY.ringFloor) * lit.ring);
      ring.visible = ring.material.opacity > 0.005;
    }
  };
  const drawJobs = (now) => {
    for (const sp of flashes) sp.visible = false;
    for (const sp of misses) sp.visible = false;
    jobs.playing = jobs.playing.filter((j) => jobAt(j, now) !== undefined);
    if (!world) return;
    const tall = 2 * Math.tan((camera.fov * Math.PI) / 360);
    jobs.playing.forEach((j, n) => {
      const at = jobAt(j, now, ACTIVITY, still);
      const a = pointOf(j.from, j.fromSite), b = pointOf(j.to, j.toSite);
      if (!at || !a || !b) return;
      if (at.flash) {
        const sp = flashes[n];
        const [f0, f1] = ACTIVITY.flash;
        // Its world size, grown as a whole when that is under the floor from this far.
        const up = Math.max(1, (tall * camera.position.distanceTo(b) * ACTIVITY.flashMin) / (SIZE.planet * f1));
        sp.position.copy(b);
        sp.scale.setScalar((2 * SIZE.planet * up * (f0 + (f1 - f0) * at.flash.r)) / RING_AT);
        sp.material.opacity = ACTIVITY.flashOpacity * at.flash.k;
        sp.visible = sp.material.opacity > 0.005;
        return;
      }
      const sp = misses[n], u = at.miss.u;
      sp.position.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
      const size = Math.max(SIZE.planet * ACTIVITY.missSize, 2 * tall * camera.position.distanceTo(sp.position) * ACTIVITY.missMin);
      sp.scale.setScalar(size * (1 + 1.5 * at.miss.spread));
      sp.material.opacity = ACTIVITY.missOpacity * at.miss.k;
      sp.visible = sp.material.opacity > 0.005;
    });
  };

  // --- fx=beacon (T21, night 3 T9; fx.js): how long a crit has lasted -----
  // One pillar (a crit sheath and a white-hot core) and one tip light per
  // crit cluster, from a pool made once. A cluster's crit began at the
  // older of when the page saw its nebula turn crit (`s.since`) and what
  // the model's events say (`setCritAges`). Its size is set in the
  // overview's screen (fx.js beaconScale from overviewShot): the same world
  // size in every shot, so it stands as tall over an open system as the
  // overview made it, and fades once the camera is so close it looks much
  // wider than there (fx.js beaconNear). The pillar turns round its own axis to face the
  // camera, so it is a line of light from any side; it fades to `held`
  // while its system is open. Under reduced motion it stands and goes at
  // once; so does every crit already there when the page first draws (it
  // did not just begin).
  const beacons = new Map(); // site id → { from, crit, t0, k0 } (fx.js beaconAt)
  let critFrom = new Map(), beamsSeen = false;
  let beamScales = { version: -1, of: new Map() }; // site id → beaconScale, per world
  const pillars = [];
  if (fx?.has('beacon')) {
    const sheathTex = keep(beamTexture(doc, beamProfile, 0.7));
    const coreTex = keep(beamTexture(doc, coreProfile, 1));
    const beamGeo = keep(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
    const beamMat = (map, color) => keep(new THREE.MeshBasicMaterial({
      map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    }));
    for (let i = 0; i < BEACON.max; i++) {
      const pillar = new THREE.Mesh(beamGeo, beamMat(sheathTex, tone.crit));
      pillar.name = 'fx-beacon';
      // The core is the text's white (palette.sun, --text-1): bright in greyscale and without red.
      const core = new THREE.Mesh(beamGeo, beamMat(coreTex, white));
      core.name = 'fx-beacon-core';
      core.renderOrder = 1;
      const tip = new THREE.Sprite(keep(new THREE.SpriteMaterial({
        map: glowTex, color: tone.crit, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      })));
      tip.name = 'fx-beacon-tip';
      pillar.visible = core.visible = tip.visible = false;
      pillars.push({ pillar, core, tip });
      scene.add(pillar, core, tip);
    }
  }
  /** How old each crit is by the model (fx.js `critAges`: site id → ms); ignored unless `fx=beacon`. */
  const setCritAges = (ages) => {
    if (!pillars.length) return;
    const now = clock();
    critFrom = new Map([...(ages ?? [])].map(([id, ms]) => [id, now - ms]));
  };
  /** A site's beaconScale from the overview (made once per world). */
  const beamScaleOf = (s) => {
    if (beamScales.version !== world.version) beamScales = { version: world.version, of: new Map() };
    let sc = beamScales.of.get(s.id);
    if (sc === undefined) {
      sc = beaconScale(overviewShot(world.sites.filter((w) => !w.gone)), s.home, FOV);
      beamScales.of.set(s.id, sc);
    }
    return sc;
  };
  const drawBeacons = (now) => {
    for (const { pillar, core, tip } of pillars) pillar.visible = core.visible = tip.visible = false;
    if (!world) return;
    for (const s of world.sites) {
      const crit = !s.gone && s.nebula?.tone === 'crit';
      const from = Math.min(s.since, critFrom.get(s.id) ?? Infinity);
      const b = beacons.get(s.id);
      if (crit && !b) beacons.set(s.id, { from, crit, t0: now, k0: beamsSeen ? 0 : 1 });
      else if (b && b.crit !== crit) beacons.set(s.id, { from: crit ? from : b.from, crit, t0: now, k0: beaconAt(b, now, BEACON, still).rise });
      else if (b && crit) b.from = from;
    }
    beamsSeen = true;
    let i = 0;
    for (const [id, b] of beacons) {
      const s = world.byId.get(id);
      const at = beaconAt(b, now, BEACON, still);
      if (!s || (!b.crit && at.rise <= 0.001)) { beacons.delete(id); continue; }
      const sc = beamScaleOf(s);
      if (!sc) continue;
      const slot = pillars[i];
      if (!slot) break;
      i += 1;
      const h = Math.max(1e-3, sc.rise(at.height) * at.rise * s.alive);
      const w = Math.max(1e-3, sc.across(at.width));
      // Close by, it looks wider than at the overview: fade it (beaconNear).
      const seen = Math.hypot(camera.position.x - s.home.x, camera.position.y - s.home.y - h / 2, camera.position.z - s.home.z);
      const ratio = w / Math.max(1, 2 * seen * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1e-6, at.width);
      const k = Math.min(1, at.rise * 2) * s.alive * (1 - (1 - BEACON.held) * ease(s.unfold)) * beaconNear(ratio);
      slot.id = id;
      const { pillar, core, tip } = slot;
      const turn = Math.atan2(camera.position.x - s.home.x, camera.position.z - s.home.z);
      for (const m of [pillar, core]) {
        m.position.set(s.home.x, s.home.y, s.home.z);
        m.rotation.set(0, turn, 0);
      }
      pillar.scale.set(w, h, 1);
      pillar.material.opacity = BEACON.opacity * k;
      core.scale.set(w * BEACON.core, h, 1);
      core.material.opacity = BEACON.coreOpacity * k;
      tip.position.set(s.home.x, s.home.y + h, s.home.z);
      tip.scale.setScalar(BEACON.tip);
      tip.material.opacity = BEACON.opacity * 0.6 * k;
      pillar.visible = core.visible = tip.visible = pillar.material.opacity > 0.005;
    }
  };

  /**
   * The pillars drawn now, for a finger (night 4 T2, touch.js beamSegments):
   * `[{ id, foot, tip }]`, the site and its pillar's ends in world units. Empty
   * without `fx=beacon`. Read when a finger asks, never per frame.
   */
  const beams = () => pillars
    .filter((p) => p.pillar.visible && p.id != null)
    .map((p) => ({ id: p.id, foot: { ...p.pillar.position }, tip: { ...p.tip.position } }));

  // --- fx=afterglow (night 4 T16; fx.js afterglows, afterglowAt): where trouble was --
  // One thin ring per recent clear, flat on the plane round its cluster,
  // from a pool made once. The scene remembers each site's nebula tone from
  // one model to the next (update); a fall out of warn or crit is a clear.
  // The ring's line is AFTERGLOW.line of the frame thick seen from the
  // overview (beaconScale's `across`, its geometry made again only when the
  // slot's site or the world changes), cools by fx.js afterglowAt, dims
  // while its system is open and fades once the camera is close, as the
  // beacon does. Under reduced motion it is there at once and only ages.
  let glowState = null; // fx.js afterglows' memory
  const rings = [];
  const ringHue = { crit: tone.crit, warn: tone.warn, grey: tone.calm };
  if (fx?.has('afterglow')) {
    for (let i = 0; i < AFTERGLOW.max; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.99, 1, 128), keep(new THREE.MeshBasicMaterial({
        color: tone.calm.clone(), side: THREE.DoubleSide, forceSinglePass: true, transparent: true, opacity: 0, depthWrite: false,
      })));
      ring.rotation.x = -Math.PI / 2;
      ring.name = 'fx-afterglow';
      ring.visible = false;
      rings.push({ ring, key: null, id: null });
      scene.add(ring);
    }
  }
  /** After a model: what each drawn site's nebula says now, against what it said (fx.js afterglows). */
  const trackAfterglows = () => {
    if (!rings.length || !world) return;
    const tones = world.sites.filter((s) => !s.gone).map((s) => [s.id, s.nebula?.tone ?? 'calm']);
    glowState = afterglows(glowState, tones, clock());
  };
  const drawAfterglows = (now) => {
    let i = 0;
    for (const c of glowState?.clears.values() ?? []) {
      const s = world?.byId.get(c.id);
      const at = s && !s.gone ? afterglowAt(c, now, AFTERGLOW, still) : undefined;
      const sc = at ? beamScaleOf(s) : null;
      const slot = rings[i];
      if (!sc || !slot) continue;
      i += 1;
      const { ring } = slot;
      const width = sc.across(AFTERGLOW.line);
      const key = `${c.id}:${world.version}`;
      if (slot.key !== key) {
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(Math.max(0.5, 1 - width / AFTERGLOW.radius), 1, 128);
        slot.key = key;
      }
      slot.id = c.id;
      ring.position.set(s.home.x, s.home.y, s.home.z);
      ring.scale.setScalar(AFTERGLOW.radius * s.alive);
      ring.material.color.lerpColors(ringHue[at.from], ringHue[at.to], at.mix);
      const seen = Math.hypot(camera.position.x - s.home.x, camera.position.y - s.home.y, camera.position.z - s.home.z);
      const ratio = width / Math.max(1, 2 * seen * Math.tan((camera.fov * Math.PI) / 360)) / AFTERGLOW.line;
      ring.material.opacity = at.alpha * at.k * s.alive * (1 - (1 - BEACON.held) * ease(s.unfold)) * beaconNear(ratio);
      ring.visible = ring.material.opacity > 0.005;
    }
    for (; i < rings.length; i++) { rings[i].ring.visible = false; rings[i].id = null; }
  };

  // --- fx=sweep (night 4 T18; fx.js createSweep): one turn of fresh data per cycle --
  // One flat sector from the sun (sweepShape: a bright edge, a trail behind
  // it), grey and additive, made once and turned to `setSweep`'s angle; its
  // reach follows the farthest cluster (made again only when the world
  // changes). A pool of thin rings, flat round a cluster, for the pings (a
  // ring's line AFTERGLOW-style: `pingLine` of the frame seen from the
  // overview). Hidden at rest; in still mode none of it is made.
  let sweepWant = null; // `{ line, pings }` from fx.js createSweep's frame, or null
  let sweepLine = null;
  const pingRings = [];
  if (fx?.has('sweep') && !still) {
    sweepLine = new THREE.Mesh(new THREE.BufferGeometry(), keep(new THREE.MeshBasicMaterial({
      color: tone.calm.clone(), vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    })));
    sweepLine.name = 'fx-sweep';
    sweepLine.visible = false;
    sweepLine.userData.key = null;
    scene.add(sweepLine);
    const pingHue = col(palette.bright ?? palette.calm);
    for (let i = 0; i < SWEEP.max; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.99, 1, 96), keep(new THREE.MeshBasicMaterial({
        color: pingHue, side: THREE.DoubleSide, forceSinglePass: true, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })));
      ring.rotation.x = -Math.PI / 2;
      ring.name = 'fx-sweep-ping';
      ring.visible = false;
      pingRings.push({ ring, key: null, id: null });
      scene.add(ring);
    }
  }
  /** The sweep's meshes: its line and the ping rings (null and none without `fx=sweep` or in still mode). */
  const sweep = () => ({ line: sweepLine, pings: pingRings.map((r) => r.ring) });
  /** The sweep now (`{ line, pings }`, fx.js createSweep's frame) or null; ignored unless `fx=sweep`. */
  const setSweep = (f) => { if (sweepLine) sweepWant = f ?? null; };
  const sweepReach = () => {
    let far = 0;
    for (const s of world?.sites ?? []) if (!s.gone) far = Math.max(far, Math.hypot(s.home.x, s.home.z) + (s.reach || 0) * 0.5);
    return Math.max(SWEEP.inner * 4, far * SWEEP.reach);
  };
  const drawSweep = () => {
    const line = world ? sweepWant?.line : null;
    if (line) {
      if (sweepLine.userData.key !== world.version) {
        const { positions, shade, index } = sweepShape(sweepReach());
        const colours = new Float32Array(shade.length * 3);
        for (let i = 0; i < shade.length; i++) colours[i * 3] = colours[i * 3 + 1] = colours[i * 3 + 2] = shade[i];
        sweepLine.geometry.dispose();
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
        g.setIndex(index);
        sweepLine.geometry = g;
        sweepLine.userData.key = world.version;
      }
      sweepLine.rotation.y = -line.angle;
      sweepLine.material.opacity = SWEEP.opacity * Math.max(0, Math.min(1, line.k));
    }
    sweepLine.visible = Boolean(line) && sweepLine.material.opacity > 0.003;
    let i = 0;
    for (const p of (world ? sweepWant?.pings : null) ?? []) {
      const s = world.byId.get(p.id);
      const slot = pingRings[i];
      const sc = s && !s.gone ? beamScaleOf(s) : null;
      if (!sc || !slot) continue;
      i += 1;
      const { ring } = slot;
      const key = `${p.id}:${world.version}`;
      if (slot.key !== key) {
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(Math.max(0.5, 1 - sc.across(SWEEP.pingLine) / SWEEP.pingRadius), 1, 96);
        slot.key = key;
      }
      slot.id = p.id;
      ring.position.set(s.home.x, s.home.y, s.home.z);
      ring.scale.setScalar(SWEEP.pingRadius * p.r * s.alive);
      ring.material.opacity = SWEEP.pingOpacity * p.k * s.alive * (1 - ease(s.unfold));
      ring.visible = ring.material.opacity > 0.005;
    }
    for (; i < pingRings.length; i++) { pingRings[i].ring.visible = false; pingRings[i].id = null; }
  };

  // --- fx=warp (night 3 T12, T28, night 4 T21; fx.js warpAt, warpTail, warpCone, warpCovered): a flight has a target and a tint --
  // A line from each of the first WARP_STARS far stars and WARP_DUST dust
  // grains to a tail pushed toward the destination's point on screen by
  // WARP.len of its distance (in the vertex shader, view space: every streak
  // the same angle, never past the target's ray: fx.js warpTail), so the sky
  // streams out of a vanishing point on the target; the share of each streak
  // nearest it takes the destination's hue at full token value. With no site
  // to aim at (a flight to the overview, a target behind the camera) the tail
  // goes along the camera's travel. Only grains in a cone round that way
  // streak (warpCone), white with the hue on the leading tip; none starts on
  // a crit nebula's disc and no pixel lands on one (warpCovered, the discs in
  // drawing-buffer px, so the fragment shader tests gl_FragCoord). Made once, hidden at rest (no draw, and a
  // frame does nothing but one check); the dust's streaks are its child, so
  // they turn with it.
  const warpDir = { value: new THREE.Vector3(0, 0, -1) };
  const warpAim = { value: new THREE.Vector3() }, warpAimOn = { value: 0 };
  const coneCos = (d) => Math.cos((d * Math.PI) / 180);
  const warpCone = { value: new THREE.Vector2(coneCos(WARP.cone), coneCos(WARP.cone - WARP.coneEdge)) };
  const warpCrit = { value: Array.from({ length: WARP.crits }, () => new THREE.Vector3()) };
  const warpView = { value: new THREE.Vector2(1, 1) };
  const warpWhite = col(palette.sun); // the streaks' body (T21): white, the hue only on the tip
  let warpDiscs = []; // the crit discs as last drawn, `{ id, x, y, r }` in drawing-buffer px (origin bottom left)
  const warpParts = [];
  let warpWant = null; // `{ k, to }` from the camera's flight, or null
  let warpShown = warpAt(null);
  const warpLast = new THREE.Vector3(), warpStep = new THREE.Vector3();
  let warpHas = false, warpOn = false;
  if (fx?.has('warp')) {
    const streaks = (src, n, share, parent, name) => {
      const pos = new Float32Array(n * 6), tail = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 3; j++) pos[i * 6 + j] = pos[i * 6 + 3 + j] = src[i * 3 + j];
        tail[i * 2 + 1] = 1;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: {
          warpDir, warpAim, warpAimOn, warpCone, warpCrit, warpView, warpLen: { value: 0 }, warpOpacity: { value: 0 },
          warpBody: { value: warpWhite.clone() }, warpHead: { value: col(palette.calm) }, warpHeadFrom: { value: 1 - WARP.head },
        },
        vertexShader: [
          'uniform vec3 warpDir;', 'uniform vec3 warpAim;', 'uniform float warpAimOn;', 'uniform float warpLen;',
          'uniform vec2 warpCone;', `uniform vec3 warpCrit[${WARP.crits}];`, 'uniform vec2 warpView;',
          'attribute float tail;', 'varying float vTail;', 'varying float vKeep;',
          'void main() {',
          '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          '  vec3 aim = (viewMatrix * vec4(warpAim, 1.0)).xyz;',
          '  bool aimed = warpAimOn > 0.5 && aim.z < -1e-3;',
          '  vec3 axis = aimed ? aim : (viewMatrix * vec4(warpDir, 0.0)).xyz;',
          '  float keep = smoothstep(warpCone.x, warpCone.y, dot(normalize(mv.xyz), normalize(axis)));',
          '  vec4 at = projectionMatrix * mv;',
          '  if (at.w > 1e-3) {',
          '    vec2 px = (at.xy / at.w * 0.5 + 0.5) * warpView;',
          `    for (int i = 0; i < ${WARP.crits}; i++) if (warpCrit[i].z > 0.0 && distance(px, warpCrit[i].xy) < warpCrit[i].z) keep = 0.0;`,
          '  }',
          '  float reach = keep > 0.0 ? warpLen * length(mv.xyz) * tail : 0.0;',
          '  if (aimed && mv.z < -1e-3) {',
          '    vec2 gap = aim.xy * (mv.z / aim.z) - mv.xy;',
          '    float g = length(gap);',
          '    if (g > 1e-6) mv.xy += gap * (min(reach, g) / g);',
          '  } else {',
          '    mv.xyz += normalize((viewMatrix * vec4(warpDir, 0.0)).xyz) * reach;',
          '  }',
          '  vTail = tail;',
          '  vKeep = keep;',
          '  gl_Position = projectionMatrix * mv;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform vec3 warpBody;', 'uniform vec3 warpHead;', 'uniform float warpHeadFrom;', 'uniform float warpOpacity;',
          `uniform vec3 warpCrit[${WARP.crits}];`,
          'varying float vTail;', 'varying float vKeep;',
          'void main() {',
          '  if (vKeep <= 0.0) discard;',
          `  for (int i = 0; i < ${WARP.crits}; i++) if (warpCrit[i].z > 0.0 && distance(gl_FragCoord.xy, warpCrit[i].xy) < warpCrit[i].z) discard;`,
          '  float h = smoothstep(warpHeadFrom - 0.04, warpHeadFrom + 0.04, vTail);',
          '  gl_FragColor = vec4(mix(warpBody * (1.0 - 0.45 * vTail), warpHead, h) * warpOpacity * vKeep, 1.0);',
          '  #include <colorspace_fragment>',
          '}',
        ].join('\n'),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      });
      const lines = new THREE.LineSegments(g, m);
      lines.name = name;
      lines.visible = false;
      lines.frustumCulled = false; // the shader moves its tails
      parent.add(lines);
      shared.push(g, m);
      warpParts.push({ lines, share, n });
    };
    streaks(stars.geometry.attributes.position.array, WARP_STARS, WARP.stars, scene, 'fx-warp-stars');
    streaks(dust.geometry.attributes.position.array, WARP_DUST, WARP.dust, dust, 'fx-warp-dust');
  }
  /** The camera's flight now (`{ k, to }`, camera.js `flight()`), or null at rest; ignored unless `fx=warp`. */
  const setWarp = (w) => { if (warpParts.length) warpWant = w && Number.isFinite(w.k) ? { k: w.k, to: w.to ?? null } : null; };
  /** The warp as last drawn, its line sets, its direction and the point it aims at (null: along the travel). */
  const warp = () => ({
    ...warpShown, parts: warpParts.map((p) => p.lines), dir: warpDir.value.clone(), aim: warpAimOn.value ? warpAim.value.clone() : null,
    discs: warpDiscs.map((d) => ({ ...d })),
  });
  /**
   * Each crit nebula's disc on screen while it is folded (T21): round its
   * star's point, the nebula's reach there (as the leash measures it), in
   * drawing-buffer px; at most WARP.crits, the nearest first. An open system
   * is the one you are inside, so it holds no disc.
   */
  const warpBuf = new THREE.Vector2(), warpNdc = new THREE.Vector3();
  const critDiscs = () => {
    // The drawing buffer, as the renderer sizes it (setSize at the pixel ratio).
    const k = pixelRatio;
    warpBuf.set(Math.floor(cw * k), Math.floor(ch * k));
    warpView.value.copy(warpBuf);
    const out = [];
    for (const s of world?.sites ?? []) {
      if (s.gone || s.nebula?.tone !== 'crit' || ease(s.unfold) >= 0.5) continue;
      toView(warpNdc, s.home);
      const depth = -warpNdc.z;
      if (depth <= camera.near) continue;
      warpNdc.applyMatrix4(camera.projectionMatrix);
      const size = s.neb.size * (s.breath ?? 1) * s.alive;
      const r = ((LOBES.reach * size * ch) / (2 * Math.tan((camera.fov * Math.PI) / 360) * depth)) * k;
      if (r > 0) out.push({ id: s.id, x: (warpNdc.x * 0.5 + 0.5) * warpBuf.x, y: (warpNdc.y * 0.5 + 0.5) * warpBuf.y, r, depth });
    }
    out.sort((a, b) => a.depth - b.depth);
    return out.slice(0, WARP.crits).map(({ depth, ...d }) => d);
  };
  const drawWarp = () => {
    // At rest it costs one check (and where the camera is, for the next flight's first step).
    if (!warpWant && !warpOn) { warpLast.copy(camera.position); warpHas = true; return; }
    const s = warpWant?.to != null ? world?.byId.get(warpWant.to) : null;
    const t = s && !s.gone ? s.nebula?.tone ?? 'calm' : 'calm';
    const at = warpAt(warpWant?.k, t, still);
    warpShown = { ...at, tone: t };
    // Where it streams from: the destination's star (its system's centre), when there is one.
    warpAimOn.value = s?.home ? 1 : 0;
    if (s?.home) warpAim.value.set(s.home.x, s.home.y, s.home.z);
    // Which way the camera goes: its step since the last frame (kept when it pauses).
    warpStep.subVectors(camera.position, warpLast);
    if (warpHas && warpStep.lengthSq() > 1e-6) warpDir.value.copy(warpStep).normalize();
    warpLast.copy(camera.position);
    warpHas = true;
    const on = at.len > 0;
    warpOn = on;
    warpDiscs = on ? critDiscs() : [];
    warpCrit.value.forEach((v, i) => { const d = warpDiscs[i]; v.set(d?.x ?? 0, d?.y ?? 0, d?.r ?? 0); });
    for (const { lines, share } of warpParts) {
      lines.visible = on;
      if (!on) continue;
      const u = lines.material.uniforms;
      u.warpLen.value = at.len * share;
      u.warpOpacity.value = WARP.opacity * at.k;
      u.warpBody.value.copy(warpWhite);
      u.warpHead.value.copy(tone[at.head] ?? tone.calm);
    }
    dust.material.opacity = DUST_OPACITY * (1 - at.thin);
  };

  /** The most open system's star, fade radius and opening (eased), or none: what the dust thins round. */
  const heldDust = () => {
    let best = null;
    for (const s of world?.sites ?? []) if (!s.gone && s.unfold > (best?.unfold ?? 0)) best = s;
    if (!best) return { x: 0, y: 0, z: 0, r: 1, k: 0 };
    return { ...best.home, r: dustFadeRadius(best.reach), k: ease(best.unfold) * best.alive };
  };
  const holdDust = () => {
    const h = heldDust();
    dustHold.value.set(h.x, h.y, h.z, h.r);
    dustOpen.value = h.k;
    // The ribbon and the bands are the overview's: they fade as a system opens.
    let n = 0;
    for (const s of world?.sites ?? []) if (!s.gone) n++;
    shapeArm(ribbon, n, armRibbon);
    shapeArm(band, n, armBand);
    ribbon.material.opacity = ribbonOpacity(h.k);
    ribbon.visible = ribbon.material.opacity > 0.001;
    band.material.opacity = bandOpacity(h.k);
    band.visible = band.material.opacity > 0.001;
  };

  /**
   * What the camera is close to fades (T2, nearFade): every site's lobes,
   * star and halo, and the sun's halo. Not the system the camera flies to
   * or holds (`held`, setHeld): that one is the subject, and as it opens
   * you are inside its nebula, which thins on its own; a system the camera
   * leaves fades as it folds, so leaving it is never a cut.
   */
  let held = null;
  const at = new THREE.Vector3();
  const nearOf = (size, p) => nearFade(size, at.set(p.x, p.y, p.z).distanceTo(camera.position), camera.fov);
  /**
   * A crit or warn site's lobes stay on a leash to its star on screen (T7,
   * lobeLeash), the system it flies to included: a folded nebula never
   * shows apart from its name, nor once its star has left the frame. It lets go as the system opens, when you are
   * inside the nebula and its lobes are round the frame on purpose.
   */
  const ndcStar = new THREE.Vector3(), ndcLobe = new THREE.Vector3();
  const toView = (out, p) => out.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
  const leashOf = (s, size) => {
    toView(ndcStar, s.home);
    const depth = -ndcStar.z;
    if (depth <= camera.near) return () => 0; // the star is behind the camera: no name anywhere
    ndcStar.applyMatrix4(camera.projectionMatrix);
    const reachPx = (LOBES.reach * size * ch) / (2 * Math.tan((camera.fov * Math.PI) / 360) * depth);
    const inset = Math.min((1 - Math.abs(ndcStar.x)) * cw, (1 - Math.abs(ndcStar.y)) * ch) / 2;
    return (p) => {
      toView(ndcLobe, p);
      if (-ndcLobe.z <= camera.near) return 0;
      ndcLobe.applyMatrix4(camera.projectionMatrix);
      return lobeLeash(Math.hypot(((ndcLobe.x - ndcStar.x) / 2) * cw, ((ndcLobe.y - ndcStar.y) / 2) * ch), reachPx, inset, ch);
    };
  };
  const fadeNear = (s) => {
    const e = ease(s.unfold), a = s.alive;
    const w = s.id === held ? 0 : 1 - e;
    const near = (size, p) => 1 - (1 - nearOf(size, p)) * w;
    // You are inside the nebula now: it thins as the system opens.
    const size = s.neb.size * (s.breath ?? 1) * a;
    const leashed = LEASHED.has(s.nebula?.tone) && e < 1 && size > 0 ? leashOf(s, size) : null;
    const leash = (p) => (leashed ? 1 - (1 - leashed(p)) * (1 - e) : 1);
    for (const l of s.lobes) {
      l.mesh.material.opacity = s.neb.opacity * l.shape.share * s.peak * (1 - 0.7 * e) * a * near(l.shape.len * size, l.mesh.position) * leash(l.mesh.position);
    }
    const star = near(s.starHaloSize * a, s.home);
    s.star.scale.setScalar(Math.max(1e-3, a * star * s.carry));
    s.starHalo.scale.setScalar(Math.max(1e-3, s.starHaloSize * a * star));
  };
  const fadeSun = () => { sunHalo.material.opacity = SUN_HALO * sunShown.glow * nearOf(SIZE.sunHalo * sunShown.scale, sun.position); };

  /** One frame at `now` (ms): trouble breathes, the dust drifts, then draw. */
  const frame = (now) => {
    resize();
    const wave = breathWave(now, PULSE.periodMs, still); // -1..1, its peak when still (T11)
    haloMat.crit.opacity = HALO.crit.opacity * (1 - PULSE.crit / 2 + (PULSE.crit / 2) * wave);
    haloMat.warn.opacity = HALO.warn.opacity * (1 - PULSE.warn / 2 + (PULSE.warn / 2) * wave);
    advance(now);
    if (world) {
      camera.updateMatrixWorld(); // the leash projects with this frame's pose (T7)
      for (const s of world.sites) {
        s.breath = s.nebula.breathes ? 1 + PULSE.nebula * wave : 1;
        placeLobes(s);
        fadeNear(s);
      }
    }
    easeSun(now);
    fadeSun();
    // The dust turns once in about 26 minutes: alive under a held camera, never a motion you notice.
    dust.rotation.y = dustTurn(now, still);
    holdDust();
    if (activity) { drawActivity(now); drawJobs(now); }
    if (pillars.length) drawBeacons(now);
    if (rings.length) drawAfterglows(now);
    if (sweepLine) drawSweep();
    if (warpParts.length) drawWarp();
    renderer.render(scene, camera);
  };

  /**
   * Draws at one of budget.js's levels: new spheres at its segments on every
   * mesh (the old ones disposed), the dust and far stars thinned by their
   * draw range, the canvas at the level's pixel ratio (or the `ratio` pin).
   * Nothing moves: the canvas keeps its css size and the camera its pose;
   * the next frame just has less to draw and fewer pixels to fill.
   */
  let quality = 0;
  const setQuality = (level) => {
    const q = Math.max(0, Math.min(LEVELS.length - 1, Math.round(Number(level) || 0)));
    if (q === quality) return false;
    quality = q;
    const L = LEVELS[q];
    const next = spheres(L.seg);
    sun.geometry = next.sun;
    for (const s of world?.sites ?? []) {
      s.star.geometry = next[starSphere(s.carryTo)];
      for (const m of s.members) m.mesh.geometry = m.mesh.geometry === geo.planet ? next.planet : next.dot;
    }
    for (const k of Object.keys(geo)) { geo[k].dispose(); geo[k] = next[k]; }
    dust.geometry.setDrawRange(0, Math.round(DUST * L.dust));
    stars.geometry.setDrawRange(0, Math.round(STARS * L.stars));
    for (const { lines, n } of warpParts) lines.geometry.setDrawRange(0, 2 * Math.round(n * (lines.parent === dust ? L.dust : L.stars)));
    pixelRatio = pixelRatioFor(q, dpr, ratio);
    renderer.setPixelRatio(pixelRatio);
    dustCap.value = DUST_LOOK.maxPx * pixelRatio;
    return true;
  };

  const dispose = () => {
    for (const s of world?.sites ?? []) dropSite(s);
    tweens.clear();
    world = null;
    ribbon.geometry.dispose();
    band.geometry.dispose();
    for (const o of [...shared, ...Object.values(geo), ...rings.map((r) => r.ring.geometry), ...pingRings.map((r) => r.ring.geometry)]) o.dispose();
    sweepLine?.geometry.dispose();
    renderer.dispose();
    sized.stop();
  };

  return {
    update, setOpen, setHeld: (id) => { held = id ?? null; },
    setSun: (look) => { if (look) sunWant = look; }, setActivity, setJobs, setCritAges, setWarp, setSweep, drawn, planets, beams, frame, resize, setQuality, camera,
    size: sized.get,
    renderer, dispose,
    get world() { return world; },
    get quality() { return quality; },
    /** The pixel ratio the canvas is drawn at now (the level's, capped by dpr, or the pin). */
    get pixelRatio() { return pixelRatio; },
    /** The planets lit now (fx=activity): id → `{ id, site, count, t0, until }` (fx.js trackWork). */
    get activity() { return work; },
    /** The jobs playing now (fx=activity): `{ key, from, to, failed, t0 }` (fx.js trackJobs). */
    get jobs() { return jobs.playing; },
    get beacons() { return beacons; },
    /** The clears remembered now (fx=afterglow): site id → `{ id, tone, at }` (fx.js afterglows). */
    get afterglows() { return glowState?.clears ?? new Map(); },
    /** The sweep as drawn now (fx=sweep): its line's mesh and the ping rings' (null and none without it or in still mode). */
    get sweep() { return sweep(); },
    /** The warp as last drawn (`{ k, len, head, thin, tone, dir, aim }`, fx.js warpAt) and its two line sets (fx=warp). */
    get warp() { return warp(); },
    /** What the dust thins round now (`{ x, y, z, r, k }`, dustFade's uniforms). */
    get dustHold() { return heldDust(); },
    /** The sun as drawn now (`{ scale, glow, cold }`, T6) and its core and halo. */
    get sun() { return { ...sunShown, core: sun, halo: sunHalo }; },
    /** The arm ribbon's mesh (T3): its opacity and colour, for tests. */
    get ribbon() { return ribbon; },
    /** The near-site bands' mesh (T19), for tests. */
    get band() { return band; },
  };
}
