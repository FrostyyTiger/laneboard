# Screens and modes

What a screen shows and how it moves between tour, explore and canvas; one screen or two; where the
cockpit button sits (§1-§5, part 1); how a screen pairs and what it shows when something it needs
is unpaired, offline or down (§6-§8, part 2). Words as in the glossary (`README.md`). Sizes are CSS
px at 1368x912; times in s.

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
1920x1080: 1311 + 1 + 608. The canvas keeps 608 px so the card grid (`c4-show-canvas.md` §7.1) has one fixed size.

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

## 3. One screen or two

- **Two screens** (the owner's case, `spec-input.md` §2): screen 1 runs `wall` ("Idles on the
  Wall: it tours the fleet, flies to trouble"), screen 2 runs `canvas` ("Where the owner talks to
  the agent and the agent shows things"). Both show the same conversation (plan §2).
- **One screen** gets both: `split` side by side, or `switch` (`spec-input.md` §2: "A user with one
  screen gets both, split or switching").
- **More screens**: each picks its layout; any screen can be tour, explore or canvas.

Where things land:
- A card the agent places on the canvas appears on **every** screen whose layout has a canvas
  (`canvas`, `split`, `switch`). Same cards, same order on each (the grid and the shelf: `c4-show-canvas.md` §7).
- A camera show command moves the wall half of every online screen with a camera, or the one it
  names (`c4-show-canvas.md` §1, D67). A screen in
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
`protocols.md` §1, D93). Without it the button is not rendered, and nothing else changes: the board works as
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

### S-SCR-05 A show command takes the camera, then the tour comes back
Given a screen in `wall` layout touring, the pane closed,
When the fake agent sends `fly_to` for node `builder-a` at t = 0 s,
Then `data-wall-state="explore"`, the camera flies to `builder-a` (320-900 ms, `c4-show-canvas.md` §2, D68), and the idle
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
Then the card appears on B within 1 s of the agent's command (B6, `README.md` speed budget); A shows the new conversation line if
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

## 6. Pairing

A screen talks to the room only with a **device token** (glossary). It gets one by **pairing**: the
screen shows a code, the owner approves the code from a trusted place, the room hands the screen
its token. Who may approve, and how long a token lives, is security-relevant: written here for the
recommendation (pending Q-O10).

**Where the cockpit is configured.** `cockpit.url` (the room's address) in the config of the
laneboard server that serves the page (the hub in the owner's case; the one box in
`single-machine.md`). Unset: the cockpit is **unconfigured**, no cockpit button, no canvas half,
the board as today (§4) (D17). The screen reaches the room directly on the page's own origin, under
`/api/cockpit/`, never through the hub (`protocols.md` §1, D92); the routes below are its §1.1.

**The board does not need pairing.** Viewing the board stays as today (`docs/fleet/auth.md`: a
`direct` user through serve, or `local`). An unpaired screen shows every view, the Wall and the
tour as a paired one does; only the pane and the canvas wait for the pairing. (A LAN-only setup
where the device token also opens the board is `security.md`'s and `single-machine.md`'s.)

**The pairing code.** 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no `0 O 1 I L`), shown
as two groups of 3 (`K7M-4QX`), accepted with or without the dash, any case. Valid **300 s**; a
new one replaces it on its own when it runs out. At most 10 open codes per room; an 11th request
gets 429 and the screen retries after 30 s (D13).

**The flow** (pending Q-O10 for step 3):
1. An unpaired screen asks the room for a code: `POST /api/cockpit/pair` → `201
   {"code":"K7M4QX","expiresAt":"2026-10-27T07:05:00Z"}`.
2. The pane (opened by `AGENT`) and an empty canvas show the pairing card (text below).
3. The owner approves on the room: `laneboard cockpit pair K7M-4QX --name desk`. The CLI is
   `local` on the room (`docs/fleet/auth.md`), so nobody off the room's box can approve. It prints
   `paired desk (code K7M-4QX)`, or exits 1 with `code K7M-4QX is unknown or expired`. `--name`
   is optional; the default is `screen-<n>`, `<n>` the next free number from 1.
4. The screen asks `GET /api/cockpit/pair/K7M4QX` every 2 s: `202` while pending, `200
   {"name":"desk"}` plus the token once approved, `410` when expired (step 1 again). The
   token is handed over once; a second `GET` for the same code gets `410`. Where the browser keeps
   the token (an `HttpOnly` cookie or storage) is `security.md`'s (T17); it survives a reload and
   is gone when the browser's data is cleared. A kiosk keeps a persistent browser profile, or it
   pairs again after every restart (a line for the later `docs/cockpit.md`).
5. Within 2 s of the approval the pane shows `Paired as desk.` for 5 s, then the conversation.

**Listing and unpairing**, on the room: `laneboard cockpit screens` prints one line per screen
(`desk  paired 2026-10-27 06:58  last seen 2 min ago`); `laneboard cockpit unpair desk`
revokes the token at once. Tokens do not expire on their own (pending Q-O10).

**The pairing card**, in the pane (and centred on an empty canvas), texts exact:
- Title, `--font-label` caps 24 px: `PAIR THIS SCREEN`
- 18 px `--text-2`: `This screen is not paired with the cockpit yet. The board works; talking to the agent needs a pairing.`
- The code, mono 48 px `--text-1`: `K7M-4QX`
- 18 px `--text-2`: `On the cockpit room, run:`
- mono 18 px `--text-1` on `--bg-sunken`: `laneboard cockpit pair K7M-4QX`
- 16 px `--text-3`: `Code valid for 4:12. A new one appears when it runs out.` (counts down each second)

After `unpair` the title reads `PAIR THIS SCREEN AGAIN` and the first line `This screen was
unpaired on 27 Oct at 06:58. The board works; talking to the agent needs a new pairing.`

## 7. When something is down

A screen depends on up to three things; each fails on its own and says so where it matters:

| What | Link | Lost when |
| --- | --- | --- |
| the screen's network | the browser | `navigator.onLine` is `false` |
| the **board** (hub, or the builder in builder mode) | the board socket (`public/js/core/net.js`) | the socket closes; it retries 500 ms × 1.8 up to 15 s, as today |
| the **room** | the room link (`protocols.md` §2) | the link closes, or no frame for 25 s (the room sends a heartbeat every 10 s); it retries 500 ms × 1.8 up to 15 s, the same `nextBackoff` (D10, D11) |

A lost room link shows only after a **5 s grace**: a link back within 5 s changes nothing on screen
(D10). The board link keeps today's behaviour (the `#offline` banner in the app). The room link does not
go through the hub (D92), so a hub down is not a room down; on one box board and room are one
process and go down together.

The page root carries `data-cockpit`: `unconfigured`, `unpaired`, `connecting`, `live`,
`room-down`, `offline` (for tests and CSS). `data-board` is `live` or `down`.

### Room down (answers Q-O6, recommendation a)

The board keeps working; the cockpit says it is away and since when. Nothing is hidden, nothing is
lost.
- **Wall half and app views:** unchanged. The tour, explore and every view read the board, not the
  room.
- **Cockpit button:** label and place unchanged; a grey ring 12 px (`○`, `--text-3`) in its
  top-right corner, 4 px in from the edges. Under the Q-O11 recommendation the ring sits on the
  bottom-right talk button (`data-talk="off"`, `c2-voice.md` §3) and `CHAT` stays as it is (D53). Grey, not red: the room is offline, the fleet is not
  in trouble (`docs/design.md`, the colour rule).
- **Pane:** a status line under its header, 18 px `--text-2` on `--bg-sunken`, **80 px** tall (two
  lines of 18 px at line height 1.35 plus padding: the texts below wrap at the ~400 px left of the
  button) (D54): `Cockpit room unreachable since 06:41 (3 min). Retrying in 12 s.` with a `RETRY
  NOW` button (48 px tall, 16 px caps, 16 px from the pane's right edge) at its right end. The minutes and the retry count down each second; the
  retry shows `Retrying now…` while a try runs. The conversation so far stays readable. The input
  stays editable (a draft can be written); `SEND` and the talk button are disabled, with the line
  `Sending and voice come back with the room.` above the input row, 16 px `--text-3`,
  left-aligned at x 784, its baseline 8 px above the row's top border (as `c2-voice.md` §5's
  microphone line: on the Wall the row ends 24 px above the screen's edge, nothing fits under it).
- **Canvas:** a strip across the top of the canvas, 80 px (two lines at 576 px, D54), 18 px `--text-2` on `--bg-sunken`, 1 px
  `--line-strong` bottom border: `Cockpit room unreachable since 06:41. Cards show their last
  values.` Every card stays where it was; each live card gets a grey `STALE` plate (13 px caps,
  `--text-3`, 1 px `--line-strong` border) next to its title, its values frozen. A countdown keeps
  counting (time is known on the screen) and adds `The room is down: this job may not run.`;
  its `CANCEL` is disabled. One-tap remove still works and is applied on the screen only until the
  room is back (then sent: `card.close`, `protocols.md` §5). An empty canvas reads `The cockpit room is unreachable, so the
  agent cannot place cards now.` and `Unreachable since 06:41.` (24 px / 20 px, as S-SCR-10).
- **What the screen keeps:** the conversation and the cards are kept in memory only, never in
  browser storage (a screen holds nothing worth stealing, plan §2) (D14). A reload while the room is
  down shows the status line and `The conversation shows again when the room is back.` in the pane.

**Back.** At the first frame from the room: the status line reads `Back since 06:47.` for 5 s and
goes; `STALE` plates go; cards placed or removed meanwhile update; missed conversation lines appear
in order (replay or snapshot, `protocols.md` §2.2). `SEND` and talk are enabled again. **A draft is never sent on its
own**: it stays in the input until the owner sends it (D12).

**Down during a turn or while speaking.** A reply streaming when the link is lost stops where it is
and gets the line `Cut off: the room went away at 06:41.`; on reconnect, a reply the room finished
meanwhile replaces the cut-off text (`protocols.md` §2.2). An open microphone closes at once (no 5 s grace: audio
has nowhere to go); the words so far stay in the input as an editable draft, not sent.

Sketch: `sketches/screens-room-down.html` (S-SCR-17 at 06:44): as is, `split` with the pane
closed (strip, two `STALE` cards, the countdown's note and disabled `CANCEL JOB`, the ring on the
talk button); with `#pane`, `wall` with the pane open (status line and `RETRY NOW`, a cut-off reply,
the line above the input row, the draft `how is the`, `SEND` and talk `off`).

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
strip reads the same. Retries keep running; when the network is back the rules of "Back" apply.

## 8. Scenarios, part 2

The stand-in room (T18) can stop and start its room link, approve and revoke pairings, and the
demo hub can be stopped, so each scenario runs without hardware.

### S-SCR-13 An unpaired screen: the board works, the pane shows a code
Given a screen at 1368x912 in `split`, the cockpit configured, no device token,
When the page opens,
Then within 2 s `data-cockpit="unpaired"`, the wall half tours the demo fleet, the canvas shows
the pairing card centred with a code matching `^[2-9A-HJKMNP-Z]{3}-[2-9A-HJKMNP-Z]{3}$`, and
`Code valid for 5:00.` counting down.
When the owner taps `AGENT`, the pane shows the same card and the same code.
Test: Playwright against the demo hub and the stand-in room with an empty token store; assert the
attribute, the regex, the countdown text at 0 s and (fake clock) 60 s: `4:00`.

### S-SCR-14 The owner approves the code on the room, the screen is paired within 2 s
Given S-SCR-13's screen showing `K7M-4QX`,
When `laneboard cockpit pair k7m4qx --name desk` runs on the stand-in room at t = 0 s,
Then the CLI prints `paired desk (code K7M-4QX)` and exits 0; by t = 2 s `data-cockpit="live"`,
the pane shows `Paired as desk.`, gone at t = 7 s, then the conversation; the canvas shows its
cards or S-SCR-10's empty text.
When the page reloads, it is `live` again with no code shown.
Test: Playwright plus a child process for the CLI; fake clock for the 5 s; reload and assert.

### S-SCR-15 A code runs out and is replaced; the old one cannot be approved
Given an unpaired screen showing a code at t = 0 s,
When nobody approves it,
Then at t = 300 s a different code is shown and `Code valid for 5:00.` starts again; and
`laneboard cockpit pair <old code>` exits 1 with `code <old code> is unknown or expired`.
Test: Playwright with a fake clock on the screen and a stand-in room whose clock is moved 300 s;
assert the two codes differ, run the CLI with the first, check exit code and output.

### S-SCR-16 Unpairing a screen takes the cockpit away at once, the board stays
Given screen `desk` paired and live, the pane open,
When `laneboard cockpit unpair desk` runs on the room at 06:58,
Then within 2 s `data-cockpit="unpaired"`, the pane shows `PAIR THIS SCREEN AGAIN`, `This screen
was unpaired on 27 Oct at 06:58. …` and a new code; the conversation is no longer on the screen;
the wall half keeps touring; a request with the old token gets 401.
Test: Playwright plus the CLI; assert texts and that no conversation line is in the DOM; `fetch`
a cockpit route with the old token from the test and expect 401.

### S-SCR-17 The room goes down: the cockpit says so after 5 s, the board keeps going
Given a screen in `split`, live, 2 cards on the canvas (a countdown with 01:30:00 left and a status
tile), the pane open with a draft `how is the`,
When the stand-in room stops its link at t = 0 s (06:41),
Then at t = 4.9 s nothing has changed; at t = 5 s `data-cockpit="room-down"`, the cockpit button
has the grey ring, the canvas strip reads `Cockpit room unreachable since 06:41. Cards show their
last values.`, both cards carry `STALE`, the countdown still counts and its `CANCEL` is disabled,
the pane line reads `Cockpit room unreachable since 06:41 (0 min). Retrying in …`, `SEND` and the
talk button are disabled, the draft is still `how is the` and editable; the wall half is
`data-wall-state="tour"` and flying throughout.
Test: Playwright with a fake clock; stop the stand-in's link; assert at 4.9 s and 5 s; type into
the input; check `disabled` on `SEND`.

### S-SCR-18 A blip under 5 s shows nothing
Given a live screen,
When the stand-in room drops its link at t = 0 s and accepts the reconnect at t = 2 s,
Then `data-cockpit` is `live` at every sample from 0 s to 10 s and no strip, ring or status line
appears.
Test: Playwright with a fake clock; sample the attribute and count `[data-cockpit-down]` elements
every 0.5 s.

### S-SCR-19 The room comes back: the screen catches up, the draft is not sent
Given S-SCR-17's screen in `room-down`, with retries at 0.5, 1.4, 2.9, 5.6, 10.6, 19.4, 34.4 s
… after the loss (500 ms × 1.8, cap 15 s),
When the room is started again at t = 60 s, having placed one more card and answered one turn
meanwhile,
Then by the next retry and 1 s after it `data-cockpit="live"`; the pane line reads `Back since
06:42.` for 5 s, then goes; the new card is on the canvas; the missed turn is in the conversation
in order; `STALE` is gone; the draft `how is the` is in the input and no prompt was sent (the
stand-in's log shows no new user turn).
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
assert the cut-off line, then the replaced text; assert the mic state attribute and the input.

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
Then within 1 s the wall caption, the canvas strip and the pane line read `This screen is offline
since 06:41. Check its network.`; after `setOffline(false)` the rules of S-SCR-19 apply.
Test: Playwright `context.setOffline`; assert the three texts; back online, assert `live`.
