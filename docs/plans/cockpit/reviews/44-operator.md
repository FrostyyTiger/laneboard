# Review, round 44: the operator

07:30. I want to know how the night went and what needs me, in under a minute, from the desk
screen. I walked the written spec (`spec/README.md`, `screens.md`, `c1-talk.md`, `c2-voice.md`,
`DECISIONS.md`, `QUESTIONS.md`) as that morning, good and bad, and shot `screens-room-down.html` and
`c1-pane.html` at 1368. C3, C4, coworker, protocols and stand-ins are not written yet; where my
morning depends on them I say so, because the C1/C2 slices are what I would get first.

## Findings, worst first

### 1. On the C1 morning the agent cannot see the night (`c1-talk.md` §5, Q-O23, `slices` order)
- What: S-C1-04 scripts "Two of three runs finished." from the fake agent. With the real agent in
  C1 there is no laneboard MCP server yet (C3, T8), and Q-O23 a) takes away `Bash` and web. So the
  agent can `Read`/`Grep`/`Glob` files on the room and nothing else. "How did the night go?" gets
  "I cannot see the fleet." The plan says C1+C2 are "the experience the owner already has in a
  terminal"; the terminal agent can see the fleet.
- Why it matters: the first real morning with the cockpit fails on its first question.
- Fix: in `slices.md` (T20) put the three read tools a morning needs, `morning`, `runs`, `alerts`,
  into the C1 night (or a C1.5 before C2), with one scenario: real bridge, stand-in hub, prompt
  "how did the night go?", the turn shows the tool line `read the Morning since 22:00` and a reply.
  Or state plainly in C1's done-when that C1 answers nothing about the fleet, so nobody expects it.

### 2. Stale data is answered as fresh (`screens.md` §7 "Board down", T8)
- What: "Board down" only covers the hub socket closing. Two bad mornings are missing: (a) the hub
  is up but a builder's feed stopped at 02:10, so its last state is 5 h old; (b) the hub is down
  but the room is up (`Pane and canvas: unchanged if the room is reachable`). In both the agent
  answers "builder-a is fine" from old data while the Wall is grey or the node is offline.
