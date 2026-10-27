# C1 Talk

The cockpit pane and the conversation in it: where the pane sits, how it opens and closes, how a
reply is drawn for reading at arm's length, and how tool activity folds into one line (§1-§5, part
1, T4; §5.1 maps the room's messages onto them, T29). Typing and send, talking while the agent answers, long replies, errors, a new conversation,
several screens are part 2 (§7-§14, T5; the on-screen keyboard §7.1, T40); the raw view is not in C1 (§13, T50); the demo (`?demo=1`) is §15; every time C1 uses is in one table, §16. Words as in the glossary (`README.md`). Sizes are CSS
px at 1368x912; times in s or ms.

Plan C1: "It slides over the view, never replaces it, so the agent can point at the view behind
it." "Replies are always text, rendered for reading at arm's length: large type, short blocks, code
and tables readable, tool activity collapsed to one line each ("read 3 feeds", "looked at CI on
main")."

## 1. Where the pane sits

| Page / layout | Pane rectangle at 1368x912 | Notes |
| --- | --- | --- |
| Wall page, `wall` | x 760-1368, y 0-912 (608 x 912) | slides over the right 608 px of the Wall; the left 759 px stay in sight |
| Wall page, `split`, `canvas`, and `switch` | no sliding pane: the conversation is a fixed **column** of the canvas, rects below (pending Q-O12, D117) | `screens.md` §3: in `switch` a tap on `CHAT` or a press on the talk button on the wall half flips to the canvas |
| App, every view in `VIEWS` | x 760-1368, y 36-888 (608 x 852): under the 36 px header, above the 24 px tape | covers the inspector (360 px) while open; `z-index` 35, between `--z-tape` 30 and `--z-sheet` 40 |

- The width is **608 px** everywhere, the same constant as the canvas column (`screens.md` §1, D6),
  so a reply wraps the same way in the pane and in the column (D18). Smaller screens, the
  full-width pane below 900 px and the browser floor: §1.2.
- Background `--bg-elevated` (a floating layer, `docs/design.md` "Surfaces"), a 1 px `--line`
  left border, no shadow.
- While the pane is open, the view behind keeps working in the part that is in sight: the Wall
  explores, the Map pans and selects. A show command (`c4-show-canvas.md` §2) centres its target in the part in sight
  (x 0-759), not in the whole screen.
- The page root carries `data-pane="open|closed|column"` (`column` in `split`, `canvas` and
  `switch`); the element holding header, status line, conversation and input row is
  `[data-cockpit-conversation]` on every page and layout, pane or column.

### The conversation column (pending Q-O12)

In `split`, `canvas` and `switch` the conversation does not slide: it is the column of the canvas
beside or under the card area (`c4-show-canvas.md` §7.1, D78). It is always there, so it has no
opener and no `CLOSE` (D117): `[data-cockpit-open]` is not rendered while the canvas shows, `Esc`
does nothing, and the 300 s auto-close (`screens.md` §2, D5) does not apply. Inside it is the pane
of the list below, top to bottom, with these rects at 1368x912:

| Part | `canvas` (and `switch` showing the canvas) | `split` |
| --- | --- | --- |
| Column `[data-cockpit-conversation]` | x 760-1368, y 0-912, 1 px `--line` left border | x 760-1368, y 520-912, 1 px `--line` top border |
| Header (64 px) | y 0-64 | y 520-584 |
| Header buttons, from the right, 16 px in, 8 px apart, each 48 px tall | `SCREEN` x 1256-1352, `NEW` x 1176-1248, `SHELF` x 1072-1168 (only with a shelf), in `switch` the switch button `WALL` x 992-1064 (D156); y 8-56 | same x; y 528-576 |
| Status line (80 px, only while shown) | y 64-144 | y 584-664 |
| Conversation (scrolls) | y 64-808 (744 px), y 144-808 with the status line | y 584-808 (224 px, about 5 lines at 28 px), y 664-808 with the status line |
| Input row | y 808-912: input x 784-1184, `SEND` x 1200-1264, talk button x 1280-1344, y 824-888 | same |

- The talk button and `SEND` keep their rects from `screens.md` §4 and the list below: the input
  row is in the same place in a pane and in a column.
- The chip row, the hint line and `↓ NEW` stack up from the input row inside the conversation's
  band (§1.1). In `split` they never leave the conversation less than 96 px (3 lines); with the
  on-screen keyboard up the column covers the card area (§7.1).
- Other widths: the column is the right 608 px of the screen (`min(608px, 100vw)`), at the bottom
  in `split` with the card area's height above it; at 1200x800 in `switch` it is x 592-1200,
  y 0-800.

### Inside the pane, top to bottom

1. **Header**, 64 px, 1 px `--line` bottom border. Left, 24 px in: `COCKPIT` (`--font-label` caps
   16 px, `--text-2`), then 16 px later the turn state (§2) `[data-cockpit-turn]` in 18 px caps `--text-2` (D167: the state the owner looks for at a glance is not the faintest text in the header). Right, 16 px
   in: `CLOSE` `[data-cockpit-close]`, and on the Wall page `SCREEN` `[data-cockpit-screen]` to its
   left (`screens.md` §1), 8 px apart. Each
   header button is 48 px tall, ≥ 96 px wide, 16 px caps `--text-1`, 1 px `--line-strong` border.
   Left of those, 8 px apart: `NEW` `[data-cockpit-new]` (§11), 48 px tall and 72 px wide (D38);
   order from the right: `CLOSE`, `SCREEN`, `NEW`. Every rect per page and state: `screens.md` §4.1. There is no `RAW` button in C1 (§13).
2. **Status line**, 80 px (two lines, D54), only while there is something to say (offline, room
   down, the agent down or logged out: §10.1 says which one wins). The `NEW` bar (§11) uses the same 80 px slot; the status line wins it.
3. **The conversation**, filling the rest; it scrolls on its own; 24 px padding left and right,
   16 px at the top. Text column: 560 px.
4. **Input row**, 1 px `--line` top border. The **talk button** (64x64 px) keeps its one rect from
   `screens.md` §4: x 1280-1344, y 824-888 on every page (pending Q-O11). Left of it, 16 px apart: `SEND` (64x64 px) and the text input (64 px tall, mono 28 px, `--bg-sunken`,
   from x 784 to x 1184). Typing, `SEND` and the input's growth are T5's; the talk button's states
   are T6's. The row is y 808-912 on the Wall (104 px: 16 + 64 + 24) and y 808-888 in the app (80 px: 16 +
   64; the pane ends on the bottom bar's top edge).

### 1.1 The stack above the input row (T96, D133)

Five things want the band just above the input row: a one-line message, the context chip
(`c3-see.md` §9), the voice row (C5, `c5-c6.md` §3), `↓ NEW` (§4) and, in the corner, `CHAT`/`CLOSE` (`screens.md` §4). They stack
from the input row's top edge upwards, in this order, each one only while it is shown:

1. **The line slot** `[data-cockpit-line]`, `data-line="room-down|error|hint|length"`: exactly one
   message, on the row's top edge. Text left-aligned at x 784, at most 480 px wide (it ends at
   x ≤ 1264), its last line box ending 4 px above the row's top edge, 4 px free above its first line.
   **Type** (D167, T43): every message is 18 px `--font-label` weight 500, line height 24 px,
   `--text-1`; the hint and the length note in caps with 0.08 em letter spacing, the room-down and
   error lines in sentence case. One line makes the slot 32 px (4 + 24 + 4); each more line adds
   24 px, at most 3 lines (80 px), then the text is cut with `…`. No message in this spec needs 3:
   measured in Chromium with the vendored Barlow Condensed Medium, the longest error
   (`stt-down` with the `token` detail, `c2-voice.md` §10) is 842 px on one line, so 2 lines; the
   longest hint (`RELEASE TO SEND · SLIDE OFF TO KEEP`) 279 px, one line. Which one, highest first (D133):
   1. `room-down`: `Sending and voice come back with the room.` (`screens.md` §7);
   2. `error`: the microphone or speech line `[data-talk-error]` (`c2-voice.md` §5, §10);
   3. `hint`: the talk hints (`c2-voice.md` §3, §4);
   4. `length`: `8 214 / 8 000 CHARACTERS` (§7).
   One exception: while a hold that `stt-down` ended is still down, the hint `NOT LISTENING` holds
   the slot before the error, which follows at the release (`c2-voice.md` §10, D181).
   A lower message waits while a higher one shows and appears when the higher one goes, if it
   still holds (a hint whose 5 s ran out meanwhile does not come back; a limit hint, `c2-voice.md`
   §4 and D168, comes back unless a touch came meanwhile).
2. **The chip row**, 64 px, on top of the line slot (on the row's top edge when no line shows): the
   chip 48 px tall, 8 px in from the row's top and bottom, from x 784, ending at x ≤ 1264.
3. **The voice row** `[data-voice]` (C5, T128), 64 px, on top of the chip row (or of the line
   slot, or of the row), only while a spoken line plays on this screen: `SPEAKING` at x 784, 16 px
   caps `--text-2`, centred in the row's height; **`STOP VOICE`** `[data-voice-stop]`, 144 x 48 px,
   x 1120-1264, 8 px in from the row's top and bottom, 16 px caps `--text-1`, 1 px
   `--line-strong`. What it does: `c5-c6.md` §3.
4. **`↓ NEW`** floats over the conversation, 16 px above the topmost of the three (above the row
   when none shows). With a chip it is right-aligned, ending at x 1264 (x 1168-1264 at 96 px
   wide), so it never sits over the chip's `✕` and never over `CHAT` (x 1288-1336, y 760-808 is
   `CHAT`'s, `screens.md` §4, D116). Without a chip it is centred over the text column (x 1016-1112).

The conversation ends at the top of the line slot, the chip row or the voice row, whichever is
highest; `↓ NEW`
takes no height. When an item comes or goes the conversation follows §7.1's pin rule (at its end it
stays at its end; scrolled up, the line at its top stays at its top), in the next frame, no slide.

Rects at 1368x912 with a one-line input (row top y 808, on the Wall, in the app and in a column):

| Shown | Line slot | Chip row (chip) | Voice row (`STOP VOICE`) | `↓ NEW` | Conversation bottom |
| --- | --- | --- | --- | --- | --- |
| nothing | none | none | none | x 1016-1112, y 744-792 | y 808 |
| a one-line message | y 776-808 | none | none | x 1016-1112, y 712-760 | y 776 |
| a chip | none | y 744-808 (y 752-800) | none | x 1168-1264, y 680-728 | y 744 |
| a one-line message and a chip | y 776-808 | y 712-776 (y 720-768) | none | x 1168-1264, y 648-696 | y 712 |
| a two-line message and a chip | y 752-808 | y 688-752 (y 696-744) | none | x 1168-1264, y 624-672 | y 688 |
| the voice row (C5) | none | none | y 744-808 (x 1120-1264, y 752-800) | x 1016-1112, y 680-728 | y 744 |
| a chip and the voice row (C5) | none | y 744-808 (y 752-800) | y 680-744 (x 1120-1264, y 688-736) | x 1168-1264, y 616-664 | y 680 |

- **The last item clears the opener** (D267). In the sliding pane (not in a column: no `CHAT`
  there, D117) the conversation's scroll area keeps a bottom padding of `max(0, bottom − 744)` px,
  `bottom` being the table's "Conversation bottom": 64 px with nothing in the stack, 32 px with a
  one-line message, 0 px with a chip or the voice row. At its end the last item (a reply line, a `· QUEUED` block)
  then ends at y ≤ 744, 16 px above `CLOSE` (y 760-808), and never under it; scrolled up, text
  passes under the opener like under any floating button. Sketch: `sketches/c1-pane.html`.
- A taller input (§7) or the keyboard (§7.1) moves the row's top edge; every rect moves with it by
  the same amount (keyboard up: subtract 364 px, so a chip alone is y 380-444).
- The x rule makes every item in the stack end 24 px left of `CHAT`/`CLOSE` and of the talk
  button; between stacked items the gaps are 16 px or more (`↓ NEW` to what is under it) and 8 px
  (the chip inside its row). `screens.md` §4.1's control table takes these rects with its ≥ 8 px
  test (S-SCR-25).
- In a `split` column (§1) the conversation never drops under 96 px: when the status line, the
  stack and the input's growth together would leave less, the column's top moves up over the card
  area by what is missing (the most: 80 px status line, 208 px of stack (an 80 px three-line slot,
  the 64 px chip row and the 64 px voice row) and 118 px of input growth put the column at
  y 242-912).

### 1.2 Smaller screens and the browser floor (T77, D18, D249, D250, pending Q-O9)

The pane's parts keep their offsets from the pane's left edge and from the viewport's right and
bottom edges (the talk button and `CHAT`: `screens.md` §4), so at any size the input row, `SEND`
and the talk button stay inside the viewport. Two widths decide the pane's own width:

| Viewport width | Pane | The view behind |
| --- | --- | --- |
| ≥ 900 px | 608 px, the right 608 px (`min(608px, 100vw)` is 608 here) | in sight left of the pane and usable, as at 1368 (§1) |
| 700-899 px | the whole width (`100vw`), no left border | covered: `inert` while the pane is open; `CLOSE` (the corner `CLOSE` or the header's) or `Esc` is the only way back (D249) |
| < 700 px, or the window < 560 px tall | not offered (D250) | the board as today |

- **Widths inside the pane.** The input runs from the pane's left edge + 24 px to the viewport's
  right edge − 184 px; the line slot, chip row and `↓ NEW` end at the right edge − 104 px (§1.1's
  x ≤ 1264 at 1368); the text column is the pane's width − 48 px. Everything else keeps its 1368
  size. Widths at 1368 in §1 and §1.1 grow or shrink by (pane width − 608 px).
- **Heights.** On the Wall page the pane is the full height; in the app it runs from the header's
  bottom (36 px) to the bottom bar's top (`--tape-h` 24 px), as at 1368. The app's tablet shell
  (`shell.js` `layoutFor()`, 700-1199 px) has the same 36 px header and 24 px bar.
- **Crossing 900 px** with the pane open (a resize or a rotation) changes the pane's rect in the
  next frame, with no slide; the draft, the scroll position (§7.1's pin rule) and a running turn
  are unchanged.
- **A show command** (`c4-show-canvas.md` §2) while a full-width pane is open moves the camera as on
  a screen with the pane closed (centred in the whole viewport), behind the pane; the pane stays
  open; its show line (`c4-show-canvas.md` §4, with `UNDO`) is how the owner learns it, and
  `CLOSE` shows the result.
- **Below the floor** (`innerWidth` < 700 px or `innerHeight` < 560 px; the layout viewport, so the
  on-screen keyboard never trips it): `[data-talk]` and `[data-cockpit-open]` are not rendered, an
  open pane closes as with `CLOSE` (§2), a running turn keeps running and the draft stays. Back
  above the floor, both controls are drawn again and the pane is closed. The phone shell (< 700 px)
  has its own chip strip and bottom sheet where the corner cluster would sit.

**The browser floor** (D250, versions to confirm by research Q19): Chromium 108 (Chrome, Edge, the
Android WebView; the version that made the keyboard resize only the visual viewport and honours
`interactive-widget`, `research/Q11-on-screen-keyboard-signals.md`) and Safari 16 on iPadOS. The
page does not read the version; at load it checks features, and what is missing degrades as follows:

| Missing | What the screen does |
| --- | --- |
| `WebSocket`, CSS `min()` (`CSS.supports('width','min(1px, 100vw)')`) or the `inert` attribute (`'inert' in HTMLElement.prototype`) | `CHAT` opens a pane with only the header and, in the conversation's place, `[data-cockpit-unsupported]`: `This browser is too old for the cockpit. It needs Chrome 108 or Safari 16 or newer.` (18 px `--font-label`, `--text-1`, 24 px in); no input row, no talk button, no room link is opened. The board works as today. |
| `navigator.mediaDevices.getUserMedia` or `AudioWorklet` | no talk button, as with `cockpit.stt.url: none` (`c2-voice.md` §9): `SEND` takes its rect; typing works |
| `navigator.virtualKeyboard` | the visual viewport alone tells the keyboard (§7.1, D130) |
| `window.visualViewport` | `data-keyboard` stays `down`; the input row stays at the viewport's bottom and the browser scrolls the focused input into sight |
| `performance.mark` | no speed marks (`README.md` §"Speed budget"); nothing the owner sees changes |

Rects with a one-line input, nothing in §1.1's stack:

| Viewport, page | Pane | Input row | Input | `SEND` | Talk button | Corner `CLOSE` | Header `CLOSE` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1024x768, Wall | x 416-1024, y 0-768 | y 664-768 | x 440-840, y 680-744 | x 856-920, y 680-744 | x 936-1000, y 680-744 | x 944-992, y 616-664 | x 912-1008, y 8-56 |
| 1024x768, app | x 416-1024, y 36-744 | y 664-744 | same | same | same | same | x 912-1008, y 44-92 |
| 800x1280, Wall | x 0-800, y 0-1280 | y 1176-1280 | x 24-616, y 1192-1256 | x 632-696, y 1192-1256 | x 712-776, y 1192-1256 | x 720-768, y 1128-1176 | x 688-784, y 8-56 |
| 800x1280, app | x 0-800, y 36-1256 | y 1176-1256 | same | same | same | same | x 688-784, y 44-92 |

## 2. Opening and closing

**The opener** (pending Q-O11). The recommendation makes the bottom-right 64x64 button the talk
button (one press to talk, as a held key in the terminal) and adds a smaller opener for typing and
reading: `CHAT`, `[data-cockpit-open]`, 48x48 px at x 1288-1336, y 760-808 on every page. Its look
and rect are `screens.md` §4 (D116). If the owner picks Q-O11 b), the opener is D7's `AGENT`
button in the talk button's rect and these rules apply to it unchanged.

**Open.** A tap on the opener (or a press on the talk button, T6) opens the pane:
- It slides in from the right: `transform: translateX(608px)` to `0`, 120 ms, `--ease`
  (`docs/design.md` rule 5). The pane is in place ≤ 0.2 s after the tap (B7).
- While open, the opener stays in its rect and reads `CLOSE`; a tap closes the pane. `CLOSE` in
  the header does the same (D116).
- The conversation is scrolled to its end: the latest turn is in sight. When something came in
  while this screen's pane was closed, it opens on the first of it instead (§2.1).
- The input gets the keyboard focus only when the page's pointer is fine (a mouse, a paired
  keyboard: `matchMedia('(pointer: fine)')`); on a touch screen it does not, so the on-screen
  keyboard does not cover half the pane on every open (D20). A tap in the input brings the keyboard,
  and so does `EDIT` (§10, D271): it is a request to type.
- The tour stops where it is and the idle timer pauses (`screens.md` §2, D4).

**Close.** `CLOSE` in the header, `Esc` on a paired keyboard, or the auto-close (`screens.md` §2,
D5, pending Q-O12) close it: it slides out in 120 ms, the opener reads `CHAT` again. The opener
reading `CLOSE` closes it the same way. A tap on the view
behind the pane does **not** close it: it acts on the view (explore, select), so the owner can
point while the agent talks (D19). There is no swipe to close in v1 (D19).

**Kept across close and open:** the conversation, the scroll position if the owner had scrolled up
(§4), a draft in the input (`screens.md` S-SCR-04), expanded tool lines.

**Reduced motion** (`prefers-reduced-motion: reduce`): the pane appears and goes with no slide
(`--dur` is 0 ms in `tokens.css`).

**Turn state**, in the header and on the root as `data-turn`. The header draws three words; the
root keeps the finer values for tests (D56): what the agent is doing is already in sight in the
conversation (`· SENDING` on the prompt, `●` on a tool line, the `▍` cursor).

| `data-turn` | Header text | When |
| --- | --- | --- |
| `idle` | `READY` | no turn running |
| `thinking` | `● WORKING` | a prompt was sent; no reply text yet, no tool running |
| `working` | `● WORKING` | a tool call is running (§5) |
| `answering` | `● WORKING` | reply text is streaming |
| `stopping` | `● STOPPING` | `STOP` or `START` (§11) was tapped; until the turn's end arrives (≤ 5 s, §8) |

The `●` is `--text-2`, static (nothing blinks for decoration). Speaking up without a prompt
(`coworker.md`) uses the same states.

### 2.1 Since you looked (T66, D233, D234)

`reviews/44-operator.md` finding 5: at 07:30 the morning question is "what needs me", and the
answer must not be "scroll and read". When things came into the conversation while **this
screen's** pane was closed, the pane opens on the first of them, under a divider.

- **Looked at.** Each screen has one time, `lookedAt`: the moment its pane last closed (`CLOSE`,
  `Esc`, the opener, the auto-close of D5). While the pane is open, or is a column (`split`,
  `canvas`, `switch`, pending Q-O12), there is none: that screen is looking. A screen whose pane
  never opened since it was paired has its pairing time.
- **What counts as new**: every item of the conversation whose time is after `lookedAt`: a turn
  (its `at`, the owner's from any screen and the agent's own), a raised block (`coworker.md` §3.2,
  its `at`) and a `NEW CONVERSATION` divider (§11, its `at`). A turn that was already running when
  the pane closed is not new, even if its text ends later. Turns typed or spoken at another screen
  count: the divider says what this screen has not shown, not what the owner has not seen (D233).
- **The divider** `[data-cockpit-since]`, drawn when the pane opens and at least one item is new,
  right above the first new item: the look of §11's divider (a full-width row, 48 px tall, 1 px
  `--line` rules left and right of 16 px caps `--text-3`). Text, written as one upper-case DOM
  string (no CSS `text-transform`): `SINCE YOU LOOKED · ` and `lookedAt` by `clockText` of
  `README.md` "Times on the screen" (D232), upper-cased: `SINCE YOU LOOKED · 22:40`,
  `SINCE YOU LOOKED · YESTERDAY 22:40`, `SINCE YOU LOOKED · 25 OCT 22:10` (D234). The longest,
  34 characters, is about 330 px of the 560 px column. It is a label, not a tappable: no pressed
  state, no handler.
- **The opening scroll.** The pane opens scrolled so the divider's top is the conversation's
  visible top, in the same frame as the slide's start. If what sits below the divider is shorter
  than the visible conversation, the view is at its end instead (pinned, §4) and the divider stands
  where it falls. Otherwise the view is unpinned and `↓ NEW` shows (§4): one tap to the end. This
  wins over "opens at its end" (§2) and over a scroll position kept from before the close.
