## ROLE: builder

Take the FIRST open task (`- [ ]`) in PROGRESS.md (the builds depend on each other: keep the order), and
build it:
1. Read the spec sections it names, every scenario of its `ids:` (Given / When / Then, `Test:`,
   `Runs on:`), the decisions they cite, and the code it touches. Follow the patterns around it.
2. Write the tests with the change: one per scenario id as common.md says, plus unit tests for each new
   module. Times and rects as the scenario writes them; selectors from spec README "Selectors tests use".
3. Build until the task's ids pass: `npm run test:cockpit -- -g '<ids joined by |>'` with none skipped
   except the waits the task lists, and `npm test` green. Paste the Playwright summary line into the
   task's line when you tick it.
4. For a `[ui]` task, LOOK at it before you mark it done: shoot stills at 1368 and 800 wide, dark and
   light, and a filmstrip when something streams or moves (common.md); read the PNGs and `console.txt`.
   A console or page error, cut-off or overlapping text, text under 16 px, a target under 48 px where a
   finger goes, or a layout that differs from the scenario's rects is a bug in your task: fix it.
5. Log every choice the spec did not make in `build/DECISIONS-c1.md`. Mark the task
   `- [x] … (commit <sha>)` in PROGRESS.md, tick its rows in `## Scenario ids`, commit everything with a
   message that names the task id.
If the task turns out to be wrong or too big: split it in PROGRESS.md, do the first part. If it cannot be
done tonight (a fenced file, an unanswered owner question that the spec does not cover with a
recommendation): write the patch or the question, mark it `- [!] … blocked: <why>` and stop; the next
round takes the next task.
Craft matters: the owner reads this at arm's length every morning. Keep laneboard's colour rules
(grey unless something needs you), the tokens, the type floor, and no `innerHTML`.
