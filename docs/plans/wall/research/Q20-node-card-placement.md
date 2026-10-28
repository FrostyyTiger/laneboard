# Q20: a node card that stays out of the way on a 3D view (read 2026-10-28)

**Answer in brief.**
1. Anchored popovers/popups are a *short, optional* surface. Apple's popover guidance (read through a summary, not the
   page text) says: never cover the thing that triggered it, one at a time, dismiss by tapping outside, small content.
   When room is short, adapt to a docked sheet. This matches the brief's "anchored, docks when tight".
2. Mapbox's popup shows the standard placement logic: with no fixed anchor it chooses one so the popup stays inside
   the container, preferring `bottom`; it takes a per-anchor `offset`; `closeOnClick` defaults on and `closeOnMove`
   defaults off (the card survives camera moves).
3. For following a moving anchor without jitter: position with `transform: translate()` (top/left at 0), and round the
   coordinates to the device pixel grid (`round(v*dpr)/dpr`). Fractional positions blur text. Floating UI updates per
   animation frame only when the anchor itself is animating, and says to use that sparingly (~1 ms per update).
4. To keep a card clear of the thing it describes while the camera moves, shift the camera's *look-at point* sideways by
   half the card width (an untested suggestion from the search tool, not a documented product behaviour).

## What the builder needs
- **Anchor placement.** Try the four sides in this order: away from the nearest screen edge first, then the opposite side. Choose the
  first side where the card rectangle plus an 16 px gap does not intersect the node's hit circle (24 px radius) and
  stays 16 px inside the viewport. If none fits, dock (below). Mapbox does the same in one rule: stay inside the container.
- **Dock rule.** If the card would cover more than ~35% of the viewport (the brief's number) or no side fits, show it as a
  side panel. Apple's iPhone behaviour (popover becomes a sheet) is the same move.
- **Following the anchor.** Project the node each frame only while the camera or the node moves; when the camera is
  at rest, update on resize only. Write the card's `transform` once per frame, rounded to device pixels. Smooth the
  *anchor* with a short low-pass (e.g. 80-120 ms time constant; our choice, not a sourced number) so a bobbing node
  does not shake the text, but draw the leader line to the raw node point, so it never detaches.
- **Don't fight the camera.** During a camera ease, freeze the card's side (no flipping mid-move) and let it flip
  only when the ease has stopped. Flip jumps are the usual jitter source. Hysteresis: flip only if the preferred side
  fails by more than 24 px.
- **Offscreen anchor.** If the node leaves the viewport, keep the card docked and show an edge arrow on the leader line
  (hide, don't clip). Floating UI has a `hide` middleware for "reference clipped"; we did not read its page.
- **Closing.** Per Apple and Mapbox: tap outside closes; the camera moving does *not* close it (`closeOnMove` false), the
  Wall's wake/idle timer (60 s in the brief) does. Esc and a 48 px "x" for mouse.

## What the Wall can take, concretely
1. `card.js`: a pure function `placeCard(anchor, hitR, cardSize, viewport) -> {side, x, y} | 'dock'`, tested without a
   browser. Cost: small. It is the part most likely to regress, so give it unit tests (corners, 1920x1080 and 1368x768).
2. Rounding and `transform` for the card and its leader: a few lines. Cost: small.
3. Camera framing with a card: the "look-at shift" is a guess; film it on `demo=1` before keeping it.
4. Not found: how Stellaris moves its selection panel against the camera (the existing brief covers its panels only),
   and how Google Earth or CAD viewers avoid covering the feature. Google Earth documents that the app picks the
   balloon position itself; nothing more.

## Not confirmed
- The Apple HIG page content could not be loaded (the fetch returned the page title only); points 1 above come from
  the tool's general-knowledge summary. Check the live page before quoting it.
- Floating UI's flip, hide and autoPlacement pages were not read.
- Cesium search results gave camera offset (`HeadingPitchRange`) but nothing about callouts or jitter.

## Sources
- Floating UI, autoUpdate (animationFrame, ~1 ms per update, cost when closed): https://floating-ui.com/docs/autoUpdate (2026-10-28)
- Floating UI, misc (roundByDPR, transform vs top/left, blur on fractional pixels): https://floating-ui.com/docs/misc (2026-10-28)
- Mapbox GL JS popup options (anchor, offset, closeOnClick, closeOnMove): https://docs.mapbox.com/mapbox-gl-js/api/markers/ (2026-10-28)
- Apple HIG, Popovers: https://developer.apple.com/design/human-interface-guidelines/popovers (page body not loaded; summary only)
- Cesium camera offset: https://community.cesium.com/t/flyto-zoom-level/4557 (search summary)
- Google Earth balloon placement: https://openforis.support/questions/2962/position-of-balloon-of-collect-earth (a forum answer)
- Stellaris panels: `research/stellaris-ui-brief.md` (not repeated).