- **While the pane stays open** the divider stays where it is; new turns go below it as usual,
  `SEND` pins to the end (§7). **At the close** it is removed, in the same frame; the next open
  draws it again only above items newer than this close. With nothing new the pane opens as §2
  says, with no divider.
- **Older than the drawn turns.** If the first new item is not among the 50 turns drawn (D27), the
  screen asks `history` (`protocols.md` §3.7) until it holds it, at most 3 times (200 turns); past
  that the divider sits above the oldest drawn turn, under `SHOW EARLIER`.
- **The marker** (`coworker.md` §3.4, pending Q-O11 c) goes in the first frame of the open, as
  there; the divider is what the dot pointed at.
- **Where `lookedAt` lives.** The screen keeps its own while its page runs. The room keeps one per
  screen from the `focus` messages (`protocols.md` §3.8: `pane` going from `open` or `column` to
  `closed` sets it to that message's `at`; a link lost with the pane open sets it to the loss's
  time) and sends it in `welcome` as `lookedAt` (`protocols.md` §2.2). A fresh page (a reload, the
  tablet rebooted) takes the room's; a reconnecting page keeps its own. So the 07:30 view after a
  night in which the screen restarted is the same, as long as the room still holds the turns:
  under Q-O24 a) or b) it does (`protocols.md` §11.7.1); under Q-O24 c) a reload shows an empty
  conversation and no divider.
- Not in the demo's static mode (§15): its canned conversation has no "before".

## 3. A turn in the conversation

A turn is drawn top to bottom in the order things happened: the prompt, then the reply's text
blocks, tool lines (§5) and show lines (`c4-show-canvas.md` §4) interleaved as the agent produced them.

- **Label row** `[data-turn-label]` above the prompt and above the reply, 24 px tall, 16 px caps
  `--text-3`, with the cockpit's rule (§3 "The cockpit's own lines", D227): a 2 px `--line-strong`
  left border and 8 px padding left: `YOU · 07:02` (`YOU · SPOKEN · 07:02` for a voice prompt, C2) and `AGENT · 07:02`. Time is the
  screen's local `HH:MM`, 24 h; a date is `D Mon` in English (`27 Oct`, D149). A reply's label row
  also carries the turn's age from 3 s on (§9, D235).
- **The delivery word** (D270). A prompt's label row ends with ` · SENDING`, ` · QUEUED` or
  ` · NOT SENT` while one holds (§7, §8, §10 E1). The word is its own span
  `[data-turn-delivery="sending|queued|not-sent"]`, 18 px caps `--font-label` weight 500
  `--text-1` (the instruction floor, D21, D167: it tells the owner whether to repeat the words);
  the ` · ` before it and the rest of the row stay 16 px `--text-3`. The row stays 24 px tall, the
  word on the row's baseline. A row with no delivery word has no such span.
- **The prompt**: mono 28 px, line height 1.4 (39.2 px), `--text-1`, in a block on `--bg-surface`
  with a 1 px `--line-weak` border and 12 px / 16 px padding (pending Q-O18).
- **The reply**: mono 28 px, line height 1.4 (39.2 px), `--text-1`, straight on the pane's
  background (pending Q-O18). The mono face (`--font-mono`, JetBrains Mono) advances 0.6 em per
  character: 16.8 px at 28 px, so the 560 px column holds 33 characters per line (42 at 22 px).
- Spacing: 32 px between turns, 16 px between blocks of one reply, 8 px between a label row and
  its block.
- The type sizes are named constants in the module of D6 (D21): `TYPE_TALK = 28` (prompt, reply,
  input and live words, `c2-voice.md` §4) and `LINE_TALK = 1.4`. Q-O18 asks 22 or 28 px: research Q1
  puts the floor near 22 px at 60 cm on a 12.3 in panel and 26-30 px for text read while speaking;
  the spec is written for 28 px (Q-O18 b). If the owner picks 22 px, only the two constants and the
  derived figures change: 42 characters per line, the input's 27 per line and 157 px at 4 lines
  (§7), and the rects that follow from the input's growth (§1.1, §7.1, S-C1-14/33/34).

### Streaming

- Reply text is appended as the bridge's text deltas arrive (`protocols.md` §3.2, §11.4), drawn at most
  once per animation frame. A line still being written is drawn as plain text until its newline
  arrives; then the line takes its markup (a table row, a list item). An open code fence is drawn
  as a code block until it closes.
- While text streams, a static block cursor `▍` in `--text-3` follows the last character.
- When the bridge sends a text block complete, it **replaces** the text built from the deltas (a
  lost delta cannot leave wrong text, research Q2).
- **Budget:** the first reply text is on screen ≤ 0.5 s after the room sends the turn's first
  `text.delta` (its `sentAt`; B4, the speed budget in `README.md`, D288).

### What a reply may contain (D22, D23)

The reply is Markdown, drawn with this subset; anything else shows as its plain text.

| Markdown | Drawn as |
| --- | --- |
| paragraph | 28 px text (§3, pending Q-O18); blocks separated by 16 px |
| `#`, `##`, `###` heading | one style: mono 28 px weight 600, `--text-1`, as written (no caps, `text-transform: none`), 24 px above (D227) |
| `**bold**` | weight 600 (the mono face has 400 and 600 only; `*italic*` draws as plain text) |
| `` `code` `` inline | same size, `--bg-sunken`, 1 px `--line-weak` border, 4 px side padding |
| bullet and numbered lists | marker `·` or `1.` in `--text-3`, 32 px hanging indent; 2 levels, deeper levels draw at level 2 |
| `> quote` | `--text-2`, a 2 px `--line` left border (never `--line-strong`, D227), 16 px padding |
| `---` | a 1 px `--line` rule, 16 px above and below |
| fenced code block | §3 "Code" below |
| table (GFM pipes) | §3 "Tables" below |
| `[text](url)`, a bare URL | the text in `--text-1` with no underline, then ` (host)` in `--text-3`; a `<span data-link>`, never an `<a>`, no `href` anywhere; **not tappable**, no pressed state (D22, D225) |
| `![alt](url)` | `[image: alt]` in `--text-3`; nothing is fetched |
| raw HTML (`<b>`, `<img …>`, `<script>`) | shown as its literal text, escaped; never parsed (D22) |

**Colour in a reply** (D25): the text is `--text-1` and `--text-2` only. The four status marks are
the one exception and take their colour wherever they appear: `■` `--p1`, `▲` `--p2`, `●` and `○`
grey (`docs/design.md`, the colour rule; `public/js/core/marks.js`). The agent cannot colour
anything else: a word "down" with no mark stays grey.

**Code.** Mono 18 px, line height 1.4, `--bg-sunken`, a 2 px `--line` left border and no other
border (D227), 12 px / 16 px padding.
Lines never wrap; the block scrolls sideways on its own. The fence's language, if given, sits top
right in 16 px caps `--text-3` (D21's floor). A block of more than 12 lines shows its first 12 and a full-width
button under it, 48 px tall, 16 px caps: `SHOW ALL 40 LINES`; tapped, it shows every line and reads
`SHOW LESS`.

**Tables.** Header cells 16 px caps `--font-label` 600, `--text-3`; body cells mono 18 px
`--text-1`; every row 44 px tall (`--row-touch`: rows are not tappable, so the 48 px floor of tappables does not apply, D226), 12 px cell padding left and right, a 1 px
`--line-weak` line under each row. A column whose body cells are all numbers, times or sizes
(`12`, `3.4 GB`, `1 h 12`, `41 %`, `03:12`) is right-aligned. A table wider than 560 px scrolls
sideways inside its block with the first column fixed (on `--bg-elevated`). Every row is drawn,
however many (D23: 20 rows are 880 px, one flick).

**Which columns are right-aligned** (D146). A cell is *numeric* when its text, with inline markup
taken off (`**12**` is `12`) and trimmed, is at most 40 characters and matches

```
^(?:[-+−]?\$?\d+(?:[.,]\d+)?(?: ?(?:%|(?:[KMGT]i?)?B|ms|s|min|h|d))?|\d+ h \d{2}|\d{1,2}:\d{2}(?::\d{2})?)$
```

A cell that is empty, `-` or `—` is *neutral*. A column is right-aligned when it has at least one
numeric body cell and every other body cell is numeric or neutral; its header cell is right-aligned
with it. GFM's alignment row wins where it says something: `---:` right, `:---` left; `:---:` and
`---` leave it to the rule (the design has no centred table text).

| numeric | not numeric |
| --- | --- |
| `12`, `-3`, `+2`, `3.4 GB`, `3,4 GB`, `12 MiB`, `41 %`, `41%`, `250 ms`, `45 s`, `12 min`, `3 d`, `$0.42`, `1 h 12`, `03:12`, `3:12:05` | `hv1`, `v2`, `1.2.3`, `12 GB free`, `~3 min`, `03:12 UTC`, `1e5`, `1 234`, `12/40` |

**The renderer** (D146) is laneboard's own module, `public/js/core/md.js`, with no dependency, in
the style of `public/js/core/hl.js`: a pure ES module, no imports, no DOM. `parse(text)` returns
an array of plain block objects (`p`, `h`, `list`, `quote`, `rule`, `code`, `table`, and `tail`
for a last line with no newline yet), each holding inline runs (`text`, `bold`, `code`, `link`
with `text` and `host`, `image` with `alt`, `mark`). The pane builds the DOM from them with
`textContent` only, never `innerHTML`, so nothing in a reply is parsed as markup. `parse` walks
the text once: a line longer than 2 000 characters is one plain `p` run, and its regexes, the
numeric-cell one included, have no nested quantifiers. The pane calls it on a text block's whole
text once per animation frame while the block streams (§3 "Streaming"); a code fence still open
comes back as a `code` block with `open: true`. Its unit test, `test/md.test.mjs` in `npm test`,
is table-driven: one case per row of the subset table above, the numeric/not-numeric cells
above, a fence open at the end, three-level lists drawn at level 2, a table row still being
written (a `tail`), and S-C1-09's four hostile strings.

### The cockpit's own lines (T59, D227)

Text in a reply comes from the agent, and the agent reads fleet fields anyone can write
(`security.md`). A reply that says `### YOU · 07:02` or holds a code block reading
`Not sent: the room did not confirm within 5 s.` must not pass for a line the cockpit drew.

- **The rule.** Every line the cockpit writes into the conversation itself carries a 2 px
  `--line-strong` left border: the label rows (`[data-turn-label]`, §3), the error lines and every
  line drawn "as E1's look" (`[data-turn-error]`, §8, §10) and the stopped line (`STOPPED AT 07:03`,
  §8, `[data-turn-stopped]`). Error lines also keep their 1 px `--line-strong` border on the other
  three sides.
- **Nothing in a reply draws it.** No element of a reply's blocks (`[data-reply]`, the DOM built
  from `md.js`'s blocks) has a `--line-strong` border on any side: a quote's rule is `--line`, a
  code block has a `--line` left border only, inline code a 1 px `--line-weak` box. Headings are
  28 px `--text-1` as written, never 16 px caps: caps at 16 px in the label face are the cockpit's.
- **Marks stay coloured** (D25): `■ hv1 down` in a reply is still red. What tells it from the
  cockpit's own news is where it sits: in the reply's 28 px text, under an `AGENT · HH:MM` row,
  never in a ruled line.
- Outside the conversation (the status line §10.1, the line slot §1.1, the header) a reply cannot
  draw at all, so those keep their look.

### History in the pane

The pane draws the last 50 turns. Older turns, if the screen holds them, come back with
`SHOW EARLIER` (full width, 48 px, 16 px caps) at the top of the conversation, 50 at a time (D27).
The screen holds the conversation in memory only (`screens.md` D14); what a screen gets from the
room after a reload is the `snapshot` of `protocols.md` §2.2 (`history` for `SHOW EARLIER`, §3.7).
The room keeps the conversation on disk for 30 days, so a room restart shows the same turns
(`protocols.md` §11.7.1, pending Q-O24; S-C1-39).

## 4. Following a reply as it grows

- The conversation is **pinned** to its end while its last pixel is within 48 px of the bottom of
  the visible area: new text scrolls it along.
- A drag up unpins it: new text no longer moves the view. A button `↓ NEW` `[data-cockpit-follow]` appears, 48 px tall,
  96 px wide, 16 px caps `--text-1` on `--bg-elevated`, 1 px `--line-strong` border, 16 px above
  the input row or the stack on it, centred, or right-aligned at x 1264 while a chip shows (§1.1). A tap jumps to the end (instantly, no smooth scroll: `docs/design.md`
  rule 5) and pins again; scrolling back down by hand does the same (D26).
- Opening the pane shows the end, unless something came in while it was closed (the
  `SINCE YOU LOOKED` divider at the top, §2.1) or the owner had scrolled up before closing it (§2).

## 5. Tool lines

The agent's tool calls are shown as **tool lines**, never as raw input or output. An opened tool line
(below) is the closest look C1 gives at a call (§13).

**Folding.** In one turn, calls of the same tool with no reply text between them fold into one tool
line. A call of another tool, or reply text, starts a new line. A tool line sits in the reply where
its first call happened.

**Look.** One row, 48 px tall (D226), the full text column, mono 18 px `--text-2`. A 24 px glyph column at
the left holds `●` (`--text-2`, static) while any call in the line runs, nothing once all have
ended. While running the text ends in `…`. At the right end, `+` (closed) or `−` (open) in 20 px
`--text-2`. The whole row is the tap target: a `<button type="button">` with the pressed state
and `touch-action: manipulation` (`README.md` §"Touch", D224).

**Words** (D24). Each tool has a `one` text (one call, or every call on the same target) and a
`many` text (`{n}` calls on different targets). `{target}` is one field of the call's input,
shortened to 32 characters with `…`. The table lives in one client module keyed by tool name;
the laneboard MCP tools arrive as `mcp__laneboard__<tool>` and are matched without the prefix.

| Tool | `{target}` from | `one` | `many` |
| --- | --- | --- | --- |
| `fleet` (C3) | `site` | `read the feed of {target}`; no site: `looked at the fleet` | `read {n} feeds` |
| `runs` (C3) | `run` | `looked at run {target}`; none: `looked at the runs` | `looked at {n} runs` |
| `lanes` (C3) | `builder` | `looked at the lanes on {target}` | `looked at lanes on {n} builders` |
| `ci` (C3) | `branch` | `looked at CI on {target}` | `looked at CI on {n} branches` |
| `alerts` (C3) | none | `read the alerts` | `read the alerts {n}×` |
| `morning` (C3) | `window` | `read the Morning for {target}` | `read the Morning {n}×` |
| `history` (C3) | `node`, else `run` | `read the history of {target}` | `read the history of {n} nodes` |
| `focus` (C3) | `screen` | `looked at this screen`; another: `looked at screen {target}`; `all`: `looked at the screens` | `looked at {n} screens` |
| `Read` | `file_path`, last path part | `read {target}` | `read {n} files` |
| `Grep`, `Glob` | none | `searched the files` | `searched the files {n}×` |
| `Bash` (not allowed in v1) | `command`, whole, each run of white space as one space | `ran {target}` | — (never folds, §5.2) |
| `WebFetch` (not allowed in v1) | `url`, host only | `fetched a page from {target}` | `fetched {n} pages` |
| `WebSearch` (not allowed in v1) | none | `searched the web` | `searched the web {n}×` |
| `Edit`, `Write`, `NotebookEdit` (not allowed in v1) | `file_path` (`notebook_path`), last path part | `changed {target}` | — (never folds, §5.2) |
| `Task` (not allowed in v1) | none | `asked a helper agent` | `asked {n} helper agents` |
| any other tool | none | `used {name}` (another MCP server's tool: `used <server>:<tool>`) | — (never folds, §5.2) |

The C3 rows follow the tools' parameters in `c3-see.md` §4 (T8: `morning` takes `window`,
`history` takes `node` or `run`). Rows marked "not allowed in v1" are refused by the launch line
(§5.2, pending Q-O23); their words stay for Q-O23 b) or c) and for a later C6. Show commands (`fly_to`, `pin`, …) are not tool lines: each leaves
its own show line (`c4-show-canvas.md` §4).

**Targets from odd input** (D147). `{target}` is always taken from the room's redacted copy of the
input (§5.3), so a secret in it reads `[redacted]` on the line too.
- **Missing.** A target field that is absent, empty, or not a string (a number is turned into its
  text: `run` `7` reads `7`) gives the row's no-target text: `fleet`, `runs` and `focus` have
  theirs in the table; the others read `looked at the lanes`, `looked at CI`, `read the Morning`,
  `read the history`, `read a file`, `ran a command`, `fetched a page`, `changed a file`. A line
  folds calls with and without a target as `many` calls.
- **Shortening.** Every `{target}` is trimmed, each run of white space (newlines too) becomes one
  space, and it is cut by counting characters (code points, never half of an emoji): at most 32
  are kept; if more follow, the cut goes back to the last space among those 32 when that space is
  at character 16 or later, and `…` is added. So
  `rm -rf /var/log/laneboard/old && echo done` reads `ran rm -rf /var/log/laneboard/old…` (§5.2).
- **`Bash` prefixes are kept.** `cd /srv/app && npm test` reads `ran cd /srv/app && npm test`, and
  `PGPASSWORD=hunter2 psql -h db` reads `ran PGPASSWORD=[redacted] psql -h db` (rule 4 of §5.3).
  The line never skips a `cd …&&`, an env assignment or `sudo` to reach "the real command": what
  it would run is the whole string, and the line of a tool that changes things shows only what
  the input says (§5.2). The full command is one tap away.
- **`WebFetch` addresses.** The host is `new URL(url).hostname` (lower case, punycode as the URL
  API gives it, no port, no `www.` dropped). A `url` that does not parse, or whose scheme is not
  `http:` or `https:` (`javascript:`, `file:`, `data:`), reads `fetched a page from an invalid
  address`; it is never drawn as a link (D22). Two calls on one host count as one target.
- **`Read` paths.** The last part of `file_path` after the last `/`, a trailing `/` ignored:
  `/etc/laneboard/` reads `read laneboard`; `/` alone reads `read /`.

**Failures.** A line with failed calls appends ` · 1 failed` (or ` · 2 failed`) in the same grey (a
refused call is not a failure: §5.2): a
tool error is news about the agent, not trouble in the fleet (`docs/design.md`, the colour rule).

**Open.** A tap on the row opens it: under it, one row per call, mono 16 px `--text-2`, 8 px
indent: `<tool>  <input as compact JSON, cut at 120 characters>  <ms> ms  ok|failed`. A tool that
changes things shows its whole input instead, wrapped (§5.2); a refused call ends in `refused` in
place of `<ms> ms  ok|failed`. A second tap closes it. Tool output is never shown here. The input
is the room's redacted copy (§5.3), drawn as text, never as markup.

**The agent's writing.** The screen does not shorten replies. "Short blocks" is asked of the agent:
the room's standing instructions for the agent (`protocols.md` §11.8, word for word there) say: lead with the answer in
one sentence; at most 3 sentences per paragraph; a table for 3 or more items that share fields;
code only when asked; marks `■ ▲ ● ○` before trouble words. Long replies are §9.

### 5.1 The messages behind §2-§5 (T29)

The pane draws only from the room's messages; their fields and examples are `protocols.md` §2.2 and
§3.2 (one place), the bridge behind them §11.3-§11.4. This table says what each one changes in the
pane. Every message is applied in `seq` order; a `seq` at or below the last applied is dropped
(`protocols.md` §2.2).

| Message | Fields the pane reads | What the pane does |
| --- | --- | --- |
| `welcome` | `config.stt`, `status` | sets the talk button (`c2-voice.md` §9) and the status line (§10); draws nothing in the conversation |
| `snapshot` | `turns[].items[]` by `blockIndex`, `end`, `olderTurns` | replaces the whole conversation once its last part is in; a running turn continues from where it is (§12) |
| `turn.prompt` | `turnId`, `clientId`, `text`, `source`, `at`, `delivery` | the sender's block loses `· SENDING`; other screens draw the prompt block (§7, §12). With `delivery:"new"` it is the turn's start; with `queued` the block reads `· QUEUED` (§8); the `AGENT · HH:MM` label row comes with the turn's first item, or 3 s after the turn's start if nothing came by then (§9) |
| `prompt.taken` | `turnId`, `clientId`, `state`, `atBlock`, `why` | `taken`: `· QUEUED` goes, the block moves to `atBlock` of `turnId`; `cancelled`: `NOT SENT` and the line for `why` (§8) |
| `turn.state` | `state` | sets `data-turn` and the header word (§2) |
| `text.delta` | `turnId`, `blockIndex`, `text` | appends to that text block, creating it at its `blockIndex` place if new; the `▍` cursor follows it (§3) |
| `text.block` | `turnId`, `blockIndex`, `text` | replaces that block's text; the cursor leaves it |
| `tool.start` | `turnId`, `blockIndex`, `toolUseId`, `tool`, `input`, `startedAt` | adds a call: to the tool line before it if the fold rule below says so, else a new line at its `blockIndex` place; `●` and `…` on |
| `tool.end` | `toolUseId`, `endedAt`, `isError`, `denied` | ends that call; its open row shows `endedAt − startedAt` in whole ms and `ok` (`isError:false`) or `failed`; with `denied:true` the call is refused and its line becomes §5.2's `tried` line; `●` goes once no call of the line runs |
| `turn.retrying` | `attempt`, `of` | E5's grey row (§10) |
| `turn.end` | `state`, `code`, `steps`, `detail`, `forced` | the cursor goes, running calls lose `●`; the end line of `protocols.md` §3.2's table; `data-turn="idle"`, `READY` |
| `heartbeat` | — | nothing drawn; resets the 25 s loss timer (`screens.md` §7) |

**Place.** Items of a turn sit in `blockIndex` order whatever order their messages came in: an item
with a lower index that arrives later is inserted above the higher one. A text block and a tool
call never share an index (`protocols.md` §3.2).

**The fold rule, in these terms** (§5 "Folding", D24). A `tool.start` joins the tool line whose
last call has `blockIndex` one less than its own, if that call is of the same tool (`mcp__laneboard__`
stripped) and that tool is not one that changes things (§5.2). Anything else starts a new line. So calls the agent makes in parallel (several
`tool.start` with consecutive indexes before any `tool.end`) fold like calls made one after the
other; parallel calls of two tools are two lines, each with its own `●`. `{n}` in a `many` text
counts the line's started calls; the `one` text stays while every call has the same `{target}`;
` · {k} failed` counts ended calls with `isError:true` and `denied` not `true`.

