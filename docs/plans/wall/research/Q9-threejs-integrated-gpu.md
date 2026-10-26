# Q9: three.js on a small integrated GPU (UHD G1, 2736x1824)

Round 10, researcher. Web read 2026-10-26. **Thin: no source gives measured numbers for the UHD G1,
and none gives a hard draw-call or sprite limit.** What follows is what the sources do say, plus
arithmetic marked as mine. Measure on the real tablet before trusting any budget below.

## Answer (short)

1. At 2736x1824 the pixel count, not the draw-call count, is the likely limit on a 32-EU iGPU. The canvas
   is ~4.99 Mpx; one full-screen layer at 60 fps is ~300 Mpx/s. Cheapest lever: the drawing buffer
   (`setPixelRatio`), then overdraw of additive sprites, then MSAA. Draw calls come after.
2. Draw calls: the sources only say "fewer is better" and "look at it past ~200 calls" (a guide's
   flowchart, not a measured limit). Our scene is far below that unless names become one mesh each.
3. Names: keep one canvas texture per *distinct label*, cached, shared by name; or a 2D overlay (DOM
   or a second 2D canvas) for the few that are on screen. SDF text (troika) is one mesh + material per
   `Text`, async, and needs `dispose()`; it is the heaviest option for many labels.
4. GPU time per frame: `EXT_disjoint_timer_query_webgl2` is the tool, but Chrome disabled it in v65
   (2018) and re-enabled it only gradually; current status not confirmed. Use `chrome://gpu` /
   feature-detect, and fall back to the proxy test below.
5. Leaks over hours: dispose what you create, cap caches, and watch `renderer.info.memory`; the
   Wall's `scene.js` already collects shared resources and disposes them.

## What the builder needs

### Pixels (my arithmetic, not from a source)
- 2736x1824 = 4,990,464 px. At 60 fps = 299 M px/s per full-frame layer; at 30 fps 150 M.
- `renderer.setPixelRatio(min(2, dpr))` is what `scene.js:136` does. If the tablet's panel is dpr 2
  (CSS 1368x912), that is already the full 5 Mpx. A cap of 1.5 gives 2.8 Mpx (56 %), 1.25 gives 1.9 Mpx
  (39 %). discoverthreejs advises capping the ratio at 2-3 on phones and says it is a "considerable
  performance gain at the cost of slight blurring" (no figures). Make the cap adaptive: if the
  rolling frame time is over budget for N s, step the ratio down 0.25 and `setSize` again; never step up
  during a run unless idle for minutes.
- `antialias: true` (`scene.js:135`) means MSAA on the default framebuffer; the cost scales with pixels.
  At dpr >= 1.5 the extra edge quality is small; consider `antialias: dpr < 1.5`. Not measured.
- Additive halo sprites (`depthWrite:false`, `AdditiveBlending`) are blended, so each one costs its
  *screen area* per frame. A sprite 600 px across is 0.28 Mpx; ten of them are as much as 56 % of a
  full layer. Keep the big ones (nebulae, sun halo) few and use the smallest texture that looks
  smooth (discoverthreejs: use the smallest texture that works; a 256x256 tiled texture may be enough).
- GPU facts that are sourced: UHD G1 has 32 EUs, up to 900 MHz on the i3-1005G1, shares system memory
  (Notebookcheck). The ~460 GFLOPS peak I computed (32 EU x 8 ALU x 2 x 0.9 GHz) is **my estimate,
  unverified**; no fill rate was found.

### Draw calls and instancing
- Each distinct mesh/sprite (geometry + material) is at least one draw call; `InstancedMesh` draws many
  copies of one geometry+material in one call; `BatchedMesh` merges different geometries sharing a
  material (guides summarised by search, not primary: see sources).
- Sprites are each a call (one quad, own material state). Many same-texture halos can be one
  `InstancedMesh` of a plane facing the camera (needs a small custom shader or `lookAt` per instance
  matrix) or one `Points` with a per-point size attribute and a soft-disc fragment (cheapest; `Points`
  size is in px, so scale in the vertex shader by distance).
- Shared materials per tone (as `haloMat` already does) cut state changes; sprites that differ only
  in `opacity` need their own material (`nebMat` is per nebula for that reason): move opacity into a
  per-instance attribute if the count grows.
