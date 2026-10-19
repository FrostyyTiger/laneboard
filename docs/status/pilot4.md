# Status: pilot (lane pilot4)

Plan: [docs/plans/pilot.md](../plans/pilot.md). Branch `feat/pilot`.

## Stage 1: "Unattended runs" section in docs/config.md — done

- New section `### Unattended runs — what to set when nobody is watching` in
  `docs/config.md`, after the `stuck` table and before `health`.
- Key names and defaults checked against `server/config/control.mjs`
  (`approvals`, `budget`, `budget.quota`, `ON_TIMEOUT`) and
  `server/config/observability.mjs` (`stuck.autoPause`, `stuck.autoPauseRules`,
  `STUCK_RULES`). The `onTimeout` trade-off is taken from
  `docs/plans/fleet/08-control.md` §2.2; pause semantics from
  `docs/fleet/control.md` and `server/flags/stuck.mjs` (auto-pause writes an
  `operator` sentinel).
- The JSON example was loaded through `server/config.mjs` `build()` and
  validates (merged values as written).
- Targeted tests green: `test/config-docs`, `config-control`,
  `config-observability`, `config` (52 pass, 0 fail).

## Executor's calls

- The plan says "Run `npm test`" (Stage 2), but the run instructions say never
  run the full suite on this box. Conservative reading: run only targeted
  tests locally (config tests; the change is docs only) and let CI run
  `npm test` on the PR.
- The plan's context mentions a run room on gemini; this run is on builder.
  Nothing in the task depends on it.
- No DB is used by this repo (SQLite in memory for tests); slot 3 untouched.
