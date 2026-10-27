# Cockpit build: progress

Night: **C1 night** (plan README §9), slice `spec/slices.md` §3.1, run `cockpit-c1`. Planned in round 1.

Notes for every builder round:
- One task per round, the first `- [ ]` from the top unless it is blocked. Tick it as
  `- [x] T<n> … (commit <sha>)`; a task you cannot finish is `- [!] T<n> … blocked: <why>`.
- **Split line** (README §9): T1-T26 are **C1a** (builds 1-12), T27-T44 are **C1b** (builds 13-23,
  the patches, the demo, the docs). If the night ends before T27, the next night starts at T27.
- **The Wall is merged** on this branch (`public/js/wall/`, `docs/wall.md`, commit 0c6b951): the
  Wall scenarios of §3.1 (S-C1-01, S-SCR-02, -03, -04, -21, -22 and S-SCR-35's Wall steps) are
  built and run now, not skipped. B00 (DECISIONS-c1.md) lists the galaxy's extra `show.result` whys.
- **No whole-test waits in C1.** The waits §3.1 names are single steps, written as
  `test.step.skip('<step> — waits for <slice>', …)` (B4): S-C1-22's two-cards step (Canvas),
  S-C1-46's `show` step (Show), S-SCR-23's canvas strip (Canvas). The talk button's half of
  S-C1-01, -26, -32, -37, -45, -46, S-SCR-09, -17, -19 and S-SCR-25's second case is C2's: in C1
  those tests assert the `stt.url: none` layout in its place (§3.1, D265: no `[data-talk]`, `SEND`
  in the talk button's rect, the input to 16 px left of it; at 1024 and 800 wide `SEND` x 936-1000
  or x 712-776) and nothing about the talk button.
- **Owner answers**: every `Answer:` in `spec/QUESTIONS.md` is `(open)` at planning, so the night
  builds the recommendations (Q-O21 b, Q-O22 b, Q-O29, Q-O36 …): 73 ids.
- **Fenced** (`loop-build/fenced.txt`): `server/http.mjs`, `server/boot/common.mjs`,
  `server/boot/hub.mjs`, `server/hub/*`, `server/security.mjs`, `server/fleet/auth.mjs`,
  `server/fleet/audit.mjs`, `public/js/core/net.js`, `public/js/core/store.js`, `test/map*.test.mjs`
  and more. Import from them, never edit them. Routes and upgrades go through `server/modules.mjs`'s
  `ctx.route`/`ctx.upgrade`; the page's room link imports `nextBackoff` and `BACKOFF_*` from
  `net.js` (D263). The page's cockpit code lives in `public/js/cockpit/` (not `confirm*`/`act*`,
  fenced as C6) plus the shared modules the spec names in `public/js/core/` (`md.js`,
  `tool-words.js`, `cockpit-constants.js`, `cockpit-time.js`, `cockpit-demo.js`).
- **Security-relevant files** (fenced.txt's last block: `server/cockpit/redact.mjs`, the start check,
  the agent's launch flags and allowlist, the MCP server's loopback/token/Origin refusal, the room
  link's upgrade checks, `server/config/cockpit.mjs`'s fatal lines, the audit lines) stay in small
  modules with their own `node:test` file, each check commented with its D number. The PR body
  lists them for the owner's review.
- **Tests**: Playwright files are `e2e/cockpit/c1-<topic>.spec.mjs` (S-C1-41's is
  `e2e/cockpit/pressed.spec.mjs`, as the spec names it), one `test('<id> <title as written>', …)`
  per id; node:test scenarios are `test/cockpit-<topic>.test.mjs`. A scenario with a node:test part
  and a Playwright part is one Playwright test whose node part is a `test.step` calling the room
  directly (B2). Run `npm run test:cockpit -- -g '<the task's ids>'` before ticking; the whole
  `test:cockpit` after a change to shared code (the link, the pane, the renderer, fixtures).
  Paste the summary line into the task's tick line.
- `[ui]` tasks end with stills (`shoot.mjs`, dark and light, 1368 and 800 wide) and, where
  something moves, a filmstrip (`film.mjs`); shots stay in `$RUN_DIR/shots/`.
- Before T15 there is no harness: stand-in and room tasks close on `node:test` in `npm test`.

## Tasks

