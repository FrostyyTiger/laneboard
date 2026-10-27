# Cockpit spec: index and glossary

The spec the spec night writes from the plan (`../README.md`) and the owner's input
(`../spec-input.md`). Where this spec and `spec-input.md` disagree, `spec-input.md` wins. Sizes are
CSS px at 1368x912 (the owner's tablet, landscape, 2x); times are in s or ms. Scenario ids are
`S-<part>-<nn>`; decisions are `D<n>` in `DECISIONS.md`; questions for the owner are `Q-O<n>` in
`QUESTIONS.md`, and spec text that rests on an unanswered one is marked `(pending Q-O<n>)`.

## Files

Status: `planned` (task open in `../PROGRESS.md`) or `written`.

| File | What it settles | Scenario ids | Task | Status |
| --- | --- | --- | --- | --- |
| `README.md` | this index and the glossary | none | T1 | written |
| `screens.md` | layouts (wall, canvas, split, switch), tour ⇄ explore idle rules, one screen vs. two, the cockpit button; pairing; unpaired, offline, room down | `S-SCR-` | T2, T3 | part 1 written (T2), part 2 planned (T3) |
| `c1-talk.md` | C1: the pane, the conversation, reply rendering, tool lines, typing, new conversation, several screens, raw terminal | `S-C1-` | T4, T5 | part 1 written (T4: pane, rendering, tool lines, S-C1-01..12), part 2 planned (T5) |
| `c2-voice.md` | C2: the talk button (tap and hold), live words, fix, cancel, send, DE/EN, the physical-button API, speech-to-text slow or down | `S-C2-` | T6, T7 | planned |
| `c3-see.md` | C3: the MCP read tools, `focus`, "Ask about this" | `S-C3-` | T8, T9 | planned |
| `c4-show-canvas.md` | C4: show commands, one camera with the tour, undo; the canvas, kit blocks, custom cards, promotion, how cards leave | `S-C4-` | T10, T11, T12 | planned |
| `coworker.md` | speaking up, quiet hours, scheduled jobs, the infra repo pull, drift, the agent's changes as PRs | `S-CW-` | T13 | planned |
| `c5-c6.md` | C5 voice out; C6 act, rules and the confirm card only | `S-C5-`, `S-C6-` | T14 | planned |
| `protocols.md` | screen ⇄ room, room ⇄ agent bridge, room ⇄ speech-to-text, message by message | none (sequences) | T15, T16 | planned |
| `security.md` | tokens and what each can do, injection paths, audio and transcript handling, audit | `S-SEC-` | T17 | planned |
| `stand-ins.md` | the fake speech service, the fake agent, the demo fleet additions | none (formats) | T18 | planned |
| `single-machine.md` | everything on one box, no tailnet, no GPU, another agent | `S-ONE-` | T19 | planned |
| `slices.md` | the build nights in order, each with its scenario ids, stand-ins and done-when | none (lists every id once) | T20 | planned |
| `DECISIONS.md` | small reversible choices made during the night, each with how to overrule | none | all | written (running list) |
| `QUESTIONS.md` | what only the owner can decide, with options and a recommendation | none | all | written (running list) |
| `sketches/` | static HTML sketches at 1368x912, one per `[sketch]` task; written: `screens-split.html` (T2), `c1-pane.html` (T4) | none | T2-T4, T6, T9, T11, T14 | in progress |

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
- **tool line**: one collapsed line in the conversation for a piece of the agent's tool activity
  ("read 3 feeds", "looked at CI on main") (`c1-talk.md`).
- **talk button**: the button in the pane that starts and sends voice input, by tap-tap or
  hold-release; also reachable as an API for a physical button (`c2-voice.md`).
- **partial / final**: speech-to-text results: a partial is a guess that may still change, a final
  is fixed. The input shows partials and replaces them as they firm up.
- **MCP server**: the laneboard MCP server in the room: the read tools (C3) and the show
  commands (C4) the agent calls.
- **focus**: what the owner is looking at or touching on a screen right now: the view, the
  selected node, the open run. Readable by the agent through the MCP tool of the same name
  (`c3-see.md`).
- **show command**: an MCP tool that changes what a screen shows, never the fleet: `fly_to`,
  `highlight`, `clear`, `pin`, `compare`, `scrub`. Each leaves a line in the conversation and can
  be undone with one tap (`c4-show-canvas.md`).
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
