# Review round 101: touch

Persona: one finger, a slanted tablet at arm's length, no hover. Scope: the tasks ticked since review
95 (T29 new conversation, T30 audit lines, T23c prompt rate, fix 5390b1e), plus a recheck of review
30's touch findings. Stills read: `shots/r97-new/*`, `shots/r99-rate/*`, `shots/r92-errors/errors-light-1368.png`,
`shots/91-stop/dropped-dark-800.png`. The newest stills had no pressed frames and no focus readings,
so I wrote my own Playwright/CDP touch probe outside the repo (`touchprobe/probe101.spec.mjs`, the
room under test from the e2e fixtures, `hasTouch`, taps by `Input.dispatchTouchEvent`). Its output is
in `$RUN_DIR/shots/101-touch/`: `probe-newbar.txt`, `probe-e9.txt`, `probe-stutter.txt`, plus
`newbar-*.png`, `held-*.png`, `divider-*.png`, `kbup-newbar-dark-1368.png`, `e9-*-1368.png`.

## Findings, worst first

1. **Two quick taps on `NEW` start a new conversation.** `probe-stutter.txt`: tap `NEW` at
   (1212, 68), then a second tap 20 or 28 px below `NEW`'s bottom edge 120, 250 or 400 ms later.
   All three runs ended with `new conversation started = true`. The 20 px tap lands at y 112.
   That is inside the bar, 4 px above `START` (`probe-newbar.txt` walk: y 100-112 is `ck-newbar`,
   y 116 is `START`). Chromium's touch adjustment still snaps it to `START`. The cause: the bar is
   drawn in the first frame after the `NEW` tap, and `START` sits right under `NEW`. `NEW` is
   x 1176-1248, y 44-92 and `START` is x 1144-1240, y 116-164, so the gap is 24 px
   (`newbar-dark-1368.png`, `newbar-light-800.png`). A stutter, or a double tap from a finger that
   slides down the slanted glass, does the one thing §11 asks first about ("Ask first", D36). The
   old session is gone from the agent's context. The spec already guards the same stutter for
   `SEND` → `STOP` (`STOP_GUARD_MS = 1000`, D268, c1-talk.md §16). `START` comes up under the
   finger with no guard. The build matches the spec's rects, so this is a question for the owner,
   not a build bug.
   Fix (owner, one-way): `START` ignores taps for `STOP_GUARD_MS` after the bar shows. It is drawn
   `disabled` for that 1.0 s, with no pressed state, as for a waiting `RETRY` (README "Touch"). Or
   swap `START` and `KEEP`, so a double tap on `NEW` lands near `KEEP`; but that breaks §11's "START
   farther from the corner". Then add a step to S-C1-22: `NEW`, and a touch at `START`'s centre
   200 ms later sends no `new` frame.

2. **Still no tap shows it was felt.** This is review 30's finding 2, unchanged after 20 more
   tappables. `probe-newbar.txt` "press" lines and `held-start-dark-1368.png`, `held-new-light-800.png`:
   holding `START` or `NEW` for two frames gives `"same": true`, the same fill, border and colour,
   and `data-pressed` null. The tap highlight is still Chrome's default `rgba(0, 0, 0, 0.18)`,
   which cannot be seen on the dark `--bg-elevated`. T51 (`-webkit-tap-highlight-color`) is open
   and T42 is still at build 23. T29 added `START` and `KEEP`. The spec singles them out: "on the
   `NEW` bar (itself `--bg-sunken`) `KEEP` and `START` rest on `--bg-elevated`" so that the press
   shows. Today the press does not show. `KEEP` and `START` do have a quick result (the bar goes,
   or `● STOPPING` within 100 ms). E9's `EDIT`, `RETRY`, `GO ON` and the tool lines do not.
   Fix: do T42 and T51 next, before more C1b UI. It is one capture `pointerdown` listener, one CSS
   rule and S-C1-41's table.

