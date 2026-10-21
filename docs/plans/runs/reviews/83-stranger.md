# Stranger review, round 83

Walk: README only, then `node server/index.mjs` on :7790 (memory db, `/dev/null` config, temp state dir),
`curl` on the views, the CLI against it. No browser run: `$CHROME` is unset, so no view was looked at and the
T52/T54/T55 visuals are unchecked here.

Nothing broke. Small stumbles, worst first:

1. **`--post` takes no URL, and the error does not say so.** I wrote `laneboard run start --post http://127.0.0.1:7790`
   (the server is reached through `LANEBOARD_URL`, but `--post <url>` reads naturally, and `feed --push <url>` does
   take one). Answer: `unexpected argument: "http://…"`, `see: laneboard run --help`. It names the stray word
   but not that `--post` is a flag. A hint such as "`--post` takes no value; the board is `$LANEBOARD_URL`" would
   save the detour. Found by running it.
2. **`run start` without `--post` against a running board shows nothing on `#/runs`.** `GET /api/runs` stays
   `{"runs":[]}` after `laneboard run start` (it went to `./.laneboard/run.jsonl`). README and docs/runs.md say
   so, but the README's own test-copy block points the CLI at the copy with `LANEBOARD_URL`, which suggests
   everything goes there. The stderr `ok … appended to <file>` is the only clue. Found by running it.
3. **`run stop --reason stuck` is accepted and `stuck` is not in the reason list** (`done|deadline|rounds|budget|
   no-progress|error|human|…`). The trailing `…` hides whether free text is allowed. Found while trying a run.
4. **`run round` prints `export LANEBOARD_RUN=demo/1` on stdout** when run by hand. Documented (stdout is for
   `eval`), but a stranger sees a line that looks like it did nothing. Found by running it.
5. **`/api/board` is 404** (`{"error":"not found","path":"/api/board"}`). The README table maps Board to
   `/api/state`, so it is documented, but the view is called Board and I guessed first. The 404 could name the
   routes. Found with `curl`.
6. `morning` with the clock at 00:40 local says `since 2026-10-21 10:40` for "tonight"; the window start is
   12 h back, which the README does not say for `tonight`. Found by running `laneboard morning`.
7. `fleet pubkey` with no key prints the real home path (`~/.config/laneboard/hub.key`) even with a temp
   state dir; README warns about it, so only noted.

Checked, fine: install files present, start WARN as documented, `ls`, `credit` (T49 line shown), `audit verify`,
`launch` with no repo (T58 hint reads well), `peek`/`retire` unknown names, `feed` usage, `/api/morning` 400
on a bad window via CLI, run events via `--post` giving `/api/runs` and `/api/runs/<id>`, 404 on an unknown run.
