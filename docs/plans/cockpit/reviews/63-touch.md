# Review, round 63: the touch user

Persona: one finger, a slanted tablet at arm's length (~60 cm), no hover, the on-screen keyboard
only. Read: `spec/c1-talk.md`, `spec/c2-voice.md`, `spec/screens.md` §1-§4 and §7, `spec/c3-see.md`
§9, `spec/c4-show-canvas.md` §4-§5 and §7-§9, `DECISIONS.md` D19-D21, D40, D42, D77, D84, D87,
`QUESTIONS.md` (top eight, Q-O19), the round-31 touch review and T40-T47.
Shot at 1368 (dark): `c1-pane`, `c2-states`, `c3-ask`, `c4-canvas`, `screens-split`,
`screens-room-down`.

Since round 31 the touch fixes T40-T45 and T47 are all still open. Findings 1, 5, 7, 10 and 11
below repeat them only because the problem is still in the files; the rest are new (mostly in
C3 §9 and C4, which round 31 did not see).

## Findings, worst first

### 1. The on-screen keyboard is still not specified, and C2/C3 now bring it up on purpose (c1-talk §1/§7, c2-voice §7, c3-see §9.4; S-C1-14, S-C2-11/12; T40)
- What: nothing says what moves when the on-screen keyboard comes up. Meanwhile c2-voice §7 (D47)
  now deliberately focuses the textarea after a tap on the live words "so the on-screen keyboard
  comes up", caret at the end. On a 912 px landscape screen the keyboard takes roughly the bottom
  350-400 px: the input row (Wall y 808-912), the chip row (y 744-808) and `SEND` sit exactly
  there. Every typing scenario uses `keyboard.type`, so a build passes with the input hidden.
- Why it matters: typing is half the product ("Typing must always work too", `spec-input.md` §4),
  and the fix-a-word path ends in a keyboard over the words I want to fix.
- Fix: do T40 before any C1 night. Add to it: after D47's focus the input row sits on the
  keyboard's top edge with the caret line in sight; the chip row (if any) stays directly above it;
  the conversation keeps ≥ 200 px. Scenario: emulate a 380 px keyboard (resize the viewport to
  1368x532 after focus, `interactive-widget=resizes-content`), assert the input, `SEND`, the talk
  button and the chip are inside the visual viewport.

### 2. During listening, `SEND` moves one slot right and `CANCEL` takes its place; lifting on `CANCEL` during a hold sends (c2-voice §2-§3, D42, S-C2-07; sketch `c2-states` cells 2-5)
- What: idle, the word `SEND` lives at x 1200-1264 (the slot). Listening, the talk button at
  x 1280-1344 reads `SEND` and the slot at x 1200-1264 reads `CANCEL`. The hint says
  `TAP SEND WHEN DONE`. My typing habit sends with the slot; in tap mode the slot now drops my
  words. Worse, during a hold: sliding the finger onto the visible `CANCEL` and lifting there is
  inside the 48 px margin (x ≥ 1232), so it **sends**. S-C2-07's own second case lifts at
  (1250, 830), which is on `CANCEL`, and expects a send.
- Why it matters: the one button that destroys dictation sits where the finger already goes to
  send, and the gesture that looks like "cancel" sends. Both are accidental-touch harms.
- Fix (with Q-O19 a+b, which the spec has not been written for): while the microphone is open the
  slot is inert and blank (no target, `aria-hidden`); `CANCEL` becomes a 48x48 `✕` inside the live
  words box at its left end (Wall x 792-840), far from the blind target, with Q-O19's 5 s
  `WORDS DROPPED · UNDO`. Slide off counts only left of x 1232 **or** above y 776 with the release
  also outside the slot's rect padded by 8 px; a release over the slot cancels (it is what the eye
  sees). Change S-C2-07's second case to lift at (1330, 900) (bottom-right drift, sends) and add a
  third: lift on the slot, nothing sent, draft kept. Update D40/D42.

