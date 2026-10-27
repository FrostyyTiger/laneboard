# C1 Talk

The cockpit pane and the conversation in it: where the pane sits, how it opens and closes, how a
reply is drawn for reading at arm's length, and how tool activity folds into one line (§1-§5, part
1, T4). Typing and send, talking while the agent answers, long replies, errors, a new conversation,
several screens are part 2 (§7-§14, T5); the raw view is not in C1 (§13, T50). Words as in the glossary (`README.md`). Sizes are CSS
px at 1368x912; times in s or ms.

Plan C1: "It slides over the view, never replaces it, so the agent can point at the view behind
it." "Replies are always text, rendered for reading at arm's length: large type, short blocks, code
and tables readable, tool activity collapsed to one line each ("read 3 feeds", "looked at CI on
main")."

## 1. Where the pane sits

| Page / layout | Pane rectangle at 1368x912 | Notes |
| --- | --- | --- |
| Wall page, `wall` | x 760-1368, y 0-912 (608 x 912) | slides over the right 608 px of the Wall; the left 759 px stay in sight |
| Wall page, `switch` | as `wall`, on the canvas half | `screens.md` §3: opening it from the wall half flips to the canvas |
| Wall page, `split` and `canvas` | no sliding pane: the conversation is a fixed column of the canvas (pending Q-O12; sketch T25) | §3-§5 of this file apply to that column unchanged |
| App, every view in `VIEWS` | x 760-1368, y 36-888 (608 x 852): under the 36 px header, above the 24 px tape | covers the inspector (360 px) while open; `z-index` 35, between `--z-tape` 30 and `--z-sheet` 40 |

- The width is **608 px** everywhere, the same constant as the canvas column (`screens.md` §1, D6),
  so a reply wraps the same way in the pane and in the column (D18). Narrower than 1216 px the pane
  is `min(608px, 100vw)` wide.
- Background `--bg-elevated` (a floating layer, `docs/design.md` "Surfaces"), a 1 px `--line`
  left border, no shadow.
- While the pane is open, the view behind keeps working in the part that is in sight: the Wall
  explores, the Map pans and selects. A show command (T10) centres its target in the part in sight
  (x 0-759), not in the whole screen.
- The page root carries `data-pane="open|closed"`; the pane element is `[data-cockpit-pane]`.

### Inside the pane, top to bottom

1. **Header**, 64 px, 1 px `--line` bottom border. Left, 24 px in: `COCKPIT` (`--font-label` caps
   16 px, `--text-2`), then 16 px later the turn state (§2) in 16 px caps `--text-3`. Right, 16 px
   in: `CLOSE`, and on the Wall page `SCREEN` to its left (`screens.md` §1), 8 px apart. Each
   header button is 48 px tall, ≥ 96 px wide, 16 px caps `--text-1`, 1 px `--line-strong` border.
   Left of those, 8 px apart: `NEW` (§11), 48 px tall and 72 px wide (D38); order from the right:
   `CLOSE`, `SCREEN`, `NEW`. There is no `RAW` button in C1 (§13).
2. **Status line**, 80 px (two lines, D54), only while there is something to say (room down, offline:
   `screens.md` §7).
3. **The conversation**, filling the rest; it scrolls on its own; 24 px padding left and right,
   16 px at the top. Text column: 560 px.
4. **Input row**, 1 px `--line` top border. The **talk button** (64x64 px) sits exactly where the
   cockpit button sits on that page (`screens.md` §4): bottom right, 24 px from the right edge; its
   bottom edge 24 px above the screen's bottom on the Wall, 16 px above the tape in the app. Left
   of it, 16 px apart: `SEND` (64x64 px) and the text input (64 px tall, mono 22 px, `--bg-sunken`,
   from x 784 to x 1184). Typing, `SEND` and the input's growth are T5's; the talk button's states
   are T6's. The row is 104 px tall on the Wall (16 + 64 + 24), 96 px in the app (16 + 64 + 16).

## 2. Opening and closing

**The opener** (pending Q-O11). The recommendation makes the bottom-right 64x64 button the talk
button (one press to talk, as a held key in the terminal) and adds a smaller opener for typing and
reading: `CHAT`, 48x48 px, 16 px caps, `--text-1` on `--bg-elevated`, 1 px `--line-strong` border,
centred above the talk button with 16 px between (on the Wall x 1288-1336, y 760-808). It is
`[data-cockpit-open]`. If the owner picks Q-O11 b), the opener is today's `AGENT` button (D7) and
these rules apply to it unchanged.

**Open.** A tap on the opener (or a press on the talk button, T6) opens the pane:
- It slides in from the right: `transform: translateX(608px)` to `0`, 120 ms, `--ease`
  (`docs/design.md` rule 5). The pane is in place ≤ 0.2 s after the tap (B7).
- While open, the opener is hidden (`CLOSE` in the header takes its job).
- The conversation is scrolled to its end: the latest turn is in sight.
- The input gets the keyboard focus only when the page's pointer is fine (a mouse, a paired
  keyboard: `matchMedia('(pointer: fine)')`); on a touch screen it does not, so the on-screen
  keyboard does not cover half the pane on every open (D20). A tap in the input brings the keyboard.
- The tour stops where it is and the idle timer pauses (`screens.md` §2, D4).

**Close.** `CLOSE` in the header, `Esc` on a paired keyboard, or the auto-close (`screens.md` §2,
D5, pending Q-O12) close it: it slides out in 120 ms, the opener shows again. A tap on the view
behind the pane does **not** close it: it acts on the view (explore, select), so the owner can
point while the agent talks (D19). There is no swipe to close in v1 (D19).

