# Review r37: performance engineer (night 2, round 37)

Persona: the target is a 2019 tablet (i3-1005G1, UHD G1, 4 GB, 2736x1824 at 2x, Chromium kiosk, all day).
Tree: `e428037` (galaxy code last changed by T18, `b399ee0`). Demo: `demo-fleet.mjs --size large`.

What I ran (all in `$RUN_DIR/shots/`, tools in `$RUN_DIR/tools/r37-*.mjs`):
- Filmstrip `r37-galaxy/sheet.png` (`galaxy.html?demo=1&perf=1`, 4x CPU throttle, SwiftShader): 2.6 fps,
  worst gap 2429 ms, 0 console errors. The older `r36-galaxy` film predates T18 by four minutes, so I made a new one.
- `r37-metrics-4x.txt`: CDP `Performance.getMetrics` over three 20 s windows at 4x, dpr 2.
- `r37-leak-1x.txt`: six 60 s windows at 1x, with a forced GC before each read (6 min, ~1400 frames).
- `r37-alloc.txt`: sampling heap profiler, 30 s at 1x (bytes allocated, collected ones included).
- `r37-cpu-4x.txt`: CPU profile, 30 s at 4x; `r37-cpu-4x-singlepass.txt` is the same run with one runtime
  patch (finding 1).
- Still `r37-still/custom-dark-1368.png` (`?quality=0`, overview), `r37-3m.png` (a quarter of its width).

