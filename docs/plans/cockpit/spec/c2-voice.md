# C2 Voice in

Speaking instead of typing: the talk button, its two gestures, its states and the live words in the
input (§1-§5, part 1, T6). Fixing a word, cancel by tapping the text, the DE/EN choice, the
speech-to-text config, the service slow or down, and the physical-button API are part 2 (T7). Words
as in the glossary (`README.md`). Sizes are CSS px at 1368x912; times in s or ms; budgets `B<n>` are
the speed budget in `README.md`.

Plan C2: "Press the talk button (tap to start and tap to send, or hold and release; both work).
Words appear live in the input as they are spoken, partial results replaced as they firm up. On
release (or the second tap) the text is sent as the prompt." `spec-input.md` §4: the reference is
the terminal's hold-to-talk, "In the terminal it works really well."

## 1. The talk button

- `[data-talk]`, a `<button>` 64x64 px in the pane's input row, bottom right (`c1-talk.md` §1: on
  the Wall x 1280-1344, y 824-888). With the pane closed the same button sits in the same place and
  a press opens the pane (`c1-talk.md` §2, pending Q-O11).
- Inside, centred: a 24 px microphone glyph, 4 px gap, one word in 16 px `--font-label` caps
  (§3 says which).
- `touch-action: none`, `user-select: none`, the `contextmenu` event cancelled: a long press must not
  open the browser's menu or select text. On `pointerdown` the button takes pointer capture, so the
  release is seen wherever the finger ends. A second finger while one is down is ignored.
- The tap target is the 64x64 box; nothing else within 8 px of it is tappable (research Q1).

## 2. The two gestures (D29, D39)

Listening starts on `pointerdown` in both gestures (D29, B1). The gesture is decided at the first
`pointerup`, by how long the finger was down:

| Finger down for | Gesture | What the release does |
| --- | --- | --- |
| < 400 ms | **tap** (`data-talk-gesture="tap"`) | nothing visible: listening goes on; the next tap's `pointerup` sends |
| ≥ 400 ms | **hold** (`data-talk-gesture="hold"`) | sends |

- **400 ms** is the hold threshold (Android's long-press default, research Q1); it is a named
  constant in D6's module. At 400 ms with the finger still down the hint line (§3) changes from
  `LISTENING` to `RELEASE TO SEND · SLIDE OFF TO KEEP`, so the owner sees a hold has been
  understood.
- **Second tap** (tap gesture only): its `pointerdown` does nothing; its `pointerup` sends, however
  long it was held (WCAG 2.5.2: act on release).
- **Slide off** (hold only, D40): a release more than 48 px outside the button's box (x < 1232 or
  y < 776 on the Wall), or a `pointercancel`, does **not** send: the microphone closes, the words
  stay in the input as an editable draft, the hint reads `KEPT AS DRAFT, NOT SENT` for 5 s.
- **What "send" means**: the microphone stops, the screen asks for the final text (§4), and the
  final text is sent as the prompt exactly as a typed one is (`c1-talk.md` §7), with the label
  `YOU · SPOKEN · 07:02` (B3). During a running turn this send stops the turn first (`c1-talk.md`
  §8, pending Q-O1).
- **Pressing during a turn** stops nothing; listening starts as usual (`c1-talk.md` §8).

## 3. States of the button and the input

`data-talk` on the button carries the state. It is the "mic state attribute" `screens.md` S-SCR-20
asserts. The `SEND` slot left of the talk button changes too (`data-send`, `c1-talk.md` §8).