- [x] T1 (build 1, `stand-ins.md` §2, §7 step 1) The fake agent `test/cockpit/stand-ins/fake-agent.mjs`, dialect `claude`: script loading (§2.2), steps text/tool (no real MCP call yet)/end/exit (§2.3), its log and `fake-agent-log.mjs` helper (§2.6); with no arguments it prints its usage and exits 0 (slices §2) — ids: none — done when: `test/cockpit-fake-agent.test.mjs` replays `protocols.md` §13.1 through a scripted child and the native lines match line by line; npm test green. — built also: steps denied/retry/ping, `start` and the `auth status` login check of §2.3-§2.4 (small, T5's script check needs every kind); B5-B11. `node --test test/cockpit-fake-agent.test.mjs`: pass 11, fail 0; npm test: pass 4279, fail 0 (commit 69ccd1e)
- [x] T2 (build 1, `stand-ins.md` §3.1-§3.4, §7 step 2) The fake speech `test/cockpit/stand-ins/fake-speech.mjs` (WhisperLiveKit's protocol of `protocols.md` §12, script format §3.2, faults §3.3, log §3.4, its own clock); no C1 Playwright test starts it (D265) — ids: none — done when: `test/cockpit-fake-speech.test.mjs` has one case per §3.3 fault row against a plain `ws` client; npm test green. — built also: `noAudio`, the §3.5 CLI (its `demo` script comes with T43, B3; until then it says `no script …` and exits 1); B12-B16. `c2-faults` is inline in the test (B13). `node --test test/cockpit-fake-speech.test.mjs`: pass 15, fail 0; npm test: pass 4295, fail 0 (commit fb346d0)
- [x] T3 (build 1, `stand-ins.md` §1, §7 step 3) The room under test `test/cockpit/stand-ins/room-under-test.mjs`, `server/cockpit/clock.mjs` (`setClock`, `now`, timers, `real`/`manual`) and `server/cockpit/faults.mjs` (`setFaults`, three hook points, no-ops by default), the control port and every §1.2 verb that needs no later build (the rest answer `404 unknown-verb` until their task, noted per verb in the test); `test/helpers/boot.mjs` gains `entry`, `stateFiles`, `auditFile`, `restart({signal})`, `control`, `mcp()` and `mode: 'cockpit'` (§1.1, defaults unchanged). The wrapper imports `startRoom()` from a first `server/boot/cockpit.mjs` that T6 completes (B1) — ids: none — done when: `test/cockpit-room-under-test.test.mjs` has one case per §1.2 row it serves; every existing `boot()` test passes unchanged; npm test green. — built: `/clock`, `/tick`, `/link`, `/drop` (the hooks); `/connections`, `/sent` wait for T14, `/pair`, `/unpair` for pairing, `/button` for C2b, `/jobs` for Jobs, `/alarms` for the watcher (404 unknown-verb, named in the test); `test/cockpit/stand-ins/room-control.mjs` holds the API; `boot()`'s `mode: 'cockpit'` is written but boots only after T6 adds the mode; B17-B24 (B23: the wrapper exits 0 outside `boot()`, it had hung `npm test`; B24: T1's log race). `node --test test/cockpit-room-under-test.test.mjs`: pass 25, fail 0; npm test: pass 4322, fail 0 (commit 021aeed)
- [x] T4 (build 1, `stand-ins.md` §2.3-§2.5, §7 step 4) The fake agent's real MCP calls (URL from `--mcp-config`), `queued` and `onInterrupt` steps, signals (§2.4) and the `bridge` dialect (§2.5) — ids: none — done when: `test/cockpit-fake-agent.test.mjs` gains a case each (the MCP call against a small loopback JSON-RPC stub in the test); npm test green. — built: `mcpCall()` (JSON or SSE answer), steer/after-turn/ignore/ignore-once, `priority` later/now, receipts (`control_response`/`interrupted`), `aborted_streaming`, SIGINT/SIGTERM, `bridgeSpeaker()`; the §11.4 row reader in the test now also reads rows with a note after the line (the `aborted_` row); B25-B28 (B28 replaces B8 but its first point). `node --test test/cockpit-fake-agent.test.mjs`: pass 19, fail 0; npm test: pass 4330, fail 0 (commit c8ea8d7)
- [x] T5 (build 1, `stand-ins.md` §5, §7 step 4) The C1 scripts in `test/cockpit/scripts/`: `c1-render`, `c1-typing`, `c1-errors`, `c1-login`, `c1-long`, `c1-session`, `c1-voice`, `scr-room`, `c3-tools`, `sec-reply`, `sec-inject`, each as §5's row says; and the script check (parses, known step kinds, `at` rising, every native line validates as a `json claude` fixture, D98) — ids: none — done when: `test/cockpit-scripts.test.mjs` checks all eleven; npm test green. — built: every §5 C1 row; `renderTurn()` (dry walk) and `native-rows.mjs` shared with the fake-agent test; turn fields `about`/`for`; scr-room adds S-SCR-04's 400 s turn; B29-B36. `node --test test/cockpit-scripts.test.mjs`: pass 19, fail 0; npm test: pass 4350, fail 0 (commit 3d9714d)
- [x] T6 (build 2, spec `README.md` "The room process", `protocols.md` §1, D128, D129) The room process: `cockpit` as the third `MODES` entry in `server/config/mode.mjs` and `server/modules.mjs`, `server/config/cockpit.mjs` (keys of `protocols.md` §11.12, `c2-voice.md` §9, `cockpit.forwarded`, `cockpit.mcp.port`; the fatal-at-start lines of D128/D129, each commented) with `docs/config.md` rows as `test/config-docs.test.mjs` asks, `server/boot/cockpit.mjs` `startRoom()` for `mode: builder` + `cockpit.agent` (called from `server/boot/builder.mjs`) and for `mode: cockpit` alone (`listenAll`, `registerHealthz`, `startRoom`, `installSignalHandlers`; port 7778), `server/index.mjs`'s one line — ids: none — done when: `test/cockpit-room.test.mjs` holds the `mode: cockpit` route test of `protocols.md` §1 through `boot({mode:'cockpit'})` (`/healthz`, `/api/cockpit/*`, no `/ws`, no collectors) and one case per fatal line; `test/config-cockpit.test.mjs` green; npm test green. — built: `startRoom(ctx)` prints the start lines and makes the default cwd (bridge T9, link T13, MCP T35 hang on it, B43); the room alone answers 404 off its paths by a request-handler wrap (B41); unworded lines B38-B40; B37-B46. `node --test test/cockpit-room.test.mjs`: pass 29, fail 0; `node --test test/config-cockpit.test.mjs`: pass 56, fail 0; npm test: pass 4435, fail 0 (commit 8e5e7f1)
- [x] T7 (build 2, `security.md` §1, §3, D209, D210) The start check: the room refuses to start when the agent's user can read the room's secrets (injected `stat`, as D111 injects uids), and the agent's files; its own module under `server/cockpit/` with each check's D number — ids: S-SEC-01 — done when: S-SEC-01 passes in `test/cockpit-security.test.mjs` (node:test); npm test green; the module is named under `## For the owner` as review-required. — built: `server/cockpit/start-check.mjs` (`secretPaths`, `fileProblems`, `agentWalk`, `lookupAgent`), `prepareRoomFiles()` before any listen (room alone and one box), D209's directories; single-machine.md §3.3's walk (ACL-aware, B52); split: S-SEC-01's `mcp.json` and argv steps go to T35 (B53); B47-B53; the audit-directory/walk conflict is under For the owner. `node --test test/cockpit-security.test.mjs`: pass 24, fail 0; npm test: pass 4459, fail 0 (commit 5ea044e)
- [ ] T8 (build 3, `protocols.md` §2.4, §9, D98, D136) The message checks `server/cockpit/protocol.mjs` (every message of §2.4 in and out, B00's four `show.result` whys) and the fixture test `test/cockpit-protocol.test.mjs` (the fixtures of §9, `test/cockpit/fixtures/`) — ids: none — done when: every §2.4 message has a valid and an invalid fixture case; npm test green.
- [ ] T9 (build 4, `protocols.md` §11.1-§11.5, §11.9, §11.11, §11.12, §13) The bridge `server/cockpit/bridge.mjs` and the Claude Code adapter: launch flags and allowlist (§11.2, D240, D244, review-required), events mapped (§11.4), the prompt's text (§11.5), liveness and limits (§11.9), the `bridge` dialect — ids: none — done when: `test/cockpit-bridge.test.mjs` has the mapping test and the turn test of §13 (§13.1 line by line against the fake agent); npm test green.
- [ ] T10 (build 4, `c1-talk.md` §5.3, `security.md` §5, D211) The redaction module `server/cockpit/redact.mjs` (reply text across deltas, tool input), wired into the bridge's outputs before anything reaches a screen or a file — ids: none (the end-to-end scenario of this module runs in T18) — done when: `test/cockpit-redact.test.mjs` covers every pattern of §5.3 and a token split across three deltas; npm test green; named under `## For the owner` as review-required.
- [ ] T11 (build 5, `protocols.md` §11.6-§11.7, D103, D104) Stop (5.0 s interrupt, 8.0 s forced), restart with `--resume`, sessions start/new, on the room clock — ids: none — done when: `test/cockpit-session.test.mjs` covers stop, forced stop, crash restart and new against the fake agent with the clock `manual`; npm test green.
- [ ] T12 (build 5, `protocols.md` §11.7.1, D154, D155) The conversation on disk (`<stateDir>/cockpit/session.json` and the turns, modes 0600/0700, what is kept and for how long, `security.md` §6) and the store test — ids: none — done when: `test/cockpit-store.test.mjs` (write, reload, a torn write, seeded `stateFiles`) green; npm test green.
- [ ] T13 (build 6, `protocols.md` §2.1-§2.2, `security.md` §2.3, D212) The room link `/api/cockpit/ws` via `ctx.upgrade`: its upgrade checks (review-required, D212), hello, `welcome`, snapshot, prompt in → turn out through the bridge; the board's `/ws` hello gains `cockpit:true` when this process runs a room or `forwarded` (`server/ws.mjs`) — ids: S-SEC-06 — done when: S-SEC-06 passes in `test/cockpit-link.test.mjs` (node:test, board and room in one process); npm test green.
- [ ] T14 (build 6, `protocols.md` §2.2-§2.3, D139) `seq`, resume after a gap, heartbeat and silence, close codes 4403/4503 and the rest of §2.3, the faults hooks on each inbound/outbound message, the control verbs `/link`, `/drop`, `/sent`, `/connections` if T3 left them — ids: none — done when: `test/cockpit-link.test.mjs` gains one case per §2.3 close code, a resume with and without a gap, and silence; npm test green.
- [ ] T15 [ui] (build 7, `c1-talk.md` §1-§2, `screens.md` §4) The harness of slices §2 (`npm install -D --save-exact @playwright/test@<version whose Chromium is in ~/.cache/ms-playwright: chromium-1194>`, the `test:cockpit` script, `e2e/playwright.config.mjs`, `e2e/cockpit/fixtures.mjs` with `room`, `fakeAgent`, `fakeSpeech`, `demoHub`, `clock`/`advance`, `test-results/` and `playwright-report/` in `.gitignore`); the cockpit button `[data-cockpit-open]` on every app view, the pane over the Map, open and close (both `CLOSE`, Esc), its link client in `public/js/cockpit/` (D263), the connecting state, reduced motion — ids: S-C1-02 S-C1-03 S-C1-12 S-C1-26 S-SCR-09 — done when: `npm run test:cockpit -- -g 'S-C1-02|S-C1-03|S-C1-12|S-C1-26|S-SCR-09'` passes, none skipped (S-C1-26 and S-SCR-09 assert the `none` layout); npm test green; stills.
- [ ] T16 [ui] (build 7, `c1-talk.md` §1-§2, `screens.md` §4.1, §9) The pane on the Wall page, the bottom-right corner cluster in the app and on the Wall (every control at its rect, 8 px apart), the one handle of the Wall contract (`screens.md` §9.1-§9.3) — ids: S-C1-01 S-SCR-25 S-SCR-35 — done when: `npm run test:cockpit -- -g 'S-C1-01|S-SCR-25|S-SCR-35'` passes, none skipped (S-SCR-25's talk/language run is C2's, D265); `test/wall-*.test.mjs` green; npm test green; stills of the Wall with the pane open, filmstrip of the 0.2 s open.
- [ ] T17 [ui] (build 7, `c1-talk.md` §1.2, D249, D250) Smaller screens and the browser floor: 1024x768 (pane 608 px), 800x1280 (whole screen, `inert` Map), below the floor and an old browser — ids: S-C1-45 S-C1-46 S-C1-47 — done when: `npm run test:cockpit -- -g 'S-C1-45|S-C1-46|S-C1-47'` passes with only S-C1-46's `show` step skipped (waits for Show); npm test green; stills at 1024 and 800.
- [ ] T18 [ui] (build 8, `c1-talk.md` §3 "Streaming", `protocols.md` §3.1-§3.2) A turn in the pane: the prompt block, the reply streaming in and settling (`data-turn`), the `AGENT`/`YOU` labels, nothing of a secret on the wire or in the room's files — ids: S-C1-04 S-SEC-02 — done when: `npm run test:cockpit -- -g 'S-C1-04|S-SEC-02'` passes, none skipped; npm test green; filmstrip of a reply streaming in.
- [ ] T19 [ui] (build 8, `c1-talk.md` §3 "What a reply may contain", "The cockpit's own lines", D146, D22, D23, D227) The reply renderer `public/js/core/md.js` and `test/md.test.mjs`: tables, code blocks of 12 lines with the rest behind a button, markup shown never run, the coloured marks, the cockpit's own lines a reply cannot imitate — ids: S-C1-05 S-C1-08 S-C1-09 S-C1-11 S-C1-42 — done when: `npm run test:cockpit -- -g 'S-C1-05|S-C1-08|S-C1-09|S-C1-11|S-C1-42'` passes, none skipped; `test/md.test.mjs` green; npm test green; stills dark and light.
- [ ] T20 [ui] (build 9, `c1-talk.md` §4-§5.1, D147) Tool lines: one line per tool with live counts, open to show the calls, a failure grey, parallel calls folded by tool with their ms; the words module `public/js/core/tool-words.js` and `test/tool-words.test.mjs` — ids: S-C1-06 S-C1-07 S-C1-25 S-C1-35 — done when: `npm run test:cockpit -- -g 'S-C1-06|S-C1-07|S-C1-25|S-C1-35'` passes, none skipped; `test/tool-words.test.mjs` green; npm test green; filmstrip of the counts moving.
- [ ] T21 [ui] (build 9, `c1-talk.md` §5.2-§5.3, pending Q-O23) Refused calls as grey `tried` lines (`data-denied`), tools that change things, a secret in a tool's input never on the wire (T10's module) — ids: S-C1-30 S-C1-31 — done when: `npm run test:cockpit -- -g 'S-C1-30|S-C1-31'` passes, none skipped; npm test green; stills.
- [ ] T22 [ui] (build 10, `c1-talk.md` §1.1, §4, §9) Scrolling: the view stays when scrolled up, `↓ NEW`, long replies drawn whole with their age, the stack above the input row (chip slot, line slot, `↓ NEW`) never overlapping — ids: S-C1-10 S-C1-21 S-C1-34 — done when: `npm run test:cockpit -- -g 'S-C1-10|S-C1-21|S-C1-34'` passes, none skipped; npm test green; filmstrip of `↓ NEW`.
- [ ] T23 [ui] (build 11, `c1-talk.md` §7, `protocols.md` §3.1, D228) Typing and sending: Enter sends, Shift+Enter breaks, the input grows to 4 lines, too long cannot be sent, a prompt the room never confirms is not resent, the 11th prompt in a minute is not sent — ids: S-C1-14 S-C1-15 S-C1-18 S-C1-43 — done when: `npm run test:cockpit -- -g 'S-C1-14|S-C1-15|S-C1-18|S-C1-43'` passes, none skipped; npm test green; stills.
- [ ] T24 [ui] (build 11, `c1-talk.md` §7.1) The on-screen keyboard: the input row on its edge, the conversation pinned and keeping 200 px — ids: S-C1-32 S-C1-33 — done when: `npm run test:cockpit -- -g 'S-C1-32|S-C1-33'` passes, none skipped (S-C1-32 asserts the `none` layout); npm test green; stills with the keyboard up (viewport shrunk).
- [ ] T25 [ui] (build 12, `c1-talk.md` §8, `protocols.md` §3.4, pending Q-O1) Sending during an answer: queued, then taken into the same turn; a queued prompt sent once more then shown as not sent; a queued prompt surviving a reload — ids: S-C1-16 S-C1-28 S-C1-29 — done when: `npm run test:cockpit -- -g 'S-C1-16|S-C1-28|S-C1-29'` passes, none skipped; npm test green; filmstrip of a queued prompt being taken.
- [ ] T26 [ui] (build 12, `c1-talk.md` §8, `protocols.md` §3.3) `STOP`: stops, a stuck stop forced after 5 s, a queued prompt dropped and said so — ids: S-C1-17 S-C1-27 — done when: `npm run test:cockpit -- -g 'S-C1-17|S-C1-27'` passes, none skipped; npm test green; stills. **(end of C1a)**
- [ ] T27 [ui] (build 13, `c1-talk.md` §10, `protocols.md` §3.5, §11.4) Errors E1-E8: the agent's process dying mid-turn, each error end with its exact grey message — ids: S-C1-19 S-C1-20 — done when: `npm run test:cockpit -- -g 'S-C1-19|S-C1-20'` passes, none skipped; npm test green; stills of each error row.
- [ ] T28 [ui] (build 13, `c1-talk.md` §10.1, `protocols.md` §11.10, D151, D152) The status line `[data-cockpit-status]` (the highest that holds wins) and the login check (`cockpit.agent.loginCheck`, 900 s / 60 s, login words) — ids: S-C1-37 S-C1-38 — done when: `npm run test:cockpit -- -g 'S-C1-37|S-C1-38'` passes, none skipped (S-C1-37 asserts the `none` layout); `test/cockpit-login.test.mjs` covers the result table; npm test green; stills. Uses Q1's answer if there is one.
- [ ] T29 [ui] (build 14, `c1-talk.md` §11-§12, `protocols.md` §3.6-§3.7, pending Q-O2, Q-O24) A new conversation (asked, then started at once), two pages on one conversation (a second prompt queues), a room restart mid-conversation keeping the turns and the session — ids: S-C1-22 S-C1-23 S-C1-39 — done when: `npm run test:cockpit -- -g 'S-C1-22|S-C1-23|S-C1-39'` passes with only S-C1-22's two-cards step skipped (waits for Canvas); npm test green; stills.
- [ ] T30 (build 14, `screens.md` §6.4, D164-D166) The room's audit lines for prompt, stop and new (without the words) through `server/fleet/audit.mjs`, a prompt refused while the audit log is gone and `STOP` still working — ids: S-SCR-30 S-SCR-31 — done when: `npm run test:cockpit -- -g 'S-SCR-30|S-SCR-31'` passes, none skipped (Q-O21 a) steps are not C1's); npm test green; the audit wiring named under `## For the owner` as review-required.
- [ ] T31 [ui] (build 15, `screens.md` §2) On the Wall: a tap leaves the tour and a minute alone brings it back, opening the pane holds the tour, the pane closes itself after five idle minutes but never during a turn — ids: S-SCR-02 S-SCR-03 S-SCR-04 — done when: `npm run test:cockpit -- -g 'S-SCR-02|S-SCR-03|S-SCR-04'` passes, none skipped; `test/wall-tour.test.mjs` green; npm test green; filmstrip of the hold.
- [ ] T32 [ui] (build 16, `screens.md` §7, §7.1, D11, D263) The room down and back: the line after 5 s with the board going on, a blip under 5 s shows nothing, the screen catches up and the draft is not sent; the time module `public/js/core/cockpit-time.js` (spec `README.md` "Times on the screen") — ids: S-SCR-17 S-SCR-18 S-SCR-19 — done when: `npm run test:cockpit -- -g 'S-SCR-17|S-SCR-18|S-SCR-19'` passes, none skipped (S-SCR-17, -19 assert the `none` layout); a `test/cockpit-time.test.mjs` for the module's table; npm test green; stills.
- [ ] T33 [ui] (build 16, `screens.md` §7) The screen offline, a refused room link (4403, 4503) saying why instead of retrying, the room down since the evening before with the day and the age — ids: S-SCR-23 S-SCR-24 S-SCR-36 — done when: `npm run test:cockpit -- -g 'S-SCR-23|S-SCR-24|S-SCR-36'` passes with only S-SCR-23's canvas-strip step skipped (waits for Canvas); npm test green; stills.
- [ ] T34 [ui] (build 17, `screens.md` §7) The board down: the Wall greys out and says since when; the board never reachable says what is missing and offers the demo — ids: S-SCR-21 S-SCR-22 — done when: `npm run test:cockpit -- -g 'S-SCR-21|S-SCR-22'` passes, none skipped; npm test green; stills.
- [ ] T35 (build 18, `c3-see.md` §1, §3, D58, D260) The MCP server: `127.0.0.1` only, the token (`{stateDir}/cockpit/mcp.token`), Origin refused, the limits and the result rules of §3; `{stateDir}/cockpit-agent/mcp.json`; `booted.mcp()` works (review-required) — ids: S-C3-08, and S-SEC-01's last steps (T7 split, B53) — done when: S-C3-08 passes in `test/cockpit-mcp.test.mjs` (node:test); S-SEC-01 in `test/cockpit-security.test.mjs` gains its `mcp.json` steps (0644, `${LANEBOARD_MCP_TOKEN}`, not the token) and the fake agent's logged `--mcp-config` argv; npm test green; the module named under `## For the owner`.
- [ ] T36 (build 19, `c3-see.md` §4.2, §4.5, §4.6, §5) The tools `morning`, `alerts`, `runs` (on a hub without the patch: `Runs are not available on this hub yet.`, B0), a bad argument never reaching the board, the board down as one sentence at once, an empty board's `sources` — ids: S-C3-05 S-C3-07 S-C3-20 S-C3-23 — done when: the four pass in `test/cockpit-mcp-tools.test.mjs` (node:test); npm test green.
- [ ] T37 [ui] (build 19, `c3-see.md` §7, §10, `security.md` §4) The tools through the pane: one stuck run, one question, two tool lines; an unknown run as an answer; the board going down while the room stays up; an instruction in a fleet field staying data (`sec-inject`) — ids: S-C3-03 S-C3-04 S-C3-22 S-SEC-03 — done when: `npm run test:cockpit -- -g 'S-C3-03|S-C3-04|S-C3-22|S-SEC-03'` passes, none skipped (S-C3-03 against a single board, B0; S-C3-04's node:test part as a step, B2); npm test green; stills.
- [ ] T38 (build 19, `slices.md` §5.1, `c3-see.md` §6) Board changes in fenced files, as patches only: `docs/plans/cockpit/build/patches/T38-hub-runs.diff` (`runs` and `runs/<id>` in `server/hub/read-proxy.mjs`'s `ALLOWLIST`, `GET /api/fleet/runs` fanning out and tagging each row with its builder, its hub test) and `patches/T38-hub-hello-cockpit.diff` (the hub's `/ws` hello `cockpit` field for `forwarded`, D129); each applies cleanly with `git apply --check`; no fenced file changed — ids: none — done when: both patches apply with `git apply --check` on the branch; both named under `## For the owner`; npm test green.
- [ ] T39 (build 20, `protocols.md` §11.8, `c3-see.md` §5, `slices.md` §6) The standing instructions (the written context, the jobs line of slices §6, what to say of a missing source) and "How did the night go?" end to end on `c1-voice` — ids: S-C3-18 — done when: `npm run test:cockpit -- -g 'S-C3-18'` passes; the instructions' text has a `node:test` check in `test/cockpit-instructions.test.mjs`; npm test green.
- [ ] T40 [ui] (build 21, `c1-talk.md` §15, D148) The demo link `?demo=1`: the static page with no room opens the pane on a canned conversation and typing plays a turn (`public/js/core/cockpit-demo.js`, `test/cockpit-demo.test.mjs`) — ids: S-C1-36 — done when: `npm run test:cockpit -- -g 'S-C1-36'` passes; npm test green; stills and a filmstrip of the played turn.
- [ ] T41 [ui] (build 22, D21, D167) The type floor: the text-node walk, no text under 16 px, no instruction under 18 px, in every C1 state of the pane — ids: S-C1-40 — done when: `npm run test:cockpit -- -g 'S-C1-40'` passes (its three voice-state steps are C2's, §3.2, D255: not written yet, not skipped); npm test green.
- [ ] T42 [ui] (build 23, spec `README.md` "Touch", D224) The pressed state in the first frame and `touch-action` on every tappable of the pane, the button and the cluster; the table-driven `e2e/cockpit/pressed.spec.mjs` — ids: S-C1-41 — done when: `npm run test:cockpit -- -g 'S-C1-41'` passes, every row of the table run; npm test green; filmstrip of a press.
- [ ] T43 (done-when, `stand-ins.md` §6) The public demo: `node test/tools/demo-fleet.mjs --cockpit` starts the demo hub plus a room under test on agent script `demo` (and `demo-jobs` seeded), paired at start (`DEMO: paired automatically`), prints the URL; script `test/cockpit/scripts/demo.json` answers `how did the night go`, `what is stuck`, and the no-match line (its `show me vm-b` and countdown answers as the script says, refused as unsupported until Show/Canvas) — ids: none — done when: `test/demo-fleet.test.mjs` or `test/cockpit-demo-fleet.test.mjs` starts `--cockpit` and gets the `how did the night go` reply over the room link; the whole `npm run test:cockpit` passes; npm test green; stills of the demo pane.
- [ ] T44 (done-when, `security.md` §8, `single-machine.md`, `screens.md` §7) `docs/cockpit.md`, its first part: setup on one box and as two users, pairing pending Q-O21 (C1 runs behind the board's trust), troubleshooting the room-down line, the config keys linking `docs/config.md`; README.md links it — ids: none — done when: the file exists with those parts; `test/config-docs.test.mjs` and the hygiene test green; npm test green; the whole `npm run test:cockpit -- -g '<the 73 ids>'` summary line pasted here.

## Scenario ids

73 ids (Q-O21 b, Q-O22 b). No whole test waits (the Wall is merged); `waits:` names a single step
that runs with a later slice, as §3.1 says.

| Id | Title | Task | Test | Waits |
| --- | --- | --- | --- | --- |
| S-C1-01 | The pane opens from the Wall in 0.2 s and leaves the wall in sight (pending Q-O11) | T16 | Playwright | |
| S-C1-02 | Closing: both CLOSE controls and Esc close it, a tap on the wall does not | T15 | Playwright | |
| S-C1-03 | The pane over the Map leaves the Map usable | T15 | Playwright | |
| S-C1-04 | A reply streams in, then settles | T18 | Playwright | |
| S-C1-05 | A table is readable at arm's length | T19 | Playwright | |
| S-C1-06 | Tool calls fold into one line each, with live counts | T20 | Playwright | |
| S-C1-07 | A tool line opens to show its calls; a failure stays grey | T20 | Playwright | |
| S-C1-08 | A long code block shows 12 lines and a button for the rest | T19 | Playwright | |
| S-C1-09 | Markup from the agent is shown, never run or fetched | T19 | Playwright | |
| S-C1-10 | Scrolled up during a reply: the view stays, `↓ NEW` brings it back | T22 | Playwright | |
| S-C1-11 | Only the marks are coloured | T19 | Playwright | |
| S-C1-12 | Reduced motion: the pane appears with no slide | T15 | Playwright | |
| S-C1-14 | Typing: Enter sends, Shift+Enter breaks the line, the input grows to 4 lines | T23 | Playwright | |
| S-C1-15 | Too long a prompt cannot be sent | T23 | Playwright | |
| S-C1-16 | Sending during an answer steers it: queued, then taken into the same turn (pending Q-O1) | T25 | Playwright | |
| S-C1-17 | STOP stops; a stuck stop is forced after 5 s | T26 | Playwright | |
| S-C1-18 | A prompt the room never confirms is not sent again on its own | T23 | Playwright | |
| S-C1-19 | The agent's process dies mid-turn | T27 | Playwright | |
| S-C1-20 | Each error end of a turn has its exact message, in grey | T27 | Playwright | |
| S-C1-21 | A long reply: its age shows, and it is drawn whole | T22 | Playwright | |
| S-C1-22 | A new conversation: asked, then started at once (pending Q-O2) | T29 | Playwright | step: the two cards (Canvas) |
| S-C1-23 | Two pages, one conversation: a second prompt queues, it does not stop | T29 | Playwright | |
| S-C1-25 | Parallel calls fold by tool, end in any order, and show their ms | T20 | Playwright | |
| S-C1-26 | A fresh screen says it is connecting, then never shows a blank pane | T15 | Playwright | |
| S-C1-27 | STOP during a turn drops a queued prompt and says so (pending Q-O1) | T26 | Playwright | |
| S-C1-28 | A queued prompt the agent never reads is sent once more, then shown as not sent (pending Q-O1) | T25 | Playwright | |
| S-C1-29 | A queued prompt survives a reload (pending Q-O1) | T25 | Playwright | |
| S-C1-30 | A shell call is refused and shows as a grey `tried` line (pending Q-O23) | T21 | Playwright | |
| S-C1-31 | A secret in a tool's input never reaches the screen | T21 | Playwright | |
| S-C1-32 | The on-screen keyboard: the input row sits on its edge, the conversation stays pinned | T24 | Playwright | |
| S-C1-33 | Keyboard up with the status line and a long draft: the conversation keeps 200 px | T24 | Playwright | |
| S-C1-34 | Chip, line slot and `↓ NEW` stack without overlapping | T22 | Playwright | |
| S-C1-35 | Tool lines from odd input, and the words module's unit test | T20 | Playwright | |
| S-C1-36 | The static demo: the pane opens on a canned conversation and typing plays a turn | T40 | Playwright | |
| S-C1-37 | A logged-out agent is named before any prompt, and the line goes after the login | T28 | Playwright | |
| S-C1-38 | One status line: the highest that holds wins, news never waits | T28 | Playwright | |
| S-C1-39 | A room restart mid-conversation: the same turns, the same session (pending Q-O24) | T29 | Playwright | |
| S-C1-40 | The type floor: no text under 16 px, no instruction under 18 px (T43, D21, D167) | T41 | Playwright | |
| S-C1-41 | Every tappable shows it was touched in the first frame (T45, D224) | T42 | Playwright | |
| S-C1-42 | A reply cannot pass for the cockpit's own lines (T59, D227) | T19 | Playwright | |
| S-C1-43 | The 11th prompt in a minute is not sent (T59, D228) | T23 | Playwright | |
| S-C1-45 | At 1024x768 the pane is 608 px and the input row is inside the viewport (T77, D249) | T17 | Playwright | |
| S-C1-46 | At 800x1280 the pane is the whole screen and CLOSE is the way back (T77, D249) | T17 | Playwright | step: the `show` of `builder-a` (Show) |
| S-C1-47 | Below the floor and in an old browser the board stays and says why (T77, D250) | T17 | Playwright | |
| S-SCR-02 | A tap leaves the tour, a minute alone brings it back | T31 | Playwright | |
| S-SCR-03 | Opening the pane stops the tour where it is and holds it | T31 | Playwright | |
| S-SCR-04 | The pane closes itself after five idle minutes, never during a turn | T31 | Playwright | |
| S-SCR-09 | The cockpit button on every app view, in the same place as on the Wall (pending Q-O11) | T15 | Playwright | |
| S-SCR-17 | The room goes down: the cockpit says so after 5 s, the board keeps going | T32 | Playwright | |
| S-SCR-18 | A blip under 5 s shows nothing | T32 | Playwright | |
| S-SCR-19 | The room comes back: the screen catches up, the draft is not sent | T32 | Playwright | |
| S-SCR-21 | The hub goes down: the Wall greys out and says since when | T34 | Playwright | |
| S-SCR-22 | The board was never reachable: say what is missing, offer the demo | T34 | Playwright | |
| S-SCR-23 | The screen loses its network | T33 | Playwright | step: the canvas strip (Canvas) |
| S-SCR-24 | A refused room link says why instead of retrying as if the room were down | T33 | Playwright | |
| S-SCR-25 | The corner cluster in the app and on the Wall: every control at its rect, none closer than 8 px | T16 | Playwright | |
| S-SCR-30 | After a prompt and a stop, `laneboard audit` shows each once, without the words | T30 | Playwright | |
| S-SCR-31 | With the audit log gone, a prompt is not sent but `STOP` still works | T30 | Playwright | |
| S-SCR-35 | One handle on every page: what it holds where (Wall contract) | T16 | Playwright | |
| S-SCR-36 | The room down since the evening before: the day and the age say how long | T33 | Playwright | |
| S-C3-03 | One stuck run, one question, two tool lines | T37 | Playwright | |
| S-C3-04 | An unknown run is an answer the agent can use | T37 | Playwright (node part as a step, B2) | |
| S-C3-05 | A bad argument never reaches the board | T36 | node:test | |
| S-C3-07 | The board down: one sentence, at once | T36 | node:test | |
| S-C3-08 | Only loopback, only with the token, never from a browser | T35 | node:test | |
| S-C3-18 | "How did the night go?" on the C1 night: answered from the Morning | T39 | Playwright | |
| S-C3-20 | An empty board: `sources` is empty and the agent says why | T36 | node:test | |
| S-C3-22 | The board goes down while the room stays up: the pane says so | T37 | Playwright | |
| S-C3-23 | "What did last night's run cost?": one `runs` call, a number from the demo | T36 | node:test | |
| S-SEC-01 | The agent's user cannot read the room's secrets, and the room will not start if it could | T7 ✓ (start check, 5ea044e); T35: its `mcp.json`/argv steps | node:test | |
| S-SEC-02 | A secret in a reply never reaches a screen or the room's files, even split across deltas | T18 | Playwright | |
| S-SEC-03 | An instruction in a fleet field stays data: nothing is paired, nothing runs | T37 | Playwright | |
| S-SEC-06 | Without pairing, only the board's own people get the room link (pending Q-O21) | T13 | node:test | |

Check (round 1): 73 rows, 44 `S-C1-`, 16 `S-SCR-`, 9 `S-C3-`, 4 `S-SEC-`; no id twice; every id of
§3.1's `**Scenarios**` list present.

## Research questions

- [x] Q1 → build/research/Q1-claude-auth-status.md. What does `claude auth status` print and exit with today, logged in and logged out (is the command still there, and which of `protocols.md` §11.10's login words appear)? The spec marks the default command and the words pending research Q12 — for T28
- [x] Q2 → build/research/Q2-stream-json-recheck.md. As of Claude Code's current release, do `--output-format stream-json --input-format stream-json` (with partial messages) still emit the event types and fields `protocols.md` §11.4 maps (`system` init with `session_id`, `stream_event` text deltas, `assistant`/`user` blocks with `tool_use`/`tool_result` and `is_error`, `result` with `subtype`), and has any flag of §11.2 been renamed? — for T9

## Later

What the slice itself says waits; nothing else moved here.
- S-C1-22's two-cards step (Canvas slice, `c4-cards` `one-card`/`second-card`), S-C1-46's `show`
  step (Show slice), S-SCR-23's canvas strip (Canvas slice).
- The talk button's half of the ten C1 scenarios of §3.1 (D265), S-SCR-25 with the talk and language
  buttons, and S-C1-40's three voice-state steps: C2 (§3.2).
- The hub patches of T38 (`slices.md` §5.1 and the hub's `cockpit` hello field): applied by the owner
  (fenced `server/hub/*`); until then `runs` on a hub answers `Runs are not available on this hub yet.` (B0).
- The measured run on the real screen (below): the owner's.

## Spec fixes

## For the owner

- Research Q1 (login check): `protocols.md` §11.10 gives `not-logged-in` only for "exit other than 0
  AND output matching the login words". The CLI reference documents `claude auth status` as JSON with
  `authMethod` (`none` when logged out) and "exits 0 if logged in, 1 if not"; a logged-out answer
  probably holds none of the login words, so the check would stay `unknown`. Proposed: for the
  default command, exit 1 alone is `not-logged-in`; the words stay for custom `loginCheck` commands.
  Until decided, build §11.10 as written and pin the real output in a run (see the research file).
- Research Q2 (stream-json recheck): the CLI reference has `--system-prompt-snapshot` (v2.1.257+): the
  system prompt is recorded on a conversation's first request and reused on `--resume`, so a changed
  standing instruction (§11.8) may not reach a resumed session unless `--system-prompt-snapshot off`
  is added to §11.2's argument list. Not verified (section body unread). Owner/builder decision.
- Every `Answer:` in `spec/QUESTIONS.md` is `(open)` at round 1: the night builds the
  recommendations (Q-O21 b, Q-O22 b, Q-O29, Q-O36 and the rest), so C1 is the 73 ids. An answer
  given later changes what §3.1's table says.
- C1's done-when includes "the board change of §5.1 merged with its tests". The hub is fenced for
  this night, so that part can only be met by applying T38's patch in an attended session.
- T6 (review-required): `server/config/cockpit.mjs`'s fatal-at-start lines (D128, D129, D217,
  D241, D245, Q-O36 b), each check commented with its decision; its own tests are
  `test/config-cockpit.test.mjs` (injected users) and `test/cockpit-room.test.mjs` (a real start per
  line). The agent's user is looked up with `getent passwd` (B44).
- T6, two places that disagree: `protocols.md` §11.12 says the fatal line "starts with the key, as
  every config fragment does", and S-ONE-12 says "stderr is exactly the line"; every fragment's
  refusal today is printed as `laneboard: refusing to start — <file>: <line>`. Built as today, the
  exact line after the prefix (B37). Changing it is one line in `server/config.mjs`, for every
  fragment at once.
- T6: the room alone's "every other path is 404" is a wrap of the listener's request handler
  (B41), since `server/http.mjs` (fenced) always serves `public/` and the SPA fallback. A
  `static: false` option there would be the cleaner way; no patch written yet.

- T7 (review-required): the start check `server/cockpit/start-check.mjs` (D209, D210, security.md
  §3), its test `test/cockpit-security.test.mjs` (S-SEC-01, injected stat, then real starts), and
  its call `prepareRoomFiles()` in `server/boot/cockpit.mjs` (also from `server/boot/builder.mjs`
  before the one box listens). Each check names its decision; B47-B53.
- T8: `docs/cockpit/protocol.md` is now the protocol the test reads (D136, B54). `protocols.md` §9
  says its first line should then point to the copy and changes go there only; I left the spec
  untouched (fenced beyond typo fixes). Until that pointer is added, a spec fix in `protocols.md`
  must be made in the copy too, or the two drift.

- T7, two places that disagree (the one box's default layout): security.md §3 / D210 "the audit
  file and its directory … have any group or other bit set" stops the room, and single-machine.md
  §3.3 "walks every directory from `/` to `{stateDir}/cockpit-agent/` … Run: setfacl -m
  u:lb-agent:x". By default the audit file is `{stateDir}/audit.jsonl`, so the audit directory *is*
  `{stateDir}`, the agent must pass through it, and the printed `setfacl` puts `--x` into the group
  bits (the ACL mask), which the start check then refuses. Built strictly as written (D210 is the
  newer decision of the two that word it; the walk is a warning, the check is fatal): with
  `cockpit.agent.user` the default one box warns `cannot enter {stateDir} (mode 0700)`, and the fix
  it prints makes the next start fatal. Ways out, for the owner: (a) the room keeps the audit log
  out of `{stateDir}` when it is a room (`LANEBOARD_AUDIT_FILE` or a `{stateDir}/audit/`
  directory: a change in `server/fleet/paths.mjs`, not fenced but audit-adjacent); (b) D210 allows
  a directory whose only group/other bits are `x` (pass through, no listing; the 0600 files stay
  closed); (c) move `cockpit-agent/` out of `{stateDir}` (D209's overrule). (b) is one line in
  `fileProblems`; I did not take it because D210 says "any".

## Measured on the real screen

- C1: not measured yet

## Reviews

## Scores

## Morning
