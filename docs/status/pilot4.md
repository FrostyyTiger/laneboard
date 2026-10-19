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
- The plan asks for "PLAN-DONE: PILOT-DONE <PR url>". The repo's hygiene
  gate (`test/hygiene.test.mjs`) refuses the repo owner's name in any tracked
  file, so the full URL cannot be committed. The status file writes `#9`; the
  URL is in the PR itself and in the lane's final output.
- No DB is used by this repo (SQLite in memory for tests); slot 3 untouched.

## Stage 2: tests, PR — done

- Tests: targeted runs only (see Stage 1 and Executor's calls), all passing.
  The full `npm test` runs in CI on the PR.
- Branch `feat/pilot` pushed. Draft PR #9 opened against `main`
  ("docs: unattended runs section (run-room pilot)"). Not merged.
- History: the first attempt was blocked because the system `gh` was not
  logged in. The operator fixed this, and the PR was opened with the
  token-wrapper `gh`.
- CI (`test`, `npm test`) on PR #9, first run, 2 failures:
  - `test/hygiene.test.mjs`: this status file named the repo owner and a
    person (the PR URL, an earlier line). Fixed: the PR is referred to as
    `#9` (see Executor's calls).
  - `test/frontend.test.mjs` "the split is byte-identical to styles.css…":
    this test runs `git show <commit>^:public/styles.css` and needs full
    history, but the workflow's checkout is shallow. This branch does not
    touch CSS, and main's last CI run is red as well. Not fixed here: it is
    outside a docs-only plan.
- CI, second run (98a49a2): the hygiene gate passes; the only failure left
  is the shallow-checkout CSS test above.

PLAN-DONE: PILOT-DONE #9
