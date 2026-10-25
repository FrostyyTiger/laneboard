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

## 5. Layout is open (night 1 explores it)

The circle came from the desk Map. On a 3:2 or 16:9 screen it uses only the middle square. Night 1
builds **3 or 4 directions** behind `wall.html?variant=<name>`, each a complete idle screen with the
tour, on the large demo fleet, so they can be compared like for like:

- `radial`: today's constellation, refined (spacing, line density, label sizes for distance).
- `orbits`: the rings as ellipses that use the full width; sites as planets with their rooms in orbit.
- `islands`: each site its own cluster ("island") laid out across the screen, links as long arcs between
  islands; the camera tours island to island.
- one **wild card** from the research (a direction nobody listed: the researcher's best find).

Each must keep: trouble first and readable, the caption, the lock, the glow layer, 30 fps under the
CPU throttle, labels legible at the overview for sites and rooms (services and leaves may be dots).

## 6. Personas (the review panel)

One persona per review round, in rotation (`loop/personas.txt`, prompts in `loop/prompts/personas/`).
Each writes findings worst first with a concrete fix, and scores every variant 1-10 on the rubric
(overview, legibility at 3 m, status, touch, wow, calm, performance). The scores go to `run.jsonl`.

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
Build the chosen direction properly: touch explorer (tap a node: fly, unfold, detail sheet; back;
resume after a minute), reduced motion, docs (`docs/wall.md`: what it is, how to run it on a tablet in
kiosk mode, the feed fields), tests. Written after the owner's pick.

### Night 3
Polish with the panel: every persona at least once on the built Wall, triage, fixes. Written after night 2.
