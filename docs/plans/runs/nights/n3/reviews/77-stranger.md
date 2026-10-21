# Stranger review, round 77

Walk: README, `node server/index.mjs` on a test port, `curl` of the API, the CLI (`ls`, `morning`,
`credit`, `run …`), `git log -15`. No browser tool on this machine, so no view was looked at; the
T37–T42 UI changes (Morning layout, since line, run title link, header spend) are unchecked here.

1. **The port in the task's own command line was taken, and the failure is easy to miss.**
   Found by starting the documented copy on 7790, then on 7795: both died with `EADDRINUSE`
   (only visible in the log, I had sent the output to a file). My `curl` kept answering, from
   *another* board (one had a run `demo`, one an `acme-search` demo run), so I read someone else's
   data for a minute as if it were mine. README does say "pick a port nothing listens on", but a
   stranger who copies `7788` verbatim and sees JSON back will not notice. Suggest: the copy's
   `curl` examples should check `curl /api/runs` shows an empty list first, or the README says the
   response of a taken port is another board's.
2. **CLI `morning` still prints the long date and 3-decimal money.** `laneboard morning` header:
   `since 20/10/2026, 18:00:00` (bin/laneboard:340, en-GB `toLocaleString`), while T41 made the web
   view say a short `20 Oct 18:00`. `laneboard ls`/`morning`/`credit` print `$0.100`
   (bin/laneboard:174, `toFixed(3)` under $1) while T39 made the web UI use 2 decimals ("$0.00").
   Same number, two spellings across CLI and page. Low.
3. **`laneboard morning` shows "Needs you (0)  (nothing)" with an open decision.** I posted a run
   with `needs --kind decision --text "Drop v1?"` and a stop; `/api/runs` lists the need as open,
   the CLI morning says nothing needs me. Maybe by design (run needs are on the Runs view, not
   Morning); if so the Morning section or docs/runs.md should say where they appear. Not verified
   which.
4. **`run round --end --usd 1.2345` leaves the run's cost at `$0`** (`cost:{usd:0,rounds:0}`).
   Documented in docs/runs.md ("fills that round's usd but leaves the run's cost at 0"), but the
   CLI's help line for `round --end` lists `--usd x` with no hint, and the README's CLI block
   promises a run "works offline" with cost shown. A stranger will think the flag is broken. Add
   "(round only; the run total comes from `cost`)" to `laneboard run --help`.
5. **`run start --help` is rejected** (`unexpected argument: "--help"`); only `run --help` works.
   Minor, the error does point to `laneboard run --help`.
6. **Row for the real session shows `branch -` and `MERGED ?`** for `laneboard-work` in
   `morning`/`ls` even though the cwd is a git worktree on `run/runs-n3` (the first server
   run, on port 7790, showed the branch). The second, isolated copy showed `-`. Cause unknown
   (maybe `LANEBOARD_CONFIG=/dev/null` plus no `repos`, so lanes are not detected). Low; README
   says "a board of every session and every worktree" with no config.
