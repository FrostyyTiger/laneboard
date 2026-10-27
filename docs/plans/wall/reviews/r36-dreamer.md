# r36: dreamer

Night 3, round 36. What I watched:
- `galaxy`: film `r35-galaxy` (`galaxy.html?demo=1&quality=0`, made at T13, the last Wall commit c25ed45).
- `fx-beacon`: a new film `r36-galaxy-beacon` (`&fx=beacon`). r31's beacon film predates T12 and T13, so I refilmed it.
- `fx-warp`: film `r34-galaxy-warp` (T12; T13 changed touch only, not warp), frames 09 and 10 at full size.
- `touch`: a new gesture run `r36-touch` (CDP touch on `galaxy.html?demo=1&quality=0`, script
  `$RUN_DIR/tools/r36-touch.mjs`): tour → first touch → overview → drag → tap HV2 → sheet → tap GPU-BOX → planet
  sheet → BACK → BACK → tap empty sky ×3 → 20 s idle. Stills `1-tour` … `12-idle-20s`.
- 3 m: frame 08 of `r36-galaxy-beacon` (the overview), 2736 px shrunk to 684 px, `r36-3m.png`.

My question again: would I still want this in my hallway after a year? Closer than at r11. Trouble reads,
touch works, and warp gives a flight some weight. But the galaxy is still a dark room. When nothing is
wrong, nothing on screen is alive.

## galaxy

1. **The calm screen has nothing to say.** In r35 frames 4-7 (CLOUD flight, CLOUD, REMOTE, HOME), the only
   moving things are the camera and the cursor. The calm plates say a name and nothing more (`REMOTE`, `HOME▌`).
   The system sits in the right third, and the left two thirds are black. In a year this is what I would see
   most often, and right now it tells me only "a site exists". Fix: the calm plate gets one line of real facts
   in `--text-2` (`12 rooms · 3 working · last change 14m`), and the held system is framed in the space the
   plate leaves free (Later r54-film-ui 8). Proposal 1 below gives it life.
2. **The tether is still the longest red line on screen.** In `r36-touch/12-idle-20s` a 2 px red line runs
   from the banner's top edge, across the HOME hyperlane, up to HV2. In r36-beacon frame 1, the tether and the
   beacon join into one straight red line that cuts across the whole frame. In `3-site-sheet` a red line comes
   out of the hero plate's corner, passes through STORAGE and leaves at the bottom right. From the hallway it
   looks like a scratch on the glass. Fix: T16 (no tether at the overview, none crossing other marks). It is the
   cheapest thing that would make the frame look intended.
3. **Three reds say STORAGE in the trouble hold.** r35 frames 2 and 10, and `r36-touch/3-site-sheet`: the hero
   `STORAGE` (~140 px), the planet label `■ STORAGE` and the banner `HV2 · STORAGE / POOL 97% FULL`, all in the
   same red condensed caps. My eye bounces between them like a ping-pong ball. Fix: T20 as written. While the plate
   names the banner's subject, the banner steps down to the fleet line (or shows the next problem).
4. **The caption leads with the lesser trouble.** In `r34-galaxy-warp` frame 09, the HV1 hold shows a yellow
   `▲ FEAT-SEARCH` hero while a red `■ vm-c` sits inside the same system, and the banner is `HV1 · VM-C`
   crit. The hero and the banner name two problems at one site, and the crit gets the smaller one. Fix: the hero
   is always the held site's worst member. When a member rises while held, the plate retypes (Later A4 T35, T24
   for the sheet).
5. **Labels drift off their stars.** In `r36-touch/2b-dragged`, `■ HV2` hangs about 100 px below its red
   nebula, in empty space. In the 3 m still, `▲ HV1` overlaps its own planet sprite (`HV1€`). In r35 frame 11,
   `HOME` and `DEMO-HOST` are clipped at the top edge, under the tag. A name that does not touch its thing is
   a caption for nothing. Fix: T17 (anchor at the star, offset in screen space) and T26 (no words off the frame).
6. **The banner's plate is still a hard box.** It shows in every overview (`12-idle-20s`, the 3 m still): a
   darker rectangle with a hard top-left corner behind `HV2 · STORAGE`. Fix: feather it (Later A4 T38,
   `mask-image`).
