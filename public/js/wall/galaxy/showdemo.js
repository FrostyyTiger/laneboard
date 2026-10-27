// The show demo (Wall plan night 4 T39, §7 Night 4 B; cockpit §5 "the demo
// shows the cockpit with a recorded conversation that flies the demo fleet"):
// `?show=demo` plays a recorded conversation's show commands into the page's
// own show (show.js createShow `send`), over and over, the tour between. It is
// the video's second half: `galaxy.html?demo=1&show=demo` on the large demo
// fleet (`test/tools/demo-fleet.mjs --size large`). Its nodes are that fleet's;
// on another fleet they are not drawn and each command is answered
// `unknown-node` and shows nothing.
//
// The conversation (what the person says is not on screen yet; T51 gives the
// agent a voice on the plate):
//   "What's wrong tonight?"        → flyTo storage, then a pin on it
//   "What does that break?"        → flyTo the hub (the overview), then a
//                                     highlight of storage and the two that
//                                     need it (db's dumps, the offsite copy)
//   "Thanks, that's enough."       → clear
// `storage` is the large demo's crit (`pool 97% full`, LARGE_TROUBLE ticks
// 0-39); the links `db → storage` (dumps) and `storage → office-nas` (offsite
// copy) are what it breaks.
//
// A cycle starts SHOW_DEMO.startMs after the galaxy first draws (the tour is
// seen first), its commands go at their `atMs`, and the next cycle starts
// SHOW_DEMO.gapMs after the last (the tour has the screen between). A finger
// wins: a command answered `busy` ends the cycle where it is (the person
// already dropped what was shown) and the next one waits a whole gap.
// `showDemoStep` is pure on an injected clock (test/wall-galaxy-showdemo.test.mjs).

import { SHOW } from './show.js';

/** `startMs` after the first frame, `gapMs` of tour between two cycles, `src` the sender. */
export const SHOW_DEMO = Object.freeze({ startMs: 3000, gapMs: 36000, src: 'agent:cockpit' });

/**
 * The recorded conversation: each command `{ atMs, type, ttl, data }`, `atMs`
 * from the cycle's start, `ttl` seconds (show.js). The last is the `clear`.
 */
export const SHOW_DEMO_SCRIPT = Object.freeze([
  { atMs: 0, type: 'flyTo', ttl: 30, data: { node: 'storage' } },
  { atMs: 3500, type: 'pin', ttl: 30, data: { node: 'storage', card: { title: 'pool 97% full', text: 'Full in about 2 h at tonight’s rate' } } },
  { atMs: 10000, type: 'flyTo', ttl: 30, data: { node: '__core' } },
  { atMs: 11500, type: 'highlight', ttl: 30, data: { nodes: ['storage', 'db', 'office-nas'], note: 'Dumps from db and the offsite copy stop when the pool fills' } },
  { atMs: 24000, type: 'clear', ttl: 0, data: {} },
]);

/** `?show=demo` asks for the demo. */
export const wantsShowDemo = (q) => q?.get?.('show') === 'demo';

/** Before the first frame: nothing planned. */
export const initialShowDemo = () => ({ cycle: 0, startAt: null, next: 0 });

/** The script's command `i` of cycle `cycle` as show.js's envelope (a fresh id per cycle: show.js drops repeats). */
export function demoMessage(script, cycle, i, src = SHOW_DEMO.src) {
  const c = script[i];
  return { v: SHOW.v, ch: SHOW.ch, id: `demo-${cycle}-${i}`, src, type: c.type, ttl: c.ttl, data: c.data };
}

/**
 * The next player state at `now` (ms): `{ state, send }`, `send` the
 * messages due now, in order. The first call plans the first cycle
 * `startMs` later; a finished cycle plans the next `gapMs` after its last
 * command. `reply(msg)` is called by the caller with each answer: see
 * `showDemoReply`. Pure.
 */
export function showDemoStep(state, now, { script = SHOW_DEMO_SCRIPT, startMs = SHOW_DEMO.startMs, gapMs = SHOW_DEMO.gapMs, src } = {}) {
  let s = state?.startAt == null ? { ...initialShowDemo(), ...state, startAt: now + startMs, next: 0 } : state;
  const send = [];
  while (s.next < script.length && now >= s.startAt + script[s.next].atMs) {
    send.push(demoMessage(script, s.cycle, s.next, src));
    s = { ...s, next: s.next + 1 };
  }
  if (s.next >= script.length) {
    const last = s.startAt + (script.at(-1)?.atMs ?? 0);
    s = { cycle: s.cycle + 1, startAt: Math.max(now, last) + gapMs, next: 0 };
  }
  return { state: s, send };
}

/**
 * After an answer at `now`: a `busy` (a finger has the page) ends this cycle
 * and plans the next a whole gap later; anything else changes nothing (an
 * `unknown-node` on another fleet just shows nothing). Pure.
 */
export function showDemoReply(state, reply, now, { gapMs = SHOW_DEMO.gapMs } = {}) {
  if (reply?.ok !== false || reply.code !== 'busy') return state;
  return { cycle: state.cycle + 1, startAt: now + gapMs, next: 0 };
}

/**
 * The page's player: `createShowDemo({ send, clock })`, `send(msg) → reply`
 * (createShow's). Returns `{ tick(), state() }`; `tick()` once a frame once
 * the galaxy draws (the first call starts the clock).
 */
export function createShowDemo(opts = {}) {
  const o = { clock: () => performance.now(), ...opts };
  let state = initialShowDemo();
  return {
    tick: () => {
      const now = o.clock();
      const r = showDemoStep(state, now, o);
      state = r.state;
      for (const msg of r.send) {
        const before = state;
        state = showDemoReply(state, o.send(msg), now, o);
        if (state !== before) break; // busy: the rest of this cycle is not said
      }
    },
    state: () => state,
  };
}
