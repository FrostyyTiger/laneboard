# Cockpit spec: stand-ins

The loop's VM has no screen, no microphone, no GPU and no fleet (plan §6.7). The acceptance tests
(D88, D113, `e2e/cockpit/*.spec.mjs`) and the public demo run against the stand-ins below. Each section
is small enough to build in one round. Message shapes are not repeated here: they are
`protocols.md`'s, and a stand-in writes only shapes that appear there as fixtures (D98).

There are three things, and the spec uses three names for them (T87, D109). The words "stand-in
room" in earlier files mean the first one:

| Name | What it is | Process | Section |
| --- | --- | --- | --- |
| **room under test** | the real room (a laneboard with a `cockpit` section, D89), started by the test through a small wrapper that adds a test clock, fault hooks and a control port | child process, one per test file | §1 |
| **fake agent** | a program the room starts as its agent child instead of `claude`; it replays a script and speaks Claude Code's native lines (or the bridge dialect) | grandchild, started by the room | §2 |
| **fake speech** | a WebSocket server that speaks WhisperLiveKit's protocol (`protocols.md` §12) and replays scripted partials and finals | in the test process | §3 |

Plus the **demo fleet** the boards already have (`test/tools/demo-fleet.mjs`,
`test/helpers/demo-hub.mjs`) and the few additions of §4. §5 lists one script per scenario family;
§6 is the public demo; §7 the build order.

How older phrases in the spec map onto these:

| Phrase in `screens.md`, `c1-talk.md`, `c2-voice.md`, `c3-see.md`, `c4-show-canvas.md` | Means |
| --- | --- |
| "the stand-in room" | the room under test (§1) |
| "the stand-in room's received-turns log", "the fake agent's received log" | the fake agent's log (§2.6): `fakeAgent.prompts()`, `fakeAgent.toolResults()` |
| "the stand-in stops / drops / starts its link", "the stand-in's connection log" | control API `POST /link`, `GET /connections` (§1.2) |
| "drop-next verb", "scripted to drop the next prompt" | control API `POST /drop` (§1.2) |
| "a stand-in room whose clock is moved", "the stand-in's clock verb" | control API `POST /clock` (§1.2) |
| "approve / revoke a pairing", "`laneboard cockpit pair` runs on the stand-in room" | control API `POST /pair`, `POST /unpair` (§1.3) |
| "the stand-in records the forced stop (signal)", "the bridge log order from the stand-in" | the fake agent's log, `signal` and `stdin` lines (§2.6) |
| "the fake agent's `exit` step" | step `exit` (§2.3) |
| "the fake speech service stopped / started / refuses / withholds the final" | `fakeSpeech.stop()`, `.start()`, faults (§3.3) |
| "the demo hub has a scheduled job `job-0003`" | the room under test's seeded job (§4.2) |

## 1. The room under test

### 1.1 How it starts

- **Entry**: `test/cockpit/stand-ins/room-under-test.mjs`. `test/helpers/boot.mjs` gains an `entry`
  option (default `server/index.mjs`, which stays frozen) and spawns this file instead, with the
  same isolation (its own temp `HOME`, `LANEBOARD_STATE_DIR`, `LANEBOARD_CONFIG`, no inherited
  `LANEBOARD_*`).
- The wrapper does three things, then imports the room's normal boot (`server/boot/cockpit.mjs`,
  T86) unchanged:
  1. replaces the room's clock: `setClock(testClock)` on `server/cockpit/clock.mjs`, the one module
     every room timer and every `now()` goes through (pairing codes, stop at 5.0/8.0 s, restarts,
     heartbeat, liveness);
  2. installs the fault hooks: `setFaults(hooks)` on `server/cockpit/faults.mjs`, which the link
     handler and the HTTP routes call at three points (upgrade, each inbound text message, each
     outbound message); by default both modules are no-ops;
  3. opens the **control port** on `127.0.0.1`, a free port from `freePort()`, and prints one line
     `control 127.0.0.1:<port>` on stdout, which `boot()` reads as `booted.control`.
- Production has no test route at all (D109): the control port exists only in this wrapper, never
  on the room's own port, and no environment variable turns anything on in `server/`.
