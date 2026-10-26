// The galaxy's scene (Wall plan night 2 T3, README §5): what three.js draws
// from the layout (layout.js). The hub is the sun; the sites are star
// clusters on two arms in a band of dust, a hyperlane from the sun to each;
// at the overview a cluster is folded inside a nebula in its worst status;
// opened, its rooms and builders are lit planets on inclined orbits, each
// on a stem down to the system's plane with a small ring where it lands.
//
// Colours come from the palette (palette.js, the tokens), never from here.
// Geometries, materials and textures shared by every site are made once;
// what belongs to one site is disposed when the galaxy is laid out again.
//
// The camera is the page's to move (T4 brings the tour's camera); this
// module only draws: `update(model)`, `setOpen(id, k)`, `frame(now)`.

import * as THREE from '../../../vendor/three/three.module.js';
import { galaxyLayout, dustPoints, farStars, foldAt, rng, hash, ease, CLOSED } from './layout.js';
import { tourSites } from '../tour.js';
import { TONES, nebulaFor, toneOf } from './palette.js';

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

/** What a rebuild must notice: ids, parents, kinds and tones (T8 makes status changes cheaper). */
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

/**
 * The scene on `canvas`. `palette` is paletteFrom's; `doc` makes the
 * sprite textures. Returns `{ update, setOpen, frame, resize, camera,
 * world, renderer, dispose }`.
 */
