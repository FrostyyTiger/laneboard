# Cockpit spec: questions for the owner

What only the owner can decide: taste, one-way doors, anything security-relevant that changes what
the owner sees or what the agent may do. Small reversible choices, and build or security
engineering with a strict default, go to `DECISIONS.md` instead, with an overrule the owner can
strike. The spec is written for the recommendation and marks that text `(pending Q-O<n>)`; when
the owner answers, the answer goes on the `Answer:` line and the marked text is fixed to match.

Numbers and option letters are never reused or renumbered (the spec cites them), so a list may skip
a letter. Q-O1 to Q-O9 come from `../spec-input.md` §7; the rest came from writing and reviewing
the spec. The final round (71) cut each question to its options and one line of recommendation;
the longer reasoning is in git history (commit `cc2474c` and before) and in the reviews named.

## For the morning, worst first

The first fourteen, about 15 minutes: a letter per question is enough. Ordered by what the C1 build
night needs first, then C2. The first five change what C1 builds; the rest change a slice or a size.

## Q-O11 How talking starts

Blocks C1/C2. From `reviews/21-owner.md` (2, 7). Spec: `screens.md` §4, `c1-talk.md` §2, D7.

- a) The bottom-right 64x64 button is the talk button: hold or tap and it listens at once, the pane
  opens with the live words; a smaller `CHAT` opens the pane for typing.
- b) The button opens the pane; the talk button is inside it.
- c) a), and the button carries a marker when the agent wants you.

Recommendation: c) — in the terminal talking is one held key (`spec-input.md`), so here it is one press.

Answer: (open)

## Q-O1 Talk pressed while the agent is still answering

Blocks C1/C2. `spec-input.md` §7.1 ("Interrupt, queue, or ignore?"). Spec: `c1-talk.md` §8,
S-C1-16, S-C1-27, S-C1-28, S-C1-29, S-C2-09, D32/D33, D121-D124 (written for d since T85).

- a) Interrupt on send: the running turn stops, its text stays marked "stopped".
- b) Queue the new prompt until the turn ends (or "ignore": talk off until then).
- d) Steer: the new words go into the running turn at its next tool boundary (Claude Code's
  default, research Q8); `STOP` is the separate way to end it; an agent that cannot steer queues.

Recommendation: d) — it is what the owner's terminal does, and nothing already said is thrown away.
With d), "stop, do this instead" is `STOP` then the new words; a send while a long tool call runs
waits for that call (minutes, research Q8), shown as `· QUEUED`. Choosing a) instead: D32's overrule
and the old §8 (git history before T85) come back.

Sub-question (review 81-touch.md): where does `STOP` live under d)? s1) in the `SEND` slot (x 1200-1264,
y 824-888) as D32 has it, inert for 1.0 s after any send or cancel from the slot, acting on
`pointerup` only, with a `■` glyph; s2) a header `STOP`, away from the hand (D32's overrule).
Recommendation: s1 with the guard, because "stop, do this instead" with a draft in the input is rare
and the slot is where a terminal user's Ctrl+C habit goes; s2 removes the double-tap risk entirely
if the owner mistrusts the guard.

Answer: (open)

## Q-O23 What the agent may do before C6

Security, blocks C1 (the launch line). From `reviews/40-security.md` (2), `44-operator.md` (6),
`52-owner.md` (6). Spec: `c1-talk.md` §5.2 (written for a, T57), `protocols.md` §11.2, `slices.md` (T81).

- a) Read only: the fleet read tools plus `Read`/`Grep`/`Glob`; no `Bash`, `Edit`, `Write`, web. A
  refused call shows `tried {tool}, not allowed`; scheduled jobs on the room's own machine get their
  own slice before the rest of C6.
- b) a) plus `WebSearch`/`WebFetch`, the room's egress limited to the model API, speech and git.
- c) The full tool set, as on the laptop (keeps "scripts and timers on its own machine" from day one).

Recommendation: a) — "look freely, change only with a yes" (`spec-input.md` §6) taken literally.

Answer: (open)

## Q-O30 May a scheduled job touch another machine, before C6

From `reviews/73-owner.md` (3). Spec: `slices.md` §3.7 (slice Jobs), D115. `spec-input.md` §3's
example is shutting something off in three hours.

- a) As written: a job only reminds, or runs a script from `cockpit.jobs.scripts` on the room's own
  machine; a job that changes another machine waits for C6. The agent says
  `I can remind you at 15:10, but stopping builder-b needs the act step (C6).`
