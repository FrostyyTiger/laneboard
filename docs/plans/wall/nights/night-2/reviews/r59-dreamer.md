# Review r59: the dreamer

Round 59, night 2. Persona: dreamer (second visit, after r15). I design title sequences and game maps. The
others say what is wrong; I say what is missing for someone who walks past this screen every day for a year.

What I judged. The newest strip (`r58-galaxy`, 14:55) predates T30 (f4a5ee3, 15:01), so I shot again at
f279b0c on `demo-fleet --size large` (the one already on :7795; I used it and left it):
- `$RUN_DIR/shots/r59-galaxy/` (`galaxy.html?demo=1&quality=0`, 12 frames over 111 s, CPU 4x, SwiftShader);
- `$RUN_DIR/shots/r59-fx-all/` (the same with `&fx=lanes,comets,twinkle,beacon`, 110 s);
- stills `r59-still-overview`, `r59-still-hv2`, `r59-still-lab` (`?at=<x>&quality=0&open=1`, 1368 at 2x);
- the 3 m image `$RUN_DIR/shots/r59-3m.png`.
Frames are sheet positions 1-12, left to right, top to bottom. "g" is the galaxy strip, "fx" the fx strip.

Since r15 the screen tells the truth: trouble first, names on everything, CLOUD found, the banner tied to its
cluster. What it lacks now is not correctness. It lacks a sense of **life, time and travel**: a calm fleet at
09:00 and at 17:00 look identical, a flight is black space, and the galaxy has become five dots.

## galaxy

1. **The flights are dead air.** fx 3 (20.7 s): the whole frame is black with one hairline, while the banner
   shouts `■ HV1 · VM-C`. g 2 (13 s): a block cursor and a grey ball in the middle of nothing. g 3 (21 s):
   `HOME` typed, the camera still on CLOUD's grey cloud bottom left. Two of every twelve frames are travel,
   and travel shows nothing. In Homeworld or Elite the jump *is* the show. To a hallway viewer, a black
   frame under a red banner reads as "the screen lost the crit". Fix (`camera.js flightPose`): keep both
   ends in frame during the flight (the arc's look-at moves from start to target, it does not point at
   empty sky), and see proposal 1 (`warp`) for what the travel should look like.

2. **The galaxy is gone at the overview.** `r59-still-overview`, g 1/6/11, fx 1/9: five grey crumbs, four
   hairlines, a black disc. The left and right thirds are empty. The 3 m image is a constellation diagram.
   The owner picked a *galaxy* (§5: "star clusters along spiral arms in a band of dust"); what is on screen
   no longer says spiral, arm or dust. r54 11 asked the same and nothing changed. Fix: at `fit()` only, a
   faint arm ribbon along `armPoint` (4-6 % luminance, under the dust, never above `--text-3`), fading out
   as a system opens. Calm stays calm: it is one still shape, not a motion.

3. **Every planet is the same grey ball.** `r59-still-hv2`: media, gpu-box, k8s-1, secrets, build-cache,
   sandbox are identical spheres; `r59-still-lab`: proxy, db, dns, registry, scratch the same. The only
   thing that tells me a builder from a NAS is a 15 px mono word. In Stellaris a planet's look *is* its type.
   Grey is right (design.md: grey unless trouble), but grey has shades and sizes. Fix (`scene.js`): sphere
   radius from what it holds (log of children or of `cpu` cores from `detail`), and two or three grey values
   by kind (host lighter, room mid, service darker). No hue. A busy builder then reads as a big world.

4. **The crit is shouted three times, so it is never *placed*.** `r59-still-hv2`: `STORAGE` as caption hero,
   as label beside the brackets, and as banner, all red, all caps. On the overview (`r59-still-overview`)
   the banner is 4x the size of the cluster it names. The eye reads the word, not the place: from the
   hallway I learn *what* but must hunt for *where*. (T37 holds the banner part.) What is missing is the
   link from word to world being the strong part: the tether is a 1 px red hairline that ends in air
   (overview: it stops ~45 px above the glyph). Fix (`tether.js`): 2 px, landing on the glyph, and a slow
   travelling tick from the cluster down to the banner every ~4 s while the crit lasts, so the line *points*.

5. **The beacon is a stub.** fx 9 (`r59-fx-all/frame-09.jpg`): above HV2 and HV1 two red sticks ~60 px
   tall, the same red as the nebula behind, so they vanish into it. A young crit gets almost no pillar (log
   height), which is exactly when it matters most to notice. Fix (`fx.js` beacon): a minimum height of
   ~0.25 of the frame at the overview, a white-hot core at the base (r49 in Later), and let *age* show as
   width or as rings on the shaft, not only as height.

