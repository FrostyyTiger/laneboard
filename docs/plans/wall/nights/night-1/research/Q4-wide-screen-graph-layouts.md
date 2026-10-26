# Q4 — Graph layouts for 100-150 nodes over 4-6 sites on a wide screen

## Answer

1. For 100-150 nodes, a **grouped force layout with fixed site anchors** (one `forceX`/`forceY` target per site, plus `forceCollide` sized to the label) is the dependable base. It is what most open-source tools do, it is a few lines in d3-force, and it is stable when seeded.
2. **Hairballs come from the links, not the nodes.** The fix is to draw few links: intra-site links short and faint, inter-site links bundled or shown only for trouble. Hierarchical edge bundling (Holten) does the bundling; beta around 0.8-0.85 is the usual default, lower values keep node-to-node reading.
3. Ops tools (Grafana node graph, Kiali) do not solve this by layout. They **cap, group, filter and rank** (Grafana: 200 visible nodes by default; Kiali: find/hide and ranking). The Wall should do the same: trouble first, the calm rest quiet.
4. Matrix views beat node-link past about 20 nodes for most tasks, except path finding. The Wall does not need paths on the wall, so draw very few links there and keep the full link view for touch.

## What the builder needs (numbers)

### d3-force (primary: d3 docs)
- `alpha` 1, `alphaMin` 0.001, `alphaDecay` about 0.0228 (300 ticks), `velocityDecay` 0.4. Static layout: `simulation.stop()` then `simulation.tick(300)`; for 150 nodes this is milliseconds, so compute once at load and on topology change, never every frame.
- `fx`/`fy` pin a node and zero its velocity each tick: usable for site hubs or for a node being tapped.
- Defaults I recall but the fetched page did not show (verify in code): `forceManyBody` strength -30, `forceCollide` strength 1 and radius 1, `forceX`/`forceY` strength 0.1.
- Grouping pattern from practitioners: per-group `forceX`/`forceY` targets (from a treemap or from fixed slots), strength scaled by group area, and `forceCollide` with radius a little larger than the node, strength 1. Seed `x`/`y` near the group target with a small random jitter; identical positions cause divide-by-zero in custom forces. Seeded starts also make the layout repeatable.

### Site slots for a wide screen (proposal, not from a source)
- Split the screen into slots by site weight (nodes per site), e.g. a treemap/squarified split of the 3:2 or 16:9 canvas, one rectangle per site. 4-6 sites fit as 2 rows by 2-3 columns. A rectangle uses the width where a circle (radial) wastes the corners.
- Inside each rectangle run the force layout, and add a clamp to the rectangle (a custom force or a clamp after each tick) so clusters never bleed into each other.
- Label height sets the collide radius: use the label's half-diagonal, not the dot, otherwise 3 m labels overlap (see Q3 for sizes).

### Cytoscape fCoSE (primary: README of the project)
- Options and defaults: `quality` "default" (also "draft", "proof"), `nodeRepulsion` 4500, `idealEdgeLength` 50, `nodeSeparation` 75; supports `fixedNodeConstraint` (pin to x,y), `relativePlacementConstraint` (left/right/top/bottom with gap), compound nodes (`nestingFactor` 0.1). Claims up to 2x the speed of CoSE. That is a library; laneboard adds no dependency, so this is a reference for what constraints matter (pinning and relative placement), not something to import.

