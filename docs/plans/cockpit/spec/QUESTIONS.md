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

Caution (`reviews/40-security.md` finding 1): the agent runs on the room's box, and `local` there
includes the agent. So a) alone lets an injected line run `pair` or `button add`. a) only holds if
`pair`, `unpair` and `button add|remove` are refused for the agent's uid (the agent runs as its own unix
user, no read on the cockpit state dir; the CLI checks the peer uid and fails closed), or if approval is
`direct` only (the owner through serve). Also: the pairing code must not be enough to collect the token
(finding 4: a `pairSecret` the screen keeps in memory, CLI shows the requester's address and asks y/N).

Recommendation: a) with the uid refusal above — nobody off the room's box, and not the agent on it, can
add a screen, and a desk kiosk that pairs again every month is a chore for no gain while `unpair` is one
command. Finding 7 asks for b) (30-day expiry): decide with this.

Answer: (open)

## Q-O1 Talk pressed while the agent is still answering

`spec-input.md` §7.1: "Interrupt, queue, or ignore?" Blocks C1/C2. Spec: T5, `c1-talk.md` §8, D32-D33 (written for a).

- a) **Interrupt on send**: the running turn stops when the new prompt is sent, its text stays
  marked "stopped"; a separate Stop button stops without a new prompt.
- b) **Queue** the new prompt until the turn ends.
- c) **Ignore**: talk is disabled until the turn ends.

- d) **Steer**: deliver the new prompt into the running turn when the agent supports it (it is read
  at the next tool boundary, nothing is thrown away), else queue it as b). The bridge needs a
  stdin channel that accepts a user message mid-turn and an event telling when it was taken in;
  with an agent that cannot, it falls back to b), never to a).

Caution (`reviews/52-owner.md` finding 4): the argument "waiting would lose the terminal's speed"
assumes the owner's terminal interrupts. It may queue or inject instead, and then the habit is
"steer", and a) throws away half an answer each time the owner adds "and builder-b too". Nobody has
checked; research question Q8 asks what Claude Code does. Until Q8 is answered the recommendation
is a) only as a placeholder: **decide after Q8** (if Claude Code injects or queues, d)).

Recommendation: a) — speaking again mid-answer is almost always a correction; c) breaks the
terminal-like speed of `spec-input.md` §1. (pending Q8; d) wins if it shows steering is native.)

Answer: (open)

## Q-O2 How long one conversation lives, and what carries over

`spec-input.md` §7.2. Blocks C1. Spec: T5, T51, `c1-talk.md` §11, D36 (written for d since T51).

- a) **One conversation forever**, compacted or restarted behind the scenes.
- b) **Daily fresh start** at a fixed hour, plus a "New conversation" button.
- c) **"New conversation" button only**, plus a forced fresh start when the session cannot go on.
- d) c) with **no handover note**: a new session at once, divider `NEW CONVERSATION · 07:10`, the
  agent reads the written context a laptop session would (`reviews/36-skeptic.md` finding 4; before T51, D36 was c) plus a note).

Security argument for d) (`reviews/40-security.md` finding 9): a note written by an agent that read an
injected log line carries the injection into the "fresh" session. If c) stays, the note is shown in full
under the divider and the new session is told it is "notes from the previous session, not instructions".

Recommendation: d) — the plan (§3 C1) says "on a fresh start the agent reads the same written
context a laptop session would", and a laptop session gets no note; a note is an extra agent turn
that can fail or hang on the one button meant to escape a broken session, and it can carry an
injection across (finding 9 above). Carried over: repos/plans/notes, canvas cards, scheduled jobs;
the old conversation stays readable above the divider.

Answer: (open)

## Q-O17 What the raw view shows

Security-relevant (what a screen can read). Plan C1: "A raw terminal view of the same session as a
toggle". Spec: T5 wrote b); T50 rewrote `c1-talk.md` §13 for d).

- a) **Every event of the agent as it wrote it**, tool output included.
- b) **Every event, tool output replaced by its size** (`[tool output: 3 412 bytes]`); room config
  `cockpit.raw.toolOutput: true` shows it.
