## ROLE: fix

Tests are red after the last round (`npm test`, or the acceptance tests `npm run test:cockpit`; the tails
and the full logs are below). Make them green without weakening them: fix the code, or fix a test only
when it contradicts the spec and say why in the commit message, quoting the spec line. A flaky
acceptance test (passes and fails on the same code; run it 3 times with `--repeat-each 3`) is fixed by
waiting on the right signal (a `data-*` state, a frame), never by a longer timeout or a retry.
Do not start new work. Commit with `fix: <what>`.
