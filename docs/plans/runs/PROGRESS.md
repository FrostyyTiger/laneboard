# Runs: progress

Run `runs-n2` (night 2, 2026-10-20 → 2026-10-21 07:00). Scope: README §7 "Night 2": the owner's
night-1 screenshot bugs first, then Map 2 (Part B): the `tailscale` and `proxmox` feeders with
`laneboard feed`, discovered + declared nodes merged by name (topology file optional), the Drift
overlay and the opt-in Reach overlay. Night 1 is in `nights/n1/` (its research Q1-Q4 is answered;
new questions start at Q5).

Notes for builders, from reading the code (planner, round 1):
- The Map server side is `server/map.mjs` (not fenced): `loadTopology`, `readFeeds` (one
  `<source>.json` per source in `config.map.feedsDir`), `fromFeed(node, feeds, now)` (a topology
  node's `feed: "source"`, `"source/<vmid|name>"`, `"source/<vmid|name>/<service>"`),
  `buildFleet(...)` (the model; the core is `topo.title ?? hostname`, with `hostname =
  config.hostname` = `os.hostname()`), `tick`/`tickFleet` (builder / hub). Map config is the
  `map` block in `server/config.mjs` (`file`, `feedsDir`, `feedStaleMs`, `probeEverySec`), env
  `LANEBOARD_MAP_FILE` / `LANEBOARD_MAP_FEEDS`; new keys go there and into `docs/config.md` and
  `docs/map.md`'s key table (`test/config-docs.test.mjs` checks the keys).
- The feed format is `docs/map.md` "The feed format": `{source, at (ms), every (s), host:{cpu,
  mem, disk, sub, detail, alerts}, guests:[{vmid, name, type, status, cpu, mem, maxmem, memFrac,
  uptime, alerts, services}], events}`. Feeders must write exactly that (plus new optional fields
  documented there, never a second format). Atomic write = temp name + rename.
- Feeders are a new provider kind in the `docs/providers.md` sense (a `none` that gives an empty
  feed and says so), but chosen per command (`laneboard feed <kind>`), not by a config key: put
  them in `server/feeders/{none,tailscale,proxmox}.mjs` with a small `TABLE` in
  `server/feeders/index.mjs`, each exporting a pure `toFeed(input, {source, now})` plus a
  `read(opts)` that gets the input (runs `tailscale status --json`, or fetches the PVE API) and
  returns `{ok:false, error}` instead of throwing. Document the interface in `docs/providers.md`.
- Fixtures under `test/fixtures/feeds/` use invented names only (`builder-a`, `hub`, `hv1`,
  `*.example.invalid`, tailnet `acme`, 100.64.0.x addresses). Never commit the VM's own
  `tailscale status`, hostnames or tokens. `test/hygiene.test.mjs` (fenced) must stay green.
- Client Map code is `public/js/views/map/` (`index.js` view, `render.js` canvas, `minimap.js`
  the pip on every other view, `overlays.js` the pure overlay table `OVERLAYS`/`nextOverlay`,
  `model.js`, `layout.js`). Tests: `test/map-*.test.mjs`, `test/map.test.mjs` (server).
  `public/js/core/store.js`, `net.js`, `keys.js`, `actions.js` are fenced.
- New routes go in a new module under `server/routes/` (see `server/routes/runs.mjs` for a POST
  with a body cap and local guards); `server/routes/v1.mjs`, `server/hub/*`, `server/security.mjs`
  and the boot files are fenced, so anything a hub must accept from another machine is an owner
  line, not a task.
- The demo is `node test/tools/demo-fleet.mjs` (a real hub, temp HOME, fake builders).
- Fixtures: the hygiene gate rejects CGNAT addresses and tailnet MagicDNS names (see
  `test/hygiene.test.mjs` STRUCTURAL; do not spell them out in docs either), so use
  `192.0.2.x` / `2001:db8::` documentation addresses and `acme.example.invalid` (T4 does).
  `server/feeders/index.mjs` `TABLE` has `none`, `tailscale` and `proxmox` (T5).
  `collect(kind, {source, now, every, ...readOpts})` is what T6's CLI should call. For
  `proxmox` the read options are `{url, tokenId, secretFile, ca, node, timeoutMs}` (secret
  from the file or `LANEBOARD_PVE_SECRET`, never a flag); T6 needs flags for those.
- T6 done: `laneboard feed` exists (`bin/laneboard` `cmdFeed`). `--push <url>` POSTs the feed
  as the body to `<url>/api/map/feeds` with `content-type: application/json` and
  `x-laneboard: 1`, and prints the server's `{error}` on a non-2xx: T7's route should answer
  that way. Reuse `SOURCE_ID` from `server/feeders/index.mjs` for T7's source check (the CLI
  already enforces it). `docs/map.md` "Pushing a feed" documents `--push` already.