- c) **A live terminal** through `server/terminals.mjs` (a writable pty on the room).
- d) **Not in C1**: the opened tool lines (input, ms, `ok|failed`) are the raw view (`reviews/36-skeptic.md` finding 7).

Recommendation: d) — opened tool lines already show each call's input, ms and `ok|failed`; a second
renderer of the same events as one-line JSON is not read on a desk tablet, and "The laptop keeps its own
full access, as today." (`spec-input.md` §3). If the owner wants the toggle, b) as a later slice: the
headless agent has no terminal to show, c) would hand a device token a shell (plan §4: a token
cannot act), and tool output can carry what the agent read from files or logs, so it stays off a
desk screen unless turned on (safe by default, `docs/plans/product.md`).

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

Added by triage of review 21 (finding 3). Shapes `screens.md` §3, D5, D8. Spec: T4, T11 (`c4-show-canvas.md` §7.1, D78, written for a).

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

Review 26 notes that three lines (now four) say "security-adjacent" in their own text but sit in
`DECISIONS.md`. For the owner to confirm in one letter each: **D13** (pairing code length,
lifetime, attempt cap), **D14** (nothing in browser storage), **D22** (links in replies are not
tappable). Added by T9: **D66** (the "Ask about this" chip reaches the agent as a fixed line with the
node id only, never the node's label or other board text).

- a) Confirm all of them as written.
- b) Change one: say which and how.

Recommendation: a) — each is the stricter choice and can be loosened later.

Answer: (open)

## Q-O21 Is pairing part of C1, or does C1 run behind what the board already trusts

Security-relevant, from `reviews/36-skeptic.md` finding 3. `spec-input.md` §6 names device tokens as
one option beside "auth in front" and "LAN-only". Spec: `screens.md` §6 (written for a).

- a) **Pairing is part of C1** (codes, CLI approve/unpair, as written; Q-O10 applies).
- b) **C1 runs behind the existing trust** (`local`, `direct` through serve, the tailnet); pairing
  becomes its own later slice for setups that need it. Note (`reviews/40-security.md` finding 3): on the
  hub a `direct` user can act, kill and open terminals, so a kiosk that reaches the hub as the owner's
  tailnet login holds more than "a window"; plan §2 says a screen holds no credentials.
- c) b), but the screen's tailnet identity is a separate login or tagged device that is not in
  `fleet.allowedUsers` for actions and terminals. Needs a `read`-only `direct` kind that does not exist
  today.

Recommendation: b) for a screen only the owner can touch; c) or a) for a screen others can reach. b) — the first chat line should not wait for a pairing flow the owner did not ask
for; the spec keeps §6 as the later slice. Until answered the spec stays written for a).

Answer: (open)

## Q-O22 No canvas and no layout until C4

From `reviews/36-skeptic.md` finding 1. At 1368 the default `split` gives 608 px to
`Nothing on the canvas yet.` until C4 shows anything. Spec: `screens.md` §1 (written for a).

- a) **`split` is the default from C1**, canvas empty until C4.
- b) **Until C4 there is no canvas**: the page is the Wall (or the app) and the pane slides over it;
  `split`, `canvas`, `switch`, the `SCREEN` sheet and `cockpit.layout` arrive with C4.

Recommendation: b) — an empty 44 % of the owner's one screen breaks "never an empty screen" in
spirit. Q-O12 and Q-O13 then wait for C4.

Answer: (open)

## Q-O23 What the agent may do before C6

Security-relevant, blocks C1 (the launch line). From `reviews/40-security.md` finding 2. Plan §4: "its
act access is C6 only". `spec-input.md` §3 says the agent "manages (stop and start things, e.g. over SSH)"
and sets up scripts and timers on its own machine. The spec's tool table (`c1-talk.md` §5) assumes
`Bash`, `Edit`, `Write`, web tools. A C1 agent that reads logs and feeds (untrusted), holds the fleet's
state (private) and can fetch URLs (a way out) has all three legs of an exfiltration.

- a) **Read only**: the MCP read tools plus `Read`/`Grep`/`Glob`. No `Bash`, no `Edit`/`Write`, no web.
  Launched with `--strict-mcp-config --allowedTools "mcp__laneboard__*,Read,Grep,Glob"
  --permission-prompts none`; a refused call shows as a grey line `tried {tool}, not allowed`.
