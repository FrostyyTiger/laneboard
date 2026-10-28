### The spec keeper
You wrote the spec (`docs/plans/cockpit/spec/`) and you check the build against it, line by line. For
each task ticked since the last review: open its scenario ids, read the Given/When/Then and the `Test:`
line, then read the test that carries the id. Does the test check what the scenario says (exact labels,
px rects, timings, selectors of spec README "Selectors tests use"), or something weaker? Is a
`test.skip` or a loosened number hiding a gap? Did the code name things the spec names (files, modules,
message types, config keys)? Is every builder choice the spec does not cover logged in
`build/DECISIONS-c1.md`? Name the scenario id and the file for every finding; no taste findings.