- b) A script listed in `cockpit.jobs.scripts` (the owner's own config, reviewed in the infra repo)
  may touch other machines; a job is created and cancelled only through the confirm card, one audit
  line per fire. The agent says `I can run stop-builder-b at 15:10. Confirm?`.

Recommendation: b) — a listed script is already the owner's yes; a) leaves only an alarm clock and
C6 has no date. Needs the confirm card of `c5-c6.md` (T14, unwritten), which blocks slice Jobs.

Answer: (open)

## Q-O21 Pairing in C1, or C1 behind what the board already trusts

Security, blocks C1. From `reviews/36-skeptic.md` (3), `40-security.md` (3). Spec: `screens.md` §6,
`slices.md` §3.1 (C1's ids under each answer).

- a) Pairing is part of C1 (codes, CLI approve/unpair; Q-O10 applies).
- b) C1 runs behind the existing trust (`local`, `direct` through serve, the tailnet); pairing is
  its own later slice. Note: on the hub a `direct` user can act and open terminals.
- c) b), but the screen's tailnet login is not in `fleet.allowedUsers` for actions (needs a new
  `read`-only `direct` kind).

Recommendation: b) for a screen only the owner can touch; the first chat line should not wait on pairing.

Answer: (open)

## Q-O27 How a screen reaches the board when there is no tailnet

Security, a one-way door, blocks C1 on any setup but the owner's. From `reviews/48-stranger.md` (1).
Without a `fleet` block every caller is `local`, so a tablet behind a reverse proxy can act.

- a) A paired device token is the screen's way in, as a new request kind `screen`: every read plus
  `/api/cockpit/*`, no action, terminal or push change; only that kind is accepted on a LAN address.
- b) A reverse proxy with its own login, the tablet stays `local`; documented as closed-network only.
- c) The cockpit needs a tailnet in v1 (breaks `spec-input.md` §6, "not tied to one VPN").

Recommendation: a) — it follows §6 ("device tokens") and keeps "a token cannot act" (plan §2).

Answer: (open)

## Q-O29 How the screen reaches the room when board and room are two processes

Security-relevant deployment door. From `reviews/59-implementer.md` (1). Spec: D89, D92,
`protocols.md` §1, D128, D129 (written for the recommendation by T86).

- a) Same origin: a front (reverse proxy or `tailscale serve`) forwards `/api/cockpit/` to the room.
- b) Through the hub: the hub proxies the room's routes and relays show commands (a new trust edge).
- c) One process only in v1: the room is always part of the process that serves the page.

Recommendation: a), with c) as the one-box default — the hub stays unchanged and origin checks simple.

Answer: (open)

## Q-O10 Who approves a screen's pairing, and how long its token lives

Security. Needed in C1 only if Q-O21 is a) or c), or Q-O27 is a). From `reviews/40-security.md`
(1, 4, 7). Spec: `screens.md` §6, D13, T56.

- a) Only the room's own CLI approves (`laneboard cockpit pair K7M-4QX`), refused for the agent's
  unix user; the CLI shows the requester's address and asks y/N; tokens live until `unpair`.
- b) a), plus a token expires after 30 days without being seen.
- c) Any already paired screen may approve a new one.

Recommendation: a) — nobody off the box, and not the agent on it, can add a screen; `unpair` is one command.

Answer: (open)

## Q-O2 How long one conversation lives

Blocks C1. `spec-input.md` §7.2. Spec: `c1-talk.md` §11, S-C1-22, D36 (written for d).

- a) One conversation forever, compacted or restarted behind the scenes.
- c) A `NEW` button, plus a forced fresh start when the session cannot go on, with a handover note.
- d) c) without the handover note: the new session reads what a laptop session reads.

Recommendation: d) — plan §3 C1 says so, and a note can fail on the escape button or carry an injection.

Answer: (open)

## Q-O22 No canvas and no layout until C4

Blocks C1's screen. From `reviews/36-skeptic.md` (1). Spec: `screens.md` §1 (written for b),
`slices.md` §3.1.

- a) `split` is the default from C1, the canvas empty until C4.
- b) Until C4 the page is the Wall or the app with the pane over it; `split` and the canvas come with C4.

Recommendation: b) — an empty 44 % of the one screen breaks "never an empty screen" in spirit.

Answer: (open)

## Q-O24 How long the room keeps what was said

