# r46: skeptic

The persona: most "cool" dashboards are decoration with a status light in the corner. Every element must say
what it tells the viewer; if nothing, remove it. Not against beauty, against beauty that hides data or costs
attention.

Material (all on `galaxy.html`, `demo-fleet.mjs --size large`, SwiftShader, CPU 4x, 1368 css px at 2x):
- `r45-galaxy` (`?demo=1&quality=0`, filmed with T20, used as is), stills `r45-at-hv1`, `r45-at-hv2`.
- New this round (r41's were older than T17-T20): `r46-galaxy-beacon` (`&fx=beacon`), `r46-galaxy-warp`
  (`&fx=warp`), `r46-touch` (the round-38 CDP script `tools/r38-resume.mjs`: tour → touch → overview → drag →
  tap HV1 → sheet → BACK → idle 30 s, 57 s → tour resumes), `r46-3m.png` (warp film frame 1, the overview at
  0.6 s, before any streak, scaled to 684 px).

## galaxy

1. **With two crits standing, the headline's "where" flips every few seconds.** `r46-galaxy-warp` banner by frame:
   0.6 s HV2, 3.7 s HV1, 7.0 s HV2, 10.4 s HV1, 26.2 s HV2, 29.4 s HV1, 32.7 s HV2. `r45-galaxy` the same from
   19.6 s on. The fleet did not change; only the camera did. From 3 m a banner that swaps subjects reads as two
   alarms taking turns, or as one alarm that moves. It is motion without meaning on the one element that must be
   stable. Fix: when more than one crit stands, the banner names them all in a fixed order (oldest first):
   `■ 2 CRIT · HV2 · HV1`, the reason line for the oldest. Never pick the subject by where the camera is.
2. **T20 does not hold when a second crit stands: STORAGE is said three times.** `r46-galaxy-warp` frame 11
   (32.7 s, `CRIT · TARGET 02 / 05`): hero `■ STORAGE` + `POOL 97% FULL`, the banner `■ HV2 · STORAGE` +
   `POOL 97% FULL` at full size, and the planet's own label `■ STORAGE` in grey at name size beside the brackets.
   Three headlines for one fault, two of them identical word for word. `bannerEcho` appears to give up as soon as
   any other problem exists, but the banner still shows the held one. Fix: the echo test is "the banner's line
   names the held problem", whatever else stands; then show the next problem (HV1 · VM-C) or drop out; and
   `named()` must hide the planet's label on every plate that names it, not only the first visit.
3. **A black rectangle cuts the galaxy behind the banner.** `r46-galaxy-beacon` frame 5 (13.7 s): the banner's
   ground is a hard-edged dark box that slices HV1's yellow nebula and its `▲ HV1` label in half. Also visible in
   frame 9 (26.3 s, cutting the yellow at the bottom right) and in `r46-3m.png` (a darker box left of the
   banner). It carries no information and it hides a site in trouble. Fix: remove the box; the vignette's bottom
   ramp already quiets that corner. If text needs ground, a text-shadow halo, never a rectangle (Later r41-operator
   galaxy 8, A4 T38). Same for the caption plate's ground: `r46-galaxy-beacon` frame 3 (7.3 s) shows a planet
   cut flat by the plate's edge at the top.
4. **A crit shown in grey.** `r46-galaxy-warp` frame 11: the crit planet's label is `■ STORAGE` with a grey
   square. `r46-galaxy-warp` 26.2 s: `■ HV2` grey. `r46-galaxy-beacon` frame 5: `▲ HV1` grey. A grey square in
   laneboard's language says "fine". Here it says "crit, but the camera is busy". Fix: T31 (the glyph keeps its
   hue under `data-dim`); and a crit's label is never dimmed while it is the plate's subject.
5. **The kicker, the status row and the attention row all repeat the hero.** `r45-at-hv1`: `▲ ATTENTION ·
   TARGET 02 / 05`, hero `▲ FEAT-SEARCH`, `STATUS 2 attention`, `▲ ATTENTION FIX-LOGIN`. The word "attention"
   and its triangle appear four times on one plate. `r45-at-hv2`: `■ CRIT` kicker, `■ STORAGE` hero,
   `STATUS 1 crit`: three times. `TARGET 01 / 05` tells the viewer where the tour is in its loop, which nobody at
   3 m needs. Fix: kicker becomes the site's kind only (`SITE` / `ROOM · IN HV2`), or goes; `STATUS` row only
   when there is more than the hero (`+1 warn`), in hue, at the second step (T23); the target counter is in the owner's brief
   (`TARGET 02 / 05`), so dropping it is the owner's call.
