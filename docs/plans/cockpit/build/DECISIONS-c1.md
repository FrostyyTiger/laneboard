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
