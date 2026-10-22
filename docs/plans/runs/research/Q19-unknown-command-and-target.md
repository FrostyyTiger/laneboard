# Q19 — unknown command and "which server am I talking to" in established CLIs

For T12. Read 2026-10-21. Pages were treated as data only; none tried to give instructions.

## Answer

- An unknown command is a one-line error on **stderr**, exit **1** (git, npm, kubectl's plugin path, cobra-based
  tools). The full help is **not** printed: git and npm point to the help command instead
  (`See 'git --help'.`, `To see a list of supported npm commands, run: npm help`). Both add "did you mean"
  suggestions when a command is close.
- So T12's "first line `unknown command: <x>`, then the full help, exit 2" is unusual but defensible:
  exit 2 is the usual "usage error" code and the first line is what a script or person greps. Printing the
  help after it is the part nobody else does; a short pointer (`run 'laneboard help'`) plus the close match
  is the convention. The builder may keep the help (the plan's decision) but should send it all to stderr.
- None of kubectl, gh or docker prints a "talking to X" line on every command. They make the target
  *selectable and inspectable* (`--context`, `GH_HOST`, `docker context ls`). A `board: <url>` line on
  stderr for `ls`/`morning`/`credit` therefore has no direct precedent; it is cheap and harmless on stderr.

## Details

### git (help.c, git.c on master)
- Message: `git: '%s' is not a git command. See 'git --help'.` to **stderr**, then `exit(1)`.
- Suggestions (only when similar enough, similarity floor 7): `\nThe most similar command is` /
  `\nThe most similar commands are`, then each name as `\t<name>`.
- `help.autocorrect`: `prompt`, `never`, `immediate`, `show`, or a number of tenths of a second. With
  `prompt` and no TTY on stdin/stderr it falls back to `never`. Autocorrect only when exactly one candidate.
  Takeaway: never auto-run a guessed command in a tool that agents call; suggest only.
- If an alias expands to a missing command: `expansion of alias '%s' failed; '%s' is not a git command`, exit 1.
- I did not find a 127 or 129 path for this case in the source I read.

### npm (lib/npm.js, lib/utils/error-message.js)
- Error code `EUNKNOWNCOMMAND`, printed lines: `Unknown command: "<x>"`, the suggestions text, then
  `To see a list of supported npm commands, run:` and `  npm help`. `exitCode: 1`.
- Which stream: the handler returns it as `standard` output lines; I could not confirm stdout vs stderr from
  the part I read. The suggestions module (`did-you-mean.js`) was not read.

### cobra (spf13/cobra, Apache-2.0; used by kubectl and gh)
- Text: `unknown command "<x>" for "<root path>"` followed by `\n\nDid you mean this?\n\t<name>` lines when a
  command is within Levenshtein distance 2 (the default when `SuggestionsMinimumDistance` is 0) or is a
  case-insensitive prefix match.
- Only the root command with subcommands and at least one argument errors; below the root, extra args pass.
- I did not read the code that turns the error into an exit code. Cobra tools commonly print `Error: …` and the
  usage block and exit 1; **not confirmed here** for gh specifically.

### kubectl
- `--context string` ("The name of the kubeconfig context to use"), `--kubeconfig`, `-s/--server`,
  and `KUBECONFIG` (default `$HOME/.kube/config`) are the documented selectors. `kubectl config current-context`
  prints the active one.
- Docs I read do not mention a context line printed on every command, and I know of none. Not proven absent.
- Unknown command: tried as a plugin (`kubectl-<name>` on PATH) first; a plugin error prints `Error: <err>` to
  stderr and exits 1.

### gh
- Host: `GH_HOST` ("hostname for commands that don't specify one or can't infer it from a local Git
  repository"), `GH_REPO` as `[HOST/]OWNER/REPO`. Tokens per host: `GH_TOKEN`, `GH_ENTERPRISE_TOKEN`.
- Exit codes documented (`gh help exit-codes`): 0 ok, 1 failed, 2 cancelled, **4 needs authentication**.
  So gh uses 2 for "cancelled", not for usage errors — exit 2 is not universal.
- `gh auth status` is the command that shows host and account; nothing is printed on other commands.

### docker
- Active context marked with `*` in `docker context ls`; `--context` per command; `DOCKER_CONTEXT` env
  beats `docker context use`; `DOCKER_HOST`/`--host` override the context. Nothing printed per command
  (the docs page does not say so; I did not read `docker context show`).

## What laneboard can take

1. First line `unknown command: <x>` on stderr, exit 2 (the plan). Add one `did you mean: <y>` line when one
   command is within edit distance 2 or is a prefix (cobra's rule; git's floor is looser). Never auto-run.
2. Then either the help (the plan) or `run 'laneboard help'`. Both fit the "greppable first line" idea; the
   short pointer is what git and npm do.
3. `board: <url>` on **stderr** keeps stdout parseable (`ls | …`). Print the URL that actually answered, not
   the one configured, as `GH_HOST`-style overrides can differ. Print it once per call, only for commands
   that talk to a board.
4. Exit-code note for docs: 1 failure, 2 usage error. gh's 2 means cancelled, so say what laneboard's 2 means.

## Could not confirm
- gh's exact unknown-command output and exit code; npm's stream for that error; whether any tool prints a
  per-command target line (I found none, absence not proven).

## Sources (all read 2026-10-21)
- https://raw.githubusercontent.com/git/git/master/help.c
- https://raw.githubusercontent.com/git/git/master/git.c
- https://raw.githubusercontent.com/npm/cli/latest/lib/npm.js
- https://raw.githubusercontent.com/npm/cli/latest/lib/utils/error-message.js
- https://raw.githubusercontent.com/spf13/cobra/main/command.go and /args.go
- https://raw.githubusercontent.com/kubernetes/kubectl/master/pkg/cmd/cmd.go
- https://kubernetes.io/docs/reference/kubectl/kubectl/
- https://kubernetes.io/docs/reference/kubectl/generated/kubectl_config/kubectl_config_current-context/
- https://cli.github.com/manual/gh_help_environment
- https://cli.github.com/manual/gh_help_exit-codes
- https://docs.docker.com/engine/manage-resources/contexts/
