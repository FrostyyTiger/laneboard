# Review, round 36: the skeptic

Read: `spec/README.md`, `screens.md`, `c1-talk.md`, `c2-voice.md`, `DECISIONS.md` (D1-D54),
`QUESTIONS.md`, against `../README.md` and `../spec-input.md`. Sketches shot at 1368 (dark):
`c1-pane.html`, `c2-states.html`.

The question I asked of every block: what does the owner get from it on the first morning of C1 and
C2, and would anyone miss it if it were not there? The core is good and small: a pane, a typed or
spoken prompt, a streamed text reply, tool lines, stop, a few errors. Around it the spec has grown
about as much machinery again, most of it for slices that do not exist yet or for cases the owner
will hit once a year. Today C1 + C2 + screens hold 68 scenarios. A night cannot build that, and the
plan says "one slice per night, each usable".

## Findings, worst first

### 1. The owner's default screen opens with half of it empty (screens §1, S-SCR-01, S-SCR-10, D9)
At 1368x912 the default is `split`: 608 px of canvas. The canvas has nothing to show until C4 (show
commands and kit blocks). So for C1, C2 and C3 the owner's one known screen gives 44 % of its width
to `Nothing on the canvas yet.` That is the "chat box bolted onto a dashboard" in its purest form,
and it breaks the product rule "never an empty screen" in spirit, if not in letter.
**Fix:** until C4 ships there is no canvas and no layout: the Wall page is `wall`, and the pane
slides over it as in the app. `split`, `canvas`, `switch`, the `SCREEN` sheet, `cockpit.layout`,
the switch button and its card count (S-SCR-01, -06, -07, -08, -10, -11, D2, D3, D8, D9) move to
`c4-show-canvas.md` and the C4 slice. Q-O12 and Q-O13 then wait for C4 too.

### 2. The physical-button HTTP API is C2 work for a "later" feature (c2-voice §11, S-C2-18, S-C2-19, D52, Q-O8, Q-O20)
`spec-input.md` §4: "**Later**, a physical button on the desk does the same." The spec builds it now:
a new token kind, a CLI with three verbs, a 12-row response table, a rate limit, a 1 s wait-for-screen
with 504, "the screen touched last" tracking (a new screen→room message every 10 s), `Origin`/`Cookie`
refusal, audit lines, and two owner questions (one security-relevant). That is a new authenticated
door into the room that opens a desk microphone, built before the owner has used voice once.
What the owner gets now: nothing. The talk key (`F13`, D51) already covers a USB macro key.
**Fix:** C2 keeps the talk key only. §11's "button API" part, S-C2-18/19, D52, Q-O8 and Q-O20 move to
a later slice ("C2b, the button"). The talk button is still "an API" in the plan's sense: the page's
press/release functions, which the talk key calls.

### 3. Pairing blocks C1, but the owner never asked for device tokens (screens §6, S-SCR-13..16, D13, Q-O10)
`spec-input.md` §6: "Not tied to one VPN: a tailnet is the owner's way; auth in front, device tokens
or LAN-only are others." Device tokens are one of three options, not the owner's. The spec makes a
pairing flow (codes, alphabet, 300 s, 10-code cap with 429, polling every 2 s, CLI approve/list/unpair,
`PAIR THIS SCREEN AGAIN` texts) a precondition of the first chat line, and Q-O10 says "blocks C1".
**Fix:** C1 runs behind what the board already trusts (`local`, `direct` through serve, the
tailnet); pairing becomes its own slice for the setups that need it. This is a one-way-ish,
security-relevant choice, so it is an owner question (below), not a cut I can make for them.

### 4. The handover note is a new feature hidden inside D36 (c1-talk §11, S-C1-22)
Plan C1: "on a fresh start the agent reads the same written context a laptop session would." The
spec adds: a hidden prompt to the old session, a 15-line `handover.md`, a 30 s limit, a sixth turn
state `● HANDING OVER`, three divider texts, a 10 s confirm bar, and folding the old turns behind a
button. The laptop session has no handover note; the owner said the two agents "share knowledge
through what is written down". The note adds a moving part (an agent turn that can fail or hang)
to the one button meant to escape a broken session.
**Fix:** `NEW` → `START`/`KEEP` bar (keep: one tap from losing the thread) → new session at once →
divider `NEW CONVERSATION · 07:10`. Cut the handover note, `handing-over`, `NO HANDOVER NOTE`. If the
owner wants a note, it is an option under Q-O2, not a decision.

