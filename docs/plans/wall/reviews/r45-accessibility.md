# r45: the accessibility reviewer (night 5)

Code at `f3b1b2c` (T19b), the last commit to `public/js/wall` and `wall.css`. Large demo on :7795, SwiftShader wrapper.
What I judged (all under `$RUN_DIR/shots/`):
- `r44-galaxy`: the newest `galaxy.html?demo=1` film (made at T19b, current). 33.2 fps, worst gap 176 ms, cpu 4x.
- `r45-rm-galaxy`: my film of `galaxy.html?demo=1` with `prefers-reduced-motion: reduce` emulated
  (`tools/r45-rm.mjs`, `film.mjs` plus that one media feature). 29.3 fps, worst gap 265 ms.
- `r44-t19b`: the newest touch walk (explore, tap HV1, card, tap BA, Back, turn, Open, overview, HV2 card).
- `r45-a11y/`: my probe (`tools/r45-a11y.mjs`), at 1368x912, dsf 1. For six states (crit hold, warn hold,
  overview, tour, HV1's card, BA's card) it screenshots the page and measures every visible DOM text against the
  rendered pixels behind it. The results are in `a11y.json`:
  - `declared`: the computed colour × opacity chain, against the 30th-percentile pixel of its box.
  - `rendered`: the 98th-percentile pixel against the same background.
  It also reads the card's ARIA, where focus is, and what Esc does.
- `r40-fx-*`: the newest effect films. No change to `fx.js` since. I also read `fx.js`, `still.js` and
  `scene.js PULSE` for the timings.

Flash check, from code. The crit breath is 2600 ms (0.38 Hz). The activity ring is 4800 ms. A landed job flashes
once in 900 ms. The typing cursor uses `lb-flash` at 1 Hz, opacity 1 ↔ 0.35. **Nothing passes three flashes a second.**
Under reduced motion every fx goes still (`fx.js` `still` paths), and `sweep` is off.

## galaxy: findings, worst first

1. **The card does not take focus, and Esc does not close it.**
   - What I saw: probe, `card-site` then `card-builder`. HV1's card was open, yet `document.activeElement` was
     `BODY` and `focusInCard: false`. After Esc on BA's card, the card was still there and focus was still on `BODY`.
   - Why it matters: a keyboard or switch user gets a card they cannot reach, and cannot leave it. README D6 asks
     for both. This is T20's (open), so I count it as the worst open gap, not a regression.
   - Fix (T20):
     - On open, focus the card's heading. Give the heading `tabindex=-1`, then call `focus({ preventScroll: true })`.
     - Esc closes the card and returns focus to the element that opened it. If a canvas tap opened it, focus goes
       to Back.
     - Pin both in a fakedom test.
2. **The card's status is only a coloured dot, and the word beside it says `OK`.**
   - What I saw: `r45-a11y/card-builder.png` and `r44-t19b/crop-11-hv2.png`:
     - BA's header has a 10 px **yellow dot** and no shape. The status line under it reads `OK builder-a · 3 lanes`.
     - HV2's header has a red dot and `OK demo hypervisor · GPU`, over a `■ CRIT STORAGE` line.
   - Why it matters:
     - A colour-blind reader gets "OK" and a dot they cannot place. `docs/design.md` rule 2 says a hue never
       travels alone.
     - "OK" next to a red dot reads as a contradiction to anyone.
   - Fix:
     - Replace the dot with the worst status's shape (`■`, `▲`, or a grey `●` when calm) at the name's cap height.
     - Split the line into the node's own state and what is below it, for example `OK itself · ▲ 2 BELOW`.
       Or lead with the worst: `▲ 2 ATTENTION BELOW · builder-a · 3 lanes`.
