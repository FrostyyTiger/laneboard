# Review r11: dreamer (title sequences, game interfaces), night 4

Material, all in `$RUN_DIR/shots/` (none in the repo):
- `r10-galaxy/`: `galaxy.html?demo=1&quality=0`, large fleet, filmed 05:26 after T4 (fa7611b, the last commit to
  `public/js/wall` / `wall.css`), so current. 12 frames over 36 s, cpu x4.
- `r11-fx-beacon/`, `r11-fx-warp/`: the same URL with `&fx=beacon` / `&fx=warp`, filmed this round (port 7796,
  `--size large`), because `r4-fx-*` predate T2-T4.
- Touch, as CDP gesture stills: `r7-t2-taps/` (banner and pillar taps), `r8-t3-fan/` (crowded tap, fan, row, close),
  `r10-t4-back/` (wake, drag, tap a site, back easing, back home).
- `r11-3m.png`: `r10-galaxy/frame-09.jpg` (the crit overview) at a quarter width, 684 px.

Only the galaxy and its built effects are judged. My question for every frame: if this hangs in my hallway for a
year, what is the screen not yet telling me, and what moment is not yet a moment?

## 1. galaxy — findings, worst first

1. **The worst event of the day has no moment.** `r10-galaxy` frame 4 (10.9 s) to frame 5 (14.0 s): `VM-C` loses
   contact, and the only change is the banner swapping from a yellow line to a red one. No sound of the image
   changing: no wipe, no type-in, no ring from HV1, no turn of the camera. In a hallway I glance as I pass. A swap
   in place is invisible to a glance unless I happen to read it at that second. Why it matters to me: a film
   interface earns its look by making the one event that matters a scene. Here it is a cut in a text field. Fix:
   when a site's rollup rises (calm → warn, warn → crit; tour.js already detects it for T21), play one entrance:
   the banner types in letter by letter as the caption does (the owner's favourite thing), and at the overview one
   thin ring goes out from the site across the plane, once. Nothing repeats; the breathing nebula carries it after.
   (Proposal 1 below, `fx=alert`. The type-in part is not an effect, it is the banner's grammar.)
2. **Calm holds are empty rooms.** `r10-galaxy` frame 7 (HV2, `TARGET 04 / 05`) and frame 8 (HOME, plate only a
   cursor); `r11-fx-beacon` frames 6-7 (REMOTE, HOME); `r11-fx-warp` frame 7. The plate says only the name, the
   system sits in the right third, the left 60 % is black. Three of five targets look like this, every cycle, all
   year. Calm is the normal state, so this is the frame I see most. Why it matters: a calm hold is the place to
   show the fleet alive and it currently shows a name and a void. Fix: the calm plate gets one real line (owner's
   open question (b): `12 rooms · 3 working · last change 14m`), and the planet labels type in by recency
   (proposal 3, `fx=recent`). Composition: frame the calm system centre-right at the size of the trouble holds.
3. **Every planet is the same grey ball.** `r10-galaxy` frame 7: fifteen identical spheres round HV2. Nothing says
   which builder is running a session, which room is idle for a week. Size, brightness, ring: none carries data
   yet. Fix: T17 `activity`, as planned. I name it here because it is what the calm hold needs most after finding 2.
4. **The crit arrival frame is the ugliest frame.** `r10-galaxy` frame 6 (17.1 s): the camera is on HV1, the red
   lock is on the crit planet, a red leader runs left to nothing (no plate yet), and the map label `■ VM-C` is drawn
   on top of the star's `HV1` (`■ VM-C●HV1`). Fix: the leader starts with the plate (T20), and while the plate names
   a member, that member's own map label steps aside or hides (the T1 note "the map's own label still shows beside a
   sheet whose hero names it").
5. **The sun is a planet.** `r10-galaxy` frame 9, `r11-3m.png`: `DEMO-HOST` is a grey dot the size of a builder
   with a faint haze. The hub is what every lane comes from. Fix: a larger, warmer-white body (still grey-scale, no
   hue: §2.5) whose haze lights the near arm; brightness static, so nothing moves without meaning.
6. **At the overview, warn and crit nebulae are the same loudness.** `r11-3m.png`: CLOUD's yellow cloud is as big
   and bright as HV1's red one; the red only wins through the banner. At 3 m shape does not separate ▲ from ■
   (r4 said so too). Fix: the crit nebula one step bigger and breathing visibly (at 4 s the swing does not show in any
   frame), the warn nebula one step smaller and still.
7. **A site name is eaten by its own cluster.** `r10-galaxy` frame 9 and `r11-3m.png`: `■ HV1` ends under the
   cluster sprite (`HV1` reads `HV`). Fix: the overview label sits on the side away from the cluster's disc, by the
   disc's screen radius.
8. **The clock is the second biggest grey thing and says the least.** Every frame: `05:26`, unchanged for 36 s,
   at the size of a site name. Fix: keep it, but a step smaller; the space it frees is where an `activity` or
   `ledger` line could live (night 3's r36 `ledger`).

## 1b. fx-beacon — findings

1. **The pillar is a scratch.** `r11-fx-beacon` frames 8-9 (22.6 s, 25.9 s): a 1-2 px red line above HV2, reads as
   a hairline artefact, not a beacon. In every held frame it is gone. Fix: the Later finding as it stands (6-8 px
   core, soft glow, a cap at the tip). Without body it adds nothing the nebula and banner do not already say.
2. **It duplicates, it does not locate.** The banner already says HV2, the nebula is red, the label has ■. The beacon
   would earn its place if it were the thing visible from the far end of the corridor when the label is too small.
   At its width it is not. Fix: as 1; then judge it again at the 3 m still.

## 1c. fx-warp — findings

1. **Calm flights still streak.** `r11-fx-warp` frame 4 (10.2 s, into CLOUD, calm) and frame 9 (25.9 s, towards the
   calm cluster at left): full streak fields. Warp means "going somewhere that matters"; spent on calm, it means
   nothing. Fix: T15 (calm flights quiet).
2. **The best warp frame is the one that ends at a crit plate.** Frame 6 (16.4 s, VM-C) and frame 11 (32.1 s): the
   streaks are gone and the plate is up; the arrival reads. What is missing is the inverse: the leaving. Fix (taste):
   leaving a crit, a short reverse streak so the crit feels left behind, not cut away.

## 1d. touch — what I saw (gesture stills, not a continuous film)

1. **Explore looks like the tour.** `r10-t4-back/03-site.png` and `05-back-home.png`: the only sign a finger is in
   charge is the `‹ BACK` box. Nothing tells a passer-by that the screen is in someone's hands, or when the tour
   comes back. Fix: T5 (`MANUAL · TOUR IN 0:40`), and the tour's return as an event (the camera rises, the kicker
   types `TOUR`).
2. **The fan is a list, not an instrument.** `r8-t3-fan/04-fan.png`: six grey boxes with six leaders bundled into one
   knot at HV1; trouble rows only differ by a small ▲. Fix: rows carry the member's status as a left edge in its hue
   (trouble only), trouble rows first on their arc, leaders as short elbows that do not cross.
3. **Back home is good.** `05-back-home.png` returns to the pose left (T4). The ease (`04-back-easing.png`) has no
   rhythm to it I can see in a still; I score it on the poses.

## 2. Across the variants (what one does that the others should steal)

- warp's arrival (streaks stop, the plate is up) is the only place the camera has a beat. The galaxy without fx should
  steal the beat, not the streaks: a 300 ms settle on arrival at trouble, then the type.
- The touch sheet (`r10-t4-back/03-site.png`: plate left, leader down to the red planet, system right) is the best
  composition on the page; the tour's calm holds should steal it (plate left with a real line, system larger right).
- beacon's idea (a vertical mark that carries trouble where colour does not at 3 m) should be stolen by the folded
  crit cluster itself (For the owner, r4), if the beacon stays a hairline.

## 3. Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 6
score galaxy touch 6
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 7
score fx-warp wow 6
score fx-warp calm 4

Notes: status 6 because a new crit is easy to miss as it happens (finding 1) and warn and crit look alike at 3 m
(finding 6). Performance is a guess: 11.7-13.1 fps under SwiftShader at cpu x4 says nothing about the Surface.
Touch is scored on the gesture stills of r7, r8, r10 (tap a site, drag, crowded tap, back).

## 4. The 3 m check

`r11-3m.png` (frame 9 of `r10-galaxy`, 684 px wide). **Yes.** The red `■ HV1 · VM-C` banner and the red cluster at
HV1 say "wrong, there" at once; the yellow CLOUD says "a second, lesser thing"; REMOTE, HV2, DEMO-HOST, HOME and
CLOUD read. Two cautions: `HV1` is cut by its own cluster (finding 7), and without the banner the red and the yellow
nebula would be nearly equal (finding 6).

## 5. console.txt

- `r10-galaxy/console.txt`: empty (0 lines).
- `r11-fx-beacon/console.txt`: empty (0 lines).
- `r11-fx-warp/console.txt`: empty (0 lines).
- `r10-t4-back/console.txt`: empty (0 lines).
- `r8-t3-fan/console.txt`: empty (0 lines).
- `r7-t2-taps/console.txt`: empty (0 lines).

## What would make it unforgettable

1. `fx=alert`. You see: the moment trouble starts, one thin ring in its hue goes out from the site across the
   galaxy's plane, once, and the banner types the new name in letter by letter. It means: a site's rollup rose
   (calm → warn, warn → crit) since the last map frame; it never plays for trouble that was already there, never
   repeats, never during a finger (§2.1: the newest trouble is the loudest moment, then it settles to the nebula).
2. `fx=lost`. You see: a member that lost contact goes dark from inside, its sphere fades to an outline with a gap
   in it, the crit hue stays on the outline and the ■ stays on the label. It means: "no contact for N s" is a
   different failure from "on fire": the machine is not shouting, it is silent. The outline's gap grows with the
   time since last contact (capped), so a fresh loss and an hour-long one look different from the hallway.
3. `fx=recent`. You see: on a calm hold, the planet names type in one by one, the most recently changed first; a
   member untouched for over a day keeps no label until touched. It means: the order of the letters is the order of
   last change (each node's newest stamp), so the calm screen tells me what moved today without one line of text,
   and it reuses the spelling-out the owner loves. Trouble members keep their labels from the first frame.
