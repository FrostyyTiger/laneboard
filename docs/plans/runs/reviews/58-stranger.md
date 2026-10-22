# Stranger review, round 58

Walk: README, `node server/index.mjs` on :7790 with the README's temp-dir variables, `curl` of every
API in the README table, then the `laneboard run` subcommands against it (T31–T36 area). No browser
tool; the page itself was only fetched (200, `/js/app.js`).

1. **`run ack` without `--post` writes a file even when a board is named, and its checks mix the two.**
   Found: `LANEBOARD_URL` set, `laneboard run ack demo 0` printed `appended to ./.laneboard/run.jsonl`,
   the same again printed `appended` (the help promises "already acked: nothing sent, exit 0"), yet
   `ack demo 5` answered `no need 5 in run demo on http://127.0.0.1:7790`, so it asked the server
   for the check but wrote to a file. The need stayed open on the server. It also left
   `/tmp/.laneboard/` behind in my cwd. Say in the output that the ack went to a file and the board did not see it, or default `ack` to the server when `LANEBOARD_URL` is set.
2. **Guessing `--id` is a dead end.** The README says "run id", the flag is `--run`. The error
   `unexpected argument: "--id"` does not name `--run`. Eight lines of the same error in a row on a
   scripted walk. A "did you mean --run" like the one for commands would do.
3. **A second `artifact` line with `--kind pr` for a URL first sent as `link` stays `link`.** Sent
   the URL bare, then with `--kind pr`: `artifacts` 1, `prs` `[]`. The doc says later lines update
   `state` and `title` only, so it is documented, but nothing at the CLI says "kept as link". A
   stranger who forgot `--kind pr` the first time has no way to fix it short of a new run.
4. **`run stop` with no `--reason` reports `stop: "unknown"`** in `/api/runs`. Not an error, not
   in `run --help` as the default.
5. **`cost` is `{"usd":2.5,"rounds":0,"from":"rounds"}` for a run with one counted round**
   (`counted:1`). `rounds:0` next to `from:"rounds"` reads as a bug; docs/runs.md does not say what `cost.rounds` counts.
6. **`/api/map` titles the board with the host name** (`run-runs-n1` here, not what I configured, since
   I gave no config). A stranger with `LANEBOARD_CONFIG=/dev/null` sees a machine name they did not
   choose; fine for them, but it is the first thing in the Map and is not mentioned in README.
7. **`run start` prints `run id runs-n5 from $LANEBOARD_RUN`** on stderr; correct, but it fired in my
   shell only because the loop had exported the variable. A stranger who exported it once in a
   profile would write into the wrong run silently on every other subcommand (only `start` says so).

Worked as written: every README API path answered (400 on `window=3d` names the valid ones), the
temp-dir copy started clean, `--max-rounds` with `--rounds` gives exit 2 and the new text,
`needs` with no text exits 2 with `needs: give the text`, `artifact --help` names the default kind,
an unknown command suggests `job` for `foo` (a loose match).
