# Review, round 35: security

Scope: everything since the night's base `ec6ea84` (no security review before this one): T1-T21,
the server under `server/cockpit/`, `server/config/cockpit.mjs`, `server/boot/cockpit.mjs`, the board
changes (`server/ws.mjs`, `server/boot/builder.mjs`, `server/routes/cockpit-hello.mjs`) and the
pane's client modules. Read against `spec/security.md` §1-§6, `protocols.md` §11.2, §11.11, plan §4.
Severity: HIGH (a way past a fence), MEDIUM (a fence weaker than the spec says), LOW (hardening,
or attribution).

## Findings, worst first

### 1. HIGH (spec gap, for the owner): a `claude-code` agent has one tool fence, and its settings files can widen it

- What I saw: `server/cockpit/bridge.mjs:153` sets `checkTools` for `kind: bridge` only, so
  `onToolStart` (`bridge.mjs:474-482`) never trips for Claude Code. A non-denied `tool.start` for
  `Bash` is drawn as a running tool and the turn goes on. The only fence is
  `--allowedTools … --permission-prompts none` (`server/cockpit/agents/claude-code.mjs:29-44`).
  That is what §11.11 says, so the build matches the spec.
- Why it matters: the build research says `--allowedTools` is a set of permission *allow* rules
  (`build/research/Q2-stream-json-recheck.md`, flag table). It does not limit which tools exist. As far as I
  know, Claude Code also loads permission rules and **hooks** from settings files: the agent's home
  (`~/.claude/settings.json`) and the project in its cwd (`.claude/settings.json`,
  `.claude/settings.local.json`). A hook runs a shell command with no tool call at all. With
  `cockpit.agent.cwd` set to a repo (I3), anyone who can push to that repo can commit a
  `.claude/settings.json` that runs code as the agent's user at every session start. That user can
  reach the board's loopback port as `local`, and `security.md` §3 says `local` runs every action
  that is not remote-only. That would be a path that changes the fleet. None of this is confirmed
  against the current release, so it is a research question, not a fact.
