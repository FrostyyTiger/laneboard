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

/** The trouble the caption leads with: the node's own, or the worst below it (first in model order on a tie). */
function troubleOf(node, under) {
  if (TROUBLE.includes(node.status)) return node;
  let worst = null;
  for (const n of under) {
    if (!TROUBLE.includes(n.status)) continue;
    if (!worst || SEVERITY.indexOf(n.status) > SEVERITY.indexOf(worst.status)) worst = n;
  }
  return worst;
}

/**
 * What the caption says about `node`. `model` is a map model (or its
 * `nodes`); `index`/`count` number the tour's targets (1-based), either may
 * be missing. Returns `{ kicker, name, status, lines }`: `status` the rolled
 * up status; each line is one of
 *   `{ kind: 'trouble', label, text, status, tone, shape, glyph }`
 *   `{ kind: 'status', label, text }`
 *   `{ kind: 'metrics', bars: [{ label, value, text }] }`
 *   `{ kind: 'fact', label, text }`
 *   `{ kind: 'count', label, text }`
 * in that order, at most MAX_LINES (facts give way first). Labels are short
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
  const kicker = `${target}${kind.toUpperCase()}`;
  const name = clip(n.label ?? n.id ?? '').toUpperCase();

  const known = typeof n.id === 'string' && byId.has(n.id);
  const status = known ? rollup(n.id, byId, kids) : (n.status ?? 'unknown');
  const under = known ? below(n.id, kids) : [];

  const lines = [];

  const bad = troubleOf(n, under);
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

  const inTrouble = under.filter((u) => TROUBLE.includes(u.status)).length;
  let statusText = status;
  if (under.length) statusText += inTrouble ? ` · ${inTrouble} of ${under.length} in trouble` : ` · all ${under.length} calm`;
  else if (typeof n.sub === 'string' && n.sub) statusText += ` · ${n.sub}`;
  lines.push({ kind: 'status', step: 'line', label: 'status', text: clip(statusText) });

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

  return { kicker, name, status, hero: Boolean(bad), lines };
}

/** Normal speed: the sequence starts when the camera is there (research Q1: arrive, then type). */
export const CAPTION_TIMING = Object.freeze({
  leadMs: 0, inMs: 320, letterMs: 35, lineGapMs: 170, lineFadeMs: 280, outMs: 220, cursorMs: 2000,
});

/**
 * `?demo=1`: the hold is only 1.75 s (tour.js DEMO_TIMING), so the plate
 * starts while the flight eases out, and every beat is a little shorter.
 */
export const DEMO_CAPTION_TIMING = Object.freeze({
  leadMs: 900, inMs: 300, letterMs: 30, lineGapMs: 140, lineFadeMs: 220, outMs: 200, cursorMs: 800,
});

/** Everything at once, nothing moving (prefers-reduced-motion; D5 is night 2's). */
export const STILL_CAPTION_TIMING = Object.freeze({
  leadMs: 0, inMs: 0, letterMs: 0, lineGapMs: 0, lineFadeMs: 0, outMs: 0, cursorMs: 0,
});

export const captionTimingFor = (demo) => (demo ? DEMO_CAPTION_TIMING : CAPTION_TIMING);

/**
 * When each beat happens, in ms from the leg's start: the plate fades in at
 * `startMs`, the name types from `nameAt` to `nameDoneAt`, line i starts
 * fading at `lineAt[i]`, and everything stands still from `doneAt`; the
 * cursor goes at `cursorOffAt`.
 */
export function captionSchedule(leg, name, lineCount, timing = CAPTION_TIMING) {
  const arrive = Number.isFinite(leg?.arriveMs) ? leg.arriveMs : 0;
  const startMs = Math.max(0, arrive - timing.leadMs);
  const nameAt = startMs + timing.inMs;
  const nameDoneAt = nameAt + String(name ?? '').length * timing.letterMs;
  const lineAt = Array.from({ length: lineCount }, (_, i) => nameDoneAt + i * timing.lineGapMs);
  const doneAt = lineCount ? lineAt[lineCount - 1] + timing.lineFadeMs : nameDoneAt;
  return { startMs, nameAt, nameDoneAt, lineAt, doneAt, cursorOffAt: nameDoneAt + timing.cursorMs };
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
  if (line.kind === 'trouble') {
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
  };

  // The content is swapped once the last plate has faded out.
  const build = (cap, rows) => {
    kicker.textContent = cap.kicker;
    const lead = cap.lines.find((l) => l.step === 'hero');
    hero.hidden = !lead;
    if (lead) {
      hero.dataset.tone = lead.tone;
      heroGlyph.textContent = lead.glyph;
      heroText.textContent = lead.word;
      heroSub.textContent = lead.sub;
      heroSub.hidden = !lead.sub;
      // Sized once a leg from the stage, not per frame.
      hero.style.setProperty('--cap-hero', `${heroSize(lead.word, root.clientWidth, root.clientHeight)}vmin`);
    }
    if (lead) plate.dataset.hero = ''; else delete plate.dataset.hero;
    typed.textContent = '';
    rest.textContent = cap.name;
    cursor.hidden = false;
    cursor.classList.remove('is-blink');
    list.replaceChildren(...rows.map(lineEl));
    for (const li of list.children) li.style.opacity = '0';
    plate.dataset.status = cap.status;
  };

  const show = (leg, cap) => {
    const wasShown = shown;
    hide();
    const rows = cap.lines.filter((l) => l.step !== 'hero');
    const s = captionSchedule(leg, cap.name, rows.length, timing);
    const swapAt = wasShown ? timing.outMs : 0;
    later(swapAt, () => build(cap, rows));
    later(Math.max(s.startMs, swapAt), () => { shown = true; fade(plate, 1, timing.inMs); });
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
      if (li) fade(li, 1, timing.lineFadeMs);
    }));
  };

  return { show, hide, el: plate };
}
