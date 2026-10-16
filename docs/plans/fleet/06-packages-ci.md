# Section 6: Repos, packages, CI per package, lane→package touches, conflict prediction, merge order, plans, stale branches

**Integration notes (integrator):**
- Task ids are P1-P13 (6.n → Pn, with 6.10 → P10 etc.); deps match the global DAG in README.md.
- Config keys are the fragment `server/config/packages.mjs` (`packages`, `plans`, `repos[]` validation additions); `server/config.mjs` is frozen after wave 0 except P8's one-line `markers.done` default (the only other owner of `config.mjs` is X1, which P8 depends on).
- No `server/state.mjs` edit: P9 ships the route/feature module `server/routes/packages.mjs` (X1 loader) that starts the collector, registers `state.addSnapshotKey("repos", ...)`, `GET /api/packages`, `ctx.v1.addCapability("conflicts:textual"|"ci:jobs")`, and emits `{type:"repos", repo, data}` with `ws.send` (the §2 A7 tap adds `builder`/`seq`). It also exports `packagesFor(repo, paths)` for §10 R5.
- Hub side (P11): `server/hub/packages.mjs` plus the hub module `server/hub/routes/packages.mjs` (registers `GET /api/packages` and a §3 service that merges on store changes and `broadcast({type:"packages", data})`, debounced 2 s); no edit to a §3 file.
- P5 also adds `reviews,latestReviews` to the `gh pr view --json` fields in `prForBranch` and exposes `pr.firstReviewAt` (earliest non-bot `submittedAt`), needed by §7 O10.
- Tests are split per task (`test/packages-glob.test.mjs`, `test/packages-detect.test.mjs`) so parallel tasks never share a test file; `test/conflicts.test.mjs` is shared by P6→P7 (sequential).
- Paths: CSS `public/css/views/packages.css`; docs `docs/fleet/packages.md` and `docs/providers.md` (P5); `docs/config.md` is X4's. The view `public/js/views/packages.js` exists as a §4 D4 stub; P12 replaces it with a default export `{id:"packages", mount, unmount, update}`.
- Consumers: §5 M1 (`edges` via `normalizeOverlaps`), §7 O8 (`ci-red-main`, `ci-red`, `conflict` alarms from rows/edges), §10 R5/R10 (`packagesFor`, cost by package), §10 R15 Morning (`stale`), §8 C13 Inbox (`order` ranks).
- Private details (real repos, package lists) moved to `private/06-private.md`.

## 1. Goal and scope

**In:** several repos per fleet (`config.repos[]`); a **package** model per repo (configured or auto-detected); CI status **per job** on `main`, mapped onto packages; which lanes (fleet-wide, including lanes on other builders and remote-only branches) touch which packages; textual **conflict prediction** between open lane branches and main (`git merge-tree`); a **merge-order hint**; plan-status parsing; a **stale-branch report**; the **Packages** view.

