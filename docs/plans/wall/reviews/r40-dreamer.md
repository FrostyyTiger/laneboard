# Review r40: dreamer (title sequences, game interfaces), night 4

Material, all in `$RUN_DIR/shots/` (none in the repo):
- Filmed this round, after T38 (5dc9618, the last commit to `public/js/wall` / `wall.css`): `r40-galaxy`,
  `r40-fx-beacon`, `r40-fx-warp`, `r40-fx-afterglow`, `r40-fx-activity`, `r40-fx-sweep`. All
  `galaxy.html?demo=1&quality=0&pace=wall[&fx=<name>]` on `demo-fleet.mjs --size large --tick 800`, SwiftShader,
  cpu x4, 12 frames over about 52 s (script `$RUN_DIR/r40-film.sh`).
- Older films for what a 4 s sample misses: `r35-fx-warp-flight` (a warp flight at 0.7 s per frame),
  `r37-sweep-second` (the sweep at `at=overview`), `r30-galaxy-with` frame 12 (an afterglow ring after a clear).
- The show interface (new since the last dreamer round, r11): `r38-show` (CDP stills: flyTo, highlight, pin, ✕,
  touch, refused) and `r39-wire/01-shown-by-wire.png`.
- `r40-3m.png`: `r40-galaxy/frame-01.jpg` (the overview, crit HV2 and warn HV1) at a quarter width, 684 px.

Only the galaxy and its built effects are judged. My question for every frame: if this hangs in my hallway for a
year, what is the screen not yet telling me, and what moment is still not a moment?

## 1. galaxy: findings, worst first

1. **The best news of the day has no moment either.** `r40-galaxy` frame 7 (28.6 s): the banner still says
   `■ HV2 · STORAGE` at full size. Frame 8 (33.2 s): it is gone, replaced by a small yellow `REMOTE` line. The
   crit cleared between two frames, and the biggest red thing on the screen just stopped being there. r11 asked
   for a moment when trouble arrives (T22, still open). Trouble leaving is the other half. When I walk past, "it
   is fine now" is the second thing I want to know. Fix: on a fall (crit → calm or warn), the banner types
   `HV2 · STORAGE · CLEARED` once in `--text-2` and holds it about 4 s. Then the next subject takes its place,
   and under `fx=afterglow` the ring carries it from there. This is the same grammar as T22, so build them
   together.
2. **Two headlines at the top step.** `r40-galaxy` frame 7, and the same frame in the beacon, warp and activity
   films: a 72 px yellow `▲ FEAT-SEARCH` hero and a 72 px red `■ HV2 · STORAGE` banner on one screen. From 3 m
   the eye goes to the banner (red, lower, wider), while the camera shows something else. Fix: T19, as written.
   I would raise it in triage, because it is in a third of all held frames.
3. **Every hold is the same slide.** Frames 4-5, 7-9, 11-12 of `r40-galaxy`, and frames 6-12 of
   `r35-fx-warp-flight` (HV2 held 10 s): the plate is top left, the system takes about a quarter of the width top
   right, the lower half is black apart from the banner. Between 28.6 s and 37.8 s the system does not visibly
   turn. The plan promises a camera that "drifts slowly round a held system, so the depth reads" (§5), and at this
   rate it reads as a still. Over a year this is a slideshow template. Fix: frame the held system larger (about
   45 % of the width) and lower, centred on the hero member (T25). Make the drift visible: about 15° of yaw over a
   14 s hold, so the stems and orbits move against each other.
4. **The overview is a photograph.** Frames 1 and 2 of all six films (0.7 s and 5.5 s): the same image by eye,
   apart from the breathing. That is ten seconds in which the galaxy, the thing the owner fell for ("it zooms in
   and there are nodes and it's moving"), does not move. Fix: the Map's ambient slow turn (`createMap({ ambient })`,
   §3) applied to the overview: a slow yaw of about 1.5°/s around the sun, eased in and out by the legs. It means
   time passing and the screen being alive, and if it stops, that is the alarm (as the corona does for a stale feed).
5. **The leaving is three cuts and a stray line.** `r40-galaxy` frame 6 (24.1 s), the same in warp frame 6: the
   plate is gone, a red leader is left hanging in empty sky down to the lock, the map label `■ STORAGE` comes back,
   and the banner returns at full size, all in the same instant. Fix: T20 (the leader dies with the plate). Bring
   the banner back only when the camera starts to move, so that the leaving has an order: words out, camera out,
   headline back.
6. **The hero is invisible inside its lock.** `r40-galaxy/frame-07.jpg` at full size: the lock holds two ▲
   glyphs and a smudge. The thing named in 72 px type is about 6 px on screen, inside a crowd of yellow labels.
   Fix: while it is the hero, the member grows by 1.5x and lights from inside in its status hue (the red effect the
   owner loves, §5), and the brackets size to it. The plate names it and the scene shows it.
7. **The kicker's counter has no horizon.** Frame 3 `TARGET 01 / 01`, frame 7 `TARGET 02 / 02`, frame 11
   `TARGET 03 / 03`: the total grows with the index, so it never tells me how many remain. A counter that is always
   "last of N" reads as broken. Fix: the total is the number of targets this cycle, taken from `tourOrder` at the
   cycle's first leg; or drop the counter (the r46 taste question is the owner's). The current form is wrong under
   either answer.
