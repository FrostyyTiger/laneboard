# Review, round 108: security

Scope: everything since the last security review (`09b5f1e`, round 35): T22-T32, T22b, T23b, T23c,
T24b and the fix rounds. Server: `server/cockpit/{audit-lines,bridge,link,login,prompt-rate,session,status}.mjs`,
`server/boot/cockpit.mjs`. Client: `public/js/cockpit/*` (new: `chip`, `draft`, `errors`,
`keyboard`, `newconv`, `screen-tabs`, `status`, `auto-close`), the Wall's `galaxy/main.js`,
`touch.js`, the two viewport meta lines. Read against `spec/security.md` §2-§5, `screens.md` §6.4,
`protocols.md` §11.10, plan §4. No file outside `server/cockpit/`, `server/boot/cockpit.mjs` and the
client changed on the server side.
Severity: HIGH (a way past a fence), MEDIUM (a fence weaker than the spec says), LOW (hardening,
or attribution).

## Findings, worst first

### 1. HIGH (open since round 35, owner unanswered): a `claude-code` agent still has one tool fence

- What I saw: unchanged since review 35 finding 1. `server/cockpit/agents/claude-code.mjs` has not
  changed since `e6b5271`. T54 (the tripwire for claude-code too) is `- [ ]` in PROGRESS.md:107. The
  owner line (PROGRESS.md:430) has no answer.
- Why it matters: hooks and permission rules from `.claude/settings*.json` in the agent's cwd or
  home can run commands with no tool call. The agent's uid reaches the board as `local` (finding 2
  of this review makes `local` wider still). That is a path that changes the fleet.
- Fix: build T54 before the PR (the safest written option). It does not need the owner's answer.

### 2. MEDIUM (confirmed by probe, open 73 rounds): `local` is still taken from any peer

- What I saw: `server/cockpit/link-checks.mjs:73-75` is unchanged. Probe this round (round-108
  script, not committed): `classify` with `{port: 7801, bind: '0.0.0.0'}` and no fleet block, Host
  and Origin `127.0.0.1:7801`:
  - `remoteAddress 127.0.0.1` → kind `local` → `linkRefusal` null.
  - `remoteAddress 192.0.2.5` → kind `local` → `linkRefusal` **null**.
- New detail: the same probe also passes D182. `secureOrigin` (`link-checks.mjs:43-48`) trusts the
  `Origin` header's host, and a script sets that header to `http://127.0.0.1`. So a LAN peer gets
  the conversation and the prompt over **plain HTTP off loopback**, which D182 forbids.
- Spec: `security.md` §2.3 point 2, "`local` (the main port, a loopback peer)". The spec is right;
  the build is wrong.
- Fix: T52 as written. Also take D182's "loopback" from `req.socket.remoteAddress`, not from the
  `Origin` text: http is allowed only when the peer is loopback too. One more unit case: http
  Origin `127.0.0.1`, remoteAddress `192.0.2.5`, `allowInsecure` false → 4403 `insecure-origin` (or
  4401 first, whichever check runs first; say which in a B line).

### 3. MEDIUM (open 73 rounds, the path grew): the agent's stderr reaches every screen unredacted

- What I saw: `server/cockpit/bridge.mjs:215-216` still pushes `cut(line)` with no redactor, and
  logs the raw line. T28 added a second reader of the raw tail:
  `server/cockpit/session.mjs:294` (`lastLine`) → `:303` `agent-down` `detail`. The new arbiter
  `server/cockpit/status.mjs:954` keeps it in `held` and re-sends it on every change of the slot,
  so it lands in `welcome.status` of every page that loads while the room is down.
- Why it matters: D127/D211, "everything of the agent's that a screen or a file gets passes here
  first". A failed start prints config lines, URLs with credentials, tokens. E3 shows it on the
  desk.
- Fix: T53 as written. Redact at the source (`bridge.mjs:216`, `:222`, and the log line at `:215`),
  so `session.mjs:294` and the login-word test read the redacted line too.

### 4. MEDIUM (process): the security queue has been passed over for 70 rounds

