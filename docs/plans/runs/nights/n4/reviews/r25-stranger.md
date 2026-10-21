# Review, stranger, round 25

Walked README as written: server on :7790 with the five test variables, `curl` on the views and APIs,
`laneboard ls`, and the run protocol (`run --post start/round/score/needs`). No browser tool, so no
visual check of the light theme (T12) or tokens.css v2 (T11). Every CSS file the page links answers 200,
no broken relative links in README or docs.

1. **Light theme and Night tokens unverified.** Without a browser I could not look at the new look; only
   the stylesheet URLs were checked. Found by: no browser tool installed.
2. **`GET /api/runs?run=r1` ignores the query and returns every run.** The README says the page is
   `#/runs?run=<id>` and the docs say `/api/runs/<run>`; a stranger who guesses the query form on the API
   gets the whole list with 200, not an error. Found by: curl.
3. **`rounds` vs `maxRounds` in the runs row.** After `start --rounds 5` and one round the row has
   `"rounds":1,"maxRounds":5`; the `start` flag is called `--rounds`, the field it sets is `maxRounds`, and
   `rounds` means rounds done. Easy to misread. Found by: reading `/api/runs` after the CLI calls.
4. **`/api/box` and `/api/audit` are 404.** The README lists Box and Audit views but not where their
   data comes from; I guessed these paths from the view names. Not a bug, but nothing in the README says
   which API a view uses. Found by: curl loop over the view names.
5. **CLI `run --post` needs no `--run` after `start` only when `$LANEBOARD_RUN` is set.** `start` printed
   nothing and `round` printed `export LANEBOARD_RUN=r1/1`; I passed `--run` each time, so the
   export hint was never tested by me. Minor. Found by: `laneboard run --help`.
6. **`laneboard ls` against the copy shows this machine's real session** (`loop working`). The README
   says so; stated here only because it is the first thing a stranger sees and looks like a leak.
   Found by: running `laneboard ls`.
