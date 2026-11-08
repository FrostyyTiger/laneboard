# r35: performance engineer (night 5)

Target: a 2019 tablet (i3-1005G1, 4 GB, 2736x1824 at 2x), Chromium in kiosk, all day. Code at `9a49689` (T14), the
last commit to `public/js/wall` and `wall.css`. The last performance review was night 4's r60 at `169f692`. Since then
night 5 has landed the look (T1-T5), the roomier system (T6, T6b), moons (T7-T10), screen-space hits (T11), the
in-system turn (T12), Back by levels (T13) and the explore-pose return (T14).

What I ran. Everything used `demo-fleet.mjs --size large` on :7795 and the SwiftShader wrapper. All files are in `$RUN_DIR/shots/`.
- **Films**, cpu 4x, made after `9a49689`:
  - `r35-galaxy` (`wall.html?variant=galaxy&demo=1`): 33.2 fps, worst gap 149 ms.
  - `r35-fx-beacon` (`galaxy.html?demo=1&fx=beacon`, the owner's kiosk URL): 32.7 fps, worst gap 306 ms.
- **`r35-perf/samples.json`** (`tools/r35-perf.mjs`): `galaxy.html?demo=1&fx=beacon&perf=1` at dpr 2 and cpu 4x.
  - Every 30 s for 6.5 min, after a forced GC, it records heap, DOM nodes, listeners, layout and style counts, `__wallPerf` and `renderer.info`.
  - Then it wakes, taps HV1 and taps `room-a` so its moons open. It holds there 15 s with every rAF callback timed.
- **`r35-perf/alloc-tour.txt`** (`tools/r35-alloc.mjs`): 20 s sampling heap profile of the tour (beacon on, dpr 2, cpu 4x). It counts objects collected by minor and major GC too.
- **`r35-perf/spikes.txt`** (`tools/r35-spike.mjs`): 40 s CPU profile at 200 µs. Every long task is matched to the samples inside it.
- **Triangles** (`tools/r13-tri.mjs`), at L0:
  - `?at=overview&quality=0`: 84.3k triangles, 155 calls.
  - `?at=lab&open=1&quality=0`: 33.7k triangles, 95 calls.
- **Micro-benchmarks** in node: `flightPose` and `freeRect`.

As in r31/r60, **the fps here is the VM's software GL, not the page.** The CPU profile shows the main thread 60 % idle
over 40 s. Its one long task (117 ms) is 76 % idle samples: the frame waits on SwiftShader. The film's 306 ms gap is the
same thing. Script time is the page's number:
- `__wallPerf.scriptMs` runs 3.4-6.0 ms per frame under 4x in the tour, about 1-1.5 ms unthrottled.
- With a moon ring open it averages 5.3 ms (worst 13.2 ms) under 4x.

Under that throttle the 27-30 fps bar holds for the page's own work. Fill rate on the tablet's iGPU at 2x is the
unknown, and only the Surface's `?perf=1` can say.

## galaxy

1. **The overview is still the heaviest frame, and it is the one shown most** (night 4 T34, still in `## Later`).
   - **Measured**: `?at=overview&quality=0` draws 84.3k triangles. Night 4 had 84-86k, so the number has not moved.
     Calls fell from 204 to 155.
   - **For comparison**: an open HV1 draws 33.7k. The overview is 2.5x a close-up of the busiest system.
   - **Cause**: `scene.js:1072 place()` gives every folded member its L0 planet sphere (32x22 for a planet). On screen
     each is 2-6 px.
   - **Why it matters**: this frame comes after every Back to the overview (T13), every tour cycle and every idle
     explore. The tablet fills 5 MP with it.
   - **Fix**: as T34. While `s.unfold < 0.05`, swap a member's geometry to `geo.dot` and hide halos under 1 px. Swap
     back as the system opens past `MARK.from`.
   - **Target**: at most 25k triangles at `?at=overview&quality=0`. A test can count `renderer.info.render.triangles`
     after one `frame()` on the large fixture.
2. **Every rAF still renders, all day. There is no cap** (`galaxy/main.js:673 tick`).
   - A 10-14 s hold and a parked overview redraw at the display rate.
   - §2.4 says "no heat", and a kiosk on all day is the worst case for that.
   - This is unchanged since r31 and waits on the owner (`?cap=30`, off by default).
   - I repeat it because tonight added more per-frame work on a held frame. See 3.
3. **An open moon ring re-places its moons, rebuilds its ring and frames its planet every frame.** The camera holds still while it does.
   - **Measured**: the tour averages 4.1-4.8 ms of script per frame under 4x. With the ring open it averages 5.3 ms,
     worst 13.2 ms (`r35-perf`, `raf-wrap`). That is about 1 ms more per frame, roughly 25 %.
   - Allocation rose from 299 to 351 KB/s retained between GCs.
   - **Lines**:
     - `scene.js:2085`: `placeMoons` runs every frame while `s.ringLive`.
     - Inside it, `scene.js:1137` makes a new `poses` Map. `ringPose` (`:1190`) makes `camX.clone()` and a
       `moons: []` per host. `pose.moons.push({...})` adds one object per moon.
     - `drawRings` (`:1204`) does `[...poses.values()].sort().slice(0, 2)` and makes one array per `at(i)`: 96 arrays
       for a 48-segment ring, spread into `push(...)`. It also uploads the line buffer (`needsUpdate`) every frame.
     - `camera.js:349 pickedShot` runs `s.members.find` and `s.members.filter` every frame for the picked planet.
   - **Fix**:
     - Write the ring's points straight into `arr`, with no `at()` array.
     - Keep one pose object per host and reuse its `moons` array (set `length = 0`).
     - Upload the line buffer only when the camera matrix or the ring's `e` changed. Store
       `camera.matrixWorld.elements` and `e` and compare them.
     - In `pickedShot`, cache the host and the moon count per `want.member`.
   - **Test**: a page test on the fake clock holds a picked planet with the camera still. After the opening has
     settled, it finds no `moonLines` position upload over 30 frames.
4. **The framing box is solved twice a frame, from scratch, although its covers change a few times a minute.**
   - **Lines**: `main.js:234` `freeBox` and `main.js:266` `pickBox` (new tonight, T9) both call `framing.js:30 freeRect`.
     The camera reads both every frame (`camera.js:400-403`).
   - `freeRect` tries every combination of edges, O(n⁴) with an O(n) `.some` closure. With the four kept covers and
     the two touch controls, that is up to 7⁴ candidates.
   - **Measured**:
     - It is the largest allocator on the page: 13.3 % of all bytes (`alloc-tour.txt`, 955 KB/s under 4x).
     - It takes 0.4 % of CPU self time.
     - It costs 7-13 µs per call on this VM, so 30-100 µs per frame under throttle. That is small, but it is pure
       garbage on every frame of the day.
   - **Fix**: memoise `freeRect` on a key of `W`, `H`, `gap` and each cover's four numbers. `kept` and `touchCovers()`
     already return the same boxes until something changes, so a string key such as `boxes.map(…).join()` hits
     nearly every frame. Or keep the last input array and its result by identity.
5. **A status change still re-runs the whole galaxy layout** (r60 #6, still open).
   - **Measured**: `variants/orbits.js:153` plus `arrange` (`:149`) are 10.6 % of all bytes allocated during the tour
     (`alloc-tour.txt`). They come from `scene.js:1410 galaxyLayout(...)` on every model whose scene key changed. The
     demo flaps statuses every few seconds.
   - **Fix**: as r60. Compare the tree key first. On the same tree, call `recolour` with the new statuses and skip
     `galaxyLayout`. `carryScale` (T2) depends on the tree only, so it does not need the layout either.
6. **At the lowest quality level, big carried bodies show their facets.**
   - **Seen**: `r35-perf/moons-open.png`, L2 at ×1.25. HV1's star (carry 1.6x, `bigStar` 26x18 × 0.45 = 12x8) has a
     flat polygon edge along its bottom. `dns` and `git-mirror` (planets 32x22 × 0.45 = 14x10) show corners on their
     terminator.
   - T2 grew the bodies up to 2.2x, but `budget.js LEVELS[2].seg` still cuts their segments in the same proportion.
   - **Why it matters**: the budget steps down exactly when the tablet is struggling. That is also when the owner looks
     at it, and faceted spheres read as "cheap" (his word for neon).
   - **Fix**: in `scene.js sphereSegs`, put a floor of 20x14 on `planet` and `bigStar` at every level. That is a few
     hundred triangles per open body, which is noise next to finding 1. Take the savings from dust and far stars,
     which nobody reads.
   - It needs a test that pins the floor at L2.
7. **Per-frame DOM-dataset reads in the cover path** (`frame.js:477 hushed`, `:480 cover`, `hud.js:486 tagCover`).
   - **Measured**: `cover` 0.4 %, `tagCover` 0.3 % and `hushed` 0.3 % of CPU self time, which is more than three's
     `setProgram`.
   - **Cause**: `freeBox()` calls `frame.cover()` twice (`main.js:231`). `tagCover` builds a string key from
     `textContent` every frame.
   - **Fix**:
     - Read `frame.cover()` once into a local in `freeBox`.
     - Mark `tagCover` dirty from `frame.update` and `live`, the only writers of the tag, as `cover` already does with
       `farDirty`. Do not rebuild its key each frame.
8. **Small, leave for when a builder is in the file.**
   - `flightPose` resamples its 2×31 arc points every frame of a flight (`camera.js:136`, `:152`), recomputing the
     same `extra` and `scale` while the endpoints barely move. It costs 12 µs per call here (node benchmark), so it is
     cheap. Cache them per `want` when touching it.
   - The night 4 list (r60 #7) is unchanged: `director.tick`'s event per frame, `heldDust()` spread, `drawJobs`'
     filter.

Measured and fine (no finding):
- **No growth over 6.5 minutes.**
  - Heap after GC: 7.12 → 7.53 → 7.66 → 7.69 → 7.75 → 7.79 → 7.79 → 7.86 → 7.85 → 7.12 → 7.12 → 7.13 → 7.18 MB, and
    7.19 → 7.32 MB with the ring open. It rose for 4 minutes, then fell back to where it started.
  - DOM nodes: 285-342, swinging with the plate.
  - Listeners: **27** flat. r60 had 23. I did not attribute the four new ones; the count does not move with uptime or with the touch walk.
  - three.js: 26 geometries and 8 textures flat, 27 with the ring open. That is T7's per-site `moonLines`, which
    `setMembers` swaps and disposes. 15 programs.
  - Label pool: 61 spans after the first cycle, flat. `labels.js:446` drops names the world lost.
- **GC** is 0.3 % of CPU. **Layouts** run about 10 a second and style recalcs about one a frame (labels write transforms). I did not attribute the layouts; they are flat over uptime. Box reads are cached
  (`touchCovers`, `farCover`, `tagCover`, `cover`).
- **No new timers tonight.** There is still one 1 s interval (`main.js:759`, writes on change) and the socket's
  back-off. Touch, Back and the director run off pointer events and `tick`.
- **T4's haze** is one `getWorldDirection` per frame and a linear fog chunk, with no draw added. **T3's dust tint**
  runs once per site change (`tintDust` is keyed), never per frame.
- **`hazeRange`, `pickedShot`'s `planetShot` and T12's orbit steps** are pure maths per frame or per pointer move,
  under 0.3 % each.

## fx

- **beacon** (`r35-fx-beacon`, filmed tonight): 32.7 fps, the same as plain galaxy. Its draw (`scene.js:1636`) is a
  loop over at most five sites with no allocation in steady state. The 306 ms gap was SwiftShader: the CPU profile has
  no script in its window. No finding.
- **afterglow, sweep, warp, activity**: I filmed none of them. `fx.js` has no commit since the r20 films
  (`r20-fx-*`: 32.1-33.6 fps, worst gap 177-286 ms, all 0 errors). Since then the scene has only gained per-frame
  work in the open-ring path (finding 3), which they do not touch. r60's notes on them stand: the afterglow and sweep
  key strings per slot per frame. My scores below are from r20 and the code.

## Across the variants (what to steal)

- **From `beacon`**: its draw writes into a fixed pool of slots and allocates nothing per frame. Moons (finding 3) and
  the framing box (finding 4) should copy that pattern.
- **From `labels.js`**: write on change (`p.key`, `p.alpha`), and that should cover every DOM write. The same rule
  belongs on the GPU side: the moon ring's buffer should upload only when it moved.
- **From `tintDust`**: a keyed recompute that runs once per change. `freeRect` and the layout on recolour (findings 4
  and 5) should be keyed the same way.

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 7
score galaxy touch 6
score galaxy wow 7
score galaxy calm 6
score galaxy performance 7
score fx-beacon wow 5
score fx-beacon calm 6
score fx-afterglow wow 2
score fx-afterglow calm 7
score fx-sweep wow 4
score fx-sweep calm 6
score fx-warp wow 3
score fx-warp calm 6
score fx-activity wow 3
score fx-activity calm 4

Touch is scored on the gesture walks made after T13 and T14 (`r33-t13-back`, `r34-t14-return`) and on my own wake → tap
site → tap planet run (`r35-perf`). From the performance side:
- After the taps in my run, no rAF callback with the ring open took over 13.2 ms under 4x (`r35-perf`, `raf-wrap`). I did not time the tap itself.
- The ring opens with no long task.
- The Back out-flight at 1.5 s (`r33-t13-back/10-out-1.5s.png`) is mid-ease with no tear.
- The extra millisecond per frame with a ring open (finding 3) is the one cost a finger adds.

## 3 m check

`$RUN_DIR/shots/r35-3m.png` is `r35-galaxy` frame 1 (the overview at 0.5 s), shrunk to 342 px wide. The picture sits at
the top of a taller black canvas. **Yes.**
- The red square and `HV2` at the top, and HV2's red smear, read at once as the loudest thing.
- `HV2 · STORAGE` in the bottom right is the biggest type on screen.
- HV1's yellow triangle and glow read as the second problem.
- `HOME`, `REMOTE`, `DEMO-HOST` and `CLOUD` are still legible at this size, though just.

## console.txt

- `r35-galaxy/console.txt`: empty (0 lines; the film log says "0 console/page errors").
- `r35-fx-beacon/console.txt`: empty (0 lines; "0 console/page errors").
- `r35-perf/console.txt`: empty (0 lines; all console types captured, none logged).
- `r20-fx-afterglow`, `r20-fx-sweep`, `r20-fx-warp`, `r20-fx-activity` `console.txt`: empty (0 lines each).
