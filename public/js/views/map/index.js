// The Map: everything laneboard knows about, drawn as one constellation.
//
// The board answers "which session needs me". The Map answers the question
// before it: what exists, what depends on what, and where the trouble is. It
// is a radial tree (a core in the middle, then sites, rooms, builders, and
// the lanes and sessions inside them) with the relationships a tree cannot
// hold drawn as arcs across it: a shared device, a conflict, a package.
//
// This is the one view that moves on purpose, and every movement is data:
//
//   * a comet along an arc      an event travelled that link just now
//   * an expanding ring          an event landed on that node
//   * a repeating ping           the node is waiting for a human
//   * a turning arc              a lane is working
//
// Nothing else animates on its own, and `prefers-reduced-motion` turns all
// of it off: the map then draws once per change, still complete.
//
// What you do moves too, and that motion is built to be followed rather than
// noticed (core/motion.js has the maths):
//
//   * every position, fade and zoom is a critically damped spring: it starts
//     from the speed it has, never overshoots, and bends when the goal moves
//   * nodes move in angle and radius, so they swing along their rings
//   * a change plays in beats: what leaves folds into its parent, what stays
//     slides over, what arrives grows out of its parent one after another
//   * a jump across the map is a flight: out, across, and in again
//   * a drag glides on after you let go
//
// This module (plan §5 2.2) owns the state: the model, the drawn springs
// (`cur`), the camera, selection, scope and overlay. The pure parts live
// next to it (model.js, layout.js, overlays.js), the drawing in render.js and
// the input in interact.js. Keys are registered by the shell (§4 D8), which
// calls focusFind / fit / selectNext / setOverlay / toggleFold; the map has
// no keydown handler of its own.
//
//   const map = createMap(el, { title: 'lab', localId: 'builder-a' });
//   map.update({ nodes, links, events });
//   map.event({ node: 'x', kind: 'ok', text: '…' });
//   map.onSelect((sel, node) => navigate({ sel }));

import { damp, settled, wrapAngle, flight, inertia, stage, easeInOut } from '../../core/motion.js';
import {
  normalize, foldState, autoFold, visibleLinks, neighbours as neighboursOf, rollup, scopeAlpha,
  idForSel, selForId, SEVERITY, FOLD_KEY, AUTO_UNFOLD_ZOOM,
} from './model.js';
import { layout, RINGS, SIZE, polar, runRingR } from './layout.js';
import { OVERLAY_KEY, validOverlay, availableOverlays, reachScope, nodeStyle, SHAPE_CODE, TONE_CODE, driftText, driftCounts, runFacts } from './overlays.js';
import { createRenderer, readPalette } from './render.js';
import {
  createHitGrid, bindPointer, hitRadius, boundingCircle, fitCircle, anchored, clampZoom, fitScaleOf,
  laneOrder, nextInOrder, ZOOM_MIN, ZOOM_MAX,
} from './interact.js';

const TAU = Math.PI * 2;

/** Spring half-lives in ms: how quickly each kind of motion closes half its distance. */
const HL = { move: 80, fade: 55, zoom: 60, select: 70 };

/** Emphasis of what is not the focus (hover, selection, find). */
const UNLIT = 0.16;

/** The ambient layer's caps per 2.4 s round (2.9). */
const AMBIENT_PULSES = 24;
const AMBIENT_COMETS = 16;

/** Event keys remembered so a resent model does not pulse twice. */
const SEEN_MAX = 400;

const MODES = ['full', 'split', 'pip'];

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const pageHidden = () => globalThis.document?.visibilityState === 'hidden';
const clock = () => globalThis.performance?.now?.() ?? Date.now();

/** The tone a status pulses in (overlays.js tones; render.js maps them to tokens). */
function toneOf(status) {
  switch (status) {
    case 'crit': case 'down': return 'crit';
    case 'warn': case 'attention': return 'warn';
    case 'low': return 'low';
    default: return 'grey';
  }
}

const sevRank = (s) => Math.max(0, SEVERITY.indexOf(s ?? 'unknown'));

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const STATUS_WORD = {
  ok: 'up', working: 'working', warn: 'degraded', attention: 'needs you', crit: 'failing',
  down: 'down', idle: 'idle', unknown: 'no data', low: 'low',
};

const eventKey = (e) => `${e.at ?? ''}|${e.node ?? ''}|${e.link ?? ''}|${e.text ?? ''}`;

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The fold set on fleet keys (fleet F8b, plan §1 2.5): a lane folded before
 * the upgrade is `lane:<x>`; it becomes `lane:<localId>/<x>`, the id
 * server/map.mjs now gives it (laneNodeId). Entries that already carry a
 * builder, and every other kind of node, are kept as they are. Without a
 * valid local builder id nothing is rewritten. Pure; duplicates collapse.
 */