### 3. The chip row collides with `↓ NEW`, the hint line, the error lines and the length note (c3-see §9.4, c1-talk §4/§7, c2-voice §3/§5, screens §7; sketch `c3-ask`)
- What: on the Wall the chip row is y 744-808. `↓ NEW` is "centred 16 px above the input row",
  48 px tall: y 744-792, x about 1016-1112. A short chip (`ABOUT vm-b room`, sketch) ends near
  x 1030 with its 48x48 `✕` at about x 982-1030: the two targets overlap by ~14 px. The hint line
  ("8 px above the input row"), the microphone/STT error line ("last line 8 px above the input
  row"), the room-down line (`Sending and voice come back with the room.`) and the length note all
  claim y ~776-800, inside the chip row.
- Why it matters: a tap on `↓ NEW` can remove my context chip; the hint that tells me a hold was
  understood is drawn under the chip.
- Fix: one stacking rule in `c1-talk.md` §1, from the input row upward: (1) the line slot, 32 px,
  for exactly one of hint / error / room-down / length note (priority in that order); (2) the chip
  row, 64 px; (3) `↓ NEW` floats 16 px above the topmost of these and is centred over the text
  column only when no chip is present, else right-aligned at x 1248-1344. Put all of it in T44's
  rect table with the ≥ 8 px no-overlap test, and add a scenario: chip present, scrolled up,
  `↓ NEW` and chip `✕` rects do not intersect.

### 4. A press on the talk button while the room is down does nothing at all (c2-voice §3 `off`, screens §7; sketch `c2-states` cell 8, `screens-room-down`; T64)
- What: `off` is `disabled`. With the pane closed on the Wall the only cue is a 12 px grey ring.
  I press, nothing happens: no pressed state, no line, no pane.
- Why it matters: "immediate feedback on every tap". A dead button reads as a broken screen.
- Fix: T64 as written (stays tappable, a press opens the pane on its status line, never the
  microphone), plus: the press shows the pressed state (finding 7) and the line
  `Sending and voice come back with the room.` gets 18 px `--text-1` for 5 s after such a press.

### 5. Type the owner reads while acting is still 13-16 px grey, and the spec is not written for Q-O18's recommendation (c2-voice §3 hint line and `CANCEL`, c1-talk §1 turn state, §3 label rows and code language, §7 length note, §8 `SENDING STOPS THE ANSWER`, screens §7 `STALE` and the room-down line; T43)
- What: hint lines 13 px caps `--text-2`; `CANCEL` 13 px; `STALE` 13 px; the header turn state
  (`● WORKING`, the one thing I glance at) 16 px `--text-3`; `Sending and voice come back with the
  room.` 16 px `--text-3`. In the `c2-states` shot `RELEASE TO SEND · SLIDE OFF TO KEEP` is the
  smallest text on screen. Q-O18 recommends 28 px for reply and live words, yet the spec stays at
  22 px "until answered", against the night's rule to write for the recommendation.
- Fix: T43 as written; write the reply and live words at 28 px (pending Q-O18) and recheck the
  input's 27-characters-per-line figure (about 21 at 28 px) and the 157 px growth.

### 6. A show line's `UNDO` removes a card with no way back; two `UNDO`s stacked 8 px apart (c4-show-canvas §4, §7.4, §9; sketch `c4-canvas`)
- What: `UNDO` on a `place` line removes the card (§7.4), but only `✕` gets the 10 s
  `CARD REMOVED · UNDO` row (§9, D84). The sketch shows two place lines, each with a 96x48 `UNDO`,
  8 px apart vertically, at the pane's right edge where my hand rests while scrolling the
  conversation. A brush removes a card that took the agent a minute.
- Fix: a card removed by a show line's `UNDO` gets the same §9 row on the screen where it was
  tapped. Give show lines 16 px between consecutive `UNDO`s (rows 64 px, or `UNDO` 40 px tall
  inside a 56 px row is too small: keep 48 and grow the row). S-C4-17 gets a second case.

### 7. Still no pressed state for any tappable, and new tappables keep arriving (all files; T45)
- What: nothing says what the screen shows when my finger lands on `CLOSE`, `NEW`, `SCREEN`,
  `RETRY`, `UNDO` (show line, card), card `✕`, chip `✕`, `ASK ABOUT THIS`, `CANCEL JOB`,
  `TO FRONT`, `SHELF 2`, checklist rows, `↓ 3 NEW`, `BACK TO NOW`, the language button.
- Fix: T45's rule (fill `--bg-sunken`, border to `--text-2`, first frame after `pointerdown`, no
  transition; `touch-action: manipulation`), with one table-driven test over every selector in
  T33's table.

### 8. Scrolling a card body can tick a checklist row on every screen (c4-show-canvas §8.7, D87; §8.4, §8.6)
- What: checklist rows are tappable and their bodies scroll ("more scroll"); a tap toggles the row
  on every screen. Nothing says a drag that starts on a row is not a tap. The `table` card in `w`
  scrolls inside an 80 px window (2 rows) and the `log` card's `↓ 3 NEW` (48 px) covers 2 of its 5
  lines: tiny nested scroll regions on a slanted screen.
- Fix: card-body rows act on `pointerup` within 8 px (`TAP_SLOP_TOUCH`) of `pointerdown` and
  never after the body scrolled; one scenario flicks a checklist and asserts no tick. In `s`/`w`
  card bodies do not scroll: overflow shows a 48 px `+ 12 MORE` row that grows the card to `l`
  (or `TO FRONT`).

