# Review: designer, round 13 (runs-n5)

What I looked at: every shot taken since review 6, which covers what T4 and T5 changed.
- `shots/10-T4/` and `shots/10-T4b/`: the run page, stopped `acme-search` (round titles, stop
  detail, wrap-up).
- `shots/r11-T5/` and `shots/r11-T5b/`: Map and Runs list with `3 of 10`.
- `shots/r11-T5-page/` and `shots/r11-T5b-page/`: the run page, running `acme-docs` with a moved
  scope.

Each set has dark and light, at 1440 and 390. Board and Inbox have not changed since
`r6-designer/` and `r4-T2/`, so review 6 still covers them and I took no new shots. I compared
against README §5 and the Night direction (§8 Q6). Only one direction is in use, so I have no
directions to compare. The counts in the header tiles move between shots because of the demo
clock, not a bug. Within each section, the worst problem comes first.

## Console

- `shots/10-T4/console.txt`: empty (0 lines).
- `shots/10-T4b/console.txt`: empty (0 lines).
- `shots/r11-T5/console.txt`: empty (0 lines).
- `shots/r11-T5b/console.txt`: empty (0 lines).
- `shots/r11-T5-page/console.txt`: empty (0 lines).
- `shots/r11-T5b-page/console.txt`: empty (0 lines).

## Across the new work (fix once)

1. **`x of y` means two different things.** The Map labels read `ACME-SEARCH 7 of 10` (rounds,
   because that run has no tasks max), `ACME-DOCS 3 of 10` (tasks) and `ACME-BILLING 1 of 6`
   (tasks). The same form counts rounds on one node and tasks on the next, and nothing tells
   them apart. The Runs list and the run page print rounds as `7 / 10` and tasks as
   `tasks 3 of 10`, so each view uses a different pair of forms. Fix: always put the noun in
   front, `tasks 3 of 10` or `round 7 of 10`. On the Map, print `round 7 of 10` when the ring
   counts rounds. Use `of` everywhere, the slash nowhere (this settles review 6 Across 5).
2. **The scores block contradicts the stat line.** The run page header says `tasks 3 of 10`,
   but the SCORES block below still says `tasks 3 ↑ 0–3`, a range from the values seen rather
   than the max. A reader sees "out of 10" and "out of 3" on one screen. Fix: when a score has a
   max, the block's value column reads `3 of 10`. Draw the spark against 0..max so the line ends
   where the ring ends. Keep the min–max range only for scores with no max (`tests 0.84–0.94`).
3. **The `↑` trend arrow comes in two sizes.** In the stat lines (Runs list, run page header) it
   is a small raised glyph glued to the number (`10↑`, `0.94↑`), so `10↑` reads like an exponent.
   In the SCORES block it is a full-size `↑` with a space. Fix: one glyph, the same size as the
   number, `--sp-1` before it, in `--text-2`. When both a max and a trend show, put the trend
   after the whole phrase: `tasks 3 of 10 ↑`.

## Run page (`r11-T5b-page`, `10-T4b`)

1. **Two layouts for the head.** The running run (`acme-docs`) shows `● RUNNING` and then the goal
   as the line's title. The stopped run (`acme-search`, 10-T4b at 1440) puts the state and stop
   reason on the left and pushes the goal to the far right, cut at `…the web …` with about
   350 px of free space beside it. At 390 the stopped run puts the goal after a three-line stop
   block. The goal is the page's title and should always lead. Fix: one head for every state:
   - the goal, uncut, at `--fs-16` `--text-1`;
   - then the state line (`○ STOPPED · budget · after 7 rounds`), with the detail under it in
     `--text-2`;
   - then `acme-search · run/search` in muted text.

   This is review 6 run page 3, still open and now worse because the stop detail adds a line.
2. **T5b's two-line stat cell opens a hole.** `tasks 3 of 10` with `scope 8 → 10` under it makes
   the stat line two lines tall. The `5h` group then floats about 140 px to the right (from x
   ≈ 600 to ≈ 745), and its tracks sit on the lower line while `round 4 / 8` sits on the
   middle. In T5 (r11-T5-page) the scope sat inline and the line read well. Fix: keep it on one
   line, `tasks 3 of 10 ↑ · scope 8 → 10` (scope in `--text-3`), each group `--sp-4` apart.
   If it must wrap, top-align the whole line.
3. **The wrap-up row says "wrap-up" twice.** The ROUND cell reads `wrap-up` and the TASK cell
   ends in a muted `wrap-up` where the task id goes. Fix: keep `wrap-up` in the ROUND column only
   and leave the task id empty. Also print the ROUND cell in `--text-2` and not right-aligned:
   right-aligned, it overhangs the numbers' column to the left.
4. **The outcome column prints a raw slug**, `no-task-done`, next to plain words (`kept`,
   `reviewed`, `reported`, `running`). Fix: print words, `no task done`. If the slug is the
   protocol value, map it to text in the view.
5. **The session link from T4 cannot be seen.** None of the rounds in 10-T4b at 1440 has any
   link styling: no underline, no ↗, no accent. Either the demo rounds carry no `session`, or
   the link looks exactly like plain text. Fix: if it is a link, mark it the way the artifact
   title is marked (underline), or with a ↗ after the role. The shooter should give at least
   one demo round a known session so the next shot shows it.
