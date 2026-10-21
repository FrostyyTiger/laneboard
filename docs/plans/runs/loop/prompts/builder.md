## ROLE: builder

Take the FIRST open task (`- [ ]`) in PROGRESS.md whose order makes sense now, and build it:
1. Read the code it touches and follow the patterns around it (modules, config fragments, tests).
2. Write the tests with the change. `npm test` must be green when you stop; run it yourself.
3. For a `[ui]` task, keep the design rules of README §5 and `docs/design.md` once it exists, and
   LOOK at it before you mark it done (this VM has a headless Chromium now):
   `node test/tools/demo-fleet.mjs --port 7795 > /tmp/demo.log 2>&1 &` (wait until it answers),
   `node docs/plans/runs/loop/shoot.mjs --url http://127.0.0.1:7795 --out $RUN_DIR/shots/<round>-<task>
   --views <the views you touched> --themes dark,light --widths 1440,390`, then read the PNGs and
   `console.txt`. A console or page error, a red UI ERROR banner, overlapping or cut-off text, or a
   theme that looks wrong is a bug in your task: fix it and shoot again. Stop the demo when done
   (`kill %1`). Screenshots stay in `$RUN_DIR/shots/`, never in the repo.
4. Mark the task `- [x] … (commit <sha>)` in PROGRESS.md, commit everything with a message that
   names the task id.
If the task turns out to be wrong or too big: split it in PROGRESS.md, do the first part. If it
cannot be done tonight: mark it `- [!] … blocked: <why>` and do the next one.
