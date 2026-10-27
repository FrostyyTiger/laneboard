# Cockpit spec: slices, the build nights in order

One slice per night, each usable the next morning (plan §6.6). A slice lists its scenario ids, the
stand-ins and scripts it needs (`stand-ins.md`), the board changes it makes, and its done-when.
Every `S-` id written so far sits in exactly one slice (§4 is the cross-check). Ids a task has not
written yet are named by their task, never by a guessed number.

Written by T20, with T37 (the harness, §2), T62 (C1 sees the night, §3.1), T80 (the order, §1),
T81 (the jobs slice, §3.7) and T30 (S-C1-13 belongs to C2, §3.2).

## 1. The order

| # | Slice | The next morning the owner can | Needs first |
| --- | --- | --- | --- |
| 1 | **C1** Talk, and see the night | open the pane on the Wall or any app view, type, read streamed replies with tool lines, stop an answer, start a new conversation; ask "how did the night go?" and get an answer from the fleet's Morning, runs and alerts | the Wall merged (`spec-input.md` §8), §2's harness, `stand-ins.md` §7 steps 1-3, the open C1 fixes of §5 |
| 2 | **C2** Voice in | hold or tap the talk button, watch the words appear, release to send; DE/EN; the talk key | C1 |
| 3 | **C3** See, the rest | ask about what is on screen ("what's wrong here?"), hold a node for `ASK ABOUT THIS`; the agent reads `fleet`, `lanes`, `ci`, `history` | C1 |
| 4 | **Speak** The agent speaks up | find a line from the agent that it started itself, a marker on the talk button, the tour holding on the flagged node | C3, `coworker.md` (T13) and T23 written |
| 5 | **Canvas** C4, first canvas night | put the screen in `split` or `canvas` and ask for a countdown, a status tile, a log, a chart, a text or a diff card | Speak (order only; it builds on C3) |
| 6 | **Show** C4 show commands | watch the agent fly the map to a node, highlight, pin, compare, and undo any of it with one tap | Canvas (the show line and `UNDO` exist) |
| 7 | **Jobs** Scheduled jobs on the room's own machine | ask "remind me in 3 hours" and see the countdown on the canvas and the job on the Map; cancel it with one confirm | Canvas; the confirm card (`c5-c6.md` §8, written by T14); Q-O30 answered (written for b) |
| 8 | **C2b** The physical button | press a desk button that talks on a named screen | C2, Q-O8 and Q-O20 answered |
| 9 | **Pair** Pairing screens | pair a second screen others can reach with a code; unpair it | C1, Q-O21 answered b) (with a) this slice folds into C1) |
| 10 | **Canvas 2** | `timer`, `table`, `checklist`, `map` blocks; custom cards in their sandbox; promotion | Canvas, T12 written |
| 11 | **History** | `scrub` to a moment in the past; `compare` two time ranges | Show, the board change of §5.2 reviewed |
| 12 | **C5** Voice out | hear the first sentence of a reply; mute per screen; stop talking | C1; Q-O34 |
| 13 | **C6** Act | approve a change on a confirm card | the control-plane review (plan C6, fenced), T14 |
| 14 | **One** The one box | set up the cockpit on one machine with the agent on its own user (`laneboard cockpit agent-user`), check it with `laneboard cockpit doctor`, run another agent with `kind: bridge` | C1; Q-O36 answered; research Q18 |

- The order follows plan §3 ("C1 → C2 → C3 → C4 → C5 → C6") with three moves the reviews asked for:
  the fleet's night into C1 (review 44 finding 1, T62), the speak-up right after C3 (review 52
  finding 5), and the canvas before the show commands so the first C4 night is the six blocks and
  little else (review 52 finding 11; D114).
- Jobs comes before the rest of C6 (review 52 finding 6, T81; D115). C2b, Pair, Canvas 2, History,
  C5, One wait for owner answers or for files not yet written; their place among themselves is free.
- Under Q-O22 a) (split from C1) four layout scenarios of the Canvas slice move into C1 and the C1
  night grows by about 3 steps; §3.1 lists the ids per answer. Spec written for b) (pending Q-O22).

## 2. The acceptance harness

D88 (Playwright, `npm run test:cockpit`, not in `npm test`) and D113 (where the files sit).

