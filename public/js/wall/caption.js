// The Wall's caption (docs/plans/wall/README.md §3): when the camera arrives
// at a site, a plate top left says what it is. A small mono kicker
// (`TARGET 02 / 05 · SITE`), the name typed letter by letter in big condensed
// caps behind a block cursor, then 3-6 lines fading in one by one: the
// trouble line first in its status colour with its shape, the status, cpu and
// mem with thin bars, hardware / where / uptime from `detail`, what it holds.
// It fades out when the camera leaves.
//
// On a site in trouble the plate is read from across the room (T20, research
// Q3): the trouble word (`■ STORAGE`, its why under it) leads at the 3 m step,
// the biggest text on the plate, shown with the plate; the name types under
// it at the 1.5 m step; status and metrics keep the line step; hardware,
// where and what it holds drop to the small step below a gap. A calm site
// keeps the plain order: name, then the lines.
//
// `captionLines` and `captionSchedule` are pure (test/wall-caption.test.mjs
// imports them); `createCaption` is the DOM part, driven by the tour's legs.
//
// The motion is the plan's, not the app's 120 ms rule (docs/design.md 5):
// the typing and the stagger are what the owner asked for (README §1), so
// they run in script (Web Animations, timers), one beat after the other, and
// the plate then stands still for the rest of the hold (research Q1: what
// must be read is static once it is in).

import { SEVERITY, TROUBLE, byIdOf, kidsOf, rollup } from '../views/map/model.js';
import { statusStyle } from '../views/map/overlays.js';

/** Never more lines than this under the name (README §3: 3-6). */
export const MAX_LINES = 6;

/** A value longer than this is cut with an ellipsis, so the plate keeps its width. */
export const MAX_TEXT = 40;

/** The Map's shapes as type (overlays.js SHAPE_CODE; docs/design.md status language). */
export const GLYPH = Object.freeze({ square: '■', tri: '▲', diamond: '◆', ring: '○' });

// Detail keys the plan names, in its order; any other key follows them.
const FACT_ORDER = ['hardware', 'where', 'uptime'];

/**
 * The plate's type steps in vmin (wall.css keeps the same numbers): ratio
 * about 1.6 from the key up; `hero` is the trouble word's largest size (a
 * 20' cap at 3 m on the 12.3" tablet, research Q3: ~180 device px), shrunk
 * to fit the plate's width but never under `heroMin`, a step above the name.
 */
export const STEPS = Object.freeze({ key: 1.7, line: 2.7, why: 4.3, name: 6.9, heroMin: 9, hero: 14 });

// The trouble word's width in em, in the label face's caps with the plate's
// tracking (0.43 em a letter plus 0.04 em), the shape and its gap ahead of it.
const HERO_EM_PER_CHAR = 0.47;
const HERO_GLYPH_EM = 1.1;

/** A trouble word's width in em at the hero face and tracking, its shape ahead of it (frame.js fits the fleet line by it too). */
export const heroEms = (word) => HERO_GLYPH_EM + [...String(word ?? '')].length * HERO_EM_PER_CHAR;

/** The plate's widest (vw) on a trouble site, and its side padding (vmin, both sides). */
export const HERO_PLATE = Object.freeze({ maxVw: 56, padVmin: 6 });

/**
 * The trouble word's size in vmin for a stage `width` x `height` (any unit):
 * as big as `STEPS.hero` while the word fits the plate's width, smaller when
 * it does not, `STEPS.heroMin` at the least (a longer word is cut by the CSS).
 */
export function heroSize(word, width, height) {
  const w = Number(width);
  const h = Number(height);
  const short = Math.min(w, h);
  if (!(short > 0)) return STEPS.hero;
  const avail = (HERO_PLATE.maxVw * w) / short - HERO_PLATE.padVmin;
  const fit = avail / heroEms(word);
  return Math.round(Math.min(STEPS.hero, Math.max(STEPS.heroMin, fit)) * 10) / 10;
}

