// Sketch (not a loop task): the Wall as one spiral galaxy in WebGL.
// The hub is the sun in the middle; the sites are star clusters along two
// spiral arms in a band of dust. At the overview each cluster is folded
// tight inside a nebula that takes its worst status (a red cloud reads from
// the door). When the camera flies to a site its cluster opens up into a 3D
// system: planets on inclined orbits above and below the plane, each on a
// stem to it, names on top. When the camera leaves, it folds back.
// Shapes inside a system come from the orbits layout (variants/orbits.js).

import * as THREE from '/vendor/three/three.module.js';
import { layoutFor } from './variants/orbits.js';
import { statusStyle } from '../views/map/overlays.js';

const COL = { crit: 0xff3b47, warn: 0xf0c63a, low: 0x6fa8ff, calm: 0xb8c4d0, sun: 0xfff1d6 };
const NEBULA = { crit: 0xff2a3a, warn: 0xe8b020, low: 0x4f7fd0, calm: 0x5a7090 };
const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const PLACE = new Set(['site', 'host']);
const q = new URLSearchParams(location.search);
const demo = q.has('demo');
const HOLD = demo ? 6000 : 14000, FLY = demo ? 2600 : 6000, OVERVIEW = demo ? 5000 : 12000;
const CLOSED = 0.16;        // a folded cluster's size against its open system
const OPEN_MS = 1800;       // how long a cluster takes to open or fold

const canvas = document.getElementById('w3');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030406, 0.00008);
const camera = new THREE.PerspectiveCamera(42, 1, 1, 30000);
scene.add(new THREE.PointLight(0xfff1d6, 2.2, 0, 0));
scene.add(new THREE.AmbientLight(0x8090a0, 0.55));
{ const d = new THREE.DirectionalLight(0xc8d4e0, 0.9); d.position.set(0.3, 1, 0.2); scene.add(d); }

const hash = (id) => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const toneOf = (n) => { const t = statusStyle(n).tone; return t === 'crit' || t === 'warn' || t === 'low' ? t : 'calm'; };
const hexOf = (t) => '#' + COL[t].toString(16).padStart(6, '0');
const rank = { crit: 3, warn: 2, low: 1, calm: 0 };
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// Two spiral arms: where a site sits (i-th of n) and where dust falls.
const ARM = { r0: 650, step: 520, turn: 0.85 };
const armAt = (i, n) => {
  const arm = i % 2, t = Math.floor(i / 2) + 0.6;
  const r = ARM.r0 + ARM.step * t, a = arm * Math.PI + t * ARM.turn;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
};

// Far stars and the galaxy's dust band.
{
  const g = new THREE.BufferGeometry(), n = 2500, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 9000 + Math.random() * 6000, a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
    p.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x55606c, size: 7, fog: false })));
}
const dust = (() => {
  const n = 9000, p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  const inner = new THREE.Color(0xffe2b8), outer = new THREE.Color(0x5b7ab0), tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const arm = i % 2, t = Math.pow(Math.random(), 0.8) * 4.2;
    const r = 180 + ARM.step * t + (Math.random() - 0.5) * 380;
    const a = arm * Math.PI + (t - 0.6) * ARM.turn + 0.6 * ARM.turn + (Math.random() - 0.5) * 0.55;
    const y = (Math.random() - 0.5) * 120 * Math.exp(-t * 0.25);
    p.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    tmp.copy(inner).lerp(outer, Math.min(1, t / 3.5));
    c.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const dot = document.createElement('canvas'); dot.width = dot.height = 32;
  { const x = dot.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32); }
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 20, map: new THREE.CanvasTexture(dot), vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(pts);
  return pts;
})();

const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
// A nebula: a soft, lumpy cloud (a few offset blobs), drawn once.
const cloudTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const cx = 128 + (Math.random() - 0.5) * 80, cy = 128 + (Math.random() - 0.5) * 80, r = 40 + Math.random() * 40;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  }
  // A round mask, so no blob ever meets the square's edge.
  x.globalCompositeOperation = 'destination-in';
  const m = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.6, 'rgba(0,0,0,0.8)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = m; x.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
})();

