# Wall: progress

Night 3 (README §7 Night 3): make it feel finished. Fix what the panel hated (A), make a dead feed look dead
(B), touch (C), the owner's effects (D), docs and kiosk (E). Night 2 is in `nights/night-2/`, night 1 in
`nights/night-1/`.

Notes for every builder round (planner, round 1):
- **Order** (README §7 Night 3 `Order:`): A1-A3 first (T1-T4), then B (T5-T6), then C in its order (T7, T8,
  T10, T11, T13, T14) with D in between (T9 beacon, T12 warp). A4-A6, the other effects and E wait under
  `## Later`; replan and triage bring them in.
- **No Wall module is fenced any more** (README §7 Night 3): `caption.js`, `frame.js`, `glow.js`, `lock.js`,
  `main.js`, `perf.js`, `tour.js`, `type.js`, `variants.js` in `public/js/wall/` may change, with their tests,
  as long as `wall.html` keeps working and its tests stay green. `loop/fenced.txt` is unchanged (the Map tests
  and the loop's own files still are).
- **Keep the palette and the speed** (owner, 2026-10-26, on the Surface Pro 7: "running good, looks good, even
  the colours are pretty nice"). Nothing added may make `galaxy.html?demo=1&fx=beacon&perf=1` slower there:
  judge by script ms per frame (`?perf=1`, `budget.js`), not by fps on this VM.
- **The tour's pace** is new (`tour.js`, commit 2e22d81): overview 10 s, calm 6 s, trouble 14 s, trouble
  revisited after every 2 calm sites, `?pace=wall` gives the demo data that speed. Tune it, never undo it.
- **Guardrails** as in night 2 (`test/frontend.test.mjs`, `test/design-guardrails.test.mjs`): no `innerHTML`, no
  wholesale `style` attribute, no new sheet in `public/css/` (rules go in `wall.css`), colours from tokens
  (WebGL colours read from CSS custom properties, `palette.js`), three.js by a relative path. DOM tests use
  `test/helpers/fakedom.mjs`.
- **Filming**: `film.mjs` needs the SwiftShader wrapper (`nights/night-1/PROGRESS.md` lines 19-22):
  `CHROME=$RUN_DIR/chrome-swiftshader.sh node docs/plans/wall/loop/film.mjs --url
  'http://127.0.0.1:7795/galaxy.html?demo=1&quality=0' …` on `demo-fleet.mjs --size large`. Without
  `quality=0` the budget drops a level on this VM within ~10 s.
- **Touch** design input, already gathered: night 1's `research/Q6-touch-on-wall-and-kiosk.md` (target sizes
  in mm and px, idle defaults) and night 2's `## Later` r31-touch note (now under Later here, first line of
  the touch block). Where Q6 and the plan disagree (a tap on empty sky), the plan wins: it goes back one step.

## Tasks

- [x] T1 (§7 Night 3 A1) [ui] [variant:galaxy] Flights keep an end in frame (was night 2's T39, reviews
  r59-dreamer 1): in `galaxy/camera.js flightPose` the look-at moves from the start target to the destination,
  never at empty sky, and the pose keeps at least one of the two ends inside the projected frame at every step
  — done when: a test in `test/wall-galaxy-camera.test.mjs` runs `flightPose` over every site pair of the large
  fixture (and overview ↔ site) and finds the start or the target star inside the frame at every step, ends
  unchanged, path continuous; and a film of `galaxy.html?demo=1&quality=0` has no flight frame without a
  cluster or the sun. (commit 68d02f0) Builder r3: the camera steps back along its line of sight in one smooth
  swell (`sin²`, sized from 24 samples +10 %) so one star stays within 85 % of the frame (`framing.js standBack`);
  before, 34 of 42 large-demo pairs showed only empty sky for up to 39 % of a flight. Peak step back ~5000 on
  home ↔ __repos: T2 (bend the arc) may want to fold this into its path. Film r3-galaxy: a star in every frame.
