# Screens and modes

What a screen shows and how it moves between tour, explore and canvas; one screen or two; where the
cockpit button sits (§1-§5, part 1); how a screen pairs and what it shows when something it needs
is unpaired, offline or down (§6-§8, part 2). Words as in the glossary (`README.md`). Sizes are CSS
px at 1368x912; times in s.

## 1. Layouts (pending Q-O22)

**Until the Canvas slice** (pending Q-O22, recommendation b); `slices.md` §3.5): the Wall page has
one layout, `wall`. No canvas, no `split`, `canvas` or `switch`, no `SCREEN` sheet, no
`cockpit.layout`, no switch button; the root reads `data-cockpit-layout="wall"` whatever the width, `?layout=`
is ignored, and the pane slides over the Wall as on the app (`c1-talk.md` §1, first table row).
C1-C3 build this. The rest of this section, S-SCR-01, -06, -07, -08, -10, -11 and D2, D3, D8, D9
arrive with the Canvas slice. With Q-O22 a) they are C1's from the first night: `split` is the
default at ≥ 1280 px and the canvas shows S-SCR-10's empty text until C4 places cards; which ids C1
then contains is `slices.md` §3.1.

A screen runs one of two pages:

- **The Wall page** (Wall plan D1, `origin/plan/wall`): the cockpit's home. It has a **layout**,
  one of four (D2):

| Layout | What the screen shows | Default when |
| --- | --- | --- |
| `wall` | tour ⇄ explore, full screen | never by default; the owner picks it for a screen 1 |
| `canvas` | the canvas, full screen | never by default; the owner picks it for a screen 2 |
| `split` | wall half left (all width minus 608 px), canvas right (608 px), a 1 px `--line` between | the screen is ≥ 1280 px wide (pending Q-O9) |
| `switch` | one half at a time, full screen, a switch button flips them | the screen is < 1280 px wide (pending Q-O9) |

- **The app** (`public/index.html`, the views Map, Board, Inbox, Morning, Runs, …): unchanged,
  plus the cockpit button (§4). The app has no canvas and no tour; its views are not modes.

At 1368x912 `split` gives a wall half of 759 px and a canvas of 608 px (1368 = 759 + 1 + 608). At
1920x1080: 1311 + 1 + 608. The canvas keeps 608 px so the card grid (`c4-show-canvas.md` §7.1) has one fixed size.

**Choosing the layout.** Three ways, the first that is set wins:
1. The URL: `?layout=wall|canvas|split|switch` on the Wall page (a kiosk's start URL). Any other
   value is ignored.
2. The screen's own choice: the **SCREEN** button `[data-cockpit-screen]` in the pane or column
   header (`c1-talk.md` §1) opens the **`SCREEN` sheet** `[data-screen-sheet]` with four layout
   rows `[data-layout-choice="wall|canvas|split|switch"]` (`WALL`, `CANVAS`, `SPLIT`, `SWITCH`) and
   a fifth, `CANCEL` `[data-screen-cancel]`; the current layout's row has the 1 px accent border
   (`docs/design.md` rule 3) and `aria-current="true"`. A tap on a layout row applies it at once
   (no reload), closes the sheet and stores it on the screen in `localStorage` key `cockpit.layout`
   (D3). The sheet's rect and how it closes: §4.1 (D157).
3. The default by width, in the table above.

`split` on a screen < 1280 px wide shows as `switch` until the screen is wide again; the stored
choice stays `split`.

The page root carries the state for tests and CSS: `data-cockpit-layout` (`wall|canvas|split|switch`, the
one in effect), `data-wall-state` (`tour|explore`, absent in `canvas`), and in `switch`
`data-switch-shows` (`wall|canvas`). The page root is `<html>`; the name is not `data-layout`,
which `public/js/ui/shell.js` `applyLayout()` already sets there to `phone|tablet|desktop` (D145).
Every attribute and its values: `README.md` §"Selectors tests use".

## 2. Modes on the wall half

The wall half is the Wall: tour and explore as the Wall plan defines them (D4: "Idle: tour. Touch:
the camera goes where the finger says, a detail sheet in big type, back gesture; one minute
without touch: the tour resumes"). The cockpit adds three things that hold the tour back (D4 here):

| What happens | Wall state | Idle timer (60 s) |
| --- | --- | --- |
| a touch anywhere on the wall half | tour → explore, or stays explore | restarts at 60 s |
| a touch on the canvas half or the pane | unchanged | restarts at 60 s if explore |
| the pane opens (cockpit button, "Ask about this") | tour → explore **where the camera is now**: the tour stops mid-flight and holds that frame | paused while the pane is open |
| a turn is running (prompt sent, reply streaming) or the microphone is open | unchanged | paused until it ends, then restarts at 60 s |
| a show command that moves the camera arrives (`fly_to`, `highlight`, `compare`, `scrub`; T10) | tour → explore at the target | restarts at 60 s when the command's movement ends (`c4-show-canvas.md` §2) |
| the pane closes | unchanged | restarts at 60 s |
| the timer reaches 0 | explore → tour; the tour starts with the overview (Wall plan §3, ~20 s) | stopped |

The pane closes on its own after **300 s** with no touch, no running turn and the microphone
closed (D5). The conversation and a typed draft stay; the next open shows them unchanged.

The numbers (60 s, 300 s, 1280 px, 608 px) are named constants in one client module, so the owner
changes them in one place (D6).

**The canvas never idles.** Nothing on it moves or leaves because nobody touched the screen; cards
leave by the rules of T11/T12 (pending Q-O4).

**Reduced motion** (`prefers-reduced-motion: reduce`): the tour is the Wall plan's D5 (overview,
slow caption rotation, no flights); explore and show commands jump to the target with no flight;
the idle rules above stay the same.

### 2.1 A speak-up on a touring screen (pending Q-O11, D219)

A raised block (`coworker.md` §3.2) reaches every screen as the room's `speakup` message. The room
sends no camera move for it (`coworker.md` §3.4); each screen decides on its own:

- **When.** The block's tier is `needs-you` or `urgent` (an `urgent` block in quiet hours too: it
  is raised, only its chime is dropped, `coworker.md` §4); that screen draws a camera now (`wall`,
  `split`, `switch` while the wall shows); and its wall state is `tour`. A screen in `explore` (the
  owner's finger, the pane open, a show command) keeps its camera: the dot on the talk button is
  enough there.
- **Where.** The block's items, P1 first, then in their order in `items`; the first whose `target`,
  else whose `builder`, is a node on that screen's Map. None (a `reminder`, a `job`, a target the
  Map does not draw): the tour goes on unchanged.
