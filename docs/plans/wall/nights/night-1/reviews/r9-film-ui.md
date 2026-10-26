# Review r9: the film-interface designer

Round 9, night 1. Persona: film-ui (composition, type system, camera rhythm, one instrument, wow).

What I judged: only `radial` exists (T4, commit 68c058b). The newest film (`r7-radial`) was shot 6
minutes before that commit, so I shot a new one: `$RUN_DIR/shots/r9-radial/` (`radial&demo=1`,
12 frames over 96 s, CPU 4x, SwiftShader wrapper from the PROGRESS filming note) and a still at
1368 (`$RUN_DIR/shots/r9-radial-still/`), both on `demo-fleet --size large`. The tour, caption, lock,
glow and frame (T5-T9) are not built yet. So this is a review of the ground: the Map in ambient mode,
full screen. Most of what follows is what the ground must give the layers that come next.

## radial

1. **There is no shot, only a diagram.** All 12 frames are the same picture (0.5 s to 95.9 s on the
   sheet): a slow turn and nothing else. A camera has no subject, no move in, no hold, no resolve.
   From three metres it reads as a screensaver of a network graph, not as an instrument with
   intent. Why it matters: the brief's whole emotional hook ("it zooms in ... gets spelled out") is
   missing, and that hook is what makes a stranger stop. Fix: T5 before anything cosmetic. When it
   lands, give the move a phrase: about 0.6 s of anticipation (the turn eases to a stop and the target
   brightens), the flight on one ease-in-out curve, a beat of stillness (about 0.4 s) on arrival
   *before* the lock closes and the name starts typing, then the hold. Out: the caption fades first,
   then the camera leaves. One thing moves at a time.

2. **Type has no hierarchy: everything is "a font, small".** In frame 6 (full size 2736x1824) the
   site names (`HV1`, `HV2`, `HOME`, `CLOUD`, `REMOTE`), the services (`KITCHEN-LIGHT`, `SECRETS`) and
   the lanes (`FIX-LOGIN`) are all the same condensed caps, about 14 device px cap height, same weight,
   same white. That is 1.3 mm on the 12.3" tablet: readable at about 25 cm (research Q3: 5.8-6.4 mm
   of cap height per metre). A site and a light switch get the same voice. Fix: three type steps,
   set on purpose, scaled from mm via `devicePixelRatio` (Q3):
   - sites: condensed semibold caps, cap height for 1.5-2 m (about 9-12 mm on the tablet), tracking
     +0.06 em, full text-1;
   - rooms: the same face one step down (about 4-5 mm), text-2;
   - services, leaves, lanes: no label at the overview (dots, as §5 allows); they get their names
     only when the camera is in that site.
   A frame with 6 big words reads in two seconds. A frame with 80 small words never does.

3. **Trouble is not the loudest thing on screen.** In the still, the crit (`STORAGE` ■ and `HV2`) is
   a red square about 20 px wide in the lower right, and the eye goes first to the yellow cluster of
   ▲ at the top (the lanes, `FIX-LOGIN`, `CI-RETRY`, `ACME-BILLING`) because it sits at the top edge
   and holds five marks. Crit loses the composition to attention. Fix (in the Wall, not the Map):
   a crit node gets the frame's only saturated area: a red halo on the glow layer (T8) a few times
   the node radius, the worst line bottom right (T9), and the tour goes there first (T5). Attention
   inside the lanes should stay at mark size at the overview; it is not the fleet's worst problem.

4. **The composition is top-heavy and spills off the top.** The lane fan at 000 runs to y≈30 px of
   1824 in frame 6 (`DEPS-BUMP` touches the edge), the bottom 25 % holds only the faint outer ring,
   and the left and right quarters of the 3:2 frame are empty dot grid. The weight of the picture is
   in the top-centre, where a caption (top left) and a tag (top right) will also go. Fix: for the
   overview, fit to the bounds of the drawn nodes and labels, not to the outer ring, and keep a
   safe area: 8 % top and bottom, 6 % at the sides, the top-left caption plate area kept clear at
   the overview. Lanes and runs (the outermost ring) can be hidden at the overview on the Wall;
   their trouble rolls up into the builder.

