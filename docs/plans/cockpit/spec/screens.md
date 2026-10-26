# Screens and modes

What a screen shows and how it moves between tour, explore and canvas; one screen or two; where the
cockpit button sits. Words as in the glossary (`README.md`). Sizes are CSS px at 1368x912; times in
s. Part 2 (pairing, unpaired, offline, room down, hub down) is task T3 and appends `S-SCR-` ids
from 13 on.

## 1. Layouts

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
1920x1080: 1311 + 1 + 608. The canvas keeps 608 px so the card grid (T11) has one fixed size.

**Choosing the layout.** Three ways, the first that is set wins:
1. The URL: `?layout=wall|canvas|split|switch` on the Wall page (a kiosk's start URL). Any other
   value is ignored.
2. The screen's own choice: the **SCREEN** button in the pane header (T4 places it) opens a sheet
   with four rows, 64 px tall each: `WALL`, `CANVAS`, `SPLIT`, `SWITCH`, the current one with the
   1 px accent border (`docs/design.md` rule 3). A tap applies it at once (no reload) and stores it
   on the screen in `localStorage` key `cockpit.layout` (D3).
3. The default by width, in the table above.

`split` on a screen < 1280 px wide shows as `switch` until the screen is wide again; the stored
choice stays `split`.

The page root carries the state for tests and CSS: `data-layout` (`wall|canvas|split|switch`, the
one in effect), `data-wall-state` (`tour|explore`, absent in `canvas`), and in `switch`
`data-switch-shows` (`wall|canvas`).

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
| a show command that moves the camera arrives (`fly_to`, `highlight`, `compare`, `scrub`; T10) | tour → explore at the target | restarts at 60 s when the command's movement ends (pending T10) |
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

## 3. One screen or two

- **Two screens** (the owner's case, `spec-input.md` §2): screen 1 runs `wall` ("Idles on the
  Wall: it tours the fleet, flies to trouble"), screen 2 runs `canvas` ("Where the owner talks to
  the agent and the agent shows things"). Both show the same conversation (plan §2).
- **One screen** gets both: `split` side by side, or `switch` (`spec-input.md` §2: "A user with one
  screen gets both, split or switching").
- **More screens**: each picks its layout; any screen can be tour, explore or canvas.

Where things land:
- A card the agent places on the canvas appears on **every** screen whose layout has a canvas
  (`canvas`, `split`, `switch`). Same cards, same order on each (T11 settles the grid).
- A camera show command moves the wall half of the screens T10 names (pending T10). A screen in
  `canvas` layout has no camera and ignores them; the conversation line still appears.
- In `split` the pane opens over the canvas half, never over the wall half, so the camera the agent
  moves stays in sight (plan C1: "so the agent can point at the view behind it") (D8). Its width
  and slide are T4's. In `switch` the pane opens on the canvas half; opening it from the wall half
  flips the screen to the canvas.
- In `switch`, a card that arrives while the wall is shown does **not** flip the screen. The switch
  button shows a count instead (S-SCR-07).

## 4. The cockpit button

One button opens the pane. Label `AGENT` (D7), in `--font-label` caps 16 px, a 24 px chat icon
above it, `--text-1` on `--bg-elevated`, 1 px `--accent` border (the primary call to action,
`docs/design.md` rule 3). Size **64x64 px** (research Q1: primary actions ≥ 64 px). When the pane
is open the button stays where it is and reads `CLOSE`.

| Where | Position |
| --- | --- |
| Wall page, `wall` layout | bottom right, 24 px from the right and bottom edges. The Wall's bottom-right status lines end 24 px left of the button (their right edge at 1368 − 24 − 64 − 24 = 1256 px). |
| Wall page, `split` | bottom right of the canvas half, 24 px from the screen's right and bottom edges. The wall half's status lines keep their place at the divider. |
| Wall page, `canvas` | bottom right, 24 px from the edges. The card grid keeps its bottom 104 px free (24 + 64 + 16). |
| Wall page, `switch` | bottom right, 24 px from the edges, on both halves. The switch button sits directly left of it with 16 px between. |
| App, every view in `VIEWS` (`public/js/core/router.js`) | bottom right, 24 px from the right edge, its bottom edge 16 px above the shell's bottom bar (the tape, `--tape-h` 24 px, so 40 px from the screen's bottom). Above the inspector and the tape (`z-index` between `--z-tape` 30 and `--z-sheet` 40). |

The **switch button** (only in `switch`): 64x64 px, label `CANVAS` while the wall shows and `WALL`
while the canvas shows, 16 px caps. A count of cards that arrived since the canvas was last shown
sits in its top-right corner: `--fs-16` mono, `--text-1`, on `--bg-sunken`, e.g. `2`. It is grey:
a new card is news, not trouble (`docs/design.md`, the colour rule).

The cockpit button exists only where the cockpit is configured (the room's address in config,
T15/T3). Without it the button is not rendered, and nothing else changes: the board works as
today. A tap on the cockpit button changes no route: the hash stays as it was (the router's rule
that a route only selects, `router.js` header).

## 5. Scenarios

### S-SCR-01 A fresh screen at the owner's size opens in split
Given a browser at 1368x912 with no `cockpit.layout` stored and no `?layout=` in the URL,
When it opens the Wall page on the demo fleet,
Then within 2 s the root has `data-layout="split"` and `data-wall-state="tour"`; the wall half is
759 px wide, the canvas 608 px, with a 1 px divider at x = 759; the tour is flying on the left; the
canvas shows its cards or its empty state (S-SCR-10); the `AGENT` button is 64x64 px with its
bottom-right corner at (1344, 888).
Test: Playwright at 1368x912 against the demo hub and the fake agent; read `data-layout`,
`getBoundingClientRect()` of the two halves and of `[data-cockpit-button]`.

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
When the owner taps `AGENT` at t = 0 s and leaves the pane open, touching nothing,
Then the pane opens (its slide is T4's), `data-wall-state="explore"`, the camera holds the frame
it had at the tap (the camera position changes by < 1 px between t = 0.2 s and t = 299 s), and at
t = 120 s it is still `explore`, because the idle timer is paused while the pane is open.
When the owner taps `CLOSE` at t = 130 s,
Then the tour resumes at t = 190 s.
Test: Playwright with a fake clock; read the camera through the Map's `screenOf(id)` for one node
at 0.2 s and 120 s; tap `CLOSE`; fast-forward 59 s (`explore`) and 60 s (`tour`).

### S-SCR-04 The pane closes itself after five idle minutes, never during a turn
Given a screen in `wall` layout with the pane open and the fake agent scripted to stream a reply
for 400 s,
When the owner sends a typed prompt at t = 0 s and touches nothing,
Then the pane is still open at t = 400 s (a turn is running); the turn ends at t = 400 s; the pane
closes at t = 700 s (300 s later); the tour resumes at t = 760 s (60 s after the close).
And a draft typed into the input before the close is in the input again when the pane reopens.
Test: Playwright with a fake clock and a fake-agent script with one long turn; assert the pane's
`data-open` and `data-wall-state` at 699/700 s and 759/760 s; reopen and read the input value.

### S-SCR-05 A show command takes the camera, then the tour comes back (pending T10)
Given a screen in `wall` layout touring, the pane closed,
When the fake agent sends `fly_to` for node `builder-a` at t = 0 s,
Then `data-wall-state="explore"`, the camera flies to `builder-a` (duration: T10), and the idle
timer restarts when the flight ends at t = f s; the tour resumes at t = f + 60 s.
And a screen in `canvas` layout receiving the same command does not change.
Test: Playwright, two pages on one fake agent; read `data-wall-state` and `screenOf('builder-a')`
near the screen centre on the `wall` page; the `canvas` page's DOM is unchanged.

### S-SCR-06 The owner picks a layout, it survives a reload, the URL wins over it
Given a screen at 1368x912 in `split`,
When the owner opens the pane, taps `SCREEN`, taps `CANVAS`,
Then within 0.2 s `data-layout="canvas"`, the wall half is gone, the canvas fills 1368x912, the
pane stays open, and `localStorage['cockpit.layout']` is `canvas`.
When the page reloads, it is still `canvas`.
When it is opened with `?layout=wall`, it is `wall`, and `cockpit.layout` is still `canvas`.
Test: Playwright; tap through the sheet (each row ≥ 64 px tall); read `data-layout` and
`localStorage`; reload; navigate with the query.

### S-SCR-07 Switch on a small screen: one half at a time, a count for new cards
Given a screen at 1024x768 with no layout stored (the default is `switch`), the wall shown,
When the fake agent places 2 cards on the canvas,
Then the screen keeps showing the wall (`data-switch-shows="wall"`); the switch button reads
`CANVAS` with a count `2`.
When the owner taps it,
Then the canvas shows the 2 cards, the button reads `WALL`, the count is gone.
Test: Playwright at 1024x768 with a fake-agent script that places two cards; assert the attribute,
the label and the count text before and after the tap.

### S-SCR-08 Two screens: the canvas gets the card, the tour keeps touring
Given screen A in `wall` layout touring and screen B in `canvas` layout, one conversation,
When the owner types "put a countdown to the nightly run on the canvas" on B and the fake agent
places a countdown card,
Then the card appears on B within 1 s of the agent's command; A shows the new conversation line if
its pane is open, keeps `data-wall-state="tour"` and gets no card.
Test: Playwright, two browser contexts on one fake agent and one demo hub; assert the card on B,
no card element on A, and A's `data-wall-state`.

### S-SCR-09 The cockpit button on every app view
Given the app at 1368x912 with the cockpit configured,
When it shows each view in `VIEWS` (`map`, `board`, `inbox`, `packages`, `morning`, `credit`,
`box`, `audit`, `runs`) in turn,
Then each has one `[data-cockpit-button]`, 64x64 px, its right edge at x = 1344 and its bottom
edge at y = 872 (912 − 24 tape − 16), overlapping neither the tape nor the header; a tap opens the
pane over the view and `location.hash` is unchanged.
And with the cockpit not configured, no view has the button.
Test: Playwright loops over `VIEWS`, checks the rect, taps, compares `location.hash`; a second run
without the cockpit config counts zero buttons.

### S-SCR-10 An empty canvas says what it is for
Given a screen in `canvas` layout and no cards,
Then the canvas shows, centred, in `--text-2` at 24 px: "Nothing on the canvas yet." and below it
at 20 px: "Ask the agent to put something here, for example: “a countdown to the nightly run”."
Never a blank surface (`docs/plans/product.md` §3.6). With the demo (`?demo=1`) the canvas holds
the demo cards instead, labelled `DEMO` top left of the canvas in 16 px caps.
Test: Playwright with a fake agent that places nothing; assert both texts and their computed font
sizes; a second run with `?demo=1` asserts the `DEMO` label and ≥ 1 card.

### S-SCR-11 Crossing 1280 px flips split and switch without a reload
Given a screen at 1368x912 in `split` (stored), the wall in `explore` on `builder-a`, the pane open
with a draft,
When the window is resized to 1200x800,
Then within 0.5 s `data-layout="switch"` showing the half that held the pane (the canvas), the
draft and the conversation are unchanged, and `cockpit.layout` is still `split`.
When it is resized back to 1368x912, it is `split` again, the wall still on `builder-a`.
Test: Playwright `setViewportSize` both ways; assert attributes, the input value and storage.

### S-SCR-12 Reduced motion: no flights, same rules
Given `prefers-reduced-motion: reduce` and a screen in `split`,
When the owner taps the wall and the fake agent sends `fly_to builder-a`,
Then the wall is `explore` at once, the camera jumps to `builder-a` with no frames in between
(Wall plan D5), and the tour (the slow caption rotation) returns 60 s after the last touch.
Test: Playwright with `emulateMedia({ reducedMotion: 'reduce' })` and a fake clock; sample
`screenOf('builder-a')` on two consecutive frames after the command: no intermediate position.
