# Review, round 30, touch (one finger, standing, no hover)

Night 5, after T11 (81dac29, hit targets in screen space). I judge what a finger can do: target size, reach, feedback,
the way back, the walk-away, and stray touches. Files are in `$RUN_DIR/shots/`. Everything ran on the large demo on :7795,
under the SwiftShader wrapper, at 1368x912 css (the tablet at 2x).
- `r29-galaxy/sheet.png`: `galaxy.html?demo=1`, cpu 4x, filmed after 81dac29, so it is current. I used it for the tour.
- `r30-touch/*.png` (mine, `tools/r30-touch.mjs`, CDP touch events): tour → drag (wakes) → palm slide → tap HV2 (crit) →
  tap STORAGE → drag 200 px inside the system → a tap I meant for empty sky → STORAGE again → tap the moon `nfs` → Back ×3.
  `steps.json` has the camera's `want` and the controls at each step.
- `r30-touch2/*.png` (mine, `tools/r30-touch2.mjs`): first touch on the site the tour holds → 450 ms press on HV1 → tap
  40 px off HV1 → tap the banner → pinch → hands off for 71 s. The demo's trouble had moved by then (HV2 calm, warn only).
- `r20-fx-<name>/sheet.png`: these predate T6b-T11. Those commits changed layout, labels, moons and hits, not the effects.
  I filmed no gestures with an `fx` on.
- `r30-3m.png` (mine): `r30-touch2/03-overview.png` shrunk to 342 px wide, a quarter of its width.

Touch is built (night 3 C, night 5 T8-T11). T12-T16 are still open, so some findings below are those tasks seen through a
finger. I list them because the night's done-when walk (T16) will hit them first.

## galaxy

1. **A drag inside an open system throws it off the screen.** `r30-touch/09-drag-in-system`: STORAGE was open with its
   moons, and I dragged 200 px left. HV2's star went from (1248, 228) to (1369, 676). The camera became `free`. A huge,
   faceted grey sphere now fills the bottom right corner. The plate still says `POOL 97% FULL · STORAGE`, but STORAGE is off
   screen. The lock and its red leader line point at the corner and run through the Back control. The owner's own words
   are "I need to turn it in 3D". This is the first thing his finger will try, and it breaks the view. Fix: T12 (orbit
   round the held star, both axes, pitch clamped, still held). Until then, hide the leader line and the lock when their
   target is out of frame. A plate that points at nothing reads as broken.
2. **The held star sits under the Back control.** `r30-touch/08-planet-open`, `10-empty-tap`, `13-moon`: after picking
   STORAGE, T9's framing puts HV2's star at about (1248, 228). The Back box is 1160-1286 × 151-231. `k8s-1` and `k8s-2` sit
   under the `MANUAL · TOUR IN` line and the Back box too. A finger on the star presses Back and goes one step out
   instead. Nothing on screen tells you that the star cannot be tapped. Fix: T9's free box excludes the Back control's
   rect and the manual line, each with 24 px of margin. A test can pin it: no member's screen point lies inside
   `#galaxy-back`'s box at any pick framing on the large demo.
3. **Back skips the planet step, and the third Back starts the tour.** `r30-touch/14-back-1-150ms`: from the moon `nfs`,
   one Back went to the site with moons folded (`member: null, open: null`), not to STORAGE. The second Back went to the
   overview. There the same button became `▶ TOUR`. My third tap, aimed at the same spot, started the tour at once
   (`14-back-3-150ms`: `driver: tour`). Someone who taps Back three times, as they would to "get out", lands in the tour
   they had stopped. Fix: T13's levels (moon → planet → system → overview). And when Back has just reached the overview,
   the control keeps its place but stays `‹ BACK`, inert, for 1.5 s before it turns into `▶ TOUR`, so a repeated tap
   cannot fire it.
