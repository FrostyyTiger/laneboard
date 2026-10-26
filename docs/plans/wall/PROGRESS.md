# Wall: progress

Night 1 (README §7): explore. The ground first, then one complete idle screen per direction, each
filmed under the throttle; the panel reviews them; the owner picks in the morning.

## Tasks

Notes for every builder round (planner, night 1):
- New tests are `test/wall-*.test.mjs`. `test/map-*.test.mjs` and `test/map.test.mjs` are fenced: a
  new or changed file there is reverted, so never put Wall tests under that name.
- Wall code lives in `public/wall.html`, `public/js/wall/`, `public/css/wall.css` (D1). Pure logic
  (tour order, caption lines, variant choice, layouts) goes in its own module with no DOM, so a
  test can import it directly (the pattern of `public/js/views/map/layout.js` and `model.js`).
- A change to `public/js/views/map/` is an option that defaults off; the app's Map tests stay green.
- Trouble comes from the existing status words (`server/map.mjs` `SEVERITY`: warn, attention, crit,
  down) and the Map's shapes (■ crit, ▲ warn, ◆ low, `overlays.js` `SHAPE_CODE`), never new ones.
- Filming (round 7): headless Chromium on this VM hangs on ANY page with an animated `<canvas>`
  once CPU throttling is on (a 7-line canvas page hangs too; 1x is fine), so `film.mjs` as-is
  never finishes on the Wall. Workaround that does not touch the fenced tool: a wrapper
  `$RUN_DIR/chrome-swiftshader.sh` that `exec`s the playwright chromium with
  `--use-angle=swiftshader --enable-unsafe-swiftshader "$@"`, then `CHROME=$RUN_DIR/chrome-swiftshader.sh
  node docs/plans/wall/loop/film.mjs …`. SwiftShader rasterises on the CPU at 2736x1824, so its
  fps measures this VM's software GL, not the page (wall: ~21 fps at 1x, ~17 at 4x without
  screenshots, 5 with them). Judge the page's cost by script time per frame instead (wrap
  `requestAnimationFrame` callbacks and time them; T4: 6.7 ms average at 4x) until the owner
  decides (see For the owner).

- [x] T1 (§7.1) Large demo fleet, static part: `test/tools/demo-fleet.mjs --size large` writes a
  topology and feeds built in `test/helpers/demo-hub.mjs` (`DEMO_TOPOLOGY_LARGE`, one `demoFeed*`
  per source, next to `DEMO_TOPOLOGY`/`demoFeed`): 5 sites (`hv1` and `hv2` hypervisors, a `cloud`
  site, a `remote` site, a `home` site with lights and a 3D printer), rooms and services under
  them, 100-150 nodes in `/api/map`, demo names only; the default size is unchanged — done when:
  `test/wall-demo-large.test.mjs` boots the large map model and counts 5 sites and 100-150 nodes,
  `test/demo-fleet.test.mjs` passes unchanged, and `curl /api/map` on the running demo agrees. (commit d35cac0; 98 model nodes, 114 on `/api/map` with the
  builders, 3 run nodes more over `/ws`; all calm but `backup` (drift missing), trouble is T3)
- [x] T2 (§7.1, D3) Feed extras: `server/map.mjs` carries `glow: {rgb, level}` and
  `ring: {progress}` from a feed's guest or service onto its node (validated: rgb three 0-255
  ints, level and progress 0..1, anything else dropped); the large demo's lights carry `glow`
  and the printer a `ring` whose progress advances every tick; the app ignores both — done when:
  `test/wall-feed-extras.test.mjs` shows valid extras pass, invalid ones drop, and the app's
  `test/map.test.mjs` passes unchanged (commit 11a0a2a; `feedExtras` in `server/map.mjs`, host, guest
  and service; level defaults to 1; a stale feed carries neither; four lights glow, porch off;
  the ring is a ten-minute job from the clock, so it moves every tick and wraps; `/api/map` on
  the live demo shows both)
- [x] T3 (§7.1) Large demo fleet, live part: trouble that comes and goes on a schedule (one crit,
  one attention, one warn, each on a different site, each clearing and returning), a door-like
  feed event every few minutes (fewer with `--tick` slow), and `flow` links whose events make
  comets — done when: `test/wall-demo-large.test.mjs` steps the large demo's cycle function
  through a full period and sees each of crit, attention and warn appear and clear, and at least
  one event per period. (commit 3a575ea; `demoLargeCycle(n)` in ticks, period 90 = 6 min at 4 s:
  crit hv2 `storage` ticks 0-39, attention remote `office-printer` 27-66, warn cloud `api-prod`
  54-84, calm 85-89; door at 5/35/65; a flow event with `link` every third tick. Two generic feed
  fields made it possible: alert level `attention`, and `link` on feed events (a comet), both in
  docs/map.md. Lanes on hv1 add their own attention from the builders.)