### 5. Fixing a word maps word indexes between two different texts (c2-voice §7, D47, S-C2-11, S-C2-12)
`caretPositionFromPoint`, word counting over the shown text, then selecting "the word with the
same index in the final", which differs (S-C2-11 itself: `restart` vs `Restart`, `builder-b` vs
`builder-b.`; finals add and merge words). It will select the wrong word often enough to be worse
than nothing. Plus a printable-key path and a `final`-state path.
**Fix:** a tap on the live words stops listening and puts the final in the textarea, caret at the end,
keyboard up. The owner moves the caret. Cut the word selection, the key path and S-C2-12's second run.

### 6. Five speech-service failure codes, a slow detector and a fleet-wide "down" broadcast (c2-voice §10, D50, S-C2-15, S-C2-17)
For the owner there are two cases: nothing was heard (say so, typing works) and words were heard but
not finished (they are in the input, not sent). The spec has `stt-down`, `stt-busy`, `stt-refused`,
`stt-failed`, `stt-no-final`, plus `data-talk-slow` with two thresholds and a hysteresis, plus a 30 s
room-kept cause that strikes the talk glyph on every other screen. The slow hint repeats what the
owner already sees (words lagging). The cross-screen glyph is a second screen's problem the owner
learns on the first press anyway.
**Fix:** two lines: `stt-down` (covers no answer, 401, 403; `{detail}` names which, so setup still
gets its hint) and `stt-failed` (covers error, bad close, no final; words kept). Cut the slow hint,
`data-talk-slow` and the 30 s broadcast; S-C2-15 drops its second page, S-C2-17 keeps only the
no-final half.

### 7. The raw view duplicates the tool-line expansion and nobody reads JSON on a desk tablet (c1-talk §13, S-C1-24, Q-O17)
Opened tool lines already show each call's input, ms and `ok|failed` (§5). The raw view adds a
second renderer of the same events as one-line JSON at 16 px, with its own paging (500 events),
truncation, a config key to show tool output, and an owner question. "When the rendered view hides
something" the owner has the laptop with full access (`spec-input.md` §3).
**Fix:** cut it from C1. Since the plan names it, ask the owner (below); until answered, the tool-line
expansion is the C1 "raw" view.

### 8. Four ways to fold a long thing (c1-talk §3, §9, D23, D27, D35)
`SHOW ALL <n> LINES` (code), `SHOW ALL <n> ROWS` (tables), `SHOW THE REST (<n> CHARACTERS)` (replies
over 20 000), `SHOW EARLIER` (50 turns), plus `↑ TOP OF ANSWER` and a live age counter in the label.
The bridge already tells the agent "lead with the answer, at most 3 sentences per paragraph" (§5).
**Fix:** keep the code fold (log lines really are long) and `SHOW EARLIER` (performance). Cut the
table fold (20 rows at 44 px is 880 px: one scroll), `SHOW THE REST` and `↑ TOP OF ANSWER` (a flick
does it). Keep the age only from 10 s, as is; it answers "is it hung?".

### 9. Six turn states where three carry information (c1-talk §2)
`thinking`, `working`, `answering` are each already visible in the conversation: the prompt with
`· SENDING`, a tool line with `●`, the `▍` cursor. The header word repeats them in 16 px `--text-3`
at the far top of the pane, away from the hand and the eye.
**Fix:** header shows `READY`, `● WORKING` (any of the three) and `● STOPPING`. `data-turn` may keep
the fine values for tests; the drawn text does not need three words for one fact.

