# Q10: camera paths in a 3D map (round 13, researcher, web read 2026-10-26)

**Thin on the discomfort question: no source gives a "safe degrees per second" number for a slow drift.**
The path half is better covered.

## Answer (short)

1. The standard for long hops is van Wijk & Nuij's "smooth and efficient zooming and panning": for a
   far hop the cheapest path **zooms out, pans, zooms in**, not a straight line. Our `flightPose` (a
   sine lift of 18 % of the hop, capped at 900) is a cheap stand-in for exactly that.
2. Obstacle avoidance in games and research (roadmaps, occlusion maps) is heavy machinery for moving
   occluders. Our obstacles are static and few (the sun, clusters): a segment-vs-sphere test and one
   pushed-out waypoint is enough (my design, no source).
3. Duration: UI guidance says large moves need longer time (250-500 ms is "large" for a screen
   element; a camera crossing a galaxy is far beyond that). Our 2250 ms is plausible; scale it with
   distance rather than fixing it.
4. Drift: unconfirmed. The only hard facts: vection research uses 5-60 deg/s as test speeds, and WCAG
   2.3.3 treats parallax/motion as optional. Our overview turn (39 deg in 45 s = 0.87 deg/s) is far
   below those test speeds; keep it there.

## What the builder needs

### The zoom-out-pan-zoom-in path (van Wijk & Nuij 2003, via Reach & North 2018)
- Model: a view is (u, w): u the world point at screen centre, w the world width on screen. Path cost is
  perceived optical flow; the optimum is smooth to second order (position and velocity continuous).
