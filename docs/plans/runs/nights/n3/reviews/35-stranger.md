# Review, round 35: the stranger

Walk: README only, then `docs/runs.md` and `docs/map.md` for the new run parts. Server started from
the checkout, API and CLI driven with `curl` and `laneboard run --post`. No browser tool was
installed, so the views were not looked at (every `#/<view>` returns the same static page, which
proves nothing about the view).

1. **The given port was taken and the short form hides it.** Started with the short form
   (`LANEBOARD_PORT=7790 LANEBOARD_DB=:memory: LANEBOARD_CONFIG=/dev/null`): a raw `EADDRINUSE`
   `uncaughtException` trace in the log, while `curl :7790` happily answered from another board
   (a `demo` run, another machine's map title). A stranger who backgrounds the server and curls
   would think theirs runs and read foreign data. The README warns, but a one-line "port 7790 is
   taken, pick another" instead of a stack trace would do. Found by: running the short form first.

2. **Two recipes of different safety.** "Run it" says `node server/index.mjs` (real state); 40 lines
   later the README says all five variables are needed for a test copy. Easy to take the first.
   Found by: reading top to bottom.

3. **`round --end --usd` leaves the run's cost at 0.** Documented in docs/runs.md (~line 119), but
   surprising: after `laneboard run round --n 1 --end --usd 0.5`, `GET /api/runs` shows
   `cost: {usd: 0, rounds: 0}` while `/api/runs/<id>` shows the round at `usd: 0.5`. The CLI help
   has no `cost` subcommand, so the CLI cannot feed the run total at all as far as `--help` says.
   Found by: running the CLI and comparing list and detail.

4. **`laneboard run round --n 1` prints `export LANEBOARD_RUN=...`** and `--help` does not say it
   must be `eval`ed; without that the following `score` has no run. Found by: following the help
   literally.

5. **Guessable API paths 404**: `/api/inbox`, `/api/board`, `/api/box`, `/api/audit`, `/api/health`,
   while the views of those names exist. The README lists no endpoints; `/healthz` exists and is
   not mentioned. Found by: `curl` on each view name.

6. **No-config map names the core and builder after the host** (`run-runs-n1`). docs/map.md does not
   say what the no-config map shows. Harmless. Found by: `curl /api/map`.

7. **Same limit, two names**: `maxRounds` in the `/api/runs` list, `budget.rounds` in
   `/api/runs/<id>`. Minor. Found by: reading both bodies.

Works as documented: `start`, `round`, `score`, `needs`, `ack`, `artifact` via `--post`; the run
appears in `/api/runs` with its deadline, score, ack'd need and artifact count, and as a
`run:<id>` node (kind `run`, status `working`) in `/api/map`. Not checked (no browser): the progress
ring (T10) and Find/⌘K reaching run nodes (T11).