**A message the pane cannot place** (D119): a `text.*`, `tool.*`, `turn.state`, `turn.retrying` or
`turn.end` naming a `turnId` the pane does not hold, a `tool.end` naming an unknown `toolUseId`, or a
`prompt.taken` naming a `clientId` the pane does not hold.
The pane has missed something: it closes the link with 4000 `gap` and takes the snapshot
(`protocols.md` §2.2). Nothing on screen changes until the snapshot has been drawn.

**A fresh screen** (a load or a reload, D118). From the page's load until the last `snapshot` part
is drawn, `data-cockpit="connecting"` (`screens.md` §7). The pane, if opened, shows its header
(`READY` greyed, `NEW` disabled), the input (editable, a draft can be written, `SEND` disabled) and
in the conversation one line at its top, 18 px `--text-2`: `Connecting to the cockpit room…`. Then:
- the snapshot holds turns: they are drawn, scrolled to the end (§2), the line goes;
- the snapshot holds no turn (a new room, or right after `NEW` with nothing said): the line
  becomes `Nothing said yet. Type a question, or hold the talk button and speak.` (with
  `config.stt` `none`: `Nothing said yet. Type a question below.`), 18 px `--text-2`, until the
  first `turn.prompt`. The pane is never blank (`docs/plans/product.md`, never an empty screen);
- no snapshot 5 s after the load: `data-cockpit="room-down"` and §10's status line, its "since"
  being the page's load time (`screens.md` §7); the `Connecting…` line goes.

### 5.2 What the agent may use, refused calls, tools that change things (T57, pending Q-O23)

Written for Q-O23's recommendation a): "look freely, change only with a yes" (`spec-input.md` §6).

**The allowlist.** The room launches Claude Code with `--strict-mcp-config`,
`--allowedTools mcp__laneboard__*,Read,Grep,Glob` and `--permission-prompts none` (the whole line
is `protocols.md` §11.2, one place). So the agent may call the laneboard MCP tools (C3) and read,
search and list files its own unix user can read. Every other call (`Bash`, `Edit`, `Write`,
`NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, any other MCP server's tool) is refused by Claude
Code before it runs; nothing asks anyone, because nobody is there to answer. Claude Code writes
`system/permission_denied` for it, the room sends `tool.end` with `denied:true` (`protocols.md`
§11.4). The standing instructions tell the agent so (`protocols.md` §11.8, the line
`You can only look…`). What the agent's uid may read is `security.md` §3; another agent
(`kind: bridge`) is held to the same list by `protocols.md` §11.11 (D240): a call it refuses is a
`tool.start` with `denied:true` and draws the same `tried` line.

**A refused call** (D125) leaves a **`tried` line**:
- text `tried {tool}, not allowed`, `{tool}` the name the agent used (`Bash`, `WebFetch`); another
  MCP server's `mcp__<server>__<tool>` reads `<server>:<tool>`;
- the same row as any tool line (48 px, mono 18 px `--text-2`, `+`/`−` at the right), its glyph
  column empty: no `●`, no `…`, no ` · failed`; `[data-tool-line][data-denied="true"]`;
- it holds that one call and never folds (below). Between the call's `tool.start` and its
  `tool.end` (the same few ms in practice) the line shows the table's running text, as any call;
- opened, its row reads `<tool>  <whole input, wrapped>  refused`;
- the turn goes on: the agent reads the refusal and answers. A refused call is not an error end
  and adds no line of §10.

**Tools that change things** (D126) are `Bash`, `Edit`, `Write`, `NotebookEdit` and every tool
under "any other tool" in §5's table. Refused in v1, they get these rules now so Q-O23 b)/c) or C6
can lift the refusal without touching the pane:
- they **never fold**: each call is its own line, and no call joins a line of theirs;
- the collapsed text starts with the table's verb (`ran`, `changed`, `used`), followed only by
  `{target}` taken from the input, never by a word the agent chose for the line;
- the `Bash` `{target}` is the whole command, each run of white space as one space, cut at 32
  characters with `…`: `rm -rf /var/log/laneboard/old && echo done` reads
  `ran rm -rf /var/log/laneboard/old…`, not `ran rm`;
- opened, the row shows the whole input the room sent (D97: every string at most 200 characters,
  the object at most 2 000), as compact JSON wrapped inside the text column
  (`white-space: pre-wrap; overflow-wrap: anywhere`), never cut at 120 characters.

### 5.3 Secrets in tool input (T57)

The room redacts every tool input before it leaves the room's process for anything a screen can
read: the `tool.start` frame, the `snapshot`, and whatever the room keeps of the conversation (D127). The screen
never holds the raw value, so the opened row (§5), the `{target}` of a collapsed line and the
`tried` line all show `[redacted]` where the secret was. This hides secrets from a desk screen; it
is not what stops the agent sending one out (that is §5.2's allowlist).

Rules, applied in this order to every string value of the input (JSON keys are never changed; the
module is `server/cockpit/redact.mjs`, one table-driven unit test in `npm test` with one case per
row):

| # | Matches (case-insensitive unless said) | Becomes |
| --- | --- | --- |
| 1 | the exact value of any secret the room holds: `LANEBOARD_MCP_TOKEN`, the speech token (`cockpit.stt.tokenFile`), the values of `cockpit.agent.env`'s names | `[redacted]` |
| 2 | a PEM block from `-----BEGIN` … `PRIVATE KEY-----` to its `-----END` line, or to the string's end | `[redacted]` |
| 3 | `Bearer `, `Basic ` or `Token ` followed by non-space characters | the word kept, the rest `[redacted]`: `Bearer [redacted]` |
| 4 | a name containing `pass`, `secret`, `token`, `key`, `auth`, `credential` or `sig` (`lb_sig`, `api_key`, `PGPASSWORD`), as a JSON key or inside a string as `name=value`, `name: value`, `--name value` or `--name=value` | the value up to the next white space, `&`, `"`, `'` or `,` becomes `[redacted]`, unless it is already `[redacted]` or is rule 3's word (`Authorization: Bearer [redacted]` stays); a JSON key's whole value (any type) becomes `"[redacted]"` |
| 5 | known token prefixes, case-sensitive: `sk-` and 20 or more characters, `ghp_`, `gho_`, `ghs_`, `github_pat_`, `glpat-`, `xoxb-`, `xoxp-`, `AKIA` and 16 upper-case letters or digits | `[redacted]` |
| 6 | a run of 32 or more characters of `A-Z a-z 0-9 + / = _ -` holding at least one upper-case letter, one lower-case letter and one digit | `[redacted]` |

- Rule 6 leaves git hashes, hex digests and UUIDs alone (no upper-case letter) and catches most
  API keys and JWTs. Over-redaction (a `keyboard=` value, a long mixed-case path part) is accepted.
- Redaction runs before D97's cuts, so a cut never splits a secret into a visible half.
- Reply text is redacted too, with rules 1, 2, 3, 5 and 6 and a hold-back for a word split across
  deltas: `security.md` §5 (D211).

## 6. Scenarios

The fake agent (T18) replays scripted turns: text deltas with times, tool calls and their ends.
Every scenario runs at 1368x912 against the demo hub, the room under test and the fake agent, on a
paired screen.

Every `Test:` line names what it reads (a selector of `README.md` §"Selectors tests use" or a
message of `protocols.md` §2.4) and ends with `Runs on:`: the stand-ins (`stand-ins.md`), the
script (§5 there) and one of three clocks (T134, D290):
- **`clock real`**: nothing is faked. `t` runs from the test's action, read with
  `performance.now()` in the page; `by t = x s` passes when a sample at or before x s shows it
  (samples every 50 ms unless the line says otherwise).
- **`clock page`**: `page.clock.install({time})` before the load, at the scenario's `HH:MM`; the
  page's time then flows with the real time, so the fake agent's real-time steps (`stand-ins.md`
  §2.3) and the page's own timers (`CONFIRM_WAIT_MS`, `STOP_GUARD_MS`, the age's tick, §16) stay in
  step; `page.clock.runFor` or `pauseAt` only where the line says.
- **`clock advance`**: the room's clock `manual` and the page's installed, both moved by
  `advance(ms)` (`stand-ins.md` §1.1), and only once the fake agent's timed steps the scenario
  needs have been read, or on a turn without timed steps.

"N seeded turns" are `done` turns written before boot by `test/cockpit/fixtures/conversation.mjs`
through `boot({stateFiles})` (`stand-ins.md` §1.1), dated in the last hour; "no turn played" means
the script is loaded and no prompt is sent.

### S-C1-01 The pane opens from the Wall in 0.2 s and leaves the wall in sight (pending Q-O11)
Given a screen in `wall` layout touring, the pane closed,
When the owner taps `[data-cockpit-open]` at t = 0 ms,
Then by t = 200 ms `data-pane="open"`, the pane's rect is x 760, y 0, 608 x 912, its transform is
`none`; the slide's computed `transition-duration` is 120 ms; the opener reads `CLOSE` at
x 1288-1336, y 760-808; the talk button is at x 1280-1344, y 824-888 (`screens.md` §4); `data-wall-state="explore"`; the latest turn's last
line is in sight; `document.activeElement` is not the input.
Test: Playwright with `hasTouch: true`; tap; at 200 ms read the rects, the computed transition and
`document.activeElement`; a second run with a mouse click asserts the input has focus.
Reads `data-pane` and `data-wall-state` on the root, the rects of `[data-cockpit-conversation]`, `[data-cockpit-open]` (and its text) and `[data-talk]`, and whether `document.activeElement` is `[data-cockpit-input]`. Runs on: the room under test and the fake agent, script `c1-render` (no turn played), 3 seeded turns; clock `real`.

### S-C1-02 Closing: both CLOSE controls and Esc close it, a tap on the wall does not
Given S-C1-01's open pane with the draft `how is` in the input,
When the owner taps the map at (400, 480),
Then the pane stays open and `data-wall-state` is `explore` with the camera moved to the tap.
When the owner taps `CLOSE` at t = 0 ms,
Then by t = 200 ms `data-pane="closed"`, the pane is off screen, the opener reads `CHAT`.
When the owner opens the pane again, the draft `how is` is in the input; a tap on the opener, now
reading `CLOSE` at (1312, 784), closes it by 200 ms; opened once more, `Esc` on a keyboard closes it.
Test: Playwright; tap coordinates on the wall; tap the header `CLOSE`, then `[data-cockpit-open]`;
assert `data-pane` and the opener's text after each step; `keyboard.press('Escape')`.
The header `CLOSE` is `[data-cockpit-close]`; the draft is `[data-cockpit-input]`'s value. Runs on: the room under test and the fake agent, script `c1-render` (no turn played); clock `real`.

### S-C1-03 The pane over the Map leaves the Map usable
Given the app on `#/map` at 1368x912 with a node selected and the inspector open,
When the owner opens the pane,
Then the pane is at x 760, y 36, 608 x 852; the header and the tape are not covered; the
inspector is under the pane; `location.hash` is unchanged; a drag on the Map at (300, 400) pans it
and a tap on another node at x < 760 selects it, with the pane still open.
Test: Playwright; read the pane rect and its computed `z-index` (35); compare the hash; drag and
tap, assert the Map's selection changed and `data-pane="open"`.
The pane is `[data-cockpit-conversation]`. Runs on: the room under test and the fake agent, script `c1-render` (no turn played), the demo hub's nodes on the Map; clock `real`.

### S-C1-04 A reply streams in, then settles
Given the pane open and the fake agent scripted to wait 300 ms after a prompt, then send
`Two of three runs finished.` in 6 deltas 100 ms apart, then the complete block,
When the owner sends `how did the night go?` at t = 0,
Then `data-turn` is `thinking` and the header reads `● WORKING` within 0.1 s (B8); the first word
is on screen ≤ 0.5 s after the first delta (B4) and `data-turn="answering"`; the cursor `▍` follows the
text; after the complete block the reply reads exactly `Two of three runs finished.`, the cursor
is gone and the header reads `READY`.
And a script that drops delta 4 still ends with the exact text, from the complete block.
Test: Playwright with the fake agent's timed script; poll the reply text and `data-turn` every
50 ms; compare the times against the script's send times.
The reply is `[data-reply]`, the header `[data-cockpit-turn]`; the delta times are the `text.delta` frames' `sentAt` (`framereceived`). Runs on: the room under test and the fake agent, script `c1-render` (§2.2's example of `stand-ins.md`; its `skipDelta` step is the dropped delta 4); clock `real`.

### S-C1-05 A table is readable at arm's length
Given a fake-agent reply holding a 4-column table (`run`, `builder`, `state`, `time`) with 3 rows,
the `time` column `1 h 12`, `0 h 48`, `2 h 05`,
When it has streamed in,
Then the header cells are 16 px caps, the body cells mono 18 px, every row 44 px tall, the `time`
column right-aligned, the other columns left-aligned; a second reply with a 9-column table scrolls
sideways inside its block, its first column stays put while the others move, and the pane itself
does not scroll sideways.
Test: Playwright; `getComputedStyle` font sizes and `text-align`; row rects; scroll the table
element by 200 px and compare the first and second columns' x.
The tables are under `[data-reply]`. Runs on: the room under test and the fake agent, script `c1-render` (its 4-column and 9-column tables); clock `real`.

### S-C1-06 Tool calls fold into one line each, with live counts
Given a fake-agent turn that calls `mcp__laneboard__fleet` with `site` `hv1`, `hv2`, `hv3` (each
400 ms, one after the other), then `mcp__laneboard__ci` with `branch` `main` (300 ms), then sends
text,
When it plays,
Then the reply shows exactly two tool lines above the text: first `● read the feed of hv1…`, which
becomes `● read 2 feeds…` and `● read 3 feeds…` as the calls start, and `read 3 feeds` with no `●`
when the third ends; then `looked at CI on main`; `data-turn` is `working` while a call runs.
Test: Playwright; sample the tool lines' text and `data-turn` every 100 ms against the script;
count `[data-tool-line]` elements: 2.
The call times are the `tool.start` and `tool.end` frames (`framereceived`). Runs on: the room under test and the fake agent, script `c1-render` (three `fleet` calls of 400 ms, then `ci` 300 ms); clock `real`.

### S-C1-07 A tool line opens to show its calls; a failure stays grey
Given S-C1-06's turn, with the `hv2` call ending failed,
When it has ended,
Then the first line reads `read 3 feeds · 1 failed` in `--text-2`, with no `--p1` or `--p2`
colour; a tap on it shows 3 rows starting `fleet  {"site":"hv1"}`, `fleet  {"site":"hv2"}`, … with
their ms and `ok` / `failed`; a second tap hides them; the row is ≥ 48 px tall and its `+`/`−`
is 20 px `--text-2`.
Test: Playwright; assert text and computed colour; tap; count child rows; tap again; the row's
`getBoundingClientRect().height` ≥ 48, the glyph's computed `font-size` `20px` and colour equal to
a probe styled `color: var(--text-2)`.
The line is `[data-tool-line]` and its rows are its children. Runs on: the room under test and the fake agent, script `c1-render` (S-C1-06's turn, `hv2` `isError`); clock `real`.

### S-C1-08 A long code block shows 12 lines and a button for the rest
Given a fake-agent reply with a fenced `sh` block of 40 lines, one of them 200 characters long,
Then the block shows 12 lines, `SH` top right, and `SHOW ALL 40 LINES` (48 px tall) under it; no
line wraps and the block scrolls sideways; a tap shows 40 lines and `SHOW LESS`.
Test: Playwright; count visible line boxes; compare the block's `scrollWidth` with its
`clientWidth`; tap; count again.
The block is the `pre` under `[data-reply]`. Runs on: the room under test and the fake agent, script `c1-render` (its 40-line `sh` block); clock `real`.

### S-C1-09 Markup from the agent is shown, never run or fetched
Given a fake-agent reply containing `<img src=x onerror=alert(1)>`, `<script>alert(2)</script>`,
`![chart](https://example.invalid/c.png)` and `[the run](https://example.invalid/run/7)`,
Then the first two show as their literal text; the image shows `[image: chart]`; the link shows
`the run (example.invalid)` with no underline, and a tap on it changes neither `location` nor opens
a page and draws no pressed state; a long press on it (touch down, 800 ms, up) opens no page and
changes no `location` either; the conversation holds no `<a>` element and no `[href]`.
Test: Playwright with `hasTouch: true`, `page.on('dialog')` failing the test, `page.on('request')`
recording hosts, and `context.on('page')` failing on a new page; assert the texts, the link's
computed `text-decoration-line` `none`; tap it, then via a CDP session `Input.dispatchTouchEvent`
`touchStart` on its centre, wait 800 ms, `touchEnd`; assert `location.href` unchanged,
`[data-link]` never got `data-pressed`, and
`document.querySelectorAll('[data-cockpit-conversation] a, [data-cockpit-conversation] [href]').length === 0`.
Runs on: the room under test and the fake agent, script `c1-render` (its markup reply); clock `real`.

### S-C1-10 Scrolled up during a reply: the view stays, `↓ NEW` brings it back
Given a pane with 10 earlier turns and the fake agent streaming a 30-line reply over 6 s,
When the owner drags the conversation down by 600 px at t = 1 s (scrolling up),
Then from then on the conversation's `scrollTop` does not change while text arrives; `↓ NEW`
shows 16 px above the input row; a tap on it at t = 4 s puts the last line in sight and the
following text keeps it there; `↓ NEW` is gone.
Test: Playwright touch drag; sample `scrollTop` every 100 ms; tap `↓ NEW`; assert the last line's
rect is inside the conversation's rect until the turn ends.
The scroller is `[data-cockpit-conversation]`'s conversation, `↓ NEW` is `[data-cockpit-follow]`. Runs on: the room under test and the fake agent, script `c1-render` (its 30 lines over 6 s), 10 seeded turns; clock `real`.

### S-C1-11 Only the marks are coloured
Given a fake-agent reply `■ builder-b is down. ▲ nightly-ci is stuck. ● 2 runs working.`,
Then `■` is drawn in `--p1`, `▲` in `--p2`, `●` in `--text-2`, and every other character in
`--text-1`; the word `down` is not red.
Test: Playwright; each mark is its own element (`[data-mark]`); read the computed `color` of the
three marks and of the paragraph, compare with the tokens' computed values.
Runs on: the room under test and the fake agent, script `c1-render` (its marks); clock `real`.

### S-C1-12 Reduced motion: the pane appears with no slide
Given `prefers-reduced-motion: reduce`,
When the owner opens and closes the pane,
Then the pane is in its final place in the first frame after each tap (computed
`transition-duration` 0 s) and the `↓ NEW` jump and the tool-line opening have no transition.
Test: Playwright `emulateMedia({ reducedMotion: 'reduce' })`; read the pane rect in the next
`requestAnimationFrame` after the tap.
Reads the computed `transition-duration` of `[data-cockpit-conversation]`, `[data-cockpit-follow]` and `[data-tool-line]`'s rows. Runs on: the room under test and the fake agent, script `c1-render` (S-C1-06's turn for the tool line); clock `real`.

### S-C1-13 Hold the button on the touring Wall: words in 1 s, release sends (pending Q-O11)
Given a screen in `wall` layout touring, the pane closed, the conversation idle; the fake speech
service scripted to send the partials `how` at 0.6 s, `how did the` at 1.2 s and `how did the
night go` at 1.8 s after the first audio frame, and the final `How did the night go?` 0.15 s after
the stop; the fake agent scripted to send its first delta 0.3 s after the prompt,
When the owner presses the bottom-right 64x64 button (centre (1312, 856)) at t = 0 and holds it,
then releases it at t = 2.5 s,
Then by t = 0.2 s the button shows its listening state (`data-talk="listening"`, T6), the screen
is sending audio frames, `data-wall-state="explore"` with the tour stopped, and the pane is opening
with the live words in its input (B1, B7); `how` is drawn in the input by t = 1.0 s (B2) and is
replaced in place by `how did the` and `how did the night go`, never appended twice; no prompt is
sent while the button is held;
And by t = 2.8 s the conversation shows `YOU · SPOKEN · HH:MM` over `How did the night go?`, the
input is empty, `data-talk` is back to idle and `data-turn="thinking"` (B3); the first reply text
is drawn ≤ 0.5 s after the fake agent's first delta (B4).
With Q-O11 b) the press opens the pane only; this scenario then starts with a press on the talk
button inside the open pane and the same timings hold from that press.
Test: Playwright with `hasTouch: true`, Chromium started with `--use-fake-device-for-media-stream`
and `--use-fake-ui-for-media-stream`; `touchscreen` down at t = 0 and up at 2.5 s (via CDP
`Input.dispatchTouchEvent`); read the marks `cockpit:B1`…`cockpit:B4` and `cockpit:B7`
(`performance.getEntriesByName`) and assert each against its row; sample the input's value every
50 ms and assert the sequence `how` → `how did the` → `how did the night go`; count the frames the
fake speech service received before t = 0.2 s (≥ 1).
Reads `[data-talk]`'s `data-talk`, `[data-cockpit-input]`'s value, `data-wall-state` and `data-turn` on the root; the messages `audio.start`, `stt.update`, `stt.final` and `turn.prompt` (`framereceived`/`framesent`). Runs on: the room under test, the fake agent on script `c1-voice` and the fake speech on script `c2-tap` (its utterance `how` / `how did the` / `how did the night go`, final `How did the night go?`); clock `real`.

## 7. Typing and sending

Plan C1: "Typing works everywhere (on-screen keyboard, a paired keyboard)." `spec-input.md` §4:
"Typing must always work too: many users will prefer it."

- **The input** is a `<textarea>` `[data-cockpit-input]`, x 784-1184 (§1), mono 28 px, line height
  1.4 (39.2 px), 16 px padding left and right, 12.4 px top and bottom: 368 px of text, 21 characters
  per line at 16.8 px each (pending Q-O18; 27 at 22 px). Beside the language button (`c2-voice.md`
  §8, shown by default) the input is x 864-1184: 288 px of text, 17 characters per line (21 at
  22 px). Placeholder `Type or talk` (12 characters, D286), one line at either width,
  in `--text-3` (pending Q-O11); without a speech service it is `Type a message` (D49). `enterkeyhint="send"`, `autocapitalize="sentences"`,
  `spellcheck` on.