- **Config** the test writes (`cockpit` section; keys as `protocols.md` §11 and `c2-voice.md` §9;
  `cockpit.agent.*` is T73's):

```json
{"mode":"builder","port":0,
 "cockpit":{
   "agent":{"kind":"claude-code","command":["node","test/cockpit/stand-ins/fake-agent.mjs"],
            "cwd":"<tmp>","env":["FAKE_AGENT_DIR"]},
   "stt":{"url":"ws://127.0.0.1:<fake speech port>/asr","language":"de"},
   "board":{"url":"http://127.0.0.1:<demo hub port>"}}}
```

  `kind` stays `claude-code` (D110): the room runs its real adapter against the fake agent in every
  acceptance test. `FAKE_AGENT_DIR` (§2.1) reaches the child only because it is listed in
  `cockpit.agent.env` (D108). The test passes `--dialect bridge` in `command` for the few tests
  that need the `bridge` dialect.
- **Clock modes.** `real` (the default) or `manual`. In `manual` the room's time stands still and
  timers fire only when the test advances it; due timers then fire in time order. A test that also
  fakes the page's clock advances both with one helper, `advance(ms)`: `page.clock.runFor(ms)`,
  then `POST /clock {"advanceMs":ms}`, then the fake speech's clock (§3.1). The fake agent always
  runs in real time (§2.3), so a scenario switches to `manual` only after the agent steps it waits
  for have happened, or uses a script with no timed steps (S-C1-17's "ignore the interrupt").

### 1.2 Control API (T32)

JSON in and out, on `booted.control`; every call answers within 0.2 s and changes nothing but the
room under test. Test helper: `room.control(method, path, body)`.

| Verb (as the scenarios say it) | Method, path, body | Answer | Effect |
| --- | --- | --- | --- |
| move the room's clock | `POST /clock {"mode":"manual"}`, `{"advanceMs":300000}`, `{"mode":"real"}` | `200 {"now":"2026-10-27T07:05:00+01:00"}` | §1.1; `advanceMs` only in `manual`, else `409 {"error":"not-manual"}` |
| set the room's clock | `POST /clock {"set":"2026-10-27T07:00:00+01:00"}` | `200 {"now":…}` | the room's time jumps there (any mode); scenario times like 06:41 come from here |
| stop the room's link | `POST /link {"up":false}` | `200 {"up":false,"closed":2}` | every open link's socket is destroyed with no close frame; every new upgrade and every `/api/cockpit/*` request has its socket destroyed unread, so the page sees what an unreachable room looks like. The room itself keeps running: the agent finishes turns, cards are placed (S-SCR-19) |
| start the room's link | `POST /link {"up":true}` | `200 {"up":true}` | upgrades are accepted again |
| a blip | `POST /link {"up":false}`, then `{"up":true}` 2 s later (S-SCR-18) | as above | |
| read the connection log | `GET /connections` | `200 {"items":[{"at":"…","atMs":1793080861123,"accepted":false,"closeCode":null}]}` | every upgrade attempt since start, oldest first (S-SCR-19's retry times) |
| drop the next prompt | `POST /drop {"what":"next-prompt"}` | `200 {"armed":true}` | the next inbound `prompt` message is read and thrown away: no `turn.prompt` echo, nothing to the agent (S-C1-18). Replaces T87's `POST /__test/drop` |
| drop the next message to a screen | `POST /drop {"what":"next-out","type":"turn.end"}` | `200 {"armed":true}` | the next outbound message of that `type` is not sent to any link but still counts in `seq`, so a screen sees a gap (`protocols.md` §2.2) |
| approve a pairing | `POST /pair {"code":"K7M4QX","name":"desk"}` | as the CLI: `200 {"name":"desk"}`, `404 {"error":"unknown"}` | §1.3 |
| revoke a pairing | `POST /unpair {"name":"desk"}` | `200 {"name":"desk"}` | §1.3 |
| add / remove a button (C2b) | `POST /button {"add":"hall","screen":"desk"}`, `{"remove":"hall"}` | `200 {"name":"hall","token":"…"}` on add | §1.3 |
| seed jobs | `POST /jobs {"items":[…]}` | `200 {"count":1}` | replaces the room's scheduled jobs with these (§4.2) |
| read what the room sent | `GET /sent?type=turn.end` | `200 {"items":[{"seq":41,"type":"turn.end",…}]}` | outbound messages since start, last 2 000 (the room keeps these anyway, D94) |

Unknown paths answer `404 {"error":"unknown-verb"}`; a bad body `400 {"error":"bad-body","detail":"…"}`.

### 1.3 Pairing in tests, and the CLI

The room's CLI verbs `pair`, `unpair` and `button add|remove` refuse when the caller's uid equals the
agent's (T56, T74). In a test the fake agent runs as the test's own user, so the CLI would refuse
every time. Therefore (D111):

- The CLI's work is two functions: `checkCaller({uid, agentUid})` (the refusal, its message and exit
  code) and `approve({code, name})` / `revoke({name})` / `buttonAdd(…)` (the change and its audit
  line). The control API's `/pair`, `/unpair` and `/button` call the second ones only.
- The CLI itself (`laneboard cockpit pair …`, its output text, exit codes, the refusal) is tested by
  `node:test` in `npm test`, calling its `main(argv, {uid, agentUid, room})` with injected uids and
  a room under test. S-SCR-14/15/16's CLI lines are checked there; their screen parts run in
  Playwright with `/pair` and `/unpair`.
- Nothing in the CLI or the room reads a test flag; the refusal cannot be switched off.

## 2. The fake agent

### 2.1 Program and files

- `test/cockpit/stand-ins/fake-agent.mjs`, plain Node, no dependency. Started by the room exactly
  as `claude` would be (`protocols.md` §11.2's argument list); it reads the arguments it needs
  (`--session-id`, `--resume`, `--mcp-config`, `--max-turns`) and ignores the rest.
- `--dialect claude` (default): it reads Claude Code's stdin lines (`json claude` in
  `protocols.md`) and writes the native stdout lines of `protocols.md` §11.4's left column, built
  from those same rows, so the mapping fixtures and the fake cannot drift apart.
  `--dialect bridge`: it reads and writes the bridge events of §11.3 instead (T72's generic agent).
- **`FAKE_AGENT_DIR`** (an absolute path in the test's temp dir) holds:

| File | Written by | Holds |
| --- | --- | --- |
| `script.json` | the test (`fakeAgent.use(name)` copies `test/cockpit/scripts/<name>.json`) | the script (§2.2); re-read at every prompt and every start, so a test switches scripts without restarting anything |
| `received.jsonl` | the fake agent | its log (§2.6) |
| `starts` | the fake agent | a counter of how many times it was started (for `startFailures`) |

### 2.2 Script format

One JSON object. `start` says how the process starts; `turns` are matched to prompts.

```json
{"name":"c1-render",
 "start":{"initAfterMs":200,"mcp":"connected","login":"ok","startFailures":0,
          "capabilities":["interrupt_receipt_v1","interrupt_cancel_queued_v1"]},
 "turns":[
  {"match":"how did the night go","onInterrupt":{"endAfterMs":300},"queued":"next-tool-end",
   "steps":[
    {"at":300,"text":"Two "},{"at":400,"text":"of "},{"at":500,"text":"three "},
    {"at":600,"text":"runs ","skipDelta":true},{"at":700,"text":"finished"},{"at":800,"text":"."},
    {"at":900,"end":"done"}]},
  {"steps":[
    {"at":100,"tool":"mcp__laneboard__morning","input":{"window":"tonight"},"endAt":600},
    {"at":700,"text":"■ One run is stuck: builder-a since 03:12."},
    {"at":1000,"end":"done"}]}]}
```

- **Matching.** At each prompt the fake takes the first turn not played yet whose `match` is a
  case-insensitive substring of the owner's words (the prompt's last part, after the bracketed
  lines of `protocols.md` §11.5); a turn without `match` matches any prompt. Played turns are not
  played again unless the turn has `"repeat":true`.
- **No turn matches**: the fake answers one text block
  `(fake agent: no scripted turn for "{the first 40 characters}")` and ends `done`, so a screen is
  never left waiting and the failing test shows why.
- **`at`** is ms from the moment the prompt's line was read on stdin (for a steered prompt, from
  when it was taken). Steps play in `at` order; two steps with the same `at` play in file order.

### 2.3 Steps

| Step | Fields | What the fake writes (dialect `claude`; `bridge` writes the bridge event of the same row of `protocols.md` §11.4) |
| --- | --- | --- |
| text | `text`, optional `"block":"new"`, `"skipDelta":true` | a `content_block_delta` `text_delta`; the first text step of a block writes `content_block_start` first. Consecutive text steps form one block; the block's complete `assistant` line (all its text, `skipDelta` ones included) is written before the next tool step, a `"block":"new"`, or `end`. `skipDelta` leaves that piece out of the deltas only (S-C1-04's "drops delta 4") |
| tool | `tool`, `input`, `endAt`, optional `isError`, `"call":false` | `content_block_start` `tool_use`, one `input_json_delta`, the `assistant` line with the complete input; at `endAt` the `user` `tool_result`. Overlapping `at`…`endAt` ranges are parallel calls |
| real MCP call | (default for `mcp__laneboard__*` tools) | the fake really calls the room's MCP server with the `tools/call` JSON-RPC request over HTTP, using the URL from `--mcp-config` and `LANEBOARD_MCP_TOKEN`; `is_error` is the result's `isError` unless the step sets `isError`; the result goes to the log (§2.6). `endAt` is then the earliest end: the `tool_result` is written when both `endAt` has passed and the call returned. `"call":false` skips the call. Show commands and kit blocks (C4) reach the screens this way |
| denied | `denied` (a tool name), `input` | the `assistant` `tool_use` line, then `system` `permission_denied` (T57's line, pending Q-O23) |
| retry | `retry`: `{"attempt":2,"of":10,"error":"overloaded"}` | `system` `api_retry` |
| end | `end`: `done`, `step-limit`, `failed`, `not-logged-in`; optional `detail`, `costUsd` | the `result` line of that row of §11.4 (`not-logged-in`: an `api_retry` with `authentication_failed`, then the `result`, pending research Q10) |
| exit | `exit`: an exit code | the process exits at once with that code (S-C1-19) |
| ping | turn field `"pingEveryMs":5000` | a `stream_event` `ping` that often while the turn runs (default: none; the 300 s liveness test of D105 uses a turn with no steps after its first) |

### 2.4 Interrupts, queued prompts, signals

- **`onInterrupt`** (turn field): `{"endAfterMs":300}` (default): on the interrupt request the fake
  writes its `control_response` with `request_id` (`still_queued` and `cancelled` as below), drops
  the turn's remaining steps, and `endAfterMs` later writes the `result` `error_during_execution`
  with `terminal_reason` `aborted_streaming`. `"ignore"`: it answers nothing and plays on.
  `"ignore-sigint"`: as `ignore`, and `SIGINT` is ignored too, so only `SIGTERM` ends it (S-C1-17's
  forced stop, `protocols.md` §11.6's 8.0 s row).
- **`queued`** (turn field, for a prompt that arrives while this turn runs; research Q8, pending
  Q-O1): `next-tool-end` (default) takes it after the running tool calls end, with a
  `message_start` whose `user_message_uuids` holds its uuid, then plays its matched turn's steps as
  part of the running turn; with no tool running it is taken after the turn ends. `after-turn`
  takes it as a new turn after this one. `ignore` never takes it (the one reported 2.1.175 case).
  An interrupt with `cancel_queued` lists every prompt not taken yet in `cancelled`, else in
  `still_queued`.
- **Signals**: `SIGINT` (unless ignored) ends the turn as an interrupt with `endAfterMs` 0;
  `SIGTERM` exits 143 at once. Each signal is logged before it acts.
- **Start** (`start` object): `initAfterMs` after spawn it writes `system` `init` (session id from
  `--session-id`, or the `--resume` id), `mcp_servers` from `mcp` (`connected` or `failed`) and
  `capabilities`; `startFailures: n` makes the first n starts (counted in `starts`) exit 1 before
  `init` (`protocols.md` §13's restart test); `login: "failed"` makes every prompt end as
  `not-logged-in`. Whether `init` comes before the first stdin line is research Q10's; the fake
  follows the build night's finding, and until then writes it at `initAfterMs`.

### 2.5 The bridge dialect

Same script, same matching. It reads `prompt` and `interrupt` (§11.3) and writes `ready` at
`initAfterMs`, `taken`, `text.delta`/`text.block`, `tool.start`/`tool.end`, `retrying`,
`interrupted`, `turn.end`. A `tool` step with a name the room has no wording for (e.g.
`"tool":"search_wiki"`) is how T72's scenario gets `used search_wiki`.

### 2.6 Its log

`received.jsonl`, one JSON object per line, flushed per line:

```json
{"atMs":1793080800000,"kind":"start","n":1,"argv":["-p","--input-format","stream-json"],"env":["FAKE_AGENT_DIR","HOME","LANEBOARD_MCP_TOKEN","LANG","PATH","USER"],"session":"0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91","resumed":false}
{"atMs":1793080802960,"kind":"stdin","line":{"type":"user","uuid":"9d2f4c1e-7a3b-4e8d-b1c6-52a0e9f3d714","priority":"next"}}
{"atMs":1793080802960,"kind":"prompt","uuid":"9d2f4c1e-7a3b-4e8d-b1c6-52a0e9f3d714","words":"wie lief die Nacht?","raw":"(Spoken in German; speech-to-text may have misheard a word.)\nwie lief die Nacht?","turn":"c1-voice#1"}
{"atMs":1793080804600,"kind":"tool-result","tool":"mcp__laneboard__morning","isError":false,"result":{"window":"tonight"}}
{"atMs":1793080805100,"kind":"signal","name":"SIGINT"}
```

- `env` lists the names the child got, never values (D108's test reads it).
- Test helper (`test/cockpit/stand-ins/fake-agent-log.mjs`): `prompts()` → the `prompt` lines (the
  "received-turns log"); `toolResults(tool?)`; `signals()`; `starts()`; `order()` → `kind`s in order
  (S-C1-16's "interrupt before the new prompt" is a `stdin` interrupt line before the next `prompt`).

## 3. The fake speech service

### 3.1 Program and API

- `test/cockpit/stand-ins/fake-speech.mjs`, using the `ws` package laneboard already has. It runs
  inside the test process:

```js
const speech = await startFakeSpeech({ script: 'c2-tap', clock: testClock });
// speech.url  → 'ws://127.0.0.1:<port>/asr'   (goes into cockpit.stt.url)
speech.use('c2-faults');     // load test/cockpit/scripts/<name>.json
await speech.stop();         // closes the listener: connects are refused (S-C2-15)
await speech.start();        // listens again on the same port
speech.log();                // §3.4
await speech.close();
```

- `clock` is optional; without it the fake runs on real time. The same `testClock` the room under
  test and the page use (§1.1) lets S-C2-06's 30 s and 2 min run in milliseconds.
- One connection is one utterance (`protocols.md` §12). It answers the upgrade on `/asr` only and
  sends `{"type":"config","useAudioWorklet":true,"mode":"full"}` first, unless a fault says
  otherwise.
- The audio is never looked at, only counted: frames of any content are "speech". So no recorded
  audio is needed; "recorded utterances" are the timed texts below.

### 3.2 Script format

```json
{"name":"c2-tap",
 "utterances":[
  {"updates":[
     {"at":600,"lines":[],"buffer":"what"},
     {"at":1100,"lines":[],"buffer":"what failed"},
     {"at":1600,"lines":["what failed"],"buffer":"tonight"}],
   "finalAfterMs":150,
   "final":{"lines":["What failed tonight?"],"buffer":""}}]}
```

- Utterances are used in order, one per connection; after the last, the fake starts again at the
  first.
- `at` is ms from the **first audio frame** of that connection (`c2-voice.md` §6). Each update is
  sent as `active_transcription` with `lines` as `[{"speaker":0,"text":…}]` and
  `buffer_transcription` = `buffer`. An update whose `at` falls after the end frame is not sent.
- On the empty binary frame (end of audio), `finalAfterMs` later the fake sends `final` as one more
  `active_transcription`, then `{"type":"ready_to_stop"}`, then closes 1000 (B3's 0.15 s).
- `"noAudio":true` on an utterance: it sends only `no_audio_detected` updates, every 1 s, and an
  empty final (S-C2-05).

### 3.3 Faults

Field `fault` on an utterance; one per utterance.

| `fault` | What the fake does | Scenario |
| --- | --- | --- |
| (fake stopped with `stop()`) | the port refuses connections | S-C2-15 |
| `"no-config"` | accepts the upgrade, never sends `config` | S-C2-15 (`no-answer` at 2.0 s) |
| `"401"`, `"403"` | answers the upgrade with that status | S-C2-15's `token` and `busy` lines |
| `"pcm-off"` | sends `config` with `useAudioWorklet:false` | `protocols.md` §12.1 |
| `{"errorAt":1200,"error":"model crashed"}` | at that `at`, `{"status":"error","error":…}` | S-C2-16 |
| `{"closeAt":1200,"code":1011}` | closes with that code at that `at` | S-C2-16 |
| `"withhold-final"` | after the end frame, sends nothing more and keeps the socket open | S-C2-17 (3.0 s rule) |
| `{"requireToken":"t0k"}` | 401 unless `Authorization: Bearer t0k` | `cockpit.stt.tokenFile` (D49) |

### 3.4 Its log

`speech.log()` returns, oldest first:

```json
[{"atMs":1793080800200,"kind":"connect","conn":1,"query":{"language":"de","mode":"full"},"auth":false},
 {"atMs":1793080800210,"kind":"frame","conn":1,"bytes":3200},
 {"atMs":1793080802800,"kind":"end-frame","conn":1},
 {"atMs":1793080802950,"kind":"sent","conn":1,"what":"final"},
 {"atMs":1793080802951,"kind":"close","conn":1,"code":1000,"by":"fake"}]
```

"The fake speech gets no audio frame after t = 2.2 s" (S-C2-10, S-C2-11) reads the last `frame`
line's `atMs`; "the service's connect log" (S-C2-13) the `connect` line's `query.language`.

### 3.5 Outside a test

`node test/cockpit/stand-ins/fake-speech.mjs --port 7792 --script demo` runs the same server on its
own for the demo (§6); Ctrl-C stops it.

## 4. The demo fleet

### 4.1 What it already has

`test/tools/demo-fleet.mjs` and `test/helpers/demo-hub.mjs` already give the cockpit what its
scenarios name; nothing is changed there for the cockpit:

| The spec names | Already in the demo |
| --- | --- |
| a stuck run | `acme-billing` running on `builder-b`, stuck (the same task failed twice) (`DEMO_RUNS`) |
| a builder going down | `builder-c`, taken down and brought back by the script |
| drift | `backup` declared but not seen, `scratch` seen but not declared (`writeDemoMap`) |
| the Map's nodes | site `lab` (`hv1`), rooms `room-a`/`vm-a`, `room-b`/`vm-b`, `room-c`/`vm-c`, `ci`, `backup` (`DEMO_TOPOLOGY`) |
| a stale feed | `writeDemoFeed(feedsDir, now - 5 h 2 min)` (S-C3-02) |
| a red CI job | `api-test` on `main` of repo `acme` |

### 4.2 Additions

1. **A scheduled job.** Jobs are the room's (`coworker.md`, T13; the slice of T81), not the hub's,
   so the job of `c4-show-canvas.md` §10 is seeded on the room under test (D112), with
   `POST /jobs` (§1.2) or, for the demo, from `test/cockpit/scripts/demo-jobs.json`:

```json
{"items":[{"id":"job-0003","title":"shut off vm-c","at":"2026-10-27T10:12:00+01:00",
           "target":"vm-c","state":"scheduled","createdBy":"agent","createdAt":"2026-10-27T07:02:00+01:00"}]}
```

   The fields are the minimum `c4-show-canvas.md`'s countdown binding reads; `coworker.md` (T13)
   owns the job format and may add fields. A seeded job never runs anything: the room under test
   has no job runner until that slice, and at `at` it only turns `state` to `due`.
2. **The demo's time.** Scenario times (06:41, 07:00, 07:12) are set with `POST /clock {"set":…}`
   on the room and `page.clock.setFixedTime` on the page; the demo hub keeps real time, and
   `writeDemoFeed`/`demoRuns` take `now` so a test stamps them to match.
3. **Nothing else.** Pins, cards, the conversation and speak-ups are made by the fake agent's
   scripts through the real room, never pre-written into the room's files.

## 5. Scripts, one per scenario family

`test/cockpit/scripts/<name>.json`, each as §2.2 (agent) or §3.2 (speech). A scenario names its
script in its test; one script serves a family, with one `match` per scenario where they differ.

| Script | Kind | Scenarios | Holds |
| --- | --- | --- | --- |
| `c1-render` | agent | S-C1-03..12 | §2.2's example; S-C1-05's 4-column and 9-column tables; S-C1-06/07's three `fleet` calls (400 ms each, `hv2` `isError`) then `ci` 300 ms; S-C1-08's 40-line `sh` block; S-C1-09's markup; S-C1-10's 30 lines over 6 s; S-C1-11's marks |
| `c1-typing` | agent | S-C1-14..18 | a short `done` turn per prompt; S-C1-16's 8 s stream with `onInterrupt` `endAfterMs` 400; S-C1-17's two turns (`endAfterMs` 300, and `ignore-sigint`) |
| `c1-errors` | agent | S-C1-19, S-C1-20 | an `exit` 1 mid-text; one turn per error row (`failed` `overloaded`, `step-limit`, `failed` `boom` plus a 300-character `detail`, `not-logged-in`, two `retry` steps then text) |
| `c1-long` | agent | S-C1-21 | 15 s without steps, then 120 lines, 26 000 characters and a 30-row table over 20 s (real time: 35 s) |
| `c1-session` | agent | S-C1-22, S-C1-23 | `repeat` turns that answer `how is builder-a` in 2 s |
| `c1-voice` | agent | S-C1-13, S-C3-18, §10 of `protocols.md` | the `morning` call and `■ One run is stuck…` turn of `protocols.md` §13.1, first delta 0.3 s after the prompt |
| `c2-tap` | speech | S-C2-01..04, S-C2-07, S-C2-10..13, S-C2-20 | §3.2's example, plus `how did` / `how did the` / `how did the night go` (S-C2-03) and `restart the runner on builder-b` (S-C2-11) |
| `c2-limits` | speech | S-C2-05, S-C2-06 | `noAudio`; a growing partial every 1 s from 0.6 s for 130 s |
| `c2-faults` | speech | S-C2-15..17 | one utterance per row of §3.3 |
| `c2-agent` | agent | S-C2-* that send | a short `done` turn for any prompt (`repeat`); S-C2-09's 8 s stream with `endAfterMs` 400 |
| `scr-room` | agent | S-SCR-03..05, S-SCR-17..20 | one long turn (20 s of text) and a turn that calls `fly_to builder-a` (S-SCR-05) |
| `c3-tools` | agent | S-C3-03, S-C3-10..14 | `morning` then `runs`; `focus` calls |
| `c4-show` | agent | S-C4-01..12 | one turn per show command, at the times the scenarios give |
| `c4-cards` | agent | S-C4-13..24, S-SCR-07/08 | `place` calls, incl. the 17th card and the `job-0003` countdown |
| `demo`, `demo-jobs` | both | §6 | the public demo |

Each script file gets one `node:test` check in `npm test` (no browser): it parses, every step is a
known kind, `at` values rise within a turn, and every native line the fake would write for it
validates as a `json claude` fixture (D98).

## 6. The public demo

`node test/tools/demo-fleet.mjs --cockpit` starts the demo hub as today, plus a room under test with
the fake agent on script `demo`, the fake speech on `demo` and `demo-jobs` seeded, and prints the
URL. Paired at start through `/pair` (the demo has nothing to protect and prints `DEMO: paired
automatically`). The `demo` agent script answers, by `match`: `how did the night go`, `what is
stuck`, `show me vm-b` (a `fly_to`), `put a countdown to the vm-c job on the canvas` (a `place`),
and anything else with the no-match line of §2.2. The speech script has one utterance per line
above, in that order. The static `?demo=1` page (no room at all) is T76/T93's, not this.

## 7. Build order

Each is one round; each ends with its own `node:test` file green.

1. `fake-agent.mjs`, dialect `claude`, steps text/tool (no real MCP call)/end/exit, the log and its
   helper; test: a scripted child replays §13.1 of `protocols.md` and the adapter's output matches.
2. `fake-speech.mjs` with §3.2 and §3.3; test: one case per fault row against a plain `ws` client.
3. `room-under-test.mjs`, `clock.mjs`, `faults.mjs`, the control API; test: one case per §1.2 row.
4. Real MCP calls, `queued`, `onInterrupt`, the `bridge` dialect, the scripts of §5 for the slice
   being built, `--cockpit` for the demo.
