# Review, round 20, operator (three metres away, coffee in hand)

Night 5, after T6 (1cca98f, system room). The Wall hangs across the room. I glance at it for three seconds. All files
are in `$RUN_DIR/shots/`. All films use the large demo on :7795, which serves this checkout. They run at cpu 4x under
the SwiftShader wrapper, 2736x1824.
- `r19-galaxy/sheet.png`: `galaxy.html?demo=1`, 12 frames over 33 s. Filmed after T6's commit, so it is current.
- `r20-galaxy-dense/sheet.png` (mine): the same at `?demo=1`, 24 frames every 1.25 s. In r19 I could not tell when the
  plate leaves.
- `r20-galaxy-real/sheet.png` (mine): `galaxy.html` with **no** `demo`, 16 frames over 82 s. The demo has a 1.75 s hold
  and no trouble revisits (`tour.js DEMO_TIMING`). It is not what hangs on my wall, and pacing is my question.
- `r20-fx-<name>/sheet.png` (mine): `galaxy.html?demo=1&fx=<name>`. The r15 fx films came before T4-T6.
- `r19-t6-*`: stills at 1368 px (`?at=overview`, `?at=lab&open=1`, `?at=hv2&open=1`).
- `r10-touch/sheet.png`: the newest touch walk. `touch.js` and `director.js` have not changed since a5cc510, so it is
  still valid. T11-T16 (the night's touch work) are not built.
- `r20-3m.png` (r19 frame 12, the overview with 2 crit) and `r20-3m-calm.png` (the `?at=overview` still). Both are
  shrunk to 684 px.

## galaxy

1. **The down builder is not on the map, and the lock frames a yellow thing.** `r20-galaxy-real` frame 5 (22.2 s): the
   plate says `■ VM-C · BUILDER-C NO CONTACT · 1 DOWN`. The red lock on the map closes round a planet that glows
   **yellow** (an attention lane by `fix-login`/`ci-retry`). There is no red body anywhere in the system. The fleet line
   says `114 NODES`, down from 115 at 0.4 s, so the down member seems to have left the tree. `r20-galaxy-dense` frame 22
   (36.1 s) is the same: red pips sit at the lock, but the only name in red is `bc`. From the sofa, the one red thing in
   the system should be the thing that is down. Here the red words point at yellow. Fix: a member that goes down stays
   in the scene as a red body (night 4's T29, "a down member keeps its red at every step and age", now raised). The lock
   frames that body. If the model really drops it, `live.js` keeps a ghost of it in red until it comes back.
2. **Three names for one thing.** The same frame has the headline `VM-C`, the sentence `BUILDER-C NO CONTACT` and the
   map label `bc`. At 3 m I read the headline, then look for `VM-C` on the map and do not find it. Fix: while the plate
   stands, the locked member's map label is the plate's headline, in the plate's hue (r10 #5, in `## Later`, raised).
   The sentence names the same thing, or drops the name and says `NO CONTACT FOR …`.
3. **A number on the plate stands still while the clock runs.** `r20-galaxy-real` frames 3, 4 and 5 (11.3 s, 16.8 s,
   22.2 s) all say `NO CONTACT FOR 15S`. The banner in the fx films counts up (27S, 34S, 37S, 39S in `r20-fx-beacon`).
   A count that stops reads as "it just happened" when it is already 27 s old. Fix: the plate's age ticks like the
   banner's, without retyping the line (night 4's T30, no blank on update). Or say `SINCE 22:36`, which never needs a tick.
4. **During the crit hold the banner names a paper jam.** `r20-galaxy-real` frame 5: the plate is red (`VM-C DOWN`).
   Bottom right, big, it says `▲ REMOTE · OFFICE-PRINTER · PAPER JAM, NEEDS A PERSON`. Frames 3 and 4 of the same hold
   have no banner at all. So the bottom-right corner is first empty, then a lesser yellow headline. If I glance up just
   then, the two loudest words on screen disagree on what matters. Fix: in a hold, the banner drops to its one line
   (T23). It shows the next trouble only with a `NEXT` kicker, small, never at the size of the plate's headline. It
   never stays empty while trouble stands (night 4's T55).
5. **The tour gives a printer as long as a down builder.** `r20-galaxy-real`: `VM-C` (down) holds about 14 s (11-25 s),
   `OFFICE-PRINTER` (attention) about 16 s (27-41 s), `API-PROD` (warn) about 16 s (43-57 s). Then come two calm sites
   and the overview. Every trouble site gets `troubleHoldMs` 14 s whatever its severity. Fix (`tour.js` is fenced, so this
   is a patch for the cockpit): the hold scales with severity, about 14 s for crit/down and 8 s for warn/attention.
   While a crit stands, it is revisited after every other site, not only after two calm ones.
6. **The demo film is not the wall.** `?demo=1` has no `troubleHoldMs` and no `revisitEvery`. Its plate is up about
   1.5 s of a 1.75 s hold. So `r19-galaxy` frames 4 and 8 (9.3 s, 20.9 s) show HV1, crit at 20.9 s, as a small cluster
   in the right third. It has no plate, no system name, and two thirds of the screen are empty. At real speed this is
   only the fold before departure. But every panel score so far came from the demo film, me included until I filmed
   real speed. Fix: `DEMO_TIMING` keeps the real ratios (trouble hold ≈ 2.3x calm, `revisitEvery: 2`). While no plate
   stands, the held shot recentres on the star; `kept` stays wide only while a plate is on screen.
7. **The banner's subject flips between equal troubles.** `r20-galaxy-dense`: `HV1 · FIX-LOGIN` (2.2 s), then
   `HV1 · FEAT-SEARCH` (5.6 s), `FIX-LOGIN` (25.7 s), `FEAT-SEARCH` (29.2 s). Nothing changed in the fleet. From across the
   room, a new headline means new trouble. Fix: among equal severity, the oldest stays the subject until it clears
   (night 4's T28, one ranking). The `+N MORE` count changes; the headline does not.
8. **At the overview the crit is still smaller than the warn.** `r20-3m.png`: HV2's red is a thin smear above its label.
   REMOTE's yellow cloud is about the same size, and HV1's red only wins because it rings the star. In `r20-3m-calm.png`
   CLOUD's warn label is a dark ochre, much dimmer than REMOTE's and HV1's yellow. Haze or depth is eating a status hue.
   Fix: T26 as written (crit nebula ≥ 1.5x warn). Status-hued labels take no depth fade, like the materials T4 exempted.
9. **Planet names in the hold are desk type.** `r19-t6-galaxy_html_at_lab_open_1`: `registry`, `dns`, `monitor` and the
   lane names are mono at about 11 css px. From 3 m only the plate, the banner and `HV1` read. That is fine for calm
   names. It is not fine for the yellow lane names, which are the only map text that says what is wrong besides the plate.
   Fix: trouble members' names a step larger and in the condensed face. Calm names stay small.
10. **Wake says nothing.** `r10-touch` frame 01 (300 ms after the touch): no control, no `MANUAL` line, still the
    tour's frame. When I walk up and touch it, I want to see that it heard me. Fix: night 4's T62 (manual line and
    `‹ BACK` within 200 ms).

What works for me, because it fixes nothing: within 3.5 s of `VM-C` going down in `r20-galaxy-dense` (32.6 s), the
camera left CLOUD and was on HV1 (36.1 s). The real-speed film shows the same trouble first (target 01 is the down
builder).

## fx (`r20-fx-<name>`, after T6)

- **beacon** (33.1 fps, worst 191 ms). Frame 1 (0.6 s): a red pillar rises from HV1 toward the sun. At the overview
  this is the best "where" any fx gives me, and it left with the crit (frame 9, 24.1 s). It also reads as a red
  hyperlane to DEMO-HOST, a red line with no name (night 4's T26). Fix: straight up, about a cluster's diameter, with a
  tick and the crit's age at the top (r10 and r15 said the same).
- **warp** (33.5 fps, worst 220 ms). Frames 3 and 7 (6.5 s to crit HV2, 18.2 s to CLOUD): I see no streaks in either
  flight. It tells me nothing at a glance. Drop it, or keep it only on a flight to a crit, with the target's name in
  the streak's colour.
- **afterglow** (33.6 fps, worst 267 ms). Nothing cleared in the 33 s, so nothing showed. I cannot judge it. It needs
  a demo hook that clears a site at a known second (r10 and r15 asked too).
- **activity** (32.8 fps, worst 177 ms). Frame 1 (0.5 s): a grey ring circles CLOUD (calm) at the overview, the same
  shape as a target lock. Frame 10 (26.8 s): rings sit inside the red lock on HV2's `storage`. Calm things wearing
  selection shapes pull my eye off the trouble. Fix: rings at `--text-3` alpha, never inside a lock or on a trouble
  member, or drop it.
- **sweep** (32.1 fps, worst 286 ms). Frame 9 (24.0 s): a radar wedge from the sun points at CLOUD (calm), and closed
  ellipses ring REMOTE and HV1. The wedge says "look here" about a calm site, and the ellipses read as selections.
  Fix: the sweep pings only trouble, as short dash arcs fading in about 1 s (r10's note).

## Across the variants

- Steal from `fx=beacon`: one vertical mark above a crit, visible from any camera, at the overview. It answers "where"
  faster than any nebula, and it went away when the crit cleared.
- Steal from the real-speed tour's plate (`r20-galaxy-real` frames 3-5): `1 DOWN · 3 ATTENTION · 1 WARN` in big condensed
  caps, each in its hue and shape. Use it as the overview banner's second line, in place of `+4 MORE`.

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 5
score galaxy touch 5
score galaxy wow 6
score galaxy calm 6
score galaxy performance 7
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 3
score fx-warp calm 7
score fx-afterglow wow 2
score fx-afterglow calm 7
score fx-activity wow 3
score fx-activity calm 3
score fx-sweep wow 4
score fx-sweep calm 5

Status drops to 5 because of #1-#4: the plate's red points at a yellow body, under three names, with a stale age and a
yellow banner beside it. Touch is scored on `r10-touch` (tap site, held, tap planet, Back ×2, overview: it works, but
it is silent on wake, and the night's drag-turn and moons are not built yet). Performance comes from `perf.json`:
30.6-39.5 fps at cpu 4x under SwiftShader, worst gap 177-286 ms. That measures this VM, not the tablet.

## The 3 m check

`r20-3m.png` (r19 frame 12, overview with 2 crit, at 684 px): **yes.** Two red ■ marks with `HV2` and `HV1` in red,
and `2 CRIT · HV2 · HV1` across the bottom. I know something is wrong and where. `HOME`, `CLOUD`, `REMOTE` and
`DEMO-HOST` read, at about 13 px. The banner's second line (`STORAGE · POOL 97% FULL`) just reads; `+5 MORE` and the
tag do not, which is fine. The weak spot: HV2's red cloud is thinner than REMOTE's yellow one, so without the ■ glyphs
the crit would not win (#8). `r20-3m-calm.png` (warn only): yes for "something", but `▲ CLOUD`'s dim ochre label
nearly drops out next to `REMOTE` and `HV1`.

## Console

- `r19-galaxy/console.txt`: empty (0 lines).
- `r19-t6-galaxy_html_at_overview/console.txt`: empty.
- `r19-t6-galaxy_html_at_lab_open_1/console.txt`: empty.
- `r19-t6-galaxy_html_at_hv2_open_1/console.txt`: empty.
- `r20-galaxy-dense/console.txt`: empty.
- `r20-galaxy-real/console.txt`: empty.
- `r20-fx-beacon/console.txt`, `r20-fx-warp/console.txt`, `r20-fx-afterglow/console.txt`, `r20-fx-activity/console.txt`,
  `r20-fx-sweep/console.txt`: empty, each.
- `r10-touch/console.txt`: empty.
