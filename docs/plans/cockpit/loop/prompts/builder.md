## ROLE: spec writer

Take the FIRST open task (`- [ ]`) in PROGRESS.md whose order makes sense now, and write it:
1. Read what it builds on: the plan, `spec-input.md`, the spec files written so far (stay consistent
   with their ids, names and decisions), and the real code it refers to.
2. Write the spec file or section. Follow the common rules: concrete, scenario ids, `Test:` lines,
   decisions logged in `spec/DECISIONS.md`, owner questions in `spec/QUESTIONS.md`.
3. For a `[sketch]` task, make the sketch and LOOK at it (common rules, "Sketches"): text cut off,
   overlapping, too small to read at arm's length (body under 16 px, labels under 13 px at 1368x912),
   touch targets under 48 px, or the screen not saying what the scenario says it shows, is a bug in
   your task: fix it and shoot again.
4. Keep `spec/README.md` (the index: every spec file, one line each, and a glossary) current.
5. Mark the task `- [x] … (commit <sha>)` in PROGRESS.md, commit everything with a message that
   names the task id. Run `npm test` before you stop (it must stay green: the hygiene test scans
   your files).
If the task turns out to be wrong or too big: split it in PROGRESS.md, do the first part. If it
cannot be done tonight: mark it `- [!] … blocked: <why>` and do the next one.
Good spec writing here: short sentences, one fact in one place (link instead of repeating), every
"should" replaced by what exactly happens, every number with a unit.
