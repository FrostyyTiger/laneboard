// The show commands, the state (Wall plan night 4 T37, README D10, §7 Night 4
// B; research Q16): the cockpit agent's `flyTo(node)`, `highlight(nodes,
// note)`, `pin(node, card)` and `clear()` as page commands. Each one is
// display-only (it moves the camera or adds marks and words, never the
// fleet), each says on screen who showed it, and each is undone by one tap on
// its `✕` (a 48 px target, night 1's Q6 floor).
//
// The message is Q16's envelope, one JSON-clonable object:
//   { v: 1, ch: 'laneboard.show', id, src, type, ttl?, data }
//   flyTo     data: { node }
//   highlight data: { nodes: [...], note? }
//   pin       data: { node, card: { title?, text } }
//   clear     data: { id? }            one command, or everything shown
// `ttl` is seconds (default 60, at most 600, 0 = until undone); words are plain
// text (textContent, never HTML), at most SHOW.maxText characters. The reply,
// for the sender (T38 carries it back): `{ v: 1, ch, re: id, ok, code? }`,
// codes `bad-shape`, `unknown-node`, `busy`.
//
// Decided (T37's notes):
// - A finger has the screen: every command but `clear` is refused `busy`, not
//   only `flyTo` (the director's rule, T13): nothing appears under a person's
//   hands out of nowhere. A first touch ends everything shown (`drop`), as it
//   drops the director's show: the person starts from a clean galaxy.
// - One of each at a time: a newer `flyTo` replaces the older (the director's
//   "last wins"), a newer `highlight` the older, a `pin` on a node replaces the
//   pin there; at most SHOW.pins pins, the oldest goes.
// - A `flyTo` lasts as long as the director holds its camera (min(ttl, a
//   minute), director.js IDLE), so the line never names a place the camera
//   has left. Marks and cards last their own ttl.
// - On screen: one head line `SHOWN BY <src>` (the tag's face; the source's
//   name after its `agent:` prefix) and one row per command under it, each
//   with its `✕`; the seconds left only in the last SHOW.lastS. A highlight's
//   note and a pin's card are drawn next to their node (`cards`), where the
//   eye already is, not in the row: a 140-character note does not fit a
//   corner line and is not read there from 3 m.
//
// `readShow`, `showStep`, `showLines`, `showMarks` are pure on an injected
// clock (test/wall-galaxy-show.test.mjs); `createShow` is the page's part.

import { IDLE } from './director.js';

/**
 * The limits (Q16): `ttlS` the default seconds, `maxTtlS` the most, `maxNodes`
 * a highlight's nodes, `maxText` a note's or a card's characters, `maxTitle` a
 * card's title, `maxId` an id's or a source's, `seen` ids kept to drop
 * repeats (BroadcastChannel reaches every tab), `pins` at once, `lastS` the
 * seconds a row counts down, `xPx` the `✕` target's side (css px).
 */
export const SHOW = Object.freeze({
  v: 1, ch: 'laneboard.show', ttlS: 60, maxTtlS: 600, maxNodes: 16, maxText: 140, maxTitle: 40, maxId: 64,
  seen: 64, pins: 2, lastS: 10, xPx: 48,
});

export const SHOW_TYPES = Object.freeze(['flyTo', 'highlight', 'pin', 'clear']);

/** An empty show: nothing on screen, no ids seen. */
export const initialShow = () => ({ items: [], seen: [] });

const str = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
// One line of plain text: runs of white space (new lines too) are one space.
const line = (v) => String(v).replace(/\s+/g, ' ').trim();

/**
 * A message checked against Q16's envelope: `{ ok: true, cmd }` with `cmd`
 * `{ id, src, type, ttlMs, data }` (`ttlMs` null = until undone; words on one
 * line), or `{ ok: false, code: 'bad-shape', id }` (`id` when it had one, for
 * the reply), or `{ ok: false, code: null }` for a message on another channel
 * or version (not ours: no reply). Unknown fields are ignored. Pure.
 */
