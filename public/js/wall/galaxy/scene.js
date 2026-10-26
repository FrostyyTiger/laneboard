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
import { galaxyLayout, dustPoints, farStars, foldAt, rng, hash, ease, CLOSED } from './layout.js';
import { tourOrder, tourSites } from '../tour.js';
import { TONES, nebulaFor, toneOf } from './palette.js';
import { LIVE, glide, planLive, relayPhase, siteKeys, treeKey } from './live.js';
import { LEVELS, pixelRatioFor } from './budget.js';
import { breathWave, dustTurn } from './still.js';
import { createStageSize } from './stage.js';
import { armTangent, nebulaLobes, nebulaPeaks } from './nebula.js';
import { FRAMING, fitDistance, freeCentre, panShot } from './framing.js';
import {
  BEACON, COMETS, LANES, TWINKLE, beaconAt, cometAt, cometPath, pulseAt, routePath, trackComets, trackRoutes, trackTwinkles,
  twinkleAt,
} from './fx.js';

/**
 * World sizes: the sun, a site's star, a planet (named kind), a dot (the
 * rest). The sun is 70 % of the sketch's 60 and its halo narrower than a
 * crit nebula (r8-film-ui 2: the sun outshouted the trouble).
 */
export const SIZE = Object.freeze({ sun: 42, sunHalo: 640, star: 24, planet: 15, dot: 4, landing: 7 });

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

/** Sphere segments (width, height) at the best level; budget.js's levels scale them. */
const SEGS = Object.freeze({ sun: [32, 20], star: [20, 14], planet: [32, 22], dot: [10, 8] });

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

/** The far stars and dust grains at the best level. */
const STARS = 2500, DUST = 9000;

/** Segments of a landing ring (a small circle under a planet, on the plane). */
const RING_SEGS = 16;

/** Segments of a hyperlane (a bowed line from the sun to a star). */
const LANE_SEGS = 40;

/** The camera's field of view (degrees) and the far plane. */
export const FOV = 42;

/**
 * Where the camera sits for the whole galaxy: above, at an angle, and always
 * the same pose (T24, reviews/r26-skeptic.md 7). It used to turn once in about
 * 7 minutes, so every name stood somewhere else at each overview and the
 * hallway had to find HOME again; depth comes from the drift round a held
 * system (`siteShot`), the overview holds still.
 */
