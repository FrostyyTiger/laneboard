// Sketch (not a loop task): the Wall as a Stellaris-style galaxy in WebGL.
// The orbits layout gives every node its place on a plane (x, y); here that
// plane is the galaxy's, seen from above at an angle. The hub is a sun,
// sites are star systems, rooms and builders their planets, the rest dust.
// Each system floats at a height of its own, so the plane has depth. The
// camera sweeps from system to system, trouble first, and pulls back to the
// whole galaxy between. Names are sprites that always face the camera.

import * as THREE from '/vendor/three/three.module.js';
import { layoutFor } from './variants/orbits.js';
import { statusStyle } from '../views/map/overlays.js';

const COL = { crit: 0xff3b47, warn: 0xf0c63a, low: 0x6fa8ff, calm: 0xb8c4d0, sun: 0xfff1d6 };
const NAMED = new Set(['site', 'host', 'room', 'repo', 'builder']);
const PLACE = new Set(['site', 'host']);
const demo = new URLSearchParams(location.search).has('demo');
const HOLD = demo ? 5000 : 14000, FLY = demo ? 2500 : 6000, OVERVIEW = demo ? 4000 : 12000;

const canvas = document.getElementById('w3');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030406, 0.00011);
const camera = new THREE.PerspectiveCamera(42, 1, 1, 20000);
// The sun lights the planets; a little ambient and a top light so the far
// side of a system is never black.
scene.add(new THREE.PointLight(0xfff1d6, 2.2, 0, 0));
scene.add(new THREE.AmbientLight(0x8090a0, 0.55));
{ const d = new THREE.DirectionalLight(0xc8d4e0, 0.9); d.position.set(0.3, 1, 0.2); scene.add(d); }

// Far stars: a sphere of faint points, so the camera's sweep reads as motion.
{
  const g = new THREE.BufferGeometry(), n = 2500, p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 5000 + Math.random() * 5000, a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1);
    p.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x55606c, size: 6, sizeAttenuation: true, fog: false })));
}

// A soft round glow, drawn once, shared by every star's halo.
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
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
  // Drawn over everything: a name is never hidden behind a planet.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  s.scale.set(w * 0.5, h * 0.5, 1);
  s.center.set(0.5, 1.3);
  return s;
}

const hash = (id) => { let h = 2166136261; for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; };
const toneOf = (n) => { const t = statusStyle(n).tone; return t === 'crit' || t === 'warn' || t === 'low' ? t : 'calm'; };
const hexOf = (t) => '#' + COL[t].toString(16).padStart(6, '0');

let world = null;           // { group, byId, items, sites }
const layout = layoutFor(16 / 9);

