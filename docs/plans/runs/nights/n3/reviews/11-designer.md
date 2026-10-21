# Designer review, run runs-n3, round 11

Judged against README §5 (grey unless something needs you, hue and shape only for trouble, one
accent, data first, product-grade craft, both themes equally finished). Looks only, no code read.
`docs/design.md` still does not exist (the direction pick is on the owner list), so §5 is the yardstick.

Shots judged (all in `$RUN_DIR/shots/`):
- `r11-designer/none/{map,runs,board,inbox}-{dark,light}-{1440,390}.png`: taken this round with
  `loop/shoot.mjs` on the demo fleet, the app as it is after T3 (round 8). Only T4 (protocol, no UI)
  landed since, so these are the newest frames of the current look.
- `r11-designer/{refined,product,night}/…`: the same 16 frames with each design direction laid over
  (`demo-fleet.mjs --design <name>`). **These are the first pictures of the three directions**
  (owner item h, round 4), so the owner can now pick from images, not CSS files.
- `T3/page-end/custom-{dark,light}-{1440,390}.png` (round 8): the run page scrolled to the end.
  `T3/views*/` match the `none/` frames above and are not reviewed separately.

The demo is live: tile counts, lane states and the alarm-tile pulse phase change between frames.
Findings below show in more than one frame unless noted.

## console.txt, every line

- `r11-designer/none/console.txt`: empty (0 console/page errors).
- `r11-designer/refined/console.txt`: empty.
- `r11-designer/product/console.txt`: empty.
- `r11-designer/night/console.txt`: empty.
- `T3/page-end/console.txt`, `T3/views/console.txt`, `T3/views-end/console.txt`: empty.
- `r8-T3/before/{drift,reach,page,views}/console.txt`: empty.

No page error anywhere.

## Still open from round 4 (seen again, already tasks; no new task needed)

Listed so a builder knows they still show after T3; worst first.
1. **Light tiles in the faded pulse phase, white text on pastel (T14).** `none/map-light-390`,
   `none/board-light-390`, `refined/map-light-390`: NEED/APPR/STCK/CI-F beige, BLKD/DOWN pink,
   BUDG pale blue, all with white labels: about 1.5:1. `none/runs-light-390` caught the solid
   phase, so it is the pulse, not the colour. Dark at 1440 has the opposite problem: in
   `none/runs-dark-1440` the solid phase is saturated yellow/cyan/red and is by far the loudest thing
   on the screen while the page itself shows one stopped run.
2. **Board says NEEDS YOU 0 / "Nothing waiting." next to a red PERM DANGER card and two QUES
   cards (T17)**: `none/board-dark-1440`, all directions. Inbox says the same (`none/inbox-light-1440`,
   NEEDS YOU [0]) while the NEED tile says 1.
3. **Board text clipped (T16)**: nested status "PE", "QU" (1440), nested title cut to one letter
   "s", "l" at 390 (`none/board-light-390`), "docs refre:" / "release no'" cut mid-glyph with no
   ellipsis, the branch "⌥feat-", "⌥ci-re" cut at the card edge. The age still renders **"3π"** at
   1440 dark (`none/board-dark-1440`, cleanup job and bench run); 390 shows "4m" correctly, so it is
   the 1440 label face, not the formatter.
4. **Phone bar marks MAP on every view (T13, blocked on fenced `sheet.js`)**: `none/board-light-390`,
   `none/runs-light-390`, `T3/page-end/custom-dark-390`.
5. **Map labels collide (T18)**: `none/map-light-390`: "DEMO-HOST" runs into the HV1 ring, "VM-B"
   sits on the BB node's icon ("BB" half hidden), "BUILDER-B" is cut at the right edge
   ("BUILDER-"), "VM-A" tucks under BUILDER-A's ring. 1440: the "+2" badge sits on feat-search's ring.
6. **Phone Map HUD has no overlay name (T19)**: `none/map-light-390` HUD reads "Z 1.00× · N 22/24 ·
   09:12:22Z"; the clock is kept, the overlay (STATUS) is dropped.
7. **"no events yet" in the desktop status bar on every 1440 frame (T20)** while the phone line in
   the same minute says "BA/search api working".
8. **Run page at 390**: rounds table cut at COST with no scroll edge (T22, `T3/page-end/custom-dark-390`
   "$1.4", "COS" cut); ARTIFACTS still under the bottom sheet when scrolled to the end (T23, same frame:
   the PR row is a cut line behind MAP/LIST/INBOX); sparklines use the left half only (T26).
9. **Runs list "budget … $9.98" split across columns (T25)**: `none/runs-dark-1440`, label at
   x≈1500, value at x≈1660, with the 7d bar's "34%" in between it reads as "34% budget".

## New findings, current look (`none/`), worst first

1. **The minimap still floats over every non-Map view at 1440** (`none/board-dark-1440`,
   `none/runs-dark-1440`, `none/inbox-light-1440`, `T3/page-end/custom-light-1440`): a 330 px
   square with the full radar in the bottom-right corner. T3 made content scroll clear of it, which
   fixed the overlap, but it is still the largest drawn object on the Runs and Inbox pages and it
   draws amber triangles (trouble marks) in a corner that has nothing to do with the page. Against
   "data first" and "grey unless something needs you". Fix: show it on Map only, or collapse it to a
   32 px button with a count badge elsewhere (this is owner idea (b) from round 4; still standing).
