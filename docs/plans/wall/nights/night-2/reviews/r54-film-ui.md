# Review r54: the film-interface designer

Round 54, night 2. Persona: film-ui (second visit, after r8). I judge the composition of each frame, the
type system, the camera's rhythm, whether it reads as one instrument, and the wow a stranger feels.

What I judged. The newest strip (`r53-galaxy`) predates T27 (e5c2a17), so I shot again at 8f2fec5 on
`demo-fleet --size large` (the one on :7795, left by an earlier round; I used it and left it):
- `$RUN_DIR/shots/r54-galaxy/` (`galaxy.html?demo=1&quality=0`, 12 frames over 80 s, CPU 4x, SwiftShader);
- `$RUN_DIR/shots/r54-fx-all/` (the same with `&fx=lanes,comets,twinkle,beacon`, 73 s);
- stills `r54-still-overview` (`?at=overview`), `r54-still-hv2`, `r54-still-lab` (`?at=lab&open=1`),
  `r54-still-home`, all `&quality=0`, 1368 wide at 2x.
Frame numbers are sheet positions 1-12, left to right, top to bottom. Pixel positions are in the 2000-wide
view of the 2x stills.

Since r8 the frame has become an instrument: names, a caption, a lock, a clock, a banner, trouble that is
the loudest thing. What is left is mostly craft: one hero per frame, one type scale, soft edges, and a
camera that does not hit things.

## galaxy

1. **Two headlines in every trouble frame.** `r54-still-hv2`: the caption hero `■ STORAGE` (top left) and
   the banner `■ HV1 · VM-C` (bottom right) are the same face, weight, hue and cap height (~130 px at 2x).
   Same in galaxy frames 9 and 12, fx frames 6 and 7. A shot has one title. Here the eye ping-pongs
   corner to corner and reads two crits as equals, although the camera chose one. Fix: in `wall.css`,
   while a caption plate is up (`html` or `#wall-frame` state the hud already knows), the crit banner
   drops one step, to the caption's name size (`--cap-name`, the white `HV2` under the hero), and its
   glyph with it. At the overview it keeps today's size: there it is the only title.

2. **Hard-edged dark boxes cut the soft world.** fx frame 10 (`r54-fx-all/frame-10.jpg`): the fleet
   block's ground is a black rectangle that slices HV2's red nebula with a straight vertical edge at
   x≈725 and a horizontal one at y≈985; the caption plate cuts the beacon's sheath flat at y≈522. In a
   frame made of glows, a hard rectangle reads as a rendering bug, not a plate. Fix (`wall.css`): give
   both plates a feathered edge (`mask-image: linear-gradient(...)` on the ground, ~4 vmin falloff to
   transparent) or no ground at all and a text-shadow halo. Keep the corner brackets as the only hard
   lines.

3. **The camera flies through clusters.** Galaxy frame 10 (66.7 s): a blown-out amber/red cluster fills
   the bottom-left quarter, over the clock. fx frame 8 (44.9 s): HV2's nebula smears across half the
   frame with the beacon at a slant. A foreground object that big for one frame is a smash cut nobody
   asked for, and it is the ugliest frame of both strips. §7.B names it ("no flight through the sun or a
   cluster"). Fix (`camera.js flightPose`): keep the path at least `1.5 × reach` from every star but the
   two ends (bend the arc up, as it already lifts by 0.18 of the hop), and fade nebula lobes and spheres
   whose screen size passes ~40 % of the frame height.

4. **The caption arrives before the camera.** fx frame 10: the plate types `OFFICE-PRINTER` (REMOTE)
   while the picture is still HV2's red cloud and pillar. Galaxy frame 5 (33 s): the lock's leader is
   drawn across the frame with no plate yet. Film order is picture, then title: anticipation (the
   approach), a beat of stillness (arrival), resolve (the name types in), then the leader ties them.
   Fix (`hud.js`): start the caption when the camera's flight progress passes ~0.9 (not at the leg
   start), and draw the leader only after the name has finished typing.

5. **The status glyph is a slab, set off the baseline.** `r54-still-hv2`: the hero's `■` is wider than a
   letter, with a gap of one letter before `STORAGE`; its top sits below the cap line (y≈255 vs 200) and
   its bottom below the baseline (≈340 vs 325). Same in the banner (`r54-still-overview`, the `■` before
   `HV2`). It reads as a red block pasted next to the word, not set with it. Fix (`wall.css`,
   `.wall-caption-glyph`, the banner's glyph): size the glyph to the cap height (`0.7em` of the face,
   type.js `CAP_EM`), `vertical-align: baseline` with its bottom on the baseline, gap `0.22em`.

6. **Two type scales on one screen.** Labels run on type.js's 4:3 scale (11 · 15 · 20 · 26 · 35 px);
   the caption and frame run on vmin steps (1.7 · 2.7 · 4.3 · 6.9 · 14 vmin, about ×1.6). At 1368×912
   that gives 15.5 / 24.6 / 39 / 63 / 128 px beside 15 / 20 / 26 / 35. In `r54-still-hv2` the caption's
   `1 crit` (24.6) and the label `storage` (15) and the planet star `HV2` (26) are three near-misses.
   A typeset screen has one scale. Fix: set the caption/frame custom properties (`--cap-key`,
   `--cap-line`, `--cap-name`, `--cap-hero`, the fleet line) from `type.js stepsFor` at boot, so every
   size is a step of the same scale (extend it upward: 63, 84, 112).

