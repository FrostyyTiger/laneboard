# Runs: progress

Run `runs-n5` (night 5, 2026-10-21 21:32 to 2026-10-22 07:00). Scope: README §7 "Night 5": what
night 4 did not plan (its items 6-9) and the owner's calls on night 4's stranger ideas (§8 Q14).
Nights 1-4 are on `main` (#14); their notes are in `nights/n1/` to `nights/n4/` (research Q1-Q16
answered there; new questions start at Q17). Night 3's tasks are quoted as "n3 T<n>"; tonight's
numbering starts again at T1. The loop replans when the list runs out, so `## Later` is the queue
for the next planner round, in order.

Planner notes (round 1), from reading the code:
- Already done by night 4, so not planned again: n3 T47 (`eval` in `run round --help`, n4 T40),
  n3 T60 (`run` prints the file it wrote, n4 T21), n3 T62 (`<sub> --help`, n4 T33), n3 T63 (Morning
  lists run needs, n4 item 5), n3 T58 (the usage line now starts `laneboard run <sub> [--run <id>]`
  and says the flags may come before `<sub>`), and night 4 item 8's `ok <run> <type>` receipt
  (`bin/laneboard` l.1010/1016).
- n3 T52 (`pause --all` and the state dir): `bin/laneboard` `resolveStateDir` (l.719) already reads
  `$LANEBOARD_STATE_DIR` first. T11 proves it with a test and fixes the README sentence; if the test
  shows the bug is still there, fix it in `bin/laneboard` (`server/control/*` is fenced).
- Unknown `/api/*` paths: the fallback in fenced `server/http.mjs` (l.349-354) already serves the page
  only for non-API paths and answers JSON 404 otherwise. T8 adds the test through `boot()` and touches
  no fenced file; if the test shows a page for `/api/nope`, it goes under For the owner.
- Where things are: protocol `server/runs/protocol.mjs` (`SHAPES` l.153: `round.start` drops `title`,
  `run.stop` drops `detail` and `wrapup`, `artifact` has no `state`; fold `foldRun` l.287-385:
  `artifact` keeps the first line per URL, `run.cost.usd` sums `cost` events only), summary
  `server/runs/summary.mjs` (`maxRounds` l.33), routes `server/routes/runs.mjs`, Map runs
  `server/map/runs.mjs` and `public/js/views/map/overlays.js` (ring/label `n/maxRounds` l.302-320),
  Inbox `public/js/core/inbox-model.js`, Runs view `public/js/views/runs.js`, Morning
  `server/morning.mjs` (`build`, `WINDOWS` l.148 falls back to `tonight`) and its route in
  `server/boot/builder.mjs` l.80 (not fenced), CLI `bin/laneboard` (`RUN_FLAGS` l.840, `RUN_TYPE`
  l.849, `RUN_USAGE` l.853, morning text l.340-410, `money` l.174 prints 3 decimals under $1, the
  dispatch and `unknown command` l.1237 after the full usage), config `server/config.mjs`
  (`hostname` l.75/253). Tests: `test/runs-protocol.test.mjs`, `test/runs-routes.test.mjs`,
  `test/runs-docs.test.mjs`, `test/cli-run.test.mjs`, `test/cli-pause.test.mjs`,
  `test/inbox-model.test.mjs`, `test/view-runs.test.mjs`, `test/map-runs.test.mjs`,
  `test/morning.test.mjs`, `test/view-morning.test.mjs`.
- Every `[ui]` task is looked at before it is ticked: `node test/tools/demo-fleet.mjs --port 7795`
  and `node docs/plans/runs/loop/shoot.mjs --url http://127.0.0.1:7795 --out <RUN_DIR>/shots/T<n>
  --views <views> --themes dark,light --widths 1440,390`; read `console.txt` (a page error is a bug).
  Shots live in the run dir, never in the repo. `shoot.mjs` is fenced: run it, do not edit it. The
  designer judges against `docs/design.md`.