6. **Calm holds are a list of names in an empty room.** g 8 (HOME), g 10/12 (HV2), fx 7/8/12: a two-word
   plate top left, the system in the right third, the left half black. A calm system held for 25 s has
   nothing to watch: no motion that means anything, no number. Fix: with T25's short plate, frame the
   system centred (r54 8), and give a calm hold one living thing (proposal 2, `corona`, or `twinkle` made
   visible, see fx).

7. **Nothing remembers.** T30's `CLEARED 26S AGO` (g 4/5/9/12) is the only trace of history on the screen,
   and it is in the loudest red at full banner size while the galaxy shows HV1 *amber* (g 5, g 11). A
   cleared crit should look past, not present. Fix (`frame.js` via the hud class): the cleared state in
   `--text-2` with the red glyph only, one step smaller; the place keeps a faint outline (the `afterglow`
   candidate under For the owner).

8. **Labels hit the frame.** g 4: `HOME` cut at the top-left corner over the caption's bracket;
   `r59-still-lab`: `DEMO-HOST` sitting on the tag (T31). `bc` cut by the brackets. Small, but in a title
   sequence a clipped word is a mistake the eye never forgives. Fix: `placeLabels` treats the frame's
   safe margin (the tag, the caption's corner brackets) as covers.

## fx

- **beacon**: the only effect that adds a direction (vertical) to a world of ellipses; at 3 m it could be the
  "where" sign. Today it is too short and too red-on-red (finding 5).
- **lanes**: not visible in any frame of either strip. A grey pulse on a 1 px grey hyperlane is calm to the
  point of absence.
- **comets**: one candidate in fx 6 (a short white streak below DEMO-HOST); otherwise invisible. The landing
  is the moment that matters and it has no mark (Q8 `miss` would give it one).
- **twinkle**: not seen. A working session is the most *alive* fact the fleet has and it is the least
  visible thing on screen.

## Across the variants

Only `galaxy` and its effects exist. What the parked still `r59-still-hv2` has that the tour should steal:
one system, big, sharp, with the lock and the leader; the tour's frames are never this good. What `beacon`
has that the other effects should steal: it is legible as a *shape* (a vertical) at overview scale; lanes,
comets and twinkle are legible only as *brightness* at close range, and so they are not there at all.

## What would make it unforgettable

1. **What you would see:** during a flight, the dust and far stars stretch into short streaks along the
   direction of travel, tinted toward the destination's status (grey for calm, a faint amber or red edge for
   trouble), and snap back to points on arrival.
   **What it means:** "the camera is going somewhere, and it is going to trouble". The flight (finding 1)
   becomes a forecast: you know the next target is red one second before the caption types it.
   **fx:** `warp`.
2. **What you would see:** the sun (the hub) has a soft corona that swells once each time a `/ws` map frame
   arrives; when frames stop, the corona shrinks and the sun goes cold and flat grey, and the tag reads
   `STALE 2M`.
   **What it means:** liveness of the whole page. Today only a tiny `LIVE` tag says whether this screen is
   current; from 3 m, a dead feed looks exactly like a calm fleet. One centred heartbeat, slow, never
   louder than trouble, and its absence is the alarm.
   **fx:** `corona`.
3. **What you would see:** while a crit is held, thin red threads light up from the crit node to every node
   that depends on it across the galaxy (its `links` in the model), and those planets get a faint red rim.
   **What it means:** blast radius: what this crit breaks. From the hallway, "one red dot" becomes "one red
   dot and these three things downstream", which is the question the owner asks next.
   **fx:** `blast`.

## Rubric

score galaxy overview 6
score galaxy legibility 7
score galaxy status 7
score galaxy touch 3
score galaxy wow 5
score galaxy calm 6
score galaxy performance 6
score fx-lanes wow 2
score fx-lanes calm 8
score fx-comets wow 3
score fx-comets calm 7
score fx-twinkle wow 2
score fx-twinkle calm 8
score fx-beacon wow 5
score fx-beacon calm 7

Touch: not built (D4, night 3); the page takes no gestures yet. Performance: under SwiftShader the strips run
at 2 fps (worst gap 3.2 s), which measures the VM; the hour proxy (T10) was flat, so this is a guess.

## The 3 m check

`$RUN_DIR/shots/r59-3m.png` (the overview still at 684 px wide): **yes for whether and where, no for wow.**
The red `■ HV2` cluster with its glyph and the amber `▲ HV1` read at once, and `HV2 · STORAGE / POOL 97 %
FULL` reads in the banner. All six names (REMOTE, HV2, DEMO-HOST, HV1, HOME, CLOUD) read. The tether is too
thin to see, so "where" comes from the matching red glyph, not the line. The tag top right and `+3 MORE` do
not read. What is lost at 3 m: the galaxy itself; it is a diagram of six dots on black.

## Console

- `$RUN_DIR/shots/r59-galaxy/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r59-fx-all/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r59-still-overview/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r59-still-hv2/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r59-still-lab/console.txt`: empty (0 lines).
