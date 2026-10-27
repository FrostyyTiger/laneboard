# Review r41: the film-interface designer

Round 41, night 1. Persona: film-ui. I judge composition, the type system, the camera's rhythm,
whether it reads as one instrument, and the wow.

What I judged. Shared code changed after the newest films (T48 at 9d546e6 and T49 at 883d06f touch
`type.js`), so I shot all four again at 883d06f on `demo-fleet --size large`:
- filmstrips `$RUN_DIR/shots/r41-<variant>/` (`&demo=1`, 12 frames, CPU 4x, SwiftShader wrapper per
  the PROGRESS filming note);
- stills `$RUN_DIR/shots/r41-still-<variant>/custom-dark-1368.png`.
Frame numbers below are sheet positions 1-12, left to right, top to bottom. fps here is the
SwiftShader-plus-screenshots number (2.2-3.5) and says nothing about the page.

Since r9 the shot exists. There is a tour, a lock, a typed name, a frame, and four layouts. This
review is about what keeps the four from reading as one designed instrument. Findings already
covered by an open task are marked with the task. New ones are not marked.

## Shared by all four (caption, frame, lock, tour)

1. **Two clocks in one frame disagree.** Islands frame 7 (30.2 s): the caption's trouble line says
   `builder-c no contact for 25s`. The map label under VM-C says `29s`, and the fleet line says
   `NO CONTACT FOR 29S`. Mosaic frame 6 shows the same thing: `29s` on the plate, `33s` on the tile
   and on the fleet line. The caption freezes its values when it types in. Everything else stays
   live. On film this is a continuity error. A careful viewer catches it in the two seconds they
   get, and after that they trust none of the numbers. Fix: build the trouble text once per tick in
   one place (`worstLine` and `captionLines` sharing one age formatter). Round the age to T52's
   stable step so neither text needs to change mid-hold. If a value has to be live, the plate line
   updates in place with no re-fade.

2. **Each hold says the same thing three times.** Radial frame 7, islands frame 7 and mosaic frame 6
   all show the problem three times: the caption names it (`■ VM-C builder-c no contact`), the map
   names it under the node, and the fleet line names it again in the biggest type on screen
   (`■ HV1 · VM-C · BUILDER-C / NO CONTACT FOR 29S`). The shot then has two heroes fighting
   diagonally, top-left plate against bottom-right line, and the lock sits between them. Film
   grammar allows one hero per shot. Fix: when the visited site holds the fleet's worst problem,
   the fleet line steps down to its calm size (2.7vmin) and shows the *next* problem or `+5 more`.
   It comes back to full size when the camera leaves. At the overview, the fleet line is the hero,
   as now.

3. **Empty plates while the camera flies** (T42, T23). Orbits frame 2, islands frames 9 and 12, and
   mosaic frames 4, 9 and 12 show a plate with a kicker, a block cursor and no name. That is 6
   frames out of 48. An empty title card over a moving camera reads as "loading", not as
   anticipation. The demo's `leadMs: 900` makes it worse, because the plate opens 0.9 s before
   anything is there to type. Fix (in T42): the plate opens on the lock's close, not before it. The
   order goes flight, beat, lock, plate with the first letter, rest of the name, lines. In demo
   timing the flight gives up the 0.9 s.

4. **Two bracket languages in the same red** (T29). Radial frame 7 and mosaic frame 6 show red
   corner brackets in two places: the plate's two corners top left and bottom right, and the lock's
   four corners on the node. Both come in the same red and the same stroke but play different roles.
   The bottom-right plate corner floats about 120 px away from the plate's last line (radial frame 7,
   at x≈700 y≈600 in 2000-px sheet coordinates). It reads as a third bracket pointing at nothing.
   Fix: the plate's corners stay neutral (text-3) and hug the text box, or the plate drops them. Hue
   on a bracket means "target", and only the lock gets it.

5. **The type system has one voice too many.** Names are condensed caps, keys and facts are mono
   caps with wide tracking, and the map's sub-labels are mono lowercase. Those three are a
   consistent system. Then the trouble text comes in two cases. On the plate it is condensed
   lowercase (`builder-c no contact for 25s`). On the fleet line it is condensed caps
   (`NO CONTACT FOR 29S`, where the caps turn the unit into `29S`). The same sentence is set two
   ways in one frame. Fix: one rule. Names and site/node words in caps. Prose and values in
   sentence case on both the plate and the fleet line (`HV1 · VM-C · BUILDER-C` over `no contact
   for 30 s`). Units stay lowercase with a thin space.

6. **The caption outlives the shot** (radial frame 5, 22.8 s). The HOME plate stands fully typed,
   every line in, while the camera shows the whole constellation at overview scale. The words point
   at a subject the frame is not showing. Fix: the plate is only fully in while the lock is shut.
   It fades on the first frame of the flight away, before the zoom changes (research Q1: caption
   out first, then the camera leaves).

