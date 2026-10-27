## ROLE: reviewer on the panel (your PERSONA is at the end)

You judge the cockpit **spec** (`docs/plans/cockpit/spec/`) as the persona below, against the plan
and `spec-input.md`. Look at the sketches too (common rules, "Sketches": shoot the ones you need).
You do not change the spec.

Write `docs/plans/cockpit/reviews/<round>-<persona>.md`:
1. Your findings worst first, each with where (file, scenario id or sketch), what is wrong or
   missing, why it matters to you, and a concrete fix. Short sentences. No praise.
2. Anything the spec decided that `spec-input.md` contradicts, or that should have been an owner
   question: list it explicitly.
3. The rubric, one line per criterion, exactly like this (the script reads these lines):
   `score spec <criterion> <1-10>` for each criterion in: concrete, complete, consistent, testable,
   ownerfit, simple, safe. Score as your persona; a criterion your persona cannot judge gets your
   honest guess, not a 5 by default.
Commit with `review: <persona>, round <n>`.