6. **The phone rounds table drops TASK and DURATION.** At 390 (10-T4b, r11-T5b-page) the table
   shows only ROUND, ROLE, OUTCOME, COMMIT and COST. The round title, T4's main addition, does
   not appear on a phone at all. Fix: at 390, turn each round into two lines: `3 builder kept
   c3e4a5b $3.68`, with the title and task id under it in `--text-2`. Drop COMMIT before TASK.
7. **The sparkline stops short and is too tall.** One score with two points draws a 720 px line
   that ends about 330 px before the value column, 45 px tall (1440). At 390 it takes a 70 px
   band under the label. Fix (review 6 run page 5, still open): use a fixed-width spark area
   that ends a set gap before the right-aligned values, 24 px tall, and keep the label, spark
   and value on one line at 390.
8. **The rounds table still fills 1360 px.** With short tasks (`T1`, `T2`, r11-T5b-page),
   ROLE→TASK is 240 px and COMMIT→COST 400 px. Fix: content-sized columns. This is in Later as
   r10 idea 5, and nothing changed.
9. The 390 shots still end above the artifacts and the wrap-up row, so neither has been seen on
   a phone. T16 already plans a scrolled check; include the rounds table end in it.

## Runs list (`r11-T5b/runs-*`)

1. **The stat column mixes forms.** One run reads `tasks 3 ↑ tests 0.94 ↑` (no max), the next
   `tasks 1 of 6 ↑`, the next `tasks 3 of 10 ↑` with `scope 8 → 10` under it. Only the third row
   becomes two lines in that cell, so its baseline drops against `4 / 8` and the quota tracks.
   Fix: the one-line form from run page 2, and Across 1 for the noun.
2. **The slash does not line up**: `7 / 10` and `4 / 10` against `4 / 8` (the second number is
   one digit shorter, so the whole group shifts right by one character). It is still open from
   review 6. Fix: `round 4 of 8` left-aligned (Across 1), or tabular right-aligned on the total.
3. **The goal is cut at about 45 characters** (`…tes…`, `…test…`, `…exa…`), while the empty
   quota cells (`5h ▭ — 7d ▭ —`) take 300 px. At 390 the goal is cut at about 20 characters
   (`Add paged search to acme-a…`), while the right column holds only `7 / 10`. This is open from
   review 6 and in Later (r10 idea 4). It is the worst thing in this view, and this night's
   tasks have made the row wider without giving the goal any room.
4. The amber hourglass after `● RUNNING` on `acme-billing` is still there (Later n3 T50).
5. On the phone, the stat lines have uneven gaps: tasks→5h is 47 px, but tasks→scope is 36 px.
   Fix: one `--row-dense` step between all stat lines.

## Map (`r11-T5/map-*`)

1. **CI-RETRY has a label on the phone but not on the desktop.** At 390 the amber ▲ at 846,828
   is labelled `CI-RETRY`. At 1440 the same node (1625,445) has no label, and it is the only
   trouble node on the screen without one. A trouble node is always labelled (Later n3 T48).
2. **Phone run labels sit on the wrong nodes:**
   - `ACME-DOCS 3 of 10` is printed over the VM-A node, about 160 px left of its own ring.
   - `ACME-BILLING 1 of 6` crosses a node at 628,1120, 300 px from its ring.
   - `ACME-SEARCH 7 of 10` sits at the left edge, away from its ring.

   With three rings and three labels, a reader cannot pair them. This is review 6 Map 3, now
   with the numbers added. Fix (n3 T48 rest): put each label next to its own ring. When it
   would cross a node, drop the label and keep the ring.
3. **The trouble halos differ between shots.** Desktop dark shows amber halos around
   FEAT-SEARCH and FIX-LOGIN, desktop light shows none, phone dark none, and phone light shows a
   large pale one (about 100 px across). It is most likely a pulse caught at a different frame
   in each shot. Fix: either the halo is part of the steady look (then the same in every theme)
   or it is motion only. In both cases `shoot.mjs` should freeze animations
   (`prefers-reduced-motion` or `animation: none`) so the screenshots compare like with like.
4. **Run labels mix two type styles**: condensed caps for the name and lowercase mono for
   `3 of 10`, with a wide gap between them. They read as two labels. Fix: one style, the number
   in the same condensed caps at `--text-2` (`ACME-DOCS · 3 OF 10`), or the number under the
   name.
5. These are still open from review 6:
   - the `+2` badge overlaps FEAT-SEARCH's ring (T18);
   - BUILDER-A's lane dots include the violet accent;
   - the phone map leaves about 200 px empty above and 300 px below the drawing (review 6 Map 4).
6. The tasks rings read correctly: about 108° for 3 of 10 and 60° for 1 of 6. The arc and
   the label agree. Keep.

## What looks right (keep)

- Both themes on the run page: grey throughout, with the open `decision` need as the only amber
  thing on the page (10-T4b).
- The acked `fence` row is now visibly quieter than the open need, as asked in review 6.
- Unknown round cost prints `—`, not `$0.00`, in the running round of both run pages.
- The muted task id beside the round title (`Paged search endpoint with a cursor T1`) is the
  right weight: the title leads and the id is there for reference.
- `scope 8 → 10` in `--text-3` is the right loudness for "the target moved". Only where it sits
  is wrong (run page 2).
