# Q19: moons and nested selection in space maps (read 2026-10-28)

**Answer in brief.**
1. The space maps we could read do not fan small bodies out on selection. They change *which level is shown*: the
   selected body sets a zoom sphere, and bodies outside it are hidden or reduced to orbit lines (SpaceEngine's zoom
   levels "Planet" / "Moons" / "System"). Moons are tappable because the camera has moved in until they are far apart.
2. Selection steps down with a "centre on it" action (double-click in SpaceEngine and KSP) and steps back up with a
   key or a button (KSP: Backspace returns to the active vessel; Tab cycles bodies outward from the sun). Nobody
   documents a touch gesture for either.
3. Label clutter is solved by importance weights and distance (Celestia), not by a picker. Its known weaknesses are
   crowding and flicker.
4. Hit radius against drawn size is **not documented** by any source we could reach. The Wall has to rely on its own
   touch research (Q6, Q12) and fix a minimum hit radius itself.

## What the builder can use
Numbers here are the Wall's own choices, because no source gives them. Check them on the real tablet.
- **Hit radius is decoupled from drawn size.** Keep the drawn moon as small as it needs to be, and give the hit
  target a floor of 24 px radius (48 px diameter, per the brief's touch rule). When two hit circles overlap, the nearer
  centre wins, and a tie goes to the worse status.
- **Spread rule.** Selecting a system asks the camera to frame it so that the smallest gap between sibling bodies is at
  least 48 px, or the framing stops at a minimum radius and the rest become a chip row (see C below).
- **Label budget.** At most N labels per selected system (suggest 6). Rank by status (crit > warn > ok), then by
  size, then by the selection. This copies Celestia's "importance weight, roughly constant label density". Hold a
  label for at least 1 s once shown, to avoid Celestia's flicker bug.
- **Step transitions.** Down: ease the camera 600-900 ms to the child (a guess, to be tuned in `film.mjs`). Up: the
  reverse, and the parent keeps its highlight so the way back is visible.

## Three proposals for laneboard (names are suggestions)
**A. `zoomsphere`: selection sets a render radius (small, one round).** Copy SpaceEngine's idea: the selected node
sets a radius around itself. Inside it, moons are drawn, labelled and tappable. Outside it, only the parent
and the siblings' dots remain. Tapping a planet frames "planet + its moons" (the "Moons" level). Tapping a moon
re-centres on the moon (double-tap in KSP/SpaceEngine terms; on a Wall one tap on an already-selected child is enough).
Back up: tap the parent crumb in the card or tap empty space once to go one level up, twice to reach the galaxy. Cost: small.

**B. `moonring`: a fan-out ring only when the spread rule cannot be met (a round).** If the camera cannot give 48 px
gaps (many moons, a wide parent), draw a temporary ring of hit chips around the selected planet at a fixed
screen radius, ordered by phase angle, each chip carrying the moon's status colour. Chips are screen-space, so they stay
48 px at any zoom. Nobody documents this pattern in the games searched, so it is our invention. Cost: a round.

**C. `crumb`: a breadcrumb strip for step up/down (small).** A strip "hv1 › web › nginx" with 48 px segments. Tapping a
segment steps up to that level (KSP's Backspace, Stellaris's "parent" in the card header). Also give a "+3"
overflow chip for moons beyond the label budget that opens the list in the card. Cost: small, shares work with Q20's card.

Best first: **A**, then C. B only if a real fleet shows sibling gaps below 48 px after A.

## Not confirmed
- The KSP wiki (Map View) and the Frontier forum were unreachable or thin. Everything about KSP comes from forum
  summaries (double-click focuses, Tab cycles, icons overlap and need a filter). Elite's system map: a forum thread
  says bodies could not be selected on the map itself and had to be picked from the list on the left, which is indented
  to show what orbits what. That is evidence that the *list beside the map* is the fallback, not a design to copy.
- Nothing found for Homeworld, EVE or Stellaris about moon-sized targets, and nothing about Universe Sandbox.
- No source gives hit radius versus drawn size.

## Sources
- SpaceEngine, "The map mode" (zoom levels, selection, double-click recentre): https://spaceengine.org/news/blog120220/ (2026-10-28)
- Celestia forum, importance weights and label density, minor moons, flicker bug: https://celestiaproject.space/forum/viewtopic.php?p=37845 and
  https://celestiaproject.space/forum/viewtopic.php?p=67987 (search summaries, 2026-10-28)
- KSP forum threads on map focus (double-click, Tab, Backspace): https://forum.kerbalspaceprogram.com/topic/146698-changing-focus-in-map-view
  and https://forum.kerbalspaceprogram.com/topic/161063-hitting-tab-to-change-targets-question (search summaries only, 2026-10-28)
- Frontier forum, system map selection and indented list: https://forums.frontier.co.uk/threads/system-map-help.132139/latest (search summary, 2026-10-28)
- The KSP wiki page https://wiki.kerbalspaceprogram.com/wiki/Map_View returned an access-denied page (bot check); not read.
