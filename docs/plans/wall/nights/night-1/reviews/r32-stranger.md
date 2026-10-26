# Review r32: the stranger

I found laneboard on GitHub and want its Wall on the old tablet in my hallway. I read README.md and the
docs it links, then the shipped files under `public/`, and nothing else (I read no plan and no PROGRESS.md).

What I looked at (all mine, all after the last Wall commit `c6d1e2d`):
- Filmstrips `$RUN_DIR/shots/r32-{radial,orbits,islands,mosaic}/sheet.png` (`demo=1`, 1368 wide, CPU 4x).
- Portrait-ish tablet stills, 768x900: `$RUN_DIR/shots/r32-still-<variant>/custom-dark-768.png`.
- Demo fleet `--size large` on :7795. My own feed `hallway` with `glow` on the host and `ring` on a guest,
  rewritten every 10 s while I filmed. That is the orange HALLWAY site in every sheet.
- **Caveat on the numbers:** load average was 31 on 10 vCPU while I filmed. Every `perf.json` shows
  `frames: 12` and a worst gap of 13-26 s. That measures this busy VM as much as the Wall. Do not compare
  these fps with earlier rounds.

## The stranger's path, worst stumble first

These hit every variant. They are why I could not have done this without reading the source.

1. **Stopping the tour: impossible.** I tried a touch, a key and a URL flag. There is no handler at all:
   `public/js/wall/main.js` registers no pointer, touch or key listener. The only URL flag is `?demo=1`,
   which makes the tour faster. The only way to stop it is the dev console (`__wall.tour.stop()`), and an
   old tablet does not have one. `docs/map.md` "Ambient" even says "a page that wakes on touch puts its own
   layer over the Map", and this page does not. Why it matters: in a hallway, someone will touch it.
   Nothing happens, so they conclude it is a frozen picture. Fix: tap to pause the tour on the site under
   the finger, show a small "paused, resumes in 60 s" chip, and resume after that idle time. Add
   `?tour=off` for a fixed overview.
2. **README never names the Wall.** It is not in the views table, the "Run it" section or the docs table.
   I found it only from one bullet in `docs/map.md` about the feed fields: "(the Wall,
   `docs/plans/wall/README.md` D3)". That points a user into an internal plan. Fix: a row in the README
   views table, "**Wall** `/wall.html`: the Map for a wall screen or tablet, a camera tour, trouble
   first", with a link to a user section in `docs/map.md`.
3. **The URL and the variants are documented only in code comments.** `/wall.html` is a guess from the
   file tree. `?variant=radial|orbits|islands|mosaic` appears only in `public/js/wall/variants.js`. A
   wrong variant falls back to radial silently, with only a `console.warn`. With `?variant=nope` the
   server still answers 200 and shows radial. Fix: a "Wall" section in `docs/map.md` with the URL, the
   four variants (one still each), `demo`, and what the tour does.
4. **Kiosk mode has no docs and no support.**
   - `wall.html` links no manifest. On Android, "Install app" from the Wall installs the app's manifest
     (`start_url: "/"`), so the icon opens the Board, not the Wall. iOS gets
     `apple-mobile-web-app-capable`, so Add to Home Screen may work there, but nothing says so.
   - There is no Wake Lock, so the tablet dims and sleeps after its timeout.
   - There is no fullscreen request on first tap.
   - Fix: give `wall.webmanifest` `start_url: "/wall.html"`, `display: "fullscreen"` and
     `orientation: "any"`. Take `navigator.wakeLock.request('screen')`, again on `visibilitychange`.
     Write a kiosk paragraph: Android "Install app" or Fully Kiosk-style browsers, iOS Guided Access, and
     turning off auto-lock.
5. **Putting it on a tablet means exposing the whole board, and nobody tells me.**
   - laneboard binds `127.0.0.1`. A tablet can only reach it through the reverse proxy from
     `docs/install.md`, and that proxy also serves the Board, which "can type into terminals" (README).
   - A tablet in a hallway is the least trusted screen in the house. No doc says whether there is a
     read-only or Wall-only way in.
   - The demo prints a "hub local listener (read-only)" on another port that also serves `wall.html`.
     The docs do not mention it.
   - Fix: document the safe setup in the Wall section, with a proxy location that allows only
     `/wall.html`, `/js/`, `/css/`, `/vendor/`, `GET /api/map` and the `/ws` map frames. Better still, a
     `wall`-scoped read-only listener in config.
