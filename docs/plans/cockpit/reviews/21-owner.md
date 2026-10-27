# Review, round 21: the owner

Read: `spec/README.md`, `screens.md` (§1-§8, S-SCR-01..23), `DECISIONS.md` (D1-D17), `QUESTIONS.md`
(Q-O1..Q-O10), sketch `screens-split.html` shot at 1368 (dark). Judged against `spec-input.md` and
the plan. Scenario ids and texts below are the spec's; quotes in "…" are from `spec-input.md`.

## Findings, worst first

1. **The thing I actually do every day is not specced yet.** (`spec/README.md` file table; PROGRESS
   T4-T7.) After 20 rounds only `screens.md` exists. No pane, no talk button, no live words, no
   reply rendering. My reference is "hold a key, watch the words appear live, release" and "In the
   terminal it works really well"; none of that has a single scenario. Screens are the frame, C1/C2
   are the product. Fix: the next build-shaped rounds go to T4-T7 before T3's sketch, T8+ or
   anything else. Nothing in C3-C6 matters to me if talking feels slower than the terminal.

2. **Talking takes two taps and a hunt.** (`screens.md` §4, D7; glossary "talk button".) From the
   Wall I tap `AGENT`, the pane slides in, then I find the talk button inside it. In the terminal
   it is one key, held. "On the screen there is no key, so a button: tap to start and tap to send,
   or hold and release." That button should be on the screen, not behind a pane. Fix: the bottom-
   right 64x64 button **is** the talk button: hold it (or tap it) and it starts listening at once
   and opens the pane with the live words; a separate, smaller control opens the pane for typing
   or reading. Add a scenario: from the touring Wall, press-and-hold the button at t = 0, first
   partial word visible ≤ 1 s later, release sends. If you disagree, make it a `Q-O` question; do
   not settle it in D7 as a label choice.

3. **On the canvas, the pane covers the answer.** (D8, `screens.md` §3 "In `split` the pane opens
   over the canvas half".) The agent answers "in text and by moving the screen and placing cards".
   In `split`, the pane sits on top of the canvas, so the card it just placed is hidden behind the
   conversation that announces it. In `canvas` layout (my "Screen 2 … where the owner talks to the
   agent") the conversation is a pane that closes itself after 300 s (D5). That is backwards: on
   the canvas screen the conversation should be a permanent part of the layout, next to the cards.
   The sketch shows the problem too: the canvas column is three cards and ~45 % empty black, with
   no conversation anywhere. Fix: in `canvas` and `split`, the conversation is a fixed column/strip
   of the canvas (e.g. the lower part of the 608 px column, or a 360 px column in `canvas`), cards
   above or beside it, never under it; D5's auto-close applies only to the pane over the Wall and
   app views. Add a sketch `screens-split-pane.html` with a reply and a fresh card both visible.

4. **No speed budget anywhere.** ("the cockpit must keep that speed"; "a timer must not take 5
   minutes".) `screens.md` has exact pixels but almost no latency targets: S-SCR-08 says a card in
   ≤ 1 s, S-SCR-01 says ≤ 2 s to load, that is all. Fix: one table in `spec/README.md` or `c1-talk.md`
   that every later file cites: tap → listening ≤ 0.2 s; speech → first partial ≤ 1 s; release →
   prompt shown sent ≤ 0.3 s; send → first reply token on screen (fake agent) ≤ 0.5 s plus the
   agent's own time; show command → camera moving ≤ 0.3 s; kit block placed ≤ 1 s after the tool
   call. Each scenario that has a timing asserts against it.

5. **"Two screens is the owner's case" is invented.** (`screens.md` §3.) `spec-input.md` §1 says "A
   touch screen sits on the desk"; §2 describes screen 1 and screen 2 as roles and "A user with one
   screen gets both, split or switching". How many physical screens I have today is not written
   anywhere. Meanwhile the default at 1368 is `split`. Fix: drop "(the owner's case)", and add it
   to Q-O9 ("How many screens today, and which layout on each?"). Write the spec so one 1368x912
   tablet in `split` is the main path, since that is the size the night designs for.

6. **Cancel on a card skips the "yes".** (Sketch `screens-split.html`: `CANCEL JOB` on the
   countdown card; `screens.md` §7 room-down "its `CANCEL` is disabled".) "Anything that changes
   state shows a confirm on the screen; every action is logged." Cancelling a scheduled job changes
   state. Nothing says the tap asks first. Fix: say it now in `screens.md` (or put it in T13's
   done-when): `CANCEL JOB` opens the confirm card (`c5-c6.md`) with what/where/when; one audit
   line per cancel. Same for the one-tap remove of a card only if removing a card can stop a job
   (it must not: say so).

7. **When the agent speaks up, the Wall screen does not know where to show it.** (`screens.md` §2,
   §4.) "It speaks up on its own when something needs the owner." On a `wall` screen with the pane
   closed, there is no reserved place for that: the button has a grey ring for "room down" but no
   state for "the agent wants you". Fix: reserve it here even if T13 decides loudness: the cockpit
   button gets a second marker (e.g. a count or a dot, colour per the design colour rule and Q-O5),
   and the tour holds or flies to what the agent flagged. One `S-SCR-` scenario with a scripted
   speak-up turn on a touring `wall` screen.

8. **The 608 px canvas and 759 px wall half feel cramped for "the one place to see".** (D9,
   S-SCR-01, sketch.) I want the overview first. At 759 px the map in the sketch is fine for 6
   nodes, but "many more VMs and machines" is the expectation. A fixed 608 px canvas that is half
   empty takes 44 % of the screen. Fix: let the canvas column collapse to a narrow strip (e.g. 96
   px with a card count) when it has no cards and no conversation in the last N minutes, and grow
   back when a card arrives. Or make D9 a question: it is taste, not a small reversible detail.

9. **Pairing is fine, but explain where I type the command.** (`screens.md` §6, Q-O10.) "On the
   cockpit room, run: `laneboard cockpit pair K7M-4QX`" is right for security (Q-O10 a) is my
   pick too). It means I SSH to the room for every new screen; acceptable, it is rare. Add one
   line: the laptop agent can run it for me over SSH (that is how I do everything else), and
   S-SCR-14's CLI output is what that agent reads back.

10. **Bookkeeping: T3 looks half done.** (PROGRESS T3, `screens.md` §6-§8.) §6-§8 and S-SCR-13..23
    are written and D10-D17 logged, but T3 is still `[ ]` and `sketches/screens-room-down.html`
    does not exist. Fix: the next round writes the sketch and ticks T3, or marks what is missing.

## Decided where it should have been my call

- **D5** pane auto-closes after 300 s: taste, and wrong for the canvas screen (finding 3).
- **D7** `AGENT` label and the talk-behind-a-pane flow: this decides how talking starts, the core
  of C2 (finding 2). Should be a `Q-O`.
- **D8** pane over the canvas half in `split`: decides whether I see the agent's cards while
  talking (finding 3). Should be a `Q-O`.
- **D9** fixed 608 px canvas: layout taste on my one screen (finding 8).
- **`screens.md` §3** "Two screens (the owner's case)": not in `spec-input.md` (finding 5).
- **Sketch `CANCEL JOB`** without a confirm contradicts "change only with a yes" (finding 6).
- Fine as decided: D3, D4 (tour stops when I talk: exactly right), D10-D12 (draft never sent on
  its own: right), D13, D14, D15, D16, D17. Q-O10 a) and Q-O6 a) match what I would answer.

## Scores

score spec concrete 8
score spec complete 2
score spec consistent 6
score spec testable 8
score spec ownerfit 5
score spec simple 6
score spec safe 7
