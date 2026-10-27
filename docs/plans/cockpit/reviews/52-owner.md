# Review, round 52: the owner

Read: `spec-input.md`, plan §6-§8, `PROGRESS.md`, `spec/README.md`, `screens.md`, `c1-talk.md`,
`c2-voice.md`, `QUESTIONS.md`, `DECISIONS.md` (D1-D87, titles), `c3-see.md` §5-§6,
`c4-show-canvas.md` §7. Sketches shot at 1368 (dark): `c1-pane.html`, `screens-split.html`,
`c4-canvas.html`, `c2-states.html`. My earlier review is `21-owner.md`; this one does not repeat
what has since been fixed (the speed budget, Q-O11, Q-O12, the canvas column). Quotes in "…" are
from `spec-input.md`.

## Findings, worst first

1. **The night is spending its rounds on new chapters while C1 still cannot be built.**
   (`PROGRESS.md`.) Rounds 46-51 wrote C3 and C4 (T8-T11). Meanwhile 50 fix tasks from reviews
   (T21-T79) are open, and the four files a C1 build night cannot start without are not written:
   `protocols.md` (T15/T16), `stand-ins.md` (T18), `slices.md` (T20) and the C1 fixes (T26, T27,
   T29, T41, T52, T54-T56). The deadline is 20:00 today. If the night ends like this, tomorrow I get
   a beautiful spec of a canvas and no Talk. Fix: freeze new content. Order for the remaining rounds:
   T55 (question list), T15, T16, T18, T20 with T37/T62, then the C1/C2 fix tasks. T12-T14, T17
   (except what C1 needs), T19 wait. Add this order as a priority note in `PROGRESS.md`, as round 22
   did.

2. **My first question gets no answer in C1.** (`slices.md` missing; T62 open; Q-O23 text.) The
   plan's own example is "07:00, the owner taps Talk and says 'how did the night go?'". The read
   tools are C3, so a C1 agent sees nothing of the fleet. A C1 that can chat but cannot see is a
   toy I would not open twice. Fix: in `slices.md`, C1 ships with `morning`, `runs` and `alerts`
   (`c3-see.md` §4.2, §4.5, §4.6) against the stand-in hub, and one scenario: "how did the night
   go?" → tool line `read the Morning for tonight` → a reply naming the stuck run. The rest of C3
   (`focus`, hold menu, `history`) stays C3.

3. **28 questions is not a 15-minute morning.** (`QUESTIONS.md`.) Plan §6.2: "Owner Q&A (morning,
   ~15 min)". 19 questions sit above "Can wait". Several are not mine to answer: Q-O14 (Playwright
   as a devDependency), Q-O15 (which process is the room), Q-O16 (confirm D13/D14/D22/D66), Q-O26
   (how the room reads the hub). I will answer them by picking the recommendation without
   understanding the cost, which is worse than you deciding and logging it. Fix: T55 now. Q-O14,
   Q-O15, Q-O16 and Q-O26 become D-lines I can strike; Q-O13, Q-O17, Q-O24 move under "Can wait";
   the top of the list is the eight that change what I see or what the agent may do (Q-O1, Q-O2,
   Q-O9, Q-O11, Q-O18, Q-O21, Q-O22, Q-O23), each one line plus the recommendation.

4. **Q-O1's recommendation claims to match my terminal, but my terminal may not interrupt.**
   (`c1-talk.md` §8, Q-O1, D32.) The argument for a) is "waiting would lose the terminal's speed".
   In the terminal I use today, sending while the agent works may queue the message and hand it
   in at the next step, while a separate key interrupts. If so, my habit is "steer", not "kill
   and restart", and a) throws away half an answer every time I add "and builder-b too". I do not
   know the exact behaviour, so do not decide it from my word either. Fix: add research question
   `Q8 What does Claude Code do with a prompt sent while a turn runs (queue, inject at the next tool
   boundary, interrupt)? — for T5/T16`, and add option d) "steer: deliver the new prompt into the
   running turn when the agent supports it, else queue" to Q-O1 with what the bridge would need.

5. **The coworker never speaks up yet, after 52 rounds.** (`coworker.md` not written; T13, T23,
   T66 open; Q-O5.) "It **speaks up** on its own when something needs the owner, not only when
   asked." That is half of why the agent lives on an always-on machine. Today the spec has one
   sentence ("Speaking up … uses the same states", `c1-talk.md` §2) and a pending marker in Q-O11
   c). I can live with it not being in C1. I cannot live with not knowing which slice brings it.
   Fix: `slices.md` names the slice (my guess: right after C3, before the canvas), and T23's one
   scenario (touring Wall, pane closed, speak-up arrives, marker on the talk button, tour holds on
   the flagged node) is written before the night ends.

