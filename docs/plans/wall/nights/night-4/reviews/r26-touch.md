# Review r26: touch, night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). Last Wall commit d28aeac (T13, director state only, not
wired: the page is unchanged since T12). Filmed this round on the large demo (`demo-fleet.mjs --size large`),
`galaxy.html?demo=1&quality=0`, 1368x912 css px, through CDP `Input.dispatchTouchEvent` (real touch events, so real
pointer events with a contact size):
- `r26-touch2/` (the main run, `tools/r26-touch2.mjs`): tour, a drag wakes it, explore, tap HV1 (crit), its sheet,
  tap a crowded planet (fan), tap a fan row (planet sheet), a 160x120 px palm on empty sky, a fast 160 px "sleeve"
  swipe, a tap on empty sky (back one step), the back control (to the overview), a pinch in empty sky, walk away
  63 s, the tour again, a palm during the tour. `steps.json` has every target's box.
- `r26-touch/` (`tools/r26-touch.mjs`): the same with a pinch before the site tap; the pinch lost every site, so
  the site steps never ran. Kept for that finding.
- Tour and effects: `r25-galaxy/sheet.png` (newest, after T13, cpu x4, 13.1 fps), `r21-fx-beacon/`, `r21-fx-warp/`
  (`fx.js` is unchanged since night 3, so these still count).
- `r26-3m.png`: `r26-touch2/12-back-control.png` (the overview in explore) at a quarter width, 342 px.

I stand at the tablet with one finger. No hover, no keyboard. Sizes below are css px; the tablet runs at 2x, so
48 css px is about 9 mm.

## 1. galaxy: findings, worst first

1. **A pinch can lose the whole galaxy, and the only control is `▶ TOUR`.** `r26-touch/04-pinched.png`: one
   pinch (fingers 88 → 388 px apart, about 4x) from the middle of the overview zoomed into empty dust between the
   sun and CLOUD. No star, no name, one grey lane. `r26-touch2/12b-pinched.png` is the same: a black field with a
   yellow blob cut by the corner. The place is still `overview`, so the control reads `▶ TOUR`, and empty sky does
   nothing at the overview. To get the whole galaxy back I must pinch out blind, or give the page back to the tour.
   Why it matters: a finger that wanted "a bit closer" now has nothing to tap and no way home. Fix: (a) the zoom
   clamps by what is in frame, not only by `ORBIT.near`: a pinch stops closing in once no site's anchor is within
   the frame (or eases back so the nearest site stays in it); (b) in explore with a steered pose, the control reads
   `⌂ ALL` (back to the fit), and only a fitted overview reads `▶ TOUR`; (c) a tap on empty sky with a steered
   overview eases back to the fit.
2. **A palm wakes the page and stops the tour for a minute.** `r26-touch2/16-palm-in-tour`: a 160x120 contact
   during the tour turned it into explore (`MANUAL · TOUR IN 1:00`) and snapped the camera to the overview. The
   palm test (`isPalm`) runs only for taps (`createTaps`); `createTouch`'s `down` wakes on any pointer. On a wall
   tablet a shoulder or a sleeve going past does this, and the tour (trouble first) stops for 60 s with nobody
   there. Not harmful to the fleet, but it hides the show for a minute. Fix: in `createTouch` `down`, a palm-sized
   contact (`isPalm(ev)`) does not wake; it may be swallowed so it does nothing at all. Test: a palm down/up in the
   tour leaves the mode `tour`.
3. **A fast sleeve swipe throws the held planet out of frame.** `r26-touch2/10-after-brush.png`: a 160 px swipe
   over about 70 ms near the bottom edge turned the camera. HV1's system left the frame. The sheet stays up, the
   lock's corner hangs in empty sky (the bracket at about 770,540), and a red nebula smear is at the top with no
   name next to it. The orbit starts after a 12 px slop and coasts with inertia, so a brush moves it a long way.
   Fix: a drag must start with the finger held still for `ORBIT.stillMs`-ish (80 ms) or move under a speed cap in
   its first 100 ms; a flick that starts at full speed within 40 px of the screen's edge is not a drag. While a
   planet sheet is up, a drag that takes the held member out of frame ends with the camera easing back so it is in
   frame (or closes the sheet; no sheet without its subject on screen).
4. **Sheet rows are 39 px high, under the 48 px floor.** `r26-touch2/steps.json` at `06-site-sheet`: the hero is
   711x157 (fine). The two attention rows (`feat-search`, `fix-login`) are 711x39 at a 48 px pitch. These are the
   rows I am most likely to tap ("which one is waiting on me?"). About 7 mm on the tablet. Fix: `caption.js`
   `targets()` pads each row's box to at least 48 px tall, centred on the row, never past half the gap to the
   next. Or give the row `min-height: 48px` in `wall.css` (the plate grows by 18 px). Test: every `targets()` box is
   ≥ 48 px tall.
