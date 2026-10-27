// The Wall's frame (docs/plans/wall/README.md §3): what stays put while the
// camera moves. A vignette darkens the edges so text sits on quiet ground; a
// big clock bottom left; bottom right one line for the worst problem in the
// whole fleet (its status colour and shape) over one ambient fact; a small
// tag top right that names the board and says whether it is live.
//
// `worstLine`, `ambientLine` and `clockText` are pure
// (test/wall-frame.test.mjs imports them); `createFrame` is the DOM part. The
// frame changes only when its words do: the clock once a minute, the lines
// when a model brings different trouble. Nothing in it animates (north star
// 2: one camera, nothing else asking for the eye).

import { SEVERITY, TROUBLE, byIdOf } from '../views/map/model.js';
import { statusStyle } from '../views/map/overlays.js';
import { GLYPH, STEPS, heroEms, coverOf } from './caption.js';

/** The fleet line is cut with an ellipsis past this: two lines at most, so it never runs into the clock. */
export const MAX_LINE = 64;

/**
 * While anything is crit or down (T21) the fleet line is read from across
 * the room: where the trouble is (`■ HV2 · STORAGE`) at the 3 m step, the
 * caption's hero (`STEPS.hero`, fitted down to `STEPS.heroMin` by width),
 * its why under it at the why step with the `+N more` count. `maxVw` is the
 * widest the line may run: the clock keeps the bottom left.
 */
export const FLEET_FAR = Object.freeze({ maxVw: 64 });

const clip = (s, max = MAX_LINE) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const pad2 = (n) => String(n).padStart(2, '0');
const nodesOf = (model) => (Array.isArray(model) ? model : Array.isArray(model?.nodes) ? model.nodes : [])
  .filter((n) => n && typeof n.id === 'string');
const rank = (s) => SEVERITY.indexOf(s);

/** The site a node lives in (walking up its parents), or null. */
function siteOf(node, byId) {
  const seen = new Set();
  for (let n = node; n && !seen.has(n.id); n = byId.get(n.parent)) {
    seen.add(n.id);
    if (n.kind === 'site') return n;
  }
  return null;
}

/**
 * The fleet's problems, in model order: a problem is a node at warn or worse
 * whose parent is not (a lane waiting on a prompt and its session waiting
 * with it are one problem), `{ root, worst }`: the topmost node in trouble
 * and the worst node under it, which speaks for it. Pure.
 */
export function problemsOf(model) {
  const list = nodesOf(model);
  const byId = byIdOf(list);
  const bad = (n) => n && TROUBLE.includes(n.status);

  // Group each node in trouble under the topmost node in trouble above it.
  const problems = new Map();
  for (const n of list) {
    if (!bad(n)) continue;
    let root = n;
    const seen = new Set([n.id]);
    while (bad(byId.get(root.parent)) && !seen.has(root.parent)) {
      root = byId.get(root.parent);
      seen.add(root.id);
    }
    const p = problems.get(root.id);
    if (!p) problems.set(root.id, { root, worst: n });
    else if (rank(n.status) > rank(p.worst.status)) p.worst = n;
  }
  return [...problems.values()];
}

/** Whether a problem's worst node is at the 3 m step (crit or down). */
const isFar = (p) => p.worst.status === 'crit' || p.worst.status === 'down';

/** The far line names at most this many places; its count says how many there are. */
export const FAR_NAMES = 3;

/**
 * The worst problem in the fleet, for the line bottom right (`problemsOf`).
 * Worst first: down, crit, attention, warn; a tie keeps model order. Returns
 *   `{ status, tone, id, shape, glyph, site, name, why, text, more }`
 * (`id` the node that speaks for it) with `text` = `site · name · why` (the parts it has), `word` = `site ·
 * name` (where it is), `more` the number of other problems, and `step` the
 * size it is set at: `far` (the 3 m step) while the worst is crit or down,
 * else `line`; a calm fleet gives `{ status: 'ok', tone: 'grey', step:
 * 'calm', text: 'all calm', more: 0 }` and no glyph.
 *
 * With two or more crits (or downs) standing (night 4 T8, night 3's
 * reviews/r46-skeptic.md galaxy 1) the line names them all in a fixed order,
 * oldest first, never one picked by where the camera is: `word` =
 * `2 crit · hv2 · hv1` (the places, at most FAR_NAMES), `why` the oldest's
 * name and reason (`storage · pool 97% full`), `id` the oldest's node,
 * `crits` how many, and `more` the milder problems past them. `since` (a Map
 * of a problem's root id to when it was first seen, hud.js) says which is
 * oldest; one it does not know is newest; a tie puts a down first, then
 * keeps model order.
 */
