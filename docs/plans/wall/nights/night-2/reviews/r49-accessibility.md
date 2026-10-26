# Review r49: accessibility

Persona: I judge the Wall for people who did not build it. That means contrast of every text and mark
against what is behind it, colour-blind safety, reduced motion, text size for low vision at distance,
and flashing.

What I looked at (all in `$RUN_DIR/shots/`, none in the repo). Everything was shot after the last Wall commit `57762ee`:
- `r49-galaxy/sheet.png`: `galaxy.html?demo=1&quality=0`, 12 frames, 4x CPU.
- `r49-galaxy-still/sheet.png`: the same URL with `--force-prefers-reduced-motion` (`chrome-still.sh`).
- `r49-fx-all/sheet.png`: `?demo=1&quality=0&fx=beacon,comets,twinkle,lanes`.
- `r49-still-{overview,hv1,hv2}/custom-dark-1368.png`: `?at=…&quality=0`, 2x.
- `r49-cvd/{ov,hv1}-{none,protanopia,deuteranopia,achromatopsia,blurredVision}.png`: Chromium's
  `Emulation.setEmulatedVisionDeficiency` on the live page, at 1368x912 and 1x. Probe scripts are in `/tmp/r49/`.
- `r49-3m.png` and `r49-3m-protan.png`: the overview at a quarter width (342 px).
- Contrast numbers have two sources. "Token" means WCAG ratios computed from the oklch tokens (`tokens.css`, the wall
  overrides in `wall.css`). "Measured" means pixels sampled in the stills: the 97th luminance percentile
  of a box against its 15th.

Token ratios on `--bg-canvas`: text-1 18.1, wall text-2 14.2, wall text-3 8.9, `--p2` warn 12.5,
`--p3` 9.1, **`--p1` crit 4.98**. The vignette (black at most) changes these by under 4 %.

## galaxy

1. **Crit is the dimmest status on screen, and for protanopes it nearly disappears.** Crit red is
   4.98:1 on the canvas. Calm site names are 14.2:1 and warn amber is 12.5:1, so a red name is the
   *least* luminous text on the page. Only its hue makes it loud. With protanopia simulated
   (`r49-cvd/ov-protanopia.png`), the measured HV2 label drops to **3.36:1** (an olive 109,99,52). Calm `DEMO-HOST`
   stays 14.2 and warn `HV1` 11.6. The crit nebula turns a dull olive smudge, and the warn nebula next to it
   is a bright yellow cloud. Achromatopsia (`ov-achromatopsia.png`) shows the same: the crit banner and
   `■ HV2` are mid-grey, warn `▲ HV1` and calm names are near white. §2.1 says "trouble is the loudest
   thing": for about 1 % of men (protanopia/protanomaly), plus anyone looking from far off at a dim tablet, the
   *least* urgent trouble is the loudest. The ■ shape saves the meaning but not the loudness.
   Fix: give crit luminance as well as hue on the Wall only (`html.wall`, like the text-2/text-3 overrides):
   lift `--crit` toward oklch 70 % (it keeps its hue, about 7:1 on the canvas). Better still, give crit
   text a light plate: the far banner's `■` and word on a `--p1` slab with `--bg-canvas` letters, the way
   the annunciator does. A red slab is the largest area on screen in every vision type. Raise the crit
   nebula's core lightness, not only its opacity, so it still out-shines a warn cloud in greyscale. Test it
   with the luminance of crit text ≥ warn text ≥ calm text-2 in the wall palette (`paletteFrom`).

2. **There is no way to turn motion off for a wall nobody personalises.** Reduced motion only comes from
   `prefers-reduced-motion` (`still.js prefersStill`). A hallway or shared wall is seen by people who
   cannot set the kiosk's OS preference. The motion film (`r49-galaxy`, frames 13.1 s, 39.6 s, 65.6 s)
   shows 2.25 s flights. Near-field dust streaks across the frame and the sun disc sweeps past
   (13.1 s). That is large-field vection, the motion that troubles people with vestibular disorders.
   Fix: add `?motion=still` (and `?motion=full`) to `galaxy.html` that overrides the media query, and document it in
   `docs/wall.md`'s kiosk section as the choice for shared spaces. While a flight runs, thin or hide the dust
   within the near-plane third of the frustum, so the field that streaks is not the nearest one.