3. **A disabled button reads as a live one, and T29/T23c added three more.** `e9-light-1368.png`,
   `e9-dark-1368.png`, `probe-e9.txt`: E9's disabled `RETRY` and the live `EDIT` beside it have
   the same fill (`oklch(1 0 0)` light, `oklch(0.2 …)` dark) and the same border
   (`oklch(0 0 0 / 0.2)`, `oklch(1 0 0 / 0.17)`). Only the word differs: light 0.46 against 0.15,
   dark 0.62 against 0.96. At 60 cm, `RETRY` in light reads as a slightly paler button. A tap on it
   does nothing at all: no frame, no press, focus unchanged (`probe-e9.txt`, correct per D224). So
   the owner taps a dead button and the screen does not move. Nothing on screen says when it comes
   back: the line only says "wait a minute", and the button turns live 60 s later with no cue.
   The same goes for `NEW`, disabled while a status line holds the slot (B222): see
   `91-stop/dropped-dark-800.png`, where `NEW` has the full `--line-strong` border, grey text, and
   sits beside a live `CLOSE`. It goes for `SEND` in `data-send="wait"` too. This matches the spec
   (E9: "`--text-3` on `--line`", and every error button is `--line` by B173). It is T55 for the
   header buttons, still open.
   Fix: T55 as written, and give it a twin for the error buttons: a disabled `.ck-err-btn` loses its
   border (or takes `--bg-sunken`'s tone of the block), so the live `EDIT` is the only framed box.
   For the owner (spec silent, taste): E9 could say when `RETRY` frees up, e.g.
   `Too many messages from this screen; RETRY at 07:01.`.

4. **`T49` is done in effect, but the list says open.** Focus after `SEND`, review 30's finding 1:
   T24's `keepFocus` (`public/js/cockpit/pane.js:962-966`) keeps the input focused for every
   button in the pane. My probe: the input stays focused after `NEW`, after `START` (the draft
   `a draft I keep` survives, as §11 "What carries over" says) and after a tap on a disabled
   `RETRY`. `c1-typing.spec.mjs:105` asserts it for `SEND`. No test asserts it for `NEW`, `START`,
   `KEEP` or E9's buttons, and D132 says the keyboard stays up for all of them.
   Fix: triage closes T49 as covered by T24 (d455b28). Add one step to S-C1-22: input focused,
   `NEW`, `KEEP`, `NEW`, `START`, and after each tap the input is still `toBeFocused()` with the
   draft unchanged.

5. **The offline banner over the input row (T50) and the toasts at 800 wide (`## Later`, from
   T24b) are still open.** I did not re-measure them this round. Nothing since round 30 touched
   `.banner` or `.toasts` (`public/css/cockpit.css` has no `.banner` rule; `.toasts` has only lines 47-48, the 608 px pane's `right: 624px`). Review 30's
   `p3-1368-dark-roomdown-row.png` still describes the build. A finger that lands low on `SEND`
   while the hub link is down still hits the banner.

6. **Stills come without `console.txt`.** `r97-new/` and `r99-rate/` have none, and `r92-errors/`
   and `91-stop/` have none either. This was already flagged in review 95, finding 9. The two that
   exist are empty (`93-status/console.txt` is 1 byte, `88-queue-film/console.txt` is 0 bytes). I
   cannot tell "no errors" from "not recorded". Fix: the builders' still scripts (`stills97.mjs`
   and the like) write `console.txt` even when empty, as `shoot.mjs` does.

## Checked and fine

- The `NEW` bar's rects match §11 exactly at 1368 (bar y 100-180, `START` x 1144-1240, `KEEP`
  x 1256-1352, y 116-164, 96x48, text x 784-1128 at 18 px). At 800 wide it is right-aligned the
  same way (`START` x 576-672, `KEEP` x 688-784). `touch-action: manipulation` is on both.
- `KEEP` sits under header `CLOSE`, so a stutter there only closes the pane. A stutter on `START`
  lands on the divider (`dividers after START + stutter tap 2`, the spot is `ck-divider`), so it
  does nothing.
- A second `NEW` hides the bar (§11). With the keyboard up (1368x532) and the bar shown, the pane
  stays open, the bar is at y 64-144, the input is at y 460-524 and the conversation keeps about
  300 px (`kbup-newbar-dark-1368.png`).
- The divider is 48 px, 16 px caps, `--text-3` (0.62 dark, 0.46 light), and readable at arm's
  length (`divider-*.png`).
- E9: a tap on the disabled `RETRY` sends no frame (S-C1-43 asserts it with a real touch, `tapAt`).
  `EDIT` puts `ping 11` back with focus. The block's buttons are 96x48 with 8 px between them, and
  the block ends above corner `CLOSE` with room to spare (`r99-rate/e9-light-800.png`).
- `● STOPPING` within 100 ms of `START` during a turn is asserted (S-C1-22 last step), so the
  one-way tap answers at once when a turn runs.

## Spec vs build

- §11's `START` under `NEW` with no guard (finding 1): the build follows the spec. I think the spec
  is wrong here, because it already accepted the same reasoning for `STOP` (D268). For the owner.
- E9's disabled look (finding 3): the build follows the spec (`--text-3` on `--line`). Touch-wise it
  is too weak, but that is a taste call for the owner (T55's twin).

## Rubric

score pane spec 8
score pane tests 7
score pane legibility 8
score pane touch 4
score pane speed 8
score pane safety 5
score room spec 8
score room tests 8
score room legibility 6
score room touch 6
score room speed 7
score room safety 8

## Console lines read

- `shots/93-status/console.txt`: one empty line, no content.
- `shots/88-queue-film/console.txt`: empty (0 bytes).
- `r97-new/`, `r99-rate/`, `r92-errors/`, `91-stop/`: no `console.txt` exists (finding 6).
