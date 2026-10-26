# Wall: progress

Night 2 (README §7 Night 2): build the galaxy properly (A), polish it through triage (B), explore effects
behind `galaxy.html?fx=<name>` (C), hunt for ideas (D), docs (E). Night 1 is in `nights/night-1/`.

Notes for every builder round (planner, round 1):
- **Fenced Wall modules** (`loop/fenced.txt`): `caption.js`, `frame.js`, `glow.js`, `lock.js`, `main.js`,
  `perf.js`, `tour.js`, `type.js`, `variants.js` in `public/js/wall/`. The galaxy *uses* them as they are; its
  own code lives in `public/js/wall/galaxy/` (not fenced). Where one needs a change, write it under
  `## For the owner`.
- **The camera is a Map look-alike.** `tour.js` drives `map.focus(id, zoom)` / `map.fit()`; `lock.js` reads
  `map.screenOf(id)`, `map.onDraw(cb)`, `map.snapshotScene()`. The galaxy's camera module offers the same
  methods so the fenced driver and lock work on the 3D camera unchanged.
- **Guardrails** (`test/frontend.test.mjs`, `test/design-guardrails.test.mjs`): no `innerHTML`, no wholesale
  `style` attribute, no new sheet in `public/css/` (the galaxy's rules go in `wall.css`, the one other-page
  sheet), colours from tokens (WebGL colours read from CSS custom properties at boot, not hex in JS), three.js
  imported by a relative path. The sketch (`sketch/galaxy.js`, `galaxy.html`) breaks all of these on purpose.
- **three.js**: `git show sketch/wall-galaxy:public/vendor/three/three.module.js` (0.170.0, MIT, D8).
- **Filming**: `film.mjs` hangs on animated canvases here without SwiftShader. Make the wrapper
  `$RUN_DIR/chrome-swiftshader.sh` as `nights/night-1/PROGRESS.md` (lines 19-22) says and run
  `CHROME=$RUN_DIR/chrome-swiftshader.sh node docs/plans/wall/loop/film.mjs --url
  'http://127.0.0.1:7795/galaxy.html?demo=1' …` on `demo-fleet.mjs --size large`. Its fps is the VM's software
  raster; judge speed by script ms per frame (T10).

## Tasks

- [x] T1 (§7.A1) [ui] `public/js/wall/galaxy/layout.js`, pure, from `sketch/galaxy.js`: sites on two spiral
  arms (`armPoint(i, n)`), the dust band's points, a system's planets from the orbits layout
  (`variants/orbits.js`) with inclined orbits whose height stays within half the planet's distance from the
  star, and `foldAt(open, p)` folding a system to `CLOSED` (0.16) of its size; no DOM, no three — done when:
  `test/wall-galaxy-layout.test.mjs` shows arms are deterministic for one model, no two sites closer than a
  minimum, every height |y| <= 0.5 * distance, `foldAt(0)` = folded and `foldAt(1)` = open positions.
  (commit c6161a4) Nothing to film yet (no page before T3); checked on the large fixture instead: min site gap
  1116 (MIN_SITE_GAP 700), widest open system reach 397, folded ≤ 64, so open systems never meet. API for
  T3/T4: `galaxyLayout(nodes)` → `{ core, sites: [{ id, node, home, members: [{ id, node, off, planet }],
  reach }] }`, `dustPoints(n)` → `{ positions, t }` (t: 0 sun..1 rim, for the colour), `farStars(n)`, `ease`.
- [x] T2 (§7.A2) Vendor three.js 0.170.0 from branch `sketch/wall-galaxy` as
  `public/vendor/three/three.module.js` with its MIT `LICENSE` beside it, served by the existing `/vendor/`
  fall-through — done when: a test (`test/wall-galaxy-vendor.test.mjs`) checks the file's `REVISION` is
  `'170'`, the LICENSE is there, and `GET /vendor/three/three.module.js` is served as JavaScript.
  (commit 46fd6fa) Copied unchanged from the sketch; `public/vendor/three/SOURCES.txt` pins its sha256 (the
  test checks it). Import it as `../../../vendor/three/three.module.js` from `public/js/wall/galaxy/`.
