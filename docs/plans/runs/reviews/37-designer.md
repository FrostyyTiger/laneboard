# Designer review, run runs-n3, round 37

I judged the screens against README §5 only: grey unless something needs you, hue and shape only for
trouble, one accent, data first, product-grade craft, both themes equally finished. I read no code.
The owner has not picked a design direction yet, so §5 is still the yardstick. No new directions were
shot since round 11, so there is nothing to compare (see `11-designer.md`).

**What is new since round 30:** T45 (the demo has three runs: acme-search stopped, acme-billing stuck,
acme-docs running), T10 (run nodes with a progress ring on the Map) and T11 (`⌘K` Find reaches Map
nodes, services and ports, Enter flies to the node). Everything else looks as it did in round 30.

Screenshots judged (all in `$RUN_DIR/shots/`):
- `r37-designer/views/{map,runs,board,inbox,morning}-{dark,light}-{1440,390}.png` and
  `r37-designer/page/custom-{dark,light}-{1440,390}.png` (`#/runs?run=acme-search`), taken this round
  with `loop/shoot.mjs` on the demo fleet (`demo-fleet.mjs --port 7837`), branch head `fca0f6a`.
- `r32-T45/*`: the Map, Runs and Inbox with three runs.
- `r33-T10/{,after/}map-*`, `r33-T10/sel/custom-*` (acme-billing selected), `r33-T10/sel-lane/`.
- `r34-T11/palette/pal-*`, `r34-T11/palette-after/pal-*` (palette with `n:` and `:8006`),
  `r34-T11/fly/custom-*` (after Enter on a node).

The demo is live: tile counts, lane states and pulse phase change between frames. Not counted.

## console.txt, every line

- `r37-designer/views/console.txt`: empty ("0 console/page errors").
- `r37-designer/page/console.txt`: empty.
- `r32-T45/console.txt`: empty.
- `r33-T10/console.txt`, `r33-T10/after/console.txt`, `r33-T10/sel/console.txt`,
  `r33-T10/sel-lane/console.txt`: empty.
- `r34-T11/fly/console.txt`, `r34-T11/palette-after/console.txt`: empty.
- `r34-T11/palette/console.txt`, one line: `pal-scratch-dark-1440	hash after Enter: #/?sel=node%3Afeed%3Ahv1%2F106`.
  This is a note the T11 builder logged (the hash Enter produced), not a page error. Nothing to fix
  from it on the look side; it does show that the hash is `#/?sel=…`, not `#/map?sel=…`, which is
  the T24 territory (routes the user can read).

There is no page error anywhere.

## Map with run nodes (T10), worst first

1. **Run labels sit on other nodes at 390 and read as one label.** `map-dark-390`, `map-light-390`:
   "VM-C ACME-BILLING 4/10" is one line, VM-C's label running straight into the run's; acme-billing's
   ring is ~100 px lower right, so the eye pins ACME-BILLING to VM-C's node. "ACME-DOCS 4/8" is printed
   under VM-A's label, ~120 px from its own ring. "ACME-SEARCH" runs into the ring legend "SITE · RUN".
   `deps-bump` (light 390) lies on top of BB's box. Fix: the run label follows the T18 rule (label beside
   its own node, no overlap with another label or legend; when it cannot fit, drop the label at this
   zoom and keep the ring, the name shows on tap). A test at 390 checks no two label boxes intersect.
   Joins T18.
2. **The fraction next to a run says rounds, the ring says tasks, and they disagree.** acme-billing
   prints `4/10` while its inspector says `RND 4 / 10`, `PROG 17 %` (`r33-T10/sel/custom-dark-1440`),
   and the ring is drawn at ~17 %. A reader takes `4/10` as the progress the ring shows (40 %). Fix:
   print what the ring draws (`17%` or `T 2/12` from the tasks score), or no number at all; rounds stay
   in the inspector.
3. **Run nodes are drawn and labelled like hosts.** ACME-SEARCH, ACME-DOCS, ACME-BILLING use the same
   heavy uppercase as DEMO-HOST, HV1, BUILDER-A (`map-dark-1440`), and their rings are 8-10 px, smaller
   than the host glyphs beside them. A run is work, like a lane; the lanes (`feat-search`, `fix-login`)
   use the mono lowercase. Fix: run labels in the lane style (mono, lowercase, regular weight, muted),
   ring at least 14 px at zoom 1 so the arc is readable without zooming.
4. **The fraction flips side.** `7/10 ACME-SEARCH` (fraction before) but `ACME-DOCS 4/8`,
   `ACME-BILLING 4/10` (after) in the same frame. Fix: one order, the number after the name, whichever
   side of the node the label goes.
5. **Unlabelled shapes on the outer ring.** `map-dark-1440`: an amber triangle at (1651, 706) and two
   diamonds at (1571, 352) and (1316, 1110) carry no label at zoom 1, while every other node has one.
   An amber triangle is trouble: it must say what it is. Fix: trouble nodes always get a label (T18
   rule: trouble labels win collisions); the calm diamonds may stay bare.
6. **"RUN" appears in three ring legends** ("LANE · RUN", "BUILDER · PKG · RUN", "SITE · RUN"), yet
   the three runs sit on one ring each by parent. The legend now tells nothing. Fix: name a ring by
   the kinds that are actually on it this frame, or drop "RUN" from the legends (runs are placed by
   their parent).
7. **Good, keep:** the stopped run (acme-search) is a hollow grey ring; only the stuck run gets amber
   plus a triangle; the inspector for a run (`sel/custom-dark-1440`) is the cleanest panel in the app
   (goal, RND, PROG, WHY, "Open run ›"). The orange leader line to the inspector is the one accent,
   used for selection only.

## Find palette (T11), worst first