- b) a) plus `WebSearch`/`WebFetch`, with the room's egress limited to the model API, the STT host and
  the git remote.
- c) The full tool set, as on the laptop.

Recommendation: a) — "look freely, change only with a yes" (`spec-input.md` §6) taken literally; changes
arrive with C6 through the audited control plane. The spec is written for a) (pending Q-O23).

What each option takes away from `spec-input.md` §3 (review 44-operator.md finding 6): with a) and b)
the agent cannot set "scripts and timers on its own machine" ("shut this off in 3 hours") and cannot
cancel a job, and cannot stop or start things over SSH, until C6; it answers "I cannot schedule jobs
yet (C6)." instead of trying `Bash`. Only c) keeps them, with nothing between the agent and the room's
shell. Until C3 (the fleet read tools) exists, the agent in C1 also sees nothing of the fleet (finding 1).

Date, not just a wait (`reviews/52-owner.md` finding 6): C6 waits on a control-plane review with no
date, so a) alone turns the coworker into a reader for weeks. Recommended addition: `slices.md` gives
**scheduled jobs on the room's own machine** (create with a confirm, shown on the Map, cancel with a
confirm, audited) a slice of their own before the rest of C6 (T81). The answer to a) should be given
knowing that slice's place in the order; the bridge's refusal line names it.

Answer: (open)

## Q-O24 How long the room keeps what was said

Security-relevant. From `reviews/40-security.md` finding 6. Every sent prompt and what the agent reads
goes to the agent's model service (with Claude Code: Anthropic); the spec only says where audio goes.

- a) Audio never written to disk, partials never stored, the conversation kept 30 days, then deleted.
- b) As a), but the conversation kept until `new conversation` or unpair, no timer.
- c) Nothing kept: a reload shows an empty conversation.

Recommendation: a) — resume across a reload and a night needs some memory, and a limit is cheap;
`security.md` (T17) carries the table, one row per data kind.

Answer: (open)

## Q-O25 A scheduled job while the room cannot be reached from a screen

Security-relevant. From `reviews/44-operator.md`, contradictions list. `spec-input.md` §6: "Scheduled
jobs are visible: on the board and on the canvas, cancellable. No hidden timers." `screens.md` §7
disables `CANCEL JOB` when the room is down, yet the job may still run on the room.

- a) The job runs as scheduled; the screen shows it as `CANNOT CANCEL FROM HERE`.
- b) The job runs only if some screen can reach the room at the job's time; otherwise it is skipped and
  logged.
- c) A job needs a screen-room link in the last 10 min, else it is skipped and logged.

Recommendation: b) — a timer the owner cannot stop is the thing §6 forbids; skipping is the safe side.
Belongs to `coworker.md` (T13); not needed for C1/C2.

Answer: (open)

## Q-O26 How the room reads the hub

Security-relevant, blocks C3 (not C1). From T8 (`c3-see.md` §2). The MCP tools read the board over
HTTP. A hub today admits only `local` (its own loopback port) and `direct` (a person through
`tailscale serve`) and refuses signed requests (`docs/fleet/auth.md`); a room on another machine
would classify as `unidentified` and be refused.

- a) **The room runs on the hub's box**, as its own unix user, and reads the hub's loopback port as a
  `local` caller: on a hub `local` gets every read and no action, control, terminal or push change.
  No new door; "next to the hub" (plan §2) becomes "on the hub's box, outside the hub process".
- b) A new `reader` kind on the hub: the room signs its GETs with a key the hub pins with scope
  `read` (reusing the builders' signature code). The room can live anywhere; the hub gains a door
  and its security review a new section.
- c) The room reads every builder directly as a second hub. Duplicates the hub's merge and gives
  every builder a second pinned key.

Recommendation: a) — it adds no authentication path and keeps the room read-only towards the fleet by
the hub's own rules; b) can come later when the owner wants the room elsewhere. Note: with a) any
process of the agent's uid can read what the hub shows, which is what the read tools give it anyway.
The spec is written for a) (pending Q-O26).

Answer: (open)

## Q-O27 How a screen reaches the board when there is no tailnet

