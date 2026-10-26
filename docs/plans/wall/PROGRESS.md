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
- [x] T15 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r8-film-ui.md 3) Trouble inside an open system is the
  smallest thing: a planet or moon in warn/crit is drawn at least the size of a calm planet, with its status
  shape (▲ ◆ ■) as a flat glyph facing the camera and its glow ring, and dust within the held system's `reach`
  fades to 20 % — done when: a test shows the trouble planet's radius >= a calm planet's and the dust fade
  factor inside/outside `reach`, and `?at=lab&open=1` shows the attention lanes clearly above the dust.
  (commit 99a7f86) `scene.js`: `memberRadius(planet, tone)` (a planet, or anything in warn/crit, at
  `SIZE.planet`; the rest dots), eased over `LIVE.recolourMs` (the sphere for the larger size, scaled), lit
  in its hue (`planetMat`) with its halo at the planet's `HALO.k`; `MARK_SHAPE` (warn ▲, crit ■, the labels'
  shapes) as a sprite in `--bg-canvas` on the sphere (0.6 of its width, `depthTest` off), growing in between
  `unfold` 0.25 and 0.6 (folded, the nebula and the site name carry it). `camera.js` `screenOf` reads the drawn
  radius (sphere × scale), `labels.js` already used `m.radius`. Dust: `DUST_FADE` (floor 0.2, full to 1.05×
  reach, back at 1.4×, min 160), `dustFade(dist, reach, open)` pure and the same sum in the dust shader
  (`onBeforeCompile`, two uniforms, no new draw). **Decision:** the distance is measured along the line of
  sight (`dustSightDist`: how far from the star a grain *looks*, at the star's depth): a 3D sphere left the
  grains on the arm behind the system bright right beside the ▲s (seen in the first probe). Since the held
  frame is mostly the system, holding one thins nearly all dust in view (probe: 1166 of 1295 grains on
  screen at 0.2, all 271 within 80 px of a mark); the overview is unchanged. Tests
  `test/wall-galaxy-trouble.test.mjs` (+8); the scene tests' fake canvases got `beginPath`/`moveTo`/… for
  the ▲ texture. Stills `$RUN_DIR/shots/r30-t15-lab/`, `r30-t15-hv2/` and probe `r30-t15-probe/mark-1.png`
  (`$RUN_DIR/tools/markprobe.mjs`, caption hidden by `HIDE`): at `?at=lab&open=1` the three attention lanes
  and two more are amber spheres with a dark ▲, the largest and brightest things in the system. Filmstrip
  `$RUN_DIR/shots/r30-galaxy/` (0 console errors): HV1's lanes as ▲ badges (frame 6), HV2's storage as a red ■
  (frame 11). Script ms the same (12.4 / 10.3 vs 11.5 / 12.9 avg at 4x, 40 s each). Seen: at `?at=lab` every
  trouble lane still lies under the caption plate (T18); a folded cluster flown past mid-tour shows its
  trouble lanes as planet-sized lumps (Later: r26-skeptic 10 / r8-film-ui 7); the 20 % dust is still visible
  as grains (T26 makes it darker and smaller).
- [x] T16 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r8-film-ui.md 2) The sun outshouts the trouble: core in
  the text-2 grey at 70 % of its radius, halo at most half the crit nebula's peak, dust depth-tested against
  it, and `siteShot` keeps the hub out of shot (behind the camera or under 15 % of the frame) — done when: a
  test checks the palette/halo ratio and that `siteShot` puts the hub under 15 % of the frame, and the
  overview still shows a red nebula brighter than the sun.
  (commit b4b3fd3) `palette.js` `sunCore` (= text-2); `scene.js` `SIZE.sun` 42 (70 % of 60), `sunHalo` 640
  (crit nebula 680), `SUN_HALO` 0.3 (crit nebula 0.85; a literal, the evaluation-time guardrail forbids reading
  `NEBULA`), the sun's light stays white (`palette.sun`). The dust was already depth-tested (PointsMaterial
  default; the test pins it). **Decision:** `siteShot` now sits on the sun's side of a held system, up, looking
  out across it (`SITE_SHOT`: jitter 0.7, sway 0.5 rad, speed as before), so the sun is behind and below the
  camera and lights the faces we see; the drift is a slow sway (≈2.6 min a swing, same start speed) instead
  of a full circle, since on a long touch hold the circle brought the sun round to the top edge.
  `world.sunRadius` feeds labels. Tests `test/wall-galaxy-sun.test.mjs` (+5): on the large fixture the
  sun's bright middle is 0 % of the frame for every site over 6 min, zoom 2.3 and 3.5, 3:2 and 16:9.
  Stills `$RUN_DIR/shots/r34-before-*` vs `r34-t16-{non,lab2,hv2}`: overview, the sun is a small grey point
  and both trouble nebulae outshine it; held, no sun in frame (before: a white disc cut at the top).
  Filmstrip `$RUN_DIR/shots/r34-galaxy/` (0 console errors; 2.6 fps is SwiftShader), script 12.4 ms avg at
  4x (was 11.5-12.9). Seen: the background of a hold is now the outer arm and the dark sky, quieter than
  before; `r34-t16-lab` caught a demo relayout mid-fold (a lumpy ball, the Later line); the caption plate
  still covers half of `lab` (T18).
- [x] T17 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r8-film-ui.md 4) The crit nebula is a flat disc: two or
  three offset billboards per nebula, stretched along the arm tangent, breathing at one period (crit only),
  brightness ordered by severity and age so the newest crit is hottest — done when: a test checks the
  billboard count/orientation from a site and that a newer crit has the higher peak, and the overview still
  shows two crits that differ in shape and brightness.
  (commit 2c12909) Pure `galaxy/nebula.js`: `armTangent(home)` (the derivative of `armPoint`'s spiral at a star),
  `nebulaLobes(id)` (2 or 3 lobes from the site's hash: a main lobe on the star 1.3 × the size long, 0.8-0.92
  across; side lobes 0.26-0.36 before/after on the tangent, off it by up to 0.16, turned 0.12-0.36 rad, 0.5-0.68
  of its strength; mirrored/turned texture so none repeat), `nebulaPeaks` (crits newest first: 1, then 0.12 per
  place down to a floor of 0.84, so the quietest crit (0.71) stays over warn (0.7); ties in `tourOrder`).
  **Decision:** the lobes are flat meshes in the galaxy's plane, not sprites: a sprite can only stretch in
  screen space, while a lobe on the plane keeps the arm's direction from any camera (always above the plane).
  `scene.js`: one shared `PlaneGeometry`, one material per lobe (+1-2 draw calls per site, no new texture);
  `s.since` is set when a site's nebula tone changes (the scene's clock), `rankPeaks` eases each `s.peak`
  over `LIVE.recolourMs` after every update (at once on the first). `s.nebulaSprite` is now the main lobe.
  First try was far too quiet (lobes inside the old radius, seen at a slant: the red at HV2 a thin smudge,
  `$RUN_DIR/shots/r35-t17-still`), so the lobes got longer and stronger; most of a lobe's light stays within
  0.42 × 680 of its star, its faint rim within 476 (rims meet only under 952 apart; the large demo's closest
  pair is 1116, test). Tests `test/wall-galaxy-nebula.test.mjs` (+6): lobe count and bounds, tangent against
  `armPoint`, the scene's lobes flat and on the tangent, `nebulaPeaks`, a newer crit hotter (eased, the older
  one steps down and back up), the large demo with lab crit too: two crits differ in shape and peak.
  Stills `$RUN_DIR/shots/r35-t17-still3` (overview: HV2 red, HV1 and REMOTE amber, each cloud lopsided along
  its arm), `r35-t17-still2` (two crits); filmstrip `$RUN_DIR/shots/r35-galaxy/` (`?demo=1&quality=0`, 4x,
  0 console errors; 1.6 fps is SwiftShader): frame 1 two crits of different shape, no jumps. Seen: close up
  (frames 2, 6, 9) a trouble site sits in a broad band of its hue under the plate (thinned to 30 % open);
  if a review finds it loud, the open thinning can go further. The newest-crit difference (1 vs 0.88) is
  subtle at the overview; r15-dreamer 4 (banner ranks by age) and T21 (beacon) carry age more strongly.
