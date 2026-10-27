# Cockpit spec: index and glossary

The spec the spec night writes from the plan (`../README.md`) and the owner's input
(`../spec-input.md`). Where this spec and `spec-input.md` disagree, `spec-input.md` wins. Sizes are
CSS px at 1368x912 (the owner's tablet, landscape, 2x); times are in s or ms. Scenario ids are
`S-<part>-<nn>`; decisions are `D<n>` in `DECISIONS.md`; questions for the owner are `Q-O<n>` in
`QUESTIONS.md`, and spec text that rests on an unanswered one is marked `(pending Q-O<n>)`. Speed
budgets are `B<n>` in §"Speed budget" below.

## Files

Status: `planned` (task open in `../PROGRESS.md`) or `written`.

| File | What it settles | Scenario ids | Task | Status |
| --- | --- | --- | --- | --- |
| `README.md` | this index, the room process and ports, the speed budget (B1-B8, B10, B11; B9 is T67's), the selectors tests use, and the glossary | none | T1, T24, T33 | written |
| `screens.md` | layouts (wall, canvas, split, switch), tour ⇄ explore idle rules, one screen vs. two, the cockpit button; pairing; unpaired, offline, room down | `S-SCR-` | T2, T3 | part 1 written (T2), part 2 written (T3; T52: room down is the pane's status line only, canvas half in `c4-show-canvas.md` §7.6, D120; T89: S-SCR-24 a refused room link; T44: §4.1 the corner cluster per state, the `SCREEN` sheet, S-SCR-25/26; T56: §6.1 who may pair (admin routes, peer uid, the agent refused), §6.2 cross-site checks and the `lb_cockpit` cookie, §6.3 the paired line, S-SCR-27..29; T60: §6.4 the room's audit lines, S-SCR-30/31; T64: the `off` talk button opens the pane, the away caption, S-SCR-32, D179; T102: its pressed state, D180; T58/T75: §6.2.1 a plain-HTTP page does not pair unless `cockpit.allowInsecure`, S-SCR-33, D182) |
| `c1-talk.md` | C1: the pane, the conversation, reply rendering, tool lines, typing, talk during an answer, errors, new conversation, several screens, raw view | `S-C1-` | T4, T5 | written: part 1 (T4: pane, rendering, tool lines, S-C1-01..12; T24: S-C1-13 hold to talk from the Wall), part 2 (T5: typing, talk during an answer, long replies, errors E1-E8, new conversation, several screens, raw view, S-C1-14..24; T50: header `READY`/`● WORKING`/`● STOPPING`, folds cut to code and `SHOW EARLIER`, E6 merged into E8, no raw view in C1, S-C1-24 retired; T29: §5.1 the room messages the pane draws from, fresh-screen states, S-C1-25/26; T85: §8 rewritten for steer, S-C1-16 rewritten, S-C1-27/28; T88: queued prompts as snapshot items, S-C1-29; T57: §5.2 the allowlist, refused calls, tools that change things, §5.3 redaction, S-C1-30/31; T40: §7.1 the on-screen keyboard, S-C1-32/33; T96: §1.1 the stack above the input row, S-C1-34; T34: §3 the renderer module and the numeric-cell rule, §5 targets from odd input, S-C1-35; T36/T76/T93: §15 the demo link for `?demo=1`, S-C1-36; T68: §10.1 the status line's order and the agent's login check, S-C1-37/38; T43: the type floor, line-slot messages 18 px in the label face, turn state 18 px `--text-2`, S-C1-40) |
| `c2-voice.md` | C2: the talk button (tap and hold), live words, fix, cancel, send, DE/EN, the talk key, speech-to-text down or failed; §14 the physical-button API as the later slice C2b | `S-C2-`, `S-C2B-` | T6, T7 | written: part 1 (T6: gestures, 400 ms threshold, `data-talk` states, live words, microphone, S-C2-01..10), part 2 (T7, slimmed by T49: tap the words to stop and fix, DE/EN, `cockpit.stt.*`, the service down or failed (`stt-down`, `stt-failed`), the talk key, the kiosk microphone note, S-C2-11..17, 20, 21; T94: S-C2-22 keyboard up; T69: S-C2-23 speech down in a hold; T78: `cockpit.stt.protocol` and the four messages a shim sends; C2b §14: the button API, S-C2B-01..02) |
| `c3-see.md` | C3: the MCP server (`laneboard`, loopback HTTP, D58), the seven read tools with params, results and sources, result rules (`asOf`, size caps), board gaps; `focus`, "Ask about this" | `S-C3-` | T8, T9 | written: part 1 (T8: §1-§7, S-C3-01..08), part 2 (T9: §8 `focus`, §9 the hold menu and context chip, S-C3-09..17, sketch `c3-ask.html`); S-C3-18 (T62: the night answered on the C1 night); S-C3-20 (T78: an empty board, `sources: []` and its `hint`) |
| `c4-show-canvas.md` | C4: show commands, one camera with the tour, undo; the canvas, kit blocks, custom cards, promotion, how cards leave | `S-C4-` | T10, T11, T12 | part 1 written (T10: §1-§6, show commands `fly_to`/`highlight`/`clear`/`pin`/`compare`/`scrub`, one camera with the tour, show lines, undo, S-C4-01..12, D67-D77); part 2 written (T11: §7-§10, the card area and grid, shelf, `place`, kit blocks `countdown`/`timer`/`status`/`log`/`chart`/`table`/`checklist`/`map`/`text`/`diff`, one-tap removal, S-C4-13..22, D78-D87, sketch `c4-canvas.html`; T52: §7.6 room down on the canvas, S-C4-23/24, D120); part 3 written (T12: §11-§14, custom cards in a sandboxed frame with the checklist SB1-SB12, time limits and turning a card off, how cards leave (ended, `expires`, `remove_card`), the `cards` tool, saving a custom card (`save_card`, `block: "saved"`), S-C4-25..33, D169-D177) |
| `coworker.md` | the watcher and speak-ups (tiers, raised block, cards, marker, chime), quiet hours, config; scheduled jobs (format, scripts, `jobs`/`schedule`/`cancel_job`, firing, Map badge, audit); the infra repo pull and `infra` tool; drift (Map, repo check); the agent's changes (Q-O33) | `S-CW-` | T13 | written (T13: §1-§11, S-CW-01..17, D185-D198, Q-O33; T127 folds its messages into `protocols.md` and its test verbs into `stand-ins.md`) |
| `c5-c6.md` | C5 voice out (the spoken line, `cockpit.tts.*`, playing, `STOP VOICE`, mute per screen, the night); C6 act, rules only (fenced, `cockpit.act.allow`), and the confirm card the Jobs slice builds (where, look, who may answer, how it ends, messages) | `S-C5-`, `S-C6-` | T14 | written (T14: §1-§10, S-C5-01..07, S-C6-01..07, D199-D208, Q-O34, Q-O35, sketch `c6-confirm.html`; T128 folds its messages and the fake voice service into `protocols.md` and `stand-ins.md`) |
| `protocols.md` | screen ⇄ room, room ⇄ agent bridge, room ⇄ speech-to-text, message by message | none (sequences) | T15, T16 | part 1 written (T15: same-origin transport, the room link, hello/resume/snapshot, conversation, show, cards, audio, button, limits, one spoken turn; D92-D99); part 2 written (T16: §11 the bridge, Claude Code's launch and event mapping, stop, sessions, the conversation on disk §11.7.1 (T91), standing instructions; §12 the speech service; §13 test classes; D100-D108); T89: refusals after the upgrade as close codes 4401/4402/4403/4503 and the `revoked` frame (D135); T90/T117: §2.4 every room-link message with `seq`, required and optional fields, §9 the fixture extraction rule and the copy to `docs/cockpit/protocol.md` (D136), pin messages (D137); T92: utterance lifetime and `stt.final.lang`, when the grace starts, snapshot parts, `history.turns` ordering, show to every link, held closes, skew mark (D138-D144) |
| `security.md` | tokens and what each can do, injection paths, audio and transcript handling, audit | `S-SEC-` | T17 | planned |
| `stand-ins.md` | the room under test and its control API, the fake agent (a fake `claude`, script format), the fake speech service (script format, faults), the demo fleet additions, one script per scenario family, the public demo | none (formats) | T18, T32, T87 | written (T18: §1-§7, D109-D112) |
| `single-machine.md` | everything on one box, no tailnet, no GPU, another agent | `S-ONE-` | T19 | planned |
| `slices.md` | the build nights in order (C1 with the fleet's night, C2, C3, Speak, Canvas, Show, Jobs, then the rest), each with its scenario ids, stand-ins and done-when; the acceptance harness (`e2e/cockpit/`, D88, D113); the board changes the slices make; every id once | none (lists every id once) | T20, T30, T37, T62, T80, T81 | written (T20) |
| `DECISIONS.md` | small reversible choices made during the night, each with how to overrule | none | all | written (running list) |
| `QUESTIONS.md` | what only the owner can decide: the eight for the morning first, then the rest, each with options and a recommendation | none | all | written (running list, reordered by T55) |
| `sketches/` | static HTML sketches at 1368x912, one per `[sketch]` task; written: `screens-split.html` (T2; redrawn to D78/D117 by T25/T47), `c1-pane.html` (T4; redrawn to §1/§8 at 28 px by T47), `c2-states.html` (T6), `screens-room-down.html` (T3/T22; redrawn to §4.1 D/F and D120 by T70), `c3-ask.html` (T9; redrawn to S-C3-09/10's rects by T101), `c4-canvas.html` (T11; tool line, microphone and 28 px type by T82/T101), `c6-confirm.html` (T14) | none | T2-T4, T6, T9, T11, T14 | written |

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
  | the MCP server (D58) | `cockpit.mcp.port` | `7790` | `127.0.0.1` only |

## Speed budget

`spec-input.md` §4-§5: the cockpit must keep the terminal's speed ("In the terminal it works really
well"; "a timer must not take 5 minutes"). These are the numbers every spec file cites as `B<n>`
instead of writing its own. A scenario with a timing asserts against its row. Times run from the
**start** event to the **end** event on the screen, at 1368x912, against the stand-ins
(`stand-ins.md`, T18).

| Id | Start | End (what the screen shows) | Budget, end to end | Stand-in setting in that budget | Screen and room's share (asserted) |
| --- | --- | --- | --- | --- | --- |
| B1 | `pointerdown` on the talk button | the button in its listening state (`data-talk="listening"`, T6) and audio frames leaving the screen | ≤ 0.2 s | none | ≤ 0.2 s |
| B2 | `pointerdown` on the talk button (the speaker starts at once) | the first partial word drawn in the input | ≤ 1.0 s | fake speech sends its first partial 0.6 s after the first audio frame | ≤ 0.4 s |
| B3 | `pointerup` (hold) or the second tap (tap-tap) | the prompt block drawn in the conversation (`YOU · SPOKEN · HH:MM`), the input empty | ≤ 0.3 s | fake speech sends its final 0.15 s after the stop | ≤ 0.15 s |
| B4 | the fake agent sends its first text delta | that text drawn in the conversation | ≤ 0.5 s | none | ≤ 0.5 s |
| B5 | the room receives a show command from the agent | the camera's first frame of movement on every screen it targets | ≤ 0.3 s | none | ≤ 0.3 s |
| B6 | the room receives a kit-block tool call from the agent | the block drawn on the canvas with its live data | ≤ 1.0 s | none | ≤ 1.0 s |
| B7 | a tap on the opener (or a press on the talk button) | the pane in place, its slide ended (`c1-talk.md` §2) | ≤ 0.2 s | none | ≤ 0.2 s |
| B8 | `SEND` tapped (typed prompt, T5) | the prompt block drawn in the conversation, `data-turn="thinking"` | ≤ 0.1 s | none | ≤ 0.1 s |
| B10 | the room receives a custom-card `place` (or `block: "saved"`) from the agent | the card's frame has sent `card:ready` and shows its first data (`c4-show-canvas.md` §11.4) | ≤ 2.0 s | none | ≤ 2.0 s |
| B11 | the room has the reply's spoken line (its sentence end in the deltas, `c5-c6.md` §1) | `cockpit:speak-start` on the screen that sent the prompt | ≤ 1.0 s | fake voice service answers 0.3 s after the request | ≤ 0.7 s |

- **The agent's own time is not in the budget.** B4 starts when the agent's first delta leaves
  the bridge; how long a real agent thinks before that is its own (with Claude Code, seconds).
  What the screen shows while it thinks is the turn state `● WORKING` (`c1-talk.md` §2), drawn
  within B8.
- **Real hardware is measured, not promised.** The real speech service's first-partial time is
  unknown (research Q4: no authoritative figure; measure with `wlk bench` on the real host). The
  stand-in settings are chosen so the screen and room's share is what a test can hold them to; the
  real end-to-end numbers are what the owner's setup should reach and are read from the marks
  below, on the real screen.
- **Marks** (D28). The screen sets `performance.mark('cockpit:B<n>:start')` and
  `performance.mark('cockpit:B<n>:end')` for every row, B5, B6 and B10 with the room's receive time
  carried in the message (`receivedAt`, `protocols.md` §4-§5). A test reads them with
  `performance.getEntriesByName`; on the real screen `?perf=1` logs each measure as one
  `console.info('cockpit:B<n>', ms)` line, read in the browser's remote devtools, and draws
  nothing (D28; T53 decides whether `?perf=1` stays). A measure over budget is not an error on the
  real screen, only a number to look at.
- **Tests allow no slack** beyond the table: a stand-in run that misses a budget fails. A build
  night that cannot meet a row on the VM's headless Chromium writes why in `PROGRESS.md` instead
  of widening the row; only the owner widens a budget.
- The hold-versus-tap threshold (T6) does not delay B1: listening starts on `pointerdown` in both
  gestures; the threshold only decides, at `pointerup`, whether that release sends (hold) or keeps
  listening (tap) (D29, T6 details the gesture).

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
| `data-wall-state` | `tour`, `explore` (Wall page, absent in `canvas`) | the Wall (T31's Wall contract) | `screens.md` §2 |
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
| `[data-cockpit-send]` with `data-send` | `send`, `stop`, `none` (blank and inert while the microphone is open) | the slot left of the talk button | `c1-talk.md` §8, `c2-voice.md` §3 |
| `[data-cockpit-newbar]`, its buttons `data-newbar` | `keep`, `start` | the `NEW` bar | `c1-talk.md` §11 |
| `[data-cockpit-chip]` with `data-node`, `[data-cockpit-chip-remove]` | a node id | the context chip and its `✕` | `c3-see.md` §9 |
| `[data-turn-id]` | a `turnId` (`t-0131`) | one turn: its prompt block and everything under it to the next turn (T91) | `c1-talk.md` §3 |
| `[data-tool-line]`, `data-denied` | `true` on a refused call | one tool line | `c1-talk.md` §5, §5.2 |
| `[data-mark]` | none | one coloured mark `■ ▲ ● ○` in a reply | `c1-talk.md` §3 |
| `[data-cockpit-status]` with `data-status` | `offline`, `room-down`, `agent-down`, `not-logged-in`, `tools-down`, `agent-back`, `back` | the pane's one 80 px status line | `c1-talk.md` §10.1 |
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
| `[data-show-line]` with `data-show-id`, `data-show-state`; `[data-show-undo]` | `shown`, `waiting`, `skipped`, `noCamera`, `undone`, `replaced` | `c4-show-canvas.md` §4 |
| `[data-show-mark]` with `data-node`, `[data-show-note]` | a node id | `c4-show-canvas.md` §3 |
| `[data-pin]` with `data-pin-id`, `data-node`; `[data-pin-remove]` | ids | `c4-show-canvas.md` §3 |
| `[data-compare]`, `[data-scrub]` | none | `c4-show-canvas.md` §3 |
| `[data-card]` with `data-card-id`, `data-block`, `data-size`; `[data-card-remove]`, `[data-card-cancel]`, `[data-card-removed]` | `data-block`: `countdown`, `timer`, `status`, `log`, `chart`, `table`, `checklist`, `map`, `text`, `diff`, `custom` (its frame `[data-card-frame]`, §11.4); `data-size`: `s`, `w`, `t`, `l` | `c4-show-canvas.md` §7.2-§7.3, §8, §9 |
| `[data-shelf]` | none (text `SHELF n`) | `c4-show-canvas.md` §7.2 |
| `[data-cockpit-down]` (the room-down strip on the canvas) | none | `c4-show-canvas.md` §7.6 |

Not attributes: the camera and the Map are read through page functions (`screenOf(id)`,
`emphasis(id)`, `nodeAt(x, y)`), listed with the Wall contract (T31, `c4-show-canvas.md` §2), and
the speed marks through `performance.getEntriesByName` (§"Speed budget").

## Glossary

Each word is defined here once; the other files link here instead of redefining it.

- **screen**: a browser showing the laneboard UI on a display (the owner's desk tablet, a wall
  screen, a laptop tab). A window only: it holds one device token and nothing else worth stealing.
  Each screen is in one mode at a time, or two modes side by side on one screen (`screens.md`).
- **mode**: what a screen shows: tour, explore or canvas.
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
- **room**: in this spec, the **cockpit room**: the always-on machine (VM or container) that runs
  the agent session, the bridge, the speech-to-text client, optional text-to-speech and the
  laneboard MCP server. Not a screen, not the laptop, not the hub. A Map node of `kind: room`
  (`docs/map.md`) is called a **room node** here (D1).
- **hub**: laneboard's existing aggregator that reads the builders' boards (`docs/fleet/hub.md`,
  `server/hub/`). Plan C4 has it relay show commands to screens; the spec sends them on the room link
  instead and the hub gains nothing for the cockpit (D92, `protocols.md` §1).
- **agent**: the one long-running agent session in the room. First-class: Claude Code in headless
  streaming mode; any agent that speaks the bridge protocol works (plan §5).
- **bridge**: the part of the room process between the room's services and the agent's child
  process: user text in, streamed reply and tool events out, interrupt, session start and resume
  (`protocols.md` §11, D100).
- **conversation**: the one cockpit conversation all screens show; made of turns. A "new
  conversation" starts another (`c1-talk.md`).
- **turn**: one prompt from the owner (typed or spoken) and the agent's whole reply to it,
  including its tool lines and show commands. A turn the agent starts itself (speaking up,
  `coworker.md`) has no prompt.
- **steer / queued prompt**: a prompt sent while a turn runs goes into that turn; it is **queued**
  (`· QUEUED`, grey) until the agent reads it at its next tool boundary, then **taken**
  (`c1-talk.md` §8, `protocols.md` §3.4, pending Q-O1).
- **demo link**: a client-side stand-in for the room link, used with `?demo=1` when there is no cockpit; canned turns, no network (`c1-talk.md` §15, D148).
- **pane**: the cockpit pane: the panel that slides over the current view and shows the
  conversation and the input. It never replaces the view (plan C1). Where the screen has a canvas
  (`split`, `canvas`, `switch`) the same parts are a fixed **column** of the canvas instead, always
  there (`c1-talk.md` §1, D117, pending Q-O12); both are `[data-cockpit-conversation]`.
- **raw view**: a read-only list of the agent's native events, never a terminal; not in C1
  (`c1-talk.md` §13, pending Q-O17).
- **tool line**: one collapsed line in the conversation for a piece of the agent's tool activity
  ("read 3 feeds", "looked at CI on main") (`c1-talk.md`).
- **talk button**: the button in the pane that starts and sends voice input, by tap-tap or
  hold-release; a physical button reaches it later through the room's API (C2b, `c2-voice.md` §14).
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
  act (plan §4). New: today's auth (`docs/fleet/auth.md`) has the request kinds `local`, `direct`
  and `hub` and no device tokens; `security.md` says how the two fit.
- **pairing**: how a screen gets its device token from the room (`screens.md`).
- **room link**: the one WebSocket a page keeps to the room, `/api/cockpit/ws` on the page's own
  origin, never through the hub; conversation, audio, show commands, cards and focus ride on it
  (`protocols.md` §2).
- **stand-in**: a fake for something the loop's VM does not have (speech service, agent, a real
  fleet) that replays recorded or scripted behaviour; tests run against stand-ins, and they double
  as the public demo (`stand-ins.md`). The three are the **room under test** (the real room behind
  a test wrapper with a control port), the **fake agent** and the **fake speech**; "stand-in room"
  in older text means the room under test (`stand-ins.md`, the tables at its top).
- **shim**: a small WebSocket server in front of a speech service that does not speak
  WhisperLiveKit's protocol; it sends the room the four messages of `c2-voice.md` §9 (D183).
- **slice**: one build night's part of the cockpit, usable on its own the next morning
  (`slices.md`).