7. **Doubled marks, piled halos.** `r54-still-lab`: each trouble lane carries `▲` on its sphere and
   again in its label (`▲ ci-retry` beside a `▲` disc); `search ui`, `fix-login` and a third lane pile
   three amber halos into one yellow blob at x≈1180-1250. Two of the same sign side by side is noise sold
   as detail, and the blob hides how many there are. Fix (`labels.js`/`scene.js`): the label keeps the
   shape, the sphere keeps only hue and halo (or the reverse, one place); halos of members closer than
   one halo radius on screen share one halo at the brightest's strength.

8. **Calm holds waste half the frame.** Galaxy frames 3, 7, 11 (REMOTE, HOME): a four-word plate top
   left, the system squeezed into the right third, the left half black. The free box is kept at the
   widest plate ever seen (T18, a 711×487 trouble plate), but since T25 a calm plate is a kicker and a
   name. `r54-still-home` (parked, framed without the remembered box) shows what the shot can be: the
   system centred and twice the size. Fix (`main.js freeBox` / `framing.js`): remember two plate boxes,
   calm and trouble, and frame a leg with the one its caption will use (ease between, as now).

9. **The held star is named twice.** `r54-still-home`: `HOME` in the caption and `HOME` again above the
   brackets; galaxy frames 3 and 7: `REMOTE` twice. A title and a label saying the same word in the same
   face waste the frame's loudest type. Fix (`labels.js`): while a site is held and its caption is up,
   its star's label is hidden; the brackets are the reference.

10. **The hub's name competes with the sites.** `r54-still-overview`: `DEMO-HOST` is set in the site face
    at the site size, white, in the middle of the frame; in `r54-still-lab` and galaxy frames 5, 8, 9 it
    is larger than any site name and touches the tag (T31 covers the collision). The hub is the frame's
    anchor, not a target. Fix: the sun's label in mono caps at the room step, `--text-3` (r26-skeptic 4,
    in Later).

11. **The overview is a constellation, not a galaxy.** Since T26 the dust is right for close-ups, but in
    `r54-still-overview` and the 3 m image the spiral arms are gone: five dots, four hairlines, black.
    The left and right thirds are empty, and the "wow" of the first frame went down. Fix: give the
    overview (camera at `fit()` only) a faint arm ribbon, a low-frequency glow along `armPoint` at
    4-6 % luminance under the dust, or lift `DUST_INK` back toward text-3 while no system is open.

12. **The tether ends in air.** `r54-still-overview`: the red hairline from HV2 stops ~45 css px above
    the banner's glyph and crosses HOME's hyperlane on the way. A leader that does not land reads as a
    stray line. Fix (`tether.js`): end it on the glyph's top centre with a 6 px tick, and route it
    around hyperlanes or draw it after them at a clear gap.

## fx

- **beacon** (fx frames 6, 8, 10). The one effect that composes: a vertical in a frame of ellipses, it
  gives each crit a column the eye can find. But the flat-topped cut under the plate (finding 2) and the
  slanted pillar in the fly-through (finding 3) spoil it. Fix: a soft tip (the sheath fades to zero over
  its top 20 %), and dim it to the open level while the camera is in flight close to it.
- **lanes, comets, twinkle.** Not visible in any of the 12 frames or the stills (as in every earlier
  round's sheet). At the scale the camera gives a stranger, they do not exist. That is calm, but it is
  not an effect. If they stay, they need one moment of their own: a comet's landing could flash the
  target planet once; a lane pulse could brighten the hyperlane it runs on by a step while it passes.

## Across the variants

Only `galaxy` and its effects exist. What the parked still (`r54-still-home`) does that the tour should
steal: one centred system at full size with a short plate, nothing else on the left. And what `beacon`
does that the rest of the effects should steal: it adds a *direction* (vertical) the frame did not have,
so it is read as a sign, not as more glow.

## Rubric

score galaxy overview 6
score galaxy legibility 6
score galaxy status 7
score galaxy touch 2
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-lanes wow 2
score fx-lanes calm 8
score fx-comets wow 3
score fx-comets calm 7
score fx-twinkle wow 2
score fx-twinkle calm 9
score fx-beacon wow 7
score fx-beacon calm 6

Touch is a guess (night 3; nothing to touch yet). Performance is a guess too: SwiftShader gave 1.5 and
1.9 fps (worst gap 2.5 and 4.7 s), which measures the VM's software GL, not the page (T10's note).

## The 3 m check

`$RUN_DIR/shots/r54-3m.png` (the overview still at a quarter of its width, 684 px; the black band under
it is the screenshot window, not the frame): **yes.** That something is wrong reads at once: the banner
`■ HV2 · STORAGE` is the largest thing, red, and the red nebula with `■ HV2` sits top left with the
hairline running to it. Where reads: HV2 red, HV1 and REMOTE amber with `▲`. All five site names read
(about 14 px tall at this size), CLOUD included. Two things blur: `DEMO-HOST` reads as a sixth site
(finding 10), and the calm sites are grey specks with no shape, which is right.

## console.txt

- `r54-galaxy/console.txt`: empty (0 lines).
- `r54-fx-all/console.txt`: empty (0 lines).
- `r54-still-overview/console.txt`: empty (0 lines).
- `r54-still-hv2/console.txt`: empty (0 lines).
- `r54-still-lab/console.txt`: empty (0 lines).
- `r54-still-home/console.txt`: empty (0 lines).
