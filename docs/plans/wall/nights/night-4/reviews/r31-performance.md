# r31: performance engineer (night 4)

Target: a 2019 tablet with an i3-1005G1 and 4 GB, at 2736x1824 and 2x, running Chromium in kiosk all day. The code is
at `c691da6` (T16), which is the last commit to `public/js/wall` and `wall.css`.

What I ran. Everything used `demo-fleet.mjs --size large` and SwiftShader. Throttled runs use CPU x4 at dpr 2:
- **Films** at `?demo=1&quality=0&pace=wall`: `shots/r31-fx-beacon`, `r31-fx-warp`, `r31-fx-all` (beacon, warp and
  afterglow) and `r31-fx-comets-twinkle`. Frames are 4 s apart. They ran at 11.3, 12.3, 13.4 and 13.7 fps, with worst
  gaps of 314, 212, 272 and 313 ms, and 0 errors. Plain galaxy and afterglow come from `r30-galaxy-without` and
  `r30-galaxy-with`, which are current: 13.5 and 14 fps, worst gaps 442 and 254 ms.
- **`shots/r31-probe/probe.json`**: 10 minutes of `?demo=1&quality=0&perf=1&fx=beacon,warp,afterglow`.
  - Every 10 s it records `__wallPerf` plus CDP `Performance.getMetrics` deltas: script, style and layout per frame.
  - Every minute, after a forced GC, it records heap, DOM nodes, listeners and `renderer.info`.
  - At 3 min: a wake and a drag. At 6 min: a wake, a tap in the centre and a tap on the sky.
- **`shots/r31-probe/calls.txt`**: draw calls and triangles every 2 s against each site's `unfold`, through the tour,
  a wake, a tap on HV2 and back. The parked check is `tools/r24-tri.mjs` at `?at=overview` and `?at=hv2`.
- **`shots/r31-probe/wake-profile.txt`**: a CPU profile from 0.3 s before a wake to 2.5 s after it, with every rAF
  gap recorded.
- **`shots/r31-probe/warp.txt`**: the warp's line sets sampled every 2 s for 150 s, with a wake at 20 s.
- **Code review** of `git diff c8c91b9..HEAD -- public/js/wall`. I checked the line numbers below myself.

**The fps bar cannot be judged here.** These films are SwiftShader, which means a GPU emulated on the VM's CPU. In the
wake profile the main thread is 81 % idle (2.62 s of 3.22 s), yet frames take 50-150 ms. The page's own tick
(`__wallPerf.scriptMs`) takes 2.9-10.3 ms a frame under x4, which is about 0.7-2.6 ms unthrottled. CDP's script time
per frame, which includes three's render calls, is 3.9-10.6 ms under x4. So the 11-14 fps is the VM's fill rate, not
the page. The only real fps number is still the owner's on the Surface.

## galaxy

