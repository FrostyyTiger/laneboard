# Review r13, the stranger

Walk: README, board on port 7790 (in-memory, empty config, temp state dir), CLI, and the run protocol
(T1–T6: `run start/round/score/needs/ack`) posted with `--post`. No browser tool; views checked by `curl` only.
The server started, `/` and the run API answered, nothing crashed.

1. **`laneboard run <sub>` writes `./.laneboard/run.jsonl` in the current directory by default, silently.**
   Found by running `run ack demo 99` without `--post` from the checkout: an untracked `.laneboard/` appeared in
   `git status`. `.gitignore` lacks `.laneboard/`, and the README's test-copy section says the copy touches
   nothing real, yet the CLI line right under it writes into the cwd. Say so in README's CLI block, or
   ignore `.laneboard/` in `.gitignore`.
2. **Every `run` subcommand prints nothing on success.** `ack`, `needs`, `score`, `start` give no echo (only
   `round` prints). I could not tell whether a line was appended, posted or skipped without reading the file.
   A one-line `appended to <file>` / `posted` would remove the guessing.
3. **`run ack` is accepted with no hint that it did nothing.** `ack demo 99` (no such need) is appended and
   exits 0; `ack 0 --by loop` on a `fence` need is accepted and the need stays open, with no message.
   Both are documented in docs/runs.md, but only after a long table cell; the CLI could warn on a
   `--by` other than `inbox`/`run page`/`owner`, and `--by` is optional so a bare `ack 0` on a fence need
   also does nothing.
4. **README names no API paths, and guessable ones 404.** `/api/health`, `/api/sessions`, `/api/box`,
   `/api/audit`, `/api/inbox` return 404 (`/api/runs`, `/api/map`, `/api/morning`, `/api/credit`,
   `/api/packages` work). A stranger using `curl` as the review brief suggests has no list of what to
   fetch; the views are client-side routes (`#/…` never reaches the server).
5. **`laneboard bogus` prints the full help and exits 2**; fine, but `laneboard --help` exits 0 and looks
   identical, so the error is easy to miss in a script log. Minor.
6. **README: "All five variables are needed" comes after a command that sets them, in prose.** Harmless;
   the paragraph reads as a correction of the block above it. Minor.
7. **`laneboard ls` on the test copy shows my own agent session (`loop`)**, as README says it would. Worth
   knowing it is not a bug; fine.

Not tested: the browser views, `launch`/`retire`, fleet mode (needs a second machine).