**Kept across close and open:** the conversation, the scroll position if the owner had scrolled up
(§4), a draft in the input (`screens.md` S-SCR-04), expanded tool lines.

**Reduced motion** (`prefers-reduced-motion: reduce`): the pane appears and goes with no slide
(`--dur` is 0 ms in `tokens.css`).

**Turn state**, in the header and on the root as `data-turn`. The header draws three words; the
root keeps the finer values for tests (D56): what the agent is doing is already in sight in the
conversation (`· SENDING` on the prompt, `●` on a tool line, the `▍` cursor).

| `data-turn` | Header text | When |
| --- | --- | --- |
| `idle` | `READY` | no turn running |
| `thinking` | `● WORKING` | a prompt was sent; no reply text yet, no tool running |
| `working` | `● WORKING` | a tool call is running (§5) |
| `answering` | `● WORKING` | reply text is streaming |
| `stopping` | `● STOPPING` | `STOP` was tapped or a new prompt interrupts; until the turn's end arrives (≤ 5 s, §8) |

The `●` is `--text-2`, static (nothing blinks for decoration). Speaking up without a prompt
(`coworker.md`) uses the same states.

## 3. A turn in the conversation

A turn is drawn top to bottom in the order things happened: the prompt, then the reply's text
blocks, tool lines (§5) and show-command lines (T10) interleaved as the agent produced them.

- **Label row** above the prompt and above the reply, 24 px tall, 16 px caps `--text-3`:
  `YOU · 07:02` (`YOU · SPOKEN · 07:02` for a voice prompt, C2) and `AGENT · 07:02`. Time is the
  screen's local `HH:MM`, 24 h.
- **The prompt**: mono 22 px, line height 1.4, `--text-1`, in a block on `--bg-surface` with a
  1 px `--line-weak` border and 12 px / 16 px padding.
- **The reply**: mono 22 px, line height 1.4, `--text-1`, straight on the pane's background.
  At 22 px a 560 px column holds 42 characters per line.
- Spacing: 32 px between turns, 16 px between blocks of one reply, 8 px between a label row and
  its block.
- The type sizes are named constants in the module of D6 (D21, pending Q-O9: the tablet's panel
  size decides whether 22 px reads well at the owner's distance; research Q1 puts the floor at
  about 22 px at 60 cm on a 12.3 in panel).

### Streaming

- Reply text is appended as the bridge's text deltas arrive (`protocols.md`, T16), drawn at most
  once per animation frame. A line still being written is drawn as plain text until its newline
  arrives; then the line takes its markup (a table row, a list item). An open code fence is drawn
  as a code block until it closes.
- While text streams, a static block cursor `▍` in `--text-3` follows the last character.
- When the bridge sends a text block complete, it **replaces** the text built from the deltas (a
  lost delta cannot leave wrong text, research Q2).
- **Budget:** the first reply text is on screen ≤ 0.5 s after the fake agent sends its first delta
  (B4, the speed budget in `README.md`).

### What a reply may contain (D22, D23)

The reply is Markdown, drawn with this subset; anything else shows as its plain text.

| Markdown | Drawn as |
| --- | --- |
| paragraph | 22 px text; blocks separated by 16 px |
| `#`, `##`, `###` heading | one style: 16 px caps `--font-label` 600, `--text-2`, 24 px above |
| `**bold**` | weight 600 (the mono face has 400 and 600 only; `*italic*` draws as plain text) |
| `` `code` `` inline | same size, `--bg-sunken`, 1 px `--line-weak` border, 4 px side padding |
| bullet and numbered lists | marker `·` or `1.` in `--text-3`, 32 px hanging indent; 2 levels, deeper levels draw at level 2 |
| `> quote` | `--text-2`, a 2 px `--line-strong` left border, 16 px padding |
| `---` | a 1 px `--line` rule, 16 px above and below |
| fenced code block | §3 "Code" below |
| table (GFM pipes) | §3 "Tables" below |
| `[text](url)`, a bare URL | the text, 1 px `--line-strong` underline, then ` (host)` in `--text-3`; **not tappable** (D22) |
| `![alt](url)` | `[image: alt]` in `--text-3`; nothing is fetched |
| raw HTML (`<b>`, `<img …>`, `<script>`) | shown as its literal text, escaped; never parsed (D22) |

**Colour in a reply** (D25): the text is `--text-1` and `--text-2` only. The four status marks are
the one exception and take their colour wherever they appear: `■` `--p1`, `▲` `--p2`, `●` and `○`
grey (`docs/design.md`, the colour rule; `public/js/core/marks.js`). The agent cannot colour
anything else: a word "down" with no mark stays grey.

**Code.** Mono 18 px, line height 1.4, `--bg-sunken`, 1 px `--line` border, 12 px / 16 px padding.
Lines never wrap; the block scrolls sideways on its own. The fence's language, if given, sits top
right in 13 px caps `--text-3`. A block of more than 12 lines shows its first 12 and a full-width
button under it, 48 px tall, 16 px caps: `SHOW ALL 40 LINES`; tapped, it shows every line and reads
`SHOW LESS`.

**Tables.** Header cells 16 px caps `--font-label` 600, `--text-3`; body cells mono 18 px
`--text-1`; every row 44 px tall (`--row-touch`), 12 px cell padding left and right, a 1 px
`--line-weak` line under each row. A column whose body cells are all numbers, times or sizes
(`12`, `3.4 GB`, `1 h 12`, `41 %`, `03:12`) is right-aligned. A table wider than 560 px scrolls
sideways inside its block with the first column fixed (on `--bg-elevated`). Every row is drawn,
however many (D23: 20 rows are 880 px, one flick).

### History in the pane