- **The flight.** Within 0.3 s of the message (B5's bound, `README.md` speed budget) the tour stops
  mid-flight, the root reads `data-wall-state="explore"` and `data-wall-hold="speakup"`, and the
  camera flies with `flyTo(id)` (the Map's `flight()`, 320-900 ms by distance, zoom 1.9, centred in
  the wall half, `c4-show-canvas.md` §2-§3.1). Reduced motion: it jumps in one frame.
- **The hold.** When the flight ends the idle timer starts at **300 s** (`SPEAKUP_HOLD`, one of
  D6's named constants) instead of 60 s. At 0 the tour resumes with the overview and
  `data-wall-hold` goes. The talk button's dot stays until the pane opens (`coworker.md` §3.4).
- **What ends it early.** A touch on the wall half: `data-wall-hold` goes and §2's 60 s rule
  applies. The pane opening: `data-wall-hold` goes and the timer is paused as in §2. A newer
  `needs-you` or `urgent` block during the hold: the camera flies to its node and the 300 s start again.
- **What it leaves.** No conversation line, no `UNDO`, no marks: it is the screen's, not the
  agent's (the agent's own show commands are `c4-show-canvas.md`'s). The node draws its trouble as
  the Wall always does (status colour and shape). A reload drops the hold; the tour starts as usual.
- **What it needs.** `flyTo(id)`, a node lookup and the idle hook of the Wall contract (T31). The
  Speak slice builds them if the Show slice has not (`slices.md` §3.4).

## 3. One screen or two

- **One screen** gets both: `split` side by side, or `switch` (`spec-input.md` §2: "A user with one
  screen gets both, split or switching"). One 1368x912 tablet in `split` is the main path: every
  scenario that does not name another size or layout runs there.
- **Two screens**: screen 1 runs `wall` ("Idles on the Wall: it tours the fleet, flies to
  trouble"), screen 2 runs `canvas` ("Where the owner talks to the agent and the agent shows
  things"); `spec-input.md` §2 names these roles, not a count. Both show the same conversation
  (plan §2). How many screens the owner has today is asked in Q-O9.
- **More screens**: each picks its layout; any screen can be tour, explore or canvas.

Where things land:
- A card the agent places on the canvas appears on **every** screen whose layout has a canvas
  (`canvas`, `split`, `switch`). Same cards, same order on each (the grid and the shelf: `c4-show-canvas.md` §7).
- A camera show command moves the wall half of every online screen with a camera, or the one it
  names (`c4-show-canvas.md` §1, D67). A screen in
  `canvas` layout has no camera and ignores them; the conversation line still appears.
- In `split`, `canvas` and `switch` the conversation is a fixed column of the canvas, never a pane
  over the wall half or over the cards, so the camera the agent moves and the cards it places both
  stay in sight (plan C1: "so the agent can point at the view behind it"; D117, pending Q-O12; rects
  in `c1-talk.md` §1). In `switch` a tap on `CHAT` or a press on the talk button on the wall half
  flips the screen to the canvas.
- A job's countdown card has `CANCEL JOB`; the tap opens the confirm card (`c5-c6.md`) with what,
  where and when, and nothing is cancelled before its yes; each cancel is one audit line. Removing
  a card (`✕`) never stops a job (`c4-show-canvas.md` §8.1; `spec-input.md` §6: "Anything that
  changes state shows a confirm on the screen; every action is logged").
- In `switch`, a card that arrives while the wall is shown does **not** flip the screen. The switch
  button shows a count instead (S-SCR-07).

## 4. The cockpit button (pending Q-O11)

The **cockpit button** is two controls in the bottom-right corner, at the **same two rects on every
page, layout and pane state** (D116), so the finger finds them without looking:

| Control | Selector | Rect at 1368x912 | Offsets from the viewport's bottom-right corner | What a press does |
| --- | --- | --- | --- | --- |
| **talk button** | `[data-talk]` | x 1280-1344, y 824-888 (64x64) | `right: 24px; bottom: 24px` | listens at once and opens the pane with the live words (`c2-voice.md` §1-§2) |
| **`CHAT`** | `[data-cockpit-open]` | x 1288-1336, y 760-808 (48x48) | `right: 32px; bottom: 104px` (centred above the talk button, 16 px between) | pane closed: opens it for typing and reading; pane open: closes it (`c1-talk.md` §2) |

- The talk button is one element: with the pane closed it floats in the corner; with the pane open
  it is the right end of the input row (`c1-talk.md` §1), in the same rect. Its look and states
  are `c2-voice.md` §1, §3.
- `CHAT`: 16 px `--font-label` caps, `--text-1` on `--bg-elevated`, 1 px `--line-strong` border.
  While the pane is open it stays in its rect and reads `CLOSE` (`aria-label="Close the cockpit"`);
  `CLOSE` in the pane header (`c1-talk.md` §1) stays as the second way out. The way out is where
  the hand already is (review 31 finding 5).
- Above the input row, the rect x 1288-1336, y 760-808 is `CHAT`'s. Anything else drawn
  in the band above the input row (the line slot, the context chip `c3-see.md` §9, `↓ NEW`) ends at
  x ≤ 1264, 24 px left of it; `c1-talk.md` §1.1 stacks them (D133).
- Both sit above the page (`z-index` 35, between `--z-tape` 30 and `--z-sheet` 40).
- With Q-O11 b) the talk button inside the pane is the only talk button; in its rect, with the pane
  closed, the page draws D7's `AGENT` (64x64, opens the pane) and there is no `CHAT`.
- With `cockpit.stt.url: none` there is no talk button (`c2-voice.md` §9): `CHAT` keeps its rect,
  and `SEND` takes the talk button's rect once the pane is open.

Per page, what else changes:

| Where | The rest of the page |
| --- | --- |
| Wall page, `wall` | The Wall's bottom-right status lines end at x 1256, 24 px left of the talk button. |
| Wall page, `split` and `canvas` | The talk button sits in the conversation column's input row (x 760-1368, `c1-talk.md` §1, D78), never over the card area. There is no `CHAT`: the column is always there (D117, pending Q-O12); its rect belongs to the conversation. In `split` the wall half keeps its status lines at the divider. |
| Wall page, `switch` | The talk button on both halves; `CHAT` only while the wall shows (it flips to the canvas). The switch button sits left of the talk button, x 1200-1264, y 824-888, while the wall shows; while the canvas shows it is a header button of the column, x 992-1064, y 8-56 (D156), and `SEND` has the rect it left. The Wall's bottom-right status lines end at x 1176, 24 px left of it. §4.1 has the whole cluster per state. |
| App, every view in `VIEWS` (`public/js/core/router.js`) | The talk button's bottom edge sits on the top edge of the bottom bar (`footer.shell-bar`, `--tape-h` 24 px, y 888-912); nothing of the bar is covered. The toast stack (`.toasts`, `public/css/components.css`) moves up while the cockpit is configured: its bottom edge at y 736 (`bottom: 176px`), 24 px above `CHAT`; while the pane is open it moves left of the pane (`right: 624px`, D158). |

The **switch button** `[data-cockpit-switch]` (only in `switch`): while the wall shows, 64x64 px
in the corner cluster, label `CANVAS`, 16 px caps; a count of cards that arrived since the canvas
was last shown sits in its top-right corner, inside its rect and not tappable on its own:
`[data-switch-count]`, `--fs-16` mono, `--text-1`, on `--bg-sunken`, e.g. `2`. It is grey: a new
card is news, not trouble (`docs/design.md`, the colour rule). While the canvas shows it is a
header button of the column, 72x48 px like `NEW`, label `WALL`, with no count (the canvas is in
sight, so the count is 0) (D156).

The cockpit button exists only where the cockpit is configured (`hello.cockpit:true`,
`protocols.md` §1, D17, D93). Without it neither control is rendered, and nothing else changes: the
board works as today. A tap on either control changes no route: the hash stays as it was (the
router's rule that a route only selects, `router.js` header).

### 4.1 The bottom-right cluster, per state (T44)

Every control near the bottom-right corner, and the header buttons that share the pane's right
edge, in each state, at 1368x912 (keyboard rows at 1368x532). Rects are `x left-right, y top-bottom`
in CSS px; at other sizes each keeps its offsets from the viewport's right and bottom edges (the
header's from the right and top). "Tappable" rows are what the no-overlap test checks; text rows
are there so nothing tappable is drawn over them. With a one-line input; a taller input (`c1-talk.md`
§7) moves the line slot, chip row and `↓ NEW` up with the row's top edge, nothing else.

| State | Control | Selector | Tappable | Rect |
| --- | --- | --- | --- | --- |
| **A. App, pane closed** (every view) | talk button | `[data-talk]` | yes | 1280-1344, 824-888 |
| | `CHAT` | `[data-cockpit-open]` | yes | 1288-1336, 760-808 |
| | toast stack | `.toasts` | its toasts' buttons | right edge x 1356, bottom y 736 |
| | bottom bar | `footer.shell-bar` | as today | y 888-912, not covered |
| **B. App, pane open** (pane x 760-1368, y 36-888) | `CLOSE` (header) | `[data-cockpit-close]` | yes | 1256-1352, 44-92 |
| | `NEW` (header) | `[data-cockpit-new]` | yes | 1176-1248, 44-92 |
| | the stack above the row | `[data-cockpit-line]`, `[data-cockpit-chip-remove]`, `[data-cockpit-follow]` | chip `✕` and `↓ NEW` | `c1-talk.md` §1.1's table (row top y 808), all ending at x ≤ 1264 |
| | `CLOSE` (the opener) | `[data-cockpit-open]` | yes | 1288-1336, 760-808 |
| | language button (a language list only) | `[data-talk-lang]` | yes | 784-848, 824-888 |
| | `CANCEL` (microphone open), then `UNDO` (5 s after a cancel), in place of the language button | `[data-talk-cancel]`, `[data-talk-undo]` | yes | 784-848, 824-888 |
| | input | `[data-cockpit-input]` | yes | 784-1184 (864-1184 with the language button, and while `CANCEL` or `UNDO` shows), 824-888 |
| | `SEND` | `[data-cockpit-send]` | yes, but blank and `inert` while the microphone is open (D42) | 1200-1264, 824-888 |
| | talk button | `[data-talk]` | yes | 1280-1344, 824-888 |
| | toast stack | `.toasts` | its toasts' buttons | right edge x 744 (`right: 624px`, 16 px left of the pane), bottom y 736 (D158) |
| **C. Wall page, `wall`, pane closed** | talk button, `CHAT` | as A | yes | as A |
| | the Wall's status lines | the Wall's | no | end at x ≤ 1256 |
| | away caption (room down only, §7) | `[data-cockpit-away]` | no | right edge 1336, y 720-752 |
| **D. Wall page, `wall`, pane open** (pane x 760-1368, y 0-912) | `CLOSE` (header) | `[data-cockpit-close]` | yes | 1256-1352, 8-56 |
| | `SCREEN` (header, from the Canvas slice) | `[data-cockpit-screen]` | yes | 1152-1248, 8-56 |
| | `NEW` (header) | `[data-cockpit-new]` | yes | 1072-1144, 8-56 with `SCREEN`; 1176-1248, 8-56 before the Canvas slice |
| | stack, opener, language button or `CANCEL`/`UNDO`, input, `SEND`, talk button | as B | yes | as B |
| **E. Column, `canvas`** (and `switch` showing the canvas; column x 760-1368, y 0-912) | `SCREEN` | `[data-cockpit-screen]` | yes | 1256-1352, 8-56 |
| | `NEW` | `[data-cockpit-new]` | yes | 1176-1248, 8-56 |
| | `SHELF n` (with a shelf) | `[data-shelf]` | yes | 1072-1168, 8-56 |
| | `WALL` (switch button, `switch` only) | `[data-cockpit-switch]` | yes | 992-1064, 8-56 (D156) |
| | stack, language button, input, `SEND`, talk button | as B | yes | as B; no opener: x 1288-1336, y 760-808 is the conversation's (D117) |
| **F. Column, `split`** (column x 760-1368, y 520-912) | `SCREEN`, `NEW`, `SHELF n` | as E | yes | E's x, y 528-576 |
| | stack, language button, input, `SEND`, talk button | as B | yes | as B |
| **G. `switch`, wall shown** | talk button, `CHAT` | as A | yes | as A |
| | `CANVAS` (switch button) with its count | `[data-cockpit-switch]`, `[data-switch-count]` | the button | 1200-1264, 824-888 |
| | the Wall's status lines | the Wall's | no | end at x ≤ 1176 |
| | away caption (room down only, §7) | `[data-cockpit-away]` | no | as C |
| **H. Keyboard up, pane** (D or B; 1368x532, conversation y 0-532, `c1-talk.md` §7.1) | header buttons | as D (B in the app: `CLOSE`, `NEW` at B's x) | yes | D's x, 8-56 |
| | the stack | as B | chip `✕` and `↓ NEW` | §1.1's table with the row top at y 444 |
| | `CLOSE` (the opener) | `[data-cockpit-open]` | yes | 1288-1336, 396-444 |
| | language button, input, `SEND`, talk button | as B | yes | B's x, 460-524 |
| **I. Keyboard up, column** (E or F; conversation y 0-532) | header buttons | as E | yes | E's x, 8-56 |
| | stack, language button, input, `SEND`, talk button | as H | yes | as H; no opener |

- **With `cockpit.stt.url: none`** (no voice, `c2-voice.md` §9, S-C2-14): no talk button and no
  language button in any state; `SEND` takes x 1280-1344 at the talk button's y, the input runs
  from x 784 to x 1264. In A, C and G `CHAT` (and in G the switch button) keep their rects.
- **The gaps this gives**, smallest first: 8 px between header buttons; 16 px between the opener
  and the talk button (y) and between the opener and `SEND` (y, with 24 px in x); 16 px between
  input, `SEND` and the talk button, and between the switch button and the talk button; 24 px
  between the stack and the opener or the talk button (x). No two tappables in one state intersect
  and none are closer than 8 px.
- The chip itself (`[data-cockpit-chip]`) is not tappable apart from its `✕`; the line slot is text.

**The `SCREEN` sheet** `[data-screen-sheet]` (D157), drawn in the first frame after the tap, no
animation; the rows copy `c3-see.md` §9.3's menu:

| Part | Size | Look |
| --- | --- | --- |
| box | 288 px wide, 322 px tall (five 64 px rows and a 1 px border), right edge on `SCREEN`'s right edge | `--bg-elevated`, 1 px `--line-strong` border, `z-index` 40 (`--z-sheet`) |
| `WALL`, `CANVAS`, `SPLIT`, `SWITCH` | 64 px tall, full width, 1 px `--line` between rows | `[data-layout-choice]`, 18 px caps `--text-1`; the current one 1 px accent border |
| `CANCEL` | 64 px tall, full width, 1 px `--line` top | `[data-screen-cancel]`, 18 px caps `--text-2` |

- **Position.** Its top 8 px under the header's bottom edge when that leaves its bottom ≥ 16 px
  above the visible bottom; else its bottom 8 px above the header's top edge. At 1368x912:
  `canvas` x 1064-1352, y 72-394; `wall` pane x 960-1248, y 72-394; `split` x 1064-1352,
  y 190-512 (above the column, over the card area); keyboard up (1368x532) y 72-394 in every layout.
- **It closes** on a layout row (after applying it), `CANCEL`, a second tap on `SCREEN`, a tap
  anywhere outside it (that tap does nothing else: no card, node, tool line or blur acts on it),
  `Esc`, or 10 s without a touch. Nothing changes but the sheet going.
- It is inside `[data-cockpit-conversation]`, so with the keyboard up a tap on it keeps the input's
  focus (`c1-talk.md` §7.1, D132); applying a layout keeps the draft and the focus.

## 5. Scenarios

### S-SCR-01 A fresh screen at the owner's size opens in split (pending Q-O22)
Given a browser at 1368x912 with no `cockpit.layout` stored and no `?layout=` in the URL,
When it opens the Wall page on the demo fleet,
Then within 2 s the root has `data-cockpit-layout="split"` and `data-wall-state="tour"`; the wall half is
759 px wide, the canvas 608 px, with a 1 px divider at x = 759; the tour is flying on the left; the
canvas shows its cards or its empty state (S-SCR-10); the talk button `[data-talk]` is at
x 1280-1344, y 824-888 and `[data-cockpit-open]` reads `CHAT` at x 1288-1336, y 760-808 (§4,
pending Q-O11).
Test: Playwright at 1368x912 against the demo hub and the fake agent; read `data-cockpit-layout`,
`getBoundingClientRect()` of the two halves, of `[data-talk]` and of `[data-cockpit-open]`.

### S-SCR-02 A tap leaves the tour, a minute alone brings it back
Given a screen in `wall` layout touring the demo fleet,
When the owner taps an empty spot of the wall at t = 0 s and then touches nothing,
Then at t ≤ 0.2 s `data-wall-state="explore"` and the tour's flight has stopped; at t = 59 s it is
still `explore`; at t = 60 s it is `tour` and the overview starts.
And a second tap at t = 40 s moves the return to t = 100 s.
Test: Playwright with `page.clock.install()`; tap, `page.clock.fastForward()` to 59 s, 60 s;
assert `data-wall-state` at each step; second run taps again at 40 s and checks 99 s / 100 s.

### S-SCR-03 Opening the pane stops the tour where it is and holds it
Given a screen in `wall` layout, the tour mid-flight to site `hv1`,
When the owner taps `CHAT` at t = 0 s and leaves the pane open, touching nothing,
Then the pane opens (its slide is T4's), `data-wall-state="explore"`, the camera holds the frame
it had at the tap (the camera position changes by < 1 px between t = 0.2 s and t = 299 s), and at
t = 120 s it is still `explore`, because the idle timer is paused while the pane is open.
When the owner taps `[data-cockpit-open]`, now reading `CLOSE`, at t = 130 s,
Then the tour resumes at t = 190 s.
Test: Playwright with a fake clock; read the camera through the Map's `screenOf(id)` for one node
at 0.2 s and 120 s; tap `[data-cockpit-open]`; fast-forward 59 s (`explore`) and 60 s (`tour`).

### S-SCR-04 The pane closes itself after five idle minutes, never during a turn
Given a screen in `wall` layout with the pane open and the fake agent scripted to stream a reply
for 400 s,
When the owner sends a typed prompt at t = 0 s and touches nothing,
Then the pane is still open at t = 400 s (a turn is running); the turn ends at t = 400 s; the pane
closes at t = 700 s (300 s later); the tour resumes at t = 760 s (60 s after the close).
And a draft typed into the input before the close is in the input again when the pane reopens.
Test: Playwright with a fake clock and a fake-agent script with one long turn; assert the pane's
`data-pane` (`open`, then `closed`) and `data-wall-state` at 699/700 s and 759/760 s; reopen and read the input value.

### S-SCR-05 A show command takes the camera, then the tour comes back
Given a screen in `wall` layout touring, the pane closed,
When the fake agent sends `fly_to` for node `builder-a` at t = 0 s,
Then `data-wall-state="explore"`, the camera flies to `builder-a` (320-900 ms, `c4-show-canvas.md` §2, D68), and the idle
timer restarts when the flight ends at t = f s; the tour resumes at t = f + 60 s.
And a screen in `canvas` layout receiving the same command does not change.
Test: Playwright, two pages on one fake agent; read `data-wall-state` and `screenOf('builder-a')`
near the screen centre on the `wall` page; the `canvas` page's DOM is unchanged.

### S-SCR-06 The owner picks a layout, it survives a reload, the URL wins over it (pending Q-O22)
Given a screen at 1368x912 in `split`, `[data-cockpit-conversation]` at x 760-1368, y 520-912,
When the owner taps `SCREEN` in the column's header (x 1256-1352, y 528-576), then `CANVAS`,
Then within 0.2 s `data-cockpit-layout="canvas"`, the wall half is gone, the canvas fills 1368x912,
`data-pane="column"`, `[data-cockpit-conversation]` is at x 760-1368, y 0-912 with its scroll
position and draft unchanged, and `localStorage['cockpit.layout']` is `canvas`.
When the owner taps `SCREEN` again, the sheet `[data-screen-sheet]` shows at x 1064-1352, y 72-394
with five rows, `CANVAS` marked current; then taps `CANCEL`,
Then the sheet is gone within 0.1 s and the layout is still `canvas`.
When the owner opens the sheet again and taps the card area at (400, 300), outside it,
Then the sheet is gone and nothing else happened (`data-cockpit-layout` still `canvas`).
When the page reloads, it is still `canvas`.
When it is opened with `?layout=wall`, it is `wall`, `data-pane="closed"`, `[data-cockpit-open]`
reads `CHAT`, and `cockpit.layout` is still `canvas`.
Test: Playwright with `hasTouch: true`; tap through the sheet (each row ≥ 64 px tall); read
`data-cockpit-layout`, `data-pane`, the column's and the sheet's `getBoundingClientRect()` (± 1 px)
and `localStorage`; `count()` of `[data-screen-sheet]` after `CANCEL` and after the outside tap is 0;
reload; navigate with the query.

### S-SCR-07 Switch on a small screen: one half at a time, a count for new cards (pending Q-O22)
Given a screen at 1024x768 with no layout stored (the default is `switch`), the wall shown,
When the fake agent places 2 cards on the canvas,
Then the screen keeps showing the wall (`data-switch-shows="wall"`); the switch button reads
`CANVAS` with a count `2`.
When the owner taps it,
Then the canvas shows the 2 cards, the button reads `WALL`, the count is gone.
Test: Playwright at 1024x768 with a fake-agent script that places two cards; assert the attribute,
the label and the count text before and after the tap.

### S-SCR-08 Two screens: the canvas gets the card, the tour keeps touring (pending Q-O22)
Given screen A in `wall` layout touring and screen B in `canvas` layout, one conversation,
When the owner types "put a countdown to the nightly run on the canvas" on B and the fake agent
places a countdown card,
Then the card appears on B within 1 s of the agent's command (B6, `README.md` speed budget); A shows the new conversation line if
its pane is open, keeps `data-wall-state="tour"` and gets no card.
Test: Playwright, two browser contexts on one fake agent and one demo hub; assert the card on B,
no card element on A, and A's `data-wall-state`.

### S-SCR-09 The cockpit button on every app view, in the same place as on the Wall (pending Q-O11)
Given the app at 1368x912 with the cockpit configured and a toast showing,
When it shows each view in `VIEWS` (`map`, `board`, `inbox`, `packages`, `morning`, `credit`,
`box`, `audit`, `runs`) in turn,
Then each has one `[data-talk]` at x 1280-1344, y 824-888 and one `[data-cockpit-open]` reading
`CHAT` at x 1288-1336, y 760-808: the rects S-SCR-01 reads on the Wall page, to the pixel; neither
intersects `footer.shell-bar` (y 888-912), the header or the toast stack (bottom edge ≤ 736); a tap
on `CHAT` opens the pane over the view, `CHAT` then reads `CLOSE` in the same rect, and
`location.hash` is unchanged.
And with the cockpit not configured, no view has either control and the toast stack is where it is
today.
Test: Playwright loops over `VIEWS`, compares both rects with the Wall page's, asserts the bar's and
the toasts' rects do not intersect them, taps, compares `location.hash`; a second run without the
cockpit config counts zero of each.

### S-SCR-10 An empty canvas says what it is for (pending Q-O22)
Given a screen in `canvas` layout and no cards,
Then the canvas shows, centred, in `--text-2` at 24 px: "Nothing on the canvas yet." and below it
at 20 px: "Ask the agent to put something here, for example: “a countdown to the nightly run”."
Never a blank surface (`docs/plans/product.md` §3.6). With the demo (`?demo=1`) the canvas holds
the demo cards instead, labelled `DEMO` top left of the canvas in 16 px caps.
Test: Playwright with a fake agent that places nothing; assert both texts and their computed font
sizes; a second run with `?demo=1` asserts the `DEMO` label and ≥ 1 card.

### S-SCR-11 Crossing 1280 px flips split and switch without a reload (pending Q-O22)
Given a screen at 1368x912 in `split` (stored), the wall in `explore` on `builder-a`, a draft in
the column's input,
When the window is resized to 1200x800,
Then within 0.5 s `data-cockpit-layout="switch"` with `data-switch-shows="canvas"` (the half that holds the
conversation), `[data-cockpit-conversation]` is at x 592-1200, y 0-800, the draft and the
conversation are unchanged, and `cockpit.layout` is still `split`.
When it is resized back to 1368x912, it is `split` again, the column at x 760-1368, y 520-912, the
wall still on `builder-a`.
Test: Playwright `setViewportSize` both ways; assert the attributes, the column's rect, the input
value and storage.

### S-SCR-12 Reduced motion: no flights, same rules
Given `prefers-reduced-motion: reduce` and a screen in `split`,
When the owner taps the wall and the fake agent sends `fly_to builder-a`,
Then the wall is `explore` at once, the camera jumps to `builder-a` with no frames in between
(Wall plan D5), and the tour (the slow caption rotation) returns 60 s after the last touch.
Test: Playwright with `emulateMedia({ reducedMotion: 'reduce' })` and a fake clock; sample
`screenOf('builder-a')` on two consecutive frames after the command: no intermediate position.

## 6. Pairing (pending Q-O21)

**Which night builds this section** (pending Q-O21, recommendation b) for a screen only the owner
can touch): the Pair slice (`slices.md` §3.8), not C1. Under b) a C1 screen is never `unpaired`:
the room link accepts the trust the board already gives the page (`local`, or `direct` through
serve, `docs/fleet/auth.md`), `data-cockpit` goes from `connecting` to `live`, and no pairing card,
code or CLI exists yet; what exactly the upgrade checks is `security.md` §2.3 (D212). With Q-O21 a)
this section and S-SCR-13..16, 27..29 are C1's (`slices.md` §3.1 lists the ids).
The rest of §6 is written as the flow either night builds.

A screen talks to the room only with a **device token** (glossary). It gets one by **pairing**: the
screen shows a code, the owner approves the code from a trusted place, the room hands the screen
its token. Who may approve, and how long a token lives, is security-relevant: written here for the
recommendation (pending Q-O10).

**Where the cockpit is configured.** In the config of the laneboard that serves the page: on the
one box its `cockpit` section with `cockpit.agent` (it is the room); on a hub or board whose front
forwards `/api/cockpit/` to a room of its own, `cockpit.forwarded: true` (D128, D129, pending
Q-O29; `single-machine.md` for the one box). Neither: the cockpit is **unconfigured**, no cockpit
button, no canvas half, the board as today (§4) (D17). The screen reaches the room directly on the page's own origin, under
`/api/cockpit/`, never through the hub (`protocols.md` §1, D92); the routes below are its §1.1.

**The board does not need pairing.** Viewing the board stays as today (`docs/fleet/auth.md`: a
`direct` user through serve, or `local`). An unpaired screen shows every view, the Wall and the
tour as a paired one does; only the pane and the canvas wait for the pairing. (A LAN-only setup
where the device token also opens the board is Q-O27's and `single-machine.md`'s; what a token
gives, verb by verb, is `security.md` §2.)

**The pairing code.** 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no `0 O 1 I L`), shown
as two groups of 3 (`K7M-4QX`), accepted with or without the dash, any case. Valid **300 s**; a
new one replaces it on its own when it runs out. At most 10 open codes per room; an 11th request
gets 429 and the screen retries after 30 s (D13).

**The flow** (pending Q-O10 for step 3):
1. An unpaired screen asks the room for a code: `POST /api/cockpit/pair` → `201
   {"code":"K7M4QX","expiresAt":"2026-10-27T07:05:00+01:00","pairSecret":"q3Jx…"}`. `pairSecret`
   is 32 random bytes, base64url (43 characters). The page keeps it in a JavaScript variable only:
   never in storage, never in the DOM, never drawn. A reload loses it and asks for a new code (the
   old one runs out after its 300 s and counts toward D13's 10 until then).
2. The pane (opened by `CHAT` or the talk button) and an empty canvas show the pairing card (text below).
3. The owner approves on the room: `laneboard cockpit pair K7M-4QX --name desk`. The CLI shows who
   asks and waits for `y` (§6.1). `--name` is optional; the default is `screen-<n>`, `<n>` the next
   free number from 1. On `y` it prints `paired desk (code K7M-4QX)` and exits 0; anything else
   prints `not paired` and exits 1; an unknown, expired or already approved code exits 1 with
   `code K7M-4QX is unknown or expired`. Who may run it: §6.1.
4. The screen asks `GET /api/cockpit/pair/K7M4QX` every 2 s with the headers `X-Laneboard: 1` and
   `X-Laneboard-Pair: <pairSecret>`: `202` while pending, `200 {"name":"desk"}` plus the token's
   cookie once approved, `410` when expired (step 1 again). A missing or wrong `X-Laneboard-Pair`
   gets `404 {"error":"unknown"}`, the same answer as a code that never existed, so the code alone
   gives nothing to whoever reads it off the screen (the secret is compared in constant time). The
   token is handed over once; a second `GET` with the right secret gets `410`. The token lives in
   the cookie `lb_cockpit` (§6.2); it survives a reload and is gone when the browser's data is
   cleared. A kiosk keeps a persistent browser profile, or it pairs again after every restart (a
   line for the later `docs/cockpit.md`).
5. Within 2 s of the approval the pane shows `Paired as desk.` for 5 s, then the conversation.
   Every other paired screen shows the new pairing (§6.3).

**Listing and unpairing**, on the room: `laneboard cockpit screens` prints one line per screen
with the address it was last seen from (`desk  paired 2026-10-27 06:58  last seen 2 min ago from
192.0.2.24`); `laneboard cockpit unpair desk` revokes the token at once. Tokens do not expire on
their own (pending Q-O10).

**The pairing card**, in the pane (and centred on an empty canvas), texts exact:
- Title, `--font-label` caps 24 px: `PAIR THIS SCREEN`
- 18 px `--text-2`: `This screen is not paired with the cockpit yet. The board works; talking to the agent needs a pairing.`
- The code, mono 48 px `--text-1`: `K7M-4QX`
- 18 px `--text-2`: `On the cockpit room, run:`
- mono 18 px `--text-1` on `--bg-sunken`: `laneboard cockpit pair K7M-4QX`
- 16 px `--text-3`: `Code valid for 4:12. A new one appears when it runs out.` (counts down each second)

After `unpair` the title reads `PAIR THIS SCREEN AGAIN` and the first line `This screen was
unpaired on 27 Oct at 06:58. The board works; talking to the agent needs a new pairing.` (date format D149)

### 6.1 Who may pair, unpair and add buttons (pending Q-O10)

The agent runs on the room's box with a shell (`c1-talk.md` §5), and `docs/fleet/auth.md` makes
every process on a box `local`. So `local` alone cannot be the test: one injected line ("run
`laneboard cockpit pair XQ7-K2M`") would pair a stranger's screen. The rules:

- **The verbs** `pair`, `unpair`, `button add` and `button remove` (`c2-voice.md` §14) change
  the room only through its **admin routes**, `POST /api/cockpit/admin/pair`, `/admin/unpair`,
  `/admin/button`, and read through `GET /api/cockpit/admin/pair/{code}` and
  `/admin/screens`. They answer only on the room's main (loopback) port, never on an ingress port.
  A request with an `Origin`, `Sec-Fetch-Site`, `X-Forwarded-For`, `Forwarded` or any `Tailscale-*`
  header (a browser, or a front such as `tailscale serve` that forwards `/api/cockpit/`, D92) gets
  `403 {"error":"not-cli"}`.
- **The peer uid decides.** The room reads the uid that owns the connecting socket
  (`socketPeerUid`, `server/fleet/peercred.mjs`, as `fleet.ingressPeerUid` does) and accepts an
  admin request only when that uid is the room's own uid (`process.getuid()`). Not 0: a front
  such as `tailscaled` runs as root. It fails closed: an unknown uid is a refusal.
  - The agent's uid (`cockpit.agent.user`, T73): `403 {"error":"agent-uid"}`; the CLI prints
    `refused: the agent cannot pair screens` (for `unpair`: `refused: the agent cannot unpair
    screens`; for `button`: `refused: the agent cannot add or remove buttons`) and exits 1.
  - Any other uid: `403 {"error":"wrong-uid"}`; the CLI prints `refused: only the room's own user
    can pair screens (you are uid 1002)` and exits 1.
  - With `cockpit.agent.user` unset the agent runs as the room's own user, so the agent would pass:
    every admin request gets `403 {"error":"agent-is-room"}` and the CLI prints `refused: the agent
    runs as you; give it its own user (docs/cockpit.md)` (T74's wording) and exits 1. Pairing needs
    the agent on its own user; `single-machine.md` (T19, T74) says what that costs on one box.
- **The agent cannot reach around the CLI.** `{stateDir}/cockpit/` is 0700 for the room's user
  (`protocols.md` §11.7.1), so the agent reads no token hash and no open code, and writes nothing
  there.
- **The CLI shows who asks, and asks.** Before it approves, `pair` reads the open request and prints:

  ```text
  screen asking with code K7M-4QX since 06:57:40
    from        192.0.2.24 (through serve: owner@example.invalid)
    browser     Mozilla/5.0 (Linux; Android 14; Tab) AppleWebKit/537.36 (KHTML, like Gecko) Chrom…
  pair this screen as desk? [y/N]
  ```

  `from` is the socket's address, or the `X-Forwarded-For` and `Tailscale-User-Login` the board
  already trusts on its ingress (`docs/fleet/auth.md`); `browser` is the `User-Agent` cut at 100
  characters with `…`. Only `y` or `yes` (any case) approves. With no terminal on stdin the CLI
  needs `--yes`, else it exits 1 with `not paired: no terminal to ask (use --yes)`.
- **From another machine** the owner, or the owner's own coding agent on a laptop, runs the same
  command over SSH as the room's user: `ssh -t cockpit laneboard cockpit pair K7M-4QX` asks y/N as
  above; without `-t` there is no terminal and it needs `--yes`. Either way the CLI first prints
  the request block above, which is what that agent reads back to the owner before approving
  (S-SCR-14). The peer uid is the room's user, so the check passes; the audit line is the same
  (pending Q-O10).
- **Each refusal and each change is one audit line** in the room's log (action, name, peer uid,
  outcome; the format is §6.4's). A refusal issues no token and changes no code: the code
  stays open for the owner.
- **Tests.** The uid checks are `checkCaller` and the admin routes' own check; `stand-ins.md` §1.3
  and D111 say how they are tested without a second user (injected uids in `node:test`) and why
  nothing switches them off.

### 6.2 Requests from other sites, and the cookie

A page the kiosk or a laptop browser opens on another site must not reach the room (cross-site
WebSocket, CSRF). Every browser route of the room (`protocols.md` §1.1) gets `docs/fleet/auth.md`'s
checks, from `server/security.mjs` and the `Sec-Fetch-Site` rule of `server/fleet/auth.mjs`:

| Check | `POST /api/cockpit/pair`, `/talk` | `GET /api/cockpit/pair/{code}` | `GET /api/cockpit/ws` (upgrade) |
| --- | --- | --- | --- |
| `Host` exactly allowed (`checkHost`) | `403 {"error":"bad-host"}` | `403 {"error":"bad-host"}` | close 4403 `bad-host` |
| `Origin` present and exactly the page's origin, never same-site (`checkOrigin`) | `403 {"error":"bad-origin"}` | an `Origin` that is present must match: `403 {"error":"bad-origin"}` | missing: close 4403 `no-origin`; other: close 4403 `bad-origin` |
| `Sec-Fetch-Site`, when present, is `same-origin` or `none` | `403 {"error":"sec-fetch-site"}` | `403 {"error":"sec-fetch-site"}` | close 4403 `sec-fetch-site` |
| `X-Laneboard: 1` (`checkCsrf`) | `403 {"error":"no-csrf-header"}` | `403 {"error":"no-csrf-header"}` | — (a browser cannot add headers to an upgrade; `Origin` does the work) |

`/talk` is C2b's and refuses any `Origin` or `Cookie` instead (D52, `c2-voice.md` §14). The
`GET` for a code needs the headers because it hands over a cookie; a custom header also makes any
cross-site `fetch` a preflight, and the board answers every `OPTIONS` 405, so no other site gets
that far. The close codes are `protocols.md` §2.3's (D135); a refused link never sees a `welcome`
or any conversation frame.

The token's cookie, set by the `200` of step 4:

```text
Set-Cookie: lb_cockpit=<43 base64url characters>; HttpOnly; Secure; SameSite=Strict; Path=/api/cockpit; Max-Age=34560000
```

`HttpOnly`: no script on the page reads it. `SameSite=Strict`: no other site's page sends it.
`Path=/api/cockpit`: the board's own routes never see it. `Max-Age` is 400 days, the most a
browser keeps; the room still decides validity (pending Q-O10). The room stores only the token's
SHA-256 (`security.md` §1). A plain-HTTP page does not pair: §6.2.1.

### 6.2.1 A page that is not HTTPS (T58, T75, D182)

On a plain-HTTP page the device token (the cookie on every upgrade) and every audio frame cross the
network unencrypted: anyone on that network can copy the token and be that screen. So the room
pairs and links only pages whose `Origin` is `https:`, or `http:` on a loopback host
(`127.0.0.1`, `[::1]`, `localhost`; the browser treats those as secure; whether it keeps a `Secure`
cookie there is research Q14). One more row of §6.2's checks, after the `Origin` row:

| Check | `POST /api/cockpit/pair` | `GET /api/cockpit/pair/{code}` | `GET /api/cockpit/ws` (upgrade) |
| --- | --- | --- | --- |
| `Origin` is `https:` or loopback `http:`, unless `cockpit.allowInsecure` | `403 {"error":"insecure-origin"}`, no code made, not one of D13's 10 | checked when `Origin` is present (a code exists only after a `POST` that passed) | close 4403 `insecure-origin` (`protocols.md` §2.3) |

`/talk` sends no `Origin` (D52) and is not affected. The room reads the scheme from the `Origin`
header the browser sends, never from its own listener: behind a front (D92) the room's port is
plain HTTP while the page is HTTPS.

**The key**, in the room's config (`c2-voice.md` §9's layers):

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `cockpit.allowInsecure` | `false` | `LANEBOARD_COCKPIT_ALLOW_INSECURE=1` | `true`: a plain-HTTP page pairs and links as an HTTPS one does; the token's cookie for it has no `Secure` (the browser drops a `Secure` cookie from an `http:` page). An HTTPS page still gets `Secure`. Not a boolean: fatal at start, naming the key. |

With `true`, the room prints once at start, on stderr: `cockpit: allowInsecure is on: a screen on a
plain-HTTP page sends its device token and its audio unencrypted; anyone on that network can copy
the token and talk to the agent as that screen.` What a copied token gives, exactly: the room link
as that screen, so sending prompts to the agent (which reads the fleet with its tools, `c3-see.md`),
reading the conversation and stopping turns; and every audio frame and reply on the wire. It does
not give the board's own routes (the cookie's `Path` is `/api/cockpit`), pairing or unpairing
(the CLI on the room, §6.1), or anything the agent itself may not do. `unpair` revokes it as any
token. The CLI's request block (§6.1) gains one line for such a page, after `browser`:
`page        http://hub.example.invalid:7777 (not HTTPS: its token travels unencrypted)`.

**The card on a plain-HTTP page**, with `allowInsecure` off. On `403 {"error":"insecure-origin"}`
from step 1, or a close 4403 `insecure-origin` on a screen paired before the key went off, the
page sets `data-cockpit="unpaired"` and shows, where the pairing card goes (pane and empty canvas),
`[data-pair-card="insecure"]`, texts exact, with no code, no command and no countdown:
- Title, `--font-label` caps 24 px: `CANNOT PAIR HERE`
- 18 px `--text-1`: `This page is not HTTPS, so it cannot be paired. docs/cockpit.md says how to get HTTPS on a LAN, or how to allow it anyway.`
- 18 px `--text-2`: `The board works without a pairing.`

It asks nothing again (no second `POST`, no upgrade) until a reload. The board, the Map and the tour
are as for any unpaired screen.

**For the later `docs/cockpit.md`**: HTTPS on a LAN is a reverse proxy in front of the board with
a certificate from a local CA (for example Caddy with `tls internal`), the CA's root certificate
installed once on the tablet; or a tailnet's HTTPS proxy. Allowing it anyway is
`cockpit.allowInsecure: true`, with the paragraph above on what it exposes, and only on a network
the owner would hand the token to. The microphone on such a page also needs the browser policy of
`c2-voice.md` §12 item 1.

### 6.3 A new pairing shows on every paired screen

So a pairing the owner did not make cannot hide: at each approval the room sends `screen.paired`
(`{"type":"screen.paired","seq":212,"name":"desk2","at":"2026-10-27T07:12:00+01:00"}`, shared
state, `protocols.md` §2.4 gains it) to every link. Each paired screen draws it in the conversation
as one line at the point in time it happened, 18 px caps `--font-label` `--text-2`:
`SCREEN DESK2 PAIRED · 07:12`. It stays in the conversation like a show line (the snapshot carries the last 20 in `screens`); it
starts no turn and the agent does not see it. A screen whose pane is closed also shows a toast
(`public/js/ui/toast.js`, in the stack of §4.1) `Screen desk2 was paired at 07:12.` for 10 s. The
new screen itself shows `Paired as desk2.` (step 5), not this line. `unpair` sends
`screen.unpaired` the same way: `SCREEN DESK2 UNPAIRED · 07:30`, no toast. (D160)

### 6.4 The room's audit lines (T60, D164-D166)

Every pairing change and every word a screen sends to the agent leaves one line in the room's audit
log, so the owner can answer "who paired this" and "what did the cockpit do at 03:00" afterwards.

- **The log is the board's own** (`docs/fleet/auth.md`, "The audit log"; `server/fleet/audit.mjs`
  `openAudit`): same file rules, same JSON line, same hash chain, same `laneboard audit` and
  `laneboard audit verify`. The room writes no second format and no second file.
  - On one box the room is the board's process (D92), so it appends through the board's one
    `openAudit` instance (one writer lock) to the board's file.
  - Run as its own process and unix user (D91), the room has its own file:
    `$LANEBOARD_AUDIT_FILE`, else that user's `$XDG_STATE_HOME/laneboard/audit.jsonl`, else
    `~/.local/state/laneboard/audit.jsonl`. The owner reads it as that user
    (`sudo -u <room user> laneboard audit`).
- **The agent cannot change it.** The file is 0600 and its directory 0700, owned by the room's uid;
  the agent runs as `cockpit.agent.user` (§6.1), so it can neither read nor write the log. With
  `cockpit.agent.user` unset the agent runs as the room's user and could rewrite and re-chain the
  file, as `auth.md`'s "Authority" paragraph says of any builder; pairing is refused then
  (`agent-is-room`, §6.1), and `single-machine.md` (T19, T74) says what one box costs.
- **Never the words.** Arguments are stored only as `argsHash` (`argsHashOf`, SHA-256 of their
  canonical JSON); prompt text, codes and tokens never appear in a line. The hash is unsalted: a
  short prompt such as `stop` can be guessed from it (`auth.md`); the log is 0600 for that reason
  too.
- **What is not chained** (as `auth.md`'s unauthenticated failures): a request without a valid
  device token (an unpaired screen asking for a code, `POST /api/cockpit/pair`; a link closed with
  4401, 4402 or 4403, `protocols.md` §2.3). Anyone can send those; they go to the room's log as a
  counted warning, at most one line per 10 s (`createUnauthWarner`).

| `action` | Written when | `user` | `via` | `target` | `args` (hashed) | `result` |
| --- | --- | --- | --- | --- | --- | --- |
| `cockpit.pair` | an admin `pair` is approved or refused (§6.1), before the token is issued | `uid:1000` (the peer uid; `uid:?` when unknown) | `cockpit-cli` | the screen name, `desk2` | `{"code":"K7M4QX","name":"desk2"}` | `{"ok":true}`; refused `{"ok":false,"status":"agent-uid","peerUid":1001}` (also `wrong-uid`, `agent-is-room`, `not-cli`, `unknown`) |
| `cockpit.unpair` | an admin `unpair` is done or refused | as `pair` | `cockpit-cli` | the screen name | `{"name":"desk2"}` | `{"ok":true,"links":1}` (links closed with 4402); refused as `pair` |
| `cockpit.button` | an admin `button add` or `button remove` (`c2-voice.md` §14) | as `pair` | `cockpit-cli` | the button name, `hall` | `{"op":"add","name":"hall","screen":"desk"}` | `{"ok":true,"op":"add"}`; refused as `pair` |
| `cockpit.button.press` | each valid call of `POST /api/cockpit/talk` | `button:hall` | `cockpit-button` | the target screen, `desk` | `{"action":"toggle"}` | `{"ok":true,"status":200,"talk":"listening"}`; `{"ok":false,"status":409}` for `voice-off`, `504` for `screen-timeout` |
| `cockpit.prompt` | the room accepts a `prompt` (before the `turn.prompt` echo) or refuses it with `prompt.refused` (`protocols.md` §3.1) | `screen:desk`; without pairing (Q-O21 b) `board` | `cockpit` | the turn, `t-0132` (refused: `-`) | `{"text":"how did the night go?"}` | `{"ok":true,"source":"spoken","delivery":"new","chars":21}`; refused `{"ok":false,"status":"agent-down"}` |
| `cockpit.stop` | the room receives `stop` (`protocols.md` §3.3), before it asks the bridge | `screen:desk` | `cockpit` | the running turn, `t-0132` | `{}` | `{"ok":true,"cancelQueued":true}` |
| `cockpit.new` | `START` on the `NEW` bar (`c1-talk.md` §11), or a forced fresh start (`reason` `forced`) | `screen:desk`; forced: `room` | `cockpit` | the new conversation, `c-0008` (`protocols.md` §3.6), written once it has started | `{}` | `{"ok":true,"from":"c-0007","stoppedTurn":"t-0139"}` (`null` when idle); forced: `{"ok":true,"from":"c-0007","reason":"forced"}` |

- `user` for a screen is `screen:<name>` when it is paired; with no pairing in C1 (Q-O21 b), `board`
  for every screen (the board already decided who may load the page; C1 draws no names, D37).
- `builder` is the board's builder name as for every other line (`openAudit`'s `builder`). `ts` and
  `id` are `openAudit`'s.
- **Once per prompt.** A `prompt` whose `clientId` the room already knows (D95, a `RETRY` after
  E1) writes no second line. A prompt the room resends itself (D123, `not-taken`) writes none.
- **Refusals are bounded** (D165): `too-many` (T59) writes the first refusal of each minute per
  device token (per link without pairing) as a line; the rest of that minute only count, and the next `cockpit.prompt` line
  of that token carries `"refusedSince":14`. So a stolen token cannot flood the chain faster than
  the rate limit lets it prompt.
- **When the log cannot be written** (D166; `auth.md`: "Fails closed"): what gives access or sends
  words is refused; what takes away always runs.
  - `pair`, `button add`: `503 {"error":"audit-unavailable"}`, no token; the CLI prints `not paired:
    the room cannot write its audit log` (for `button add`: `no button added: the room cannot write
    its audit log`) and exits 1. The code stays open.
  - `prompt`: `prompt.refused` with `"code":"audit-unavailable"`; the block reads `YOU · 07:02 ·
    NOT SENT` with `Not sent: the room cannot write its audit log.` and `RETRY`/`EDIT` as E1
    (`c1-talk.md` §10).
  - `unpair`, `button remove`, `stop`, `new`, a button press: done as usual; the room logs
    `cockpit: audit append failed for cockpit.stop: <reason>` (stderr, at most one line per 10 s)
    and shows nothing on the screens. Taking a token away or stopping the agent never waits for a
    broken log.
- Read them with `laneboard audit` (the board's table, `TS USER VIA ACTION TARGET OK`; `OK` shows
  `result.status` for a refusal):

  ```text
  TS                   USER         VIA          ACTION          TARGET   OK
  2026-10-27 06:12:00  uid:1000     cockpit-cli  cockpit.pair    desk2    ok
  2026-10-27 06:13:30  uid:1001     cockpit-cli  cockpit.pair    desk3    agent-uid
  2026-10-27 06:15:04  screen:desk  cockpit      cockpit.prompt  t-0132   ok
  2026-10-27 06:15:09  screen:desk  cockpit      cockpit.stop    t-0132   ok
  ```

  (UTC, as `laneboard audit` prints every line.)

## 7. When something is down

A screen depends on up to three things; each fails on its own and says so where it matters:

| What | Link | Lost when |
| --- | --- | --- |
| the screen's network | the browser | `navigator.onLine` is `false` |
| the **board** (hub, or the builder in builder mode) | the board socket (`public/js/core/net.js`) | the socket closes; it retries 500 ms × 1.8 up to 15 s, as today |
| the **room** | the room link (`protocols.md` §2) | the link closes, or no frame for 25 s (the room sends a heartbeat every 10 s); it retries 500 ms × 1.8 up to 15 s, the same `nextBackoff` (D10, D11) |

A lost room link shows only after a **5 s grace**: a link back within 5 s changes nothing on screen
(D10). The grace starts at the link's close or 25 s after its last frame, whichever comes first
(`protocols.md` §2.2, D139). The board link keeps today's behaviour (the `#offline` banner in the app). The room link does not
go through the hub (D92), so a hub down is not a room down; on one box board and room are one
process and go down together.

The page root carries `data-cockpit`: `unconfigured`, `unpaired`, `connecting`, `live`,
`room-down`, `offline` (for tests and CSS). `data-board` is `live` or `down`.

### Room down (answers Q-O6, recommendation a)

The board keeps working; the cockpit says it is away and since when. Nothing is hidden, nothing is
lost.
- **Wall half and app views:** unchanged. The tour, explore and every view read the board, not the
  room.
- **Cockpit button:** label and place unchanged; no mark of its own. The talk button is `off`
  (`data-talk="off"`, `c2-voice.md` §3: grey `TALK`, `aria-disabled`), which already says it; `CHAT`
  stays as it is and opens the pane on the status line below (D120, supersedes D53). A press on the
  `off` talk button opens the pane the same way and never the microphone (`c2-voice.md` §3, D179).
- **Away caption** (Wall page, `wall` and `switch` with the wall shown, pane closed; §4.1 C and G):
  `[data-cockpit-away]`, one line `Agent away since 06:41`, 18 px `--font-label` (not caps)
  `--text-2` on `--bg-sunken`, 8 px padding left and right, 32 px tall, right edge at x 1336 (`CHAT`'s),
  y 720-752 (8 px above `CHAT`). Not tappable: a tap on it goes to the map below as if it were not
  there (`pointer-events: none`). It shows with the status line (after the 5 s grace) and goes
  with it at the first frame from the room; the time is the status line's `since` (one source,
  no second clock). An unpaired screen has no caption (nothing is away; the pairing card is the
  pane's), nor has an offline one (the Wall's top caption says it, "The screen offline"). In the app (§4.1 A) there is no caption: the toast stack
  owns that band, and the grey `TALK` is in the same corner (D179).
- **Pane:** a status line under its header, 18 px `--text-2` on `--bg-sunken`, **80 px** tall (two
  lines of 18 px at line height 1.35 plus padding: the texts below wrap at the ~400 px left of the
  button) (D54): `Cockpit room unreachable since 06:41 (3 min). Retrying in 12 s.` with a `RETRY
  NOW` button (48 px tall, 16 px caps, 16 px from the pane's right edge) at its right end. The minutes and the retry count down each second; the
  retry shows `Retrying now…` while a try runs. The conversation so far stays readable. The input
  stays editable (a draft can be written); `SEND` and the talk button are disabled, with the line
  `Sending and voice come back with the room.` above the input row, in the line slot's type
  (18 px `--font-label`, `--text-1`, D167) (`c1-talk.md` §1.1, `data-line="room-down"`, the highest of its four): left-aligned at
  x 784, its last line box 4 px above the row's top border (on the Wall the row ends 24 px above the
  screen's edge, nothing fits under it).
- **Canvas:** the canvas half of room down (strip, `STALE` plates, frozen values, a job's countdown,
  removing offline, the empty canvas) is `c4-show-canvas.md` §7.6, built with the canvas (D120).
- **What the screen keeps:** the conversation and the cards are kept in memory only, never in
  browser storage (a screen holds nothing worth stealing, plan §2) (D14). A reload while the room is
  down shows the status line and `The conversation shows again when the room is back.` in the pane.

**Back.** At the first frame from the room: the status line reads `Back since 06:47.` for 5 s and
goes (unless `welcome.status` names a line that outranks it: then that line, and no `Back since`,
`c1-talk.md` §10.1); `STALE` plates go; cards placed or removed meanwhile update; missed conversation lines appear
in order (replay or snapshot, `protocols.md` §2.2). `SEND` and talk are enabled again. **A draft is never sent on its
own**: it stays in the input until the owner sends it (D12).

**Down during a turn or while speaking.** A reply streaming when the link is lost stops where it is
and gets the line `Cut off: the room went away at 06:41.`; on reconnect, a reply the room finished
meanwhile replaces the cut-off text (`protocols.md` §2.2). An open microphone closes at once (no 5 s grace: audio
has nowhere to go); the words so far stay in the input as an editable draft, not sent.

Sketch: `sketches/screens-room-down.html` (S-SCR-17 at 06:44): as is, `split` (§4.1 F) with the
column's status line, the cut-off line, the line slot, the draft `how is the`, `SEND` and talk `off`
with no ring (D120), and the card area as the Canvas slice draws it (`c4-show-canvas.md` §7.6: strip,
`STALE` on the bound card, none on the `text` card); with `#pane`, `wall` with the pane open (§4.1 D,
before the Canvas slice: `NEW`, `CLOSE`) and the whole cut-off reply (redrawn by T70).

### Board down (hub down)

- **App views:** today's `#offline` banner (`Disconnected — reconnecting…`) and the last snapshot.
- **Wall half:** the last snapshot stays; every node and line is drawn grey, as an offline
  builder's cards are (`docs/design.md`: "grey through and through"); a caption top-centre, 20 px
  `--text-1` on `--bg-sunken`, 48 px tall: `Board unreachable since 06:41 · showing 06:41`. The tour
  keeps flying over the grey snapshot, without "flies to trouble": a grey map has no trouble to
  rank (D15). Explore works.
- **Never loaded** (the board was down when the page opened): the wall half shows, centred, 24 px
  `--text-2`: `Waiting for the board at hub.example.invalid…` (the page's origin), below it 20 px
  `--text-3`: `Retrying in 4 s.`, and a `SHOW DEMO` button (64 px tall, 20 px caps) that reloads
  with `?demo=1` (D16). Never an empty screen (`docs/plans/product.md` §3.6).
- **Pane and canvas:** unchanged while the room link is up (`protocols.md` §1; on one box the room is down too).

### The screen offline

`navigator.onLine` false: one message replaces the room and board texts: the wall caption and the
pane status line both read `This screen is offline since 06:41. Check its network.`; the canvas
strip reads the same (`c4-show-canvas.md` §7.6). Retries keep running; when the network is back the rules of "Back" apply.

## 8. Scenarios, part 2

The stand-in room (T18) can stop and start its room link, approve and revoke pairings, and the
demo hub can be stopped, so each scenario runs without hardware.

### S-SCR-13 An unpaired screen: the board works, the pane shows a code (pending Q-O21)
Given a screen at 1368x912 in `split`, the cockpit configured, no device token,
When the page opens,
Then within 2 s `data-cockpit="unpaired"`, the wall half tours the demo fleet, the canvas (once
the Canvas slice is built; pending Q-O22) shows the pairing card centred with a code matching `^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$`, and
`Code valid for 5:00.` counting down.
When the owner taps `CHAT`, the pane shows the same card and the same code; `CHAT` reads `CLOSE`.
The talk button is `data-talk="off"` (`c2-voice.md` §3) in its §4 rect; a press on it opens no
microphone: an unpaired screen sends no audio; with the pane closed it opens the pane on the
pairing card (`c2-voice.md` §3, D179; S-SCR-32 is the room-down case).
Test: Playwright against the demo hub and the stand-in room with an empty token store; assert the
attribute, the regex, the countdown text at 0 s and (fake clock) 60 s: `4:00`; tap `CHAT`; read
`[data-talk]`'s rect and state; press it with `getUserMedia` wrapped to count calls: 0.

### S-SCR-14 The owner approves the code on the room, the screen is paired within 2 s (pending Q-O21)
Given S-SCR-13's screen showing `K7M-4QX`, and a second screen `hall` paired and live with its pane closed,
When `laneboard cockpit pair k7m4qx --name desk` runs on the room at t = 0 s (07:12) and the owner answers `y`,
Then the CLI prints the §6.1 request (`from`, `browser`), then `paired desk (code K7M-4QX)` and
exits 0; by t = 2 s `data-cockpit="live"`, the pane shows `Paired as desk.`, gone at t = 7 s, then
the conversation; the canvas shows its cards or S-SCR-10's empty text. By t = 2 s `hall` shows the
toast `Screen desk was paired at 07:12.` (gone at t = 12 s) and, once its pane opens, the line
`SCREEN DESK PAIRED · 07:12` in its conversation (§6.3).
When the page reloads, it is `live` again with no code shown.
Test: Playwright, two pages; the approval through the control API's `/pair` (D111, `stand-ins.md`
§1.3), the CLI's request text, `y` prompt and output in `node:test` with an injected stdin; fake
clock for the 5 s and 10 s; `framereceived` on `hall` sees `screen.paired`; reload and assert.

### S-SCR-15 A code runs out and is replaced; the old one cannot be approved (pending Q-O21)
Given an unpaired screen showing a code at t = 0 s,
When nobody approves it,
Then at t = 300 s a different code is shown and `Code valid for 5:00.` starts again; and
`laneboard cockpit pair <old code>` exits 1 with `code <old code> is unknown or expired`.
Test: Playwright with a fake clock on the screen and a stand-in room whose clock is moved 300 s;
assert the two codes differ, run the CLI with the first, check exit code and output.

### S-SCR-16 Unpairing a screen takes the cockpit away at once, the board stays (pending Q-O21)
Given screen `desk` paired and live, the pane open,
When `laneboard cockpit unpair desk` runs on the room at 06:58,
Then within 2 s `data-cockpit="unpaired"`, the pane shows `PAIR THIS SCREEN AGAIN`, `This screen
was unpaired on 27 Oct at 06:58. …` and a new code; the conversation is no longer on the screen;
the wall half keeps touring; a request with the old token gets 401.
Test: Playwright plus the CLI; `page.on('websocket')` sees `framereceived`
`{"type":"revoked","at":"2026-10-27T06:58:00+01:00"}`, then the `cockpit:close` mark reads 4402
`revoked` (`protocols.md` §2.3); assert texts, that no conversation line is in the DOM and that
no new link opens in the next 20 s; `fetch` a cockpit route with the old token from the test and
expect 401.

### S-SCR-17 The room goes down: the cockpit says so after 5 s, the board keeps going
Given a screen in `wall` layout, live, touring, the pane open with a draft `how is the`,
When the stand-in room stops its link at t = 0 s (06:41),
Then at t = 4.9 s nothing has changed; at t = 5 s `data-cockpit="room-down"`, the status line under
the pane's header is 80 px tall and reads `Cockpit room unreachable since 06:41 (0 min). Retrying
in …` with `RETRY NOW` (48 px tall) at its right end, the line `Sending and voice come back with
the room.` sits above the input row, `SEND` is disabled, the talk button has `data-talk="off"` and
`aria-disabled="true"` (not `disabled`, D179) with no other mark on it, the draft is still `how is the` and editable (typing `
night` makes it `how is the night`); the wall half is `data-wall-state="tour"` and flying
throughout.
The canvas half of this outage is S-C4-23.
Test: Playwright with `page.clock`; `POST /link {"up":false}` on the stand-in room; assert at 4.9 s
and 5 s; the status line's rect height 80 ± 1 px; type into the input; `disabled` on `SEND`,
`aria-disabled="true"` and no `disabled` on the talk button; the talk button has no child element
beyond its label and glyph.

### S-SCR-18 A blip under 5 s shows nothing
Given a live screen,
When the stand-in room drops its link at t = 0 s and accepts the reconnect at t = 2 s,
Then `data-cockpit` is `live` at every sample from 0 s to 10 s and no status line (nor, on a
canvas, strip) appears.
Test: Playwright with a fake clock; sample the attribute and count `[data-cockpit-down]` elements
every 0.5 s.

### S-SCR-19 The room comes back: the screen catches up, the draft is not sent
Given S-SCR-17's screen in `room-down`, with retries at 0.5, 1.4, 2.9, 5.6, 10.6, 19.4, 34.4 s
… after the loss (500 ms × 1.8, cap 15 s),
When the room is started again at t = 60 s, having answered one turn meanwhile,
Then by the next retry and 1 s after it `data-cockpit="live"`; the pane line reads `Back since
06:42.` for 5 s, then goes; the missed turn is in the conversation in order; `SEND` and the talk
button are enabled; the draft `how is the` is in the input and no prompt was sent (the stand-in's
log shows no new user turn). (The canvas catching up is S-C4-23.)
When the owner taps `RETRY NOW` during a later outage, a try starts at once.
Test: Playwright with a fake clock and the stand-in's log of received turns; assert texts and the
log; record retry times from the stand-in's connection log and compare with the series ± 50 ms.

### S-SCR-20 The room goes away mid-reply and mid-speech
Given a live screen, the fake agent streaming a reply, half shown,
When the room's link is lost at 06:41,
Then after 5 s the reply stops where it was and shows `Cut off: the room went away at 06:41.`;
when the room is back and had finished the reply, the full reply replaces the cut-off text.
And given the microphone open with the partial `restart the` shown, when the link is lost, the
microphone closes within 0.2 s (no grace), and `restart the` stays in the input, not sent.
Test: Playwright with the fake agent (one long scripted turn) and the fake speech service (T18);
assert the cut-off line, then the replaced text; assert `data-talk` on the talk button and the input.

### S-SCR-21 The hub goes down: the Wall greys out and says since when
Given a screen in `wall` layout touring the demo hub,
When the demo hub stops at 06:41,
Then within 2 s `data-board="down"`, every Map node is drawn in the grey of an offline builder, the
caption reads `Board unreachable since 06:41 · showing 06:41`, the tour keeps moving; when the hub
is back, the caption goes and colours return within 2 s of the first snapshot.
Test: Playwright; stop and start the demo hub; assert the attribute, the caption, and that no node
uses the `--p1`/`--p2` colours while down (computed styles).

### S-SCR-22 The board was never reachable: say what is missing, offer the demo
Given the demo hub stopped,
When a screen opens the Wall page from `hub.example.invalid`,
Then within 2 s the wall half shows `Waiting for the board at hub.example.invalid…`, `Retrying
in 1 s.` counting, and `SHOW DEMO` (64 px tall); a tap loads `?demo=1` and the demo tour runs,
labelled `DEMO`.
Test: Playwright with the page served but the board socket refused; assert the texts and the
button's rect; tap and assert `location.search` and the `DEMO` label.

### S-SCR-23 The screen loses its network
Given a live screen in `split`,
When the browser goes offline (`context.setOffline(true)`) at 06:41,
Then within 1 s the wall caption and the pane line read `This screen is offline since 06:41. Check
its network.` (on a canvas the strip too, `c4-show-canvas.md` §7.6, asserted only once the Canvas
slice is built); after `setOffline(false)` the rules of S-SCR-19 apply.
Test: Playwright `context.setOffline`; assert the two texts; back online, assert `live`.

### S-SCR-24 A refused room link says why instead of retrying as if the room were down
Given a page on `#/map` whose room link the room refuses right after the upgrade (`protocols.md`
§2.3, D135),
When the link closes with 4403 `bad-origin`,
Then within 1 s `data-cockpit="room-down"` (no 5 s grace) and the pane's line slot reads `This
address is not allowed to talk to the cockpit room (bad-origin). Reload once the room allows it.`;
no second upgrade in the next 40 s; the board and the Map go on as before.
When instead the link closes with 4503 `too-many-links` at t = 0 s,
Then within 1 s `data-cockpit="room-down"` and the line reads `The cockpit room has 32 screens
connected, its limit. Trying again every 30 s.`; the next upgrades happen at t = 30 s and t = 60 s
(± 1 s), none between; when the room accepts the one at 60 s, `data-cockpit="live"` and the line
goes.
Test: Playwright with a fake clock; `page.routeWebSocket('**/api/cockpit/ws', ws => ws.close({code:
4403, reason: 'bad-origin'}))` for the first case, a route that closes the first two with 4503 and
connects the third to the room under test (`ws.connectToServer()`) for the second; count upgrades in
the route handler; read the `cockpit:close` marks for code and reason. The room's side (it really
sends these codes, and an `Origin: https://evil.example.invalid` upgrade gets 4403) is the unit test
in `protocols.md` §2.3.

### S-SCR-25 The corner cluster in the app and on the Wall: every control at its rect, none closer than 8 px
Given the app at 1368x912 on `#/map` (`hasTouch: true`), the cockpit configured, the fake agent,
`cockpit.stt.url: "none"`,
When the page has loaded (state A of §4.1) and a toast with an action is shown,
Then `CHAT` is x 1288-1336, y 760-808, there is no `[data-talk]`, the toast stack's bottom is
y 736 and its right edge x 1356.
When the owner taps `CHAT` (state B), the room's link stops so the line slot shows `room-down`, the
owner drags the conversation up so `↓ NEW` shows, and a toast is shown,
Then the header holds `CLOSE` x 1256-1352 and `NEW` x 1176-1248 (y 44-92), the opener `CLOSE`
x 1288-1336, y 760-808, `SEND` x 1280-1344, y 824-888, the input x 784-1264, the line slot
y 776-808, `↓ NEW` x 1016-1112, y 712-760, and the toast's right edge is ≤ x 744.
When the viewport is set to 1368x532 with the input focused (state H),
Then `data-keyboard="up"`, the header is y 8-56 at B's x, the opener y 396-444, `SEND` y 460-524,
the line slot y 412-444.
When the same walk runs on the Wall page in `wall` (states C, D, H) and, from the C2 slice, with
the fake speech service and `cockpit.stt.language: ["en", "de"]` (the talk button x 1280-1344,
`SEND` x 1200-1264, `[data-talk-lang]` x 784-848, the input x 864-1184),
Then every rect is §4.1's.
Test: Playwright; at each state collect `getBoundingClientRect()` of every visible element matching
§4.1's selectors (header buttons, `[data-cockpit-open]`, `[data-cockpit-send]`, `[data-talk]`,
`[data-talk-lang]`, `[data-cockpit-input]`, `[data-cockpit-follow]`, `[data-cockpit-chip-remove]`,
the toasts' buttons), compare with a table in the test (± 1 px), and check every pair: no
intersection, distance ≥ 8 px; the toast through `import('/js/ui/toast.js')` `toast('x', {action})`
in `page.evaluate`; `POST /link {"up":false}` on the room under test for the line.

### S-SCR-26 The switch button moves into the column header when the canvas shows (pending Q-O22)
Given a screen at 1368x912 opened with `?layout=switch` (`hasTouch: true`), the wall shown, the fake
speech service,
Then (state G) the switch button `[data-cockpit-switch]` reads `CANVAS` at x 1200-1264, y 824-888,
the talk button x 1280-1344, y 824-888, `CHAT` x 1288-1336, y 760-808, and the Wall's status lines
end at x ≤ 1176.
When the owner taps `CHAT`,
Then within 0.2 s `data-switch-shows="canvas"`, `data-pane="column"`, the switch button reads `WALL`
at x 992-1064, y 8-56 in the column's header (no `[data-switch-count]`), `SEND` is x 1200-1264,
y 824-888 and nothing else intersects it; there is no `[data-cockpit-open]`.
When the owner taps `WALL`,
Then the wall shows and the switch button is back at x 1200-1264, y 824-888, reading `CANVAS`.
When the viewport is set to 1368x532 with the column's input focused (state I),
Then `WALL` stays at x 992-1064, y 8-56 and `SEND` is y 460-524.
Test: Playwright; the rect table and pairwise check of S-SCR-25 for states G, E and I; read the
labels and `data-switch-shows` after each tap.

### S-SCR-27 The agent runs `pair`: refused, audited, no token (pending Q-O10)
Given the room with `cockpit.agent.user` set to the agent's user (uid 1001, the room's own uid
1000), an unpaired screen showing `K7M-4QX`,
When the fake agent's script runs the tool `Bash` with `laneboard cockpit pair K7M-4QX --name desk2 --yes`,
Then the command prints `refused: the agent cannot pair screens` and exits 1; the room's log gains
one audit line `cockpit.pair`, `user` `uid:1001`, `result` `{"ok":false,"status":"agent-uid","peerUid":1001}` (§6.4); no token is
issued: the screen still shows `K7M-4QX`, `data-cockpit="unpaired"`, and its next `GET` with the
right secret is `202`; no other screen gets `screen.paired`. The same with `unpair desk` (`refused:
the agent cannot unpair screens`) leaves `desk` paired, and with `button add hall` (`refused: the
agent cannot add or remove buttons`) prints no token.
When instead `cockpit.agent.user` is unset and the owner runs `pair K7M-4QX`,
Then it prints `refused: the agent runs as you; give it its own user (docs/cockpit.md)`, exit 1.
Test: `node:test` (D111): the CLI's `main(argv, {uid: 1001, agentUid: 1001, room})` and the admin
route with an injected `socketPeerUid` returning 1001, then 1002 (`refused: only the room's own
user can pair screens (you are uid 1002)`), then `null` (refused, fails closed); read the audit
lines; then Playwright on the screen: still the same code, `202` on the next poll, no `screen.paired`
frame within 5 s.

### S-SCR-28 A second client that read the code cannot collect the token (pending Q-O10)
Given an unpaired screen that got `K7M4QX` and its `pairSecret` at t = 0 s,
When a second client (Node `fetch`, same origin headers) polls `GET /api/cockpit/pair/K7M4QX` every
0.5 s with `X-Laneboard: 1` and no `X-Laneboard-Pair`, then with a made-up one, and the owner
approves at t = 10 s,
Then every one of its answers is `404 {"error":"unknown"}` (before and after the approval), none
carries a `Set-Cookie`; the real screen's next poll gets `200 {"name":"desk"}` with the cookie and
is `live` by t = 12 s; the page's `localStorage`, `sessionStorage` and DOM contain no
`pairSecret` value; `document.cookie` does not show `lb_cockpit`.
Test: Playwright for the screen (read the secret from the `POST` response with `page.on('response')`,
then search storage and `document.documentElement.outerHTML` for it), Node `fetch` for the second
client, approval through `/pair`; assert statuses, bodies and the absent `Set-Cookie`.

### S-SCR-29 Another site cannot pair, poll or open the room link (pending Q-O21)
Given the room under test on `https://cockpit.example.invalid` and a paired screen's cookie,
When a client sends, each once:
`POST /api/cockpit/pair` with `Origin: https://evil.example.invalid`;
the same with the right `Origin` and `Sec-Fetch-Site: cross-site`;
the same with the right `Origin` and no `X-Laneboard`;
`GET /api/cockpit/pair/K7M4QX` with the right secret and `Sec-Fetch-Site: same-site`;
an upgrade of `/api/cockpit/ws` with the cookie and `Origin: https://evil.example.invalid`;
an upgrade with the cookie and no `Origin`;
`POST /api/cockpit/admin/pair` with `Origin: https://cockpit.example.invalid`;
the same from the room's own uid with `X-Forwarded-For: 192.0.2.24` (as a front would send it),
Then the answers are, in order: `403 bad-origin`, `403 sec-fetch-site`, `403 no-csrf-header`, `403
sec-fetch-site`, close 4403 `bad-origin`, close 4403 `no-origin`, `403 not-cli`, `403 not-cli`; no code
is created (the room's open-code count is unchanged); each refused link receives no frame at all
before its close (no `welcome`, no `snapshot`, no conversation); the screen's own link stays open.
Test: `node:test` against the room under test with the `ws` client (it sets any `Origin` and
`Cookie`) and `fetch`; count frames per refused link; read the open codes through the control
API. The page's side of 4403 is S-SCR-24.

### S-SCR-30 After a prompt and a stop, `laneboard audit` shows each once, without the words
Given the room under test with its audit file at `<tmp>/audit.jsonl` (`stand-ins.md` §1.1), a
live screen `desk` (C1 under Q-O21 b): the page's board identity, `user` `board`), the fake agent
on a script whose turn runs 20 s,
When the screen sends the typed prompt `how did the night go?` at t = 0 s, then taps `STOP` with
the input empty at t = 2 s,
Then `laneboard audit --json --file <tmp>/audit.jsonl` prints exactly two new lines, in order:
`cockpit.prompt` (`via` `cockpit`, `target` the turn id of the `turn.prompt` echo, `result`
`{"ok":true,"source":"typed","delivery":"new","chars":21}`) and `cockpit.stop` (same `target`,
`result.ok` true); the prompt line's `argsHash` equals `argsHashOf({"text":"how did the night
go?"})`; the raw file does not contain the string `night`; `laneboard audit verify --file …` exits
0 with `ok N entries`.
When the screen sends the same prompt again with the same `clientId` (D95),
Then no third line is written.
When the owner taps `NEW`, then `START`,
Then one `cockpit.new` line follows with `target` the `conversation` of `conversation.new` and
`result.from` the old one.
And under Q-O21 a) the screen was paired first as `desk` (control API `/pair`): the first line is
`cockpit.pair` (`target` `desk`), the next lines carry `user` `screen:desk`, and the raw file
contains neither the code nor the device token.
Test: Playwright for the screen, then in the same test run `bin/laneboard audit --json --file` and
`audit verify --file` as child processes, parse the lines, recompute `argsHashOf` from
`server/fleet/audit.mjs`, search the raw file for the strings; the resend goes through
`page.evaluate` on the page's link helper.

### S-SCR-31 With the audit log gone, a prompt is not sent but `STOP` still works
Given S-SCR-30's room with a turn running (sent before the break), room clock set to 07:02:00,
When the test renames `<tmp>/audit.jsonl` away at t = 0 s (the room's next append fails with
`AUDIT_DETACHED`), the screen taps `STOP` with the input empty at t = 1 s, and sends the typed
prompt `and the builds?` at t = 8 s,
Then `STOP` works as `c1-talk.md` §8 says (`STOPPED AT 07:02` by t = 6.5 s) and the room's stderr
has one line `cockpit: audit append failed for cockpit.stop: …`; the prompt block reads
`YOU · 07:02 · NOT SENT` with `Not sent: the room cannot write its audit log.`, `RETRY` and
`EDIT`; the fake agent's stdin log has no line with `and the builds?`.
And under Q-O21 a): the control API's `/pair` for a second code answers `503
{"error":"audit-unavailable"}` and no screen gets `screen.paired`; `/unpair desk` answers `200
{"name":"desk"}` and `desk`'s link closes with 4402 (S-SCR-16).
Test: Playwright for the screen; `fs.renameSync` from the test; the fake agent's log
(`stand-ins.md` §2.6) for stdin; the room's stderr captured by the boot wrapper; control API for
`/pair` and `/unpair`.

### S-SCR-32 Room down, pane closed on the Wall: a caption says since when, TALK opens the pane, no microphone
Given a screen at 1368x912 (`hasTouch: true`) on the Wall page in `wall`, live, touring, the pane
closed, the fake speech configured (`c2-voice.md` §9), `getUserMedia` wrapped to count calls,
When the room's link stops at t = 0 s (06:41),
Then at t = 4.9 s there is no `[data-cockpit-away]`; at t = 5 s `data-cockpit="room-down"` and
`[data-cockpit-away]` reads `Agent away since 06:41`, its rect right edge 1336 ± 1 px, y 720-752
± 1 px, computed `font-size` 18 px, colour `--text-2`; the talk button has `data-talk="off"`,
`aria-disabled="true"` and no `disabled` attribute; the tour flies on.
When the owner taps the talk button at t = 10 s (down and up after 100 ms),
Then in the first frame after the `pointerdown` the button's computed `background-color` is
`--bg-sunken` and its `border-color` `--text-2` (the pressed state, `c2-voice.md` §3, D180), and
in the frame after the `pointerup` they are `--bg-elevated` and `--line` again;
within 0.2 s of the `pointerup` the pane is open, its scroll top is 0, the status line
`Cockpit room unreachable since 06:41 (0 min). …` is in view under the header, the caption is gone
(the pane covers the corner, §4.1 D), `data-talk` is still `off` and the counter reads 0.
When the owner closes the pane and holds the talk button for 1.0 s at t = 20 s,
Then the pressed state holds for the whole 1.0 s, the pane opens at the release as before, no
hint line reads `LISTENING`, the counter still reads 0 and the fake speech's log has no session
from this screen.
When the owner taps the talk button again at t = 25 s with the pane still open,
Then the button shows the pressed state between down and up; nothing else changes: the pane stays
open at the same scroll top, the line slot `[data-cockpit-line][data-line="room-down"]` reads
`Sending and voice come back with the room.` at computed `font-size` 18 px and colour
`--text-1`, as before the tap, and the counter still reads 0.
When the room's link is back at t = 30 s,
Then by the first frame from the room plus 1 s the caption is gone, `data-talk="idle"` and a
press opens the microphone again (the counter reads 1).
Test: Playwright with `page.clock`, the real room with a fake agent and the fake speech; `POST
/link {"up":false}` and `{"up":true}` on the control API (`stand-ins.md` §1.2); an init script
wraps `navigator.mediaDevices.getUserMedia` to count calls; read the caption's `boundingBox()` and
computed style; `page.touchscreen.tap` for the tap, `mouse.down`/`up` with a 1.0 s clock advance
for the hold, the button's computed `background-color`/`border-color` read after `mouse.down`
(one `requestAnimationFrame`) and after `mouse.up`, compared with the tokens resolved on a probe
element; the fake speech's log (`stand-ins.md` §3.4) for "no session".

### S-SCR-33 A plain-HTTP page cannot pair unless the room allows it, and then says what that costs (pending Q-O21)
Given the real room with a fake agent, `cockpit.allowInsecure` unset, and a screen at 1368x912
(`hasTouch: true`) opening the app at `http://hub.example.invalid:7777/#/map` (the name mapped to
the room under test),
When the owner opens the pane with `CHAT`,
Then the page's `POST /api/cockpit/pair` gets `403 {"error":"insecure-origin"}`; within 1 s
`data-cockpit="unpaired"` and `[data-pair-card="insecure"]` reads `CANNOT PAIR HERE`, `This page
is not HTTPS, so it cannot be paired. docs/cockpit.md says how to get HTTPS on a LAN, or how to
allow it anyway.` and `The board works without a pairing.`, the middle line at computed
`font-size` 18 px; the card has no text matching `^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$`; in the
next 60 s the page sends no second `POST` and no upgrade of `/api/cockpit/ws`; the Map draws as
before.
And an upgrade of `/api/cockpit/ws` with `Origin: http://hub.example.invalid:7777` closes 4403
`insecure-origin` with no frame before it; the same `POST` with `Origin: http://127.0.0.1:{port}`
gets `201` (loopback counts as secure, pending research Q14).
When the room restarts with `cockpit.allowInsecure: true`,
Then its stderr has the line `cockpit: allowInsecure is on: a screen on a plain-HTTP page sends its
device token and its audio unencrypted; anyone on that network can copy the token and talk to the
agent as that screen.` exactly once; after a reload the pane shows the normal pairing card with a
code; `pair --yes` prints the request block with the line `page        http://hub.example.invalid:7777
(not HTTPS: its token travels unencrypted)`; the approved poll's `Set-Cookie` for `lb_cockpit` has
`HttpOnly`, `SameSite=Strict`, `Path=/api/cockpit` and no `Secure`, and `data-cockpit="live"`
within 2 s; a pairing from an `https://cockpit.example.invalid` page on the same room still gets
`Secure`.
When the room restarts with the key unset again,
Then the paired `http:` screen's next upgrade closes 4403 `insecure-origin`, and within 1 s it shows
`[data-pair-card="insecure"]` and no further upgrade for 60 s.
Test: Playwright with `--host-resolver-rules` mapping `hub.example.invalid` to the room under test
(as S-C2-21), `page.clock` for the 60 s; count `/api/cockpit/pair` requests and upgrades with
`page.on('request')`/`page.on('websocket')`; raw `node:http` and `ws` clients for the forged-`Origin`
requests and to read the `Set-Cookie` header; the room's stderr as `protocols.md` §1's boot test
reads it; the `https:` pairing is a raw `POST` and poll with `Origin: https://cockpit.example.invalid`
(that host allowed in the test config), the cookie read from the header (no test certificate needed).

