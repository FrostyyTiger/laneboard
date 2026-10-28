// The room's prompt rate (spec c1-talk.md §7 "Rate", protocols.md §3.1, §8;
// D228) and its bounded refusal lines (screens.md §6.4, D165). REVIEW-REQUIRED:
// it is what keeps a stolen token or a screen in a loop from spending the
// owner's subscription without limit.
//
//   const rate = createPromptRate({now})
//   const slot = rate.take(key)     // a prompt may go: counted, or null (the 11th: too-many)
//   rate.giveBack(slot)             // the prompt was refused after all: not counted
//   rate.refusal(key)               // → {line: true} for the minute's first refusal, else {line: false}
//   rate.takeHeld(key)              // → the refusals counted since the key's last line (0 when none)
//   rate.putBack(key, n)            // a line that could not be written: its count goes back
//
// Rules it keeps:
//   - D228: at most RATE_MAX accepted prompts per key in the RATE_WINDOW_MS
//     before each prompt, on the room clock (the caller passes clock.now). A
//     prompt counts from the moment the room takes it; a prompt it refuses
//     (too-many, agent-down, audit-unavailable, the session's refusal) does
//     not, nor does a resend with a known clientId (the caller never asks).
//   - The key is the device token; C1 has no pairing, so the link passes the
//     one screen every link is (build B179, B233): two tabs share one count.
//   - D165: a too-many refusal is an audit line only when none was written
//     for the key in the REFUSAL_LINE_MS before; the rest only count, and the
//     key's next `cockpit.prompt` line carries the count as `refusedSince`.

/** c1-talk.md §16 (D228): prompts per key, and the window they are counted in. */
export const RATE_MAX = 10;
export const RATE_WINDOW_MS = 60_000;
/** screens.md §6.4 (D165): one refusal line per key per minute. */
export const REFUSAL_LINE_MS = 60_000;

export function createPromptRate({ now, max = RATE_MAX, windowMs = RATE_WINDOW_MS, lineMs = REFUSAL_LINE_MS } = {}) {
  if (typeof now !== 'function') throw new TypeError('createPromptRate: now() is required');
  const taken = new Map(); // key → the times of its accepted prompts, oldest first
  const refused = new Map(); // key → {lineAt, held}

  /** The key's prompts still inside the window before `t` (older ones dropped). */
  function recent(key, t) {
    const list = (taken.get(key) ?? []).filter((at) => at > t - windowMs);
    if (list.length) taken.set(key, list);
    else taken.delete(key);
    return list;
  }

  return {
    /** D228: count this prompt and return its slot, or null when the key already has `max` in the window. */
    take(key) {
      const t = now();
      const list = recent(key, t);
      if (list.length >= max) return null;
      list.push(t);
      taken.set(key, list);
      return { key, at: t };
    },
    /** A prompt refused after it was counted (agent-down, audit-unavailable) is not counted (D228). */
    giveBack(slot) {
      if (!slot) return;
      const list = taken.get(slot.key);
      const i = list ? list.indexOf(slot.at) : -1;
      if (i < 0) return;
      list.splice(i, 1);
      if (!list.length) taken.delete(slot.key);
    },
    /** D165: the first refusal of the minute is a line; the rest are held for the next line. */
    refusal(key) {
      const t = now();
      const r = refused.get(key);
      if (r && t - r.lineAt < lineMs) {
        r.held += 1;
        return { line: false };
      }
      refused.set(key, { lineAt: t, held: r?.held ?? 0 });
      return { line: true };
    },
    /** D165: the count the key's next `cockpit.prompt` line carries as `refusedSince`; taken once. */
    takeHeld(key) {
      const r = refused.get(key);
      if (!r || !r.held) return 0;
      const n = r.held;
      r.held = 0;
      return n;
    },
    /** A line that failed to be written keeps the count for the next one. */
    putBack(key, n) {
      if (!n) return;
      const r = refused.get(key) ?? { lineAt: -Infinity, held: 0 };
      r.held += n;
      refused.set(key, r);
    },
  };
}