The pane draws the last 50 turns. Older turns, if the screen holds them, come back with
`SHOW EARLIER` (full width, 48 px, 16 px caps) at the top of the conversation, 50 at a time (D27).
The screen holds the conversation in memory only (`screens.md` D14); what a screen gets from the
room after a reload is T15's.

## 4. Following a reply as it grows

- The conversation is **pinned** to its end while its last pixel is within 48 px of the bottom of
  the visible area: new text scrolls it along.
- A drag up unpins it: new text no longer moves the view. A button `↓ NEW` appears, 48 px tall,
  ≥ 96 px wide, 16 px caps `--text-1` on `--bg-elevated`, 1 px `--line-strong` border, centred 16
  px above the input row. A tap jumps to the end (instantly, no smooth scroll: `docs/design.md`
  rule 5) and pins again; scrolling back down by hand does the same (D26).
- Opening the pane always shows the end, unless the owner had scrolled up before closing it (§2).

## 5. Tool lines

The agent's tool calls are shown as **tool lines**, never as raw input or output. An opened tool line
(below) is the closest look C1 gives at a call (§13).

**Folding.** In one turn, calls of the same tool with no reply text between them fold into one tool
line. A call of another tool, or reply text, starts a new line. A tool line sits in the reply where
its first call happened.

**Look.** One row, 44 px tall, the full text column, mono 18 px `--text-2`. A 24 px glyph column at
the left holds `●` (`--text-2`, static) while any call in the line runs, nothing once all have
ended. While running the text ends in `…`. At the right end, `+` (closed) or `−` (open) in 16 px
`--text-3`. The whole row is the tap target.

**Words** (D24). Each tool has a `one` text (one call, or every call on the same target) and a
`many` text (`{n}` calls on different targets). `{target}` is one field of the call's input,
shortened to 32 characters with `…`. The table lives in one client module keyed by tool name;
the laneboard MCP tools arrive as `mcp__laneboard__<tool>` and are matched without the prefix.

| Tool | `{target}` from | `one` | `many` |
| --- | --- | --- | --- |
| `fleet` (C3) | `site` | `read the feed of {target}`; no site: `looked at the fleet` | `read {n} feeds` |
| `runs` (C3) | `run` | `looked at run {target}`; none: `looked at the runs` | `looked at {n} runs` |
| `lanes` (C3) | `builder` | `looked at the lanes on {target}` | `looked at lanes on {n} builders` |
| `ci` (C3) | `branch` | `looked at CI on {target}` | `looked at CI on {n} branches` |
| `alerts` (C3) | none | `read the alerts` | `read the alerts {n}×` |
| `morning` (C3) | `window` | `read the Morning for {target}` | `read the Morning {n}×` |
| `history` (C3) | `node`, else `run` | `read the history of {target}` | `read the history of {n} nodes` |
| `focus` (C3) | none | `looked at this screen` | `looked at this screen {n}×` |
| `Read` | `file_path`, last path part | `read {target}` | `read {n} files` |
| `Grep`, `Glob` | none | `searched the files` | `searched the files {n}×` |
| `Bash` | `command`, first word | `ran {target}` | `ran {n} commands` |
| `WebFetch` | `url`, host only | `fetched a page from {target}` | `fetched {n} pages` |
| `WebSearch` | none | `searched the web` | `searched the web {n}×` |
| `Edit`, `Write` | `file_path`, last path part | `changed {target}` | `changed {n} files` |
| `Task` | none | `asked a helper agent` | `asked {n} helper agents` |
| any other tool | none | `used {name}` (another MCP server's tool: `used <server>:<tool>`) | `used {name} {n}×` |

The C3 rows follow the tools' parameters in `c3-see.md` §4 (T8: `morning` takes `window`,
`history` takes `node` or `run`). Show commands (`fly_to`, `pin`, …) are not tool lines: each leaves
its own conversation line (T10).

**Failures.** A line with failed calls appends ` · 1 failed` (or ` · 2 failed`) in the same grey: a
tool error is news about the agent, not trouble in the fleet (`docs/design.md`, the colour rule).

**Open.** A tap on the row opens it: under it, one row per call, mono 16 px `--text-2`, 8 px
indent: `<tool>  <input as compact JSON, cut at 120 characters>  <ms> ms  ok|failed`. A second tap
closes it. Tool output is never shown here. Text from tool input is drawn as text, never as
markup (`security.md`, T17).

**The agent's writing.** The screen does not shorten replies. "Short blocks" is asked of the agent:
the room's standing instructions for the agent (the bridge's, T16) say: lead with the answer in
one sentence; at most 3 sentences per paragraph; a table for 3 or more items that share fields;
code only when asked; marks `■ ▲ ● ○` before trouble words. Long replies are §9.

## 6. Scenarios

The fake agent (T18) replays scripted turns: text deltas with times, tool calls and their ends.
Every scenario runs at 1368x912 against the demo hub, the stand-in room and the fake agent, on a
paired screen.

### S-C1-01 The pane opens from the Wall in 0.2 s and leaves the wall in sight (pending Q-O11)
Given a screen in `wall` layout touring, the pane closed,
When the owner taps `[data-cockpit-open]` at t = 0 ms,
Then by t = 200 ms `data-pane="open"`, the pane's rect is x 760, y 0, 608 x 912, its transform is
`none`; the slide's computed `transition-duration` is 120 ms; the opener is hidden; the talk
button's bottom-right corner is at (1344, 888); `data-wall-state="explore"`; the latest turn's last
line is in sight; `document.activeElement` is not the input.
Test: Playwright with `hasTouch: true`; tap; at 200 ms read the rects, the computed transition and
`document.activeElement`; a second run with a mouse click asserts the input has focus.