6. **Pushing my own `glow`/`ring` failed on the demo, and the docs contradict each other.**
   - `docs/map.md` API says `POST /api/map/feeds` answers "409 on a builder a hub watches (push to the
     hub)". So I pushed to the hub (the demo is a hub) and got **404** `{"error":"not found"}`, on :7795
     and on the read-only listener.
   - The route is `modes: ['builder']` only (`server/routes/feeds.mjs`). On a hub, the only way in is the
     ssh forced command into the feeds dir.
   - I got my feed in by writing `hallway.json` into the demo's temp feeds dir. It then drew correctly:
     an orange halo on the HALLWAY site, and a 42% arc on `hall-printer` (still
     `r32-islands/frame-10.jpg`).
   - Fix: the 409 text should say "on the hub, drop the file into its feeds dir (ssh forced command)". The
     API docs should say the POST is builder-only. Or add the route on the hub for local callers.
7. **`ring` reads like every other ring.** Every node already carries thin grey status and metric arcs
   (`frame-10`: hall-light, kitchen-light, porch-light all have them). My 42% job ring on `hall-printer`
   is the same width and the same grey. From 3 m I could not tell "a job at 42%" from "a node". Fix:
   draw `ring` in its own style (thicker, a tick at the head, the percent as a label when the camera is
   on the site), and add a picture to the docs.
8. **The docs say what `glow` and `ring` are, not where they show.** I had to film to learn that `glow`
   lights the site's halo and that "gone while the feed is stale" means about a minute without a rewrite
   (the number is not in that bullet). Fix: one still per field in the Wall section, and the stale
   threshold written next to the fields.

## radial

1. **Labels collide with the frame on a tablet.** Still 768: "BUILDER-C" runs into "LANEBOARD ·
   DEMO-HOST LIVE" at the top right. The tag is fixed and the turning Map writes through it. Fix: keep a
   label-free band under the tag, or fade the tag while a label passes.
2. **The left column of labels floats away from its dots.** Still 768: HALL-PRINTER, FRONT-DOOR and
   PRINTER-3D sit two dot-widths left of a stacked column of dots. I could not tell which light is which.
   Fix: draw a leader line, or put the label on the dot's outward side at the same radius.
3. **The overview is unreadable at 1368 from 3 m.** Sheet frames 1 and 9: room labels are about 6 px.
   Only the red and yellow dots and the bottom line carry. Fix: in the overview, hide room labels and
   show only site names and the troubled nodes' names, at twice the size.
4. **Captions type in with a block cursor.** Sheet frame 3: "REM█". From the hallway, a half-typed word
   plus a cursor is noise. Fix: fade the whole name in. Keep the typing effect for the details line only.
5. **The red at the bottom is the only thing I read every time.** "HV2 · STORAGE · POOL 97% FULL" in
   every frame is good. But it stays the same while the camera visits calm sites (frames 4-8), so the
   tour and the alarm tell two stories at once. Fix: when the camera is on a calm site, dim the bottom
   line by one step. Keep it red.

## orbits

1. **Half the tour shows empty space.** Sheet frame 6 (57.9 s): the camera is between planets, and
   two-thirds of the screen is black dots. Frame 5 shows only a cursor where the caption should be. Fix:
   cut the flight (fade through) when a flight crosses more than one planet, or zoom out during long
   flights.
2. **Camera on HV1 with no caption.** Frames 2 and 3 (26.3 s, 49.2 s): the lock sits on a yellow node
   inside HV1, and there is no name and no reason. That is the worst site, and the stranger is not told
   why. Fix: every site leg shows its caption; if the leg is for a node, caption the node.
