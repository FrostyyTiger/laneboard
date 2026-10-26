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
import { tourSites } from '../tour.js';
import { TONES, nebulaFor, toneOf } from './palette.js';
import { LIVE, glide, planLive, relayPhase, siteKeys, treeKey } from './live.js';

/** World sizes: the sun, a site's star, a planet (named kind), a dot (the rest). */
export const SIZE = Object.freeze({ sun: 60, sunHalo: 900, star: 24, planet: 15, dot: 4, landing: 7 });

/** A halo's size against its sphere, and its resting strength, per tone. */
const HALO = Object.freeze({
  calm: { k: 4, opacity: 0.22 },
  low: { k: 5, opacity: 0.5 },
  warn: { k: 7, opacity: 0.8 },
  crit: { k: 9, opacity: 0.9 },
});

/** Trouble breathes: one slow period (ms), crit deep, warn shallow. */
export const PULSE = Object.freeze({ periodMs: 2600, crit: 0.4, warn: 0.15, nebula: 0.08 });

/** Segments of a landing ring (a small circle under a planet, on the plane). */
const RING_SEGS = 16;

/** Segments of a hyperlane (a bowed line from the sun to a star). */
const LANE_SEGS = 40;

/** The camera's field of view (degrees) and the far plane. */
export const FOV = 42;

/**
 * Where the camera sits for the whole galaxy at `now`: above, at an angle,
 * turning once in about 7 minutes so the arms read as depth, not as motion.
 */
export function overviewShot(sites, now = 0, fov = FOV) {
  let r = 0;
  for (const s of sites) r = Math.max(r, Math.hypot(s.home.x, s.home.z));
  const d = ((r + 400) / Math.tan((fov * Math.PI) / 360)) * 0.9;
  const a = now * 0.000015;
  return {
    pos: { x: Math.sin(a) * d * 0.62, y: d * 0.78, z: Math.cos(a) * d * 0.62 },
    look: { x: 0, y: 0, z: 0 },
  };
}

