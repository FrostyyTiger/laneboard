# Review, round 48: the stranger

Persona: found laneboard on a forum. One machine (board, agent loops and, if I set it up, the room
all on it), no tailnet, no GPU (typing only), an old 10" tablet, and an agent that is not Claude
Code. Read: `spec/README.md`, `screens.md`, `c1-talk.md`, `c2-voice.md`, `c3-see.md`,
`DECISIONS.md`, `QUESTIONS.md`, against `../README.md`, `../spec-input.md`, `docs/plans/product.md`,
`README.md`, `docs/fleet/auth.md`, `server/config.mjs`. Sketches `c1-pane.html` and
`screens-split.html` shot at 1368 and 1024.

## Findings, worst first

1. **Without a tailnet my tablet either cannot load the board or holds full control of it.**
   Where: `screens.md` §6 ("The board does not need pairing. Viewing the board stays as today …
   A LAN-only setup … is `security.md`'s and `single-machine.md`'s"), Q-O21 b).
   What: laneboard binds `127.0.0.1` only (`README.md`, `server/config.mjs` `bind`). With no
   `fleet` block "everything is `local`" (`docs/fleet/auth.md` rule 1). My only way to put the board
   on a tablet is a reverse proxy to loopback, and then the tablet is `local`: it can act, launch,
   retire and type into terminals. "As today" means my desk screen is the most powerful thing in the
   house, not "a window" (plan §2, "a token cannot act", plan §4). The fix is deferred to two files
   nobody has written yet.
   Why it matters: this is the first thing I hit, before any cockpit feature. Either I give up
   here or I run something unsafe without knowing it.
   Fix: put the answer in `screens.md` §6 now, not in T17/T19. A paired device token must also be
   the screen's way into the board, with a new request kind (`screen`: every read plus
   `/api/cockpit/*`, no action, no terminal, no push change). The room or board listens on a LAN
   address only for that kind, refuses everything else there, and a screen without a token sees
   only the pairing card. Add one `S-SCR-` scenario: from a LAN address with a token, `GET
   /api/map` → 200 and `POST` to an action route → 403; without a token every route → the pairing
   page. This is a security one-way door, so it needs an owner question (below).

2. **"Another agent" has no contract to implement, and the safety rule depends on Claude Code's
   own flags.**
   Where: glossary "agent" ("any agent that speaks the bridge protocol works"), `protocols.md`
   (T15/T16, planned), `c3-see.md` §1 (launch line, `system/init` check), `c1-talk.md` §8
   (`SIGINT`), §10 (E4 login, E5 `api_retry`), Q-O23 a) (`--strict-mcp-config --allowedTools …
   --permission-prompts none`).
   What: every agent-facing mechanism written so far is Claude Code's: its flags, its init event,
   its retry event, its signal. The bridge protocol is unwritten. Worse, "read only before C6"
   (Q-O23 a) is enforced only by `--allowedTools`. My agent may have no allowlist, or a different
   one, and then it has a shell next to my board.
   Why it matters: plan §5 says "the bridge protocol and the MCP server are the product". For me
   only the second exists.
   Fix: (a) in `protocols.md` add a table "what the bridge needs | Claude Code | what any other
   agent must do": accept text on stdin, emit turn start, text delta, tool start/end, turn end,
   accept interrupt, connect to an MCP server over HTTP, honour a tool allowlist. (b) Make the
   read-only rule hold whatever the agent: the agent runs as its own uid with no write access to
   the board's state and no sudo, and the room refuses to start an agent kind that cannot declare
   an allowlist unless `cockpit.agent.allowUnrestricted: true` (warned at boot). (c) One scenario
   against the fake agent in "generic" mode that sends a tool event for an unknown tool and gets
   `used {name}`.

3. **There is no config for the agent at all.**
   Where: every `cockpit.*` key in the spec: `cockpit.url`, `cockpit.board.url`, `cockpit.mcp.port`,
   `cockpit.stt.url|language|tokenFile`, `cockpit.layout`, `cockpit.raw.toolOutput`. None says which
   program the room runs.
   What: no `cockpit.agent.command`, working directory, uid, model, or where its login lives. The
   "written context a laptop session would read" (plan C1) has no path.
   Fix: a `cockpit.agent` table in the style of `c2-voice.md` §9: `kind` (`claude-code` default,
   `bridge` for anything else), `command` (for `bridge`: an argv that speaks the bridge protocol on
   stdio), `cwd` (the written context; default the room's state dir, empty), `user`, `env` (names
   only, no values). Each with a default, an env var and a fatal-at-start error naming the key.