export function readShow(msg) {
  if (!msg || typeof msg !== 'object' || msg.ch !== SHOW.ch || msg.v !== SHOW.v) return { ok: false, code: null, id: null };
  const id = str(msg.id, SHOW.maxId) ? msg.id : null;
  const bad = { ok: false, code: 'bad-shape', id };
  if (!id || !SHOW_TYPES.includes(msg.type)) return bad;
  if (msg.src != null && !str(msg.src, SHOW.maxId)) return bad;
  if (msg.ttl != null && !(Number.isFinite(msg.ttl) && msg.ttl >= 0)) return bad;
  const d = msg.data && typeof msg.data === 'object' ? msg.data : {};
  const ttl = msg.ttl == null ? SHOW.ttlS : Math.min(SHOW.maxTtlS, msg.ttl);
  const cmd = { id, src: line(msg.src ?? 'agent'), type: msg.type, ttlMs: ttl === 0 ? null : ttl * 1000 };
  const text = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
  if (msg.type === 'flyTo') {
    if (!str(d.node, SHOW.maxId)) return bad;
    return { ok: true, cmd: { ...cmd, data: { node: d.node } } };
  }
  if (msg.type === 'highlight') {
    const nodes = Array.isArray(d.nodes) ? d.nodes : null;
    if (!nodes?.length || nodes.length > SHOW.maxNodes || !nodes.every((n) => str(n, SHOW.maxId))) return bad;
    if (!text(d.note, SHOW.maxText)) return bad;
    const note = d.note ? line(d.note) : '';
    return { ok: true, cmd: { ...cmd, data: { nodes: [...new Set(nodes)], ...(note ? { note } : {}) } } };
  }
  if (msg.type === 'pin') {
    const c = d.card && typeof d.card === 'object' ? d.card : null;
    if (!str(d.node, SHOW.maxId) || !c || !str(c.text, SHOW.maxText) || !text(c.title, SHOW.maxTitle)) return bad;
    const title = c.title ? line(c.title) : '';
    return { ok: true, cmd: { ...cmd, data: { node: d.node, card: { ...(title ? { title } : {}), text: line(c.text) } } } };
  }
  if (d.id != null && !str(d.id, SHOW.maxId)) return bad;
  return { ok: true, cmd: { ...cmd, data: d.id != null ? { id: d.id } : {} } };
}

const reply = (id, ok, code) => (id == null ? null : { v: SHOW.v, ch: SHOW.ch, re: id, ok, ...(code ? { code } : {}) });
const out = (state, extra = {}) => ({ state, reply: null, fly: null, ended: [], ...extra });
const ending = (state, ids) => {
  const gone = new Set(ids);
  return { ...state, items: state.items.filter((it) => !gone.has(it.id)) };
};

/**
 * The next show after `event` at `now` (ms). `state` is `{ items, seen }`,
 * each item `{ id, src, type, data, at, until }` (`until` null: until undone).
 * Events:
 * - `{ type: 'msg', msg }`: a message from a sender (readShow checks it).
 * - `{ type: 'undo', id }`: a tap on that command's `✕`.
 * - `{ type: 'drop' }`: a finger took the page: everything goes.
 * - `{ type: 'tick' }`: time passed; commands past their `until` go.
 * Options: `busy`, a finger has the page (every command but `clear` is
 * refused); `known(node)`, whether the galaxy draws that node (unknown:
 * `unknown-node`; a highlight keeps the nodes it knows); `holdMs`, the longest
 * a `flyTo` holds the camera (the director's minute).
 * Returns `{ state, reply, fly, ended }`: `reply` the answer to a message (null
 * for a repeat or another channel's), `fly` the new `flyTo` item the director
 * is to play, `ended` the ids that left the screen (a `flyTo` among them is the
 * director's to clear). Pure.
 */