**Out (v1):** semantic conflicts (two lanes changing the same symbol in different files, a renamed function still called elsewhere). That needs a per-language symbol index. Listed as "later" in §5. Also out: anything that writes to a forge, auto-merge, auto-delete of branches, ETag-conditional REST polling (budget below shows it isn't needed; noted as a later optimisation), non-GitHub CI providers (the interface stays provider-shaped so one can be added).

## 2. Design

### 2.1 Where collection runs: builders collect, hub merges

Decision: **every builder collects CI and git data for the repos it has checked out; the hub only merges.**

- The hub holds no forge credentials and no git checkouts. It already holds the Ed25519 key that can drive every builder (conventions: Hub). Adding a GitHub token to that machine would put "control every builder" and "read/write every repo" behind one compromise. Builders already hold a `gh` token and an SSH push key (that is what makes them builders). Reading CI with credentials they already have adds no new privilege.
- The git work (merge-base, diff, merge-tree) needs the objects. Builders have them, and some lanes exist only in a builder's local worktree. The hub can't see those at all.
- Cost of the choice: builders are least trusted, so a builder could lie about CI. Mitigation: everything is display-only (no action is triggered by a CI or conflict result). The hub tags each datum with `via: <builderId>`. When two builders report the same `(slug, runId, attempt)` with different conclusions, the hub marks the run `disputed` (▲ in the inspector) and shows both. All builder strings are rendered as text (conventions: no innerHTML from builder data).
- Two builders with the same repo both poll it. This is accepted: about 60 calls/h per repo per builder against 5000/h per token (budget in §2.4), and it gives redundancy when one is down. The hub dedupes by run id, keeping the report with the greatest `updatedAt`. `repos[].ci.collect: false` turns collection off on one builder if wanted.

In standalone builder mode the same pure merge (`server/packages/rows.mjs`) runs locally over the one builder's data. There is **one code path** for rows.

### 2.2 Config (conventions shape, plus the knobs)

Fragment `server/config/packages.mjs` (X1 mechanism; core `defaults()` keeps `repos: []` at config.mjs:80 and `ci: {provider:'none', repo:''}` at config.mjs:117) adds:

```js
// repos[] entries, each optional beyond `name`:
// { name, path?, ci?: {provider:'gh', repo:'owner/name', collect?: true},
//   packages?: [{name, paths:[globs], jobs?:[job names], workflow?:'ci.yml', plans?:[globs]}],
//   global?: [job names],              // jobs that gate every package (secret scan, …)
//   ignoreJobs?: [job names],          // e.g. a promote/deploy job: not a test
//   markers?: {...} }                  // exists today (config.mjs:305)
packages: {
  autodetect: true,          // only when a repo has no packages[]
  mainRef: 'origin/main',
  branchWindowDays: 14,      // remote branches newer than this are considered
  maxBranches: 40,           // per repo, newest first; caps the O(n²) pass
  fetch: 'none',             // 'none' = use refs as they are | 'mirror' = bare mirror under cacheDir, fetched by laneboard
  fetchEverySec: 300,
  cacheDir: ~/.cache/laneboard/git,   // mirrors/<repo>.git, scratch-objects/<repo>
  ciEverySec: 120,
  staleDays: 7,
  staleBehind: 50,
},
plans: {
  globs: ['docs/plans/**/*.md'],
  // first capture group = the state word; backticks optional
  statusLine: '^\\*\\*Plan status:\\*\\*\\s*`?([A-Z][A-Z-]+)',
  states: { open: ['OPEN','READY','PROPOSAL','IN-PROGRESS'], partial: ['PARTIAL'],
            done: ['DONE','SUPERSEDED','DECIDED'], deferred: ['DEFERRED'] },
},
markers.done: 'STAGE-DONE|LANE-DONE|PLAN-DONE',   // PLAN-DONE added to the generic default: P8's one-line edit of core config.mjs (not a fragment key)
```

The fragment's `validate(c, bad)` adds these checks: each `repos[].packages[].paths` is a non-empty string array; `repos[].ci.provider` ∈ `PROVIDERS.ci`; `ci.repo` matches `^[\w.-]+/[\w.-]+$`; `plans.statusLine` compiles and has a capture group; `packages.fetch` ∈ {none, mirror}.

**Legacy:** `config.ci.repo` today is a *directory name* used as cwd (gh.mjs:140-143, pr.mjs:248), not `owner/name`. `server/packages/repos.mjs#resolveRepos(config)` normalises it. With no `repos[].ci` and `ci.provider==='gh'`, the `ci.repo` dir gets a `ci` block whose `repo` slug comes from `git remote get-url origin` through `parseRemote(url)` (handles `git@github.com:o/n.git`, `https://github.com/o/n(.git)`, `ssh://git@github.com/o/n`). The result is cached for the process lifetime. A repo with no resolvable slug gets `ci: null` and its rows show `unknown`.

### 2.3 Package model and auto-detect

`server/packages/glob.mjs` is tiny and has no dependency.
- `compileGlob(g) -> RegExp`. Supports `**` (any depth, including zero dirs: `a/**/b` matches `a/b`), `*` (no `/`), `?`, `{a,b}`, a trailing `/` meaning `/**`, a leading `!` meaning negate (handled in `matchAny`). Everything else is escaped.
- `matchAny(globs, path) -> bool`: ordered, and the last match wins (so `["web/**","!web/docs/**"]` works).
- `toPathspec(globs) -> ['-- ', ':(glob)web/**', ':(exclude,glob)web/docs/**']` for `git log -- …`.