### 10. Room-down UI is specced for parts that do not exist yet (screens §7, S-SCR-17, D53, D54)
`STALE` plates, a countdown's `The room is down: this job may not run.`, a disabled `CANCEL` on a job,
an empty-canvas variant, offline remove queued for later: all canvas (C4) and jobs (coworker). The
ring on the talk button repeats the button's own `off` state (disabled, grey `TALK`).
**Fix:** for C1/C2 room-down is: the 80 px status line, `RETRY NOW`, `SEND` and talk `off`, the draft
kept, the cut-off line. Move the canvas half of §7 and S-SCR-17's card assertions to C4. Cut the ring
(D53).

### 11. Speed-budget measurement is a feature of its own (spec/README "Speed budget", D28)
Marks for eight budgets, two of them (B5, B6) for C4, a "screen and room's share" column the
implementer already showed cannot be measured, and `?perf=1` listing 20 measures in a header menu
that does not exist. The tests can time from outside; the owner will not read a perf menu.
**Fix:** keep the end-to-end column and the marks for tests. Cut `?perf=1` and the share column
(T35 already half-says this). B5/B6 move to C4.

### 12. The question list is too long for 15 minutes, and some are not questions (QUESTIONS.md)
13 open questions sit ahead of "Can wait". Q-O16 asks the owner to confirm three choices that are
already the strict, safe default: that is a decision, not a question (safe by default). Q-O13
(collapsing canvas) adds a moving part to a canvas that does not exist yet. Q-O14 is a repo-tooling
call the implementer can make with a D-line and a devDependency the owner can strike.
**Fix:** drop Q-O16 (keep D13/D14/D22 as written), move Q-O12/Q-O13 under "Can wait" with finding 1,
and order the rest by what C1 needs first: Q-O11, Q-O1, Q-O2, Q-O15, then C2.

### 13. Small things that earn nothing
- `c1-talk.md` §10: E6 and E8 differ only by `the model service said`; same button. Merge into
  `The answer failed: {detail}.`
- `c1-talk.md` §12 screen names in labels (`YOU · DESK · 07:02`) and S-C1-23's two-token test: the
  owner has not said they have two screens (Q-O9). Keep the shared conversation (plan §2), defer the
  names.
- `c2-voice.md` §4 `NOTHING HEARD IN 30 S · MICROPHONE OFF` vs `NOTHING HEARD` vs
  `2 MIN LIMIT · MICROPHONE OFF · TEXT KEPT`: three hints for "the microphone closed". One:
  `MICROPHONE OFF` plus `TEXT KEPT` when there is text.
- Sketch `c1-pane.html`: placeholder `Type, or hold TALK` vs the spec's `Type or hold to talk`
  (already T47). Sketch `c2-states.html`: in cells 2-5 the two buttons swap words at once (`SEND`→
  `CANCEL`, `TALK`→`SEND`); two labels changing side by side is the most confusing moment of the
  pane. Not a cut, but worth one look in the owner's Q&A (it is Q-O19's neighbourhood).

## Decided where `spec-input.md` disagrees, or the owner should have been asked

- **Pairing as a precondition of C1** (`screens.md` §6, Q-O10 "blocks C1"): `spec-input.md` §6 lists
  device tokens as one option beside "auth in front" and "LAN-only". Ask: is C1 behind the board's
  existing auth, with pairing a later slice? Recommendation: yes.
- **The button HTTP API in C2** (`c2-voice.md` §11): `spec-input.md` §4 says "later". Should be a
  later slice; the talk key alone is C2.
- **The handover note** (D36): not in the plan or `spec-input.md`; it changes what a fresh start is.
  Belongs among Q-O2's options, not in a D-line.
- **`split` as the default with an empty canvas before C4** (D9, `screens.md` §1): a layout taste on
  the owner's one known screen, decided by width; with finding 1 it should be "no canvas until C4".
- **The raw view's form** (Q-O17): the plan's "raw terminal view" is reasonable to ask about, but the
  better question is whether C1 needs it at all; add option d) "not in C1, tool-line expansion is
  enough", recommended.

## Rubric

score spec concrete 9
score spec complete 4
score spec consistent 5
score spec testable 7
score spec ownerfit 5
score spec simple 3
score spec safe 7
