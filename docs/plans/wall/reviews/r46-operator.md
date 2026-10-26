# Review r46: the operator, three metres away

Round 46, night 1. Persona: operator. I glance at it from across the room. Is anything wrong, what is
it, and where?

What I judged, all `&demo=1`, CPU 4x, through the SwiftShader wrapper (PROGRESS filming note):
- radial: `$RUN_DIR/shots/r44-radial/` (shot 03:19 UTC, after a46934a, the last commit under
  `public/js/wall`). Still: `r44-still/`.
- orbits, islands, mosaic: shot again this round, `$RUN_DIR/shots/r46-{orbits,islands,mosaic}/` and
  `r46-still-*`. Their r41 films came before T16/T17, which changed the shared `glow.js`, `lock.js`,
  `tour.js`, `main.js` and the Map's `index.js`/`render.js`.
I read the frames at 1:1 (2736x1824, the 12.3" tablet at 2x, about 10.5 device px per mm).
Yardstick from r14 (Q3): a cap height of about 184 device px reads at 3 m, and about 95 px at 1.5 m.

Sizes I measured, the same in all four: the fleet line's caps are about 55-68 px (5-6.5 mm, readable
at about 1 m). Site names at the overview are 48-55 px (about 0.9 m). The caption's site name is
about 89 px (1.4 m). The caption's trouble line is about 30 px (0.5 m). **From 3 m no text is
readable in any variant.** At 3 m I get colour and shape, and only that. The findings below are
mostly about whether colour and position alone tell me what is wrong and where.

## Shared (all four)

1. **Still nothing reads at 3 m, and the fleet line is the biggest text.** Every frame of all four films.
   The fleet line (`■ HV2 · STORAGE · POOL 97% FULL`) is the only text that answers "what". At about
   6 mm caps it reads from 1 m. I have to cross the room. Why it matters: north star 1 says "readable
   without walking up". Fix (T21, still open): while anything is crit or attention, set the fleet line
   at the 3 m step. Show only the problem word and the site (`HV2 STORAGE FULL`, about 180 px caps,
   two lines at most). Put the long `why` under it at today's size. Drop the `5 sites · 115 nodes`
   facts while there is trouble.