7. **A typing plate with no name.** In r36-beacon frame 4 (10.3 s), the plate reads `TARGET 03 / 05` over a
   bare block cursor, while CLOUD is still a small blob at the right edge. The plate arrives before the camera
   and has nothing to say yet. Fix: T15 (typing starts at flight progress ~0.9).

## touch

1. **Nothing tells me I am driving.** In `2-overview`, `2b-dragged` and `12-idle-20s`, the screen looks the same
   as the tour's overview. There is no mark that a person has taken over, and no hint that the tour comes back by
   itself. (T14 is not built yet: after 20 s idle the page was still in `explore`, as expected.) In a hallway
   someone walks past, sees a frozen galaxy, and thinks it has hung. Fix: when T14 lands, put a small mono line
   by the tag, `MANUAL · TOUR IN 0:40`, counting down in `--text-3`. In the last 5 s it becomes a thin ring
   that closes round the tag.
2. **The sheet is still the tour's plate.** `3-site-sheet`: kicker `■ CRIT · TARGET 01 / 05` in a sheet I opened
   myself. Fix: T25 (`SITE · HV2`, no target count).
3. **BACK forgets where I turned the galaxy.** I dragged to yaw −1.14 (`2b-dragged`). After planet → BACK →
   BACK, the camera came back to the default pose (yaw 0, `6-back-to-overview`), not to my turned view. My
   script's second tap on HV2 then hit empty sky. That was my mistake, but a person reaching for the same spot
   twice would make it too. Fix: back to overview returns to the last explore pose. Only the first touch resets
   to the default.
4. **What works:** the first touch eases to the overview. The drag shows the disc as a real tilted ellipse, and
   that pose reads more like a galaxy than the tour's. The tap on HV2 flew there and opened the system. The
   planet sheet (`4-planet-sheet`, `GPU-BOX / ok · all 3 calm / UPTIME 480h`) is the cleanest type on the Wall.
   BACK is large (126×80 px) and steps planet → system → overview. Empty sky steps back too. 0 errors.

## fx-beacon

1. **At the overview it is now a needle, which is right, but it lines up with the tether.** In frame 1 the
   pillar runs from HV2 off the top of the frame, and the tether runs from HV2 to the banner. Together they make
   one diagonal red line across the screen. In frames 8 and 9 (tether hidden by the angle) it stands alone, short,
   with a red flare at its foot, and it is the best trouble mark on the Wall. Fix: T16 first. Then the beacon is
   the only vertical red thing, and it reads as "here" from the hallway (3 m still: it does).
2. **The pillar leans with perspective.** In frame 1 it tilts about 10° from vertical. A beacon that leans reads
   as a line, not a signal. Fix: Later r31-film-ui galaxy 6 (billboard it screen-vertical).
3. **Gone in the close hold.** Frame 10 (HV2 open): no pillar, only the small `■ storage` label. That is fine,
   because the caption carries it there.

## fx-warp

1. **It reads as rain, not travel.** In frame 10 (flight to CLOUD), the streaks are parallel diagonals, dense on
   the right and thin on the left. Nothing converges, so there is no vanishing point at the target. A jump should
   pull the eye *toward* where we go. Fix: streak along the screen-space vector from each grain to the target's
   projected point (radial from it). Keep the length tied to the camera's speed.
2. **It keeps raining over the caption at arrival.** In frame 09 the HV1 plate is typing `HV1▌` (so the camera
   has arrived), and pink streaks still cross the plate, the planet names and the tag. The plan says "snap back on
   arrival". Fix: streak length goes to 0 by flight progress 0.9, before the plate types (together with T15).
3. **The tint is too shy to tell me anything.** In frame 10 the flight to a yellow site has grey-white streaks. In
   frame 09 the flight to a crit site has faint pink ones. From 3 m both are grey. The promise was "you know the
   next target is red before the caption types it". Fix: the streak heads (the 30 % nearest the target) carry the
   status hue at full token value. Calm stays grey, so only trouble colours the jump.

## Across the variants