| `data-talk` | When | Talk button | `SEND` slot | Input | Hint line (13 px caps `--text-2`) |
| --- | --- | --- | --- | --- | --- |
| `idle` | microphone closed | `--bg-elevated`, 1 px `--accent` border, glyph and `TALK` in `--text-1` | `SEND` or `STOP` (`c1-talk.md` §7-§8) | the textarea, placeholder `Type or hold to talk` | none |
| `listening` | microphone open, no word yet | **inverse**: fill `--text-1`, glyph and `SEND` in `--bg-canvas`, 1 px `--accent` border; the level bar (below) | `CANCEL` (`data-send="cancel"`) | `Listening…` in `--text-3` | `LISTENING`; after 400 ms held `RELEASE TO SEND · SLIDE OFF TO KEEP`; after a tap `TAP SEND WHEN DONE` |
| `partial` | microphone open, words shown | as `listening` | `CANCEL` | the words: firm part `--text-1`, the tail still changing `--text-2` (§4) | as `listening` |
| `final` | released or second tap; microphone closed; waiting for the final text (≤ 3 s, D41) | inverse, word `…`, no level bar | `CANCEL` | the last words, all `--text-2` | `FINISHING…` |
| `error` | the microphone cannot be opened (§5) | `--bg-elevated`, 1 px `--line-strong` border, glyph struck through, `TALK` in `--text-3`; still tappable (a tap tries again) | `SEND` | the textarea, typing works | none; §5's line above the input row, until the next try |
| `off` | the room is down or the screen is unpaired (`screens.md` §7) | `disabled`, 1 px `--line` border, `TALK` in `--text-3` | `SEND`, disabled | the textarea | none (the pane's line `Sending and voice come back with the room.` says it, `screens.md` §7) |

- **After send** the talk button is back to `idle` and the input empty within B3 (≤ 0.3 s from the
  release). The "sending" state is the prompt's, not the button's: the prompt block reads
  `YOU · SPOKEN · 07:02 · SENDING` until the room confirms (`c1-talk.md` §7, D31).
- **Inverse, not colour.** An open microphone is shown by the light fill, grey on grey: it is not
  trouble and not a selection, so neither a status hue nor an accent fill (`docs/design.md` rules 1
  and 3). The accent stays the button's 1 px border in every state but `error` and `off`.
- **The level bar**: 40x4 px, centred, 4 px above the button's bottom edge (under the word), `--bg-canvas` on the
  inverse fill; its width follows the microphone's input level (RMS of the last 50 ms, 0 to 40 px),
  set once per animation frame with no transition. It is data (the microphone hears something), so
  it stays under reduced motion (`docs/design.md` rule 5). A bar at 0 px for 2 s while the room
  receives frames says "silence", not a fault.
- **`CANCEL`** (D42): in the 64x64 `SEND` slot a 20 px `✕` over `CANCEL` in 13 px caps (16 px
  `CANCEL` does not fit 64 px; sketch `c2-states.html`). It closes the microphone within 0.1 s, removes the spoken words, keeps a draft
  typed before the press, sends nothing, `data-talk="idle"`. Fixing one word by tapping the text is
  T7's.
- The **hint line** sits 8 px above the input row's top edge, right-aligned to the talk button's
  right edge; it wins the place over the length note (`c1-talk.md` §7). `SENDING STOPS THE ANSWER`
  (`c1-talk.md` §8) stays left-aligned beside it.
- Under `prefers-reduced-motion` nothing here changes: no state change animates (rule 5).

## 4. Live words

- **Where.** While the microphone is open (`listening`, `partial`, `final`) the textarea is
  replaced in the same rectangle by a read-only `[data-talk-text]` with two spans, `[data-firm]`
  and `[data-tail]` (a textarea cannot colour part of its text) (D43). Same type: mono 22 px, line
  height 1.4, 16 px padding; it grows to 4 lines and then scrolls, pinned to its end, as the
  textarea does (`c1-talk.md` §7, D30). When the microphone closes, the text goes back into the
  textarea (draft) or into the prompt (send).
- **Firm and tail.** Each speech-to-text update (`protocols.md`, T16; research Q4: the whole list of
  committed lines plus the current buffer, resent each time) **replaces** both spans: firm = the
  committed text, tail = the buffer. Nothing is ever appended to what is drawn, so a word can never
  show twice. Firm text never changes once shown; tail text may change or vanish.
- **A draft first.** Text already in the input when the press starts stays in front, unchanged, as
  the start of `[data-firm]`; the spoken words follow after one space (D44). `CANCEL` removes only
  the spoken part.
- **Drawn at once.** Each update is drawn in the next animation frame after it reaches the screen.
  The first word is in the input ≤ 1.0 s after `pointerdown` (B2); each later update is drawn
  ≤ 0.4 s after the fake speech service sends it (B2's screen-and-room share, for every update).
- **The final.** On send (§2) the screen stops the microphone and the room asks the speech service
  for the final text (research Q4: an empty frame, then `ready_to_stop`). The final replaces firm
  and tail, and is sent (B3: ≤ 0.3 s from the release to the prompt block). The final is the
  speech service's text, not what the screen showed last: if the two differ, the final wins.
- **Nothing heard.** A final with no words sends nothing: `data-talk="idle"`, the input as before the
  press, the hint `NOTHING HEARD` for 3 s.
- **No final in 3 s** (D41): the screen keeps the last words shown as an editable draft, not sent;
  the exact message is T7's (speech service slow).
- **Limits** (D45). Listening with no word for 30 s closes the microphone, nothing is sent, hint
  `NOTHING HEARD IN 30 S · MICROPHONE OFF` for 5 s. Listening for 120 s in all closes it, the words
  stay as a draft, not sent, hint `2 MIN LIMIT · MICROPHONE OFF · TEXT KEPT` until the input changes.
  A brushed button (D29) therefore never listens longer than 30 s by itself.
- **Per screen** (D37): partial words never reach another screen; only the sent prompt does.

## 5. The microphone

- **Opened per press, closed after** (D46). The screen calls `getUserMedia({ audio: true })` on
  `pointerdown` and stops every track when the microphone closes (send, cancel, slide off, limits,
  error, link lost). No microphone stream lives between presses, so the browser's microphone
  indicator is on only while the button shows an open microphone. `data-talk="listening"` is set
  when the track is live (B1, ≤ 0.2 s).
- **Frames** leave the screen from the moment the track is live; audio captured before the room's
  audio channel is open is held on the screen and sent first, so the first word is not cut off. The
  frame format and channel are T15's.
- **Cannot open** → `data-talk="error"`, the input stays the textarea and typing works. The
  message (exact) is `[data-talk-error]`, 16 px mono `--text-2`, line height 1.25, left-aligned over
  the text column (x 784-1344 on the Wall), its last line 8 px above the input row; it wraps (2 lines
  at 560 px) and takes its height from the conversation, in the hint line's place. Not under the
  input row: on the Wall the row ends 24 px above the screen's edge.

| Cause (`getUserMedia` error) | Line |
| --- | --- |
| `NotAllowedError` | `The microphone is blocked on this screen. Typing works. docs/cockpit.md says how to allow it.` |
| `NotFoundError` | `This screen has no microphone. Typing works.` |
| `NotReadableError` or any other | `The microphone is busy or failed. Typing works. Tap TALK to try again.` |

  A tap on the button in `error` tries again; success clears the line. The kiosk setup that avoids
  the prompt (research Q3) goes in `docs/cockpit.md` (T7 writes the note).
- **The room link lost** while the microphone is open closes it at once and keeps the words as a
  draft (`screens.md` §7, S-SCR-20).

## 6. Scenarios

Same setup as `c1-talk.md` §6: 1368x912, the demo hub, the stand-in room, the fake agent and the
fake speech service (T18), a paired screen, `wall` layout, the pane open, the conversation idle,
unless said otherwise. Chromium runs with `--use-fake-device-for-media-stream` and
`--use-fake-ui-for-media-stream`; touches go through CDP `Input.dispatchTouchEvent` with
`hasTouch: true`. The fake speech service's times are counted from the first audio frame it
receives. `S-C1-13` (hold from the closed pane on the touring Wall) is the C2 path from the Wall
and is not repeated here (T30 moves it).

### S-C2-01 Tap, speak, tap: the words appear live and the second tap sends
Given the fake speech scripted: partials `what` at 0.6 s, `what failed` at 1.1 s, `what failed
tonight` at 1.6 s; final `What failed tonight?` 0.15 s after the end frame,
When the owner taps the talk button (down t = 0, up t = 0.12 s),
Then by t = 0.2 s `data-talk="listening"`, `data-talk-gesture="tap"` after the up, the button reads
`SEND` on the inverse fill, the `SEND` slot reads `CANCEL`, the input shows `Listening…`, the hint
`TAP SEND WHEN DONE`; `what` is in `[data-talk-text]` by t = 1.0 s (B2), `what failed` by 1.5 s,
`what failed tonight` by 2.0 s; nothing is sent while listening.
When the owner taps again at t = 3.0 s (down 3.0 s, up 3.1 s),
Then by t = 3.4 s (B3 from the up) the conversation ends with `YOU · SPOKEN · HH:MM · SENDING` over
`What failed tonight?`, the input is the empty textarea, `data-talk="idle"`, `data-turn="thinking"`.
Test: Playwright, CDP touches; poll `data-talk`, `data-send`, the input text every 50 ms; read the
marks `cockpit:B1`…`B3`; the stand-in room's received-turns log has exactly one turn
`What failed tonight?`.

### S-C2-02 Hold and release sends; a short press is a tap, not a send
Given the fake speech scripted as S-C2-01,
When the owner holds the talk button from t = 0 to t = 2.5 s,
Then at t = 0.45 s the hint reads `RELEASE TO SEND · SLIDE OFF TO KEEP`; at the release
`data-talk-gesture="hold"`, and by t = 2.8 s the prompt `What failed tonight?` is drawn (B3).
And in a second run with the finger down from t = 0 to 0.25 s, then nothing for 3 s,
Then `data-talk-gesture="tap"`, `data-talk` is `partial` at t = 3.0 s, nothing has been sent, the
hint reads `TAP SEND WHEN DONE`.
Test: Playwright, CDP touches with the two timings (250 ms and 2.5 s stay clear of the 400 ms
threshold); assert the hint text at 0.45 s; the received-turns count (1, then 0).

### S-C2-03 Partial words are replaced, never appended
Given the fake speech scripted: update 1 lines `[]` buffer `how did`; update 2 lines `[]` buffer
`how do the`; update 3 lines `["How did the"]` buffer `night go`; update 4 lines
`["How did the", "night go?"]` buffer ``; 300 ms apart from 0.6 s,
When the owner holds the button and speaks,
Then `[data-talk-text]` reads in turn `how did`, `how do the`, `How did the night go`,
`How did the night go?`; after update 3 `[data-firm]` is `How did the` in `--text-1` and
`[data-tail]` `night go` in `--text-2`; no reading ever holds a word twice; firm text never changes
after it was drawn.
Test: Playwright; record every distinct `textContent` of `[data-talk-text]` (MutationObserver) and
compare with the 4 expected strings exactly; computed colours of the two spans against the tokens.

### S-C2-04 Every state looks as the table says
Given the stand-in room and fake speech, and for `error` a context whose microphone permission is
denied, for `off` the room's link stopped (T32's verb),
When the screen is brought into each of `idle`, `listening`, `partial`, `final`, `error`, `off`,
Then for each: the button's word (`TALK`, `SEND`, `SEND`, `…`, `TALK`, `TALK`), its fill (inverse in
`listening`, `partial`, `final`), its border token, `disabled` only in `off`, the `SEND` slot's
`data-send` and label, the input element (textarea or `[data-talk-text]`) and the hint line match
§3's table; the level bar is visible only in `listening` and `partial`; the button is 64x64 px and
its word ≥ 16 px.
Test: Playwright, one table-driven case per state; `final` is held by a fake speech script that
delays the final by 2 s; compare computed colours with the tokens' computed values; screenshot per
state compared by eye against `sketches/c2-states.html` in the build night's review, not in the test.