- **Runner**: Playwright Test (`@playwright/test`, a devDependency), Chromium only, headless.
- **Folder**: `e2e/cockpit/<slice>-<topic>.spec.mjs` (e.g. `e2e/cockpit/c1-render.spec.mjs`), config
  `e2e/playwright.config.mjs`. Not under `test/`: `npm test` runs `node --test` with no file list,
  and Node's default patterns include every `.mjs` file under any `test/` folder, so a Playwright
  file there would run under `node:test` and fail (checked on Node 24, round 65). The stand-ins stay
  in `test/cockpit/stand-ins/` and the scripts in `test/cockpit/scripts/` (`stand-ins.md`); each
  stand-in program, started with no arguments, prints its usage and exits 0, as
  `test/tools/demo-fleet.mjs` does under `NODE_TEST_CONTEXT` (D113).
- **Config**: viewport 1368x912, `deviceScaleFactor: 2`, `hasTouch: true`, `timezoneId:
  'Europe/Zurich'` (the spec's `+01:00` times), `locale: 'en-GB'`, `permissions: ['microphone']`,
  launch argument `--use-fake-device-for-media-stream` (the fake speech never reads the audio,
  `stand-ins.md` §3.1, so any frames do), `workers: 1`, `retries: 0`, trace on first failure into
  `test-results/` (ignored by git; the C1 night adds it to `.gitignore`).
- **Fixtures**: `e2e/cockpit/fixtures.mjs` extends `test` with `room` (the room under test,
  `stand-ins.md` §1, one per spec file), `fakeAgent` (§2), `fakeSpeech` (§3), `demoHub`
  (`test/helpers/demo-hub.mjs`) and `clock` (one test clock for page, room and fake speech).
- **Names**: one Playwright test per scenario id, titled with the id and its title as written
  (`test('S-C1-04 A reply streams in, then settles', …)`); cases inside a scenario are
  `test.step`s. A scenario whose `Test:` line says node:test lives in
  `test/cockpit-<topic>.test.mjs`, also titled with its id, and runs in `npm test`.
- **Commands**: `npm run test:cockpit` (all), `npm run test:cockpit -- -g 'S-C1-04|S-C1-05'` (some),
  `npm run test:cockpit -- e2e/cockpit/c1-render.spec.mjs` (one file).
- **Relation to `npm test`**: `npm test` keeps everything that needs no browser: the fixture checks
  (D98), the script checks (`stand-ins.md` §5), the stand-ins' own tests (§7) and the node:test
  scenarios. `test:cockpit` joins `ci` when the `ci` machine has a browser (D88's overrule); until
  then a build night runs it locally per slice (one file at a time) and pastes the summary line into
  `PROGRESS.md`.
- **A slice's done-when** always includes: every scenario id of the slice has exactly one test with
  that id in its title; `npm run test:cockpit -- -g '<the slice's ids>'` passes with none skipped;
  `npm test` stays green; the speed budget rows the slice's scenarios name (`README.md`, B1-B8)
  hold with no slack.

## 3. The slices

### 3.1 C1 Talk, and see the night

**Builds** (one round each, in this order; fix and review rounds come on top):

1. `stand-ins.md` §7 steps 1-3 (fake agent, fake speech, room under test) and step 4 for the C1
   scripts. The fake speech is built and passes its own `node:test` file here; no C1 Playwright
   test starts it (D265).
2. The room process: `server/boot/cockpit.mjs` (`startRoom()` and the `mode: cockpit` wiring),
   the third `MODES` entry, `cockpit.forwarded`, `server/config/cockpit.mjs`,
   `server/cockpit/clock.mjs` and `faults.mjs` (`README.md` "The room process", D128, D129); the
   `mode: cockpit` route test of `protocols.md` §1, with `boot()`'s `mode: 'cockpit'` path
   (`stand-ins.md` §1.1). Written for Q-O29's recommendation (pending Q-O29): a room alone is
   `mode: cockpit` (no collectors, no `/ws`); the one box is `mode: builder` with `cockpit.agent`.
3. The message checks `server/cockpit/protocol.mjs` and the fixture test (D98, `protocols.md` §9).
4. The bridge and Claude Code adapter (`server/cockpit/bridge.mjs`), the mapping and turn tests
   (`protocols.md` §13), the redaction module `server/cockpit/redact.mjs` and its unit test
   (`c1-talk.md` §5.3).
5. Stop, restart and session, the conversation on disk (`protocols.md` §11.6-§11.7.1), their tests and the store test.
6. The room link: hello, resume, snapshot, `seq` (`protocols.md` §2).
7. The page: cockpit button and pane, open and close (`c1-talk.md` §1-§2, `screens.md` §4); smaller screens and the browser floor (§1.2, D249, D250), S-C1-45..47 (S-C1-46's show steps run with the Show slice).
8. The reply renderer `public/js/core/md.js` and `test/md.test.mjs` (`c1-talk.md` §3, D146); the cockpit's own lines (D227), S-C1-42.
9. Tool lines, `tried` lines, tools that change things (`c1-talk.md` §4-§5.2); the words module `public/js/core/tool-words.js` and `test/tool-words.test.mjs` (D147).
10. Scrolling, `↓ NEW`, reduced motion, long replies (`c1-talk.md` §4, §9).
11. Typing and the prompt rate (`c1-talk.md` §7, D228), S-C1-43.
12. Talk during an answer and `STOP` (`c1-talk.md` §8).
13. Errors E1-E8 and the status line with the login check (`c1-talk.md` §10, §10.1; `protocols.md` §11.10), S-C1-37, S-C1-38.
14. New conversation, two pages (`c1-talk.md` §11-§12).
15. On the Wall: tour hold and idle close (`screens.md` §2).
16. Room down and back, screen offline (`screens.md` §7).
17. Board down (`screens.md` §7).
18. The MCP server: loopback, token, limits (`c3-see.md` §1, §3).
19. `morning`, `alerts`, `runs` (`c3-see.md` §4.2, §4.5, §4.6) and the hub's runs route (§5.1).
20. The standing instructions (`protocols.md` §11.8), S-C3-18 end to end.
21. The demo link (`c1-talk.md` §15, D148), S-C1-36.
22. The type floor (D21, D167): the text-node walk, S-C1-40 (its voice states run in C2, §3.2, D255).
23. The pressed state and `touch-action` of every tappable (`README.md` §"Touch", D224), S-C1-41's
    table-driven test; later slices append their rows.

**Stand-ins and scripts**: room under test, fake agent (dialect `claude`), demo hub; scripts
`c1-render`, `c1-typing`, `c1-errors`, `c1-login`, `c1-long`, `c1-session`, `c1-voice` (S-C3-18), `scr-room`,
`c3-tools` (S-C3-03, S-C3-22, S-C3-23). No fake speech yet: every C1 test boots the room with
`"stt":{"url":"none"}` (`stand-ins.md` §1.1, D265), so no talk button is drawn. Where a C1
scenario names the talk button (its rect, `enabled`, `data-talk`), the C1 test asserts the `none`
layout in its place (`screens.md` §4.1: no `[data-talk]`, `SEND` in the talk button's rect, the
input to 16 px left of it; at 1024 and 800 wide the same shift, `SEND` x 936-1000 or x 712-776)
and nothing about the talk button; the talk button's half runs in C2 (§3.2). These are S-C1-01,
S-C1-26 (its empty line is the `none` variant), S-C1-32, S-C1-37, S-C1-45, S-C1-46, S-SCR-09, S-SCR-17, S-SCR-19 and S-SCR-25's second case.

**Scenarios** (73):
S-C1-01 S-C1-02 S-C1-03 S-C1-04 S-C1-05 S-C1-06 S-C1-07 S-C1-08 S-C1-09 S-C1-10 S-C1-11 S-C1-12
S-C1-14 S-C1-15 S-C1-16 S-C1-17 S-C1-18 S-C1-19 S-C1-20 S-C1-21 S-C1-22 S-C1-23 S-C1-25 S-C1-26 S-C1-27 S-C1-28 S-C1-29 S-C1-30 S-C1-31 S-C1-32 S-C1-33 S-C1-34 S-C1-35 S-C1-36 S-C1-37 S-C1-38 S-C1-39 S-C1-40 S-C1-41 S-C1-42 S-C1-43 S-C1-45 S-C1-46 S-C1-47
S-SCR-02 S-SCR-03 S-SCR-04 S-SCR-09 S-SCR-17 S-SCR-18 S-SCR-19 S-SCR-21 S-SCR-22 S-SCR-23 S-SCR-24 S-SCR-25 S-SCR-30 S-SCR-31 S-SCR-35 S-SCR-36
S-C3-03 S-C3-04 S-C3-05 S-C3-07 S-C3-08 S-C3-18 S-C3-20 S-C3-22 S-C3-23
S-SEC-01 S-SEC-02 S-SEC-03 S-SEC-06

- S-SEC-01 (the start check and the agent's files, D209, D210), S-SEC-02 (reply redaction, D211,
  with step 4's redaction module), S-SEC-03 (an instruction in a fleet field) and S-SEC-06 (the link
  without pairing, D212, pending Q-O21) are C1's (T17); step 2 gains the start check.
- S-SCR-30 and S-SCR-31 (the audit lines, T60) are C1's: prompt, stop and new are; their
  `Under Q-O21 a)` steps run with the Pair slice.
- S-SCR-35 (the handle, `screens.md` §9, T31) is C1's: its app steps run from the first night,
  its Wall steps once the Wall merges (§9.3).
- S-SCR-24 (a refused room link, T89) is C1's: 4403 and 4503 can happen without pairing.
- S-SCR-25 (the corner cluster, T44) is C1's with `stt.url: none`; its run with the talk and
  language buttons is asserted once C2 is built.
- S-SCR-36 (the room down since the day before, T65) is C1's, with the time module's table
  (`README.md` §"Times on the screen").
- S-SCR-17, S-SCR-19 and S-SCR-23 are C1's: the pane's status line and the wall half. The canvas
  half of room down is S-C4-23 (Canvas) and S-C4-24 (Jobs) since T52 (D120); S-SCR-23's strip text
  is asserted once the Canvas slice is built.
- **Does C1 see the fleet?** Yes: `morning`, `alerts` and `runs`, enough for "how did the night
  go?", "what is stuck?", "what did last night's run cost?" (T62). It cannot answer "what's wrong
  here?" (`focus` is C3) and reads no node's health beyond what `morning` and `alerts` carry; asked,
  the agent says what it lacks, as `c3-see.md` §5's standing instructions make it say of a missing
  source.
- **Fits one night**: 23 build steps against the stand-ins' four (`stand-ins.md` §7), each step
  closing on its own tests. If the night ends early, steps 18-23 move to the next night ahead of C2,
  and C1's done-when is met then; nothing of C2 starts before.
- Wall not merged at the C1 night: the scenarios that need it (S-C1-01, S-SCR-02, S-SCR-03,
  S-SCR-04, S-SCR-21, S-SCR-22) stay in C1 and run once the Wall merges; everything else runs on the
  app (`#/map`), as the Wall contract's fallback asks (`screens.md` §9.3). The night's summary says which ids waited.
- **C1's ids under each answer** (the 73 above are for Q-O21 b) and Q-O22 b), the recommendations; 44 `S-C1-`, 16 `S-SCR-`, 9 `S-C3-`, 4 `S-SEC-`):

| Q-O21 | Q-O22 | C1 also contains | Ids |
| --- | --- | --- | --- |
| b) | b) | nothing more; the page is `wall` only, no pairing (`screens.md` §1, §6) | 73 |
| b) | a) | S-SCR-01 S-SCR-06 S-SCR-10 S-SCR-11: `split` by default, the `SCREEN` sheet, the empty canvas; S-SCR-10's `?demo=1` cards are asserted once Canvas is built. S-SCR-07 and S-SCR-08 stay in Canvas (they need `place`) | 77 |
| a) | b) | S-SCR-13 S-SCR-14 S-SCR-15 S-SCR-16 S-SCR-27 S-SCR-28 S-SCR-29 S-SCR-33 S-SCR-37 S-SEC-04 (§3.8's ten; S-SCR-37 only under Q-O27 a), else 82); the Pair slice goes | 83 |
| a) | a) | both rows | 87 |


