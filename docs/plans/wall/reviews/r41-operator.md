# r41: operator

The persona: a homelab and a few agent builders, the Wall across the room, a glance while the coffee runs.
Three seconds, three metres: is anything wrong, what, where. Is the worst thing the loudest? Does the tour
bring me to trouble or make me wait?

Material (all on `galaxy.html`, `demo-fleet.mjs --size large`, SwiftShader, CPU 4x, after T16's commit bf40199):
- `r40-galaxy` (`?demo=1&quality=0`, after bf40199, used as is), stills `r40-overview` and `r40-hv2` (1368 css px
  at 2x, the 12-inch 3:2 tablet).
- New this round: `r41-pace-wall` (`?demo=1&pace=wall&quality=0`, the owner's speed), `r41-galaxy-beacon`
  (`&fx=beacon`; r36's was older than T15/T16), `r41-galaxy-warp` (`&fx=warp`; r34's was older), `r41-touch`
  (the round-38 CDP script `tools/r38-resume.mjs`: tour → touch → overview → drag → tap a site → sheet → BACK →
  idle 30 s, 57 s → tour resumes), `r41-3m.png`.

## galaxy

1. **While a warn plate is up, the crit is the smallest red on screen.** `r41-pace-wall` 27.3-38.4 s (11 s of the
   film, the whole HV1 hold): a yellow `▲ FEAT-SEARCH` hero at the caption's top step, and the crit banner
   `■ HV2 · STORAGE` shrunk to `--cap-name` bottom right. Same in `r40-galaxy` 7.6 s and `r41-galaxy-beacon` 8.4 s.
   From 3 m the loudest thing for 14 s is an attention, not the crit. §2.1 says the worst thing is the loudest. T4's
   rule (drop the banner while a plate is up) is right only when the plate *is* the worst thing. Fix: `data-plate`
   carries the plate's tone; the banner shrinks only when the plate's tone is at least the banner's (crit plate
   under a crit banner). Under a warn or calm plate the banner stays full size. This widens T22 (calm plate) to
   any plate below the banner's tone. Test: a warn plate under a crit banner leaves the banner at full size.
2. **A new crit at an already-visited site still waits a cycle (T21, still open).** `r40-galaxy` 26.6 s: HV1 turns
   red. 29.8 s: banner `■ HV1 · VM-C · BUILDER-C NO CONTACT FOR 21S`. 32.9 s: the camera holds HV2 (`TARGET 02 / 05`,
   STORAGE), 36.0 s: CLOUD (`TARGET 03 / 05`) with the banner at `NO CONTACT FOR 27S`. The builder that went dark is
   never shown. The plate and the banner name two different crits at once, so the glance gets two "wheres". Fix:
   T21 as written. Do it before any fx work: it is the one thing on the page that breaks the promise.
3. **During a flight a crit's glyph goes grey.** `r41-galaxy-beacon` 31.1 s and 39.2 s, `r41-galaxy-warp` 18.1 s,
   `r40-galaxy` 26.6 s, `r41-touch` 04: HV2's label reads `■ HV2` in grey, the square glyph included, next to its
   red nebula. T15's decision dims passing trouble names to `--text-3`. Dimming the word is fine. Greying the *shape*
   removes the status from the one mark built to survive colour blindness and distance. Fix: under `data-dim` keep
   the glyph in its tone (dim only the name text, or the glyph to 70 % in hue). Test: a dimmed crit label's glyph
   keeps the crit colour.
4. **The crit plate still says `1 crit` in white (T20/T23, open).** `r40-hv2`: `STATUS 1 crit` in `--text-1`.
   `HARDWARE`, `WHERE`, `HOLDS` and the cpu/mem bars at ~13 css px. The warn plate (`r41-pace-wall` 30.9 s) has its
   trouble rows in hue with a shape, but at that same small size, so the why (`FIX-LOGIN · asked a question · 4m`)
   does not read at 3 m. In `r40-hv2` STORAGE appears 3 times and HV2 3 times. Fix: T20 and T23 as written.
5. **Labels land on the frame's own text.** `r41-pace-wall` 27.3-38.4 s: `DEMO-HOST` sits on top of the tag
   `LANEBOARD · DEMO-HOST LIVE`, and `HOME` sits on the plate's top-left bracket and kicker (also `r40-galaxy` 7.6 s,
   `r41-galaxy-beacon` 8.4 s, `r41-galaxy-warp` 31.8 s). The tag is the only "is it live" text on the page, and it is
   covered for the whole of a trouble hold. Fix: T26, with the tag box and the plate box in the labels' covers.