### Hierarchical edge bundling (secondary: abstract, course notes, library docs; the paper PDF was too large to fetch)
- Idea: edges are splines bent along the tree path between endpoints (via the lowest common ancestor), so edges between the same two groups share a path. Here the tree is root → site → node.
- Bundling strength beta in [0,1]: 0 straight, 1 follows the hierarchy fully. Common defaults 0.8 (graph-tool) and 0.85 (the paper's figure, d3 tension). Lower beta shows node-to-node connections, higher shows implied connections between groups.
- Stated use: a standard tree layout plus bent adjacency edges; the radial layout is the common convention, not a requirement. The idea works on any layout where each node has a site and the sites have positions: control points are node → site anchor → other site anchor → node.
- Laneboard use: draw only inter-site links bundled, in one low-contrast colour; colour the one bundle that has trouble. A bundle of 20 links reads as one thick line, which is readable from 3 m; 20 separate lines are not.

### Node-link versus matrix (primary: Ghoniem, Fekete, Castagliola 2005, via abstracts)
- Matrices outperformed node-link on most tasks for graphs over 20 vertices, or dense ones; node-link won only for path finding. Test sizes were 20/50/100 nodes at densities 0.2/0.4/0.6. Implication: a site-by-site matrix (6x6 cells, colour = worst state) is a legitimate wall element for "which pair of sites has a problem".

### How ops tools cope
- **Grafana node graph**: layouts layered (default; "can be slow with more than 500 nodes"), force (for 500 or more), grid (nodes without edges, sortable by stat or border colour). Shows up to 200 nodes by default, hides the rest as clickable markers with a count of hidden neighbours.
- **Kiali**: graph types of increasing detail (service, app, workload), find/hide, ranking of nodes 1-100, boxes (grouping), pause and replay. The fetched page did not state layout algorithms; the search result said its code loads cose-bilkent, dagre, klay and cola (secondary, unconfirmed).
- **What holds up**: grouping boxes, hiding calm nodes, counts instead of nodes ("+12"), grid for overview, ranking by importance. **What turns to a hairball**: force layout with all links drawn at full strength, and layered layouts with many cross-group links.

## What the Wall could take, concretely

1. T11 (radial), T12 (orbits), T13 (islands): in each, give every link a class: `intra` (same site) or `inter`. Draw `intra` at low opacity and only for the site in focus or in trouble; draw `inter` as one bundle per site pair (beta 0.85), with width by link count and colour by worst state. This is the largest single gain against hairballs, independent of variant.
2. T13 (islands): the rectangle slots plus clamped force described above, collide radius from label size, seed from the node id hash so the picture does not jump between loads. Settle with `tick(300)` offline, then animate nodes into place for the camera tour.
3. All variants: a hard cap on drawn links (for example the worst 30 plus bundles) and a "+N" marker instead of drawing calm nodes' links, as Grafana does with hidden nodes.
4. Optional Wall element: a 4-6 site matrix strip showing the worst state per pair, which doubles as the legend for the bundles.
5. Keep the full per-node link view for the touch explorer (night 2), where one node's links are drawn on tap.

## Could not confirm

- Holten's paper itself (PDF over the fetch size limit): beta values come from secondary sources and library defaults.
- Kiali's layout algorithms and any layout size limits; d3-force force defaults beyond what the simulation page shows.
- Network Weathermap (fixed hand-placed node coordinates is my understanding; the manual host failed its certificate check, so unverified).
- No source gives a "safe" node or link count for hairball onset; the 20-vertex matrix threshold and Grafana's 200-node cap are the nearest numbers.
- Site-slot and clamp ideas are proposals, not sourced.

## Sources (read 2026-10-26)

- d3-force simulation docs, https://d3js.org/d3-force/simulation
- d3 in depth, force layout, https://www.d3indepth.com/force-layout/
- Grafana node graph docs, https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/
- Kiali topology docs, https://kiali.io/docs/features/topology/
- fCoSE (Cytoscape.js), https://github.com/iVis-at-Bilkent/cytoscape.js-fcose
- Holten, Hierarchical Edge Bundles, IEEE TVCG 12(5) 2006 (DOI 10.1109/TVCG.2006.147); read via search summaries of the abstract and https://www.cg.tuwien.ac.at/courses/InfoVis/HallOfFame/2007/Grasberger/ (course copy), graph-tool docs for `get_hierarchy_control_points` (https://graph-tool.skewed.de/static/docs/stable/autosummary/graph_tool.draw.get_hierarchy_control_points.html)
- Ghoniem, Fekete, Castagliola 2005, https://hal.archives-ouvertes.fr/hal-00343819
- Clustered force examples: https://gist.github.com/mbostock/1747543, https://gists.github.com/mbostock/7881887, https://itnext.io/d3-js-force-simulations-4-treemap-e5898bfb40ea