5. **Nothing says the touch registered for the first 1.5 s.** `r26-touch/01-wake-250ms.png`: 250 ms after the
   wake tap the camera is moving, the plate is gone, but there is no `MANUAL` line and no back control until the
   ease ends (`02-explore`, about 2 s). A standing user who tapped once sees the screen "do something on its own"
   and taps again. That second tap lands in explore and may open whatever is under it. Fix: show
   `MANUAL · TOUR IN 1:00` and the control the moment the wake lands (the countdown may hold at 1:00 until the
   ease ends), plus a 72 px ring at the finger fading over 300 ms (the fan's `galaxy-fan-spot` already exists).
6. **The site tap's feedback is good: keep it.** `05-tap-200ms`: within 200 ms the lock brackets close on HV1, the
   back control turns to `‹ BACK` and the countdown resets to `1:00`. That is the standard; finding 5 asks the wake to
   meet it.
7. **Fan rows: trouble not first, and cryptic names.** `07-fan.png`: a tap on `acme-docs` (11 planets inside
   54 px: the median nearest neighbour in open HV1 is 13 px) fanned `vm-b`, `acme-docs`, `docs-refresh`,
   `▲ fix-login`, `ba`. The fan works (every row 48 px, 60 px pitch, a row opened `VM-B`'s sheet in one tap,
   `08-planet`). But the one row I want is 4th, and `ba` means nothing from a metre. Fix: order the rows by tone
   then by distance (= r11-dreamer touch 2 in Later); a row's text is the planet's display name, never a short id
   under 3 letters (fall back to its kind + parent: `builder · vm-b`).
8. **A tap held over 300 ms does nothing, silently.** `TAP.ms` 300 (`touch.js`). Standing users, older users and
   anyone tapping a glass wall often press for 300-500 ms. Too long, and the tap is dropped with no feedback, as if
   the screen were dead. Fix: `TAP.ms` 500 (a drag is already told apart by the slop, not by time); a long press
   that is not a drag does the same as a tap.
9. **At the overview there are 5 site targets and they are easy.** `12-back-control.png`: the stars sit 100-300 px
   apart, each with a name that is also a target (`tapPoints`), and the 27 px disc is plenty. The banner is a
   target too (T2). No change needed.
10. **Back is always there in explore, and walking away works.** `11-sky-back`: a sky tap took the planet sheet
   back to HV1's site sheet. `12-back-control`: `‹ BACK` (126x80, about 15 mm) to the overview. `13-idle-30s`
   counted `0:28`, `14-idle-63s` was the tour again, at its next leg (CLOUD, warn), from where the camera was.
   `09-after-palm`: a palm on empty sky with a sheet up did nothing (good: no step back). In the tour there is no
   back control, and none is needed. The first touch is the way in, and nothing under it opens: in `r26-touch2`
   the waking drag started on a site and opened nothing.
11. **The banner keeps the top step under a planet sheet.** `08-planet.png`: `■ HV1 · VM-C` at about 100 px under
   the yellow `DEPS-BUMP` sheet. Two big words compete for my next tap. T19 already covers this; it matters to
   touch because the banner is a target too, so I hit it when I mean the plate. With T19's smaller line the two
   targets also stop crowding each other.

## 1b. fx-beacon: findings (`r21-fx-beacon`)

1. The pillar is a target (T2) and it is the tallest thing on the overview: from 0.4 s and 22.9 s, HV2's beam
   runs about 100 px up. Good for a finger. But in a flight (`6.2 s`, `9.0 s`) it is gone or partial, so the target
   moves between frames. Fix: none for touch beyond T2. Under a finger the camera does not fly, so the pillar is
   steady when I want it.
2. It points at the crit from far away, and that helps someone walking up to tap. No further touch finding.

## 1c. fx-warp: findings (`r21-fx-warp`)

1. Warp plays only in flights, and a finger never needs to tap during a flight. Under touch, a tapped site's
   flight with streaks is fine as feedback ("going there"). Calm flights should not streak (T15). No touch finding
   beyond that.

## 2. Across (what one does that the others should steal)

- The site tap's 200 ms response (brackets close, `‹ BACK`, countdown resets) should be the wake's response and the
  fan's response (the fan has its ring; the wake has nothing).
- The fan's rule "keep off the words" (T3) should apply to any drag result: the held subject never ends under or
  off the edge (finding 3).
- `fx=beacon`'s pillar as a target is the model for every trouble mark: make the loudest thing the easiest tap.
  The crit nebula itself (`r26-touch2/05`, HV1's red cloud about 60x120 px) should count as its site's target as
  well, not only the star's 27 px disc and the name.

## 3. Rubric

Touch was scored on the gesture runs above (`r26-touch2`, `r26-touch`), not as a guess.

score galaxy overview 7
score galaxy legibility 7
score galaxy status 7
score galaxy touch 6
score galaxy wow 7
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 6
score fx-warp calm 4

Touch is 6: every node is reachable within two taps, back is big and always there, and the tour comes back. It
loses points for a pinch that loses everything with no way home, palms and sleeves that act, 39 px sheet rows,
and a silent 1.5 s after the wake. Performance is a guess from SwiftShader (13.1 fps at cpu x4, worst gap 307 ms);
the owner measured it fine on the Surface.

## 4. The 3 m check (`$RUN_DIR/shots/r26-3m.png`, 342 px wide)

**Something wrong and where: yes. Site names: mostly no.** The yellow nebulae at REMOTE (top) and HV1 (right) are
the only colour on screen and read at once. The yellow banner bottom right is the biggest type and reads as
"something is yellow", but its words do not resolve. The site names (`HV2`, `HOME`, `CLOUD`, `DEMO-HOST`) are about
4 px tall at this size: I can tell they are words, and only `REMOTE` and `HV1` read, because their hue helps. The
`▶ TOUR` box reads as a box, not as words. For touch this is fine: from 3 m I know where to walk to and what to tap.

## 5. console.txt

- `r26-touch/console.txt`: empty (no lines).
- `r26-touch2/console.txt`: empty (no lines).
- `r25-galaxy/console.txt`: empty (no lines).
- `r21-fx-beacon/console.txt`: empty (no lines).
- `r21-fx-warp/console.txt`: empty (no lines).
