# Review, round 26: the implementer

Read: `spec/README.md` (index, B1-B8, glossary), `screens.md` (§1-§8, S-SCR-01..23), `c1-talk.md`
(§1-§6, S-C1-01..13), `DECISIONS.md` (D1-D29), `QUESTIONS.md` (Q-O1..Q-O13), `reviews/21-owner.md`.
Shot `c1-pane.html` and `screens-split.html` at 1368 (dark). Checked names against the code:
`public/js/core/router.js` (`VIEWS`), `public/js/core/net.js` (`nextBackoff`), `public/css/tokens.css`,
`public/js/core/marks.js`, `public/index.html` (`#offline`), `bin/laneboard`, `server/`,
`package.json`, and `origin/plan/wall`. Question I asked of every scenario: could I write the test
and the code tonight, against stand-ins, without asking anyone?

## Findings, worst first

1. **There is no test harness for any `Test:` line.** (Every scenario; D28.) Every `Test:` says
   Playwright: `page.clock`, `hasTouch`, CDP `Input.dispatchTouchEvent`, `emulateMedia`,
   `--use-fake-device-for-media-stream`. The repo has no Playwright: `npm test` is `node --test`
   with an in-memory DB, there is no browser test anywhere in `test/` (183 files), and
   `node_modules` has neither Playwright nor Puppeteer. `loop/shoot.mjs` drives Chromium by hand
   with `node:child_process`. So the first build night has to decide whether to add a dependency
   to a public repo, where the tests live, whether `npm test` (and the hygiene test) runs them, and
   whether CI on the `ci` VM has a browser. I would stop here. Fix: a section in `slices.md` (or
   `stand-ins.md`) called "The acceptance harness": the runner (Playwright as a devDependency, or
   CDP over `shoot.mjs`'s launcher), the folder (`test/cockpit/*.spec.mjs`), the command
   (`npm run test:cockpit`), and whether it is part of `npm test`. Adding a dependency is the owner's
   call, so make it a Q-O with a recommendation.

2. **Nobody says which process "the room" is or who serves `/api/cockpit/*`.** (`screens.md` §6,
   glossary "room", D17.) The pairing routes, `laneboard cockpit pair|screens|unpair`, the heartbeat
   and the conversation all live "on the room". But is the room a laneboard server started in a new
   mode (`server/cockpit/` next to `server/hub/`), a separate Node program, or something else?
   `bin/laneboard` is "CLI over the local API", so `cockpit pair` implies a laneboard server on the
   room. The page is served by the hub with `cockpit.url` pointing elsewhere, so the screen talks
   cross-origin: CORS, and an `HttpOnly` cookie (§6 step 4) that a cross-site fetch will not send.
   Every route, the token storage and S-SCR-14's "reload: live again" depend on this. Fix:
   decide it now in `README.md` (process, entry point, config section `server/config/cockpit.mjs`
   with keys and defaults, and the origin the screen talks to). It is security-relevant (cross-
   origin token), so a Q-O for the origin question; do not leave it all to T15/T17.

3. **The cockpit button has two specs that cannot both be built.** (`screens.md` §4, S-SCR-01,
   S-SCR-03, S-SCR-09, S-SCR-13 vs. `c1-talk.md` §2, S-C1-01, S-C1-13.) `screens.md`: one
   `[data-cockpit-button]` labelled `AGENT`, 64x64 at (1344, 888), that reads `CLOSE` while the pane
   is open. `c1-talk.md`: the bottom-right 64x64 is the talk button, a 48x48 `CHAT` opener
   `[data-cockpit-open]` sits above it and is hidden while open, and `CLOSE` is in the pane header.
   Test selectors, labels and positions differ; S-SCR-03 "taps `AGENT`" has no target under
   `c1-talk.md`. The app-view position of `CHAT` is not given at all (only Wall coordinates).
   Fix: rewrite `screens.md` §4 and S-SCR-01/03/09/13 to the Q-O11 recommendation (both marked
   pending) with selectors `[data-cockpit-open]` and `[data-talk]`, and give `CHAT`'s rect in the
   app (y = 872 − 64 − 16 − 48 = 744 to 792).

4. **`split` and `canvas` have no conversation to build.** (`c1-talk.md` §1 row 3, D8, D18,
   S-SCR-06, S-SCR-11.) `c1-talk.md` says in `split`/`canvas` there is no sliding pane but "a fixed
   column of the canvas (pending Q-O12; sketch T25)": no rect, no height split with the cards, no
   input row position. D8 still says the pane slides over the canvas half. S-SCR-06 "the pane stays
   open" after switching to `canvas` and S-SCR-11 "the pane open with a draft" in `split` assume a
   pane. `split` is the default at 1368x912 (S-SCR-01), so it is the main path and the one I cannot
   lay out. Fix: give the column's rects for the recommendation (e.g. conversation x 760-1368,
   y 456-912; cards above), mark D8 superseded (pending Q-O12), restate S-SCR-06/11 with
   `[data-cockpit-conversation]` instead of "the pane".