- Fenced (never edit): `docs/plans/runs/loop/fenced.txt`; notably `server/http.mjs`,
  `server/boot/common.mjs`, `server/boot/hub.mjs`, `server/control/*`, `server/hub/*`,
  `public/js/core/{store,net,keys,actions}.js`, `test/hygiene.test.mjs`, `.github/*`. The runs
  files, `bin/laneboard`, `server/boot/builder.mjs`, `server/morning.mjs` and `server/config.mjs` are not.
- Fixtures use invented names only (`builder-a`, `hub`, `acme`, `*.example.invalid`, `192.0.2.x`).

## Tasks

- [ ] T1 (1) An `artifact` carries an optional `state` (`open`, `merged`, `closed`; anything else is dropped to null): `server/runs/protocol.mjs` `SHAPES.artifact` reads it, and in `foldRun` a later `artifact` line with the same URL updates `state` and a non-empty `title` instead of being ignored (the place in the list stays); `laneboard run artifact --state s` (`RUN_FLAGS` in `bin/laneboard`, the usage line); `docs/runs.md` documents the field and the update rule — done when: `test/runs-protocol.test.mjs` folds an open PR then the same URL `merged` and finds one artifact with `state: 'merged'` and the later title, a bad state gives null; `test/cli-run.test.mjs` writes `--state merged`; `test/runs-docs.test.mjs` finds `state` in the artifact section
- [ ] T2 (1) [ui] A merged or closed PR leaves the Inbox at once, and the run page shows each PR's title and state: `public/js/core/inbox-model.js` drops a run PR whose `state` is `merged` or `closed` and keeps the 24 h rule only for artifacts with no state; `public/js/views/runs.js` artifact rows print the title (the URL as fallback) and the state as a muted word — done when: `test/inbox-model.test.mjs` has an open PR in REVIEW, the same PR merged gone, a stateless PR still under the 24 h rule; `test/view-runs.test.mjs` finds the title and `merged`; shots of inbox and the run page (dark + light, 1440 + 390), console clean
- [ ] T3 (2) The protocol keeps the loop's fields: `title` on `round.start` (per round), `detail` on `run.stop` (in `run.stop`, so `/api/runs/<id>` returns it), `wrapup: true` on `round.start` (the round is marked `wrapup`, and a wrap-up round after `run.stop` neither restarts the run nor counts in `rounds` against `maxRounds`); a round with no `usd` and no `cost` event keeps `usd: null` (never 0) — done when: `test/runs-protocol.test.mjs` folds a run with a titled round, a stop with `detail`, then a `wrapup` round, and finds the title, `stop.detail`, state `stopped`, the wrap-up round flagged and the counted rounds equal to the stop's; `test/runs-routes.test.mjs` sees `detail` in the JSON; `docs/runs.md` lists the three fields
- [ ] T4 (2) [ui] The run page shows them: the round title in the timeline (task id muted beside it), the round's `session` as a link to its session (the existing peek/transcript route; plain text when the session is unknown), `detail` on a line under the stop reason in the state label, wrap-up rounds read "wrap-up" and never "64 of 63", and an unknown round cost prints `—`, not `$0.00` (`public/js/views/runs.js`) — done when: `test/view-runs.test.mjs` renders a run with these fields and finds the title, the link, the detail, "wrap-up", no "64 of 63" and `—` for the unknown cost; run page shots (dark + light, 1440 + 390), console clean
- [ ] T5 (2, n3 T48 part) [ui] The `tasks` score's `max` drives "44 of 63" and the ring, and a moved max shows: `server/runs/summary.mjs` gives the latest `tasks` value and max (and the first max), the Runs list and the run page print `44 of 63` (and `scope 12 → 63` muted when the max moved, operator r64 gap 5), `server/map/runs.mjs` / `public/js/views/map/overlays.js` draw the ring from tasks when a max exists and print the number the ring draws, after the name — done when: tests in `test/runs-protocol.test.mjs` or a summary test, `test/view-runs.test.mjs` and `test/map-runs.test.mjs` check "44 of 63", the scope line and the ring fraction; shots of runs and map (dark + light, 1440 + 390)
- [ ] T6 (3, n3 T46) The run's cost adds up: `laneboard run cost --usd x [--n N]` posts/writes a `cost` event (`RUN_FLAGS`, `RUN_TYPE`, the usage, and a "round only" hint on `round --end --usd`); in `foldRun`, when a run has no `cost` events its `cost.usd` is the sum of the rounds' `round.end` `usd` (null when none has one); `laneboard run … --post` prints what the server accepted (the folded `t` and `run` from the 201 body, plus any field it dropped) — done when: `test/cli-run.test.mjs` writes a `cost` line and checks the help has `cost` and the hint; `test/runs-protocol.test.mjs` sums two `round.end` `usd` values with no `cost` events and gets null with none; a `--post` test against a test server prints the accepted line
- [ ] T7 (3, 5b) One name `maxRounds`: `run.start` accepts `maxRounds` (top level or in `budget`), `budget.rounds` stays as an alias for one version (said in `docs/runs.md` with the version); `docs/runs.md` gets the one line "`rounds` is rounds done, `maxRounds` the cap"; `GET /api/runs?run=<id>` returns only that run (empty list for an unknown id); a 404 on `/api/runs/<id>` says `no run <id>; the list is GET /api/runs` (`server/routes/runs.mjs`) — done when: `test/runs-protocol.test.mjs` folds both spellings to the same `maxRounds`; `test/runs-routes.test.mjs` filters by `?run=`, and reads the 404 text; `test/runs-docs.test.mjs` finds the line
- [ ] T8 (3, 5f) The API answers what a `curl` visitor guesses: `GET /api/health` (a small JSON `{ok, version, mode}`, read-only, in an unfenced route module registered from `server/boot/builder.mjs`), `/api/morning?window=bogus` a 400 naming the allowed windows (`server/boot/builder.mjs` l.80, `WINDOWS`), a test through `boot()` that `/api/nope` is a JSON 404 and `/nope` is the page; README gets a route table (view → `/api/*`, plus `/api/health`) — done when: a route test gets 200 JSON from `/api/health`, 400 from the bogus window, JSON 404 from `/api/nope`; `test/runs-docs.test.mjs` (or a README test) finds `/api/health` and the table header in README
- [ ] T9 (3, 5c, n3 T54, n3 T61) `laneboard morning` reads like the page: ISO dates in the header (`since 2026-10-21 18:00`) and the right word (`server/util.mjs` `windowLabel` always says `tonight` for that window: say `tonight` while the window's night is still running and `last night` once it is morning; one rule shared with the web Morning), money with 2 decimals (`$0.10`, `money` l.174, used by `ls`/`credit` too), the SESSIONS column as a count (`3 sessions`), and runs that stopped in the window listed under a Finished heading with their stop reason — done when: CLI tests on the morning text (a fake `/api/morning` body) find the ISO header, `$0.10`, `3 sessions`, no UUID, no line over 100 columns, and a stopped run under Finished
- [ ] T10 (3, 5e, n3 T59) Names come from config or the hostname only: with no config the Map title is the hostname and no fleet block shows, the branch still shows (find where an environment variable such as `LANEBOARD_RUN` reaches the title or the builder code today and remove that path); `docs/config.md` lists every environment variable the board reads; `laneboard run start` without `--run` keeps an inherited `LANEBOARD_RUN` and says so on stderr (`run id <x> from $LANEBOARD_RUN`), and with neither the error names `--run <id>` (said in the help and `docs/runs.md`) — done when: a config/map test with `LANEBOARD_CONFIG=/dev/null` and `LANEBOARD_RUN=run-x/3` in the env gets the hostname title; `test/cli-run.test.mjs` checks the stderr note and the error; a docs test finds the variable list
- [ ] T11 (4, n3 T52) `laneboard pause --all` / `resume --all` / `paused` stay in the isolated copy: a test with `LANEBOARD_STATE_DIR=<tmp>` and `HOME=<other tmp>` finds `paused/ALL` under the state dir and nothing under `HOME`; if it fails, fix `bin/laneboard` (`resolveStateDir`, never `server/control/*`); README's isolation paragraph names which commands write the real dir by design (`run` without `--post` writes `./.laneboard/`) — done when: the `test/cli-pause.test.mjs` case passes and the README sentence is there
- [ ] T12 (5a, 5d, 5g) Small CLI calls: an unknown command prints `unknown command: <x>` as the first line, then the help, exit 2 (`bin/laneboard` l.1237); `laneboard ls`, `morning` and `credit` print `board: <url>` on stderr (the URL that answered); `laneboard run needs "text"` takes a bare text as `--text` (a second bare word is still an error) — done when: CLI tests check the first line and exit code, the stderr `board:` line with `LANEBOARD_URL` set to a test server, and a bare-text need written to the file

## Research questions

- [x] Q17 → research/Q17-pr-state-mapping.md. What `gh pr view --json state,isDraft,mergedAt,closedAt,title,url` prints for an open, a draft, a merged and a closed PR (the exact `state` values and their case), and what GitHub's REST `pulls` API gives for the same (`state` open/closed plus `merged_at`): how should a loop map them onto the protocol's `open`/`merged`/`closed` — for T1
- [ ] Q18 How progress tools show a total that grows while work goes on (Jira and Linear burn-up "scope" lines, Linear's cycle scope change, GitHub Projects' progress, CI matrices that add jobs): what they draw and print when the denominator moves, and what reads as misleading — for T5
- [ ] Q19 How established CLIs answer an unknown command and say which server or context they talk to: `git` ("is not a git command", suggestions), `kubectl` (the context line, `--context`), `gh` (host), `docker context`, `npm`: exit codes, stdout vs stderr, one line or full help — for T12
- [ ] Q20 What a small read-only health endpoint conventionally returns (the IETF draft `application/health+json` "Health Check Response Format", Kubernetes `livez`/`readyz`, Spring Boot actuator `/health`): the minimal fields, status codes and what must not leak (versions, paths) on an endpoint a stranger can `curl` — for T8

## Later

- (3) README: the safe test-copy recipe first and shorter (r49 b), the "All five variables are needed" sentence rewritten so it does not read as a correction (r13 c, item 5h), and a sentence naming `docs/plans/runs/loop/shoot.mjs` for a headless look.
- (3) `laneboard run --help` and `docs/runs.md`: a goal should be a sentence, not a run name (operator r64 gap 3).
- (4, n3 T48 rest) [ui] Map run-node labels at 390: a run label never over another node's label or legend (drop the label, keep the ring), run labels in the lane style, a trouble node always labelled.
- (4, n3 T49) [ui] Find palette rows: no trailing `—`, one kind marker, the matched characters marked, meta on a second muted line at 390.
- (4, n3 T50) [ui] Runs list: a stuck run says `▲ STUCK` with the reason, no usage is one muted `—` (check what n4 T31 already did first).
- (4, n3 T51) [ui] Fly-to after Find at 390: the label clear of the selection brackets, the bottom sheet opens at peek with the node's inspector.
- (4, n3 T53) CLI dead-end errors: `launch` with no repo names `--repo`/`repos`, `peek`/`retire` on an unknown name point at `laneboard ls`.
- (4, n3 T55) `laneboard credit` with zero samples says what feeds the sampler (and the docs say it too).
- (4, n3 T56) README's CLI list names `laneboard feed` with a link to `docs/map.md` / `docs/providers.md`.
- (4, n3 T57) `#/runs/<id>` named in README / `docs/runs.md` next to `#/runs?run=<id>`; the README's test-copy port note (a taken port leaves the other board answering, pick a free one).
- (6, r10 idea 2) [ui] Header cost line at nav size and dim unless over budget.
- (6, r10 idea 3) [ui] Lane-sidebar bars grey unless trouble, no hatch.
- (6, r10 idea 4) [ui] Runs list without empty cells, the title takes the free width, need text under the title (check n4 T31 first).
- (6, r10 idea 5) [ui] Run page sparkline ≤ 50 % wide, rounds table aligned and capped at ~900 px.

## For the owner

- Nothing yet. The planner found no item that needs a fenced file: the `/api/*` JSON 404 already
  lives in fenced `server/http.mjs` and only gets a test (T8); if that test shows otherwise, the fix
  is yours.

## Reviews

## Morning
