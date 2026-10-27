# Review r35: film-ui (the film-interface designer), night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). The last commit to `public/js/wall` / `wall.css` is T17
(202011b, 08:40). Every film below was made this round, after it, on `demo-fleet.mjs --size large --tick 800`,
`galaxy.html?demo=1&quality=0&pace=wall` (the real tour speed), cpu x4 (the throttle works again):
- `r35-galaxy/`: no fx. 12 frames over 52 s.
- `r35-fx-beacon/`, `r35-fx-warp/`, `r35-fx-afterglow/`, `r35-fx-activity/`: the same URL with that one `fx`.
- `r35-fx-warp-flight/`: `fx=warp`, 12 frames 0.5 s apart from 8.5 s, so one flight is caught (frame 3).
- `r28-touch/`: the director's touch film from r28 (07:44, between T13 and T14's commit). The gestures since
  then were not changed by T15-T17 (effects only), so I judge touch from it and did not refilm it.
- `r30-galaxy-with/`: `fx=afterglow` at 07:56 (after T16). My own afterglow film has no trouble clearing on
  screen within its 53 s, so the ring is judged from r30's frame 12.
- `r35-3m.png`: `r35-galaxy/frame-01.jpg` at 684 px; `r35-3m-12.png` the same for frame 12 (a held frame).

At `pace=wall` the film reads differently from r4's `demo=1` strip. Holds last 10-14 s and the plate is fully
set in each one. r4's finding 4 ("no beat of stillness") is fixed at this speed: in `r35-fx-warp-flight` frames 6-12
are the same composed frame for 9 s. What follows is what is still wrong.

## 1. galaxy: findings, worst first