- [x] T18 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r15-dreamer.md 1) The held system hides under its own
  caption plate: `siteShot` aims the star at the centre of the free rect (frame minus `hud.covers()`) and fits
  the distance so the open `reach` fits that rect (also fixes the Later line on reach past the bottom edge) —
  done when: a test shows the projected star and the open reach lie outside every `covers()` rect, and
  `?at=hv1&open=1` and `?at=hv2&open=1` stills show the star and the attention planet clear of the plate.
  (commit b399ee0) Pure `galaxy/framing.js`: `freeRect(W, H, covers)` (the box beside the covers, 24 px off them,
  a circle fitting best; the whole frame when covers leave under a quarter), `panShot` (slides the camera, never
  turns it, so what was behind it stays behind), `fitDistance` (reach × 1.25 over the box's narrow half; 1.15
  was the least that held every large-demo system over a whole sway), `freeCentre`, `blendRect`, `unionBox`.
  `siteShot(site, now, view)` / `zoomedSiteShot(…, view)` frame in the box with a view, unchanged without.
  `createGalaxyCamera(galaxy, { free })` eases the box (450 ms), never a cut; `main.js` feeds it the caption
  plate, the fleet block and the tag, each remembered as the widest box seen, so the shot stays put from leg
  to leg. `hud.covers()` now has the tag too (`tagCover()`): names keep off it. Measured on the tablet frame
  (1368×912): plate up to 711×487, far fleet block 873×237, so the free box is right of the plate, above the
  fleet block, ~550×520 px: held systems are about half as large on screen as before, but whole and clear.
  **Decision:** a system needing the camera farther back than the hub is (reach > 0.33 of its distance from
  the hub; on the large demo only `lab`/HV1) is shot from outside looking in, steeper (`FRAMING.inward`,
  `inwardRise` 1.4): from the sun's side the camera hung over the sun (a 5 % white disc), looking in the hub
  is a small grey point at the top edge (test: < 2 % of the frame for every site over 6 min, T16 allows 15).
  Tests `test/wall-galaxy-framing.test.mjs` (6): every star at the box's middle and every open planet and the
  lock target inside the box (clear of all three covers) for every site at 0/40/160 s; the hub's share; the
  eased reframe. Stills `$RUN_DIR/shots/r36-t18-hv2`, `r36-t18b-lab` (`?at=…&open=1`): HV2 whole right of the
  plate; HV1's attention lanes and the lock brackets clear of the plate. Filmstrip `$RUN_DIR/shots/r36-galaxy/`
  (`?demo=1&quality=0`, 0 console errors); a probe over 60 s of the tour put every open system's star at
  (1093, 390), the box's middle. Seen: on HV1 the hub and its `DEMO-HOST` name sit at the top, just above the
  tag (the Later line on the sun's label, r26-skeptic 4, would quieten it); the fleet line is the loudest
  thing in calm holds, as §2.1 wants.
- [x] T19 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r15-dreamer.md 2) CLOUD is missing from the overview (under
  the far fleet block): `overviewShot` offsets its look-at toward the sites' centroid until no site's folded
  box meets `hud.covers()` (in reduced motion too, where the overview is all there is and the plate is up
  most of the time: r24 saw HV2 under its own plate) — done when: a test shows every site's label is shown at the overview on the large
  fixture, and the overview still shows all five site names.
  (commit b8b4dc0) New `galaxy/overview.js`: `fitOverview` slides the overview (`panShot`, never turns) and only
  if sliding is not enough stands it back (up to 1.6×), the least it can, until every site's star and one side
  for its folded name (labels.js `candidates`, at the site step) are 24 px clear of the covers. **Decision:**
  not "look at the centroid": a grid of slides/pulls, nearest first, covers the same need and any frame.
  The covers at the overview are the fleet block and the tag (the plate is hidden on an overview leg); in
  reduced motion the widest plate counts too (`main.js`, the kept boxes). `createOverviewFit` keeps a fit while
  it clears at half the gap, refits when it does not or the covers change, and **refits near the held fit**
  (first try: least change from none hopped the galaxy across the frame as the overview turned, 0.4 → -0.4);
  a new fit is flown to over 1.5 s, eased in and out (largest step over an hour of turn 18 world units per
  50 ms, ~4 px; ~37 refits an hour, ~1 ms each at 1x). `?at=overview` uses it too. Tests
  `test/wall-galaxy-overview.test.mjs` (6): the plain overview loses a site, the fitted one names all (real
  three camera + `placeLabels`); over 7 min of turn every site named, no jump; reduced motion with the plate;
  `fitShot` slides without turning; `siteMarks`; the camera asks the fitter only at the overview. Still
  `$RUN_DIR/shots/r39-t19-still` (all five sites and the sun named, CLOUD above the fleet block); filmstrip
  `$RUN_DIR/shots/r39-galaxy/` (`?demo=1&quality=0`, 4x, 0 console errors, 1.9 fps is SwiftShader): the three
  overviews name all five. Reduced motion probe: all five named. Seen: the overview's turn still puts each
  name somewhere else every time (T24); with T24's fixed pose the fit becomes one pose.
