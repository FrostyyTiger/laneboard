# Review round 37: accessibility

Persona: the accessibility reviewer. I judge the Wall for people who did not build it: low vision at
a distance, colour-blind viewers, people who set `prefers-reduced-motion`, people who are troubled by
flashing or fast motion.

Sources:
- Filmstrips made this round at the newest commits: `$RUN_DIR/shots/r37-radial/` (after 6607e27) and
  `r37-orbits/` (after efc5c84). `r32-islands/` and `r32-mosaic/` are still newer than their variants'
  last commits (8b38cfa, c6d1e2d).
- Reduced-motion stills I made with my own CDP script (it emulates `prefers-reduced-motion: reduce`,
  2736x1824, no throttle): `r37-rm-radial/t03…t21.png` plus `report.json`, `r37-rm-mosaic/report.json`.
- Contrast computed from `tokens.css` and `wall.css` (OKLCH to sRGB, WCAG 2 ratio). Gamma-space
  compositing for the alpha cases. Script `$RUN_DIR/r37-tools/contrast.mjs`.
- Distance numbers use Q3's rule (cap height = 16 arc minutes at the read distance, so
  `cap = d x 0.00465`: 14 mm at 3 m) and T15's tablet density (10.5 device px/mm, 2x, 912 CSS px high).

## Numbers first

Contrast against the plain canvas (`--bg-canvas`, oklch 12 %), Wall tokens:

| text / mark | on canvas | on a 0.30 line | on a 0.48 line | on a grey node or label (text-2) |
|---|---|---|---|---|
| text-1 | 18.1 | 7.6 | 4.0 | 1.3 |
| text-2 (wall, 88 %) | 14.1 | 5.9 | 3.1 | 1.0 |
| text-3 (wall, 74 %) | 8.9 | 3.7 | 2.0 | 1.6 |
| crit `--p1` | **5.0** | 2.1 | 1.1 | **2.8** |
| warn `--p2` | 12.5 | 5.2 | 2.8 | 1.1 |
| info `--p3` | 9.1 | 3.8 | 2.0 | 1.6 |

- text-2 faded to alpha 0.5 is 4.0:1, at 0.35 it is 2.5:1, at 0.25 it is 1.8:1 (map labels under the vignette).
- On plain ground everything passes. Contrast is lost wherever **text lies on other text, or on a line or
  a node**. That happens on the Wall in the places that matter most (the fleet line, the clock, the tag, the plate).
- Crit red is the darkest status colour (5.0:1). It is the one that suffers most from overprinting:
  red over a white map label is 2.8:1.

Text size on the tablet, cap height and the distance where it can be read (16'):

| element | font | cap on glass | read at |
|---|---|---|---|
| kicker, keys, facts, tag (1.7vmin) | 15.5 CSS px | ~2.1 mm | ~0.45 m |
| caption lines, trouble line (2.7vmin) | 24.6 CSS px | ~3.3 mm | ~0.7 m |
| fleet line (4.3vmin) | 39 CSS px | ~5.2 mm | ~1.1 m |
| site names on the map (35 px) | 35 CSS px | ~4.8 mm | ~1.0 m |
| caption name, clock (6.9vmin) | 63 CSS px | ~8.4 mm | ~1.8 m |

At 3 m, 14 mm of cap is needed, about 11.5vmin of font. Nothing with words on the tablet reaches that.
A viewer with 6/12 vision needs twice the size again. At 3 m only colour areas and shapes carry
meaning. So the shapes and the filled areas are the accessibility story on the tablet. Words only work
at arm's length.

Flashing: nothing flashes faster than 3 Hz. The block cursor blinks with `lb-flash` at 1 Hz (opacity 1
to 0.35). The flights and cuts are not flashes. No variant has a full-screen luminance change. That passes.

## Shared by all four variants (same `main.js`, `caption.js`, `frame.js`, `wall.css`)

1. **Reduced motion keeps the tour and only cuts. It does not do D5.** In `r37-rm-radial` the camera
   jumps from site to site at zoom ~2.3 every 4 s (demo; every ~45 s at normal speed). No overview
   holds, and the caption does not rotate over the overview. A hard cut that changes the whole screen
   every few seconds is harder on a vestibular or attention-sensitive viewer than a slow flight.
   Each cut also throws away the viewer's spatial memory. The turn does stop (good: map
   `reducedMotion()`). Fix: when `still`, do not call `map.focus`. Stay on `map.fit()` and rotate the
   caption plus a static lock over the site nodes at the overview (D5, night 2). Minimum dwell 10 s
   even with `?demo=1`.
