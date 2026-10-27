# Review r4: film-ui (night 3)

Persona: film-interface designer. Material: `shots/r3-galaxy` (`galaxy.html?demo=1&quality=0`, filmed after
68d02f0, the last Wall commit) and my own `shots/r4-fx-beacon` (same URL `&fx=beacon`, large demo, 12 frames
over 75 s, CPU x4, SwiftShader). Frame numbers are 1-12 in each sheet. Touch is not built yet (T7-T14 open).

## galaxy

1. **The caption names a target the camera is not on.** fx-beacon frame 7: `TARGET 05 / 05 · HOME` typing,
   while the camera passes REMOTE with its name in big caps mid-frame and HOME is out of shot. r3 frames 8
   and 11: the plate is up with an empty cursor while the camera is already at HOME / CLOUD. Since T1's step
   back keeps a star in frame, the star in frame is often the *wrong* one, and the plate tells you a name
   you cannot find. On screen for two seconds, that reads as an error. Fix: start typing at flight progress
   ~0.9 (night 2's r54 4, now in Later); during a flight, dim passing sites' labels to `--text-3` and show
   the destination's name only.
2. **Two red headlines in one frame.** r3 frame 10: caption `■ VM-C` at hero size, top left; banner
   `■ HV2 · STORAGE` at the same size, bottom right. Two subjects, one colour, one size: the eye ping-pongs
   and neither wins. This is T4; it is still the worst typographic fault on screen. Fix as T4 says: the
   banner drops to `--cap-name` while a plate is up.
3. **The banner flips subject.** r3 frames 9-12 and fx-beacon 10-12: `HV2 · STORAGE` → `HV1 · VM-C` →
   back, with the `+N MORE` count jumping 3/4/5. At the overview the biggest type on screen changes meaning
   between cuts. A headline is a title card, not a ticker. Fix: rank crits by age (r15-dreamer 4, Later),
   hold the slab for a whole tour cycle, and show the second crit on the sub-line.
4. **Stray hard lines.** r3 frame 1, fx-beacon frame 1: a straight red line from HV2 to the top of the
   banner, crossing the hyperlanes at a random angle. r3 frame 10: a red leader from the caption plate's
   corner across empty sky to VM-C, through HV1's labels. These are the only hard red strokes in the frame
   and they look like scratches, not like a designed leader. Fix: one leader style (2 px, an elbow at 90°
   or 45°, a tick at both ends, r54 12), routed outside other labels; no banner-to-node tether at the
   overview, where the node already carries its glyph.
5. **Calm holds leave two thirds of the frame empty.** r3 frame 3 (CLOUD) and 8 (HOME): a small system
   jammed against the right edge, the left 60 % black except for the plate's two brackets. Member names
   (`edge-1`, `api-prod`, `thermostat`, `porch-light`) are at ~20 % contrast and overlap the lock
   brackets (`the|r|mostat`, `porch-|light`). Fix: frame the system in the space the plate leaves
   (r54 8, Later), bring calm member names to `--text-3` with no word under a bracket.
6. **Words at the frame edge.** r3 frames 2, 6, 10 and fx-beacon 9: `HV2` and `HOME` labels cut by the top
   edge or sitting on top of the caption's corner bracket; `DEMO-HOST` touches the tag line (r3 frame 10,
   fx-beacon 9). Fix: labels inside a safe margin and out of the plate/tag/clock boxes (Later A4, T31).
7. **A label leaves its body.** fx-beacon frame 8 (overview): `■ HV2` sits ~50 px below and left of its red
   nebula, which hangs alone. The glyph is the trouble's anchor; detached, it reads as a second object.
   Fix: anchor site labels to the projected star every frame, never to a stale screen point.
8. **The held trouble name twice.** r3 frame 6: `FEAT-SEARCH` hero in the plate and again at almost the
   same size in the scene. Fix: hide the held node's scene label while its caption is up (r54 9, Later).
9. **No galaxy at the overview.** r3 frame 1: five crumbs, a sun and three thin lanes; no arm, no band.
   Fine for status, nothing for wow. This is T3.

Rhythm across the strip: of 12 frames, 5 are mid-flight or show an empty plate (r3 2, 4, 7, 9, 11). At
demo speed that is expected, but nothing in the film shows a beat of stillness: the camera arrives, the
plate types, the camera leaves. The one frame that feels designed is r3 frame 6: a hero, a sub-line, a
table, a lit system, all on one grid. Make every trouble hold land there and stay there for one beat.

## fx-beacon

1. **At the overview the beacon does not show.** fx-beacon frame 1 vs r3 frame 1: the same picture. A
   young crit at the overview is where a beacon earns its place. Fix: T9's floor height (~0.25 of the frame
   at the overview) and a white core.
2. **Close up it is the best shot in the film.** fx-beacon frame 2: a red pillar with a soft tip over the
   held HV2. Its tip is soft, so nothing cuts it here; the plate was not up yet. Check that it stays uncut
   once the caption types (T9).
3. **It doubles the red glow.** fx-beacon frame 9: beacon, nebula and planet glow on HV1 merge into one red
   smear with the yellow members. Fix: the pillar thin and white-cored, the nebula behind it one step down
   while a beacon stands.

fx `lanes`, `comets`, `twinkle` were not filmed this round (no code change since night 2's r54; `lanes` goes
and the other two become `activity`, README §7 Night 3 D). Their scores below are carried from that film.

## Across the variants

- r3 frame 6's caption grid (kicker, hero, sub-line, two-column table, bars) is the house style; the banner,
  the clock block and the `+N MORE` chip should be set on the same grid and baselines.
- fx-beacon frame 2's pillar gives a crit a vertical silhouette nothing else in the scene has. Shape
  carries where colour does not: the folded trouble cluster at the overview could steal that silhouette.

## Scores

score galaxy overview 6
score galaxy legibility 6
score galaxy status 7
score galaxy touch 1
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 6
score fx-beacon calm 6
score fx-lanes wow 2
score fx-lanes calm 8
score fx-comets wow 3
score fx-comets calm 7
score fx-twinkle wow 2
score fx-twinkle calm 9

Touch: not built (T7-T14 open); 1 is a statement, not a judgement. Performance: SwiftShader on this VM gives
1.7-1.8 fps and says nothing about the page; the owner reports the Surface runs it well, so 6 is a guess.

## 3 m check

`shots/r4-3m.png`: r3 frame 1 (overview) at a quarter width (342 px; the black band below is padding).
**Yes.** The red square and `HV2 · STORAGE` read at once, and HV2's red nebula sits up left in the galaxy;
HV1's yellow triangle reads too. Site names (REMOTE, DEMO-HOST, HOME, CLOUD) are just readable as word
shapes. The tag and the date line are not, which is fine. Weakness: the red tether line looks like a crack
in the screen at that size.

## console.txt

- `shots/r3-galaxy/console.txt`: empty (no lines).
- `shots/r4-fx-beacon/console.txt`: empty (no lines); film.mjs: "0 console/page errors".