6. **A red smear without a name.** `r41-galaxy-warp` 14.5 s and 38.4 s, `r41-galaxy-beacon` 39.2 s: in flights
   HV2's nebula lobes stretch into two red blobs at the frame's edge, one with no label near it. From 3 m that is a
   second red thing with no "where". Fix: T2's `nearFade` also fades lobes that leave the frame faster than their
   star (or clip a lobe to within ~1.5 reach of its label's anchor on screen).
7. **The crit's label is still eaten by its nebula.** `r40-galaxy` 26.6 s: HV1 just went crit and reads `■HV(` under
   the red cloud (r17 finding 5, Later A4 T34). This is the moment I need the name. Fix: trouble labels draw after
   the nebula on a `--bg-canvas` halo.
8. **A dark box sits behind the banner at the overview.** `r41-3m.png` and `r40-overview`: a rectangle a step
   lighter than the sky, from the banner's left edge to the frame's right and down to the bottom. Seen by r39/r40 as
   well. It reads as a panel with nothing in it. Fix: feather the far cover's ground (Later A4 feathered plates) or
   drop it at the overview, where nothing sits behind the banner.

What works, so a fix does not undo it (facts): at wall pace the crit is target 01, the camera is on it at 12 s and
holds it 12-23 s. `r41-galaxy-warp` 4.3 s: a fresh `DOWN` on HV1 goes to the front of a new cycle. The tether is gone:
no straight red line at the overview. A cleared crit no longer shows as a red slab. HV1 cleared between `r41-touch` 06
and 07 and the overview showed it yellow at once.

## fx-beacon

1. **At the overview it is a hairline.** `r41-galaxy-beacon` 1.2 s and 23.7 s: a thin red pillar out of HV2,
   leaning with the perspective. It answers "where" at full size. In the 3 m scale (a quarter) it is 1 px and gone.
   Fix: a width floor in screen px at the overview. `beaconWidth`'s 0.016 of the frame should be well over a hairline,
   so the sheath's alpha profile probably eats it; check the profile, not only the geometry. Or let the white core
   carry 3 css px minimum.
2. **It leans.** 1.2 s: the pillar runs up-left, not straight up. Next to the arm's curves it reads as a lane or the
   old tether, not as a marker. Fix: draw it in screen-vertical (billboard the pillar's axis to the screen's up).
3. **It says nothing about which crit is newer.** With two crits (`r41-galaxy-warp` 0.8 s, HV1 and HV2) I would want
   the beacon to tell me which is new. In this film only HV2 had one. If age is height, the young one is the one I
   need to see. Fix: none required. Film a two-crit overview with `fx=beacon` and check that the young one shows its floor.

## fx-warp

1. **From 3 m it is invisible.** `r41-galaxy-warp` 14.5, 18.1, 35.1, 38.4 s: faint grey diagonal streaks on the right
   of the frame, the tint not readable even at full size. The promise is "you know the next target is red before the
   caption types". 38.4 s flies toward red HV2 and the streaks are grey. Fix: T28 as written (tint carried by the
   streak's head, not only its tail). For me the warn/crit tint must be visible at a quarter scale or the effect
   costs fill for nothing.
2. **It adds no trouble information the banner has not given.** At every flight frame the banner already names the
   crit at full size. Fix: none. Calm is fine: it does not compete with trouble.

## touch

Filmed (`r41-touch`, a gesture sequence, scored on it):
1. **In explore mode the overview looks exactly like the tour's.** `r41-touch` 07, 08, 09 (idle 2.5 s, 30 s, 57 s
   after BACK): no BACK at the overview, no countdown, nothing. From across the room I cannot tell "someone left it
   in manual" from "the tour hung". Fix: Later r36-dreamer touch 1 (`MANUAL · TOUR IN 0:40`), at the clock's size
   next to the clock, `--text-2`, only in explore. Cheap, and it is the only explore state a person three metres
   away ever sees.