3. **A trouble label on its own halo falls to 2.3:1.**
   - What I saw: probe `card-builder`. `search ui` is yellow (235,200,49) over its planet's yellow glow
     (144,132,75): 2.30:1 declared, 2.07:1 rendered. In `card-builder.png` it sits across `vm-b`'s sphere and the
     halo, and I cannot read it. `ci` drops to 1.85:1 rendered over a body. `proxy` on the warn hold is 2.39:1.
   - Why it matters: the names in trouble are exactly what must stay readable. Bodies and halos are the busiest
     ground on screen.
   - Fix:
     - Give every `.galaxy-label` a dark ground. Either a 2-3 px text halo in `--bg-canvas` at 0.85 (`paint-order:
       stroke` or a stacked `text-shadow`), or a feathered plate like the caption's.
     - Then a labels test can require ≥ 4.5:1 against the halo's peak colour.
4. **Map names are 11 px. That is arm's length only, even for a finger on the card.**
   - What I saw: every `.galaxy-label` in all six states is 11 px at 1368 px wide. The card's labels
     (`ROOMS UP`, `CPU`, `BELOW`, `+1 MORE`, the path `hv1 › vm-a`, `later`) and its status glyphs are also 11 px.
   - Size: on the 12.3" Surface at 1368 CSS px, 11 px is about 2 mm tall. Low vision at 50 cm needs at least 16 px.
   - Why it matters:
     - Once someone has walked up and tapped, the card is the thing they came to read.
     - `■` and `▲` at 11 px are the colour-blind reader's only status signal in the card.
   - Fix:
     - Card labels and the path at 13 px, `later` at 13 px, the problem glyphs at 15 px to match their line.
     - Planet and moon names at 13 px in an open system (`labels.js`), lanes at 12 px. The collision pass already
       makes room.
5. **Under reduced motion, HV1 sits on the right edge and its lock covers its name.**
   - What I saw: `r45-rm-galaxy` frames 2, 3 and 8. The overview is pushed right to clear the plate. `▲ HV1` is
     at the frame's edge with the yellow lock brackets drawn over the `1`, and REMOTE's lock in frame 10 touches
     its name too.
   - Why it matters: reduced motion is the only view some people get, and the target's name is cut there.
   - Fix:
     - In still mode the lock frames the star only and stays clear of the label box, or the label moves outside it.
     - The overview fit keeps every site's label box inside the free box, which it does for the dot today.
6. **The fleet line is not announced.**
   - What I saw: the probe's live regions are only the plate (`aria-live=polite`) and the card's note
     (`role=status`, hidden). The fleet line (`wall-fleet-*`) has no role and no `aria-live`, though night 3's A5
     asked for `role="status"`. The galaxy canvas and the labels are `aria-hidden`.
   - Why it matters: a screen-reader user hears each held site's plate, but never the worst problem in the fleet,
     which is the one sentence the page exists for.
   - Fix:
     - `role="status"` on the fleet line's container. Only its text changes are announced, never every second.
     - Its `+N MORE` becomes a button labelled `N more problems`.
7. **Under reduced motion there are gaps with no caption at all.**
   - What I saw: `r45-rm-galaxy` frame 6 (15.3 s). The plate is empty and nothing is locked, at `?demo=1` speed.
   - Why it matters: reduced motion has no flight to fill the gap, so the screen simply says nothing for a moment.
   - Fix: in still mode, cross-fade one plate straight into the next, with no empty hold.
8. **Far labels fade to 2.6:1 while the camera flies.**
   - What I saw: probe `tour`, labels at (84,83,86) on (5,9,19), 2.61:1.
   - Why it matters: this is meant as de-emphasis, but it is the grey of an "offline" thing, not of "far away".
     Low-vision readers will see shapes they cannot resolve.
   - Fix: fade far labels out completely (opacity 0) rather than parking them at a grey that fails 3:1.
9. **Small red at 4.9:1 is the limit.**
   - What I saw: `--crit` (242,42,54) on the lifted ground is 4.89:1. It passes AA, but it is used for 15 px
     kicker text (`CRIT · TARGET 01 / 05`) and the card's 11 px `■`.
   - Why it matters: red text this small is the hardest for protanopes, for whom it is dark.
   - Fix: keep small red text bold. Better, put small status text in `--text-1` with the red shape before it,
     and keep red fills for the big type and the shapes.

