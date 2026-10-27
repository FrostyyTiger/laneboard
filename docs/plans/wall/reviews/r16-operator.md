# Review r16: operator, three metres away, night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). The last Wall commit is eaae256 (T7, r15), so films older than
that do not count for the galaxy without effects.
- `r16-galaxy/`: `galaxy.html?demo=1&quality=0`, large fleet (`demo-fleet.mjs --size large`, port 7796), filmed this
  round after T7. 12 frames over 35 s, cpu x4.
- `r16-galaxy-wall/`: the same with `&pace=wall` (the real tour speed). Operators film this one: it is the only one
  that shows how long I wait for trouble.
- `r16-fx-beacon/`: `&fx=beacon`, filmed this round.
- `r15-galaxy-warp/`: `&fx=warp`, filmed in r15 after T7, so current.
- Touch, as CDP gesture stills: `r13-t5-manual/` (tour, easing, wake, explore, a site, `▶ TOUR`, handed back) and
  `r10-t4-back/` (drag, tap a site, back to the pose). No touch code changed after T5.
- `r16-3m.png`: `r16-galaxy/frame-09.jpg` (overview, 25.6 s) at a quarter width, 684 px.

My question for every frame: I glance across the room with a coffee in my hand. What do I know now, and is it true?

## 1. galaxy — findings, worst first

1. **The headline changes while nothing changed.** `r16-fx-beacon` frames 1-6 say `■ HV2 · STORAGE`, frames 7-10
   say `■ HV1 · VM-C`, frame 11 says `HV2 · STORAGE` again. Same two crits the whole time. `r15-galaxy-warp`: frame 1
   `HV1 · VM-C`, frames 3-12 `HV2 · STORAGE`. Why it matters: I glance twice in a minute, see two different red
   headlines and think a second thing broke, or that the first one cleared. The banner is the line I read from the
   kitchen; it must be stable while the fleet is. Fix: T8 as written (fixed order, oldest first,
   `■ 2 CRIT · HV2 · HV1`). It is the most important open task for me.
2. **With two crits the banner says "one".** Same frames: the bottom right names one crit in big type and a `+4 MORE`
   in type I cannot read at 3 m (`r16-3m.png`: a smudge). From the kitchen it reads as one problem. Fix: with T8 the
   count leads the line (`■ 2 CRIT`) at the banner's size; drop `+N MORE` at the overview or make it the same step as
   the reason line.
3. **A crit at the overview is smaller than a warn.** `r16-3m.png` and `r16-galaxy` frame 9: HV2's red nebula is a
   small tight blob; HV1's yellow nebula (attention, warn) is taller and brighter. Without the banner I would look at
   HV1 first. The loudest thing is the wrong one. Fix: T23 (crit ≥ 1.5x warn, warn still).
4. **The crit planet sits in a knot of yellow labels at the edge of the frame.** `r16-galaxy-wall` frame 11 (29.2 s,
   `VM-C` down): the red lock is at the top edge of the system, under the sun and the tag, wrapped by
   `acme-billing`, `search ui`, `fix-login`, `ci-retry`, `■ bc`. The lock overlaps `acme-billing`. From 3 m I see red
   type on the left and a yellow sparkle cluster on the right; I cannot point at the broken machine. Why it matters:
   "where" is half of the 3 s test. Fix: while a member is the hero, frame the system so that member is near the
   system's centre-left, not at the frame edge (the held framing should centre on the subject, not the star), and
   calm the other labels near the lock (warn labels stay, but step aside from the lock's box: no label inside the
   brackets).
5. **The new crit arrives as a swap in the middle of a hold.** `r16-galaxy-wall` frames 9-10: the camera holds
   `FEAT-SEARCH` (attention) at 26.0 s, then at 29.2 s the same plate says `VM-C · NO CONTACT FOR 15S` and the kicker
   turns `DOWN`. Good that it follows. But there is no beat: hero, kicker, banner size all change in one frame. If I
   looked at 26 s and again at 32 s I would not know anything new happened, only that the screen says different
   words. Fix: T22 (a new trouble types in once); the plate's hero retypes too when its subject rises.
6. **Ten seconds of overview before the first crit.** `r16-galaxy-wall` frames 1-3 (0.6-6.8 s): overview, then
   `STORAGE` at 9.9 s. Acceptable, because the overview already shows the red banner and the red cluster. Then the
   crit is held still for 14 s (frames 4-8): the same plate, nothing moves. That is fine for me; I only note that the
   tour does bring me to trouble first, every cycle (`r16-fx-beacon` frame 11: `VM-C TARGET 01`, frame 12: `STORAGE
   TARGET 02`). No fix.
7. **A site name eaten by its nebula, again.** `r16-galaxy` frame 9 and `r16-3m.png`: `▲ HV1` ends in the yellow
   blob (`HV1` reads `HV1>`); `r16-fx-beacon` frame 10: `■ HV` with the `1` under the red glow. Fix: T24.
