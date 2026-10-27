Draft PR from an unattended agent loop (`docs/plans/cockpit/loop-build/`), a **cockpit build night**:
one slice of `docs/plans/cockpit/spec/slices.md` §3, built against the stand-ins. One commit per task;
`docs/plans/cockpit/build/PROGRESS.md` has the task list, the scenario ids with a test, the persona reviews
with their scores and the morning report. Decisions the spec did not cover are in
`docs/plans/cockpit/build/DECISIONS-c1.md`; changes to fenced files are patches in
`docs/plans/cockpit/build/patches/`, not commits.

**Review-required before merge** (not fenced, but security-relevant; see `loop-build/fenced.txt`):
the redaction module, the room's start check, the agent's launch flags and allowlist, the MCP server's
loopback/token/Origin checks, the room link's upgrade checks, `server/config/cockpit.mjs`'s fatal lines
and the audit lines.

Acceptance tests: `npm run test:cockpit` (Playwright, not in `npm test`). The owner reviews and merges;
the loop never does.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