- [x] T20 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r15-dreamer.md 3) At the overview, tie the far fleet line
  to the cluster it names: a thin hairline in the status hue from the line to the named site's cluster, drawn
  in once (~600 ms) and then still — done when: a test maps the fleet line's named site to the hairline's end
  points, and the overview still shows the line reaching the cluster.
  (commit f1ae228) New `galaxy/tether.js`: `tetherSite(model, drawn)` finds the site `frame.js worstLine` names
  (its node by label and status inside the named site; the site alone when it is the problem; null calm or
  outside any site), `tetherLine(box, star, t)` (pure), `tetherProgress` (eased out, `TETHER.drawMs` 600),
  `createTether` (one 1 px span at 0.7, scaleX from its left end, as the lock's leader; layer
  `#galaxy-tether` between the frame and the lock). **Decision:** it leaves the words from their top edge,
  above the shape when the place is left of it and above the word's own letters when right of it, never
  across the letters; from their left edge when the place is not above them; it stops 10 px short of the
  star's rim. Drawn on every line with a shape (warn too, not only the far step): tying word to place helps
  at any step. `main.js` shows it on an overview leg after `FLIGHT.ms` (at once on the first leg and in
  reduced motion), hides it on a site leg; the fade is by script over 400 ms (`--tether-k`), since wall.css
  may not transition over 120 ms (design guardrail). A new place named while it shows draws in again from
  the word. The words' box is read on a new model or resize, never per frame (test). `?at=overview` shows it
  at once. Also: the names now keep off the warn-step fleet line (`hud.js fleetCover`, read once per words):
  the film caught `CLOUD` running into `▲ REMOTE · OFFICE-PRINTER`, because `frame.js` gives a cover only
  at the far step. The overview fit (T19) still ignores the warn block (Later). Tests
  `test/wall-galaxy-tether.test.mjs` (5, on a real three camera at the overview: the far end is the named
  site's star, short of its rim) and +1 in `wall-galaxy-hud`. Still `$RUN_DIR/shots/r42-t20-still`
  (`?at=overview&quality=0`): a red hairline from `■` up to HV2. Filmstrip `$RUN_DIR/shots/r42-galaxy/`
  (`?demo=1&quality=0`, 4x, 0 console errors, 1.4 fps is SwiftShader): at 77 s the line is mid draw-in
  toward HV2; an earlier film showed it whole from `▲ HV1` (warn). Probe `$RUN_DIR/tools/r42-tetherprobe.mjs`:
  drawn on each overview leg, gone 400 ms into the site leg. Seen: in demo timing (4 s overview, 2.25 s
  flight) the line is up for only ~1.7 s per overview, so many sheet frames miss it; at real timing it holds
  ~17 s. The line can cross another site's name on its way (it is 1 px and under the names' halos).
- [x] T21 (§7.C) [ui] [variant:galaxy] (reviews/r15-dreamer.md, unforgettable 1) `fx=beacon`: above each crit
  cluster a thin pillar of light rises from the plane, its height the crit's age (log scale, capped), calm
  clusters get none, so two crits are no longer twins — done when: a test maps crit age to pillar height
  (monotonic, capped, none for calm), and filmstrips with and without `?fx=beacon` show it only with it.
  (commit cda1090) `fx.js`: `BEACON`, `beaconHeight(ageMs, tone)` (0 unless crit; 220 just begun → 900 at a
  day by log: 1 min 285, 10 min 444, 1 h 604, 6 h 771), `critAges(model, sites)` and `beaconAt`. **Decision:**
  the model has no "crit since", so a crit's age is the newest crit event on each node still in crit (a
  site's oldest such), else when the page saw the nebula turn crit (`s.since`), the older of the two. A
  pool of 8 pillars (a plane turned round its own axis to the camera, a core in a soft sheath thinning
  upward, additive, crit hue) with a tip light at the height, so two pillars compare at a glance. A crit
  that begins while the page looks rises over 1.4 s, eased; one already there on the first frame stands
  at once (it did not just begin, and `?at=` stills need it); it sinks when it clears; it dims to 0.3 while
  its system is open (the system is the loud thing then); reduced motion: no rise. Tests (+7 in
  `wall-galaxy-fx`): height monotonic/capped/none for calm-warn-low, `critAges` by spell, the rise, and the
  real scene (pillar per crit site at its age's height, tip on top, none calm, dims open, sinks on clear,
  a page-dated crit grows). First still: 120 units was a ~45 px hairline lost in the nebula; raised.
  Still `$RUN_DIR/shots/r46-ov2` (`?at=overview&quality=0&fx=beacon`, hv2 crit): a red pillar with its
  tip above HV2, clear of the name. Filmstrips (`?demo=1&quality=0`, 4x, 0 console errors, 1.5/2.1 fps is
  SwiftShader): `$RUN_DIR/shots/r46-galaxy-beacon/` (3.7 s: pillars on HV1 and HV2; 9.4 s: dimmed inside the
  open HV2; 30 s calm: none) and `$RUN_DIR/shots/r46-galaxy/` without (no pillar). Seen: the demo's crits
  are seconds old, so its pillars are all near the floor; the height only tells apart at real ages
  (minutes to hours). The overview looks down steeply, so a pillar reads shorter than its world height.
- [x] T22 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r21-operator.md 8) The trouble planet's own name is too
  small at 3 m: the lock target's label while in trouble at the site step is caps at the site step's size
  (35 px on the tablet) — done when: a test shows `labels.js` gives the held trouble target the site-step size
  and caps (others unchanged), and `?at=hv2` shows `■ STORAGE` large beside the brackets.
  (commit 3718702) `labels.js labelFace(kind, tone, held)`: sites and the sun 'label', the lock's held target
  'label' while warn/crit, the rest 'mono'; `labelText(node, tone, face)` caps in the label face; the box is
  measured at the site step, so the pass places it as a site-sized name outside the brackets. A calm held
  thing keeps its mono name (the caption already carries it big). `shown()` adds `face`. Tests (+2 in
  `wall-galaxy-labels`): `labelFace` by case; on the large fixture the held `feat-search` turns
  `▲ FEAT-SEARCH` at the site step, unheld it stays mono, no other name changes face, nothing overlaps.
  Still `$RUN_DIR/shots/r47-still` (`?at=hv2&quality=0`): `■ STORAGE` in red caps beside the shut
  brackets, as large as `HV2`. Filmstrip `$RUN_DIR/shots/r47-galaxy/` (`?demo=1&quality=0`, 4x,
  0 console errors, 1.5 fps is SwiftShader): no frame lands on a held trouble system (holds are short in demo
  timing). Seen: the `■` glyph in the condensed face is as wide as two letters, as in the caption.
- [x] T23 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r21-operator.md 5) The banner repeats the caption: while
  the held lock target is the far fleet line's subject, the line steps down to the next problem (with `+N MORE`)
  — done when: a test with two problems shows the banner naming the second while the first is held and the
  first otherwise; do it in `hud.js` by choosing which model/problem is fed to `frame` (`frame.js` is fenced; if
  that cannot work, write the needed change under `## For the owner`). (commit 57762ee)
  `hud.js bannerModel(model, heldId)` (pure): the held node's problem (up to the topmost node in trouble above
  it, and all in trouble under that) reads `ok` in a copy, so `worstLine` names the next problem and counts
  `+N more` past the two; the model itself when nothing is held, the held thing is calm, the line names another
  problem anyway (masking it leaves the text the same), or there is no other problem. **Decisions:** at any step
  (warn too: the caption carries the held one at both); with one problem the line keeps it (never "all calm"
  while the caption says trouble); `+N more` does not count the held one (the caption shows it); the held id is
  the leg's `lockTarget` first, fixed for the leg as the caption and brackets are. The frame is fed again only
  when the model or the held id changes, before the caption shows. Since the stepped-down line is often at
  the warn step, where `frame.cover()` is null, `main.js freeBox` now also keeps the warn line's box
  (`hud.fleetCover()`, a fourth kept slot; the overview fit still reads the first three): the first still had
  `build-cache` under `▲ HV1 · FEAT-SEARCH`. Tests (+2 in `wall-galaxy-hud`): `bannerModel` cases and
  `createHud` with a fake tour (second named while the first is held, the first at the overview and when the
  other site is held, not re-fed for the same model). Stills `$RUN_DIR/shots/r48-still-hv2` (banner
  `▲ HV1 · FEAT-SEARCH · +3 MORE` under `■ STORAGE`) and `r48-still-hv2b` (after the fix and a demo tick:
  `■ HV1 · VM-C`, `+4 MORE`, the system clear of it). Filmstrip `$RUN_DIR/shots/r48-galaxy/` (`?demo=1&quality=0`,
  4x, 0 console errors, 1.3 fps is SwiftShader): held FEAT-SEARCH keeps `■ HV2 · STORAGE` (it was not the
  subject); no frame lands on held HV2 in demo timing.
