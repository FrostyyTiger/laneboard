# Packages

The **Packages** view (`#/packages`, `g p`) answers, per package of every repo
you work on: is main green for it, which lanes are changing it, whose PR broke
it, and which open branches are about to conflict. Everything on it is
**display-only**: laneboard never merges, pushes, deletes a branch, retires a
lane or writes to a forge because of anything shown here.

This page is for operators: how to configure it, how laneboard decides what it
shows, and where it can be wrong.

## What a package is

A package is a named set of path globs inside one repo, for example
`{name: "web", paths: ["web/**"]}`. A file may belong to more than one package
(overlaps are allowed). Files no package covers are collected under a
synthetic `_other` row, which lists them in its inspector; `_other` appears
only when some open branch touches such a file.

Packages come from your config (`repos[].packages`) or, when a repo configures
none, from auto-detection at the main ref.

## Where collection runs

Every builder collects for the repos it has checked out: CI per job on main
(through `gh`, with the credentials the builder already has), and git data
(branches, touched files, conflicts, plans) from its own checkout. The hub
holds no forge token and no git checkout; it only **merges** what builders
report. A standalone builder runs the same merge over its own data, so the
view looks the same in both modes.

Builder reports are untrusted on the hub: every value is tagged with the
builder it came from (`via`), and two builders reporting the same run
(`slug`, run id, attempt) are deduped by the newer `updatedAt`. If they report
different conclusions at the same `updatedAt`, the run is marked `disputed`
and both reports are shown.

## Configuration

### `repos[]` entries

Each entry needs only `name`; everything else is optional.

```json
{
  "repos": [
    {
      "name": "acme",
      "path": "~/code/acme",
      "ci": { "provider": "gh", "repo": "acme/acme", "collect": true },
      "packages": [
        { "name": "web",       "paths": ["web/**", "!web/docs/**"] },
        { "name": "web-admin", "paths": ["web-admin/**"], "jobs": ["admin-e2e"] },
        { "name": "desktop",   "paths": ["desktop/**"], "workflow": "desktop.yml",
          "plans": ["docs/plans/desktop-*.md"] }
      ],
      "global": ["secret-scan"],
      "ignoreJobs": ["ci.yml#publish-docs"]
    }
  ]
}
```

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | required | The repo's name in laneboard. |
| `path` | `<codeDir>/<name>` | The checkout. A leading `~/` is expanded; a relative path is resolved against `codeDir`. |
| `ci` | none | `{provider, repo?, collect?}` or `null`. `provider` is `"gh"` (the default when the block is given) or `"none"`. `repo` is an `owner/name` slug; without it the slug is read from the checkout's `origin` remote (`git@github.com:o/n.git`, `https://github.com/o/n(.git)`, `ssh://git@github.com/o/n`). `collect: false` turns CI collection off on this builder only (useful when two builders share a repo). `null` or `provider: "none"` means no CI: rows show `unknown`. |
| `packages` | none (auto-detect) | `[{name, paths, jobs?, workflow?, plans?}]`. `name` is unique per repo. `paths` is a non-empty list of globs. `jobs` lists job names that gate this package (see mapping, rule 1). `workflow` scopes those `jobs` to one workflow file (`ci.yml`). `plans` lists globs of the plan files that belong to the package. An empty list counts as "none configured" and auto-detection runs. |
| `global` | `[]` | Job names that gate every package (a secret scan, a full build). |
| `ignoreJobs` | `[]` | Job names that are not tests (deploys, publishing); they are dropped from the map entirely. |

A job reference in `jobs`, `global` or `ignoreJobs` is a job name, a job id,
the base name of a matrix job (`test` for `test (ubuntu, 20)`), or any of
those prefixed with a workflow file: `ci.yml#test`.

**Legacy single repo.** An older config with `ci: {provider: "gh", repo:
"<dir>"}` and no `repos[].ci` anywhere still works: that `ci.repo` is a
*directory name* under `codeDir`, and it gets a `gh` block whose slug comes
from its `origin` remote. If the directory is not in `repos[]` it is added as
an entry of its own. A repo whose slug cannot be resolved gets no CI and its
rows show `unknown`.

