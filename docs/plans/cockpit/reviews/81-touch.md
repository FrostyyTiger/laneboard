# Review, round 81: the touch user

Persona: one finger, a slanted tablet at arm's length (~60 cm), no hover, the on-screen keyboard
only. Read: `spec/c1-talk.md` (all, the steer rewrite of §8 and §5.2 in detail), `spec/c2-voice.md`
§1-§6 and S-C2-07/09/10, `spec/screens.md` §4, `DECISIONS.md` D32, D40, D42, D56, D121-D124,
round 63's touch review and the open touch tasks (T40, T42-T45, T94-T102).
Shot at 1368 (dark): `c1-pane`, `c2-states`, `screens-split` (`$RUN_DIR/shots/81-*`).

What changed since round 63 for my hand: T85/T88 rewrote "talking while the agent answers" for
steer, and T57 added `tried` lines. Steer is a real gain (a send loses nothing). But it made `STOP`
the slot's default during a turn, and none of the round-63 touch fixes (T40, T42-T45, T94-T102)
has landed. Findings 1-3 are new; 4-9 are still in the files.

## Findings, worst first

### 1. `STOP` appears under the finger the instant I send (c1-talk §7-§8, D32; S-C1-16, S-C1-27, S-C2-09)
- What: during a turn the slot x 1200-1264, y 824-888 reads `SEND` while the input holds text and
  `STOP` while it is empty. On send the input is emptied within 0.1 s (B8). So the slot I just
  tapped turns into `STOP` under my finger. A double tap (I saw no reaction, I tap again; or the
  finger bounces on a slanted glass) stops the turn **and** drops the prompt I just queued
  (`cancelQueued`, `Dropped by STOP.`). The same in voice: listening, the slot reads `CANCEL`; at
  release it becomes `STOP`. If I decide to cancel at the moment the words finish, my tap on
  "`CANCEL`" lands on `STOP`. D45/§4 "No final in 3 s" and `final` keep `CANCEL` up to 3 s, so the
  flip moment is not even predictable.
- Why it matters: `STOP` is the one action here with no undo: the turn's work is gone, `RETRY`
  starts over. "Nothing harmful from an accidental touch." Research Q1 says hard-to-undo targets
  get 56+ px and distance; this one is 64 px but 16 px from the blind target (talk button) and in
  the exact rect of the most frequent tap.
- Fix: (a) after any send or cancel from the slot, the slot keeps its old label greyed and is inert
  for 1.0 s, then shows `STOP`; (b) `STOP` acts on `pointerup` only, with its own glyph `■` over
  the word (T42 asked this; T42 is still open); (c) S-C1-16 and S-C2-09 add a step: a second tap at
  t + 0.3 s after `SEND` (and after the voice release) sends no interrupt, `prompts()` unchanged,
  no `STOPPED AT`. One D-line next to D32. If the owner prefers it, D32's overrule (a header
  `STOP`, away from the hand) removes the problem entirely: put that choice in Q-O1 as a sub-option
  rather than leave it only in an overrule clause.

### 2. `c1-talk.md` §12 still says a second prompt stops the first turn (c1-talk §12 "Two prompts at once"; S-C1-23)
- What: "The room takes them in the order they arrive; the second stops the first's turn as §8
  says." §8 now says the opposite (steer, nothing stops). S-C1-23 does not test it.
- Why it matters to me: two screens (or two quick taps from one) must behave as §8; a builder
  reading §12 builds an interrupt on a plain send.
- Fix: "the second joins the running turn as a queued prompt (§8)"; S-C1-23 adds: page B sends
  during A's turn, both show `· QUEUED`, no `STOPPED AT`.

### 3. The only sign a mid-turn send worked is 16 px `--text-3` (c1-talk §8, D121, D122; S-C1-16)
- What: D121 removed the hint line; the confirmation is `· QUEUED` in the label row (16 px caps
  `--text-3`) plus the prompt text turning `--text-2`. At 60 cm, grey 16 px in a grey label row on a
  dark pane is the hardest text on screen to read, and it is the one thing that tells me whether my
  words went in or need repeating (which, by finding 1, is dangerous).
- Fix: `QUEUED` in the label row at 18 px `--text-1` (T43's instruction floor applies: it is
  status I act on); keep the text `--text-2`. S-C1-16 asserts the label's computed size ≥ 18 px.

### 4. The on-screen keyboard is still not specified (c1-talk §1, §7; c2-voice §7 D47; S-C1-14; T40, T94)
- What: unchanged since rounds 31 and 63. §1 now even says "the on-screen keyboard is T40's".
  §7 adds "an on-screen keyboard stays up" after send: so with the keyboard up the conversation is
  ~350 px shorter, and the `· QUEUED` block and the `STOP` slot are exactly where the keyboard's top
  edge sits. Every typing scenario still uses `keyboard.type`.
- Fix: T40 + T94 before the C1 night, as written; add the queued block to the "must stay in sight"
  list of T94's 1368x532 scenario.

### 5. `CANCEL` still sits where `SEND` lives; lifting on it during a hold sends (c2-voice §2-§3, D42, S-C2-07; sketch `c2-states` cells 2-5; T95)
- What: unchanged. S-C2-07's second case still lifts at (1250, 830), on the visible `CANCEL`, and
  expects a send. D40 still names the old hint `KEPT AS DRAFT, NOT SENT` and has no direction.
