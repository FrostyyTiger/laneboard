// A scheduled job's countdown (Wall plan night 4 T40, README §7.C; research
// Q17): a feed hangs `countdown: { at, label }` on a node (server/map.mjs
// feedExtras, `at` in epoch ms) and the Wall says how long until then.
//
// The format is Q17's. At a distance whole minutes only (`in 12 min`,
// `< 1 min`), as departure boards count, so the words change once a minute
// and never tick; held (the camera or a finger on the node) `m:ss`. After
// zero the count goes on with a `+` and stays put: an overdue job is news,
// never a negative number and never a word that just disappears. No hue:
// late is not trouble by itself (a crit on that node is, and says so).
//
// Pure: no DOM, so test/wall-countdown.test.mjs imports it directly.

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Under this many ms left a countdown is `soon` (Q17: the last five minutes). */
export const SOON_MS = 5 * MIN;

/** The count's state: `far`, `soon` (the last five minutes), `now` (the minute after zero), `late`. */
export function countdownPhase(at, now) {
  const left = at - now;
  if (left > SOON_MS) return 'far';
  if (left > 0) return 'soon';
  return -left < MIN ? 'now' : 'late';
}

const pad = (n) => String(n).padStart(2, '0');
const clockOf = (ms) => `${Math.floor(ms / MIN)}:${pad(Math.floor((ms % MIN) / 1000))}`;

/**
 * The words for a countdown to `at` at `now` (both epoch ms): `{ text, phase }`,
 * or null when `at` is not a time. `held` gives the `m:ss` clock (Q17's
 * second column), else whole minutes. Pure.
 */
export function countdownText(at, now, { held = false } = {}) {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  const phase = countdownPhase(at, now);
  const left = at - now;
  if (left <= 0) {
    const over = now - at;
    if (held) return { text: over < 1000 ? '0:00' : `+${clockOf(over)}`, phase };
    return { text: phase === 'now' ? 'now' : `+${Math.floor(over / MIN)} min`, phase };
  }
  if (held) {
    // Seconds round up while counting down: 0:01 is the last second, 0:00 is zero.
    const s = Math.ceil(left / 1000) * 1000;
    if (s >= HOUR) return { text: `${Math.floor(s / HOUR)}:${pad(Math.floor((s % HOUR) / MIN))} h`, phase };
    return { text: clockOf(s), phase };
  }
  if (left >= HOUR) return { text: `in ${Math.floor(left / HOUR)} h`, phase };
  if (left < MIN) return { text: '< 1 min', phase };
  return { text: `in ${Math.floor(left / MIN)} min`, phase };
}

/** A node's countdown, `{ at, label }` with `at` a number, or null (a bad one is no countdown). */
export function countdownOf(node) {
  const c = node?.countdown;
  if (!c || !Number.isFinite(c.at)) return null;
  const label = typeof c.label === 'string' && c.label.trim() ? c.label.trim() : null;
  return { at: c.at, label };
}

/** One line for a node's countdown at `now`: the label and the count (`dumps in 12 min`), or null. Pure. */
export function countdownLine(node, now, opts) {
  const c = countdownOf(node);
  const t = c && countdownText(c.at, now, opts);
  if (!t) return null;
  return { text: c.label ? `${c.label} ${t.text}` : t.text, phase: t.phase };
}