- What I saw: T45, T52, T53 and T54 are all `- [ ]`. Review 89-owner finding 1 asked for T45, T53,
  T52 before T27. PROGRESS.md:436 kept the order. T27-T32, T22b and T24b were built since.
- Why it matters: each of the four is small (one module, one or two test cases). The night ends at
  23:00. If they do not land, the PR goes to the owner with a known way past D212, a known
  unredacted path, and the claude-code fence open.
- Fix: triage puts T52, T53, T45, T54 next, before any further `[ui]` task. If one cannot land,
  the PR body names it as open.

### 5. LOW-MEDIUM (unchanged, spec question): reply redaction still lets `NAME=value` and URL userinfo through

- What I saw (probe this round, `createRedactor({secrets: []}).text`):
  - `PGPASSWORD=abc123secret psql` → unchanged.
  - `https://u:p4ssw0rd@db.example.invalid/x` → unchanged.
  - `use bearer abcdefgh1234 now` → unchanged (T45).
  - `Authorization: token xyz123secretvalue` → unchanged (T45, review 35 finding 7).
- Fix: T45, including `token` after `Authorization:`. The `NAME=value` rule in fenced code blocks
  is still the owner's call (PROGRESS.md:433).

### 6. LOW: one `cockpit.stop` line per `stop` frame, not per stop