### S-C1-02 Closing: CLOSE and Esc close it, a tap on the wall does not
Given S-C1-01's open pane with the draft `how is` in the input,
When the owner taps the map at (400, 480),
Then the pane stays open and `data-wall-state` is `explore` with the camera moved to the tap.
When the owner taps `CLOSE` at t = 0 ms,
Then by t = 200 ms `data-pane="closed"`, the pane is off screen, the opener shows.
When the owner opens the pane again, the draft `how is` is in the input; `Esc` on a keyboard closes
it again.
Test: Playwright; tap coordinates on the wall; assert `data-pane` after each step; `keyboard.press('Escape')`.

### S-C1-03 The pane over the Map leaves the Map usable
Given the app on `#/map` at 1368x912 with a node selected and the inspector open,
When the owner opens the pane,
Then the pane is at x 760, y 36, 608 x 852; the header and the tape are not covered; the
inspector is under the pane; `location.hash` is unchanged; a drag on the Map at (300, 400) pans it
and a tap on another node at x < 760 selects it, with the pane still open.
Test: Playwright; read the pane rect and its computed `z-index` (35); compare the hash; drag and
tap, assert the Map's selection changed and `data-pane="open"`.

### S-C1-04 A reply streams in, then settles
Given the pane open and the fake agent scripted to wait 300 ms after a prompt, then send
`Two of three runs finished.` in 6 deltas 100 ms apart, then the complete block,
When the owner sends `how did the night go?` at t = 0,
Then `data-turn` is `thinking` and the header reads `● WORKING` within 0.1 s (B8); the first word
is on screen ≤ 0.5 s after the first delta (B4) and `data-turn="answering"`; the cursor `▍` follows the
text; after the complete block the reply reads exactly `Two of three runs finished.`, the cursor
is gone and the header reads `READY`.
And a script that drops delta 4 still ends with the exact text, from the complete block.
Test: Playwright with the fake agent's timed script; poll the reply text and `data-turn` every
50 ms; compare the times against the script's send times.

### S-C1-05 A table is readable at arm's length
Given a fake-agent reply holding a 4-column table (`run`, `builder`, `state`, `time`) with 3 rows,
the `time` column `1 h 12`, `0 h 48`, `2 h 05`,
When it has streamed in,
Then the header cells are 16 px caps, the body cells mono 18 px, every row 44 px tall, the `time`
column right-aligned, the other columns left-aligned; a second reply with a 9-column table scrolls
sideways inside its block, its first column stays put while the others move, and the pane itself
does not scroll sideways.
Test: Playwright; `getComputedStyle` font sizes and `text-align`; row rects; scroll the table
element by 200 px and compare the first and second columns' x.

### S-C1-06 Tool calls fold into one line each, with live counts
Given a fake-agent turn that calls `mcp__laneboard__fleet` with `site` `hv1`, `hv2`, `hv3` (each
400 ms, one after the other), then `mcp__laneboard__ci` with `branch` `main` (300 ms), then sends
text,
When it plays,
Then the reply shows exactly two tool lines above the text: first `● read the feed of hv1…`, which
becomes `● read 2 feeds…` and `● read 3 feeds…` as the calls start, and `read 3 feeds` with no `●`
when the third ends; then `looked at CI on main`; `data-turn` is `working` while a call runs.
Test: Playwright; sample the tool lines' text and `data-turn` every 100 ms against the script;
count `[data-tool-line]` elements: 2.

### S-C1-07 A tool line opens to show its calls; a failure stays grey
Given S-C1-06's turn, with the `hv2` call ending failed,
When it has ended,
Then the first line reads `read 3 feeds · 1 failed` in `--text-2`, with no `--p1` or `--p2`
colour; a tap on it shows 3 rows starting `fleet  {"site":"hv1"}`, `fleet  {"site":"hv2"}`, … with
their ms and `ok` / `failed`; a second tap hides them; the row is ≥ 44 px tall.
Test: Playwright; assert text and computed colour; tap; count child rows; tap again.

### S-C1-08 A long code block shows 12 lines and a button for the rest
Given a fake-agent reply with a fenced `sh` block of 40 lines, one of them 200 characters long,
Then the block shows 12 lines, `SH` top right, and `SHOW ALL 40 LINES` (48 px tall) under it; no
line wraps and the block scrolls sideways; a tap shows 40 lines and `SHOW LESS`.
Test: Playwright; count visible line boxes; compare the block's `scrollWidth` with its
`clientWidth`; tap; count again.

### S-C1-09 Markup from the agent is shown, never run or fetched
Given a fake-agent reply containing `<img src=x onerror=alert(1)>`, `<script>alert(2)</script>`,
`![chart](https://example.invalid/c.png)` and `[the run](https://example.invalid/run/7)`,
Then the first two show as their literal text; the image shows `[image: chart]`; the link shows
`the run (example.invalid)` underlined, and a tap on it changes neither `location` nor opens a
page; no dialog opens and the page makes no request to `example.invalid`.
Test: Playwright with `page.on('dialog')` failing the test, `page.on('request')` recording
hosts, and `context.on('page')` failing on a new page; assert the texts.

### S-C1-10 Scrolled up during a reply: the view stays, `↓ NEW` brings it back
Given a pane with 10 earlier turns and the fake agent streaming a 30-line reply over 6 s,
When the owner drags the conversation down by 600 px at t = 1 s (scrolling up),
Then from then on the conversation's `scrollTop` does not change while text arrives; `↓ NEW`
shows 16 px above the input row; a tap on it at t = 4 s puts the last line in sight and the
following text keeps it there; `↓ NEW` is gone.
Test: Playwright touch drag; sample `scrollTop` every 100 ms; tap `↓ NEW`; assert the last line's
rect is inside the conversation's rect until the turn ends.