export function worstLine(model, { since = null } = {}) {
  const problems = problemsOf(model);
  if (!problems.length) return { status: 'ok', tone: 'grey', step: 'calm', text: 'all calm', more: 0 };
  const byId = byIdOf(nodesOf(model));
  const far = problems.filter(isFar);
  if (far.length > 1) return critsLine(far, problems.length - far.length, byId, since);

  let worst = null;
  for (const p of problems) {
    if (!worst || rank(p.worst.status) > rank(worst.status)) worst = p.worst;
  }
  const st = statusStyle(worst);
  const site = siteOf(worst, byId);
  const siteName = site && site !== worst ? String(site.label ?? site.id) : null;
  const name = String(worst.label ?? worst.id);
  const why = whyOf(worst);
  return {
    status: worst.status,
    tone: st.tone,
    id: worst.id,
    step: isFar({ worst }) ? 'far' : 'line',
    shape: st.shape,
    glyph: GLYPH[st.shape] ?? GLYPH.square,
    site: siteName,
    name,
    why,
    word: [siteName, name].filter(Boolean).join(' · '),
    text: clip([siteName, name, why].filter(Boolean).join(' · ')),
    more: problems.length - 1,
  };
}

const whyOf = (n) => (typeof n.why === 'string' && n.why.trim() ? n.why : n.status);

/** `worstLine` for two or more crits standing (T8): all of them, oldest first. */
function critsLine(far, milder, byId, since) {
  const at = (p) => {
    const t = since instanceof Map ? since.get(p.root.id) : undefined;
    return Number.isFinite(t) ? t : Infinity;
  };
  // Seen at the same time (or no `since`): a down first, then model order.
  const order = far.map((p, i) => ({ p, i }))
    .sort((a, b) => at(a.p) - at(b.p) || rank(b.p.worst.status) - rank(a.p.worst.status) || a.i - b.i)
    .map((x) => x.p);
  const places = [];
  for (const p of order) {
    const site = siteOf(p.worst, byId);
    const place = String((site ?? p.worst).label ?? (site ?? p.worst).id);
    if (!places.includes(place)) places.push(place);
  }
  const oldest = order[0].worst;
  const st = statusStyle(oldest);
  const name = String(oldest.label ?? oldest.id);
  const site = siteOf(oldest, byId);
  // The oldest's own name with its reason, unless the place already is it (a site that is down).
  const why = [site && site !== oldest ? name : null, whyOf(oldest)].filter(Boolean).join(' · ');
  const word = [`${order.length} ${order.every((p) => p.worst.status === 'down') ? 'down' : 'crit'}`, ...places.slice(0, FAR_NAMES)].join(' · ');
  return {
    status: oldest.status,
    tone: st.tone,
    id: oldest.id,
    step: 'far',
    shape: st.shape,
    glyph: GLYPH[st.shape] ?? GLYPH.square,
    site: site && site !== oldest ? String(site.label ?? site.id) : null,
    name,
    why,
    word,
    text: clip(`${word} · ${why}`),
    crits: order.length,
    more: milder,
  };
}

/**
 * The fleet line for a crit that just cleared (night 3 T18, reviews
 * r11-dreamer 1, r17-operator 2): the red goes when the trouble goes. While
 * the rest of the fleet is calm the line remembers it in the calm voice,
 * `■ hv1 · vm-c ok · was down 6m`: the calm step (never the 3 m step), grey,
 * only the glyph in its old hue (wall.css `data-tone="cleared"`). `cleared`
 * is `{ id, status, forMs }` (galaxy hud.js CRIT_HOLD: the node, its status
 * before it cleared, how long it was in trouble). Null with no `cleared` or
 * when its node is gone. Pure.
 */
