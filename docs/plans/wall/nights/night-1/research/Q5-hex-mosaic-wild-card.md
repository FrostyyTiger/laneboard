# Q5 — The wild card: a hex mosaic ("tile wall")

## Answer

1. Recommendation: **one hexagon per node in a honeycomb, one contiguous region per site** (a "grid map", the tile-grid technique from cartography, here with sites in place of countries). No force simulation, no overlap, exact and repeatable. It is neither radial, nor orbits, nor islands: the picture is a mosaic that fills the 3:2 or 16:9 screen edge to edge.
2. It suits the brief because **a tile's size is fixed, so its label is fixed**: size the hex from the Q3 label height and every one of 150 labels is legible at 3 m by construction. Force layouts cannot promise that.
3. Trouble first: inside a site, tiles are ordered by severity from the region's centre outward (worst at the centre), and a crit tile can "pop" (scale 1.0 → 1.25, drawn last). The camera tour zooms to a region, then to the worst tile.
4. Links are not drawn per node. Inter-site links are bundles between region centres (Q4), intra-site links not at all, or only for the tapped tile. This removes the hairball problem rather than managing it.
5. Cost: about a day. The algorithm is ~120 lines (region growth on a hex grid, below). Trade-off: no per-node link geometry on the wall, so topology is read from the bundles and the touch view.

## What the builder needs

### Hex geometry
- Source gives (Red Blob Games): hex count within N rings = `1 + 3N(N+1)`; axial distance = `(|dq| + |dq+dr| + |dr|)/2`; cube rounding to pick the hex under a pixel (round q, r, s, then reset the component with the largest rounding error to `-` the other two); ring and spiral iteration (start at centre, rings 1..N). The page's code blocks were not in the fetched text, so the following are from my own knowledge, to be checked by a test: pointy-top hex of circumradius `s` has width `√3·s`, row pitch `1.5·s`; axial to pixel `x = s·(√3·q + √3/2·r)`, `y = s·1.5·r`; neighbours `(±1,0) (0,±1) (+1,-1) (-1,+1)`.
- Tile size: pick `s` so the label fits. Proposal: label 2 lines (name, state), name at the Q3 step for 2-3 m; a tile needs about `1.8 × cap height × name length / 2`; for hostnames of 8-12 chars on a 1920x1080 screen expect `s` ≈ 50-60 px (tile width ≈ 90-105 px). Screen capacity: 1920x1080 at `s` = 55 gives about 20 columns × 14 rows ≈ 280 cells, so 150 nodes fill about half. Use the rest for site titles and a gap between regions (see below). On the 2736x1824 tablet the same layout is scaled by `devicePixelRatio`.
- Spare cells: one-cell gap between sites (leave cells empty) makes region borders obvious without drawn lines; draw each site title along the region's top edge in the site-name step from Q3.

