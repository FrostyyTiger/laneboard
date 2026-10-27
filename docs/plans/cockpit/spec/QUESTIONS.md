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

`spec-input.md` §7.1: "Interrupt, queue, or ignore?" Blocks C1/C2. Spec: T5, `c1-talk.md` §8, D32-D33 (written for a).

- a) **Interrupt on send**: the running turn stops when the new prompt is sent, its text stays
  marked "stopped"; a separate Stop button stops without a new prompt.
- b) **Queue** the new prompt until the turn ends.
- c) **Ignore**: talk is disabled until the turn ends.

Recommendation: a) — speaking again mid-answer is almost always a correction; c) breaks the
terminal-like speed of `spec-input.md` §1.

Answer: (open)

## Q-O2 How long one conversation lives, and what carries over

`spec-input.md` §7.2. Blocks C1. Spec: T5, `c1-talk.md` §11, D36 (written for c).

- a) **One conversation forever**, compacted or restarted behind the scenes.
- b) **Daily fresh start** at a fixed hour, plus a "New conversation" button.
- c) **"New conversation" button only**, plus a forced fresh start when the session cannot go on.

Recommendation: c) — the plan (§3 C1) says exactly this; carried over: repos/plans/notes, canvas
cards, scheduled jobs and a short handover note; the old conversation stays readable.

Answer: (open)

## Q-O17 What the raw view shows

Security-relevant (what a screen can read). Plan C1: "A raw terminal view of the same session as a
toggle". Spec: T5, `c1-talk.md` §13 (written for b).

- a) **Every event of the agent as it wrote it**, tool output included.
- b) **Every event, tool output replaced by its size** (`[tool output: 3 412 bytes]`); room config
  `cockpit.raw.toolOutput: true` shows it.
- c) **A live terminal** through `server/terminals.mjs` (a writable pty on the room).

Recommendation: b) — the headless agent has no terminal to show, c) would hand a device token a
shell (plan §4: a token cannot act); tool output can carry what the agent read from files or logs,
so it stays off a desk screen unless the owner turns it on (safe by default, `docs/plans/product.md`).

Answer: (open)

## Q-O9 Screen sizes and orientation to design for

`spec-input.md` §7.9, and §2 "split or switching". Shapes every screen. Spec: T2, `screens.md`.

- a) **1368x912 landscape, touch only**, the one size checked.
- b) a) plus 1024x768 tablet and 1920x1080 wall screen without touch.
- c) b) plus portrait.

Recommendation: b) — split at ≥ 1280 px, switch below (`screens.md` §1, D9); also tell us the
tablet's panel size and viewing distance (research Q1 assumed 12.3 in at about 60 cm).

Also asked (review 21, finding 5): how many physical screens do you have today, and which layout
on each (`split`, `wall`, `canvas`)? `spec-input.md` does not say; the spec must not assume two.

Answer: (open)

## Q-O11 How talking starts: the talk button on the screen or behind the pane

Added by triage of review 21 (findings 2, 7). Blocks C1/C2; shapes `screens.md` §4 (D7). Spec: T4, T6.

- a) **The bottom-right 64x64 button is the talk button**: hold or tap and it listens at once and
  opens the pane with the live words; a smaller control opens the pane for typing and reading.
- b) The button opens the pane; the talk button is inside it (today's D7).
- c) a), and the button also carries a marker when the agent wants you (count or dot).

Recommendation: c) — `spec-input.md`: in the terminal talking is one held key, so it must be one
press here; the marker gives "speaks up on its own" a place on a closed-pane Wall.

Answer: (open)

## Q-O12 Where the conversation sits in `split` and `canvas`

Added by triage of review 21 (finding 3). Shapes `screens.md` §3, D5, D8. Spec: T4, T11.

- a) **A fixed conversation column/strip** inside the canvas, cards beside or above it, never under
  it; the 300 s auto-close (D5) applies only to the pane over the Wall and app views.
- b) The pane slides over the canvas half (today's D8), closing after 300 s.

Recommendation: a) — the agent answers by placing cards; hiding them behind the words that announce
them defeats the point.

Answer: (open)

## Q-O13 Canvas width: fixed or collapsing when idle

Added by triage of review 21 (finding 8). Shapes D9, S-SCR-01.

- a) **Fixed 608 px** canvas column (today's D9).
- b) **Collapses to a ~96 px strip** with a card count after N minutes without cards or talk, grows
  when a card arrives.

Recommendation: b) — the Wall is "the one place to see" the whole fleet; half-empty black costs it
44 % of the screen.

Answer: (open)

## Q-O8 Which screen the physical button targets

