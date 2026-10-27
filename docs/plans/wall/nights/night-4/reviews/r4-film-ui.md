# Review r4: film-ui (the film-interface designer), night 4

Material, all in `$RUN_DIR/shots/` (none in the repo):
- `r3-galaxy/` — `galaxy.html?demo=1&quality=0`, large fleet, filmed 04:37 (after T1, 54e7f96; the last commit to
  `public/js/wall` / `wall.css`, so current). 12 frames over 35 s, cpu x4.
- `r4-fx-beacon/`, `r4-fx-warp/` — the same URL with `&fx=beacon` / `&fx=warp`, filmed this round.
- `r3-t1-taps/` — CDP touch stills (wake, sheet, plate corner, row tapped, clock) from builder r3.
- `r4-3m.png` — `r3-galaxy/frame-01.jpg` at a quarter width (684 px).

Only the galaxy is judged (README §6, night 2 on). `wall.html` (radial) was not filmed; night 4 E films it.

## 1. galaxy — findings, worst first

1. **The banner is the hero of every frame, and it is the wrong hero.** In all 12 frames of `r3-galaxy` the
   bottom-right banner (`■ HV1 · VM-C`, `■ HV2 · STORAGE`) is set at ~1.6x the caption's hero and ~4x the site
   names. The eye lands bottom right, not on the thing the camera brought it to. In frame 2 the plate types
   `VM-C` while the banner shouts `HV2 · STORAGE` bigger; in frame 11 the plate says `FEAT-SEARCH` (yellow) under
   a bigger red `HV2 · STORAGE`. Two headlines, two subjects, one shot. Why it matters to me: a frame has one
   subject; the camera grammar says "look here", the type says "no, look there". Fix: a type scale with one top
   step. At the overview the banner may own the top step (nothing else is held). While a site is held the banner
   drops two steps (to the caption's second line size, ~0.45 of the hero) and moves to a single line
   `■ HV2 · STORAGE · POOL 97% FULL  +3`; the caption hero is the only top-step type on screen. This is T9's echo
   rule plus a size rule; T9 alone does not fix it when the held trouble is a different one.
2. **Hard dark boxes cut the galaxy.** `r3-t1-taps/01-wake.png`: a flat rectangle behind the banner starts at
   x≈496, y≈675 and slices the arm ribbon with a straight edge. `r3-galaxy/frame-02`: the plate's ground is a
   visible box from the top-left bracket to x≈1240, cutting the dust. `r4-fx-warp/frame-09`: the warp streaks stop
   dead on the banner box's top edge (y≈985). A box with no frame line reads as a rendering fault, not a design.
   Fix: T10 as written (feathered `mask-image` or a text halo); the brackets stay the only hard lines.
3. **An orphaned leader line.** `r3-galaxy/frame-03`: the plate has gone but its red leader (a horizontal stub,
   then a diagonal) still hangs in empty sky pointing at `STORAGE`. A line that connects nothing is noise.
   Fix: the leader belongs to the plate; it fades with the plate's opacity, on the same curve, and it is the
   first thing to go out (it is drawn last on the way in: plate, then leader, then lock).
4. **The camera has no beat of stillness.** Read across the strip: overview (f1), plate fully typed (f2), flight
   (f3, f4), held system (f5), held (f6, f7), overview (f8), … Under `demo=1` the plate is typed and gone inside
   one 3 s interval; f5 (`CLOUD`) and f12 already have the lock and the system but no caption at all, and f6/f7
   have only the bare name (`REMOTE`, `HOME█`) with no rows. Anticipation (the flight) and resolve (the name) are
   there; the held beat between them is missing, so it reads as cut-cut-cut. Fix: in each hold, a fixed rhythm —
   arrive and lock (0.6 s), stillness (0.4 s, nothing moves but the drift), name types, rows fade in, then a hold of
   at least 1.5 s with everything still before anything leaves. Under `demo=1` cut the overview, not the hold.
   Check the calm plates: two lines minimum (the r46 calm-plate question under For the owner) so a calm hold is
   not a lone word.
5. **The kicker fights the cursor.** f7 `HOME█` and `r4-fx-beacon` f12 `█` alone under `TARGET 03 / 05`: a fat
   block cursor taller than the cap height, with no text yet, is the brightest mark in the plate. Fix: the cursor
   is the cap height and 60 % of the text's value, and it only appears once the first letter is down.
6. **Crit glyph turns grey in flight.** `r4-fx-warp/frame-09`: `■ HV2` is a grey square beside its red nebula.
   Colour and shape disagree in the one frame where the eye is hunting. Fix: T6, as written.
7. **Three type families of labels in one cluster.** f2: the system's member names (`proxy`, `db`, `backup`) are
   lowercase mono, the site name `HV1` is condensed caps, trouble members (`▲ ci-retry`) are mono in hue, and
   `DEMO-HOST` at the top is condensed caps again but bigger than the held site. Fix: a label system with three
   steps only: held site (condensed caps, step 2), sun and other sites (condensed caps, step 3, `--text-2`),
   members (mono, step 4). The sun is never bigger than the held site while a site is held.
8. **The stats rows are a data-sheet, not a caption.** f2: `CPU ━━ 34%  MEM ━━ 62%` and `HOLDS 13 rooms` are set
   at a third of the trouble rows and in sentence-case proportional, while `STATUS`/`ATTENTION` labels are tracked
   mono. Two grids in one plate: the mono labels sit on one column, `13 rooms` on another. Fix: one two-column grid
   (mono label column, value column) for every row; values all condensed caps; CPU/MEM on one row at the value
   size of `HOLDS`.

## 1b. fx-beacon — findings

1. **The pillar is a hairline from across the room.** `r4-fx-beacon` f1, f8, f9: a thin red line rising from HV2,
   about 2 px wide at 1368 px, fading to nothing. On camera it reads as a scratch on the film. Fix: give it a body
   — a 6-8 px core with a soft 30 px glow and a small cap at the tip (a flat disc or bracket), so it reads as a
   thing placed there on purpose; width with age, as the night-3 brief says.
2. **It vanishes in every held frame.** f2-f7, f10-f12: no pillar while held. A beacon you only see at the
   overview is fine, but it should hand over: fade it down on the flight out, not cut it. I could not see whether
   it cuts or fades at this frame spacing; a 0.5 s-spaced film of one departure would tell.

## 1c. fx-warp — findings

1. **The whole galaxy streaks on a flight to a warn site.** `r4-fx-warp` f9: hundreds of yellow and white streaks
   over both arms, radiating from HV1. It is the most-everything frame of the night: everything moves at once, it
   buries the crit (`HV2`, grey glyph) under yellow. Warp should say "we are going to the yellow one", not paint
   the screen yellow. Fix: streaks only inside a cone (~30°) round the direction of travel, ~1/4 of the count,
   white with the hue only on the leading tips; a crit nebula is never overdrawn by streaks (depth-test it or skip
   streaks inside a crit's screen disc).
2. **Calm flights streak.** f4: a white streak field round `CLOUD` on a flight to a calm site. T15 already says
   `warpAt(k,'calm') = 0`; this film confirms it is still needed.
3. When it is right it is good: f8 (to HV1, red tips) is the one frame where the direction reads before the
   caption. Keep the idea, cut the quantity.

## 1d. touch — what I saw

`r3-t1-taps`: wake → overview, tap a site → sheet with `‹ BACK` in a bracketed box top right, taps on the plate
corner and the clock change nothing (T1). Not a full gesture film (no drag, no back, no resume), so `touch` is
scored on these stills. Findings: the `‹ BACK` box is the only boxed control on the page and its bracket corners
are a different weight (1 px) from the plate's (2 px): make it the same bracket language as the plate. The
sheet's `■ SITE · HV2` kicker repeats the hero's site (`HV2` below it): in explore, the kicker should say
`MANUAL` (T5) instead of repeating the subject.

## 2. Across the variants (what one does that the others should steal)

- warp f8 shows the one idea the tour should steal for every flight: the next subject announced by the image
  before the type. Without warp, a faint tint of the destination's status on the lock brackets during the flight
  would carry the same "it's going to the red one" for free.
- beacon's vertical line is the only element that breaks the plane's horizontal composition; it gives the
  overview a focal axis. The plate could use the same vertical: its leader line should rise from the target the
  way the beacon does, instead of the current stub-and-diagonal.
- the held system (`r3-t1-taps/02-sheet`): plate left, system right, clock bottom left, tag top right — that is
  a composed shot. The tour's held frames with the banner (f2, f11) should look like this one: the sheet has no
  banner, and it is the best frame of the night.

## 3. Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 7
score galaxy touch 6
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 5
score fx-beacon calm 7
score fx-warp wow 7
score fx-warp calm 3

(performance: 12.5-13.3 fps and worst gap 366-401 ms under SwiftShader at cpu x4 measure the VM, not the page;
the owner's Surface runs it well. A guess from the films, not a measurement.)

## 4. The 3 m check

`$RUN_DIR/shots/r4-3m.png` (frame 1 of `r3-galaxy` at 684 px wide). **Yes for trouble and where, yes for the
names.** HV2 and HV1 are the only coloured masses, each with a red square and its name; REMOTE, DEMO-HOST, HOME,
CLOUD read in condensed caps. Note: my headless render clipped the bottom fifth, so the banner's lower half is cut
in the image; at full size the banner is the largest type on screen and reads at any distance (finding 1 is that
it reads too well while a site is held). In this frame both sites are crit (red ■). At this scale ■ and ▲ are both small solid marks: when a warn and a crit
stand side by side only the hue separates them from 3 m, the shape only up close.

## 5. console.txt

- `r3-galaxy/console.txt`: empty (0 lines).
- `r3-t1-taps/console.txt`: empty (0 lines).
- `r4-fx-beacon/console.txt`: empty (0 lines).
- `r4-fx-warp/console.txt`: empty (0 lines).