2. **Reduced motion: for half of each leg the site is on screen with no caption and no lock.**
   `report.json`: at t=5, 9, 13, 17, 21 s the camera has cut into the site but `capOpacity` is 0 and the
   lock layer's opacity is 0. They only appear at `arriveMs`, the length of a flight that no longer
   happens. Mosaic agrees (t=5/9: plate 0, lock 0; t=7/11: both 1). The viewer sees an unexplained
   zoomed map for 2.25 s out of every 4. Fix: in `main.js`, when `still`, call `caption.show` and
   `lockOn` with `arriveMs: 0` (rewrite the leg). Or pass `arriveMs: 0` from the tour in still mode.
3. **The fleet line, the clock and the tag are printed over map labels.** This was seen on radial in
   every zoomed frame (`r37-rm-radial/t05`: `HV2 · STORAGE` over SECRETS, `+3 MORE` touching
   BUILD-CACHE, the clock over STATUS-PAGE/MAIL, `LANEBOARD · DEMO-HOST` over REGISTRY). It was also
   seen in orbits frame 3 (map names under the fleet facts) and in the film frames of all variants
   during holds. Red over a white label is 2.8:1, and the two shapes of text cancel each other out
   for a low-vision reader. The vignette (0.82-0.88 of the canvas at the very edge) does not cover
   26vh of content at full zoom. Fix (worst first): (a) give each frame text block a solid backing
   plate, 95 % `--bg-canvas`, padded 1.2vmin, like the caption plate; (b) also hide Map labels whose
   box intersects the frame rectangles (the same mechanism as T24's plate test; the Wall has
   `screenOf`).
4. **The plate is see-through and cuts names in half.** In `r37-rm-radial/t07` you can read `HOME` and
   `REMOTE` as grey ghosts through the plate at 92 %. `RE|MOTE` is cut at the plate's edge: half a word
   in text-1 outside, half a ghost inside. A ghost word next to real words reads as noise for anyone
   with reduced contrast sensitivity. Fix: T24 (plate ≥ 95 %, hide labels under it). I would go to
   100 % opaque: the plate does not need to show the map.
5. **Every word is an arm's-length size. The 3 m read depends on shape and area, so make those bigger.**
   The trouble line in the caption is 2.7vmin (~0.7 m). The fleet line is 4.3vmin (~1.1 m). T20/T21 are
   open, and they are the most important legibility tasks for low vision. Fix: the fleet line's
   trouble word at ≥ 11vmin while anything is crit (about 1.5 lines of the current clock). The clock
   drops to 4.3vmin (it is the least important text and today it is the second biggest). The fleet
   line's shape glyph at the same cap height as the words, not 0.8 em.
6. **The fleet line counts seconds** (`NO CONTACT FOR 20S`, `25S`, `30S`…, radial frames 9-12, all
   variants). Text that changes every tick in the loudest place on screen is hard for screen
   magnifier users and people with attention or reading difficulties. It is also motion with no new
   meaning (north star 2). Fix: in `worstLine`, round the age to a stable step (`no contact · 1 min`,
   `· 5 min`) or say `no contact since 02:10`.
7. **The caption's trouble status is colour on a grey key, with a shape only on the first line.**
   `STATUS crit · 1 of 24 in trouble` is grey text with the word `crit` in it. That is fine: the word
   carries it. But the plate's bracket colour (red/amber) and the lock's colour (red/amber/grey) carry
   status by hue alone. For a deuteranope, red (L 62 %) and the grey brackets (text-2, L 88 %) differ
   mostly in lightness, and amber vs grey hardly at all (amber L 84 %). Fix: remove the plate brackets
   (T29). Give the lock a shape cue on trouble: a small ■ / ▲ at its top-left corner in the status
   colour, the glyph the node already uses.
8. **Attention and warn are the same mark** (▲ amber both, `SHAPE_CODE` tri). This is not a
   colour-blind problem (both hue and shape are equal). But a viewer cannot tell "needs a person" from
   "degraded" anywhere except in the caption text. It is laneboard's existing language, so no new
   shape: keep it, but put the word (`attention` / `warn`) in the fleet line, as the caption does.
