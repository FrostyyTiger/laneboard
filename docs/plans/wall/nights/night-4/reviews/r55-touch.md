# Review r55: touch, night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). The last Wall commit is a7751f7 (T46; T45 and T46 changed the
shared `frame.js` and `main.js` after r50's films), so I filmed everything again on HEAD 29b721b:
- `r55-galaxy`, `r55-fx-beacon`, `r55-fx-warp`, `r55-fx-afterglow`, `r55-fx-activity`, `r55-fx-sweep`:
  `galaxy.html?demo=1&quality=0&pace=wall[&fx=<name>]` on `demo-fleet.mjs --size large --tick 800`, SwiftShader, cpu x4,
  12 frames over about 52 s (`$RUN_DIR/r55-film.sh`, r50's with new names).
- `r55-touch`: real touch events through CDP `Input.dispatchTouchEvent` at 1368x912 css px. Run 1
  (`tools/r55-touch.mjs`, `steps.json`, stills 00-19): tour → a 160x120 palm → pinch out → empty sky → pinch back →
  a 500 ms press on HV2 → tap HV2 → its sheet → a 160 px / 70 ms sleeve swipe → empty sky → `▶ TOUR` → 61 s.
  Run 2 (`tools/r55b-touch.mjs`, stills 20-23): a show (pin + highlight) under the tour → a tap on the pinned card →
  a pin sent while a finger drives → the ✕. Run 3 (`tools/r55c-touch.mjs`, stills 24-26): tap HV1 (lab, 41
  members) → its sheet's target boxes → a tap in a crowd → the fan → a fan row.
- Older, still current for what it shows: `r47-half-e` (half a screen), `r48-t42-role` (`?role=explore`).
- `r55-3m.png`: `r55-galaxy/frame-01.jpg` (the overview in the tour) at 342 px, a quarter of 1368.

I stand at the tablet with one finger. No hover, no keyboard. Sizes are css px; the tablet runs at 2x, so 48 css px
is about 9 mm.

Run 1 note: the HV2 crit cleared in the demo just as I opened HV2 (`09-site-sheet`: `ok · all 24 calm`; `13-sky-back`
has HV2 grey). That is the demo's trouble coming and going, not a wrong sheet.

## 1. galaxy: findings, worst first

1. **One touch wipes everything the agent showed, including the card I wanted to read.** `20-show`: a pin
   (`LOOK HERE / a note from the film`) and a highlight (`what it breaks`) sit beside STORAGE, with `SHOWN BY FILM` and
   two ✕ rows. I tap the card itself, the thing a person walks up to touch. `21-card-tapped`: the camera snaps to the
   overview, the cards, rings and both rows are gone, nothing says they were there. The card is
   `pointer-events: none`, so the tap is a first touch, and `main.js` `wake` calls `shows.drop()`. Then
   `22-show-in-explore`: a new pin sent while I drive is refused (`ok: false, code: "busy"`). So the agent can never
   point at something for the person standing in front of the screen. That is the cockpit's main use (README §7 Night 4
   B). A palm (finding 2) does the same wipe. Why it matters: D10 says a finger beats a show *for the camera*. Pins and
   highlights do not move the camera, so a finger has no reason to remove them. Fix: (a) the first touch ends only a
   `flyTo` (the director's show); pins and highlights stay with their ✕ rows. (b) In explore, `pin`, `highlight` and
   `clear` are accepted; only `flyTo` answers `busy`. (c) A tap on a card or a highlight ring is a tap on its node:
   in explore, it opens the node's site, then the node, as a sheet row does (T1). Test: a show up, a wake, the pin
   still drawn; a pin sent in explore is `ok`.
2. **A palm still wakes the page (T32, open).** `01-palm-in-tour`: a 160x120 contact on empty sky during the tour. 800 ms
   later the mode is `easing`, the director is `touch`, and the tour has stopped for a minute. With finding 1, the same
   sleeve also clears the agent's cards. `isPalm` is used only in `createTaps`. `createTouch` `down` wakes on any
   pointer. Fix: T32 as written. Also, a palm-sized down never calls `wake` or `shows.drop()`.
3. **A pinch still loses the whole galaxy (T31, open).** `04-pinched`: two fingers from 44 to 344 px apart in the
   middle. Not one site anchor is in frame (`sitesInFrame: []`), only one grey lane. The control still reads `▶ TOUR`.
   `05-sky-after-pinch`: a tap on empty sky does nothing at the overview, as before. The only ways back are a blind
   pinch out or giving the page to the tour. Fix: T31 as written (clamp by what is in frame; `⌂ ALL` on a steered
   overview; empty sky eases back to the fit).
4. **A sleeve swipe still throws the open system off and leaves its sheet up.** `12-after-sleeve`: HV2 open with its
   sheet, then a 160 px swipe in 70 ms along the bottom edge. The system is now a folded blob at the top centre. Its
   planets are gone, and the plate still lists HV2's hardware and rooms for a thing I cannot see or tap. `want: free`.
   r26 3 is in Later. Fix: a drag that starts within 40 px of the screen's edge at full speed is not a drag. While a
   sheet is up, a drag that takes the subject out of frame ends with an ease back, or it closes the sheet.
5. **Sheet rows are still under the 48 px floor (T33, open).** Run 3, the HV1 (lab) site sheet `targets()`: the hero is
   670x145 (fine), `fix-login` 39 px tall, `deps-bump` 39 px, `db` 29 px. These rows are the ones I tap for "which one
   is waiting on me?", and the `db` row is about 5 mm on the tablet. Fix: T33 as written. The show's ✕ (finding across)
   shows how a row should be built.
6. **The fan covers the trouble it should help me reach.** `25-fan`: a tap in a calm crowd at HV1's right edge
   (`monitor-logs`, 7 neighbours within 27 px) fans 8 calm rows to the left (48 px tall, 60 px pitch: good). The
   `dhcp` and `resolver` rows land on `deps-bump`, `ci-retry` and `search ui`. Those are three of the site's six
   trouble planets, and their `▲` marks peek out half under the boxes. The fan keeps off words (T3), but not off
   trouble. Fix: in `fan.js` placement, count each trouble member's 27 px disc and its label box as blocked, with the
   words. When both arcs are blocked, prefer the arc that covers fewer trouble discs.
7. **The wake is still silent for over a second.** `01-palm-in-tour` (800 ms after the down): `easing`, no
   `MANUAL` line, no control, nothing at the finger. r50's run had the same at 700 ms. Compare `08-tap-200ms`, which
   is the standard: 200 ms after a tap on HV2, the lock closes on it, `‹ BACK` is up, and the countdown reads `1:00`.
   A standing user who sees the screen "move on its own" taps again, and that tap lands in explore. Fix: r26 5 from
   Later. Show the line and the control as the wake lands, and draw the fan's `galaxy-fan-spot` ring at the finger.
8. **A 500 ms press does nothing.** `07-longpress-site`: a still finger on HV2's star for 500 ms. No flight, no
   lock, no sheet (`want: free`, the control still `▶ TOUR`). An older or careful user presses that long. Fix: r26 8
   from Later (`TAP.ms` 500; a long still press that is not a drag is a tap).
9. **After the wake, what I touched is gone.** `00-tour` holds the STORAGE crit plate on HV2. A finger that touches the
   red planet gets the overview (`21-card-tapped`, the owner's C1, kept) with nothing marking where the tour was. It
   then takes a tap on HV2 and a tap on the hero to get back to what I touched. Fix (keeps the snap): at the overview
   after a wake, the site the tour held keeps dim lock brackets for 5 s, so the next tap is obvious. Or, a wake whose
   down landed on the held system's target opens that site straight after the ease.
10. **The sun's name sits on the tag, beside BACK.** `24-big-site-sheet` and `25-fan`: `DEMO-HOST` is drawn over
    `LANEBOARD · DEMO-HOST LIVE` and the `MANUAL` line, 60 px above `‹ BACK`. A finger aimed at the sun or at BACK
    has two targets stacked there. Fix: T27 as written (the tag is a cover for map labels).
11. **The banner corner is empty during the crit hold** (`r55-galaxy` frames 5-6, 19-24 s). When I walk up, the
    clock's corner does not tell me what to tap. T55 covers it.

## 1b. fx-beacon (`r55-fx-beacon`)

1. The pillar is up at the overview (frames 1-2, a red line about 70 px above HV2) and is a target (T2). In holds it
   is gone, which is fine under a finger. No new touch finding.

## 1c. fx-warp (`r55-fx-warp`)

1. Only in flights. A finger never needs to tap during a flight. Calm flights stay quiet (T15). No touch finding.

## 1d. fx-afterglow (`r55-fx-afterglow`)

1. No trouble cleared in this 52 s window, so no ring is in the film. From the code and r40/r50, the ring is outline
   only on the plane and is not a target. Nothing to tap, nothing to hit by mistake. No touch finding.

## 1e. fx-activity (`r55-fx-activity`)

1. The slow ring on a working planet shows at the overview (frames 2-3 on HV2's and CLOUD's stars). It is not a target,
   and the ring reads like the lock's "selected" brackets. A finger may tap it expecting a sheet for the job. Fix:
   none for touch as long as a tap on the ring opens its site; a ring wider than the star's 27 px disc should count
   as the site's target (not measured this round).

## 1f. fx-sweep (`r55-fx-sweep`)

1. The sweep wedge (frame 1) passes at the overview only, and it is not a target. No touch finding.

## 2. Across (what one does that the others should steal)

- The show's ✕ (`20-show`) is the model touch target: exactly 48x48, one per row at a 56 px pitch, and it never reaches
  the stage, so it cannot wake or step back by accident. The sheet rows (finding 5) and the fan rows should take its
  build: a real box of at least 48 px whose events stop there.
- The site tap's 200 ms answer (`08-tap-200ms`: lock, `‹ BACK`, `1:00`) should also be the wake's answer (finding 7).
- The fan's "keep off the words" rule should grow into "keep off the words and the trouble" (finding 6). The same goes
  for show cards, which in `20-show` sit beside STORAGE but over `gpu-box`'s side of the system.
- `fx=beacon`'s pillar as a target remains the model for every trouble mark: the crit nebula should be its site's
  target too (r26 across, still in Later).

## 3. Rubric

Touch is scored on the gesture runs above (`r55-touch` runs 1-3), not as a guess.

score galaxy overview 7
score galaxy legibility 7
score galaxy status 6
score galaxy touch 6
score galaxy wow 7
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 4
score fx-afterglow wow 5
score fx-afterglow calm 8
score fx-activity wow 4
score fx-activity calm 6
score fx-sweep wow 5
score fx-sweep calm 8

Touch stays at 6. Since r26: BACK keeps the pose (T4), `MANUAL · TOUR IN` and `▶ TOUR` (T5), trouble planets reachable
in two taps by the fan (T3), and the plate is no longer transparent to the finger (T1). All of these work here. But all
three of r26's tasks (T31 pinch, T32 palm, T33 rows) are still open and reproduce. The show added a new way for one
touch to throw away what someone wanted to read. Performance is a guess from SwiftShader (14.7 fps at cpu x4, worst
gap 276 ms in the last 10 s); the owner measured the Surface as fine.

## 4. The 3 m check (`$RUN_DIR/shots/r55-3m.png`, 342 px wide)

**Something wrong and where: yes. Site names: yes, barely.** The red `■ HV2 · STORAGE` banner is the largest thing
and reads at once, and its red square matches the red cloud at HV2 top left. The yellow `▲ HV1` cloud on the right
is the only other colour. All six names (`REMOTE`, `HV2`, `DEMO-HOST`, `HV1`, `HOME`, `CLOUD`) can be made out at
about 5 px. They read because there are only six, they are well apart, and the trouble ones carry their hue. The
`POOL 97% FULL` reason reads; `+3 MORE`, the tag and the date do not, and they do not need to. For touch this is
enough: from 3 m I know to walk to the red one at the top left.

## 5. console.txt

- `r55-galaxy/console.txt`: empty (no lines).
- `r55-fx-beacon/console.txt`: empty (no lines).
- `r55-fx-warp/console.txt`: empty (no lines).
- `r55-fx-afterglow/console.txt`: empty (no lines).
- `r55-fx-activity/console.txt`: empty (no lines).
- `r55-fx-sweep/console.txt`: empty (no lines).
- `r55-touch/console.txt` (run 1): empty (no lines).
- `r55-touch/console-c.txt` (run 3): empty (no lines). Run 2 stopped on my script's error after still 23 and wrote no
  console file. Its lines were not collected, so I cannot say it was clean.
