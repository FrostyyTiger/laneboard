# Review: designer, round 6 (runs-n5)

What I judged: the newest shots in the run dir, `shots/r4-T2/` (Inbox, and the run page as
`page/custom-*`), plus my own shots of the views T2 did not cover, taken against the demo fleet
(`shots/r6-designer/`: map, runs, board; dark + light; 1440 + 390). The yardstick is README §5 and
`docs/design.md` (Night, tokens v2). Only one direction is in use now (Night, §8 Q6), so there is
nothing to compare; `docs/plans/runs/design/` holds the override CSS files only, no screenshots.
Worst first in each section. The demo data moves between shots (counts differ by one or two
between dark and light): that is the demo clock, not a bug.

## Console

- `shots/r4-T2/console.txt`: empty (0 lines).
- `shots/r4-T2/page/console.txt`: empty (0 lines).
- `shots/r6-designer/console.txt`: empty (0 lines); `shoot.mjs` printed `0 console/page errors`.

## Across every view (fix once, every screen improves)

1. **The same state has two marks.** Board: the `ci-retry` card says `▲ WORK` (amber triangle, the
   word "working") while the NEEDS YOU list shows the same lane as a grey `● ci retry`; at 390 the
   chip is `● ci retry` in a grey border. A ▲ next to the word WORK also contradicts itself: ▲ is
   "wants you", WORK is "news". Fix: a stuck lane reads `▲ STCK` (the header tile's word) on the
   card, in the NEEDS YOU list and on the phone chip, all from `STATE_MARK`; the hourglass stays a
   grey icon beside it.
2. **Amber icon without its shape.** Runs list: the running `acme-billing` row carries an amber
   hourglass after `● RUNNING`; the Board's hourglass and stamp icons are grey. design.md: "icons
   beside a mark are grey; the lamp is the row's one trouble mark". Fix: `▲ STUCK <reason>` in
   amber in the state cell, hourglass grey or dropped (this is n3 T50 in `## Later`).
3. **Selection drawn as a fill.** Sidebar `ALL` plate: light-grey fill with dark text in dark, a
   black slab in light, inside the accent corner brackets. Two rules broken: "selection is a 1 px
   accent border, never a fill" and "no dark slabs" (light). Fix: the selected plate stays
   outlined like `BA`/`BB`/`BC`; the brackets already say "selected".
4. **`$0.00 sessions today` in the header**, on every view, larger than anything else in the
   header (mono ~16 px vs 11-12 px around it) while the Runs list next door adds up to $18.43. A
   zero that is really "unknown" breaks the rule the night is building for runs ("unknown cost
   not $0"). Fix: `--fs-12`, `--text-2`, and `—` when no session reported a cost; if it is a real
   zero keep it but at the tile size.
5. **Counts written three ways.** `[7]` (Inbox, Runs, Lanes), `(1)` (run page: OPEN NEEDS (1),
   ROUNDS (7), ARTIFACTS (1)), and a bare `4` in a box (Board NEEDS YOU). Progress too:
   `round 7 / 10` (run page), `7 / 10` (Runs list), `7/10` before the name and `4/8` after it
   (Map). Fix: one count style, `[n]`, in every section head; progress always `7 of 10` (or one
   agreed form), always after the name; T5 is about to add `44 of 63`, so settle it there.
6. **One action, two looks.** Open/acknowledge a need: Inbox has a lowercase underlined
   `open ↗` link plus an `ACK` button; the run page has two condensed-caps buttons with icons
   `[↗ OPEN] [✓ ACK]`. Fix: one pattern for both (the run page's buttons read better as controls;
   use them in the Inbox row too, same height as the row's plate).
7. **Light amber drifts to olive.** `--p2` in light (triangles, segment bars, the Board's lane
   bar, tile borders) reads khaki/olive on the 95 % canvas, close to the grey-green `--ok` LIVE
   dot. Contrast is fine; the hue is not. Fix: keep the lightness, move the light `--p2` hue a few
   degrees toward orange (ochre, not olive) and check `test/tokens.test.mjs` still passes.
8. **Header tiles in light look filled.** In dark the empty tiles (DOWN, CONF) are canvas with a
   1 px line; in light every tile sits on a grey plate with a dark-ochre 2 px-looking border, so the
   annunciator row is the heaviest thing on a light page. Fix: light tiles on `--bg-surface`, 1 px
   `--p2-line` / `--p1-line` only while non-zero, `--line` otherwise.

## Inbox (`r4-T2/inbox-*`)

1. **ALL [7] in the panel, ALL [9] in the sidebar, `2/9` on the phone bar**: three numbers next
   to the same word "ALL" with no unit. Fix: give each count its noun once (`9 sessions`,
   `7 items`), or drop the sidebar's bracket on the Inbox view.
2. **Empty sections break the section rhythm.** `Review · none` / `Paused · none` rows are ~50 px
   tall in sentence case mono, the filled sections above are condensed caps heads with 35 px rows.
   The rule (one muted line) is kept, the size is not. Fix: the `· none` lines at `--row-dense`,
   `--fs-11`, with no divider under each, grouped in one block.
3. **Phone, RUN PRS row:** the title is cut at `Paged search (agent lo…` while `pr:` and
   `open ↗` take a third of the line. Fix: drop the `pr:` prefix (the section says RUN PRS), use
   the ↗ icon alone at 390.
4. **Phone, RUN NEEDS row:** the need text wraps under the plate while `open ↗` / `ACK` sit on the
   plate line; good. The focus ring is a 2 px accent inside the row as specified. No change.
5. `COOPERATIVE CONTROL` is the only dashed border in the app; it reads as a drop zone. Fix: a
   sunken plate (`plate--sunken`) or plain muted label.
6. The approval's countdown `59:54` stands alone at the right edge with no word. Fix: `59:54 left`
   in `--text-2`, or a clock glyph.

## Run page (`r4-T2/page/custom-*`), the subject of T2

1. **The artifact row reads as a phrase**: `pr  Paged search (agent loop) open round 4`. "open
   round 4" looks like a command, and `open` is also the Inbox's link word. Fix: separate the state
   from the round (`· open · round 4`), or give the state its own column; when the state is
   `merged`/`closed` keep it muted, when `open` print nothing or `open` with the same `·`. Add the
   ↗ glyph after the title like the Inbox so it reads as a link.
2. **The 390 shots never show the artifacts** (they are below the fold; `shoot.mjs` takes the
   viewport only), so T2's change was not seen on a phone. Not a design fix: the next `[ui]` task
   on the run page should shoot with `--hash` scrolled to the section or check it another way.
3. **Hierarchy of the head block (1440):** `○ STOPPED · budget · after 7 rounds` and the goal
   share one line, the goal starting after the state. The goal is the page's title and should lead.
   Fix: goal first at `--fs-16`, `--text-1`; under it the state line and `acme-search · run/search`
   muted. At 390 the order is already state, goal, names; keep it but give the goal `--fs-16`.
4. **The stat line groups wrongly.** `5h ▬▬ 92% 7d ▬ 34%`: the gap between bar and `92%` is wider
   than between `92%` and `7d`, so it reads "92% 7d". Fix: label and value hug their bar
   (`5h ▬▬ 92%`), `--sp-4` between groups; same in the Runs list.
5. **Scores block:** sparklines end at different x (tasks ~1473, tests ~1463); the value column
   is not aligned (`0-3` ends ~50 px before `0.84-0.94`); ranges use a hyphen. Fix: fixed-width
   spark area, right-aligned value column, en dash `0–3`. 60 px rows for two numbers are tall for
   "data first": `--row-comfy` and a 24 px spark is enough.
6. **Rounds table spreads to fill 1360 px**: an 85 px empty gutter before ROUND, OUTCOME and
   COMMIT 300 px apart. Fix: content-sized columns left to right (round, role, task, outcome,
   commit, cost, duration), the spare width after the last column.
7. The run page panel ends at ~1705 px while the Inbox and Runs panels run to the edge. Pick one
   (a max width for reading pages is fine, but then the Inbox too).
8. Phone: the acked `fence` need wraps to three lines with `acked by inbox 3h 35m ago` on its own
   right-aligned line. Fine, but give it `--text-3` so the open need above stays the loudest thing.

## Runs list (`r6-designer/runs-*`)

1. **The goal is cut at ~45 characters while empty quota cells take 300 px.** Data first: the goal
   is the data. Fix: for runs with no usage, one muted `—` (not two empty tracks and two dashes:
   `5h ▭ — 7d ▭ —`), and give the goal column the freed width. On the phone the goal is cut at 20
   characters next to `7 / 10`: put the progress on the stats line below.
2. Amber hourglass, see "Across" 2.
3. `7 / 10` and `4 / 8` do not align on the slash (the second is shifted right). Fix: tabular
   numerals right-aligned on the total, or the `of` form from "Across" 5.
4. The open need under the stopped run (`▲ decision: Keep the old unpaged…`) sits in the name
   line and is cut. Fix: its own line under the names, full width of the row.

## Map (`r6-designer/map-*`)

1. **A trouble node with no label**: the amber ▲ at about 1625,445 (1440) has none, while grey
   nodes nearby are labelled. A trouble node is always labelled (n3 T48 in `## Later`).
2. **Run labels: number before the name on one, after on the others** (`7/10 ACME-SEARCH` vs
   `ACME-DOCS 4/8`). T5 says "after the name"; make all three follow it.
3. **Phone label collisions**: `4/10 ACME-BILLING` is printed across another node; `4/8 ACME-DOCS`
   sits 150 px from its ring, over a different node; the `000` bearing touches `BUILDER-A`; a ring
   is clipped at the right edge. Fix (n3 T48 rest): drop a run label that would cross a node, keep
   the ring; keep a 4 px clearance from the bearing ticks.
4. **Phone: the map hugs the top** and leaves ~300 px of empty canvas above the Find field. Fix:
   Fit uses the whole height between the header and the Find row.
5. `BUILDER-A`'s lane dots include a violet one (dark and light). Violet is the accent; if it marks
   a lane's own hue, it collides with "one accent". Fix: lane swatches avoid the accent hue (or
   show grey under the builder label).
6. `+2` badge under `FEAT-SEARCH` overlaps the ring. Fix: place it outside the ring's radius.
7. Light theme is well finished here: grid quieter than the edges, labels readable.

## Board (`r6-designer/board-*`)

1. Mark mismatch for `ci-retry` (▲ WORK vs ●), see "Across" 1.
2. **Two trouble treatments in one grid:** the red card (`cleanup job`) has a full 1 px red frame,
   amber cards have a ~4 px amber left bar and a grey frame. The rule says the lane bar carries
   `--p1`/`--p2`; the frame is extra. Fix: red cards use the left bar like amber ones (the ■ and
   `DANGER` line already carry it), or every trouble card gets the frame, not a mix.
3. **Left column empty states:** `RATE LIMITS` / `No statusline data yet.` is a header plus a
   sentence; `MACHINE` is a header with nothing under it at all. design.md: one muted line
   `<Section> · none`. Fix: `Rate limits · none` and `Machine · none` (or hide MACHINE).
4. The two notification buttons are stacked with no gap and different widths. Fix: same width,
   `--sp-2` apart, or side by side.
5. The filter-chip row and the `IDLE docs-refresh release-notes` row look like two different
   controls (boxed vs bare). Fix: idle lanes as the same chip with a `○` and `--text-3`.
6. Light: nested session panels sit on grey `--bg-sunken` blocks, in dark they are outlined on
   the card. Heavier in light than dark (the "lift the light theme" note in §8 Q6). Fix: nested
   panels on `--bg-surface` with a `--line-weak` border in light.
7. `LAUNCH A LANE…` is the board's primary call to action but plain outlined grey. design.md
   spends the accent on "the primary call to action": a 1 px accent border would do.
8. Phone: an offline card's hatch runs under its text (`BC ○ WORK bench run OFFLINE`), cut by the
   bottom bar in the shot; make sure the hatch stops behind the text line (a solid strip under
   the title row).

## What looks right (keep)

- Inbox focused row: the 2 px accent ring inside the row, no fill, exactly as specified.
- Header tiles in dark: grey label, coloured count with its shape, empty tiles plain.
- Run page in both themes: grey throughout, the one open need the only amber thing on the page.
- Map in dark: quiet, the trouble nodes find the eye first.
