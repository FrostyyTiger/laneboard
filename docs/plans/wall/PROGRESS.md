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

- [ ] T1 (§7.A1) [ui] `public/js/wall/galaxy/layout.js`, pure, from `sketch/galaxy.js`: sites on two spiral
  arms (`armPoint(i, n)`), the dust band's points, a system's planets from the orbits layout
  (`variants/orbits.js`) with inclined orbits whose height stays within half the planet's distance from the
  star, and `foldAt(open, p)` folding a system to `CLOSED` (0.16) of its size; no DOM, no three — done when:
  `test/wall-galaxy-layout.test.mjs` shows arms are deterministic for one model, no two sites closer than a
  minimum, every height |y| <= 0.5 * distance, `foldAt(0)` = folded and `foldAt(1)` = open positions.
- [ ] T2 (§7.A2) Vendor three.js 0.170.0 from branch `sketch/wall-galaxy` as
  `public/vendor/three/three.module.js` with its MIT `LICENSE` beside it, served by the existing `/vendor/`
  fall-through — done when: a test (`test/wall-galaxy-vendor.test.mjs`) checks the file's `REVISION` is
  `'170'`, the LICENSE is there, and `GET /vendor/three/three.module.js` is served as JavaScript.
- [ ] T3 (§7.A1) [ui] [variant:galaxy] `public/js/wall/galaxy/scene.js` (sun, dust, far stars, hyperlanes,
  nebulae by worst status, planets, stems with their landing rings, from T1's layout; colours from a pure
  `paletteFrom(readVar)` over the status tokens) and the page `public/galaxy.html` + `galaxy/main.js` (fetch
  `/api/map`, `/ws` map frames with backoff as `main.js` does, `window.__wallPerf` from `perf.js` counting
  rendered frames), styles in `wall.css` — done when: a test covers `paletteFrom` and the nebula status
  mapping, `test/frontend.test.mjs` passes, and a still of `galaxy.html` on the large demo shows the sun, five
  clusters and a red nebula, with `__wallPerf.frames` growing.
- [ ] T4 (§7.A1) [ui] [variant:galaxy] `galaxy/camera.js`: the Map look-alike (`focus(id, zoom)`, `fit()`,
  `onDraw`, `screenOf`, `snapshotScene`) that flies the 3D camera from the overview to a system, opens it
  (T1 `foldAt` over `OPEN_MS`) while arriving, drifts slowly round it while held, folds it when leaving;
  `createTour` from `tour.js` drives it (trouble first) — done when: a test drives `createTour` with fake
  timers over the camera and sees the crit site focused first and `fit()` after the cycle, and a filmstrip
  of `galaxy.html?demo=1` shows overview → crit system opening → next system.
- [ ] T5 (§7.A1) [ui] [variant:galaxy] Caption, frame and clock on `galaxy.html` from `caption.js` and
  `frame.js` (vignette, clock, worst fleet line, tag), fed from `tour.onLeg` with `captionLines` as on
  `wall.html`; the sketch's own caption and clock are not ported — done when: a test checks `galaxy.html`
  has the ids `caption.js` and `frame.js` need and the module wires `onLeg`, and a filmstrip shows the name
  typing in at each arrival and the clock bottom left.
- [ ] T6 (§7.A1, §7.A3) [ui] [variant:galaxy] `galaxy/labels.js`: names that always face the camera, drawn
  over everything, plus a pure screen-space pass `placeLabels(boxes)` (priority: trouble, then site, then
  host/room, then the rest; lower ones hidden where they overlap); lanes named only in trouble or when the
  camera is close — done when: `test/wall-galaxy-labels.test.mjs` shows no two shown boxes overlap and a
  trouble name always wins, and a still of the busiest builder held shows no two names on top of each other.
- [ ] T7 (§7.A2) [ui] The 2D fallback modules from the sketch: `public/js/wall/variants/tiles.js`
  (`withTiles`) and `variants/islands-tiles.js`, plus the focus-only link filter as a pure function in
  `variants/tiles.js`; `galaxy/main.js` sends a browser without WebGL to `wall.html?variant=islands-tiles`.
  Registering the variant needs fenced `variants.js` / `main.js`: the diff goes to `## For the owner` — done
  when: `test/wall-tiles.test.mjs` covers the tile for a warn/crit place, none for calm, and the link filter
  keeping only the held site's links.
- [ ] T8 (§7.A4) [ui] [variant:galaxy] Live data in `scene.js`: a status change recolours and re-glows the
  same objects (no rebuild, no jump); a tree change (node added or gone) folds the cluster, re-lays it and
  opens it again; the camera never cuts — done when: a test shows `update()` with a status change keeps
  object identity and a tree change schedules fold → relayout → open, and a 30 s filmstrip on the large
  demo shows trouble coming and going with no jump.