export function showStep(state, event, now, opts = {}) {
  const o = { busy: false, known: () => true, holdMs: IDLE.ms, ...opts };
  const s = state?.items ? state : initialShow();
  const type = event?.type;

  if (type === 'undo') {
    const hit = s.items.some((it) => it.id === event.id);
    return hit ? out(ending(s, [event.id]), { ended: [event.id] }) : out(s);
  }
  if (type === 'drop') return out({ ...s, items: [] }, { ended: s.items.map((it) => it.id) });
  if (type !== 'msg') {
    const due = s.items.filter((it) => it.until != null && now >= it.until).map((it) => it.id);
    return due.length ? out(ending(s, due), { ended: due }) : out(s);
  }

  const r = readShow(event.msg);
  if (!r.ok) return out(s, { reply: reply(r.id, false, r.code) });
  const { cmd } = r;
  // A repeat (another tab, a retry) is not shown twice and not answered twice.
  if (s.seen.includes(cmd.id)) return out(s);
  const seen = [...s.seen, cmd.id].slice(-SHOW.seen);
  const said = { ...s, seen };

  if (cmd.type === 'clear') {
    const ids = s.items.filter((it) => cmd.data.id == null || it.id === cmd.data.id).map((it) => it.id);
    return out(ending(said, ids), { reply: reply(cmd.id, true), ended: ids });
  }
  if (o.busy) return out(said, { reply: reply(cmd.id, false, 'busy') });

  let data = cmd.data;
  if (cmd.type === 'highlight') {
    const nodes = data.nodes.filter((n) => o.known(n));
    if (!nodes.length) return out(said, { reply: reply(cmd.id, false, 'unknown-node') });
    data = { ...data, nodes };
  } else if (!o.known(data.node)) return out(said, { reply: reply(cmd.id, false, 'unknown-node') });

  const life = cmd.type === 'flyTo' ? Math.min(cmd.ttlMs ?? Infinity, o.holdMs) : cmd.ttlMs;
  const item = { id: cmd.id, src: cmd.src, type: cmd.type, data, at: now, until: life == null ? null : now + life };
  // One of each: the newer flyTo or highlight replaces the older; a pin replaces the pin on its node.
  const old = s.items.filter((it) => (cmd.type === 'pin' ? it.type === 'pin' && it.data.node === data.node : it.type === cmd.type));
  let items = [...s.items.filter((it) => !old.includes(it)), item];
  const pins = items.filter((it) => it.type === 'pin');
  const over = pins.slice(0, Math.max(0, pins.length - SHOW.pins));
  items = items.filter((it) => !over.includes(it));
  const ended = [...old, ...over].map((it) => it.id);
  return out({ ...said, items }, { reply: reply(cmd.id, true), fly: cmd.type === 'flyTo' ? item : null, ended });
}

/** `agent:builder-a` → `builder-a`: the name after the kind. */
export const sourceName = (src) => String(src ?? '').replace(/^[a-z]+:/i, '') || 'agent';

/**
 * The words on screen at `now`: `{ head, rows }` or null when nothing is
 * shown. `head` is `shown by <name>` (`+n` when more than one source shows);
 * each row `{ id, text }`, newest first: `flyTo` names the place, a highlight
 * counts its marks, a pin names its node; the seconds left (`0:08`) only in
 * the last SHOW.lastS. `labelOf(node)` gives a node's name. Lower case: the
 * stylesheet sets the tag's caps. Pure.
 */
export function showLines(state, now, labels) {
  const labelOf = typeof labels === 'function' ? labels : (id) => id;
  const items = state?.items ?? [];
  if (!items.length) return null;
  const names = [...new Set(items.map((it) => sourceName(it.src)))];
  const head = `shown by ${names.at(-1)}${names.length > 1 ? ` +${names.length - 1}` : ''}`;
  const name = (id) => String(labelOf(id) ?? id);
  const rows = [...items].reverse().map((it) => {
    let text;
    if (it.type === 'flyTo') text = `at ${name(it.data.node)}`;
    else if (it.type === 'highlight') text = `${it.data.nodes.length} marked`;
    else text = `note on ${name(it.data.node)}`;
    const left = it.until == null ? null : Math.max(0, Math.ceil((it.until - now) / 1000));
    if (left != null && left <= SHOW.lastS) text += ` · 0:${String(left).padStart(2, '0')}`;
    return { id: it.id, text };
  });
  return { head, rows };
}

/**
 * What is drawn on the galaxy: `rings`, the highlighted nodes (each once,
 * newest command's), and `cards`, `{ id, node, title, text }` next to a node:
 * a pin's card, and a highlight's note at its first node. Pure.
 */
