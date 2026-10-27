# Review round 30: touch

Persona: one finger, a slanted tablet at arm's length, no hover. Scope: the tasks ticked since review 23
(T16b, T17, T18, T18b, the fixes d61ebe4 and 9f0c0fa). The newest stills (`28-t18b`, `r26-*`) predate
9f0c0fa, so I made my own with a Playwright probe outside the repo. It booted the room under test with
the e2e fixtures and sent touch through CDP `Input.dispatchTouchEvent` (`hasTouch`, `pointer: coarse`).
Stills and logs are in `$RUN_DIR/shots/30-touch/`: `probe.txt` (rects, pressed looks, at 1368x912,
1024x768, 800x1280, dark and light), `probe2.txt` (edge taps, the short window), `probe3.txt` (the
offline banner), `probe4.txt` (focus after SEND).

## Findings, worst first

1. **After SEND the on-screen keyboard drops.** `probe4.txt`: the input is focused and gets typed
   into; a tap on `SEND` leaves `document.activeElement` = `BODY`. Here is the chain: the tap focuses
   the button, `sendNow()` empties the input, `sendState()` disables `SEND`, and a disabled focused
   button hands the focus to `body`. On the tablet the keyboard goes down and the whole row jumps
   about 364 px between two prompts. The spec says the opposite. `c1-talk.md` §7 "On send" says
   "Keyboard focus stays where it was (an on-screen keyboard stays up)", and §7.1 D132 says "After
   a send the keyboard stays up". T18 built `sendNow`, and its comment (`public/js/cockpit/pane.js:263`)
   claims "Focus stays where it was". That is false on touch, and with a mouse too. Why it matters to
   me: a follow-up question costs a second tap in the input every time, and the conversation jumps
   twice. Fix: in `pane.js`, add `pointerdown` and `mousedown` listeners on `send` that call
   `preventDefault()` (D132's own mechanism; T24 extends it to every control in the pane). Add a
   step to S-C1-04 or to T23's S-C1-14: tap the input, type, tap `SEND`, then the input still has
   the focus.

2. **No tap shows it was felt.** `probe.txt` "press …" lines and `pressed-*.png`: for CHAT, SEND,
   header CLOSE, corner CLOSE and NEW, the look while the finger is held two frames is identical to
   the rest look. Fill `oklch(0.2 0.004 250)`, border `oklch(1 0 0 / 0.32)`, no `data-pressed`. The
   only cue is Chrome's default tap highlight, `rgba(0,0,0,0.18)` on every button. On the dark
   theme's `--bg-elevated` that is invisible. On the light theme it is a grey flash on Android only,
   and with its own timing. This is D224 / README "Touch", and it is T42, the 18th task of C1b. Why
   it matters: tool lines, `SHOW ALL`, `RETRY`, `STOP` and `↓ NEW` arrive in T19-T27, every one a
   tappable, and each will ship and be reviewed without feedback. Fix: move T42 up to just after T18b
   (it is one delegated `pointerdown` listener plus one CSS rule). In the same module, set
   `-webkit-tap-highlight-color: transparent` on the cockpit's buttons, as `wall.css:34` already does,
   so the pressed state is the only feedback and the same on every browser.

3. **The board's offline banner covers the bottom of SEND and the input.** `probe3.txt` and
   `p3-1368-dark-roomdown-row.png`, also visible in `1368-light-roomdown.png`: while offline,
   `#offline.banner` (z-index 60, y 879-912) sits over the pane's input row (y 808-888). The element
   under SEND's bottom 9 px and under the input's bottom is the banner, not the control. The pane
   stays at z 35. Why it matters: when the hub link drops but the room is up (separate processes on
   the owner's desk), the owner can still type and send, and the bottom edge of the row is gone. A
   finger landing low on SEND hits the banner. `screens.md` §7 keeps "today's behaviour (the
   `#offline` banner)" and says nothing about where it sits beside the pane. Fix (small, reversible,
   B-line): while `data-pane="open"` and not `data-cockpit-fit="full"`, give `.banner` `right: 624px`,
   as `cockpit.css:48` already does for `.toasts`. At full width, put it above the input row
   (`bottom: var(--ck-row-h) + tape`). Add a test step: offline board with the room live, and
   `elementFromPoint` at SEND's bottom edge is SEND.

