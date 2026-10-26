# Cockpit plan: a screen you can talk to, that answers by showing you things

**Status: DRAFT, written in conversation with the owner.** Read `docs/plans/product.md` first; this
plan follows its working rule (built for one, never tied to one).

## 1. Goal

The owner has a touch screen on the desk, below the main monitor. It is **the one place to see**
how the infrastructure, the projects and the agent loops are doing. Today it can only be looked
at. When something is wrong, the owner opens a terminal and asks an agent, which cannot see what
the screen shows and cannot show anything back.

The cockpit joins the two: **tap the screen, talk, and the agent answers in text, and, where it
helps, by moving the screen**: flying to the node, highlighting what matters, pinning a chart or
a log next to it.

The pitch for everyone else: *a desk screen for your fleet that you can talk to, and that talks
back by showing you things.*

## 2. Shape

```
  screens (any number)          cockpit room                     the fleet
  ───────────────────           ────────────                     ─────────
  browser, laneboard UI   ⇄     agent session (one, always on)   builders, hub, feeds,
  cockpit pane, mic,            speech-to-text client            hosts, CI, runs
  speaker, device token         text-to-speech (optional)
                                laneboard MCP: see + show  ──→   read: broad
                                                           ──→   act: only via the
                                                                 audited control plane
```

- **Screens are windows, nothing more.** A screen runs the laneboard UI in a browser and holds one
  revocable device token. No agent, no credentials, no state worth stealing. A second screen is a
  second token. Losing a screen loses a screen.
