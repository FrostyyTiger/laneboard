# Designer review, run runs-n3, round 25

I judged the screens against README §5 only: grey unless something needs you, hue and shape only for
trouble, one accent, data first, product-grade craft, both themes equally finished. I read no code.
The owner has not picked a design direction yet, so §5 is still the yardstick.

**Nothing visible has changed since round 20.** The only commits since then are reviews, a triage
and the morning report (the run stopped on no-progress, PROGRESS "Morning"). My fresh shots match
the round-20 frames, apart from the live demo state. So this review does not repeat round 20
item by item. It (1) confirms what still shows, under the open task that covers it, (2) adds the few
things round 20 did not name, and (3) suggests an order for the bug tasks, so that the next builder
rounds fix what the owner sees first.

Screenshots judged (all in `$RUN_DIR/shots/`):
- `r25-designer/views/{map,runs,board,inbox,morning}-{dark,light}-{1440,390}.png` and
  `r25-designer/page/custom-{dark,light}-{1440,390}.png` (`#/runs?run=acme-search`). I took them this
  round with `loop/shoot.mjs` on the demo fleet (`demo-fleet.mjs --port 7825`), branch head `cd9af42`.
- `r22-T7/morning-*`: the builder's T7 shots. They match `r25-designer/views/morning-*`.

The demo is live, so tile counts, lane states, the tile pulse phase and BC's up/down state change
between frames.

## console.txt, every line

- `r25-designer/views/console.txt`: empty (shoot.mjs reported "0 console/page errors").
- `r25-designer/page/console.txt`: empty ("0 console/page errors").
- `r22-T7/console.txt`: empty (0 bytes).

There is no page error anywhere.

## New this round (not in round 20 or an open task)

1. **The DOWN alarm tile changes hue between frames: red in some, blue in others.** Light:
   `morning-light-390` and `page/custom-light-1440` show DOWN in **red**, while `board-light-1440` and
   `runs-light-390` show DOWN in **blue**. The count is 2 in the first and third frames, so the count
   does not explain it. Dark shows it blue in every frame I have. A tile that alternates between the
   "broken" hue and a hue that means nothing in §5 reads as two different states. It is also the
   loudest thing on the screen. Fix: one hue per state across every phase. Down is trouble, so red,
   and if it pulses, pulse the fill's lightness, not its hue. This joins T31 (down builder is blue in
   the sidebar) and owner idea (a) of round 4 (tiles use blue). One rule settles all three: **no blue
   in the tiles or the sidebar**.
2. **The top bar says `$0.000 today` on every view while the run cost $9.98.** This is the same
   contradiction as T32 (Morning strip), only in the header, so every screen shows it. Fix: make
   T32's rule cover the header too. Either run spend counts, or the label names what it counts
   (`sessions $0.000`). Also use 2 decimals for dollars: `$0.000` beside `$9.98` and `$1.44` looks
   like two currencies.
3. **The run page's SESSIONS column is `—` in all 7 rows** (`page/custom-*-1440`). The column header,
   its 170 px and seven dashes carry no data. Fix: hide a column when no row has a value. This fits
   T27 (narrow the minor columns) and T22 (drop minor columns at 390).
4. **Morning's window line shows seconds: `since 20/10/2026, 18:00:00`.** A digest window does not
   need seconds. In the 390 frames the line takes a row of its own under the 12 h / tonight / 24 h /
   7 d tabs. Fix: `since Tue 18:00` (or `since 20 Oct 18:00`), short enough to stay on the tab row at
   390.
5. **The Morning run title is a heavy full-width underline in both themes** (`morning-*-1440`: the
   goal is underlined over 650 px, and at 390 over two lines). No other link on Morning or the Runs
   list is drawn this way. The PR chip and the run page's `← Runs` use no underline. Fix: draw the
   title in the text colour with no underline, underline it on hover/focus, and add a small `↗` or
   `›` after it, as the Inbox rows do.

## Still showing, by open task

