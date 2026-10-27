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
- B12 (T2) The fake speech's `clock` is any object with `now()`, `setTimeout(fn, ms)` and
  `clearTimeout(handle)` (real time by default, `realClock`); its log's `atMs` reads `clock.now()` —
  because §3.1 names a shared `testClock` before T3 defines `server/cockpit/clock.mjs` — spec:
  `stand-ins.md` §1.1, §3.1 — overrule: T3 shapes `clock.mjs`'s timers the same, or adapts here.
- B13 (T2) `startFakeSpeech({script})` and `use(script, id)` take a script name
  (`test/cockpit/scripts/<name>.json`, or `scriptsDir`) or the script object itself; the script is
  checked (kebab-case unique ids, known `fault`, numeric `at`) at load — because the C2 scripts are not
  written in C1 (T5 writes the C1 ones) and the fault test needs `c2-faults` now — spec:
  `stand-ins.md` §3.1, §3.2, §5 — overrule: name-only, with `c2-faults.json` written by T5.
- B14 (T2) The log adds kind `refused` (`conn`, `status`) for an upgrade answered 401/403/require-token,
  and the `connect` line carries `utterance` (its id); `sent` lines name `config`, `update`,
  `no-audio`, `error`, `final`, `ready_to_stop`; a close is `by` `fake` or `client` — because §3.4 shows
  an example, not every kind — spec: `stand-ins.md` §3.4 — overrule: change `log()` calls in
  `fake-speech.mjs`.
- B15 (T2) A refused connection uses up its utterance (`token` then `busy` on two connects); `stop()`
  closes the listener only, open connections play on; `close()` also ends them; any path but `/asr`
  is answered 404; text frames from the room are ignored — because §3.1 says one connection is one
  utterance and "closes the listener" — spec: `stand-ins.md` §3.1, §3.3 — overrule: `stop()` also
  terminates open sockets.
- B16 (T2) The end frame cancels everything still pending on that connection (updates, `errorAt`,
  `closeAt`, the `no_audio_detected` ticks); a `noAudio` utterance's final is
  `active_transcription` with no lines and an empty buffer; `finalAfterMs` defaults to 150; with no
  audio frame before the end frame, the final still follows — because §3.2 says only that an update
  after the end frame is not sent — spec: `stand-ins.md` §3.2, §5 — overrule: `endFrame()` in
  `fake-speech.mjs`.
- B17 (T3) The test clock (`createTestClock()` in `server/cockpit/clock.mjs`, a factory nothing in
  `server/` calls) runs timers on their own timeline: `set()` moves the wall time only and fires no
  timer (as Playwright's `page.clock.setSystemTime`); `advance(ms)` fires due timers in time order,
  awaits a callback's promise and lets one `setImmediate` pass before the next, so a timer set by a
  timer in the step fires in it; switching `real`/`manual` keeps the time where it is — because §1.1
  says "the room's time jumps there" without saying whether pending timers fire, and a 5 s stop timer
  firing on a clock `set` would break a scenario that sets 06:41 mid-turn — spec: `stand-ins.md`
  §1.1, §1.2 — overrule: have `set()` fire every timer whose wall due time it passes.
- B18 (T3) The fault hooks are `atUpgrade(req, socket, kind)` (`kind` `ws` for the link's upgrade,
  `http` for an `/api/cockpit/*` request), `atInbound(msg, link)` and `atOutbound(msg, link)`, each
  returning `true` to take the socket / drop the message; `atOutbound` is called once per message
  after its `seq` was given and before it goes to any link (`link` null when it goes to all) —
  because §1.1 names three points, not their signatures, and "not sent to any link but still counts
  in `seq`" needs one call per message — spec: `stand-ins.md` §1.1, §1.2 — overrule: change
  `server/cockpit/faults.mjs` and `room-control.mjs`'s `hooks` together.
- B19 (T3) T3's control API serves `/clock`, `/tick`, `/link` and `/drop` (all four live in the hooks
  and the clock); `/connections` and `/sent` wait for T14 (they need the link's upgrade answer, close
  codes and `seq`), `/pair`, `/unpair` for pairing, `/button` for C2b, `/jobs` for Jobs, `/alarms`
  for the watcher, and answer `404 unknown-verb` until then (named in the test). The API lives in
  `test/cockpit/stand-ins/room-control.mjs` so the hooks are tested in-process — because a verb
  with nothing to act on would be a fake — spec: `stand-ins.md` §1.2 — overrule: stub them now.
- B20 (T3) `POST /link {"up":"silent"}` still accepts new upgrades and answers `/api/cockpit/*`
  HTTP; only link messages are dropped both ways; `{"up":false}` counts as `closed` the upgraded
  sockets still open (a link the room itself closed is not counted) — because §1.2 speaks only of
  open links for `silent` — spec: `stand-ins.md` §1.2 — overrule: `hooks.upgrade` in
  `room-control.mjs`.
- B21 (T3) `boot()`: `booted.auditFile` is the `LANEBOARD_AUDIT_FILE` boot already set
  (`<tmp>/state/laneboard/audit.jsonl`, not `<tmp>/audit.jsonl`), so every existing test keeps its
  path; `booted.control` is the address `127.0.0.1:<port>` as the wrapper prints it, and
  `control(booted, method, path, body)` (exported next to `ingressFetch`) makes the call, resolving
  `{status, body}`; `restart()` updates `control`, `pid`, `child` and `health` on the same object;
  a `stateFiles` value that is not a string is written as JSON — because §1.1 asks for "defaults
  unchanged" and names `booted.control` both as an address and as `room.control(…)` — spec:
  `stand-ins.md` §1.1, §1.2 — overrule: move the audit file to `<tmp>/audit.jsonl` for every boot.
- B22 (T3) `startRoom()` called without a `ctx` (the wrapper) boots the process as `server/index.mjs`
  does for `mode: builder` (its two error handlers, `dataDir`, `import('./builder.mjs')`) and throws
  for another mode until T6; with a `ctx` it does nothing yet — because B1 has T3 boot "the board
  as builder.mjs boots it" and T6 rewrites the function — spec: `README.md` "The room process",
  `stand-ins.md` §1.1 — overrule: T6.
- B23 (T3) `room-under-test.mjs` started without `LANEBOARD_STATE_DIR` (which `boot()` always sets)
  prints its usage and exits 0 — because `npm test`'s `node --test` runs every `.mjs` under `test/`
  as a test file, and the wrapper would otherwise boot a room there that never exits (it hung the
  suite once in round 5), or a room on the user's own state — spec: `slices.md` §2 (the stand-ins'
  usage rule), `stand-ins.md` §1.1 — overrule: move the stand-ins out of `test/`, or pass an
  argument from `boot()`.
- B24 (T3, fixing T1) The fake agent writes its `turn-end` log line before the turn's `result` line,
  not after — because `test/cockpit-fake-agent.test.mjs` reads the log as soon as it sees `result`
  and failed once under the whole suite's load (round 5); §2.6 orders the log's kinds, not the log
  against stdout — spec: `stand-ins.md` §2.6 — overrule: tests poll the log instead.
