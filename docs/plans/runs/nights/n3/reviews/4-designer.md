# Designer review, run runs-n3, round 4

Judged against README §5 (grey unless something needs you, hue and shape only for trouble, one
accent, data first, product-grade craft, both themes equally finished). No `docs/design.md` exists
yet (the design pick is still on the owner list), so §5 is the yardstick. Looks only, no code read.

Shots judged:
- `$RUN_DIR/shots/r3-T1b/{drift,reach}/map-{dark,light}-{1440,390}.png`, `r3-T1b/plain/map-dark-1440.png`
  (round 3, newest). `r3-T1/` shows the same frames one minute earlier; nothing differs, so it is not
  reviewed separately.
- `$RUN_DIR/shots/r4-designer/{runs,board,inbox}-{dark,light}-{1440,390}.png`, taken this round with
  `loop/shoot.mjs` on the demo fleet (default design, no `--design`), because no Runs, Board or Inbox
  shots existed for night 3.

The demo is live, so lane states, tile counts and the core node's colour change between frames. The
findings below are the ones that show in more than one frame or in every frame of a kind.

## Cross-cutting (every view), worst first

1. **The phone tab bar marks MAP active on every view.** `board-dark-390`, `inbox-dark-390` and
   `runs-light-390` all show the MAP tab filled with the accent tint while the page is Board, Inbox or
   Runs. The one navigation cue on a phone gives the wrong answer. Fix: the bottom bar takes the active
   state from the route like the desktop tabs do (the desktop RUNS/INBX/BRD tab is right in every shot).
   Views with no tab of their own (Runs, Board) show no tab as active, or the `…` button as active.
2. **Light theme: the alarm tiles drop to about 1.5:1 contrast.** In `inbox-light-1440`,
   `runs-light-390`, `map-light-390` (drift and reach) the NEED/APPR/STCK/CI-F tiles are pale beige
   and DOWN/BUDG pale blue with **white** text: the labels and counts can hardly be read. In other light
   frames (`board-light-1440`, `map-light-1440`) the same tiles are solid with readable text. The tiles
   look like they pulse between a solid and a faded fill, and the faded phase fails contrast in light.
   Fix: in the light theme the faded phase keeps dark text (or the tile pulses its border, not its
   fill); either way, text on every tile phase meets 4.5:1 in both themes. The lane chip squares in the
   sidebar (`inbox-light-1440`: the ALL/BB squares are pastel pink) fade the same way.
3. **The alarm tiles are the loudest thing on every screen, and in more hues than §5 allows.** Seven
   filled blocks in yellow, red, blue (and a red DOWN in some frames, a blue DOWN in others:
   `inbox-dark-390` DOWN 2 is red, `map-dark-390` reach DOWN 2 is blue). In the saturated phase
   (`board-dark-390`, `map-dark-390` reach) they are full yellow/cyan/red slabs. §5 says hue only for
   trouble and one accent; blue is neither, and DOWN changing hue between frames for the same count
   reads as a bug. Fix: grey tiles with a coloured count or a 3 px left bar in the trouble hue; one
   hue per severity (red = blocks you, amber = wants you), no blue; a tile with 0 stays grey like CONF.
4. **The minimap floats over every non-Map view.** Board, Inbox and Runs at 1440 carry a 330 px
   minimap square in the bottom-right corner (both themes). On Runs and Inbox it is the largest object
   on the page and says nothing about the view; on Board it will cover cards as soon as the grid grows
   past three rows. Fix: show the minimap only on the Map, or collapse it to a small button elsewhere.
5. **The status bar says "no events yet" on every desktop view** (bottom left, both themes) while the
   phone status line in the same minute shows live events ("BA/search api working"). Either the
   desktop line is not wired or it is an empty state that does not say what to do. Fix: show the last
   event like the phone does, or hide the line until there is one.

## Map: Drift overlay (`r3-T1b/drift/*`), worst first

