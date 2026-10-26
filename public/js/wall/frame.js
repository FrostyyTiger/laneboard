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
import { GLYPH } from './caption.js';

/** The fleet line is cut with an ellipsis past this: two lines at most, so it never runs into the clock. */
export const MAX_LINE = 64;

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
 * The worst problem in the fleet, for the line bottom right. A problem is a
 * node at warn or worse whose parent is not (a lane waiting on a prompt and
 * its session waiting with it are one problem); it is as bad as the worst
 * node in it, and that node speaks for it. Worst first: down, crit,
 * attention, warn; a tie keeps model order. Returns
 *   `{ status, tone, shape, glyph, site, name, why, text, more }`
 * with `text` = `site · name · why` (the parts it has), `more` the number of
 * other problems; a calm fleet gives `{ status: 'ok', tone: 'grey', text:
 * 'all calm', more: 0 }` and no glyph.
 */
export function worstLine(model) {
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
    if (!p) problems.set(root.id, { worst: n });
    else if (rank(n.status) > rank(p.worst.status)) p.worst = n;
  }
  if (!problems.size) return { status: 'ok', tone: 'grey', text: 'all calm', more: 0 };

  let worst = null;
  for (const p of problems.values()) {
    if (!worst || rank(p.worst.status) > rank(worst.status)) worst = p.worst;
  }
  const st = statusStyle(worst);
  const site = siteOf(worst, byId);
  const siteName = site && site !== worst ? String(site.label ?? site.id) : null;
  const name = String(worst.label ?? worst.id);
  const why = typeof worst.why === 'string' && worst.why.trim() ? worst.why : worst.status;
  return {
    status: worst.status,
    tone: st.tone,
    shape: st.shape,
    glyph: GLYPH[st.shape] ?? GLYPH.square,
    site: siteName,
    name,
    why,
    text: clip([siteName, name, why].filter(Boolean).join(' · ')),
    more: problems.size - 1,
  };
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
  const key = `${w.glyph ?? ''}|${w.text}`;
  if (line.dataset.key === key) return;
  line.dataset.key = key;
  const kids = [];
  if (w.glyph) kids.push(el('span', 'wall-fleet-glyph', w.glyph));
  const head = [w.site, w.name].filter(Boolean);
  if (!w.glyph) {
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
 * The frame inside `root` (an empty element over the map). `update(model)`
 * sets the lines from a model, `live(on)` the tag's state; the clock runs by
 * itself on `timers` and `now` (injectable). `stop()` ends the clock.
 */
export function createFrame(root, { timers = globalThis, now = () => Date.now() } = {}) {
  const vignette = el('div', 'wall-vignette');
  const tag = el('div', 'wall-tag');
  const tagName = el('span', 'wall-tag-name', 'laneboard');
  const tagLive = el('span', 'wall-tag-live');
  tag.append(tagName, tagLive);

  const clock = el('div', 'wall-clock');
  const time = el('div', 'wall-clock-time');
  const date = el('div', 'wall-clock-date');
  clock.append(time, date);

  const fleet = el('div', 'wall-fleet');
  const line = el('div', 'wall-fleet-line');
  const fact = el('div', 'wall-fleet-fact');
  const more = el('span', 'wall-fleet-more');
  const ambient = el('span', 'wall-fleet-ambient');
  fact.append(more, ambient);
  fleet.append(line, fact);

  root.append(vignette, tag, clock, fleet);

  let timer = null;
  const tick = () => {
    const c = clockText(now());
    put(time, c.time);
    put(date, c.date);
    timer = timers.setTimeout(tick, msToNextMinute(now()) + 50);
  };
  tick();

  const update = (model) => {
    if (!model || typeof model !== 'object') return;
    const w = worstLine(model);
    fleet.dataset.tone = w.tone;
    setLine(line, w);
    put(more, w.more ? `+${w.more} more` : '');
    more.hidden = !w.more;
    put(ambient, ambientLine(model));
    if (typeof model.title === 'string' && model.title.trim()) put(tagName, `laneboard · ${clip(model.title, 24)}`);
  };

  const live = (on) => {
    tag.dataset.live = on ? '1' : '0';
    put(tagLive, on ? 'live' : 'offline');
  };

  const stop = () => { if (timer != null) timers.clearTimeout(timer); timer = null; };

  return { update, live, stop, el: { vignette, tag, clock, fleet } };
}
