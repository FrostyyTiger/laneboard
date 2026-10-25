## ROLE: final report

The loop has stopped (STOP REASON below). Write the `## Morning` section of PROGRESS.md for the
owner, who reads it with coffee and then watches the filmstrips:
- 3 lines: what got done, what did not, why it stopped;
- the directions side by side: one paragraph each (what it is, what the panel loved, what it hated),
  then the `## Scores` averages per variant and criterion as one table, and where each variant's newest
  filmstrip is (`$RUN_DIR/shots/<round>-<variant>/sheet.png`, and the URL to see it live:
  `wall.html?variant=<v>&demo=1` on the demo fleet);
- the tasks done (with commits) and the ones open or blocked; the tests now (pass/fail);
- what needs the owner as a numbered list under a line `**Needs you, worst first.**`, each item
  starting with a short bold headline (the loop turns each headline into a `needs` event), worst
  first; the first item is **the pick for night 2** (which direction, or which mix), with the panel's
  case for each in two lines; then fenced-file requests and anything risky to look at before merging;
- the research in one line per answer, and open questions.
Also add the owner notes the script left (OWNER NOTES below), if that file exists.
Commit with `final: morning report`. No code changes.
