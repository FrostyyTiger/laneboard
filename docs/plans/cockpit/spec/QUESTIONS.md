# Cockpit spec: questions for the owner

What only the owner can decide: taste, one-way doors, anything security-relevant. Small reversible
choices go to `DECISIONS.md` instead. The spec is written for the recommendation and marks that
text `(pending Q-O<n>)`; when the owner answers, the answer goes on the `Answer:` line and the
marked text is fixed to match.

Format, numbered in order and never renumbered:

```
## Q-O<n> <short title>
<the question>
- a) … - b) … - c) …
Recommendation: <option> — <why>. Spec: <task and file that write it>.
Answer: (open)
```

Q-O1 to Q-O9 come from `../spec-input.md` §7, in its order. Each recommendation here is the first
cut; the task named after "Spec:" may sharpen it (timings, labels) but changes the option only by
editing this file.

## List

## Q-O1 Talk pressed while the agent is still answering

`spec-input.md` §7.1: "What exactly happens when Talk is pressed while the agent is still
answering? (Interrupt, queue, or ignore?)"

- a) **Interrupt on send.** The reply keeps streaming while the owner speaks; when the new prompt
  is sent, the running turn stops, its text so far stays in the conversation marked "stopped", and
  the new prompt goes to the agent.
- b) **Queue.** The new prompt waits and is sent when the running turn ends.
- c) **Ignore.** The talk button is disabled until the turn ends.

Recommendation: a) — speaking again mid-answer is almost always a correction or a sharper
question, so a queued prompt would be answered after a reply the owner no longer wants; c) breaks
the terminal-like speed `spec-input.md` §1 asks for. A separate Stop button in the pane stops a
turn without a new prompt. How the bridge interrupts the agent depends on research Q2. Spec: T5,
`c1-talk.md`.

Answer: (open)

## Q-O2 How long one conversation lives, and what carries over

`spec-input.md` §7.2: "One conversation forever, daily fresh starts, or a 'new' button only? What
carries over?"

- a) **One conversation forever**, the room compacts or restarts the agent session behind it
  without the owner seeing a break.
- b) **Daily fresh start** at a fixed hour (for example 05:00), plus a "New conversation" button.
- c) **"New conversation" button only**, plus a fresh start forced when the agent's session can no
  longer continue (context full, session lost).

Recommendation: c) — the plan (§3 C1) says "one long-running conversation; a 'new conversation'
button", and a fixed daily cut would land in the middle of a task now and then. What carries over
into a new conversation: the written context a laptop session reads (repos, plans, notes), the
canvas cards, the scheduled jobs (fleet state, not chat), and a short handover note the agent
writes when the old one ends. The old conversation stays readable, not continuable. Spec: T5,
`c1-talk.md`.

Answer: (open)

## Q-O3 Kit blocks in version 1

`spec-input.md` §7.3: "Which kit blocks are in version 1? (Proposed: timer, countdown, chart,
table, live log, checklist, status tile, map focus.)"

- a) **All eight** as proposed, built over two slices.
- b) **Four first** (countdown, status tile, live log, chart), the other four in the next C4 slice.
- c) **Seven**: fold timer into countdown (a timer the owner sets is a countdown with no job).

Recommendation: a), built in the order of b) — the owner proposed the eight, and the four in b)
cover the cases `spec-input.md` names (§5: a countdown bound to the real job with cancel) and the
plan's examples (logs, charts, status). Folding timer into countdown (c) is a taste call left to
the owner. Spec: T11, `c4-show-canvas.md`.

Answer: (open)

## Q-O4 How canvas cards leave, and how many fit

`spec-input.md` §7.4: "How do canvas cards leave: dismissed by hand, expire, or both? How many fit
at once?"

- a) **Dismissed by hand only** (the plan's §3 C4b today: "Cards persist until dismissed").
- b) **Expire only**, each card after a fixed time.
- c) **Both**: one tap removes any card; a card bound to something that has ended (a countdown
  whose job ran or was cancelled, a run that finished) shows "done" and leaves on its own after a
  set time; unbound cards persist until dismissed.

Recommendation: c) — no hidden removal of what the owner may still want (unbound cards stay, as
the plan says), but the canvas does not fill with finished countdowns. How many fit: a fixed grid
per canvas size, with older cards moved to a strip rather than deleted when it is full; the grid,
the expiry time and the strip are set in T11. Spec: T11 and T12, `c4-show-canvas.md`.