8. **The sun sits behind the tag.** Frames 7-9: DEMO-HOST's white disc is under `LANEBOARD · DEMO-HOST LIVE`.
   The hub is the anchor of the image, and here it is a smudge behind small print. Fix: T27.

## 1b. show (`flyTo`, `highlight`, `pin`): findings

1. **The agent has no voice.** `r39-wire/01-shown-by-wire.png`: the left two thirds of the frame are black. The
   agent's note is 14 px sentence case in a card stuck on the planets, and what the screen says loudest is
   bookkeeping (`2 MARKED`, `AT STORAGE`, `NOTE ON STORAGE`). This is the one moment where something talks to
   the room, and the owner's favourite thing (the words spelled out as the camera arrives) is missing from it.
   Fix: a show takes the caption plate. The kicker reads `SHOWN BY COCKPIT`, the note types in letter by letter as
   the hero's second line, and the pin's text types in its card. The rows top right stay as undo controls, a step
   smaller.
2. **The marked look like everything else.** `r38-show/02-arrived.png`: the four highlight rings are thin and
   white, the same weight as the stems' landing rings and the orbits. Fix: mark with the lock's grammar (four small
   brackets in `--text-1`) and draw a thin leader from the note to each marked node, so "these" in "These stop when
   storage fills" points at something.
3. **The note covers what it talks about.** `r38-show/03-held-7s.png`: the card sits across `vault` and
   `audit-log`. Fix: place cards on the side away from the system's centre, as T24 asks for site labels.
4. **The banner repeats the show.** `r38-show/02`: `■ HV2 · STORAGE` at top step under a show of HV2 STORAGE. It
   is the same echo rule as a held plate (T9): hide the line while the show names its subject.

## 1c. fx-beacon

1. **Still a scratch, and now it leans.** `r40-fx-beacon` frames 1-2: a 1-2 px red line rising up and to the left
   from HV2, tilted with the plane's normal, off the top of the frame. It reads as a lane or a scratch, not as a
   beacon, and it is gone in every hold. Fix: make it screen-vertical (a beacon points up on the screen, not up in
   the galaxy), give it a 6-8 px soft core with a cap at the tip, and keep the tip below the tag.

## 1d. fx-warp

1. **Red everywhere says "red", not "there".** `r35-fx-warp-flight` frame 3 (3.6 s): red hair over the whole
   frame, across both arms and over HV1's yellow. It is the most cinematic frame of the night, and the least calm
   one. I do know the target is red before the caption types it, which is the point. Fix: T21, as written (a cone,
   fewer streaks, hue only on the tips).
2. My 4 s samples (`r40-fx-warp`) caught no flight. The flights are short, and at wall pace warp is a seasoning,
   not a texture: that is right.

## 1e. fx-afterglow

1. **The finest frame of the night.** `r30-galaxy-with` frame 12: a thin red ring round HV2 and an amber one round
   REMOTE, both under quiet calm names. It is history you read in one glance, and it is quiet. My one finding: the
   ring's edge passes under `HV2` (the label sits on the ring). Fix: T24's label placement treats the ring as part
   of the disc.
2. My r40 film never returned to the overview after HV2 cleared at about 30 s, so I scored afterglow on r30.

## 1f. fx-activity

1. **The rings are too big when held.** `r40-fx-activity` frame 5 (19.5 s): a grey ring round `k8s-1` spans three
   neighbours and reads as a selection, the same thing T37's highlight ring says. Fix: when held, the ring is at
   most 2.5 planet radii, and it keeps the slow breath.
2. **At the overview it works.** Frame 2: CLOUD carries a ring and REMOTE does not. It is quiet and it reads.