1. **The overview is the most expensive frame the galaxy draws, not the open system.**
   - **Measured** (`calls.txt`, `r24-tri` parked):

     | View | Draw calls | Triangles |
     |---|---|---|
     | Overview (`?at=overview`, tour, explore after a wake) | 203-212 | 84-86k |
     | Lab (HV1, 41 members) open | 151-157 | 59k |
     | HV2 open | 51 | 14.1k |
     | REMOTE / HOME / CLOUD open | 30-45 | 9-16k |

   - Night 3's r56 and this night's T12 have it backwards ("45 at the overview, 205 with HV1 open"). With a system
     open, the other systems leave the frame and are culled. At the overview, every system is in frame.
   - **Cause**: `scene.js:803-817 place()` keeps every member's Mesh and halo Sprite drawn while it is folded into its
     star. The 48 planets keep their full L0 sphere (32x22, about 1.3k triangles each, about 62k in all) at 2-6 px on
     screen.
   - **Why it matters**: the overview is the frame the tablet draws most. It comes up every tour cycle, after every
     wake, and in every explore idle at the overview. With no frame cap (finding 2) it is drawn at 60 Hz, MSAA on, on
     5 MP.
   - **Fix**: while `s.unfold < 0.05` and the site is not held, give folded planets the dot geometry
     (`sphereSegs('dot')`, 8x6 at L0). Do it as a swap between two shared geometries, never a new one, and swap back
     as the system opens. Hide a folded member's halo when it is under 1 px on screen.
   - **Target**: at most 25k triangles at `?at=overview&perf=1` (the overlay's second line), with the overview still
     unchanged by eye. Later, folded members could be one `InstancedMesh` per tone, which takes the calls from about
     200 to about 50.
2. **Still no frame cap: a full render on every rAF, all day** (`galaxy/main.js:427 tick`; r56 finding 2, Later
   r37-performance 6).
   - The parked overview and the 10-14 s holds render at the display rate, while only the breath and the dust move.
     §2.4 says "no heat".
   - It is unchanged since night 3 and waits on the owner. `?cap=30` stays off by default, as the planner wrote.
   - **Fix**: as in r56. 30 Hz at holds, at the overview and in reduced motion. 60 Hz in flights, under a finger and
     through the inertia's coast. The budget's `missMs` should follow the cap.
3. **The fan rewrites about 50 style properties every frame for as long as it is open** (`galaxy/fan.js:223-239
   draw`, up to the 60 s minute).
   - The spot gets 2 writes, and each of up to 12 rows gets 4: transform and opacity for the row and for its leader.
     None of them is checked for change. Each row also calls `o.screenOf(it.id)` per frame (`camera.js:301-320`): a
     linear `sites × members.find`, a `camera.updateMatrixWorld()` and a new object.
   - After about 0.4 s (`FAN.inMs` plus 18 ms per row) the rows never move again. Only the leaders follow their
     planets, through the hold's sway.
   - **Fix**:
     - Once `k >= 1` for every row, stop writing the spot and the rows.
     - Write a leader's transform only when its rounded key changes, as `lock.js` does since T12 (0.1 px, opacity
       to 0.01).
     - Resolve each row's mesh once in `show()` and project it directly.
   - **Test**: a counting style proxy, as in `wall-galaxy-savings`, sees no row writes 1 s after `show()` while the
     camera holds still.
4. **Per-frame garbage in the always-on path.** The heap is flat (finding list below) and GC does not show in the
   profile, so this is cheap to fix and not urgent.
   - **`galaxy/director.js:202-206 step` on every `tick()`** (`main.js:447`): it allocates
     - a spread event;
     - `cam.pose()`, a deep clone of 3 objects (`camera.js:350`);
     - an options object;
     - the `directorStep` result spreads.

     That is about 8 objects a frame, even while the tour drives and nothing can expire.

     **Fix**: return early from `tick()` when `state.driver === 'tour'` and no show is held, and read the pose only
     for a move.
   - **`touch.mode()` runs `touchStep` three times a frame**: `main.js:432`, through `held` at `main.js:237`, and
     through `touch.left()` at `main.js:440`. **Fix**: call it once per frame and pass the value along.
   - **`main.js:285-286` labels `covers()`** makes 4 array spreads per frame, plus `hud.covers()`'s new filtered array.
     **Fix**: rebuild the combined array only when one part returns a new reference.
   - **`touch.js manualLine`** builds its string every frame in explore. **Fix**: call it only when
     `Math.ceil(left / 1000)` changes.
5. **The wake forces layouts.** In `wake-profile.txt` the first frame after the wake is the longest gap of the window:
   183 ms under x4, against 17-150 ms after it.
   - Most of that gap is the GPU: 318 ms of `(program)` over the window. The page's part is layout reads in the frame
     that has just written:
     - `boxOf main.js:389` (3.7 ms self) reads `offset*` of the back control and the manual line. `back.show` and
       `sayManual` (`main.js:439-440`) wrote `hidden` and `textContent` earlier in the same tick.
     - `tagCover hud.js:425` (4.4 ms) and `frame.js:432 cover` (6.2 ms) read boxes after the frame's own dataset
       writes.
   - It is one frame per wake, but it is the first thing a finger feels.
   - **Fix**: read the new boxes on the next rAF. A cover one frame late is harmless, because names move on a tween
     anyway.
