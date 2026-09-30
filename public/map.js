// The Map: everything laneboard knows about, drawn as one constellation.
//
// The board answers "which session needs me". The Map answers the question
// before it: what exists, what depends on what, and where the trouble is. It
// is a radial tree (a core in the middle, then sites, rooms, and the services
// and lanes inside them) with the relationships a tree cannot hold drawn as
// arcs across it: a shared device, a pull, a replay, a backup.
//
// This is the one view that moves on purpose, and every movement is data:
//
//   * a comet along an arc      an event travelled that link just now
//   * an expanding ring          an event landed on that node
//   * a repeating ping           the node is waiting for a human
//   * a turning arc              a lane is working
//
// Nothing else animates, and `prefers-reduced-motion` turns all of it off:
// the map then draws once per change, still complete.
//
// The module owns its DOM (canvas plus the overlay panels) inside the element
// it is given, reads colours from the page's CSS tokens, and takes the model
// that GET /api/map returns. It has no dependencies and knows no host.
//
//   const map = createMap(el, { title: 'lab' });
//   map.update({ nodes, links, events });
//   map.event({ node: 'x', kind: 'ok', text: '…' });

const TAU = Math.PI * 2;

/** Distance from the centre for each depth, in world units. */
const RINGS = [0, 150, 300, 440, 560, 660];

/** Radius of a node's dot, by kind. */
const SIZE = { core: 15, site: 10, host: 9, room: 6.5, service: 4.2, lane: 5, pr: 3.6 };

/** Order of severity, worst last, for rollups and the "needs you" list. */
const SEVERITY = ['idle', 'unknown', 'ok', 'working', 'warn', 'attention', 'crit', 'down'];

const RING_NAMES = ['', 'sites', 'rooms', 'services · lanes', 'detail', ''];

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ colour

/** Resolve any CSS colour (oklch included) to [r, g, b] by painting it. */
function resolver() {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  return (css) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = '#000';
    g.fillStyle = css;
    g.fillRect(0, 0, 1, 1);
    const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
    return [r, gg, b];
  };
}

function readPalette(el) {
  const cs = getComputedStyle(el);
  const toRgb = resolver();
  const v = (name, fallback) => toRgb(cs.getPropertyValue(name).trim() || fallback);
  return {
    bg: v('--bg-canvas', '#0d1014'),
    sunken: v('--bg-sunken', '#090b0e'),
    t1: v('--text-1', '#eceef2'),
    t2: v('--text-2', '#a8adb7'),
    t3: v('--text-3', '#767c88'),
    ok: v('--ok', '#3ecf8e'),
    warn: v('--warn', '#f2b84b'),
    crit: v('--crit', '#f0607a'),
    info: v('--info', '#5aa9f0'),
    idle: v('--idle', '#7c818c'),
    accent: v('--accent', '#9d7cf2'),
    mono: cs.getPropertyValue('--font-mono').trim() || 'ui-monospace, monospace',
    ui: cs.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif',
  };
}

const rgba = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;

function statusColor(P, status) {
  switch (status) {
    case 'ok': return P.ok;
    case 'working': return P.info;
    case 'warn': case 'attention': return P.warn;
    case 'crit': case 'down': return P.crit;
    case 'idle': return P.idle;
    default: return P.t3;
  }
}

const worse = (a, b) => (SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b);

// ------------------------------------------------------------------ geometry

const polar = (r, a) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r });
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);

/** A point on the cubic from p0 to p3 at t. */
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** A point on the quadratic from p0 to p2 at t. */
function quad(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/**
 * Lay the tree out on rings. Each node gets an angular sector proportional to
 * the leaves under it, so a room with twelve lanes gets the room it needs and
 * a room with nothing inside it does not waste an arc. Siblings on the first
 * ring get a gap between them so the sites read as separate islands.
 */
export function layout(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  let core = nodes.find((n) => n.kind === 'core');
  const roots = [];
  for (const n of nodes) {
    const p = n.parent && byId.has(n.parent) ? n.parent : null;
    if (n === core) continue;
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(n);
    } else roots.push(n);
  }
  const center = core ?? { id: '__core', kind: 'core', label: '', virtual: true };
  kids.set(center.id, [...(kids.get(center.id) ?? []), ...roots]);

  const weight = new Map();
  const w = (n) => {
    const ch = kids.get(n.id) ?? [];
    const own = n.kind === 'lane' || n.kind === 'pr' ? 0.8 : 1;
    const v = ch.length ? Math.max(own, ch.reduce((s, c) => s + w(c), 0)) : own;
    weight.set(n.id, v);
    return v;
  };
  w(center);

  const pos = new Map();
  const place = (n, depth, a0, a1) => {
    const mid = (a0 + a1) / 2;
    pos.set(n.id, { depth, angle: mid, a0, a1 });
    const ch = (kids.get(n.id) ?? []).slice().sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    if (!ch.length) return;
    const total = ch.reduce((s, c) => s + weight.get(c.id), 0);
    const gap = depth === 0 ? 0.09 : depth === 1 ? 0.025 : 0;
    const span = a1 - a0 - gap * ch.length;
    let a = a0 + gap / 2;
    for (const c of ch) {
      const share = (weight.get(c.id) / total) * span;
      place(c, depth + 1, a, a + share);
      a += share + gap;
    }
  };
  // Twelve o'clock is kept clear: the ring names sit there.
  const clear = 0.26;
  const start = -Math.PI / 2 + clear / 2;
  place(center, 0, start, start + TAU - clear);

  // Crowded outer rings stagger in and out so neighbours' labels do not touch.
  const out = new Map();
  const perDepth = new Map();
  for (const [id, p] of pos) {
    if (!perDepth.has(p.depth)) perDepth.set(p.depth, []);
    perDepth.get(p.depth).push([id, p]);
  }
  for (const [depth, list] of perDepth) {
    list.sort((a, b) => a[1].angle - b[1].angle);
    const r = RINGS[Math.min(depth, RINGS.length - 1)];
    list.forEach(([id, p], i) => {
      const crowded = depth >= 3 && list.length > 0 && (p.a1 - p.a0) * r < 34;
      const rr = depth === 0 ? 0 : r + (crowded ? (i % 2 ? 16 : -10) : 0);
      out.set(id, { ...polar(rr, p.angle), angle: p.angle, depth, r: rr });
    });
  }
  return { pos: out, center, kids };
}

