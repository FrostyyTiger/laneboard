# Designer review, run runs-n3, round 30

I judged the screens against README §5 only: grey unless something needs you, hue and shape only for
trouble, one accent, data first, product-grade craft, both themes equally finished. I read no code.
The owner has not picked a design direction yet, so §5 is still the yardstick. No new directions were
shot since round 11, so I make no comparison here (see `11-designer.md`).

**Nothing visible has changed since round 25.** The commits since then are T7's tick, T8 (run stuck
rules; the demo's run is stopped, so no stuck badge shows) and T9 (run nodes on the Map, server side;
the demo is a hub, so no run node shows). My shots match the round-25 frames, apart from the live demo
state. This review (1) lists every line of each `console.txt`, (2) adds the three things earlier rounds
did not name, (3) confirms in one list what still shows under the open task that covers it, and (4)
gives two notes for T10, the next UI task that adds something new to look at.

Screenshots judged (all in `$RUN_DIR/shots/`):
- `r30-designer/views/{map,runs,board,inbox,morning}-{dark,light}-{1440,390}.png` and
  `r30-designer/page/custom-{dark,light}-{1440,390}.png` (`#/runs?run=acme-search`). I took them this
  round with `loop/shoot.mjs` on the demo fleet (`demo-fleet.mjs --port 7795`), branch head `752ccd2`.
- `r27-T7/morning-{dark,light}-{1440,390}.png`: the T7 re-check shots. They match
  `r30-designer/views/morning-*`.

The demo is live, so tile counts (DOWN 1 or 2), lane states, the tile pulse phase and BC's up/down
state change between frames. I count none of that as a finding.

## console.txt, every line

- `r30-designer/views/console.txt`: empty (shoot.mjs reported "0 console/page errors").
- `r30-designer/page/console.txt`: empty ("0 console/page errors").
- `r27-T7/console.txt`: empty.

There is no page error anywhere.

## New this round (worst first)

1. **The same builder gets a different worst-state mark at 1440 and at 390.** At 390 the phone scope
   chips show BA as a **red square** in every frame (`runs-light-390`, `inbox-dark-390`,
   `map-light-390`, `page/custom-light-390`). At 1440 the sidebar shows BA as an **amber triangle**
   (`runs-dark-1440`, `board-light-1440`, `map-dark-1440`), in the same seconds, with the same lanes
   (BA has a PERM lane, `feat-search`, and a QUES lane, `fix-login`). One of the two is wrong. A
   control room that says "needs you" in one place and "blocked" in another for the same machine
   loses trust in both. Fix: one rule for the builder mark everywhere (worst lane state wins, so red
   while BA has a PERM lane), shared by the sidebar row and the phone chip. A test feeds one builder a
   PERM lane and a QUES lane to both and expects the same mark.
2. **Runs list at 1440: the goal is cut at about 420 px while about 580 px stays empty in the same
   row.** `runs-dark-1440`: "Add paged search to acme-api and the web …" ends at x≈900, then the
   numbers, then a gap of ~200 px between `34%` and `budget`, and another ~150 px before `$9.98`. Data
   first means the goal gets the space before the empty columns do. Fix: the goal column is the one
   flexible column (`minmax(0, 1fr)`), the numeric cells take their content width; with T25 (budget
   label next to its value) the full goal fits at 1440. Keep the full goal as `title` when it still
   clips.
3. **The run page at 1440 ends under the minimap.** `page/custom-dark-1440`: the run frame's bottom
   edge and right border run behind the minimap at x≈1650-1985, so the frame looks unfinished, with
   no corner. The page pads by `--pip-clear` (T3), but the frame is drawn full width. Fix: cap the
   run page at a reading width (T27, ~1000 px) and the frame ends well left of the minimap; until
   then, the frame takes the same right inset as the padding. Joins T27; owner idea (b) (minimap) stays
   the owner's call.

## Still showing (covered by open tasks, not repeated in detail)

- **T14** light contrast: in a light pulse phase the alarm tiles go pastel with white text
  (`page/custom-light-390`, `map-light-390`, `morning-light-1440`: NEED, APPR, BLKD, DOWN, BUDG
  unreadable), and the sidebar marks fade with them (ALL, BB pale pink, BA pale amber in
  `morning-light-1440`).