What passes, measured (probe; declared = rendered for all of these):
- Banner: 12.2:1 yellow at 39 px, 600 weight.
- `+N MORE`: 13.4:1.
- Clock, tag, ambient line: 9.26:1 (lifted `--text-2`/`--text-3` on the blue-black ground).
- Plate name: 17.8:1.
- Map labels on clear sky: 9.26:1, trouble labels 12.2:1.
- Card buttons and chips: all 48 px or more, with real names (`Close`, `Fly to vm-c`, `Pin, later` disabled).
- The vignette did not pull any measured text below 9:1.

## Reduced motion (D5), from `r45-rm-galaxy`

- **It works.** No flights and no turn. The overview stays put and the plate rotates through
  STORAGE → FEAT-SEARCH → CLOUD → REMOTE → HOME. Each target gets a leader line to it and lock brackets.
  Trouble does not breathe; it holds at its peak (`breathWave` still = 1).
- It is still useful: in 30 s I learned which sites are in trouble and why, without any motion.
- Losses: the open system is never shown (members are only named in the plate), and findings 5 and 7 above.

## fx (newest films `r40-fx-*`, no fx change since)

- **beacon**: a steady pillar, no flash, still under reduced motion. Readable as "here" without colour, since it
  is a shape. The best fx for colour-blind readers.
- **warp**:
  - Frame 12 (33.9 s): white streaks fan across the middle of the overview over HV1's trouble. Large-field streaking
    is the classic vestibular trigger.
  - It is off under reduced motion, which is right. On normal motion, it should never run on a flight that ends at
    the overview.
- **afterglow**: outline only, no pulse, still under reduced motion. I saw no ring in the film (nothing cleared).
- **activity**:
  - A landed job flashes once (900 ms). That is fine.
  - The 4.8 s ring breath is fine. The pale rings (frames 3, 7, 8) look like selection marks, which is confusing,
    not a hazard.
- **sweep**: one slow line per cycle, off under reduced motion. Harmless.

## Across the variants

- Every fx should steal **beacon**'s honesty: one steady shape that means trouble without colour or motion.
- The **card** should steal the **plate**'s status line: shape, word and hue together, for example
  `■ 1 CRIT  ▲ 2 ATTENTION`.
- The **plate** should steal the **card**'s real buttons with names. `+N MORE` on the plate and banner is still
  only text.

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 8
score galaxy touch 6
score galaxy wow 7
score galaxy calm 7
score galaxy performance 7
score fx-beacon wow 7
score fx-beacon calm 7
score fx-warp wow 6
score fx-warp calm 4
score fx-afterglow wow 3
score fx-afterglow calm 8
score fx-activity wow 5
score fx-activity calm 5
score fx-sweep wow 4
score fx-sweep calm 8

Touch is scored on `r44-t19b`, a touch walk driven by CDP touch events:
- In its favour: 48 px targets everywhere, a big BACK control, and Back returns one step.
- Against it: the card is unreachable by keyboard and Esc does nothing (finding 1), and its status dot has no
  shape (finding 2).

## The 3 m check

`$RUN_DIR/shots/r45-3m.png`: `r44-galaxy` frame 1 (the overview, 2736 px) scaled to 684 px, a quarter. The bottom
88 px of the PNG are an empty black band from the headless window.

**Yes, for normal sight. Borderline for low vision.**
- Where it is wrong: HV2 and HV1 are red, each with a `■` beside its name. The shape survives the shrink, so a
  colour-blind viewer still finds them.
- What is wrong: the banner `■ 2 CRIT · HV1 · HV2` reads. Its second line `VM-C · BUILDER-C NO CONTACT FOR 33S`
  just reads.
- Site names: all six read (HOME, DEMO-HOST, REMOTE, CLOUD, HV1, HV2).
- What is lost: `+3 MORE`, the tag and the date.
- For low vision (20/60): only the banner's first line and the red blobs survive. At 3 m on a 12" tablet even the
  banner's first line is close to the limit (caps about 5 mm). On a wall screen this is fine.

## console.txt, every line

- `r44-galaxy/console.txt`: empty (0 lines).
- `r44-t19b/console.txt`: empty.
- `r45-rm-galaxy/console.txt`: empty.
- `r45-a11y/console.txt`: empty.
