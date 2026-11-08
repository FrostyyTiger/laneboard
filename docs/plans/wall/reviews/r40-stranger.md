# r40: the stranger (night 5)

I came to this from the GitHub page. I read `README.md`, `docs/wall.md`, `docs/map.md` (feeds, API) and `docs/install.md`.
I did not read the plan or PROGRESS before writing this. The code was at `e424189` (T17), the last commit to
`public/js/wall` and `wall.css`. Everything ran on `demo-fleet.mjs --size large` on :7795 under the SwiftShader wrapper,
and all files are in `$RUN_DIR/shots/`:
- `r40-galaxy`: a film of `galaxy.html?demo=1`, the URL the docs give. 32.6 fps, worst gap 213 ms.
- `r40-fx-<name>`: films of `galaxy.html?demo=1&fx=<name>` for all five effects.
- `r40-stills/1..4`, all at 1368 px:
  - 1 is `galaxy.html?at=mylab`, 2 is `?at=home`, 3 is `wall.html?variant=radial`, 4 is the `galaxy.html` overview.
  - **`mylab` is my own site**. I wrote a feed with a warn alert, a `lamp` guest carrying `glow` (rgb 255,120,40, level 1)
    and a `printer` guest carrying `ring` (progress 0.5). The `warp`, `afterglow`, `activity` and `sweep` films and the
    stills therefore show a sixth site, `MYLAB`, warn. The `galaxy` and `beacon` films were made before it.
- Touch, the newest walks: `r38-t16-walk` (T16, tap, turn, moon, Back, out) and `r39-t17-card` (T17, the node card).
  I did not drive touch myself.

## What I tried, in order, as a stranger

1. **Does a Wall exist?** Yes. The README's view table has a Wall row pointing to `/galaxy.html` and `docs/wall.md`.
   I found it in under a minute.
2. **How do I open it?** `docs/wall.md` → "A tablet in kiosk mode" gives `https://<your laneboard>/galaxy.html`.
   - `curl` returns 200 for `galaxy.html`, `wall.html` and `galaxy.webmanifest`.
   - The manifest is fullscreen and landscape, with icons. The page has `apple-mobile-web-app-capable`.
3. **Kiosk.** Clear per OS: Edge `--kiosk`, Android install plus pinning, iPad Guided Access. "Screen timeout to never"
   is a useful line.
4. **Stop the tour.** Answered: touch it for a minute, or open `?role=explore`.
5. **My own things on it (`glow`, `ring`).** This is where it broke. See findings 1 and 2.

## galaxy: findings, worst first

1. **My `glow` and `ring` do not show on the Wall the README sends me to.**
   - What I saw: in still 1, `lamp` (orange glow, level 1) and `printer` (ring 0.5) are the same grey balls as every
     other planet. Still 2 is the same for the demo's own `kitchen-light`, `desk-light` and `living-light` (glow) and
     `printer-3d` (ring 0.72 in `/api/map`).
   - `/api/map` does carry both fields, so the feed is right and the page ignores them.
   - Only a table row in `docs/wall.md` says `glow` and `ring` are "painted by `wall.html`". The README calls
     `galaxy.html` *the* Wall and the kiosk section opens `galaxy.html`. A hallway owner follows exactly that path, so they
     never see their lights.
   - Why it matters to me: this was half of why I wanted the Wall. I lost ten minutes deciding whether my feed was wrong.
   - Fix: paint `glow` (a soft halo in the light's colour, capped below status brightness) and `ring` (a thin grey arc
     round the planet) in the galaxy. Until then, say so in the README's Wall row and in the kiosk section:
     "`glow`/`ring` show on `/wall.html` only".
2. **I cannot push a feed to the demo, and the docs' route answers 404 on a hub.**
   - How I hit it: `docs/map.md` → API says `POST /api/map/feeds` with `x-laneboard: 1`.
     - Without the header: 403 `no-csrf-header`. That is fine, it is documented.
     - With it: **404 `not found`**.
   - The route is registered for `modes: ['builder']` only (`server/routes/feeds.mjs`), and the demo fleet is a hub.
   - The 409 text on a watched builder says "push to the hub". On a hub, that is a dead end.
   - I got my feed in only by digging the demo's temp `feedsDir` out of the process environment and dropping
     `mylab.json` there. A stranger will not do that.
   - Fix (any one):
     - Have `demo-fleet.mjs` print its `feedsDir`, plus one line in `docs/wall.md` "Feed fields": "to try your own, write
       `<feedsDir>/<source>.json`".
     - Or register the route on a hub for local callers.
     - At the very least, document that on a hub you drop the file into `feedsDir`.