- Fix: T95 as written; it is now also the base for finding 1 (with `CANCEL` moved into the live
  words box, the slot has one meaning less to flip through).

### 6. `tried` lines and tool lines are 44 px tap targets (c1-talk §5, §5.2 D125; S-C1-07, S-C1-30; T45)
- What: §5.2 (new) copies the 44 px row for `tried` lines; S-C1-07 still asserts "≥ 44 px". A
  `tried` line is the one I most want to open (what did it try to run?). `+`/`−` is 16 px
  `--text-3`.
- Fix: rows 48 px, `+`/`−` 20 px `--text-2` (T45); S-C1-07 and S-C1-30 assert ≥ 48 px.

### 7. No pressed state anywhere, and new tappables keep arriving (all files; T45)
- What: `RETRY`/`EDIT` on queued blocks (§8), `tried` lines, `STOP`, `START`/`KEEP` all landed with
  no rule for what my finger sees on `pointerdown`. Finding 1's double tap is partly caused by
  this: no visible reaction, so I tap again.
- Fix: T45's rule (fill `--bg-sunken`, border `--text-2`, first frame after `pointerdown`, no
  transition; `touch-action: manipulation`) in `spec/README.md`, one table-driven test over every
  tappable selector.

### 8. `EDIT` puts text back in the input but no keyboard comes up (c1-talk §8, §10 E1; D20)
- What: `EDIT` (on `NOT SENT`, `Dropped by STOP.`) moves the text into the textarea. D20 says the
  input never takes focus on touch, so after `EDIT` I must find and tap the input too. `EDIT` is an
  explicit request to type, unlike opening the pane.
- Fix: `EDIT` focuses the input with the caret at the end on every pointer type (the keyboard comes
  up, T40's layout applies); one D-line as an exception to D20; S-C1-18 asserts
  `document.activeElement` is the input after `EDIT` with `hasTouch: true`.

### 9. Type I read while acting is still small and grey (c1-talk §2 header, §3 code language, §7 length note; c2-voice §3 hint line, `CANCEL`; T43, T97)
- What: header turn state 16 px `--text-3` (`● STOPPING` is the confirmation of my `STOP`); hint
  lines 13 px caps `--text-2`; `CANCEL` 13 px; length note 13 px; reply 22 px while Q-O18
  recommends 28 px. In the `c2-states` shot `RELEASE TO SEND · SLIDE OFF TO KEEP` is still the
  smallest text on screen.
- Fix: T43 and T97 as written.

### 10. Sketches still behind the spec (`c1-pane`, `c2-states`, `screens-split`; T47, T101)
- `c1-pane.html`: header reads `● ANSWERING` (D56: `● WORKING`), no `CHAT`/`CLOSE` opener above the
  talk button, no `NEW`, placeholder `Type, or hold TALK` (spec: `Type or hold to talk`).
- `c2-states.html`: no cell for "turn running, input empty" (`STOP` in the slot) and none for a
  `· QUEUED` block: the two states of finding 1 that most need an eye check are not drawn.
- Fix: T47/T101/T120, plus a ninth `c2-states` cell "during a turn: `STOP` (■) in the slot, the
  queued block above".

### 11. Still open from round 63, no change: chip row vs `↓ NEW` vs hint line (T96), the `off` talk button gives no feedback (T102), show-line `UNDO` with no undo row (T98), checklist rows tick on a flick (T99), `NEW` bar slot height and `START`/`KEEP` order (T100). Listed so the triage does not count them as fixed.

## Decided where `spec-input.md` or the night's rules say otherwise, or that should be owner questions

- Should be an owner question: where `STOP` lives. D32 puts it in the `SEND` slot and keeps the
  header `STOP` only as an overrule clause. Under steer `STOP` is the one destructive control and
  where it sits is where the owner's hand learns to go (finding 1). Add as Q-O1 sub-option or its
  own question: a) slot, as now, with the 1 s guard; b) header `STOP`, away from the hand;
  recommendation a) with the guard, because "stop, do this instead" with a draft (D32's overrule
  reason) is rare and the slot is where a terminal user's Ctrl+C habit goes.
- Internal contradiction: `c1-talk.md` §12 (second prompt stops the turn) vs §8 (steer) (finding 2).
- Internal contradiction, unchanged: D40's hint text and direction vs `c2-voice.md` §2/§4.
- Internal contradiction: `c1-talk.md` §11 `NEW` bar "48 px" vs the 80 px status line (D54), unchanged.
- Sketch vs D56: `c1-pane.html` draws `● ANSWERING`.
- Q-O18 recommends 28 px; the spec is still at 22 px (night rule: write for the recommendation).
- `spec-input.md` §4 "tap to start and tap to send, or hold and release. Both should work":
  honoured. "Typing must always work too": honoured on paper, not yet on a touch keyboard (finding 4).

## Rubric

score spec concrete 8
score spec complete 4
score spec consistent 4
score spec testable 7
score spec ownerfit 6
score spec simple 5
score spec safe 5