The fps numbers come from SwiftShader on this VM (software GL). They say nothing about the tablet's GPU.
I judge speed by script ms per frame, layout work, allocations and what grows over time. Measured at 4x:
`__wallPerf.scriptMs` 4.7-19 ms per frame (tick start to end, three's JS side of `render` included),
CDP ScriptDuration 10.7-12.8 ms per frame, layout 1.0-1.5 ms per frame, style 1.5-1.9 ms per frame. That fits
a 33 ms frame (30 fps). It does not fit the 16.7 ms frame the owner wants to keep (60 fps, README §7.A6).

## galaxy: findings, worst first

1. **Three.js rebuilds the shader state of every nebula lobe and every landing plane twice per frame.**
   `scene.js:510` (lobes) and `scene.js:521` (system plane) are `transparent` + `side: THREE.DoubleSide`.
   Three r170 draws such materials in two passes, back then front. Before each pass it sets
   `material.needsUpdate = true`, and that forces `getParameters` → `getProgramCacheKey` → `getProgram`
   (`three.module.js:20650`, `:20978`, `:30500`) for each of the 19 materials, every frame. Measured: the
   material `version` of every lobe and plane climbs by ~2 per drawn frame (`r37-prog.mjs`: 38 → 68 in 3 s).
   In the 4x profile, `getParameters` + `getProgram` + `getProgramCacheKey` cost ~2.4 ms per frame.
   `getParameters` also allocates 56 KB per frame (the second-largest allocator), and the 19 objects take
   19 extra draw calls. With `forceSinglePass = true` set on those 19 materials at runtime, all three
   functions drop out of the profile and GC time halves (2.25 → 1.04 ms/frame, `r37-cpu-4x-singlepass.txt`).
   Why it matters: this is the biggest waste in the frame, it costs a tenth of the 60 fps budget, and it
   gives nothing back. A flat additive quad needs no back-to-front sort of its own faces.
   **Fix:** add `forceSinglePass: true` to both material constructors (`scene.js:509-511`, `:520-522`).
   A test should build a scene and check that a lobe's `material.version` stays the same after two `frame()` calls.

2. **The budget never lowers the pixel ratio, which is the lever that matters on the tablet.**
   `scene.js:288` `setPixelRatio(Math.min(2, dpr))` with `antialias: true` (`:266`). On the tablet the
   drawing buffer is 2736x1824 (5 M px) with 4x MSAA. The 9000 additive dust points (`size: 20`,
   `scene.js:358`), the sun halo and the nebula lobes overdraw the middle of the screen several times.
   On a UHD G1 that fill cost, not script, is the bottleneck (Q9: "adaptive pixel ratio is the main lever").
   `budget.js LEVELS` (`:13-16`) only thins spheres, dust and stars. Sphere segments barely matter to this
   GPU. The names are DOM (`labels.js`), so a lower canvas ratio leaves the type sharp.
   **Fix:** give each level a `ratio` (L0 2, L1 1.5, L2 1.25) and have `setQuality` call
   `renderer.setPixelRatio(min(dpr, L.ratio))`. That only resizes the buffer and does not move the camera.
   Consider `antialias: false` at ratio ≥ 1.5 (at 2x the MSAA is mostly invisible).
   Add a `?ratio=` pin for filming. Without it we cannot know whether the tablet holds 60 or only 30.

3. **Two forced layouts per frame, the top JS item in the profile.** `hud.js:49-51 tagCover()` reads the
   tag's `offsetLeft/Top/Width/Height` on every call. It is called twice per frame: from `main.js freeBox()`
   (via `camera.js frame` → `free()`) and from `hud.covers()` in `labels.draw`. `labels.draw` runs after the
   lock (`galaxy/lock.js:55-62`) has written `--lock-arm` and four transforms. In between, `scene.js resize()`
   (`:776`) and `labels.js draw` (`:216`) and `camera.js screenOf` (`:173`) read `clientWidth/clientHeight`.
   Measured: 2.2 style recalcs and 0.75-1.2 layouts per frame (one of each is the normal frame). `tagCover`
   is 2.23 ms/frame of self time at 4x. Fenced `frame.js cover` (0.46 ms) caches its box after the text
   changes. The tag never moves.
   **Fix:** cache the tag's box and read it again only on `resize` or when the frame's text changes (as
   `frame.js:245` does). Cache the canvas size from one `ResizeObserver` on the canvas, used by
   `resize()`, `labels.draw` and `screenOf`. Then nothing reads layout after a style write within a frame.

4. **`setOpen` re-places every site for every site that moves.** `scene.js:768-773` calls `place()` (all
   sites, all members, `foldAt` allocating an object per member, `scene.js:599`/`layout.js:206`, a new
   `push` closure per site) on each call. `camera.js:131-134` calls `setOpen` for every site whose `open`
   changed, and during a flight one folds while the next opens. Then `advance()` places once more if a
   tween is running. That makes up to three full `place()` passes per frame during flights, exactly when
   the frame is busiest. `place` is 48 KB/frame of allocation and 1.14 ms/frame at 4x.
   **Fix:** `setOpen` sets `s.open` and `dirty = true` and does not place. `frame()` → `advance()` places once.
   The parked `?at=` path calls `galaxy.frame` right after, so it still works. Let `foldAt` write into a
   passed object (`foldAt(k, p, out)`) and hoist `push`.

5. **Every socket message lays out the whole galaxy again, even when only a status changed.**
   `scene.js update()` (`:748-764`) runs `galaxyLayout(nodes)` before it knows whether the tree changed.
   That is `variants/orbits.js arrange` (`:148-160`), whose `at()` builds a fresh array for every stretch,
   phase and t it tries. It is the largest allocator on the page: 139 KB + 28 KB per frame averaged, about
   1.7 MB per message. In the 4x profile it runs ~7 ms in one frame per message. At 60 fps every status
   flicker in the demo drops a frame and feeds the GC. `recolour` only needs the nodes by id.
   **Fix:** compute `treeKey` first. On an unchanged tree, recolour from `nodes` by id, without
   `galaxyLayout`. Keep the last layout for the tree change. In `arrange`, reuse one scratch array in `at()`.

6. **The loop runs uncapped at the display rate all day.** `main.js:155` `tick` draws every rAF. In a hold
   or at the overview, almost nothing moves faster than the drift (`dustTurn` is 26 min per turn). The
   breathing nebula and halos have a multi-second period. On the tablet that is 60 full-resolution
   frames a second, all day, where 30 look the same. §2.4 says "no heat", and the Map's ambient mode caps
   at 30 for this reason.
   **Fix:** a `frameCap` in `main.js`: 60 while a flight runs or a system opens or folds (`cam.want()` /
   `flight` progress < 1), 30 otherwise (skip a rAF when `now - lastDrawn < 30 ms`). Have `budget.js`
   judge against the cap in force, or it steps down for frames that were skipped on purpose.

7. **`labels.draw` rebuilds everything per frame.** `labels.js:213-292`: new `items`, `meta`, `bodies`,
   a `candidates` array per label, `labelSize` (`textW`) per label, a `Set` of last keys, and a
   `toFixed` key string per shown label. That is 1.68 ms/frame of self time at 4x for ~30 names. Fine at
   30 fps, but a third of the leftover budget at 60.
   **Fix:** memoise `labelSize` by `text|px|face` (the texts barely change), and reuse the arrays and Maps
   across frames (clear by length). Skip the whole pass when the camera pose, `world.version` and
   `unfold` values are unchanged since the last frame, which is true for most of a held frame's labels at
   the drift speed once rounded to 0.5 px.

8. **At the overview, every folded member is still a mesh with its own draw call.** The overlay shows
   220 calls at the overview against 36-56 when held (filmstrip frames 1, 6, 10). The folded members
   sit inside the nebula at sub-pixel size. 220 calls is fine for this GPU, but they cost CPU in
   `renderBufferDirect`/`setProgram`/`uniformMatrix4fv` (together ~2 ms/frame at 4x).
   **Fix:** while `s.unfold === 0`, set `m.mesh.visible = m.halo.visible = false` for calm members
   (trouble keeps its halo, which is what shows at the overview). Later, an `InstancedMesh` per tone.

What I checked and found clean (measured, not assumed): over 6 min at 1x with a GC before each read, heap
5.5-6.5 MB, DOM nodes 262-296, JS listeners 8: flat. Without the forced GC, nodes climbed 448 → 908 in
60 s at 4x. That is GC lag (the caption's typed letters), not a leak. One `visibilitychange` listener. The
socket's `setTimeout` runs only after a close. The fx sprite pools (`lanes` 6 routes, `comets` 6, `twinkle` 24)
are made once and reused. The T10 hour proxy showed geometries 22, textures 3 and programs 8 as flat.

Motion in the filmstrip: SwiftShader gives 2.6 fps, so stutter between frames cannot be judged here. No
frame shows a jump in the camera's path. Frame 9 (32.9 s) shows the FEAT-SEARCH plate fading out over
the overview. That is the caption's out-fade, not a stall.

## Across the variants

There is one variant (`galaxy`); the `fx` are switches on it.
- `fx=lanes`, `comets` and `twinkle` all use a fixed, preallocated sprite pool with a hard cap
  (`fx.js:44`, `:184`, `:296`). Every per-thing cost on the page should look like that: bounded by a
  constant, not by the fleet. The member meshes (finding 8) and the label pass (finding 7) should
  copy it.
- `frame.js cover()` caches its box until its text changes. `hud.js tagCover` (finding 3) should copy that.
- `budget.js`'s doubling wait before stepping up is the right shape for a machine on the edge. It
  needs the pixel ratio as its lever (finding 2).

## Rubric

score galaxy overview 6
score galaxy legibility 6
score galaxy status 7
score galaxy touch 2
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-lanes wow 3
score fx-lanes calm 8
score fx-comets wow 4
score fx-comets calm 7
score fx-twinkle wow 3
score fx-twinkle calm 8

Performance 6, not higher: memory is flat and script fits 30 fps under the throttle. But the render path
wastes ~2.4 ms per frame on shader state (1), fill rate has no lever (2), and the frame forces layout (3).
Until a `?ratio=` run on the real tablet says otherwise, 60 fps at 2x is unproven. fx scores are from code
and the r28/r29 films: their cost is bounded and small (at most ~50 extra sprite calls).

## The 3 m check

`$RUN_DIR/shots/r37-3m.png` (the overview still `r37-still/custom-dark-1368.png` at a quarter width):
**yes for what and where, no for every site.** The red ■ HV2 nebula and the yellow ▲ HV1 cluster are the
loudest things on the galaxy. The banner `■ HV2 · STORAGE` / `POOL 97% FULL` reads easily. REMOTE,
DEMO-HOST, HV1, HV2 and HOME can be read. CLOUD is missing (under the fleet block: T19, still open). The
tag and the `+3 MORE` are too small to read at this scale.

## console.txt

- `r37-galaxy/console.txt` (filmstrip): empty, no lines (0 console/page errors).
- `r37-still/console.txt` (overview still): empty, no lines (0 console/page errors).
- Older ones I read for the fx scores: `r28-galaxy-comets/console.txt`, `r29-galaxy-twinkle/console.txt`,
  `r28-galaxy-off/console.txt`: empty, no lines.