- **The agent lives in its own room**, an always-on machine (VM or container) next to the hub,
  not on a screen and not on a laptop that might be off. It does not live inside the hub either:
  the hub stays narrow (read-only, reaches only the builders' boards) and keeps its security
  review valid.
- **One conversation, every screen.** All screens show the same cockpit conversation; speaking
  at one shows up on all.
- **The laptop stays independent.** A terminal on a laptop keeps its own full access and its own
  agent sessions. The two agents share knowledge through what is written down (repos, plans,
  notes), not a shared conversation.

## 3. Parts

| Part | Answers | Depends on |
| --- | --- | --- |
| **C1. Talk** | Can I chat with the agent from the screen? | nothing |
| **C2. Voice in** | Can I speak instead of type, and watch my words appear live? | C1 |
| **C3. See** | Does the agent know what the board knows, and what I am pointing at? | C1 |
| **C4. Show** | Can the agent move and annotate the screen to answer me? | C3 |
| **C5. Voice out** | Can the agent also say its answer? | C1 |
| **C6. Act** | Can the agent change things, with my yes on the screen? | C3, control review |

Order of value for the owner: C1 → C2 → C3 → C4 → C5 → C6. C1 and C2 together are the experience
the owner already has in a terminal, moved to the desk.

### C1. Talk

- A **cockpit pane**: a button on every view (and on the Wall) opens a pane with the conversation.
  It slides over the view, never replaces it, so the agent can point at the view behind it.
- **The session**: the room runs one agent session through a small bridge. First-class: Claude Code
  in headless streaming mode on a subscription (no API key needed); the bridge speaks a tiny
  protocol (user text in, streamed reply out, tool activity as events), so another agent can sit
  behind it.
- **Replies are always text**, rendered for reading at arm's length: large type, short blocks,
  code and tables readable, tool activity collapsed to one line each ("read 3 feeds", "looked at
  CI on main").
- A raw terminal view of the same session as a toggle, for when the rendered view hides something.
- Typing works everywhere (on-screen keyboard, a paired keyboard). Voice (C2) is the main path.
- Session lifecycle: one long-running conversation; a "new conversation" button; on a fresh start
  the agent reads the same written context a laptop session would.

### C2. Voice in

The owner's terminal experience, made for a touch screen:

1. **Press the talk button** (tap to start and tap to send, or hold and release; both work).
2. **Words appear live** in the input as they are spoken, partial results replaced as they firm up.
3. **On release (or the second tap) the text is sent** as the prompt. Before that, a tap on the text
   lets the owner fix a word or cancel.

- **Speech-to-text must stream.** A batch transcriber (whole file in, text out) cannot show words
  live. The room runs a streaming client against a configurable speech-to-text endpoint (a local
  GPU model is the owner's case; any service that streams partial results works). Config:
  `cockpit.stt.url`, `cockpit.stt.language` (with `auto`).
- Audio goes browser → room over the screen's authenticated connection, never to a third party
  unless the configured endpoint is one.
- **A physical button later**: anything that can send a key or an HTTP call (a USB macro key, a
  home automation button) maps to "talk" on a chosen screen. The talk button is an API, not just
  a widget.
- Kiosk note: the browser must be allowed to use the microphone without a prompt (a kiosk flag or
  a managed policy, in `docs/cockpit.md`).

### C3. See

A **laneboard MCP server** in the room gives the agent read access to what the board knows:

- `fleet` (sites, rooms, hosts, services, health), `runs` (state, rounds, scores, needs), `lanes`,
  `ci`, `alerts`, `morning` (what happened in a window), `history` (events over time).
- **`focus`**: what the owner is looking at or touching right now, per screen: the view, the
  selected node, the run open. "What's wrong here?" needs no description.
- A tap-and-hold on any node offers **Ask about this**, which opens the pane with the node attached
  as context.
- Beyond the board, the room may have its own read access (logs, metrics, shells with read-only
  users), declared in config and in the room's own docs, never assumed by laneboard.

### C4. Show

The agent answers on the screen, not just in text. MCP tools that drive the view:

- `fly_to(node)`, `highlight(nodes, note)`, `clear()`
- `pin(card)`: a card next to a node with text, a small chart, a log excerpt or a diff
- `compare(a, b)`: two runs, hosts or time ranges side by side
- `scrub(time)`: move the view to a moment in the past (needs history; ties in with replay)

Rules: **display only**. These change what a screen shows, never the fleet. Every show action
appears as a line in the conversation, and the owner can undo it with one tap. Show commands go
room → hub → screens; the hub relays view state and gains no new authority over builders.

### C4b. Canvas: a screen the agent draws on

A screen (or half of one) can be a **canvas** instead of the tour: an open surface where the agent
puts things for the owner. Any screen can be tour, explore or canvas; with one screen they split
or switch.

- **Kit blocks, in seconds.** A small set of ready-made blocks the agent places by naming the block
  and its data: timer, countdown, chart, table, live log, checklist, status tile, "zoom the map
  here". A block bound to real data stays live: a countdown for a scheduled job shows the job and
  cancels it.
- **Custom cards, in about a minute.** Anything the kit lacks, the agent writes as a small HTML card
  rendered in a sandboxed frame that can read board data and nothing else (no network, no
  credentials, no actions).
- **Promotion.** A custom card that proves useful becomes a kit block, so the canvas gets faster
  with use.
- Cards persist until dismissed; every card says who made it and when; one tap removes it.

### Proactive: the agent speaks up

The agent does not only answer. It watches the same alerts, Morning and Stuck data the board shows
and raises what needs a human ("a runner's disk is at 90 %, clean it?", "last night's run has been
stuck for an hour"), as a line in the conversation and, if it matters, a card on the canvas.
Quiet hours and a per-kind mute in config.

### Scheduled jobs are visible

Anything the agent schedules ("shut this off in 3 hours") is a job the board knows about: shown on
the Map at its target and as a countdown on the canvas, cancellable with one tap, listed in the
audit log. No hidden timers.

### Knowing what should be there

- The agent's room keeps a read-only clone of the owner's infrastructure repo (whatever declares
  the fleet), pulled on a timer, so it always knows the intended state.
- Comparing intended with running (drift) is one of its standing jobs, raised proactively.
- **Whoever changes something writes it down in the same place.** The agent's own changes go to
  the repo as a branch or a small PR for the owner to merge, never straight to the main branch.

### C5. Voice out

- Optional text-to-speech of the agent's reply, from a configurable endpoint (local by default).
- Speaks a short version (the first sentence, or a summary the agent marks), not tables or code.
- Per-screen mute; a "stop talking" tap; muted by default at night.
- The text is always shown, whether or not it is spoken.

### C6. Act

- The agent changes things **only through the existing audited control plane** (`docs/fleet/control.md`),
  never through credentials of its own that bypass it.
- Anything that changes state shows a **confirm card on the screen**: what, where, why, yes/no.
  Touch is good at yes/no.
- Read broad, act narrow: the room's write access is a short list in config, each entry an action
  of the control plane.
- **Waits for the control-plane security review.** Nothing in C6 is built before it, and C6 is
  fenced for unattended work (`docs/plans/runs/README.md` §2.5).

## 4. Security

- Screens: one device token each, revocable, scoped to "view + cockpit". A token cannot act.
- The room: reachable only from the screens' network path and the hub; its agent's read access
  is declared; its act access is C6 only.
- Anything reachable beyond `127.0.0.1` has authentication in front of it. A tailnet is one way;
  a reverse proxy with auth, or a LAN-only setup with device tokens, are others. Nothing depends
  on one VPN.
- Audio and transcripts stay in the room unless the configured endpoints send them elsewhere; the
  docs say so plainly.
- A spoken prompt is a prompt: the same rules apply as typing, including the confirm card in C6.

## 5. Making it general

- **Bring your own agent**: the bridge protocol and the MCP server are the product; Claude Code is
  the first-class agent behind them, not a requirement.
- **Bring your own speech**: STT and TTS are endpoints in config, each with `none` as a default
  (then the pane is text only, and still useful).
- **Demo**: the demo shows the cockpit with a recorded conversation that flies the demo fleet.
  This doubles as the video's second half.

## 6. How the loop builds this

Loops get details right because they take many short rounds and get reviewed; they lose details
in two ways: choices a builder makes silently, and intent that was never written down. The method
below closes both. `spec-input.md` holds the owner's intent from the planning conversation.

1. **Spec night (no code).** The loop turns this plan and `spec-input.md` into
   `docs/plans/cockpit/spec/`: concrete scenarios ("07:00, the owner taps Talk and says 'how did the
   night go?' → words appear live → release → text reply within N s, the map flies to the stuck run,
   a card appears"), edge cases, and rough screen sketches at the owner's screen size. It ends with
   a short **question list for the owner** (`spec/QUESTIONS.md`), seeded from `spec-input.md` §7.
2. **Owner Q&A (morning, ~15 min).** The owner answers; answers go into the spec.
3. **Decision rule for build nights.** Small, reversible choices: make them and log them in
   `spec/DECISIONS.md` (the owner may overrule). Taste or one-way choices: stop, add to
   `QUESTIONS.md`, move on to another task.
4. **Scenarios become tests.** Each scenario is an acceptance test (Playwright against the demo
   setup). A build night continues until its scenarios pass; a detail in a test cannot get lost.
5. **An owner reviewer.** Besides the stranger, designer and operator reviewers
   (`docs/plans/runs/README.md` §7): one that uses the cockpit as the owner would, touch only, at
   the owner's screen size, in the owner's words, judged by "does this help me see my fleet?".
6. **One slice per night, each usable.** C1, then C2, then C3, and so on. Every morning there is
   something to try on the real screen.
7. **Stand-ins for real hardware.** The loop's VM has no LAN: no screen, no microphone, no GPU, no
   fleet. It builds against stand-ins: a fake speech service that replays recorded speech with
   timed partials, a fake agent that replays scripted turns and tool calls, and the demo fleet.
   A normal session then wires the real services. The stand-ins stay: they are the demo.
8. **Use, then the next spec.** After each slice the owner uses it for a few days; what bothers
   them feeds the next spec night.

## 7. Open questions

1. Streaming speech-to-text engine for the owner's GPU: which model and server give live partials
   with good German and English? (Research before C2.)
2. The room: VM or container, and on which node. (The owner's homelab docs, not this repo.)
3. Does every screen share one conversation, or can a screen opt into its own?
4. How long does one conversation live before it starts fresh with written context?
5. Can the Wall's tour mode and C4 share one camera controller? (Likely yes; check with the Wall
   work once it merges.)

## 8. Nights

### Spec night

Loop: `docs/plans/cockpit/loop/` (forked from the Wall loop; writes only `docs/plans/cockpit/spec/`,
`PROGRESS.md`, `reviews/`, `research/`; everything else is reverted). Output goes to
`docs/plans/cockpit/spec/`:

1. **Index and glossary** (`spec/README.md`): every spec file in one line; the words (screen, room,
   canvas, card, block, show command, focus, stand-in) defined once.
2. **Screens and modes** (`spec/screens.md`): tour, explore and canvas; one screen vs. two; how a
   screen pairs with the room (device token) and what it shows while unpaired, offline or when the
   room is down. Sketches.
3. **C1 Talk** (`spec/c1-talk.md`): the pane, the conversation, rendering of replies and tool
   activity, typing, new conversation, several screens on one conversation, the raw terminal toggle.
   Scenarios, edge cases (talk while it answers, long replies, errors). Sketches.
4. **C2 Voice in** (`spec/c2-voice.md`): tap and hold, live words, fixing a word, cancel, send; the
   DE/EN choice; the physical-button API; what happens when speech-to-text is slow or down. Scenarios
   with timings. Sketches of every state of the talk button and input.
5. **C3 See** (`spec/c3-see.md`): the MCP tools, each with parameters, result shape and an example;
   `focus`; "Ask about this".
6. **C4 Show and canvas** (`spec/c4-show-canvas.md`): show commands with parameters; one camera with
   the Wall's tour; undo; the canvas, the first kit blocks (each: data, look, live behaviour), custom
   cards and their sandbox, promotion, how cards leave. Sketches.
7. **Proactive, jobs, drift** (`spec/coworker.md`): when the agent speaks up and how loud, quiet
   hours; scheduled jobs on the Map and the canvas; the repo pull and the drift check; the agent's
   changes as PRs.
8. **C5 Voice out and C6 Act** (`spec/c5-c6.md`): lighter: enough to not paint the earlier parts into
   a corner. C6 waits for the control review; spec the confirm card and the rules only.
9. **Protocols** (`spec/protocols.md`): screen ⇄ room (conversation, audio, show commands, focus),
   room ⇄ agent bridge (text in, streamed reply and tool events out), room ⇄ speech-to-text; message
   by message, with errors and timeouts.
10. **Security** (`spec/security.md`): tokens and what each can do, injection paths (logs, cards, web
    pages, spoken text), audio and transcript handling, audit; against the plan's §4.
11. **Stand-ins** (`spec/stand-ins.md`): the fake speech service (replays recorded utterances with timed
    partials), the fake agent (replays scripted turns, tool calls and show commands), the demo fleet
    additions; enough to write them in one round each. They double as the public demo.
12. **One machine** (`spec/single-machine.md`): everything on one box, no tailnet, no GPU (typing
    only), another agent than Claude Code: what changes, what config.
13. **Slices** (`spec/slices.md`): the build nights in order, each with its scenarios, its stand-ins
    and its done-when; C1 and C2 first.
14. **Decisions and questions** (`spec/DECISIONS.md`, `spec/QUESTIONS.md`): kept throughout; seeded from
    `spec-input.md` §7.
