# Stranger review, round 14

Walk: README, docs/runs.md, a second copy on :7790 (`LANEBOARD_DB=:memory: LANEBOARD_CONFIG=/dev/null`), `laneboard run …` in a scratch dir, curl on `/`, `/api/runs`, `/api/state`. No browser tool, so the Runs view (`#/runs`) was not seen.

1. **The "second copy for testing" is not isolated (README, Configure it).** It says the copy touches neither the file nor the database. The first boot logged `ERROR fleet: the audit log could not be opened (AUDIT_LOCKED); every action is refused until it is fixed`. The copy opened the default `~/.local/state/laneboard/audit.jsonl`, where another laneboard already held the lock. A stranger who runs the documented command next to a real board sees an ERROR and a board that refuses every action, with no hint to set `LANEBOARD_AUDIT_FILE` / `LANEBOARD_STATE_DIR`. Fix the README command (add both) or make `:memory:` / `/dev/null` imply a temp state dir. Found by starting the copy as documented.

2. **Run files written by the CLI are invisible unless the directory is a lane or in `runs.files`.** I ran `laneboard run start/round/score/needs` in a scratch dir (default file `./.laneboard/run.jsonl`), and `/api/runs` stayed `{"runs":[]}`. The `Where runs write` section lists the three sources, but neither the CLI section nor the "smallest useful loop" says that a loop outside a lane needs `runs.files` or `--post`. Nothing warns at write time. Found by following docs/runs.md top to bottom.

3. **`--post` only works after the subcommand, and the error is misleading.** `laneboard run --post stop …` gives `unknown run subcommand: "--post"`. The usage line `laneboard run <sub> --run <id> [flags] [--file f | --post]` suggests the flags can go anywhere. The same goes for `--run` before `<sub>`. This is minor, but the usage text is the only help.

4. **A run made only of a posted `run.stop` is a hollow row.** After the `--post stop` I got `state:"stopped"`, `goal:null`, `rounds:0`, `startedAt` set. This is valid input and correct, but the Runs view has to cope with a run that has no `run.start`. Check `#/runs` with that row; I could not look at it.

5. **Every usage error prints the whole 9-line usage block**, including a plain bad value (`--value x`: the one-line error scrolls away above the block). Short error plus "see `laneboard run --help`" would read better.

6. **README does not mention Runs.** The view table and the `g …` key list have no Runs view or `g r`, even though `hotkeys.js` binds `g r` and `docs/runs.md` is linked. A reader of the README cannot learn that the view exists. docs/runs.md itself says the view "is being built", which is out of date now that `#/runs` serves 200 (the hash route was not rendered, only the shell was fetched).

7. Not a bug: `pkill -f server/index.mjs` was refused by the harness here, so the throwaway server was stopped another way. The README gives no "how to stop the test copy" line. Trivial.