### `packages` (collection knobs)

| Key | Default | Meaning |
| --- | --- | --- |
| `autodetect` | `true` | Detect packages when a repo configures none. With `false`, such a repo has no package rows. |
| `mainRef` | `"origin/main"` | The ref everything is compared against. Must be a plain git ref name. |
| `branchWindowDays` | `14` | Remote branches with no commit newer than this are not considered. |
| `maxBranches` | `40` | Per repo, newest first (1 to 500). Caps the pairwise conflict pass. |
| `fetch` | `"none"` | `"none"`: use refs as they are, never fetch. `"mirror"`: keep a bare mirror under `cacheDir` and fetch it (see below). |
| `fetchEverySec` | `300` | Mirror fetch interval (at least 30). |
| `cacheDir` | `$XDG_CACHE_HOME/laneboard/git`, else `~/.cache/laneboard/git` | Holds `mirrors/<repo>.git` and `scratch-objects/<repo>`. Must be absolute or start with `~/`. |
| `ciEverySec` | `120` | CI poll interval per repo (at least 30). |
| `staleDays` | `7` | A branch with no commit for longer is stale. |
| `staleBehind` | `50` | A branch more commits behind main than this is stale. |

Git data is refreshed on the lane poll interval (`lanePollMs`; the first pass
runs 50 s after start), and whenever main moves.

### `plans`

