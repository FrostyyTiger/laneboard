// One camera director (Wall plan night 4 T13, README D10, §7 Night 4 A): the
// tour, a finger and a show command (the cockpit agent's `fly_to` and
// `highlight`, cockpit spec c4-show-canvas.md §2) all want the camera; this
// decides who has it, so they never fight.
//
// Three sources, in precedence: `touch` (a finger) first, then `show`, then
// the `tour`. The source that drives is `state.driver`; a request from a
// lower source than the driver is not played. Every change of driver that
// moves the camera is one eased move from where the camera is now (`move`:
// `{ from, to, ms, source }`, `from` the pose the page passes in), never a
// cut; in reduced motion (`still`, still.js) it is a cut with a short fade
// (`ms` 0, `fadeMs` CUT.fadeMs) instead.
//
// The cockpit spec (c4 §2, D68, D70; aligned 2026-10-27):
// - A show is "a touch that did not come from the owner": it takes the
//   camera from the tour or from a finger's explore alike, in its own time
//   (`ms`, the Map's 320-900 ms by distance, never the tour's slow flight).
//   The owner's finger rule (a command waits while a finger is down or for
//   3 s after the last touch, and gives up at 10 s) is show.js's, upstream:
//   the director never refuses a show.
// - A newer show replaces one mid-flight, from where the camera is.
// - A touch while a show drives takes the camera without a wake (the page is
//   already exploring: no ease out to the overview); what the show marked
//   stays (show.js).
// - A show has no hold of its own: the page's one idle minute (touch.js,
//   restarted when the show's movement ends) hands the camera back to the
//   tour (`handback`), as after a finger.
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
 * it back: one minute (README §7 Night 3 C5; cockpit screens.md §2's 60 s).
 * Moved here from touch.js (T13).
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

/** A show's target that keeps the camera where it is (a highlight whose nodes are all in sight). */
export const STAY = Object.freeze({ kind: 'stay' });

/** A director that has just started: the tour drives, nobody touched, nothing shown. */
export const initialDirector = (driver = 'tour', now = null) => (driver === 'touch'
  ? { driver, since: now, last: now, show: null }
  : { driver: 'tour', since: null, last: null, show: null });

function moveOf(source, from, to, ms, still) {
  if (!to || to.kind === 'stay') return null;
  return still
    ? { source, from: from ?? null, to, ms: 0, cut: true, fadeMs: CUT.fadeMs }
    : { source, from: from ?? null, to, ms, cut: false };
}

const result = (state, extra = {}) => ({ state, move: null, wake: false, resume: false, refused: null, ...extra });

/**
 * The next state after `event` at `now` (ms). `state` is `{ driver, since,
 * last, show }` (`last`: the last touch or show command, ms; `show`: the
 * command that drives, `{ id, to }`). `event` is an object:
 * - `{ type: 'touch', to?, ms?, pose? }`: a finger did something. The first touch
 *   while the tour drives takes the camera (`wake`) and eases it out to the
 *   overview; a touch while a show drives takes it without a wake (the page
 *   already explores); later touches with a `to` (a tap, back) move it there
 *   (in `ms`, else `flyMs`: back to the overview takes the wake's fitMs);
 *   without a `to` (a drag, the wheel: the gesture is its own motion) they
 *   only count as a touch.
 * - `{ type: 'handback' }`: `▶ TOUR`, the idle minute or an undo back to the
 *   tour: the tour at once.
 * - `{ type: 'show', id, to, ms?, pose? }`: a show command's camera move, in
 *   `ms` (else `flyMs`); `to` STAY takes the camera without moving it.
 * - `{ type: 'tour', to, ms?, pose? }`: the tour's leg (`focus`/`fit`),
 *   played only while the tour drives.
 * - `{ type: 'tick' }`: time passed.
 * `pose` is where the camera is now (the move's `from`). Options: `held`, a
 * finger has the page now (the tour never takes it from under it); `still`,
 * reduced motion (moves are cuts with a fade); `idleMs`, `fitMs`, `flyMs`.
 * Returns `{ state, move, wake, resume, refused }`: `move` the one move to
 * play (or null), `wake` when this touch woke the page from the tour,
 * `resume` when the tour has it back and should ask for its next leg,
 * `refused` a code (`busy` for a tour leg under another source, `bad-shape`)
 * when a request was not played. Pure.
 */
export function directorStep(state, event, now, opts = {}) {
  const o = { held: false, still: false, idleMs: IDLE.ms, fitMs: HANDOVER.fitMs, flyMs: HANDOVER.flyMs, ...opts };
  const s = state && SOURCES.includes(state.driver) ? state : initialDirector();
  const type = event?.type;
  const pose = event?.pose;

  if (type === 'touch') {
    if (s.driver === 'tour') {
      return result(
        // The minute counts from the end of the ease out (night 4 T5, Q13: a flight is not idle time).
        { driver: 'touch', since: now, last: now + (o.still ? 0 : o.fitMs), show: null },
        { wake: true, move: moveOf('touch', pose, OVERVIEW, o.fitMs, o.still) },
      );
    }
    if (s.driver === 'show') {
      // The owner's finger wins the camera (c4 §2, D70); the page already explores: no wake.
      const ms = Number.isFinite(event.ms) ? event.ms : o.flyMs;
      return result({ driver: 'touch', since: now, last: now, show: null }, { move: moveOf('touch', pose, event.to, ms, o.still) });
    }
    const ms = Number.isFinite(event.ms) ? event.ms : o.flyMs;
    return result({ ...s, last: Math.max(s.last ?? now, now) }, { move: moveOf('touch', pose, event.to, ms, o.still) });
  }

  if (type === 'handback') {
    if (s.driver === 'tour') return result(s);
    return result({ driver: 'tour', since: now, last: now, show: null }, { resume: true });
  }

  if (type === 'show') {
    if (!event.to) return result(s, { refused: 'bad-shape' });
    // Never refused here: the owner's finger rule is show.js's (see the notes above).
    const ms = Number.isFinite(event.ms) && event.ms >= 0 ? event.ms : o.flyMs;
    return result(
      { driver: 'show', since: now, last: now, show: { id: event.id ?? null, to: event.to } },
      { move: moveOf('show', pose, event.to, ms, o.still) },
    );
  }

  if (type === 'tour') {
    if (s.driver !== 'tour') return result(s, { refused: 'busy' });
    return result(s, { move: moveOf('tour', pose, event.to, Number.isFinite(event.ms) ? event.ms : o.flyMs, o.still) });
  }

  // A tick (or anything else): a finger's minute runs out here (a show's is touch.js's).
  if (s.driver === 'touch' && !o.held && now - (s.last ?? s.since) >= o.idleMs) {
    return result({ driver: 'tour', since: now, last: s.last, show: null }, { resume: true });
  }
  return result(s);
}

/**
 * How long until the tour takes a finger's camera back (ms): null while the
 * tour or a show drives (a show's minute is touch.js's); the whole `idleMs`
 * while a finger is `held`; never below 0. Pure.
 */
export function directorLeft(state, now, { idleMs = IDLE.ms, held = false } = {}) {
  if (state?.driver === 'touch') return held ? idleMs : Math.min(idleMs, Math.max(0, idleMs - (now - (state.last ?? state.since))));
  return null;
}

/**
 * The page's director (T14): `createDirector(cam, { clock, still, held,
 * resume, driver })`. `driver: 'touch'` (the `explore` role, T42) starts with
 * a finger driving and nothing to wake: a first tap flies. `cam` is camera.js's; `held()` says a finger has the page (the
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
 * - `show(cmd)` (`{ id, to, ms }`, `to` an `{ kind: 'site', id, zoom? }`,
 *   OVERVIEW, `{ kind: 'free', pose }` or STAY), `handBack()`, `tick()`: the
 *   other events.
 * - `driver()`, `left()` (directorLeft now), `onMove(cb)`: `cb({ source,
 *   call, args })` for every call made on `cam`.
 * In reduced motion the tour never leaves the overview (camera.js `still`),
 * so its legs stay `focus`/`fit`; a finger's or a show's site is a `cut`.
 */
export function createDirector(cam, opts = {}) {
  const o = { clock: () => performance.now(), still: false, held: () => false, resume: () => {}, driver: 'tour', ...opts };
  let state = initialDirector(o.driver, o.clock());
  const cbs = new Set();
  const call = (source, name, ...args) => {
    for (const cb of cbs) cb({ source, call: name, args });
    cam[name](...args);
  };
  const picked = (to) => (to.member != null ? [{ member: to.member }] : []);
  const play = (move) => {
    const { source, to, ms } = move;
    // The tour's legs are camera.js's own (its fit and focus fly FLIGHT.ms), as tour.js always called them.
    const timed = ms > 0 && source !== 'tour' ? { ms } : undefined;
    if (to.kind === 'overview') call(source, 'fit', timed);
    // A show's free pose (fitNodes, setCamera, an undo) is camera.js's `place`: any page, a cut in still mode.
    else if (to.kind === 'free' && source === 'show') call(source, 'place', to.pose, move.cut || to.cut ? { cut: true } : timed);
    else if (to.kind === 'free') call(source, 'fly', to.pose, timed);
    // A planet in it (night 5 B3, camera.js PICK): `{ member }` after the zoom, only when there is one.
    else if (to.kind === 'site' && (move.cut || to.cut) && source !== 'tour') call(source, 'cut', to.id, to.zoom, ...picked(to));
    // A show flies in its own time (c4 §2, D68); a finger's tap and the tour's leg keep camera.js's.
    else if (to.kind === 'site' && source === 'show' && timed) call(source, 'focus', to.id, to.zoom, { ...timed, ...picked(to)[0] });
    else if (to.kind === 'site') call(source, 'focus', to.id, to.zoom, ...picked(to));
  };
  const step = (event) => {
    // `held()` first: asking touch.js may hand the page back to the tour (a nested handBack), which
    // must land before this step reads the state, not be overwritten by it.
    const held = o.held();
    const from = state.driver;
    const r = directorStep(state, { ...event, pose: event.pose ?? cam.pose?.() ?? null }, o.clock(), { still: o.still, held });
    state = r.state;
    if (r.move) play(r.move);
    if (r.resume) o.resume(from);
    return r;
  };
  const site = (id, zoom, cut = false, member = null) => ({ kind: 'site', id, zoom, ...(cut ? { cut: true } : {}), ...(member != null ? { member } : {}) });
  const views = new Map();
  const as = (source) => {
    if (views.has(source)) return views.get(source);
    const ev = (to, ms) => ({ type: source, to, ...(Number.isFinite(ms) ? { ms } : {}) });
    const view = {
      ...cam,
      // `{ member }`: a planet in the site (night 5 B3), camera.js's focus/cut option.
      focus: (id, zoom, fo) => { step(ev(site(id, zoom, false, fo?.member))); },
      cut: (id, zoom, fo) => { step(ev(site(id, zoom, true, fo?.member))); },
      fit: (fo) => { step(ev(OVERVIEW, fo?.ms)); },
      fly: (pose, fo) => { if (pose) step(ev({ kind: 'free', pose }, fo?.ms)); },
      steer: (pose) => {
        // A finger steers once it has the page: its own explore, or a show's (it takes the camera from it).
        if (source !== 'touch' || state.driver === 'tour' || !pose) return;
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
      return step({ type: 'show', id: cmd?.id, to, ...(Number.isFinite(cmd?.ms) ? { ms: cmd.ms } : {}) });
    },
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