- [x] T2 (§7 Night 3 A1) [ui] [variant:galaxy] No flight through a cluster or the sun (was night 2's T36,
  reviews r54-film-ui 3): `flightPose` keeps the path at least `1.5 × reach` from every star but the two ends
  and clear of the sun (bend the arc up, as it already lifts by `FLIGHT.lift`), keeping T1's rule; nebula lobes
  and spheres whose screen size passes ~40 % of the frame height fade out (`scene.js`) — done when: a test shows
  `flightPose` over every site pair never nearer than `1.5 × reach` to a third site's star nor inside the sun's
  radius, T1's test still green, and a film of `galaxy.html?demo=1&quality=0` shows no frame filled by one
  cluster. (commit 9262e60) Builder r7: `flightPose` takes
  `frame.avoid` (third stars at `FLIGHT_CLEAR.reach` 1.5 × reach, the sun at 480 = 0.75 × its halo) and adds one
  `sin`-shaped rise over the whole flight, sized from 24 samples +10 %, then T1's step back; a shot that itself
  stands nearer (cloud's held shot is 0.96 of 1.5 × reach from lab) only asks the flight not to go nearer than it.
  On the large demo no ideal-shot flight came near a third star even before; the frames r54 saw were the
  departing system's own nebula, so the fade carries most of it: `scene.js nearFade` fades lobes, star and halo
  past 40 % of the frame height (gone at 70 %), weighted by how folded the system is, never the one the camera
  flies to (`galaxy.setHeld`, set by `camera.js`); the sun's halo fades the same. Film r7-galaxy: no frame filled
  by a cluster or the sun, 0 console errors (1.8 fps, as every SwiftShader film on this VM).
- [x] T3 (§7 Night 3 A2) [ui] [variant:galaxy] The overview looks like a galaxy again (was night 2's T40;
  r59-dreamer 2 = r54-film-ui 11 = r15-dreamer 9): in `scene.js`, at the overview only, a faint arm ribbon along
  `layout.js armPoint` (4-6 % luminance, under the dust, never above `--text-3`, colour from a token through
  `palette.js`) that fades out as a system opens; one still shape, no motion; dust stays unlike data (night 2's
  T26) — done when: a test shows the ribbon's opacity 0 for an open system and in (0.04, 0.06) at the fit and
  its colour from the palette, and a still of `galaxy.html?at=overview&quality=0` shows two arms and the dust
  band with the crit nebulae still the brightest things. (commit 6119ed0) Builder r8: `layout.js armRibbon(n)` lays two
  soft strips on the plane along `armSpine` (the spiral `armPoint` uses; every site sits on the bright spine),
  fading in from the sun and out a step past each arm's last site; `scene.js` draws it additive in `palette.arm`
  (= text-3) at `RIBBON.opacity` 0.05 × (1 − the most open system's eased opening), before the dust, no depth
  write, never turned. Test: `test/wall-galaxy-ribbon.test.mjs`. Still r8-ribbon: a faint ground under the
  arms, HV2's crit nebula and HV1's warn still the brightest; at 0.4 (shot r8-ribbon-loud, not kept) the shape
  is two clean arms through the five sites. Film r8-galaxy: gone in every open frame, 0 console errors. At 5 %
  it is subtle on this VM's still; if the panel still sees "crumbs", the next step is narrowing it (half 170)
  rather than raising it past the plan's 6 %.
- [x] T4 (§7 Night 3 A3) [ui] [variant:galaxy] One headline per trouble frame (was night 2's T37, r54-film-ui 1):
  while a caption plate is up, `galaxy/hud.js` sets an attribute on `#wall-frame` (or `html`) and `wall.css`
  drops the banner and its glyph to the caption's name size (`--cap-name`); at the overview, no plate, today's
  size — done when: a test in `test/wall-galaxy-hud.test.mjs` sees the attribute set while the plate shows and
  cleared at the overview, a test pins the smaller banner rule in `wall.css`, and `?at=hv2` shows the banner
  clearly below the hero while `?at=overview` is unchanged. (commit 198d096) Builder r10: `frame.js plate(on)`
  sets `data-plate` on `#wall-frame` (and re-reads the far cover); `hud.js` calls it at the leg's `arriveMs`,
  not at the leg's start: the first film had the banner small through whole flights with no plate up, so no
  headline at all. `--cap-name` moved to `.wall-stage` so caption and frame share it. Stills r10-t4-hv2 and
  r10-t4-overview, film r10-galaxy: big in flights, the name step under a plate, 0 console errors. Left: a calm
  plate fades in `leadMs` before arrival with the big banner still up (no hero on a calm plate, so not two
  headlines); the step is a cut, timed with the plate.
- [x] T5 (§7 Night 3 B) [ui] [variant:galaxy] A dead feed, the state: a pure `galaxy/fresh.js`
  (`freshness(lastFrameAt, now)` → `{ state: 'live'|'stale'|'dead', ageMs, text }`, stale after 30 s with no
  `/ws` map frame, `text` like `STALE 2M`), fed by `galaxy/main.js` on every map message and on socket close;
  the tag reads `STALE <age>` and the caption gets one line saying the data is old (grey, never in a trouble
  hue); `test/tools/demo-fleet.mjs` gets `--quiet-after <s>` (the hub stays up, map frames stop) so the state can
  be filmed — done when: a test with a fake clock walks live → stale at 30 s → the age text growing → live on
  the next frame, a hud test shows the tag text and the caption line, and a demo-fleet test shows no map frame
  after `--quiet-after`. (commit cad582c) Builder r14: `fresh.js freshness(lastFrameAt, now, { open })` also
  returns `line` (the plate's words, `''` while fresh); `dead` = the socket closed (`OFFLINE`, its age once old),
  so a reconnect blip says offline at once as before; ages in tens of seconds under a minute so the tag does not
  tick each second. The first `/api/map` answer counts as a frame; the tag stays empty until the socket first opens
  or fails. Tag `STALE <age>` at `--text-1` (grey, `data-live="stale"`); `hud.staleCaption` puts a grey `DATA ·
  no new data for 2m` row right under the trouble word (from the next leg on, not mid-plate). `demoQuiet` in
  `test/helpers/demo-hub.mjs` drops relayed `map` messages; checked live: 12 s on /ws, no map frame, other types
  flowing, /api/map answering. Film r14-galaxy (`--size large --quiet-after 5`): tag LIVE → STALE 30S → 1M, the
  plate's grey line, HV2's red banner still the loudest, 0 console errors. The tag alone is small at 3 m: T6's sun
  carries the distance.
- [x] T6 (§7 Night 3 B) [ui] [variant:galaxy] A dead feed, the look: the sun's corona swells softly once per
  map frame that arrives; stale, it shrinks and the sun goes cold flat grey (`scene.js`, tokens through
  `palette.js`), never louder than live trouble (crit nebulae stay the brightest things); reduced motion: no
  swell, the grey sun only — done when: a test maps frame arrivals and `fresh.js` state to corona scale and sun
  colour (swell decays, stale → grey, still mode no swell), and a film of `galaxy.html?demo=1&quality=0` on
  `demo-fleet.mjs --size large --quiet-after 5` shows the sun turn grey and the tag read `STALE` while the crit
  cluster stays red and brightest. (commit 8811158) Builder r15: pure `fresh.js` `sunLook(ageMs, { still })` →
  `{ scale, glow, cold }` (`SUN`: swell +6 % size, +30 % glow, up in 250 ms, gone in ~3 s; old data eases over 2 s to
  60 % size, 40 % glow, cold 1) and `easeToward`; `scene.js` `setSun(look)` eases the drawn sun toward it (120 ms
  swell, 500 ms cold, so a frame after a cold spell warms it, never a cut) and lerps core and halo from `sunCore`
  (text-2) to the new `palette.sunCold` (text-3); `main.js` asks each frame from `Date.now() - lastFrameAt`. The
  swell's peak halo (0.39) stays under half the crit nebula and its size under a crit nebula's (tests). Film
  r15-galaxy (`--size large --quiet-after 5`): tag LIVE → STALE 30S → 1M, the crit and warn clusters still the
  loudest, 0 console errors (1.4 fps, as every SwiftShader film on this VM under load 50; script ms is the
  measure). Stills r15-sun-live / r15-sun-stale (`?at=overview`, 3 s vs 40 s in): the sun's grey corona is gone
  and the core a step dimmer. Honest note for a panel: it is quiet, by design; from 3 m it reads as "the hub went
  dim", not as an alarm. Q14's `freeze` (stop liveness motion on stale) would make it unmistakable and is not built.
- [x] T7 (§7 Night 3 C1, C6) [ui] [variant:galaxy] Touch, the first touch: a new `galaxy/touch.js` (a state
  machine with an injected clock: `tour` → `easing` → `explore`) wired in `galaxy/main.js` with one `pointerdown`
  listener on the stage; the first touch anywhere stops the tour and eases the camera to the overview in about
  1.5 s, and nothing under that first touch is activated; `galaxy.html` and `wall.css` block page scroll,
  page pinch-zoom and the context menu (`touch-action: none`, `overscroll-behavior: none`, `user-select:
  none`, a viewport without user scaling) — night 1's T31 — done when: a test drives pointer events on the page
  through `fakedom.mjs` with a fake clock and sees the tour stopped, `fit()` asked once, no tap handled for the
  first touch, and a test pins `touch-action: none` and the viewport meta in `galaxy.html`/`wall.css` (commit cbd8389)
  Builder r16: `touch.js` pure `touchStep(state, 'down'|'tick', now)` (`easing` ends by itself after `TOUCH.fitMs`
  1500, read lazily, no timer) and `createTouch(stage, { wake, clock })` → `{ mode(), onPointer(cb), stop() }`:
  pointerdown/move/up/cancel on `#galaxy-stage`, the waking pointer's events are swallowed until it lifts (a second
  finger meanwhile is its own touch), `contextmenu` refused. `onPointer` is the hook for T8/T10 (never hears the
  waking pointer). `camera.js fit({ ms })` flies in its own time (the tour's `fit()` unchanged); `hud.release()`
  hides the plate and lets the lock go; `main.js` wake = `tour.stop()`, `fit({ ms: 1500 })`, `release()`, the tether
  drawn in as it lands; a new model no longer restarts a stopped tour (T14 brings it back); `<html data-touch>`
  says `easing`/`explore`. `.galaxy-stage` gets `touch-action: none` + `overscroll-behavior: none`, the viewport
  `maximum-scale=1, user-scalable=no` (selection was already off). Checked: film r16-galaxy (tour unchanged, 0
  errors) and a CDP touch script (r16-touch: one tap on a held hv2 → overview, plate gone, tour still stopped 25 s
  later, a two-finger pinch left `visualViewport.scale` 1 and `scrollY` 0, 0 errors).
- [x] T8 (§7 Night 3 C2) [ui] [variant:galaxy] Touch, drag and pinch: in `explore`, a one-finger drag orbits
  the galaxy round its centre (pitch clamped so the plane is never edge-on or upside down), a pinch and the
  wheel zoom between the overview and a close system, with eased inertia after release; pure functions in
  `touch.js` (`orbitStep`, `zoomStep`, `inertia`) and a free pose in `galaxy/camera.js` behind an option that
  the tour never sets — done when: tests show the pitch clamp at both ends, zoom clamped to [overview, close],
  inertia decaying to rest, a drag of 0 px changing nothing, and pointer-event tests on the page see a drag
  turn the camera and a two-pointer pinch zoom it. (commit 3467b89)
  Builder r19: `touch.js` orbit `{ look, yaw, pitch, dist }` round a point on the plane; pure `orbitOf`, `orbitPose`,
  `orbitStep` (ORBIT.perPx 0.005 rad/px, pitch [0.35, 1.45] rad), `zoomStep` (dist in [ORBIT.near 700, far]; closes
  in toward `planeAt` the fingers; the look's room round the overview's centre shrinks to 0 at the widest, so zooming
  all the way out lands on the overview), `inertia` (exp, tau 250 ms, exactly 0 at rest), `orbitLimits`.
  `createGestures(stage, touch, cam, { limits, view, moved })` listens through `touch.onPointer` (only in `explore`)
  plus `wheel` (passive false, always preventDefault; a wheel is an impulse that coasts out to exactly its zoom); a
  drag starts past ORBIT.slopPx 12 (T10's tap slop: a tap never turns); a finger held 80 ms before lifting throws
  nothing; one `cam.steer()` per frame; at rest the camera is free again for T10/T14. `camera.js`: option `steer`
  (only main sets it, off in still/park), `want.kind 'free'` held as given, all systems fold; `pose()`, `home()`
  (the fitted overview last aimed at = the orbit's far end). `touch.js` `rest` now ticks the mode before telling.
  main: `gestures.frame(now)` before `cam.frame(now)`; the tether fades on the first move. Reduced motion: no
  steering yet (T14 decides). Checked: CDP script r19-touch (wake → explore at the overview, drag turned yaw 0 →
  -2.44 and pitch 0.90 → 1.29, pinch to dist 700, wheel back out to dist 5611 at the fitted look, page scale 1, 0
  errors) and film r19-galaxy (tour unchanged, 0 errors; 1.5 fps as r10-r16 on this VM at load 51, not a regression).
  Note for T10/T14: under SwiftShader here CDP touch moves arrive ~1 s apart, so a scripted throw never coasts in
  the browser; the coast is pinned by the fake-clock page test.
- [x] T9 (§7 Night 3 D, beacon) [ui] [variant:galaxy] `fx=beacon` finished (was night 2's T41 and the tip of
  night 2's T38; r59-dreamer 5, r54-film-ui 2, r49-accessibility fx): in `galaxy/fx.js` a floor height of ~0.25
  of the frame height at the overview so a young crit shows at once, a white-hot core at its base (carries in
  greyscale and protanopia), age as width as well as height (monotonic), and the sheath fading to zero over its
  top 20 % so the caption plate never cuts it flat — done when: a test in `test/wall-galaxy-fx.test.mjs` pins the
  floor in screen terms at the overview, the core colour, width and height both monotonic in age, the tip alpha
  0, and filmstrips of `galaxy.html?demo=1&quality=0` with and without `&fx=beacon` show the pillar clearly apart
  from the nebula and uncut by the plate. (commit 72c122c)
  Builder r21: `fx.js` sizes are shares of the frame at the overview: `beaconHeight` floor 0.25 → top 0.42 at a
  day (log), `beaconWidth` 0.016 → 0.036, both monotonic; `beaconScale(shot, base, fov)` turns a share into world
  units in closed form from `overviewShot` (the same world size in every shot), tip capped at ndc y 0.9 (a site
  near the frame's top gets less than the floor: the only case two pillars of one age differ). Scene: a sheath
  (crit) and a narrower white core (`palette.sun`, --text-1, brightest at the foot, `coreProfile`) per pillar;
  `beamProfile` gives the sheath its fade to exactly 0 over the top 20 %; the tip light smaller (90) and dimmer.
  Found by filming: a pillar sized for the overview stood as a full-height red wall across the close shot of a
  neighbouring system (`r21-galaxy-beacon` first take, 87 s); `beaconNear` now fades a beacon once it looks
  1.8-3.5x wider on screen than at the overview (also fades its own system's pillar when held close, as
  r17-operator asked). Films `shots/r21-galaxy-beacon` and `shots/r21-galaxy` (without): pillar a thin red line
  with a white foot, clearly apart from the nebula, no red wall, 0 errors, 1.5 fps as every SwiftShader film here.
  Stills `shots/r21-before`/`r21-after` (`at=overview`). Left for others: the tether (T16) still draws a red line
  from the banner to the node, which at the overview can read as a second beacon.
- [x] T10 (§7 Night 3 C3) [ui] [variant:galaxy] Touch, tap a site: hit-testing in screen space over
  `screenOf` discs with a finger-sized radius (48 css px floor, Q6's 10 mm; labels count as targets) — at the
  overview hits resolve to sites only; a tap is `pointerup` within 300 ms and 12 px; a tap on a site flies the
  camera there and opens it, brackets show within 100 ms; multi-pointer or a palm-sized contact is ignored (the
  night-2 r31-touch note under Later) — done when: a test of `hitTest(points, x, y, radius)` covers a near miss,
  a tie (the worst status wins, then the nearest), a label hit and a palm, and a pointer-event test on the page
  sees a tap on a site's screen point focus and open that site. (commit b5d248e)
  Builder r28 (code by r24-r25, which ran out before marking it): `touch.js` `TAP` (300 ms, the drag's 12 px slop,
  radius 27 px = a 54 px disc, Q6's 10 mm; palm over 120 px), pure `hitTest` (worst tone, then nearest; a shown
  name counts as 0 away), `tapPoints` (sites at least half grown, `screenOf`, nebula tone, `labels.shown()` boxes),
  `isPalm`, `createTaps` (asked at the down, so a star drifting under the finger is not lost; a second finger,
  a move past the slop, 300 ms or a palm is no tap; only in `explore`). `hud.open(leg)` brackets at once, plate on
  arrival; main flies at the tour's zoom. Empty sky does nothing yet (T13). Checked: CDP script r28-touch (wake →
  overview → drag → tap HV2's point: brackets on it 400 ms later, the system open and its plate 4 s later, page
  scale 1, 0 errors) and film r28-galaxy (tour unchanged, 0 errors, 12.5 fps under SwiftShader as every film here;
  a tap costs nothing per frame: the hit test runs only on a pointerdown).
- [ ] T11 (§7 Night 3 C3) [ui] [variant:galaxy] Touch, the detail sheet: a tapped site shows a sheet in big
  type (`wall.css`, the caption's type steps) with the site's worst things first (from the model, as
  `galaxy/hud.js galaxyCaption` ranks them); in an open system a tap on a planet (hit-tested as T10, worst then
  nearest) shows its own details (status, why, cpu/mem, `detail`); built with DOM APIs, never `innerHTML` —
  done when: tests show the sheet's rows for a site in trouble (worst first) and for a planet, and a still of
  a tapped `hv2` shows the sheet readable at the 3 m check (shrunk still).
- [ ] T12 (§7 Night 3 A1, D warp) [ui] [variant:galaxy] `fx=warp` (was night 2's T42, r59-dreamer unforgettable
  1): during a flight the near dust and far stars stretch into short streaks along the direction of travel,
  tinted toward the destination's status (grey for calm, a faint amber or red edge for trouble), and snap back
  on arrival; the near-plane dust thins during the flight; off by default, none in still mode; must not add
  script ms at rest — done when: a test maps flight progress and destination tone to streak length and tint
  (zero outside a flight, zero in still mode, none without `?fx=warp`), and filmstrips of
  `galaxy.html?demo=1&quality=0` with and without `&fx=warp` show streaks only with it.
- [ ] T13 (§7 Night 3 C4) [ui] [variant:galaxy] Touch, back: a big back control (at least Q6's 15 mm, about 80
  css px on the tablet, only while exploring) and a tap on empty sky each go one step back: planet → system →
  overview; the sheet closes with its step — done when: a test walks planet → system → overview through both
  the control and an empty-sky tap, a test pins the control's hit size in `wall.css`, and the control is absent
  during the tour.
- [ ] T14 (§7 Night 3 C5) [ui] [variant:galaxy] Touch, the tour resumes: one minute after the last touch the
  camera eases from where it is back into the tour (no cut, `tour.js` restarted at its next leg, trouble first);
  reduced motion (D5): every touch step as a cut with a short fade, no flights — done when: a pointer-event test
  on the page with a fake clock drives touch → overview → drag → tap a site → detail → back → 60 s → tour
  resumed (and the same in still mode with fades), and a filmstrip of `galaxy.html?demo=1&quality=0` with
  scripted touches (CDP `Input.dispatchTouchEvent`) shows that sequence.
- [ ] T15 (r4-film-ui galaxy 1) [ui] [variant:galaxy] The caption names only a target the camera is on: the
  plate's typing starts at flight progress ~0.9 (night 2's r54-film-ui 4), and during a flight passing sites'
  labels dim to `--text-3` while only the destination's name stays full — done when: a test shows no caption
  characters typed before progress 0.9 of the leg and the non-destination labels at `--text-3` in a flight, and
  a film of `galaxy.html?demo=1&quality=0` has no frame with a typing plate whose site is out of shot.
- [ ] T16 (r4-film-ui galaxy 4) [ui] [variant:galaxy] No stray hard lines: no banner-to-node tether at the
  overview (the node carries its glyph); the caption's leader to its star is one style (2 px, 90° or 45° elbow,
  routed clear of other labels) — done when: a test shows no tether at the overview and a leader that crosses no
  shown label box on the large fixture, and a film shows no straight red line from banner to node or across empty
  sky.
- [ ] T17 (r4-film-ui galaxy 7) [ui] [variant:galaxy] A site label stays on its star: `labels.js` anchors each
  site label to the star's projected point of the same frame, never a stale one — done when: a test moves the
  camera between two draws and finds the label's anchor equal to `screenOf(star)` plus the fixed offset each
  time, and a still at the overview shows `HV2`'s glyph beside its nebula.
- [x] T18 (r11-dreamer galaxy 1; = Later r59-dreamer 7) [ui] [variant:galaxy] The red goes when the trouble goes:
  a cleared crit's banner drops at once to the fleet line's calm size in `--text-2` with only a small red glyph,
  and reads like `HV1 · VM-C OK · WAS DOWN 6 MIN` — done when: a test shows the banner of a cleared trouble
  without the crit slab class or the banner size, calm size and `--text-2`, and the "was down" text with its
  age, and a film of `galaxy.html?demo=1&quality=0` has no full-size red banner while its line says `CLEARED`.
  (commit 348f646) Builder r20: `frame.js clearedLine(model, { id, status, forMs })` → a calm-step line, tone
  `cleared`, `data-was` = the old tone, text `hv1 · vm-c ok · was down 6m` (`was crit 41s` for a crit; the units as
  the tag's `STALE 2M`, not "6 min"); `update(model, { cleared })` uses it only while `worstLine` is calm.
  `hud.js`: `heldModel` (the crit put back at full size, dimmed) is gone; the hold (CRIT_HOLD, T30, same end rule)
  keeps `since`, the first time this page saw that crit (a flap back within the hold keeps it), and feeds
  `clearedOf(hold)`; `fleetCover` covers the cleared line too. `wall.css`: `data-held` dimming gone; cleared =
  2.7vmin, weight 500, `--text-2`, the glyph alone in `--crit`. Decision: a live warn elsewhere (or the same node
  flapping to warn) takes the line over the memory: honest before steady, so T30's "never below crit while it
  flaps" is given up; a flap now reads red slab → amber line → red slab. Film r20-galaxy (`--size large`, 115 s):
  no red slab over a cleared crit (HV2's standing crit takes the line when VM-C clears), 0 console errors, 1.5 fps
  as every SwiftShader film here; still `shots/r20-cleared.png` (frame markup + wall.css): the grey calm line with
  one small red square. The large demo almost never shows the memory itself (some live trouble always stands).
- [ ] T19 (r11-dreamer galaxy 2) [ui] [variant:galaxy] The overview reads as a spiral (follow-up to T3, whose
  ribbon the panel cannot see): narrow the ribbon (half 170) and lay a tighter band at 8-10 % along the spine
  near each site only, never above `--text-3`; soften the vignette's banding (stretched gradient or dither) so no
  concentric rings show — done when: a test pins the near-site band's opacity inside (0.08, 0.10) and the
  ribbon's width, and a still of `galaxy.html?at=overview&quality=0` shows two arms through the sites and no
  ring bands in the vignette, crit nebulae still the brightest things.
- [ ] T20 (r11-dreamer galaxy 3) [ui] [variant:galaxy] Not three reds saying one thing: while a caption plate is
  up and the banner's subject is the plate's subject, the banner drops out (or shows the next problem, as T23
  does when the subjects differ), and the held planet's own label is hidden while the hero names it — done when:
  a test shows the banner hidden or on another subject and the planet label hidden while the plate names the
  same thing, and `?at=hv2` shows one headline plus the planet's bracket.
- [ ] T21 (r17-operator galaxy 1) [ui] [variant:galaxy] A crit is visited first, visited site or not: in
  `tour.js nextLeg` a site whose worst status rose since its visit this cycle (or any crit not yet shown as crit)
  jumps the queue at the next leg — done when: a test on a model where a visited site turns crit mid-cycle gets
  it as the next leg, and a film of `galaxy.html?demo=1&pace=wall&quality=0` reaches a new crit within one leg.
- [ ] T22 (r17-operator galaxy 7) [ui] [variant:galaxy] A calm plate does not shrink the banner: `data-plate`
  carries the plate's tone, and under a calm plate the crit banner keeps full size (or one step down, never level
  with the calm name); under a trouble plate T4's step stays — done when: a test sees the tone in `data-plate`
  and a `wall.css` test pins the banner larger than `--cap-name` under a calm plate, and `?at=home` with a crit
  elsewhere shows the red banner clearly above the white name.
- [ ] T23 (r17-operator galaxy 9 + across) [ui] [variant:galaxy] Trouble rows at the second step: the plate's
  trouble rows (status shape, word, age, in hue; the crit plate takes the warn plate's row format instead of a
  white `1 crit`) are set at the caption's second step; hardware/where/holds stay small — done when: a test pins
  the row size and the crit plate's row format in `test/wall-galaxy-hud.test.mjs`/`wall.css`, and `?at=hv2` shows
  the trouble rows readable in a 3 m shrunk still.
- [ ] T24 (r31-film-ui touch 1; = Later A4 T35 for the sheet) [ui] [variant:galaxy] The sheet follows the trouble
  that rises under it: with a site sheet up, a new model re-ranks its rows and the status line on the spot (no
  retyping), and a crit that appears in the site shows as the hero — done when: a test with a sheet for HV1 and a
  model where VM-C turns crit gets the crit row first and `STATUS` updated at once, and `sheetCaption` is covered by
  the same rule as the tour caption.
- [ ] T25 (r31-film-ui touch 2, 5) [ui] [variant:galaxy] The sheet is yours, not the tour's: kicker `SITE · HV1`
  (or `ROOM · IN HV1`) instead of `ATTENTION · TARGET 01 / 05`, no typing cursor and no typing on a sheet (text at
  once), brackets first on the tapped site, then stepping to the worst member — done when: a test pins the sheet
  kicker, no typing state on a sheet, and the lock target sequence site → worst member.
- [ ] T26 (r31-film-ui galaxy 4; promotes Later A4 T31) [ui] [variant:galaxy] No words on words or off the frame:
  `hud.covers()` includes the clock block, tag and plate; every label keeps a safe margin from the frame edge
  (`HOME` was cut by the top edge) and out of the plate's box (`CLOUD` under `HOLDS`) and the lock bracket — done
  when: a test on the large fixture (`?at=home`, overview, a held site) finds no shown label box meeting a cover or
  crossing the frame edge.

## Research questions

- [x] Q12 (→ research/Q12-touch-3d-map.md) Touch on a 3D map on a wall or tablet screen: how do 3D map tools (Google Earth, CesiumJS, Mapbox GL's
  pitch and bearing, three.js `OrbitControls`) map one-finger drag, two-finger pinch and the wheel to orbit and
  dolly; their pitch clamps, inertia damping (time constants), how a pinch maps to zoom (log or linear), and
  how they tell tap, drag and palm apart (slop px, ms, contact size); and how a small moving 3D target is hit
  in screen space. Night 1's Q6 already has target sizes in mm and idle defaults: do not repeat them — for T8,
  T10
- [x] Q13 (→ research/Q13-wake-and-handback.md) Waking a screensaver by touch and handing back to it: how kiosks, museum interactives and
  attract-mode displays treat the first touch (wake only, or act on it), how they show that the screen is now
  yours, and how they hand back to the attract loop after idle (a warning cue, easing from the user's view,
  what happens when an alarm arrives mid-session). Q6 already has the 30-60 s timeout defaults — for T7, T14
- [x] Q14 (→ research/Q14-stale-feed-ideas.md) IDEAS: making a dead or stale feed unmistakable from 3 m without shouting louder than live trouble:
  how control rooms (ISA-101 / high-performance HMI "stale" or "bad quality" values, SCADA comms-loss),
  aviation displays (failure flags, red X), broadcast "signal lost" and film interfaces show that the data
  itself is old. 2-3 concrete proposals for the galaxy (what it shows, what it means, a cost guess) beside the
  plan's grey sun and `STALE <age>` tag — for T5, T6
- [x] Q15 (→ research/Q15-touch-kiosk-and-wake-lock.md) Touch that never breaks a kiosk: Chromium on a Windows touch tablet in kiosk or fullscreen mode
  (the Surface Pro 7 class): which edge swipes, long-press, pinch-zoom and pull-to-refresh behaviours the page
  can stop (`touch-action`, `overscroll-behavior`, the viewport meta, `contextmenu`) and which only the OS or
  Chromium flags can, and how Screen Wake Lock behaves there — for T7, Later (wake lock)

## Later

Night 3's list, not yet a task (README §7 Night 3; replan takes from here in order):
- §7 Night 3 A4 (was night 2's T31, r43-stranger galaxy 2) No words on words: the clock block in
  `hud.covers()`, site labels kept out of the plate's and the tag's boxes; a test shows no shown label box
  meets the clock, plate or tag on the large fixture (`?at=home`, overview).
- §7 Night 3 A4 (was night 2's T34, r49-accessibility galaxy 4) The trouble planet's name readable at 3 m: in
  `labels.js` warn/crit members of the held system at least the room step + 1, weight 500, on a `--bg-canvas`
  plate; calm names stay at the room step.
- §7 Night 3 A4 (was night 2's T33, r49-accessibility galaxy 1) Crit the most visible status for low vision too:
  on the Wall only (`html.wall` token override read by `paletteFrom`) lift `--crit` toward oklch 70 % (hue kept,
  ~7:1), brighter crit nebula core, the banner's crit glyph and word on a `--p1` slab (now possible: `frame.js`
  is not fenced); a protanopia still shows crit brighter than warn.
- §7 Night 3 A4 (was night 2's T35, r49-accessibility galaxy 3) The caption follows a status that rises while
  held: in `hud.js` a warn → crit of the held site re-feeds the caption lines and the lock target at once (no
  re-typing); a fall waits for the leg's end.
- §7 Night 3 A4 (was night 2's T38, r54-film-ui 2) Feathered plates: the fleet block's and the caption plate's
  ground get a `mask-image` falloff (~4 vmin) or a text-shadow halo; the corner brackets stay the only hard
  lines (the beacon's tip is in T9).
- §7 Night 3 A5 (night 2's r49-accessibility 7) Accessibility: no letter-by-letter typing for screen readers
  (`caption.js` plate `aria-live="off"` while typing, one visually hidden live node with the full text), the
  fleet line `role="status"` announcing only on a change of subject or tone; `+N MORE` readable at 3 m and a
  48 px tappable chip (`frame.js`, r31-touch 5) whose tap flies to its node.
- §7 Night 3 A6 `wall.html?variant=islands-tiles` registered (`variants.js` + `main.js`, the diff in
  `sketch/main.js.diff` and night 2's For the owner, T7's modules exist), so the galaxy's no-WebGL fallback
  (`galaxy/fallback.js`) lands on it, not on radial.
- §7 Night 3 D `fx=afterglow`: a cleared trouble leaves a faint outline ring in its old hue on the plane,
  cooling red → amber → grey, gone after ~30 min; outline only, never filled or pulsing, quieter than any live
  trouble; the page remembers the clears it saw (no server route, D2), a reload forgets them.
- §7 Night 3 D `fx=sweep`: once per tour cycle, at the overview only, one faint sensor line from the sun turns
  once round the plane; a cluster it crosses pings softly only if its site sent new data since the last sweep
  (after T5: `fresh.js` per site).
- §7 Night 3 D `fx=activity` (replaces `comets` and `twinkle`; night 2's research Q8 `fade` and `miss`): a planet
  with a working session or a running job is brighter, slightly larger and carries a slow visible ring; a job
  that lands flashes its target once; a failed one visibly does not land; visible at the overview from 3 m.
  `comets` and `twinkle` go when it lands.
- §7 Night 3 D `lanes` removed: code in `galaxy/fx.js`/`scene.js`, its tests and every mention in docs.
- §7 Night 3 E `docs/wall.md` (what it is, a tablet in kiosk mode, the URL switches `?demo`, `?pace`, `?fx`,
  `?perf`, `?at`, `?open`, `?quality`, the feed fields `glow`/`ring`, touch, how to stop the tour; r43-stranger 1)
  and a Wall row in README's views table; `docs/map.md` says which page paints `glow`/`ring`.
- §7 Night 3 E A web manifest for the galaxy (`start_url: "/galaxy.html"`, fullscreen, landscape) if it fits the
  guardrails (night 2's For the owner, r43-stranger 6).
- §7 Night 3 E `wall.html?variant=galaxy` opens `galaxy.html` instead of silently falling back to radial
  (r43-stranger 2; also an "unknown variant" note on the tag for other names).
- (was night 2's T32, r43-stranger 6; not named by Night 3, fits E) Screen Wake Lock in `galaxy/main.js`: request
  at start and again on visible, silent when denied or missing (Q15).
- §7 Night 3 D unbuilt, staying unbuilt: `fx=storm`, `fx=lights`, `fx=rings`, `fx=arrive`.

From r31-film-ui (not tasks yet):
- (r31-film-ui galaxy 6, fx-beacon 1) Draw the beacon pillar screen-vertical (billboard on x), not leaning with perspective.
- (r31-film-ui fx-beacon 3) Beacon white foot twice the core width over the bottom 10 %, so the foot reads as "here".
- (r31-film-ui touch 4) A tap right after a coasting drag did nothing once: check it in the fake-clock page test (may be SwiftShader lag).
- (r31-film-ui galaxy 5, 7; across) Calm holds leave two thirds empty, no arrival beat: covered by the r54-film-ui 8 and r15-dreamer 7 lines below.
- (r31-film-ui fx-beacon 2) Nothing left after a crit clears: `afterglow`'s job (above).

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

- (Q14 research, for T6; taste) A stale feed that keeps its crit nebula red and brightest looks like live trouble.
  The research suggests freezing all liveness motion (`freeze`, small), a slashed grey ring at the sun (`flag`),
  and marking last-known trouble with a hatch and one step less brightness (`lastknown`). Not tasks; see
  research/Q14-stale-feed-ideas.md.

- (r4-film-ui, across the variants; taste) Idea: the folded trouble cluster at the overview could take the beacon's
  vertical silhouette, so shape carries where colour does not. Not a task.

- (r11-dreamer galaxy 4, taste) A calm plate could carry one or two quiet facts (`12 rooms · 3 working · last
  deploy 14m`) so a calm hold says why it is calm. Not a task.
- (r11-dreamer galaxy 9, taste) Put the best accidental frame on purpose: hold the camera's last ~0.8 s of a
  trouble arrival at the mid-open angle with nebula, brackets and plate. Not a task.
- (r11-dreamer across 2, taste) Calm open systems could take the trouble system's composition: centred, large,
  stems for depth, without the red. Not a task.
- (r11-dreamer, `fx` candidates, none asked for) `fx=tide`: calm nebulae breathe at ~8 s by how busy the site is,
  a silent site stops breathing (≤ 6 % swing, trouble stays louder). `fx=telemetry`: in a held system a ring round
  each planet drawn to cpu and mem, status hue on trouble members. `fx=trail`: a faint dotted arc between the
  systems the tour visited this cycle.

- (r31-film-ui across, taste) The touch overview's lower, wider pitch is the best composition so far; the tour's
  overview could take that pitch for its first beat. Not a task.

## Reviews

- r11-dreamer.md: 9 galaxy + 3 beacon + 2 across + 3 unforgettable; 3 became tasks (T18, T19, T20); galaxy 4 (the
  frame idea is in Later; the calm facts to the owner), 9 to the owner; galaxy 5, 6, 7, 8 and beacon 1, 3 dropped
  (covered by T16, T9, Later A4 feathered plates, Later r15-dreamer 4, Later r26-skeptic 4); beacon 2, comets,
  twinkle, lanes dropped (observation, retired); across 1 already with the owner, across 2 to the owner; the three
  `fx` ideas to the owner.
- r4-film-ui.md: 12 findings (9 galaxy, 3 fx-beacon) + 2 across; 3 became tasks (T15, T16, T17); galaxy 2 and 9 and
  beacon 1, 2 dropped (covered by T4, T3, T9); galaxy 3, 5, 6, 8 and beacon 3 went to Later; across 1 dropped
  (observation), across 2 to the owner.
- r17-operator.md: 9 galaxy + 3 fx-beacon + 2 touch + 3 across; 3 became tasks (T21, T22, T23); galaxy 2 (= T18; operator
  wants it ahead of the fx tasks: do T18 before T9/T12), 3 (= T15), 4 (= T16) and fx-beacon 1-3 (= T9) dropped
  (covered); galaxy 5, 6, 8, fx-beacon notes, touch 1-2 and the demo-pace note went to Later; lanes/comets/twinkle
  not filmed, dropped (retired). No dreamer proposals in this review.
- r31-film-ui.md: 8 galaxy + 6 touch + 3 fx-beacon + 2 across; 3 became tasks (T24, T25, T26); galaxy 1, 2, 8 and touch 3
  dropped (covered by T16, T20, T19, T13); galaxy 3, 5, 7 (Later already), galaxy 6, touch 4, fx-beacon 1-3 went to
  Later; touch 6 dropped (observation); across 2 to the owner; across 1 dropped (already the plan); lanes/comets/twinkle
  not filmed, dropped (retired).

## Scores

| round | persona | overview | legibility | status | touch | wow | calm | performance |
|---|---|---|---|---|---|---|---|---|
| r4 | film-ui, galaxy | 6 | 6 | 7 | 1 | 6 | 5 | 6 |
| r4 | film-ui, fx-beacon | – | – | – | – | 6 | 6 | – |
| r4 | film-ui, fx-lanes | – | – | – | – | 2 | 8 | – |
| r4 | film-ui, fx-comets | – | – | – | – | 3 | 7 | – |
| r4 | film-ui, fx-twinkle | – | – | – | – | 2 | 9 | – |
| r11 | dreamer, galaxy | 5 | 6 | 6 | 1 | 5 | 4 | 6 |
| r11 | dreamer, fx-beacon | – | – | – | – | 6 | 6 | – |
| r11 | dreamer, fx-comets | – | – | – | – | 2 | 8 | – |
| r11 | dreamer, fx-twinkle | – | – | – | – | 2 | 9 | – |
| r11 | dreamer, fx-lanes | – | – | – | – | 2 | 8 | – |
| r17 | operator, galaxy | 7 | 6 | 5 | 2 | 6 | 5 | 6 |
| r17 | operator, fx-beacon | – | – | – | – | 5 | 5 | – |
| r17 | operator, fx-lanes | – | – | – | – | 2 | 7 | – |
| r17 | operator, fx-comets | – | – | – | – | 2 | 7 | – |
| r17 | operator, fx-twinkle | – | – | – | – | 2 | 8 | – |
| r31 | film-ui, galaxy | 6 | 6 | 6 | 5 | 6 | 5 | 6 |
| r31 | film-ui, fx-beacon | – | – | – | – | 6 | 6 | – |
| r31 | film-ui, fx-lanes | – | – | – | – | 2 | 8 | – |
| r31 | film-ui, fx-comets | – | – | – | – | 3 | 7 | – |
| r31 | film-ui, fx-twinkle | – | – | – | – | 2 | 9 | – |

## Morning
