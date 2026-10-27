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
| `README.md` | this index, the speed budget (B1-B8) and the glossary | none | T1, T24 | written |
| `screens.md` | layouts (wall, canvas, split, switch), tour ⇄ explore idle rules, one screen vs. two, the cockpit button; pairing; unpaired, offline, room down | `S-SCR-` | T2, T3 | part 1 written (T2), part 2 planned (T3) |
| `c1-talk.md` | C1: the pane, the conversation, reply rendering, tool lines, typing, talk during an answer, errors, new conversation, several screens, raw view | `S-C1-` | T4, T5 | written: part 1 (T4: pane, rendering, tool lines, S-C1-01..12; T24: S-C1-13 hold to talk from the Wall), part 2 (T5: typing, talk during an answer, long replies, errors E1-E8, new conversation, several screens, raw view, S-C1-14..24; T50: header `READY`/`● WORKING`/`● STOPPING`, folds cut to code and `SHOW EARLIER`, E6 merged into E8, no raw view in C1, S-C1-24 retired) |
| `c2-voice.md` | C2: the talk button (tap and hold), live words, fix, cancel, send, DE/EN, the talk key, speech-to-text down or failed; §14 the physical-button API as the later slice C2b | `S-C2-`, `S-C2B-` | T6, T7 | written: part 1 (T6: gestures, 400 ms threshold, `data-talk` states, live words, microphone, S-C2-01..10), part 2 (T7, slimmed by T49: tap the words to stop and fix, DE/EN, `cockpit.stt.*`, the service down or failed (`stt-down`, `stt-failed`), the talk key, the kiosk microphone note, S-C2-11..17, 20, 21; C2b §14: the button API, S-C2B-01..02) |
| `c3-see.md` | C3: the MCP server (`laneboard`, loopback HTTP, D58), the seven read tools with params, results and sources, result rules (`asOf`, size caps), board gaps; `focus`, "Ask about this" | `S-C3-` | T8, T9 | written: part 1 (T8: §1-§7, S-C3-01..08), part 2 (T9: §8 `focus`, §9 the hold menu and context chip, S-C3-09..17, sketch `c3-ask.html`) |
| `c4-show-canvas.md` | C4: show commands, one camera with the tour, undo; the canvas, kit blocks, custom cards, promotion, how cards leave | `S-C4-` | T10, T11, T12 | part 1 written (T10: §1-§6, show commands `fly_to`/`highlight`/`clear`/`pin`/`compare`/`scrub`, one camera with the tour, show lines, undo, S-C4-01..12, D67-D77); parts 2-3 planned (T11, T12) |
| `coworker.md` | speaking up, quiet hours, scheduled jobs, the infra repo pull, drift, the agent's changes as PRs | `S-CW-` | T13 | planned |
| `c5-c6.md` | C5 voice out; C6 act, rules and the confirm card only | `S-C5-`, `S-C6-` | T14 | planned |
| `protocols.md` | screen ⇄ room, room ⇄ agent bridge, room ⇄ speech-to-text, message by message | none (sequences) | T15, T16 | planned |
| `security.md` | tokens and what each can do, injection paths, audio and transcript handling, audit | `S-SEC-` | T17 | planned |
| `stand-ins.md` | the fake speech service, the fake agent, the demo fleet additions | none (formats) | T18 | planned |
| `single-machine.md` | everything on one box, no tailnet, no GPU, another agent | `S-ONE-` | T19 | planned |
| `slices.md` | the build nights in order, each with its scenario ids, stand-ins and done-when | none (lists every id once) | T20 | planned |
| `DECISIONS.md` | small reversible choices made during the night, each with how to overrule | none | all | written (running list) |
| `QUESTIONS.md` | what only the owner can decide, with options and a recommendation | none | all | written (running list) |
| `sketches/` | static HTML sketches at 1368x912, one per `[sketch]` task; written: `screens-split.html` (T2), `c1-pane.html` (T4), `c2-states.html` (T6), `screens-room-down.html` (T3/T22) | none | T2-T4, T6, T9, T11, T14 | in progress |

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
  carried in the message (`protocols.md`, T15). A test reads them with
  `performance.getEntriesByName`; on the real screen `?perf=1` lists the last 20 measures in the
  pane's header menu (T5 places it). A measure over budget is not an error on the real screen,
  only a number to look at.
- **Tests allow no slack** beyond the table: a stand-in run that misses a budget fails. A build
  night that cannot meet a row on the VM's headless Chromium writes why in `PROGRESS.md` instead
  of widening the row; only the owner widens a budget.
- The hold-versus-tap threshold (T6) does not delay B1: listening starts on `pointerdown` in both
  gestures; the threshold only decides, at `pointerup`, whether that release sends (hold) or keeps
  listening (tap) (D29, T6 details the gesture).

## Glossary

Each word is defined here once; the other files link here instead of redefining it.

- **screen**: a browser showing the laneboard UI on a display (the owner's desk tablet, a wall
  screen, a laptop tab). A window only: it holds one device token and nothing else worth stealing.
  Each screen is in one mode at a time, or two modes side by side on one screen (`screens.md`).
- **mode**: what a screen shows: tour, explore or canvas.
- **layout**: how the Wall page arranges modes on one screen: `wall`, `canvas`, `split` or `switch` (`screens.md` §1).
- **cockpit button**: the `AGENT` button that opens the pane, on every view and on the Wall (`screens.md` §4).
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
  `server/hub/`). For the cockpit it relays view state and show commands to screens and gains no
  authority over builders (plan C4).
- **agent**: the one long-running agent session in the room. First-class: Claude Code in headless
  streaming mode; any agent that speaks the bridge protocol works (plan §5).
- **bridge**: the small process in the room between the room's services and the agent: user text
  in, streamed reply and tool events out, interrupt, session start and resume (`protocols.md`).
- **conversation**: the one cockpit conversation all screens show; made of turns. A "new
  conversation" starts another (`c1-talk.md`).
- **turn**: one prompt from the owner (typed or spoken) and the agent's whole reply to it,
  including its tool lines and show commands. A turn the agent starts itself (speaking up,
  `coworker.md`) has no prompt.
- **pane**: the cockpit pane: the panel that slides over the current view and shows the
  conversation and the input. It never replaces the view (plan C1).
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
- **stand-in**: a fake for something the loop's VM does not have (speech service, agent, a real
  fleet) that replays recorded or scripted behaviour; tests run against stand-ins, and they double
  as the public demo (`stand-ins.md`).
- **slice**: one build night's part of the cockpit, usable on its own the next morning
  (`slices.md`).
