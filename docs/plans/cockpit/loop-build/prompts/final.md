## ROLE: final report

The loop has stopped (STOP REASON below). Write the `## Morning` section of
`docs/plans/cockpit/build/PROGRESS.md` for the owner, who reads it with coffee and then tries the pane:
- 3 lines: what got done, what did not, why it stopped;
- the slice's done-when (slices.md §3, README §9), item by item: met, not met, or waiting (and on what);
- the scenario ids: how many have a passing test, which are skipped and what each waits for (the Wall,
  C2, a fenced patch), which have no test yet; the last `npm run test:cockpit` summary line and `npm test`
  pass/fail (run both now);
- the builds of the slice done and open, with the tasks and commits; where the next night starts (the
  first open build), so README §9's next night can begin there;
- how to try it: the command for the demo (`node test/tools/demo-fleet.mjs --cockpit` or what exists)
  and what to type;
- the decisions the night made (`build/DECISIONS-c1.md`), one line each, the ones the owner is most
  likely to overrule first;
- what needs the owner as a numbered list under a line `**Needs you, worst first.**`, each item starting
  with a short bold headline (the loop turns each headline into a `needs` event): the fenced patches in
  `build/patches/` to review and apply, the review-required modules (fenced.txt's last block) with their
  files, spec contradictions found, questions the spec left open;
- the panel's scores averaged per area and criterion as one table; the research in one line per answer.
Also add the owner notes the script left (OWNER NOTES below), if that file exists.
Commit with `final: morning report`. No code changes.