4. **On one machine I need two laneboard processes, two unix users and a pairing CLI, and none of
   it is written down; with one user I may not be able to pair at all.**
   Where: Q-O15 a) (the room is a laneboard server with a cockpit section), Q-O10 and T56 (the CLI
   refuses the agent's uid, "checks the peer uid and fails closed"), Q-O26 a) ("as its own unix
   user"), `screens.md` §6 (`cockpit.url`, "the room's address"; the room's own port is never
   named).
   What: I cannot tell how many processes run, on which ports (7777 board, 7790 MCP, the room's
   page: none given), which user each runs as, or what `cockpit.url` is on one box. If I run the
   agent as my own user (the obvious thing on a one-machine homelab), the uid check either lets
   the agent approve its own pairings or refuses me; the spec does not say which.
   Fix: `single-machine.md` (T19) should start from this: one `laneboard` process with a `cockpit`
   block serves board, room and page on one port; the agent runs as a second user created by one
   documented command; if the agent's uid equals the CLI's uid, `pair` prints `refused: the agent
   runs as you; give it its own user (docs/cockpit.md)` and exits 1. Add `laneboard cockpit doctor`,
   which prints each check (board reachable, MCP up, agent starts, agent uid differs, page origin
   secure) with one fix line each. One `S-ONE-` scenario per check.

