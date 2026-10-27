# Review r50: the skeptic

Round 50, night 1. Persona: skeptic. For each element: what does it tell someone 3 m away in 3 s?
If the answer is nothing, remove it.

What I judged: T18 and T19 (d36ed56, 0a75c9b) changed the shared `public/js/views/map/index.js`
and `render.js` after every existing film. So I shot all four again this round, `&demo=1`, CPU 4x,
through the SwiftShader wrapper (PROGRESS filming note):
`$RUN_DIR/shots/r50-{radial,orbits,islands,mosaic}/` (sheet and frames 1-12) and
`r50-still-*`. I read every sheet, and these frames at 1:1: radial 5 and 10, orbits 1, islands 6,
mosaic 1 and 5. Load average during the shoot was 35-37, so the fps figures are noise (see Scores).

Since r20, my last review, these are gone and nobody misses them: ring legends, builder lamps
(radial only), calm gauges (radial only), sublabels at the overview (radial), and branches at the
overview (radial, now stubs). What is left is below. Most of it is still in the three other
variants, because T18 and T19 went into radial only.

## Shared (all four)

1. **A quarter of the tour is a dead plate.** Radial frames 3, 6 and 11. Orbits frames 2, 8 and 12.
   Mosaic frames 3 and 4. Islands is the only clean one. That is 3 of 12 samples in radial and
   orbits. Each one is a dark box about 600 px tall holding `TARGET 0n / 05 · SITE` and a white
   block, with no name and no status. It covers the top-left third and tells nothing. It is the
   biggest no-information element on screen, and it shows most often. Fix (T23, still open): no
   plate until the name's first letter lands, and the status word in its colour from the first
   frame of the plate.

