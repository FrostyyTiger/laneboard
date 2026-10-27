# Review r21: skeptic, night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). Last Wall commit c80e8a9 (T10). Everything below was filmed
this round on HEAD 72d8c1a, large demo fleet (`demo-fleet.mjs --size large`, its own port).
- `r21-galaxy/`: `galaxy.html?demo=1&quality=0`.
- `r21-galaxy-wall/`: the same with `&pace=wall`.
- `r21-fx-beacon/`: `&fx=beacon`. `r21-fx-warp/`: `&fx=warp`.
- `r21-touch/`: gesture stills (tour, first touch eases to the overview, explore, tap HV2, `▶ TOUR`, handed back),
  driven through CDP with `tools/r13-manual.mjs`, plus `sheet.png` of the seven.
- `r21-3m.png`: `r21-galaxy/frame-09.jpg` (overview, 22.6 s, two crits) at 684 px.

**All four films are at `--cpu 1`, not 4.** On this VM, this round, Chrome's CPU throttle stalls every page: at
1.5x, 2x and 4x, `galaxy.html` drew 1 frame in about 70 s, and `wall.html` (2D) stalled the same way. A probe at the
T9 commit (2b7cca8, before T10) stalled too, so the stall comes from the VM or Chrome, not from T10. At 1x the page
reports `scriptMs` 1.0-1.2 per frame. The fps below is SwiftShader at 1x, so it says almost nothing about the tablet.

My question for every element: what does it tell the viewer that nothing else on screen already tells them? If the
answer is nothing, remove it.

## 1. galaxy: findings, worst first

1. **The banner still changes subject with the camera, for anything milder than crit.** `r21-fx-warp`: frame 3
   (6.0 s, flying to REMOTE) says `▲ HV1 · FEAT-SEARCH · WAITING ON A PERMISSION PROMPT`, frames 4-11 say
   `▲ REMOTE · OFFICE-PRINTER · PAPER JAM`, and frame 12 (31.1 s, arriving at REMOTE) says `HV1 · FEAT-SEARCH` again.
   Both problems stand the whole time. T8 fixed this for crits only. Why it matters: the banner is the one line read
   from across the room. If it swaps while nothing changed, every glance says something new happened. Fix: T8's rule
   for every level. Rank by worst level, then by oldest (`firstSeen`), never by where the camera is. The echo rule
   (T9) may hide the line under its own plate but may not pick a different subject.
2. **The banner and the tour point at different places.** `r21-galaxy-wall` frames 1-4 (0.3-8.5 s): the banner
   names `REMOTE · OFFICE-PRINTER`. Then the tour flies to HV1 (`FEAT-SEARCH`, `TARGET 01 / 05`, frames 5-7) and
   REMOTE is never visited in the film. The headline tells the eye "REMOTE" while the camera says "HV1": two answers
   to "where". Fix: one ranking function feeds both the banner's subject and the tour's first target. If the tour has
   a reason to go elsewhere first, the banner leads with that.
3. **The crit member is grey inside its own lock, and the yellow members are the brightest thing in the system.**
   `r21-galaxy` frame 11 (28.2 s, `VM-C · BUILDER-C NO CONTACT FOR 37S`): the red brackets close round two dull grey
   spheres (VM-C, `bc`). Three yellow-haloed attention planets beside them glow. In `r21-fx-beacon` frame 12, 15 s into
   the same outage, the same planets had red rings. So something takes the colour off a down member after a while. The
   only red marks left at the planet are the brackets. Why it matters: at the site step, trouble must still be the
   loudest thing on screen (§2.1). Here the wrong status wins. Fix: a down or crit member keeps its red fill or ring
   at every step and every age. If "lost contact" is meant to look dead, show it as a red outline, never grey. While a
   crit is held, the yellow halos drop one step.
4. **The held crit blanks itself to update a number, and the number is wrong anyway.** `r21-galaxy-wall` frame 10
   (25.0 s): the VM-C plate has faded to about 20 % and shows the bare cursor block, mid-retype. The brightest thing
   on screen is then an unnamed yellow cluster in the middle (REMOTE's nebula, close to the camera, no label at
   all). Frames 8-9 say `NO CONTACT FOR 15S` at 19.5 s and 22.3 s; frames 10-12 say `19S` at 25.0, 27.8 and 30.5 s.
   Over 11 s of film the counter moved 4 s. Why it matters: a retype to say nothing new costs the one second a glance
   gets. A frozen counter on a "down" line is a false statement. Fix: a value change of the same problem updates in
   place, with no fade and no retype. Retype only when the subject or the level changes. Replace the ticking counter
   with a time that cannot go stale (`NO CONTACT SINCE 06:58`), or tick it on the client.
