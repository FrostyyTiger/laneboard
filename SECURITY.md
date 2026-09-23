# Security

## laneboard has no authentication, by design

It can read every Claude Code session on the machine, type into their
terminals and start new ones. Anyone who can reach the port can do all of
that. There is no login, no session cookie and no permission model, and adding
a password field would only make it *look* safe.

So the server binds **`127.0.0.1` only** and everything else follows from
that:

- **Put something in front of it that authenticates.** A tailnet
  (`tailscale serve --https=8443`), a reverse proxy with client certificates,
  an SSO proxy — anything, as long as it decides who gets through.
  `docs/install.md` has two worked examples.
- **Never expose it on a port shared with people you would not hand a shell
  to.** A tailnet node that is shared with an outside collaborator is such a
  port.
- **Never bind it to `0.0.0.0`.** `bind` is a config key because a scratch
  instance sometimes needs a different loopback address, not because binding
  wider is a supported deployment.
- **One person per instance.** Two people who should not be able to type into
  each other's agents need two machines, not two browser tabs.

The terminals carry whatever the sessions carry — SSH keys, cloud
credentials, source. Treat reaching laneboard as equivalent to reaching a
shell on the machine, because it is.

## What it writes

Its own `data/` directory, `~/.cache/laneboard/status/`, and `~/lanes/<lane>/`.
Inside `launch` and `retire` only: worktrees under `codeDir`, and slots through
the configured slot provider. `deploy/install-claude.sh` makes two additive
changes to `~/.claude/` and backs the file up first.

Collectors never write anything and never `git fetch`.

## Reporting a vulnerability

Open a GitHub issue for anything that is already public, and use GitHub's
private vulnerability reporting for anything that is not.
