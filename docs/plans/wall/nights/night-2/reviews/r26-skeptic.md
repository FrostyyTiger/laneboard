# Review r26: the skeptic

Persona: skeptic. Every element on screen has to say what it tells the viewer, or it goes. Beauty is fine as
long as it does not hide data or cost attention. Judged on `galaxy` at HEAD `cec9f2d` (T1-T12 built) and on
`fx=lanes`.

Material:
- Filmstrips `$RUN_DIR/shots/r25-galaxy-off/sheet.png` (`?demo=1&quality=0`) and `r25-galaxy-lanes/sheet.png`
  (`&fx=lanes`). Large demo, CPU 4x, SwiftShader, 2.2 / 2.3 fps, worst gap 1693 / 1864 ms. They were filmed
  four minutes before the T12 commit (551ddc5), but `git diff 551ddc5 HEAD` touches only PROGRESS.md, so they
  show what is built.
- Pulse stills `r25-pulse/pulse-{1..4}.png` (T12's probe, overview, 2x).
- Stills made this round at HEAD, 1368 css px, 2x, `quality=0`: `r26-still-galaxy_html_quality_0` (overview),
  `…_at_hv1_open_1`, `…_at_hv2_open_1`.
- 3 m still `$RUN_DIR/shots/r26-3m.png`: the overview at a quarter of its width (684x456, top of the image).

Frame numbers below count left to right and top to bottom on the sheet, 1-12. "Off" is the sheet without fx,
"lanes" is the sheet with it.

## galaxy

1. **In the held trouble shot, the only thing you can see is the calm part.** Still `at_hv1`: the caption says
   `▲ FEAT-SEARCH` and `▲ FIX-LOGIN`. The HV1 star, feat-search and fix-login all sit under the plate; you can
   see the star as a dark disc through the plate at about (1000, 660). What *is* visible, named and lit, is
   twenty calm things: proxy, certs, ingress, db, redis, db-dumps, backup, dns, dhcp, resolver, git-mirror,
   mirror, monitor, metrics, logs, alerting, registry, images. That is the right two thirds of the screen
   carrying no information a glance can use. Off frames 6 and 7 show the same for VM-C and API-PROD: a red or
   yellow haze leaking out from behind the plate.
   Why it matters: in this shot, the picture shows where things are fine.
   Fix: T18 (aim at the free rect). Also, while a held site is in trouble, calm services and lanes are dots
   with no name. Only rooms, builders and trouble get a name. The caption already says `13 rooms`.

2. **The banner says the same thing as the caption, twice and at the same size.** Still `at_hv2`: `■ STORAGE /
   POOL 97% FULL` top left and `■ HV2 · STORAGE / POOL 97% FULL` bottom right. Together they cover about 45 %
   of the frame, including k8s-1, ingress-1 and the lower bracket of storage. One of the two is redundant.
   Fix: T23 (the banner steps down to the next problem while its subject is held). If there is no next
   problem, it shrinks to one line at the site step.

3. **The overview still loses a site.** Still `overview` (and `r26-3m.png`): REMOTE, HV2, DEMO-HOST, HV1, HOME.
   CLOUD is under the banner, the same as in r14, r15 and r21. A missing site tells the viewer nothing, and
   nothing on screen says it is missing.
   Fix: T19. The test should fail on today's fixture.

4. **The sun is the hub and carries no status, yet it is the brightest round thing on screen.** Overview
   still: DEMO-HOST has a white disc, the widest grey halo and a label the size of a site's. Off frame 11
   (56.0 s): the sun fills the middle of the frame during a flight, and the frame says nothing except what the
   banner says. Off frame 2 and lanes frame 6: the sun is cut by the top edge, which makes it the loudest mark
   there. The tag top right already says `DEMO-HOST`.
   Fix: T16. Also drop the sun's label to the planet step, or remove it, because the tag already names the hub.

5. **Dust grains carry no data and look exactly like data.** Still `at_hv2`, top left: the grains are as white
   and as large as the `apps-2` and `apps-1` dots. Off frames 3 and 8 and lanes frames 4 and 12: close up,
   the dust is the busiest texture in the frame. It is a backdrop drawn in the same ink as the nodes.
   Fix: draw the dust darker than any node mark (below `--text-3`), with point size attenuated by distance
   and capped (Later r8-film-ui 9), and faded inside a held system's reach (T15). If that cannot make it
   distinct from nodes, remove it close up.

6. **Stems and landing rings encode nothing.** Still `at_hv1`: the small open ellipses at (1225, 420),
   (1325, 453) and (1465, 537) read as empty or missing nodes. They only show where an invented height meets
   an invented plane. The spokes from the star to each planet repeat what the orbit already says.
   Fix: remove the spokes (as r8-film-ui 8 and r15-dreamer 8 also say). Keep stems if the owner wants depth,
   but make the landing ring a tick at half the stem weight rather than an ellipse the size of a dot.

7. **The overview turn moves every label without a reason.** Off frames 1, 9 and 10 are three overviews.
   HOME moves from (140, 295) to (140, 900) to (515, 820) on the sheet, and HV1 swings from right of the sun
   to below it. Glance twice, three seconds apart, and the "where" has moved. That breaks the Map's rule that
   nothing moves without meaning.
   Fix: no turn at the overview (as Later r7 says). Depth comes from the drift round a held system, where it
   has a subject.

8. **Calm captions are lists nobody reads.** Off frames 4 and 12 (REMOTE, CLOUD): `STATUS ok · all 8 calm`,
   CPU and MEM bars, `WHERE office`, `HOLDS 6 rooms`, at 11 px on the VM (15 px on the tablet). From 3 m none
   of it reads, and none of it calls for anything. The kicker's `· SITE` repeats on every target.
   Fix: a calm hold shows the kicker (`TARGET 04 / 05`) and the name, nothing else. A held site in trouble
   keeps the trouble lines and the bars. Drop `· SITE` from the kicker.

9. **The clock is the third-largest text on the wall.** Overview still: `09:51` is about the height of a
   site name. It tells you the time and nothing about the fleet. In a room with a wall screen there is
   usually a clock already.
   Fix: half its size, at text-3. The date line can go.

10. **Folded clusters are lumps that say "something is here" and no more.** Off frame 5 (24.0 s, HOME): a bunch
    of seven grey balls. It looks like it encodes a member count, but nobody can count it.
    Fix: Later r8-film-ui 7 (one sprite until the cluster opens past 0.3).

11. **A tinted hyperlane repeats the nebula.** Overview still: a red thread runs from the sun to HV2 and a
    yellow one to HV1. The nebula and the label already carry that hue and its shape. Without `fx=lanes`, a
    lane only says "this site belongs to the hub", which every site does.
    Fix: keep lanes grey at the dimmest line weight. Let them carry meaning only when `fx=lanes` runs on them.

## fx-lanes

1. **At 3 m it does not exist.** Lanes frames 1 and 10 show a small grey streak near DEMO-HOST and CLOUD; the
   other ten frames show nothing I can find. Pulse still 2 shows a soft smear on the sun-HV1 lane at 2x and
   full size. Low contrast was the brief ("quieter than any nebula"), and it meets that. But the result is
   motion only someone at arm's length, looking for it, will see.
2. **Its meaning cannot be decided from the screen.** Every pulse runs through the sun. A home→lab pulse and
   a hub→lab pulse look the same halfway, and nothing marks the source or the target. "Something travelled in
   the last 20 s" is also not a thing a viewer acts on.
   Fix: if it is kept, give the arrival a faint tick at the target star so the direction reads. Better still,
   pulse only links that changed state (went live, or failed) in the last minute, so the motion is news
   rather than traffic.
3. **It costs little attention.** At ≤ 0.6 opacity in `--text-1` grey, it never competes with red or amber
   (pulse still 2: the HV1 halo is far louder). It is the only moving element of the galaxy that is quieter
   than the trouble.

## Across the variants

- The galaxy's dust, sun and calm names should take `fx=lanes`'s discipline: grey, under 0.6, and quieter
  than any status hue. Lanes is the one element so far that was built with "never louder than trouble" as a
  stated number.
- `fx=lanes` should take the galaxy's banner logic: one line that names the subject. At present the pulse has
  no subject.
- From night 1 (r21-operator "across"): the trouble tile owned an area and read from afar without needing a
  glow. The galaxy's folded cluster could take that: at the overview, a folded cluster in trouble is its
  shape glyph at the site step and no lumps.

## Scores

score galaxy overview 5
score galaxy legibility 5
score galaxy status 6
score galaxy touch 2
score galaxy wow 6
score galaxy calm 4
score galaxy performance 6
score fx-lanes wow 3
score fx-lanes calm 8

(Touch is not built: D4 waits for night 3. Performance is a guess from T10's script 0.8-1.8 ms/frame and its
flat geometry count; the films' 2.2 fps is SwiftShader under the 4x throttle, not the tablet.)

## 3 m check

`$RUN_DIR/shots/r26-3m.png`. **Yes, for "is something wrong and where".** The banner `■ HV2 · STORAGE` reads,
and in the scene a red square beside `HV2` and a yellow triangle beside `HV1` say where. **No, for "every
site name".** REMOTE, HV2, DEMO-HOST, HV1 and HOME read (about 12 px caps at that scale), but CLOUD is not
on screen at all. Note: the banner alone answers the three-second question. At the overview the scene earns
its place only through the red and yellow marks beside two names. The dust, the arms, the sun's halo and the
lanes add nothing at this distance.

## Console

- `r25-galaxy-off/console.txt`: empty (0 lines).
- `r25-galaxy-lanes/console.txt`: empty (0 lines).
- `r26-still-galaxy_html_quality_0/console.txt`: empty (0 lines).
- `r26-still-galaxy_html_quality_0_at_hv1_open_1/console.txt`: empty (0 lines).
- `r26-still-galaxy_html_quality_0_at_hv2_open_1/console.txt`: empty (0 lines).
