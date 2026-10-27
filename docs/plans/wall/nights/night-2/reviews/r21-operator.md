# Review r21: the operator

Persona: operator, three metres away, glancing over while the coffee runs. The only question is: is anything
wrong, what, and where, within three seconds? Judged on `galaxy` at HEAD `af9c8f0` (T1-T9 built).

Material. All of it was made this round, because the newest filmstrip (`r20-galaxy`, 09:05) is older than T9's
commit (09:10):
- Filmstrip `$RUN_DIR/shots/r21-galaxy/sheet.png`: large demo, `galaxy.html?demo=1`, CPU 4x, SwiftShader.
  2.4 fps, worst gap 1344 ms.
- Stills at 1368 css px, 2x (the 12-inch 3:2 tablet): `r21-still-galaxy_html` (overview),
  `r21-still-galaxy_html_at_lab_open_1` (shows the HV1 system), `r21-still-galaxy_html_at_hv2_open_1`,
  `r21-still-galaxy_html_at_hv1_open_1`.
- 3 m still `$RUN_DIR/shots/r21-3m.png`: the overview at a quarter of its width (the top 684x450 of the image).

No `fx` is built yet (T12-T14 are open), so there are no `fx-` scores.

## galaxy

1. **When the camera holds a site in trouble, the thing in trouble is not on screen.** In the `?at=lab` still
   (it shows HV1), the caption says `▲ FEAT-SEARCH` in huge yellow letters. The HV1 star and feat-search are
   both under the caption plate. Only a yellow haze leaks past the plate's lower edge. I see no brackets, no
   planet and no leader. The things I *can* see, in full and named, are the calm planets on the right: proxy,
   db, dns, registry. Filmstrip frames 7 (33.1 s) and 11 (54.2 s, `■ VM-C` crit) show the same: a red or
   yellow glow behind the plate, and the crit planet not visible. On `?at=hv2` it works, because storage
   happens to sit in the open lower right: red sphere, red brackets, `■ storage`, a leader from the plate.
   Half of HV2's system is still under the plate.
   Why it matters: "where" is half of my question. The caption tells me what, and the picture should show me
   where. Right now the picture shows me where everything is fine.
   Fix (T18 is already open for the hidden lane, and the dreamer's r15 #1 says the same): the held shot aims
   at the centre of the free rect, which is the frame minus `hud.covers()`. It is sized so the open `reach`
   fits inside that rect. When the lock target is in trouble, the drift is limited so the target never
   enters a cover. Test: for every site, with `?at=<site>`, `screenOf(lockTarget)` lies outside every cover.

2. **A whole site is missing from the overview, and the screen does not say so.** The overview still and
   filmstrip frame 1 show REMOTE, HV2, DEMO-HOST, HV1 and HOME. CLOUD is under the far fleet banner, the
   same as in r14 and r15. At frame 10 (48.9 s) the drift happens to show it, squeezed against the banner.
   From across the room I count four systems. If CLOUD were the second problem, the overview would not
   show it at all.
   Fix: `overviewShot` fits every site's folded box into the frame minus `hud.covers()`, not into the whole
   frame. Test: at the overview every site label is placed (none hidden by a cover).

3. **At the overview, a warning looks louder than a crit.** In the overview still, HV1's yellow halo (warn
   or attention) is wider and brighter than HV2's red one (crit). It is also about as large as the grey sun's
   halo. The banner saves the glance, but in the scene itself the worst thing is not the loudest.
   Fix (part of T17): scale the nebula's size and brightness by severity, so crit is at least 1.5x warn in
   both. Keep the sun's halo below warn (T16).