- **It grows** with its text: 64 px for one line, +39.2 px per line up to 4 lines (182 px, 181.6
  rounded; tests allow ± 1 px); beyond 4 lines it scrolls inside. At 21 characters a line, 4 lines
  show about 84 characters (68 at 17 beside the language button): a spoken sentence of 10-15 words. It grows upwards; the input row grows with it and the conversation
  above gets shorter; `SEND` and the talk button stay at the row's bottom (D30).
- **`SEND`** `[data-cockpit-send]`, 64x64 px, 16 px caps. Disabled (`disabled`, label `--text-3`)
  while the input holds only white space and while the room is down (`screens.md` §7). During a
  turn its job changes (§8).
- **Keys** (D30): `Enter` sends, on a paired keyboard and on the on-screen keyboard alike (the
  terminal's habit); `Shift+Enter` makes a new line. `Esc` closes the pane (§2), the draft stays.
- **Length.** A prompt is at most 8 000 characters. Above that, a note in the line slot's
  type (18 px caps `--text-1`, §1.1, D167) shows there (`data-line="length"`, the lowest of its four): `8 214 / 8 000
  CHARACTERS`, and `SEND` is disabled. Pasting is never cut short by the screen (D30).
- **What is sent**: the text with white space trimmed at both ends; inside, unchanged.
- **Rate** (D228). The room takes at most 10 prompts per device token in any 60 s, on its own
  clock (`server/cockpit/clock.mjs`): typed or spoken, sent idle or queued during a turn, `RETRY`
  and `GO ON` alike, every page and tab holding that screen's token counted together. A resend with
  a `clientId` the room already has (§10 E1's `RETRY`, `protocols.md` §3.1) starts nothing and is
  not counted; nor is a refused prompt. The 11th is refused (`prompt.refused` `too-many`,
  `protocols.md` §3.1, §8): the block, already drawn at the tap, reads `YOU · 07:02 · NOT SENT` and
  under it, as E1's look: `Too many messages from this screen; wait a minute.` with `RETRY` and
  `EDIT` (row E9 of §10: `RETRY` waits 60 s, D264). Nothing reaches the agent; the room's audit log keeps the refusal
  (D165). The owner's own pace (a prompt every few seconds at most) never comes near it: it stops
  a screen in a loop or a stolen token.

**On send** (B8, ≤ 0.1 s): the prompt block is drawn at the end of the conversation with the label
`YOU · 07:02 · SENDING` (the `SENDING` in `--text-3`), the input is emptied, the conversation is
pinned to its end (§4), `data-turn="thinking"`. Keyboard focus stays where it was (an on-screen
keyboard stays up). When the room confirms it has the prompt (the `turn.prompt` echo, `protocols.md` §3.1), `· SENDING` goes. No
confirmation within 5 s while the room link is up: §10, E1 (D31).

### 7.1 With the on-screen keyboard (T40, T94)

Plan C1: "Typing works everywhere (on-screen keyboard, a paired keyboard)." On a 912 px tall
landscape screen an on-screen keyboard takes about the bottom 380 px: exactly where the input row,
the chip row and `SEND` sit (review 31-touch.md finding 1). This section says what moves. The
numbers are for a 380 px keyboard, which leaves 1368x532 in sight.

**How the page knows** (D130; which signal the owner's tablet gives is research Q11):
- The viewport meta keeps the browser default `interactive-widget=resizes-visual`, written out: the
  keyboard shrinks only the visual viewport, so the view behind the pane (Wall, Map) never re-lays
  out or refits its camera when the keyboard comes and goes.
- Where `navigator.virtualKeyboard` exists the page sets `overlaysContent = true` and listens to its
  `geometrychange` event.
- **Visible bottom** = `min(innerHeight, visualViewport.offsetTop + visualViewport.height)` minus
  `navigator.virtualKeyboard.boundingRect.height` (0 where the API is absent). **Keyboard height**
  = H minus the visible bottom, where H is the largest `innerHeight` seen at the current width since
  the load (a width change resets it). Both are recomputed on `visualViewport` `resize` and
  `scroll`, `geometrychange` and window `resize`, at most once per animation frame.
- The root carries `data-keyboard="up"` while the keyboard height is ≥ 120 px and
  `[data-cockpit-input]` has the focus, `data-keyboard="held"` during a talk press that started
  while it was `up` (below), else `data-keyboard="down"`. A desktop window made shorter with the
  input focused counts as `up`; the layout below fits it as well.

**While `data-keyboard` is `up` or `held`** (D131), on every page and layout, pane or column:
- `[data-cockpit-conversation]` covers x 760-1368 from the visible top (`visualViewport.offsetTop`)
  to the visible bottom: y 0-532 at 1368x532. On the app it covers the 36 px header and the 24 px
  tape too; in `split` it covers the card area above the column. Both come back when the keyboard
  goes. The width is §1's (`min(608px, 100vw)`).
- The **header** (64 px, y 0-64) keeps `CLOSE`, `SCREEN`, `NEW` (and in `switch` the switch button
  `WALL`) at §1's x, y 8-56 (`screens.md` §4.1 states H and I).
- The **input row** sits on the keyboard's top edge and is 88 px tall (16 + 64 + 8; the Wall's
  24 px bottom margin is for the screen's edge, not the keyboard's): y 444-532. Input x 784-1184,
  `SEND` x 1200-1264 and the talk button x 1280-1344, all y 460-524. The talk button stays in the
  row; it never moves to the screen's corner.
- The opener, reading `CLOSE` while the pane is open (§2), keeps x 1288-1336 with its bottom on the
  row's top edge: y 396-444. The column has no opener (D117).
- Above the row the stack is the same as without the keyboard (the line slot, the chip row,
  `↓ NEW`: §1.1), measured from the row's top edge at y 444; a chip alone is the row y 380-444.
- The **conversation** gets what is left: y 64-444 (380 px) with nothing stacked. With the 80 px
  status line, a one-line hint or note (32 px) and a chip (64 px) it is 204 px. It is never under
  200 px with a one-line input.
- The **input grows** (§7) only while the conversation keeps 200 px: its height is at most
  `clamp(64, 64 + left − 200, 182)` px, where `left` is the conversation's height with a one-line
  input. Past that the text scrolls inside the input, the caret line in sight (the textarea's own
  scrolling). At 1368x532: 182 px (4 lines) with nothing stacked; 68 px (one line) with the status
  line, a note and a chip.
- **Pinned.** A conversation that followed its end (§4) is at its end after every change of the
  visible height, the latest line in sight. If the owner had scrolled up, the line at its top stays
  at its top.
- **During a turn, in sight** (T125, review 81-touch.md finding 4). The last item is then often a
  `· QUEUED` block (§8). At the conversation's end its whole block, label row and
  `[data-turn-delivery]` included, lies inside the conversation and ends at y ≤ 380 (§1.1's
  y 744, D267, moved up 364 px), clear of the opener at y 396-444. The `SEND` slot stays in the
  row at x 1200-1264, y 460-524 through `wait`, `STOP` and `SEND` (§8, D268), never under the
  keyboard. Sketch: `sketches/c2-states.html#turn`.
- Each change applies in the first animation frame after the event, with no slide (the 120 ms slide
  of §2 is for open and close only).

**Taps keep the keyboard up** (D132). A tap on any control inside `[data-cockpit-conversation]`
(`SEND`, the chip's `✕`, `NEW`, `SCREEN`, a tool line, `↓ NEW`, `RETRY`, `EDIT`) leaves the focus in the
input (the build calls `preventDefault()` on the control's `pointerdown` and `mousedown`), so the
keyboard does not drop and the row does not move between `pointerdown` and `pointerup`. After a send
the keyboard stays up (§7). `CLOSE` closes the pane and blurs the input.

**Putting it away.**
- A tap on the conversation outside a control (`pointerup` within 8 px, `TAP_SLOP_TOUCH` of
  `public/js/views/map/interact.js`, of its `pointerdown`) blurs the input; the keyboard goes. A
  drag that scrolls the conversation does not blur it. A tap on the header outside its buttons
  blurs it too. A tap on the view behind the pane blurs it by the browser's own focus move, and the
  view acts on the tap as well (D19).
- The keyboard's own hide key: `data-keyboard` follows the height, the input may keep its focus.
- When `data-keyboard` turns `down`, §1's rects return in the first frame; the draft stays; the
  conversation follows the pin rule above.

**A talk press with the keyboard up** (C2). The press replaces the textarea with the live words
(`c2-voice.md` §4, D43), the textarea loses its focus and the keyboard goes. From the
`pointerdown` the layout stays as it was (`data-keyboard="held"`) until the microphone closes, so
the talk button does not move under the finger; the band below the row is plain `--bg-elevated`.
When the microphone closes, `data-keyboard` follows the keyboard again. After a tap on the words
(`c2-voice.md` §7, D47) the textarea has the focus, the keyboard comes back and the row sits on its
edge with the caret line in sight (S-C2-22).

## 8. Talking while the agent answers (pending Q-O1)

Written for Q-O1's recommendation d), **steer**: words sent during a turn go into that turn, as
they do in the owner's terminal (research Q8); nothing already said is thrown away. `STOP` is the
one way to end a turn. The wire is `protocols.md` §3.1 (`delivery:"queued"`), §3.4 and §11.6.

- **One slot, two jobs** (D32). While `data-turn` is `thinking`, `working` or `answering`:
  with an empty input the `SEND` slot reads `STOP` (`data-send="stop"`); with text in the input it
  reads `SEND` (`data-send="send"`). While idle it is always `SEND`. While the microphone is open the
  slot is blank and inert (`data-send="none"`, `c2-voice.md` §3, D42): `STOP` comes back when it closes. No hint line explains the
  send (D121): the `· QUEUED` label below says what happened, 0.5 s after the tap.
- **`STOP` never appears under a sending finger** (D268, pending Q-O1 s1). The slot reads `STOP`
  no earlier than 1.0 s after the latest send (a tap on `SEND`, `Enter`, the talk button's
  tap-to-send or release, a `RETRY`, `GO ON`) and the latest close of the microphone (send,
  `CANCEL`, slide off, a limit of `c2-voice.md` §4). Until then, where it would read `STOP`:
  after a typed send it keeps `SEND` in `--text-3` with `inert` and `aria-disabled="true"`
  (`data-send="wait"`); after the microphone closes it stays blank and inert (`data-send="none"`).
  A tap on it in that time does nothing: no interrupt, no prompt, no pressed state. Text typed
  into the input during the second makes it `SEND` at once (a send is never the harmful tap); the
  input emptied again within the second brings back `wait` for what is left of it. The 1.0 s runs
  on the page's clock from the send's `pointerup` or key event (or the microphone's close), the
  same frame as B8's block.
- **How `STOP` looks and acts** (D268). A `■` glyph, 24 px `--text-1`, 4 px gap, `STOP` 16 px caps
  `--text-1`, centred in the 64x64 slot (the talk button's own layout, `c2-voice.md` §1); the
  glyph is a control, not a reply mark, so it is never `--p1` (D25). Accessible name `Stop`. It
  acts on `pointerup` only, and only when the same pointer's `pointerdown` also landed on the slot
  while it read `STOP` and the `pointerup` is within 8 px of it (`TAP_SLOP_TOUCH`, §7.1); a press
  that began in the 1.0 s (on `wait` or blank) and lifts after it stops nothing. A keyboard
  activation of the focused button (`click` with `detail` 0) and `Ctrl+C` with the input empty
  act at once: a key is not a bouncing finger.
- **`SEND` during a turn** (D122). The prompt block is drawn at once at the end of the
  conversation (B8), label `YOU · 07:03 · SENDING`. The room sends it to the agent with
  `priority:"next"` and a UUID (`protocols.md` §11.3) and echoes `turn.prompt` with
  `delivery:"queued"`; the label then reads `YOU · 07:03 · QUEUED` (`QUEUED` 18 px `--text-1`, §3
  "The delivery word", D270) and the prompt's text is drawn in `--text-2` instead of `--text-1`. The block stays the last item of the
  conversation while queued: text the agent writes before taking it is drawn above it.
- **Taken.** When the agent reads it (`prompt.taken` `taken`: after the tool calls it is running
  end, research Q8), within 0.1 s `· QUEUED` goes, the text turns `--text-1`, and the block takes
  its place in the turn at `atBlock` (`protocols.md` §3.4): the turn's items from `atBlock` on are
  drawn below it. The turn goes on; the header keeps `● WORKING` (D56); no
  `STOPPED` line, no new `AGENT · HH:MM` label row (the reply goes on under the same turn).
- **The turn ends first.** A prompt still queued when its turn ends stays `· QUEUED`; the agent
  takes it as the next turn (research Q8). The room first sends `turn.prompt` for that new turn
  with the block's own `clientId`, `delivery:"new"` and `"from":"queued"`, then `prompt.taken`
  (`protocols.md` §3.4 "Taken as the next turn", D258). The pane draws no second block: it moves
  the existing one to the start of the new turn, keeps its label time (the send, `07:03`), and on
  the `prompt.taken` ≤ 0.1 s later `· QUEUED` goes and the text turns `--text-1`. The `AGENT · HH:MM`
  label row comes as a new turn's (§9: its first item or 3 s). No 4000 `gap` close (D119) happens.
- **Not taken** (D123). If a prompt is still not taken 10 s after its turn's `turn.end`, and no
  interrupt receipt listed it, the room sends it to the agent once more as a new prompt (a new
  UUID, room-internal: no message to the screens, one log line). If that is not taken within 10 s
  either, the room sends `prompt.taken` `cancelled` with `"why":"not-taken"`: the label reads
  `YOU · 07:03 · NOT SENT` and under the block, as E1's look (§10): `The agent did not read this.`
  with `RETRY` and `EDIT`. `RETRY` sends it with a new `clientId` (§10, D259).
- **`STOP`** (or `Ctrl+C` on a paired keyboard with the input empty): `data-turn="stopping"` within
  0.1 s of the `pointerup`; the room asks the bridge to interrupt with `cancelQueued` (`protocols.md` §11.6). The turn
  ends when the bridge reports its end; if that has not happened 5 s after the tap, the room forces
  it (for Claude Code: `SIGINT`, research Q2) and the stopped line reads `STOPPED AT 07:03 (FORCED)`
  (D262).
  Either way `READY` by 5.5 s. Every sent prompt and every `STOP` is one line in the room's
  audit log, without the words (`cockpit.prompt`, `cockpit.stop`, `screens.md` §6.4).
- **Queued prompts at a `STOP`.** Each prompt the receipt lists as cancelled gets
  `prompt.taken` `cancelled` (`"why":"stopped"`): label `YOU · 07:03 · NOT SENT`, under it
  `Dropped by STOP.` with `RETRY` and `EDIT`, as above. An agent without `cancelQueued`
  (`ready.canCancelQueued:false`) keeps them: they stay `· QUEUED` and start the next turn.
- **"Stop, do this instead"** is `STOP`, then the new words: with a draft in the input the slot
  reads `SEND`, so the owner sends first and taps `STOP` after; the new prompt is then dropped with
  the turn and `RETRY` sends it again (two taps more, D32's overrule names the other way).
- **What a stopped turn looks like** (D33): its text stays exactly as it was at the tap; nothing
  that turn sends later is drawn (the room's log keeps it). Under it, 16 px caps
  `--text-3` with the cockpit's rule (§3, D227), `[data-turn-stopped]`: `STOPPED AT 07:03`, or
  `STOPPED AT 07:03 (FORCED)` when `turn.end` has `forced:true`. The DOM holds exactly that string,
  in capitals as written; computed `text-transform` is `none` (D262). A tool line still running loses its `●` and ends in ` · stopped`.
  The `▍` cursor goes.
- **Voice** (C2): pressing the talk button during a turn stops nothing; listening starts (D29);
  the send at release is a `SEND` during a turn as above (`c2-voice.md` §2).
- **An agent that cannot steer** (`ready.canSteer:false`, a bridge agent, `protocols.md` §11.3):
  the same screen; the room holds the prompt until the turn ends and sends it then, so it is taken
  as the next turn.
- A turn the agent started itself (speaking up, `coworker.md`) is steered and stopped the same way.
- **Across a reload** (D124). The room keeps every prompt sent during a turn as a `prompt` item of
  that turn (`protocols.md` §2.2), so a reloaded page, or a second screen that opens later, draws
  it exactly as above: still `· QUEUED` and last, taken and in its place, or `NOT SENT` with its
  line and `RETRY`/`EDIT`. Later `prompt.taken` messages apply to it as to a block the page drew
  itself. A block still `· SENDING` at the reload (the room had not echoed it) is gone after the
  reload: if the room got it, the snapshot holds it; if not, it was never sent, and the reloaded
  input is empty (the draft went into the block at the tap).

## 9. Long replies and long turns

The screen never shortens what the agent wrote (§5) and draws a long reply whole; the owner flicks
through it (D35). Only code blocks fold (§3) and only old turns (`SHOW EARLIER`, §3).

- **Elapsed time** (D35, D235). Once a turn has run 3 s, the reply's label row shows its age:
  `AGENT · 07:02 · 0:03`, counting each second (`m:ss`, from 1 h `h:mm:ss`), until the turn ends;
  then the label keeps the total: `AGENT · 07:02 · 1:48`. Turns under 3 s show no age. The age is
  its own element `[data-turn-age]` (text `0:03`, without the ` · ` before it) in `--text-2`, the
  rest of the row stays `--text-3`: it is the one moving thing that says the agent is alive
  (`reviews/44-operator.md` finding 8).
  - **Before the first item.** The label row comes with the turn's first item (§5.1), or at 3 s
    if nothing came by then: a turn that thinks 20 s shows `AGENT · 07:02 · 0:03` under the
    prompt from 3 s on, with nothing under the row, and the first item is drawn under that row
    when it comes. So a slow answer moves within 3 s of the send, on every screen.
  - **Not in the header.** The header keeps `● WORKING` with no age (D56): at 18 px caps in the
    fallback face (DejaVu Sans, the worst case: it shows until the vendored condensed face has loaded, `screens.md` §4, D273)
    `● WORKING · 59:59` is 198 px and the header has 188 px between the turn state's start
    (x 876) and `NEW` (x 1072) less 8 px on the Wall page (`screens.md` §4.1 D), and less in a
    column with `SHELF n` and `WALL` (E).
  - **Where the age counts from.** The turn's start is the `turn.prompt` `at` (`delivery:"new"`,
    room clock) moved onto the screen's clock by the offset `welcome.now` gave (the page's
    `Date.now()` at the `welcome` minus `welcome.now`, `protocols.md` §2.2), so a page reloaded
    mid-turn shows the same age as the others, within 1 s. A speak-up's turn (`coworker.md` §3.2)
    counts from its own `turn.prompt` the same way. It is redrawn every 1 s with the screen's
    other counters (`README.md` "Times on the screen").
- **A long silence is not an error.** As long as the room's heartbeat (every 10 s, D10) says the
  agent is alive, a turn may think or work for any time; the label's age shows it. The owner ends
  it with `STOP`. A lost room link is `screens.md` §7.

## 10. Errors

Every error is a **grey line in the turn** where it happened, never a dialog, never red: it is news
about the agent, not trouble in the fleet (`docs/design.md`, the colour rule; as tool failures, §5).
Look: 18 px mono `--text-1` on `--bg-sunken`, 1 px `--line-strong` border with the left side 2 px
(the cockpit's rule, §3, D227), 12 px / 16 px padding;
buttons under the text, 48 px tall, ≥ 96 px wide, 16 px caps, 8 px apart. The element is
`[data-turn-error="<code>"]`. Text from the room or the agent inside a message (`{detail}`) is cut
to 120 characters and drawn as text. After an error the header reads `READY` (D34).

| Code | When | Message (exact) | Buttons |
| --- | --- | --- | --- |
| E1 `not-sent` | the room has not confirmed a prompt 5 s after send, link up | label `YOU · 07:02 · NOT SENT`; `Not sent: the room did not confirm within 5 s.` | `RETRY` sends the same text again with the **same** `clientId` (the one exception, below); `EDIT` removes the block, puts the text back in the input (an existing draft is kept after it, on a new line) and focuses the input with the caret after the restored text, on every pointer type (D271, below) |
| E2 `agent-exited` | the agent's process ended during a turn | `The agent stopped unexpectedly at 07:04. The room is starting it again.`, then, once back: `The agent is back (07:04). Your last message was not answered.` | `RETRY` (only once the agent is back) sends that turn's prompt again, with a new `clientId` |
| E3 `agent-down` | the agent cannot start | `The agent cannot start: {detail}. The room tries again every 30 s.` plus the status line (§1) `Agent not running since 07:04 (2 min).`; `SEND` and talk disabled, the draft kept. The 30 s is the restart series' last step (0, 2, 4, 8, 16, 30 s, then every 30 s, `protocols.md` §11.7); a refused start (`protocols.md` §11.11, no restart) shows `The agent cannot start: {detail}.` alone (D289) | none |
| E4 `not-logged-in` | the agent reports missing login or key | `The agent is not logged in on the room. Log it in there, then send again.` plus the status line (§10.1) | none |
| E5 `model-busy` | the model service is retried by the agent | not an error line: a tool-line-style row in `--text-3`, `the model service is busy, retrying (2 of 10)`, replaced on each retry, gone when text arrives | none |
| E6 | retired (T50): a model-service error is E8, its `{detail}` the service's own message (D57) | | |
| E7 `step-limit` | the turn ends because the agent's step limit is reached | `Stopped after {n} steps, the agent's limit.` | `GO ON` sends `Go on.` as a new prompt |
| E8 `failed` | any other error end of a turn, the model service's included | `The answer failed: {detail}.` | `RETRY` |
| E9 `too-many` | the room refused the prompt: the 11th from this device token in 60 s (`prompt.refused` `too-many`, §7 "Rate", D228) | label `YOU · 07:02 · NOT SENT`; `Too many messages from this screen; wait a minute.` | `RETRY` is disabled (`disabled`, `--text-3` on `--line`) for 60 s from the moment this screen drew the refusal, on the screen's clock, then enabled; a tap on it while disabled sends nothing; once enabled it sends the same text with a new `clientId`. `EDIT` as E1, enabled at once (D264) |

- **Nothing is ever sent again on its own** (D34, as D12): `RETRY`, `EDIT` and `GO ON` act only on a
  tap. A `RETRY` is a new turn with the same text; the failed turn stays above it.
- **Which `clientId` a button sends** (D259, one rule for the pane). Only E1's `RETRY` reuses the
  block's `clientId`: the room may hold that prompt already, and D95 makes the resend start nothing
  but the echo. Every other button that sends makes a new `clientId` (`crypto.randomUUID()`): E2's
  `RETRY`, E7's `GO ON`, E8's `RETRY`, E9's `RETRY` (T116) and the `RETRY` under both `NOT SENT`
  lines of §8 (`The agent did not read this.`, `Dropped by STOP.`). The room knows those
  `clientId`s, so reusing one would bring back only the old echo and the retry would silently do
  nothing.
- **`EDIT` brings the keyboard** (D271, an exception to D20 as D47 and D181 are). Every `EDIT`
  (E1, E9, and the two `NOT SENT` lines of §8) does this in its own `click` handler, in the same
  task as the tap, so the browser counts it as the owner's gesture: the block goes, the input's
  value becomes the restored text (plus `\n` and the draft, if there was one), then
  `input.focus({preventScroll: true})` and `setSelectionRange(n, n)` with n the restored text's
  length; the input grows to its lines (§7) and is scrolled so the caret line is in sight. On a
  touch screen the on-screen keyboard comes up and §7.1's layout applies (`data-keyboard="up"`
  once the keyboard is ≥ 120 px); with the keyboard already up the focus never leaves the input
  (D132). The conversation stays pinned to its end (§7.1 "Pinned"). While the microphone is open
  (`data-talk` not `idle`, `c2-voice.md` §3) every `EDIT` is inert (`aria-disabled="true"`, label
  `--text-3`): the textarea is replaced by the live words then (D43); it acts again in the frame
  the microphone closes.
- Which native event of the agent maps to which code is `protocols.md` §11.4's mapping table; Claude Code's
  `api_retry` is E5 and a `result` with `is_error` is E7 or E8 (research Q2).
- An error line is shown on every screen (§12); its buttons work from any of them.

### 10.1 The status line: the agent's login, and which line wins (T68, D151, D152)

The pane's status line (§1 item 2) is **one slot**: 80 px under the header, 18 px `--text-2` on
`--bg-sunken`, at most two lines, the element `[data-cockpit-status]` with `data-status` the code
below (absent when nothing shows). It tells what holds **before** the owner sends anything: a page
that loads or reconnects draws it from `welcome.status` (`protocols.md` §3.5) in its first frame.

**The agent's login.** The room checks it when it starts and every 15 min (900 s), and every 60 s
while the agent is found logged out (`protocols.md` §11.10). A logged-out agent shows, with no
prompt sent: `The agent is not logged in on the room since 03:15 (4 h 15). Log it in there.` The time is
when the room first found it; time and age as `README.md` §"Times on the screen" (`since yesterday 22:10 (9 h 20)`, D232).
The line goes at the first check that finds the login back (at most 60 s after the owner logs in
on the room), or when a turn ends `done`. `SEND` and talk stay enabled while it shows (D151): the
check is a guess about the agent and the agent's own answer is the truth; a prompt that fails
anyway gets E4 in its turn. Only when the agent cannot even start for want of a login (no session
is up, `status.blocksSend`) are `SEND` and talk disabled, as with E3, the draft kept.

**Which line wins** (D152). Highest first; the slot shows the highest that holds:

| # | `data-status` | Set by | Text (exact) | Lasts |
| --- | --- | --- | --- | --- |
| 1 | `offline` | the screen (`navigator.onLine` false) | `This screen is offline since 06:41 (3 min). Check its network.` | while offline (`screens.md` §7) |
| 2 | `room-down` | the screen (its room link) | `Cockpit room unreachable since 06:41 (3 min). Retrying in 12 s.` + `RETRY NOW` | while down (`screens.md` §7) |
| 3 | `agent-down` | the room | `Agent not running since 07:04 (2 min).` | while the agent cannot start (E3) |
| 4 | `not-logged-in` | the room | `The agent is not logged in on the room since 03:15 (4 h 15). Log it in there.` | as above |
| 5 | `tools-down` | the room | `The agent cannot read the board: its laneboard tools did not start.` | while `ready.mcp` says so (`c3-see.md` §1) |
| 6 | `board-down` | the room | `Board unreachable since 06:41 (3 min): the agent cannot read the fleet.` | from the second failed board check to the first answer (`c3-see.md` §2, D229) |
| 7 | `agent-back` | the room | `The agent is back (07:04). Your last message was not answered.` | 5 s (E2) |
| 8 | `back` | the screen | `Back since 06:47.` | 5 s (`screens.md` §7) |

- Rows 3-7 are the room's: it holds every condition that applies and sends only the highest as
  `status` (`protocols.md` §3.5), and the next one still holding when that one clears. Rows 1, 2
  and 8 are the screen's own; while row 1 or 2 shows, the room's last `status` is kept and shown
  again the moment the link is back.
- Rows 7 and 8 are news, not a state: they never wait. Outranked when they start or while they
  show, they are dropped, not shown later. So a reconnect whose `welcome.status` is not `null`
  shows that line at once and no `Back since`.
- The `NEW` bar (§11) gives way to every row, as before.
- Every time in this table and in §10's error lines follows `README.md` §"Times on the screen" (T65, D232): rows 1-6 hold a
  condition and read `since {clock} ({age})`, redrawn every 1 s (`since yesterday 22:10 (9 h 20)`);
  rows 7-8 and E2 are events and carry the clock only (`The agent stopped unexpectedly yesterday at
  23:58.`, `The agent is back (yesterday 23:58).`). The examples above are the same-day forms.
- On the room, the room's log holds one line per change of the slot's code (`status
  not-logged-in since 03:15`), and the check's own result once per change (`protocols.md` §11.10).

## 11. A new conversation (pending Q-O2)

Written for Q-O2's recommendation d) (T51, `reviews/36-skeptic.md` finding 4): **a `NEW` button
only**, plus a forced fresh start when the session cannot go on, and **no handover note**. Plan C1:
"a 'new conversation' button; on a fresh start the agent reads the same written context a laptop
session would."

- **Ask first** (D36). A tap on `NEW` shows the bar `[data-cockpit-newbar]` in the status line's
  slot (§1 item 2): **80 px** tall like the status line (D54, D134), right under the header,
  `--bg-sunken`. Left, from x 784 and ending 16 px before `START`: 18 px `--text-1`
  `Start a new conversation? Cards, jobs and notes stay.` (two lines, line height 1.35). Right, 16 px
  from the pane's right edge and vertically centred (16 px above and below): **`KEEP`** at the right
  end, **`START`** 16 px left of it, each 48 px tall and 96 px wide, 16 px caps `--text-1`, 1 px
  `--line-strong` border, `--bg-elevated` fill (`data-newbar="keep"`, `data-newbar="start"`; pressed
  state: `README.md` §"Touch", D224). `START`, the one-way action,
  is the farther from the corner where the hand rests on `CLOSE` and the talk button.
  `KEEP`, a second tap on `NEW`, or 10 s without a tap hide the bar and nothing changes. A status
  line (room down) wins the slot: `NEW` is disabled then, and a bar that shows when the room goes
  down is hidden as if `KEEP` was tapped.

  | Where | Bar | Text | `START` | `KEEP` |
  | --- | --- | --- | --- | --- |
  | Wall page, pane (header y 0-64) | x 760-1368, y 64-144 | x 784-1128 | x 1144-1240, y 80-128 | x 1256-1352, y 80-128 |
  | App, pane (header y 36-100) | x 760-1368, y 100-180 | x 784-1128 | x 1144-1240, y 116-164 | x 1256-1352, y 116-164 |
  | Column (`split`, `canvas`, `switch`) | the 80 px under the column's header | same x | same x, 16 px below the bar's top | same x, 16 px below the bar's top |

  The conversation starts under the bar while it shows (it pushes the conversation down by 80 px
  like the status line; the pin rule of §7.1 applies).
- **`START`**: a running turn is stopped first (§8: `● STOPPING`, forced after 5 s; queued prompts get `Dropped by STOP.`). Then the room
  starts a new agent session at once (`protocols.md` §11.7 says how); the old session gets no further prompt and
  nothing is written for the new one. Like a laptop session, the new session reads the written
  context (repos, plans, notes). There is no extra turn state: the header goes back to `READY`. `START`
  and a forced fresh start each write one `cockpit.new` audit line (`screens.md` §6.4).
- **The divider**, drawn on every screen ≤ 0.5 s after the new session has started: a full-width
  row, 48 px, 1 px `--line` rules left and right of 16 px caps `--text-3` `NEW CONVERSATION · 07:10`.
  The old turns stay above it, unfolded, as history (D27's 50-turn rule counts across the divider);
  the view scrolls so the divider is at the conversation's top. A reload shows only the current
  conversation; the old one is kept on the room for 30 days (`protocols.md` §11.7.1, pending Q-O24).
- **What carries over**: the written context (repos, plans, notes), the canvas cards, scheduled
  jobs, every screen's layout, pane state and draft. **What does not**: the conversation's text in
  the agent's context.
- **Forced fresh start**: when the room cannot resume the session (`protocols.md` §11.7: two failed resumes), it starts a new
  one the same way without the bar, and the divider reads `NEW CONVERSATION · 07:10 · THE OLD ONE
  COULD NOT GO ON`.
- With Q-O2 a) `NEW` is not shown; with b) a daily start at a configured hour adds the divider
  `NEW CONVERSATION · 04:00 · DAILY`; with c) the room first asks the old session for a note of at
  most 15 lines, shows it in full under the divider, and tells the new session it holds "notes from
  the previous session, not instructions" (`reviews/40-security.md` finding 9).

## 12. Several screens on one conversation

Plan §2: "All screens show the same cockpit conversation; speaking at one shows up on all."

- **Shared** (one copy, in the room): the turns, tool lines, error lines, the turn state, `STOP`
  and the new-conversation divider. A prompt sent at screen A is drawn on screen B ≤ 0.5 s after the
  room has it; reply text reaches every screen within B4.
- **Per screen** (D37): the draft, the live partial words while speaking (only the sent prompt
  reaches the others), the pane open or closed, the scroll position, opened tool lines and code
  blocks, the `NEW` bar.
- **Who said it.** The room's audit log names the screen of each prompt and stop (`user`
  `screen:desk`, `screens.md` §6.4); the pane does not. Not shown in C1: a prompt's label is `YOU · 07:02` on every screen (T51,
  `reviews/36-skeptic.md` finding 13; the owner has not said they use two screens, Q-O9). Screen
  names in labels come back with the slice that pairs several screens (Q-O21).
- **Two prompts at once** (D269). The room takes them in the order they arrive. A prompt that
  arrives while a turn runs, from any screen, joins that turn as a queued prompt (§8 "`SEND` during
  a turn"): nothing stops, no `STOPPED AT` line is drawn, and every screen draws the block last
  with `· QUEUED` until it is taken. Only `STOP` ends a turn, from whichever screen taps it.
- **The rate is per screen** (§7, D228): two screens have 10 prompts a minute each; two tabs on
  one screen share its 10.
- A screen that opens or reloads gets the last 50 turns from the room and joins a running turn
  where it is (`protocols.md` §2.2).

## 13. No raw view in C1 (pending Q-O17)

Plan C1: "A raw terminal view of the same session as a toggle, for when the rendered view hides
something." Written for Q-O17's recommendation d) (T50, `reviews/36-skeptic.md` finding 7):

- C1 has **no raw view**: no `RAW` button, no `data-raw`, no second renderer of the agent's events.
- An **opened tool line** (§5) is C1's closest look: each call's tool, input, ms and `ok|failed`.
- When the rendered view hides something, the owner looks from the laptop (`spec-input.md` §3:
  "The laptop keeps its own full access, as today.").
- `server/terminals.mjs` is not used by the cockpit: it bridges a **writable** pty, and a device
  token must not get a shell (plan §4: a token cannot act).
- No tool output reaches any screen in C1 (D97). If Q-O17 brings it back, showing tool output is
  a per-screen setting on the room (`laneboard cockpit screens set <screen> raw-output on`), off
  by default, never one room-wide flag (review 40 finding 15); output passes §5.3's redaction.
- With Q-O17 a) or b) the raw view comes back as a later slice: a read-only list of the bridge's
  native events, as `QUESTIONS.md` Q-O17 describes; S-C1-24 is retired and that slice gets new ids.

## 14. Scenarios, part 2

Same setup as §6: 1368x912, the demo hub, the room under test and the fake agent, a paired screen
named `desk`, the pane open in `wall` layout unless said otherwise.

### S-C1-14 Typing: Enter sends, Shift+Enter breaks the line, the input grows to 4 lines
Given the pane open, the conversation idle, the input empty,
Then `SEND` is disabled; typing three spaces leaves it disabled.
When the owner types `how is` then `Shift+Enter` then `builder-a` then `Enter` at t = 0,
Then by t = 0.1 s the conversation ends with `YOU · HH:MM · SENDING` over the two lines `how is` /
`builder-a`, the input is empty and 64 px tall, `data-turn="thinking"` (B8); when the room under test
confirms, `· SENDING` goes.
And typing 6 lines (with `Shift+Enter`) makes the input 182 px tall with its own scrollbar, its
bottom edge where it was, `SEND` still at the row's bottom.
Test: Playwright `keyboard.type`/`press`; read the prompt text, the input's height and bottom, the
`SEND` rect and `disabled`; the fake agent's log (`fakeAgent.prompts()`) has `how is\nbuilder-a`.
The input is `[data-cockpit-input]`, the slot `[data-cockpit-send]`, the word `[data-turn-delivery="sending"]`; one `prompt` frame (`framesent`). Runs on: the room under test and the fake agent, script `c1-typing`; clock `real`.

### S-C1-15 Too long a prompt cannot be sent
Given the pane open,
When 8 214 characters are pasted into the input,
Then the input holds all 8 214, the note reads `8 214 / 8 000 CHARACTERS`, `SEND` is disabled and
`Enter` sends nothing; deleting 214 characters enables `SEND` and the note goes.
Test: Playwright `fill`; assert the value length, the note's text, `disabled`, and that the room's
log is unchanged after `Enter`.
The input is `[data-cockpit-input]`, the note `[data-cockpit-line][data-line="length"]`, the slot `[data-cockpit-send]`; "the room's log unchanged" is: `framesent` holds no `prompt` and `fakeAgent.prompts()` is 0. Runs on: the room under test and the fake agent, script `c1-typing`; clock `real`.

### S-C1-16 Sending during an answer steers it: queued, then taken into the same turn (pending Q-O1)
Given the fake agent on a turn that writes `Three runs ran last night.` from t = 0.3 s, calls
`mcp__laneboard__runs` from t = 1.0 s to t = 4.0 s, then writes more text; `queued` is
`next-tool-end`; the matched steer turn writes `Only builder-a failed.` 0.3 s after it is taken,
When at t = 2 s the owner types `only the failed one` (the slot reads `SEND`, no hint line shows)
and taps `SEND`,
Then by t = 2.1 s the prompt block is drawn last with `YOU · HH:MM · SENDING`; by t = 2.5 s it
reads `YOU · HH:MM · QUEUED` with its text in `--text-2` and `[data-turn-delivery="queued"]` at a
computed font size ≥ 18 px in `--text-1` (D270); the header reads `● WORKING` throughout
and never `● STOPPING`; no `STOPPED AT` line is drawn; by t = 4.1 s `· QUEUED` is gone, the text is
`--text-1`, and `Only builder-a failed.` is drawn below the prompt block in the same turn (one
`AGENT · HH:MM` label row in the turn, above `Three runs ran last night.`); the fake agent's log
has no interrupt and one `prompt` with `"priority":"next"` read at about t = 2 s.
At t = 2.5 s, with the pane open over the Map at 1368x912 and the conversation at its end, the
queued block's bounding box ends at y ≤ 744 and does not intersect `[data-cockpit-open]` (D267).
And the second tap (D268): from t = 2.0 s to 3.0 s the slot reads `SEND` in `--text-3` with
`data-send="wait"`; a tap on it (x 1232, y 856) at t = 2.3 s sends nothing; a press there from
t = 2.9 s lifted at t = 3.1 s stops nothing; at t = 3.0 s the slot reads `■ STOP`
(`data-send="stop"`). Through t = 4.1 s the header never reads `● STOPPING`.
Test: Playwright with `hasTouch: true`, CDP touches for the taps, a fake clock; assert `data-send`
at 2.05 s, 2.95 s and 3.05 s; `prompts()` (`stand-ins.md` §2.6) is the same at 2.2 s and 4.1 s;
assert the label text at 2.1 s, 2.5 s and 4.1 s, the prompt's computed colour
against `--text-2`/`--text-1`, `[data-turn-delivery]`'s computed `font-size` (≥ 18 px) and
colour (`--text-1`) at 2.5 s and its absence at 4.1 s, the queued block's `getBoundingClientRect().bottom` ≤ 744 and no overlap
with the opener's rect, no element with the text `STOPPED AT`, the order of the turn's items, and
`order("interrupt")` from the fake-agent log is `[]` (`stand-ins.md` §2.6).
Runs on: the room under test and the fake agent, script `c1-typing` (S-C1-16's turn and its `next-tool-end` steer turn); clock `page`.

### S-C1-17 STOP stops; a stuck stop is forced after 5 s
Given a running turn and an empty input, the slot reads `STOP`,
When the owner taps `STOP` at t = 0,
Then by t = 0.1 s `data-turn="stopping"`; with the fake agent ending the turn at 0.3 s the reply
shows `STOPPED AT HH:MM` and `READY` by 0.4 s, the slot reads `SEND`.
And with the fake agent's turn set to `"onInterrupt":"ignore"` (second run), nothing ends the turn
before t = 5.0 s; at t = 5.0 s the room sends `SIGINT`, which ends the fake's turn, and the
stopped line reads `STOPPED AT HH:MM (FORCED)` and the header `READY` by t = 5.5 s. No `SIGTERM`
follows (the 8.0 s row of `protocols.md` §11.6 is the stop test of §13 there, with
`ignore-sigint`).
Test: Playwright with a fake clock; script `c1-typing` (`stand-ins.md` §5), its two S-C1-17
turns (`endAfterMs` 300, then `ignore`); assert `[data-turn-stopped]`'s `textContent` equals
`STOPPED AT HH:MM` (first run) and `STOPPED AT HH:MM (FORCED)` (second run), with `HH:MM` from the
page's clock and computed `text-transform` `none`; the fake agent's log (`stand-ins.md` §2.6) has
one `interrupt` line with `cancelled` `null`, one `signal` `SIGINT` line and no `SIGTERM` line.
Runs on: the room under test and the fake agent; first run clock `page`, second run clock `advance` from the tap (the `ignore` turn has no timed steps, `stand-ins.md` §1.1), `advance(5000)` to the forced stop.

### S-C1-18 A prompt the room never confirms is not sent again on its own
Given a touch context (`hasTouch: true`) at 1368x912, the pane open with the input not focused,
the room under test armed (`POST /drop {"what":"next-prompt"}`) to accept the socket but drop the next prompt without a
confirmation,
When the owner sends `restart the tour` at t = 0,
Then at t = 5 s the label reads `YOU · HH:MM · NOT SENT` with the message
`Not sent: the room did not confirm within 5 s.` and `RETRY`, `EDIT`; at t = 60 s nothing more has
been sent. The owner taps the conversation (the input loses the focus, D132). A tap on `EDIT`
removes the block and puts `restart the tour` in the input; in the same frame
`document.activeElement` is `[data-cockpit-input]` with `selectionStart` and `selectionEnd` 16 (the
caret after `tour`, D271). The test then resizes the viewport to 1368x532 (a 380 px keyboard):
by 0.1 s later `data-keyboard="up"` and the input is y 460-524 (§7.1). A tap on
`RETRY` (second run) sends it once, as a new turn.
A third run types `and hv1` into the input before the tap on `EDIT`: the input's value is
`restart the tour\nand hv1`, the caret at 16, the input two lines (103 px, §7) tall.
Test: Playwright with a fake clock and `hasTouch`, `tap`; the room's `POST /drop` (`stand-ins.md` §1.2);
assert texts, the input value, `document.activeElement`, `selectionStart`/`selectionEnd`, the
input's rect ± 1 px after `setViewportSize`, and the room's received-turns count (0, then 1).
The block's word is `[data-turn-delivery="not-sent"]`, its line `[data-turn-error="not-sent"]`, the root's `data-keyboard`; one `prompt` frame in `framesent`, no `turn.prompt` back. Runs on: the room under test and the fake agent, script `c1-typing`; clock `page`, the 5 s and the 60 s moved with `page.clock.runFor`.

### S-C1-19 The agent's process dies mid-turn
Given a reply half drawn,
When the fake agent exits with code 1 at 07:04,
Then within 1 s the turn shows `The agent stopped unexpectedly at 07:04. The room is starting it
again.`, `data-turn="idle"`; when the room under test has restarted the agent it changes to `The agent is
back (07:04). Your last message was not answered.` with `RETRY`; nothing is sent until `RETRY` is
tapped.
Test: Playwright; the fake agent's `exit` step; assert the two texts and the received-turns log.
The line is `[data-turn-error="agent-exited"]`, then its `RETRY`; `data-turn` on the root. Runs on: the room under test and the fake agent, script `c1-errors` (its `exit` 1 mid-text), the room's clock set to 07:04:00 with `POST /clock {"set":…}` before the prompt; clock `real`.

### S-C1-20 Each error end of a turn has its exact message, in grey
Given fake-agent scripts ending a turn with each of: a model-service error `overloaded`, the step
limit at 40 steps, an unknown error `boom`, a missing login, and two retries before text,
When each plays,
Then the turn shows, in order: `The answer failed: overloaded.` + `RETRY`;
`Stopped after 40 steps, the agent's limit.` + `GO ON`; `The answer failed: boom.` + `RETRY`;
`The agent is not logged in on the room. Log it in there, then send again.`; the row
`the model service is busy, retrying (2 of 10)` gone once text arrives. No element uses `--p1` or
`--p2`; each error is `[data-turn-error]` with its code; the header reads `READY` after each.
A `detail` of 300 characters shows its first 120.
And after the `boom` row (E8), a tap on `RETRY` raises `fakeAgent.prompts()` by exactly 1 within
1 s; the `prompt` frame it sends carries a `clientId` different from the failed turn's, and a new
turn with the same text is drawn under the failed one, which stays (D259).
Test: Playwright, one script per row (table-driven); compare the texts and computed colours; for
the `RETRY` step, `prompts().length` before and after and the two `clientId`s from `framesent`.
Each line is `[data-turn-error]` with its code (`failed`, `step-limit`, `not-logged-in`); the retry row is the `turn.retrying` frame's text. Runs on: the room under test and the fake agent, script `c1-errors` (one turn per row); clock `real`.

### S-C1-21 A long reply: its age shows, and it is drawn whole
Given the fake agent thinking 15 s, then streaming 120 lines and 26 000 characters over 20 s, with
a 30-row table in it,
Then at t = 2.9 s there is no `AGENT` label row; at t = 3 s the label row reads
`AGENT · HH:MM · 0:03` with nothing under it, `[data-turn-age]` reads `0:03` in `--text-2`, and
the header reads `● WORKING` (no age, D235); at t = 12 s the age reads `0:12`; at t = 15 s the
first reply text is drawn under that same row (still one `AGENT` label row in the turn); after the
turn it keeps `0:35`; the reply's drawn text is all 26 000 characters and the table has 30 body
rows; no button inside the reply other than those of code blocks (none here); the header reads
`READY`. The page has one `cockpit:B9` measure, set when the reply's first sentence (`Three runs
ran last night.`, the fake agent's first line here) was drawn; its value is not asserted (B9 is
measured on the real screen only, D235).
Test: Playwright with a fake clock; assert the count of `[data-turn-label]` reading `AGENT` at 2.9
s (0), 3 s (1) and 15 s (1), the label and `[data-turn-age]` texts at 3/12/35 s, the age's computed
colour equal to `--text-2`'s, `[data-cockpit-turn]`'s text `● WORKING` at 12 s, the reply's
`textContent` length, the table's row count, that the reply holds no `button`, and
`performance.getEntriesByName('cockpit:B9', 'measure').length` 0 before t = 15 s and 1 after.
Runs on: the room under test and the fake agent, script `c1-long`; clock `page`.

### S-C1-22 A new conversation: asked, then started at once (pending Q-O2)
Given 23 turns in the conversation, no turn running, and 2 cards on the canvas,
When the owner taps `NEW`,
Then the bar `Start a new conversation? Cards, jobs and notes stay.` shows at x 760-1368, y 64-144
(80 px) with `START` at x 1144-1240 and `KEEP` at x 1256-1352, both y 80-128: `KEEP` is the
rightmost, `START` ends 16 px left of `KEEP`'s left edge;
after 10 s without a tap it goes and nothing changed (same session id, 23 turns).
When the owner taps `NEW`, then `START` at 07:10,
Then by 0.5 s the divider `NEW CONVERSATION · 07:10` is drawn under the 23 turns, which stay
unfolded above it; the header reads `READY` throughout; both cards are still on the canvas; the
fake agent receives no prompt between `START` and the owner's next prompt; that prompt goes to a
new session id.
And when a turn is running at `START`, the header reads `● STOPPING` until the turn's end arrives,
then the divider is drawn.
Test: Playwright with a fake clock on the Wall page in `wall` at 1368x912; assert the bar's
`getBoundingClientRect()` height 80 ± 1 px, `[data-newbar="keep"]`'s `left` minus
`[data-newbar="start"]`'s `right` = 16 ± 1 px and `keep.right` = 1352 ± 1, both 48x96 ± 1 px; the
divider text, the 23 turns above it, the card count, the fake agent's received-turns log and
session ids.
`NEW` is `[data-cockpit-new]`, the bar `[data-cockpit-newbar]`; the `conversation.new` frame in `framesent`. Runs on: the room under test and the fake agent, script `c1-session`, 23 seeded turns; clock `real`. The two cards' step runs in the Canvas slice with `c4-cards`' `one-card` and `second-card` turns, as S-C1-46's show step runs in Show; C1 asserts the rest.

### S-C1-23 Two pages, one conversation: a second prompt queues, it does not stop
Given two pages on one room, both panes open at the conversation's end (how each reaches the
room: `screens.md` §6, pending Q-O21), the fake agent on script `c1-session` (`stand-ins.md` §5:
`how is builder-a` and `and builder-b` each answer over 2.0 s, `queued` the default
`next-tool-end`, so with no tool running a queued prompt is taken as the next turn),
When page A sends `how is builder-a` at t = 0,
Then by t = 0.5 s after the room has it, page B shows `YOU · HH:MM` (no screen name, §12) over
`how is builder-a`, and the reply streams on both.
When page B sends `and builder-b` at t = 1.0 s (A's turn still running, D269),
Then by t = 1.5 s both pages draw it as the last item with the label `YOU · HH:MM · QUEUED` and
its text in `--text-2`; through t = 2.0 s both headers read `● WORKING` and never `● STOPPING`,
and neither page has an element with the text `STOPPED AT`; A's reply ends with its own text whole
(the fake's last step of `how is builder-a`).
When A's turn ends (t ≈ 2.0 s),
Then within 0.1 s of `prompt.taken` both pages show the same single block (no second copy) at the
start of the new turn, `· QUEUED` gone, text in `--text-1`, label time unchanged (§8 "The turn
ends first"), and `builder-b is idle.` streams below it on both.
When at t = 2.5 s a draft `stop` is typed on page A, and at t = 3.0 s `STOP` is tapped on page B
(B's input is empty and its last send was 2.0 s ago, so its slot reads `■ STOP`, D268),
Then the draft `stop` never appears on B; both pages reach `data-turn="stopping"` within 0.5 s of
the tap and draw `STOPPED AT HH:MM` under the second turn; A's slot reads `SEND` (it has a draft).
When `NEW` is tapped on A, the bar shows on A only.
Test: two Playwright browser contexts against one room under test, `hasTouch: true` on B; assert
labels, the queued label and the prompt's computed colour on both at 1.5 s, `data-turn` and the
header on both at 1.5 s and 2.0 s, the count of elements in `[data-cockpit-conversation]`
whose own text is `and builder-b` (1 on each page) after the take, drafts and `data-turn` on both after the stop; from the fake-agent
log (`stand-ins.md` §2.6) `order("interrupt")` is `[]` until 3.0 s and has one entry after it, and
`order("prompt","turn-end")` starts `["prompt","prompt","turn-end"]`. A test with two device
tokens waits for the pairing slice (Q-O21).
Runs on: the room under test and the fake agent, script `c1-session`; clock `real`.

### S-C1-24 (retired, T50)
The raw view is not in C1 (§13, pending Q-O17). The id is not reused.

### S-C1-25 Parallel calls fold by tool, end in any order, and show their ms
Given the pane open and the fake agent (script `c1-render`) scripted, after a prompt, to start
`mcp__laneboard__fleet` with `site` `hv1` at 100 ms (ends at 900 ms), `fleet` with `site` `hv2` at
110 ms (ends at 400 ms, `isError:true`) and `mcp__laneboard__ci` with `branch` `main` at 120 ms
(ends at 600 ms), then text at 1 000 ms,
When the owner sends `how is the fleet?` at t = 0,
Then by 300 ms the reply shows two tool lines in this order, both with `●`: `read 2 feeds…` and
`looked at CI on main…`; at 700 ms only the first has `●`; at 1 000 ms it reads `read 2 feeds · 1
failed`, no `●`; tapped open, its rows read `fleet  {"site":"hv1"}  800 ms  ok` and
`fleet  {"site":"hv2"}  290 ms  failed` (each `endedAt − startedAt`: at least the scripted span, at most 100 ms more).
And a second case with `hv1` ending at 300 ms and `hv2` at 900 ms gives the same lines and texts.
Test: Playwright; sample `[data-tool-line]` texts and their `●` every 100 ms; tap the first line,
read its rows; the second case reorders the ends in the script.
The ms are the `tool.end` frames' times against their `tool.start` (`framereceived`). Runs on: the room under test and the fake agent, script `c1-render` (its parallel `fleet`/`ci` turn, matched on `how is the fleet`, and its reordered twin); clock `real`.

### S-C1-26 A fresh screen says it is connecting, then never shows a blank pane
Given the room under test holding the conversation `c-0007` with 3 turns, and a page loaded at t = 0
with the room's outbound `welcome` held back 2 s (the outbound fault hook, `stand-ins.md` §1.1),
When the owner opens the pane at t = 0.5 s,
Then `data-cockpit="connecting"`, the conversation shows exactly `Connecting to the cockpit room…`,
`SEND` is disabled and the input takes typed text; by 2.5 s the 3 turns are drawn with the last
one's end in sight and the line is gone.
And with an empty conversation the line becomes `Nothing said yet. Type a question below.` (the
`none` variant of §6: C1 boots with `"stt":{"url":"none"}`, `stand-ins.md` §1.1, D265) and stays
until a prompt is sent.
And with the room not answering at all, at 5 s `data-cockpit="room-down"` and the status line says
`Cockpit room unreachable since` the load's `HH:MM`.
Test: Playwright against the room under test; hold back `welcome` with the fault hook; assert
`data-cockpit`, the conversation's text and `SEND`'s `disabled` at 0.5 s and 2.5 s; restart with an
empty conversation and assert the line's text exactly (the variant `…or hold the talk button and
speak.` is asserted in the C2 step `with voice`, `slices.md` §3.2), then with the room stopped.
Runs on: the room under test and the fake agent, script `c1-render` (no turn played), 3 seeded turns in `c-0007`, then none; clock `real`.

### S-C1-27 STOP during a turn drops a queued prompt and says so (pending Q-O1)
Given the fake agent on a turn calling a tool from t = 0.5 s to t = 20 s, `onInterrupt`
`endAfterMs` 300, capabilities with `interrupt_cancel_queued_v1`, and the prompt
`only the failed one` sent at t = 1 s and showing `· QUEUED`,
When the owner taps `STOP` at t = 3 s (the input is empty, the slot reads `STOP`),
Then by t = 3.1 s the header reads `● STOPPING`; the fake agent's log has an `interrupt` line with
`cancelQueued` true and the queued prompt's uuid in `cancelled` (`stand-ins.md` §2.6); by t = 3.5 s the turn shows `STOPPED AT HH:MM`, the header `READY`, and the
queued block reads `YOU · HH:MM · NOT SENT` with `Dropped by STOP.`, `RETRY` and `EDIT`; nothing
more is sent to the agent. A tap on `RETRY` at t = 5 s sends `only the failed one` with a new
`clientId` as a new turn (`delivery:"new"`).
Test: Playwright on the real room with the fake agent; assert the texts at 3.1 s and 3.5 s, the
log's interrupt line, `prompts()` count 1 before and 2 after `RETRY`, and two different `clientId`s
in the screen's sent messages.
The word is `[data-turn-delivery="not-sent"]`, the stopped line `[data-turn-stopped]`, the header `[data-cockpit-turn]`; the sent messages are `stop` and the two `prompt` frames (`framesent`). Runs on: the room under test and the fake agent, script `c1-typing` (S-C1-27's 19.5 s tool call, `endAfterMs` 300); clock `real`.

### S-C1-28 A queued prompt the agent never reads is sent once more, then shown as not sent (pending Q-O1)
Given the fake agent with `queued` `ignore-once` on a turn that ends `done` at t = 3 s, and the
prompt `only the failed one` sent at t = 1 s,
When nothing else is tapped,
Then the block reads `· QUEUED` from t = 1.5 s; at t = 13 s (10 s after `turn.end`) the room sends
it to the agent again with a new UUID; the fake takes it as a new turn and by t = 13.5 s `· QUEUED`
is gone and its reply starts under its own `AGENT · HH:MM` label row. With `queued` `ignore` the
second send is not taken either, and at t = 23 s the block reads `YOU · HH:MM · NOT SENT` with
`The agent did not read this.`, `RETRY` and `EDIT`.
Test: Playwright, room clock `manual` and `advance(ms)` (`stand-ins.md` §1.1); two fake-agent scripts; assert
`prompts()` count 2 with two UUIDs, the second with `resendOf` the first's uuid, the room's log line
`prompt.resend` naming the same two UUIDs (`stand-ins.md` §2.6), the label texts at 13.5 s
and 23 s; in both cases exactly one resend. In the `ignore-once` case, from `page.on('websocket')`'s
`framereceived`: a `turn.prompt` with the block's `clientId`, a new `turnId`, `delivery:"new"`
and `"from":"queued"` arrives before the `prompt.taken` naming that `turnId` (D258); the
conversation holds exactly one prompt block with the text `only the failed one`; and the page
never closes the link with 4000 (the `WebSocket`'s `close` event does not fire, and `framesent`
shows no second `hello`).
The word is `[data-turn-delivery="queued"]`, the line `[data-turn-error="not-sent"]`. Runs on: the room under test and the fake agent, script `c1-typing` (S-C1-28's two turns); clock `advance` once the first turn's `done` is read.

### S-C1-29 A queued prompt survives a reload (pending Q-O1)
Given the fake agent on a turn calling a tool from t = 0.5 s to t = 20 s, then writing text, and the
prompt `only the failed one` sent at t = 1 s and showing `YOU · HH:MM · QUEUED`,
When the owner reloads the page at t = 3 s and opens the pane,
Then by t = 5 s the snapshot is drawn: the turn's tool line with `●`, and as the conversation's
last block `YOU · HH:MM · QUEUED` over `only the failed one` in `--text-2` (the same `HH:MM` as
before the reload); at t = 20 s the fake agent takes it (`prompt.taken` `taken`), and by t = 20.1 s
`· QUEUED` is gone, the text is `--text-1` and the block sits above the turn's text that follows.
And a second case: the owner taps `STOP` at t = 3 s (the prompt reads `NOT SENT` with
`Dropped by STOP.`), then reloads at t = 5 s: by t = 7 s the reloaded pane shows the same label,
line, `RETRY` and `EDIT`, and `RETRY` sends `only the failed one` as a new turn with a new
`clientId`.
Test: Playwright on the real room with the fake agent; read the `snapshot` frame with
`framereceived` and assert its running turn has one item `{"kind":"prompt","state":"queued"}` with
the sent `clientId`; assert label texts and computed colour before and after the reload, at
20.1 s the block's index among the turn's items; in the second case the item's `state`
`cancelled` and `why` `stopped`, and `prompts()` count 2 after `RETRY`.
The block is the item under `[data-turn-id]` whose word is `[data-turn-delivery="queued"]`. Runs on: the room under test and the fake agent, script `c1-typing` (S-C1-29's turn); clock `real`.

### S-C1-30 A shell call is refused and shows as a grey `tried` line (pending Q-O23)
Given the pane open, the real room with the fake agent (script `c1-render`), whose turn for
`clean up the logs` has a `denied` step `Bash` at 100 ms with input
`{"command":"rm -rf /var/log/laneboard/old && echo done"}`, a second `denied` step `Bash` at 200 ms
with `{"command":"ls /var/log"}`, text `I cannot run commands here; I can only look.` at 400 ms and
`end` `done` at 600 ms,
When the owner sends `clean up the logs` at t = 0,
Then by 700 ms the reply shows two tool lines, not one folded line, each reading exactly
`tried Bash, not allowed`, in `--text-2`, with no `●`, no `…` and no ` · failed`, followed by the
text block; the header reads `READY` and no line of §10 is drawn. Tapped open, the first line's row
reads `Bash  {"command":"rm -rf /var/log/laneboard/old && echo done"}  refused`, wrapped inside the
text column. The fake agent's `start` line has in its `argv` `--strict-mcp-config`, then
`--allowedTools` followed by `mcp__laneboard__*,Read,Grep,Glob`, then `--permission-prompts`
followed by `none`, and no `argv` element contains `Bash`.
Test: Playwright on the real room with the fake agent; count `[data-tool-line][data-denied="true"]`
(2) and read their texts and computed colour; tap the first, read its row and assert its
`scrollWidth` is at most its `clientWidth`; read `starts()[0].argv` from the fake agent's log
(`stand-ins.md` §2.6).
Runs on: the room under test and the fake agent, script `c1-render` (its two `denied` `Bash` steps); clock `real`.

### S-C1-31 A secret in a tool's input never reaches the screen
Given the pane open and the fake agent (script `c1-render`) whose turn for `find the token` has a
`Grep` step (`"call":false`) at 100 ms ending at 300 ms with input
`{"pattern":"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123DEF456ghi789","path":"/etc/laneboard"}`,
a `denied` step `WebFetch` at 400 ms with
`{"url":"https://example.invalid/hook?token=Q7wErTy12&lb_sig=Zq9Xw4Vr"}` and `end` `done` at 600 ms,
When the owner sends `find the token` at t = 0,
Then by 700 ms the reply shows `searched the files` and `tried WebFetch, not allowed`; opened, the
rows read `Grep  {"pattern":"Authorization: Bearer [redacted]","path":"/etc/laneboard"}  200 ms  ok`
(the ms as in S-C1-25: at least 200, at most 300) and
`WebFetch  {"url":"https://example.invalid/hook?token=[redacted]&lb_sig=[redacted]"}  refused`; no
text frame the page received contains `eyJhbGci`, `abc123DEF`, `Q7wErTy12` or `Zq9Xw4Vr`.
Test: Playwright; collect every `framereceived` payload from the page's link and assert none holds
the four strings; open both lines and read their rows. The rules themselves are the unit test of
`server/cockpit/redact.mjs` (§5.3), in `npm test`.
The lines are `[data-tool-line]`; the payloads are every `tool.start` and `tool.end` frame among them. Runs on: the room under test and the fake agent, script `c1-render` (its `Grep` and `denied` `WebFetch` steps); clock `real`.

### S-C1-32 The on-screen keyboard: the input row sits on its edge, the conversation stays pinned
Given a touch context (`hasTouch: true`) at 1368x912, the Wall page in `wall` (on the app's `#/map`
first, `screens.md` §9.3), the pane open on a 12-turn conversation scrolled to its end, the input empty, no chip,
no status line,
When the owner taps the input at t = 0 and the test resizes the viewport to 1368x532 at t = 0.1 s
(a 380 px keyboard),
Then by t = 0.2 s `data-keyboard="up"`; `[data-cockpit-conversation]` is x 760-1368, y 0-532; the
input is x 784-1184, y 460-524; `SEND` x 1200-1264 and the talk button x 1280-1344, both y 460-524;
the opener reads `CLOSE` at x 1288-1336, y 396-444; the header's `CLOSE` is at y 8-56; the
conversation is 380 px tall, scrolled to its end, the last turn's last line inside it.
When the owner types `and builder-a?` and taps `SEND`,
Then the input still has the focus, `data-keyboard` stays `up`, and the new prompt block's rect is
inside the conversation's rect.
When the owner flicks the conversation 60 px down and back,
Then the input still has the focus.
When the owner taps the conversation's text at (1000, 200), not on a tool line,
Then the input has lost the focus and `data-keyboard="down"`; after the test resizes back to
1368x912 the rects are §1's (input y 824-888, the opener `CLOSE` at y 760-808) and the
conversation is at its end.
Test: Playwright with `hasTouch`, `tap`, `touchscreen` drag for the flick and `setViewportSize`;
`getBoundingClientRect()` of each part compared ± 1 px; `document.activeElement` after each step;
pinned is `scrollTop + clientHeight ≥ scrollHeight − 1`. A second run stays at 1368x912 and
stubs `navigator.virtualKeyboard` with an init script (`boundingRect.height` 380, one
`geometrychange` dispatched after the tap) and asserts the same rects (D130).
A third run (T125) is S-C1-16's fake-agent turn with the keyboard up: the owner taps the input at
t = 1.5 s, the test resizes to 1368x532 at t = 1.6 s, the owner types `only the failed one` at
t = 2.0 s and taps `SEND` at (1232, 492). Then at t = 2.5 s the input still has the focus,
`data-keyboard="up"`, the block reads `YOU · HH:MM · QUEUED`, and its rect (label row and prompt
block) is inside the conversation's rect with its bottom at y ≤ 380 and no overlap with the
opener's rect (x 1288-1336, y 396-444); the slot at x 1200-1264, y 460-524 has `data-send="wait"`
at t = 2.9 s and `data-send="stop"` at t = 3.1 s, both rects inside y 0-532; at t = 4.1 s
`Only builder-a failed.` is drawn below the block and its last line ends at y ≤ 380 (pinned).
Runs on: the room under test and the fake agent, 12 seeded turns, script `c1-typing` (a short `done` turn for `and builder-a?`; the third run S-C1-16's turn); clock `real`, the third run clock `page`.

### S-C1-33 Keyboard up with the status line and a long draft: the conversation keeps 200 px
Given S-C1-32's setup with the room down (the pane's 80 px status line, `screens.md` §7) and the
viewport at 1368x532 after a tap in the input,
When 8 214 characters are pasted into the input (the length note shows, §7),
Then the status line is y 64-144, the note sits in the line slot above the input row, the input is
132 px tall (`clamp(64, 64 + 268 − 200, 182)`), its bottom at y 524, scrolled to its end with the
caret on its last visible line, and the conversation is 200 px tall.
When the test resizes back to 1368x912 and blurs the input,
Then `data-keyboard="down"` and the input is 182 px tall (4 lines, §7) with its bottom at y 888.
Test: Playwright `fill`; rects and heights ± 1 px; the input's
`scrollTop + clientHeight ≥ scrollHeight − 1`; the conversation's `clientHeight`.
Reads `[data-cockpit-status]`, `[data-cockpit-line][data-line="length"]`, `[data-cockpit-input]` and `[data-cockpit-conversation]`; the room down is `POST /link {"up":false}` (`stand-ins.md` §1.2). Runs on: the room under test and the fake agent, script `c1-typing` (no turn played); clock `page`, the 5 s to `room-down` moved with `page.clock.runFor`.

### S-C1-34 Chip, line slot and `↓ NEW` stack without overlapping
Given the Wall page in `wall` at 1368x912 (`hasTouch: true`), the pane open on 10 earlier turns, a
chip for `vm-b` from `ASK ABOUT THIS` (S-C3-10), and the fake agent streaming a 30-line reply over
6 s,
When the owner drags the conversation down by 600 px at t = 1 s (scrolling up),
Then `↓ NEW` is x 1168-1264, y 680-728, the chip row y 744-808 with the chip y 752-800 and its `✕`
ending at x ≤ 1264; `↓ NEW`, the `✕` and the opener (`CLOSE`, x 1288-1336, y 760-808) do not
intersect and are ≥ 8 px apart.
When at t = 2 s the room's link stops, and 5 s later `data-cockpit="room-down"`,
Then there is one `[data-cockpit-line]`, `data-line="room-down"`, y 776-808, reading `Sending and
voice come back with the room.`; the chip row is y 712-776 (chip y 720-768), `↓ NEW` y 648-696,
the conversation's bottom y 712, and the line that was at the conversation's top is still there.
When the owner pastes 8 214 characters into the input,
Then the input is 182 px tall, the slot still shows only `room-down` (the length note waits) at
y 658-690, the chip row y 594-658, `↓ NEW` y 530-578.
When the link starts again and `data-cockpit="live"`,
Then the slot shows `data-line="length"` reading `8 214 / 8 000 CHARACTERS` at the same rect.
When the owner taps `↓ NEW`,
Then the chip is still there (one `[data-cockpit-chip]`, `data-node="vm-b"`), the last line is in
sight and `↓ NEW` is gone.
Test: Playwright with `page.clock`, a `touchscreen` drag, `POST /link {"up":false}` and
`{"up":true}` on the room under test, `fill` for the paste; `getBoundingClientRect()` of the slot,
the chip row, the chip, `[data-cockpit-chip-remove]`, `↓ NEW` and `[data-cockpit-open]` compared
± 1 px after each step, and a pairwise check that no two of the tappables intersect or come closer
than 8 px; `count()` of `[data-cockpit-line]` is 1 at each step.
Runs on: the room under test and the fake agent, script `c1-render` (its 30 lines over 6 s), 10 seeded turns, the chip set by S-C3-10's tap; clock `page`.

### S-C1-35 Tool lines from odd input, and the words module's unit test
Given the fake agent on script `c1-render`, a turn whose steps call, 100 ms each with reply text
between them, `Read` `{"file_path":"/etc/laneboard/"}`, `mcp__laneboard__runs` `{"run":7}`,
`mcp__laneboard__lanes` `{}` and `mcp__laneboard__ci`
`{"branch":"ci-fix/very-long-branch-name-for-the-night-run"}`,
When it has ended,
Then the four tool lines read exactly `read laneboard`, `looked at run 7`, `looked at the lanes`
and `looked at CI on ci-fix/very-long-branch-name-for…` (32 characters kept, no space to go back
to), each in `--text-2` with no `●`.
Test: Playwright; `textContent` of the four `[data-tool-line]` elements. And
`test/tool-words.test.mjs` in `npm test` for `public/js/core/tool-words.js` (D147, the pure
module holding §5's table): `Bash` `cd /srv/app && npm test` → `ran cd /srv/app && npm test`;
`Bash` `PGPASSWORD=[redacted] psql -h db` (input as redacted by the room) →
`ran PGPASSWORD=[redacted] psql -h db`; `Bash` `rm -rf /var/log/laneboard/old && echo done` →
`ran rm -rf /var/log/laneboard/old…`; `Bash` `"echo a\n\n  echo b"` → `ran echo a echo b`; `Bash`
`{}` → `ran a command`; `WebFetch` `https://Example.Invalid:8443/a?x=1` →
`fetched a page from example.invalid`; `WebFetch` `javascript:alert(1)`, `not a url` and `42` →
`fetched a page from an invalid address`; two `WebFetch` calls on `https://example.invalid/a` and
`/b` → `fetched a page from example.invalid`, on two hosts → `fetched 2 pages`; `Read` `/` →
`read /`; a 40-character target of emoji is cut after 32 code points with no lone surrogate.
Runs on: the room under test and the fake agent, script `c1-render` (S-C1-35's odd-input turn); clock `real`.

### S-C1-37 A logged-out agent is named before any prompt, and the line goes after the login
Given the room under test with the script `c1-login` (`start.login` `ok`), its clock set to
2026-10-27 03:00 and `manual` (`stand-ins.md` §1.2), and no page open,
When the test writes `login` `failed` into the script and advances the room's clock 900 s,
Then the fake agent's log holds a second `login-check` line, and a page loaded now (pane opened at
once) shows in its first frame after `welcome`: `[data-cockpit-status]` with `data-status`
`not-logged-in`, text exactly `The agent is not logged in on the room since 03:15 (0 min). Log it in there.` (the
page's clock fixed at 03:15:00),
rect y 64-144 (80 px), computed font size 18 px; `SEND` and the talk button enabled;
`fakeAgent.prompts()` is 0.
When the test advances 60 s three times,
Then the log holds three more `login-check` lines (every 60 s while logged out) and the text is
unchanged (`since 03:15`, not the later checks' times).
When the test writes `login` `ok` and advances 60 s,
Then within 1 s the status line is gone (`[data-cockpit-status]` absent, the conversation's top at
y 64) and the fake's `starts` is one higher (the room restarts an idle agent with `--resume` so it
reads the new login, `protocols.md` §11.10).
And a second case: the room started with `login` `failed` from the beginning; a page loaded 2 s
after the room shows the same line with the room's start time, before anything is typed.
Test: Playwright against the room under test, `POST /clock` for `set`, `manual` and `advanceMs`;
`fakeAgent.loginChecks()`; `page.clock.setFixedTime('2026-10-27T03:15:00+01:00')` before the load;
text, `data-status`, rect and computed style of
`[data-cockpit-status]`; `disabled` on `SEND` false; `starts` read before and after. The 10 s
timeout row of `protocols.md` §11.10 is a `node:test` of the room's check with `login` `hang`.
Runs on: the room under test and the fake agent, script `c1-login`; clock `advance` on the room, the page's clock fixed.

### S-C1-38 One status line: the highest that holds wins, news never waits
Given S-C1-37's page with `not-logged-in` showing,
When the room's link stops (`POST /link {"up":false}`) and 5 s pass,
Then `data-status` is `room-down`, its text starting `Cockpit room unreachable since` (the page's
own clock, `screens.md` §7); there is still one `[data-cockpit-status]` element.
When the test sets the page offline (`context.setOffline(true)`),
Then `data-status` is `offline`; set online again, it is `room-down`.
When the link starts again,
Then the first frame after `welcome` shows `not-logged-in` with `since 03:15`, and at no sample
from then to 6 s does `Back since` show.
Second case: a fresh room with `login` `failed`, `startFailures` 3 and `startStderr`
`claude: command not found` (`stand-ins.md` §2.4), clock `real`: after the second failed start
`data-status` is `agent-down` (`Agent not running since HH:MM (0 min).`, the room's time of that start),
`SEND` and talk disabled; at the fourth start's `ready` (about 6 s after the first) it becomes
`not-logged-in` (the condition still holds) and `SEND` is enabled again; no `agent-back` line
shows while `not-logged-in` holds.
Third case: `login` `ok`, no condition, the link blips 6 s: `Back since HH:MM.` (the page's clock)
shows for 5 s ± 0.2 s, then nothing.
Test: Playwright; sample `[data-cockpit-status]` count, `data-status` and text every 100 ms; room's
`GET /sent?type=status` holds one message per change, in the order of the table's rows.
The messages are `status` frames. Runs on: the room under test and the fake agent, script `c1-login` (its second case with `startFailures` 3); clock `real`.

### S-C1-39 A room restart mid-conversation: the same turns, the same session (pending Q-O24)
Given the room under test with the script `c1-session` and its clock `real` (the restarted process
keeps no clock the test set), started on seeded state (`stand-ins.md` §1.1 `stateFiles`):
`session.json` for `c-0007` with session `0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91` and
`conversation.jsonl` with 20 `done` turns `t-0101`..`t-0120`, dated 60 to 41 min before now (made
by `test/cockpit/fixtures/conversation.mjs`, so none is past the 30 days); the page loaded, the pane open;
the owner has sent `how is builder-a` twice and both are answered (22 turns); then sends `how is
builder-a` a third time, and while its answer streams (1.0 s after the send)
When the room process is killed (`booted.restart({signal:"SIGKILL"})`, same state dir),
Then within 5 s of the kill `data-cockpit="room-down"` and its status line show (`screens.md` §7);
the 23 turns stay on screen.
When the restarted room prints its `control` line,
Then within 10 s the page has reconnected (its `welcome` has another `epoch`, `resume`
`"snapshot"`) and drawn the snapshot: 23 prompt blocks, the first `t-0101`'s, `conversation`
`c-0007`, no `NEW CONVERSATION` divider; the 23rd turn shows its prompt and no reply text (its one text
block would have been written at its end, 2 s after the send) and under it `[data-turn-error="agent-exited"]` with `The agent stopped unexpectedly
at HH:MM. The room is starting it again.`, then, once the agent is back, `The agent is back (HH:MM).
Your last message was not answered.` and `RETRY` (`HH:MM`: the restarted room's start, §11.7.1
step 3 of `protocols.md`); the header reads `READY`; the view is scrolled to
the end.
When the owner taps `RETRY`,
Then the fake agent's log has a second `start` line with `"resumed":true` and the same `session`
`0b7e5c2a-…`, and its `prompts()` grows by 1 with `how is builder-a`; the new turn is `t-0124`
and is answered in 2 s.
And the state dir's `cockpit/conversation.jsonl` has mode 0600, holds exactly one `conversation`
line and one `turn` line per turn (24 after the answer, rewritten at the start), and no line holds
a `kind` other than `conversation` or `turn`.
Test: Playwright against the room under test; `booted.restart` with `SIGKILL`; read `welcome` and
the `snapshot` frames with `framereceived` (`turns.length` 23, `olderTurns` 0); count
`[data-turn-id]` elements (the first `t-0101`); text of the error line; `fakeAgent.starts()` and its `start` lines;
`fs.statSync(...).mode & 0o777` is `0o600` and the file's lines parsed. The start steps' edge
cases (torn line, 31-day-old turn, missing `session.json`) are `protocols.md` §13's store test.
Runs on: the room under test and the fake agent, script `c1-session`, 20 seeded turns; clock `real`.

### S-C1-40 The type floor: no text under 16 px, no instruction under 18 px (T43, D21, D167)
Given the Wall page in `wall` at 1368x912 (`hasTouch: true`), `document.fonts.ready` resolved and
`document.fonts.check('500 18px "Barlow Condensed"')` true (the vendored face, not a fallback: the
line counts below hold only with it), the pane open, the script `c1-render`,
When the page is brought through four states, one after the other: (1) idle, the header `READY`;
(2) the owner sends a prompt and the reply streams S-C1-05's 4-column table, S-C1-08's 40-line `sh`
block and two tool lines, one of them opened (header `● WORKING`); (3) after its end, 8 214
characters pasted into the input (S-C1-15's note); (4) the room's link stopped until
`data-cockpit="room-down"`,
Then in every state each text node under `[data-cockpit-conversation]` with non-white-space text,
whose parent has a non-empty `getClientRects()`, computed `visibility` `visible` and `opacity`
above 0, has a parent whose computed `font-size` is ≥ 16 px (the fence label `SH` included);
`[data-cockpit-turn]`, `[data-cockpit-line]` and `[data-cockpit-status]` are ≥ 18 px;
`[data-cockpit-turn]`'s colour is `--text-2`'s and `[data-cockpit-line]`'s `--text-1`'s; in (3)
the line slot reads `8 214 / 8 000 CHARACTERS`, y 776-808 (one line, 32 px); in (4) it reads
`Sending and voice come back with the room.`, y 776-808.
And the C2 slice runs the same walk in three voice states: a hold past 400 ms (`RELEASE TO SEND ·
SLIDE OFF TO KEEP`, one line; `[data-talk-cancel]` holds only `✕` at a computed 28 px with the
accessible name `Cancel`), a slide off (`MICROPHONE OFF · TEXT KEPT`), and `[data-talk-error="stt-down"]`
with `data-talk-detail="token"`: 2 lines, the slot y 752-808 (56 px), the text not cut (no `…`,
it ends with `Tap TALK to try again.`).
Test: Playwright; one `page.evaluate` with a `TreeWalker` over `NodeFilter.SHOW_TEXT` returning
`{text, px, path}` for every node under the floor, asserted empty per state; computed styles and
rects of the three selectors; colours compared with `getComputedStyle(document.documentElement)`
values of `--text-1` and `--text-2`; for C2 the fake speech scripts `c2-tap` (hold, slide off) and
`c2-faults` (its `"401"` utterance, `stand-ins.md` §3.3). The walk is a helper the later slices
reuse on the canvas (`[data-card]`).
Runs on: the room under test and the fake agent, script `c1-render`; clock `real`.

### S-C1-41 Every tappable shows it was touched in the first frame (T45, D224)
Given the Wall page at 1368x912 with `hasTouch: true`, the pane open, and for each row of the
C1 table in `README.md` §"Touch" the state that shows it: idle (opener, `CLOSE`, `NEW`, `SCREEN`),
a draft `how is` (`SEND`), S-C1-16's running turn (`STOP`), a tap on `NEW` (`KEEP`, `START`),
S-C1-10's scrolled-up reply (`↓ NEW`), S-C1-07's ended turn (a tool line), S-C1-08's reply
(`SHOW ALL 40 LINES`), 60 earlier turns (`SHOW EARLIER`; a conversation file of 60 turns written
into the room's state directory before boot, the format of `protocols.md` §11.7.1), S-C1-18's E1 (`RETRY`,
`EDIT`), S-C1-20's E7 (`GO ON`) and S-SCR-19's room-down (`RETRY NOW`),
When a touch lands on the centre of the tappable and stays 300 ms, then lifts,
Then in the first animation frame after the `touchStart` the tappable has `data-pressed`, its
computed `background-color` is `--bg-sunken`'s and, if its computed `border-top-width` is above
0, its `border-top-color` is `--text-2`'s; its size and position are unchanged (rect ± 0 px);
in the first frame after the `touchEnd` `data-pressed` is gone and both colours are back to their
rest values; its computed `touch-action` is `manipulation` and every value of
`transition-duration` is `0s`.
And a second case on the tool line: a touch lands on it and moves 40 px up within 100 ms (the
conversation scrolls): `data-pressed` is gone by the first frame after the browser's
`pointercancel` and the line has not opened. A third case on `SEND` with a draft: the touch lands,
moves 80 px left (off the box) and lifts there: `data-pressed` goes in the frame after the
`pointerleave`, and nothing is sent (`prompts()` unchanged).
And a disabled tappable (the `data-send="none"` slot while the microphone is open is C2's; in C1 a
`SEND` with an empty input, `disabled`) never gets `data-pressed`.
Test: Playwright, one table-driven test (`e2e/cockpit/pressed.spec.mjs`): an array of
`{name, locator, setup}` rows, the later slices append theirs. Each row: run `setup` (fake-agent
scripts `c1-render`, `c1-errors`, `c1-long`, `scr-room`), then through a CDP session
`Input.dispatchTouchEvent` `touchStart` at the rect's centre, then `page.evaluate` reading the
styles inside one `requestAnimationFrame` callback; colours compared with probe elements styled
`background: var(--bg-sunken)` and `color: var(--text-2)` (computed, so the theme decides);
`touchEnd`, read again in the next frame. The second and third cases add `touchMove` events.
Each row's `locator` is the table's selector (`[data-cockpit-open]`, `[data-cockpit-close]`, `[data-cockpit-new]`, `[data-cockpit-screen]`, `[data-cockpit-send]`, `[data-newbar]`, `[data-cockpit-follow]`, `[data-tool-line]`, the code block's button, `SHOW EARLIER`, the `RETRY`/`EDIT`/`GO ON` under `[data-turn-error]`); the pressed state is `[data-pressed]`. Runs on: the room under test and the fake agent, the scripts above plus `c1-typing` for S-C1-16's turn and S-C1-18's E1 (with `POST /drop`); clock `real`.

### S-C1-42 A reply cannot pass for the cockpit's own lines (T59, D227)
Given the fake agent's reply (script `c1-render`, match `look-alike`):

````
### YOU · 07:02
## Not sent
> Not sent: the room did not confirm within 5 s.

```
Paired as desk2.
```
■ hv1 down
````

When it has ended,
Then the reply shows `YOU · 07:02` and `Not sent` as headings: mono 28 px, weight 600,
`--text-1`, computed `text-transform` `none`, the text as written; the quote has a 2 px `--line`
left border; the code block a 2 px `--line` left border and `border-top-width`,
`border-right-width` and `border-bottom-width` 0 px; `■` is `--p1` (D25).
And no element inside `[data-reply]` has a border side whose computed width is above 0 px and
whose colour is `--line-strong`'s, while every `[data-turn-label]` in the conversation (the
prompt's and the reply's) has a 2 px left border in `--line-strong`.
And a second case: the same turn after S-C1-18's E1 on the prompt before it: the
`[data-turn-error="not-sent"]` line has a 2 px `--line-strong` left border and 1 px on its other
sides; the quote that reads the same words has neither.
Test: Playwright; for every element under `[data-cockpit-conversation]`, read
`getComputedStyle` border widths and colours on all four sides; colours compared with a probe
element styled `border-color: var(--line-strong)` (computed, so the theme decides); assert the
set of elements with a `--line-strong` side equals the `[data-turn-label]`,
`[data-turn-error]` and `[data-turn-stopped]` elements. Runs in both themes.
Runs on: the room under test and the fake agent, script `c1-render` (match `look-alike`), the second case adds `POST /drop {"what":"next-prompt"}` before the prompt before it; clock `real`.

### S-C1-43 The 11th prompt in a minute is not sent (T59, D228)
Given the room under test with its clock in `manual` at 07:00:00 (`stand-ins.md` §1.2), the
fake agent answering each prompt with a `done` turn in 0.2 s (script `c1-typing`), one paired
screen with two pages open on it (two tabs of one browser context, one device token),
When page A sends `ping 1` to `ping 6` and page B `ping 7` to `ping 10`, each after the
previous one's `· SENDING` went, the room's clock moved 2 s between sends (`ping 10` at
07:00:18), then page A sends `ping 11` at 07:00:20,
Then `ping 1` to `ping 10` are answered and `ping 11`'s block reads `YOU · 07:00 · NOT SENT`
within 0.5 s, under it `Too many messages from this screen; wait a minute.` with `RETRY` and
`EDIT`; page B draws the same block; `fakeAgent.prompts()` holds 10 lines; the audit file holds
one refusal line for the token (D165); the header reads `READY`.
And when the clock moves to 07:01:00.5 (`ping 1` is more than 60 s old) and page A sends
`ping 12`, it is answered: `prompts()` holds 11.
And `ping 11`'s `RETRY` on page A is disabled from the refusal (page A's clock installed with
`page.clock.install()` before the send): a tap on it sends no frame and `prompts()` stays at 11;
after `page.clock.runFor(59000)` it is still disabled, after `runFor(1000)` more it is enabled (E9,
D264). With the room's clock at 07:01:20.5, a tap on it sends `ping 11` with a `clientId`
different from the refused one, it is answered and `prompts()` holds 12; the refused block stays
above the new one.
And `EDIT` on `ping 11` puts `ping 11` back into the input (as E1).
Test: Playwright, one context, two pages; `advance(ms)` (`stand-ins.md` §1.2) between sends;
assert the label, the line's exact text, `prompts().length`, `RETRY`'s `disabled` property before
and after `page.clock.runFor`, the two `clientId`s from `framesent`, and the audit lines read with
`laneboard audit --file`. The case with two device tokens (each its own 10) runs in the Pair
slice (Q-O21), as S-C1-23's.
The word is `[data-turn-delivery="not-sent"]`, the line `[data-turn-error]`; the refusal is the `prompt.refused` frame with `too-many` (`framereceived`). Runs on: the room under test and the fake agent, script `c1-typing`; clock `advance`.

### S-C1-44 Three speak-ups in the night: the pane opens on them, under `SINCE YOU LOOKED` (T66, D233)
Given the room under test with quiet hours `22:00`-`07:00` (`coworker.md` §4), the fake agent on
script `cw-speak` (every speak-up answered with two sentences, about 120 characters), two paired
screens: `desk` on the Wall page in `wall` layout and `hall` in `split` (the conversation a
column); on 26 Oct at 22:35 the owner asked `anything left for tonight?` on `desk`, got the answer,
and tapped `CLOSE` at 22:40:00,
When P1 alarms are added at 03:00:00, 04:00:00 and 05:00:00 (each its own block, `RAISED · 03:00 ·
QUIET` and so on, each answered by an agent turn), and at 07:30:00 the owner taps `CHAT` on `desk`,
Then on `desk`, in the first frame of the open, the dot on the talk button is gone; by 0.2 s
`[data-cockpit-since]` reads exactly `SINCE YOU LOOKED · YESTERDAY 22:40`, its next item is the
`RAISED · 03:00 · QUIET` block, its top is the conversation's visible top (± 1 px), the 22:35
turn is above it out of sight, and `↓ NEW` shows (the three blocks and three turns are taller
than the visible conversation);
And on `hall` there is no `[data-cockpit-since]` and the conversation is at its end;
And when the owner taps `↓ NEW`, the view is at the end and the divider stays; when `desk`'s pane
is closed at 07:31:00 and opened at 07:32:00, there is no divider and the view is at the end;
And when a fourth P1 alarm is added at 07:40:00 with `desk` closed and `desk` is reloaded at
07:41:00 and its pane opened at 07:42:00, the divider reads `SINCE YOU LOOKED · 07:31` above
`RAISED · 07:40` (the room's `lookedAt` from `welcome`).
Test: Playwright, two contexts, `page.clock` and the room's clock moved together with `advance(ms)`
(`stand-ins.md` §1.2), alarms by `POST /alarms`; the divider's `textContent`; its
`nextElementSibling` matches `[data-raised]`; its `getBoundingClientRect().top` against
`[data-cockpit-conversation]`'s; `[data-cockpit-follow]` visible; `data-speakup` absent; the
`welcome` frame's `lookedAt` read with `page.on('websocket')` after the reload. Runs in the Speak
slice (`slices.md` §3.4).
Runs on: the room under test and the fake agent, script `cw-speak`; clock `advance`.

### S-C1-45 At 1024x768 the pane is 608 px and the input row is inside the viewport (T77, D249)
Given the app on `#/map` at 1024x768 (the tablet shell) and the Wall page in `wall` at 1024x768,
each with the pane closed and the fake agent idle,
When the owner taps `[data-cockpit-open]` on each,
Then by 200 ms the pane is x 416-1024 (y 0-768 on the Wall, y 36-744 in the app); the input is
x 440-840, `SEND` x 856-920, the talk button x 936-1000, all y 680-744; the corner `CLOSE` is
x 944-992, y 616-664 (§1.2's table); the Map left of x 416 still pans on a drag at (200, 400).
When the owner types `how is builder-a` and taps `SEND`,
Then the prompt block's right edge is ≤ 1000 px and the reply's text column is 560 px wide.
Test: Playwright `viewport: {width: 1024, height: 768}`, `hasTouch: true`, script `c1-session`; for
the input, `SEND`, `[data-talk]` and the corner `[data-cockpit-open]` assert the rect (± 1 px) and
that it lies inside `0..innerWidth` x `0..innerHeight`; drag on the Map and read its camera; after
the send read `[data-reply]`'s `clientWidth` minus its padding.
Runs on: the room under test and the fake agent, script `c1-session` (its 2 s answer to `how is builder-a`); clock `real`.

### S-C1-46 At 800x1280 the pane is the whole screen and CLOSE is the way back (T77, D249)
Given the app on `#/map` at 800x1280 portrait with a node selected, the pane closed,
When the owner taps `[data-cockpit-open]`,
Then by 200 ms the pane is x 0-800, y 36-1256, with no left border; the input is x 24-616,
`SEND` x 632-696, the talk button x 712-776, all y 1192-1256; the corner `CLOSE` is x 720-768,
y 1128-1176; the Map's container has the `inert` attribute and `document.elementFromPoint(300, 400)`
is inside `[data-cockpit-conversation]`.
When the fake agent runs a `show` of `builder-a` (`c4-show-canvas.md` §2) in its reply,
Then the pane stays open (`data-pane="open"`), the reply has its show line, and once `CLOSE` is
tapped `builder-a` is centred in the whole 800 px (at x 400 ± 24 px), the `inert` attribute is
gone and a tap at (300, 400) reaches the Map.
When the window turns to 1280x800 with the pane open and the draft `next`,
Then in the next frame the pane is x 672-1280 with its left border, the Map is no longer `inert`,
and the draft is still `next`.
Test: Playwright `viewport: {width: 800, height: 1280}`, `hasTouch: true`, script `c1-render`
plus one `show` call (the show steps run in the Show slice, `slices.md` §3.6; the rest in C1);
assert the rects inside the viewport, `hasAttribute('inert')`, `elementFromPoint`, `screenOf('builder-a')`
after `CLOSE`; `setViewportSize({width: 1280, height: 800})` and read the rect and the input value.
The pane is `[data-cockpit-conversation]`, the input `[data-cockpit-input]`, the show line `[data-show-line]`. Runs on: the room under test and the fake agent, script `c1-render`; clock `real`.

### S-C1-47 Below the floor and in an old browser the board stays and says why (T77, D250)
Given the app on `#/map` at 640x900 with the cockpit configured,
Then `[data-talk]` and `[data-cockpit-open]` are absent and the board's phone shell is unchanged.
When the window grows to 1024x768,
Then both controls are drawn at §1.2's rects within 0.5 s and `data-pane="closed"`.
Given instead a page at 1368x912 where `'inert' in HTMLElement.prototype` is false,
When the owner taps `[data-cockpit-open]`,
Then the pane opens with its header and `[data-cockpit-unsupported]` reading
`This browser is too old for the cockpit. It needs Chrome 108 or Safari 16 or newer.`; there is no
input and no `[data-talk]`, and the room saw no link (the control API's `GET /connections`, `stand-ins.md` §1.2, has no
items).
Test: Playwright `setViewportSize` 640x900 then 1024x768, assert presence; a second context with
`addInitScript(() => { delete HTMLElement.prototype.inert })`, tap, read the text, count inputs,
`room.control('GET', '/connections')`.
Reads `data-pane` on the root, `[data-talk]`, `[data-cockpit-open]`, `[data-cockpit-unsupported]` and `[data-cockpit-input]`'s count. Runs on: the room under test and the fake agent, script `c1-render` (no turn played); clock `real`.

## 15. The demo (`?demo=1`, T36/T76/T93)

`docs/plans/product.md` rule 2: "A feature without demo data is not done, because the demo is how a
stranger meets it." The hosted demo is a static page with no board and no room (product.md §4), so
the cockpit brings its own: a **demo link**, a client-side stand-in for the room link that answers
with canned messages of `protocols.md` §2-§3 (D148).

**When the page uses it.** The URL's query has `demo=1` (`new URLSearchParams(location.search)
.get('demo') === '1'`; the hash route does not count) **and** there is no cockpit: the first of
- the board's first `/ws` frame says `"cockpit":false` (D93),
- the board's `/ws` closes or errors before its first frame (the static demo: nothing answers `/ws`),
- `DEMO_WAIT_MS` = 3 000 ms after load with no frame (D150).

With `"cockpit":true` the page uses the real room link as without `demo=1`: `?demo=1` on the
Wall is also its tour speed (Wall plan §3), and `c3-see.md` §10's harness runs `?demo=1` against a
paired room. Once on the demo link, the page stays on it until a reload. D17's "no cockpit, no
button" does not apply on the demo link (D17's exception).

**What the demo link never does**: open a WebSocket, call `fetch` or `XMLHttpRequest`, send
anything to `/api/cockpit/*` (`COCKPIT_PREFIX`), or show the pairing card. It lives in
`public/js/core/cockpit-demo.js` (pure: no DOM, no network; `createDemoLink({now, setTimeout})`
takes its clock and timers),
loaded with `import()` only when the page takes the demo link, so a normal page carries none of it.
Its link object has the same three calls as the real room link (`send(msg)`, `onMessage(cb)`,
`close()`); everything above the link (pane, conversation, renderer, tool lines) is the same code.

**What the screen shows** (differences from a live room only):

| Where | Demo |
| --- | --- |
| root | `data-cockpit="live"` and `data-cockpit-demo` (no value); `data-cockpit-layout` as stored (`screens.md` §1) |
| opener and talk button | `CHAT` in its rect (`screens.md` §4, pending Q-O11); no talk button: `welcome.config.stt` is `none` (`c2-voice.md` §9) |
| header | `COCKPIT`, 16 px later `DEMO` (16 px caps `--text-1`, 1 px `--line-strong` border, 28 px tall, 8 px padding left and right, `[data-cockpit-demo-label]`), 16 px later the turn state. The left part ends by x 1030 with `● STOPPING`; on the Wall `NEW` starts at x 1072 (from the right: `CLOSE` 1256-1352, `SCREEN` 1152-1248, `NEW` 1072-1144) |
| input placeholder | `Demo: type anything` (19 characters, one line at 21 per line, §7) |
| status line, line slot | never `room-down`, `unpaired` or `offline`: the demo link is never down |

**The link's messages.** On the page's `hello` it answers, 50 ms later:
- `welcome` with `screen:"demo"`, `epoch:"demo"`, `conversation:"c-demo"`, `resume:"snapshot"`,
  `config:{"stt":"none","languages":["en"],"maxPromptChars":8000}`, `status:null`, `now` from the
  page's clock (no skew line, ever);
- one `snapshot` (`parts:1`, `olderTurns:0`, `pins:[]`, `cards:[]`; the demo cards of `screens.md`
  S-SCR-10 join `cards` with the Canvas slice) holding the three canned turns below.

It numbers its own `seq` from 1. Each message it emits passes `protocols.md` §2.4's rules (S-C1-36's
unit test), so the demo cannot drift from the protocol.

**The canned conversation**, demo fleet facts as in `c3-see.md` §4 (all typed, `lang:null`,
`about:null`; times are the load time less 6, 4 and 2 min, cut to the minute):

| Turn | Prompt | Tool line | Reply |
| --- | --- | --- | --- |
| `t-demo-1` | `how did the night go?` | `read the Morning for tonight` | `■ One run is stuck: acme-billing on builder-b since 06:12, the same task failed twice.` / `■ docs on builder-a finished at 03:20, PR #39 green.` / `■ A question waits for you on builder-a: page size 20 or 50?` / `■ builder-c has sent nothing since 06:41.` (four paragraphs) |
| `t-demo-2` | `what is stuck?` | `looked at the runs` | a table `Run \| Host \| Since \| Why` with one row `acme-billing \| builder-b \| 06:12 \| same task`, then `T3 failed in rounds 3 and 4. It also asks you: Drop the v1 export?` |
| `t-demo-3` | `what did last night's run cost?` | `read the Morning for tonight` | `Last night cost 18.62 USD, 12.40 of it on acme-api. acme-billing alone: 4.40 USD in 4 rounds.` |

**Typing plays a demo turn.** A `prompt` gets an answer timed like `protocols.md` §10 from its 2.96 s
line on; `t` is seconds after the `prompt`:

| t (s) | Message |
| --- | --- |
| 0.10 | `turn.prompt` (new `turnId` `t-demo-<n>`, the prompt's `clientId`, `delivery:"new"`), `turn.state` `thinking` |
| 0.60 | `tool.start` (the matched row's tool; none for the no-match reply) |
| 1.10 | `tool.end`, `isError:false` |
| 1.30 | `turn.state` `answering`, then one `text.delta` per white-space-separated word (with the white space after it) every 60 ms |
| last delta + 0.10 | `text.block` |
| + 0.10 | `turn.end` `done` |

- **Matching**, case-insensitive substring of the prompt, first hit wins: `night` → turn 1's tool
  and reply, `stuck` → turn 2's, `cost` → turn 3's. Repeats are allowed. Anything else gets no tool
  line and the reply `This is the demo: it answers three questions. Try “how did the night go?”,
  “what is stuck?” or “what did last night's run cost?”. With a room of your own, the agent reads
  your own fleet (docs/cockpit.md).` The longest canned reply (turn 1, 43 words) ends `done` 4.0 s
  after the send.
- **A send during a demo turn** is steered as §8 says: the prompt shows `· QUEUED`, the link sends
  `prompt.taken` (`state:"taken"`, `atBlock` = the next block) at the next `text.block` (at once
  if the turn is still before its tool's end), and the turn plays that prompt's reply as one more
  text block before its `turn.end`.
- **`stop`**: `turn.end` `stopped` 200 ms later (never forced); a queued prompt becomes
  `cancelled` `why:"stopped"` (§8).
- **`new`**: `conversation.new` `reason:"owner"` 100 ms later; the empty conversation of §11 follows.
- `history`, `focus`, `hello` again: `history.turns` with `turns:[]`; `focus` is dropped; a second
  `hello` gets the same `welcome` and a `snapshot` of the conversation as it now is.
- No limits apply that need a room (E9 `too-many`, length beyond 8 000 characters is still the
  screen's own §7 rule).

### S-C1-36 The static demo: the pane opens on a canned conversation and typing plays a turn
Given `public/` served by a plain static server (nothing answers `/ws` or `/api/*`), 1368x912,
`page.clock` at 2026-10-27 07:00:00 local,
When the page loads `index.html?demo=1#/map`,
Then within 1 s of the `/ws` failure `data-cockpit="live"`, `data-cockpit-demo` is set and `CHAT` is
in its rect, with no talk button; a tap on `CHAT` opens the pane on three turns labelled
`YOU · 06:54`, `YOU · 06:56`, `YOU · 06:58`, the last reply in sight, the header reading
`COCKPIT`, `DEMO`, `READY`, and the input's placeholder `Demo: type anything`.
When the owner types `What is stuck?` and presses `Enter`,
Then `YOU · 07:00 · SENDING` shows, `· SENDING` is gone at t = 0.1 s, the header reads `● WORKING`,
a tool line `● looked at the runs…` shows by t = 0.6 s and ends at 1.1 s, the table streams in, and
by t = 5.0 s the header reads `READY` and the turn holds the table of turn 2.
When the owner sends `hello`, then 1.5 s later `STOP`,
Then the first gets the no-match reply's first words and ends with `STOPPED AT 07:00`; no tool line.
And: no request reached the server's log for `/api/cockpit/`, and the page made no WebSocket to
`/api/cockpit/ws` and no `fetch` from `cockpit-demo.js`.
Second case: the room under test with the fake agent, `hello.cockpit:true`, `?demo=1`: the pane
opens on the room's conversation, no `DEMO` label, no `data-cockpit-demo` (the real room wins).
Test: Playwright with `page.clock`; `page.on('websocket')` and `page.on('request')` collect every
socket and request; the static server's access log; texts of the label rows, the header and the
tool line; `placeholder`; `[data-cockpit-demo-label]` count 1, then 0 in the second case. And
`test/cockpit-demo.test.mjs` in `npm test`: drives `createDemoLink({now, setTimeout})` with a fake
clock through `hello`, the three matches, a no-match, a mid-turn send and a `stop`, and checks every
emitted message with `protocols.md` §9's fixture checker and its `seq` running 1, 2, 3, ….
Runs on: first case no stand-in, `public/` on a plain static server; second case the room under test and the fake agent, script `c1-render` (no turn played); clock `page`.

## 16. Times at a glance (T133, D287)

Every time C1 uses, in one table: a reader looking up "how long until …" starts here. The section
in the **Where** column owns the value; this table only points at it, and when the two differ the
section wins and this table is a bug. Names in the **Constant** column are the names in
`public/js/core/cockpit-constants.js` (D150), which the room imports too (D287); `B<n>` is a speed
budget (`README.md` "Speed budget"), measured, not a constant. "Clock" says whose clock counts:
the screen's (`page.clock` in tests) or the room's (`server/cockpit/clock.mjs`, the fake clock).

| Value | Constant | What | Clock | Where | D | Asserted by |
| --- | --- | --- | --- | --- | --- | --- |
| 120 ms | `PANE_SLIDE_MS = 120` | the pane slides in and out (`--ease`); 0 ms with reduced motion | screen | §2, `docs/design.md` rule 5 | — | S-C1-01 (`transition-duration`), S-C1-12 (0 ms) |
| ≤ 0.2 s | B7 | tap on the opener or press on the talk button → pane in place | screen | §2 | — | S-C1-01 |
| 300 s | `PANE_IDLE_S = 300` | the pane closes itself with no touch; not in a column, never during a turn | screen | §1, §2, `screens.md` §2 | D5 | S-SCR-04, S-C2-06 |
| ≤ 0.1 s | B8 | `SEND` → prompt block drawn, `data-turn="thinking"` | screen | §7 | — | S-C1-14 |
| 5 s | `CONFIRM_WAIT_MS = 5000` | no `turn.prompt` echo since the send, link up → E1 `NOT SENT` | screen | §7, §10 E1 | D31 | S-C1-18 |
| ≤ 0.5 s | B4 | the room sends the turn's first `text.delta` (`sentAt`) → that text drawn | room → screen | §3 | D288 | S-C1-04 |
| 3 s | `AGE_FROM_MS = 3000` | a turn's age shows in its label row; the `AGENT · HH:MM` row comes by then even with no item | screen (offset by `welcome.now`) | §3, §5.1, §9 | D35, D235 | S-C1-21 (none at 2.9 s, `0:03` at 3 s) |
| 1 s | `TICK_MS = 1000` | every counter on the screen is redrawn: the turn's age, `since … (age)` in status lines | screen | §9, §10.1, `README.md` "Times on the screen" | D232 | S-C1-21 (`0:12` at 12 s); the status line's age: no scenario, gap (T141) |
| within 1 s | — | a page loaded mid-turn shows the same age as the others | screen | §9 | D235 | no scenario, gap (T141) |
| 0.5 s | — | after a `SEND` during a turn the label reads `· QUEUED` (the echo with `delivery:"queued"`) | screen | §8 | D121, D122 | S-C1-16 (by 2.5 s for a 2.0 s tap), S-C1-28 |
| 1.0 s | `STOP_GUARD_MS = 1000` | after a send or a microphone close the slot shows `wait` or blank, not `STOP` | screen | §8 | D268 | S-C1-16 (`wait` 2.0-3.0 s, `■ STOP` at 3.0 s), S-C2-09 |
| ≤ 0.1 s | — | `prompt.taken` `taken` → `· QUEUED` gone, the block at `atBlock` | screen | §8 | D122, D258 | S-C1-16 (tool ends 4.0 s, gone by 4.1 s) |
| 10 s | `QUEUED_RESEND_MS = 10000` | a queued prompt not taken 10 s after its turn's `turn.end` is written once more (new UUID) | room | §8, `protocols.md` §3.4 | D123 | S-C1-28 (resend at 13 s) |
| 10 s | `QUEUED_RESEND_MS` | the resend not taken within 10 s → `prompt.taken` `cancelled` `not-taken`, `The agent did not read this.` | room | §8 | D123 | S-C1-28 (`NOT SENT` at 23 s) |
| ≤ 0.1 s | — | `STOP` `pointerup` → `data-turn="stopping"`, `● STOPPING` | screen | §8 | — | S-C1-17 |
| 5.0 s | `STOP_FORCE_MS = 5000` | no `turn.end` since the `STOP` → `SIGINT`, `turn.end` `forced:true`, `STOPPED AT HH:MM (FORCED)` | room | §8, `protocols.md` §11.6 | D32, D262 | S-C1-17, `protocols.md` §13 stop test |
| 5.5 s | — | `READY` after a `STOP`, forced or not | screen | §8 | D32 | S-C1-17 |
| 8.0 s | `STOP_TERM_MS = 8000` | still no `result` after the `SIGINT` → `SIGTERM`, then `--resume`; no status line | room | `protocols.md` §11.6 | D103 | `protocols.md` §13 stop test (S-C1-17 asserts none follows when the `SIGINT` ends the turn) |
| 10.0 s | `STOP_KILL_MS = 10000` | the child still runs → `SIGKILL`, the room closes its pipes | room | `protocols.md` §11.6 | D283 | no scenario: the stop test's child exits at the `SIGTERM`; gap (T141) |
| 10 s | `HEARTBEAT_MS = 10000` | the room's heartbeat on every link | room | §5.1, §9, `screens.md` §7 | D10 | no scenario of its own; it matters through the 25 s silence below (T141) |
| 25 s | `LINK_SILENCE_MS = 25000` | no frame for 25 s → the link counts as lost (then the 5 s grace) | screen | §5.1, `screens.md` §7, `protocols.md` §2.2 | D10, D139 | no scenario: every outage test closes the link (`POST /link`); gap (T141) |
| 5 s | `LINK_GRACE_MS = 5000` | a lost link shows on screen only after 5 s; back within 5 s shows nothing | screen | `screens.md` §7 | D10 | S-SCR-17 (nothing at 4.9 s), S-SCR-18, S-C1-38 |
| 500 ms × 1.8, ≤ 15 s | `BACKOFF_START_MS`, `BACKOFF_FACTOR`, `BACKOFF_MAX_MS` (`net.js`) | the room link's tries: 0.9, 1.62, 2.916, 5.2488, 9.44784 s apart, then every 15 s; `Retrying in {n} s.` rounds up | screen | `screens.md` §7.1 | D11, D263 | S-SCR-19 |
| 5 s | `SNAPSHOT_WAIT_MS = 5000` | no snapshot 5 s after the load → `room-down` and its status line | screen | §5.1 | D118 | S-C1-26 |
| 10 per 60 s | `RATE_MAX = 10`, `RATE_WINDOW_MS = 60000` | prompts per device token; the 11th is refused (E9) | room | §7 "Rate", §12 | D228 | S-C1-43 |
| 60 s | `RETRY_WAIT_MS = 60000` | E9's `RETRY` stays disabled from the refusal's drawing | screen | §10 E9 | D264 | S-C1-43 (disabled after 59 s, enabled after 60 s) |
| 0, 2, 4, 8, 16, 30 s, then every 30 s | `RESTART_STEPS_S = [0, 2, 4, 8, 16, 30]` | the room restarts an agent that exited outside a stop (E2, E3's `every 30 s` is the last step) | room | §10 E2, E3, `protocols.md` §11.7 | D289 | `protocols.md` §13 restart test (0, 2, 4 s), S-C1-38 second case; the 8-30 s steps: no scenario, gap (T141) |
| 30 s | `READY_WAIT_MS = 30000` | no `ready` 30 s after a spawn → a failed start | room | `protocols.md` §11.7 | — | no scenario, gap (T141) |
| 10 s | — | two `--resume` starts that exit before `ready` within 10 s → forced fresh start (§11's second divider) | room | §11, `protocols.md` §11.7 | — | `protocols.md` §13 restart test |
| 900 s, 60 s | `LOGIN_CHECK_S = 900`, `LOGIN_RECHECK_S = 60` | the agent's login check; every 60 s while logged out; the line goes ≤ 60 s after a login | room | §10.1, `protocols.md` §11.10 | D151, D153 | S-C1-37 |
| 5 s | `NEWS_MS = 5000` | `The agent is back (HH:MM). …` (row 7) shows, then goes | screen | §10.1 | D152 | no scenario for the 5 s: S-C1-39 asserts the line, not its end; gap (T141) |
| 5 s | `NEWS_MS` | `Back since HH:MM.` (row 8) shows, then goes | screen | §10.1, `screens.md` §7 | D152 | S-C1-38 third case (5 s ± 0.2 s), S-SCR-19 |
| 10 s | `NEWBAR_MS = 10000` | the `NEW` bar with no tap hides, nothing changes | screen | §11 | D36 | S-C1-22 |
| 5 s | `STOP_FORCE_MS` | `START` with a turn running: the stop first, forced after 5 s | room | §11, §8 | D36 | S-C1-22 (turn idle there); forced case: S-C1-17 |
| 5 s | — | `new`: stdin closed, `SIGTERM` after 5 s without exit, then the new session | room | `protocols.md` §11.7 | — | no scenario: the fake agent exits on a closed stdin; gap (T141) |
| ≤ 0.5 s | — | the `NEW CONVERSATION` divider on every screen after the new session started | screen | §11 | — | S-C1-22 |
| 30 days | — | the old conversation kept on the room | room | §11, `protocols.md` §11.7.1 | pending Q-O24 | `protocols.md` §13 store test (a 31-day-old turn gone) |
| ≤ 0.5 s | — | a prompt sent at screen A drawn on screen B after the room has it; reply text within B4 | room → screen | §12 | D269 | S-C1-23 |
| 3 s | `DEMO_WAIT_MS = 3000` | `?demo=1` with no board frame for 3 s draws the demo cockpit | screen | §15 | D148, D150 | no scenario for the 3 s: S-C1-36 loads with `"cockpit":false`; gap (T141) |
| 5 s | `HINT_MS = 5000` | a talk hint's longest show (§1.1's line slot) | screen | `c2-voice.md` §4 | D45, D291 | `c2-voice.md` §15 (S-C2-05, S-C2-07, S-C2-11) |

Not times, and so not here: the 8 px tap slop (`TAP_SLOP_TOUCH`, §8), the 120 px keyboard
threshold (§7.1), the 50 turns drawn and 3 `history` asks (§2.1, D27).
