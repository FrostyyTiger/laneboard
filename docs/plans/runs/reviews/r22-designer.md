# Round 22, designer review (run runs-n4)

Judged against `docs/design.md` (Night, tokens v2, written in T11) and README §5. This is the
first review against `docs/design.md`: where a view breaks a rule that page now writes down, the
rule is named.

Since r17 only T11 changed pixels: Night is folded into `tokens.css` v2. So this review **does not
repeat r10/r17 findings that already became tasks** (T12-T19, T22-T26). It checks every one of
them again on the new shots: **they all still stand**. The findings below are new or newly visible
under v2, plus the places where a v2 shot breaks a rule `docs/design.md` now states.

Shots read (the newest, from the T11 builder round, demo fleet):
- `shots/r21-T11/after/` map, runs, board, inbox, morning × dark, light × 1440, 390.
- `shots/r21-T11/after-run/runs?run=acme-search-{dark,light}-{1440,390}.png`.
- `shots/r21-T11/before/inbox-light-1440.png` for the v1 → v2 comparison.

The demo changes state between shots (BC goes offline, counts shift by one): count differences
between a dark and a light shot of the same view are the demo, not a theme bug.

## Console

Every `console.txt` read, every line quoted:
- `r21-T11/before/console.txt`: empty (0 bytes).
- `r21-T11/after/console.txt`: empty (0 bytes).
- `r21-T11/after-run/console.txt`: empty (0 bytes).

## v1 → v2, what T11 changed on screen

The swap went through cleanly: header 40 → 36 px, Inbox rows ~40 → ~34 px at 1440, the light
canvas a touch cooler, firmer lines. Nothing broke or clipped, and no view looks unfinished
*because of* v2. Night's density reads right in dark. Everything below was there before T11 too,
but under v2 it now breaks a rule that is written down.

## Across every view (worst first)

1. **Light header tiles are the heaviest thing on a light screen** (`*-light-1440`, `*-light-390`).
   In light, NEED/APPR/STCK/CI-F are dark ochre slabs with a black outline and DOWN/BLKD are
   saturated crimson slabs: eight dark blocks in the top right that out-shout every row on the
   page, with or without trouble. That breaks design.md "a tile or count is coloured only while it
   is non-zero; an empty one is plain grey with no fill" and "amber on the light canvas needs its
   shape or a 1 px border, never a fill alone". T13 already covers the rule. **Add to T13/T12:**
   judge it in light first. A grey tile, a 1 px `--line` border, the label `--text-2` and only the
   count + ▲/■ in `--p2`/`--p1`. In light the BUDG tile is a royal blue slab, the only blue on the
   screen (design.md: "no blue or cyan in content").
2. **A third red: the dimmed pink ■** (`morning-light-1440`, `runs-light-1440`, sidebar ALL and
   BB; the minimap's squares on Morning and the run page). In light the dimmed red is a salmon
   pink that reads as its own colour, not as "less red". In dark the same mark is maroon (r17 had
   it in T23). Fix as T23 says: the full `--p1` ■ or grey. Also check the minimap: its red squares
   are pink in light while its ▲ are full amber.
3. **Light sidebar bars: "working" is the darkest segment** (`runs-light-1440`,
   `inbox-light-1440`, `map-light-1440`). The lane bars under ALL/BA/BB inverted badly: in dark
   the working segment is a light grey, in light it is near-black (`#333`-ish). It is heavier than
   the red and the ochre next to it, so "news" outweighs "broken". That is exactly the inversion
   failure research/Q13 warns about. Fix (T12): in light the working segment is `--text-3` or a
   mid grey that is lighter than the trouble segments, and idle lighter still.
4. **Accent fill on selection in light reads as a status colour.** The selected builder chip (ALL)
   and the phone bar's MAP segment are a peach fill (`board-light-390`, `map-light-390`,
   `morning-light-390`), and in dark a brown fill (`inbox-dark-390`). The NEEDS YOU chip of the
   Board is pink-filled next to it. Peach, pink and ochre sit together and read as one family of
   "warm = trouble". design.md says the accent is "selection, focus and primary action": it is,
   but a fill makes it a state colour. Fix: selection = 1 px accent border (plus the corner
   brackets the desktop sidebar already uses), no fill. This is the same call as T25's builder
   chip and T16's focus ring: make it one rule in design.md.
5. **Lane colour bars on Board cards are still purple/teal/green** (`board-*-1440`, `-390`).
   T15 has "grey lane bars unless trouble". Noting it again because design.md now says "no blue or
   cyan in content". The teal and lavender bars are the most visible break of it in v2.

## Map

1. **390, light and dark: labels collide** (`map-light-390`). BUILDER-B, VM-B, the BB box and
   `deps-bump` overlap in one spot. VM-C, the BC box, ACME-BILLING, `4/10` and BUILDER-C stack on
   each other. `+2` covers the ring legend ("BUILDER · PKG · R"). On a phone the Map is not
   readable in its busiest part. Fix: at ≤ 480 px, drop the ring legends, keep labels for nodes
   with trouble and the selected one (others on tap), and run the existing label-collision pass
   (or a simple vertical nudge) over node labels. A test can check that no two label boxes
   intersect at 390.
2. **390: the orbit sits in the lower half** with ~300 px of empty dotted grid above it
   (`map-light-390`). Fix: centre it in the free height between the HUD and the phone bar, or
   fit the outer ring to the width and top-align.