6. **`scriptMs` still cannot see the DOM** (r56 finding 4, open). Measured here, style and layout per frame:

   | Phase | Style + layout | Style recalcs per frame | Layouts per frame |
   |---|---|---|---|
   | Tour | 0.9-2.7 ms (x4) | 0.9-1.27 | 0.2-0.6 |
   | Explore | 0.2-0.6 ms | 0.16-0.62 | about 0.3 |

   That is fine today, but the overlay would not show a regression. **Fix**: as r56. Add a style-and-layout line to
   `?perf=1` from a `long-animation-frame` observer, for the overlay only.
7. **The afterglow rebuilds ring geometry on every new clear** (`scene.js:1249-1254`).
   - The slot key is `id:world.version`. Slots are sorted by clear time, so a new clear shifts every slot, and up to 8
     `RingGeometry(…, 128)` are disposed and rebuilt in one frame. A `world.version` bump does the same.
   - It is not a leak (`geometries` stays at 31 for the whole probe). It is a small spike at the moment trouble clears.
   - **Fix**: key a slot on its id and its rounded width, and keep a site in the same slot while its ring lives.

Measured and fine (no finding):
- **No growth in 10 minutes**, through two wake cycles with all three effects on:
  - heap after GC: 6.31 → 6.60 → 6.57 → 6.67 → 6.24 → 6.21 → 6.05 → 5.94 → 5.99 → 6.06 MB;
  - event listeners: **20** throughout (as in night 3);
  - DOM nodes: 261-318;
  - three.js: 30 → 31 geometries (the first afterglow ring), 7 textures and 11 shader programs, all flat.
  - The new collections are bounded: `hud.js firstSeen` (rebuilt from the standing crits), `perf.js` buckets (at most
    11), `fx.js afterglows` (at most 8, 30 min life, pruned when a site goes), director state (fixed shape), and
    `createReturn` (one pose). The fan's DOM is removed on `hide`, and no listener is added per row.
- **Gestures cost no more than the tour.** `scriptMs` in explore is 4.3-9.6 ms under x4, against 2.9-10.3 in the tour.
  The worst gap in each 10 s window is 135-255 ms, except the window holding the wake (407 ms, finding 5).
- **Warp is quiet at rest.** In 75 samples over 150 s (`warp.txt`), its 2,300 line segments draw only during flights
  to crit or warn sites (lab, hv2), and never at rest, in explore, or on flights to calm cloud, remote or home. At rest
  it costs one check (`scene.js:1349`). My probe's minute samples at 5, 6, 8, 9 and 10 min showed 3,284 lines only
  because they landed in flights.
- **Timers**:
  - one 1 s `setInterval` (`main.js:494`, which writes only on change);
  - the socket's single back-off;
  - the caption's step timers, cleared before they are set;
  - the director's hold, which runs off `tick`, not off a timer.

## touch (from the gesture runs: `r31-probe` minutes 3 and 6, `probe-180.png`, `probe-360.png`; `r28-touch` for the full sequence)

1. **Wake, drag, tap and back all work, and none costs more than the tour.**
   - `r28-touch` covers tour → wake → drag → tap a site → back → 60 s → tour, after the director (T14). T15 and T16
     did not touch `touch.js`. That run's largest camera step between frames is 0.22 of the distance, so there is no
     cut. After the wake, the manual line counts from `1:00`.
   - My probe saw the tour come back on its own 60-65 s after each touch (samples 250 and 430).
   - The one cost is the wake's first frame (finding 5).
2. **A wake always lands on the overview, which is the most expensive frame** (galaxy finding 1).
   - Explore at the overview held 208-212 calls for the whole idle minute (`calls.txt` 62-90 s). Because the person is
     looking then, this is the frame a cap must not slow down.
   - Fix 1 above makes it cheaper, and there is nothing else to do for touch.

## fx-beacon (`r31-fx-beacon`)
1. It adds three additive draws per crit: pillar, core and tip.
   - With two crits (`probe-360.png`: HV2 and HV1), two pillars run about 300 px tall. On the Surface that is fill on
     5 MP and nothing else; the page cost is cached per world version (`beaconScale`).
   - Its film (11.3 fps) against all three effects on (13.4 fps) is within the VM's noise.
   - No fix is needed. The owner's "running good" on the Surface was measured with beacon on.

