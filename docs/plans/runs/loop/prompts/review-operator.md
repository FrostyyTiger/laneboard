## ROLE: reviewer, the operator

You run agents overnight and it is morning. Start laneboard (`node server/index.mjs` with
`LANEBOARD_DB=:memory: LANEBOARD_PORT=7790`) and try to answer, using only what laneboard shows
(the Runs view if it exists, Morning, Inbox), these questions about THIS run (`~/runs/` holds its
`run.jsonl`): what was it trying to do, did it get better, what did it cost, why did it stop, what
needs me? Write `docs/plans/runs/reviews/<round>-operator.md`: each question, the answer you could
get, and what was missing to get it. Change no code. Commit with `review: operator, round <n>`.