3. **Tapping a planet now gives a card that says nothing.**
   - What I saw in `r39-t17-card`:
     - Frame 03: BA is tapped and the card reads `• BA BUILDER ✕`, nothing else. The plate was `2 ATTENTION`,
       `FIX-LOGIN · ASKED A QUESTION` a moment before (`r38-t16-walk` frame 04).
     - Frames 05 and 07: same for `FEAT-SEARCH LANE` and `VM-A ROOM`.
     - The left plate is gone in all of them.
   - `docs/wall.md` still promises "tap a planet for its own sheet". So what I can learn by touching a planet went down,
     and the docs no longer match.
   - The code comment says the contents are coming in T18-T20. As a user, today it is a regression.
   - Fix: until the card carries the problems, keep the sheet's lines (status, named problems) in the card body. Update
     the Touch section when the card lands.
4. **The calm plate is a bare name.**
   - What I saw: still 2 (HOME) and `r40-galaxy` frames 5, 6 and 8 (HV2, REMOTE, HOME) show the name, at most one
     countdown line, and no status word.
   - `docs/wall.md` says the caption gives "its worst status as one word (… or the calm line)". I never saw a calm line.
   - Why it matters: from the hallway, a bare `HOME` could mean fine or could mean the page is still loading. I want to
     read "all clear".
   - Fix: a calm line in the status slot, for example `ALL CLEAR · 9 ROOMS`, in the calm grey.
5. **A plate line is cut through the middle.**
   - What I saw: `r40-fx-warp` frame 6 (15.4 s), the VM-C plate. Its third line, `FEAT-SEARCH · WAITING ON A PERMIS…`,
     is clipped horizontally, with only the top half of the glyphs visible.
   - Fix: the plate cuts at whole lines (drop the line, or `+N MORE`), never mid-glyph.
6. **Whether it is touring or manual is too small to read from the hallway.**
   - What I saw: `r39-t17-card` frame 00. `MANUAL · TOUR IN 0:58` and `▶ TOUR` are roughly 10 px caps under the tag at
     1368 px. At a quarter scale they are gone.
   - Why it matters: a housemate touches the tablet, walks off, and I see a frozen galaxy without knowing why.
   - Fix: while manual, show `MANUAL` at clock size next to the clock, or dim the clock's colour with a countdown ring.
7. **An empty-sky tap did not step back in the walk.**
   - What I saw: `r38-t16-walk` 07-empty-tap. `steps.json` records `open: builder-a`, `poseKept: true`, and the frame is
     the same as 06.
   - The docs say "a tap on empty sky goes one step back". Either the walk's tap was not empty, or the page or the docs
     are wrong. I cannot tell which from outside.
   - Fix: make it true or reword the Touch section.
8. **"Switches for a kiosk" made me hunt for a `?kiosk=` switch.**
   - The README's Wall row says so. There is none: kiosk is OS setup.
   - Fix: "set up as a kiosk (docs/wall.md)".
9. **The docs send me into the plan.** `docs/map.md`'s feed extras cite `docs/plans/wall/README.md D3`.
   - Fix: point at `docs/wall.md` "Feed fields" only.
10. **The demo is buried.** The one way to try the Wall without a fleet (`demo-fleet.mjs --size large`, then
    `/galaxy.html?demo=1`) is the last paragraph of the kiosk section.
    - Fix: one line in the README's Wall row: "try it: `node test/tools/demo-fleet.mjs --size large`".
11. **The plate is empty for about a third of the tour.**
    - What I saw:
      - `r40-galaxy` frames 3 and 7: mid-flight, no plate.
      - `r40-fx-afterglow` frame 7 (19.1 s): CLOUD is framed and the plate is empty.
      - `r40-fx-activity` frame 5 (13.1 s): the plate has faded to a ghost while REMOTE is still held.
    - At `?demo=1` speed that is expected, but a glance from the hallway at the wrong moment tells me only the fleet line.
    - The fleet line carries it, so this is minor.
