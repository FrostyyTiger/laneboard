# Runs: progress

Run `runs-n1` (night 1, 2026-10-20 → 2026-10-21 07:00). Scope: README §7 "Night 1": A1 protocol +
helper CLI + `docs/runs.md`, A2 Runs view (list + run page), C design directions, the loop's own
events wired in. Part A3 (Inbox, Morning, Map, Stuck) and Part B wait for later nights.

Notes for builders, from reading the code (planner, round 1):
- New server code goes in `server/runs/` (pure, testable) plus a route module
  `server/routes/runs.mjs` (picked up by `server/modules.mjs`, see `server/routes/health.mjs` for
  the shape). Config is a fragment `server/config/runs.mjs` (see `server/config/review.mjs`),
  documented in `docs/config.md` (`test/config-docs.test.mjs` checks the keys).
- The client store (`public/js/core/store.js`), `net.js`, `keys.js` and `actions.js` are fenced:
  the Runs view fetches `/api/runs` itself, like `public/js/views/morning.js` does. View chords
  live in `VIEW_KEYS` in `public/js/core/router.js` (not fenced); `r` is free there.
- `/api/v1/*` is the fleet API (fenced registry). Night 1 serves runs under `/api/runs…` on the
  builder only; see "For the owner".
- The loop's real events (`docs/plans/runs/loop/run.sh`, `ev()`): every value that looks like a
  number is written as a JSON float (`"n": 3.0`, and a short commit sha made of digits becomes a
  number), `run.start` carries `rounds`, `pause5h`, `stop7d`, `branch` at top level (no `budget`
  object), and it also writes `usage` (`fiveHourPct`, `sevenDayPct`, `fiveHourResetsAt`,
  `overage`) and `cost` (`n`, `usd`, `total`) events. The parser must take all of that as is.
- T1 decisions (round 4), for T2's doc and the views: `foldRun` also returns `better{name}`,
  `plan`, `branch`, `deadlineAt` (ms; `deadline` stays as written), `startedAt`/`updatedAt`,
  `events`, `skipped`; each round has `starts` (retries), `usd`, `usage`. States are `running`,
  `waiting` (last event is a `wait` need), `stopped`. Cost is the sum of `cost.usd` (the loop's
  `total` restarts with it). A `wait` need closes at the next round or stop; others stay open.
  Timestamps in seconds are turned into ms. The loop's real run.jsonl folds cleanly (one
  skipped line: a `tasks` score of `"0\n0"`, a bug in the loop's `tasks_done`).
- T2 decisions (round 5): `docs/runs.md` is the contract for T3-T6; it has a status note at the
  top to drop once the CLI and view land. The CLI there ends a round with `laneboard run round
  --n 3 --end --outcome kept --commit …` (one subcommand for both, as T6 lists) and every
  subcommand takes `--run`; T6 may change flags but must update the doc's CLI section.