export function overviewShot(sites, fov = FOV) {
  let r = 0;
  for (const s of sites) r = Math.max(r, Math.hypot(s.home.x, s.home.z));
  const d = ((r + 400) / Math.tan((fov * Math.PI) / 360)) * 0.9;
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
  // the hub is: from the sun's side it would hang over the sun, so it looks
  // in from outside, the hub far beyond the system and small (framing.js FRAMING.inward).
  const inward = view?.free && site.reach > FRAMING.inward * Math.hypot(site.home.x, site.home.z) ? Math.PI : 0;
  const out = Math.atan2(-site.home.x, -site.home.z) + inward + (hash(site.id) - 0.5) * jitter + sway * Math.sin((now * speed) / sway);
  // `d` is the camera's offset along the plane; it stands 0.75 d up, so 1.25 d from the star.
  let d = Math.max(560, site.reach * 1.9);
  if (view?.free) d = Math.max(560, fitDistance(site.reach, view.free, view.fov ?? FOV, view.aspect) / 1.25);
  if (view?.scale > 0) d *= view.scale;
  const shot = {
    pos: { x: site.home.x + Math.sin(out) * d, y: site.home.y + d * 0.75, z: site.home.z + Math.cos(out) * d },
    look: { ...site.home },
  };
  // Looking in, the camera stands steeper at the same distance, so the hub
  // beyond the system rises to the frame's top edge.
  if (inward) {
    const back = (d * 1.25) / Math.hypot(1, FRAMING.inwardRise);
    shot.pos = { x: site.home.x + Math.sin(out) * back, y: site.home.y + back * FRAMING.inwardRise, z: site.home.z + Math.cos(out) * back };
  }
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
 * A beacon's pillar (fx=beacon): a thin bright core in a soft sheath, full
 * at its foot and thinning upwards (never to nothing: its tip is its height).
 */
function beamTexture(doc) {
  const c = doc.createElement('canvas');
  c.width = 32;
  c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 32, 0);
  g.addColorStop(0, 'rgb(255 255 255 / 0)');
  g.addColorStop(0.3, 'rgb(255 255 255 / 0.12)');
  g.addColorStop(0.5, 'rgb(255 255 255 / 1)');
  g.addColorStop(0.7, 'rgb(255 255 255 / 0.12)');
  g.addColorStop(1, 'rgb(255 255 255 / 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 128);
  x.globalCompositeOperation = 'destination-in';
  const v = x.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgb(0 0 0 / 0.35)');
  v.addColorStop(1, 'rgb(0 0 0 / 1)');
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
 * The scene on `canvas`. `palette` is paletteFrom's; `doc` makes the
 * sprite textures; `clock` is the time the eases count in (the frames'
 * `now`), `makeRenderer` the WebGL renderer (both injectable for tests).
 * `still` (reduced motion, still.js): trouble glows without breathing, the dust stays put.
 * `fx` (fx.js `parseFx`): the effects asked for; `lanes` draws `setRoutes`' pulses,
 * `comets` flies `setComets`' comets, `twinkle` lights `setTwinkles`' planets,
 * `beacon` stands a pillar over each crit cluster (`setCritAges` dates them).
 * Returns `{ update, setOpen, setRoutes, setComets, setTwinkles, setCritAges, drawn, planets, frame, resize,
 * setQuality, size, camera, world, quality, pixelRatio, routes, comets, twinkles, beacons, renderer, dispose }`.
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
  const spheres = (seg) => Object.fromEntries(Object.entries(SEGS).map(([k, [w, h]]) => [
    k, new THREE.SphereGeometry(SIZE[k], Math.max(6, Math.round(w * seg)), Math.max(4, Math.round(h * seg))),
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
      size: DUST_LOOK.size, map: dotTex, vertexColors: true, transparent: true, opacity: 0.7,
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

  const haloSize = (m, t) => (m.planet || troubled(t) ? memberRadius(m.planet, t) * HALO[t].k : t === 'calm' ? 0 : SIZE.dot * 2 * HALO[t].k);
  const sphereOf = (m) => (m.radius === SIZE.planet ? geo.planet : geo.dot);
  const laneLook = (t) => (t === 'calm'
    ? { color: col(palette.line.rgb), opacity: palette.line.alpha * 0.6 }
    : { color: tone[t].clone(), opacity: 0.5 });

  /** A member's tone: its mesh swaps to the shared material; its halo eases to its new size. */
  const paintMember = (s, m, t, ms) => {
    m.tone = t;
    const r0 = m.size ?? memberRadius(m.planet, t);
    m.radius = memberRadius(m.planet, t);
    // The sphere for the larger of the two sizes, so one growing in is never a coarse dot blown up.
    m.mesh.geometry = sphereOf({ radius: Math.max(r0, m.radius) });
    m.mesh.material = m.planet || troubled(t) ? planetMat[t] : flatMat[t];
    m.halo.material = haloMat[t];
    m.mark.material = markMat[t] ?? markMat.crit;
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
    const starTo = SIZE.star * HALO[t].k;
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

  /** A site's members from its layout: the old ones go, the new ones come at their tones. */
  const setMembers = (s, list) => {
    for (const m of s.members) group.remove(m.mesh, m.halo, m.mark);
    for (const key of tweens.keys()) if (key.startsWith(`${s.id}:halo:`)) tweens.delete(key);
    s.members = list.map((lm) => {
      const m = { id: lm.id, node: lm.node, off: { ...lm.off }, planet: lm.planet, tone: 'calm', haloSize: 0 };
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
    setMembers(s, lay.members);
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
        m.mesh.scale.setScalar((a * m.size) / m.mesh.geometry.parameters.radius);
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
        setMembers(s, r.lay.members);
        world.version += 1;
      }
      s.squeeze = ph.squeeze;
      if (ph.done) { s.squeeze = 1; s.relay = null; }
      dirty = true;
    }
    if (world && dirty) place();
  };

  let lastKey = null, lastTree = null;
  const update = (model) => {
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const k = sceneKey(nodes);
    if (k === lastKey) return false;
    lastKey = k;
    const shown = new Map(tourSites(nodes).map((s) => [s.id, s.status]));
    const tree = treeKey(nodes, shown.keys());
    const lay = galaxyLayout(nodes);
    if (!world) build(lay, shown);
    else if (tree === lastTree) recolour(lay, shown);
    else relive(lay, shown);
    rankPeaks(tourOrder(nodes).map((s) => s.id), lastTree === null ? 0 : LIVE.recolourMs);
    lastTree = tree;
    place();
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

  // --- fx=lanes (T12, fx.js): a light pulse between two sites that talk ----
  // One pool of sprites (a head and its trail per route), made once and
  // reused; each route's path is read off the two hyperlanes every frame,
  // so it follows a star that glides. Under reduced motion the route is a
  // still row of faint lights instead of a moving pulse.
  let routes = new Map();
  const pulses = [];
  const perRoute = 1 + LANES.trail;
  if (fx?.has('lanes')) {
    const light = col(palette.sun);
    for (let i = 0; i < LANES.maxRoutes * perRoute; i++) {
      const sp = new THREE.Sprite(keep(new THREE.SpriteMaterial({
        map: glowTex, color: light, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      })));
      sp.name = 'fx-lane';
      sp.visible = false;
      pulses.push(sp);
      scene.add(sp);
    }
  }
  /** The live routes (fx.js `siteRoutes`); ignored unless `fx=lanes`. */
  const setRoutes = (list) => {
    if (!pulses.length) return;
    routes = trackRoutes(routes, list, clock());
  };
  const lanePoints = (s) => s.lane.geometry.attributes.position?.array ?? null;
  const drawPulses = (now) => {
    for (const sp of pulses) sp.visible = false;
    let r0 = 0;
    for (const [key, r] of routes) {
      const at = pulseAt(r, now);
      if (at === undefined) { routes.delete(key); continue; }
      const a = world?.byId.get(r.from), b = world?.byId.get(r.to);
      const pa = a && !a.gone && lanePoints(a), pb = b && !b.gone && lanePoints(b);
      if (!pa || !pb || (!still && at === null)) { r0 += perRoute; continue; }
      const path = routePath(pa, pb);
      for (let i = 0; i < perRoute; i++) {
        const sp = pulses[r0 + i];
        if (!sp) break;
        // Still: an even row of faint lights; moving: the head and a fading trail behind it.
        const u = still ? (i + 0.5) / perRoute : at.u - i * LANES.gap;
        if (u < 0) continue;
        const fall = still ? 0.45 : (1 - i / perRoute) * at.k;
        const p = path.at(u);
        sp.position.set(p.x, p.y, p.z);
        sp.scale.setScalar(LANES.head * (still ? 0.6 : 1 - (0.5 * i) / perRoute));
        sp.material.opacity = LANES.opacity * fall;
        sp.visible = sp.material.opacity > 0.01;
      }
      r0 += perRoute;
    }
  };

  // --- fx=comets (T13, fx.js): something just travelled a link ----------
  // One pool again (a head and its tail per comet). Each frame the arc is
  // read off where its two ends are drawn now (a planet unfolding, a star
  // gliding), falling back to their sites' stars. Under reduced motion a
  // comet is its whole arc, still and faint, for the time it would fly.
  let comets = { flying: [], seen: new Set() };
  const tails = [];
  const perComet = 1 + COMETS.tail;
  if (fx?.has('comets')) {
    for (let i = 0; i < COMETS.max * perComet; i++) {
      const sp = new THREE.Sprite(keep(new THREE.SpriteMaterial({
        map: glowTex, color: tone.calm, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      })));
      sp.name = 'fx-comet';
      sp.visible = false;
      tails.push(sp);
      scene.add(sp);
    }
  }
  /** Every id the galaxy draws (its sites and their members): flowComets' `drawn`. */
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
  /** The comets in the last model (fx.js `flowComets`); ignored unless `fx=comets`. */
  const setComets = (list) => {
    if (!tails.length) return;
    comets = trackComets(comets, list, clock());
  };
  const drawComets = (now) => {
    for (const sp of tails) sp.visible = false;
    comets.flying = comets.flying.filter((c) => cometAt(c, now) !== undefined);
    if (!world) return;
    comets.flying.forEach((c, n) => {
      const at = cometAt(c, now);
      const a = pointOf(c.from, c.fromSite), b = pointOf(c.to, c.toSite);
      if (!at || !a || !b) return;
      const path = cometPath(a, b);
      const head = Math.max(COMETS.headMin, Math.min(COMETS.headMax, path.length * COMETS.head));
      for (let i = 0; i < perComet; i++) {
        const sp = tails[n * perComet + i];
        // Still: the whole arc, evenly lit and faint; flying: the head and a tail thinning behind it.
        const u = still ? (i + 0.5) / perComet : at.u - i * COMETS.gap;
        if (u < 0) continue;
        const fall = still ? 0.4 : (1 - i / perComet) ** 1.5 * at.k;
        const p = path.at(u);
        sp.material.color.copy(tone[c.tone] ?? tone.calm);
        sp.position.set(p.x, p.y, p.z);
        sp.scale.setScalar(head * (still ? 0.5 : 1 - (0.75 * i) / perComet));
        sp.material.opacity = COMETS.opacity * fall;
        sp.visible = sp.material.opacity > 0.01;
      }
    });
  };

  // --- fx=twinkle (T14, fx.js): a planet with an agent at work on it ------
  // One soft light per twinkling planet, from a pool made once, on the
  // sphere it sits on (it follows the planet as its system opens). Low and
  // slow; a planet whose own tone is trouble is skipped (it breathes
  // already). Under reduced motion the light is steady, at half its swing.
  let twinkles = new Map();
  const glints = [];
  if (fx?.has('twinkle')) {
    const light = col(palette.sun);
    for (let i = 0; i < TWINKLE.max; i++) {
      const sp = new THREE.Sprite(keep(new THREE.SpriteMaterial({
        map: glowTex, color: light, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      })));
      sp.name = 'fx-twinkle';
      sp.visible = false;
      glints.push(sp);
      scene.add(sp);
    }
  }
  /** The planets with a working session (fx.js `workingPlanets`); ignored unless `fx=twinkle`. */
  const setTwinkles = (list) => {
    if (!glints.length) return;
    twinkles = trackTwinkles(twinkles, list, clock());
  };
  const drawTwinkles = (now) => {
    for (const sp of glints) sp.visible = false;
    if (!world) return;
    let i = 0;
    for (const [id, tw] of twinkles) {
      const lit = twinkleAt(tw, now, TWINKLE, still);
      if (lit === undefined) { twinkles.delete(id); continue; }
      const at = thingOf(id);
      const sp = glints[i];
      if (!sp || !at || at.site.gone) continue;
      const tone = at.member ? at.member.tone : toneOf(at.site.node);
      if (tone !== 'calm') continue;
      i += 1;
      const r = at.member ? SIZE.planet : SIZE.star;
      sp.position.copy(at.pos);
      sp.scale.setScalar(Math.max(1e-3, r * TWINKLE.size * at.site.alive));
      sp.material.opacity = TWINKLE.opacity * lit.k * (TWINKLE.floor + (1 - TWINKLE.floor) * lit.glimmer);
      sp.visible = sp.material.opacity > 0.005;
    }
  };

  // --- fx=beacon (T21, fx.js): how long a crit has lasted ------------------
  // One pillar and one tip light per crit cluster, from a pool made once.
  // A cluster's crit began at the older of when the page saw its nebula
  // turn crit (`s.since`) and what the model's events say (`setCritAges`).
  // The pillar turns round its own axis to face the camera, so it is a
  // line of light from any side; it fades to `held` while its system is
  // open. Under reduced motion it stands and goes at once; so does every
  // crit already there when the page first draws (it did not just begin).
  const beacons = new Map(); // site id → { from, crit, t0, k0 } (fx.js beaconAt)
  let critFrom = new Map(), beamsSeen = false;
  const pillars = [];
  if (fx?.has('beacon')) {
    const beamTex = keep(beamTexture(doc));
    const beamGeo = keep(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
    for (let i = 0; i < BEACON.max; i++) {
      const pillar = new THREE.Mesh(beamGeo, keep(new THREE.MeshBasicMaterial({
        map: beamTex, color: tone.crit, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      })));
      pillar.name = 'fx-beacon';
      const tip = new THREE.Sprite(keep(new THREE.SpriteMaterial({
        map: glowTex, color: tone.crit, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
      })));
      tip.name = 'fx-beacon-tip';
      pillar.visible = tip.visible = false;
      pillars.push({ pillar, tip });
      scene.add(pillar, tip);
    }
  }
  /** How old each crit is by the model (fx.js `critAges`: site id → ms); ignored unless `fx=beacon`. */
  const setCritAges = (ages) => {
    if (!pillars.length) return;
    const now = clock();
    critFrom = new Map([...(ages ?? [])].map(([id, ms]) => [id, now - ms]));
  };
  const drawBeacons = (now) => {
    for (const { pillar, tip } of pillars) pillar.visible = tip.visible = false;
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
      const slot = pillars[i];
      if (!slot) break;
      i += 1;
      const h = Math.max(1e-3, at.height * at.rise * s.alive);
      const k = Math.min(1, at.rise * 2) * s.alive * (1 - (1 - BEACON.held) * ease(s.unfold));
      const { pillar, tip } = slot;
      pillar.position.set(s.home.x, s.home.y, s.home.z);
      pillar.rotation.set(0, Math.atan2(camera.position.x - s.home.x, camera.position.z - s.home.z), 0);
      pillar.scale.set(BEACON.width, h, 1);
      pillar.material.opacity = BEACON.opacity * k;
      tip.position.set(s.home.x, s.home.y + h, s.home.z);
      tip.scale.setScalar(BEACON.top);
      tip.material.opacity = BEACON.opacity * k;
      pillar.visible = tip.visible = pillar.material.opacity > 0.005;
    }
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
  const fadeNear = (s) => {
    const e = ease(s.unfold), a = s.alive;
    const w = s.id === held ? 0 : 1 - e;
    const near = (size, p) => 1 - (1 - nearOf(size, p)) * w;
    // You are inside the nebula now: it thins as the system opens.
    const size = s.neb.size * (s.breath ?? 1) * a;
    for (const l of s.lobes) {
      l.mesh.material.opacity = s.neb.opacity * l.shape.share * s.peak * (1 - 0.7 * e) * a * near(l.shape.len * size, l.mesh.position);
    }
    const star = near(s.starHaloSize * a, s.home);
    s.star.scale.setScalar(Math.max(1e-3, a * star));
    s.starHalo.scale.setScalar(Math.max(1e-3, s.starHaloSize * a * star));
  };
  const fadeSun = () => { sunHalo.material.opacity = SUN_HALO * nearOf(SIZE.sunHalo, sun.position); };

  /** One frame at `now` (ms): trouble breathes, the dust drifts, then draw. */
  const frame = (now) => {
    resize();
    const wave = breathWave(now, PULSE.periodMs, still); // -1..1, its peak when still (T11)
    haloMat.crit.opacity = HALO.crit.opacity * (1 - PULSE.crit / 2 + (PULSE.crit / 2) * wave);
    haloMat.warn.opacity = HALO.warn.opacity * (1 - PULSE.warn / 2 + (PULSE.warn / 2) * wave);
    advance(now);
    if (world) {
      for (const s of world.sites) {
        s.breath = s.nebula.breathes ? 1 + PULSE.nebula * wave : 1;
        placeLobes(s);
        fadeNear(s);
      }
    }
    fadeSun();
    // The dust turns once in about 26 minutes: alive under a held camera, never a motion you notice.
    dust.rotation.y = dustTurn(now, still);
    holdDust();
    if (pulses.length) drawPulses(now);
    if (tails.length) drawComets(now);
    if (glints.length) drawTwinkles(now);
    if (pillars.length) drawBeacons(now);
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
      s.star.geometry = next.star;
      for (const m of s.members) m.mesh.geometry = m.mesh.geometry === geo.planet ? next.planet : next.dot;
    }
    for (const k of Object.keys(geo)) { geo[k].dispose(); geo[k] = next[k]; }
    dust.geometry.setDrawRange(0, Math.round(DUST * L.dust));
    stars.geometry.setDrawRange(0, Math.round(STARS * L.stars));
    pixelRatio = pixelRatioFor(q, dpr, ratio);
    renderer.setPixelRatio(pixelRatio);
    dustCap.value = DUST_LOOK.maxPx * pixelRatio;
    return true;
  };

  const dispose = () => {
    for (const s of world?.sites ?? []) dropSite(s);
    tweens.clear();
    world = null;
    for (const o of [...shared, ...Object.values(geo)]) o.dispose();
    renderer.dispose();
    sized.stop();
  };

  return {
    update, setOpen, setHeld: (id) => { held = id ?? null; }, setRoutes, setComets, setTwinkles, setCritAges, drawn, planets, frame, resize, setQuality, camera,
    size: sized.get,
    renderer, dispose,
    get world() { return world; },
    get quality() { return quality; },
    /** The pixel ratio the canvas is drawn at now (the level's, capped by dpr, or the pin). */
    get pixelRatio() { return pixelRatio; },
    get routes() { return routes; },
    get comets() { return comets.flying; },
    get twinkles() { return twinkles; },
    get beacons() { return beacons; },
    /** What the dust thins round now (`{ x, y, z, r, k }`, dustFade's uniforms). */
    get dustHold() { return heldDust(); },
  };
}
