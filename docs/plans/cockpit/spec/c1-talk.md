# C1 Talk

The cockpit pane and the conversation in it: where the pane sits, how it opens and closes, how a
reply is drawn for reading at arm's length, and how tool activity folds into one line (§1-§5, part
1, T4; §5.1 maps the room's messages onto them, T29). Typing and send, talking while the agent answers, long replies, errors, a new conversation,
several screens are part 2 (§7-§14, T5; the on-screen keyboard §7.1, T40); the raw view is not in C1 (§13, T50); the demo (`?demo=1`) is §15. Words as in the glossary (`README.md`). Sizes are CSS
px at 1368x912; times in s or ms.

Plan C1: "It slides over the view, never replaces it, so the agent can point at the view behind
it." "Replies are always text, rendered for reading at arm's length: large type, short blocks, code
and tables readable, tool activity collapsed to one line each ("read 3 feeds", "looked at CI on
main")."

## 1. Where the pane sits

| Page / layout | Pane rectangle at 1368x912 | Notes |
| --- | --- | --- |
| Wall page, `wall` | x 760-1368, y 0-912 (608 x 912) | slides over the right 608 px of the Wall; the left 759 px stay in sight |
| Wall page, `split`, `canvas`, and `switch` | no sliding pane: the conversation is a fixed **column** of the canvas, rects below (pending Q-O12, D117) | `screens.md` §3: in `switch` a tap on `CHAT` or a press on the talk button on the wall half flips to the canvas |
| App, every view in `VIEWS` | x 760-1368, y 36-888 (608 x 852): under the 36 px header, above the 24 px tape | covers the inspector (360 px) while open; `z-index` 35, between `--z-tape` 30 and `--z-sheet` 40 |

- The width is **608 px** everywhere, the same constant as the canvas column (`screens.md` §1, D6),
  so a reply wraps the same way in the pane and in the column (D18). Narrower than 1216 px the pane
  is `min(608px, 100vw)` wide.
- Background `--bg-elevated` (a floating layer, `docs/design.md` "Surfaces"), a 1 px `--line`
  left border, no shadow.
- While the pane is open, the view behind keeps working in the part that is in sight: the Wall
  explores, the Map pans and selects. A show command (`c4-show-canvas.md` §2) centres its target in the part in sight
  (x 0-759), not in the whole screen.
- The page root carries `data-pane="open|closed|column"` (`column` in `split`, `canvas` and
  `switch`); the element holding header, status line, conversation and input row is
  `[data-cockpit-conversation]` on every page and layout, pane or column.

### The conversation column (pending Q-O12)

In `split`, `canvas` and `switch` the conversation does not slide: it is the column of the canvas
beside or under the card area (`c4-show-canvas.md` §7.1, D78). It is always there, so it has no
opener and no `CLOSE` (D117): `[data-cockpit-open]` is not rendered while the canvas shows, `Esc`
does nothing, and the 300 s auto-close (`screens.md` §2, D5) does not apply. Inside it is the pane
of the list below, top to bottom, with these rects at 1368x912:

| Part | `canvas` (and `switch` showing the canvas) | `split` |
| --- | --- | --- |
| Column `[data-cockpit-conversation]` | x 760-1368, y 0-912, 1 px `--line` left border | x 760-1368, y 520-912, 1 px `--line` top border |
| Header (64 px) | y 0-64 | y 520-584 |
| Header buttons, from the right, 16 px in, 8 px apart, each 48 px tall | `SCREEN` x 1256-1352, `NEW` x 1176-1248, `SHELF` x 1072-1168 (only with a shelf), in `switch` the switch button `WALL` x 992-1064 (D156); y 8-56 | same x; y 528-576 |
| Status line (80 px, only while shown) | y 64-144 | y 584-664 |
| Conversation (scrolls) | y 64-808 (744 px), y 144-808 with the status line | y 584-808 (224 px, about 5 lines at 28 px), y 664-808 with the status line |
| Input row | y 808-912: input x 784-1184, `SEND` x 1200-1264, talk button x 1280-1344, y 824-888 | same |

- The talk button and `SEND` keep their rects from `screens.md` §4 and the list below: the input
  row is in the same place in a pane and in a column.
- The chip row, the hint line and `↓ NEW` stack up from the input row inside the conversation's
  band (§1.1). In `split` they never leave the conversation less than 96 px (3 lines); with the
  on-screen keyboard up the column covers the card area (§7.1).
- Other widths: the column is the right 608 px of the screen (`min(608px, 100vw)`), at the bottom
  in `split` with the card area's height above it; at 1200x800 in `switch` it is x 592-1200,
  y 0-800.

### Inside the pane, top to bottom

1. **Header**, 64 px, 1 px `--line` bottom border. Left, 24 px in: `COCKPIT` (`--font-label` caps
   16 px, `--text-2`), then 16 px later the turn state (§2) `[data-cockpit-turn]` in 18 px caps `--text-2` (D167: the state the owner looks for at a glance is not the faintest text in the header). Right, 16 px
   in: `CLOSE` `[data-cockpit-close]`, and on the Wall page `SCREEN` `[data-cockpit-screen]` to its
   left (`screens.md` §1), 8 px apart. Each
   header button is 48 px tall, ≥ 96 px wide, 16 px caps `--text-1`, 1 px `--line-strong` border.
   Left of those, 8 px apart: `NEW` `[data-cockpit-new]` (§11), 48 px tall and 72 px wide (D38);
   order from the right: `CLOSE`, `SCREEN`, `NEW`. Every rect per page and state: `screens.md` §4.1. There is no `RAW` button in C1 (§13).
2. **Status line**, 80 px (two lines, D54), only while there is something to say (offline, room
   down, the agent down or logged out: §10.1 says which one wins). The `NEW` bar (§11) uses the same 80 px slot; the status line wins it.
3. **The conversation**, filling the rest; it scrolls on its own; 24 px padding left and right,
   16 px at the top. Text column: 560 px.
4. **Input row**, 1 px `--line` top border. The **talk button** (64x64 px) keeps its one rect from
   `screens.md` §4: x 1280-1344, y 824-888 on every page (pending Q-O11). Left of it, 16 px apart: `SEND` (64x64 px) and the text input (64 px tall, mono 28 px, `--bg-sunken`,
   from x 784 to x 1184). Typing, `SEND` and the input's growth are T5's; the talk button's states
   are T6's. The row is y 808-912 on the Wall (104 px: 16 + 64 + 24) and y 808-888 in the app (80 px: 16 +
   64; the pane ends on the bottom bar's top edge).

### 1.1 The stack above the input row (T96, D133)

Four things want the band just above the input row: a one-line message, the context chip
(`c3-see.md` §9), `↓ NEW` (§4) and, in the corner, `CHAT`/`CLOSE` (`screens.md` §4). They stack
from the input row's top edge upwards, in this order, each one only while it is shown:

1. **The line slot** `[data-cockpit-line]`, `data-line="room-down|error|hint|length"`: exactly one
   message, on the row's top edge. Text left-aligned at x 784, at most 480 px wide (it ends at
   x ≤ 1264), its last line box ending 4 px above the row's top edge, 4 px free above its first line.
   **Type** (D167, T43): every message is 18 px `--font-label` weight 500, line height 24 px,
   `--text-1`; the hint and the length note in caps with 0.08 em letter spacing, the room-down and
   error lines in sentence case. One line makes the slot 32 px (4 + 24 + 4); each more line adds
   24 px, at most 3 lines (80 px), then the text is cut with `…`. No message in this spec needs 3:
   measured in Chromium with the vendored Barlow Condensed Medium, the longest error
   (`stt-down` with the `token` detail, `c2-voice.md` §10) is 842 px on one line, so 2 lines; the
   longest hint (`RELEASE TO SEND · SLIDE OFF TO KEEP`) 279 px, one line. Which one, highest first (D133):
   1. `room-down`: `Sending and voice come back with the room.` (`screens.md` §7);
   2. `error`: the microphone or speech line `[data-talk-error]` (`c2-voice.md` §5, §10);
   3. `hint`: the talk hints (`c2-voice.md` §3, §4);
   4. `length`: `8 214 / 8 000 CHARACTERS` (§7).
   One exception: while a hold that `stt-down` ended is still down, the hint `NOT LISTENING` holds
   the slot before the error, which follows at the release (`c2-voice.md` §10, D181).
   A lower message waits while a higher one shows and appears when the higher one goes, if it
   still holds (a hint whose 5 s ran out meanwhile does not come back; a limit hint, `c2-voice.md`
   §4 and D168, comes back unless a touch came meanwhile).
2. **The chip row**, 64 px, on top of the line slot (on the row's top edge when no line shows): the
   chip 48 px tall, 8 px in from the row's top and bottom, from x 784, ending at x ≤ 1264.
3. **`↓ NEW`** floats over the conversation, 16 px above the topmost of the two (above the row
   when neither shows). With a chip it is right-aligned, ending at x 1264 (x 1168-1264 at 96 px
   wide), so it never sits over the chip's `✕` and never over `CHAT` (x 1288-1336, y 760-808 is
   `CHAT`'s, `screens.md` §4, D116). Without a chip it is centred over the text column (x 1016-1112).

The conversation ends at the top of the line slot or the chip row, whichever is higher; `↓ NEW`
takes no height. When an item comes or goes the conversation follows §7.1's pin rule (at its end it
stays at its end; scrolled up, the line at its top stays at its top), in the next frame, no slide.

Rects at 1368x912 with a one-line input (row top y 808, on the Wall, in the app and in a column):

| Shown | Line slot | Chip row (chip) | `↓ NEW` | Conversation bottom |
| --- | --- | --- | --- | --- |
| nothing | none | none | x 1016-1112, y 744-792 | y 808 |
| a one-line message | y 776-808 | none | x 1016-1112, y 712-760 | y 776 |
| a chip | none | y 744-808 (y 752-800) | x 1168-1264, y 680-728 | y 744 |
| a one-line message and a chip | y 776-808 | y 712-776 (y 720-768) | x 1168-1264, y 648-696 | y 712 |
| a two-line message and a chip | y 752-808 | y 688-752 (y 696-744) | x 1168-1264, y 624-672 | y 688 |

- A taller input (§7) or the keyboard (§7.1) moves the row's top edge; every rect moves with it by
  the same amount (keyboard up: subtract 364 px, so a chip alone is y 380-444).
- The x rule makes every item in the stack end 24 px left of `CHAT`/`CLOSE` and of the talk
  button; between stacked items the gaps are 16 px or more (`↓ NEW` to what is under it) and 8 px
  (the chip inside its row). `screens.md` §4.1's control table takes these rects with its ≥ 8 px
  test (S-SCR-25).
- In a `split` column (§1) the conversation never drops under 96 px: when the status line, the
  stack and the input's growth together would leave less, the column's top moves up over the card
  area by what is missing (the most: 80 px status line, 144 px of stack (an 80 px three-line slot
  and the 64 px chip row) and 118 px of input growth put the column at y 306-912).

## 2. Opening and closing

**The opener** (pending Q-O11). The recommendation makes the bottom-right 64x64 button the talk
button (one press to talk, as a held key in the terminal) and adds a smaller opener for typing and
reading: `CHAT`, `[data-cockpit-open]`, 48x48 px at x 1288-1336, y 760-808 on every page. Its look
and rect are `screens.md` §4 (D116). If the owner picks Q-O11 b), the opener is D7's `AGENT`
button in the talk button's rect and these rules apply to it unchanged.

**Open.** A tap on the opener (or a press on the talk button, T6) opens the pane:
- It slides in from the right: `transform: translateX(608px)` to `0`, 120 ms, `--ease`
  (`docs/design.md` rule 5). The pane is in place ≤ 0.2 s after the tap (B7).
