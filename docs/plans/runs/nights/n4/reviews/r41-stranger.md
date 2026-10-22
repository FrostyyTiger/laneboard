# Review r41, the stranger

Walked README.md: `node server/index.mjs` on a scratch copy (all five env vars, port 7795),
curl on every view and API, the CLI against the copy, the run protocol with `--post`.
No browser installed, so no view was looked at, only fetched. Worst first.

1. **The port the round was told to use was taken.** `LANEBOARD_PORT=7790` exited with
   `port 7790 is taken`, yet every `curl` on 7790 returned 200 from the board already
   there, so a stranger who starts it in the background and does not read the log believes
   the copy works. Found by reading the log after `curl` answered 200 for all views.
2. **`laneboard` commands use the real board unless `LANEBOARD_URL` is exported in the same
   shell.** In a new shell I got "cannot reach 7777". With a real board on 7777 it would
   have read or written there. `ls`, `morning` and `credit` print no line saying which URL
   answered.
3. **An inherited `LANEBOARD_RUN` silently decides the run.** `laneboard run start --goal demo
   --post` printed `ok runs-n4 run.start posted`: the run id came from the environment, not
   from me. A stranger testing in a shell of a running loop writes into that loop's run.
   `start` is the one subcommand where a fresh id is expected.
4. **`run ack 0 --post` warns about `--by` and still posts.** The warning ("a fence need
   closes only with --by ...") shows for a need that is not a fence need, with no hint it
   is advisory. `ack 3` on a run with no need 3 returns rc=0 and "kept raw": a typo in the
   ref looks like success.
5. **Unknown values are accepted quietly.** `/api/morning?window=bogus` returns the `tonight`
   window with HTTP 200, and `/nope` returns the page HTML with 200 while `/api/inbox` is a
   404. The README table never says where the Inbox or Audit data comes from, so probing
   the API is guesswork (`/api/inbox`, `/api/audit` are 404).
6. **A score posted before any round lands on `n: 0`, run `round: null`.** `docs/runs.md`
   does not say a score without `--n` goes to round 0.
7. **`laneboard ls` on a fresh copy lists the machine's real sessions** (here `loop`).
   README documents it; still the first thing a stranger sees after "a clean copy".

Not checked: any view in a browser, fleet/hub mode, the Map feed, launch/retire.
