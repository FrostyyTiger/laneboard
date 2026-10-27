# Review r20: the skeptic

Round 20, night 1. Persona: skeptic. Every element must say what it tells the viewer, or go.

What I judged: only `radial` exists (T11-T14 not built). The newest film, `r18-radial`, was shot two
minutes before T8's commit 01cd9f7, the last commit under `public/js/wall`. I shot a fresh one:
`$RUN_DIR/shots/r20-radial/` (`radial&demo=1`, 12 frames over 36 s, CPU 4x, SwiftShader wrapper from
the filming note). I read the sheet and frames 1, 2, 4, 7 and 8 at full size (2736x1824).
Frame times: 1 = 0.6 s overview, 2 = 3.7 s HV2, 3 = 6.9 s HV1, 4 = 10.1 s plate for target 03,
5 = 13.3 s, 6 = 16.4 s REMOTE, 7 = 21.1 s HOME, 8 = 24.1 s overview, 9 = 27.3 s HV2 again,
10-11 = flights, 12 = 36.3 s CLOUD.

The test I put to each element: what does it tell someone 3 m away, in 3 s? Most of the screen is
the desk Map's annotation, and nobody can read it from 3 m. Each item below names the element,
says what it carries, and gives a verdict.

## radial

1. **Edge labels carry no state. Remove them on the Wall.** `deploys`, `publishes`, `sensor data`,
   `offsite copy`, `dumps`, `clones`, `pushes images`, `same NVMe`, `reads and writes / promotes`
   (frames 2, 4, 7). They describe the topology. They never change and they never signal trouble.
   They also collide with real labels: `deploys` sits on the DEMO-HOST node (frame 4), `clones`
   on `demo hypervisor` (frame 2), `pushes images` on `metrics and logs` (frame 7). At 16 px they
   cannot be read from 3 m. Fix: a Map option (default off) that drops link labels, and the Wall
   sets it. If a flow link is in trouble, the trouble already shows on its end node.

2. **Sublabels repeat the name. Remove them, or keep only the ones that hold a number.**
   `KITCHEN-LIGHT / light`, `LAPTOP-1 / laptop`, `PHONE-1 / phone`, `MAIL / mail`,
   `SECRETS / secrets`, `MEDIA / media`, `EDGE-1 / edge`, `K8S-1 / cluster node` (frames 2, 4, 7).
   Each one doubles the text on screen and says nothing new. The useful ones are values:
   `pool 97% full`, `23 pods`, `lag 0s`. Fix: on the Wall, show a sublabel only when it holds a
   number, and at the overview only for nodes at warn or worse. This goes with T19.

3. **The dot grid fights the camera. Remove it, or make it move with the camera.** `--tex-dots` is
   on the fixed `.wall-stage` (`wall.css`). During every flight and the slow turn (frames 9-11),
   the graph moves while the ground stays still. So the screen does not read as one camera moving
   through space (north star 2). It reads as a layer sliding over wallpaper. The grid carries no
   information. Fix: drop the dots on the Wall and keep `--bg-canvas`. The vignette (T9) is a
   better quiet ground.

4. **Two bracket vocabularies mean two things. Remove the plate's brackets.** The caption plate
   has two corner brackets. On HV2 they are red, like the lock's (frame 2), and the bottom-right
   one sits next to `-HOST`, 300 px from the real lock. At a glance that looks like two targets.
   Brackets should mean one thing: "this is the node". The plate brackets add nothing that the
   plate's own edge does not already give. Fix: remove them, and keep the brackets for the lock
   only.

5. **The lock on a calm site tells nothing the camera has not already told.** Grey brackets close
   on HOME (frame 7), REMOTE (frame 6) and CLOUD (frame 12). The camera has already centred the
   site, and the caption names it. On HV2 (frame 2) the lock is on the site node. The node in
   trouble, `STORAGE pool 97% full`, sits 400 px to the right with no mark. So the lock spends
   its one job on the wrong node. Fix: lock only on trouble, on the worst node inside the site
   (T25). No lock on calm sites.

6. **The caption on a calm site is mostly a spec sheet.** HOME (frame 7): `CPU 9%`, `MEM 41%`,
   `WHERE hallway closet`, `HOLDS 9 rooms`. HV2 (frame 2): `HARDWARE 24-core · 192 GB · 1 GPU`,
   `WHERE rack 2`. Hardware and where never change, so nobody needs them more than once a year.
   `HOLDS 9 rooms` counts what is on screen right next to the plate. CPU and MEM in the normal
   range break the house rule: grey means "nothing needs you", so a reading that needs nothing
   should not take a line. Fix: on the Wall, the caption is the name plus `ok · all 12 calm`, and
   nothing else on a calm site. Show CPU or MEM only at warn or worse. HARDWARE and WHERE belong
   in night 2's detail sheet (touch), not in the tour.

7. **On a trouble site the plate says "crit" twice and still hides the count.** HV2 (frame 2):
   `■ STORAGE pool 97% full` in red, then `STATUS crit · 1 of 24 in trouble` in white. The word
   `crit` repeats what the red ■ has just said, and `of 24` is a denominator nobody acts on.
   Fix: one line, `■ STORAGE POOL 97% FULL`. If there is more than one problem, add
   `+3 more · 1 crit 3 attention` under it (T20 and T22). Drop the STATUS key.

