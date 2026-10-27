# C4 Show and the canvas

Part 1 (T10, §1-§6): the show commands, the one camera they share with the Wall's tour, the line
each leaves in the conversation and its one-tap undo. Part 2 (T11, §7-§10): the canvas, its grid
and shelf, the tool `place`, the kit blocks and one-tap removal. Part 3 (T12, §11-§14): custom cards
in their sandbox, how cards leave, promotion. Words (screen, room, show command, card,
block, focus, tool line) are defined in `README.md` §Glossary. Sizes are CSS px at 1368x912; times
in ms or s.

Plan C4: "The agent answers on the screen, not just in text." Its rules, which this file only makes
exact: "**display only**. These change what a screen shows, never the fleet. Every show action
appears as a line in the conversation, and the owner can undo it with one tap."

## 1. Where show commands come from and where they land

- **They are MCP tools** on the `laneboard` server of `c3-see.md` §1 (D58): `fly_to`, `highlight`,
  `clear`, `pin`, `compare`, `scrub`, seen by the agent as `mcp__laneboard__<name>`. The room checks
  every argument against the schemas in §3 (a bad one is JSON-RPC `-32602` naming the field, as
  `c3-see.md` §1), then sends one `show` message to each target screen over that screen's room
  connection (message shape, ids and resume: `protocols.md` §4).
- **A camera** is the Map drawn on a screen: the wall half of the Wall page (layouts `wall`, `split`,
  and `switch`, `screens.md` §1), and the app while its route is `#/map`. A screen in `canvas`
  layout, or the app on any other view, has no camera.
- **Targets** (D67). Every show command takes `screen`: a paired screen's name or `all`, default
  `all`. `all` means every online screen that has a camera now. A screen without a camera ignores
  the command; the line still appears in its conversation (§4). The app never changes its route to
  get a camera: on `#/board` a `fly_to` changes nothing there (D69).
- **The agent learns what happened.** Each show command returns (one `text` item and the same
  `structuredContent`, `c3-see.md` §3):

  ```json
  {"showId":"sh-0041","shown":["desk"],"waiting":[],"skipped":[{"screen":"hall","why":"in use"}],
   "noCamera":["canvas2"]}
  ```

  `shown` and `skipped` are filled when every target screen has answered or after 1.0 s, whichever
  comes first; a screen that answers later is listed in `waiting`. When `shown` and `waiting` are
  both empty the result adds `"hint":"No screen shows the map now; say it in words."`. This is not
  an error (`isError` stays false): the agent goes on answering in text.
- **Limits** (D76). At most 20 show commands per turn; the 21st returns `isError`
  `Too many show commands in one answer.` A camera command that reaches a screen while that
  screen's previous show flight is still running replaces it: the new flight starts from where the
  camera is, and only the newer line keeps `UNDO` (§5).
- **Speak-up turns** (a turn the agent starts, `coworker.md`, T13) use the same commands; whether a
  speak-up may move a camera during quiet hours is T13's.

## 2. One camera with the tour

Plan §7 question 5: "Can the Wall's tour mode and C4 share one camera controller?" Yes. There is
one camera per Map drawn; the tour, a finger and a show command all move it through the same Map
functions. A show command is treated like a touch that did not come from the owner:

| Before | A camera show command arrives | After its movement ends |
| --- | --- | --- |
| Wall `tour` | the tour stops mid-flight, `data-wall-state="explore"`, the show flight starts from where the camera is | the idle timer restarts at 60 s (`screens.md` §2); at 0 the tour resumes with the overview |
| Wall `explore`, pane closed | the show flight starts | the idle timer restarts at 60 s |
| Wall `explore`, pane open, or a turn running | the show flight starts | the timer stays paused (`screens.md` §2) until the pane closes or the turn ends |
| App `#/map` | the show flight starts | nothing (the app has no tour) |

- **Flight time** (D68). A show flight uses the Map's own `flight()` (`public/js/core/motion.js`,
  320-900 ms by distance), never the tour's slower flights, because the owner is waiting for it.
  Its first frame is drawn within B5 (≤ 0.3 s after the room receives the command, `README.md`
  speed budget). A command that only draws (a `highlight` whose nodes are all in sight, `clear`,
  `pin`) has no flight; its marks are drawn within the same 0.3 s.
- **Where the target lands.** Centred in the part of the Map in sight: left of the pane when it is
  open (x 0-759, `c1-talk.md` §1; the whole viewport, behind the pane, when the pane is full width
  under 900 px, §1.2, D249), left of the inspector when it is open (the Map's insets,
  `setInsets`), the whole wall half in `split` (x 0-759).
- **The owner's finger wins** (D70). If the owner touched that screen's camera (a pointer on the Map
  or the wall half, not on the pane) in the last 3 s, or a finger is still down, the command waits
  on that screen until 3 s after the last touch ends. If it has waited 10 s it is dropped on that
  screen: `skipped` with `"why":"in use"`, and the line says so (§4). Touches on the pane, the
  canvas or a card do not count.
- **The tour clears what the agent drew.** When the idle timer brings the tour back, the screen
  drops its highlight, note, compare and scrub state (§3) and the last line's `UNDO` (§5). Pins stay
  (§3.4, pending Q-O4).
- **Reduced motion** (`prefers-reduced-motion: reduce`, `screens.md` §2): no flight; the camera
  jumps in one frame; marks appear without their 300 ms close-in.
- **State is the screen's.** Each screen keeps its own show state (camera before the command,
  highlight, note, compare, scrub) in memory; a reload drops it and the tour or the Map starts as
  usual. Pins are the exception: the room keeps them (§3.4).

**What C4 needs from the camera** (the Wall contract, `screens.md` §9.2 M1-M8, which is the one list; the app's Map gets the same as
new functions of `createMap` in `public/js/views/map/index.js`, default off, existing Map tests
unchanged): `flyTo(id)` with the normal flight (today's `focus`), `fitNodes(ids)` (fly so every id
is in sight with 64 px to spare), `camera()` and `setCamera(cam, {flight})` (save and restore, for
undo), `screenOf(id)` and `onDraw(cb)` (anchor marks and pins every frame), `tour.pause()` /
`tour.resume()` and the idle hook (`screens.md` §2).

## 3. The commands

Each command lists its `description` (word for word, what the agent reads), its parameters (bold
= required), what the screen does, and the words of its line (§4). Every command also takes
`screen` (§1). A node parameter takes a node id, or a label matched case-insensitively and in
full; an unknown one returns `isError` `No node "vm-x". Nodes like it: vm-b, vm-c.` (at most 5,
nearest by edit distance), an ambiguous label `"backup" is 2 nodes: room-backup, svc-backup. Give the id.`
Every string the agent writes (`note`, card text) is drawn as text, never markup, and cut to its
limit with `…` (`security.md` §4, I8).

### 3.1 `fly_to`

"Move the map on the owner's screens to one node, so they see it. Display only."

| Param | Type | Rule |
| --- | --- | --- |
| **`node`** | string | a node id or label |

- The camera flies to the node with the Map's `flyTo` zoom (1.9) and centres it in sight (§2).
- No selection, no route change, no inspector (D69): `sel` in the hash stays what it was.
- Line: `showed {label}`.

### 3.2 `highlight`

"Mark nodes on the owner's screens, with an optional short note. Replaces the marks shown before.
Display only."

| Param | Type | Rule |
| --- | --- | --- |
| **`nodes`** | string[] | 1-12 node ids or labels |
| `note` | string | at most 120 characters, plain text |

- **Camera.** If every node is already in sight, the camera stays. Otherwise it flies with
  `fitNodes(nodes)`.
- **Marks** (D72) `[data-show-mark]` with `data-node`: four corner brackets around each node, 2 px
  `--accent`, 12 px arms, set 8 px outside the node's drawn radius, closing in from 24 px over
  300 ms. The accent marks "look here"; a status keeps its own hue and shape on the node
  (`docs/design.md` rule 3: the accent is spent on focus, never on a state). Every other node fades
  to the Map's unlit emphasis (`UNLIT` 0.16) over the Map's fade.
- **The note** `[data-show-note]`, only with `note`: a plate 16 px from the first node's brackets,
  placed like the ask menu (`c3-see.md` §9.3: up and right, flipped near an edge), 360 px wide at
  most, `--bg-elevated`, 1 px `--line-strong` border, 16 px padding. First line `AGENT · 07:12`
  (16 px caps `--text-3`, the time the command arrived); then the note, 20 px `--text-1`, at most 3
  lines. The `AGENT` line is what tells the agent's words from the board's own.
- A new `highlight` replaces marks and note. They also go with `clear`, `UNDO`, the tour coming
  back (§2), and in the app a route change.
- Line: `marked {label}`; 2-3 nodes `marked {label}, {label} and {label}`; more `marked {label},
  {label} and {n} more`.

### 3.3 `clear`

"Remove the marks, note, comparison and past view the agent put on the owner's screens. Pins and
canvas cards stay."

No parameters but `screen`. The camera does not move. Removes highlight marks, the note, the
compare card and its brackets, and ends a scrub (back to now). Pins and canvas cards stay: they
have their own `✕` (§3.4, §9). Line: `cleared the marks`. On a screen with nothing to clear the
line is still written and `UNDO` is not drawn there.

### 3.4 `pin`

"Pin a small card next to a node on the owner's screens: text, a chart, a log excerpt or a diff.
It stays until removed. Display only."

| Param | Type | Rule |
| --- | --- | --- |
| **`node`** | string | a node id or label |
| **`card`** | object | `{"block":"text","title":…,"body":…}`; `chart`, `log` and `diff` take the kit blocks' fields (§8) |

The `text` block: `title` at most 48 characters, `body` at most 280 characters.

- **Look** `[data-pin]` with `data-pin-id` and `data-node`: 320 px wide, at most 240 px tall,
  `--bg-elevated`, 1 px `--line-strong` border. A 48 px header: `AGENT · 07:12` (16 px caps
  `--text-3`) at 16 px from the left; a remove button `[data-pin-remove]` 48x48 px, `✕` 24 px
  `--text-2`, `aria-label="Remove pin"`, flush right. Then 16 px padding: `title` 20 px `--text-1`,
  `body` 18 px `--text-1`, cut with `…` at the card's height.
- **Place.** Its left edge 48 px right of the node's drawn centre, centred on it vertically; flipped
  to the left if it would cross the right edge of the part in sight; kept 16 px inside it. A 1 px
  `--line-strong` leader joins the node's edge to the card. The card follows its node every frame
  (`onDraw`); while the node is out of sight the card is hidden. A card that would overlap an
  earlier pin moves down by the overlap plus 8 px.
- **How many** (D73). At most 3 pins at once, shared by every screen. A 4th replaces the oldest; the
  result names it (`"replaced":"pin-0007"`) and the replaced pin's line reads ` · replaced`.
- **Who keeps them** (D73). The room keeps the pins in memory with the conversation: every screen
  with a camera draws them, a reconnecting or reloaded screen gets them again, and `NEW`
  (`c1-talk.md` §11) or a room restart drops them. They stay through the tour (pending Q-O4).
- **They leave** by `✕` (on any screen, gone on all within 0.3 s), by their line's `UNDO`, by a 4th
  pin, or by `NEW`. `clear` keeps them. Removal on screen: the `CARD REMOVED · UNDO` row of §9 applies to pins
  too.
- Line: `pinned a note to {label}` (`text`), `pinned a chart to {label}`, `pinned a log to {label}`,
  `pinned a diff to {label}`.

### 3.5 `compare`

"Show two nodes or two runs side by side on the owner's screens. Display only."

| Param | Type | Rule |
| --- | --- | --- |
| **`a`**, **`b`** | string | two node ids or labels, or two run ids (both the same kind) |
| `kind` | string | `node` (default) or `run` |

Time ranges ("tonight against last night") need the stored history `scrub` needs (§3.6) and are not
in v1 (D74).

- **Camera.** `fitNodes([a, b])`; for runs, the nodes of the two runs' builders (the same builder
  twice: that one node).
- **Marks.** As `highlight`, two nodes, with a 16 px caps letter `A` or `B` in `--text-1` at the
  top-left corner of each bracket set. No note.