### S-C1-11 Only the marks are coloured
Given a fake-agent reply `■ builder-b is down. ▲ nightly-ci is stuck. ● 2 runs working.`,
Then `■` is drawn in `--p1`, `▲` in `--p2`, `●` in `--text-2`, and every other character in
`--text-1`; the word `down` is not red.
Test: Playwright; each mark is its own element (`[data-mark]`); read the computed `color` of the
three marks and of the paragraph, compare with the tokens' computed values.

### S-C1-12 Reduced motion: the pane appears with no slide
Given `prefers-reduced-motion: reduce`,
When the owner opens and closes the pane,
Then the pane is in its final place in the first frame after each tap (computed
`transition-duration` 0 s) and the `↓ NEW` jump and the tool-line opening have no transition.
Test: Playwright `emulateMedia({ reducedMotion: 'reduce' })`; read the pane rect in the next
`requestAnimationFrame` after the tap.

### S-C1-13 Hold the button on the touring Wall: words in 1 s, release sends (pending Q-O11)
Given a screen in `wall` layout touring, the pane closed, the conversation idle; the fake speech
service scripted to send the partials `how` at 0.6 s, `how did the` at 1.2 s and `how did the
night go` at 1.8 s after the first audio frame, and the final `How did the night go?` 0.15 s after
the stop; the fake agent scripted to send its first delta 0.3 s after the prompt,
When the owner presses the bottom-right 64x64 button (centre (1312, 856)) at t = 0 and holds it,
then releases it at t = 2.5 s,
Then by t = 0.2 s the button shows its listening state (`data-talk="listening"`, T6), the screen
is sending audio frames, `data-wall-state="explore"` with the tour stopped, and the pane is opening
with the live words in its input (B1, B7); `how` is drawn in the input by t = 1.0 s (B2) and is
replaced in place by `how did the` and `how did the night go`, never appended twice; no prompt is
sent while the button is held;
And by t = 2.8 s the conversation shows `YOU · SPOKEN · HH:MM` over `How did the night go?`, the
input is empty, `data-talk` is back to idle and `data-turn="thinking"` (B3); the first reply text
is drawn ≤ 0.5 s after the fake agent's first delta (B4).
With Q-O11 b) the press opens the pane only; this scenario then starts with a press on the talk
button inside the open pane and the same timings hold from that press.
Test: Playwright with `hasTouch: true`, Chromium started with `--use-fake-device-for-media-stream`
and `--use-fake-ui-for-media-stream`; `touchscreen` down at t = 0 and up at 2.5 s (via CDP
`Input.dispatchTouchEvent`); read the marks `cockpit:B1`…`cockpit:B4` and `cockpit:B7`
(`performance.getEntriesByName`) and assert each against its row; sample the input's value every
50 ms and assert the sequence `how` → `how did the` → `how did the night go`; count the frames the
fake speech service received before t = 0.2 s (≥ 1).

## 7. Typing and sending

Plan C1: "Typing works everywhere (on-screen keyboard, a paired keyboard)." `spec-input.md` §4:
"Typing must always work too: many users will prefer it."

- **The input** is a `<textarea>` `[data-cockpit-input]`, x 784-1184 (§1), mono 22 px, line height
  1.4, 16 px padding left and right: about 27 characters per line. Placeholder `Type or hold to talk`
  in `--text-3` (pending Q-O11). `enterkeyhint="send"`, `autocapitalize="sentences"`,
  `spellcheck` on.
- **It grows** with its text: 64 px for one line, +31 px per line up to 4 lines (157 px); beyond 4
  lines it scrolls inside. It grows upwards; the input row grows with it and the conversation
  above gets shorter; `SEND` and the talk button stay at the row's bottom (D30).
- **`SEND`** `[data-cockpit-send]`, 64x64 px, 16 px caps. Disabled (`disabled`, label `--text-3`)
  while the input holds only white space and while the room is down (`screens.md` §7). During a
  turn its job changes (§8).
- **Keys** (D30): `Enter` sends, on a paired keyboard and on the on-screen keyboard alike (the
  terminal's habit); `Shift+Enter` makes a new line. `Esc` closes the pane (§2), the draft stays.
- **Length.** A prompt is at most 8 000 characters. Above that, a 13 px caps note in `--text-2`
  sits 8 px above the input's top edge, right-aligned: `8 214 / 8 000 CHARACTERS`, and `SEND` is
  disabled. Pasting is never cut short by the screen (D30).
- **What is sent**: the text with white space trimmed at both ends; inside, unchanged.

**On send** (B8, ≤ 0.1 s): the prompt block is drawn at the end of the conversation with the label
`YOU · 07:02 · SENDING` (the `SENDING` in `--text-3`), the input is emptied, the conversation is
pinned to its end (§4), `data-turn="thinking"`. Keyboard focus stays where it was (an on-screen
keyboard stays up). When the room confirms it has the prompt (T15), `· SENDING` goes. No
confirmation within 5 s while the room link is up: §10, E1 (D31).

## 8. Talking while the agent answers (pending Q-O1)

Written for Q-O1's recommendation a), **interrupt on send**: speaking again mid-answer is almost
always a correction, and waiting would lose the terminal's speed (`spec-input.md` §1, §7.1).

- **One slot, two jobs** (D32). While `data-turn` is `thinking`, `working` or `answering`:
  with an empty input the `SEND` slot reads `STOP` (`data-send="stop"`); with text in the input it
  reads `SEND` (`data-send="send"`). While idle it is always `SEND`. 13 px caps `--text-2` above the
  input, left-aligned, only while a turn runs and the input holds text: `SENDING STOPS THE ANSWER`.
- **`STOP`** (or `Ctrl+C` on a paired keyboard with the input empty): `data-turn="stopping"` within
  0.1 s; the room asks the bridge to interrupt (T16). The turn ends when the bridge reports its end;
  if that has not happened 5 s after the tap, the room forces it (for Claude Code: `SIGINT`,
  research Q2) and the line reads `Stopped at 07:03 (forced).`. Either way `READY` by 5.5 s.
- **What a stopped turn looks like** (D33): its text stays exactly as it was at the tap; nothing
  that turn sends later is drawn (the room's log keeps it). Under it, 16 px caps
  `--text-3`: `STOPPED AT 07:03`. A tool line still running loses its `●` and ends in ` · stopped`.
  The `▍` cursor goes.
- **`SEND` during a turn** does both at once: the running turn is stopped as above, and the new
  prompt is drawn at once (B8) below the stopped one as a new turn; the agent receives it as soon
  as the old turn has ended (the bridge orders the two, T16). The header goes `● STOPPING`, then
  `● WORKING` for the new turn (`data-turn` `stopping`, then `thinking`).
- **Voice** (C2): pressing the talk button during a turn does not stop anything; listening starts
  (D29); the send at release stops the turn as `SEND` does (T6).
- A turn the agent started itself (speaking up, `coworker.md`) is stopped the same way.
- With Q-O1 b) (queue) the slot stays `SEND`, a sent prompt shows `· QUEUED` until the turn ends;
  with c) (ignore) `SEND` and talk are disabled during a turn and `STOP` stays.

