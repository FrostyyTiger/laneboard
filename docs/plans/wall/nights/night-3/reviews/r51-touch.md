# Review r51, persona: touch (night 3)

One finger, standing, no keyboard, no hover. Judged on:
- `shots/r51-touch` (my filmstrip of the gestures, `tools/r38-resume.mjs` on the current code, `--size large`,
  `galaxy.html?demo=1&quality=0`, 1368x912 = the Surface's CSS size): tour → first touch → overview → drag →
  tap HV1 → sheet → BACK → idle 30 s, 57 s → tour resumes.
- `shots/r51-sheettap` (my script `tools/r51-sheettap.mjs`): a palm on HV2, a 600 ms press on HV2, a tap on the
  fleet banner, a tap on a sheet row.
- `shots/r51-spacing` (`tools/r51-spacing.mjs`): member spacing in open systems, in screen px.
- `shots/r49-galaxy` (tour, newest after T30), `shots/r46-galaxy-beacon` and `r46-galaxy-warp` (fx.js, scene.js
  and camera.js unchanged since).
- The code: `galaxy/touch.js`, `galaxy/main.js` (taps, back, resume), `wall.css` (pointer-events, `.galaxy-back`).

What works, as facts for triage, not praise: the first touch is swallowed and lands on the overview; a palm
(radius 90) and a 600 ms press on HV2 did nothing (`03-palm-on-hv2`, `04-longpress-hv2`); page scale 1 and
scroll 0 throughout; BACK is 126x80 CSS px (about 24x15 mm on the tablet); the tour came back by itself after the
minute, crit first (`10-resumed`).

## galaxy

1. **The sheet hides the crit in the site I tapped.** `r51-sheettap/06-hv1-sheet`: the banner says
   `■ HV1 · VM-C`, so I tap HV1. The sheet's hero is the yellow `▲ FEAT-SEARCH`, `STATUS 2 attention · 1 warn`,
   and no row names VM-C, while `■ vm-c` and `■ bc` are red in the system beside it. I tapped to find out what is
   wrong and the sheet tells me something milder. Same in `r51-touch/05-detail`. This is T24 + T27; for the touch
   user it is the worst thing on the page. Fix: build `sheetCaption` from the model at the moment of the tap and
   on every new model (T24), hero = the site's worst member (T27); do T24/T27 before any other touch polish.
2. **The sheet is transparent to the finger.** In `06-hv1-sheet` I tapped the row `FIX-LOGIN · asked a question`
   (505, 403). The page opened **CLOUD** (`07-tap-sheet-row`): CLOUD's star was under the sheet, every overlay is
   `pointer-events: none`, and `pick` hit-tests stars through the text. A finger on a row of the thing it is reading
   throws it to another site. A tap on the sheet where no star is would instead be "empty sky" and close the sheet.
   Fix: in `main.js pick`, a point inside the plate's box (`hud.covers()`), the fleet line or the clock is never a
   star nor sky; a tap on a sheet row whose subject is a member opens that member (`openPlanet`), anywhere else on
   the plate does nothing. Test: a tap inside the plate's box with a star under it opens nothing.
3. **Most planets cannot be reached.** `r51-spacing`: in HV1's open system all 41 members have a neighbour
   nearer than the 54 px finger disc (fix-login / feat-search 8 px apart, dns-dhcp / dns-resolver 3 px); HV2 23 of
   24; home 7 of 12. With "worst tone, then nearest", a calm planet next to a trouble one can never be picked,
   and two trouble planets 8 px apart are a coin toss. Pinch does not help: a steered pose folds every system
   (`camera.js` steer), so zooming in shows a folded cluster. Fix (pick one): (a) when a tap's disc holds two or
   more members, fan them out on a ring of 48 px targets round the finger for the next tap; or (b) the site sheet
   lists its trouble members as rows of at least 48 px height that open them (needs 2); or (c) a pinch on a held
   site keeps it open and scales the system. Test: on the large fixture every trouble member of HV1 is reachable
   by some tap.
4. **The loudest thing is not a target.** `05-tap-banner`: a tap on `■ HV2 · STORAGE` at the overview did nothing
   (camera unchanged). The banner is 684x105 px, the first thing my eye and finger go to. Under a sheet the same
   tap is "empty sky" and goes back a step. Fix: a tap in the fleet line's box opens its subject (site, then the
   planet), `+3 MORE` opens a list; T35's ground can stay as is for this.
