# Review, round 77: the implementer

Read: `slices.md` (all), `protocols.md` §1-§3, §8-§10, §11.1-§11.8, §13, `stand-ins.md` §1-§2,
`c1-talk.md` §3, §5.1, §8, §10, S-C1-16..18, S-C1-27..29, `c3-see.md` §1-§3, `screens.md`
S-SCR-19, `spec/README.md` "The room process", D93, D95, D109, D110, D119, D121-D124, `PROGRESS.md`
(open tasks, priority note), `reviews/59-implementer.md` and its triage (round 60). Shot
`c1-pane.html` at 1368 dark (`$RUN_DIR/shots/77-c1-pane/`). Checked against the code:
`server/config/mode.mjs` (`MODES = ['builder','hub']`), `server/boot/` (`builder.mjs`, `hub.mjs`,
`common.mjs`, no `cockpit.mjs`), `test/helpers/boot.mjs` (`boot({mode, config, env, trace})`,
`freePort()` hands out 7790-9790), `server/ws.mjs` (`helloMessage()`), `public/js/core/net.js`
(`nextBackoff`, its call site at line 117).

Since round 59, T85, T88 and T87 have landed. Steering is now written down properly: S-C1-16 and
S-C1-27..29 are the most buildable scenarios in the spec. The findings below are what would still
stop me on a C1 night. New ones come first, then round-59 items that are still open.

## Findings, worst first

1. **A queued prompt that starts the *next* turn has no message that creates that turn.**
   (`protocols.md` §3.4 row `taken` "or, when the turn ended first, the new turn it starts
   (`atBlock` 0)"; §11.4 `message_start` row; `c1-talk.md` §8 "The turn ends first", §5.1 D119;
   S-C1-28 case 1.) The screen only learns a turn exists from `turn.prompt` `delivery:"new"`. Here
   the room sends `turn.state` `thinking` and `prompt.taken` for a `turnId` the pane has never seen.
   D119 then makes the pane close with 4000 `gap` and redraw from a snapshot. That happens every
   time a queued prompt outlives its turn: S-C1-28, every `stillQueued` prompt after a STOP on an
   agent without cancel-queued, and every prompt to an agent with `canSteer:false`. S-C1-28's "by
   13.5 s `· QUEUED` is gone" passes only through a full redraw. Fix: one D-line and one row in
   §3.4. When a queued prompt is taken outside a running turn, the room first sends `turn.prompt`
   with the new `turnId`, the prompt's original `clientId`, `delivery:"new"` and
   `"from":"queued"`, then `prompt.taken`. The pane moves the existing block instead of drawing a
   second one. S-C1-28 then asserts no 4000 close (`framesent`).

