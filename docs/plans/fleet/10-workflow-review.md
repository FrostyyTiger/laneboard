# Section 10: Workflow features (review queue, diff review, peek & reply, transcript, run scripts, lane lifecycle)

**Integration notes (integrator):**
- `send-review`, `run-script` and `send-text`'s `guardPrompt` are in §2's dispatcher allowlist (coordinator decision); tiers are `ask` for both new actions (the UI's verb + Cancel sheet = "tier-1 confirm"). `guardPrompt` is implemented by §2 A6 in the built-in `send-text` (it also covers §8's broadcast guard).
- Config is the fragment `server/config/review.mjs`: `review.*` (including §7's `review.overdueHours: 4`), `transcript.*`, and the `repos[].base`/`repos[].scripts` validation.
- No edits to `server/collector/lanes.mjs`, `server/state.mjs` or `server/index.mjs`: the lane fields are a lane decorator in `server/flags/review.mjs` (X1 `state.addDecorator`; the collector starts from the module's `start`), routes are the modules `server/routes/review.mjs` (diff, transcript, preview, morning + `send-review`), `server/routes/scripts.mjs` (`run-script`, hello field `scripts`), `server/routes/archive.mjs` (archive reads); hub routes are `server/hub/routes/review.mjs`.
- The hub read proxy and its allowlist are §3 H12 (all paths of 2.10 are already in its fixed list); no allowlist edit here. Review-wait storage is §7 O10's kv `review.waits` (single store); §10 does not keep its own.
- `mergeMorning` (R10) is the single fleet Morning merge: it also covers §7's requirements (fkeys, `missing`, `deferred`, review-wait stats). Stuck incidents come from §7's alarm history (`events` type `alarm`, kind `stuck`); approvals answered from the hub audit (`approve`/`deny`/`release`). Builder-mode Morning reads `/api/v1/morning` and the view wraps it as one builder client-side.
- Peek uses §1 F6's `public/js/core/ansi.js` (`ansiLineToNodes`); `core/ansi-dom.js` is dropped. Terminals open via `public/js/ui/terminal.js` with `source.termUrl(fkey)` (§1 F8a) plus `?window=`. Inspector tabs use §4 D6's `registerTab`. The REVIEW group is rendered inside §8's Inbox (C13 imports `views/review-queue.js`). Diff CSS is `public/css/views/diff.css`; the `diff` route is a hidden view in §4's router.
- T10.17 is covered by §1 F6's `test/frontend-safety.test.mjs` (whole `public/js/**`); T10.16 (post to GitHub) is phase 2 and not scheduled tonight.
- Task ids R1-R15 (T10.n → Rn); deps/files match the global DAG (README.md). Private details moved to `private/10-private.md`.
- **Security fixes pass (see `SECURITY-FIXES.md`):** `pullCommands` tests cover option injection and command substitution (S11a); restore defaults to the source builder and warns before cross-builder restores (S12a), with a view test; the action registrations in `server/review/actions.mjs` (`send-review`) and `server/review/scripts.mjs` + `server/routes/scripts.mjs` (`run-script`, terminal `window`) are REVIEW-REQUIRED (README 4.5, SR20).

## 1. Goal and scope

**In:**
- **Review queue**: lanes that are `reviewReady`, sorted by how long they have waited. It is a tab inside Inbox (§8 owns the `inbox.js` shell).
- **Diff review**: a builder diff endpoint, proxied by the hub, and a `views/diff.js` file list plus unified diff. You comment on selected lines, and an explicit click sends the batched comments to the lane's session as one review message.
- **Peek & reply**: an inspector tab with the pane tail, a transcript tail parsed from the `~/.claude/projects` JSONL by byte offset, a reply box and quick buttons. "Open terminal" goes through the hub term proxy (§3).
- **Run scripts**: only scripts listed in config (`repos[].scripts`) can run. Each runs in a new tmux window of the lane session, inside the worktree. Every run is audited and needs an `ask`-tier confirmation (verb + Cancel sheet showing the command).
- **Lane lifecycle**: retiring a lane also writes an archive row to SQLite. Board gets an Archive filter with search. Restore relaunches from the branch under a new lane id.
- **Fleet Morning**: grouped by builder, with review-wait, stuck incidents, approvals answered and cost per package.
- **Pull-to-local**: copyable commands only. Nothing is executed.

**Out (v1):**
- A preview proxy for dev servers. It would mean the hub forwarding arbitrary builder ports, which are untrusted processes the agent controls, onto the tailnet. That is an open relay into whatever the agent bound (DB admin UIs, debuggers), and it would get around the guard's forbidden-port model (`server/lanes/launch.mjs:40`). It also needs a per-port CSP/Origin story.
- Posting the review to GitHub. It is specified as phase 2 (T10.16), off by default.
- Archiving lanes that were never launched. A plain worktree has no `lane.json` (`server/lanes/store.mjs:1-3`).
- Editing code from the UI.

## 2. Design

### 2.1 Config keys (fragment `server/config/review.mjs`)

```js
review: {
  overdueHours: 4,                // §7 O10: open review wait older than this raises `review-overdue`
  base: 'origin/main',            // per-repo override: repos[].base
  inlineMaxChars: 7000,           // above this, send-review writes a file (actions.mjs:80 caps send-text at 8000)
  diff: { maxFiles: 300, maxBytes: 2*1024*1024, maxFileBytes: 256*1024, maxFileLines: 4000,
          maxUntracked: 200, timeoutMs: 15000 },
  generated: ['package-lock.json','pnpm-lock.yaml','yarn.lock','*.lock','*.min.js','*.map'],
  postToGitHub: false,            // phase 2
},
transcript: { tailMaxBytes: 1024*1024, maxEntries: 200, textCap: 4000 },
// per repo:
repos: [{ name, base?: 'origin/main', scripts?: { test: 'npm test', dev: 'npm run dev' } }]
```

Validation rules for `scripts`:
- The key must match `^[a-z][a-z0-9-]{0,23}$`.
- The value must be a non-empty string of at most 500 chars with no NUL or newline.
- At most 12 scripts per repo.
- Config comes only from the builder's own config file. Neither the hub nor the API can add or change a script.

### 2.2 Builder: diff (`server/review/diff.mjs`)

```js
export const BASE_RE = /^(origin\/[A-Za-z0-9._\/-]{1,100}|[0-9a-f]{7,40})$/;
export async function laneDiff({ laneId, base, mode = 'all', path = null, caps = config.review.diff })
  -> { lane, base, mergeBase, head, headSha, source: 'worktree'|'remote', mode,
       totals: {files, add, del}, truncated: bool,
       files: [{ path, oldPath, status: 'M'|'A'|'D'|'R'|'C'|'T', add, del, binary, generated,
                 deferred, truncated, hunks: [{ header, oldStart, oldLines, newStart, newLines,
                   lines: [{ t: '+'|'-'|' '|'\\', o: n|null, n: n|null, s: text }] }] }],
       untracked: [path], untrackedTruncated: bool }
export function parseNumstatZ(buf)     // pure
export function parseUnifiedDiff(text, caps) // pure
```

**Resolving the lane**
1. Use the live lane from `state.snapshot().lanes` (built at `server/collector/lanes.mjs:467`). If there is none, fall back to `store.read(id)` (`store.mjs:47`).
2. Validate the id with `store.isLaneId`.
3. If `rec.root` exists, set `source='worktree'`, `dir=root`, `head='HEAD'`.
4. Otherwise set `source='remote'`, `dir=path.join(config.codeDir, rec.repo)` and `head='origin/<branch>'`. Verify the ref with `rev-parse --verify --quiet`. If it is missing, return 404 `{error:'branch not on origin (not fetched)'}`.
5. **Never fetch.** This follows the read-only rule already stated at `progress.mjs:476-478`.

**Base**
- `base ?? repoCfg.base ?? config.review.base`. It must match `BASE_RE`, otherwise 400.
- Every git call passes `--end-of-options` before refs.
- `mergeBase = git merge-base <base> <head>`.

**Mode**
- `mode='all'` with source `worktree` diffs the working tree against the merge-base (`git diff <mb>`), so uncommitted Stop-state work shows.
- `mode='committed'` diffs `<mb>..HEAD`.
- With source `remote` the mode is always committed.

**Git calls.** All of them use `run()` (`server/util.mjs:4`) with env `{...process.env, GIT_OPTIONAL_LOCKS: '0'}`. This stops `git diff` against the working tree from refreshing the index (and creating `index.lock`) in a worktree an agent is using. Each call also passes `-c core.quotepath=off -c diff.external= --no-ext-diff --no-textconv --no-color -M`.
1. `--numstat -z` gives the file list. `-\t-` means binary: such a file gets `binary:true` and no patch.
2. Choose which files get patches, in numstat order. A file is `deferred:true` when `generated` matches, when the running byte estimate (`(add+del)*avgLine`) would exceed `maxBytes`, or when its index is at or above `maxFiles`. Files beyond `maxFiles` are listed by name only, and `truncated:true` is set.
3. One `git diff -U3 <mb> [head] -- <chosen paths>` with `maxBuffer = maxBytes + 256 KiB`. If the buffer overflows, retry per file.
4. The parser stops a file at `maxFileLines` or `maxFileBytes` and sets `truncated:true` on that file.
5. Lines are kept as decoded UTF-8 text. CR is kept. NUL is replaced with U+FFFD.

**Single-file mode.** `?path=<p>` returns just that file, with the same per-file caps. It is how the UI loads deferred files. `p` must appear in the numstat list; it is never passed to git unchecked.

**Untracked files** (worktree, mode all): `git ls-files --others --exclude-standard -z`, capped at `maxUntracked`. Only the names are listed. Their contents are not diffed in v1.

### 2.3 Builder: transcript tail (`server/review/transcript.mjs`)

```js
export async function tailTranscript({ file, after = null, before = null, limit, maxBytes, textCap })
  -> { size, startOffset, endOffset, reset: bool, entries: [Entry] }
Entry = { off, ts, role: 'user'|'assistant'|'tool_use'|'tool_result'|'system',
          text, tool?: string, isError?: bool, truncated?: bool }
export function entriesFromLine(obj, off, textCap)   // pure; one JSONL line -> 0..n entries
export function summarizeToolInput(name, input)       // pure
export function cleanText(s, cap)                      // strip ANSI (util stripAnsi) + C0 except \n\t, cap
```

**Path.** The client never sends a path. The route takes a session name:
1. `s = state.get(name)`.
2. `file = s.claude.transcriptPath || transcriptPathFor({sessionId, dir})`. The path comes from `state.mjs:345`, and `transcriptPathFor` is at `server/collector/transcripts.mjs:166`.
3. `fs.realpath(file)` must start with `realpath(config.projectsDir) + sep` and end in `.jsonl`. Otherwise 404.

**Reading by offset**
- **Forward** (`after=N`): if `size < N`, return `{reset:true}`, as `transcripts.mjs:132-135` does. Otherwise read `[N, min(size, N+maxBytes))`, keep only whole lines, and set `endOffset` to the byte after the last `\n` consumed.
- **Backward** (`before=N`, default `size`): read 64 KiB chunks ending at N and walk backwards. Drop the leading partial line unless the chunk starts at 0. Stop at `limit` entries or `maxBytes` scanned.
- Each line's `off` is the byte offset of its first byte, so offsets are stable across calls.
- The tail is read independently of the cost tailer's state (`transcripts.mjs:125`). It opens its own file handle and never touches `transcript_offsets`.

**Mapping lines to entries.** Content blocks are one per line, as noted at `transcripts.mjs:7-8`.
- `type:'user'` with a string or text blocks becomes `user`. The rule mirrors `userPromptText` (`transcripts.mjs:62`).
- A `tool_result` block becomes `tool_result`, with text taken from its string or text content and `isError` from `is_error`.
- `type:'assistant'`: a text block becomes `assistant`; a `tool_use` block becomes `tool_use` with `tool=name` and `text=summarizeToolInput`; `thinking` blocks are dropped.
- `type:'summary'` becomes `system`. Every other type is skipped.

`summarizeToolInput`:

| Tool | Summary |
| --- | --- |
| `Bash` | `input.command` |
| `Read`, `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | `file_path` |
| `Grep`, `Glob` | `pattern` (plus `path`) |
| `Task`, `Agent` | `description` |
| `WebFetch` | `url` |
| anything else | the first 3 keys as `k=v` |

Every summary is capped at 300 chars.

The server returns **plain text**. It is made safe at render time: every client rendering uses `textContent`.

### 2.4 Review-ready flag (`server/review/ready.mjs`, pure) and collector (`server/collector/review.mjs`)

```js
export function reviewReadyOf({ lane, sessions, pr, doneMarkers, diffStat, dirtyCount, reviewSentAt, greenSince })
  -> { ready, reasons: ('done-marker'|'pr-green'|'stop-diff')[], since } | null
```

**Not ready (`null`)** when any of these holds:
- `lane.isMain`
- `lane.merged === true`
- `pr.state` is `MERGED` or `CLOSED`
- any session is `working` or `waiting_permission`

**Reasons**
- `done-marker`: the newest undismissed `done` marker for the lane (`db.listMarkers({lane, kinds:['done']})`, `db.mjs:331`) is newer than `reviewSentAt`.
- `pr-green`: `pr.state==='OPEN' && !pr.isDraft && pr.verdict==='green'`. The verdict comes from `collector/pr.mjs:314-327`. `greenSince` is tracked in kv `review.greenSince[lane]`, set the first refresh it is seen green and cleared on non-green.
- `stop-diff`: some session is in state `done` (the Stop hook sets this, `hooks.mjs:31-32`), `diffStat.files + dirtyCount > 0`, and the state started after `reviewSentAt`.

**`since`** is the earliest trigger time: the marker ts, `greenSince`, or the session `stateSince`. It is persisted in kv `review.readySince[lane]` so a restart does not reset the wait timer.

**Collector.** It runs every 60 s, starting 50 s after boot (the other passes start at 5 s, 20 s, 35 s and 45 s; see `pr.mjs:358`). It goes through `lanes.knownWorktrees()` (`lanes.mjs:511`) one lane at a time, skips main checkouts, and runs one `git diff --numstat -z <mb>` (env as in 2.2), with the merge-base cached by `(root, HEAD sha, base sha)`. It keeps `{files, add, del, paths[≤500]}` per lane. `dirtyCount` is taken from `retirer.cached()[id].dirtyFiles.length` (`retire.mjs:95`), so no extra `git status` runs.

**Snapshot additions.** A lane decorator in `server/flags/review.mjs` (`state.addDecorator('review', {lane: (lane) => …})`; the collector is started by that module) adds the fields below. `packages` comes from §6's `packagesFor(repo, diffStat.paths)` (exported by `server/routes/packages.mjs`, P9; when absent, `[]`). Each lane gains:

```js
reviewReady: {ready, reasons, since} | null, reviewSentAt: ms|null,
diffStat: {files, add, del} | null, packages: [name] (§6), costUsd: number  // sum of live sessions' s.cost.usd
```

`reviewSentAt` is kv `review.sentAt[lane]`. The `send-review` action sets it, and so does a PR state change to MERGED.

### 2.5 Review queue (pure, `public/js/core/review-queue.js`)

```js
export function buildReviewQueue(lanes /* fleet store lanes, each with .builder */, now)
  -> [{ fkey, builder, lane, repo, branch, hue, reasons, since, waitMs, pr, checks, diffStat, packages, costUsd,
        sessions: [{ fkey, state }] }]
```

The queue is filtered to `reviewReady?.ready` and sorted by `waitMs` descending, with ties broken by `fkey`. The UI recomputes it from the store on every delta, so builder mode and hub mode share one code path.

The **review-wait metric** is `(reviewSentAt ?? now) - since`. The hub records it in §7 O10's kv `review.waits` (open waits + last 500 closed); `reviewSentAt` counts as a first touch there. Morning and the median wait read O10's stats. This is the hub-owned metric named in the conventions.

### 2.6 Review message (pure, `public/js/core/review-format.js`; the builder imports it from `../../public/js/core/review-format.js`)

```js
export function formatReview({ lane, branch, base, mergeBase, headSha, comments, note }) -> string
// comment: { path, side: 'new'|'old', line, endLine?, quote: string[] (<=12 lines, each <=200 chars), body (<=2000) }
export function pullCommands({ repo, branch, laneId, pr, ciRepo }) -> [{ label, cmd }]
export function shq(s)  // POSIX single-quote, same rule as actions.shellQuote (actions.mjs:30)
```

The review text looks like this:

```
REVIEW of feat/x (origin/main @ ab12cd3 .. ef45678), 3 comments.
Address each comment, commit, then print DONE: or NEED-HUMAN:.

1. src/a.js:42-44
   > const x = y;
   Rename x; it shadows the import.
...
```

Comments are sorted by path, then line. Each part of a comment is cleaned before it goes in:
- the body has control characters stripped and CR→LF;
- quotes get the same cleaning, and backticks are kept;
- file paths are validated against the lane's diff file list.

`pullCommands` returns:
1. `git fetch origin <b> && git worktree add --track -b <b> ../<repo>-<lane> origin/<b>`, or `git worktree add ../<repo>-<lane> <b>` when the branch is local.
2. `gh pr checkout <N> --repo <owner/name>`, when there is a PR.

Values are passed through `shq`, and **every** input is validated client-side before any command is shown (security review S11): `branch` matches `launch.mjs`'s `BRANCH_RE`, contains no `..` and does not start with `-`; `repo` matches `^[A-Za-z0-9._-]{1,100}$`; `laneId` passes `isLaneId`; `pr` is a positive integer; `ciRepo` matches `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`. If any check fails, no command is shown. Test with `--upload-pack=x` and `$(id)`.

### 2.7 Actions added to the envelope

These two entries are in §2's allowlist (tier `ask`, target lane, rate limit 5/min/user); `send-review` is registered by `server/routes/review.mjs`, `run-script` by `server/routes/scripts.mjs`.

**`send-review`**
- Args: `{ review: {base, mergeBase, headSha, comments[≤100], note?} }`. Target is the lane id. The text goes to the lane's session (`rec.session || id`).
- `server/review/actions.mjs` handles it:
  1. Check the session's readiness with `state.promptReadiness(capturePane)`, the same check as `actions.mjs:183`. If the pane is on a permission or trust dialog, refuse with 409 *"session is on a prompt; answer it first"*. `working` is allowed, because Claude Code queues typed input.
  2. Build the text with `formatReview`.
  3. If it is no longer than `inlineMaxChars`, send it with `actions.sendText(name, text, true, who)` (`actions.mjs:77`).
  4. Otherwise write it to `config.lanesDir/<id>/reviews/<ts>.md` with mode 0600 (outside the worktree, per `store.mjs:1-3`) and send: *"REVIEW with N comments is in <abs path>. Read it fully, address each comment, commit, then print DONE:."*
  5. Set `review.sentAt[lane]`.
  6. Return `{ok, inline: bool, file?}`.
- It is audited with `argsHash` over the formatted text.

**`run-script`**
- Args: `{ script: name, stop?: bool }`. Target is the lane id. The flow is in 2.8.

Peek's reply box and quick buttons use the existing `send-text`, `send-keys` and `interrupt` actions. The `send-review` readiness check is applied to `send-text` from the peek box too, through a flag `args.guardPrompt: true` (implemented in §2 A6's built-in `send-text`). When that flag is set, `send-text` refuses 409 `prompting` if the pane shows a numbered permission menu or the state is a prompt, because typing would answer it, as with the trust dialog at `actions.mjs:184-187`.

### 2.8 Run scripts (`server/review/scripts.mjs`)

```js
export function resolveScript(rec, name, repos = config.repos) -> { cmd, root, repo } | throws ActionError
export async function runScript(laneId, name, who) -> { ok, window: 'run-<name>', windowIndex, alreadyRunning }
export async function stopScript(laneId, name, who)
```

`runScript` does this:
1. Resolve `rec` and `repoCfg`. The command must be `repoCfg.scripts[name]`. Anything else returns 404, so no command text ever comes from the request.
2. The tmux session is `rec.session || rec.id` and must be alive.
3. If a window named `run-<name>` exists and its pane is not dead, return `alreadyRunning`.
4. Otherwise run one tmux invocation, chained as `terminals.mjs:174-178` does:
   ```
   tmux new-window -d -P -F '#{window_index}' -t =<sess>: -n run-<name> -c <root> -- sh -c '<cmd>; echo; echo "[<name> exited $?]"'
     ; set-option -w -t =<sess>:run-<name> remain-on-exit on
   ```
   `-d` keeps the agent's window current.
5. Environment: the lane's slot exports are prefixed with the same mechanism `actions.spawn` uses for `slot` (`actions.mjs:102-107`). The result is then checked with `checkLaneEnv` (`launch.mjs:75`): a forbidden port refuses the run.

`stopScript` kills only a window whose name matches `^run-[a-z0-9-]{1,24}$` in that session.

**Inventory fix.** `tmux.inventory()` picks `mainPane = panes.find(p => p.active)` (`server/collector/tmux.mjs:101`). With a second window, every window has an active pane. The fix is to choose the active pane of the lowest `windowIndex` that is not a `run-*` window. This needs `#{window_name}` added to `P_FMT` (`tmux.mjs:34-38`).

**Viewing.** `terminals.attach` and §2's `attachNamed` (used by `/api/v1/term/:name`) accept `?window=run-<name>`, validated with the same regex. It appends `';', 'select-window', '-t', `${groupName}:run-<name>`` to the spawn chain (`terminals.mjs:174-178`). Grouped sessions keep independent current windows, so the owner's view does not change. The hub term proxy (§3) passes the `window` query through.

### 2.9 Archive (`server/lanes/archive.mjs`, `db.mjs` migration)

The migration is appended to `MIGRATIONS` (`db.mjs:17-128`, append-only; R9 runs after §1 F7's builder-column migration and §6 P9's `ci_jobs`):

```sql
CREATE TABLE IF NOT EXISTS lane_archive (
  lane TEXT PRIMARY KEY, repo TEXT, branch TEXT, plan_path TEXT, plan_title TEXT, plan_head TEXT,
  created_at INTEGER, retired_at INTEGER NOT NULL, duration_ms INTEGER,
  cost_usd REAL, tokens INTEGER, stage_n INTEGER, stage_m INTEGER,
  pr_number INTEGER, pr_url TEXT, pr_state TEXT, merged INTEGER,
  markers TEXT, summary TEXT, record TEXT, restored_as TEXT)
CREATE INDEX IF NOT EXISTS lane_archive_retired ON lane_archive(retired_at DESC)
```

The new `db.mjs` functions are `addArchive(row)` (upsert), `listArchive({q, limit=50, before})`, `getArchive(lane)`, `laneCostAllTime(lane, sessionNames)` and `setRestoredAs(lane, newId)`.

- **Search.** `listArchive` searches with `LIKE` (escaped `%_`) over lane, branch, repo, plan_title and summary.
- **Cost.** `laneCostAllTime` sums `MAX(usd)` per session over `cost_snapshots` where `lane = ? OR session_name IN (...)`. Snapshots are cumulative, as described at `morning.mjs:42`.

**Writing the archive from retire.** `retire.retire()` (`retire.mjs:148`) calls the archive module in two steps:
1. After the validate step, it calls `const snap = await archive.capture(rec)`, **before** the worktree is removed. `capture` collects:
   - the plan's title and its first 64 KiB (read from `rec.root`);
   - `progress.get(id)` for n/m;
   - `prs.get(id)`, or the newest row of `db.listPrSamples`;
   - the last 50 markers, including dismissed ones (`listMarkers({lane, includeDismissed:true})`);
   - the summary, which is the newest `done` marker text;
   - the merged fact.
2. After `store.write({...rec, retiredAt})`, it calls `archive.commit(snap, retiredAt)`.

A retire that fails writes no row. `archive.backfill()` runs once at startup and creates rows for any `store.readAll()` record that has `retiredAt` but no row, with whatever survives.

Archive rows are never pruned. `pruneOldRows` (`db.mjs:276`) is left alone; the archive keeps its own copy of the markers, so it outlives marker retention.

**Archive merged lanes.** The UI offers the existing `retire` action on lanes whose readiness says ready and merged (`retire.judge`, `retire.mjs:35`). "Archive all merged" is a client loop of separate `retire` envelopes (each with `args.confirm = laneId`, tier `confirm`), after a single typed confirm sheet that lists every lane and requires `RETIRE <n>` (§4's fan-out form).

**Restore** is done with `launch`:
1. The hub sends `{lane: '<id>-r<N>', repo, branch, plan, model, permissionMode, restoredFrom: '<id>'}` to the **source builder** by default; choosing another builder shows a "from builder X data" warning plus the plan text in the sheet (the plan and branch were written by X's agent). A new id is needed because `validate` refuses retired ids (`launch.mjs:169-172`). N is the first free number.
2. `launch.mjs` adds `restoredFrom` to the record (`launch.mjs:233-236`) and to the kickoff vars, as `{restoredFrom}`, available to templates.
3. After a successful launch the builder calls `setRestoredAs`.
4. The worktree comes from the local branch, or from `origin/<branch>` (`launch.mjs:288-291`). If neither exists the launch fails at its `worktree` step. Validate gets a pre-check for this, so the refusal is immediate: `rev-parse --verify refs/heads/<b>` or `refs/remotes/origin/<b>`.

### 2.10 Endpoints

**Builder** (all reads are signed by the hub or come in directly; §2):

| Method + path | Returns |
| --- | --- |
| `GET /api/v1/lanes/:id/diff?base=&mode=&path=` | `laneDiff` |
| `GET /api/v1/sessions/:name/transcript?after=\|before=&limit=` | `tailTranscript` |
| `GET /api/v1/sessions/:name/preview?n=` | `{name, lines}` (raw ANSI lines; **no `html`** on v1) |
| `GET /api/v1/morning?window=` | `morning.build()` plus `builder`; finished[] and cost.lanes[] gain `packages`, `reviewReady`, `reviewSentAt` |
| `GET /api/v1/archive?q=&limit=&before=` | `{rows}` |
| `GET /api/v1/archive/:lane` | one row (`markers` parsed, `plan_head` included) |

These are registered by the modules `server/routes/review.mjs` (diff, transcript, preview, morning; capabilities `review`, `morning`) and `server/routes/archive.mjs` (archive), loaded by X1's `loadModules('routes')`.

**Hub.** Reads go through §3 H12's signed read proxy `GET /api/fleet/:builder/v1/<path>`, whose fixed allowlist already contains `lanes/:id/diff`, `sessions/:name/transcript`, `sessions/:name/preview`, `morning`, `archive`, `archive/:lane`.
- The proxy enforces a response cap (4 MiB) and checks that the response parses as JSON.
- `GET /api/fleet/archive?q=` fans out to every builder that is not `down`, merges by `retired_at` desc, and tags each row with `builder`.
- `GET /api/fleet/morning?window=&b=` returns `server/hub/morning.mjs: mergeMorning()`. Both routes are in the hub module `server/hub/routes/review.mjs`.

### 2.11 Fleet morning (`server/hub/morning.mjs`, pure merge)

```js
export function mergeMorning({ perBuilder /* Map id -> build()|{error} */, waits /* §7 O10 stats */, stuck /* §7 alarm history */, audit /* hub audit */, deferred /* §7 O9 digest */, window, since, now })
  -> { window, since, now, builders: [{ id, code, error?, needsYou, finished, cost }],
       review: { waiting: n, medianWaitMs, p90WaitMs, longest: [{fkey, waitMs}] },
       stuck: [{ fkey, reason, since, resolvedAt }],            // from §7's hub log
       approvals: { answered, approved, denied, medianAnswerMs }, // hub audit entries action approve|deny in window
       costByPackage: [{ package, usd, lanes }], totalUsd,
       missing: [builderId], deferred: [...] }   // §7 7.3.8 requirements: every name/lane is an fkey with `builder`
// needsYou/finished are concatenated and re-sorted with morning.mjs's comparators (morning.mjs:170, :216-221)
```

**Cost per package.** Each lane's window spend is split **equally** across the packages it touched, so the package totals add up to `totalUsd`. A lane with no packages goes to the `(none)` bucket.

**Ordering.** Builders are ordered by needs-you count, then id. A builder in error appears as a row with its error. It is never dropped silently.

### 2.12 UI modules

- **`public/js/views/diff.js`** (opened as `#/diff?sel=<fkey>&base=`, or as an inspector "DIFF" tab)
  - Layout: the file list on the left (status shape, `+a −d`, binary/generated/deferred markers) and the unified diff on the right. Rendering is lazy per file: an IntersectionObserver renders a file's hunks when it nears the viewport, and files over 1000 lines start collapsed.
  - Selecting lines: click a line number to select it, shift-click for a range, then press `c` or the comment button. An inline editor appears below the range.
  - Drafts are kept in `localStorage` under `lb.review.<fkey>.<headSha>`, inside try/catch.
  - The header shows the draft count. "Send review (N)" opens a sheet with the exact `formatReview` text. Only the sheet's Send button issues `send-review`. Nothing is ever sent automatically.
  - If `headSha` changes while drafts exist, a banner says "branch moved; comments may be stale". Their anchors are kept.
  - The header also carries a "Pull" popover with the `pullCommands` output and copy buttons.
- **`public/js/core/hl.js`**: no dependency. It is a per-line tokenizer with a language picked from the extension (js/ts/mjs/json, py, sh, go/rs/c-like, css, yaml, md fallback = none). Tokens are `comment`, `string`, `number` and `keyword`. Its regexes are linear (no nested quantifiers) and lines over 2000 chars are left unhighlighted. It returns `[{k, s}]`, which the view turns into `<span class="hl-k">` with `textContent`.
  - Why not a vendored highlighter: highlight.js or Prism grammars add 30 KB to 1 MB, and their backtracking regexes run over untrusted builder text (ReDoS in the operator's browser). Colour is also secondary in the industrial design (only abnormal gets colour), so muted greys plus one keyword tone are enough.
- **`public/js/views/peek.js`**: the inspector tab "PEEK", registered with §4's `registerTab` in `ui/inspector.js`.
  - Top: the pane tail (last 40 lines from `/api/v1/sessions/:name/preview`, or `/api/fleet/:builder/v1/sessions/:name/preview` on the hub, polled every 2 s while visible), rendered by §1 F6's `core/ansi.js` (`ansiLineToNodes`), which turns SGR into spans with `textContent`.
  - Middle: the transcript tail. It polls `after=endOffset` every 3 s, and "older" fetches `before=startOffset`. Rows come from the pure `core/transcript-rows.js` (`rowsFor(entries) -> [{cls, label, text}]`).
  - Bottom: the reply box (`send-text` with `guardPrompt`), and quick buttons that reuse the `QUICK_KEYS` semantics from `app.js:1752-1758`:
    - `continue` sends the text `continue`;
    - `/compact` sends the text `/compact`;
    - `Esc` sends the `interrupt` action, or `send-keys Escape`.
  - "Open terminal" calls `openTerminal()` from `public/js/ui/terminal.js` (was `public/terminal.js:63`) with `source.termUrl(fkey)` (§1 F8a: builder or hub proxy path). Script windows add `?window=run-<name>` (§3 H9 passes it through).
  - A "Scripts" row shows one button per configured script, taken from the builder's `hello.scripts` (`{repo: [names]}`, names only). Each button needs an `ask` confirm sheet (§4 `confirmAction`) that shows the exact command and the worktree before it sends `run-script`.
- **`public/js/views/review-queue.js`**: `renderReviewQueue(container, items, ctx)`, imported by §8's Inbox (C13) to render its Review group.
  - Each row shows the wait timer (ticking from `since`), builder code, lane, PR chip with checks `✓p ✗f …n`, diff stat, package chips (§6), cost, and reason icons.
  - Actions: Diff, Peek, Pull, and Archive (only when merged).
- **`public/js/views/archive.js`**: the Board filter `#/board?s=archive&q=` (it reuses the `s` param from the conventions). It shows a searchable table: lane, builder, repo, branch, retired, duration, cost, PR, stages n/m, summary. Expanding a row shows its markers and plan head. Restore opens the launch sheet prefilled.
- **`public/js/views/morning.js` additions**:
  - builder group headers;
  - a "Review wait" block with the median, p90 and longest list;
  - "Stuck incidents";
  - "Approvals answered";
  - a "Cost by package" table.

  Data comes from `/api/fleet/morning` in hub mode and from `/api/v1/morning` in builder mode (the view wraps it as `{builders:[{id, code, ...data}]}` with empty review/stuck/approvals blocks).

No module in this section uses `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. §1 F6's `test/frontend-safety.test.mjs` enforces this for all of `public/js/**`.

## 3. Implementation tasks (dependency order)

| # | Task | Files owned | Done when |
|---|------|-------------|-----------|
| R1 (T10.1) | Config fragment `review` (incl. `overdueHours`), `transcript`, `repos[].base`, `repos[].scripts` validation. Deps X1 | `server/config/review.mjs`, `test/config-review.test.mjs` | Bad script names, newline in a command and >12 scripts are rejected; defaults present; `npm test` green |
| R2 (T10.2) | `server/review/diff.mjs` (resolve, numstat, patch, caps, single-file). Deps R1 | `server/review/diff.mjs`, `test/diff.test.mjs` | Tests in §4 pass |
| R3 (T10.3) | `public/js/core/review-format.js` (`formatReview`, `pullCommands`, `shq`). Deps F1 | that file, `test/review-format.test.mjs` | Snapshot of formatted text; quoting of `'` and `$()` in branch/body; branch with `;` rejected; `branch:'--upload-pack=x'`, `branch:'-x'`, `branch:'a..b'`, `repo:'$(id)'`, `laneId:'../x'`, `pr:'1;id'`, `pr:0`, `ciRepo:'a/b c'` each yield **no** command at all |
| R4 (T10.4) | `server/review/transcript.mjs` + fixture. Deps R1 | that file, `test/transcript.test.mjs`, `test/fixtures/transcript/*.jsonl` | Tests in §4 pass |
| R5 (T10.5) | `server/review/ready.mjs` + `server/collector/review.mjs` + lane decorator module. Deps R1, X1 | `server/review/ready.mjs`, `server/collector/review.mjs`, `server/flags/review.mjs`, `test/review-ready.test.mjs` | ready-rule cases pass; `/api/state` lanes carry `reviewReady`, `diffStat` |
| R6 (T10.6) | `public/js/core/review-queue.js`. Deps F1 | that file, `test/review-queue.test.mjs` | Sort and wait cases pass |
| R7 (T10.7) | Builder route module (diff, transcript, preview, morning) + `send-review` handler. Deps R2, R3, R4, A6, F9 | `server/routes/review.mjs`, `server/review/actions.mjs`, `server/morning.mjs` (optional `builder` echo + `packages`/`reviewReady`/`reviewSentAt` fields only), `test/review-routes.test.mjs` | `curl` against a dev builder returns diff/transcript/preview/morning JSON; `send-review` inline vs file path tested with tmux stubbed. REVIEW-REQUIRED (SR20) |
| R8 (T10.8) | Run scripts + terminal `window` param + mainPane fix + module. Deps A7, A6, R1, F9 | `server/review/scripts.mjs`, `server/terminals.mjs` (`attach`/`attachNamed`/`attachTerminal` arg list only), `server/collector/tmux.mjs` (`P_FMT`, `inventory` mainPane), `server/routes/scripts.mjs`, `test/scripts.test.mjs` | Tests in §4 pass; `terminals.test.mjs`, `state.test.mjs` still green; `run-script` with a name not in `repos[].scripts` → 400 and nothing spawned; a `window` not matching `^run-[a-z0-9-]{1,24}$` → 400. REVIEW-REQUIRED (SR20) |
| R9 (T10.9) | Archive table, capture/commit, backfill, restore plumbing, archive routes. Deps F7, P9, C12, C7 | `server/db.mjs` (append migration and functions at the end), `server/lanes/archive.mjs`, `server/lanes/retire.mjs` (two call sites), `server/lanes/launch.mjs` (`restoredFrom` field + branch pre-check), `server/routes/archive.mjs`, `test/archive.test.mjs` | Retire writes a row with cost/markers; a failed retire writes none; backfill idempotent; `retire.test.mjs`, `launch.test.mjs` green |
| R10 (T10.10) | Hub: `/api/fleet/archive`, `/api/fleet/morning`, `server/hub/morning.mjs`. Deps H12, R7, R9, O8, O10 | `server/hub/morning.mjs`, `server/hub/routes/review.mjs`, `test/hub-morning.test.mjs` | Merge tests pass; equal-split package totals sum to `totalUsd`; a builder timing out is listed in `missing` |
| R11 (T10.11) | Diff view + highlighter + CSS. Deps D4, R3 | `public/js/views/diff.js` (replaces D4's stub), `public/js/core/hl.js`, `public/css/views/diff.css`, `test/hl.test.mjs` | `hl.test` (token output; 2001-char line untokenized; adversarial `'"'.repeat(1e5)` finishes < 50 ms) |
| R12 (T10.12) | Peek tab + transcript rows. Deps D6, R4 | `public/js/views/peek.js`, `public/js/core/transcript-rows.js`, `test/transcript-rows.test.mjs` | Rows tests pass; the tab mounts in the inspector (manual check) |
| R13 (T10.13) | Review queue renderer. Deps R6, D3 | `public/js/views/review-queue.js`, `test/view-review-queue.test.mjs` | Renders a fixture queue in the fake DOM; one row per item, wait timer text present |
| R14 (T10.14) | Archive view + restore sheet. Deps D4, R9 | `public/js/views/archive.js`, `test/view-archive.test.mjs` | Search, expand and restore prefill work against a fixture; the restore sheet preselects the archive row's source builder; choosing another builder shows the "from builder X data" warning and the full plan text before the send button is enabled; manual check against the dev builder |
| R15 (T10.15) | Morning view fleet blocks. Deps R10, D4, F8b | `public/js/views/morning.js`, `test/view-morning.test.mjs` | Renders grouped data from the merge fixture |
| (T10.16) | Phase 2, off, **not scheduled tonight**: post review to the GitHub PR (`server/review/github.mjs`, gated by `review.postToGitHub`) | — | — |
| (T10.17) | Covered by §1 F6 `test/frontend-safety.test.mjs` | — | — |

## 4. Tests

- **`test/diff.test.mjs`**
  - Setup: a temp bare remote plus a clone made with `git init` and `-c user.name=t`. The main checkout is named `acme`, and there is a worktree `acme-lane1` on `feat/lane1`. `config.codeDir` and `lanesDir` point at the temp dir, with a `lane.json`.
  - Content and parsing:
    - a modified file shows `M` with the right add/del;
    - `R` shows for a rename;
    - a PNG blob gives `binary:true` with no hunks;
    - a file over `maxFileLines` is `truncated:true`;
    - with `maxFiles=2` and 3 changed files, the third is `deferred:true` and `truncated:true`;
    - a generated `package-lock.json` is deferred, and `?path=package-lock.json` returns its hunks;
    - an uncommitted edit appears in mode `all` and not in mode `committed`;
    - untracked files are listed by name.
  - Remote fallback: delete the worktree dir and the diff comes from `acme` against `origin/feat/lane1`. Delete the remote branch and the result is 404.
  - Input checks: `base='--output=/tmp/x'`, `base='origin/main;rm'` and `path='../etc/passwd'` are all rejected.
  - No writes: no `index.lock` exists after the run, and mtime of `.git/worktrees/*/index` is unchanged.
  - Pure tests: `parseUnifiedDiff` over a fixture with a `\ No newline` line and CRLF.
- **`test/transcript.test.mjs`**
  - Fixture JSONL with:
    - user string;
    - user text blocks;
    - tool_result (error);
    - assistant text containing `<img src=x onerror=alert(1)>` and `\x1b[31mred\x1b[0m`;
    - tool_use Bash;
    - a thinking block;
    - a summary;
    - a malformed line;
    - a trailing partial line without `\n`.
  - Assertions:
    - backward tail with `limit=3` returns the last 3 entries, with offsets equal to the real byte positions (multi-byte UTF-8 in one line);
    - `before=startOffset` returns the previous page with no overlap or gap;
    - `after=endOffset` after appending two lines returns exactly them, and the partial line is excluded until completed;
    - truncating the file returns `reset:true`;
    - ANSI is stripped but `<img` stays literal (escaping is the renderer's job, and `transcript-rows` returns text only);
    - thinking is dropped;
    - text is capped with `truncated:true`;
    - a symlink or path outside `projectsDir` gives 404 (route-level helper `resolveTranscriptFile`).
- **`test/review-queue.test.mjs`**
  - `reviewReadyOf` cases: done marker newer than sentAt is ready; done marker older is not; PR green but draft is not; stop-diff with 0 files is not; any `working` session is not; merged, `isMain` and closed PR are not; `since` is the min of the triggers.
  - `buildReviewQueue`: sorts by wait desc across two builders, ties by fkey, and uses `waitMs = now - since` when `reviewSentAt` is null.
- **`test/review-format.test.mjs`**: format snapshot, sort order, quote capping, and `pullCommands` quoting.
- **`test/scripts.test.mjs`**
  - `resolveScript` refuses unknown names and uses only config.
  - With a stubbed `run`, the exact tmux argv: `-d`, `-c root`, `remain-on-exit`, and `=sess` targets via `exactTarget`.
  - `stopScript` refuses non-`run-*` windows.
  - `inventory` mainPane ignores the `run-*` window.
  - `terminals.attach` rejects `window=run-;x`.
- **`test/archive.test.mjs`**: capture and commit with an in-memory db and a temp lane; cost sums the max per session; markers include dismissed ones; backfill does not duplicate; `listArchive` LIKE escaping (`q='%'` matches literally).
- **`test/hub-morning.test.mjs`**: two builders, one in error; equal-split cost; approvals counted from audit fixtures; the stuck list passes through.
- **`test/hl.test.mjs`**, **`test/transcript-rows.test.mjs`**, **`test/views-safety.test.mjs`**: as in T10.11, T10.12 and T10.17.

## 5. Risks, open questions, human verification

- **Typing into a busy TUI.** `send-review` and peek replies could land on a permission menu, so they are guarded by `promptReadiness` plus `guardPrompt`. There is still a race between capture and send. The file-based review keeps the typed part to one short line, which limits the damage.
- **Reading the review file.** The file is outside the worktree, so in `auto` permission mode Claude Code may ask for permission to read it. That prompt then shows up as an approval, which is acceptable. *Open:* write it under the worktree's `.git/` dir instead? (That is invisible to `git status`, but it is inside the agent's sandbox.) The default is `lanesDir`.
- **The command-execution surface.** Commands come only from builder config and never from the wire. The worst a hub compromise can do is run an already-configured script. This is documented in the README.
- **Diff cost.** `git diff` on a huge worktree can take seconds. It has a timeout of 15 s and runs at most one at a time per builder (a module-level gate like `launch.mjs:221`), with a 429 if one is already running.
- **Transcript privacy.** Transcripts may contain secrets the agent read. Peek shows only what the operator could already see in the terminal. The hub does not persist transcript responses.
- **Equal-split package cost** is an approximation. It is labelled "≈" in the UI.
- **Archive cost.** Rows older than the v2 lane column miss session-only attribution if the session name changed. This is acceptable.
- HUMAN: on a real builder, run a script window while a browser terminal is attached and confirm the owner's window stays on the agent and the card preview still shows Claude.
- HUMAN: send a 20-comment review, check that Claude reads the file and addresses the comments, and check the review-wait timer resets.
- HUMAN: restore an archived merged lane whose branch was deleted on origin; it should be refused quickly with a clear message.
- HUMAN: check that the diff view stays responsive on a 5,000-line diff on a phone.

## 6. Dependencies on other sections

- **§3** (hub term proxy H9 passes `window`; read proxy H12; fleet store lanes with `.builder`); §1 F8a `source.termUrl`.
- **§6** (packages): `packagesFor(repo, paths)` (P9) for the lane `packages` field and for cost by package.
- **§8** (Inbox C13): renders the Review group with `renderReviewQueue`; row actions use `navigate`.
- **§7**: O10 review-wait store (`review.waits`), O8 alarm history for stuck incidents, O9 deferred digest.
- **§2**: allowlist `send-review`, `run-script` (tier `ask`), the `guardPrompt` flag on `send-text`, `addCapability`/`addHelloField`.
- **§8**: `approve`/`deny`/`release` audit entries with request ts, for the answer time.
- **§4**: `ui/inspector.js` `registerTab`, `confirmAction`, `core/router.js` (hidden `diff` view, `s=archive`), and design tokens for diff colours (grey baseline; add/del use muted status hues).
- **§11 X1**: route/flag modules, config fragments.

## 7. PRIVATE (homelab repo)

Private details: homelab repo.
