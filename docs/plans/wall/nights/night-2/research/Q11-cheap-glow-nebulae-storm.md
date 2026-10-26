# Q11: cheap glow, nebulae and a storm in three.js without a post pass

## Answer

- Skip bloom. `UnrealBloomPass` costs 13 full-screen draws and 11 half-float targets per frame (read from its source). One report shows it dropping to about 20 fps on an Intel laptop at full canvas width. Additive sprites with a baked radial texture, which `galaxy/scene.js` already uses, give the same look for trouble halos at a fraction of the cost.
- A nebula is a few large additive sprites with a texture baked once, with fBm noise on a small canvas or a one-off shader render. Do not run noise per pixel per frame.
- A storm (`fx=storm`) is cheapest as a slowly rotating sprite (`SpriteMaterial.rotation`, a uniform) plus an opacity flicker driven by a seeded, stepped function. Reserve a per-pixel warped-fBm shader for a few sprites, if at all.
- Not confirmed: no measured iGPU numbers for sprites versus bloom (as with Q9), and no primary write-up of a cheap lightning technique.

## What the builder needs

**Bloom cost (from three.js `UnrealBloomPass.js`, dev branch):**
- 5 mips at 1/2, 1/4, 1/8, 1/16 and 1/32 of the render size.
- 1 high-pass, 10 blur passes (a horizontal and a vertical pass per mip), 1 composite and 1 additive blend, so 13 full-screen draws. Add 1 more if it renders to screen.
- Kernel sizes 6, 10, 14, 18 and 22. Targets are `HalfFloatType`.
- The docs say tone mapping must be enabled on the renderer. This also changes the colours of the rest of the scene.
- The forum report (Intel MacBook, Safari): about 20 fps at full width, about 60 fps at 400 px wide, 60 fps on M1. The cause was partly Safari's WebGL-via-Metal, which hurt even without bloom, so treat it as an anecdote. Chrome on the same machine was fine. Cost scales with pixels, which is also why Q9 names adaptive pixel ratio as the lever.
- If bloom is ever wanted: render the bloom at half of the scene's pixel ratio, with only the top 3 mips. This is my inference from the source, not a tested setting.

**Additive sprite glow:**
- `SpriteMaterial({ map: glowTex, blending: AdditiveBlending, transparent: true, depthWrite: false })`.
- One shared texture and one material per tone, so the draw state stays shared. Sprites are still one draw call each. Past a few hundred halos, merge them into a `Points` object or an instanced quad.
- Core plus halo: a small white-ish centre and a larger tinted outer glare (the layering used in the WebGL nebula write-ups below).
- Overdraw is the real cost. A large halo over many pixels, stacked many times, is fill-rate bound on an iGPU. Cap the sprite scale in screen pixels and fade far halos.

**Nebula:**
- The Codrops sprite-cloud article extends `SpriteMaterial` with a custom shader and uses fBm to distort UVs, giving a soft smoky edge. I could not fetch the page (HTTP 403), so this comes from a search summary only.
- fBm of 3-4 octaves (each octave at twice the frequency and half the amplitude) is enough for cloud texture, per the same summaries.
- Cheapest route: bake the noise once into a 128-256 px `CanvasTexture` or `DataTexture` at start-up, one per cluster seed, and then only move the sprite (scale, rotation, opacity). `galaxy/scene.js` already has a `cloudTex` and does this.
- Many overlapping low-opacity sprites with different rotations read as depth without any per-frame noise.

**Storm (`fx=storm`):**
- Domain warping (Quilez, `fbm(p + 4*q)` with q made of two offset fBm calls) makes the swirl. It costs about 3-5 fBm evaluations per pixel, each 3-4 octaves, so use it only on a baked texture or on one or two small sprites.
- Swirl for free: rotate a baked, non-symmetric cloud sprite slowly. Layer two sprites rotating in opposite directions or at different speeds for shear.
- Flicker: use a stepped, hashed value of `floor(t * rate)` and the cluster id, with a fast decay (a few frames up, ~150-300 ms down). This is my suggestion, not from a source. It keeps the flicker seeded and reproducible for the film tests.
- Meaning: the flicker rate or brightness must carry data, for example errors per minute. Per Q8, nothing moves without meaning.
- Respect reduced motion: hold the storm static and keep only the hue.

## What laneboard's Wall could take

1. Keep additive sprites and make no bloom pass. T3 can add a `fx=storm` variant of the existing nebula sprite: the same baked cloud texture, a second counter-rotating sprite, and a stepped opacity flicker tied to a trouble metric.
2. Add a per-frame cap on total additive screen area. Measure it with the perf probe from Q9, and fade halos by distance first when over budget.
3. Bake nebula textures once per seed. Dispose them with the scene (Q9's dispose rules).
4. Only if the owner wants a real bloom look on the wall screen (not the tablet): make it an option, at half resolution, off on tablets. Test it with `film.mjs` at 4x CPU throttle.

## Sources

Read 2026-10-26.

- three.js `UnrealBloomPass` docs: https://threejs.org/docs/pages/UnrealBloomPass.html (parameters, tone mapping, "good quality and good performance")
- three.js `UnrealBloomPass.js` source: https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/jsm/postprocessing/UnrealBloomPass.js (mips, passes, kernels, targets)
- three.js forum, bloom on Intel Safari: https://discourse.threejs.org/t/unrealbloompass-poor-performance-on-macos-safari-with-intel/42606 (about 20 fps vs 60 fps; the Metal backend confound)
- three.js forum, glow without outer glow geometry: https://discourse.threejs.org/t/cant-get-outer-glow-to-work-with-unrealbloompass/52643 (anecdote only; search summary)
- Codrops, procedural clouds with sprites: https://tympanus.net/codrops/2020/01/28/how-to-create-procedural-clouds-using-three-js-sprites/ (search summary only; page returned 403)
- Quilez, domain warping: https://iquilezles.org/articles/warp (via search summary; direct fetch gave 404/redirect. The triple-nested form is attributed to him in The Book of Shaders, not confirmed in the article.)
- Active Theory, WebGL nebula write-up: https://medium.com/@activetheory/neve-webgl-and-vr-d42a25856d67 (core plus coloured outer glare; summary only)
- Google Experiments Nebula (additive blending): https://experiments.withgoogle.com/nebula (summary only)
- Repo: `public/js/wall/galaxy/scene.js` (existing halo, nebula and `glowTexture` sprites).

No page tried to give instructions.
