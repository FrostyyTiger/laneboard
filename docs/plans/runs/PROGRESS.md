# Runs: progress

Run `runs-n4` (night 4, 2026-10-21 16:43 to 2026-10-22 07:00). Scope: README §7 "Night 4": the
review fixes of PRs #10-#12 first (item 1), then the Night look (item 2). Nights 1-3 are in
`nights/n1/` to `nights/n3/` (research Q1-Q12 answered there; new questions start at Q13). Night 3's
open tasks T46-T63 are quoted from `nights/n3/PROGRESS.md` as "n3 T<n>"; tonight's numbering starts
again at T1.

Planner notes (round 1), from reading the code:
- The list holds 12 tasks (the planner's cap). Night 4 items 3-9 (taste calls, n3 T13 phone bar,
  Morning run needs, artifact `state`, the loop's new fields, CLI and docs, n3 T46-T63) are not
  tasks yet: see For the owner.
- The one red test after the last round is `test/scripts.test.mjs` "runScript end to end" line 407:
  since the owner's `sleep 1` in `windowScript` (commit 8fa6d1e, fenced `server/review/scripts.mjs`)
  the run window lives a second longer, so the second `runScript` finds it still running
  (`alreadyRunning` true). The fix is in the test (wait for `#{pane_dead}` before the rerun), never
  in the fenced file. That is T1.
- `test/frontend.test.mjs` "split is byte-identical" passes here with full history; on the `ci`
  runner it is red. Likely a shallow checkout: `git log --diff-filter=A` then names a commit whose
  parent (`${commit}^`) is not there. `.github/*` is fenced, so the test skips with a reason when the
  parent is missing instead of asking for a deeper fetch.
- Every `[ui]` task is looked at before it is ticked: `node test/tools/demo-fleet.mjs --port 7795`
  and `node docs/plans/runs/loop/shoot.mjs --url http://127.0.0.1:7795 --out <RUN_DIR>/shots/T<n>
  --views <views> --themes dark,light --widths 1440,390`; read `console.txt` (a page error is a bug).
  Shots live in the run dir, never in the repo. `shoot.mjs` is fenced: run it, do not edit it.
  Night 3's design shots (the Night direction) are in night 3's run dir, the sibling `../runs-n3` of
  RUN_DIR, under `shots/r11-designer/night/`.
- Where things are: feeds route `server/routes/feeds.mjs` (`FEEDS_PATH`, `checkFeed`, `writeFeed`;
  tests `test/feeds-route.test.mjs`); Map merge `server/map.mjs` (`fromFeed` l.255, `feedMachines`
  l.545, `withDiscovered` l.576; tests `test/map-discover.test.mjs`, `test/map-drift.test.mjs`);
  Reach `server/map/reach.mjs`; runs protocol/fold `server/runs/protocol.mjs`, store
  `server/runs/store.mjs`, collector `server/collector/runs.mjs` (`test/runs-collector.test.mjs`),
  stuck `server/runs/stuck.mjs` (`deadlineRule`, `test/runs-stuck.test.mjs`), routes
  `server/routes/runs.mjs` (calls `server/db.mjs` `sessionsSeen` l.721; `MIGRATIONS` l.17); Inbox
  model `public/js/core/inbox-model.js` (`ackEvent`, `keyAction` gives `ref: r.needIndex` today),
  Runs view `public/js/views/runs.js` (`test/view-runs.test.mjs`); feeders
  `server/feeders/*.mjs`, CLI `bin/laneboard` (`laneboard feed … --out`, `test/cli-feed.test.mjs`);
  tokens `public/css/tokens.css` (277 lines), the Night override `docs/plans/runs/design/night.css`
  (45 lines, only custom properties `tokens.css` already defines), tests `test/tokens.test.mjs`,
  `test/design-directions.test.mjs`, `test/design-guardrails.test.mjs`.
- Fenced (never edit): `docs/plans/runs/loop/fenced.txt`; notably `server/boot/common.mjs`,
  `server/http.mjs`, `server/security.mjs`, `server/review/scripts.mjs`, `server/hub/*`,
  `public/js/core/{store,net,keys,actions}.js`, `test/hygiene.test.mjs`, `.github/*`. `feeds.mjs`,
  `map.mjs`, `db.mjs` and the runs files are not fenced.
- Fixtures use invented names only (`builder-a`, `hub`, `hv1`, `acme`, `*.example.invalid`,
  `192.0.2.x`); the hygiene gate rejects CGNAT addresses and tailnet DNS names: never spell them.

## Tasks

- [x] T1 (1h, 1i) Tests green here and on `ci`: in `test/scripts.test.mjs` "runScript end to end" wait until the `run-test` pane is dead (`#{pane_dead}`, a bounded poll like `waitPane`) before the second `runScript`, so `alreadyRunning` is false for the reason the test names, with no rerun that could hide lost lines (the n3 `paneAfterRun` is gone, keep it gone); in `test/frontend.test.mjs` "split is byte-identical" skip with a reason when `${commit}^` is not in the history (a shallow checkout) — done when: `node --test test/scripts.test.mjs test/frontend.test.mjs` passes 3 times in a row, and the split test run in a `git clone --depth 1` of the branch skips instead of failing (commit c4fa057, aa09cea)
- [x] T2 (1a) `POST /api/map/feeds` only from this machine: `server/routes/feeds.mjs` answers 403 unless `req.auth?.kind === 'local'` (a tailnet caller passes the other guards today); `docs/map.md` says the push is loopback only — done when: `test/feeds-route.test.mjs` gets 403 for `direct`, `hub` and `hub-pending` auth kinds (the kinds `server/security.mjs` / `server/http.mjs` set) and for no auth, 200 for `local`, and the 403 test fails before the fix (commit 1b1fb97)
- [x] T3 (1b) Machines with the same name in one source stay apart: in `server/map.mjs` `feedMachines` / `withDiscovered` key a discovered machine by its id inside its source (vmid for proxmox, node id for tailscale, container id for docker) and merge by name only across sources (and with declared nodes) — done when: a test in `test/map-discover.test.mjs` with two proxmox guests both named `web` on `hv1` and `hv2` gives two Map nodes, one tailscale node `web` still merges with one of them by name as today, and the two-guest case fails before the fix (commit 106c2aa)
- [x] T4 (1c) An offline tailnet device is idle "offline, last seen …", not a red stopped VM: `server/map.mjs` `fromFeed` (and `server/feeders/tailscale.mjs` if the status comes from there, per n2 Q5: `Online` false, `LastSeen` RFC 3339, may be absent) gives an offline peer the idle state with the detail `offline, last seen <time>` (or `offline` without `LastSeen`), while a stopped proxmox guest stays stopped — done when: a test on `fromFeed` / the tailscale `toFeed` with an offline peer gives the idle state, no `crit`/stopped tone and the detail text; the proxmox stopped case is unchanged (commit 24f187f)
- [x] T5 (1d) [ui] The UI acks a need by its `ts`, not its place: `public/js/core/inbox-model.js` `keyAction` and `ackEvent`, and the run page's ack in `public/js/views/runs.js`, send `ref: <need ts>` (the fold in `server/runs/protocol.mjs` already reads a ref ≥ 1e9 as a time); places shift when a later-read source holds older needs — done when: `test/inbox-model.test.mjs` builds two runs' needs where the later source holds an older need and the ack plan's `ref` is that need's `ts`; a fold test shows the ack closes the right need after the places shifted; a shot of `#/inbox` on the demo after `a` (dark, 1440) without page errors (commit 5eade81; the demo's runs are a read-only recording with no POST route, so the shot shows #/inbox and the run page before the ack, dark 1440, 0 page errors; the fold test covers the after state)
- [ ] T6 (1d) [ui] A `fence` need is closed only by an ack from the UI (`by: "inbox"`, or the run page's `by`) or the owner's CLI (`laneboard run ack`, its `by`), never by a loop's own `needs.ack` or a `wait`-style close (find in `server/runs/protocol.mjs` `foldRun` what closes needs today and name the allowed `by` values in `docs/runs.md`); the run page in `public/js/views/runs.js` shows who acked a closed need (`acked by <by> <time>`) — done when: `test/runs-protocol.test.mjs` has a `fence` need that a `needs.ack` with `by: "loop"` leaves open and one with `by: "inbox"` closes; `test/view-runs.test.mjs` finds the `by` text on a closed need; `test/runs-docs.test.mjs` stays green; a shot of the demo run page (dark + light, 1440)
- [ ] T7 (1e) The run page does not block the server: an index on `events(session_id, ts)` added to `MIGRATIONS` in `server/db.mjs` (a new entry, never an edited old one), or `sessionsSeen` rewritten as one grouped query — done when: a test in `test/db-builder.test.mjs` (or a new `test/db-sessions-seen.test.mjs`) finds the index in `sqlite_master` after migrating (or `EXPLAIN QUERY PLAN` of the `sessionsSeen` query names it), and `sessionsSeen` returns the same rows as before on a fixture of several sessions
- [ ] T8 (1f) A run file that leaves discovery and comes back is not counted twice: `server/collector/runs.mjs` resets that source in the runs store (`server/runs/store.mjs`) before it reads a file it has no saved position for — done when: a test in `test/runs-collector.test.mjs` reads a file, drops it from discovery, brings it back and finds each round and each `usd` once (it fails before the fix)
- [ ] T9 (1g) The deadline stuck rule fires only once the deadline has passed with no `run.stop`: `server/runs/stuck.mjs` `deadlineRule` (and its header comment, `docs/config.md` / `docs/runs.md` where `deadlineMin` is explained; if `deadlineMin` no longer has a use, keep it accepted for one version and say so) — done when: `test/runs-stuck.test.mjs` has a run 10 minutes before its deadline (no fire), 1 minute after with no `run.stop` (fires), and after with a `run.stop` (no fire); `test/config-docs.test.mjs` stays green
- [ ] T10 (1h) The smaller review fixes: `reach.unresolved` leaves the server as a count only (`server/map/reach.mjs` / `server/map.mjs`, and the Map HUD reads the count); `laneboard feed --out` writes its file 0600; the docker feeder test asserts `Command`, `Mounts` and `NetworkSettings`/networks never reach the feed; one test through `boot()` that `POST /api/runs/events` without `x-laneboard`, and with a foreign `Origin`, is a 403 (in a test file, the boot files stay untouched) — done when: those four tests are in `test/map-reach.test.mjs`, `test/cli-feed.test.mjs` (stat mode `0o600`), `test/feeders-docker.test.mjs` and `test/runs-routes.test.mjs` (or `test/boot.test.mjs`), each green, and `/api/map` holds no selector text for unresolved Reach entries
- [ ] T11 (2) [ui] Night becomes `public/css/tokens.css` v2: fold `docs/plans/runs/design/night.css` into `tokens.css` (dark theme as it is; the light block too, to be lifted in T12), with a version line at the top, and write a short `docs/design.md` (the control-room rules of README §5, Night's type scale, rows, radius, surfaces, the colour rule of §7 Night 4 item 3: grey = news, amber ▲ = wants you, red ■ = broken, one accent, no blue or cyan in content) that the designer reviewer judges against — done when: `test/tokens.test.mjs`, `test/design-directions.test.mjs` and `test/design-guardrails.test.mjs` are green, a test checks that every custom property `night.css` sets has the same value in `tokens.css` and that `docs/design.md` exists and names the colour rule; shots before (from `HEAD~` or n3's `shots/r11-designer/night/`) and after of map, runs, board, inbox, morning (dark + light, 1440 + 390), no page error
- [ ] T12 (2) [ui] Night's light theme brought to the dark theme's finish: contrast of text on every surface step, the status tile colours and the Board cards in the light block of `public/css/tokens.css` (and the view sheets in `public/css/` only where a light rule is missing); written down in `docs/design.md` — done when: `test/tokens.test.mjs` checks 4.5:1 for body and dim text and 3:1 for tile marks on each light surface step, and fails on the old light values; light shots of board, inbox, runs, map, morning at 1440 and 390 next to the dark ones, no page error

## Research questions

- [x] Q13 (answered → research/Q13-light-theme-from-dark.md) How mature design systems build a light theme that matches a dark-first one (GitHub Primer's light/dark, Radix Colors' 12-step scales, IBM Carbon g10/g100, Grafana's light theme): surface steps, text and border contrast targets (WCAG 2.x vs APCA numbers), and how status colours (amber warning, red danger) are darkened for a light canvas; what reads worst when a dark design is inverted — for T12
- [x] Q14 (answered → research/Q14-status-colour-rules.md) How design systems write down a status colour rule and pair colour with shape (Carbon's status indicators, Primer's `attention`/`danger`/`severe`, Atlassian's semantic tokens, ISA-101 / high-performance HMI "grey unless abnormal"): the wording, the token names, and what they say about blue/cyan for information — for T11
- [x] Q15 (answered → research/Q15-sqlite-session-ts-index.md) SQLite indexes for "rows per session in a time window": does a composite index `(session_id, ts)` serve `WHERE ts BETWEEN ? AND ? GROUP BY session_id` or does `(ts, session_id)` win, what `EXPLAIN QUERY PLAN` prints for each (the SQLite query planner docs), and does Node 24's `node:sqlite` `DatabaseSync` run `CREATE INDEX IF NOT EXISTS` inside a migration transaction without caveats — for T7
- [x] Q16 (partly answered → research/Q16-tailscale-offline-last-seen.md; admin console and fleet tools unconfirmed) How Tailscale reports an offline device and when it was last seen across the CLI and admin console (`tailscale status --json` `Online`, `LastSeen`, `Active`, the zero-time value when absent; what the admin console calls "Last seen" and "Connected"), and how fleet tools (Tailscale's admin, Netdata, Uptime Kuma) show an offline but expected device without alarming — for T4

## For the owner

- **The night's list stops at T12 plus what triage adds.** The planner role caps a night at 12 tasks
  and the loop stops when none is open, so README §7 Night 4 items 3-9 are not tasks yet: the agreed
  taste calls (tiles, minimap on the Map only, Board cards, empty states, Inbox order, stop line,
  Map polish, 2 px focus ring), n3 T13 (the phone bar in `public/js/ui/sheet.js`, unfenced per §8 Q7),
  Morning run needs (§8 Q9), the artifact `state` (§8 Q10), the loop's new fields (`title`,
  `session`, `max`, `detail`, `wrapup`), the CLI and docs list of item 8 and n3 T46-T63 (T52
  `pause --all` first). If the run ends "done" early, a second planner round (or a longer cap)
  would turn them into tasks for the rest of the night.

- **Run page: the minimap covers the end of the artifacts row at 1440** (seen in round 9's T5 shot of
  `#/runs?run=acme-search`, dark). It was there before T5; a Map polish / taste task could take it.

## Reviews

## Morning
