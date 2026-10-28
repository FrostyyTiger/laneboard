# Review, round 23: spec-keeper

Scope: the tasks ticked since review 18 (T15 13eb0f7, T16 57062b0, T16b c75c7d0). Read: each
scenario's Given/When/Then and `Test:` line (S-C1-01, S-C1-02, S-C1-03, S-C1-26, S-SCR-09,
S-SCR-35), the three spec files under `e2e/cockpit/`, `fixtures.mjs`, `public/js/cockpit/*`,
`public/js/core/cockpit-constants.js`, B107-B129, spec README "Selectors tests use", D116, D118,
D150, D221, D222, D263, D265, D267, D287, screens.md §9.2. Shots: `r20-pane/`, `r21-wall-*`,
`r21-wall-open/` (filmstrip), `22-handle/`. No new shots made: `22-handle` is from the handle's
own commit (18:35) and the handle draws nothing.

## Findings, worst first

1. **S-C1-01's 200 ms (B7) is proven only with the galaxy at a quarter of its pixels.**
   `e2e/cockpit/c1-wall.spec.mjs:14` opens `galaxy.html?ratio=0.5` (B122). B122 itself says that at
   the test's real ratio the pane was in place 215-238 ms after the tap, and at 0.5 it is 155-200 ms
   (8 of 8 ≤ 200, the worst exactly on the limit). The scenario's Given is "a screen in `wall`
   layout touring", nothing about a lowered ratio. So B7 on the Wall page is not proven: the test
   changes the Given until the number passes. That is a loosening, logged as a builder choice, not
   sent to the owner. Why it matters: B7 is a speed budget, and the slower the Wall draws, the
   later the pane; the real screen may or may not have the GPU B122 assumes.
   Fix: move B122 under `## For the owner` (a speed budget measured under a changed Given); add a
   line "B7 on the Wall page at full ratio" to `## Measured on the real screen`; keep a second,
   recorded (not asserted) measurement at ratio 1 in the test's output so each run shows the gap.
   Also: the filmstrip `r21-wall-open/perf.json` reports `worstGapMs` 4882. No note says where that
   gap is. Check that it is film.mjs's start and not a frame on the Wall.

2. **D287 says the room imports the C1 constants; the build keeps two copies (B109).**
   `server/cockpit/session.mjs:35-49` defines `STOP_FORCE_MS`, `STOP_TERM_MS`, `STOP_KILL_MS`,
   `RESTART_STEPS_S`, `READY_WAIT_MS`, `NEWS_MS`; `server/cockpit/link.mjs:62` defines
   `HEARTBEAT_MS`; `server/boot/cockpit.mjs:33` defines `COCKPIT_PREFIX`. All of them are also in
   `public/js/core/cockpit-constants.js`. D150 ("the room imports the same file") and D287
   ("imported by the room for its own times") are written decisions, not silence. B109 overrides
   them. The values agree today; nothing keeps them in step.
   Fix: a task that imports the names in `server/cockpit/*` and `server/boot/cockpit.mjs`, or a
   node:test that asserts each room constant equals the client's. Until then, list B109 under
   `## For the owner` as a departure from D287.

3. **A new copy of the idle minute on the client.** `public/js/cockpit/wall-hold.js:11`
   `PANE_CLOSED_IDLE_MS = 60_000`. That is D150's `EXPLORE_IDLE_S = 60` (screens.md §2's minute).
   D150 wants every tunable in the one file. Fix: `EXPLORE_IDLE_S * 1000` from
   `cockpit-constants.js`.

4. **S-C1-02: "with the camera moved to the tap" is not checked at (400, 480).**
   `c1-wall.spec.mjs:114-130`. The literal tap at (400, 480) checks only `open` and `explore`; the
   camera step taps a different point (the held site, B121). B121's reason is sound (the galaxy's
   empty sky has no "fly to tap"). But the scenario then asks for something the Wall does not do.
   That is a spec question, not a builder choice. Fix: keep the test and move B121 under
   `## For the owner`, quoting S-C1-02 ("taps the map at (400, 480) … camera moved to the tap")
   and the Wall's tap rule (only a site flies). The owner either rewrites the step or asks the Wall
   for it.

5. **S-C1-26 step 2 stops short: "stays until a prompt is sent" is not tested.**
   `c1-pane.spec.mjs:210-220` asserts the empty line and stops. No prompt is sent, so the "until"
   half is unproven. SEND sends nothing before T18 (B111), so this cannot pass today. But the
   PROGRESS line ticks S-C1-26 without saying a part is left. Fix: add to T18's task line "and
   S-C1-26's empty line gone after the first prompt (step 2's second half)", and extend the test
   then.

6. **S-C1-26 step 1: the 0.5 s open is not held.** `c1-pane.spec.mjs:178-180` waits up to 0.5 s
   but taps late, without a check, when the load took longer. The scenario's timeline (open at
   0.5 s, welcome at 2 s) then shifts silently. Fix: `expect(await pageMs(page)).toBeLessThan(700)`
   just after the tap, so a slow load fails loudly instead of testing another timeline.