- [x] T24 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r26-skeptic.md 7) The overview turns, so every label moves
  for no reason (HOME at three places in three overviews): no turn at the overview (`overviewShot` fixed
  pose); depth comes only from the drift round a held system — done when: a test shows `overviewShot(sites, t)`
  gives one pose for any `t` (and the held drift still changes with `t`), and the filmstrip shows three
  overviews with every site name in the same place.
  (commit a75ce49) Taken before T20 (round 41, builder): T20's hairline is drawn in once "and then still",
  which only holds on an overview that stands still. `overviewShot(sites, fov)` lost its `now`: one pose
  (the turn's old pose at 0, the one reduced motion and `?at=overview` already used), every caller updated.
  First film showed the overview still moving between legs: not the turn but the fit (T19) searching again
  from nothing whenever the covers changed (the widest fleet block grows as longer problems come). So
  `createOverviewFit` keeps the held fit while it clears new covers (half the gap, as before) and searches
  near it when not, and `main.js` gives the overview fit the far fleet block at its widest (`widestFar`:
  the line's computed max-width plus the block's padding, read once per new box). Tests: the camera's
  overview is one pose at 1 s, 1 min, 7 min, 1 h and back after a held site, whose drift still moves (camera
  test); the fitted overview identical over 7 min; covers grown 12 px keep the fit (fails on the old code);
  `widestFar`. Probe over 75 s of `?demo=1` (camera pose 1.4 per s, `$RUN_DIR/tools/r41-coverprobe.mjs`):
  every overview leg at the same pose (0, 4058, 3913), while the far block came and went. Filmstrip
  `$RUN_DIR/shots/r41-galaxy/` (`?demo=1&quality=0`, 4x, 0 console errors, 1.6 fps is SwiftShader): the
  overviews at 3 s and 49 s name all five sites in nearly the same places; the 3 s one was before the
  first far block was measured. **Decision:** the overview settles once per page life, eased over 1.5 s,
  when the first crit puts the far block up; a calm fleet's corner is not reserved (it would push the calm
  overview off-centre for words that are not there). The dust's own turn (once in 26 min, still.js) is kept:
  it moves no name.
- [x] T25 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r26-skeptic.md 8) Calm captions are lists nobody reads: a
  calm hold shows the kicker (`TARGET 04 / 05`, without `· SITE`) and the name only; a held site in trouble
  keeps its trouble lines and bars — done when: a test on `hud.js` (the lines fed to the caption) shows a calm
  leg with kicker + name and a trouble leg with its status lines; `?at=cloud` shows the short plate. If
  `captionLines` (`caption.js`, fenced) cannot give this, write the change under `## For the owner`. (commit ce47d92)
  `hud.js galaxyCaption(cap, kind)` (pure) cuts `captionLines` for the galaxy, so the fenced caption.js is not
  touched: a calm cap (no `mark`) keeps no lines; a numbered kicker drops its ` · SITE` at every step (the
  trouble kicker reads `CRIT · TARGET 01 / 05`); an unnumbered kicker (`SITE`, a still without a tour) keeps
  it, since it is its only word. The lock and the leader are unchanged (a calm cap had no trouble line before
  either). Tests (+2 in `wall-galaxy-hud`): calm → `TARGET 04 / 05` with no lines, crit → the same lines as
  `captionLines`; the hud feeds a parked calm leg the short plate and a crit leg trouble + status first.
  Stills `$RUN_DIR/shots/r51-still-cloud`, `r51-still-hv2` (`?at=…&quality=0`): `TARGET 04 / 05` over
  `CLOUD` and nothing else. Filmstrip `$RUN_DIR/shots/r51-galaxy/` (`?demo=1&quality=0`, 4x, 0 console errors,
  1.4 fps is SwiftShader): calm HV2/CLOUD legs short, FEAT-SEARCH and API-PROD keep the word, status, bars,
  facts. Seen: the short plate's bottom-right bracket sits a name's height below the name (plateHeight's
  bottom padding, caption.js fenced); it reads as a frame, left as it is. A demo fleet left by an earlier
  round was still holding :7795 (started 13:42); this round used it and did not stop it.
- [x] T26 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r26-skeptic.md 5) Dust looks exactly like data: grains as
  white and as large as the `apps-*` dots. Draw dust darker than any node mark (below `--text-3`), point size
  attenuated by distance and capped (~2 px) — done when: a test checks the dust colour is darker than the
  dimmest node colour in `paletteFrom` and the size cap, and `?at=hv2&open=1` shows no grain as bright as a dot. (commit 1dc9e7a)
  The dust was text-2, brighter than every node, and unbounded close up. `palette.js DUST_INK` (0.4 by the
  sun, 0.68 at the rim, from text-3 toward the ground): luminance 0.14 under the Wall tokens against crit
  0.21, the dimmest node colour today (T33), calm 0.41. `scene.js DUST_LOOK` caps `gl_PointSize` at 3 css px
  after the attenuation (a `dustCap` uniform at `min(2, dpr)`; T28 must update it with the ratio). Tests: the
  dust below every node colour by a clear step, wall tokens and fallback (palette); the compiled shader caps
  after the attenuation, the cap follows dpr 1/2/3 (budget). Stills `$RUN_DIR/shots/r52-before-hv2` vs
  `r52-still-hv2` (`?at=hv2&open=1&quality=0`): the grains that were as big and white as `cache`'s dot are
  specks now; `r52-before-overview` vs `r52-still-overview`: the band is fainter but its arms still read
  (first try at 0.45 dimmed it too far). Filmstrip `$RUN_DIR/shots/r52-galaxy/` (`?demo=1&quality=0`, 4x,
  0 console errors, 1.4 fps is SwiftShader). Seen, not this task: the red/yellow banner flip (T30) and, in
  `r52-still-overview`, CLOUD's name hidden behind the fleet block. The demo fleet on :7795 (started 13:42 by
  an earlier round) was used and left running.
- [x] T27 (§7.A6) [variant:galaxy] (reviews/r37-performance.md 1) The 19 nebula lobes and landing planes are
  `transparent` + `DoubleSide`, so three rebuilds their shader state twice per frame (~2.4 ms/frame at 4x, 56 KB
  of allocation): add `forceSinglePass: true` to both material constructors (`scene.js` lobes and system plane)
  — done when: a test builds the scene and a lobe's and a plane's `material.version` is the same after two
  `frame()` calls, and a 4x profile or `__wallPerf.scriptMs` is no worse (record before/after). (commit e5c2a17)
  `forceSinglePass: true` on the lobe and plane materials in `scene.js`. Test (`wall-galaxy-budget`): the
  fake renderer copies three r170's renderObject two-pass branch over the real scene; a lobe's and the
  plane's `version` stay put over two frames (they climbed 2 → 6 without the fix), and no transparent
  DoubleSide material in the scene lacks the flag. Browser, large demo, `?demo=1&quality=0`, 4x
  (`$RUN_DIR/tools/r53-version.mjs`, `scriptms.mjs`): before 19 materials climbing (24 → 46 in 3 s), 10
  programs, script 12.0/14.2/13.6 ms per frame over three 40 s windows; after 0 climbing, 8 programs,
  script 9.7/12.1/7.1 (SwiftShader-noisy, but no worse). Filmstrip `$RUN_DIR/shots/r53-galaxy/` (0 console
  errors, 1.8 fps is SwiftShader) and still `r53-still-hv1`: nebulae and the system plane look as before.
  The demo fleet on :7795 (started by an earlier round) was used and left running.