- **T16** Board: age `4π` (`board-light-1440`, two cards), "PE" and "QU" nested status words,
  "docs refre", "release no", branches cut without ellipsis ("⌥feat-", "⌥ci-re").
- **T17** Board: "NEEDS YOU 0 / Nothing waiting." above a red PERM card with DANGER and a PERM nest.
- **T18** Map labels: at 390 BUILDER-B is cut at the right edge ("BUILDER-"), VM-B's label sits on the
  BB node, DEMO-HOST's label runs into HV1; at 1440 the "+2" badge sits on feat-search's ring.
- **T19** phone Map HUD: no overlay name or count (`map-light-390`: "Z 1.00× · N 22/24 · clock").
- **T20** desktop status bar: "no events yet" on every view at 1440 while the phone line says
  "BA/search api idle".
- **T22, T26** run page at 390: COST cut to "$1.4" and the column header to "COS", DURATION and
  SESSIONS gone off the edge with no scroll sign; sparklines use the left half only; the goal clipped
  to "Add paged search to acme-api and the…".
- **T23** phone: the run page's ARTIFACTS heading is cut under the sheet (`page/custom-light-390`).
- **T25** Runs list 1440: `budget` stands 150 px from `$9.98` (see new 2).
- **T27** run page 1440: spread over ~1650 px, sparklines ~220 px with the value 100 px past them,
  COMMIT and COST 300-400 px apart.
- **T28** run page: the open need's action is a grey underlined "open", no ACK button.
- **T29** Runs list 390: `▲ 1` on its own line above the decision.
- **T30** 5h bar and `92%` amber on a stopped run (list and page, both themes).
- **T31, T38** BC down: blue diamond in the light sidebar and the header chip (`board-light-1440`),
  red hatched square in the next frame (`morning-light-1440`, `page/custom-dark-1440`); DOWN tile
  blue in both themes.
- **T32, T39** `$0.000 today` in the header and FINISHED 0 / SPEND $0.000 on Morning above a $9.98
  run.
- **T33** Morning: three ~95 px builder blocks that say "No answer" plus four empty sections take
  more height than the one run.
- **T34** Inbox 390: "decision: Keep the o…", "pr: Paged search (agent lo…".
- **T35** cyan diamonds: the Inbox PR row, the Morning "No answer" rows.
- **T36** Morning `STOPPED: BUDGET`: a filled chip in dark, bare text in light.
- **T37** Morning: the builder frame line runs behind the legend, a lone circle at its right end;
  the run row stops at ~1370 px while the blocks span 1990 px.
- **T40** run page: the SESSIONS column is `—` in all 7 rows.
- **T41** Morning: `since 20/10/2026, 18:00:00`.
- **T42** Morning: the run title is a full-width heavy underline.
- **T13** (blocked, fenced) phone bar: MAP is active on Runs, Inbox and the run page.

## For T10 (the run node's ring), before it is built

- **It needs something to draw on the demo.** The demo is a hub and shows no run node (T9's note),
  so T10's required shots would show an unchanged Map. The builder should make the demo's map carry
  the T2 run, then shoot the Map with a running run and a stuck run, not only the stopped one.
- **Keep the ring grey.** A running run that is fine is a grey arc on a grey track, as on HV1's and
  the VMs' rings now. The trouble hue only for stuck (amber, plus the triangle) or stopped on error
  (red, plus the square). A stopped-fine run is a hollow grey ring that fades out, never the accent
  orange (the accent marks selection only, as the sidebar brackets do). The run's label uses the
  machine labels' type (caps, same weight), with the round `7/10` in the mono data face beside it,
  and is offset from the ring's outer radius (the T18 rule), so it does not repeat the "+2" collision.

## Suggested order (unchanged from round 25, with the new item)

T32 + T39 (wrong spend numbers) → new 1 (one builder mark rule) → T17 (Needs-you count) → T14 + T38
(light contrast and the DOWN hue) → T28 (ACK) → T22 + T26 + T23 (run page on a phone) → the rest.
