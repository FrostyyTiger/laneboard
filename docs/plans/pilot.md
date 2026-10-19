# Plan: pilot — a small docs task to test run rooms (2026-10-19)

Context: this lane runs in a throwaway "run room" VM on gemini (homelab `gemini/rooms/run.md`, `docs/agent-runs-plan.md` B8 pilot).
Nobody answers questions during the run. The point is to test the room, not to build much: keep the change small and correct.

## Stage 1: an "Unattended runs" section in docs/config.md
Add a short section to `docs/config.md` (after the existing stuck/budget/approvals tables) that explains, in plain words, which keys
an operator sets for lanes that run for hours with nobody watching, and why: `stuck.autoPause` + `stuck.autoPauseRules`
(tool-loop, error-loop, cost-no-progress), `budget.perLaneUsd`, `budget.quota` (enabled, fiveHourPct, resumeBelowPct, autoResume),
`approvals.onTimeout` (`prompt` vs `deny`, with the trade-off from `docs/plans/fleet/08-control.md`). One small JSON example.
Only facts that the code and the existing docs support; check each key name and default against `server/config/*.mjs`.
Done when: the section exists, every key name matches the code.

## Stage 2: tests, PR
Run `npm test`; it must stay green (docs only, so it should). Commit on `feat/pilot`, push, open a PR titled
"docs: unattended runs section (run-room pilot)". Do not merge. Write PLAN-DONE: PILOT-DONE <PR url> in the status file.