5. **Desk chrome reads as noise at distance.** The ring legends `LANE · RUN`, `BUILDER · SVC · PKG ·
   RUN`, `ROOM · REPO`, `SITE · RUN` (dim grey, along the rings) and the lane pips (tiny purple and
   yellow squares under `BUILDER-A/B/C`) are useful at a desk and meaningless from three metres:
   detail sold as density. The bearing dial (000/090/180/270) is the one piece of chrome that earns
   its place: it says "instrument". Fix: hide ring legends and pips on the Wall (T10 `rings: false`
   covers part of this); keep the dial, but make it a designed element: a thin tick ring with the
   four numerals at the Wall's small mono step, and let the turn read against it.

6. **Every node wears the same double halo.** Each service has two concentric rings around a grey
   disc (`DB`, `MONITOR`, `K8S-1` in frame 6), and the rooms add a progress arc whose meaning is not
   readable (`HOME`, `REMOTE`, `CLOUD`). Eighty identical ornaments flatten the picture: nothing is
   special because everything is decorated. Fix: on the Wall, calm services are plain dots with no
   halo; rooms one ring; sites a ring and their label. The halo becomes the sign of "look here":
   the focused node and the nodes in trouble.

7. **Labels drift and collide.** Between frame 6 and the 1368 still the labels of `BUILDER-B` and
   `BUILDER-C` swap places, `MAIL` and `OBJECT-STORE` are stacked under the wrong nodes, `TEMPLATE`
   floats with no node next to it, `FRONT-DOOR`/`THERMOSTAT` sit 60 px away from their node at the
   far end of an arc, and `PHONE-1`/`REMOTE` overlap. In a film, type that hops is the first thing
   an audience reads as "broken". Fix: on the Wall, labels at the overview only for sites and rooms
   (finding 2), which makes collisions rare; pin each label to a side of its node (outward from the
   centre) and do not re-place a label while it is on screen.

8. **The hairball at `HV1`.** About fifteen spokes converge on one point, crossed by dashed flow
   lines from the centre. It is the densest spot of the frame and carries no meaning beyond "hv1 has
   many children". Fix: draw room-to-service edges as short stubs (or not at all) at the overview;
   show the full fan only when the camera is inside that site, where it becomes the reveal.

9. **No frame around the picture.** No vignette, clock, tag, worst line: the graph floats on dot grid
   with nothing that sets the edges. It looks like a canvas, not a screen. That is T9; noted so the
   order of work is clear: the frame is what makes it a shot.

## Across the variants

Only `radial` exists, so nothing to steal between variants yet. What every variant should take from
this ground: the bearing dial (a real instrument cue, cheap), the restrained palette (grey, one
yellow, one red: the status language holds), and the quiet dot grid as ground. What every variant
should avoid from it: one label size for every level, ornaments on every node, and labels that move.

## Rubric

score radial overview 3
score radial legibility 2
score radial status 4
score radial touch 1
score radial wow 4
score radial calm 6
score radial performance 6

Notes on the scores: touch is 1 because ambient takes no input yet (D4 is night 2). Performance is a
guess: the film says 4.8 fps, but that is SwiftShader plus screenshots (PROGRESS filming note), and
the round-7 measure of 6.7 ms script per frame at 4x suggests the page itself is fine. Calm is 6 because
the slow turn is the only motion, which is calm but also empty.

## console.txt

`$RUN_DIR/shots/r9-radial/console.txt`: empty (0 lines; film reported 0 console/page errors).
`$RUN_DIR/shots/r9-radial-still/console.txt`: empty (0 lines; shoot reported 0 console/page errors).