3. **The held caption does not follow a status change during its hold.** In `?at=hv1`, about 10 s after
   load (`r49-cvd/hv1-blurredVision.png`, the last of five shots 600 ms apart, after a demo tick), `vm-c` inside
   HV1 went crit. Its planets show red rings and the banner reads `■ HV1 · VM-C`. The plate still leads with
   `▲ ATTENTION · FEAT-SEARCH` and the amber brackets. A low-vision reader cannot read the planet names (item 4) and relies on the
   big caption. In the tour the caption is fixed for a 25 s hold, so it can say "attention" for 25 s
   while the site is crit.
   Fix: in `hud.js`, when the held site's worst tone rises (warn → crit), re-feed the caption's
   lines and the lock target at once. That means a new kicker and hero word with no re-typing, and the brackets
   recoloured. A fall can wait for the leg's end.

4. **Planet and lane names are too small for low vision anywhere but at arm's length.** The room step is
   15 css px on the tablet (`type.js`, 11 px at 1x). Its cap is about 2 mm, 2.3 arc minutes at 3 m and
   7' at 1 m, under the 16' floor in `type.js`'s own comment. Lane names in trouble are worse: they
   are amber and anti-aliased thin. Measured: `acme-billing` 5.0:1, `search ui` 6.4, `ci-retry` 8.5 against an amber token at 12.5. The
   antialiasing eats the stroke. In `hv1-blurredVision.png` every planet name and the caption's
   key lines (`HARDWARE`, `HOLDS`) are mush. The hero word, the caption name, the banner and the site names
   still read. The trouble *names* at the room step (`▲ ci-retry`, `▲ search ui`) are the ones that matter.
   Fix: a lane or planet name in trouble gets at least the room step + 1 (20 px tablet) and weight 500.
   T22 already does this for the held target, so extend it to every trouble member of the held system. Keep calm
   ones at 15. Draw the trouble names with a `--bg-canvas` plate (padding 0.2 em, opacity 0.85) instead of only
   the 4 px text-shadow halo, because over the warn nebula and the dust the halo is not enough at 15 px.

5. **The shape on a trouble sphere is too small and low in contrast.** The crit `■` on `storage`
   (`r49-still-hv2`) is a dark square about 8 css px wide inside a red sphere. Measured **3.81:1** (dark
   92,21,27 vs red 255,61,72). It is 4.98 by token, but the sphere's shading lowers it. The warn `▲` on lane spheres in
   `hv1` is about 6 px. Neither shape can be told apart beyond about 1 m. The colour-blind reader needs the shape and
   gets it only from the label beside it.
   Fix: draw the shape as a ring outside the sphere in its hue (a square frame for crit, a triangle
   for warn) at 1.6x the sphere's radius, not as a dark cut-out inside it. It becomes the outline
   colour-blind readers can find, and it does not depend on the sphere's lighting.

6. **The far banner's tone flips red ↔ amber across the screen's largest text block.** In the
   reduced-motion film (`r49-galaxy-still`, 32 s → 37 s → 44.8 s → 59.2 s) the banner goes `■ HV2 · STORAGE` (red)
   → `▲ HV1 · FEAT-SEARCH` (amber) → `■ HV1 · VM-C` (red) → red again. That is about 20 % of the screen
   changing hue every few seconds. It is far under the 3-per-second flash limit, so it is no seizure risk. But in
   reduced motion it is the largest thing that changes, which defeats the point of the mode. T30 holds a crit that cleared. Also hold
   the banner's tone for at least one caption rotation (12 s) in reduced motion.

7. **Screen readers get the typing, not the trouble.** `caption.js` puts `aria-live="polite"` on the plate,
   whose name is typed one letter at a time. A reader may announce partial names, and it announces every calm
   caption every 25 s. The far fleet line, which carries the actual trouble, has no live region.
   Fix: mark the plate `aria-live="off"` while typing, then set the full text once in a visually hidden
   live node. Make the fleet line `role="status"` and announce only when its subject or tone changes. This
   needs fenced `caption.js`/`frame.js`, so it is for the owner.

