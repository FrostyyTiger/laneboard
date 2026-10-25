// The Wall's caption (docs/plans/wall/README.md §3): when the camera arrives
// at a site, a plate top left says what it is. A small mono kicker
// (`TARGET 02 / 05 · SITE`), the name typed letter by letter in big condensed
// caps behind a block cursor, then 3-6 lines fading in one by one: the
// trouble line first in its status colour with its shape, the status, cpu and
// mem with thin bars, hardware / where / uptime from `detail`, what it holds.
// It fades out when the camera leaves.
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
    lines.push({
      kind: 'trouble',
      label: clip(bad === n ? bad.status : (bad.label ?? bad.id)),
      text: clip(why ?? bad.status),
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
  lines.push({ kind: 'status', label: 'status', text: clip(statusText) });

  const m = n.metrics && typeof n.metrics === 'object' ? n.metrics : {};
  const bars = [['cpu', m.cpu], ['mem', m.mem]]
    .map(([label, v]) => [label, frac(v)])
    .filter(([, v]) => v != null)
    .map(([label, value]) => ({ label, value, text: `${Math.round(value * 100)}%` }));
  if (bars.length) lines.push({ kind: 'metrics', bars });

  const direct = kids.get(n.id) ?? [];
  let countLine = null;
  if (known && direct.length) {
    const byKind = new Map();
    for (const c of direct) {
      const k = typeof c.kind === 'string' && c.kind ? c.kind : 'node';
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    const text = [...byKind].map(([k, c]) => `${c} ${c === 1 ? k : (PLURAL[k] ?? `${k}s`)}`).join(' · ');
    countLine = { kind: 'count', label: 'holds', text: clip(text) };
  }

  const detail = n.detail && typeof n.detail === 'object' && !Array.isArray(n.detail) ? n.detail : {};
  const facts = Object.entries(detail)
    .filter(([k, v]) => k && (typeof v === 'string' ? v.trim() : Number.isFinite(v)))
    .map(([k, v], i) => ({ k, v, i, rank: FACT_ORDER.indexOf(k.toLowerCase()) }))
    .sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank) || a.i - b.i)
    .map(({ k, v }) => ({ kind: 'fact', label: clip(k.toLowerCase()), text: clip(v) }));
  const room = MAX_LINES - lines.length - (countLine ? 1 : 0);
  lines.push(...facts.slice(0, Math.max(0, room)));
  if (countLine) lines.push(countLine);

  return { kicker, name, status, lines };
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
  const list = el('ul', 'wall-caption-lines');
  plate.append(kicker, name, list);
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
  const build = (cap) => {
    kicker.textContent = cap.kicker;
    typed.textContent = '';
    rest.textContent = cap.name;
    cursor.hidden = false;
    cursor.classList.remove('is-blink');
    list.replaceChildren(...cap.lines.map(lineEl));
    for (const li of list.children) li.style.opacity = '0';
    plate.dataset.status = cap.status;
  };

  const show = (leg, cap) => {
    const wasShown = shown;
    hide();
    const s = captionSchedule(leg, cap.name, cap.lines.length, timing);
    const swapAt = wasShown ? timing.outMs : 0;
    later(swapAt, () => build(cap));
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
    cap.lines.forEach((_, i) => later(Math.max(s.lineAt[i], swapAt), () => {
      const li = list.children[i];
      if (li) fade(li, 1, timing.lineFadeMs);
    }));
  };

  return { show, hide, el: plate };
}
