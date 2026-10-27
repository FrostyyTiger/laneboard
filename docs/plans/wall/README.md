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
- D8 **The galaxy is WebGL through three.js**, pinned (owner OK 2026-10-26; the
  sketch vendored `public/vendor/three/three.module.js` 0.170.0, MIT). No other 3D or UI framework.
- D10 **One camera director** (owner via the cockpit plan, 2026-10-26; `docs/plans/cockpit/README.md` §C4,
  open question 5): the tour, touch (explore) and later the cockpit agent's `fly_to`/`highlight` all move the
  camera through one controller that decides who drives, so they never fight. Precedence: a finger first,
  then a show command, then the tour. Show commands are display-only (they never change the fleet).
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
6. Speed on the tablet (§2.4; the sketch ran at 60 fps on the Surface Pro 7, i3-1005G1, owner 2026-10-26:
   keep it there, the real code adds labels, lock and effects): a frame budget, fewer segments and sprites when it is missed, no growth
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
Make it feel finished: fix what the panel hated, make touch work, make a dead feed look dead, and grow
the effects the owner kept. Night 2 is archived in `nights/night-2/` (PROGRESS with its morning report,
reviews r8-r59, research Q7-Q11): read its `## Later` and `## For the owner` before planning.

**The owner, 2026-10-26** (after night 2's morning report, on the real tablet):
- Night 2's galaxy on the Surface Pro 7 kiosk (`galaxy.html?demo=1&fx=beacon&perf=1`): "running good, looks
  good on the Surface, even the colours are pretty nice". Keep the palette; nothing added tonight may make it
  slower there (§7 Night 2 A6, `?perf=1`).
- The tour was too fast to read. Done before the night (`tour.js`, commit on this branch): normal speed is
  now overview 10 s, a calm site 6 s, a site in trouble 14 s, and trouble is revisited after every 2 calm
  sites; `?pace=wall` gives the demo data that speed (`?demo=1` alone keeps the film speed). Tune it, do not
  undo it: a name must be readable before the camera leaves.
- Effects: keep `beacon` and finish it; build `afterglow`, `sweep` and `warp`; rework `comets` and `twinkle`
  into one; drop `lanes`. `corona` is not an effect: a dead feed must look dead (B below).
- **No Wall module is fenced any more.** Night 2 kept away from `caption.js`, `frame.js`, `glow.js`,
  `lock.js`, `main.js`, `perf.js`, `tour.js`, `type.js`, `variants.js` on its own rule; tonight they may change,
  with their tests, as long as `wall.html` keeps working (its tests stay green). `loop/fenced.txt` is unchanged.

**A. Fix what the panel hated** (night 2's open T31-T42 and its morning report, worst first):
1. Flights: no dead air. The camera keeps an end of the flight in frame (T39), never flies through a cluster
   or the sun (T36), and `warp` (C) gives the flight a direction and a tint.
2. The overview looks like a galaxy again (T40 arm ribbon): dimmed dust made it "five grey crumbs and a black
   disc"; bring back the arms' shape without making dust look like data (T26).
3. One headline per trouble frame (T37): the banner and the caption never say the same thing at the same size.
4. No words on words (T31), the trouble planet's name readable at 3 m (T34), crit the most visible status
   for low vision too (T33), the caption follows a status that rises while held (T35), feathered plates (T38).
5. Accessibility from night 2's r49 7: no letter-by-letter typing for screen readers (plate `aria-live` off
   while typing, one hidden live node), the fleet line `role="status"`; `+N MORE` readable and tappable.
6. `wall.html?variant=islands-tiles` registered (the diff in `sketch/main.js.diff`; T7's modules exist), so
   the galaxy's no-WebGL fallback lands on it, not on radial.

**B. A dead feed looks dead** (core, not an `fx`; arguably a bug against §2): when `/ws` map frames stop,
from 3 m the page must say so. The sun's corona swells softly once per frame that arrives; with no frame
for 30 s it shrinks, the sun goes cold flat grey, the tag reads `STALE <age>`, and the caption says the
data is old. Never louder than live trouble; its absence is the alarm (night 2's r59 2, `corona`).

**C. Touch** (D4; the owner's words, 2026-10-26: "when I touch it, it snaps back to an outside view, and
then I can drag it and click around myself"):
1. First touch anywhere: the tour stops and the camera eases back to the overview (about 1.5 s), so the
   person starts from the whole galaxy. Nothing under that first touch is activated.
2. Drag turns the galaxy round its centre (orbit, clamped so the plane never goes edge-on or upside down);
   pinch (and the wheel on a desktop) zooms between the overview and a close system; inertia, eased.
3. Tap a site: the camera flies there and opens it, with a detail sheet in big type (the site's worst
   things first, from the model). Tap a planet in an open system: its own details. Hit-testing in screen
   space with a finger-sized radius (night 2's `## Later`, r31-touch).
4. Back: a big back control and a tap on empty sky return one step (planet → system → overview).
5. One minute without touch: ease back into the tour from where the camera is. Reduced motion (D5):
   the same steps without flights (cuts with a short fade).
6. No page scroll or pinch-zoom of the page itself (night 1's T31), and touch never breaks the kiosk.
Done when a test drives the gestures through pointer events on the page (fake clock) and a filmstrip shows
touch → overview → drag → tap a site → detail → back → tour resumes.

**D. Effects behind `?fx=`** (D9: switches, off by default; each ends in a filmstrip with and without):
- `beacon` (keep, finish): a floor height so a young crit is visible at once, a white core, age as width as
  well as height; a soft tip that the caption plate never cuts (night 2's T41, T38).
- `afterglow`: when trouble clears, its cluster keeps a faint ring in the old status hue on the plane,
  cooling red to amber to grey and gone after about 30 min. It shows recent history: in the morning you see
  where something went wrong in the night though it is green now. Quieter than any live trouble (outline
  only, never filled, never pulsing, §2.1). The page remembers the clears it has seen (no new server
  route, D2); a reload forgets them.
- `sweep`: once per tour cycle, at the overview only, one faint sensor line from the sun turns once round
  the plane. Each cluster it crosses pings softly, but only if its site sent new data since the last
  sweep: a silent site stays dark and the gap shows. One gesture for freshness instead of many heartbeats.
- `warp`: during a flight, dust and far stars stretch into short streaks along the direction of travel,
  tinted toward the destination's status, and snap back on arrival: you know the next target is red before
  the caption types it (night 2's r59 1, T42).
- `activity` (replaces `comets` and `twinkle`): what is at work comes forward, what is quiet recedes
  (research Q8 `fade`): a planet with a working session or a running job is brighter and slightly larger
  and carries a slow visible ring; a job that lands flashes its target once; a failed one visibly does not
  land (Q8 `miss`). Must be visible at the overview from 3 m, unlike night 2's two.
- `lanes` is removed (code, tests and docs). `storm`, `lights`, `rings`, `arrive` stay unbuilt (`## Later`).

**E. Docs and kiosk**: `docs/wall.md` (what it is, running it on a tablet in kiosk mode, the URL switches
`?demo`, `?pace`, `?fx`, `?perf`, `?at`, the feed fields, touch), a Wall row in README's views table, and a
web manifest for the galaxy (`start_url: "/galaxy.html"`, fullscreen, landscape) if it fits the
guardrails. `wall.html?variant=galaxy` opens the galaxy instead of silently falling back to radial.

Order: A1-A3 first (they make both the tour and touch better), then B, then C in its order, interleaved
with D and A4-A6 as triage adds panel findings; E last. The dreamer stays in the panel's rotation; triage
keeps its cap of 3 tasks per review.

### Night 4
The Wall's last night before its PRs merge (`docs/plans/product.md` §4: Wall finishes → merge → demo mode
→ hygiene → hosted demo, video, README → cockpit C1/C2). Read `docs/plans/product.md` and
`docs/plans/cockpit/README.md` (both on `main`) first: the Wall is the cockpit's first screen.

Owner notes after night 3 (2026-10-27, from his picks before and during night 3 and night 3's report in
`nights/night-3/PROGRESS.md`):
- Night 3 built the touch set, `beacon` and `warp` (29 of 41). His effect picks stand: keep `beacon` and
  `warp`, build `afterglow` and `sweep`, fold `comets` + `twinkle` into one `activity`, remove `lanes`.
  None of the last four was built in night 3, so they are this night's part 0b.
- Not decided yet, so not built as a default: the frame cap (30 fps in holds) may land behind `?cap=30`
  only, off by default; the r46 taste questions (kicker `TARGET 02 / 05`, the calm plate's line, sun or
  hub name) stay under For the owner.
- A night may run long: the round cap is the stop, not the clock.

**0a. Night 3's open tasks first.** T29, T31-T41 of `nights/night-3/PROGRESS.md`, renumbered from T1, each
naming its night-3 number (`was night 3's T36`), the touch ones first (T36 sheet not transparent to taps,
T38 banner and beacon are targets, T37 trouble planets pickable, T29 BACK keeps the pose), then
`MANUAL · TOUR IN 0:40` (night 3's Later, the first to promote: explore must look different from the
tour), then the rest in night 3's order.

**0b. The effects the owner picked that night 3 did not build**, one task each, each with a filmstrip:
`lanes` removed (code in `galaxy/fx.js`, `scene.js`, `main.js`, its tests and the `?fx=` list), then
`afterglow` (README Night 3 D), `activity` (replaces `comets` and `twinkle`, both removed with it), `sweep`.
Calm flights do not streak under `warp` (r46).

**A. One camera director (D10).** Night 3's `galaxy/touch.js` already hands the camera between tour and
explore; make that the one controller: `galaxy/director.js` with three sources, `tour`, `touch` and
`show`, the precedence of D10, an eased hand-over between any two (never a cut), and the rule that the
tour resumes a minute after the last touch or show. `tour.js` and `touch.js` drive the camera only
through it. Pure state with tests (fake clock): touch during a show, a show during touch, a show while
the tour flies.

**B. The show interface, client side only.** The cockpit's C4 tools as page commands:
`flyTo(nodeId)`, `highlight(nodeIds, note)`, `clear()`, plus `pin(nodeId, card)` as a plain text card
next to a node. Each is display-only, undoable with one tap, and shown as one line on screen ("shown by
the agent"). Commands reach the page through one small, documented message shape (for now a
`BroadcastChannel`/`postMessage` and a `?show=demo` script); the relay room → hub → screens is cockpit
work and touches fenced hub files: not this night. Demo: `?demo=1&show=demo` plays a recorded
conversation's show commands over the demo fleet (fly to the crit, highlight what it breaks, pin a
note), which is also the video's second half (cockpit §5).

**C. Scheduled jobs on the Map.** A generic feed field `countdown: { at, label }` (D3 style, like
`glow` and `ring`): the galaxy draws a small countdown at that node, readable at the site step and quiet
at the overview; the caption names it when the camera holds there. Display only (cancelling is C6, not
the Wall). Demo data carries one.

**D. Any screen can be tour, explore or canvas.** The Wall must look right in half a screen (a split
with a canvas): `galaxy.html` at 50 % width keeps the 3 m check (names, trouble, caption) and its touch
targets. `?role=tour|explore` starts it in that mode (explore: no tour until asked). The canvas itself
is cockpit work.

**E. Ready to merge.** Night 3's E first (`docs/wall.md`: kiosk mode, the URL switches `?demo`, `?pace`,
`?fx`, `?perf`, `?at`, `?role`, `?show`, the feed fields, touch; the web manifest; `wall.html?variant=galaxy`
opens the galaxy). Then `docs/wall.md` covers D10, the show messages and `countdown`; every feature has demo
data (product §3.2); README's views table row. `wall.html` (radial, still the default) gets one filmstrip,
because night 3 changed the shared `caption.js`, `tour.js` and `frame.js`. The morning report lists what a
reviewer should read first, and what reaches outside the galaxy (night 3: `public/css/tokens.css`
`--tex-vignette`).

Order: 0a (touch fixes, then MANUAL), then A (the director, since it rewires touch and tour), then 0b,
interleaved with triage's panel fixes, then B, C, D, E last. 2 to 3 research questions: the show
interface's message shape (what BroadcastChannel/postMessage kiosks and other display walls use), a
countdown readable from 3 m, and one `IDEAS:` question for `activity`. The dreamer stays in the rotation;
triage keeps its cap of 3.


### Night 5
Make the galaxy feel right in the hand: the look the owner picked in a live sketch, nested moons, a
roomier system, touch that lets him turn a system in 3D, and a node card. Night 4 is archived in
`nights/night-4/` (its PROGRESS, reviews r1-r61, research Q16-Q18); read its morning report first.

**The owner, 2026-10-27 evening** (after the Wall merged, PR #25, and three rounds of a live sketch on the
large demo fleet). The sketch is `sketch/night5/sketch5.diff` (against `main` 0c6b951; branch `sketch5`
on the run VM, never merged): every change sits behind a `?sk_*` switch, its panel compared them, and the
owner chose. **His picks become the defaults, with no switch**; the switches, `sketch-panel.js`,
`sketch.js`, `sketch5.css` and the "v1/v2 pick" presets do not land. The sketch is a reference for
what it should look and feel like, not code to paste: it broke 11 guardrail tests (a new sheet in
`public/css/`, modules reading `SK` or the DOM at load time, tap wiring checked as source, a person's name
in a label). Rebuild each part inside the guardrails, with tests.
- His words on the overall direction: "excellent. I like the movement, I like how it opens, I really
  like how it spins slowly." Keep the glow and the nebula haze ("looks really good"); keep right-click
  back and double-click zoom-out ("that's great, keep that").
- "Version 3 looks really good": the defaults are the sketch's `sk_tight=2 sk_size=1 sk_tint=2 sk_sun=1
  sk_soft=1 sk_haze=1 sk_arr=2 sk_sys=1 sk_moons=1 sk_pal=1 sk_card=1`.

**The cockpit shares these files** (cockpit night C1b runs in parallel; agreed with the cockpit session
2026-10-27). `loop/fenced.txt` lists what this night must not change. Not fenced but shared:
- This night owns `galaxy/touch.js` (and fixes its `createReturn` leftover: Back can fly to a pose a show
  left; it must return to the explore pose), the zoom/flight timings and hand-over eases in
  `galaxy/director.js`, the selection levels (site → planet → moon) and the node card.
- `galaxy/main.js` is shared: change only selection, card and look parts. The tour hold and the pane
  hooks stay as they are. C1b changes the board-down/stale caption and tag parts there.
- `public/css/wall.css`: add rules for the card and new tappables; do not change existing rules.
- The page contract is additive only: `window.__cockpitView` and `data-wall-state` keep every name and
  value. Moons join it (`screenOf`, `emphasis`, a show `fly_to` accept a moon id; `fly_to` on a moon frames
  it as planet → system does now). Stale/offline/board-down looks are C1b's (cockpit screens.md §7):
  do not build them.
- Every tappable this night adds or resizes: at least 48 px, a visible pressed state, `touch-action:
  manipulation` (cockpit spec D224; C1b's table test S-C1-41 will include the Wall's).
- Any change a round needs in a fenced file is written as a patch under `docs/plans/wall/patches/` with
  one paragraph of why; the cockpit folds it in.

**A. The look (his picks, as defaults; sketch params in brackets):**
1. Spacing half (`sk_tight=2`): arms, gaps, site lift, dust and ribbon at 0.5x, nebulae and sun halo
   0.64x, system spread 0.75x; the overview frames the whole galaxy snugly.
2. The rosette (`sk_arr=2`): a wider-wound two-arm spiral, a site every 72°, all sites level, only shown
   sites take slots; the first site far enough from the sun that an open system never crowds the sun.
3. Size is what it carries (`sk_size=1`): a planet by 0.8 + 0.35·log2(1+n) of what is below it, a star
   by 0.8 + 0.2·log2(1+planets), clamped 0.8x-2.2x, never by trouble. Big spheres must not look faceted.
4. Colour (`sk_tint=2`, `sk_pal=1`, `sk_sun=1`): each site a quiet warm-set tint (teal, indigo, plum,
   sage) in its calm nebula and dust; "lift": calm bodies and names a step lighter (stone), on a deep
   blue-black ground instead of pure black; a warmer, softer sun. "Some stuff is drowned out by the
   black. No neon, it feels cheap." Status hues stay the loudest thing on screen; tints from tokens
   through `palette.js`.
5. Depth haze (`sk_haze=1`): distance fog from 0.6x to 2.6x of the look-at distance; status-hued
   materials and trouble nebulae never fogged.
6. Gentler motion (`sk_soft=1`): open/fold 2800 ms on smootherstep, the target opening from 0.32 of a
   flight, held drift 0.6x, dust turn 0.6x.

**B. A roomier system and nested moons:**
1. System room (`sk_sys=1`): planets spread 1.4x with a minimum gap (13 % of the system's reach); what
   hangs below moves with its planet; labels never collide (HV1's builders cluster is the test case).
2. Moons (`sk_moons=1`): services under a room, lanes under a builder, sessions under a lane. Folded, they
   sit tight to their planet at half size, unnamed and not tappable. Tapping a planet (or one of its
   moons) opens them onto a ring round it, with the same open time and easing as a site, tilted toward
   the camera, a faint orbit line and thin tethers. About 110 px apart on screen, at least 72 px from the
   planet, named and tappable while open. "It's so tiny I need to select which one I meant": no picker.
3. Picking a planet or moon flies the camera closer (about 45 %), the planet left of centre, so the
   ring and the card use the empty screen.

**C. Touch and mouse** (the owner: "the target is a bit too small… when I'm clicked in I need to turn it
in 3D, which I can't because it collapses if I click again… moving out is way too quick… the turning at
the overview is a bit finicky"):
1. Hit targets in screen space: 48 px for a finger, 28 px for a mouse, the nearest centre wins.
2. Inside an open system a drag orbits it round its own star (both axes, pitch clamped) and it stays open.
   The first drag must not shift the system on screen (the sketch carried an aim offset). A tap on empty
   space does nothing.
3. Back is right-click, double-click/double-tap on empty space, or the Back control, one step at a time
   (moon → planet → system → overview); Back from a planet folds its moons and keeps the camera where he
   turned it. Zoom-out flights 3000 ms on a soft ease, double-click to the overview too.
4. The overview turn: 0.0032 rad per px, the camera follows with a short lag, a longer gentler coast,
   capped fling speed.
5. The `createReturn` leftover (above).
Done when page tests (pointer events, fake clock) drive: tap site → tap planet (moons open) → drag-turn
(system stays open, star stays put) → empty tap (nothing) → tap moon → Back ×3 → overview, with the
flight durations asserted; and a filmstrip shows it on the large demo.

**D. The node card** (display and navigation only; the design brief is `research/stellaris-ui-brief.md`,
from a research agent on Stellaris's interface, 2026-10-27):
1. An anchored card beside the selected node with a visible leader line; it docks to the right edge
   when it does not fit beside the node **or would cover the open system's planets** (the sketch never
   did the second). It keeps out of the fleet line and the tag.
2. Header: status dot, name, type chip, parent path (`hv1 › vm-a`), a 48 px ×. 3-4 key stats from the
   model (only the value that is off takes a status hue). A "Below" strip of child chips (tap: select
   and fly there; `+N`). An action row of at most 4 buttons and `…`.
3. Actions per type: site (Open, What's below, Board, Pin; `…` Proxmox link), room (Logs, Board, What's
   below, Pin; `…` Fly to, Terminal link, Proxmox link), builder (Run log, What's below, Board, Pin),
   service moon (Logs, Board, Pin, Fly to), lane moon (Log, PR, Pin, Fly to). Navigation actions work;
   links open the existing app views where one exists, otherwise they are absent (never a dead button).
4. **Fleet actions are cockpit C6, not this night**: restart a service, pause a builder or lane, snooze or
   ack an alert are drawn as disabled outline buttons tagged `later`, in their real slots; a tap says so.
   No button on the Wall does anything to the fleet. Nothing heavier (restarting a room or a host) ever
   appears.
5. Calm: grey glass from tokens, the site tint only as a 2 px top edge, a 150 ms fade, the galaxy dimmed
   slightly behind it. Closes on ×, Esc, an empty tap, a second tap on its node, a sideways swipe, or 60 s
   idle (then the tour may resume as now). The old left-hand sheet for a tapped node gives way to the card;
   the caption and the fleet line stay.
6. Accessible: the card is a labelled region, its buttons are real buttons with names, focus moves into
   it on open and back on close, Esc works.

**E. Docs and handover**: `docs/wall.md` (the look, moons, the card, the gestures; not the "Show
commands" or handle sections, which are fenced), demo data for everything, and a morning report that
lists what changed in shared files (`main.js`, `wall.css`, `director.js`) for the cockpit's rebase.
Night 4's open tasks stay under `## Later` (night 4's PROGRESS); only the ones that this night's parts
make moot are closed, with the reason.

**Night 6 (planned, not this night):** the rest of the Stellaris brief: an alert tray (empty when all is
well, a "clear for N days" streak), an outliner with an "all green" seal per site, a situation log (agent
nights as finished projects), a slim top bar of fleet totals, map modes (status, backups, load, agents).
Not built tonight.

Order: A (one task per item, A1-A2 together), then B1, B2-B3, then C (C1-C3 and C5 before C4), then D,
interleaved with triage's panel fixes; E last. Plan every part as tasks (up to 22): nothing of A-E waits
in `## Later` (night 4 lesson: parts parked there starve while panels add tasks). 2 research questions:
moons and nested selection in 3D strategy maps (how they stay tappable), and how a node card stays out
of the way on a 3D view. The dreamer stays in the rotation; triage keeps its cap of 3. Keep the speed on
the Surface (script ms per frame, `?perf=1`).
