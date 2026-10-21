# Stranger review, round 33

Walk: README as written (copy with the isolated env from "Configure it"; 7790 was taken on this machine, so
7791), `laneboard run` with `--post` (start, round, `eval` of the export, score, round --end, needs, stop),
`curl` on `/api/runs`, `/api/runs/demo`, bad CLI arguments. No browser tool: the views were not looked at,
only the shell page (200) and the API answers.

1. **The `laneboard` on the PATH is not the checkout you are reading.** `laneboard run --help` said
   `unknown command: run`: `~/.local/bin/laneboard` resolved to another copy of the repo, older than the docs.
   README's CLI block and runs.md both use bare `laneboard`, and nothing says which `laneboard` that is or
   how to check (`readlink -f $(command -v laneboard)`). Also still open from round 27 item 2: README never
   says how `laneboard` gets on the PATH (install.md line 39 only). Say `node bin/laneboard` for a checkout.
   Found by: `laneboard run --help` right after starting the copy.
2. **README's CLI list has no `laneboard run`.** The Runs row of the view table links runs.md, but the CLI
   block (`ls`, `peek`, ... `fleet`) omits it, and `laneboard --help` omits it too (only `run --help` knows).
   A stranger who wants to feed the Runs view finds the CLI only by reading runs.md.
   Found by: reading the README CLI block, then `laneboard --help`.
3. **The README's "free port" advice failed silently the first time.** With 7790 taken, the server logged
   `EADDRINUSE` and exited in the background while `curl` still got 200 from whatever else listened there
   (an unrelated laneboard), so the first checks looked fine against the wrong server. The README says
   "pick a port nothing listens on" but the suggested test command in the task text uses 7790; README itself
   uses 7788. Not a laneboard bug, but the server could print `port 7790 in use` as one line rather than a
   stack trace.
   Found by: `ss -ltn`, and `laneboard ls` showing sessions of the machine instead of an empty board.
4. **`run start --post` is silent on success** (rc 0, no output), same as rounds 20 and 27. The same for
   `score`, `needs`, `stop`. Only a failure speaks. One line (`posted score tests=0.5 to demo`) would confirm
   it reached the server. Without `--post`, outside a lane, the file is written and the run never shows (see
   runs.md "only sees the file if..."), still no warning from the CLI.
   Found by: five `run ... --post` calls with empty output, checked by `curl /api/runs`.
5. **`needs` was attached to round 1 after the round had ended.** After `round --end` the run still treats
   n=1 as the latest round, so `needs` and `score` calls with no `--n` land there; fine, but runs.md says "the
   latest round started" only for `score`, not for `needs`. Minor.
   Found by: `needs` in `/api/runs` showing `"n":1`.
6. **Raw `curl -X POST /api/runs/events` answers `403 {"error":"forbidden","reason":"no-csrf-header"}`**
   without naming the header. runs.md says "the CLI sends the `x-laneboard` header" but not what value; a
   stranger posting from another language has to read the server code.
   Found by: the curl POST.

Not checked: browser views, the run page, a fleet. Test server's temp dir under /tmp was not removed (the
removal was denied by the sandbox check); it holds only the copy's audit log.
