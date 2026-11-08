# Review r45: operator, three metres away, night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). The last Wall commit is 09ebee7 (T53, r44), so every film
before this round is older than the variant. Filmed this round:
- `r45-galaxy`, `r45-fx-beacon`, `r45-fx-warp`, `r45-fx-afterglow`, `r45-fx-activity`, `r45-fx-sweep`:
  `galaxy.html?demo=1&quality=0&pace=wall[&fx=<name>]` on `demo-fleet.mjs --size large --tick 800`, SwiftShader,
  cpu x4, 12 frames over about 52 s (script `$RUN_DIR/r45-film.sh`, r40's with new names). Wall pace only: it is
  the only speed that tells me how long I wait for trouble.
- `r45-touch`: the gesture film (`$RUN_DIR/tools/r45-touch.mjs`, r28's CDP script with new names) on the same demo:
  tour → wake → drag → tap HV2 → sheet → back → 30 s → 62 s → tour → a director show. Stills 00-13 and
  `r45-touch-sheet.png`.
- Older material for what 4 s samples miss: `r42-show-demo` (the show demo, after T39), `r30-galaxy-with` frame 12
  (an afterglow ring after a clear), `r37-sweep-second` (a sweep with a silent site).
- `r45-3m.png`: `r45-galaxy/frame-01.jpg` (the overview, crit HV2 and warn HV1) at a quarter width, 684 px.

My question for every frame: I glance across the room with a coffee in my hand. What do I know now, and is it true?

## 1. galaxy: findings, worst first

1. **The down age is wrong for most of the hold.** `r45-fx-sweep` frames 8-12 and `r45-fx-beacon` frames 8-12: VM-C
   is held from 33 s to 53 s. The plate reads `NO CONTACT FOR 16S` at 33.3 s and 37.9 s, then `23S` at 42.5 s,
   47.1 s and 51.8 s. By the last frame the real age is about 38 s, so the plate is 15 s behind the clock. In beacon
   frame 10 (42.5 s) the plate disappears for a moment so the number can change. Why it matters to me: the age is
   how I decide between "it is rebooting" and "go look now". A number that is wrong for 15 s is worse than no
   number. Fix: T30 as written. Tick on the client (or `NO CONTACT SINCE 09:55`), update in place, no fade. This is
   my top task.
2. **The camera leaves the crit while its plate still names it.** `r45-fx-beacon/frame-12.jpg` (51.8 s): the plate
   still shows `■ VM-C` at full size. The camera has already pulled out until HV1 is a folded knot of about 60 px at
   the right edge, with the red lock round it. Below that, the banner says `▲ HV1 · FEAT-SEARCH` in yellow at the
   top step. At that moment the screen gives me three answers to "where": a down machine I cannot see, a lock round
   a blob, and a yellow headline. Fix: hold the crit framing as long as its plate stands. The camera starts out only
   after the plate has gone (plate out → camera out → banner back, as r40 finding 5 asks). If the hold must end
   early, end plate and framing together.
3. **During a crit hold the banner corner flips between empty and a warn headline.** `r45-fx-sweep` frames 8-12:
   VM-C is the only crit and is held, so the whole fleet line disappears (echo), including `5 SITES · 115 NODES`.
   That bottom-right corner is where I always look first, and it is black for 20 s. In `r45-fx-beacon` frame 12 the
   same corner names a yellow warn at the top step while the plate names a down machine. Fix: during an echo, keep
   a small count line in the corner at the reason line's size (`■ 1 DOWN · 2 ATTENTION`), so the corner is never
   empty and never louder than the plate. That is T19's held size applied to the echo case.
4. **Two headlines at the top step.** `r45-galaxy` frame 7 (28.3 s), and the same frame in warp, afterglow and
   activity: a 72 px yellow `▲ FEAT-SEARCH` hero and a 72 px red `■ HV2 · STORAGE` banner on one screen. From 3 m,
   red wins, which is the right priority. But the camera is showing me the other thing, and I have to work out that
   the warn is "now" and the crit is "still". Fix: T19 as written.
5. **The banner names a different place each time I glance, with the same fleet.** `r45-galaxy` frames 8-9: banner
   `▲ REMOTE · OFFICE-PRINTER` while HV1 is held. Frames 10-12: banner `▲ HV1 · FEAT-SEARCH` while REMOTE is held.
   Nothing changed in the fleet, and two glances 15 s apart give two different "worst" sites. T8 fixed this for
   crits (touch 09: `■ 2 CRIT · HV1 · HV2`, stable, good). Warns still flip. Fix: T28 (one ranking for every level,
   never picked by where the camera is).
6. **A clear is invisible.** `r45-galaxy` frames 7 → 8 (28.3 → 33.0 s): HV2 STORAGE clears. In one frame the 72 px
   red banner becomes a small yellow REMOTE line. If I glanced at 28 s and again at 40 s, I could not tell whether
   storage was fixed or only hidden behind the echo rule (finding 3 shows the banner also disappears while a crit
   stands). Fix: T50 (`HV2 · STORAGE · CLEARED` for about 4 s in `--text-2`).
7. **The kicker counts itself.** Plain tour: `TARGET 01 / 01`, `02 / 02`, `03 / 03` (`r45-galaxy` frames 4, 7, 11).
   After a hand-back from touch: `TARGET 01 / 05` (`r45-touch/09-idle-62s.png`). The same counter reads two ways, so
   I trust neither. Fix: T48.
8. **The crit cloud is not bigger than the warn cloud.** `r45-3m.png`: HV2's red nebula and HV1's yellow nebula are
   the same size, and the yellow one is taller and brighter at its core. The banner carries the "which", and the
   scene does not. Fix: T23.
9. **The held down machine sits under the sun and the tag.** `r45-fx-sweep` frames 8-12 and `r45-fx-beacon` frames
   8-11: VM-C's red lock is at the top-right edge of HV1 among `ci-retry`, `acme-billing`, `search ui` and
   `fix-login`. `DEMO-HOST`'s white disc and its name sit on `LANEBOARD · DEMO-HOST LIVE` (beacon frame 12). I can
   see something red up there, but I cannot point at the machine, and the tag is where `STALE` would appear. Fix:
   T25 (frame the hero member, not the star) and T27 (the tag is a cover).
10. **A countdown two hours away gets site-name type.** `r45-galaxy/frame-10.jpg` (42.3 s, the flight to REMOTE):
    `OFFSITE COPY IN 2 H` in big grey condensed caps, alone in empty sky, as large as the `▲ OFFICE-PRINTER` trouble
    label beside it. It is the second-biggest set of words in the scene, and nothing is wrong there. (r44 saw the
    same at CLOUD.) Fix: in the scene, a countdown is mono at about 0.6 of the member name's size in `--text-3`. It
    is drawn only once the system is held, not during the flight. Only the plate line (T53) gets readable size, and
    only when it is soon or late.

## 1b. touch (filmed: `r45-touch`)

1. **Explore does not read from 3 m.** `02-explore`, `03-dragged`, `07-back-pose`: the only signs are
   `MANUAL · TOUR IN 0:59` in the tag's 10 px mono and a small `▶ TOUR` box. If someone leaves the screen in explore,
   it looks like a calm overview for a minute. Fix: in explore, the clock corner or the banner's count line carries
   `MANUAL` at the reason line's size, and the corner brackets go `--text-2` (as r16 asked).
2. **Everything else works as a glance would want.** Wake → overview in 700 ms with the banner back (01). The drag
   holds (03). A tap flies to HV2 (04) and gives the STORAGE sheet with `‹ BACK` and no echo banner (05). Back lands
   on the dragged pose (07). At 62 s the tour resumes on the crit (09-11), and a show under the tour takes the camera
   and gives it back (12-13). The director log shows the largest per-frame camera jump at 0.158 of distance: no cut.
   No fix.

## 1c. fx-beacon

1. **At the overview it is a hairline. Close up it is a laser.** Frames 1-2: a 1-2 px red line leaning up-left from
   HV2 and off the top of the frame, a scratch at `r45-3m` scale. Frame 12: a wide red shaft from the held HV1 to the
   top-right corner, across the sun and the tag. Neither tells me "here" better than the nebula does. Fix: make it
   screen-vertical with a width floor at the overview (night 3's Later), and hide it while its own site is held,
   because the lock already says "here" there.

## 1d. fx-warp

1. **A warn flight paints the lower half yellow.** Frame 10 (41.6 s, the flight to REMOTE): yellow streaks across
   the bottom half of the frame, over HV2. A glance at that second says "trouble everywhere". It does tell me the
   next target is yellow before the plate does. Keep the tint and cut the coverage: T21.

## 1e. fx-afterglow

1. **Nothing to see at wall pace in this film.** HV2 clears at about 30 s, and the tour returns to the overview only
   after the 52 s sample. Scored on `r30-galaxy-with` frame 12, where a thin red ring round HV2 and an amber one round
   REMOTE read as history and stay quieter than live trouble. One risk for me: in its first minutes the ring is in the
   live crit red. Fix: T47 (dashed, starts amber).

## 1f. fx-activity

1. **A ring next to the held crit says "selected".** Frame 5 (19.3 s): a grey ring round `k8s-1` beside the red lock
   on STORAGE, about the lock's size. For a second my eye goes to it. Fix: when held, the ring is at most 2.5 planet
   radii, and none is drawn in a system whose hero is trouble.
2. At `r45-3m.png` size the overview rings on CLOUD and HOME do not read. That is fine for me: work is not trouble.

## 1g. fx-sweep

1. **The silent site is the news, and it does not reach 3 m.** No sweep falls in this film's samples (it runs once
   per cycle at the end of the overview leg). In `r37-sweep-second` the silent REMOTE is only a ping that does not
   happen, and the line is faint. A site that stopped reporting is exactly what I want to know from the kitchen.
   Fix: after a sweep, a silent site's name drops to `--text-3` with `SILENT 4M` beside it until news arrives. The
   tag reads `1 SILENT` beside `LIVE`.

## 2. Across the variants (what one does that the others should steal)

- The touch sheet (`r45-touch/05-site-sheet.png`) has one headline: the plate names STORAGE, the banner is gone, and
  `‹ BACK` is the only control. The tour's warn holds should copy it (finding 4).
- T8's crit line `■ 2 CRIT · HV1 · HV2` (touch 09-11) is the one banner that does not change subject with the camera.
  Warns should use the same line (finding 5), and the echo case should keep its count (finding 3).
- Warp's tint tells me where the camera is going before the type does. The plain galaxy could carry a trace of that
  on trouble flights (only the lock's hue at the destination) without the streaks.
- Sweep's freshness logic should feed the tag, because the tag is where I already look for `LIVE`/`STALE`.

## 3. Rubric

score galaxy overview 7
score galaxy legibility 7
score galaxy status 6
score galaxy touch 7
score galaxy wow 6
score galaxy calm 6
score galaxy performance 6
score fx-beacon wow 4
score fx-beacon calm 5
score fx-warp wow 6
score fx-warp calm 3
score fx-afterglow wow 6
score fx-afterglow calm 8
score fx-activity wow 4
score fx-activity calm 6
score fx-sweep wow 5
score fx-sweep calm 8

Notes:
- Status 6: the tour goes to trouble first every cycle, and two crits get one stable line. Against that, the down
  age lags by 15 s (finding 1), the camera leaves the crit under its plate (finding 2), warn headlines flip
  (finding 5), and the crit cloud is not larger (finding 8).
- Touch 7 is scored on the `r45-touch` gesture film: every step works without a cut, and explore is hard to tell
  from 3 m.
- Performance is a guess. Under SwiftShader at cpu x4: 12.1-15.8 fps and worst gap 221-314 ms (r16: 12.3-13.6 and
  306-424). The touch run's `__wallPerf` reads `scriptMs` 1 and `frameMs` 23.3. This says little about the Surface.
- Afterglow and sweep are scored on r30 and r37, because this round's samples missed both.

## 4. The 3 m check

`r45-3m.png` (`r45-galaxy/frame-01.jpg`, overview at 0.6 s, 684 px wide). **Yes, mostly through the banner.**
`■ HV2 · STORAGE` and `POOL 97% FULL` read at once, and the red `■ HV2` beside its red cloud says where. All six
names read: REMOTE, HV2, DEMO-HOST, HV1, HOME, CLOUD, with `HV1` whole this time beside its yellow cloud. Three things
do not survive: the yellow HV1 cloud is as big as the red one, so without the banner my eye splits (finding 8); `+3
MORE` and the date are smudges; the tag (`LIVE`/`STALE`) is unreadable at this size, so a dead feed would not show
from here unless the sun's cold grey does it.

## 5. console.txt

- `r45-galaxy/console.txt`: empty (0 lines).
- `r45-fx-beacon/console.txt`: empty (0 lines).
- `r45-fx-warp/console.txt`: empty (0 lines).
- `r45-fx-afterglow/console.txt`: empty (0 lines).
- `r45-fx-activity/console.txt`: empty (0 lines).
- `r45-fx-sweep/console.txt`: empty (0 lines).
- `r45-touch/console.txt`: empty (0 lines).