- **The compare card** `[data-compare]`: 560 px wide, centred in the part in sight, its bottom 24 px
  above that part's bottom (on the Wall 120 px above the screen's bottom, clear of the Wall's
  bottom lines). `--bg-elevated`, 1 px `--line-strong`. A 48 px header: `AGENT · COMPARE · AS OF
  07:12` (16 px caps `--text-3`) and a 48x48 `✕`. Under it two columns of 264 px with 16 px between,
  headed `A {label}` and `B {label}` (mono 20 px `--text-1`); then rows of 40 px, 18 px, the field
  name in `--text-3`, the value in `--text-1`:
  - nodes: `status` (word and its mark, in its hue as on the Map), `why`, `cpu`, `mem`, `up since`;
  - runs: `state`, `round`, `last score`, `stuck`, `cost` (`c3-see.md` §4.2 fields).
  A field the board does not have reads `—`. The values are read once, at the command (D74); the
  card is not live.
- One compare at a time: a new one replaces it. It goes with `✕`, `clear`, `UNDO`, the tour coming
  back, and in the app a route change.
- Line: `compared {a} and {b}`.

### 3.6 `scrub`

"Show the map as it was at a past moment. Needs the board's stored history."

| Param | Type | Rule |
| --- | --- | --- |
| **`at`** | string | ISO time, `HH:MM` (today, or yesterday if later than now), or `-2h`, `-90m`; at most 7 d back |

**Not in C4's first slice** (D75). The board keeps no map history: the Map's events are the last 80
in memory (`c3-see.md` §4.7, §6). Until a stored history exists (a board change: map snapshots on
disk and `GET /api/map?at=`, listed in `slices.md`, T20), `scrub` returns `isError`
`The board keeps no map history yet, so I cannot show the past; I can describe it from history.`
and its line is `could not show the map at 02:10 · failed`.

Once it exists:
- The camera stays; every node takes the status it had at `at`; live updates are held back for that
  screen. A plate `[data-scrub]`, top centre of the part in sight, 48 px tall, `--bg-sunken`,
  1 px `--line-strong`: `MAP AT 02:10 (5 h 2 AGO)` (20 px caps `--text-1`; format per T65) and
  `BACK TO NOW` (48 px tall, 16 px caps, 1 px `--accent` border).
- `BACK TO NOW`, `clear`, `UNDO`, the tour coming back or a route change return to now in one frame.
- Line: `showed the map at 02:10`.

## 4. The line in the conversation

Each show command leaves one **show line** `[data-show-line]` with `data-show-id`, in the reply
where the call happened, between text blocks and tool lines (`c1-talk.md` §3). Show lines never
fold, not even two in a row.

- **Look** (D77). 56 px tall, the full text column; mono 18 px `--text-2`, no glyph. At the right end
  `UNDO` `[data-show-undo]`: 48 px tall, 96 px wide, 16 px caps `--text-1`, 1 px `--line-strong`
  border, 8 px from the text.
- **Two in a row** (D252, T98). A show line directly after another show line has an 8 px
  `margin-top`, so two `UNDO`s one above the other are 16 px apart (4 px of each row around its
  48 px `UNDO`, plus the 8 px). `UNDO` stays 48 px tall; the row does not shrink. The margin stays
  when a line loses its `UNDO`, so nothing moves under the finger.
- **Words** (§3 per command). `{label}` is the node's label as the board shows it, cut to 32
  characters, drawn as text. Suffixes, in the same grey:

  | State (`data-show-state`) | Suffix | `UNDO` |
  | --- | --- | --- |
  | `shown` | none | while undoable (§5) |
  | `waiting` (the finger rule, §2) | ` · waiting for you` | no |
  | `skipped` on this screen, shown on another | ` · not on this screen: in use` | no on this screen |
  | `noCamera`: no screen shown it | ` · no screen shows the map` | no |
  | `undone` | ` · undone` | gone |
  | `replaced` (pins) | ` · replaced` | gone |
  | `failed` (an `isError` result) | ` · failed`, and for an unknown node the line is `could not show "vm-x" · failed` | no |

- A screen that has no camera writes the line as on the others (the suffix comes from the room's
  overall result), so every screen's conversation reads the same apart from `skipped`.
- Show lines are kept in the conversation like text: a pane opened later, or a reloaded screen,
  shows them with their current suffix.

## 5. Undo

One tap on `UNDO` puts back what the command changed, on every screen it changed, within 0.3 s
(D71). Any screen's `UNDO` works, also one whose own camera was not moved.

- **Camera commands** (`fly_to`, `highlight`, `clear`, `compare`, `scrub`): each target screen saved
  its state just before the command: the camera, the marks, note, compare and scrub, and the Wall
  state. `UNDO` restores that state, the camera by a normal flight (§2). If the Wall was touring
  before, `UNDO` resumes the tour at once (with the overview, `screens.md` §2), without waiting
  60 s.
- **Only the latest camera command is undoable.** When a newer camera command reaches the same
  screens, the older line loses its `UNDO`. The tour coming back (§2) and a reload drop it too.
- **A command that replaces a running show flight** (§1) takes over that command's saved state, so
  its `UNDO` goes back to before both.
- **A pin's `UNDO`** removes that pin, as long as it exists; it does not move a camera.
- `UNDO` on a screen that left the Map since (the app on another view) restores nothing on that
  screen; the other screens still undo.
- An undo is not a show command: it writes no line, only the suffix ` · undone`, and the agent is
  not told during the turn. The room adds the undo to the next prompt's focus (`c3-see.md` §8.2:
  `"undone":["sh-0041"]`), so "no, the other one" can be read.

## 6. Scenarios

Harness as `c3-see.md` §7: the demo hub with its fake builders, the room under test, and the fake agent
(T18) whose scripts call the show commands at set times; Playwright at 1368x912 on paired screens.
B5 is read from the marks `cockpit:B5:start` (the room's receive time, carried in the `show`
message) and `cockpit:B5:end` (`README.md` speed budget). Camera positions are read with
`screenOf(id)`; "centred" is within 24 px of the centre of the part in sight.

### S-C4-01 `fly_to` takes the touring Wall to the node, then the tour comes back
Given screen `desk` in `wall` layout touring the demo fleet, the pane closed,
When the fake agent calls `fly_to {"node":"builder-a"}` at t = 0 s,
Then within 0.3 s the camera's first frame of movement is drawn (B5) and `data-wall-state` is
`explore`; the flight ends between t = 0.32 s and t = 1.2 s with `builder-a` centred; the hash and
the Map's selection are unchanged; the result is `{"shown":["desk"],…}`; the conversation has one
show line `showed builder-a` with `UNDO`.
And at t = end + 59 s it is still `explore`, at t = end + 60 s `tour`, and `UNDO` is gone.
Test: Playwright with `page.clock`; read the B5 marks, `data-wall-state`, `screenOf('builder-a')`
at the flight's end, `location.hash`, `[data-show-line]` text and `[data-show-undo]` presence at
each step.

### S-C4-02 One tap on `UNDO` on another screen puts the Wall back on its tour
Given S-C4-01 at t = 5 s (screen `desk` explores at `builder-a`) and screen `side` in `canvas`
layout with the pane's conversation in sight,
When the owner taps `UNDO` on `side`,
Then within 0.3 s `desk` is `tour` again and its camera flies to the overview; both screens' lines
read `showed builder-a · undone` with no `UNDO`; `side`'s DOM has no camera change.
Test: two browser contexts on one fake agent; tap `[data-show-undo]` on `side`; assert
`data-wall-state` on `desk`, both lines' text, and no `[data-show-undo]` anywhere.

### S-C4-03 The app centres left of the pane, and a view without a map does not move
Given screen `desk` on the app at `#/map` with the pane open, and screen `lap` on the app at
`#/board`,
When the fake agent calls `fly_to {"node":"vm-b"}`,
Then on `desk` `vm-b` ends centred in x 0-759 (at 380 ± 24 px); on `lap` the route stays `#/board`
and nothing moves; the result is `{"shown":["desk"],"noCamera":["lap"],…}`; both conversations show
`showed vm-b`.
When `desk` is also moved to `#/board` and the agent calls `fly_to` again,
Then the result has `"hint":"No screen shows the map now; say it in words."` and the line reads
`showed vm-b · no screen shows the map`, without `UNDO`.
Test: two contexts; read `screenOf('vm-b')`, `location.hash` on both, the tool result in the fake
agent's received log, and the lines.

### S-C4-04 `highlight` marks two nodes with a note, the next one replaces it
Given `desk` in `split`, `vm-b` and `builder-b` both in sight,
When the fake agent calls `highlight {"nodes":["vm-b","builder-b"],"note":"same task failed twice <b>here</b>"}`,
Then within 0.3 s the camera has not moved (both were in sight); two `[data-show-mark]` exist with
`data-node` `room-b` and `builder-b`, their brackets in `--accent`; other nodes' emphasis is 0.16
after 1 s; `[data-show-note]` reads `AGENT · 07:12` and the note with `<b>here</b>` as literal text;
the line is `marked vm-b and builder-b` with `UNDO`.
When the agent then calls `highlight {"nodes":["ci"]}`,
Then the two marks and the note are gone, `ci` is marked, the first line has lost its `UNDO`.
Test: read `[data-show-mark]` nodes and computed `border-color`, the Map's `emphasis(id)`, the note's
`textContent` and that it has no child elements, and both lines.

### S-C4-05 `clear` removes the marks and keeps the camera, the pins and the cards; `UNDO` brings them back
Given `desk` with S-C4-04's two marks and note, one pin on `vm-b` and one canvas card,
When the fake agent calls `clear {}`,
Then within 0.3 s no `[data-show-mark]` and no `[data-show-note]` exist, the camera moved < 1 px,
the pin and the canvas card are still there; the line is `cleared the marks` with `UNDO`.
When the owner taps that `UNDO`,
Then the two marks and the note are back, the line reads `cleared the marks · undone`.
Test: count elements before and after; compare `screenOf('vm-b')` before and after.

### S-C4-06 A pin follows its node, is shared, and a fourth replaces the oldest
Given `desk` (`wall`) and `side` (`split`), one conversation, no pins,
When the fake agent pins `text` cards to `vm-b`, `builder-a` and `ci` at t = 0, 1, 2 s,
Then each `[data-pin]` is 320 px wide, its left edge 48 px right of its node's centre (or flipped),
on both screens; the owner pans `desk` by 200 px and the `vm-b` pin moves with it within one frame.
When a 4th pin to `hv1` arrives,
Then the `vm-b` pin is gone on both screens, its line reads ` · replaced`, the result has
`"replaced"` naming it.
When the owner taps `✕` on the `ci` pin on `side`,
Then it is gone on `desk` within 0.3 s.
When the idle timer brings the tour back on `desk`,
Then the remaining pins are still drawn there (pending Q-O4); after `side` reloads, they are drawn
there again.
Test: two contexts; read pin rects against `screenOf()`, drag with `page.mouse`, count pins on both,
fast-forward the clock, reload.

### S-C4-07 `compare` two nodes: fitted, lettered, one card side by side
Given `desk` in `wall` layout, `vm-b` and `vm-c` far apart,
When the fake agent calls `compare {"a":"vm-b","b":"vm-c"}`,
Then the camera flies so both are in sight with ≥ 64 px to spare; brackets with `A` on `vm-b` and
`B` on `vm-c`; `[data-compare]` is 560 px wide, centred in the wall half, its bottom at y 792; it has
columns `A vm-b` and `B vm-c` and the rows `status`, `why`, `cpu`, `mem`, `up since`, `—` where
the demo node has no value; the line is `compared vm-b and vm-c` with `UNDO`.
When the demo fleet changes `vm-b`'s cpu,
Then the card's value does not change (read once).
Test: read rects and texts; change the demo hub's node; assert the card is unchanged.

