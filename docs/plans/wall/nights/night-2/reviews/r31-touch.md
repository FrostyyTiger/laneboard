# Review r31: the touch user

Persona: touch. One finger, standing, no keyboard, no mouse, no hover. Judged on `galaxy` at HEAD `538f1d8`
(T1-T15 built) and on the built `fx`: `lanes`, `comets`, `twinkle`.

Material:
- Filmstrip `$RUN_DIR/shots/r30-galaxy/sheet.png` (`?demo=1`, large demo, CPU 4x, SwiftShader, 2.4 fps, worst
  gap 2456 ms). It was filmed 5 minutes before the T15 commit (99a7f86) from that round's working tree, so it
  shows what is built.
- fx sheets: `r25-galaxy-lanes`, `r28-galaxy-comets`, `r29-galaxy-twinkle` (each with its `-off` twin). They are
  older than T15. T15 changed trouble sizes, not the effects.
- Made this round, 1368x912 css px at 2x (the tablet), `quality=0`: `$RUN_DIR/shots/r31-touch/` stills of the
  overview and of `?at=hv1&open=1` (`?at=lab&open=1` gives the same frame). Each has a `.json` from
  `$RUN_DIR/tools/touchprobe.mjs`: the drawn radius and the gap to the nearest neighbour, in css px, for every
  site and member on screen.
- 3 m still: `$RUN_DIR/shots/r31-3m.png` (the overview at 684 px wide, top of the image).
- Code read for input: `public/galaxy.html`, `public/js/wall/galaxy/*.js`, `public/js/wall/tour.js`,
  `public/css/wall.css`.

The touch explorer is not built. README §7 says touch (D4) waits for night 3. There is no pointer, touch or
click listener anywhere in `public/js/wall/` (the only listeners are `visibilitychange` and the socket). So this
review mostly says what the galaxy's layout makes easy or hard for the explorer night 3 will build, with
numbers. I use the plan's touch target, 48 css px (about 9 mm on the tablet at 2x).

## galaxy

1. **A tap does nothing at all, and nothing says so.** I touch HV2's red cloud on the overview: no flash, no
   lock, the tour flies on. From the code: no handler on `#galaxy`; the layers above it have
   `pointer-events: none` (wall.css 60, 84, 322, 380, 557, 600). It matters because §2.3 is one of the five
   promises, and every panel score for touch so far has been 2. Fix, for night 3: one `pointerdown` on the
   stage (not per object). Within 100 ms, draw the lock's brackets round whatever the tap hits, even before
   the flight starts. Then `tour.stop()` and fly there with `camera.focus`. A tap that hits nothing gets a
   brief ring where the finger landed, so the screen still answers.

