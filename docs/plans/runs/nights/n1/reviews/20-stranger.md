# Stranger review, round 20

Walk: README as written, `node server/index.mjs` with the test env, the `laneboard run` CLI with `--post`
against it, `curl` on `/api/runs` and the hash routes. No browser tool, so the views were only fetched
(`#/runs`, `#/runs?run=demo` return the shell; nothing rendered or checked).

1. **The "second copy for testing" is not isolated, and it can write into someone else's data.** README says it
   "touches neither the file nor the database". I ran it with the README env on port 7790:
   it logged `ERROR fleet: the audit log could not be opened (AUDIT_LOCKED); every action is refused`
   (the real audit log in the state dir, held by another running laneboard), then died with an `EADDRINUSE`
   stack. Another laneboard already listened on 7790, so my `laneboard run ... --post` calls (default
   `LANEBOARD_URL`) went to *that* server and wrote events into the real
   `~/.local/state/laneboard/runs/demo.jsonl`. Nothing told me my copy was not the one answering.
   Fixes to consider: add `LANEBOARD_STATE_DIR=$(mktemp -d)` to the test recipe (fixes the audit lock and stray
   run files); on `EADDRINUSE` print one line ("port 7790 is taken, is laneboard already running?") instead of a
   stack; say that `LANEBOARD_URL` must point the CLI at the test copy.
   Found by: reading the log after `sleep 3`, then noticing `/api/runs` answered for a server I had not started.
2. **Run cost is 0 although a round has cost.** `run round --end --usd 1.2 --post` shows `usd:1.2` on the
   round in `GET /api/runs/demo`, but the run's `cost` is `{"usd":0,"rounds":0}` there and in the list.
   runs.md says the run's cost is the sum of `cost` events, so it may be as designed, but a loop that sends only
   `round.end --usd` shows a run that cost nothing. Say so in the `round.end` row, or sum both.
   Found by: curl of `/api/runs/demo` after one round.
3. **README's view table and key line miss the Runs view** (`#/runs`, `g r`), the subject of the last eight
   commits. `grep -n runs README.md` finds only the docs link.
4. **runs.md status note is stale**: "The Runs view is being built" while `#/runs` and the run page exist
   (T7, T8, T11). No line says which URL shows a run or the score chart.
5. **Every `laneboard run` success is silent** (rc 0, no output). A typo in `--run` quietly creates a second
   run; a repeated `run start` quietly reopens a stopped one (the `demo` run had a `run.stop` and my
   `run.start` reopened it). A one-line `ok <run> <type>` on stderr would help.
6. Minor: `laneboard run --help` usage line shows `--run <id>` as required, the text below says it defaults to
   `$LANEBOARD_RUN`; `--file` and `--post` are not in the help, only in runs.md.

Not checked: rendering of the Runs list, run page and chart (no browser here).
Side effect of this walk: lines for run `demo` (round 1, a score, a need) were appended to the real state dir's
`runs/demo.jsonl` by finding 1; the owner may want to delete that file.
