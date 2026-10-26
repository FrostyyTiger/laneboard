# Review r24: the touch user

Round 24, night 1. Persona: touch. One finger, standing, no keyboard, no mouse, no hover.

What I judged: only `radial` exists (T11-T14 not built). The newest film is `$RUN_DIR/shots/r22-radial/`
(`radial&demo=1`, 12 frames over 102 s, CPU 4x, SwiftShader wrapper), shot after T9's commit 1fc2f71,
the last commit under `public/js/wall` and `public/css/wall.css`. T10 (a8aae66) changed only the Map
module behind options that default off and the Wall does not use, so I did not shoot a new one. I read
the sheet, frame 7 (HOME, zoomed) at full size and the still `r22-still/custom-dark-1368.png` (overview,
2736x1800, so 1368 CSS px wide at 2x, 1 CSS px about 0.19 mm per Q6). Sizes below are measured on those
images and converted to CSS px at 2x. I read the input code: `public/js/wall/*.js`, `public/wall.html`,
`public/css/wall.css`, and the ambient branch of `public/js/views/map/index.js`.

The touch explorer is night 2 (D4). The Wall takes no input today. So this review has two parts: what a
finger does to the page now, and what radial's layout makes easy or hard for the explorer.

## radial

1. **A tap does nothing, and nothing says so.** In ambient mode the Map sets `pointer-events: none` on its
   canvas (`index.js` line 200). Every Wall layer (glow, frame, lock, caption) is `pointer-events: none`
   too. No Wall module adds a pointer or touch listener (`main.js` listens to `visibilitychange` and the
   socket only). A finger on HV2's red node lands on `.wall-stage`, and nothing happens: no flash, no
   pause, no ripple. To me the screen is dead glass, and I walk away thinking it is broken. Fix for night
   2: one `pointerdown` listener on the stage. It answers within 100 ms with a visible mark (a lock
   bracket snapping to the nearest node or site), then pauses the tour. Until the explorer exists, a tap
   could at least show a quiet one-line "touch explorer: night 2" toast, or do nothing on purpose. Either
   way, decide it.

2. **A pinch or a palm can zoom the whole page, and the Wall cannot undo it.** The viewport meta has no
   `maximum-scale`. No element sets `touch-action` (only the app's `.map-canvas` does, and that canvas
   takes no events here). So a two-finger brush, a sleeve, or a palm on a tablet browser zooms the page
   viewport. The clock and the fleet line slide off-screen, and the Wall stays like that until someone
   pinches back. This is the one harmful accidental touch, and it is a guess from the code: I did not test
   it on a device. Fix: `touch-action: none` on `.wall-stage` (the explorer handles pinch itself, or
   ignores it). Ignore pointer events once more than two pointers are down, or when `width`/`height`
   is over ~30 mm (a palm). Add `contextmenu` → `preventDefault` so a long press opens no menu.

3. **The biggest word on screen, the fleet line, is not a button.** `■ HV2 · STORAGE · POOL 97% FULL`
   (still, bottom right) is about 470x40 CSS px of text plus the `+4 MORE` line. Frame 7 shows the
   two-line form, about 380x70 CSS px. It is where my eye and finger go first ("take me there"). Fix: make
   the fleet line the first explorer target. A tap flies to the worst node (not only its site, see T25)
   and opens its sheet. Give it a hit box of at least 79 CSS px high (15 mm, Q6 table) from the text's
   right edge to the screen edge. `+4 MORE` opens the list of the other problems, each row 53 px or more.

4. **At the overview, only sites can be reached by a finger. Leaves cannot.** Measured on the still: the
   home lights sit about 17 CSS px apart (3 mm). The cloud row and the hv2 fan are about 25-30 px apart.
   A node's drawn circle is about 20 px (leaf) to 31 px (site). All of these are below the 53 px (10 mm)
   minimum, but the sites are far apart. The closest pair is HOME and REMOTE, about 72 px centre to
   centre; REPOS sits about 55 px from HOME. So a hit circle of 53 px per site fits, and 79 px does not.
   Fix: at the overview, a tap resolves to the site (or the trouble node, if one lies within 53 px of
   the finger). Leaves are tapped only after the camera is in that site. Move REPOS (a toured-only-in-
   trouble pseudo-site) away from HOME, or give it no hit target at the overview.