export function showMarks(state) {
  const rings = [], cards = [];
  for (const it of state?.items ?? []) {
    if (it.type === 'highlight') {
      for (const n of it.data.nodes) if (!rings.includes(n)) rings.push(n);
      if (it.data.note) cards.push({ id: it.id, node: it.data.nodes[0], title: '', text: it.data.note });
    } else if (it.type === 'pin') cards.push({ id: it.id, node: it.data.node, title: it.data.card.title ?? '', text: it.data.card.text });
  }
  return { rings, cards };
}

/**
 * Where a card stands for a node drawn at `at` (`{ x, y, r }`, css px) on a
 * `W`×`H` stage: right of the node by its radius and `gapPx`, or left of it
 * when it would leave the stage there; its middle on the node's height, kept
 * `marginPx` inside the stage. `w`, `h` the card's size. `above`, the boxes of
 * cards placed before it: it steps below each it would cover (a pin and a
 * note on one node read as a stack, not one card over the other). Returns
 * `{ x, y, side }` (its top left). Pure.
 */
export function cardPlace(at, w, h, { W, H, gapPx = 20, marginPx = 16, stackPx = 8, above = [] } = {}) {
  const off = (at.r ?? 0) + gapPx;
  let side = 'right';
  let x = at.x + off;
  if (x + w > W - marginPx && at.x - off - w >= marginPx) { side = 'left'; x = at.x - off - w; }
  x = Math.max(marginPx, Math.min(W - marginPx - w, x));
  let y = Math.max(marginPx, Math.min(H - marginPx - h, at.y - h / 2));
  const hits = (b) => x < b.right && x + w > b.left && y < b.bottom + stackPx && y + h + stackPx > b.top;
  for (let i = 0; i < above.length; i++) {
    const b = above.find(hits);
    if (!b) break;
    y = b.bottom + stackPx;
  }
  return { x, y, side };
}

/**
 * The page's show (T37): `createShow({ block, marks, director, clock,
 * busy, labelOf, siteOf, screenOf, size, doc })`. `block` holds the head line
 * and the rows with their `✕`; `marks` the rings and cards over the galaxy;
 * `director` director.js's (a `flyTo` is its `show`, an undo its `clear`);
 * `busy()` a finger has the page; `labelOf(node)` a node's name or null when
 * the galaxy does not draw it; `siteOf(node)` the site to fly to (null: the
 * overview); `screenOf(node)` where it is drawn now; `size()` the stage.
 * Returns `{ send(msg) → reply, undo(id), drop(), tick(), draw(), state(),
 * covers() }`: `tick()` once a frame (the commands' time runs out; the rows'
 * words change once a second at most), `draw()` after each frame (camera.js
 * `onDraw`: the rings and cards follow their nodes).
 */