### S-C2-05 Releasing with nothing said sends nothing
Given the fake speech scripted to send `no_audio_detected` and then an empty final,
When the owner holds the button from t = 0 to 1.5 s,
Then by t = 1.8 s `data-talk="idle"`, the input is as before the press, the hint reads
`NOTHING HEARD` and is gone at t = 4.8 s; no prompt block is drawn; the microphone track is stopped.
Test: Playwright; the received-turns count stays 0; the fake speech service's log shows the end
frame and no audio frame after t = 1.7 s (the microphone is closed).

### S-C2-06 A forgotten tap listens 30 s at most; a long speech stops at 2 minutes and keeps the text
Given a fake clock and the fake speech scripted to send nothing,
When the owner taps the talk button at t = 0,
Then at t = 30 s `data-talk="idle"`, the fake speech service gets no more frames, the hint reads
`NOTHING HEARD IN 30 S · MICROPHONE OFF` until t = 35 s; nothing sent.
And given the fake speech sending a growing partial every 1 s from 0.6 s, when the owner taps at
t = 0 and does nothing more, then at t = 120 s the microphone closes, the textarea holds the last
words as a draft, the hint reads `2 MIN LIMIT · MICROPHONE OFF · TEXT KEPT`, nothing is sent; typing
one character removes the hint.
Test: Playwright `page.clock` plus the stand-in's clock verb (T32); assert `data-talk`, the hint,
the textarea value, the received-turns count 0.