7. **Map text runs under the frame type in every zoomed frame** (T51). Radial frame 7: REGISTRY,
   TEMPLATE and SCRATCH are printed through `NO CONTACT FOR 16S`, and SCRATCH runs into
   `115 NODES`. Radial frame 10: `02:44CLOUD`. Orbits frame 12: HV1's nodes stand under the clock.
   The frame type is the instrument's bezel, and the picture must not run through the bezel. T51's
   backing plus label hiding fixes it.

## radial

1. **Site names have left their sites.** In the still, HOME, REMOTE, CLOUD and HV2 stand in a ring
   around the core, set inward (T11's "facing the core"). They form one word cloud in the middle of
   the picture. `CLOUD HV2` reads as one phrase, and REMOTE sits nearer HOME's lights than its own
   node. At 35 px these are the biggest words on the map, and they make the composition's centre a
   title block that labels nothing. Fix: set a site name tangent to its node on the outside of the
   site ring, at the bearing of its own subtree's centre. That puts it on the far side from the core,
   between the site and its rooms. Keep T15's pin.

2. **The picture is still top-heavy, with desk chrome at the top** (T17, T18, T16). In the still, the
   lane fan reaches y≈30 (FEAT-SEARCH, FIX-LOGIN, ACME-BILLING `1 of 6`), and the ring legends
   `LANE · RUN`, `BUILDER · SVC · PKG · RUN`, `ROOM · REPO` and `SITE · RUN` are still drawn. The
   bearing numerals (`270`, `090`) are the ones left almost invisible. That is the reverse of what
   r9 asked: keep the dial as the instrument's mark, drop the legends.

3. **The arrival frame is tight on a hub with a hairball** (T19). In frame 7, HV1 at zoom 2.3 is a
   red-locked node with about fifteen spokes fanning to the upper right. The shot's subject is the
   fan, not the site. Fix in T19: the stubs at the overview, and the fan drawn as the reveal *after*
   the lock shuts (a 300 ms draw-on from the hub outward). The arrival then has a resolve.

4. **The overview spends only about 15 % of the strip on the whole fleet.** Frames 1-3 and 6-12 are
   all inside or near a site. The overview proper shows up once (frame 5), and even there a caption
   covers it. In demo speed that is by design. At normal speed (20 s overview, 25 s hold) it is
   fine. No change needed. I record it so nobody tunes the composition from demo frames alone.

## orbits

1. **The hold is a wide shot, so the arrival has no payoff.** Frames 3, 4, 5, 9 and 10: the visited
   planet fills about a quarter of the frame height. Its moon labels are micro-text (around 8 px on
   the sheet), and the rest is black. The camera flew in and landed at a distance where nothing new
   can be read. This is the brief's "spelled out as it zooms in" with the zoom missing. Fix: the
   orbits zoom per leg comes from the planet's own bounds (`bounds` is already per layout). Fit the
   planet plus its moons' labels to about 60 % of the frame height, inside the safe area, clear of
   the plate.

2. **Moon names drift free of their moons** (T45). In the still, BACKUP stands about 120 px above
   anything, and GPU-BOX, SCRATCH, REGISTRY and FRONT-DOOR float in open space. HV1's west side is a
   column of names (BUILDER-C, VM-C, CI, ACME-BILLING, CI-RETRY, BUILDER-B, VM-B, VM-A, FIX-LOGIN,
   FEAT-SEARCH) with their dots far to the right. The overview composition is the best of the four:
   five planets, a sun, real negative space. The loose labels spoil it, because they read as
   "detail" that belongs to nothing.

3. **The sun is a void with a satellite.** The centre of the frame, which is the strongest spot in
   any composition, holds a dot, two thin rings and a small circle on top (`__repos`/run). It is the
   one place a stranger looks first, and it says nothing. Fix: put the fleet's identity there. The
   tag's title can sit in small mono caps under the sun, and the sun's ring can take the fleet's
   worst status colour while anything is crit. That works as the "reactor core" read, and it ties
   the frame together without a new element.

## islands

1. **The cleanest type on the night, and the flattest picture.** Every island is a title plus a grid
   of names under dots, all at one weight and one step. The ellipses are 1 px lines that almost
   disappear. It reads as a well-set atlas page, not as an instrument. Nothing has depth, and
   nothing says "live" except the comets. In the still, the one island in trouble (REMOTE, attention)
   looks like the calm ones. Its two ▲ marks are the only cue. Fix: steal mosaic's toned region (see
   across). The visited island's coastline thickens to the line-strong token, and an island with
   trouble gets its coastline in the status colour at 0.48 and a faint fill.