## 9. Long replies and long turns

The screen never shortens what the agent wrote (§5) and draws a long reply whole; the owner flicks
through it (D35). Only code blocks fold (§3) and only old turns (`SHOW EARLIER`, §3).

- **Elapsed time** (D35). Once a turn has run 10 s, the reply's label row shows its age:
  `AGENT · 07:02 · 0:12`, counting each second (`m:ss`, from 1 h `h:mm:ss`), until the turn ends;
  then the label keeps the total: `AGENT · 07:02 · 1:48`. Turns under 10 s show no age.
- **A long silence is not an error.** As long as the room's heartbeat (every 10 s, D10) says the
  agent is alive, a turn may think or work for any time; the label's age shows it. The owner ends
  it with `STOP`. A lost room link is `screens.md` §7.

## 10. Errors

Every error is a **grey line in the turn** where it happened, never a dialog, never red: it is news
about the agent, not trouble in the fleet (`docs/design.md`, the colour rule; as tool failures, §5).
Look: 18 px mono `--text-1` on `--bg-sunken`, 1 px `--line-strong` border, 12 px / 16 px padding;
buttons under the text, 48 px tall, ≥ 96 px wide, 16 px caps, 8 px apart. The element is
`[data-turn-error="<code>"]`. Text from the room or the agent inside a message (`{detail}`) is cut
to 120 characters and drawn as text. After an error the header reads `READY` (D34).