7. **S-C1-26's "outbound fault hook" is replaced by a page-side hold (B113).**
   `fixtures.mjs:114` holds the frame with `routeWebSocket`. The scenario names the room's
   outbound hook (stand-ins.md §1.1), and the control API has no delay verb (stand-ins.md §1.2,
   only `/drop`). That is a gap between two spec files. The page-side hold is a fair stand-in, but
   it holds every frame after `welcome` too, so it is not the same fault. Fix: a spec question
   under `## For the owner` ("add `POST /hold {type, ms}` to stand-ins.md §1.2, or rewrite S-C1-26's
   Given to the page side"). Keep B113 until the owner answers.

8. **The tests read the conversation's text through a class the spec does not name.**
   `c1-pane.spec.mjs:182, 201, 217` and `c1-wall.spec.mjs:44` use `.ck-convo`. Spec README
   "Selectors tests use": "a name used in a spec or a test that is not in this table is a bug in the
   spec". `[data-cockpit-conversation]` holds the header and the input row too, so S-C1-26's
   "the conversation shows exactly …" has no selector of its own. Fix: a spec question for the
   owner (a `[data-cockpit-scroll]` row, or "the conversation" defined as an element under
   `[data-cockpit-conversation]`). Log the stand-in `.ck-convo` as a B-line until then. S-C1-03's
   inspector selector `'#shell-insp, .shell-insp, [data-insp-panel]'` (`c1-pane.spec.mjs:127`)
   guesses three names. It should name the one the shell draws.

9. **S-SCR-35 runs without its Given's `?demo=1` (B129), and no later task is told to add it.**
   `c1-handle.spec.mjs:15` opens `/#/map`. B129 says the demo page is T40. T40's task line in
   PROGRESS.md does not mention S-SCR-35. Fix: add "S-SCR-35 re-run with `?demo=1`" to T40's
   done-when.

10. **screens.md §9.2's "who builds what" and S-SCR-35 disagree; the build picked one without
    saying so to the owner.** §9.2: "M6 with C3; M1, M5, M7 with Speak; M2-M4 and M8 with Show".
    S-SCR-35 (C1, slices.md §3.1 "its app steps run from the first night") calls `flyTo`, `camera()`,
    `screenOf` and `nodeAt`. T16b built M1, M3, M5 and M6 now. That is the right reading: slices.md
    §3.1 is the later and more specific text. But it is a spec contradiction. Fix: put it under
    `## For the owner` with both places quoted, so §9.2's table gets its one D-line.

11. **B127: the handle maps `builder-a` to the Map's `builder:builder-a`.** The spec's M5/M6 say
    "the id"; S-SCR-35 uses `builder-a`, the Map uses `builder:<id>`. B127 is logged and reversible.
    But it decides which ids every later camera test (C3, C4) uses, which makes it a one-way choice
    in practice. Fix: also list it under `## For the owner`.

## Where the build and the spec disagree

- B122 (ratio 0.5): the spec is right. A budget is proven under the scenario's Given, or measured
  on the screen; the owner decides if a software-GL VM is a valid stand-in.
- B109 vs D150/D287: the spec is right. One file was the whole point of D150.
- B121 (S-C1-02's tap): the build is right about the galaxy; the scenario needs the owner.
- B113 (hold at the page end): the build is a fair stand-in; the spec has a gap between
  c1-talk.md S-C1-26 and stand-ins.md §1.2.
- T16b's M1/M3/M5/M6 before C3/Speak/Show: the build follows slices.md §3.1, which I would also
  follow; §9.2's table must change.
- Matches the spec: the rects of D116 (CHAT/CLOSE 1288-1336 × 760-808), the pane 760/0/608×912 on
  the Wall and 760/36/608×852 at `z-index` 35 on the app, `transition-duration` 0.12 s, D20 focus by
  `(pointer: fine)` (`pane.js:193`), D265's none layout (SEND 1280-1344 × 824-888, input to x 1264),
  D267's bottom padding (the last reply line ends near y 738 in `r21-wall-1368-open.png`, clear of
  `CLOSE` at 760), the toast stack ≤ 736, S-SCR-35's ± 0.5 px, 0.9 s, 2 px, 60000 ± 100 ms and its
  `onState` `('tour', {by:'idle'})`, S-C1-26's 5 s room-down (4950-5300 ms).

## Rubric

score pane spec 6
score pane tests 6
score pane legibility 7
score pane touch 6
score pane speed 4
score pane safety 7
score room spec 6
score room tests 7
score room legibility 6
score room touch 5
score room speed 6
score room safety 7

## console.txt, every line

`r20-pane/console.txt`:
```
console WebSocket connection to 'ws://127.0.0.1:8035/api/cockpit/ws' failed: Connection closed before receiving a handshake response
console WebSocket connection to 'ws://127.0.0.1:8035/api/cockpit/ws' failed: Connection closed before receiving a handshake response
console WebSocket connection to 'ws://127.0.0.1:8035/api/cockpit/ws' failed: Connection closed before receiving a handshake response
console WebSocket connection to 'ws://127.0.0.1:8035/api/cockpit/ws' failed: Connection closed before receiving a handshake response
```
(These four lines come from the room-down still: `/link up:false` destroys upgrades unread, as
stand-ins.md §1.2 says. That is expected, and none of them is from a live state.)

`r21-wall-open/console.txt`: empty.

`22-handle/console.txt`: empty.
