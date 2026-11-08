# Review, round 10, film-ui (the film-interface designer)

Night 5, after T1 (6d278d7, spacing half and the rosette). What I looked at, all in `$RUN_DIR/shots/`:
- `r9-galaxy/sheet.png`: `galaxy.html?demo=1`, large demo, 12 frames over 32.5 s, cpu 4x, built at 6d278d7 (the
  newest wall commit), so still current. `perf.json` 34.5 fps, worst gap 198 ms.
- `r9-t1-overview_`, `r9-t1-hv1`, `r9-t1-hv2_open_1_`: stills at 1368 px.
- `r10-touch/sheet.png` (made this round, `tools/r10-touch.mjs` in `$RUN_DIR`, CDP `Input.dispatchTouchEvent` at
  1368x912): tour → tap on the sky (wake) → one-finger drag → tap HV2 → tap its crit planet `storage` → Back → Back.
  `steps.json` beside it.
- `r10-fx-<name>/sheet.png` (made this round): the five `fx` films, `?demo=1&fx=<name>`.
- `r10-3m.png`: the overview still at 342 px.

## galaxy

1. **The held shot is composed for the plate, not for the frame.** Frame 4 (9.3 s, HV1 held): the system sits in the
   right third, the sun's disc is on the tag at top right, and the left 60 % of the frame is black because the plate has
   not typed yet. Frame 12 (32.5 s): the plate fills the left 60 % and runs its bracket to x 1240 of 2000, the system
   is crammed into the right 35 %, and the bottom 25 % is empty sky. The shot looks unbalanced while the plate is
   missing and crowded once it arrives. Why it matters: in a film the camera lands on the subject, then the graphics
   arrive into space left for them. Here the camera and the plate take turns. Fix: frame the held system so its star
   sits on the right third line *vertically centred* (not high), and size the plate's bracket to its text plus one grid
   unit, not to a fixed box. T1b (the sun) is the first half of this; when it is done, film it again with the plate
   typed.
2. **The sun sits on the tag.** Frame 4 and frame 12: the sun's white disc covers `LANEBOARD · DEMO-HOST LIVE`. The
   brightest thing on screen is a mistake in the corner, where the eye goes after the plate. T1b already covers it.
   Fix as T1b says; failing that, `hud.covers()` should count the sun's disc and the camera should pitch until it is
   clear.