- [x] T28 (§7.A6) [variant:galaxy] (reviews/r37-performance.md 2) The budget has no lever on fill rate, the
  bottleneck of the tablet's iGPU at 2736x1824: give each `budget.js LEVELS` entry a pixel `ratio` (L0 2, L1 1.5,
  L2 1.25), have `scene.setQuality` call `renderer.setPixelRatio(min(dpr, ratio))` (resize only, no camera move;
  labels stay DOM), consider `antialias: false` at ratio ≥ 1.5, and add a `?ratio=` pin for filming — done when:
  a test shows each level's ratio is applied (capped by dpr) and `?ratio=1` pins it, and a still at L2 shows
  the same framing as L0. (commit 32277f2)
  `budget.js LEVELS` carry `ratio` 2 / 1.5 / 1.25; pure `pixelRatioFor(level, dpr, pin)` (min of the screen's dpr
  and the level's ratio or the pin) and `ratioPin(raw)` (`?ratio=` 0.5-4, else no pin). `scene.setQuality`
  calls `renderer.setPixelRatio` (three re-sizes the drawing buffer at the same css size: no camera move,
  labels are DOM) and moves the dust's device-px cap with it (T26's note); `scene.pixelRatio`, `__wallPerf.ratio`
  and the `?perf=1` line (`L2 ×1.25`) report it. **Decision:** `antialias` stays on at every level: it is
  fixed when the WebGL context is made, so turning it off would mean a new context and a full rebuild on a
  step, and at 1.25-1.5 on a 2x screen the MSAA is what keeps the hairlines from crawling. Tests (+3 in
  `wall-galaxy-budget`): the ratios, dpr cap and pin; the scene's setPixelRatio, dust cap and an unchanged
  camera pose/aspect at L1/L2/L0, no css re-size; the pin holds at every level; main.js wires `?ratio=`.
  Stills (2x) `$RUN_DIR/shots/r56-still-q0`, `-q2` (`?at=hv1&perf=1&quality=…`): same framing, every planet
  and name in place, overlay `L0 ×2` / `L2 ×1.25`; `r56-still-r1` (`&ratio=1`) shows `L0 ×1`. Filmstrip
  `$RUN_DIR/shots/r56-galaxy/` (`?demo=1&perf=1`, 4x, 0 console errors, 3.6 fps is SwiftShader): the budget
  steps L1 ×1.5 → L2 ×1.25 with no jump. SwiftShader single-frame times are too noisy to price the fill-rate
  saving; that needs the tablet. The demo fleet on :7795 (started by an earlier round) was used and left running.
- [x] T29 (§7.A6) [variant:galaxy] (reviews/r37-performance.md 3) Two forced layouts per frame:
  `hud.js tagCover()` reads `offsetLeft/Top/Width/Height` on every call (twice a frame), and `clientWidth/Height`
  are read in `scene.js resize()`, `labels.js draw` and `camera.js screenOf` after style writes. Cache the tag's
  box (re-read on resize or when the frame's text changes, as `frame.js` does) and the canvas size (one
  `ResizeObserver`) — done when: a test counts layout-property reads over several fake frames (tag box read
  once, none per frame after the first) and a 4x CDP run shows style recalcs/layouts near 1 per frame.
  (commit 059a37f) `galaxy/stage.js createStageSize(el)` reads the canvas's css size once and again only from
  one `ResizeObserver` (its callback runs after layout, so that read is free); without one (node fakes) it reads
  each call, as before. The scene keeps it (`stage` option) and gives `size()`; `scene.resize`, `camera.screenOf`,
  `labels.draw` (via `sizeOf(galaxy)`), the lock (`size: galaxy.size`), main's free box and overview fit read it.
  `hud.js` takes `size` too: the tag's box is re-read only when its text or the stage changes, the warn line's
  key uses the stage size instead of `innerWidth` (itself a layout read). Test `wall-galaxy-stage` counts reads
  over fake frames of the real scene, camera, labels and hud: canvas 2 reads at start, tag 4, none after; a text
  change re-reads the tag once; a fired observer re-sizes the renderer and the camera aspect. CDP, large demo,
  `?demo=1&quality=0`, 4x, 2x (`$RUN_DIR/tools/r37-metrics.mjs`, `$RUN_DIR/shots/r57-metrics-{before,after}.txt`):
  style recalcs/frame 3.37/2.65/3.04 → 1.73/1.80/1.12, layouts 2.05/1.29/1.69 → 1.30/1.25/0.63 (three 15 s
  windows each; what is left over 1 is the caption typing and the lock's writes). A viewport turned from
  1368x912 to 912x1368 mid-run (`$RUN_DIR/tools/r57-resize.mjs`) re-sizes the buffer and the aspect (1.5 →
  0.667). Filmstrip `$RUN_DIR/shots/r57-galaxy/` (0 console errors, 2.5 fps is SwiftShader): as before. The
  demo fleet on :7795 (started by an earlier round; its pid file is stale) was used and left running.
- [x] T30 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r43-stranger.md galaxy 1) The fleet line flips red ↔ yellow
  when a crit link clears and returns within seconds (builder-c "no contact for 19s" red, then yellow, then red
  again): from 3 m the loudest thing comes and goes. In `hud.js` (frame.js is fenced) hold a crit that cleared
  as the fed problem for one tour cycle, dimmed with "cleared Ns ago", unless a newer crit replaces it — done
  when: a test feeds crit → warn → crit within 20 s and the line never drops below crit meanwhile, and the held
  line ends one cycle after the crit clears for good; a film of `galaxy.html?demo=1` shows no red/yellow flip.
  (commit f4a5ee3) `hud.js`: `farNode(model)` (the far line's node), `heldModel(model, hold, now)` (a cleared crit put
  back at its status with the why `cleared 12s ago`, `agoText`), `CRIT_HOLD.minMs` 30 s. A crit that leaves the far
  line is held until the tour's first overview at least 30 s after it cleared (no tour: 30 s); the same crit back or
  a newer one takes the line at once. While held `#wall-frame .wall-fleet[data-held]`: the word at opacity 0.72,
  the why in `--text-2` (wall.css). **Second cause, found filming:** T23's `bannerModel` stepped the banner past the
  held crit to the next problem, a warn, so every visit to the crit system flipped the line red → yellow → red
  too. **Decision:** `bannerModel` now steps past a held problem only to one at the same step (crit → another
  crit), never down; repeating the caption is the lesser harm (T37 makes the banner smaller while the plate is up).
  Tests (+4 in `wall-galaxy-hud`, T23's fixture now has two crits): crit → warn → crit → ok → crit within 20 s stays
  crit; the hold ends at the overview past 30 s; a newer crit replaces it; no tour ends after 30 s; the CSS.
  Probe `$RUN_DIR/tools/r58-lineprobe.mjs` (fleet line every ~0.7 s, large demo, `?demo=1&quality=0`): before
  the bannerModel fix, warn at 48, 76, 96, 120 s between crits (`$RUN_DIR/shots/r58-flip/line.txt`); after
  (`$RUN_DIR/shots/r58-flip2/line.txt`), 170 s red throughout, `CLEARED` held twice, one 4 s warn
  at 116 s after the crit had been gone 46 s (a real clear). Still `r58-flip/held-2.png`: dimmed `■ HV1 · VM-C`,
  grey `CLEARED 6S AGO`. Filmstrip `$RUN_DIR/shots/r58-galaxy/` (0 console errors, 1.6 fps is SwiftShader).
  The demo fleet on :7795 (started by an earlier round) was used and left running.
- [ ] T31 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r43-stranger.md galaxy 2) Words sit on words: the clock
  "13:12" over the `thermostat` label and `printer-3d` planet in a parked view, "HOME" on the plate's bracket and
  above the clock, "DEMO-HOST" touching the tag. Add the clock block to `hud.covers()` (like the caption and the
  fleet block) and keep site labels out of the plate's and the tag's boxes — done when: a test shows no shown
  label box meets the clock, plate or tag box on the large fixture (`?at=home`, overview), and a still of
  `galaxy.html?at=home` shows the clock clear of every name.