5. **The retry series in S-SCR-19 is wrong against the real `nextBackoff`.** (`screens.md` S-SCR-19,
   D11.) `net.js`: start 500 ms, `min(ms × 1.8, 15000)`. Delays 0.5, 0.9, 1.62, 2.916, 5.249, 9.448,
   15 s; retry times after the loss 0.5, 1.4, 3.02, 5.94, 11.18, 20.63, 35.63 s. The spec lists
   2.9, 5.6, 10.6, 19.4, 34.4 s, and asserts ± 50 ms, so a correct build fails the test. Also,
   with `page.clock` faked in the page only, the stand-in's real-time connection log records when
   the test fast-forwarded, not the series. Fix: correct the numbers; assert the series on the
   page side (a `cockpit:retry` mark per try) or run that scenario on the real clock.

6. **C1 cannot be built before the protocols, and the spec does not say what to stub.** (`c1-talk.md`
   §3 "Streaming", §5, S-C1-04/06/07; T15/T16 open.) C1 part 1 already needs: a text delta, a
   "text block complete" that replaces deltas (by which block id?), tool start and tool end with
   `ok|failed` and a duration in ms, parallel tool calls (Claude sends several `tool_use` in one
   message: are they one line or several, and which is "running"?), turn start/end, heartbeat
   every 10 s. None has a name, field or JSON shape. Fix: T15/T16 before any C1 build night, and in
   `c1-talk.md` a one-paragraph list of the events §3/§5 consume, with the fields each needs
   (`turnId`, `blockIndex`, `toolUseId`, `startedAt`, `endedAt`, `isError`), so T16 has a target.
   Say how overlapping calls of one tool fold (I would guess: one line, `●` while any runs).

7. **S-C1-13 belongs to C2 and pulls the whole voice path into C1.** (`c1-talk.md` S-C1-13, B1-B3.)
   It needs the talk button states (T6), audio frames to a fake speech service, partial replacement
   and the final: all C2. A C1 night that must pass it cannot stand alone. Fix: renumber it
   `S-C2-xx` (keep the id as an alias in `slices.md`) or state in `slices.md` that C1's done-when
   excludes it.

8. **Every Wall-page scenario depends on a page that does not exist.** (S-SCR-01..08, 11-13,
   17-23; S-C1-01, -02, -13; glossary "Wall".) `wall.html`, `data-wall-state`, the tour, the
   overview and the Map's `screenOf` on the Wall are from `origin/plan/wall`, which is a plan only;
   `docs/plans/product.md` even calls the page `galaxy.html`. The rules say not to depend on its
   file names, but the tests select on its attributes. Fix: a "Wall contract" list in `screens.md`
   of exactly what the cockpit needs from the Wall (`data-wall-state`, a `tour.pause()/resume()`,
   a camera read like `screenOf(id)`, the idle timer hook), and for the C1 night a fallback: all C1
   scenarios that can run on the app (`#/map`) do so first.

9. **The stand-ins are referenced as if written.** (S-SCR-13..20, S-C1-04..13; T18 open.) Tests call
   "the stand-in room can stop and start its cockpit link, approve and revoke pairings",
   "a stand-in room whose clock is moved 300 s", "the stand-in's log of received turns",
   "the fake agent's timed script", "drops delta 4". None has a format, command or control API.
   I would have to invent: how a test tells the fake agent which script to play (per test? a
   `POST /__stand-in/script`?), how it moves the room's clock, where logs go. Fix: T18 must give a
   control API (method, path, body) for each of those verbs; until then each scenario that uses one
   is not buildable.

