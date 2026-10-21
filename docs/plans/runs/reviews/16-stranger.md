# Stranger review, round 16

Walk: README, a copy on a free port (7793), all views by curl, then the `laneboard run` CLI incl. the new `run cost`.

1. **The README's own test port can already be taken, and the copy exits quietly.** The task's port 7790 had a
   board on it; my copy logged `port 7790 is taken` to its log file, and `curl` kept answering 200 from the other
   board (`/api/runs` was empty, which looked like "fresh"). The README warns about this, but the
   check (`ss -ltn`) is only a prose hint; a stranger who backgrounds the server never sees the error.
   A one-line `ss -ltn | grep :7788` in the snippet would catch it.
2. **`run start --rounds 3` shows up as `"rounds":1,"maxRounds":3` in `/api/runs`.** `rounds` is the count so far
   and `maxRounds` the limit; the CLI flag `--rounds N` on `start` means the limit, on `stop` the count done.
   Same flag, two meanings (found by reading `GET /api/runs` after the demo).
3. **The run id is inherited from `$LANEBOARD_RUN` silently.** After `eval "$(laneboard run round …)"` a later
   `laneboard run start` (no `--run`) reused `r1` and appended a second `run.start` to the file. Documented in
   `--help` ("defaults to the run part of $LANEBOARD_RUN") but nothing is printed that says which env it used.
4. **`run cost` vs round `--usd`.** I posted `cost --usd 1.5` and `round --end --usd 0.5`; the run's cost is 1.5
   (`from: "cost"`), the 0.5 is ignored. Matches the help text, but easy to read as a bug: no hint at the
   moment of posting that the round usd was not counted.
5. **Second `ack` says "need 0 already acked, nothing posted" with exit 0**, while the first printed only
   `needs.ack posted`; the ref `0` is a place, and after the ack the need disappears from `needs: []`, so
   "need 0" is no longer something one can see. Minor.
6. **`laneboard ls` against the copy lists the machine's real sessions** (here the loop itself). README says so;
   only noted because it is the first thing a stranger sees and looks like the copy is not isolated.

No broken view: map, board, inbox, packages, morning, runs, credit, box, audit, diff all returned 200.
No browser tool was used; only curl.