- Fix (owner's call, the spec is silent):
  - (a) Run the `toolAllowed` check for `claude-code` too: a `tool.start` that is not denied and is
    outside `cockpit.agent.allowedTools` ends the turn E8 and stops the child, as for a bridge
    agent. This is about 1 line plus a test in `test/cockpit-bridge.test.mjs`. It costs nothing when
    Claude Code obeys its flag.
  - (b) A research round on Claude Code's flags for limiting the set of tools and the settings
    sources it loads. If they exist, add them to §11.2.
  - (c) Add a start-check line that refuses a cwd holding `.claude/settings*.json` the room's user
    does not own.

### 2. MEDIUM: the agent's stderr reaches every screen unredacted

- What I saw:
  - `bridge.mjs:210-213` keeps raw stderr lines (cut only).
  - `session.mjs:254-255` puts `tail.at(-1)` into `status.detail` of `agent-down`.
  - `session.mjs:94` emits that as a `status` message, and `link.mjs:207-223` sends it to every
    link and keeps it in the replay buffer (`kept`). `welcome.status` (`link.mjs:389`) gives it to
    every new page.
  - Neither path calls the redactor. `turn.end.detail` does (B75, `bridge.mjs:605`), which shows
    the rule was meant to cover agent text.
- Why it matters: D127/D211 (`bridge.mjs:148` "everything of the agent's that a screen or a file
  gets passes here first"). A failed start often prints a config line, a URL with credentials, or a
  token, and it lands on the desk under E3.
- Fix: redact at the source, `stderrLines.push(cut(redactor.text(line)))` at `bridge.mjs:212` and
  `:218`. Apply the same to the `cockpit agent stderr:` log line at `:211`, which today writes the
  raw line into the room's log. Add one case in `test/cockpit-session.test.mjs`: a stderr line
  `Bearer sk-ant-…` gives `status.detail` with `[redacted]`.

### 3. MEDIUM: `local` is taken without checking that the peer is on loopback

- What I saw: `server/cockpit/link-checks.mjs:64-66` accepts any issued auth of kind `local`. On a
  board with no `fleet.ingressPort` (a one box without a fleet block), `classify`
  (`server/fleet/auth.mjs:558-563`) returns `local` for **every** peer. The loopback-peer rule
  (`auth.mjs:567-568`) applies only when a fleet block is present. So a one box with `bind` on a
  LAN or tailnet address gives the room link to any client on that network. A script sets Host and
  Origin to whatever it likes; the Origin check only stops browsers.
- Spec: `security.md` §2.3 point 2 says "`local` (the main port, **a loopback peer**)". The build
  departs from the spec, and the spec is right.
- Fix: in step 4 of `linkRefusal`, for `kind === 'local'` also require a loopback
  `req.socket.remoteAddress` (127.0.0.0/8, `::1`, `::ffff:127.*`; unknown counts as refused, as in
  `auth.mjs:624`), else 4401 `unpaired`. Unit case: an issued `local` auth with remoteAddress
  `192.0.2.5` gives 4401.
- Also for the owner: on ingress with `fleet.enforce: false`, a request with neither a login nor a
  signature becomes `direct` user `local` (`auth.mjs:43`) and gets the link without
  `fleet.allowedUsers`. D212 takes the board's word, so this is as specified; it is worth one line
  in `docs/cockpit.md` (T44): "set `fleet.enforce` before you run a room behind serve".

### 4. MEDIUM: D209's "read, never write" for `{stateDir}/cockpit-agent/` is never checked

- What I saw: `server/boot/cockpit.mjs:125-127` makes the directory 0755 and swallows a failed
  `chmod` ("not ours: the walk below names it"). The walk only warns about directories the agent
  cannot *enter*. `secretPaths` (`start-check.mjs:35-47`) covers `{stateDir}/cockpit/`, not
  `cockpit-agent/`. If the agent's user owns that directory, or can write to it (a leftover from a
  manual setup, or a pre-made directory), nothing stops the room.
- Why it matters: the directory is the default cwd. It holds `mcp.json` (the MCP URL) and, for a
  bridge agent, `instructions.txt`. A writable cwd is where finding 1's `.claude/settings.json`
  would go. It matters as soon as the agent can write anything: a bridge with `allowUnrestricted`,
  Q-O23 c, or finding 1.
- Fix: one more entry in the start check, fatal. `cockpit-agent/` and every file in it must be owned
  by the room's user with no group or other *write* bit (read stays open, D209). Use the line form
  of D248: `{path} is owned by uid N, not you`. This adds a row to D210's list, so the owner
  decides; build it as a patch-free addition in `start-check.mjs` once answered.

### 5. MEDIUM (tracked, must land before merge): stop and new leave no audit line, and the room has no prompt rate

- What I saw: `link.mjs:363-372` runs `session.stop` and `session.newConversation` with no audit
  line (T30). `prompt()` (`link.mjs:409-446`) has no 10-per-60 s limit (D228, T23). Only the
  link's 50 frames/s (§8) applies.
- Why it matters: `security.md` §2 lists `cockpit.stop` and `cockpit.new` as the limit on what a
  holder of the link can do unseen. Until T30, anyone with `local` or `direct` can interrupt the
  owner's turns and move the conversation to `old/` without a trace. D228 is per device token; C1
  has no token. Without a decision, T23 will have to invent the key.
- Fix: keep T23 and T30 before the PR. Write in DECISIONS that C1's rate key is the link, with
  every link counted together under the one `board` screen. That is the safe reading: two tabs do
  not double the rate.

### 6. LOW-MEDIUM (spec question): reply redaction lets `NAME=value` secrets through

- What I saw (probe of `createRedactor().text`, round 35): `PGPASSWORD=abc123 psql`,
  `"client_secret": "abcd1234efgh"` and `https://u:p4ssw0rd@db.example.invalid/x` all come out
  unchanged. This is as D211 says: rule 4 is left out of reply text.
- Why it matters: the likeliest leak on the desk is the agent quoting a world-readable `.env` or
  config (`security.md` §3, the "anything world-readable" row), which is exactly `NAME=value` in a
  code block.
- For the owner: apply rule 4's no-space forms (`NAME=value`, `"name": "value"` with a secret-like
  name) to reply text inside fenced code blocks only, plus URL userinfo (`//user:pass@`). Prose
  stays as D211 wants it. The spec stands until then.