- [x] T4 (§7.2) [ui] The Wall page ground: `public/wall.html`, `public/css/wall.css` (brighter
  tokens scoped to the page: text-2 88 %, text-3 74 %, lines 0.16/0.30/0.48, dark only),
  `public/js/wall/main.js` loading `/api/map` and the `/ws` map messages into
  `createMap(el, { ambient: true })` (the app's `public/js/core/net.js` shows the message shape;
  do not change it), `public/js/wall/variants.js` (`pickVariant(search)`: `?variant=` from a
  registry, unknown or missing falls back to `radial`, `?demo=1` read here too), and
  `window.__wallPerf = {frames, worstGapMs}` counted in `map.onDraw` — done when:
  `test/wall-variant.test.mjs` covers the variant switch and demo flag, a still frame of
  `wall.html?variant=radial` on the large demo shows the Map with no console error, and
  `perf.json` from `film.mjs` reports frames. (commit 68c058b; the tokens are `color-mix` of
  `--text-1` in `wall.css` because guardrail 4 keeps colour literals in tokens.css, and the
  canvas takes them; `window.__wall = {map, variant, demo}` for the tour; `frontend.test.mjs`
  now knows `wall.css` and `js/wall/` are another page. Still frame clean, film reports frames
  (`source: wall`), but see the filming note above: under the throttle this VM only films with
  SwiftShader, which caps fps near 17-21 even unthrottled, so 27 fps cannot be shown here yet;
  the Map's own script is 6.7 ms/frame average, 27 ms worst, at 4x.)
- [x] T5 (§7.2) The camera tour: `public/js/wall/tour.js`, pure order and timing
  (`tourOrder(nodes)`: sites with anything at warn or worse first, worst first, then calm ones;
  re-ordered every cycle; overview ~20 s, fly in at zoom ~2.3, hold ~25 s, out, next; `?demo=1`
  ~4 s per site) plus a small driver that calls `map.focus(id, zoom)` / `map.fit()` — done when:
  `test/wall-tour.test.mjs` shows trouble visited first, a cleared site falling back into the calm
  order next cycle, and demo timings; a filmstrip of `radial&demo=1` shows the camera going in and
  out of sites (commit 8dcf5f4; sites ranked by
  their subtree's rollup (`model.js` `rollup`), the order taken again before every site so trouble
  that starts mid-cycle jumps ahead of the calm sites still to come, one visit per site per cycle;
  `__repos` toured only in trouble; legs `{kind, id, status, index, count, arriveMs, ms}` through
  `tour.onLeg` for T6/T7; demo: 4 s overview, 2.25 s flight + 1.75 s hold. Filmstrip
  `$RUN_DIR/shots/r11-radial/`: overview, hv2 (crit) first, in and out of sites, back to the overview;
  0 console errors; fps 6.7 is the SwiftShader-plus-screenshots number from the filming note, the
  tour adds no per-frame work. The r9 camera phrasing (anticipation, beat on arrival) is not in:
  still the owner's call.)
- [x] T6 (§7.2) [ui] Captions: `public/js/wall/caption.js` with a pure `captionLines(node, model,
  index, count)` (kicker `TARGET 02 / 05 · SITE`, name, 3-6 lines: the trouble line first in its
  status colour with its shape, status, cpu/mem with thin bars, hardware/where/uptime from
  `detail`, room count) and the DOM part: top-left plate (dark translucent, two corner brackets),
  the name typed letter by letter in big condensed caps with a block cursor, lines fading in one by
  one, fade out on leave; driven by the tour — done when: `test/wall-caption.test.mjs` covers the
  lines for a calm site, a site in trouble and a node without detail; a filmstrip frame shows a
  caption typed in, legible and not cut off.
- [x] T7 (§7.2) [ui] Target lock: `public/js/wall/lock.js`, four corner brackets that close in
  around the focused node at `map.screenOf(id)` as the camera arrives and open as it leaves,
  tracked every frame through `map.onDraw` — done when: a filmstrip frame shows the brackets on
  the visited node, and a test (`test/wall-lock.test.mjs`) checks the bracket geometry function
  (pure: size from node radius and zoom, closing over time) (commit 31e86d2; `lockGeometry`,
  `lockProgress`, `nodeScaleAt`, `lockTone` pure; closing starts 600 ms before arrival, shut 700 ms
  later, opens over 350 ms when the next leg starts, the next lock waits until it has; size = the
  node's drawn radius at the Map's node scale for the tour zoom (from `snapshotScene().outer`, no Map
  change) + 2.2 % of the short side, starting 7 % further out; grey on calm, status colour on
  trouble; DOM corners moved by transform only. Filmstrip `$RUN_DIR/shots/r17-radial/`: red lock on
  hv2, amber on hv1, grey on cloud/remote, none at the overview, 0 console errors; fps 7.3 is the
  SwiftShader-plus-screenshots number, the lock adds four style writes a frame. Seen: the Map's own
  site label (`HV2`) sits on the bottom-right bracket; T24/T15 (label placement) can keep labels
  clear of the lock box, or the lock can skip that corner.)
- [x] T8 (§7.2, D3) [ui] Glow layer: `public/js/wall/glow.js`, a canvas under the Map's
  transparent canvas that paints soft radial glows at `screenOf(id)` for nodes with `glow`
  (their colour, size by `level`) and a progress ring for nodes with `ring`; no work when no node
  carries either — done when: `test/wall-glow.test.mjs` covers which nodes paint and how
  (pure part), and a still frame of the large demo shows the home lights glowing and the printer
  ring under the throttle without fps dropping under 27. (commit 01cd9f7; `glowMarks`, `glowGeometry`,
  `ringGeometry`, `zoomAt` pure; a sprite per colour drawn with `drawImage`, radius max(7 node radii,
  5 % of the short side) scaled 0.55-1 by level, centre alpha 0.42 at full level; the ring grey (track
  `--line-weak`, arc `--text-2`) outside the node; the layer follows `onDraw` only while a node
  carries an extra, clears only the boxes it painted; zoom eased from the tour's legs (the Map does
  not expose its zoom). The ground (`--tex-dots`, `--bg-canvas`) moved from `.map` to `.wall-stage`
  so the glow sits between it and the Map's canvas. Round 18 built T8 before T9 because T9's
  done-when films the glow. Filmstrip `$RUN_DIR/shots/r18-radial/`: four lights glow (violet, warm,
  white), the printer ring shows, crit and attention still the loudest, 0 console errors. Script
  time per frame at 4x, 20 s each, with the glow: 7.2-11.5 ms; without it: 10.4-11.4 ms. The glow's
  cost is lost in run-to-run noise. fps 6.2 is the SwiftShader-plus-screenshots number from the
  filming note. A 1x glow canvas was tried: no measurable gain.)
- [x] T9 (§7.2) [ui] Frame: vignette (edges darkened so text sits on quiet ground), a big clock
  bottom left, bottom right one line for the worst fleet problem (status colour and shape) and one
  ambient fact, a small tag top right; `public/js/wall/frame.js` with a pure `worstLine(model)` —
  done when: `test/wall-frame.test.mjs` covers the worst line (crit beats attention beats warn,
  calm fleet says so), and a filmstrip of `radial&demo=1` (the baseline for every direction) shows
  caption, lock, glow and frame together with fps at or over 27. (commit 1fc2f71; `worstLine`
  groups nodes in trouble under their topmost node in trouble (a lane and its waiting session are
  one problem), down > crit > attention > warn, `site · name · why`, `more` = other problems, calm
  says `all calm`; `ambientLine` `5 sites · 115 nodes · 7 working` (no core, no `__repos`); clock
  `HH:MM` 24 h + `mon 26 oct`, one tick a minute; tag `laneboard · <title>` + `live`/`offline`
  (warn when offline). Type on the caption's scale: clock 6.9vmin in text-3 (big but quiet), fleet
  line 4.3vmin in its status colour, calm line 2.7vmin grey, facts 1.7vmin mono; margins 8vh/6vw as
  the caption, tag on the kicker's line. The line wraps onto two balanced lines rather than cut,
  never inside a name or a hyphenated word (`builder-c`). The vignette is `--tex-vignette` in
  tokens.css: the guardrail allows gradients only in `--tex-*` tokens (see For the owner). T21's
  `+N more` count is shown already; its 3 m step size is still T21. Filmstrip
  `$RUN_DIR/shots/r22-radial/`: caption, lock, glow and frame together, trouble the loudest, 0
  console errors; fps 3.3 is the SwiftShader-plus-screenshots number (filming note); script time
  6.67 ms/frame average, 23 ms worst at 4x, same as T4's Map alone. Seen: in zoomed frames map nodes
  run under the clock and fleet line (the vignette quiets them; T17/T30's safe area should keep
  the bottom band clear). The `why` of a lost builder counts seconds, so the line changes every tick.)
- [x] T10 (§5) Map layout option: `createMap(el, { layout })` takes a layout function with the
  shape of `layout.js` `layout` (`{pos, center, kids}`), and `{ rings: false }` hides the ring
  circles, ring labels and bearing dial; both default off (the radial layout and today's drawing)
  — done when: `test/wall-map-layout.test.mjs` shows a custom layout places nodes where it says
  and rings off draws no dial, and every `test/map-*.test.mjs` passes unchanged. (commit a8aae66;
  `polarLayout` in `layout.js` gives a custom layout's x/y the `r`/`angle` the Map springs in, `depth`
  from `kids` when missing, `ring` 0, positions without finite x/y dropped; `rings: false` reaches the
  renderer as `scene.rings`, so `drawRings` draws nothing and `ringGeometry` returns no boxes (labels
  stop keeping clear of a dial that is not there). For T12/T13: nodes spring in polar around the
  world origin, so a move swings along an arc around (0, 0); and the parent-child branches
  (`render.js` `treeCurve`) still bend along circles around the origin, which will look wrong on
  islands or orbits: those variants likely need a straight-branch option next (defaults off). Fit
  still uses the farthest node's radius (`maxRadius`), a circle, so a wide layout fits by its
  corner; T17 owns the fit. `test/helpers/fake-map-dom.mjs` copies the fenced Map test's fake DOM.)
- [x] T11 (§5) [variant:radial] Today's constellation refined for a wall: spacing for 100-150
  nodes, line density, label sizes for distance (sites and rooms legible at the overview,
  services and leaves may be dots), in `public/js/wall/variants/radial.js` — done when: a
  filmstrip `$RUN_DIR/shots/<round>-radial/` under the throttle shows site and room labels
  legible at the overview, trouble the loudest thing, the tour visiting it first, fps >= 27.
  (commit 9e6471f; variants carry `mapOptions` (variants.js), main.js spreads them under `ambient`.
  Two Map options, both default off: `labelSize(node, {s, trouble})` -> px, 0 (no name at this
  zoom) or `{px, inward}` (centred on the bearing toward the centre); and a custom layout's
  `ringR` on its positions, which `ringLabels` (so hairlines and legends) uses instead of RINGS.
  Radial: type steps 11 · 15 · 20 · 26 (4:3), sites 26 facing the core (pointing outward they
  landed on their own rooms), rooms/builders 15, calm services and leaves no name at the
  overview (named at the Map's size once s > 1.25), trouble at least at 15, core unnamed (the tag
  names it; it collided with the site names), `__repos` at the room step (a grouping, no place).
  Spacing: `WALL_RINGS` 0 200 380 490 575 650 (Map: 0 150 290 420 540 640): sites and rooms a
  third further out, the dot rings close up, the outermost about where it was. Tests
  `test/wall-radial.test.mjs`. Filmstrip `$RUN_DIR/shots/r26-radial/`, still `r26-still/`: sites
  read at the overview, the tour goes to HV1 (attention/crit) first, 0 console errors; fps 7.8 is
  SwiftShader plus screenshots (filming note); script 5.66 ms/frame average, 19.8 ms worst at 4x
  (T9: 6.67/23). Line density not changed here: the room->service fans are T19's stubs, the edge
  labels T27. Seen and left to their tasks: some room labels still pushed a line or two off their
  node by the collision pass (PROXY, FRONT-DOOR; T15 pins them), and the larger rings bring the
  bottom nodes near the fleet line (T17's safe area).)
- [x] T12 (§5) [variant:orbits] The rings as ellipses that use the full width; sites as planets
  with their rooms in orbit around them, in `public/js/wall/variants/orbits.js` (a pure layout
  through T10's option, `rings: false` plus its own orbit lines) — done when: a test checks the
  layout fills the screen's aspect (no node outside the frame, width used); a filmstrip
  `$RUN_DIR/shots/<round>-orbits/` shows the tour, caption, lock and trouble first, fps >= 27.
  (commit 0a7e10c; the core is the sun, sites are planets on an ellipse `(stretch·t, t)` at even
  angles; `arrange` tries both phases and stretches 1-3.2 and keeps the largest overview scale,
  then of near ties the widest (at 16:9 the height binds, so the width is free air). Each planet's
  children and grandchildren ride one circle (named 34, dot 11 world units of arc, min radius 72),
  the planet's name sits on the orbit at six o'clock in a gap the moons leave for it; deeper
  nodes (sessions) a step outside; a run on the core circles the sun. Names point away from the
  planet. Labels are radial's `labelSize`. No turn (`ambient: {drift: 0}`): a turning ellipse
  leaves the screen. Map hooks, all inert without a custom layout that sets them: `guides`
  (ellipses drawn where the rings were), `bounds {x, y, cy}` (the fit uses the layout's own view,
  `cy` puts the camera below the origin so the bottom 20 % stays for the clock and fleet line),
  per-position `branch` ('none' / 'straight' / an arc around a point, `layout.js branchCurve`;
  in layout.js because a fenced test pins render.js's exports), `labelAngle`, `labelAt`.
  Variants may give `optionsFor(aspect)` and `ambient`; `variants.js mapOptionsFor` builds them,
  main.js passes the stage's aspect. Tests `test/wall-orbits.test.mjs` (3:2 and 16:9: inside the
  safe area, >60 % of the width spanned, systems clear of each other and the sun, members on
  their orbit and out of the name's gap, the Map hooks off by default). Filmstrip
  `$RUN_DIR/shots/r27-orbits/`, still `r27-still/`: tour HV1 (attention) first, then CLOUD
  (warn), the calm ones, overview, HV1 again first once crit; caption and lock on each; 0 console
  errors; fps 4.1 is SwiftShader plus screenshots (filming note); script 8.5 ms/frame average,
  47 ms worst at 4x (radial measured 11.4/69 in the same minute: the VM was busy). Seen and left
  to their tasks: HV1's left side is crowded (builders, lanes and their trouble labels pushed off
  their nodes by the collision pass, T15); a crit service's name is white, the hue only on its
  mark (T16); `ACME-BILLING` reaches 16 px from the left edge (labels extend past the node safe
  area, T17); a flight between planets swings along an arc round the sun (the Map springs in
  polar, T10's note).)
- [x] T13 (§5) [variant:islands] Each site its own cluster laid out across the screen, links between
  sites as long arcs, the camera touring island to island, in `public/js/wall/variants/islands.js`
  — done when: a test checks islands do not overlap and fill the aspect; a filmstrip
  `$RUN_DIR/shots/<round>-islands/` shows the tour, caption, lock and trouble first, fps >= 27.
  (commit 8b38cfa; chosen to look unlike orbits, whose planets already read as clusters: an island
  is set like a paragraph in a lens. Rooms are words on rows (long in the middle, short at the
  ends), each a mark with its name flush left under it (`labelAngle` down, zoom-stable, one
  baseline per row), what it holds a row of dots to its right (a dot in trouble is named above
  it), a builder a word of its own with its lanes and sessions as its dots. The site's mark is a
  word in the middle row, so the camera lands mid-island; the site's name sits on a faint
  coastline (a `guides` ellipse, `labelAt` at its top, `__repos` too at the room step). No
  branches inside an island. Islands go in one to three rows in model order, each row spread
  edge to edge across the safe area, each next row tucked into the corners of the one above
  (ellipse clearance with `clearOf`, not boxes); the hub (core plus any run) is a small island
  in the middle of the order. The Map's own cross-links are the long arcs (`linkCtrl` bows them
  toward the middle). Sizes are CSS px at scale 1 on a 912 px high screen, names measured for
  the condensed face (0.44 em a character: orbits' 0.62 overestimates by about 40 %). The large
  demo fits at scale 0.87 (height-bound; orbits 0.7). More row pitch does not help: the scale
  falls by the same factor. Word spacing has about 25 % slack, so names still clear at 0.87.
  `SAFE.top` is 12 % here (CLOUD's name ran into the top-right tag at 8 %). The layout is
  memoised on ids/parents/kinds/names, so `/ws` status frames reuse it (the T36 lesson). Tests
  `test/wall-islands.test.mjs` (3:2 and 16:9 inside the safe area and >60 % of the width, every
  node inside its own coastline and outside the others, coastlines never cross, words on a row
  do not run into each other, the memo, the registry). Filmstrip `$RUN_DIR/shots/r30-islands/`,
  still `r30-still/`: tour HV2 (crit) first in each cycle, then HV1, CLOUD, REMOTE; caption and
  lock on each; 0 console errors; fps 2.8 is SwiftShader plus screenshots (filming note); script
  7.5 ms/frame average, 56 ms worst at 4x (orbits 10.7/55 in the same minute). Seen and left to
  their tasks: HV1's top row (three builders with lanes in trouble) still stacks the lane names
  above their dots and pushes VM-B a line (T15); the hub is a lone mark at the left edge of the
  second row; a few names pushed a line by the collision pass where a crit mark's ring is wider
  than the pitch allows.)
- [x] T14 (§5) [variant:wild] The wild-card direction from Q5's answer (named after it), in
  `public/js/wall/variants/<name>.js`; waits for Q5 — done when: a test checks its layout's main
  property (from the research), and a filmstrip `$RUN_DIR/shots/<round>-<name>/` shows the tour,
  caption, lock and trouble first, fps >= 27.
  (commit c6d1e2d; `?variant=mosaic`, `public/js/wall/variants/mosaic.js`: a pointy-top honeycomb,
  each site one connected region with an empty one-cell channel round it (Q5's gap rule), regions
  grown on the grid from treemap slots (model order, hub in the middle, 1-3 rows), the region
  furthest behind its size claiming next. Two departures from Q5, both for its fixed-name
  promise: a tile per PLACE (site, room, builder, repo, core: 56 tiles on the large demo), not per
  node (114 tiles would not hold a 15 px name on the tablet); services, lanes, sessions, packages
  and runs are a row of dots at the top of their place's tile (dots, mark, name: a card). And a dot
  in trouble is not named at the overview (it would spill into the tile above): its tile takes the
  tone; the Map names it once the camera is in the site (s > 1.25). The site's tile is the region's
  first cell (its slot's centre), its name at the site step; rooms spiral out from it worst first
  (own or a dot's status), a builder after its room. The order is taken when the tree changes
  (memo on ids/parents/kinds/names, T13's lesson), so a status change only recolours. Hex 50 px at
  scale 1 (87 px across); the large demo fits at 0.99 (3:2) and 0.95 (16:9), height-bound, so a
  larger hex only shrinks the scale: the tile pitch stays 86 px on the glass. Map hook, inert
  without it: a `guides` entry may be a polygon `{pts, tone?}` (render.js `drawPolyGuide`): calm
  tiles a 1 px --line at 0.85, a toned tile (crit/warn/low) its edge in the tone at 1.5 px and a
  0.14 fill, the loudest thing at the overview. Tests `test/wall-mosaic.test.mjs` (hex geometry;
  3:2 and 16:9: a tile per place, no two on a cell, regions connected, no two regions adjacent,
  inside the safe area, >60 % of the width, dots inside their tile; worst room next to the site;
  status keeps positions and recolours, the lane's crit colours its builder's tile; determinism;
  the polygon renderer; labels; registry). Filmstrip `$RUN_DIR/shots/r31-mosaic/`, still
  `r31-still/`: crit tiles (VM-C, BUILDER-C) red in HV1 and the tour there first, caption and lock
  on each site, the overview reads as six regions; 0 console errors; fps 3.4 is SwiftShader plus
  screenshots (filming note); script 6.6 ms/frame average, 39 ms worst at 4x (islands 6.6/89 in
  the same minute). Seen and left to their tasks: neighbouring 12-character names (LIVING-LIGHT
  DESK-LIGHT, PORCH-LIGHT AUTOMATION) nearly touch at the 86 px pitch; the collision pass still
  moves a few names off their tile (OBJECT-STORE above its mark, FRONT-DOOR under KITCHEN-LIGHT,
  T15); inside a site the Map's sublabels crowd the tiles (r20-skeptic #2, owner); the hub is a
  lone tile with a big core mark; the cross-site flow links run across the honeycomb as the Map's
  arcs (Q5 asks bundles between region centres: not built).)
- [x] T15 (§2, §5) [variant:radial] (r9-film-ui #2, #7) Type hierarchy and stable labels: three steps
  from mm via `devicePixelRatio` (Q3): sites condensed semibold caps for 1.5-2 m, rooms one step
  down, services/leaves/lanes unlabelled at the overview (named only when the camera is in that
  site); each label pinned outward from its node and not re-placed while on screen — done when: a
  test checks the label-size function (site > room, mm to px) and a label's side stays fixed
  across two draws; a still and a filmstrip show no overlapping or hopping labels. Option on the
  Map defaults off.
  (commit 6607e27; `public/js/wall/type.js`: cap height from arc minutes (16' at the read distance),
  CSS px per mm from `?mm=<screen height mm>` or else `devicePixelRatio` (2x and up = the 12.3" tablet,
  10.5 device px/mm; 1x = a 24" monitor, 3.6), snapped to the 4:3 scale 11·15·20·26·35·47. Sites are
  read at 1 m, rooms at 0.45 m: the tablet gets 35 / 15 (sites were 26), a desk monitor 26 / 11.
  Rooms at 0.6 m (20 px) were tried and did not fit radial's 45 rooms (names pushed off their nodes,
  still `r35-still` first take), so rooms are an arm's-length tier; Q3's own conclusion is that the
  3 m read on a tablet is shape, colour and the trouble line. The face was already Barlow Condensed
  600 caps. Map option `pinLabels` (defaults off; radial sets it): a name keeps its side until its
  bearing is ~20° past the vertical (PIN_FLIP 0.35), and the collision pass's line while drawn; a
  name that leaves the screen is placed afresh. Services, leaves and lanes stay unnamed at the
  overview unless in trouble (T11's rule kept: north star 1 names trouble). Orbits, islands and mosaic
  keep 26 / 15 (`BASE_STEPS`): their layouts are spaced for it (T47). Tests `test/wall-type.test.mjs`
  (arc minutes, px/mm, scale snap, site > room on every density, `?mm=`, radial options per screen),
  `test/wall-radial.test.mjs` (a pinned name keeps its side and line across two draws, the app's
  flips; past the hysteresis it turns over). Still `$RUN_DIR/shots/r35-still/`, filmstrip
  `r35-radial/`: five site names clearly the first read, no overlapping labels; 0 console errors;
  fps 2 is SwiftShader plus screenshots (filming note); script 10.7-12.3 ms/frame at 4x against
  9.1 for the commit before, at load 36 (noise level per r32). Seen and left to their tasks: in the
  home cluster some names still sit a line or two from their node (THERMOSTAT, FRONT-DOOR,
  PRINTER-3D; the room ring is full there, T19/T27); in a site the caption plate covers big site
  names behind it (T30).)
- [x] T47 (§2, T15) [variant:orbits] Type steps from distance for orbits (split round 36: one
  variant a task, each layout is its own measuring; islands T48, mosaic T49): its layout spaced names
  for radial's `BASE_STEPS` (26 / 15); move it to `type.js` `stepsFor` (35 / 15 on the tablet) with
  its spacing re-measured, and `pinLabels` — done when: its layout tests pass at the new steps and a
  still shows no overlapping names. (commit efc5c84; `optionsFor(aspect, screen)` takes the steps from
  the screen like radial (tablet without one: radial's own `labelSize`), `planet`/`layoutFor` take
  `steps` (the name gap at six o'clock and the box below the orbit sized for them); `OVERVIEW_SCALE`
  0.7 -> 0.68, as the overview on the large demo at 1368 x 912 is 0.682 at 35 px (0.726 at 26).
  `pinLabels` on: no turn here, but the collision pass re-placed names as the zoom changed. Test: at
  the tablet's, the desk's and the old steps each planet's name fits between its nearest moons at the
  overview scale (a small system with every moon above its centre: inside its box). Still
  `$RUN_DIR/shots/r36-still/`, filmstrip `r36-orbits/`: five site names at 35 px clearly the first
  read, no overlapping names, tour with caption, lock and trouble first, 0 console errors; fps 4.3 is
  SwiftShader plus screenshots (filming note). Seen and left to their tasks: label clouds still loose
  around HV1 and HV2 (T45), cursor-only caption frames (T42), K8S-1 near the top edge (T17).)
- [x] T48 (§2, T15, T47) [variant:islands] Type steps from distance for islands: `islands.js`
  measures names at `BASE_STEPS` (`nameW`, `siteNameW`); move it to `type.js` `stepsFor` per screen
  (`optionsFor(aspect, screen)`, as orbits), re-measure the island sizes and title strip (with T43),
  `pinLabels` — done when: `test/wall-islands.test.mjs` passes at the new steps and a still shows no
  overlapping names. (commit 9d546e6; `optionsFor(aspect, screen)` takes the steps from the screen
  (35 / 15 on the tablet, 26 / 11 on a desk monitor), `island`/`shapeOf`/`layoutFor` take `steps`, and
  `sizesFor(steps)` sizes the title strip (`title` 0.62 of the site step: 22 at 35, 16 as before at 26).
  `pinLabels` is NOT on for islands. Tried in still `$RUN_DIR/shots/r39-still` (first take): the pins
  held the line the collision pass gave names during the intro flight, so CI, GIT-MIRROR and CLOUD stood
  a row or more off their marks (CLOUD into the tag). Islands has no turn and every name already gets its
  side from `labelAngle`, so pinning only freezes the bad intro placements. Overview scale on the large
  demo is 0.85 at 35 px (0.87 at 26): the names in px are ~15 % wider in world units than measured. The
  word spacing absorbs that, so no feedback loop was added. Tests: the steps for each screen, the title
  strip, and at 35/15, 26/11 and 26/15 the site names stay inside the view and clear of each other and the
  room names fit their words. Still `r39-still/` (final), filmstrip `r39-islands/`: five site names at
  35 px clearly the first read, sitting on their coastlines, no overlapping names, tour with caption and
  lock, 0 console errors. fps 3.9 is SwiftShader plus screenshots (filming note). Seen and left to their
  tasks: lane names stacked above HV1's builders (FIX-LOGIN / FEAT-SEARCH, ACME-BILLING), the caption
  plate over the visited island (T30), HV1's hold labels dense (T43).)
- [x] T49 (§2, T15, T47) [variant:mosaic] Type steps from distance for mosaic: its `labelSize` borrows
  `baseLabelSize` (26 / 15); move it to `stepsFor` per screen with names that still fit their tiles
  (with T44), `pinLabels`; then drop `BASE_STEPS`/`baseLabelSize` from radial.js if nothing uses them —
  done when: `test/wall-mosaic.test.mjs` passes at the new steps and a still shows no overlapping names. (commit 883d06f; `optionsFor(aspect, screen)` takes the steps from the screen (35 / 15
  on the tablet, 26 / 11 on a desk monitor). At 35 a site name does not fit one hex (86 px on the glass,
  REMOTE ~104 px): one hex per site forced sites down to 20, a step above rooms (still
  `$RUN_DIR/shots/r40-still-a`). So a site's tile is now a **plate of two cells** side by side
  (`plateCorners`, one cell more per site, the scale unchanged at 3:2), set as a title plate: mark on the
  left of the middle line, name flush left a fixed gap after it (`labelAt`, `plateName`), dots over the
  left cell. It uses the middle line because the plate is only half a hex tall where its cells join: a
  name under the mark crossed the joint and the next row's dots (still `r40-still-b`). `siteStep`: one
  step for every site, the screen's own if the longest name fits its plate at the overview (`plateRoom`
  at the overview scale for the screen height), else the next that fits, never the room step;
  `layoutFor` sets it per fleet, `labelSizeOn` reads it. `textW` (the condensed face's width estimate)
  moved to type.js, islands uses it too; `BASE_STEPS`/`baseLabelSize` removed from radial.js. `pinLabels`
  NOT on, as for islands (round 39): tried in `r40-still-pin`, names kept their intro-flight lines, a row
  off their tiles, DESK-LIGHT on the fleet line. Tests: siteStep, plate geometry, a plate per site (two
  cells east of each other) and none for the hub or REPOS, names fit their plates on the tablet and a desk
  monitor at 3:2 and 16:9, a long site name steps every site down together, flush left. Still
  `r40-still/`, filmstrip `r40-mosaic/`: five site names at 35 px clearly the first read, `◉ HV1`
  `◉ CLOUD` with one gap, no overlapping names, tour with caption and lock, trouble tiles toned, 0 console
  errors; fps 2.7 is SwiftShader plus screenshots (filming note); script 8.3-11.9 ms/frame at 4x against
  12.0 for the commit before in the same minute (load 35, noise). Seen and left to T44: room names still
  leave their tile where 13-14 characters meet an 86 px tile (KITCHEN-LIGHT, PORCH-LIGHT pushed below,
  OBJECT-STORE over a mark's ring); T42's cursor-only caption frames.)
- [x] T16 (§2) [variant:radial] (r9-film-ui #3) Trouble is the loudest thing: at the overview a crit
  node is the only saturated area (halo a few node radii wide, via T8's glow layer), attention in
  lanes stays at mark size and does not outshout a crit elsewhere — done when: a still of the
  large demo during the crit window shows the crit as the first thing the eye lands on (reviewer
  check), and a test checks the halo size ranks crit > attention > warn. (commit 5361303; `glow.js`
  `haloMarks`, `haloGeometry`, `HALO`: a node whose OWN status is crit or down (not a site rolled up from
  below) gets a soft halo in `--p1`, 6 node radii, floor 4.5 % and ceiling 11 % of the short side (a
  hold does not wash the screen red), centre alpha 0.6; attention 2.2 radii capped at 3 %, alpha 0.22,
  in the warn tone (at mark size); warn none (its ▲ is enough); a node under a parent with an equal or
  louder halo is one problem, one halo; worst painted last. A halo fades in over 600 ms; while any crit
  halo shows the lights paint at half their alpha (they were the other saturated area). Sprites are
  now tinted from a white falloff, so token colours in oklch work. Off by default: `createGlow(…,
  {halos})`, the variant's `halos` flag (variants.js), radial sets it; orbits and islands could take it
  with one line, mosaic has its toned tiles (T61). Tests `test/wall-glow.test.mjs` (ranking, sizes at
  the overview and in a hold, which nodes, the driver: off unless asked, order, hush, fade, the large
  demo's crit window). Still `$RUN_DIR/shots/r43-still/`: STORAGE's red halo is the first read, the
  waiting lanes keep to their ▲, lights hushed; filmstrip `r43-radial/`: halos on STORAGE and the lost
  VM-C at the overview and in holds, 0 console errors; fps 1.8 is SwiftShader plus screenshots
  (filming note); the cost is one `drawImage` per halo on a layer already following the frame for
  the lights.)
- [x] T17 (§5) [variant:radial] (r9-film-ui #4) Overview fit and safe area: fit to the bounds of the
  drawn nodes and labels, not the outer ring; safe area 8 % top/bottom, 6 % sides; top-left
  caption area kept clear — done when: a test checks no node or label lies outside the safe
  area at 3:2 and 16:9, and the still no longer touches the top edge. (commit 01d7d4a, with a46934a; radial's layout
  carries `bounds` from `fitBounds`: the largest scale at which every node, its rings and any name it
  could carry (trouble names any node at the room step, so the fit does not jump when trouble comes or
  goes; a run's round counted) lie inside the safe rectangle at every bearing of the turn (a name runs
  sideways from its anchor, so at 3/9 o'clock it takes its width, at 12/6 its line), plus the bearing
  dial. Safe area `SAFE` 6 % sides, 8 % top, and at the bottom 16 %, the frame's band (the clock and a
  two-line fleet line reach up to ~81 % on the tablet): 8 % there put the rim under the fleet line. The
  turn is around the camera, so an off-centre fit would wobble the constellation: a new ambient Map
  option `centerY` (default 0.5) lifts the view's centre to the safe rectangle's middle (0.46). The
  collision pass moved names up to four lines outward, past the top: a new Map option `labelInset`
  (default off: canvas edges) keeps its moves inside the safe area. The fit is 0.51 on the tablet
  (was 0.70), so `WALL_RINGS` went to 0 280 470 535 580 625: the dots outside gave up world units and the
  sites and rooms took them (room ring as wide on the glass as before, site names no longer collide at
  the core; overlapping-name frames over a turn 68 against 186 with the old rings, 5 at the old full
  fit: the top builder cluster and HOME's lights, T27's ground). Holds keep their scale: `holdZoom`
  (variant field, 1.45 / fitScale, here ~2.9 instead of 2.3) through a new tour option `zoomFor`, legs
  carry `zoom`; lock and glow read the Map's real `fitScale` (snapshotScene, added) instead of
  guessing it from the outer ring. Caption: no node under its head at the overview; one name
  (ACME-BILLING) can pass the corner, and the caption only shows in holds. Tests
  `test/wall-radial-fit.test.mjs` (the real renderer over a whole turn in 3° steps at 3:2 and 16:9 on
  the large demo as the Wall gets it, `test/fixtures/wall-large-map.json`; stable under trouble; reach;
  hold zoom; options), a tour test for `zoomFor`; map tests unchanged. Still `$RUN_DIR/shots/r44-still/`,
  filmstrip `r44-radial/`: overview inside the margins, holds as before, 0 console errors; fps 2.3 is
  SwiftShader plus screenshots (filming note). The real `fitScale` reaches the lock and glow in every
  variant, so orbits', islands' and mosaic's locks and lights (which have fits of their own) are now
  sized from their real scale, not the radial guess: not filmed this round.)
- [x] T18 (§5, T10) [variant:radial] (r9-film-ui #5) Wall hides desk chrome: ring legends and lane
  pips off (with `rings: false` from T10, option defaults off); the bearing dial stays — done
  when: a still shows no ring legend or pip, dial still drawn, and `test/map-*.test.mjs` pass unchanged.
  (commit d36ed56; `rings: false` would also take the dial, so two new Map options, both default on:
  `legends: false` (ring legends gone, hairlines and dial kept; `ringGeometry` returns no legend boxes, as on
  a phone) and `lamps: false` (the "pips" are the builder lamp strip under the name: link, approvals,
  stuck). Radial sets both. What the lamps said still shows: a down builder by its mark, a stuck or waiting
  lane by its ▲; the accent approvals lamp has no Wall stand-in (night 2's detail sheet). Tests
  `test/wall-chrome.test.mjs`; map tests unchanged. Still `$RUN_DIR/shots/r48-still/`, filmstrip
  `r48-radial/`: no legend or lamp at the overview or in holds, dial at 000/090/180/270, 0 console errors;
  fps 2 is SwiftShader plus screenshots (filming note).)
- [x] T19 (§5) [variant:radial] (r9-film-ui #6, #8) Less ornament: calm services plain dots with no
  halo, rooms one ring, halo only on the focused node and nodes in trouble; room-to-service
  edges short stubs at the overview, full fan only when the camera is in that site — done when:
  a still shows no halo on calm services and no hairball at `hv1`; option defaults off, map tests unchanged.
  (commit 0a75c9b; the "halo" was the cpu/mem gauge rings on rooms and sites (the review's "services" are
  kind `room`, its "rooms" kind `site`). Two new Map options, both default off: `gauges: 'trouble'` (gauges only
  on a node in trouble, in focus (hover, selection, or the ambient camera's `follow`, new in the scene) or with
  cpu/mem past 0.75, where the arc takes a hue) and `branch(child, parent, {s})` (share of a tree branch drawn
  from the child's end). Radial: stubs keep 25 % below map scale 0.8, then a smoothstep to the whole fan by
  IN_SITE 1.25, so the fan unfolds as the camera flies in; the core's spokes stay whole. Tests
  `test/wall-ornament.test.mjs`; map tests unchanged. Still `$RUN_DIR/shots/r49-still/`, filmstrip
  `r49-radial/`: no ring on calm rooms, no fan at HV1/HV2 at the overview, the crit glow the loudest thing,
  0 console errors; fps 1.8 is SwiftShader plus screenshots (filming note). Seen but not this task: label
  collisions in the builder cluster at 12 o'clock (BUILDER-B/BUILDER-C, DEPS/VM-C), which is T27's territory.)
- [x] T20 (§2 north star 1) [ui] [variant:radial, all] (r14-operator #1) Caption reads at 3 m: on a
  trouble site the trouble word (`STORAGE FULL 97%`, condensed, status colour, ~180 device px cap at
  the tablet's 2x, per Q3) is the biggest text on the plate, the site name under it at the 1.5 m step
  (~95 px); HARDWARE/WHERE/HOLDS drop to a small step below a gap on trouble sites; calm sites keep
  today's order — done when: `test/wall-caption.test.mjs` checks the step sizes (trouble > name) and
  the order for a trouble and a calm site; a filmstrip frame shows the trouble word legible and not cut off.
  (commit 4e32bce; the trouble line is now the plate's hero: `word` = where the trouble is (`■ STORAGE`, the
  troubled node's name; a node in its own trouble leads with its why) at 14vmin (~128 CSS px, a ~180 device px
  cap on the tablet), fitted by `heroSize(word, W, H)` to a trouble plate up to 56vw wide and never under 9vmin
  (a step above the name); its why under it at 4.3vmin in caps, both in the status colour, shown with the plate
  (not staggered, part of T23); the name types under it at 6.9vmin (kept on the caption's scale, ~88 device px
  cap, close to the ~95 asked); status and metrics at the line step; facts and holds at the key step after a
  1.6vmin gap. Lines carry `step` (hero/line/small); `STEPS` in caption.js mirrors wall.css. Calm plates
  unchanged. Tests in `test/wall-caption.test.mjs`. Filmstrip `$RUN_DIR/shots/r52-radial/`: `▲ FEAT-SEARCH`
  over HV1 and `■ STORAGE` over HV2 are the biggest text on screen, not cut off, 0 console errors; fps 2.3 is
  SwiftShader plus screenshots (filming note). Seen, for their tasks: the plate's bottom-right bracket next to
  the lock (T29), a ghost `HV1` map label under the plate (T24), the plate now taller (about half the height
  on a trouble site), so T30's focus offset matters more.)
- [x] T21 (§2, T9) [ui] [variant:all] (r14-operator #2) The fleet line is big: in T9's `worstLine`, while
  anything is crit the bottom-right line is set at the 3 m step (`■ HV2 · STORAGE 97% FULL`) with a
  `+2 more` count under it, always on, also when the camera is not in a trouble site. Build T9 before
  T7/T8 if the loop allows — done when: `test/wall-frame.test.mjs` covers the text, count and
  step for crit, attention-only and calm; a filmstrip frame of an overview and of a calm-site visit shows it.
  (commit 2997990; `worstLine` carries `step` (`far` while the worst is crit or down, `line` for attention/warn,
  `calm`) and `word` (`site · name`). Far: `■ HV2 · STORAGE` at the caption hero's step (14vmin, fitted to 64vw by
  `fleetSize`, never under 9; the demo's word lands ~12vmin on the tablet), one line, cut not wrapped; under it
  the why at the why step (4.3) in crit and `+4 MORE` in the key step on its baseline; the ambient fact gives way
  (one hero in the band). Attention and warn keep T9's line. The far block stands on an opaque `--bg-canvas`
  ground out to the screen's corner: at 92-96 % map labels showed through the word as ghosts. Tests in
  `test/wall-frame.test.mjs` (step, word, count for crit, down, attention-only, calm; the fitted size; the DOM
  rows). Still `$RUN_DIR/shots/r53-still3/`, filmstrip `r53-radial/`: the crit word at the overview and on calm
  visits (HOME, CLOUD), attention back at the line step, 0 console errors; fps 2.4 is SwiftShader plus
  screenshots (filming note). Seen: the word's top reaches ~76 % of the height, over radial's bottom ring, so a
  map label at the ground's top edge is cut (`EDGE-2`, `REMOTE`): T24's hiding of Map labels under a plate
  should take this rectangle too; and on HV2's hold the plate's hero and the fleet word say the same thing
  twice (r41 shared #2, with the owner).)
- [x] T22 (§2) [ui] [variant:all] (r14-operator #5) Caption status is a severity count and names the
  worst three: `1 crit · 5 attention`, then the worst problem, then the next two, one per line at the
  1 m step (today "6 of 41 in trouble" names one) — done when: `captionLines` test covers a site with
  1 crit and several attention nodes (counts and three named lines, worst first).
  (commit 8b47e01; problems below the site are grouped the way `worstLine` groups them (a lane and its
  waiting session are one problem, the worst node in it speaks), sorted worst first, ties in model order. The
  status line is the count (`3 attention · 1 warn`), calm sites keep `ok · all N calm`. The three named are
  the hero (T20's trouble word, the worst) plus up to two `problem` lines right under the count (key `▲
  attention` in the mono key step, value `FIX-LOGIN · asked a question · 6m` at the line step (the 1 m
  step, 2.7vmin), in the status colour), so the worst is not said twice on the plate. `NAMED_PROBLEMS` = 3.
  Facts give way first under MAX_LINES (HV2's plate keeps hardware, drops where). Test in
  `test/wall-caption.test.mjs`. Filmstrip `$RUN_DIR/shots/r54-radial/`, dense unthrottled strip `r54-dense/`
  (frame 18: HV1's plate with the count and two named lanes, keys aligned, nothing cut), 0 console errors;
  fps 2.5 is SwiftShader plus screenshots (filming note).)
- [x] T23 (§2) [ui] [variant:all] (r14-operator #6) No dead plate: on a trouble site the trouble word
  shows at once with the plate (untyped), only the site name types; the plate grows with its lines
  instead of starting at full height; in demo timing the typing starts during the last 0.5 s of the
  flight — done when: a filmstrip frame at the start of a hold shows the trouble word and no empty
  plate; the pure part (plate height from line count) is tested in `test/wall-caption.test.mjs`.
  (commit ec802c5; the word and its why were already in with the plate (T20), only the name types. New:
  `plateHeight(cap, shown, heroVmin)` in caption.js sums the plate's rhythm (`PLATE`: padding, kicker, word at
  0.86 of its size, why, name at 0.92, rows 3.2 / 2.3vmin by step, 0.9 gaps, 1.6 before the small facts) and
  wall.css now sets those heights on every block, so the layout is that sum, not font metrics. A row is
  `hidden` until its beat; then the plate's height eases to the next sum over the line's fade (WAAPI, overflow
  hidden, so the row wipes in as the plate opens). Demo `leadMs` 900 -> 800: the name types from 0.5 s before
  arrival. Probe on the live demo: the settled plate is exactly its content (scrollHeight = clientHeight, the
  bottom pad 24 px = 2.64vmin); it opens at 142 px on a calm site and grows to 284, 315 -> 484 on HV2. Tests in
  `test/wall-caption.test.mjs` (growth row by row, the trouble head, the small gap, wall.css carries the same
  heights, demo typing in the last 0.5 s). Filmstrip `$RUN_DIR/shots/r55-radial/`: frames 29 s, 39 s, 56 s are
  hold starts with `■ STORAGE` / `▲ OFFICE-PRINTER` and the why up, the name typing, no empty rows; 0 console
  errors; fps 2.1 is SwiftShader plus screenshots (filming note). Seen, for T24: a map label (`HOME`) cut by
  the plate's right edge.)
- [ ] T24 (bug) [ui] [variant:all] (r14-operator #7) Map labels cut by the plate's edge and showing
  through it as ghost text: plate at least 95 % opaque, and Map labels whose box falls under the
  plate rectangle are hidden (the Wall has the rectangle and `screenOf`; any Map change is an option
  that defaults off) — done when: a still/filmstrip frame at 1:1 shows no cut or ghost label near the
  plate, and the app's Map tests pass unchanged.
- [ ] T25 (§2 north star 1, T7) [ui] [variant:all] (r14-operator #8) The lock goes on the worst node
  inside the visited site (e.g. `storage` in hv2), not only on the site node, with a thin leader line
  from the caption's trouble line to it — done when: a test (`test/wall-lock.test.mjs`) picks the
  worst descendant by status for a site and falls back to the site when calm; a filmstrip frame shows
  the lock and leader on the trouble node.
- [ ] T26 (§2) [ui] [variant:all] (r14-operator #9) Caption kicker on a trouble site is set in the
  status colour with the shape: `■ CRIT · SITE 01 / 05`; calm sites keep the grey kicker — done when:
  `captionLines` test covers kicker text and status for crit, attention and calm.
- [ ] T27 (bug) [ui] [variant:all] (r20-skeptic #1) Edge labels collide with node labels (`deploys` on a node,
  `clones` on `demo hypervisor`) and cannot be read at 3 m: a Map option `edgeLabels: false` (defaults
  on, so the app is unchanged) and the Wall sets it off — done when: a test shows the option drops link
  labels from the scene and the default keeps them; a still shows no link label; `test/map-*.test.mjs`
  pass unchanged.
- [ ] T28 (§2 north star 2) [ui] [variant:all] (r20-skeptic #3) The ground must not slide under a moving
  camera: the fixed `--tex-dots` on `.wall-stage` stays still during flights and the turn. Drop the dots
  on the Wall (keep `--bg-canvas`; T9's vignette is the quiet ground) — done when: `wall.css` has no
  dot texture on the stage and a film frame mid-flight shows a plain ground.
- [ ] T29 (bug) [ui] [variant:all] (r20-skeptic #4) Two bracket vocabularies: the caption plate's corner
  brackets (red on a crit site) look like a second lock, one sits 300 px from the real one. Remove the
  plate's brackets; brackets mean the lock only — done when: `caption.js`/`wall.css` draw none and a
  frame of HV2 shows one set of brackets.
- [ ] T30 (bug) [ui] [variant:all] (r20-skeptic #8) The plate covers the site it is about (HOME's rooms
  under it, ghost printer text): shift the tour's focus point by the plate's width so the site and its
  subtree land in the free two-thirds, or choose the plate corner from the empty side (needs a focus
  offset in the Wall's driver; any Map change is an option defaulting off) — done when: a pure test
  checks the offset from plate width and screen size, and frames of HOME and REMOTE show the subtree
  clear of the plate.
- [ ] T31 (bug) [ui] [variant:all] (r24-touch #2) A pinch, palm or long press breaks the page: no
  `touch-action` on the stage and no `maximum-scale` in the viewport, so a two-finger brush zooms
  the page and the clock and fleet line slide off-screen. Set `touch-action: none` and
  `user-select: none` on `.wall-stage`, `maximum-scale=1, user-scalable=no` in `wall.html`, and a
  `contextmenu` → `preventDefault` listener in `main.js`; a plain tap still does nothing (the
  explorer is night 2) — done when: `test/wall-*.test.mjs` checks `wall.css` carries the
  `touch-action` rule and `wall.html` the viewport limit, and `npm test` passes.
- [ ] T32 (bug) [ui] [variant:all] (r28-performance radial #1) The glow sprite cache in `glow.js` never
  shrinks (a 256x256 canvas per distinct rgb, a colour-temperature feed leaks ~360 MB a day): quantise
  the key (`v & ~7`) and cap the cache at 32 entries, deleting the oldest on insert — done when:
  `test/wall-glow.test.mjs` feeds 1000 colours and the cache stays at 32 or fewer.
- [ ] T33 (§2 north star 4) [variant:all] (r28-performance radial #3) `measure` in `render.js` keys its
  cache on `ctx.font` read back every call (top JS self-time): keep the font the renderer last set in a
  local and key on it. Output must be identical; if that cannot be shown, put it behind an option that
  defaults off — done when: `test/map-*.test.mjs` pass unchanged and a Wall test or timing shows no
  `ctx.font` getter read in `measure`.
- [ ] T34 (§2 north star 4) [variant:all] (r28-performance radial #4, orbits #3) The Map repaints the full
  canvas 30 times a second all day (`hasLife` is always true in a busy fleet): a Map option
  `ambient.idleFps` (defaults off, Wall sets ~12) used while no flight, comet or lock/caption arrival
  runs and the turn is off or slow; 30 fps otherwise — done when: a test of the pure frame-rate choice
  covers idle, flight and comet, and the map tests pass unchanged.
- [ ] T35 (bug) [ui] [variant:all] (r28-performance radial #5, #6, #10) Forced style recalcs per frame:
  one `ResizeObserver` on the stage in `main.js` caches `{W, H}` and passes it as `size` to `createLock`
  and `createGlow` (no `clientWidth/clientHeight` in `onDraw`); the lock skips its style writes when
  `x0,y0,x1,y1,alpha` are unchanged; `caption.js` fades keep the target opacity in JS instead of
  `getComputedStyle` — done when: a test checks the lock writes nothing on a still frame, and grep finds
  no `clientWidth`/`getComputedStyle` on the draw path.
- [ ] T36 (bug) [variant:orbits] (r28-performance orbits #2) `arrange` in `orbits.js` searches
  (2 phases x 45 stretches x bisection x O(n²) `clear()`) inside a flight frame at every zoom crossing
  and every `/ws` frame: memoise it on `aspect` plus each system's `hx,hy` rounded to 1 unit, and make
  `clear()` allocate nothing per candidate — done when: `test/wall-orbits.test.mjs` shows a second
  call with the same inputs returns the cached layout and results are unchanged.
- [ ] T37 (§2 north star 4) [ui] [variant:all] (r28-performance orbits #4) The glow layer repaints every
  frame for nodes that do not move: skip `paint()` when every mark's `screenOf` and the eased zoom match
  last frame (compare a short string) — done when: a test shows no paint on an unchanged frame and a
  paint when a mark moves.
- [ ] T38 (bug) [ui] [variant:orbits] (r28-performance orbits #6) No resize path: `main.js` reads the
  aspect once, so a kiosk that boots before the display settles or a rotated tablet keeps the wrong
  layout until reload. Rebuild `mapOptionsFor` when the stage aspect changes by more than 5 % (reuse
  T35's observer) — done when: a pure test of the "aspect changed enough" check passes.
- [ ] T39 (bug) [ui] [variant:all] (r28-performance #9) `__wallPerf.worstGapMs` is a lifetime maximum
  and only climbs: add `__wallPerf.reset()` and a rolling `worst10s` in `perf.js` (`film.mjs` is fenced,
  so Wall-side only) — done when: a test shows reset clears and the rolling value forgets a gap older
  than 10 s.
- [ ] T40 (§2 north star 4) [variant:all] (r28-performance radial #8) Per-frame allocation on the ambient
  frame path in the Map (`scene()`, `step`, `stuckBuilders`, the `drawnCount` loop): hoist a frozen empty
  Set, filter pulses in place, skip the `drawnCount` loop when ambient, compute `stuckBuilders` once per
  model; ambient only, low priority — done when: map tests pass unchanged and the ambient frame path
  creates no `new Set`/`new Map` per frame.
- [ ] T41 (bug, docs) [variant:all] (r32-stranger #2, #3, #6, #8) A stranger cannot find or set up the Wall:
  add a Wall row to the README views table and a "Wall" section in `docs/map.md` (URL `/wall.html`, the
  four `?variant=` values, `demo`, what the tour does, where `glow` and `ring` show and the stale
  threshold in seconds from the code); fix the 409 text and the API docs: `POST /api/map/feeds` is
  builder-only (404 on a hub, which takes files in its feeds dir); an unknown `?variant=` shows a one-line
  note on the page, not only `console.warn` — done when: `npm test` passes (docs tests included) and
  the README and `docs/map.md` carry the rows and the section.
- [ ] T42 (bug) [ui] [variant:orbits, islands, mosaic] (r32-stranger orbits #2, islands #2, mosaic #2) A hold
  on a site or node can show no caption, or only a cursor with no name: every leg shows its kicker and
  name at once (the first letter at least), a node leg is captioned by the node — done when:
  `test/wall-caption.test.mjs` shows a caption for every leg kind and a filmstrip has no cursor-only frame.
- [ ] T43 (bug) [variant:islands] (r32-stranger islands #1, #3) A site title overprints its rooms (CLOUD over
  EDGE-1/REGISTRY), room labels sit under the wrong dots, THERMOSTAT runs into the clock: reserve a title
  strip above each lens, place room labels inside their own island, keep the clock box label-free —
  done when: `test/wall-islands.test.mjs` checks the title strip clear of every room label and a 768x900 still shows no overprint.
- [ ] T44 (bug) [variant:mosaic] (r32-stranger mosaic #1, #3) Labels leave their tile (DB, REGISTRY, KITCHEN-LIGHT,
  PRINTER-3D over the clock) and a red tile is clipped at the screen edge during a hold: clip, shrink or
  drop a label that does not fit its tile; frame the visited site with its troubled tiles whole — done
  when: `test/wall-mosaic.test.mjs` checks every label box inside its tile's hex and a 768x900 still agrees.
- [ ] T45 (bug) [variant:orbits] (r32-stranger orbits #3) Label clouds are loose: HV1's labels stand in a
  column off the planet and "ACME-BILLING 1 of 6" overprints nodes; put labels on the orbit's outward
  side at the dot's own radius — done when: `test/wall-orbits.test.mjs` checks each label sits within a
  fixed distance of its dot and a 768x900 still shows no overprint.
- [ ] T46 (§2, D3) [ui] [variant:all] (r32-stranger #7) A job `ring` looks like every node's status arc: draw it
  in its own style in the glow layer (thicker, a tick at the head), percent label while the camera is on
  its site — done when: `test/wall-glow.test.mjs` checks the ring geometry is wider than the node arc
  and a still shows the printer ring distinct.
- [ ] T50 (bug) [ui] [variant:all] (r37-accessibility shared #2) With `prefers-reduced-motion` the camera cuts
  into a site but caption and lock only appear at `arriveMs`, so the site is on screen unexplained for
  about half of each leg: when `still`, show the caption and the lock at once (`arriveMs: 0` for the leg
  in `main.js`) — done when: a test of the leg rewrite shows `arriveMs` 0 in still mode and unchanged
  otherwise, and a reduced-motion still taken mid-leg shows plate and lock.
- [ ] T51 (bug) [ui] [variant:all, radial worst] (r37-accessibility shared #3, radial #1) The fleet line, clock
  and tag are printed over Map labels (red over white label is 2.8:1; `HV2 · STORAGE` over SECRETS): give
  each frame text block a solid backing (95 % `--bg-canvas`, padded 1.2vmin) and hide Map labels whose
  box meets a frame rectangle (the mechanism T24 builds for the plate; any Map change is an option that
  defaults off) — done when: a pure test checks label-vs-rectangle hiding for the frame blocks and a
  zoomed still shows no label under the fleet line, clock or tag.
- [ ] T52 (§2 north star 2) [ui] [variant:all] (r37-accessibility shared #6) The fleet line counts seconds
  (`NO CONTACT FOR 20S`, `25S`…): the loudest text changes every tick with no new meaning. In `worstLine`
  round the age to a stable step (`1 min`, `5 min`) or say `since 02:10` — done when:
  `test/wall-frame.test.mjs` shows the text unchanged across ticks inside one step and changing at its edge.
- [ ] T53 (§2 north star 1) [ui] [variant:all] (r37-accessibility shared #7) The lock carries status by hue
  alone (red, amber, grey brackets differ little in lightness for colour-blind viewers): add the node's
  shape (■ / ▲ / ◆, `SHAPE_CODE`) at the lock's top-left corner in the status colour on trouble — done
  when: `test/wall-lock.test.mjs` checks the shape chosen per status (none on calm) and a frame of HV2
  shows it.
- [ ] T54 (bug) [ui] [variant:all] (r37-accessibility shared #10) Glows sit behind labels (KITCHEN-LIGHT,
  LIVING-LIGHT, DESK-LIGHT on their own glow: text-2 falls to about 2.5:1): the glow layer leaves a
  radius of 1.5 node radii plus the label box clear, or labels of glowing nodes get a 2 px
  `--bg-canvas` halo (an option on the Map, defaults off) — done when: a test shows no glow alpha
  inside the label box and the app's Map tests pass unchanged.
- [ ] T55 (bug) [variant:islands] (r37-accessibility islands #3) Lane ▲ marks pack shoulder to shoulder
  (▲▲▲ around FEAT-SEARCH) and merge into one amber blob at distance, losing the shape cue: keep a
  minimum gap of one mark diameter between trouble marks, or roll them into the builder's mark with a
  count — done when: `test/wall-islands.test.mjs` checks the gap between neighbouring trouble marks.
- [ ] T56 (§2 north star 1) [variant:mosaic] (r37-accessibility mosaic #2) Crit and warn tiles differ by
  hue only at a distance (red and amber fills read as brown and olive for protan/deutan viewers; the mark
  is about 10 px): give the shape a pattern at the tile's own scale (crit: solid inner square; warn:
  dashed or two-of-six-sides edge) — done when: `test/wall-mosaic.test.mjs` checks crit and warn tiles
  differ in shape data, not only tone, and a still shows it.
- [ ] T57 (bug) [ui] [variant:all] (r41-film-ui shared #1) Two clocks in one frame: the caption's trouble
  line freezes its age (`no contact for 25s`) while the map label and the fleet line show 29s. Build the
  age text in one shared formatter used by `captionLines` and `worstLine` (with T52's stable step), so
  the plate and the fleet line never disagree — done when: a test shows `captionLines` and `worstLine`
  give the same age text for the same node and time, and a caption typed in earlier does not keep an older value.
- [ ] T58 (bug) [ui] [variant:all, radial seen] (r41-film-ui shared #6) The caption outlives the shot: the
  plate stands fully typed while the camera is back at the overview, pointing at a subject the frame no
  longer shows. Fade the plate out on the first frame of the flight away, before the zoom changes — done
  when: a test of the caption driver shows the fade-out starts at the leg change (not after it), and a
  filmstrip frame at overview scale has no plate.
- [ ] T59 (§2, spelled out as it zooms in) [variant:orbits] (r41-film-ui orbits #1) The hold is a wide
  shot: the visited planet fills about a quarter of the frame height, moon labels are micro-text. Take
  the per-leg zoom from the planet's own bounds (`bounds` per layout) so the planet and its moons' labels
  fill about 60 % of the frame height, inside the safe area and clear of the plate (with T30) — done when:
  a pure test checks the leg zoom is the fit of the planet's bounds for 3:2 and 16:9, and a hold frame
  shows moon names at the room step or larger.
- [ ] T60 (bug) [variant:islands, mosaic] (r41-film-ui islands #2) The hub (core) stands alone as two
  unlabelled rings (islands, left of REMOTE above the clock; mosaic a lone tile): give it a small titled
  island/tile of its own with the tag's name — done when: the layout test checks the hub has a title
  inside its own coastline/tile and a still shows no unlabelled orphan mark.
- [ ] T61 (§2 north star 1) [variant:mosaic] (r41-film-ui mosaic #1) At the overview amber attention tiles
  outshout the red crit tiles (brighter fill, same area): the eye lands on amber first. Rank fill
  lightness crit > attention > warn, attention and warn keep outline and mark with no fill — done when:
  `test/wall-mosaic.test.mjs` checks the fill alpha ranks crit highest and attention/warn have none,
  and a still of the crit window shows red as the only filled tiles.
- [ ] T62 (bug) [variant:radial, all with halos] (r46-operator radial #2) Crit halos at the frame's rim are
  darkened by the vignette (two halos at the edges in a hold): paint the halos above the vignette or let the
  vignette stop short of glows — done when: a test or a CSS check shows the glow layer is stacked above the
  vignette (or the vignette excludes it), and a still of a hold with a crit near the rim shows the halo undimmed.
- [ ] T63 (bug) [variant:radial] (r46-operator radial #5) The first frame after a load is off-centre: the circle is
  smaller and up-left until the first fit settles, so a glance after a reload sees a lopsided screen: fit before
  the first paint, or keep the stage hidden until the first fit (fade in) — done when: a test of the start-up
  order shows no paint before the first fit, and the first film frame matches the overview's centre.
- [ ] T64 (§2 north star 1) [variant:orbits, islands] (r46-operator orbits #1, islands #1) The crit is the size of
  a calm moon (orbits) or a thin red rim (islands): T16's halo is radial-only. Turn `halos` on for both in
  `variants.js` (T16 said one line) — done when: `test/wall-glow.test.mjs` or `test/wall-variant.test.mjs`
  shows both variants carry the flag, and a still of the crit window on each shows the halo as the first read.
- [ ] T65 (§5) [variant:mosaic] (r46-operator mosaic #2) Mosaic's overview is cropped mid-flight (EDGE-1,
  OBJECT-STORE, ACME cut at the right edge; the fleet line covers HOME's lights): give mosaic T17's safe-area
  fit (`bounds`, bottom band 16 %) — done when: a test like `test/wall-radial-fit.test.mjs` checks every tile
  and name inside the safe area at 3:2 and 16:9, and an overview frame shows the whole fleet.
- [ ] T66 (§5, T18, T19) [variant:orbits, islands, mosaic] (r50-skeptic orbits #2 #3, islands #1, mosaic #3 #4)
  T18/T19's Map options went into radial only; the other three still draw a gauge ring on every calm node,
  builder lamp pips and ring legends: set `gauges: 'trouble'`, `lamps: false` and `legends: false` in each
  variant's `mapOptions` (they already exist and default off; no Map change) — done when:
  `test/wall-chrome.test.mjs` or `test/wall-ornament.test.mjs` shows all four variants carry the three
  options, and a still of each shows no ring on calm nodes and no lamp pip.

## Research questions

- [x] Q1 (→ research/Q1-film-ui-readability.md; designers give no timing numbers, the table there is marked as proposals) How do film and TV interface designers (practitioners' own write-ups and talks: e.g. the
  studios behind well-known screen graphics) keep a "movie UI" readable while it looks dense:
  hierarchy, type choices, motion timing (typing speed, fade lengths, hold times), what they leave
  out? Numbers where they give them. — for T6, T7, T9
- [x] Q2 (→ research/Q2-calm-ambient-displays.md; no sourced motion-budget number, the table there is proposals) Calm technology and ambient displays: what makes an always-on screen glanceable without
  being noticed until something is wrong (peripheral attention, how trouble should escalate, how
  much motion is too much for a screen in a room all day)? — for T5, T9
- [x] Q3 (→ research/Q3-legibility-at-distance.md; arc-minute rule sourced second-hand, the 3 s glance size and the width/tracking advice are proposals) Legibility at distance: minimum cap height or x-height per metre of viewing distance for a
  glance (3 s) at 1-3 m, contrast ratios needed on a dark ground, condensed vs normal widths,
  tracking for caps; in px for a 2736x1824 12.3" tablet and a 1920x1080 24" screen. — for T6, T9, T11
- [x] Q4 (→ research/Q4-wide-screen-graph-layouts.md; beta values second-hand, site-slot clamp is a proposal) Graph layouts that use a wide screen for 100-150 nodes over 4-6 sites: elliptical/orbital,
  cluster (grouped force, treemap-of-clusters), hierarchical edge bundling for the long links;
  their parameters, and how ops tools draw infrastructure (open-source network/topology maps,
  service maps) — what holds up and what turns to hairballs. — for T11, T12, T13
- [x] Q5 (→ research/Q5-hex-mosaic-wild-card.md; recommends a hex mosaic, one tile per node; region-growth algorithm is a proposal, sizes are arithmetic) The wild card: the most promising way to lay out 100-150 nodes over 4-6 sites on a wide
  (3:2 or 16:9) screen that is neither radial, nor orbits, nor islands; one recommendation with
  why it suits a camera tour, trouble first and labels at 3 m, and its layout algorithm in enough
  detail to build in a day. — for T14
- [x] Q6 (→ research/Q6-touch-on-wall-and-kiosk.md; mm-based sizes are arithmetic, idle 45 s is a proposal, no timeout research exists) Touch on wall and kiosk screens: target sizes (mm and px at the tablet's density), gestures
  that work for people who did not set the screen up (tap, back, pinch), idle timeouts and how a
  kiosk shows "touch to explore" without clutter. — for night 2 (touch explorer)

## Later

- §7.1 `?demo-map=<file>`: a static fixture the Wall loads when no hub runs (not needed while
  `demo-fleet.mjs --size large` covers the night; useful for filming without a hub).
- §7.2 Reduced motion (D5) on the Wall page: night 2 (README §7 Night 2).
- §7.5 The persona panel over every filmstrip: done by the review rounds, not builder tasks.
- §7.6 The morning report comparing the directions with their scores and filmstrips: the last round.
- Night 2 touch explorer (tap, fly, detail sheet, back, resume after a minute): written after the
  owner's pick; Q6 prepares it.

## For the owner

- Filming under the CPU throttle (round 7): `loop/film.mjs` hangs on every animated canvas page here
  (headless Chromium + `Emulation.setCPUThrottlingRate`, default GL; `--disable-gpu`, headless_shell
  and `--disable-accelerated-2d-canvas` all hang too; only SwiftShader GL works). With SwiftShader the
  fps number is the VM's software raster (~17-21 fps), so the "fps >= 27 under the throttle" gate cannot
  pass on this VM for any variant. Options: let `film.mjs` (fenced) launch with SwiftShader and report
  script ms/frame next to fps, or judge fps on the real tablet. Rounds use the wrapper meanwhile.
- (r9-film-ui) Camera phrasing for T5, as a taste proposal: ~0.6 s anticipation (turn eases out, target
  brightens), flight on one ease-in-out, ~0.4 s stillness before the lock closes and the name types,
  caption fades before the camera leaves. Adopt into T5?
- (r9-film-ui) Hide the outermost rings (lanes, runs) at the overview, rolling their trouble up into
  the builder? Changes what the radial shows; owner's call.
- (r9-film-ui) Redesign the bearing dial as a thin tick ring with four numerals in the mono step: taste.
- (r14-operator #3) Tour dwell: while anything is warn or worse, hold calm sites short (~8 s) and
  trouble sites long (~25 s), or alternate worst site and calm ones. Changes T5's timing: owner's call.
- (r14-operator #4) At the overview, label only nodes at warn or worse, in status colour, so the only
  words are the problems (the halo part is T16). Changes what the overview shows: owner's call.
- (r20-skeptic, all taste or plan changes) Wall mode = Map annotations off by default, each back only
  where it says something. Specifically: #2 sublabels only when they hold a number (overview: only
  warn+); #5 no lock on calm sites, lock only on trouble (T25 covers the node, not this); #6 calm
  caption = name + `ok · all 12 calm`, CPU/MEM only at warn+, HARDWARE/WHERE to night 2's sheet; #10
  `cursorMs: 0` (the cursor stops blinking once the name is typed; typing is your favourite moment);
  #11 remove the bearing dial and ring legends rather than redesign (conflicts with T18 "dial stays");
  #12 remove monograms and pips, `+2` only if it counts trouble; #13 hide the work ribbons on the
  Wall; #15 drop `printing · 28%` text at the overview, keep the ring.

- (round 22, T9) The vignette is a soft gradient. The design guardrail allows gradients only in
  `--tex-*` tokens in tokens.css (the app's textures are hard-stop), so it is `--tex-vignette` there,
  used by wall.css only. If soft gradients should stay out of tokens.css, the alternative is a guardrail
  exception for wall.css (test/helpers/css-guardrails.mjs): your call.

- (r24-touch, night 2 inputs for the explorer, not tasks) #1 a tap gives no feedback: decide between a
  lock-bracket answer within 100 ms, a "touch explorer: night 2" toast, or nothing on purpose; #3 the
  fleet line as first tap target (hit box 79 px high, `+N more` list); #4 at the overview a tap
  resolves to the site (53 px circles; REPOS sits 55 px from HOME, move it or give it no target);
  #5 home lights are 36 px apart zoomed, so zoom further or show a two-row chooser; #6 the plate
  becomes the detail sheet (T30/T24 cover the overlap now); #7 history entry plus `popstate` as back,
  and a 79 px Back control top left; #8 freeze drift and tour at `pointerdown`; #9 idle timer 45-60 s
  with a shrinking line in the last 5 s, trouble must not move the camera while exploring; #10
  `touch to explore` hint in the tag line, once per idle cycle. Across variants: islands keep gaps of
  53 px or more, orbits no planets closer than that, hex tiles need the site fallback.

- (r28-performance #2, radial) The turn forces a full label re-plan every frame (radial's script time is
  1.5-2x orbits'). Giving radial `ambient: {drift: 0}` removes the turn, which changes what radial looks
  like: your call (T34's idle rate only helps while the turn is slow or off).
- (r28-performance #7) A Map option `maxDpr` set to 1.5 by the Wall would cut canvas pixels by 44 % on the
  2736x1824 tablet; type from 3 m may not need 2x. A legibility trade, so film 1:1 crops at 1.5 and 2
  before deciding: your call.

- (r32-stranger, ideas and plan changes) #1 tap to pause the tour, a "paused, resumes in 60 s" chip and
  `?tour=off` (night 2 explorer; same ground as r24-touch #8/#9). #4 kiosk: `wall.webmanifest` with
  `start_url: "/wall.html"` and `display: fullscreen`, Wake Lock, fullscreen on first tap, a kiosk
  paragraph. #5 a Wall-only read-only listener or proxy recipe so a hallway tablet need not see the
  Board (a security and config decision). Orbits #1/#4: cut or zoom out on long flights, fill the
  short side (direction). Radial #3 / islands #4 / mosaic #4: overview labels only for troubled nodes
  (same as r14-operator #4). Radial #4: fade the name in rather than typing (conflicts with the typing
  you like; r20 #10). Radial #5: dim the fleet line on calm sites. Across: fill the troubled node's area
  in every variant (mosaic's idea); the stranger would pick mosaic, islands second.

- (r37-accessibility, plan changes or taste) #1 reduced motion should do D5 (no `map.focus` cuts: stay on
  `map.fit()`, rotate the caption over the overview with a static lock, 10 s minimum dwell even in demo);
  it is night 2 work in "Later", say if it should come earlier. #5 the clock drops to 4.3vmin and the
  fleet line's trouble word goes to 11vmin or more while anything is crit (T21 sets the fleet line; the
  clock size is taste). #8 put the status word (`attention` / `warn`) in the fleet line as the caption does.
  Orbits #2 / islands #1: at the overview name only the planet or island title and nodes in trouble (same
  ground as r14-operator #4); orbits #3: roll repeated lane trouble into one `3 waiting` label. Across:
  paint the troubled node's area in every variant, and give radial and orbits the reserved bottom band
  (T17) instead of relying on the vignette. Plate at 100 % opaque rather than 95 % (T24 says 95).

- (r41-film-ui, ideas, taste or plan changes) Shared #2: when the visited site holds the worst problem,
  the fleet line steps down to the calm size and shows the next problem or `+N more` (one hero per shot;
  conflicts with T21's always-big line). #4 extra: the plate's brackets stay neutral and hug the text, or
  go (T29 removes them). #5 one case rule: names and site/node words in caps, prose and values sentence
  case on plate and fleet line, units lowercase with a thin space. #3 extra: plate opens on the lock's
  close (flight, beat, lock, plate), giving up the demo's `leadMs: 900` (T42/T23 cover the empty plate).
  Radial #1: site names tangent on the outside of the site ring at the bearing of their subtree (reverses
  T11's inward names). Radial #3: stubs at the overview and the fan drawn on after the lock shuts.
  Orbits #3: the sun carries the fleet's identity (tag title in small mono caps) and a ring in the worst
  status colour. Islands #1 / across: tone the troubled island's coastline (status colour at 0.48 and a
  faint fill), visited coastline to line-strong; same for orbits' ring and radial's sector (same ground as
  the earlier "paint the troubled area" notes). Mosaic #4: a tile holds one name and one detail line at
  zoom, lanes and runs a count chip (`3 lanes ▲2`) until night 2. Across: the title plate `◉ HV1` (mark,
  gap, name) in islands and radial; the islands label grid (name centred under its dot) as the rule for
  mosaic and orbits; a very slow drift or glow parallax to give the no-turn layouts a breath at the
  overview (T28: the ground must not slide under a moving camera). Mosaic's scores favour it; the
  reviewer notes the overview is spent 15 % on the whole fleet in demo timing (radial #4, no change).

- (round 53, T21) The crit fleet word at the 3 m step stands on an opaque ground that covers the bottom-right
  of radial's lowest ring (overview and holds) while anything is crit. The alternative is a larger bottom safe
  area for every variant (a smaller overview, all day, for a band used only while crit) or the word at 9vmin
  (the 2 m step, fits the band). Kept readable trouble over the ring: your call.

- (r50-skeptic, taste or plan changes; items already listed above are not repeated) Shared #4: drop the
  ambient line (`5 sites · 115 nodes · N working`) while anything is warn or worse, `all calm · 115 nodes`
  when calm, no `working` count (it ticks 6, 7, 8 for no reason). #5: drop `· SITE` from the kicker. #2
  (same ground as r41 shared #2): the plate drops its trouble line and status row when the fleet line
  already shows the same problem, keeping `+5 more here`. #6: clock at the fleet line's facts size.
  Radial #3: one `BUILDERS` node with a ▲ count at the overview, lanes unfold only in a hold. Orbits #1:
  hide the core or draw it as a 4 px dot. Orbits #4 / mosaic #2: a site node shows trouble as a thin ring,
  not the shape. Islands #3: no site node at the overview, the ellipse and big name are the site. Mosaic
  #1: only each site's outline plus filled trouble tiles, no per-tile outline on calm tiles. Mosaic #3: link
  labels and sublabels without a digit dropped in all variants (r20 #2). Across: the Wall options of T18/T19
  to all four is T66; islands' plate timing (no dead plate) as the model for T23.

## Reviews

- r9-film-ui.md: 9 findings, 5 became tasks (T15-T19: #2+#7, #3, #4, #5, #6+#8); #1 covered by T5 (phrasing
  to owner), #9 covered by T9; hiding lanes and dial redesign went to the owner.
- r14-operator.md: 9 findings, 7 became tasks (T20-T26: #1, #2, #5, #6, #7, #8, #9); #4 halo part covered
  by T16; #3 and the overview-labels part of #4 went to the owner.
- r20-skeptic.md: 17 findings, 4 became tasks (T27-T30: #1, #3, #4, #8); covered: #7 (T20/T22), #9 (T23),
  #14 (T16), #16 (T15), #17 (T16); #2, #5, #6, #10, #11, #12, #13, #15 went to the owner (taste or plan change).
- r24-touch.md: 10 findings, 1 became a task (T31: #2); #6 covered (T30, T24); #1, #3, #4, #5, #7, #8, #9, #10
  are night 2 explorer design and went to the owner as inputs; #1 includes a taste choice.
- r28-performance.md: 16 findings (10 radial, 6 orbits), 9 became tasks (T32-T40: radial #1, #3, #4, #5+#6+#10, #8, #9;
  orbits #2, #4, #6); orbits #1 and #5 covered by the radial ones (shared code), orbits #3 covered by T34;
  radial #2 and #7 went to the owner (they change the look or legibility).
- r32-stranger.md: 29 findings (8 shared, 5 radial, 4 orbits, 4 islands, 4 mosaic, 4 across), 6 became tasks
  (T41-T46: shared #2+#3+#6+#8, #7; orbits #2 and #3, islands #1+#3, mosaic #1+#3; captions blank on three
  variants merged as T42); covered: radial #1 (T17), radial #2 (T15), mosaic #3 partly T44; dropped: islands #4
  and across "keep" notes (praise); the rest (#1, #4, #5, radial #3-#5, orbits #1/#4, mosaic #4, across)
  went to the owner. The numbers were taken at load 31 and are noise.
- r37-accessibility.md: 36 findings (10 shared, 4 radial, 4 orbits, 4 islands, 5 mosaic, 4 across notes + contrast
  notes), 7 became tasks (T50-T56: shared #2, #3 (+radial #1), #6, #7, #10; islands #3; mosaic #2); covered:
  shared #4 (T24), #5 (T20/T21), #9 (T42), radial #3 (T17), radial #4 (T27), orbits #1 (T42), orbits #3 (T45),
  islands #1 (T48), islands #2 (T42), mosaic #1 (T44), #3 (T42), #4 (T44), orbits #4 (task T51); dropped: islands #4,
  mosaic #5 and across "keep" notes (praise); shared #1, #8 and the overview-naming findings went to the owner.
- r41-film-ui.md: 29 findings (7 shared, 4 radial, 3 orbits, 4 islands, 4 mosaic, 5 across "steal" notes + 1
  console note), 5 became tasks (T57-T61: shared #1, #6; orbits #1; islands #2; mosaic #1); covered: shared #3
  (T42, T23), #4 (T29), #7 (T51), radial #2 (T17, T18), orbits #2 (T45), islands #3 (T25), islands #4 (T43, T55),
  mosaic #2, #3 (T44); dropped: radial #4 (no change needed, said so), console note (empty); shared #2, #5,
  radial #1, #3, orbits #3, islands #1, mosaic #4 and the across ideas went to the owner (taste or plan change).
- r46-operator.md: 33 findings (6 shared, 5 radial, 4 orbits, 4 islands, 4 mosaic, across notes), 4 became tasks
  (T62-T65: radial #2, radial #5, orbits #1 + islands #1 halo, mosaic #2); covered: shared #1 (T21), #3 (T23, T42),
  #4 (T52, T57), #5 (T51), #6 (T25), radial #3 (T19), radial #4 (T18), orbits #2 (T51, T24), #3 (T45), #4 (T59),
  islands #3 (T60), #4 (T55), mosaic #1 (T56, T61), #3 (T44); already with the owner: shared #2 (tour dwell,
  r14 #3), radial #1, islands #1 coastline tint, mosaic #4, the across "steal" ideas; dropped: islands #2 (praise),
  console note (empty).
- r50-skeptic.md: 31 findings (8 shared, 5 radial, 5 orbits, 4 islands, 5 mosaic, across notes), 1 became a task
  (T66: orbits #2 #3, islands #1, mosaic #3 #4 — T18/T19 options for the other three); covered: shared #1 (T23,
  T42), #7 (T51), #8 (T28), radial #1 edge labels (T27), radial #4 (T46), orbits #5 (T45), islands #2 and mosaic #5
  (T60), islands #4 (T30); dropped: radial #5 (the reviewer keeps the echo), orbits #1 core (r41 owner line on the
  sun), the across "steal" notes (restate T66, T23); shared #2-#6, radial #2 #3, orbits #3 #4, islands #1 tails #3,
  mosaic #1 #2 and sublabels went to the owner (taste or plan change). Load 35-37: its fps are noise.

## Scores

| round | persona | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|
| 9 (radial) | film-ui | 3 | 2 | 4 | 1 | 4 | 6 | 6 |
| 14 (radial) | operator | 3 | 3 | 5 | 2 | 5 | 5 | 6 |
| 20 (radial) | skeptic | 3 | 3 | 4 | 1 | 5 | 3 | 6 |
| 24 (radial) | touch | 4 | 3 | 5 | 1 | 5 | 4 | 6 |
| 28 (radial) | performance | 4 | 3 | 5 | 2 | 5 | 4 | 5 |
| 28 (orbits) | performance | 6 | 4 | 5 | 3 | 6 | 6 | 6 |
| 32 (radial) | stranger | 4 | 3 | 6 | 1 | 6 | 4 | 4 |
| 32 (orbits) | stranger | 4 | 4 | 5 | 1 | 5 | 6 | 3 |
| 32 (islands) | stranger | 7 | 5 | 6 | 1 | 5 | 6 | 4 |
| 32 (mosaic) | stranger | 6 | 4 | 8 | 1 | 7 | 5 | 4 |
| 37 (radial) | accessibility | 3 | 3 | 5 | 2 | 5 | 3 | 4 |
| 37 (orbits) | accessibility | 4 | 4 | 5 | 2 | 5 | 6 | 4 |
| 37 (islands) | accessibility | 5 | 4 | 5 | 2 | 5 | 6 | 4 |
| 37 (mosaic) | accessibility | 6 | 4 | 7 | 2 | 6 | 5 | 4 |
| 41 (radial) | film-ui | 4 | 4 | 6 | 2 | 6 | 4 | 4 |
| 41 (orbits) | film-ui | 6 | 4 | 5 | 2 | 6 | 7 | 5 |
| 41 (islands) | film-ui | 7 | 6 | 5 | 2 | 5 | 6 | 5 |
| 41 (mosaic) | film-ui | 7 | 5 | 7 | 3 | 7 | 5 | 4 |
| 46 (radial) | operator | 5 | 3 | 6 | 2 | 6 | 4 | 4 |
| 46 (orbits) | operator | 6 | 4 | 4 | 2 | 5 | 6 | 5 |
| 46 (islands) | operator | 7 | 5 | 5 | 2 | 5 | 6 | 5 |
| 46 (mosaic) | operator | 7 | 4 | 7 | 3 | 6 | 5 | 4 |
| 50 (radial) | skeptic | 5 | 4 | 6 | 2 | 6 | 5 | 4 |
| 50 (orbits) | skeptic | 6 | 4 | 5 | 2 | 5 | 5 | 5 |
| 50 (islands) | skeptic | 7 | 5 | 5 | 2 | 5 | 6 | 5 |
| 50 (mosaic) | skeptic | 6 | 4 | 7 | 3 | 6 | 4 | 4 |

## Morning