function label(text, px, color) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  const font = `600 ${px * 2}px "W3 Barlow", "Barlow Condensed", sans-serif`;
  x.font = font;
  const w = Math.ceil(x.measureText(text).width) + 16, h = px * 2 + 12;
  c.width = w; c.height = h;
  x.font = font; x.fillStyle = color; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.9)'; x.shadowBlur = 8;
  x.fillText(text, 8, h / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  s.userData.w = w * 0.5; s.userData.h = h * 0.5;
  s.scale.set(s.userData.w, s.userData.h, 1);
  s.center.set(0.5, 1.3);
  return s;
}

let world = null;
const layout = layoutFor(16 / 9);

function build(model) {
  const nodes = (model?.nodes ?? []).filter((n) => n && n.id != null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { pos } = layout(nodes);
  if (world) scene.remove(world.group);
  const group = new THREE.Group();
  const siteOf = (n) => { let c = n, k = 0; while (c && !PLACE.has(c.kind) && k++ < 50) c = byId.get(c.parent); return c; };
  const flat = (n) => { const p = pos.get(n.id); return p ? new THREE.Vector3(p.x * 2.2, 0, p.y * 2.2) : null; };
  const core = nodes.find((n) => n.kind === 'core');
  const siteNodes = nodes.filter((n) => PLACE.has(n.kind));
  const items = new Map();

  const sphere = (n, tone, size, planet) => {
    const mat = planet
      ? new THREE.MeshStandardMaterial({ color: COL[tone], roughness: 0.75, metalness: 0.05,
        emissive: tone === 'calm' ? 0x0d1116 : COL[tone], emissiveIntensity: tone === 'calm' ? 1 : 0.45 })
      : new THREE.MeshBasicMaterial({ color: COL[tone] });
    const m = new THREE.Mesh(new THREE.SphereGeometry(size, planet ? 32 : 20, planet ? 22 : 14), mat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: COL[tone], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: tone === 'calm' ? 0.35 : 0.9 }));
    halo.scale.setScalar(size * (tone === 'crit' ? 9 : tone === 'warn' ? 7 : 4.5));
    group.add(m, halo);
    return { m, halo };
  };

  // The sun.
  if (core) {
    const { m, halo } = sphere(core, 'sun', 60, false);
    halo.scale.setScalar(900);
    const text = label(String(core.label ?? core.id).toUpperCase(), 34, '#fff1d6');
    group.add(text);
    items.set(core.id, { n: core, m, halo, text, tone: 'sun', home: new THREE.Vector3(), off: new THREE.Vector3(), site: null });
  }

  // The clusters.
  const sites = [];
  siteNodes.forEach((s, i) => {
    const home = armAt(i, siteNodes.length);
    home.y = (hash(s.id) - 0.5) * 260;
    const base = flat(s) ?? new THREE.Vector3();
    const members = nodes.filter((n) => n !== s && siteOf(n) === s);
    const ys = new Map();
    const height = (n) => {
      if (ys.has(n.id)) return ys.get(n.id);
      const parent = byId.get(n.parent);
      let y;
      if (parent === s && NAMED.has(n.kind)) {
        const a = flat(n); const d = a ? Math.hypot(a.x - base.x, a.z - base.z) : 100;
        y = (hash(`${n.id}^`) < 0.5 ? -1 : 1) * d * (0.15 + 0.35 * hash(`${n.id}~`));
      } else y = (parent && parent !== s ? height(parent) : 0) + (hash(n.id) - 0.5) * 30;
      ys.set(n.id, y);
      return y;
    };
    const rec = { n: s, home, members: [], open: 0, target: 0, worst: 'calm', reach: 0 };
    const stoneOf = toneOf(s);
    const st = sphere(s, stoneOf, 24, false);
    const stext = label(String(s.label ?? s.id).toUpperCase(), 34, '#e3e8ee');
    group.add(stext);
    items.set(s.id, { n: s, ...st, text: stext, tone: stoneOf, home, off: new THREE.Vector3(), site: rec });
    let worst = rank[stoneOf];
    for (const n of members) {
      const f = flat(n);
      if (!f) continue;
      const off = new THREE.Vector3(f.x - base.x, height(n), f.z - base.z);
      const tone = toneOf(n);
      worst = Math.max(worst, rank[tone]);
      const planet = NAMED.has(n.kind);
      const sp = sphere(n, tone, planet ? 15 : 4, planet);
      let text = null;
      if (planet || tone !== 'calm') {
        text = label(String(n.label ?? n.id).toUpperCase(), 15, tone === 'calm' ? '#d6dde4' : hexOf(tone));
        group.add(text);
      }
      const it = { n, ...sp, text, tone, home, off, site: rec, planet };
      items.set(n.id, it);
      rec.members.push(it);
      rec.reach = Math.max(rec.reach, off.length());
    }
    rec.worst = Object.keys(rank).find((k) => rank[k] === worst) ?? 'calm';
    // The nebula round the cluster, in its worst colour.
    rec.nebula = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: NEBULA[rec.worst], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: rec.worst === 'calm' ? 0.35 : 0.8 }));
    rec.nebula.scale.setScalar(rec.worst === 'calm' ? 520 : 680);
    rec.nebula.position.copy(home);
    group.add(rec.nebula);
    // Lines that move with the opening: planet to star, stem to the plane.
    rec.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x6b7784, transparent: true, opacity: 0.45, depthWrite: false }));
    rec.lines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rec.members.length * 12), 3));
    group.add(rec.lines);
    rec.ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.006, 128), new THREE.MeshBasicMaterial({ color: 0x3a4652, side: THREE.DoubleSide, transparent: true, opacity: 0 }));
    rec.ring.rotation.x = -Math.PI / 2;
    group.add(rec.ring);
    sites.push(rec);
  });

  // Hyperlanes: the sun to each cluster, faint, bowed along the arm.
  for (const s of sites) {
    const mid = s.home.clone().multiplyScalar(0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.35);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), mid, s.home);
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: NEBULA[s.worst], transparent: true, opacity: s.worst === 'calm' ? 0.22 : 0.5, depthWrite: false })));
  }
  scene.add(group);
  world = { group, items, sites, byId };
  place(1);
}

