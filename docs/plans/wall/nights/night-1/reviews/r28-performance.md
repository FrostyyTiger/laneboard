# Review r28: the performance engineer

Round 28, night 1. Persona: performance. Target: a 2019 tablet (i3-1005G1, 4 GB, 2736x1824 at 2x),
Chromium in kiosk mode, on all day.

What I judged:
- Films: `$RUN_DIR/shots/r26-radial/` (after T11, 9e6471f) and `r27-orbits/` (after T12, 0a7e10c).
  These are the newest per variant, and nothing under `public/js/wall` or `public/css/wall.css` changed
  after either, so I did not shoot new ones.
- Measurements of my own, all on the large demo, `demo=1`, CPU 4x, 1368x912 at DPR 2, with the
  SwiftShader wrapper (filming note in PROGRESS):
  - A 5-minute soak per variant (`$RUN_DIR/tools/soak.mjs`), sampled every 30 s: fps, rAF callbacks/s,
    script ms per rAF, heap after a forced GC, DOM nodes, JS listeners.
  - A 25 s CPU profile per variant (`$RUN_DIR/tools/prof.mjs`).
  - A Node timing of each variant's layout function.
- Code read: `public/js/wall/*.js`, `variants/*.js`, `wall.css`, the ambient path of
  `views/map/index.js` and the label path of `render.js`.

Caveat on every fps number here: the VM's load average was 30-32 on 10 vCPU while I measured, and
SwiftShader rasterises on the CPU. rAF callbacks/s equalled fps (2-8), so raster was the limit, not
script. The page was idle 89-92 % of main-thread time in the profiles. **fps cannot be judged on
this VM.** Script time per frame can, and so can growth over time.

| variant | fps (SwiftShader, 4x) | script ms/rAF avg | worst script frame | heap after GC | DOM nodes | listeners |
|---|---|---|---|---|---|---|
| radial | 2.2-3.3 | 10.8-17.6 | 54-111 ms | 2.5-3.7 MB, no trend | 156-180 | 18, flat |
| orbits | 4.4-7.4 | 6.4-14.3 | 37-170 ms | 2.5-3.5 MB, no trend | 156-195 | 18, flat |

On average, script time is inside the 33 ms budget, even after a 4x slowdown on a loaded VM. The worst
frames are not. Every 30 s window had at least one script frame over 33 ms: a dropped frame, visible
as a hitch in a flight. Nothing grew over 5 minutes. A 6-minute demo period is not a day, though; see #1.

## radial

1. **The glow sprite cache never shrinks (an uptime leak).** In `glow.js:140-151`, `sprite(rgb)`
   makes a 256x256 canvas per distinct `rgb` and keeps it in `sprites` forever. Each one is 256 KB
   of backing store. The demo's four lamps never change colour. A real colour-temperature or
   dimmer-with-hue feed sends a new rgb every minute, which is 1440 sprites (~360 MB) a day on a
   4 GB tablet, then a tab crash. Both variants are affected (the glow layer is shared). Fix:
   quantise the key (`rgb.map(v => v & ~7)`, invisible in a soft glow) and cap the Map at 32
   entries, deleting the oldest key (`sprites.keys().next().value`) on insert. Add a test that
   feeds 1000 colours and checks the cache size stays at 32 or below.