1. **The undeclared node is drawn in the accent orange.** SCRATCH (seen, not declared) gets an orange
   ring in both themes, the same orange as the active tab underline and the selection brackets. §5: one
   accent, and trouble gets the trouble hue plus a shape. Fix: the undeclared node gets the amber
   "wants you" hue and a distinct shape (e.g. a dashed square or a `?` notch), not the accent.
2. **The HUD counts have no key.** "NOT SEEN 1 · NOT DECLARED 1" (1440) does not say which mark is
   which; nothing on the Map labels the dashed yellow ring (BACKUP) or the orange ring (SCRATCH). Fix:
   put the mark in front of each count in the HUD (dashed ring before NOT SEEN, the undeclared mark
   before NOT DECLARED), the way the lane rail puts a shape before each lane.
3. **The overlay disappears at 390.** The phone HUD is "Z 1.00× · N 22/24 · 08:38:03Z": no OVL, no
   counts, so a phone user cannot tell that Drift is on, and the two rings are the only hint. Fix: keep
   "DRIFT 1/1" (or the overlay name) in the phone HUD; drop the clock first if space is short.
4. **BACKUP's label touches its own ring** (1440, both themes: the "P" sits on the dashed circle). Fix:
   label offset from the outer ring radius, not the node centre, plus 4 px.
5. **Light theme: the dashed amber ring and the lane labels (feat-search, fix-login) are low
   contrast** on the light grey canvas (`drift/map-light-1440`): amber text on #e8e9eb is about 2.5:1.
   Fix: the light theme's amber for text is darker (the light board's "ctx 71%" amber is readable,
   use that one).

## Map: Reach overlay (`r3-T1b/reach/*`), worst first

1. **The reach links cannot be told from the topology edges.** Nine grant arcs fan out of CI in the
   same thin grey, same weight, as the parent edges; only a few are dashed. With the overlay on, the
   picture is "more lines", not "who can reach whom". Fix: reach arcs one step heavier and in the
   accent (this is the selected overlay, so the accent is allowed), the topology edges dimmed to 40 %
   while Reach is on; dashed for one-way grants, solid for both ways, with that key in the HUD next to
   "LINKS 9".
2. **Same phone HUD gap as Drift**: no OVL REACH and no link count at 390.
3. **Large unexplained rings appear** around feat-search, BUILDER-C (`BC` node) and the empty ring at
   right (1440 dark, about 1600,870 in the shot): they look like hit areas or pulse halos frozen mid-
   animation. If they are the attention pulse, they are fine in motion but the shot catches them at full
   size; if they are reach endpoints they need a key. Fix: confirm what they are; if pulse, keep its
   peak radius inside the label box.

## Map: both overlays and the plain Map, worst first

1. **Duplicate labels.** BUILDER-A, BUILDER-B and BUILDER-C each appear twice (a host node and a lane
   group node, a few px apart). At 390 the second BUILDER-B is clipped at the right edge
   ("BUILDER-") and its label covers the BB node icon. Fix: label the lane group by its lane code (BA,
   BB, BC are already inside the square) and keep the hostname on the host only; at 390 flip labels
   left of the node when they would cross the edge.
2. **DEMO-HOST's label runs into HV1** at 390 (both themes, "DEMO-HOST" ends inside HV1's ring). Fix:
   the core label goes above the core, not on the right, at narrow widths.
3. **The phone Map wastes a third of the height.** At 390 the graph is a 370 px circle in a 1500 px
   tall canvas: empty band above (y 280-580) and below (y 1620-1770). Fix: fit to the shorter axis with
   padding, or allow fit-to-height zoom so the rings fill the canvas.
4. **Mixed case labels.** Hosts are uppercase condensed (REPOS, SCRATCH), lane and site labels are
   lowercase mono (acme, feat-search). If the case carries meaning (kind), say so in the legend;
   otherwise one case for node labels.
5. **"+2" badge sits on top of feat-search's node** (both themes, 1440 and 390). Fix: badge outside
   the node ring, at 45°, with 2 px gap.

## Board (`r4-designer/board-*`), worst first