## 1g. fx-sweep

1. **A radar with no sound.** `r37-sweep-second` frames 2-5: the wedge turns and HV1, HOME, CLOUD and HV2 ping
   in turn, while silent REMOTE stays dark. That is the right idea. The pings are thin grey ellipses that are gone
   by the next frame. A silent site should be the thing you notice, and here it is only a missing ping. Fix: when
   the line passes a silent site, the site's name dims one step until the next sweep reaches it with news. The
   gap then stays visible after the line has passed.
2. The r40 film at `pace=wall` caught no sweep in its overview frames. It is once per cycle and short, so it is
   easy to miss. That fits calm, but it fights "a glance tells me".

## 2. Across the variants (what one does that the others should steal)

- Afterglow's ring should be stolen by the clear itself: the banner's `CLEARED` beat (finding 1) and the ring are
  one story, told first in words and then in light.
- Warp's arrival beat (streaks snap back, the plate types) is the only cut with rhythm. The show's `flyTo` should
  steal it: when the agent sends the camera, the screen should feel sent.
- The caption's type-in should be stolen by the show note and the banner. Typed words are this page's signature,
  and today only the tour uses them.
- Sweep's gap logic (silence shows) should be stolen by the overview's slow turn: it is one more "alive or not"
  signal, and it costs nothing.

## What would make it unforgettable

1. **You would see:** a site that has been calm all day takes a faint gold edge on its nebula at dusk, and the
   edge goes as soon as anything happens there.
   **What it means in the data:** time since the site's last trouble, measured on the page as afterglow measures
   its clears: a streak of quiet days earns the edge (never hued like trouble, `--text-1` warmth only).
   **fx:** `fx=streak`.
2. **You would see:** at the overview, a thin line of light runs along the hyperlane from the sun to a site in the
   moment a show command or a job is sent there, and lands with the activity flash.
   **What it means in the data:** a command or deploy leaving the hub for that site (the flow events `flowJobs`
   already reads), so the hub is the source of what happens, not only the middle of the picture.
   **fx:** `fx=dispatch`.
3. **You would see:** when the tour comes back after touch or a show, the camera rises from where it is, out to the
   overview, while the kicker types `TOUR` and the clock flashes once.
   **What it means in the data:** the director handing the camera back to the tour (D10), so that a passer-by sees
   the screen let go of the person or the agent.
   **fx:** `fx=handback` (or no switch at all: the director's grammar).

## 3. Rubric

score galaxy overview 7
score galaxy legibility 7
score galaxy status 6
score galaxy touch 6
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 3
score fx-beacon calm 7
score fx-warp wow 7
score fx-warp calm 3
score fx-afterglow wow 7
score fx-afterglow calm 9
score fx-activity wow 5
score fx-activity calm 7
score fx-sweep wow 6
score fx-sweep calm 8

Notes: status is 6 because a crit arriving or clearing is still a swap in a text field (finding 1, T22), and two
top-step headlines compete in held frames (finding 2). Calm is 5 because the banner sits at the top step through
every flight and hold, and the overview does not move. Touch is not judged on a new filmstrip this round: it is
scored on r28-touch, r38-show/05-06 and r13's MANUAL line, unchanged from r11's 6 (the gestures exist; explore
still looks like the tour bar the MANUAL line). Performance is a guess: 11.7-15.8 fps under SwiftShader at cpu x4
says little about the Surface, and no film shows a cost from any fx.

## 4. The 3 m check

`r40-3m.png` (frame 1 of `r40-galaxy`, 684 px wide). **Yes.** The red `■ HV2 · STORAGE` banner and the red cluster
at HV2 say "wrong, there" at once, and REMOTE, HV2, DEMO-HOST, HV1, CLOUD and HOME all read. Two cautions remain
from r11. HV1's yellow nebula is as tall as HV2's red one: without the banner, warn and crit are about equal in
loudness (T23). And the tag top right is unreadable at this size, so a `STALE` there would not carry from 3 m.

## 5. console.txt

- `r40-galaxy/console.txt`: empty (0 console or page errors).
- `r40-fx-beacon/console.txt`: empty.
- `r40-fx-warp/console.txt`: empty.
- `r40-fx-afterglow/console.txt`: empty.
- `r40-fx-activity/console.txt`: empty.
- `r40-fx-sweep/console.txt`: empty.
- Older material cited above, `r35-fx-warp-flight`, `r37-sweep-second`, `r30-galaxy-with`, `r38-show`, `r39-wire`:
  each `console.txt` empty.