export function migrateFolds(list, localId) {
  const ok = typeof localId === 'string' && /^[a-z0-9-]{1,24}$/.test(localId);
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    if (typeof id !== 'string' || !id) continue;
    let v = id;
    if (ok && id.startsWith('lane:') && id.length > 5 && !id.includes('/')) v = `lane:${localId}/${id.slice(5)}`;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * Mount the map in `root`. `opts`:
 *   title                 the plate at the top left
 *   localId               this builder's id, for migrating stored folds
 *   actions(node)         -> [{id, icon, label, tier, run}] (the legacy panel shows them)
 *   anchorEl()            -> the inspector element; given, the map draws its tether to it
 *                            and shows no panel of its own (§4 inspector, 2.3)
 *   onSelect(node)        legacy callback on every selection change
 *   budgetUsd(node)       the builder's budget cap for the cost overlay
 *   perf                  print p95 draw time in the readout (default: ?mapperf=1)
 *
 * Returns the API of plan §5 2.2 plus the shell hooks (§4 D8).
 */
export function createMap(root, opts = {}) {
  root.classList.add('map');
  root.replaceChildren();

  const canvas = h('canvas', 'map-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Map of sites, rooms, builders, lanes and sessions');
  const hud = h('div', 'map-hud');

  // Top left: what this is, and a topology file that stopped parsing (the
  // last good map stays up, and this says why it is not the newest).
  const head = h('div', 'map-head');
  const title = h('h2', 'map-title', opts.title ?? 'Map');
  const problem = h('p', 'map-problem');
  problem.hidden = true;
  head.append(title, problem);

  // Top right: the readout corner, then find + fit under it.
  const readoutEl = h('div', 'map-readout');
  readoutEl.setAttribute('aria-live', 'off');
  const find = h('div', 'map-find');
  const input = h('input', 'map-find-input');
  input.id = 'map-find';
  input.type = 'search';
  input.placeholder = 'Find  /';
  input.setAttribute('aria-label', 'Find a node');
  const fitBtn = h('button', 'map-btn', 'Fit');
  fitBtn.title = 'Fit everything (f)';
  find.append(input, fitBtn);

  // Right: the selected node, until the §4 inspector takes over (anchorEl).
  const legacyPanel = typeof opts.anchorEl !== 'function';
  const panel = h('aside', 'map-panel');
  panel.hidden = true;

  const tip = h('div', 'map-tip');
  tip.hidden = true;

  hud.append(head, readoutEl, find, ...(legacyPanel ? [panel] : []), tip);
  root.append(canvas, hud);

  const ctx = canvas.getContext('2d');
  const renderer = createRenderer(ctx, readPalette(root));

  // --- state
  let model = normalize(null);
  let byId = new Map();           // every node, drawn or folded away
  let lay = { pos: new Map(), center: null, kids: new Map() };
  let kidsAll = new Map();        // id -> child nodes, folded ones included
  let kidsRoll = new Map();       // kidsAll with the (maybe virtual) centre's children
  let hidden = new Set();         // ids inside a folded node
  let folded = new Set();         // ids drawn folded (the user's and the automatic folds)
  let shownOf = (id) => id;       // the drawn node standing in for an id
  let vlinks = [];                // links to draw (model.visibleLinks)
  let vreach = [];                // reach links, ends mapped to drawn nodes (reach overlay)
  // id -> the drawn state of a node: polar position r/t with velocities, its
  // appearance a (0..1), x/y derived, and when it may start moving. A node
  // that left stays here as a ghost (`leaving`) until it has faded into `into`.
  const cur = new Map();
  const collapsed = new Set(loadFolded());
  let autoSet = new Set();        // lanes whose sessions fold away by themselves (2.4)
  const opened = new Set();       // auto-folded lanes the user opened by hand (this visit)
  let zoomedIn = false;           // cam.z >= AUTO_UNFOLD_ZOOM at the last relayout
  let badges = [];                // [{id, x, y, w, h}] screen rects of "+N"
  let neighbours = new Map();     // id -> Set(id)
  let pulses = [];                // {id, t0, tone, soft}
  let comets = [];                // {link, t0, dur, tone, soft}
  const seen = new Set();         // event keys already shown
  let hover = null;
  let highlighted = null;         // lit from outside (split view row hover)
  let selected = null;
  let wantSel = null;             // {sel, fly}: a selection asked for before its node exists
  let wantFlyTo = null;           // a flight asked for before its node was laid out
  let query = '';
  let matches = new Set();
  let scope = 'all';
  let scopeFlown = true;          // the scope flight happened (or none is due)
  let scopeW = new Map();         // id -> scope emphasis (scopeAlpha), per relayout
  let overlay = loadOverlay();
  let mode = 'full';
  const insets = { right: 0 };
  let version = 0;

  const cam = { x: 0, y: 0, z: 1 };
  let fl = null;                  // a camera flight: {path, t0, ms, to}
  let glide = null;               // a released drag: {vx, vy} in world units per ms
  let zoomGoal = null;            // wheel zoom: {goal, v, sx, sy, wx, wy} (goal = log z)
  const sel = { id: null, t: 0, v: 0 }; // the selection mark, drawing in
  let userMoved = false;
  let W = 0, H = 0, dpr = 1, fitScale = 1;
  let raf = 0, lastPing = 0, lastFrame = 0, frameNo = 0;
  const focusAlpha = new Map();   // id -> current emphasis 0..1
  const focusVel = new Map();     // id -> its spring velocity
  const grid = createHitGrid(48);
  let drawnCount = 0;
  let readoutText = '';
  const selectCbs = new Set();
  const hoverCbs = new Set();
  const perfOn = opts.perf ?? /[?&#]mapperf=1\b/.test(`${globalThis.location?.search ?? ''}${globalThis.location?.hash ?? ''}`);
  const drawMs = [];

  const view = () => ({ W, H, fitScale });
  const scale = () => fitScale * cam.z;
  const toScreen = (p) => ({ x: W / 2 + (p.x - cam.x) * scale(), y: H / 2 + (p.y - cam.y) * scale() });
  const toWorld = (x, y) => ({ x: (x - W / 2) / scale() + cam.x, y: (y - H / 2) / scale() + cam.y });

  // --- sizing
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(root);

  function computeFit() {
    return fitScaleOf(W, H, maxRadius() + 64);
  }

  function resize() {
    const r = root.getBoundingClientRect();
    // Hidden (another view is showing): keep the last size; the observer
    // fires again when the Map comes back.
    if (W && (!(r.width >= 1) || !(r.height >= 1))) return;
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(2.5, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    fitScale = computeFit();
    if (!userMoved) fit(true);
    kick();
  }

  function maxRadius() {
    let m = RINGS[2];
    for (const p of lay.pos.values()) m = Math.max(m, p.r);
    return m;
  }

  /** The inspector (or the legacy panel) covering the right of the canvas, in CSS px. */
  function rightInset() {
    if (insets.right > 0) return Math.min(insets.right, W * 0.6);
    if (legacyPanel && W > 1000 && selected && !panel.hidden) return 332;
    return 0;
  }

  function fit(instant) {
    userMoved = false;
    const right = rightInset();
    const outer = maxRadius() + 64;
    const z = right ? clampZoom(Math.min(1, (W - right) / (2 * outer * (fitScale || 1)))) : 1;
    flyCam({ x: right / (2 * (fitScale || 1) * z), y: 0, z }, instant);
  }

  /** Width of world in view at zoom z. */
  const viewW = (z) => W / ((fitScale || 1) * z);

  /** Move the camera to a view: a flight when there is room to show one. */
  function flyCam(to, instant = false) {
    glide = null;
    zoomGoal = null;
    if (instant || reducedMotion() || !W) {
      fl = null;
      Object.assign(cam, to);
      kick();
      return;
    }
    const path = flight([cam.x, cam.y, viewW(cam.z)], [to.x, to.y, viewW(to.z)]);
    fl = { path, t0: clock(), ms: path.ms, to };
    kick();
  }

  /** Where the camera is headed: the end of a flight, or where it is. */
  const camGoal = () => fl?.to ?? cam;

  // --- model
  function update(next) {
    model = normalize(next);
    if (model.title) title.textContent = model.title;
    problem.textContent = model.error ?? '';
    problem.hidden = !model.error;
    const first = !cur.size;
    byId = new Map(model.nodes.map((n) => [n.id, n]));
    if (selected && !byId.has(selected)) selected = null;
    if (wantSel) {
      const id = idForSel(wantSel.sel, byId);
      if (id) {
        selected = id; sel.id = id; sel.t = 0; sel.v = 0;
        if (wantSel.fly) wantFlyTo = id;
        wantSel = null;
      }
    }
    relayout({ first });
    // A map nobody moved stays fitted as it grows or shrinks.
    if (!userMoved && !fl) fit(true);

    // Events we have not seen become pulses.
    for (const e of model.events) if (!seen.has(eventKey(e))) event(e, { quiet: first });

    if (!scopeFlown && byId.has(`builder:${scope}`)) flyScope();
    if (wantFlyTo && lay.pos.has(wantFlyTo)) { const id = wantFlyTo; wantFlyTo = null; flyTo(id); }
    renderPanel();
    kick();
  }

  /** The automatic folds (2.4), minus the lanes the user opened by hand. */
  function computeAuto() {
    const out = autoFold(model.nodes, { selected, scope, zoom: cam.z });
    for (const id of opened) out.delete(id);
    return out;
  }

  /**
   * Lay out what is drawn (everything outside a folded node) and stage the
   * change: leavers fold into their parent first, stayers slide next,
   * arrivals grow out of their parent one by one around the circle.
   */
  function relayout({ first = false } = {}) {
    const now = clock();
    autoSet = computeAuto();
    zoomedIn = cam.z >= AUTO_UNFOLD_ZOOM;
    const fs = foldState(model.nodes, collapsed, autoSet);
    kidsAll = fs.kids;
    hidden = fs.hidden;
    folded = fs.folded;
    shownOf = fs.shown;
    if (selected && hidden.has(selected)) selected = shownOf(selected);

    const prev = new Map([...cur].filter(([, c]) => !c.leaving).map(([id, c]) => [id, c.goal]));
    lay = layout(model.nodes.filter((n) => !hidden.has(n.id)));
    if (lay.center.virtual) byId.set(lay.center.id, lay.center);
    kidsRoll = new Map(kidsAll);
    kidsRoll.set(lay.center.id, lay.kids.get(lay.center.id) ?? []);
    const parentOf = (n) => (n?.parent && byId.has(n.parent) ? n.parent : lay.center.virtual ? lay.center.id : null);

    const still = reducedMotion() || pageHidden();
    const entries = [];
    let exits = 0, moves = 0;
    for (const [id, p] of lay.pos) {
      const n = byId.get(id);
      const goal = { r: p.r, t: p.angle };
      const c = cur.get(id);
      if (c) {
        if (c.leaving) { c.leaving = false; c.into = null; }
        const was = prev.get(id);
        if (was && (Math.abs(was.r - goal.r) > 0.5 || Math.abs(wrapAngle(was.t - goal.t)) > 0.002)) moves++;
        Object.assign(c, { goal, node: n, pid: parentOf(n), depth: p.depth });
        continue;
      }
      // A new node starts where its parent is drawn (the core, on first load).
      const from = cur.get(n?.parent) ?? null;
      const c0 = {
        r: still ? goal.r : first ? 0 : from?.r ?? goal.r,
        t: still || first ? goal.t : from?.t ?? goal.t,
        vr: 0, vt: 0, a: still ? 1 : 0, va: 0,
        goal, node: n, pid: parentOf(n), depth: p.depth,
        holdUntil: 0, entering: !still,
      };
      Object.assign(c0, polar(c0.r, c0.t));
      cur.set(id, c0);
      if (!still) entries.push(id);
    }
    for (const [id, c] of cur) {
      if (lay.pos.has(id) || c.leaving) continue;
      if (still) { cur.delete(id); continue; }
      // It folds back into the nearest ancestor still drawn.
      let into = c.pid;
      while (into != null && !lay.pos.has(into)) into = cur.get(into)?.pid ?? byId.get(into)?.parent ?? null;
      Object.assign(c, { leaving: true, into, holdUntil: now, entering: false });
      exits++;
    }

    if (!still) {
      if (first) {
        // The first look blooms outward ring by ring, sweeping round once.
        for (const id of entries) {
          const c = cur.get(id);
          const sweep = ((wrapAngle(c.goal.t + Math.PI / 2) + Math.PI) / TAU) * 220;
          c.holdUntil = now + (c.depth - 1) * 120 + sweep;
        }
      } else {
        entries.sort((a, b) => {
          const A = cur.get(a), B = cur.get(b);
          return A.depth - B.depth || wrapAngle(A.goal.t + Math.PI / 2) - wrapAngle(B.goal.t + Math.PI / 2);
        });
        const s = stage({ exits, moves, entries });
        if (s.moveAt) for (const [id, c] of cur) if (!c.leaving && !entries.includes(id)) c.holdUntil = now + s.moveAt;
        for (const id of entries) cur.get(id).holdUntil = now + s.at.get(id);
      }
    }

    // Neighbours: drawn parent/child pairs and every link, folded ends moved up.
    const ends = [];
    for (const l of model.links) {
      const a = shownOf(l.from), b = shownOf(l.to);
      if (a != null && b != null && a !== b && lay.pos.has(a) && lay.pos.has(b)) ends.push({ from: a, to: b });
    }
    neighbours = neighboursOf(lay.pos, byId, ends);
    rescope();
    relink();

    // Zoomed or panned by hand, the scale stays put (a ring appearing must not
    // jerk the view); the next fit or resize picks the new size up.
    if (!userMoved) fitScale = computeFit();
    version++;
  }

  /** The links to draw: they depend on the focus, the overlay and the scope. */
  function relink() {
    vlinks = visibleLinks(model.links, shownOf, {
      focus: hover ?? highlighted ?? selected, overlay: shownOverlay(), scope, byId, drawn: lay.pos,
    });
    // Reach links whose ends are folded attach to the node standing in for them.
    const seenReach = new Set();
    vreach = [];
    for (const l of model.reach?.links ?? []) {
      const from = shownOf(l.from), to = shownOf(l.to);
      const key = `${from}\u0000${to}`;
      if (from === to || seenReach.has(key) || !lay.pos.has(from) || !lay.pos.has(to)) continue;
      seenReach.add(key);
      vreach.push({ ...l, from, to });
    }
  }

  /** The overlay drawn: a stored `reach` shows as status while the model has no reach links. */
  function shownOverlay() {
    return availableOverlays(model).includes(overlay) ? overlay : 'status';
  }

  function rescope() {
    scopeW = new Map();
    if (scope === 'all') return;
    for (const id of lay.pos.keys()) {
      const a = scopeAlpha(byId.get(id), scope, byId);
      if (a < 1) scopeW.set(id, a);
    }
  }

  // --- folding
  function loadFolded() {
    let raw;
    try { raw = JSON.parse(globalThis.localStorage?.getItem(FOLD_KEY) || '[]'); } catch { return []; }
    const list = Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
    const out = migrateFolds(list, opts.localId);
    if (out.length !== list.length || out.some((v, i) => v !== list[i])) {
      try { globalThis.localStorage?.setItem(FOLD_KEY, JSON.stringify(out)); } catch { /* private window */ }
    }
    return out;
  }
  function saveFolded() {
    try { globalThis.localStorage?.setItem(FOLD_KEY, JSON.stringify([...collapsed])); } catch { /* private window: folds last this visit */ }
  }

  function loadOverlay() {
    try { return validOverlay(globalThis.localStorage?.getItem(OVERLAY_KEY)); } catch { return 'status'; }
  }

  /** Fold a node's children into it, or unfold them (the selection by default). */
  function toggleFold(id = selected) {
    if (!id || !(kidsAll.get(id)?.length)) return;
    if (collapsed.has(id)) collapsed.delete(id);
    else if (autoSet.has(id)) opened.add(id);
    else { collapsed.add(id); opened.delete(id); }
    saveFolded();
    relayout();
    // The circle re-balances around the change; zoomed in, the camera follows the node.
    if (userMoved) flyTo(id, camGoal().z);
    renderPanel();
    kick();
  }

  /** Unfold whatever the user folded over `id`, so it can be shown. */
  function reveal(id) {
    if (!id || !hidden.has(id)) return false;
    let changed = false;
    for (let p = byId.get(id)?.parent; p != null; p = byId.get(p)?.parent) changed = collapsed.delete(p) || changed;
    if (changed) saveFolded();
    return true;
  }

  /** One thing happened. A node gets a ring, a link gets a comet. */
  function event(e, { quiet = false } = {}) {
    if (!e || typeof e !== 'object') return;
    const key = eventKey(e);
    seen.add(key);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    const at = e.at ?? Date.now();
    const tone = toneOf(e.kind ?? 'working');
    const fresh = Date.now() - at < 15000;
    if (!quiet && fresh && !reducedMotion()) {
      const spot = shownOf(e.node);
      if (spot != null && lay.pos.has(spot)) pulses.push({ id: spot, t0: clock(), tone });
      if (e.link) {
        const l = vlinks.find((x) => x.id === e.link || `${x.from}>${x.to}` === e.link);
        if (l) comets.push({ link: l, t0: clock(), dur: 1600, tone });
      }
    }
    kick();
  }

  // --- selection
  /**
   * Select a node (an id or a router `sel=` value). `emit` tells the
   * listeners (the router), which a selection that came from the router
   * must not do; `fly` flies the camera to it.
   */
  function pick(x, { fly = false, emit = false, via = null } = {}) {
    let id = x == null || x === '' ? null : idForSel(String(x), byId);
    if (x != null && x !== '' && !id) {
      // Not in the model (yet: a deep link before the first model): kept for update().
      wantSel = { sel: String(x), fly };
      if (selected) { selected = null; sel.id = null; relayout(); renderPanel(); kick(); }
      return;
    }
    wantSel = null;
    const changed = id !== selected;
    if (id && hidden.has(id)) reveal(id);
    if (changed) { sel.id = id; sel.t = 0; sel.v = 0; }
    selected = id;
    const nextAuto = computeAuto();
    if (!sameSet(nextAuto, autoSet) || (id && hidden.has(id))) relayout(); else relink();
    if (selected !== id) id = selected; // still folded away: the node standing in for it
    renderPanel();
    if (changed) {
      const node = id ? byId.get(id) ?? null : null;
      opts.onSelect?.(node);
      if (emit) for (const cb of selectCbs) cb(id ? selForId(id) : null, node, { via });
    }
    if (fly && id) {
      if (lay.pos.has(id)) flyTo(id); else wantFlyTo = id;
    }
    kick();
  }

  function flyTo(x, z = 1.9) {
    const id = byId.has(x) ? x : idForSel(x, byId);
    if (!id) return;
    if (reveal(id)) relayout();
    const p = lay.pos.get(id);
    if (!p) return;
    userMoved = true;
    const tz = Math.max(camGoal().z, z);
    const right = rightInset();
    // Keep the node clear of the inspector on the right; on a narrow screen, of the sheet below.
    const narrow = W <= 760;
    flyCam({ x: p.x + right / (2 * fitScale * tz), y: p.y + (narrow ? 60 / (fitScale * tz) : 0), z: tz });
  }

  /** Next/previous lane in attention order (`j`/`k`, §4 2.6). */
  function selectNext(dir = 1) {
    const order = laneOrder(model.nodes, { scope });
    const curLane = selected && byId.get(selected)?.kind === 'session' ? byId.get(selected).parent : selected;
    const id = nextInOrder(order, curLane, dir);
    if (id) pick(id, { fly: true, emit: true, via: 'key' });
    return id;
  }

  // --- scope and overlay
  /** Rail scope `b=` (2.7): ghost every other builder and fly to this one's subtree. */
  function setScope(b) {
    const next = typeof b === 'string' && b && b !== 'all' ? b : 'all';
    if (next === scope) return;
    scope = next;
    relayout();
    if (scope === 'all') { scopeFlown = true; fit(false); } else if (byId.has(`builder:${scope}`)) flyScope(); else scopeFlown = false;
    kick();
  }

  function flyScope() {
    scopeFlown = true;
    const root0 = `builder:${scope}`;
    const pts = [];
    const walk = (id, depth) => {
      const c = lay.pos.get(id);
      if (c) pts.push({ x: c.x, y: c.y, r: (SIZE[byId.get(id)?.kind] ?? 5) + 40 });
      if (depth > 32) return;
      for (const k of kidsAll.get(id) ?? []) walk(k.id, depth + 1);
    };
    walk(root0, 0);
    const circle = boundingCircle(pts);
    if (!circle) return;
    userMoved = true;
    flyCam(fitCircle(circle, view(), { right: rightInset() }), reducedMotion());
  }

  /**
   * The overlay (2.6): persisted, instant, and shown in the readout. One the
   * model cannot show (reach without reach links) is refused: the current
   * overlay stays and is returned.
   */
  function setOverlay(name) {
    const next = validOverlay(name);
    if (!availableOverlays(model).includes(next)) return shownOverlay();
    if (next === overlay) return overlay;
    overlay = next;
    try { globalThis.localStorage?.setItem(OVERLAY_KEY, overlay); } catch { /* private window */ }
    relink();
    version++;
    kick();
    return overlay;
  }

  function setMode(m) {
    mode = MODES.includes(m) ? m : 'full';
    root.dataset.mapMode = mode;
    resize();
  }

  /** The inspector overlay's width on the right (§4 shell): fits and flights keep clear of it. */
  function setInsets({ right = 0 } = {}) {
    const r = Math.max(0, Number(right) || 0);
    if (r === insets.right) return;
    insets.right = r;
    if (!userMoved) fit(false);
    kick();
  }

  function highlight(x) {
    const id = x == null ? null : byId.has(x) ? x : idForSel(String(x), byId);
    if (id === highlighted) return;
    highlighted = id;
    relink();
    kick();
  }

  function focusFind() {
    input.focus();
    input.select?.();
  }

  // --- the legacy panel (until the §4 inspector is mounted, 2.3)
  /** "room · site", so a lane named like its neighbour is still findable. */
  function where(n) {
    const chain = [];
    let p = n.parent && byId.get(n.parent);
    while (p && p.kind !== 'core' && chain.length < 2) { chain.push(p.label ?? p.id); p = p.parent && byId.get(p.parent); }
    return chain.join(' · ');
  }

  let panelFor = null;
  let panelOutTimer = 0;
  function renderPanel() {
    if (!legacyPanel) return;
    const n = selected && byId.get(selected);
    if (!n || n.virtual) {
      panelFor = null;
      // Closing plays out, then hides; a new selection meanwhile cancels it.
      if (panel.hidden || panel.classList.contains('map-panel-out')) return;
      if (reducedMotion()) { panel.hidden = true; return; }
      panel.classList.add('map-panel-out');
      // A background tab pauses CSS animations, so the end is also on a timer.
      const done = () => {
        clearTimeout(panelOutTimer);
        if (panel.classList.contains('map-panel-out')) { panel.hidden = true; panel.classList.remove('map-panel-out'); }
      };
      panel.addEventListener('transitionend', done, { once: true });
      panelOutTimer = setTimeout(done, 220);
      return;
    }
    panel.classList.remove('map-panel-out');
    panel.hidden = false;
    panelFor = n.id;
    panel.replaceChildren();
    const close = h('button', 'map-panel-close', '×');
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => pick(null, { emit: true }));
    const eyebrow = h('div', 'map-eyebrow', [n.kind, where(n)].filter(Boolean).join(' · '));
    const name = h('h3', 'map-panel-title', n.label ?? n.id);
    const status = n.status ?? 'unknown';
    const pill = h('span', `map-pill s-${STATUS_WORD[status] ? status : 'unknown'}`, STATUS_WORD[status] ?? String(status));
    panel.append(close, eyebrow, name, pill);
    if (driftText(n)) panel.append(h('p', 'map-drift', driftText(n)));
    if (n.why) panel.append(h('p', 'map-why', String(n.why)));
    if (n.sub) panel.append(h('p', 'map-sub', String(n.sub)));

    const m = n.metrics ?? {};
    const bars = [['cpu', 'CPU'], ['mem', n.memCache ? 'Memory*' : 'Memory'], ['disk', 'Disk'], ['gpu', 'GPU']].filter(([k]) => typeof m[k] === 'number');
    if (bars.length) {
      const g = h('div', 'map-bars');
      for (const [k, word] of bars) {
        const v = Math.max(0, Math.min(1, m[k]));
        const row = h('div', 'map-bar');
        const track = h('div', 'map-bar-track');
        const calm = k === 'mem' && n.memCache;
        const fill = h('div', `map-bar-fill ${calm ? '' : v > 0.9 ? 's-crit' : v > 0.75 ? 's-warn' : ''}`);
        fill.style.width = `${(v * 100).toFixed(1)}%`;
        track.append(fill);
        row.append(h('span', 'map-bar-k', word), track, h('span', 'map-bar-v', `${Math.round(v * 100)}%`));
        g.append(row);
      }
      if (n.memCache && typeof m.mem === 'number') g.append(h('p', 'map-note', '* as the hypervisor sees it: includes page cache the guest can drop'));
      panel.append(g);
    }

    const detail = Object.entries(n.detail ?? {});
    if (detail.length) {
      const dl = h('dl', 'map-dl');
      for (const [k, v] of detail) dl.append(h('dt', null, k), h('dd', null, String(v)));
      panel.append(dl);
    }

    const rel = [];
    for (const l of model.links) {
      if (l.from === n.id && byId.has(l.to)) rel.push([l.label ?? l.kind ?? 'to', l.to, '→']);
      if (l.to === n.id && byId.has(l.from)) rel.push([l.label ?? l.kind ?? 'from', l.from, '←']);
    }
    const children = kidsRoll.get(n.id) ?? [];
    if (rel.length || children.length) {
      const sec = h('div', 'map-rel');
      if (rel.length) {
        sec.append(h('h4', 'map-h', 'Linked'));
        for (const [word, id, arrow] of rel.slice(0, 24)) sec.append(chip(id, `${arrow} ${word}`));
      }
      if (children.length) {
        const head2 = h('h4', 'map-h map-h-row', `Inside · ${children.length}`);
        if (n.id !== lay.center?.id) {
          const isFolded = folded.has(n.id);
          const fold = h('button', 'map-fold', isFolded ? 'Unfold' : 'Fold');
          fold.title = `${isFolded ? 'Show' : 'Hide'} what is inside (c)`;
          fold.setAttribute('aria-expanded', String(!isFolded));
          fold.addEventListener('click', () => toggleFold(n.id));
          head2.append(fold);
        }
        sec.append(head2);
        for (const c of children.slice(0, 24)) sec.append(chip(c.id));
      }
      panel.append(sec);
    }
    if (typeof n.href === 'string' && /^https?:[/][/]/i.test(n.href)) {
      const a = h('a', 'map-open', 'Open ↗');
      a.href = n.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      panel.append(a);
    }
    if (typeof opts.actions === 'function') {
      const acts = opts.actions(n);
      if (acts?.length) {
        const row = h('div', 'map-actions');
        for (const act of acts) {
          if (typeof act?.run !== 'function') continue;
          const b = h('button', 'map-btn', act.label ?? act.id ?? '');
          b.addEventListener('click', () => act.run(n));
          row.append(b);
        }
        panel.append(row);
      }
    }
  }

  function chip(id, note) {
    const n = byId.get(id);
    const b = h('button', 'map-chip');
    b.append(h('i', `map-dot s-${STATUS_WORD[n?.status] ? n.status : 'unknown'}`), document.createTextNode(n?.label ?? id));
    if (note) b.append(h('span', 'map-chip-note', note));
    b.addEventListener('click', () => pick(id, { fly: true, emit: true, via: 'panel' }));
    return b;
  }

  // --- find
  input.addEventListener('input', () => {
    query = input.value.trim().toLowerCase();
    matches = new Set(query ? model.nodes.filter((n) => `${n.label ?? ''} ${n.id} ${n.sub ?? ''}`.toLowerCase().includes(query)).map((n) => n.id) : []);
    kick();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matches.size) {
      const id = [...matches][0];
      pick(id, { fly: true, emit: true, via: 'find' });
      input.blur();
    }
    if (e.key === 'Escape') { input.value = ''; query = ''; matches.clear(); input.blur(); kick(); }
  });
  fitBtn.addEventListener('click', () => fit(false));

  // --- pointer
  /** The hit grid, rebuilt only when a frame has drawn since (the camera or positions moved). */
  function hit(x, y) {
    if (grid.stale(frameNo)) {
      const s = scale();
      const items = [];
      for (const [id, c] of cur) {
        const n = c.node;
        if (!n || n.virtual || c.leaving || c.a < 0.3) continue;
        const sp = toScreen(c);
        if (sp.x < -40 || sp.y < -40 || sp.x > W + 40 || sp.y > H + 40) continue;
        let r = hitRadius(SIZE[n.kind] ?? 5, s);
        // A run is as big as its progress ring: a tap on the ring hits it.
        if (n.kind === 'run') r = Math.max(r, runRingR(SIZE.run * Math.max(0.8, Math.min(1.6, s))) + 2);
        items.push({ id, x: sp.x, y: sp.y, r });
      }
      grid.rebuild(items, frameNo);
    }
    return grid.hit(x, y);
  }
  const badgeAt = (x, y) => badges.find((b) => x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 3 && y <= b.y + b.h + 3)?.id ?? null;

  function setHover(id, x, y) {
    if (id !== hover) {
      hover = id;
      relink();
      const node = id ? byId.get(id) ?? null : null;
      for (const cb of hoverCbs) cb(id ? selForId(id) : null, node);
      kick();
    }
    showTip(id, x, y);
  }

  const unbind = bindPointer(canvas, {
    cam,
    view,
    now: clock,
    grab: () => { fl = null; glide = null; zoomGoal = null; },
    moved: () => { userMoved = true; },
    kick: () => kick(),
    hit,
    badgeAt,
    reduced: reducedMotion,
    tap: (id, type) => pick(id, { fly: Boolean(id) && type !== 'mouse', emit: true, via: 'tap' }),
    fold: (id) => toggleFold(id),
    dbl: (id) => { if (id) flyTo(id, 2.6); else fit(false); },
    longPress: (id) => pick(id, { emit: true, via: 'longpress' }),
    hover: (id, x, y, onBadge) => {
      setHover(id, x, y);
      canvas.style.cursor = id || onBadge ? 'pointer' : 'grab';
    },
    leave: () => { setHover(null, 0, 0); },
    glide: (v) => { glide = v; kick(); },
    wheel: (x, y, k) => {
      fl = null; glide = null;
      const w = toWorld(x, y);
      const lz = Math.log(cam.z);
      const goal = Math.max(Math.log(ZOOM_MIN), Math.min(Math.log(ZOOM_MAX), (zoomGoal?.goal ?? lz) + k));
      // The point under the pointer stays under it while the zoom eases in.
      zoomGoal = { goal, v: zoomGoal?.v ?? 0, sx: x, sy: y, wx: w.x, wy: w.y };
      if (reducedMotion()) { cam.z = Math.exp(goal); holdAnchor(); zoomGoal = null; }
      userMoved = true;
      kick();
    },
  });

  function showTip(id, x, y) {
    const n = id && byId.get(id);
    if (!n || id === selected) { tip.hidden = true; return; }
    tip.replaceChildren();
    const top = h('div', 'map-tip-top');
    top.append(h('i', `map-dot s-${STATUS_WORD[n.status] ? n.status : 'unknown'}`), h('b', null, n.label ?? n.id), h('span', 'map-tip-kind', n.kind));
    tip.append(top);
    const run = runFacts(n);
    const line = (shownOverlay() === 'drift' && driftText(n))
      || (run && (run.tone !== 'grey' ? run.why : [run.round, run.progress].filter(Boolean).join(' · ')))
      || (n.why ?? n.sub);
    if (line) tip.append(h('div', 'map-tip-sub', String(line)));
    if (run?.goal && run.goal !== line) tip.append(h('div', 'map-tip-sub', run.goal));
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(W - tw - 8, x + 14)}px`;
    tip.style.top = `${Math.max(8, Math.min(H - th - 8, y - th - 10))}px`;
  }

  // --- drawing
  // A hidden page gets no animation frames at all, so a change made while
  // hidden (or a thumbnail captured then) would show whatever frame was last
  // painted. Hidden, the map settles instantly and draws once.
  let settleTimer = 0;
  function kick() {
    if (pageHidden() || typeof requestAnimationFrame !== 'function') {
      if (!settleTimer) settleTimer = setTimeout(() => {
        settleTimer = 0;
        const now = clock();
        step(now, 60000);
        draw(now);
      }, 30);
      return;
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }
  const onVisible = () => { lastFrame = 0; kick(); };
  document.addEventListener('visibilitychange', onVisible);

  function frame(now) {
    raf = 0;
    // Easing is by elapsed time, not per frame: a browser throttles frames in
    // a hidden or occluded window, and a map caught half-way out after one
    // late frame looks broken rather than slow.
    const dt = lastFrame ? Math.min(1000, now - lastFrame) : 16;
    lastFrame = now;
    const busy = step(now, dt);
    draw(now);
    if (busy) kick();
  }

  /** Keep the wheel's anchor point under the pointer at the current zoom. */
  function holdAnchor() {
    if (!zoomGoal) return;
    const c = anchored(view(), { x: zoomGoal.wx, y: zoomGoal.wy }, zoomGoal.sx, zoomGoal.sy, cam.z);
    cam.x = c.x;
    cam.y = c.y;
  }

  /** The ambient layer's round: pings on what waits, comets on live flows, worst first and capped. */
  function ambient(now) {
    const loud = model.nodes.filter((n) => n.status === 'attention' || n.status === 'crit' || n.status === 'down')
      .sort((a, b) => sevRank(b.status) - sevRank(a.status)).slice(0, AMBIENT_PULSES);
    for (const n of loud) {
      const spot = shownOf(n.id);
      if (spot != null && lay.pos.has(spot)) pulses.push({ id: spot, t0: now, tone: toneOf(n.status), soft: true });
    }
    const live = vlinks.filter((l) => l.live)
      .sort((a, b) => sevRank(b.severity ?? b.status) - sevRank(a.severity ?? a.status)).slice(0, AMBIENT_COMETS);
    for (const l of live) if (Math.random() < 0.7) {
      comets.push({ link: l, t0: now + Math.random() * 900, dur: 2200, tone: toneOf(l.severity ?? l.status), soft: true });
    }
  }

  /** Advance everything that eases. Returns true while anything is moving. */
  function step(now, dt) {
    let moving = false;
    const still = reducedMotion();
    // A long gap (a hidden tab settling, a stalled frame) lands everything.
    const jump = still || dt >= 1000;
    const hl = (k) => (jump ? 0 : HL[k]);

    for (const [id, c] of cur) {
      let goalR, goalT, goalA;
      if (c.leaving) {
        const into = c.into != null ? cur.get(c.into) : null;
        goalR = into ? into.r : c.r;
        goalT = into ? into.t : c.t;
        goalA = 0;
      } else {
        goalR = c.goal.r; goalT = c.goal.t; goalA = 1;
      }
      if (!jump && now < c.holdUntil) {
        // Waiting for its beat: an arrival rides along with its parent, unseen.
        if (c.entering) {
          const p = c.pid != null ? cur.get(c.pid) : null;
          if (p && p !== c) { c.r = p.r; c.t = p.t; }
          else if (c.depth <= 1) c.r = 0;
          Object.assign(c, polar(c.r, c.t));
        }
        moving = true;
        continue;
      }
      c.entering = false;
      const gt = c.t + wrapAngle(goalT - c.t);
      [c.r, c.vr] = damp(c.r, c.vr, goalR, hl('move'), dt);
      [c.t, c.vt] = damp(c.t, c.vt, gt, hl('move'), dt);
      [c.a, c.va] = damp(c.a, c.va, goalA, hl('fade'), dt);
      c.a = Math.max(0, Math.min(1, c.a));
      Object.assign(c, polar(c.r, c.t));
      if (c.leaving && (jump || c.a < 0.02)) { cur.delete(id); continue; }
      if (!settled(c.r, c.vr, goalR, 0.05) || !settled(c.t, c.vt, gt, 0.0004) || !settled(c.a, c.va, goalA, 0.004)) moving = true;
      else { c.r = goalR; c.t = goalT; c.a = goalA; c.vr = c.vt = c.va = 0; Object.assign(c, polar(c.r, c.t)); }
    }

    // The camera: a flight, a wheel zoom easing in, or a drag gliding out.
    if (fl) {
      const t = jump ? 1 : Math.min(1, (now - fl.t0) / fl.ms);
      const [x, y, w] = fl.path.at(easeInOut(t));
      cam.x = x; cam.y = y; cam.z = W / ((fitScale || 1) * w);
      if (t >= 1) { Object.assign(cam, fl.to); fl = null; } else moving = true;
    }
    if (zoomGoal) {
      let lz = Math.log(cam.z);
      [lz, zoomGoal.v] = damp(lz, zoomGoal.v, zoomGoal.goal, hl('zoom'), dt);
      cam.z = Math.exp(lz);
      holdAnchor();
      if (settled(lz, zoomGoal.v, zoomGoal.goal, 0.0008)) { cam.z = Math.exp(zoomGoal.goal); holdAnchor(); zoomGoal = null; }
      else moving = true;
    }
    if (glide) {
      cam.x += glide.vx * dt; cam.y += glide.vy * dt;
      glide.vx = inertia(glide.vx, dt); glide.vy = inertia(glide.vy, dt);
      if (jump || Math.hypot(glide.vx, glide.vy) * scale() < 0.01) glide = null; else moving = true;
    }
    // Zooming past the threshold grows (or folds) the lanes' sessions in beats.
    if ((cam.z >= AUTO_UNFOLD_ZOOM) !== zoomedIn) { relayout(); moving = true; }

    // The selection mark draws in.
    if (sel.id) {
      [sel.t, sel.v] = damp(sel.t, sel.v, 1, hl('select'), dt);
      if (settled(sel.t, sel.v, 1, 0.002)) { sel.t = 1; sel.v = 0; } else moving = true;
    }

    // Emphasis: the focus and its neighbours stay lit; under a scope, every
    // other builder ghosts to 0.25 (want = min(focusWant, scopeWant)).
    const focus = hover ?? highlighted ?? selected;
    const lit = focus ? new Set([focus, ...(neighbours.get(focus) ?? [])]) : null;
    // A match folded away lights the node it is folded into.
    const found = new Set([...matches].map(shownOf));
    for (const id of cur.keys()) {
      const focusWant = !lit && !query ? 1 : (lit?.has(id) || found.has(id) ? 1 : UNLIT);
      const want = Math.min(focusWant, scopeW.get(id) ?? 1);
      const [next, v] = damp(focusAlpha.get(id) ?? 1, focusVel.get(id) ?? 0, want, hl('fade'), dt);
      if (settled(next, v, want, 0.005)) { focusAlpha.set(id, want); focusVel.delete(id); }
      else { focusAlpha.set(id, next); focusVel.set(id, v); moving = true; }
    }
    for (const id of focusAlpha.keys()) if (!cur.has(id)) { focusAlpha.delete(id); focusVel.delete(id); }
    pulses = pulses.filter((p) => now - p.t0 < 1500);
    comets = comets.filter((c) => now - c.t0 < c.dur);
    if (pulses.length || comets.length) moving = true;
    if (!still) {
      // The ambient layer: pings on nodes that wait for someone, spinners on
      // working lanes, and a slow drift of comets along live flows.
      const hasLife = model.nodes.some((n) => n.status === 'attention' || n.status === 'working')
        || vlinks.some((l) => l.live);
      if (hasLife && !pageHidden()) moving = true;
      if (now - lastPing > 2400) {
        lastPing = now;
        ambient(now);
      }
    }
    return moving;
  }

  /** The inspector (or the legacy panel) as the tether's target, in canvas px. */
  function anchorRect() {
    const el = legacyPanel ? (panel.hidden || panel.classList.contains('map-panel-out') ? null : panel) : opts.anchorEl?.();
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const rr = root.getBoundingClientRect(), pr = el.getBoundingClientRect();
    if (!pr.width && !pr.height) return null;
    return { left: pr.left - rr.left, top: pr.top - rr.top, bottom: pr.bottom - rr.top };
  }

  function scene(now) {
    const memo = new Map();
    const near = (hover ?? highlighted ?? selected) ? neighbours.get(hover ?? highlighted ?? selected) ?? new Set() : new Set();
    return {
      W, H, now, s: scale(), zoom: cam.z, toScreen,
      pos: lay.pos, nodes: cur, byId, links: vlinks, overlay: shownOverlay(), reach: vreach,
      rolled: (id) => rollup(id, byId, kidsRoll, memo),
      folded, kids: kidsAll,
      alpha: (id) => focusAlpha.get(id) ?? 1,
      hover, selected, selT: sel.id === selected ? sel.t : 1, highlight: highlighted,
      near, matches,
      pulses, comets,
      reduced: reducedMotion(),
      anchor: W > 760 && mode !== 'pip' ? anchorRect() : null,
      budgetUsd: typeof opts.budgetUsd === 'function' ? opts.budgetUsd : undefined,
    };
  }

  function draw(now) {
    const t0 = perfOn ? clock() : 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const out = renderer.draw(scene(now));
    badges = out?.badges ?? [];
    frameNo++;
    if (perfOn) {
      drawMs.push(clock() - t0);
      if (drawMs.length > 240) drawMs.shift();
    }
    let n = 0;
    for (const c of cur.values()) {
      if (!c.node || c.node.virtual || c.leaving || c.a <= 0.001) continue;
      const sp = toScreen(c);
      if (sp.x >= -40 && sp.y >= -40 && sp.x <= W + 40 && sp.y <= H + 40) n++;
    }
    drawnCount = n;
    renderReadout();
  }

  /** p95 of the recent draw times (ms), or null. */
  function p95() {
    if (!drawMs.length) return null;
    const s = [...drawMs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  }

  function renderReadout() {
    const b = scope === 'all' ? 'all' : byId.get(`builder:${scope}`)?.code ?? scope;
    const ov = shownOverlay();
    const rs = ov === 'reach' ? reachScope(vreach, selected) : null;
    const text = renderer.readout({
      zoom: cam.z, scope: b, drawn: drawnCount, total: model.nodes.length, overlay: ov,
      compact: W < 700, p95: perfOn ? p95() : null,
      drift: ov === 'drift' ? driftCounts(model.nodes) : null,
      reach: rs ? { links: rs.links, touches: selected ? rs.touched.size : null, unresolved: model.reach?.unresolved ?? 0 } : null,
    });
    if (text !== readoutText) { readoutText = text; readoutEl.textContent = text; }
  }

  // Theme or token changes repaint with the new colours: §4's shell
  // dispatches `lb:theme`; the attribute and scheme watchers catch the rest.
  const onTheme = () => { renderer.setPalette(readPalette(root)); kick(); };
  globalThis.addEventListener?.('lb:theme', onTheme, true);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(onTheme) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', onTheme);

  /**
   * The scene for the minimap (2.7): the goals of every drawn node, packed as
   * `[x, y, shapeCode, toneCode]` per node, and a version that changes with
   * the model, the layout and the overlay. No springs are computed for it.
   */
  function snapshotScene() {
    const list = [];
    const memo = new Map();
    for (const c of cur.values()) {
      if (!c.node || c.leaving) continue;
      list.push(c);
    }
    const pts = new Float32Array(list.length * 4);
    const ov = shownOverlay();
    list.forEach((c, i) => {
      const n = c.node;
      const p = polar(c.goal.r, c.goal.t);
      const rolled = n.kind === 'site' || n.kind === 'core' || n.kind === 'host' || folded.has(n.id)
        ? rollup(n.id, byId, kidsRoll, memo) : null;
      const st = n.virtual ? { shape: 'disc', tone: 'grey' } : nodeStyle(n, ov, rolled);
      pts[i * 4] = p.x;
      pts[i * 4 + 1] = p.y;
      pts[i * 4 + 2] = SHAPE_CODE[st.shape] ?? 0;
      pts[i * 4 + 3] = TONE_CODE[st.tone] ?? 0;
    });
    return { version, pts, count: list.length, overlay: ov, scope, selected, outer: maxRadius() };
  }

  function on(set, cb) {
    if (typeof cb !== 'function') return () => {};
    set.add(cb);
    return () => set.delete(cb);
  }

  root.dataset.mapMode = mode;
  resize();

  return {
    update,
    event,
    select: (x, o = {}) => pick(x, { fly: Boolean(o.fly) }),
    focus: (x) => flyTo(x),
    fit: () => fit(false),
    resize,
    setScope,
    setOverlay,
    setMode,
    setInsets,
    selectNext,
    focusFind,
    toggleFold: (x) => toggleFold(x == null ? selected : byId.has(x) ? x : idForSel(String(x), byId)),
    highlight,
    onSelect: (cb) => on(selectCbs, cb),
    onHover: (cb) => on(hoverCbs, cb),
    snapshotScene,
    overlay: shownOverlay,
    // The overlays this model can show, in `o` order (reach only with reach links).
    overlays: () => availableOverlays(model),
    scope: () => scope,
    // Where a node is drawn now (canvas px), e.g. to anchor an action list; null when not drawn.
    screenOf: (x) => {
      const c = cur.get(byId.has(x) ? x : idForSel(String(x), byId));
      return c && !c.leaving ? toScreen(c) : null;
    },
    // A node's current emphasis (focus and scope ghosting springs), 0..1.
    emphasis: (x) => focusAlpha.get(byId.has(x) ? x : idForSel(String(x), byId)) ?? 1,
    selected: () => (selected ? selForId(selected) : null),
    destroy: () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
      clearTimeout(panelOutTimer);
      unbind();
      ro?.disconnect();
      mo?.disconnect();
      mq?.removeEventListener?.('change', onTheme);
      globalThis.removeEventListener?.('lb:theme', onTheme, true);
      document.removeEventListener('visibilitychange', onVisible);
      selectCbs.clear();
      hoverCbs.clear();
      root.replaceChildren();
    },
  };
}