4. **The keyboard covers the input row, and on a content-resizing browser it closes the pane.** T24
   is pending, so this is expected for now. I record what I measured for T24:
   - `index.html` and `galaxy.html` do not write out `interactive-widget=resizes-visual` (`probe2.txt`
     "meta viewport"), and §7.1 asks for it. `virtualKeyboard.overlaysContent` is `false`.
   - `p2-1368x532.png`: I shrank the layout viewport to the keyboard-up size (1368x532) with the
     input focused and a draft. The pane closed, `[data-cockpit-open]` left the DOM and the focus
     went to `BODY`; the draft survived. On any browser that resizes content for the keyboard, the
     first tap in the input therefore closes the pane.
   - This is a spec contradiction for the owner. §7.1 says "A desktop window made shorter with the
     input focused counts as `up`; the layout below fits it as well", and its worked example is
     1368x532. §1.2 says "Below the floor (`innerWidth` < 700 px or `innerHeight` < 560 px …) an
     open pane closes as with `CLOSE`". At 532 px §1.2 wins. The build follows §1.2, which I think is
     right for a real short window. The owner should say whether the floor ignores height while the
     input has the focus (D250 is newer than D130/D131, so the build's reading stands).

5. **Disabled controls look live.** `p2-1368-settled.png` and `800-dark-draft.png`: `NEW` (disabled
   until T29, B111) and `SEND` (disabled with an empty input) keep the full `--line-strong` border and
   the `--bg-elevated` fill. Only the text turns `--text-3`: dark 0.62 against 0.96, light 0.46
   against 0.15. At 60 cm, `NEW` beside `CLOSE` reads as two buttons. A tap on it does nothing and,
   correctly, draws no pressed state (D224), so the owner gets a dead tap with no explanation. The
   spec does not set a disabled look. Fix (B-line, reversible): a disabled `.ck-btn` takes a `--line`
   border, so the frame recedes along with the word. Better still, do not draw `NEW` until T29 if
   S-SCR-25's rect table allows it then.

6. **Tests do not prove the touch half of what they cover.** S-C1-04 and S-C1-45 tap with
   `locator.tap()` (good). No step checks focus after SEND (finding 1), what lies over the input row
   (finding 3), or a tap that lands while the 120 ms slide runs. `probe2.txt` shows CHAT then SEND
   40 ms later does send, which is fine but unproven. S-C1-41's table (T42) will cover the pressed
   state. Until then nothing fails if a change adds a `transition` on `background-color`.

## Checked and fine

- Sizes: CHAT/CLOSE 48x48, header CLOSE 96x48, NEW 72x48, SEND 64x64, RETRY NOW 88.6x48, at 1368,
  1024 and 800, matching §1.2's table exactly (`probe.txt`). `touch-action: manipulation` on all of
  them.
- An accidental touch between corner `CLOSE` and `SEND` (16 px gap, 12 px contact radius): contacts
  from y 806 to y 816 resolve to `CLOSE`, and further down to nothing (`probe2.txt`). The worst case
  closes the pane with the draft kept, so nothing is sent by mistake.
- A touch open does not focus the input (`pointer: coarse`, D20), so no keyboard appears on open.
- A tap on the Map behind the pane leaves it open (D19). At 800 wide, header `CLOSE` and corner
  `CLOSE` are both in thumb reach, and `CLOSE` keeps the draft.
- Type: no text under 16 px in the pane. Prompt and reply are 28 px mono, labels 16 px caps
  `--text-3`, and the room-down line is 18 px. It is readable at arm's length in both themes.

## Spec vs build

- §7 "On send" against the build (finding 1): the spec is right. The keyboard staying up is the
  whole point of typing on the tablet.
- §7.1's 1368x532 example against §1.2's height floor (finding 4): a spec question for the owner. The
  build's reading (the floor wins) is the safer one for now.
- The `#offline` banner beside an open pane (finding 3): the spec is silent. Build the toasts' rule
  and record it as a B-line.

## Rubric

score pane spec 6
score pane tests 6
score pane legibility 8
score pane touch 4
score pane speed 8
score pane safety 8
score room spec 7
score room tests 7
score room legibility 6
score room touch 6
score room speed 7
score room safety 7

## Console lines read

`shots/28-t18b/console.txt`:
```
app-dark text<16: []
app-light text<16: []
```

`shots/r26-stream/console.txt`:
```
[GroupMarkerNotSet(crbug.com/242999)!:A0A020002C020000]Automatic fallback to software WebGL has been deprecated. Please use the --enable-unsafe-swiftshader (about:flags#enable-unsafe-swiftshader) flag to opt in to lower security guarantees for trusted content.
[.WebGL-0x1ff40011f000]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels
[.WebGL-0x1ff40011f000]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels
[.WebGL-0x1ff40011f000]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels
[.WebGL-0x1ff40011f000]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels (this message will no longer repeat)
wall-dark text<16: []
```

My own probes (`probe.txt` "console"): in every run, 0 page errors while the room was up. After I
stopped the room, each of the six runs logged three pairs of these, which are the browser's own
reports of the expected refused reconnects (port varies):
```
error: WebSocket connection to 'ws://127.0.0.1:<port>/api/cockpit/ws' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
error: WebSocket connection to 'ws://127.0.0.1:<port>/ws' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED
```
`probe2.txt`: `console []`.