2. **In a held system in trouble, every trouble planet sits under the caption plate.** Still
   `r31-touch/…at_hv1_open_1_.png`. All seven trouble members are top left, under the plate: room-c (539,151),
   builder-c (618,148), feat-search (260,258), search ui (231,256), fix-login (278,250), ci-retry (422,182),
   acme-billing (468,166). The plate ends at about x 580, y 400 css. Everything I can see and would want to
   tap (proxy, db, dns, registry) is calm. The filmstrip shows the same (r30 frame 11, HV2's storage in the
   plate's corner). A finger cannot aim at what it cannot see. Fix: T18 (aim at the free rect). When the
   explorer lands, the plate must also go small, or move to the edge away from the target.

3. **The trouble planets are bunched closer than one fingertip.** Same still, probe numbers. feat-search,
   search ui and fix-login are 20-25 css px apart (all three fit under one 48 px finger). builder-c and room-c
   are 17 px apart, acme-billing 10 px from its neighbour. Of the 41 members on screen, 11 have a 48 px gap to
   their nearest neighbour and 3 are drawn 48 px wide. Calm dots (certs, redis, metrics, logs) are 8 px
   across and 15-30 px apart. It matters because the things I am most likely to tap are the ones I cannot tap
   alone. Fix: hit-test the 48 px disc round the finger, not the sphere. When it covers more than one member,
   pick the worst status, then the nearest. If two in trouble tie, show a small fan of 48 px name chips round
   the finger and let me pick one. Have `placeLabels` treat a trouble label as part of its planet's hit
   area: the label ▲ FEAT-SEARCH is wider and easier to hit than the sphere.

4. **At the overview, the sites are fine targets, but the things inside them are not.** Overview still and
   probe: the five clusters are 190-330 css px apart (hv2 to remote is the closest pair, ~200 px), and each
   name is a 26 px label 60-140 px wide. Easy to hit. Inside a folded cluster, though, members are 3 px across
   and 0-3 px apart (105 members inside five clusters). That is right for a fold, as long as a tap on a folded
   cluster means "open this site" and never "pick a member". Fix: at the overview, hits resolve to sites only,
   over a disc of max(48 px, folded reach). The site label counts as part of the target.

5. **The biggest, loudest thing on screen is the banner, and it is not a target.** Overview and r30 frames
   1, 7-12: `■ HV2 · STORAGE` at the hero size, ~400x80 css px, bottom right. It is the first thing my finger
   goes for. Fix: in night 3, a tap on the far fleet line flies to that node (it names one). It is the
   easiest 48 px target on the page. `+3 MORE` beside it is 10 px mono: make it a 48 px tall chip that opens
   the list of the other problems, or drop the promise.

6. **CLOUD cannot be reached at the overview.** Overview still: CLOUD's cluster (712,760 css) is under the
   far fleet block, with no name and no glow. On the 3 m still it is gone too. Even with the banner as a
   target, a tap there would go to STORAGE, not CLOUD. Fix: T19 (offset the overview so no site sits under a
   cover). Until then, the tour is the only way to CLOUD.

7. **There is no way back, and the explorer will need one that a finger finds.** Nothing on screen reads as
   "back" or "overview". The tag top right (`LANEBOARD · DEMO-HOST LIVE`) is 11 px mono, a natural spot but
   too small. Fix, for night 3: a tap on empty space (no target within 48 px) goes back one level (member →
   system → overview). Also a fixed 56 px corner button, shown only while exploring, under the tag. Two-finger
   pinch-out to the overview is a bonus, never the only way.

8. **Resume after a minute: the tour can do it, but nothing tells the person who walked away.** `tour.js` has
   `stop()` and starts again from `createTour`; there is no idle timer yet, which is fine before night 3. Fix:
   when touch takes over, a thin countdown line under the tag (60 s, grey, drawn once and then shrinking)
   shows the screen will go back to the tour. Any touch restarts it. Return through `fit()`, so the camera
   pulls out and never cuts.

9. **Accidental touches are already harmless, and that has to survive night 3.** `#galaxy` has
   `touch-action: none` and the html has `overscroll-behavior: none`, so a palm cannot pinch-zoom the page,
   pull-to-refresh or scroll. `user-select: none` and no tap highlight. No links on the page, so a sleeve
   cannot navigate away. Risk once input lands: a palm (several pointers, or a contact over ~30 mm) flies the
   camera somewhere random, and a leaning shoulder keeps the tour stopped forever. Fix: ignore a
   `pointerdown` when two or more pointers are down, or when `width`/`height` > 120 css px. Count a tap only
   as `pointerup` within 300 ms and 12 px of the down. A long press (> 600 ms) does nothing.

10. **During a flight, nothing holds still long enough to aim at.** r30 frames 2, 6, 7: mid-flight, the
    system is a blur of spheres and the target moves ~50 px between frames at the film's rate. On the tablet
    at 60 fps it moves less, but still. A tap during a flight hits whatever slides under the finger. Fix:
    during a flight, a tap resolves at `pointerdown`, against `screenOf` from that frame, and only to sites.
    Members can be picked once the system is held (open ≥ 0.85).

11. **The held drift moves targets too.** The held camera keeps circling the star (T4), so a planet slides a
    few px per second under a finger. Fix: when touch takes over, ease the drift to zero over ~400 ms, and
    bring it back when the tour resumes.

## fx-lanes

1. Nothing to tap, nothing in the way. The pulse runs along hyperlanes far from any label. In r25-lanes I
   could not tell it from the off sheet at a quarter size. The pulse should never be a hit target, and a tap
   along a lane must not go to it.

## fx-comets

1. A comet crosses the open system while I might be aiming. In r28-comets I could not find one at sheet size,
   so it is small. Fix for night 3: comets do not take hits (`raycast` off). While a finger is down, a new
   comet waits until `pointerup`, so nothing new flies under the finger.

## fx-twinkle

1. It twinkles on the planets I would tap, which could make them look "active" or pressed. In r29-twinkle the
   held systems (frames 4, 8, 11) look the same as without it at this size, so it is soft enough. The
   explorer's tap feedback must not look like a twinkle: use the brackets, not brightness.

## Across the variants (what to steal)

- From `wall.html` (night 1): the Map's 2D `screenOf` hit list is cheap and flat. The galaxy should hit-test
  in screen space the same way, over projected `screenOf` discs, not by raycasting 3D spheres. That way the
  48 px rule is one number and the label boxes join the target.
- From the caption's trouble-first ordering (`tour.js` `tourOrder`): the touch explorer's "next" button, or a
  swipe if it ever gets one, should step through sites in the same order, trouble first, so one finger can
  read the fleet in five taps.
- From `fx=comets`' rule that a flow flies once: tap feedback should also play once and then be still. No
  looping highlight on the touched thing.

## Rubric

score galaxy overview 6
score galaxy legibility 6
score galaxy status 6
score galaxy touch 2
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-lanes wow 3
score fx-lanes calm 8
score fx-comets wow 3
score fx-comets calm 7
score fx-twinkle wow 3
score fx-twinkle calm 8

Touch is 2: nothing answers a finger yet (planned for night 3). What lifts it above 1: sites are well
spaced at the overview, and the page is already safe against palms and scrolling.

## 3 m check

`$RUN_DIR/shots/r31-3m.png` (the overview at 684 px wide). **Yes for whether and where, no for every site.**
`■ HV2 · STORAGE` reads at once, in red with its square. HV2's red cloud and HV1's amber cloud with ▲ are the
loudest things, and REMOTE, HV2, DEMO-HOST, HV1 and HOME all read. CLOUD is missing (under the banner, T19). The
fleet line's `+3 MORE` and the tag are too small to read. For touch, that means four of five sites are things
I could walk up to and tap. The fifth I could not find.

## console.txt

- `r30-galaxy/console.txt`: empty (0 lines).
- `r25-galaxy-lanes/console.txt`: empty (0 lines).
- `r28-galaxy-comets/console.txt`: empty (0 lines).
- `r29-galaxy-twinkle/console.txt`: empty (0 lines).
- `r31-touch/galaxy_html_quality_0_.console.txt`: `console: 0` (my probe's count of console messages and
  exceptions, none).
- `r31-touch/galaxy_html_quality_0_at_hv1_open_1_.console.txt`: `console: 0`.
- `r31-touch/galaxy_html_quality_0_at_lab_open_1_.console.txt`: `console: 0`.