2. **The caption repeats the fleet line, and the two disagree.** Radial frame 10: the plate says
   `■ VM-C builder-c no contact for 16s`, and the fleet line under it says `HV1 · VM-C · BUILDER-C
   NO CONTACT FOR 19S`. Both are in the same red, in one frame. The plate's `STATUS crit · 6 of 41
   in trouble` says `crit` a third time. Why it matters: three copies of one problem, with two
   clocks, is 3x the reading for 1x the information. Fix: when the toured site holds the fleet's
   worst problem, the plate drops its trouble line and status row, and shows only what the fleet
   line does not: `+5 more here`. Otherwise keep T57 (one clock) and T52 (minutes, not seconds).

3. **The calm caption is still a spec sheet.** Radial frames 8 and 12, orbits 4, 5, 9 and 10,
   islands 3, 4 and 5, mosaic 2, 7, 9 and 10. `CPU 12% MEM 33%`, `WHERE office`, `HOLDS 6 rooms`,
   `HARDWARE 24-core · 192 GB · 1 GPU`. None of it changes. None of it needs anyone. `HOLDS 6
   rooms` counts what the camera shows right beside the plate. This is r20 #6, with the owner. I
   raise it again because it is now the largest share of the tour's text: calm sites are 3 of 5
   stops. Fix: on a calm site the plate is the name plus `ok · all 8 calm`. Hardware and where go to
   night 2's touch sheet.

4. **`5 SITES · 115 NODES · N WORKING` moves without meaning.** Every frame of every film.
   `5 sites` and `115 nodes` never change. `N WORKING` ticks 6, 7, 8 and back between frames as
   lanes start and stop (radial frames 1-5, mosaic frames 1-12). It is a number that changes at
   every glance and needs nobody, so it breaks "grey unless something needs you". Fix: remove the
   whole ambient line while anything is at warn or worse. When calm, show `all calm · 115 nodes`
   and drop `working`.

5. **`· SITE` in the kicker never changes. Remove it.** `TARGET 01 / 05 · SITE` in every caption
   of every film. The tour only visits sites, so the word is constant. `01 / 05` does carry
   something (where in the cycle we are). Keep that.

6. **The clock is the second-biggest text and carries no fleet state.** It is 6.9 vmin, the same
   size as the caption's name, bottom left in every frame. On a wall the time is a fair ambient
   fact, but at this size it competes with the fleet line, which sits in the same band. Fix: set it
   at the fleet line's facts size (about half) or at the tag's size. If the owner wants a wall
   clock, it must be quieter than any trouble text. Today it is louder than the caption's trouble
   line (radial frame 10: the clock's caps are about 2.5x the caption's `builder-c` line).

7. **Map labels still run through the frame's text.** Radial frame 10: REGISTRY, TEMPLATE and
   SCRATCH through `NO CONTACT FOR 19S`, and `waiting for a job` through the `LANEBOARD` tag. Mosaic
   frame 5: KITCHEN-LIGHT sits on the fleet line's ▲. This is T51 (open). It is in all four.

8. **The dot grid is still there.** It shows in every frame, and it is static while the camera
   flies (radial frames 6-7, orbits 5-8). It carries nothing. This is r20 #3 / T28, open. Fix: drop
   `--tex-dots` on the Wall. The vignette is enough ground.

## radial

1. **Edge labels and sublabels are back at every zoom.** Frame 10 (HV1 hold): `sensor data`,
   `deploys`, `publishes`, `clones`, `pushes images`, `dumps`, `offsite copy`. These are topology
   verbs that never change. Then `databases` under DB, `reverse proxy` under PROXY, `resolver`
   under DNS, `git mirror` under GIT-MIRROR, `CI runners` under CI, `base image` under TEMPLATE:
   each one repeats its name in lower case. About 20 of the roughly 50 text items in frame 10 say
   nothing new. The sublabels that hold a number earn their place: `cache 94%`, `9 GB/day`,
   `renews in 41d`, `61 leases`. Fix: a Map option, default off, that drops link labels and any
   sublabel without a digit. Radial sets it. r20 #1 and #2 have been with the owner since round 20,
   and nothing has happened.

2. **The bearing dial (`000 / 090 / 180 / 270`) survived T18.** Frame 5. No node is at a bearing.
   T18 kept it on purpose ("dial and rings stay"). I say remove. It is four numbers on screen that
   mean nothing, styled to look like data.

3. **The lane cluster at the top is the densest text on screen, and it tells the least.** Frame 5:
   FIX-LOGIN, BUILDER-B (cut by the top), BUILDER-A, DEPS-BUMP, ACME-BILLING `1 of 6`, CI-RETRY,
   FEAT-SEARCH, BUILDER-C, CI, the `+2` box, and the `BB`/`BC` monograms. They overprint each
   other in a 450x150 px patch. The only state in it is two yellow ▲ about 15 px wide. The
   monograms repeat the builder names 40 px away. Fix: at the overview, draw the builders as one
   labelled node, `BUILDERS`, with a ▲ count. Unfold the lanes only when the camera holds on HV1.
   Drop the monograms on the Wall.

4. **The printer ring is the loudest calm thing at the overview.** Frame 5: PRINTER-3D's white ring
   is about 50 px across, which is bigger than HV1's yellow ring and as big as the crit's ring. A
   print job at 28 % outshouts an attention. This is T46 (open). The rule I would add there: the
   job ring at the overview is never larger than the node's own dot plus 4 px.

5. **One crit draws two red rings.** Frame 5: STORAGE has a red glow and ring, and HV2's site node
   has a red ■ ring 200 px away. The site echo helps answer "where" only if the site name is beside
   it. Here HV2's name is beside it, so the echo is defensible. Keep it, but make it smaller than
   the real node's mark. Today the two are the same size.

## orbits

1. **The centre of the screen is a decorative hub.** Frame 1: an unlabelled white dot inside two
   rings with a small satellite, dead centre, about 170 px across. It is the core node. It has no
   name, no state and no job. It takes the spot the eye lands on first. Fix: hide the core on the
   Wall (or draw it as a 4 px dot), and let the sites spread into the middle.

2. **Every calm node wears a gauge ring.** Frame 1: about 50 double rings on calm nodes, all grey,
   all saying "fine". Radial dropped these in T19 (`gauges: 'trouble'`). Fix: set the same option in
   `orbits.js`. It is one line.

3. **Monograms, the `+2` box and lamp pips are still on.** Frame 1, HV1: `BB`, `BC`, `BA +2`, and
   the three-colour pips under BUILDER-A/B/C. At 3 m the pips are specks. Fix: set `lamps: false`,
   and drop the monograms as in radial #3.

4. **One problem, two marks.** Frame 1: STORAGE's red ■ and HV2's red ■ ring, 90 px apart. HV1's
   yellow ▲ hub repeats its lanes' ▲s. In orbits the site name sits under the planet, so the echo
   adds nothing. Fix: the site node shows trouble only as a thin coloured ring, not the shape.

5. **ACME-BILLING `1 of 6` is flung to the left edge.** Frame 1 (x about 80): a lane label 300 px
   from its node, with progress nobody needs from 3 m. This is T45 (loose label clouds). The skeptic
   fix: progress text is not on the Wall at the overview.

## islands

1. **Every calm node has a gauge ring and a `•••` tail.** Frame 6: about 50 grey double rings, and
   about 25 dot tails (folded services). The rings say "fine" 50 times. The tails say "there is
   more here" with no count. Fix: `gauges: 'trouble'` as in radial. Drop the tails at the overview,
   or turn them into a count on the trouble ones only.

2. **The unlabelled hub floats on the left.** Frame 6 (x about 150, y about 860): a white dot in
   two rings, with no name and no island. Same as orbits #1 and T60. Remove it.

3. **The island outlines carry the grouping, so the site's own node is redundant.** Frame 6: each
   island has a big name (HV1, REMOTE, …), an ellipse, and a site node (REMOTE's yellow ▲ at
   460,893) that repeats the office-printer's ▲ 100 px away. Fix: drop the site node at the
   overview. The name and the ellipse are the site. Trouble shows on the node that has it, and as a
   tint on the ellipse.

4. **The caption plate sits on HV1's lanes.** Frame 2: FEAT-SEARCH's `waiting on a permission
   prompt` shows through the plate, behind `STATUS attention`. This is T30. It is worse here
   because the island is wider than the free two-thirds.

## mosaic

1. **About 60 empty hex outlines.** Frame 5: every tile has an outline, and most hold one calm
   node. The outlines repeat what position already shows (the cluster), and they double the line
   count on screen. The filled tiles (BUILDER-A, BUILDER-B, OFFICE-PRINTER, API-PROD in yellow)
   carry the real message, and they would read better on a bare ground. Fix: draw only the outline
   of each site's region (one path per site), and fill the tiles in trouble. No per-tile outline on
   calm tiles.

2. **The site tiles echo their children's trouble with a shape.** Frame 5: HV1, CLOUD and REMOTE
   each carry a yellow ▲ ring next to the name, while the yellow tile 100-200 px away already says
   it. The fleet has three attention items, and the screen shows six ▲ marks plus four yellow
   tiles. Fix: the site tile shows no shape; the filled child tile is the signal.

3. **Mosaic still carries the full desk annotation when zoomed.** Frame 1 (HV1 hold): monograms
   `BA`/`BB`/`BC`, lamp pips, `+2`, sublabels `base image`, `images`, `git mirror`, `databases`,
   `resolver`, `CI runners`, edge labels `clones`, `deploys`, `pushes images`, and two cut ribbons
   (`Rewrite the acme-api setup guide and …`, `Move acme-api billing to the new invo…`). Text cut by
   an ellipsis cannot be read at any distance. Fix: the same options as radial (`lamps: false`,
   `gauges: 'trouble'`), plus the link-label and sublabel option from radial #1. Hide the ribbons.

4. **Gauges and `•••` on every calm tile.** Frame 5, as islands #1. Same one-line fix.

5. **The hub tile, bottom left, says nothing.** Frame 5 (x about 210, y about 880): a hex with an
   unlabelled ringed dot. Same as orbits #1. This is T60.

## Across the variants (what to steal)

- **Radial's T18/T19 options belong in all four.** `legends: false`, `lamps: false`,
  `gauges: 'trouble'`, and branch stubs at the overview. They removed the most noise of anything
  tonight, and they are options, so the other three get them by setting flags. Orbits, islands and
  mosaic still pay the full desk-Map clutter. This is the cheapest gain on the board.
- **Islands' overview uses the ellipse plus the big name as the site.** No site node is needed.
  Mosaic and orbits could do the same.
- **Mosaic's filled tile is the clearest "where" in the night.** A yellow hex reads from across
  the room as an area, not a speck. The other three could tint the region (ring sector, orbit,
  island) around trouble instead of adding more marks on the node.
- **Islands has no dead plates.** Whatever its timing does (the plate waits for the name), the other
  three should copy it.

## Scores

Performance: the films ran at load 35-37, so the absolute fps (radial 2, orbits 3.7, islands 4.3,
mosaic 3.1) mean nothing. They were shot back to back, so the order is weak evidence only: radial
is the costliest. Touch: none of the variants takes input yet (night 2), so touch is a guess from
target sizes. Calm is my criterion: how much on screen moves or repeats without meaning.

score radial overview 5
score radial legibility 4
score radial status 6
score radial touch 2
score radial wow 6
score radial calm 5
score radial performance 4
score orbits overview 6
score orbits legibility 4
score orbits status 5
score orbits touch 2
score orbits wow 5
score orbits calm 5
score orbits performance 5
score islands overview 7
score islands legibility 5
score islands status 5
score islands touch 2
score islands wow 5
score islands calm 6
score islands performance 5
score mosaic overview 6
score mosaic legibility 4
score mosaic status 7
score mosaic touch 3
score mosaic wow 6
score mosaic calm 4
score mosaic performance 4

## Console

All eight are empty (0 bytes); film.mjs reported "0 console/page errors" for each:
- `r50-radial/console.txt`: (empty)
- `r50-orbits/console.txt`: (empty)
- `r50-islands/console.txt`: (empty)
- `r50-mosaic/console.txt`: (empty)
- `r50-still-radial/console.txt`: (empty)
- `r50-still-orbits/console.txt`: (empty)
- `r50-still-islands/console.txt`: (empty)
- `r50-still-mosaic/console.txt`: (empty)