Answer: (open)

## Q-O5 How loud the agent is when it speaks up, and quiet hours

`spec-input.md` §7.5: "When the agent speaks up, how loud: a line in the conversation, a card, a
sound, a spoken sentence? Quiet hours?"

- a) **Always a line only**; the owner sees it when they look.
- b) **Tiered by kind**: information is a line; something that needs the owner is a line plus a
  card on the canvas; urgent (a crit alert, a scheduled job about to change something) adds a
  short sound, and a spoken sentence once C5 exists.
- c) **Everything at full volume**: line, card and sound for each.

Recommendation: b) — the owner asked to be told "when something needs the owner" (§3), and the
board already ranks trouble (alerts, Stuck), so the loudness can follow that ranking instead of a
new one. Quiet hours: on by default, lines and cards only, no sound or speech; the hours and a
per-kind mute live in config (plan §3 "Proactive"). The kinds, defaults and config keys are set in
T13. Spec: T13, `coworker.md`.

Answer: (open)

## Q-O6 What each screen shows when the agent's machine is down

`spec-input.md` §7.6: "What does each screen show when the agent's machine is down?"

- a) **The board keeps working, the cockpit says it is away**: tour, explore and the views run as
  today (they read the board, not the room); the pane shows that the room is unreachable and since
  when, the input is disabled and a typed draft is kept; canvas cards stay, marked stale.
- b) **An error screen** on every screen until the room is back.
- c) **The cockpit disappears silently**: the cockpit button and the canvas are hidden.

Recommendation: a) — a screen is a window onto the fleet first (`spec-input.md` §2), and "never
an empty screen" (`docs/plans/product.md` §3.6) rules out b); c) hides that something is broken.
The exact text, the reconnect timings and the hub-down case are set in T3. Spec: T3, `screens.md`.

Answer: (open)

## Q-O7 The first "act" list, and which actions always need a confirm

`spec-input.md` §7.7: "Which actions are in the first 'act' list, and which always need a confirm?
(After the control-plane review.)"

- a) **No act in version 1.** The agent reads and shows; changes stay on the laptop.
- b) **A short list of reversible control-plane actions** (for example stop a run, restart a
  service), each one confirmed on the screen, after the control-plane review.
- c) **Every control-plane action**, each confirmed, after the review.

Recommendation: stays open — the owner decides after the control-plane security review (plan §3
C6). Until then the spec assumes a) and writes only the rules and the confirm card; whatever the
list becomes, every entry needs a confirm (`spec-input.md` §6: "change only with a yes"). Spec:
T14, `c5-c6.md` (rules and confirm card only).

Answer: (open)

## Q-O8 Which screen the physical button targets

`spec-input.md` §7.8: "Does the physical button target one screen, the last-used screen, or all?"

- a) **One screen named in config**; when none is named, the screen touched last.
- b) **The screen touched last**, always.
- c) **All screens** at once.

Recommendation: a) — the desk button sits next to one screen, so naming it makes the result
predictable; c) would open the microphone on every screen, including ones in other rooms, which is
a privacy risk. The route, auth and config key are set in T7. Spec: T7, `c2-voice.md`.

Answer: (open)

## Q-O9 Screen sizes and orientation to design for

`spec-input.md` §7.9: "Screen sizes and orientation to design for (the owner's tablet is
landscape, touch only)." Also: with one screen, split or switch (`spec-input.md` §2: "split or
switching").

- a) **1368x912 landscape, touch only**, as the one size checked; others best effort.
- b) a) plus two checked sizes: a 1024x768 tablet and a 1920x1080 wall screen without touch.
- c) b) plus portrait.

Recommendation: b) — the owner's tablet decides the design, and the two extra widths catch the
stranger's common cases at little cost; portrait waits until someone has a portrait screen. With
one screen: split side by side at 1280 px wide and more, switch below (the split is sketched in T2).
To confirm the type sizes: the tablet's physical size and the viewing distance (research
`../research/Q1-touch-targets-and-type.md` assumed a 12.3 in panel at about 60 cm). Spec: T2,
`screens.md`.

Answer: (open)
