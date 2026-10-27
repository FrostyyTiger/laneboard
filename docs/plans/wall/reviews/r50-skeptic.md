# Review r50: skeptic, night 4

Material, all in `$RUN_DIR/shots/` (none in the repo). The last Wall commit is a34674e (T42). The effect and touch films
before this round were older than it, so I filmed them again on HEAD a407f1b:
- `r50-galaxy`, `r50-fx-beacon`, `r50-fx-warp`, `r50-fx-afterglow`, `r50-fx-activity`, `r50-fx-sweep`:
  `galaxy.html?demo=1&quality=0&pace=wall[&fx=<name>]`, SwiftShader, cpu x4, 12 frames over about 52 s (script
  `$RUN_DIR/r50-film.sh`, r45's with new names).
- `r50-touch`: the gesture film (`$RUN_DIR/tools/r50-touch.mjs`, r45's CDP script with new names): tour → wake → drag
  → tap HV2 → sheet → back → 30 s → 62 s → tour → a director show. Stills 00-13 and `steps.json`.
- Older material, still current for what it shows: `r42-show-demo` (the show demo; `show.js`/`showdemo.js` have not
  changed since), `r47-half-e` (half a screen, T41), `r48-t42-role` (`?role=explore`).
- `r50-3m.png`: `r50-galaxy/frame-01.jpg` (the overview, two crits) at 684 px.

Tooling note: a demo hub left over from round 48 (`demo-fleet.mjs --size large`, without `--tick 800`) still held
port 7795. So my own hub exited (`EADDRINUSE`, `/tmp/r50-demo.log`), and every r50 film ran against that one. It
serves this checkout's files, so the page is current. Only the demo's tick differs from r45. I left the process alone,
because it is not mine to kill.

My question for every element: what does it tell the viewer that nothing else on screen already tells them? If the
answer is nothing, remove it.

## 1. galaxy: findings, worst first

1. **During a crit hold, the only number that ticks is a calm job's countdown. The trouble's own age is frozen.**
   `r50-fx-afterglow` frames 5-9 (19.2-38.0 s, VM-C held): `DUMPS DB · 12:28, 12:24, 12:19, 12:14, 12:09` counts down
   smoothly. Over the same 19 s, `BUILDER-C NO CONTACT FOR 16S, 16S, 24S, 24S, 24S` jumps in 8 s steps and lags the
   clock. `r50-fx-sweep` frames 7-12 show the same thing (`10:24 → 10:00` beside `16S … 28S`). The plate moves the eye
   to the one line about a different, healthy machine (a scheduled DB dump on HV1). Why it matters: on a crit plate,
   motion says "this is what is happening now", and here it points at the wrong line. Fix: on a plate whose hero is
   trouble, no countdown line, unless the countdown's own node is the hero. Then T30 as written, so the age ticks on
   the client or reads `SINCE 10:29`.
2. **The same countdown is shown twice, in two formats and two sizes.** `r50-fx-beacon` frame 12 (CLOUD held): the
   scene says `LIFECYCLE +13 MIN` in big grey caps beside `object-store`, and the plate says `LIFECYCLE OBJECT-STORE ·
   +13:10`. `r50-fx-warp` frame 3 says `DUMPS IN 13 MIN` in the scene. The held plate in frame 4 says `DUMPS DB ·
   13:30`. T56 as written (scene label "drawn only once its system is held") makes this duplicate permanent, because
   the plate line (T53) is also drawn only while held. Fix: one place per hold. While a plate carries the countdown,
   the scene does not draw it. The scene label exists only where no plate is: touch explore, or a system open without
   a hold. Amend T56.
3. **`+13 MIN` reads as "in 13 minutes".** `r50-fx-beacon` frame 12 and `r50-fx-warp` frames 11-12 (`+14:02`, rising)
   show a job that is 13-14 minutes *late*. `countdown.js` calls an overdue job "news". On screen, the only sign is a
   `+` in grey, in a font where `+` looks like a bullet. A stranger reads "lifecycle runs in 13 minutes": the opposite
   of the truth. Fix: say it in words, `LATE 13 MIN` and `13:10 LATE`. Keep no hue (late is not trouble, as decided).
4. **The red lock frames a yellow glow. The down machine inside it is grey.** `r50-galaxy/frame-04.jpg`: the red
   brackets round VM-C hold a grey sphere and half of `ci-retry`'s yellow halo. The brightest thing inside the crit's
   own lock is a warn. Five yellow `▲` labels (`ci-retry`, `fix-login`, `acme-billing`, `search ui`, `feat-search`)
   sit around it, and VM-C's name is hidden because the plate names it. Fix: T29 as written. It is still open, and it
   is the scene half of §2.1.
5. **A count change of a mild line costs a retype, and once a whole camera move.** `r50-fx-afterglow` frame 7
   (28.6 s): `3 ATTENTION` became `2 ATTENTION`, and the plate re-typed from the site line (`HV1▌`, the lines below
   faded). `r50-fx-sweep` frame 10 (42.4 s), inside a VM-C hold: the plate is gone, the camera is pulled out wide
   (HOME, CLOUD, DEMO-HOST in frame), and the banner is back at the top step. Frame 11 then holds VM-C again, with the
   same `TARGET 02 / 05` and a new age `28S`. A glance at 42 s sees no crit plate at all. Fix: T30, extended. A change
   to anything but the hero's subject or level updates in place, and never moves the camera or restarts the hold.
6. **The banner corner is empty for a whole crit hold.** `r50-fx-afterglow` frames 5-9 (19 s) and
   `r50-fx-activity` frames 6-9 and 11-12: no fleet line, no count. That is where `LIVE`/trouble is read first. Fix:
   T55 as written.
7. **A calm plate is an empty box, then a name that is already on screen.** `r50-fx-beacon` frame 10 (42.8 s):
   brackets, `TARGET 03 / 05` and a bare cursor block, with nothing else, for the whole 4 s sample. Frame 11: the plate
   says `HV2`, and 20 cm to the right the star is labelled `HV2`. That is 10 s of the tour where the largest box on
   screen tells the viewer nothing. Fix: on a calm hold, no plate. Or one fact line (r21 11, the owner's question
   (b)). Never the star's name alone, and never an empty frame.
8. **Trouble plates still repeat themselves, and now truncate.** `r50-galaxy/frame-04.jpg`:
   - the kicker `■ DOWN · TARGET 01 / 05` repeats the hero's `■` and the reason's "no contact";
   - `STATUS ■ 1 DOWN ▲ 3 ATTENTION ▲ 1 WARN` repeats the hero and the two lines under it, and its `3` names three
     problems where two lines follow (the third is only in the scene);
   - `FEAT-SEARCH · WAITING ON A PERMIS…`, cut off at reason size. A cut sentence is the widest yellow line on a red
     plate;
   - `CPU 34 % · MEM 62 %` is HV1's load, which has nothing to do with VM-C being unreachable.
   In yellow area, the plate is now more warn than crit. Fix: r21 6 (in Later): drop the kicker's count, the `STATUS`
   row and CPU/MEM on trouble plates. The secondary lines are name + age only (`▲ FEAT-SEARCH · 12M`), one step
   smaller, never cut.
9. **The warn banner still changes subject with the camera.** `r50-fx-beacon` frames 7-9: `▲ HV1 · FEAT-SEARCH` while
   REMOTE is held. Frames 10-12: `▲ REMOTE · OFFICE-PRINTER` while HV2 and CLOUD are held. Nothing changed in the
   fleet. Fix: T28 as written.
10. **Hyperlanes: one per site, so they say nothing, and the tinted ones repeat the status.** `r50-3m.png`,
    `r50-touch/03-dragged.png`: a thin line from the sun to every site. Every site has one, so "is connected" carries
    no information. The red one to HV2 and the yellow one to HV1 are the fourth mark for the same trouble (nebula,
    `■` label, banner, lane). T26 makes them grey, and then they carry nothing at all. Fix: remove them at the
    overview, or give them one job nothing else does: dashed or dark when the site's feed is silent (sweep's
    freshness, finding fx-sweep 1).
11. **`+N MORE` and the fleet facts flicker without meaning** (r21 8, still in Later). `r50-galaxy` frames 1-12:
    `+3, +3, +3, +3, +4, +3, +3, +3, +4, +5, +4, +4 MORE`. In `r50-fx-warp`, `… · 7 / 6 / 8 / 7 WORKING`. In
    `r50-3m.png` both are smudges. Remove both. If a milder count stays, it changes only when a problem starts or
    clears.
12. **The tag sits under the sun** (`r50-galaxy` frames 4-5: DEMO-HOST's disc on `LANEBOARD`). `LANEBOARD ·
    DEMO-HOST` repeats the sun's label. Only `LIVE` carries information. Fix: T27, with the tag reduced to `LIVE` /
    `STALE 2M`.
13. **The date under the clock** (`TUE 27 OCT`): unreadable in `r50-3m.png`, and nobody at a wall needs it. Remove it
    (Later, r21 12).

## 1b. touch (filmed: `r50-touch`)

1. **The sheet says HV2 twice and crit three times.** `05-site-sheet.png`: the kicker `■ SITE · HV2`, the line `HV2`
   under the reason, the hero's `■`, the kicker's `■` and `STATUS ■ 1 CRIT`. Fix: the kicker says `SITE` (or
   nothing). No `STATUS` row when the hero already carries the level.
2. **A director show with no line saying who moved the camera.** `12-show-3s.png`: the probe drives the director's
   `show` source directly, not `show.js`. The camera holds calm HV2, the left half is empty, and the banner names a
   crit at HV1. Nothing on screen says why the camera is here. `show.js` would draw `SHOWN BY …`, but the director
   accepts a show move without one. Fix: the director takes `show` moves only from `show.js`, or draws the line itself.
   A camera that moves for an unseen reason looks like a bug.
3. **Explore from 3 m is still the tag's 10 px `MANUAL · TOUR IN 0:59`** (`03-dragged.png`). The `▶ TOUR` box is the
   only visible sign. r45 touch 1 stands.
4. Everything else holds: wake → overview in 700 ms, drag, tap → sheet with `‹ BACK`, back to the dragged pose, tour at
   62 s, a show under the tour that gives the camera back. The largest per-frame camera jump is 0.164 of distance (no
   cut). A show under a finger is refused `busy`. No fix.

## 1c. show (r42-show-demo, r47-half-e/05-show)

1. **A pinned card outlives its fact.** `r47-half-e/05-show.png`: `POOL 97 % FULL · Full in about 2 h at tonight's
   rate` in white beside a grey (cleared) storage. The banner meanwhile names a new crit, `HV1 · VM-C`, which the
   camera is not showing. The card is a static claim with a TTL of up to 10 minutes. Fix: when its node's status drops
   below the level it had at pin time, the card goes `--text-3` with `WAS` before the title, or is dropped.
2. **One conversation, four corner rows.** `r42-show-demo` frames 5-8: `SHOWN BY COCKPIT`, `3 MARKED ✕`, `AT
   DEMO-HOST ✕`, `NOTE ON STORAGE ✕`, in tag mono and unreadable at 3 m. Each `✕` undoes a part nobody asked to undo
   separately. Fix: one row, `SHOWN BY COCKPIT ✕`, that clears the whole show. The 48 px target stays, and per-command
   undo is dropped.
3. **The note card sits on the site's name** (`r42` frames 5-8: `■ HV` cut by the card), and the banner says the same
   `HV2 · STORAGE` at the top step under it. Covered by T52/T51.

## 1d. fx-beacon

1. **Two hairlines, leaning different ways, telling nothing the nebula does not.** Frames 1-2: one red 1-2 px line up
   from HV2, one up from HV1. In `r50-3m` terms they vanish. At a held site they are not drawn, which is right. Each crit
   already has a nebula, a `■` label, a tinted lane and the banner. Remove it, or give it width and age (Later) so it
   says "how long", which nothing else says.

## 1e. fx-warp

1. **It repeats the banner.** Frame 3 (9.9 s, the flight to HV1): the banner already says `■ HV1 · VM-C` at the top
   step, so the streaks' tint tells the viewer nothing new. On calm flights it is now quiet (T15), which is right.
   Frame 10 (the flight to CLOUD, a warn) shows faint yellow round the target only. Keep it as taste, not information.
   It earns its place only in explore, where there is no banner subject.

## 1f. fx-afterglow

1. Nothing cleared during the 52 s of film. Scored on night 4's earlier films (r30, r35), where it is the one effect
   that shows something nothing else shows: where trouble *was*. T47 (dashed, starting amber) stands.

## 1g. fx-activity

1. **At the overview it cannot be told from the plain galaxy.** `r50-fx-activity` frames 1-2 next to `r50-galaxy`
   frame 1: same five knots, no visible ring or brightening. Its brief (README §7 Night 3 D) says "must be visible at
   the overview from 3 m". It is not. Fix: at the overview, a site with work gets one step of brightness on its knot.
   Otherwise remove the effect.
2. **At the site step its rings look like locks.** Frames 10-12: grey rings round HV2's working planets, about the
   lock's size, beside the red lock on `storage`. Fix: r45 activity 1 (at most 2.5 planet radii, none in a system whose
   hero is trouble).

## 1h. fx-sweep

1. **Its one job, "this site went silent", does not show.** Frame 1: a faint lighter wedge from the sun toward CLOUD,
   and nothing at 3 m. A silent site shows as a ping that does not happen, so an absence of motion has to carry the
   news. Fix: r45 sweep 1 (a silent site's name drops to `--text-3` with `SILENT 4M`, and the tag counts it). Then the
   line is decoration that triggers a state. Without that, remove it.

## 2. Across the variants (what one should steal from another)

- The two-crit banner `■ 2 CRIT · HV1 · HV2` (`r50-galaxy` frames 1-3) is the one line that does not change subject
  with the camera. The warn banner should take its form (T28).
- The touch sheet drops the banner echo (`05-site-sheet.png`: one headline, `‹ BACK` the only control). Tour holds
  should do the same for a warn hero (T19), and the show should too: when a show pins a note on the banner's subject,
  the banner steps down.
- `fx-afterglow` is the only effect that adds information nothing else shows. Every other effect should pass its
  test: "what does this show that is not already on screen?" Beacon, warp and activity at the overview fail it today.
- Sweep's freshness should feed the hyperlanes and the tag, which are the two elements on screen with no job.
- The half-screen layout (`r47-half-e/01-held-crit.png`) shows that the plate's empty lower-right half is padding.
  The full-width plate could be that narrow too.

## 3. Rubric

score galaxy overview 7
score galaxy legibility 7
score galaxy status 5
score galaxy touch 7
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 3
score fx-beacon calm 5
score fx-warp wow 6
score fx-warp calm 4
score fx-afterglow wow 5
score fx-afterglow calm 8
score fx-activity wow 3
score fx-activity calm 6
score fx-sweep wow 4
score fx-sweep calm 8

Notes:
- Status 5: the tour goes to the crit first, and the overview banner is right. But during the hold the age is frozen
  while an unrelated countdown ticks (1), the crit's lock frames a yellow glow (4), a mild count change re-types the
  plate or moves the camera (5), and the corner goes empty (6).
- Calm 5: retypes, the `+N MORE` flicker, and a seconds counter on a trouble plate are all motion without meaning.
- Touch 7 is scored on the `r50-touch` gesture film. Every step works with no cut. It loses points for the sheet's
  repeats and for an explore state that cannot be seen from 3 m.
- Performance is a guess. SwiftShader at cpu x4 gives 12.3 fps / worst gap 350 ms (galaxy) and 13.4-14.1 fps /
  230-282 ms (effects). That says little about the Surface.
- Afterglow is scored on earlier films, because no clear fell inside this round's 52 s.

## 4. The 3 m check

`r50-3m.png` (`r50-galaxy/frame-01.jpg`, the overview at 0.8 s, 684 px wide). **Yes.** `■ 2 CRIT · HV1 · HV2` is the
loudest thing on screen. The two red nebulae with red `■ HV1` and `■ HV2` beside them say where. All six names read
(REMOTE, HV2, DEMO-HOST, HV1, HOME, CLOUD). What does not survive: the reason line under the banner explains only VM-C
and not STORAGE (one of the two crits gets no "why" at this distance). `+3 MORE`, the date and the tag (`LIVE`) are
smudges, so a dead feed would not show here unless the sun's grey did.

## 5. console.txt

- `r50-galaxy/console.txt`: empty (0 lines).
- `r50-fx-beacon/console.txt`: empty (0 lines).
- `r50-fx-warp/console.txt`: empty (0 lines).
- `r50-fx-afterglow/console.txt`: empty (0 lines).
- `r50-fx-activity/console.txt`: empty (0 lines).
- `r50-fx-sweep/console.txt`: empty (0 lines).
- `r50-touch/console.txt`: empty (0 lines).
- `r42-show-demo/console.txt`, `r47-half-e/console.txt`, `r48-t42-role/console.txt` (older material used above):
  empty (0 lines).