10. **Attribute names drift.** (S-SCR-04 vs. `c1-talk.md` §1.) S-SCR-04 asserts `data-open`; the
    pane spec says the root carries `data-pane="open|closed"`. Also `[data-cockpit-down]` (S-SCR-18)
    and `data-mic`/"the mic state attribute" (S-SCR-20) are used and never defined; `data-talk`
    values beyond `listening` are T6's. Fix: one table in `README.md` of every `data-*` attribute
    and selector the tests use, with its values, and S-SCR-04 renamed.

11. **The Markdown renderer is a hidden project.** (`c1-talk.md` §3, D22, D23.) A streaming GFM subset
    (tables with numeric-column detection, fences closing mid-stream, two list levels, escaped
    HTML) is several hundred lines. Is it a dependency (`marked` with a sanitizer) or our own
    module? Where (`public/js/core/md.js`?) and with which unit tests? "A column whose body cells are
    all numbers, times or sizes" needs a regex, not examples. Fix: D-line: own module, no
    dependency, plus the exact cell regex, e.g. `^-?\d+([.,]\d+)?( ?(%|[KMGT]?B|ms|s|min|h))?$|^\d+ h \d{2}$|^\d{2}:\d{2}$`.

12. **The budget's "asserted share" column cannot be measured as written.** (`README.md` B2, B3,
    B5, B6.) B2 asserts "screen and room's share ≤ 0.4 s" but the test reads one mark pair from
    pointerdown to the first partial; the fake speech's 0.6 s is inside it. Which number does the
    test assert, 1.0 or 0.4? B5/B6 carry "the room's receive time" in the message and compare it
    with the screen's `performance.now()`: two clocks, two processes. Fix: say each test asserts the
    end-to-end column; drop or define the share (screen marks around a stand-in event whose send
    time is in the message, both on `Date.now()` on one host).

13. **Demo data for C1 is missing.** (`c1-talk.md`; `docs/plans/product.md` rule 2: "A feature without
    demo data is not done".) S-SCR-10 gives demo cards; nothing says what the pane shows with
    `?demo=1` (a scripted demo conversation from the fake agent?). Fix: one scenario: `?demo=1`,
    the pane opens on a canned 3-turn conversation labelled `DEMO`, and typing plays a demo turn.

14. **Small guesses I would have to make.**
    - S-SCR-16 date `27 Oct`: locale fixed to English `D Mon`, or the screen's locale?
    - `?perf=1` lists measures "in the pane's header menu (T5 places it)": there is no header menu.
    - Tool-line table: `Bash` first word of `command` when it starts with `cd x &&` or an env
      assignment? `WebFetch` with an invalid URL?
    - D21's "named constants in D6's module": module path and export names (I'd guess
      `public/js/cockpit/constants.js`).
    - `cockpit.url` "in the config of the laneboard server": which config file section, and how the
      page learns it (a field in the first snapshot? `GET /api/cockpit/config`?).
    - S-C1-01 "the latest turn's last line is in sight" on a fresh screen: where does the conversation
      come from before T15's resume exists?
    - `CHAT` and the talk button in the app when the pane is closed: both shown (pending Q-O11)?

## Contradictions with `spec-input.md`, and what should be owner questions

- **Adding a browser test dependency to the public repo** (finding 1): one-way-ish and a repo-
  hygiene matter; should be a Q-O, not left to a build night.
- **The screen's origin to the room and where the device token lives** (finding 2): security-relevant;
  `screens.md` §6 defers it to T17 while already fixing routes and the cookie idea.
- **D13 pairing-code length, lifetime and cap**: the line itself says "security-adjacent"; by the
  rules it belongs in `QUESTIONS.md` (it is only partly covered by Q-O10).
- **D22 links not tappable** and **D14 nothing in browser storage**: both marked security-adjacent
  in their own text, yet logged as D-lines.
- **`screens.md` §3 still says "Two screens (the owner's case)"**: `spec-input.md` §1 says "A touch
  screen sits on the desk" and nothing about two; review 21 finding 5, T21 still open.
- **`CANCEL JOB` in `screens-split.html` and `screens.md` §7** with no confirm: `spec-input.md` §6
  "Anything that changes state shows a confirm on the screen". Still open as T21.

## Rubric

score spec concrete 7
score spec complete 3
score spec consistent 4
score spec testable 4
score spec ownerfit 6
score spec simple 6
score spec safe 6