4. **A palm turns the galaxy, and Back keeps the palm's view.** `r30-touch/04-after-palm`: one contact 180 px wide slid
   200 px. The camera moved 2111 units and became `free`. Later, Back to the overview (`14-back-2`) returned to that pose.
   Two of the five sites (CLOUD and HV1's cluster) were out of frame, and HOME sat faded behind the clock. `isPalm`
   guards taps only (`touch.js createTaps`). `createGestures` turns and pinches with any contact. Nothing harmful happens
   to the fleet, but a sleeve against the screen can leave the wall showing part of the galaxy for a minute. Fix:
   `createGestures` ignores a pointer that `isPalm` flags, at down and at every move, as `createTaps` already does. Also,
   Back to the overview always lands on the fitted overview when the explore pose leaves a site out of frame.
5. **A slow press does nothing, and nothing says so.** `r30-touch2/04-long-press-450`: I held a finger on HV1 for 450 ms.
   No flight, no lock, no mark. `TAP.ms` is 300. A standing person who presses deliberately, or an older hand, often
   takes longer. The tap is lost without a word. Fix: `TAP.ms` 600 (the 12 px slop already separates a tap from a
   drag). Add a pressed mark at `pointerdown`: a 48 px ring under the finger that fills while the finger stays down and
   fades when the finger lifts.
6. **The first touch has 1.5 s of no answer.** `r30-touch2/01-wake-150ms` and `02-wake-1150ms`: the caption vanishes,
   and the camera has barely moved. No `MANUAL` line and no `▶ TOUR` appear until the ease ends (`03-overview`, mode
   `easing` → `explore`). From 1 m, "the plate went away" looks like a glitch, not "I have you". Fix: show `MANUAL · TOUR
   IN 1:00` and the control in `easing` already, at the touch, and show the 48 px ring of #5 where the finger landed.
7. **The tap targets inside a system are too close to aim at.** `r30-touch/06-site-held`, `08-planet-open`: in HV2,
   `media` and `gpu-box` touch (two spheres, their names overlap). `k8s-1`, `k8s-2` and `k8s-3` are 60-90 px apart, which
   is less than two finger reaches (96 px). Nearest-centre picks one, but I cannot tell beforehand which one I will get.
   T6's minimum gap was tested on HV1's builders, and HV2 misses it at the pick framing. Fix: a minimum on-screen gap of
   64 px between planet centres at the site's held framing and at the pick framing, tested on every site of the large
   demo, not only HV1.
8. **I cannot read the names I aim at.** `08-planet-open`, `13-moon`: the open moons are named `nfs`, `scrub`, `smb`,
   and the planets `k8s-1`, `sandbox`, `build-cache`. They are lowercase mono at about 9-10 css px, grey on the haze. At
   arm's length, standing, I read them only by leaning in. The moon dots are 15 px. With the 48 px reach they can be hit,
   but they are hard to choose. Fix: inside an open system, the names of planets and moons that can be tapped are at
   least 14 css px, in the plate's condensed caps at `--text-2`. r10 #6 asked for the same, for the 3 m view.
9. **Tapping the words undoes my turn.** `r30-touch/10-empty-tap`: I meant (700, 140) as empty sky. It landed on the
   plate's `POOL 97% FULL`, and the camera flew from my turned pose back to the STORAGE framing. When a planet is open,
   the plate covers the top-left 57 % of the width (to x 780). So "empty sky" is scarce, and the words are the most
   likely place to land. Fix: a tap on the plate whose subject is already selected does nothing (as T12 wants for empty
   sky). It flies only when the subject differs.
10. **The banner grows while I explore something calm.** `r30-touch/13-moon`: I picked the calm moon `nfs`. The plate
    shrank to three lines, and the banner grew to about 90 px caps, `■ HV2 · STORAGE`. It is the biggest target on the
    screen (bottom right, 760 × 140 px), and a tap on it flies away from what I picked (`r30-touch2/06-tap-banner-150ms`:
    it flew to REMOTE). Its subject also changes with the plate (r25 #9), so the same spot leads to different places.
    Fix: in explore, the banner keeps its overview size (T23). It is tappable only on its subject's name, not on the
    whole block.
11. **The idle minute: checked, no fault.** `r30-touch2/09-12`: hands off from 0:59. At 61 s the camera eased to the
    overview (B239), and at 65 s the tour was holding HV1. The `MANUAL · TOUR IN 0:29` count was right at 30 s. This is a
    finding only in that it holds. The Back control is 126-132 × 80 px with `touch-action: none`, above the 48 px
    minimum, and a tap 40 px off HV1 picked it (`05-tap-40px-off-150ms`). The `MANUAL` line is 234 × 16 px and cannot be
    tapped, which is fine, because it is not a control.

## fx-beacon
1. A beacon pillar is a hit target by its nearest point (T11). In HV1's open system, a tall pillar over a crit planet
   crosses the planets above it on screen, so a finger aimed at one of them can get the crit planet. Fix: a pillar
   counts only within 24 px of its base and its tip, not along its whole length, when a planet's centre is nearer.

## fx-warp
1. Warp plays on every flight that a tap starts. In `r20-fx-warp` the streaks are not visible, so to my finger it
   changes nothing. If it becomes visible, a tap must still show its lock first (finding #5's ring), before any streak.
   Fix: no streak in the first 300 ms after a tap.

## fx-afterglow
1. An outline ring on the plane, round a cluster that is now calm, looks like a selection ring. To a finger, rings mean
   "this is picked". Fix: a dashed or broken ring, never a closed one, and never at the lock's size.

## fx-activity
1. Its slow rings round working planets read as "selected" too (the r25 lock note). In an open system I could not tell
   my pick from a working planet. Fix: activity never draws a closed ring. It uses brightness and size only.

## fx-sweep
1. The sweep runs at the overview only, and nothing in it is tappable. It does nothing for touch. When a finger wakes
   the page during a sweep, the sweep line must stop at once, not finish its turn. Fix: a `pointerdown` ends the sweep.

## Across the variants
- `beacon`'s one vertical mark per crit is the only effect that makes a target easier to find before you touch. The pick
  framing (T9) should steal its idea: a short vertical tick over each planet that can be tapped in an open system, so the
  aim point is visible even when two spheres touch.
- The tour's hold (`r29-galaxy` frame 2) lays the system out on the right with the plate on the left, and nothing sits
  under the tag or the Back control. The pick framing (finding #2) should copy that layout's free box.

## Scores
score galaxy overview 7
score galaxy legibility 6
score galaxy status 6
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
score fx-activity calm 4
score fx-sweep wow 4
score fx-sweep calm 6

Touch 5 is from the two gesture walks, not a guess. Wake, reach, the Back control's size and the idle minute work. The
drag in an open system, Back over the star, the missing planet step and the palm drag do not.

## 3 m check (`r30-3m.png`)
**Trouble: yes.** The warn banner (`▲ REMOTE · OFFICE-PRINTER · PAPER JAM, NEEDS A PERSON`) is the largest text and still
reads at a quarter of the width. The three yellow nebulae (REMOTE, HV1, CLOUD) show where. This demo state had no crit,
so I could not test whether red is louder still. **Site names: partly.** `DEMO-HOST`, `REMOTE` and `CLOUD` read. `HV2` and
`HOME` (calm, grey, about 5 px tall at this scale) I could only make out because I knew them. The tag and the
`MANUAL · TOUR IN` line do not read at all.

## Console
- `r29-galaxy/console.txt`: empty (0 lines).
- `r29-t11-hit/console.txt`: empty (0 lines).
- `r30-touch/console.txt`: empty (0 lines).
- `r30-touch2/console.txt`: empty (0 lines).
- `r20-fx-beacon`, `r20-fx-warp`, `r20-fx-afterglow`, `r20-fx-activity`, `r20-fx-sweep` `console.txt`: empty (0 lines each).