2. **The tour waits through calm sites with the crit on screen.** Islands frames 9-11 (38-46 s) and
   mosaic frames 9-10 (41-46 s): the fleet line turns red (`HV1 · VM-C … NO CONTACT`), and the camera
   still holds on CLOUD, REMOTE, then HOME. At normal timing that is up to 3 x 27 s, plus the 20 s
   overview, before it gets to HV1. Radial frames 8-9 have the same: HOME, calm, while HV1 has a crit.
   Why it matters: the camera is the second loudest thing on screen, and it points at calm sites
   while a site is in trouble. Fix (r14 #3, still under For the owner): when a site at warn or worse
   is not yet visited, or was visited before it went worse, it goes next. Cut the hold of the calm
   site the camera is on to about 5 s. Hold calm sites for about 8 s while anything is at warn or
   worse.
3. **Dead plates.** Radial frames 2, 4 and 12. Orbits frame 7. Mosaic frame 12. The plate shows a
   kicker (`TARGET 02 / 05 · SITE`) and a white block cursor, with no name and no status. A glance at
   that moment tells me less than the overview would. Fix (T23/T42): put the trouble word in its
   status colour on the plate at once, untyped, as soon as the leg starts. Type only the name. Show no
   plate at all while the camera is still more than half a flight away.
4. **The caption and the fleet line disagree, and both count seconds.** Radial frame 6: the caption
   says `no contact for 20s` and the fleet line says `NO CONTACT FOR 23S`. Radial frames 5-9 step
   17s, 23s, 28s, 33s, 37s. Why it matters: a number that changes every glance reads as news when
   nothing has changed. Fix (T52, T57): one source and one clock. Round to minutes after the first
   minute (`no contact · 1 m`), and the caption takes its text from the same `worstLine`.
5. **In zoomed frames the Map runs under the frame's text.** Radial frame 6: TEMPLATE, SCRATCH and
   `base image` cross the fleet line. Orbits frame 7: HV1's label and lanes sit inside the clock
   (`03:26HV1`). Mosaic frame 6: LIVING-LIGHT and KITCHEN-LIGHT run through `PAPER JAM`. Fix (T51):
   a solid dark band behind the bottom 18 % (about 0.85 alpha), or dim Map labels whose box falls
   inside the clock or fleet-line rectangles.
6. **The lock frames the site, not the thing that is broken.** Radial frame 6: a red lock sits on HV1.
   The crit is VM-C, about 600 px higher, and the caption names VM-C. From 3 m the lock says "HV1"
   and the red halo says "up there". Fix (T25): on a trouble site, lock the worst node in the site.

## radial

1. **Site names stand in a heap in the middle, away from their sites.** Frame 1 and frame 10 (the
   overview). HOME, REMOTE, CLOUD and HV2 form a block of four words around the core. REMOTE sits
   next to the core's dot, and HOME sits above REMOTE. From 3 m the big words are the only text with
   any shape, and they point at the centre, not at the red. Why it matters: "where" is the site, and
   the site name is nowhere near the problem. Fix: set the site name outside its site's arc, at the
   rim where its rooms fan out (the way orbits puts it under the planet). Or, at the overview, label
   only the sites in trouble, next to their trouble.
2. **Now the crit is the loudest thing on screen.** Frame 10: the red halo on STORAGE and the red ring
   on HV2 are the first things I see. They beat the yellow at the top. That is T16 working. But frame 5
   (24.3 s) shows two halos (VM-C at the top edge and STORAGE at the right edge), both at the frame's
   rim, where the vignette darkens them. Fix: let the vignette stop short of glows, or draw the halos
   above it.
3. **The top of the circle is a hairball where the trouble lives.** Frame 1: `BUILDE` is cut off, and
   BUILDER-C and VM-C are overprinted as `BUILDER-CM-C`, next to the yellow ▲ lanes. That is exactly
   where the attention is. Fix (T15/T19): at the overview, fold a builder's lanes into one mark with a
   count (`▲3`), and name only the builder.
4. **Desk chrome is still at the overview.** Frames 1 and 10: ring legends (`LANE · RUN`,
   `BUILDER · SVC · PKG · RUN`, `ROOM · REPO`, `SITE · RUN`) and the bearing dial (`000`, `090`,
   `180`, `270`). From 3 m they are grey noise next to the attention marks. Fix: T18.
5. **The first frame of the film is off-centre.** In the sheet, frame 1 (3.3 s) shows the circle
   smaller and up to the left of where frame 10 puts it. A glance right after a reload sees a
   lopsided screen. Fix: fit before the first paint, or fade in after the first fit.

## orbits

1. **The crit is the size of a calm moon.** Overview frame 6 and the still: STORAGE's red ■ is about
   20 px, with no halo. VM-C and BUILDER-A in the still are about the same size. HV1's yellow ▲
   cluster at the left edge weighs as much as they do. From 3 m I see "a little red, a little yellow,
   somewhere". Why it matters: radial now has T16's halo and orbits does not. Fix: give orbits T16's
   crit halo through the same glow-layer path (`variants.js`). It is radial-only today.
2. **A flight puts the next site under the clock.** Frame 7 (30.7 s, TARGET 02): HV1's lanes and
   label sit inside the clock's box, the lane names overprint each other (FIX-LOGIN, ACME-DOCS,
   DOCS-REFRESH, BUILDER-A), and the plate is empty. Fix: shared #3 and #5. Also start the caption
   only once the target is inside the safe area.
3. **Moon names float far from their moons.** Still: BACKUP, MONITOR, DNS, REGISTRY and TEMPLATE
   stand 80-120 px off their dots. At 3 m I cannot tell which name belongs to the red ■ (STORAGE does
   sit next to its own). Fix (T45): pin the name to its moon at a fixed offset, outward.
4. **The hold is a wide shot.** Frames 3, 4 and 9: the visited planet fills a third of the screen,
   with its names at about 15 px. Arriving adds the caption and nothing I can read from far away.
   Fix (T59): hold closer, or set the moons' names larger on arrival.

## islands

1. **Crit marks carry only a faint red rim.** Still: STORAGE, BUILDER-A and BUILDER-C are red ■ in a
   ring about 40 px across, each with a faint red halo. The site title (HV1, 55 px white) is louder
   than any of them. HV1 has three crits and four ▲ in one row, and at 3 m it reads as "HV1 is
   busy", not "HV1 is broken". Fix: T16's halo here too. Tint the coastline of an island that holds
   a crit in the status colour (a 1.5 px rim, as mosaic does with a toned tile).
2. **The overview is the easiest to read from a distance.** Still: five titles, each above its own
   coastline. The red is inside the right island. "Where" is the one thing islands answers from 3 m
   better than the others. What it lacks is #1 (loudness). Keep that order.