- [ ] T32 (§7.B, §2.4) [ui] [variant:galaxy] (reviews/r43-stranger.md stranger 6) A hallway tablet falls asleep:
  `galaxy.html` never requests a Screen Wake Lock. In `galaxy/main.js` call `navigator.wakeLock.request('screen')`
  when present, again on `visibilitychange` to visible, never throwing (denied or missing is silent) — done
  when: a test with a fake `navigator.wakeLock` sees one request at start, a re-request after hidden → visible,
  and no error when it is missing or rejects. (Manifest and fullscreen: the owner decides, see For the owner.)
- [ ] T33 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r49-accessibility.md galaxy 1) Crit is the dimmest status on
  screen (4.98:1 on the canvas vs warn 12.5, calm text-2 14.2) and under protanopia the crit name drops to 3.36:1
  and the crit nebula is a dull olive smudge beside a bright warn cloud. On the Wall only (`html.wall` token
  override, `paletteFrom` reads it): lift `--crit` toward oklch 70 % (hue kept, about 7:1), raise the crit nebula's
  core lightness, and put the far banner's crit `■` and word on a `--p1` slab with `--bg-canvas` letters if
  `frame.js` markup allows it from `wall.css` — done when: a test on `paletteFrom` shows luminance of crit >=
  warn >= calm text-2 in the wall palette and crit text on `--bg-canvas` >= 7:1, and a protanopia still
  (`Emulation.setEmulatedVisionDeficiency`) of the overview shows the crit cluster brighter than the warn one.
- [ ] T34 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r49-accessibility.md galaxy 4) Planet and lane names in
  trouble are too small for low vision (15 css px on the tablet, thin amber strokes, 5.0:1 measured): in `labels.js`
  every warn/crit member of the held system gets at least the room step + 1 (20 px tablet) at weight 500 and a
  `--bg-canvas` plate (padding 0.2 em, opacity 0.85) instead of only the text-shadow halo; calm names stay at the
  room step — done when: a test shows `labels.js` sizes trouble members of the held system above calm ones, and
  `?at=hv1&open=1` shows `▲ ci-retry` and `▲ search ui` clearly larger than calm names, on a plate.
- [ ] T35 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r49-accessibility.md galaxy 3) The held caption does not follow
  a status change during its 25 s hold: `?at=hv1` showed `▲ ATTENTION · FEAT-SEARCH` and amber brackets for
  seconds after `vm-c` went crit (banner already `■ HV1 · VM-C`). In `hud.js`, when the held site's worst tone
  rises (warn → crit), re-feed the caption lines and the lock target at once (new kicker and hero word, no
  re-typing, brackets recoloured); a fall waits for the leg's end — done when: a test with a fake tour feeds a
  held site warn → crit and sees the caption lines and lock target updated at once, and warn ← crit unchanged
  until the next leg.
- [ ] T36 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r54-film-ui.md galaxy 3) The camera flies through clusters:
  film frames at 66.7 s (a blown-out amber/red cluster over the bottom-left quarter) and 44.9 s (HV2's nebula
  across half the frame) are the ugliest of the strip; §7.B says no flight through the sun or a cluster. In
  `camera.js flightPose` keep the path at least `1.5 × reach` from every star but the two ends (bend the arc
  up, as it already lifts by 0.18 of the hop) and fade nebula lobes and spheres whose screen size passes ~40 %
  of the frame height — done when: a test shows `flightPose` over every site pair of the large fixture never
  nearer than `1.5 × reach` to a third site's star, the ends unchanged and the path continuous, and a film
  of `galaxy.html?demo=1&quality=0` shows no frame filled by one cluster.
- [ ] T37 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r54-film-ui.md galaxy 1) Two headlines in every trouble
  frame: the caption hero `■ STORAGE` and the banner `■ HV1 · VM-C` have the same face, weight, hue and cap
  height (~130 px at 2x), so two crits read as equals although the camera chose one. In `wall.css`, while a
  caption plate is up (a state `hud.js` already knows; set an attribute on `#wall-frame` or `html`) the banner
  and its glyph drop to the caption's name size (`--cap-name`); at the overview, with no plate, it keeps
  today's size — done when: a test (hud) shows the attribute set while the plate shows and cleared at the
  overview, `wall.css` has the smaller banner rule under it, and `?at=hv2` shows the banner clearly below the
  hero while `?at=overview` is unchanged.
