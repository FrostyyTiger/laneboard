# Review r15: the dreamer

Persona: dreamer (title sequences, game interfaces). I ask what is **missing** for a screen I would pass
in the hallway every day for a year. Judged on `galaxy` at HEAD `2c4b605` (T1-T6 built).

Material, all made this round because the newest filmstrip (`r14-galaxy`, 08:31) was older than T6's
commit (08:34):
- Filmstrip `$RUN_DIR/shots/r15-galaxy/sheet.png` (large demo, `galaxy.html?demo=1`, CPU 4x, SwiftShader).
- Stills `$RUN_DIR/shots/r15-still-galaxy_html_` (overview), `r15-still-galaxy_html_at_hv1_open_1_`,
  `r15-still-galaxy_html_at_lab_open_1_` (both show the HV1 system), plus `r14-still2` (`?at=hv2`) for
  the open crit system.
- 3 m still `$RUN_DIR/shots/r15-3m.png`.

No `fx` is built yet (T12-T14 open), so there are no `fx-` scores.

## galaxy

1. **The held system hides under its own caption.** In the `?at=hv1` still the HV1 star sits *inside*
   the caption plate (a dark sphere at its right edge, about x 1000, y 650 of 2000). The attention planet
   (feat-search) is there too: only its yellow glow leaks past the plate. In `r14-still2` the HV2 star is
   cut in half by the plate edge. Filmstrip frames 2 (8.3 s) and 12 (59.4 s) are the same. The caption
   names the trouble, and the plate covers the thing it names. To me this is the worst gap. The camera
   frames the scene as if the HUD were not there. Film HUDs are composed together with the shot.
   Fix: `siteShot` aims the star at the centre of the free rect, which is the frame minus
   `hud.covers()` (right of the plate, above the far fleet block). Fit the distance so the open `reach`
   fits that rect, not the whole frame. This also covers the Later line on the system reaching past
   the bottom edge.

2. **A site is missing from the overview.** The overview still has REMOTE, HV2, DEMO-HOST, HV1 and
   HOME. CLOUD is not there at all: it sits under the far fleet block (known since T6, in Later). From
   the hallway I count four systems and cannot tell that a fifth exists. If CLOUD ever goes red, the red
   banner is the only thing that says so. Fix: offset `overviewShot`'s look-at to the sites' centroid and
   shift it up-left until no site's folded box meets `hud.covers()`. Test it: at the overview every site
   label is shown.

3. **Words and places are not tied together.** The far fleet line (`■ HV1 · VM-C`, huge, bottom right)
   and the clusters it names never touch. In the overview still I have to match "HV1" in the banner to
   "HV1" next to a red blob by reading both. A film HUD draws the line for me. T9's leader does this only
   for the caption. Fix: at the overview, a thin hairline in the status hue runs from the fleet line's
   shape to the named cluster. It is drawn in once per overview (about 600 ms, like the name typing in)
   and then stays still.

4. **For a year, the banner will be wallpaper.** `HV2 · STORAGE` is the loudest thing in all 12 frames
   (it changes to `HV1 · VM-C` at 48.7 s). §2.1 wants that. But the same red slab, at the same place
   and size, all day, will stop being seen within a week. Two crits also look identical at the
   overview (overview still: HV2 and HV1, the same red cloud and the same ■). I cannot tell which is
   older or worse. Fix (overlaps T17): rank the crits by age. The newest crit gets the full slab, and an
   older one drops to the second line. Proposal "beacon" below makes age visible in the scene.

5. **The galaxy has no pulse of its own.** Across 60 s the only motion is the camera. The hyperlanes
   are dead grey hairlines, the sun is a flat white disc, and the dust is evenly spread snow. The live
   flows in the demo (jobs, links) never reach the screen. It reads as a still scene filmed by a moving
   camera, not as a system that is working. Fix: build T12 (`lanes`) and T13 (`comets`) first. They
   are the cheapest way to show that the hub is working.

6. **The flight passes through the sun, and the best-looking frame says nothing.** Frame 7 (33.5 s):
   a white disc fills the top third and dust streams past. It is the most cinematic frame of the strip,
   and there is no trouble in it and no name I need. Fix: T16's hub-out-of-shot, plus the flight arc
   over the plane (Q10). Keep the streaming dust for flights that pass *beside* the sun.

