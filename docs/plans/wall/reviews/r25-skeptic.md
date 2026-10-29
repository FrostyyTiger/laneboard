# Review, round 25, skeptic (what earns its place)

Night 5, after T8 (6bdc125, opening moons). For every element on screen I ask what it tells the viewer. If the answer is
nothing, or it repeats something already on screen, I say remove. All files are in `$RUN_DIR/shots/`. The films use the
large demo on :7795 at cpu 4x under the SwiftShader wrapper, 2736x1824.
- `r24-galaxy/sheet.png` and its frames: `galaxy.html?demo=1`, filmed after T8's last commit, so it is current. Its demo
  trouble had no crit in those 33 s (attention and warn only).
- `r24-t8-ring/*.png`: T8's CDP touch walk at 1368 px (HV1 held, tap `ba`, tap `bb`, tap a moon, Back).
- `r20-fx-<name>/sheet.png`: `?demo=1&fx=<name>`. They predate T6b-T8, but those commits changed labels, moons and
  touch, not the effects. They also carry the crit (`VM-C` down, `STORAGE` full) that r24 lacks.
- `r25-3m.png` (mine): r24 frame 1 (the overview) shrunk to about 555 px wide. That is a bit smaller than the quarter
  asked for, because headless Chromium's viewport came out narrower than the window, so the test is stricter, not looser.

## galaxy

1. **The banner says what the plate already says.** `r24-galaxy` frame 2 (3.6 s): the plate's fourth line is
   `▲ ATTENTION FIX-LOGIN · ASKED A QUESTION · 80M`. Bottom right, the banner reads `▲ HV1 · FIX-LOGIN · ASKED A QUESTION
   · 80M`, word for word, at about the same size. Frame 10 (26.9 s) does the same. In a trouble hold, two of the three
   biggest text blocks carry one fact. That costs the viewer a second read and tells them nothing new. Fix: during a
   hold, the banner shows only what is **not** on the plate: a trouble at another site (`▲ CLOUD · API-PROD · P95 1.8 S`).
   If every trouble is on the plate, it shows its one line `+0 ELSEWHERE` or nothing. T23 makes it smaller; this asks
   for different content as well.
2. **A count line that a list repeats.** Same frame: `STATUS ▲ 3 ATTENTION ▲ 1 WARN`, then the list of those same
   troubles, line by line, right below. In `r24-t8-ring/04-ba-open` it is worse: `STATUS ▲ 2 ATTENTION` above a list
   with **one** line. The other one is the headline, so the count makes me look for a second line that is not there.
   Fix: drop the `STATUS` line when the list below shows every trouble it counts. Keep it only as `+N MORE` when the list
   is cut.
3. **The thing I tapped is not the headline.** `r24-t8-ring/04-ba-open`: I tap builder `ba`. The plate's headline is
   `▲ FEAT-SEARCH`, then `WAITING ON A PERMISSION PROMPT`. `BA` comes third, in white, below the yellow text. The kicker
   says `BUILDER · IN HV1`, which describes `BA`, not the word under it. When you tap something, its name is the
   answer. Fix: in explore, the headline is the tapped node (`▲ BA`, in its worst hue). Its troubles are the lines below
   it. The trouble-as-headline order is right for the tour, not for a tap. T18's card replaces this sheet, so the card
   must not copy the mistake.
4. **`VERSION 0.1.0` and `HOLDS 3 lanes` on a 3 m screen.** `04-ba-open`: two desk-size rows. The version tells nobody
   anything from the sofa. `HOLDS 3 lanes` repeats the ring of moons that the same tap just opened. Fix: remove both from
   the plate. The version belongs in the card's `…`, if anywhere.
5. **A lock on a calm star.** `r24-galaxy` frames 5 and 6 (`HV2`, `REMOTE`, both calm): four corner brackets close round
   the star. On a calm hold the lock says "the camera is here", and the camera move already said that. It also makes
   the brackets mean two things, "target" and "trouble". Fix: the lock closes only on a member in trouble, or on what a
   finger picked. A calm hold has no lock. `fx=activity`'s rings (below) make the same mistake.
6. **A cursor with no name.** `r24-galaxy` frame 10 (26.9 s) and `r20-fx-warp` frame 11 (26.9 s, `TARGET 05 / 05`): a
   white block blinks on an empty line, under a full headline or under nothing. For a moment the plate looks broken.
   Fix: the cursor shows only while letters arrive. The name line's space stays reserved but empty until the first
   letter. Keep the typing itself, because the owner asked for it (§1).