8. **In reduced motion, crit is not reached sooner.** In `r49-galaxy-still`, HV1 is crit at 44.8 s and 53.3 s
   (`■ HV1`, banner `HV1 · VM-C`). The rotation still shows CLOUD (calm) at 44.8 and 59.2 s, then
   REMOTE and HOME. The demo's crits are short, so it may never reach HV1. With no flight to draw the
   eye, the caption is the only pointer in this mode.
   Fix: in still mode, a new crit cuts the rotation. The next caption is that site, at once (no typing
   in still mode, so no motion cost).

Checked and fine:
- Flashing: the caption cursor blinks at 1 Hz (`lb-flash`) and is hidden in still timing (`cursorMs: 0`). The crit breath is
  2.6 s, the twinkle waves 3.7/5.6 s, the lane pulse 6.4 s, and the beacon rises once over 1.4 s. Nothing exceeds 3 per
  second. No large red flash.
- Reduced motion (`r49-galaxy-still`, all 12 frames): the galaxy never moves, there is no flight and no turn, every
  cluster stays folded, and the caption rotates with the lock jumping to each site. It is useful: you get all five names,
  trouble shapes on the clusters, and the banner.
- Calm grey text: text-3 on the canvas measured 8.8:1 (tag, date, clock, caption keys, planet names). text-2
  measured 14.2. These are good numbers, and size is the problem (item 4).
- Every status has a shape (■ ▲) on cluster names, caption, banner and lane labels. In deuteranopia
  (`hv1-deuteranopia.png`) amber and red stay apart by luminance, and the shapes read.

## fx

- `beacon`: the only effect that adds a **non-colour** cue for crit, a vertical pillar. That is good for
  colour-blind readers. In protanopia the pillar is as dull as the nebula (item 1), but its form still reads.
  Brighten the core toward white at the base so it carries in greyscale. Movement: one rise, 1.4 s, then still. Fine.
- `comets`: a 3.2 s streak across the galaxy. It moves fast across a large field, the same vection concern as item 2,
  in miniature. Grey at ≤ 0.55, so it never competes with trouble. In still mode it is a faint static arc. Fine.
- `twinkle`: slow (3.7/5.6 s), low contrast (opacity 0.09-0.30). It never flashes. Too faint to mean anything to
  a low-vision viewer, but harmless.
- `lanes`: 6.4 s period, grey ≤ 0.6. Harmless, and invisible at distance (`r49-fx-all` shows none of it on the sheet).

## Across

The galaxy is the only variant. Within it: the **far banner** does what the rest should steal. It is
huge, it has a shape, and it names the place. It is the one element that survives every vision simulation
and the 3 m shrink. The cluster names and the in-system trouble marks should borrow its rule: shape first,
size from distance, luminance as well as hue. The **beacon** is the only map element whose meaning survives
greyscale without a label.

## Rubric

score galaxy overview 6
score galaxy legibility 5
score galaxy status 5
score galaxy touch 2
score galaxy wow 7
score galaxy calm 6
score galaxy performance 6
score fx-lanes wow 2
score fx-lanes calm 8
score fx-comets wow 4
score fx-comets calm 6
score fx-twinkle wow 2
score fx-twinkle calm 9
score fx-beacon wow 6
score fx-beacon calm 7

## The 3 m check

`r49-3m.png` (the overview, `?at=overview`, 1368 → 342 px): **yes for "something is wrong and where",
no for the site names.** The banner `■ HV1 · VM-C` is still large and red, and two red clouds mark HV2 and HV1.
The site names are about 4 px tall: `HOME`, `CLOUD` and `REMOTE` are smudges, readable only because I know them.
The banner names the place, so "where" survives through words, not through the map.
`r49-3m-protan.png` (protanopia, a moment with HV2 crit and HV1 warn): the banner still reads by size and ■.
On the map the crit cluster is a dim olive dot, quieter than the warn cluster's bright yellow. A
protanope would look at HV1 first, so "where" fails on the map itself (item 1).

## console.txt

- `r49-galaxy/console.txt`: empty (0 lines).
- `r49-galaxy-still/console.txt`: empty (0 lines).
- `r49-fx-all/console.txt`: empty (0 lines).
- `r49-still-overview/console.txt`: empty (0 lines).
- `r49-still-hv1/console.txt`: empty (0 lines).
- `r49-still-hv2/console.txt`: empty (0 lines).
