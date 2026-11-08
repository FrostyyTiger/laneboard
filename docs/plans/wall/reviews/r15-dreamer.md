# Review, round 15, dreamer (title sequences, game maps, film HUDs)

Night 5, after T3 (117cfbd, colour). I watched this as the screen in my hallway for a year. What I looked at, all in
`$RUN_DIR/shots/`:
- `r14-galaxy/sheet.png`: `wall.html?variant=galaxy&demo=1`, large demo, 12 frames over 33 s, cpu 4x. It was filmed
  from the T3 working tree a minute before its commit, so it is current. `perf.json` 30.1 fps, worst gap 167 ms.
- `r14-t3-overview`, `r14-t3-hv1`, `r14-t3-hv2`: stills at 1368 px (2736x1800).
- `r15-fx-<name>/sheet.png`: I made these this round, because r10's fx films came before T1b-T3. Each is
  `galaxy.html?demo=1&fx=<name>`, large demo on a demo hub of my own (port 7796, stopped afterwards), cpu 4x.
- `r10-touch/sheet.png`: the newest touch walk. No touch code has changed since (T11-T16 are open), so it is still valid.
- `r15-3m.png`: the overview still at 684 px, a quarter of its width.

## galaxy

1. **At the overview the warn is louder than the crit.** `r14-t3-overview` and `r15-3m.png`: HV1 (▲ warn) has a big
   yellow nebula about 200 px long that wraps its cluster, plus a yellow ring. HV2 (■ crit) has a thin red smear that
   sits *behind* its own label. The same holds in `r15-fx-sweep` frame 1, where REMOTE's yellow cloud is the largest
   coloured shape on the plane. The banner rescues it, but the map tells the opposite story. That fails §2.1. From the
   sofa my eye goes to the yellow, not to the red. Fix: night 4's T23 from `## Later` is now the worst open thing on
   the overview. The crit nebula should be at least 1.5x the warn's area and drawn on the side away from the label.
   The warn should not breathe, and its nebula should stay inside its own cluster's reach.