5. **Two VM-Cs, one in the wrong place.** `r21-fx-beacon` frame 12 (31.3 s): the plate's hero types `■ VM-C`. In the
   system, a big red `■ VM-C` label sits beside the HV1 star, half the system away from the lock and the member (see
   the crop of frame 12, upper right). T9 says the planet's label hides while a plate names it. This one is probably
   the site lobe's leashed name (T7), so it escapes that rule. Fix: `named()` also hides the lobe or site trouble label
   that carries the plate's subject. A red name is only ever drawn at its member.
6. **The trouble plate says the same thing three times.** `r21-galaxy` frame 11:
   - The kicker `■ DOWN · TARGET 01 / 05` repeats the hero's ■ and the reason's "no contact". `TARGET 01 / 05` tells
     the viewer nothing they act on. Remove both (the kicker is the owner's open question (a); my answer is remove).
   - The `STATUS ■ 1 DOWN ▲ 2 ATTENTION ▲ 1 WARN` row repeats the hero (1 down) and the two lines under it (2
     attention). Remove it from trouble plates.
   - `CPU 34 % · MEM 62 %` is HV1's load. It has nothing to do with VM-C being unreachable. `HOLDS 13 rooms` is 8 px
     type no one reads at 3 m. Remove both from trouble plates.
   - The two attention lines are set at the crit reason's size and weight, in yellow. They compete with the one red
     line that matters. Set them one step smaller.
   What remains, hero, reason, site and one line per other problem, is the whole message.
7. **In explore, the sheet and the banner say the same words at the same time.** `r21-touch/04-site.png`: the sheet
   reads `■ STORAGE / POOL 97% FULL / HV2`. The banner under it reads `■ HV2 · STORAGE / POOL 97% FULL` at full size.
   The tour already drops this echo (T9). Explore does not. Fix: run `bannerEcho` for the explore sheet as for the
   tour plate.
8. **`+N MORE` flickers and cannot be read.** `r21-galaxy` frames 1-12 read `+3, +3, +4, +3, +3, +3, +4, +4, +3, +4,
   +5, +5 MORE`. `r21-3m.png`: a smudge. A number that changes every few seconds in type nobody can read is motion
   without meaning. Same for the fleet facts line `5 SITES · 115 NODES · 6/7 WORKING` (`r21-galaxy-wall` frames 1-7,
   tiny and flickering 6, 7, 6, 7). Fix: remove `+N MORE` from the overview banner (the count of crits already leads
   the line). Show the milder count, if at all, as a stable number that changes only when a problem starts or clears.
9. **The tag repeats the sun, and the sun sits on it.** `LANEBOARD · DEMO-HOST LIVE`: `LANEBOARD` tells a viewer
   nothing about their own wall. `DEMO-HOST` is the sun's label, and in `r21-galaxy-wall` frame 10 and
   `r21-fx-beacon` frame 12 that label is drawn right above the tag in larger type. Only `LIVE`/`STALE` carries
   information. Fix: the tag is `LIVE` or `STALE 2M` only (T27 covers the overlap; the owner's open question (c) is
   which name stays; my answer is the sun's).
10. **The site's red nebula, opened, is a stain in the wrong place.** `r21-galaxy` frame 11: a red-brown wash spreads
    under the lower half of HV1's system (monitor, dns, registry, all calm), while VM-C is at the top. At the site
    step the plate and the lock already say which site. The wash only says "somewhere around here", and points at the
    calm half. Fix: when a system opens, its nebula fades out, and the trouble member's own glow carries the colour.
11. **Calm holds repeat the star's label as a plate.** `r21-galaxy` frame 5 (`CLOUD▌` plate, and `CLOUD` at the
    star), frame 8 (`HOME▌` and `HOME`). Frames 6-7 (REMOTE) have no plate at all. A typed name the star already
    shows carries nothing. The owner's question (b) stands. My answer: one fact line (`8 rooms · 2 working · last change
    14m`) or no plate. The name alone should go.
12. **The date under the clock is unreadable at 3 m** (`r21-3m.png`, `TUE 27 OCT` is a grey line). The clock is fine:
    a wall clock is a reason to look at the wall. Fix: remove the date, or set it at the clock's step.
13. **HV1's name is eaten by its own nebula at the overview** (`r21-3m.png`: `■ HV(`). T24, still open.

## 1b. fx-beacon: findings

1. **Still a hairline, and it is the fourth mark for the same crit.** `r21-fx-beacon` frames 1, 9 and 10: a 1-2 px
   red line leaning up-left from HV2. HV2 already has a red nebula, a red `■ HV2` label and the banner. In frame 12,
   HV1's beacon runs up through the DEMO-HOST region toward the tag. What does it tell the viewer that is not already
   on screen? Nothing at the overview, where every site is in frame anyway. Fix: give it a job, or remove it. The one
   job it could have is age (width or height grows with time in crit, as Later has it), so two crits read in order.
   Without that, remove (the owner's question (d)).

## 1c. fx-warp: findings

1. **Streaks over the whole galaxy on a flight out of the overview, and on calm flights.** `r21-fx-warp` frame 10
   (25.4 s): both arms are covered in fine yellow-white streaks. From 3 m the plane looks scratched, and the tint
   reaches HV2 and DEMO-HOST, which are not the destination. Frame 3 (6.0 s): a wall of streaks across the middle on
   the way to REMOTE. Frames 6-7 (to CLOUD, calm): streaks again. T15 and T21 are open and cover this. It is still the
   worst motion on the page.
2. **Its one fact arrives a second later anyway.** The destination hue is the only information. The plate and the
   lock give it 1-2 s later, and on 3 of 5 flights (calm) the streaks carry no hue at all. Fix: streaks only on
   flights to warn or worse, in a cone toward the target (T21). Otherwise remove.

## 1d. touch: findings (`r21-touch`, gesture stills through CDP, filmed this round)

1. **Explore echoes the banner** (finding 7 above).
2. **`MANUAL · TOUR IN 0:54` is the only sign the tour is paused, and it is tag-sized** (`02-wake`, `03-later`).
   `▶ TOUR` is a clear box. From 3 m nothing says "someone left this in explore". Fix: as in r16's touch 1, the kicker
   says `MANUAL`, or the `▶ TOUR` box carries the countdown at its own size.
3. The gestures work as filmed: first touch eases to the overview, tap HV2 gives the sheet, `▶ TOUR` hands back
   (`06-handed-back`). No fix.

## 2. Across the variants (what one does that the others should steal)

- The tour's echo discipline (galaxy frame 11: under VM-C's plate the banner names the *other* crit) should go to the
  explore sheet (finding 7) and to every level of trouble (finding 1).
- The two-crit banner (`■ 2 CRIT · HV2 · HV1`, `r21-3m.png`) is the best line on the page: count first, then the
  places. The single-warn banner should take the same form (`▲ 2 ATTENTION · HV1 · REMOTE`) instead of choosing one.
- The touch sheet (`04-site.png`, subject beside its plate, straight leader, no kicker noise) is the plate the tour's
  trouble holds should use once the redundant rows go (finding 6).
- beacon could steal from warp the one honest idea warp has: say something before the plate does. A beacon that grows
  with age says "oldest" before any text.

## 3. Rubric

score galaxy overview 7
score galaxy legibility 7
score galaxy status 5
score galaxy touch 6
score galaxy wow 6
score galaxy calm 4
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 3

Notes. Overview 7: the 3 m still works (below). Status 5: the banner flips between warns (1), the banner and the tour
disagree (2), the crit member is grey (3) and a counter is frozen (4). Calm 4: a retype for a number, `+N MORE`
flicker, warp's scratches, and calm holds that type a name already on screen. Touch is scored on this round's gesture
stills (no gesture film tool exists; the stills are taken through CDP pointer events). Performance is a guess: the
page spends about 1.2 ms of script per frame at 1x, and the films (13.8-15.7 fps, worst gap 341-383 ms) are
SwiftShader at 1x, because the 4x throttle stalls on this VM.

## 4. The 3 m check

`r21-3m.png` (`r21-galaxy` frame 9, overview, two crits, 684 px). **Yes.** `■ 2 CRIT · HV2 · HV1` reads in one look
and says how many problems and where. Red `■ HV2` and `■ HV1` beside red nebulae point at them. All six site names
read (REMOTE, HV2, DEMO-HOST, HV1, HOME, CLOUD). `HV1` is cut to `HV(` by its nebula (T24). `STORAGE · POOL 97% FULL`
reads. These do not read: `+3 MORE`, the date, the tag. None of them is missed (findings 8, 9, 12). The two crit
nebulae are about the same size now, so nothing points the eye to the wrong one first.

## 5. console.txt

- `r21-galaxy/console.txt`: empty (0 lines).
- `r21-galaxy-wall/console.txt`: empty (0 lines).
- `r21-fx-beacon/console.txt`: empty (0 lines).
- `r21-fx-warp/console.txt`: empty (0 lines).
- `r21-touch/console.txt`: empty (0 lines).
- `r21-probe/console.txt` (the 2-frame probe at 1x that found the throttle stall): empty (0 lines).
