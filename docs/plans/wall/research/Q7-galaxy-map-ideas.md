# Q7 IDEAS: galaxy maps in games, and what the Wall could borrow

## Answer in brief

- The games I could check show many systems by **one colour layer at a time** (EVE: security, kills, jumps,
  sovereignty), plus **lines** between systems (standings in three colours) and a **clutter switch** (Elite
  players turn off "system connectors" and "previous jumps" to read the map). Nothing moves on these maps
  unless it means something (a jump, a kill).
- Camera: Elite folds the system view (orrery) into the galaxy map by zooming into the selected node;
  Homeworld keeps the camera on a focal point (the selection) and orbits around it, and gives orientation
  with a reference plane the 3D space is bisected by.
- Best proposals for this Wall: `fx=heat` (halo size = recent activity), `fx=realm` (soft territory
  shell per site in its worst status colour), `fx=route` (the tour's next stop as a faint line).

## What I could and could not confirm

Confirmed from the pages read (all secondary, none from the studios' own design talks):
- EVE star map: colouring tiles by sovereignty with outlines per faction; three line colours for
  standings; the 2014 launch thread complained the map showed one statistic at a time (security, kills or
  jumps). Third-party maps (map.eveonline.it) show jumps, NPC kills and ship kills for the last hour and a
  heat map menu. Old information, may not match the current client.
- Elite Dangerous: players advise turning off "system connectors" and "previous jumps" for a cleaner map; a
  Frontier developer post says the orrery is integrated into the galaxy map, zooming into a selected node
  of the route moves into the orrery and zooming out returns seamlessly. There is no longer a "heat map"
  on planet maps, as it confused players.
- Homeworld: the camera focuses on the selected unit(s) and orbits round it; the Sensors Manager shows the
  whole map and every visible ship, added late in development; the playable area is a sphere bisected by a
  circular plane, and a vertical mothership and horizontal background galaxy were meant to help orientation.
- Stellaris: hyperlanes are the network ships must follow (dev diary 4); voids block movement (dev
  diary 92 was only seen in a search snippet).

Not confirmed: Stellaris map modes and borders (dev diary pages were blocked by a browser check), the
current EVE client's overlay options (EVE University wiki returned HTTP 530), Elite's galaxy map layers
from a primary source (Fandom returned HTTP 402), Homeworld's blip design, and anything on No Man's Sky's
galaxy map. A later round with working fetches should check the Stellaris wiki "Map modes" page and
Frontier's own galaxy map guide. No page tried to give me instructions.

## Proposals for this Wall

### 1. `fx=heat`: a halo whose size is recent activity (best)
- **See:** each planet or cluster has a soft additive halo; the more has happened lately, the wider it
  breathes out. Calm sites with nothing recent have no halo. It does not change colour (status colour stays
  the status colour); only size and a very slow swell.
- **Means:** the count of recent events for that place (finished or failed jobs, deploys, status changes in
  the last hour from the feed), a window like EVE's "last hour" jumps/kills. Nothing happening = nothing
  moves. Lets you see "busy" apart from "broken" from across the room.
- **Cost:** small (one sprite per object, scale from a pure function `heatOf(events, now)`; test it).
- **Inspired by:** EVE's kills/jumps-in-the-last-hour layers (third-party map.eveonline.it, EVE Killmap);
  Elite dropped its heat map for confusing players, so keep this to one meaning and one scale, with the
  caption saying what it is.

### 2. `fx=realm`: a soft territory shell per site
- **See:** each site (a group of nodes) gets a faint translucent boundary sphere or disc on the plane,
  tinted by the site's worst status. When one site goes crit, its whole region lights from the edge, so
  trouble is readable as an area at 3 m, before a single planet is legible.
- **Means:** a site's worst child status; the shell appears only when that is warn or crit (calm = no shell).
- **Cost:** a round (shape, sort order with additive sprites, and fold/open behaviour with T8).
- **Inspired by:** EVE sovereignty tiles with faction outlines; Stellaris-style borders (the latter not
  confirmed from a primary source).

### 3. `fx=route`: the tour's route as a faint line
- **See:** a thin dim line from the current system to the next one the tour will fly to, and a ghost of the
  last leg; the camera flight follows it, so the move is predictable instead of a surprise.
- **Means:** the tour order (trouble first), so you know what is shown next; it reuses lane geometry.
- **Cost:** small to a round (a line plus fade; depends on the camera path work, Q10).
- **Inspired by:** Elite's route plotter and "previous jumps" line (players treat it as clutter, so it
  must be faint and switchable); Elite's zoom from galaxy into system as the camera move to copy.

## Camera notes for the builder (all unconfirmed numbers; none given by the sources)
- Fly toward a selected node and zoom into it rather than cut (Elite orrery transition).
- Keep the focal point the thing being shown and orbit around it (Homeworld).
- Keep a visible reference plane so depth stays readable (Homeworld's bisecting plane); the Wall's plane
  already does this.

## Sources (read 2026-10-26)
- EVE University wiki, Star Map (via search summary; direct fetch failed): https://wiki.eveuniversity.org/Star_Map
- EVE forums archive, star map launch thread: https://forums-archive.eveonline.com/message/5270708/
- map.eveonline.it: https://forums.eveonline.com/t/map-eveonline-it-v0-5-new-feat-temperate-systems/467900
- EVE Killmap: https://forums.eveonline.com/t/introducing-eve-killmap-a-3d-spatial-killmail-visualization-tool/519675
- Elite Dangerous Steam discussions (clutter options, heat map removed): https://steamcommunity.com/app/359320/discussions/0/3112531165380486382
- Frontier forum developer post (orrery in galaxy map): https://forums.frontier.co.uk/goto/post?id=8577080
- Stellaris dev diary 4: https://www.moddb.com/games/stellaris/features/dev-diary-4-means-of-travel
- Stellaris dev diary 92 (snippet only): https://forum.paradoxplaza.com/forum/threads/stellaris-dev-diary-92-ftl-rework-and-galactic-terrain.1052958/
- Homeworld, Wikipedia: https://en.wikipedia.org/wiki/Homeworld