1. **Two headlines in one shot, and the louder one is the other subject.** `r35-galaxy` f7 (28.7 s): the plate's
   hero is a yellow `▲ FEAT-SEARCH` while the banner below sets a red `■ HV2 · STORAGE` at about the same cap
   height. f11/f12 (47-52 s): the plate holds a yellow `OFFICE-PRINTER` while a new red `■ HV1 · VM-C` banner
   is 1.3x the hero's size. `r28-touch/05-site-sheet`: the touch sheet `FEAT-SEARCH` under a red `HV2 ·
   STORAGE` at the same size. Why it matters: a shot has one subject. Here the camera says "look here" and the
   type says "no, there", and the type wins because it is red and bigger. Fix: T19 (one top step while a site is
   held). Its banner drops to the plate's second-line size, on one line. Add a second rule: when the banner names a
   crit and the camera holds something milder, the tour cuts to the crit at the end of the current name step
   (T22/T28). Then the louder subject becomes the shot instead of competing with it.
2. **The orphaned leader is still there.** `r35-galaxy` f6 (24.1 s): the plate is gone but its red leader still
   hangs: a horizontal stub, a drop, and the lock at the end. Nothing is at the other end. `r35-fx-warp` f10
   (42.7 s): the same in yellow. `r33-galaxy-with` f9 and f12: the same. This is now in four films. Fix: T20 as
   written. The leader takes the plate's opacity on the same curve, goes out first and comes in last.
3. **A block cursor alone on an empty line.** `r35-galaxy/frame-03.jpg`: under `STORAGE / POOL 97% FULL` a white
   block about 40x60 px stands alone where `HV2` will be typed. It is the brightest thing in the plate and taller
   than the line's cap height. The same happens in f10 (`OFFICE-PRINTER`), `r35-fx-afterglow` f10 (`REMOTE▮`) and
   `r35-fx-activity` f10 (`REM▮`). Why it matters: the cursor should mark the type being set, not take its place.
   An empty white bar reads as a glitch. Fix (r4 5, in Later): the cursor is the cap height of the line it sits
   on, at 60 % of the text's value. It appears with the first letter, never before.
4. **The kicker's count counts itself.** At `pace=wall` the kicker reads `TARGET 01 / 01`, then `02 / 02`, then
   `03 / 03` (`r35-galaxy` f3, f7, f10). Under `demo=1` it read `01 / 05`. A counter whose total grows with the
   index tells the viewer nothing and looks broken on camera. Fix: either N is the fixed number of stops in the
   cycle, or the count goes (r21's answer (a) to the owner's open question). Never `n / n`.
5. **The plate's ground still shows as a box where a system sits under it.** `r35-galaxy/frame-03.jpg`: HV2's
   open system reaches under the plate's right edge. Its left planet (x≈880, y≈440) and the ellipse are dimmed
   inside a rectangle that ends at x≈960, y≈560, with a visible vertical step. `r35-fx-activity/frame-05.jpg`: a
   faint straight edge at x≈960 from the plate down to y≈830. At the overview the banner's ground no longer
   steps (`frame-01.jpg`, the ribbon fades cleanly), so T10 worked there. Fix: size the plate's ground to the
   type's own column (the widest line plus `--cap-pad`), not to the bracket box. Also keep the held system's
   framing clear of it (T25): the system should never be under the plate at all.
6. **The plate's grid is still two grids.** `r35-galaxy/frame-12.jpg`: `STATUS ▲ 1 ATTENTION` is set in big
   condensed caps, `CPU ━ 12%  MEM ━ 33%` in small mono, and `WHERE office / HOLDS 6 rooms` in small sentence case.
   The value column starts at x≈275 for `office` and at x≈320 for `1 ATTENTION`. Three sizes and two value
   columns in one block. Fix (r4 8, in Later): one two-column grid with one label column and one value
   column, and values in one face at two sizes at most (trouble rows big, facts small, all caps).
7. **Label placement has no rule at the overview.** `r35-galaxy/frame-01.jpg`: `REMOTE`, `HOME`, `HV2`, `HV1` and
   `DEMO-HOST` sit to the right of their star, but `CLOUD` sits above its star. In `r33-3m/with.png`, `HV1`'s
   label lands on its own activity ring. Fix: one anchor (right, baseline on the star's centre). Move a label
   only for a collision, and then always to the same second place (left).
8. **A show hold has no type.** `r28-touch/12-show-3s`: the show command flew to HV1. The frame shows the open
   system with its yellow trouble cluster, no plate, no kicker, no "shown by the agent". It reads as dead air in
   the middle of the film. Fix: B (T37-T39) as planned. A show hold gets the plate like a tour hold, and its
   kicker says who drives (`SHOWN · AGENT`) where the tour's says `TARGET`.

## 1b. fx-beacon: findings

1. **Still a scratch on the film.** `r35-fx-beacon` f1, f2: a 2 px red line rising from HV2 to the top edge,
   with a soft red tip. Nothing else on screen has that weight. It reads as a defect, not as a thing placed
   there. Fix (r4 beacon 1, in Later): a 6-8 px core with a soft glow, and a cap at the tip (a short horizontal
   tick, the bracket language). Width grows with age.
2. **It is gone in every held frame, including VM-C's.** f9-f12 hold the new crit `VM-C` with no pillar. The
   beacon would be most useful when a crit is not the camera's subject, so here that is right. But f10 (42.3 s,
   the overview between holds) has no pillar on HV1 either, while `■ HV1 · VM-C` stands in the banner. Fix:
   check whether the pillar waits for its age floor. The plan asks for a young crit to be visible at once.

## 1c. fx-warp: findings

1. **The whole frame still streaks.** `r35-fx-warp-flight` f3 (3.6 s): red-white streaks radiate across both arms
   and every corner from HV2. The vanishing point is right: the eye goes to HV2 and the red tips announce a
   crit. But the quantity buries the yellow HV1 and the sun under the same texture. Fix: T21 as written (a 30°
   cone round the direction of travel, about a quarter of the count, hue only at the tips).
2. **The flight is under 1.5 s and warp owns all of it.** Between f2 (2.2 s, still) and f4 (5.0 s, held with the
   plate typing) there is one streak frame. There is no anticipation beat before the streaks start. Fix: a
   0.3 s stillness at the start of the flight, with the lock brackets tinted to the destination's hue (r4's idea
   under For the owner). Then the streaks, then the snap back. Three beats instead of one smear.
3. Calm flights are quiet now (T15). In `r35-fx-warp` no flight to a calm site streaks.

## 1d. fx-afterglow: findings

1. **The ring speaks the lock's language.** `r30-galaxy-with` f12: after HV2 cleared, a thin red ellipse sits round
   HV2 at the overview. That is the same hue and line weight as a live crit's target lock, and the only red on
   screen. From across the room it reads as "HV2 is selected / in trouble". Fix: a dashed or tick-marked ellipse,
   already amber at its first frame (never the live red). It cools to grey from there, so the history hue can
   never be read as the live crit hue.
2. Not seen in my film: within 53 s nothing cleared on screen (HV2's crit cleared while the camera was on HV1).
   A film that waits for a clear needs `--every 6000` or `at=overview`.

## 1e. fx-activity: findings

1. **The calm planet carries the biggest mark in the system.** `r35-fx-activity/frame-05.jpg`: round `k8s-1` and
   `gpu-box` two grey rings are drawn, the larger about 260 px across. That is wider than the whole crit lock
   (90 px) and crosses `k8s-1` and `k8s-2`'s labels. In a held crit frame the busiest mark is a calm planet's
   halo. Why it matters: "what is quiet recedes" is the effect's idea, and a ring bigger than the lock is the
   opposite. Fix: in an open system, cap the ring at about 1.6 planet radii and draw it under labels. Keep the
   frame-height floor only at the overview, where it is needed (T17's `minRing`).
2. **Overlapping rings in a folded cluster.** `r33-galaxy-with` f1, `r35-fx-activity` f2: at CLOUD and HOME two to
   three rings overlap into a grey smudge with no shape. Fix: one ring per folded cluster, with its thickness
   set by the number of working planets.
3. Jobs (flash, miss) are not in my frames. r33's `r33-galaxy-jobs` frame 6 shows one grey flash on CLOUD. It is
   the right size and quiet.

## 1f. touch (from `r28-touch`)

The sequence works as a camera: tour → wake eases to the overview → drag → tap HV1 → sheet → back to the
dragged pose → idle 62 s → the tour comes back on its own. `MANUAL · TOUR IN 0:59` and `▶ TOUR` in the top right
tell the viewer that a person is driving. Findings:
1. `05-site-sheet`: finding 1 above (the banner outshouts the sheet).
2. `05-site-sheet`: the trouble members' names (`ci-retry`, `vm-b`, `bb`, `vm-c`, `fix-login`) pile on each other
   beside the lock. On a sheet the person came to read, the scene's names should step back. Hide the scene's
   labels for any member the sheet names (as `hud.named()` does in the tour), and hide the rest of the
   trouble cluster's labels while the fan is closed.
3. `‹ BACK` / `▶ TOUR` still sit in a full 1 px box with two bracket corners. That is the only boxed control,
   in a different weight from the plate's brackets (r4 touch). Fix: brackets only, at the plate's weight.

## 2. Across the variants (what one does that the others should steal)

- `r35-galaxy` f4/f5 (and `r35-fx-warp-flight` f6-f12): plate left, the open system right, the lock and leader
  between them, clock bottom left, tag top right, and no banner. This is a composed shot, the best frame of the
  night. Every held frame should look like this. That is what finding 1's fix buys.
- warp's vanishing point (`r35-fx-warp-flight` f3) announces the destination before any type does. The tour
  should get that for free without warp: tint the lock brackets with the destination's hue during the flight.
- `fx=activity`'s overview floor (rings that stay visible at 3 m) is the right idea for `afterglow` too, whose
  ring is a hairline. Use the same floor, in afterglow's own dashed language.
- The plate's new L-shaped leader (`r35-fx-activity/frame-05.jpg`: out from the hero, down, into the lock) is
  cleaner than r4's stub-and-diagonal. Make every leader an L (`r35-galaxy` f12 still has a diagonal).

## 3. Rubric

score galaxy overview 7
score galaxy legibility 7
score galaxy status 7
score galaxy touch 6
score galaxy wow 7
score galaxy calm 6
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 3
score fx-afterglow wow 5
score fx-afterglow calm 7
score fx-activity wow 4
score fx-activity calm 5

Notes: touch scored on the r28 gesture film, not on a guess. Performance is a guess: the SwiftShader films read
11.8-14.9 fps at cpu x4 (worst gaps 225-358 ms). They measure the VM, not the page, and no film shows a hitch
in a flight. afterglow is scored from r30's frame 12, the only frame with its ring in it.

## 4. The 3 m check

`$RUN_DIR/shots/r35-3m.png` (`r35-galaxy` frame 1 at 684 px): **yes**. HV2 is the only red mass, with a red ■
and its name. HV1 is the only yellow one, with a ▲. The banner `■ HV2 · STORAGE` is the largest type and reads
at any distance. REMOTE, DEMO-HOST, HOME and CLOUD read in condensed caps. Warn and crit still differ by hue
more than by shape at this size (the ▲ and ■ are both small solid marks); T23 is open for that.
`r35-3m-12.png` (a held frame, frame 12): **yes for trouble, partly for where**. The red `■ HV1 · VM-C` reads
from 3 m, but the camera and the big yellow plate are on REMOTE. From across the room the eye goes to the yellow
system on screen and reads it as where the trouble is, while the worst trouble is somewhere else
(finding 1).

## 5. console.txt

- `r35-galaxy/console.txt`: empty (0 lines).
- `r35-fx-beacon/console.txt`: empty (0 lines).
- `r35-fx-warp/console.txt`: empty (0 lines).
- `r35-fx-warp-flight/console.txt`: empty (0 lines).
- `r35-fx-afterglow/console.txt`: empty (0 lines).
- `r35-fx-activity/console.txt`: empty (0 lines).
- `r28-touch/console.txt`: empty (0 lines).
