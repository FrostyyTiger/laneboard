# Wall: progress

Night 5 (README §7 Night 5): make the galaxy feel right in the hand. The owner's picks from the live sketch become the
defaults (A), systems get roomier and carry nested moons (B), touch and mouse let him turn an open system in 3D (C), a
node card replaces the old sheet (D), docs and the cockpit handover come last (E). Night 4 is in `nights/night-4/` (its
morning report says what stands), nights 1-3 in `nights/night-1/` to `nights/night-3/`.

Notes for every builder round (planner, round 7):
- **Order** (README §7 Night 5 `Order:`): A (T1-T5, A1 and A2 together in T1), then B1 (T6), B2-B3 (T7-T10), then C
  with C1-C3 and C5 before C4 (T11-T16), then D (T17-T20), interleaved with triage's panel fixes; E last (T21-T22).
  Every part of A-E is a task here; nothing of tonight's list waits in `## Later`.
- **The sketch is a reference, not code to paste**: `docs/plans/wall/sketch/night5/sketch5.diff` (against `main`
  0c6b951). The owner's picks are its `sk_tight=2 sk_size=1 sk_tint=2 sk_sun=1 sk_soft=1 sk_haze=1 sk_arr=2 sk_sys=1
  sk_moons=1 sk_pal=1 sk_card=1`; they land as **defaults with no switch**. Nothing reads `SK`, `?sk_*` or the DOM at
  load time; `sketch.js`, `sketch-panel.js`, `sketch5.css` and the presets do not land. The diff broke 11 guardrail tests:
  no new sheet in `public/css/` (card and tappable rules go in `wall.css`, added, existing rules unchanged), no
  `innerHTML`, no wholesale `style`, no person's name in a label, tap wiring tested by behaviour, not by source.
- **Fenced tonight** (`loop/fenced.txt`; the cockpit's night C1b works on them at the same time): `galaxy/tour.js`,
  `galaxy/show.js`, `galaxy/transport.js`, `public/galaxy.html`, `test/wall-galaxy-handle.test.mjs`, the Map tests,
  `server/*`, `e2e/*`, `test/cockpit*`, `package.json`. A change a task needs there is written as a patch under
  `docs/plans/wall/patches/` (create it) with one paragraph of why, and the task does what it can without it.
  The card needs no new element in `galaxy.html`: `main.js` creates it under the stage as `fan.js` does today.
- **Shared, not fenced**: this night owns `galaxy/touch.js`, the zoom/flight timings and hand-over eases in
  `galaxy/director.js`, the selection levels (site → planet → moon) and the card. In `galaxy/main.js` change only
  selection, card and look parts; the tour hold and the pane hooks stay; C1b changes the stale/board-down caption and tag
  parts (do not build stale looks). `window.__cockpitView` and `data-wall-state` keep every name and value (additive only).
- **Keep B237 and B239** (cockpit C1a): the idle minute counts from the tap; the hand-back to the tour starts with the
  overview. `test/wall-galaxy-resume.test.mjs` and `test/wall-galaxy-show.test.mjs` pin them and stay green unchanged in
  those assertions. Playwright is not installed on this VM, so `e2e/cockpit` (S-C1-01, S-SCR-0x) runs on `ci` only:
  before changing a selector, state or event in `main.js`/`touch.js`, grep `e2e/cockpit/*.mjs` and `test/cockpit*` for it.
- **Every tappable added or resized**: ≥ 48 px, a visible pressed state, `touch-action: manipulation` (cockpit D224).
- **Colours**: `tokens.css` may hold only the accent and status hues as chromatic values (`test/design-guardrails.test.mjs`,
  chroma > 0.02), and other sheets hold no colour literals. So the site tints (chroma 0.04-0.05) and the lifted ground live
  as one frozen, documented table in `galaxy/palette.js` (WebGL numbers), reaching CSS (the card's 2 px edge) through
  `el.style.setProperty('--…')` from that table; never a literal in `wall.css`. See `## For the owner`.
- **Speed on the Surface** (owner, night 3): nothing may make `galaxy.html?demo=1&fx=beacon&perf=1` slower; judge by script
  ms per frame and draw calls/triangles (`?perf=1`, `budget.js`), before/after in the task's notes, not by fps on this VM.
- **Filming**: `film.mjs` needs the SwiftShader wrapper (`nights/night-1/PROGRESS.md` lines 19-22) and the large demo
  (`demo-fleet.mjs --size large`); if `--cpu 4` stalls (night 4 r21), film at `--cpu 1` and say so. Touch films: a CDP
  script with `Input.dispatchTouchEvent` (night 3 T14's note); every film script closes Chrome in a `finally` and writes
  its pid to `$RUN_DIR`.
- **Tests**: DOM tests on `test/helpers/fakedom.mjs`; page tests drive pointer events on a fake clock as
  `test/wall-galaxy-touch.test.mjs` and `test/wall-galaxy-resume.test.mjs` do. `wall.html` keeps working.

## Tasks

- [x] T1 (§7 Night 5 A1+A2) [ui] [variant:galaxy] Spacing half and the rosette, as defaults: in `galaxy/layout.js` arms,
  gaps, `SITE_LIFT`, `MIN_SITE_GAP`, dust and `ARM_RIBBON`/`ARM_BAND` at 0.5x, a system's spread 0.75x; in `scene.js`
  nebulae and the sun halo at 0.64x; a wider-wound two-arm spiral with a site every 72°, all sites level, only shown sites
  taking slots (`galaxyLayout(nodes, aspect, shown)`, the sketch's `siteSpot`), the first site far enough out that an open
  system never reaches the sun's halo; `camera.js overviewShot` frames the whole galaxy snugly — done when: layout tests pin
  the 72° step, equal site heights, slots for shown sites only, and the nearest site's star farther from the sun than its
  open reach plus the halo radius; an overview still of the large demo (`?at=overview`) fills the frame with all five sites
  and no site name off screen. (commit 6d278d7)
  Notes (builder, round 9): `layout.js TIGHT` {arm 0.5, neb 0.64, spread 0.75}; rosette `ARM` r0 625, turn 72°, `siteSpot`
  (arm 1 half a step out). Deviations, on purpose: `ARM.step` 180, not the sketch's 165, because past five sites the rosette
  laps and the sixth stands 2.5 steps behind the first on one ray (165 gave 412 < the gap); `MIN_SITE_GAP` follows the
  nebulae (700 x 0.64 = 448), not the arms (0.5x = 350 would no longer keep crit nebulae, 435 across, apart). Dust kept as the
  sketch's formula (a tighter inner spiral, out to about 940). `overview.js OVERVIEW_FIT.shift` 0.4 → 0.6: an even rosette in
  a snug frame always has two sites under the widest plate, and the reduced-motion test needs the fit to slide past it.
  The sketch's `ROOM` (arms pushed out 1.24x by `sk_sys=1`) is not in T1: T6 decides it with the 1.4x spread (the nearest
  open system clears the halo with margin: star 733 out, reach 297 + halo 205; at 1.4x spread still 621).
  `scene.js SIZE.sunHalo` and `OVERVIEW_MARGIN` are literals (no imported binding at evaluation time, `frontend.test.mjs`),
  pinned to `TIGHT` by the layout test. Perf: no mesh or vertex count changes (same geometry, smaller numbers), so draw
  calls/triangles stand as night 4's. Looked at (`$RUN_DIR/shots/r9-t1-*`, `r9-galaxy`): overview shows all five sites named,
  none off screen, HV2's red the loudest; `?demo=1` film 34.5 fps at cpu 4x, 0 console errors. Found: T1b below.
- [x] T1b [ui] [variant:galaxy] The sun is out of a held system's frame again: with the tighter galaxy HV1's star is only
  733 from the sun, so the inward look (`scene.js siteShot`, `framing.js FRAMING.inward`/`inwardRise`) puts the sun's disc in
  the top right of the frame, on the tag (`?at=lab&open=1`, film frames 9.3 s and 32.5 s of r9; labels keep the sun's name off
  the tag, the bright disc is not). `inwardRise` 1.0-2.2 does not clear it (tried, round 9). Keep the sun out of the frame
  or out of `hud.covers()` for every site of the large demo at its hold — done when: a test projects the sun for each held
  site's `siteShot` with the tablet view and finds it off the frame or clear of the tag box; a still of `?at=lab&open=1`. (commit deecadd)
  Notes (builder, round 12): no rise and no small turn of the look-in shot clears it: the camera stands 1000-1600 back
  from a star 733 from the sun, so its frustum takes the sun in from most bearings (probed every 10° on four frames,
  with and without a plate). The near-hub system is now shot **from the side**: `FRAMING.aside` -65° from the sunward
  bearing, the sun off the frame's right edge past the free box, no per-site jitter (it alone brought the sun back);
  the sway stays. `inwardRise` is gone (unused). It holds for any caption plate over about 500 px wide; with no plate at
  all (before the first one, when `kept` is empty) the sun can show in the frame, but `kept` remembers the widest plate,
  so the steady hold is clear. Tests (`wall-galaxy-framing`): the sun's disc and halo middle off the tablet frame for
  `lab` over 6 min of sway at zoom 2.3 and 3.5 with the trouble plate and a calm one, every other site clear of the
  words; the side bearing pinned. Both fail on the old shot. Looked at (`$RUN_DIR/shots/r12-t1b-hv1`, `r12-t1b-overview`,
  `r12-galaxy`): `?at=lab&open=1` has no sun and the tag is clear; overview unchanged; `?demo=1` film 38.1 fps at cpu 4x,
  0 console errors, HV1's holds (9.3 s, 15.1 s) without the sun. No geometry change, so perf is as before.
- [x] T2 (§7 Night 5 A3) [ui] [variant:galaxy] Size is what it carries: a planet's radius factor 0.8 + 0.35·log2(1+n) of
  what is below it, a star's 0.8 + 0.2·log2(1+planets), clamped 0.8x-2.2x, never by status (a pure `carryScale` in
  `layout.js` or `scene.js`); a big sphere takes more segments so it never looks faceted, within the triangle budget — done
  when: tests pin the formula, both clamps and that a status change leaves the size alone; `?perf=1` triangles at the
  overview before/after in the notes (no rise past night 4's numbers); a still of `?at=hv1&open=1` shows smooth large bodies. (commit ac22fb0)
  Notes (builder, round 13): `layout.js CARRY`/`carryScale` and a `carry` on every layout member (planets: every member
  below, any depth; the rest 1) and site (its planets); `scene.js bodyRadius` multiplies the planet size by it (sphere,
  halo, mark, labels via `m.radius`), the star's scale, halo, `starRadius` (labels.js stands the name beside it; without
  it `HV1` sat on the bigger star) and `camera.js screenOf` follow `s.carry`; a relayout eases the star to its new carry.
  The tone still picks planet size or dot (a dot in trouble grows to `SIZE.planet`, uncarried, r8-film-ui 3): only that
  test's planet reference moved (`wall-galaxy-trouble`, the builder is now 1.5x). Segments: stars are flat-shaded, so only
  the edge can look faceted; above `BIG_STAR` 1.2x a star takes `bigStar` 26x18 (as round an edge up to 1.65x as a 1x star
  at 20x14, pinned in `wall-galaxy-carry`); planets keep 32x22 (rounder at 2.2x than a 1x star). Triangles (`renderer.info`,
  large demo, pinned levels, `$RUN_DIR/r13-tri-*.txt`): overview L0 83.9k → 85.7k (night 4's 84-86k), L2 20.6k → 21.2k,
  `lab` open L0 30.7k → 32.3k; draw calls unchanged (203); no per-frame work added. Looked at
  (`$RUN_DIR/shots/r13-t2-hv1b`, `r13-t2-overview`, `r13-t2-hv2`, `r13-galaxy`): HV1's star 1.6x and round, builders and
  rooms by load, names clear; `?demo=1` film 30.2 fps at cpu 4x, 0 console errors.
- [x] T3 (§7 Night 5 A4) [ui] [variant:galaxy] Colour: each site a quiet warm-set tint (teal, indigo, plum, sage; the
  sketch's `TINT_SETS.warm`) in its calm nebula and dust; "lift": calm bodies and names a step lighter (stone) on a deep
  blue-black ground; a warmer, softer sun. One frozen table in `galaxy/palette.js` (see the colour note above); status hues
  stay the loudest thing on screen, no neon — done when: palette tests find every tint's chroma below every status hue's and
  the lifted calm text still under `--text-1`, a scene test finds calm nebulae tinted and trouble nebulae in the status hue,
  `test/design-guardrails.test.mjs` green; a still of the overview with HV1 in crit shows the red cluster as the loudest thing. (commit 117cfbd)
  Notes (builder, round 14): `palette.js LOOK` (frozen, OKLCH) holds the tints, the lift and the sun; `applyLift(page)` in
  `main.js boot` sets `--text-3`/`--text-2`/`--bg-canvas` one property at a time before the palette is read (the guardrail
  scans CSS, the values stay out of the sheets); `lifted(readVar)` gives tests the same view. `scene.js`: a site keeps the
  tint of the place it came in for life (`s.tint`, a later site never repaints it); a calm nebula takes it, a trouble
  nebula its status hue and eases back to the tint on clear; the dust is tinted per nearest site (`tintGrain`, brightness
  kept) once per site change and after a star's glide, no per-frame work. Changes against the sketch: dust chroma 2.6x
  instead of 3.2x (indigo dust reached 0.116, past `--p3`'s 0.11; now ≤ 0.095); the sun halo keeps `SIZE.sunHalo` with the
  softer falloff instead of growing 1.15x (it would pass the crit nebula's size, the r8 guard). `wall-galaxy-sun`'s core
  test now reads the warm core under the lifted text-2. Tests: `test/wall-galaxy-tint.test.mjs` (7). Looked at
  (`$RUN_DIR/shots/r14-t3-overview`, `r14-t3-hv1`, `r14-t3-hv2`, `r14-galaxy`): blue-black ground, warm sun, HOME's teal
  haze faint, stone labels readable, red and yellow the loudest; `?demo=1` film 30.1 fps at cpu 4x, 0 console errors (frame 1:
  HV1 crit, its red cluster the loudest thing).
- [x] T4 (§7 Night 5 A5) [ui] [variant:galaxy] Depth haze: distance fog from 0.6x to 2.6x of the look-at distance on calm
  materials only; status-hued materials and trouble nebulae never fogged (`scene.js`) — done when: a scene test finds `fog`
  off on every status-hued material and trouble nebula and on for calm bodies and dust, the fog range following the look-at
  distance; a still of `?at=hv2&open=1` shows the far side fade and the crit member at full strength. (commit 6255bf1)
  Notes (builder, round 17): `scene.js HAZE` {near 0.6, far 2.6, min 200}, `hazed(tone)` (calm only) and a pure
  `hazeRange(pos, dir)`: the look-at distance is where the sight line meets the galaxy's plane (all sites level: the held
  star or the overview's middle), else the distance to the sun; the old `FogExp2(bg, 0.00008)` is now a linear `Fog` in the
  same (lifted) ground colour, its near/far set each frame before the render (one direction read, no new draw). Never fogged:
  warn/crit/low bodies, halos and stars (shared materials by tone), the marks, a trouble nebula's lobes and its lane (flipped
  in `paintSite` only when the nebula's tone changes, one program rebuild), the beacon and afterglow fx, and the sun core and
  halo (its look is the freshness signal, night 3 T6; deviation from the sketch, which fogged it). Fogged: calm bodies, calm
  nebulae and lanes, orbit lines, arm ribbon/band, dust; far stars stay `fog: false`. What the camera looks at takes 20 %
  haze (the sketch's numbers). Test: `test/wall-galaxy-haze.test.mjs` (5); the getter is `galaxy.haze` (a `fog()` getter
  trips `frontend.test.mjs`'s call check). Perf: no geometry or draw-call change, the fog shader chunk swaps exp2 for linear.
  Looked at (`$RUN_DIR/shots/r17-t4-hv2_open_1`, `r17-t4-overview`, `r17-t4-lab_open_1`, `r17-galaxy`): the crit `storage`
  at full strength in front of a slightly dimmed calm system, HV2's red at the back of the overview as loud as before;
  `?demo=1` film 32.6 fps at cpu 4x, 0 console errors. A large demo started 21:56 by an earlier round (no pid file) still
  holds :7795 and serves this checkout; left running (not started by this round).
- [x] T5 (§7 Night 5 A6) [ui] [variant:galaxy] Gentler motion: open/fold 2800 ms on smootherstep (`layout.js OPEN_MS`,
  `ease`), the target opening from 0.32 of a flight (`camera.js FLIGHT.openAt`), held drift 0.6x (`SITE_SHOT`), dust turn
  0.6x (`still.js dustTurn`) — done when: tests pin the constants and that smootherstep has zero slope at both ends; the
  tour and touch page tests stay green (timings they assert updated only where they read these constants); a
  `?demo=1` film shows an opening without a jerk at its start or end. (commit 36bfcb4)
  Notes (builder, round 18): `layout.js` `OPEN_MS` 2800 and a new `smoother` (smootherstep) beside `ease`; `foldAt` and
  every fade that follows the opening in `scene.js` (the line spread, beacon/ring/ping fades, the crit-lobe switch, the
  dust hole, `fadeNear`) use `smoother`, so members and fades stay in step. Flights, the overview, `live.js` and the
  nebula colour changes keep the cubic `ease` (not in A6; the sketch's softer flight *out* belongs with C's Back, T13).
  `FLIGHT.openAt` 0.32: the opening ends ~1.3 s after landing (720 + 2800 vs 2250 ms). `SITE_SHOT.speed` 0.000012,
  `dustTurn` 0.0000024 rad/ms (comments updated: ~4.4 min a swing, ~44 min a turn). Test: `test/wall-galaxy-soft.test.mjs`
  (3: constants, smootherstep ends and midpoint, `foldAt`); `wall-galaxy-still`'s dust check moved from > 0.9 to > 0.5
  rad at 250 s; no tour or touch test read these constants. Perf: constants only, no draw change. Looked at
  (`$RUN_DIR/shots/r18-galaxy-b`, 30.3 fps at cpu 4x, 0 errors; a first run read 25.8 fps at load avg 4.5 from other rooms;
  `r18-galaxy-open`, 350 ms frames over HV1's opening, its 20 fps is the screenshot cadence): the cluster leaves folded at
  2.3 s, is most of the way open at 3.3 s and settles by 4.1 s with no pop at either end. The plate's `WAITING ON A
  PERMIS…` truncation is T24's, untouched here.
- [x] T6 (§7 Night 5 B1) [ui] [variant:galaxy] System room: planets spread 1.4x with a minimum gap of 13 % of the system's
  reach (the sketch's `spaceOut` in `layout.js`); what hangs below a planet moves with it; open-system labels never collide
  (`labels.js`), HV1's builders cluster the test case — done when: a layout test on the large fixture finds every planet pair
  in an open HV1 at least 0.13 of its reach apart and each child at its planet's offset, a labels test finds no two shown
  name boxes overlapping with HV1 open at 1368 px, and a still of `?at=hv1&open=1` shows every builder name whole. (commit 1cca98f)
  Notes (builder, round 19): `layout.js ROOM` {spread 1.4, gap 0.13, arms 1.24}; `SPREAD` x1.4, `CLOSED` 0.16/1.4 (a folded
  cluster keeps its size); `spaceOut` (exported, the sketch's: planets pushed apart to the gap and 0.8 gap off the star,
  children moved with their planet, dots step off 0.55 gap). Deviations, on purpose: the sketch's arm push (`ARM.r0`/`step`
  x1.24) lands too, which T1 left to this task. Without it the 1.4x reach makes the held shot stand back so far that the
  sun came into HV1's frame (calm plate) and onto HV2's words (HV2's reach/sun ratio 0.315, just under the side shot's
  0.33). No bearing (-30° to -85°) or `inward` value fixed both. `scene.js OVERVIEW_MARGIN` x1.24 with it, so the overview
  is the same picture from farther back and the T19 fit tests pass unchanged. `camera.js FLIGHT_SAMPLES` 24 → 32: HV2 →
  REMOTE jolted (5.9x the mean step) where the step-back need peaked between two samples. The A1 test pins the arms,
  margin and dust bound with `ROOM.arms`. Found: the large fixture's planets already stood ≥ 0.24 of reach apart, so on it
  B1 is the spread; `spaceOut`'s parting is pinned on a synthetic pair. Test: `test/wall-galaxy-room.test.mjs` (5:
  constants, pair gap on every large-demo system, children at their orbits offset ± the step-off, spaceOut parting,
  HV1 open at 1368 px naming every room and builder with no overlap in the plain hold). Perf: constants and a layout-time
  pass; flights sample 32 points instead of 24 per frame (cheap pure math), no draw change. Looked at
  (`$RUN_DIR/shots/r19-t6-*`, `r19-galaxy`): overview names all five sites; `?at=hv2&open=1` roomy, every name whole;
  `?demo=1` film 34.7 fps at cpu 4x, 0 errors, no sun in any hold. **Not met:** `?at=lab&open=1` with the trouble
  plate up does not name `ba` and `bb`. Their own trouble lanes' names (feat-search, fix-login, ci-retry, a few px off
  them) take every side, and the plate squeezes HV1 into the right third. That part is split to T6b, after T7.
- [x] T6b (split from T6) [ui] [variant:galaxy] HV1's builders named in the tour's hold: with the trouble plate up
  (`?at=lab&open=1`, free box ~550 px wide) `ba`/`bb` lose every side to their trouble lanes' names, which sit a few px
  off them; `feed:hv1/106` (scratch) also falls behind git-mirror in projection. Once T7 folds lanes into moons (tight,
  unnamed), check again and, if a builder is still unnamed, let a planet's name win over a child's of its own in
  `labels.js` while it stays in trouble's colour on the planet's glyph — done when: a labels test with
  `zoomedSiteShot(lab, t, DEMO_TIMING.zoom, view)` and the plate's covers names `ba`, `bb`, `bc` at four times, and a still
  of `?at=lab&open=1` shows them whole. (commit 5cf9de0)
  Notes (builder, round 23): after T7 `ba`/`bb` were still unnamed at 3 of 4 times (their trouble moons' spheres and
  names took every near side). `labels.js`: `placeLabels` puts a planet's item just before the first of its own moons'
  (items carry `host`); `candidates(…, ring)` adds the four sides again just outside the planet's shown moons (`ringsOf`:
  trouble or tappable moons, css px reach); and, since leading costs a trouble moon its name at some times (16 of 20
  trouble names at the four times vs 18 before), a planet whose own trouble moon goes unnamed **says it**: its name
  takes that moon's shape and hue (`▲ ba` in warn), its box reserved that wide so nothing hops. The plate's hero is not
  counted as lost. Every trouble moon is named or carried by its planet (pinned). Test:
  `test/wall-galaxy-hostnames.test.mjs` (3: the held shot `zoomedSiteShot(lab, t, DEMO_TIMING.zoom, view)` with the
  trouble plate's covers names ba/bb/bc at 5/30/60/90 s with no overlaps and carried trouble; host ordering; ring sides);
  the moons test now asks for `ba` too. Perf: one more projection per shown trouble moon of an open site, no draw change.
  Looked at (`$RUN_DIR/shots/r23-t6b`, `r23-galaxy`): `?at=lab&open=1` names `▲ ba`, `▲ bb`, `■ bc` whole beside the
  VM-C plate, VM-C still the loudest; `?demo=1` film 35.4 fps at cpu 4x, 0 errors. `feed:hv1/106` and some rooms
  (vm-a/vm-b) still go unnamed in the plate's hold at times: not in this task's done-when, left as is.
- [x] T7 (§7 Night 5 B2, folded) [ui] [variant:galaxy] Moons in the model and the scene: services under a room, lanes under a
  builder, sessions under a lane become moons (pure: which nodes are moons of which planet, from the map model); folded, they
  sit tight to their planet at half size, unnamed, not tappable (`scene.js` `MOON`, `moonOrbit`); the large demo carries
  lanes and sessions under at least two builders (`test/helpers/demo-hub.mjs`, if missing) — done when: tests pin the moon
  tree for the large fixture, folded moons inside their planet's reach at half size, none in `labels`' list nor in the hit
  points; the overview's draw calls/triangles before/after in the notes. (commit 2da817b)
  Notes (builder, round 22): `layout.js moonHosts` (pure): a non-planet member is a moon of the nearest planet above it, so
  a session orbits its lane's builder; `galaxyLayout` members carry `moon: { host, i, n }`. `scene.js MOON` {calm 5.5 open,
  foldK 0.5, tight 1.45, pad 3, from 0.35, to 0.9}, `moonOrbit` (per planet: 40-90 s a turn, ≤ ±40°), `moonRing` (a
  planet's moons on its one orbit, evenly spaced: the first still had HV1's trouble moons piling onto ba/bb when each had
  its own plane), `moonAt`; `placeMoons` puts them on the ring at the planet's drawn radius x1.45 + 3 + their own, and
  `frame()` turns them on (never in still mode). A calm moon grows in from 0.35 to 0.9 of the opening, so **the overview
  draws no calm moon** (the nebula and site name carry a folded cluster). **Deviation, on purpose:** a moon in trouble stays
  as a dot in trouble was: planet size, round sphere, halo, shape, named and a target, only its place is a moon's. Eight
  existing tests pin that (r8-film-ui 3 trouble ≥ a planet; the tour's locked lane named in big caps, T9/T20/T22), and
  readable trouble wins (README §2). T8 can make it tappable inside the open ring. Calm moons skip `labels.js` and
  `touch.js memberPoints`. Demo: `demo-fleet.mjs` gives builder-b's `deps-bump` a second session (`deps audit`), so the
  live Map hangs sessions under builder-a and builder-b (checked on `/api/map`). The static fixture
  `wall-large-map.json` is unchanged: adding the two session nodes moved one name pair in the radial variant's T46 test,
  and the fixture already pins lanes and sessions (builder-a), lanes and a run (builder-b). Test:
  `test/wall-galaxy-moons.test.mjs` (8: the fixture's moon tree, moonHosts, orbit, tight and clear of the planet at half
  size / planet size, none calm at the overview and growing in, turning and still, one ring that never touches, calm moons
  not named and not targets while trouble moons are). The carry and trouble tests' "calm dot = 4" lines now read the folded
  moon's 2.75. Perf (`?at=…&quality=0`, 1368 px, the r13 tool): overview **204 → 151 draw calls, 87.0k → 75.2k
  triangles**; HV1 open 94 → 91 calls, 32.3k → 24.9k. The moons are re-placed each frame only for sites with one shown
  (a few dozen positions). Looked at (`$RUN_DIR/shots/r22-t7-*`, `r22-galaxy`): overview clean, trouble still the loudest;
  HV1 open: rings round ba/bb with trouble moons apart; `?demo=1` film 27.3 fps at cpu 4x, 0 errors. Still for T6b: `ba`
  and `bb` lose their sides to their own trouble moons' names (the moons test leaves `ba` to T6b).
- [x] T8 (§7 Night 5 B2, open) [ui] [variant:galaxy] Opening moons: tapping a planet (or one of its moons) opens them onto a
  ring round it with the site's open time and easing, tilted toward the camera, a faint orbit line and thin tethers; about
  110 px apart on screen, at least 72 px from the planet; named and tappable while open; another planet's tap folds the
  first's; no picker (Q19 when answered) — done when: a test with the camera at a picked builder finds its moons' screen
  points ≥ 72 px from the planet and ≥ 100 px apart, named and in the hit points only while open, folded again when another
  planet is picked; a still of an open lane ring on the large demo. (commit a756402, 6bdc125)
  Notes (builder, round 24): `scene.js openMoons(id)` / `moonsOpen()`: a planet (or a moon: its planet) opens, every
  other ring folds, null or a planet with no moons folds all; each ring eases over `OPEN_MS` on `smoother` (still mode:
  at once) and goes with its system when that folds. `MOON_RING` {gapPx 110, minPx 80, clearPx 28, tilt 0.42 rad, segs
  48, alpha 0.9}: the ring is measured on screen at the planet's depth (`moonRingPx`), re-solved each frame, so it keeps
  its px size through any camera move (T9, T12). It faces the camera, its top tilted toward it; moons start at the top
  and go clockwise (`ringAngle`) and **hold still while open** (a finger aims at them; folded they turn as in T7). An
  opened calm moon is drawn at `MOON.calm` (5.5), named and a target from half open (`m.ringOpen`). One `LineSegments`
  per site (`s.moonLines`, invisible unless a ring is open, so the overview's draw calls are unchanged) carries the faint
  ring and tethers. `main.js` asks `galaxy.openMoons(moonsAt(place))` when the place changes (touch.js `moonsAt`), so a
  planet tap opens, a moon tap keeps its planet's ring, and its system, Back, the overview and the tour's hand-back fold.
  `labels.js`: a picked ring's calm moons are named at any size, ranked just after trouble (`RANK.site`), so on HV1's
  crowded right side they beat the neighbouring calm planets the ring overlaps (`vm-b` goes unnamed while builder-a's ring
  stands). **Found while filming, fixed:** a tap on builder-a fanned out four rows, because its folded trouble moons are
  inside the finger's 27 px. `touch.js ringHit`: a planet and its own folded moons are that planet, a moon on an open
  ring wins its tap, two different planets still fan (T11 replaces the fan). `memberPoints` points carry `host`/`onRing`
  for moons. One source assertion in `wall-galaxy-fan.test.mjs` now reads the `ringHit` line. Test:
  `test/wall-galaxy-moon-ring.test.mjs` (7: ring px, moonsAt, builder-a's five moons ≥ 72 px from it and ≥ 100 px apart
  at the held shot, named and targets only while open, held still, the ring line; builder-b folds builder-a's, a moon
  keeps its planet's, a bare planet folds all; a folding system takes it; still mode; ringHit; the page pick on the large
  fixture). Looked at (`$RUN_DIR/shots/r24-t8-ring/`, CDP touch walk on `--size large`: wake → HV1 → ba → bb → a moon →
  Back): builder-a's ring 90-109 px out, builder-b's 78-93 px, no fan, 0 console errors; `r24-galaxy` (`?demo=1`, cpu 4x)
  33.9 fps, worst gap 213 ms, 0 errors, the tour unchanged. **Left for T9:** at the system hold HV1 sits top right under
  the plate, so builder-a's top moon (and the lock on it) runs under the Back control and builder-b's ring past the
  frame's right edge (`04-ba-open`, `07-tap-moon`); T9's camera (planet left of centre, 45 % closer) is what puts the ring
  in empty screen, and its test should assert every open moon inside the frame and off the covers.
- [x] T9 (§7 Night 5 B3) [ui] [variant:galaxy] Picking a planet or moon flies the camera about 45 % closer with the planet
  left of centre, so the ring and the card use the empty screen (`camera.js`, `main.js` selection) — done when: a page test
  on a fake clock taps a planet and finds, at the flight's end, the camera distance about 0.55 of the system hold's and the
  planet's screen x in the left 45 % of the frame with its open ring inside the frame; a still shows it. (commit c39f2dc)
  Notes (builder, round 27): `camera.js PICK` {closer 0.55, at 0.3, padPx 64} and pure `planetShot(hold, p, view)`: the
  camera 0.55 of the hold's distance along the hold's own line of sight (no swing; the drift goes on), the planet at 30 %
  across the free box, never nearer its edge than its ring (`moonRingPx`) + 64 px, never past the box's middle. A site move
  carries `{ member }` (`focus`/`cut`'s options, passed through `director.js`; a moon frames its planet, so a tap on the
  ring keeps the camera); a move between two shots of the same system keeps its drift clock. `main.js openPlanet` flies
  (a cut in reduced motion), and `openSite`'s `there` holds only without a member, so Back from a planet flies out to the
  system's hold (T13 changes that to "keeps the camera where he turned it"). **Deviation, on purpose:** "left of centre"
  is of the free box, not the frame: while a planet's sheet stands the plate covers the frame's left half (x 110-780 on a
  1368 px tablet), so a planet in the frame's left 45 % would put its ring under the words. The pick's box
  (`main.js pickBox`) also leaves out `‹ BACK` and the manual line (r25 #15). T17's card can take the box's right side.
  Test: `test/wall-galaxy-pick.test.mjs` (5: planetShot; the page's camera and director on the large demo: builder-a at
  0.55 of the hold's distance, 30 % across the free box, its five moons inside the frame and off the plate, tag, fleet
  line and Back; a moon's tap keeps the camera, builder-b flies on, Back to the system flies out; reduced motion cuts;
  main.js's wiring). One source assertion and one stale comment in `wall-galaxy-touch.test.mjs` follow openPlanet. Perf:
  camera only, no draw call or triangle added. Looked at (`$RUN_DIR/shots/r27-t9-pick/`, CDP touch walk on `--size
  large`): HV1 hold 2500 → builder-a 1375 units (0.55), its ring 89-107 px round it at (1038, 444), all moons in frame
  and clear of Back; builder-b the same; a moon tap holds still; Back ×2 out to HV1 and the overview; 0 console errors.
  `r27-galaxy` (`?demo=1`, cpu 4x) 32.9 fps, worst gap 224 ms, 0 errors, the tour unchanged. **Seen, not fixed:** at 1.8x
  the HV1 builders cluster's neighbours (vm-a, vm-b, bb's trouble moons) crowd the open ring, and a picked planet's own
  name is pushed off beside the ring (`ba` 120 px below it, `bb` past the ring's right); the names' trouble moon icons
  cross `ci-retry`/`search ui` as in r24. Candidates for T17/T18 (the card names the planet) or a labels pass.
- [ ] T10 (§7 Night 5 B2, contract) [ui] [variant:galaxy] Moons join the page contract, additive only: `__cockpitView`'s
  `screenOf` and `emphasis` accept a moon id, a show `fly_to` on a moon frames it as planet → system does now (site, then
  its planet opened, then the moon), every existing name and value unchanged; `data-wall-state` gains no renamed value. If
  `fly_to` on a moon needs `show.js` (fenced), write the patch under `docs/plans/wall/patches/` and do the `main.js` side —
  done when: a test finds `screenOf(moonId)` a point while its ring is open, `emphasis` for a moon, and a `flyTo` of a moon id
  ending with its site held and its planet's ring open; `wall-galaxy-show` and `cockpit-wall-hold` tests green unchanged.
- [ ] T11 (§7 Night 5 C1) [ui] [variant:galaxy] Hit targets in screen space: 48 px for a finger, 28 px for a mouse (by
  `pointerType`), the nearest centre wins (`touch.js` the sketch's `hitNearest`, `hitRadius`). The owner wants no picker, so
  the fan (`fan.js`, its `main.js` wiring, `test/wall-galaxy-fan.test.mjs`, its `wall.css` rules unchanged or left unused)
  goes; night 4's T35 and T61 close with it — done when: tests find the nearest of two members under one finger picked,
  a mouse 30 px off a member picking nothing and a finger 30 px off picking it, no fan module or row left, and the touch page
  tests green.
- [ ] T12 (§7 Night 5 C2) [ui] [variant:galaxy] Inside an open system a drag orbits it round its own star (both axes, pitch
  clamped; the sketch's `orbitRound`) and it stays open; the first drag does not shift the system on screen (no aim offset);
  a tap on empty space does nothing — done when: a page test on a fake clock opens a site, drags 200 px each way and finds the
  site still held and open, the star's screen point within 2 px of where it was, pitch within its clamp, and an empty tap
  changing neither mode, selection nor camera.
- [ ] T13 (§7 Night 5 C3) [ui] [variant:galaxy] Back, one step at a time (moon → planet → system → overview): right-click,
  double-click/double-tap on empty space, or the Back control; Back from a planet folds its moons and keeps the camera where
  the finger turned it; zoom-out flights 3000 ms on a soft ease (`director.js` timings); double-click from a system goes to
  the overview as now — done when: a page test walks moon → planet → system → overview with each Back kind and asserts the
  step, the folded moons, the kept pose from a planet, and each zoom-out flight's duration 3000 ms; keep B239.
- [ ] T14 (§7 Night 5 C5) [ui] [variant:galaxy] The `createReturn` leftover (`touch.js`, `main.js`): Back returns to the
  explore pose a person left, never to a pose a show's `flyTo` left — done when: a page test explores to a pose, lets a show
  fly elsewhere and end, presses Back and finds the camera at the explore pose; the existing return tests green.
- [ ] T15 (§7 Night 5 C4) [ui] [variant:galaxy] The overview turn: 0.0032 rad per px, the camera follows with a short lag
  (about 70 ms), a longer gentler coast (τ about 650 ms), a capped fling speed (`touch.js`, the sketch's `SOFT.perPx`,
  `tauMs`, `follow`, `maxVel`) — done when: a test drags 100 px and finds 0.32 rad of target turn, the camera behind the
  target during the drag, the coast decaying with the τ, and a 3000 px/s fling capped; the touch tests green.
- [ ] T16 (§7 Night 5 C, done-when) [ui] [variant:galaxy] The night's touch walk as one page test and one film: tap site →
  tap planet (moons open) → drag-turn (system stays open, star stays put) → empty tap (nothing) → tap moon → Back ×3 →
  overview, with the flight durations asserted (`test/wall-galaxy-walk.test.mjs`); then a CDP touch film of the same walk
  on the large demo — done when: the test passes on a fake clock and the film's sheet shows each step (frames named in the
  notes).
- [ ] T17 (§7 Night 5 D1) [ui] [variant:galaxy] The card's place: a new `galaxy/card.js` with a pure `cardPlace` (beside the
  selected node with a visible leader line; docked to the right edge when it does not fit beside the node or would cover the
  open system's planets; never over the fleet line or the tag, `hud.covers()`) and the DOM shell `main.js` creates under the
  stage on a selection, replacing the left-hand sheet for a tapped node; the caption and the fleet line stay (Q20 when
  answered) — done when: `cardPlace` tests (fits beside, docks when off the edge, docks when it would cover a planet, clear
  of fleet line and tag), and a page test taps a planet and finds a card, no sheet, the leader joining card and node.
- [ ] T18 (§7 Night 5 D2) [ui] [variant:galaxy] The card's content: status dot, name, type chip, parent path (`hv1 › vm-a`),
  a 48 px ×; 3-4 key stats from the model where only the off value takes a status hue; a "Below" strip of child chips (tap:
  select and fly there; `+N`); a pure `describe(sel, model)` (the sketch's `card.js describe`) — done when: `describe` tests
  for a site, a room, a builder, a service moon and a lane moon (path, stats, below, `+N`), a test that a calm stat has no
  hue, and a page test tapping a Below chip selecting that node.
- [ ] T19 (§7 Night 5 D3+D4) [ui] [variant:galaxy] The card's actions per type, at most 4 and `…`: site (Open, What's below,
  Board, Pin; `…` Proxmox link), room (Logs, Board, What's below, Pin; `…` Fly to, Terminal link, Proxmox link), builder (Run
  log, What's below, Board, Pin), service moon (Logs, Board, Pin, Fly to), lane moon (Log, PR, Pin, Fly to). Navigation
  works; links open existing app views or are absent (never a dead button). Fleet actions (restart a service, pause a builder
  or lane, snooze or ack) are disabled outline buttons tagged `later` in their slots; a tap says so; nothing touches the fleet,
  nothing heavier ever appears — done when: tests per type list the buttons in order, find no button without a handler or an
  existing target, every `later` button disabled and saying so on tap, and no network call from any card button.
- [ ] T20 (§7 Night 5 D5+D6) [ui] [variant:galaxy] The card's manners: grey glass from tokens, the site tint only as a 2 px top
  edge, a 150 ms fade, the galaxy dimmed slightly behind it; closes on ×, Esc, an empty tap, a second tap on its node, a
  sideways swipe, or 60 s idle (then the tour may resume as now, B237); a labelled region, real named buttons, focus moves in
  on open and back on close — done when: a page test on a fake clock closes it each of the seven ways, finds focus inside on
  open and back on the opener on close, the region's label and every button's name; `wall.css` gains rules only; a still of
  `?at=hv1&open=1` with a builder picked shows card, leader and ring together.
- [ ] T21 (§7 Night 5 E) `docs/wall.md`: the look (the defaults and why), moons, the card (actions, `later` buttons), the
  gestures (mouse and touch: right-click, double-click/tap, drag in a system, Back steps); not the "Show commands" or handle
  sections; demo data for every feature named — done when: `test/wall-docs.test.mjs` (extended) finds the new sections and
  every URL switch it names in `galaxy/main.js`, and the hygiene test is green.
- [ ] T22 (§7 Night 5 E) The cockpit's handover: `docs/plans/wall/patches/README.md` lists every change this night made in
  shared files (`galaxy/main.js`, `public/css/wall.css`, `galaxy/director.js`, `galaxy/touch.js`) with its commit and what it
  touches, and every patch written for a fenced file; the 3 m check (an overview still shrunk to 3 m) and a `?demo=1` film
  of the new defaults — done when: the list names every commit of the night that touched those files (`git log` check in the
  notes) and the film's sheet is read in the notes.
- [ ] T23 (triage, r10-film-ui #3) [ui] [variant:galaxy] One hero per held frame: the banner drops to its one-line size
  whenever the camera holds a site, not only once the plate is up (frames 1-4 of `r9-galaxy` show `■ HV2 · STORAGE` at full
  size over a hold on HV1); full size stays at the overview — done when: a test finds the banner's size step follow the
  camera's hold state (overview full, any hold one-line, plate up or not), and a `?demo=1` film's held frames before the plate
  types show the one-line banner.
- [ ] T24 (triage, r10-film-ui #4) [ui] [variant:galaxy] The plate's text never truncates and has three levels:
  `FEAT-SEARCH · WAITING ON A PERMIS…` is cut at the plate's edge; the site name `HV1` is smaller than the line above it and
  the status lines compete with the headline. Wrap (or grow one line) instead of cutting; headline, subject, facts on one
  scale (about 1.0 / 0.42 / 0.28), facts in `--text-1` with only the mark and label coloured — done when: a test with a long
  fact finds no ellipsis cut and the plate inside the frame, a still of a crit plate (large demo, `HV1` down) shows three
  clear sizes.
- [ ] T25 (triage, r10-film-ui #11) [ui] [variant:galaxy] The overview banner returns after a Back flight lands, from its
  own place: in `r10-touch` 09-back-2 (3.2 s after the tap) `HV2 · STORAGE` is clipped by the frame's bottom edge while the
  camera still flies — done when: a page test on a fake clock finds the banner's box inside the frame at every step of a
  planet → system → overview Back, and not shown before the flight's end.
- [ ] T26 (triage, r15-dreamer #1) [ui] [variant:galaxy] The red wins the map at the overview: HV1 (warn) has a ~200 px
  yellow nebula and ring while HV2 (crit) has a thin red smear behind its own label (`r14-t3-overview`, `r15-3m.png`);
  night 4's T23 from `## Later`. Crit nebula at least 1.5x the warn's area and drawn on the side away from the label; the warn
  does not breathe and its nebula stays inside its cluster's reach — done when: a scene test finds the crit nebula's area ≥ 1.5x
  the warn's for equal clusters, the warn's nebula not animated in size, and the crit nebula's centre not under its label box; an
  overview still shrunk to 684 px (3 m) with one warn and one crit shows the red as the larger shape.
- [ ] T27 (triage, r15-dreamer #6) [ui] [variant:galaxy] A crit member is a light, not a hole: `storage` in `r14-t3-hv2` is a
  red disc with a black square and no name on the map. The crit shape stays `--text-1`/white on the red over a lit core, and the
  name stays beside it at every step (night 4's T29) — done when: a test finds the crit mark's colour light against the red
  body and the member's label in the shown list at every zoom step of its system; a still of `?at=hv2&open=1` shows both.
- [ ] T28 (triage, r15-dreamer #4) [ui] [variant:galaxy] Big stars are still faceted at 2x pixels: HV2's, `secrets`' and
  `media`'s star outlines show polygon steps at 1368 px (T2's 26x18 at ≤ 1.65x was not enough). Shade them smooth or take 48x32
  above 1.2x — done when: a test pins the new segment count (or smooth shading) for `BIG_STAR` bodies, `?perf=1` triangles at
  the overview before/after are in the notes (no rise past night 4's 84-86k beyond a few hundred), and a still of `?at=hv2` at
  1368 px shows a round edge.
- [ ] T29 (triage, r20-operator #1+#2) [ui] [variant:galaxy] A down member stays on the map as a red body, under the plate's
  name: in `r20-galaxy-real` frame 5 the plate says `VM-C · BUILDER-C NO CONTACT · 1 DOWN`, the lock closes on a yellow
  planet, the fleet line drops 115 → 114 and no red body stands; the map label reads `bc`. A member that goes down keeps a red
  body (night 4's T29) or, if the model drops it, `live.js` keeps a red ghost until it returns; the lock frames that body; while
  the plate stands the locked member's label is the plate's headline in its hue (r10 #5) — done when: a test drops a member
  from the feed and finds a red body for it in the scene and the lock on its screen point, the label equal to the headline
  while the plate stands, and the fleet count unchanged or the ghost counted as down; a still of the down builder on the large demo.
- [ ] T30 (triage, r20-operator #4) [ui] [variant:galaxy] The banner corner is never empty and never rivals the plate: during
  a crit hold `r20-galaxy-real` frames 3-4 show no banner and frame 5 a big yellow `▲ REMOTE · OFFICE-PRINTER · PAPER JAM`
  beside the red plate. In a hold the banner stays at its one line (T23) and always shows something while trouble stands: the
  held trouble, or the next one with a small `NEXT` kicker — done when: a test finds a non-empty banner at every step of a
  50 s real-timing hold with trouble standing, its size at most the one-line step, and the next trouble carrying `NEXT`.
- [ ] T31 (triage, r20-operator #3) [ui] [variant:galaxy] A number on the plate keeps counting: `NO CONTACT FOR 15S` stands
  still over three frames (11-22 s) while the banner's age counts up. Tick the age text in place every second without
  retyping the line (night 4's T30) — done when: a fake-clock test finds the plate's age text advancing each second while
  the typed text node and its typing state are untouched.
- [ ] T32 (triage, r25-skeptic #1+#9) [ui] [variant:galaxy] The banner says only what the plate does not, and its count is the
  fleet's: in a trouble hold `▲ HV1 · FIX-LOGIN · ASKED A QUESTION · 80M` repeats the plate's fourth line word for word, and
  `+4 MORE` / `+3 MORE` flips with the camera with no change in the fleet. In a hold the banner shows a trouble not on the
  plate (`▲ CLOUD · API-PROD · P95 1.8 S`), or nothing if every trouble is on it; the `+N` is always the fleet's total trouble,
  never a function of what the plate shows. Goes with T23/T30 (read both first; T30's "never empty" yields to this when
  nothing is off the plate) — done when: a test finds, for a plate holding trouble X, no banner line equal to X's text, the
  `+N` equal across every camera state for a fixed fleet, and changing only when the fleet's trouble count does.
- [ ] T33 (triage, r25-skeptic #12; night 4's T26 raised) [ui] [variant:galaxy] Hyperlanes stay grey at every zoom: in
  `r24-galaxy` frame 1 the sun-to-site lanes repeat their nebula's yellow, and in `r24-t8-ring/04-ba-open` a red lane cuts
  through HV1's open system and leaves the frame. A lane is grey; optionally it goes dark when its site's feed is silent
  (freshness, a line already drawn) — done when: a scene test finds every lane's material the neutral grey for warn, crit and
  down sites (trouble nebulae keep their hue), and a still of `?at=hv1&open=1` with HV1 in crit shows no red line through the
  system.
- [ ] T34 (triage, r25-skeptic #6; night 4's T49 raised) [ui] [variant:galaxy] The typing cursor never stands alone: a white
  block blinks on an empty line under a full headline or under nothing (`r24-galaxy` frame 10, 26.9 s; `r20-fx-warp` frame 11).
  The cursor shows only while letters arrive; the name line's space stays reserved but empty until the first letter; the typing
  itself stays — done when: a fake-clock test finds no cursor element visible when the line is empty or fully typed and more
  than the settle time has passed, and the line's box height equal before and after the first letter.

- [x] Q19 → research/Q19-moons-nested-selection.md (thin on hit radius; sources partly blocked). Moons and nested selection in 3D strategy and space maps (Stellaris, Homeworld, Elite Dangerous's system map, EVE,
  Kerbal Space Program's map view, Celestia/Space Engine): how small bodies inside a selected system stay tappable without a
  picker (spacing on screen, a ring or fan-out on selection, hit radius vs drawn size, labels on and off), how a selection
  steps down and back up (site → planet → moon) and how the camera frames each step. Touch guidelines already answered in
  night 1's Q6 and night 3's Q12: do not repeat them. 2-3 concrete proposals with a cost guess — for T8, T11
- [x] Q20 → research/Q20-node-card-placement.md (Apple HIG page not loaded; summary only). How a node card stays out of the way on a 3D view: anchored callouts with leader lines vs docked panels in games
  and 3D tools (Stellaris's outliner and selection panel, Homeworld, Google Earth, CAD/BIM viewers, map apps' place cards):
  when to dock, how a card avoids covering what it describes while the camera moves, how it follows a moving anchor without
  jitter, and how it closes. `research/stellaris-ui-brief.md` already covers Stellaris's panels: read it, do not repeat it —
  for T17, T20

## Later

Night 4's open tasks (`nights/night-4/PROGRESS.md`, full text there; its own `## Later` notes stay in that file):
- night 4's T22 A new trouble is a moment (the banner types its new subject once after a rise).
- night 4's T23 Crit and warn differ at 3 m by more than hue (crit nebula ≥ 1.5x warn, warn does not breathe).
- night 4's T24 A site name is never eaten by its own cluster at the overview (re-check after T1's spacing).
- night 4's T25 The held crit is not at the frame's edge (touches the tour hold, which stays as it is tonight).
- night 4's T26 No red line without a name (hyperlanes grey at every zoom).
- night 4's T27 The tag is a cover for map labels (re-check after T1's framing).
- night 4's T28 One ranking for the banner and the tour (needs `tour.js`, fenced tonight: a patch if taken).
- night 4's T29 A down or crit member keeps its red at every step and age.
- night 4's T30 A held crit does not blank to update a number.
- night 4's T31 A pinch cannot lose the galaxy (`⌂ ALL`).
- night 4's T32 A palm does not wake.
- night 4's T34 The overview is the cheapest frame it can be (dot geometry folded; T2 and T7 change the counts).
- night 4's T36 The wake does not force layout.
- night 4's T47 The afterglow ring is never read as live trouble (dashed, starting amber).
- night 4's T48 The kicker never counts itself (needs `tour.js`, fenced tonight).
- night 4's T49 The typing cursor never stands alone.
- night 4's T50 Trouble leaving is a moment too (`CLEARED`).
- night 4's T51 The agent has a voice: a show takes the caption plate (needs `show.js`, fenced tonight).
- night 4's T52 Show cards and banner keep out of the way (needs `show.js`, fenced tonight).
- night 4's T54 The camera does not leave a crit while its plate still names it (tour hold, stays tonight).
- night 4's T55 The banner corner is never empty while trouble stands.
- night 4's T56 A countdown in the scene is quiet.
- night 4's T57 One countdown, never the loudest mover on a trouble plate.
- night 4's T58 Late says late (`LATE 13 MIN`).
- night 4's T59 A pinned card outlives its fact (needs `show.js`, fenced tonight).
- night 4's T60 A finger beats a show for the camera only (needs `show.js`, fenced tonight).
- night 4's T62 The wake is not silent (manual line and control within 200 ms).
- night 4's T63 The show does nothing while nothing is due (needs `show.js`, fenced tonight).
- night 4's T64 The sweep's news costs nothing per frame.

From `r10-film-ui.md` (bugs and gaps past the 3-task limit):
- r10 #5 The plate's headline (`VM-C`) and the locked node's map label (`bc`) differ; show one name while the plate stands.
- r10 #10 In explore mode the touched node's name is the headline and the fact its subject (the card, T17-T18, may settle it).
- r10 #12 The wake says nothing for 300 ms (same as night 4's T62).
- r10 3 m check: the banner's second line (`POOL 97% FULL`) turns to texture at 342 px; a step larger or bolder.
- r10 #1/#2 sun on the tag and the held shot composed for the plate: T1b covers the sun; plate-sized bracket and the star on the right third line stay here.
- r10 fx beacon: cap the pillar with a tick and the crit's age; keep it under a quarter of the frame in a flight.
- r10 fx activity: rings at `--text-3` alpha, never inside a lock nor on the held trouble member.
- r10 fx sweep: a ping is a short dash arc fading in about 1 s, not a closed ellipse (reads as selection).
- r10 fx afterglow: needs a filmable clear (a demo hook clearing a site at a known second).

From `r15-dreamer.md` (past the 3-task limit):
- r15 #5 The plate's leader cuts through the system it points at; route it round the system's bounding ellipse to the lock's nearest bracket corner.
- r15 #7 The red banner never rests: T23 (one line in holds) is the first step; aging trouble dropping a size step is under `## For the owner`.
- r15 #8 The hub is a beige ball with no corona: C1b's (stale/live work), not ours.
- r15 #9 A picked planet's tether to its star brightens while selected (T8/T9 cover the camera and ring; the tether is the addition).
- r15 fx beacon: pillar stops at about the cluster's diameter with a tick for the crit's age (same as r10); fx afterglow/sweep: demo hook (clear a site, one sweep in the first 5 s of `?demo=1`) so they can be filmed; fx activity: rings at `--text-3`, slow fill, never inside a lock (same as r10).

From `r20-operator.md` (past the 3-task limit):
- r20 #5 Tour hold scales with severity (~14 s crit/down, ~8 s warn/attention), a crit revisited after every other site (`tour.js`, fenced: a patch).
- r20 #6 `DEMO_TIMING` keeps the real ratios (trouble hold ≈ 2.3x calm, `revisitEvery: 2`; `tour.js`, fenced: a patch); with no plate the held shot recentres on the star.
- r20 #7 Among equal severity the oldest trouble stays the banner's subject (night 4's T28, one ranking; needs `tour.js` for the tour side).
- r20 #8 Status-hued labels take no depth fade (CLOUD's warn label is dark ochre at the overview); the crit nebula size is T26.
- r20 #9 Trouble members' names a step larger in the condensed face; calm names stay small.
- r20 #10 Wake says nothing for 300 ms (night 4's T62, r10 #12).
- r20 fx: beacon pillar straight up about a cluster's diameter with a tick and the crit's age; activity rings at `--text-3` alpha, never in a lock; sweep pings only trouble as short fading dash arcs; afterglow needs a demo clear hook (same as r10/r15).

From `r25-skeptic.md` (past the 3-task limit):
- r25 #2 Drop the `STATUS ▲ N ATTENTION` count line when the list below shows every trouble it counts (`+N MORE` only when cut).
- r25 #3 In explore the tapped node is the headline (`▲ BA` in its worst hue), its troubles the lines below; T18's card must not copy the plate's trouble-first order (also r10 #10).
- r25 #4 Remove `VERSION` and `HOLDS 3 lanes` rows from the plate/sheet (the version, if anywhere, in the card's `…`).
- r25 #5 The lock closes only on a member in trouble or one a finger picked; a calm hold has no lock (also `fx=activity` rings).
- r25 #7 The tag is one word, `LIVE` or `STALE 2M`, readable at 3 m (C1b owns the stale part; note for it).
- r25 #8 The tour's kicker is kind and parent (`BUILDER · IN HV1`), no `TARGET 02 / 05` counter (owner has it open as a taste question; skeptic votes yes; `tour.js` fenced).
- r25 #10 `OFFSITE COPY OFFICE-NAS · 45:43` has no unit; one format (`LAST COPY 46 MIN AGO`) or remove.
- r25 #11 Remove star-to-planet spokes (keep stems and a faint ellipse).
- r25 #13 Dim the galaxy's outer arm ribbon below the hyperlanes.
- r25 #14 Halve the clock and drop its date line at the overview.
- r25 #15 Covered by T9; add to T9's test: every open moon and its lock inside the frame and off the controls (`‹ BACK`).
- r25 fx: beacon straight up, short, crit age at its tip (same as r10/r15/r20); sweep: no wedge, a silent site gets one small outline mark; afterglow: demo clear hook or remove; warp, activity: skeptic says remove (see `## For the owner`).

Closed by this night's plan (moot):
- night 4's T33 Sheet rows are real targets: the left-hand sheet for a tapped node gives way to the card (D5, T17), whose
  buttons and chips are 48 px by the night's tappable rule.
- night 4's T35 An open fan writes only what changed, and T61 The fan keeps off trouble: the owner wants no picker; the fan
  goes with T11 (nearest centre wins, roomier systems in T6).

Night 6 (README §7, planned, not this night): the alert tray, the outliner with an "all green" seal, the situation log, the
slim top bar of fleet totals, map modes.

## For the owner

- (planner, colours) The plan says the site tints come "from tokens through `palette.js`", but the design guardrail
  (`test/design-guardrails.test.mjs`) allows only the accent and status hues as chromatic tokens in `tokens.css` and no
  colour literals in other sheets. Tonight the tints and the lifted ground live as one documented table in
  `galaxy/palette.js` (T3). If you want them as `--site-tint-*` tokens, that is a guardrail change for you to make.
- (planner, tooling) Playwright is not in `node_modules` on this VM, so the cockpit's `e2e/cockpit` specs (S-C1-01,
  S-SCR-0x) are checked only by `ci` on the PR; rounds keep the unit tests (`test/cockpit*`, the resume and show tests) green.
- (planner, run) Rounds 1-6 of this run ended with no work (the loop stopped on `no-progress` at 21:35, tests not green);
  the run restarted at 22:07 with tests green (4845 pass), and this plan is round 7's.
- (triage r10, taste/direction, not tasks) From `r10-film-ui.md`: planet labels in the plate's condensed caps face at
  `--text-2` with a dark halo instead of lowercase mono (#6); a beat of ~0.4 s stillness between arrival and the plate typing
  (#7, partly T5); shift the overview's galaxy 3-4 % up-right so the banner sits in free space (#8); the plate's bracket sized
  to its text (#1).
- (triage r10, `fx` candidates) `warp`: either one real acceleration moment in the middle 40 % of a flight, or drop it
  (half-measure is the worst of both); `beacon`/`sweep` set the rhythm the others should copy (one motion, one direction,
  then stillness); `afterglow` scored wow 3: decide whether to keep it.
- (triage r15, taste/direction, not tasks) A held system carries its site's tint at calm chroma (orbit ellipse, star halo, soft
  ground disc) so you know where you are before the name (#2); during a flight the destination's name and distance ride at the
  frame's edge (`→ HOME · 0.4`) so calm flights are not dead air (#3); a trouble standing unchanged for hours drops one size
  step and its age (`POOL 97% FULL · 6 H`) becomes the loud part (#7).
- (triage r15, `fx` candidates, from "unforgettable") `scan`: on arrival a system's planet names type in, trouble members first,
  then by load; `eclipse`: a member with no contact loses its lit side, a dark disc with a thin red rim until contact returns;
  `dial`: a thin 24-hour ring round each star showing the last day's status as outline arcs in the old hue (afterglow with a clock).
  None became a task (decision for the owner; `eclipse` and `dial` change what "down" and history look like).
- (triage r20, `fx` candidates, taste) `warp`: drop it, or keep it only on a flight to a crit with the target's name in the streak's colour (scored wow 3, streaks not visible); the overview banner's second line as `1 DOWN · 3 ATTENTION · 1 WARN` in big condensed caps instead of `+4 MORE`; a beacon-style vertical mark above every crit visible from any camera, gone when it clears. No new `fx` task this review.
- (triage r25, taste/direction, not tasks) The skeptic asks for removal: `fx=warp` (streaks not visible, wow 2), `fx=activity` (repeats `7 WORKING`, calm 3) and `fx=afterglow` unless a demo hook can show it; `fx=sweep` reduced to one outline mark on a silent site. Decision for the owner, nothing removed. Also: the galaxy's brightest lines should be the ones that carry data (outer ribbon dimmed, spokes removed, #11/#13).

## Reviews

- r10-film-ui.md: 12 galaxy findings + 5 fx + 3 m check; 3 became tasks (T23, T24, T25); #9 dropped (covered by T9), #1/#2 covered by T1b, the rest under `## Later` or `## For the owner`.
- r15-dreamer.md: 9 galaxy findings + 5 fx + 3 unforgettable + 3 m check; 3 became tasks (T26, T27, T28); #1 is night 4's T23 raised, #6 is night 4's T29 raised, #2/#3 and the three proposals to the owner, #5/#7/#8/#9 and fx notes under `## Later`.
- r20-operator.md: 10 galaxy findings + 5 fx + 3 m check; 3 became tasks (T29 = #1+#2, T30 = #4, T31 = #3); #8 crit size covered by T26, #5/#6/#7 need fenced `tour.js` (patch notes under `## Later`), #9/#10 and fx notes under `## Later`, proposals under `## For the owner`.
- r25-skeptic.md: 15 galaxy findings + 5 fx + 3 m check; 3 became tasks (T32 = #1+#9, T33 = #12, T34 = #6); #15 covered by T9 (test note under `## Later`), #3 covered by the card (T18) and r10 #10, the rest and the fx notes under `## Later`, removals under `## For the owner`.

## Scores

| round | persona | variant | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|---|
| 10 | film-ui | galaxy | 7 | 6 | 8 | 6 | 7 | 6 | 7 |
| 10 | film-ui | fx-beacon | | | | | 5 | 6 | |
| 10 | film-ui | fx-warp | | | | | 4 | 6 | |
| 10 | film-ui | fx-afterglow | | | | | 3 | 8 | |
| 10 | film-ui | fx-activity | | | | | 4 | 5 | |
| 10 | film-ui | fx-sweep | | | | | 6 | 7 | |
| 15 | dreamer | galaxy | 7 | 6 | 6 | 5 | 6 | 5 | 7 |
| 15 | dreamer | fx-beacon | | | | | 5 | 6 | |
| 15 | dreamer | fx-warp | | | | | 6 | 6 | |
| 15 | dreamer | fx-afterglow | | | | | 2 | 7 | |
| 15 | dreamer | fx-activity | | | | | 4 | 3 | |
| 15 | dreamer | fx-sweep | | | | | 5 | 6 | |
| 20 | operator | galaxy | 7 | 6 | 5 | 5 | 6 | 6 | 7 |
| 20 | operator | fx-beacon | | | | | 5 | 6 | |
| 20 | operator | fx-warp | | | | | 3 | 7 | |
| 20 | operator | fx-afterglow | | | | | 2 | 7 | |
| 20 | operator | fx-activity | | | | | 3 | 3 | |
| 20 | operator | fx-sweep | | | | | 4 | 5 | |
| 25 | skeptic | galaxy | 7 | 6 | 6 | 5 | 6 | 5 | 7 |
| 25 | skeptic | fx-beacon | | | | | 5 | 6 | |
| 25 | skeptic | fx-warp | | | | | 2 | 7 | |
| 25 | skeptic | fx-afterglow | | | | | 2 | 7 | |
| 25 | skeptic | fx-activity | | | | | 3 | 3 | |
| 25 | skeptic | fx-sweep | | | | | 4 | 5 | |

## Morning