- While open, the opener stays in its rect and reads `CLOSE`; a tap closes the pane. `CLOSE` in
  the header does the same (D116).
- The conversation is scrolled to its end: the latest turn is in sight.
- The input gets the keyboard focus only when the page's pointer is fine (a mouse, a paired
  keyboard: `matchMedia('(pointer: fine)')`); on a touch screen it does not, so the on-screen
  keyboard does not cover half the pane on every open (D20). A tap in the input brings the keyboard.
- The tour stops where it is and the idle timer pauses (`screens.md` §2, D4).

**Close.** `CLOSE` in the header, `Esc` on a paired keyboard, or the auto-close (`screens.md` §2,
D5, pending Q-O12) close it: it slides out in 120 ms, the opener reads `CHAT` again. The opener
reading `CLOSE` closes it the same way. A tap on the view
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
| `stopping` | `● STOPPING` | `STOP` or `START` (§11) was tapped; until the turn's end arrives (≤ 5 s, §8) |

The `●` is `--text-2`, static (nothing blinks for decoration). Speaking up without a prompt
(`coworker.md`) uses the same states.

## 3. A turn in the conversation

A turn is drawn top to bottom in the order things happened: the prompt, then the reply's text
blocks, tool lines (§5) and show lines (`c4-show-canvas.md` §4) interleaved as the agent produced them.

- **Label row** above the prompt and above the reply, 24 px tall, 16 px caps `--text-3`:
  `YOU · 07:02` (`YOU · SPOKEN · 07:02` for a voice prompt, C2) and `AGENT · 07:02`. Time is the
  screen's local `HH:MM`, 24 h; a date is `D Mon` in English (`27 Oct`, D149).
- **The prompt**: mono 28 px, line height 1.4 (39.2 px), `--text-1`, in a block on `--bg-surface`
  with a 1 px `--line-weak` border and 12 px / 16 px padding (pending Q-O18).
- **The reply**: mono 28 px, line height 1.4 (39.2 px), `--text-1`, straight on the pane's
  background (pending Q-O18). The mono face (`--font-mono`, JetBrains Mono) advances 0.6 em per
  character: 16.8 px at 28 px, so the 560 px column holds 33 characters per line (42 at 22 px).
- Spacing: 32 px between turns, 16 px between blocks of one reply, 8 px between a label row and
  its block.
- The type sizes are named constants in the module of D6 (D21): `TYPE_TALK = 28` (prompt, reply,
  input and live words, `c2-voice.md` §4) and `LINE_TALK = 1.4`. Q-O18 asks 22 or 28 px: research Q1
  puts the floor near 22 px at 60 cm on a 12.3 in panel and 26-30 px for text read while speaking;
  the spec is written for 28 px (Q-O18 b). If the owner picks 22 px, only the two constants and the
  derived figures change: 42 characters per line, the input's 27 per line and 157 px at 4 lines
  (§7), and the rects that follow from the input's growth (§1.1, §7.1, S-C1-14/33/34).

### Streaming

- Reply text is appended as the bridge's text deltas arrive (`protocols.md` §3.2, §11.4), drawn at most
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
| paragraph | 28 px text (§3, pending Q-O18); blocks separated by 16 px |
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
right in 16 px caps `--text-3` (D21's floor). A block of more than 12 lines shows its first 12 and a full-width
button under it, 48 px tall, 16 px caps: `SHOW ALL 40 LINES`; tapped, it shows every line and reads
`SHOW LESS`.

**Tables.** Header cells 16 px caps `--font-label` 600, `--text-3`; body cells mono 18 px
`--text-1`; every row 44 px tall (`--row-touch`), 12 px cell padding left and right, a 1 px
`--line-weak` line under each row. A column whose body cells are all numbers, times or sizes
(`12`, `3.4 GB`, `1 h 12`, `41 %`, `03:12`) is right-aligned. A table wider than 560 px scrolls
sideways inside its block with the first column fixed (on `--bg-elevated`). Every row is drawn,
however many (D23: 20 rows are 880 px, one flick).

**Which columns are right-aligned** (D146). A cell is *numeric* when its text, with inline markup
taken off (`**12**` is `12`) and trimmed, is at most 40 characters and matches

```
^(?:[-+−]?\$?\d+(?:[.,]\d+)?(?: ?(?:%|(?:[KMGT]i?)?B|ms|s|min|h|d))?|\d+ h \d{2}|\d{1,2}:\d{2}(?::\d{2})?)$
```

A cell that is empty, `-` or `—` is *neutral*. A column is right-aligned when it has at least one
numeric body cell and every other body cell is numeric or neutral; its header cell is right-aligned
with it. GFM's alignment row wins where it says something: `---:` right, `:---` left; `:---:` and
`---` leave it to the rule (the design has no centred table text).

| numeric | not numeric |
| --- | --- |
| `12`, `-3`, `+2`, `3.4 GB`, `3,4 GB`, `12 MiB`, `41 %`, `41%`, `250 ms`, `45 s`, `12 min`, `3 d`, `$0.42`, `1 h 12`, `03:12`, `3:12:05` | `hv1`, `v2`, `1.2.3`, `12 GB free`, `~3 min`, `03:12 UTC`, `1e5`, `1 234`, `12/40` |

**The renderer** (D146) is laneboard's own module, `public/js/core/md.js`, with no dependency, in
the style of `public/js/core/hl.js`: a pure ES module, no imports, no DOM. `parse(text)` returns
an array of plain block objects (`p`, `h`, `list`, `quote`, `rule`, `code`, `table`, and `tail`
for a last line with no newline yet), each holding inline runs (`text`, `bold`, `code`, `link`
with `text` and `host`, `image` with `alt`, `mark`). The pane builds the DOM from them with
`textContent` only, never `innerHTML`, so nothing in a reply is parsed as markup. `parse` walks
the text once: a line longer than 2 000 characters is one plain `p` run, and its regexes, the
numeric-cell one included, have no nested quantifiers. The pane calls it on a text block's whole
text once per animation frame while the block streams (§3 "Streaming"); a code fence still open
comes back as a `code` block with `open: true`. Its unit test, `test/md.test.mjs` in `npm test`,
is table-driven: one case per row of the subset table above, the numeric/not-numeric cells
above, a fence open at the end, three-level lists drawn at level 2, a table row still being
written (a `tail`), and S-C1-09's four hostile strings.

### History in the pane

The pane draws the last 50 turns. Older turns, if the screen holds them, come back with
`SHOW EARLIER` (full width, 48 px, 16 px caps) at the top of the conversation, 50 at a time (D27).
The screen holds the conversation in memory only (`screens.md` D14); what a screen gets from the
room after a reload is the `snapshot` of `protocols.md` §2.2 (`history` for `SHOW EARLIER`, §3.7).
The room keeps the conversation on disk for 30 days, so a room restart shows the same turns
(`protocols.md` §11.7.1, pending Q-O24; S-C1-39).

## 4. Following a reply as it grows

- The conversation is **pinned** to its end while its last pixel is within 48 px of the bottom of
  the visible area: new text scrolls it along.
- A drag up unpins it: new text no longer moves the view. A button `↓ NEW` `[data-cockpit-follow]` appears, 48 px tall,
  96 px wide, 16 px caps `--text-1` on `--bg-elevated`, 1 px `--line-strong` border, 16 px above
  the input row or the stack on it, centred, or right-aligned at x 1264 while a chip shows (§1.1). A tap jumps to the end (instantly, no smooth scroll: `docs/design.md`
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
| `focus` (C3) | `screen` | `looked at this screen`; another: `looked at screen {target}`; `all`: `looked at the screens` | `looked at {n} screens` |
| `Read` | `file_path`, last path part | `read {target}` | `read {n} files` |
| `Grep`, `Glob` | none | `searched the files` | `searched the files {n}×` |
| `Bash` (not allowed in v1) | `command`, whole, each run of white space as one space | `ran {target}` | — (never folds, §5.2) |
| `WebFetch` (not allowed in v1) | `url`, host only | `fetched a page from {target}` | `fetched {n} pages` |
| `WebSearch` (not allowed in v1) | none | `searched the web` | `searched the web {n}×` |
| `Edit`, `Write`, `NotebookEdit` (not allowed in v1) | `file_path` (`notebook_path`), last path part | `changed {target}` | — (never folds, §5.2) |
| `Task` (not allowed in v1) | none | `asked a helper agent` | `asked {n} helper agents` |
| any other tool | none | `used {name}` (another MCP server's tool: `used <server>:<tool>`) | — (never folds, §5.2) |

The C3 rows follow the tools' parameters in `c3-see.md` §4 (T8: `morning` takes `window`,
`history` takes `node` or `run`). Rows marked "not allowed in v1" are refused by the launch line
(§5.2, pending Q-O23); their words stay for Q-O23 b) or c) and for a later C6. Show commands (`fly_to`, `pin`, …) are not tool lines: each leaves
its own show line (`c4-show-canvas.md` §4).

**Targets from odd input** (D147). `{target}` is always taken from the room's redacted copy of the
input (§5.3), so a secret in it reads `[redacted]` on the line too.
- **Missing.** A target field that is absent, empty, or not a string (a number is turned into its
  text: `run` `7` reads `7`) gives the row's no-target text: `fleet`, `runs` and `focus` have
  theirs in the table; the others read `looked at the lanes`, `looked at CI`, `read the Morning`,
  `read the history`, `read a file`, `ran a command`, `fetched a page`, `changed a file`. A line
  folds calls with and without a target as `many` calls.
- **Shortening.** Every `{target}` is trimmed, each run of white space (newlines too) becomes one
  space, and it is cut by counting characters (code points, never half of an emoji): at most 32
  are kept; if more follow, the cut goes back to the last space among those 32 when that space is
  at character 16 or later, and `…` is added. So
  `rm -rf /var/log/laneboard/old && echo done` reads `ran rm -rf /var/log/laneboard/old…` (§5.2).
- **`Bash` prefixes are kept.** `cd /srv/app && npm test` reads `ran cd /srv/app && npm test`, and
  `PGPASSWORD=hunter2 psql -h db` reads `ran PGPASSWORD=[redacted] psql -h db` (rule 4 of §5.3).
  The line never skips a `cd …&&`, an env assignment or `sudo` to reach "the real command": what
  it would run is the whole string, and the line of a tool that changes things shows only what
  the input says (§5.2). The full command is one tap away.
- **`WebFetch` addresses.** The host is `new URL(url).hostname` (lower case, punycode as the URL
  API gives it, no port, no `www.` dropped). A `url` that does not parse, or whose scheme is not
  `http:` or `https:` (`javascript:`, `file:`, `data:`), reads `fetched a page from an invalid
  address`; it is never drawn as a link (D22). Two calls on one host count as one target.
- **`Read` paths.** The last part of `file_path` after the last `/`, a trailing `/` ignored:
  `/etc/laneboard/` reads `read laneboard`; `/` alone reads `read /`.

**Failures.** A line with failed calls appends ` · 1 failed` (or ` · 2 failed`) in the same grey (a
refused call is not a failure: §5.2): a
tool error is news about the agent, not trouble in the fleet (`docs/design.md`, the colour rule).

**Open.** A tap on the row opens it: under it, one row per call, mono 16 px `--text-2`, 8 px
indent: `<tool>  <input as compact JSON, cut at 120 characters>  <ms> ms  ok|failed`. A tool that
changes things shows its whole input instead, wrapped (§5.2); a refused call ends in `refused` in
place of `<ms> ms  ok|failed`. A second tap closes it. Tool output is never shown here. The input
is the room's redacted copy (§5.3), drawn as text, never as markup.