- **T32**: the Morning strip says `FINISHED 0`, `SPEND $0.000` above the $9.98 run (all `morning-*`).
- **T33**: three ~95 px `No answer` builder blocks, and four empty sections drawn in full with stats
  rows of `—` and `0`. At 390 the empty Morning sections run under the bottom sheet.
- **T35**: cyan diamonds for `No answer` (Morning) and the PR row (Inbox) in both themes.
- **T36**: `STOPPED: BUDGET` is a filled chip in dark and bare text in light.
- **T37**: the stray strip divider after `SPEND` at 390; the legend's frame line runs behind
  `BA · BUILDER-A [0]`; the end circle on each block frame; at 1440 the run row stops at ~1370 px and
  the blocks span 2000 px.
- **T34**: Inbox 390 cuts the run need to `decision: Keep the o…`, and the PR to
  `pr: Paged search (agent lo…`.
- **T28**: the run page's open need still ends in a grey underlined `open`. The Inbox shows the
  same need with an `ACK` button.
- **T27**: the run page at 1440 spreads over ~1650 px. The sparklines end at x≈730 and their values
  sit 60-90 px further right. COST, DURATION and SESSIONS sit 800+ px from ROLE. The minimap overlaps
  the ARTIFACTS row's bottom rule.
- **T30**: `5h ▬ 92%` is amber on the stopped run (Runs list 390, run page 1440).
- **T29**: `▲ 1` stands on its own line above the decision at 390.
- **T25**: `budget      $9.98` is spaced like a two-column table at 390.
- **T31**: the light sidebar shows BC down as a blue diamond (`board-light-1440`, header chip and
  sidebar). See new item 1.
- **T16**: Board cards cut status words and titles (`PE`, `QU`, `docs refre`, `release no`), and
  the age glyph still reads `4π`.
- **T17**: `NEEDS YOU 0 / Nothing waiting.` sits next to a red PERM DANGER card and two PERM/QUES
  lanes.
- **T20**: the desktop status bar says `no events yet` on every view, while the phone line shows
  `BA/search api working`.
- **T14**: light tiles in the faded phase (CONF on light grey) are borderline. The amber tiles with
  white text in light (`NEED`, `APPR`, `STCK`, `CI-F`) are close to 3:1, not 4.5:1.
- Owner idea (e) of round 4: Board lane cards still carry green, purple, lavender and pink left
  bars on calm lanes (`board-light-1440`), the most visible break of "hue only for trouble" on
  the Board.
- Owner idea (b) of round 4: the minimap floats over every view at 1440. It covers the run page's
  ARTIFACTS row.

## Suggested order for the next builder rounds (worst first, by what the owner sees)

1. **T32, plus new item 2**: wrong numbers at the top of Morning and in the header on every screen.
   Data first is the rule they break, and a wrong number costs more trust than any looks issue.
2. **T33 + T35**: on Morning, the empty and cyan builder blocks take more room than the run.
   Fixing both turns Morning from a form of zeros into a digest.
3. **T31 + new item 1**: one hue for "down" everywhere (tiles, sidebar, Morning).
4. **T28 + T34**: the one item that needs a written answer must be readable and actionable on
   every surface.
5. **T27 + T22 + new item 3**: the run page measure and columns.
6. The rest (T36, T37, T30, T29, T25, T16, T17, T20, T14): each is small. Several are a single
   CSS rule.

## For triage (suggested new tasks)

1. The DOWN tile's hue changes between frames (red ↔ blue). Use one trouble hue in every pulse
   phase, in both themes. New 1, joins T31.
2. The header's `$0.000 today` ignores run cost, and dollars show 3 decimals. Extend T32 to the
   header, and use 2 decimals for dollar amounts. New 2.
3. Hide all-empty table columns on the run page (SESSIONS). New 3, could fold into T27.
4. The Morning window line: a short date without seconds, on the tab row at 390. New 4, could fold
   into T37.
5. The Morning run title is a full-width underline. Draw it as plain text with a hover underline
   and an arrow glyph. New 5, could fold into T37.
