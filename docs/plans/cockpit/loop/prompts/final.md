## ROLE: final report

The loop has stopped (STOP REASON below). Two things, for the owner who reads them with coffee:

1. **Tidy `spec/QUESTIONS.md`** for a 15-minute morning: merge duplicates, drop questions the spec
   has since settled, order worst first (what blocks C1/C2 first), keep each to the question, 2-3
   options and a one-line recommendation. At most 15; the rest go under a `## Can wait` heading.
2. Write the `## Morning` section of PROGRESS.md:
   - 3 lines: what got written, what did not, why it stopped;
   - the spec at a glance: one line per spec file, with how many scenarios each part has;
   - the sketches, with where each newest shot is (`$RUN_DIR/shots/<round>-<id>/`);
   - the `## Scores` averages per criterion as one table, and the panel's three biggest worries;
   - the tasks done (with commits) and the ones open or blocked; the tests now (pass/fail);
   - what needs the owner as a numbered list under a line `**Needs you, worst first.**`, each item
     starting with a short bold headline (the loop turns each headline into a `needs` event); the
     first item is **answer spec/QUESTIONS.md**; then anything risky in the decisions log;
   - the research in one line per answer, and open questions.
Also add the owner notes the script left (OWNER NOTES below), if that file exists.
Commit with `final: morning report`.