`spec-input.md` §7.8. Blocks the C2 button API. Spec: T7, `c2-voice.md` §11 (written for a: `--screen` per button token, else the screen touched last).

- a) **One screen named in config**; none named: the screen touched last.
- b) **The screen touched last**, always.
- c) **All screens** at once.

Recommendation: a) — predictable, and c) would open microphones in other rooms (privacy).

Answer: (open)

## Q-O20 How a physical button proves it may press talk

Security-relevant (a new kind of caller on the room). Blocks the C2 button API, not the rest of C2.
Spec: T7, `c2-voice.md` §11 (written for a), D52.

- a) **Its own token**, made by the room's CLI (`laneboard cockpit button add hall --screen desk`),
  shown once, stored hashed, able only to press and release talk on its target; revoked with
  `button remove`.
- b) **No token, loopback or LAN only**: any caller that reaches the room may press talk.
- c) **A screen's device token**, copied into the button.

Recommendation: a) — b) lets anything on the network open a microphone on the desk, and c) puts a
token that can read the conversation into a home automation box.

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

## Q-O14 A browser test runner in the repo

One-way-ish (a dependency in a public repo). Blocks every build night: all `Test:` lines assume a
browser driver, and `npm test` has none. From review 26 finding 1. Spec: a section "The acceptance
harness" in `slices.md`.

- a) **Playwright as a devDependency**, tests in `test/cockpit/*.spec.mjs`, run by
  `npm run test:cockpit`, not part of `npm test` until the `ci` VM has a browser.
- b) No dependency: drive Chromium over CDP with the launcher already in `loop/shoot.mjs`'s style
  (`node:child_process`, `node:test`); fewer features (no `page.clock`), more code to own.
- c) Playwright, and part of `npm test` from the first night.

Recommendation: a) — the scenarios need touch, fake clocks and fake microphones, which Playwright
gives; keeping it out of `npm test` leaves the existing 3454 tests and the hygiene run unchanged.

Answer: (open)

## Q-O15 Which process is "the room", and the origin the screen talks to

Security-relevant (a cross-origin device token). Blocks C1. From review 26 finding 2. Spec:
`README.md` (to decide), `screens.md` §6, T15, T17.

- a) **The room is a laneboard server started with a cockpit section** (`server/cockpit/`, config
  `server/config/cockpit.mjs`), and it also serves the cockpit page and `/api/cockpit/*`: the screen
  talks to its own origin, the cookie is same-site, no CORS.
- b) A separate Node program on the room; the hub-served page talks to it cross-origin with a
  bearer device token kept in memory plus `localStorage` (breaks D14).
- c) The hub proxies `/api/cockpit/*` to the room, so the screen only knows the hub's origin.

Recommendation: a) — one origin means an `HttpOnly` cookie works and nothing is stored in script-
readable storage; the hub (c) adds a hop to every audio frame and a second place for the token.

Answer: (open)

## Q-O16 Security-adjacent choices logged as decisions

Review 26 notes that three lines say "security-adjacent" in their own text but sit in
`DECISIONS.md`. For the owner to confirm in one letter each: **D13** (pairing code length,
lifetime, attempt cap), **D14** (nothing in browser storage), **D22** (links in replies are not
tappable).

- a) Confirm all three as written.
- b) Change one: say which and how.

Recommendation: a) — each is the stricter choice and can be loosened later.

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

## Q-O18 Size of the reply and the live words

From review 31-touch.md. Research Q1 recommends 26-30 px for text read while speaking; D21 settled
the 22 px floor. Spec: `c1-talk.md` §3, `c2-voice.md` §3.

- a) **22 px** (the floor): about 42 characters per line in the 560 px column, more on screen.
- b) **28 px**: about 33 characters per line, easier at 60 cm, replies run longer.
- c) 22 px with a setting the owner can raise.

Recommendation: b) — the owner reads at arm's length while talking; line length is the cheaper loss.
The spec stays at 22 px (pending Q-O18) until answered.

Answer: (open)

## Q-O19 Protecting dictation and answers from a missed tap

From review 31-touch.md finding 3. `CANCEL` (drops spoken words) and `STOP` (ends an answer) sit
16 px from the talk button; neither has an undo.

- a) **Undo**: `CANCEL` keeps the words 5 s with an `UNDO` in the same slot.
- b) **Gap**: 24 px between the slot and the talk button, `STOP` acts on release only.
- c) **Confirm** tap before dropping.

Recommendation: a) and b) together — nothing is lost for good, and a confirm would slow the
common case. Spec (pending Q-O19).

Answer: (open)