6. **The calm plate carries one word, and it is already on screen.** `r45-galaxy` 16.6 s (`TARGET 04 / 05 ·
   REMOTE`), 19.6 s (`HOME`), 35.4 s (`CLOUD`): the plate is the site's name typed out, while the same name sits
   beside the star in the middle of the shot. Six seconds of typing to say a word that was already readable.
   Fix: a calm plate gets one real line (rooms, uptime, the busiest planet) or no plate at all; the label alone
   names a calm site.
7. **Calm planets turn pink inside a red nebula.** `r45-at-hv2` and `r46-galaxy-warp` frame 11: `k8s-1`, `k8s-2`
   and the HV2 star's lower half are tinted pink by the crit nebula's light. Hue is for trouble only
   (`docs/design.md`); a pink calm planet is a false status at 3 m. Fix: the nebula's light does not reach the
   planets' material (emissive-only nebula, or exclude members from its light), planets stay grey unless their
   own status is not.
8. **A red hairline runs from HV2 off the frame to nothing.** `r45-at-hv2` bottom right, `r46-galaxy-warp`
   frame 11 (from the system to the bottom right corner). Nothing at its end, no label. If it is the hyperlane to
   the sun in the site's tone, it repeats the nebula; from 3 m it reads as "a link to something broken out of
   shot". Fix: hyperlanes stay grey at every zoom; or fade a lane whose far end is off screen.
9. **The sun's name repeats the tag and sits on it.** `r45-at-hv1`, `r46-touch` 05: `DEMO-HOST` (big, on the
   sun) directly above `LANEBOARD · DEMO-HOST LIVE`. Same word twice, one on the other. Fix: do not name the sun
   (the tag already does), or drop the hub name from the tag. Also `HOME` cut at the top edge in `r45-at-hv1`
   (T26).
10. **`+3 MORE` / `+4 MORE` / `+5 MORE` changes number with the camera.** `r45-galaxy`: +3, +4, +3, +3, +4, +4,
    +4, +5, +4 over 35 s with the same fleet. `r46-galaxy-warp` 13.5 s: +5. It counts "problems not on screen",
    so it moves with the tour, and it is unreadable at 3 m anyway (`r46-3m.png`). A number that changes without
    the fleet changing is noise. Fix: count all open problems (fixed while the fleet is), at the reason line's
    size, or remove it.
11. **The ambient line says nothing a viewer acts on.** `r46-touch` 09: `5 SITES · 115 NODES · 8 WORKING`, tiny,
    the node count drifting (118 → 115 between frames). Fix: keep only `8 WORKING` (it is the only part that
    changes the day) or remove the line.
12. **The warn banner wraps with a dangling separator.** `r46-touch` 09: `▲ REMOTE · OFFICE-PRINTER ·` / `PAPER JAM,
    NEEDS A PERSON`. Fix: break at the separator, not after it (site · node on line one, the reason on line two),
    as the crit banner already does.
13. **The leader line repeats the brackets.** `r45-at-hv2`, `r46-galaxy-warp` frame 11: a 2 px red elbow from the
    hero to the brackets, and the brackets already lock the planet, and the name `STORAGE` is beside it. It is
    the longest red stroke on screen and points at a thing already marked twice. Fix: try without it for one film;
    keep it only if a panel cannot find the target without it.
14. **The date under the clock is unreadable at 3 m** (`r46-3m.png`). The clock earns its place (the owner's
    brief, and it proves the page is alive). The date does not. Remove it or put it in the tag.

Not findings, checked: the dust and the arm ribbon are quiet and grey; T19's S reads in every overview frame and
in `r46-3m.png`. They are decoration, but they give the sites a place and cost no attention. Keep.

## fx-beacon

1. **It is the fourth mark for the same crit at the overview.** `r46-galaxy-beacon` frame 1 and 8: the red nebula,
   the `■ HV2` label, the banner `■ HV2 · STORAGE`, and now a thin red pillar. What it adds is age (height and
   width), which no viewer can read as a number. Its one real job: making a crit findable in the galaxy before
   the eye reaches the label. It does that. Keep it only if the crit nebula alone does not; the owner decides.
2. **At 26.3 s it flares into a red streak bigger than the site** (`r46-galaxy-beacon` frame 9, the camera low
   over HV2 in a flight): the pillar seen at a slant from close. Fix: fade it in flights, as `beaconNear` already
   does for the held system.
3. **It leans with perspective** (frames 1, 8): a leaning line reads as a link to somewhere. Fix: billboard it
   screen-vertical (Later r31-film-ui galaxy 6).

