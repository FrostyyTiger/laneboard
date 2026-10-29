# Review, round 50, film-ui (the film-interface designer)

Night 5. The code is at `a795344` (T24), the last commit to `public/js/wall` and `wall.css`. Large demo on :7795,
SwiftShader wrapper. What I looked at, all in `$RUN_DIR/shots/`:
- `r49-galaxy/sheet.png` and its 12 frames. This is `galaxy.html?demo=1`, cpu 4x, 33.7 fps, worst gap 130 ms. It was
  filmed one minute before the T24 commit, from T24's working tree: the plate wraps and has three levels. So it is
  current.
- `r50-walk/` (made this round, `tools/r50-walk.mjs`, which is the T19b script with its own pid file and title). Every
  input is a CDP touch at 1368x912: explore → tap HV1 → landed → open → tap BA (card) → Back → turn → Open → overview →
  tap HV2 (card). The newest walk before it (`r47-t20`) was older than T23.
- `r40-fx-*/sheet.png`: the five effect films. `fx.js` has not changed since T5, so they are still current for the
  effects themselves. The banner in them is older than T23.
- `r50-3m.png`: `r49-galaxy` frame 1 at 684 px, a quarter of its width.

## galaxy

1. **The banner's size depends on how long its text is, not on its rank.**
   - Seen: `r49` frame 1 (0.6 s) has `■ 2 CRIT · HV1 · HV2` at about 6 vmin cap height. Frame 4 (9.4 s) has `■ HV1 · VM-C`
     at about 10 vmin. That is the largest type in the whole film. In frame 4 the camera is on calm HV2, with no plate.
     `r40-fx-sweep` frames 9-12 show the same thing, with `HV1 · VM-C` filling a third of the frame.
   - The cause is in `wall.css`: `.wall-fleet[data-step="far"]` is "fitted by frame.js `fleetSize` to 64vw". A short
     string grows to 14 vmin. A long one shrinks.
   - Why it matters: in a typographic system, size is rank. Here the same message, "something is down", jumps 60 % in
     size because a name is short. A viewer reads that as an escalation. The hero of frame 4 is also about a site the
     camera is not on.
   - Fix: give the 3 m step one cap height (the 9 vmin floor, or about 10). A short line gets more air, not more size.
     Check `data-hold` at frame 4: the camera has arrived at HV2, yet the line is at its no-hold size. Either the hold is
     set too late, or a hold with no plate is not counted.

2. **A held card has the wrong hero, or no hero at all.**
   - Seen at the warn hold, `r50-walk/04-ba-card.png`: `■ HV2 · STORAGE` is at full 3 m size (about 90 px caps). The
     subject you touched, `BA`, is a 20 px name in the card.
   - Seen at the crit hold, `11-hv2-card.png`: T23 drops the banner to one line, which is right. But then the clock
     `03:00` is the biggest type on screen. The crit member `storage` is an 11 px red lowercase label beside its body.
   - T23's rule assumes a plate arrives to take the hero step. In explore, the card is up instead, and it has no hero
     step.
   - Fix: while a card is up, its name takes the plate's subject step in the plate's condensed caps (about 5 vmin, not
     20 px). The banner follows T23 as for a plate. The selected node's map label takes the same face and status hue at
     2x, so that a crit member is never the smallest word in its own shot.