- Parameter rho trades zooming against panning; the user-preferred value was **1.42 (about sqrt 2)**. At
  rho = sqrt 2, w = 2 x altitude and the angle of view is 90 deg. (Confirmed in Reach & North's text.)
- Closed form (from my memory of the paper, **not re-read from the PDF**, which came back as binary):
  with d = |u1 - u0|, b_i = (w1² - w0² ± rho⁴d²) / (2 w_i rho² d), r_i = asinh(-b_i),
  S = (r1 - r0) / rho, w(s) = w0 cosh r0 / cosh(rho s + r0). Duration = S / V; the paper gives no
  fixed seconds, V is a speed you choose. Check the formulas against the paper before building.
- If d is ~0 (same spot, zoom only) the formula degenerates: use plain log-interpolation of w.
- Reach & North (hyperbolic model, arXiv 1801.09358): same idea as circular arcs, plus one- and
  two-pole smoothing so a **retarget mid-flight stays smooth**; their demos ran at 60 fps with a 1 Hz
  clipped first filter and alpha = 6 Hz. Relevant: the tour can change target while flying (T4's `go`
  restarts `from = pose`, which keeps position but jumps velocity to zero-then-ease: a visible hitch).

### Not passing through the sun or a cluster
Sources found (Oskam et al. 2009 "Visibility Transition Planning", Li & Cheng 2008) plan on a
precomputed roadmap and refine with occlusion maps: for moving avatars and occluders. Overkill here.
Cheap rule for static spheres (mine):
- For the hop A to B, find the closest approach of segment A-B to each obstacle centre; if closer than
  `radius + margin`, add a waypoint at the obstacle's centre pushed out along (closest point - centre)
  to `radius + margin` (if the segment passes through the centre, use the up vector).
- Fly a Catmull-Rom (three.js `CatmullRomCurve3`, centripetal) A - waypoint - B; ease along arc length,
  not along the parameter, or the speed pulses at the waypoint.
- Keep the look-at on its own straight (eased) line: only the position needs the detour. Check the look
  direction never swings through the sun's side more than the frame allows.
- Test: sample the path at 100 points, assert min distance to every obstacle > radius.

### Easing and duration
- Material guidance (m1.material.io motion): scale duration with distance and change; baseline ~300 ms,
  full-screen ~375 ms, over 400 ms "may feel too slow" (for UI elements, not a camera). SAP Fiori: large
  moves 250-500 ms; Figma: large movements done too fast are hard to follow and jarring.
- Use ease-in-out (slow start, slow end) for camera moves; both ends should have zero velocity when the
  tour holds, which is `ease` in layout.js.
- Rule I would try: `ms = clamp(1400 + 900 * log2(1 + dist / refDist), 1400, 3200)` so a hop to the
  neighbouring cluster is quick and a crossing is slower. Tune by film sheet; not from a source.
- Make the long-hop speed, not duration, bounded: peak speed = 1.5-2 x mean for ease-in-out.

### Slow drift and discomfort
- Vection (illusory self-motion) from large-field rotation is what causes visually induced sickness;
  studies use 5-60 deg/s (Springer 2014 study of circular vection at 5/15/30/45/60 deg/s; a 2018
  study at 60 deg/s found strong vection gave more velocity-storage activity). Nothing found says what
  is safe, only that stronger vection means more risk.
- The Wall is a wall screen watched, not worn: the field of view is small, and no one is moving. Still,
  keep every continuous camera motion **well under 1 deg/s of view rotation** (the current overview turn
  is 0.87 deg/s) and avoid a drift that rotates the whole field in one direction for minutes; prefer an
  oscillation (sway +-6 deg over ~60-90 s) that returns. A sway reads as depth through parallax
  without a net heading change. (My judgement, not a measured threshold.)
- Honour `prefers-reduced-motion` (WCAG 2.3.3, AAA): W3C names parallax and motion-triggered animation
  as examples to let users turn off; for the Wall: no drift, cuts or a short cross-fade instead of
  flights. Does the plan already say so? Check README before adding.

## What laneboard's Wall could take (concrete)
1. `flightPose`: replace the sine lift by a detour waypoint only when the straight hop passes within
   `sunRadius * 1.6` of the hub or a cluster; otherwise fly straight (less motion, more readable).
2. Add a pure `pathClear(a, b, obstacles)` and test it with sampled distances (testable in node).
3. On retarget mid-flight, start the new flight from the current pose **and current velocity**
   (or blend with a one-pole filter, tau ~ 250 ms) instead of from rest.
4. Scale `FLIGHT.ms` by hop length (above), keep the tour's `flyMs` as the cap.
5. Keep the held-system drift as a sway with a period of at least 60 s; a test asserts the maximum
   angular rate (deg/s) of `siteShot` over a minute stays under 1.
6. Reduced motion: no drift, no lift, cut with a 300 ms fade.

## Not confirmed
- The van Wijk & Nuij formulas above (from memory; the PDF was not readable by the fetch tool).
- Any numeric comfort threshold for slow rotation of a screen-filling scene.
- The duration formula (mine). The cinematography side (how film crews time a crane move) had no
  usable source in this round.

## Sources
- Reach & North, "Smooth, Efficient, and Interruptible Zooming and Panning", https://ar5iv.labs.arxiv.org/html/1801.09358 (2026-10-26)
- van Wijk & Nuij 2003, https://vanwijk.win.tue.nl/zoompan.pdf (2026-10-26; located, not readable)
- Oskam et al., Visibility Transition Planning, https://diglib.eg.org/items/7995924b-fa69-4263-9783-e2cfb1bb24b7 (2026-10-26, abstract only)
- Li & Cheng, Real-Time Camera Planning, https://www4.nccu.edu.tw/~tyli/pdf/sg2008.pdf (2026-10-26, abstract via search)
- Material motion, https://m1.material.io/motion/duration-easing.html ; SAP Fiori motion,
  https://www.sap.com/design-system/fiori-design-web/v1-120/foundations/visual/motion-design (2026-10-26, via search summaries)
- WCAG 2.3.3, https://w3c.github.io/wcag/understanding/animation-from-interactions (2026-10-26)
- Vection: https://link.springer.com/article/10.1007/s00221-014-4161-0 ; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6223881/ (2026-10-26, abstracts)
- camera-controls (smoothTime default 0.25 s), https://cdn.jsdelivr.net/npm/camera-controls@3.1.2/readme.md (2026-10-26)