### Region allocation algorithm (proposal; the tile-grid literature gives the idea, not this code)
Input: sites with node counts `n_i`; grid of `W×H` cells. Output: for each node a cell.
1. **Seeds.** Place site seed points in a squarified-treemap split of the screen (Q4 slots), seed = slot centre, snapped to the nearest cell.
2. **Capacity.** Each site needs `n_i` cells plus a small reserve (5-10 %) for growth, so a new node does not reshuffle the picture.
3. **Grow regions round-robin.** Maintain for each site a frontier priority queue keyed by (axial distance to its seed, then the cell's distance to the slot centre). Repeat: for each site still under capacity, pop the nearest free cell that is inside the screen and not adjacent to a cell of another site (this gap rule leaves the one-cell channel), claim it. Round-robin keeps regions compact and fair; a site whose frontier is empty takes the nearest free cell anywhere (rare).
4. **Order within a region.** Sort the site's nodes by severity (crit, attention, calm), ties by stable id hash. Assign the sorted list to the region's cells sorted by distance from the region centroid, so the worst tile is in the middle and calm ones on the rim. Trouble then sits where the eye lands first, and a growing outbreak extends outward.
5. **Stability.** Keep the cell assigned to each node id between updates; only new nodes take free cells; re-run only on topology change, with a 600-1000 ms slide of tiles to the new cells (Q1/Q2 budgets). The severity order of step 4 would shuffle tiles whenever state changes: so apply step 4 only at load and on the camera tour's "re-sort" beat, and otherwise colour tiles in place.
6. Complexity: `O(N log N)`; milliseconds for 150 nodes. Seed the tie-break by node-id hash so the same fleet gives the same picture.

### Drawing (canvas)
- Tile = hexagon path at 0.92 `s` (a gap lets the dark ground show: the "control-room" look). Calm: dark fill, 1 px rim in the site hue at low contrast. Attention: fill + steady rim. Crit: bright fill, shape marker (Q3 says never colour alone), slow pulse under the Q2 motion budget.
- Decorative film layer (Q1): faint scanning highlight crossing a region, a hex-outline ring around the tile under the camera; keep both below the readable-state contrast.
- Region halo: one soft polygon behind a site's cells in its status colour (worst state of the site) gives the "from three metres" site read before any label is read.

### Camera tour
Steps: whole mosaic (3-4 s), push to the worst site's region (scale ≈ screen height / region height, 1.2-1.5 s ease), settle on the worst tile (label grows to the 1.5 m step), pull back. Because tiles are a fixed grid, the camera maths is a bounding box of a cell set: no layout-dependent hacks.

## What laneboard's Wall could take, concretely (T14)

- `public/js/wall/variants/mosaic.js` (name after the idea): pure function `layoutMosaic(sites, nodes, {w, h, s, seed})` returns `{cells: Map(nodeId → {q, r, x, y}), regions: Map(siteId → {cells, centroid, bbox})}`; tests: every node gets a unique cell; cells of one site are connected; no two sites' cells adjacent (gap rule); same input gives same output; adding a node keeps the others' cells; 150 nodes lay out in under 20 ms.
- Reuse Q4's bundle drawing for inter-site links between region centroids.
- Possible hybrid for the owner's pick: mosaic for the wall, the touch explorer (night 2) opens a force-layout detail for one site.

## Why this and not the alternatives I looked at

- **Voronoi treemap** (Balzer and Deussen, 2005: weighted centroidal Voronoi diagrams for nested convex polygons, non-rectangular containers): organic look, but needs iterative weighted-Voronoi adaptation, which is slow and fiddly to tune, and the cells have variable size, which breaks the fixed-label guarantee. The abstracts do not give run times.
- **Plain treemap/circle packing**: variable cell size, same problem; islands (T13) is already close to it.
- **Metro map / octilinear schematic**: nice and film-like, but automatic octilinear layout is a hard optimisation problem, not a day's work.
- Grid maps in the literature (van Beusekom, Meulemans, Speckmann, Wood, GIScience 2023; Coherent grid maps, IEEE VIS 2020; Snake model 2024) assign regions to tiles by matching to geography or data similarity, including hierarchical grids. We have no geography, so our "spatial" input is the site slot, and the severity ordering is the "data" side of their hybrid idea. Only abstracts read.

## Could not confirm

- Any user study of hex mosaics for status monitoring; the choice is a design argument, not a measured one.
- Full text of the grid-map papers (only abstracts/summaries); the region-growth algorithm above is mine.
- Tile size and screen capacity numbers are arithmetic from my own assumptions (label length, `s` = 55 px), not from a source; check against Q3's table.
- Hex formulas other than the count, distance, rounding and ring/spiral rules are from my memory because the page's code blocks were stripped in the fetch.
- One search result page (a Wiley mirror behind a university proxy) was ignored.

## Sources (read 2026-10-26)

- Red Blob Games, Hexagonal Grids, https://www.redblobgames.com/grids/hexagons/
- van Beusekom, Meulemans, Speckmann, Wood, Data-Spatial Layouts for Grid Maps, GIScience 2023 (abstract), https://drops.dagstuhl.de/opus/volltexte/2023/18905/
- Coherent grid maps, IEEE VIS 2020 (honorable mention; via search summary), https://virtual.ieeevis.org/year/2020/paper_f-info-1166.html
- Wei et al., Generating grid maps via the snake model, arXiv 2406.18573 (search summary), https://arxiv.org/abs/2406.18573
- Balzer, Deussen, Voronoi Treemaps, InfoVis 2005 (search summaries only), https://graphics.uni-konstanz.de/publikationen/Balzer2005VoronoiTreemaps
- Related rounds: Q3 (label sizes), Q4 (bundling, site slots), Q1/Q2 (motion budgets) in this folder.
