# Review, round 95: spec-keeper

Scope: the tasks ticked since review 89-owner: T26 (S-C1-17, S-C1-27, commit 7c9b145), T27 (S-C1-19,
S-C1-20, commit ea3f692), T28 (S-C1-37, S-C1-38, commit d8c48d4) and the round-94 fix 3b4fd58 (B221).
I read each scenario's Given/When/Then and `Test:` line in `spec/c1-talk.md`, then the test that
carries the id, the pane and room code they drive, and B200-B221 in `build/DECISIONS-c1.md`.
Stills read: `shots/91-stop/forced-dark-800.png`, `shots/r92-errors/errors-light-1368.png`,
`shots/93-status/app-not-logged-in-dark-1368.png`. They are newer than the pane's last code commit
(d8c48d4; 3b4fd58 changes only a test), so I made no new shots.

## Findings, worst first

1. **S-C1-38 second case does not prove "after the second failed start".**
   `e2e/cockpit/c1-status.spec.mjs:251-257` waits up to 5 s for `agent-down`, then checks the text
   against `since` from the room's own `status` message. The scenario says `agent-down` comes after
   the *second* failed start, with "the room's time of that start". Today the step passes if
   `agent-down` shows after the first start. It also passes if `since` is any time the room chooses,
   because the test compares the room with itself. B214 says the build judges E3 "from the second
   failed start", but nothing checks that.
   Fix: in the sampler, record the time `agent-down` first shows. Assert that
   `log.starts().length >= 2` at that moment and that no sample before `starts[1].atMs` shows
   `agent-down`. Assert `Date.parse(down.since)` is within 1 s of `starts[1].atMs`.

