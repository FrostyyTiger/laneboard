# Review r8: the film-interface designer

Round 8, night 2. Persona: film-ui. I judge the composition, the type system, the camera's rhythm,
whether it reads as one instrument, and the wow.

What I judged. The r7 filmstrip was shot before the last galaxy commit (a28786b), so I shot again at
8bdf49b on `demo-fleet --size large`:
- filmstrip `$RUN_DIR/shots/r8-galaxy/` (`galaxy.html?demo=1`, 12 frames over 48 s, CPU 4x, SwiftShader
  wrapper);
- stills `$RUN_DIR/shots/r8-still-galaxy_html_/` (overview) and `r8-still-galaxy_html_at_lab_open_1_/`
  (`?at=lab&open=1`, the 40-node site). `?at=hv1` gives the same frame as `?at=lab`, because there is no
  site `hv1` in the large demo (the sites are `lab`, `hv2`, `cloud`, `remote`, `home`).
Frame numbers are sheet positions 1-12, left to right, top to bottom.

State of the build. Only T1-T3 are done. No tour, no caption, no frame, no clock, no labels and no lock
yet (T4-T6, T9). No `fx` is built, so there are no `fx-` scores. Several findings below fall inside
those open tasks. I say which task, and I give the fix as it should land there.

## galaxy

1. **No type at all, so it is a background plate, not an instrument.** In all 12 frames and both stills
   nothing names anything. A film display earns its place in two seconds through a title, a caption and
   a scale. This frame has only shapes. From the overview I cannot tell `lab` from `hv2`. The open
   `lab` system (still) shows 40 grey spheres with no word on any of them. Fix (T5, T6): land the
   caption plate and the frame's clock before any more scene polish. Site names at the overview go in
   condensed caps on a short leader from each nebula, all on one baseline grid, one size. Planet names
   go in mono lowercase, a step smaller, only when the system is open. That gives three steps of
   hierarchy (caption name, site name, planet name) and no fourth.

2. **The sun outshouts the trouble.** In the overview still and every frame, the sun is a flat 100 %
   white disc with a wide grey halo. It is the brightest object on screen, so the eye lands there first
   and only then finds the red. In the open-system still the hub sun hangs cut off at the top edge
   (x≈900 y≈50). It is blown out, has dust grains drawn *over* it, and is the loudest shape in a frame
   that is about `lab`. Fix: the sun gets the text-2 grey core at 70 % of its current radius and a
   halo of at most half the crit nebula's peak. On a held system it fades to a dim point, or the camera
   framing keeps it out of shot (`siteShot` aims so the hub is behind the camera or under 15 % of the
   frame). Dust depth-tests against the sun.

3. **Trouble inside an open system is the smallest thing in the frame.** `lab` has two lanes and a
   session at `attention`. In the open still they are tiny yellow dots with a soft blur (x≈340-420,
   y≈260-370). They sit inside the dust band and are smaller than every calm grey planet. A grain of
   dust and a problem look alike. §2.1 says trouble is the loudest thing. Here it is camouflage. Fix:
   a planet or moon in trouble is drawn at least the size of a calm planet, with its shape (▲ ◆ ■) as a
   flat glyph facing the camera and its glow ring. Dust within the open system's `reach` fades to 20 %
   while it is held.

4. **The crit nebula is a radial gradient, not a nebula.** Overview still, both red sites: each one is
   a perfect flat red disc with a lumpy grey ball in the middle. It reads as a generic glow from a
   tutorial, the "random glow" I distrust. Two crits at the same size and the same breath give the eye
   no first target. Fix (B polish, nebula shapes): two or three offset, slightly elongated billboards
   per nebula, stretched along the arm's tangent, so each cloud has a direction. Breathing at one
   period, crit only. Order the brightness by severity and age, so the newest crit is visibly hotter.

5. **No camera, so no rhythm.** The 48 s strip is one slow turn (frames 1-12 rotate the whole
   galaxy). The one event, the right-hand cluster going from yellow to red between frames 10 and 11,
   happens without any reaction from the camera. Film motion needs anticipation, a beat of stillness
   and a resolve. Here there is constant motion and nothing to resolve. Fix (T4): the overview holds
   *still* for the first 2 s of each cycle (the beat), then turns. A status change at the overview
   gets a 600 ms push-in of about 5 % toward that site before the tour leg (the anticipation). The turn
   stops while the camera flies.

6. **The composition is lopsided.** Overview still: the five sites sit on the left and lower half
   (x 500-1270 of 2000). The right third of the frame (x 1300-1800) holds only dust and is the emptiest
   part of the most expensive area. Fix (layout, `armPoint`): spread the sites over the full sweep of
   both arms, or, if the arms must stay as they are, offset `overviewShot`'s look-at toward the sites'
   centroid so the empty part of the arm drops out of frame. The bottom-right corner is kept free for
   the fleet line (T5).

7. **Calm sites at the overview read as grey raspberries.** Bottom-left and bottom clusters in the
   overview still: folded planets at `CLOSED` 0.16 overlap into one lumpy blob of spheres with hard
   shading. At this distance they should be a point of light with a faint halo, a star cluster. Fix:
   below a screen-size threshold, draw a folded system as one sprite (a core point plus a halo at the
   calm grey). Swap to spheres as it opens (`foldAt` > 0.3).

8. **The open system is a wheel, not a system.** Open still: every planet has a straight spoke to the
   star, plus a stem, plus a landing ring, plus the large orbit ellipse. That is four line languages at
   one weight, and they turn the system into a bicycle wheel. Small unconnected white dots (moons?
   sessions?) float without a stem (x≈1080-1160 y≈455, x≈1530-1590 y≈740-950). Fix: drop the spokes
   (the stem plus the ring already say where a planet sits), keep the orbit ring at text-3, and give
   moons a short tether to their planet at half the stem weight.

9. **The dust is too coarse when close** (already in Later, r7). In the open still the grains are round
   discs of 6-10 px at 2x and sit in front of planets. They read as snow, not dust. Fix: point size
   attenuates with distance and is capped at 2 px, and the alpha falls off within a system's `reach`
   (see 3).

## Across the variants

Only `galaxy` exists this night, so there is nothing to compare. From night 1's `wall.html`, the
galaxy should take the plate-and-bracket grammar as it was fixed there (neutral plate corners, hue only
on the lock), and the trouble line's single age formatter (r41 findings 1 and 4). Those are T5 and T9.
They should not be rebuilt differently in 3D.

## Rubric

score galaxy overview 5
score galaxy legibility 1
score galaxy status 4
score galaxy touch 2
score galaxy wow 5
score galaxy calm 6
score galaxy performance 6

(No `fx` is built yet, so there are no `fx-` lines. Performance is a guess: SwiftShader gave 4.1 fps with
screenshots, which measures the VM. The builder measured about 0.4 ms of page script per frame
outside `renderer.render`.)

## The 3 m check

`$RUN_DIR/shots/r8-3m.png` (overview still at a quarter of its width): **no.** *Whether* something is
wrong reads: two red discs stand out against the grey. *Where* only half reads: I can see "upper left"
and "right of centre", but I cannot name either site, because there are no names (finding 1). The white
sun is still the first thing the eye hits (finding 2). The calm sites shrink to grey specks.

## Console

- `$RUN_DIR/shots/r8-galaxy/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r8-still-galaxy_html_/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r8-still-galaxy_html_at_hv1_open_1_/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r8-still-galaxy_html_at_lab_open_1_/console.txt`: empty (0 lines).