2. **An orphan circle in the clock's column.** In the still at x≈140 y≈848, and in frames 1, 2 and
   6, the core (hub) floats alone as two unlabelled rings, left of REMOTE and above the clock. Every
   other thing on the page belongs to a titled island, and this does not. Fix: give the hub a small
   titled island of its own (its title the tag's name), or drop it from the overview on islands and
   mosaic, since the tag already names it.

3. **The lock is on the site, the trouble is elsewhere** (T25). In frame 7 the red lock frames HV1's
   hub in the middle of the row. The crit (BUILDER-C/VM-C) is at the left end, half under the plate
   (`HV1` is cut at `VM-A`, faded behind the plate). The lock is the shot's aim, and it aims at the
   wrong thing.

4. **Lane names stack over HV1's builders** (T43, T55). In frame 7, ACME-DOCS, FEAT-SEARCH,
   SEARCH API, DOCS-REFRESH, SEARCH UI and FIX-LOGIN sit in three overlapping rows above BA, with
   ▲▲▲ shoulder to shoulder. It is the one noisy spot in an otherwise calm variant.

## mosaic

1. **Amber outshouts red** (T56, T16). At the overview (frame 5, 25.4 s) the two crit tiles (VM-C,
   BUILDER-C) are a dark red fill, and the attention tiles (BUILDER-A, BUILDER-B, OFFICE-PRINTER,
   API-PROD) are a brighter amber fill of the same area. The eye lands on amber first. That breaks
   north star 1 in the variant that otherwise states trouble best. Fix: crit fill at a higher alpha
   than warn or attention, so that their *lightness* ranks crit > attention > warn. Attention tiles
   keep only their outline plus the mark, no fill. Then there are at most two filled tiles on
   screen, and both are red.

2. **Labels leave their tiles** (T44). In the still, KITCHEN-LIGHT falls out of its hex onto the
   fleet line's top edge, LIVING-LIGHT and DESK-LIGHT run together into one word, OBJECT-STORE is
   printed over a mark's ring, and SCRATCH sits above its dot while TEMPLATE sits below its own. A
   honeycomb promises a grid. Type that ignores the grid breaks the promise at first glance.

3. **The hold frame leaves trouble tiles cut at the edge** (T44). In frame 7 (35.0 s), on the
   REMOTE hold, two amber tiles are cut by the top edge, and the plate is not up (T42). Half a
   filled tile at the frame's edge pulls the eye out of the shot.

4. **Sub-labels pile up inside tiles at zoom.** In frame 6, RUNNER-1, RUNNER-2, RUNNER-3,
   `pushes images` (an edge label, T27) and ACME-BILLING with its prose line share one tile and its
   neighbour. FEAT-SEARCH, SEARCH API, FIX-LOGIN and DOCS-REFRESH overprint BUILDER-A's tile. At
   zoom, a tile should hold one name and one line. Fix: at the hold, a tile shows its node's name and
   one detail line. Lanes and runs inside a builder's tile become a count chip (`3 lanes ▲2`) until
   touch opens it (night 2).

## Across the variants: what to steal

- **From mosaic: the toned region.** A trouble tile tinted in its status colour is the only device
  on the night that a viewer reads from three metres without words. Islands (coastline) and orbits
  (orbit ring) can use the same move on their own shapes. Radial could tone the site's sector.
- **From mosaic: the title plate `◉ HV1`.** Mark, then name, flush left, one gap. It is the one site
  title that looks typeset rather than placed. Islands' titles would gain a mark. Radial's site
  names, moved outward (radial #1), could take the same mark-then-name form.
- **From orbits: the negative space.** It is the only overview where the black is composed (five
  bodies, even gaps, a centre). The others fill the frame edge to edge.
- **From islands: the label grid.** Name centred under its dot, one step, one baseline per row. It
  is the only variant where no two names collide at the overview. Mosaic's names inside tiles and
  orbits' moon names should follow the same rule: under the dot, centred.
- **From radial: the turn.** The slow rotation is the one thing that makes the overview breathe
  while nothing else happens. The three no-turn layouts are still between legs. A very slow drift
  of the ground dots, or a light parallax on the glow layer (not the nodes), would give them a
  breath without moving the type (T28's rule: the ground must not slide under a moving camera, so
  this is for the overview's still state only).

## Rubric

score radial overview 4
score radial legibility 4
score radial status 6
score radial touch 2
score radial wow 6
score radial calm 4
score radial performance 4
score orbits overview 6
score orbits legibility 4
score orbits status 5
score orbits touch 2
score orbits wow 6
score orbits calm 7
score orbits performance 5
score islands overview 7
score islands legibility 6
score islands status 5
score islands touch 2
score islands wow 5
score islands calm 6
score islands performance 5
score mosaic overview 7
score mosaic legibility 5
score mosaic status 7
score mosaic touch 3
score mosaic wow 7
score mosaic calm 5
score mosaic performance 4

Touch: nothing in the films shows it (night 2). The scores are my guess from target sizes. Mosaic
gets one point more for its tile-sized targets. Performance: SwiftShader fps is not the page's. It
is a guess from the prior rounds' script times (8-12 ms per frame at 4x) and the amount drawn per
frame.

## console.txt

Every `console.txt` from this round's shots is empty (0 lines). The film tool reports
`0 console/page errors` for each:
- `r41-radial/console.txt`: (empty)
- `r41-orbits/console.txt`: (empty)
- `r41-islands/console.txt`: (empty)
- `r41-mosaic/console.txt`: (empty)
- `r41-still-radial/console.txt`: (empty)
- `r41-still-orbits/console.txt`: (empty)
- `r41-still-islands/console.txt`: (empty)
- `r41-still-mosaic/console.txt`: (empty)