`server/packages/detect.mjs`:
- `detectPackages(tree, readFile) -> [{name, paths, source:'auto', kind}]`, pure. `tree` is the `git ls-tree -r --name-only <mainRef>` list. `readFile(p)` is `git show <mainRef>:<p>`, injected so tests use fixture dirs. Rules, applied in order and deduped by path:
  1. Root `package.json` `workspaces` (an array, or `{packages:[]}`). Each entry is expanded against the tree's directories (`packages/*` → each dir) and gives `{name: basename, paths:[dir+'/**'], kind:'npm'}`.
  2. Root `pyproject.toml` `[tool.setuptools.packages.find]`: `include = [...]` (may span lines) and `where = [...]` (default `.`). `core*` becomes the top-level dir `core` if it exists under `where`. Also `[tool.poetry] packages = [{include="x"}]`. This uses a minimal TOML reader: a section regex, then a bracket-balanced array of quoted strings. No TOML dependency.
  3. Root `Cargo.toml` `[workspace] members` gives one package each.
  4. A depth-1 dir with its own `package.json`, `pyproject.toml` or `Cargo.toml` is one package named after the dir (`kind` from the manifest). The members of a sub-dir Cargo workspace become `parts` (information only).
  5. A depth-1 dir with its own `CLAUDE.md` that rules 1-4 didn't already cover gives `kind:'claude'`.
  6. `_other`: every file matched by no package (computed in rows, not a real package).
- Overlaps are allowed (a file can belong to two packages). Name collisions get the parent dir appended (`app-desktop`).
- The result is cached by `(repo, mainSha)`. The cost is one `ls-tree` plus at most ~5 `git show` calls per new main sha.

### 2.4 CI per job (gh provider)

The `server/providers/ci/gh.mjs` additions are read-only. They keep the "failure is a value" rule (docs/providers.md "Two rules"):

| Export | Calls | Returns |
|---|---|---|
| `mainRuns({slug, branch, limit=30, workflow?})` | `gh run list -R <slug> --branch <b> --limit <n> [--workflow <file>] --json databaseId,attempt,workflowName,workflowDatabaseId,headSha,event,status,conclusion,createdAt,updatedAt` | `{ok, runs:[normalised]}` \| `{auth:false}` \| `{ok:false,error}` |
| `runJobs({slug, runId})` | `gh run view <id> -R <slug> --json jobs` | `{ok, jobs:[{id,name,status,conclusion,startedAt,completedAt,steps:{total,ran,skipped,failed,skippedNames[]}}]}` |
| `rateLimit()` | `gh api rate_limit` (doesn't count against the limit) | `{ok, remaining, limit, resetAt}` |
| `failedJobsForCommit({slug, sha})` | `gh run list -R … --commit <sha> --json databaseId,conclusion,workflowName` then `runJobs` for each failed run | `[{workflow, job}]` |

Notes:
- `-R <slug>` (not cwd) so the call works on a host where `gh` picks a token per owner from the repo argument.
- **Fine-grained tokens** (PR #8, commit 9b2b7cc, gh.mjs:70-83, 112-135): they have no Checks permission, so `statusCheckRollup` and `gh pr checks` are refused. Actions *read* still allows `run list` / `run view --json jobs`. Per-job data on main therefore never depends on Checks. For PRs, `prForBranch` keeps the run-level fallback, but `failedNames` holds **workflow** names there. When the verdict is red *and* `viaRuns`, `pr.mjs` calls `failedJobsForCommit` once per head sha (cached), so the package view can blame a job, not a workflow. Classic or OAuth tokens keep the `statusCheckRollup` path, which is already per job.
- **Budget, per repo per builder:** `mainRuns` every `ciEverySec`=120 s is 30/h. `runJobs` runs only for runs that are new or not yet completed (a completed run's jobs are immutable, so they're cached forever in memory under `(runId, attempt)` and in SQLite table `ci_jobs`). That is about 1-3 per merge. On top, one `mainRuns --workflow <file> --limit 1` per workflow file not seen in the 30-run window, every 15 min. That covers path-filtered workflows that rarely run. Total < 100 req/h against 5000/h. `rateLimit()` is checked every 10 min. Below 10 % remaining, the collector backs off to 10 min and sets `ci.rate.low=true` (◆ on the repo header). An ETag/`gh api --include` path is deliberately not built.
- `none.mjs` gets the same exports, returning `{ok:false}`. `test/providers.test.mjs:29` adds the new names to the `ci` shape.

**Skipped steps mean "not tested".** A job can be green while its real work didn't run. The observed patterns are step-level `if: needs.changes.outputs.<flag> == 'true'` and a dorny filter step gating the rest. GitHub reports the job `success` and each gated step `skipped`. Treating that as green would claim a package was tested on a commit where only `checkout` ran. Rule in `server/packages/jobs.mjs#jobVerdict(job)`:
- Setup steps are `^(Set up job|Complete job|Post .*|Run actions/checkout.*|Run actions/setup-.*|Checkout.*)$`, plus any `uses:` of checkout/setup/cache when the names are generic.
- `ran = steps − setup`. If the job's conclusion is `skipped` (job-level `if:` false), or `ran.length>0 && ran.every(skipped)`, the verdict is `not-run`. If some ran steps were skipped, it is `ok` with `partial:true, skippedNames`. Otherwise the conclusion is bucketed with `checkBucket` (gh.mjs:24).
- Package status then looks back for **the last run where its jobs actually ran** (`lastTested {sha, at, runId}`). It counts `untestedCommits = git rev-list --count <lastTested.sha>..<mainRef> -- <pathspec>`, cached by `(mainSha, lastTestedSha, pkg)`. `untestedCommits>0` shows ◆ `not-run` with a tooltip like "3 commits to web since last tested run".

### 2.5 Job → package mapping

`server/packages/workflow-scan.mjs#scanWorkflow(text)` is a minimal, indentation-based YAML scanner, not a parser. It extracts only:
`{name, file, on:{events:[], paths:[], pathsIgnore:[]}, jobs:[{id, name, needs:[], if, prOnly, workingDirs:[], gates:[{job, output}], filters:{<out>:[globs]}, stepFilters:{<out>:[globs]}}]}`.
- Mechanics: it tracks the indent stack. It handles `key: value`, `key:` + `- item` lists, inline `[a, b]`, quoted strings, `|`/`>` block scalars (needed for dorny `filters: |`, whose content is itself `out:` + `- 'glob'` and is re-scanned), and strips `#` comments outside quotes. Anchors, aliases and flow maps are unsupported and ignored (recorded in `warnings[]`).
- `prOnly`: the job `if:` matches `github.event_name\s*==\s*'pull_request'`, or the workflow `on` has no `push`.
- `gates`: every `needs.<job>.outputs.<out>` found in job- or step-level `if:` expressions.
- Workflows come from `git ls-tree <mainRef> .github/workflows/` + `git show`, cached by `(repo, mainSha)`. It never reads the working tree.

`server/packages/jobmap.mjs#mapJobs(packages, workflows, repoCfg) -> {[workflowFile+'#'+jobName]: {packages:[names]|'*', via, prOnly}}`. Order (first hit wins):
1. **config**: `packages[].jobs` (optionally scoped by `workflow`), `global` → `'*'`, `ignoreJobs` → dropped.
2. **name**: tokenise the job name and id on `[-_\s()/:,]`. The package whose token sequence occurs contiguously wins, longest package name first. So `web-admin-check` → `web-admin`, not `web`.
3. **working-directory**: every `workingDirs` entry falls under exactly one package's paths → that package.
4. **gate output name**: `needs.changes.outputs.web_admin` → normalise `_`→`-` → package `web-admin`. An output that names no package (`code`) → `'*'`.
5. **paths**: dorny `filters`/`stepFilters` and workflow `on.*.paths`. A package matches when its path prefix (glob up to the first wildcard) is a prefix of a filter glob's prefix, or the reverse. When one workflow file maps entirely to one package (desktop-style `paths: [x/**]`), all its jobs go there.
6. otherwise `'*'` (global: gates every package).

Jobs whose name matches `/^(promote|deploy|release)\b/` are reported as `ignored` unless configured. `prOnly` jobs are excluded from `main.status` and shown in the inspector as "PR-only". Their verdict comes from the lanes' PRs.

### 2.6 Lane → package touches (all branches, not only local worktrees)

`server/packages/branches.mjs`, per repo, sequentially (same discipline as lanes.mjs:212):
- **Refs:** remote `git for-each-ref --sort=-committerdate --format='%(refname:short)%09%(objectname)%09%(committerdate:unix)' refs/remotes/origin` (or `refs/heads` of the mirror). Branches older than `branchWindowDays` or already merged (`merge-base --is-ancestor`) are dropped, capped at `maxBranches`. Local worktree branches come from `lanes.knownWorktrees()` (lanes.mjs:290), and their heads from the existing `trees` pass. A branch present both locally and remotely uses the local head, with `pushed: localSha===remoteSha`.
- **Per branch:** `mb = git merge-base <mainSha> <sha>`, then `git -c core.quotePath=false diff --name-only -z <mb> <sha>`, plus `--shortstat` for size. Cached by `(sha, mainSha)` in a `Map` with LRU 2000. Measured on a 61 MB repo: about 2-5 ms per branch, so 40 branches cost about 0.2 s cold and ~0 warm.
- **Output:** `{repo, branch, sha, local, pushed, laneId|null, mergeBase, ahead, behind, lastCommitAt, files[], packages[], size:{files, ins, del}}`. `laneId` is set for local worktrees. For remote-only branches the hub joins by `(repo, branch)` against every builder's lanes to get the fkey (a lane running on builder-b whose branch builder-a sees as remote).
- **Freshness:** with `packages.fetch:'none'` (the default), laneboard keeps its rule of never fetching (lanes.mjs:10-15) and uses refs as they are. With `'mirror'`, it keeps a bare mirror `cacheDir/mirrors/<repo>.git`, cloned once from the checkout's `origin` URL, and runs `git fetch --prune --no-tags origin '+refs/heads/*:refs/heads/*'` every `fetchEverySec` (timeout 60 s). The user's checkout is never touched.
- **Read-only git** for merge-tree and the scratch writes: `server/packages/gitenv.mjs#scratchEnv(repo)` returns `{GIT_OBJECT_DIRECTORY: cacheDir/scratch-objects/<repo>, GIT_ALTERNATE_OBJECT_DIRECTORIES: <checkout>/.git/objects:<mirror>/objects}`. Every `merge-tree` runs with it, so the tree and blob objects it writes land in laneboard's cache, never in the repo. The scratch dir is deleted when it passes 200 MB or after 7 days. Commits are passed by sha, not by ref name, so local and mirror objects mix. (For a worktree, `<checkout>/.git` is the main checkout's git dir; resolve it with `git rev-parse --git-common-dir`.)

### 2.7 Conflict prediction

`server/packages/conflicts.mjs` requires git ≥ 2.38 for `merge-tree --write-tree`. This host has 2.43.0. `gitVersion()` is checked once. Below 2.38, the textual pass is disabled and only overlap is reported (`capabilities` in `/api/v1/hello` lists `conflicts:textual` only when it is available).
- `mergeTree(a, b) -> {clean:bool, files:[]}`: `git merge-tree --write-tree --name-only --no-messages -z <a> <b>`. Exit 0 means clean. Exit 1 means conflicts: the first NUL field is the tree oid, the rest are conflicted paths. Other codes give `{error}`. Measured at 1-25 ms per pair.
- **Pairs:** every branch against `main` (`vsMain`), and every unordered pair of branches touching at least one common file (pre-filter by `touches` intersection; disjoint file sets can't conflict textually). Cache key `[shaA, shaB].sort().join(':')` → result, LRU 5000. Recompute only for changed shas. Worst case 40 branches is 780 pairs × ~5 ms ≈ 4 s once. Typical warm is < 50 ms.
- **Overlap fallback on the hub:** two lanes not both visible to one builder (e.g. both unpushed, on different builders) get `kind:'overlap'` from the intersection of their `files[]`, which is pure and cheap. A `textual` result for the same sha pair overrides it.
- **Output (builder):** `conflicts: [{a:{branch,sha}, b:{branch,sha}|{main:true}, kind:'textual', files[], at}]`. The hub output is in §2.9.
- **Hotspots:** per repo, `[{file, lanes:[fkey], conflicts:n}]`, files touched by ≥ 2 open lanes or in any conflict, sorted by `conflicts` then by lane count. Top 20.

### 2.8 Merge-order hint

`server/packages/order.mjs#mergeOrder(candidates, edges, deps)`, pure. Candidates are lanes with `reviewReady`, a `done` marker, or an OPEN non-draft PR with verdict green or pending. Rules:
1. **Dependencies first:** if `merge-base --is-ancestor A.sha B.sha` (B contains A), A comes before B. This is computed on the builder per candidate pair, cached by sha pair.
2. Then a greedy pick: the lane with no textual conflict against main, then the fewest textual edges to the remaining candidates, then the smallest diff (`size.ins+del`), then the oldest PR.
3. Output `[{fkey, rank, reasons:['no conflicts','smallest diff'], after:[fkey]}]`, and a warning per pair, e.g. "merging X first makes Y conflict on 2 files".

It is shown as a numbered list in the Packages inspector (repo level) and as ranks on the Inbox review cards. It is a **hint only**. No action merges anything.

### 2.9 Data shapes

**Builder snapshot** (`/api/v1/snapshot`) gets a new key `repos`, and the stream gets a new message `{type:'repos', builder, seq, repo, data}`, sent when the hash of a repo's block changes:

```js
repos: [{ name, slug, mainRef, head:{sha, at},
  packages:[{name, paths, source:'config'|'auto', kind}],
  workflows:[{file, name, jobs:[{id, name, prOnly}]}], jobMap:{'ci.yml#web-check':{packages:['web'], via:'name', prOnly:false}},
  ci:{provider, auth:true|false, at, rate:{remaining, low},
      runs:[{id, attempt, workflow, file, sha, event, status, conclusion, createdAt, updatedAt,
             jobs:[{id, name, status, conclusion, verdict:'ok'|'fail'|'running'|'queued'|'not-run', partial, skippedNames}]}]},
  lastTested:{[pkg]:{sha, at, runId}}, untested:{[pkg]: n},
  branches:[/* §2.6 */], conflicts:[/* §2.7 */], deps:[[shaA, shaB]],
  commits:{[pkg]:{n7d, lastAt, lastSha}},   // one `git log --since=7.days --name-only -z --format=%x00%H%x09%ct <mainRef>` per repo per 5 min
  plans:{counts:{open, partial, done, deferred, unknown}, files:[{path, state, word, pkg|null}]},
  stale:[{branch, sha, behind, lastCommitAt, laneFkey|null, suggestion:'retire'|'delete-branch'}],
  warnings:[] }]
