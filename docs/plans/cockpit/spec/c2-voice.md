# C2 Voice in

Speaking instead of typing: the talk button, its two gestures, its states and the live words in the
input (§1-§6, part 1, T6). Stopping to fix the words by tapping them (§7), the DE/EN choice (§8), the
speech-to-text config (§9), the service down or failed (§10), the talk key (§11) and the kiosk
microphone note (§12) are part 2 (T7), with scenarios in §13. §14 is **C2b, the physical button**:
a later slice, not part of C2's build night (D55). Words
as in the glossary (`README.md`). Sizes are CSS px at 1368x912; times in s or ms; budgets `B<n>` are
the speed budget in `README.md`.

Plan C2: "Press the talk button (tap to start and tap to send, or hold and release; both work).
Words appear live in the input as they are spoken, partial results replaced as they firm up. On
release (or the second tap) the text is sent as the prompt." `spec-input.md` §4: the reference is
the terminal's hold-to-talk, "In the terminal it works really well."

## 1. The talk button

- `[data-talk]`, a `<button>` 64x64 px in the pane's input row, bottom right (`screens.md` §4: x 1280-1344,
  y 824-888 on every page and layout, D116). With the pane closed the same button sits in the same place and
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
  stay in the input as an editable draft, the hint reads `MICROPHONE OFF · TEXT KEPT` (§4, "One
  hint").
- **What "send" means**: the microphone stops, the screen asks for the final text (§4), and the
  final text is sent as the prompt exactly as a typed one is (`c1-talk.md` §7), with the label
  `YOU · SPOKEN · 07:02` (B3). During a running turn it goes into that turn as a queued prompt
  (`· QUEUED`, `c1-talk.md` §8, pending Q-O1); it stops nothing.
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
| `error` | the microphone cannot be opened (§5) or the speech service fails (§10) | `--bg-elevated`, 1 px `--line-strong` border, glyph struck through, `TALK` in `--text-3`; still tappable (a tap tries again) | `SEND` | the textarea, typing works | none; §5's line above the input row, until the next try |
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
  §7.
- The **hint line** is the line slot above the input row (`c1-talk.md` §1.1, `data-line="hint"`):
  left-aligned at x 784, ending at x ≤ 1264. It wins the slot over the length note and gives it up
  to the room-down line and to an error (D133). Nothing else shares the line during a turn (D121).
- Under `prefers-reduced-motion` nothing here changes: no state change animates (rule 5).

## 4. Live words

- **Where.** While the microphone is open (`listening`, `partial`, `final`) the textarea is
  replaced in the same rectangle by a read-only `[data-talk-text]` with two spans, `[data-firm]`
  and `[data-tail]` (a textarea cannot colour part of its text) (D43). Same type: mono 28 px, line
  height 1.4, 16 px padding, 21 characters per line (`TYPE_TALK`, `c1-talk.md` §3, pending Q-O18); it grows to 4 lines and then scrolls, pinned to its end, as the
  textarea does (`c1-talk.md` §7, D30). When the microphone closes, the text goes back into the
  textarea (draft) or into the prompt (send).
- **Firm and tail.** Each speech-to-text update (`protocols.md` §12.2; research Q4: the whole list of
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
  press, the hint `MICROPHONE OFF`.
- **No final in 3 s** (D41): the screen keeps the last words shown as an editable draft, not sent;
  the exact message is §10's `stt-failed`.
- **Limits** (D45). Listening with no word for 30 s closes the microphone, nothing is sent, hint
  `MICROPHONE OFF`. Listening for 120 s in all closes it, the words stay as a draft, not sent, hint
  `MICROPHONE OFF · TEXT KEPT`. A brushed button (D29) therefore never listens longer than 30 s by
  itself.
- **One hint** for "the microphone closed and nothing was sent" (nothing heard, the 30 s and 120 s
  limits, slide off, a tap on the words in §7): `MICROPHONE OFF`, and `MICROPHONE OFF · TEXT KEPT`
  when the input holds spoken words. It shows for 5 s in the hint line's place (§3), or until the
  input changes or the next press, whichever comes first. `CANCEL` shows no hint (the owner asked
  for it); a failure shows §10's line instead.
- **Per screen** (D37): partial words never reach another screen; only the sent prompt does.

## 5. The microphone

- **Opened per press, closed after** (D46). The screen calls `getUserMedia({ audio: true })` on
  `pointerdown` and stops every track when the microphone closes (send, cancel, slide off, limits,
  error, link lost). No microphone stream lives between presses, so the browser's microphone
  indicator is on only while the button shows an open microphone. `data-talk="listening"` is set
  when the track is live (B1, ≤ 0.2 s).
- **Frames** leave the screen from the moment the track is live; audio captured before the room's
  audio channel is open is held on the screen and sent first, so the first word is not cut off. The
  frame format and channel are `protocols.md` §6 (D96).
- **Cannot open** → `data-talk="error"`, the input stays the textarea and typing works. The
  message (exact) is `[data-talk-error]`, 16 px mono `--text-2`, line height 1.25, in the line slot
  above the input row (`c1-talk.md` §1.1, `data-line="error"`): x 784-1264, its last line 8 px above
  the row; it wraps (2 lines at 480 px for the longest line below, a 52 px slot) and takes its
  height from the conversation. Not under the input row: on the Wall the row ends 24 px above the
  screen's edge.

| Cause (`getUserMedia` error) | Line |
| --- | --- |
| `NotAllowedError` | `The microphone is blocked on this screen. Typing works. docs/cockpit.md says how to allow it.` |
| `NotFoundError` | `This screen has no microphone. Typing works.` |
| `NotReadableError` or any other | `The microphone is busy or failed. Typing works. Tap TALK to try again.` |
| `navigator.mediaDevices` undefined (the page is not a secure context, research Q3) | `The microphone needs a secure page (HTTPS). Typing works. docs/cockpit.md says how.` |

  The cause is on the line as `data-talk-error`: `mic-blocked`, `no-mic`, `mic-failed`,
  `mic-insecure`, in table order; §10 adds the speech service's causes. A tap on the button in
  `error` tries again; success clears the line. The kiosk setup that avoids the prompt is §12.
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
`MICROPHONE OFF` and is gone by t = 6.9 s (5 s); no prompt block is drawn; the microphone track is stopped.
Test: Playwright; the received-turns count stays 0; the fake speech service's log shows the end
frame and no audio frame after t = 1.7 s (the microphone is closed).

### S-C2-06 A forgotten tap listens 30 s at most; a long speech stops at 2 minutes and keeps the text
Given a fake clock and the fake speech scripted to send nothing,
When the owner taps the talk button at t = 0,
Then at t = 30 s `data-talk="idle"`, the fake speech service gets no more frames, the hint reads
`MICROPHONE OFF` until t = 35 s; nothing sent.
And given the fake speech sending a growing partial every 1 s from 0.6 s, when the owner taps at
t = 0 and does nothing more, then at t = 120 s the microphone closes, the textarea holds the last
words as a draft, the hint reads `MICROPHONE OFF · TEXT KEPT`, nothing is sent; typing one
character removes the hint.
Test: Playwright `page.clock` plus the stand-in's clock verb (T32); assert `data-talk`, the hint,
the textarea value, the received-turns count 0.

### S-C2-07 Sliding off during a hold keeps the words as a draft
Given the fake speech scripted as S-C2-01, the input empty,
When the owner holds the button at (1312, 856) from t = 0, moves the finger to (1100, 700) at
t = 2.0 s and lifts it at t = 2.2 s,
Then no prompt is sent; by t = 2.4 s the microphone is closed, `data-talk="idle"`, the textarea
holds `what failed tonight` (the last words shown), the hint reads `MICROPHONE OFF · TEXT KEPT`
until t = 7.2 s; the textarea is editable and `SEND` is enabled.
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

### S-C2-09 Talking during an answer: the spoken words join the running turn (pending Q-O1)
Given the fake agent on a turn that writes text from t = 0.3 s and calls a tool from t = 3.0 s to
t = 6.0 s, `queued` `next-tool-end`, the steer turn writing `Only builder-a failed.` 0.3 s after it
is taken; the fake speech scripted: partial `only` at 0.6 s, final `Only the failed one.`,
When the owner holds the talk button from t = 2.0 s,
Then the reply keeps streaming, `data-turn` stays `answering` or `working`, the hint line shows
`RELEASE TO SEND · SLIDE OFF TO KEEP` and nothing else.
When the owner releases at t = 4.0 s,
Then by t = 4.3 s (B3) the prompt `Only the failed one.` is drawn last with
`YOU · SPOKEN · HH:MM · QUEUED`; the header stays `● WORKING`, no `STOPPED AT` line is drawn and
the fake agent's log has no interrupt; by t = 6.1 s `· QUEUED` is gone and
`Only builder-a failed.` is drawn below it in the same turn.
Test: Playwright; the reply text at 2.0 s and 3.9 s differs (still streaming); assert the label at
4.3 s and 6.1 s, no element with the text `STOPPED AT`, and `order()` from the fake-agent log (one
`prompt` with `"priority":"next"`, no `interrupt`).

### S-C2-10 CANCEL drops the spoken words and keeps a typed draft
Given the input holding the typed draft `on builder-a,`,
When the owner taps the talk button, the fake speech sends `restart the runner`, and the owner taps
`CANCEL` at t = 2.0 s,
Then during listening `[data-firm]`/`[data-tail]` follow `on builder-a,` plus one space; by
t = 2.1 s `data-talk="idle"`, the textarea holds `on builder-a,` exactly, nothing is sent, and the
fake speech service gets no audio frame after t = 2.2 s.
Test: Playwright; assert the text before and after, the speech service's frame log, the
received-turns count 0.

## 7. Stopping to fix the words (D47)

Plan C2: "Before that [the send], a tap on the text lets the owner fix a word or cancel." Cancel is
`CANCEL` in the `SEND` slot (§3, D42); this section is the fix.

- **A tap on the live words** (`[data-talk-text]`, `pointerup` within 10 px of its `pointerdown`)
  while `data-talk` is `listening` or `partial` in the **tap** gesture means "stop, let me fix it":
  the microphone closes within 0.1 s, the room asks for the final text as for a send (§4), and
  nothing is sent.
- **The final goes into the textarea**, not the conversation, ≤ 0.3 s after the tap (the fake
  speech's 0.15 s included, as B3). `data-talk="idle"`, the textarea has the focus with the caret at
  the end of its text, so the on-screen keyboard comes up; the owner moves the caret to the word.
  This focus is the owner's own tap, so D20 does not hold it back. Where the row goes while the
  keyboard is up is `c1-talk.md` §7.1 (S-C2-22). Hint `MICROPHONE OFF · TEXT KEPT`
  (§4).
- **Where the tap landed does not matter.** The shown words and the final differ often (case,
  punctuation, merged words), so the screen does not guess which word was meant.
- **No final in 3 s** (D41): the last words shown go into the textarea instead, caret at the end,
  and §10's `stt-failed` line shows.
- **Then** the textarea is an ordinary draft: `SEND` sends it as a typed prompt (label
  `YOU · 07:02`, not `SPOKEN`: the owner changed it); a press on the talk button adds spoken words
  after it (D44); clearing it by hand is the "cancel".
- **During a hold, and in `final`**, a tap on the text is ignored: the finger on the button already
  decided, by release or slide off (§2). A second finger is already ignored on the button (§1); the
  text follows the same rule.

## 8. The speech language (D48)

`spec-input.md` §4: "Languages: English and German. A DE/EN choice in the UI beats auto-detect on
short clips (research finding)." The plan's config key is `cockpit.stt.language` "(with `auto`)".

- **`cockpit.stt.language`** takes a language code (`"de"`), `"auto"`, or a list of codes
  (`["de", "en"]`). Codes are ISO 639-1, two lower-case letters, as the speech service takes them
  (research Q4: `?language=`). Default `"en"`. The room passes the chosen code to the speech service
  when it opens the session for a press; `auto` passes `auto`.
- **A list shows the choice.** With two or more codes the input row gets a language button
  `[data-talk-lang]`, 64x64 px, at the row's left end (on the Wall x 784-848, the textarea then runs
  from x 864 to x 1184; `screens.md` §4.1 carries it). It shows the current code in 20 px
  `--font-label` caps `--text-1` (`DE`), 1 px `--line-strong` border, `aria-label` `Speech language:
  German. Tap for English.`. A tap moves to the next code in the list and back to the first after
  the last. With one code or `auto` there is no button and the textarea keeps its full width.
- **Default and memory.** A screen starts with the list's first code. The choice is the screen's
  (`localStorage` `cockpit.lang`, as D3's layout); a stored code no longer in the list falls back to
  the first. Two screens may speak different languages.
- **Fixed per press.** The language is read at `pointerdown`; while the microphone is open the
  language button is `disabled`. Switching takes effect at the next press.
- What reaches the conversation is the text; the language is a field of the spoken turn
  (`protocols.md` §3.1 `lang`), not shown in the label.

## 9. Speech-to-text config (D49)

Plan C2: "`cockpit.stt.url`, `cockpit.stt.language` (with `auto`)"; plan §5: "STT and TTS are
endpoints in config, each with `none` as a default (then the pane is text only, and still useful)".
The keys live in the config of the room (`docs/config.md`'s layers: defaults, file, `LANEBOARD_*`;
which process is the room: D89).

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `cockpit.stt.url` | `"none"` | `LANEBOARD_COCKPIT_STT_URL` | The streaming speech service, `ws://` or `wss://` (`wss://stt.example.invalid/asr`). `ws://` only on a loopback host, as `fleet.builders` takes `http` only on loopback (`server/config/hub.mjs`). `none`: no voice. |
| `cockpit.stt.language` | `"en"` | `LANEBOARD_COCKPIT_STT_LANGUAGE` (comma list: `de,en`) | §8. |
| `cockpit.stt.tokenFile` | unset | `LANEBOARD_COCKPIT_STT_TOKEN_FILE` | A file holding the service's bearer token, sent as `Authorization: Bearer` on connect, never in the URL's query (research Q4: query strings end up in logs). Mode 0600, as the audit file (`docs/fleet/auth.md`). Unset: no token. |

- A bad value (a URL with credentials, a query or another scheme; a code that is not two letters)
  is fatal at start, naming the key, as every config fragment does (`docs/config.md`).
- No `context` (research Q4's word list) in v1: one less thing that can make the service refuse
  the session (close 4400).
- **`none`** (also what a stranger without a speech service gets): the talk button is not drawn;
  `SEND` takes its place (on the Wall x 1280-1344) and the textarea runs from x 784 to x 1264; the
  placeholder reads `Type a message`; the talk key (§11) does nothing. On the closed pane the
  opener is `CHAT` (`screens.md` §4, pending
  Q-O11). Typing is the whole C1, so the pane is complete without voice (`single-machine.md`, T19).

## 10. Speech-to-text down or failed (D50)

The room talks to the speech service, the screen only to the room (`protocols.md` §6, §12), so
these are the room's findings, sent to the screen; the screen draws them. Each ends in the `error`
state (§3) with its line in §5's place and look. **Typing always works**, and nothing spoken is
sent unless a final came (D41). There are two cases, told apart by one fact: had a word been shown
in `[data-talk-text]` when it went wrong?

| `data-talk-error` | When (measured by the room) | Microphone | Line (exact) |
| --- | --- | --- | --- |
| `stt-down` | **no word shown yet**, and: the connect fails or the service's first message (`config`) has not come 2.0 s after the press; or the upgrade is refused (401, 403); or a `status: "error"` update, a close other than 1000, or no final 3.0 s after the release | closed (at 2.0 s for no answer, at once otherwise); the held audio is dropped; the input as before the press | `Speech-to-text is down ({detail}), so nothing was heard. Typing works. Tap TALK to try again.` |
| `stt-failed` | **a word was shown**, and: a `status: "error"` update, or a close other than 1000, or no final 3.0 s after the release, second tap or tap on the words (D41) | closed at once (no final: already closed); the last words shown go into the textarea as a draft | `Speech-to-text did not finish. Your words are in the input, not sent.` |

`{detail}` is the cause in words, so setting up still gets its hint; the button carries it as
`data-talk-detail`:

| `data-talk-detail` | `{detail}` |
| --- | --- |
| `no-answer` | `no answer in 2 s` |
| `busy` (403, research Q4: session limit) | `no free session` |
| `token` (401) | `the room's token was refused: fix cockpit.stt.tokenFile` |
| `failed` (error update, bad close, no final) | `it failed` |

- A tap on the talk button in `error` is a new press: a new connect, a new session.
- The line stays until the next press, as §5's; a draft it mentions stays until the owner sends
  or edits it (D12's rule: never sent on its own).
- **No slow hint.** Lagging words show themselves in the input; listening's 30 s / 120 s limits
  (D45) still hold. Each screen learns of a down service on its own press; no other screen is
  marked.
- **`none` is not a failure**: §9.

## 11. The talk key

Plan C2: "anything that can send a key or an HTTP call (a USB macro key, a home automation button)
maps to 'talk' on a chosen screen. The talk button is an API, not just a widget." `spec-input.md`
§4: "**Later**, a physical button on the desk does the same." So C2 builds one way in, the talk
key: a USB macro key types it into the screen. The talk button's "API" is the page's own press and
release functions, which the key calls; they drive the same gesture logic as the on-screen button
(§2): a press is a `pointerdown`, a release a `pointerup`, the 400 ms rule decides tap or hold. The
HTTP call for a button that cannot type into the screen is C2b (§14).

### The talk key, on the screen (D51)

- A key on the screen's own keyboard (a USB macro key sends one): `F13` by default, one constant in
  D6's module, overruled per screen by `?talkKey=F14` in the URL (a kiosk sets it once, as D3).
  `keydown` is the press, `keyup` the release; repeated `keydown` (`event.repeat`) is ignored.
- It works whatever has the focus, the textarea included (F13 types nothing), while the page has
  the keyboard focus. With the pane closed it opens it, as a press on the talk button does
  (`c1-talk.md` §2).

## 12. The kiosk microphone (note for `docs/cockpit.md`)

What the later `docs/cockpit.md` says, from research Q3. The microphone needs two things: a
**secure page** and a **granted permission**; without either, §5's lines say so and typing works.

1. **A secure page.** `getUserMedia` exists only in a secure context. Serve the cockpit page over
   HTTPS (a tailnet's HTTPS proxy, or a reverse proxy with a certificate). Where that cannot be
   done, the managed policy `OverrideSecurityRestrictionsOnInsecureOrigin` lists the one exact
   origin (`http://hub.example.invalid:7777`); it is the same as the flag
   `--unsafely-treat-insecure-origin-as-secure`. `localhost` counts as secure.
2. **No prompt.** On Chrome or Chromium on Linux and ChromeOS, a managed policy file:

   ```json
   {
     "AudioCaptureAllowed": false,
     "AudioCaptureAllowedUrls": ["https://cockpit.example.invalid/"]
   }
   ```

   `AudioCaptureAllowed: false` turns every prompt off, so only the listed origin can use the
   microphone. List the exact origin; never a pattern for everything.
3. **Or with a prompt.** Without the policy the browser asks once; a persistent browser profile
   keeps the answer (as the device token, `screens.md` §6).
4. **Android tablets**: the no-prompt policy is not listed for Android; whether a no-prompt route
   exists there is research Q7. The prompt path (3) works.
5. **What the screen shows**: the indicator of the browser is on only while the talk button shows
   an open microphone (D46). Audio goes to the room and from there only to `cockpit.stt.url`
   (plan §4).
6. Tests use `--use-fake-device-for-media-stream` and the browser context's microphone permission,
   never a policy (§6).

## 13. Scenarios, part 2

Setup as §6. The fake speech service (T18) can also be scripted to refuse a connect, not
answer, fail mid-session and withhold the final; the stand-in room's config sets
`cockpit.stt.language` per scenario.

### S-C2-11 Tap the live words to fix them: the microphone closes, the text is a draft, nothing sent
Given the fake speech scripted: partial `restart the runner on builder-b` by 1.6 s, final `Restart
the runner on builder-b.` 0.15 s after the end frame,
When the owner taps the talk button at t = 0, then taps the word `builder-b` in `[data-talk-text]`
at t = 3.0 s,
Then by t = 3.1 s the fake speech service gets no more audio frames; by t = 3.3 s
`data-talk="idle"`, the textarea holds `Restart the runner on builder-b.`, `selectionStart` and
`selectionEnd` are both 32 (its length), the textarea has the focus, the hint reads
`MICROPHONE OFF · TEXT KEPT` until t = 8.3 s; no prompt is drawn.
When the owner presses Backspace 10 times, types `builder-a.` and taps `SEND`,
Then the prompt reads `Restart the runner on builder-a.` with the label `YOU · HH:MM` (no `SPOKEN`).
Test: Playwright; tap at the word's rect from `Range.getBoundingClientRect`; assert
`selectionStart`/`selectionEnd`, `document.activeElement`, the received-turns log (one turn, the
fixed text).

### S-C2-12 A tap on the text during a hold is ignored
Given the fake speech scripted as S-C2-01,
When the owner holds the talk button from t = 0 and a second finger taps the live words at t = 1.8 s,
then releases at t = 2.5 s,
Then the microphone stays open until the release and the prompt `What failed tonight?` is sent (B3).
Test: Playwright, CDP two-point touch; received-turns count 1; the fake speech service's frame log
has frames up to t = 2.5 s.

### S-C2-13 DE/EN: one tap switches, the choice is the screen's, the service gets it
Given `cockpit.stt.language: ["de", "en"]`, a fresh browser profile,
Then `[data-talk-lang]` shows `DE` at x 784-848 and the textarea starts at x 864.
When the owner taps it,
Then it shows `EN` within 0.1 s; a press opens the fake speech session with `language=en` in its
query (the service's connect log); while listening the language button is `disabled`.
When the page reloads, it still shows `EN`. With `cockpit.stt.language: "auto"` instead there is
no `[data-talk-lang]`, the textarea starts at x 784, and the session opens with `language=auto`.
Test: Playwright; element rects; the fake speech service's connect log; `localStorage`
`cockpit.lang`.

### S-C2-14 No speech service configured: the pane is text only, and complete
Given `cockpit.stt.url: "none"`,
Then the open pane has no `[data-talk]`; `SEND` is at x 1280-1344; the textarea runs from x 784 to
x 1264 with the placeholder `Type a message`; typing `status` and `Enter` sends it (B8). `F13`
changes nothing.
Test: Playwright; no `getUserMedia` call is made (a page-side spy).

### S-C2-15 The speech service does not answer: an exact line after 2 s, typing works, a tap retries
Given the fake speech service stopped (T32's verb),
When the owner taps the talk button at t = 0,
Then `data-talk="listening"` by t = 0.2 s (B1: the microphone is the screen's); at t = 2.0 s the
microphone closes, `data-talk="error"`, `[data-talk-error="stt-down"]` with
`data-talk-detail="no-answer"` reads `Speech-to-text is down (no answer in 2 s), so nothing was
heard. Typing works. Tap TALK to try again.`; typing `status` and `Enter` sends it.
When the fake speech service is started and the owner taps the talk button again,
Then the line goes, `data-talk="listening"`, and partials arrive as in S-C2-01.
And with the service scripted to refuse with 403 the line reads `Speech-to-text is down (no free
session), so nothing was heard. Typing works. Tap TALK to try again.` at once; with 401, `Speech-to-text
is down (the room's token was refused: fix cockpit.stt.tokenFile), so nothing was heard. Typing
works. Tap TALK to try again.`
Test: Playwright, one page; assert the time with ± 0.2 s on the 2.0 s; the line texts exactly; the
received-turns log has `status` only.

### S-C2-16 The service fails mid-sentence: the words so far are a draft, nothing sent
Given the fake speech scripted: partial `stop the nightly` at 0.6 s, then at 1.2 s an update with
`status: "error"`,
When the owner holds the talk button from t = 0 to t = 3.0 s,
Then by t = 1.4 s the microphone is closed, `data-talk="error"`, the textarea holds `stop the
nightly`, `[data-talk-error="stt-failed"]` reads `Speech-to-text did not finish. Your words are in
the input, not sent.`; the release at 3.0 s sends nothing.
And the same with the connection closed with code 1011 instead of the error update.
And with the error update at 0.4 s (before any word), the line is `stt-down` with
`data-talk-detail="failed"` and the textarea is as before the press.
Test: Playwright; received-turns count 0; the textarea value; the line text exactly.

### S-C2-17 A missing final keeps the text
Given the fake speech scripted: partials `how is` at 0.6 s and `how is the hub` at 1.6 s; no final
after the end frame,
When the owner holds the talk button from t = 0 to t = 2.5 s,
Then `data-talk="final"` from 2.5 s; at t = 5.5 s (3.0 s after the release) `data-talk="error"`, the
textarea holds `how is the hub`, `[data-talk-error="stt-failed"]` reads `Speech-to-text did not
finish. Your words are in the input, not sent.`, and nothing has been sent.
Test: Playwright; poll `data-talk` every 50 ms; the received-turns count 0.

### S-C2-20 The talk key: F13 tap-tap and hold, from any focus
Given the pane closed, the fake speech scripted as S-C2-01,
When the test presses `F13` (down t = 0, up t = 0.1 s) and again at t = 3.0 s,
Then the pane opens and listens after the first, the prompt is sent after the second (B3 from the
second `keyup`).
And with the textarea focused holding `on hub,`, `F13` held from t = 0 to 2.5 s (with `repeat`
`keydown`s every 33 ms) sends `on hub, What failed tonight?` once; the textarea stays free of any
character from the key.
Test: Playwright `keyboard.down('F13')`/`up`; CDP for the repeated `keydown`s; received-turns log.

### S-C2-21 A page that is not secure: the microphone line says why
Given the page served on a non-secure origin (`http://hub.example.invalid:7777` through a test
host mapping, no policy), so `navigator.mediaDevices` is undefined,
When the owner taps the talk button,
Then within 0.2 s `data-talk="error"`, `[data-talk-error="mic-insecure"]` reads `The microphone
needs a secure page (HTTPS). Typing works. docs/cockpit.md says how.`; typing works.
Test: Playwright with `--host-resolver-rules` mapping the name to the stand-in; or, where that is
not possible, an init script deleting `navigator.mediaDevices` (the build night logs which).

### S-C2-22 Fixing a word with the on-screen keyboard up; a press keeps the row under the finger
Given S-C2-11's script (script `c2-tap`), `hasTouch: true`,
When the owner taps the talk button at t = 0 and taps the live words at t = 3.0 s (D47), and the
test resizes the viewport to 1368x532 when the textarea gets the focus (a 380 px keyboard),
Then by t = 3.4 s `data-keyboard="up"`, the textarea holds `Restart the runner on builder-b.` with
the caret at its end, the textarea is x 784-1184, y 460-524 with its last line inside y 0-532,
`SEND` and the talk button are at y 460-524, and the hint `MICROPHONE OFF · TEXT KEPT` is above the
row, inside y 0-444 (`c1-talk.md` §7.1).
When the owner then holds the talk button at (1312, 492) from t = 5.0 s, and the test resizes the
viewport back to 1368x912 when the textarea loses the focus (the keyboard going),
Then `data-keyboard="held"` and the talk button stays at y 460-524 while it reads `SEND` in
`listening`/`partial`; the release at (1312, 492) at t = 7.0 s sends (no slide off, §2); after the
microphone closes `data-keyboard="down"` and the row is at `c1-talk.md` §1's rects (talk button
y 824-888).
Test: Playwright with the fake speech; `page.exposeFunction` reports the textarea's `focus` and
`blur` so the test resizes at those moments; rects ± 1 px; `selectionStart`; the received-turns
log has one spoken turn.

## 14. C2b, the physical button (later; pending Q-O8, Q-O20)

`spec-input.md` §4: "**Later**, a physical button on the desk does the same." Not part of C2's build
night: C2 ships the talk key (§11), which already serves a USB macro key. C2b is its own slice
(`slices.md`, T20), built after the owner has used voice and answered Q-O8 and Q-O20; until then the
room has no `/api/cockpit/talk` route and no button token (D55). Its scenario ids are `S-C2B-`.

### The button API, on the room

For a button that cannot type into the screen (a home automation button). Written for Q-O8's
recommendation a) and Q-O20's recommendation a). It drives the screen's press and release
functions (§11), so the gesture logic is the talk key's.

**A button's token.** On the room: `laneboard cockpit button add hall --screen desk` prints the
token once (`hall: lbbtn_…`, 32 random bytes, base64url) and keeps only its hash. `--screen` names
the target; without it the target is **the screen touched last** (the paired screen whose latest
touch, click or key the room heard of; screens report one at most every 10 s, the message is `touched`, `protocols.md` §3.8).
`laneboard cockpit buttons` lists them, `laneboard cockpit button remove hall` revokes at once. The
CLI is `local` on the room, as pairing approval is (`screens.md` §6). A button token can do one
thing: press and release talk on its target. It cannot read the conversation, place cards or pick
another screen.

**Request.**

```http
POST /api/cockpit/talk HTTP/1.1
Host: cockpit.example.invalid
Authorization: Bearer lbbtn_3q9X…
X-Laneboard: 1
Content-Type: application/json

{"action": "toggle"}
```

`action`: `press` (as `pointerdown`), `release` (as `pointerup`), or `toggle` (a full tap: down
and up at once, for a button that can make only one call; the first toggle starts listening in the
tap gesture, the second sends). No other field; an unknown field is a 400.

**Responses.** The room forwards the action to the target screen and answers once that screen has
reported its new state, at most 1.0 s later. Bodies are JSON.

| Status | Body | When |
| --- | --- | --- |
| `200` | `{"screen":"desk","talk":"listening"}` | done; `talk` is the screen's `data-talk` after the action (`listening`, `final`, `idle`, `error`) |
| `400` | `{"error":"bad-request"}` | not JSON, an unknown `action` or field |
| `401` | `{"error":"no-token"}` | no or malformed `Authorization` |
| `403` | `{"error":"bad-token"}` | unknown or removed token |
| `403` | `{"error":"origin-refused"}` | the request carries an `Origin` or a `Cookie` header: a browser page is never a button (as `origin-on-hub`, `docs/fleet/auth.md`) |
| `403` | `{"error":"no-x-laneboard"}` | `X-Laneboard: 1` missing |
| `409` | `{"error":"no-target"}` | no `--screen`, and no screen touched yet |
| `409` | `{"error":"screen-offline","screen":"desk"}` | the target is paired but has no live link |
| `409` | `{"error":"voice-off"}` | `cockpit.stt.url` is `none` |
| `409` | `{"error":"not-listening","screen":"desk"}` | `release` while the target is not listening |
| `429` | `{"error":"too-many"}`, `Retry-After: 1` | more than 5 calls in 1 s from one token |
| `504` | `{"error":"screen-timeout","screen":"desk"}` | the screen did not report within 1.0 s; the action may still have happened |

- **On the screen** an API press is a press on its talk button: the pane opens, the tour holds
  (D4), the microphone opens (D46; `getUserMedia` needs no user gesture where the permission is
  granted, §12), and the hint reads `LISTENING · BUTTON HALL` (the button's name in caps) instead of
  `LISTENING`. Touch and the API mix: a tap on the talk button while the API started listening in
  the tap gesture is the second tap and sends.
- A button that dies between `press` and `release` leaves listening to D45's limits (30 s with no
  word, 120 s in all): nothing is sent on its own.
- Every call is one line in the room's audit log (`button hall → desk toggle 200`); the format is
  `security.md`'s (T17).
- With `cockpit.stt.url: "none"` (§9) every valid call answers `409 voice-off`.

### Scenarios

Setup as §13. API calls go from the test process with `fetch`, which sends no `Origin`.

### S-C2B-01 (was S-C2-18) The physical button: two calls listen and send on the named screen
Given the button `hall` added with `--screen desk` (T32's room CLI verb), the screen `desk` paired
with the pane closed on the touring Wall, a second screen `side`, the fake speech scripted as S-C2-01,
When the test sends `POST /api/cockpit/talk {"action":"toggle"}` with `hall`'s token at t = 0,
Then the answer is `200 {"screen":"desk","talk":"listening"}` within 1.0 s; on `desk` the pane is
open, the tour holds, the hint reads `LISTENING · BUTTON HALL`; `side` shows nothing new.
When the test sends the second toggle at t = 3.0 s,
Then the answer is `200 {"screen":"desk","talk":"final"}` (the state right after the action), and `What failed tonight?` is
sent by t = 3.3 s; `side` shows the prompt as part of the one conversation (`c1-talk.md` §12).
And with `press` at t = 0 and `release` at t = 2.5 s the prompt is sent as a hold.
Test: Playwright, two pages, `fetch` from the test; the room's audit log has two `button hall →
desk` lines.

### S-C2B-02 (was S-C2-19) The button API refuses what is not a button, and says why
Given the button `hall` (target `desk`) and a button `porch` added without `--screen`,
Then, each with the exact status and body of the table above:
no `Authorization` → `401 no-token`; a made-up token → `403 bad-token`; `hall`'s token with
`Origin: https://cockpit.example.invalid` → `403 origin-refused`; without `X-Laneboard` →
`403 no-x-laneboard`; `{"action":"shout"}` → `400 bad-request`; `porch` on a fresh room before any
touch → `409 no-target`; `hall` with `desk`'s link stopped → `409 screen-offline`; `release` on an
idle `desk` → `409 not-listening`; six calls within 1 s → the sixth `429 too-many` with
`Retry-After: 1`; after `laneboard cockpit button remove hall` → `403 bad-token`; `porch` on a room with
`cockpit.stt.url: "none"` → `409 voice-off`.
And no refused call changes any screen's `data-talk`.
Test: `node:test` against the stand-in room (no browser except for the last check); one case per
row.