2. **Run page at 1440: the data is spread across 1650 px with dead gaps**
   (`T3/page-end/custom-light-1440`): the sparklines are 220 px wide and their values float in the
   middle of the row ("3 ▲ 0-3" at x≈820, then 1100 px of nothing); in ROUNDS the OUTCOME column
   ends at x≈970 and COMMIT starts at 1200, COST is right-aligned at 1580, DURATION at 1780, while
   SESSIONS is all "–". The eye has to cross half a screen per row. Fix: cap the run page content at
   a reading width (about 960-1100 px) or size table columns to content with the minor ones (TASK,
   SESSIONS) narrow; let the sparkline take the space between the score name and its value.
3. **The open need on the run page has no action that looks like one** (`T3/page-end/custom-*`):
   "▲ decision Keep the old unpaged /search … open": "open" is a grey underlined word at the end
   of the line, read as a state, not a link or button. Now that T4 gives an ack, the row needs the
   same button style as Board's YES/NO (e.g. "ACK" / "OPEN ↗"), right-aligned. Belongs with T5's
   ack key; mention to the builder of T5.
4. **Runs list row at 390: the need count stands alone on its own line** (`none/runs-light-390`):
   "▲ 1" on one line, then "decision: Keep the old …" wrapped below. Fix: one line "▲ decision:
   Keep the old unpaged…" with the count only when there is more than one, as on the run page.
5. **Runs list at 1440: the 5h usage bar and "92%" are amber on a stopped run**
   (`none/runs-dark-1440`, `T3/page-end/custom-light-1440`): the run is STOPPED (grey hollow
   circle), the budget is spent, yet the only coloured things in the row are the quota bar and its
   percentage. If 92 % of a 5 h window is a real warning it is about the account, not this run;
   in a stopped run's row it pulls the eye to the wrong thing. Fix: grey when the run is stopped,
   amber only for a running run near the limit.
6. **The phone Map wastes the top third** (`none/map-light-390`): the radar fits the width, so it
   starts at y≈570 (of 1770 visible) and ~350 px of dot grid sit empty above it while the right
   edge still clips labels. Fit to the shorter axis and centre vertically, or shift the centre up
   (owner idea (g)).
7. **Inbox at 1440: rows span 1650 px with one short line each** (`none/inbox-light-1440`): the
   approval's timer "59:14" sits 1200 px from the command it belongs to, unlabelled (round 4 Inbox
   idea f). Fix: label "expires 59:14" and keep it next to the command, or cap the row width.
8. **Light sidebar: the down builder BC is a blue diamond with a hatched row**
   (`none/inbox-light-1440`, `night/inbox-light-1440`): blue is the BUDG/DOWN tile hue, but in the
   lane sidebar the same blue appears nowhere else; next to red squares and amber triangles it
   reads as a fourth status hue. Round-4 rule: one hue per severity. Fix: down = the red family (or
   grey with the hatch, the hatch is already the shape cue).

## The three directions compared (owner's choice, not a task)

Same frames, same minute of the demo. What each changes, and how it holds the control-room logic.

| | refined | product | night |
| --- | --- | --- | --- |
| Visible change vs current | almost none: tiles a touch smaller, row text a hair larger; side by side with `none/` it is hard to tell apart | the biggest: labels in a bold uppercase system sans, larger headers and buttons, cool grey | slightly tighter (36 px header, rows a few px shorter), firmer greys |
| Breaks something | no | **yes**: at 390 the tile grid overflows the screen, STCK and CONF are cut ("ST", "CO", `product/runs-light-390`); at 1440 the header no longer fits, the ALL scope button is cut to a sliver after RUNS (`product/board-dark-1440`); on Board cards the nested status word disappears entirely ("BA ✓ YES" with no PERM/QUES, `product/board-dark-1440`) and branches cut harder ("⌥fea", "⌥ci-") | no |
| Grey-unless-trouble | as now | weaker: bold uppercase sans on every label (NEEDS YOU, RATE LIMITS, MACHINE, buttons) makes calm text as loud as alarms | as now, a little more contrast everywhere |
| "3π" age glyph (T16) | still there | gone (the age is not drawn at all in the shot, which is its own loss) | still there |
| Light-theme faded tiles (T14) | still fail | still fail | still fail |

Reading: **refined and night keep the control-room logic best**; neither breaks a layout.
Refined is a safe no-op that buys little; night gives more density and contrast for a wall screen
at the price of smaller targets. **Product is the only one that reads "product grade" at a glance,
but in its current form it breaks the header at 1440 and the tiles at 390 and drops the status
word on nested rows, and its bold labels flatten the hierarchy that makes trouble stand out.** If
the owner likes product's feel, it needs regular (not bold) weight on calm labels and the header /
tile widths fixed before it can be judged fairly. None of the three addresses the craft items that
matter most in these shots (pulsing tiles, the floating minimap, clipping, the 1440 glyph); those are
sheet changes after any pick. The choice stays with the owner.

## Suggested task lines (for a triage round; not added by the reviewer)

- Minimap on Map only (or a small button elsewhere), new finding 1 — needs the owner's yes on idea (b).
- Run page reading width / column sizing at 1440, new finding 2.
- Grey quota bar on a stopped run, new finding 5.
- Product direction: header and tile overflow, nested status word, if the owner wants it judged.
