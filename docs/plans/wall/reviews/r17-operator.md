# r17: operator

The persona: a homelab and a few agent builders, the Wall across the room, a glance while the coffee runs.
Three seconds, three metres: is anything wrong, what, where. Is the worst thing the loudest? Does the tour
bring me to trouble or make me wait?

Material (all on `galaxy.html`, `demo-fleet.mjs --size large`, SwiftShader, CPU 4x):
- `r16-galaxy` (`?demo=1&quality=0`, after T7's commit cbd8389; newest galaxy film, used as is).
- `r17-fx-beacon` (`?demo=1&quality=0&fx=beacon`, new: r11's was older than T5-T7).
- `r17-pace-wall` (`?demo=1&pace=wall&quality=0`, new: the owner's real speed. Without `pace=wall` the
  demo's `DEMO_TIMING` has no `revisitEvery` and gives crit and calm the same 1.75 s, so the demo films say
  nothing about how fast trouble is reached).
- Stills `r17-overview` and `r17-hv2` (1368 css px wide at 2x, the 12-inch 3:2 tablet), `r16-touch` (T7's CDP
  touch stills), `r17-3m.png`.

## galaxy

1. **A new crit at a site already visited this cycle waits for the next cycle.** `r17-pace-wall`: HV1 is
   target 01 (18-25 s, FEAT-SEARCH, attention). By 36 s the banner says `HV1 · VM-C · BUILDER-C NO CONTACT
   FOR 17S` in red, so the crit is about 19 s old. The camera holds REMOTE (attention, 31-41 s), then flies to
   CLOUD (warn, 47-59 s). VM-C clears at 47 s. The crit was never shown, never captioned, never locked: for
   ~30 s the worst thing in the fleet got only the banner, while an attention and a warn got 14 s each. Cause
   as far as I can see: `tour.js nextLeg` re-ranks before every leg but skips sites already in `visited`, and
   the revisit rule only kicks in after 2 *calm* sites. Why it matters: the page's whole promise is that crit is
   visited first. A builder that drops off is exactly the thing I need to see on the wall. Fix: in `nextLeg`, a
   site whose worst status rose above what it had at its visit (or any crit not yet shown as crit) jumps the
   queue at the next leg, visited or not. Test: a model where a visited site turns crit mid-cycle gets it as
   the next leg.
2. **A cleared trouble is the loudest thing on screen.** `r17-pace-wall` 74.8 s: the camera leaves a calm
   HOME and the biggest object in the frame is a full-size red `■ HV1 · VM-C` slab over `CLEARED 28S AGO`.
   47-70 s: the same red block, small, under calm plates. From 3 m red block = crit. I would walk over for
   something that is fine. This is T18. It is still open and, from where I stand, it is the worst false alarm
   on the page. Fix as T18 says: cleared drops to the fleet line's calm size in `--text-2`, one small red glyph.
   I would put T18 ahead of the fx tasks.
3. **The plate names a target the camera is not on.** `r17-fx-beacon` 8.5 s and 79.9 s: yellow `FEAT-SEARCH`
   (HV1's) is typing while the frame shows HV2's red nebula and the sun, with HV1 out of shot. At 40.7 s
   `REMOTE` types over CLOUD. `r16-galaxy` 33.6 s: same, FEAT-SEARCH over a frame where HV1 is a small
   yellow blob in a corner. At a glance this tells me the wrong *where*: a yellow word next to a red cluster.
   This is T15 (typing at progress 0.9). It holds in the wall-pace film too (the plate fades in `leadMs`
   before arrival). Fix: T15. Also have no plate at all before arrival, not only no typing.
4. **At the overview, the crit cluster's straight red tether runs across the galaxy.** `r17-overview`, `r16-touch
   3-explore`, `r16-galaxy` 27.8 s: a thin red line from the banner up to HV2, crossing HOME's hyperlane and the
   dust. From 3 m it reads as a red link between the banner and some lane, i.e. more trouble. The glyph
   `■ HV2` already says where. Fix: T16 (no tether at the overview).
5. **A crit nebula's own glow eats its label.** `r16-galaxy` 55.3 s: HV1 went crit and its label reads `■ HV(`.
   The red nebula is drawn over the letters. The one name I need at that moment is the one that gets cut.
   Fix: trouble labels get a `--bg-canvas` halo or plate and draw after the nebula (Later's A4 T34). Test: no
   nebula sprite is drawn over a trouble label's box.
6. **The fleet's "is it live" is invisible from 3 m.** `r17-3m.png`: `LANEBOARD · DEMO-HOST LIVE` is 2-3 px tall.
   T6's grey sun is the distance signal, and its round-15 note says it is quiet by design. I cannot judge a dead
   feed at 3 m from what was filmed (no `--quiet-after` film this round). Fix, cheap: when stale, the tag moves
   to the clock's size next to the clock (`STALE 2M` at the clock step, `--text-1`). The clock is the one thing
   I always read, and nothing else depends on it. Q14's `freeze` remains the strong option (with the owner).
7. **Under a calm plate the crit banner shrinks to the calm name's size.** `r17-fx-beacon` 14.7 s and 46.3 s:
   white `CLOUD`/`HOME` and red `■ HV2 · STORAGE` are about the same height. The red still wins on hue, but
   only on hue. A colour-blind glance sees two equal words. T4 dropped the banner to `--cap-name` to avoid two
   headlines when the plate *is* trouble. On a calm plate there is no second headline to avoid. Fix: `data-plate`
   carries the plate's tone; a calm plate keeps the banner at full size (or one step down, never level with a calm
   name).
8. **The open crit system says STORAGE three times and HV2 twice.** `r17-hv2`: hero `STORAGE`, label `■ STORAGE`
   by the node, `HV2` under the hero and `HV2` at the star. At 3 m the eye counts four red/white headlines and
   has to work out they are one thing. T20 covers this. The `1 crit` status line is white: put it in the crit hue
   with its shape, as the warn plates already do (`▲ ATTENTION FIX-LOGIN…` in `r17-pace-wall` 18 s).
9. **Plate detail rows are too small for 3 m.** `r17-hv2`: `HARDWARE`, `WHERE`, `HOLDS` and the cpu/mem bars are
   about 13 css px. Unreadable across the room. Fine as close-up detail, but the trouble lines on a warn plate
   (`r17-pace-wall` 18 s: `▲ ATTENTION FIX-LOGIN · asked a question · 7m`) are the same size, and those carry the
   why. Fix: the plate's trouble rows at the caption's second step (`POOL 97% FULL` size); hardware/where/holds stay small.

What works for me, so the fix does not undo it (facts, not praise): at wall pace the first trouble plate is up at
18 s and holds 14 s. A warn/attention hero is readable in the 3 m still. At the overview the three trouble
sites are the only coloured things.

## fx-beacon

1. **No pillar at the overview, where I need it.** `r17-fx-beacon` 3.7 s and 53.5 s: at the overview the crit
   HV2 shows a nebula and no visible beacon. The pillar shows only once the camera is close (8.5 s, 32.3 s,
   79.9 s). The beacon's job, for me, is "where" from across the room. It does that only after the tour has
   already flown there. Fix: T9's floor height in screen terms at the overview.
2. **Close up, the pillar adds a second red where one is enough.** 32.3 s and 58.1 s: a thin red spike rises out
   of the red nebula next to a red plate and a red label. It does not tell me anything the plate does not. Fix:
   T9's white core and the Later note (nebula one step down while a beacon stands). Better: fade the beacon out
   while its own system is held.
3. **The beacon does not say how old the crit is in a way I can read.** Its height-by-age is invisible at the
   distances where it shows. Fix: T9 (width as well as height); a beacon that is old must look different at the overview.

## fx-lanes, fx-comets, fx-twinkle

Not filmed this round. They are still in `FX_NAMES`, unchanged since r11's film, and are slated for removal
(lanes) or rework into `activity`. Operator view from r11's frames: none of them tells me anything about
trouble from 3 m. Scored on that.

## touch

Not built beyond T7 (first touch). There are no drag, tap, sheet or back yet, so no gesture filmstrip exists, and
I score the one step that is there. `r16-touch` 1→3: a tap on a held HV2 eases out to the overview, the plate goes,
and the tour stays stopped. Findings for the next touch tasks:
1. **In explore mode nothing on screen says "you are in control" or how long until the tour returns.**
   `3-explore.jpg` looks exactly like the tour's overview. From across the room I cannot tell a stopped tour from a
   running one. If someone touched it and walked away, the next glance sees a frozen overview and no plate, so I
   wonder if the page hung. Fix (T13/T14): the back control and a thin 60 s countdown line along the bottom edge
   while exploring, `--text-3`.
2. **A touch on a crit should take you there, not away from it.** The touch stills show a tap on a held HV2 that
   leaves HV2 for the overview. That is the plan (C1), and I accept it. But T10 must make the next tap on the red
   cluster easy: the overview's trouble glyphs should be the biggest hit targets.

## Across the variants

- The **warn/attention plate** (`r17-pace-wall` 18 s) lists its trouble rows each with shape, status word and age
  in hue. The **crit plate** (`r17-hv2`) puts its status as a white `1 crit`. The crit plate should steal the
  warn plate's row format.
- The **wall pace** (`?pace=wall`) is the only film that answers my question. The demo pace hides the tour's
  order. The `film-ui`/`dreamer` panels judge motion at demo speed; every operator round should film `pace=wall`.
  The loop could add `revisitEvery` to `DEMO_TIMING` so the demo films show the revisit rule.
- The banner's **`CLEARED 28S AGO`** sub-line is the right words in the wrong voice. The fleet line's calm style
  should carry it.

## Scores

score galaxy overview 7
score galaxy legibility 6
score galaxy status 5
score galaxy touch 2
score galaxy wow 6
score galaxy calm 5
score galaxy performance 6
score fx-beacon wow 5
score fx-beacon calm 5
score fx-lanes wow 2
score fx-lanes calm 7
score fx-comets wow 2
score fx-comets calm 7
score fx-twinkle wow 2
score fx-twinkle calm 8

Why status 5: the overview is honest, but a crit that lasted ~30 s was never visited (finding 1), and a cleared
trouble was the loudest thing in a frame (finding 2). Performance is a guess. SwiftShader fps (1.4-1.8, worst
gap 2.7-4.3 s) measures the VM, not the page. No `?perf=1` script-ms reading was taken this round. The owner
reports the Surface runs well.

## 3 m check

`$RUN_DIR/shots/r17-3m.png` (the `r17-overview` still, 2736 px → 684 px; the strip below is padding).
**Yes, for trouble and names; no, for freshness.**
- **Something is wrong and where:** yes. The red `■ HV2` glyph and nebula, the two yellow `▲` (REMOTE, HV1)
  and the big red `HV2 · STORAGE` banner are the only colour. The banner reads at this size.
- **Site names:** yes. HV2, REMOTE, HV1, DEMO-HOST, HOME and CLOUD are all readable.
- **Not readable:** the tag `LIVE`, `+5 MORE`, the date under the clock. Whether the data is live cannot
  be read from 3 m (finding 6).
- The red tether from the banner to HV2 reads as an extra red line (finding 4).

## console.txt

- `r16-galaxy/console.txt`: empty (0 lines).
- `r17-fx-beacon/console.txt`: empty (0 lines).
- `r17-pace-wall/console.txt`: empty (0 lines).
- `r17-overview/console.txt`: empty (0 lines).
- `r17-hv2/console.txt`: empty (0 lines).