2. **The sheet still carries the tour's kicker.** `r41-touch` 05: a tapped HV1 shows `■ DOWN · TARGET 01 / 05`.
   It says the tour is running. It is not. Fix: T25 as written (`SITE · HV1`).
3. **A finger on a crit works.** 04 → 05: the tap (on HV1, crit at the time) flies there. BACK is up at once, and
   the sheet's hero is `VM-C · builder-c no contact for 31s`, readable at the quarter scale. 10 → 11: after the
   minute the tour resumes on the crit (HV2), from where it was, with no cut. Nothing to fix. Keep it.
4. **The script's site picker saw every site as `ok`.** Tool note, not the page: `pick` reads `s.node?.status`,
   which is empty, so `r38-resume.mjs` taps whatever is first. Use the nebula tone when a tap on the crit matters.

## Across the variants

- The **tour's resume** (`r41-touch` 10) goes straight to the worst site. Fix the tour's own mid-cycle re-rank
  (galaxy 2) the same way: `resumeTour` already knows how to start at the worst site.
- The **sheet** (`r41-touch` 05) states the count as `1 down · 2 attention · 1 warn`. The tour's crit plate
  (`r40-hv2`) says `1 crit` in white. Same words, but the sheet's rows below are in hue. The tour plate should
  take the sheet's rows.
- **`?pace=wall`** is still the only film that shows the order trouble is reached in. Demo films answer motion
  questions only.

## Scores

score galaxy overview 7
score galaxy legibility 6
score galaxy status 6
score galaxy touch 6
score galaxy wow 6
score galaxy calm 6
score galaxy performance 6
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 3
score fx-warp calm 7

Why: status 6 (up from 5): the tether and the cleared red slab are gone, and the crit comes first at wall pace.
Two things hold it down: a warn plate outshouts a crit for its whole hold (galaxy 1), and a fresh crit at a visited
site is skipped (galaxy 2). Touch 6: the gesture film works end to end and lands on trouble, but explore mode is
invisible from across the room. Performance is a guess: SwiftShader gave 6-11 fps (worst gap 414-804 ms) on this VM,
and that measures the VM, not the page. No `?perf=1` script-ms reading was taken. The owner reports the Surface runs well.

## 3 m check

`$RUN_DIR/shots/r41-3m.png` (`r40-overview`, 2736 px → 684 px; the strip below is padding). **Yes for trouble and
names. No for freshness.**
- **Something is wrong and where:** yes. The red `■ HV2` with its nebula and the yellow `▲ HV1` are the only
  colour. The banner `■ HV2 · STORAGE / POOL 97% FULL` reads easily.
- **Site names:** yes. REMOTE, HV2, DEMO-HOST, HV1, HOME and CLOUD all read.
- **Not readable:** the tag `LANEBOARD · DEMO-HOST LIVE` (~3 px), `+3 MORE`, the date. Whether the data is live
  cannot be read from 3 m (r17 finding 6 stands). The dark box behind the banner shows (galaxy 8).

## console.txt

- `r40-galaxy/console.txt`: empty (0 lines).
- `r40-overview/console.txt`: empty (0 lines).
- `r40-hv2/console.txt`: empty (0 lines).
- `r41-pace-wall/console.txt`: empty (0 lines).
- `r41-galaxy-beacon/console.txt`: empty (0 lines).
- `r41-galaxy-warp/console.txt`: empty (0 lines).
- `r41-touch/console.txt`: empty (0 lines; the script's `errors []`).