7. **The arrival has no beat in 3D.** Frame 3 (13.4 s): CLOUD is held, and no caption has come in yet.
   Frame 4: the name types in. The scene itself does nothing when the camera arrives. There is no lock
   (T9), no settle and no unfold accent, so arrivals feel like stops, not landings. The owner loves
   "spelled out slowly". In 3D the planets could be spelled out too. Fix: the member labels fade in
   in orbit order, from the star outwards, timed with the caption's typing (same `TYPE_MS` step), so
   the words and the planets arrive as one gesture.

8. **The open system reads as a debug view.** In the `?at=hv1` still, 17 mono lowercase names
   (`ingress ●`, `metrics`, `logs`, `alerting`) hang beside the dots. The spokes all start at the hidden
   star and the stems end in tiny ellipses. Every name has the same weight, so nothing tells me where
   to look. Fix: rooms in the label face at the site step's lower half, services only as dots unless in
   trouble (T6 already allows this). Drop the spokes (r8 finding 8, Later).

9. **The arms do not read as arms.** In the overview still and at 3 m the dust is a grey ring or
   donut, not two spiral arms. The galaxy metaphor is lost, and with it the sense of "where" on the
   map. Fix: thin the dust between the arms to about 20 %, and add brightness along each arm's spine
   (a cheap density curve in `dustPoints`).

## Across the variants

Only `galaxy` exists this night. From night 1's `wall.html` the galaxy should take the caption plate
*as a composition element*. There the Map's view centre was shifted right of the plate, so the held
node never sat under it. Finding 1 is the 3D version of the same rule.

## Rubric

score galaxy overview 5
score galaxy legibility 6
score galaxy status 6
score galaxy touch 2
score galaxy wow 5
score galaxy calm 5
score galaxy performance 6

(Touch is not built: 2 is a guess. Performance is a guess: 2.2 fps under SwiftShader measures the VM.
Builders measured about 0.4 ms of page script plus 0.12 ms for labels per frame outside
`renderer.render`.)

## What would make it unforgettable

1. **What you would see:** above each crit cluster, a thin vertical pillar of light rises from the
   galactic plane, like Homeworld's sensor pings, and it grows slowly taller.
   **What it means:** the pillar's height is how long the crit has been open (log scale, capped). The
   oldest unsolved trouble is the tallest thing in the galaxy. At 3 m, "how long" reads without any
   text, and two crits are no longer twins (findings 2 and 4). Calm clusters get nothing.
   **fx:** `beacon`.
2. **What you would see:** when trouble clears, its cluster keeps a faint ring in the old status hue
   on the plane. The ring cools from red to amber to grey and is gone after about 30 min.
   **What it means:** recent history. In the morning you can see where something went wrong in the
   night even though it is green now. It stays quieter than any live trouble: a ring outline only,
   never filled, never pulsing, so §2.1 holds.
   **fx:** `afterglow`.
3. **What you would see:** once per tour cycle, at the overview only, a single faint sensor sweep
   (a thin line from the sun) turns once round the plane. Each cluster it crosses gives one soft
   ping, but only if new data came from that site since the last sweep.
   **What it means:** freshness. A site that has gone silent does not ping, and you see the gap. The
   sweep's angle is also the tour's clock. It is one camera-wide gesture instead of many heartbeats
   (calmer than Q8's `fx=pulse`, same meaning).
   **fx:** `sweep`.

## The 3 m check

`$RUN_DIR/shots/r15-3m.png` (overview at a quarter of its width): **half yes.** *Whether*: yes. Two red
clouds with red ■ and the red banner read at once, and the banner's `HV1 · VM-C` is readable.
*Where* and *names*: HV2, HV1, DEMO-HOST, REMOTE and HOME read. A big step from r8, which had no names.
But CLOUD is missing (finding 2), so one site of five is invisible. The two crits cannot be told apart
or ranked. The sub-line `BUILDER-C NO CONTACT FOR 37S` is at the limit, and `+5 MORE` and the top-right
tag do not read.

## Console

- `$RUN_DIR/shots/r15-galaxy/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r15-still-galaxy_html_/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r15-still-galaxy_html_at_hv1_open_1_/console.txt`: empty (0 lines).
- `$RUN_DIR/shots/r15-still-galaxy_html_at_lab_open_1_/console.txt`: empty (0 lines).