/** Puts every member where its cluster's opening says (0 folded, 1 open). */
function place(dt) {
  for (const s of world.sites) {
    const k = ease(s.open);
    const spread = CLOSED + (1 - CLOSED) * k;
    const arr = s.lines.geometry.attributes.position.array;
    let j = 0;
    for (const it of s.members) {
      const p = it.m.position;
      p.set(s.home.x + it.off.x * spread, s.home.y + it.off.y * spread * k, s.home.z + it.off.z * spread);
      it.halo.position.copy(p);
      if (it.text) {
        it.text.position.copy(p);
        // Names come in as the system opens; trouble names a little earlier.
        it.text.material.opacity = Math.max(0, Math.min(1, (k - (it.tone === 'calm' ? 0.55 : 0.3)) * 3));
      }
      if (it.planet) {
        arr.set([s.home.x, s.home.y, s.home.z, p.x, p.y, p.z], j); j += 6;
        arr.set([p.x, p.y, p.z, p.x, s.home.y, p.z], j); j += 6;
      }
    }
    arr.fill(0, j);
    s.lines.geometry.setDrawRange(0, j / 3);
    s.lines.geometry.attributes.position.needsUpdate = true;
    s.lines.material.opacity = 0.1 + 0.4 * k;
    s.ring.position.copy(s.home);
    const rr = Math.max(60, s.reach * 0.9) * spread + 20;
    s.ring.scale.setScalar(rr);
    s.ring.material.opacity = 0.6 * k;
    // The nebula thins as the system opens: you are inside it now.
    s.nebula.material.opacity = (s.worst === 'calm' ? 0.35 : 0.8) * (1 - 0.7 * k);
  }
  const sun = [...world.items.values()].find((i) => i.tone === 'sun');
  if (sun) { sun.m.position.set(0, 0, 0); sun.halo.position.set(0, 0, 0); sun.text.position.set(0, 0, 0); }
  for (const s of world.sites) {
    const it = world.items.get(s.n.id);
    it.m.position.copy(s.home); it.halo.position.copy(s.home); it.text.position.copy(s.home);
  }
}