**The agent's writing.** The screen does not shorten replies. "Short blocks" is asked of the agent:
the room's standing instructions for the agent (`protocols.md` §11.8, word for word there) say: lead with the answer in
one sentence; at most 3 sentences per paragraph; a table for 3 or more items that share fields;
code only when asked; marks `■ ▲ ● ○` before trouble words. Long replies are §9.

### 5.1 The messages behind §2-§5 (T29)

The pane draws only from the room's messages; their fields and examples are `protocols.md` §2.2 and
§3.2 (one place), the bridge behind them §11.3-§11.4. This table says what each one changes in the
pane. Every message is applied in `seq` order; a `seq` at or below the last applied is dropped
(`protocols.md` §2.2).

| Message | Fields the pane reads | What the pane does |
| --- | --- | --- |
| `welcome` | `config.stt`, `status` | sets the talk button (`c2-voice.md` §9) and the status line (§10); draws nothing in the conversation |
| `snapshot` | `turns[].items[]` by `blockIndex`, `end`, `olderTurns` | replaces the whole conversation once its last part is in; a running turn continues from where it is (§12) |
| `turn.prompt` | `turnId`, `clientId`, `text`, `source`, `at`, `delivery` | the sender's block loses `· SENDING`; other screens draw the prompt block (§7, §12). With `delivery:"new"` it is the turn's start; with `queued` the block reads `· QUEUED` (§8); the `AGENT · HH:MM` label row comes with the turn's first item |
| `prompt.taken` | `turnId`, `clientId`, `state`, `atBlock`, `why` | `taken`: `· QUEUED` goes, the block moves to `atBlock` of `turnId`; `cancelled`: `NOT SENT` and the line for `why` (§8) |
| `turn.state` | `state` | sets `data-turn` and the header word (§2) |
| `text.delta` | `turnId`, `blockIndex`, `text` | appends to that text block, creating it at its `blockIndex` place if new; the `▍` cursor follows it (§3) |
| `text.block` | `turnId`, `blockIndex`, `text` | replaces that block's text; the cursor leaves it |
| `tool.start` | `turnId`, `blockIndex`, `toolUseId`, `tool`, `input`, `startedAt` | adds a call: to the tool line before it if the fold rule below says so, else a new line at its `blockIndex` place; `●` and `…` on |
| `tool.end` | `toolUseId`, `endedAt`, `isError`, `denied` | ends that call; its open row shows `endedAt − startedAt` in whole ms and `ok` (`isError:false`) or `failed`; with `denied:true` the call is refused and its line becomes §5.2's `tried` line; `●` goes once no call of the line runs |
| `turn.retrying` | `attempt`, `of` | E5's grey row (§10) |
| `turn.end` | `state`, `code`, `steps`, `detail`, `forced` | the cursor goes, running calls lose `●`; the end line of `protocols.md` §3.2's table; `data-turn="idle"`, `READY` |
| `heartbeat` | — | nothing drawn; resets the 25 s loss timer (`screens.md` §7) |

**Place.** Items of a turn sit in `blockIndex` order whatever order their messages came in: an item
with a lower index that arrives later is inserted above the higher one. A text block and a tool
call never share an index (`protocols.md` §3.2).

**The fold rule, in these terms** (§5 "Folding", D24). A `tool.start` joins the tool line whose
last call has `blockIndex` one less than its own, if that call is of the same tool (`mcp__laneboard__`
stripped) and that tool is not one that changes things (§5.2). Anything else starts a new line. So calls the agent makes in parallel (several
`tool.start` with consecutive indexes before any `tool.end`) fold like calls made one after the
other; parallel calls of two tools are two lines, each with its own `●`. `{n}` in a `many` text
counts the line's started calls; the `one` text stays while every call has the same `{target}`;
` · {k} failed` counts ended calls with `isError:true` and `denied` not `true`.

**A message the pane cannot place** (D119): a `text.*`, `tool.*`, `turn.state`, `turn.retrying` or
`turn.end` naming a `turnId` the pane does not hold, a `tool.end` naming an unknown `toolUseId`, or a
`prompt.taken` naming a `clientId` the pane does not hold.
The pane has missed something: it closes the link with 4000 `gap` and takes the snapshot
(`protocols.md` §2.2). Nothing on screen changes until the snapshot has been drawn.

**A fresh screen** (a load or a reload, D118). From the page's load until the last `snapshot` part
is drawn, `data-cockpit="connecting"` (`screens.md` §7). The pane, if opened, shows its header
(`READY` greyed, `NEW` disabled), the input (editable, a draft can be written, `SEND` disabled) and
in the conversation one line at its top, 18 px `--text-2`: `Connecting to the cockpit room…`. Then:
- the snapshot holds turns: they are drawn, scrolled to the end (§2), the line goes;
- the snapshot holds no turn (a new room, or right after `NEW` with nothing said): the line
  becomes `Nothing said yet. Type a question, or hold the talk button and speak.` (with
  `config.stt` `none`: `Nothing said yet. Type a question below.`), 18 px `--text-2`, until the
  first `turn.prompt`. The pane is never blank (`docs/plans/product.md`, never an empty screen);
- no snapshot 5 s after the load: `data-cockpit="room-down"` and §10's status line, its "since"
  being the page's load time (`screens.md` §7); the `Connecting…` line goes.

### 5.2 What the agent may use, refused calls, tools that change things (T57, pending Q-O23)

Written for Q-O23's recommendation a): "look freely, change only with a yes" (`spec-input.md` §6).