function build(model) {
  const nodes = (model?.nodes ?? []).filter((n) => n && n.id != null);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { pos } = layout(nodes);
  if (world) scene.remove(world.group);
  const group = new THREE.Group();
  const items = new Map();
  const siteOf = (n) => { let c = n, k = 0; while (c && !PLACE.has(c.kind) && k++ < 50) c = byId.get(c.parent); return c; };
  // Height: each system its own level; its planets above or below that
  // plane, at most about half their distance from the star (inclined orbits:
  // depth, not a cloud); what hangs under a planet stays near it.
  const flat = (n) => { const p = pos.get(n.id); return p ? new THREE.Vector3(p.x * 2.2, 0, p.y * 2.2) : null; };
  const ys = new Map();
  const height = (n) => {
    if (ys.has(n.id)) return ys.get(n.id);
    let y = 0;
    const s = siteOf(n);
    if (n.kind === 'core' || !s) y = 0;
    else if (s === n) y = (hash(s.id) - 0.5) * 520;
    else {
      const parent = byId.get(n.parent);
      const sy = height(s);
      if (parent === s && NAMED.has(n.kind)) {
        const a = flat(n), b = flat(s);
        const d = a && b ? Math.hypot(a.x - b.x, a.z - b.z) : 100;
        const sign = hash(`${n.id}^`) < 0.5 ? -1 : 1;
        y = sy + sign * d * (0.15 + 0.35 * hash(`${n.id}~`));
      } else y = (parent ? height(parent) : sy) + (hash(n.id) - 0.5) * 30;
    }
    ys.set(n.id, y);
    return y;
  };
  const at = (n) => { const v = flat(n); if (v) v.y = height(n); return v; };
  for (const n of nodes) {
    const v = at(n);
    if (!v) continue;
    const tone = n.kind === 'core' ? 'sun' : toneOf(n);
    const planet = NAMED.has(n.kind) && !PLACE.has(n.kind);
    const size = n.kind === 'core' ? 46 : PLACE.has(n.kind) ? 22 : planet ? 15 : 4;
    // Stars glow flat; planets are lit by the sun (a lit side and a dark
    // side, so they read as round), trouble glows from inside.
    const mat = planet
      ? new THREE.MeshStandardMaterial({ color: COL[tone], roughness: 0.75, metalness: 0.05,
        emissive: tone === 'calm' ? 0x0d1116 : COL[tone], emissiveIntensity: tone === 'calm' ? 1 : 0.45 })
      : new THREE.MeshBasicMaterial({ color: COL[tone] });
    const star = new THREE.Mesh(new THREE.SphereGeometry(size, planet ? 32 : 20, planet ? 22 : 14), mat);
    star.position.copy(v);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: COL[tone], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: tone === 'calm' ? 0.35 : 0.9 }));
    halo.scale.setScalar(size * (tone === 'crit' ? 9 : tone === 'warn' ? 7 : 4.5));
    halo.position.copy(v);
    group.add(star, halo);
    let text = null;
    if (NAMED.has(n.kind) || n.kind === 'core' || tone !== 'calm') {
      const px = n.kind === 'core' || PLACE.has(n.kind) ? 34 : 15;
      text = label(String(n.label ?? n.id).toUpperCase(), px, tone === 'calm' ? '#d6dde4' : tone === 'sun' ? '#fff1d6' : hexOf(tone));
      text.position.copy(v);
      group.add(text);
    }
    items.set(n.id, { n, star, halo, text, v, tone });
  }
  // Hyperlanes: hub to each system (bright), system to its planets (faint).
  const lines = (pairs, color, opacity) => {
    const g = new THREE.BufferGeometry().setFromPoints(pairs.flat());
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
  };
  const lanes = [], moons = [];
  for (const { n, v } of items.values()) {
    const p = items.get(n.parent);
    if (!p) continue;
    (PLACE.has(n.kind) ? lanes : moons).push([p.v, v]);
  }
  lines(lanes, 0x7d8fa3, 0.55);
  lines(moons, 0x4a5561, 0.25);
  // Stems: each planet off its system's plane drops a line to it, with a
  // small ring where it lands, so above / below and how far reads at once.
  const stems = { calm: [], warn: [], crit: [], low: [] };
  for (const { n, v, tone } of items.values()) {
    if (!NAMED.has(n.kind) || PLACE.has(n.kind)) continue;
    const s = items.get(siteOf(n)?.id);
    if (!s || Math.abs(v.y - s.v.y) < 10) continue;
    const foot = new THREE.Vector3(v.x, s.v.y, v.z);
    stems[tone === 'sun' ? 'calm' : tone].push([v, foot]);
    const dot = new THREE.Mesh(new THREE.RingGeometry(7, 9, 24), new THREE.MeshBasicMaterial({ color: tone === 'calm' ? 0x6b7784 : COL[tone], side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    dot.rotation.x = -Math.PI / 2; dot.position.copy(foot);
    group.add(dot);
  }
  for (const [t, pairs] of Object.entries(stems)) if (pairs.length) lines(pairs, t === 'calm' ? 0x6b7784 : COL[t], t === 'calm' ? 0.5 : 0.85);
  // Orbit rings round each system, flat in its own plane.
  for (const { n, v } of items.values()) {
    if (!PLACE.has(n.kind)) continue;
    const far = Math.max(60, ...[...items.values()].filter((i) => i.n.parent === n.id).map((i) => Math.hypot(i.v.x - v.x, i.v.z - v.z)));
    const ring = new THREE.Mesh(new THREE.RingGeometry(far + 18, far + 20, 96), new THREE.MeshBasicMaterial({ color: 0x3a4652, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(v);
    group.add(ring);
  }
  scene.add(group);
  const sites = [...items.values()].filter((i) => PLACE.has(i.n.kind));
  world = { group, byId, items, sites, nodes, siteOf };
}

/** Status changes only recolour; a changed tree rebuilds. */
function update(model) {
  const nodes = model?.nodes ?? [];
  const shape = nodes.map((n) => `${n.id}/${n.parent}/${n.kind}`).join('|');
  const tones = nodes.map((n) => toneOf(n)).join('|');
  if (!world || world.shape !== shape || world.tones !== tones) { build(model); world.shape = shape; world.tones = tones; }
  latest = model;
}
let latest = null;

// ------------------------------------------------------------------ the tour
const rank = { crit: 3, warn: 2, low: 1, calm: 0 };
const worstIn = (site) => {
  let w = { r: 0, t: 'calm', n: null };
  for (const i of world.items.values()) {
    if (world.siteOf(i.n) !== site.n) continue;
    if (rank[i.tone] > w.r) w = { r: rank[i.tone], t: i.tone, n: i.n };
  }
  return w;
};
let order = [], legAt = 0, leg = -1; // leg -1: the overview
const cam = { pos: new THREE.Vector3(0, 2600, 3200), look: new THREE.Vector3() };
const from = { pos: cam.pos.clone(), look: cam.look.clone() }, to = { pos: cam.pos.clone(), look: cam.look.clone() };
let flyStart = 0;

function overviewShot() {
  const box = new THREE.Box3();
  for (const i of world.items.values()) box.expandByPoint(i.v);
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
  const d = r / Math.tan((camera.fov * Math.PI) / 360) * 0.95;
  return { pos: new THREE.Vector3(c.x, c.y + d * 0.72, c.z + d * 0.7), look: c };
}
function siteShot(s, t) {
  const a = hash(s.n.id) * Math.PI * 2 + t * 0.00002;
  // Back off by the system's size, so its farthest planet stays on screen.
  if (s.reach == null) {
    s.reach = 0;
    for (const i of world.items.values()) {
      if (world.siteOf(i.n) === s.n) s.reach = Math.max(s.reach, Math.hypot(i.v.x - s.v.x, i.v.y - s.v.y, i.v.z - s.v.z));
    }
  }
  const d = Math.max(520, s.reach * 1.9);
  return { pos: new THREE.Vector3(s.v.x + Math.sin(a) * d, s.v.y + d * 0.75, s.v.z + Math.cos(a) * d), look: s.v.clone() };
}
function caption(s) {
  const el = document.getElementById('w3-caption');
  if (!s) { el.style.opacity = 0; return; }
  const w = worstIn(s);
  const what = w.n && w.r >= 2
    ? [String(w.n.label ?? w.n.id), String(w.n.status ?? w.t).replace(/_/g, ' '), typeof w.n.sub === 'string' ? w.n.sub : null].filter(Boolean).join(' · ')
    : 'all calm';
  el.innerHTML = '';
  const a = document.createElement('div'); a.className = 'site'; a.textContent = s.n.label ?? s.n.id;
  const b = document.createElement('div'); b.className = `line ${w.r >= 3 ? 'crit' : w.r >= 2 ? 'warn' : 'calm'}`; b.textContent = what;
  el.append(a, b); el.style.opacity = 1;
}
function nextLeg(now) {
  from.pos.copy(cam.pos); from.look.copy(cam.look); flyStart = now;
  if (leg === -1 || leg >= order.length - 1) {
    if (leg !== -1) { leg = -1; const o = overviewShot(); to.pos.copy(o.pos); to.look.copy(o.look); caption(null); legAt = now + FLY + OVERVIEW; return; }
    // From the overview: a new order, systems in trouble first.
    order = [...world.sites].sort((a, b) => worstIn(b).r - worstIn(a).r || hash(a.n.id) - hash(b.n.id));
  }
  leg = leg === -1 ? 0 : leg + 1;
  const s = order[leg];
  const sh = siteShot(s, now); to.pos.copy(sh.pos); to.look.copy(sh.look);
  caption(s);
  legAt = now + FLY + HOLD;
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
function frame(now) {
  requestAnimationFrame(frame);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (!world) return;
  // `?at=<site>` parks the camera on one system (for a look up close).
  const park = new URLSearchParams(location.search).get('at');
  const parked = park && world.sites.find((s) => String(s.n.label ?? s.n.id).toLowerCase() === park.toLowerCase());
  if (parked) {
    const sh = siteShot(parked, now);
    camera.position.copy(sh.pos); camera.lookAt(sh.look); caption(parked);
    renderer.render(scene, camera);
    return;
  }
  if (!legAt) { const o = overviewShot(); cam.pos.copy(o.pos); cam.look.copy(o.look); legAt = now + OVERVIEW; }
  if (now >= legAt) nextLeg(now);
  const k = ease(Math.min(1, (now - flyStart) / FLY));
  // Hold: drift slowly round the system (the target moves, the ease follows).
  if (leg >= 0 && now - flyStart > FLY) { const sh = siteShot(order[leg], now); to.pos.copy(sh.pos); }
  cam.pos.lerpVectors(from.pos, to.pos, k); cam.look.lerpVectors(from.look, to.look, k);
  camera.position.copy(cam.pos); camera.lookAt(cam.look);
  // Trouble pulses; labels shrink with distance less than the stars do.
  const pulse = 0.75 + 0.25 * Math.sin(now / 420);
  for (const i of world.items.values()) {
    if (i.tone === 'crit' || i.tone === 'warn') i.halo.material.opacity = 0.55 + 0.4 * pulse;
    if (i.text) {
      const d = camera.position.distanceTo(i.v);
      const named = PLACE.has(i.n.kind) || i.n.kind === 'core';
      i.text.visible = named || i.tone !== 'calm' || d < 1400;
      const k2 = Math.max(1, d / 1500);
      i.text.scale.set(i.text.material.map.image.width * 0.5 * k2, i.text.material.map.image.height * 0.5 * k2, 1);
    }
  }
  renderer.render(scene, camera);
  globalThis.__w3 = { frames: (globalThis.__w3?.frames ?? 0) + 1 };
}

function clock() {
  const d = new Date();
  document.getElementById('w3-clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
setInterval(clock, 10000); clock();

const load = () => fetch('/api/map').then((r) => (r.ok ? r.json() : null)).then((m) => m && update(m)).catch(() => {});
document.fonts?.load('600 30px "W3 Barlow"').finally(() => { load(); setInterval(load, 5000); requestAnimationFrame(frame); });