export function clearedLine(model, cleared) {
  if (!cleared || typeof cleared.id !== 'string') return null;
  const list = nodesOf(model);
  const node = list.find((n) => n.id === cleared.id);
  if (!node) return null;
  const st = statusStyle(node, cleared.status);
  const site = siteOf(node, byIdOf(list));
  const siteName = site && site !== node ? String(site.label ?? site.id) : null;
  const name = `${String(node.label ?? node.id)} ok`;
  const s = Math.max(0, Math.round((Number(cleared.forMs) || 0) / 1000));
  const why = `was ${cleared.status === 'down' ? 'down' : 'crit'} ${s < 60 ? `${s}s` : `${Math.round(s / 60)}m`}`;
  return {
    status: 'ok',
    tone: 'cleared',
    id: node.id,
    was: st.tone,
    step: 'calm',
    shape: st.shape,
    glyph: GLYPH[st.shape] ?? GLYPH.square,
    site: siteName,
    name,
    why,
    word: [siteName, name].filter(Boolean).join(' · '),
    text: clip([siteName, name, why].filter(Boolean).join(' · ')),
    more: 0,
  };
}

/**
 * The far step's size in vmin for a stage `width` x `height`: as big as the
 * caption's hero while `word` fits `FLEET_FAR.maxVw`, smaller when it does
 * not, never under `STEPS.heroMin` (a longer word is cut by the CSS).
 */
export function fleetSize(word, width, height) {
  const w = Number(width);
  const short = Math.min(w, Number(height));
  if (!(short > 0)) return STEPS.hero;
  const fit = ((FLEET_FAR.maxVw * w) / short) / heroEms(word);
  return Math.round(Math.min(STEPS.hero, Math.max(STEPS.heroMin, fit)) * 10) / 10;
}

/**
 * The ambient fact under the fleet line: the size of what the Wall watches
 * and how much of it is at work, `5 sites · 114 nodes · 6 working`. Slow to
 * change on purpose. laneboard's own centre and repo index are not places in
 * the fleet, so they are not counted.
 */
export function ambientLine(model) {
  const list = nodesOf(model).filter((n) => n.kind !== 'core' && n.id !== '__repos');
  const sites = list.filter((n) => n.kind === 'site').length;
  const working = list.filter((n) => n.status === 'working').length;
  const parts = [];
  if (sites) parts.push(`${sites} ${sites === 1 ? 'site' : 'sites'}`);
  parts.push(`${list.length} ${list.length === 1 ? 'node' : 'nodes'}`);
  if (working) parts.push(`${working} working`);
  return parts.join(' · ');
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** The clock's words for a local time: `{ time: '07:05', date: 'mon 26 oct' }`, 24 h, no seconds. */
export function clockText(date) {
  const d = date instanceof Date ? date : new Date(date);
  return {
    time: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    date: `${DAYS[d.getDay()]} ${pad2(d.getDate())} ${MONTHS[d.getMonth()]}`,
  };
}

/** Ms from `now` to the start of the next minute (the clock's only tick). */
export const msToNextMinute = (now) => 60000 - (Math.floor(now) % 60000);

// --- the DOM part ------------------------------------------------------------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Write only when the words change, so a model a tick does not lay anything out. */
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };

/** The why may wrap between words, never at a hyphen inside one. */
function whyEl(text) {
  const why = el('span', 'wall-fleet-why');
  text.split(/(\s+)/).forEach((part) => {
    why.append(part.includes('-') ? el('span', 'wall-fleet-name', part) : document.createTextNode(part));
  });
  return why;
}

/**
 * The fleet line's words, as spans: the glyph, then site and name that never
 * break (a hyphen in `builder-c` is not a place to wrap), then the why, which
 * may wrap onto a second line between its words. Rebuilt only when the text changes.
 */
function setLine(line, w) {
  const key = `${w.step}|${w.glyph ?? ''}|${w.text}`;
  if (line.dataset.key === key) return;
  line.dataset.key = key;
  const kids = [];
  if (w.glyph) kids.push(el('span', 'wall-fleet-glyph', w.glyph));
  const head = [w.site, w.name].filter(Boolean);
  if (w.step === 'far') {
    // Where, only: the why goes on the row under it.
    kids.push(el('span', 'wall-fleet-name', w.word));
  } else if (!w.glyph) {
    kids.push(whyEl(w.text));
  } else {
    head.forEach((h, i) => {
      if (i) kids.push(document.createTextNode(' · '));
      kids.push(el('span', 'wall-fleet-name', h));
    });
    // The why is what is left of the (clipped) text after the names.
    const prefix = `${head.join(' · ')} · `;
    const why = w.text.startsWith(prefix) ? w.text.slice(prefix.length) : '';
    if (why) kids.push(document.createTextNode(' · '), whyEl(why));
  }
  line.textContent = '';
  line.append(...kids);
}