9. **The cursor blinks forever when typing stops early.** The cursor-only frames (radial frame 2
   at 10.4 s, orbits frames 2 and 4, mosaic frame 11) show a white block at 1 Hz on an empty plate. 1 Hz
   is safe, but a lone blinking block with no text is the most attention-grabbing thing on a calm
   screen and says nothing. Fix: T42 (the name at once), and r20 #10's `cursorMs: 0` after typing
   (owner).
10. **Glows sit behind labels.** In radial frames 3, 4 and 8, KITCHEN-LIGHT, LIVING-LIGHT and DESK-LIGHT
    are set on their own warm/white glows. At the glow centre (alpha 0.42 of a near-white) the ground
    reaches about L 55 %, and text-2 on it falls to roughly 2.5:1. Fix: the glow layer skips a
    radius of 1.5 node radii plus the label box. Or give labels of glowing nodes a 2 px
    `--bg-canvas` halo stroke (the Map's label halo, if it has one; else an option that defaults off).

## radial

1. **Shared #3 is worst here:** the turn moves map labels under the frame text all the time, so the
   collision under the fleet line and the clock is in nearly every frame (sheet frames 1-8). Fix:
   shared #3. Radial also needs T17's safe area so the layout's lower ring stays above the 26vh band.
2. **The turn under normal motion: every label slides, all day.** There is no reduced-motion problem
   (the turn stops). But for a reader who needs a few seconds to read a word, a turning label is a
   moving target, and with `pinLabels` it still swaps sides past 20°. Fix: owner's call, r28 #2
   (`drift: 0`), which helps legibility and calm for low-vision readers as well as CPU.
3. **The overview is the smallest view of the four** (frame 48.5 s): site names at the overview are about
   13 px on the sheet, all inside the middle square, and room names are dots. A low-vision viewer gets
   only the red and amber marks. Fix: T17 (fit to the drawn nodes). And at the overview, name only
   sites plus nodes in trouble (r14 #4, owner).
4. **Edge labels in mono at ~13 CSS px** (`deploys`, `sensor data`, `offsite copy`, `same NVMe`) sit on
   the lines they label (text-2 over a 0.30 line: 5.9:1 locally, 3.1 where two lines cross). They
   cannot be read past 40 cm and they compete with the node names. Fix: T27 (`edgeLabels: false`).

## orbits

1. **Holds with no caption at all** (frames at 38.2 s and 58.8 s: REMOTE, attention ▲, no plate), and
   cursor-only plates at 8.8 s and 17.8 s. For a viewer who cannot read the map's small labels, the
   plate is the only readable text about the site. Fix: T42.
2. **The planets are small at the overview** (frame at 49.8 s): five systems with labels about 8-9 px
   on the sheet. Only HV2's red marks read at distance. The 35 px site names (T47) help, but room labels
   around the orbit are under 15 px. Fix: at the overview, name only the planet and nodes in trouble.
   Moons stay as dots.
3. **Trouble labels around HV1 stack in a column** (frames at 8.8 s, 34.1 s, 54.5 s: `waiting on a
   permission prompt` repeated three times, small, amber on dark). They are amber on canvas (12.5:1),
   so contrast is fine, but the size (~11 px on the glass) and the stacking make them unreadable.
   Fix: T45, and roll repeated lane trouble into one `3 waiting` label.
4. Frame text clears the map better than radial (no turn, `bounds.cy` keeps the bottom 20 %). Some map
   names still run into the fleet facts during holds (frame at 13.5 s: LAPTOP names under the facts).
   Fix: shared #3.

## islands

1. **The overview text is microscopic** (frame at 15.4 s): room names in islands are about 6-7 px on the
   sheet, ~11 CSS px on the glass, readable at ~30 cm. The island titles (HV1, HV2, CLOUD) are the only
   words and they are ~15 px. Trouble marks are small ▲ in tight rows (HV1's top row). Fix: T48 (type
   steps), and at the overview, labels only for the island title and for trouble.
2. **A hold with no caption** (frame at 56.1 s: HOME/HALLWAY without a plate). Fix: T42.
3. **Lane ▲ marks pack shoulder to shoulder** (frame at 35.3 s: ▲▲▲ around FEAT-SEARCH). At distance
   three triangles 3 px apart merge into one amber blob. The shape, which is the colour-blind cue,
   is lost. Fix: a minimum gap of one mark diameter between trouble marks, or roll them up into the
   builder's mark with a count.
4. Best frame-text clearance of the four. The 12 % top safe area and the layout's bottom margin keep the
   clock and fleet line on plain ground in every frame. Keep it.

## mosaic

1. **A red tile is cut at the screen edge during holds** (frames at 26.6 s and 29.6 s: STORAGE's red hex
   half off the left edge). The filled hex is the strongest accessible status signal on the Wall,
   and cutting it halves it. Fix: T44's "frame the visited site with its troubled tiles whole".
2. **Tile fill alone separates crit from warn at a distance.** Red fill 0.14 vs amber fill 0.14: for
   protan/deutan viewers red's fill reads as a dull brown and amber's as olive. At 3 m the ■ / ▲ inside
   is too small to tell them apart (mark ~10 CSS px). Fix: make the shape show at the tile's own
   scale. Crit tile: a thick 3 px edge on all six sides (as now) plus a solid inner square. Warn tile:
   a dashed or two-of-six-sides edge (a pattern, not a hue). Or set the tile's status mark at ~40 %
   of the tile height.
3. **Cursor-only plate** (frame at 47.6 s). Fix: T42.
4. **Labels leave their tiles** (frame at 5.5 s overview: names spill into neighbours, 12-character names
   nearly touching at the 86 px pitch). Fix: T44.
5. Frame text sits on plain ground in every frame (height-bound layout, bottom margin). Keep it.

## Across the variants: what to steal

- **Mosaic's filled troubled area** is the one status signal that survives distance, low vision and
  colour blindness at once, *if* the fill carries a pattern or shape cue as well as hue (mosaic #2).
  Every variant should paint the troubled node's area (r32's across note), not only a 10 px mark.
- **Islands' and mosaic's clear bottom band**: the layout keeps the clock and fleet line on plain
  ground. Radial and orbits should get the same reserved band (T17), not rely on the vignette.
- **Orbits' no-turn**: labels that stay put are readable labels. Radial's turn is its biggest
  legibility cost for a slow reader.
- **The caption's trouble line** (`■ STORAGE pool 97% full`, shape plus word plus colour) is the right
  pattern. The fleet line should carry the status word the same way (`■ CRIT · HV2 · STORAGE…`).

## Rubric

score radial overview 3
score radial legibility 3
score radial status 5
score radial touch 2
score radial wow 5
score radial calm 3
score radial performance 4
score orbits overview 4
score orbits legibility 4
score orbits status 5
score orbits touch 2
score orbits wow 5
score orbits calm 6
score orbits performance 4
score islands overview 5
score islands legibility 4
score islands status 5
score islands touch 2
score islands wow 5
score islands calm 6
score islands performance 4
score mosaic overview 6
score mosaic legibility 4
score mosaic status 7
score mosaic touch 2
score mosaic wow 6
score mosaic calm 5
score mosaic performance 4

Touch is a guess: no explorer exists yet, and T31 (`touch-action`) is open. Performance is a guess too:
fps 2-6.5 is SwiftShader plus screenshots (filming note in PROGRESS), and there is no tablet measurement.

## console.txt, every line

- `r37-radial/console.txt`: empty (0 lines). perf.json: fps 2, worstGapMs 2605, frames 12, 64.3 s, cpu 4x.
- `r37-orbits/console.txt`: empty (0 lines). perf.json: fps 3.1, worstGapMs 1897, frames 12, 58.8 s, cpu 4x.
- `r32-islands/console.txt`: empty (0 lines). perf.json: fps 6.5, worstGapMs 13524, frames 12, 65.1 s, cpu 4x.
- `r32-mosaic/console.txt`: empty (0 lines). perf.json: fps 6.5, worstGapMs 26260, frames 12, 56.3 s, cpu 4x.
- `r37-rm-radial/console.txt` (my reduced-motion run, errors and warnings): empty (0 lines).
- `r37-rm-mosaic/console.txt` (my reduced-motion run, errors and warnings): empty (0 lines).