- Why: a confident wrong answer at 07:30 is worse than none. I act on it.
- Fix: every C3 tool result carries `asOf` per source (T8); the bridge's standing instructions
  (§5 "The agent's writing") add: "data older than 10 min is named with its age, e.g. `builder-a
  (feed from 02:10)`". Add an `S-C3-` scenario with one stale feed in the demo fleet (T18) asserting
  the reply text contains `02:10`. For (b) add a pane status line `Board unreachable since 06:41:
  the agent sees the same old data.` and a scenario.

### 3. Room down with the pane closed: nothing I would notice, and TALK does nothing (`screens.md` §7, `c2-voice.md` §3 `off`, D53, sketch `screens-room-down.html`)
- What: on `wall` with the pane closed, room down is a 12 px grey ring on the talk button. In the
  shot it is a dot I could not see from my chair. Worse: `off` makes the talk button `disabled`, and
  under Q-O11 the closed-pane talk button is how the pane opens by voice. I press, nothing happens,
  no message. Only `CHAT` opens the pane and tells me why.
- Why: the agent's machine down is the morning I most need to know about, and the screen goes quiet.
- Fix: in `off` the talk button stays tappable: a press opens the pane on its status line and does
  not open the microphone (`data-talk="off"` kept). On `wall` with the pane closed, show a one-line
  caption beside the Wall's bottom-right status lines, 18 px `--text-2`: `Agent away since 02:10`.
  Scenario: room down, pane closed, press TALK, assert the pane opens with the status line and no
  `getUserMedia` call.

### 4. "Since 06:41 (3 min)" breaks on an overnight outage (`screens.md` §7, S-SCR-17, `c1-talk.md` E2/E3)
- What: every "since" is `HH:MM` and the age is `(N min)`. A room down since 22:10 yesterday reads
  `since 22:10 (560 min)`, and `since 22:10` alone reads as today.
- Fix: one time format rule in `spec/README.md`: same day `06:41 (3 min)`, from 60 min `(1 h 12)`,
  another day `yesterday 22:10 (9 h 20)`, older `25 Oct 22:10`. Apply to the strip, status line,
  `Back since`, E2, E3, the unpaired line. One scenario with the room down since the previous day.

### 5. No "what needs me" entry point: speak-ups made overnight are lost in the scroll (`c1-talk.md` §2-§4, T23, Q-O11 c, Q-O5)
- What: if the agent spoke up three times overnight (quiet hours: lines only, Q-O5 b), at 07:30 I
  open the pane and it scrolls to the end. Nothing marks what came since I last looked, and the
  closed Wall shows nothing (the Q-O11 c marker and T23 are open).
- Why: "what needs me" is the morning question; the answer must not be "scroll and read".
- Fix: a per-screen `SINCE YOU LOOKED · 22:40` divider (like `NEW CONVERSATION`, 48 px, `--text-3`)
  before the first turn that arrived while that screen's pane was closed; the pane opens with that
  divider at the top, not at the end. Plus the Q-O11 c count on the talk button. Write it into
  T13/T23; one scenario: 3 scripted speak-ups at 03:00-05:00, open at 07:30, assert the divider
  and the scroll position.

### 6. Setting a timer and cancelling a job are out of every early slice, and the spec does not say so (Q-O23 a, D55-style)
- What: `spec-input.md` §3: the agent "can set up scripts and timers on its own machine ('shut this
  off in 3 hours')". Q-O23 a) (recommended) gives the agent no way to schedule anything until C6.
  `CANCEL JOB` appears in the room-down sketch and S-SCR-17, so the spec draws a job before any
  slice can make one.
- Why: two of my morning tasks (set a timer, cancel a job) silently do not exist; I would ask the
  agent and get a refusal line `tried Bash, not allowed`.
- Fix: Q-O23 must say in its options which `spec-input.md` §3 abilities each option removes, and
  until when. `slices.md` lists "set a timer" and "cancel a job" with the slice that brings them.
  Until then the bridge's instructions make the agent answer "I cannot schedule jobs yet (C6)."
  instead of trying `Bash`.

### 7. No line for "what a run cost" (`c1-talk.md` §5 tool table, T8)
- What: the app has a `credit` view (`screens.md` S-SCR-09 lists it); the C3 tool list (`fleet`,
  `runs`, `lanes`, `ci`, `alerts`, `morning`, `history`) has nothing for cost, and the tool-line
  table has no row for it.
- Fix: T8 adds cost to the `runs` result (per run, its credit/usage figures as the `credit` view
  shows them) or a `credit` tool; add its tool-line words (`looked at the cost of {target}`), and one
  `S-C3-` scenario "what did last night's run cost?" with a number from the demo fleet.

### 8. Fast means the agent's time too; nothing aims at it (`spec/README.md` speed budget)
- What: B1-B8 cover the screen's share only; "The agent's own time is not in the budget." A morning
  question with eight tool calls on Claude Code is 20-40 s. My budget is a minute for the whole
  morning, not one answer.
- Fix: a measured, not asserted, row B9 "prompt sent → first reply sentence, real agent, the
  morning question": target ≤ 15 s, read from the marks on the real screen; and the standing
  instructions say "for a broad question call `morning` once before any per-site tool". The
  `● WORKING` state should show the age from 3 s, not 10 s (§9 D35), so a slow answer is visibly
  alive in the first glance.

### 9. A logged-out agent is found only by my first question (`c1-talk.md` E4)
- What: E4 `not-logged-in` appears after I send. Subscription logins expire; the likeliest bad
  morning is "the agent was logged out at 03:00".
- Fix: the room checks the agent's login at start and every 15 min and sends a status line before
  any prompt: `The agent is not logged in on the room since 03:00. Log it in there.` (same slot as
  E3's status line). Same for `agent-down`, which already has one. Define which status line wins
  the one slot when room-down, agent-down and not-logged-in overlap (room-down first).

### 10. Speech down while I am still talking (`c2-voice.md` §10 `stt-down`)
- What: no `config` in 2.0 s closes the microphone and drops the held audio while I am mid-sentence
  on a hold; I find out on release, after 6 s of talking into nothing, because my eyes are on the
  main monitor.
- Fix: in a hold, `stt-down` at 2.0 s also changes the button at once to `error` (it does) and the
  hint line reads `NOT LISTENING` in the hint place, 18 px, until release. And after one `stt-down`
  the next press within 5 min tries the service once and falls back to opening the keyboard
  directly. Small; worth one D-line.

### 11. Sketches show what C1 will not have (`c1-pane.html`)
- What: header `● ANSWERING` (D56 says `● WORKING`), placeholder `Type, or hold TALK` (spec: `Type
  or hold to talk`), no `NEW`; the reply says `Say "show me" and I fly to it.` which needs C4. The
  room-down sketch shows the ring at about 6 px against the spec's 12 px.
- Fix: T47 as tracked, plus the reply text without a show promise in a C1 sketch.

## Contradictions with `spec-input.md`, and what should be owner questions

- Q-O23 a) (recommended) removes, until C6, what `spec-input.md` §3 states as the agent's job: "it
  manages (stop and start things, e.g. over SSH), and it can set up scripts and timers on its own
  machine". That is an owner question already, but the option text does not tell the owner that
  the "shut this off in 3 hours" timer goes with it (finding 6).
- `screens.md` §7: room down disables `CANCEL` on a job's countdown. `spec-input.md` §6: "Scheduled
  jobs are visible: on the board and on the canvas, cancellable. No hidden timers." A job that runs
  on the room while I cannot cancel it from the screen is a timer I cannot stop. Owner question:
  when the room is unreachable, is a job's run allowed (a) as scheduled, (b) only if the room can
  still be reached from a screen at the job's time, or (c) never without a link in the last N min?
- D14 (conversation in memory only) plus Q-O24 together decide whether the 07:30 tablet, rebooted
  overnight, shows last night's speak-ups. The spec rests this on T15; the owner should know the
  morning view depends on Q-O24.
- C1 with no fleet access (finding 1) contradicts plan C1+C2 "the experience the owner already has
  in a terminal"; it should be in `slices.md` as an explicit choice, not fall out of the task order.

## Rubric

score spec concrete 7
score spec complete 3
score spec consistent 5
score spec testable 7
score spec ownerfit 4
score spec simple 6
score spec safe 7