3. **Four voices set the same facts.**
   - Seen: the plate sets `FEAT-SEARCH · WAITING ON A PERMISSION PROMPT · 12M` in condensed caps (`r49` frame 2).
   - The card sets the same fact as `FEAT-SEARCH · waiting on a permission prompt · 4m` in mixed-case mono
     (`04-ba-card`).
   - Map labels are lowercase 11 px mono (`search ui`, `ci-retry`, `bc`).
   - Inside the plate, `WHERE office` / `HOLDS 6 rooms` (frame 5) is in a fourth style: light, lowercase, condensed.
   - Why it matters: a designed instrument has one grammar. Mono for keys (`STATUS`, `CPU`, the kicker), condensed caps
     for values and names. Here, which face a fact gets depends on which module drew it.
   - Fix:
     - Card problem lines and stat values: condensed caps, as on the plate.
     - The plate's `WHERE`/`HOLDS` values: condensed caps at the facts size.
     - Map labels: condensed caps at a step down in `--text-2` (r10 #6, still open).
     - Mono stays only on keys and the kicker.

4. **The card's leader line cuts the frame in two.**
   - Seen in `r50-walk` 02, 03, 05, 06, 08, 09 and 11: the card docks left (x 16-376). Its leader runs flat for about
     750 px across empty sky into the star's centre, crossing `template`, `gpu-box` and `media` on the way.
   - The system is pushed against the right edge, and some labels cut at the frame (`backup` in 02).
   - In a film shot, a leader is a short gesture from the label to its subject. This one is the longest line on screen,
     and it means nothing along most of its length.
   - Fix: when the card docks, the pick framing's free box (`framing.js`) starts right of the card, so the system moves
     toward the frame's centre. The leader then ends on the star's rim, not its centre, stays under a quarter of the
     frame's width, and bends above labels rather than through them.

5. **The pick shot puts the star under the banner.**
   - Seen: `04-ba-card` (HV1, BA picked). HV1's star sits on the frame's bottom edge, and its lower half is under the
     banner's feathered ground. The system's lower arc runs into the `HV2 · STORAGE` caps.
   - The tour hold keeps its subject clear of the banner; the explore pick does not.
   - Fix: the pick framing subtracts `hud.covers()` (banner, clock, Back, tag) the way the tour hold does, and checks
     the star as well as the picked planet.

6. **The warn banner wraps to a two-line block that outweighs a calm hold's subject.**
   - Seen: frames 5-12 have `▲ REMOTE · OFFICE-PRINTER · / PAPER JAM, NEEDS A PERSON` in two lines of about 4 vmin caps.
   - In frame 6 (CLOUD, calm) that block is heavier than `CLOUD` itself. The plate is one line with a bare
     `LIFECYCLE OBJECT-STORE · +17:21` (no unit, nothing says what +17:21 means), and the left two thirds of the frame
     are empty.
   - Trouble louder than calm is right (§2.1), but a wrapped paragraph is not a headline.
   - Fix: the warn line takes the crit line's grammar. Where it is one line (`▲ REMOTE · OFFICE-PRINTER`), the why goes
     to the sub line at the why step. On the calm plate, give `+17:21` its word (`IN 17:21`, or `NEXT RUN 17:21`).

7. **Flights are still dead air.**
   - Seen: frame 10 (26.7 s) is 85 % black, HV1 is a small cluster at the right edge, and there is no type except the
     banner. Frame 3 is the same.
   - The camera's rhythm is fly → land → type. Nothing anticipates the landing, so every flight is a cut in disguise.
   - Fix (r15 #3): in the last 40 % of a flight, the next kicker rides in at the frame's top left (`→ TARGET 02 / 05 ·
     HV1`) in the kicker's mono. It becomes the plate's kicker on arrival, so the plate grows out of it. That gives an
     anticipation beat at no camera cost.

8. **The block cursor stays on a finished word.**
   - Seen: frame 2, `HV1▌` (grey block) while the facts below have already faded in. Frame 6, `CLOUD█` (white block).
   - A cursor at rest on a held shot reads as a glitch, not as typing.
   - Fix: the cursor leaves about 400 ms after the last letter of the last typed line (T34, open).

9. **The plate's headline and the map's name still disagree.**
   - Seen: frame 2. The plate says `VM-C`, and the lock holds a pair labelled `■ bc`.
   - r10 #5, unchanged. From the sofa the headline does not land on a thing.
   - Fix: while the plate stands, the locked node's label shows the plate's name.

## fx (`r40-fx-<name>`, effect code unchanged since T5)

- **beacon** (34 fps, worst 227 ms). The pillar is still uncapped. In frame 7 (17.9 s), during the HV2 flight, it runs
  diagonally to the frame's edge like a laser sight. Fix as in r10: a small mono tick with the crit's age at its top,
  and under a quarter of the frame's height in a flight.
- **warp** (26.9 fps, worst 306 ms, the most expensive of the five). The streaks now show: frame 3 around HV1, and
  frame 12 (33.9 s) as hatching over the overview while the camera flies out. At the overview they read as texture
  laid on the galaxy, not as speed. Fix: streaks only in the middle 40 % of a flight *to a site*, never on the way out.
- **afterglow**. I could not find the ring in any frame, so there is still nothing to judge. It needs a demo clear at
  a known second.
- **activity** (30 fps). White rings round working planets are the brightest calm marks on screen. In frame 7 the ring
  round CLOUD sits inside the lock brackets, and the two read as one mark. Fix: rings at `--text-3` alpha, and none
  inside a lock.
- **sweep** (31.7 fps). Frame 12 (32.8 s): HOME and CLOUD are pinged by closed ellipses, which read as "selected".
  Fix: a short dash arc that fades in about 1 s.

## Across the variants

There is one variant (`galaxy`) plus the effects.
- What the galaxy should steal from itself: frame 2's plate. Its top-right bracket line runs out of the headline and
  turns down into the lock on the node. That is the one graphic move that ties type to subject. The card's leader
  should copy it (short, angled, from the name to the subject) instead of a flat wire across the frame.
- Frame 5's layout (kicker, hero, why, subject, keys and values, leader into the lock, the clock and the line in their
  corners) is the grid every hold and every card should sit on.
- Among the effects, `sweep` still has the rhythm (one motion per cycle, then stillness) and `beacon` the composition
  (one vertical against the plane). `warp` and `activity` should take both lessons.

## Rubric

score galaxy overview 8
score galaxy legibility 6
score galaxy status 7
score galaxy touch 6
score galaxy wow 7
score galaxy calm 6
score galaxy performance 8
score fx-beacon wow 6
score fx-beacon calm 6
score fx-warp wow 5
score fx-warp calm 5
score fx-afterglow wow 2
score fx-afterglow calm 8
score fx-activity wow 4
score fx-activity calm 4
score fx-sweep wow 6
score fx-sweep calm 7

Touch was scored on `r50-walk` (touch, drag-turn, tap a site, tap a planet, card, Back, Open, overview, a second site's
card). The gestures land and the flights are smooth. The 6 is for the shots they land on: findings 2, 4 and 5.

## The 3 m check

`r50-3m.png` (frame 1 at 684 px): **yes.** `■ 2 CRIT · HV1 · HV2` is the first thing you read, and the two red nebulae
with their square marks say where. REMOTE's yellow triangle is the second thing you see. All six site names read:
`HOME`, `DEMO-HOST`, `CLOUD`, `HV1`, `HV2`, `REMOTE`. The clock reads too. The banner's why line
(`VM-C · BUILDER-C NO CONTACT FOR 25S`) is at the limit, and the tag and `+4 MORE` are texture. The composition holds
together: the galaxy on the left two thirds and the banner in the space below and right of it. r10 #8 is effectively
met.

## Console

- `r49-galaxy/console.txt`: empty (0 lines).
- `r50-walk/console.txt`: empty (0 lines; the sheet header says 0 console/page errors).
- `r40-fx-beacon`, `r40-fx-warp`, `r40-fx-afterglow`, `r40-fx-activity`, `r40-fx-sweep` `console.txt`: all empty.
