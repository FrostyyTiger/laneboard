# C4 Show and the canvas

Part 1 (T10, §1-§6): the show commands, the one camera they share with the Wall's tour, the line
each leaves in the conversation and its one-tap undo. Part 2 (T11) is the canvas and the kit
blocks; part 3 (T12) custom cards and how cards leave. Words (screen, room, show command, card,
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
  connection (message shape, ids and resume: `protocols.md`, T15).
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
  open (x 0-759, `c1-talk.md` §1), left of the inspector when it is open (the Map's insets,
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

**What C4 needs from the camera** (add to the Wall contract, T31; the app's Map gets the same as
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
limit with `…` (`security.md`, T17).

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
have their own `×` (§3.4, T11). Line: `cleared the marks`. On a screen with nothing to clear the
line is still written and `UNDO` is not drawn there.

### 3.4 `pin`

"Pin a small card next to a node on the owner's screens: text, a chart, a log excerpt or a diff.
It stays until removed. Display only."

| Param | Type | Rule |
| --- | --- | --- |
| **`node`** | string | a node id or label |
| **`card`** | object | `{"block":"text","title":…,"body":…}`; `chart`, `log` and `diff` take the kit blocks' shapes (T11) |

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
  pin, or by `NEW`. `clear` keeps them. Removal on screen: T46's `CARD REMOVED · UNDO` row is T11's
  and applies to pins too.
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
- **Words** (§3 per command). `{label}` is the node's label as the board shows it, cut to 32
  characters, drawn as text. Suffixes, in the same grey:

  | State (`data-show-state`) | Suffix | `UNDO` |
  | --- | --- | --- |
  | `shown` | none | while undoable (§5) |
  | `waiting` (the finger rule, §2) | ` · waiting for you` | no |
  | `skipped` on this screen, shown on another | ` · not on this screen: in use` | no on this screen |
  | no screen shown it | ` · no screen shows the map` | no |
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

Harness as `c3-see.md` §7: the demo hub with its fake builders, the stand-in room, and the fake agent
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
