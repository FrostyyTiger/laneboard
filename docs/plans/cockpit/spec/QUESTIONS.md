# Cockpit spec: questions for the owner

What only the owner can decide: taste, one-way doors, anything security-relevant. Small reversible
choices go to `DECISIONS.md` instead. The spec is written for the recommendation and marks that
text `(pending Q-O<n>)`; when the owner answers, the answer goes on the `Answer:` line and the
marked text is fixed to match.

Numbers are never reused or renumbered; the list is ordered worst first (what blocks the C1 and C2
build nights first). Q-O1 to Q-O9 come from `../spec-input.md` §7; Q-O10 came up while writing
`screens.md` §6. About 15 minutes for the whole list: a letter per question is enough.

## List

## Q-O10 Who approves a screen's pairing, and how long its token lives

Security-relevant, blocks C1 (the pane needs a paired screen). Spec: T3, `screens.md` §6 (written).

- a) **Only the room's own CLI approves** (`laneboard cockpit pair K7M-4QX`, `local` on the room);
  tokens live until `laneboard cockpit unpair`.
- b) a), plus a token expires after 30 days without being seen.
- c) Any already paired screen may approve a new one, from its pane.

Recommendation: a) — nobody off the room's box can add a screen, and a desk kiosk that pairs again
every month is a chore for no gain while `unpair` is one command.

Answer: (open)

## Q-O1 Talk pressed while the agent is still answering

`spec-input.md` §7.1: "Interrupt, queue, or ignore?" Blocks C1/C2. Spec: T5, `c1-talk.md`.

- a) **Interrupt on send**: the running turn stops when the new prompt is sent, its text stays
  marked "stopped"; a separate Stop button stops without a new prompt.
- b) **Queue** the new prompt until the turn ends.
- c) **Ignore**: talk is disabled until the turn ends.

Recommendation: a) — speaking again mid-answer is almost always a correction; c) breaks the
terminal-like speed of `spec-input.md` §1.

Answer: (open)

## Q-O2 How long one conversation lives, and what carries over

`spec-input.md` §7.2. Blocks C1. Spec: T5, `c1-talk.md`.

- a) **One conversation forever**, compacted or restarted behind the scenes.
- b) **Daily fresh start** at a fixed hour, plus a "New conversation" button.
- c) **"New conversation" button only**, plus a forced fresh start when the session cannot go on.

Recommendation: c) — the plan (§3 C1) says exactly this; carried over: repos/plans/notes, canvas
cards, scheduled jobs and a short handover note; the old conversation stays readable.

Answer: (open)

## Q-O9 Screen sizes and orientation to design for

`spec-input.md` §7.9, and §2 "split or switching". Shapes every screen. Spec: T2, `screens.md`.

- a) **1368x912 landscape, touch only**, the one size checked.
- b) a) plus 1024x768 tablet and 1920x1080 wall screen without touch.
- c) b) plus portrait.

Recommendation: b) — split at ≥ 1280 px, switch below (`screens.md` §1, D9); also tell us the
tablet's panel size and viewing distance (research Q1 assumed 12.3 in at about 60 cm).

Answer: (open)

## Q-O8 Which screen the physical button targets

`spec-input.md` §7.8. Blocks the C2 button API. Spec: T7, `c2-voice.md`.

- a) **One screen named in config**; none named: the screen touched last.
- b) **The screen touched last**, always.
- c) **All screens** at once.

Recommendation: a) — predictable, and c) would open microphones in other rooms (privacy).

Answer: (open)

## Q-O6 What each screen shows when the agent's machine is down

`spec-input.md` §7.6. Spec: T3, `screens.md` §7 (written for a).

- a) **The board keeps working, the cockpit says it is away** (since when, retry, draft kept, cards
  marked `STALE`).
- b) **An error screen** until the room is back.
- c) **The cockpit disappears silently.**

Recommendation: a) — "never an empty screen" (`docs/plans/product.md`) rules out b); c) hides a
fault.

Answer: (open)

## Can wait

Not needed before the C1 and C2 build nights.

## Q-O5 How loud the agent is when it speaks up, and quiet hours

`spec-input.md` §7.5. Spec: T13, `coworker.md`.

- a) **Always a line only.**
- b) **Tiered by kind**: info a line; needs-you a line plus a card; urgent adds a sound (and speech
  once C5 exists); quiet hours on by default, lines and cards only.
- c) **Everything at full volume.**

Recommendation: b) — follows the board's existing trouble ranking (alerts, Stuck).

Answer: (open)

## Q-O3 Kit blocks in version 1

`spec-input.md` §7.3 (proposed: timer, countdown, chart, table, live log, checklist, status tile,
map focus). Spec: T11, `c4-show-canvas.md`.

- a) **All eight**, over two slices.
- b) **Four first** (countdown, status tile, live log, chart), the rest next slice.
- c) **Seven**: timer folded into countdown.

Recommendation: a), built in the order of b); c) is the owner's taste call.

Answer: (open)

## Q-O4 How canvas cards leave, and how many fit

`spec-input.md` §7.4. Spec: T11, T12, `c4-show-canvas.md`.

- a) **Dismissed by hand only.**
- b) **Expire only.**
- c) **Both**: one tap removes any card; a card bound to something that ended leaves on its own
  after a set time; unbound cards stay; a full grid moves older cards to a strip.

Recommendation: c) — nothing the owner may want vanishes, finished countdowns do not pile up.

Answer: (open)

## Q-O7 The first "act" list, and which actions always need a confirm

`spec-input.md` §7.7, after the control-plane review. Spec: T14, `c5-c6.md` (rules and confirm
card only).

- a) **No act in version 1.**
- b) **A short list of reversible actions** (stop a run, restart a service), each confirmed.
- c) **Every control-plane action**, each confirmed.

Recommendation: stays open until the control-plane review; the spec assumes a), and every entry
ever added needs a confirm ("change only with a yes", `spec-input.md` §6).

Answer: (open)
