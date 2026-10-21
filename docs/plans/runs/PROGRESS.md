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

- [x] T1 (1) An `artifact` carries an optional `state` (`open`, `merged`, `closed`; anything else is dropped to null): `server/runs/protocol.mjs` `SHAPES.artifact` reads it, and in `foldRun` a later `artifact` line with the same URL updates `state` and a non-empty `title` instead of being ignored (the place in the list stays); `laneboard run artifact --state s` (`RUN_FLAGS` in `bin/laneboard`, the usage line); `docs/runs.md` documents the field and the update rule — done when: `test/runs-protocol.test.mjs` folds an open PR then the same URL `merged` and finds one artifact with `state: 'merged'` and the later title, a bad state gives null; `test/cli-run.test.mjs` writes `--state merged`; `test/runs-docs.test.mjs` finds `state` in the artifact section (commit b9cf0b9)
- [x] T2 (1) [ui] A merged or closed PR leaves the Inbox at once, and the run page shows each PR's title and state: `public/js/core/inbox-model.js` drops a run PR whose `state` is `merged` or `closed` and keeps the 24 h rule only for artifacts with no state; `public/js/views/runs.js` artifact rows print the title (the URL as fallback) and the state as a muted word — done when: `test/inbox-model.test.mjs` has an open PR in REVIEW, the same PR merged gone, a stateless PR still under the 24 h rule; `test/view-runs.test.mjs` finds the title and `merged`; shots of inbox and the run page (dark + light, 1440 + 390), console clean (commit 0315aef)
- [x] T3 (2) The protocol keeps the loop's fields: `title` on `round.start` (per round), `detail` on `run.stop` (in `run.stop`, so `/api/runs/<id>` returns it), `wrapup: true` on `round.start` (the round is marked `wrapup`, and a wrap-up round after `run.stop` neither restarts the run nor counts in `rounds` against `maxRounds`); a round with no `usd` and no `cost` event keeps `usd: null` (never 0) — done when: `test/runs-protocol.test.mjs` folds a run with a titled round, a stop with `detail`, then a `wrapup` round, and finds the title, `stop.detail`, state `stopped`, the wrap-up round flagged and the counted rounds equal to the stop's; `test/runs-routes.test.mjs` sees `detail` in the JSON; `docs/runs.md` lists the three fields (commit 1690527)
- [x] T4 (2) [ui] The run page shows them: the round title in the timeline (task id muted beside it), the round's `session` as a link to its session (the existing peek/transcript route; plain text when the session is unknown), `detail` on a line under the stop reason in the state label, wrap-up rounds read "wrap-up" and never "64 of 63", and an unknown round cost prints `—`, not `$0.00` (`public/js/views/runs.js`) — done when: `test/view-runs.test.mjs` renders a run with these fields and finds the title, the link, the detail, "wrap-up", no "64 of 63" and `—` for the unknown cost; run page shots (dark + light, 1440 + 390), console clean (commit 85ffc0b)
- [x] T5 (2, n3 T48 part) [ui] The `tasks` score's `max` drives "44 of 63" and the ring, and a moved max shows: `server/runs/summary.mjs` gives the latest `tasks` value and max (and the first max), the Runs list and the run page print `44 of 63` (and `scope 12 → 63` muted when the max moved, operator r64 gap 5), `server/map/runs.mjs` / `public/js/views/map/overlays.js` draw the ring from tasks when a max exists and print the number the ring draws, after the name — done when: tests in `test/runs-protocol.test.mjs` or a summary test, `test/view-runs.test.mjs` and `test/map-runs.test.mjs` check "44 of 63", the scope line and the ring fraction; shots of runs and map (dark + light, 1440 + 390) (commit d204221)
- [x] T6 (3, n3 T46) The run's cost adds up: `laneboard run cost --usd x [--n N]` posts/writes a `cost` event (`RUN_FLAGS`, `RUN_TYPE`, the usage, and a "round only" hint on `round --end --usd`); in `foldRun`, when a run has no `cost` events its `cost.usd` is the sum of the rounds' `round.end` `usd` (null when none has one); `laneboard run … --post` prints what the server accepted (the folded `t` and `run` from the 201 body, plus any field it dropped) — done when: `test/cli-run.test.mjs` writes a `cost` line and checks the help has `cost` and the hint; `test/runs-protocol.test.mjs` sums two `round.end` `usd` values with no `cost` events and gets null with none; a `--post` test against a test server prints the accepted line (commit b3692f3)
- [x] T7 (3, 5b) One name `maxRounds`: `run.start` accepts `maxRounds` (top level or in `budget`), `budget.rounds` stays as an alias for one version (said in `docs/runs.md` with the version); `docs/runs.md` gets the one line "`rounds` is rounds done, `maxRounds` the cap"; `GET /api/runs?run=<id>` returns only that run (empty list for an unknown id); a 404 on `/api/runs/<id>` says `no run <id>; the list is GET /api/runs` (`server/routes/runs.mjs`) — done when: `test/runs-protocol.test.mjs` folds both spellings to the same `maxRounds`; `test/runs-routes.test.mjs` filters by `?run=`, and reads the 404 text; `test/runs-docs.test.mjs` finds the line (commit cdf9e71)
- [x] T8 (3, 5f) The API answers what a `curl` visitor guesses: `GET /api/health` (a small JSON `{ok, version, mode}`, read-only, in an unfenced route module registered from `server/boot/builder.mjs`), `/api/morning?window=bogus` a 400 naming the allowed windows (`server/boot/builder.mjs` l.80, `WINDOWS`), a test through `boot()` that `/api/nope` is a JSON 404 and `/nope` is the page; README gets a route table (view → `/api/*`, plus `/api/health`) — done when: a route test gets 200 JSON from `/api/health`, 400 from the bogus window, JSON 404 from `/api/nope`; `test/runs-docs.test.mjs` (or a README test) finds `/api/health` and the table header in README (commit 4cae1ee)
- [x] T9 (3, 5c, n3 T54, n3 T61) `laneboard morning` reads like the page: ISO dates in the header (`since 2026-10-21 18:00`) and the right word (`server/util.mjs` `windowLabel` always says `tonight` for that window: say `tonight` while the window's night is still running and `last night` once it is morning; one rule shared with the web Morning), money with 2 decimals (`$0.10`, `money` l.174, used by `ls`/`credit` too), the SESSIONS column as a count (`3 sessions`), and runs that stopped in the window listed under a Finished heading with their stop reason — done when: CLI tests on the morning text (a fake `/api/morning` body) find the ISO header, `$0.10`, `3 sessions`, no UUID, no line over 100 columns, and a stopped run under Finished (commit c8b16bc)
- [x] T10 (3, 5e, n3 T59) Names come from config or the hostname only: with no config the Map title is the hostname and no fleet block shows, the branch still shows (find where an environment variable such as `LANEBOARD_RUN` reaches the title or the builder code today and remove that path); `docs/config.md` lists every environment variable the board reads; `laneboard run start` without `--run` keeps an inherited `LANEBOARD_RUN` and says so on stderr (`run id <x> from $LANEBOARD_RUN`), and with neither the error names `--run <id>` (said in the help and `docs/runs.md`) — done when: a config/map test with `LANEBOARD_CONFIG=/dev/null` and `LANEBOARD_RUN=run-x/3` in the env gets the hostname title; `test/cli-run.test.mjs` checks the stderr note and the error; a docs test finds the variable list (commit fd16453; no env path existed: stranger r49's `run-runs-n1` title and `RRN` builder were the loop VM's hostname and its derived fleet code, so nothing was removed and `test/config-names.test.mjs` pins the hostname title, no fleet block, the lane branch and no `run-x` anywhere; the stderr note is printed by `run start` only (other subcommands inherit quietly, that is the round flow); `docs/config.md` `## Environment variables` lists every variable, the same test checks each `LANEBOARD_*` in server/, public/js/, bin/ is in it)
- [x] T11 (4, n3 T52) `laneboard pause --all` / `resume --all` / `paused` stay in the isolated copy: a test with `LANEBOARD_STATE_DIR=<tmp>` and `HOME=<other tmp>` finds `paused/ALL` under the state dir and nothing under `HOME`; if it fails, fix `bin/laneboard` (`resolveStateDir`, never `server/control/*`); README's isolation paragraph names which commands write the real dir by design (`run` without `--post` writes `./.laneboard/`) — done when: the `test/cli-pause.test.mjs` case passes and the README sentence is there (commit e714954; the bug was already gone: `resolveStateDir` reads `$LANEBOARD_STATE_DIR` first, the new test with a separate HOME passes unchanged; README also names `fleet keygen` without `--out`)
- [x] T12 (5a, 5d, 5g) Small CLI calls: an unknown command prints `unknown command: <x>` as the first line, then the help, exit 2 (`bin/laneboard` l.1237); `laneboard ls`, `morning` and `credit` print `board: <url>` on stderr (the URL that answered); `laneboard run needs "text"` takes a bare text as `--text` (a second bare word is still an error) — done when: CLI tests check the first line and exit code, the stderr `board:` line with `LANEBOARD_URL` set to a test server, and a bare-text need written to the file (commit 52e8b18; the first line keeps the CLI's `laneboard: ` prefix like every error, a `did you mean: laneboard <cmd>` line follows when one command is within edit distance 2 or a prefix, and the help goes to stderr too (Q19); tests in `test/cli-board.test.mjs` and `test/cli-run.test.mjs`; README and `docs/runs.md` say it)
- [x] T13 (4, review 6-designer, Across 1 + Board 1) [ui] One mark per state: a stuck lane reads `▲ STCK` (the header tile's word, from `STATE_MARK`) on the Board card, in the NEEDS YOU list and on the phone chip, never `▲ WORK` on one and a grey `●` on another; the hourglass stays a grey icon beside it — done when: a view test finds the same mark text in the card, the list row and the chip for the same stuck lane; shots of board and inbox (dark + light, 1440 + 390), console clean (commit cf3fd7f; `markWord` in `board-card.js` also says `APPR` for a working lane holding an approval; the NEEDS YOU entry joins the store's session for `stuck`/`awaitingApproval`; test in `test/marks.test.mjs`; shots 26-T13 console clean)
- [x] T14 (4, review 6-designer, Across 3) [ui] The selected sidebar plate (`ALL`) is outlined like the others, never a fill (design.md: selection is a 1 px accent border, no dark slab in light) — done when: a CSS/token test or view test finds no background fill on the selected plate; shots of board (dark + light, 1440 + 390), console clean (commit 826c50c; the fill was `plate--solid` on ALL in `public/js/ui/rail.js`, now the plain outlined plate; the selected row keeps its corner brackets and the faint `--bg-selected` row wash like other selected rows; test in `test/rail.test.mjs`; shots 29-T14 console clean)
- [x] T15 (4, review 6-designer, Across 4) [ui] The header cost tile prints `—` when no session reported a cost (not `$0.00`), at the size of the tiles around it (`--fs-12`, `--text-2`) — done when: a view test finds `—` for no cost and `$0.00` for a reported real zero; shots of board (dark + light, 1440 + 390), console clean (commit fde41e4; the tile was already `--fs-12`, the loud part was the bold `--text-1` `<b>`, now `--text-2` at weight 400; `topbarSpend` gives `usd: null` and `—` unless a session has a finite `cost.usdToday`; the phone still hides the tile; shots 30-T15 console clean)
- [x] T16 (4, review 6-designer, Run page 1+2, Inbox 3) [ui] PR rows read as links: run page artifact rows print `title ↗ · state · round n` with `open` printing nothing or the same `·` form and `merged`/`closed` muted; the Inbox RUN PRS row drops the `pr:` prefix and shows only the ↗ at 390 so the title is not cut; the run page 390 check scrolls to the artifacts (`shoot.mjs --hash` or a DOM test, since it shoots the viewport only) — done when: `test/view-runs.test.mjs` and `test/inbox-model.test.mjs` or a view test find the new row text and no `pr:`; run page and inbox shots (dark + light, 1440 + 390) with the artifacts visible (commit d2f363b; `open` prints `· open` in `--text-2`, merged/closed in `--text-3`; the ↗ is an aria-hidden span inside the link; the Inbox link is `open ↗` with the word hidden under 700 px on RUN PRS rows only; the 390 artifact check used a scrolled copy of shoot.mjs kept in the run dir (`tools/shoot-scroll.mjs --scroll .rn-art-sec`), shots 31-T16 console clean)
- [x] T17 (5, review 6-designer, Board 3 + 8) [ui] Board left column empty states are one muted line (`Rate limits · none`, `Machine · none`) as design.md says; a phone offline card's hatch stops behind a solid strip under the title row, not under the text — done when: a view test finds the two lines and no bare section header; board shots (dark + light, 1440 + 390), console clean (commit 3e65a89; `railSection` in `public/js/ui/rail.js` hides the section's h2 (`rate-limits-h`, `vitals-h` in index.html) and prints `emptyLine` from inbox-model; the sections stay in place, not moved below the filled ones; the strip is `.card.stale :is(.db-1, .db-row)` on `--bg-surface` at every width, line 2 and below still sit on the hatch (that is T28); tests in `test/render.test.mjs`; shots 32-T17 and 32-T17b (offline BC cards) console clean)
- [x] T18 (5, review 6-designer, Map 6) [ui] The `+2` overflow badge sits outside its node's ring, not over it — done when: `test/map-runs.test.mjs` or a map test checks the badge offset is larger than the ring radius; map shots (dark + light, 1440 + 390) (commit ad315c8; the ring under the plate was the ambient ping of a loud node (r+18 px, every round), so the pings are now drawn under an even-odd clip with a hole per plate; the plate is also placed off `ringOuter` (a folded builder's drift square reached past the fold ring); tests in `test/map-render.test.mjs`; shots 33-T18 console clean)
- [ ] T19 (2, review 13-designer, Across 2) [ui] The run page SCORES block agrees with the stat line: a score with a `max` reads `3 of 10` in the value column and its spark is drawn against 0..max; the min–max range stays only for scores with no max (`public/js/views/runs.js`) — done when: `test/view-runs.test.mjs` renders `tasks` 3 of max 10 and finds `3 of 10` and no `0–3` in the block, and a score with no max still shows its range; run page shots (dark + light, 1440 + 390), console clean
- [ ] T20 (3, review 13-designer, Run page 2 + Runs list 1) [ui] The scope note never makes the stat line two lines tall: `tasks 3 of 10 · scope 8 → 10` stays inline (scope muted, `--text-3`), on the run page and in the Runs list row; if it must wrap, the whole line is top-aligned — done when: a view test finds the scope text in the same stat element as the tasks text (no block-level break); run page and runs shots (dark + light, 1440 + 390), console clean
- [ ] T21 (3, review 13-designer, Run page 3 + 4) [ui] Rounds table words: a wrap-up round says `wrap-up` in the ROUND cell only (task cell empty, ROUND cell left-aligned), and the outcome prints words (`no task done`, not the slug `no-task-done`; map in the view, the protocol value stays) — done when: `test/view-runs.test.mjs` finds one `wrap-up` in that row and `no task done` with no `no-task-done`; run page shots (dark + light, 1440 + 390), console clean
- [ ] T22 (3, review 13-designer, Run page 5) [ui] The round's session link is visible as a link (underline or ↗ after the role, like the artifact title), and the demo fleet (`test/tools/demo-fleet.mjs`) gives at least one demo round a known session so a shot shows it — done when: `test/view-runs.test.mjs` finds the anchor with the link marker; the run page shot shows one linked round (dark + light, 1440 + 390), console clean
- [ ] T23 (3, review 13-designer, Run page 6 + 9) [ui] At 390 each round keeps its title: two lines per round (`3 builder kept c3e4a5b $3.68`, title and task id under it in `--text-2`), COMMIT dropped before TASK; the 390 shot scrolls to the end of the rounds table and the artifacts (include the wrap-up row; same scroll as T16) — done when: a view test finds the round title in the phone markup; shots at 390 (dark + light) show the title and the wrap-up row, console clean
- [ ] T24 (2, review 16-stranger, 2) `laneboard run start` takes `--max-rounds N` for the cap; `--rounds N` on `start` stays as an alias and prints a stderr note (`--rounds on start means --max-rounds`); `--rounds` on `stop` stays the count done; the usage and `laneboard run start --help` say which is which (`bin/laneboard` `RUN_FLAGS`, `docs/runs.md`) — done when: `test/cli-run.test.mjs` writes `start --max-rounds 3` and finds `maxRounds: 3` in the line, `start --rounds 3` gives the same line plus the stderr note, and the help text names both flags
- [ ] T25 (4, review 24-stranger, 5) `laneboard morning` never lists a running lane under a "Finished" heading: the "(1 lane active)" count moves to its own line or heading (`Still running`), and Finished holds only what finished in the window (`bin/laneboard` morning text, and the web Morning if it does the same) — done when: a CLI test with a fake `/api/morning` body that has one active lane and one stopped run finds the active lane outside the Finished block, and no line over 100 columns
- [ ] T26 (4, review 24-stranger, 7) `laneboard fleet pubkey` with no key reads the key path from the state dir like `keygen` does, or, if it must read the real home, the error says which path it looked in and README's isolation paragraph lists `fleet pubkey` beside `fleet keygen` — done when: a `test/cli-*.test.mjs` case with `LANEBOARD_STATE_DIR=<tmp>` and `HOME=<other tmp>` checks the error text (or the path used) and the README sentence is there
- [ ] T27 (4, review 27-designer, Across 3) [ui] The Inbox rows carry the same mark word as the Board (`▲ QUES`, `▲ PERM`, from `STATE_MARK`) after the shape, then the session's own question text; generic `question` only as the fallback, in `--text-3` — done when: a view test finds `QUES` in an Inbox question row and the fallback word only when the session has no text; inbox shots (dark + light, 1440 + 390), console clean
- [ ] T28 (4, review 27-designer, Board 1) [ui] An offline card's hatch stops behind a solid `--bg-surface` strip under the text rows at every width (extends T17's phone check to 1440) — done when: a CSS/view test checks the strip rule is not limited to the phone; board shots with an offline lane (dark + light, 1440 + 390), console clean
- [ ] T29 (3, review 27-designer, Board 5) [ui] Lane cards are as tall as their content: a red-framed card does not stretch to the tallest card in its row (`align-items: start` on the lane grid) — done when: a CSS test finds the rule on the lane grid; board shots at 1440 (dark + light), console clean
- [ ] T30 (2, review 27-designer, Board 3) [ui] Board filter chips have equal left and right padding (`--sp-3`), no blank slot on the left — done when: a CSS test finds equal padding on the chip; board shots (dark + light, 1440 + 390), console clean
- [ ] T31 (2, review 27-designer, Inbox 2) [ui] The `BASH` tool badge is outlined in both themes, like the lane plates, never a grey fill in light — done when: a CSS test finds no background fill on the badge in the light theme; inbox shots (light, 1440 + 390), console clean
- [ ] T32 (2, review 34-stranger, 2) `laneboard run needs ack …` (a known subcommand as the bare word after another) says `did you mean: laneboard run ack [<run>] <ref>` instead of only `unexpected argument` (`bin/laneboard` run arg parsing; same close-match line the top-level unknown command prints) — done when: `test/cli-run.test.mjs` runs `run needs ack demo 0`, finds exit 2 and the `did you mean` line naming `run ack`
- [ ] T33 (2, review 34-stranger, 5) `laneboard run artifact --help` and `docs/runs.md` say what the default `--kind` is and that only `kind: pr` artifacts appear in a run's `prs` — done when: `test/cli-run.test.mjs` finds the default kind named in the artifact help and `test/runs-docs.test.mjs` finds the `prs` sentence