- [ ] T9 (§7.A5) [ui] [variant:galaxy] The target lock (`lock.js`, with `lockTarget`) and the caption's
  trouble word on the 3D camera: `screenOf` projects the node, its screen size from its distance — done when:
  a test checks `screenOf` of a node at the camera's look-at is the screen centre and grows with zoom, and a
  still shows the four brackets closed round the trouble planet with the leader to the caption.
- [ ] T10 (§7.A6) [variant:galaxy] Speed: script ms per frame in `__wallPerf`-style stats and a `?perf=1`
  overlay (ms/frame, fps, `performance.memory` when there, renderer info: calls, geometries, textures); a
  pure `budgetStep(stats)` that lowers sphere segments, dust and star sprites when frames miss the budget;
  geometries and textures disposed on relayout — done when: a test covers `budgetStep` stepping down and back
  up, and an hour-proxy run (10 min of `?demo=1` on the large demo) shows renderer geometries/textures flat.
- [ ] T11 (§7.A7) [ui] [variant:galaxy] Reduced motion (D5): no flights, no drift; the overview with every
  cluster folded and the caption rotating through the sites, trouble first, with `STILL_CAPTION_TIMING` —
  done when: a test with `prefers-reduced-motion` stubbed shows no `focus()` flight and the caption cycling,
  and a filmstrip with emulated reduced motion shows a still galaxy and changing captions.
- [ ] T12 (§7.C) [ui] [variant:galaxy] `galaxy/fx.js`: `parseFx(search)` (comma-separated, unknown names
  ignored, all off by default, D9) and the first effect, `lanes`: a light pulse along a hyperlane while a
  link between two sites is live — done when: a test covers `parseFx` (none by default, `?fx=lanes,bogus` →
  `lanes`), and two filmstrips, with and without `?fx=lanes`, show the pulse only with it.
- [ ] T13 (§7.C) [ui] [variant:galaxy] `fx=comets`: a running job or deploy (the large demo's flow events)
  is a small comet with a tail from its builder to where it lands — done when: a test maps a flow event to
  a comet's start and end, and filmstrips with and without `?fx=comets` show it only with it.
- [ ] T14 (§7.C) [ui] [variant:galaxy] `fx=twinkle`: a planet with a working session twinkles softly (slow,
  low contrast, calm stays calm) — done when: a test picks the twinkling planets from a model (working
  sessions only), and filmstrips with and without `?fx=twinkle` show it only with it.

## Research questions

- [x] Q7 → research/Q7-galaxy-map-ideas.md (thin sources, see the file's "not confirmed"). IDEAS: Strategy and space games' galaxy maps (Stellaris, Homeworld, Elite Dangerous' galaxy map,
  EVE Online's map, No Man's Sky's galaxy map): how do they show the state, trouble and activity of many
  systems at a glance, and how do they move the camera between systems? 2-3 concrete proposals for the
  galaxy (what it shows, what it means, a cost guess) the planner can turn into `fx` tasks — for Later (fx)
- [ ] Q8 IDEAS: Sci-fi interface practitioners' write-ups (film and game UI studios) and data-art or
  generative pieces that show live systems (network traffic, infrastructure, sensor feeds): what would make
  a 3D fleet galaxy feel alive without moving meaninglessly? 2-3 concrete proposals (what, meaning, cost) —
  for Later (fx)
- [ ] Q9 three.js on an integrated Intel GPU (UHD G1, i3-1005G1) in Chromium at 2736x1824: draw-call and
  sprite budgets for 30-60 fps, instanced meshes vs many sprites, names as canvas-texture sprites vs a 2D
  overlay vs SDF text, how to measure script ms and GPU time per frame (timer queries), and how to avoid
  memory growth over hours (dispose rules, texture caches) — for T6, T10
- [ ] Q10 Camera paths in a 3D map: how games and data tools fly between points without passing through
  obstacles (the sun, other clusters), easing and duration rules, and how slow an orbit drift can be and
  still read as depth without causing discomfort — for T4 and the B polish (camera paths)
- [ ] Q11 Cheap glow and nebulae in three.js without a post-processing pass: additive sprites and
  billboards, noise in a fragment shader, the cost of a bloom pass on an integrated GPU, and how to make a
  "storm" (swirl, lightning flicker) cheaply — for T3, Later (`fx=storm`)

## Later

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

- (T7) `wall.html?variant=islands-tiles` needs two fenced files: the `VARIANTS` entry in
  `public/js/wall/variants.js` (with `links: 'focus'`) and the focus-only link filter in `main.js`; the
  sketch's `docs/plans/wall/sketch/main.js.diff` is the change. T7 builds the modules and tests; until the
  entry exists the variant falls back to radial.
- Filming (night 1, still open): `loop/film.mjs` (fenced) only runs here through the SwiftShader wrapper, so
  its fps is the VM's. Night 2 reports script ms per frame (T10); real fps needs the tablet.
- No wild-card layout question this night: the owner picked the galaxy (README §5), so the planner asked
  none.

## Reviews

## Scores

## Morning
