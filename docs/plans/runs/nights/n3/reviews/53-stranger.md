# Stranger review, round 53

Walk: README only, then CLI and HTTP on a copy. No browser tool installed, so views were checked with `curl` and the CLI only.

1. **The README's test port is taken again, and nothing says so on screen.** `LANEBOARD_PORT=7790` is the port the task and README suggest. Another board was already listening there. My copy died with `EADDRINUSE` (only in the log file I had redirected), and `curl :7790` answered 200 from the other board, with a `demo` run that was not mine. Same stumble as round 45, item 1, still open. Suggest: print "port 7790 taken, not started" to stderr and exit non-zero, and make the README example pick a free port.
2. **`#/runs/<id>` (new, T24) is not in any doc.** README and docs/runs.md and docs/map.md only name `#/runs?run=<id>`. Found by `grep -rn "#/runs/"`: it is only in the router comment. The server returns the same 11852-byte page for any hash, so `curl` cannot tell whether a route works. An unknown view toasts, but that is only visible in a browser, which I did not have. Not verified.
3. **No browser tool: every view added since round 45 (T19 to T24, all layout) is unchecked.** The README does not say how to take a screenshot or run a headless check.
4. **`/api/health` is 404 (42 bytes), as in round 45, item 5.** `/api/runs` works, but there is no list of read endpoints, so I guessed.
5. **`laneboard run --run a --post start` needs the global flags before `<sub>`.** It works, but `--help` shows them in the "every subcommand" block after the subcommand lines, so I tried them last first. Minor.
6. **`laneboard run --post` with `LANEBOARD_URL` set worked, and the README's "works offline" line is true.** Not a stumble. The one gap: `--post` does not print what the server accepted, so I had to `curl /api/runs` to see my run appear.

Not verified: `npm ci` from scratch (node_modules already present). Items 2 to 6 of round 45 (pause with the copy's state dir, `launch` error, morning UUIDs, credit sampler) I did not retest.