5. **Zoomed in at 2.3, the home lights are still too close for a finger.** Frame 7 (HOME): FRONT-DOOR,
   THERMOSTAT, PRINTER-3D, PORCH-LIGHT, KITCHEN-, LIVING-, DESK- and HALL-LIGHT sit in one column about
   36 CSS px apart (7 mm), at the finger-contact floor. Your finger covers two of them. The services
   under hv1/hv2 in frames 2-3 are about 50-55 px apart: just enough. Fix: in the explorer, zoom further
   (or spread the column) so the pitch is 53 px or more. If two hit circles overlap under the finger,
   show a small chooser with both names (two rows, 53 px each) instead of guessing.

6. **The caption plate covers half of the site it names, so those nodes cannot be reached.** Frame 7:
   FRONT-DOOR, THERMOSTAT, PRINTER-3D (the one with the progress ring, the most tappable thing in the
   home) and PORCH-LIGHT sit under the plate's right edge, readable only as ghost text. Either the plate
   takes the tap and the node is unreachable, or the tap goes through to a node I cannot see. Fix: T30's
   focus offset (subtree in the free two-thirds) is a touch fix too. In the explorer, the plate becomes
   the detail sheet and takes taps (scroll, close). Nothing under it may be a target.

7. **There is no "back" yet, and the system back gesture will leave the page.** No Wall code uses
   `history`. In a kiosk browser, the Android edge swipe (or a mouse-less "back") navigates away from
   `wall.html`, or does nothing. Fix: on the first explorer tap, push one history entry; `popstate`
   = back to the overview and the tour. Also add a visible Back control of 79 px or more (15 mm, Q6),
   always in the same place. The top-left kicker line is a natural spot, since the plate becomes the
   sheet. Do not put it bottom left: the clock is there, and so is your palm when you hold the tablet.
   A tap on empty ground does nothing (Q6). Back is the only way out, plus the timeout.

8. **Targets move under the finger.** The ambient turn (`amb.drift`) never stops at the overview. A tour
   flight lasts 2.25 s, and the camera keeps following a node while the layout settles (`follow`). A tap
   aimed at a node can land 20-40 px away by the time it lifts. Fix: hit-test at `pointerdown` with
   `map.screenOf` from that frame, freeze the drift and the tour at `pointerdown`, and keep them frozen
   until the explorer times out.

9. **The tour resumes trivially, because it never stops.** `createTour` has `start`/`stop` and nothing
   pauses it on input, so walking away loses nothing today. Fix for night 2: one idle timer, reset on
   every `pointerdown`. It fires after 45-60 s (Q6 proposal, D4 says a minute). Show the countdown as a
   quiet shrinking line in the last 5 s. Then go back through the same "back" path (fit, caption out,
   tour from the worst site), so the two exits look identical. Trouble that starts during exploring
   must not pull the camera away from my finger. It updates the fleet line only.

10. **Nothing invites a touch.** No hint, no affordance. Nobody can find out the screen takes a finger.
    Fix (Q6): once per idle cycle, at the overview only, a small mono `touch to explore` in the tag line
    top right, in text-3. Never during a site visit, never over trouble.

## Across the variants

Only `radial` exists, so I have nothing to compare it with. Here is what each planned direction should
take from radial's touch facts, so the explorer has something to stand on:
- Radial's sites are far apart even at the overview (the closest pair is about 72 px): a site-level tap
  works with no zoom. `islands` should keep a gap of at least 53 px between islands. `orbits` must not
  put two planets closer than that on the short axis of its ellipses.
- Radial's dense columns (home lights, the cloud row) show where a layout fails a finger. `hex mosaic`
  (Q5) will have tiles under 10 mm (Q6 says so too), so it needs the site fallback from finding 4 from
  the start.
- The fleet line is the same in every variant (T9). Make it the shared first target in all of them.

## Rubric

score radial overview 4
score radial legibility 3
score radial status 5
score radial touch 1
score radial wow 5
score radial calm 4
score radial performance 6

Notes on the scores: touch 1 because a tap does nothing and a pinch can break the page. Overview 4: from
arm's length I can find the five sites as targets, but no leaf. Calm 4: the turn and the flights never
stop, which is fine to watch and bad to touch. Performance is a guess from T9's script time (6.7 ms a
frame at 4x); this VM's fps number does not measure the page.

## Console

`r22-radial/console.txt`: empty (0 lines).
`r22-still/console.txt`: empty (0 lines).
