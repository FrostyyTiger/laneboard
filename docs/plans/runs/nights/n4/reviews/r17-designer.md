# Round 17, designer review (run runs-n4)

Judged against README §5 (grey unless something needs you, hue and shape only for trouble, one
accent, data first, product-grade craft) and the agreed taste calls of §7 Night 4 item 3.
`docs/design.md` does not exist yet (T11 is open), so this review again uses §5 alone.

Since round 10 only T5/T6 changed pixels (the run page's `acked by` line); T7/T8 are server work.
So this review **does not repeat r10-designer.md**: every r10 finding was checked again on the
new shots and **still stands unchanged** (tiles, minimap off the Map, phone bar, lane-sidebar
bars, accent vs amber, header density, Inbox 1-6, Runs list 1-4, run page 1-5, Board 1-6, Map
1-5). What is below is new: the Morning view (not shot in r10), the run page after T6, the 390
run page, cross-view contradictions in the status marks, and a look at the Night direction on
today's code for T11/T12.

Shots read (all taken this round, demo fleet on :7795):
- `shots/r17-designer/` map, runs, board, inbox, morning × dark, light × 1440, 390 (20 shots).
- `shots/r17-designer/run-page/custom-{dark,light}-{1440,390}.png` (`#/runs?run=acme-search`).
- `shots/r17-designer/night/` board, inbox, morning × dark, light × 1440, taken with
  `demo-fleet.mjs --design night` (the direction the owner picked, §8 Q6, laid over today's code).

The demo changes state between shots (BC goes offline and back, counts shift by one): differences
in counts between a dark and a light shot of the same view are the demo, not a theme bug.

## Console

Every `console.txt` read, every line quoted:
- `r17-designer/console.txt`: empty (0 bytes); shoot.mjs printed "0 console/page errors".
- `r17-designer/run-page/console.txt`: empty (0 bytes); "0 console/page errors".
- `r17-designer/night/console.txt`: empty (0 bytes); "0 console/page errors".

## Across every view: the status marks contradict each other (worst first)

1. **▲ means two things.** On Morning (`morning-*-1440`, `-390`), the Runs list and the run page,
   a grey ▲ after a score (`tasks 0 → 3 ▲`, `tests 0.94 ▲`) means "went up". Everywhere else ▲ is
   the "wants you" shape. A screen of grey ▲ next to amber ▲ makes the shape language unreliable,
   and in light theme the grey ▲ and the dark-amber ▲ are close in tone. Fix: trend with an arrow
   glyph (`↑`/`↓`) or a signed delta (`+3`, `+0.10`); reserve ▲ for "wants you". Write it into
   `docs/design.md` (T11): "▲ and ■ are status shapes only, never trend or decoration".
2. **Same state, different shape and hue across views.** The approval `npm run build` is a red ■
   in the Inbox (`inbox-*-1440`, APPROVALS) while its header tile APPR is amber and §7 item 3 files
   approvals under "wants you" (amber ▲). The Board's NEEDS YOU list draws every item as a ◉ in a
   different hue (red, red, brown, cyan: hue without shape, `board-light-1440`) while the cards
   for the same lanes say ■ PERM / ▲ QUES / ● WORK. Fix: one mapping from state to mark, used by
   Inbox rows, Board list, Board cards, Map nodes and the phone status bar: PERM/approval = amber ▲
   (unless the plan decides a permission is "broken"), BLKD/DOWN/DANGER = red ■, working = grey ●,
   idle = grey ○. A test can enumerate the views' marks per state once T13 lands the tile rule.
3. **Counts disagree between views.** Morning says `NEEDS YOU 0` and `APPROVALS 0` while the same
   screen's header shows NEED 1-2 and APPR 1 and the Inbox lists 2-3 needs, 1 approval and an
   open run need (`morning-*` vs `inbox-*`). Morning also says "no answer from builder-a,
   builder-b, builder-c" while the header shows all three LIVE with green dots. Whatever the data
   reason (the demo may not feed `/api/morning`), on screen it reads as a broken product. Fix: if
   Morning has no data from a builder, say so in the summary line only and show the counts as
   `—` with a dim "no data" instead of a confident `0`; with §8 Q9 (Morning lists run needs) the
   open run need must appear here too.
4. **The minimap draws different marks for the same nodes** in dark and light shots taken a minute
   apart (`run-page/custom-dark-1440`: centre ■ red; `inbox-dark-1440`: centre ▲ amber). That is
   the demo's state moving, but in Night light (`night/inbox-light-1440`, `night/board-light-1440`)
   the minimap ▲ are a pale tan at about 1.5:1 on the panel: unreadable. Moot once the minimap is
   Map-only (T14); if it stays anywhere, its marks need the 3:1 floor of T12.
5. **Dimmed red squares in the dark sidebar.** ALL and BB carry a dark-maroon ■ (`run-page/
   custom-dark-1440`, `morning-dark-1440`, `inbox-dark-1440`) next to BA's bright red ■: under
   2:1 on the sidebar, it looks like a disabled state, and in light the same squares turn pink
   (`morning-light-1440`). Fix: one red ■ for "a lane in here is broken", full strength in both
   themes; if the dim one means "aggregated" or "acknowledged", use grey with the count instead.

## Morning (`morning-{dark,light}-{1440,390}`, new in this review)

1. Contradicting numbers and "no answer" (see across 3): the worst thing on this screen.
2. The summary strip sets five label sizes in a row: tiny condensed caps labels (`BUILDERS`) with
   big mono values (`$18.43` at ~18 px), and `REVIEW 0 · 0 waiting` mixes a label and a sentence.
   At 390 it wraps so that `REVIEW 0 · 0 waiting` lands on its own line. Fix: label 11 px caps
   dim, value 14 px mono, one size for every value (spend is not bigger than the others); split
   `REVIEW 0` and `WAITING 0` into two cells; on phone a 2- or 3-column grid instead of wrapping.
3. The summary panel and the run rows end at ~1700 px while the date "since 20 Oct 18:00" sits at
   the far right edge (1990 px): two right edges. Fix: one content width; the date inside the
   panel's right edge (and on phone it already wraps fine).
4. Run rows: title in 18 px mono bold is the biggest type on the screen, bigger than any view
   title; the state `STOPPED: BUDGET` / `RUNNING` sits in tiny dim caps after a `>` chevron that
   reads as a link arrow mid-sentence. Fix: title at the body step (14 px, weight 500), state as a
   leading mark + word in the meta line (`○ stopped · budget · 7 rounds · $9.98`), chevron at the
   row's end or gone (the whole row is the link). `5h 92%` has no label at this zoom: write
   `5h 92 %` under a dim `usage` label or drop it from Morning.
5. Run state marks: stopped `○`, running `●`, which matches the rule (grey, shape only). Good;
   keep them when T15/T16 touch neighbouring rows.
6. The empty line "Nothing on review wait, approvals, package cost, held back." is a list of
   section names, not a sentence, and gives no next step. Fix (taste call "empty states say what
   to do"): "Nothing else waiting since 18:00." in the dim one-line style of T16.
7. 1440: 60 % of the screen is empty below the runs and the minimap sits in the empty space. With
   T14 the minimap leaves; the empty area is then fine for a morning digest.
8. 390: phone bar lights MAP on Morning (r10 across 3, T18); the selected `ALL` builder chip is a
   pink fill in light (`morning-light-390`) and a brown fill in dark: a third and fourth tint for
   "selected". Fix: selected chip = the 1 px accent border or the 2 px focus-ring style of T16,
   no fill.

## Run page after T6 (`run-page/custom-{dark,light}-{1440,390}`)

1. **390: the closed fence row collapses into a word column.** `round 4 wanted to change fenced
   files: server/http.mjs` wraps at ~10 characters into seven lines, because `acked by inbox 3h
   35m ago` keeps half the row on the right; `server/http.mjs` breaks mid-word. The open need above
   has the same problem with the OPEN/ACK pair (four lines of question). Fix: at phone width the
   need row stacks: kind + text on full width, then the meta (`acked by …`) or the actions on
   their own right-aligned line (same fix as r10 Inbox 5); never break inside a path
   (`overflow-wrap: anywhere` only as last resort, prefer a break at `/`).
2. 1440: the closed row's text starts at x≈442 while the open row's starts at x≈430 (the kind
   column is not a fixed width: `decision` vs `fence`). Fix: a fixed kind column (the longest kind
   plus one gap), so both texts start on one line.
3. The `✓ fence` closed row and its `acked by inbox 3h 35m ago` are correctly grey; good. The
   ✓ is the only checkmark glyph used as a state mark in the app; fine for "closed", note it in
   `docs/design.md` with the other marks.
4. Stop said twice (r10 run page 2, T17) and `stop budget` a third time in the stats line: now
   three mentions on one screen (`stop budget`, `stopped: budget · after 7 rounds · $9.98`,
   `○ STOPPED`), plus `cost $9.98` twice. T17 should remove the `stop budget` stat too.
5. The 5h/7d usage bars: the 5h bar is a thin line with no visible track in dark at 92 % (looks
   like a dash, not a gauge); r10 Runs 2 still applies here.
6. Minimap covers ARTIFACTS and the panel's right border at 1440 in both themes (r10, T14).

## Board (`board-*`, also `night/board-*`)

r10 Board 1-6 all still visible. Two more:
1. The `DANGER` badge is the only solid red pill in the app (white on red), and the card around it
   is already red-bordered with a red ■ PERM: three red signals for one item. Fix: drop the fill,
   red ■ + `danger:` prefix in red text, or keep the card border alone.
2. The red stamp icon (feat-search, search ui, right of the time) and the amber hourglass (ci-retry)
   are icon-shaped status marks outside the ■/▲/● set, in hue. Fix: grey icons unless they are the
   one trouble mark of the row; if the hourglass means "stuck", it should be ▲ amber per the rule.
3. Offline BC cards in light (`board-light-1440`): hatched and faded to ~1.8:1 text (r10 Board 3,
   T12). Night light (`night/board-light-1440`) shot BC online, so it could not be compared.

## Map (`map-*`)

r10 Map 1-5 still visible. One more: the centre DEMO-HOST is a filled amber disc with no ▲ in
light (`map-light-1440`): amber without the shape. Fix: grey disc, amber ▲ only if the host
itself wants you. The header has BLKD 1 / DOWN 1 but no red ■ is anywhere on the Map at that
moment, so the "broken" state has no place on the Map: worth a check by the T19 builder whether
the blocked lane's node should carry ■.

## Inbox (`inbox-*`)

r10 Inbox 1-6 unchanged, plus across 2 (approval drawn as red ■). The focus band in light is a
mid-grey fill with orange corner ticks again; T16's 2 px ring replaces it.

## Night direction vs today's look (for T11/T12; the owner already picked Night)

Shots: `night/{board,inbox,morning}-{dark,light}-1440` against the same views above.
- Dark: Night is today's look with a deeper canvas, a 36 px header and 24-32 px rows; it reads
  firmer and denser, the same control-room logic. Nothing in Night dark breaks a rule that today's
  dark does not already break (all the problems above are in the sheets, not the tokens).
- Light: Night's light is cleaner than today's (white panels on a light-grey canvas instead of
  grey on grey, darker text), but it keeps every light-theme fault of today: brown-ochre tile
  fills with white text, the pink NEEDS YOU card and sidebar squares, the pale tan minimap ▲ at
  ~1.5:1, the grey focus band. So T11 alone will not lift light; T12 and T13 must land with it.
  Concretely for T12: amber text/marks on white need a darker amber (~#8a5a00 gives ≥ 4.5:1 on
  white), red ~#b3261e for ■ on white, and no tinted fills at all (T13 removes them).
- Tokens cannot fix the contradictions in "Across" 1-3: they need the sheets and the views.

## Suggested order for the builders (no new tasks; the planner/triage decides)

Across 2 (one state → one mark) belongs with T13; across 1 (▲ as trend) is small and could ride
with T13 or T17; across 3 (Morning counts and "no answer") is a correctness question for the
Morning item (§8 Q9) more than a look one; Run page 1 (390 need rows) fits T17; Morning 2-4 and
6 are new and are not covered by any task.
