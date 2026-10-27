# Review, round 31: the touch user

Persona: one finger, a slanted tablet at arm's length (~60 cm), no hover, no keyboard unless the
on-screen one. Read: `spec/screens.md`, `spec/c1-talk.md`, `spec/c2-voice.md`, `spec/README.md`
(budgets), `spec/DECISIONS.md` D1-D46, `spec/QUESTIONS.md` Q-O9/Q-O11/Q-O12, `research/Q1-touch-targets-and-type.md`.
Shot at 1368 (dark): `c1-pane.html`, `c2-states.html`, `screens-split.html`.

## Findings, worst first

### 1. The on-screen keyboard is not specified at all (c1-talk §1, §7; S-C1-14; sketch c1-pane)
- What: the input row sits at the very bottom of the pane (y 808-912 on the Wall). A tablet's
  on-screen keyboard covers roughly the bottom 40 % of a 912 px landscape screen. The spec never says
  what moves: the input row, `SEND`, the talk button, the conversation, the hint line. §7 even keeps
  the keyboard up after send ("an on-screen keyboard stays up") but gives no way to put it away.
  S-C1-14 tests typing only with `keyboard.type`, so a build passes with the input hidden behind
  the keyboard.
- Why it matters: typing is half the product (`spec-input.md` §4: "Typing must always work too").
  If I tap the input and it disappears under the keyboard, typing does not work.
- Fix: a § "With the on-screen keyboard" in `c1-talk.md`: the page sets
  `<meta name="viewport" content="…, interactive-widget=resizes-content">` and sizes the pane to
  `visualViewport.height`; the input row sits directly on the keyboard's top edge; the header and
  `CLOSE` stay; the conversation takes what is left (≥ 200 px at a 380 px keyboard) pinned to its
  end; the talk button stays in the input row (not at the screen corner) while the keyboard is up.
  After send the keyboard stays; a tap anywhere on the conversation blurs the input and drops it.
  Add a scenario that emulates the keyboard (shrink `visualViewport` via a resized viewport) and
  asserts the input row's rect is inside the visible area and the latest line is in sight.

### 2. The talk button's place is not the same everywhere, and is undefined in the owner's default layout (c1-talk §1, c2-voice §1, screens §4, S-SCR-01)
- What: on the Wall the button's bottom edge is at y 888, in the app at y 872 (16 px above the
  tape). In `split` (the default at 1368, S-SCR-01) and `canvas` the conversation is "a fixed
  column" pending Q-O12 and no rect for the talk button or `CHAT` exists (T27 open). S-SCR-01 still
  places a 64x64 `AGENT` at (1344, 888), which under Q-O11's recommendation is the talk button, so
  the spec says both.
- Why it matters: "findable without looking" means the finger goes to one physical spot. A 16 px
  shift between pages is a miss at the edge of the box; an undefined place in the main layout is
  no place.
- Fix: one rect for the talk button on every page and layout, x 1280-1344, y 824-888 (bottom-right,
  24 px from both edges), in the app drawn over the tape's right end (the tape gives up its last
  88 px). Write it once in `screens.md` §4 and have S-SCR-01, S-SCR-09, S-C1-01 and the T27 column
  assert that same rect. Fold into T26/T27.

### 3. Destructive controls sit 16 px from the blind target (c2-voice §3 `CANCEL`, c1-talk §8 `STOP`; sketch c2-states cells 2-5)
- What: the slot directly left of the talk button, 16 px away, is `CANCEL` while the microphone is
  open (drops the spoken words, no undo) and `STOP` during a turn with an empty input (ends the
  answer, no undo). A finger aimed at the talk button without looking lands 16 px left often enough.
  In tap-tap mode the second tap is exactly that blind aim.
- Why it matters: "nothing harmful from an accidental touch". Losing 40 s of dictation to a miss is
  the worst thing that can happen to the voice path.
- Fix: (a) `CANCEL` keeps the dropped words for 5 s with the hint `WORDS DROPPED · UNDO` and an
  `UNDO` in the same slot (one tap restores them as a draft); (b) the gap between the slot and the
  talk button becomes 24 px (input x 784-1176); (c) `STOP` acts on release only and is drawn
  differently from `SEND` (struck square glyph) so a glance tells them apart. Log as D-lines; if the
  owner should choose between undo and a gap, make it a Q-O.

### 4. Text the owner must read at the moment of acting is 13 px (c2-voice §3 hint line, §3 `CANCEL`, c1-talk §7 length note, §8 `SENDING STOPS THE ANSWER`, screens §7 `STALE`; sketch c2-states)
- What: `RELEASE TO SEND · SLIDE OFF TO KEEP`, `TAP SEND WHEN DONE`, `KEPT AS DRAFT, NOT SENT`,
  `NOTHING HEARD`, `2 MIN LIMIT · MICROPHONE OFF · TEXT KEPT`, `SENDING STOPS THE ANSWER`, the
  `CANCEL` word and the `STALE` plate are all 13 px caps. Research Q1: nothing below 20 px except
  decoration, secondary labels ≥ 22 px at 60 cm. In the c2-states shot these hints are the
  smallest text on the screen, smaller than the cell captions of the sketch itself.
