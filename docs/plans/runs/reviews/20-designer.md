# Designer review, run runs-n3, round 20

I judged the screens against README §5 only: grey unless something needs you, hue and shape only for
trouble, one accent, data first, product-grade craft, both themes equally finished. I read no code.
`docs/design.md` still does not exist because the owner has not picked a direction yet (round 11
item), so §5 is the yardstick.

Since round 11, T5 (Inbox runs group), T6 (Morning server side) and round 18's Morning view work
(T7, not ticked yet) have landed. This review looks mainly at those **new surfaces**. For the older
views it only notes what still shows.

Screenshots judged (all in `$RUN_DIR/shots/`):
- `r20-designer/views/{map,runs,board,inbox,morning}-{dark,light}-{1440,390}.png`: I took these this
  round with `loop/shoot.mjs` on the demo fleet (`demo-fleet.mjs --port 7820`), on the current
  branch head `7a51752`.
- `r20-designer/page/custom-{dark,light}-{1440,390}.png`: the run page (`#/runs?run=acme-search`).
- `r14-T5/inbox-*`, `r18-T7/morning-*`, `r18-T7b/morning-*`: the builders' own shots. The r20 frames
  match them; I did not review them separately.

The demo is live, so tile counts, lane states, the alarm-tile pulse phase and BC's up/down state
change between frames.

## console.txt, every line

- `r20-designer/views/console.txt`: empty (0 console/page errors).
- `r20-designer/page/console.txt`: empty.
- `r14-T5/console.txt`: empty.
- `r18-T7/console.txt`: empty.
- `r18-T7b/console.txt`: empty.

There is no page error anywhere.

## Morning (new: runs block), `views/morning-*`

1. **The summary strip contradicts the runs block under it.** Every frame says `FINISHED 0` and
   `SPEND $0.000`, and 100 px lower the same window shows a run that stopped after 7 rounds and
   cost **$9.98**. For a "data first" screen this is the worst thing on it: the first numbers the
   owner reads in the morning are wrong. Fix: count runs that stopped in the window into
   FINISHED (or add a `RUNS 1` cell), and add the runs' `usd` to SPEND. Alternatively, label the
   strip as sessions only ("SESSIONS FINISHED", "SESSION SPEND").
2. **Three empty builder blocks take more room than the one block that has data.** BA, BB and BC
   each draw a full framed block of about 95 px for the line `No answer: not found` (or
   `builder down`). The strip above already says "no answer from builder-a, builder-b, builder-c;
   their blocks are empty". Fix: when a builder has nothing, draw no block at all; the strip line
   is enough. If the builders are kept, collapse them into one grey row,
   `BA · BB · BC  no answer`.
3. **The `No answer` diamond is cyan/blue**, a hue §5 does not give to "informational". On a calm
   screen it is the only cold colour in the content area. Fix: a grey hollow circle (the strip
   already uses `○` for the same fact), or amber with a triangle if "builder down" is meant as
   trouble.
4. **Empty sections are drawn in full four times** (REVIEW WAIT, APPROVALS ANSWERED, COST BY PACKAGE,
   WHILE YOU WERE AWAY). Each has a header, a `0` badge, a stats row of `—` and `0`, and a
   sentence: about 330 px of zeros at 1440 and most of a phone screen at 390. Fix: when a section
   has no data, draw one muted line ("Review wait: nothing in this window"). Skip the stats row.
   Better still, group all empty sections under one line at the end: "Nothing on review,
   approvals, package cost, held back."
5. **The run's stop chip differs between themes.** In dark, `STOPPED: BUDGET` sits in a filled grey
   chip; in light it is bare grey text with no chip. Fix: use one treatment in both themes. Bare
   muted text is enough here: a budget stop is not trouble, and the chip adds a shape with no
   meaning.
6. **The run row's data runs out at 1370 of 2000 px** while the builder blocks span the full width.
   This is the same width problem as T27. Fix: cap the Morning content at a reading width (about
   1000 px, the same cap T27 gives the run page) so the run row, the strip and the sections share
   one measure.
7. **At 390, the summary strip wraps with a stray divider.** After `SPEND $0.000` a vertical rule
   hangs at the end of line 1 with nothing after it. Fix: draw dividers as a left border on every
   cell but the first in its line. A simpler alternative is a 2-column grid on a phone.
8. **The builder block legend reads `BA · BUILDER-A [0]` with the frame line passing behind
   the `·`.** At 390 it looks like `BA -·BUILDER-A-[0]`. A lone hollow circle sits at the right
   end of the frame line with no meaning I can see. Fix: give the legend one background behind
   the whole label and drop the end circle, or say what it is (a collapse toggle needs an
   icon that reads as one).
9. **Like every view, the minimap floats over the bottom-right of Morning.** It covers nothing
   in this frame because the page is short (owner idea (b), round 4).

## Inbox (new: RUNS group), `views/inbox-*`

1. **At 390, the run decision is cut to `decision: Keep the o…`.** This is the one item in the
   Inbox that needs a written answer, and it cannot be read. `open ↗` and `ACK` take a third of
   the row. Fix: on a phone, let the need text wrap to two lines (approvals can stay one line)
   and put `open`/`ACK` on the row's right edge, below the first line if needed. The Runs list at
   390 already wraps the same text well.