## Research questions

- [x] Q17 → research/Q17-pr-state-mapping.md. What `gh pr view --json state,isDraft,mergedAt,closedAt,title,url` prints for an open, a draft, a merged and a closed PR (the exact `state` values and their case), and what GitHub's REST `pulls` API gives for the same (`state` open/closed plus `merged_at`): how should a loop map them onto the protocol's `open`/`merged`/`closed` — for T1
- [x] Q18 → research/Q18-growing-total.md. How progress tools show a total that grows while work goes on (Jira and Linear burn-up "scope" lines, Linear's cycle scope change, GitHub Projects' progress, CI matrices that add jobs): what they draw and print when the denominator moves, and what reads as misleading — for T5
- [x] Q19 → research/Q19-unknown-command-and-target.md. How established CLIs answer an unknown command and say which server or context they talk to: `git` ("is not a git command", suggestions), `kubectl` (the context line, `--context`), `gh` (host), `docker context`, `npm`: exit codes, stdout vs stderr, one line or full help — for T12
- [x] Q20 → research/Q20-health-endpoint.md. What a small read-only health endpoint conventionally returns (the IETF draft `application/health+json` "Health Check Response Format", Kubernetes `livez`/`readyz`, Spring Boot actuator `/health`): the minimal fields, status codes and what must not leak (versions, paths) on an endpoint a stranger can `curl` — for T8

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
- Design ideas and taste calls from review 6-designer (none made a task; say which you want):
  - Counts in one style `[n]` everywhere (Inbox/Runs/Lanes `[7]`, run page `(1)`, Board bare box), and
    progress always `7 of 10` after the name (T5 settles the progress form for `44 of 63`).
  - Inbox: counts next to "ALL" with a noun each (`9 sessions`, `7 items`); empty sections (`Review ·
    none`) at dense row height grouped in one block; `COOPERATIVE CONTROL` dashed border as a sunken
    plate; the approval countdown as `59:54 left`.
  - Inbox row and run page use one open/ack control (the run page's buttons).
  - Light theme: `--p2` hue toward ochre (not olive); header tiles on `--bg-surface` with a 1 px line;
    nested session panels on `--bg-surface`; light is heavier than dark.
  - Run page: goal first at `--fs-16` above the state line; stat line grouping (`5h ▬▬ 92%` hugging);
    scores block alignment and en dash ranges; rounds table content-sized columns; one max width for
    reading pages (run page vs Inbox/Runs); acked need in `--text-3`.
  - Map: phone Fit uses the whole height between header and Find row; lane swatches avoid the accent
    violet.
  - Board: red cards use the left bar like amber ones (or all trouble cards get the frame); the two
    notification buttons same width and spaced; idle lanes as chips; `LAUNCH A LANE…` with an accent
    border as the primary call to action.
- Ideas from review 13-designer (none made a task; say which you want):
  - Noun before every `x of y` (`tasks 3 of 10`, `round 7 of 10`) on Map, Runs list and run page, the
    slash nowhere (the Map's ring can count rounds or tasks and the label does not say which).
  - One `↑` trend glyph at number size after the whole phrase (`tasks 3 of 10 ↑`); one type style for
    Map run labels (`ACME-DOCS · 3 OF 10`); one `--row-dense` gap between phone stat lines.
  - Run page head: goal first at `--fs-16` for every state, state line and detail under it, ids muted
    (same as the review 6 idea).
  - `shoot.mjs` (fenced) should freeze animations so trouble halos compare between shots.
  - Map: BUILDER-A's lane dots include the accent violet; phone Fit leaves empty bands.
- Idea from review 16-stranger (no task; say if you want it): a second `run needs ack` of the same
  need prints `need 0 already acked, nothing posted` (exit 0) while the first printed only `needs.ack
  posted`; naming the need's text in both would be clearer.
- From T13 (round 26): the Inbox still files a stuck working lane under ARCHIVE / STALE with a grey
  ○ (night 4 made that group "read-only, all grey"), while the Board now says `▲ STCK` for it. Move
  stuck sessions to an amber row in NEEDS YOU, or keep the Inbox's grey stale group as is?
- From review 24-stranger (no task; say which you want):
  - `ls` BRANCH showed `-` on a fresh copy and the real branch on an older board for the same
    session; maybe a collector warm-up, nobody has checked. Worth a look if it repeats.
  - `laneboard run needs "x"` with `$LANEBOARD_RUN` set writes `./.laneboard/run.jsonl` in the cwd
    without saying where the id came from (T10 chose a quiet inherit for non-`start`). Say it on
    stderr for every subcommand, or keep it quiet?
  - The README test-copy snippet hard-codes port 7788 and does not check it is free; a stranger tested
    the wrong board for a pass (third review to hit it). Later has it (n3 T57); consider moving it up.
- From review 34-stranger (no task; say which you want):
  - A copy that cannot bind its port could log which board answers instead (pid/title), so a
    backgrounded start is not mistaken for a pass.
  - `/api/box` and `/api/audit` are guessed from view names and 404 without a hint; the README maps
    them to `/api/v1/health?history=1` and `/api/v1/audit`. A hint in the JSON 404 would need fenced
    `server/http.mjs`.
  - README's CLI section never names `laneboardctl` (only docs/install.md does), and it says Ctrl-C to
    stop the copy, which does not work for a backgrounded one (`kill $!`; `pkill -f` kills every board).
- Ideas from review 27-designer (none made a task; say which you want):
  - `shoot.mjs` (fenced): freeze the demo fleet's clock and seed so dark and light shots show the
    same fleet (BC online vs offline, NEED counts differed between shots seconds apart).
  - Name a lane one way everywhere: Board form (plate `BB` + session name in mono); the Inbox shows
    `[BB] cleanup job`, the long name in a tooltip.
  - Phone bottom bar: when the current view lives under `…`, show its name (`BOARD`) in the accent
    frame, `…` beside it unframed.
  - Phone: `LAUNCH A LANE…` as a `+` icon at the end of the plate row (saves ~100 px).
  - Idle chip row could carry the state mark in the left slot (`▲ feat-search 2`, `○` for idle).
  - Light amber still olive and nested panels heavy: same as review 6 ideas.

## Reviews

- reviews/6-designer.md: about 50 findings, 6 became tasks (T13-T18). Dropped as covered: stuck
  amber hourglass (Later n3 T50), Runs list empty cells/goal cut/need line (Later r10 idea 4), map
  trouble label and phone collisions (Later n3 T48), run-label order and `7 / 10` alignment (T5), run
  page sparkline/rounds table width (Later r10 idea 5). Rest went to For the owner as ideas. The
  console was clean.
- reviews/13-designer.md: about 30 findings, 5 became tasks (T19-T23). Dropped as covered: sparkline
  and rounds table width (Later r10 idea 5), goal cut / hourglass / slash alignment in the Runs list
  (Later r10 idea 4, n3 T50), Map CI-RETRY label and phone label pairing (Later n3 T48), `+2` badge
  (T18), the 390 shots ending above the artifacts (T16, T23). The rest went to For the owner as
  ideas. Console clean.
- reviews/16-stranger.md: 6 findings, 1 became a task (T24). Dropped as covered: taken test port
  (Later n3 T57), silent `$LANEBOARD_RUN` (T10), `run cost` vs round `--usd` hint (T6, done), `ls`
  lists real sessions (README says so). The double-ack wording went to For the owner. No broken view.
- reviews/24-stranger.md: 7 findings, 2 became tasks (T25, T26). Dropped as covered: taken test port
  (Later n3 T57, also For the owner), `?run=nope` empty list vs 404 (by design, T7), `--rounds` naming
  (T24). The `ls` BRANCH mismatch and the quiet `$LANEBOARD_RUN` on `needs` went to For the owner.
- reviews/27-designer.md: about 20 findings, 5 became tasks (T27-T31). Dropped as covered: ALL plate
  fill (T14), `$0.00` and bare MACHINE (T15, T17), phone RUN PRS cut (T16), stuck row in the Inbox
  (already For the owner from T13), light olive amber and heavy panels (review 6 ideas). Lane naming,
  shot freezing, phone nav/launch layout went to For the owner. Console clean.

- reviews/34-stranger.md: 6 findings, 2 became tasks (T32, T33). Dropped as covered: taken test port
  (Later n3 T57, third time reported). Items 3, 4 and 6 went to For the owner. No browser, pages not looked at.

## Morning