| Key | Default |
| --- | --- |
| `globs` | `["docs/plans/**/*.md"]` |
| `statusLine` | ``^\*\*Plan status:\*\*\s*`?([A-Z][A-Z-]+)`` (in JSON, double each backslash) |
| `states` | `open: OPEN, READY, PROPOSAL, IN-PROGRESS` · `partial: PARTIAL` · `done: DONE, SUPERSEDED, DECIDED` · `deferred: DEFERRED` |

`statusLine` must compile and have a capture group: the first group is the
state word. Config validation refuses a bad glob, a bad slug, a status line
without a group, or an unknown `fetch` mode, with a message naming the key.

## Auto-detection

Used only when a repo has no `packages`. It reads the main ref (`git ls-tree`
plus a handful of `git show` calls), never the working tree, and is cached per
main sha. Rules, in order, deduped by path:

1. Root `package.json` `workspaces` (a list, or `{packages: [...]}`): each
   entry is expanded against the tree's directories (`apps/*` gives one
   package per dir). Kind `npm`.
2. Root `pyproject.toml`: `[tool.setuptools.packages.find]` `include`/`where`
   (a pattern like `core*` becomes the top-level dir `core` if it exists),
   `[tool.setuptools] packages`, and `[tool.poetry] packages`. Kind `python`.
3. Root `Cargo.toml` `[workspace] members` (minus `exclude`). Kind `cargo`.
4. A top-level directory with its own `package.json`, `pyproject.toml` or
   `Cargo.toml` is one package named after the directory. A sub-directory
   Cargo workspace lists its members as `parts` (information only).
5. A top-level directory with its own `CLAUDE.md` not covered above. Kind
   `claude`.

Each package's paths are `<dir>/**`. Hidden directories and `node_modules`,
`target`, `dist`, `build`, `vendor`, `__pycache__` are skipped. Two packages
with the same name get the parent directory appended (`app-desktop`).
Manifests over 1 MB, or that do not parse, are ignored.

If detection guesses wrong, configure `packages` for that repo; configured
packages replace detection entirely.

## Job to package mapping

Workflows are read from `.github/workflows/` at the main ref with a small
indentation-based scanner (not a full YAML parser; anchors, aliases and flow
maps are ignored and reported as repo warnings). Each job is then mapped to
packages. **The first rule that hits wins**, and the rule is shown as `via`
in the inspector so a wrong guess is easy to spot:

1. **config**: `ignoreJobs` drops the job; `global` maps it to every package;
   `packages[].jobs` (scoped by `workflow` when set) maps it to those
   packages.
2. **ignored**: a job whose name or id starts with `promote`, `deploy` or
   `release` is shown as ignored and gates nothing (unless rule 1 configured
   it).
3. **name**: the job name and id are split into tokens on `- _ ( ) / : ,` and
   spaces; a package whose token sequence appears in them wins, longest
   package name first. `web-admin-check` maps to `web-admin`, not `web`.
4. **workdir**: every `working-directory` of the job lies inside exactly one
   package (the deepest one, for nested packages).
5. **gate**: the job's `if:` reads `needs.<job>.outputs.<out>`, and `<out>`
   (with `_` read as `-`) names a package: `web_admin` maps to `web-admin`.
   An output that names no package (`code`) makes the job gate every package.
6. **paths**: path filters decide. If all of a workflow's `on.*.paths` lie in
   one package, every remaining job of that workflow goes there. Otherwise the
   dorny `paths-filter` globs behind the job's gates are compared with each
   package's literal path prefix, then the workflow's own `on.*.paths`.
7. **default**: the job gates every package.

A job is **PR-only** when its `if:` tests `github.event_name ==
'pull_request'` (or `pull_request_target`), or when its workflow runs on pull
requests but not on push. PR-only jobs never count for main; they are listed
as "PR-only" in the inspector and their verdict comes from the lanes' PRs.

When a mapping is wrong, override it with `packages[].jobs`, `global` or
`ignoreJobs`.

## Verdicts: not-run is not green

A GitHub job can report `success` while its real work never ran: a step-level
`if: needs.changes.outputs.<flag> == 'true'`, or a dorny filter step, skips
every working step and the job still succeeds. laneboard does not call that
green. Per job:

| Job | Verdict |
| --- | --- |
| conclusion `skipped` (job-level `if:` was false) | `not-run` |
| completed with a failure-class conclusion | `fail` |
| not completed: `queued`, `waiting`, `pending`, `requested` | `queued` |
| not completed, otherwise | `running` |
| succeeded, but every working step was skipped | `not-run` |
| succeeded, some working steps skipped | `ok`, marked **partial** with the skipped step names |
| succeeded | `ok` |

Working steps are every step except setup: `Set up job`, `Complete job`,
`Post …`, checkout, `setup-*` and cache actions. A custom setup step named
like a test is counted as a working step.

**Last tested and untested commits.** For each package, laneboard finds the
newest main run in which a job mapped to it actually ran green (`ok`, partial
or not): `lastTested {sha, at, runId}`. It then counts the commits to main
since that sha that touch the package's paths
(`git rev-list --count <lastTested>..<main> -- <paths>`): `untestedCommits`.
Any untested commit makes the package `not-run`, with a reason like
"3 commits to web since last tested run".

**Main status** of a package, over the mapped, non-PR-only jobs of each
workflow's latest main run (a run still going on an older sha is skipped for
the newest one on the head):

`fail` > `running` (a run in progress or queued on the head sha) > `not-run`
(every mapped job not-run, or `untestedCommits > 0`) > `ok` > `none` (no
mapped jobs) > `unknown` (no CI: auth missing, no slug, provider `none`).

**Lamp** per row: `crit` when main is `fail`; `warn` when a PR touching the
package is red with a failed job mapped here (or a global one), or there is a
textual conflict involving its lanes; `low` when main is `not-run` or
`running`, or there is only overlap; `ok` when main is `ok`; otherwise grey.
The tooltip lists the reasons.

## Lanes touching packages

Every open branch counts, not only local worktrees: remote branches of
`refs/remotes/origin` (or of the mirror) newer than `branchWindowDays`, not
already merged, newest first, capped at `maxBranches`, plus every local
worktree branch. For each branch laneboard computes the merge base with main,
the files changed since it, the size, and ahead/behind counts (cached by
branch and main sha). A branch both local and remote uses the local head and
shows whether it is pushed.

On the hub, a remote-only branch is joined to the lane working on it on any
builder, so a lane on one builder shows up even when another builder only
sees its pushed branch.

## Conflict prediction

**Textual** conflicts come from `git merge-tree --write-tree` (git 2.38 or
newer), run on the builder for every branch against main and for every pair
of branches that touch at least one common file. Results are cached by the
sha pair, so only changed branches cost git time.

`merge-tree` writes tree and blob objects. laneboard points it at a scratch
object directory, `cacheDir/scratch-objects/<repo>`, with the checkout's
object store (and the mirror's) as read-only alternates, so **nothing is
written into your repository**. The scratch directory is cleared when it
passes 200 MB or is older than 7 days. Commits are passed by validated sha,
never by a branch name.

**Overlap** is the fallback: two branches that change the same files.

- With git older than 2.38, the textual pass is off on that builder and only
  overlap is reported (`/api/v1/hello` lists the `conflicts:textual`
  capability only when it is available).
- On the hub, two lanes no single builder can see together (for example, both
  unpushed on different builders) get an overlap from their file lists. A
  textual result for the same sha pair always overrides it.

Caveats:

- It predicts **Git** conflicts, not broken builds. Two lanes changing the
  same function in different files, or a rename still called elsewhere, is not
  detected.
- Remote-only branches are only as fresh as the refs. With `fetch: "none"` the
  conflict picture can lag behind the forge; the repo header shows the age of
  the refs.

The repo inspector also lists **hotspots**: files touched by two or more open
lanes or in any conflict, top 20.

## Merge-order hint

For lanes that are review-ready, carry a `done` marker, or have an open
non-draft PR that is green or pending, laneboard suggests an order:

1. A lane whose branch is contained in another's comes first.
2. Then, greedily: no textual conflict with main, then the fewest textual
   conflicts with the remaining candidates, then the smallest diff, then the
   oldest PR.

Each entry says why ("no conflicts", "smallest diff"), and a warning is shown
per conflicting pair ("merging X first makes Y conflict on 2 files"). It
appears as a numbered list in the repo inspector and as ranks on the Inbox
review cards. **It is a hint; nothing merges anything.**

## Stale branches

A branch is stale when it is unmerged, has no live session, and either has had
no commit for `staleDays` or is more than `staleBehind` commits behind main.
Each comes with a suggestion:

- `retire`, for a launched lane with a record: the ordinary retire action,
  which a human confirms on the Board;
- `delete-branch` otherwise, shown as text to copy, e.g.
  `git push origin --delete old-experiment` (odd branch names are quoted).

**laneboard never executes either.** Nothing is deleted. The count shows as
`◆ n stale` on the repo header and the list in the repo inspector and the
Morning view.

## Plan status

Plan files are the files at the main ref matching `plans.globs`. The first 60
lines of each are searched for `plans.statusLine`, and the captured word is
mapped through `plans.states` (case-insensitive), e.g.

```markdown
**Plan status:** `PARTIAL` (stage 2 of 4 shipped)
```

Backticks are optional. A word no state lists is counted as `unknown` and
kept for the tooltip; a file with no status line is `unknown` too. Files are
read by blob id and cached, so an unchanged plan costs nothing.

A plan belongs to a package when it matches that package's `plans` globs,
else when its file name starts with the package name's tokens
(`web-admin-auth.md` belongs to `web-admin`, longest name first), else it
counts for the repo only. The row shows `open/partial/done`.

A lane printing `PLAN-DONE: <TOKEN> …` raises an ordinary `done` marker
(`PLAN-DONE` is part of the default `markers.done`).

## The optional bare mirror

With `packages.fetch: "mirror"`, laneboard keeps a bare clone of each repo at
`cacheDir/mirrors/<repo>.git`, cloned once from the checkout's `origin` URL,
and runs `git fetch --prune --no-tags origin '+refs/heads/*:refs/heads/*'`
every `fetchEverySec` (timeout 60 s). Branches and main are then read from the
mirror, so remote-only lanes stay fresh without anyone running `git fetch`.

- **Your checkout is never fetched, checked out or modified.**
- The fetch uses the builder's own git credentials (its SSH key) from a
  background process. That is why it is opt-in: confirm it is acceptable on
  each builder before turning it on.
- Only `https`, `ssh`, `git` and `file` transports are allowed.
- A failing fetch is shown as a repo warning; the last good mirror keeps
  being used.

With the default `fetch: "none"`, laneboard keeps its rule of never fetching
and uses the refs as they are.

## GitHub token requirements

CI is read with the `gh` CLI already logged in on each builder, passing
`-R owner/name` so a host with per-owner tokens picks the right one. Calls are
read-only.

- **Actions: read** is all the Packages view needs. Run lists, run jobs and
  their steps (`gh run list`, `gh run view --json jobs`) work with a
  fine-grained token that has only this.
- **Checks** is used for PR check runs (`statusCheckRollup`, per job) when the
  token allows it (classic and OAuth tokens do).
- **Fine-grained fallback**: a fine-grained token without Checks is refused
  check runs. laneboard then reads the PR's head-commit Actions runs instead;
  those give workflow names, so when the PR is red it looks up the failed jobs
  of that commit once per head sha. The Packages view can still blame a job,
  not just a workflow.

Budget: one run list per repo per `ciEverySec`, run jobs only for runs that
are new or not yet completed (completed runs are cached, in memory and in the
`ci_jobs` table), an occasional probe for rarely run workflows, and a rate
check every 10 minutes: well under 100 requests per hour per repo. When `gh`
is not logged in, or less than 10 % of the budget is left, CI polling backs
off to 10 minutes and the repo header shows `◆` (auth missing / rate low).

## The Packages view

A dense table grouped by repo. Each repo has a sticky header with its slug,
the CI auth/rate glyph, `◆ n stale`, plan counts, warnings and the age of its
refs; clicking it opens the repo inspector (hotspots, merge order, stale
branches with their copyable commands).

| Column | Shows |
| --- | --- |
| lamp | `crit`, `warn`, `low`, `ok`, grey |
| PACKAGE | the package name |
| MAIN | status glyph, short sha, age, `+n` untested commits |
| JOBS | one cell per mapped main job; `∅` not run, hatched partial |
| LN | lanes touching the package |
| PR | open PRs, total and red |
| CONF | `▲` textual conflicts, `◆` overlaps |
| LAST | last change on main |
| 7D | commits in the last 7 days |
| PLANS | open/partial/done |

Filter chips: `crit`, `warn`, `not-run`, `touched`, `conflicts`, `stale`, and
one per repo (route parameters `s` and `q`, so a filtered view can be
bookmarked). Rows sort by lamp severity, then name.

Clicking a row opens its inspector: each job with its verdict, `via`, and
skipped step names; "last tested `<sha>` `<age>` · n untested commits"; the
lanes touching it (with builder and files); PRs with their failed mapped jobs;
conflict pairs with files; and its plans. The `_other` row lists the unmapped
files.

The same data is served at `GET /api/packages` (hub and standalone builder)
and pushed as a `{type: "packages"}` WebSocket message on change, at most once
every 2 s.

## When it looks wrong

- **A job counts for the wrong package**: check its `via` in the inspector,
  then pin it with `packages[].jobs`, `global` or `ignoreJobs`.
- **Main is `not-run` although the run is green**: the mapped jobs skipped
  their working steps, or there are commits to the package since the last run
  that tested it. The inspector names both.
- **Everything is `unknown`**: no CI slug, `provider: "none"`, `collect:
  false` on every builder that has the repo, or `gh` not logged in.
- **A conflict is missing**: the branch may be older than `branchWindowDays`,
  beyond `maxBranches`, or not yet fetched (`fetch: "none"`); with old git,
  only overlaps are reported.
- **Repo warnings** on the header list workflow constructs the scanner skipped,
  an unresolvable `mainRef`, and mirror errors.