export function createShow(opts = {}) {
  const o = {
    clock: () => performance.now(), busy: () => false, labelOf: (id) => id, siteOf: () => null,
    screenOf: () => null, size: () => ({ W: 0, H: 0 }), doc: globalThis.document, ...opts,
  };
  const { block, marks, director } = o;
  let state = initialShow();
  let said = null; // the words written last, as one key
  let drawnKey = null; // the marks built last
  let rings = new Map(), cards = new Map();

  const el = (tag, cls, text) => {
    const e = o.doc.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  // The ✕ never reaches the stage: it is not a first touch (which would drop everything) nor a tap on the sky.
  const keep = (ev) => ev.stopPropagation?.();
  const press = (id) => (ev) => {
    ev.preventDefault?.();
    ev.stopPropagation?.();
    undo(id);
  };

  const write = () => {
    const now = o.clock();
    const lines = showLines(state, now, o.labelOf);
    const key = lines ? JSON.stringify(lines) : '';
    if (key === said) return;
    said = key;
    block.hidden = !lines;
    if (!lines) { block.replaceChildren(); return; }
    const rows = lines.rows.map((r) => {
      const row = el('div', 'galaxy-show-row');
      row.dataset.id = r.id;
      const x = el('button', 'galaxy-show-x', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', `undo: ${r.text}`);
      for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) x.addEventListener(t, keep);
      x.addEventListener('click', press(r.id));
      row.append(el('span', 'galaxy-show-what', r.text), x);
      return row;
    });
    block.replaceChildren(el('div', 'galaxy-show-head', lines.head), ...rows);
  };

  const build = () => {
    const m = showMarks(state);
    const key = JSON.stringify(m);
    if (key === drawnKey) return;
    drawnKey = key;
    rings = new Map(m.rings.map((n) => [n, rings.get(n) ?? el('div', 'galaxy-show-ring')]));
    const next = new Map();
    for (const c of m.cards) {
      const card = el('div', 'galaxy-show-card');
      if (c.title) card.append(el('div', 'galaxy-show-card-title', c.title));
      card.append(el('div', 'galaxy-show-card-text', c.text));
      next.set(c.id, { ...c, el: card, w: 0, h: 0 });
    }
    cards = next;
    marks.replaceChildren(...rings.values(), ...[...cards.values()].map((c) => c.el));
    marks.hidden = !rings.size && !cards.size;
    for (const c of cards.values()) { c.w = c.el.offsetWidth ?? 0; c.h = c.el.offsetHeight ?? 0; }
    draw();
  };

  const apply = (r) => {
    state = r.state;
    // The director plays a flyTo (it refuses it under a finger); an ended flyTo is its to clear,
    // unless a newer one takes the camera now (a clear first would hand it to the tour between the two).
    if (!r.fly) for (const id of r.ended) director?.clear(id);
    if (r.fly) {
      const site = o.siteOf(r.fly.data.node);
      const d = director?.show({ id: r.fly.id, to: site ? { kind: 'site', id: site } : { kind: 'overview' }, holdMs: r.fly.until - r.fly.at });
      if (d?.refused) {
        state = showStep(state, { type: 'undo', id: r.fly.id }, o.clock()).state;
        r = { ...r, reply: { ...r.reply, ok: false, code: d.refused } };
      }
    }
    write();
    build();
    return r;
  };
  const step = (event) => apply(showStep(state, event, o.clock(), {
    busy: o.busy(), known: (n) => o.labelOf(n) != null,
  }));

  const undo = (id) => { step({ type: 'undo', id }); };
  const draw = () => {
    if (!rings.size && !cards.size) return;
    for (const [n, ring] of rings) {
      const at = o.screenOf(n);
      ring.hidden = !at;
      if (!at) continue;
      // Round the node with room for its glow: never smaller than a fingertip's mark.
      // Its size is written only when it changes by a pixel (a size is layout; the place is a transform).
      const d = Math.round(Math.max(36, 2 * (at.r ?? 0) + 20));
      if (ring.dataset.d !== String(d)) {
        ring.dataset.d = String(d);
        ring.style.width = ring.style.height = `${d}px`;
      }
      ring.style.transform = `translate3d(${(at.x - d / 2).toFixed(1)}px, ${(at.y - d / 2).toFixed(1)}px, 0)`;
    }
    const { W, H } = o.size();
    const placed = [];
    for (const c of cards.values()) {
      const at = o.screenOf(c.node);
      c.el.hidden = !at;
      if (!at) continue;
      const p = cardPlace(at, c.w, c.h, { W, H, above: placed });
      placed.push({ left: p.x, top: p.y, right: p.x + c.w, bottom: p.y + c.h });
      c.el.dataset.side = p.side;
      c.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
      c.box = { left: p.x, top: p.y, right: p.x + c.w, bottom: p.y + c.h };
    }
  };

  write(); // nothing shown yet: the line and the marks hidden
  build();
  return {
    send: (msg) => step({ type: 'msg', msg }).reply,
    undo,
    drop: () => { if (state.items.length) step({ type: 'drop' }); },
    tick: () => {
      if (!state.items.length) return;
      step({ type: 'tick' });
    },
    draw,
    state: () => state,
    // The cards' boxes, for the names to keep off (labels.js covers).
    covers: () => [...cards.values()].filter((c) => c.box && !c.el.hidden).map((c) => c.box),
  };
}