**The allowlist.** The room launches Claude Code with `--strict-mcp-config`,
`--allowedTools mcp__laneboard__*,Read,Grep,Glob` and `--permission-prompts none` (the whole line
is `protocols.md` §11.2, one place). So the agent may call the laneboard MCP tools (C3) and read,
search and list files its own unix user can read. Every other call (`Bash`, `Edit`, `Write`,
`NotebookEdit`, `WebFetch`, `WebSearch`, `Task`, any other MCP server's tool) is refused by Claude
Code before it runs; nothing asks anyone, because nobody is there to answer. Claude Code writes
`system/permission_denied` for it, the room sends `tool.end` with `denied:true` (`protocols.md`
§11.4). The standing instructions tell the agent so (`protocols.md` §11.8, the line
`You can only look…`). What the agent's uid may read is `security.md` §3; an agent kind with
no allowlist is T72's.

**A refused call** (D125) leaves a **`tried` line**:
- text `tried {tool}, not allowed`, `{tool}` the name the agent used (`Bash`, `WebFetch`); another
  MCP server's `mcp__<server>__<tool>` reads `<server>:<tool>`;
- the same row as any tool line (44 px, mono 18 px `--text-2`, `+`/`−` at the right), its glyph
  column empty: no `●`, no `…`, no ` · failed`; `[data-tool-line][data-denied="true"]`;
- it holds that one call and never folds (below). Between the call's `tool.start` and its
  `tool.end` (the same few ms in practice) the line shows the table's running text, as any call;
- opened, its row reads `<tool>  <whole input, wrapped>  refused`;
- the turn goes on: the agent reads the refusal and answers. A refused call is not an error end
  and adds no line of §10.

**Tools that change things** (D126) are `Bash`, `Edit`, `Write`, `NotebookEdit` and every tool
under "any other tool" in §5's table. Refused in v1, they get these rules now so Q-O23 b)/c) or C6
can lift the refusal without touching the pane:
- they **never fold**: each call is its own line, and no call joins a line of theirs;
- the collapsed text starts with the table's verb (`ran`, `changed`, `used`), followed only by
  `{target}` taken from the input, never by a word the agent chose for the line;
- the `Bash` `{target}` is the whole command, each run of white space as one space, cut at 32
  characters with `…`: `rm -rf /var/log/laneboard/old && echo done` reads
  `ran rm -rf /var/log/laneboard/old…`, not `ran rm`;
- opened, the row shows the whole input the room sent (D97: every string at most 200 characters,
  the object at most 2 000), as compact JSON wrapped inside the text column
  (`white-space: pre-wrap; overflow-wrap: anywhere`), never cut at 120 characters.

### 5.3 Secrets in tool input (T57)

The room redacts every tool input before it leaves the room's process for anything a screen can
read: the `tool.start` frame, the `snapshot`, and whatever the room keeps of the conversation (D127). The screen
never holds the raw value, so the opened row (§5), the `{target}` of a collapsed line and the
`tried` line all show `[redacted]` where the secret was. This hides secrets from a desk screen; it
is not what stops the agent sending one out (that is §5.2's allowlist).

Rules, applied in this order to every string value of the input (JSON keys are never changed; the
module is `server/cockpit/redact.mjs`, one table-driven unit test in `npm test` with one case per
row):

| # | Matches (case-insensitive unless said) | Becomes |
| --- | --- | --- |
| 1 | the exact value of any secret the room holds: `LANEBOARD_MCP_TOKEN`, the speech token (`cockpit.stt.tokenFile`), the values of `cockpit.agent.env`'s names | `[redacted]` |
| 2 | a PEM block from `-----BEGIN` … `PRIVATE KEY-----` to its `-----END` line, or to the string's end | `[redacted]` |
| 3 | `Bearer `, `Basic ` or `Token ` followed by non-space characters | the word kept, the rest `[redacted]`: `Bearer [redacted]` |
| 4 | a name containing `pass`, `secret`, `token`, `key`, `auth`, `credential` or `sig` (`lb_sig`, `api_key`, `PGPASSWORD`), as a JSON key or inside a string as `name=value`, `name: value`, `--name value` or `--name=value` | the value up to the next white space, `&`, `"`, `'` or `,` becomes `[redacted]`, unless it is already `[redacted]` or is rule 3's word (`Authorization: Bearer [redacted]` stays); a JSON key's whole value (any type) becomes `"[redacted]"` |
| 5 | known token prefixes, case-sensitive: `sk-` and 20 or more characters, `ghp_`, `gho_`, `ghs_`, `github_pat_`, `glpat-`, `xoxb-`, `xoxp-`, `AKIA` and 16 upper-case letters or digits | `[redacted]` |
| 6 | a run of 32 or more characters of `A-Z a-z 0-9 + / = _ -` holding at least one upper-case letter, one lower-case letter and one digit | `[redacted]` |

- Rule 6 leaves git hashes, hex digests and UUIDs alone (no upper-case letter) and catches most
  API keys and JWTs. Over-redaction (a `keyboard=` value, a long mixed-case path part) is accepted.
- Redaction runs before D97's cuts, so a cut never splits a secret into a visible half.
- Reply text is redacted too, with rules 1, 2, 3, 5 and 6 and a hold-back for a word split across
  deltas: `security.md` §5 (D211).

## 6. Scenarios

The fake agent (T18) replays scripted turns: text deltas with times, tool calls and their ends.
Every scenario runs at 1368x912 against the demo hub, the stand-in room and the fake agent, on a
paired screen.

### S-C1-01 The pane opens from the Wall in 0.2 s and leaves the wall in sight (pending Q-O11)
Given a screen in `wall` layout touring, the pane closed,
When the owner taps `[data-cockpit-open]` at t = 0 ms,
Then by t = 200 ms `data-pane="open"`, the pane's rect is x 760, y 0, 608 x 912, its transform is
`none`; the slide's computed `transition-duration` is 120 ms; the opener reads `CLOSE` at
x 1288-1336, y 760-808; the talk button is at x 1280-1344, y 824-888 (`screens.md` §4); `data-wall-state="explore"`; the latest turn's last
line is in sight; `document.activeElement` is not the input.
Test: Playwright with `hasTouch: true`; tap; at 200 ms read the rects, the computed transition and
`document.activeElement`; a second run with a mouse click asserts the input has focus.

### S-C1-02 Closing: both CLOSE controls and Esc close it, a tap on the wall does not
Given S-C1-01's open pane with the draft `how is` in the input,
When the owner taps the map at (400, 480),
Then the pane stays open and `data-wall-state` is `explore` with the camera moved to the tap.
When the owner taps `CLOSE` at t = 0 ms,
Then by t = 200 ms `data-pane="closed"`, the pane is off screen, the opener reads `CHAT`.
When the owner opens the pane again, the draft `how is` is in the input; a tap on the opener, now
reading `CLOSE` at (1312, 784), closes it by 200 ms; opened once more, `Esc` on a keyboard closes it.
Test: Playwright; tap coordinates on the wall; tap the header `CLOSE`, then `[data-cockpit-open]`;
assert `data-pane` and the opener's text after each step; `keyboard.press('Escape')`.

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

- **The input** is a `<textarea>` `[data-cockpit-input]`, x 784-1184 (§1), mono 28 px, line height
  1.4 (39.2 px), 16 px padding left and right, 12.4 px top and bottom: 368 px of text, 21 characters
  per line at 16.8 px each (pending Q-O18; 27 at 22 px), so the 20-character placeholder fits one
  line. Placeholder `Type or hold to talk`
  in `--text-3` (pending Q-O11). `enterkeyhint="send"`, `autocapitalize="sentences"`,
  `spellcheck` on.
- **It grows** with its text: 64 px for one line, +39.2 px per line up to 4 lines (182 px, 181.6
  rounded; tests allow ± 1 px); beyond 4 lines it scrolls inside. At 21 characters a line, 4 lines
  show about 84 characters: a spoken sentence of 12-15 words. It grows upwards; the input row grows with it and the conversation
  above gets shorter; `SEND` and the talk button stay at the row's bottom (D30).
- **`SEND`** `[data-cockpit-send]`, 64x64 px, 16 px caps. Disabled (`disabled`, label `--text-3`)
  while the input holds only white space and while the room is down (`screens.md` §7). During a
  turn its job changes (§8).
- **Keys** (D30): `Enter` sends, on a paired keyboard and on the on-screen keyboard alike (the
  terminal's habit); `Shift+Enter` makes a new line. `Esc` closes the pane (§2), the draft stays.
- **Length.** A prompt is at most 8 000 characters. Above that, a note in the line slot's
  type (18 px caps `--text-1`, §1.1, D167) shows there (`data-line="length"`, the lowest of its four): `8 214 / 8 000
  CHARACTERS`, and `SEND` is disabled. Pasting is never cut short by the screen (D30).
- **What is sent**: the text with white space trimmed at both ends; inside, unchanged.

**On send** (B8, ≤ 0.1 s): the prompt block is drawn at the end of the conversation with the label
`YOU · 07:02 · SENDING` (the `SENDING` in `--text-3`), the input is emptied, the conversation is
pinned to its end (§4), `data-turn="thinking"`. Keyboard focus stays where it was (an on-screen
keyboard stays up). When the room confirms it has the prompt (the `turn.prompt` echo, `protocols.md` §3.1), `· SENDING` goes. No
confirmation within 5 s while the room link is up: §10, E1 (D31).

### 7.1 With the on-screen keyboard (T40, T94)

Plan C1: "Typing works everywhere (on-screen keyboard, a paired keyboard)." On a 912 px tall
landscape screen an on-screen keyboard takes about the bottom 380 px: exactly where the input row,
the chip row and `SEND` sit (review 31-touch.md finding 1). This section says what moves. The
numbers are for a 380 px keyboard, which leaves 1368x532 in sight.

**How the page knows** (D130; which signal the owner's tablet gives is research Q11):
- The viewport meta keeps the browser default `interactive-widget=resizes-visual`, written out: the
  keyboard shrinks only the visual viewport, so the view behind the pane (Wall, Map) never re-lays
  out or refits its camera when the keyboard comes and goes.
- Where `navigator.virtualKeyboard` exists the page sets `overlaysContent = true` and listens to its
  `geometrychange` event.
- **Visible bottom** = `min(innerHeight, visualViewport.offsetTop + visualViewport.height)` minus
  `navigator.virtualKeyboard.boundingRect.height` (0 where the API is absent). **Keyboard height**
  = H minus the visible bottom, where H is the largest `innerHeight` seen at the current width since
  the load (a width change resets it). Both are recomputed on `visualViewport` `resize` and
  `scroll`, `geometrychange` and window `resize`, at most once per animation frame.
- The root carries `data-keyboard="up"` while the keyboard height is ≥ 120 px and
  `[data-cockpit-input]` has the focus, `data-keyboard="held"` during a talk press that started
  while it was `up` (below), else `data-keyboard="down"`. A desktop window made shorter with the
  input focused counts as `up`; the layout below fits it as well.

**While `data-keyboard` is `up` or `held`** (D131), on every page and layout, pane or column:
- `[data-cockpit-conversation]` covers x 760-1368 from the visible top (`visualViewport.offsetTop`)
  to the visible bottom: y 0-532 at 1368x532. On the app it covers the 36 px header and the 24 px
  tape too; in `split` it covers the card area above the column. Both come back when the keyboard
  goes. The width is §1's (`min(608px, 100vw)`).
- The **header** (64 px, y 0-64) keeps `CLOSE`, `SCREEN`, `NEW` (and in `switch` the switch button
  `WALL`) at §1's x, y 8-56 (`screens.md` §4.1 states H and I).
- The **input row** sits on the keyboard's top edge and is 88 px tall (16 + 64 + 8; the Wall's
  24 px bottom margin is for the screen's edge, not the keyboard's): y 444-532. Input x 784-1184,
  `SEND` x 1200-1264 and the talk button x 1280-1344, all y 460-524. The talk button stays in the
  row; it never moves to the screen's corner.
- The opener, reading `CLOSE` while the pane is open (§2), keeps x 1288-1336 with its bottom on the
  row's top edge: y 396-444. The column has no opener (D117).
- Above the row the stack is the same as without the keyboard (the line slot, the chip row,
  `↓ NEW`: §1.1), measured from the row's top edge at y 444; a chip alone is the row y 380-444.
- The **conversation** gets what is left: y 64-444 (380 px) with nothing stacked. With the 80 px
  status line, a one-line hint or note (32 px) and a chip (64 px) it is 204 px. It is never under
  200 px with a one-line input.
- The **input grows** (§7) only while the conversation keeps 200 px: its height is at most
  `clamp(64, 64 + left − 200, 182)` px, where `left` is the conversation's height with a one-line
  input. Past that the text scrolls inside the input, the caret line in sight (the textarea's own
  scrolling). At 1368x532: 182 px (4 lines) with nothing stacked; 68 px (one line) with the status
  line, a note and a chip.
- **Pinned.** A conversation that followed its end (§4) is at its end after every change of the
  visible height, the latest line in sight. If the owner had scrolled up, the line at its top stays
  at its top.
- Each change applies in the first animation frame after the event, with no slide (the 120 ms slide
  of §2 is for open and close only).

**Taps keep the keyboard up** (D132). A tap on any control inside `[data-cockpit-conversation]`
(`SEND`, the chip's `✕`, `NEW`, `SCREEN`, a tool line, `↓ NEW`, `RETRY`) leaves the focus in the
input (the build calls `preventDefault()` on the control's `pointerdown` and `mousedown`), so the
keyboard does not drop and the row does not move between `pointerdown` and `pointerup`. After a send
the keyboard stays up (§7). `CLOSE` closes the pane and blurs the input.

**Putting it away.**
- A tap on the conversation outside a control (`pointerup` within 8 px, `TAP_SLOP_TOUCH` of
  `public/js/views/map/interact.js`, of its `pointerdown`) blurs the input; the keyboard goes. A
  drag that scrolls the conversation does not blur it. A tap on the header outside its buttons
  blurs it too. A tap on the view behind the pane blurs it by the browser's own focus move, and the
  view acts on the tap as well (D19).
- The keyboard's own hide key: `data-keyboard` follows the height, the input may keep its focus.
- When `data-keyboard` turns `down`, §1's rects return in the first frame; the draft stays; the
  conversation follows the pin rule above.

**A talk press with the keyboard up** (C2). The press replaces the textarea with the live words
(`c2-voice.md` §4, D43), the textarea loses its focus and the keyboard goes. From the
`pointerdown` the layout stays as it was (`data-keyboard="held"`) until the microphone closes, so
the talk button does not move under the finger; the band below the row is plain `--bg-elevated`.
When the microphone closes, `data-keyboard` follows the keyboard again. After a tap on the words
(`c2-voice.md` §7, D47) the textarea has the focus, the keyboard comes back and the row sits on its
edge with the caret line in sight (S-C2-22).

## 8. Talking while the agent answers (pending Q-O1)

Written for Q-O1's recommendation d), **steer**: words sent during a turn go into that turn, as
they do in the owner's terminal (research Q8); nothing already said is thrown away. `STOP` is the
one way to end a turn. The wire is `protocols.md` §3.1 (`delivery:"queued"`), §3.4 and §11.6.

- **One slot, two jobs** (D32). While `data-turn` is `thinking`, `working` or `answering`:
  with an empty input the `SEND` slot reads `STOP` (`data-send="stop"`); with text in the input it
  reads `SEND` (`data-send="send"`). While idle it is always `SEND`. While the microphone is open the
  slot is blank and inert (`data-send="none"`, `c2-voice.md` §3, D42): `STOP` comes back when it closes. No hint line explains the
  send (D121): the `· QUEUED` label below says what happened, 0.5 s after the tap.
- **`SEND` during a turn** (D122). The prompt block is drawn at once at the end of the
  conversation (B8), label `YOU · 07:03 · SENDING`. The room sends it to the agent with
  `priority:"next"` and a UUID (`protocols.md` §11.3) and echoes `turn.prompt` with
  `delivery:"queued"`; the label then reads `YOU · 07:03 · QUEUED` (`QUEUED` in `--text-3`) and the
  prompt's text is drawn in `--text-2` instead of `--text-1`. The block stays the last item of the
  conversation while queued: text the agent writes before taking it is drawn above it.
- **Taken.** When the agent reads it (`prompt.taken` `taken`: after the tool calls it is running
  end, research Q8), within 0.1 s `· QUEUED` goes, the text turns `--text-1`, and the block takes
  its place in the turn at `atBlock` (`protocols.md` §3.4): the turn's items from `atBlock` on are
  drawn below it. The turn goes on; the header keeps `● WORKING` (D56); no
  `STOPPED` line, no new `AGENT · HH:MM` label row (the reply goes on under the same turn).
- **The turn ends first.** A prompt still queued when its turn ends stays `· QUEUED`; the agent
  takes it as the next turn (research Q8), and `prompt.taken` names that new turn: the block moves
  to the start of it, the `AGENT · HH:MM` label row comes with its first item, as a new turn's.
- **Not taken** (D123). If a prompt is still not taken 10 s after its turn's `turn.end`, and no
  interrupt receipt listed it, the room sends it to the agent once more as a new prompt (a new
  UUID, room-internal: no message to the screens, one log line). If that is not taken within 10 s
  either, the room sends `prompt.taken` `cancelled` with `"why":"not-taken"`: the label reads
  `YOU · 07:03 · NOT SENT` and under the block, as E1's look (§10): `The agent did not read this.`
  with `RETRY` and `EDIT`. `RETRY` sends it with a new `clientId` (D95 keeps the old one).
- **`STOP`** (or `Ctrl+C` on a paired keyboard with the input empty): `data-turn="stopping"` within
  0.1 s; the room asks the bridge to interrupt with `cancelQueued` (`protocols.md` §11.6). The turn
  ends when the bridge reports its end; if that has not happened 5 s after the tap, the room forces
  it (for Claude Code: `SIGINT`, research Q2) and the line reads `Stopped at 07:03 (forced).`.
  Either way `READY` by 5.5 s. Every sent prompt and every `STOP` is one line in the room's
  audit log, without the words (`cockpit.prompt`, `cockpit.stop`, `screens.md` §6.4).
- **Queued prompts at a `STOP`.** Each prompt the receipt lists as cancelled gets
  `prompt.taken` `cancelled` (`"why":"stopped"`): label `YOU · 07:03 · NOT SENT`, under it
  `Dropped by STOP.` with `RETRY` and `EDIT`, as above. An agent without `cancelQueued`
  (`ready.canCancelQueued:false`) keeps them: they stay `· QUEUED` and start the next turn.
- **"Stop, do this instead"** is `STOP`, then the new words: with a draft in the input the slot
  reads `SEND`, so the owner sends first and taps `STOP` after; the new prompt is then dropped with
  the turn and `RETRY` sends it again (two taps more, D32's overrule names the other way).
- **What a stopped turn looks like** (D33): its text stays exactly as it was at the tap; nothing
  that turn sends later is drawn (the room's log keeps it). Under it, 16 px caps
  `--text-3`: `STOPPED AT 07:03`. A tool line still running loses its `●` and ends in ` · stopped`.
  The `▍` cursor goes.
- **Voice** (C2): pressing the talk button during a turn stops nothing; listening starts (D29);
  the send at release is a `SEND` during a turn as above (`c2-voice.md` §2).
- **An agent that cannot steer** (`ready.canSteer:false`, a bridge agent, `protocols.md` §11.3):
  the same screen; the room holds the prompt until the turn ends and sends it then, so it is taken
  as the next turn.
- A turn the agent started itself (speaking up, `coworker.md`) is steered and stopped the same way.
- **Across a reload** (D124). The room keeps every prompt sent during a turn as a `prompt` item of
  that turn (`protocols.md` §2.2), so a reloaded page, or a second screen that opens later, draws
  it exactly as above: still `· QUEUED` and last, taken and in its place, or `NOT SENT` with its
  line and `RETRY`/`EDIT`. Later `prompt.taken` messages apply to it as to a block the page drew
  itself. A block still `· SENDING` at the reload (the room had not echoed it) is gone after the
  reload: if the room got it, the snapshot holds it; if not, it was never sent, and the reloaded
  input is empty (the draft went into the block at the tap).

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
| E4 `not-logged-in` | the agent reports missing login or key | `The agent is not logged in on the room. Log it in there, then send again.` plus the status line (§10.1) | none |
| E5 `model-busy` | the model service is retried by the agent | not an error line: a tool-line-style row in `--text-3`, `the model service is busy, retrying (2 of 10)`, replaced on each retry, gone when text arrives | none |
| E6 | retired (T50): a model-service error is E8, its `{detail}` the service's own message (D57) | | |
| E7 `step-limit` | the turn ends because the agent's step limit is reached | `Stopped after {n} steps, the agent's limit.` | `GO ON` sends `Go on.` as a new prompt |
| E8 `failed` | any other error end of a turn, the model service's included | `The answer failed: {detail}.` | `RETRY` |

- **Nothing is ever sent again on its own** (D34, as D12): `RETRY`, `EDIT` and `GO ON` act only on a
  tap. A `RETRY` is a new turn with the same text; the failed turn stays above it.
- Which native event of the agent maps to which code is `protocols.md` §11.4's mapping table; Claude Code's
  `api_retry` is E5 and a `result` with `is_error` is E7 or E8 (research Q2).
- An error line is shown on every screen (§12); its buttons work from any of them.

### 10.1 The status line: the agent's login, and which line wins (T68, D151, D152)

The pane's status line (§1 item 2) is **one slot**: 80 px under the header, 18 px `--text-2` on
`--bg-sunken`, at most two lines, the element `[data-cockpit-status]` with `data-status` the code
below (absent when nothing shows). It tells what holds **before** the owner sends anything: a page
that loads or reconnects draws it from `welcome.status` (`protocols.md` §3.5) in its first frame.

**The agent's login.** The room checks it when it starts and every 15 min (900 s), and every 60 s
while the agent is found logged out (`protocols.md` §11.10). A logged-out agent shows, with no
prompt sent: `The agent is not logged in on the room since 03:15. Log it in there.` The time is
when the room first found it (`HH:MM`; an earlier day `26 Oct 03:15`, D149; T65 may add the age).
The line goes at the first check that finds the login back (at most 60 s after the owner logs in
on the room), or when a turn ends `done`. `SEND` and talk stay enabled while it shows (D151): the
check is a guess about the agent and the agent's own answer is the truth; a prompt that fails
anyway gets E4 in its turn. Only when the agent cannot even start for want of a login (no session
is up, `status.blocksSend`) are `SEND` and talk disabled, as with E3, the draft kept.

**Which line wins** (D152). Highest first; the slot shows the highest that holds:

| # | `data-status` | Set by | Text (exact) | Lasts |
| --- | --- | --- | --- | --- |
| 1 | `offline` | the screen (`navigator.onLine` false) | `This screen is offline since 06:41. Check its network.` | while offline (`screens.md` §7) |
| 2 | `room-down` | the screen (its room link) | `Cockpit room unreachable since 06:41 (3 min). Retrying in 12 s.` + `RETRY NOW` | while down (`screens.md` §7) |
| 3 | `agent-down` | the room | `Agent not running since 07:04.` | while the agent cannot start (E3) |
| 4 | `not-logged-in` | the room | `The agent is not logged in on the room since 03:15. Log it in there.` | as above |
| 5 | `tools-down` | the room | `The agent cannot read the board: its laneboard tools did not start.` | while `ready.mcp` says so (`c3-see.md` §1) |
| 6 | `agent-back` | the room | `The agent is back (07:04). Your last message was not answered.` | 5 s (E2) |
| 7 | `back` | the screen | `Back since 06:47.` | 5 s (`screens.md` §7) |

- Rows 3-6 are the room's: it holds every condition that applies and sends only the highest as
  `status` (`protocols.md` §3.5), and the next one still holding when that one clears. Rows 1, 2
  and 7 are the screen's own; while row 1 or 2 shows, the room's last `status` is kept and shown
  again the moment the link is back.
- Rows 6 and 7 are news, not a state: they never wait. Outranked when they start or while they
  show, they are dropped, not shown later. So a reconnect whose `welcome.status` is not `null`
  shows that line at once and no `Back since`.
- The `NEW` bar (§11) gives way to every row, as before.
- On the room, the room's log holds one line per change of the slot's code (`status
  not-logged-in since 03:15`), and the check's own result once per change (`protocols.md` §11.10).

## 11. A new conversation (pending Q-O2)

Written for Q-O2's recommendation d) (T51, `reviews/36-skeptic.md` finding 4): **a `NEW` button
only**, plus a forced fresh start when the session cannot go on, and **no handover note**. Plan C1:
"a 'new conversation' button; on a fresh start the agent reads the same written context a laptop
session would."

- **Ask first** (D36). A tap on `NEW` shows the bar `[data-cockpit-newbar]` in the status line's
  slot (§1 item 2): **80 px** tall like the status line (D54, D134), right under the header,
  `--bg-sunken`. Left, from x 784 and ending 16 px before `START`: 18 px `--text-1`
  `Start a new conversation? Cards, jobs and notes stay.` (two lines, line height 1.35). Right, 16 px
  from the pane's right edge and vertically centred (16 px above and below): **`KEEP`** at the right
  end, **`START`** 16 px left of it, each 48 px tall and 96 px wide, 16 px caps `--text-1`, 1 px
  `--line-strong` border (`data-newbar="keep"`, `data-newbar="start"`). `START`, the one-way action,
  is the farther from the corner where the hand rests on `CLOSE` and the talk button.
  `KEEP`, a second tap on `NEW`, or 10 s without a tap hide the bar and nothing changes. A status
  line (room down) wins the slot: `NEW` is disabled then, and a bar that shows when the room goes
  down is hidden as if `KEEP` was tapped.

  | Where | Bar | Text | `START` | `KEEP` |
  | --- | --- | --- | --- | --- |
  | Wall page, pane (header y 0-64) | x 760-1368, y 64-144 | x 784-1128 | x 1144-1240, y 80-128 | x 1256-1352, y 80-128 |
  | App, pane (header y 36-100) | x 760-1368, y 100-180 | x 784-1128 | x 1144-1240, y 116-164 | x 1256-1352, y 116-164 |
  | Column (`split`, `canvas`, `switch`) | the 80 px under the column's header | same x | same x, 16 px below the bar's top | same x, 16 px below the bar's top |

  The conversation starts under the bar while it shows (it pushes the conversation down by 80 px
  like the status line; the pin rule of §7.1 applies).
- **`START`**: a running turn is stopped first (§8: `● STOPPING`, forced after 5 s; queued prompts get `Dropped by STOP.`). Then the room
  starts a new agent session at once (`protocols.md` §11.7 says how); the old session gets no further prompt and
  nothing is written for the new one. Like a laptop session, the new session reads the written
  context (repos, plans, notes). There is no extra turn state: the header goes back to `READY`. `START`
  and a forced fresh start each write one `cockpit.new` audit line (`screens.md` §6.4).
- **The divider**, drawn on every screen ≤ 0.5 s after the new session has started: a full-width
  row, 48 px, 1 px `--line` rules left and right of 16 px caps `--text-3` `NEW CONVERSATION · 07:10`.
  The old turns stay above it, unfolded, as history (D27's 50-turn rule counts across the divider);
  the view scrolls so the divider is at the conversation's top. A reload shows only the current
  conversation; the old one is kept on the room for 30 days (`protocols.md` §11.7.1, pending Q-O24).
- **What carries over**: the written context (repos, plans, notes), the canvas cards, scheduled
  jobs, every screen's layout, pane state and draft. **What does not**: the conversation's text in
  the agent's context.
- **Forced fresh start**: when the room cannot resume the session (`protocols.md` §11.7: two failed resumes), it starts a new
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
- **Who said it.** The room's audit log names the screen of each prompt and stop (`user`
  `screen:desk`, `screens.md` §6.4); the pane does not. Not shown in C1: a prompt's label is `YOU · 07:02` on every screen (T51,
  `reviews/36-skeptic.md` finding 13; the owner has not said they use two screens, Q-O9). Screen
  names in labels come back with the slice that pairs several screens (Q-O21).
- **Two prompts at once.** The room takes them in the order they arrive; the second stops the
  first's turn as §8 says, on every screen alike.
- A screen that opens or reloads gets the last 50 turns from the room and joins a running turn
  where it is (`protocols.md` §2.2).

## 13. No raw view in C1 (pending Q-O17)

Plan C1: "A raw terminal view of the same session as a toggle, for when the rendered view hides
something." Written for Q-O17's recommendation d) (T50, `reviews/36-skeptic.md` finding 7):

- C1 has **no raw view**: no `RAW` button, no `data-raw`, no second renderer of the agent's events.
- An **opened tool line** (§5) is C1's closest look: each call's tool, input, ms and `ok|failed`.
- When the rendered view hides something, the owner looks from the laptop (`spec-input.md` §3:
  "The laptop keeps its own full access, as today.").
- `server/terminals.mjs` is not used by the cockpit: it bridges a **writable** pty, and a device
  token must not get a shell (plan §4: a token cannot act).
- No tool output reaches any screen in C1 (D97). If Q-O17 brings it back, showing tool output is
  a per-screen setting on the room (`laneboard cockpit screens set <screen> raw-output on`), off
  by default, never one room-wide flag (review 40 finding 15); output passes §5.3's redaction.
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
And typing 6 lines (with `Shift+Enter`) makes the input 182 px tall with its own scrollbar, its
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

### S-C1-16 Sending during an answer steers it: queued, then taken into the same turn (pending Q-O1)
Given the fake agent on a turn that writes `Three runs ran last night.` from t = 0.3 s, calls
`mcp__laneboard__runs` from t = 1.0 s to t = 4.0 s, then writes more text; `queued` is
`next-tool-end`; the matched steer turn writes `Only builder-a failed.` 0.3 s after it is taken,
When at t = 2 s the owner types `only the failed one` (the slot reads `SEND`, no hint line shows)
and taps `SEND`,
Then by t = 2.1 s the prompt block is drawn last with `YOU · HH:MM · SENDING`; by t = 2.5 s it
reads `YOU · HH:MM · QUEUED` with its text in `--text-2`; the header reads `● WORKING` throughout
and never `● STOPPING`; no `STOPPED AT` line is drawn; by t = 4.1 s `· QUEUED` is gone, the text is
`--text-1`, and `Only builder-a failed.` is drawn below the prompt block in the same turn (one
`AGENT · HH:MM` label row in the turn, above `Three runs ran last night.`); the fake agent's log
has no interrupt and one `prompt` with `"priority":"next"` read at about t = 2 s.
Test: Playwright; assert the label text at 2.1 s, 2.5 s and 4.1 s, the prompt's computed colour
against `--text-2`/`--text-1`, no element with the text `STOPPED AT`, the order of the turn's items, and
`order()` from the fake-agent log (no `interrupt`).

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
Then the bar `Start a new conversation? Cards, jobs and notes stay.` shows at x 760-1368, y 64-144
(80 px) with `START` at x 1144-1240 and `KEEP` at x 1256-1352, both y 80-128: `KEEP` is the
rightmost, `START` ends 16 px left of `KEEP`'s left edge;
after 10 s without a tap it goes and nothing changed (same session id, 23 turns).
When the owner taps `NEW`, then `START` at 07:10,
Then by 0.5 s the divider `NEW CONVERSATION · 07:10` is drawn under the 23 turns, which stay
unfolded above it; the header reads `READY` throughout; both cards are still on the canvas; the
fake agent receives no prompt between `START` and the owner's next prompt; that prompt goes to a
new session id.
And when a turn is running at `START`, the header reads `● STOPPING` until the turn's end arrives,
then the divider is drawn.
Test: Playwright with a fake clock on the Wall page in `wall` at 1368x912; assert the bar's
`getBoundingClientRect()` height 80 ± 1 px, `[data-newbar="keep"]`'s `left` minus
`[data-newbar="start"]`'s `right` = 16 ± 1 px and `keep.right` = 1352 ± 1, both 48x96 ± 1 px; the
divider text, the 23 turns above it, the card count, the fake agent's received-turns log and
session ids.

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

### S-C1-25 Parallel calls fold by tool, end in any order, and show their ms
Given the pane open and the fake agent (script `c1-render`) scripted, after a prompt, to start
`mcp__laneboard__fleet` with `site` `hv1` at 100 ms (ends at 900 ms), `fleet` with `site` `hv2` at
110 ms (ends at 400 ms, `isError:true`) and `mcp__laneboard__ci` with `branch` `main` at 120 ms
(ends at 600 ms), then text at 1 000 ms,
When the owner sends `how is the fleet?` at t = 0,
Then by 300 ms the reply shows two tool lines in this order, both with `●`: `read 2 feeds…` and
`looked at CI on main…`; at 700 ms only the first has `●`; at 1 000 ms it reads `read 2 feeds · 1
failed`, no `●`; tapped open, its rows read `fleet  {"site":"hv1"}  800 ms  ok` and
`fleet  {"site":"hv2"}  290 ms  failed` (each `endedAt − startedAt`: at least the scripted span, at most 100 ms more).
And a second case with `hv1` ending at 300 ms and `hv2` at 900 ms gives the same lines and texts.
Test: Playwright; sample `[data-tool-line]` texts and their `●` every 100 ms; tap the first line,
read its rows; the second case reorders the ends in the script.

### S-C1-26 A fresh screen says it is connecting, then never shows a blank pane
Given the stand-in room holding the conversation `c-0007` with 3 turns, and a page loaded at t = 0
with the room's outbound `welcome` held back 2 s (the outbound fault hook, `stand-ins.md` §1.1),
When the owner opens the pane at t = 0.5 s,
Then `data-cockpit="connecting"`, the conversation shows exactly `Connecting to the cockpit room…`,
`SEND` is disabled and the input takes typed text; by 2.5 s the 3 turns are drawn with the last
one's end in sight and the line is gone.
And with an empty conversation the line becomes `Nothing said yet. Type a question, or hold the
talk button and speak.` and stays until a prompt is sent.
And with the room not answering at all, at 5 s `data-cockpit="room-down"` and the status line says
`Cockpit room unreachable since` the load's `HH:MM`.
Test: Playwright against the room under test; hold back `welcome` with the fault hook; assert
`data-cockpit`, the conversation's text and `SEND`'s `disabled` at 0.5 s and 2.5 s; restart with an
empty conversation, then with the room stopped.

### S-C1-27 STOP during a turn drops a queued prompt and says so (pending Q-O1)
Given the fake agent on a turn calling a tool from t = 0.5 s to t = 20 s, `onInterrupt`
`endAfterMs` 300, capabilities with `interrupt_cancel_queued_v1`, and the prompt
`only the failed one` sent at t = 1 s and showing `· QUEUED`,
When the owner taps `STOP` at t = 3 s (the input is empty, the slot reads `STOP`),
Then by t = 3.1 s the header reads `● STOPPING`; the fake agent's log has an interrupt with
`cancel_queued` true; by t = 3.5 s the turn shows `STOPPED AT HH:MM`, the header `READY`, and the
queued block reads `YOU · HH:MM · NOT SENT` with `Dropped by STOP.`, `RETRY` and `EDIT`; nothing
more is sent to the agent. A tap on `RETRY` at t = 5 s sends `only the failed one` with a new
`clientId` as a new turn (`delivery:"new"`).
Test: Playwright on the real room with the fake agent; assert the texts at 3.1 s and 3.5 s, the
log's interrupt line, `prompts()` count 1 before and 2 after `RETRY`, and two different `clientId`s
in the screen's sent messages.

### S-C1-28 A queued prompt the agent never reads is sent once more, then shown as not sent (pending Q-O1)
Given the fake agent with `queued` `ignore-once` on a turn that ends `done` at t = 3 s, and the
prompt `only the failed one` sent at t = 1 s,
When nothing else is tapped,
Then the block reads `· QUEUED` from t = 1.5 s; at t = 13 s (10 s after `turn.end`) the room sends
it to the agent again with a new UUID; the fake takes it as a new turn and by t = 13.5 s `· QUEUED`
is gone and its reply starts under its own `AGENT · HH:MM` label row. With `queued` `ignore` the
second send is not taken either, and at t = 23 s the block reads `YOU · HH:MM · NOT SENT` with
`The agent did not read this.`, `RETRY` and `EDIT`.
Test: Playwright, room clock `manual` and `advance(ms)` (`stand-ins.md` §1.1); two fake-agent scripts; assert
`prompts()` count 2 with two UUIDs, the room's log line `prompt.resend`, the label texts at 13.5 s
and 23 s; in both cases exactly one resend.

### S-C1-29 A queued prompt survives a reload (pending Q-O1)
Given the fake agent on a turn calling a tool from t = 0.5 s to t = 20 s, then writing text, and the
prompt `only the failed one` sent at t = 1 s and showing `YOU · HH:MM · QUEUED`,
When the owner reloads the page at t = 3 s and opens the pane,
Then by t = 5 s the snapshot is drawn: the turn's tool line with `●`, and as the conversation's
last block `YOU · HH:MM · QUEUED` over `only the failed one` in `--text-2` (the same `HH:MM` as
before the reload); at t = 20 s the fake agent takes it (`prompt.taken` `taken`), and by t = 20.1 s
`· QUEUED` is gone, the text is `--text-1` and the block sits above the turn's text that follows.
And a second case: the owner taps `STOP` at t = 3 s (the prompt reads `NOT SENT` with
`Dropped by STOP.`), then reloads at t = 5 s: by t = 7 s the reloaded pane shows the same label,
line, `RETRY` and `EDIT`, and `RETRY` sends `only the failed one` as a new turn with a new
`clientId`.
Test: Playwright on the real room with the fake agent; read the `snapshot` frame with
`framereceived` and assert its running turn has one item `{"kind":"prompt","state":"queued"}` with
the sent `clientId`; assert label texts and computed colour before and after the reload, at
20.1 s the block's index among the turn's items; in the second case the item's `state`
`cancelled` and `why` `stopped`, and `prompts()` count 2 after `RETRY`.

### S-C1-30 A shell call is refused and shows as a grey `tried` line (pending Q-O23)
Given the pane open, the real room with the fake agent (script `c1-render`), whose turn for
`clean up the logs` has a `denied` step `Bash` at 100 ms with input
`{"command":"rm -rf /var/log/laneboard/old && echo done"}`, a second `denied` step `Bash` at 200 ms
with `{"command":"ls /var/log"}`, text `I cannot run commands here; I can only look.` at 400 ms and
`end` `done` at 600 ms,
When the owner sends `clean up the logs` at t = 0,
Then by 700 ms the reply shows two tool lines, not one folded line, each reading exactly
`tried Bash, not allowed`, in `--text-2`, with no `●`, no `…` and no ` · failed`, followed by the
text block; the header reads `READY` and no line of §10 is drawn. Tapped open, the first line's row
reads `Bash  {"command":"rm -rf /var/log/laneboard/old && echo done"}  refused`, wrapped inside the
text column. The fake agent's `start` line has in its `argv` `--strict-mcp-config`, then
`--allowedTools` followed by `mcp__laneboard__*,Read,Grep,Glob`, then `--permission-prompts`
followed by `none`, and no `argv` element contains `Bash`.
Test: Playwright on the real room with the fake agent; count `[data-tool-line][data-denied="true"]`
(2) and read their texts and computed colour; tap the first, read its row and assert its
`scrollWidth` is at most its `clientWidth`; read `starts()[0].argv` from the fake agent's log
(`stand-ins.md` §2.6).

### S-C1-31 A secret in a tool's input never reaches the screen
Given the pane open and the fake agent (script `c1-render`) whose turn for `find the token` has a
`Grep` step (`"call":false`) at 100 ms ending at 300 ms with input
`{"pattern":"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123DEF456ghi789","path":"/etc/laneboard"}`,
a `denied` step `WebFetch` at 400 ms with
`{"url":"https://example.invalid/hook?token=Q7wErTy12&lb_sig=Zq9Xw4Vr"}` and `end` `done` at 600 ms,
When the owner sends `find the token` at t = 0,
Then by 700 ms the reply shows `searched the files` and `tried WebFetch, not allowed`; opened, the
rows read `Grep  {"pattern":"Authorization: Bearer [redacted]","path":"/etc/laneboard"}  200 ms  ok`
(the ms as in S-C1-25: at least 200, at most 300) and
`WebFetch  {"url":"https://example.invalid/hook?token=[redacted]&lb_sig=[redacted]"}  refused`; no
text frame the page received contains `eyJhbGci`, `abc123DEF`, `Q7wErTy12` or `Zq9Xw4Vr`.
Test: Playwright; collect every `framereceived` payload from the page's link and assert none holds
the four strings; open both lines and read their rows. The rules themselves are the unit test of
`server/cockpit/redact.mjs` (§5.3), in `npm test`.

### S-C1-32 The on-screen keyboard: the input row sits on its edge, the conversation stays pinned
Given a touch context (`hasTouch: true`) at 1368x912, the Wall page in `wall` (on the app's `#/map`
first, T31), the pane open on a 12-turn conversation scrolled to its end, the input empty, no chip,
no status line,
When the owner taps the input at t = 0 and the test resizes the viewport to 1368x532 at t = 0.1 s
(a 380 px keyboard),
Then by t = 0.2 s `data-keyboard="up"`; `[data-cockpit-conversation]` is x 760-1368, y 0-532; the
input is x 784-1184, y 460-524; `SEND` x 1200-1264 and the talk button x 1280-1344, both y 460-524;
the opener reads `CLOSE` at x 1288-1336, y 396-444; the header's `CLOSE` is at y 8-56; the
conversation is 380 px tall, scrolled to its end, the last turn's last line inside it.
When the owner types `and builder-a?` and taps `SEND`,
Then the input still has the focus, `data-keyboard` stays `up`, and the new prompt block's rect is
inside the conversation's rect.
When the owner flicks the conversation 60 px down and back,
Then the input still has the focus.
When the owner taps the conversation's text at (1000, 200), not on a tool line,
Then the input has lost the focus and `data-keyboard="down"`; after the test resizes back to
1368x912 the rects are §1's (input y 824-888, the opener `CLOSE` at y 760-808) and the
conversation is at its end.
Test: Playwright with `hasTouch`, `tap`, `touchscreen` drag for the flick and `setViewportSize`;
`getBoundingClientRect()` of each part compared ± 1 px; `document.activeElement` after each step;
pinned is `scrollTop + clientHeight ≥ scrollHeight − 1`. A second run stays at 1368x912 and
stubs `navigator.virtualKeyboard` with an init script (`boundingRect.height` 380, one
`geometrychange` dispatched after the tap) and asserts the same rects (D130).

### S-C1-33 Keyboard up with the status line and a long draft: the conversation keeps 200 px
Given S-C1-32's setup with the room down (the pane's 80 px status line, `screens.md` §7) and the
viewport at 1368x532 after a tap in the input,
When 8 214 characters are pasted into the input (the length note shows, §7),
Then the status line is y 64-144, the note sits in the line slot above the input row, the input is
132 px tall (`clamp(64, 64 + 268 − 200, 182)`), its bottom at y 524, scrolled to its end with the
caret on its last visible line, and the conversation is 200 px tall.
When the test resizes back to 1368x912 and blurs the input,
Then `data-keyboard="down"` and the input is 182 px tall (4 lines, §7) with its bottom at y 888.
Test: Playwright `fill`; rects and heights ± 1 px; the input's
`scrollTop + clientHeight ≥ scrollHeight − 1`; the conversation's `clientHeight`.

### S-C1-34 Chip, line slot and `↓ NEW` stack without overlapping
Given the Wall page in `wall` at 1368x912 (`hasTouch: true`), the pane open on 10 earlier turns, a
chip for `vm-b` from `ASK ABOUT THIS` (S-C3-10), and the fake agent streaming a 30-line reply over
6 s,
When the owner drags the conversation down by 600 px at t = 1 s (scrolling up),
Then `↓ NEW` is x 1168-1264, y 680-728, the chip row y 744-808 with the chip y 752-800 and its `✕`
ending at x ≤ 1264; `↓ NEW`, the `✕` and the opener (`CLOSE`, x 1288-1336, y 760-808) do not
intersect and are ≥ 8 px apart.
When at t = 2 s the room's link stops, and 5 s later `data-cockpit="room-down"`,
Then there is one `[data-cockpit-line]`, `data-line="room-down"`, y 776-808, reading `Sending and
voice come back with the room.`; the chip row is y 712-776 (chip y 720-768), `↓ NEW` y 648-696,
the conversation's bottom y 712, and the line that was at the conversation's top is still there.
When the owner pastes 8 214 characters into the input,
Then the input is 182 px tall, the slot still shows only `room-down` (the length note waits) at
y 658-690, the chip row y 594-658, `↓ NEW` y 530-578.
When the link starts again and `data-cockpit="live"`,
Then the slot shows `data-line="length"` reading `8 214 / 8 000 CHARACTERS` at the same rect.
When the owner taps `↓ NEW`,
Then the chip is still there (one `[data-cockpit-chip]`, `data-node="vm-b"`), the last line is in
sight and `↓ NEW` is gone.
Test: Playwright with `page.clock`, a `touchscreen` drag, `POST /link {"up":false}` and
`{"up":true}` on the room under test, `fill` for the paste; `getBoundingClientRect()` of the slot,
the chip row, the chip, `[data-cockpit-chip-remove]`, `↓ NEW` and `[data-cockpit-open]` compared
± 1 px after each step, and a pairwise check that no two of the tappables intersect or come closer
than 8 px; `count()` of `[data-cockpit-line]` is 1 at each step.

### S-C1-35 Tool lines from odd input, and the words module's unit test
Given the fake agent on script `c1-render`, a turn whose steps call, 100 ms each with reply text
between them, `Read` `{"file_path":"/etc/laneboard/"}`, `mcp__laneboard__runs` `{"run":7}`,
`mcp__laneboard__lanes` `{}` and `mcp__laneboard__ci`
`{"branch":"ci-fix/very-long-branch-name-for-the-night-run"}`,
When it has ended,
Then the four tool lines read exactly `read laneboard`, `looked at run 7`, `looked at the lanes`
and `looked at CI on ci-fix/very-long-branch-name-for…` (32 characters kept, no space to go back
to), each in `--text-2` with no `●`.
Test: Playwright; `textContent` of the four `[data-tool-line]` elements. And
`test/tool-words.test.mjs` in `npm test` for `public/js/core/tool-words.js` (D147, the pure
module holding §5's table): `Bash` `cd /srv/app && npm test` → `ran cd /srv/app && npm test`;
`Bash` `PGPASSWORD=[redacted] psql -h db` (input as redacted by the room) →
`ran PGPASSWORD=[redacted] psql -h db`; `Bash` `rm -rf /var/log/laneboard/old && echo done` →
`ran rm -rf /var/log/laneboard/old…`; `Bash` `"echo a\n\n  echo b"` → `ran echo a echo b`; `Bash`
`{}` → `ran a command`; `WebFetch` `https://Example.Invalid:8443/a?x=1` →
`fetched a page from example.invalid`; `WebFetch` `javascript:alert(1)`, `not a url` and `42` →
`fetched a page from an invalid address`; two `WebFetch` calls on `https://example.invalid/a` and
`/b` → `fetched a page from example.invalid`, on two hosts → `fetched 2 pages`; `Read` `/` →
`read /`; a 40-character target of emoji is cut after 32 code points with no lone surrogate.

### S-C1-37 A logged-out agent is named before any prompt, and the line goes after the login
Given the room under test with the script `c1-login` (`start.login` `ok`), its clock set to
2026-10-27 03:00 and `manual` (`stand-ins.md` §1.2), and no page open,
When the test writes `login` `failed` into the script and advances the room's clock 900 s,
Then the fake agent's log holds a second `login-check` line, and a page loaded now (pane opened at
once) shows in its first frame after `welcome`: `[data-cockpit-status]` with `data-status`
`not-logged-in`, text exactly `The agent is not logged in on the room since 03:15. Log it in there.`,
rect y 64-144 (80 px), computed font size 18 px; `SEND` and the talk button enabled;
`fakeAgent.prompts()` is 0.
When the test advances 60 s three times,
Then the log holds three more `login-check` lines (every 60 s while logged out) and the text is
unchanged (`since 03:15`, not the later checks' times).
When the test writes `login` `ok` and advances 60 s,
Then within 1 s the status line is gone (`[data-cockpit-status]` absent, the conversation's top at
y 64) and the fake's `starts` is one higher (the room restarts an idle agent with `--resume` so it
reads the new login, `protocols.md` §11.10).
And a second case: the room started with `login` `failed` from the beginning; a page loaded 2 s
after the room shows the same line with the room's start time, before anything is typed.
Test: Playwright against the room under test, `POST /clock` for `set`, `manual` and `advanceMs`;
`fakeAgent.loginChecks()`; text, `data-status`, rect and computed style of
`[data-cockpit-status]`; `disabled` on `SEND` false; `starts` read before and after. The 10 s
timeout row of `protocols.md` §11.10 is a `node:test` of the room's check with `login` `hang`.

### S-C1-38 One status line: the highest that holds wins, news never waits
Given S-C1-37's page with `not-logged-in` showing,
When the room's link stops (`POST /link {"up":false}`) and 5 s pass,
Then `data-status` is `room-down`, its text starting `Cockpit room unreachable since` (the page's
own clock, `screens.md` §7); there is still one `[data-cockpit-status]` element.
When the test sets the page offline (`context.setOffline(true)`),
Then `data-status` is `offline`; set online again, it is `room-down`.
When the link starts again,
Then the first frame after `welcome` shows `not-logged-in` with `since 03:15`, and at no sample
from then to 6 s does `Back since` show.
Second case: a fresh room with `login` `failed`, `startFailures` 3 and `startStderr`
`claude: command not found` (`stand-ins.md` §2.4), clock `real`: after the second failed start
`data-status` is `agent-down` (`Agent not running since HH:MM.`, the room's time of that start),
`SEND` and talk disabled; at the fourth start's `ready` (about 6 s after the first) it becomes
`not-logged-in` (the condition still holds) and `SEND` is enabled again; no `agent-back` line
shows while `not-logged-in` holds.
Third case: `login` `ok`, no condition, the link blips 6 s: `Back since HH:MM.` (the page's clock)
shows for 5 s ± 0.2 s, then nothing.
Test: Playwright; sample `[data-cockpit-status]` count, `data-status` and text every 100 ms; room's
`GET /sent?type=status` holds one message per change, in the order of the table's rows.

### S-C1-39 A room restart mid-conversation: the same turns, the same session (pending Q-O24)
Given the room under test with the script `c1-session` and its clock `real` (the restarted process
keeps no clock the test set), started on seeded state (`stand-ins.md` §1.1 `stateFiles`):
`session.json` for `c-0007` with session `0b7e5c2a-4d1f-4c3e-9a8b-2f6d1e0c7a91` and
`conversation.jsonl` with 20 `done` turns `t-0101`..`t-0120`, dated 60 to 41 min before now (made
by `test/cockpit/fixtures/conversation.mjs`, so none is past the 30 days); the page loaded, the pane open;
the owner has sent `how is builder-a` twice and both are answered (22 turns); then sends `how is
builder-a` a third time, and while its answer streams (1.0 s after the send)
When the room process is killed (`booted.restart({signal:"SIGKILL"})`, same state dir),
Then within 5 s of the kill `data-cockpit="room-down"` and its status line show (`screens.md` §7);
the 23 turns stay on screen.
When the restarted room prints its `control` line,
Then within 10 s the page has reconnected (its `welcome` has another `epoch`, `resume`
`"snapshot"`) and drawn the snapshot: 23 prompt blocks, the first `t-0101`'s, `conversation`
`c-0007`, no `NEW CONVERSATION` divider; the 23rd turn shows its prompt and no reply text (its one text
block would have been written at its end, 2 s after the send) and under it `[data-turn-error="agent-exited"]` with `The agent stopped unexpectedly
at HH:MM. The room is starting it again.`, then, once the agent is back, `The agent is back (HH:MM).
Your last message was not answered.` and `RETRY` (`HH:MM`: the restarted room's start, §11.7.1
step 3 of `protocols.md`); the header reads `READY`; the view is scrolled to
the end.
When the owner taps `RETRY`,
Then the fake agent's log has a second `start` line with `"resumed":true` and the same `session`
`0b7e5c2a-…`, and its `prompts()` grows by 1 with `how is builder-a`; the new turn is `t-0124`
and is answered in 2 s.
And the state dir's `cockpit/conversation.jsonl` has mode 0600, holds exactly one `conversation`
line and one `turn` line per turn (24 after the answer, rewritten at the start), and no line holds
a `kind` other than `conversation` or `turn`.
Test: Playwright against the room under test; `booted.restart` with `SIGKILL`; read `welcome` and
the `snapshot` frames with `framereceived` (`turns.length` 23, `olderTurns` 0); count
`[data-turn-id]` elements (the first `t-0101`); text of the error line; `fakeAgent.starts()` and its `start` lines;
`fs.statSync(...).mode & 0o777` is `0o600` and the file's lines parsed. The start steps' edge
cases (torn line, 31-day-old turn, missing `session.json`) are `protocols.md` §13's store test.

### S-C1-40 The type floor: no text under 16 px, no instruction under 18 px (T43, D21, D167)
Given the Wall page in `wall` at 1368x912 (`hasTouch: true`), `document.fonts.ready` resolved and
`document.fonts.check('500 18px "Barlow Condensed"')` true (the vendored face, not a fallback: the
line counts below hold only with it), the pane open, the script `c1-render`,
When the page is brought through four states, one after the other: (1) idle, the header `READY`;
(2) the owner sends a prompt and the reply streams S-C1-05's 4-column table, S-C1-08's 40-line `sh`
block and two tool lines, one of them opened (header `● WORKING`); (3) after its end, 8 214
characters pasted into the input (S-C1-15's note); (4) the room's link stopped until
`data-cockpit="room-down"`,
Then in every state each text node under `[data-cockpit-conversation]` with non-white-space text,
whose parent has a non-empty `getClientRects()`, computed `visibility` `visible` and `opacity`
above 0, has a parent whose computed `font-size` is ≥ 16 px (the fence label `SH` included);
`[data-cockpit-turn]`, `[data-cockpit-line]` and `[data-cockpit-status]` are ≥ 18 px;
`[data-cockpit-turn]`'s colour is `--text-2`'s and `[data-cockpit-line]`'s `--text-1`'s; in (3)
the line slot reads `8 214 / 8 000 CHARACTERS`, y 776-808 (one line, 32 px); in (4) it reads
`Sending and voice come back with the room.`, y 776-808.
And the C2 slice runs the same walk in three voice states: a hold past 400 ms (`RELEASE TO SEND ·
SLIDE OFF TO KEEP`, one line; `[data-talk-cancel]` holds only `✕` at a computed 28 px with the
accessible name `Cancel`), a slide off (`MICROPHONE OFF · TEXT KEPT`), and `[data-talk-error="stt-down"]`
with `data-talk-detail="token"`: 2 lines, the slot y 752-808 (56 px), the text not cut (no `…`,
it ends with `Tap TALK to try again.`).
Test: Playwright; one `page.evaluate` with a `TreeWalker` over `NodeFilter.SHOW_TEXT` returning
`{text, px, path}` for every node under the floor, asserted empty per state; computed styles and
rects of the three selectors; colours compared with `getComputedStyle(document.documentElement)`
values of `--text-1` and `--text-2`; for C2 the fake speech scripts `c2-tap` (hold, slide off) and
`c2-faults` (its `"401"` utterance, `stand-ins.md` §3.3). The walk is a helper the later slices
reuse on the canvas (`[data-card]`).

## 15. The demo (`?demo=1`, T36/T76/T93)

`docs/plans/product.md` rule 2: "A feature without demo data is not done, because the demo is how a
stranger meets it." The hosted demo is a static page with no board and no room (product.md §4), so
the cockpit brings its own: a **demo link**, a client-side stand-in for the room link that answers
with canned messages of `protocols.md` §2-§3 (D148).

**When the page uses it.** The URL's query has `demo=1` (`new URLSearchParams(location.search)
.get('demo') === '1'`; the hash route does not count) **and** there is no cockpit: the first of
- the board's first `/ws` frame says `"cockpit":false` (D93),
- the board's `/ws` closes or errors before its first frame (the static demo: nothing answers `/ws`),
- `DEMO_WAIT_MS` = 3 000 ms after load with no frame (D150).

With `"cockpit":true` the page uses the real room link as without `demo=1`: `?demo=1` on the
Wall is also its tour speed (Wall plan §3), and `c3-see.md` §10's harness runs `?demo=1` against a
paired room. Once on the demo link, the page stays on it until a reload. D17's "no cockpit, no
button" does not apply on the demo link (D17's exception).

**What the demo link never does**: open a WebSocket, call `fetch` or `XMLHttpRequest`, send
anything to `/api/cockpit/*` (`COCKPIT_PREFIX`), or show the pairing card. It lives in
`public/js/core/cockpit-demo.js` (pure: no DOM, no network; `createDemoLink({now, setTimeout})`
takes its clock and timers),
loaded with `import()` only when the page takes the demo link, so a normal page carries none of it.
Its link object has the same three calls as the real room link (`send(msg)`, `onMessage(cb)`,
`close()`); everything above the link (pane, conversation, renderer, tool lines) is the same code.

**What the screen shows** (differences from a live room only):

| Where | Demo |
| --- | --- |
| root | `data-cockpit="live"` and `data-cockpit-demo` (no value); `data-cockpit-layout` as stored (`screens.md` §1) |
| opener and talk button | `CHAT` in its rect (`screens.md` §4, pending Q-O11); no talk button: `welcome.config.stt` is `none` (`c2-voice.md` §9) |
| header | `COCKPIT`, 16 px later `DEMO` (16 px caps `--text-1`, 1 px `--line-strong` border, 28 px tall, 8 px padding left and right, `[data-cockpit-demo-label]`), 16 px later the turn state. The left part ends by x 1030 with `● STOPPING`; on the Wall `NEW` starts at x 1072 (from the right: `CLOSE` 1256-1352, `SCREEN` 1152-1248, `NEW` 1072-1144) |
| input placeholder | `Demo: type anything` (19 characters, one line at 21 per line, §7) |
| status line, line slot | never `room-down`, `unpaired` or `offline`: the demo link is never down |

**The link's messages.** On the page's `hello` it answers, 50 ms later:
- `welcome` with `screen:"demo"`, `epoch:"demo"`, `conversation:"c-demo"`, `resume:"snapshot"`,
  `config:{"stt":"none","languages":["en"],"maxPromptChars":8000}`, `status:null`, `now` from the
  page's clock (no skew line, ever);
- one `snapshot` (`parts:1`, `olderTurns:0`, `pins:[]`, `cards:[]`; the demo cards of `screens.md`
  S-SCR-10 join `cards` with the Canvas slice) holding the three canned turns below.

It numbers its own `seq` from 1. Each message it emits passes `protocols.md` §2.4's rules (S-C1-36's
unit test), so the demo cannot drift from the protocol.

**The canned conversation**, demo fleet facts as in `c3-see.md` §4 (all typed, `lang:null`,
`about:null`; times are the load time less 6, 4 and 2 min, cut to the minute):

| Turn | Prompt | Tool line | Reply |
| --- | --- | --- | --- |
| `t-demo-1` | `how did the night go?` | `read the Morning for tonight` | `■ One run is stuck: acme-billing on builder-b since 06:12, the same task failed twice.` / `■ docs on builder-a finished at 03:20, PR #39 green.` / `■ A question waits for you on builder-a: page size 20 or 50?` / `■ builder-c has sent nothing since 06:41.` (four paragraphs) |
| `t-demo-2` | `what is stuck?` | `looked at the runs` | a table `Run \| Host \| Since \| Why` with one row `acme-billing \| builder-b \| 06:12 \| same task`, then `T3 failed in rounds 3 and 4. It also asks you: Drop the v1 export?` |
| `t-demo-3` | `what did last night's run cost?` | `read the Morning for tonight` | `Last night cost 18.62 USD, 12.40 of it on acme-api. acme-billing alone: 4.40 USD in 4 rounds.` |

**Typing plays a demo turn.** A `prompt` gets an answer timed like `protocols.md` §10 from its 2.96 s
line on; `t` is seconds after the `prompt`:

| t (s) | Message |
| --- | --- |
| 0.10 | `turn.prompt` (new `turnId` `t-demo-<n>`, the prompt's `clientId`, `delivery:"new"`), `turn.state` `thinking` |
| 0.60 | `tool.start` (the matched row's tool; none for the no-match reply) |
| 1.10 | `tool.end`, `isError:false` |
| 1.30 | `turn.state` `answering`, then one `text.delta` per white-space-separated word (with the white space after it) every 60 ms |
| last delta + 0.10 | `text.block` |
| + 0.10 | `turn.end` `done` |

- **Matching**, case-insensitive substring of the prompt, first hit wins: `night` → turn 1's tool
  and reply, `stuck` → turn 2's, `cost` → turn 3's. Repeats are allowed. Anything else gets no tool
  line and the reply `This is the demo: it answers three questions. Try “how did the night go?”,
  “what is stuck?” or “what did last night's run cost?”. With a room of your own, the agent reads
  your own fleet (docs/cockpit.md).` The longest canned reply (turn 1, 43 words) ends `done` 4.0 s
  after the send.
- **A send during a demo turn** is steered as §8 says: the prompt shows `· QUEUED`, the link sends
  `prompt.taken` (`state:"taken"`, `atBlock` = the next block) at the next `text.block` (at once
  if the turn is still before its tool's end), and the turn plays that prompt's reply as one more
  text block before its `turn.end`.
- **`stop`**: `turn.end` `stopped` 200 ms later (never forced); a queued prompt becomes
  `cancelled` `why:"stopped"` (§8).
- **`new`**: `conversation.new` `reason:"owner"` 100 ms later; the empty conversation of §11 follows.
- `history`, `focus`, `hello` again: `history.turns` with `turns:[]`; `focus` is dropped; a second
  `hello` gets the same `welcome` and a `snapshot` of the conversation as it now is.
- No limits apply that need a room (E9 `too-many`, length beyond 8 000 characters is still the
  screen's own §7 rule).

### S-C1-36 The static demo: the pane opens on a canned conversation and typing plays a turn
Given `public/` served by a plain static server (nothing answers `/ws` or `/api/*`), 1368x912,
`page.clock` at 2026-10-27 07:00:00 local,
When the page loads `index.html?demo=1#/map`,
Then within 1 s of the `/ws` failure `data-cockpit="live"`, `data-cockpit-demo` is set and `CHAT` is
in its rect, with no talk button; a tap on `CHAT` opens the pane on three turns labelled
`YOU · 06:54`, `YOU · 06:56`, `YOU · 06:58`, the last reply in sight, the header reading
`COCKPIT`, `DEMO`, `READY`, and the input's placeholder `Demo: type anything`.
When the owner types `What is stuck?` and presses `Enter`,
Then `YOU · 07:00 · SENDING` shows, `· SENDING` is gone at t = 0.1 s, the header reads `● WORKING`,
a tool line `● looked at the runs…` shows by t = 0.6 s and ends at 1.1 s, the table streams in, and
by t = 5.0 s the header reads `READY` and the turn holds the table of turn 2.
When the owner sends `hello`, then 1.5 s later `STOP`,
Then the first gets the no-match reply's first words and ends with `STOPPED AT 07:00`; no tool line.
And: no request reached the server's log for `/api/cockpit/`, and the page made no WebSocket to
`/api/cockpit/ws` and no `fetch` from `cockpit-demo.js`.
Second case: the room under test with the fake agent, `hello.cockpit:true`, `?demo=1`: the pane
opens on the room's conversation, no `DEMO` label, no `data-cockpit-demo` (the real room wins).
Test: Playwright with `page.clock`; `page.on('websocket')` and `page.on('request')` collect every
socket and request; the static server's access log; texts of the label rows, the header and the
tool line; `placeholder`; `[data-cockpit-demo-label]` count 1, then 0 in the second case. And
`test/cockpit-demo.test.mjs` in `npm test`: drives `createDemoLink({now, setTimeout})` with a fake
clock through `hello`, the three matches, a no-match, a mid-turn send and a `stop`, and checks every
emitted message with `protocols.md` §9's fixture checker and its `seq` running 1, 2, 3, ….
