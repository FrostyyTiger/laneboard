# r60: performance engineer (night 4)

Target: a 2019 tablet with an i3-1005G1 and 4 GB, at 2736x1824 and 2x, running Chromium in kiosk all day. The code is at
`169f692` (T21), the last commit to `public/js/wall` and `wall.css`. The previous performance review was r31, at
`c691da6` (T16). Since then the show (T37-T39), countdowns (T40, T53), half screen and role (T41, T42), activity and
sweep (T17, T18) and T19-T21 have landed.

What I ran. Everything used `demo-fleet.mjs --size large --tick 800` and SwiftShader. Throttled runs use CPU x4 at dpr 2:
- **Films** at `?demo=1&quality=0&pace=wall`, 12 frames 4 s apart: `shots/r60-galaxy`, `r60-fx-beacon`, `r60-fx-warp`,
  `r60-fx-afterglow`, `r60-fx-activity`, `r60-fx-sweep`.
- **`shots/r60-probe/probe.json`**: 10 minutes of `?demo=1&quality=0&perf=1&fx=beacon,warp,afterglow,activity,sweep&show=demo`.
  It is r31's probe, re-run with every effect and the show demo on. Every 10 s it records `__wallPerf` and CDP metric
  deltas. Every minute, after a forced GC, it records heap, DOM, listeners and `renderer.info`. It wakes and drags at
  3 min, and wakes, taps the centre and taps the sky at 6 min.
- **CPU profiles**:
  - Wake profiles, one with all effects plus the show and one with beacon only. Both had a worst gap of 200 ms. Only
    the second was kept (`wake-beacon.txt`): the first was written to the same name and overwritten.
  - `tap.txt`: a tap on a site 3 s after a wake.
  - `msg.txt`: 12 s of the tour, as inclusive time per function.
- **Code review** of `git diff c691da6..HEAD -- public/js/wall`. I checked the line numbers below myself.

As in r31, **these fps are the VM's fill rate, not the page's**. The page's own tick (`__wallPerf.scriptMs`) takes
3.8-9.6 ms per frame under x4, which is about 1-2.4 ms unthrottled. Over 12 s of the tour, `tick` takes 1.13 s of
main-thread time under x4 (`msg.txt`), and the profiles are 78-82 % idle while frames take 50-100 ms. The bar of 27-30
fps under throttle cannot be read here. The Surface's own `?perf=1` is the only real number.

## galaxy

1. **The overview is still the heaviest frame the galaxy draws (T34 open), and it got a little heavier.**
   - **Measured** in `probe.log`, `renderer.info` at the minute marks:
     - overview (tour or explore): 220-228 calls, 85.4-86.0k triangles;
     - open HV2 or REMOTE: 41-54 calls, 12.5-16.4k triangles.
   - r31 measured 203-212 calls at the overview. The extra 15 or so are the effects' pools (beacon, activity, sweep
     and afterglow), which are on in this probe.
   - The `probe-360.png` overlay, in explore at the overview, shows `215 calls · 84.2k tri`.
   - **Cause** (unchanged): `scene.js:848 place()` keeps each folded member's full L0 planet sphere. They are 2-6 px on
     screen.
   - **Why it matters**: this is the frame that comes after every wake and every tour cycle, and in every explore idle.
     At 2x on 5 MP, it is also the frame most likely to miss on Intel UHD.
   - **Fix**: as T34. Swap folded members to the dot geometry while `unfold < 0.05`, and hide halos under 1 px.
   - **Target**: at most 25k triangles at `?at=overview&perf=1`. Do it before the merge. It is the one change that
     makes the most-drawn frame cheaper, and it needs no owner decision.
2. **Still no frame cap. Every rAF renders, all day** (`galaxy/main.js:512 tick`).
   - The parked overview and the 10-14 s holds render at the display rate.
   - It waits on the owner (`?cap=30`, off by default, For the owner). I repeat it because §2.4 says "no heat", and a
     kiosk on all day is exactly that case.
   - **Fix**: as r31 finding 2. It is unchanged.
3. **The show writes its words and marks every frame while anything is shown** (`galaxy/show.js:382 tick`).
   - While `state.items.length` is non-zero, `tick` runs `step({ type: 'tick' })` and `apply`.
   - `apply` calls `write()`, which builds `showLines` and runs `JSON.stringify` on them for its key, and `build()`,
     which runs `showMarks` and `JSON.stringify` again.
   - Under `?show=demo` something is shown for most of a cycle, so that is two stringify passes and a new `state` per
     frame.
   - The keys stop the DOM writes, so the cost is garbage and CPU, not layout.
   - GC is small today: 26.7 ms in 12 s under x4 in `msg.txt`, with the show off. I did not separate it with the show
     on.
   - **Fix**:
     - In `tick`, step only when the soonest `until` has passed or the line's second turns. Return `r.ended`/`r.fly`
       from a cheap `nextAt(state)` check.
     - Call `build()` only when `showMarks`' inputs (the items) changed, not on a tick.
