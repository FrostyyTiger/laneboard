## ROLE: builder

Take the FIRST open task (`- [ ]`) in PROGRESS.md whose order makes sense now, and build it:
1. Read the code it touches and follow the patterns around it (modules, tests, tokens).
2. Write the tests with the change. `npm test` must be green when you stop; run it yourself.
3. For a `[ui]` or `[variant:…]` task, LOOK at it before you mark it done: start the demo fleet,
   shoot the still frames and make a filmstrip (common rules above), read `sheet.png`, `perf.json`
   and `console.txt`. A console or page error, overlapping or cut-off text, unreadable labels at the
   overview, trouble that is not the loudest thing, or fps under 27 under the throttle is a bug in
   your task: fix it and film again. A `[variant:…]` task always ends with a filmstrip in
   `$RUN_DIR/shots/<round>-<variant>/` (the panel reviews those). Stop the demo with
   `kill $(cat $RUN_DIR/demo.pid)`.
4. Mark the task `- [x] … (commit <sha>)` in PROGRESS.md, commit everything with a message that
   names the task id.
If the task turns out to be wrong or too big: split it in PROGRESS.md, do the first part. If it
cannot be done tonight: mark it `- [!] … blocked: <why>` and do the next one.
Craft matters here: this page is judged on how it looks and moves. Typeset (sizes on a scale,
consistent tracking, aligned baselines), time the motion (one camera, eased, no two things fighting
for the eye), and keep laneboard's colour rules: grey unless something needs you.