12. **My plate.** Still 1:
    - `STATUS warn` is lowercase and small, under a 90 px `FAN LOUD`.
    - My two containers are called `2 rooms`. I would not call a lamp a room.
    - Fix: the status word in caps, as on trouble plates. `HOLDS` should name the kind it got from the feed
      (`container`), or just say `2`.

## fx (galaxy with `?fx=`)

- **beacon** (`r40-fx-beacon`):
  - The thin red pillar over HV2 in frames 1, 7 and 9 is the one thing I would point a visitor at. It is visible at
    overview size and clearly means "this one".
  - Nothing wrong seen.
- **warp** (`r40-fx-warp`):
  - Frame 3: streaks round HV1 and they read well.
  - Frame 12 (33.9 s): white streaks fan across the galaxy's middle at the overview, between DEMO-HOST and HV1. They
    look like noise and cross the trouble.
  - Fix: no streaks on a flight that ends at the overview, as `docs/wall.md` already promises.
- **afterglow** (`r40-fx-afterglow`):
  - In 35 s, nothing cleared, so I saw no ring. I cannot judge its look.
  - 22.1 fps here, the lowest. It was filmed while my stills ran beside it, so this is not the effect's fault.
- **activity** (`r40-fx-activity`):
  - Frames 7, 8 and 9: big pale rings sit round CLOUD and HOME planets.
  - To a stranger they look like a selection or a target marker, not "busy".
  - Fix: a thinner, smaller ring, or only the brightness change.
- **sweep** (`r40-fx-sweep`):
  - Frame 12: faint rings at HOME, HV2 and CLOUD. Without the docs I would not know what they mean. It is quiet and
    harmless.

## Across the variants

- What the galaxy should steal from `wall.html` radial: radial paints `ring`, a visible arc round PRINTER (still 3).
  The galaxy should too (finding 1).
- From radial's labels, the reverse: `LAMP` sits far from its dot, and the orange glow sits between PORCH-LIGHT and
  PRINTER (still 3). I could not tell which node my glow belonged to even there.
- Among the effects, beacon's pillar is the one idea that adds meaning at overview size without words. If anything
  borrows from it, it should be the calm sites' plate: a plain mark that says "fine".

**Which I would put in my hallway.** The galaxy with `fx=beacon`: it is the one a guest stops to look at, and the red
pillar says where it hurts before I read a word. I would still want my lights' `glow` on it before I would call it mine.

## Rubric

score galaxy overview 8
score galaxy legibility 7
score galaxy status 8
score galaxy touch 5
score galaxy wow 8
score galaxy calm 7
score galaxy performance 7
score fx-beacon wow 8
score fx-beacon calm 7
score fx-warp wow 6
score fx-warp calm 5
score fx-afterglow wow 3
score fx-afterglow calm 8
score fx-activity wow 5
score fx-activity calm 5
score fx-sweep wow 4
score fx-sweep calm 8

Touch is scored on the `r38-t16-walk` and `r39-t17-card` filmstrips:
- Turning, flying to a site and backing out to the overview work and look smooth.
- It loses points for the empty card (finding 3), the empty-tap mismatch (7) and the unreadable manual state (6).

## The 3 m check

`$RUN_DIR/shots/r40-3m.png`: still 4, the overview, scaled to a quarter (684 px wide).

**Yes.**
- **Where it is wrong:** HV2 and HV1 are red with a square, and REMOTE and MYLAB are amber with a triangle.
- **Site names:** all seven are readable: HOME, DEMO-HOST, CLOUD, HV2, REMOTE, HV1, MYLAB.
- **What is wrong:** the fleet line `2 CRIT · HV2 · HV1` and `STORAGE · POOL 97% FULL` read at that scale.
- **What does not survive the shrink:** `+5 MORE` and the top-right tag.

## console.txt, every line

- `r40-galaxy/console.txt`: empty (0 lines).
- `r40-fx-beacon/console.txt`: empty.
- `r40-fx-warp/console.txt`: empty.
- `r40-fx-afterglow/console.txt`: empty.
- `r40-fx-activity/console.txt`: empty.
- `r40-fx-sweep/console.txt`: empty.
- `r40-stills/1/` through `r40-stills/4/console.txt`: all four empty.
- `r38-t16-walk/console.txt`: empty.
- `r39-t17-card/console.txt`: empty.