4. **`draw()` in `show.js:347` and `fan.js:223` write transforms and `hidden` every frame without a change check**
   (`fan.js` is T35, which is open).
   - `show.js`:
     - Each ring writes `ring.hidden` and a `transform`.
     - Each card writes `hidden`, `dataset.side` and `transform`.
     - Each card also runs `cardPlace` against the cards already placed, every frame, while the camera holds still.
   - **Fix**: do what `lock.js` does since T12. Keep the rounded key per element (0.1 px) and write only when it moves.
     Write `hidden` and `dataset.side` only on change.
   - **Test**: a counting style proxy, as in `wall-galaxy-savings`, sees no card or ring write 1 s into a held pin.
5. **One wake-window gap of 555 ms that I could not reproduce or explain.**
   - `probe.json`, the sample at 370 s (the window holding the 6-minute wake, centre tap and sky tap): worst gap 555 ms.
     r31's same window had 407 ms.
   - Two targeted profiles stay at r31's level: the wake alone has a worst gap of 200 ms in both runs (`wake-beacon.txt`), and the tap on
     a site 167 ms (`tap.txt`).
   - So it is either the sky tap's flight back with the show dropping (not profiled), or the VM's GPU emulation
     hiccuping.
   - **Fix**: none until it is measured. A builder touching T36 should profile wake → tap → sky tap with `show=demo` in
     one window.
   - T36 (the wake's forced layouts) still holds. `boxOf main.js:450` (5.1 ms) and `frame.js:474 cover` (5.8 ms) are
     still in the wake profile's top 20.
6. **A recolour runs the full layout** (`scene.js:1007 update`).
   - `galaxyLayout(nodes)` runs on every scene-key change, before `update` decides between recolour and relive.
   - On the demo's flapping statuses that is `galaxyLayout` at 58 ms in 12 s under x4, including `orbits.js arrange`,
     which is about 1.2 ms per second unthrottled.
   - It is small on the demo. On a real fleet whose statuses flap it would be the same per change.
   - **Fix**: compare `treeKey` first, and on the same tree call `recolour` without `galaxyLayout`. `recolour` needs
     the statuses, not new positions.
7. **Small per-frame garbage left from r31 4**, with nothing measurable (GC is 0.2 % of the profile):
   - `director.tick` still allocates its event and pose every frame (`director.js:207-209`).
   - `heldDust()` spreads a new object every frame (`scene.js:1601`).
   - `drawJobs` filters into a new array every frame (`scene.js:1157`).
   - `drawAfterglows` and `drawSweep` build a template key per slot per frame (`scene.js:1336`, `:1422`).
   - The afterglow slot shuffle on a new clear (r31 7) is unchanged.
   - **Fix**: as r31. Do it when a builder is in those files, not as a task of its own.

Measured and fine (no finding):
- **No growth over 10 minutes with every effect and the show demo on.**
  - Heap after GC: 7.03 → 7.38 → 7.44 → 7.57 → 7.60 → 7.23 → 7.00 → 6.78 → 6.84 → 6.83 MB. It rises in the first
    5 minutes as the afterglow, show and activity pools fill, then falls back.
  - Event listeners: **23** throughout. That is 20 in r31, plus the show transport's and the ✕ buttons'. The ✕ rows are
    rebuilt per words change and their old listeners go with the detached nodes.
  - DOM nodes: 280-336.
  - three.js: 34-37 geometries, 8 textures and 11 programs, all flat.
- **T21's warp** adds a per-fragment loop over `WARP.crits` discs and a cone test in the vertex shader. It runs only in
  hued flights, on thin additive lines, and at rest it costs one check (`scene.js:1567`). The `r60-fx-warp` film:
  16.4 fps, worst gap 211 ms, the best of the six.
- **T20's leader fade** reads `caption.alpha(t)` once per frame, which is cheap (`alpha caption.js:725`: 4.7 ms in 12 s
  under x4).
- **T53's countdown** writes the plate only when its second turns (`caption.tick`), and the scene's line only when its
  words change.
- **Timers**: unchanged from r31. There is one 1 s interval (`main.js:590`, which writes on change), the socket's
  back-off, and the caption's step timers. The show and show demo run off `tick`, not off timers.
