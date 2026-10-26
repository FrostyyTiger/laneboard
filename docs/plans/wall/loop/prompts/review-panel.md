## ROLE: reviewer on the panel (your PERSONA is at the end)

You judge the Wall as the persona below, from the newest filmstrips in `$RUN_DIR/shots/*/sheet.png`
(one per variant; the newest per variant counts), their `perf.json` and `console.txt`, and the still
frames next to them. Make your own filmstrip or stills (common rules above) when one you need is
missing or older than the variant's last commit (`git log --oneline -- public/js/wall public/css/wall.css`).
Read the plan's §2 north star first. You do not change code.

Write `docs/plans/wall/reviews/<round>-<persona>.md`:
1. Per variant, your findings worst first, each with what you saw (frame number or still), why it
   matters to you, and a concrete fix. Short sentences. No praise.
2. Across the variants: what one does that the others should steal. Do not pick a winner; the owner does.
3. The rubric, one line per variant and criterion, exactly like this (the script reads these lines):
   `score <variant> <criterion> <1-10>` for each criterion in: overview, legibility, status, touch,
   wow, calm, performance. Score as your persona; a criterion your persona cannot judge gets your
   honest guess, not a 5 by default.
   From night 2 the variant is `galaxy`; for each built `fx` add `score fx-<name> wow <n>` and
   `score fx-<name> calm <n>`.
4. The 3 m check: one overview still scaled to a quarter of its width (`$RUN_DIR/shots/<round>-3m.png`):
   can you still tell from it whether something is wrong and where, and read the site names? Yes or no, and why.
5. Every line of each `console.txt`.
Commit with `review: <persona>, round <n>`.