- Hide rather than remove (`visible = false`): adding/removing lights forces shader recompiles
  (discoverthreejs). The scene has 3 lights; do not add lights per event.
- InstancedMesh cannot free one instance: reorder and lower `count`, or reallocate buffers and dispose the
  old ones (three.js forum answer, not primary).
- Find CPU vs GPU bound: set `scene.overrideMaterial` to a basic material; if fps rises you are
  GPU-bound (discoverthreejs). Cheap to put behind a `?probe=` flag.

### Names (labels)
| Option | Calls | Memory | Notes |
|---|---|---|---|
| Canvas-texture sprite per name | 1 each | 1 texture each (w*h*4 B, e.g. 256x64 = 64 KB) | Simple; cache by string; dispose when the lane leaves. Texture upload on first show only. Mipmaps/NPOT: see below. |
| 2D overlay (DOM/second canvas) | 0 in WebGL | none in GPU | Crisp at any size, free layout and CSS; project positions each frame (cost per label: one `Vector3.project`). Best for the ~10-30 labels visible at once. |
| SDF text (troika-three-text) | 1 mesh + material per `Text` | glyph atlas shared | Worker-side layout, `sdfGlyphSize` default 64, async `sync()`, `dispose()` required, no woff2, no batching documented. A new dependency: **breaks the "no new runtime dependency" rule**; not for us. |
- Textures: power-of-two sizes allow mipmaps and repeat; NPOT cannot (discoverthreejs). A label atlas
  (one 2048x2048 canvas, one name per cell, sprites sharing the texture with different `uv` via
  `texture.clone()`-free `SpriteMaterial` offsets, or an instanced quad with a per-instance uv) turns N
  textures into one; more work, only needed past a few hundred labels.
- A 4K RGBA texture is 64 MB (more with mipmaps; a guide says 64-128 MB): never make a texture per
  frame or per status change.

### Measuring
- `renderer.info.render.calls / triangles / points / lines` per frame and `renderer.info.memory.geometries /
  textures` (three.js docs). `autoReset` is true, so the numbers are of the last `render()`; with extra
  passes set `autoReset=false` and call `info.reset()` once per frame. Log both into `__wallPerf`.
- Script ms: `performance.now()` around `update()` and around `renderer.render()` in the same frame.
  `render()` returns after *queuing* GL commands, so its JS time is CPU submission, not GPU time.
- GPU ms: `gl.getExtension('EXT_disjoint_timer_query_webgl2')`; `createQuery`, `beginQuery(ext.TIME_ELAPSED_EXT, q)`,
  render, `endQuery`; next frames poll `getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)` and check
  `gl.getParameter(ext.GPU_DISJOINT_EXT)` (discard the sample if true); result in nanoseconds. Keep a
  small ring of queries (results arrive frames later). In Chrome the resolution is microseconds
  (Khronos list), the extension was switched off in v65 and returns gradually; treat `null` as normal.
  Docs: MDN's page covers only the WebGL1 variant and a spec-based pattern; WebGL2 names differ.
- Proxy when no timer query exists: frame interval from `requestAnimationFrame` deltas (already in
  `__wallPerf`) versus `performance.now()` script ms. If the script ms is low (<4 ms) and the interval
  is long, the GPU (or vsync/throttle) is the bottleneck. Also run once with `setPixelRatio(0.5)`: if
  fps jumps, it was fill-bound.
- The film tool's 4x CPU throttle only slows the **CPU**; it says nothing about GPU fill. Headless
  Chromium here likely renders in software (SwiftShader), so its fps is not an iGPU estimate either
  (my inference; not confirmed). Real numbers need the real tablet.

### Memory over hours
- Removing an object from the scene frees nothing on the GPU. `geometry.dispose()`, `material.dispose()`,
  `texture.dispose()` and `renderTarget.dispose()` each free their own; disposing a material does not
  dispose its textures, and vice versa (standard three.js behaviour; the docs page I could fetch did not
  spell it out, so this is from general knowledge plus the forum and troika notes).
- Watch `renderer.info.memory`: if `geometries` or `textures` climbs steadily over a night, something
  is created per event and not disposed.