### S-C2-07 Sliding off during a hold keeps the words as a draft
Given the fake speech scripted as S-C2-01, the input empty,
When the owner holds the button at (1312, 856) from t = 0, moves the finger to (1100, 700) at
t = 2.0 s and lifts it at t = 2.2 s,
Then no prompt is sent; by t = 2.4 s the microphone is closed, `data-talk="idle"`, the textarea
holds `what failed tonight` (the last words shown), the hint reads `KEPT AS DRAFT, NOT SENT` until
t = 7.2 s; the textarea is editable and `SEND` is enabled.
And lifting the finger at (1250, 830) (inside the 48 px margin) sends as a normal hold.
Test: Playwright, CDP touch move; the received-turns count (0, then 1 in the second run).

### S-C2-08 A blocked microphone: the error state, typing still works
Given the browser context with the microphone permission denied,
When the owner taps the talk button,
Then within 0.5 s `data-talk="error"`, the button reads `TALK` in `--text-3` with the struck glyph,
the line above the input row reads `The microphone is blocked on this screen. Typing works.
docs/cockpit.md says how to allow it.`; typing `status` and `Enter` sends it as a typed prompt.
When the permission is granted and the owner taps the button again, the line goes and
`data-talk="listening"`.
Test: Playwright `context.grantPermissions([])` then `grantPermissions(['microphone'])`; Chromium
started without `--use-fake-ui-for-media-stream` for this case; assert the line text exactly.

