# Q2: tying a Claude Code session to the loop round that started it

For T12. Read 2026-10-20.

## Answer

- Every hook payload carries `session_id`, `cwd` and `transcript_path` (documented). That gives the
  binding T12 planned: **cwd + time window**, with the session registry as the source. No env is
  in the payload.
- `claude --session-id <uuid>` is documented ("must be a valid UUID"). A loop that picks the UUID
  itself knows the session id up front and can write it into the round's events. This is the only
  *exact* binding, and it needs a change in the loop's `run.sh` (fenced), so it is an owner item,
  not a night-1 dependency.
- Env vars set by the loop (`LANEBOARD_RUN=<run>/<n>`) are inherited by hook processes ("Hook
  processes inherit the parent environment", except `OTEL_*`), so a hook command can read
  `$LANEBOARD_RUN` and add it to what it posts. That is documented for hooks and is the reliable
  route. Reading `/proc/<pid>/environ` is **not** a good route (below).
- No plain "current session id" env var for local sessions is documented. Only
  `CLAUDE_CODE_REMOTE_SESSION_ID` (cloud sessions) and `CLAUDE_CODE_BRIDGE_SESSION_ID` (Remote
  Control, `session_…` form) exist. Do not build on either.

## Details

### Hook payload (command hooks: JSON on stdin; HTTP hooks: POST body)

Common fields: `session_id`, `prompt_id` (UUID, absent until first input), `transcript_path`,
`cwd` ("current working directory when the hook is invoked", so it can differ from the project dir
after a `cd`), `scratchpad_dir` (v2.1.257+), `permission_mode`, `effort` (object with `level`),
`hook_event_name`. `agent_id` / `agent_type` identify a subagent or `--agent` session.
`SessionStart` adds `source` (`startup|resume|clear|compact|fork`), optional `model`, `agent_type`,
`session_title` (from `--name`). Fields are version-dependent: treat all but `session_id` and
`hook_event_name` as optional.

Hook env: `CLAUDE_PROJECT_DIR` (project root where the session started, fixed even in a worktree),
`CLAUDE_ENV_FILE` (SessionStart only: `export` lines appended there persist into later Bash tool
commands), `CLAUDE_EFFORT`. Also `CLAUDECODE=1` and `CLAUDE_CODE_CHILD_SESSION=1` in Bash tool and
hook commands (the second marks a nested session). `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` removes
*credentials* from subprocess environments; I did not find whether it touches custom variables
like `LANEBOARD_RUN` (the matching line was too long for me to read; unconfirmed, a builder should
test it if a loop sets it).

### `--session-id`, `--name`, resume

- `--session-id <uuid>`: "Use a specific session ID for the conversation (must be a valid UUID)".
- `--name` / `-n`: display name, appears as `session_title` in SessionStart. A loop could name
  sessions `runs-n1-r6`; weaker than a UUID (names are not unique) but readable in the registry.
- `--resume` / `--fork-session`: a fork gets a **new** session id, so a round that resumes would
  produce a second id; bind by the id the hook reports, not the first one seen.
- `claude -p` runs are left out of the picker, but still write transcripts at
  `~/.claude/projects/<project>/<session-id>.jsonl` (`<project>` = cwd with non-alphanumerics
  turned to `-`, capped at 200 chars + hash). The docs say the line format is internal and changes
  between versions: read only the file name, never parse it.
- `-p --output-format json|stream-json` returns `session_id` in the result (see Q1). A loop that
  already parses the result can write `session` onto its `round` end event after the fact: exact
  binding with no change to how claude is launched.

### `/proc/<pid>/environ`

`proc_pid_environ(5)`: holds the environment the process had at `execve`; it **does not reflect
later changes**; access needs ptrace access mode `PTRACE_MODE_READ_FSCREDS`; raw NUL-separated
data. So for a same-user process it usually works, but: it is Linux-only (no macOS), blocked under
`ptrace_scope`/yama or in containers with differing uids in some setups, and the process to read
is the `claude` process, which only has the env of whoever launched it. Claude Code's Bash tool
env changes (`CLAUDE_ENV_FILE`) are not visible there either. It is not documented by Claude Code
as a supported way to find a run. Verdict: not reliable, use only as a best-effort fallback and
never make a feature depend on it. (Not tested on this VM: no shell this round.)

## What laneboard could take (ranked)

1. **Default (night 1, T12 as written):** window + cwd match against the session registry; ties
   (two runs in one dir) are shown as "possibly" rather than guessed.
2. **Hook enrichment:** if the user's hook command posts `session_id` with `$LANEBOARD_RUN`, the
   bind is exact. Cheap to document in `docs/runs.md`; needs no laneboard code beyond accepting an
   optional `session` field on `round`/`artifact` events (T1's parser keeps unknown fields? the
   builder should check, and if not, add `session` as a known string field).
3. **Owner item:** `run.sh` could pass `--session-id "$(uuidgen)"` and write it on `round.start`
   (`"session": "<uuid>"`). Exact and independent of cwd.

## Not confirmed

- Whether a session-id env var exists for local Bash tool commands (none documented).
- Whether `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` strips non-credential custom variables.
- Whether SessionStart fires for `-p` runs without `--init-only`/hooks enabled in the loop's
  settings (the CLI reference lists `--init-only` and `--include-hook-events`; behaviour of plain
  `-p` not checked).

## Sources

- https://code.claude.com/docs/en/hooks (common input fields, hook env, SessionStart fields), 2026-10-20
- https://code.claude.com/docs/en/cli-reference (`--session-id`, `--name`, `--resume`, `--fork-session`, `--init-only`), 2026-10-20
- https://code.claude.com/docs/en/env-vars (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_REMOTE_SESSION_ID`, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`), 2026-10-20 (page read in part only)
- https://code.claude.com/docs/en/sessions (transcript path, `-p` sessions, fork ids), 2026-10-20
- https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html, 2026-10-20

No page tried to give me instructions.