/**
 * The frame inside `root` (an empty element over the map). `update(model,
 * { cleared })` sets the lines from a model (and a crit that just cleared,
 * `clearedLine`), `live(on)` the tag's state (`fresh(f)` with
 * the galaxy's feed state instead, galaxy/fresh.js); the clock runs by
 * itself on `timers` and `now` (injectable). `stop()` ends the clock.
 * `plate(tone)` says whether a caption plate is up over the frame and in which
 * tone (`'crit'`, `'warn'`, `'grey'`; false when none; the galaxy's hud.js,
 * night 3 T4/T30): `data-plate` on `root`, and wall.css sets the far line at
 * the plate's name step under a crit plate only, so a trouble frame has one
 * headline and the worst thing stays the loudest.
 * `update(model, { echo: true })` says the line names the plate's own
 * subject (night 3 T20): `data-echo` on the line, and wall.css drops it
 * while the plate is up (`hushed()`, when it covers nothing). `echo: 'why'`
 * (night 4 T9, two crits named together, the held one the oldest) is
 * `data-echo="why"`: only the why under the word drops out, the count and the
 * places stay, so the line still covers its box.
 * `update(model, { since })` orders two or more crits oldest first (T8,
 * `worstLine`); without it they keep model order.
 */
export function createFrame(root, { timers = globalThis, now = () => Date.now() } = {}) {
  const vignette = el('div', 'wall-vignette');
  const tag = el('div', 'wall-tag');
  const tagName = el('span', 'wall-tag-name', 'laneboard');
  const tagLive = el('span', 'wall-tag-live');
  // What the address asked for and did not get (`note(text)`, night 4 T45); empty: hidden.
  const tagNote = el('span', 'wall-tag-note');
  tag.append(tagName, tagNote, tagLive);

  const clock = el('div', 'wall-clock');
  const time = el('div', 'wall-clock-time');
  const date = el('div', 'wall-clock-date');
  clock.append(time, date);

  const fleet = el('div', 'wall-fleet');
  const line = el('div', 'wall-fleet-line');
  // The far step's why and count, one row under the word; hidden otherwise.
  const sub = el('div', 'wall-fleet-sub');
  const subWhy = el('span', 'wall-fleet-sub-why');
  const subMore = el('span', 'wall-fleet-more');
  sub.append(subWhy, subMore);
  const fact = el('div', 'wall-fleet-fact');
  const more = el('span', 'wall-fleet-more');
  const ambient = el('span', 'wall-fleet-ambient');
  fact.append(more, ambient);
  fleet.append(line, sub, fact);

  root.append(vignette, tag, clock, fleet);
  let tagBox = null; // the tag's cover while it has a note (tagCover), read again when its text changes

  let timer = null;
  const tick = () => {
    const c = clockText(now());
    put(time, c.time);
    put(date, c.date);
    timer = timers.setTimeout(tick, msToNextMinute(now()) + 50);
  };
  tick();

  // The far block stands on an opaque ground over the map's bottom ring: a
  // Map cover (T24), its box read again only after the words changed.
  let farBox = null;
  let farDirty = false;

  const update = (model, { cleared = null, echo = false, since = null } = {}) => {
    if (!model || typeof model !== 'object') return;
    // The line names what the plate's hero names (night 3 T20): wall.css drops it while a plate is up.
    const echoed = echo === 'why' ? 'why' : echo ? '' : null;
    if ((fleet.dataset.echo ?? null) !== echoed) {
      if (echoed != null) fleet.dataset.echo = echoed;
      else delete fleet.dataset.echo;
      farDirty = true;
    }
    let w = worstLine(model, { since });
    // A crit that just cleared (T18): remembered in the calm voice, and only while nothing else is in trouble.
    if (w.step === 'calm') w = clearedLine(model, cleared) ?? w;
    const far = w.step === 'far';
    const was = `${fleet.dataset.step}|${line.dataset.key ?? ''}|${subWhy.textContent}|${subMore.textContent}`;
    fleet.dataset.tone = w.tone;
    fleet.dataset.step = w.step;
    if (w.was) fleet.dataset.was = w.was;
    else delete fleet.dataset.was;
    setLine(line, w);
    // The node the line names (night 4 T2: a finger on it opens it); none at "all calm".
    if (typeof w.id === 'string') fleet.dataset.subject = w.id;
    else delete fleet.dataset.subject;
    if (far) {
      const size = `${fleetSize(w.word, root.clientWidth, root.clientHeight)}vmin`;
      if (line.dataset.size !== size) { line.dataset.size = size; line.style.setProperty('--fleet-far', size); }
    }
    const count = w.more ? `+${w.more} more` : '';
    // Far: the count rides with the why, and the ambient fact gives way (one
    // hero in the band, and the band no taller than it must be).
    put(subWhy, far ? clip(w.why, MAX_LINE) : '');
    put(subMore, far ? count : '');
    subMore.hidden = !(far && w.more);
    sub.hidden = !far;
    put(more, far ? '' : count);
    more.hidden = far || !w.more;
    put(ambient, far ? '' : ambientLine(model));
    fact.hidden = far;
    if (`${fleet.dataset.step}|${line.dataset.key ?? ''}|${subWhy.textContent}|${subMore.textContent}` !== was) farDirty = true;
    if (typeof model.title === 'string' && model.title.trim()) {
      const named = tagName.textContent;
      put(tagName, `laneboard · ${clip(model.title, 24)}`);
      if (tagName.textContent !== named) tagBox = null;
    }
  };

  const live = (on) => {
    tag.dataset.live = on ? '1' : '0';
    put(tagLive, on ? 'live' : 'offline');
  };

  // The galaxy's feed state (galaxy/fresh.js, night 3 T5): `STALE 2M` in the
  // tag, grey; a closed socket keeps the offline hue.
  const fresh = (f) => {
    if (!f || typeof f.text !== 'string') return;
    tag.dataset.live = f.state === 'live' ? '1' : f.state === 'stale' ? 'stale' : '0';
    put(tagLive, f.text.toLowerCase());
  };

  /** The tag's note (an unknown `?variant=`, T45), grey, on a line of its own; null or '' clears it. */
  const note = (text) => {
    put(tagNote, typeof text === 'string' ? text.toLowerCase() : '');
    tagBox = null;
  };
  /** The tag and the note under it as a Map cover while there is a note, else null (read once per note). */
  const tagCover = () => {
    if (!tagNote.textContent) return null;
    if (!tagBox) {
      const left = tag.offsetLeft + Math.min(0, tagNote.offsetLeft);
      const right = tag.offsetLeft + Math.max(tag.offsetWidth, tagNote.offsetLeft + tagNote.offsetWidth);
      tagBox = coverOf({ left, top: tag.offsetTop, width: right - left, height: Math.max(tag.offsetHeight, tagNote.offsetTop + tagNote.offsetHeight) });
    }
    return tagBox;
  };

  const stop = () => { if (timer != null) timers.clearTimeout(timer); timer = null; };

  /** Whether the line is dropped (an echo under a plate, T20): it covers nothing then. */
  const hushed = () => 'plate' in root.dataset && fleet.dataset.echo === '';

  /** The far block as a Map cover while the fleet line is at the far step, else null. */
  const cover = () => {
    if (fleet.dataset.step !== 'far' || hushed()) return null;
    if (farDirty || !farBox) {
      farDirty = false;
      farBox = coverOf({ left: fleet.offsetLeft, top: fleet.offsetTop, width: fleet.offsetWidth, height: fleet.offsetHeight });
    }
    return farBox;
  };

  // The far line changes size with the plate's tone (wall.css), so its box is read again.
  const plate = (tone) => {
    const t = tone ? (typeof tone === 'string' ? tone : 'grey') : null;
    if ((root.dataset.plate ?? null) === t) return;
    if (t) root.dataset.plate = t;
    else delete root.dataset.plate;
    farDirty = true;
  };

  return { update, live, fresh, note, tagCover, stop, cover, plate, hushed, el: { vignette, tag, tagNote, clock, fleet, more, subMore } };
}