### S-C4-08 The owner's finger wins; a command waits, then gives up
Given `desk` in `wall` explore, the owner dragging the map with a finger held down from t = 0 s,
When the fake agent calls `fly_to {"node":"builder-a"}` at t = 1 s,
Then the camera follows only the finger; the line reads `showed builder-a · waiting for you`.
When the finger lifts at t = 4 s and nothing touches,
Then the flight starts at t = 7 s (3 s after the lift) and the line becomes `showed builder-a` with
`UNDO`.
And in a second run where the owner keeps dragging until t = 12 s, at t = 11 s the command is
dropped on `desk`: the line reads `showed builder-a · no screen shows the map` (no other screen),
the result lists `{"screen":"desk","why":"in use"}` under `skipped`, and the flight never starts.
Test: `page.mouse.down/move` held with a fake clock; assert `screenOf('builder-a')` stays off centre
until 7 s; second run asserts the line and the result.

### S-C4-09 Bad commands fail plainly and change nothing
Given `desk` in `wall` touring,
When the fake agent calls `fly_to {"node":"vm-x"}`, then `highlight {"nodes":[]}`, then 21 show
commands in one turn,
Then the first returns `isError` `No node "vm-x". Nodes like it: vm-b, vm-c.` and the line reads
`could not show "vm-x" · failed`; the second is JSON-RPC `-32602` naming `nodes`, with no line; the
21st returns `Too many show commands in one answer.`; `data-wall-state` stays `tour` through the
failed ones.
Test: the fake agent's received log for the results; the lines; `data-wall-state`.

### S-C4-10 Two flights in a row: the second takes over mid-flight
Given `desk` in `wall` explore,
When the fake agent calls `fly_to vm-b` and, 200 ms later (mid-flight), `fly_to ci`,
Then the camera turns toward `ci` from where it was, with no jump (< 40 px of move between two frames
at 1368x912), and ends on `ci`; only `showed ci` has `UNDO`, and `showed vm-b` has none; that `UNDO` returns
the camera to where it was before `fly_to vm-b` (§5: the replacing command takes over the saved
state).
Test: sample `screenOf('ci')` every frame through `onDraw`; tap `UNDO`, compare the camera with the
one read just before the first command.

### S-C4-11 Reduced motion: the camera jumps
Given `desk` in `wall` touring with `prefers-reduced-motion: reduce`,
When the fake agent calls `fly_to builder-a` then `highlight ["builder-a"]`,
Then the camera is at `builder-a` in the first frame after the command (no frames in between) and
the brackets are at their final size in their first frame.
Test: `page.emulateMedia({reducedMotion:'reduce'})`; sample frames; bracket rects equal in frame 1
and frame 10.

### S-C4-12 `scrub` before the board has history
Given any screen,
When the fake agent calls `scrub {"at":"02:10"}`,
Then it returns `isError` `The board keeps no map history yet, so I cannot show the past; I can
describe it from history.`, no `[data-scrub]` exists, the camera does not move, and the line reads
`could not show the map at 02:10 · failed`.
Test: the result in the fake agent's log; no `[data-scrub]`; `data-wall-state` unchanged.

## 7. The canvas

Part 2 (T11, §7-§10). Plan C4b: "an open surface where the agent puts things for the owner".
`spec-input.md` §5: "it must be fast: a timer must not take 5 minutes", answered by "a kit of
ready-made blocks (seconds)". Which layouts have a canvas, and the empty canvas, are
`screens.md` §1 and S-SCR-10; a canvas arrives with C4 (pending Q-O22).

### 7.1 The card area

The canvas holds the conversation column and the **card area** (pending Q-O12: the conversation is
a fixed column of the canvas, never a pane over the cards; D78). At 1368x912:

| Layout | Card area | Conversation column | Grid |
| --- | --- | --- | --- |
| `canvas`, and `switch` while it shows the canvas | x 0-759, y 0-912 | x 760-1368, y 0-912, 1 px `--line` left border | 2 columns x 3 rows: columns x 100-372 and 388-660, rows y 24-256, 272-504, 520-752 |
| `split` | x 760-1368, y 0-520 | x 760-1368, y 520-912 (392 px), 1 px `--line` top border | 2 columns x 2 rows: columns x 784-1056 and 1072-1344, rows y 24-256, 272-504 |
| `split`, folded (`data-canvas="strip"`, pending Q-O13) | none drawn: the 96 px strip x 1272-1368 shows the count | none drawn (the talk button stays at x 1280-1344, y 824-888) | none; packing and the shelf keep their state and come back as they were on opening |

- **One cell** is 272 x 232 px; cells are 16 px apart. The card area keeps 24 px free at its left,
  right and top and 16 px at its bottom; the grid is centred across the area's width.
- **Other screen sizes**: as many 272 px columns as fit in (area width − 48), as many 232 px rows as
  fit in (area height − 40), at least 1 x 1. Cell size never changes, so a block looks the same on
  every screen (`screens.md` §1, "one fixed size").
- In `split` the conversation column is 392 px tall: its 64 px header, 224 px of conversation (about
  5 lines at 28 px, pending Q-O18) and the 104 px input row (`c1-talk.md` §1). The column's parts and their rects
  are in `c1-talk.md` §1 (D117).
- **Folding** (pending Q-O13): in `split` an idle canvas folds to a 96 px strip after 300 s and
  opens again on a turn, a card, a tap or the talk button; the rules, the strip's rects and
  S-SCR-38 are `screens.md` §1.1 (D284, D285). A card bound to a scheduled job keeps it open. The
  rest of this section describes the canvas open.

### 7.2 Sizes, order and the shelf

Every card has one of four **sizes** (`data-size`): `s` 1x1 (272 x 232), `w` 2x1 (560 x 232),
`t` 1x2 (272 x 480), `l` 2x2 (560 x 480). Each block (§8) has a default size and the sizes it allows.

- **One list, in the room.** The room keeps the canvas cards as one ordered list, newest first, the
  same for every screen (`screens.md` §3: "Same cards, same order on each").
- **Packing** (D79). Each screen walks the list newest first and puts each card into the first slot,
  in reading order (rows top to bottom, cells left to right), where all its cells are free. A card
  that fits nowhere goes to **that screen's shelf**; older, smaller cards still fill gaps. So the
  newest card is always top left, and a small screen shelves more than a big one.
- **Moving.** When a card arrives or leaves, the others move to their new slots in 200 ms
  (`transform`, `--ease`); the new card fades in over 120 ms. Reduced motion: no movement, one frame.
- **The shelf.** While a screen's shelf holds cards, the conversation column's header shows
  `SHELF 2` `[data-shelf]` (48 px tall, 96 px wide, 16 px caps `--text-1`, 1 px `--line-strong`),
  8 px left of `NEW` (order from the right: `SCREEN`, `NEW`, `SHELF`; a fixed column has no `CLOSE`,
  `c1-talk.md` §1). A tap opens the **shelf sheet** over the card area: header 64 px `SHELF · CARDS
  THAT DO NOT FIT HERE` (16 px caps `--text-2`) and `CLOSE` (48 x 96); then one 64 px row per
  shelved card: block word and title (20 px `--text-1`, cut with `…`), `AGENT · 07:12` (16 px caps
  `--text-3`), `TO FRONT` (48 x 120) and `✕` (48 x 48), 16 px apart. `TO FRONT` moves the card to the
  front of the room's list (every screen repacks within 0.3 s) and closes the sheet; a tap outside
  the sheet closes it too.
