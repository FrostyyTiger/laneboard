# r56 — performance engineer (night 3)

Target: 2019 tablet, i3-1005G1, 4 GB, 2736x1824 at 2x, Chromium kiosk, all day. Code at `c8c91b9` (T25).

What I ran (all on `demo-fleet.mjs --size large`, 1368x912 at dpr 2, CPU throttled 4x, SwiftShader):
- `shots/r56-galaxy` (film, `?demo=1&quality=0&fx=beacon`): 9.2 fps, worst gap 384 ms, 0 errors.
- `shots/r56-galaxy-plain` / `r56-galaxy-warp` (8 frames each): 10.8 / 10.2 fps, worst 396 / 505 ms, 0 errors.
- `shots/r56-probe.json`: 10 minutes of `?demo=1&fx=beacon&perf=1&quality=0`, a sample per minute after a forced GC
  (heap, DOM nodes, listeners, layouts, style recalcs, `renderer.info`), two wake/tap cycles at minutes 3 and 6,
  and a 15 s CPU profile (`r56-probe-profile.txt`).
- `shots/r56-touch` (gesture film with timing per phase): tour → wake → drag → pinch → tap HV2 → tap sky (back)
  → 65 s idle → tour.
- Layout counts over 10 s: parked `?at=overview`, parked `?at=hv1`, the tour.

The 27-30 fps bar cannot be judged on this VM. SwiftShader runs the GPU on the CPU; the profile shows the main
thread **86 % idle** while frames take 60-190 ms. The page's own JavaScript costs 3.2-9.5 ms a frame under the 4x
throttle (about 1-2.4 ms unthrottled). So the 9-15 fps here is the VM's fill rate, not the page. The only real
fps number is the owner's on the Surface ("running good"). Each finding below gives the line and the fix.

## galaxy