function update(model) {
  const nodes = model?.nodes ?? [];
  const key = nodes.map((n) => `${n.id}/${n.parent}/${n.kind}/${toneOf(n)}`).join('|');
  if (!world || world.key !== key) {
    const was = world ? new Map(world.sites.map((s) => [s.n.id, { open: s.open, target: s.target }])) : null;
    build(model);
    world.key = key;
    if (was) for (const s of world.sites) Object.assign(s, was.get(s.n.id) ?? {});
  }
}

// ------------------------------------------------------------------ the tour
let order = [], legAt = 0, leg = -1;
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
const from = { pos: new THREE.Vector3(), look: new THREE.Vector3() }, to = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
let flyStart = 0, last = 0;

function overviewShot(now) {
  let r = 0;
  for (const s of world.sites) r = Math.max(r, Math.hypot(s.home.x, s.home.z));
  const d = (r + 400) / Math.tan((camera.fov * Math.PI) / 360) * 0.9;
  const a = now * 0.000015;
  return { pos: new THREE.Vector3(Math.sin(a) * d * 0.62, d * 0.78, Math.cos(a) * d * 0.62), look: new THREE.Vector3() };
}
function siteShot(s, t) {
  // From outside the galaxy looking in, so the sun and the arms stand behind.
  const out = Math.atan2(s.home.x, s.home.z) + (hash(s.n.id) - 0.5) * 0.9 + t * 0.00002;
  const d = Math.max(560, s.reach * 1.9);
  return { pos: new THREE.Vector3(s.home.x + Math.sin(out) * d, s.home.y + d * 0.75, s.home.z + Math.cos(out) * d), look: s.home.clone() };
}
function caption(s) {
  const el = document.getElementById('w3-caption');
  if (!s) { el.style.opacity = 0; return; }
  let w = null;
  for (const it of s.members) if (rank[it.tone] >= 2 && (!w || rank[it.tone] > rank[w.tone])) w = it;
  const what = w
    ? [String(w.n.label ?? w.n.id), String(w.n.status ?? w.tone).replace(/_/g, ' '), typeof w.n.sub === 'string' ? w.n.sub : null].filter(Boolean).join(' · ')
    : 'all calm';
  el.innerHTML = '';
  const a = document.createElement('div'); a.className = 'site'; a.textContent = s.n.label ?? s.n.id;
  const b = document.createElement('div'); b.className = `line ${w ? (rank[w.tone] >= 3 ? 'crit' : 'warn') : 'calm'}`; b.textContent = what;
  el.append(a, b); el.style.opacity = 1;
}
function nextLeg(now) {
  from.pos.copy(cam.pos); from.look.copy(cam.look); flyStart = now;
  for (const s of world.sites) s.target = 0;
  if (leg !== -1 && leg >= order.length - 1) {
    leg = -1;
    const o = overviewShot(now); to.pos.copy(o.pos); to.look.copy(o.look);
    caption(null);
    legAt = now + FLY + OVERVIEW;
    return;
  }
  if (leg === -1) order = [...world.sites].sort((a, b) => rank[b.worst] - rank[a.worst] || hash(a.n.id) - hash(b.n.id));
  leg += 1;
  const s = order[leg];
  s.target = 1;
  const sh = siteShot(s, now); to.pos.copy(sh.pos); to.look.copy(sh.look);
  caption(s);
  legAt = now + FLY + HOLD;
}