- Why it matters: these lines are the only feedback that a hold was understood, that words were
  kept, that sending will stop the answer. At 60 cm I cannot read 13 px caps in --text-2.
- Fix: hint line and notes 18 px caps `--text-1` (they fit: the longest, 37 characters, is
  ~420 px at 18 px caps, inside the 560 px column); `CANCEL` either drops the word and keeps a 28 px
  `✕` (the slot is labelled by its glyph and `aria-label`) or the slot grows to 80 px. Raise D21's
  floor to "no text under 16 px, no instruction under 18 px" and add a test that walks every visible
  text node in the pane and fails under 16 px.

### 5. The way out of the pane is the farthest point from the hand (c1-talk §2; screens §4; S-C1-02)
- What: on touch the only exits are `CLOSE` at the pane's top-right (y 8-56) and the 300 s
  auto-close. Tap-outside does not close (D19, fine), there is no swipe (D19, fine), and the opener
  is hidden while open (c1-talk §2). `screens.md` §4 says the opposite ("the button stays where it
  is and reads `CLOSE`"). On a slanted tablet the top edge is the hardest reach.
- Why it matters: "an obvious way back or out of every state", reached without lifting the arm.
- Fix: the `CHAT` opener stays visible while the pane is open, same rect (x 1288-1336, y 760-808),
  and reads `CLOSE`; the header `CLOSE` stays as the second exit. Remove the contradiction in
  `screens.md` §4 one way or the other. S-C1-02 taps both.

### 6. Overlaps in the bottom-right cluster (screens §4 `switch`, c1-talk §4, c2-voice §3)
- What: (a) in `switch` the switch button is "directly left of" the cockpit button with 16 px
  between: that is the same rect as `SEND` (x 1200-1264) once the pane is open. (b) `↓ NEW` and
  `↑ TOP OF ANSWER` sit centred 16 px above the input row, 48 px tall (row top −64 to −16); the hint
  line sits 8 px above the row, right-aligned (row top −24 to −8): they overlap in y between −24
  and −16 and in x whenever the hint is longer than ~330 px (`RELEASE TO SEND · SLIDE OFF TO KEEP`).
  (c) Under Q-O11's recommendation `CHAT` (y 760-808) and the switch button and the Wall's
  bottom-right status lines all compete for the same corner, and no sketch shows them together.
- Why it matters: a tap on an overlapped target does the wrong thing; text under a button is
  unreadable.
- Fix: one table in `screens.md` §4 with every control of the bottom-right cluster per layout and
  pane state (closed/open, keyboard up), each rect, and a test that asserts no two tappable rects
  intersect and every pair is ≥ 8 px apart. Move the switch button into the pane header (where
  `SCREEN` is) while the pane is open; put `↓ NEW` 40 px above the row's top so it clears the hint.

### 7. No pressed state is specified for any button (all three files)
- What: only the talk button has a timed state (B1 ≤ 0.2 s). `SEND` has B8. `CLOSE`, `SCREEN`,
  `NEW`, `RAW`, `RETRY`, `EDIT`, `GO ON`, `SHOW ALL`, `SHOW EARLIER`, `RETRY NOW`, `SHOW DEMO`,
  tool rows, card `×`, the `SCREEN` sheet rows: nothing says what the screen shows the instant my
  finger lands. With no hover there is no other cue.
- Fix: one rule in `spec/README.md` (or `docs/design.md`-style): every tappable shows a pressed
  state (fill `--bg-sunken`, border `--line-strong` → `--text-2`) in the first frame after
  `pointerdown`, removed on `pointerup`/`pointercancel`; no transition. Every button sets
  `touch-action: manipulation` (no double-tap zoom, no 300 ms wait). One table-driven test taps
  each and reads the computed background within one frame.

### 8. Links look tappable and are not; long-press could still open them (c1-talk §3 D22, S-C1-09)
- What: a link is drawn underlined, the universal sign for "tap me", and a tap does nothing. No
  feedback. Also, if the build renders it as `<a href>`, a long press on Chrome for Android opens a
  menu with "Open in new tab", which defeats D22; S-C1-09 only tests a tap.
- Fix: drop the underline (draw `the run (example.invalid)` in `--text-2`), or on tap show the full
  URL as text under the line for 5 s (`https://example.invalid/run/7 · links do not open here`).
  State that a link is a `<span>`, never `<a>`, and add a long-press step to S-C1-09 (no
  `contextmenu` with a link target, no new page).

### 9. Tool lines are 44 px tall tap targets (c1-talk §5, S-C1-07)
- What: the whole tool row is the tap target and is 44 px (`--row-touch`). Research Q1 and the
  persona floor: 48 px. The `+`/`−` hint is 16 px `--text-3` at the far right (barely visible in
  the c1-pane shot).
- Fix: tool rows 48 px; `+`/`−` 20 px `--text-2`. S-C1-07 asserts ≥ 48 px. Table rows may stay 44
  px since they are not tappable; say so.

### 10. Holding near the screen edge loses the send (c2-voice §2 slide off, D40)
- What: the talk button is 24 px from the right and bottom edges. A thumb that drifts right or down
  off the glass ends in `pointercancel` or an up event at the edge, and D40 says `pointercancel`
  never sends. On a slanted tablet the finger slides downwards naturally.
- Fix: count only up/left releases > 48 px out as "slide off" (the deliberate direction); a
  `pointercancel` or a release within 48 px of the screen edge after a hold sends as a normal hold.
  Add the case to S-C2-07 (move to (1366, 910), lift: sends).

### 11. Sheets and bars without a way out (screens §1 `SCREEN` sheet; c1-talk §11 `NEW` bar)
- What: the `SCREEN` sheet has four 64 px rows and no stated way to leave it without picking one.
  The `NEW` bar gives `START` and `KEEP` "at its right" with no gap stated; `START` is the one-way
  action (the conversation's context is gone).
- Fix: the sheet gets a fifth row `CANCEL` and closes on a tap outside it; S-SCR-06 checks it. The
  bar puts `KEEP` at the right end (where the thumb rests) and `START` left of it with 16 px
  between; S-C1-22 asserts the gap.

### 12. Card `×` removes with no undo (screens §7, sketch screens-split; for T11/T12)
- What: every card has a 48x48 `×` in its corner and "one-tap remove". An accidental brush while
  reaching for `CANCEL JOB` or the next card removes a card the agent took a minute to build.
- Fix (for T11): removal leaves a 48 px row `CARD REMOVED · UNDO` in its place for 10 s. Keep the
  `×` box ≥ 8 px from any other target (the sketch's countdown card has `×` at the top-right and
  `CANCEL JOB` well apart: keep that).

### 13. Sketches out of step with the spec (c1-pane, screens-split)
- `c1-pane.html`: the placeholder reads `Type, or hold TALK`; the spec says `Type or hold to talk`.
  The header lacks `NEW` and `RAW` (c1-talk §1 puts them on every page).
- `screens-split.html`: shows `AGENT` as the only bottom-right control; under Q-O11's
  recommendation it is the talk button plus `CHAT` above it. The turn state `● ANSWERING` in the
  c1-pane header is 16 px `--text-3`: the state I most need to see at a glance is the faintest
  text in the header.
- Fix: update both sketches with T25/T26; turn state in `--text-2` 18 px caps.

### 14. Hidden behind my hand while holding (c2-voice §3; sketch c2-states cell 3)
- What: during a hold the button's own word changes to `SEND`, under my fingertip. The hint line is
  directly above the finger, right-aligned to the button's right edge: my finger and the base of my
  hand cover its right part from below-right on a slanted screen.
- Fix: left-align the hint line to the input's left edge (x 784) instead, where neither hand nor
  finger is; `SENDING STOPS THE ANSWER` moves to a second line.

## Contradictions with `spec-input.md`, and things that should be owner questions

- Not a contradiction, but an unasked taste question: research Q1 recommends 26-30 px for "text
  the owner reads while speaking (live transcript, agent answer)"; D21 settles 22 px (the floor)
  and only ties it to Q-O9's panel size. The type scale at arm's length is the owner's eyes and
  desk: make "reply and live words 22 px (floor) or 28 px (recommended)" an explicit Q-O with
  the line-length trade-off (42 vs ~33 characters in the 560 px column).
- Internal contradiction: `screens.md` §4 (the button "stays where it is and reads `CLOSE`") vs
  `c1-talk.md` §2 (the opener is hidden while open). Finding 5.
- Internal contradiction: S-SCR-01 places a 64x64 `AGENT` at the corner, while c1-talk §2 / c2-voice
  §1 (pending Q-O11) put the talk button there. Already tracked by T26; still not fixed.
- Should be an owner question: whether destructive controls next to the talk button get an undo or
  a confirm (finding 3); it is about how dictation may be lost, a choice of taste and safety.
- `spec-input.md` §4 "tap to start and tap to send, or hold and release. Both should work": the
  spec honours it (D29, D39). No conflict.

## Rubric

score spec concrete 8
score spec complete 4
score spec consistent 5
score spec testable 7
score spec ownerfit 6
score spec simple 6
score spec safe 6
