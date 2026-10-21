# Stranger review, round 42

Walk: README, then a copy on :7790 (`:memory:`, `/dev/null` config, temp state dir), `curl` on the
APIs, and the `laneboard run` protocol (new since 34: `--max-rounds`, `--rounds` alias). No browser
tool, so the views were not looked at: this covers the API and the CLI only.

Worst first.

1. **`laneboard run needs --post` with no text is accepted.** I ran it with no text and no `--text`:
   `ok runs-n5 needs posted`, exit 0. Every other missing or bad value (`--value nope`,
   `--max-rounds abc`, unknown subcommand) gets exit 2 and a usage line, so this one is the odd one
   out. An empty need is a blank row in the Inbox that someone has to ack. It should be exit 2:
   "needs: give the text".
2. **`run start` with both `--max-rounds 5 --rounds 4` fails with `--rounds on start is --max-rounds:
   give one`.** Exit 2 is right, but the sentence reads as a statement, not a reason. Say "both
   --max-rounds and --rounds given; use --max-rounds". The single `--rounds 3` case prints
   `--rounds on start means --max-rounds` on stderr, and that one is clear.
3. **`run stop --rounds N` on a run with no rounds.** `stop --run r2 --reason rounds --rounds 3` on a
   run that never had a `round` event: `/api/runs` shows `"rounds":0` and `"round":null`, while
   `maxRounds` is 3 and the stop reason is `rounds`. A reader sees "stopped on the round cap" with
   zero rounds done. The `stop.rounds` value (7 in my r1 test, against `counted: 1`) exists only in
   `/api/runs/<id>`, and the list ignores it. Unclear which is the truth for a run that reports
   rounds only in `stop`. Probably fine for the loop, which always sends `round`; a stranger who
   reads docs/runs.md and tries the protocol by hand will hit it.
4. **`stop --usd 2` is silently overridden.** The run's cost stays `0.5` (`from: "rounds"`) while
   `stop.usd` is 2. Documented for `round --end --usd`, but nothing says that `stop --usd` loses to
   it. `cost.from` is a good hint; the CLI says only `ok r1 run.stop posted`.
5. **`/api/map` title is the host's session name** (`run-runs-n1`), not something neutral. With
   `LANEBOARD_CONFIG=/dev/null` I expected a generic title. Minor; it is not written in the README.
6. **The README test-copy recipe is long** (five variables, three paragraphs). It works, and the
   explanations are right, but a single `scripts/` helper or `npm run try` would stop the stranger
   from copying five lines. Not broken.

Not a laneboard bug: `pkill -f server/index.mjs` also matched my own shell, which is why the README
says "Ctrl-C in its terminal". A `kill <pid>` line from the log (`laneboard up, pid …`) would be
safer to suggest for a background copy.

Left behind: the temp state dir named in `/tmp/lbtmp` (I could not `rm` it).