Security. From `reviews/40-security.md` (6). Every prompt and what the agent reads goes to its model
service (with Claude Code: Anthropic). Spec: written for a) since T91 (`protocols.md` §11.7.1, D154, S-C1-39); `security.md` (T17).

- a) Audio never on disk, partials never stored, the conversation kept 30 days, then deleted.
- b) As a), but kept until `NEW` or unpair, no timer.
- c) Nothing kept: a reload shows an empty conversation.

Recommendation: a) — resume across a reload needs some memory, and a limit is cheap.

Answer: (open)

## Q-O18 Size of the reply and the live words

Taste, C1. From `reviews/31-touch.md`; research Q1 gives 26-30 px for text read while speaking.
Spec: `c1-talk.md` §3 and §7, `c2-voice.md` §4, D21: written for b) since T97 (`TYPE_TALK = 28`; a) changes the constant and the input's 4-line height, 182 → 157 px).

- a) 22 px, about 42 characters per line in the 560 px column.
- b) 28 px, about 33 characters per line (21 in the input), easier at 60 cm.
- c) 22 px with a setting the owner can raise.

Recommendation: b) — read at arm's length while talking; line length is the cheaper loss.

Answer: (open)

## Q-O19 Protecting dictation and answers from a missed tap

Touch, C2. From `reviews/31-touch.md` (3), `63-touch.md` (2). Spec: `c2-voice.md` §2-§3, D40/D42 (T42, T95).

- a) Undo: `CANCEL` keeps the words 5 s with `UNDO` in the same slot.
- b) Gap: 24 px between the slot and the talk button; `STOP` acts on release only.
- d) Move `CANCEL`: while listening the slot is blank, `CANCEL` is a 48x48 `✕` at the left end of
  the live-words box, far from where the finger sends.

Recommendation: a), b) and d) together — nothing is lost for good and the sending finger never lands on drop.

Answer: (open)

## Q-O9 Screen sizes, and how many screens

Shapes every screen. `spec-input.md` §7.9 and §2. Spec: `screens.md` §1, D9.

- a) 1368x912 landscape touch only.
- b) a) plus 1024x768 tablet and a 1920x1080 wall screen without touch.
- c) b) plus portrait.

Recommendation: b). Also tell us: how many screens today, which layout on each, the panel size and distance.

Answer: (open)

## Q-O6 What a screen shows when the agent's machine is down

`spec-input.md` §7.6. Spec: `screens.md` §7, S-SCR-17..19, D120 (written for a).

- a) The board keeps working, the pane says the agent is away (since when, `RETRY NOW`, draft kept).
- b) An error screen until the room is back.
- c) The cockpit disappears silently.

Recommendation: a) — "never an empty screen" rules out b), and c) hides a fault.

Answer: (open)

## Decided instead

Asked earlier, closed as D-lines because the strict choice is safe by default (`reviews/52-owner.md`
finding 3). Strike the D-line to reopen one; its overrule part lists the other options. These are
also in PROGRESS.md's "Needs you" list, because D89, D90 and D91 are security-relevant.

- **Q-O14** A browser test runner in the repo → **D88**: Playwright as a devDependency, outside `npm test`.
- **Q-O15** Which process is "the room", and its origin → **D89**: a laneboard server with a `cockpit` section, same origin as the page (rewritten by T86 to D92's split: the board serves the page, the room only `/api/cockpit/*`; modes D128, pending Q-O29).
- **Q-O16** Security-adjacent choices → **D90**: D13, D14, D22 and D66 stand as written.
- **Q-O26** How the room reads the hub → **D91**: the room runs on the hub's box as its own user and reads loopback as `local`.

## Can wait

Not needed before the C1 and C2 build nights. Same rules; listed in slice order.

## Q-O17 What the raw view shows

Security (what a screen can read). Plan C1: "a raw terminal view … as a toggle". Spec: `c1-talk.md`
§13 (written for d since T50).

- a) Every event of the agent as written, tool output included.
- b) Every event, tool output replaced by its size; a per-screen setting on the room shows it
  (`laneboard cockpit screens set <screen> raw-output on`, off by default; `c1-talk.md` §13).
- d) Not in C1: the opened tool lines (input, ms, `ok|failed`) are the raw view.

Recommendation: d) — the laptop keeps full access (`spec-input.md` §3); b) if the owner wants the toggle later.

Answer: (open)

## Q-O12 Where the conversation sits in `split` and `canvas`