// ------------------------------------------------------------------ DOM

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const fmtAgo = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};

const STATUS_WORD = {
  ok: 'up', working: 'working', warn: 'degraded', attention: 'needs you', crit: 'failing',
  down: 'down', idle: 'idle', unknown: 'no data',
};

// ------------------------------------------------------------------ the map

export function createMap(root, opts = {}) {
  root.classList.add('map');
  root.innerHTML = '';

  const canvas = h('canvas', 'map-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Map of sites, rooms, services and lanes');
  const hud = h('div', 'map-hud');

  // Top left: what this is and how it is doing.
  const head = h('div', 'map-head');
  const title = h('h2', 'map-title', opts.title ?? 'Map');
  const summary = h('div', 'map-summary');
  // A topology file that stopped parsing: the last good map stays up, and
  // this says why it is not the newest.
  const problem = h('p', 'map-problem');
  problem.hidden = true;
  head.append(title, summary, problem);

  // Left: what needs a human, worst first.
  const needs = h('section', 'map-needs');
  const needsH = h('h3', 'map-h');
  const needsList = h('ol', 'map-needs-list');
  needs.append(needsH, needsList);

  // Right: the selected node.
  const panel = h('aside', 'map-panel');
  panel.hidden = true;

  // Top right: find a node.
  const find = h('div', 'map-find');
  const input = h('input', 'map-find-input');
  input.id = 'map-find';
  input.type = 'search';
  input.placeholder = 'Find  /';
  input.setAttribute('aria-label', 'Find a node');
  const fitBtn = h('button', 'map-btn', 'Fit');
  fitBtn.title = 'Fit everything (f)';
  find.append(input, fitBtn);

  // Bottom: what just happened, and the key.
  const ticker = h('ol', 'map-ticker');
  const legend = h('div', 'map-legend');
  for (const [k, word] of [['ok', 'up'], ['working', 'working'], ['attention', 'needs you'], ['crit', 'failing'], ['idle', 'idle']]) {
    const i = h('span', 'map-key');
    i.append(h('i', `map-dot s-${k}`), document.createTextNode(word));
    legend.append(i);
  }
  const linkKey = h('span', 'map-key');
  linkKey.append(h('i', 'map-dash'), document.createTextNode('depends on'));
  legend.append(linkKey);

  const tip = h('div', 'map-tip');
  tip.hidden = true;

  hud.append(head, needs, find, panel, ticker, legend, tip);
  root.append(canvas, hud);

  const ctx = canvas.getContext('2d');
  let P = readPalette(root);

  // --- state
  let model = { nodes: [], links: [], events: [] };
  let byId = new Map();
  let lay = { pos: new Map(), center: null, kids: new Map() };
  const cur = new Map();          // id -> {x, y, a (appear 0..1)}
  let neighbours = new Map();     // id -> Set(id)
  let pulses = [];                // {id, t0, color}
  let comets = [];                // {link, t0, dur, color}
  let recent = [];                // ticker events
  let hover = null;
  let selected = null;
  let query = '';
  let matches = new Set();

  const cam = { x: 0, y: 0, z: 1 };
  const camTo = { x: 0, y: 0, z: 1 };
  let userMoved = false;
  let W = 0, H = 0, dpr = 1, fitScale = 1;
  let raf = 0, lastPing = 0, lastFrame = 0;
  const focusAlpha = new Map();   // id -> current emphasis 0..1

  // --- sizing
  const ro = new ResizeObserver(() => resize());
  ro.observe(root);
  function resize() {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const outer = maxRadius() + 64;
    const compact = W < 720;
    fitScale = Math.min(W / (2 * outer), (H - (compact ? 40 : 20)) / (2 * outer));
    if (!userMoved) fit(true);
    kick();
  }

  function maxRadius() {
    let m = RINGS[2];
    for (const p of lay.pos.values()) m = Math.max(m, p.r);
    return m;
  }

  function fit(instant) {
    userMoved = false;
    // Leave room for the left list on a wide screen by nudging the centre right.
    const nudge = W > 1000 ? 70 / (fitScale || 1) : 0;
    camTo.x = -nudge; camTo.y = 0; camTo.z = 1;
    if (instant) Object.assign(cam, camTo);
    kick();
  }

  const scale = () => fitScale * cam.z;
  const toScreen = (p) => ({ x: W / 2 + (p.x - cam.x) * scale(), y: H / 2 + (p.y - cam.y) * scale() });
  const toWorld = (x, y) => ({ x: (x - W / 2) / scale() + cam.x, y: (y - H / 2) / scale() + cam.y });

  // --- model
  function update(next) {
    const prevIds = new Set(byId.keys());
    model = {
      nodes: next.nodes ?? [],
      links: (next.links ?? []).filter((l) => l.from !== l.to),
      events: next.events ?? [],
    };
    if (next.title) title.textContent = next.title;
    problem.textContent = next.error ?? '';
    problem.hidden = !next.error;
    byId = new Map(model.nodes.map((n) => [n.id, n]));
    lay = layout(model.nodes);
    if (lay.center.virtual) byId.set(lay.center.id, lay.center);

    // New nodes grow out of their parent instead of popping in.
    for (const [id, p] of lay.pos) {
      if (!cur.has(id)) {
        const n = byId.get(id);
        const from = n?.parent && cur.get(n.parent);
        cur.set(id, { x: from ? from.x : p.x, y: from ? from.y : p.y, a: prevIds.size ? 0 : 1 });
      }
    }
    for (const id of [...cur.keys()]) if (!lay.pos.has(id)) cur.delete(id);

    neighbours = new Map();
    const link = (a, b) => {
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a).add(b);
    };
    for (const n of model.nodes) if (n.parent && byId.has(n.parent)) { link(n.id, n.parent); link(n.parent, n.id); }
    for (const l of model.links) { link(l.from, l.to); link(l.to, l.from); }

    // Events we have not seen become pulses and ticker lines.
    const seen = new Set(recent.map((e) => e.key));
    for (const e of model.events) {
      const key = `${e.at}|${e.node ?? ''}|${e.link ?? ''}|${e.text ?? ''}`;
      if (!seen.has(key)) event(e, { quiet: !prevIds.size });
    }

    if (selected && !byId.has(selected)) selected = null;
    const outer = maxRadius() + 64;
    fitScale = Math.min(W / (2 * outer), (H - 20) / (2 * outer)) || 1;
    renderHud();
    kick();
  }

  /** One thing happened. A node gets a ring, a link gets a comet. */
  function event(e, { quiet = false } = {}) {
    const key = `${e.at ?? Date.now()}|${e.node ?? ''}|${e.link ?? ''}|${e.text ?? ''}`;
    const at = e.at ?? Date.now();
    // A silent event is a pulse and nothing else: tool calls arrive by the
    // second, and a ticker of them would bury the events that matter.
    if (!e.silent) {
      recent.unshift({ ...e, at, key });
      recent = recent.slice(0, 40);
    }
    const color = statusColor(P, e.kind ?? 'working');
    const fresh = Date.now() - at < 15000;
    if (!quiet && fresh && !reducedMotion()) {
      if (e.node && lay.pos.has(e.node)) pulses.push({ id: e.node, t0: performance.now(), color });
      if (e.link) {
        const l = model.links.find((x) => x.id === e.link || `${x.from}>${x.to}` === e.link);
        if (l) comets.push({ link: l, t0: performance.now(), dur: 1600, color });
      }
    }
    if (!e.silent) renderTicker();
    kick();
  }

  // --- rollups
  function rollup(id, memo = new Map()) {
    if (memo.has(id)) return memo.get(id);
    const n = byId.get(id);
    let s = n?.status ?? 'unknown';
    if (s === 'working' || s === 'idle' || s === 'unknown') s = s === 'unknown' ? 'unknown' : 'ok';
    for (const c of lay.kids.get(id) ?? []) {
      const cs = rollup(c.id, memo);
      if (['warn', 'attention', 'crit', 'down'].includes(cs)) s = worse(s, cs === 'down' ? 'crit' : cs);
    }
    memo.set(id, s);
    return s;
  }

  // --- HUD
  function renderHud() {
    const counts = { up: 0, trouble: 0, lanes: 0, working: 0, waiting: 0 };
    const troubled = [];
    for (const n of model.nodes) {
      if (n.kind === 'lane') {
        counts.lanes++;
        if (n.status === 'working') counts.working++;
      }
      if (['attention', 'crit', 'down', 'warn'].includes(n.status)) troubled.push(n);
      else if (n.status === 'ok' || n.status === 'working') counts.up++;
      if (n.status === 'attention') counts.waiting++;
    }
    const rooms = model.nodes.filter((n) => n.kind === 'room');
    const roomsUp = rooms.filter((n) => n.status === 'ok' || n.status === 'working').length;
    summary.replaceChildren();
    const stat = (num, word, cls) => {
      const s = h('span', `map-stat ${cls ?? ''}`);
      s.append(h('b', null, String(num)), document.createTextNode(` ${word}`));
      summary.append(s);
    };
    if (rooms.length) stat(`${roomsUp}/${rooms.length}`, 'rooms up');
    if (counts.lanes) stat(counts.working, `of ${counts.lanes} lanes working`);
    const bad = troubled.filter((n) => n.status !== 'warn').length;
    stat(bad, bad === 1 ? 'needs you' : 'need you', bad ? 's-attention' : 's-ok');

    troubled.sort((a, b) => SEVERITY.indexOf(b.status) - SEVERITY.indexOf(a.status));
    needsH.textContent = troubled.length ? 'Needs you' : 'All quiet';
    needsList.replaceChildren();
    for (const n of troubled.slice(0, 9)) {
      const li = h('li', 'map-need');
      const b = h('button', 'map-need-btn');
      b.append(h('i', `map-dot s-${n.status}`));
      const txt = h('span', 'map-need-text');
      txt.append(h('span', 'map-need-name', n.label ?? n.id), h('span', 'map-need-why', n.why ?? n.sub ?? STATUS_WORD[n.status]));
      b.append(txt, h('span', 'map-need-where', where(n)));
      b.addEventListener('click', () => { select(n.id); flyTo(n.id); });
      li.append(b);
      needsList.append(li);
    }
    if (troubled.length > 9) needsList.append(h('li', 'map-need-more', `+${troubled.length - 9} more`));
    renderPanel();
    renderTicker();
  }

  /** "room · site", so a lane named like its neighbour is still findable. */
  function where(n) {
    const chain = [];
    let p = n.parent && byId.get(n.parent);
    while (p && p.kind !== 'core' && chain.length < 2) { chain.push(p.label ?? p.id); p = p.parent && byId.get(p.parent); }
    return chain.join(' · ');
  }

  function renderTicker() {
    ticker.replaceChildren();
    for (const e of recent.slice(0, 5)) {
      const li = h('li', 'map-tick');
      const b = h('button', 'map-tick-btn');
      b.append(h('i', `map-dot s-${e.kind ?? 'working'}`), h('time', 'map-tick-at', fmtAgo(e.at)), h('span', 'map-tick-text', e.text ?? ''));
      const target = e.node ?? model.links.find((l) => l.id === e.link)?.to;
      if (target) b.addEventListener('click', () => { select(target); flyTo(target); });
      li.append(b);
      ticker.append(li);
    }
  }

  function renderPanel() {
    const n = selected && byId.get(selected);
    panel.hidden = !n;
    if (!n) return;
    panel.replaceChildren();
    const close = h('button', 'map-panel-close', '×');
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => select(null));
    const eyebrow = h('div', 'map-eyebrow', [n.kind, where(n)].filter(Boolean).join(' · '));
    const name = h('h3', 'map-panel-title', n.label ?? n.id);
    const pill = h('span', `map-pill s-${n.status ?? 'unknown'}`, STATUS_WORD[n.status] ?? n.status ?? 'no data');
    panel.append(close, eyebrow, name, pill);
    if (n.why) panel.append(h('p', 'map-why', n.why));
    if (n.sub) panel.append(h('p', 'map-sub', n.sub));

    const m = n.metrics ?? {};
    const bars = [['cpu', 'CPU'], ['mem', 'Memory'], ['disk', 'Disk'], ['gpu', 'GPU']].filter(([k]) => typeof m[k] === 'number');
    if (bars.length) {
      const g = h('div', 'map-bars');
      for (const [k, word] of bars) {
        const v = Math.max(0, Math.min(1, m[k]));
        const row = h('div', 'map-bar');
        const track = h('div', 'map-bar-track');
        const fill = h('div', `map-bar-fill ${v > 0.9 ? 's-crit' : v > 0.75 ? 's-warn' : ''}`);
        fill.style.width = `${(v * 100).toFixed(1)}%`;
        track.append(fill);
        row.append(h('span', 'map-bar-k', word), track, h('span', 'map-bar-v', `${Math.round(v * 100)}%`));
        g.append(row);
      }
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
    const children = lay.kids.get(n.id) ?? [];
    if (rel.length || children.length) {
      const sec = h('div', 'map-rel');
      if (rel.length) {
        sec.append(h('h4', 'map-h', 'Linked'));
        for (const [word, id, arrow] of rel) sec.append(chip(id, `${arrow} ${word}`));
      }
      if (children.length) {
        sec.append(h('h4', 'map-h', `Inside · ${children.length}`));
        for (const c of children.slice(0, 24)) sec.append(chip(c.id));
      }
      panel.append(sec);
    }
    if (n.href) {
      const a = h('a', 'map-open', 'Open ↗');
      a.href = n.href;
      a.target = '_blank';
      a.rel = 'noopener';
      panel.append(a);
    }
    if (typeof opts.actions === 'function') {
      const acts = opts.actions(n);
      if (acts?.length) {
        const row = h('div', 'map-actions');
        for (const { label, run } of acts) {
          const b = h('button', 'map-btn', label);
          b.addEventListener('click', () => run(n));
          row.append(b);
        }
        panel.append(row);
      }
    }
  }

  function chip(id, note) {
    const n = byId.get(id);
    const b = h('button', 'map-chip');
    b.append(h('i', `map-dot s-${n?.status ?? 'unknown'}`), document.createTextNode(n?.label ?? id));
    if (note) b.append(h('span', 'map-chip-note', note));
    b.addEventListener('click', () => { select(id); flyTo(id); });
    return b;
  }

  function select(id) {
    selected = id;
    renderPanel();
    opts.onSelect?.(id ? byId.get(id) : null);
    kick();
  }

  function flyTo(id, z = 1.9) {
    const p = lay.pos.get(id);
    if (!p) return;
    userMoved = true;
    const wide = W > 1000;
    // Keep the node clear of the panel that opens on the right.
    camTo.x = p.x + (wide ? 150 / (fitScale * z) : 0);
    camTo.y = p.y + (wide ? 0 : 60 / (fitScale * z));
    camTo.z = Math.max(camTo.z, z);
    kick();
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
      select(id);
      flyTo(id);
      input.blur();
    }
    if (e.key === 'Escape') { input.value = ''; query = ''; matches.clear(); input.blur(); kick(); }
  });
  fitBtn.addEventListener('click', () => fit(false));

  // --- pointer
  let drag = null;
  function hit(x, y) {
    let best = null, bd = Infinity;
    const s = scale();
    for (const [id, c] of cur) {
      const n = byId.get(id);
      if (!n || n.virtual) continue;
      const sp = toScreen(c);
      const r = Math.max(9, (SIZE[n.kind] ?? 5) * Math.max(0.8, s) + 6);
      const d = Math.hypot(sp.x - x, sp.y - y);
      if (d < r && d < bd) { best = id; bd = d; }
    }
    return best;
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: camTo.x, cy: camTo.y, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        userMoved = true;
        camTo.x = drag.cx - dx / scale();
        camTo.y = drag.cy - dy / scale();
        cam.x = camTo.x; cam.y = camTo.y;
        kick();
      }
      return;
    }
    const id = hit(x, y);
    if (id !== hover) { hover = id; kick(); }
    canvas.style.cursor = id ? 'pointer' : 'grab';
    showTip(id, x, y);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; kick(); });
  canvas.addEventListener('pointerup', (e) => {
    const r = canvas.getBoundingClientRect();
    if (drag && !drag.moved) {
      const id = hit(e.clientX - r.left, e.clientY - r.top);
      select(id);
      if (id && e.pointerType !== 'mouse') flyTo(id);
    }
    drag = null;
  });
  canvas.addEventListener('dblclick', (e) => {
    const r = canvas.getBoundingClientRect();
    const id = hit(e.clientX - r.left, e.clientY - r.top);
    if (id) flyTo(id, 2.6); else fit(false);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const before = toWorld(x, y);
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022));
    cam.z = camTo.z = Math.max(0.55, Math.min(6, camTo.z * k));
    const after = toWorld(x, y);
    cam.x = camTo.x = camTo.x + before.x - after.x;
    cam.y = camTo.y = camTo.y + before.y - after.y;
    userMoved = true;
    kick();
  }, { passive: false });

  function onKey(e) {
    if (!root.isConnected || root.offsetParent === null) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === '/') { input.focus(); e.preventDefault(); }
    else if (e.key === 'Escape') { select(null); }
    else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) fit(false);
  }
  window.addEventListener('keydown', onKey);

  function showTip(id, x, y) {
    const n = id && byId.get(id);
    if (!n || id === selected) { tip.hidden = true; return; }
    tip.replaceChildren();
    const top = h('div', 'map-tip-top');
    top.append(h('i', `map-dot s-${n.status ?? 'unknown'}`), h('b', null, n.label ?? n.id), h('span', 'map-tip-kind', n.kind));
    tip.append(top);
    const line = n.why ?? n.sub;
    if (line) tip.append(h('div', 'map-tip-sub', line));
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
    if (document.visibilityState === 'hidden') {
      if (!settleTimer) settleTimer = setTimeout(() => {
        settleTimer = 0;
        const now = performance.now();
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

  /** Advance everything that eases. Returns true while anything is moving. */
  function step(now, dt) {
    let moving = false;
    const still = reducedMotion();
    const k = still ? 1 : 1 - Math.exp(-dt / 90);
    const kCam = still ? 1 : 1 - Math.exp(-dt / 110);
    const kFade = still ? 1 : 1 - Math.exp(-dt / 70);
    for (const [id, c] of cur) {
      const p = lay.pos.get(id);
      if (!p) continue;
      const dx = p.x - c.x, dy = p.y - c.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.05) { c.x += dx * k; c.y += dy * k; moving = true; }
      else { c.x = p.x; c.y = p.y; }
      if (c.a < 1) { c.a = Math.min(1, c.a + (still ? 1 : dt / 500)); moving = true; }
    }
    for (const key of ['x', 'y', 'z']) {
      const d = camTo[key] - cam[key];
      if (Math.abs(d) > (key === 'z' ? 0.0005 : 0.05)) { cam[key] += d * kCam; moving = true; }
      else cam[key] = camTo[key];
    }
    // Emphasis: the hovered or selected node and its neighbours stay lit.
    const focus = hover ?? selected;
    const lit = focus ? new Set([focus, ...(neighbours.get(focus) ?? [])]) : null;
    for (const id of cur.keys()) {
      const want = !lit && !query ? 1 : (lit?.has(id) || matches.has(id) ? 1 : 0.16);
      const have = focusAlpha.get(id) ?? 1;
      const next = have + (want - have) * kFade;
      focusAlpha.set(id, Math.abs(next - want) < 0.01 ? want : next);
      if (Math.abs(next - want) >= 0.01) moving = true;
    }
    pulses = pulses.filter((p) => now - p.t0 < 1500);
    comets = comets.filter((c) => now - c.t0 < c.dur);
    if (pulses.length || comets.length) moving = true;
    if (!still) {
      // The ambient layer: pings on nodes that wait for someone, spinners on
      // working lanes, and a slow drift of comets along live flows.
      const hasLife = model.nodes.some((n) => n.status === 'attention' || n.status === 'working')
        || model.links.some((l) => l.live);
      if (hasLife && document.visibilityState === 'visible') moving = true;
      if (now - lastPing > 2400) {
        lastPing = now;
        for (const n of model.nodes) if (n.status === 'attention' || n.status === 'crit' || n.status === 'down') {
          pulses.push({ id: n.id, t0: now, color: statusColor(P, n.status), soft: true });
        }
        for (const l of model.links) if (l.live && Math.random() < 0.7) {
          comets.push({ link: l, t0: now + Math.random() * 900, dur: 2200, color: P.info, soft: true });
        }
      }
    }
    return moving;
  }

  function draw(now) {
    const s = scale();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const c0 = toScreen({ x: 0, y: 0 });

    // A faint well of light at the core.
    const glow = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, RINGS[3] * s * 1.3);
    glow.addColorStop(0, rgba(P.info, 0.07));
    glow.addColorStop(0.5, rgba(P.accent, 0.025));
    glow.addColorStop(1, rgba(P.bg, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    drawRings(c0, s);
    drawTree(s, now);
    drawLinks(s, now);
    drawComets(s, now);
    drawNodes(s, now);
    drawLabels(s);
  }

  /** Tracked caps where the canvas supports it; plain text where it does not. */
  function spaced(text, x, y, em) {
    const had = 'letterSpacing' in ctx;
    if (had) ctx.letterSpacing = `${parseFloat(em) * 10}px`;
    ctx.fillText(text, x, y);
    if (had) ctx.letterSpacing = '0px';
  }

  function drawRings(c0, s) {
    const depths = new Set([...lay.pos.values()].map((p) => p.depth));
    ctx.save();
    ctx.lineWidth = 1;
    for (let d = 1; d < RINGS.length; d++) {
      if (!depths.has(d)) continue;
      const r = RINGS[d] * s;
      ctx.strokeStyle = rgba(P.t3, d === 1 ? 0.14 : 0.08);
      ctx.setLineDash(d === 1 ? [] : [1, 5]);
      ctx.beginPath();
      ctx.arc(c0.x, c0.y, r, 0, TAU);
      ctx.stroke();
      if (s * cam.z > 0 && RING_NAMES[d]) {
        ctx.setLineDash([]);
        ctx.fillStyle = rgba(P.t3, 0.55);
        ctx.font = `500 ${Math.max(9, 9.5)}px ${P.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(RING_NAMES[d].toUpperCase().split('').join(' '), c0.x, c0.y - r - 4);
      }
    }
    // The dial: a tick every five degrees on the outermost ring, longer every
    // thirty. An instrument, not a decoration: it is what makes a bearing
    // readable when you tell someone "the red one at four o'clock".
    const outer = Math.max(...[...depths].map((d) => RINGS[Math.min(d, RINGS.length - 1)])) * s + 26;
    ctx.setLineDash([]);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const long = i % 6 === 0;
      const r0 = outer, r1 = outer + (long ? 7 : 3);
      ctx.strokeStyle = rgba(P.t3, long ? 0.3 : 0.14);
      ctx.beginPath();
      ctx.moveTo(c0.x + Math.cos(a) * r0, c0.y + Math.sin(a) * r0);
      ctx.lineTo(c0.x + Math.cos(a) * r1, c0.y + Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function treeCurve(pid, cid) {
    const p = cur.get(pid), c = cur.get(cid);
    const pp = lay.pos.get(pid), cp = lay.pos.get(cid);
    if (!p || !c || !pp || !cp) return null;
    const midR = (pp.r + cp.r) / 2;
    const a0 = pp.depth === 0 ? cp.angle : pp.angle;
    return [p, polar(midR, a0), polar(midR, cp.angle), c];
  }

  function drawTree(s, now) {
    ctx.save();
    for (const n of model.nodes) {
      if (!n.parent && !lay.center.virtual) continue;
      const pid = n.parent && byId.has(n.parent) ? n.parent : lay.center.id;
      if (n.id === pid || n === lay.center) continue;
      const pts = treeCurve(pid, n.id);
      if (!pts) continue;
      const [a, b, c, d] = pts.map(toScreenP);
      const alpha = Math.min(focusAlpha.get(n.id) ?? 1, focusAlpha.get(pid) ?? 1) * (cur.get(n.id)?.a ?? 1);
      const st = rollup(n.id);
      const col = ['crit', 'down', 'attention', 'warn'].includes(st) ? statusColor(P, st) : P.t3;
      const grad = ctx.createLinearGradient(a.x, a.y, d.x, d.y);
      grad.addColorStop(0, rgba(col, 0.06 * alpha));
      grad.addColorStop(1, rgba(col, (col === P.t3 ? 0.34 : 0.6) * alpha));
      ctx.strokeStyle = grad;
      ctx.lineWidth = n.kind === 'site' ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(b.x, b.y, c.x, c.y, d.x, d.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  const toScreenP = (p) => toScreen(p);

  /** Arcs bow toward the core, so cross-links read as a web across the tree. */
  function linkCtrl(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const pull = Math.min(0.62, 0.2 + d / 1400);
    return { x: mx * (1 - pull), y: my * (1 - pull) };
  }

  function linkColor(l) {
    if (l.status && l.status !== 'ok') return statusColor(P, l.status);
    return l.kind === 'share' ? P.accent : P.info;
  }

  function drawLinks(s, now) {
    ctx.save();
    for (const l of model.links) {
      const a = cur.get(l.from), b = cur.get(l.to);
      if (!a || !b) continue;
      const ctrl = linkCtrl(a, b);
      const A = toScreen(a), C = toScreen(ctrl), B = toScreen(b);
      const alpha = Math.min(focusAlpha.get(l.from) ?? 1, focusAlpha.get(l.to) ?? 1);
      const focus = hover ?? selected;
      const hot = focus && (l.from === focus || l.to === focus);
      const col = linkColor(l);
      ctx.strokeStyle = rgba(col, (hot ? 0.85 : l.live ? 0.42 : 0.26) * alpha);
      ctx.lineWidth = hot ? 1.5 : 1;
      ctx.setLineDash(l.kind === 'share' ? [1, 3] : l.live ? [] : [4, 4]);
      ctx.lineDashOffset = l.live && !reducedMotion() ? -now / 60 : 0;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(C.x, C.y, B.x, B.y);
      ctx.stroke();
      // An arrowhead at the target end says which way the dependency runs.
      const t = 0.92;
      const p1 = quad(A, C, B, t), p2 = quad(A, C, B, 0.985);
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const rb = (SIZE[byId.get(l.to)?.kind] ?? 5) * Math.max(0.8, s) + 3;
      const tip = { x: B.x - Math.cos(ang) * rb, y: B.y - Math.sin(ang) * rb };
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(col, (hot ? 0.9 : 0.5) * alpha);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - Math.cos(ang - 0.45) * 6, tip.y - Math.sin(ang - 0.45) * 6);
      ctx.lineTo(tip.x - Math.cos(ang + 0.45) * 6, tip.y - Math.sin(ang + 0.45) * 6);
      ctx.closePath();
      ctx.fill();
      if (l.label && (hot || s > 1.35)) {
        const m = quad(A, C, B, 0.5);
        ctx.font = `10px ${P.mono}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(l.label).width + 8;
        ctx.fillStyle = rgba(P.sunken, 0.85 * alpha);
        ctx.fillRect(m.x - w / 2, m.y - 7, w, 14);
        ctx.fillStyle = rgba(col, 0.95 * alpha);
        ctx.fillText(l.label, m.x, m.y);
      }
    }
    ctx.restore();
  }

  function drawComets(s, now) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const c of comets) {
      const t = (now - c.t0) / c.dur;
      if (t < 0 || t > 1) continue;
      const a = cur.get(c.link.from), b = cur.get(c.link.to);
      if (!a || !b) continue;
      const A = toScreen(a), C = toScreen(linkCtrl(a, b)), B = toScreen(b);
      const tt = ease(t);
      const alpha = (c.soft ? 0.55 : 1) * Math.sin(Math.PI * t);
      for (let i = 0; i < 10; i++) {
        const u = Math.max(0, tt - i * 0.012);
        const p = quad(A, C, B, u);
        ctx.fillStyle = rgba(c.color, alpha * (1 - i / 10) * 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, 2.6 - i * 0.22), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawNodes(s, now) {
    const ns = Math.max(0.8, Math.min(1.6, s));
    const focus = hover ?? selected;
    // Pulses under the dots.
    for (const p of pulses) {
      const c = cur.get(p.id);
      if (!c) continue;
      const n = byId.get(p.id);
      const t = (now - p.t0) / 1500;
      if (t < 0) continue;
      const sp = toScreen(c);
      const r0 = (SIZE[n?.kind] ?? 5) * ns;
      ctx.strokeStyle = rgba(p.color, (p.soft ? 0.45 : 0.9) * (1 - t));
      ctx.lineWidth = p.soft ? 1 : 1.5;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r0 + ease(t) * (p.soft ? 18 : 30), 0, TAU);
      ctx.stroke();
    }
    for (const [id, c] of cur) {
      const n = byId.get(id);
      if (!n) continue;
      const sp = toScreen(c);
      if (sp.x < -40 || sp.y < -40 || sp.x > W + 40 || sp.y > H + 40) continue;
      const alpha = (focusAlpha.get(id) ?? 1) * c.a;
      const r = (SIZE[n.kind] ?? 5) * ns * (0.4 + 0.6 * c.a);
      const status = n.kind === 'site' || n.kind === 'core' ? rollup(id) : (n.status ?? 'unknown');
      const col = n.virtual ? P.t3 : statusColor(P, status);

      if (n.kind === 'core') {
        const breathe = reducedMotion() ? 0.5 : 0.5 + 0.5 * Math.sin(now / 1400);
        const g = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r * 3.2);
        g.addColorStop(0, rgba(P.t1, 0.9 * alpha));
        g.addColorStop(0.25, rgba(P.info, (0.35 + 0.1 * breathe) * alpha));
        g.addColorStop(1, rgba(P.info, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r * 3.2, 0, TAU);
        ctx.fill();
        for (const k of [1.6, 2.3]) {
          ctx.strokeStyle = rgba(P.t2, 0.18 * alpha);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r * k, 0, TAU);
          ctx.stroke();
        }
        ctx.fillStyle = rgba(P.t1, alpha);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r * 0.45, 0, TAU);
        ctx.fill();
        continue;
      }

      // Halo for anything in trouble or selected.
      const trouble = ['attention', 'crit', 'down', 'warn'].includes(status);
      if (trouble || id === selected || matches.has(id)) {
        const g = ctx.createRadialGradient(sp.x, sp.y, r * 0.6, sp.x, sp.y, r * 3.4);
        g.addColorStop(0, rgba(id === selected ? P.accent : col, 0.38 * alpha));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r * 3.4, 0, TAU);
        ctx.fill();
      }

      if (n.kind === 'site' || n.kind === 'host') {
        // A site is a hollow ring with a ring of its own inside: a place, not a thing.
        ctx.fillStyle = rgba(P.bg, 1);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(col, 0.95 * alpha);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.strokeStyle = rgba(col, 0.4 * alpha);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r * 0.55, 0, TAU); ctx.stroke();
      } else if (n.kind === 'lane') {
        // A lane is a diamond: work in flight, not a machine.
        ctx.save();
        ctx.translate(sp.x, sp.y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = rgba(status === 'idle' || status === 'unknown' ? P.bg : col, alpha);
        ctx.strokeStyle = rgba(col, alpha);
        ctx.lineWidth = 1.2;
        const q = r * 0.85;
        ctx.fillRect(-q, -q, q * 2, q * 2);
        ctx.strokeRect(-q, -q, q * 2, q * 2);
        ctx.restore();
        if (status === 'working' && !reducedMotion()) {
          const a0 = (now / 520) % TAU;
          ctx.strokeStyle = rgba(P.info, 0.9 * alpha);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, r + 4, a0, a0 + 1.6);
          ctx.stroke();
        }
      } else {
        const hollow = status === 'unknown' || status === 'idle';
        ctx.fillStyle = rgba(hollow ? P.bg : col, alpha);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(col, alpha);
        ctx.lineWidth = hollow ? 1.2 : 1;
        ctx.stroke();
        if (!hollow && n.kind === 'room') {
          ctx.fillStyle = rgba(P.bg, 0.55 * alpha);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, r * 0.38, 0, TAU); ctx.fill();
        }
      }

      // Gauges: CPU on the inner arc, memory on the outer, both from twelve o'clock.
      const m = n.metrics;
      if (m && (n.kind === 'room' || n.kind === 'site' || n.kind === 'host')) {
        const gauges = [['cpu', r + 3.5], ['mem', r + 6.5]];
        for (const [k, gr] of gauges) {
          if (typeof m[k] !== 'number') continue;
          const v = Math.max(0, Math.min(1, m[k]));
          ctx.lineWidth = 2;
          ctx.strokeStyle = rgba(P.t3, 0.18 * alpha);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, gr, 0, TAU); ctx.stroke();
          ctx.strokeStyle = rgba(v > 0.9 ? P.crit : v > 0.75 ? P.warn : P.t2, 0.85 * alpha);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, gr, -Math.PI / 2, -Math.PI / 2 + v * TAU); ctx.stroke();
        }
      }

      if (id === selected) {
        ctx.strokeStyle = rgba(P.accent, 0.95);
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 11, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else if (id === focus) {
        ctx.strokeStyle = rgba(P.t1, 0.5);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r + 10, 0, TAU); ctx.stroke();
      }
    }
  }

  function drawLabels(s) {
    const ns = Math.max(0.8, Math.min(1.6, s));
    const focus = hover ?? selected;
    const near = focus ? neighbours.get(focus) ?? new Set() : new Set();
    ctx.save();
    ctx.textBaseline = 'middle';
    for (const [id, c] of cur) {
      const n = byId.get(id);
      const p = lay.pos.get(id);
      if (!n || !p || n.virtual) continue;
      const alpha = (focusAlpha.get(id) ?? 1) * c.a;
      const status = n.status ?? 'unknown';
      const loud = ['attention', 'crit', 'down'].includes(status);
      const show = p.depth <= 2 || s > 1.25 || id === focus || near.has(id) || matches.has(id) || loud || id === selected;
      if (!show || alpha < 0.12) continue;
      const sp = toScreen(c);
      const r = (SIZE[n.kind] ?? 5) * ns;
      if (n.kind === 'core') {
        ctx.textAlign = 'center';
        ctx.font = `600 11px ${P.mono}`;
        ctx.fillStyle = rgba(P.t1, alpha);
        ctx.fillText((n.label ?? '').toUpperCase().split('').join(' '), sp.x, sp.y + r * 3.2 + 6);
        continue;
      }
      const ang = p.angle;
      const out = r + (n.metrics ? 12 : 8);
      const x = sp.x + Math.cos(ang) * out;
      const y = sp.y + Math.sin(ang) * out;
      ctx.textAlign = Math.cos(ang) >= 0 ? 'left' : 'right';
      const big = n.kind === 'site' || n.kind === 'host';
      const text = big ? (n.label ?? n.id).toUpperCase() : (n.label ?? n.id);
      ctx.font = big ? `600 12px ${P.mono}` : n.kind === 'room' ? `500 11.5px ${P.ui}` : `11px ${P.ui}`;
      const col = loud ? statusColor(P, status) : big ? P.t1 : n.kind === 'room' ? P.t1 : P.t2;
      // A backing so a label stays readable where an arc passes under it.
      const w = ctx.measureText(text).width;
      const bx = ctx.textAlign === 'left' ? x - 2 : x - w - 2;
      ctx.fillStyle = rgba(P.bg, 0.72 * alpha);
      ctx.fillRect(bx, y - 7, w + 4, 14);
      ctx.fillStyle = rgba(col, (big ? 1 : 0.92) * alpha);
      ctx.fillText(text, x, y);
      const sub = n.why && loud ? n.why : n.sub;
      if (sub && (s > 1.05 || id === focus || id === selected)) {
        ctx.font = `10px ${P.mono}`;
        ctx.fillStyle = rgba(loud ? statusColor(P, status) : P.t3, 0.9 * alpha);
        ctx.fillText(sub.length > 38 ? `${sub.slice(0, 37)}…` : sub, x, y + 13);
      }
    }
    ctx.restore();
  }

  // Theme or token changes repaint with the new colours.
  const mo = new MutationObserver(() => { P = readPalette(root); kick(); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => { P = readPalette(root); kick(); };
  mq.addEventListener?.('change', onScheme);

  resize();
  const tickTimer = setInterval(() => { if (recent.length) renderTicker(); }, 15000);

  return {
    update,
    event,
    select,
    focus: flyTo,
    fit: () => fit(false),
    resize,
    destroy: () => {
      cancelAnimationFrame(raf);
      clearInterval(tickTimer);
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener?.('change', onScheme);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(settleTimer);
      root.innerHTML = '';
    },
  };
}