3. **The banner shouts over the shot it should serve.** In every frame where no plate shows (1, 3, 4, and the touch
   sheet's 00-04), `■ HV2 · STORAGE` in red caps is about 1/3 of the frame's width and the largest type on screen,
   larger than the held site's name. In frame 4 the camera is at HV1 (warn) while HV2's banner is the loudest thing in
   the frame, so the eye goes to HV2 in one corner while the camera is on HV1. Why it matters: one hero per frame. The
   banner is right at the overview (it is the trouble line, and from 3 m it is what you read). In a held shot it is a
   second headline. Fix: full size at the overview; at a hold where the plate is up, drop to the one-line size of frame
   12 (`2 CRIT · HV2 · HV1 …`), which already exists. Frames 5-11 do this. Frames 1-4 do not, because the plate is not up
   yet. Make the step depend on the camera holding, not on the plate.
4. **The type hierarchy collapses inside the plate.** Frame 12: `VM-C` (huge red) → `BUILDER-C NO CONTACT FOR 30S`
   (red condensed) → `HV1` (white, *smaller* than the line above) → three status lines in yellow/red condensed caps
   at the same cap height as the subtitle. That gives four sizes but only two levels, and the yellow attention lines
   compete with the red headline. `FEAT-SEARCH · WAITING ON A PERMIS…` is truncated at the plate's edge. Fix: three
   steps on one scale (headline 1.0, subject 0.42, facts 0.28 of the headline's cap height). Make the site name `HV1` the
   kicker's job (`DOWN · HV1 · TARGET 01/05`), not a free-standing white word. Facts set in the condensed face at
   the facts size, coloured only by their status mark and label (`▲ ATTENTION`), text in `--text-1`. Wrap instead of
   truncating, or let the plate grow one line.
5. **The plate's headline and the map label don't match.** Frame 12: the plate says `VM-C`, but the locked node's label
   on the map reads `bc` (lowercase mono, `■ bc`). From the sofa you cannot connect the headline to the thing the
   brackets hold. Fix: the lock's node label shows the same name as the plate's headline while the plate stands (or
   the plate uses the label's name and puts the other in the subject line).
6. **Planet labels are a second, weaker type system.** Frame 4, frame 12, the r9-t1-hv1 still: site names are
   condensed caps (good, typeset), but planet names are lowercase mono in mid-grey at about a third of their height
   (`proxy`, `registry`, `scratch`). They read as debug text and some cross orbit lines (`monitor`, `registry`). Fix: the
   same condensed face in caps at a step down, `--text-2` on the wall tokens. A 1 px dark halo (text-stroke under the
   fill) where a label crosses a line.
7. **The camera has no beat of stillness.** Across the sheet the rhythm is fly → open → plate types → fly again, at
   demo speed. The demo speed is fine for a video, but even here the opening of a system and the plate's typing happen
   in the same seconds (frame 2: the system is still unfolding while `STORAGE` types). Fix: arrive, hold ~0.4 s
   still with only the lock brackets closing, *then* start typing. T5's gentler open (2800 ms smootherstep) will help;
   the plate should start at the open's end, not during it.
8. **The overview is good, but its composition leans.** `r9-t1-overview_`: the rosette is a clean ellipse, with the
   names in a clear set. The ring is centred left of frame, and the banner block (bottom right) is heavier than
   anything in the upper right, so the frame tips into its bottom-right corner. Fix: shift the galaxy's centre 3-4 %
   toward the upper right (`OVERVIEW_FIT.shift`) so the banner sits in space the galaxy left, not on top of the HV1–CLOUD arc.

Touch (`r10-touch`):
9. **Tapping a planet does not move the camera.** 06-tap-planet: the plate changes to `POOL 97% FULL / STORAGE` and a
   leader line runs to the planet, but the camera stays at the system hold, and `storage` sits at the system's edge
   behind other bodies. T9 (fly 45 % closer, planet left of centre) is the fix and is planned.
10. **The headline is inverted for a planet.** 06/07: the fact (`POOL 97% FULL`) is the huge headline, while the thing
   you touched (`STORAGE`) is a white subline. When a finger chooses, the name of what you touched is the headline; the
   fact is its subject. Fix: in explore mode the headline is the touched node's name, and the first status fact sits
   under it in its colour. The tour may keep fact-first for trouble.
11. **Back is good.** 08-back-1 returns to the site plate in one step. 09-back-2 goes to the overview with the camera
   kept where the drag left it. Its flights are smooth (`jump` 0.098 is the largest step per frame and shows no cut).
   One thing is wrong: the overview banner returns before the flight ends and its bottom is clipped by the frame
   in 09 (`HV2 · STORAGE` cut at the screen's bottom edge, at 3.2 s after the tap). Fix: the banner enters after the
   flight lands, from its own place, never sliding in from outside the frame.
12. **Wake works but says nothing for 300 ms.** 01-wake-300ms: the camera is already flying out, but there is no
   `MANUAL` line and no control yet. They arrive in 02. That is night 4's T62, still open (`## Later`).

## fx (each `?demo=1&fx=<name>`, `r10-fx-<name>/sheet.png`; the demo's trouble moves between films, so compare the effect, not the story)

- **beacon** (30.4 fps, worst 201 ms). Frames 1, 3, 10, 11: a thin red pillar rises from each crit cluster. At the
  overview it is the one vertical stroke in a horizontal composition. That is good graphic design: the eye goes up it
  to the crit. Worst: in frame 3 (6.4 s, flying to HV1) the pillar crosses the frame diagonally from the cluster to the
  top edge. It reads like a laser sight, not a marker. Its top fades to nothing, so the line has no end and no label (the
  "no red line without a name" rule). Fix: cap the pillar with a small mono tick and the crit's age (`2H 14M`) at its top,
  and in a flight keep it under ~1/4 of the frame's height on screen.
- **warp** (31.1 fps, worst 260 ms, the worst gap of the five). Frame 3 (6.6 s): short streaks round HV1 in the 30°
  cone, with the hue on the tips. In a still they read as dust, not motion. Frame 9 (24.0 s) at rest shows nothing,
  which is correct. Worst: the effect is now so restrained that the camera's rhythm gains nothing, and the 260 ms gap is
  the price. Fix: either let it be the flight's single moment of acceleration (streaks only in the middle 40 % of the
  flight, twice as long, then gone, the "anticipation → resolve" beat) or drop it. Half-measure is the worst of both.
- **afterglow** (32 fps). HV1's crit clears between frame 5 and frame 9 (24.2 s), and I cannot find the ring in any
  frame. Fix: none to judge until a film catches a clear. A test hook that clears a site at a known second would make
  the effect filmable (`?demo=1` could clear HV1 at 10 s).
- **activity** (30.4 fps, worst 261 ms). Frames 7-8 (18.3 s, 21.2 s, HOME): white breathing rings round working
  planets. At 18.3 s a ring sits inside the target-lock brackets and the two read as one confused mark. Worst: white
  rings are the brightest calm shapes in the frame, louder than the yellow `▲ API-PROD` in frame 5. Fix: rings at
  `--text-3` alpha, never inside a lock, and never on the held trouble member.
- **sweep** (31.8 fps). Frame 1 (0.6 s): thin ellipses round HV2, HOME and REMOTE, each pinged by the line. Frame 9
  (23.9 s): the line itself, a pale wedge from the sun down past HV1. It is the most "designed instrument" effect of the
  five: one slow motion with a clear meaning (who sent news). Worst: the pinged ellipses look like selection rings; a
  stranger reads "these three are chosen". Fix: a ping is a short dash arc that fades in about 1 s, not a closed ellipse,
  so it cannot be read as a state.

## Across the variants

There is one variant tonight (`galaxy`), plus the fx. Between the fx: `sweep` has the rhythm the others should steal (one
motion per cycle, with a beat before and after). `beacon` has the composition (one vertical against the plane). `warp`
and `activity` should take both lessons: one moment, one direction, then stillness. What the galaxy should steal from itself: frames 5-11 put the
plate up and shrink the banner to one line. That is the frame that reads as one designed instrument (kicker, name,
facts, one trouble line at the foot, clock bottom left: a clear grid of four corners). Frames 1-4 and the touch
sheet's 00-04 are the same page without that discipline. Make every held frame look like frame 9 (`HOME`, 23.7 s).

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 8
score galaxy touch 6
score galaxy wow 7
score galaxy calm 6
score galaxy performance 7
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 4
score fx-warp calm 6
score fx-afterglow wow 3
score fx-afterglow calm 8
score fx-activity wow 4
score fx-activity calm 5
score fx-sweep wow 6
score fx-sweep calm 7

## The 3 m check

`r10-3m.png` (the overview at 342 px): **yes.** The red square and `HV2 · STORAGE` in red caps read at once, and HV2's
red nebula on the ring tells you where. HV1's yellow glow is the second thing you see. The site names (`HOME`, `REMOTE`,
`DEMO-HOST`, `CLOUD`, `HV1`, `HV2`) are just readable, and the clock is too. The tag top right and `POOL 97% FULL` turn
to texture. That is acceptable for the tag but not for the banner's second line, which says what is wrong. Make it a step
larger or bolder.

## Console

- `r9-galaxy/console.txt`: empty (no lines).
- `r9-t1-overview_/console.txt`, `r9-t1-hv1/console.txt`, `r9-t1-hv1-rise1.0/console.txt`,
  `r9-t1-hv1-rise1.8/console.txt`, `r9-t1-hv1-rise2.2/console.txt`, `r9-t1-hv2_open_1_/console.txt`: empty.
- `r10-touch/console.txt`: empty.
- `r10-fx-beacon`, `r10-fx-warp`, `r10-fx-afterglow`, `r10-fx-activity`, `r10-fx-sweep` `console.txt`: all empty
  (film.mjs: 0 console/page errors each).
