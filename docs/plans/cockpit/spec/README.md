# Cockpit spec: index and glossary

The spec the spec night writes from the plan (`../README.md`) and the owner's input
(`../spec-input.md`). Where this spec and `spec-input.md` disagree, `spec-input.md` wins. Sizes are
CSS px at 1368x912 (the owner's tablet, landscape, 2x); times are in s or ms. Scenario ids are
`S-<part>-<nn>`; decisions are `D<n>` in `DECISIONS.md`; questions for the owner are `Q-O<n>` in
`QUESTIONS.md`, and spec text that rests on an unanswered one is marked `(pending Q-O<n>)`. Speed
budgets are `B<n>` in §"Speed budget" below. Wording names the general case first ("the laneboard
the room reads: a hub, or a single board"), the owner's setup second or not at all (D251).

## Files

Status: `planned` (task open in `../PROGRESS.md`) or `written`.

| File | What it settles | Scenario ids | Task | Status |
| --- | --- | --- | --- | --- |
| `README.md` | this index, the room process and ports, times on the screen ("since", "at", the age; T65, D232), the speed budget (B1-B11; each test asserts the end-to-end column, B9 is measured on the real screen only, T67), the pressed state and `touch-action` of every tappable (T45, D224), the selectors tests use, and the glossary | none | T1, T24, T33, T45, T65, T67 | written |
| `screens.md` | layouts (wall, canvas, split, switch), tour ⇄ explore idle rules, one screen vs. two, the cockpit button; pairing; unpaired, offline, room down | `S-SCR-` | T2, T3, T31 | part 1 written (T2), part 2 written (T3; T31: §9 the Wall contract, `window.__cockpitView`, the app-first rule, S-SCR-35; T52: room down is the pane's status line only, canvas half in `c4-show-canvas.md` §7.6, D120; T89: S-SCR-24 a refused room link; T65: S-SCR-36 the room down since the day before; T44: §4.1 the corner cluster per state, the `SCREEN` sheet, S-SCR-25/26; T56: §6.1 who may pair (admin routes, peer uid, the agent refused), §6.2 cross-site checks and the `lb_cockpit` cookie, §6.3 the paired line, S-SCR-27..29; T60: §6.4 the room's audit lines, S-SCR-30/31; T64: the `off` talk button opens the pane, the away caption, S-SCR-32, D179; T102: its pressed state, D180; T58/T75: §6.2.1 a plain-HTTP page does not pair unless `cockpit.allowInsecure`, S-SCR-33, D182; T23: §2.1 a speak-up on a touring screen, S-SCR-34, D219; T28: §7.1 the room link's real retry series and `cockpit:retry` marks, S-SCR-19, D11, D220; T115: the room link's own loop on `net.js`'s constants, S-SCR-19 on the real clock, D263; T71: §6.5 the `screen` kind on `cockpit.screen.port` for a LAN tablet, S-SCR-37, D236-D239, pending Q-O27) |
| `c1-talk.md` | C1: the pane, the conversation, reply rendering, tool lines, typing, talk during an answer, errors, new conversation, several screens, raw view | `S-C1-` | T4, T5 | written: part 1 (T4: pane, rendering, tool lines, S-C1-01..12; T24: S-C1-13 hold to talk from the Wall), part 2 (T5: typing, talk during an answer, long replies, errors E1-E8, new conversation, several screens, raw view, S-C1-14..24; T50: header `READY`/`● WORKING`/`● STOPPING`, folds cut to code and `SHOW EARLIER`, E6 merged into E8, no raw view in C1, S-C1-24 retired; T29: §5.1 the room messages the pane draws from, fresh-screen states, S-C1-25/26; T85: §8 rewritten for steer, S-C1-16 rewritten, S-C1-27/28; T88: queued prompts as snapshot items, S-C1-29; T57: §5.2 the allowlist, refused calls, tools that change things, §5.3 redaction, S-C1-30/31; T40: §7.1 the on-screen keyboard, S-C1-32/33; T96: §1.1 the stack above the input row, S-C1-34; T34: §3 the renderer module and the numeric-cell rule, §5 targets from odd input, S-C1-35; T36/T76/T93: §15 the demo link for `?demo=1`, S-C1-36; T68: §10.1 the status line's order and the agent's login check, S-C1-37/38; T43: the type floor, line-slot messages 18 px in the label face, turn state 18 px `--text-2`, S-C1-40; T45: links as `<span>` with no underline D225, tool lines 48 px D226, the pressed state S-C1-41; T59: the cockpit's own lines with a `--line-strong` rule D227, the prompt rate D228, S-C1-42/43; T66: §2.1 the `SINCE YOU LOOKED` divider D233/D234, S-C1-44; T77: §1.2 smaller screens, the full-width pane under 900 px D249, the 700x560 px and Chromium 108 / Safari 16 floor D250, S-C1-45..47; T116: §10 E9 `too-many`, `RETRY` after 60 s D264, S-C1-43; T122: §12 a second prompt queues, never stops, D269, S-C1-23) |
| `c2-voice.md` | C2: the talk button (tap and hold), live words, fix, cancel, send, DE/EN, the talk key, speech-to-text down or failed; §14 the physical-button API as the later slice C2b | `S-C2-`, `S-C2B-` | T6, T7 | written: part 1 (T6: gestures, 400 ms threshold, `data-talk` states, live words, microphone, S-C2-01..10), part 2 (T7, slimmed by T49: tap the words to stop and fix, DE/EN, `cockpit.stt.*`, the service down or failed (`stt-down`, `stt-failed`), the talk key, the kiosk microphone note, S-C2-11..17, 20, 21; T94: S-C2-22 keyboard up; T69: S-C2-23 speech down in a hold; T78: `cockpit.stt.protocol` and the four messages a shim sends; C2b §14: the button API, S-C2B-01..02) |
| `c3-see.md` | C3: the MCP server (`laneboard`, loopback HTTP, D58), the seven read tools with params, results and sources, result rules (`asOf`, size caps), board gaps; `focus`, "Ask about this" | `S-C3-` | T8, T9 | written: part 1 (T8: §1-§7, S-C3-01..08), part 2 (T9: §8 `focus`, §9 the hold menu and context chip, S-C3-09..17, sketch `c3-ask.html`); S-C3-18 (T62: the night answered on the C1 night); S-C3-20 (T78: an empty board, `sources: []` and its `hint`); S-C3-21..23 (T63: a stale source's `say`, `board-down`, a run's cost) |
| `c4-show-canvas.md` | C4: show commands, one camera with the tour, undo; the canvas, kit blocks, custom cards, promotion, how cards leave | `S-C4-` | T10, T11, T12 | part 1 written (T10: §1-§6, show commands `fly_to`/`highlight`/`clear`/`pin`/`compare`/`scrub`, one camera with the tour, show lines, undo, S-C4-01..12, D67-D77); part 2 written (T11: §7-§10, the card area and grid, shelf, `place`, kit blocks `countdown`/`timer`/`status`/`log`/`chart`/`table`/`checklist`/`map`/`text`/`diff`, one-tap removal, S-C4-13..22, D78-D87, sketch `c4-canvas.html`; T52: §7.6 room down on the canvas, S-C4-23/24, D120); part 3 written (T12: §11-§14, custom cards in a sandboxed frame with the checklist SB1-SB12, time limits and turning a card off, how cards leave (ended, `expires`, `remove_card`), the `cards` tool, saving a custom card (`save_card`, `block: "saved"`), S-C4-25..33, D169-D177; T98: a show line's `UNDO` that removes a card gets §9's way back, stacked `UNDO`s 16 px apart, D252; T99: §8.10 taps inside a card (slop, no tap after a scroll) and `s`/`w` bodies that never scroll, the `+ 37 MORE` row growing a card to `l`, `LESS`, S-C4-34/35, D253/D254) |
| `coworker.md` | the watcher and speak-ups (tiers, raised block, cards, marker, chime), quiet hours, config; scheduled jobs (format, scripts, `jobs`/`schedule`/`cancel_job`, firing, Map badge, audit); the infra repo pull and `infra` tool; drift (Map, repo check); the agent's changes (Q-O33) | `S-CW-` | T13 | written (T13: §1-§11, S-CW-01..17, D185-D198, Q-O33; T73: S-CW-18, the turn cap; T127: its messages folded into `protocols.md` §3.9, its test verbs and scripts into `stand-ins.md`) |
| `c5-c6.md` | C5 voice out (the spoken line, `cockpit.tts.*`, playing, `STOP VOICE`, mute per screen, the night); C6 act, rules only (fenced, `cockpit.act.allow`), and the confirm card the Jobs slice builds (where, look, who may answer, how it ends, messages) | `S-C5-`, `S-C6-` | T14 | written (T14: §1-§10, S-C5-01..07, S-C6-01..07, D199-D208, Q-O34, Q-O35, sketch `c6-confirm.html`; T128 folds its messages and the fake voice service into `protocols.md` and `stand-ins.md`) |
| `protocols.md` | screen ⇄ room, room ⇄ agent bridge, room ⇄ speech-to-text, message by message | none (sequences) | T15, T16 | part 1 written (T15: same-origin transport, the room link, hello/resume/snapshot, conversation, show, cards, audio, button, limits, one spoken turn; D92-D99); part 2 written (T16: §11 the bridge, Claude Code's launch and event mapping, stop, sessions, the conversation on disk §11.7.1 (T91), standing instructions; §12 the speech service; §13 test classes; D100-D108); T89: refusals after the upgrade as close codes 4401/4402/4403/4503 and the `revoked` frame (D135); T90/T117: §2.4 every room-link message with `seq`, required and optional fields, §9 the fixture extraction rule and the copy to `docs/cockpit/protocol.md` (D136), pin messages (D137); T72: §11.11 what the bridge needs from any agent, the read-only rule whatever the agent, `allowUnrestricted` (D240-D242); T73: §11.12 the `cockpit.agent` config table with its fatal-at-start lines and the `maxTurnsPerHour` cap (D243-D247); T92: utterance lifetime and `stt.final.lang`, when the grace starts, snapshot parts, `history.turns` ordering, show to every link, held closes, skew mark (D138-D144); T127: §3.9 `speakup`, `job.put`, the speak-up's `turn.prompt`, `speakups`/`jobs` in the snapshot, the Speak and Jobs lines of §11.8 (D276-D278) |
| `security.md` | every credential and what it gives (§1), a device token verb by verb (§2), the link without pairing (§2.3, D212), what the agent's user can read and the start check (§3, D209, D210), the injection paths I1-I16 with their defence and test (§4), reply redaction (§5, D211), what is kept where and how long (§6, D213); links to the defences written elsewhere | `S-SEC-` | T17 | written (T17: S-SEC-01..06) |
| `stand-ins.md` | the room under test and its control API, the fake agent (a fake `claude`, script format), the fake speech service (script format, faults), the demo fleet additions, one script per scenario family, the public demo | none (formats) | T18, T32, T87 | written (T18: §1-§7, D109-D112) |
| `single-machine.md` | everything on one box: one process and its ports, the agent's own user (`agent-user`, the sudo rule, D214, D215), the setups ONE-A (the box's own screen, typing only), ONE-B (a tailnet), ONE-C (a LAN tablet, pending Q-O27), speech or none, another agent (`kind: bridge`, its allowlist check `protocols.md` §11.11), every key in one config, `laneboard cockpit doctor` (D216), the agent on the owner's user (pending Q-O36) | `S-ONE-` | T19 | written (T19: §1-§8, S-ONE-01..07, D214-D218, Q-O36; T72: S-ONE-08..11; T73: S-ONE-12, S-ONE-13..16 (one per `doctor` check's failing lines, D248)) |
| `slices.md` | the build nights in order (C1 with the fleet's night, C2, C3, Speak, Canvas, Show, Jobs, then the rest), each with its scenario ids, stand-ins and done-when; the acceptance harness (`e2e/cockpit/`, D88, D113); the board changes the slices make; every id once; C1 and C2 end with one measured run on the real screen (D256) | none (lists every id once) | T20, T30, T37, T62, T80, T81, T106 | written (T20) |
| `DECISIONS.md` | small reversible choices made during the night, each with how to overrule | none | all | written (running list) |
| `QUESTIONS.md` | what only the owner can decide: the eight for the morning first, then the rest, each with options and a recommendation | none | all | written (running list, reordered by T55) |
| `sketches/` | static HTML sketches at 1368x912, one per `[sketch]` task; written: `screens-split.html` (T2; redrawn to D78/D117 by T25/T47), `c1-pane.html` (T4; redrawn to §1/§8 at 28 px by T47; a `· QUEUED` block and D267 by T120), `c2-states.html` (T6; a second sheet `#turn` with the slot during a turn by T125, D272), `screens-room-down.html` (T3/T22; redrawn to §4.1 D/F and D120 by T70), `c3-ask.html` (T9; redrawn to S-C3-09/10's rects by T101), `c4-canvas.html` (T11; tool line, microphone and 28 px type by T82/T101), `c6-confirm.html` (T14) | none | T2-T4, T6, T9, T11, T14 | written |

## The room process

What the room is, in one place (D89, D92, D128, D129; T37, T86; pending Q-O29).

- **Process**: the laneboard server (`server/index.mjs`) whose config has `cockpit.agent`. On one
  box it is the board's own process (`mode: builder`); beside a hub, or as a second user beside a
  board, it is its own process with `mode: cockpit` on `127.0.0.1` (D91, D128).
- **Modes** (`server/config/mode.mjs` `MODES`, D128):

  | `mode` | `cockpit` section | Runs | Serves |
  | --- | --- | --- | --- |
  | `builder` | none | the board as today | page, `/ws`, `/api/*` |
  | `builder` | `agent` (one box) | the board and the room | page, `/ws`, `/api/*`, `/api/cockpit/*`, MCP |
  | `builder` or `hub` | `forwarded: true` only (D129) | the board or the hub; its front forwards to a room | page, `/ws`, `/api/*` |
  | `cockpit` | `agent` (required) | the room alone: no collectors, sessions, terminals or `/ws` | `/healthz`, `/api/cockpit/*`, MCP |

  Fatal at start: `cockpit.agent` on a `hub`; `mode: cockpit` without `cockpit.agent`;
  `forwarded` together with `agent` (messages in D128, D129).
- **Entry point**: `server/boot/cockpit.mjs`. It exports `startRoom(ctx)`, which
  `server/boot/builder.mjs` calls when `cockpit.agent` is set, and as a module imported by
  `server/index.mjs` for `mode: cockpit` it is the whole wiring (`listenAll`, `registerHealthz`,
  `startRoom`, `installSignalHandlers` from `server/boot/common.mjs`). The room's modules live in
  `server/cockpit/` (`bridge.mjs`, `protocol.mjs`, `clock.mjs`, `faults.mjs`), its config parser in
  `server/config/cockpit.mjs`. `server/index.mjs` changes in one line (the third mode's import).
- **Origin**: the page's own; the room answers `/api/cockpit/*` (HTTP and the room link), the board
  everything else; with two processes the front that serves the page forwards that prefix
  (`protocols.md` §1). The prefix is the constant `COCKPIT_PREFIX = '/api/cockpit'` (D93).
- **Ports** (the one list; other files link here):

  | What | Key | Default | Bind |
  | --- | --- | --- | --- |
  | the board or hub, and the one box's room | `port` | `7777` | `bind`, default `127.0.0.1` |
  | a room alone (`mode: cockpit`) | `port` | `7778` (the mode's own default) | `127.0.0.1` only |
  | the MCP server (D58) | `cockpit.mcp.port` | `7790` (`0`: any free port, the tests' setting, D260) | `127.0.0.1` only |

## Times on the screen: "since", "at" and the age (T65, D232)

One rule for every time of day and every age the cockpit writes (review 44 finding 4). It sits on
D149 (`D Mon` dates in fixed English, `HH:MM` 24 h). One pure module holds it,
`public/js/core/cockpit-time.js`, no imports; the room imports the same file (as D150's constants).

**The clock**, `clockText(ms, nowMs, timeZone?)`, by calendar day in the time zone (the screen's own
on the page; the board's `config.timezone` on the room):

| When `ms` is | Text | Example |
| --- | --- | --- |
| the same day as `nowMs`, or later (clock skew) | `HH:MM` | `06:41` |
| the day before | `yesterday HH:MM` | `yesterday 22:10` |
| earlier | `D Mon HH:MM` (D149, no year) | `25 Oct 22:10` |

Sentences use two forms of it: **since** `since {clock}` (`since yesterday 22:10`), and **at**
`atText`: `at 07:04` the same day, `yesterday at 22:10`, `on 25 Oct at 22:10`.

**The age**, `ageText(ms, nowMs)`, from the elapsed milliseconds (`nowMs - ms`, below 0 counts as
0), whole units rounded down, always in brackets:

| Elapsed | Text | Example |
| --- | --- | --- |
| under 60 min | `(N min)` | `(0 min)`, `(49 min)` |
| 60 min to under 24 h | `(H h MM)`, minutes two digits | `(1 h 00)`, `(9 h 20)` |
| 24 h and more | `(D d H h)` | `(1 d 9 h)` |

`sinceText(ms, nowMs, timeZone?)` is the two joined: `since 06:41 (3 min)`.

**Which text carries what.**
- **A condition that still holds** carries the age: `since {clock} ({age})`. These are the status
  line's rows 1-6 (`c1-talk.md` §10.1), the canvas strip and the empty-canvas line
  (`c4-show-canvas.md` §7.6), and the Wall's board caption (`screens.md` §7). The age is redrawn
  every 1 s from the screen's clock (`Date.now()`), with the line's other counters; the clock part
  is redrawn with it, so `22:10` becomes `yesterday 22:10` at the screen's midnight.
- **One exception**: the Wall's away caption `Agent away since {clock}` (`screens.md` §7) has no
  age: it is one 32 px line next to `CHAT`, and the pane one tap away has the age.
- **An event in the past** carries the clock only, never an age (an age in kept text would go
  stale): `Back since 06:47.`, E2's `at 07:04` and `(07:04)` (`c1-talk.md` §10), the cut-off line
  `at 06:41` (`screens.md` §7), the unpaired line (`screens.md` §6), a stale source's `say`
  (`c3-see.md` §3, made on the room), the watcher's `since 06:12` (`coworker.md` §3).
- **Not covered**: label times (`YOU · 07:02`, `NEW CONVERSATION · 07:10`, `STOPPED AT 07:03`,
  `RAISED · 07:14`) stay `HH:MM` (D232); the turns they label are in time order. The
  `SINCE YOU LOOKED` divider is no label time: it takes `clockText`, upper-cased (D234).
- **Where `ms` comes from.** A screen's own condition (offline, room down, `Back since`) uses the
  screen's clock when it began. A room condition carries the room's `since` (ISO 8601 with offset) in
  `status` (`protocols.md` §3.5); the screen parses it and formats it in its own time zone; a `since` ahead of
  the screen's clock shows `(0 min)` and the screen's `HH:MM` of it.

**The table the module's unit test runs** (`timeZone` `Europe/Zurich`, now 2026-10-27 07:30:00,
after the 25 Oct change from summer time):

| `ms` | `clockText` | `ageText` | `atText` |
| --- | --- | --- | --- |
| 2026-10-27 07:30:00 | `07:30` | `(0 min)` | `at 07:30` |
| 2026-10-27 07:29:01 | `07:29` | `(0 min)` | `at 07:29` |
| 2026-10-27 06:41:00 | `06:41` | `(49 min)` | `at 06:41` |
| 2026-10-27 06:30:00 | `06:30` | `(1 h 00)` | `at 06:30` |
| 2026-10-27 06:18:00 | `06:18` | `(1 h 12)` | `at 06:18` |
| 2026-10-27 00:00:00 | `00:00` | `(7 h 30)` | `at 00:00` |
| 2026-10-26 22:10:00 | `yesterday 22:10` | `(9 h 20)` | `yesterday at 22:10` |
| 2026-10-26 07:31:00 | `yesterday 07:31` | `(23 h 59)` | `yesterday at 07:31` |
| 2026-10-26 06:00:00 | `yesterday 06:00` | `(1 d 1 h)` | `yesterday at 06:00` |
| 2026-10-25 22:10:00 | `25 Oct 22:10` | `(1 d 9 h)` | `on 25 Oct at 22:10` |
| 2026-10-01 09:00:00 (summer time) | `1 Oct 09:00` | `(25 d 23 h)` | `on 1 Oct at 09:00` |
| 2026-10-27 07:31:00 (ahead) | `07:31` | `(0 min)` | `at 07:31` |

And one across midnight: now 2026-10-28 00:00:30, `ms` 2026-10-27 23:50:00 gives
`yesterday 23:50` and `(10 min)`. Test: `node --test` on the module with these 13 rows; the same
rows with `timeZone` unset under `TZ=Europe/Zurich` (the page's path). The screen's half is
S-SCR-36.

## Speed budget

`spec-input.md` §4-§5: the cockpit must keep the terminal's speed ("In the terminal it works really
well"; "a timer must not take 5 minutes"). These are the numbers every spec file cites as `B<n>`
instead of writing its own. A scenario with a timing asserts against its row. Times run from the
**start** event to the **end** event on the screen, at 1368x912, against the stand-ins
(`stand-ins.md`, T18).

| Id | Start (clock) | End (what the screen shows) | Budget, end to end (asserted) | Stand-in setting inside that budget | Slice that asserts it |
| --- | --- | --- | --- | --- | --- |
| B1 | `pointerdown` on the talk button (screen) | the button in its listening state (`data-talk="listening"`, T6) and audio frames leaving the screen | ≤ 0.2 s | none | C2 |
| B2 | `pointerdown` on the talk button, the speaker starts at once (screen) | the first partial word drawn in the input | ≤ 1.0 s | fake speech sends its first partial 0.6 s after the first audio frame | C2 |
| B3 | `pointerup` (hold) or the second tap (tap-tap) (screen) | the prompt block drawn in the conversation (`YOU · SPOKEN · HH:MM`), the input empty | ≤ 0.3 s | fake speech sends its final 0.15 s after the stop | C2 |
| B4 | the room sends the turn's first `text.delta`, its `sentAt` (room) | that text drawn in the conversation | ≤ 0.5 s | none | C1 |
| B5 | the room receives a show command from the agent, the `show`'s `receivedAt` (room) | the camera's first frame of movement on every screen it targets | ≤ 0.3 s | none | C4 |
| B6 | the room receives a kit-block tool call from the agent, the `card.put`'s `receivedAt` (room) | the block drawn on the canvas with its live data | ≤ 1.0 s | none | C4 |
| B7 | a tap on the opener, or a press on the talk button (screen) | the pane in place, its slide ended (`c1-talk.md` §2) | ≤ 0.2 s | none | C1 |
| B8 | `SEND` tapped, typed prompt (T5) (screen) | the prompt block drawn in the conversation, `data-turn="thinking"` | ≤ 0.1 s | none | C1 |
| B10 | the room receives a custom-card `place` (or `block: "saved"`) from the agent, the `card.put`'s `receivedAt` (room) | the card's frame has sent `card:ready` and shows its first data (`c4-show-canvas.md` §11.4) | ≤ 2.0 s | none | C4 |
| B9 | `SEND` tapped (typed), or `pointerup` / the second tap that ended a spoken prompt (B3's start) (screen) | the reply's first sentence drawn whole in the conversation: the first sentence end of `c5-c6.md` §1 ("A sentence ends") in the drawn text of the reply's first paragraph, or that paragraph or the turn ended | ≤ 15 s, **measured, never asserted** (D235) | none: the real agent, the morning question `How did the night go?` (S-C3-18), the standing instructions' line 2 (`c3-see.md` §5, `morning` once first) | none; C1 sets the marks, the C1 and C2 done-whens end with one measured run (`slices.md` §3.1, §3.2, D256) |
| B11 | the room has the reply's spoken line (its sentence end in the deltas, `c5-c6.md` §1), the `speak`'s `receivedAt` (room) | `cockpit:speak-start` on the screen that sent the prompt | ≤ 1.0 s | fake voice service answers 0.3 s after the request | C5 |

- **A test asserts the end-to-end column, nothing else** (D223). There is no "screen's share"
  of a row: where a stand-in setting sits inside a budget (B2, B3, B11), the test holds the whole
  row, stand-in time included, and the setting is fixed in `stand-ins.md` so that what is left
  (0.4 s, 0.15 s, 0.7 s) is the screen's and the room's time without being measured on its own.
  A row is asserted from the slice in the last column on; before it, its marks may exist and no
  test reads them (B5, B6, B10 belong to C4, B11 to C5).
- **The agent's own time is not in a test's budget.** B4 starts when the room sends the agent's
  first delta on to the screens; how long a real agent thinks before that is its own (with Claude
  Code, seconds; a morning question with eight tool calls, 20-40 s, `reviews/44-operator.md`
  finding 8). What the screen shows while it thinks is the turn state `● WORKING` (`c1-talk.md`
  §2), drawn within B8, and from 3 s the turn's age in its `AGENT` label row (`c1-talk.md` §9).
- **B9 is the owner's number, not a test's** (D235). It holds the agent's time, so it is only read
  on the real screen with the real agent: the first answer to `How did the night go?` in a fresh
  conversation, its `cockpit:B9` measure read in remote devtools and pasted into `PROGRESS.md`
  §"Measured on the real screen" (the last line of C1's and C2's done-when, `slices.md` §3.1, §3.2, D256). Over 15 s is not a failure of any night; it says the standing instructions or the
  tools need work. `npm test` checks only that the page sets one `cockpit:B9` measure per turn
  that has reply text (S-C1-21), never its value. A turn with no reply text (only tool lines, an
  error, `STOP`) sets no B9 end mark and no measure.
- **Real hardware is measured, not promised.** The real speech service's first-partial time is
  unknown (research Q4: no authoritative figure; measure it on the machine that runs the speech
  service, e.g. WhisperLiveKit's `wlk bench`). The real end-to-end numbers are what a real
  setup should reach; they are read from the marks
  below on the real screen and are not a test gate.
- **Marks** (D28). For every row the screen sets `performance.mark('cockpit:B<n>:start')` and
  `performance.mark('cockpit:B<n>:end')`, then `performance.measure('cockpit:B<n>',
  'cockpit:B<n>:start', 'cockpit:B<n>:end')`. A row whose start is on the room's clock (B4,
  B5, B6, B10, B11) sets its start mark back-dated from the message:
  `performance.mark('cockpit:B<n>:start', {startTime: t - performance.timeOrigin})`, where `t`
  is the message's `sentAt` or `receivedAt` (epoch ms, the room's `Date.now()`, `protocols.md`
  §2.1). In tests the room and Chromium run on one host and read the same system clock, so the
  measure is exact to about 1 ms; on the real screen it also holds the clock skew between the
  two machines, which the page logs once as `cockpit:skew` (D142). A test reads
  `performance.getEntriesByName('cockpit:B<n>', 'measure')`; on the real screen the owner reads
  the same entries in the browser's remote devtools. Nothing is drawn and nothing is logged to the
  console: there is no `?perf=1` (D28). A measure over budget is not an error on the real screen,
  only a number to look at.
- **Tests allow no slack** beyond the table: a stand-in run that misses a budget fails. A build
  night that cannot meet a row on the VM's headless Chromium writes why in `PROGRESS.md` instead
  of widening the row; only the owner widens a budget.
- The hold-versus-tap threshold (T6) does not delay B1: listening starts on `pointerdown` in both
  gestures; the threshold only decides, at `pointerup`, whether that release sends (hold) or keeps
  listening (tap) (D29, T6 details the gesture).

## Touch: the pressed state and `touch-action` (T45, D224)

There is no hover on the owner's screen, so the instant a finger lands is the only cue that a tap
was felt. One rule for every **tappable**: every `<button>` the cockpit draws, a tool line
included (it is a `<button type="button">`, §5 of `c1-talk.md`). A link in a reply is not one
(`c1-talk.md` §3, D225).

- **The pressed state**: fill `--bg-sunken`; border colour `--text-2` on a tappable that has a
  border (width unchanged; a borderless one, such as a tool line or a sheet row, gets none, so
  nothing moves); text and glyph colours unchanged. It is drawn in the first frame after the
  `pointerdown` and goes in the frame after the `pointerup`, the `pointercancel` or the pointer
  leaving the box. No transition on `background-color` or `border-color`, at rest or pressed.
  At rest no tappable is filled `--bg-sunken`, so the press always shows: on the `NEW` bar (itself
  `--bg-sunken`) `KEEP` and `START` rest on `--bg-elevated`.
- **How**: one delegated `pointerdown` listener (capture phase, on `document`) in one client
  module sets `data-pressed` on `event.target.closest('button')` and calls
  `releasePointerCapture(event.pointerId)` so leaving the box fires `pointerleave`; CSS draws
  `[data-pressed]`. Not `:active`, whose timing on touch differs between browsers. A drag that
  turns into a scroll is a `pointercancel` (the browser's), so a tool line under a flick drops
  the pressed state as the conversation starts to move.
- **No pressed state**: a `disabled` or `aria-disabled="true"` button (the blank slot
  `data-send="none"` or `"wait"`, a `RETRY` still waiting); the talk button in every state but `off`, which has
  its own (`c2-voice.md` §3: the press is `listening` within B1; `off` is this rule, D180); the Map
  and the Wall (pan surfaces); a card's body and frame outside its buttons (`c4-show-canvas.md` §8;
  the buttons in a card also wait for §8.10's tap rule).
- **`touch-action: manipulation`** on every tappable: no double-tap zoom, no wait for a second tap.
  The talk button keeps `none` (`c2-voice.md` §2).

**Tappables C1 draws** (the rows of S-C1-41's table; each later slice adds its own rows to the
same table: C2 `[data-talk-cancel]`, `[data-talk-undo]`, `[data-talk-lang]`; C3
`[data-ask]`, `[data-ask-cancel]`, `[data-cockpit-chip-remove]`; Show `[data-show-undo]`, `[data-show-putback]`,
`[data-pin-remove]`; Canvas `[data-card-remove]`, `[data-card-cancel]`, `[data-card-removed]`
`UNDO`, `[data-card-more]`, `[data-card-less]`, `[data-card-new]`; Canvas 2 `[data-check-row]`; `[data-cockpit-switch]`, `[data-screen-sheet]` rows; the talk button `off` is S-SCR-32's):

| Tappable | Selector or accessible name | Rest look | Defined in |
| --- | --- | --- | --- |
| `CHAT` / `CLOSE` opener | `[data-cockpit-open]` | 1 px `--line-strong`, `--bg-elevated` | `screens.md` §4 |
| header `CLOSE`, `NEW`, `SCREEN` | `[data-cockpit-close]`, `[data-cockpit-new]`, `[data-cockpit-screen]` | same | `c1-talk.md` §1 |
| `SEND` / `STOP` slot | `[data-cockpit-send]` (`send`, `stop`) | same | `c1-talk.md` §8 |
| `NEW` bar `KEEP` / `START` | `[data-cockpit-newbar] [data-newbar]` | same | `c1-talk.md` §11 |
| `↓ NEW` | `[data-cockpit-follow]` | same | `c1-talk.md` §4 |
| a tool line, a `tried` line | `[data-tool-line]` | no border, no fill | `c1-talk.md` §5 |
| `SHOW ALL 40 LINES` / `SHOW LESS`, `SHOW EARLIER` | by name | 1 px `--line-strong`, `--bg-elevated` | `c1-talk.md` §3, §9 |
| `RETRY`, `EDIT`, `GO ON` in an error line | by name inside `[data-turn-error]` | same | `c1-talk.md` §10 |
| `RETRY NOW` | by name inside `[data-cockpit-status]` | same | `c1-talk.md` §10.1 |

## Selectors tests use

The one list of the `data-*` attributes the cockpit adds and the tests read (D145, T33). Every spec
file links here for the values; a name used in a spec or a test that is not in this table is a bug
in the spec. "Root" is `<html>` (`document.documentElement`), where the app's shell already sets
`data-layout` (`phone|tablet|desktop`), `data-density` and `data-theme`
(`public/js/ui/shell.js`); the cockpit leaves those three alone. An attribute is absent, not empty,
when no value applies.

**State on the root**

| Attribute | Values | Set by | Defined in |
| --- | --- | --- | --- |
| `data-cockpit` | `unconfigured`, `unpaired`, `connecting`, `live`, `room-down`, `offline` | the room link | `screens.md` §7, `protocols.md` §2 |
| `data-board` | `live`, `down` | the board's `/ws` | `screens.md` §7 |
| `data-pair-card` | `code`, `again`, `insecure` (on the card in the pane and on an empty canvas) | the pairing step | `screens.md` §6, §6.2.1 |
| `data-cockpit-layout` | `wall`, `canvas`, `split`, `switch` (Wall page only) | the layout | `screens.md` §1 |
| `data-switch-shows` | `wall`, `canvas` (only in `switch`) | the switch button | `screens.md` §1 |
| `data-wall-state` | `tour`, `explore` (Wall page, absent in `canvas`) | the Wall (Wall contract W1, `screens.md` §9.1) | `screens.md` §2 |
| `data-wall-hold` | `speakup` (only while a speak-up holds the camera) | the speak-up hold | `screens.md` §2.1 |
| `data-pane` | `open`, `closed`, `column` | the pane | `c1-talk.md` §1-§2 |
| `data-turn` | `idle`, `thinking`, `working`, `answering`, `stopping` | the room's `turn.state` | `c1-talk.md` §2 |
| `data-keyboard` | `up`, `held`, `down` | `visualViewport` and the input's focus | `c1-talk.md` §7.1 |
| `data-cockpit-demo` | none (present or absent) | the page took the demo link (D148) | `c1-talk.md` §15 |

**The conversation and the input row**

| Selector | Values | What it is | Defined in |
| --- | --- | --- | --- |
| `[data-cockpit-conversation]` | none | header, line slot, conversation and input row, pane or column | `c1-talk.md` §1 |
| `[data-cockpit-open]` | none (text `CHAT` or `CLOSE`) | the opener above the talk button | `screens.md` §4 |
| `[data-cockpit-close]`, `[data-cockpit-new]`, `[data-cockpit-screen]` | none | the header's `CLOSE`, `NEW` and `SCREEN` (D159) | `c1-talk.md` §1, `screens.md` §4.1 |
| `[data-cockpit-away]` | none (text `Agent away since 06:41`) | the Wall page's room-down caption above `CHAT`, pane closed, not tappable (D179) | `screens.md` §7 |
| `[data-cockpit-switch]`, `[data-switch-count]` | none (text `CANVAS` or `WALL`; the count) | the switch button, only in `switch` (D156) | `screens.md` §4 |
| `[data-screen-sheet]` with rows `[data-layout-choice]`, `[data-screen-cancel]` | `wall`, `canvas`, `split`, `switch` | the `SCREEN` sheet (D157) | `screens.md` §1, §4.1 |
| `[data-cockpit-turn]` | none (text `READY`, `● WORKING` or `● STOPPING`) | the header's turn state, 18 px caps `--text-2` (D167) | `c1-talk.md` §1-§2 |
| `[data-cockpit-follow]` | none (text `↓ NEW`) | the button back to the end of the conversation | `c1-talk.md` §4 |
| `[data-cockpit-line]` with `data-line` | `room-down`, `error`, `hint`, `length` | the one line slot above the input row | `c1-talk.md` §1.1 |
| `[data-cockpit-input]` | none | the `<textarea>` | `c1-talk.md` §7 |
| `[data-cockpit-demo-label]` | none (text `DEMO`) | the header's demo label | `c1-talk.md` §15 |
| `[data-cockpit-send]` with `data-send` | `send`, `stop`, `wait` (`SEND` greyed and inert for 1.0 s after a send, D268), `none` (blank and inert while the microphone is open and 1.0 s after it closes) | the slot left of the talk button | `c1-talk.md` §8, `c2-voice.md` §3 |
| `[data-cockpit-newbar]`, its buttons `data-newbar` | `keep`, `start` | the `NEW` bar | `c1-talk.md` §11 |
| `[data-cockpit-chip]` with `data-node`, `[data-cockpit-chip-remove]` | a node id | the context chip and its `✕` | `c3-see.md` §9 |
| `[data-turn-id]` | a `turnId` (`t-0131`) | one turn: its prompt block and everything under it to the next turn (T91) | `c1-talk.md` §3 |
| `[data-tool-line]`, `data-denied` | `true` on a refused call | one tool line | `c1-talk.md` §5, §5.2 |
| `[data-pressed]` | none (present or absent) | a tappable under a finger: the pressed state (D224) | §"Touch" above |
| `[data-link]` | none (a `<span>`, text `the run`; its host follows in a `--text-3` span) | a link in a reply, never an `<a>` (D225) | `c1-talk.md` §3 |
| `[data-mark]` | none | one coloured mark `■ ▲ ● ○` in a reply | `c1-talk.md` §3 |
| `[data-cockpit-status]` with `data-status` | `offline`, `room-down`, `agent-down`, `not-logged-in`, `tools-down`, `board-down`, `agent-back`, `back` | the pane's one 80 px status line | `c1-talk.md` §10.1 |
| `[data-turn-label]` | none (text `YOU · 07:02`, `AGENT · 07:02`) | a label row, ruled 2 px `--line-strong` (D227) | `c1-talk.md` §3 |
| `[data-turn-age]` | none (text `0:03`, `1:48`, `1:02:03`) | a turn's age in its `AGENT` label row, from 3 s (D235) | `c1-talk.md` §9 |
| `[data-reply]` | none | one reply's blocks built from `md.js`; nothing inside uses `--line-strong` (D227) | `c1-talk.md` §3 |
| `[data-turn-stopped]` | none (text `STOPPED AT 07:03` or `STOPPED AT 07:03 (FORCED)`, D262) | the stopped line under a stopped turn | `c1-talk.md` §8 |
| `[data-cockpit-unsupported]` | none (text `This browser is too old for the cockpit. …`) | the pane's text in a browser below the floor (D250) | `c1-talk.md` §1.2 |
| `[data-turn-error]` | `not-sent`, `agent-exited`, `agent-down`, `not-logged-in`, `step-limit`, `failed` | an error line in a turn | `c1-talk.md` §10 |

**The talk button and speech** (`[data-talk]` is the talk button; the "mic state attribute" is its `data-talk`)

| Selector | Values | Defined in |
| --- | --- | --- |
| `[data-talk]`, `data-talk` | `idle`, `listening`, `partial`, `final`, `error`, `off` | `c2-voice.md` §3 |
| `data-talk-gesture` on `[data-talk]` | `tap`, `hold` | `c2-voice.md` §2 |
| `[data-talk-error]` (the line) | `mic-blocked`, `no-mic`, `mic-failed`, `mic-insecure`, `stt-down`, `stt-failed` | `c2-voice.md` §5, §10 |
| `data-talk-detail` on `[data-talk]` | `no-answer`, `busy`, `token`, `failed` | `c2-voice.md` §10 |
| `[data-talk-text]` (the live words), its spans `[data-firm]`, `[data-tail]` | none | `c2-voice.md` §4 |
| `[data-talk-lang]` (the language button) | none (text `DE` or `EN`) | `c2-voice.md` §8 |
| `[data-talk-cancel]`, `[data-talk-undo]` (the row's left end while the microphone is open; 5 s after a cancel) | none (`✕` named `Cancel`; `UNDO`) | `c2-voice.md` §3 |

**See and show** (C3, C4)

| Selector | Values | Defined in |
| --- | --- | --- |
| `[data-ask-menu]` with `data-node`; rows `[data-ask]`, `[data-ask-cancel]` | a node id | `c3-see.md` §9 |
| `[data-show-line]` with `data-show-id`, `data-show-state`; `[data-show-undo]`; `[data-show-putback]` (10 s after a show line's `UNDO` removed a card on a screen without canvas, D252) | `shown`, `waiting`, `skipped`, `noCamera`, `undone`, `replaced` | `c4-show-canvas.md` §4 |
| `[data-show-mark]` with `data-node`, `[data-show-note]` | a node id | `c4-show-canvas.md` §3 |
| `[data-pin]` with `data-pin-id`, `data-node`; `[data-pin-remove]` | ids | `c4-show-canvas.md` §3 |
| `[data-compare]`, `[data-scrub]` | none | `c4-show-canvas.md` §3 |
| `[data-card]` with `data-card-id`, `data-block`, `data-size`; `[data-card-remove]`, `[data-card-cancel]`, `[data-card-removed]`; `[data-card-more]`, `[data-card-less]`, `[data-card-new]` (§8.4, §8.10); `[data-check-row]` with `data-row`, `aria-pressed` (§8.7) | `data-block`: `countdown`, `timer`, `status`, `log`, `chart`, `table`, `checklist`, `map`, `text`, `diff`, `custom` (its frame `[data-card-frame]`, §11.4); `data-size`: `s`, `w`, `t`, `l` | `c4-show-canvas.md` §7.2-§7.3, §8, §9 |
| `[data-shelf]` | none (text `SHELF n`) | `c4-show-canvas.md` §7.2 |
| `[data-cockpit-down]` (the room-down strip on the canvas) | none | `c4-show-canvas.md` §7.6 |

Not attributes: the camera and the Map are read through page functions (`screenOf(id)`,
`emphasis(id)`, `nodeAt(x, y)`), on `window.__cockpitView` (the Wall contract, `screens.md` §9, D221), and
the speed marks through `performance.getEntriesByName` (§"Speed budget").

## Glossary

Each word is defined here once; the other files link here instead of redefining it.

- **screen**: a browser showing the laneboard UI on a display (the owner's desk tablet, a wall
  screen, a laptop tab). A window only: it holds one device token and nothing else worth stealing.
  Each screen is in one mode at a time, or two modes side by side on one screen (`screens.md`).
- **mode**: what a screen shows: tour, explore or canvas.
- **browser floor**: the smallest viewport (700x560 px) and oldest browser (Chromium 108, Safari 16) the cockpit is offered in; below it the board works without the cockpit (`c1-talk.md` §1.2, D250).
- **layout**: how the Wall page arranges modes on one screen: `wall`, `canvas`, `split` or `switch` (`screens.md` §1).
- **cockpit button**: the talk button (64x64) plus `CHAT` (48x48, reads `CLOSE` while the pane is open), bottom right, in the same two rects on every view and on the Wall (`screens.md` §4, D116, pending Q-O11).
- **tour**: the Wall's idle mode: the camera flies the fleet on its own, trouble first (Wall plan
  D4, on `origin/plan/wall`).
- **explore**: the mode after a touch on the tour: the camera goes where the finger says. One
  minute without touch and the screen goes back to the tour (Wall plan D4).
- **canvas**: a mode in which the screen (or half of it) is an open surface where the agent places
  cards (plan C4b).
- **Wall**: laneboard's separate page for a tablet or wall screen (`wall.html`, branch
  `origin/plan/wall`, not merged); it runs the tour and explore.
- **Wall contract**: the one list of what the cockpit uses from the Wall page (W1-W6) and from the Map
  (M1-M8), reached through `window.__cockpitView` (`screens.md` §9, D221, D222).
- **room**: in this spec, the **cockpit room**: the always-on machine (VM or container) that runs
  the agent session, the bridge, the speech-to-text client, optional text-to-speech and the
  laneboard MCP server. Not a screen, not a laptop, not a hub. A Map node of `kind: room`
  (`docs/map.md`) is called a **room node** here (D1).
- **hub**: laneboard's existing aggregator that reads the builders' boards (`docs/fleet/hub.md`,
  `server/hub/`). Plan C4 has it relay show commands to screens; the spec sends them on the room link
  instead and the hub gains nothing for the cockpit (D92, `protocols.md` §1).
- **one box**: the setup where board, room and page are one laneboard process on one machine (`mode: builder` with `cockpit.agent`) and the agent runs beside it as its own unix user (`single-machine.md`).
- **the agent's user**: the unix account the agent runs as, `cockpit.agent.user`; never the room's own user (`screens.md` §6.1, `single-machine.md` §3, pending Q-O36).
- **agent**: the one long-running agent session in the room. First-class: Claude Code in headless
  streaming mode; any agent that speaks the bridge protocol and enforces the tool allowlist works
  (plan §5, `protocols.md` §11.11).
- **bridge**: the part of the room process between the room's services and the agent's child
  process: user text in, streamed reply and tool events out, interrupt, session start and resume
  (`protocols.md` §11, D100).
- **conversation**: the one cockpit conversation all screens show; made of turns. A "new
  conversation" starts another (`c1-talk.md`).
- **turn**: one prompt from the owner (typed or spoken) and the agent's whole reply to it,
  including its tool lines and show commands. A turn the agent starts itself (speaking up,
  `coworker.md`) has no prompt.
- **steer / queued prompt**: a prompt sent while a turn runs goes into that turn; it is **queued**
  (`· QUEUED`: the word 18 px `--text-1`, the prompt's text grey, D270) until the agent reads it at its next tool boundary, then **taken**
  (`c1-talk.md` §8, `protocols.md` §3.4, pending Q-O1).
- **demo link**: a client-side stand-in for the room link, used with `?demo=1` when there is no cockpit; canned turns, no network (`c1-talk.md` §15, D148).
- **delivery word**: `SENDING`, `QUEUED` or `NOT SENT` at the end of a prompt's label row, `[data-turn-delivery]`, 18 px `--text-1` (`c1-talk.md` §3, D270).
- **pane**: the cockpit pane: the panel that slides over the current view and shows the
  conversation and the input. It never replaces the view (plan C1). Where the screen has a canvas
  (`split`, `canvas`, `switch`) the same parts are a fixed **column** of the canvas instead, always
  there (`c1-talk.md` §1, D117, pending Q-O12); both are `[data-cockpit-conversation]`.
- **since you looked / `lookedAt`**: per screen, the moment its pane last closed; what came into the
  conversation after it sits under the `SINCE YOU LOOKED` divider the next time that pane opens
  (`c1-talk.md` §2.1, D233).
- **raw view**: a read-only list of the agent's native events, never a terminal; not in C1
  (`c1-talk.md` §13, pending Q-O17).
- **tool line**: one collapsed line in the conversation for a piece of the agent's tool activity
  ("read 3 feeds", "looked at CI on main") (`c1-talk.md`).
- **talk button**: the 64x64 button bottom right (`[data-talk]`) that starts and sends voice input,
  by tap-tap or hold-release; one element in one rect: with the pane closed it floats in the corner
  and a press opens the pane with the live words, with the pane open it is the right end of the
  input row (`screens.md` §4, `c2-voice.md` §1-§3, pending Q-O11). Absent with `cockpit.stt.url:
  none`. A physical button reaches it later through the room's API (C2b, `c2-voice.md` §14).
- **talk key**: a key on the screen's keyboard (`F13` by default) that acts as the talk button,
  for a USB macro key (`c2-voice.md` §11).
- **button token**: the secret a physical button sends to the room's talk API; it can only press
  and release talk on one screen (C2b, `c2-voice.md` §14, pending Q-O20).
- **partial / final**: speech-to-text results: a partial is a guess that may still change, a final
  is fixed. The input shows partials and replaces them as they firm up.
- **board**: in `c3-see.md`, the laneboard server the room's MCP server reads over HTTP (`cockpit.board.url`):
  a hub in fleet mode, or a single laneboard on one machine.
- **MCP server**: the laneboard MCP server in the room: the read tools (C3) and the show
  commands (C4) the agent calls.
- **focus**: what the owner is looking at or touching on a screen right now: the view, the
  selected node, the open run. Readable by the agent through the MCP tool of the same name
  (`c3-see.md` §8).
- **context chip**: the 48 px chip above the input that "Ask about this" puts there (`ABOUT vm-b`);
  it goes with the next prompt only, as a fixed line naming the node's id (`c3-see.md` §9).
- **show command**: an MCP tool that changes what a screen shows, never the fleet: `fly_to`,
  `highlight`, `clear`, `pin`, `compare`, `scrub`. Each leaves a line in the conversation and can
  be undone with one tap (`c4-show-canvas.md`).
- **camera**: the Map drawn on a screen (the Wall's wall half, or the app on `#/map`); the tour, a
  finger and show commands all move the same one (`c4-show-canvas.md` §1-§2).
- **show line**: the 56 px line a show command leaves in the conversation, with its `UNDO`
  (`c4-show-canvas.md` §4).
- **card**: anything the agent places on a screen: a pinned card next to a node (`pin`) or a card
  on the canvas. A card says who made it and when, and one tap removes it.
- **block** (kit block): a ready-made card type the agent places in seconds by naming the block and
  its data (timer, countdown, chart, …). A block bound to real data stays live.
- **card area**: the part of a canvas where cards sit, in a grid of 272 x 232 px cells; the
  conversation column sits beside or under it (`c4-show-canvas.md` §7.1).
- **shelf**: the cards a screen's grid has no room for, reached by `SHELF n` in the conversation
  column's header; each screen has its own, from the room's one list (`c4-show-canvas.md` §7.2).
- **custom card**: a card the agent writes as small HTML, shown in a sandboxed frame that can read
  board data and nothing else (no network, no credentials, no actions; `c4-show-canvas.md` §11).
  One that proves useful is **saved** and placed again in seconds (`c4-show-canvas.md` §13).
- **scheduled job**: anything the agent schedules to happen later ("shut this off in 3 hours");
  always visible on the Map and the canvas, cancellable, audited (`coworker.md` §6).
- **speak-up**: the cockpit raising something on its own: the room's **raised block** in the
  conversation (`RAISED · 07:14`), then the agent's sentences; loud by tier (`coworker.md` §2-§3).
- **quiet hours**: the window in which speak-ups other than `urgent` wait for one block at its end
  (`coworker.md` §4).
- **confirm card**: the modal card that asks the owner before anything changes (a job created or
  cancelled, later a C6 action): what, where, when written by the room, why in the agent's words,
  `NO` and a verb button; shown on one **asked screen**, answered only by a person (`c5-c6.md` §8).
- **spoken line**: the one sentence of a reply that C5 says aloud, on the screen that sent the
  prompt; the text is drawn either way (`c5-c6.md` §1).
- **audit line**: one entry the room appends to the board's hash-chained audit log for a pairing
  change, a button, a prompt, a stop, a new conversation, a job or a speak-up; it names who and what, never the words
  (`screens.md` §6.4, `docs/fleet/auth.md`).
- **device token**: the one revocable secret a screen holds, scoped to "view + cockpit"; it cannot
  start an act on its own (plan §4; what a copy of one can do, verb by verb, is `security.md` §2).
  New: today's auth (`docs/fleet/auth.md`) has the request kinds `local`, `direct` and `hub` and no
  device tokens; without pairing the room takes the board's `local`/`direct` (`security.md` §2.3).
  Under Q-O27 a) a fourth kind, `screen`, exists only on the screen listener (`screens.md` §6.5).
- **injection path**: a way text the owner did not write reaches the agent or a screen (a fleet
  field, a log, a file, spoken words, a reply); `security.md` §4 lists I1-I16 with their defences.
- **pairing**: how a screen gets its device token from the room (`screens.md`).
- **room link**: the one WebSocket a page keeps to the room, `/api/cockpit/ws` on the page's own
  origin, never through the hub; conversation, audio, show commands, cards and focus ride on it
  (`protocols.md` §2).
- **stand-in**: a fake for something the loop's VM does not have (speech service, agent, a real
  fleet) that replays recorded or scripted behaviour; tests run against stand-ins, and they double
  as the public demo (`stand-ins.md`). The three are the **room under test** (the real room behind
  a test wrapper with a control port), the **fake agent** and the **fake speech**; "stand-in room"
  in reviews and older notes means the room under test (`stand-ins.md`, the tables at its top).
- **shim**: a small WebSocket server in front of a speech service that does not speak
  WhisperLiveKit's protocol; it sends the room the four messages of `c2-voice.md` §9 (D183).
- **slice**: one build night's part of the cockpit, usable on its own the next morning
  (`slices.md`).
