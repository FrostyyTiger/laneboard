# Review r43: the stranger

Persona: someone who found laneboard on GitHub and wants the Wall on an old tablet in the hallway.
I read README.md and the docs it links first, and the plan and PROGRESS only after I had finished
(only to get this file's format right).

What I looked at (all in `$RUN_DIR/shots/`, none in the repo):
- `r43-galaxy/sheet.png`: `galaxy.html?demo=1`, 12 frames, 4x CPU, after the last Wall commit `f1ae228`
  (r42's film is from before that commit).
- `r43-fx-all/sheet.png`: `galaxy.html?demo=1&fx=lanes,comets,twinkle`. All three effects are on together,
  so I cannot tell them apart.
- `r43-still/custom-dark-1368.png`: `wall.html?variant=galaxy`, the URL a stranger guesses.
- `r43-still-park/custom-dark-1368.png`: `galaxy.html?at=home`, the only "stop the tour" I found.
- `r43-3m.png`: frame 07 of `r43-fx-all` (the overview) at a quarter of its width.
- Demo: `test/tools/demo-fleet.mjs --port 7795 --size large` (a hub with three builders).

## The stranger's path, stumbles worst first

1. **The README never says the Wall exists.** I hit this first. README.md has no "Wall", "galaxy",
   "kiosk" or "tablet". Its views table lists Map, Board, Inbox… and stops. I found the word only by
   grepping: `docs/map.md` line 262 says "a screen that paints them (the Wall, `docs/plans/wall/README.md` D3)".
   That sends a user into an internal build plan to learn what a user-facing page is. "Ambient: the Map
   on a wall or desk screen" in map.md is for developers (`createMap(el, { ambient: true })`). It never
   names `wall.html` or `galaxy.html`.
   Why it matters: I would have given up here. I only found the pages by `ls public/`.
   Fix: add a row to README's views table, "**Wall** `/galaxy.html` (or `/wall.html`): the Map for a
   screen across the room", and add a short `docs/wall.md` that README's Docs table links. It needs the
   URL, the URL flags, kiosk setup, feeding `glow`/`ring`, and stopping the tour.

2. **There are two Wall pages, and the obvious URL gives the wrong one with no warning.** Night 2's variant
   is "galaxy", so I tried `wall.html?variant=galaxy`. It loaded **radial** (`r43-still`). Nothing on the
   screen said it had fallen back, although `pickVariant` returns `asked` "so a page can say it fell back".
   The galaxy is a different file, `galaxy.html`, which nothing links.
   Fix: make `wall.html?variant=galaxy` go to `galaxy.html` (the same way `fallback.js` already goes the
   other way). Also show a small "unknown variant `x`, showing radial" line on the tag for a few seconds.

3. **`glow` and `ring` are documented, but the galaxy does not draw them.** The demo feed already carries
   `hall-light` glow `[255,196,137] 0.35`, `desk-light` 0.9, `living-light` purple `[140,120,255]` 0.6, and
   `printer-3d` ring 0.163 (`curl /api/map`). In `r43-still-park` (HOME, parked), every one of those planets
   is plain grey: there is no colour and no progress arc. `grep` finds no `glow`/`ring` reader in
   `public/js/wall/galaxy/`; only `wall.html` (`glow.js`) paints glow.
   Why it matters: "put my own lamps on it" was half my reason to want it. The docs say "a screen that
   paints them (the Wall)", and the Wall I would pick paints neither.
   Fix: in `scene.js`, tint a planet's own faint glow with `glow.rgb × level`. Keep it under trouble, so a
   lamp never looks like an alarm. Draw `ring.progress` as a thin grey arc round the planet, like the Map's
   run ring. Until then, map.md should say "wall.html paints them; galaxy.html does not yet".

4. **Pushing a feed to the demo hub: the documented endpoint answers 404.**
   `curl -X POST -H 'x-laneboard: 1' 127.0.0.1:7795/api/map/feeds -d '{"source":"hallway","host":{…}}'`
   returned `{"error":"not found","path":"/api/map/feeds"}`. `/api/fleet/map/feeds` is also 404, and so is
   the hub's local listener on 9314. map.md says I get 201, or 409 "push to the hub". On a hub there is no
   answer at all, and the hub is where map.md tells pushers to go ("Feeds move to the hub", via the ssh
   forced command).
   Fix: either serve `POST /api/map/feeds` on a hub, or have a hub answer a clear 405/409 that says "on a
   hub, feeds arrive through the ssh forced command (docs/map.md 'Pushing a feed')". Say the same in the
   API bullet.

5. **No way to stop the tour that a user can find.** `?at=<site>` parks the camera (`galaxy/main.js` line 109),
   and `?open=` sets how far the plate is open, but no doc mentions either. The parked view
   (`r43-still-park`) works. A tap does nothing: there is no pointer, touch or key handler anywhere in
   `public/js/wall/`, so "a finger can take over" is not there yet.
   Fix: document `?at=`. Make a tap on a site park there, and a tap on empty sky resume the tour, with a
   one-line hint on the tag ("tap a site to hold").

6. **Kiosk: nothing helps you make it the only thing on the tablet.** `galaxy.html` has no
   `<link rel="manifest">`. "Install app" on Android installs the app's manifest (`start_url: "/"`, the
   Board), not the Wall. There is no Screen Wake Lock (`grep wakeLock` finds nothing), so the hallway
   tablet goes to sleep after its timeout. There is also no fullscreen request. Only iOS gets
   `apple-mobile-web-app-capable`. install.md's "Add to Home Screen" section is about the phone and the
   Board.
   Fix: give the Wall its own small manifest (`start_url: "/galaxy.html"`, `display: "fullscreen"`,
   landscape), request `navigator.wakeLock` on load and again on `visibilitychange`, and add a "Kiosk"
   paragraph to the new doc (Android: Install app, plus screen pinning or Fully Kiosk; iOS: Add to Home
   Screen plus Guided Access).

7. **Auth for a hallway tablet is not explained.** README says it binds 127.0.0.1 and that whatever exposes
   it must authenticate. A tablet is another device, so I need the HTTPS-in-front setup from install.md, and
   that setup is written for a phone that can drive terminals. A read-only wall screen should not need the
   same rights. Fix: one sentence in the new doc on putting the Wall behind a read-only route, or saying
   that one is not possible yet.

## Galaxy: what I saw on screen, worst first

1. **The crit headline flips between red and yellow every few seconds.** In `r43-fx-all`, the fleet line reads
   red "HV1 · VM-C, builder-c no contact for 19s" (frames 2-3), then yellow "REMOTE · OFFICE-PRINTER"
   (frames 4-7), then red again "…for 16s" (frame 8), then yellow (frame 12). The contact counter restarts
   below 30 s each time. From three metres, the biggest red thing on the wall comes and goes. I cannot
   tell whether builder-c is down or fine. This may be the demo's builder-c flapping, but the Wall should
   not show a flapping link as two different worlds. Fix: hold a crit on the fleet line for at least one
   full tour after it clears, dimmed, with "cleared 12s ago".
2. **Words cover each other.** In `r43-still-park`, the clock "13:12" sits on top of the `thermostat` label
   and the `printer-3d` planet, and the parked system is pushed into the bottom-left corner while the top
   right is empty. In `r43-galaxy` frames 2 and 9 (also `r43-fx-all` frame 8), the "HOME" site label sits
   on the plate's top-left bracket, and "DEMO-HOST" touches the "LANEBOARD · DEMO-HOST LIVE" tag. In
   `r43-3m.png`, "HOME" sits right above the clock and reads as the clock's caption.
   Fix: add the clock block to `freeBox()` like the caption and fleet line (framing.js), and keep site
   labels out of the plate's and tag's boxes.
3. **Plates are cut off mid-row.** In `r43-galaxy` frame 3, CLOUD's plate shows "WHERE eu-1" and then a
   half-drawn "HOLDS" row under the bracket. In frame 2, "ACME-BILLING · task T2 failed in rounds…" is
   cut. In `r43-fx-all` frame 6, HOME's "HOLDS" row is half there. Either the plate is still typing when
   the camera leaves, or its box is too short. Fix: size the bracket to the full plate before typing starts,
   and do not leave the hold before the plate is complete.
4. **Typing cursors and half names in the stills.** "REMO▮" (`r43-fx-all` frame 2), "REMOTE▮"
   (`r43-galaxy` frame 10), a lone "▮" under "P95 LATENCY 1.8 S" (`r43-fx-all` frame 10). From the hallway,
   a glance can land on a half-written name. Fix: type faster (under 300 ms per line), or fade each line in
   whole.
5. **Empty frames between legs.** `r43-fx-all` frame 11 is black except for one line. `r43-galaxy` frame 6
   is just "HOME", small, at the top. `r43-fx-all` frame 12 has HV2 cut by the right edge. If someone glances
   at that moment, the wall tells them nothing except the fleet line. Fix: shorter fly-outs, or keep the
   overview on screen between holds.
6. **Overview is small.** In `r43-galaxy` frame 7 and `r43-fx-all` frame 7, five sites fill the middle third
   and the rest is dust. The trouble glow is readable, but there are no sizes or counts per site. The 2D
   radial (`r43-still`) shows every node name in the same width.
7. **Performance (a guess):** the film measures 1.0 fps (worst gap 39 s), and 1.1 fps with the effects
   (37 s), on SwiftShader under 4x throttle. r37 says this VM's software GL says nothing about a tablet's
   GPU, but a stranger's "old tablet" is exactly the weak-GPU case. I have no number for it.

### fx (lanes, comets, twinkle, all on in one film)
- With the three on together, I could not see any of them in the 12 stills. The one moving line in
  `r43-fx-all` frame 7 is T20's yellow tether from the fleet line, not a lane pulse. Calm was not hurt,
  and wow was not added. A film per effect with an event fired on a link would let a stranger judge each one.

## Across the variants (what to steal)
- From `wall.html` radial (`r43-still`): it paints `glow` and every name is legible at once. The galaxy
  should steal the glow painting.
- From the galaxy: the parked plate (`r43-still-park`: "STATUS ok · all 12 calm, WHERE hallway closet,
  HOLDS 9 rooms") is the friendliest thing I saw for a hallway. Radial should steal the plate for its hold.
- From the galaxy's fleet line: one big red worst thing with "+4 more" answers "is something wrong?" before
  anything else on the screen.

As the stranger, which one I would want on my wall: the **galaxy**. It is the one my partner would not ask
me to turn off, and the parked plate reads from the stairs. But only once it paints my lamps' `glow` and
stays awake; today radial is the only one that does what map.md promised.

## Rubric

score galaxy overview 5
score galaxy legibility 6
score galaxy status 6
score galaxy touch 1
score galaxy wow 8
score galaxy calm 5
score galaxy performance 4
score fx-lanes wow 3
score fx-lanes calm 8
score fx-comets wow 3
score fx-comets calm 8
score fx-twinkle wow 3
score fx-twinkle calm 8

(The fx scores are guesses: the three were on together, and none of them showed in the stills.)

## The 3 m check

`r43-3m.png` (`r43-fx-all` frame 07 at 342 px wide): **yes, mostly.** Three yellow glows and the yellow
fleet line "REMOTE · OFFICE-PRINTER · PAPER JAM, NEEDS A PERSON" say "something wants a person, over there".
The site names REMOTE, HV1, CLOUD, DEMO-HOST and HV2 are readable. HOME is readable, but it sits on the
clock and reads as its label. At this moment the red builder-c crit from frames 2 and 8 is missing, so the
quarter-size image says "warn" while the fleet has a crit a few seconds earlier and later. That is the flip
from galaxy finding 1.

## console.txt, every line

- `r43-galaxy/console.txt`: empty (0 lines).
- `r43-fx-all/console.txt`: empty (0 lines).
- `r43-still/console.txt`: empty (0 lines).
- `r43-still-park/console.txt`: empty (0 lines).
