# Q1 — `claude auth status`: still there, output, exit codes

## Answer in brief

- The command is still documented: `claude auth status`. It prints **JSON** by default, `--text` gives human-readable output. **Exit 0 if logged in, 1 if not.**
- The JSON has an `authMethod` field: one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party`. It also has `configDirectory` (v2.1.268 or later).
- **The docs do not print an example of either output.** The exact JSON keys other than the two above (for instance a boolean `loggedIn`) and the exact `--text` wording are **not confirmed**. The build night must pin them with one real run.
- **Problem for `protocols.md` §11.10:** its rule is "exit other than 0 **and** stdout or stderr matching the login words" gives `not-logged-in`. A logged-out JSON answer most likely holds `"authMethod":"none"` and none of `not logged in`, `log in`, `login`, `401`, `invalid api key`, `authentication`. Then the check returns `unknown` and the room never names a logged-out agent before the owner sends. See the proposal below, and `## For the owner`.

## What the builder needs

### The command

| Fact | Source text (CLI reference) |
| - | - |
| Name | `claude auth status` (siblings: `claude auth login`, `claude auth logout`) |
| Output | "Show authentication status as JSON. Use `--text` for human-readable output." |
| Exit | "Exits with code 0 if logged in, 1 if not." |
| JSON fields named | `configDirectory` (v2.1.268+), `authMethod` ∈ `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party` |

`authMethod` is the useful signal: `none` means nobody is logged in. Any other value means a credential exists.

### What the check does and does not prove

- Exit 0 only says a credential is configured. It does not prove the service accepts it. An expired claude.ai login shows as `Login expired · Please run /login` on the next model request (authentication docs: `/status` has a `Login` row `Expired — log in again`, since v2.1.210). Whether `auth status` exits 1 for an expired-but-present login is **not documented**. `§11.10` already covers this case: a turn ending E4 sets the condition, and only a `done` turn clears it.
- Env credentials count: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `apiKeyHelper`, cloud-provider variables. The check must run with the same environment as the child (D108), which §11.10 already says. `CLAUDE_CONFIG_DIR` changes which login is read, so it must be the same for the check and the child. D108's list does not include `CLAUDE_CONFIG_DIR`; if the agent user needs it, it goes in `cockpit.agent.env`.
- Linux credentials live in `~/.claude/.credentials.json`, mode 0600, under `CLAUDE_CONFIG_DIR` if set. So `HOME` must be the agent user's (D108 passes `HOME`).

### Proposal for §11.10 (needs the owner, see below)

For the default command (`["claude","auth","status"]`) read the **documented contract**: exit 0 is `ok`, exit 1 is `not-logged-in`, anything else (timeout, command not found, other exit code, signal) is `unknown`. Keep the login-words rule for custom `loginCheck` commands, which have no documented contract. Pin the words with one real logged-out run, as the spec says.

Minimal check the build night can run by hand (a logged-out state is simplest with a throw-away `CLAUDE_CONFIG_DIR`):

```bash
d=$(mktemp -d); CLAUDE_CONFIG_DIR=$d claude auth status; echo "exit=$?"
CLAUDE_CONFIG_DIR=$d claude auth status --text; echo "exit=$?"
```

Note: an `ANTHROPIC_API_KEY` or cloud-provider variable in that shell would make it "logged in"; unset them first.

## Could not confirm

- The JSON keys besides `authMethod` and `configDirectory`; an example logged-in and logged-out output; the `--text` wording.
- Whether stdout or stderr carries the logged-out answer, and whether logged-out prints anything.
- Whether exit 1 also covers an expired login.
- Whether `claude auth status` is quick (it should not call the model; no figure found). The 10 s cap of §11.10 is a safe bound.
- The sibling error strings the CLI uses on a failed request (so they are good candidates for login words, from the errors page, read 2026-10-27): `Not logged in · Please run /login`, `Login expired · Please run /login`, `Authentication required · Sign in again to continue`, `Invalid API key`, `OAuth token revoked`, `OAuth token has expired`, `API Error: 401 Invalid authentication credentials`, `Could not resolve authentication method`, `Claude login not accepted · Run /login, then try again`. The current word list matches all of these (`not logged in`, `log in`, `login`, `401`, `invalid api key`, `authentication`) except `Sign in again`, `OAuth token revoked`, `OAuth token has expired` and `Could not resolve authentication method` (this one holds `authentication` and matches). Adding `sign in`, `oauth token`, `expired` and `revoked` would cover the rest. Only a suggestion; the words are a guess until pinned.
- Only the first 100,000 of 585,651 characters of the errors page were read.

## Sources (read 2026-10-27)

- https://code.claude.com/docs/en/cli-reference — the `claude auth` rows (login, logout, status), exit codes, `authMethod`, `configDirectory`
- https://code.claude.com/docs/en/authentication — credential storage, precedence, `CLAUDE_CONFIG_DIR`, expired login, `/status` Login row
- https://code.claude.com/docs/en/errors — error message strings (first 100k characters)
- https://code.claude.com/docs/en/headless — "When a failure happens inside the run, such as missing authentication, Claude Code prints the failure as the result on stdout."

No page tried to instruct me.