**Done-when**: §2's slice rule for the ids of the row above that the owner's answers select (73 for the recommendations); the board change of §5.1 merged with its tests;
the first part of `docs/cockpit.md` (setup on one box and as two users, pairing pending Q-O21,
troubleshooting the room-down line); the demo (`stand-ins.md` §6) answers `how did the night go`, and the static demo passes S-C1-36 (`c1-talk.md` §15).
- **Last: one measured run** (T106, D256; a number for the owner, not a test gate): on the real
  screen at 1368x912, the real room, the real agent, `stt.url: none`. A fresh conversation, the
  typed prompt `How did the night go?`, `SEND`. Read in the remote devtools console
  `performance.getEntriesByName('cockpit:B9', 'measure')[0].duration` and paste it, in seconds with
  one decimal, into the C1 row of `PROGRESS.md` §"Measured on the real screen". A build night has
  no real screen (it runs on a VM with no LAN): it writes the row as `not measured yet` and the
  done-when is met; the owner's first run fills it. Over 15 s fails nothing (`README.md` B9).

### 3.2 C2 Voice in

**Builds**: audio capture and the `AudioWorklet` (D96); the room's speech client (`protocols.md`
§12, D107); the talk button states (`c2-voice.md` §2-§3); live words; fix and cancel; DE/EN; limits;
`stt-down`/`stt-failed`; the talk key; the insecure-page line. About 12 steps.

