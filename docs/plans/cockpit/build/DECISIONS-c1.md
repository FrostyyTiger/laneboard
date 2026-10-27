# Cockpit build: decisions of the C1 night(s)

Choices a builder had to make that the spec (`docs/plans/cockpit/spec/`) does not cover. The spec's own
decisions stay in `spec/DECISIONS.md` (`D<n>`); these are `B<n>`, one line each:
`B<n> <choice> — because <why> — spec: <file §> — overrule: <what changes>`. Small and reversible only;
taste, one-way or security-relevant choices go to `build/PROGRESS.md` `## For the owner` instead.

## Decisions

- B0 (set up with the loop, not by a round) Board changes in fenced files are written as patches in
  `build/patches/`, never committed by a round; until the hub patch of `slices.md` §5.1 is applied,
  `runs` on a hub answers `Runs are not available on this hub yet.` and S-C3-03 runs against a single
  board — because the hub and the security core stay reviewed (`loop-build/fenced.txt`) — spec:
  `slices.md` §5.1 — overrule: unfence `server/hub/read-proxy.mjs` and `server/hub/routes/` for the night.
- B00 (set up with the loop, not by a round) The Wall's galaxy answers `show.result` `skipped` with three
  `why` values besides `in use`: `unsupported` (`compare`, `scrub` until the Show and History slices),
  `not drawn` (the node is not on this galaxy) and `bad-args`; the room's message checks accept all four
  — because the Wall merge built them (`docs/wall.md` "Show commands") — spec: `protocols.md` §4
  — overrule: map them onto `in use` in the room and keep the spec's single value.
- B1 (planner, round 1) T3 writes a first `server/boot/cockpit.mjs` whose `startRoom()` does only what the
  room under test needs to boot (the board as `builder.mjs` boots it, no cockpit routes); T6 completes it
  — because `stand-ins.md` §7 puts the room under test (step 3) before the room process (slices.md §3.1
  build 2), and the wrapper imports `startRoom()` unchanged — spec: `stand-ins.md` §1.1, §7 — overrule:
  swap T3 and T6.
- B2 (planner, round 1) A scenario whose `Test:` line names both node:test and Playwright (S-C3-04) is
  one Playwright test titled with its id; the node part is a `test.step` that calls the room (MCP by
  JSON-RPC) from the test process — because §2's rule is one test per id — spec: `slices.md` §2,
  `c3-see.md` S-C3-04 — overrule: a second test in `test/cockpit-<topic>.test.mjs` with the same id.
- B3 (planner, round 1) `demo-fleet.mjs --cockpit` and the `demo` script are built in T43, not with
  `stand-ins.md` §7 step 4 (T4/T5) — because the demo needs the room, the link and the pane of builds
  2-19 to answer `how did the night go` — spec: `stand-ins.md` §6, §7 — overrule: move them to T5.
- B4 (planner, round 1) A step §3.1 says runs with a later slice (S-C1-22's cards, S-C1-46's `show`,
  S-SCR-23's canvas strip) is written now as `test.step.skip('<step> — waits for <slice>', …)` — because
  the step's text stays in the test and its skip names what it waits for — spec: `slices.md` §3.1 —
  overrule: leave the step out until its slice.