- Rules for the Wall: (1) build the shared set once (the current `shared[]` list, disposed at the end);
  (2) per-site things (`w.own`, `nebMat`, label textures) go through one owner that disposes on removal
  (`scene.js:296` does); (3) label/texture caches are LRU with a cap (e.g. 64) and dispose on
  eviction; (4) never create `Color`/`Vector3` in `update()` per frame (GC churn, jank every few
  seconds); (5) one long-run test: 2 h headless with demo events, assert
  `memory.geometries/textures` flat after the first 5 min and `performance.memory.usedJSHeapSize` (Chromium) not growing >10 %.
- Context loss: a wall screen runs for days; add `webglcontextlost` / `webglcontextrestored` handling
  (prevent default, rebuild). Not researched further here; worth its own small task.

## What the Wall could take, concretely

1. **T6/T10 budget line in `__wallPerf`**: add `calls`, `triangles`, `geometries`, `textures`, `scriptMs`,
   `renderMs`, and `gpuMs` when the timer extension exists. Small.
2. **Adaptive pixel ratio** (step 0.25 down when the 2 s rolling frame time > 1.3x target; floor 1.0). Small. This is the one
   change most likely to save a slow tablet.
3. **Cap nebula/halo screen size** or fade the biggest when near the camera (overdraw). Check the
   crit nebula tasks (T16, T17: more billboards per nebula) against this: three billboards x 600 px
   each is the expensive case. Prefer smaller textures (128-256) for them.
4. **Labels**: keep the 2D overlay for names; textures only for in-world marks. No troika.
5. **`?probe=` flag**: `overrideMaterial` and `pixelRatio=0.5` switches for the owner to run on the tablet and report fps.
6. **Soak test** as in "Memory over hours" (5).

## Not confirmed

- Any measured fps/ms on UHD G1 or similar Gen11; any sprite count that holds 30-60 fps.
- Whether current Chrome (2026) exposes `EXT_disjoint_timer_query_webgl2` on desktop Linux/Windows with Intel
  (check `chrome://gpu` or `getExtension` on the tablet).
- Whether `renderer.setPixelRatio` below dpr is visibly soft at 3 m on that panel (a look, not a number).
- The three.js disposal manual page and `WebGLRenderer.info` memory details beyond the field table (fetch failed; the manual URL 404ed).

## Sources (all read 2026-10-26)

- discoverthreejs, Tips and tricks (pixel ratio 2-3 cap, `overrideMaterial` probe, texture sizes, hide vs remove, lights recompile): https://discoverthreejs.com/tips-and-tricks/
- three.js docs, WebGLRenderer / `info` fields, `autoReset`, `setPixelRatio`, `dispose`: https://threejs.org/docs/pages/WebGLRenderer.html
- troika-three-text README (SDF, worker, `sdfGlyphSize` 64, `dispose()`, no woff2, no batching documented): https://github.com/protectwise/troika/tree/main/packages/troika-three-text
- MDN, EXT_disjoint_timer_query (WebGL1; constants, limited availability, not Baseline): https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query
- Khronos public_webgl list, Chrome 65 disabling the timer extensions, microsecond resolution, gradual re-enable (2018-2021 posts, search snippets): https://www.khronos.org/webgl/public-mailing-list/public_webgl/1805/msg00010.php , https://www.khronos.org/webgl/public-mailing-list/public_webgl/2103/msg00003.php
- three.js forum, GPU timing panel thread (queries are not available next frame; poll): https://discourse.threejs.org/t/how-to-test-shader-performance/24887
- three.js forum, disposing one instance of an InstancedMesh: https://discourse.threejs.org/t/is-it-possible-to-dispose-of-one-object-from-the-instancedmesh/46783
- Notebookcheck, UHD Graphics G1 (32 EU, 300-900 MHz on i3-1005G1, shared memory): https://www.notebookcheck.com/Intel-UHD-Graphics-G1-Ice-Lake-32-EU-Notebook-GPU.422869.0.html
- Secondary performance guides found by search, used only for the "~200 calls" and "64-128 MB for 4K" figures (not primary, treat as folklore): https://www.utsubo.com/blog/threejs-best-practices-100-tips , https://metadesignsolutions.com/blog/threejs-performance-optimization-best-practices

No page tried to instruct me.