3. **The hub is an orphan in the clock's column.** Still, x≈140 y≈848, and frames 1, 6 and 12: two
   circles that look like a stray node. At a glance it reads as "something is loose on the left".
   Fix (T60): put the hub with the islands, or leave it out at the overview.
4. **The lanes' ▲ marks pack shoulder to shoulder.** Still: on HV1's top row, BA ▲▲◇, BB ▲◇▲ and
   BC ◇ touch each other. From 3 m they are one yellow smudge, not three lanes. Fix: T55.

## mosaic

1. **A filled tile is the loudest status mark on the night.** Frame 1 (HV2 STORAGE, red fill), frame
   11 (VM-C and BUILDER-C red, BUILDER-A and BUILDER-B amber) and the still (BUILDER-A, BUILDER-B,
   OFFICE-PRINTER amber). A whole hexagon in the colour reads from 3 m as "this place, this
   colour". It is the only variant where I could point at the screen from the coffee machine. But
   amber and red tiles have the same fill weight. In frame 11 the two amber tiles are lower and
   nearer the centre, so they pull the eye as much as the two red ones. Fix (T56, T61): fill red at
   about twice amber's alpha. Give a red tile a thicker edge, or T16's halo. Leave amber as an edge
   only, with no fill.
2. **The "overview" in demo is cropped.** Frame 6 (27.2 s): EDGE-1, OBJECT-STORE and ACME are cut at
   the right edge. The fleet line covers HOME's lights. The still shows the whole fleet fine, so this
   is the camera mid-flight, or a fit that leaves the safe area (T17 is radial only). Fix: give mosaic
   T17's safe-area fit.
3. **Names leave their tiles.** Still: KITCHEN-LIGHT under its tile, toward the fleet line;
   OBJECT-STORE on its mark; LIVING-LIGHT and DESK-LIGHT run together. At 3 m that does not matter,
   but at 1 m it makes me read the wrong tile's name. Fix: T44.
4. **Inside a site, the tiles' sub-labels make a grey haze.** Frame 11: lanes' sub-lines (`waiting on
   a permission prompt`, …) pile up across BUILDER-A and BUILDER-B. Fix: name only the worst lane
   at site zoom. The rest become a count.

## Across the variants: what to steal

- From mosaic: **status fills the place, not only the mark.** A toned region (tile, coastline, or a
  wedge of the ring) is the only cue that reads from 3 m. Islands can tone the coastline. Radial can
  tone a site's sector behind its fan. Orbits can tone the planet's orbit ring.
- From islands: **the site name sits on its own cluster**, so "where" comes free with the colour.
  Radial needs it most.
- From radial: **T16's halo**, crit the brightest pixel on screen. The other three do not have it yet.
- From orbits: **using the full width**. In frame 6 the five systems spread edge to edge, with the
  bottom band clear for the clock and fleet line.
- None of the four solves the tour's dwell (shared #2) or the fleet line's size (shared #1). Those
  two are what I would fix first, whatever the owner picks.

## Rubric

score radial overview 5
score radial legibility 3
score radial status 6
score radial touch 2
score radial wow 6
score radial calm 4
score radial performance 4
score orbits overview 6
score orbits legibility 4
score orbits status 4
score orbits touch 2
score orbits wow 5
score orbits calm 6
score orbits performance 5
score islands overview 7
score islands legibility 5
score islands status 5
score islands touch 2
score islands wow 5
score islands calm 6
score islands performance 5
score mosaic overview 7
score mosaic legibility 4
score mosaic status 7
score mosaic touch 3
score mosaic wow 6
score mosaic calm 5
score mosaic performance 4

Notes:
- Legibility is about 3 m, and nothing reads there in any variant. The spread comes from the 1 m
  view and how cleanly each name sits on its node.
- Radial's status went up from my r14 score (5) to 6, because the crit halo is now the loudest thing
  on screen. Orbits dropped to 4: its crit is the size of a calm moon.
- Touch is a guess: there is no input yet (night 2). Mosaic's tiles are about 172 device px
  (16 mm), the only targets that are already finger-sized.
- Performance is a guess. fps in the films (radial 2.3, orbits 4.0, islands 3.7, mosaic 2.9) and the
  worst gaps (1.2-2.2 s) measure SwiftShader plus screenshots, not the page (PROGRESS filming note).
  I did not time scripts this round.

## console.txt

- `$RUN_DIR/shots/r44-radial/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r44-still/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r46-orbits/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r46-still-orbits/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r46-islands/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r46-still-islands/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r46-mosaic/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r46-still-mosaic/console.txt`: empty (0 lines).