**Stand-ins and scripts**: as C1, plus the fake speech; scripts `c2-tap`, `c2-limits`, `c2-faults`,
`c2-agent`, `c1-voice`.

**Scenarios** (25):
S-C2-01 S-C2-02 S-C2-03 S-C2-04 S-C2-05 S-C2-06 S-C2-07 S-C2-08 S-C2-09 S-C2-10 S-C2-11 S-C2-12
S-C2-13 S-C2-14 S-C2-15 S-C2-16 S-C2-17 S-C2-20 S-C2-21 S-C2-22 S-C2-23
S-C1-13 S-SCR-20 S-SCR-32 S-SEC-05

- **S-C1-13** (hold the button on the touring Wall) keeps its id and belongs to C2, not C1: it
  needs the microphone and the fake speech (T30). C1's done-when does not contain it.
- **S-SCR-20** (the room goes away mid-reply and mid-speech) is C2's because its second half needs
  an open microphone.
- **S-SCR-32** (room down on the Wall: the away caption, a press on the `off` talk button opens the
  pane, no microphone) is C2's: C1 runs with `stt.url: none`, so it has no talk button (D179).
- **The talk button's half of ten C1 scenarios** (§3.1's list, D265): each of those C1 tests
  gains one `test.step('with voice', …)` that boots the room with the fake speech
  (`"stt":{"url":speech.url,"language":"de"}`, `stand-ins.md` §1.1) and asserts the talk button
  as the scenario writes it (rect, `enabled`, `data-talk`; S-C1-26's empty line `Nothing said yet.
  Type a question, or hold the talk button and speak.`); nothing is pressed. The C2 run's `-g`
  adds the ten ids, and none of the ten steps is skipped.

**Done-when**: §2's slice rule for the 25 ids; B1-B3 hold; `docs/cockpit.md` gains the speech
service setup and the kiosk microphone note (`c2-voice.md` §12). Two checks are named because a
C2 night can pass the 25 ids and still miss them (D255, review 73-owner.md findings 4, 8):
- **The type floor in the voice states** (T43, D21, D167): S-C1-40's C1 test gains three
  `test.step`s, the hold past 400 ms, the slide off and `stt-down` with `token` (S-C1-40's last
  paragraph); the C2 run is `-g '<the 25 ids>|S-C1-40|<§3.1's ten ids>'` and none of the seven steps is skipped.
- **The hint after a limit stays** (T84, D168): S-C2-06 asserts `MICROPHONE OFF` at 35 s and
  290 s and `MICROPHONE OFF · TEXT KEPT` at 126 s, and S-C2-05's 5 s close still goes; a C2 build
  that gives every close D45's 5 s fails S-C2-06, not only a review.
- **Last: one measured run** (T106, D256; a number for the owner, not a test gate): as C1's (§3.1),
  with the real speech service and the talk button: hold the button, say `How did the night go?`,
  let go. Paste three numbers from the same turn into the C2 row of `PROGRESS.md` §"Measured on the
  real screen": `cockpit:B2` (first word), `cockpit:B3` (prompt block) and `cockpit:B9` (first
  reply sentence), each `performance.getEntriesByName('cockpit:B<n>', 'measure')[0].duration` in
  seconds with one decimal. Over B2's 1.0 s or B3's 0.3 s fails nothing either: on real hardware
  these rows are measured, not promised (`README.md`, "Real hardware").