2. **The PR row uses a cyan diamond.** A PR waiting to be merged is "news", not trouble, and the
   cyan is a fourth hue in a list whose other marks are red and amber. Fix: a grey hollow mark
   (or the plain `↗` glyph) for PR rows; keep amber `▲` for the open need.
3. **The row actions mix two control styles.** `open ↗` is a lower-case underlined link, `ACK`
   is an outlined upper-case button, and the run page shows the same need with only a grey
   underlined `open`. Fix: render `OPEN` and `ACK` both in the Board's YES/NO button style,
   right-aligned. Then do the same on the run page, which is T28 (still open; the Inbox now shows
   what it should look like).
4. **The RUNS group sits above NEEDS YOU.** A PR to look at outranks a lane that needs you. In this
   frame NEEDS YOU is empty, so it does not hurt yet. Fix: put runs needs inside or right after
   NEEDS YOU and runs PRs after REVIEW. One alternative is to order groups by severity (approvals,
   needs, then news).
5. **Empty groups still take 85 px each with `Nothing here.`** (NEEDS YOU, REVIEW, PAUSED). Fix:
   the same rule as Morning 4: when a group is empty, show a one-line header with `0` in muted
   text and no body row.
6. **Light 390: `CI-F`, `DOWN`, `BUDG` are caught pale with white text**, about 1.5:1. This is
   T14, still open.

## Run page, `page/custom-*`

Nothing changed since round 11. These all still show:
- At 1440 the content spreads to 1650 px. The sparklines sit in a 220 px slot with 100 px of
  air on each side, and COST/DURATION sit 600 px from ROUND/ROLE (T27).
- The open need is a grey underlined `open`, while the Inbox already has an `ACK` button for the
  same need (T28; see Inbox 3).
- `5h ▬ 92%` is amber on a stopped run (T30).
- At 390 the rounds table cuts COST at `$1.4` and hides DURATION/SESSIONS (T22). The sparklines
  use the left half only (T26), and the goal is cut to `Add paged search to acme-api and the…` (T26).
- New in this frame: **at 1440 the minimap overlaps the ARTIFACTS row.** The row's bottom rule
  runs under the minimap's frame at x≈1650. Fix: with T27's reading-width cap, the content no
  longer reaches the minimap. Without it, reserve the minimap's width on the right as T3 did for
  the bottom.
- `stopped: budget · after 7 rounds · $9.98` repeats the `STOPPED` label and the `$9.98` in the
  line above it. Fix: one line. Keep the stop reason next to the state label (`○ STOPPED ·
  budget`) and drop the second line.

## Runs list, `views/runs-*`

Unchanged: the need count `▲ 1` sits on its own line above the need at 390 (T29). The 5h bar and
`92%` are amber on a stopped run (T30). `budget ...... $9.98` is spaced like a two-column table
(T25).

## Board, `views/board-*`

Unchanged: `NEEDS YOU 0 / Nothing waiting.` sits next to a red PERM DANGER card and two
PERM/QUES lanes (T17). Status words and titles are still clipped to `PE`, `QU`, `docs refre`,
`release no`, and the age glyph shows `4π` (T16). The light sidebar shows BC down as a blue
diamond in `board-light-1440` (T31); `morning-light-1440` shows a red hatched square for the same
state. **Two different down marks for one state** strengthens T31.

## Map, `views/map-*`

Unchanged (T18, T19): label collisions, a lower-case grey `acme` beside upper-case node labels,
and unlabelled diamonds and dashed circles on the outer ring. The desktop status bar still says
`no events yet` on every view (T20) while the phone line shows `BA/search api working`.

## Cross-cutting

- **The newest surfaces add cold hues where §5 wants grey.** Morning's builder diamonds and the
  Inbox's PR diamond are cyan; the down builder is blue in places (T31). In Map, Board and Runs,
  blue appears only in the BUDG/DOWN alarm tiles. One rule settles all of these: grey for "news",
  amber + triangle for "wants you", red + square for "broken", and no blue or cyan anywhere in
  content.
- **Empty states are full-size everywhere** (Morning sections, Inbox groups, Board `RATE LIMITS /
  No statusline data yet.`). A screen with little data looks like a form with every field
  blank. A shared "empty section = one muted line" rule would raise the product-grade feel more
  than any single fix.

## For triage (suggested new tasks, not already T13-T31)

1. Morning: put runs into FINISHED and SPEND (or label the strip as sessions). Morning 1.
2. Morning: drop the empty builder blocks and collapse empty sections into one line. Morning 2
   and 4, Inbox 5.
3. Inbox at 390: let the need text wrap, not cut. Inbox 1.
4. Show info rows (PR, no-answer) in grey, not cyan, in Inbox and Morning. Inbox 2, Morning 3.
5. One OPEN/ACK button style across the Inbox and run page. Inbox 3, joins T28.
6. Show the run stop chip the same way in both themes. Morning 5.
