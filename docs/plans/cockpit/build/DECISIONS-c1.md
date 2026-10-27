# Cockpit build: decisions of the C1 night(s)

Choices a builder had to make that the spec (`docs/plans/cockpit/spec/`) does not cover. The spec's own
decisions stay in `spec/DECISIONS.md` (`D<n>`); these are `B<n>`, one line each:
`B<n> <choice> — because <why> — spec: <file §> — overrule: <what changes>`. Small and reversible only;
taste, one-way or security-relevant choices go to `build/PROGRESS.md` `## For the owner` instead.

## Decisions

- B0 (set up with the loop, not by a round) Board changes in fenced files are written as patches in
  `build/patches/`, never committed by a round; until the hub patch of `slices.md` §5.1 is applied,
  `runs` on a hub answers `Runs are not available on this hub yet.` and S-C3-03 runs against a single
  board — because the hub and the security core stay reviewed (`loop-build/fenced.txt`) — spec:
  `slices.md` §5.1 — overrule: unfence `server/hub/read-proxy.mjs` and `server/hub/routes/` for the night.
- B00 (set up with the loop, not by a round) The Wall's galaxy answers `show.result` `skipped` with three
  `why` values besides `in use`: `unsupported` (`compare`, `scrub` until the Show and History slices),
  `not drawn` (the node is not on this galaxy) and `bad-args`; the room's message checks accept all four
  — because the Wall merge built them (`docs/wall.md` "Show commands") — spec: `protocols.md` §4
  — overrule: map them onto `in use` in the room and keep the spec's single value.
- B1 (planner, round 1) T3 writes a first `server/boot/cockpit.mjs` whose `startRoom()` does only what the
  room under test needs to boot (the board as `builder.mjs` boots it, no cockpit routes); T6 completes it
  — because `stand-ins.md` §7 puts the room under test (step 3) before the room process (slices.md §3.1
  build 2), and the wrapper imports `startRoom()` unchanged — spec: `stand-ins.md` §1.1, §7 — overrule:
  swap T3 and T6.
- B2 (planner, round 1) A scenario whose `Test:` line names both node:test and Playwright (S-C3-04) is
  one Playwright test titled with its id; the node part is a `test.step` that calls the room (MCP by
  JSON-RPC) from the test process — because §2's rule is one test per id — spec: `slices.md` §2,
  `c3-see.md` S-C3-04 — overrule: a second test in `test/cockpit-<topic>.test.mjs` with the same id.
- B3 (planner, round 1) `demo-fleet.mjs --cockpit` and the `demo` script are built in T43, not with
  `stand-ins.md` §7 step 4 (T4/T5) — because the demo needs the room, the link and the pane of builds
  2-19 to answer `how did the night go` — spec: `stand-ins.md` §6, §7 — overrule: move them to T5.
- B4 (planner, round 1) A step §3.1 says runs with a later slice (S-C1-22's cards, S-C1-46's `show`,
  S-SCR-23's canvas strip) is written now as `test.step.skip('<step> — waits for <slice>', …)` — because
  the step's text stays in the test and its skip names what it waits for — spec: `slices.md` §3.1 —
  overrule: leave the step out until its slice.
- B5 (T1) The fake agent closes a message that ends in tool calls with `content_block_stop`,
  `message_delta`, `message_stop` right after the last call's `assistant` line (before its
  `tool_result`); a call that starts while another runs (`at` before the running one's `endAt`) joins
  the same message; the next block after a `tool_result` opens a new `message_start` without
  `user_message_uuids` — because §13.1 lists those three lines only at 7.95 (abridged elsewhere) and
  §11.4 maps them to nothing — spec: `protocols.md` §11.4, §13.1; `stand-ins.md` §2.3 — overrule:
  emit them only at the turn's end.
- B6 (T1) Every stdout line of the fake carries `session_id` and a fresh `uuid` (the replay keeps the
  prompt's uuid); `init` reports `claude_code_version` `0.0.0-fake` and a fixed tool list — because
  §11.4 says native lines carry both and leaves them out of the table — spec: `protocols.md` §11.4 —
  overrule: change `FAKE_VERSION`/`FAKE_TOOLS` in `fake-agent.mjs`.
- B7 (T1) The `user` `isReplay` echo is written as soon as a prompt's line is read, for every prompt —
  because the room always passes `--replay-user-messages` (§11.2) and §13.1 has it at 2.97 —
  spec: `protocols.md` §11.2, §13.1 — overrule: echo only when the flag is in `argv`.
- B8 (T1) Until T4: a stdin line read before `init` is handled at `init`; a prompt read during a turn
  waits for the turn's end (as `after-turn`); an interrupt is logged with `stillQueued`/`cancelled`
  `null` and changes nothing; a closed stdin logs `stdin-end` and exits 0 at once (Claude Code exits on
  a closed stdin) — because T1 builds §7 step 1 only — spec: `stand-ins.md` §2.4, §7;
  `protocols.md` §11.6 10.0 s row — overrule: T4 replaces the first three.
- B9 (T1) The `not-logged-in` end writes `api_retry` `authentication_failed`, then `result`
  `error_during_execution` with `errors:["authentication_failed"]`; `done` writes `num_turns` = the
  turn's assistant messages (§13.1: 2), `duration_ms` measured, `total_cost_usd` = `costUsd` or 0;
  `step-limit` writes `num_turns` = `--max-turns`; a turn with no `end` step ends `done` after its last
  step — because the spec leaves those values open (research Q10 pending for the login result) —
  spec: `stand-ins.md` §2.3 — overrule: change `endTurn()` in `fake-agent.mjs`.
- B10 (T1) "Built from those same rows" is one builder per §11.4 row (`native` in `fake-agent.mjs`),
  and `test/cockpit-fake-agent.test.mjs` holds every line the fake writes against its row's shape,
  read from `docs/cockpit/protocol.md` once the night made that copy (D136), else from the spec's
  `protocols.md`; a tool's `input` is compared as an object only — because a stand-in that parses
  markdown at run time is more to break than a test that fails on drift — spec: `stand-ins.md` §2.1 —
  overrule: have the fake read its templates from the protocol file.
- B11 (T1) The log helper is `fakeAgentLog(dir)` returning `prompts()`, `interrupts()`,
  `toolResults(tool?)`, `turnEnds()`, `signals()`, `starts()`, `loginChecks()`, `order(...kinds)` and
  `lines()`; `readFakeAgentLog(dir)` gives the parsed lines — because §2.6 names the functions, not how
  a test gets them — spec: `stand-ins.md` §2.6 — overrule: export plain functions taking `dir`.
