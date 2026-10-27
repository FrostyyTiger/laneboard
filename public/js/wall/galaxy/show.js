// The show commands on the Wall (Wall plan night 4 T37; aligned with the
// cockpit spec on 2026-10-27: docs/plans/cockpit/spec/c4-show-canvas.md §2-§4,
// protocols.md §4, D68-D73). The cockpit's agent points at things on the
// galaxy; every command is display-only (it moves the camera or draws marks
// and words, never the fleet), and the page only ever answers.
//
// In (room → screen, protocols.md §4):
//   { type: 'show', showId, turnId, cmd, args, receivedAt }
//     fly_to     { node }                       the camera to the node
//     highlight  { nodes: [1-12], note? }       brackets, the rest dimmed, a note plate
//     pin        { node, card: { block: 'text', title?, body } }   a card beside the node
//     clear      {}                             the marks and the note go; pins stay
//     compare, scrub: not built on the Wall (skipped, why `unsupported`)
//   { type: 'show.undo', showId }               undo that command (D71)
//   { type: 'pin.put', pin, replaced? }, { type: 'pin.remove', pin }   the room's shared pins
// Out (screen → room):
//   { type: 'show.result', seq, showId, state, why? }   `shown`, `waiting`, `skipped`
//   { type: 'pin.close', seq, pin }                     a pin's ✕
//
// The rules (the spec's; where it is silent, the simplest thing, marked *):
// - The owner's finger wins (D70): `fly_to` and `highlight` (the camera
//   commands) arriving while a finger is on the galaxy, or within 3 s after
//   the last touch ended, answer `waiting`; the command runs 3 s after the
//   lift (a second `show.result` `shown`) or, still blocked 10 s after it
//   came, is dropped (`skipped`, why `in use`). `pin` and `clear` move no
//   camera and run at once*. A newer camera command replaces a waiting one,
//   which is answered `skipped` `in use`*. A touch on a pin is not a touch.
// - A newer flight replaces one mid-flight, from where the camera is, and
//   takes over its saved state (undo goes back to before both). One
//   highlight at a time: a new one replaces marks and note.
// - Limits (D72, D73): at most 12 nodes (more: the first 12*), a note of 120
//   characters, a pin's title 48 and body 280, cut with `…`; 3 pins, a 4th
//   replaces the oldest. Words are text (`textContent`), never markup.
// - Undo (D71, c4 §5): `show.undo` restores what the screen saved just before
//   the latest camera command (camera, marks, note, tour or explore): back to
//   the tour at once if it was touring, else the camera by a normal flight.
//   Only the latest camera command is undoable; the tour coming back drops
//   the highlight, the note and the undo. A pin's undo removes that pin.
// - A node this galaxy does not draw: `fly_to` and `highlight` answer
//   `skipped` why `not drawn`*; a bad shape `skipped` why `bad-args`*.
// - Looks (D72): four 2 px `--accent` corner brackets per node, 12 px arms, 8
//   px outside its drawn radius, closing in from 24 px over 300 ms; every
//   other node dimmed to `UNLIT` 0.16 (a veil over the scene and the names
//   with a hole at each marked node*); the note on a plate `AGENT · HH:MM`;
//   a pin 320 px wide with its `AGENT · HH:MM` header and a 48 px `✕`.
//
// `readShow`, `showStep` and the placements are pure on an injected clock
// (test/wall-galaxy-show.test.mjs); `createShow` is the page's part and
// `createFingerWatch` its finger rule's ears.

/** The numbers (css px and ms; the spec's at 1368x912). */
export const SHOW = Object.freeze({
  maxNodes: 12, maxNote: 120, maxTitle: 48, maxBody: 280, pins: 3, maxId: 64, seen: 64,
  waitMs: 3000, giveUpMs: 10000, unlit: 0.16, fadeMs: 300, zoom: 1.9, padPx: 64,
  closeMs: 300, closeFromPx: 24, outPx: 8, armPx: 12,
  noteGapPx: 16, noteW: 360, pinW: 320, pinH: 240, pinGapPx: 48, edgePx: 16, stackPx: 8, xPx: 48,
  results: 20,
});