1. **The film's "worst gap" is always the page load.** `perf.js:18` keeps `worstGapMs` as a lifetime max.
   In the probe it reads 387 ms at the first sample (8 s after load) and 387-404 ms for the next 10 minutes.
   Every `perf.json` worst gap this night (384, 396, 487, 505) is the boot hitch, not stutter in the motion. The
   panel scores stutter from a number that never moves. Fix: keep the worst gap per window in
   `budget.js createFrameWindow` (`worstMs`, reset each window, as `frameMs` is), and have `perf.js` ignore gaps
   until the first model is drawn plus 2 s (or expose `worstGapMs` over the last 10 s and the boot gap as
   `bootGapMs`). Test: a fake clock with a 400 ms first gap and 16 ms after it reads under 20 ms after 10 s.
   (= night 1's T39 under Later; still open, now measured.)
2. **No frame cap: full renders at the display rate all day.** `galaxy/main.js:335 tick` draws on every rAF
   (60 Hz on the Surface): a full `renderer.render` at 2736x1824 with `antialias: true` (`scene.js:348`, MSAA
   on 5 MP) and ratio 2 at level 0. That happens during a 10 s overview hold too, where only the breath (2.6 s
   period) and the dust (one turn in 26 min) move. §2.4 asks for 30 fps and **no heat**. Rendering at 60 doubles
   the GPU work and the power draw for all of the hold time, which is most of the day. Fix: a `frameCap` in
   `tick`: 30 at holds, the overview and in reduced motion; 60 only in a flight and under a finger
   (`touch.mode() !== 'tour'`). `budget.js` judges against the cap (`missMs` from the cap, not 1000/60). The
   owner asked to keep the sketch's 60 on the Surface, so the hold cap needs their OK; the 60-in-flight half
   keeps what they saw. (= Later r37-performance 6.)
3. **Draw calls go up 4x when a system opens.** `renderer.info`: 45-52 calls and 13-15k triangles at the
   overview, 203-206 calls and 87k triangles with HV1 open (probe minutes 3, 6, 9). The trouble hold lasts 14 s,
   so this is the frame the tablet draws longest. Every member is a Mesh, a halo Sprite and a mark Sprite
   (`scene.js:617-619`), and the dots use the full sphere segments at level 0 (`spheres(1)`, `scene.js:397`) on a
   4-unit ball that is 2-6 px on screen. Fix: (a) dots at a fixed 8x6 segments at every level (most of the 87k
   triangles); (b) later, one `InstancedMesh` per sphere geometry and tone for members (5 calls, not about 120).
   Measure (a) on the Surface with `?perf=1` held on HV1 (`?at=hv1`): calls and triangles are in the overlay.
4. **`scriptMs` does not see the DOM cost.** `main.js:337-347` times `tick`'s JavaScript only. The style recalcs,
   layouts and paints that the labels, the lock and the caption cause run after it, and so do the GPU's waits.
   In the tour I counted about 1.1 style recalcs a frame and 0.27 layouts a frame (156 and 38 over 141 frames;
   parked at the overview: 13 and 13 over 136 frames). That is fine, but the budget's "room" (`roomMs: 6`)
   cannot see a DOM regression. Fix: put the style-and-layout time per window in the `?perf=1` overlay too, from a
   `PerformanceObserver` on `long-animation-frame` (LoAF `styleAndLayoutStart`; check the Chromium version on the
   kiosk supports it). It is for the overlay only, not for the budget.
5. **Every flight frame redoes work that is fixed per flight.** `camera.js:118 flightPose` samples
   `arcPose` 2 x 23 times plus `standBack` per end on every frame of every flight, and `avoid()` (`camera.js:282`)
   spreads a new object per site per frame. Measured: `flightPose` is 0.1 % of the profile, so this is no task
   on its own. Fix when someone is in there: compute `extra` and the swell's `scale` once in `go()` (the ends
   drift only by the hold's sway).
6. **`setOpen` re-places the whole galaxy per call.** `scene.js:916-921` calls `place()`, which walks every
   site's members and 16 ring segments per planet. `camera.js frame` calls `setOpen` for each site whose
   opening changes (two during a hand-over), and `advance()` places again. Measured: `place` 0.2 % plus `setOpen`
   0.1 % of samples. Fix: set `dirty` in `setOpen` and let `advance` place once. (= Later r37-performance 4.)
7. **Per-frame garbage.** `labels.js:252 draw` builds `items`, `meta` (a Map), `bodies` and a candidate list per
   label every frame. `scene.js:1292 heldDust` spreads an object, `scene.js:1188 drawBeacons` makes a
   `[pillar, core]` array per beacon, and `camera.js frame` makes `{ ...view(), ends, avoid }`. The GC takes
   0.2 % of the samples and the heap after GC is flat, so this is no task. Fix with r37-performance 7: reuse the
   arrays and memoise `labelSize`.

Measured and fine (no finding):
- **No growth in 10 minutes** with two wake/back cycles. Heap after GC 5.3 → 6.6 → 5.9 MB; DOM nodes 194-311
  and bounded (labels come and go with the open system); event listeners **20 the whole time**; three.js
  geometries 26 and textures 7, flat; 10 shader programs, flat. Ten minutes is not the plan's hour: owner, leave
  `?perf=1` up for an hour on the Surface and compare the overlay's memory line at the start and the end.
- Timers: one 1 s `setInterval` (`main.js:405`, writes only on change) and the socket's back-off; the caption's
  timers are cleared per leg. Nothing stacks up.
- Layout reads are cached by key (`hud.js fleetCover`, `tagCover`, `frame.js cover`, `caption.js build` once
  per leg). I found no read-after-write in a frame.
- Canvas: 2736x1824 at level 0, dpr capped by `pixelRatioFor`; the budget steps to 1.5 and 1.25.

## touch (filmed: `shots/r56-touch/sheet.png`, times per phase in each caption)

1. **Gestures cost no more than the tour.** Script ms per frame by phase: tour 7.95, wake 6.29, drag 4.89,
   pinch 4.27, tap site 3.66, back 4.79, idle 5.63, resumed 4.84. Median frame gap 50-83 ms in every phase, the
   worst 167-233 ms in every phase (the VM). A drag at 25 Hz moves (40 ms apart) is not held up by the page.
   Every step worked: the wake went to the overview, the drag turned the galaxy, the pinch closed in, the tap
   opened HV2's sheet with BACK, the tap on the sky went back, and after 65 s the tour came back on its own
   (frames 07, 08).
2. **Inertia comes to rest properly** (`touch.js:235 inertia` zeroes below `REST.turn` / `REST.zoom`, so no
   frames of motion too small to see). When finding 2's cap lands, the "under a finger" state should include the
   coast until `atRest`, so the coast runs at 60 and a hold after it drops to 30. Not a speed finding: frame 04,
   a 20-step pinch, ends close and low, with HV1 at the top edge (a framing note for the touch persona).

## fx-beacon
1. Three extra draw calls per crit (pillar, core and tip, additive). `beaconScale` is cached per world
   version (`scene.js:1146`). The cost is negligible. One cost remains: the pillars are additive on a
   5 MP canvas, so they add fill rate on the tablet's GPU. On the Surface, compare `?fx=beacon&perf=1` with
   no fx: the owner's "running good" was with beacon on.

## fx-warp
1. Hidden at rest; a frame then costs one check (`scene.js:1261`). In a flight it adds `WARP_STARS + WARP_DUST`
   additive line segments over the full screen. Film: 10.2 fps with warp against 10.8 without (same run, 8
   frames each), so about 6 % on this VM's fill rate, which is about what it costs. On the tablet the cost lands
   only during flights, which is the time T-cap (finding 2) leaves at 60. Fix: none needed for speed; if the
   Surface shows a dip in flights, halve `WARP_DUST` at level 1.

## Across

- The parked overview (`?at=overview`) writes almost nothing to the DOM: 13 style recalcs in 136 frames. The
  labels and the lock skip unchanged writes there (`labels.js:317-319` compare the key and alpha before writing).
  The tour should get the same: the lock (`lock.js:241-245`) writes four transforms and an opacity every frame,
  even when the brackets have closed and the drift moves them under 0.1 px. Compare a rounded key as
  `labels.js` does.
- The gesture path (touch.js) adds no per-frame cost of its own; the camera code should follow it.

Housekeeping seen this round: an orphaned SwiftShader Chrome from an earlier round
(`--user-data-dir=/tmp/touch-A1GyfW`, a gpu process at 374 % CPU) was running when this round started (load
8.3). The reaper removed it by 03:48 (load 2.8). Films made while it ran are slower. `r56-galaxy` was made then,
and the plain/warp pair after it was gone.

## Scores

score galaxy overview 7
score galaxy legibility 6
score galaxy status 6
score galaxy touch 7
score galaxy wow 6
score galaxy calm 6
score galaxy performance 7
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 5

Performance 7: the JavaScript is cheap (about 1-2.4 ms a frame unthrottled), and nothing grows over 10 minutes.
It loses points for no frame cap (heat, §2.4), the 4x draw calls in an open system, and a worst-gap number that
measures the boot. Touch 7: from the gesture film, every step works and none costs more than the tour.

## 3 m check

`shots/r56-3m.png` (`r56-overview/custom-dark-1368.png`, `?at=overview`, scaled to 342x225; the top of a taller
image). **Yes.** The red `■ HV2 · STORAGE` banner and the red nebula with its square at HV2 tell you what is
wrong and where. The yellow triangle at HV1 reads as the second problem. The site names (REMOTE, HV2, DEMO-HOST,
HV1, HOME, CLOUD) are about 5 px tall but still readable as words, the calm ones only just. The tag top right
cannot be read, and that is fine.

## console.txt

- `shots/r56-galaxy/console.txt`: empty (0 lines).
- `shots/r56-galaxy-plain/console.txt`: empty (0 lines).
- `shots/r56-galaxy-warp/console.txt`: empty (0 lines).
- `shots/r56-overview/console.txt`: empty (0 lines).
- `shots/r56-touch/console.txt`: 8 times `pageerror TypeError: Cannot read properties of null (reading 'push')
  at <anonymous>:1:76`, as 16 lines (message and stack line). This is my probe's own frame-gap counter, not the
  page: it set `window.__g = null` while one rAF callback was still pending, and that callback threw. Nothing
  from the Wall's code.
- `shots/r56-probe.json` `logs`: `[]` (errors and warnings over 10 minutes: none).
