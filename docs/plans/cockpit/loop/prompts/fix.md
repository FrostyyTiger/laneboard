## ROLE: fix

The tests are red after the last round (the tail is below). On a spec night that is almost always
the hygiene test finding a private name, host or address in a spec file: fix the spec file. You may
change only the paths in `loop/allowed.txt`; if the failure is elsewhere (a test that was already red
on the base branch), do not touch it: write it under `## For the owner` in PROGRESS.md.
Do not start new work. Commit with `fix: <what>`.