/** The commands the Wall draws, and those it answers `unsupported` (c4 §3.5, §3.6: later). */
export const SHOW_CMDS = Object.freeze(['fly_to', 'highlight', 'pin', 'clear']);
export const SHOW_LATER = Object.freeze(['compare', 'scrub']);
/** The commands that move the camera, so wait for the owner's finger (D70). */
export const CAMERA_CMDS = Object.freeze(['fly_to', 'highlight']);
/** `show.result`'s states (protocols.md §4; `noCamera` is a screen without a map: never the Wall). */
export const RESULT_STATES = Object.freeze(['shown', 'waiting', 'skipped']);
/** `skipped`'s whys: the spec's `in use`, and the Wall's own for what the room should never send. */
export const WHY = Object.freeze({ inUse: 'in use', unsupported: 'unsupported', badArgs: 'bad-args', notDrawn: 'not drawn' });
/** What the page takes in. */
export const INBOUND = Object.freeze(['show', 'show.undo', 'pin.put', 'pin.remove']);

const str = (v, max = SHOW.maxId) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
/** Text as one run of words, cut to `max` characters with `…`. Pure. */
export function cutText(v, max) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
/** `HH:MM` of an epoch time, local (the plates' `AGENT · 07:12`). Pure. */
export function clockText(ms) {
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * A `show` message read: null when it is not one; `{ ok: false, showId, why }`
 * when it cannot be shown (no `showId`: nothing to answer); else `{ ok: true,
 * showId, turnId, cmd, args, receivedAt }` with the args cut to the limits.
 * Unknown fields are ignored. Pure.
 */
export function readShow(msg) {
  if (!msg || typeof msg !== 'object' || msg.type !== 'show') return null;
  const showId = str(msg.showId) ? msg.showId : null;
  const fail = (why) => ({ ok: false, showId, why });
  if (!showId) return fail(WHY.badArgs);
  if (!SHOW_CMDS.includes(msg.cmd)) return fail(WHY.unsupported);
  const a = msg.args && typeof msg.args === 'object' ? msg.args : {};
  const ok = (args) => ({
    ok: true, showId, turnId: typeof msg.turnId === 'string' ? msg.turnId : null, cmd: msg.cmd, args,
    receivedAt: Number.isFinite(msg.receivedAt) ? msg.receivedAt : null,
  });
  if (msg.cmd === 'fly_to') return str(a.node) ? ok({ node: a.node }) : fail(WHY.badArgs);
  if (msg.cmd === 'highlight') {
    const nodes = Array.isArray(a.nodes) ? a.nodes : [];
    if (!nodes.length || !nodes.every((n) => str(n))) return fail(WHY.badArgs);
    if (a.note != null && typeof a.note !== 'string') return fail(WHY.badArgs);
    const note = a.note ? cutText(a.note, SHOW.maxNote) : '';
    return ok({ nodes: [...new Set(nodes)].slice(0, SHOW.maxNodes), ...(note ? { note } : {}) });
  }
  if (msg.cmd === 'pin') {
    const c = a.card && typeof a.card === 'object' ? a.card : null;
    if (!str(a.node) || !c) return fail(WHY.badArgs);
    // chart, log and diff are kit blocks (c4 §8), not built on the Wall.
    if ((c.block ?? 'text') !== 'text') return fail(WHY.unsupported);
    if ((c.title != null && typeof c.title !== 'string') || (c.body != null && typeof c.body !== 'string')) return fail(WHY.badArgs);
    const title = cutText(c.title ?? '', SHOW.maxTitle), body = cutText(c.body ?? '', SHOW.maxBody);
    if (!title && !body) return fail(WHY.badArgs);
    return ok({ node: a.node, card: { block: 'text', title, body } });
  }
  return ok({});
}

/** Nothing shown, nothing waiting. */
export const initialShow = () => ({ highlight: null, pins: [], undo: null, waiting: null, seen: [] });

const result = (showId, state, why) => ({ type: 'show.result', showId, state, ...(why ? { why } : {}) });
const none = (state, extra = {}) => ({ state, out: [], act: null, ...extra });

/** A pin from the room's `pin.put` (protocols.md §4) in the page's shape, or null. Pure. */
export function pinOf(p) {
  if (!p || typeof p !== 'object' || !str(p.id) || !str(p.node)) return null;
  const at = typeof p.at === 'string' ? Date.parse(p.at) : Number(p.at);
  return {
    id: p.id, showId: null, node: p.node, title: cutText(p.title ?? '', SHOW.maxTitle),
    body: cutText(p.fields?.body ?? '', SHOW.maxBody), at: Number.isFinite(at) ? at : null,
  };
}

const withPin = (pins, pin, replaced = null) => {
  const out = [...pins.filter((p) => p.id !== pin.id && p.id !== replaced), pin];
  return out.slice(Math.max(0, out.length - SHOW.pins));
};

/** One command run now (the finger rule already passed). */
function run(s, cmd, now, c) {
  const time = cmd.receivedAt ?? c.time;
  const shown = [result(cmd.showId, 'shown')];
  if (cmd.cmd === 'pin') {
    const pin = { id: `pin-${cmd.showId}`, showId: cmd.showId, node: cmd.args.node, title: cmd.args.card.title, body: cmd.args.card.body, at: time };
    return none({ ...s, pins: withPin(s.pins, pin) }, { out: shown });
  }
  if (cmd.cmd === 'clear') {
    // Nothing to clear here: no undo on this screen (c4 §3.3).
    if (!s.highlight) return none({ ...s, undo: null }, { out: shown });
    const saved = { camera: c.camera, wall: c.wall, highlight: s.highlight };
    return none({ ...s, highlight: null, undo: { showId: cmd.showId, saved, camera: false } }, { out: shown });
  }
  // A camera command replacing a running show flight takes over that one's saved state (c4 §5).
  const saved = s.undo?.camera && c.moving ? s.undo.saved : { camera: c.camera, wall: c.wall, highlight: s.highlight };
  const undo = { showId: cmd.showId, saved, camera: true };
  if (cmd.cmd === 'fly_to') {
    if (!c.known(cmd.args.node)) return none(s, { out: [result(cmd.showId, 'skipped', WHY.notDrawn)] });
    return none({ ...s, undo }, { out: shown, act: { kind: 'fly', node: cmd.args.node, showId: cmd.showId } });
  }
  const nodes = cmd.args.nodes.filter((n) => c.known(n));
  if (!nodes.length) return none(s, { out: [result(cmd.showId, 'skipped', WHY.notDrawn)] });
  const highlight = { showId: cmd.showId, nodes, note: cmd.args.note ?? '', at: time, t: now };
  const act = c.inSight(nodes) ? { kind: 'stay', showId: cmd.showId } : { kind: 'fit', nodes, showId: cmd.showId };
  return none({ ...s, highlight, undo }, { out: shown, act });
}

/**
 * The next show after `event` at `now` (page ms). `state` is initialShow's
 * shape. Events: `{ type: 'msg', msg }` (a `show`), `{ type: 'undo', showId }`
 * (`show.undo`), `{ type: 'tick' }`, `{ type: 'tour' }` (the tour came back),
 * `{ type: 'pin.put', pin, replaced? }`, `{ type: 'pin.remove', pin }`,
 * `{ type: 'pin.close', pin }` (its ✕ here). `ctx`: `blocked` (the finger
 * rule holds now), `time` (epoch ms, the plates' clock), `camera` and `wall`
 * (what an undo restores), `moving` (a show flight runs now), `known(node)`,
 * `inSight(nodes)`. Returns `{ state, out, act }`: `out` the messages to send
 * (without `seq`), `act` the camera's part: `{ kind: 'fly', node }`, `{ kind:
 * 'fit', nodes }`, `{ kind: 'stay' }` (take the camera, do not move it) or
 * `{ kind: 'restore', saved }`. Pure.
 */
export function showStep(state, event, now, ctx = {}) {
  const c = { blocked: false, time: 0, camera: null, wall: null, moving: false, known: () => true, inSight: () => false, ...ctx };
  const s = state?.pins ? state : initialShow();
  const type = event?.type;

  if (type === 'msg') {
    const r = readShow(event.msg);
    if (!r) return none(s);
    // A repeat (another tab, a retry) is not shown twice and not answered twice.
    if (r.showId && s.seen.includes(r.showId)) return none(s);
    const said = { ...s, seen: r.showId ? [...s.seen, r.showId].slice(-SHOW.seen) : s.seen };
    if (!r.ok) return none(said, { out: r.showId ? [result(r.showId, 'skipped', r.why)] : [] });
    if (!CAMERA_CMDS.includes(r.cmd)) return run(said, r, now, c);
    const out = said.waiting ? [result(said.waiting.cmd.showId, 'skipped', WHY.inUse)] : [];
    if (c.blocked) return none({ ...said, waiting: { cmd: r, since: now } }, { out: [...out, result(r.showId, 'waiting')] });
    const ran = run({ ...said, waiting: null }, r, now, c);
    return { ...ran, out: [...out, ...ran.out] };
  }
  if (type === 'tick') {
    if (!s.waiting) return none(s);
    if (!c.blocked) return run({ ...s, waiting: null }, s.waiting.cmd, now, c);
    if (now - s.waiting.since >= SHOW.giveUpMs) {
      return none({ ...s, waiting: null }, { out: [result(s.waiting.cmd.showId, 'skipped', WHY.inUse)] });
    }
    return none(s);
  }
  if (type === 'undo') {
    const pin = s.pins.find((p) => p.showId != null && p.showId === event.showId);
    if (pin) return none({ ...s, pins: s.pins.filter((p) => p !== pin) });
    if (!s.undo || s.undo.showId !== event.showId) return none(s);
    const { saved } = s.undo;
    // A camera command's undo puts the camera and the wall state back too; a clear's only the marks.
    return none({ ...s, highlight: saved.highlight ? { ...saved.highlight, t: now } : null, undo: null }, { act: s.undo.camera ? { kind: 'restore', saved } : null });
  }
  if (type === 'tour') return none({ ...s, highlight: null, undo: null });
  if (type === 'pin.put') {
    const pin = pinOf(event.pin);
    return pin ? none({ ...s, pins: withPin(s.pins, pin, str(event.replaced) ? event.replaced : null) }) : none(s);
  }
  if (type === 'pin.remove' || type === 'pin.close') {
    const id = event.pin;
    if (!s.pins.some((p) => p.id === id)) return none(s);
    return none({ ...s, pins: s.pins.filter((p) => p.id !== id) }, { out: type === 'pin.close' ? [{ type: 'pin.close', pin: id }] : [] });
  }
  return none(s);
}

/** How lit a node is at `now` (`emphasis`, screens.md §9.2 M8): 1, or toward UNLIT under a highlight that leaves it out. Pure. */
export function emphasisOf(state, id, now, { still = false } = {}) {
  const h = state?.highlight;
  if (!h || h.nodes.includes(id)) return 1;
  const k = still ? 1 : Math.max(0, Math.min(1, (now - h.t) / SHOW.fadeMs));
  return 1 - (1 - SHOW.unlit) * k;
}

const easeOut = (k) => 1 - (1 - k) ** 3;

/** The brackets' box round a node drawn at `at` (`{ x, y, r }`), `ms` after the highlight came: closing in from 24 px over 300 ms. Pure. */
export function bracketBox(at, ms, { still = false } = {}) {
  const k = still ? 1 : easeOut(Math.max(0, Math.min(1, ms / SHOW.closeMs)));
  const R = (at.r ?? 0) + SHOW.outPx + SHOW.closeFromPx * (1 - k);
  return { left: at.x - R, top: at.y - R, size: 2 * R, R };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * The note plate's top left beside the first node's brackets (`R` their
 * half side): 16 px up and right of them, flipped left or down near an edge,
 * kept 16 px inside the `W`×`H` stage (c4 §3.2; the ask menu's rule). Of
 * the four corners it takes the first, in that order, that covers none of
 * the `avoid` boxes (the other marked nodes' brackets)*. Pure.
 */
export function notePlace(at, R, w, h, { W, H, avoid = [] }) {
  const g = SHOW.noteGapPx, e = SHOW.edgePx;
  const right = at.x + R + g, left = at.x - R - g - w, up = at.y - R - g - h, down = at.y + R + g;
  const fitsX = (x) => x >= e && x + w <= W - e;
  const fitsY = (y) => y >= e && y + h <= H - e;
  const xs = fitsX(right) || !fitsX(left) ? [right, left] : [left, right];
  const ys = fitsY(up) || !fitsY(down) ? [up, down] : [down, up];
  const place = (x, y) => ({ x: clamp(x, e, Math.max(e, W - e - w)), y: clamp(y, e, Math.max(e, H - e - h)) });
  const clear = (p) => !avoid.some((b) => p.x < b.right && p.x + w > b.left && p.y < b.bottom && p.y + h > b.top);
  const tries = [place(xs[0], ys[0]), place(xs[1], ys[0]), place(xs[0], ys[1]), place(xs[1], ys[1])];
  return tries.find(clear) ?? tries[0];
}

/**
 * A pin's top left (c4 §3.4): its left edge 48 px right of the node's
 * centre, centred on it; flipped left when it would cross the stage's right
 * edge; kept 16 px inside; moved down below each earlier pin (`above`, their
 * boxes) it would overlap, by the overlap plus 8 px. Returns `{ x, y, side }`. Pure.
 */
export function pinPlace(at, w, h, { W, H, above = [] }) {
  const e = SHOW.edgePx;
  let side = 'right', x = at.x + SHOW.pinGapPx;
  if (x + w > W - e) { side = 'left'; x = at.x - SHOW.pinGapPx - w; }
  x = clamp(x, e, Math.max(e, W - e - w));
  let y = clamp(at.y - h / 2, e, Math.max(e, H - e - h));
  const hits = (b) => x < b.right && x + w > b.left && y < b.bottom && y + h > b.top;
  for (let i = 0; i <= above.length; i++) {
    const b = above.find(hits);
    if (!b) break;
    y = b.bottom + SHOW.stackPx;
  }
  return { x, y, side };
}

/** The pin's leader: from the node's edge to the card's near edge, at the node's height inside the card. Pure. */
export function leaderOf(at, p, w, h) {
  const right = p.side === 'right';
  const x1 = at.x + (right ? 1 : -1) * (at.r ?? 0);
  const x2 = right ? p.x : p.x + w;
  const y2 = clamp(at.y, p.y, p.y + h);
  return { x1, y1: at.y, x2, y2 };
}

/**
 * The finger rule's ears (D70): a capturing listener on the galaxy's stage.
 * `blocked(now)` while a finger is down or for SHOW.waitMs after the last
 * touch ended (a lift, a wheel turn). `ignore(ev)`: a touch that does not
 * count (on a pin). Returns `{ blocked(now), stop() }`.
 */
export function createFingerWatch(stage, opts = {}) {
  const clock = opts.clock ?? (() => performance.now());
  const ignore = opts.ignore ?? (() => false);
  const down = new Set();
  let lastEnd = null;
  const on = [
    ['pointerdown', (ev) => { if (!ignore(ev)) down.add(ev.pointerId); }],
    ['pointerup', (ev) => { if (down.delete(ev.pointerId)) lastEnd = clock(); }],
    ['pointercancel', (ev) => { if (down.delete(ev.pointerId)) lastEnd = clock(); }],
    ['wheel', (ev) => { if (!ignore(ev)) lastEnd = clock(); }],
  ];
  for (const [t, fn] of on) stage.addEventListener(t, fn, true);
  return {
    blocked: (now = clock()) => down.size > 0 || (lastEnd != null && now - lastEnd < SHOW.waitMs),
    stop: () => { for (const [t, fn] of on) stage.removeEventListener(t, fn, true); },
  };
}

/**
 * The page's show: `createShow({ marks, veil, doc, clock, time, still,
 * send, ops, blocked, screenOf, size, veilColor })`. `marks` holds the
 * brackets, the note and the pins (they follow their nodes by transform);
 * `veil` (a 2D canvas, or null) dims the rest; `send(msg, showId|pinId)`
 * carries an answer back (transport.js); `ops` is the page's camera and wall:
 * `camera()`, `wall()`, `moving()`, `known(node)`, `inSight(nodes)`,
 * `fly(node)`, `fit(nodes)`, `stay()`, `restore(saved)`. Returns `{ receive(msg,
 * reply), tick(), draw(), tourBack(), state(), view(), emphasis(id), covers() }`:
 * `tick()` once a frame (the finger rule's wait), `draw()` after each frame.
 */
export function createShow(opts = {}) {
  const o = {
    clock: () => performance.now(), time: () => Date.now(), still: false, blocked: () => false,
    screenOf: () => null, size: () => ({ W: 0, H: 0 }), avoid: () => [], doc: globalThis.document, veil: null,
    veilColor: 'rgb(13, 16, 20)', send: () => {}, ...opts,
  };
  const noop = () => undefined;
  const ops = { camera: () => null, wall: () => null, moving: () => false, known: () => true, inSight: () => false, fly: noop, fit: noop, stay: noop, restore: noop, ...opts.ops };
  const { marks } = o;
  let state = initialShow();
  let seq = 0;
  const replies = new Map(); // showId or pin id → the road it came by
  const results = []; // the last answers, for the test handle
  let built = null; // the key of what the marks hold now
  let brackets = new Map(), note = null, pins = new Map();
  let boxes = [];

  const el = (tag, cls, text) => {
    const e = o.doc.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const say = (msg, key) => {
    const m = { ...msg, seq: ++seq };
    results.push(m);
    if (results.length > SHOW.results) results.shift();
    o.send(m, replies.get(key) ?? null);
  };

  const build = () => {
    const h = state.highlight;
    const key = JSON.stringify([h?.showId, h?.nodes, state.pins.map((p) => p.id)]);
    if (key === built) return;
    built = key;
    brackets = new Map((h?.nodes ?? []).map((n) => {
      const b = el('div', 'galaxy-show-mark');
      b.dataset.showMark = '';
      b.dataset.node = n;
      b.setAttribute('aria-hidden', 'true');
      for (const k of ['tl', 'tr', 'bl', 'br']) b.append(el('i', k));
      return [n, b];
    }));
    note = null;
    if (h?.note) {
      note = el('div', 'galaxy-show-note');
      note.dataset.showNote = '';
      note.append(el('div', 'galaxy-show-who', `AGENT · ${clockText(h.at)}`), el('div', 'galaxy-show-note-text', h.note));
    }
    pins = new Map(state.pins.map((p) => {
      const card = el('div', 'galaxy-pin');
      card.dataset.pin = '';
      card.dataset.pinId = p.id;
      card.dataset.node = p.node;
      const x = el('button', 'galaxy-pin-remove', '✕');
      x.type = 'button';
      x.dataset.pinRemove = '';
      x.setAttribute('aria-label', 'Remove pin');
      const head = el('div', 'galaxy-pin-head');
      head.append(el('span', 'galaxy-show-who', `AGENT · ${clockText(p.at)}`), x);
      card.append(head);
      if (p.title) card.append(el('div', 'galaxy-pin-title', p.title));
      if (p.body) card.append(el('div', 'galaxy-pin-body', p.body));
      // A press on the card never reaches the stage: not a touch on the galaxy, not a tap on the sky.
      const keep = (ev) => ev.stopPropagation?.();
      for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click']) card.addEventListener(t, keep);
      x.addEventListener('click', (ev) => { ev.preventDefault?.(); ev.stopPropagation?.(); close(p.id); });
      const leader = el('div', 'galaxy-pin-leader');
      leader.setAttribute('aria-hidden', 'true');
      return [p.id, { card, leader, node: p.node, w: 0, h: 0 }];
    }));
    marks.replaceChildren(...brackets.values(), ...(note ? [note] : []), ...[...pins.values()].flatMap((p) => [p.leader, p.card]));
    marks.hidden = !brackets.size && !note && !pins.size;
    for (const p of pins.values()) { p.w = p.card.offsetWidth || SHOW.pinW; p.h = p.card.offsetHeight || 120; }
    if (note) { note.w = note.offsetWidth || SHOW.noteW; note.h = note.offsetHeight || 80; }
    draw();
  };

  const apply = (r) => {
    state = r.state;
    for (const m of r.out) say(m, m.showId ?? m.pin);
    const a = r.act;
    if (a?.kind === 'fly') ops.fly(a.node, a.showId);
    else if (a?.kind === 'fit') ops.fit(a.nodes, a.showId);
    else if (a?.kind === 'stay') ops.stay(a.showId);
    else if (a?.kind === 'restore') ops.restore(a.saved);
    build();
    return r;
  };
  const ctx = () => ({
    blocked: o.blocked(), time: o.time(), camera: ops.camera(), wall: ops.wall(), moving: ops.moving(),
    known: ops.known, inSight: ops.inSight,
  });
  const step = (event) => apply(showStep(state, event, o.clock(), ctx()));
  const close = (id) => step({ type: 'pin.close', pin: id });

  // The veil (D72's UNLIT): the whole stage dimmed to 0.16 but a soft hole at each marked node.
  let veiled = false;
  const drawVeil = (holes, k) => {
    const v = o.veil;
    if (!v?.getContext) return;
    if (!(k > 0)) {
      if (veiled) { v.getContext('2d')?.clearRect(0, 0, v.width, v.height); v.hidden = true; veiled = false; }
      return;
    }
    const { W, H } = o.size();
    if (v.width !== W) v.width = W;
    if (v.height !== H) v.height = H;
    const g = v.getContext('2d');
    if (!g) return;
    v.hidden = false;
    veiled = true;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, H);
    g.globalAlpha = (1 - SHOW.unlit) * k;
    g.fillStyle = o.veilColor;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out';
    for (const { x, y, R } of holes) {
      const grad = g.createRadialGradient(x, y, R * 0.55, x, y, R);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, R, 0, 2 * Math.PI);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  };

  const move = (e, x, y) => { e.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; };
  function draw() {
    const now = o.clock();
    const h = state.highlight;
    const { W, H } = o.size();
    const holes = [];
    boxes = [];
    let first = null;
    // A node out of sight (behind the camera or off the stage) hides its marks and its card (c4 §3.4).
    const sight = (id) => {
      const at = o.screenOf(id);
      return at && at.x >= 0 && at.x <= W && at.y >= 0 && at.y <= H ? at : null;
    };
    const keepOff = o.avoid() ?? []; // the page's controls (the back control, the manual line)*
    const marked = [];
    for (const [n, b] of brackets) {
      const at = sight(n);
      b.hidden = !at;
      if (!at) continue;
      const box = bracketBox(at, now - h.t, { still: o.still });
      const d = String(Math.round(box.size));
      if (b.dataset.d !== d) { b.dataset.d = d; b.style.width = b.style.height = `${d}px`; }
      move(b, box.left, box.top);
      marked.push({ node: n, left: box.left, top: box.top, right: box.left + box.size, bottom: box.top + box.size });
      holes.push({ x: at.x, y: at.y, R: Math.max(64, 2 * (at.r ?? 0) + 40) });
      if (!first) first = { at, R: box.R };
    }
    const above = []; // the pins step below what is placed before them: the note, then each earlier pin*
    if (note) {
      note.hidden = !first;
      if (first) {
        const p = notePlace(first.at, first.R, note.w, note.h, { W, H, avoid: [...marked.slice(1), ...keepOff] });
        move(note, p.x, p.y);
        const box = { left: p.x, top: p.y, right: p.x + note.w, bottom: p.y + note.h };
        boxes.push(box);
        above.push(box);
      }
    }
    for (const p of pins.values()) {
      const at = sight(p.node);
      p.card.hidden = p.leader.hidden = !at;
      if (!at) continue;
      // Clear of the note, the earlier pins and the other marked nodes' brackets*.
      const pl = pinPlace(at, p.w, p.h, { W, H, above: [...above, ...keepOff, ...marked.filter((m) => m.node !== p.node)] });
      move(p.card, pl.x, pl.y);
      const box = { left: pl.x, top: pl.y, right: pl.x + p.w, bottom: pl.y + p.h };
      above.push(box);
      boxes.push(box);
      const l = leaderOf(at, pl, p.w, p.h);
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      p.leader.style.width = `${len.toFixed(1)}px`;
      p.leader.style.transform = `translate3d(${l.x1.toFixed(1)}px, ${l.y1.toFixed(1)}px, 0) rotate(${Math.atan2(l.y2 - l.y1, l.x2 - l.x1).toFixed(4)}rad)`;
    }
    drawVeil(holes, h ? (o.still ? 1 : Math.min(1, (now - h.t) / SHOW.fadeMs)) : 0);
  }

  build();
  return {
    receive: (msg, reply = null) => {
      if (!msg || !INBOUND.includes(msg.type)) return;
      if (msg.type === 'show') {
        if (reply && str(msg.showId)) replies.set(msg.showId, reply);
        step({ type: 'msg', msg });
      } else if (msg.type === 'show.undo') step({ type: 'undo', showId: msg.showId });
      else if (msg.type === 'pin.put') {
        if (reply && str(msg.pin?.id)) replies.set(msg.pin.id, reply);
        step({ type: 'pin.put', pin: msg.pin, replaced: msg.replaced });
      } else step({ type: 'pin.remove', pin: msg.pin });
      // Keep the roads of what is still on screen or waiting, no more.
      if (replies.size > SHOW.seen) for (const k of [...replies.keys()].slice(0, replies.size - SHOW.seen)) replies.delete(k);
    },
    tick: () => { if (state.waiting) step({ type: 'tick' }); },
    draw,
    tourBack: () => { if (state.highlight || state.undo) step({ type: 'tour' }); },
    state: () => state,
    // The test handle's show part (window.__cockpitView.show): plain data, a copy.
    view: () => ({
      highlight: state.highlight ? { showId: state.highlight.showId, nodes: [...state.highlight.nodes], note: state.highlight.note } : null,
      pins: state.pins.map((p) => ({ id: p.id, node: p.node, title: p.title, body: p.body })),
      undoable: state.undo?.showId ?? null,
      waiting: state.waiting?.cmd.showId ?? null,
      results: results.map((m) => ({ ...m })),
    }),
    emphasis: (id) => emphasisOf(state, id, o.clock(), { still: o.still }),
    // The note's and the pins' boxes, for the names to keep off (labels.js covers).
    covers: () => boxes,
  };
}
