// One camera director (Wall plan night 4 T13, README D10, §7 Night 4 A): the
// tour, a finger and a show command (the cockpit agent's `flyTo`, research
// Q16) all want the camera; this decides who has it, so they never fight.
//
// Three sources, in precedence: `touch` (a finger) first, then `show`, then
// the `tour`. The source that drives is `state.driver`; a request from a
// lower source than the driver is not played. Every change of driver that
// moves the camera is one eased move from where the camera is now (`move`:
// `{ from, to, ms, source }`, `from` the pose the page passes in), never a
// cut; in reduced motion (`still`, still.js) it is a cut with a short fade
// (`ms` 0, `fadeMs` CUT.fadeMs) instead.
//
// Decided (T13's notes):
// - A touch during a show: the finger wins and the show is **dropped**, not
//   parked (`dropped` names its id): the camera never flies back to an old
//   command a minute later, after the person has walked away; the tour,
//   trouble first, takes the page back as after any touch.
// - A show during touch: **refused** with `busy` (Q16's code), not queued:
//   nothing moves later out of nowhere, and the sender learns at once that a
//   person has the screen. Q16's default ttl (60 s) equals IDLE.ms, so a
//   queued command would nearly always expire before the minute was up.
// - A show while the tour drives (flying or holding): the show takes the
//   camera with an eased move from the tour's current pose; a newer show
//   replaces the older (last wins, one flight at a time).
// - The tour takes the camera back IDLE.ms after the last touch (never from
//   under a held finger) and IDLE.ms after the last show command (sooner if
//   the command's own `holdMs` is shorter, or at once on `clear`). The
//   director only says `resume`; the tour then asks for its next leg, which
//   eases from wherever the camera is.
//
// `directorStep` and `directorLeft` are pure on an injected clock
// (test/wall-galaxy-director.test.mjs). `createDirector` (T14) is the small
// part galaxy/main.js holds: the only thing that moves camera.js. Each source
// gets a camera of its own (`as(source)`, camera.js's interface) whose moves
// are requests to the director: the tour's is `createTour`'s map (tour.js
// unchanged, so wall.html is too), the finger's is the one the page's taps,
// back and gestures use.

import { TIMING } from '../tour.js';
import { CUT } from './still.js';

/** The sources, highest precedence first (D10). */
export const SOURCES = Object.freeze(['touch', 'show', 'tour']);

/**
 * How long the page waits after the last touch or show before the tour takes
 * it back: one minute (README §7 Night 3 C5; night 1's Q6 and Q13 give
 * 30-60 s for a kiosk's hand-back, the long end because a person reading a
 * sheet from a step away is not touching it). Moved here from touch.js (T13).
 */
export const IDLE = Object.freeze({ ms: 60000 });

/**
 * How long a hand-over takes (ms): the first touch eases out to the overview
 * in `fitMs` (touch.js TOUCH.fitMs); any other move (a show's flight, the
 * tour's leg, a finger's tap) in `flyMs`, the tour's flight time.
 */
export const HANDOVER = Object.freeze({ fitMs: 1500, flyMs: TIMING.flyMs });

/** The overview as a move's target. */
export const OVERVIEW = Object.freeze({ kind: 'overview' });

const rank = (source) => SOURCES.indexOf(source);

/** A director that has just started: the tour drives, nobody touched, nothing shown. */
export const initialDirector = () => ({ driver: 'tour', since: null, last: null, show: null });

function moveOf(source, from, to, ms, still) {
  if (!to) return null;
  return still
    ? { source, from: from ?? null, to, ms: 0, cut: true, fadeMs: CUT.fadeMs }
    : { source, from: from ?? null, to, ms, cut: false };
}

const result = (state, extra = {}) => ({ state, move: null, wake: false, resume: false, refused: null, dropped: null, ...extra });

