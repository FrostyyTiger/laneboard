# Q17: a countdown readable from 3 m

## Answer

- Launch control and transit boards agree on few things, and the web has little on legibility of countdowns
  specifically. What is solid: spaceflight uses **two clocks** (a schedule clock that stops in holds and a real-time
  clock that keeps running), switches to a **signed count-up** after zero, and shows a **hold** as a stopped clock.
- Transit trials (NS, Netherlands) show **whole minutes** and hold at "0 minutes" for the last 59 s; no seconds.
- For laneboard: show **minutes** at the overview and site step (`in 4 min`), switch to `m:ss` only in the last
  few minutes or when the camera holds on the node; after zero show `+m:ss` and say it is late. Use tabular figures.
- I could **not** confirm any published legibility numbers (type size, contrast) specific to countdown displays.
  Type size per distance is Night 1's Q3; reuse it, do not rederive.

## What the builder needs

Format (a proposal built from the sources, marked where it is mine):

| Remaining | Overview / site step | Held (camera on the node, or tapped) |
|---|---|---|
| > 60 min | `in 3 h` (hours, rounded down, mine) | `3:12 h` |
| 5 to 60 min | `in 12 min` | `12:04` |
| 1 to 5 min | `in 4 min` | `4:12` (seconds appear only here) |
| < 1 min | `< 1 min` | `0:41` |
| at zero | `now` | `0:00` |
| after zero | `+2 min` (late) | `+2:07` |

- Minutes only at distance follows the NS trial: platform sign counts whole minutes from 5, escalator from 7, and
  shows "0 minutes" from 59 s before departure. The point there is a decision (run or wait), not precision.
- Seconds make the text change every second. Under WCAG 2.2.2 (Pause, Stop, Hide) auto-updating content has no
  five-second allowance: it needs a pause/stop/hide or a way to control the update rate, unless essential. A wall
  display is not interactive for most viewers, so: update the overview text only when the **minute** changes, and
  tick seconds only while held. That is fewer changes and the cleaner reading.
- Tabular figures: CSS `font-variant-numeric: tabular-nums` (Baseline widely available since January 2020) keeps
  digit widths equal so the label does not jitter each tick. Also give the element a `min-width` in `ch`.
- Two clocks (NASA): the T-clock stops in a hold and **jumps** when a built-in hold begins, the L-clock keeps
  running. For `countdown: { at, label }` the only honest clock is the L-clock: `at` is an absolute time, the text
  is `at - now`. If a feed wants a "hold", it should change `at` (the display then jumps, which should be visible,
  see below), not freeze the number.
- After zero: spaceflight switches to elapsed time with a sign (`+00:00:07`). Same here, `+` and the late count,
  never a negative number and never silently disappearing. A job that is overdue is information.
- Flashing: if anything blinks at zero, keep under WCAG 2.3.1: no more than three flashes in any one second, and
  below the area limit (about 87,000 CSS px for a 10-degree field). Better: do not blink; use one steady change
  (brighter ring, one pulse of 600 ms) and then stay still.
- Ring or bar vs digits (not confirmed by a source; my judgement): a ring that fills over the **last N minutes
  only** is readable as "soon" at 3 m without reading digits, and costs no per-second redraw. Digits carry the exact
  value only when held.

Many small countdowns, quiet at overview (mine, grounded in the above):
- At the overview step show digits only for the **next** one or two events (soonest `at`) and for any overdue one;
  the rest are a faint tick on the node ring.
- At the site step show all at that site, label under the number, the number in the 3 m size from Q3.
- Opacity or size by remaining time, not by blinking: far events at `--text-3`, under 5 min at `--text-1`.
- Hue stays for trouble (README): overdue is not red by itself; overdue and failed (a crit on that node) is.

## What laneboard's Wall could take

1. A pure helper (`countdown.js` in `public/js/wall/`, next to the other pure helpers) with
   `format(at, now, held) -> { text, phase }` where phase is `far | soon | now | late`, tested with a table of the
   rows above (the hygiene test covers the file for free).
2. One text node per countdown, update only when `text` changes; `tabular-nums`; no per-frame redraw.
3. `late` shows `+` and holds its place: nothing disappears at zero.
4. Held/tapped state flips the format to `m:ss`; this uses the existing "camera holds" signal.
5. The demo hub carries one countdown at 3 min, one at 40 min and one overdue, so the film shows all three phases.

## Could not confirm

- No source found on type size, contrast or colour for countdown displays at distance.
- No published results of the NS minute-counter trial (it was announced as a one-month trial).
- The "L-minus is the honest clock" mapping to `at - now` is my reasoning, not a source claim.
- The NASA LSP clock help page (`lspcountdown.ndc.nasa.gov/help.html`) returned 404; the clock definitions come
  from Wikipedia's summary and a search snippet citing NASA's Artemis II timeline.

## Sources (read 2026-10-27)

- Countdown (T-minus vs L-minus, holds, T-plus after liftoff, T-0): https://en.wikipedia.org/wiki/Countdown
- Built-in hold: https://en.wikipedia.org/wiki/Built-in_hold (search result only, not opened)
- NASA Artemis II launch countdown (hold rules at T-6 min, recycle to T-10): https://www.nasa.gov/general/nasa-releases-artemis-ii-moon-mission-launch-countdown/ (search snippet only)
- Shuttle holds and T-9: https://www.space.com/12186-space-shuttle-launch-countdown-minutes-liftoff.html (search snippet only)
- NS minute counter trial: https://nltimes.nl/node/55028
- WCAG 2.2 Understanding 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html
- WCAG 2.2 Understanding 2.3.1 Three Flashes: https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html
- MDN `font-variant-numeric`: https://developer.mozilla.org/docs/Web/CSS/font-variant-numeric (search result only)
- London Underground second-level countdown opinion (forum, anecdotal only): https://www.railforums.co.uk/threads/countdown-to-next-train-in-seconds.235278/

No page tried to instruct me.