- **Where the main thread goes** (`msg.txt`, 12 s of tour under x4):
  - `tick` 1129 ms, of which `scene.frame` 722 ms (three's render 568 ms) and `cam.drawn` 264 ms (labels 150 ms, the
    lock's paint 98 ms);
  - the socket's message path 170 ms;
  - GC 27 ms.

  The DOM names are the page's biggest cost after three.js, and they are already write-on-change.

## touch (my probe's gestures at 3 and 6 min, `probe-180.png`, `probe-360.png`, the wake and tap profiles; `r55-touch` is the full gesture strip, and nothing in `touch.js` changed since)

1. **Wake, drag, tap a site, sky and back all work, and none costs more than the tour.**
   - In explore, `scriptMs` is 4.4-9.6 ms under x4, against 3.8-9.5 in the tour.
   - Style and layout drop to 0.17-0.36 ms per frame in explore, against up to 2.5 ms in the tour.
   - The tour came back on its own at 250 s and 430 s, about 60-65 s after each touch.
2. **The wake lands on the heaviest frame** (galaxy 1), and its first frames have the window's longest gap (galaxy 5).
   - The person looks at the screen at that moment. T34 and T36 are the fixes, and both are open.

## fx-beacon (`r60-fx-beacon`: 16.1 fps, worst gap 337 ms)
1. **The worst gap is the highest of the six films (337 ms), at the same fps.**
   - The page cost is cached per world version (`beaconScale`). Each pillar runs a `Math.hypot` and an `atan2` and
     sets 3 transforms per frame (`scene.js:1240`).
   - A single 337 ms gap in a 50 s SwiftShader film is within the noise r31 saw (283-314 ms).
   - **Fix**: none. Watch it on the Surface with `?perf=1` and two crits standing.

## fx-warp (`r60-fx-warp`: 16.4 fps, 211 ms)
1. **No cost at rest. In flights the cost is fill only.** T21 halved the grains (400 and 750) and culls most of them in
   the shader, so it is cheaper than r31's 2,300 segments. **Fix**: none.

## fx-afterglow (`r60-fx-afterglow`: 15.5 fps, 275 ms)
1. **The ring rebuild on a new clear** is unchanged (r31 7, galaxy 7 here). It is one spike per clear and not a leak:
   geometries stay flat. **Fix**: key the slot on its id and its rounded width.

## fx-activity (`r60-fx-activity`: 15.2 fps, 233 ms)
1. **`drawActivity` and `drawJobs` run every frame over pooled sprites.**
   - Each frame they hide every sprite, then show the ones in use.
   - `drawJobs` builds a new filtered array per frame (`scene.js:1157`) and calls `pointOf` twice per job.
   - `thingOf` is cached per world version, so that part is cheap.
   - **Fix**: filter in place, and only when a job expired.

## fx-sweep (`r60-fx-sweep`: 15.1 fps, 208 ms)
1. **`siteNews` runs `JSON.stringify` on every node on every model frame** (`fx.js:666`, `mix` `fx.js:672`).
   - The two show 6.7 and 6.9 ms self time in a 3.3 s window under x4. That is about 1-2 ms per model frame
     unthrottled with 115 nodes, and on a 150-node fleet with 1 s ticks it is the largest per-message cost the page adds.
   - **Fix**: hash only what makes news (status, metrics, `at`, words) with `fnv` over the fields directly, without a
     stringify. Or run it at most once per sweep, since its only reader is the next sweep.

## Across (what one does that the others should steal)

- **`lock.js` and `labels.js` compare a rounded key before they write.** `show.js` and `fan.js` should do the same
  (galaxy 3, 4).
- **Warp costs one check at rest.** `show.js tick`, `director.tick` and `siteNews` should copy it. Each should do work
  only when something is due: a hold ending, a second turning, or a sweep about to start.
- **The caption's countdown writes only when its second turns** (`caption.tick`, T53). It is the pattern the show's
  `SHOWN BY` line should use.

## Rubric

Touch is scored on my probe's gestures and profiles plus `r55-touch` (current: `touch.js` is unchanged since), not as
a guess.

score galaxy overview 7
score galaxy legibility 7
score galaxy status 7
score galaxy touch 7
score galaxy wow 6
score galaxy calm 6
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 5
score fx-afterglow wow 5
score fx-afterglow calm 7
score fx-activity wow 4
score fx-activity calm 6
score fx-sweep wow 5
score fx-sweep calm 8

## The 3 m check (`shots/r60-3m.png`, the tour's overview at 1368 scaled to 342 px; full size `r60-3m-full.png`)

**Trouble: yes.** The red `■ HV1 · VM-C / BUILDER-C NO CONTACT FOR 33S` banner is the largest thing in the frame, and
the red nebula at HV1 says where. REMOTE's yellow says a second, milder thing.

**Site names: barely.** HV2, DEMO-HOST, CLOUD and HOME are about 4-5 px tall at a quarter width. You can make them out
because they are the only bright words, not because they read. The clock reads.

## console.txt

- `r60-galaxy/console.txt`: empty (0 lines).
- `r60-fx-beacon/console.txt`: empty (0 lines).
- `r60-fx-warp/console.txt`: empty (0 lines).
- `r60-fx-afterglow/console.txt`: empty (0 lines).
- `r60-fx-activity/console.txt`: empty (0 lines).
- `r60-fx-sweep/console.txt`: empty (0 lines).
- `r60-probe/probe.log`: the ten minute lines quoted above, then `errors 0`. No console error or warning in 10 minutes
  with every effect and the show demo on.
