# Wall: progress

Night 4 (README §7 Night 4): the Wall's last night before its PRs merge. Night 3's open tasks (0a), one camera
director (A), the owner's unbuilt effects (0b), then the show interface (B), countdowns (C), half a screen (D) and
ready to merge (E). Night 3 is in `nights/night-3/` (its morning report says what stands), night 2 in `nights/night-2/`,
night 1 in `nights/night-1/`.

Notes for every builder round (planner, round 1):
- **Order** (README §7 Night 4 `Order:`): 0a first, the touch fixes (T1-T4), then `MANUAL · TOUR IN 0:40` (T5), then
  night 3's other open tasks in night 3's order (T6-T12); then A, the director (T13-T14), since it rewires touch and
  tour; then 0b, the effects (T15-T18), interleaved with triage's panel fixes. B, C, D and E did not fit the first 18
  tasks: they wait at the top of `## Later` **in that order**, and the replan takes them from there before anything
  else in Later. E is the merge gate: a replan with little room left takes E before C and D.
- **Read first** (README §7 Night 4): `docs/plans/product.md` and `docs/plans/cockpit/README.md` are on `main`, not on
  this branch: `git show origin/main:docs/plans/product.md`, `git show origin/main:docs/plans/cockpit/README.md` (§3
  C4 Show, C4b Canvas, §5 the demo). The Wall is the cockpit's first screen; product §3: every feature ships with
  demo data and lands with its doc page.
