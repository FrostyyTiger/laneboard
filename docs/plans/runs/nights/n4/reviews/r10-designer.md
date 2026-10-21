# Round 10, designer review (run runs-n4)

Judged against README §5 (grey unless something needs you, hue and shape only for trouble, one
accent, data first, product-grade craft) and §7 Night 4 items 2-3 (the agreed taste calls).
`docs/design.md` does not exist yet (T11), so this is the last review against §5 alone.

Shots read:
- round 9 (T5): `shots/r9-T5/{before,after}/inbox-dark-1440.png`, `after/runs-dark-1440.png`,
  `run-page/custom-dark-1440.png` (dark 1440 only).
- taken this round because light and 390 were missing: `shots/r10-designer/` (map, runs, board,
  inbox × dark, light × 1440, 390) and `shots/r10-designer/run-page/custom-light-{1440,390}.png`
  (`#/runs?run=acme-search`), demo fleet on :7795.

The Night direction (T11/T12) is not applied yet: what follows is the current look, so the list
also says what T11/T12 must fix and what the taste-call tasks should take.

## Console

Every `console.txt` read, every line quoted:
- `r9-T5/before/console.txt`: empty (0 lines).
- `r9-T5/after/console.txt`: empty (0 lines).
- `r9-T5/run-page/console.txt`: empty (0 lines).
- `r10-designer/console.txt`: empty (0 lines); shoot.mjs printed "0 console/page errors".
- `r10-designer/run-page/console.txt`: empty (0 lines); "0 console/page errors".

## Across every view (worst first)