- **How many** (D80, pending Q-O4). At most 16 cards in the list. A 17th removes the oldest card that
  is not bound to a scheduled job (a job's countdown stays: `spec-input.md` §6 "Scheduled jobs are
  visible"); the result names it (`"removed":"card-0002"`) and its line reads ` · removed: canvas
  full`. When all 16 are job countdowns, `place` returns `isError` `The canvas is full of job
  countdowns; ask the owner to remove one.`

### 7.3 The card frame

Every canvas card is `[data-card]` with `data-card-id`, `data-block`, `data-size`:

- `--bg-elevated`, 1 px `--line-strong` border, no shadow, no radius beyond the board's own.
- **Header**, 48 px: `AGENT · 07:12` at 16 px from the left (16 px caps `--text-3`): who made it and
  when it was placed (plan C4b: "every card says who made it and when"). A card replaced in place
  (§7.4) reads `AGENT · 07:12 · NEW 07:20`. A card the room places itself (`card.put` `by`
  `cockpit`: a speak-up's card, a job's countdown, `coworker.md` §3.3, §6.6) reads `COCKPIT · 07:14`
  in the same style (D198); the owner did not ask for it and the agent did not make it. Demo cards
  read `DEMO` (`screens.md` S-SCR-10). Then,
  when it applies, one plate (16 px caps `--text-3`, 1 px `--line-strong` border, 8 px left
  margin): `STALE` while the room is down (§7.6), or `AS OF 02:10` when the bound source
  is older than 10 min (`c3-see.md` §3, `stale`).
- **Remove** `[data-card-remove]`: 48 x 48, flush top right, `✕` 24 px `--text-2`,
  `aria-label="Remove card"`. No other target within 8 px of it (T46); a grown card's `LESS` sits
  16 px left of it (§8.10).
- **Title**: 28 px row under the header, 16 px side padding, 20 px `--text-1`, one line, cut with `…`.
  At most 48 characters; each block has a default title (§8).
- **Body**: the block (§8), 16 px side padding, 8 px under the title, 16 px bottom padding. A body is
  therefore 132 px tall in `s` and `w`, 380 px in `t` and `l`.
- Every string the agent writes is drawn as text, never markup, and cut to its limit with `…`
  (§3, `security.md` §4, I8).

### 7.4 The tool `place`

"Put a card on the owner's canvas: a ready-made block with its data (countdown, timer, status, log,
chart, table, checklist, map, text, diff). A card bound to fleet data stays live. Display only."

| Param | Type | Rule |
| --- | --- | --- |
| **`block`** | string | one of the blocks in §8, `custom` (§11) or `saved` (§13) |
| `title` | string | at most 48 characters; default per block |
| `size` | string | `s`, `w`, `t` or `l`, one the block allows; default per block |
| `replace` | string | a card id: that card's content and title change in place, its slot and age stay |
| `expires` | string | an ISO time or `+15m` … `+7d`: the card leaves then (§12.2); default none |
| … | | the block's own fields (§8) |

- No `screen`: a card goes to the room's one list and every screen with a canvas draws it.
- The room checks the fields (a bad one is JSON-RPC `-32602` naming it, no line), resolves a bound
  node, run or job (unknown: `isError` as §3, `No node "vm-x". Nodes like it: vm-b, vm-c.`), reads
  the bound data (§7.5), then sends the card to the screens. It counts toward the 20 show commands
  per turn (D76).
- **Result**, after every canvas screen has answered or 1.0 s:

  ```json
  {"card":"card-0004","drawn":["side"],"shelved":["desk"],"waiting":[],"noCanvas":["hall"],"removed":null}
  ```

  When no screen has a canvas: `"hint":"No screen shows the canvas now; the card waits there. Say it
  in words too."` (not an error).
- **B6**: the card is drawn with its data ≤ 1.0 s after the room receives the call
  (`README.md` speed budget). A bound read that has not answered after 0.8 s does not hold the card
  back: it is drawn with `Reading…` (18 px `--text-2`) in its body, filled when the data comes.
- **Line**: `put a countdown "shut off vm-c" on the canvas` (`a status tile`, `a log`, `a chart`,
  `a timer`, `a table`, `a checklist`, `a map`, `a note`, `a diff`; the title cut to 32 characters,
  as text). With `replace`: `updated the card "shut off vm-c"`. Suffixes as §4, plus
  ` · no screen shows the canvas` and ` · removed: canvas full`.
- **`UNDO`** on a `place` line removes the card while it exists; on a `replace` line it puts back the
  version before (D82). Like a pin's (§5), it moves no camera and is not dropped by a newer camera
  command. A card removed this way gets the same way back as one removed with `✕`, on the screen
  where `UNDO` was tapped (§9, D252).
- A block the build has not made yet (pending Q-O3, §8) returns `isError` `The canvas has no "table"
  block yet. Blocks now: countdown, status, log, chart, text, diff.`

### 7.5 Live data

- **The room binds** (D81). A bound card names its source (a node, run, alert, branch, job); the room
  reads it with the same board reads as the MCP tools (`c3-see.md` §2, 5 s cache) and sends the
  card's data to every canvas screen over the room connection (`card.data`, `protocols.md` §5).
  Screens never read the board for a card, so a card looks the same on every screen and a canvas
  screen needs no board access of its own.
- **Refresh**: every 10 s per card while at least one canvas screen is online; one read per URL per
  5 s for all cards together. A change is drawn within 0.3 s of the room's read.
- **Clocks**: countdowns and timers tick on the screen's clock each second, anchored to times the
  room sends, so they keep counting while the room is down (§7.6).
- **Room down**: §7.6.
- **Kept** (D85, pending Q-O24): the room writes the list to `<stateDir>/cockpit/cards.json` (0600)
  on every change, so cards survive a room restart and `NEW` (`c1-talk.md` §11; pins do not, D73).
  A removed card is gone from the file at once. Chart samples (§8.5) are memory only.

### 7.6 Room down

The canvas half of `screens.md` §7 (moved here by T52, D120); same 5 s grace, same `data-cockpit`
values, same time format (`README.md` §"Times on the screen", D232: these lines hold a condition, so
`since {clock} ({age})`, redrawn every 1 s). The pane's half (status line, `RETRY NOW`, `SEND` and talk `off`)
stays in `screens.md` §7.

- **Strip** `[data-cockpit-down]` across the top of the card area, 80 px tall (two lines at 576 px,
  D54), 18 px `--text-2` on `--bg-sunken`, 1 px `--line-strong` bottom border: `Cockpit room
  unreachable since 06:41 (3 min). Cards show their last values.` Cards move down by 80 px; none is shelved
  because of it. With the screen offline it reads `This screen is offline since 06:41 (3 min). Check its
  network.` (`screens.md` §7).
- **Cards** stay where they were. Every bound card (§7.5) gets the `STALE` plate (§7.3) and keeps
  its last values; a card with no binding (`text`, `diff`) gets none.
- **Clocks**: `countdown` and `timer` keep ticking on the screen's clock (§7.5). In a countdown
  bound to a job, the `at` line (§8.1) gives its row to `Room down: may not run.`
  `[data-card-job-down]` (18 px `--font-label` weight 500, `--text-1`, one line, 24 px; 155 px in
  the condensed face, 233 px in the fallback, both inside the 240 px body), and its `CANCEL JOB`
  is `disabled` (Jobs slice, `slices.md`; whether a cancel may wait for the room is Q-O25). So
  the `s` body stays digits 56 + line 24 + `CANCEL JOB` 48 = 128 px of 132 px and the card keeps
  its size (D275); the `at` line comes back with the room.
- **Remove** (§9) works: the card goes on this screen at once with the usual `CARD REMOVED · UNDO`
  row, and the screen sends `card.close` (`protocols.md` §5) at the first frame after the room is
  back. A card the room no longer holds by then is simply gone.
- **Empty canvas**: instead of S-SCR-10's texts, `The cockpit room is unreachable, so the agent
  cannot place cards now.` (24 px `--text-1`) and `Unreachable since 06:41 (3 min).` (20 px `--text-2`).
- **Back**: at the first frame from the room the strip goes, `STALE` plates go, values update from
  the room's next `card.data`, cards placed or removed meanwhile appear or go (snapshot,
  `protocols.md` §2.2), `Room down: may not run.` gives the row back to the `at` line and
  `CANCEL JOB` is enabled again.

## 8. The kit blocks

v1 has eight blocks plus `text` and `diff` (pending Q-O3: recommendation a), all eight, built in
the order of b)). C4's first night builds `countdown`, `status`, `log`, `chart`, `text` and `diff`
(`pin` needs the last four, §3.4); the next builds `timer`, `table`, `checklist`, `map` (D83). Status
words and marks are the Map's (`docs/design.md`: hue only with its shape; grey is normal). How a
tap inside a card is told from a scroll, and what an `s` or `w` body does with more than it can
show, is §8.10 (D253, D254).

### 8.1 `countdown`

Down to a moment, or to a scheduled job (`spec-input.md` §5: "a live countdown bound to the real
job, with cancel"). Sizes `s` (default), `w`.

| Field | Rule |
| --- | --- |
| `until` | ISO time, or `+3h`, `+90m`; at most 7 d ahead |
| `job` | a scheduled job id (`coworker.md`, T13); `until` and the default title come from the job |

Exactly one of the two. Default title: the job's `what`, else `Countdown`.

- **Look** (`s`): digits `02:59:41` (mono 48 px `--text-1`, 56 px line; ≥ 24 h `1 d 02:59`); under
  them `at 10:12 · vm-c` (mono 18 px `--text-2`, 24 px line; without a job `at 10:12`), always one
  line: `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, the DOM text whole
  (D274). Mono 18 px is 10.8 px a character, so 22 characters fit the `s` body's 240 px:
  `at 23:00 · builder-a` is 216 px; a longer target is cut on the screen, e.g.
  `at 23:00 · builder-a-…` for `builder-a-nightly-07`. With a job, a
  `CANCEL JOB` button `[data-card-cancel]` across the body's width, 48 px tall, 16 px caps
  `--text-1`, 1 px `--line-strong`, at the body's bottom.
- **Live**: ticks every second. With a job, the job's state replaces the digits: `RUNNING` (28 px
  caps `--text-1`), `DONE 10:12`, `CANCELLED 08:03`, `SKIPPED 10:12` (`--text-2`), `■ FAILED 10:12`
  (`--p1`, the one abnormal state); `CANCEL JOB` shows only while `scheduled`. Without a job, at 0
  the digits read `DONE 10:12`.
- **`CANCEL JOB`** opens the confirm card (`c5-c6.md`, T14) with what, where and when; nothing is
  cancelled before its yes; each cancel is one audit line (T21). **Removing the card never cancels
  the job**: the job stays on the Map (`coworker.md`).

### 8.2 `timer`

Up from a moment ("stuck for how long?"). Size `s`.

| Field | Rule |
| --- | --- |
| `since` | ISO time, or `now` |
| `alert` | an alert id (`c3-see.md` §4.5); `since` is the alert's |

Exactly one. Default title: the alert's `text`, else `Timer`.

- **Look**: digits `1:12:40` (mono 48 px), under them `since 06:00` (18 px `--text-2`).
- **Live**: ticks every second. When a bound alert clears: `CLEARED 07:40 after 1 h 28` (28 px /
  18 px, `--text-1`), and the digits stop.

### 8.3 `status`

One thing's state, big enough to read across the room. Size `s`.

| Field | Rule |
| --- | --- |
| `node` / `run` / `builder` / `branch` (+ `repo`) | exactly one; a node id or label, a run id, a builder id, a branch |

Default title: the label (node), the run id, the builder id, `{repo} {branch}`.

- **Look**: the status mark and word, 28 px caps, in the Map's hue for that state (`■ DOWN` `--p1`,
  `▲ STUCK` `--p2`, `● OK` `--ok`, `○ UNKNOWN` `--text-3`); under it the `why` (18 px `--text-2`, at
  most 2 lines, cut with `…`); at the bottom `since 07:40 (was warn)` (16 px `--text-3`).
- **Sources**: node `fleet` fields `status`, `why`; run `state`, `stuck.reason`; builder `state`; branch
  `verdict`, `failed[0]` (`c3-see.md` §4).
- **Live**: refresh 10 s; a change is drawn as the new word and a new `since` line; no flash, no
  accent (colour means a state, `docs/design.md`).

### 8.4 `log`

Lines as they happen, or an excerpt. Sizes `w` (default), `l`.

| Field | Rule |
| --- | --- |
| `node` / `run` | bound: that node's or run's events (`c3-see.md` §4.7 `history`) |
| `lines` | static: 1-200 strings, each at most 160 characters |

Exactly one. Default title: `Events: {label}` (bound), `Log` (static).

- **Look**: mono 18 px, 24 px lines, `--text-1`; bound lines are `06:12 vm-b is degraded` (time in
  `--text-3`); no wrap, each line cut with `…`. `w` shows 5 lines; with more than 5 it shows the
  newest 3 over the `+ 37 MORE` row (§8.10). `l` shows 15 lines; its body scrolls and starts at
  the end (newest at the bottom).
- **Live** (bound): new events are appended within 10 s of the board having them; in `w` the newest
  3 move up and the row's count grows. In `l`, if the owner scrolled up, the view stays and
  `↓ 3 NEW` `[data-card-new]` (48 px tall, 16 px caps, bottom right of the body) appears; a tap
  goes to the end. When the board's events start later than the card asks, the first
  line reads `(the board keeps events since 05:40)` in `--text-3` (`covers`, `c3-see.md` §4.7).
- The board has events, not host logs: a host's real log is a static excerpt the agent read itself
  (plan C3: the room's own read access, declared in config).

### 8.5 `chart`

A line over time. Sizes `w` (default), `l`.

| Field | Rule |
| --- | --- |
| `node` + `metric` | bound: `cpu`, `mem` or `disk` of a node, sampled by the room |
| `window` | `30m`, `2h` (default), `12h` |
| `series` | static: 1-2 series `{"name":…,"points":[["2026-10-27T06:00:00+01:00",0.31],…]}`, at most 240 points each, name at most 24 characters |
| `unit` | `%` (fractions drawn as percent), `$`, `s`, or none; at most 8 characters |

Exactly one of `node` and `series`. Default title: `{label} {metric}`, else the first series' name.

- **Look** (`w`): the last value 20 px `--text-1` at the right end of the title row (`27 %`). Plot
  area 528 x 108 px; 16 px mono `--text-3` labels: y min and max at the left, first and last time at
  the bottom. The line is 2 px `--text-1`; a second series 2 px `--text-3` dashed, named in the title
  row. No fill, no colour (grey is normal, `docs/design.md`). `l`: plot 528 x 340.
- **Bound** (D86): the board keeps no metric history (`c3-see.md` §6), so the room samples the node's
  value every 30 s from the moment the card is placed, keeps `window` worth in memory, and sends
  each new point. Before 2 points the plot reads `Collecting since 07:12, one point every 30 s.`
  (18 px `--text-2`, centred). After a room restart the samples start again (same line).
- **Static**: drawn once; `replace` updates it.

### 8.6 `table`

Rows and columns. Sizes `w` (default), `l`.

| Field | Rule |
| --- | --- |
| `columns` + `rows` | static: at most 4 columns in `w`, 6 in `l`; 1-20 rows; cells at most 40 characters |
| `source` | bound: `alerts`, `runs`, `ci` or `lanes`, with that tool's filters (`priority`, `state`, `verdict`, `builder`) |

Exactly one. Bound columns: `alerts` mark and priority, target, text, since; `runs` run, state,
round, stuck; `ci` branch, verdict, at; `lanes` id, state, since. Default title: the source's name
(`Alerts`), else `Table`.

- **Look**: a 40 px header row (16 px caps `--text-3`), 40 px rows (18 px `--text-1`), numbers right
  aligned, cells cut with `…`. `w` shows 2 rows; with more than 2 it shows the first row over the
  `+ 19 MORE` row (§8.10). `l` shows 8 rows; more scroll inside the body.
- **Live** (bound): refresh 10 s, order as the tool's (`c3-see.md` §4).

### 8.7 `checklist`

Steps, ticked by the owner or by the fleet. Sizes `t` (default), `s`, `l`.

| Field | Rule |
| --- | --- |
| `items` | 1-12 `{"text":…, "done":false, "when":…}`; text at most 60 characters |
| `when` | optional per item: `{"node":id,"status":"ok"}`, `{"branch":…,"verdict":"green"}`, `{"run":id,"state":"stopped"}`, `{"job":id,"state":"done"}` |

Default title: `Checklist`.

- **Look**: 48 px rows; a 32 x 32 box (1 px `--line-strong`; ticked: `✓` 24 px `--text-1`), 16 px
  gap, the text 18 px (ticked: `--text-3`). A row with `when` shows `AUTO` (16 px caps `--text-3`) at
  its right end. Each row the owner may tick is a `<button>` `[data-check-row]` with `data-row`
  (0-based) and `aria-pressed` (`true` when ticked), the whole 48 px row wide. `s` shows 2 rows;
  with more than 2 it shows the first over the `+ 11 MORE` row (§8.10). `t` and `l` show 7; more
  scroll.
- **Live**: a `when` row is ticked by the room when its condition holds (refresh 10 s) and is not
  tappable. A tap (§8.10: never a drag, never after the body scrolled) on any other row toggles it
  on every screen within 0.3 s (the room keeps it; a
  display state, not an action). The agent learns ticks through the next prompt's focus,
  `"ticked":[{"card":"card-0006","item":2,"done":true}]` (as `undone`, §5; D87).

### 8.8 `map`

"Zoom the map here" (plan C4b), on a screen that may have no Map. Size `l` only.

| Field | Rule |
| --- | --- |
| **`node`** | a node id or label: that node and its children |

Default title: `Map: {label}`.

- **Look**: the Map's own renderer, read only, fitted to the node and its children (`fitNodes`, §2),
  node labels 16 px, statuses as on the Map. No pan, zoom or taps in v1 (D62 keeps "Ask about this"
  on the real Map).
- **Live**: statuses follow the room's refresh (10 s).

### 8.9 `text` and `diff`

`text`: `title` and `body` (at most 280 characters, 18 px `--text-1`); sizes `s` (default), `w`.
`diff`: static `lines`, 1-80, each starting with `+`, `-` or a space, at most 160 characters; mono
18 px, `+` lines `--text-1`, `-` lines `--text-3`, the sign kept as the mark (no red or green:
neither side is trouble); sizes `w` (default), `l`. In `s`/`w` a `text` body over 5 lines shows 3
over a `SHOW ALL` row and a `diff` over 5 lines its first 3 over `+ 77 MORE` (§8.10). Both are what `pin` takes (§3.4); pins draw the
same bodies at 320 x ≤ 240 px (a chart plot 288 x 120, a log or diff 6 lines).

### 8.10 Taps inside a card, and bodies that overflow

Review 63-touch finding 8: a flick over a checklist must not tick a row on every screen, and a
2-row scroll window on a slanted desk screen is too small to aim at.

**Taps** (D253). Every tappable on a card (`✕`, `[data-card-removed]`'s `UNDO`, `CANCEL JOB`,
`[data-check-row]`, `[data-card-more]`, `[data-card-less]`, `[data-card-new]`) acts on
`pointerup`, never on `pointerdown` or `click`, and only when all of these hold:

1. the `pointerup` has the `pointerId` of a `pointerdown` on the same tappable;
2. it is within 8 px (`TAP_SLOP_TOUCH`) of that `pointerdown` for touch and pen, 3 px (`TAP_SLOP`)
   for a mouse: the Map's constants, imported from `public/js/views/map/interact.js`, not copied;
3. no `pointercancel` came between the two (a browser that takes a flick as a scroll sends one);
4. the card body's `scrollTop` is the same as at the `pointerdown` (a browser that scrolled without
   a `pointercancel` is caught here).

