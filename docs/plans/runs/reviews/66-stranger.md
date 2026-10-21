# Stranger review, round 66

Walk: README "Run it" copy on :7790 (in-memory db, /dev/null config, temp state dir), `curl` of `/`,
`/api/health`, `/api/runs`, then the CLI against it; the new T37–T42 behaviour. No browser tool, so the
views were not looked at. Everything in the README walk worked; the stumbles are small.

1. **`laneboard run round` on a run that was never started succeeds.** Found by typing `run start --id r1`
   (rejected, correctly, with "did you mean: --run"), then carrying on with `run round --run r1 --n 1`,
   `score`, `stop`: all printed `ok … appended`, rc 0, though `r1` has no `run.start` line. A stranger who
   mistyped the start never learns it. A one-line stderr note ("r1 has no run.start in this file") would do.
2. **`run start --budget 5` is rejected with no hint.** I guessed the flag from the board's "budget burn"
   column. The error is only `unexpected argument: "--budget"` and `see --help`. `--help` lists
   `--window-pct` and `--max-rounds` but never says how a budget is set (or that it is not a run flag).
3. **`run stop --reason bogus` is accepted and shown as the stop reason** (`"stop":"bogus"` in
   `/api/runs`). `--help` ends the list with `…`, so it is allowed, but a typo like `--reason dne` passes
   silently where `morning --window foo` now exits 2. Inconsistent, not wrong.
4. **`run ack` exit codes:** `ack r2 0` twice exits 0 both times ("already acked, nothing posted"); `ack r2 9`
   exits 1. Documented in `--help`, but a script cannot tell "acked now" from "was already acked".
5. **`laneboard credit` prints `sampler: 0 samples, last never`** with no word on what the sampler is or that
   it is expected on a fresh board; no pointer to a doc.

Checked and fine: T37 (`morning --window foo` exits 2 naming the windows), T38/T39 (README text matches the
startup WARN and log), T41 (`--id` and `--run-id` get "did you mean: --run"; `--idd` gets none), T40/T42
(`run --help` says no `--reason` records `unknown`; `ack` messages), `--post` flow, `audit verify`.