8. **A red line points off the screen.** `r13-t5-manual/04-site.png`: a red hyperlane from HV2 runs to the bottom
   right edge and out. From across the room it looks like a second alarm with no name. Fix: hyperlanes stay grey at
   every zoom (night 3's Later, r46-skeptic galaxy 8).
9. **The sun's name sits on the tag.** `r16-galaxy` frame 3, `r16-fx-beacon` frame 3, `r16-galaxy-wall` frame 9:
   `DEMO-HOST` and its sun drawn over `LANEBOARD · DEMO-HOST LIVE`. The tag is where I would look for `STALE`. Fix:
   the tag's box is a cover for map labels (as the plate is) and the flight keeps the sun out of the tag's corner.
10. **Calm holds tell me nothing, and that is almost right.** `r16-galaxy` frames 5-7 (CLOUD with no plate at all,
    REMOTE, HOME with a cursor). For me a calm hold is fine as long as the banner stays: it does. Fix, small: the
    calm plate says `ALL CLEAR` or one fact under the name, so the glance knows the plate is not still loading.

## 1b. fx-beacon — findings

1. **The pillar is a hairline, and it leans.** `r16-fx-beacon` frame 1: one thin red line rising from HV2 to the
   upper left; frame 10: two lines, HV2's leaning left, HV1's leaning right. At `r16-3m.png` scale these are 1 px
   scratches. It does point at trouble from far away, which is the only job I care about, but a scratch is not loud.
   Fix: a width floor in screen px (at least 6 px at 2x), screen-vertical (night 3's Later, r41-operator fx-beacon 1, 2).
2. **Two crits, two equal beacons, no order.** Frame 10: I cannot tell which crit is older or worse. Fix: age as
   width (planned), so the old one is thicker.

## 1c. fx-warp — findings

1. **During the out-flight the whole galaxy is red scratches.** `r15-galaxy-warp` frame 9 (26.0 s): red streaks over
   the left half, over HV2 and DEMO-HOST. A glance at that second says "everything is red". Fix: T21 (cone, a quarter
   of the count, hue only on the tips, none over a crit's disc).
2. **It does tell me the next target is red before the plate does** (frame 4, 10.1 s): useful, keep the tint, lose
   the coverage.

## 1d. touch — findings (stills, not a gesture film this round)

1. **I cannot tell explore from tour across the room.** `r13-t5-manual/04-site.png`: `MANUAL · TOUR IN 0:55` is the
   tag's small mono. The `‹ BACK` box is the only big cue. If someone left it in explore I would not know the tour is
   paused. Fix: in explore the kicker says `MANUAL` in the plate's kicker (night 4's Later, r4-film-ui touch) and the
   corner brackets go `--text-2`.
2. **A tap on a site gives a good sheet.** `04-site.png`: hero, reason, status, hardware: readable at 1.5 m. Back
   returns to the dragged pose (`r10-t4-back/05-back-home.png`). No fix.

## 2. Across the variants (what one does that the others should steal)

- warp's tint toward the destination tells me where the camera is going before the type does: the plain galaxy
  should steal a minimum of it on trouble flights (night 3's Later, r51-touch across), without the streak coverage.
- beacon's vertical mark is the only thing that says "here" without colour from 3 m: the folded crit cluster itself
  should steal that (a vertical, a size step), since the nebula is currently smaller than a warn's.
- The touch sheet frames the subject next to its plate with a straight leader (`04-site.png`); the tour's two-trouble
  holds (`r16-galaxy-wall` frame 11) should steal that framing: subject near the plate, not at the edge.
- The wall-pace tour's echo drop (banner shrinks or leaves while the plate names the same problem, frames 4-8 and
  10-12) is right; the banner should be just as disciplined when the camera is elsewhere (finding 1).

## 3. Rubric

score galaxy overview 6
score galaxy legibility 7
score galaxy status 5
score galaxy touch 6
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 7
score fx-warp wow 6
score fx-warp calm 3

Notes: status 5 because the headline changes subject with two crits standing (finding 1) and the crit nebula is
smaller than the warn one (finding 3); the tour order itself is right. Legibility 7: hero, banner and site names
read at 3 m; `+N MORE`, the date and the `MANUAL` line do not. Touch is scored on gesture stills (`r13-t5-manual`,
`r10-t4-back`), not a gesture film. Performance is a guess: 12.3-13.6 fps under SwiftShader at cpu x4 with worst gaps
306-424 ms says little about the Surface; nothing I saw stuttered between frames.

## 4. The 3 m check

`r16-3m.png` (frame 9 of `r16-galaxy`, overview, 684 px wide). **Yes, but only through the banner.** `■ HV2 ·
STORAGE` and `POOL 97% FULL` read; the red `■ HV2` beside a red blob says where. All six site names read (REMOTE, HV2,
DEMO-HOST, HV1, HOME, CLOUD), though `HV1` is cut by its nebula. Two problems: the yellow HV1 nebula is the bigger,
brighter cloud, so without the banner my eye goes to the warn first (finding 3); and `+4 MORE` and the date under the
clock are unreadable smudges.

## 5. console.txt

- `r16-galaxy/console.txt`: empty (0 lines).
- `r16-galaxy-wall/console.txt`: empty (0 lines).
- `r16-fx-beacon/console.txt`: empty (0 lines).
- `r15-galaxy-warp/console.txt`: empty (0 lines).
- `r13-t5-manual/console.txt`: empty (0 lines).
- `r10-t4-back/console.txt`: empty (0 lines).