No time limit: a slow press that stays within the slop counts. The pressed state is the common one
(`README.md` "Touch", D224); it goes with the `pointercancel`. A scrolling body (`t`, `l`) has
`overflow-y: auto`, `touch-action: pan-y` and `overscroll-behavior: contain`, so a flick at its end
does not move the card area or the page.

**Bodies that overflow** (D254). An `s` or `w` body (132 px) never scrolls: `overflow: hidden`. A
`log`, `table`, `checklist`, `diff` or `text` that holds more than the size shows (§8.4, §8.6, §8.7,
§8.9) draws what fits above a 48 px row at the body's bottom, `<button>` `[data-card-more]`, the
body's full width (240 px in `s`, 528 px in `w`), 1 px `--line-strong`, label centred in 16 px caps
`--text-1`: `+ 37 MORE` (lines, rows or items not drawn; `SHOW ALL` for `text`, whose hidden part
has no count before layout).

| Block, size | Over | Draws above the row |
| --- | --- | --- |
| `log`, `w` | 5 lines | the newest 3 lines (72 px) |
| `table`, `w` | 2 rows | the 40 px header and the first row |
| `checklist`, `s` | 2 items | the first item (48 px) |
| `diff`, `w` | 5 lines | the first 3 lines |
| `text`, `s` or `w` | 5 lines at 24 px | the first 3 lines, the third cut with `…` |

- **A tap on `+ 37 MORE`** sends `card.size` with `size` `l` (`protocols.md` §5). The room grows the
  card to `l` and moves it to the front of its list: within 0.3 s every screen draws it `l` in the
  first slot (`split` x 784-1344, y 24-504; `canvas` x 100-660, y 24-504) and repacks the rest
  (§7.2). Any block may be grown to `l` by the owner; §8's sizes are what the agent may ask for.
- **`LESS`** `[data-card-less]`: a grown card's header shows it, 48 x 80, 16 px caps `--text-1`, 1 px
  `--line-strong`, its right edge 16 px left of `✕`. A tap sends `card.size` with the card's placed
  size; the card shrinks back on every screen within 0.3 s and stays first.
- **Who sees it.** A grown card carries `grownFrom` (the placed size) in `card.put` and in `cards`
  (§12.4); the agent is not told otherwise (display state, as D87's ticks are not sent mid-turn).
  A `replace` from the agent puts its own size and drops `grownFrom`. A removed and restored card
  keeps the size it had.
- **A screen too small for `l`** (a grid under 2 x 2, §7.1): the row is drawn as a label, not a
  button (`--text-3`, no border, `aria-disabled="true"`), and the card's full body is a `replace`
  away or on a larger screen.

## 9. Removing a card

How cards also leave on their own (ended, `expires`) and the agent removing them (`remove_card`) are §12 (pending Q-O4).

- **One tap** on `✕` removes the card from the room's list: gone on every other screen within 0.3 s,
  and they repack (§7.2).
- **On the screen where it was tapped** (D84, T46) the card's place shows, for 10 s, a 48 px row
  `[data-card-removed]` at the card's top: `CARD REMOVED` (16 px caps `--text-2`) and `UNDO` (48 x 96,
  16 px caps `--text-1`, 1 px `--line-strong`). That screen repacks only when the row goes. `UNDO`
  puts the card back at its old place in the list on every screen; after 10 s the row goes.
- **Removed by a show line's `UNDO`** (§7.4, D252, T98): the same as `✕`, with the tapping screen
  being the one whose show line was tapped. If that screen draws a canvas, the card's place shows
  the `[data-card-removed]` row above for 10 s and the line reads ` · undone` without `UNDO`. If it
  draws no canvas (the pane over a view, `screens.md` §1), the line itself is the way back for 10 s:
  suffix ` · card removed`, and in `UNDO`'s place `PUT BACK` `[data-show-putback]` (48 px tall,
  120 px wide, 16 px caps `--text-1`, 1 px `--line-strong`). `PUT BACK` does what the row's `UNDO`
  does; after 10 s the button goes and the suffix becomes ` · undone`. Other screens show
  ` · undone` at once. Putting the card back gives the line its `UNDO` again (it is the card of
  that `place` again).
- The next prompt's focus carries `"removed":["card-0004"]` (as `undone`, §5).
- Removing a countdown never cancels its job (§8.1). Removing works while the room is down
  (§7.6).

## 10. Scenarios, part 2

Harness as §6. Cards are read by `[data-card]` rects and texts; the demo hub has a scheduled job
`job-0003` ("shut off vm-c", 10:12, target `vm-c`; `stand-ins.md`, T18). The clock starts at 07:12:00.

### S-C4-13 A countdown bound to a job: drawn within 1 s, ticking, cancel asks first
Given screen `desk` in `split` with an empty canvas,
When the fake agent calls `place {"block":"countdown","job":"job-0003"}` at 07:12:00,
Then within 1.0 s (B6) one `[data-card]` with `data-block="countdown"` is at x 784-1056,
y 24-256; its header reads `AGENT · 07:12`, its title `shut off vm-c`, its digits `03:00:00`, then
`02:59:59` 1 s later; `CANCEL JOB` is 48 px tall; the line reads `put a countdown "shut off vm-c" on
the canvas` with `UNDO`.
When the owner taps `CANCEL JOB`,
Then the confirm card opens (`c5-c6.md`) and the job is still `scheduled` until its yes.
When the owner instead taps `✕`,
Then the card is gone and `job-0003` is still `scheduled` on the demo hub.
When the room is seeded (`POST /jobs`) with `job-0009`, `title` `nightly cleanup`, `at` 23:00,
`target` `builder-a-nightly-07`, and the fake agent places a countdown bound to it,
Then its `at` line's text is `at 23:00 · builder-a-nightly-07`, its rect is one line (24 px tall),
inside the body (x 800-1040), its computed `text-overflow` is `ellipsis` and `scrollWidth` >
`clientWidth` (drawn `at 23:00 · builder-a-…`), and `CANCEL JOB` keeps its rect at the body's
bottom (D274).
Test: Playwright with `page.clock`; the B6 marks; card rect and texts; the demo hub's job state;
for `job-0009` the `at` line's rect, computed style and `scrollWidth`/`clientWidth`, and
`[data-card-cancel]`'s rect against the one recorded for `job-0003`'s card.

### S-C4-14 A status tile follows its node
Given `side` in `canvas` layout and a `status` card on `vm-b` reading `▲ WARN`,
When the demo hub sets `vm-b` to `down` with why `host not reachable` at 07:40:00,
Then by 07:40:10.3 the card reads `■ DOWN` in `--p1`, `host not reachable`, `since 07:40 (was
warn)`; no other card moved.
Test: change the demo node; advance the clock 10 s; read the texts and the computed colour.

### S-C4-15 Newest top left, the small screen shelves, `TO FRONT` brings one back
Given `desk` in `split` (4 cells) and `side` in `canvas` (6 cells), one conversation,
When the fake agent places 5 `status` cards A, B, C, D, E in that order, 1 s apart,
Then on both screens E is at the first cell and A last; `desk` shows E, D, C, B and `SHELF 1`;
`side` shows all 5 and no `[data-shelf]`.
When the owner taps `SHELF 1` on `desk` and `TO FRONT` on A,
Then on both screens A is first within 0.3 s; `desk` shows A, E, D, C and its shelf holds B.
Test: two contexts; order of `[data-card]` by rect; `[data-shelf]` text.

### S-C4-16 A large card in `split` takes the whole area
Given `desk` in `split` with two `s` cards, and `side` in `canvas`,
When the fake agent places a `map` of `hv1` (`l`),
Then on `desk` the map card is at x 784-1344, y 24-504 and both `s` cards are on the shelf
(`SHELF 2`); on `side` the map is at x 100-660, y 24-504 and the two `s` cards are in row 3.
Test: rects on both contexts; shelf count.

### S-C4-17 Remove with one tap, undo within 10 s
Given `desk` (`split`) and `side` (`canvas`) with the same 3 cards,
When the owner taps `✕` on the second card on `side` at t = 0 s,
Then within 0.3 s the card is gone on `desk` and `desk` has repacked; on `side`
`[data-card-removed]` (48 px tall) reads `CARD REMOVED` with `UNDO` where the card was, the other
cards do not move.
When the owner taps `UNDO` at t = 4 s,
Then the card is back in second place on both screens.
When the owner removes it again and waits,
Then at t = 10 s after that tap the row goes and `side` repacks; the next prompt's focus carries
`"removed":[…]` with its id.
Test: two contexts with `page.clock`; rects before and after; the fake agent's received focus.