### S-C2-09 Talking during an answer: listening stops nothing, the release does (pending Q-O1)
Given the fake agent streaming a reply over 8 s, scripted to end its turn 0.4 s after an interrupt;
the fake speech scripted: partial `only` at 0.6 s, final `Only the failed one.`,
When the owner holds the talk button from t = 2.0 s,
Then the reply keeps streaming, `data-turn="answering"`, the hint line shows
`RELEASE TO SEND · SLIDE OFF TO KEEP` with `SENDING STOPS THE ANSWER` beside it once `only` shows.
When the owner releases at t = 4.0 s,
Then the reply's text stops changing, `STOPPED AT HH:MM` is drawn under it, the prompt `Only the
failed one.` is drawn below as a new turn by t = 4.3 s (B3), the header goes `● STOPPING` and then
`● THINKING`; the stand-in room's log has the interrupt before the new prompt.
Test: Playwright; the reply text at 2.0 s and 3.9 s differs (still streaming), at 4.05 s and 5.0 s
it is equal; the bridge log order from the stand-in.

### S-C2-10 CANCEL drops the spoken words and keeps a typed draft
Given the input holding the typed draft `on builder-a,`,
When the owner taps the talk button, the fake speech sends `restart the runner`, and the owner taps
`CANCEL` at t = 2.0 s,
Then during listening `[data-firm]`/`[data-tail]` follow `on builder-a,` plus one space; by
t = 2.1 s `data-talk="idle"`, the textarea holds `on builder-a,` exactly, nothing is sent, and the
fake speech service gets no audio frame after t = 2.2 s.
Test: Playwright; assert the text before and after, the speech service's frame log, the
received-turns count 0.
