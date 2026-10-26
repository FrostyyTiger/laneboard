# Wall: laneboard on a tablet or a wall screen

Status: plan, agreed with the owner 2026-10-25. Built by the agent loop in `docs/plans/wall/loop/`
(one night at a time, the owner reviews between nights). Progress: `PROGRESS.md`.

## 1. What and why

laneboard's Map is the most alive view it has. On a desk monitor it is a tool you drive with a mouse.
On a tablet propped under a monitor, or a screen on a wall, nobody drives it: it is looked at from a
metre or three, for a few seconds at a time, and touched now and then. **Wall** is a second, separate
way to show laneboard for exactly that: a page of its own (`/wall.html`), not a change to the app.

The owner's words, which are the brief:

> "I like the vibe that it's futuristic. It zooms in and there are nodes and it's moving."
> "It needs to be good, easily overviewable. It does still need to give us good status, and we still
> need to be able to also click around. So the zooming could be the screensaver, then we can click in."
> "One of those movie UI things, where it was obviously meant to look cool."
> "I really love how it gets spelled out slowly when it zooms in."

## 2. North star (the test every change answers to)

1. **From three metres, in three seconds, I know whether something is wrong and where.** Trouble is
   never hidden by the show: it is visited first, it is the loudest thing on screen, and it is
   readable without walking up.