### S-SCR-34 A speak-up on the touring Wall: fly to the node, hold 300 s, the dot stays (pending Q-O11)
Given `coworker.md` §10's room (speak-ups on, quiet hours off, clock manual at 07:14:00, fake agent
`cw-speak`) and the demo fleet; screen `desk` at 1368x912 in `wall` layout, touring, pane closed;
screen `hall` in `wall` layout, pane closed, its wall half tapped at 07:14:10 (`explore`),
When the stuck alarm `stuck:builder-b:acme-billing` (P2) is added with `POST /alarms` at 07:14:00
and the room's clock reaches 07:14:20 (the end of the gather window),
Then on `desk` within 0.3 s of the `speakup` message the root reads `data-wall-state="explore"`
and `data-wall-hold="speakup"`; the flight ends within 0.9 s after it starts (t = f) with
`screenOf('builder-b')` within 2 px of (684, 456), the centre of the full-screen wall; the talk
button has `data-speakup="needs-you"` and its 8 px dot; `[data-show-line]` and `[data-show-mark]` count 0;
And on `hall` the camera has not moved (< 1 px), there is no `data-wall-hold`, and the dot is there;
And on `desk` at f + 299 s it is still `explore` with the hold; at f + 300 s `data-wall-state="tour"`,
`data-wall-hold` is gone and the dot is still there.
When, in a second run, the owner taps `desk`'s wall half at f + 10 s,
Then `data-wall-hold` is gone at once and the tour resumes at f + 70 s.
When, in a third run, the alarm is a P3 `ci-red` on `builder-b` (tier `info`),
Then `[data-raised]` is in the conversation, `desk` keeps `data-wall-state="tour"`, no
`data-wall-hold`, no dot; and in a fourth, a P2 alarm whose `target` and `builder` are no node of
the demo Map (`vm-x`) gives the dot and no flight.
Test: Playwright, two pages on the room under test; the room's clock with `POST /tick`, the page
idle timer with `page.clock.fastForward()`; the flight's start and end from the camera sampled each
frame (`onDraw`); root attributes and `screenOf('builder-b')` at each step; `hall`'s camera from
`camera()` before and after.