- What I saw: `server/cockpit/link.mjs:376-380` writes `stopLine` whenever the running turn's id
  matches, before `session.stop`. `session.mjs:316` returns ok for a turn that is already
  stopping. So 50 `stop` frames a second (the link's own limit, §8) for one turn give 50 chained
  lines a second, from each of up to 32 links. The link closes 4429 only on the third pass in 60 s,
  and the client reconnects.
- Why it matters: D165's stated aim is that a holder of the link "cannot flood the chain faster
  than the rate limit lets it prompt". Prompts got that bound (T23c). Stop did not. Each line is an
  append to the board's own hash-chained file.
- Spec: `screens.md` §6.4 says "the room receives `stop` … before it asks the bridge". It does not
  say once per turn. I think the intent is one line per stop that does something.
- Fix: write the line only when `session.stopping` is null for that turn (the stop that begins),
  or once per turn id. Note it as a B line. Add a link test: three `stop` frames for one running
  turn give one `cockpit.stop` line.

### 7. LOW: the owner's NEW can leave no trace

- What I saw: `link.mjs:385-390` keeps the owner's NEW in `askedNew` and writes `cockpit.new` only
  at the new conversation's `ready` (`link.mjs:505`). Two cases leave no line at all:
  - The room exits (or is restarted) between START and the new `ready`.
  - A forced fresh start reaches `ready` first: `conversationStarted` with `forced` sets
    `askedNew = null` and writes `user: room`.
  In both cases a running turn may already have been stopped by NEW (`session.mjs:384`
  `beginStop`). That stop writes no `cockpit.stop` line, because it does not come through the
  link's `stop` case.
- Why it matters: "what did the cockpit do at 03:00": the owner's stop of a turn should be in the log.
- Spec: §6.4 says `cockpit.new` is "written once it has started". The build follows the spec.
- Fix (owner): write `cockpit.stop` for the turn NEW stops, at the moment it stops it (`result`
  with `"by":"new"`), so taking away is logged when it happens. `cockpit.new` stays as specified.

### 8. LOW (hardening): a hung login check is never killed

- What I saw: `server/cockpit/login.mjs:76-80` sends SIGTERM at 10 s and resolves. There is no
  SIGKILL. `running` is cleared, so while `not-logged-in` holds a new check starts every 60 s
  (`CHECK_HELD_MS`) beside the old one. With `user` set, the SIGTERM goes to `sudo`.
- Spec: §11.10 says "else SIGTERM" and nothing more. The build follows the spec.
- Fix: SIGKILL 2 s after the SIGTERM, as the bridge does (`STOP_KILL_MS - STOP_TERM_MS`). Or do not
  start a new check while the last child has not closed. A B line either way.

### 9. INFO: a same-origin page can put a `YOU · NOT SENT` block on the pane

- What I saw: `public/js/cockpit/screen-tabs.js:40-43` draws any `prompt.refused` `too-many` note
  from the BroadcastChannel. The note's `text` becomes a block whose `RETRY` sends that text as the
  owner's prompt. `refusedNote` checks the shape, not where the note came from.
- Why it matters: only a script on the board's own origin can post to the channel. Such a script
  already owns the page. No fix needed. Do not reuse this channel for anything that sends without a
  tap.

## Checked and holding

- **Cross-site.** No change to the upgrade path since round 35. `guardUpgrade`, then exact Origin,
  `no-origin`, `Sec-Fetch-Site` (`link-checks.mjs:58-66`). A page on another site cannot open the link.
- **D66.** The agent's text is still `agentPromptText` (`bridge.mjs:702`); the D123 resend
  (`bridge.mjs:596`) and the held prompts (`:676`) send the same `agentText`, with no board text
  added. `focus` and the other later-slice messages still change nothing (`link.mjs:393`).
- **No path that changes the fleet.** Since `09b5f1e` no file outside `server/cockpit/`,
  `server/boot/cockpit.mjs`, `public/` and tests changed. No new route. No new board call.
  `restartForLogin` (`session.mjs`) restarts only the agent.
- **Launch.** `spawnArgv` and `launchArgs` are unchanged. The login check runs with the same
  `sudo -n -u … -H --preserve-env=…` form (`login.mjs:486`, `bridge.mjs:139`), no shell, stdin
  ignored. Its environment is `childEnv` without `LANEBOARD_MCP_TOKEN` (B213). Its output is never
  logged; only `exit N`, `timeout`, `cannot start: <code>`.
- **Audit lines.** `cockpit.prompt`, `cockpit.stop`, `cockpit.new` and the bounded `too-many`
  refusal are written with `args` hashed (`audit-lines.mjs:142-143`). S-SCR-30 checks the order, the
  `argsHash`, that the file does not contain `night`, and that `laneboard audit verify` passes.
  S-SCR-31 checks fail-closed for prompts and that stop still runs, with one stderr line.
- **Prompt rate (D228).** `prompt-rate.mjs` is its own module with its D numbers. The 11th prompt is
  refused before the audit line and before the agent. Refused prompts give their slot back. Every link
  shares the one key (B179), so two tabs do not double the rate. Tested in `test/cockpit-prompt-rate.test.mjs`,
  `test/cockpit-link.test.mjs:865` (the line and `refusedSince`), and S-C1-43 end to end.
- **Pane.** Still no `innerHTML`, `href` sink, `eval` or storage in `public/js/cockpit/*`. The
  draft is not stored (`draft.js` is pure).
- **Not judged:** the MCP server (T35 is not built; `mcpToken: null`, `boot/cockpit.mjs`). Loopback,
  token and Origin refusal are still to come, and need review when they land. S-SEC-03 (T37) has no
  test yet.

## Build against spec

- Finding 2: the build is wrong (`security.md` §2.3 point 2, and D182 via the Origin text). The spec
  is right.
- Finding 3: the build missed a path that D127/D211 cover. The spec is right.
- Findings 6, 7, 8: the build follows the spec's words. The spec is thin there (one line per stop
  frame, a NEW logged only at `ready`, SIGTERM without a SIGKILL). Owner questions.
- Findings 1, 5: owner questions still open from round 35.

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
score room safety 4

Room safety goes from 5 to 4. Findings 2 and 3 still reproduce 73 rounds after they were raised.
The stop-line path added an unbounded write to the chain.

## console.txt read

Read with `cat`, every line as it stands. Both runs had the room down on purpose; no other line.

`r105-stack/console.txt` (13 lines):

```text
app dark 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 800: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 800: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 800: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 800: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 1368: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 800: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 800: WebSocket connection to 'ws://127.0.0.1:9346/api/cockpit/ws' failed: Connection closed before receiving a handshake response
```

`r104-down/console.txt` (24 lines):

```text
app dark 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app dark 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall dark 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall light 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall light 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall light 1368: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
app light 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall light 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall light 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
wall light 800: WebSocket connection to 'ws://127.0.0.1:9069/api/cockpit/ws' failed: Connection closed before receiving a handshake response
```

`r103-tour`, `r99-rate`, `r97-new`: no `console.txt`.