2. **Every held system looks the same, so I never know where I am without reading.** `r14-galaxy` frames 5, 6 and 8
   (CLOUD, REMOTE, HOME) show the same grey stones on the same grey ellipse in the same corner. T3's site tints show
   only as a faint haze at the overview (HOME's teal by its star). Once the camera arrives, the tint is gone. A place
   you visit every day needs a face: in Stellaris every system's star colour tells you where you are before the name
   does. Fix: carry the site's tint into its held system at calm chroma: the orbit ellipse, the star's halo and a soft
   ground disc under the plane. Keep it far below any status hue, and leave the trouble members as they are.
3. **The flights are dead air.** `r14-galaxy` frames 3 (6.6 s), 7 (18.3 s) and 11 (30.1 s) each show one far star and
   a long empty arc. A third of the film is the camera travelling through nothing. `warp` fills the flight only when
   the destination is in trouble (`r15-fx-warp` frame 11). A calm flight still has no departure and no arrival. Fix
   (cheap, no fx): during a flight, the destination's name rides at the frame's edge in the kicker's mono with the
   distance counting down (`→ HOME · 0.4`). The plate then grows out of that line on arrival. A film transition
   never leaves the screen empty.
4. **The big stars are visibly faceted.** `r14-t3-hv2`: HV2's star has a polygonal outline at 1368 px, and so do
   `secrets` and `media`. T2 claimed 26x18 is enough up to 1.65x, but the tablet's 2x pixels show the steps.
   Faceted spheres read as "a 3D demo", not "a film". Fix: shade the stars smooth (the planets' material), or use 48x32
   above 1.2x. The triangle cost is a handful of meshes.
5. **The plate's leader cuts through the system it points at.** `r14-t3-hv2`: the red leader drops straight down from
   the plate's headline, through `media`, past `scrub` and `smb`, into the lock. `r14-galaxy` frame 2 does the same
   through HV1's labels. A leader should arrive from empty space. Fix: route it round the system's bounding ellipse
   (out, down, then in from the outside) and end it at the lock's nearest bracket corner.
6. **A crit member is a hole, not a light.** `r14-t3-hv2`: `storage` is a red disc with a black square in its centre,
   and it has no name on the map in that still. Up close it reads as a stop button or a missing texture. The brief's
   "glows from inside" (§5) is lost at the moment you look closest. Fix: the crit shape stays white or `--text-1` on the
   red, with a lit core behind it, and the name stays next to it at every step (night 4's T29).
7. **The red banner never rests.** In every frame of every film, `HV2 · STORAGE` in red caps fills a third of the width,
   including holds on calm sites (`r14-galaxy` frames 7-12). In a hallway that is a permanent shout, and a permanent
   shout stops being heard within a week. T23 (one-line banner in holds) is the right first step. Beyond it, for the
   owner: a trouble that has stood unchanged for hours could keep its hue and its place but drop one size step. Its
   *age* would then be the loud part (`POOL 97% FULL · 6 H`).
8. **The hub is a beige ball.** Every overview: the sun in the middle of the galaxy, the thing everything hangs from, is
   the least alive object on screen. It is smaller than HV1's warn nebula, has no corona and no motion. This is
   C1b's to own (the corona belongs to its stale/live work), so it is not a task here. It is the biggest *missing* thing
   in the composition, though: the centre of the frame says nothing.

Touch (`r10-touch`, unchanged code):
9. **Tapping a planet changes words, not the world.** Frames 06-07: the plate swaps to `POOL 97% FULL`, but the camera,
   the planet's size and its neighbours stay the same. The person's choice gets no visible consequence in the scene.
   T8/T9 (moons open, fly closer) fix it. Add one more thing: the picked planet's tether to its star brightens for the
   length of the selection, so the scene shows *what* you picked, not only the plate.

## fx (`r15-fx-<name>`, all after T3)

- **beacon** (30.6 fps, worst 263 ms). Frames 1 and 9 (0.6 s, 24.1 s): a thin red line rises from HV2 almost to the
  frame's top edge. With T1's tighter galaxy the pillar now runs nearly twice the cluster-to-edge distance. It has no
  top, so it reads as a laser or a stray line, not a monument. What is missing: an end. Fix: the pillar stops at a
  height about the cluster's own diameter and carries a small tick with the crit's age. Then it is a flag, not a laser.
- **warp** (31.3 fps, worst 222 ms). Frame 11 (29.9 s): a fan of streaks round HV1 as the camera heads into its red.
  This time it reads as motion, and the red arrives before the words. That is the best moment in any film tonight. Worst:
  only one frame of twelve catches it, and calm flights (frame 7) are as empty as without it. Fix: keep it as it is
  for trouble. Calm flights get item 3's edge caption, never streaks (r46 stands).
- **afterglow** (31.4 fps). For the second review in a row no film catches a clear: HV1 goes from warn to crit
  (frame 12), never back. I cannot score what I cannot see. Fix: the demo hook from r10 (clear a site at a known second
  under `?demo=1`). Without it this effect stays invisible to everyone who judges it.
- **activity** (29.4 fps, worst 250 ms). Frames 3, 4, 7 and 10: white rings round working planets are the brightest
  calm shapes on screen. In frame 10 (27.3 s) one sits next to the locked crit `storage` and competes with it. In frame
  7 (18.3 s) a white ring round HOME's star reads as a selection. It moves with meaning but shouts it. Fix: rings at
  `--text-3` alpha (r10 said so too), never within a lock's box, and a slow fill instead of a breathing outline.
- **sweep** (30.4 fps, worst 235 ms). Frame 1 (0.5 s): HOME and HV2 sit in closed ellipses that read as "these two are
  chosen". The line itself is not in any of the twelve frames. Fix: a ping is a short open arc that fades in about
  1 s (r10 again). To film it, the sweep should run once in the first 5 s of `?demo=1`.

## Across the variants

There is one variant (`galaxy`) and five fx. `warp` frame 11 is the moment the others should steal from: the scene
tells you the news before the type does. The overview should steal it for crit (item 1: the red must win the map, not
only the banner). Calm holds should steal it for place (item 2: the tint says HOME before the plate does). `sweep`
and `beacon` have the right *grammar* (one gesture, one direction, then stillness). `activity` has the right
*meaning* (what works comes forward) with the wrong volume. Give `activity` beacon's restraint and `beacon` sweep's
ending, and both get better.

## What would make it unforgettable

1. **`scan`**. You see: when the camera arrives at a system, its planet names type in one by one, letter by letter like
   the plate's name, trouble members first, then the rest in order of how much they carry. Calm systems type quickly
   and quietly.
   What it means: the reading order *is* the severity order. The owner's favourite moment ("spelled out slowly") becomes
   the way the system reports itself. In a calm system the typing is over in a second; in a bad one, the red name
   types first and alone.
2. **`eclipse`**. You see: a member that stops answering (down, no contact) loses its lit side. It becomes a dark disc
   with only a thin red rim where the light used to be, like a planet in eclipse. It stays there, unmistakably dark
   among lit stones, until contact returns, and then the light sweeps back across it.
   What it means: no contact means no light. "Down" becomes a physical state you see at a glance, different from "crit
   but answering". The red rim keeps it the loudest thing in its system (§2.1).
3. **`dial`**. You see: a thin 24-hour ring on the plane round each star, with the current hour at the top. It is grey
   where the site was calm, and an outline arc in the old status hue where it was in trouble. It is never filled and
   never pulsing, and it fades as it ages round the dial.
   What it means: the last day of the site's history at a glance. In the morning you see that HV2 was red from 02:10 to
   03:40, though it is green now. It is `afterglow` made readable and filmable: the history has a clock, not only a
   fading ring. It stays quieter than any live trouble.

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 6
score galaxy touch 5
score galaxy wow 6
score galaxy calm 5
score galaxy performance 7
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 6
score fx-afterglow wow 2
score fx-afterglow calm 7
score fx-activity wow 4
score fx-activity calm 3
score fx-sweep wow 5
score fx-sweep calm 6

Touch is scored from `r10-touch` (the gesture film: wake, drag, tap a site, tap a planet, Back, Back). Tonight's touch
tasks (T8-T16) have not landed, so the score is for night 4's touch on night 5's look. Performance is my guess from
`perf.json` (30 fps at cpu 4x under SwiftShader, worst gap 167-263 ms), not a tablet measurement.

## The 3 m check

`r15-3m.png` (`r14-t3-overview` at 684 px, a quarter of its width): **yes for "is something wrong", only half for
"where".** `■ HV2 · STORAGE` and `POOL 97% FULL` read at once, and the clock reads. All six site names read (`HOME`,
`REMOTE`, `DEMO-HOST`, `CLOUD`, `HV1`, `HV2`). The tag top right is texture, which is fine. On the map, though, the
loudest coloured shape is HV1's yellow glow, while HV2's red is a small smear under its label. If you only glanced at
the galaxy, you would point at HV1. The banner says HV2, the map says HV1: item 1.

## Console

- `r14-galaxy/console.txt`: empty (0 lines).
- `r14-t3-overview/console.txt`, `r14-t3-hv1/console.txt`, `r14-t3-hv2/console.txt`: empty.
- `r10-touch/console.txt`: empty.
- `r15-fx-beacon`, `r15-fx-warp`, `r15-fx-afterglow`, `r15-fx-activity`, `r15-fx-sweep` `console.txt`: all empty
  (film.mjs: 0 console/page errors each).
