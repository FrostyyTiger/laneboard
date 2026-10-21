# Stranger, round 69

Walk: README as written, a copy on 7791 (7790 is taken by the loop's own board), every `#/` view and the
JSON endpoints with `curl`, `laneboard run` and `laneboard morning` against it. No browser tool, so the
views were not looked at, only that they answer 200.

1. **`laneboard run` without `--post` drops `./.laneboard/run.jsonl` into the current directory, silently.**
   From a checkout it leaves an untracked `.laneboard/` in `git status`, and a stranger who pointed
   `LANEBOARD_URL` at a test copy expects the line to reach it; `run start` prints nothing and `/api/runs`
   stays `{"runs":[]}`. The README says the CLI "talks to" the server and says nothing of `run` being
   file-first. Found by: `run start --run demo` then `git status`, `/api/runs`. Fix: print the file written
   (or "wrote ./.laneboard/run.jsonl, use --post to send") and mention it in the README CLI line.
2. **Run cost is still unreachable from the CLI** (round 61 item 1, unchanged). `run round --end --usd 1.5`
   exits 0, `/api/runs` shows `"cost":{"usd":0,"rounds":0}`; `--help` has no `cost` subcommand.
3. **`run round --run demo --end` without `--n` fails with "round needs --n"**, but the help lists `--n N`
   only on the first `round` form; the `--end` form reads as if `--n` is optional. Minor.
4. **JSON endpoint names don't follow the view names**: `/api/board`, `/api/inbox`, `/api/box`, `/api/audit`
   are 404 while `/api/runs`, `/api/packages`, `/api/credit`, `/api/map` exist. No doc lists the API paths a
   script author can use. Found by: curl of each view name under `/api/`.
5. **A double slash (`http://host:port//`) gives a bare 400** with no hint in the body. My typo, cost a minute.
6. Round 61's port-in-use stack trace and the `?run=` API behaviour were not re-tried.