Second case, removed by a show line's `UNDO` (§7.4, §9, D252):
Given the same two screens and one turn in which the fake agent placed cards A and B (two show
lines in a row, both with `UNDO`), and `desk`'s pane open,
Then on `desk` the two `[data-show-undo]` rects are 48 px tall and 16 px or more apart vertically.
When the owner taps `UNDO` on A's line on `side` at t = 0 s,
Then within 0.3 s A is gone on `desk`, which repacks; on `side` `[data-card-removed]` reads
`CARD REMOVED` with `UNDO` where A was; A's line reads `… on the canvas · undone` on both screens,
with no `[data-show-undo]`.
When the owner taps the row's `UNDO` at t = 4 s,
Then A is back in its place on both screens and its line has `UNDO` again.
When `desk` switches to the app's Map (pane over a view, no canvas) and the owner taps `UNDO` on
B's line there at t = 20 s,
Then B is gone on `side`; on `desk` B's line reads `… on the canvas · card removed` with
`[data-show-putback]` `PUT BACK` (48 px tall); a tap on it at t = 25 s puts B back on `side`.
Removed again at t = 30 s and left alone, at t = 40 s `PUT BACK` is gone and the line reads
`… · undone`.
Test: two contexts with `page.clock`; `[data-show-undo]` rects (height, vertical gap); line texts;
`[data-card]` ids on `side`; `[data-show-putback]` presence before and after 10 s.

### S-C4-18 A bound chart starts empty but says so, then fills
Given `side` in `canvas`,
When the fake agent places `chart {"node":"vm-b","metric":"cpu"}` at 07:12:00,
Then the plot reads `Collecting since 07:12, one point every 30 s.` and the title row `vm-b cpu`
and the last value (`27 %`).
When the clock reaches 07:12:30 and the demo node's cpu is 0.41,
Then the plot holds a line with 2 points and the last value reads `41 %`; the message is gone.
Test: `page.clock`; demo node cpu set; read the plot's `<path>` point count and the texts.

### S-C4-19 A live log appends, and holds still when the owner scrolled up
Given `side` with a `log` card in `l` bound to `vm-b` showing 15 lines (`w` does not scroll:
S-C4-35),
When the demo hub adds 3 events to `vm-b`,
Then within 10.3 s the card's last line is the newest event.
When the owner scrolls the body up by 48 px and 2 more events arrive,
Then the view does not move and `[data-card-new]` `↓ 2 NEW` shows; a tap on it shows the newest line.
Test: add demo events; read the body's last visible line; `scrollTop` before and after.

### S-C4-20 The 17th card removes the oldest that is not a job's
Given 16 cards whose oldest is a `countdown` on `job-0003` and second oldest a `text` card,
When the fake agent places a 17th card,
Then the `text` card is gone on every screen, the countdown stays, the result has
`"removed"` naming the `text` card, and that card's line reads ` · removed: canvas full`.
Test: the fake agent's received results; count `[data-card]`; line text.

### S-C4-21 Agent text stays text; unknown and missing blocks fail plainly
Given `side` in `canvas`,
When the fake agent places `text {"title":"<img src=x onerror=alert(1)>","body":"ok"}`, then
`status {"node":"vm-x"}`, then `table {"source":"alerts"}` on the first C4 night's build,
Then the first card's title shows the literal characters and has no child element; the second
returns `No node "vm-x". Nodes like it: vm-b, vm-c.` with a `· failed` line; the third returns
`The canvas has no "table" block yet. Blocks now: countdown, status, log, chart, text, diff.`
Test: the title's `textContent` and `childElementCount`; results in the fake agent's log.

### S-C4-22 No screen shows a canvas: the card waits
Given only `desk` in `wall` layout,
When the fake agent places a `countdown {"until":"+10m"}`,
Then the result has `"drawn":[]`, `"noCanvas":["desk"]` and the hint `No screen shows the canvas
now; the card waits there. Say it in words too.`; the line reads `put a countdown "Countdown" on the
canvas · no screen shows the canvas`.
When the owner switches `desk` to `canvas` (`SCREEN` sheet, `screens.md` §1),
Then the countdown is drawn there within 1 s, still counting from the placing time.
Test: the result; switch layout; read the digits against the clock.

### S-C4-23 The room goes down: the canvas says so, cards freeze, then catch up
Given `side` in `canvas` at 06:41:00 with a `status` card on `vm-b` reading `▲ WARN`, a `countdown
{"until":"+90m"}` and a `text` card,
When the room under test stops its link (`POST /link {"up":false}`) at t = 0 s,
Then at t = 4.9 s nothing has changed; at t = 5 s `[data-cockpit-down]` (80 px tall) reads
`Cockpit room unreachable since 06:41 (0 min). Cards show their last values.`, the status and countdown
cards carry `STALE` and the `text` card does not, the countdown reads `01:29:55` and keeps
counting each second.
When the demo hub sets `vm-b` to `ok` at t = 10 s,
Then the status card still reads `▲ WARN` at t = 30 s.
When the owner taps `✕` on the `text` card at t = 20 s,
Then it is gone on `side` at once with `CARD REMOVED · UNDO`, and the room's `cards.json` still
lists it.
When the fake agent places one more `status` card meanwhile and the link comes back at t = 60 s,
Then within 1 s of the first frame the strip and every `STALE` are gone, the new card is drawn,
the first status card reads `● OK` within 10.3 s (the room's next read, §7.5), and `cards.json` no
longer lists the `text` card.
And given a canvas with no card, at t = 5 s it reads `The cockpit room is unreachable, so the agent
cannot place cards now.` and `Unreachable since 06:41 (0 min).`
Test: Playwright with `page.clock`; `POST /link {"up":false}` and `{"up":true}` on the room under test
(`stand-ins.md` §1.2); strip rect and text; `STALE` plates per `[data-card]`; read
`<stateDir>/cockpit/cards.json` (D85) before and after the link is back.

### S-C4-24 A job's countdown with the room down: still counting, cancel waits
Given `side` in `canvas` with the countdown on `job-0003` (S-C4-13) reading `03:00:00` at 07:12:00,
When the room under test stops its link at 07:12:00,
Then at 07:12:05 the card carries `STALE`, its digits read `02:59:55` and keep counting,
`Room down: may not run.` `[data-card-job-down]` is in the `at` line's row (y as that line's, one
line, 24 px), the `at` line is not rendered, the card is still `s` (272 x 232), and `CANCEL JOB` is
`disabled`; a tap on it opens nothing. Nothing in the card clips: every child of the body lies inside
the body's rect (D275).
When the link comes back,
Then within 1 s `at 10:12 · vm-c` is back in that row and `CANCEL JOB` is enabled.
Test: Playwright with `page.clock`; `POST /link` on the room under test; texts and `disabled` on
`[data-card-cancel]`; rects of the card, the body and its children; the S-C1-40 floor walk over
`[data-card]` in the down state.

### S-C4-34 A flick over a checklist scrolls it and ticks nothing
Given `desk` (`split`) and `side` (`canvas`), Playwright contexts with `hasTouch: true`, and a
`checklist` card in `t` with 12 items, none ticked, none with `when`,
When on `side` a finger goes down on row 3's text, moves 120 px up in 6 steps over 150 ms and lifts,
Then the body's `scrollTop` is above 0, and 0.5 s later no `[data-check-row]` has
`aria-pressed="true"` on either screen.
When a finger goes down on the top visible row, moves 6 px and lifts,
Then that row is ticked on both screens within 0.3 s.
When a mouse goes down on the next row, moves 5 px and lifts,
Then nothing is ticked (3 px for a mouse); a mouse click without movement ticks it.
When the next prompt is sent,
Then its focus carries `"ticked"` with exactly the two taps' rows, no row from the flick.
Test: two contexts; touches through CDP `Input.dispatchTouchEvent` (`touchStart`, 6 `touchMove`
20 px apart, `touchEnd`), the mouse through `page.mouse`; `scrollTop`; `aria-pressed` on both
contexts; the fake agent's received focus.

### S-C4-35 A long log in `w` does not scroll: `+ 37 MORE` grows it to `l` on every screen, `LESS` puts it back
Given `desk` (`split`) and `side` (`canvas`) with one `status` card each,
When the fake agent places `log {"lines":["line 01",…,"line 40"]}` (size `w`),
Then on `side` the log's body has `scrollHeight` equal to `clientHeight`; it shows `line 38`,
`line 39`, `line 40` and under them `[data-card-more]` `+ 37 MORE`, 48 px tall, flush with the
body's bottom; a mouse wheel of 200 px over the body changes nothing.
When the owner taps `+ 37 MORE` on `side`,
Then within 0.3 s on both screens the card has `data-size="l"` and is the first `[data-card]`: on
`side` at x 100-660, y 24-504, on `desk` at x 784-1344, y 24-504 with the `status` card on its shelf
(`SHELF 1`); the body shows 15 lines and scrolls (`scrollHeight` above `clientHeight`); the header
has `[data-card-less]`, 48 px tall, its right edge 16 px left of `[data-card-remove]`; `cards` lists
it with `"size":"l","grownFrom":"w"`.
When the owner taps `LESS` on `desk`,
Then within 0.3 s on both screens the card has `data-size="w"`, is still first, and shows
`+ 37 MORE` again; `desk`'s shelf is empty.
Test: two contexts; `[data-card]` order and rects; `scrollHeight`/`clientHeight`; `page.mouse.wheel`
then `scrollTop` still 0; the fake agent's `cards` call result.

## 11. Custom cards

Part 3 (T12, §11-§14). Plan C4b: "Anything the kit lacks, the agent writes as a small HTML card
rendered in a sandboxed frame that can read board data and nothing else (no network, no
credentials, no actions)." `spec-input.md` §5: "custom sandboxed cards for the rest (about a
minute)". The minute is the agent's writing time; the screen's own share is B10 (`README.md`
speed budget). The sandbox's facts are `research/Q6-sandboxing-html-cards.md`'s. Whether custom cards
are on by default is Q-O32; this section is written for its recommendation (on).

### 11.1 Placing one

`place` (§7.4) with `block: "custom"`:

| Field | Rule |
| --- | --- |
| **`html`** | the card's body: an HTML fragment (what goes inside `<body>`), inline `<style>` and `<script>` allowed; at most 32 768 bytes UTF-8 (D169) |
| `reads` | 0-3 board reads, each `{"tool":…, …params}` with `tool` one of `fleet`, `runs`, `lanes`, `ci`, `alerts`, `morning`, `history` and that tool's params (`c3-see.md` §4) |
| `data` | static JSON the agent passes in, at most 16 384 bytes serialised |
| `size` | `s`, `w` (default), `t`, `l` |
| `title` | as §7.4; default `Custom card` |
| `replace`, `expires` | as §7.4 and §12.2 |

- **Checked before anything is drawn** (each a `-32602` naming the field, no line, nothing placed):
  `html` missing, empty or over 32 768 bytes (`html is 41 220 bytes; at most 32 768.`); a `reads`
  entry with an unknown tool or bad params (the tool's own check, `c3-see.md` §3); more than 3
  reads; `data` over 16 384 bytes. The room does not parse or clean the HTML: the frame is the
  defence (§11.3), not a filter.
- **At most 4 custom cards** at once in the room's list (each frame is a document of its own on
  every canvas screen; D170). A fifth without `replace` returns `isError` `The canvas has 4 custom
  cards (card-0009, card-0011, card-0012, card-0014); replace or remove one.` Custom cards count
  toward the 16 of §7.2 like any card.
- **Result**: §7.4's, after every canvas screen has reported its render (§11.4) or 3.0 s, plus one
  `render` entry per screen that drew it:

  ```json
  {"card":"card-0009","drawn":["side"],"shelved":[],"waiting":[],"noCanvas":[],"removed":null,
   "render":{"side":{"ok":true,"readyMs":180,"minFontPx":18,"overflow":false}}}
  ```

  `minFontPx` is the smallest computed `font-size` of any visible text in the card; `overflow` is
  `true` when the card's content is taller or wider than its body. Below 16 px the result adds
  `"hint":"Text at 12 px is too small at arm's length; use 16 px or more."`; with `overflow`,
  `"hint":"The card's content does not fit its body (528 x 132 px); it scrolls."` So the agent can
  fix its own card with `replace` in the same turn.
- **Line**: `put a custom card "Stuck runs by builder" on the canvas` (the title cut as §7.4), with
  `UNDO`; a render that failed (§11.5) adds ` · card turned off`.
- **Standing instruction** (the Canvas 2 slice adds it to `protocols.md` §11.8 after the last
  `focus` line): `For a canvas card, use a block first; write a custom card only when no block
  fits. Its text is 16 px or more; it reads data only through card.onData.`