### 3.3 C3 See, the rest

**Builds**: `fleet`, `lanes`, `ci`, `history` (`c3-see.md` §4); `focus` from the page and the tool
(§8); the hold menu and the context chip (§9); the T63 stale-feed and board-unreachable lines once
written. About 9 steps.

**Stand-ins and scripts**: as C1; script `c3-tools`; the demo feed writer for S-C3-02 and S-C3-06.

**Scenarios** (14):
S-C3-01 S-C3-02 S-C3-06 S-C3-09 S-C3-10 S-C3-11 S-C3-12 S-C3-13 S-C3-14 S-C3-15 S-C3-16 S-C3-17 S-C3-19 S-C3-21

- S-C3-14 needs two screens on one conversation; under Q-O21 b) two pages behind the board's trust
  are enough (`c1-talk.md` §12).
- Planned here: T63's scenarios (stale feed with its age, board unreachable, run cost); T78's empty
  board scenario.

**Done-when**: §2's slice rule; `c3-see.md` §6's other gaps listed as follow-ups in `PROGRESS.md`.

### 3.4 Speak: the agent speaks up

**Builds**: the room's watcher of alerts, Morning and Stuck; agent-started turns; the marker on the
talk button (pending Q-O11); the `SINCE YOU LOOKED` divider (`c1-talk.md` §2.1, D233); quiet hours and per-kind mute.