### 9. The way out of the pane is still contradictory and at the far edge (c1-talk §2, screens §4, S-SCR-01; T41)
- What: c1 §2 hides the opener while open; screens §4 says it "stays where it is and reads
  `CLOSE`"; S-SCR-01 asserts an `AGENT` button. The only exit on touch is `CLOSE` at the pane's
  top right. In `split`/`canvas` the `SCREEN` sheet (four rows) still has no `CANCEL` row and no
  outside-tap close.
- Fix: T41 and T44 as written. Note `c3-see` §9.3 already does it right (`CANCEL` row, outside tap
  closes and does nothing else); copy that rule to the `SCREEN` sheet.

### 10. Tool lines are 44 px and S-C1-07 asserts 44 (c1-talk §5, S-C1-07; T45)
- Fix: 48 px rows, `+`/`−` 20 px `--text-2`; S-C1-07 asserts ≥ 48 px. (D77 already cites "a 44 px
  tool row is under the 48 px target" for show lines: the same reasoning applies.)

### 11. Links still look tappable and are not (c1-talk §3, S-C1-09; T45)
- Fix: as T45: a `<span>`, no underline, a long-press step in S-C1-09.

### 12. `pointercancel` during a hold still drops the send, and D40 is out of step (c2-voice §2, D40)
- What: c2 §2 now counts slide-off only left or up (good), but a `pointercancel` (a palm on the
  glass, the browser stealing the gesture near the edge) never sends. D40 still says "more than
  48 px outside" with no direction and names the hint `KEPT AS DRAFT, NOT SENT`, which c2 §4
  replaced with `MICROPHONE OFF · TEXT KEPT`.
- Why it matters: a hold I meant to send ends as a draft I may not notice, because the hint that
  says so is 13 px (finding 5).
- Fix: keep the draft on `pointercancel` (nothing is sent by accident), but show its hint at
  18 px `--text-1` and keep it until the next touch, as T84 does for the automatic closes; rewrite
  D40 to match c2 §2 and §4 word for word. Add a `pointercancel` case to S-C2-07.

### 13. The `NEW` bar: slot height and button order (c1-talk §11, S-C1-22; T44)
- What: the bar sits "in the status-line slot (§1, 48 px)" but the status line is 80 px (D54).
  `START` and `KEEP` are "at its right" with no order or gap; `START` is the one-way action.
- Fix: say 80 px or 48 px once; `KEEP` at the right end, `START` 16 px left of it, both 48x96;
  S-C1-22 asserts the order and gap.

### 14. Sketches out of step (c3-ask, c4-canvas, c1-pane, screens-split; T47, T70, T82)
- `c3-ask.html`: the menu is drawn over the node, not with its bottom-left 24 px right of and
  above the finger (§9.3), so the hand would cover it; its head reads `backup` while the chip reads
  `vm-b` (two moments in one picture without a caption).
- `c4-canvas.html`: the talk button shows a dot, not the microphone; the tool line reads
  `read the fleet` (c1 §5: `looked at the fleet`).
- `c1-pane.html`, `screens-split.html`: T47's items.
- Fix: redraw with T47/T82; `c3-ask` shows the finger point and the menu offset from it.

## Decided where `spec-input.md` or the night's rules say otherwise, or that should be owner questions

- Written against the recommendation (the night's rule: write the spec for the recommendation,
  marked pending): Q-O18 recommends 28 px, the spec is at 22 px (finding 5); Q-O19 recommends undo
  plus gap, the spec has neither (finding 2); Q-O1 recommends d) steer, `c1-talk.md` §8 and
  S-C1-16 / S-C2-09 are still written for a) interrupt (T85 open). Under steer the `SEND`/`STOP`
  slot rules change, so finding 2's fix must be done after T85.
- Internal contradiction, unchanged since round 31: `screens.md` §4 (button stays, reads `CLOSE`)
  vs `c1-talk.md` §2 (opener hidden) vs S-SCR-01 (`AGENT`).
- Internal contradiction: D40's hint text and slide-off rule vs `c2-voice.md` §2/§4.
- Internal contradiction: `NEW` bar "48 px" vs the 80 px status-line slot (D54).
- Should be an owner question (add to Q-O19 as option d): whether `CANCEL` moves away from the
  talk button into the live-words box (finding 2). It changes where the owner's hand learns to go.
- `spec-input.md` §4 "tap to start and tap to send, or hold and release. Both should work":
  honoured (D29, D39). No conflict.

## Rubric

score spec concrete 8
score spec complete 4
score spec consistent 4
score spec testable 7
score spec ownerfit 6
score spec simple 5
score spec safe 5