2. **`RETRY` and `clientId` disagree between E1 and the other errors, and D95 swallows the wrong
   one.** (`protocols.md` §3.1 "Once only"; D95; `c1-talk.md` §10 "A `RETRY` is a new turn with
   the same text"; E2 "`RETRY` sends that turn's prompt again"; E8 `RETRY`; §8 "`RETRY` sends it
   with a new `clientId`".) D95 says a known `clientId` within 10 min starts nothing. Suppose E2
   or E8 `RETRY` reuses the turn's `clientId`, which the D95 sentence "RETRY after E1 reuses the
   `clientId`" suggests for all of them. Then the room just re-echoes the old `turn.prompt` and
   the retry silently does nothing. Fix: one rule in `c1-talk.md` §10. Only E1 `RETRY` reuses the
   `clientId`, because the room may have it. E2, E7 `GO ON`, E8 and both `NOT SENT` lines of §8
   make a new one. Add a test step to S-C1-20: after E8, `RETRY` makes `prompts()` count +1.

3. **`slices.md` C1 counts and the cross-check are stale after T85/T88.** (`slices.md` §3.1, §4.)
   The list is headed "(43)" and holds 43 ids. The done-when, the answer table and "the 40 above"
   all say 40. §4's cross-check row is still "S-C1-01..12, 14..23, 25, 26", without 27, 28, 29.
   "111 live ids" is now 117 by the file's own grep. §7 "Open fixes before a C1 night" still lists
   T26, T27, T29 and T41, which are done, and leaves out T88's successors and T92. A builder night
   follows the done-when literally, so three scenarios fall out of C1's gate. Fix: make the table
   43/47/47/51, add 27-29 to §4, give the id total, and rewrite §7 from the open task list.

4. **The room's MCP port collides with the test harness's port range.** (`c3-see.md` §1 default
   `cockpit.mcp.port` 7790; `stand-ins.md` §1.1 config sets no `mcp` key;
   `test/helpers/boot.mjs` `freePort()` returns 7790-9790.) Every room under test binds 7790. That
   is also the first port `freePort()` may hand to another child, and a room running on the same
   box already holds it. The `npm test` scenarios (the CLI tests, the node:test ones) run files in
   parallel. Fix: §1.1's config sets `"mcp":{"port":0}`, and the room writes the port it got into
   `mcp.json`. One D-line: `0` means "any free port" and `mcp.json` is written after the listen.
   `c3-see.md` §1's `mcp.json` example then shows the port as `{port}`.

5. **The fake agent's log has no `interrupt` kind, but three scenarios assert on it.**
   (`stand-ins.md` §2.6 kinds `start`, `stdin`, `prompt`, `tool-result`, `signal`; S-C1-16
   "no interrupt", S-C1-27 "an interrupt with `cancel_queued` true", `order()`.) An interrupt
   arrives as a `control_request` stdin line. Is `order()` expected to contain `stdin` or
   `interrupt`? I would have to guess. Fix: add a kind
   `{"kind":"interrupt","requestId":"i-0003","cancelQueued":true}` logged next to the `stdin` line,
   and a `prompt` line for every resend with `resendOf`. Also, the `tool-result` example logs
   `"result":{"window":"tonight"}`, which is the input. Show a real `morning` result, or name the
   field `input`.

6. **The room's mode is still undecided, and the test config depends on it.** (T86 open since
   round 60; `spec/README.md` "The room process"; `stand-ins.md` §1.1 `"mode":"builder"`; Q-O29.)
   Under `MODES` today a room is a `builder`. That means the room under test runs collectors, its
   own `/ws` and a board on the room's port, all inside the test. Build step 2 of `slices.md` §3.1
   ("`server/boot/cockpit.mjs` … called by the normal boot") cannot be written before this is
   decided. Fix: T86 before C1, as round 59 said. Until Q-O29 is answered, write for the
   recommendation: `mode: cockpit` as a third `MODES` entry, with no collectors and no `/ws`. Say
   what `boot()` gains: an `entry` option already, and a `mode: 'cockpit'` path.

7. **The STOP line has two spellings.** (`c1-talk.md` §8 "`Stopped at 07:03 (forced).`" vs
   "`STOPPED AT 07:03`" 16 px caps; `protocols.md` §3.2 "`STOPPED AT 07:03`, `(forced)`"; S-C1-17
   asserts both forms.) Which exact string sits in the DOM for a forced stop? Fix: one string in
   §8, `STOPPED AT 07:03 (FORCED)` with CSS `text-transform` off, and S-C1-17 asserts that string.
   Also say which fake-agent script S-C1-17 uses. `ignore` ends at the 5.0 s SIGINT, and
   `ignore-sigint` runs on to the 8.0 s SIGTERM. `stand-ins.md` §2.4 names `ignore-sigint` as
   "S-C1-17's", while S-C1-17 says "ignore the interrupt".

8. **The reconnect series in S-SCR-19 is wrong against the code, and so is T28's correction.**
   (`screens.md` S-SCR-19 "0.5, 1.4, 2.9, 5.6, 10.6, 19.4, 34.4 s"; T28 "0.5, 1.4, 3.02, …";
   `public/js/core/net.js` lines 62, 117.) `connect()` multiplies before the first `schedule`, so
   the real delays are 0.9, 1.62, 2.92, 5.25, 9.45, 15, 15 s. Those sum to 0.9, 2.52, 5.44,
   10.69, 20.13, 35.13, 50.13 s, plus each failed connect's own time, which is real I/O that a
   Playwright fake clock does not move. "± 50 ms" is not testable that way. Fix: say whether the
   room link reuses `net.js`'s loop or has its own. Assert the *delays between attempts* from
   `GET /connections` `atMs` with ± 100 ms, not times after the loss. Put the numbers in T28.

9. **Close codes are still not buildable** (T89 open; round 59 findings 4 and 5). The `(HTTP 403)`
   row and "33rd upgrade gets HTTP 503" still say "no retry, reason in the console". A browser
   sees 1006 for both, the same as a room that is down. 4401 still covers both `unpaired` and
   `revoked <time>`, so the page has to parse the reason text. Fix as T89 says, before C1.