- T7 done: `server/map.mjs` `feedProblem(feed)` is the one shape check (readFeeds skips a
  file that fails it, the route refuses the body). T8's discovered nodes can rely on `host`
  being an object and `guests` a list of objects when present.
- T8 done: `server/map.mjs` `withDiscovered(topology, feeds, {coreLabel})` runs inside
  `buildFleet`. Discovered nodes carry `discovered: true` (ids `feed:<source>` site,
  `feed:<source>/<vmid|name>` room); a declared node claimed by name gets its `feed` ref filled
  in, and `also` lists the other feeds naming the same machine. For T9: "undeclared" =
  `discovered: true`; "missing" = a declared node whose `fromFeed` says `<source> does not
  list <guest>` while that source is fresh. With no topology file there is no drift.
- T9 done: model nodes carry `drift: "missing" | "undeclared"` (`server/map.mjs`
  `driftOf`, `feedFresh`); tests are in `test/map-drift.test.mjs`, docs in `docs/map.md`
  "Drift". For T10: a `missing` node keeps its declared place and `status: "unknown"`
  (why `<source> does not list <guest>`); drift never changes status, so the overlay
  reads `node.drift` only.
- T10 done: `overlays.js` has `drift` last in `OVERLAYS`, `DRIFT_TEXT`/`DRIFT_MARK`,
  `driftText`, `driftCounts`; `nodeStyle` returns `mark: {tone, level, dash}` and the
  renderer strokes it as a ring at `r + 6`. For T12: `reach` goes after `drift` in
  `OVERLAYS` (fix the order test); its skip rule needs `nextOverlay` to take the model
  (or a list of available overlays), and `index.js` `setOverlay` is where `o` lands.
- T11 done: the model carries `reach` only with `map.policyFile` set:
  `{links: [{id: 'reach:<from>><to>', kind: 'reach', from, to, ports, label}], rules,
  unresolved: [{selector, why}], truncated?, error?}`. Reach links are NOT in `m.links`
  (so the current renderer never draws them); T12 reads `model.reach.links`, and the
  skip rule is "no `model.reach?.links?.length`". Identity = a node's `tag:` tags and
  `ips` from its feed + `also` refs (`nodeIdentities` in `server/map.mjs`); the core uses
  `withDiscovered`'s new `coreRefs`. `shapeKey` includes the reach links.
- T12 done: `reach` is last in `OVERLAYS`; `availableOverlays(model)` drops it without
  reach links, `nextOverlay(cur, dir, available)` skips what is not available, the Map
  API has `overlays()` and `overlay()` returns the overlay actually shown (a stored
  `reach` reads `status` until links arrive). `reachScope(links, focus)` is one hop.
  `normalize()` now keeps `reach: {links}` (or null). No screenshot was taken.
- After T12, if time is left (README §7 item 6, not planned as tasks yet): B2 **Find** reaching
  discovered nodes, services and ports in `⌘K` (`public/js/ui/palette.js`), and A3 a run as a
  Map node with a progress ring. A triage round may add them as tasks.

## Tasks