### 11.2 What the card is given

The room wraps the agent's `html` in a fixed **shell** and serves it from its own route (§11.3).
The shell is the room's code, the same for every card:

- `<!doctype html>`, `<meta charset="utf-8">`, a `<style>` with the screen theme's tokens as CSS
  variables (the values of `public/css/tokens.css` for `--bg-elevated`, `--bg-sunken`, `--line`,
  `--line-strong`, `--text-1`, `--text-2`, `--text-3`, `--ok`, `--p1`, `--p2`, `--font-mono`) and
  `html, body { margin: 0; background: var(--bg-elevated); color: var(--text-1); font: 18px/24px
  system-ui, sans-serif; }`. The board's own font files are not loaded into a card (`font-src
  data:`, D171).
- A `<script>` (the **card API**, before the agent's body) that defines one global:

  | Name | What |
  | --- | --- |
  | `card.onData(fn)` | `fn({asOf, reads, data})` is called with the first data and on every refresh: `reads` is one result per `reads` entry, exactly the object the MCP tool returns (`c3-see.md` §3, `asOf` and `missing` included), in the order asked; `data` is the static `data`; `asOf` the oldest of the reads' |
  | `card.size` | `{"w":528,"h":132}`, the body's size in CSS px (§7.3) |

- The agent's `html` as the `<body>`'s content, unchanged.

**What a card can read is exactly that list.** It is never given: the conversation, `focus`, other
cards, the device token or any cookie, the page's URL, the screen's name, the room's own declared
reads beyond the board (plan C3), or any way to ask for more data while it runs: the reads are
fixed when the card is placed (and changed only by `replace`). Data refreshes as §7.5: the room
runs the reads every 10 s while a canvas screen is online (one read per tool and params per 5 s,
shared with every other card and the agent's own calls), and sends them as `card.data`
(`protocols.md` §5); the screen posts them into the frame (§11.4). A card with no `reads` gets one
`onData` call with its `data` and none after.

### 11.3 The sandbox, as a checklist

Each line is one fact a test checks (§14; `security.md` §4, I9, links here instead of repeating it).

| # | Rule | How it is checked |
| --- | --- | --- |
| SB1 | The frame is `<iframe sandbox="allow-scripts" src="/api/cockpit/card/{id}/frame?rev={n}&theme={dark\|light}" referrerpolicy="no-referrer" title="Card: {title}">`; no other `sandbox` token, never `allow-same-origin` (with it a card can lift its own sandbox, research Q6) | the attribute's value is exactly `allow-scripts` |
| SB2 | The route answers with `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts; webrtc 'block'` as an HTTP header, never only a `<meta>` (a `srcdoc` card would inherit the page's policy instead, research Q6) | header read from the response |
| SB3 | The route also sends `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Type: text/html; charset=utf-8` and `Permissions-Policy: camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), clipboard-read=(), clipboard-write=(), display-capture=()` | headers |
| SB4 | The route needs the screen's device token (the `lb_cockpit` cookie, `screens.md` §6.2), `Sec-Fetch-Dest: iframe` and `Sec-Fetch-Site: same-origin`, and a `rev` the room holds for that card; else `404 {"error":"not-found"}`, the same for every case (D172). It is the only browser route of the room that does without `X-Laneboard: 1`, because a frame load cannot send a header; it is a `GET` that changes nothing | requests without the cookie, with `Sec-Fetch-Dest: document`, with `Sec-Fetch-Site: cross-site`, with an old `rev`: all 404 |
| SB5 | No network: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `<img src="https://…">`, CSS `url(https://…)`, `<link rel="prefetch">` and a form submit all fail inside the card; nothing leaves the browser | S-C4-26: no request but the frame's own is seen |
| SB6 | No credentials: `document.cookie` is `""` or throws, `localStorage`, `sessionStorage` and `indexedDB` throw (opaque origin), `parent.document` and `top.document` throw | S-C4-26 |
| SB7 | No way out of its box: no `alert`, `confirm`, `prompt` (no `allow-modals`), no `window.open` (no `allow-popups`), no `top.location` change (no `allow-top-navigation`), no download, no pointer lock, no fullscreen | S-C4-26 |
| SB8 | No action: the page accepts from a frame only the shell's three messages (§11.4), checks `event.source === frame.contentWindow` (a sandboxed frame's `origin` is `"null"` and proves nothing), and does nothing with them but count a touch and report a render; nothing a card sends reaches the agent, the room's tools or the board | a card posting `{"type":"prompt",…}` and `{"type":"card.close",…}`: no message on the room link |
| SB9 | Its own navigation turns it off: the page counts the frame's `load` events per `rev`; a second one (the card followed a link, set `location`, or submitted something the CSP let through) removes the frame at once and turns the card off (§11.5, `why` `navigated`). A navigation may still have sent a request before it was stopped; the card held only board data the agent already read (§11.6) | S-C4-28 |
| SB10 | The page's `✕`, header and title are the page's own elements, drawn outside the frame; the frame is clipped to the body's rect and cannot cover them | `elementFromPoint` at the `✕`'s centre is the `✕` |
| SB11 | Agent strings outside the frame (title) are text, as §7.3 | as S-C4-21 |
| SB12 | Room side: the room never interprets the HTML, never serves it from any other path, and serves only a `rev` it holds; `replace` makes a new `rev` and the old one 404s | an old `rev` 404s after a `replace` |

### 11.4 The page and the frame

- **Messages.** The page posts to the frame (`frame.contentWindow.postMessage(msg, "*")`, the only
  target an opaque origin allows) only `{"type":"card:data","v":1,"asOf":…,"reads":[…],"data":…}`
  and `{"type":"card:ping","v":1,"n":12}`. The shell posts back only
  `{"type":"card:ready","v":1,"rev":1,"minFontPx":18,"overflow":false}` (once, after the agent's
  scripts ran and the first `onData` returned), `{"type":"card:pong","v":1,"n":12}` and
  `{"type":"card:touch","v":1}` (on a `pointerdown` inside the frame, at most 1 per second, so the
  page counts it as a touch for its idle timers and `touched`, `screens.md` §2). Messages over 256
  bytes, of another type or from another source are dropped. More than 20 messages in one second
  from a frame turn the card off (`why` `too-many-messages`).
- **Render report.** At `card:ready` the screen sends `card.render`
  (`protocols.md` §5) with `readyMs` (from the frame's creation), `minFontPx` and `overflow`; the
  room puts it into `place`'s result (§11.1).
- **Taps inside** a card belong to the card's own script (tabs, a toggle, scrolling its body):
  display only, nothing reaches the room. A hold inside a card is not "Ask about this" (§9 of
  `c3-see.md` works on Map nodes only).
- **Look.** The frame fills the body of §7.3 (`s`/`w` 132 px tall, `t`/`l` 380 px; 240 or 528 px
  wide), `border: 0`, the body's padding outside it. While it loads, the body shows `Drawing…`
  (18 px `--text-2`) behind it. `data-block="custom"` on the `[data-card]`; the frame is
  `[data-card-frame]`.
- **Shelved** custom cards have no frame; one is created when the card comes out of the shelf.
- **Room down** (§7.6): the frame stays with its last data and the `STALE` plate; pings go on (they
  are the page's, not the room's).

### 11.5 Time limits and turning a card off

| Case | Limit | `why` |
| --- | --- | --- |
| no `card:ready` | 3.0 s after the frame is created | `not-ready` |
| no `card:pong` | the page pings every 5 s; 2 pings without an answer (10 s) | `no-answer` |
| a second `load` of the frame | at once | `navigated` |
| more than 20 messages in 1 s | at once | `too-many-messages` |
| a screen's link dropped within 10 s of creating the frame, with no `card.render` sent | when the room notices the link is gone | `screen-lost` |

- **Off is for every screen** (D173). The screen that saw it sends `card.fault`; the room marks
  that `rev` off and sends `card.state` to every screen, which remove the frame and draw in the
  body: `This card stopped and was turned off.` (18 px `--text-1`) and `Why: no answer for 10 s.`
  (`not ready in 3 s`, `it tried to leave its frame`, `it sent too many messages`, `a screen
  closed while drawing it`; 16 px `--text-2`). Header, title and `✕` stay. The agent's next prompt's
  focus carries `"cardsOff":[{"card":"card-0009","why":"no-answer"}]`, and a `place` still waiting
  for its result returns `isError` `The custom card was turned off on side: not ready in 3 s.`
- **`screen-lost`** is the crash guard: a card that hangs a screen's whole page (if the frame shares
  the page's thread, research Q15) stops the page's own pings to the room too; when the kiosk or
  the owner reloads the page, the card is already off and is not run again.
- A card that is off comes back only by `replace` (a new `rev`) or by placing it again.

### 11.6 What the sandbox does not promise

Said plainly here and in the later `docs/cockpit.md`: the sandbox limits what a card can reach; it
is not a proof that no data can ever leave. Known gaps (research Q6): WebRTC (closed by `webrtc
'block'` only where the browser supports it, research Q15), the frame navigating itself (stopped
by SB9 after the first request), and timing or CPU tricks. What is inside a card is board data the
agent already read through the C3 tools, never a credential. Whether that is good enough to have
custom cards on by default is Q-O32.

## 12. How cards leave

Q-O4 recommends c) (both); this section is written for it (pending Q-O4). Every way a card leaves:

| Way | Who | Undo |
| --- | --- | --- |
| `✕` | the owner | the `CARD REMOVED · UNDO` row, 10 s (§9) |
| `remove_card` | the agent | `UNDO` on its line, 10 min (§12.3) |
| ended | the room, 10 min after what it shows ended (§12.1) | none; ask the agent |
| `expires` | the room, at the time the agent set (§12.2) | none; ask the agent |
| the 17th card | the room (§7.2) | none |

`NEW` removes no card (cards persist across it, §7.5; only pins go, D73).

### 12.1 Ended

A card bound to something with an end leaves 10 min after that end (D174):

| Block | Ends when | Shows meanwhile |
| --- | --- | --- |
| `countdown` without `job` | it reaches 0 | `DONE 10:12` |
| `countdown` with `job` | the job is `done`, `cancelled` or `skipped` | its state (§8.1) |
| `timer` with `alert` | the alert clears | `CLEARED 07:40 after 1 h 28` |
| `checklist` | every row is ticked | the ticked rows; an untick within the 10 min stops the leave |

- **Never ends on its own**: a job's countdown that reads `■ FAILED` (trouble stays until the owner
  removes it), and every other block (`status`, `log`, `chart`, `table`, `map`, `text`, `diff`,
  `custom`): what they show goes on. A bound node or run that left the board keeps its card, with
  `vm-x is no longer on the board.` (18 px `--text-2`) as its body.
- **The plate**: from the end, the header's plate reads `LEAVES 10:22` (16 px caps `--text-3`, as
  §7.3). A header has one plate; `STALE` comes first, then `AS OF 02:10`, then `LEAVES 10:22`.
- **Leaving**: the room sends `card.remove` with `by` `ended`; the card fades out over 120 ms and
  the rest repack in 200 ms (§7.2); no undo row, no conversation line. The next prompt's focus
  carries `"left":[{"card":"card-0004","by":"ended"}]`.
- An ended job's countdown no longer counts as a job's for the 17th card (§7.2).
- **Room down**: leaving is the room's; a screen never removes a card on its own. The plate's time
  passes and the card stays until the room is back and its snapshot no longer lists it.

### 12.2 `expires`

Any `place` may carry `expires`: an ISO time, or `+30m` … `+7d` (`+15m` at least; D175). The header
shows `LEAVES 10:22` from the start. At that time the room removes it as §12.1 (`by` `expires`). A
`replace` keeps the old `expires` unless it names a new one; `"expires":null` drops it. Default:
none, the card stays until removed (plan C4b: "Cards persist until dismissed").

### 12.3 `remove_card`

"Take cards off the owner's canvas. Display only: removing a countdown never cancels its job."

| Param | Type | Rule |
| --- | --- | --- |
| **`cards`** | array of strings | 1-16 card ids, or `["all"]`: every card but job countdowns that are `scheduled` |