| Code | When | Message (exact) | Buttons |
| --- | --- | --- | --- |
| E1 `not-sent` | the room has not confirmed a prompt 5 s after send, link up | label `YOU · 07:02 · NOT SENT`; `Not sent: the room did not confirm within 5 s.` | `RETRY` sends the same text again; `EDIT` removes the block and puts the text back in the input (an existing draft is kept after it, on a new line) |
| E2 `agent-exited` | the agent's process ended during a turn | `The agent stopped unexpectedly at 07:04. The room is starting it again.`, then, once back: `The agent is back (07:04). Your last message was not answered.` | `RETRY` (only once the agent is back) sends that turn's prompt again |
| E3 `agent-down` | the agent cannot start | `The agent cannot start: {detail}. The room tries again every 30 s.` plus the status line (§1) `Agent not running since 07:04.`; `SEND` and talk disabled, the draft kept | none |
| E4 `not-logged-in` | the agent reports missing login or key | `The agent is not logged in on the room. Log it in there, then send again.` | none |
| E5 `model-busy` | the model service is retried by the agent | not an error line: a tool-line-style row in `--text-3`, `the model service is busy, retrying (2 of 10)`, replaced on each retry, gone when text arrives | none |
| E6 | retired (T50): a model-service error is E8, its `{detail}` the service's own message (D57) | | |
| E7 `step-limit` | the turn ends because the agent's step limit is reached | `Stopped after {n} steps, the agent's limit.` | `GO ON` sends `Go on.` as a new prompt |
| E8 `failed` | any other error end of a turn, the model service's included | `The answer failed: {detail}.` | `RETRY` |

- **Nothing is ever sent again on its own** (D34, as D12): `RETRY`, `EDIT` and `GO ON` act only on a
  tap. A `RETRY` is a new turn with the same text; the failed turn stays above it.
- Which native event of the agent maps to which code is T16's mapping table; Claude Code's
  `api_retry` is E5 and a `result` with `is_error` is E7 or E8 (research Q2).
- An error line is shown on every screen (§12); its buttons work from any of them.

## 11. A new conversation (pending Q-O2)

Written for Q-O2's recommendation d) (T51, `reviews/36-skeptic.md` finding 4): **a `NEW` button
only**, plus a forced fresh start when the session cannot go on, and **no handover note**. Plan C1:
"a 'new conversation' button; on a fresh start the agent reads the same written context a laptop
session would."

- **Ask first** (D36). A tap on `NEW` shows a bar in the status-line slot (§1, 48 px, under the
  header): 18 px `--text-1` `Start a new conversation? Cards, jobs and notes stay.`, and at its
  right `START` and `KEEP` (48 px tall, 96 px wide). `KEEP`, a second tap on `NEW`, or 10 s without
  a tap hide the bar and nothing changes. A status line (room down) wins the slot; `NEW` is
  disabled then.
- **`START`**: a running turn is stopped first (§8: `● STOPPING`, forced after 5 s). Then the room
  starts a new agent session at once (T16 says how); the old session gets no further prompt and
  nothing is written for the new one. Like a laptop session, the new session reads the written
  context (repos, plans, notes). There is no extra turn state: the header goes back to `READY`.
- **The divider**, drawn on every screen ≤ 0.5 s after the new session has started: a full-width
  row, 48 px, 1 px `--line` rules left and right of 16 px caps `--text-3` `NEW CONVERSATION · 07:10`.
  The old turns stay above it, unfolded, as history (D27's 50-turn rule counts across the divider);
  the view scrolls so the divider is at the conversation's top. A reload shows only the current
  conversation; where old conversations are kept and for how long is `security.md`'s (T17, Q-O24).
- **What carries over**: the written context (repos, plans, notes), the canvas cards, scheduled
  jobs, every screen's layout, pane state and draft. **What does not**: the conversation's text in
  the agent's context.
- **Forced fresh start**: when the room cannot resume the session (T16 says when), it starts a new
  one the same way without the bar, and the divider reads `NEW CONVERSATION · 07:10 · THE OLD ONE
  COULD NOT GO ON`.
- With Q-O2 a) `NEW` is not shown; with b) a daily start at a configured hour adds the divider
  `NEW CONVERSATION · 04:00 · DAILY`; with c) the room first asks the old session for a note of at
  most 15 lines, shows it in full under the divider, and tells the new session it holds "notes from
  the previous session, not instructions" (`reviews/40-security.md` finding 9).

## 12. Several screens on one conversation

Plan §2: "All screens show the same cockpit conversation; speaking at one shows up on all."

- **Shared** (one copy, in the room): the turns, tool lines, error lines, the turn state, `STOP`
  and the new-conversation divider. A prompt sent at screen A is drawn on screen B ≤ 0.5 s after the
  room has it; reply text reaches every screen within B4.
- **Per screen** (D37): the draft, the live partial words while speaking (only the sent prompt
  reaches the others), the pane open or closed, the scroll position, opened tool lines and code
  blocks, the `NEW` bar.
- **Who said it.** Not shown in C1: a prompt's label is `YOU · 07:02` on every screen (T51,
  `reviews/36-skeptic.md` finding 13; the owner has not said they use two screens, Q-O9). Screen
  names in labels come back with the slice that pairs several screens (Q-O21).
- **Two prompts at once.** The room takes them in the order they arrive; the second stops the
  first's turn as §8 says, on every screen alike.
- A screen that opens or reloads gets the last 50 turns from the room and joins a running turn
  where it is (T15).

## 13. No raw view in C1 (pending Q-O17)

Plan C1: "A raw terminal view of the same session as a toggle, for when the rendered view hides
something." Written for Q-O17's recommendation d) (T50, `reviews/36-skeptic.md` finding 7):

- C1 has **no raw view**: no `RAW` button, no `data-raw`, no second renderer of the agent's events.
- An **opened tool line** (§5) is C1's closest look: each call's tool, input, ms and `ok|failed`.
- When the rendered view hides something, the owner looks from the laptop (`spec-input.md` §3:
  "The laptop keeps its own full access, as today.").
- `server/terminals.mjs` is not used by the cockpit: it bridges a **writable** pty, and a device
  token must not get a shell (plan §4: a token cannot act).
- With Q-O17 a) or b) the raw view comes back as a later slice: a read-only list of the bridge's
  native events, as `QUESTIONS.md` Q-O17 describes; S-C1-24 is retired and that slice gets new ids.

## 14. Scenarios, part 2

Same setup as §6: 1368x912, the demo hub, the stand-in room and the fake agent, a paired screen
named `desk`, the pane open in `wall` layout unless said otherwise.

### S-C1-14 Typing: Enter sends, Shift+Enter breaks the line, the input grows to 4 lines
Given the pane open, the conversation idle, the input empty,
Then `SEND` is disabled; typing three spaces leaves it disabled.
When the owner types `how is` then `Shift+Enter` then `builder-a` then `Enter` at t = 0,
Then by t = 0.1 s the conversation ends with `YOU · HH:MM · SENDING` over the two lines `how is` /
`builder-a`, the input is empty and 64 px tall, `data-turn="thinking"` (B8); when the stand-in room
confirms, `· SENDING` goes.
And typing 6 lines (with `Shift+Enter`) makes the input 157 px tall with its own scrollbar, its
bottom edge where it was, `SEND` still at the row's bottom.
Test: Playwright `keyboard.type`/`press`; read the prompt text, the input's height and bottom, the
`SEND` rect and `disabled`; the stand-in room's received-turns log has `how is\nbuilder-a`.

### S-C1-15 Too long a prompt cannot be sent
Given the pane open,
When 8 214 characters are pasted into the input,
Then the input holds all 8 214, the note reads `8 214 / 8 000 CHARACTERS`, `SEND` is disabled and
`Enter` sends nothing; deleting 214 characters enables `SEND` and the note goes.
Test: Playwright `fill`; assert the value length, the note's text, `disabled`, and that the room's
log is unchanged after `Enter`.

### S-C1-16 Sending during an answer stops it and starts the new turn (pending Q-O1)
Given the fake agent streaming `Three runs ran last night. The first…` over 8 s, scripted to end
its turn 0.4 s after an interrupt,
When at t = 2 s the owner types `only the failed one` (the slot reads `SEND`, the note
`SENDING STOPS THE ANSWER` shows) and taps `SEND`,
Then by t = 2.1 s the new prompt block is drawn below and the header reads `● STOPPING`; the
first reply's text does not change after t = 2 s and ends with `STOPPED AT HH:MM`; by t = 2.5 s the
header reads `● WORKING` with `data-turn="thinking"`; the stand-in room's log shows the interrupt
before the new prompt.
Test: Playwright; snapshot the first reply's text at 2.0 s and 3.0 s (equal); assert the header
texts at 2.1 s and 2.5 s; read the bridge log order from the stand-in.

### S-C1-17 STOP stops; a stuck stop is forced after 5 s
Given a running turn and an empty input, the slot reads `STOP`,
When the owner taps `STOP` at t = 0,
Then by t = 0.1 s `data-turn="stopping"`; with the fake agent ending the turn at 0.3 s the reply
shows `STOPPED AT HH:MM` and `READY` by 0.4 s, the slot reads `SEND`.
And with the fake agent scripted to ignore the interrupt, at t = 5 s the room forces it, the line
reads `Stopped at HH:MM (forced).` and the header `READY` by t = 5.5 s.
Test: Playwright with a fake clock; two fake-agent scripts; the stand-in records the forced stop
(signal) in its log.

### S-C1-18 A prompt the room never confirms is not sent again on its own
Given the stand-in room scripted to accept the socket but drop the next prompt without a
confirmation,
When the owner sends `restart the tour` at t = 0,
Then at t = 5 s the label reads `YOU · HH:MM · NOT SENT` with the message
`Not sent: the room did not confirm within 5 s.` and `RETRY`, `EDIT`; at t = 60 s nothing more has
been sent. A tap on `EDIT` removes the block and puts `restart the tour` in the input; a tap on
`RETRY` (second run) sends it once, as a new turn.
Test: Playwright with a fake clock; the stand-in's drop-next verb (T32); assert texts, the input
value, and the room's received-turns count (0, then 1).

### S-C1-19 The agent's process dies mid-turn
Given a reply half drawn,
When the fake agent exits with code 1 at 07:04,
Then within 1 s the turn shows `The agent stopped unexpectedly at 07:04. The room is starting it
again.`, `data-turn="idle"`; when the stand-in has restarted the agent it changes to `The agent is
back (07:04). Your last message was not answered.` with `RETRY`; nothing is sent until `RETRY` is
tapped.
Test: Playwright; the fake agent's `exit` step; assert the two texts and the received-turns log.

### S-C1-20 Each error end of a turn has its exact message, in grey
Given fake-agent scripts ending a turn with each of: a model-service error `overloaded`, the step
limit at 40 steps, an unknown error `boom`, a missing login, and two retries before text,
When each plays,
Then the turn shows, in order: `The answer failed: overloaded.` + `RETRY`;
`Stopped after 40 steps, the agent's limit.` + `GO ON`; `The answer failed: boom.` + `RETRY`;
`The agent is not logged in on the room. Log it in there, then send again.`; the row
`the model service is busy, retrying (2 of 10)` gone once text arrives. No element uses `--p1` or
`--p2`; each error is `[data-turn-error]` with its code; the header reads `READY` after each.
A `detail` of 300 characters shows its first 120.
Test: Playwright, one script per row (table-driven); compare the texts and computed colours.

