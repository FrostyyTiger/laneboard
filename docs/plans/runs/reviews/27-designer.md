# Review: designer, round 27 (runs-n5)

What I looked at: `shots/26-T13/`, the only shots taken since review 13. They show Board and
Inbox, dark and light, at 1440 and 390, after T13 ("one mark per state"). I took no new shots,
because Map, Runs and the run page have not changed since `r11-T5*` (review 13 covers them). I
compared the shots against README §5 and the Night direction (§8 Q6). Only one direction is in
use, so I have no directions to compare. Within each section, the worst problem comes first. I
do not repeat items already listed as T14-T23 or under `## For the owner`. I name them only
where these shots show something new about them.

## Console

- `shots/26-T13/console.txt`: empty (0 lines).

## Across both views (fix once)

1. **Shots seconds apart show a different fleet.** This makes dark and light impossible to
   compare:
   - Board dark 1440 (20:36:08): `BC` is online (grey ●), the `DOWN` tile is empty, the bench run
     card is a plain `● WORK`.
   - Board light 1440 (20:36:19): `BC` is offline (hatched plate), `DOWN ■1` is red, the
     bench-run and release-notes cards are hatched `OFFLINE`.
   - `deps-bump`: Board says `● WORK` with `NEED ▲1`; the Inbox, 6 s later, has it under NEEDS
     YOU as `question` with `NEED ▲2`.
   - Phone bar: `▲3 ●3/9` on the Board shots, `▲4 ●2/9` on the Inbox shots.
   - Phone Inbox: dark shows `BC ■` with `DOWN ■1`, light shows `BC ●` with an empty `DOWN`
     tile.

   A reviewer cannot tell a theme bug from demo motion. Fix: freeze the demo fleet's clock and
   seed while a set of shots runs, or shoot all themes and widths from one snapshot.
   `loop/shoot.mjs` is fenced, so this is for the owner (it pairs with review 13's "freeze
   animations" idea).
2. **A lane is named three ways.**
   - Board: the plate `BB` plus `cleanup job` in lowercase mono.
   - Inbox: one condensed-caps plate, `BUILDER-B/CLEANUP JOB`.
   - Status bar and phone ticker: `BB/cleanup job`.

   The same lane should read the same everywhere. Fix: the Board form everywhere, a fleet plate
   (`BB`) and the session name in mono after it. In the Inbox that means `[BB] cleanup job`;
   the long `BUILDER-B` stays in the plate's tooltip.
3. **The Inbox drops the mark word that T13 just unified.** The Board card, the NEEDS YOU list
   and the phone chip now read `▲ PERM` / `▲ QUES` / `▲ STCK`. The Inbox shows only the shape,
   then a generic lowercase `question` where the reason goes. Fix: the same `▲ QUES` word after
   the shape (from `STATE_MARK`), then the question's own text when the session has one. Print
   `question` only as the fallback, and in `--text-3`.

## Board (`26-T13/board-*`)

1. **The offline hatch runs under the text on the desktop too.** At 1440 light, `bench run`,
   `Bash npm run bench`, `release-notes` and the `▲ ctx 71%` line sit on the diagonal lines, and
   the grey text over grey hatch is the hardest-to-read text on the screen. T17 covers only the
   phone. Fix: the same solid `--bg-surface` strip behind the text rows at every width, with the
   hatch only in the gaps and the card margin. Or hatch just the left bar and the header strip.
   Extend T17's check to 1440.
2. **The phone already shows T14's target; the desktop still fills.** At 390 the selected `ALL`
   plate is outlined in the accent, with no fill: right. At 1440 the sidebar `ALL` is still a
   light slab in dark and a black slab in light, inside the brackets (T14, open). Use the phone's
   form for T14.
3. **The filter chips leave a blank slot on the left.** In `feat-search 2`, `fix-login 1` and
   the rest, the left padding is about 33 px and the right about 20 px (1440), and about 55 px vs
   30 px at 390. The text sits off-centre, as if a mark were missing. Fix: equal `--sp-3`
   padding on both sides, or put the lane's state mark in the slot (`▲ feat-search 2`). The
   slot then means something, and the idle row (review 6 idea) can use `○` in the same place.
4. **Phone: the current view has no name.** On the Board, the bottom bar reads
   `MAP LIST INBOX …` and the `…` button carries the accent frame. So the accent marks "more",
   and the word BOARD is nowhere on the screen. Fix: when the current view lives under `…`, the
   fourth slot shows its name (`BOARD`) with the accent frame, and `…` moves beside it unframed.
5. **The red card is 255 px tall for 4 lines** (1440). It stretches to its row's height, which
   the feat-search card sets, so about 130 px of empty red-framed box sits under YES/NO. A red
   frame around nothing reads like an alarm with no content. Fix: `align-items: start` on the
   lane grid, so each card is as tall as its content.
6. **Phone: `LAUNCH A LANE…` takes a row of its own.** That costs about 100 px between the
   plates and the needs chips, on the screen where height costs most. Fix: put it at the end of
   the plate row as an icon button (`+`), or below the lanes.
7. **Light: amber is still olive.** `▲ PERM`, `▲ QUES` and the left bars read mustard-brown.
   At 390 light, the ▲ is close to the body text's weight, so the shape carries the warning
   alone. (Review 6 idea, in For the owner; these shots confirm it at both widths.)
8. **Light: the nested session panels are still grey `--bg-sunken` blocks**, heavier than in
   dark (review 6 idea, unchanged).
9. **`$0.00 sessions today`** is still the largest type in the header (T15, open). `MACHINE` is
   still a bare heading (T17, open).

## Inbox (`26-T13/inbox-*`)

1. **The stuck lane is the one mark T13 did not reach.** `ci-retry` is `▲ STCK` on the Board,
   but in the Inbox it is `○ BUILDER-B/CI RETRY same tool call 14x in 6m` under ARCHIVE / STALE,
   in grey. The owner already has this question (For the owner, from T13). From the look alone:
   an amber `▲ STCK` row in NEEDS YOU with that reason as its text matches every other view.
   `same tool call 14x in 6m` is the best reason text on the whole screen, and it is filed where
   nobody looks. The owner decides.
2. **`BASH` is a filled grey badge in light and an outlined one in dark.** It is the only filled
   badge in the light Inbox, so it reads heavier than the lane plate next to it. Fix: outlined
   in both themes, like the plates.
3. Still open and unchanged:
   - Phone RUN PRS is cut at `Paged search (agent lo…` behind `pr:` and `open ↗` (T16).
   - `Review · none` / `Paused · none` are still about 50 px rows with dividers (review 6 idea).
4. Phone RUN NEEDS: the plate, `open ↗` and `ACK` on the first line, then the decision text at
   full width below. It reads well now. Keep this shape and give the PR row the same one in T16.

## What looks right (keep)

- T13 did its job on the Board. `▲ STCK ci retry` is the same text, shape and amber on the
  card, the nested session, the NEEDS YOU row (1440) and the phone chip (390). The hourglass
  beside it stays grey. The NEEDS YOU order (`■ PERM`, `▲ PERM`, `▲ QUES`, `▲ STCK`) matches the
  card order.
- Red is spent on one thing only, `cleanup job` (its card, chip, row, plate and status-bar
  lamp), in both themes.
- The Inbox approval row: a 2 px accent ring with no fill, the countdown right-aligned in
  tabular figures.
- Phone plate row (`■ ALL ▲ BA ■ BB ■ BC`): shape and colour per builder, the selection
  outlined. This is the cleanest piece of the phone header.