## fx-warp (`r31-fx-warp`; streaks seen in `r29-galaxy`)
1. This film's 4 s frames all missed the flights, so it shows no streaks. `warp.txt` is the evidence that the streaks
   draw only in hued flights.
   - The cost is 2,300 additive segments with `frustumCulled = false` over the full screen, and only in flights.
   - If the Surface dips in flights, halve `WARP_DUST` at level 1 (r56). No fix is needed otherwise.

## fx-afterglow (`r30-galaxy-with`, `probe-360.png`)
1. It adds one transparent mesh per clear (at most 8), drawn thin for up to 30 min.
   - In `probe-360.png` the rings round REMOTE and CLOUD are thin amber lines that are quieter than any nebula, and
     they cost one call each.
   - The rebuild on a new clear is finding 7. Otherwise nothing.

## fx-comets, fx-twinkle (`r31-fx-comets-twinkle`; T17 removes both)
1. At 4 s per frame the film shows almost nothing of either one. The bright white spark at HV2's STORAGE in frame 3
   (9.9 s) is the only trace.
   - Both are pooled sprites, and their per-model work (`flowComets`, `workingPlanets`) runs per update, not per frame.
   - They are going, so I give no fix.

## Across (what one does that the others should steal)

- **Write only what changed.** `lock.js` (T12) and `labels.js` compare a rounded key before writing; `fan.js` should do
  the same (finding 3). The parked overview proves it pays: its style recalcs drop to 0.16-0.37 a frame in explore.
- **Cost only while shown.** Warp at rest costs one check (`scene.js:1349`), and `director.tick` should copy it
  (finding 4). So should folded members, which should cost what they look like: dots (finding 1).
- **Keep the gesture path flat.** `touch.js` adds no per-frame work of its own. The director and the fan should do the
  same.

## Rubric

Touch was scored on the gesture runs above (`r31-probe` at 3 and 6 min, `r28-touch`), not as a guess.

score galaxy overview 7
score galaxy legibility 7
score galaxy status 7
score galaxy touch 7
score galaxy wow 6
score galaxy calm 6
score galaxy performance 6
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 5
score fx-afterglow wow 5
score fx-afterglow calm 7
score fx-comets wow 3
score fx-comets calm 6
score fx-twinkle wow 3
score fx-twinkle calm 6

**Performance 6** (r56 gave 7). The JavaScript is still cheap: about 1-2.5 ms a frame unthrottled, and nothing grows
over 10 minutes. It loses a point for three things:
- the overview is the heaviest frame: 4x the calls and 6x the triangles of an open HV2, drawn most of the day;
- there is still no frame cap;
- a fan that rewrites itself every frame.

**Touch 7**: every gesture costs no more than the tour. The wake's first frame forces layouts.

**comets and twinkle** are guesses from a film that barely shows them; T17 removes both.

## The 3 m check (`$RUN_DIR/shots/r31-3m.png`, `r31-fx-all` frame 1, 2736 → 684 px)

**Yes.** Something is wrong and I can see where:
- the red `■ HV2 · STORAGE` banner is the largest type;
- HV2 has a red nebula with its square, and the beacon's red line rises from it;
- HV1 shows as yellow with a ▲.

The site names REMOTE, HV2, DEMO-HOST, HV1, HOME and CLOUD are about 10 px tall and read as words, the calm ones in
white. The tag at the top right (`LANEBOARD · DEMO-HOST LIVE`) cannot be read at this size, and that is fine.

## console.txt

- `shots/r31-fx-beacon/console.txt`: empty (0 lines).
- `shots/r31-fx-warp/console.txt`: empty (0 lines).
- `shots/r31-fx-all/console.txt`: empty (0 lines).
- `shots/r31-fx-comets-twinkle/console.txt`: empty (0 lines).
- `shots/r30-galaxy-with/console.txt`: empty (0 lines).
- `shots/r30-galaxy-without/console.txt`: empty (0 lines).
- `shots/r28-touch/console.txt`: empty (0 lines).
- `shots/r31-probe/probe.json` `logs` (errors and warnings over 10 minutes): `[]`.

Housekeeping: two `demo-fleet.mjs` processes from earlier rounds are still running on ports 7797 (started a day ago)
and 7798 (16 h ago). They are idle (0 % CPU) and are not mine, so I left them. Every Chrome I started has been closed.