const PLURAL = { room: 'rooms', host: 'hosts', service: 'services', site: 'sites', lane: 'lanes', builder: 'builders', session: 'sessions', repo: 'repos', package: 'packages', run: 'runs', pr: 'PRs' };

const clip = (s) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1).trimEnd()}…` : t;
};
const pad2 = (n) => String(n).padStart(2, '0');
const frac = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(v, 1) : null);

/** Every node below `id`, depth first, in model order. */
function below(id, kids, out = [], seen = new Set()) {
  for (const c of kids.get(id) ?? []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    below(c.id, kids, out, seen);
  }
  return out;
}

/**
 * The problems below a node, worst first: a node in trouble whose parent
 * (below `node`) is not is one problem with everything in trouble under it,
 * as the fleet line counts them (frame.js `worstLine`: a lane and its waiting
 * session are one); the worst node in it speaks for it. A tie keeps model order.
 */
function problemsBelow(node, under, byId) {
  const bad = (x) => x && x !== node && TROUBLE.includes(x.status);
  const problems = new Map();
  for (const u of under) {
    if (!bad(u)) continue;
    let root = u;
    const seen = new Set([u.id]);
    while (bad(byId.get(root.parent)) && !seen.has(root.parent)) {
      root = byId.get(root.parent);
      seen.add(root.id);
    }
    const p = problems.get(root.id);
    if (!p) problems.set(root.id, u);
    else if (SEVERITY.indexOf(u.status) > SEVERITY.indexOf(p.status)) problems.set(root.id, u);
  }
  return [...problems.values()]
    .map((worst, i) => ({ worst, i }))
    .sort((a, b) => SEVERITY.indexOf(b.worst.status) - SEVERITY.indexOf(a.worst.status) || a.i - b.i)
    .map(({ worst }) => worst);
}

/** `1 crit · 5 attention`: how many problems at each status, worst first. */
function severityCount(problems) {
  const by = new Map();
  for (const p of problems) by.set(p.status, (by.get(p.status) ?? 0) + 1);
  return [...by].sort((a, b) => SEVERITY.indexOf(b[0]) - SEVERITY.indexOf(a[0])).map(([s, c]) => `${c} ${s}`).join(' · ');
}

/** How many problems the plate names (T22: the worst, the hero, then the next two). */
export const NAMED_PROBLEMS = 3;

/**
 * What the caption says about `node`. `model` is a map model (or its
 * `nodes`); `index`/`count` number the tour's targets (1-based), either may
 * be missing. Returns `{ kicker, mark, name, status, lines }`: `status` the
 * rolled up status; `mark` `{ status, tone, shape, glyph }` of the worst
 * problem on a node in trouble (the kicker then starts with its status word,
 * the page sets the glyph ahead of it in its tone), null when calm; each line
 * is one of
 *   `{ kind: 'trouble', id, label, text, status, tone, shape, glyph }` (`id`
 *     the node it is about: the lock closes on it, T25)
 *   `{ kind: 'status', label, text }`
 *   `{ kind: 'problem', label, text, status, tone, shape, glyph }`
 *   `{ kind: 'metrics', bars: [{ label, value, text }] }`
 *   `{ kind: 'fact', label, text }`
 *   `{ kind: 'count', label, text }`
 * in that order, at most MAX_LINES (facts give way first). Below a site in
 * trouble the status line counts the problems by severity (`1 crit · 5
 * attention`); the trouble line is the worst, and up to two `problem` lines
 * (label the status, text `NAME · why`) name the next ones. Labels are short
 * words the page sets in caps; texts are as the model says them, clipped.
 * Every line carries its `step`: `hero` (the trouble line: `word` big, `sub`
 * under it), `line`, or `small` (facts and the count on a trouble site).
 */
export function captionLines(node, model, index = null, count = null) {
  const nodes = Array.isArray(model) ? model : Array.isArray(model?.nodes) ? model.nodes : [];
  const list = nodes.filter((n) => n && typeof n.id === 'string');
  const byId = byIdOf(list);
  const kids = kidsOf(list, byId);
  const n = node && typeof node === 'object' ? node : {};
  const kind = typeof n.kind === 'string' && n.kind ? n.kind : 'node';

  const target = Number.isInteger(index) && index > 0
    ? `TARGET ${pad2(index)}${Number.isInteger(count) && count >= index ? ` / ${pad2(count)}` : ''} · `
    : '';
  let kicker = `${target}${kind.toUpperCase()}`;
  const name = clip(n.label ?? n.id ?? '').toUpperCase();

  const known = typeof n.id === 'string' && byId.has(n.id);
  const status = known ? rollup(n.id, byId, kids) : (n.status ?? 'unknown');
  const under = known ? below(n.id, kids) : [];

  const lines = [];

  const problems = problemsBelow(n, under, byId);
  const bad = TROUBLE.includes(n.status) ? n : (problems[0] ?? null);
  if (bad) {
    const st = statusStyle(bad);
    const why = bad.why ?? bad.sub;
    const label = clip(bad === n ? bad.status : (bad.label ?? bad.id));
    const text = clip(why ?? bad.status);
    // The word is where the trouble is (a node below), or what it is (the node's own).
    const own = bad === n;
    lines.push({
      kind: 'trouble',
      step: 'hero',
      id: bad.id,
      label,
      text,
      word: (own ? text : label).toUpperCase(),
      sub: own ? (text === label ? '' : label) : text,
      status: bad.status,
      tone: st.tone,
      shape: st.shape,
      glyph: GLYPH[st.shape] ?? GLYPH.square,
    });
  }
  // On trouble the kicker leads with the worst status in its colour and shape
  // (T26): `■ CRIT · TARGET 01 / 05 · SITE`; a calm kicker stays grey and plain.
  const mark = bad ? { status: bad.status, tone: lines[0].tone, shape: lines[0].shape, glyph: lines[0].glyph } : null;
  if (mark) kicker = `${mark.status.toUpperCase()} · ${kicker}`;

  let statusText = status;
  if (problems.length) statusText = severityCount(problems);
  else if (under.length) statusText += bad ? '' : ` · all ${under.length} calm`;
  else if (typeof n.sub === 'string' && n.sub) statusText += ` · ${n.sub}`;
  lines.push({ kind: 'status', step: 'line', label: 'status', text: clip(statusText) });

  // The next problems after the one the plate leads with, one per line.
  const named = problems.filter((p) => p !== bad).slice(0, NAMED_PROBLEMS - (bad ? 1 : 0));
  for (const p of named) {
    const st = statusStyle(p);
    const why = p.why ?? p.sub;
    lines.push({
      kind: 'problem',
      step: 'line',
      label: p.status,
      text: clip([String(p.label ?? p.id).toUpperCase(), why].filter(Boolean).join(' · ')),
      status: p.status,
      tone: st.tone,
      shape: st.shape,
      glyph: GLYPH[st.shape] ?? GLYPH.square,
    });
  }

  const m = n.metrics && typeof n.metrics === 'object' ? n.metrics : {};
  const bars = [['cpu', m.cpu], ['mem', m.mem]]
    .map(([label, v]) => [label, frac(v)])
    .filter(([, v]) => v != null)
    .map(([label, value]) => ({ label, value, text: `${Math.round(value * 100)}%` }));
  if (bars.length) lines.push({ kind: 'metrics', step: 'line', bars });

  const direct = kids.get(n.id) ?? [];
  let countLine = null;
  if (known && direct.length) {
    const byKind = new Map();
    for (const c of direct) {
      const k = typeof c.kind === 'string' && c.kind ? c.kind : 'node';
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    const text = [...byKind].map(([k, c]) => `${c} ${c === 1 ? k : (PLURAL[k] ?? `${k}s`)}`).join(' · ');
    countLine = { kind: 'count', step: bad ? 'small' : 'line', label: 'holds', text: clip(text) };
  }

  const detail = n.detail && typeof n.detail === 'object' && !Array.isArray(n.detail) ? n.detail : {};
  const facts = Object.entries(detail)
    .filter(([k, v]) => k && (typeof v === 'string' ? v.trim() : Number.isFinite(v)))
    .map(([k, v], i) => ({ k, v, i, rank: FACT_ORDER.indexOf(k.toLowerCase()) }))
    .sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank) || a.i - b.i)
    .map(({ k, v }) => ({ kind: 'fact', step: bad ? 'small' : 'line', label: clip(k.toLowerCase()), text: clip(v) }));
  const room = MAX_LINES - lines.length - (countLine ? 1 : 0);
  lines.push(...facts.slice(0, Math.max(0, room)));
  if (countLine) lines.push(countLine);

  return { kicker, mark, name, status, hero: Boolean(bad), lines };
}

/**
 * The plate's vertical rhythm in vmin (wall.css sets the same heights, so
 * the layout is this sum and not the fonts' metrics): its padding, the
 * kicker, the trouble word (a fraction of its size) and its why, the name,
 * and each row by its step with the gaps between them. Adjacent margins
 * collapse, so the hero and the name share the larger of their two.
 */
export const PLATE = Object.freeze({
  padTop: 2.4, padBottom: 2.64, kicker: 1.7,
  heroAbove: 1.2, heroLead: 0.86, subGap: 0.9, sub: 4.3, heroBelow: 1.4,
  nameAbove: 0.9, nameLead: 0.92, nameBelow: 1.6,
  rowGap: 0.9, smallGap: 1.6, rows: Object.freeze({ line: 3.2, small: 2.3 }),
});

/**
 * The plate's height in vmin with the first `shown` rows in (T23: the plate
 * grows with its lines, it does not open at its full height with empty rows
 * under the name). `cap` is `captionLines`' answer; the trouble line is the
 * hero, in with the plate, so it is always counted, at `heroVmin`.
 */
export function plateHeight(cap, shown = Infinity, heroVmin = STEPS.hero) {
  const all = Array.isArray(cap?.lines) ? cap.lines : [];
  const lead = all.find((l) => l.step === 'hero');
  const rows = all.filter((l) => l.step !== 'hero');
  const n = Math.max(0, Math.min(rows.length, Number.isFinite(shown) ? Math.floor(shown) : rows.length));
  let h = PLATE.padTop + PLATE.kicker;
  if (lead) {
    h += PLATE.heroAbove + heroVmin * PLATE.heroLead + (lead.sub ? PLATE.subGap + PLATE.sub : 0);
    h += Math.max(PLATE.heroBelow, PLATE.nameAbove);
  } else {
    h += PLATE.nameAbove;
  }
  h += STEPS.name * PLATE.nameLead + PLATE.nameBelow;
  for (let i = 0; i < n; i++) {
    const step = rows[i].step === 'small' ? 'small' : 'line';
    if (i) h += PLATE.rowGap + (step === 'small' && rows[i - 1].step !== 'small' ? PLATE.smallGap : 0);
    h += PLATE.rows[step];
  }
  return Math.round((h + PLATE.padBottom) * 100) / 100;
}

/** Normal speed: the sequence starts when the camera is there (research Q1: arrive, then type). */
export const CAPTION_TIMING = Object.freeze({
  leadMs: 0, inMs: 320, letterMs: 35, lineGapMs: 170, lineFadeMs: 280, outMs: 220, cursorMs: 2000,
});

/**
 * `?demo=1`: the hold is only 1.75 s (tour.js DEMO_TIMING), so the plate
 * starts while the flight eases out and the name types in its last 0.5 s
 * (T23: `leadMs - inMs`), and every beat is a little shorter.
 */
export const DEMO_CAPTION_TIMING = Object.freeze({
  leadMs: 800, inMs: 300, letterMs: 30, lineGapMs: 140, lineFadeMs: 220, outMs: 200, cursorMs: 800,
});

/** Everything at once, nothing moving (prefers-reduced-motion; D5 is night 2's). */
export const STILL_CAPTION_TIMING = Object.freeze({
  leadMs: 0, inMs: 0, letterMs: 0, lineGapMs: 0, lineFadeMs: 0, outMs: 0, cursorMs: 0,
});

export const captionTimingFor = (demo) => (demo ? DEMO_CAPTION_TIMING : CAPTION_TIMING);

/**
 * How far into a leg's flight (0..1 of `arriveMs`) the plate may start, at
 * the earliest (night 3 T15, r4-film-ui galaxy 1): a plate that types while
 * the camera still passes other sites names a target nobody can find. The
 * galaxy sets it as the timing's `fromK`; `leadMs` still pulls the plate
 * forward, never before this.
 */
export const CAPTION_FROM_K = 0.9;

/**
 * The galaxy's caption timing (T15): the plate held until `CAPTION_FROM_K`
 * of the flight. In the demo (a 1.75 s hold) the name types with the plate's
 * fade and a little faster, so a full plate is still still for half a second.
 */
export const ARRIVED_CAPTION_TIMING = Object.freeze({ ...CAPTION_TIMING, fromK: CAPTION_FROM_K });
export const ARRIVED_DEMO_CAPTION_TIMING = Object.freeze({ ...DEMO_CAPTION_TIMING, fromK: CAPTION_FROM_K, inMs: 160, letterMs: 25 });
export const arrivedTimingFor = (demo) => (demo ? ARRIVED_DEMO_CAPTION_TIMING : ARRIVED_CAPTION_TIMING);

/**
 * When each beat happens, in ms from the leg's start: the plate fades in at
 * `startMs` (never before `timing.fromK` of `arriveMs`), the name types from `nameAt` to `nameDoneAt`, line i starts
 * fading at `lineAt[i]`, and everything stands still from `doneAt`; the
 * cursor goes at `cursorOffAt`.
 */
export function captionSchedule(leg, name, lineCount, timing = CAPTION_TIMING) {
  const arrive = Number.isFinite(leg?.arriveMs) ? leg.arriveMs : 0;
  const startMs = Math.max(0, arrive - timing.leadMs, arrive * (timing.fromK ?? 0));
  const nameAt = startMs + timing.inMs;
  const nameDoneAt = nameAt + String(name ?? '').length * timing.letterMs;
  const lineAt = Array.from({ length: lineCount }, (_, i) => nameDoneAt + i * timing.lineGapMs);
  const doneAt = lineCount ? lineAt[lineCount - 1] + timing.lineFadeMs : nameDoneAt;
  return { startMs, nameAt, nameDoneAt, lineAt, doneAt, cursorOffAt: nameDoneAt + timing.cursorMs };
}

/**
 * A block laid over the map as a Map cover (`createMap(el, { covers })`,
 * T24): `{left, top, right, bottom}` in the stage's px from an element's
 * offset box, or null when it takes no room. Map names keep clear of it, so
 * none is cut by its edge or shows through it as a ghost.
 */
export function coverOf(box) {
  const { left, top, width, height } = box ?? {};
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { left, top, right: left + width, bottom: top + height };
}

// --- the DOM part ------------------------------------------------------------

const EASE = 'cubic-bezier(.2, 0, 0, 1)';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function lineEl(line) {
  const li = el('li', 'wall-caption-line');
  li.dataset.kind = line.kind;
  li.dataset.step = line.step ?? 'line';
  if (line.kind === 'metrics') {
    for (const b of line.bars) {
      const cell = el('span', 'wall-caption-metric');
      cell.append(el('span', 'wall-caption-key', b.label));
      const bar = el('span', 'wall-caption-bar');
      const fill = el('span', 'wall-caption-fill');
      fill.style.width = `${Math.round(b.value * 100)}%`;
      bar.append(fill);
      cell.append(bar, el('span', 'wall-caption-num', b.text));
      li.append(cell);
    }
    return li;
  }
  if (line.kind === 'trouble' || line.kind === 'problem') {
    li.dataset.tone = line.tone;
    const key = el('span', 'wall-caption-key');
    key.append(el('span', 'wall-caption-glyph', line.glyph), el('span', null, line.label));
    li.append(key);
  } else {
    li.append(el('span', 'wall-caption-key', line.label));
  }
  li.append(el('span', 'wall-caption-val', line.text));
  return li;
}

/**
 * The plate inside `root` (an empty element over the map). `show(leg,
 * caption)` builds and plays it for a tour leg, `hide()` fades it out and
 * cancels what had not played yet. `timers` is injectable.
 */
export function createCaption(root, { timing = CAPTION_TIMING, timers = globalThis } = {}) {
  const plate = el('section', 'wall-caption');
  plate.setAttribute('aria-live', 'polite');
  const kicker = el('div', 'wall-caption-kicker');
  const kickerGlyph = el('span', 'wall-caption-glyph');
  const kickerText = el('span', null);
  kicker.append(kickerGlyph, kickerText);
  const name = el('h1', 'wall-caption-name');
  const typed = el('span', 'wall-caption-typed');
  const cursor = el('span', 'wall-caption-cursor');
  const rest = el('span', 'wall-caption-rest');
  name.append(typed, cursor, rest);
  // The trouble word, on a site in trouble: above the name, in with the plate.
  const hero = el('div', 'wall-caption-hero');
  const heroWord = el('div', 'wall-caption-hero-word');
  const heroGlyph = el('span', 'wall-caption-glyph');
  const heroText = el('span', 'wall-caption-hero-text');
  heroWord.append(heroGlyph, heroText);
  const heroSub = el('div', 'wall-caption-hero-sub');
  hero.append(heroWord, heroSub);
  hero.hidden = true;
  const list = el('ul', 'wall-caption-lines');
  plate.append(kicker, hero, name, list);
  root.append(plate);

  let pending = new Set();
  let shown = false;
  // The plate's box with every row in, and whether it covers the map now (T24).
  let box = null;
  let covering = false;
  // Where the lock's leader leaves the plate: its right edge, level with the trouble word (T25).
  let anchor = null;
  let uncover = null;
  const later = (ms, fn) => {
    const t = timers.setTimeout(() => { pending.delete(t); fn(); }, Math.max(0, ms));
    pending.add(t);
  };
  const cancel = () => {
    for (const t of pending) timers.clearTimeout(t);
    pending = new Set();
  };
  const fade = (node, to, ms) => {
    if (!ms || typeof node.animate !== 'function') { node.style.opacity = String(to); return; }
    const from = getComputedStyle(node).opacity;
    node.style.opacity = String(to);
    node.animate([{ opacity: from }, { opacity: String(to) }], { duration: ms, easing: EASE });
  };

  const hide = () => {
    cancel();
    if (!shown) return;
    shown = false;
    fade(plate, 0, timing.outMs);
    delete plate.dataset.status;
    // Names come back once the plate has gone, not through its fade (its own
    // timer: a show or hide that cancels the beats must not keep it covering).
    if (uncover != null) timers.clearTimeout(uncover);
    uncover = timers.setTimeout(() => { uncover = null; covering = false; }, Math.max(0, timing.outMs));
  };

  // The plate's height follows its rows (plateHeight), eased as each comes in.
  let heroVmin = STEPS.hero;
  const grow = (cap, shown, ms) => {
    const to = `${plateHeight(cap, shown, heroVmin)}vmin`;
    const from = plate.style.height;
    plate.style.height = to;
    if (ms && from && from !== to && typeof plate.animate === 'function') {
      plate.animate([{ height: from }, { height: to }], { duration: ms, easing: EASE });
    }
  };

  // The content is swapped once the last plate has faded out.
  const build = (cap, rows) => {
    kickerText.textContent = cap.kicker;
    kickerGlyph.textContent = cap.mark?.glyph ?? '';
    kickerGlyph.hidden = !cap.mark;
    if (cap.mark) kicker.dataset.tone = cap.mark.tone; else delete kicker.dataset.tone;
    const lead = cap.lines.find((l) => l.step === 'hero');
    hero.hidden = !lead;
    if (lead) {
      hero.dataset.tone = lead.tone;
      heroGlyph.textContent = lead.glyph;
      heroText.textContent = lead.word;
      heroSub.textContent = lead.sub;
      heroSub.hidden = !lead.sub;
      // Sized once a leg from the stage, not per frame.
      heroVmin = heroSize(lead.word, root.clientWidth, root.clientHeight);
      hero.style.setProperty('--cap-hero', `${heroVmin}vmin`);
    }
    if (lead) plate.dataset.hero = ''; else delete plate.dataset.hero;
    typed.textContent = '';
    rest.textContent = cap.name;
    cursor.hidden = false;
    cursor.classList.remove('is-blink');
    list.replaceChildren(...rows.map(lineEl));
    plate.dataset.status = cap.status;
    plate.style.height = '';
    // Where the plate stands once every row is in, read once a leg: the map's
    // names keep clear of all of it from the start, so none pops out from
    // under a row as it wipes in.
    box = coverOf({ left: plate.offsetLeft, top: plate.offsetTop, width: plate.offsetWidth, height: plate.offsetHeight });
    const mid = plate.offsetTop + heroWord.offsetTop + heroWord.offsetHeight / 2;
    anchor = lead && box && Number.isFinite(mid) ? { x: box.right, y: mid } : null;
    // A row takes no room until its beat: the plate opens on kicker, word and name.
    for (const li of list.children) { li.hidden = true; li.style.opacity = '0'; }
    grow(cap, 0, 0);
  };

  const show = (leg, cap) => {
    const wasShown = shown;
    hide();
    const rows = cap.lines.filter((l) => l.step !== 'hero');
    const s = captionSchedule(leg, cap.name, rows.length, timing);
    const swapAt = wasShown ? timing.outMs : 0;
    later(swapAt, () => build(cap, rows));
    later(Math.max(s.startMs, swapAt), () => {
      shown = true;
      if (uncover != null) { timers.clearTimeout(uncover); uncover = null; }
      covering = true;
      fade(plate, 1, timing.inMs);
    });
    const letters = [...cap.name];
    letters.forEach((_, i) => later(Math.max(s.nameAt + (i + 1) * timing.letterMs, swapAt), () => {
      typed.textContent = letters.slice(0, i + 1).join('');
      rest.textContent = letters.slice(i + 1).join('');
    }));
    later(Math.max(s.nameDoneAt, swapAt), () => {
      typed.textContent = cap.name;
      rest.textContent = '';
      cursor.classList.add('is-blink');
    });
    later(Math.max(s.cursorOffAt, swapAt), () => { cursor.hidden = true; cursor.classList.remove('is-blink'); });
    rows.forEach((_, i) => later(Math.max(s.lineAt[i], swapAt), () => {
      const li = list.children[i];
      if (!li) return;
      li.hidden = false;
      grow(cap, i + 1, timing.lineFadeMs);
      li.style.opacity = '1';
      if (timing.lineFadeMs && typeof li.animate === 'function') {
        li.animate([{ opacity: 0 }, { opacity: 1 }], { duration: timing.lineFadeMs, easing: EASE });
      }
    }));
  };

  /** The plate as a Map cover while it is on screen, else null (T24). */
  const cover = () => (covering ? box : null);
  /** Where a leader to the trouble node leaves the plate while it shows a trouble word, else null (T25). */
  const leaderFrom = () => (covering ? anchor : null);

  return { show, hide, cover, leaderFrom, el: plate };
}
