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
- B25 (T4) The `bridge` dialect reads `mcp.json` from `--mcp-config` when given, else from its working
  directory (`cockpit.agent.cwd`, default `{stateDir}/cockpit-agent`); `ready.agent` is
  `fake-agent 0.0.0-fake`; `ready.allowlist` is left out when `LANEBOARD_ALLOWED_TOOLS` is unset or not
  JSON; a `done` `turn.end` carries `costUsd` and `durationMs` but no `steps`; a `ping` turn field
  writes nothing (§11.3 has no ping); its `stdin` log lines leave `text` out as the claude ones leave
  `message.content` out — because §2.5 and §11.11 say "the URL in that same `mcp.json`" without saying
  how a bridge agent finds it, and §11.3 makes those fields optional — spec: `stand-ins.md` §2.5,
  `protocols.md` §11.3, §11.11 — overrule: `bridgeSpeaker()` and `main()` in `fake-agent.mjs`.
- B26 (T4) A `next-tool-end` steer drops the running turn's remaining steps and plays the steered
  prompt's matched turn from the take (its `at` from then; its `end` ends the turn); one steer is
  taken per moment no call runs (a second waits for the next, or for the turn's end); `queued` and
  `onInterrupt` are the first turn's throughout; the `turn-end` line names the first turn — because
  §2.4's "plays its matched turn's steps as part of the running turn" does not say whether the rest
  of the running turn still plays, and S-C1-16 wants the steer's reply right after the prompt block —
  spec: `stand-ins.md` §2.4, `c1-talk.md` S-C1-16 — overrule: merge both timelines in `play()`.
- B27 (T4) The real MCP call is one `tools/call` POST (no `initialize` first, no `Mcp-Session-Id`),
  `Accept: application/json, text/event-stream`, a JSON or an SSE answer, the `mcp.json` `timeout`
  (default 15 s); `tool-result.result` is `structuredContent`, else the text parsed as JSON, else the
  text; a JSON-RPC error or a failed request is `isError` true, `result` `null` and an added `error`
  field; a tool outside `mcp__laneboard__*` makes no call and logs no `tool-result`; a step after a
  call's `endAt` waits for the call too — because §2.3 names only the `tools/call` request, and T35's
  server is not built yet — spec: `stand-ins.md` §2.3, §2.6, `c3-see.md` §1 — overrule: `mcpCall()`
  in `fake-agent.mjs` (T35 may need `initialize` first if its server keeps sessions).
- B28 (T4, replacing B8 except its first point) A receipt lists every prompt not taken yet, ignored
  (`ignore`, `ignore-once`) ones included; an interrupt with no turn running answers the receipt and
  ends nothing; `SIGINT` with no turn running, and a `priority:"now"` prompt, end the turn with no
  receipt (there is no request); an interrupted turn writes only its `result` (`aborted_streaming`),
  not the open message's `assistant`/`message_stop` lines; once an `ignore-once` resend is taken, the
  first prompt is no longer a candidate for `resendOf` — because §2.4 leaves those cases open —
  spec: `stand-ins.md` §2.4, §2.6 — overrule: `interrupt()`, `sigint()` and `prompt()` in
  `fake-agent.mjs`.
- B29 (T5) The script check holds every native line against its `protocols.md` §11.4 row through
  `renderTurn()` (the `claude` speaker walked over a turn's timeline without waiting or calling) and
  `test/cockpit/stand-ins/native-rows.mjs` (the row reader moved out of the fake-agent test, both tests
  use it), not through `server/cockpit/protocol.mjs`'s `json claude` fixtures, which T8 has not built;
  `parallelCall()` is shared by `play()` and `renderTurn()` — because D98's checks do not exist yet and
  the §11.4 rows are what the fixtures are made of — spec: `stand-ins.md` §5, D98 — overrule: T8 also
  feeds `renderTurn()`'s lines to its message checks, or the check plays each script live.
- B30 (T5) A script may carry `about` (what it is for) and each turn `for` (its scenario ids); the
  fake ignores both, and the check refuses any other unknown field — because §2.2's format has no
  comment and the next builder needs to know which turn is whose — spec: `stand-ins.md` §2.2, §5 —
  overrule: drop the two fields and keep the ids in the check only.
- B31 (T5) Where a scenario names no prompt, the turn's `match` is the prompt its test sends:
  c1-render `show the runs as a table` / `show every number` (S-C1-05), `check the sites` (S-C1-06,
  -07, -12), `show the cleanup script` (-08), `show the markup` (-09), `what ran tonight` (-10, -34),
  `show the marks` (-11), `read the odd ones` (-35), `everything at once` (-40), `show me builder-a`
  (-46); c1-typing `how did the night go` (-16), `count to fifty` / `count slowly` (-17), `check all
  runs` (-27), `count the runs` / `count the lanes` (-28), `check all lanes` (-29), anything else the
  0.2 s `done` turn; c1-errors `tell me about the night` (-19), `error overloaded`, `error step limit`,
  `error boom`, `error long detail`, `error login`, `error retries` (-20); scr-room `tell me
  everything`, `show me builder-a`, `stay a while`; c3-tools `what is stuck` (S-C3-03), `acme-x`
  (-04), `which screens` (-14); the check asserts no earlier turn takes a turn's words — because a
  match is a substring and a catch-all shadows what follows it — spec: `stand-ins.md` §2.2, §5 —
  overrule: rename the `match` and the test's prompt together.
- B32 (T5) c1-render: the first `how did the night go` plays all six deltas (S-C1-04), the second
  §2.2's example as written (delta 4 dropped); the example's second turn is the script's last,
  matching any other prompt once. The pane-only calls (`fleet`, `ci`, `runs`, `lanes` in c1-render
  and c1-typing) carry `"call":false`, so their times and `isError` are the script's; `morning`,
  c1-voice's, c3-tools', sec-inject's and the `fly_to` show calls are real — because C1's MCP server
  has no `fleet`, `ci` or `lanes` and the pane scenarios time the calls to the ms — spec:
  `stand-ins.md` §2.3, §5; `c1-talk.md` S-C1-06, S-C1-25 — overrule: drop `call:false` once C3's tools exist.
- B33 (T5) c1-voice plays §13.1's turn earlier: `morning` 50-250 ms, the six deltas from 300 ms
  530 ms apart (§13.1's spacing), `done` at 3.1 s with `costUsd` 0.0412, matched on `night go` and
  `wie lief die nacht`, both `repeat` — because §5 asks for the first delta 0.3 s after the prompt
  while §13.1's own times put it at 2.24 s — spec: `stand-ins.md` §5, `protocols.md` §13.1 —
  overrule: §13.1's times, and S-C1-13's B4 read from the later delta.
- B34 (T5) scr-room has a third turn, `stay a while` (a line every 20 s, `done` at 400 s, as
  c4-cards' `long-turn`), for S-SCR-04's 400 s reply; §5's row names only the 20 s turn. Its times are
  the fake agent's real ms (it has no room clock): T31 meets them with the page's clock and the
  room's, or rewrites the turn shorter through `fakeAgent.use` — because S-SCR-04 needs a turn
  running at 399 s — spec: `stand-ins.md` §5, `screens.md` S-SCR-04 — overrule: T31's choice.
- B35 (T5) c1-errors: `boom`'s `detail` is `boom` and the 300-character `detail` is its own turn;
  the error turns `repeat`, so one room serves the table; the `exit` turn plays again in the
  restarted agent (a new process has played nothing), so S-C1-19's `RETRY` exits again unless T27
  switches the script first — because §5 lists "`failed` `boom` plus a 300-character `detail`" and
  E8's `RETRY` resends `boom`'s words — spec: `stand-ins.md` §5, `c1-talk.md` S-C1-19, S-C1-20 —
  overrule: one `boom` turn whose detail starts `boom`.
- B36 (T5) c1-long's 26 000 characters and 120 lines count every character of the joined text,
  newlines and the two blank lines around the table included, streamed as 100 deltas of 260
  characters 200 ms apart from 15.0 s, `done` at 35.0 s; sec-reply's key block is the PEM shape with
  two `AAAAnot-a-key…` lines, no key — because S-C1-21 counts the reply's text and the repo is public
  (no secret scanner should fire on it) — spec: `stand-ins.md` §5, `security.md` S-SEC-02 —
  overrule: the generator's numbers (the check asserts them).
- B37 The fatal-at-start lines of `server/config/cockpit.mjs` are printed by `server/config.mjs`'s
  one handler, so stderr's first line is `laneboard: refusing to start — <config file>: <the exact
  line>`; tests compare the part after `<file>: ` — because every fragment's refusal goes through
  that handler today and `config.mjs` is frozen after wave 0 — spec: `protocols.md` §11.12 ("one
  stderr line that starts with the key, as every config fragment does"), `single-machine.md`
  S-ONE-12 ("stderr is exactly the line") — overrule: `config.mjs` prints a fragment's line bare
  (one line there, every fragment's refusal changes).
- B38 On a `hub`, a `cockpit` key in the file other than `forwarded` is fatal:
  `cockpit.<key> on a hub: a hub's cockpit section holds only cockpit.forwarded (D129)`
  (`cockpit.agent` keeps D128's own line, checked first) — because D129 says forwarded "is the only
  key a cockpit section may hold on a hub" but gives no line — spec: D129 — overrule: ignore the
  other keys on a hub.
- B39 `mode: cockpit` refuses a `bind` other than `["127.0.0.1"]` (`bind: a room alone (mode
  cockpit) listens on 127.0.0.1 only, got […]`) and a `fleet.ingressPort` (no ingress listener)
  — because README "Ports" says `127.0.0.1` only for a room alone, and B41 relies on one listener —
  spec: README "The room process", D128 — overrule: accept other loopback binds (B41's wrap then
  needs another way in).
- B40 Lines the spec leaves unworded, each naming the key: `cockpit.mcp.port: must be a port
  number, or 0 for any free port, got …`; `cockpit.board.url: must be an http(s) URL with no
  credentials or query, got …`; `cockpit.stt.url` (scheme, credentials, query, `ws://` off
  loopback), `cockpit.stt.language`, `cockpit.stt.tokenFile`; `cockpit.agent.allowUnrestricted:
  must be true or false` (as allowSameUser's); `cockpit.agent.allowedTools: [] is not …` for an
  empty list; `cockpit.forwarded: must be true or false`. `cockpit.mcp.port` and
  `cockpit.board.url` get no env variable (the spec names none) — spec: `c2-voice.md` §9 ("fatal
  at start, naming the key"), `c3-see.md` §1-§2, D129 — overrule: the words.
- B41 The room alone (`mode: cockpit`) answers 404 `{"error":"not-found"}` off `/healthz` and
  `/api/cockpit/*` by wrapping each listener's `request` handler after `listenAll()` returns (one
  listener, so no request comes in before the wrap); an upgrade off the prefix gets the same 404
  from `listenAll`'s `onUpgrade` — because `server/http.mjs` (fenced) serves `public/` and the SPA
  page to any GET its routes miss, and has no option to turn that off — spec: `protocols.md` §1,
  D128 — overrule: a `static: false` option in `http.mjs` (a patch for the owner) and the wrap goes.
- B42 Until the room registers its routes (T13 on), a path under `/api/cockpit/` reaches the board's
  router and gets its 404 (`{"error":"not found","path":…}`); the room-alone test asserts that body
  to prove the prefix passes the B41 filter — because the room's routes are later tasks — spec:
  `protocols.md` §1.1 — overrule: none needed; T13 replaces the assertion with the link.
- B43 T6's `startRoom(ctx)` prints the start lines (`cockpit.agent.env` not set here, the agent on
  the room's user, `allowUnrestricted`), makes the default cwd 0755 and returns `{cwd, stop}`; the
  bridge (T9), the link (T13) and the MCP server (T35) hang on it later. `single-machine.md` §3.3's
  "a directory on the way to cwd the agent's user cannot enter" line needs the agent user's access
  and comes with T7's start check — spec: `protocols.md` §11.12 "Not fatal" — overrule: none.
- B44 `cockpit.agent.user` is looked up with `getent passwd <name>` (argv, no shell, after the name
  regex), else `/etc/passwd` when `getent` is missing; tests inject the lookup (S-ONE-12's users) —
  because Node has no getpwnam and directory users exist only through NSS — spec: §11.12 `user` rows
  — overrule: `/etc/passwd` only.
- B45 `server/index.mjs`'s one line: `mode: cockpit` imports `server/boot/cockpit.mjs` and calls
  `startRoom()`; the module has no side effect on import, so the room under test's wrapper can import
  it and call `startRoom()` itself (stand-ins.md §1.1) — spec: README "Entry point" — overrule: the
  module boots on import and the wrapper changes.
- B46 `cockpit.agent` defaults to `null` (a leaf the docs check sees); its keys are filled in per
  kind by the fragment's `finalize` when the block is there and listed in
  `scripts/check-config-docs.mjs` `RUNTIME_KEYS`, so `docs/config.md` must document each — because
  D17 needs "no agent" to stay distinguishable after the defaults merge — spec: D17, §11.12 —
  overrule: none.
- B47 The start check (`server/cockpit/start-check.mjs`) prints D248's owner line
  `{key}: {path} is owned by uid {uid}, not you` for a path another uid owns (checked before the
  mode), and D210's `can be read by others` line for any group or other bit; the room stops on the
  first problem, in security.md §3's order (tokenFile, infra.key, `{stateDir}/cockpit/` depth first
  with names sorted, the audit file, its directory) — because S-SEC-01 drives "owner 1001" with the
  exact line per key, security.md §3 words only the mode line, and doctor's `files` check (D248) is
  "the start check, reported instead of stopping" — spec: security.md §3, single-machine.md §5
  check 10 — overrule: one line for both (the mode line names the owner too).
- B48 A listed path that does not exist is no problem (the room makes `{stateDir}/cockpit/`; a
  missing token file is the speech check's); a path the room cannot `stat` for any other reason
  stops it with `{key}: {path} cannot be checked ({code})`; a link inside `{stateDir}/cockpit/` is
  judged by its target and never entered — because D210 is the strict choice and an unreadable
  path is not known to be closed — spec: D210 — overrule: skip what cannot be stat'ed.
- B49 The start check runs whether or not `cockpit.agent.user` is set (with `allowSameUser` too) —
  because security.md §3 says "before the room accepts a link it stats each of these" with no
  condition, and the S-SEC-01 real start runs on the test's own user (allowSameUser: true) — spec:
  security.md §3 — overrule: only with `user` set.
- B50 The check and the room's directories run once per process before any port listens:
  `prepareRoomFiles()` in `server/boot/cockpit.mjs`, called by `startRoom(ctx)` (the room alone,
  ahead of `listenAll`) and by `server/boot/builder.mjs` just ahead of its `listenAll` (the one box,
  after its audit log is opened). It makes the audit log's directory and the state dir 0700 when
  missing (as `server/fleet/audit.mjs` does), `{stateDir}/cockpit/` 0700 and
  `{stateDir}/cockpit-agent/` 0755 always (B43's "default cwd only" is replaced: D209's directory
  is the room's in every setup), and never chmods a directory that was there except
  `cockpit-agent/` — because S-SEC-01 says "no port is listening", and a 0755 state dir made by
  `mkdir -p cockpit-agent` would trip the audit-directory check — spec: security.md §3, D209 —
  overrule: none needed.
- B51 The start check exits with `process.stderr.write(line)` and `process.exit(1)`, no
  `laneboard: refusing to start —` prefix and no stack — because S-SEC-01's stderr is the line
  itself, and the prefix is config.mjs's for config fragments (B37) — spec: S-SEC-01 — overrule:
  the prefix too (one line in `prepareRoomFiles`).
- B52 single-machine.md §3.3's walk lives in the same module (`agentWalk`): the agent's uid and
  groups from `id -u`/`id -G` (argv, after USER_RX), the kernel's owner/group/other order, then the
  directory's access ACL from `getfacl -n` when the bits say no, so the `setfacl -m u:{user}:x` the
  line prints silences it; a directory not there yet is skipped; targets `{stateDir}/cockpit-agent/`
  and `cockpit.agent.cwd`, each directory once — because a walk that ignores ACLs would repeat its
  line after the owner ran the fix — spec: single-machine.md §3.3, B43 — overrule: bits only.
- B53 S-SEC-01's last steps (`mcp.json` 0644 holding `${LANEBOARD_MCP_TOKEN}` and not the token,
  the fake agent's `--mcp-config` argv) move to T35, which writes `mcp.json` after the MCP listen
  (c3-see.md §1) and comes after the bridge (T9) that spawns the agent; T7's test asserts D209's
  directory modes — because neither the MCP server nor the bridge exists at T7 — spec:
  security.md §7 S-SEC-01, c3-see.md §1 — overrule: none; T35 closes the scenario.
- B54 (T8) The night's copy of the protocol (D136) is made in T8, not in the night's first commit
  (no earlier round made it): `docs/cockpit/protocol.md` is `protocols.md` byte for byte, and the spec
  file's first line is left as it is (a pointer would be more than a typo fix) — because T8 is the
  first task whose test reads it — spec: `protocols.md` §9 "Where the test reads it" — overrule: add
  the pointer line to `protocols.md` and from then on edit only the copy.
- B55 (T8) A "with X" field present outside its case is `bad-message` (`not allowed here`), as is a
  `tool` item with only one of `endedAt`/`isError`, and `hello` with only one of `epoch`/`lastSeq`;
  `prompt.text` is refused when empty after trimming or over `maxPromptChars`, not when it has
  outer white space — because §2.4 says "required only in that case and absent otherwise" and
  "both or neither"; a screen trims, the room needs only the bounds — spec: `protocols.md` §2.4,
  §3.1 — overrule: the `when:` branch of `walk()` in `server/cockpit/protocol.mjs`.
- B56 (T8) Value rules the spec leaves open: ids the room makes (`turnId`, `card`, `epoch` …) are
  1-128 characters of `[A-Za-z0-9._:/-]`; node ids (`about`, `inSight`, `target`) any text of
  1-128 without control characters; `route` keys `view`, `b`, `s`, `q`, `sel`, `open`, `run` as
  strings within router.js's bounds, other keys not refused (parseHash drops them, which is the link
  handler's job); names (`screen`, `by`) 1-64; `title` 200 (a job's 60, coworker.md §6.1);
  `toolUseId` on the room link must be `tu-` and a counter (D102); `lang` a language code or `auto`,
  and one of `opts.languages` when given — because these keep a hostile frame bounded without
  refusing anything a correct room or screen sends — spec: `protocols.md` §2.4, `c3-see.md` §8.1 —
  overrule: the rule constants at the top of `server/cockpit/protocol.mjs`.
- B57 (T8) The checks answer only `bad-message` and `unknown-type`; `unknown-id` and `not-now` are
  state, the link handler's (T13). The fixtures are read from `docs/cockpit/protocol.md` only, and
  the hand-written range cases live in the test file: no `test/cockpit/fixtures/` directory, which
  would be a second copy of examples the protocol already holds. The `json bridge` checks are
  `server/cockpit/bridge-events.mjs` (§13, T9); T8's test asserts only §9's reverse rule for them
  (every §11.3 type has a fixture) and that `json claude`/`json stt` blocks parse — because the
  bridge module is T9's and `stt` belongs to C2 — spec: `protocols.md` §9, §13 — overrule: T9 adds
  its class to `test/cockpit-protocol.test.mjs`.
- B58 (T9) The adapter passes `mcp_servers[].status` on as `ready.mcp.laneboard` unchanged (`connected`,
  `failed`, and `pending` as `pending`); no `laneboard` entry, or `mcp_server_errors[]` naming it, is
  `failed` — because research Q2 (recheck) says `pending` means "not yet", and §11.3 already makes
  anything but `connected` `tools-down`, which is the room's (T28) to judge — spec: `protocols.md`
  §11.3, §11.4 — overrule: map `pending` to `connected` (or wait for a second `init`) in `ready()` of
  `server/cockpit/agents/claude-code.mjs`.
- B59 (T9) The `interrupt` goes to Claude Code as
  `{"type":"control_request","request_id":"i-0003","request":{"subtype":"interrupt","cancel_queued":true}}`,
  the shape the fake agent reads (T4) — because research Q10 has not confirmed the raw request
  (§11.4's closing note) and the fake and the adapter must agree — spec: `protocols.md` §11.4, §11.6
  — overrule: `interruptLine()` in the adapter and the fake's `line()` together, once Q10 pins it.
- B60 (T9) §11.4's "without either field" rule (`taken` for the oldest echoed prompt at the next
  `message_start`) applies only while the session has never sent `user_message_uuids` or
  `user_message_uuid`; once it has, a `message_start` without them takes nothing — because an agent that
  names its prompts sends a bare `message_start` for every later message of a turn (§13.1 at 5.20, the
  fake's B5), and the rule would then take a queued prompt the agent has not read — spec:
  `protocols.md` §11.4 — overrule: apply it to every bare `message_start` (`namesPrompts` in the adapter).
- B61 (T9) The bridge's edge: `createBridge()` hands the screen messages of §3.2 to `emit` without
  `seq` (the link numbers and sends them, T13/T14); it restarts only a child it killed itself for
  §11.9 (silence, a stuck stdin), at once with `--resume`; the §11.7 restart schedule, the 30 s
  `ready` limit, the stop timing of §11.6 and `session.json` are T11's (`onExit`, `interrupt()`,
  `signal()` are their hooks); `startRoom()` does not start an agent yet (T11 and T13 wire it) —
  because T9's done-when is the bridge with a child, and spawning `claude` at every room start would
  run in every existing boot test — spec: `protocols.md` §11.1, §11.7, §11.9 — overrule: none; T11 builds on it.
- B62 (T9) A `kind: bridge` agent's `tool.start` with `denied:true` becomes, for the screens, a
  `tool.start` and at once its `tool.end` (`isError:true`, `denied:true`, `endedAt` = `startedAt`) —
  because the screen's `tried` line is drawn from `tool.end.denied` (§3.2) and a Claude Code refusal
  arrives as that same pair (§11.11's last point) — spec: `protocols.md` §3.2, §11.3, D242 — overrule:
  a `denied` field on the screen's `tool.start` (a protocol change).
- B63 (T9) The adapter's own interrupt for `api_retry` `authentication_failed` (§11.4) has the id
  `i-login` and its receipt is swallowed; only `authentication_failed` maps to E4, not
  `oauth_org_not_allowed` or `account_on_hold` that research Q2 lists — because §11.4 names one value
  and those two mean other things for the owner (E8 with the result's text says so) — spec:
  `protocols.md` §11.4 — overrule: add them to the `api_retry` case of `system()` in the adapter.
- B64 (T9) The standing instructions live in `server/cockpit/agents/instructions.mjs` (C1's lines of
  §11.8, word for word; the bridge test compares the launch argument with it), and for `kind: bridge`
  the bridge writes `{stateDir}/cockpit-agent/instructions.txt` (0644) at every start — because §11.8
  keeps "one text next to the adapter" and T39 adds the instructions' own test and the slice lines —
  spec: `protocols.md` §11.8, D209 — overrule: none; T39 extends the module.
- B65 (T9) `bridge.prompt()` writes the agent's line first and sends `turn.prompt` once the write has
  gone (§13.1: 2.96 room → agent, 2.97 `turn.prompt`); a write not done in 5 s is `agent-down`, the
  child gets `SIGKILL` and resumes at once — because §11.9 says "a `prompt` that cannot be written in
  5 s: `prompt.refused` `agent-down`", which the room can only answer before it has echoed the prompt
  — spec: `protocols.md` §3.1, §11.9, §13.1 — overrule: echo first, then a `turn.end` E3 on a failed write.
- B66 (T9) Ids the bridge makes: `turnId` `t-` and four digits from the bridge's own counter (T12
  seeds it from `conversation.jsonl`, §11.7.1 step 6), `tu-` and two digits per turn for every call
  the screens see (a refused one too), interrupts `i-` and four digits; prompt ids `randomUUID()`
  — because §11.3 and D102 give the forms, not the counters' start — spec: `protocols.md` §11.3,
  §11.7.1 — overrule: the counters in `createBridge()`.
- B67 (T9) A refused start (§11.11) reaches the screens through `opts.onCondition('agent-down',
  {detail, blocksSend:true})`, which by default sends `status` itself — because the status line's
  "highest that holds wins" (§3.5, D152) is T28's, and until then the condition must still be seen —
  spec: `protocols.md` §3.5, §11.11 — overrule: none; T28 passes its own `onCondition`.
- B68 (T9) `server/cockpit/bridge-events.mjs`'s value rules: ids up to 200 characters (a prompt's id
  a UUID v4), text up to 16 MB (the line limit), name lists up to 1 000 entries of 1-256
  characters, `turn.end` `detail` up to 2 000 (the room cuts it to 120); a line of a bridge agent
  that fails its check is logged with its first 200 characters and skipped, as an unknown line is;
  the class's fixture test is in `test/cockpit-protocol.test.mjs` (B57's overrule taken) — because
  §11.3 names the fields, not their bounds, and a correct agent never meets these — spec:
  `protocols.md` §11.3, §13 — overrule: the rule constants in `bridge-events.mjs`.
- B69 (T9) `docs/config.md` "Environment variables" gains one row for the names the room sets in its
  agent's environment (`LANEBOARD_MCP_TOKEN`, `LANEBOARD_SESSION`, `LANEBOARD_SESSION_RESUME`,
  `LANEBOARD_ALLOWED_TOOLS`, `LANEBOARD_COCKPIT_INSTRUCTIONS`) — because `test/config-names.test.mjs`
  asks every `LANEBOARD_*` name in `server/` to be there, and they are part of the agent contract —
  spec: `protocols.md` §11.8, §11.11 — overrule: move the row to `docs/cockpit.md` (T44) and exempt
  the names in the test.
- B70 (T10) Rule 1 matches a secret's value only when it has 4 or more characters (`SECRET_MIN`,
  after trimming); shorter or empty values are skipped — because `cockpit.agent.env` may name
  non-secret variables (`TERM`, `TZ`) whose short values would blank ordinary text, and a value
  under 4 characters is no key — spec: `c1-talk.md` §5.3 rule 1 — overrule: `SECRET_MIN = 1` in
  `server/cockpit/redact.mjs` (security-relevant, named under For the owner).
- B71 (T10) Rule 3 in reply text matches `Bearer`, `Basic`, `Token` capitalised or upper-case only;
  in tool input it stays case-insensitive as §5.3's table says — because S-SEC-02 (D211) expects
  `The token in /etc/acme/env is [redacted] …`, which a case-insensitive rule 3 would turn into
  `The token [redacted] /etc/acme/env …`; D211 is newer than §5.3's table (D127) — spec:
  `security.md` §5, S-SEC-02, `c1-talk.md` §5.3 — overrule: `SCHEME_TEXT` in `redact.mjs`.
- B72 (T10) Rule 4 inside a string also takes a quote around the name or the value
  (`"api_key": "v"`, `X-Api-Key: v`), and `--name value` needs the two dashes and a value not
  starting with `-`; only a name holding one of the seven parts matches, so `https:` never swallows
  a URL — because §5.3 lists the four forms, not quoting, and JSON held in a string is common in
  tool input — spec: `c1-talk.md` §5.3 rule 4 — overrule: `NAME_SEP_VALUE`/`FLAG_VALUE`.
- B73 (T10) The hold-back also keeps a rule 3 word (`Bearer `) that ends a delta, with the white
  space after it, until the next word comes — because otherwise `Bearer ` leaves alone and its
  credential arrives in a delta where rule 3 cannot see the word — spec: `security.md` §5 "While
  streaming" — overrule: `holdFrom()` in `redact.mjs`.
- B74 (T10) The streaming hold for a PEM block starts at `-----BEGIN` anywhere in the text, not only
  at a line's start; on its `-----END … -----` the held part goes through the reply rules (rule 2
  makes a private key one `[redacted]`, a certificate is left to rules 5-6) — because a key pasted
  after `key: ` on the same line must not leave word by word — spec: `security.md` §5 — overrule:
  `stream()` in `redact.mjs`.
- B75 (T10) The bridge also redacts a `turn.end` `detail` from the agent with the reply rules —
  because it is the agent's text that reaches a screen like any other — spec: `security.md` §5
  (silent on `detail`) — overrule: drop `redactor.text` in `endTurn()`.
- B76 (T10) One redaction stream per text block of the running turn: a delta's releasable text
  leaves as one `text.delta` (none when nothing may leave yet); at `text.block`, or at `turn.end`
  for a block that never got one, the held rest leaves as a last `text.delta` first, so the deltas
  always add up to the block; the T9 bridge test now expects §13.1's six agent deltas as five
  (`03:12` waits for `.`) — because "sends it with the next delta, once white space or the block's
  end arrives" — spec: `security.md` §5, `protocols.md` §3.2 — overrule: `streamFor`/`endStream`
  in `bridge.mjs`. The bridge builds its redactor from `roomSecrets({mcpToken, env, names:
  cockpit.agent.env})` plus `opts.secrets`; the speech token file is read by `roomSecrets()` when the
  room passes `sttTokenFile` (T13 wires the room's bridge, B61).
- B77 (T11) `server/cockpit/session.mjs` `createSession()` owns the bridge (built with
  `restartOnKill:false`) and does every restart, the stop's 5.0/8.0/10.0 s steps, the 30 s `ready`
  limit, `new` and `session.json` (written whole by rename, 0600 in the 0700 `cockpit/`); the
  bridge gains `markStopping`, `forceStop`, `closeStdin`, `kill`, `onTurnEnd`, `turnCount`,
  `agentEnds`; `conversation.jsonl` is T12's; `startRoom()` does not start a session yet (T13
  wires it with the link) — because T11's done-when is the session test, and the bridge keeps
  T9's behaviour for its own test — spec: `protocols.md` §11.6-§11.7 — overrule: none; T12/T13 build on it.
- B78 (T11) A turn being stopped stays `turn.state` `stopping` (no `answering`/`working` after it);
  an exit of the child during a stop ends the turn `stopped`, `forced:true` (not E2) and resumes the
  session at once with no status line; text the agent still sends before the turn's end is shown
  — because the owner asked for the stop (§11.6's 8.0 s row) and D33 freezes only output after the
  `turn.end` — spec: `protocols.md` §11.6, §3.3 — overrule: `exited()` and `setState()` in `bridge.mjs`.
- B79 (T11) `RESTART_STEPS_S` are the waits between tries, each counted from the previous try's
  exit (tries at 0, 2, 6, 14 … s), starting again at 0 after a `ready`; a failed start at room
  start also restarts at once; a 0 s wait starts in the same tick — because the restart test
  reads "0, 2, 4 s" and E3's "every 30 s" is a wait — spec: `protocols.md` §11.7, §13,
  `c1-talk.md` time table, D289 — overrule: count from the crash in `scheduleRestart()`.
- B80 (T11) `agent-down` is set at the second failed start with `since` the crash (or the first
  failed start) and `detail` the last stderr line (else `the agent exited (code N)`), and cleared
  (`status` `null`) at the next `ready`; `agent-back` is sent only when the outage cut a turn (E2),
  and the room clears it 5 s later (`NEWS_MS`) — because its text says "Your last message was not
  answered", and a cleared news must not come back in a later `welcome.status`; T28's arbiter of
  §3.5 replaces the default `condition` — spec: `protocols.md` §3.5, §11.7, `c1-talk.md` §10.1 —
  overrule: `onReady()` in `session.mjs`.
- B81 (T11) `new` during a turn waits for the stop's `turn.end` (at most the 5.0 s forced end), then
  closes stdin; `SIGTERM` 5 s later, `SIGKILL` 2 s after that (the 8.0 → 10.0 s gap of §11.6); `new`
  while no session is up cancels the pending restart and starts the new session at once; `not-now`
  while the new (or a forced) session is starting — because §11.7 gives no kill step after the
  `SIGTERM` — spec: `protocols.md` §11.7, §3.6 — overrule: `closeForNew()` in `session.mjs`.
- B82 (T11) A `ready.session` other than the one resumed: that child is killed at once and a
  `--session-id` start follows (`conversation.new` `forced` at its ready); the two-resumes rule
  counts only exits with a code other than 0 within 10 s of the spawn on the room clock (a 30 s
  `ready` timeout, killed with `SIGKILL`, is a failed start but resets that count); every new-session
  try has its own UUID; the conversation is `c-0001` with no `session.json`, else the next of the
  last one — because §11.7 starts "the child with `--session-id {a new UUID v4}`" and "a session that
  never started is never resumed" — spec: `protocols.md` §11.7 — overrule: `onReady()`/`onExit()` in `session.mjs`.
- B83 (T11) `stop` of a turn id that is not the running one is `not-now` when its number is at most
  the bridge's turn counter, else `unknown-id`; a second `stop` of the turn being stopped is
  accepted and changes nothing — because §3.3 says the screen changes nothing on `not-now` — spec:
  `protocols.md` §3.3 — overrule: `stop()` in `session.mjs`.
- B84 (T12) `server/cockpit/store.mjs` `createStore()` folds the room → screen messages the bridge
  emits (`apply`) into the turns a snapshot carries and appends a `turn` line at §11.7.1's write
  points; `load()` does steps 1-6 and returns `{conversation, startedAt, turns, lastTurn, clientIds,
  cutTurn}`; `startRoom()` loads it before any listen, runs `retain()` and the 3 600 s timer. T13
  wires the rest: `store.apply` on every emitted message, `store.begin({…, reason:'first'})` at the
  session's first conversation (session.mjs emits no `conversation.new` for it), the bridge's turn
  counter from `lastTurn`, `clientIds` into the once-only memory, `cutTurn` to the session's
  `agent-back` — because T12's done-when is the store test and the link does not exist yet — spec:
  `protocols.md` §11.7.1 — overrule: `startRoom()` in `server/boot/cockpit.mjs`.
- B85 (T12) The last `conversation` line of a file wins, as the last line of a `turnId` does; a turn
  keeps the place of its first line — because §11.7.1 names "last wins" for turns only and a
  rewrite must keep the order the turns started — spec: `protocols.md` §11.7.1 step 1 — overrule:
  `readConversationFile()`.
- B86 (T12) A file moved to `old/` whose name is taken (no `session.json` restarts at `c-0001`)
  goes to `old/{conversation}.{n}.jsonl`, the first free `n` from 2; nothing is overwritten —
  because §11.7.1 names `old/{conversation}.jsonl` only and a lost session.json repeats ids —
  spec: `protocols.md` §11.7.1 Files — overrule: `oldName()`.
- B87 (T12) Step 2 with a `session.json` whose conversation differs from the file's: the file goes
  to `old/` too (not dropped), and the new file's `conversation` line has `session.json`'s
  `startedAt` and `reason:"first"` — because step 2 says what the room starts with but not what
  becomes of the other conversation's turns, and `first` is "no conversation before" as far as the
  file can tell — spec: `protocols.md` §11.7.1 step 2 — overrule: `load()` in `store.mjs`.
- B88 (T12) A queued prompt taken as the next turn (`turn.prompt` `from:"queued"`): the old turn
  without its `prompt` item is appended too, before the new turn's line — because the last line
  of the old turn must not keep the moved item after a restart — spec: `protocols.md` §2.2, §3.4 —
  overrule: `apply()`'s `turn.prompt` case.
- B89 (T12) A tool item on disk carries `denied:true` only when the call was denied (absent
  otherwise), `isError` always once ended — because §2.2's snapshot example has no `denied` and
  the item rule makes it optional — spec: `protocols.md` §2.2, §2.4 items — overrule: `apply()`'s
  `tool.end` case.
- B90 (T12) A turn line written mid-block (a `prompt.taken`, a `tool.end` of a parallel call)
  holds the deltas of the open block so far, as a snapshot would; the deltas themselves never
  write — because §11.7.1's line is "the whole turn as a snapshot carries it" and the text is the
  bridge's redacted text (D127) — spec: `protocols.md` §11.7.1 — overrule: write only closed
  blocks in `apply()`.
- B91 (T12) A line that parses but is no `conversation` line, no `turn` passing `checkTurn`, and
  no `speakup` with an `id` is skipped with the same `line {n} unreadable` log line; `speakup`
  lines are read, kept and trimmed by `at` (the Speak slice writes them) — because a half-valid
  turn would reach every screen's snapshot — spec: `protocols.md` §11.7.1 step 1 — overrule:
  `parseLine()`.
- B92 (T13) An upgrade the board classified as anything but `local` or `direct` (a `hub` kind, no
  or an unissued classification) closes 4401 `unpaired` — because D212 makes the board's
  classification the C1 credential and §2.3's code for "no credential the room takes" is 4401 —
  spec: `security.md` §2.3, `protocols.md` §2.3 — overrule: `linkRefusal()` in
  `server/cockpit/link-checks.mjs` (review-required).
- B93 (T13) T13's link: upgrade checks, `hello`, `welcome` (always `resume: snapshot`), the
  snapshot in parts (D140, greedy by turns, an oversize turn cut as §2.2 says), every session
  message numbered and sent to links past their `welcome`, `prompt`/`stop`/`new`, close 4002 on
  another protocol. T14 brings the replay after a gap, the heartbeat and ping, silence, 4001, 4408,
  4413, 4429, `GET /sent`. `GET /connections` is built now (S-SEC-06 reads it) through a fourth
  fault hook, `atConnection(rec)`; an upgrade the board's guard refuses (403 before the room sees
  it) is no entry — because S-SEC-06 needs the log and T14's list is the rest of §2.2-§2.3 — spec:
  `protocols.md` §2.2, `stand-ins.md` §1.2 — overrule: none; T14 builds on `server/cockpit/link.mjs`.
- B94 (T13) The `cockpit.prompt` audit line is T13's (S-SEC-06 asserts it):
  `server/cockpit/audit-lines.mjs` `promptLine()`, the accepted line, the `agent-down` refusal and
  `audit-unavailable` (D166, nothing to the agent); `cockpit.stop`, `cockpit.new` and D165's bounded
  `too-many` refusals stay T30's. The line names the turn before the prompt goes: the running
  turn's id (`queued`), else the bridge's counter + 1 — because §6.4 writes the line "before the
  `turn.prompt` echo" and D166 needs it before the agent; a stdin write that then fails (§11.9)
  leaves the ok line and answers `prompt.refused` `agent-down` — spec: `screens.md` §6.4,
  `protocols.md` §3.1 — overrule: `prompt()` in `link.mjs`. The room alone opens its own
  `openAudit` (`LANEBOARD_AUDIT_FILE`, else the state default); one that cannot open refuses every
  prompt and does not stop the room.
- B95 (T13) Without pairing the screen's name is `board` in `welcome.screen` and `turn.prompt.screen`
  (so in the agent's about line too) — because `welcome.screen` is required, `board` is the audit
  `user` of the same links (§6.4) and C1 draws no names (D37) — spec: `protocols.md` §2.2,
  `security.md` §2.3 — overrule: `SCREEN_NAME` in `link.mjs`.
- B96 (T13) `welcome.lookedAt` is the room's `now` while the room has no `focus` of that screen
  (no `looked.json` in C1): nothing counts as new on a screen the room never saw closed — because
  the field is required and "since you looked" needs a look — spec: `protocols.md` §2.2,
  `c1-talk.md` §2.1 — overrule: `hello()` in `link.mjs` (or the conversation's `startedAt`).
- B97 (T13) Frames before the `hello` are dropped unread; a message without a link `seq` ≥ 1 (so no
  `re` to name) is dropped unanswered; a second `hello` is `error` `not-now`; binary frames are
  dropped until C2 — because `error.re` is required and §2.2 makes `hello` the first frame — spec:
  `protocols.md` §2.1-§2.3 — overrule: `onFrame()` in `link.mjs`.
- B98 (T13) Valid screen messages of later tasks and slices (`focus`, `history`, `touched`,
  `show.*`, `pin.*`, `card.*`, `audio.*`, …) are accepted and change nothing yet — because they are
  known types (no `unknown-type`) whose state the link does not hold — spec: `protocols.md` §2.4 —
  overrule: none; each task adds its case to `onFrame()`.
- B99 (T13) `startRoom()` now starts the session (B61, B77 end): every room start spawns the agent;
  a room test without `FAKE_AGENT_DIR` sees the fake exit 2 and the §11.7 restart schedule (no
  test asserts against it); the room's `stop()` runs ahead of the board's hooks on the one box;
  `mcpToken` is `null` until T35; `cockpit.allowInsecure` is read as exactly `true` and is no
  config key yet (the pairing task adds the key and its fatal line); text frames over 1 MiB are
  closed by `ws` (1009) until T14's 4413 — because the link needs a session behind it and those
  keys belong to their own tasks — spec: `protocols.md` §11.7, `screens.md` §6.2.1 — overrule:
  `startRoom()` in `server/boot/cockpit.mjs`.
- B100 (T13) Hooks added for the wiring: `createBridge({turnCounter})` (B84's counter from
  `lastTurn`), `createSession({onConversation, cutTurn})` and `session.startedAt`; the store begins
  the first conversation from `onConversation` (reason `first`); `welcome.conversation` before the
  first `ready` is the store's, else the session's, else `c-0001` (what the session then makes) —
  because B84 left these to T13 and session.mjs emits no `conversation.new` for the first —
  spec: `protocols.md` §11.7, §11.7.1 — overrule: the options in `bridge.mjs`/`session.mjs`.
- B101 (T14) A text frame over 64 KB closes 4413 `too big` through `ws`'s own `maxPayload` (64 KB,
  refused at the frame header, nothing buffered) with a listener put ahead of `ws`'s on the link's
  receiver (`ws._receiver`, an internal of ws 8) that closes 4413 before `ws` would close 1009; a
  binary frame over 6 400 bytes is checked in the handler — because §8 names 4413 and reading a
  frame whole only to measure it would let a screen make the room buffer it — spec: `protocols.md`
  §2.3, §8 — overrule: `closeTooBigFirst()` in `link.mjs` (an upgrade of `ws` that renames the
  internal falls back to 1009, and the 4413 test fails loudly).
- B102 (T14) The heartbeat (10 s) and the no-hello limit (5 s) run on the room clock; the WebSocket
  ping (30 s) and the 50-a-second rate count run on the real clock — because a manual clock stepped
  60 s in one `advance` would send two pings before the browser's pong could arrive and drop every
  link, and a flood limit measured on a stopped clock would refuse a test's ordinary messages; the
  heartbeat is what the page's 25 s silence reads, so it moves with `advance()` — spec:
  `protocols.md` §2.2, §8, `stand-ins.md` §1.1 — overrule: the timers in `createLink()`.
- B103 (T14) The replay buffer keeps every `seq`'d message, a message the fault hook dropped to every
  link included (B18), and a reconnect with a `lastSeq` before that message gets it replayed; a
  `lastSeq` above the room's `seq` gets a snapshot; heartbeats go to welcomed links only — because
  the dropped message is part of the shared state and §2.2 lets the screen choose a snapshot by
  sending no `epoch` after a 4000 `gap` — spec: `protocols.md` §2.2, `stand-ins.md` §1.2 —
  overrule: `replayFrom()` in `link.mjs`.
- B104 (T14) "Rate limits passed 3 times in 60 s": a second in which a link passed 50 messages is one
  pass, however many messages it dropped; each dropped message with a `seq` gets `error` `too-many`;
  the third pass inside 60 s closes 4429 `too many` (the prompt limit of T23 is not counted yet) —
  because counting each dropped message would close a single burst of 53 — spec: `protocols.md` §8
  — overrule: `overRate()` in `link.mjs`.
- B105 (T14) `GET /sent` is kept by the control port's `outbound` hook: every message for every link
  that carries a `seq` (fault-dropped ones too, as the room's replay buffer), the last 2 000,
  `?type=` the only query key (another is `400 bad-body`) — because the control is made before the
  room and reads nothing of it but the hooks (D109) — spec: `stand-ins.md` §1.2 — overrule:
  `room-control.mjs`.
- B106 (T14) `createLink({pingMs})` shortens the ping for the unit test; a silent link (stand-ins.md
  §1.2) sends no ping and answers none (`autoPong: false`, the pong goes through the outbound hook as
  `{type:'pong'}`); 4402 `revoked` waits for pairing — because "the room sends nothing on them, no
  pings answered" — spec: `stand-ins.md` §1.2, `protocols.md` §2.3 — overrule: `createLink()`.
- B107 (T15) The page learns `cockpit` from a `cockpit` field in `GET /api/v1/hello` (builder only,
  `server/routes/cockpit-hello.mjs`, the same `cockpitConfigured()` as the `/ws` hello) until the owner
  applies `patches/T15-store-hello-cockpit.diff`, which makes the fenced store keep `hello.cockpit`
  and the hub's `fleet` frame's `cockpit` as `store.source.cockpit`; `boardSaysCockpit()` in
  `public/js/cockpit/main.js` reads the store first and the v1 field as the fallback — because
  `store.js` and `net.js` are fenced and drop the field, and without it no button is ever drawn;
  the field tells nothing a page could not learn by opening `/api/cockpit/ws` — spec: `protocols.md`
  §1, D93 — overrule: apply the patch and delete the route module and the fetch.
- B108 (T15) The harness pins `@playwright/test` 1.56.1 (its Chromium is revision 1194, the one in
  `~/.cache/ms-playwright`), `trace: 'retain-on-first-failure'`, the `list` reporter, a 60 s test
  timeout, `test-results/` at the repo root — because slices §2 names the rest and these are the
  smallest choices that keep the run offline — spec: `slices.md` §2 — overrule: `e2e/playwright.config.mjs`.
- B109 (T15) `public/js/core/cockpit-constants.js` holds every D150/D287 name (and `HINT_MS`, the
  §1.2 widths, `PROTOCOL`, the 30 s retries, `MAX_PROMPT_CHARS`); the room's own modules keep their
  constants (`link.mjs` `HEARTBEAT_MS`, …) until a task touches them — because rewiring the room's
  imports is outside a page task and the values agree — spec: D150, D287 — overrule: import the
  names in `server/cockpit/*`.
- B110 (T15) A reply's label row `AGENT · HH:MM` takes the turn's first item's `startedAt`, else its
  `end.at`, else its `at` — because the snapshot's text items carry no time — spec: `c1-talk.md` §3,
  §5.1 — overrule: `replyAt()` in `public/js/cockpit/turns.js`.
- B111 (T15) `NEW` is drawn in its rect and disabled until T29 builds it; `SEND` is enabled only
  while `live` with a non-blank input and sends nothing until T18 — because a live button that does
  nothing reads as broken — spec: `c1-talk.md` §1, §5.1, §7 — overrule: T18/T29 wire them.
- B112 (T15) The `room` fixture boots one room per test (`room.start()`), not per file — because
  S-C1-26 needs a second room and a fresh room keeps one test's turns out of the next — spec:
  `slices.md` §2 — overrule: a worker-scoped fixture in `e2e/cockpit/fixtures.mjs`.
- B113 (T15) S-C1-26's "welcome held back 2 s" is done at the page's end of the link
  (`holdOutbound()` with Playwright's `routeWebSocket`: the welcome and every frame after it wait
  2 s, in order) — because the control API has no delay verb and the outbound hook can only drop —
  spec: `stand-ins.md` §1.1, §1.2 — overrule: a `POST /hold` verb on the room under test.
- B114 (T15) The fixtures' room has `fleet.id` `builder-a` and the demo topology (`writeDemoMap`) on
  its Map; S-C1-03's "a node selected and the inspector open" hands the page's store one lane
  snapshot (`seedLane()`) — because the room under test reads an empty HOME, has no lane, and the
  inspector opens only on a lane (a Map room node selects without one) — spec: `c1-talk.md` S-C1-03
  — overrule: a builder with a real lane behind the room (the demo fleet's `--cockpit`, T43).
- B115 (T15) T15 is split: S-C1-02 moves to T16 (its Given is S-C1-01's open pane on the Wall and a
  tap on the wall), S-C1-12 to T22 (it reads `[data-cockpit-follow]` and tool lines, which come with
  builds 9-10, where slices §3.1 puts reduced motion); the pane's slide already uses `--dur`, 0 ms
  with reduced motion — because a test of either now would have to skip steps the night may not
  skip — spec: `slices.md` §3.1 builds 7, 10 — overrule: PROGRESS.md's task lines.
- B116 (T15) The time module `public/js/core/cockpit-time.js` and its 13-row test
  (`test/cockpit-time.test.mjs`) are built now, the room-down line needs them; T32 keeps its three
  scenarios — spec: `README.md` "Times on the screen" — overrule: none needed.
- B117 (T15) "24 px in" counts from the pane's outer edge: 23 px padding after the 1 px left
  border (`--ck-in`), so the input starts at x 784 and the text column is 560 px — spec:
  `c1-talk.md` §1 — overrule: `--ck-in` in `public/css/cockpit.css`.
- B118 (T15) A fresh page whose room is down before any snapshot shows screens.md §7's reload line
  `The conversation shows again when the room is back.` where `Connecting…` was — because D118 says
  that line goes and the pane is never blank — spec: `c1-talk.md` §5.1, `screens.md` §7 — overrule:
  `drawNote()` in `pane.js`.
- B119 (T15) S-SCR-09 compares each view's rects with the Wall's rects as `screens.md` §4 writes
  them (the Wall page draws no cockpit before T16); T16 adds the live Wall page to S-SCR-09 — spec:
  `screens.md` S-SCR-09, D116 — overrule: T16.
- B120 (T15, round 20) Round 17's T15 (commit 57dede7, reverted by the package guard) is taken back
  whole, with the lockfile's `packages[""].license` line removed (review 18-owner finding 1;
  `pkg_guard` run locally on the HEAD and new files: exit 0); S-C1-26 now also asserts the header's
  `READY` in `--text-3` while `connecting` and `room-down` and in `--text-2` once `live` (finding 4,
  `colourVsToken()` in `e2e/cockpit/fixtures.mjs`); B115's split stands (S-C1-02 to T16, S-C1-12 to
  T22) — because S-C1-02's Given is the Wall's open pane and S-C1-12 reads `↓ NEW` and tool lines,
  none of which exist before builds 7 (Wall), 9 and 10 — spec: `slices.md` §3.1 — overrule: the task lines.
- B121 (T16) S-C1-02's "the owner taps the map at (400, 480) … with the camera moved to the tap" runs
  as two steps on the galaxy: the literal tap at (400, 480) (the pane stays open, `explore`), then a
  tap on the site the tour held, drawn left of the pane (`map.screenOf`), after which the camera's
  target is that site — because on the galaxy (400, 480) is empty sky at the overview and at a held
  site: the overview's only site is under the open pane, and the tour's legs leave the Wall's own
  `place` at the overview, so a tap there has no step back and moves nothing. The galaxy's tap rule
  ("tap a site to fly there") is the only move "to the tap" — spec: `c1-talk.md` S-C1-02, D19 —
  overrule: the second step of S-C1-02 in `e2e/cockpit/c1-wall.spec.mjs` (or a Wall change that
  makes empty sky act).
- B122 (T16) The Wall tests open `galaxy.html?ratio=0.5` (docs/wall.md's own switch) — because this
  VM draws WebGL in software: at the test's device ratio 2 a galaxy frame costs 30-40 ms and the pane
  was in place 215-238 ms after the tap; at 0.5 it is 155-200 ms (8 of 8 runs ≤ 200). B7's 200 ms is
  asserted as written; only the galaxy's pixel count is lower — spec: `README.md` B7, `slices.md` §2
  — overrule: drop `?ratio=0.5` in `openWall()` when the test machine has a GPU.
- B123 (T16) The Wall half of the handle (`screens.md` §9.1 W1-W6) is built in `galaxy/main.js` and
  `galaxy/touch.js`: W3 `pause()` is a show-like cut to the camera's current pose (a `STAY` in
  reduced motion), so the director stops the tour's flight where it is; W5 is touch.js's minute with
  `hold()`/`restart(ms)`/`holding()` (a restarted length lives on the touch state until the next
  touch); W6's `by` is `call` for the handle, a show or an undo, `touch` for a finger and `▶ TOUR`,
  `idle` for the minute — because §9.1 asks the Wall for exactly these and the Wall's one minute
  already is touch.js's — spec: `screens.md` §2, §9.1 — overrule: `pauseTour`/`resumeTourNow` in
  `galaxy/main.js`, `createTouch` in `touch.js`.
- B124 (T16) The pane drives the Wall through `public/js/cockpit/wall-hold.js` `paneOnWall(view, open)`:
  open → `tour.pause()` + `idle.hold()`, close → `idle.restart(60000)`; the Wall page loads the cockpit
  from `public/js/cockpit/wall-page.js` after its own module, and the cockpit sets
  `data-cockpit-layout="wall"` there — spec: `screens.md` §1, §2, c1-talk.md §2 — overrule: those two files.
- B125 (T16) The Wall's fleet line ends at `right: max(6vw, 112px)` while the cockpit is configured
  (x 1256 at 1368 wide, x 688 at 800) in `wall.css` — spec: `screens.md` §4 "Wall page, `wall`" —
  overrule: the rule under `.wall-fleet` in `public/css/wall.css`.
- B126 (T16) T16 is split: S-SCR-35 moves to T16b (its app steps need the Map's M1, M3, M5 in page px
  and M6 on `#/map`, and the router swapping `map`; its Wall steps use B123's W1-W6), S-SCR-25 moves
  to T24b after T24 (its state B needs `↓ NEW`, T22, and its state H the keyboard layout,
  `data-keyboard`, T24) — because a test of either now would skip steps the night may not skip —
  spec: `slices.md` §3.1 — overrule: PROGRESS.md's task lines.
- B127 (T16b) The app's handle names a builder by its builder id: `map.screenOf('builder-a')`,
  `flyTo('builder-a')` reach the Map's `builder:builder-a` node (the Map's own id still works),
  and `nodeAt` answers a builder node as `builder-a`; S-SCR-35's "the Map's own
  `screenOf('builder-a')`" is the Map's own `screenOf('builder:builder-a')`, the same node —
  because the server's Map ids builders `builder:<id>` (server/map.mjs) while the scenario and
  the fleet use the bare id, and the Map's own `idForSel` stays unchanged (its callers, the
  route's `sel=`) — spec: `screens.md` S-SCR-35, §9.2 M5, M6 — overrule: `nodeOf()` and
  `nodeAt` in `public/js/cockpit/app-view.js`.
- B128 (T16b) S-SCR-35's app steps read after the Map's arrival has come to rest (builder-a still
  over 30 frames and out of the core), not at the literal first frame — because new nodes grow
  out of their parent in beats: at the first frame builder-a is drawn on the core, where `nodeAt`
  rightly answers `__core` (and a node under 0.3 alpha is not hit, the Map's tap rule) — spec:
  `screens.md` S-SCR-35 — overrule: the rest poll in `e2e/cockpit/c1-handle.spec.mjs`.
- B129 (T16b) M1 on the app: `createMap(...).flyTo(id, z)` is `focus()` with a Promise, `false`
  at once for an id that is unknown, folded away or leaving (then nothing moves, where `focus`
  would unfold it), and a flight is cut (false) by a newer flight, `fit()`, a finger (`grab`) or
  the wheel; M3 `camera()` and M6 `nodeAt(x, y)` in canvas px are added beside it; the page-px
  handle (`public/js/cockpit/app-view.js`) is set by `initCockpit({page: 'app'})` and its `map`
  swapped in `views/map.js` mount/unmount; S-SCR-35 runs without `?demo=1` (the room under test
  serves the demo topology; the `?demo=1` page is T40) — spec: `screens.md` §9.2, §9.3 —
  overrule: those three files.
- B130 (T17) S-C1-45 moves to a new T18b right after T18: its last step types `how is builder-a`,
  taps `SEND` and reads the prompt block's right edge and `[data-reply]`'s column, and sending and
  the turn drawn as it comes are T18's; its layout (pane x 416-1024, input x 440-920, `SEND`
  x 936-1000, corner `CLOSE` x 944-992, y 616-664 at 1024x768, app and Wall) is built now and
  was measured in round 25's stills — because a test now would skip a step the night may not
  skip — spec: `c1-talk.md` S-C1-45, `slices.md` §3.1 — overrule: PROGRESS.md's task lines.
- B131 (T17) Under 900 px the open pane makes every child of `<body>` but the pane, its opener
  and scripts `inert` (the attribute), and gives back only what it set; S-C1-46's "the Map's
  container" is the app's `#shell` (header, Map, inspector and bar: the pane leaves nothing
  else to tap, so `CLOSE` or `Esc` is the only way back), on the Wall page the galaxy's stage;
  the test asserts `#shell[inert]` and that `#map-root`'s nearest `[inert]` is `#shell` —
  because D249 makes the whole view behind unusable, not the Map alone, and one rule covers both
  pages — spec: `c1-talk.md` §1.2, D249 — overrule: `coverView()` in `public/js/cockpit/pane.js`.
- B132 (T17) The fit is one root attribute `data-cockpit-fit="side|full|none"` set by
  `public/js/cockpit/fit.js` `paneFit(innerWidth, innerHeight)` on load and on every `resize`
  (the CSS's 100 vw pane and no left border hang on `full`; below the floor the toast stack stays
  where it is today and the opener is taken out of the DOM); with a full-width pane open the
  toast stack keeps its right edge (there is no "left of the pane") — because JS and CSS then
  read the same width rule and the floor's height has no clean media query twin — spec:
  `c1-talk.md` §1.2, screens.md §4 (D158) — overrule: `fit.js`, `applyFit()` in `pane.js`, the
  `data-cockpit-fit` rules in `public/css/cockpit.css`.
- B133 (T17) In a browser below the floor (`fit.js` `tooOld`: `WebSocket`, CSS `min()`, `inert`)
  the pane's header keeps `COCKPIT`, `NEW` (disabled) and `CLOSE` but hides the turn word: no
  room is behind it, and a greyed `READY` would say there is; the root's `data-cockpit` stays
  `connecting` (README's list has no value for it) — spec: `c1-talk.md` §1.2, D250 — overrule:
  the `unsupported` branch of `createPane`.
- B134 (T17) The header buttons sit at y 8-56 of the 64 px header (top-aligned, 8 px in), not
  centred in the 63 px above its bottom border (that drew them at y 7.5-55.5) — spec:
  `c1-talk.md` §1.2's table (header `CLOSE` y 8-56 / 44-92), `screens.md` §4.1 — overrule:
  `.ck-headbtns` in `public/css/cockpit.css`.
- B135 (T18) The prompt's `focus` is built by `public/js/cockpit/focus.js` `focusNow({page})`: the
  app's route parsed from `location.hash` with the router's grammar (not by importing
  `router.js`, which pulls the app's shell onto the Wall page), a route key over the room's limit
  or with a control character left out (so a long search box never costs the prompt a
  `bad-message`), on the Wall `{view:'wall'}` with `data-wall-state` and the layout, `inSight: []`
  until C3 — spec: `c3-see.md` §8.1, `protocols.md` §3.1 — overrule: `focus.js` (C3's focus
  messages replace it).
- B136 (T18) A prompt drawn at the tap and not yet echoed survives a snapshot (it is appended
  after the snapshot's turns, `· SENDING` kept) unless the snapshot holds a turn with its
  `clientId`; SEND (click) sends now, Enter/Shift+Enter, the 5 s E1 and `data-send="wait"` stay
  T23's and T25's; a queued echo from another screen draws nothing yet (T25) — spec:
  `c1-talk.md` §7 "On send", §8 — overrule: `sendNow`/`promptEcho`/`drawSnapshot` in `pane.js`.
- B137 (T18) The streaming cursor `▍` is a `::after` of the block being written (class
  `ck-streaming`), not a character in the DOM, so `[data-reply]`'s `textContent` is exactly
  the text the room sent; S-C1-04 reads it with `getComputedStyle(block, '::after').content`.
  The cursor moves to the newest block a delta writes, and goes at that block's `text.block`
  and at `turn.end` — spec: `c1-talk.md` §3 "Streaming" — overrule: `.ck-streaming` in
  `cockpit.css`, `follow()` in `turns.js`.
- B138 (T18) The delivery word's span takes the `--text-1` of D270 (newer) over §7's "the
  `SENDING` in `--text-3`" — spec: `c1-talk.md` §3 (D270) vs §7 "On send" — overrule: `.ck-delivery`.
- B139 (T18) The reply's `AGENT · HH:MM` row takes its time from the first delta's `sentAt`
  (or the first call's `startedAt`, B110); a reply that only arrives as a complete block takes
  the screen's time of its arrival — spec: `c1-talk.md` §3 — overrule: `blockOf()` in `turns.js`.
- B140 (fix, round 27) `turn.state` `answering` reaches the screen with the text: the room sends it with
  the first `text.delta` it lets out (not on an agent delta it still holds, D211), and the pane sets
  `data-turn="answering"` in the animation frame that draws that text — because §3's table says
  `answering` is "reply text is streaming" and S-C1-04 reads `thinking` until the first text is on
  screen — spec: c1-talk.md §3, protocols.md §5 (5.20) — overrule: set it on the agent's first delta.
- B141 (T18b) S-C1-45's "the Wall page in `wall`" is the Wall page with `data-cockpit-layout="wall"`
  (at `?ratio=0.5`, B122); the send step runs on both pages (app, then the Wall, one room, the
  `c1-session` answer twice); the prompt block is read as the element after the turn's `YOU` label
  row (the spec names no selector for it); the Map's pan is checked by `room-b` moving > 20 px and
  `camera()` changing, as S-C1-03 reads it — spec: `c1-talk.md` S-C1-45 — overrule: the test in
  `e2e/cockpit/c1-small.spec.mjs`.
- B142 (fix, round 29) The pane's slide, in and out, starts in the frame of the tap: right after
  `data-pane` changes, `setOpen` sets each pending animation's `startTime` to
  `document.timeline.currentTime` (`startSlideNow` in `public/js/cockpit/pane.js`); the transition
  is still the CSS one, 120 ms, `--ease` — because a fresh transform transition waits about two
  frames for the compositor before it starts, so the pane was in place 150-170 ms after the tap on
  an idle VM and over 200 ms under the other agents' load (S-C1-01 failed at 231.8 ms); now it is
  in place about 120-150 ms after the tap — spec: `c1-talk.md` §2, README B7 — overrule: drop
  `startSlideNow`; B7 then needs a faster machine or a wider row (the owner's).
- B143 (T19) md.js keeps a paragraph's source lines as lines (`\n` runs, drawn `pre-wrap`), not
  CommonMark's soft breaks joined by a space; a `tail` that continues the paragraph above
  (`joins: true`) is drawn inside that paragraph on its own line, so the line being written does
  not jump 16 px when its newline arrives; `parse(text, {done})` reads the last line whole once the
  block is complete (its `text.block`, the turn's end, a settled snapshot turn) — because an agent's
  line breaks carry its layout (S-C1-10's 30 lines), and §3 "Streaming" names `tail` only for a line
  "with no newline yet" — spec: `c1-talk.md` §3 "Streaming", "The renderer" — overrule: join soft
  breaks in `parse`; draw a `tail` as its own block.
- B144 (T19) The streaming cursor `▍` (B137) moves from the text block's box to the element holding
  its last character (the paragraph, the list item, the code line, the last table cell; while a long
  code block is folded, its 12th line); S-C1-04's recorder reads the one element with a `▍` `::after`
  and checks it holds the reply's last text node — spec: `c1-talk.md` §3 "Streaming" — overrule:
  `drawText()`'s returned host in `public/js/cockpit/reply.js`.
- B145 (T19) The renderer's DOM half is `public/js/cockpit/reply.js` (`drawText`), md.js stays pure;
  a heading is a `div role="heading"` (`aria-level` 3-5), a list `role="list"` of `div`s with the
  marker in a 32 px min-width box and 8 px to its text (a `10.` marker is wider than the 32 px hanging
  indent), `○` grey as `●` (`--text-2`), a link whose URL has no http(s) host draws its text with no
  ` (host)`; a table's first column is fixed on `--bg-elevated` only while the table is wider than its
  block (`ck-md-wide`) — spec: `c1-talk.md` §3 "What a reply may contain" — overrule: `reply.js`,
  `.ck-md-*` in `cockpit.css`.
- B146 (T19) S-C1-42's second case (the same turn after S-C1-18's E1, the `[data-turn-error="not-sent"]`
  line) moves to T23, which builds E1; T19's test has the first case in both themes — because the
  not-sent line does not exist before T23 and a skipped step there is not a wait §3.1 names —
  spec: `c1-talk.md` S-C1-42, `slices.md` §3.1 — overrule: build E1 earlier.
- B147 (T19) A code block is as wide as its longest line, the folded lines included (the lines'
  `min-width` from `--ck-code-ch` set through CSSOM), so a folded block scrolls sideways the same as
  an open one; S-C1-08's 200-character line is line 17 of 40, folded at first — spec: `c1-talk.md`
  §3 "Code", S-C1-08 — overrule: drop the min-width; S-C1-08 then checks the sideways scroll after the tap only.
- B148 (T19) S-C1-42's "every element under `[data-cockpit-conversation]`" is read as the conversation
  that scrolls (`.ck-convo`): the header's and input row's buttons carry their 1 px `--line-strong` as
  tappables (README "Touch") and are not lines in the conversation — spec: `c1-talk.md` S-C1-42, §3
  "The cockpit's own lines" — overrule: the test in `e2e/cockpit/c1-render.spec.mjs`.
- B149 (T19) md.js's regexes avoid quote and backtick characters (`\x60`, a Set for a URL's trailing
  punctuation) because `test/frontend.test.mjs`'s source scanner does not know regex literals; its
  linear-time rule (D146) also covers inline scanning: a closer not found ahead is not looked for again —
  spec: D146 — overrule: none needed.
- B150 (T20) The fake agent ends a tool call no sooner than its scripted span (`endAt − at`) plus
  10 ms after its start actually went out (`SPAN_MARGIN_MS`), not only at `t0 + endAt` — because
  a start fired 1 ms late, or the room receiving it 1-2 ms late, gave `endedAt − startedAt` of 798-799
  for a scripted 800, below S-C1-25's "at least the scripted span"; 10 ms stays far inside its
  "at most 100 ms more" — spec: `stand-ins.md` §2.3, `c1-talk.md` S-C1-25 — overrule: drop the margin
  and let S-C1-25 allow the receipt's jitter.
- B151 (T20) The `●` glyph and `+`/`−` are the stylesheet's (`::before`, `::after` of the
  `<button data-tool-line>`), the words a span and the opened rows `<span data-tool-row>` children of
  the button — because S-C1-35 reads a line's `textContent` as exactly its words, while S-C1-07 says
  the rows are the line's children and the whole row is the tap target (a button holds phrasing
  content only, hence spans) — spec: `c1-talk.md` §5 "Look", "Open"; S-C1-07, S-C1-35 — overrule:
  glyphs as text spans and the tests read a `.ck-tool-words` span instead.
- B152 (T20) Where §5 leaves it open: `…` ends the whole text, after ` · 1 failed`
  (`read 3 feeds · 1 failed…`); a row whose call still runs ends `<tool>  <input>  …`, and one the
  turn's end cut (no `tool.end`) ends after its input; a 120-character cut of the input adds `…`;
  calls that all have no target keep the `one` (no-target) text, so two `lanes {}` calls read
  `looked at the lanes`, while a tool with no target field (`Grep`, `alerts`) reads `many` from two
  calls; `focus`'s "this screen" compares with `opts.screen`, which C1's pane does not pass yet (so
  only a missing `screen` reads `this screen` until C3) — because these are the readings closest to
  §5's examples — spec: `c1-talk.md` §5, §5.1 — overrule: in `public/js/core/tool-words.js`.
- B153 (T20) A tool line whose words do not fit the text column wraps to a second line (the row
  grows past 48 px) rather than cutting: at 18 px mono a 560 px column holds about 46 characters, and
  `looked at CI on ` plus a 33-character target is 49 — because cut-off text is a bug and §5 already
  cuts the target to 32 — spec: `c1-talk.md` §5 "Look" (one row, 48 px), "Shortening" — overrule: a
  shorter target cut, or `text-overflow: ellipsis` on the words.
- B154 (T20) S-C1-06 runs on the turn it shares with S-C1-07 (`check the sites`, `hv2` `isError`,
  `stand-ins.md` §5), so its test compares each sample's words without the ` · 1 failed` that turn
  adds (`read 3 feeds` with no `●` at the end); S-C1-07 asserts that suffix exactly — spec:
  `stand-ins.md` §5 c1-render row, `c1-talk.md` S-C1-06/07 — overrule: a separate clean turn for S-C1-06.
- B155 (T20) A `tool.start` or `tool.end` the pane cannot place (an unknown `turnId` or
  `toolUseId`) is dropped, as `text.*` already is; D119's close-with-4000-and-snapshot is not built
  for any message yet — spec: `c1-talk.md` §5.1 "A message the pane cannot place" — overrule: none;
  the D119 gap is a later task's (named under `## Later`).
- B156 (T21) A call that folded at its `tool.start` and is refused at its `tool.end` (claude-code says
  `permission_denied` only after the start, so two parallel `WebFetch` calls fold before either is
  known refused) leaves its line for a `tried` line of its own: the line keeps its place; if the
  refused call was the line's first, that line becomes the `tried` line and the calls after it move
  to a new line at the first one's `blockIndex`. Calls known refused (a snapshot, a later start)
  never fold either way — because §5.2 says a refused call "holds that one call and never folds" and
  the fold rule cannot know at the start — spec: `c1-talk.md` §5.1 "The fold rule", §5.2 — overrule:
  `splitDenied()` in `public/js/cockpit/turns.js`.
- B157 (T21) The `{tool}` of a `tried` line and of an opened row is one name: `Bash`, `WebFetch`,
  another MCP server's `<server>:<tool>`, and a laneboard MCP tool without its `mcp__laneboard__`
  prefix (`tried fleet, not allowed`), as §5 matches those tools everywhere else; a refused call's
  opened row shows its whole input wrapped (`.ck-tool-whole`), as a tool that changes things does —
  because §5.2 names only the other-server case and says "whole input, wrapped" — spec: `c1-talk.md`
  §5.2 "A refused call" — overrule: `shownName()` and `wholeInput()` in `public/js/core/tool-words.js`.
- B158 (T21) S-C1-30's "no line of §10 is drawn" is asserted as no `[data-turn-error]`, no
  `[data-cockpit-line][data-line="error"]` and `[data-cockpit-status]` hidden (the pane keeps that
  element and hides it when no status holds); S-C1-30 and S-C1-31 live in `e2e/cockpit/c1-tools.spec.mjs`
  with the other tool lines. The room's side (redaction before the cuts, `denied` on `tool.end`, the
  launch line) was already built by T9-T12; T21 adds only the pane's side — spec: `c1-talk.md` S-C1-30,
  README "Selectors tests use" — overrule: a `toHaveCount(0)` once the status line is made on demand.
- B159 (T22) The age is redrawn on a timer set to the running turn's own whole seconds (the first at
  its 3 s, then every 1 s of its count), not on a free 1 s interval, so `0:03` shows at 3 s and not
  up to a second later; every other counter keeps its own tick — because S-C1-21 reads the row at
  2.9 s and 3 s exactly — spec: `c1-talk.md` §9 "redrawn every 1 s with the screen's other
  counters" — overrule: `ageTick()` in `public/js/cockpit/pane.js` on the shared `TICK_MS` interval.
- B160 (T22) `↓ NEW` shows once something new comes while the view is unpinned (text, a tool line,
  a turn, the `AGENT` row made at 3 s, a snapshot), not on the drag itself; the age counting in a
  row already there is not "new" — because a drag up through old turns with nothing arriving has
  nothing new to jump to — spec: `c1-talk.md` §4 "A drag up unpins it … A button `↓ NEW` appears" —
  overrule: `grew()` in `pane.js` shows it on every unpinning scroll.
- B161 (T22) S-C1-21 reads "t = 3 s" 5 ms after the turn's start as the pane computes it (the
  echo's `at` plus the page's clock at the `welcome` minus `welcome.now`, recorded by an init
  script in the same task as the pane's own reading), and 12 s and 15 s likewise 5 ms after;
  2.9 s exactly — because the fake clock flows until the echo and two `Date.now()`
  in one task can differ by a millisecond — spec: `c1-talk.md` S-C1-21 — overrule: pause the
  page's clock before the load (needs every boot timer run by hand).
- B162 (T22) S-C1-21's "the reply's drawn text is all 26 000 characters" is asserted as: the
  room sent 26 000 characters, and the reply's `textContent` equals md.js + reply.js drawing those
  26 000 characters whole (a detached node in the page); the drawn `textContent` is shorter than
  26 000 because a table's pipes and separator row are not drawn (D23) — the contradiction is
  under For the owner — spec: `c1-talk.md` S-C1-21 `Test:`, §3 D23 — overrule: a script whose
  drawn text is 26 000 characters, then `textContent.length` 26 000.
- B163 (T22) Under `page.clock` Playwright's fake `performance` makes `mark`/`measure` no-ops and
  every `getEntries*` empty, so S-C1-21's test gives the page's `performance` the real methods back
  in an init script (its `now` stays the fake); the pane calls `performance.mark` as on the real
  screen — because S-C1-21 asks for a fake clock and the B9 measure in one test — spec: README B9,
  `c1-talk.md` S-C1-21 — overrule: none in the product; the test's two init scripts.
- B164 (T22) S-C1-34 split off to T22b after T32: its chip is `ASK ABOUT THIS` (S-C3-10, the C3
  slice: no chip is built in C1), its room-down line slot is build 16 (T32) and its length note and
  182 px input are build 11 (T23) — because a test of a stack whose three parts do not exist yet
  cannot pass, and §3.1 names no wait for it — spec: `slices.md` §3.1 (S-C1-34 in C1),
  `c1-talk.md` S-C1-34 — overrule: the owner's answer under For the owner.
- B165 (T22) `↓ NEW` sits in a band (`.ck-band`, position relative) holding the conversation's
  scroller, 16 px above the band's bottom, centred over the text column by `calc()` on `--ck-in`
  (x 1016-1112 at 1368, x 352-448 at 800); the stack items of §1.1 will go between the band and
  the input row, so `↓ NEW` follows the topmost with no measuring — spec: `c1-talk.md` §1.1, §4 —
  overrule: `.ck-follow` in `public/css/cockpit.css`.
- B166 (T22) The B9 marks are set only for this screen's own typed prompt (`cockpit:B9:start` at the
  SEND tap, the end and the measure once the first text block's drawn text holds its first
  sentence: `firstSentenceDone()` in `turns.js`, c5-c6.md §1's rule, or a blank line after the
  first paragraph, or the block complete) — because B9 starts at this screen's tap — spec: README
  B9 — overrule: `onFirstSentence` in `pane.js` `sendNow()`.
- B167 (T22) A done turn from the snapshot shows its total age when it ran 3 s or more (seeded
  turns of 8 s read `AGENT · 07:02 · 0:08`), the total from `end.at − at`; the `AGENT` row made at
  3 s before any item carries the turn's own start time — spec: `c1-talk.md` §9 "then the label
  keeps the total" — overrule: `tick()` in `public/js/cockpit/turns.js`.
- B168 (T23) The input's padding is 11.4 px top and bottom and 15 px left and right inside its 1 px
  border, so the spec's 12.4 px and 16 px count from the outer edge: one line is exactly 64 px, each
  more 39.2 px, and the text 368 px wide; `grow()` reads the line count from `scrollHeight` at the
  one-line height (`draft.js` `linesFromScroll`) and sets 64 / 103.2 / 142.4 / 181.6 px; the row is
  `--ck-row-h + --ck-grow` with `SEND` at its bottom — because a 12.4 px padding plus the border made
  one line 2 px too tall for its box (a scrollbar at 4 lines) — spec: `c1-talk.md` §7 "The input",
  "It grows" — overrule: `.ck-input` in `public/css/cockpit.css`, `grow()` in `pane.js`.
- B169 (T23) E1's 5 s count only while the link is live: a prompt whose 5 s run out while the link
  is not `live` waits, and its 5 s start again when the link is live (then E1 if still no echo) —
  because §10 E1 says "link up", and what a send in the room-down grace does is screens.md §7's (T32)
  — spec: `c1-talk.md` §10 E1, `protocols.md` §3.1 "link down at the send" — overrule:
  `waitForEcho()` in `public/js/cockpit/pane.js`.
- B170 (T23) A `turn.prompt` echo that comes after E1 (the room had the prompt after all) removes
  the not-sent line and confirms the block as any echo does — because the room's echo is the
  confirmation (D95) and a turn that runs under a `NOT SENT` label would be wrong — spec: silent
  (`protocols.md` §3.1) — overrule: `promptEcho()` in `pane.js`.
- B171 (T23) Blocks showing E1 survive a snapshot redraw (as B136's `· SENDING` blocks do), drawn at
  the end before the unconfirmed ones; a snapshot that holds their `clientId` drops them (the room's
  turn is the one) — spec: silent — overrule: `drawSnapshot()` in `pane.js`.
- B172 (T23) An `Enter` that cannot send (white space only, over the limit, the room not live) does
  nothing: no prompt and no line break; an `Enter` that ends an IME composition (`isComposing`,
  keyCode 229) is the composition's — because S-C1-15 says "`Enter` sends nothing", and a line break
  there would grow a draft the owner meant to send — spec: `c1-talk.md` §7 "Keys", S-C1-15 —
  overrule: the `keydown` listener in `pane.js`, `isSendKey` in `public/js/cockpit/draft.js`.
- B173 (T23) The error line's buttons (`RETRY`, `EDIT`) are 96x48 with a 1 px `--line` border, not
  the header buttons' `--line-strong`, and keep the focus where it was (`preventDefault()` on
  `pointerdown` and `mousedown`, D132) — because S-C1-42 asserts that inside the conversation only
  `[data-turn-label]`, `[data-turn-error]` and `[data-turn-stopped]` carry a `--line-strong` side, and
  §10 names no border for them — spec: `c1-talk.md` §10 "Look", S-C1-42 — overrule: `.ck-err-btn`
  in `cockpit.css` (and widen S-C1-42's set to the buttons).
- B174 (T23) The `AGENT` row and its age that the 3 s tick made while a block waited for its echo
  (B159) go when the block shows E1, and no age comes back on it: nothing ran — spec: `c1-talk.md`
  §9, §10 E1 — overrule: `fail()` in `public/js/cockpit/turns.js`.
- B175 (T23) Split: T23 builds typing, the input's growth, the length note in the line slot and E1
  (the 5 s line, `RETRY` with the same `clientId`, `EDIT` with the focus and caret, `bad-message` as
  E1 at once) with S-C1-14, S-C1-15 and S-C1-42's second case; S-C1-18 moves to T23b after T24, since
  its steps assert `data-keyboard="up"` and the input at y 460-524 (§7.1, T24's) and the tap on the
  conversation that blurs the input (§7.1 "Putting it away"); S-C1-43 moves to T23c after T30, since
  it needs the room's rate limit (D228, `prompt.refused` `too-many`, none yet: `audit-lines.mjs`
  says the `too-many` refusals are T30's) and its audit refusal line (D165), plus E9's 60 s `RETRY`
  — because the task held three slices' worth of work — spec: `c1-talk.md` §7, §7.1, §10 —
  overrule: the task lines in PROGRESS.md.
- B176 (T23) The length counts the input's value as typed or pasted, untrimmed, in JavaScript string
  length (UTF-16 units, as `server/cockpit/protocol.mjs` counts it); the limit is
  `welcome.config.maxPromptChars`, else `MAX_PROMPT_CHARS` — spec: `c1-talk.md` §7 "Length" —
  overrule: `lengthNote`/`canSend` in `draft.js`.
- B177 (T23) The line slot `[data-cockpit-line]` is the pane's child between the conversation's band
  and the input row (so `↓ NEW` floats 16 px above it and the conversation ends on its top edge);
  `--ck-lift` (the slot's height plus the input's growth) makes the scroll area's bottom padding
  `max(0, 64 px − lift)` (D267). C1 fills it with `length` only; `room-down` is T32's, `hint` and
  `error` C2's — spec: `c1-talk.md` §1.1 — overrule: `drawLine()` in `pane.js`.
- B178 (T23) Page code under `public/js/` cites decisions D30-D39 by their spec section, not by id:
  `test/render.test.mjs`'s "no chart library" guard reads `/d3/i` over all page JS — spec: none
  (a repo test) — overrule: make that guard match `\bd3\b` imports only.
- B179 (T23, for T23c; review 35-security finding 5) C1 has no device token (pairing is Q-O21's,
  C1 runs behind the board's trust), so the room's prompt rate (D228: 10 in any 60 s) is keyed by
  the screen: every link counted together under the one `board` screen (`SCREEN_NAME` in
  `server/cockpit/link.mjs`), so two tabs or pages do not double the rate; with pairing the key
  becomes the device token as written — because that is the safe reading and S-C1-43's two pages
  share one count — spec: `c1-talk.md` §7 "Rate", S-C1-43 — overrule: the key in T23c's limit.
- B180 (T24) The keyboard is its own module, `public/js/cockpit/keyboard.js`: the pure numbers
  (`visibleBottom`, `keyboardWord`, `inputCap`, `createTallest`, `KEYBOARD_MIN_PX` 120,
  `KEYBOARD_ROW_PX` 88, `CONVO_KEEP_PX` 200) and `watchKeyboard()`, which sets `data-keyboard`
  and two root properties, `--ck-vv-top` (the visible top) and `--ck-kb-gap` (layout bottom minus
  visible bottom); `cockpit.css` places the pane between them and lifts the opener to
  `gap + 88 px`, last in the file so it wins over the Wall's and the app's own rects. The
  constants stay in the module, not `cockpit-constants.js`: they are layout px, not tunables
  of §16 — because one reading drives both the shrunk layout viewport and the
  `navigator.virtualKeyboard` rect with no per-page code — spec: `c1-talk.md` §7.1, D130, D131 —
  overrule: move the three constants to `cockpit-constants.js`.
- B181 (T24) §1.2's height floor (560 px) is measured on H, the tallest `innerHeight` seen at
  this width (§7.1), while the input has the focus, and on `innerHeight` otherwise; the fit is
  read on window `resize` only, so the blur that puts the keyboard away at 532 px does not close
  the pane before the window grows back (S-C1-32 step 4) — because §1.2 says the floor is on
  the layout viewport "so the on-screen keyboard never trips it", and S-C1-32/33 shrink the
  layout viewport to 532 with the pane open (review 30-touch finding 4, For the owner) — spec:
  `c1-talk.md` §1.2, §7.1, D250, D130 — overrule: `floorHeight()` in `pane.js`.
- B182 (T24) D132 for every `<button>` in the pane, not only `SEND` (T49 named `SEND` alone):
  `preventDefault()` on `pointerdown` and `mousedown` while the input has the focus, so a
  control tapped with no keyboard up still takes the mouse's focus as before. T49 keeps its
  S-C1-04 step; its product change is in — spec: `c1-talk.md` §7.1 "Taps keep the keyboard up"
  — overrule: `keepFocus` in `pane.js`.
- B183 (T24) The blur tap (§7.1 "Putting it away") starts on the conversation's scroll area or
  the header, outside any button, textarea, input or link, and ends in a `pointerup` within
  `TAP_SLOP_TOUCH` (8 px, imported from `views/map/interact.js`) by distance; a scroll ends in
  `pointercancel` — spec: `c1-talk.md` §7.1 — overrule: the two listeners in `pane.js`.
- B184 (T24) S-C1-32's third run (a `· QUEUED` block with the keyboard up, T125) needs the queue
  of §8, which is T25's: moved to T25 as a step of S-C1-32 in `c1-keyboard.spec.mjs` — because
  a step written now would be a skip the night may not take — spec: S-C1-32, slices.md §3.1 —
  overrule: none (T25 adds it).
- B185 (T24) S-C1-32's first run runs on the app's `#/map` and then on the Wall page in one
  test (screens.md §9.3: the app first, the Wall run with the same assertions); each run's
  prompt adds a turn, so the runs open on 12, 13 and 14 turns. The `virtualKeyboard` run uses a
  second page of the same context with the stub as an init script, `boundingRect` a `DOMRect`
  at the window's bottom — spec: S-C1-32 "Test:" — overrule: the test file.
- B186 (T24) The pane re-reads the input's height (`grow()`) whenever the link's state is drawn,
  so the room-down status line coming or going changes the cap with the keyboard up at once,
  not at the next keystroke — spec: `c1-talk.md` §7.1 "The input grows" — overrule: `render()`.
- B187 (T23b) S-C1-18's 60 s on the page clock run with the room's clock `manual` and moved with
  it in 10 s steps (`advanceBoth`, each step's `heartbeat` heard before the next), so the link stays
  live past the page's 25 s silence and "nothing more sent" is read on a live link, not after a
  reconnect; the three runs are three fresh pages on one room, each re-arming `POST /drop`; "the
  same frame" is read in a document `click` listener after `EDIT`'s own — because the scenario
  names the page clock only and a 60 s jump with a real-time room drops the link (protocols.md §2.2)
  — spec: `c1-talk.md` S-C1-18, `stand-ins.md` §1.1 advance(ms) — overrule: `c1-typing.spec.mjs`.
- B188 (T24b) The line slot's `room-down` message (`Sending and voice come back with the room.`,
  `data-line="room-down"`) is built here, ahead of T32: S-SCR-25's state B reads it at y 776-808.
  It shows while `data-cockpit="room-down"` after the grace and the link was not refused (a refused
  link's own lines are T33's, S-SCR-24) and outranks the length note (D133), which waits under it.
  S-C1-33's test therefore reads `[data-cockpit-line][data-line="room-down"]` and its text in the
  same 32 px slot, every number kept (the T24 note under `## For the owner`) — because the newer D133
  and S-C1-34 put `room-down` above `length`, and S-SCR-25 cannot pass without the line — spec:
  `c1-talk.md` §1.1, `screens.md` §7, S-C1-33, S-SCR-25 — overrule: `drawLine()` in
  `public/js/cockpit/pane.js` and S-C1-33's step in `c1-keyboard.spec.mjs`.
- B189 (T24b) S-SCR-25's walk collects only the Test: line's selectors (`RETRY NOW` in the status
  line is not in it), reads the toasts' buttons for the pairwise check and the stack's own rect for
  the toast rule, and measures the line slot by its text (a `Range`: from x 784, ending ≤ x 1264),
  since the slot's padding reaches the pane's edges (x 761-1288) — because §1.1 places the text,
  not the padded box, and the box is not tappable — spec: `screens.md` §4.1, `c1-talk.md` §1.1 —
  overrule: `e2e/cockpit/c1-corner.spec.mjs`.
- B190 (T24b) The opener's rule is `.ck-btn.ck-open`: `.ck-btn`'s `padding: 0 8px`, later in
  `cockpit.css`, won over `.ck-open { padding: 0 }`, so `CLOSE` (38.1 px) overflowed a 30 px
  content box to the right and sat 3.9 px off x 1312 (D273 allows ± 1 px) — a bug fix found by
  S-SCR-25's label box — spec: `screens.md` §4 (D273) — overrule: none (the spec's numbers).
- B191 (fix, round 87) The held `answering` is released only by a frame in which its turn has reply
  text on screen (`view.hasText()`), not by the next animation frame: the room sends `turn.state` and
  the first `text.delta` as two WebSocket frames, and a frame between them set `answering` over an
  empty reply (S-C1-04 flaked on it) — because §3's table: `answering` is "reply text is streaming" —
  spec: `c1-talk.md` §3 — overrule: a turn that already shows text (a block before a tool line) still
  releases at once; hold per block if a later scenario reads `thinking`/`working` there.
- B192 T25: with `stt.url: none` (D265) `SEND` sits in the talk button's rect, x 1280-1344, so the
  taps S-C1-16 and S-C1-32's third run write at x 1232 (SEND's rect beside a talk button) go to
  SEND's centre, (1312, 856) and (1312, 492); the slot's rects are asserted as x 1280-1344 — because
  §3.1's C1 rule asserts the `none` layout in the talk button's place — spec: `slices.md` §3.1,
  `c1-talk.md` S-C1-16, S-C1-32 — overrule: C2 moves them back to x 1232 / 1200-1264 with the talk button.
- B193 T25 builds the slot's `send`/`wait`/`stop` faces (D268), the `stop` message with
  `data-turn="stopping"` at the tap, and `Dropped by STOP.` on the receipt's cancels, because S-C1-16
  (the press that stops nothing) and S-C1-29's second case (STOP, then a reload) need them; T26 keeps
  the `STOPPED AT` line, the forced stop and S-C1-17/-27 — because one slot, one module, built once
  — spec: `c1-talk.md` §8 — overrule: none needed, T26 only adds.
- B194 A prompt sent during a turn is drawn at the tap as its own `SENDING` block at the end of the
  conversation (B8); at the `queued` echo it moves into the running turn's `.ck-queue`, after
  everything the turn draws, under its `[data-turn-id]`, as a snapshot's queued item is drawn
  (S-C1-29: "the item under `[data-turn-id]`"); taken, it stands in `.ck-reply` before the first item
  with `blockIndex` ≥ `atBlock` (placed at key `atBlock − 0.5`, send order kept); cancelled, it stays in
  the queue with `NOT SENT` and its line — because one place per state, live and after a reload, and
  text the agent writes before the take goes above it by construction — spec: `c1-talk.md` §8,
  `protocols.md` §2.2, §3.4 — overrule: keep the queued block outside the turn (S-C1-29's selector changes).
- B195 A turn started by a queued prompt (§8 "The turn ends first", D258) keeps the block's label time
  (the send) and counts its age from the take on the page's clock, so its `AGENT` row comes at its
  first item or 3 s after the take, not at once — because §8: "the `AGENT · HH:MM` label row comes as
  a new turn's" — spec: `c1-talk.md` §8, §9 — overrule: count from the send (the row shows at once).
- B196 The room's resend (D123) is armed for every prompt queued in a turn at that turn's
  `turn.end`, on the room clock; at 10 s a turn running holds it (that turn's end arms it again);
  a receipt's `stillQueued` excludes it; the resend's UUID maps to the same prompt, so a `taken` for
  either takes it; the log line is `cockpit agent: prompt.resend <first uuid> <resend uuid>`; the
  timers go at the child's exit and the bridge's close — because §3.4 "never resent while a turn
  runs" and "a `taken` for either UUID takes it" — spec: `protocols.md` §3.4 — overrule: resend at
  10 s even during a later turn.
- B197 A `prompt.taken` keeps the pin rule in the same task (`grew()` right after the DOM change),
  not at the next frame, so a `Dropped by STOP.` line with its buttons never ends below the fold with
  `↓ NEW` showing (seen in the round's stills; S-C1-29's second case now asserts it on 6 seeded
  turns) — spec: `c1-talk.md` §4 — overrule: none.
- B198 A `prompt.taken` naming a `clientId` the pane does not hold (or an unknown `turnId`) closes the
  link with 4000 `gap` through `link.gap()` (`createPane({onGap})`), as `protocols.md` §3.4 says; the
  pane's other turn messages keep dropping what they cannot place (T29 builds D119 for them) —
  spec: `protocols.md` §3.4, D119 — overrule: drop it and log.
- B199 S-C1-29 is one test: its second case (STOP, then a reload) boots a second room (the fake
  agent's long `check all lanes` turn plays once per room), with 6 seeded turns; the fake agent's
  log goes on in one file, so counts are taken from where the first case left them. S-C1-32's third
  run is on the app's `#/map` (S-C1-16's page) — spec: `c1-talk.md` S-C1-29, S-C1-32 — overrule: none.
- B200 (T26) The time in `STOPPED AT HH:MM` is the turn's end (`turn.end.at`, or a snapshot's
  `end.at`) moved onto the page's clock with the welcome's offset, not the tap's own time: a reload
  or a second screen has only the end's time, so every screen and every reload draws the same
  minute (a forced stop can read one minute later than the tap) — spec: `c1-talk.md` §8 "What a
  stopped turn looks like", S-C1-17 ("HH:MM from the page's clock") — overrule: keep the tap's time
  on the screen that tapped (the others still need the end's).
- B201 (T26) The stopped turn's text is frozen at the tap on the screen that tapped (`freeze()` in
  `stopNow`), and on every other screen at the room's `turn.state` `stopping`, as is a snapshot turn
  whose state is `stopping`: deltas, complete blocks, tool starts and tool ends after that point are
  not drawn, and the `▍` cursor goes at once. A `turn.state` other than `stopping` arriving while the
  header reads `● STOPPING` for the running turn is ignored (sent before the room read the `stop`)
  — spec: `c1-talk.md` §8, D33, `protocols.md` §3.3 — overrule: keep drawing until the `turn.end`.
  Note for later rounds: `public/js` comments cite D33 as "§8": `test/render.test.mjs`'s chart
  guard reads `/d3/i` in the app's JS as a chart library.
- B202 (T26) The stopped line sits after the reply and before the turn's queued and dropped prompt
  blocks (`.ck-queue`), so with no queued prompt it is the turn's last child (review 89-owner finding
  3) and a `Dropped by STOP.` block stays under it: the dropped prompt is not part of the cut reply —
  spec: `c1-talk.md` §8 ("Under it", "Queued prompts at a STOP") — overrule: the line last, under
  the dropped blocks.
- B203 (T26) ` · stopped` ends only a tool line still running when a `stopped` `turn.end` came
  (`lineText(…, {stopped, byStop})`); a turn ending `done` or `error` with a call open keeps §5.1's
  plain words (no `…`, no word) — spec: `c1-talk.md` §8, §5.1 — overrule: ` · stopped` for any cut.
- B204 (T26) S-C1-27's "`prompts()` count 1 before and 2 after `RETRY`" counts the prompts with the
  words `only the failed one` (the first prompt, `check all runs`, makes the log's total 2 before):
  the reading S-C1-29 already uses. The test also asserts the log's total stays 2 until `RETRY`
  ("nothing more is sent to the agent"). The D33 freeze is pinned by `test/cockpit-turns.test.mjs`:
  in S-C1-17 the fake's 300 ms stop rarely sends a delta after the tap, so the Playwright run only
  sees it now and then — spec: `c1-talk.md` S-C1-27, S-C1-17 — overrule: none.
- B205 (T27) When E2's line changes to `The agent is back (…)` with `RETRY`: at the room's `status`
  `agent-back` (live, or in `welcome.status`), at a `turn.prompt` with `delivery:"new"` (a session
  is up), and, for a turn drawn from a snapshot, when a later turn follows it. A reloaded page whose
  last turn ended `agent-exited` and whose `welcome.status` is `null` keeps the first line (no
  `RETRY`) until one of those comes — because the room sends no field saying the agent is up, and
  a `RETRY` shown while it is not would draw `prompt.refused` — spec: `c1-talk.md` §10 E2,
  `protocols.md` §3.5, §11.7.1 step 3 — overrule: a field in `welcome` (or the snapshot's turn
  end) saying the agent is back, and the pane reads it.
- B206 (T27) E2's two times are the turn's `end.at` moved onto the page's clock (as `STOPPED AT`,
  B200): `at 07:04` by `atText`, `(07:04)` by `clockText` (D232's event form) — because S-C1-39
  names the back line's `HH:MM` as the restarted room's start, which is the turn's `end.at`, and
  S-C1-19's exit and restart fall in the same minute — spec: `c1-talk.md` §10, S-C1-19, S-C1-39 —
  overrule: the back line takes `status.since` of `agent-back` instead.
- B207 (T27) The error end's line (`[data-turn-error]` for E2, E3, E4, E7, E8) stands at the turn's
  end, under the reply and before the prompts queued in the turn (as the stopped line); E1's stays
  under the prompt block. A second line for the same turn (E2's change) replaces the first in
  place, so a turn has one — because S-C1-39 puts E2 "under" the turn's prompt with no reply, and
  the error ends the reply — spec: `c1-talk.md` §10, S-C1-39 — overrule: none.
- B208 (T27) E5's row is `p.ck-retrying[data-turn-retrying]` at the reply's end (an item placed
  later goes above it), 48 px, mono 18 px `--text-3`, 24 px in (the tool line's glyph column);
  gone with the first `text.delta`/`text.block` and at `turn.end` — because §10 names its look but
  no selector, and a turn that ends after retries says why in its own end line — spec: `c1-talk.md`
  §10 E5, README "Selectors tests use" (no row) — overrule: name the selector in the README table.
- B209 (T27) A `turn.end` `agent-down` always reads `… The room tries again every 30 s.`: D289's
  refused start leaves no turn running, so it never ends one; the pane has no field to tell the two
  apart — spec: `c1-talk.md` §10 E3, D289 — overrule: a `refused` flag on that `turn.end`.
- B210 (T27) The `status` message is read only for `agent-back` (E2) in T27; the status line itself
  is T28's — spec: `protocols.md` §3.5 — overrule: none.
- B211 (T28) The login check's 10 s limit runs on the real clock, not the room clock: a check
  started by a timer in `manual` mode is awaited by `advance()`, so a room-clock limit could never
  fire inside it (as B102's ping) — spec: `protocols.md` §11.10 "How it runs" — overrule:
  `CHECK_TIMEOUT_MS` on `clock.setTimeout` in `server/cockpit/login.mjs`.
- B212 (T28) The login words gain one pinned pattern, `"loggedIn": false`: a real run of Claude
  Code 2.1.303 logged out (`CLAUDE_CONFIG_DIR` a fresh dir) prints JSON
  `{"loggedIn": false, "authMethod": "none", …}` and exits 1, with none of the six words, so the
  spec's default check would always be `unknown` (`--text` prints `Not logged in. Run claude auth
  login to authenticate.`) — spec: §11.10 "the build night pins them with one real run", research Q1
  — overrule: `LOGIN_WORDS`/`PINNED` in `login.mjs`, or the default argv gains `--text`.
- B213 (T28) The check's environment is the child's (D108) without `LANEBOARD_MCP_TOKEN`, and its
  stdin is closed (`ignore`): the check has no use for the token — spec: §11.10 "How it runs" —
  overrule: pass `mcpToken` to `childEnv` in `session.mjs` `loginWatch()`.
- B214 (T28) A failed start counts as "failed with the login words" (§11.4's last row) when the last
  stderr line of the agent has them, judged where E3 is (from the second failed start); stdout
  before `init` is not read for it — spec: `protocols.md` §11.4, §11.7 — overrule: `onExit` in
  `session.mjs`.
- B215 (T28) The pane counts the room's `welcome` as the end of `room-down` for the status line
  (the room's `status` shows from the first frame after `welcome`, before the snapshot makes the
  link `live`); a new loss (a new `since` on the link) undoes it — spec: c1-talk.md §10.1 ("draws
  it from `welcome.status` in its first frame"), screens.md §7 "Back" — overrule: `welcomed` in
  `pane.js`.
- B216 (T28) With nothing to show, `[data-cockpit-status]` is taken out of the pane (S-C1-37:
  "`[data-cockpit-status]` absent"), not only hidden; it goes back under the header when a row holds
  — spec: c1-talk.md §10.1, S-C1-37 — overrule: `drawStatus()` in `pane.js`.
- B217 (T28) The room under test takes its clock's start in `ROOM_TEST_CLOCK`
  (`{"set":…,"mode":"manual"}`, `room.start({clock})`), applied before the room boots: S-C1-37's
  03:00 `manual` must hold from the start's login check on, else the 900 s timer is armed on the
  real clock before the first `POST /clock` and fires at 03:14:59 — spec: stand-ins.md §1.1,
  S-C1-37 — overrule: the wrapper and `fixtures.mjs`; the test then sets the clock after the boot.
- B218 (T28) S-C1-38's "the link starts again" taps `RETRY NOW` after `POST /link {"up":true}` so the
  wait is not the backoff's (after the offline spell it can be 15 s); what it asserts is unchanged
  — spec: S-C1-38, screens.md §7.1 — overrule: drop the tap and wait out the backoff.
- B219 (T28) The restart after the login comes back closes the idle child's stdin (as `new`, B81),
  SIGTERM 5 s later if it has not exited, and resumes at once at the exit; no `agent-down`, no
  `agent-back` — spec: §11.10 result `ok`, §11.7 — overrule: `restartForLogin()` in `session.mjs`.
- B220 (T28) S-C1-37 and S-C1-38 run on the Wall page: the scenario's rect y 64-144 is the pane's
  status line under a 64 px header at the screen's top (on the app the pane starts under the 36 px
  top bar: y 100-180); the cases of one id are steps of one test, each on a fresh room and page
  — spec: S-C1-37, slices.md §2 — overrule: the `openWall` calls in `c1-status.spec.mjs`.
- B221 (round 94 fix) S-C1-37's fixed page clock (03:15) fixes `Date.now()` and `new Date()` only,
  by an init script on that page (`fixPageDate`), not `page.clock.setFixedTime` — because
  `page.clock` fakes every timer for the whole context, and under load its timers ran 1.2 s
  in 26 s of real time, so the 5 s grace (D139) did not run out within the step's 7 s and
  S-C1-38 failed on a busy machine; S-C1-38 says clock `real`, and the later cases' pages get the
  page's own clock, as their comments said — spec: S-C1-37 ("its clock fixed"), S-C1-38
  ("clock `real`") — overrule: back to `page.clock` with `runFor` to drive the 5 s.
- B222 (T29) `NEW` is enabled while the link is `live` and no status line holds the slot (any row
  of §10.1, not only room-down: the line wins the slot, so the bar has nowhere to show), and stays
  disabled from `START` until the room's `conversation.new` or the next `welcome` (protocols.md
  §3.6's `not-now` never needed); a `conversation.new` hides a bar shown on another screen (the
  question is answered); `START` with a turn running reads `● STOPPING` at the tap as `STOP` does
  — spec: c1-talk.md §11 "Ask first", §8, protocols.md §3.6 — overrule: `newState()` and
  `startNew()` in `pane.js`.
- B223 (T29) S-C1-39's readings: (a) "within 5 s of the kill `room-down`" is the 5 s grace from the
  loss, which is the kill (the link closed 3-6 ms after it): asserted 4.9-5.1 s after the close,
  timed on the page (see `## For the owner`); (b) the restarted fake agent's start is slowed to
  12 s (`start.initAfterMs`, `fakeAgent.edit`, as S-C1-37's second case edits its script) so the
  page's snapshot comes before the agent's `ready` and both E2 lines show in the scenario's order;
  with the script's 200 ms the agent is back long before the page's backoff reconnects and the
  page draws only the second line; (c) "one `turn` line per turn (24 after the answer, rewritten
  at the start)": t-0101…t-0123 have one line each after the rewrite, t-0124 has its appends of
  §11.7.1 (the last line of a `turnId` wins), 24 distinct turns, its last line `done` — spec:
  S-C1-39, screens.md §7, protocols.md §11.7.1 — overrule: the steps in `c1-session.spec.mjs`.
- B224 (T29) The divider and the new conversation's turns go in one box (`.ck-current`) whose
  min-height is the conversation's own height less its padding, so the view at its end shows the
  divider at the top and the pin rule (§4, §7.1) needs nothing new; the box of an earlier new
  conversation loses its min-height at the next one; a snapshot draws the current conversation
  only, with no divider (§11: "A reload shows only the current conversation") — spec: c1-talk.md
  §11 "The divider" — overrule: `sizeCurrent()`/`newConversation()` in `pane.js`.
- B225 (T29) Names the spec does not give: the divider is `[data-cockpit-divider]` (`owner` or
  `forced`), the bar's question `.ck-newbar-text`; the forced divider may wrap to a second line
  (its 16 px caps are wider than the 560 px column less two 16 px rules); `seededTurns()` takes
  `first`, `spacingMs`, `lastAgoMs` and `room.start({seeded})` the turns themselves, for S-C1-39's
  t-0101…t-0120 dated 60 to 41 min ago — spec: c1-talk.md §11, S-C1-39 — overrule: rename in
  `newconv.js` and the spec file.
- B226 (T29) Decision numbers D30-D39 are not written in `public/js/` comments (cite the spec
  section instead): `test/render.test.mjs` guards against a chart library with `/d3/i` over every
  page script — spec: none — overrule: loosen that guard (not a cockpit file).
- B227 (T30) `cockpit.stop` is written for a `stop` naming the running turn (as `session.stop`
  would accept it), one line per such `stop` received; a refused `stop` (`unknown-id`, `not-now`)
  changes nothing and writes no line. `cancelQueued` is the bridge's `ready.canCancelQueued`, the
  same value `session.mjs` hands the interrupt — because §6.4's table has only the accepted stop and
  "before it asks the bridge" means the link decides before `session.stop` — spec: screens.md §6.4
  — overrule: a refused stop as a `{"ok":false,"status":…}` line in `link.mjs`.
- B228 (T30) `cockpit.new`'s `from` comes from the session (`onConversation(rec, reason, from)`,
  the conversation before it), `stoppedTurn` from the link at the owner's `new` (the running turn
  then, else null); the line is written in `onConversation`, when the new session's `ready` came,
  for `owner` and `forced` only (a room's first conversation is no `new`) — because the store has
  already begun the new conversation by the time `conversation.new` is emitted — spec:
  screens.md §6.4 ("written once it has started") — overrule: `link.mjs` `conversationStarted`.
- B229 (T30) Every audit append that fails (prompt, stop, new) goes through one
  `createFailWarner` (audit-lines.mjs): `cockpit: audit append failed for <action>: <reason>` on the
  room's stderr, at most one line per 10 s on the real clock, the held ones counted into the next
  line (` (2 more since the last line)`) — because §6.4 says one line per 10 s and a test room's
  manual clock must not hold it back; one limiter makes S-SCR-31's "one line" exact although its
  prompt fails 7 s after the stop — spec: screens.md §6.4 — overrule: a limiter per action.
- B230 (T30) The pane handles `prompt.refused` only for `audit-unavailable` (E1's block, `RETRY`
  with the same `clientId`, `EDIT`, line `Not sent: the room cannot write its audit log.`);
  `too-many` stays T23c's and `agent-down` the status line's (send is blocked while it shows) —
  because one task, one code — spec: protocols.md §3.1 — overrule: `pane.js` `case 'prompt.refused'`.
- B231 (T30) `scr-room` gains a 20 s turn matching `how did the night go` (S-SCR-30, -31): no §5
  script had a 20 s turn for that prompt — spec: stand-ins.md §5 (scr-room's row) — overrule: the
  turn in `test/cockpit/scripts/scr-room.json`.
- B232 (T30) S-SCR-30's resend "through `page.evaluate` on the page's link helper" is a second
  link the page opens with `createRoomLink` (`public/js/cockpit/link.js`) sending the recorded
  `prompt` frame without its `seq`: the pane exposes no link hook, and D95's memory is the room's,
  not the link's — spec: screens.md S-SCR-30 Test — overrule: a test hook on the pane's own link.
- B233 (T23c) The rate is its own module, `server/cockpit/prompt-rate.mjs` (`createPromptRate`:
  `take`/`giveBack`, `refusal`/`takeHeld`/`putBack`), keyed by `SCREEN_NAME` as B179 says (the
  refusal lines too, although screens.md §6.4 writes "per link without pairing": one key is the
  stricter bound and matches "one refusal line for the token"); a prompt is counted when the room
  takes it and given back when it is refused after that (agent-down, audit-unavailable, the
  session's refusal); the window is (now − 60 000 ms, now], so a prompt exactly 60 s old is out;
  the rate is checked before agent-down (a looping screen gets `too-many` whatever the agent's
  state); `refusedSince` sits in the line's `result`, on the key's next `cockpit.prompt` line of
  either kind, and a line that fails to be written keeps the count — because D228 counts accepted
  prompts only and D165 names the field but not its place — spec: c1-talk.md §7 "Rate",
  screens.md §6.4 — overrule: `prompt-rate.mjs`, and `writeLine` in `link.mjs`'s `prompt`.
- B234 (T23c) "page B draws the same block" (S-C1-43) is built page-side: the room's
  `prompt.refused` goes to the sender only and carries no text (protocols.md §3.1), so the page
  that drew E9 tells its sister pages over a same-origin `BroadcastChannel`
  (`public/js/cockpit/screen-tabs.js`, each note checked by `refusedNote`), and they draw the same
  block (label time the sender's, `RETRY` waiting 60 s on their own clock, `EDIT`). A page that
  reloads loses that block (the room never held it) — because the protocol's fields stay as
  written and the two pages are one screen (one token, §12 "The rate is per screen") — spec:
  c1-talk.md S-C1-43 against protocols.md §3.1 (under For the owner) — overrule: the room sends
  `prompt.refused` with `text` and `at` to every link of the token and the pane draws it.
- B235 (T23c) S-C1-43's "after `page.clock.runFor(59000)` still disabled, after `runFor(1000)`
  more enabled" counts from the moment page A drew the refusal (a MutationObserver records the
  page's `Date.now()`), and page A's clock moves with the room's in 10 s steps up to `ping 12`
  so the link hears its heartbeats (as B187): with `install()` the page's clock also runs in real
  time, so a bare 59 000 after `ping 12` would be past 60 s and the link would go silent — spec:
  c1-talk.md S-C1-43, D264 — overrule: `e2e/cockpit/c1-rate.spec.mjs`.