### S-C1-21 A long reply: its age shows, and it is drawn whole
Given the fake agent thinking 15 s, then streaming 120 lines and 26 000 characters over 20 s, with
a 30-row table in it,
Then at t = 10 s the label reads `AGENT · HH:MM · 0:10` and at t = 12 s `0:12`; after the turn it
keeps `0:35`; the reply's drawn text is all 26 000 characters and the table has 30 body rows; no
button inside the reply other than those of code blocks (none here); the header reads `READY`.
Test: Playwright with a fake clock; assert the label texts at 10/12/35 s, the reply's
`textContent` length, the table's row count, and that the reply holds no `button`.

### S-C1-22 A new conversation: asked, then started at once (pending Q-O2)
Given 23 turns in the conversation, no turn running, and 2 cards on the canvas,
When the owner taps `NEW`,
Then the bar `Start a new conversation? Cards, jobs and notes stay.` shows with `START` and `KEEP`;
after 10 s without a tap it goes and nothing changed (same session id, 23 turns).
When the owner taps `NEW`, then `START` at 07:10,
Then by 0.5 s the divider `NEW CONVERSATION · 07:10` is drawn under the 23 turns, which stay
unfolded above it; the header reads `READY` throughout; both cards are still on the canvas; the
fake agent receives no prompt between `START` and the owner's next prompt; that prompt goes to a
new session id.
And when a turn is running at `START`, the header reads `● STOPPING` until the turn's end arrives,
then the divider is drawn.
Test: Playwright with a fake clock; assert the bar, the divider text, the 23 turns above it, the
card count, the stand-in's received-turns log and session ids.

### S-C1-23 Two pages, one conversation
Given two pages on one room, both panes open (how each reaches the room: `screens.md` §6, pending
Q-O21),
When page A sends `how is builder-a` at t = 0,
Then by t = 0.5 s after the room has it, page B shows `YOU · HH:MM` (no screen name, §12) over
`how is builder-a`, and the reply streams on both; a draft `stop` typed on B never appears on A;
`STOP` tapped on B stops the turn on both; `NEW` tapped on A shows the bar on A only.
Test: two Playwright browser contexts against one stand-in room; assert labels, drafts and
`data-turn` on both. A test with two device tokens waits for the pairing slice (Q-O21).

### S-C1-24 (retired, T50)
The raw view is not in C1 (§13, pending Q-O17). The id is not reused.