4. **Trouble waits behind every calm site before it comes back.** The order is right: target 01 is the crit,
   02 is the attention site, then CLOUD, REMOTE and HOME (frames 2-5, then 7-9). But after that the tour
   holds three calm sites and the overview before it returns to trouble. At real speed that is about
   3 x 25 s + 20 s, so roughly 95 s of calm in every two-minute cycle. A glance during that window shows
   me REMOTE's printer, while HV2 is at 97 %.
   Fix: calm holds a third as long as trouble holds, and a trouble site is revisited between calm ones when
   more than one calm site is queued. `tour.js` is fenced, so this goes to the owner (a hold-time option to
   `createTour`), or the galaxy's camera gives calm legs a shorter hold through `focus`'s zoom argument.

5. **When the camera holds the banner's own subject, the banner and the caption say the same thing twice.**
   In the `?at=hv2` still, `■ STORAGE / POOL 97% FULL` is in the caption (top left) and `■ HV2 · STORAGE /
   POOL 97% FULL` is in the banner (bottom right). Both are huge red slabs. Together they cover about 40 % of
   the frame, and they cover the system's lower half (k8s-1, the lower bracket of storage).
   Fix: while the held lock target is the banner's subject, the banner steps down to the next problem
   (`▲ HV1 · FEAT-SEARCH`, with `+N MORE`) at the second line's size.

6. **During a flight, the screen says nothing about the scene.** Frame 12 (60.3 s) is black dust with only
   the banner. Frames 7 and 11 have the DEMO-HOST sun cut by the top edge, and its label is pushed against
   the frame. A glance at that moment tells me only what the banner says. That is fine, but the sun is the
   brightest thing in the frame.
   Fix: T16 (hub out of shot), plus an arc over the plane (Q10).

7. **Under the throttle, the caption arrives too late in a demo leg.** Frame 4 (18.1 s, REMOTE) shows only
   `TARGET 05 / 05 · SITE` and a block cursor. Frame 5 (23.5 s, HOME) shows no caption at all. Frame 7
   shows the trouble line before the name has finished typing. At `?demo=1` speed, a 4 s hold is half over
   before I can read where I am. At real speed this matters less.
   Fix: in demo legs, start the typing at flight midpoint, not on arrival.

8. **Planet names are too small at 3 m.** Mono lowercase at 15 px on the tablet (`k8s-2`, `apps-1`,
   `storage`) does not survive the distance. The caption carries the name, so this matters only for the
   *trouble* planet's own label. Fix: the lock target's label in trouble at the site step (35 px), caps.

## Across the variants

There is only one variant this night. From night 1 (`islands-tiles`): trouble drawn as a filled tile that
owns its area. The galaxy's nebula is a soft glow. A tile is easier to read from across the room, and the
glow is easier to miss.

## Rubric

score galaxy overview 6
score galaxy legibility 6
score galaxy status 6
score galaxy touch 2
score galaxy wow 7
score galaxy calm 6
score galaxy performance 6

Touch is not built (D4, night 3): 2 is my guess for "a finger can take over" today. Performance: 2.4 fps under
SwiftShader measures the VM. T9 measured 13.8 ms/frame of script including the software render. That is my
best guess for the tablet, and nothing in the strip stalled worse than 1.3 s.

## 3 m check

`$RUN_DIR/shots/r21-3m.png` (the overview at a quarter width): **yes for "something is wrong, what and
where", no for "every site".** `■ HV2 · STORAGE` reads at once, and `HV2` in red with `■` next to its red glow
places it. `▲ HV1` in yellow also reads. REMOTE, DEMO-HOST and HOME read. CLOUD is not there (under the
banner, finding 2), so I could not tell a fifth site exists. `+3 MORE` and the tag top right do not read at
this size.

## console.txt

- `r21-galaxy/console.txt`: empty (0 lines).
- `r21-still-galaxy_html/console.txt`: empty.
- `r21-still-galaxy_html_at_lab_open_1/console.txt`: empty.
- `r21-still-galaxy_html_at_hv2_open_1/console.txt`: empty.
- `r21-still-galaxy_html_at_hv1_open_1/console.txt`: empty.