1. **Every row ends in a lone dash with no meaning.** `pal-n_-dark-1440`, `pal-n_-light-390`: a `—`
   (a pill at 390) closes every row, in every row the same. A column with no value in any row is not
   drawn (the T40 rule). Fix: drop it, or put the node's state mark there (grey dot calm, trouble hue
   plus shape when the node needs you), which would make the list useful for triage too.
2. **Each row says "node" twice.** A map icon and a boxed `NODE` chip, both identical on all nine
   rows, take ~120 px before the name. Data first: keep one (the icon), let the name start at ~50 px.
   The chip helps only when kinds mix in one list; then show it in muted text, not a boxed chip.
3. **The match is not marked.** `pal-_8006-light-1440`: the query `:8006` matches in the meta
   (`site · :8006 · demo hypervisor`), but nothing shows which part matched. Fix: the matched run of
   characters in the text colour at full weight, the rest of the meta muted.
4. **At 390 the meta clips the wrong end.** `pal-n_-light-390`: `room · hv1 · :22 · …`,
   `room · hv1 · nightl…`, `site · :8006 · demo…`. The ellipsis after a separator shows nothing, and the
   port, the reason to search, is what survives only by luck. Fix: at 390 put the meta on a second
   line under the name (muted, small), or clip the free text first and never end on ` · …`.
5. **Case differs per row.** `REPOS` in caps among `demo-host`, `hv1`, `vm-a`; on the Map it is `REPOS`
   while `acme` is lowercase. Fix: show names as written in the source everywhere and the Map's
   uppercase as a style only, so the palette lists `repos`; or uppercase none in the palette.
6. **`n:` has no hint.** The field opens with `n:` and nothing that says it filters to nodes. Fix: a
   muted placeholder after the prefix ("node, service or :port") and the prefix as a removable chip.
7. **No sign that the list goes on.** Nine rows, then the panel ends (`pal-n_-dark-1440`): the run
   nodes and the lane nodes are not reachable without typing, and nothing says so. Fix: a muted last
   line "+N more, type to narrow".

## Fly-to after Find (T11)

1. **The selection brackets cut the label.** `r34-T11/fly/custom-light-390`: "BACKUP" reads "BACKUI",
   the right bracket lands on the P. Fix: the label is laid out outside the bracket box (bracket size
   plus 4 px), same as at 1440.
2. **At 390 the flown-to node has no panel.** Only a subtitle ("nightly backups") under the label; at
   1440 the inspector opens. Fix: open the bottom sheet at peek with the node's inspector, the same
   content as the desktop panel.
3. The ring legend "BUILDER · PKG · RUN" is cut by the HUD frame at the top (`fly/custom-light-390`,
   y≈225). Legends hide under the HUD box rather than over it.

## Runs list with three runs (T45)

1. **The stuck run is not called stuck on the Runs list.** acme-billing is `● RUNNING` plus an amber
   hourglass (`runs-dark-1440`, `r32-T45/runs-*`), while the Map's inspector says `▲ STCK` with the
   reason, and the header tile says STCK 1. Two shapes for one state, and the list hides the word and
   the why. Fix: the state column says `▲ STUCK` in the trouble hue, with the reason as the second
   line in place of `acme-billing · run/billing` (or as `title`); the same triangle as on the Map.
   Joins the T43 idea: one mark per state everywhere.
2. **Empty usage columns on running runs.** acme-billing and acme-docs show `5h ——— —  7d ——— —`:
   two empty bar tracks and two dashes per row. Fix: when a run reports no usage, the 5h/7d cells
   collapse to one muted `—` and the goal column takes the room (with T44).
3. **Columns do not align across rows.** `7 / 10` at x≈960 for the first row, `4 / 10` at ≈1080 and
   `4 / 8` at ≈1085 for the others: the rounds column moves with the goal's length. Fix: a real grid
   (fixed tracks for every numeric column, the goal as the one flexible track), numbers right-aligned
   with tabular figures.

## Still showing (covered by open tasks, not repeated in detail)

- T14 light alarm tiles pastel with white text (`map-light-390`: NEED, APPR, STCK, CI-F).
- T16 Board clipped text (`PE`, `QU`, `docs refre`) — visible behind the palette in `pal-*-1440`.
- T17 "NEEDS YOU 0 / Nothing waiting." beside PERM, QUES and DANGER lanes (`pal-_8006-light-1440`).
- T18/T19 Map label collisions and the phone HUD without the overlay.
- T20 "no events yet" in the desktop status bar on every view.
- T25, T44 Runs list `budget` label far from its value, goal cut at ~420 px.
- T31, T38, T43 builder mark: BC is a blue diamond in the light 1440 sidebar
  (`pal-_8006-light-1440`) and a grey dot elsewhere; BA amber triangle at 1440, red square at 390.
- T39 `$0.000 today` in the header beside runs that cost $9.98, $4.65 and $3.80.
- T22, T26-T28, T40 run page (rounds table at 390, goal cut, 1650 px spread, need not actionable,
  empty SESSIONS column) — unchanged in `r37-designer/page/*`.
- T32-T37, T41, T42 Morning — unchanged in `r37-designer/views/morning-*`.
- Owner idea (b): the minimap still floats over Runs and Board at 1440 (`runs-dark-1440`).

## Suggested tasks from this round

1. Run node labels: lane style, number = what the ring draws, number after the name, no overlap
   at 390 (Map 1-4; with T18).
2. Palette rows: drop the dash column and the duplicate NODE chip, mark the match, meta on a second
   line at 390 (Palette 1-4).
3. Runs list: a stuck run says `▲ STUCK` and why; aligned numeric columns (Runs 1, 3; with T43, T44).
4. Fly-to at 390: labels clear the brackets, the sheet opens with the inspector (Fly 1-2).