1. **Coloured left borders on calm lanes.** Lane cards carry green, purple, lavender and pink left bars
   (dark and light) on lanes that are WORK or IDLE. That is hue without trouble, against §5 rule 1.
   Fix: the left bar is grey for every lane and takes the trouble hue only for the lane's worst state
   (the red frame on "cleanup job" already does that, so the bars may simply go).
2. **Clipped text without an ellipsis.** "PE", "QU" (status words in nested rows), "docs refre",
   "release no", "⌥feat-", "⌥ci-re", and at 390 a nested title cut to one letter ("PERM s"). Fix:
   status words never shrink (fixed min-width), titles take `text-overflow: ellipsis`, the branch chip
   drops first.
3. **Rows of dashes.** Each card's second line is "– – ctx 43% – – ⌥branch": four placeholder dashes
   for empty fields, the most ink on a calm card. Fix: omit empty fields; show `ctx` and branch only.
4. **"NEEDS YOU 0 / Nothing waiting." next to two PERM cards and a DANGER card.** The left column says
   nothing needs you while the grid shows three lanes waiting on a yes/no. Whatever the data reason,
   the page contradicts itself. Fix: either count PERM/QUES lanes in "Needs you" or rename the block to
   what it counts.
5. **Ragged card heights and a 200 px empty band** inside "cleanup job" (1440), and a 330 px gap
   between the left column (ends ~x 500) and the grid (starts ~x 633). Fix: cards in a row share a
   height with content top-aligned; the grid starts on the 4 px grid right after the column's gutter.
6. **Age glyph renders as "3π"/"4π"** (top right of cards, 1440 both themes) where 390 shows "4m".
   Fix: check the font fallback for the minute glyph at that size; use plain "m".

## Inbox (`r4-designer/inbox-*`), worst first

1. **Empty states do not say what to do** (§5 "empty states that say what to do"): "Nothing here." twice.
   "No lanes are waiting for review." is better but still has no next step. Fix: one line each, e.g.
   "Lanes you pause show up here (p on the Board)."
2. **The approval's timer "59:36" has no label or unit**; read cold it could be a clock. Fix: "expires
   59:36" in the muted text style, or a thin countdown bar under the row.
3. **"COOPERATIVE CONTROL" dashed badge** is the only dashed-border element in the view and sits like a
   button. Fix: plain muted text, or a solid 1 px chip like the lane chips.
4. Light theme: the selected approval row's grey fill (#e3e4e6 on #f3f4f6) is barely visible. Fix: one
   surface step darker, matching the dark theme's step.

## Runs (`r4-designer/runs-*`)

1. **The view is a one-line note in a box over an empty page** ("a hub does not collect runs yet"), in
   both themes and widths: no icon, no next step, and the minimap fills the corner (1440). T2 replaces
   this with a recorded run, so the content will change; the empty state itself stays for real hubs.
   Fix for that state: say what to do ("Open the Runs view on a builder, or see docs/runs.md"), in body
   text, not mono.

## Design directions

`docs/plans/runs/design/` holds three token files (refined, product, night) but no screenshots, and the
shots above are all on the default tokens. There is nothing to compare visually this round. The owner
can see them with `node test/tools/demo-fleet.mjs --design <name>`; a later round could shoot the three
with `shoot.mjs` so the owner has pictures to pick from. Note that findings 2-3 (tile pulse and tile
hues), Board 1 (lane hues) and Drift 1 (accent as trouble) are rule changes, not token changes: no
direction fixes them by itself.

## console.txt (every line)

- `r3-T1/drift/console.txt`: empty (0 lines).
- `r3-T1/reach/console.txt`: empty (0 lines).
- `r3-T1b/drift/console.txt`: empty (0 lines).
- `r3-T1b/plain/console.txt`: empty (0 lines).
- `r3-T1b/reach/console.txt`: empty (0 lines).
- `r4-designer/console.txt`: empty (0 lines); `shoot.mjs` reported "0 console/page errors".

No page errors in any view.
