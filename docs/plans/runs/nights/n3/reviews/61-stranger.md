# Stranger, round 61

Walk: README as written, a copy on a free port (7795), `laneboard run` over `--post` for two demo runs,
`/api/runs`, `laneboard ls|morning`. No browser tool, so the HTML views were not looked at (only `/` answers 200).

1. **The CLI cannot give a run a cost.** `laneboard run round --end --usd 1.5` and `run stop --usd 2.5`
   both exit 0 and the run's `cost` in `/api/runs` stays `{"usd":0,"rounds":0}` (budget burn, Runs list
   "cost", Morning cost all read that). Only a `cost` event adds to it (docs/runs.md ~l.117-120 says so),
   but `laneboard run --help` has no `cost` subcommand, so a stranger using only the CLI never gets a nonzero
   run cost. `laneboard cost` exists but is the machine's spend, a different thing. Found by: ran the
   round/stop with `--usd`, read the API, grepped the docs. Fix: a `run cost --usd x [--n N]` subcommand,
   or let `round --end --usd` / `stop --usd` also count towards the run.
2. **The stated test port was taken.** The loop's own board already listens on 7790 here; the start there
   printed `EADDRINUSE` as an uncaught-exception stack trace (after the fleet WARN), not a one-line "port in
   use". The README warns about the taken port, which helped, but the message a stranger sees is a trace.
   Found by: starting on 7790 as instructed.
3. **`/api/runs?run=demo` returns every run**, not just the one (the README names `#/runs?run=<id>` for the
   page, the API ignores the query). `/api/runs/demo` is a 404 without a hint of the right URL. Found by:
   curl of both. Minor, only matters to a script author.
4. **The README quick start `npm test` is long and unannounced** (3000+ tests); no time hint before a
   stranger waits on it. Not run this round; noted from the test count in the task text.
5. **`laneboard run --post` needs `--run` before the subcommand to work, easy to miss**: `--run` after
   `--post` worked, but `run score --name x` without `--value` prints a clean error, while `run start`
   with no `--run` and no `$LANEBOARD_RUN` was not tried; the help says "defaults to the run part of
   $LANEBOARD_RUN" but `start` is the command that creates it, so which id it picks is unstated.