8. **The plate covers the site it is about.** HOME (frame 7): the plate lies over FRONT-DOOR,
   THERMOSTAT, PRINTER-3D and PORCH-LIGHT, which are HOME's own rooms. The printer's `printing ·
   28%` shows through as a ghost. Frame 4: the plate covers all of HOME's lights while the camera
   shows REMOTE. The camera centres the site node, its children fan out to the left, and the plate
   sits top-left. Fix: shift the focus point right by the plate's width, so the site and its
   subtree land in the free two-thirds. Alternatively, choose the plate's corner from the side
   the subtree leaves empty. T24 hides cut labels, but this fix keeps the data in view as well.

9. **The plate with no content is a dead glance (frame 4).** For about 1 s there is a full-height
   dark plate, a kicker and a white block cursor, with no name and no lines. It hides a third of
   the screen and tells nothing. This is T23. I rank it lower only because T23 already covers it.

10. **The blinking cursor after the name is typed moves for no reason.** `HV1█` (frame 3) and
    `HV2█` (frame 9) blink on after the name is done (`cursorMs` 2000 normal, 800 demo,
    `caption.js:152`). Typing is the owner's favourite moment. A cursor blinking at a finished
    word is not typing, just motion. Fix: `cursorMs: 0`, so the cursor goes when the last letter
    lands.

11. **The bearing dial (`000 / 090 / 180 / 270`) and the ring legends (`LANE · RUN`,
    `BUILDER · SVC · PKG · RUN`, `ROOM · REPO`, `SITE · RUN`) carry nothing.** Frames 1 and 8. A
    compass bearing on a network graph has no meaning: no node is "at 090". The legends explain
    the desk Map's rings to someone at the desk. Fix: remove both on the Wall. r9 proposed
    redesigning the dial (owner's list). I say remove, not redesign. T18 covers the legends.

12. **The monograms duplicate the label beside them.** `BA`, `BB`, `BC` sit inside the builder
    nodes, 30 px from `BUILDER-A`, `BUILDER-B` and `BUILDER-C` (frames 1 and 8). The same goes for
    the tiny coloured pips under each builder name and the `+2` box. At 3 m the pips are 4 px
    specks, and nobody can tell their colours apart. Fix: remove the monograms and pips on the
    Wall, and keep `+2` only if it counts trouble.

13. **The work ribbons float mid-screen with no owner.** `ACME-SEARCH 7 of 10 / Add paged search
    to acme-api and the …`, `ACME-DOCS 3 of 10` and `ACME-BILLING 1 of 6` (frames 1, 2, 4, 7). They
    report progress, not trouble. The sentence is cut off with an ellipsis, so it cannot be read
    at any distance. It sits in the free middle of the screen, where the eye goes after a flight.
    Fix: hide them on the Wall. Progress that matters on a wall belongs in the glow layer's ring
    (it already has one).

14. **The glow is the softest thing on screen and nearly the largest.** The home lights (frames
    1 and 8) make a pale smear about 120x250 px, next to a crit ■ that is about 25 px. It tells you
    "some lights are on at home", which is a real fact (D3). But at the overview its warm/violet/
    white hues all read as one off-white haze, so the colour data is lost. Its size is close to
    the crit's halo. Fix: at the overview, scale the glow down (about half its radius) and leave
    it full only when the camera is at that site. The rule: a glow never has more area than the
    biggest trouble halo on screen (this ties into T16).

15. **The printer's ring and its text say the same thing.** `printing · 28%` under PRINTER-3D
    repeats the progress ring around it (frame 7, both visible through the plate). Keep the ring,
    drop the text at the overview.

16. **Labels hop between frames.** Frame 1: `PHONE-1` and `LAPTOP-2` are right of their nodes.
    Frame 8, one cycle later: they are on the left, and `LAPTOP-2` has moved next to `REMOTE`.
    From a chair, a label that changes sides looks like a status change. This is T15.
    The slow turn is what re-places the labels. Over 24 s it rotated the whole graph a few degrees
    (HOME 780,647 to 800,604) and gave nothing back. Fix: stop the turn while labels are pinned,
    or pin labels to their node's angle (T15).

17. **Attention outshouts crit at the overview.** Frame 8: the lanes at the top carry yellow ▲
    with rings about 70 px wide (FEAT-SEARCH, CI-RETRY, ACME-BILLING). STORAGE's red ring is about
    50 px. Five yellow marks beat two red ones. This is T16.

What I would keep, because it earns its place: the red ■ / yellow ▲ marks themselves; the typed
name (the owner asked for it, and it marks "we arrived"); the trouble line in its colour; the
tour order (HV2 first, then HV1, both cycles); the overview's site labels (HOME, HV1, HV2, CLOUD,
REMOTE), which are the only Map words that matter from 3 m.

## Across the variants

Only `radial` exists, so there is nothing to compare yet. A rule the other directions should start
from: Wall mode means Map annotations off by default (edge labels, sublabels, legends, dial,
monograms, pips, ribbons), each brought back only where it says something. Building `orbits`,
`islands` and the wild card on top of the desk Map's full annotation would repeat the radial's clutter
three more times.

## Scores

Performance is a guess: SwiftShader with screenshots gives 8.9 fps, the VM's software raster
(filming note). The T8 round measured 7-11.5 ms script per frame at 4x, inside a 33 ms budget.
Touch is not built: ambient mode takes no input.

score radial overview 3
score radial legibility 3
score radial status 4
score radial touch 1
score radial wow 5
score radial calm 3
score radial performance 6

## Console

`$RUN_DIR/shots/r20-radial/console.txt` is empty: 0 lines (film.mjs: "0 console/page errors").
