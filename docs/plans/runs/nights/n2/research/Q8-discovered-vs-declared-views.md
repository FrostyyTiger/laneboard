# Q8: how comparable tools draw discovered vs declared infrastructure and reachability

## Answer

- None of the tools read gives a first-class "declared vs discovered" diff view. NetBox draws only what is
  documented; Hubble and Scope draw only what is observed. Drift is left to the reader, or to separate tooling.
  This is a gap laneboard's drift overlay (T8/T10) can fill.
- The one drift-like pattern that exists is "absence is information": NetBox says an isolated device
  usually means undocumented cabling, and keeps unplaced racks in an "unplaced" panel instead of dropping them.
  Laneboard can do the same: list "seen but not declared" nodes in a side list, not only on the graph.
- Reachability is drawn as edges whose style carries the state (Hubble: a red edge for policy-denied, green
  otherwise, per a third-party guide, unconfirmed in official docs). Grafana styles edges by colour, thickness
  and dash. A dash and a thickness are readable without colour; use them for reach arcs (T12).
- Hairball control that tools actually ship: a node cap with "N hidden" markers that expand on click
  (Grafana, default 200 visible), scoping first (Hubble: pick one namespace; NetBox: pick a site), a grid mode
  with no edges (Grafana), and filters kept in the URL (NetBox).

## Details

**Grafana node graph** (official docs)
- Nodes are circles with two stats inside and two labels below; an optional ring shows proportions
  (`arc__*` fields summing to 1) or a single `color`. Edges carry thickness, colour (default `#999`), and
  `strokeDasharray` for dashed. Edge stats show on hover only.
- Layouts: layered (default, slow past ~500 nodes), force (large graphs), grid (nodes only, sortable by
  stat or arc colour; switching from a node menu is temporary).
- Default cap 200 visible nodes; the rest sit behind clickable markers with an approximate hidden count per
  edge; click expands around that node. The `highlighted` edge field is deprecated since 10.5 in favour of `color`.

**NetBox Visual Explorer** (NetBox Labs docs; the open-source `netbox-topology-views` plugin is separate)
- Views: WAN map, floorplan, rack elevations, power chain, cable topology, L2/L3 dependency, BGP, IPAM map,
  prefix heatmap. All show documented data only; data is fetched at load, so reload after edits.
- Isolated device = undocumented cabling, not a bug. Unplaced racks go to an "unplaced" panel. WAN map omits
  sites without coordinates. Views collapse into summaries (PDU/rack) as counts grow. Scope selector (site,
  location, rack) at the top of each view; filters live in the URL; a view's own filters can hide real objects
  (a trap: say when something is hidden).
- Colour: only WAN circuits by provider is documented.
- The plugin: connections come from cables entered in NetBox; filters by name, site, tag, device role; exports
  for draw.io or PNG; each release targets one NetBox version.

**Cilium Hubble UI**
- Official docs: pick a namespace first (top-left dropdown); the service map is scoped to it; edges are
  service dependencies between workloads, discovered from traffic; a flows table under the map lists recent
  flow events for the namespace. The README says discovery is automatic at L3/L4 and L7.
- Not confirmed from a primary source: the verdict colours and dropped-flow drawing (only a third-party blog
  says denied edges are red and allowed are green).

**Weave Scope**
- Apache-2.0, deprecated and unmaintained (README says so). Maps built from observed processes, containers,
  hosts; you move between those levels (a drill-down hierarchy rather than one flat graph). The README does not say how
  grouping, connections or hairballs are handled; I could not confirm from primary sources.
- Not worth copying code from; the idea of levels (host > container > process) maps to laneboard's
  machine > lane > session.

**Tailscale admin console / visualizer**
- I found no public documentation of a machines-page topology or an ACL visualizer. Only network flow logs
  (Premium/Enterprise, 30-day retention, metadata only) turned up, which is observed traffic and not drawn as a
  map. Not confirmed either way; not used.

## What laneboard could take

1. **T8/T10 drift:** keep a side list ("seen, not declared", "declared, not seen") beside the map; on the map,
   mark with shape or dash plus a small text tag, never colour alone. Say "N hidden by filter" when a filter
   hides nodes (the NetBox trap).
2. **T12 reach arcs:** thin, directed, dashed or solid by allowed/denied, only in the reach overlay; on select
   draw just the reachable set and fade everything else. No always-on edges: that is how Scope and Grafana
   graphs turn into hairballs.
3. **Scale:** cap visible nodes with an "N more" expander (Grafana pattern); scope by machine or site first
   (Hubble/NetBox pattern); a no-edges grid fallback.
4. **Colour:** at most one ring or status colour per node, with a non-colour cue. Grafana and NetBox both leave
   most colour meanings undocumented, which is the failure to avoid: document each colour in `docs/map.md`.
5. **Shareable state:** keep the overlay and filter state in the URL hash (NetBox does).

## Not confirmed

Hubble verdict colours (primary source), Scope's grouping and edge handling, anything about Tailscale's own
visualizer, and any NetBox built-in drift feature (NetBox Discovery or reconciliation tools were not read).
Screenshots were not seen; everything above is from text.

## Sources (read 2026-10-20)

- https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/node-graph/
- https://netboxlabs.com/docs/visual-explorer/
- https://github.com/netbox-community/netbox-topology-views (via search summary)
- https://pypi.org/project/netbox-topology-views (via search summary)
- https://docs.cilium.io/en/stable/observability/hubble/hubble-ui/
- https://github.com/cilium/hubble-ui
- https://github.com/weaveworks/scope
- https://oneuptime.com/blog/post/2026-03-13-cilium-hubble-ui/markdown (third party, red/green edges, unconfirmed)
- https://tailscale.com/kb/1219/network-flow-logs (via search summary)
