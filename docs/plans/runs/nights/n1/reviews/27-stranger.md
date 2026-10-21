# Stranger review, round 27

Walk: README as written (copy on port 7788 with the isolated env from "Configure it"; 7790 was taken on this
machine), the `laneboard run` CLI with `--post` and with a file, `curl` on `/api/runs`, `/api/runs/<id>`,
`POST /api/runs/events`, `laneboard ls|morning`. No browser tool, so `#/runs` and the run page were not
looked at; only the shell page and the API answers were checked.

1. **A run's cost is still 0 when the loop sends only `round.end --usd`.** `run round --end --usd 1.2 --post`
   gives the round `usd:1.2` in `GET /api/runs/demo`, yet the run's `cost` is `{"usd":0,"rounds":0}` there and
   in `GET /api/runs`. Already raised in round 20 (item 2), unchanged. runs.md says `round.end` `usd` "adds to
   the round's cost" and the run cost is the sum of `cost` events; a reader sees a run that cost nothing next
   to a round that cost $1.20. Sum both, or say so in the `round.end` row and in the CLI's `--usd` help.
   Found by: curl of `/api/runs/demo` after `run round --end --usd 1.2`.
2. **`laneboard` is not on the PATH after the README's "Run it".** Every CLI example in README (`laneboard ls`,
   `laneboard run ...`) needs the command, but the `ln -s ... ~/.local/bin/laneboard` step is only in
   install.md line 39, inside the service section. A stranger doing `npm ci && node server/index.mjs` gets
   `command not found`. Put the symlink (or `node bin/laneboard`) in README next to the CLI block.
   Found by: reading where `laneboard` comes from after `bin/laneboard` had to be called by full path.
3. **Every successful `laneboard run` call is silent (rc 0, no output)**, round 20 item 5, unchanged. With no
   `--post`, `run start --run local` in a directory that is not a lane writes `.laneboard/run.jsonl` and
   `/api/runs` does not list it (`grep -c '"run":"local"'` gave 0). docs/runs.md now warns about that in prose,
   but the CLI itself says nothing. One stderr line such as `wrote .laneboard/run.jsonl (not a lane: laneboard
   will not see it, see runs.files)` would save the search.
   Found by: `run start` in a fresh temp dir, then `curl /api/runs`.
4. **`laneboard run --help` shows `--run <id>` as required** in the usage line (`run <sub> --run <id>`) while the
   last line says it defaults to `$LANEBOARD_RUN`. Same help text is printed in full on a bad value
   (`--value abc`), burying the one-line error `laneboard: --value needs a number, got "abc"` above 9 lines.
   Found by: `run --help` and `run score --value abc`.
5. **`morning` header reads "Morning — tonight (since 20/10/2026, 08:09:08)"** at 22:09 on the same day: "tonight"
   starting at 08:09 in the morning is odd, and the date format (dd/mm/yyyy) differs from the ISO dates in every
   doc. Found by: `laneboard morning | head`.
6. Minor: `curl /api/runs/nope` answers `{"error":"unknown run"}` and `POST /api/runs/events` without the
   `x-laneboard` header answers 403 `no-csrf-header`; runs.md names the header in one sentence but gives no
   `curl` example with it, so a `curl -d` try fails first. Found by: the bare `curl -X POST`.