10. **The rate-limit line exists only in a task.** (`protocols.md` §3.1 "`NOT SENT` with T59's
    line"; `c1-talk.md` §10 has no row for it; §8 limits "10 per minute per device token (T59)".)
    The text `Too many messages from this screen; wait a minute.` is in PROGRESS T59, not the spec,
    and no scenario covers it. Fix: an E-row in §10 (E9 `too-many`, label `NOT SENT`, that line,
    `RETRY` enabled after 60 s), one test step, and the reference fixed. While there, fix
    §3.1 "status §3.6": the status line is §3.5.

11. **The conversation after a room restart is still unspecified** (T91 open; round 59
    finding 7). §11.7 now resumes the agent's session from `session.json`, and "a reload of a
    screen shows it (§2.2)". But the snapshot's turns, `clientId`s, D124's `prompt` items and
    `olderTurns` come from the room's memory, and a restart wipes it. The room shows an empty
    conversation in front of a resumed session. Fix: T91 (pending Q-O24), with the file name, its
    format (one line per `seq`'d message, replayed into the model at start) and one scenario.

12. **Fixture extraction and required fields** (T90 open; round 59 finding 6). §13 now names the
    fence classes (`json`, `json bridge`, `json claude`, `json stt`), but the extraction rule for
    inline spans and table cells and the per-type list of required and optional fields are still
    missing. `stop`, `new`, `history`, `touched` and `turn.retrying` are inline or in cells. Is
    `forced` required on `turn.end` `stopped`? Is `atBlock` on `prompt.taken` `taken`? D124's
    `prompt` item is deliberately un-fenced, so nothing checks it at all. Fix: T90, plus a
    `json item` fence class for snapshot items so the D124 shape is checked too.

13. **The C1 stand-in config points at a speech service C1 does not start.** (`stand-ins.md`
    §1.1 `"stt":{"url":"ws://127.0.0.1:<fake speech port>/asr","language":"de"}`; `slices.md` §3.1
    "No fake speech yet".) With no fake speech, `welcome.config.stt` is `on` and the talk button is
    drawn, so every C1 test logs connect failures. Fix: C1's tests use `"stt":{"url":"none"}`
    (`c2-voice.md` §9), and §1.1 says so. S-C1-26's empty line then reads the `none` variant, so
    pick which one C1 asserts.

14. **Still open from rounds 26 and 59, each still a stop for me.**
    - No `data-*` and selector table (T33). S-C1-16..29 add `data-send` and `[data-turn-error]`
      in prose only.
    - No Markdown renderer decision (T34), though §3 lists the subset. Own module or dependency,
      path, the numeric-cell regex?
    - No demo path for the link (T36/T76/T93); `product.md` rule 2 makes it part of C1's done-when
      ("the demo answers `how did the night go`").
    - No Wall contract (T31); six C1 ids wait on the Wall.
    - Utterance lifetime and `lang:"auto"` (T92), which C2 needs.
    - `stand-ins.md`'s phrase table maps "stand-in room", but 32 uses remain across seven files.
      `protocols.md` §9 still says "The stand-in room … speaks this protocol". A search-and-replace
      round would remove a class of doubt for little cost.
    - The sketch `c1-pane.html` (shot this round) still draws `● ANSWERING`, the placeholder
      `Type, or hold TALK`, no `NEW`, no `CHAT`, and `Say "show me" and I fly to it.`. It also has
      no `· QUEUED` block, which is now C1's most distinctive state (T47, T70, T82, T101).

## Contradictions with `spec-input.md`, and what should be owner questions

- None new in this round's reading. The steer rewrite follows Q-O1's recommendation and research
  Q8, and is marked `(pending Q-O1)` throughout.
- Still standing from round 59: D89-D92 and D108 are security-relevant and were closed as D-lines.
  The morning report's "Needs you" item 3 does point the owner at them, which is the right place.
- Finding 11 (keeping the conversation on disk) is retention of the owner's spoken words. It must
  be written `(pending Q-O24)`, not decided by the build night.

## Rubric

score spec concrete 8
score spec complete 5
score spec consistent 4
score spec testable 6
score spec ownerfit 6
score spec simple 5
score spec safe 6