/**
 * The next state after `event` at `now` (ms). `state` is `{ driver, since,
 * last, show }` (`last`: the last touch or show command, ms; `show`: the
 * command that drives, `{ id, to, until }`). `event` is an object:
 * - `{ type: 'touch', to?, ms?, pose? }`: a finger did something. The first touch
 *   while another source drives takes the camera (`wake`) and eases it out
 *   to the overview; later touches with a `to` (a tap, back) move it there
 *   (in `ms`, else `flyMs`: back to the overview takes the wake's fitMs);
 *   without a `to` (a drag, the wheel: the gesture is its own motion) they
 *   only count as a touch.
 * - `{ type: 'handback' }`: `▶ TOUR` was pressed: the tour at once.
 * - `{ type: 'show', id, to, holdMs?, pose? }`: a show command's `flyTo`.
 * - `{ type: 'clear', id? }`: the show ends (all, or only command `id`).
 * - `{ type: 'tour', to, ms?, pose? }`: the tour's leg (`focus`/`fit`),
 *   played only while the tour drives.
 * - `{ type: 'tick' }`: time passed.
 * `pose` is where the camera is now (the move's `from`). Options: `held`, a
 * finger is down now (the tour never takes the page from under it); `still`,
 * reduced motion (moves are cuts with a fade); `idleMs`, `fitMs`, `flyMs`.
 * Returns `{ state, move, wake, resume, refused, dropped }`: `move` the one
 * move to play (or null), `wake` when this touch took the camera, `resume`
 * when the tour has it back and should ask for its next leg, `refused` a code
 * (`busy`, `bad-shape`) when a request was not played, `dropped` the id of a show
 * command the finger ended. Pure.
 */
export function directorStep(state, event, now, opts = {}) {
  const o = { held: false, still: false, idleMs: IDLE.ms, fitMs: HANDOVER.fitMs, flyMs: HANDOVER.flyMs, ...opts };
  const s = state && SOURCES.includes(state.driver) ? state : initialDirector();
  const type = event?.type;
  const pose = event?.pose;

  if (type === 'touch') {
    if (s.driver !== 'touch') {
      const dropped = s.driver === 'show' ? s.show?.id ?? null : null;
      return result(
        // The minute counts from the end of the ease out (night 4 T5, Q13: a flight is not idle time).
        { driver: 'touch', since: now, last: now + (o.still ? 0 : o.fitMs), show: null },
        { wake: true, dropped, move: moveOf('touch', pose, OVERVIEW, o.fitMs, o.still) },
      );
    }
    const ms = Number.isFinite(event.ms) ? event.ms : o.flyMs;
    return result({ ...s, last: Math.max(s.last ?? now, now) }, { move: moveOf('touch', pose, event.to, ms, o.still) });
  }

  if (type === 'handback') {
    if (s.driver !== 'touch') return result(s);
    return result({ driver: 'tour', since: now, last: now, show: null }, { resume: true });
  }

  if (type === 'show') {
    if (!event.to) return result(s, { refused: 'bad-shape' });
    // A finger has the screen: the show is refused, never queued (see the notes above).
    if (rank(s.driver) < rank('show')) return result(s, { refused: 'busy' });
    const hold = Math.min(o.idleMs, Number.isFinite(event.holdMs) && event.holdMs >= 0 ? event.holdMs : o.idleMs);
    return result(
      { driver: 'show', since: now, last: now, show: { id: event.id ?? null, to: event.to, until: now + hold } },
      { move: moveOf('show', pose, event.to, o.flyMs, o.still) },
    );
  }

  if (type === 'clear') {
    if (s.driver !== 'show') return result(s);
    if (event.id != null && event.id !== s.show?.id) return result(s);
    return result({ driver: 'tour', since: now, last: s.last, show: null }, { resume: true });
  }

  if (type === 'tour') {
    if (s.driver !== 'tour') return result(s, { refused: 'busy' });
    return result(s, { move: moveOf('tour', pose, event.to, Number.isFinite(event.ms) ? event.ms : o.flyMs, o.still) });
  }

  // A tick (or anything else): the minute and the show's hold run out here.
  if (s.driver === 'touch' && !o.held && now - (s.last ?? s.since) >= o.idleMs) {
    return result({ driver: 'tour', since: now, last: s.last, show: null }, { resume: true });
  }
  if (s.driver === 'show' && now >= (s.show?.until ?? now)) {
    return result({ driver: 'tour', since: now, last: s.last, show: null }, { resume: true });
  }
  return result(s);
}

/**
 * How long until the tour takes the camera back (ms): null while the tour
 * drives; the whole `idleMs` while a finger is `held`; never below 0. Pure.
 */
export function directorLeft(state, now, { idleMs = IDLE.ms, held = false } = {}) {
  if (state?.driver === 'touch') return held ? idleMs : Math.min(idleMs, Math.max(0, idleMs - (now - (state.last ?? state.since))));
  if (state?.driver === 'show') return Math.max(0, (state.show?.until ?? now) - now);
  return null;
}