**Builds also** (`coworker.md` §7-§8): the infra repo pull and the `infra` tool, the Map drift
trigger, the repo drift check; the `speakup` message and the speak-up's `turn.prompt` (`protocols.md` §3.9).

**Scenarios** (15): S-CW-01 S-CW-02 S-CW-03 S-CW-04 S-CW-05 S-CW-06 S-CW-07 S-CW-08 S-CW-09
S-CW-15 S-CW-16 S-CW-17 S-CW-18 S-SCR-34 S-C1-44. Control verbs `POST /alarms`, `POST /tick` and
script `cw-speak` (`stand-ins.md` §1.2, §5). The touring-screen hold (`screens.md` §2.1) needs `flyTo(id)`,
a node lookup and the idle hook of the Wall contract (`screens.md` §9): this slice builds them, Show reuses them.

**Done-when**: §2's slice rule for these ids and S-C1-44; Q-O5 answered.

### 3.5 Canvas: C4, first canvas night

**Builds**, and nothing else (review 52 finding 11): the layouts `split`, `canvas`, `switch`, the
`SCREEN` sheet and `cockpit.layout` (`screens.md` §1, pending Q-O22); the card area, grid and shelf
(`c4-show-canvas.md` §7); `place` and `replace` with their show lines and `UNDO` (§4, D82); the six
blocks of D83: `countdown` (to a moment; bound to a job is Jobs'), `status`, `log`, `chart`,
`text`, `diff`; taps inside a card and the `+ 37 MORE` row (§8.10, D253/D254); removal and the 16-card cap (§9); `cards.json` (D85); the canvas half of room down
(`c4-show-canvas.md` §7.6, D120).

**Stand-ins and scripts**: as C1; script `c4-cards`.

**Scenarios** (18):
S-SCR-01 S-SCR-06 S-SCR-07 S-SCR-08 S-SCR-10 S-SCR-11 S-SCR-26
S-C4-14 S-C4-15 S-C4-16 S-C4-17 S-C4-18 S-C4-19 S-C4-20 S-C4-21 S-C4-22 S-C4-23 S-C4-35

- An unbuilt block (`timer`, `table`, `checklist`, `map`) is an `isError` naming the six (D83).
- B6 holds for `place`.

**Done-when**: §2's slice rule for the 18 ids; the sketch `sketches/c4-canvas.html` is what the
owner sees at 1368x912 in `canvas`, apart from the job countdown.

### 3.6 Show: C4 show commands

**Builds**: one camera with the tour (`c4-show-canvas.md` §2, needs the Wall contract, `screens.md` §9.2);
`fly_to`, `highlight`, `clear`, `pin`, `compare`; `scrub` as the error of D75; the finger-wins rule
(D70); undo across screens (D71).

**Stand-ins and scripts**: as C1; script `c4-show`.

**Scenarios** (14):
S-C4-01 S-C4-02 S-C4-03 S-C4-04 S-C4-05 S-C4-06 S-C4-07 S-C4-08 S-C4-09 S-C4-10 S-C4-11 S-C4-12
S-SCR-05 S-SCR-12

- **S-C4-12** (`scrub` before the board has history) stays here: it tests the `isError` answer,
  which this slice builds. The real `scrub` is History's (§5.2).

**Done-when**: §2's slice rule; B5 holds.

### 3.7 Jobs: scheduled jobs on the room's own machine

The coworker's own example, "shut this off in 3 hours" (`spec-input.md` §3), before the rest of C6
waits on a review with no date (review 52 finding 6).

**Builds**: the room's job list and runner (`<stateDir>/cockpit/jobs.json`); a job is created by an
MCP tool only after a confirm card (`c5-c6.md` §8) and cancelled the same way; each create, fire
and cancel writes an audit line; the job shows on the Map at its target and as a `countdown` bound
to it (`CANCEL JOB`); the bridge's refusal line goes (§6).

**What a job may do in this slice** (D115, pending Q-O30): remind (at the time, an agent-started
line and a card) or run a script the room's config lists under `cockpit.jobs.scripts`. The script
runs on the room's own machine and may touch other machines (the demo's `stop-vm-c` stops `vm-c`):
the owner wrote and listed it, so the list is the owner's standing yes for that command
(`coworker.md` §6.2, D191). Each create and each cancel needs a yes on the confirm card; each
create, fire and cancel writes one audit line (`coworker.md` §6.8). Asked to stop `builder-b` at
15:10 with `stop-builder-b` listed, the agent says `I can run stop-builder-b at 15:10. Confirm?`
and opens the card. With no listed script for it, the agent says
`I can remind you at 15:10, but stopping builder-b needs a script you list (cockpit.jobs.scripts) or the act step (C6).`
(`coworker.md` §6.3). Under Q-O30 a) a listed script may touch only the room's own machine, and the
first line becomes that second one for every other machine.