/** Where the camera sits for one open system: outside it, looking in toward the sun. */
export function siteShot(site, now = 0) {
  const out = Math.atan2(site.home.x, site.home.z) + (hash(site.id) - 0.5) * 0.9 + now * 0.00002;
  const d = Math.max(560, site.reach * 1.9);
  return {
    pos: { x: site.home.x + Math.sin(out) * d, y: site.home.y + d * 0.75, z: site.home.z + Math.cos(out) * d },
    look: { ...site.home },
  };
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
 * Returns `{ update, setOpen, frame, resize, camera, world, renderer, dispose }`.
 */
export function createGalaxyScene(canvas, {
  palette, doc = globalThis.document, dpr = globalThis.devicePixelRatio || 1,
  clock = pageClock, makeRenderer = webgl,
} = {}) {
  const col = (rgb) => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  const tone = Object.fromEntries(TONES.map((t) => [t, col(palette[t])]));
  const bg = col(palette.bg);

  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(Math.min(2, dpr));
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
  const geo = {
    sun: new THREE.SphereGeometry(SIZE.sun, 32, 20),
    star: new THREE.SphereGeometry(SIZE.star, 20, 14),
    planet: new THREE.SphereGeometry(SIZE.planet, 32, 22),
    dot: new THREE.SphereGeometry(SIZE.dot, 10, 8),
  };
  const shared = [glowTex, dotTex, cloudTex, ...Object.values(geo)];
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

  // --- the sky: far stars and the dust band, never rebuilt ------------------
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(farStars(2500), 3));
    const m = new THREE.PointsMaterial({ color: col(palette.stars), size: 7, fog: false });
    scene.add(new THREE.Points(g, m));
    shared.push(g, m);
  }
  const dust = (() => {
    const { positions, t } = dustPoints(9000);
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
      size: 20, map: dotTex, vertexColors: true, transparent: true, opacity: 0.7,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, m);
    scene.add(pts);
    shared.push(g, m);
    return pts;
  })();

  // The sun: the hub, at the origin. Its halo is a soft grey, quieter
  // than any nebula in trouble (README §2.1: trouble is the loudest thing).
  const sun = new THREE.Mesh(geo.sun, keep(new THREE.MeshBasicMaterial({ color: white })));
  const sunHalo = new THREE.Sprite(keep(new THREE.SpriteMaterial({
    map: glowTex, color: white, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4,
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

  const haloSize = (m, t) => (m.planet ? SIZE.planet * HALO[t].k : t === 'calm' ? 0 : SIZE.dot * 2 * HALO[t].k);
  const laneLook = (t) => (t === 'calm'
    ? { color: col(palette.line.rgb), opacity: palette.line.alpha * 0.6 }
    : { color: tone[t].clone(), opacity: 0.5 });

  /** A member's tone: its mesh swaps to the shared material; its halo eases to its new size. */
  const paintMember = (s, m, t, ms) => {
    m.tone = t;
    m.mesh.material = m.planet ? planetMat[t] : flatMat[t];
    m.halo.material = haloMat[t];
    const from = m.haloSize, to = haloSize(m, t);
    if (!ms || from === to) { m.haloSize = to; dirty = true; return; }
    tween(`${s.id}:halo:${m.id}`, ms, (k) => { m.haloSize = glide(from, to, k); });
  };

  /** A site's star, nebula and hyperlane to its tone and status, eased over `ms` (0: at once). */
  const paintSite = (s, ms) => {
    const t = toneOf(s.node);
    s.star.material = flatMat[t];
    s.starHalo.material = haloMat[t];
    const neb = nebulaFor(s.status);
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
      s.nebulaSprite.material.color.copy(s.neb.color);
    };
    s.nebFrom = { color: s.neb.color.clone(), opacity: s.neb.opacity, size: s.neb.size };
    s.laneFrom = { color: s.lane.material.color.clone(), opacity: s.lane.material.opacity };
    s.starHaloFrom = s.starHaloSize;
    if (!ms) { set(1); dirty = true; return; }
    tween(`${s.id}:paint`, ms, set);
  };

  /** A site's members from its layout: the old ones go, the new ones come at their tones. */
  const setMembers = (s, list) => {
    for (const m of s.members) group.remove(m.mesh, m.halo);
    for (const key of tweens.keys()) if (key.startsWith(`${s.id}:halo:`)) tweens.delete(key);
    s.members = list.map((lm) => {
      const m = { id: lm.id, node: lm.node, off: { ...lm.off }, planet: lm.planet, tone: 'calm', haloSize: 0 };
      m.mesh = new THREE.Mesh(m.planet ? geo.planet : geo.dot, flatMat.calm);
      m.halo = new THREE.Sprite(haloMat.calm);
      group.add(m.mesh, m.halo);
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
    // The nebula round the cluster, its own material: it thins as the system opens.
    const nebulaSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, color: tone[neb.tone], transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: neb.opacity, rotation: hash(`${lay.id}~neb`) * Math.PI * 2,
    }));
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(palette.line.rgb, 0));
    lines.frustumCulled = false;
    // The system's plane: one thin circle round its star.
    const plane = new THREE.Mesh(new THREE.RingGeometry(1, 1.006, 128), new THREE.MeshBasicMaterial({
      color: col(palette.line.rgb), side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false,
    }));
    plane.rotation.x = -Math.PI / 2;
    const lane = new THREE.Line(new THREE.BufferGeometry(), lineMat(palette.line.rgb, 0));
    group.add(star, starHalo, nebulaSprite, lines, plane, lane);
    const s = {
      id: lay.id, node: lay.node, home: { ...lay.home }, reach: lay.reach, status, nebula: neb,
      star, starHalo, members: [], nebulaSprite, lines, plane, lane,
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
    for (const m of s.members) group.remove(m.mesh, m.halo);
    group.remove(s.star, s.starHalo, s.nebulaSprite, s.lines, s.plane, s.lane);
    for (const o of [s.nebulaSprite.material, s.lines.geometry, s.lines.material, s.plane.geometry, s.plane.material, s.lane.geometry, s.lane.material]) o.dispose();
  };

  const index = (sites, core) => {
    world = { sites, core, byId: new Map(sites.map((s) => [s.id, s])), version: (world?.version ?? 0) + 1 };
    dirty = true;
  };

  /** Puts every member where its system's opening (times a relayout's squeeze) says. */
  const place = () => {
    for (const s of world.sites) {
      const k = Math.max(0, Math.min(1, s.open)) * s.squeeze;
      s.unfold = k;
      const a = s.alive;
      s.star.position.set(s.home.x, s.home.y, s.home.z);
      s.star.scale.setScalar(a);
      s.starHalo.position.copy(s.star.position);
      s.starHalo.scale.setScalar(Math.max(1e-3, s.starHaloSize * a));
      s.nebulaSprite.position.copy(s.star.position);
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
        m.mesh.scale.setScalar(a);
        m.halo.position.set(x, y, z);
        m.halo.visible = m.haloSize * a > 0.5;
        m.halo.scale.setScalar(Math.max(1e-3, m.haloSize * a));
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
      // You are inside the nebula now: it thins as the system opens.
      s.nebulaSprite.material.opacity = s.neb.opacity * (1 - 0.7 * e) * a;
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
  const resize = (w = canvas.clientWidth, h = canvas.clientHeight) => {
    if (w === cw && h === ch) return;
    cw = w; ch = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  /** One frame at `now` (ms): trouble breathes, the dust drifts, then draw. */
  const frame = (now) => {
    resize();
    const wave = Math.sin((now / PULSE.periodMs) * Math.PI * 2); // -1..1
    haloMat.crit.opacity = HALO.crit.opacity * (1 - PULSE.crit / 2 + (PULSE.crit / 2) * wave);
    haloMat.warn.opacity = HALO.warn.opacity * (1 - PULSE.warn / 2 + (PULSE.warn / 2) * wave);
    advance(now);
    if (world) {
      for (const s of world.sites) {
        const breath = s.nebula.breathes ? 1 + PULSE.nebula * wave : 1;
        s.nebulaSprite.scale.setScalar(Math.max(1e-3, s.neb.size * breath * s.alive));
      }
    }
    // The dust turns once in about 26 minutes: alive under a held camera, never a motion you notice.
    dust.rotation.y = now * 0.000004;
    renderer.render(scene, camera);
  };

  const dispose = () => {
    for (const s of world?.sites ?? []) dropSite(s);
    tweens.clear();
    world = null;
    for (const o of shared) o.dispose();
    renderer.dispose();
  };

  return {
    update, setOpen, frame, resize, camera, renderer, dispose,
    get world() { return world; },
  };
}