3. **Label clouds are wide and loose.** Still 768: HV1's labels (BUILDER-C, CI-RETRY, DEPS-BUMP,
   FEAT-SEARCH) stand in a column off to the left of the planet. "ACME-BILLING 1 of 6" overprints the
   nodes. Fix: the same as radial 2, labels on the orbit's outward side, with leaders.
4. **The overview is the calmest of the four, and the most empty.** Frame 1: six small planets on a big
   ellipse, with CLOUD and HALLWAY nearly lost. Fix: scale the ellipse to fill the short side.

## islands

1. **A site name overprints its own rooms.** Still 768: "EDG**CLOUD**GISTRY". The CLOUD title sits on
   top of EDGE-1 and REGISTRY. Labels in HV1 (BACKUP, PROXY, MONITOR) sit under the wrong dots. Fix:
   reserve a title strip above each island's lens, and place room labels inside their own island only.
2. **Zoomed on HV2 with no caption.** Sheet frames 5 and 6 (44.4 s, 47.3 s): the camera holds on HV2 and
   there is no caption, while the bottom line talks about HV1. Fix: as orbits 2.
3. **THERMOSTAT runs into the clock.** Still 768, bottom left. Fix: keep the clock's box label-free.
4. **The overview is the one I can read.** Frames 1 and 11: six lenses in rows, each with a big name. I
   know where things are before the camera moves. Keep it. Small fix: room labels are still too small
   from 3 m (frame 1). Show room names only for troubled rooms in the overview.

## mosaic

1. **Labels drift out of their tiles.** Still 768: DB and REGISTRY float in the gap between HV1's tiles
   and CLOUD's. KITCHEN-LIGHT sits in Hallway's region, not Home's. PRINTER-3D prints over the clock.
   In a honeycomb, the tile is the place, and a label outside its tile is a lie. Fix: clip each label
   to its tile, shrink it, or drop it.
2. **Blank caption with a cursor.** Sheet frame 11 (47.6 s): "TARGET 01 / 06 · SITE" and a white block,
   no name. Fix: as radial 4.
3. **The red tiles carry off-screen.** Frame 2 (20.7 s): the camera is on HV2 and the red STORAGE hex is
   clipped at the left edge in frames 4 and 5. Fix: when a troubled tile is on screen during a hold, the
   framing should include it whole.
4. **Many empty tiles in the overview.** Still 768: about a third of the hexes in HV1 and HV2 have no
   label, just a dot. From 3 m that is texture, not information. Fix: label only the coloured tiles in
   the overview.

## Across the variants

- **Mosaic**: filled tiles for trouble. A red or yellow hexagon reads from the far end of a hallway
  (still 768: VM-C, STORAGE, BUILDER-A/B). Every variant should fill the troubled node's area, not just
  colour the dot.
- **Islands**: the overview, with each site a named region in rows. The others should steal its "where
  is what" before the tour starts.
- **Radial**: the bottom trouble line is the same in all four. It is the one element that works for a
  stranger. Keep it identical everywhere.
- **Orbits**: the calmest motion. The others' flights could borrow its slow, short hops between
  neighbours.
- **All**: none of them says it can be touched, because none of them can be.

As someone who did not build it: I would want **mosaic** on my hallway wall. The red and yellow tiles
tell me from the door that something is wrong, without reading a word. Islands would be second, for the
overview I can actually read.

## Rubric

score radial overview 4
score radial legibility 3
score radial status 6
score radial touch 1
score radial wow 6
score radial calm 4
score radial performance 4
score orbits overview 4
score orbits legibility 4
score orbits status 5
score orbits touch 1
score orbits wow 5
score orbits calm 6
score orbits performance 3
score islands overview 7
score islands legibility 5
score islands status 6
score islands touch 1
score islands wow 5
score islands calm 6
score islands performance 4
score mosaic overview 6
score mosaic legibility 4
score mosaic status 8
score mosaic touch 1
score mosaic wow 7
score mosaic calm 5
score mosaic performance 4

## Console

Every `console.txt` from this round's shots: all of them are empty (zero lines, zero console or page
errors). That covers `r32-radial`, `r32-orbits`, `r32-islands`, `r32-mosaic` and the four `r32-still-*`.