export function createGalaxyScene(canvas, { palette, doc = globalThis.document, dpr = globalThis.devicePixelRatio || 1 } = {}) {
  const col = (rgb) => new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  const tone = Object.fromEntries(TONES.map((t) => [t, col(palette[t])]));
  const bg = col(palette.bg);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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

  // --- the galaxy: rebuilt when the tree or a tone changes -----------------
  let world = null;
  const lineMat = (rgb, opacity) => new THREE.LineBasicMaterial({ color: col(rgb), transparent: true, opacity, depthWrite: false });

  const build = (nodes) => {
    const was = world ? new Map(world.sites.map((s) => [s.id, s.open])) : new Map();
    if (world) drop(world);
    const lay = galaxyLayout(nodes);
    const shown = new Map(tourSites(nodes).map((s) => [s.id, s.status]));
    const group = new THREE.Group();
    const own = [];
    const sites = [];
    for (const s of lay.sites) {
      if (!shown.has(s.id)) continue; // the calm repo index is no place (tour.js CALM_SKIP)
      const neb = nebulaFor(shown.get(s.id));
      const star = new THREE.Mesh(geo.star, flatMat[toneOf(s.node)]);
      star.position.set(s.home.x, s.home.y, s.home.z);
      const starHalo = new THREE.Sprite(haloMat[toneOf(s.node)]);
      starHalo.position.copy(star.position);
      starHalo.scale.setScalar(SIZE.star * HALO[toneOf(s.node)].k);
      group.add(star, starHalo);

      const members = s.members.map((m) => {
        const t = toneOf(m.node);
        const mesh = new THREE.Mesh(m.planet ? geo.planet : geo.dot, m.planet ? planetMat[t] : flatMat[t]);
        group.add(mesh);
        // Planets and anything in trouble glow; a calm dot does not.
        let halo = null;
        if (m.planet || t !== 'calm') {
          halo = new THREE.Sprite(haloMat[t]);
          halo.scale.setScalar((m.planet ? SIZE.planet : SIZE.dot * 2) * HALO[t].k);
          group.add(halo);
        }
        return { ...m, tone: t, mesh, halo };
      });

      // The nebula round the cluster, its own material: it thins as the system opens.
      const nebMat = new THREE.SpriteMaterial({
        map: cloudTex, color: tone[neb.tone], transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: neb.opacity, rotation: hash(`${s.id}~neb`) * Math.PI * 2,
      });
      const nebula = new THREE.Sprite(nebMat);
      nebula.position.set(s.home.x, s.home.y, s.home.z);
      nebula.scale.setScalar(neb.size);
      group.add(nebula);

      // Orbit spokes, stems and landing rings: one line set per system, moved with the opening.
      const planets = members.filter((m) => m.planet).length;
      const lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(palette.line.rgb, 0));
      lines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(planets * (4 + RING_SEGS * 2) * 3), 3));
      lines.frustumCulled = false;
      group.add(lines);
      // The system's plane: one thin circle round its star.
      const plane = new THREE.Mesh(new THREE.RingGeometry(1, 1.006, 128), new THREE.MeshBasicMaterial({
        color: col(palette.line.rgb), side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false,
      }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.copy(star.position);
      group.add(plane);

      // The hyperlane from the sun, bowed along the arm; trouble lights it in its hue.
      const mid = new THREE.Vector3(s.home.x, s.home.y, s.home.z).multiplyScalar(0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.35);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), mid, star.position.clone());
      const lane = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
        neb.tone === 'calm' ? lineMat(palette.line.rgb, palette.line.alpha * 0.6) : lineMat(palette[neb.tone], 0.5),
      );
      group.add(lane);

      own.push(nebMat, lines.geometry, lines.material, plane.geometry, plane.material, lane.geometry, lane.material);
      sites.push({
        id: s.id, node: s.node, home: s.home, reach: s.reach, status: shown.get(s.id), nebula: neb,
        star, starHalo, members, nebulaSprite: nebula, lines, plane, lane,
        open: was.get(s.id) ?? 0,
      });
    }
    scene.add(group);
    world = { group, own, sites, core: lay.core, byId: new Map(sites.map((s) => [s.id, s])) };
    place();
  };

  const drop = (w) => {
    scene.remove(w.group);
    for (const o of w.own) o.dispose();
  };

  /** Puts every member where its system's opening says. */
  const place = () => {
    for (const s of world.sites) {
      const k = Math.max(0, Math.min(1, s.open));
      const arr = s.lines.geometry.attributes.position.array;
      let j = 0;
      const push = (x, y, z) => { arr[j++] = x; arr[j++] = y; arr[j++] = z; };
      const e = ease(k);
      const spread = CLOSED + (1 - CLOSED) * e;
      for (const m of s.members) {
        const o = foldAt(k, m.off);
        const x = s.home.x + o.x, y = s.home.y + o.y, z = s.home.z + o.z;
        m.mesh.position.set(x, y, z);
        if (m.halo) m.halo.position.set(x, y, z);
        if (!m.planet) continue;
        push(s.home.x, s.home.y, s.home.z); push(x, y, z); // the spoke to its star
        push(x, y, z); push(x, s.home.y, z); // the stem down to the plane
        const r = SIZE.landing * spread;
        for (let i = 0; i < RING_SEGS; i++) {
          const a0 = (i / RING_SEGS) * Math.PI * 2, a1 = ((i + 1) / RING_SEGS) * Math.PI * 2;
          push(x + Math.cos(a0) * r, s.home.y, z + Math.sin(a0) * r);
          push(x + Math.cos(a1) * r, s.home.y, z + Math.sin(a1) * r);
        }
      }
      s.lines.geometry.setDrawRange(0, j / 3);
      s.lines.geometry.attributes.position.needsUpdate = true;
      s.lines.material.opacity = palette.line.alpha * (0.3 + 1.2 * e);
      s.plane.scale.setScalar(Math.max(60, s.reach * 0.9) * spread + 20);
      s.plane.material.opacity = palette.line.alpha * 0.6 * e;
      // You are inside the nebula now: it thins as the system opens.
      s.nebulaSprite.material.opacity = s.nebula.opacity * (1 - 0.7 * e);
    }
  };

  let lastKey = null;
  const update = (model) => {
    const nodes = Array.isArray(model?.nodes) ? model.nodes : [];
    const k = sceneKey(nodes);
    if (k === lastKey) return false;
    lastKey = k;
    build(nodes);
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
    if (world) {
      for (const s of world.sites) {
        if (s.nebula.breathes) s.nebulaSprite.scale.setScalar(s.nebula.size * (1 + PULSE.nebula * wave));
      }
    }
    // The dust turns once in about 26 minutes: alive under a held camera, never a motion you notice.
    dust.rotation.y = now * 0.000004;
    renderer.render(scene, camera);
  };

  const dispose = () => {
    if (world) drop(world);
    world = null;
    for (const o of shared) o.dispose();
    renderer.dispose();
  };

  return {
    update, setOpen, frame, resize, camera, renderer, dispose,
    get world() { return world; },
  };
}