// `?fps=1`: frames per second and script ms per frame, top left (for the tablet test).
const fpsEl = q.has('fps') ? Object.assign(document.body.appendChild(document.createElement('div')), {
  style: 'position:fixed;left:2vw;top:2vh;font:600 3vh monospace;color:#9fe0a8;z-index:9;text-shadow:0 0 6px #000',
}) : null;
let fpsN = 0, fpsT = 0, fpsMs = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const t0 = performance.now();
  try { draw(now); } finally {
    if (fpsEl) {
      fpsN++; fpsMs += performance.now() - t0;
      if (now - fpsT >= 1000) {
        fpsEl.textContent = `${Math.round((fpsN * 1000) / (now - fpsT))} fps · ${(fpsMs / fpsN).toFixed(1)} ms`;
        fpsN = 0; fpsMs = 0; fpsT = now;
      }
    }
  }
}
function draw(now) {
  const dt = last ? Math.min(100, now - last) : 16; last = now;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (!world) return;
  const park = q.get('at');
  const parked = park && world.sites.find((s) => String(s.n.label ?? s.n.id).toLowerCase() === park.toLowerCase());
  if (parked) {
    // `?at=<site>` parks on one system; `&open=0..1` sets how far it is open.
    parked.open = Number(q.get('open') ?? 1);
    place(dt);
    const sh = siteShot(parked, 0);
    camera.position.copy(sh.pos); camera.lookAt(sh.look); caption(parked);
  } else {
    if (!legAt) {
      const o = overviewShot(now);
      for (const v of [cam, from, to]) { v.pos.copy(o.pos); v.look.copy(o.look); }
      flyStart = now; legAt = now + OVERVIEW;
    }
    if (now >= legAt) nextLeg(now);
    // A cluster opens once the camera is most of the way there, folds as it leaves.
    for (const s of world.sites) {
      const want = s.target && now - flyStart > FLY * 0.45 ? 1 : 0;
      s.open += Math.sign(want - s.open) * Math.min(Math.abs(want - s.open), dt / OPEN_MS);
    }
    place(dt);
    const k = ease(Math.min(1, (now - flyStart) / FLY));
    if (leg >= 0 && now - flyStart > FLY) to.pos.copy(siteShot(order[leg], now).pos);
    if (leg === -1 && now - flyStart > FLY) to.pos.copy(overviewShot(now).pos);
    cam.pos.lerpVectors(from.pos, to.pos, k); cam.look.lerpVectors(from.look, to.look, k);
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
  }
  dust.rotation.y = now * 0.000004;
  // Trouble pulses: the halos, and a slow breath in a troubled nebula.
  const pulse = 0.75 + 0.25 * Math.sin(now / 420);
  for (const it of world.items.values()) {
    if (it.tone === 'crit' || it.tone === 'warn') it.halo.material.opacity = 0.55 + 0.4 * pulse;
    if (it.text) {
      const d = camera.position.distanceTo(it.m.position);
      const k2 = Math.max(1, d / 1500);
      it.text.scale.set(it.text.userData.w * k2, it.text.userData.h * k2, 1);
    }
  }
  for (const s of world.sites) if (s.worst === 'crit') s.nebula.scale.setScalar(680 * (0.94 + 0.08 * pulse));
  renderer.render(scene, camera);
}

function clock() {
  const d = new Date();
  document.getElementById('w3-clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
setInterval(clock, 10000); clock();

const load = () => fetch('/api/map').then((r) => (r.ok ? r.json() : null)).then((m) => m && update(m)).catch(() => {});
document.fonts?.load('600 30px "W3 Barlow"').finally(() => { load(); setInterval(load, 5000); requestAnimationFrame(frame); });