5. **No way back to the tour, no sign that I am driving.** At the overview BACK hides (`02`, `07`-`09`); the
   frames at 30 s and 57 s idle look like a paused tour. A person who walks up later cannot tell the screen is
   in manual and will come back by itself, and I cannot hand it back with a tap. Fix: in `explore` at the overview
   the same 80 px control reads `▶ TOUR` and resumes at once; under the tag a small `MANUAL · TOUR IN 0:40`
   (Later r36-dreamer touch 1) for the last 20 s.
6. **BACK forgets where I was.** `r51-touch/03-dragged` turned the galaxy (yaw ≈ -2.4); `06-back` flies to the
   default fit, not my view. T29. Fix as written there.
7. **The sheet still talks like the tour.** `06-hv1-sheet` kicker `ATTENTION · TARGET 01 / 05` (it was `02 / 05` a
   minute earlier for the same site); `07` types `CLOUD` with a block cursor after my tap. T25. Fix as written.
8. **Planet names are too small to aim at.** `05-detail`: `search ui`, `fix-login`, `vm-a` in mono about 10 px
   high; their label boxes are targets, but a 10 px word is not a 9 mm target and not readable at arm's length
   standing. Fix: in a system opened by a tap, trouble members' names at the room step's 2x (≥ 2.2vmin), calm ones
   unchanged.
9. **BACK sits top right, the highest reach on a wall screen.** On a tablet under a monitor it is fine; on a
   screen on a wall it is the corner a short person reaches last. Fix: keep it, and also accept a two-finger tap
   anywhere as back (it is already never a tap nor a pinch without movement), documented in `docs/wall.md`.

## fx-beacon

1. The pillar is the most visible mark of the crit at the overview (`r46-galaxy-beacon` 0.7 s, 23.1 s), but a
   finger aimed at its top hits nothing: only the star's 54 px disc is a target. Fix: count the pillar's screen
   segment (foot to tip, 27 px wide) as HV2's target in `tapPoints` while `fx=beacon` is on.
2. During a held trouble system the pillar is faded (`beaconNear`); fine for touch, nothing to tap.

## fx-warp

1. After a tap the flight is the feedback that my tap worked; warp streaks (`r46-galaxy-warp` 7.0 s, 23.0 s) make
   that flight read as "going somewhere" and tint toward the target. Good for a finger; it needs T28's vanishing
   point toward the tapped site so I see the direction I chose. No touch-specific harm seen.

## Across the variants

- `fx-warp`'s tint toward the destination is the touch feedback the tap flight lacks without it: the base
  galaxy should steal a minimum of it for tapped flights (the brackets already close within ~400 ms, `04`).
- `fx-beacon`'s pillar is a better target than the star at the overview: the hit-test should steal its shape.
- The tour's hero layout (T20/T30: one headline, worst thing loudest) is what the touch sheet should steal: today
  the sheet has its own ranking and loses the crit (galaxy 1).

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 4
score galaxy touch 5
score galaxy wow 7
score galaxy calm 6
score galaxy performance 6
score fx-beacon wow 6
score fx-beacon calm 5
score fx-warp wow 6
score fx-warp calm 5

Touch is scored on `r51-touch` and `r51-sheettap`: every step of the plan's sequence works, but the sheet loses the
crit, a tap on the sheet flies elsewhere, and most planets cannot be picked. Performance is a guess for the tablet:
11.1 fps under SwiftShader (`r49-galaxy`), touch adds one `touchStep` per frame and a hit test only on a down.

## 3 m check

`shots/r51-3m.png` (the touch overview `r51-touch/02-overview`, scaled to 342x228, top of a taller image):
**yes** for "something is wrong and where": the red nebula with `■ HV2` and the yellow one with `▲ HV1` stand
out, and `■ HV2 · STORAGE` is the biggest text. Site names: HV2 and HV1 read by colour and shape; `REMOTE`,
`DEMO-HOST`, `HOME`, `CLOUD` are readable only just, the date under the clock and the tag not at all. For a
finger it also means the sites are well apart at the overview: no two site targets overlap.

## console.txt

- `shots/r51-touch/console.txt`: one line, empty (the script writes `logs.join('\n')` of an empty list; its run log
  says `errors []`).
- `shots/r51-sheettap/console.txt`: no lines.
- `shots/r49-galaxy/console.txt`: no lines.
- `shots/r46-galaxy-beacon/console.txt`: no lines.
- `shots/r46-galaxy-warp/console.txt`: no lines.