2. **It is beautiful in motion.** Film-interface quality: deliberate rhythm, type that is typeset, motion
   that reads as one camera with intent, not as many animations. Nothing moves without meaning
   (the Map's rule, `docs/map.md`).
3. **A finger can take over at any moment.** Tap anything to fly there and read it; get back with one
   gesture; the tour resumes by itself after a minute.
4. **It runs all day on a small machine.** 30 fps on a 2019 tablet CPU (Intel i3, 4 GB), no growth in
   memory over hours, no heat.
5. **It is laneboard.** Same tokens, same status language (grey unless something needs you; hue and
   shape only for trouble, `docs/design.md`), same data. Wall may be bolder (bigger type, a vignette,
   captions), never a different product.

## 3. What exists (the starting point, on this branch)

- `public/js/views/map/index.js`: `createMap(el, { ambient })`: no HUD, no input, a slow turn around
  the view centre, frames capped at 30, flights 2.5x slower, `focus(id, zoom)` flies there and the
  camera stays on the node while the layout settles, `fit()` back to the overview, `onDraw(cb)` after
  every frame, `screenOf(id)` where a node is drawn now. Tests: `test/map-interact.test.mjs` (ambient).
- A working prototype outside this repo (the owner's private panel) that the loop must reproduce
  generically, described here so nobody needs it:
  - **Camera tour**: overview ~20 s, then the camera flies into one site (zoom ~2.3, contents unfold),
    holds ~25 s, flies out, next site. Trouble first: a site with anything at warn or worse is visited
    before calm ones, every cycle while it lasts. A demo speed (`?demo=1`: ~4 s per site) for videos.
  - **Captions**: when the camera arrives, top left: a small mono kicker (`TARGET 02 / 05 · SITE`),
    the name typed in letter by letter in big condensed caps with a block cursor, then 3-6 lines fade
    in one by one (the trouble line in its status colour with its shape, status, cpu/mem with thin
    bars, hardware/where/uptime from `detail`, room count). Dark translucent plate with two corner
    brackets. Fades out when the camera leaves.
  - **Target lock**: four corner brackets close in around the node as the camera arrives.
  - **Glow layer**: a canvas under the Map's (transparent) canvas paints soft radial glows at
    `screenOf(id)` (a light's real colour) and progress rings (a print job); nodes come from a feed.
  - **Frame**: a vignette darkens the edges so text sits on quiet ground; a big clock bottom left;
    bottom right one line for the worst fleet problem and one ambient fact; a small tag top right.
  - **Brighter tokens** for distance (scoped to the wall): text-2 88 %, text-3 74 %, lines 0.16/0.30/0.48.
  - Measured on the target tablet: 30 fps at 2736x1824 (2x), Chromium 20-30 % CPU.
- `test/tools/demo-fleet.mjs`: a demo hub with 3 builders on one hypervisor. Too small to judge a wall:
  the real fleets this is for have 80-150 nodes over 4-6 sites.

## 4. Decisions (taken; the loop does not reopen them)

- D1 **Wall is its own page**, `public/wall.html` + `public/js/wall/` + `public/css/wall.css`. The app's
  views, router and shell are not changed. The Map module is shared; anything new in it is behind the
  `ambient` option (or a new option that defaults off) and the existing Map tests stay green unchanged.
- D2 **Data from the same API**: `GET /api/map` and the `/ws` map messages; no new server route unless
  it cannot be done without (then: `## For the owner`).
- D3 **Extras through feeds**, generic: a node may carry `glow: {rgb, level}` or `ring: {progress}`
  (a feed sets them; the Wall paints them; the app ignores them). No home-automation code in laneboard.
- D4 **The tour is the screensaver, touch is the explorer.** Idle: tour. Touch: the camera goes where the
  finger says, a detail sheet in big type, back gesture; one minute without touch: the tour resumes.
- D5 **Reduced motion**: no tour flights, no turn; the overview with a slow caption rotation instead.
- D6 **Repo is public**: demo names only (`hv1`, `builder-a`, `acme`, `example.invalid`). The hygiene
  test is the gate.
- D7 **Nights are explore, build, polish** (§7). Night 1 builds several directions and picks none.
- D8 **The galaxy is WebGL through three.js**, pinned (owner to confirm before night 2 starts; the
  sketch vendored `public/vendor/three/three.module.js` 0.170.0, MIT). No other 3D or UI framework.
- D9 **Effects are switches, the owner picks** (`galaxy.html?fx=<name>`, off by default). The loop builds
  and films them and the panel scores them; it never turns one on by default.

## 5. Layout: the galaxy (the owner's pick after night 1, 2026-10-26)

Night 1 built `radial`, `orbits`, `islands` and `mosaic` (`nights/night-1/`). The owner looked at them
and at sketches made the morning after, and picked **one 3D galaxy**. The sketches are reference, not
code of this branch: `docs/plans/wall/sketch/` (the galaxy is `galaxy.js` + `galaxy.html`; the 2D
fallback `islands-tiles.js` + `tiles.js` + the links change in `main.js.diff`); runnable on branch
`sketch/wall-galaxy` (`/galaxy.html?demo=1`, `?at=<site>&open=0..1`). They break this repo's guardrails on
purpose (inline colours, top-level DOM, `innerHTML`, an absolute three.js import). What is fixed:

- **One galaxy, not islands.** The hub is the sun in the middle; the sites are star clusters along
  spiral arms in a band of dust, a faint hyperlane from the sun to each. Seen from above at an angle.
- **Grouped, and they open up.** At the overview a site is folded tight inside a nebula that takes its
  worst status (calm: faint; warn: yellow; crit: red, breathing). When the camera flies to a site its
  cluster opens into a 3D system; when the camera leaves it folds back.
- **Real 3D, still readable.** Planets (rooms, builders) are lit spheres on inclined orbits, above and
  below their system's plane by at most about half their distance from the star; each has a **stem**
  down to the plane with a small ring where it lands. Names are drawn over everything and always face
  the camera. The camera drifts slowly round a held system, so the depth reads.
- **The red effect stays**: things in trouble glow from inside and pulse; a crit nebula breathes. The
  owner: "ideas like that make this amazing". Trouble is still the loudest thing on screen (§2.1).
- **Fallback**: `wall.html?variant=islands-tiles` (islands, trouble as filled hex tiles, links only on the
  held site) stays as the 2D page for a machine without WebGL. Not polished further.

What the sketches leave open is night 2's work (§7). The other directions and sketch variants stay in
the code until night 3 decides what to delete.

## 6. Personas (the review panel)

One persona per review round, in rotation (`loop/personas.txt`, prompts in `loop/prompts/personas/`).
Each writes findings worst first with a concrete fix, and scores every variant 1-10 on the rubric
(overview, legibility at 3 m, status, touch, wow, calm, performance). The scores go to `run.jsonl`.

From night 2: the panel judges the `galaxy` (the variant name in its score lines) and every built `fx`
(`score fx-<name> wow|calm <n>`). A **dreamer** persona joins the rotation: it says what is missing, not
only what is wrong. Every reviewer adds a **3 m check**: one still at the overview, shrunk to what 3 m
away looks like, and whether trouble and site names still read. **Triage turns at most 3 findings of a
review into tasks** (the worst); the rest go to `## Later` with the review named (night 1: ten reviews
made 52 tasks and 35 were left open).

## 7. Nights

### Night 1
Explore. Build the ground, then several directions; review them all; decide nothing.
1. A large demo fleet: `test/tools/demo-fleet.mjs --size large` (or a fixture the Wall can load with
   `?demo-map=<file>` when no hub runs): 5 sites (two hypervisors, a cloud, a remote site, a home with
   lights that carry `glow`, a 3D printer with `ring`), 100-150 nodes, live flows, and trouble that comes
   and goes (one crit, one attention, one warn; a door-like event every few minutes).
2. `public/wall.html` with the tour, captions, target lock, glow layer, frame (vignette, clock, status
   lines, tag), brighter wall tokens, `?demo=1` speed, `?variant=`, and `window.__wallPerf =
   {frames, worstGapMs}` counting drawn frames (the filmstrip tool reads it). Tests for the tour order
   (trouble first), the caption content and the variant switch.
3. Research (sources, no code): film/TV interface design and how it stays readable (practitioners'
   own write-ups); calm technology and ambient displays; legibility at distance (type size per metre,
   contrast); touch target and gesture guidelines for wall/kiosk use; graph layouts that use a wide
   screen (orbital, cluster, hierarchical edge bundling) and how other ops tools draw infrastructure.
4. The directions of §5 (`radial`, `orbits`, `islands`, wild card), one builder task each at least.
5. A filmstrip of every direction (`loop/film.mjs`) under the CPU throttle, and the persona panel over
   all of them, in rotation, as long as the night lasts.
6. The morning report compares the directions with their scores and filmstrips and asks the owner to
   pick (or combine).

### Night 2
Build the galaxy properly, polish it with the panel, and **explore effects** for the owner to pick from.
The loop picks no effect: it builds each behind a switch, the panel scores it, the owner decides.

**A. Solid** (first, in this order):
1. The sketch (§5, `docs/plans/wall/sketch/`) into Wall code, inside the guardrails
   (`test/frontend.test.mjs`): `public/js/wall/galaxy/` modules (layout: arms, cluster offsets, heights,
   fold/open as pure functions with tests; scene; camera; labels), the page `galaxy.html` using the
   Wall's caption, frame and clock (`caption.js`, `frame.js`) instead of the sketch's own, the tour from
   `tour.js` (trouble first) driving the 3D camera. `window.__wallPerf` counts frames as on `wall.html`.
2. three.js as a pinned dependency (D8), served like the other vendored files (with its licence), and
   the `islands-tiles` fallback variant from the sketch (`tiles.js`, focus-only links) with its tests.
3. Labels in 3D: no two names on top of each other (the sketch piles lane names at a busy builder):
   a screen-space collision pass, lanes named only when in trouble or the camera is close.
4. Live data: a status change recolours and re-glows without a rebuild or a jump; a tree change folds
   the cluster, re-lays it, opens it again. The camera never cuts.
5. The target lock and the caption's trouble word on the 3D camera (project the node to the screen).
6. Speed on the tablet (§2.4): a frame budget, fewer segments and sprites when it is missed, no growth
   in memory over an hour (`?perf=1` overlay). Measure script ms per frame; fps under SwiftShader
   measures the VM, not the page (filming note in `nights/night-1/PROGRESS.md`).
7. Reduced motion (D5): no flights; the overview with all clusters folded and the caption rotating.

**B. Polish** (the panel's findings, through triage, §6): tour pacing, camera paths (no flight through
the sun or a cluster), how far a system opens, nebula shapes and colours, the sun, the dust and how it
drifts, type at 3 m.

**C. Explore: effects behind `galaxy.html?fx=<name>`** (comma-separated, all off by default). One builder
task each, each ending in a filmstrip with and without it. Start with these; research and the dreamer
persona add more (at most 4 new ones a night):
- `lanes`: a light pulse runs along a hyperlane while a link between two sites is live.
- `comets`: a running job or deploy is a small comet with a tail from its builder to where it lands.
- `twinkle`: a planet with a working session twinkles softly (calm stays calm: slow, low contrast).
- `storm`: a crit nebula turns into a slow storm (swirl, flicker of lightning), not just a brighter cloud.
- `lights`: feed `glow` (D3: the home's lights) colours its planet's halo in the light's real colour.
- `rings`: feed `ring` (a print job) as a ring of light filling round its planet.
- `arrive`: a short shockwave on the plane when the camera arrives at a system in trouble.
Each effect: what it means is in its caption line or `docs/wall.md`; nothing moves without meaning.

**D. Research, as an idea hunt** (research.md, mode `ideas`): Stellaris, Homeworld, Elite Dangerous,
EVE's map, No Man's Sky's galaxy map, sci-fi interface work (practitioners' write-ups), data-art and
generative pieces that show live systems. Each question returns 2-3 concrete proposals for this Wall
(what it would show, what it means, a cost guess); the planner turns the best into `fx` tasks.

**E. Docs**: `docs/wall.md` (what it is, how to run it on a tablet in kiosk mode, the feed fields, the
`fx` switches) and a Wall row in README's views table.

The morning report lists every `fx` with its filmstrip and scores, and asks the owner: keep, drop, or
more of it. Touch (D4) waits for night 3, after the owner has seen the galaxy on the tablet.

### Night 3
Polish with the panel: every persona at least once on the built Wall, triage, fixes. Written after night 2.