## fx-warp

1. **Grey streaks to a calm site carry nothing.** `r46-galaxy-warp` frames 4, 5 (10.4 s, 13.5 s, to CLOUD): the
   whole right half is grey scratches, like rain on the lens, and they are still there at 13.5 s with CLOUD in
   shot. Only a trouble tint says something ("the next target is red"). Fix: no streaks at all on a flight to a
   calm site; on a trouble flight, the tint as T28 asks.
2. **The tint is too faint to read before the plate.** 26.2 s (to HV1, crit): the streaks are pinkish grey,
   the banner already says HV2 · STORAGE in full red. The streak loses to every red already on screen. Fix:
   T28's coloured head at full token value, or drop the effect.
3. **At 23.0 s and 26.2 s the streaks fill the overview's whole S** (flight out from a close system): the arm
   ribbon and dust turned to scratches across the galaxy. It is the only frame type where decoration is the
   loudest grey on screen. Fix: streak only far stars, not the near-plane dust, or cap streak opacity at the
   ribbon's.

## touch

Scored on `r46-touch` (the sequence, not a guess).
1. **The sheet carries the tour's kicker.** `r46-touch` 05: a sheet I opened by tapping says `ATTENTION · TARGET
   02 / 05`. It is not the tour's target; it is my selection. Fix: T25.
2. **The warn sheet still outshouts the crit banner** (05: `▲ FEAT-SEARCH` at the top step, `■ HV2 · STORAGE`
   smaller). Same as T30, now on the sheet too. Fix: T30's rule covers the sheet.
3. **Explore mode looks exactly like the tour** (02, 03, 07, 08, 09: no hint that the tour is stopped or when it
   comes back). Only `‹ BACK` appears and only after a tap. Fix: Later r41-operator touch 1 (`MANUAL · TOUR IN
   0:40`, small).
4. The sequence works: tour → overview (1.5 s) → drag turned the galaxy → tap HV1 → flight, brackets, sheet,
   BACK → overview → after the minute, the tour back on a trouble site. Page scale 1, scroll 0, no errors.
   HV2's crit cleared during the idle (09): it went grey with no trace; that is `afterglow`'s job, not built.

## Across the variants

- What `galaxy` (overview) does that the held shots should steal: one name per site, one glyph, one hue, and
  nothing else. `r46-touch` 09 is the cleanest frame of the night: every word on it carries a fact. The held
  plates should be judged against it: each row must add something the overview frame did not already say.
- What `fx-beacon` does that `fx-warp` should steal: it only exists for trouble. Warp should be silent for calm.
- What `touch` does that the tour should steal: the sheet lists every problem of a site with its reason
  (`ATTENTION FIX-LOGIN · asked a question · 5m`, `WARN ACME-BILLING · task T2 failed…`). The tour's plate shows
  `STATUS 2 attention` instead, a count where the sheet gives reasons.

## Scores

score galaxy overview 7
score galaxy legibility 6
score galaxy status 5
score galaxy touch 6
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 5
score fx-beacon calm 5
score fx-warp wow 4
score fx-warp calm 4

Why: status 5 because the banner flips subjects with two crits (1) and repeats the plate (2), and a crit shows
grey (4); calm 5 because of the flipping, the `+N` drift and three reds for one fault. Performance is a guess from
script-free SwiftShader films (12.7 fps beacon, 11.9 fps warp, 12.7 fps plain, worst gaps 345-402 ms) and the
owner's Surface report: no regression seen; warp costs ~0.8 fps here during flights.

## 3 m check

`r46-3m.png` (overview at 0.6 s of the warp film, 684 px wide): **yes**. The red nebula with `■ HV2`, the yellow
`▲ HV1`, and the banner `■ HV2 · STORAGE` / `POOL 97% FULL` read at once; every site name (REMOTE, HV2,
DEMO-HOST, HV1, HOME, CLOUD) reads. What does not: the tag (`LIVE` is the only fact in it, and a stale feed would
need it here), the date, `+4 MORE`. The dark box behind the banner shows as a step in the ribbon at its left edge.

## console.txt

- `r45-galaxy/console.txt`: empty (0 lines).
- `r45-at-hv1/console.txt`: empty (0 lines).
- `r45-at-hv2/console.txt`: empty (0 lines).
- `r46-galaxy-beacon/console.txt`: empty (0 lines).
- `r46-galaxy-warp/console.txt`: empty (0 lines).
- `r46-touch/console.txt`: one empty line (the script's `errors []`: no page error, no console error).