6. **Until C6 the agent cannot do the thing I gave as the example.** (Q-O23 a), `c1-talk.md` §5.)
   "shut this off in 3 hours" → it schedules that itself" and "it manages (stop and start things,
   e.g. over SSH)". Q-O23 a) is the safe default and I would probably pick it for C1. But the spec
   puts every change into C6, which waits on a control-plane review with no date, and five slices
   come first. That turns my coworker into a reader for weeks. Fix: in `slices.md`, give scheduled
   jobs on the room's own machine (create with a confirm, visible on the Map, cancel with a
   confirm, audited) a slice of their own before the rest of C6, and say so in Q-O23 so I answer it
   knowing the date. Until then the bridge's line `I cannot schedule jobs yet (C6).` (T62) must
   name the slice that brings it.

7. **The sketches show a different product from the spec.** (Sketches.) `c1-pane.html`: header
   `● ANSWERING` (spec: `● WORKING`, D56), placeholder `Type, or hold TALK` (spec: `Type or hold to
   talk`), no `NEW`, no `CHAT`, and the reply promises `Say "show me" and I fly to it.`, which needs
   C4. `screens-split.html`: `AGENT` button (spec: talk button plus `CHAT`, Q-O11), no conversation
   column (spec: D78, the column under the cards in `split`), card frames in another style (title
   caps first, `agent · 22:38` lowercase; spec §7.3 has `AGENT · 07:12` on top). `c4-canvas.html`:
   tool line `read the fleet` (the table's wording is `looked at the fleet`), the talk button shows
   a dot, not the microphone. In the morning I will look at the pictures, not at 4 000 lines. Fix:
   T47 and T70 before the night ends, plus `screens-split.html` redrawn to D78 (this is T25's
   sketch: reply and fresh card both visible).

8. **The index and glossary lie about the state.** (`spec/README.md`.) The file table says
   `screens.md` part 2 is "planned (T3)" (done since ba70963). The glossary says the cockpit button
   is `AGENT` and the talk button sits "in the pane"; both changed with Q-O11's recommendation. The
   budget's note still points at a `?perf=1` "header menu" that does not exist (T53). A builder
   reads the glossary first. Fix: one round updates the file table and these three glossary
   entries, marked `(pending Q-O11)`.

9. **Small text where I read while talking.** (`c2-voice.md` §3 hint line 13 px; `c1-talk.md` §7
   length note 13 px; `CANCEL` 13 px; T43 open.) The hint line `RELEASE TO SEND · SLIDE OFF TO
   KEEP` is exactly what I glance at while holding the button at arm's length on a slanted screen.
   13 px is unreadable there. Fix: T43 as written (18 px for instructions), and Q-O18 near the top
   of the list: my eyes decide the reply size, not a research floor.

10. **The 30 s silence limit is short for how I talk.** (`c2-voice.md` §4, D45.) In tap mode I
    tap, then think. Thirty seconds with no word closes the microphone; that is fine. But the hint
    shows only 5 s after the close, so when I look back from the main monitor the screen just reads
    idle and I do not know it stopped listening. Fix: after a limit closes the microphone, keep
    `MICROPHONE OFF` until the next touch or press, not 5 s (the other cases can keep 5 s). One
    D-line.

11. **The canvas sketch is what I wanted. Do not lose it to cuts.** (`c4-canvas.html`,
    `c4-show-canvas.md` §7-§8.) Cards left, conversation right, the countdown bound to a job with
    `CANCEL JOB`, a log, a chart: that is "a sandbox screen world where you can show me things".
    Q-O22 b) (no canvas until C4) is right. Make sure `slices.md` keeps C4's first night to the six
    blocks of D83 and nothing else, so it lands soon after C3.

## Decided where it should have been my call, or against what I said

- **Q-O1 recommendation a)** rests on a claim about my terminal that nobody checked (finding 4).
- **Q-O23 a) plus "everything that changes waits for C6"** takes away "sets up scripts and timers on
  its own machine" and "stop and start things" from `spec-input.md` §3 with no date (finding 6).
  The safety argument is right; the missing date is the problem.
- **Q-O14, Q-O15, Q-O16, Q-O26** are asked of me but are build and security engineering; decide them
  as D-lines with a clear overrule (finding 3).
- **D45** (5 s hint after an automatic close): small, but it decides whether I notice the
  microphone stopped (finding 10).
- Fine as decided: D29 (listening starts on press), D31/D34/D12 (nothing is ever resent on its
  own), D46 (microphone per press), D51 (talk key F13), D55 (physical button later: "Later" is my
  word), D78 (conversation column beside the cards), Q-O12 a), Q-O22 b), Q-O17 d) (no raw view: I
  have the laptop), Q-O2 d) (`NEW` only, no handover note).

## Scores

score spec concrete 8
score spec complete 3
score spec consistent 4
score spec testable 7
score spec ownerfit 5
score spec simple 3
score spec safe 7