**Scenarios** (12): S-C4-13 S-C4-24 S-CW-10 S-CW-11 S-CW-12 S-CW-13 S-CW-14 S-C6-01 S-C6-02
S-C6-03 S-C6-04 S-C6-05. The confirm card is `c5-c6.md` §8. The job format, tools, firing and audit lines are `coworker.md` §6.

**Done-when**: §2's slice rule; `job-0003` of the demo (D112) is created through the real path.

### 3.8 C2b, Pair, Canvas 2, History, C5, C6

| Slice | Scenarios | Waits for |
| --- | --- | --- |
| C2b | S-C2B-01 S-C2B-02 | Q-O8, Q-O20 (D55) |
| Pair | S-SCR-13 S-SCR-14 S-SCR-15 S-SCR-16 S-SCR-27 S-SCR-28 S-SCR-29 S-SCR-33 S-SCR-37 S-SEC-04 | Q-O21 b) (under a) these ten are C1's and C1 grows by about 5 steps); Q-O27 (under b) or c) S-SCR-37 and `screens.md` §6.5 go) |
| Canvas 2 | S-C4-25 S-C4-26 S-C4-27 S-C4-28 S-C4-29 S-C4-30 S-C4-31 S-C4-32 S-C4-33 S-C4-34 | T12 written; Q-O32 answered (with c) the custom-card part waits) |
| History | none written; planned with §5.2 | the board change of §5.2 |
| C5 | S-C5-01 S-C5-02 S-C5-03 S-C5-04 S-C5-05 S-C5-06 S-C5-07 | Q-O34; T128 (messages, fake voice service) |
| C6 | S-C6-06 S-C6-07 | the control-plane review, Q-O7, Q-O35; fenced for unattended work |
| One | S-ONE-01 S-ONE-02 S-ONE-03 S-ONE-04 S-ONE-05 S-ONE-06 S-ONE-07 S-ONE-08 S-ONE-09 S-ONE-10 S-ONE-11 S-ONE-12 S-ONE-13 S-ONE-14 S-ONE-15 S-ONE-16 | C1; Q-O36 (under a) S-ONE-02's first step changes to a warning; under c) `allowSameUser` goes); research Q18 (`sudo` relaying signals, D214); the admin status route of `single-machine.md` §5; the bridge's allowlist check (`protocols.md` §11.11, D240) |

`S-SEC-` (T17) and `S-ONE-` (T19) ids go to the slice whose code they test, written into this file
by the task that writes them.

## 4. Cross-check: every id, once

| Ids | Slice |
| --- | --- |
| S-SCR-01, 06, 07, 08, 10, 11, 26 | Canvas |
| S-SCR-02, 03, 04, 09, 17, 18, 19, 21, 22, 23, 24, 25, 30, 31, 35, 36 | C1 |
| S-SCR-05, 12 | Show |
| S-SCR-13, 14, 15, 16, 27, 28, 29, 33, 37 | Pair |
| S-SCR-20, 32 | C2 |
| S-C1-01..12, 14..23, 25..43, 45..47 | C1 |
| S-C1-13 | C2 |
| S-C2-01..17, 20..23 | C2 |
| S-C2B-01, 02 | C2b |
| S-C3-03, 04, 05, 07, 08, 18, 20, 22, 23 | C1 |
| S-C3-01, 02, 06, 09..17, 19, 21 | C3 |
| S-C4-01..12 | Show |
| S-C4-13, 24 | Jobs |
| S-C4-14..23, 35 | Canvas |
| S-C4-25..34 | Canvas 2 |
| S-CW-01..09, 15..18; S-SCR-34; S-C1-44 | Speak |
| S-CW-10..14 | Jobs |
| S-C5-01..07 | C5 |
| S-C6-01..05 | Jobs |
| S-C6-06, 07 | C6 |
| S-SEC-01, 02, 03, 06 | C1 |
| S-SEC-04 | Pair |
| S-SEC-05 | C2 |
| S-ONE-01..16 | One |

