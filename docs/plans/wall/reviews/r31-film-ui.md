# Review r31: film-ui (night 3)

Persona: film-interface designer. Material, all made this round after 9e2fa7b (round 30, the last Wall
commit, T11's sheet in progress), on `demo-fleet.mjs --size large`, SwiftShader, CPU x4:
- `shots/r31-galaxy` (`galaxy.html?demo=1&quality=0`) and `shots/r31-galaxy-beacon` (`&fx=beacon`), 12 frames
  over 35 s each. Frame numbers 1-12.
- `shots/r31-touch` (CDP touch script `tools/r31-gestures.mjs`): tour → touch → overview → drag → tap a
  site → wait → tap a second name → two taps on empty sky → wait 8 s. Stills `1-tour` … `10-later`.
- `shots/r31-overview`, `shots/r31-hv1` (`?at=overview`, `?at=hv1`), `shots/r31-3m.png`.

The live demo had no crit in the plain film (only warn and attention) and VM-C's crit in the beacon film. The
two films therefore show different moods; both count.

## galaxy

1. **Stray hard lines are still the ugliest thing in the frame (T16 open).** `r31-touch/3-overview`: a
   yellow tether runs straight from REMOTE to the banner, ~600 px across the galaxy, through HV1's lanes.
   Beacon frame 1 and `r31-3m.png`: a red vertical rule from the crit site into the banner's plate. `r31-hv1`
   and film frame 12: the leader leaves the plate's corner at a random diagonal and lands on the lock. These
   are the only ruler-straight strokes in a soft scene. They read as scratches, not leaders. Fix as T16: no
   tether at the overview; one leader style (2 px, one 45° elbow, a tick at each end), routed clear of labels.
2. **The held trouble is named twice at nearly the same size.** `r31-hv1`: `FEAT-SEARCH` as the hero and
   again as a 40 px yellow scene label beside the bracket. Film frames 2, 3, 11 (`OFFICE-PRINTER`) the same.
   Beacon frame 2: `VM-C` hero, `VM-C` scene label, and `HV1 · VM-C` in the banner: one subject, three reds.
   The eye has to decide which word is the title; in a two-second shot it never does. Fix: T20 (hide the held
   node's label while its plate names it; banner drops out or moves to the next subject).
3. **The plate is a hard box, not a feathered ground.** `r31-touch/7-planet-sheet`: the dark plate shows its
   right and bottom edges as a rectangle cut out of the dust. `r31-3m.png` and beacon frame 1: the banner's
   ground is a darker rectangle with a hard left edge at the banner's start. On a film set those would be
   masked. Fix: Later A4 feathered plates (`mask-image` falloff ~4 vmin); brackets stay the only hard edge.
4. **Words on words and words off the frame (Later A4, T31).** `r31-hv1` and `8-tap-empty-sky`: `DEMO-HOST`
   label sits on the tag line `LANEBOARD · DEMO-HOST LIVE`, same word twice, touching. `HOME` cut by the top
   edge (film frames 2, 11; beacon 2, 10; `r31-hv1` top left above the bracket). `8-tap-empty-sky`: `CLOUD`
   sits inside the plate's box under `HOLDS`. Member labels under the lock bracket (`search ui` crossed by the
   bracket and stems in `r31-hv1`). Fix: hud covers + safe margin for every label, as Later A4 says; promote it.
5. **Calm holds still leave two thirds empty.** Film frames 6, 7 and beacon 6, 7, 12: kicker + one white name
   top left, a small system low right, nothing in between. These are the frames a stranger sees most and they
   look unfinished. Fix: frame the held system in the space the plate leaves (Later r54-film-ui 8), centred
   and larger; one living thing in the hold.
6. **The beacon at the overview leans and doubles as a tether.** Beacon frame 1 (full res): the pillar tilts
   ~10° off vertical with perspective, and a second, thinner red line drops straight from HV1 to the banner.
   Two red lines from one site, one tilted, one plumb: it reads as a laser and a crack. Fix: draw the pillar
   screen-vertical (billboard on x) and kill the tether (item 1).
7. **No arrival beat.** Across both strips the camera arrives, the plate types, the camera leaves. Frame 5
   (13.1 s) holds CLOUD with no plate at all; frame 12 types it 22 s later. Nothing lands and settles. Fix:
   Later r15-dreamer 7 (members fade in in orbit order with the typing) and r8-film-ui 5 (a beat at the start
   of each cycle).
8. **The overview is still a grey disc, not two arms.** `r31-overview`, `r31-3m.png`: the ribbon (T3) reads
   as a soft round glow round the sun; the vignette shows faint concentric bands. Fix: T19 as written.

## touch (gestures filmed, `r31-touch`)

1. **The sheet does not follow the trouble that rises under it.** `9`→`10-later`: VM-C on HV1 went crit while
   HV1's sheet was up. The banner turned red `HV1 · VM-C`; the sheet kept `▲ FEAT-SEARCH` as hero and
   `STATUS 2 attention · 1 warn`, no crit row. A sheet that says "worst first" and is wrong about the worst is
   the one thing an operator must never see. Fix: the sheet re-ranks on every model (no retyping), Later A4
   (T35's rule) applied to `sheetCaption` too.
2. **The sheet still speaks tour.** `7-planet-sheet` onward: kicker `ATTENTION · TARGET 01 / 05`, a typing
   cursor, then the plate looks exactly like a tour caption. The person asked for this; "TARGET 01 / 05" is the
   screensaver's count. Fix: a sheet kicker `SITE · HV1` (or `ROOM · IN HV1`, already in `sheetCaption` for
   planets), no typing on a sheet (it should be there at once), and one visible mark that the screen is yours
   (the back control, T13).
3. **Back does nothing yet.** `8`, `9`: two taps on empty sky; the sheet stays, the camera drifts on. T13 is
   open, so expected, but it means the gesture loop (touch → … → back → tour) cannot be filmed end to end yet.
4. **My first site tap after a drag did nothing.** `4-dragged` → `5`/`6`: a tap on HV2's screen point 2.5 s
   after a drag; camera still `free`, no brackets. The second tap (on HV1's label, id `lab`) worked within
   1.5 s. This may be the SwiftShader event lag noted in T8, not the page; a builder should check a tap right
   after a coasting drag in the fake-clock test.
5. **The lock on a sheet lands on the worst member, not on what was tapped.** `7`: I tapped HV1's name; the
   brackets sit on `search ui`, small, at the cluster's edge. Fine for the tour; for touch, brackets on the
   tapped site (big) say "this is what you touched". Fix: on a site sheet lock the site first, then step to
   the worst member as the sheet types its row.
6. Good and worth keeping: first touch eases to a clean overview in ~1.5 s (`2`→`3`), plate gone; drag turns
   the galaxy smoothly with the arms still reading (`4`); page never scrolls or scales (`scale 1`, `scroll 0`).

## fx-beacon

1. **Leans and pairs with the tether** (galaxy 6 above). Beacon frame 1.
2. **Gone once the crit clears, with nothing left behind.** Frames 6-12: VM-C cleared and the scene shows no
   trace; this is `afterglow`'s job (Later), not the beacon's. Observation only.
3. **At the overview it now shows.** Frame 1: a thin red rule with a red tip, clearly apart from the nebula.
   The white core does not read at film scale; at 3 m it is a red line. Fix: a wider white foot (2x the
   current core width over the bottom 10 %), so the foot reads as "here" and the line as "how long".

fx `lanes`, `comets`, `twinkle` are still in `FX_NAMES` but were not filmed: retired by the plan (§7 Night 3 D),
no code change since r4. Their scores are carried from r4.

## Across the variants

- `r31-hv1`'s plate (kicker, hero, sub-line, white site name, two-column table, bars) is still the house grid.
  The touch sheet should be that grid without the typing and with the tour's count replaced by what you
  touched; the banner should sit on the same left baseline system.
- The touch overview (`r31-touch/3-overview`, `4-dragged`) is the best overview composition so far: the camera
  is lower and wider, and the dragged angle in `4` shows the disc as a plane. The tour's overview should
  steal that pitch for its first beat.

## Scores

score galaxy overview 6
score galaxy legibility 6
score galaxy status 6
score galaxy touch 5
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

Touch scored on `r31-touch` (touch, drag, tap a site, sheet, empty-sky taps): wake, overview and drag work; the
sheet shows; back and the tour's return are not built and the sheet missed a rising crit. Status down one
from r4 for that miss. Performance: film.mjs reports 12.4 fps (plain) and 12.7 fps (beacon) under SwiftShader at
CPU x4, worst gap ~0.4 s; that measures this VM, and the owner's Surface report stands, so 6 is a guess.

## 3 m check

`shots/r31-3m.png`: `r31-overview` (2736 px at 2x) shown at 684 px, a quarter of its width (black padding
below). **Yes.** `■ HV2 · STORAGE` and `POOL 97% FULL` read at once, HV2's red square and red name sit up
left, HV1's yellow triangle reads. REMOTE, DEMO-HOST, HOME, CLOUD read as words. The tag and date do not,
which is fine. Weak points: the red tether from HV2 into the banner reads as a crack, the banner's dark
rectangle shows its hard edge, and the crit nebula itself is small next to the banner: from 3 m the banner
says "what", the scene barely says "where".

## console.txt

- `shots/r31-galaxy/console.txt`: empty (no lines); film.mjs: "0 console/page errors".
- `shots/r31-galaxy-beacon/console.txt`: empty (no lines); film.mjs: "0 console/page errors".
- `shots/r31-overview/console.txt`: empty (no lines).
- `shots/r31-hv1/console.txt`: empty (no lines).
- `shots/r31-touch` (no console.txt; the script's own page-error log): `errors []`.
