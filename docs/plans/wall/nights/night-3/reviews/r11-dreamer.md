# r11: dreamer

Night 3, round 11. What I watched:
- `galaxy`: film `r10-galaxy` (`galaxy.html?demo=1&quality=0`, made at T4's commit 198d096; no Wall commit since),
  stills `r10-t4-overview` and `r10-t4-hv2`.
- `fx`: a new film `r11-fx-beacon` (`?demo=1&quality=0&fx=beacon,comets,twinkle`, large demo). The r4 beacon film was
  made before T2-T4, so I refilmed it. `lanes` was not filmed again: the owner dropped it, and its scores come from r4's film.
- 3 m: frame 08 of `r11-fx-beacon` (the overview) shrunk to a quarter of its width, `r11-3m.png`.

I'm asking one question: would I still want this screen in my hallway after a year? The short answer is not yet.
Trouble now reads, but the galaxy around it is still a dark room with five labels in it.

## galaxy

1. **History is the loudest thing on screen.** In r10-galaxy frames 5-7 and 9 (34-61 s), `■ HV1 · VM-C`
   stays at full banner size and full red while its second line reads `CLEARED 6S AGO` ... `CLEARED 33S AGO`. Nothing
   on the page is wrong at that moment, but the frame shouts more than at any live warn (the `▲ REMOTE` banner in
   frame 1 is a third of that size). From the hallway I would see red, walk up, and read "cleared". After a month I
   would stop trusting red, and that is the worst thing a calm display can teach. Fix: once cleared, the banner
   drops at once to the fleet line's calm size, `--text-2`, keeps only a small red glyph, and says `HV1 · VM-C OK
   · WAS DOWN 6 MIN`. T30's "hold for a tour cycle" stays, but as a quiet memory. The red goes when the trouble goes.
   This is Later's r59-dreamer 7, and it now costs more than it did then.
2. **The overview is a constellation, not a galaxy.** In r10-t4-overview, r11 frames 1, 5, 8 and 12, and the 3 m still,
   T3's arm ribbon cannot be seen. What you see is a black oval vignette, a faint grey haze and five labelled dots
   joined by thin lines. Nothing says "spiral". The vignette's dark rings (concentric ellipses at the edges) are the
   strongest shape in the frame. This is the screen you see most often, every 10 s in every cycle. Fix: do what T3's own
   note suggested. Narrow the ribbon (half 170) and lay a second, tighter band at 8-10 % along the spine near each
   site only, so the arm reads where it carries data. Then lighten the vignette's banding (stretch the gradient
   or dither it), because it draws rings no one meant.
3. **Three headlines in the trouble frame, still.** r10-t4-hv2: `STORAGE` in the caption hero (~140 px), `STORAGE`
   as the planet label (~45 px, red) and `HV2 · STORAGE / POOL 97% FULL` in the banner (~75 px), all in the same red
   condensed caps. T4 stepped the banner down, but it still says exactly what the hero says, only one step smaller.
   The eye bounces between three reds. Fix: while a plate is up and the banner's subject is the plate's subject, the
   banner drops out (or shows the *next* problem, as T23 does when the subjects differ). Hide the held planet's own
   label while the hero names it (Later, r54-film-ui 9).
4. **A held calm system has no life, and two thirds of the frame is black.** r10-galaxy frames 3, 4, 10 and 11
   (CLOUD, HOME, HV2, HOME) and r11 frames 4, 7 and 10: the caption is a name and nothing else, the system sits
   squeezed into the right third, and nothing moves except a slow drift. Six seconds of dead air, three times per
   cycle. A Homeworld sensor view is never empty, because something always ticks. Fix: frame the system in the centre
   of what the plate leaves free (Later r54-film-ui 8). Then give the calm plate one or two quiet facts (`12 rooms ·
   3 working · last deploy 14m`) so a calm hold tells you that it is calm *and why*. Proposal 2 below makes it move.
5. **The beacon and the tether are the same red line.** In r11 frame 8 (overview), HV2 has two thin red lines:
   the beacon (up, short) and the tether to the banner (down, long, crossing empty sky and the HOME arm). At 3 m both
   are hairlines, and the tether is the longer one, so the beacon loses. Fix: T16 (no tether at the overview) first.
   After that, the beacon is the only vertical red thing at the overview, so give it T9's floor height.
6. **The banner's plate is a hard box.** In r11 frame 8 and r10-t4-overview, a darker rectangle with a visible
   top-left corner cuts into the galaxy behind `HV2 · STORAGE`. It is the only hard edge apart from the brackets, and
   it reads as a UI layer pasted on, not as type on space. Fix: feather it (Later, A4 T38 `mask-image`).
7. **The fleet line flips subject between legs.** In r11 frame 11 (69 s) the camera flies toward the red HV2 while
   the banner reads `HV1 · VM-C`. Frames 9-10 also went `HV2 · STORAGE` → `HV1 · VM-C` → back. The camera says one
   thing and the banner says another. Fix: as Later's r4-film-ui galaxy 3 says, hold the banner's subject for a
   whole cycle, newest crit first (r15-dreamer 4).
8. **The sun is a white dot with a word.** `DEMO-HOST` in every overview and in the flights' top edge (r11 frames 3
   and 6, where it also crowds the tag). The hub is the centre of everything, yet it has the least presence of any
   star. It is also where T5/T6's freshness will live, so it needs a body that can swell and go grey. Fix: covered
   by T6 (the corona). In the meantime, take the label off at the overview (Later r26-skeptic 4; the tag already
   names the hub).
9. **The best frame of the film is an accident.** r10-galaxy frame 12 (79.6 s): HV1 opening, a red nebula
   blooming under it, the lock brackets, the caption `■ VM-C / BUILDER-C NO CONTACT FOR 16S`, the sun at the top
   edge. That is the film-HUD frame. It happens because the camera caught the cluster mid-open on the way in. Fix: put
   the arrival on purpose. Hold the camera's last ~0.8 s at that mid-open angle, so every trouble arrival passes
   through this frame (with T15's typing at progress 0.9).

## fx-beacon

1. **It does not show at the overview, the one place it is for.** r11 frames 1, 5, 8 and 12: at most a ~60 px
   hairline above HV2, gone in the 3 m still. In the open system (frames 2, 9) it is a clear red pillar from STORAGE,
   but at that distance the caption already names the trouble. Fix: T9 as written (floor at 0.25 of frame height,
   white core, width with age).
2. **In flight it reads best of all.** In frame 11 (approaching HV2) the pillar stands up off the plane like a flare
   and points the way. Keep this. It is the one effect that already makes the trouble cluster a place.
3. **At the overview it competes with the tether** (galaxy 5). Until T16 lands, the beacon cannot be judged at 3 m.

## fx-comets, fx-twinkle

Nothing in twelve frames that I could tell apart from the plain galaxy. If the demo flowed during the film, it
could not be seen at this size. These are retired anyway (the owner asked for `activity` in their place); I score
them for the record.

## fx-lanes

Not filmed again; dropped by the owner. My scores repeat what r4's film showed: a faint pulse that does not read.

## Across the variants

- What `fx-beacon` does in flight (a vertical mark that rises off the plane) is what the folded trouble cluster
  at the overview should steal. The plane is flat and status is colour only, so one vertical stroke would carry
  trouble by shape for a colour-blind eye and from far away. (This is r4's across-2 idea; the film backs it.)
- The open HV2 system in r10-t4-hv2 (red nebula under the ring, stems, small landing rings, the bracketed red
  planet) is the richest object on the Wall. The calm systems should steal its *composition*: centred, large, with
  stems that make the depth read. They don't need its red.

## What would make it unforgettable

1. **Tide** (`fx=tide`)
   - What you would see: at the overview, each calm cluster's nebula breathes very slowly (one breath per ~8 s)
     with an amplitude set by how busy it is. A quiet site lies flat; a site running builds gently heaves; a site
     that has gone silent stops breathing entirely.
   - What it means: the activity per site (working sessions, running jobs, flow events per minute, from the model
     and `/ws` flows). It is `activity` seen from far away, and a frozen cluster beside breathing ones is a dead site
     you can spot from 3 m. Trouble keeps its own faster crit breath and stays louder: tide only scales the calm grey
     glow, ≤ 6 % luminance swing.
2. **Telemetry** (`fx=telemetry`)
   - What you would see: in a held system, a thin ring round each planet that draws itself in once on arrival,
     filled to cpu and mem in two arcs (`--text-3`, a hair wider for the higher one). Each crit or warn member's ring
     is in its status hue, and that ring alone keeps a slow tick turning.
   - What it means: the cpu/mem the caption already has for the site, per planet, on the planet. The calm hold
     (galaxy 4) gets something living that is real data, and touch (T11) gets a visual the detail sheet can grow from.
3. **Trail** (`fx=trail`)
   - What you would see: at the overview, a faint dotted arc on the plane between the systems the tour has visited
     this cycle. The current leg's arc is drawn as the camera flies it and fades after one cycle. A trouble leg's
     segment stays a hair warmer.
   - What it means: where the camera has been and why (trouble first, revisited after every two calm sites, T-pace).
     Someone glancing at the hallway screen mid-cycle sees that the tour is covering the fleet, not that a screensaver
     is idling. When touch hands back (T14), the trail shows the tour picking up where it left off.

## Scores

score galaxy overview 5
score galaxy legibility 6
score galaxy status 6
score galaxy touch 1
score galaxy wow 5
score galaxy calm 4
score galaxy performance 6
score fx-beacon wow 6
score fx-beacon calm 6
score fx-comets wow 2
score fx-comets calm 8
score fx-twinkle wow 2
score fx-twinkle calm 9
score fx-lanes wow 2
score fx-lanes calm 8

Notes: touch 1 because touch is not built (T7-T14 open), so there is no gesture film to score. Calm 4: the cleared
crit at full banner red (galaxy 1) and the banner's subject flips (galaxy 7) make the calm screen shout. Performance
is a guess: SwiftShader gives 1.6-1.7 fps on this VM, which measures the VM, not the page. The owner reports the
Surface runs well, and no script-ms measurement was made this round.

## 3 m check

`$RUN_DIR/shots/r11-3m.png` (r11 frame 08, overview, 684 px wide): **yes**. HV2 reads as red with its square glyph,
HV1 as amber with its triangle, and the banner `■ HV2 · STORAGE` is the largest thing on screen. All five site
names and the sun read. What does *not* read: the galaxy's shape (no arms), the beacon (gone), and the tether, which
looks like a crack in the screen rather than a pointer.

## console.txt

- `r10-galaxy/console.txt`: empty (0 lines).
- `r10-t4-hv2/console.txt`: empty (0 lines).
- `r10-t4-overview/console.txt`: empty (0 lines).
- `r11-fx-beacon/console.txt`: empty (0 lines).