- [ ] T38 (§7.B, §2.1) [ui] [variant:galaxy] (reviews/r54-film-ui.md galaxy 2, fx beacon) Hard-edged dark
  boxes cut the soft world: the fleet block's ground slices HV2's nebula with a straight edge, the caption plate
  cuts the beacon's sheath flat (fx frame 10). In `wall.css` give both plates a feathered edge (`mask-image:
  linear-gradient(...)`, ~4 vmin falloff to transparent) or drop the ground for a text-shadow halo; the corner
  brackets stay as the only hard lines; the beacon's sheath fades to zero over its top 20 % (`scene.js`) — done
  when: a test pins the mask (or no ground) on both plates in `wall.css` and the sheath's tip alpha, and a still
  of `?at=hv2&fx=beacon&quality=0` shows no straight cut through a nebula.

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

- §7.B (T20, builder r42) At the warn step the fleet line has no `frame.js` cover, so the overview fit (T19)
  does not keep sites clear of it; the names now step aside (`hud.js fleetCover`) but a star can still sit
  under the words. Feed the fit the warn block too (main.js `kept[1]`), widest seen.
- §7.B (T3, builder r7) ~~The overview turns 39° in 45 s~~ (done: T24, no turn); the dust grains look
  coarse when the camera is close (`?at=`).
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
- §7.D (r31-touch 1, 3, 4, 7, 8, 9, 10, 11, fx notes; for night 3's explorer) Hit-test in screen space over
  `screenOf` discs of 48 css px, not raycasts: at the overview hits resolve to sites only (label counts as
  target); in a held system pick the worst status then the nearest, a fan of name chips on a tie, trouble
  labels join their planet's hit area; during a flight resolve at `pointerdown`, sites only, members once open
  ≥ 0.85; one `pointerdown` on the stage, brackets within 100 ms, a ring where an empty tap lands; tap on
  empty space goes back one level, plus a 56 px corner button while exploring; ignore multi-pointer or
  contact > 120 px, a tap is `pointerup` within 300 ms and 12 px; 60 s countdown line then `fit()`; ease
  drift to 0 over 400 ms on touch; comets/lanes take no hits and a new comet waits while a finger is down;
  tap feedback is brackets, never brightness. Next/step order = `tourOrder` (trouble first).
- §7.B (r31-touch 3) Trouble planets in a held system sit 10-25 css px apart (under one fingertip): spread the
  orbit layout so trouble members are at least ~48 px apart at the tour's zoom.
- §7.A6 (r37-performance 4) `scene.js setOpen` re-places every site per call (up to 3 full `place()` passes a
  frame in flights): set `s.open` and dirty only, place once in `advance()`; `foldAt(k, p, out)` writes into a
  passed object, hoist the `push` closure.
- §7.A6 (r37-performance 5) Every socket message runs `galaxyLayout(nodes)` before the tree key is compared
  (~1.7 MB, ~7 ms per message): compute `treeKey` first, recolour by id on an unchanged tree, reuse one scratch
  array in `orbits.js arrange`'s `at()`.
- §7.A6 (r37-performance 6) The loop draws at display rate all day: a `frameCap` in `galaxy/main.js` (60 during a
  flight or open/fold, 30 otherwise), `budget.js` judging against the cap in force (§2.4 no heat).
- §7.A6 (r37-performance 7) `labels.draw` rebuilds arrays, Sets and `labelSize` per frame (1.68 ms at 4x): memoise
  `labelSize` by `text|px|face`, reuse arrays, skip the pass when pose, `world.version` and `unfold` are unchanged.
- §7.A6 (r37-performance 8) At the overview every folded calm member is still a mesh (220 calls vs 36-56 held):
  hide calm members' mesh and halo while `s.unfold === 0` (trouble keeps its halo); later an `InstancedMesh` per tone.
- §7.E (r43-stranger 1) README never names the Wall and `docs/map.md` points into the plan: the planned
  `docs/wall.md` and README views-table row must give `galaxy.html` / `wall.html`, URL flags (`?at=`, `?open=`,
  `?fx=`, `?perf=`, `?quality=`), kiosk setup, `glow`/`ring`, and how to stop the tour; map.md should say which page
  paints `glow`/`ring`.
- §7.B (r43-stranger 2) `wall.html?variant=galaxy` silently loads radial: redirect to `galaxy.html` (as
  `fallback.js` goes the other way) and show "unknown variant, showing radial" briefly on the tag.
- §7.C (r43-stranger 3) The galaxy paints neither `glow` nor `ring` (wall.html does): = `fx=lights` / `fx=rings`
  above; a stranger's first wish, so build them early. Keep the tint under trouble so a lamp never reads as alarm.
- §7.B (r43-stranger 7 of galaxy 2-3) Plate cut off mid-row and typing cursors in stills are the plate caught
  mid-grow at throttled fps (T5 saw it settled): size the bracket to the full plate before typing starts.
- §7.B (r43-stranger galaxy 5, 6) Empty frames between legs (shorter fly-outs or keep the overview up); the
  overview is small (five sites in the middle third, no counts per site).
- §7.A (r43-stranger 4) A hub answers 404 to `POST /api/map/feeds` while map.md promises 201/409: a clear
  405/409 naming the ssh forced command, or serve it. Server work, outside the Wall.
- §7.D (r43-stranger 5; = r31-touch) `?at=` is the only way to stop the tour and nothing handles touch: night 3.
- §7.B (r49-accessibility 2) No way to turn motion off for a shared wall: `?motion=still|full` in `galaxy.html`
  overriding `prefers-reduced-motion` (`still.js prefersStill`), documented in `docs/wall.md`'s kiosk section;
  during a flight thin the near-plane dust. Comets (fx) share the vection concern in miniature.
- §7.B (r49-accessibility 5) The status shape on a sphere is a dark cut-out (crit ■ measured 3.81:1, ~8 px; warn ▲
  ~6 px): draw it as an outline ring/frame in its hue at 1.6x the sphere's radius instead.
- §7.B (r49-accessibility 6) In reduced motion the banner flips red ↔ amber every few seconds: hold its tone for one
  caption rotation (12 s); T30 holds a cleared crit.
- §7.B (r49-accessibility 8) In still mode a new crit should cut the caption rotation (next caption is that site, at once).
- §7.C (r49-accessibility fx) `fx=beacon`: brighten the pillar's core toward white at the base so it carries in
  greyscale/protanopia (after T33).
- §7.B (r54-film-ui 4) The caption arrives before the camera: start the caption at flight progress ~0.9 and draw
  the leader only after the name has typed (`hud.js`).
- §7.B (r54-film-ui 5) The status glyph `■` is a slab off the baseline: size it to the cap height (0.7em), on the
  baseline, gap 0.22em (caption hero and banner).
- §7.B (r54-film-ui 6) Two type scales: caption/frame sizes in vmin steps beside `type.js` steps; set `--cap-*` from
  `stepsFor` at boot (extend upward 63, 84, 112).
- §7.B (r54-film-ui 7) Doubled marks and piled halos in `?at=lab`: `▲` on the sphere and in the label; keep one;
  members closer than a halo radius share one halo (overlaps r49-accessibility 5).
- §7.B (r54-film-ui 8) Calm holds waste half the frame: remember two plate boxes (calm, trouble) in `main.js freeBox`
  and frame a leg with the one its caption uses (`main.js` is fenced: the galaxy's own `main.js` is meant).
- §7.B (r54-film-ui 9) The held star is named twice (caption and label): hide its label while its caption is up.
- §7.B (r54-film-ui 10) The hub's name competes with the sites: mono caps at the room step, `--text-3` (= r26-skeptic 4;
  T31 covers the collision).
- §7.B (r54-film-ui 11) The overview is a constellation, not a galaxy since T26: faint arm ribbon at 4-6 % under the
  dust at `fit()` only (= r15-dreamer 9).
- §7.B (r54-film-ui 12) The tether ends ~45 px short of the banner glyph and crosses a hyperlane: land it on the glyph's
  top centre with a tick.
- §7.C (r54-film-ui fx) `fx=beacon` dims to the open level while the camera flies close to it (with T36).
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
- Round 40 (fix): the same unnamed `Error: socket hang up` came back after round 39 (third time this
  night: the tests score was 0.9997 after rounds 4, 31 and 39). Round 39 touched only client code
  (`public/js/wall/galaxy/*`, one Wall test). On e985d80 a full `npm test` came back 3880/3880 green,
  and four parallel runs of the 33 test files that use `node:http`/WebSocket/`net` came back green
  too, so nothing was changed on a guess. The `run.sh` change above is what would name the test.

- (r21-operator 4) Trouble waits ~95 s behind calm sites in each two-minute cycle. Fix needs `tour.js`
  (fenced): a hold-time option to `createTour` (calm a third of trouble's hold) and revisiting a trouble site
  between calm ones when several calm are queued. Without it the galaxy camera could shorten calm legs via
  `focus`'s zoom argument, which is a weaker fix.
- fx candidate (r15-dreamer): `fx=afterglow`: a cleared trouble leaves a faint outline ring in its old hue on
  the plane, cooling red → amber → grey over ~30 min (recent history; never filled, never pulsing).
- fx candidate (r15-dreamer): `fx=sweep`: once per tour cycle at the overview, one faint sensor sweep turns
  round the plane; a cluster pings only if new data came from its site since the last sweep (freshness).
- (`fx=beacon` from the same review became T21.)
- (r43-stranger 6) Kiosk: `galaxy.html` has no manifest (Android "Install app" installs the Board, `start_url: "/"`)
  and no fullscreen request. A Wall manifest (`start_url: "/galaxy.html"`, `display: "fullscreen"`, landscape) is
  a new file in `public/` and a `<link>`: say if wanted. Also (stranger 7): a read-only route for a wall screen
  does not exist; docs must say so or the hub needs one.
- (r49-accessibility 7) Screen readers get the typing, not the trouble: `caption.js` has `aria-live="polite"` on the
  letter-by-letter plate and the far fleet line has no live region. Needs fenced `caption.js`/`frame.js`: plate
  `aria-live="off"` while typing plus one visually hidden live node with the full text; fleet line `role="status"`,
  announcing only when subject or tone changes.
- (r54-film-ui, fx) `lanes`, `comets` and `twinkle` are invisible in every sheet and still, so they are calm but not
  effects. Idea: a comet's landing flashes the target planet once; a lane pulse brightens its hyperlane by a step while
  it passes. Taste question, not turned into a task: keep, rework or drop them?
- (r31-touch 5) The far fleet line's `+3 MORE` is 10 px mono: unreadable at 3 m and too small to tap. Making
  it a 48 px chip needs fenced `frame.js`; for night 3 a tap on the fleet line should also fly to its node.

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
- r31-touch.md: 11 galaxy + 3 fx findings (one each lanes/comets/twinkle) + 3 m check (yes for four of five
  sites, CLOUD missing), 0 became tasks: the touch explorer is night 3 (README §7, D4), so the input findings
  (1, 3, 4, 7-11, fx notes) are kept as one design note under Later; 2 covered (T18), 6 covered (T19), 5
  banner tap needs night 3 (its `+3 MORE` size is fenced `frame.js`: For the owner), 9 praise (palm/scroll
  safety already holds: dropped, keep it so); fx findings are all night-3 input rules (Later). No `fx`
  proposals.
- r37-performance.md: 8 galaxy findings + 3 m check (yes for what/where, no for every site; CLOUD missing = T19),
  3 became tasks (T27 forceSinglePass = 1, T28 pixel ratio lever = 2, T29 forced layouts = 3); 4/5/6/7/8 under
  Later. Memory flat (clean). No `fx` proposals; fx scores from code and films.
- r43-stranger.md: 7 stranger + 7 galaxy findings + fx note + 3 m check (mostly yes; HOME reads as the clock's
  label), 3 became tasks (T30 red/yellow flip = galaxy 1, T31 words on words = galaxy 2, T32 wake lock = stranger
  6); stranger 1/2/3/4/5/7 and galaxy 3/4/5/6 under Later (3 = `fx=lights`/`rings`), 6's manifest and 7 under For the
  owner, galaxy 7 covered (T27/T28/T29). fx note: judged together, scores are guesses, dropped. No `fx` proposals.
- r49-accessibility.md: 8 galaxy findings + fx notes + 3 m check (yes for what/where, no for site names; under
  protanopia the crit cluster loses to warn), 3 became tasks (T33 crit luminance = 1, T34 trouble name size = 4,
  T35 caption follows status = 3); 2/5/6/8 and the beacon note under Later, 7 needs fenced files (For the owner).
  No `fx` proposals. Flashing, reduced-motion film and calm-grey contrast checked fine: dropped.
- r54-film-ui.md: 12 galaxy findings + fx notes + 3 m check (yes; DEMO-HOST reads as a sixth site), 3 became
  tasks (T36 flight through clusters = 3, T37 two headlines = 1, T38 hard-edged plates + beacon tip = 2 and fx);
  4/5/6/7/8/9/10/11/12 under Later (10 = r26-skeptic 4, covered in part by T31), the lanes/comets/twinkle note
  under For the owner. No `fx` proposals.

## Scores

| round | persona | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|
| 8 | film-ui (galaxy) | 5 | 1 | 4 | 2 | 5 | 6 | 6 |
| 15 | dreamer (galaxy) | 5 | 6 | 6 | 2 | 5 | 5 | 6 |
| 21 | operator (galaxy) | 6 | 6 | 6 | 2 | 7 | 6 | 6 |
| 26 | skeptic (galaxy) | 5 | 5 | 6 | 2 | 6 | 4 | 6 |
| 26 | skeptic (fx-lanes) | - | - | - | - | 3 | 8 | - |
| 31 | touch (galaxy) | 6 | 6 | 6 | 2 | 6 | 5 | 6 |
| 31 | touch (fx-lanes) | - | - | - | - | 3 | 8 | - |
| 31 | touch (fx-comets) | - | - | - | - | 3 | 7 | - |
| 31 | touch (fx-twinkle) | - | - | - | - | 3 | 8 | - |
| 37 | performance (galaxy) | 6 | 6 | 7 | 2 | 6 | 5 | 6 |
| 37 | performance (fx-lanes) | - | - | - | - | 3 | 8 | - |
| 37 | performance (fx-comets) | - | - | - | - | 4 | 7 | - |
| 37 | performance (fx-twinkle) | - | - | - | - | 3 | 8 | - |
| 43 | stranger (galaxy) | 5 | 6 | 6 | 1 | 8 | 5 | 4 |
| 43 | stranger (fx-lanes) | - | - | - | - | 3 | 8 | - |
| 43 | stranger (fx-comets) | - | - | - | - | 3 | 8 | - |
| 43 | stranger (fx-twinkle) | - | - | - | - | 3 | 8 | - |
| 49 | accessibility (galaxy) | 6 | 5 | 5 | 2 | 7 | 6 | 6 |
| 49 | accessibility (fx-lanes) | - | - | - | - | 2 | 8 | - |
| 49 | accessibility (fx-comets) | - | - | - | - | 4 | 6 | - |
| 49 | accessibility (fx-twinkle) | - | - | - | - | 2 | 9 | - |
| 49 | accessibility (fx-beacon) | - | - | - | - | 6 | 7 | - |
| 54 | film-ui (galaxy) | 6 | 6 | 7 | 2 | 6 | 5 | 6 |
| 54 | film-ui (fx-lanes) | - | - | - | - | 2 | 8 | - |
| 54 | film-ui (fx-comets) | - | - | - | - | 3 | 7 | - |
| 54 | film-ui (fx-twinkle) | - | - | - | - | 2 | 9 | - |
| 54 | film-ui (fx-beacon) | - | - | - | - | 7 | 6 | - |

## Morning