1. **The status tiles break "grey unless something needs you" hardest.** Eight solid-filled tiles
   (NEED/APPR/STCK/CI-F yellow, BLKD/DOWN red, BUDG cyan) are the loudest thing on every screen,
   in both themes, at both widths. BUDG in cyan breaks "no blue or cyan in content". Light theme
   makes it worse: the yellow becomes a muddy brown-ochre fill with white text (low contrast, reads
   "dirty", not "warning"). Fix (agreed taste call, item 3): grey tile, grey label, only the count
   coloured (amber ▲ count for wants-you, red ■ count for broken); BUDG becomes amber ▲; an empty
   tile (CONF) stays plain grey with no fill. On light, amber text on the light surface needs
   ≥ 4.5:1 (darken toward ~#8a5a00, not the brown fill used now).
2. **The minimap floats over content on non-Map views.** Inbox, Runs, Board and the run page all
   carry the 330 px orbit minimap bottom right; on the run page at 1440 it covers the end of the
   ARTIFACTS row (the "For the owner" note) and the panel's bottom border. It is pure decoration
   off the Map. Fix (taste call): minimap on the Map only.
3. **Phone bar: MAP is lit on Inbox and Runs** (`inbox-dark-390`, `runs-light-390`). The active
   segment should match the current view, or the bar should not claim one. Fix with n3 T13
   (`sheet.js` phone bar): highlight the segment of the current route; Runs/Board fall under LIST.
4. **Two warning colours in the lane sidebar.** The ALL/BA/BB bars mix red, yellow, light grey,
   mid grey and a hatched stub; the hatched tail at 1440 dark on ALL reads as a rendering glitch.
   Fix: red and amber segments only for trouble, every other state one grey with a 1 px gap; drop
   the hatch from the bar (keep it on the row for offline).
5. **The orange accent is spent on corner brackets** (sidebar ALL, Inbox focused row) and on the
   active nav tab underline while amber is the warning colour: orange and amber sit 20° apart and
   read as the same "trouble" hue at a glance. Fix (T11 Night): one accent that is not in the
   amber/red family, or keep orange as the only accent and move warning to a clearly yellower amber;
   write the choice into `docs/design.md`.
6. **Header density at 1440:** three type sizes and four weights in the top bar (LANEBOARD box,
   LIVE + host chips, nav caps, "$0.00 sessions today" in a larger mono, the two-line clock). The
   cost line is the largest text on the screen for a $0.00 value. Fix: cost at the nav's size in
   dim grey unless it is over budget; one line for the clock (`15:01:27Z`, drop the duplicate UTC
   line).

## Inbox (`inbox-{dark,light}-{1440,390}`)

1. Empty sections are two lines each ("REVIEW [0]" + rule + "No lanes are waiting for review.",
   "PAUSED [0]" + "Nothing here."): 170 px of nothing in the middle of the list, two different
   wordings. Fix (taste call): one muted line per empty section ("Review · none"), same wording
   everywhere, collapsed below the filled sections.
2. Inbox order: RUNS sits between APPROVALS and NEEDS YOU; the run PR row (○ pr: Paged search)
   is news, not a need, yet sits above the red NEEDS YOU item. Fix (taste call): run needs next to
   NEEDS YOU, run PRs after REVIEW.
3. Light 1440: the focused APPROVALS row is a mid-grey band with orange corner ticks, while the
   dark one has no band; the band is the darkest surface on the page and pulls the eye from the red
   ■. Fix: focus = 2 px accent ring (taste call), no fill.
4. ARCHIVE / STALE shows an amber ▲ ("same tool call 14x in 6m"). An archived item that still
   claims "wants you" contradicts its section. Fix: archived rows grey with no shape, or move the
   item up.
5. 390: the RUNS row wraps the question under its tag and the "open ↗"/ACK pair sits on the tag's
   line; the PR row truncates "(agent lo…" before a short link. Fix: on phone, actions on their own
   right-aligned line under the text, the text gets the full width.
6. "COOPERATIVE CONTROL" dashed badge: a dashed border is the only one in the app; it reads as a
   placeholder. Fix: plain dim caps text, no border.

## Runs list (`runs-{dark,light}-{1440,390}`)

1. Empty cells print "—" six times per running row (`— 7d ——— —`, the last column "—"); at 390
   a lone "—" sits on its own line under each running run. Fix: omit empty cells; no 7d bar when
   there is no 7d data; no trailing need column when there is no need.
2. The 5h/7d usage bars have no track contrast in dark (the grey track nearly vanishes at 34%) and
   a light-grey track that looks disabled in light. Fix: track one surface step above the panel,
   fill in text-dim grey; amber only above the warning threshold.
3. The title column truncates at ~40 characters while 600 px stay free at 1440 (the panel is
   2/3 empty to the right of "cost"). Fix: let the title take the free width; the need text, if
   any, in a second line under the title instead of a far-right column.
4. The RUNNING hourglass is the amber warning colour. If it means "stuck", say so with the ▲
   shape; if it means "waiting for a round", it should be grey.

## Run page (`r9-T5/run-page/custom-dark-1440`, `run-page/custom-light-{1440,390}`)

1. Minimap over ARTIFACTS (see across-views 2).
2. "STOPPED" label, the stats line "stop budget … cost $9.98" and the line "stopped: budget ·
   after 7 rounds · $9.98" say the same thing twice. Fix (taste call): fold the stop line into the
   state label: `○ STOPPED · budget · after 7 rounds`.
3. Score sparklines run 1000 px wide for 7 points and stop 220 px before the value column; the
   chart area and the value are disconnected. Fix: chart width ≤ 50 % of the row, value right
   after it; a 1 px dot for each round.
4. ROUNDS table: ROUND column right-aligned under a centred header, TASK/OUTCOME header gap of
   ~110 px vs ~330 px to COMMIT; the 1440 table spreads a 6-column dataset across 1400 px. Fix:
   left-align text columns, right-align numbers including their headers, cap the table at ~900 px.
5. OPEN / ACK buttons stop 270 px before the panel edge while the rule under them runs to the same
   point: the content column ends at ~1720 px but the panel at 1990 px. Fix: one content width for
   every section, or let the panel shrink to it.

## Board (`board-{dark,light}-{1440,390}`)

1. Coloured left lane bars on every card (teal, violet, red-pink, violet) are colour without
   trouble. Fix (taste call): grey lane bars unless trouble.
2. Every card shows "— — ctx 43% —" placeholder rows; the cleanup-job card has a 60 px empty band
   between its rows. Fix (taste call): no empty "–" fields, equal card heights, rows packed.
3. Light 1440: "bench run" and "release-notes" cards are hatched and faded to ~30 % contrast while
   the dark shot of the same demo 30 s earlier shows them normal. If hatched means offline (BC went
   offline between shots), the faded text is below 3:1 and unreadable; fix (T12): keep text at
   4.5:1 and let the hatch alone say "offline".
4. NEEDS YOU column: the cleanup-job card is a filled red-tinted block in both themes plus a red ◉;
   the light theme's pink fill on light grey is the only pastel in the UI. Fix: red ■ shape and a
   1 px red border, no fill.
5. The `ci retry` row in NEEDS YOU uses a cyan ◉ (no blue or cyan in content); it is a working
   lane, so grey ●.
6. "IDLE docs-refresh ⌥docs-refresh  release-notes ⌥release-notes" line: name printed twice, the
   ⌥ glyph reads as Option-key. Fix: name once, branch only when it differs.

## Map (`map-{dark,light}-{1440,390}`)

1. Light: the topology edges and the ring guides are the same grey weight as the node labels'
   ticks; everything competes at one level. Dark is better because the edges are dimmer. Fix
   (taste call Map polish): topology edges dimmed one more step on light, run ring ≥ 14 px, muted
   run label ("7/10" already muted, "ACME-SEARCH" is full white caps: make it dim).
2. Need labels "feat-search" / "fix-login" in amber lowercase mono, every node label in white
   caps: two label systems. Fix: one label style; amber only on the ▲.
3. The "+2" pill overlaps the feat-search ring.
4. Ring legends ("LANE · RUN", "BUILDER · PKG · RUN", "ROOM · REPO", "SITE · RUN") collide with
   the ring lines at 000 and with ACME-SEARCH's label. Fix (taste call): ring legends by the kinds
   on them, placed in the gap at ~330°, not on the 000 axis.
5. HUD "Z 1.00× SCOPE ALL N 25/27 OVL STATUS 15:02:48Z" repeats the header clock. Fix: drop the
   time from the HUD.

## Both themes, overall

Dark is close to finished; light is the weak one, as §8 Q6 says: the brown-ochre warning fills,
the pink focus fill, the faded hatched cards and the light-grey bar tracks all need T12. Of the
directions, only the current look is on screen this round (night 3's four directions were judged in
night 3); nothing to compare.
