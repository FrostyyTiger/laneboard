// The show demo (Wall plan night 4 T39, §7 Night 4 B; cockpit §5 "the demo
// shows the cockpit with a recorded conversation that flies the demo fleet";
// re-recorded on 2026-10-27 in the cockpit's message shape, protocols.md §4):
// `?show=demo` plays a recorded conversation's room messages into the page's
// own show (show.js createShow `receive`), over and over, the tour between. It
// is the video's second half: `galaxy.html?demo=1&show=demo` on the large demo
// fleet (`test/tools/demo-fleet.mjs --size large`). Its nodes are that fleet's;
// on another fleet they are not drawn: `fly_to` and `highlight` are answered
// `skipped` (`not drawn`) and show nothing, the pin waits hidden.
//
// The conversation (what the person says is the cockpit pane's, not the Wall's):
//   "What's wrong tonight?"    → fly_to storage, then a pin on it
//   "What does that break?"    → highlight storage and the two that need it
//                                (db's dumps, the offsite copy), with a note:
//                                the camera fits the three
//   "Thanks, that's enough."   → clear (the marks go, the camera stays), then
//                                the owner's UNDO on the pin's line (show.undo)
// `storage` is the large demo's crit (`pool 97% full`, LARGE_TROUBLE ticks
// 0-39); the links `db → storage` (dumps) and `storage → office-nas` (offsite
// copy) are what it breaks.
//
// A cycle starts SHOW_DEMO.startMs after the galaxy first draws (the tour is
// seen first), its messages go at their `atMs`, and the next cycle starts
// SHOW_DEMO.cycleMs after this one did: the page explores for the idle minute
// after the highlight's flight (cockpit screens.md §2), then the tour has the
// screen until the next. The owner's finger is the show's rule, not the
// demo's: a command under a finger waits or is skipped (show.js).
// `showDemoStep` is pure on an injected clock (test/wall-galaxy-showdemo.test.mjs).

/** `startMs` after the first frame; `cycleMs` from one cycle's start to the next. */
export const SHOW_DEMO = Object.freeze({ startMs: 3000, cycleMs: 120000 });

/**
 * The recorded conversation: each `{ atMs, cmd, args }` (a `show`) or `{
 * atMs, undo: i }` (the owner's UNDO on line `i`, the room's `show.undo`),
 * `atMs` from the cycle's start.
 */
export const SHOW_DEMO_SCRIPT = Object.freeze([
  { atMs: 0, cmd: 'fly_to', args: { node: 'storage' } },
  { atMs: 3500, cmd: 'pin', args: { node: 'storage', card: { block: 'text', title: 'pool 97% full', body: 'Full in about 2 h at tonight’s rate' } } },
  { atMs: 9000, cmd: 'highlight', args: { nodes: ['storage', 'db', 'office-nas'], note: 'Dumps from db and the offsite copy stop when the pool fills' } },
  { atMs: 19000, cmd: 'clear', args: {} },
  { atMs: 22000, undo: 1 },
]);

/** `?show=demo` asks for the demo. */
export const wantsShowDemo = (q) => q?.get?.('show') === 'demo';

/** Before the first frame: nothing planned. */
export const initialShowDemo = () => ({ cycle: 0, startAt: null, next: 0 });

/** The script's line `i` of cycle `cycle` as the room's message (a fresh showId per cycle: show.js drops repeats). */
export function demoMessage(script, cycle, i) {
  const c = script[i];
  if (c.undo != null) return { type: 'show.undo', showId: `demo-${cycle}-${c.undo}` };
  return { type: 'show', showId: `demo-${cycle}-${i}`, turnId: `demo-turn-${cycle}`, cmd: c.cmd, args: c.args };
}

/**
 * The next player state at `now` (ms): `{ state, send }`, `send` the
 * messages due now, in order. The first call plans the first cycle
 * `startMs` later; a finished cycle plans the next `cycleMs` after its start
 * (or now, after a long gap such as a hidden tab). Pure.
 */
export function showDemoStep(state, now, { script = SHOW_DEMO_SCRIPT, startMs = SHOW_DEMO.startMs, cycleMs = SHOW_DEMO.cycleMs } = {}) {
  let s = state?.startAt == null ? { ...initialShowDemo(), ...state, startAt: now + startMs, next: 0 } : state;
  const send = [];
  while (s.next < script.length && now >= s.startAt + script[s.next].atMs) {
    send.push(demoMessage(script, s.cycle, s.next));
    s = { ...s, next: s.next + 1 };
  }
  if (s.next >= script.length) s = { cycle: s.cycle + 1, startAt: Math.max(now, s.startAt + cycleMs), next: 0 };
  return { state: s, send };
}

/**
 * The page's player: `createShowDemo({ receive, clock })`, `receive(msg)`
 * (createShow's). Returns `{ tick(), state() }`; `tick()` once a frame once
 * the galaxy draws (the first call starts the clock).
 */
export function createShowDemo(opts = {}) {
  const o = { clock: () => performance.now(), ...opts };
  let state = initialShowDemo();
  return {
    tick: () => {
      const r = showDemoStep(state, o.clock(), o);
      state = r.state;
      for (const msg of r.send) o.receive(msg, null);
    },
    state: () => state,
  };
}