2. **S-C1-38's "one message per change, in the order of the table's rows" is checked loosely in the
   second case.** `c1-status.spec.mjs:271-275` checks only that the codes contain `agent-down`, end in
   `not-logged-in`, have no `agent-back` and no repeat in a row. Extra codes in between, or a
   `null` between `agent-down` and `not-logged-in`, would pass. The first case (`:236`) asserts the
   exact list, so the second case should too.
   Fix: `expect(codes).toEqual([...])` with the exact sequence the room must send. If that is
   `['not-logged-in', 'agent-down', 'not-logged-in']` (the start's login check first), say so in a B
   line. Every `status` sent must match a row of §10.1's order.

3. **S-C1-37 second case: "a page loaded 2 s after the room" and "the room's start time" are not
   what the test measures.** `c1-status.spec.mjs:177-188` takes `before` *before* `nextRoom()`, which
   also stops the old room. So the page loads 2 s after the stop began, not 2 s after the room
   started. If the boot takes over 2 s, the wait is zero. "Since" is only checked to fall within
   5 s of `before`, not to equal the room's start.
   Fix: take `t0` from the room's start (`log.starts()[0].atMs`, or the first `login-check` line).
   Load the page at `t0 + 2000`. Assert `since` is within 1 s of that start (the check runs "beside
   the first spawn", §11.10).

4. **S-C1-27's timed claims are partly untimed, and one uses the wrong element.**
   - "by t = 3.1 s the header reads `● STOPPING`": `watchStop` (`e2e/cockpit/c1-stop.spec.mjs:80`)
     times the root's `data-turn="stopping"`, not `[data-cockpit-turn]`'s text. The step title
     (`:199`) says the header. Fix: record the first moment `HEADER` reads `● STOPPING` and assert
     ≤ 100 ms. S-C1-17's first run needs only `data-turn`, as its scenario says.
   - "by t = 3.5 s … the queued block reads `YOU · HH:MM · NOT SENT` with `Dropped by STOP.`":
     `:220-226` asserts these after READY with Playwright's auto-wait (5 s), with no time bound.
     Fix: in `watchStop`, record when `[data-turn-delivery="not-sent"]` first appears and assert
     ≤ 500 ms from the tap, as `t.line` is.
   - `:219` checks the stopped line against `/^STOPPED AT \d\d:\d\d$/`. S-C1-17 (`:129`) checks the
     page's `HH:MM`. Use `pageHhmm(page)` here too.

5. **S-C1-17: "one `interrupt` line with `cancelled` `null`" is checked only for the second run.**
   `c1-stop.spec.mjs:136` counts interrupts in the first run but leaves its `cancelled` unchecked.
   `:150` checks only `interrupts()[1]`. The scenario has two runs and two interrupt lines, so "one"
   is ambiguous: it could mean per run, or the `ignore` run only. Fix: assert the first run's
   `cancelled` too (null, or `[]` if the fake writes that for `endAfterMs`). Log the reading as a
   B line.

6. **S-C1-38 third case loosens 5 s ± 0.2 s to 4.76 s.** `c1-status.spec.mjs:303` accepts
   `shown >= 4800 - 40`. The 40 ms makes up for sampling at 20 ms. The rule says "never loosen a
   number". Fix: time the `back` element's insertion and removal with a `MutationObserver` on the
   pane (exact to the frame) and assert 4800-5200 ms with no margin. Keep the 20 ms sampler only for
   "then nothing".

7. **S-C1-20 "compare the texts and computed colours" compares the text colour only.**
   `e2e/cockpit/c1-errors.spec.mjs:185` asserts the line's text is `--text-1` and nothing in the
   pane uses `--p1`/`--p2` (`:156-167`). §10's look (`--bg-sunken`, 1 px `--line-strong` border with
   a 2 px left side) is the "grey" the title promises, and no test checks it. The still
   (`errors-light-1368.png`) shows the grey box, so this is a test gap, not a build bug.
   Fix: in the row loop, also assert the line's `backgroundColor` equals `--bg-sunken` and
   `borderLeftWidth` is `2px`. §10's button sizes (48 px tall, ≥ 96 px wide, 8 px apart) have no
   C1 scenario: a `## Later` line for S-C1-41's table is enough.

8. **The text of `[data-cockpit-status]` is read through a private class.**
   `c1-status.spec.mjs:39, 72, 147, 161, 190, 209, 216, 297` read `.ck-status-text`. The spec README
   ("Selectors tests use", row `[data-cockpit-status]`) names the element, and S-C1-37 says
   "text exactly". For `not-logged-in` (no button) the element's `textContent` must equal the
   sentence. Fix: assert `toHaveText(LOGGED_OUT_0315)` on `STATUS` itself where no `RETRY NOW`
   shows. Keep `.ck-status-text` only for `room-down`, whose element also holds the button. Log the
   class in a B line, as B208 did for E5's row.

9. **The stills for T26 and T27 have no `console.txt`.** `shots/91-stop/` and `shots/r92-errors/`
   hold PNGs only. T27's tick says "no console errors", but there is no file that shows it.
   `shots/93-status/console.txt` exists and is empty. Fix: `shoot.mjs` runs write `console.txt`.
   Later rounds should keep it, even when empty.

## Where the build and the spec disagree

- **B221 vs S-C1-37's `Test:` line.** The spec names `page.clock.setFixedTime('2026-10-27T03:15:00+01:00')`.
  The build fixes `Date` with an init script and leaves the timers real. I side with the build:
  S-C1-38 runs on clock `real` and needs the 5 s grace (D139) to pass in real time, which
  `page.clock` does not guarantee under load (round 94 measured 1.2 s in 26 s). The owner should
  amend S-C1-37's `Test:` line ("fix the page's `Date` only") so the next reader does not "fix" it
  back.
- **B220: S-C1-37/38 on the Wall page.** The rect y 64-144 is the Wall's (§10.1 table,
  `c1-talk.md:1190`). On the app it is y 100-180 (`:1191`). I agree with the reading. The app's row
  of that table is then asserted by no test. Spec question for the owner: should S-C1-37 name the
  page, or add the app's rect as a step?
- **B204: S-C1-27's `prompts()` "1 before and 2 after".** The literal total is 2 before and 3 after
  (the first prompt counts). The build counts only the steer's words, as S-C1-29 does. That is
  right, but the scenario's wording is wrong as a count. It is a typo-level spec fix ("the
  `prompts()` with its words"), for the owner.
- **B218: the tap on `RETRY NOW` in S-C1-38.** It adds an action the scenario's When does not have.
  The assertion is unchanged, but the scenario no longer proves that a backoff-driven reconnect
  draws `not-logged-in` in its first frame. Acceptable as logged. The backoff path should get one
  check in T32's S-SCR tests.
- **B200/B206: `STOPPED AT` and E2's times from `turn.end.at`, not the tap.** The spec says "the
  page's clock". The build maps the room's time onto the page's clock, so every screen agrees. This
  is consistent with S-C1-39. No change.

## Rubric

score pane spec 8
score pane tests 6
score pane legibility 7
score pane touch 6
score pane speed 7
score pane safety 7
score room spec 8
score room tests 6
score room legibility 7
score room touch 6
score room speed 7
score room safety 7

## console.txt read

- `shots/93-status/console.txt`: empty (0 lines).
- `shots/91-stop/`: no `console.txt`.
- `shots/r92-errors/`: no `console.txt`.