- T3 decisions (round 7): `runs.files` entries are expanded (`~/`) in the fragment's `finalize`,
  so `config.runs.files` is already absolute globs for T4 (match them with
  `server/packages/glob.mjs`, which strips a leading `/`: compare against paths without it, or
  walk from the glob's literal prefix). Defaults: `maxEvents` 5000 (100..100000), `keepDays` 30
  (1..3650), at most 64 globs, no `..`. No env layer (`LANEBOARD_RUN_FILE` is the CLI's).
- T4 decisions (round 9): the store lives in the collector; `server/routes/runs.mjs` (already
  a module, builder only) starts it and provides `ctx.use('runs').store()` (null before start),
  with `get(id)` (folded run or null) and `list()` (latest activity first, within keepDays). T5
  adds its routes to that file. Lane files come from `lanes.knownWorktrees()` (60 s pass), files
  are rediscovered every 30 s and tailed every 2 s; `<stateDir>/runs/*.jsonl` is always read, so
  T5 only appends there. A deleted file keeps its runs; one run in several files merges by `ts`.
- T5 decisions (round 10): `GET /api/runs` → `{runs: [summarize(run)]}` (`server/routes/runs.mjs`
  exports `summarize`; row fields are listed in docs/runs.md "The API": `round`, `rounds`,
  `maxRounds`, `scores{name:{n,value,prev,better}}`, open `needs` as a list, `artifacts` a count,
  `stop` the reason). `GET /api/runs/:run` → `{run}` (the full fold), 404 `{error}`. POST
  stamps `ts` when missing, answers 201 `{ok,run,t}`, and calls `collector.track(file)` so the
  run is listed at once. Body cap 64 KiB (413). T6's `--post` should read the 400 `error`.
- T6 decisions (round 12): `round` prints `export LANEBOARD_RUN=<run>/<n>` (with `export`, or
  `eval` would not pass it to the sessions), only on a round start; every other call prints
  nothing. `--run` falls back to the run part of `$LANEBOARD_RUN`. Every line gets `v:1` and a
  client `ts`. `start --rounds/--window-pct` go into `budget`. Flags are in `docs/runs.md` "The
  helper CLI" and the header of `bin/laneboard`. T9 can write its fixture with the CLI's shapes
  in mind, but the loop itself still uses `ev()` (fenced).
- T7 decisions (round 13): `public/js/views/runs.js` fetches `/api/runs` itself (15 s poll while
  shown, GET only; a 404 on a hub is a note) and exports pure helpers T8/T11 can reuse:
  `scoreTrend`/`scoreList` (▲ ▼ =, `better` decides good/worse), `burnOf` (warn at the loop's
  stop levels 90 % 5 h / 85 % 7 d), `timeLeft`, `stateOf` (`error` stop p1, `no-progress` p2,
  `done` ok), `needsOf`/`needsYou` (a `wait` need is the loop sleeping, not a question),
  `rnClean`, `spanText`. Function names are unique across `public/js` (frontend.test checks), so
  T8 should prefix its own. Rows carry `data-run` but no click yet: T8 adds `run` to the route
  and makes a row open `#/runs?run=<id>`. `runs` is in the phone ⋯ menu (`ui/sheet.js`). The
  `runs` icon is Lucide `repeat`; the sprite was rebuilt with `scripts/build-sprite.mjs` from the
  pinned lucide-static (only the new symbol changed).
- T8 decisions (round 16): the router's `run` parameter uses the protocol's RUN_ID pattern
  (`RUN_RX` in `router.js`), comes last in the hash and is dropped on a view switch. The page
  (`renderRunPage`, same file as the list) maps the fold to the list's summary shape with
  `runSummaryOf`, so the header reuses the row helpers; T11's chart goes between the header and
  the timeline and can read `run.scores`/`run.better` directly. Links from a loop become `<a>`
  only through `safeHref` (http/https). A row opens its page through the goal link stretched
  over the row (CSS `::after`), no click handler. Round cost uses `money()` (`$0.900` under a
  dollar, the house format). Up to `RAW_SHOW` (50) unknown events are shown, newest last.
- T9 decisions (round 17): `test/fixtures/runs/loop-runs-n1.jsonl` (72 lines, written by the
  same `json.dumps` as `ev()`) mixes the older float writer and the current int one around a
  restart, so the run's cost (sum of `cost.usd`, $12.15) differs from `run.stop.usd` (the
  loop's `total` since its restart, $10.11) on purpose. `test/runs-loop.test.mjs` is the fixture
  T11 can chart (`tests` 10 points from n 0, `tasks` 6 points from n 3). The burn warn levels
  stay the view's constants (90/85), not `budget.pause5h/stop7d`; a deadline with no zone is
  read in the server's local time (documented). No code change was needed for the loop's shapes.

## Tasks

- [x] T1 (A1) `server/runs/protocol.mjs`: `parseLine(text)` → a checked event or a reason it was skipped (v1; known types from README §3 A1 plus the loop's `usage` and `cost`; unknown types kept raw; strings clamped, numbers coerced: integral floats to ints, `commit` always a string; caps on line length) and `foldRun(events)` → `{run, goal, state, deadline, budget, rounds[], scores{name: [{n,value}]}, needs[], artifacts[], stop, cost, usage, raw[]}`; fixture `test/fixtures/runs/readiness.jsonl` — done when: `test/runs-protocol.test.mjs` passes for every event type, an unknown type, malformed/oversized lines (skipped and counted) and out-of-order rounds (commit 4401484)
- [x] T2 (A1) `docs/runs.md`: the protocol spec v1 (file location `<dir>/.laneboard/run.jsonl`, every event type and field, states and stop reasons, the CLI, the `none` default), linked from `README.md` — done when: a test (`test/runs-docs.test.mjs`) checks every type in `protocol.mjs`'s known list appears in the doc's table and the reverse (commit 056ac63)
- [x] T3 (A1) config fragment `server/config/runs.mjs`: `runs.files` (globs of run.jsonl files to read, default `[]` = none), `runs.lanes` (also read `<lane cwd>/.laneboard/run.jsonl`, default true), `runs.maxEvents`, `runs.keepDays`; section in `docs/config.md` — done when: `test/config-runs.test.mjs` passes (defaults, env layer if any, bad values are a ConfigError) and `test/config-docs.test.mjs` stays green (commit 29bd4f2)
- [x] T4 (A1) `server/runs/store.mjs` + `server/collector/runs.mjs`: find the files from config (globs with `~` expanded, lane cwds), tail each incrementally (byte offset, partial last line, a truncated or replaced file starts over), fold into an in-memory map of runs, cap events per run; started from a module so no boot file changes — done when: `test/runs-collector.test.mjs` passes on temp dirs (append, partial line, truncate, two runs in one file, no config = no runs) (commit 2bdd595)
- [x] T5 (A1) `server/routes/runs.mjs`: `GET /api/runs` (list summaries), `GET /api/runs/:run` (the folded run), `POST /api/runs/events` (validated by `parseLine`, appended to `<stateDir>/runs/<run>.jsonl`, which the collector reads too; normal local guards, so the CLI's `x-laneboard` header) — done when: `test/runs-routes.test.mjs` passes (list, one run, 404, a bad event is 400, a good one shows up in the list) (commit b443f2f)
- [x] T6 (A1) CLI `laneboard run start|round|score|needs|artifact|stop` in `bin/laneboard`: writes one line to `--file` / `$LANEBOARD_RUN_FILE` / `./.laneboard/run.jsonl` (works with laneboard down), `--post` sends it to the API instead; `round` prints `LANEBOARD_RUN=<run>/<n>` for `eval`; usage text in the header comment — done when: `test/cli-run.test.mjs` (pattern of `test/cli-pause.test.mjs`) shows each subcommand writes a line `parseLine` accepts, and bad args exit 2 (commit 332ad36)
- [x] T7 (A2) [ui] Runs list `#/runs` (`g r`): `public/js/views/runs.js` (default export view), `<section id="view-runs">` in `public/index.html`, `runs` in `VIEWS`/`VIEW_KEYS` (`router.js`) and `VIEW_META` (`views/index.js`), an icon in `core/icons.js`, `public/css/views/runs.css`; each row: goal, state, round n / max, latest score + trend, budget burn (5 h / 7 d from `usage`), time left, open needs; empty state says how to start a run — done when: `test/view-runs.test.mjs` (fakedom, see `test/view-morning.test.mjs`) renders the fixture and the empty state, and `router.test`, `icons.test`, `design-guardrails.test` stay green (commit 4cae33d)
- [x] T8 (A2) [ui] Run page `#/runs?run=<id>` (add the `run` parameter to `parseHash`/`formatHash` with a strict pattern): the timeline of rounds (role, task, outcome, commit, cost, duration), stop reason, open needs, artifacts (PR links), raw unknown events folded away — done when: `test/view-runs.test.mjs` covers the page from the fixture and `test/router.test.mjs` covers the new parameter (bad values dropped) (commit 2f3e208)
- [x] T9 (A1/§7) The loop's own events: `test/fixtures/runs/loop-runs-n1.jsonl` written with exactly the shapes `run.sh` emits (floats, numeric commit, `usage`, `cost`, `needs kind=wait|fence`, `run.stop` with `rounds`/`usd`), folded into budget burn and per-round cost; `docs/runs.md` gets a "Watching the runs loop" section with `runs.files: ["~/runs/*/run.jsonl"]` — done when: a test folds the fixture into the expected run (rounds, costs, scores `tests` and `tasks`, stop reason) and the list row shows it (commit 76fd855)
- [ ] T10 (C) [ui] Two or three design directions inside the control-room style (README §5, §8 Q1): each a token override file `docs/plans/runs/design/<name>.css` (type scale, 4 px spacing, elevation for floating layers only, both themes) and `docs/plans/runs/design/README.md` saying what each changes, why, and how to view it on the demo (`node test/tools/demo-fleet.mjs`) — done when: a test checks each file only sets custom properties that exist in `public/css/tokens.css` and passes the design guardrails
- [ ] T11 (A2) [ui] Score chart per metric on the run page: one small SVG line per metric over rounds (reuse `public/js/ui/spark.js` if it fits), `better` decides which way is good, no animation — done when: `test/view-runs.test.mjs` checks the chart's points for the fixture's `tests` and `tasks` scores and an empty chart for a run with none
- [ ] T12 (A1) Sessions tied to rounds by cwd + time window (`server/runs/bind.mjs`, read from the session registry): a round row lists the sessions that ran in its dir during it, with their cost — done when: `test/runs-bind.test.mjs` passes (inside the window, outside, two runs in one dir)
- [ ] T13 (docs) README "second copy for testing" command is not isolated (it opens the default audit file and can fail with AUDIT_LOCKED): add `LANEBOARD_AUDIT_FILE` and `LANEBOARD_STATE_DIR` (temp paths) to the documented command, plus a line on how to stop the copy; check the env names in `docs/config.md` first — from reviews/14-stranger.md #1, #7 — done when: the README command sets both and a test or manual check of the doc names real env vars
- [ ] T14 (docs) `docs/runs.md` CLI section and "smallest useful loop" say that a run file outside a lane cwd is only seen with `runs.files` or `--post`; drop the "is being built" status note now that the CLI and view exist — from reviews/14-stranger.md #2, #6 — done when: `test/runs-docs.test.mjs` stays green and the note is gone
- [ ] T15 (docs) README lists the Runs view and `g r` in the view table and key list, with a link to `docs/runs.md` — from reviews/14-stranger.md #6 — done when: README mentions `#/runs` and `g r` (a docs test greps for it if one already checks the view list)
- [ ] T16 (A1) CLI `laneboard run`: accept `--post`/`--run`/`--file` before the subcommand too (or fail with a message that says flags go after `<sub>`), and make a usage error print one line plus "see `laneboard run --help`" instead of the whole usage block — from reviews/14-stranger.md #3, #5 — done when: `test/cli-run.test.mjs` covers flags-first and a short bad-value error, exit code stays 2
- [ ] T17 (A2) Runs list copes with a run that has no `run.start` (only a posted `run.stop`: `goal` null, `rounds` 0): no `null`/`undefined` text, shows the run id as title — from reviews/14-stranger.md #4 — done when: `test/view-runs.test.mjs` renders such a row

## Research questions

- [x] Q1 Claude Code `--output-format stream-json`: the exact fields of the `result` message (`total_cost_usd`, `duration_ms`, `num_turns`, `usage`, `session_id`) and of `rate_limit_event` (`rate_limit_info`, `unifiedWindows`, `resetsAt` units), with links to the docs or source — for T9 → research/Q1-stream-json-result-and-rate-limit.md (`result` confirmed; `unifiedWindows` and the `resetsAt` unit are not in the official docs, parser should accept seconds and ms)
- [x] Q2 How can laneboard tie a Claude Code session to the loop round that started it: do hook payloads carry the session's cwd, env or a settable id (`--session-id`, `CLAUDE_CODE_*`), and is reading `/proc/<pid>/environ` of a same-user process a documented, reliable way to see `LANEBOARD_RUN`? — for T12 → research/Q2-session-to-round-binding.md (hooks carry `session_id` + `cwd`, `--session-id <uuid>` is settable, `/proc/<pid>/environ` is not reliable; cwd + window stays the default)
- [x] Q3 How do comparable tools present long multi-step runs and their history (GitHub Actions run graphs, Buildkite, Weights & Biases / MLflow run comparison, LangSmith or Langfuse traces, OpenHands / SWE-agent trajectory viewers): what makes "what happened tonight, is it getting better" readable at a glance, what to avoid — for T7, T8, T11 → research/Q3-run-history-in-comparable-tools.md (state-first summary, metric-over-step chart plus latest-value table, timeline of rounds; OpenHands not researched)
- [x] Q4 Primary-source token systems of product-grade dense dark/light UIs (GitHub Primer, IBM Carbon, Grafana, Linear): type scale steps, spacing grid, elevation and translucency for floating layers, focus rings — for T10 → research/Q4-dense-ui-token-systems.md (14px body/12px labels, 4px grid, 2px focus ring, dark elevation = lighter surface + 1px ring; no source documents translucent layers; Linear's 3-input LCH theme is the idea to take)

## For the owner

- **Hook-style intake for runs needs a fenced file.** Plain `curl` from a loop (no custom header)
  is only accepted on `HOOK_PATHS` in `server/security.mjs` (fenced). Night 1 ships
  `POST /api/runs/events` behind the normal local guards (the CLI sends `x-laneboard`), and loops
  that do not use the CLI write the file. Adding the path to `HOOK_PATHS` is your call.
- **`/api/v1/runs/events` (README §3 A1) is not used yet.** `/api/v1/*` is the fleet API with its
  own registry (`server/fleet/api-v1.mjs`, `server/routes/v1.mjs`, fenced), and runs on a hub need
  `server/hub/*` (fenced). Night 1 is builder-local under `/api/runs…`; moving it into v1 and the
  hub needs a reviewed change.
- **No browser on the run VM.** There is no Chromium or Playwright here, so night 1 cannot take
  screenshots: the design directions (T10) come as token files plus how to view them, and the
  designer review (it starts on `docs/plans/runs/design/*.png`) will not run. Screenshot tests
  (README §5) need a decision: Playwright as a dev dependency plus a browser download in the VM.
- **`run.sh` writes numbers as floats** (`"n": 3.0`) and would write an all-digit short sha as a
  number. laneboard copes (T1), but the loop (fenced) could quote `commit` and write ints.
- **Exact session-to-round binding needs a `run.sh` change (fenced).** Claude Code accepts
  `--session-id <uuid>`; if the loop generated one per round and wrote it on the round's start
  event, T12 could bind exactly instead of by cwd + time window (research/Q2). Your call.
- Tests were red before this run (1 fail, a path assertion in the scripts tests under
  `/tmp/lb-scripts-*`); the loop's fix round takes it first.

## Reviews

- reviews/14-stranger.md: 7 findings, 5 became tasks (T13 #1+#7, T14 #2, T15 #6, T16 #3+#5, T17 #4); #6 is split between T14 (stale note) and T15 (README).

## Morning
