# Stranger review, round 34

Walk: README top to bottom, server on a free port, `curl` on every API row, the CLI, the run protocol. No browser tool, so the pages were not looked at.

1. **README's test port is taken on a shared box.** `LANEBOARD_PORT=7790` (the value the task, and the README's `7788`, suggest) was in use. The copy logs `ERROR … port 7790 is taken` and exits, while every `curl` still answers 200 from the other board. I read its data (`/api/map` title `run-runs-n1`, a bigger node list) as mine until I looked at the log. The README warns about this, but the failure is silent for anyone who starts it in the background. Suggest the copy's log line says which board answers (pid/title), or the README tells you to `curl /healthz` and compare the pid.
2. **`laneboard run needs ack demo 0` fails with `unexpected argument: "demo"`.** I guessed `needs ack`; the help lists `ack` as its own subcommand (`run ack [<run>] <ref>`). The error does not point at `ack`. Suggest naming the close match, as the top-level unknown command already does.
3. **`/api/box` and `/api/audit` are 404.** I guessed them from the view names. The README maps Box to `/api/v1/health?history=1` and Audit to `/api/v1/audit`, which work. The 404 body lists no hint. Low.
4. **`laneboard ls` / `morning` / `credit` print `board: <url>` first.** On a plain run the stderr line is fine. When `LANEBOARD_URL` is unset in a fresh shell the error says `Is it running?  laneboardctl status`, but README's CLI section never mentions `laneboardctl`, only docs/install.md does. Low.
5. **`run artifact` with the default kind does not appear in `prs`.** After `run artifact --url … --title t` the run list shows `"artifacts":1,"prs":[]`. The help says `--kind pr|link|…` but not what the default is. Low.
6. **`pkill -f "node server/index.mjs"`**, the obvious way to stop the copy, kills every board on the box, other rounds' included. README says to use Ctrl-C, which does not work for a backgrounded copy. Suggest printing the pid or saying `kill $!`.

Checked, fine: install steps match (6 dependencies, Node 24), `/api/health` and `/healthz`, the morning `400` for a bad window, the unknown-command help, exit codes, `/api/runs` after a posted start/round/score/needs/ack.