- [x] T3 (§7.A1) [ui] [variant:galaxy] `public/js/wall/galaxy/scene.js` (sun, dust, far stars, hyperlanes,
  nebulae by worst status, planets, stems with their landing rings, from T1's layout; colours from a pure
  `paletteFrom(readVar)` over the status tokens) and the page `public/galaxy.html` + `galaxy/main.js` (fetch
  `/api/map`, `/ws` map frames with backoff as `main.js` does, `window.__wallPerf` from `perf.js` counting
  rendered frames), styles in `wall.css` — done when: a test covers `paletteFrom` and the nebula status
  mapping, `test/frontend.test.mjs` passes, and a still of `galaxy.html` on the large demo shows the sun, five
  clusters and a red nebula, with `__wallPerf.frames` growing. (commit a28786b)
  Looked at it on the large demo (`$RUN_DIR/shots/r7-galaxy/sheet.png`, stills `r7-galaxy-still*`): the sun,
  five clusters on the arms, `lab` red, `cloud` yellow, trouble coming and going, no console errors; `?at=hv1`
  shows the open system with spokes, stems and landing rings. The sun's halo was as loud as the trouble, so
  it went down to 0.4. Colours: a pure `paletteFrom(readVar)` in `galaxy/palette.js` reads `--p1/--p2/--p3`
  and the Wall's greys (it parses `color-mix(in oklch)`); calm, the sun, the dust and the stars are grey, so
  the sketch's warm sun and blue dust are gone (only the accent and status hues may carry colour). The calm
  `__repos` draws no cluster (tour.js `tourSites`). Speed at 4x under SwiftShader: 35 ms/frame, and 34.9 of
  that is `renderer.render` (the VM's software GL); the rest of the page is ~0.4 ms; a rebuild on a tone
  change is 26-54 ms (T8 removes those); 198 draw calls, 22 geometries, 3 textures (T10). No labels yet (T6).
  `?at=<site>&open=0..1` parks the camera, for stills. API for T4: `createGalaxyScene(canvas, {palette})` →
  `{ update, setOpen(id, k), frame(now), camera, world: { sites: [{ id, home, reach, open, … }] } }`,
  `overviewShot(sites, now)`, `siteShot(site, now)`. `test/frontend-static.test.mjs` now lets a relative
  import land on a vendored module under `public/vendor/`.
- [x] T4 (§7.A1) [ui] [variant:galaxy] `galaxy/camera.js`: the Map look-alike (`focus(id, zoom)`, `fit()`,
  `onDraw`, `screenOf`, `snapshotScene`) that flies the 3D camera from the overview to a system, opens it
  (T1 `foldAt` over `OPEN_MS`) while arriving, drifts slowly round it while held, folds it when leaving;
  `createTour` from `tour.js` drives it (trouble first) — done when: a test drives `createTour` with fake
  timers over the camera and sees the crit site focused first and `fit()` after the cycle, and a filmstrip
  of `galaxy.html?demo=1` shows overview → crit system opening → next system.
  (commit fd0dcdf) Filmstrip `$RUN_DIR/shots/r11-galaxy/sheet.png` (large demo, `?demo=1`, 4x): overview →
  the crit system mid-flight then open → the calm systems in turn → overview → the crit system first again;
  no console errors. API: `createGalaxyCamera(galaxy)` → the Map methods plus `frame(now)` (before the scene
  draws) and `drawn()` (after, runs `onDraw`); pure `flightPose` (eased lerp, the position arcs up by 0.18 of
  the hop, at most 900), `openStep`, `zoomedSiteShot` (the tour's 2.3 is siteShot's distance, more zoom is
  closer). The held drift is `siteShot`'s, counted from arrival so nothing jumps. The opening follows frame
  steps up to 500 ms: with a 100 ms cap (the sketch's), at the throttled film's ~3 fps no system opened in a
  demo leg. `screenOf` projects a site or member to canvas css px (null behind the camera); T9 checks it
  with the lock. `snapshotScene` gives only a `version` (no 2D points, `fitScale` null), so `lock.js`
  falls back to its own scale until T9. Seen: the open crit system's bottom planet touches the frame edge
  (Later), the sun fills the top of some holds (T16), the dust is coarse close up (Later).
- [x] T5 (§7.A1) [ui] [variant:galaxy] Caption, frame and clock on `galaxy.html` from `caption.js` and
  `frame.js` (vignette, clock, worst fleet line, tag), fed from `tour.onLeg` with `captionLines` as on
  `wall.html`; the sketch's own caption and clock are not ported — done when: a test checks `galaxy.html`
  has the ids `caption.js` and `frame.js` need and the module wires `onLeg`, and a filmstrip shows the name
  typing in at each arrival and the clock bottom left.
  (commit f97dcc7) `galaxy/hud.js` `createHud({ caption, frame, tour })` (test/wall-galaxy-hud.test.mjs
  drives it with the real `createTour` and fakes): a site leg shows `captionLines` from the newest model,
  the overview hides it; the frame gets every model and `live(on)`; `covers()` gives the caption plate and
  the far fleet block for T6's labels (also `__galaxyHud.covers`). Layers `#wall-frame`, `#wall-caption`
  over the canvas, same ids as `wall.html`; `?at=` shows the parked system's caption at once (still timing).
  Filmstrip `$RUN_DIR/shots/r12-galaxy/sheet.png`: names typing in (`HOME█`, `HV█`), the trouble word on
  feat-search and vm-c, the clock bottom left, the far fleet line bottom right; no console errors. A frame
  shows a plate's last row cut: it is caught mid-grow at the throttled 2 fps (the settled still
  `r12-still`, `?at=cloud`, is clean). Seen: at the overview and in the calm holds the far fleet line
  (`■ HV2 · STORAGE`) is the loudest thing, as §2.1 wants; the open crit system's lower planets go under
  the far fleet block at 63 s (adds to the Later line on the reach past the bottom edge).
- [x] T6 (§7.A1, §7.A3) [ui] [variant:galaxy] `galaxy/labels.js`: names that always face the camera, drawn
  over everything, plus a pure screen-space pass `placeLabels(boxes)` (priority: trouble, then site, then
  host/room, then the rest; lower ones hidden where they overlap); lanes named only in trouble or when the
  camera is close — done when: `test/wall-galaxy-labels.test.mjs` shows no two shown boxes overlap and a
  trouble name always wins, and a still of the busiest builder held shows no two names on top of each other.
  (commit 72d101b) A DOM layer `#galaxy-labels` between the canvas and the frame (Q9: a 2D overlay, not
  canvas-texture sprites), one span per name moved by transform; 0.12 ms/frame of script for 32 names
  (unthrottled, node bench). Pass: each name tries right, left, above, below (trouble two more steps down),
  keeps last frame's side while it is free (no hopping under the drift), and keeps clear of `hud.covers()`
  and other spheres (trouble may cover a sphere when nothing else is free). Builders rank with rooms (they
  are planets); services, lanes and sessions are "the rest", named in trouble or when their dot is ≥ 9 px.
  Seen first: at the overview the folded `lab` piled five trouble names and lost its site name, so a
  folded cluster is one name, its site's, in its worst hue with its shape (`■ HV2`, `▲ HV1`); members
  are named once the system opens (fade over open 0.45-0.85). Type: sites/sun in the label face caps at
  the site step, planets and dots mono lowercase at the room step (`type.js stepsFor`: 26/11 px on the VM's
  1x, 35/15 on the tablet). Stills `$RUN_DIR/shots/r14-still{1,2,3}` (`?at=lab`, `?at=hv2`, overview),
  filmstrip `$RUN_DIR/shots/r14-galaxy/sheet.png`: no two names overlap, no console errors. Seen: at the
  overview CLOUD sits under the far fleet block and is hidden (adds to the composition line in Later);
  at the VM's 1x the 11 px planet names are small in the sheet (the tablet gets 15).
- [x] T7 (§7.A2) [ui] The 2D fallback modules from the sketch: `public/js/wall/variants/tiles.js`
  (`withTiles`) and `variants/islands-tiles.js`, plus the focus-only link filter as a pure function in
  `variants/tiles.js`; `galaxy/main.js` sends a browser without WebGL to `wall.html?variant=islands-tiles`.
  Registering the variant needs fenced `variants.js` / `main.js`: the diff goes to `## For the owner` — done
  when: `test/wall-tiles.test.mjs` covers the tile for a warn/crit place, none for calm, and the link filter
  keeping only the held site's links.
  (commit ac3e3e6) `variants/tiles.js`: `troublePlaces(nodes)` (id → warn|crit, counted for the nearest
  named place: site, host, room, repo, builder; `low` gets none), `tiledOptions`/`withTiles` (tiles as
  render.js polygon guides, new guides only when a tone or the base layout changes), `focusLinks(model,
  heldSite)` + `siteOf`. `variants/islands-tiles.js` exports `links = 'focus'` for the registry. The galaxy
  asks `galaxy/fallback.js hasWebGL()` before three.js (three's own context errors gone) and
  `location.replace(fallbackHref(search))` → `wall.html?variant=islands-tiles[&demo=1]`. Seen with Chromium
  `--disable-webgl --disable-3d-apis` (`$RUN_DIR/chrome-nowebgl.sh`, still `$RUN_DIR/shots/r18-nowebgl`):
  `galaxy.html?demo=1` lands on wall.html, no console errors; it shows radial until the owner registers the
  variant (For the owner). The WebGL path is unchanged (`r18-galaxy`, `?at=lab`, no errors).
- [x] T8 (§7.A4) [ui] [variant:galaxy] Live data in `scene.js`: a status change recolours and re-glows the
  same objects (no rebuild, no jump); a tree change (node added or gone) folds the cluster, re-lays it and
  opens it again; the camera never cuts — done when: a test shows `update()` with a status change keeps
  object identity and a tree change schedules fold → relayout → open, and a 30 s filmstrip on the large
  demo shows trouble coming and going with no jump. (commit 6b3ae25)
  Pure planner `galaxy/live.js` (`treeKey`, `siteKeys`, `planLive` → kept/changed/added/removed, `relayPhase`,
  `glide`, timings `LIVE`: recolour 700, fold 700, reopen 1100, glide 1600 ms). `scene.js` builds sites once
  and keeps them: a status change swaps meshes to the tone's shared material and eases halos, nebula and
  hyperlane in place (a calm dot's halo shrinks to nothing, a dot in trouble grows one); a tree change folds
  the touched system (`s.squeeze` times the camera's `open`; `s.unfold` is what is drawn, labels read it),
  swaps the new members in at the bottom and opens again; a site that came or went grows/shrinks on its spot
  (`s.alive`), a star whose arm slot moved glides (`s.home` mutated, so the camera follows). `world.version`
  bumps on swaps (labels re-learn ids). `createGalaxyScene` takes `clock` and `makeRenderer` so
  `test/wall-galaxy-live.test.mjs` drives the real scene in node. Filmstrip `$RUN_DIR/shots/r19-galaxy/sheet.png`
  (large demo, 4x): hv1 goes warn → crit, trouble comes and goes, no jump, no console errors. The large demo
  has no tree changes (12 polls over 48 s: 1 tree, 7 status variants), so the tree path was checked by
  injecting three builders into `home` (`$RUN_DIR/tools/treechange.mjs`, frames `$RUN_DIR/shots/r19-tree/`):
  fold → swap with the new planets named → open, then the next socket frame took them out again the same way;
  0 errors. Seen: the folded system is a lumpy ball for a moment mid-relayout (the Later line on folded spheres).
- [x] T9 (§7.A5) [ui] [variant:galaxy] The target lock (`lock.js`, with `lockTarget`) and the caption's
  trouble word on the 3D camera: `screenOf` projects the node, its screen size from its distance — done when:
  a test checks `screenOf` of a node at the camera's look-at is the screen centre and grows with zoom, and a
  still shows the four brackets closed round the trouble planet with the leader to the caption.
  (commit 6a03398) `camera.js screenOf(id)` → `{ x, y, r }`, `r` the drawn radius in css px (scene SIZE
  star/planet/dot × scale over the distance). Fenced `createLock` sizes brackets from the Map's `SIZE[kind]`
  × a node scale clamped 0.8-1.6 and fixed at lock start (a planet held is ~25 px, the Map's room ≤ 10), so
  `galaxy/lock.js createGalaxyLock` is its DOM part again with `lockGeometry3d({ r, side, t })` (same gaps
  as `lockGeometry`, a test checks they agree), sized every frame, so the brackets track the planet through
  the approach; progress, leader, tone and `lockTarget` are lock.js's. `hud.js` takes `lock`: a site leg
  locks on `lockTarget`, in the trouble word's hue (a parked `?at=` leg has no status: it was grey, no
  leader, until fixed). `labels.js` takes `held()` (`{ id, r }` from `lock.held()`): the held thing's name
  goes outside its shut brackets (as a plain cover, the trouble name lost every spot and vanished). Layer
  `#wall-lock` between the frame and the caption, as on wall.html. Still `$RUN_DIR/shots/r20-still-hv2-crit`
  (`?at=hv2`, storage crit): red brackets shut round storage, the leader from the plate's STORAGE to the
  top-left bracket, `■ storage` beside them; filmstrip `$RUN_DIR/shots/r20-galaxy/sheet.png`: grey brackets
  on calm HV2/CLOUD, amber on remote's office-printer; 0 console errors; script 13.8 ms/frame avg incl. the
  VM's software render (22 geometries, 3 textures, unchanged). Seen (for T18): at `?at=lab` the trouble lane
  feat-search is under the caption plate, so its brackets are hidden and no leader (it runs back left); on
  hv2 the lower brackets touch the far fleet block.
- [x] T10 (§7.A6) [variant:galaxy] Speed: script ms per frame in `__wallPerf`-style stats and a `?perf=1`
  overlay (ms/frame, fps, `performance.memory` when there, renderer info: calls, geometries, textures); a
  pure `budgetStep(stats)` that lowers sphere segments, dust and star sprites when frames miss the budget;
  geometries and textures disposed on relayout — done when: a test covers `budgetStep` stepping down and back
  up, and an hour-proxy run (10 min of `?demo=1` on the large demo) shows renderer geometries/textures flat.
  (commit c3603b9) `galaxy/budget.js` (pure): `createFrameWindow` times frames in 1 s windows (mean gap,
  script ms, fps; a hidden page starts again); `budgetStep(state, window)`: 3 windows over 20.8 ms (1.25 × a
  60 Hz frame) step down, 20 windows at ≤ 18 ms with script < 6 ms step up, and each step up that did not
  hold doubles that wait (≤ 320 windows), so a page on the edge settles instead of popping its dust.
  `LEVELS`: L0 full, L1 segments 0.65 / dust and stars 0.6, L2 0.45 / 0.35. `scene.setQuality(n)` gives every
  mesh new shared spheres (old ones disposed; a member laid out later gets the current ones) and thins dust
  and far stars by draw range (both are in random order, so it is an even thinning). `__wallPerf` adds
  `scriptMs`, `frameMs`, `level`; `?perf=1` prints three mono lines in the top margin above the tag (script
  ms · ms/frame · fps · level; calls · geo · tex; heap MB); `?quality=<0..2>` pins a level and turns the
  budget off. Tests (`test/wall-galaxy-budget.test.mjs`): steps down and back up, the doubling wait, the
  windows, the overlay lines, the sphere swap, and 36 tree-change + quality cycles leave the live geometry
  count flat (it fails when `setMembers` stops disposing). Hour proxy (`$RUN_DIR/shots/r23-hourproxy.txt`,
  10 min of `?demo=1` on the large demo, SwiftShader, 36 relayout swaps): geometries 22, textures 3, programs 8
  flat throughout; heap 7.4-10.7 MB, ended at 7.7; script 0.8-1.8 ms/frame; 0 errors. Filmstrip
  `$RUN_DIR/shots/r23-galaxy/sheet.png` (`?demo=1&perf=1`, 4x): the overlay steps L0 → L1 → L2 in the first
  ~10 s, as it should on the VM's software GL; script 4-18 ms/frame at 4x; 0 console errors. Stills
  `r23-still-q0`/`-q2` (`?at=hv1&quality=…`): the same scene, L2 only thinner dust and coarser spheres.
  **Note for filming rounds:** on this VM the budget always goes to L2 (SwiftShader frames are ~100+ ms), so
  films that judge looks should add `&quality=0` to see the tablet's level; leave it off to see the budget.
- [x] T11 (§7.A7) [ui] [variant:galaxy] Reduced motion (D5): no flights, no drift; the overview with every
  cluster folded and the caption rotating through the sites, trouble first, with `STILL_CAPTION_TIMING` —
  done when: a test with `prefers-reduced-motion` stubbed shows no `focus()` flight and the caption cycling,
  and a filmstrip with emulated reduced motion shows a still galaxy and changing captions.
  (commit dee4a91) `galaxy/still.js`: `prefersStill(matchMedia)`, `STILL_TOUR_TIMING` (flyMs 0, overview 8 s,
  each site's caption 12 s; demo 2 s / 3 s), `breathWave`/`dustTurn`. `createGalaxyCamera(galaxy, { still })`
  holds `overviewShot(sites, 0)` (no turn), ignores flights and opens nothing; `fit`/`focus` only move the
  tour, so `hud.js` shows each site's caption at once (`STILL_CAPTION_TIMING`) and the lock shuts round it
  where it lies on the overview. `createGalaxyScene(…, { still })` holds crit/warn halos and the crit nebula
  at their peak, the dust still. `<html data-motion="still">` marks it. Tests
  (`test/wall-galaxy-still.test.mjs`): 7 legs of frames all on one pose, no `setOpen`, trouble first; the
  caption order and `arriveMs` 0; halo opacity and nebula size constant (and at the moving one's peak).
  Filmstrip `$RUN_DIR/shots/r24-galaxy-still/sheet.png` (wrapper `$RUN_DIR/chrome-still.sh` =
  SwiftShader + `--force-prefers-reduced-motion`, `?demo=1&quality=0`): the galaxy never moves, captions go
  STORAGE (crit) → FEAT-SEARCH → REMOTE/CLOUD/HOME → overview → STORAGE; 0 console errors. Seen (for T19,
  worse here since the camera never leaves the overview): HV2, the crit site, lies under its own caption
  plate, and CLOUD under the far fleet block (its lock brackets land on the fleet line's text).
- [x] T12 (§7.C) [ui] [variant:galaxy] `galaxy/fx.js`: `parseFx(search)` (comma-separated, unknown names
  ignored, all off by default, D9) and the first effect, `lanes`: a light pulse along a hyperlane while a
  link between two sites is live — done when: a test covers `parseFx` (none by default, `?fx=lanes,bogus` →
  `lanes`), and two filmstrips, with and without `?fx=lanes`, show the pulse only with it.
  (commit 551ddc5) `galaxy/fx.js`: `FX_NAMES`, `parseFx` (also repeated `fx=`, any case), `LANES` timing,
  `siteRoutes(model, sites)`, `trackRoutes`, `pulseAt`, `routePath`. **Live** (decision: the large demo has
  no `live: true` link between sites, only flow events): a link with `live: true`, or one an event travelled
  (`event.link`, by id or `from>to`) less than 20 s ago by the model's `generatedAt`; one route per site pair.
  The pulse runs from the source star in along its hyperlane, through the sun, out to the target (no new
  line on screen), 4.8 s eased + 1.6 s rest, head + 7-sprite trail in `--text-1` grey at ≤ 0.6 opacity,
  additive: quieter than any nebula. Routes already running keep their place (max 6, no churn); a route the
  model drops lands its pulse first. Reduced motion: a still row of faint lights. `scene.js` takes
  `fx` (default off: no sprite made), `setRoutes`; `main.js` feeds it every model; `<html data-fx>`.
  Tests `test/wall-galaxy-fx.test.mjs` (10). Filmstrips `$RUN_DIR/shots/r25-galaxy-lanes/` and
  `r25-galaxy-off/` (`?demo=1&quality=0`, 0 console errors either); the pulse is small on the 12-frame sheet,
  so `$RUN_DIR/shots/r25-pulse/pulse-*.png` (probe `$RUN_DIR/tools/pulseprobe.mjs`, overview, 2x) show it
  on the HV1 → sun lane under the red/amber trouble; the probe logged routes `home>lab`, `lab>hv2`,
  `lab>cloud` coming and going with the demo's flow events. Meaning for `docs/wall.md` (E): "a grey light
  running between two systems: they are talking (a live link, or something just travelled it)".
- [x] T13 (§7.C) [ui] [variant:galaxy] `fx=comets`: a running job or deploy (the large demo's flow events)
  is a small comet with a tail from its builder to where it lands — done when: a test maps a flow event to
  a comet's start and end, and filmstrips with and without `?fx=comets` show it only with it.
  (commit b34858f) `galaxy/fx.js`: `COMETS` timing, `flowComets(model, drawn)`, `trackComets`, `cometAt`,
  `cometPath`. **Decision:** a comet is any event with `link` (the Map's own comet rule, docs/map.md), not
  only `kind: flow`; each end is the nearest drawn thing up the node's parents (a planet, else its site's
  star), so a comet runs planet to planet inside one system or across the galaxy. It flies **once** per
  event (key = event time + link; the next model's copy never re-fires), 3.2 s eased, on an arc lifted over
  the plane (30 % of its length, min 60) so it reads apart from `lanes` (which follows the hyperlanes
  through the sun); head 22-90 world units by length, 10-sprite tail, `--text-1` grey ≤ 0.55 opacity, in
  its hue only when the event itself is warn/crit (a failed deploy). Max 6 at once; events older than 10 s
  when first seen are skipped. Reduced motion: the whole arc, still and faint, for the time it would fly.
  `scene.js`: `setComets`, `drawn()`, pool only with `fx=comets`. Tests in `test/wall-galaxy-fx.test.mjs`
  (+7). Filmstrips `$RUN_DIR/shots/r28-galaxy-comets/` and `r28-galaxy-off/` (`?demo=1&quality=0`, 0
  console errors either); at 3.2 s per 12 s the 12-frame sheet catches none, so probe
  `$RUN_DIR/tools/cometprobe.mjs` (`FREEZE=0.5` holds comets mid-flight) logged one comet per demo flow event
  (`registry>k8s-1`, `ci>api-staging`, `db>storage`, …) and `$RUN_DIR/shots/r28-comet/comet-1.png`
  (`?at=none`, overview) shows a grey streak with a tail from HV1 toward CLOUD, quieter than both red
  nebulae. Script ms the same with and without (11.6 vs 12.7 avg at 4x). Seen: held on one system, a comet
  to another site leaves the frame at the top (its arc rises toward the camera); fine for a flight, but a
  reviewer may want a lower lift for cross-site arcs. With `fx=lanes,comets` a cross-site event shows both.
  Meaning for `docs/wall.md` (E): "a small grey comet: something just went from one machine to another (a
  push, a deploy, a backup); red or amber when it failed".
- [x] T14 (§7.C) [ui] [variant:galaxy] `fx=twinkle`: a planet with a working session twinkles softly (slow,
  low contrast, calm stays calm) — done when: a test picks the twinkling planets from a model (working
  sessions only), and filmstrips with and without `?fx=twinkle` show it only with it.
  (commit 187f6cf) `galaxy/fx.js`: `TWINKLE`, `workingPlanets(model, planets)`, `trackTwinkles`, `twinkleAt`.
  **Decision:** a working session is a `lane` or `session` node with status `working` whose tone is calm (a
  stuck one is warn, so it is trouble's to show; a `working` service, a runner on a job, is no session). It
  lights the nearest planet or star up its parents (in the demo: the builders BA/BB in HV1), once however
  many sessions. A planet whose own tone is trouble does not twinkle (it breathes already: one motion per
  thing). Look: one soft `--text-1`-grey light on the sphere (5x its radius), two slow waves (5.6 s and 3.7 s,
  each planet its own phase and a ±15 % pace by a salted hash of its id: unsalted, `builder:builder-a` and
  `…-b` hashed a hair apart and glimmered in step, seen in the probe and fixed), opacity 0.09-0.30 (a calm
  halo is 0.22, warn 0.8, crit 0.9), 1.2 s fade in and out as work starts and stops; a planet back while
  fading picks up from its light. Max 24. Reduced motion: steady at half its swing. `scene.js`:
  `setTwinkles`, `planets()`, `twinkles`, pool only with `fx=twinkle`. Tests in `test/wall-galaxy-fx.test.mjs`
  (+7). Filmstrips `$RUN_DIR/shots/r29-galaxy-twinkle/` and `r29-galaxy-off/` (`?demo=1&quality=0`, 0
  console errors either); the light is too small for the 12-frame sheet, so probe
  `$RUN_DIR/tools/twinkleprobe.mjs` (`HIDE=<css>` hides the caption for the shot) logged the lit sprites on
  the two builders and `$RUN_DIR/shots/r29-twinkle/twinkle-*.png` (`?at=lab&open=1`) show them. Script ms
  the same with and without (7.9 vs 6.8 avg at 4x, noise). Seen: at `?at=lab` both builders lie under the
  caption plate (T18), and they sit beside their lanes' amber dots, so the grey glimmer is subtle; a
  reviewer may want it brighter. The demo flips its sessions every ~4 s, so there the twinkles come and go
  more than a real fleet's would. Meaning for `docs/wall.md` (E): "a planet glimmering softly: an agent is
  at work on it".
- [ ] T15 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r8-film-ui.md 3) Trouble inside an open system is the
  smallest thing: a planet or moon in warn/crit is drawn at least the size of a calm planet, with its status
  shape (▲ ◆ ■) as a flat glyph facing the camera and its glow ring, and dust within the held system's `reach`
  fades to 20 % — done when: a test shows the trouble planet's radius >= a calm planet's and the dust fade
  factor inside/outside `reach`, and `?at=lab&open=1` shows the attention lanes clearly above the dust.
- [ ] T16 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r8-film-ui.md 2) The sun outshouts the trouble: core in
  the text-2 grey at 70 % of its radius, halo at most half the crit nebula's peak, dust depth-tested against
  it, and `siteShot` keeps the hub out of shot (behind the camera or under 15 % of the frame) — done when: a
  test checks the palette/halo ratio and that `siteShot` puts the hub under 15 % of the frame, and the
  overview still shows a red nebula brighter than the sun.
- [ ] T17 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r8-film-ui.md 4) The crit nebula is a flat disc: two or
  three offset billboards per nebula, stretched along the arm tangent, breathing at one period (crit only),
  brightness ordered by severity and age so the newest crit is hottest — done when: a test checks the
  billboard count/orientation from a site and that a newer crit has the higher peak, and the overview still
  shows two crits that differ in shape and brightness.
- [ ] T18 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r15-dreamer.md 1) The held system hides under its own
  caption plate: `siteShot` aims the star at the centre of the free rect (frame minus `hud.covers()`) and fits
  the distance so the open `reach` fits that rect (also fixes the Later line on reach past the bottom edge) —
  done when: a test shows the projected star and the open reach lie outside every `covers()` rect, and
  `?at=hv1&open=1` and `?at=hv2&open=1` stills show the star and the attention planet clear of the plate.
- [ ] T19 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r15-dreamer.md 2) CLOUD is missing from the overview (under
  the far fleet block): `overviewShot` offsets its look-at toward the sites' centroid until no site's folded
  box meets `hud.covers()` (in reduced motion too, where the overview is all there is and the plate is up
  most of the time: r24 saw HV2 under its own plate) — done when: a test shows every site's label is shown at the overview on the large
  fixture, and the overview still shows all five site names.
- [ ] T20 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r15-dreamer.md 3) At the overview, tie the far fleet line
  to the cluster it names: a thin hairline in the status hue from the line to the named site's cluster, drawn
  in once (~600 ms) and then still — done when: a test maps the fleet line's named site to the hairline's end
  points, and the overview still shows the line reaching the cluster.
- [ ] T21 (§7.C) [ui] [variant:galaxy] (reviews/r15-dreamer.md, unforgettable 1) `fx=beacon`: above each crit
  cluster a thin pillar of light rises from the plane, its height the crit's age (log scale, capped), calm
  clusters get none, so two crits are no longer twins — done when: a test maps crit age to pillar height
  (monotonic, capped, none for calm), and filmstrips with and without `?fx=beacon` show it only with it.
- [ ] T22 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r21-operator.md 8) The trouble planet's own name is too
  small at 3 m: the lock target's label while in trouble at the site step is caps at the site step's size
  (35 px on the tablet) — done when: a test shows `labels.js` gives the held trouble target the site-step size
  and caps (others unchanged), and `?at=hv2` shows `■ STORAGE` large beside the brackets.
- [ ] T23 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r21-operator.md 5) The banner repeats the caption: while
  the held lock target is the far fleet line's subject, the line steps down to the next problem (with `+N MORE`)
  — done when: a test with two problems shows the banner naming the second while the first is held and the
  first otherwise; do it in `hud.js` by choosing which model/problem is fed to `frame` (`frame.js` is fenced; if
  that cannot work, write the needed change under `## For the owner`).
- [ ] T24 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r26-skeptic.md 7) The overview turns, so every label moves
  for no reason (HOME at three places in three overviews): no turn at the overview (`overviewShot` fixed
  pose); depth comes only from the drift round a held system — done when: a test shows `overviewShot(sites, t)`
  gives one pose for any `t` (and the held drift still changes with `t`), and the filmstrip shows three
  overviews with every site name in the same place.