7. **The tag repeats the sun.** `LANEBOARD · DEMO-HOST LIVE`, top right, in every frame. `DEMO-HOST` is already the
   sun's label in the middle of the overview. `LANEBOARD` is the product's name on the owner's own wall. Only `LIVE`
   carries information, and only when it changes to `STALE`. In `r25-3m.png` the tag cannot be read at all. Fix: the tag
   is one word, `LIVE` or `STALE 2M`, at the size the 3 m check can read. C1b owns the stale part, so this is a note for
   it, not a task here.
8. **`TARGET 01 / 05` is tour bookkeeping.** Every trouble kicker starts with it. It tells me where the camera is in its
   loop, not anything about the fleet, and the number changes for a reason I do not care about. Explore already uses a
   better kicker (`BUILDER · IN HV1`, `LANE · IN HV1`). Fix: the tour uses that kicker too: kind and parent. Drop the
   counter. The owner still has this open as a taste question (r46), so I only add my vote.
9. **The banner's count wobbles with no change in the fleet.** `r24-galaxy`: `+4 MORE` (frame 1), `+3 MORE` (frames 2
   and 3), `+4` (frame 5), `+3` (frame 4). The subject flips between `FEAT-SEARCH` and `FIX-LOGIN` (frames 1, 2, 10).
   The banner leaves out whatever the plate holds, so its count and subject move with the camera, not with the fleet.
   From across the room, a changed number means changed trouble. Fix: the count is the fleet's total trouble, always.
   It never depends on what the plate shows.
10. **A number with no unit.** `r24-galaxy` frame 6, REMOTE's calm plate: `OFFSITE COPY OFFICE-NAS · 45:43`. Is that
    the time of day, a duration, or an age? `r20-fx-beacon` frame 6 has `1:27 h` for the same field, so the format
    changes too. A number nobody can decode is decoration. Fix: `LAST COPY 46 MIN AGO`, or `14:02`, one format, or
    remove the line.
11. **Star-to-planet spokes are a fourth line system.** `r24-galaxy` frame 8 (HOME, calm): every planet has a spoke
    from the star, a stem down to the plane, a landing ring on the plane, and the system has an orbit ellipse. That is
    four kinds of line for "this belongs to that". The position already says it. In frame 2, HV1's spokes to the
    trouble moons bunch into a yellow-grey brush that hides `ba`'s and `bb`'s spheres. Fix: remove the spokes. Keep the
    stems, because they carry height (§5). Keep the ellipse faint.
12. **Status hue on hyperlanes repeats the nebula.** `r24-galaxy` frame 1: the sun-to-HV1 and sun-to-CLOUD lanes are
    yellow, and so are the nebulae at their ends. In `r24-t8-ring/04-ba-open` a red lane cuts through HV1's open system,
    across planets, and leaves the frame to the right. A lane that only repeats its site's colour adds a line through
    the content. Fix: lanes stay grey. Better, give them a meaning of their own: a lane goes dark when that site's feed
    is silent. That shows freshness with a line that is already drawn, which no other element does. Otherwise remove.
13. **The galaxy's outer ring is the brightest line on the overview.** `r24-galaxy` frame 1 and `r25-3m.png`: the
    arm ribbon reads as a closed grey ellipse round everything, brighter than any hyperlane. It looks like an orbit or a
    selection. It carries the galaxy's shape (§5, decided), not data. Fix: dim it below the hyperlanes, so the brightest
    lines on screen are ones that mean something.
14. **The clock is the second loudest thing at the overview.** `r25-3m.png`: `23:14` reads as clearly as the yellow
    banner, more clearly than `▲ CLOUD`. It tells me the time, which the tablet's own bar or my phone already tells me.
    It earns a place only as proof that the page is alive, and the tag's `LIVE` does that job. Fix: halve its size, and
    drop the date line.
15. **The open ring runs off the frame.** `r24-t8-ring/07-tap-moon`: I tapped `deps-bump`. The lock sits at the right
    edge, half outside, round a moon I cannot read. Its ring is mostly past the edge, and `‹ BACK` covers `ba`'s ring in
    `04-ba-open`. A tap that leaves its answer off screen shows nothing. T9 is already this task, so I add nothing but its
    test: every open moon and its lock inside the frame and off the controls.

What carries its weight and should not be touched: the trouble nebula (frame 1, the only thing that says "where" in a
glance); the `▲`/`■` glyph next to a site name (the 3 m check rests on it); stems (height); the fleet line
`5 SITES · 115 NODES · 7 WORKING` (small, factual, it changes when the fleet does).