- [x] T1 (bug) [ui] Leaving the Map throws `IndexSizeError: … arc … radius … is negative` and every view then shows the red UI ERROR banner: find the `arc()` that gets a negative radius once the Map section is hidden (canvas or scene measured at 0 size: `public/js/views/map/render.js`, `minimap.js`'s `dot`/`ringsOf`/`pipTransform`) and clamp it at the source (no draw while the size is 0, radii `Math.max(0, …)`) — done when: a test in `test/map-render.test.mjs` or a new `test/map-minimap.test.mjs` (fake 2d context whose `arc` throws on a negative radius, like the browser) draws a scene with a zero-size/hidden canvas and a view switch without throwing, and fails before the fix (commit 6f96b91)
- [x] T2 (bug) [ui] The minimap stays light in the dark theme: `minimap.js` caches `readPalette(canvas)` and only drops it on `lb:theme`; make it read the theme's tokens when it starts and whenever the theme changes (check how the theme toggle and the `prefers-color-scheme` change actually announce themselves, and that the pip reads `--bg`/`--line` from the right element) — done when: a test with a fake `getComputedStyle` switching from light to dark tokens shows the next draw uses the dark `bg`, and fails before the fix (commit 1e1ab51)
- [x] T3 (bug) The demo fleet shows the machine's real hostname as the core node: `buildFleet` names the core `topo.title ?? config.hostname`; make `test/tools/demo-fleet.mjs` give the hub a demo name (`demo-host`, e.g. a temp topology file with `"title": "demo-host"` or a documented env override, whichever touches no fenced file) — done when: a test boots the demo's hub config (or calls the same helper) and `/api/map`'s core label is `demo-host` and never `os.hostname()`, and fails before the fix (commit a11d0c5)
- [x] T4 (B1) Feeder interface + `tailscale` feeder: `server/feeders/index.mjs` (`TABLE` none|tailscale|proxmox, `none` returns an empty feed with a note), `server/feeders/tailscale.mjs` `toFeed(status, {source, now})` mapping `tailscale status --json` (Self + Peer: host name, online/offline, OS, tags, last seen, IPs) into the feed format (peers as `guests` with `status` running/stopped, a `type: "tailnet"`, tags/OS/IPs in `detail`), and `read()` running `tailscale status --json` with a timeout (missing binary = `{ok:false}`); `docs/providers.md` gets a "FeedProvider" section — done when: `test/feeders-tailscale.test.mjs` maps `test/fixtures/feeds/tailscale-status.json` (invented names, per Q5) into the expected feed, an offline peer, a peer with no tags, and the `none` feeder; hygiene stays green (commit 9520a40)
- [x] T5 (B1) `proxmox` feeder `server/feeders/proxmox.mjs`: `toFeed(resources, {source, now})` from the PVE API (`/cluster/resources` or `/nodes/<n>/qemu|lxc` + node status, per Q6) into host + guests (vmid, name, type qemu|lxc, status, cpu, mem/maxmem with `memCache: true`, disk, uptime, `template: true` guests marked and kept out of trouble); `read({url, tokenId, secretFile, ca})` uses `node:https` with the read-only API token header, the secret read from a file or env (never a flag value, never logged), a self-signed CA file option, a timeout — done when: `test/feeders-proxmox.test.mjs` maps `test/fixtures/feeds/pve-*.json` (invented `hv1`, vmids 101-109) and checks the request a fake HTTPS server receives (path, `Authorization` header shape) and that a 401 / refused connection is `{ok:false}` (commit 33e85ab)
- [x] T6 (B1) CLI `laneboard feed <kind> [--source s] [--stdout | --out <file> | --push <url>]` in `bin/laneboard`: runs the feeder once, `--stdout` prints the feed (for the existing ssh forced-command pattern), `--out` writes it atomically (temp + rename), `--push` POSTs it (T7's route); `none`/unknown kind and bad args exit 2 with one line; usage in the header comment and `laneboard --help`; `docs/map.md` "Pushing a feed" rewritten around `laneboard feed` (a systemd timer example next to the source) — done when: `test/cli-feed.test.mjs` (pattern of `test/cli-run.test.mjs`) runs `feed tailscale --stdout` and `--out` against a fake `tailscale` on PATH printing the fixture, and the bad-arg cases exit 2 (commit 5c0f8d6)
- [x] T7 (B1) `server/routes/feeds.mjs`: `POST /api/map/feeds` (body = one feed, cap 1 MiB → 413, `source` checked against a strict id pattern, shape checked with the same reader `readFeeds` uses, written atomically to `<feedsDir>/<source>.json`; normal local guards, so the CLI's `x-laneboard` header; refused with 409 when `feedsEnabled()` is false, i.e. a builder a hub watches) — done when: `test/feeds-route.test.mjs` passes (good feed lands and shows in `/api/map`, bad source 400, oversize 413, no header 403, feeds off 409); pushing to a hub from another machine is an owner line (fleet auth is fenced) (commit 77af5f6)
- [x] T8 (B1) Discovered and declared nodes merge by name (`server/map.mjs`): a feed's host and guests that no topology node claims (by `feed` ref, or by `label`/`id` equal to the guest or peer name, case-insensitive) become nodes of their own (`site` per feed source, `room` per guest, `discovered: true`), a declared node with the same name takes the feed's live data; with no topology file the Map is drawn from feeds alone (core named as today); one tailscale peer that is also a PVE guest is one node, not two — done when: `test/map.test.mjs` (or `test/map-discover.test.mjs`) builds a map from the T4/T5 fixtures with no topology, with a topology that declares some of them, and with both feeders naming the same machine; `docs/map.md` "Three inputs" says the file is optional (commit c1710c3)
- [x] T9 (B2) Drift, server side: when a topology file and at least one fresh feed exist, `buildFleet` marks `drift: "missing"` on a declared node whose feed source is fresh but does not list it, and `drift: "undeclared"` on a discovered (T8) node; nothing is marked without a topology file, and a stale feed marks nothing (no data is not drift); `expect: "stopped"` stays as today — done when: `test/map.test.mjs` covers missing, undeclared, no topology, stale feed, and the node counts in the model are unchanged (commit 6aec3f8)
- [x] T10 (B2) [ui] Drift overlay: `drift` added to `OVERLAYS` in `public/js/views/map/overlays.js` (missing = dashed ring at its declared place in warn, undeclared = accent ring, everything else dimmed), the readout and the inspector say "declared, not seen" / "seen, not declared"; `docs/map.md` overlay table gets the row — done when: `test/map-overlays.test.mjs` checks the styles for both kinds and `nextOverlay` order, `test/map-render.test.mjs` draws a fixture model with drift without throwing, design guardrails stay green (commit 4eb7203)
- [x] T11 (B2) Reach, server side, opt-in: config key `map.policyFile` (default `null` = none, env `LANEBOARD_MAP_POLICY`; in `server/config.mjs`, `docs/config.md`, `docs/map.md`), a small HuJSON reader `server/map/hujson.mjs` (comments, trailing commas; no dependency), and `server/map/reach.mjs` turning the policy's `grants` (and legacy `acls`) into `reach` links between Map nodes (resolving `tag:`, `group:`, `autogroup:`, `hosts` aliases, IPs and `*` per Q7; ports as the link label; unresolvable selectors counted, not guessed); laneboard only reads the named file, never fetches a policy — done when: `test/map-reach.test.mjs` parses `test/fixtures/feeds/policy.hujson` (invented tailnet `acme`) into the expected links, and with no `map.policyFile` the model has no `reach` link (commit adaa5da)
- [x] T12 (B2) [ui] Reach overlay: `reach` in `OVERLAYS`, `reach` links drawn as arcs only in that overlay (thin, direction shown, the selected node's reachable set highlighted: "if this is compromised, what can it touch?"), the overlay is skipped by `o` when the model has no reach links; `docs/map.md` overlay table gets the row — done when: `test/map-overlays.test.mjs` covers the arc style and the skip rule, `test/map-render.test.mjs` draws a model with reach links, design guardrails stay green (commit 98030dc)
- [ ] T13 (docs) Two honesty gaps from `reviews/12-stranger.md` (findings 3, 5): the README's test-copy section must say that sessions and directories are still read from the machine (`laneboard ls` lists the real ones; nothing is written), and `docs/map.md` "Pushing a feed" / the feeder section must say in one sentence that a feed holds real host names and addresses, so keep it out of bug reports and screenshots — done when: both sentences exist and `npm test` stays green (hygiene included)

## Research questions

- [x] Q5 → research/Q5-tailscale-status-json.md. The exact shape of `tailscale status --json` (current stable CLI): top-level fields (`Self`, `Peer` keyed by what, `MagicDNSSuffix`, `CurrentTailnet`, `User`), and per node `HostName`, `DNSName`, `OS`, `Online`, `Tags`, `LastSeen` (format, and its value for online peers), `TailscaleIPs`, `Active`, `ExitNode`, `KeyExpiry`, shared-in nodes; which fields are stable or documented, with links to the source (`ipn/ipnstate`) — for T4
- [x] Q6 → research/Q6-proxmox-api-inventory.md. The Proxmox VE API for a read-only inventory: `GET /api2/json/cluster/resources` fields per type (`node`, `qemu`, `lxc`, `storage`: `vmid`, `name`, `status`, `cpu`, `mem`, `maxmem`, `disk`, `maxdisk`, `uptime`, `template`, `node`, `tags`), the API-token header (`Authorization: PVEAPIToken=<user>@<realm>!<tokenid>=<secret>`), the least privilege role that can read it (`PVEAuditor`? privilege separation), and how a client should handle the default self-signed certificate — for T5
- [x] Q7 → research/Q7-tailscale-policy-file.md. Tailscale policy files: the `grants` syntax (`src`, `dst`, `ip`, `app`, `via`) and legacy `acls` (`action`, `src`, `dst` as `host:port`), how selectors resolve (`tag:`, `group:`, `autogroup:member|self|internet|tagged`, `hosts` aliases, IPs/CIDRs, `*`), `tests`/`sshTests` to ignore, and the HuJSON rules (comments, trailing commas, anything else) — for T11
- [x] Q8 → research/Q8-discovered-vs-declared-views.md. How comparable open-source tools present discovered vs declared infrastructure and reachability (NetBox topology views, Weave Scope, Cilium Hubble UI, Grafana node graph, Tailscale's admin machine list / visualizer if public): how drift, "seen but not declared" and "who can reach what" are drawn, what reads at a glance, what to avoid (hairballs, colour overload) — for T8, T10, T12

## For the owner

- **Pushing a feed to a hub from another machine needs fleet auth (fenced).** T7's
  `POST /api/map/feeds` is behind the normal local guards (loopback + `x-laneboard`), so
  `laneboard feed --push` reaches the board on the same machine only. Remote feeders keep the
  documented ssh forced-command pattern with `laneboard feed … --stdout`. A signed feed intake on
  the hub (`server/hub/*`, `server/routes/v1.mjs`) is your call.
- **Night 1's operator review (`nights/n1/reviews/39-operator.md`) is still untriaged.** Most of
  its findings are loop-side (fenced `run.sh`): `needs` for owner items, `task` on rounds, a
  "stopping" state. They are not on tonight's list (README §7 Night 2 is Map 2); say if any should
  jump the queue.
- Night 1's open owner items (design pick, Playwright, `HOOK_PATHS`, runs in `/api/v1`, `run.sh`
  ints/`session`/`cwd`, EADDRINUSE line, `sleep 1` in `windowScript`, taste calls, the stray
  `runs/demo.jsonl`) are in `nights/n1/PROGRESS.md` "Morning" and still wait for you.
- **Busy port looks like success (`reviews/12-stranger.md` findings 2, 6).** A second board on a
  taken port dies with `EADDRINUSE` / `AUDIT_LOCKED` in the log only, and `curl` then answers from
  the other board. The fix is in the boot files (fenced); same item as the EADDRINUSE line in
  night 1's Morning. A README sentence ("if the port is busy, the page you see is not yours")
  is yours to approve.
- **Map title and fleet block with no config (finding 4).** `/api/map` names the core after the
  builder id and shows a one-builder `fleet` entry although `fleet` is off. Is that intended, or
  should the title fall back to the hostname and the block be omitted? Taste call, not a task.

## Reviews

- `reviews/12-stranger.md`: 6 findings, 1 became a task (T13, merging 3 and 5); 1 covered by T7
  (`--push` 404 is the missing route), 2 and 6 are one cause and moved to the owner (fenced boot),
  4 moved to the owner (taste).

## Morning