3. **Light: lane labels are olive on a dotted grey** (`map-light-1440`: `feat-search`,
   `fix-login`; `deps-bump` at 390). They look under 4.5:1, and the dot grid runs through them.
   T19 wants "one label style, amber only on the ▲": that fixes it. Until then T12's contrast test
   should include `--p2` text on `--bg-canvas` light.
4. **Light: the dot grid is as loud as the edges** (`map-light-1440`). Fix (T12): grid dots one
   step lighter than `--line-weak` in light. T19 already dims the edges one step, so do both or
   the edges vanish into the grid.
5. **Dark: DEMO-HOST is a solid amber disc** with no host trouble (`map-dark-1440`). T23 has it.
   Still standing.

## Board

1. **390: the NEEDS YOU strip is in wide-tracked caps at ~24 px** ("C L E A N U P  J O B 5M",
   `board-light-390`). That is larger than any other text on the phone, pink-filled, and it runs
   off the right edge with a half chip. It is not on design.md's type scale (largest body step is
   13 px, 20 px is reserved for counts). Fix: the strip uses the body mono at `--fs-13`, no
   letter-spacing, a 1 px border, the red ■ / amber ▲ mark and no fill; let it scroll with a fade
   on the right edge, or wrap to two lines.
2. **Light: the faded hatched cards (BC offline) carry amber text** (`board-light-1440`,
   release-notes `▲ ctx 71%`). The hatch plus 30 % opacity makes the ▲ the only readable mark on a
   card that is otherwise "gone". Fix: an offline builder's cards are grey including their marks,
   with one `offline` plate. r10 dropped the hatch issue into T12; this part is new.
3. Still standing (T15/T23): empty "–" fields, unequal card heights, the red stamp and amber
   hourglass icons, the ◉ hue-only list, the DANGER pill fill.

## Inbox

1. **Light: the BASH chip is a solid black plate** (`inbox-light-1440`). It is the darkest
   element in the row, darker than the red ■ that is the row's actual message. Dark has a grey
   plate. Fix: in light use the same outlined plate as the BUILDER-A/SEARCH UI chip next to it, or a
   `--bg-sunken` fill with `--text-2`.
2. Approval row is still a red ■ (T23). Empty sections, order and the archived ▲ (T16) still
   stand.

## Morning

1. Still standing: T24 (counts `0` and "no answer from …" while the header is LIVE), T22 (▲ as a
   trend), T25 (strip sizes, the date outside the panel edge at 1440: the panel ends at ~1705 px,
   the "since 20 Oct 18:00" sits at the window edge).
2. **Light: the header BC chip is a red-filled plate with a red ■** (`morning-light-1440`,
   `runs-light-1440` run page). It is the only builder chip with a fill, and it is filled red
   when BC is merely offline in other shots. Fix: a builder chip is outlined, its mark carries the
   state (○ offline grey, ■ red only if the builder is down), never a fill.

## Runs list

1. **The column grid does not hold** (`runs-*-1440`). `tests 0.94 ▲` sits only on row 1. The 5h/7d
   meters start at the same x but the `—` placeholders float. The last column (`▲ decision: Keep
   the o…`) is truncated at 1440, where there is room. Fix: fixed column widths for score, 5h, 7d,
   stop/left, cost, need. Put the need text on the title's second line (where the repo/path is)
   instead of a squeezed last column.
2. The RUNNING hourglass is amber in light and dark (r10 taste, still under For the owner).

## Run page

1. **The minimap covers the ARTIFACTS row and the panel's bottom-right corner**
   (`runs?run=acme-search-light-1440`). T14. Still the most visible unfinished spot on the page.
2. **Two content widths in one panel** (`-1440`): needs, scores and rounds stop at ~1718 px while
   the panel's frame runs to ~1990 px. The OPEN/ACK buttons and `acked by` align to 1718, so the
   right 270 px are an empty gutter that looks like a layout bug. Fix: one max content width for
   the panel and its frame (the frame shrinks to the content), or let the tables fill the frame.
3. **390: the fence need text breaks to 7 lines and `http.mjs` splits mid-word** (`-dark-390`).
   T26. Still standing.
4. **Scores: the sparkline has no y-reference and starts 180 px in** (`-1440`). The line floats
   between `tasks` and the value with no baseline, and at 1440 it is drawn flat-ish across 1000 px.
   Fix: cap the sparkline width (~240 px, data first), put it next to the value, and add a 1 px
   `--line-weak` baseline.
5. Still standing: the stop line twice (T17), ▲ as trend (T22).

## Light theme against the dark one (for T12)

Read side by side, dark is finished and light is not. In order of what reads worst:
1. Header tiles (across 1).
2. Inverted bar weights (across 3).
3. The pink dimmed ■ (across 2).
4. The black BASH plate (Inbox 1).
5. Olive lane labels on the Map (Map 3).
6. Peach and pink fills (across 4, Board 1).

Text contrast of body and dim text on the canvas and surface looks fine in every light shot.
The problems are fills and weights, not text. A T12 test that only checks text ratios would
pass today; it should also check that no status fill sits on the light canvas (or that every
trouble mark is ≥ 3:1 on its surface) and that the "working" bar segment is lighter than the
trouble segments.