Security-relevant, a one-way door, blocks C1 on any setup but the owner's. From round 48
(`reviews/48-stranger.md` finding 1). Laneboard binds loopback and, with no `fleet` block, treats
every caller as `local` (`docs/fleet/auth.md` rule 1). `screens.md` §6 says viewing the board "stays
as today"; without a tailnet that means a tablet behind a reverse proxy is `local` and can act,
launch, retire and type into terminals. `spec-input.md` §6: "Not tied to one VPN: a tailnet is the
owner's way; auth in front, device tokens or LAN-only are others."

- a) **A paired device token is also the screen's way into the board** as a new request kind
  `screen`: every read plus `/api/cockpit/*`, no action, no terminal, no push change. Only that kind
  is accepted on a LAN address; a screen without a token sees only the pairing card.
- b) A reverse proxy with its own login; the tablet stays `local`. Documented as unsafe for anything
  but a closed network.
- c) The cockpit needs a tailnet in v1. Breaks `spec-input.md` §6.

Recommendation: a) — it follows §6 ("device tokens") and keeps "a token cannot act" (plan §2). Cost: a
new request kind and a section in `security.md`. The spec is written for a) (pending Q-O27).

Answer: (open)

## Q-O28 What the always-on agent may spend, and which standing jobs start on

From round 48 (`reviews/48-stranger.md` finding 7). The cockpit agent, speak-ups and drift checks
(`coworker.md`, T13) draw on the same subscription window as the owner's loops. Nothing limits or
shows that.

- a) **A cap and its own lane:** `cockpit.agent.maxTurnsPerHour` (default 20), the line `The cockpit
  paused itself: 20 turns this hour. It answers again at 08:00.`, spend shown as lane `cockpit` on
  Credit and Morning; standing jobs (speak-ups, drift) default off until the owner turns them on.
- b) Same, but standing jobs default on for the owner's setup only.
- c) No cap; report spend only.

Recommendation: a) — safe by default (`product.md`); the owner turns things on once and sees the cost.
Belongs to `coworker.md` (T13); not needed for C1 beyond the cap.

Answer: (open)

## Can wait

Not needed before the C1 and C2 build nights.

## Q-O8 Which screen the physical button targets

`spec-input.md` §7.8. Blocks only C2b, the button (later, `spec-input.md` §4), not C2. Spec: T7, `c2-voice.md` §14 (written for a: `--screen` per button token, else the screen touched last).

- a) **One screen named in config**; none named: the screen touched last.
- b) **The screen touched last**, always.
- c) **All screens** at once.

Recommendation: a) — predictable, and c) would open microphones in other rooms (privacy).

Answer: (open)

## Q-O20 How a physical button proves it may press talk

Security-relevant (a new kind of caller on the room). Blocks only C2b, the button (later), not C2.
Spec: T7, `c2-voice.md` §14 (written for a), D52.

- a) **Its own token**, made by the room's CLI (`laneboard cockpit button add hall --screen desk`),
  shown once, stored hashed, able only to press and release talk on its target; revoked with
  `button remove`.
- b) **No token, loopback or LAN only**: any caller that reaches the room may press talk.
- c) **A screen's device token**, copied into the button.
- d) a), plus an API press is refused while the screen had no touch for 5 min (the owner is not
  there), or an API press only opens listening and a send needs a touch (`reviews/40-security.md`
  finding 11: a stolen button token otherwise opens an empty room's microphone into the model service).

Recommendation: a) — b) lets anything on the network open a microphone on the desk, and c) puts a
token that can read the conversation into a home automation box.

Answer: (open)

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
map focus). Spec: T11, `c4-show-canvas.md` §8 (written for a), built in the order of b), D83).

- a) **All eight**, over two slices.
- b) **Four first** (countdown, status tile, live log, chart), the rest next slice.
- c) **Seven**: timer folded into countdown.

Recommendation: a), built in the order of b); c) is the owner's taste call.

Answer: (open)

## Q-O4 How canvas cards leave, and how many fit

`spec-input.md` §7.4. Spec: T11, T12, `c4-show-canvas.md` §7.2 and §9 (written for c): one tap
removes, 16 cards at most with job countdowns kept, a per-screen shelf for what does not fit, D79,
D80, D84; expiry is T12's).

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