- The touch explore pose (`2b-dragged`: lower pitch, the disc as a wide tilted ellipse, five clusters spread out)
  is what the tour's overview should steal. It is the only frame tonight where the galaxy reads as a galaxy
  (r31-film-ui made the same point).
- The planet sheet's restraint (one white name, one status line, three facts, no red) is what the calm tour
  plates should steal, together with the facts it has and they lack.
- The beacon at its best (r36 frames 8-9: short, upright, a flare at its foot) is what the crit nebula at the overview
  should steal: one vertical mark carries "trouble here" by shape as well as by hue.

## What would make it unforgettable

1. **Pulse of the fleet** (`fx=heartbeat`)
   - What you would see: each hyperlane carries a single faint bead travelling sun → site whenever that site's
     data arrives. A busy site's lane glitters, and a site that has gone quiet has a dark lane. At the overview the
     whole galaxy looks like it is breathing in through its spokes.
   - What it means: per-site freshness from `/ws` map frames (the data T5/`fresh.js` already counts for the
     hub). It is `sweep`'s gap made continuous and per site. A dead lane beside living ones is a stale site you
     can spot from 3 m. Beads are `--text-3` grey, 1 px. Trouble stays louder.
2. **Telemetry rings** (`fx=telemetry`)
   - What you would see: on arrival at a held system, a thin arc draws itself once round each planet, its length
     the planet's cpu, a second inner arc its mem. Grey for calm. A warn or crit member's arc is in its hue, and
     only that one keeps a slow tick turning.
   - What it means: the cpu/mem the caption already holds, per planet. The calm hold (galaxy 1) gets real data
     that moves once and then rests. The planet sheet's CPU/MEM bars get a twin on the planet itself.
3. **Night ledger** (`fx=ledger`; it is `afterglow`'s shape, at the scale of time)
   - What you would see: a thin ring round the clock, ticked like a 24 h dial. Each trouble seen since the
     page loaded leaves a short mark at its hour in its old hue, cooled to grey once cleared. It never pulses,
     and it sits at `--text-3` weight.
   - What it means: the night's history at a glance. In the morning you see "two red ticks at 03:00" without
     touching anything. The page remembers the clears it saw (D2: no new route), and a reload forgets them, as
     `afterglow` does.

## Scores

score galaxy overview 6
score galaxy legibility 6
score galaxy status 6
score galaxy touch 6
score galaxy wow 6
score galaxy calm 4
score galaxy performance 6
score fx-beacon wow 7
score fx-beacon calm 6
score fx-warp wow 5
score fx-warp calm 4
score fx-comets wow 2
score fx-comets calm 8
score fx-twinkle wow 2
score fx-twinkle calm 9
score fx-lanes wow 2
score fx-lanes calm 8

Notes: touch 6 is scored on the `r36-touch` gesture run. Touch, overview, drag, tap a site, sheet, planet and
back all work. The tour's resume (T14) is missing and nothing says manual mode, so it is not higher. Calm 4: the
tether's scratch, three reds in each trouble hold, and dead calm holds. Warp calm 4: streaks over the caption at
arrival. Performance is a guess: 12.3 fps under SwiftShader with 4x throttle measures this VM, not the page, and I
made no script-ms measurement. The retired comets, twinkle and lanes were not filmed. Their scores repeat r11 for
the record.

## 3 m check

`$RUN_DIR/shots/r36-3m.png` (r36-galaxy-beacon frame 08, the overview, 684 px wide): **yes**. Something is wrong
and I can see where. `■ HV2 · STORAGE` is the biggest thing on screen. HV2's red nebula and its beacon point at
the spot, and HV1 reads as yellow with a triangle. All five site names and DEMO-HOST read. Weak points: `▲ HV1`
overlaps its own planet sprite, the beacon's leaning hairline is close to the limit of what reads, and the dark
banner box is visible as a rectangle.

## console.txt

- `r35-galaxy/console.txt`: empty (0 lines).
- `r34-galaxy-warp/console.txt`: empty (0 lines).
- `r34-galaxy/console.txt`: empty (0 lines).
- `r36-galaxy-beacon/console.txt`: empty (0 lines).
- `r36-touch` (gesture script's page-error and console-error log, no file): `errors []`.