### 7. LOW (tracked as T45): lower-case scheme words

- What I saw: `use bearer abcdefgh1234 now` and `Authorization: token xyz123secret here` pass
  (`redact.mjs:31`, B71).
- Fix: when T45 is built, include `token` right after `Authorization:` (GitHub's own header form),
  not only `bearer`/`basic`.

### 8. LOW (for the owner): the audit line cannot say who prompted

- What I saw: `audit-lines.mjs:28` always writes `user: 'board'`, though `common.mjs:209` puts the
  board's `direct` login in `req.tsUser`. This is as `security.md` §2.3 point 3 says.
- Why it matters: with two `direct` logins, "who asked the agent that" cannot be answered from the
  log. D37 forbids drawing names; it says nothing about the audit log.
- Fix: a `login` field (the `direct` login, or `local`) next to `user: board`. Owner.

### 9. LOW (hardening, for the owner): the agent's own uid can open the room link

- What I saw: loopback plus a forged `Origin` gives `local`, and `linkRefusal` does not ask which
  uid is calling.
- Why it matters: D161 refuses the agent's uid on the admin routes. An agent that ever gets an HTTP
  client (a bridge with `allowUnrestricted`, Q-O23 c, finding 1) could prompt itself, read the
  conversation and stop the owner's turns.
- Fix: the same peer-uid check (`server/fleet/peercred.mjs`, imported, not edited) in step 4 of
  `linkRefusal`, giving 4401 for the agent's uid.

## Checked and holding

- **Cross-site.** The board's `guardUpgrade` runs first (`common.mjs:178-220`). The room then
  requires an exact `Origin` (`no-origin` 4403), `Sec-Fetch-Site`, and https or loopback http
  (D182). A forged, non-issued `auth` object is refused (`test/cockpit-link.test.mjs:79`). A page
  on another site cannot open the link.
- **D66.** The agent's prompt is the room's about line with a JSON-escaped id cut to 128 characters,
  plus the spoken line, plus the owner's words (`bridge.mjs:79-88`). `focus` (it carries the route's
  `q`) is not forwarded in C1 (`link.mjs:376`). No board text reaches the prompt.
- **Launch.** The argv matches §11.2 flag for flag, with no shell (`claude-code.mjs:29-44`). The
  environment is D108's list only (`bridge.mjs:115-120`). `sudo -n -u … --preserve-env=<names>`
  (`:136`). Flags inside `cockpit.agent.command` are fatal. `allowUnrestricted` is refused for
  claude-code and without a user (`config/cockpit.mjs:328-333`).
- **Redaction of tool input and of reply deltas.** Split secrets, PEM, `sk-`, `ghp_`, `AKIA` and
  long runs are all caught in the probe. The still `r34-tried-dark-1368-turn1.png` shows
  `Bearer [redacted]` and `token=[redacted]&lb_sig=[redacted]` in the opened rows.
- **Prompt audit line** before the agent, fail-closed with `audit-unavailable` (D166,
  `link.mjs:432-437`).
- **No path that changes the fleet.** The only board change is a read-only hello field
  (`routes/cockpit-hello.mjs`, `ws.mjs`).
- **Pane.** No `innerHTML` or `href` sink in `public/js/cockpit/*`, `md.js`, `tool-words.js`. No
  storage of the draft.
- **Not judged:** the MCP server (T35 is not built; `mcpToken: null` at `boot/cockpit.mjs:80`).
  Loopback, token and Origin refusal are still to come, and are review-required when they land.

## Build against spec

- Finding 3: the build is wrong; `security.md` §2.3 says loopback peer.
- Findings 1, 4, 6, 8, 9: the build follows the spec; the spec is thin there. Owner questions.
- Finding 2: the spec (D127/D211, "everything of the agent's") is right; the build missed a path.

## Rubric

score pane spec 7
score pane tests 7
score pane legibility 7
score pane touch 6
score pane speed 6
score pane safety 8
score room spec 6
score room tests 7
score room legibility 7
score room touch 5
score room speed 6
score room safety 5

## console.txt read

- `r33-tools-film/console.txt` (the newest filmstrip): empty, 0 lines.
