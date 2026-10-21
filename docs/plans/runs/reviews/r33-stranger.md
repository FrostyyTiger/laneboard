# Stranger review, round 33

Walk: README "Run it" and the test-copy recipe, `curl` on `/`, `/api/*`, the CLI (`ls`, `morning`, `credit`,
`run --post start|round|score|stop`). No browser tool was installed, so no view was looked at; only HTML, JS, CSS
and the JSON were fetched. Worst first.

1. **The task's port was taken, and the copy's own message did not tell me.** `LANEBOARD_PORT=7790` was already
   listening (another board). Every `curl` on 7790 answered 200 with the other board's data, so for a moment I
   thought my copy was up. The only sign was one ERROR line in the copy's log. README says "pick a port nothing
   listens on" and explains it, but the log line could say which port to try or that the answer comes from
   another board. Found by reading the log after the curls looked fine.
2. **`AUDIT_UNSAFE_DIR` for a plain `mkdir -p /tmp/x` state dir.** A directory with mode 775 (the umask default
   here) makes every action refuse. The README recipe uses `mktemp -d` (mode 700) and works, but anyone who writes
   `LANEBOARD_STATE_DIR=/tmp/lb` by hand gets the board up, a startup ERROR, and refused actions. The log line is
   `the audit log could not be opened (AUDIT_UNSAFE_DIR)` without the reason (`audit.mjs:579` has it, the startup
   line drops it). README does not say the dir must be private. Found by creating the dir with `mkdir`.
3. **`laneboard run <sub> --help` is an error.** `laneboard run start --help` prints
   `unexpected argument: "--help"`; only `laneboard run --help` works. Found by trying it.
4. **A stopped run reports `cost: {usd: 0, rounds: 0}` next to `stop: {usd: 2, rounds: 1}`.** Run via
   `run --post stop --reason budget --rounds 1 --usd 2`. The list row and the page say $0 although the loop
   reported $2 (T17 moved the loop's usd into a label title). docs/runs.md does not say which one wins.
   Found in `/api/runs` and `/api/runs/demo`.
5. **`laneboard morning` shows a stopped run as nothing.** After one run was started, scored and stopped, Morning
   still said "Needs you (0)" and "Finished (1 lanes active)" listing only the working lane; the run is not
   there. May be intended (runs have their own view), but the README says Morning is "what finished".
6. **`curl /#/runs` is just the shell page.** The README lists `#/...` views as things to open with `curl`; a
   fragment is never sent, so every view returns the same 11 KB HTML. The data endpoints are not named in the
   README. Minor.

Not checked: the phone bar (T18), the Inbox and Board changes of T15/T16, the Run page label (T17); they need a
browser.