Retired ids, in no slice and never reused: S-C1-24 (T50), S-C2-18 and S-C2-19 (now S-C2B-01/02,
D55). 218 live ids in all (counted round 144, T111; the last new ids were S-C4-34/35 by T99). The
slice headings add up to it: C1 73, C2 25, C3 14, Speak 15, Canvas 18, Show 14, Jobs 12, and §3.8's
C2b 2, Pair 10, Canvas 2 10, C5 7, C6 2, One 16.

The check a round runs after changing any scenario: every id that `grep -ohE
'S-(SCR|C1|C2|C2B|C3|C4|CW|C5|C6|SEC|ONE)-[0-9]+' spec/*.md | sort -u` prints is either retired
above or appears in exactly one `**Scenarios**` list or §3.8 row of this file. One more string
matches and is no id: `S-C2-24`, named only in D255's overrule.

## 5. Board changes the slices make

Code outside the room's own modules (`server/cockpit/`), each in a reviewed module with its own
tests; the slice's done-when names it.

### 5.1 Runs on a hub (C1)

`c3-see.md` §6: `runs` and `runs/<id>` join the read proxy's `ALLOWLIST`
(`server/hub/read-proxy.mjs`), and a hub route `GET /api/fleet/runs` fans out to every builder and
tags each row with its builder. Until it exists `runs` on a hub answers `Runs are not available on
this hub yet.`, and S-C3-03 runs against a single board.

### 5.2 Stored map history, what `scrub` waits for (History)

D75 and `c4-show-canvas.md` §3.6: the board keeps only its last 80 map events in memory. History
adds snapshots on disk and `GET /api/map?at=<ISO time>` (the map as it was, or 404 before the first
snapshot), its own review, then `scrub` and `compare` over time ranges (D74). Until then S-C4-12's
`isError` answer stands, and it stays in Show.

## 6. What the agent says before a slice brings it

The standing instructions (`protocols.md` §11.8) carry one line until the Jobs slice replaces it with
§11.8's two Jobs lines:

`You cannot schedule, run or cancel jobs yet. If asked, answer: I cannot schedule jobs yet (slice Jobs).`

The owner sees `I cannot schedule jobs yet (slice Jobs).`, in the agent's reply. With Q-O23 a)
nothing else of the agent's acts; asked to stop or start something, it says what it read and that
changing it needs C6 (`c1-talk.md` §5).

## 7. Open fixes before a C1 night

These tasks change what C1 builds; a C1 build night starts only when they are done (or the owner
says go without them). Open at round 144 (T111), from `PROGRESS.md`'s task list:
- Stand-ins and test config: T112 (the MCP port `0`), T113 (the fake agent's log lines), T118
  (`stt.url: none` in C1, S-C1-26), T129 (the test config's `allowSameUser`, the start refusal).
- Talk (`c1-talk.md`): T114 (the forced stop's string, S-C1-17), T116 (E9 `too-many`), T121 (the
  slot after a send, S-C1-16, pending Q-O1 s1), T122 (two prompts at once, S-C1-23), T123 (the
  `QUEUED` label size), T124 (`EDIT` brings the keyboard, S-C1-18).
- Room link and screens: T115 (the retry delays, S-SCR-19), T126 a) (the `CLOSE` label in the
  48 px opener).
- Words and sketches: T119 ("stand-in room" wording), T120 (the queued block in `c1-pane.html`,
  `mode: cockpit`), T125's second half (the queued block in T94's 1368x532 scenario).

Done and no longer blocking: T26, T27, T29, T41, T44 (the button, pane and corner-cluster rects),
T56 (pairing refusals and cross-site checks, `screens.md` §6.1-§6.3), T57, T89, T108-T110. The
bridge (`protocols.md` part 2, T16) and the stand-ins (`stand-ins.md`, T18) it builds on are
written. For C2: T125 (the turn cells, `c2-states.html#turn`, round 157), T42/T95, T84, T69, T58 and
T78 are done.