C4. From `reviews/21-owner.md` (3). Spec: `c4-show-canvas.md` §7.1, D78 (written for a).

- a) A fixed conversation column inside the canvas, cards beside or above it, never under it.
- b) The pane slides over the canvas half and closes after 300 s.

Recommendation: a) — hiding cards behind the words that announce them defeats the point.

Answer: (open)

## Q-O13 Canvas width: fixed or collapsing when idle

C4. From `reviews/21-owner.md` (8). Spec: D9, S-SCR-01.

- a) Fixed 608 px canvas column.
- b) Collapses to a 96 px strip with a card count when idle, grows when a card arrives.

Recommendation: b) — the Wall is "the one place to see" the fleet; half-empty black costs it 44 %.

Answer: (open)

## Q-O3 Kit blocks in version 1

C4. `spec-input.md` §7.3. Spec: `c4-show-canvas.md` §8, D83.

- a) All eight (timer, countdown, chart, table, live log, checklist, status tile, map focus), over two slices.
- b) Four first (countdown, status tile, live log, chart), the rest next slice.
- c) Seven: timer folded into countdown.

Recommendation: a), built in the order of b); c) is a taste call.

Answer: (open)

## Q-O4 How canvas cards leave, and how many fit

C4. `spec-input.md` §7.4. Spec: `c4-show-canvas.md` §7.2, §9, D79/D80/D84 (written for c).

- a) Dismissed by hand only.
- b) Expire only.
- c) Both: one tap removes (with undo), cards bound to something that ended leave on their own, 16 at most, older ones to a shelf.

Recommendation: c) — nothing wanted vanishes, finished countdowns do not pile up.

Answer: (open)

## Q-O5 How loud the agent is when it speaks up, and quiet hours

Coworker slice. `spec-input.md` §7.5. Spec: `coworker.md` (T13, not written).

- a) Always a line only.
- b) Tiered: info a line; needs-you a line and a card; urgent adds a sound; quiet hours on by default.
- c) Everything at full volume.

Recommendation: b) — follows the board's trouble ranking (alerts, Stuck).

Answer: (open)

## Q-O28 What the always-on agent may spend, and which standing jobs start on

Coworker slice. From `reviews/48-stranger.md` (7).

- a) A cap (`cockpit.agent.maxTurnsPerHour`, default 20, then `The cockpit paused itself …`), spend as lane `cockpit` on Credit and Morning, standing jobs off until turned on.
- b) Same, but standing jobs on by default for the owner's setup only.
- c) No cap; report spend only.

Recommendation: a) — safe by default; the owner turns things on once and sees the cost.

Answer: (open)

## Q-O25 A scheduled job while no screen can reach the room

Security, jobs slice. From `reviews/44-operator.md` (contradictions). `spec-input.md` §6: "No hidden timers."

- a) The job runs; screens show `CANNOT CANCEL FROM HERE`.
- b) The job runs only if some screen can reach the room at its time; else skipped and logged.
- c) A job needs a screen-room link in the last 10 min, else skipped and logged.

Recommendation: b) — a timer the owner cannot stop is what §6 forbids.

Answer: (open)

## Q-O8 Which screen the physical button targets

C2b, the button (later). `spec-input.md` §7.8. Spec: `c2-voice.md` §14 (written for a).

- a) One screen named in config; none named: the screen touched last.
- b) The screen touched last, always.
- c) All screens at once.

Recommendation: a) — predictable; c) would open microphones in other rooms.

Answer: (open)

## Q-O20 How a physical button proves it may press talk

Security, C2b. From `reviews/40-security.md` (11). Spec: `c2-voice.md` §14, D52 (written for a).

- a) Its own token from the room's CLI (`laneboard cockpit button add hall --screen desk`), stored hashed, able only to press and release talk.
- b) No token, loopback or LAN only.
- d) a), and an API press only opens listening; a send needs a touch on the screen.

Recommendation: a) — b) lets anything on the network open a microphone on the desk.

Answer: (open)

## Q-O7 The first "act" list, and which actions always need a confirm

C6, after the control-plane review. `spec-input.md` §7.7. Spec: `c5-c6.md` (T14, not written).

- a) No act in version 1.
- b) A short list of reversible actions (stop a run, restart a service), each confirmed.
- c) Every control-plane action, each confirmed.

Recommendation: open until the control-plane review; the spec assumes a), and every act ever added needs a confirm.

Answer: (open)