## fx (`r20-fx-<name>`, after T6, before T6b-T8)

- **beacon** (33.1 fps, worst 191 ms). Frame 1 (0.6 s): a red line rises from HV1. It is the one fx that adds a fact
  ("crit, here, from any camera"), and it went away with the crit (frame 7). It also reads as a red hyperlane, because
  it is a thin line from a site toward the sun. Fix: straight up, short, with the crit's age at its tip, so it cannot
  be taken for a lane. Keep it.
- **warp** (33.5 fps, worst 220 ms). Frames 3 and 7: flights with no streaks I can see. Something that cannot be seen
  costs code and carries nothing. Remove, unless it can be seen and means "the target is red".
- **afterglow** (33.6 fps, worst 267 ms). Nothing cleared in 33 s, so nothing showed. Three reviews running cannot
  judge it, so to me it is unproven code. Either a demo hook clears a site at a known second, or remove it.
- **activity** (32.8 fps, worst 177 ms). Frame 1: grey rings circle calm CLOUD at the overview. Frame 10: rings sit
  inside the red lock on `storage`. They use the lock's shape for "working", which is not a problem. I already have
  `7 WORKING` in the fleet line. Remove.
- **sweep** (32.1 fps, worst 286 ms). Frame 9 (24.0 s): a wedge from the sun points at CLOUD (calm), and ellipses ring
  REMOTE and HV1. In 33 s I see one sweep. I cannot tell a ping from a non-ping, so the "silent site stays dark" meaning
  does not come across. Fix: no wedge. A silent site gets one small outline mark. A site that sent data gets nothing.
  Then the absence is the signal, as the plan meant.

## Across the variants

- Steal from explore's kicker (`r24-t8-ring/07-tap-moon`, `LANE · IN HV1`): kind and parent in one quiet line. The tour's
  `TARGET 02 / 05` should become this.
- Steal from `fx=beacon`: one mark that exists only while the trouble exists and is visible from any camera. Every other
  fx should pass the same test: it appears for a fact, and it goes away with that fact.
- Steal from the fleet line: plain counts that change only when the fleet changes. The banner's `+N MORE` should
  behave the same way (#9).

## Rubric

score galaxy overview 7
score galaxy legibility 6
score galaxy status 6
score galaxy touch 5
score galaxy wow 6
score galaxy calm 5
score galaxy performance 7
score fx-beacon wow 5
score fx-beacon calm 6
score fx-warp wow 2
score fx-warp calm 7
score fx-afterglow wow 2
score fx-afterglow calm 7
score fx-activity wow 3
score fx-activity calm 3
score fx-sweep wow 4
score fx-sweep calm 5

Calm is 5 because of the repeats: banner and plate, count and list, lanes and nebulae, the lock on calm stars. They all
ask for attention for information already on screen. Status is 6: trouble is first and loud, but the banner's subject
and count change with the camera (#9). Touch is scored on `r24-t8-ring`, a filmstrip of the gestures (wake, tap site,
tap planet, tap another, tap a moon, Back). It works, but the tapped thing is not the headline (#3), and the answer to a
moon tap is off screen (#15). Drag-turn and the card are not built yet. Performance comes from `perf.json`: 32.1-33.9
fps at cpu 4x, worst gap 177-286 ms. That measures this VM, not the tablet.

## The 3 m check

`r25-3m.png` (r24 frame 1, the overview, about 555 px wide): **yes.** `▲ HV1` and `▲ CLOUD` are the only coloured
things. Their yellow glow shows where trouble is, and the banner `▲ HV1 · FEAT-SEARCH · WAITING ON A PERMISSION PROMPT ·
80M` reads. `HV2`, `HOME`, `REMOTE` and `DEMO-HOST` read. Two weak spots. First, `▲ CLOUD`'s label is a dimmer ochre than
`▲ HV1`'s. That is r20's #8 and it is still there: depth eats a status hue on text. Second, the clock reads more easily
than CLOUD's trouble (#14). The tag and the fleet line do not read. The fleet line is fine to lose at that distance; the
tag is not (#7). There was no crit in this film, so this check does not show whether red still beats yellow.
r20's check did.

## Console

- `r24-galaxy/console.txt`: empty (0 lines).
- `r24-t8-ring/console.txt`: empty.
- `r20-fx-beacon/console.txt`, `r20-fx-warp/console.txt`, `r20-fx-afterglow/console.txt`, `r20-fx-activity/console.txt`,
  `r20-fx-sweep/console.txt`: empty, each.