- [ ] T25 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r26-skeptic.md 8) Calm captions are lists nobody reads: a
  calm hold shows the kicker (`TARGET 04 / 05`, without `· SITE`) and the name only; a held site in trouble
  keeps its trouble lines and bars — done when: a test on `hud.js` (the lines fed to the caption) shows a calm
  leg with kicker + name and a trouble leg with its status lines; `?at=cloud` shows the short plate. If
  `captionLines` (`caption.js`, fenced) cannot give this, write the change under `## For the owner`.
- [ ] T26 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r26-skeptic.md 5) Dust looks exactly like data: grains as
  white and as large as the `apps-*` dots. Draw dust darker than any node mark (below `--text-3`), point size
  attenuated by distance and capped (~2 px) — done when: a test checks the dust colour is darker than the
  dimmest node colour in `paletteFrom` and the size cap, and `?at=hv2&open=1` shows no grain as bright as a dot.

## Research questions

- [x] Q7 → research/Q7-galaxy-map-ideas.md (thin sources, see the file's "not confirmed"). IDEAS: Strategy and space games' galaxy maps (Stellaris, Homeworld, Elite Dangerous' galaxy map,
  EVE Online's map, No Man's Sky's galaxy map): how do they show the state, trouble and activity of many
  systems at a glance, and how do they move the camera between systems? 2-3 concrete proposals for the
  galaxy (what it shows, what it means, a cost guess) the planner can turn into `fx` tasks — for Later (fx)
- [x] Q8 → research/Q8-alive-without-meaningless-motion.md (best: `fx=fade`; then `fx=miss`, `fx=pulse`). IDEAS: Sci-fi interface practitioners' write-ups (film and game UI studios) and data-art or
  generative pieces that show live systems (network traffic, infrastructure, sensor feeds): what would make
  a 3D fleet galaxy feel alive without moving meaninglessly? 2-3 concrete proposals (what, meaning, cost) —
  for Later (fx)
- [x] Q9 → research/Q9-threejs-integrated-gpu.md (thin: no measured iGPU numbers; adaptive pixel ratio is the main lever). three.js on an integrated Intel GPU (UHD G1, i3-1005G1) in Chromium at 2736x1824: draw-call and
  sprite budgets for 30-60 fps, instanced meshes vs many sprites, names as canvas-texture sprites vs a 2D
  overlay vs SDF text, how to measure script ms and GPU time per frame (timer queries), and how to avoid
  memory growth over hours (dispose rules, texture caches) — for T6, T10
- [x] Q10 → research/Q10-camera-paths.md (thin: no comfort threshold found). Camera paths in a 3D map: how games and data tools fly between points without passing through
  obstacles (the sun, other clusters), easing and duration rules, and how slow an orbit drift can be and
  still read as depth without causing discomfort — for T4 and the B polish (camera paths)
- [x] Q11 → research/Q11-cheap-glow-nebulae-storm.md (thin: no iGPU measurements; skip bloom, use baked additive sprites). Cheap glow and nebulae in three.js without a post-processing pass: additive sprites and
  billboards, noise in a fragment shader, the cost of a bloom pass on an integrated GPU, and how to make a
  "storm" (swirl, lightning flicker) cheaply — for T3, Later (`fx=storm`)

## Later

- §7.B (T3, builder r7) The overview turns 39° in 45 s (`overviewShot`, the sketch's 0.000015 rad/ms):
  in the filmstrip the turn reads as motion, not depth; and the dust grains look coarse when the camera is
  close (`?at=`).
- §7.B (T4, builder r11) At the tour's zoom an open system with many planets reaches past the frame's
  bottom edge (`siteShot` distance `max(560, reach * 1.9)`): fit the distance to the open reach and the
  aspect, or aim a little below the star; since T5 the far fleet block (bottom right, opaque) also covers
  that edge, so aim the held system above it.
- §7.B (r21-operator 7) In demo legs (`?demo=1`) the caption typing starts at flight midpoint, not on arrival,
  so a 4 s hold is readable under the throttle.
- §7.B (r21-operator 1, 2, 3 sharpen T18, T19, T17) T18's test also: with `?at=<site>` and the site in trouble,
  `screenOf(lockTarget)` lies outside every cover; T19 fits every site's folded box into the frame minus
  `hud.covers()`; T17: crit nebula at least 1.5x warn in size and brightness.
- §7.B (r21-operator "across") Night 1's trouble tile owned its area and read better from afar than a soft
  glow: check the nebula against it after T17.
- §7.B (r8-film-ui 5) Camera rhythm: the overview holds still ~2 s at each cycle's start, a status change at
  the overview gets a ~600 ms 5 % push-in before the leg, and the turn stops while the camera flies (T4's
  pacing, to tune after T4).
- §7.B (r8-film-ui 6) Overview composition is lopsided: sites sit left/low, the right third is empty; spread
  `armPoint` or offset `overviewShot`'s look-at to the sites' centroid; keep the bottom-right free for the fleet line.
  (T6, builder r14: one site, CLOUD, sits under the far fleet block at the overview, so its name is hidden.)
- §7.B (r8-film-ui 7) Folded calm systems read as lumpy spheres: below a screen-size threshold draw one
  sprite (core + faint halo), swap to spheres at `foldAt` > 0.3.
- §7.B (r8-film-ui 8) The open system is a wheel: drop the spokes (stem + ring say it), keep the orbit ring at
  text-3, give moons a short tether at half the stem weight.
- §7.B (r8-film-ui 9) Dust too coarse close up: point size attenuates with distance, capped ~2 px (same as
  the r7 line above).
- §7.B (r8-film-ui 1, hints for T5/T6) Type hierarchy: caption name, site name (condensed caps, short leader
  from the nebula, one baseline grid), planet name (mono lowercase, only when open); no fourth step.
- §7.B (r15-dreamer 4) The banner becomes wallpaper: rank crits by age, the newest takes the full slab, older
  ones drop to the second line (overlaps T17, T21).
- §7.B (r15-dreamer 6) The flight passes through the sun and the best frame says nothing: T16's hub-out-of-shot
  plus the flight arc over the plane (Q10).
- §7.B (r15-dreamer 7) No arrival beat in 3D: member labels fade in in orbit order from the star outwards, timed
  with the caption's `TYPE_MS` typing.
- §7.B (r15-dreamer 8) The open system reads as a debug view: rooms in the label face, services only as dots
  unless in trouble, drop the spokes (same as r8-film-ui 8).
- §7.B (r15-dreamer 9) The arms do not read as arms: thin the dust between the arms to ~20 %, brighten along
  each arm's spine in `dustPoints`.
- §7.B (r26-skeptic 1, sharpens T18) While a held site is in trouble, calm services and lanes are dots with no
  name; only rooms, builders and trouble get a name.
- §7.B (r26-skeptic 4, sharpens T16) Drop the sun's label to the planet step or remove it: the tag already names the hub.
- §7.B (r26-skeptic 6; also r8-film-ui 8, r15-dreamer 8) Remove spokes; landing ring becomes a tick at half the stem weight.
- §7.B (r26-skeptic 9) Clock at half size in text-3, date line gone.
- §7.B (r26-skeptic 10, = r8-film-ui 7) A folded cluster in trouble at the overview is its shape glyph at the site step, no lumps.
- §7.B (r26-skeptic 11) Hyperlanes grey at the dimmest weight; no status tint (nebula and label carry it).
- §7.C (r26-skeptic fx-lanes 1, 2) `fx=lanes` is invisible at 3 m and its meaning is unclear: pulse only links that
  changed state (went live / failed) in the last minute, with a faint tick at the arrival star so direction reads.
- §7.B Polish (tour pacing, camera paths, how far a system opens, nebula shapes and colours, the sun, the
  dust, type at 3 m): triage turns at most 3 findings per review into tasks; the rest land here.
- §7.C `fx=storm`: a crit nebula as a slow storm (swirl, flicker of lightning).
- §7.C `fx=lights`: feed `glow` colours its planet's halo in the light's real colour.
- §7.C `fx=rings`: feed `ring` (a print job) as a ring of light filling round its planet.
- §7.C `fx=arrive`: a short shockwave on the plane when the camera arrives at a system in trouble.
- §7.C New effects from Q7, Q8 and the dreamer persona (at most 4 a night).
- §7.D The idea hunt: Q7 and Q8 above; the planner turns their best proposals into `fx` tasks.
- §7.E `docs/wall.md` (what it is, a tablet in kiosk mode, the feed fields, every `fx` switch and what it
  means) and a Wall row in README's views table: after the `fx` tasks.
- Night-1 open shared bugs that may apply to `galaxy.html` (T31 pinch zooms the page, T39 `worstGapMs` a
  lifetime max in fenced `perf.js`, T57/T58 clock and caption): triage decides per review.

## For the owner

- (T7, built) `wall.html?variant=islands-tiles` needs two fenced files. `variants.js`: import
  `./variants/islands-tiles.js` and add `{ id: 'islands-tiles', label: 'Islands + tiles', mapOptions,
  optionsFor, ambient, links: islandsTiles.links }` (`links` is `'focus'`). `main.js`: import `focusLinks`
  from `./variants/tiles.js`, keep `heldSite` (set in `tour.onLeg` to `leg.kind === 'site' ? leg.id : null`,
  re-`map.update` the latest model when it changes) and pass `pick.variant.links === 'focus' ?
  focusLinks(model, heldSite) : model` to `map.update` (the sketch's `main.js.diff`, without its `?tilt`
  part and with the filter now pure). Until then the galaxy's no-WebGL redirect lands on radial.
- (T9) `lock.js` (fenced) could take a drawn radius: `lockGeometry({ kind, ns, side, t, r })` using `r` when
  finite, and `createLock`'s paint passing `r: sp.r` (the Map's `screenOf` has none, so wall.html is
  unchanged). Then `galaxy/lock.js` would shrink to `createLock(root, cam, …)` and its DOM copy could go.
- Filming (night 1, still open): `loop/film.mjs` (fenced) only runs here through the SwiftShader wrapper, so
  its fps is the VM's. Night 2 reports script ms per frame (T10); real fps needs the tablet.
- No wild-card layout question this night: the owner picked the galaxy (README §5), so the planner asked
  none.
- Round 5 (fix): the check after round 4 had one failure, `Error: socket hang up`, but the tail doesn't
  say which test. On 7a2110c, 17 full `npm test` runs came back green, so it doesn't reproduce. Round 4
  touched no server code (only `layout.js`, vendored three.js and their tests), so nothing was changed on a
  guess. A stress run (6 HTTP suites at once) does show load-timing flakes in `hub-boot.test.mjs:86`
  (builder still stale, 503) and `term-proxy.test.mjs:518` (ping timeout), but not this error. To make the
  next flake fixable, `loop/run.sh` (fenced) `check()` could add `✖` to the `TEST_TAIL` grep, take the
  lines after `failing tests:` rather than `head -40`, and save `$out` to `$RUN_DIR`.

- (r21-operator 4) Trouble waits ~95 s behind calm sites in each two-minute cycle. Fix needs `tour.js`
  (fenced): a hold-time option to `createTour` (calm a third of trouble's hold) and revisiting a trouble site
  between calm ones when several calm are queued. Without it the galaxy camera could shorten calm legs via
  `focus`'s zoom argument, which is a weaker fix.
- fx candidate (r15-dreamer): `fx=afterglow`: a cleared trouble leaves a faint outline ring in its old hue on
  the plane, cooling red → amber → grey over ~30 min (recent history; never filled, never pulsing).
- fx candidate (r15-dreamer): `fx=sweep`: once per tour cycle at the overview, one faint sensor sweep turns
  round the plane; a cluster pings only if new data came from its site since the last sweep (freshness).
- (`fx=beacon` from the same review became T21.)

## Reviews

- r8-film-ui.md: 9 findings + 3 m check, 3 became tasks (T15 trouble size = 3, T16 sun = 2, T17 nebula = 4);
  1 covered (T5/T6, hierarchy hint kept under Later), 5/6/7/8/9 under Later. No `fx` proposals. 3 m check: no
  (names missing, sun first).
- r15-dreamer.md: 9 findings + 3 m check (half yes), 3 became tasks (T18 held system under plate = 1, T19 CLOUD
  missing = 2, T20 fleet line hairline = 3); 4 covered by T17 (kept under Later), 5 covered (T12/T13), 6 covered
  (T16), 7/8/9 under Later. 3 `fx` proposals: `beacon` became T21, `afterglow` and `sweep` under For the owner.
- r21-operator.md: 8 findings + 3 m check (yes for what/where, no for every site), 2 became tasks (T22 trouble
  name size = 8, T23 banner repeats caption = 5); 1/2/3 covered by T18/T19/T17 (sharpened under Later), 6
  covered (T16), 7 under Later, 4 needs fenced `tour.js` (For the owner). No `fx` proposals.
- r26-skeptic.md: 11 galaxy + 3 fx-lanes findings + 3 m check (yes for what/where, no for every site), 3 became
  tasks (T24 overview turn = 7, T25 calm captions = 8, T26 dust = 5); 1/2/3/4 covered by T18/T23/T19/T16 (extra
  points kept under Later), 6/9/10/11 under Later, fx-lanes 1/2 under Later (fx-lanes 3 is praise: dropped). No
  new `fx` proposals.

## Scores

| round | persona | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|
| 8 | film-ui (galaxy) | 5 | 1 | 4 | 2 | 5 | 6 | 6 |
| 15 | dreamer (galaxy) | 5 | 6 | 6 | 2 | 5 | 5 | 6 |
| 21 | operator (galaxy) | 6 | 6 | 6 | 2 | 7 | 6 | 6 |
| 26 | skeptic (galaxy) | 5 | 5 | 6 | 2 | 6 | 4 | 6 |
| 26 | skeptic (fx-lanes) | - | - | - | - | 3 | 8 | - |

## Morning
