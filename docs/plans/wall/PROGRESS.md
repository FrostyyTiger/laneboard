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
- [ ] T9 (§7.2) [ui] Frame: vignette (edges darkened so text sits on quiet ground), a big clock
  bottom left, bottom right one line for the worst fleet problem (status colour and shape) and one
  ambient fact, a small tag top right; `public/js/wall/frame.js` with a pure `worstLine(model)` —
  done when: `test/wall-frame.test.mjs` covers the worst line (crit beats attention beats warn,
  calm fleet says so), and a filmstrip of `radial&demo=1` (the baseline for every direction) shows
  caption, lock, glow and frame together with fps at or over 27.
- [ ] T10 (§5) Map layout option: `createMap(el, { layout })` takes a layout function with the
  shape of `layout.js` `layout` (`{pos, center, kids}`), and `{ rings: false }` hides the ring
  circles, ring labels and bearing dial; both default off (the radial layout and today's drawing)
  — done when: `test/wall-map-layout.test.mjs` shows a custom layout places nodes where it says
  and rings off draws no dial, and every `test/map-*.test.mjs` passes unchanged.
- [ ] T11 (§5) [variant:radial] Today's constellation refined for a wall: spacing for 100-150
  nodes, line density, label sizes for distance (sites and rooms legible at the overview,
  services and leaves may be dots), in `public/js/wall/variants/radial.js` — done when: a
  filmstrip `$RUN_DIR/shots/<round>-radial/` under the throttle shows site and room labels
  legible at the overview, trouble the loudest thing, the tour visiting it first, fps >= 27.
- [ ] T12 (§5) [variant:orbits] The rings as ellipses that use the full width; sites as planets
  with their rooms in orbit around them, in `public/js/wall/variants/orbits.js` (a pure layout
  through T10's option, `rings: false` plus its own orbit lines) — done when: a test checks the
  layout fills the screen's aspect (no node outside the frame, width used); a filmstrip
  `$RUN_DIR/shots/<round>-orbits/` shows the tour, caption, lock and trouble first, fps >= 27.
- [ ] T13 (§5) [variant:islands] Each site its own cluster laid out across the screen, links between
  sites as long arcs, the camera touring island to island, in `public/js/wall/variants/islands.js`
  — done when: a test checks islands do not overlap and fill the aspect; a filmstrip
  `$RUN_DIR/shots/<round>-islands/` shows the tour, caption, lock and trouble first, fps >= 27.
- [ ] T14 (§5) [variant:wild] The wild-card direction from Q5's answer (named after it), in
  `public/js/wall/variants/<name>.js`; waits for Q5 — done when: a test checks its layout's main
  property (from the research), and a filmstrip `$RUN_DIR/shots/<round>-<name>/` shows the tour,
  caption, lock and trouble first, fps >= 27.
- [ ] T15 (§2, §5) [variant:radial] (r9-film-ui #2, #7) Type hierarchy and stable labels: three steps
  from mm via `devicePixelRatio` (Q3): sites condensed semibold caps for 1.5-2 m, rooms one step
  down, services/leaves/lanes unlabelled at the overview (named only when the camera is in that
  site); each label pinned outward from its node and not re-placed while on screen — done when: a
  test checks the label-size function (site > room, mm to px) and a label's side stays fixed
  across two draws; a still and a filmstrip show no overlapping or hopping labels. Option on the
  Map defaults off.
- [ ] T16 (§2) [variant:radial] (r9-film-ui #3) Trouble is the loudest thing: at the overview a crit
  node is the only saturated area (halo a few node radii wide, via T8's glow layer), attention in
  lanes stays at mark size and does not outshout a crit elsewhere — done when: a still of the
  large demo during the crit window shows the crit as the first thing the eye lands on (reviewer
  check), and a test checks the halo size ranks crit > attention > warn.
- [ ] T17 (§5) [variant:radial] (r9-film-ui #4) Overview fit and safe area: fit to the bounds of the
  drawn nodes and labels, not the outer ring; safe area 8 % top/bottom, 6 % sides; top-left
  caption area kept clear — done when: a test checks no node or label lies outside the safe
  area at 3:2 and 16:9, and the still no longer touches the top edge.
- [ ] T18 (§5, T10) [variant:radial] (r9-film-ui #5) Wall hides desk chrome: ring legends and lane
  pips off (with `rings: false` from T10, option defaults off); the bearing dial stays — done
  when: a still shows no ring legend or pip, dial still drawn, and `test/map-*.test.mjs` pass unchanged.
- [ ] T19 (§5) [variant:radial] (r9-film-ui #6, #8) Less ornament: calm services plain dots with no
  halo, rooms one ring, halo only on the focused node and nodes in trouble; room-to-service
  edges short stubs at the overview, full fan only when the camera is in that site — done when:
  a still shows no halo on calm services and no hairball at `hv1`; option defaults off, map tests unchanged.
- [ ] T20 (§2 north star 1) [ui] [variant:radial, all] (r14-operator #1) Caption reads at 3 m: on a
  trouble site the trouble word (`STORAGE FULL 97%`, condensed, status colour, ~180 device px cap at
  the tablet's 2x, per Q3) is the biggest text on the plate, the site name under it at the 1.5 m step
  (~95 px); HARDWARE/WHERE/HOLDS drop to a small step below a gap on trouble sites; calm sites keep
  today's order — done when: `test/wall-caption.test.mjs` checks the step sizes (trouble > name) and
  the order for a trouble and a calm site; a filmstrip frame shows the trouble word legible and not cut off.
- [ ] T21 (§2, T9) [ui] [variant:all] (r14-operator #2) The fleet line is big: in T9's `worstLine`, while
  anything is crit the bottom-right line is set at the 3 m step (`■ HV2 · STORAGE 97% FULL`) with a
  `+2 more` count under it, always on, also when the camera is not in a trouble site. Build T9 before
  T7/T8 if the loop allows — done when: `test/wall-frame.test.mjs` covers the text, count and
  step for crit, attention-only and calm; a filmstrip frame of an overview and of a calm-site visit shows it.
- [ ] T22 (§2) [ui] [variant:all] (r14-operator #5) Caption status is a severity count and names the
  worst three: `1 crit · 5 attention`, then the worst problem, then the next two, one per line at the
  1 m step (today "6 of 41 in trouble" names one) — done when: `captionLines` test covers a site with
  1 crit and several attention nodes (counts and three named lines, worst first).
- [ ] T23 (§2) [ui] [variant:all] (r14-operator #6) No dead plate: on a trouble site the trouble word
  shows at once with the plate (untyped), only the site name types; the plate grows with its lines
  instead of starting at full height; in demo timing the typing starts during the last 0.5 s of the
  flight — done when: a filmstrip frame at the start of a hold shows the trouble word and no empty
  plate; the pure part (plate height from line count) is tested in `test/wall-caption.test.mjs`.
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

## Reviews

- r9-film-ui.md: 9 findings, 5 became tasks (T15-T19: #2+#7, #3, #4, #5, #6+#8); #1 covered by T5 (phrasing
  to owner), #9 covered by T9; hiding lanes and dial redesign went to the owner.
- r14-operator.md: 9 findings, 7 became tasks (T20-T26: #1, #2, #5, #6, #7, #8, #9); #4 halo part covered
  by T16; #3 and the overview-labels part of #4 went to the owner.
- r20-skeptic.md: 17 findings, 4 became tasks (T27-T30: #1, #3, #4, #8); covered: #7 (T20/T22), #9 (T23),
  #14 (T16), #16 (T15), #17 (T16); #2, #5, #6, #10, #11, #12, #13, #15 went to the owner (taste or plan change).

## Scores

| round | persona | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|
| 9 (radial) | film-ui | 3 | 2 | 4 | 1 | 4 | 6 | 6 |
| 14 (radial) | operator | 3 | 3 | 5 | 2 | 5 | 5 | 6 |
| 20 (radial) | skeptic | 3 | 3 | 4 | 1 | 5 | 3 | 6 |

## Morning