2. **The turn forces a full label plan every frame.** `drift` is on, so every node's screen position
   changes every frame. `labelPlan` (`render.js:923`) then re-plans, measures and collision-places
   every label 30 times a second. The profile's top JS function was `measure` (`render.js:245`, 139 ms
   per 25 s), then `drawLabels` and `labelPlan`. Radial's script time is 1.5-2x orbits' (no turn) in
   the same minute. That is the cost of the turn, paid every frame of the day. Fix: either give the
   Wall `ambient: {drift: 0}` on radial as well (orbits already does), or redraw at 15 fps while
   only the turn moves (see #4). The turn at TAU/600 rad/s moves a node at the outer ring about
   7 px/s, so 15 fps steps of half a pixel are invisible.
3. **`measure` builds its key from the `ctx.font` getter on every call.** At `render.js:245`,
   `` `${ctx.font}|${text}` `` reads `ctx.font` back, which Chromium re-serialises on each read.
   That runs hundreds of times a frame. This is the top JS self-time in both variants. Fix: keep
   the last font string the renderer set in a local (`setFont(f) { if (f !== curFont) { ctx.font = f;
   curFont = f; } }`) and key the cache on `curFont`. Output is unchanged and the app gains too. It
   touches the shared Map module, so the owner should allow a no-behaviour-change refactor there,
   or put it behind an option.
4. **The Map paints the full 2736x1824 canvas 30 times a second, all day, even when nothing
   moves.** `hasLife` (`index.js:1124`) is true whenever any lane is `working` or `attention`, which
   is always in a busy fleet, so the loop never idles. North star 4 says "no heat". Fix, a Wall-only
   option that defaults off: `ambient.idleFps` (e.g. 12). Use it while no flight is running, no comet
   is in the air and the turn is off or slow. Use full 30 fps only during flights and the
   lock/caption arrival. A spinner reads fine at 12 fps from 3 m.
5. **Two forced style recalcs per frame from size reads.** Each frame, `lock.js:113` and
   `glow.js:131` read `clientWidth/clientHeight` inside `onDraw`, right after the lock has written
   four transforms and an opacity (`lock.js:149-153`). In the profile they show as anonymous frames
   on those exact lines: 64-102 ms per 25 s, more than `drawLinks`. During the caption's typing,
   `textContent` writes dirty layout too, so the read forces a full layout. Fix: one
   `ResizeObserver` on the stage in `main.js` that caches `{W, H}` and passes it as `size` to
   `createLock` and `createGlow` (both already take `size`).
6. **The lock writes styles every frame, even when shut on a still node.** `lock.js:149-153` builds
   five strings and writes them for all 25 s of a hold. Fix: remember the last `x0,y0,x1,y1,alpha`
   string and skip the writes when it is unchanged. Together with #5, the hold then costs nothing
   outside the canvas.
7. **The Map canvas has DPR up to 2.5 (`index.js:320`), so it is 2736x1824 on the tablet.** Text from
   3 m does not need 2x. Fill rate on an i3 UHD G1 with hundreds of `fillText` calls per frame does.
   Fix, a Map option that defaults off: `maxDpr`, set to 1.5 by the Wall. That is 44 % fewer pixels
   per frame. Film a 1:1 crop at 1.5 against 2 and keep 1.5 if the type still reads.
8. **Per-frame allocation in the Map's frame path.** In `scene()` (`index.js:1144`), each frame gets
   a new `Map` memo, a new `Set` for `near` when nothing is hovered (`:1146`), and an object of
   closures. `step` builds `found = new Set([...matches].map(...))` (`:1105`) and new `pulses`/`comets`
   arrays (`:1114`). `stuckBuilders` (`render.js:933`) builds a Set from every node. The draw loop
   (`:1178`) calls `toScreen` for every node only to count `drawnCount`, which the ambient Map never
   shows (`renderReadout` is skipped). GC is only 0.3-0.5 % of the profile, so this is a low rank,
   but it is churn on a 4 GB machine all day. Fix (ambient only): hoist a frozen empty Set, filter
   pulses in place, skip the `drawnCount` loop when `amb`, and compute `stuckBuilders` once per model.
9. **`__wallPerf.worstGapMs` is a lifetime maximum.** `perf.js:18` never resets it. In the soak it
   only ever climbed (1643 to 1918 ms), so one hitch at boot or during a GC hides every later
   improvement, and a day-long kiosk run reports nothing useful. Fix: add
   `__wallPerf.reset()` (Wall-side; film.mjs is fenced) and a rolling `worst10s`.
10. **Caption fades read computed style.** `caption.js:255` calls `getComputedStyle(node).opacity` for
    every fade, which is a forced style recalc 5-7 times per leg. That is small (21 ms per 25 s), but
    it is free to remove: keep each element's target opacity in JS, or pass `fill: 'forwards'` and
    animate from the last value set.

## orbits

1. **The glow sprite leak (radial #1)** applies here too: same layer.
2. **The layout runs mid-flight, twice per leg.** `index.js:1092` calls `relayout()` from `step()`
   whenever the zoom crosses `AUTO_UNFOLD_ZOOM` (1.8). The tour zooms to 2.3 and back, so that
   happens inside an animation frame on every fly-in and every fly-out. Orbits' layout
   (`layoutFor` → `arrange`, `orbits.js:142`) brute-forces 2 phases × 45 stretches × (doubling + 40
   bisections) × an O(n²) `clear()` that allocates a fresh array for every candidate. That is 2.1 ms
   warm and 4.3 ms cold at 1x in Node, so roughly 9-17 ms at 4x, on top of the Map's own relayout,
   inside one frame of a flight. `at`, `clear` and `(anon)` on `orbits.js:146-150` sum to 146 ms per
   25 s in the profile. That is the variant's top JS cost, and orbits had the worst single frame I
   measured (170 ms). The same relayout runs on every `/ws` map frame. Fix: memoise `arrange` on its
   inputs (`aspect` plus each system's `hx,hy` rounded to 1 unit, as a string key). The planets'
   boxes change only when a site gains or loses rooms, so nearly every call becomes a hit. Also
   compute `clear()` without the `systems.map` allocation per candidate.
3. **No turn, yet a full repaint at 30 fps (radial #4).** Here the hold is fully static apart from
   spinners and comets, so `idleFps` would save the most on orbits: about 25 s of every 30 s cycle
   at normal speed.
4. **The glow layer repaints every frame for nodes that do not move.** `glow.js` paints on every
   `onDraw`. With no turn, a lamp's `screenOf` changes only during flights. Fix: skip `paint()` when
   every mark's `screenOf` and the eased zoom are the same as last frame (compare a short string),
   and keep the dirty boxes as they are.
5. **Radial #3, #5, #6, #7, #8, #9 and #10 apply unchanged.** The Map, lock, caption and perf
   counter are the same code. In orbits' profile, #5's two reads (102 + 88 ms per 25 s) cost more
   than any Map draw pass but `measure`.
6. **No resize path.** `main.js:32` reads the aspect once at boot, and orbits' layout is built for that
   aspect. A kiosk that boots before the display settles (a common kiosk race), or a tablet rotated
   once, keeps the wrong layout until reload. That is not a frame cost, but on a day-long screen it
   means a reload. Fix: the ResizeObserver from #5 rebuilds `mapOptionsFor` when the aspect changes
   by more than 5 %.

## Across the variants

- Orbits has `ambient: {drift: 0}`: no turn means no per-frame re-plan of every label. Radial
  should steal it, or at least slow its turn and paint it at a lower rate. It is the single biggest
  script saving available to radial.
- Radial's layout is cheap (1.4 ms at 1x, no search). Orbits should steal that property by caching
  `arrange`, so that a zoom crossing never pays for a search.
- Both share the glow, lock, caption and perf code, so radial #1, #5, #6, #9 and #10 fix both at once.
  Islands (T13) and the hex wild card (T14) should start from the cached-size, write-on-change
  pattern and a memoised layout. Their layouts (cluster packing, hex region growth) will be searches
  like `arrange`.

## Rubric

score radial overview 4
score radial legibility 3
score radial status 5
score radial touch 2
score radial wow 5
score radial calm 4
score radial performance 5
score orbits overview 6
score orbits legibility 4
score orbits status 5
score orbits touch 3
score orbits wow 6
score orbits calm 6
score orbits performance 6

Performance reasoning:
- **radial 5:** average script time fits, but the turn makes every frame a full label re-plan, worst
  frames are over budget, and the glow cache leaks.
- **orbits 6:** cheaper on average and no turn, but layout searches land inside flight frames, and
  it shares the leak.

Neither can show 27 fps on this VM. Both need the tablet.

## Console

`r26-radial/console.txt`: empty (0 lines).
`r27-orbits/console.txt`: empty (0 lines).
My soak runs (radial and orbits, 5 min each): no console messages and no exceptions.
