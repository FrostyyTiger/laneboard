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
| `README.md` | this index, the room process and ports, the speed budget (B1-B8), the selectors tests use, and the glossary | none | T1, T24, T33 | written |
| `screens.md` | layouts (wall, canvas, split, switch), tour ⇄ explore idle rules, one screen vs. two, the cockpit button; pairing; unpaired, offline, room down | `S-SCR-` | T2, T3 | part 1 written (T2), part 2 written (T3; T52: room down is the pane's status line only, canvas half in `c4-show-canvas.md` §7.6, D120; T89: S-SCR-24 a refused room link) |
| `c1-talk.md` | C1: the pane, the conversation, reply rendering, tool lines, typing, talk during an answer, errors, new conversation, several screens, raw view | `S-C1-` | T4, T5 | written: part 1 (T4: pane, rendering, tool lines, S-C1-01..12; T24: S-C1-13 hold to talk from the Wall), part 2 (T5: typing, talk during an answer, long replies, errors E1-E8, new conversation, several screens, raw view, S-C1-14..24; T50: header `READY`/`● WORKING`/`● STOPPING`, folds cut to code and `SHOW EARLIER`, E6 merged into E8, no raw view in C1, S-C1-24 retired; T29: §5.1 the room messages the pane draws from, fresh-screen states, S-C1-25/26; T85: §8 rewritten for steer, S-C1-16 rewritten, S-C1-27/28; T88: queued prompts as snapshot items, S-C1-29; T57: §5.2 the allowlist, refused calls, tools that change things, §5.3 redaction, S-C1-30/31; T40: §7.1 the on-screen keyboard, S-C1-32/33; T96: §1.1 the stack above the input row, S-C1-34; T34: §3 the renderer module and the numeric-cell rule, §5 targets from odd input, S-C1-35; T36/T76/T93: §15 the demo link for `?demo=1`, S-C1-36; T68: §10.1 the status line's order and the agent's login check, S-C1-37/38) |
| `c2-voice.md` | C2: the talk button (tap and hold), live words, fix, cancel, send, DE/EN, the talk key, speech-to-text down or failed; §14 the physical-button API as the later slice C2b | `S-C2-`, `S-C2B-` | T6, T7 | written: part 1 (T6: gestures, 400 ms threshold, `data-talk` states, live words, microphone, S-C2-01..10), part 2 (T7, slimmed by T49: tap the words to stop and fix, DE/EN, `cockpit.stt.*`, the service down or failed (`stt-down`, `stt-failed`), the talk key, the kiosk microphone note, S-C2-11..17, 20, 21; T94: S-C2-22 keyboard up; C2b §14: the button API, S-C2B-01..02) |
| `c3-see.md` | C3: the MCP server (`laneboard`, loopback HTTP, D58), the seven read tools with params, results and sources, result rules (`asOf`, size caps), board gaps; `focus`, "Ask about this" | `S-C3-` | T8, T9 | written: part 1 (T8: §1-§7, S-C3-01..08), part 2 (T9: §8 `focus`, §9 the hold menu and context chip, S-C3-09..17, sketch `c3-ask.html`); S-C3-18 (T62: the night answered on the C1 night) |
| `c4-show-canvas.md` | C4: show commands, one camera with the tour, undo; the canvas, kit blocks, custom cards, promotion, how cards leave | `S-C4-` | T10, T11, T12 | part 1 written (T10: §1-§6, show commands `fly_to`/`highlight`/`clear`/`pin`/`compare`/`scrub`, one camera with the tour, show lines, undo, S-C4-01..12, D67-D77); part 2 written (T11: §7-§10, the card area and grid, shelf, `place`, kit blocks `countdown`/`timer`/`status`/`log`/`chart`/`table`/`checklist`/`map`/`text`/`diff`, one-tap removal, S-C4-13..22, D78-D87, sketch `c4-canvas.html`; T52: §7.6 room down on the canvas, S-C4-23/24, D120); part 3 planned (T12) |
| `coworker.md` | speaking up, quiet hours, scheduled jobs, the infra repo pull, drift, the agent's changes as PRs | `S-CW-` | T13 | planned |
| `c5-c6.md` | C5 voice out; C6 act, rules and the confirm card only | `S-C5-`, `S-C6-` | T14 | planned |
| `protocols.md` | screen ⇄ room, room ⇄ agent bridge, room ⇄ speech-to-text, message by message | none (sequences) | T15, T16 | part 1 written (T15: same-origin transport, the room link, hello/resume/snapshot, conversation, show, cards, audio, button, limits, one spoken turn; D92-D99); part 2 written (T16: §11 the bridge, Claude Code's launch and event mapping, stop, sessions, standing instructions; §12 the speech service; §13 test classes; D100-D108); T89: refusals after the upgrade as close codes 4401/4402/4403/4503 and the `revoked` frame (D135); T90/T117: §2.4 every room-link message with `seq`, required and optional fields, §9 the fixture extraction rule and the copy to `docs/cockpit/protocol.md` (D136), pin messages (D137); T92: utterance lifetime and `stt.final.lang`, when the grace starts, snapshot parts, `history.turns` ordering, show to every link, held closes, skew mark (D138-D144) |
| `security.md` | tokens and what each can do, injection paths, audio and transcript handling, audit | `S-SEC-` | T17 | planned |
| `stand-ins.md` | the room under test and its control API, the fake agent (a fake `claude`, script format), the fake speech service (script format, faults), the demo fleet additions, one script per scenario family, the public demo | none (formats) | T18, T32, T87 | written (T18: §1-§7, D109-D112) |
| `single-machine.md` | everything on one box, no tailnet, no GPU, another agent | `S-ONE-` | T19 | planned |
| `slices.md` | the build nights in order (C1 with the fleet's night, C2, C3, Speak, Canvas, Show, Jobs, then the rest), each with its scenario ids, stand-ins and done-when; the acceptance harness (`e2e/cockpit/`, D88, D113); the board changes the slices make; every id once | none (lists every id once) | T20, T30, T37, T62, T80, T81 | written (T20) |
| `DECISIONS.md` | small reversible choices made during the night, each with how to overrule | none | all | written (running list) |
| `QUESTIONS.md` | what only the owner can decide: the eight for the morning first, then the rest, each with options and a recommendation | none | all | written (running list, reordered by T55) |
| `sketches/` | static HTML sketches at 1368x912, one per `[sketch]` task; written: `screens-split.html` (T2), `c1-pane.html` (T4), `c2-states.html` (T6), `screens-room-down.html` (T3/T22), `c3-ask.html` (T9), `c4-canvas.html` (T11) | none | T2-T4, T6, T9, T11, T14 | in progress |

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
  `performance.mark('cockpit:B<n>:end')` for every row, B5 and B6 with the room's receive time
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
| `[data-cockpit-line]` with `data-line` | `room-down`, `error`, `hint`, `length` | the one line slot above the input row | `c1-talk.md` §1.1 |
| `[data-cockpit-input]` | none | the `<textarea>` | `c1-talk.md` §7 |
| `[data-cockpit-demo-label]` | none (text `DEMO`) | the header's demo label | `c1-talk.md` §15 |
| `[data-cockpit-send]` with `data-send` | `send`, `stop`, `cancel` | the slot left of the talk button | `c1-talk.md` §8, `c2-voice.md` §3 |
| `[data-cockpit-newbar]`, its buttons `data-newbar` | `keep`, `start` | the `NEW` bar | `c1-talk.md` §11 |
| `[data-cockpit-chip]` with `data-node`, `[data-cockpit-chip-remove]` | a node id | the context chip and its `✕` | `c3-see.md` §9 |
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

**See and show** (C3, C4)

| Selector | Values | Defined in |
| --- | --- | --- |
| `[data-ask-menu]` with `data-node`; rows `[data-ask]`, `[data-ask-cancel]` | a node id | `c3-see.md` §9 |
| `[data-show-line]` with `data-show-id`, `data-show-state`; `[data-show-undo]` | `shown`, `waiting`, `skipped`, `noCamera`, `undone`, `replaced` | `c4-show-canvas.md` §4 |
| `[data-show-mark]` with `data-node`, `[data-show-note]` | a node id | `c4-show-canvas.md` §3 |
| `[data-pin]` with `data-pin-id`, `data-node`; `[data-pin-remove]` | ids | `c4-show-canvas.md` §3 |
| `[data-compare]`, `[data-scrub]` | none | `c4-show-canvas.md` §3 |
| `[data-card]` with `data-card-id`, `data-block`, `data-size`; `[data-card-remove]`, `[data-card-cancel]`, `[data-card-removed]` | `data-block`: `countdown`, `timer`, `status`, `log`, `chart`, `table`, `checklist`, `map`, `text`, `diff`; `data-size`: `s`, `w`, `t`, `l` | `c4-show-canvas.md` §7.2-§7.3, §8, §9 |
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
  board data and nothing else (no network, no credentials, no actions). One that proves useful is
  **promoted** to a block.
- **scheduled job**: anything the agent schedules to happen later ("shut this off in 3 hours");
  always visible on the Map and the canvas, cancellable, audited (`coworker.md`).
- **confirm card**: the card a C6 action shows before anything changes: what, where, why, yes/no
  (`c5-c6.md`).
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
- **slice**: one build night's part of the cockpit, usable on its own the next morning
  (`slices.md`).