- Unknown id: `isError` `No card "card-0042". Cards now: card-0004, card-0009.`; nothing removed.
- **Line**: `removed the card "shut off vm-c" from the canvas` (more: `removed 3 cards from the
  canvas`), with `UNDO` for 10 min: it puts them back at their old places in the list (D176). The
  room keeps a removed card's content for those 10 min (memory only).
- `card.remove` with `by` `agent`; the screens fade and repack as §12.1.

### 12.4 `cards`

A read tool, so the agent knows ids without the owner's help: "What is on the canvas now, and
which saved cards exist."

```json
{"asOf":[{"source":"room","at":"2026-10-27T07:20:00+01:00","ageS":0}],
 "cards":[{"id":"card-0009","block":"custom","title":"Stuck runs by builder","size":"w","at":"2026-10-27T07:14:02+01:00","off":null},
          {"id":"card-0004","block":"countdown","title":"shut off vm-c","size":"s","at":"2026-10-27T07:12:00+01:00","job":"job-0003","leavesAt":null}],
 "saved":[{"name":"stuck-runs","title":"Stuck runs by builder","size":"w","savedAt":"2026-10-27T07:16:40+01:00"}]}
```

No params; newest first; at most 6 000 characters (`c3-see.md` §3). `size` is the card's size now;
a card the owner grew (§8.10) also has `"grownFrom":"w"`. Tool line: `looked at the canvas`.

## 13. Promotion: saving a custom card

Plan C4b: "A custom card that proves useful becomes a kit block, so the canvas gets faster with
use." Who decides is Q-O31; this is written for its recommendation (the owner asks, the agent
saves; pending Q-O31).

- **`save_card`** `{"card":"card-0009","name":"stuck-runs"}`: `name` is 1-32 of `a-z`, `0-9`, `-`.
  Only a custom card that is not off. The room stores its `html`, `reads`, `data`, `size` and
  `title` in `<stateDir>/cockpit/saved-cards.json` (0600, the room's user; D177). At most 50; the
  51st returns `isError` `50 cards are saved; ask the owner which to drop.` A name in use is
  replaced (the result says `"replaced":true`).
- **Line**: `saved the card "Stuck runs by builder" as stuck-runs`, with `UNDO` (unsaves; the card
  on the canvas stays) until `NEW`.
- **Placing a saved card**: `place {"block":"saved","name":"stuck-runs"}`, optionally with `size`,
  `title`, `expires`. It becomes a custom card with the saved fields, a new id and `rev` 1, in the
  sandbox of §11.3; no HTML is written, so it is on the screen within B10. Unknown name:
  `isError` `No saved card "stuck". Saved: stuck-runs, ci-wall.` Line: `put the saved card
  "stuck-runs" on the canvas`.
- **`delete_saved`** `{"name":"stuck-runs"}`: line `deleted the saved card stuck-runs`, no undo.
- **Into the kit for real**: a saved card that the owner wants as a built-in block is a change to
  laneboard's code, made by a build night or a PR like any other (`spec-input.md` §6: the agent's
  own changes arrive as a branch or a small PR). `laneboard cockpit cards export stuck-runs` prints
  the saved JSON for that work. The room never turns a saved card into trusted page code.

## 14. Scenarios, part 3

Harness as §10 (clock from 07:12:00). The fake agent's `c4-custom` script (`stand-ins.md` §5) holds
the cards below as fixtures under `test/cockpit/cards/`. Frames are read with Playwright's
`page.frameLocator('[data-card-frame]')`; requests with `context.on('request')`, which also sees a
frame's requests. A stand-in HTTP listener on `127.0.0.1:7799` named `example.invalid` (the
browser's `--host-resolver-rules`) counts every connection it gets, TLS or not.

### S-C4-25 A custom card draws its reads, reports its render, and follows the board
Given `side` in `canvas` with an empty canvas and the demo fleet (one stuck run on `builder-a`),
When the fake agent calls `place {"block":"custom","title":"Stuck runs by builder","html":<fixture
stuck-by-builder.html>,"reads":[{"tool":"runs","state":"stuck"}]}` at 07:12:00,
Then within 2.0 s (B10) a `[data-card]` with `data-block="custom"` and `data-size="w"` is at
x 100-660, y 24-256 (the first `w` slot, §7.1), its frame `[data-card-frame]` has `sandbox`
`allow-scripts` and fills the body (528 x 132), and inside it reads `builder-a 1`; the result has
`"render":{"side":{"ok":true,"minFontPx":18,"overflow":false}}`; the line reads `put a custom card
"Stuck runs by builder" on the canvas` with `UNDO`.
When the demo hub marks a second run on `builder-b` stuck,
Then within 10.3 s the frame reads `builder-a 1` and `builder-b 1`, and the frame was not reloaded
(one `load` event).
Test: Playwright with `page.clock`; the B10 marks; the frame's text through `frameLocator`; the
frame's `load` count; the fake agent's received result.

### S-C4-26 A card that tries the network, the cookie and the page is refused everywhere
Given `side` in `canvas`,
When the fake agent places the fixture `escape.html`, whose script tries, each in its own
`try`, and writes one line `name: blocked` or `name: OPEN` into its own body: `fetch`, `xhr`,
`websocket`, `eventsource`, `beacon` and `image` to `https://example.invalid/x`, `cookie`
(`document.cookie` non-empty counts as OPEN), `storage` (`localStorage`), `parent`
(`parent.document.title`), `top` (`top.location = …`), `alert`, `open` (`window.open`), `form`
(a submit to `https://example.invalid/f`), and `rtc` (`new RTCPeerConnection` with an ICE server
`stun:example.invalid:7799`),
Then the frame reads `blocked` on every line from `fetch` to `form`; the listener on
`127.0.0.1:7799` received 0 requests; `context.on('request')` saw no request but the frame's own
`/api/cockpit/card/…/frame` load; the cockpit page still holds its device token and its URL; no
dialog opened (`page.on('dialog')` never fired); the card is not off.
And the `rtc` line's value is recorded in the test's output as the browser's WebRTC result,
asserted `blocked` only once research Q15 says `webrtc 'block'` is enforced (SB2; until then a
known gap, §11.6, not a pass by assumption).
Test: Playwright; the fixture's lines through `frameLocator`; the listener's count; request log;
`page.on('dialog')`.

### S-C4-27 A card that hangs or never gets ready is turned off on every screen; `✕` still works
Given `desk` in `split` and `side` in `canvas`,
When the fake agent places the fixture `never-ready.html` (its script throws before `onData`
returns),
Then at 3.0 s after the frame's creation both screens show, in that card's body, `This card stopped
and was turned off.` and `Why: not ready in 3 s.`, no `[data-card-frame]` remains, and `place`
returns `isError` `The custom card was turned off on side: not ready in 3 s.` (or `desk`, whichever
reported first).
When the fake agent places `busy.html` (ready, then from its first `onData` on a loop that never
yields after 2 s),
Then 10 s after the loop starts (two missed pongs) it is turned off with `Why: no answer for 10 s.`,
and the next prompt's focus carries `"cardsOff":[{"card":…,"why":"no-answer"}]`.
When the owner taps `✕` on that card,
Then it is removed as §9.
Test: two contexts; `page.clock` for the 3 s; real time for the loop (the frame's thread, research
Q15: if it shares the page's, assert instead that a reload of the page shows the card off,
`screen-lost`); texts; the fake agent's received focus.

### S-C4-28 A card that leaves its frame is turned off at its first step
Given `side` in `canvas`,
When the fake agent places `navigate.html`, which sets `location.href =
"https://example.invalid/leak?x=1"` 500 ms after it is ready,
Then within 0.3 s of the frame's second `load` event the frame is gone and the body reads `Why: it
tried to leave its frame.`; the page's own URL is unchanged; the card is off on every screen.
Test: Playwright; count `load` events of `[data-card-frame]`; the listener's log is recorded (the
first request may have arrived, §11.6; the test asserts there is no second).

### S-C4-29 Bad custom cards fail before anything is drawn
Given `side` in `canvas` with 4 custom cards,
When the fake agent places a 5th custom card, then (after removing one) one with `html` of 41 220
bytes, then one with `reads` `[{"tool":"shell"}]`, then one with `reads` of 4 entries,
Then the first returns `isError` naming the 4 cards (§11.1); the next three return `-32602` with
`html is 41 220 bytes; at most 32 768.`, the read tool's message and `at most 3 reads`; no card,
no line and no frame request appear for any of them.
And when the fake agent places `tiny-text.html` (text at 12 px),
Then it is drawn and the result carries `"minFontPx":12` and the hint `Text at 12 px is too small
at arm's length; use 16 px or more.`
Test: results in the fake agent's log; count `[data-card]` and the room's request log for
`/api/cockpit/card/`.

### S-C4-30 Kept and placed again: a saved card is up in seconds
Given the card of S-C4-25 on `side`, and the owner says `keep that card`,
When the fake agent calls `save_card {"card":"card-0001","name":"stuck-runs"}`,
Then the line reads `saved the card "Stuck runs by builder" as stuck-runs` with `UNDO`, and
`<stateDir>/cockpit/saved-cards.json` (mode 0600) holds one entry `stuck-runs`.
When the test boots the room again on the same `stateDir` (`stand-ins.md` §1.1), the owner removes the card and the fake agent calls `place
{"block":"saved","name":"stuck-runs"}`,
Then within 2.0 s (B10) the card is drawn with a new id, the same title and the same frame text;
`cards` lists `stuck-runs` under `saved`.
When the fake agent calls `place {"block":"saved","name":"stuck"}`,
Then it returns `isError` `No saved card "stuck". Saved: stuck-runs.`
Test: fake agent script; file mode and content; a second `boot` on the same `stateDir`; B10 marks.

### S-C4-31 Finished things leave after 10 minutes; a failed job stays
Given `side` in `canvas` with a `countdown {"until":"+10m"}` placed at 07:12:00, a countdown on
`job-0003` and a `text` card with `expires` `+30m`,
Then the `text` card's header reads `LEAVES 07:42` from the start.
When the clock reaches 07:22:00,
Then the first countdown reads `DONE 07:22` and its header `LEAVES 07:32`; at 07:31:59 it is still
there; at 07:32:00 it fades out (120 ms) with no undo row and no conversation line.
When the demo hub sets `job-0003` to `failed` at 07:35:00,
Then its countdown reads `■ FAILED 07:35` and has no `LEAVES` plate at 07:50:00.
When the clock reaches 07:42:00,
Then the `text` card leaves; the next prompt's focus carries `"left"` with both ids, `by` `ended`
and `expires`.
Test: `page.clock`; demo job state; `[data-card]` count and plate texts; the fake agent's focus.

### S-C4-32 The agent removes cards; `UNDO` brings them back, the job stays
Given `side` with 3 cards: the countdown on `job-0003` (scheduled), a `status` and a custom card,
When the fake agent calls `remove_card {"cards":["all"]}`,
Then the `status` and custom cards fade out on every screen within 0.3 s, the countdown stays, the
line reads `removed 2 cards from the canvas` with `UNDO`, and `job-0003` is still `scheduled`.
When the owner taps `UNDO` 4 min later,
Then both cards are back in their old places, the custom card in a new frame with its last data.
When the fake agent calls `remove_card {"cards":["card-0042"]}`,
Then it returns `isError` `No card "card-0042". Cards now: …` and nothing changes.
Test: `page.clock`; card order by rect; the demo hub's job state; the frame's text.

### S-C4-33 A card that freezes a screen is not run again after the reload
Given `desk` in `canvas`, the only screen,
When the fake agent places `hang.html` (a loop from its first line, never ready) and the test calls
the room under test's `POST /link {"up":false}` (`stand-ins.md` §1.2) as soon as `context.on('request')`
sees the card's frame request,
Then the room marks the card off with `screen-lost` (no `card.render` came within 10 s of the
frame); after `POST /link {"up":true}` and a reload of `desk`, the card's body reads `Why: a screen
closed while drawing it.` and no second request for its frame is made.
Test: the room under test's control API; request log on `/api/cockpit/card/`; the card's body text; `cards`
lists it with `"off":"screen-lost"`.