- **Not decided by the owner, so never a default**: a frame cap only behind `?cap=30` (off by default; Later); the r46
  taste questions (kicker `TARGET 02 / 05`, the calm plate's line, sun or hub name) stay under For the owner.
- **Effects are switches** (D9): `?fx=` names stay off by default. After T15 and T17 the list is `beacon`, `warp`,
  `afterglow`, `activity`, `sweep` (`fx.js FX_NAMES`, the comment at the top of `galaxy/main.js`, `<html data-fx>`).
- **Keep the palette and the speed** (owner, 2026-10-26, on the Surface Pro 7). Nothing added may make
  `galaxy.html?demo=1&fx=beacon&perf=1` slower there: judge by script ms per frame (`?perf=1`, `budget.js`), not by
  fps on this VM.
- **No Wall module is fenced**; `wall.html` keeps working and its tests stay green (it is still the default page of
  `wall.html`, radial). `loop/fenced.txt` is unchanged: the Map tests and `docs/plans/wall/loop/*` (so `film.mjs`)
  are fenced.
- **Guardrails** as before (`test/frontend.test.mjs`, `test/design-guardrails.test.mjs`): no `innerHTML`, no wholesale
  `style` attribute, no new sheet in `public/css/` (rules go in `wall.css`), colours from tokens (WebGL colours via
  `palette.js`), three.js by a relative path. DOM tests use `test/helpers/fakedom.mjs`; page tests drive pointer
  events on a fake clock as `test/wall-galaxy-touch.test.mjs` and `test/wall-galaxy-resume.test.mjs` do.
- **Filming**: `film.mjs` needs the SwiftShader wrapper (`nights/night-1/PROGRESS.md` lines 19-22):
  `CHROME=$RUN_DIR/chrome-swiftshader.sh node docs/plans/wall/loop/film.mjs --url
  'http://127.0.0.1:7795/galaxy.html?demo=1&quality=0' …` on `demo-fleet.mjs --size large` (`&pace=wall` for the
  real tour speed). Touch films: a CDP script with `Input.dispatchTouchEvent`, touchStart and touchEnd sent back to
  back (night 3 T14's note). Every film script closes its Chrome in a `finally` and writes its pid to `$RUN_DIR`
  (night 3 left orphaned Chromes at 250 % CPU twice).
- **Feed fields** (D3, product §3.3): `glow`, `ring` and from C `countdown` are generic node fields a feed sets; the
  galaxy paints them, the app ignores them. Demo data for each lives in `test/helpers/demo-hub.mjs` (the large
  fleet: `writeDemoMapLarge`, `createLargeLive`).

## Tasks

- [x] T1 (§7 Night 4 0a; was night 3's T36, r51-touch galaxy 2) [ui] [variant:galaxy] The sheet is not transparent
  to the finger: in `galaxy/main.js pick`, a point inside the plate's box (`hud.covers()`), the fleet line's box or the
  clock is never a star nor empty sky; a tap on a sheet row whose subject is a member opens that member
  (`openPlanet`), anywhere else on the plate does nothing — done when: a page test with a sheet up and a star under it
  finds a tap inside the plate's box opens nothing (no flight, no back step), and a tap on a member row opens that
  member. (commit 54e7f96) Builder r3: `touch.js coverHit` over `hud.covers()` and `hud.targets()` (caption.js
  `targets()`: the hero word and each problem row with its node id); anything on the words but a member row is
  `COVERED` (no flight, no back). CDP check on the large demo (`shots/r3-t1-taps`): plate corner and clock taps
  change nothing, a tap on the `STORAGE` hero opens `ROOM · IN HV2` with the camera kept. Seen while filming, for
  T9: the map's own `■ STORAGE` label still shows beside a planet sheet whose hero names it.
- [x] T2 (§7 Night 4 0a; was night 3's T38, r51-touch galaxy 4, fx-beacon 1) [ui] [variant:galaxy] The loudest
  thing is a target: a tap in the fleet line's box at the overview (and under a sheet, where T1 keeps it from being
  empty sky) opens its subject (the site, then the planet); `+N MORE` opens nothing yet; with `fx=beacon` on, the
  pillar's screen segment (foot to tip, 27 px wide) counts as its site's target in `touch.js tapPoints` — done when: a
  page test taps inside the banner box and sees the subject's site opened, and a test with `fx=beacon` finds a point
  on the pillar's top hits the site. (commit 20ec4f8) Builder r7: frame.js `data-subject`, hud.js `targets()` gives
  the line as a `step` row (its `+N more` first, no subject), touch.js `coverHit(…, open)` opens a step row's site
  first and its planet only while that site is `place.site`. The pillar: scene.js `beams()`, camera.js `screenAt`,
  touch.js `beamSegments`; "27 px wide" read as the finger's reach (`TAP.radiusPx` 27) either side of the segment,
  the same disc as everywhere else, swept foot to tip. CDP check on the large demo with `fx=beacon`
  (`shots/r7-t2-taps`): `+3 more` changes nothing, a tap on `HV2 · STORAGE` flies to HV2 with its sheet, a tap 6 px
  under the pillar's tip (278 px above the star) opens HV2. Seen: under HV2's own sheet the line echoes the plate and
  drops out (T20), so there the planet is reached by the plate's hero (T1), not the line. Film `shots/r7-galaxy`
  unchanged from r3/r4 (13 fps under SwiftShader as before; no per-frame work added, picks run on a finger's down).
- [x] T3 (§7 Night 4 0a; was night 3's T37, r51-touch galaxy 3) [ui] [variant:galaxy] Every trouble planet can be
  picked: in an open system (41 members in HV1 of the large fixture, all with a neighbour nearer than the 54 px disc)
  a tap whose disc holds two or more members fans them out on a ring of 48 px targets round the finger for the next
  tap (option (a) of the review; the builder may take (b), the sheet's trouble members as rows of at least 48 px, if
  (a) proves worse; say which and why in the notes) — done when: a test on the large fixture finds every trouble
  member of HV1 and HV2 reachable by some tap sequence of at most two taps, and fan targets are at least 48 px apart.
  (commit a5e46b6) Builder r8: option (a), `galaxy/fan.js`. Why not (b): the sheet names the worst and two more
  (caption.js MAX_LINES), so a fourth trouble planet would still need the scene, and (b) never reaches a calm planet;
  the sheet's member rows stay targets (T1). In an open system a tap whose disc holds two or more members
  (touch.js `hitAll`) opens none: they fan out as 48 px rows (60 px pitch) in two arcs round the finger, each row on
  the side and in the order its planet is, a leader from its inner end to its planet (followed every frame), a
  ring where the finger was; the next tap on a row opens that planet, a tap anywhere else, a drag/zoom, back or the
  tour closes it. The rows keep off the words (plate, fleet line, back): the fewest rows on them, then the least
  move (at most `FAN.shiftPx` 120), and when one arc is blocked every row takes the other arc. Test
  (`test/wall-galaxy-fan.test.mjs`): on the large fixture every member of lab (HV1, 41) and HV2, the trouble ones
  first, opens in at most two taps on the real camera; rows ≥ 48 px, ≥ 48 px apart, never on each other, on the
  stage. CDP check (`shots/r8-t3-fan`): a tap on `fix-login` in HV1 fanned 6 rows, the first pass put `search api`
  over the plate's `1 WARN` (fixed by the one-arc rule, `04-fan.png` now clear), a row opened `FIX-LOGIN`, a tap
  off the rows closed it, no console errors. Film `shots/r8-galaxy` as r7 (13.1 fps under SwiftShader; the fan
  draws nothing while closed). Open: in half a screen (D) long names may leave too little width for two arcs;
  the scene's own names of fanned planets stay visible beside their rows.
- [x] T4 (§7 Night 4 0a; was night 3's T29, r36-dreamer touch 3) [ui] [variant:galaxy] BACK returns to the pose you
  left: `goBack()` to the overview flies to the last explore pose (`touch.js` orbit yaw, pitch, dist, look) the person
  held before opening a site, not the default fit; only the first touch (wake) resets to the default — done when: a
  page test with a fake clock drags to a yaw, taps a site, goes back twice and finds the camera's orbit equal to the
  dragged one, and a wake still lands on the default fit. (commit fa7611b) Builder r10: `touch.js createReturn`
  (`leave(place, cam)` as a site opens, only off the overview and only a steered pose, `cam.want().kind === 'free'`;
  a fitted overview keeps nothing, so back without a drag is the fit as before), `camera.js fly(pose, { ms })` (a
  flight to a free pose, held there; nothing without `steer` or in still mode), `main.js toOverview(left.pose())` on
  the last step back (the back control and empty sky alike); `wake` and `resume` clear it. Tests
  (`test/wall-galaxy-resume.test.mjs`): drag → site → planet → back twice lands on the dragged orbit, flown not cut;
  no drag → the fit; a hand-back then a wake → the fit, and the pose forgotten. CDP check on the large demo
  (`shots/r10-t4-back`): drag, tap HV2, the back control: home pose equal to the dragged one (gap 0), the flight
  back mid-way reads, no console errors. Film `shots/r10-galaxy`: the tour as r8 (11.7 fps under SwiftShader vs
  13.1, VM load: nothing per frame added, the return is read only on a tap and a back). For T13/T14: the director takes `createReturn` over (its back step).
- [x] T5 (§7 Night 4 0a; night 3's Later r41-operator touch 1 = r36-dreamer touch 1 = r51-touch galaxy 5; research
  Q13) [ui] [variant:galaxy] Explore looks like a person is driving: while `touch.js` is in `explore`, a mono line by
  the tag reads `MANUAL · TOUR IN 0:40` (`--text-2`, the tag's face, counting down the time left of `IDLE.ms` from the
  last touch, whole seconds, reset by any touch; gone in the tour and while easing); at the overview in explore the
  back control reads `▶ TOUR` and hands back to the tour at once (`tour.resume()`, as the minute does) — done when: a
  page test on a fake clock sees no line in the tour, `MANUAL · TOUR IN 1:00` after the wake, `0:40` 20 s later, `1:00`
  again after a drag, the line gone at the hand-back, and a tap on `▶ TOUR` at the overview resuming the tour; a CDP
  still in explore shows the line, the tour's still does not. (commit 7e9255e) Builder r13: touch.js
  `idleLeft` + `manualLine` (whole seconds rounded up), `createTouch` `left()` and `handBack()` (a `'handback'` event:
  in explore the tour at once, the same `resume` as the minute's), `backControl(mode, place)` → `'back' | 'tour' | null`
  and `createBack` `show(kind)` with `BACK_WORDS` (`‹ Back`, `▶ Tour`, `data-kind`). One behaviour change, so the line
  can honestly read `1:00` after the wake: the minute now counts from the end of the first touch's 1.5 s ease, not the
  waking touch (Q13: a running flight is not idle); `test/wall-galaxy-resume.test.mjs` pins it. The line is its own
  `#galaxy-manual` under the tag (not inside it: the tag's box feeds the held-system framing's widest-seen covers),
  right-aligned at 6vw, the tag's mono face and tracking, `--text-2`, tabular digits; the back control moved down
  2.1vmin to `8vh + 8.6vmin` to make room. Both boxes are words for taps, names and the fan (`main.js touchCovers`).
  CDP check on the large demo (`shots/r13-t5-manual`): tour and easing no line, explore `MANUAL · TOUR IN 0:59`
  (SwiftShader's first frame lands a second late) with `▶ TOUR`, a site `‹ BACK`, back out `▶ TOUR`, its press hands
  back at once (camera to HV2, line and control gone), no console errors. Film `shots/r13-galaxy`: the tour as r10
  (11.9 fps under SwiftShader). Open for the director (T13/T14): `handBack` is the touch source giving up; and r11's
  "the tour's return as an event" (kicker types `TOUR`) is not built.
- [x] T6 (§7 Night 4 0a; was night 3's T31, r41-operator galaxy 3) [ui] [variant:galaxy] A passing crit keeps its
  shape colour: under `.galaxy-label[data-dim]` only the name text goes to `--text-3`; the status glyph (`■`/`▲`) keeps
  its tone hue (night 3's T15 greyed the glyph in flights: `■ HV2` grey beside its red nebula) — done when: a test
  pins in `wall.css` that a dimmed crit/warn label's glyph keeps the crit/warn colour while its name is `--text-3`,
  and a film of `galaxy.html?demo=1&quality=0` shows a red `■` on HV2 during flights. (commit 9ec5cff) Builder r14:
  the shape is the span's own mark, `data-glyph` drawn by `wall.css` `.galaxy-label[data-glyph]::before` with
  per-tone `::before` colours; the span's text is the word only, so `[data-dim]` greys the word and never the shape
  (`labels.js labelParts`; `shown()` still returns the whole `■ HV2`). Same rendered text and box as before. Tests in
  `test/wall-galaxy-arrive.test.mjs`. CDP check on the large demo (`shots/r14-t6-glyph`): over 45 s, 42 dimmed crit
  samples, every `::before` crit red while the word is grey, 0 grey marks, no console errors. Film `shots/r14-galaxy`:
  red `■ HV2` and yellow `▲ HV1` beside grey words in the flights (22 s, 25 s); 15.1 fps under SwiftShader.
- [x] T7 (§7 Night 4 0a; was night 3's T32, r41-operator galaxy 6) [ui] [variant:galaxy] No red without a name: in
  flights a nebula lobe that leaves the frame faster than its star must not show as a nameless red smear at the frame
  edge — `scene.js nearFade` also fades a crit/warn lobe whose projected centre is beyond ~1.5 reach of its star's
  anchor on screen — done when: a test on the large fixture finds, over `flightPose` samples, no lobe drawn at more
  than that distance from its label anchor, and a film of `galaxy.html?demo=1&quality=0&fx=warp` has no red blob at
  the edge without a label near it. (commit eaae256) Builder r15:
  the leash alone never bites in the large demo's flights (a lobe's centre swings out at most 0.54 of its nebula's
  reach), so r41's smear was a nebula whose star, and with it the name (labels.js names only stars in frame), had
  left the frame. `scene.js lobeLeash` (`LOBE_LEASH { from: 1, to: 1.5, edge: 0.25 }`) does both: a crit/warn lobe
  fades past 1-1.5 nebula reach (`LOBES.reach` of its size, on screen at the star's depth) from its star, and the
  whole nebula fades as its star comes within a quarter reach (at most a quarter of the frame's height) of the edge,
  gone as it leaves. The system flown to is leashed too (folded, it is still a red blob); the leash lets go as a
  system opens. Calm/low nebulae are untouched. Tests in `test/wall-galaxy-nebula.test.mjs`: over every flight of
  the large demo (lab crit, a cloud warn), no hued lobe in frame is drawn with its star out of frame or past 1.5
  reach, the overview unchanged. Film `shots/r15-galaxy-warp`: every red cloud has its `■` name beside it, no
  console errors, 11.7 fps under SwiftShader.
- [ ] T8 (§7 Night 4 0a; was night 3's T33, r46-skeptic galaxy 1) [ui] [variant:galaxy] The banner does not change
  subject with the camera: with more than one crit standing the banner (`hud.js bannerModel`, `frame.js`) names them
  in a fixed order (oldest first, `■ 2 CRIT · HV2 · HV1`, the reason line for the oldest), never picking the subject
  by where the camera is — done when: a test on a model with two crits gets the same banner text for every held
  site/camera position and the oldest crit's reason, and a film of `galaxy.html?demo=1&quality=0` (`--size large`)
  has no banner subject change while the fleet is the same.
- [ ] T9 (§7 Night 4 0a; was night 3's T34, r46-skeptic galaxy 2; after T8) [ui] [variant:galaxy] One headline with
  a second crit standing: the echo test (`hud.js bannerEcho`) is "the banner's line names the held problem", whatever
  else stands (then the banner shows the next problem or drops out), and `hud.named()` hides the planet's own label on
  every plate that names it, not only the first visit — done when: a test with two crits (HV2 STORAGE held, HV1 VM-C
  also crit) finds no banner naming STORAGE and no shown label for the planet while the hero names it, and a film
  frame at the second crit's target shows the hero once.
- [ ] T10 (§7 Night 4 0a; was night 3's T35, r46-skeptic galaxy 3 = r41-operator galaxy 8 = night 3 A4 feathered
  plates) [ui] [variant:galaxy] No dark rectangle over the galaxy: the banner's ground (the far cover) and the caption
  plate's ground are removed or become a feathered edge / text-shadow halo, so no star, nebula or label is cut flat by
  a box; the corner brackets stay the only hard lines — done when: a `wall.css` test pins no hard-edged opaque ground
  on `.wall-fleet` and the plate (halo or `mask-image` instead), `wall.html`'s caption tests stay green, and a still of
  `galaxy.html?at=overview&quality=0` with a site under the banner shows no step in the ribbon at the banner's edge.
- [ ] T11 (§7 Night 4 0a; was night 3's T39, r56-performance galaxy 1 = night 1's T39) [ui] [variant:galaxy] The
  stutter number moves: `budget.js createFrameWindow` keeps `worstMs` per window (reset each window, as `frameMs` is)
  and `perf.js` reports in `worstGapMs` the worst gap of the last ~10 s, with the boot gap apart as `bootGapMs` (gaps
  before the first model is drawn plus 2 s do not count); `wall.html` gets the same numbers (shared `perf.js`) —
  done when: a test with a fake clock, a 400 ms first gap and 16 ms gaps after it reads `worstGapMs` under 20 ms
  after 10 s and `bootGapMs` 400, and a film's `perf.json` (fenced `film.mjs` reads `worstGapMs` from
  `__wallPerf`) shows the windowed number.
- [ ] T12 (§7 Night 4 0a; was night 3's T40 and T41, r56-performance galaxy 3a and across) [ui] [variant:galaxy] Two
  small savings: member dots use a fixed 8x6 sphere segments at every quality level (`scene.js` `spheres`; 87k
  triangles and 205 draw calls with HV1 open against 13k and 45 at the overview), planets unchanged; and
  `galaxy/lock.js` writes the four bracket transforms and the opacity only when a rounded key (0.1 px, opacity to
  0.01) changed, as `labels.js` does — done when: a test pins the dot geometry's segment counts at levels 0-2 and the
  planets' unchanged, `?at=hv1&perf=1` reports fewer triangles than before (both numbers in the notes), and a test
  with a counting fake DOM sees no style write in a frame where the brackets moved under 0.1 px and a write when
  they moved more.
- [ ] T13 (§7 Night 4 A, D10) [ui] [variant:galaxy] One camera director, the state: a pure `galaxy/director.js`
  (`directorStep(state, event, now)` on an injected clock, as `touch.js touchStep`) with three sources `tour`, `touch`
  and `show`, precedence a finger first, then a show command, then the tour; every hand-over between two sources is an
  eased move from the current pose (a `{ from, to, ms }` the camera plays, never a cut; a cut with a fade only in
  reduced motion, as `still.js`); the tour takes the camera back a minute after the last touch or show (`IDLE.ms`
  moves here from `touch.js`); show commands are display-only and never outrank a finger — done when: tests on a fake
  clock cover a touch during a show (touch wins, the show waits or is dropped, the notes say which), a show during
  touch (queued until idle or refused, decided and written down), a show while the tour flies (the show takes the
  camera with an eased hand-over), and the tour back 60 s after the last touch and after the last show.
- [ ] T14 (§7 Night 4 A, D10; after T13) [ui] [variant:galaxy] One camera director, wired: `galaxy/main.js` builds
  the director and hands `createTour` an adapter (its `map` interface: `focus`, `fit`) that asks the director, so
  `tour.js` is unchanged for `wall.html`; `touch.js` (wake, gestures, taps, back, `▶ TOUR`) asks the director instead
  of calling `camera.js` directly; no other path moves the camera — done when: every touch and resume page test stays
  green (`wall-galaxy-touch`, `wall-galaxy-resume`), a page test with a counting fake camera sees every camera call
  come through the director with its source, and a CDP touch film (tour → wake → drag → tap a site → back → 60 s →
  tour) matches night 3's `r56-touch` sequence with no cut.
- [ ] T15 (§7 Night 4 0b; r46-skeptic fx-warp 1) [ui] [variant:galaxy] `lanes` removed and calm flights quiet: the
  `lanes` code in `galaxy/fx.js` (`siteRoutes` and the pulse), `scene.js`, `main.js`, its tests and the `?fx=` list
  and every mention in docs; under `fx=warp` a flight to a calm site or to the overview draws no streaks (`warpAt`
  returns 0 for `calm`) — done when: `FX_NAMES` has no `lanes`, `grep -rn "lanes" public/js/wall/galaxy` finds no
  effect code (the word may stay for the Map's lane nodes), `?fx=lanes` is ignored without an error, a test pins
  `warpAt(k, 'calm')` at 0, and filmstrips of `galaxy.html?demo=1&quality=0&fx=warp&pace=wall` show streaks only on
  flights to warn/crit sites.
- [ ] T16 (§7 Night 4 0b; README §7 Night 3 D `afterglow`; r46-skeptic touch 4, r59-dreamer 7) [ui] [variant:galaxy]
  `fx=afterglow`: when trouble clears, its cluster keeps a faint outline ring in the old status hue on the plane,
  cooling red → amber → grey and gone after about 30 min; outline only, never filled, never pulsing, quieter than any
  live trouble (§2.1); the page remembers the clears it has seen (pure `fx.js` `afterglows(prev, model, now)` and
  `afterglowAt(clear, now)`; no server route, D2; a reload forgets them); none in still mode beyond a static ring; off
  by default — done when: tests map a clear's age to hue (crit token → warn token → `--text-3`) and alpha (monotonic
  down, 0 at 30 min, always under the warn nebula's), a flap back to trouble drops the ring, nothing without
  `?fx=afterglow`; and filmstrips of `galaxy.html?demo=1&quality=0&pace=wall` with and without `&fx=afterglow` on the
  large demo (whose trouble clears and returns) show the ring only with it, after a clear.
- [ ] T17 (§7 Night 4 0b; README §7 Night 3 D `activity`; night 2's research Q8 `fade` and `miss`; Q18 when answered)
  [ui] [variant:galaxy] `fx=activity`, replacing `comets` and `twinkle` (both removed: code, tests, `FX_NAMES`,
  docs): a planet with a working session or a running job (`fx.js workingPlanets` and the events `flowComets` reads)
  is brighter and slightly larger and carries a slow visible ring; a job that lands flashes its target once; a failed
  one visibly does not land; what is quiet recedes a step; visible at the overview from 3 m; off by default —
  done when: tests map working count to brightness/size/ring (calm stays calm: no hue, slow), a landed job to one
  flash and a failed one to none, nothing without `?fx=activity` and no `comets`/`twinkle` left in `FX_NAMES`; and
  filmstrips of `galaxy.html?demo=1&quality=0` with and without `&fx=activity` plus a 3 m shrunk overview still show
  the working planets apart.
- [ ] T18 (§7 Night 4 0b; README §7 Night 3 D `sweep`) [ui] [variant:galaxy] `fx=sweep`: once per tour cycle, at the
  overview only, one faint sensor line from the sun turns once round the plane; each cluster it crosses pings softly
  only if its site sent new data since the last sweep (per-site freshness kept by the page from the map frames, e.g. a
  per-site key of its nodes' status and stamps, next to `fresh.js`), so a silent site stays dark and the gap shows;
  none in still mode, never during a flight, never under a finger; off by default — done when: tests show the line's
  angle over the sweep, a ping only for sites changed since the last sweep, none while held or in still mode, nothing
  without `?fx=sweep`; and filmstrips of `galaxy.html?demo=1&quality=0` with and without `&fx=sweep` (one with
  `demo-fleet.mjs --quiet-after`) show pings on live sites and none on a silent one.
- [ ] T19 (§7 Night 4; r4-film-ui galaxy 1; after T9) [ui] [variant:galaxy] One top step of type while a site is held:
  the banner (`hud.js`, `frame.js`, `wall.css`) may own the top step only at the overview; while a caption holds a site it
  drops to the caption's second-line size (~0.45 of the hero) and becomes one line `■ HV2 · STORAGE · reason  +N`, so the
  caption hero is the only top-step type on screen — done when: a test pins the banner's font size at the overview
  against its size with a held site (held ≤ 0.5 of the hero's, overview unchanged) and a still with a different
  trouble held shows the hero as the largest type; `wall.html`'s caption tests stay green.
- [ ] T20 (§7 Night 4; r4-film-ui galaxy 3) [ui] [variant:galaxy] No orphaned leader line: the leader belongs to the plate
  and fades on the plate's opacity curve, first out (drawn last on the way in: plate, leader, lock) — done when: a test
  with a fake clock finds the leader's opacity never above the plate's and 0 once the plate is gone, and a film frame
  after the plate fades shows no stub or diagonal in empty sky.
- [ ] T21 (§7 Night 4; r4-film-ui fx-warp 1; after T15) [ui] [variant:galaxy] `fx=warp` says where, not everything:
  streaks only inside a cone (~30°) round the direction of travel, about a quarter of today's count, white with the
  status hue only on the leading tips, and none drawn over a crit nebula's screen disc — done when: a test pins the cone
  and count (`fx.js`/`scene.js` pure helper) and a streak start inside a crit's disc is skipped, and a filmstrip of
  `galaxy.html?demo=1&quality=0&fx=warp` on a flight to a warn site no longer streaks both arms or covers the crit.
- [ ] T22 (§7 Night 4; r11-dreamer galaxy 1, §2.1) [ui] [variant:galaxy] A new trouble is a moment: when a site's
  rollup rises (calm → warn, warn → crit) between two map frames, the banner types its new subject in letter by letter
  as the caption does, once; never for trouble already standing at load, never repeated, never under a finger, whole
  text at once in still mode — done when: a page test on a fake clock sees the banner type in after a rise and show
  whole text with no typing at load, after a drop, or in still mode, and a film of `galaxy.html?demo=1&quality=0`
  (large demo, `VM-C` going crit) shows the banner mid-typing in one frame.
- [ ] T23 (§7 Night 4; r11-dreamer galaxy 6) [ui] [variant:galaxy] Crit and warn differ at 3 m by more than hue: the
  crit nebula is one step bigger than the warn one (at least 1.5x, as Later's r21-operator line) and the warn nebula
  does not breathe; the crit's breathing swing is visible within a frame pair 2 s apart — done when: a test pins crit
  nebula radius ≥ 1.5x warn's at the overview and the warn's breathing amplitude 0, and a 684 px still of the crit
  overview shows the red cluster plainly larger than the yellow one.
- [ ] T24 (§7 Night 4; r11-dreamer galaxy 7 = r41-operator galaxy 7, r17-operator galaxy 5) [ui] [variant:galaxy] A
  site name is never eaten by its own cluster: the overview label sits on the side away from the cluster's disc by the
  disc's screen radius, and no nebula sprite is drawn over a trouble label's box — done when: a test on the large
  fixture finds, at the overview and with HV1 in crit, the label's box clear of the cluster's screen disc, and a still
  shows `■ HV1` whole.
- [ ] T25 (§7 Night 4; r16-operator galaxy 4) [ui] [variant:galaxy] The held crit is not at the frame's edge: while a
  member is the hero, the held framing centres on that member (left of centre, clear of the plate), not on the star,
  and no other label sits inside the lock's brackets (warn labels step aside from the lock's box) — done when: a test
  on the large fixture with `VM-C` held finds `screenOf(lockTarget)` inside the middle 70 % of the frame, outside
  every cover, and no shown label box overlapping the lock's box; a `?pace=wall` film frame at the VM-C hold shows the
  red lock clear of `acme-billing`.
- [ ] T26 (§7 Night 4; r16-operator galaxy 8, = night 3's Later r46-skeptic galaxy 8, r26-skeptic 11)
  [ui] [variant:galaxy] No red line without a name: hyperlanes are grey at the dimmest weight at every zoom and carry
  no status tint (a lane running off the frame looked like a second, unnamed alarm) — done when: a test pins the lane
  colour as the grey token for crit/warn/calm sites at the overview and with a site held, and a still of
  `galaxy.html?demo=1&quality=0&at=hv2` shows no red line leaving the frame.
- [ ] T27 (§7 Night 4; r16-operator galaxy 9) [ui] [variant:galaxy] The tag is a cover for map labels: the sun's name
  (`DEMO-HOST`) and its sun are never drawn over `LANEBOARD · … LIVE`/`STALE` (the tag's box joins `hud.covers()` for
  labels as the plate does) and the overview/flight framing keeps the sun out of the tag's corner — done when: a test
  finds no shown label box overlapping the tag's box at the overview and over `flightPose` samples on the large
  fixture, and a film frame shows the tag text whole.

## Research questions

- [x] Q16 → research/Q16-show-message-shape.md. The show interface's message shape (for Later B, the first show task): how do kiosks, digital signage and
  display walls take remote "show this" commands in the browser (`BroadcastChannel`, `window.postMessage`, a
  WebSocket topic; e.g. signage players, Grafana kiosk/playlist, presentation remotes like reveal.js multiplex, OBS
  browser sources): message envelope (type, id, source, ttl), how a command is undone or expires, how a screen says
  who is driving it, and origin checks for `postMessage`. One recommended shape for `flyTo`, `highlight`, `clear`,
  `pin` — for Later §7 Night 4 B
- [x] Q17 → research/Q17-countdown-at-distance.md. A countdown readable from 3 m (for Later C, `countdown: { at, label }`): how departure boards, broadcast
  clocks, launch countdowns and control-room timers show time-to-event at distance (format `T-4:12` vs `in 4 min`,
  when seconds appear, tabular figures, a ring or bar vs digits, what happens at zero and after), and how to keep many
  small countdowns quiet at an overview while one is readable when held. Night 1's Q3 already has type size per
  metre: do not repeat it — for Later §7 Night 4 C
- [x] Q18 → research/Q18-busy-vs-idle-at-a-glance.md (thin on game sources; ISA-101 grey-scale practice is the firmest). IDEAS: "at work" vs "idle" at a glance for `fx=activity`: how strategy and sim games (Factorio, Stellaris,
  Homeworld, RimWorld, city builders) and ops tools show that a unit or machine is busy, finishing, or failed at a
  zoomed-out map scale without hue (hue is for trouble here). Night 2's Q8 (alive without meaningless motion: `fade`,
  `miss`, `pulse`) is answered: do not repeat it. 2-3 concrete proposals for the galaxy (what it shows, what it means,
  a cost guess) — for T17

## Later

From r11-dreamer (triage, night 4; not tasks yet):
- (r11-dreamer galaxy 2) Calm holds are empty: one real-facts line on the calm plate (owner question (b)), system framed centre-right (= r54-film-ui 8 below).
- (r11-dreamer galaxy 5) The sun is a planet: larger, warmer-white grey body, no hue, static.
- (r11-dreamer galaxy 8) The clock a step smaller (= r26-skeptic 9 below).
- (r11-dreamer touch 2) Fan rows carry trouble status as a hue edge, trouble rows first, leaders as non-crossing elbows.
- (r11-dreamer across) A 300 ms settle on arrival at trouble, then the type; the tour's return types `TOUR` in the kicker (with T5).
- (r11-dreamer fx-warp 2) Reverse streak on leaving a crit (taste).
- (r11-dreamer galaxy 3, 4, fx-beacon, fx-warp 1) covered by T17, T9/T20, the beacon lines below, T15.

From r4-film-ui (triage, night 4; not tasks yet):
- (r4-film-ui galaxy 4) Hold rhythm: arrive and lock 0.6 s, stillness 0.4 s, name types, rows fade in, hold at least
  1.5 s still before leaving; under `demo=1` cut the overview, not the hold; calm plates two lines minimum.
- (r4-film-ui galaxy 5) Typing cursor at cap height, 60 % value, only after the first letter.
- (r4-film-ui galaxy 7) Label system of three steps: held site, sun and other sites, members; sun never bigger than the held site.
- (r4-film-ui galaxy 8) Plate rows on one two-column grid (mono label, condensed-caps value); CPU/MEM on one row.
- (r4-film-ui fx-beacon 2) Beacon fades on the flight out, not cut: film one departure at 0.5 s spacing.
- (r4-film-ui touch) `‹ BACK` box uses the plate's 2 px bracket weight; the sheet's `■ SITE` kicker says `MANUAL` in explore (with T5).

From r16-operator (triage, night 4; not tasks yet):
- (r16-operator galaxy 2) With two crits the banner says one: count leads at the banner's size (`■ 2 CRIT`), `+N MORE` dropped or the reason line's size (with T8).
- (r16-operator galaxy 10) The calm plate says `ALL CLEAR` or one fact under the name.
- (r16-operator fx-beacon 1, 2) Beacon width floor in screen px (≥ 6 px at 2x), screen-vertical; age as width.
- (r16-operator touch 1) In explore the plate's kicker says `MANUAL` and the corner brackets go `--text-2` (= r4-film-ui touch).
- (r16-operator across) Plain galaxy steals warp's tint toward a trouble destination, without the streaks (= r51-touch across).
- (r16-operator galaxy 3, 5, 7; warp 1) covered by T23, T22, T24, T21; galaxy 1 by T8; galaxy 6, touch 2 need no fix.

Night 4's list, not yet a task (README §7 Night 4; the replan takes from here first, in this order: B, C, D, E; with
little room left, E before C and D):
- §7 Night 4 B1 The show commands, the state: a pure `galaxy/show.js` with `flyTo(nodeId)`, `highlight(nodeIds,
  note)`, `clear()`, `pin(nodeId, card)` (a plain text card next to a node), each display-only, each one line on screen
  ("shown by the agent", the tag's face), each undone by one tap (an `✕` target of 48 px, Q6); going through the
  director's `show` source (T13). Message shape from Q16.
- §7 Night 4 B2 The show commands, the transport: one small documented message shape through `BroadcastChannel` and
  `postMessage` (origin-checked) into `show.js`; the relay room → hub → screens is cockpit work (fenced hub files): not
  this night.
- §7 Night 4 B3 The show demo: `?demo=1&show=demo` plays a recorded conversation's show commands over the large demo
  fleet (fly to the crit, highlight what it breaks, pin a note); the video's second half (cockpit §5). A filmstrip.
- §7 Night 4 C `countdown: { at, label }` as a feed field (D3, like `glow` and `ring`): the galaxy draws a small
  countdown at that node, readable at the site step and quiet at the overview; the caption names it when the camera
  holds there; display only; the large demo carries one (`test/helpers/demo-hub.mjs`). Format from Q17. Maybe two
  tasks: the field and the drawing, then the caption line and demo data.
- §7 Night 4 D1 Half a screen: `galaxy.html` at 50 % width keeps the 3 m check (names, trouble, caption) and its touch
  targets (the 48 px floor); a still at 684 px wide shrunk to 3 m.
- §7 Night 4 D2 `?role=tour|explore`: starts the page in that mode (explore: no tour until `▶ TOUR` or the director
  is asked); the canvas itself is cockpit work.
- §7 Night 4 E1 (night 3's E; r43-stranger 1, 6) `docs/wall.md`: what it is, a tablet in kiosk mode, the URL switches
  `?demo`, `?pace`, `?fx` (each effect and what it means), `?perf`, `?at`, `?open`, `?quality`, `?role`, `?show`, the
  feed fields `glow`/`ring`/`countdown`, touch and how to stop the tour; `docs/map.md` says which page paints
  `glow`/`ring`; a Wall row in README's views table.
- §7 Night 4 E2 `docs/wall.md` covers D10 (the director, who drives), the show messages and `countdown`; every feature
  has demo data (product §3.2): a test lists the switches in `docs/wall.md` against the page's parsers.
- §7 Night 4 E3 (night 3's E; r43-stranger 2, 6) A web manifest for the galaxy (`start_url: "/galaxy.html"`,
  fullscreen, landscape) if it fits the guardrails, and `wall.html?variant=galaxy` opens `galaxy.html` instead of
  falling back to radial (an "unknown variant" note on the tag for other names).
- §7 Night 4 E4 `wall.html` (radial, the default) gets one filmstrip, since night 3 changed the shared `caption.js`,
  `tour.js` and `frame.js`; fix what it shows broken. The morning report lists what a reviewer should read first and
  what reaches outside the galaxy (`public/css/tokens.css --tex-vignette`).
- §7 Night 4 (owner note) A frame cap behind `?cap=30` only, off by default: 30 fps in holds, at the overview and in
  reduced motion, 60 in flights and under a finger (r56-performance galaxy 2, r37-performance 6).

Night 3's list, still open (README §7 Night 3; task numbers in the lines below are night 2's or night 3's):
- §7 Night 3 A4 (was night 2's T34, r49-accessibility galaxy 4) The trouble planet's name readable at 3 m: in
  `labels.js` warn/crit members of the held system at least the room step + 1, weight 500, on a `--bg-canvas`
  plate; calm names stay at the room step.
- §7 Night 3 A4 (was night 2's T33, r49-accessibility galaxy 1) Crit the most visible status for low vision too:
  on the Wall only (`html.wall` token override read by `paletteFrom`) lift `--crit` toward oklch 70 % (hue kept,
  ~7:1), brighter crit nebula core, the banner's crit glyph and word on a `--p1` slab; a protanopia still shows crit
  brighter than warn.
- §7 Night 3 A5 (night 2's r49-accessibility 7) Accessibility: no letter-by-letter typing for screen readers
  (`caption.js` plate `aria-live="off"` while typing, one visually hidden live node with the full text), the
  fleet line `role="status"` announcing only on a change of subject or tone; `+N MORE` readable at 3 m and a
  48 px tappable chip (`frame.js`, r31-touch 5) whose tap flies to its node.
- §7 Night 3 A6 `wall.html?variant=islands-tiles` registered (`variants.js` + `main.js`, the diff in
  `sketch/main.js.diff` and night 2's For the owner), so the galaxy's no-WebGL fallback (`galaxy/fallback.js`)
  lands on it, not on radial.
- (was night 2's T32, r43-stranger 6; not named by Night 3, fits E) Screen Wake Lock in `galaxy/main.js`: request
  at start and again on visible, silent when denied or missing (Q15).
- §7 Night 3 D unbuilt, staying unbuilt: `fx=storm`, `fx=lights`, `fx=rings`, `fx=arrive`.

From night 3's reviews (`nights/night-3/reviews/`; task numbers in these lines are night 3's, not tonight's):

From r56-performance (not tasks yet):
- (galaxy 3b) One `InstancedMesh` per sphere geometry and tone for members (about 5 calls, not about 120).
- (galaxy 4) `?perf=1` overlay shows style-and-layout time per window from `long-animation-frame` (overlay only).
- (galaxy 5) `camera.js go()` computes flight `extra` and swell scale once; `avoid()` stops spreading per frame.
- (galaxy 6) = r37-performance 4 (`setOpen` marks dirty, `advance` places once).
- (galaxy 7) = r37-performance 7 (per-frame garbage in labels, beacons, heldDust).
- (touch 2) When the frame cap lands, the coast until `atRest` counts as under a finger; a 20-step pinch ends close
  and low with HV1 at the top edge (framing, for a touch round).
- (fx-beacon 1) Additive pillars add fill rate on 5 MP; measure on the Surface. (fx-warp 1) If flights dip there, halve `WARP_DUST` at level 1.

From r51-touch (not tasks yet):
- (r51-touch galaxy 8) In a system opened by a tap, trouble members' names at the room step's 2x (>= 2.2vmin), calm unchanged.
- (r51-touch galaxy 9) A two-finger tap anywhere is back; document in `docs/wall.md`.
- (r51-touch across) The tapped flight takes a minimum of warp's tint toward its destination (with T28).

From r46-skeptic (not tasks yet):
- (galaxy 5) Plate kicker, `STATUS` row and attention row repeat the hero: kicker the site's kind only, `STATUS` only
  when more than the hero (`+1 warn`), in hue (with T23).
- (galaxy 7) Calm planets tinted pink inside a crit nebula: the nebula's light must not reach the planets' material.
- (galaxy 8) A red hairline from HV2 off the frame (hyperlane in the site's tone): hyperlanes stay grey at every zoom
  (= r26-skeptic 11), or fade a lane whose far end is off screen.
- (galaxy 10) `+N MORE` changes with the camera: count all open problems, at the reason line's size, or remove it.
- (galaxy 11) Ambient line `5 SITES · 115 NODES · 8 WORKING`: keep only `8 WORKING` or remove.
- (galaxy 12) Warn banner wraps after its separator: break at the separator (site · node / reason).
- (galaxy 13) Leader line repeats the brackets: film one round without it, keep only if a panel cannot find the target.
- (galaxy 14) The date under the clock unreadable at 3 m (= r26-skeptic 9): remove, or put in the tag.
- (fx-beacon 2, 3) Beacon flares into a streak in flights near its site: fade it in flights; billboard it
  screen-vertical (= r31-film-ui galaxy 6).
- (fx-warp 1, 2, 3) No streaks on a flight to a calm site; the trouble tint at full token value (T28); streak far
  stars only, not the near dust, or cap opacity at the ribbon's (the overview's S turns to scratches in out-flights).

From r41-operator (not tasks yet):
- (r41-operator galaxy 7) Crit label `■HV(` eaten by its nebula at the moment it turns crit: A4 T34 line above, trouble
  labels after the nebula on a `--bg-canvas` halo.
- (r41-operator galaxy 8) A dark box behind the banner at the overview (the far cover's ground): feather it or drop it
  at the overview (with the feathered plates line).
- (r41-operator fx-beacon 1, 2) Beacon is a 1 px hairline at the 3 m scale and leans: width floor in screen px (check the
  sheath's alpha profile), billboard it screen-vertical (= r31-film-ui galaxy 6).
- (r41-operator fx-beacon 3) Film a two-crit overview with `fx=beacon` and check the young one shows its floor.
- (r41-operator touch 4) Tool note: `tools/r38-resume.mjs` `pick` reads `s.node?.status`, which is empty; use the nebula tone.
- (r41-operator across) Trouble `?pace=wall` is the only film that shows tour order; operators film it. The tour plate
  should take the sheet's hue rows (= T23).

From r36-dreamer (not tasks yet):
- (r36-dreamer galaxy 1) A calm plate carries one real-facts line in `--text-2` and the held system is framed in the
  space the plate leaves free (the facts idea is also under For the owner; the framing = r54-film-ui 8 below).
- (r36-dreamer galaxy 6) Banner plate feathered: the Later A4 T38 line above.
- (r36-dreamer fx-beacon 2) Beacon billboarded screen-vertical: the r31-film-ui galaxy 6 line above.
- (r36-dreamer across) The tour's overview takes the touch explore pose (lower pitch, wide tilted disc) and calm plates
  the planet sheet's restraint: taste, with r31-film-ui across under For the owner.

From r31-film-ui (not tasks yet):
- (r31-film-ui galaxy 6, fx-beacon 1) Draw the beacon pillar screen-vertical (billboard on x), not leaning with perspective.
- (r31-film-ui fx-beacon 3) Beacon white foot twice the core width over the bottom 10 %, so the foot reads as "here".
- (r31-film-ui touch 4) A tap right after a coasting drag did nothing once: check it in the fake-clock page test (may be SwiftShader lag).
- (r31-film-ui galaxy 5, 7; across) Calm holds leave two thirds empty, no arrival beat: covered by the r54-film-ui 8 and r15-dreamer 7 lines below.

From r17-operator (not tasks yet):
- (r17-operator galaxy 6) When stale, the tag moves to the clock's size next to the clock (`STALE 2M`, `--text-1`).
- (r17-operator galaxy 8) The `1 crit` status line in the crit hue with its shape (the rest is T20).
- (r17-operator galaxy 5) Crit nebula eats its own label (`■ HV(`): same as A4 T34 above, plus a test that no nebula
  sprite is drawn over a trouble label's box.
- (r17-operator fx-beacon 1-3) Beacon: floor at the overview, fade while its system is held, age as width: T9 and the
  beacon Later lines; also fade the beacon out while its own system is held.
- (r17-operator across) Add `revisitEvery` to `DEMO_TIMING` so demo films show the revisit rule; operator rounds film `?pace=wall`.
- (r17-operator touch 1, 2) Explore mode shows a thin 60 s countdown line at the bottom edge (`--text-3`) and the
  overview's trouble glyphs are the biggest hit targets: inputs for T13/T14 and T10.

Carried from night 2's `## Later` (reviews named there, `nights/night-2/reviews/`; triage decides per review):
- (r31-touch 1, 3, 4, 7-11, fx notes; the touch design note, input for T7-T14) Hit-test in screen space over
  `screenOf` discs of 48 css px, not raycasts: at the overview hits resolve to sites only (label counts as
  target); in a held system pick the worst status then the nearest, a fan of name chips on a tie, trouble
  labels join their planet's hit area; during a flight resolve at `pointerdown`, sites only, members once open
  ≥ 0.85; one `pointerdown` on the stage, brackets within 100 ms, a ring where an empty tap lands; a 56 px
  corner button while exploring; ignore multi-pointer or contact > 120 px, a tap is `pointerup` within 300 ms
  and 12 px; a 60 s countdown line then the tour; ease drift to 0 over 400 ms on touch; comets take no hits and
  a new comet waits while a finger is down; tap feedback is brackets, never brightness; next/step order =
  `tourOrder` (trouble first).
- (r31-touch 3) Trouble planets in a held system sit 10-25 css px apart: spread the orbit layout so trouble
  members are at least ~48 px apart at the tour's zoom.
- (T20, builder r42) At the warn step the fleet line has no `frame.js` cover, so the overview fit does not keep
  sites clear of it: feed the fit the warn block too, widest seen.
- (T3, builder r7; r8-film-ui 9) Dust grains coarse when the camera is close: point size attenuates with
  distance, capped ~2 px.
- (T4, builder r11) An open system with many planets reaches past the frame's bottom edge: fit the distance to
  the open reach and the aspect, aim the held system above the far fleet block.
- (r21-operator 7) In demo legs the caption typing starts at flight midpoint, not on arrival.
- (r21-operator 1, 2, 3) T18's test also: with `?at=<site>` in trouble, `screenOf(lockTarget)` lies outside every
  cover; the overview fit keeps every folded box clear of `hud.covers()`; crit nebula at least 1.5x warn.
- (r21-operator "across") Night 1's trouble tile read better from afar than a soft glow: check the nebula against it.
- (r21-operator 4) Trouble waited ~95 s behind calm sites: done before night 3 in `tour.js` (2e22d81); check
  the galaxy against the new pace.
- (r8-film-ui 5) Camera rhythm: the overview holds ~2 s at each cycle's start, a status change at the overview
  gets a ~600 ms 5 % push-in before the leg.
- (r8-film-ui 6) Overview composition is lopsided (sites left/low, the right third empty): spread `armPoint` or
  offset `overviewShot`'s look-at to the sites' centroid; keep the bottom right free for the fleet line.
- (r8-film-ui 7; = r26-skeptic 10) Folded calm systems read as lumpy spheres: one sprite below a screen-size
  threshold; a folded cluster in trouble is its shape glyph at the site step.
- (r8-film-ui 8; r15-dreamer 8; r26-skeptic 6) The open system is a wheel: drop the spokes, landing ring as a
  tick at half the stem weight, orbit ring at text-3, rooms in the label face, services as dots unless in trouble.
- (r8-film-ui 1) Type hierarchy: caption name, site name, planet name (mono lowercase, only when open); no fourth step.
- (r15-dreamer 4) The banner becomes wallpaper: rank crits by age, the newest takes the slab, older ones the second line.
- (r15-dreamer 6) The best flight frame says nothing: hub out of shot plus the arc over the plane (with T1, T2).
- (r15-dreamer 7) No arrival beat in 3D: member labels fade in in orbit order, timed with the caption's typing.
- (r15-dreamer 9) The arms do not read as arms: thin the dust between the arms, brighten along each spine (with T3).
- (r26-skeptic 1) While a held site is in trouble, calm services and lanes are dots with no name.
- (r26-skeptic 4; r54-film-ui 10) The sun's label: mono caps at the room step, `--text-3`, or removed (the tag names the hub).
- (r26-skeptic 9) Clock at half size in text-3, date line gone.
- (r26-skeptic 11) Hyperlanes grey at the dimmest weight; no status tint.
- (r43-stranger 2-3) Plate cut mid-row and typing cursors in stills: size the bracket to the full plate before typing.
- (r43-stranger galaxy 5, 6) Empty frames between legs; the overview is small, no counts per site.
- (r43-stranger 4) A hub answers 404 to `POST /api/map/feeds` while map.md promises 201/409: server work, outside the Wall.
- (r49-accessibility 2) `?motion=still|full` overriding `prefers-reduced-motion` (`still.js prefersStill`), in docs/wall.md.
- (r49-accessibility 5; r54-film-ui 7) The status shape on a sphere is a dark cut-out: an outline in its hue at 1.6x
  the radius; one mark per member, close members share one halo.
- (r49-accessibility 6) In reduced motion the banner flips red ↔ amber: hold its tone for one caption rotation (12 s).
- (r49-accessibility 8) In still mode a new crit cuts the caption rotation.
- (r54-film-ui 4) The caption arrives before the camera: start it at flight progress ~0.9, the leader after the name typed.
- (r54-film-ui 5) The status glyph `■` off the baseline: cap height (0.7em), on the baseline, gap 0.22em.
- (r54-film-ui 6) Two type scales: set `--cap-*` from `type.js stepsFor` at boot (extend upward 63, 84, 112).
- (r54-film-ui 8; r59-dreamer 6) Calm holds waste half the frame: frame a leg with the plate box its caption uses,
  the system centred, one living thing in the hold.
- (r54-film-ui 9) The held star is named twice: hide its label while its caption is up.
- (r54-film-ui 12; r59-dreamer 4) The tether: 2 px, landing on the glyph's top centre with a tick, a slow travelling tick.
- (r54-film-ui fx) `fx=beacon` dims to the open level while the camera flies close to it (after T2, T9).
- (r59-dreamer 3) Every planet is the same grey ball: radius from what it holds, two or three greys by kind, no hue.
- (r59-dreamer 7) A cleared crit reads as present: `--text-2`, red glyph only, one step smaller (with `afterglow`).
- (r59-dreamer 8) Labels hit the frame's safe margin and the caption's brackets: treat them as covers (with A4 T31).
- (r37-performance 4) `scene.js setOpen` re-places every site per call: dirty only, place once in `advance()`.
- (r37-performance 5) Every socket message runs `galaxyLayout(nodes)` before the tree key: compute `treeKey` first.
- (r37-performance 6) A `frameCap` in `galaxy/main.js` (60 in a flight, 30 otherwise), `budget.js` judging against it.
- (r37-performance 7) `labels.draw` rebuilds per frame: memoise `labelSize`, reuse arrays, skip unchanged passes.
- (r37-performance 8) Folded calm members are still meshes at the overview: hide them while `unfold === 0`.
- (r4-film-ui galaxy 3) The banner flips subject between cuts: hold the slab for a whole tour cycle (with r15-dreamer 4 above).
- (r4-film-ui galaxy 5) Calm member names at ~20 % contrast overlap the lock brackets: `--text-3`, no word under a bracket (with r54-film-ui 8 above).
- (r4-film-ui galaxy 6, 8) Labels at the frame edge or on plates, the held name twice: covered by A4 T31 and r54-film-ui 9 above.
- (r4-film-ui fx-beacon 3) The beacon doubles the red glow: pillar thin with a white core, the nebula one step down while a beacon stands (after T9).
- fx candidates from night 2 not asked for by the owner: `blast` (r59-dreamer: red threads from a held crit to
  what depends on it), `heat`, `realm`, `route` (research Q7), `pulse` (Q8).
- Night 1's shared bugs that may apply (`worstGapMs` a lifetime max in `perf.js` (T39), clock and caption
  (T57/T58)): triage decides per review.

## For the owner

From r11-dreamer (`fx` candidates, none asked for; not tasks):
- `fx=alert`: when a site's rollup rises, one thin ring in its hue goes out from the site across the plane, once
  (the banner type-in is T22, not an effect).
- `fx=lost`: a member that lost contact fades to an outline with a gap that grows with time since contact (capped).
- `fx=recent`: on a calm hold, planet names type in by recency of last change; untouched for a day keeps no label.

From r4-film-ui (ideas, taste; not tasks):
- Tint the lock brackets with the destination's status during a flight, so "going to the red one" shows without warp.
- The plate's leader could rise vertically from the target like the beacon, instead of stub-and-diagonal.
- Tour held frames with the banner should be composed like the planet sheet (plate left, system right, no banner): the
  review's best frame of the night.
- `fx-beacon` with body: 6-8 px core, soft glow, a cap at the tip, width with age (already in Later as the hairline
  finding; the look is taste).
- At 3 m a warn ▲ and crit ■ differ only by hue; shape separates them only up close.

Carried from night 3 (its morning report, `nights/night-3/PROGRESS.md` `## Morning` "Needs you"):
- (r56-performance) Leave `galaxy.html?demo=1&fx=beacon&perf=1` up for an hour on the Surface and compare the overlay's
  memory line at start and end (10 minutes on the VM showed no growth); compare with no fx, and `&fx=warp` in flights.
  Every fps number from the loop is SwiftShader.
- (r46-skeptic, taste, decisions) Keep or cut: (a) `TARGET 02 / 05` in the kicker; (b) the calm plate that only types
  the site's name (one real line such as `12 rooms · 3 working · last change 14m`, or no plate; = r11-dreamer galaxy 4);
  (c) the sun's name or the tag's hub name, not both; (d) `fx=beacon` as the fourth mark for the same crit.
- (Q14 research, taste) A stale feed that keeps its crit nebula red and brightest looks like live trouble. The
  research suggests freezing all liveness motion (`freeze`, small), a slashed grey ring at the sun (`flag`), and
  marking last-known trouble with a hatch and one step less brightness (`lastknown`). Not tasks; see
  `nights/night-3/research/Q14-stale-feed-ideas.md`.
- (r4-film-ui, taste) The folded trouble cluster at the overview could take the beacon's vertical silhouette, so
  shape carries where colour does not. Not a task.
- (r11-dreamer galaxy 9, across 2; r31-film-ui across; r36-dreamer across, taste) Hold the best accidental frame (the
  last ~0.8 s of a trouble arrival) on purpose; calm open systems in the trouble system's composition; the tour's
  overview at the touch explore pose's lower, wider pitch. Not tasks.
- (`fx` candidates, none asked for) r11-dreamer: `tide`, `telemetry`, `trail`; r36-dreamer: `heartbeat`,
  `telemetry`, `ledger` (descriptions in night 3's For the owner). README §7 Night 3 D's `storm`, `lights`, `rings`,
  `arrive` stay unbuilt. Not tasks.
- (planner, night 4) B, C, D and E did not fit the first 18 tasks (night 3's twelve open tasks plus the director and
  the effects come first by the plan's order). The replan takes them next; if the night runs short, E (docs, manifest,
  `wall.html?variant=galaxy`, the `wall.html` film) is what the merge needs most.

## Reviews

- r11 dreamer → reviews/r11-dreamer.md. 8 galaxy + 2 beacon + 2 warp + 3 touch findings + 3 fx proposals; 3 became
  tasks (T22 banner type-in on a rise, T23 crit vs warn nebula, T24 label eaten by cluster). Dropped as covered:
  galaxy 3 (T17), galaxy 4 (T9, T20), beacon 1-2 (Later), warp 1 (T15). Rest in Later; the 3 fx proposals under For the owner.
- r4 film-ui → reviews/r4-film-ui.md. 8 galaxy + 2 beacon + 3 warp + touch findings; 3 became tasks (T19 banner size
  while held, T20 orphaned leader, T21 warp cone). Dropped as covered: box over the galaxy (T10), grey crit glyph (T6),
  calm warp streaks (T15). Rest in Later (hold rhythm, cursor, label steps, plate grid, beacon fade, BACK box) or
  For the owner (ideas).
- r16 operator → reviews/r16-operator.md. 10 galaxy + 2 beacon + 2 warp + 2 touch findings; 3 became tasks (T25 held
  crit framing, T26 grey hyperlanes, T27 tag as label cover). Dropped as covered: galaxy 1 (T8), 3 (T23), 5 (T22),
  7 (T24), warp 1 (T21); galaxy 6 and touch 2 (no fix). Rest in Later; no fx proposals.

## Scores

| round | persona | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|
| 4 | film-ui (galaxy) | 7 | 6 | 7 | 6 | 6 | 5 | 6 |
| 4 | film-ui (fx-beacon) | - | - | - | - | 5 | 7 | - |
| 4 | film-ui (fx-warp) | - | - | - | - | 7 | 3 | - |
| 11 | dreamer (galaxy) | 7 | 6 | 6 | 6 | 6 | 5 | 6 |
| 11 | dreamer (fx-beacon) | - | - | - | - | 4 | 7 | - |
| 11 | dreamer (fx-warp) | - | - | - | - | 6 | 4 | - |
| 16 | operator (galaxy) | 6 | 7 | 5 | 6 | 6 | 5 | 6 |
| 16 | operator (fx-beacon) | - | - | - | - | 4 | 7 | - |
| 16 | operator (fx-warp) | - | - | - | - | 6 | 3 | - |

## Morning
