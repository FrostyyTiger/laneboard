# Stranger review, round 58

Walk: README as written, test copy with the five variables, CLI `run` subcommands against it
(`--post` and `--file`), the views and run API with curl. No browser tool used, so the views were
checked for HTTP 200 only, not looked at.

1. **A taken port answers as if it were my copy.** The job text says port 7790; something already
   listened there. The copy exited (`ERROR ... port 7790 is taken`, only in its log, which I
   had sent to a file), and my `curl`s to 7790 still returned 200 with another board's data
   (`/api/runs` was `{"runs":[]}`). Nothing in the response says whose board it is. The README
   warns about this and says to check `ss -ltn`, but the failure is silent unless you read the
   log. Found by: `ss -ltn | grep -c 7790` printed 1 after the fact. Idea: have `/healthz` or
   `/api/version` return the pid/state dir so a stranger can tell the copy from the real board.
2. **`needs` takes only flags; a positional text is rejected.** `laneboard run needs "need a thing"`
   → `unexpected argument: "need a thing"`. `--help` shows `[--text t]`, so it is documented, but
   `score`/`artifact`/`needs` all read like they take a bare value, and the error does not
   say "did you mean --text". Found by: typing it the natural way.
3. **`run ack` on an already-acked need says `ok ... needs.ack posted`.** Acking need 0 twice
   gave two `ok` lines and rc 0; the second changed nothing. A missing ref is correctly
   rejected (`no need 99 ... nothing posted`, rc 1), so the already-closed case stands out as
   the only silent one. Found by: running `ack 0 --post` twice.
4. **`run start` with no `--run` and no `$LANEBOARD_RUN` fails, with no hint about a name.**
   `--run is required (or set LANEBOARD_RUN)` is clear, but `start` is the one subcommand where
   the user is choosing the id, and `--goal` is the flag they reach for first. Minor. Found by:
   `run start --goal x` with an empty environment; `--id demo` is also rejected.
5. **`run round --n 1` prints `export LANEBOARD_RUN=demo/1` and nothing else useful when run
   directly.** It only helps under `eval "$(...)"`; the usage line says "prints: export ..."
   but not that it must be eval'd. Found by: running it bare, then needing the `eval` form.

Worked as documented: `run start/round/score/needs/ack/artifact/stop` with `--post` and `--file`,
the run showing `stopped`, `done`, score 3→5, one PR, no open needs; bad `--value` and unknown flags
exit 2 with a usage pointer; the audit-dir and 7788-style recipe started cleanly on a free port
(7795); `ls`, `morning` and `credit` ran against it.
