# C1 Talk

The cockpit pane and the conversation in it: where the pane sits, how it opens and closes, how a
reply is drawn for reading at arm's length, and how tool activity folds into one line (§1-§5, part
1, T4). Typing and send, talking while the agent answers, errors, a new conversation, several
screens and the raw terminal are part 2 (T5). Words as in the glossary (`README.md`). Sizes are CSS
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
   Part 2 (T5) adds `NEW` and `RAW` to their left.
2. **Status line**, 48 px, only while there is something to say (room down, offline:
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
  (`docs/design.md` rule 5). The pane is in place ≤ 0.2 s after the tap.
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

**Turn state**, in the header and on the root as `data-turn`:

| `data-turn` | Header text | When |
| --- | --- | --- |
| `idle` | `READY` | no turn running |
| `thinking` | `● THINKING` | a prompt was sent; no reply text yet, no tool running |
| `working` | `● WORKING` | a tool call is running (§5) |
| `answering` | `● ANSWERING` | reply text is streaming |

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
  (the speed table of T24 holds this number once written).

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
sideways inside its block with the first column fixed (on `--bg-elevated`). More than 20 body rows:
the first 20 and `SHOW ALL 48 ROWS` (as for code).

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

The agent's tool calls are shown as **tool lines**, never as raw input or output (the raw terminal
is T5's).

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
| `morning` (C3) | `since` | `read the Morning since {target}` | `read the Morning {n}×` |
| `history` (C3) | `node` | `read the history of {target}` | `read the history of {n} nodes` |
| `focus` (C3) | none | `looked at this screen` | `looked at this screen {n}×` |
| `Read` | `file_path`, last path part | `read {target}` | `read {n} files` |
| `Grep`, `Glob` | none | `searched the files` | `searched the files {n}×` |
| `Bash` | `command`, first word | `ran {target}` | `ran {n} commands` |
| `WebFetch` | `url`, host only | `fetched a page from {target}` | `fetched {n} pages` |
| `WebSearch` | none | `searched the web` | `searched the web {n}×` |
| `Edit`, `Write` | `file_path`, last path part | `changed {target}` | `changed {n} files` |
| `Task` | none | `asked a helper agent` | `asked {n} helper agents` |
| any other tool | none | `used {name}` (another MCP server's tool: `used <server>:<tool>`) | `used {name} {n}×` |

The C3 rows follow the plan's tool names; T8 fixes their parameters and changes the `{target}`
column if a field is renamed. Show commands (`fly_to`, `pin`, …) are not tool lines: each leaves
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
code only when asked; marks `■ ▲ ● ○` before trouble words. Long replies are T5's.

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
Then `data-turn` is `thinking` and the header reads `● THINKING` within 0.1 s; the first word is
on screen ≤ 0.5 s after the first delta and `data-turn="answering"`; the cursor `▍` follows the
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
