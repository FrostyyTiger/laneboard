# Hygiene

This repo is public. Two checks keep private things out of it.

| Check | Where | Fails on |
| --- | --- | --- |
| The hygiene test | `test/hygiene.test.mjs`, part of `npm test` | a tracked file with a private or tailnet address, a tailnet name, a real home directory, or one of the names the extraction removed |
| Commit addresses | `.github/workflows/authors.yml`, on every pull request | a commit in the PR whose author or committer address is not a GitHub noreply address (`<id>+<login>@users.noreply.github.com`, or `noreply@github.com` for GitHub's own merges) |

## When the address check fails

Set the noreply address, then rewrite the PR's commits:

```bash
git config user.email '<id>+<login>@users.noreply.github.com'
git rebase -r --exec 'git commit --amend --no-edit --reset-author' origin/main
git push --force-with-lease
```

Your noreply address is on GitHub under Settings, Emails. Any machine that
commits here (a run room, a builder) needs it in its git config.