```

**Package row** (`server/packages/rows.mjs#buildRows(fleetRepos, lanesByFkey, prsByFkey) -> rows`, pure, used by hub and builder):

```js
{ repo, package,
  main:{status, sha, at, tested:{sha, at}, untestedCommits,
        jobs:[{name, workflow, conclusion, verdict, prOnly, partial, via}]},
  lanes:[fkey],                         // touching it, any builder
  prs:[{n, fkey, verdict, failed:[job names mapped to this package or global]}],
  conflicts:{textual:n, overlap:n, pairs:[[fkeyA, fkeyB|'main']]},
  lastChange:{sha, at}, commits7d,
  plans:{open, partial, done},
  lamp:'crit'|'warn'|'low'|'ok'|'none', reasons:[...] }
```

**`main.status` precedence** (over the mapped non-prOnly jobs in each relevant workflow's latest main run): `fail` (any job failure-class) > `running` (in progress or queued on the head sha) > `not-run` (every mapped job not-run, or `untestedCommits>0`) > `ok` > `none` (no mapped jobs) > `unknown` (ci auth false, no slug, provider none).

**Lamp:** `crit` if main is `fail`. `warn` if any PR touching the package is red with a failed job mapped here or global, or there is a textual conflict among lanes touching it (or against main). `low` if main is `not-run` or `running`, or there is only overlap. `ok` otherwise. `none` means grey. `reasons` holds the tooltip text.

**Hub (fleet aggregation):** `server/hub/packages.mjs#merge(perBuilder) -> {repos:[...], rows, edges, hotspots, order, stale}`.
- Repos are keyed by `slug || name`.
- Runs are deduped by `(slug, id, attempt)`, taking the greater `updatedAt`. A conflicting `conclusion` at equal `updatedAt` is marked `disputed:[builderIds]`.
- Branches are keyed by `(repo, branch)`, preferring the `local` report (it has the true head).
- Conflicts are deduped by the sorted sha pair. Overlap is added for uncovered pairs.
- Edges for the Map: `edges:[{a:fkey, b:fkey|'main:<repo>', kind:'textual'|'overlap', files:n}]`.
- Endpoints: hub `GET /api/packages` (module `server/hub/routes/packages.mjs`) returns that object. Builder standalone serves the same at `GET /api/packages` (module `server/routes/packages.mjs`) from its own data via the same pure `merge([{builder: self, data}])`. WebSocket `/ws` message `{type:'packages', data}` is sent on change (debounced 2 s) in both modes.

### 2.10 Plan and marker parsing

`server/packages/plans.mjs`:
- `planState(text, cfg.plans) -> {word, state}`. It scans the first 60 lines for `statusLine` and maps the word through `states` (unknown words become `unknown`, and `word` is kept for the tooltip).
- `PLAN-DONE: <TOKEN> <rest>` is an ordinary marker of kind `done` once the default includes `PLAN-DONE` (anchored pattern; markers.mjs:23-33 compiles `^(?:…):`). A repo adds its own words through `repos[].markers` (config.mjs:305). There is no new marker machinery.
- Plan files are listed with `git ls-tree -r --name-only <mainRef>` filtered by `plans.globs`, read with `git show`, and cached by blob oid (`ls-tree` without `--name-only` gives it). So a changed plan costs one read.
- Plan → package: `packages[].plans` globs if configured, else the filename starts with `<pkg>-` (token match as in §2.5), else repo-level only. progress.mjs (Stage N of M, progress.mjs:20-63) is unchanged. Plan *status* is a separate signal.

### 2.11 Stale branches

`server/packages/stale.mjs#staleBranches(branches, mainSha, cfg)`, pure over `branches[]` (which already carry `behind` and `lastCommitAt`). A branch is stale when it's unmerged and either `now-lastCommitAt > staleDays` or `behind > staleBehind`, and it has no live session (joined on the hub). Suggestion: `retire` if it's a launched lane with a record (the existing `retire` action, which a human confirms), else `delete-branch`, shown as copyable text `git push origin --delete <branch>`. **Never executed by laneboard.** The list goes in the Packages view repo header (◆ n stale) and the Morning view.

### 2.12 Packages view

`public/js/views/packages.js` (DOM only), plus `public/js/views/packages-model.js` (pure: filter, sort, glyphs, testable under `node --test`):
- A dense table grouped by repo (a sticky repo header row has the slug, CI auth/rate glyph, `◆ n stale`, plan counts, and the merge-order button).
- Columns are glyphs with `title` + `aria-label`: lamp (■▲◆●), package, main (status glyph + short sha + age), a jobs strip (one 8 px cell per mapped job; ∅ for not-run, hatched for partial), lanes (count + hue dots, using lanes.mjs `hueFor`), PRs (`n` / red count), conflicts (▲ textual / ◆ overlap), last change (relative time), commits 7d, plans `o/p/d`.
- Filter chips (router `q`/`s`): `crit`, `warn`, `not-run`, `touched`, `conflicts`, `stale`, plus one per repo. Sort is by lamp severity then name.
- Clicking a row opens the inspector: jobs with verdict, skipped step names and "last tested <sha> <age> · n untested commits", lanes touching it (fkey, builder code, files in this package), PRs with failed mapped jobs, conflict pairs with files, plans list. A row with `_other` shows unmapped files.
- All builder-derived strings go through `textContent`. Uses tokens from `public/css/tokens.css` and §4 components (`.dt`, lamps, plates, inspector via `navigate({sel})`).

### 2.13 Module list

New: `server/packages/{glob,detect,repos,workflow-scan,jobmap,jobs,branches,gitenv,conflicts,order,plans,stale,rows}.mjs`, `server/routes/packages.mjs` (feature module), `server/hub/routes/packages.mjs`, `server/collector/packages.mjs` (the orchestrator: CI at `ciEverySec`, git at `lanePollMs` offset 50 s, fetch at `fetchEverySec`, all sequential, `start()/snapshot()/health()`), `server/hub/packages.mjs`, `public/js/views/packages.js`, `public/js/views/packages-model.js`, `public/css/views/packages.css`, `docs/fleet/packages.md`.
Changed: `server/config.mjs` (one line, P8), `server/providers/ci/{gh,none}.mjs`, `server/collector/pr.mjs` (job-level failures, `repos[].ci` slug per lane repo instead of `config.ci.repo` at pr.mjs:248), (no `server/state.mjs` edit: the snapshot key and collector start are in `server/routes/packages.mjs`), `server/db.mjs` (table `ci_jobs(run_id, attempt, slug, json, PRIMARY KEY(run_id, attempt))`), `docs/providers.md` (CiProvider table).

## 3. Implementation tasks (dependency order)

| # | Task | Files owned | Done when |
|---|---|---|---|
| P1 (6.1) | Glob matcher + pathspec. Deps none | `server/packages/glob.mjs`, `test/packages-glob.test.mjs` | `node --test test/packages-glob.test.mjs` is green. `**` zero-depth, negation and `{a,b}` cases pass |
| P2 (6.2) | Config fragment + `resolveRepos`/`parseRemote`. Deps F4 | `server/config/packages.mjs`, `server/packages/repos.mjs`, `test/config-packages.test.mjs` | Old configs load unchanged. A bad glob list or slug fails `validate` with a message. Legacy `ci.repo` resolves |
| P3 (6.3) | Auto-detect. Deps P1 | `server/packages/detect.mjs`, `test/fixtures/repos/{npm-ws,py-find,cargo-ws,claude-dirs,mixed}/`, `test/packages-detect.test.mjs` | Each fixture yields the expected package list (see §4) |
| P4 (6.4) | Workflow scanner + job map + `jobVerdict`. Deps P1 | `server/packages/{workflow-scan,jobmap,jobs}.mjs`, `test/fixtures/workflows/*.yml`, `test/ci-jobs.test.mjs` | All §4 ci-jobs assertions pass |
| P5 (6.5) | gh provider: `mainRuns`, `runJobs`, `rateLimit`, `failedJobsForCommit`, `reviews` fields + `firstReviewAt`; none parity. Deps none | `server/providers/ci/{gh,none}.mjs`, `test/fixtures/gh/{runs-main.json,run-jobs.json,run-jobs-skipped.json,pr-reviews.json}`, `test/pr.test.mjs`, `test/providers.test.mjs`, `docs/providers.md` | Parsers are tested on the fixtures via `_setRunner` (gh.mjs:105). The shape test includes the new exports |
| P6 (6.6) | Branches/touches + scratch git env + mirror. Deps P1 | `server/packages/{branches,gitenv}.mjs`, `test/conflicts.test.mjs` (touches part) | In a temp repo, touches are right for local and remote-only branches. **The repo's `.git/objects` count is unchanged after a merge-tree** (asserted) |
| P7 (6.7) | Conflicts, merge order, stale. Deps P6 | `server/packages/{conflicts,order,stale}.mjs`, `test/conflicts.test.mjs` | §4 conflicts assertions pass. With git < 2.38 faked, the pass degrades to overlap |
| P8 (6.8) | Plans + `PLAN-DONE` default. Deps P2, X1 | `server/packages/plans.mjs`, `test/plans.test.mjs`, `server/config.mjs` (the `markers.done` default line only), `test/markers.test.mjs` | The status words map, backticks are optional, unknown words are kept. `PLAN-DONE: X` is a `done` marker in `test/markers.test.mjs` |
| P9 (6.9) | Collector + feature module + db table + pr.mjs job blame. Deps P2-P8, P10, X1, F7, F9 | `server/collector/packages.mjs`, `server/routes/packages.mjs`, `server/db.mjs` (append the `ci_jobs` migration + 2 functions at the end), `server/collector/pr.mjs`, `test/packages-collector.test.mjs`, `test/pr.test.mjs` (fine-grained red path) | With a fake provider and a temp repo, `snapshot().repos[0]` has all keys of §2.9; `/api/v1/hello` lists `conflicts:textual` when git ≥ 2.38. The existing suite is green |
| P10 (6.10) | Rows (pure). Deps none (fixtures) | `server/packages/rows.mjs`, `test/rows.test.mjs` | Precedence and lamp table tests pass (each status case, prOnly excluded, partial, untested) |
| P11 (6.11) | Hub merge + hub module (route + service). Deps P10, H3, X1 | `server/hub/packages.mjs`, `server/hub/routes/packages.mjs`, `test/hub-packages.test.mjs` | Dedupe by run id, `disputed`, branch join to the fkey of a lane on another builder, overlap vs textual override, edges; the service broadcasts `packages` once per 2 s burst |
| P12 (6.12) | Packages view. Deps P10, D4, D3 | `public/js/views/packages.js`, `public/js/views/packages-model.js`, `public/css/views/packages.css`, `test/packages-view.test.mjs` | The model is tested for filters/sort/glyphs. Manual: the view renders a fixture snapshot with no console errors |
| P13 (6.13) | Docs fragment. Deps P9, P11 | `docs/fleet/packages.md` | It describes config, mapping order, the not-run rule, conflict caveats, and that nothing is deleted. The hygiene test is green |

Parallelism: P1, P2, P5 and P10 can start at once; P3, P4, P6 after P1; P7 after P6; P8 after P2; P9 after P2-P8 and P10; P11 after P10 + H3; P12 after P10 + §4 D4. The global DAG is in README.md.

## 4. Tests

- **`test/packages-glob.test.mjs` / `test/packages-detect.test.mjs`:**
  - Glob: `web/**` matches `web/a/b.ts` and not `web-admin/x`. `a/**/b` matches `a/b`. `!web/docs/**` negates. `toPathspec` emits `:(glob)`.
  - Detect: npm `workspaces:["apps/*","lib"]` gives one package per dir. `[tool.setuptools.packages.find] include=["core*","api*"]` over multiple lines gives `core`, `api` (and a `core_extra/` dir matches `core*` only if it exists). A root Cargo `members` gives one package each. A sub-dir `pyproject.toml` gives the dir as a package. A `CLAUDE.md` dir gives `kind:'claude'`. Rules dedupe. A name collision gets suffixed.
- **`test/ci-jobs.test.mjs`** (fixtures written generically, with names like `acme`, modelled on real patterns):
  1. `gates.yml`: a `changes` job with outputs `code/web/web_admin` and jobs `web-check`, `web-admin-check`, `lint-and-test` gated at step level. Expect `web-admin-check` → `web-admin` via `name` (not `web`), and `lint-and-test` → `'*'`.
  2. `workdir.yml`: jobs `api (ruff, pytest)` and `web (tsc, eslint)` with `working-directory: api|web`. Expect `name` or `workdir` hits.
  3. `dorny.yml`: an on-paths `pkg/**` workflow with a dorny `filters: |` block, `macos:`/`windows:` outputs and job `if: needs.x.outputs.macos`. Expect all jobs → `pkg`.
  4. `prOnly`: a job `if: github.event_name == 'pull_request'` is `prOnly:true` and is excluded from main status.
  5. `promote` is ignored.
  6. `jobVerdict`: green job with all non-setup steps skipped → `not-run`. Some skipped → `ok, partial`. Job conclusion `skipped` → `not-run`. A failure → `fail`.
  7. The scanner survives comments containing `:` and quoted `#`.
- **`test/conflicts.test.mjs`** (temp repo built with `git init`, `-c user.name=t`, in `os.tmpdir()`):
  - Branches `a` and `b` both edit line 1 of `x.txt`, `c` edits `y.txt`, `d` is based on `a`.
  - Expect: `mergeTree(a,b)` gives `{clean:false, files:['x.txt']}`, `(a,c)` is clean, the pre-filter skips `(b,c)`, and `vsMain` is clean after main moves on a different file.
  - `touches(a)` gives `['x.txt']`. A remote-only branch (pushed to a bare `origin` and deleted locally) is found via `refs/remotes`.
  - The sha-pair cache hits on the second pass (spy on `run`).
  - The objects dir count of the repo is unchanged (scratch env).
  - `mergeOrder` puts `a` before `d` (dependency) and `c` first (no conflicts, smallest).
  - `staleBranches` flags an old-dated branch (`GIT_COMMITTER_DATE`) and suggests `delete-branch`.
- **`test/plans.test.mjs`, `test/rows.test.mjs`, `test/hub-packages.test.mjs`, `test/packages-view.test.mjs`, `test/packages-collector.test.mjs`:** as stated in §3.
- **Existing tests:** `test/providers.test.mjs` gets the shape extension. `test/pr.test.mjs` adds the fine-grained red path → `failedJobsForCommit` is called once per head sha. `test/hygiene.test.mjs` must pass over the new fixtures.

## 5. Risks, open questions, human checks

- **The YAML scanner is a heuristic.** Wrong mappings are visible (inspector shows `via`), and `packages[].jobs` overrides them. Unparseable constructs go to `warnings[]` shown on the repo header. A real YAML dep (`yaml`, ~100 kB, zero deps) is the fallback if the scanner is too brittle. It would need a justification line.
- **Script-computed gates** (a shell script deciding the flags, not dorny) can't be read. Only the output-name heuristic (§2.5 rule 4) applies, and config covers the rest.
- **Step-name setup filter**: a custom setup step named like a test would be mis-classed. Configurable later (`repos[].setupSteps`). v1 uses the regex.
- **Mirror fetch** uses the builder's SSH key from a background process. `fetch:'mirror'` is opt-in. HUMAN: confirm it is acceptable on each builder.
- **Remote-only lanes are only as fresh as the refs.** With `fetch:'none'` the conflict map can lag by hours. The UI shows each repo's ref age (`refsAt`).
- **merge-tree is textual only:** it predicts Git conflicts, not broken builds. Semantic conflicts (later): a per-language changed-symbol extraction (tree-sitter or `git diff -W` function context) intersected across lanes.
- **Dual collection from two builders** can disagree briefly (one has polled, the other not). The `updatedAt` max handles it. `disputed` is only for an equal-time mismatch.
- `HUMAN:` open the Packages view on the hub and compare 3 package rows against the GitHub Actions page for the same main sha (jobs, skipped steps, not-run).
- `HUMAN:` create two deliberately conflicting lane branches on two builders. Check that a textual edge appears once pushed, and an overlap edge before.
- `HUMAN:` confirm `gh run view --json jobs` returns `steps` with the fine-grained token (Actions: read) on each builder. It is expected, but this machine's `gh` isn't authenticated, so it is unverified here.

## 6. Dependencies on other sections

- **§1 / §11 X1**: fkeys (`server/fleet/keys.mjs`), config fragments, `loadModules`, `state.addSnapshotKey`, `server/db.mjs` (F7's builder column first).
- **§2** (snapshot/stream, `ctx.v1.addCapability`): the `repos` snapshot key and `repos` message; `conflicts:textual`, `ci:jobs` capabilities.
- **§3** (hub store/services): `server/hub/packages.mjs` plugs into the fleet store's per-builder `snap.repos`. Edges are consumed by **§5** M1.
- **§4** (shell/router/tokens/inspector): the view mounts at `#/packages`. The inspector component and glyph icons come from `ui/` and `core/icons`.
- **§8 C13 Inbox / §10 R13 review queue**: consume `order` ranks. **§10 R15 Morning** consumes `stale`. **§7 O8** derives `ci-red-main`/`ci-red`/`conflict` alarms. **§7 O10** uses P5's `firstReviewAt`. `retire` is the only suggested action, and it goes through the dispatcher.

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