/**
 * The page's director (T14): `createDirector(cam, { clock, still, held,
 * resume })`. `cam` is camera.js's; `held()` says a finger has the page (the
 * director's minute never runs out under it: touch.js's own minute, which
 * hears every pointer, hands the page back with `handBack()`); `resume(from)`
 * is told when the tour has the camera back from `from` (`touch`, `show`),
 * so the page asks the tour for its next leg. Returns:
 * - `as(source)`: a camera for `touch` or `tour` with camera.js's interface;
 *   its `focus`, `fit`, `cut`, `fly` and `steer` are requests to the
 *   director (a tour leg while a finger drives does not move the camera),
 *   everything else reads `cam` as it is. A finger's `steer` (a drag, a
 *   pinch) counts as a touch and holds the pose as given; it never wakes
 *   the page (only the wake's fit does).
 * - `show(cmd)` (`{ id, to, holdMs }`, `to` an `{ kind: 'site', id }` or
 *   OVERVIEW), `clear(id?)`, `handBack()`, `tick()`: the other events.
 * - `driver()`, `left()` (directorLeft now), `onMove(cb)`: `cb({ source,
 *   call, args })` for every call made on `cam`.
 * In reduced motion the tour never leaves the overview (camera.js `still`),
 * so its legs stay `focus`/`fit`; a finger's or a show's site is a `cut`.
 */
export function createDirector(cam, opts = {}) {
  const o = { clock: () => performance.now(), still: false, held: () => false, resume: () => {}, ...opts };
  let state = initialDirector();
  const cbs = new Set();
  const call = (source, name, ...args) => {
    for (const cb of cbs) cb({ source, call: name, args });
    cam[name](...args);
  };
  const play = (move) => {
    const { source, to, ms } = move;
    // The tour's legs are camera.js's own (its fit and focus fly FLIGHT.ms), as tour.js always called them.
    const timed = ms > 0 && source !== 'tour' ? { ms } : undefined;
    if (to.kind === 'overview') call(source, 'fit', timed);
    else if (to.kind === 'free') call(source, 'fly', to.pose, timed);
    else if (to.kind === 'site') call(source, (move.cut || to.cut) && source !== 'tour' ? 'cut' : 'focus', to.id, to.zoom);
  };
  const step = (event) => {
    const from = state.driver;
    const r = directorStep(state, { ...event, pose: event.pose ?? cam.pose?.() ?? null }, o.clock(), { still: o.still, held: o.held() });
    state = r.state;
    if (r.move) play(r.move);
    if (r.resume) o.resume(from);
    return r;
  };
  const site = (id, zoom, cut = false) => ({ kind: 'site', id, zoom, ...(cut ? { cut: true } : {}) });
  const views = new Map();
  const as = (source) => {
    if (views.has(source)) return views.get(source);
    const ev = (to, ms) => ({ type: source, to, ...(Number.isFinite(ms) ? { ms } : {}) });
    const view = {
      ...cam,
      focus: (id, zoom) => { step(ev(site(id, zoom))); },
      cut: (id, zoom) => { step(ev(site(id, zoom, true))); },
      fit: (fo) => { step(ev(OVERVIEW, fo?.ms)); },
      fly: (pose, fo) => { if (pose) step(ev({ kind: 'free', pose }, fo?.ms)); },
      steer: (pose) => {
        if (source !== 'touch' || state.driver !== 'touch' || !pose) return;
        step({ type: 'touch' });
        call('touch', 'steer', pose);
      },
    };
    views.set(source, view);
    return view;
  };
  return {
    as,
    show: (cmd) => {
      const to = cmd?.to?.kind === 'site' && !Number.isFinite(cmd.to.zoom) ? { ...cmd.to, zoom: TIMING.zoom } : cmd?.to;
      return step({ type: 'show', id: cmd?.id, to, holdMs: cmd?.holdMs });
    },
    clear: (id) => step({ type: 'clear', id }),
    handBack: () => step({ type: 'handback' }),
    tick: () => step({ type: 'tick' }),
    driver: () => state.driver,
    left: () => directorLeft(state, o.clock(), { held: o.held() }),
    onMove: (cb) => {
      if (typeof cb !== 'function') return () => {};
      cbs.add(cb);
      return () => cbs.delete(cb);
    },
  };
}
