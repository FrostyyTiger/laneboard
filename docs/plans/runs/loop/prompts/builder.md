## ROLE: builder

Take the FIRST open task (`- [ ]`) in PROGRESS.md whose order makes sense now, and build it:
1. Read the code it touches and follow the patterns around it (modules, config fragments, tests).
2. Write the tests with the change. `npm test` must be green when you stop; run it yourself.
3. For a `[ui]` task, keep the design rules of README §5 and `docs/design.md` once it exists.
4. Mark the task `- [x] … (commit <sha>)` in PROGRESS.md, commit everything with a message that
   names the task id.
If the task turns out to be wrong or too big: split it in PROGRESS.md, do the first part. If it
cannot be done tonight: mark it `- [!] … blocked: <why>` and do the next one.