5. **On a plain-HTTP LAN the cockpit does not work even for typing, and the spec only says so in
   open tasks.**
   Where: T56 (cookie `Secure`), T58 (no pairing on an insecure origin unless
   `cockpit.allowInsecure: true`), `c2-voice.md` §12 (HTTPS via "a tailnet's HTTPS proxy, or a
   reverse proxy with a certificate").
   What: without a tailnet I have no certificate the tablet trusts. A `Secure` cookie is never set
   on `http://192.168.x.x`. The pairing card (`screens.md` §6) has no text for this case, so I
   would see a code that never pairs.
   Why it matters: this is where I give up. I wanted to type, and typing needs no microphone.
   Fix: (a) the pairing card on an insecure origin reads `This page is not HTTPS, so it cannot be
   paired. docs/cockpit.md says how to get HTTPS on a LAN, or how to allow it anyway.` and shows no
   code; scenario at `http://hub.example.invalid:7777`. (b) `docs/cockpit.md` gets one tested LAN
   recipe (a local CA, its root installed on the tablet). (c) Say plainly what `allowInsecure`
   exposes (token and prompts in clear text on the LAN).

6. **I cannot try the cockpit before building a room.**
   Where: D17 (no `cockpit.url`: no button), T36 (`?demo=1` for the pane, still open),
   `docs/plans/product.md` rule 2 ("A feature without demo data is not done, because the demo is
   how a stranger meets it"), plan §5 "Demo".
   What: as written, the hosted demo and `npm run demo` show no cockpit button, since there is no
   room. Only `screens.md` §5 has `?demo=1` for the canvas.
   Fix: with `?demo=1` the button shows even without `cockpit.url`, the pane opens on the canned
   conversation labelled `DEMO`, typing plays a scripted turn from the fake agent bundled as static
   data, and the input placeholder reads `Demo: type anything`. Scenario: static demo build,
   no room, tap the button, a reply streams. D17 gains "except `?demo=1`".

7. **The always-on agent spends the same subscription as my loops, and nothing limits or shows
   that.**
   Where: plan C1 ("on a subscription"), `c1-talk.md` (no budget), `c3-see.md` `costUsd` (runs
   only), T13 (speak-ups, drift checks: standing work).
   What: my two loops and the cockpit agent share one 5 h window. Speak-ups and a drift check
   every pull spend it while I sleep. The Credit view (`#/credit`) would not show the cockpit as
   a separate spender.
   Fix: the room's agent reports its spend as its own lane (`cockpit` on Credit and Morning).
   Add `cockpit.agent.maxTurnsPerHour` (default 20) with an exact line when reached (`The cockpit
   paused itself: 20 turns this hour. It answers again at 08:00.`). Standing jobs (speak-ups,
   drift) default off when `cockpit.agent.kind` is not the owner's, or default off for everyone and
   the owner turns them on: an owner question for T13.

8. **Old tablet: one size is specified, the pane does not shrink, no browser floor.**
   Where: everything at 1368x912; D18 (pane fixed 608 px); Q-O9 (open); `screens.md` §1 (`switch`
   below 1280 px is the only rule). Sketch `c1-pane.html` at 1024: the pane runs off the right
   edge, the input placeholder is cut to `Type, or hold TAL`.
   What: at 1024x768 a 608 px pane leaves 416 px of Map; at 800x1280 portrait it covers the screen
   minus 192 px. No scenario runs below 1280. No minimum browser is named, though the spec leans on
   `visualViewport`, `interactive-widget` (T40) and `performance.mark`.
   Fix: pane width `min(608 px, 100vw)`, full width below 900 px with the view behind it reachable
   by `CLOSE` only. One scenario each at 1024x768 and 800x1280 asserting the input row and `SEND`
   are inside the viewport. Name a browser floor in `docs/cockpit.md` (e.g. Chrome 108 / Safari 16)
   and what degrades below it.

9. **"Any streaming speech service" is WhisperLiveKit's wire protocol.**
   Where: plan C2 ("any service that streams partial results works"), `c2-voice.md` §9/§10, D50
   (first message `config`, `status: "error"` updates, close 4400, 403 = session limit).
   What: another streaming service will not send `config` and lands in `stt-down` after 2 s.
   Not my blocker (I type), but the config table promises more than the client does.
   Fix: add `cockpit.stt.protocol` with one v1 value `whisperlivekit`, say other services need a
   shim, and list the four messages a shim must send.

10. **C3 answers nothing about loops that write no run file and lanes that are not Claude Code
    sessions.**
    Where: `c3-see.md` §2 (`runs` from `/api/runs`, `lanes` from `/api/lanes`); laneboard's
    `README.md` ("every Claude Code session on a machine").
    What: with another agent my loops may be invisible to `runs` and `lanes`, so "how did the night
    go?" gets an empty Morning. The agent should say why, not "nothing happened".
    Fix: `morning` and `runs` return `"sources": []` with a `hint` when no run file and no lane
    exists, and the standing instructions say `I see no runs: your loops write no run file
    (docs/runs.md).` One `S-C3-` scenario on an empty board.

11. **Owner-only words in what will become public docs.**
    Where: `screens.md` §6 "(the hub in the owner's case)", plan C2 "a local GPU model is the
    owner's case", `README.md` budget "`wlk bench` on the real host", Q-O21 "the tailnet" as the
    existing trust.
    Why: `docs/cockpit.md` will be written from these lines. A stranger reads "the hub" and
    "the tailnet" as requirements.
    Fix: each such line names the general case first (`the laneboard that serves the page: a hub,
    or the one box`) and the owner's case second, or not at all.

## Decided in the spec, but contradicted by `spec-input.md` or owed to the owner

- `screens.md` §6 "Viewing the board stays as today" contradicts `spec-input.md` §6 "Not tied to
  one VPN: a tailnet is the owner's way; auth in front, device tokens or LAN-only are others": on a
  non-tailnet setup "as today" is full `local` power on the tablet. A new request kind for screens
  is security-relevant and a one-way door. **Needs a new Q-O**: a) device token opens the board as
  read-only `screen` kind (recommended); b) reverse proxy with its own login, the tablet stays
  `local`, documented as unsafe; c) cockpit needs a tailnet in v1 (breaks §6).
- `spec-input.md` §3: "everything (board plus agent) must also run on one machine. The split is an
  option, not a requirement." The spec's recommendations (Q-O15 a, Q-O26 a, Q-O10 uid refusal) add
  up to a second unix user as a requirement for safe pairing. That cost should be stated in Q-O10
  for the owner, with what happens on a one-user box.
- Q-O23 a) is recommended as "taken literally" from §6, but its enforcement is a Claude Code
  flag; for any other agent (plan §5) it is not enforced. Q-O23 should say so.
- D17 (no `cockpit.url` → no cockpit) conflicts with `docs/plans/product.md` rule 2 (every feature
  ships with demo data) unless `?demo=1` is excepted.
- Plan C2 "any service that streams partial results works" versus D50's WhisperLiveKit-only
  signals: a D-line at least, stating the v1 limit.
- No decision or question on the cockpit agent's spend sharing the loops' account; T13's
  speak-ups and drift checks make it standing cost. An owner question on defaults belongs there.

## Rubric

score spec concrete 7
score spec complete 2
score spec consistent 5
score spec testable 6
score spec ownerfit 4
score spec simple 3
score spec safe 4
