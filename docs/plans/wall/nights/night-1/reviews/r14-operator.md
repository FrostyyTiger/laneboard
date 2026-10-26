# Review r14: the operator, three metres away

Round 14, night 1. Persona: operator (glance from across the room: is anything wrong, what, where).

What I judged: only `radial` exists. Newest film: `$RUN_DIR/shots/r13-caption/` (`radial&demo=1`,
12 frames over 33 s, CPU 4x, SwiftShader wrapper), shot by the T6 round 11 s before its commit
d3f65ff, the last commit under `public/js/wall`. I used it rather than shooting again. I cropped
frames 1, 2, 3 and 10 at 1:1 (2736x1824, the 12.3" tablet at 2x, 10.5 device px per mm, research Q3)
to judge sizes at their real scale. Lock, glow and frame (T7-T9) are not built yet.

Size yardstick (Q3): read at 3 m needs about 17.5 mm cap height (20'), 184 device px here. At 1.5 m,
about 9 mm (95 px).

Demo timing is 4 s overview, then 2.25 s flight and 1.75 s hold per site. Normal timing is 20 s
overview, then 2.25 s + 25 s per site. I judge the frames as demo shows them, and the cycle at normal
timing.

## radial

1. **From 3 m, no text on screen is readable. Only colour tells me anything.** Overview labels
   (frame 1, 1:1 crop): `HV2`, `HOME`, `PORCH-LIGHT` are all about 16 px cap, 1.5 mm. That is readable
   at 25 cm. The caption name (`HV2`, frame 2) is about 95 px, 9 mm: readable at about 1.5 m, not 3.
   The trouble line `pool 97% full` is about 38 px, 3.6 mm: readable at about 60 cm. So from the
   coffee machine I see "there is red", never "storage on hv2 is full". Why it matters: north star 1
   asks for *what* and *where*, not just *whether*. Fix: in the caption, set the trouble line as
   the biggest text on the plate, not the site name: the problem word (`STORAGE FULL 97%`) at the 3 m
   step (about 180 px cap, condensed, status colour). Put the site name under it at the 1.5 m step.
   Drop HARDWARE/WHERE/HOLDS on trouble sites, or move them to the 1 m step under a gap. On calm sites
   keep today's order.

2. **No line says what is wrong when the camera is not in a trouble site.** Frames 1, 4, 8, 9, 12
   (overview and flights) and frames 5-7 (CLOUD, REMOTE, HOME, calm) carry no fleet-level trouble
   text at all. In a normal cycle that is about 100 s of every ~156 s. A glance there tells me
   "some red dots somewhere", nothing more. Why it matters: about 2 in 3 glances land on a calm or
   empty frame. Fix: T9's worst line, bottom right, always on. While anything is crit, set it at the
   3 m step, not as a small status line: `■ HV2 · STORAGE 97% FULL`. Below it, a count: `+2 more`.
   I would raise T9 ahead of T7 (lock) and T8 (glow).

3. **Calm sites cost as much time as trouble.** In the first cycle (frames 2-7) hv2 (crit) and hv1
   (attention) come first, which is right. Then CLOUD, REMOTE and HOME each get the same hold as the
   crit. At normal timing that is 3 x 27 s = 81 s of calm before the crit comes round again, plus a
   20 s overview. Why it matters: the tour visits trouble first but does not dwell on it. Fix: while
   anything is at warn or worse, hold calm sites short (about 8 s) and trouble sites long (25 s). Or
   go back to the worst site between calm ones (crit, calm, crit, calm). With no trouble, keep today's
   even holds.

4. **The worst thing is not the loudest.** Frame 9 (24.2 s overview): at least three red ■ (hv2,
   storage, vm-c under hv1) and four yellow ▲ (hv1, remote's printer, lanes at the top). All are the
   same mark size, about 20-30 px. Crit and attention weigh the same. The yellow cluster at the top
   edge pulls the eye first. Why it matters: with several problems I cannot tell which one to get up
   for. Fix: this is T16 (crit halo several node radii wide, attention at mark size). Also: at the
   overview, label only nodes at warn or worse, at the 1.5 m step, in their status colour. Then the
   only words at the overview are the problems.

5. **The caption's trouble line shows one problem and hides the rest.** Frame 10: hv1 says
   `crit · 6 of 41 in trouble` and names only `VM-C builder-c no contact for 16s`. Frame 3, one cycle
   earlier, named `FEAT-SEARCH waiting on a permission prompt · 5m`; that line has now gone, though it
   is probably still among the 6. Why it matters: "6 in trouble" without a breakdown makes me walk up
   to the screen. Fix: make the status line a severity count (`1 crit · 5 attention`). Below the worst
   line, show the next two worst one per line, at the 1 m step.

6. **Empty plates are dead glances.** Frame 11 (30.0 s): a dark plate with `TARGET 02 / 05 · SITE` and
   a block cursor, with no name. Frame 3 (6.4 s): name and one line, then about 400 px of empty plate.
   The plate also hides the left third of the map, where home's lights sit. In demo the 1.75 s hold
   ends before the lines are in. At normal timing it costs the first second or two of each visit.
   Why it matters: a glance at that moment shows less than the overview would. Fix: show the trouble
   word at once with the plate, untyped. Type only the site name. Grow the plate with its lines, not
   at full height from the start. In demo, start typing during the last 0.5 s of the flight.

7. **Map labels show through and get cut by the plate.** Frame 2 crop: `PRINTI|R-3D`, `KITCHEN-L|IGHT`,
   `AUTOMATI|ON` are cut at the plate's edge. `ROOM · REPO`, `REPOS`, `DEMO-HOST` and `Add paged search
   to acme-api…` show through the plate as grey ghosts, inside the caption's own lines (frames 3 and
   10). Why it matters: ghost text next to the trouble line is noise exactly where I read. Fix: make
   the plate at least 95 % opaque, or hide Map labels whose box falls under the plate's rectangle
   (the Wall knows the rectangle and has `screenOf`).

8. **At site zoom, nothing points at the node the caption talks about.** Frame 2: the caption says
   `STORAGE`, and two red ■ are on screen (hv2 near the centre, storage to the right). The storage
   label is 16 px. Why it matters: the *where* half of north star 1. Fix: T7's lock. Put it on the
   worst node *inside* the site (storage), not only on the site node, and draw a thin leader line
   from the trouble line to it.

9. **The kicker uses its space for a number I do not need.** `TARGET 01 / 05 · SITE` is the same grey
   on a crit and on a calm site. Fix: on trouble sites, set the kicker in the status colour with the
   shape (`■ CRIT · SITE 01 / 05`). That gives one more cue that reads from far off.

## Across the variants

Only `radial` is built, so there is nothing to compare yet. What every other variant should take
from radial as it is now:
- The caption's trouble line, first, in status colour with its shape (frames 2, 3, 10). It is the
  only text on screen that answers "what". Each variant should keep it and make it bigger (#1).
- Trouble re-ordering between cycles (frame 10: hv1 jumps to `TARGET 01` once it turns crit).
- Calm nodes stay grey and plain, so red and yellow marks stand out in every zoomed frame.

Every variant should avoid radial's mistakes: same-size labels for sites and leaves, and even holds
on calm sites.

## Scores

score radial overview 3
score radial legibility 3
score radial status 5
score radial touch 2
score radial wow 5
score radial calm 5
score radial performance 6

Notes:
- Legibility is up from r9's 2 only because the caption name reads at 1.5 m. Nothing reads at 3 m.
- Status 5: colour and shape do their job, and the caption names the problem. But crit does not
  dominate, there is no fleet line, and calm sites take two thirds of the cycle.
- Touch is a guess: no input yet (night 2). Calm nodes are about 30 px (3 mm) wide, well under a
  fingertip.
- Performance is a guess. 12.9 fps and a 179 ms worst gap measure SwiftShader plus screenshots
  (PROGRESS filming note), not the page. The T4 round measured script at 6.7 ms per frame.

## console.txt

- `$RUN_DIR/shots/r13-caption/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r11-radial/console.txt` (previous radial film, for reference): empty (0 lines).
