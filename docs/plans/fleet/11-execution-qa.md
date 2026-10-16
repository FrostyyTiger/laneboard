# 11. Overnight execution model and QA

**Integration notes (integrator):**
- Boot layout follows the coordinator decision: `server/index.mjs` dispatcher → `server/boot/builder.mjs` (today's `index.mjs` moved verbatim) or `server/boot/hub.mjs` (stub), shared `server/boot/common.mjs`; replaces `server/builder.mjs`/`server/hub/main.mjs` below. X1 (= w0-split) also creates `server/version.mjs` and keeps §11's `server/modules.mjs`, `server/routes/*.mjs`, `server/hub/routes/*.mjs`, `server/flags/*.mjs` and `server/config/<area>.mjs` fragment mechanism.
- X1 ships only `server/config/mode.mjs` (`mode`, `"both"` rejected); `fleet.id/code/allowedOrigins` are §1 F4's `server/config/fleet.mjs`, `fleet.hubKeys` etc. §2 A5's `server/config/fleet-auth.mjs`, `fleet.builders` etc. §3 H1's `server/config/hub.mjs`. Fragments may also export `finalize(c)` (run after merge, e.g. `fleet.code ||= deriveCode(id)`).
- State hooks in X1: `state.addDecorator(name, {session?, lane?})`, `state.addSnapshotKey(name, fn)`, `state.onTick(fn)`, and `attentionScore` reading the decorated `awaitingApproval` (treated as `waiting_permission`) and `stuck` (+40 unless waiting). Decorators run before attention is computed.
- Wave 0 is X1 → F3 (= w0-keys) → F4 → A1 → F1 → X2 (= w0-testkit, which also absorbs §3 H5 fake builder and H2's "hub loads no collector" assertion). `test/tools/demo-fleet.mjs` moves to X5 (s11-qa) because it needs a working hub.
- Concurrency: 8 agents by default, **9 at most** (coordinator), never 15. The wave table below is superseded by the computed waves in README.md (the dispatch rule "DAG, not barriers" stays).
- Task naming: the global DAG id plus a slug, lowercased, is the branch/worktree/tmux id (`x1-boot-split`, `a4-auth`, `h11-hub-wiring`), matching `[a-z0-9-]{3,20}`.
- Ownership table: `public/app.js` no longer exists after F1 (it is `public/js/app.js`); §4 D4 creates the view registry and stubs only for views F1 did not create (`inbox`, `packages`, `audit`, `diff`). `test/fixtures/snapshot.json` has one sanctioned edit (§1 F6, `previewLines`). `test/frontend-static.test.mjs` is owned by §4 D4.
- e2e is X3 (`s11-e2e`), docs integration X4 (`s11-docs`), final QA X5 (`s11-qa`). Hub boot tests use one dummy builder and a free `fleet.ingressPort` (H1 rejects a hub with no builders or no ingress port).
- Private details moved to `private/11-private.md`.
- **Security fixes pass (see `SECURITY-FIXES.md`):** new §8b "Security review tasks and handoff" (SR1-SR20, X6; README 4.5); DoD item 8; X2's boot helper gains `ingressFetch()` (serve-like headers on the ingress listener) because hub actions are `direct`-only; the fake builder accepts scoped `hubKeys`; X5's demo uses a header-adding forwarder instead of any auth bypass.

Section numbers used below: §1 foundations, §2 builder API/auth, §3 hub, §4 design shell, §5 fleet map,
§6 packages/CI, §7 observability, §8 control, §9 homelab room, §10 workflow/review. If the assembled plan
numbers them differently, the coordinator remaps; the rules stay the same.

## 1. Goal and scope

**In:** how sections 1-10 get built in one unattended night by parallel agents on this builder VM: branches,
worktrees, waves, concurrency, file ownership, the task card, the merge loop, QA without a browser, the
night's definition of done, the morning handoff, and the risk rules.
**Out:** merging to `main` (the human does that), any change to the live laneboard service, CI changes,
releases or tags.

### Baseline, measured 2026-10-15 on `main` @ `9b2b7cc`
- `npm test`: **424 tests, 424 pass, 0 fail, 27 files, 0.57 s wall** (`duration_ms 480`), peak RSS of the
  biggest test process **148 MB** (`/usr/bin/time -v`). The full suite costs nothing, so every agent
  runs it in full. The CLAUDE.md rule "targeted tests here, full suite on ci" is about the heavy Python
  suites, not this one.
- Host: `nproc` = **10**, 15 GiB RAM (14 available while idle), 8 GiB swap, 131 GB free disk, Node v24.22.0.
  CLAUDE.md says 6 vCPU, but the machine reports 10. Plan for 6 anyway.
- One Claude Code process: **~560 MB RSS**. That is the real memory cost per agent, not the tests.
- The live laneboard is a `systemd --user` service running **from the main checkout `~/code/laneboard`**
  on `127.0.0.1:7777`, with cwd at that checkout. **Nobody checks out another branch in `~/code/laneboard`
  tonight.** It stays on `main` and keeps serving. It is also the night's dashboard: every agent worktree
  `~/code/laneboard-<task-id>` shows up on it as lane `<task-id>` (lane id = worktree basename minus the
  main checkout name, `server/collector/lanes.mjs:3-8`).
- `gh auth status` reports "not logged into any GitHub hosts". Pushing over git ssh works (`origin` is an
  ssh remote). PRs cannot be opened from this host.
- CI (`.github/workflows/test.yml`) only triggers on `push` to `main` and on `pull_request`. Pushing
  `fleet/*` branches starts no CI, so the night adds nothing to the runner queue.
- Headless browser: `chromium`, `chromium-browser`, `google-chrome` and `firefox` are all absent. No
  `~/.cache/ms-playwright`. `npx --no-install playwright` fails: the package is not installed.

## 2. Branching and worktree model

```
main ─┬─ fleet/main  (integration; only the coordinator commits/merges here)
      │     ├─ merge --no-ff fleet/w0-split
      │     ├─ merge --no-ff fleet/s2-hello …
      └─ fleet/<task-id>  (one per task, branched from fleet/main at dispatch time)
```

- **Coordinator worktree:** `git -C ~/code/laneboard worktree add ~/code/laneboard-fleet -b fleet/main main`.
  The coordinator merges, tests and pushes only here.
- **Task worktree:** `git -C ~/code/laneboard worktree add ~/code/laneboard-<id> -b fleet/<id> fleet/main`.
  One agent per worktree, and never two agents in one checkout.
- **node_modules:** `ln -s ~/code/laneboard/node_modules ~/code/laneboard-<id>/node_modules`. Without the
  link every worktree would run `npm ci` and recompile node-pty in C++. ESM resolution follows the link,
  and so does `/vendor/` serving (`server/http.mjs:94`). `.gitignore` reads `node_modules/` with a trailing
  slash, which does **not** match a symlink. So coordinator setup appends `node_modules`, `docs/plans/` and
  `docs/status/` to `~/code/laneboard/.git/info/exclude` (the common dir, so every worktree shares it).
  Task w0-split also changes `.gitignore` to `node_modules` without the slash.
- **Task id:** `w0-<slug>` or `s<section>-<slug>`, matching `[a-z0-9-]{3,20}`. That makes it a legal tmux
  session name, `lb-<id>`. The lane id on the board is `<id>`.
- **Agent rhythm:** commit at every stage. At every checkpoint run `git push -u origin fleet/<id>` (with
  `--force-with-lease` after a rebase, and only on its own branch). Before declaring done, run
  `git fetch . fleet/main:fleet/main 2>/dev/null; git rebase fleet/main`. The branches are local and shared
  through the common dir, so no network fetch is needed. Then re-run the done-when commands.
- **Coordinator merge** (strictly in dependency order, one at a time):
  ```bash
  cd ~/code/laneboard-fleet
  ~/fleet-night/bin/ownership-check <id>            # diff names ⊆ card's owned globs, else bounce
  git merge --no-ff fleet/<id> -m "Merge fleet/<id>: <title>"   || { git merge --abort; bounce <id> rebase; }
  flock -w 600 /tmp/laneboard-test.lock npm test     || { git reset --hard ORIG_HEAD; bounce <id> red; }
  ~/fleet-night/bin/smoke                             || { git reset --hard ORIG_HEAD; bounce <id> smoke; }
  git push origin fleet/main                          # checkpoint, every merge
  ```
  Use merge, never squash, so each task stays visible in the history. `ORIG_HEAD` reset only applies before
  the push. Once a merge is pushed, the only undo is `git revert -m 1 <merge>`, which is pushed in turn.
  **fleet/main is never force-pushed.** Nothing touches `main` tonight.
- **PR:** after the final merge the coordinator writes `~/fleet-night/PR.md` (body, below). If
  `gh auth status` succeeds by then, it runs `gh pr create --base main --head fleet/main --title "Fleet:
  hub, builder API v1, industrial shell" --body-file ~/fleet-night/PR.md --draft`. Otherwise
  `HUMAN: open the PR` from the compare URL written in the summary.

## 3. Waves and concurrency

**Concurrency: 8 agents by default, 9 at most (coordinator decision), never 15.** The arithmetic: 8 × (560 MB Claude + ~150 MB
in tests and children) ≈ 5.7 GB. Add the live laneboard (92 MB), the coordinator (~600 MB) and tmux
overhead, and that is about 7 GB of 14 GB available, which leaves room for test bursts and the page cache.
At 15 agents it reaches about 11 GB before any `node --test` bursts, so the VM would swap. On 6 vCPU, eight
agents mostly waiting on the model is fine, while fifteen running test bursts at once would cause timing
flakes. The tighter limit is likely the model quota, not RAM (see the risk register).

**Test semaphore: yes, for the full suite only.** `flock -w 600 /tmp/laneboard-test.lock npm test`. A run
takes about 1 s now and maybe 5 s by morning, so serializing costs nothing, and it removes CPU contention as
a cause of flakes in timer-based tests and port races in boot tests. Targeted runs
(`node --test test/<file>.test.mjs`) are unlocked. Boot and e2e tests pick free ports themselves (§5) and
never use 7777.

**Superseded:** the authoritative waves are computed from the global DAG in README.md ("Waves"); this table is kept for its rationale only.

| Wave | Runs | Tasks (from sections 1-10; coordinator maps them in) | Gate to start the next wave |
|---|---|---|---|
| **0** | sequential, 1 agent | X1 (`w0-split`), F3 (`w0-keys`), F4, A1, F1, X2 (`w0-testkit`) | all six merged, suite green, smoke green |
| **1** | ≤8 parallel | §2 hello/snapshot/stream; §2 auth+envelope+audit; §4 tokens+vendor fonts/sprite+shell with all view stubs; §6 repos/packages config and detection; §7 builder health collector; §10 review-state server side | each task merges independently |
| **2** | ≤8 parallel | §3 hub upstream+fleet store+relay (needs §2 auth); §8 builder control actions (needs §2 auth); §4 board view port; §5 map view; §6 packages view; §7 box view | per-task deps only, no wave barrier |
| **3** | ≤8 parallel | §3 terminal proxy; hub-side stuck/alarms/conflicts/notifications (§7, §8, §10); inbox, audit and morning views; `test/e2e-fleet.test.mjs` | |
| **4** | 1-2 | `s11-docs` (docs integration, CHANGELOG, README), `s11-qa` (final QA, preview, PR body) | night DoD |

Waves 1-3 are a **DAG, not barriers**. The coordinator dispatches any task whose `deps` are all merged
whenever a slot frees up. §9 (homelab room) is the private repo and goes last with 1 agent, in its own
repo and worktree. It never touches laneboard files.

## 4. Wave 0: the splits that make waves parallel-safe

Today every feature registers in `server/index.mjs` (30 `route(...)` calls at `:43-339`, collector starts
at `:476-506`, upgrade dispatch at `:432-441`). Config lives in one `defaults()`/`fromEnv()`/`validate()`
in `server/config.mjs:44-300`, and one `public/index.html` holds every view. Fifteen agents editing those
would conflict on every merge. Wave 0 turns each registration point into a directory, so later tasks only
**add files**.

### X1 = w0-split (owns: `server/index.mjs`, `server/boot/{common,builder,hub}.mjs` (new), `server/version.mjs` (new), `server/modules.mjs` (new),
`server/config.mjs`, `server/config/mode.mjs` (new), `server/state.mjs` (hooks only), `server/routes/.gitkeep`, `server/flags/.gitkeep`, `server/hub/routes/.gitkeep`, `.gitignore`, `package.json`, `test/modules.test.mjs`, `test/config-fragments.test.mjs`, `test/state.test.mjs`)
1. **Mode dispatcher** (§3 2.1 layout). `git mv server/index.mjs server/boot/builder.mjs`, then move the shared parts (`VERSION` → `server/version.mjs`, `listenAll({onUpgrade})`, `shutdownHooks`/`shutdown()`, `registerHealthz(extra)`, `upgradeHandlers`) into `server/boot/common.mjs`. The new `server/index.mjs` is about
   15 lines: process error handlers, `mkdirSync(config.dataDir)`, then `await import(config.mode === 'hub' ? './boot/hub.mjs' : './boot/builder.mjs')`.
   The entrypoint stays `server/index.mjs` because `package.json` `main`, `deploy/laneboard.service:16`
   and `bin/laneboardctl:58` reference it. `server/boot/hub.mjs` is created as a stub that listens, serves
   `/healthz` (`mode:'hub'`) and the shell, and logs `hub mode: no builders configured`; it does **not** load `server/hub/routes/*` yet (H11 adds that call together with the providers), so hub modules merged before H11 stay inert and are covered by their own unit tests, so hub mode boots from wave 0
   on. §3 H11 owns it from then on. Builder behaviour is byte-for-byte unchanged.
2. **Route/feature modules.** `server/modules.mjs` exports
   `loadModules(dir, ctx) -> [{name, modes, register, start?, stop?}]`. It reads `server/<dir>/*.mjs`
   sorted by filename, skips modules whose `modes` excludes `config.mode`, calls
   `register({route, json, readBody, readJson, upgrade, ...ctx})`, and later `start(ctx)`. It also
   collects `stop` into `shutdownHooks`. `upgrade(fn)` pushes onto the existing `upgradeHandlers`
   (`index.mjs:451`, now in `boot/common.mjs`). `boot/builder.mjs` calls `loadModules('routes', ctx)` and `loadModules('flags', ctx)` after its existing routes and before
   `listenAll()`, and `boot/hub.mjs` (from H11 on) calls `loadModules('hub/routes', ctx)`. **Existing routes stay where
   they are tonight**, since moving 30 routes is risk with no parallelism gain. New endpoints
   (`/api/v1/*`, `/api/fleet/*`) are new files: `server/routes/v1.mjs` (§1 F9/§2 A8), `server/routes/health.mjs` (§7)
   and so on. The ctx is one frozen object: `{config, state, ws, db, log, actions, terminals, mapModel,
   push, prs, guard, slots, launcher, retirer, version, startedAt}`, plus a service registry: `ctx.provide(name, value)`, `ctx.has(name)` and `ctx.use(name)` (throws if absent). **Rule: provide in `register`, use in `start`** (or inside request handlers). `loadModules` calls every module's `register` in filename order, then every `start` in filename order, so ordering by filename never matters. Builder-side registries are **module singletons imported directly**, never taken from ctx, so a module works whatever else has merged: `import { registerAction, registerAllHandler } from '../fleet/dispatch.mjs'` (§2 A6) and `import { addCapability, addHelloField } from '../fleet/api-v1.mjs'` (§1 F9); both export `_reset()` for tests. (Section text that says `ctx.v1.addCapability`/`ctx.dispatch.registerAction` means these imports.) On the hub, `boot/hub.mjs` provides `store`, `relay`, `readProxy`, `services`, `broadcast`, `onClientMessage`, `audit` (§3 H11) before loading hub modules. Route registration (`ctx.route`) is allowed in `register`.
3. **Config fragments.** `server/config/<area>.mjs` exports
   `{defaults(), fromEnv(env), validate(c, bad)}`. `config.mjs` discovers them with top-level `await`
   (allowed in ESM) and deep-merges their `defaults()` into `defaults()` and their `fromEnv()` into the env
   layer, then runs every `validate` after the core one (`config.mjs:268`). If two fragments define the
   same leaf key, `ConfigError` is thrown at start. A fragment may also export `finalize(c)`, run after the merge. X1 ships only `server/config/mode.mjs`
   (`mode: 'builder'`, env `LANEBOARD_MODE`, `'builder'|'hub'` only, `'both'` rejected with a message). Later tasks add `server/config/fleet.mjs` (§1 F4),
   `fleet-auth.mjs` (§2 A5), `hub.mjs` (§3 H1), `packages.mjs` (§6 P2), `observability.mjs` (§7 O2), `control.mjs` (§8 C1), `review.mjs` (§10 R1). They never edit `config.mjs` (one sanctioned exception: §6 P8's `markers.done` default line).
4. **State hooks.** `state.addDecorator(name, {session?: (s, ctx) -> patch, lane?: (lane, ctx) -> patch})` runs in `snapshot()`
   and the delta path, before attention is computed; `state.addSnapshotKey(name, fn)` adds a top-level snapshot key (`repos`, `approvals`, `budget`); `state.onTick(fn(ctx, now))` runs at the end of `tick()`. `attentionScore` (state.mjs:36) is changed once, here: a session with `awaitingApproval` scores as `waiting_permission`, a session with `stuck` (and not waiting) gets +40. `stuck`, `paused`, `awaitingApproval` and `reviewReady` become decorator modules
   (`server/flags/<name>.mjs`, loaded by `loadModules('flags')`), so §7, §8 and §10 never edit
   `state.mjs` (exceptions named in cards: §1 F6/F7, §7 O3).
5. Tests: `test/modules.test.mjs` (order, mode filtering, stop hooks, duplicate route rejected),
   `test/config-fragments.test.mjs` (merge, collisions, env, `mode` validation), and a decorator case in
   `test/state.test.mjs`.

### F3 = w0-keys (owns: `server/fleet/keys.mjs`, `public/js/core/keys.js`, `test/keys.test.mjs`; spec in §1 2.4)
`fkey`, `parseFkey` and slug validation, exactly as specified in 00-conventions. The browser file is a
pure ES module importable by node. A test imports both files and asserts they give the same results on
the same 50 cases.

### X2 = w0-testkit (owns: `test/helpers/{fakedom,boot,fake-builder}.mjs`, `test/boot.test.mjs`, `test/render.test.mjs` (helper extraction only), `test/fixtures/empty-config.json`; runs after F1 and A1)
- `test/helpers/fakedom.mjs` holds `makeEl`/`document` extracted from `test/render.test.mjs:14-200` (after F1's async-module harness change).
  X2 owns that one edit to render.test.mjs, which then imports the helper.
- `test/helpers/boot.mjs` exports `boot({mode, config, env}) -> {url, port, child, stop()}`. It spawns
  `node server/index.mjs` with a free port (listen on 0, close, pass `LANEBOARD_PORT`), `HOME` set to a
  temp dir, a written temp `LANEBOARD_CONFIG`, `LANEBOARD_DB=:memory:`, and **`TMUX_TMPDIR=<tmpdir>`**. It
  waits for `/healthz` (10 s timeout) and kills the process group on `stop()`. The tmux isolation is
  required: a second builder-mode process on the shared tmux server runs `terminals.sweepStale()`
  (`server/boot/builder.mjs` startup; `server/terminals.mjs:66-83`), which kills unattached `*-web-*` sessions,
  and those belong to the live service.
- `test/helpers/fake-builder.mjs` exports `fakeBuilder({id, code, sessions}) -> {url, hello, push(msg),
  actions: [], close()}`. It is an in-process `http` + `ws` server that implements Builder API v1 from
  00-conventions: `hello`, `snapshot` from `test/fixtures/snapshot.json` re-keyed, `stream` with
  `{builder, seq, epoch}`, `resync`, `visible`, `actions` that records envelopes and verifies signatures (using §2 A1's `canonicalJson` and `keys-ed25519.verify`) when given `hubKeys` (bare strings or `{key, id, scopes}`; it refuses actions without `control` and term upgrades without `term`, like a real builder), signed-read verification of the four `X-Laneboard-*` headers, `audit`, a `term` echo endpoint, scripted gaps/closes, and a record of received headers (the feature list from §3 H5). With this, §3 can be built and tested against the contract before §2 A8 is merged.
- `test/helpers/boot.mjs` also exports `ingressFetch(booted, path, {user = 'tester@example.invalid', ...init})` and `ingressWs(...)`: requests on the booted process's `fleet.ingressPort` with `X-Forwarded-For: 127.0.0.1`, `X-Forwarded-Proto: https`, `X-Forwarded-Host`/`Host` = the configured public host, and `Tailscale-User-Login` (exactly what serve adds). Tests that act as a remote user use it; plain `fetch` on the local port is `local` and may only read on a hub and cannot run remote-only actions on a builder.
- `test/boot.test.mjs`: builder with no config → `/healthz` ok and the root page 200. Hub with one
  unreachable dummy builder (`{id:'builder-a', url:'http://127.0.0.1:9'}`) and a free `fleet.ingressPort` → `/healthz` ok with `mode:'hub'`; the hub child (an `--import` hook listing resolved URLs) never loads `server/state.mjs`, `server/terminals.mjs`, `node-pty`, or anything under `server/routes/`/`server/flags/` (from §3 H2).
- `test/tools/demo-fleet.mjs` (two fake builders plus a booted hub, prints the URL and stays up; the morning preview) is written by X5.

## 5. File ownership and conflict hotspots

**Rule:** a task owns a list of paths and globs. It may create any new file inside them and edit nothing
else. Anything it needs elsewhere is either a read-only interface or a `BLOCKED` note.
`~/fleet-night/bin/ownership-check <id>` compares `git diff --name-only fleet/main...fleet/<id>` against
the card's globs. If a path falls outside them, the merge is refused and the task is bounced.

| Hotspot | Strategy |
|---|---|
| `server/index.mjs` / `builder.mjs` | Owned by w0-split, then frozen. New behaviour goes in `server/routes/*.mjs`, `server/flags/*.mjs` or `server/hub/**`. |
| `server/config.mjs` | Frozen after w0. Each section owns its `server/config/<area>.mjs`. |
| `server/state.mjs` | Frozen after w0 except for §1 tasks named in the card; use decorators. |
| `server/ws.mjs` | New message types (`health`, `approval`, `stuck`) go through the existing `ws.send(msg)`. No edits. |
| `public/index.html`, `public/css/tokens.css`, `public/js/ui/*`, `public/js/views/index.js` | `index.html` is owned in sequence by §1 F1 → F2 → F8b → §4 D4; `tokens.css` by §4 D1; each `public/js/ui/*.js` file has exactly one owner per the DAG (README). D4 creates the view registry `views/index.js` and stubs for the views F1 did not create (`views/{inbox,packages,audit,diff}.js`, each `export default {id, icon, title, mount(el, ctx), unmount(), update(store)}`) and every `<section>` container. Later view tasks edit only their own `views/<name>.js` and `public/css/views/<name>.css`. |
| `public/js/app.js` (was `public/app.js`), `test/render.test.mjs`, `test/frontend.test.mjs` | Owned in DAG order: F1, X2, F2, F6, F8b (render), D4, D9 (frontend). Coverage may move but never disappear: every test name removed needs a replacement asserting the same behaviour, and the merge check greps the test count, which must not drop. |
| `docs/config.md`, `README.md`, `docs/map.md`, `docs/fleet.md`, `CHANGELOG.md` | **No feature task edits them.** Each task writes `docs/fleet/<topic>.md`, its own file, with "Config keys" and "Endpoints" subsections, and puts a `Changelog:` git trailer in its final commit. `s11-docs` (wave 4) assembles `docs/fleet.md` (index), the config table rows in `docs/config.md`, the README views table, the `docs/map.md` hub/feed changes, and the CHANGELOG from `git log fleet/main --format='%(trailers:key=Changelog,valueonly)'`. |
| `package.json`, `package-lock.json` | Owned by w0-split. No task adds a dependency. A dependency need means `BLOCKED: dep <name> — <why>`, and the coordinator decides against the list below. New test files are picked up by `node --test` without script edits. |
| `test/fixtures/snapshot.json` | Read-only, except §1 F6 (regenerates `previewLines`). New fixtures are named `test/fixtures/<task-id>-*.json` or live in a task-owned fixture dir. |

**Dependency budget for the night:** zero new runtime dependencies. Ed25519 is in `node:crypto`, the WS
client is `ws` (already present), and the DOM tests use the in-repo fake. No devDependencies either; the
QA decision in §7 makes linkedom unnecessary. If a section author argues for one, the coordinator records
it in the morning file as `HUMAN: approve dep`, and the task ships without it.

## 6. Task card template

The coordinator writes one card per task to `~/fleet-night/tasks/<id>.md` and symlinks it to
`~/code/laneboard-<id>/docs/plans/<id>.md`. That makes laneboard's progress pill work: it reads
`docs/plans/<id>.md` `## Stage N` headings and commit subjects with `stage N`
(`server/collector/progress.mjs:21,32-33,93-110`). The card is never committed, because `docs/plans/` is
excluded. Kickoff: `tmux new-session -d -s lb-<id> -c ~/code/laneboard-<id>` running `claude`, with the
prompt "Read docs/plans/<id>.md and do it."

```markdown
# <id> — <title>
Section: §<n> <section file>#<anchor>   Wave: <w>   Deps (merged): <ids>
Worktree: ~/code/laneboard-<id>   Branch: fleet/<id>   Base: fleet/main @ <sha>
Smoke port range: 78<slot>0-78<slot>9 (never 7777)

## Goal
<2-4 sentences from the section, nothing new>

## Files owned (create/edit only these)
- server/routes/v1-hello.mjs, server/config/<area>.mjs, test/<id>*.test.mjs, docs/fleet/<topic>.md …
## Read-only (read, import, never edit)
- server/modules.mjs, server/fleet/keys.mjs, test/helpers/*, 00-conventions contracts …
## Interfaces you must honour
- <exact signatures / message shapes / endpoints copied from the section>
## Interfaces you provide (others depend on these; do not change after merge)
- …

## Stage 1 — <name>
## Stage 2 — <name>
## Stage N — rebase, full suite, docs fragment

## Done when (all exit 0, run in the worktree)
node --test test/<id>*.test.mjs
flock -w 600 /tmp/laneboard-test.lock npm test
node --test test/hygiene.test.mjs
~/fleet-night/bin/smoke            # builder no-config + current config + hub stub
git diff --name-only fleet/main...HEAD   # every path is in "Files owned"

## Commits
Subject: `<area>: <what> (fleet <id>, stage N)`. The words "stage N" feed the progress pill.
Body: why. Final commit carries `Changelog: <one user-facing sentence>`.
End every message with the attribution trailer from the session reminder.
Push after every stage: `git push -u origin fleet/<id>`.

## Markers (on a line of their own, at line start, colon after, in your reply text)
PROGRESS: <n>/<m> <what>          after each stage
STAGE-DONE: stage <n> <what>      when a stage's tests pass and it is pushed
LANE-DONE: <id> <sha>             when every done-when command passes; then stop
BLOCKED: <id> <one line>          and stop (see below)
NEED-HUMAN: <id> <one line>       only for a decision no agent may make (a dep, a contract change, a credential)

## When blocked
Write `## BLOCKED` at the end of this file (what, why, what you tried, what would unblock),
commit+push what you have, print the BLOCKED marker, stop. Never edit a file outside "Files owned",
never change a contract, never add a dependency, never touch main, fleet/main, ~/code/laneboard
or another worktree, never run the live service, never print config.json or keys.
Also echo the final status as one line to ~/fleet-night/tasks/<id>.status:
`DONE <sha>` | `BLOCKED <reason>`.
```

The markers match the host's configured patterns. They are anchored as `^(?:<kind regex>):` (case
sensitive), from `markers.need|blocked|done|progress` in `~/.config/laneboard/config.json` compiled by
`server/collector/markers.mjs:22-33`. They are collected from Stop-hook messages and the pane preview, so
the live board shows them and pushes `NEED-HUMAN`. The coordinator reads `.status` files as its source of
truth, and `GET 127.0.0.1:7777/api/markers` as a cross-check.

## 7. Visual QA without a human: decision

**No browser tonight.** None is installed, and getting one means downloading playwright (~170 MB of
browser plus system libraries that likely need sudo/apt), which is out of scope for an unattended night.
**No linkedom either:** the repo already runs the real `app.js` in a `node:vm` sandbox with a hand-made DOM
(`test/render.test.mjs:1-230`), and that is the pattern to extend. QA has five layers:

1. **Pure view models.** Each `public/js/views/<v>.js` splits into `model(state, route) -> plain data`
   (pure, exhaustively tested) and `render(model, doc)`. `doc` is injected, so node imports the module
   with no `document` global. Tests: `test/view-<v>.test.mjs`.
2. **Fake-DOM render.** `render(model, fakedom.document)` asserts structure: one node per builder/lane,
   status shapes (`.lamp[data-p="1"]` ■, `[data-p="2"]` ▲, §4 2.5), `title`/`aria-label` present on every icon button,
   and the empty and error states. The shell test boots `public/js/ui/shell.js` in the vm with a fake WS
   and walks every route `#/<view>?b=all`, asserting exactly one visible view and no `#ui-error` (the same
   guarantee as `render.test.mjs:370-450` today).
3. **Static safety and consistency checks** (`test/frontend-static.test.mjs`, owned by §4 D4; the `innerHTML` ban is §1 F6's `test/frontend-safety.test.mjs`):
   - no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` under `public/js/`, which
     enforces the "builder data is untrusted" rule;
   - every `var(--x)` used in `public/css/**` is defined in `tokens.css`;
   - every `#icon-id` referenced exists in `public/vendor/lucide/sprite.svg`;
   - every `import` in `public/js/**` resolves to an existing file;
   - every vendored font or sprite has its license file next to it;
   - the hub and builder index responses carry the CSP header (run against `boot()`).
4. **Contrast as a pure function.** `test/tokens.test.mjs` parses `tokens.css`, converts oklch to sRGB,
   and asserts WCAG contrast of at least 4.5 for text on surface and at least 3 for status hues on the
   panel, in both themes.
5. **A live preview for the human.** In the morning, X5 (`s11-qa`) writes `test/tools/demo-fleet.mjs` and leaves `node test/tools/demo-fleet.mjs
   --port 7790` running in tmux `fleet-preview` (hub plus builder-a and builder-b, scripted to cycle
   through working, stuck, approval and down). Port 7790 is a small forwarder inside the demo script that adds serve-like headers (`X-Forwarded-*`, `Tailscale-User-Login: demo@example.invalid`) and forwards to the hub's ingress listener, so actions work in the preview without any auth bypass in server code; it binds `127.0.0.1` only. HUMAN: open it with `ssh -L 7790:127.0.0.1:7790`, or put
   it behind `tailscale serve` on a spare port.

Screenshots happen only if the human sets `QA_SCREENSHOTS=1` in `~/fleet-night/env` before leaving. Then
`s11-qa` may install playwright **outside the repo** (`~/fleet-night/qa-tools`, pinned version) and
capture every view at 1280 and 400 px into `~/fleet-night/shots/`. Any failure is logged and skipped,
never retried. The unmerged `origin/feat/demo` branch (simulated lab) is not a dependency.

## 8. Definition of done for the night

All of these must hold on the final `fleet/main`:

1. `npm test` passes with 0 failures. The test count is at least 424 plus new tests, and **no existing
   test name disappears** without a replacement (the coordinator diffs `node --test --test-reporter=spec`
   name lists from baseline to final).
2. `node --test test/hygiene.test.mjs` passes on its own.
3. `~/fleet-night/bin/smoke` passes. It runs in a temp dir with `TMUX_TMPDIR`, `LANEBOARD_DB=:memory:`
   and a port of 7790 or above:
   - builder, no config (`LANEBOARD_CONFIG=test/fixtures/empty-config.json`): `curl -fs /healthz` returns
     `ok:true`; `curl -fs /api/v1/hello` returns `apiVersion:1, mode:"builder"`;
   - builder with the **host's current config** (`LANEBOARD_CONFIG=~/.config/laneboard/config.json`,
     real HOME, scratch tmux): the same two curls, plus `/api/state` returns 200. The config must still
     validate unchanged, so the new keys are optional;
   - hub mode: covered by item 4.
4. `test/e2e-fleet.test.mjs` (X3) passes. It starts two `fakeBuilder`s in-process, generates a hub key in a
   temp HOME, and boots the hub via `boot({mode:'hub', config:{fleet:{builders:[a,b], staleMs:300, downMs:900}}})` (the boot helper adds a free `ingressPort`). It asserts:
   the hub `/ws` snapshot holds both builders' sessions under fleet keys; a delta pushed by builder-b
   reaches the hub client; `POST` a `send-text` through the hub (with `ingressFetch`) arrives at builder-a with a valid
   signature (the fakes pin the hub key with scopes `read`, `control`, `term`); the same `POST` on the hub's local listener → 403 `remote-only`; a fake that pins the key as a bare string (read only) answers the relayed action 403 `scope-missing`; closing builder-b turns it `stale` and then `down` (timings reduced through config); and
   builder text containing `<img onerror>` reaches the client as an escaped string.
5. Dependencies are unchanged (`git diff main...fleet/main -- package.json package-lock.json` is empty),
   unless the human approved one.
6. Docs: `docs/fleet.md` (new), the README views table (map is home; inbox, packages and audit added),
   `docs/config.md` rows for every `server/config/*.mjs` key, `docs/map.md` (hub ingest), and a CHANGELOG
   `Unreleased` entry. `s11-docs` checks this with a test-like script: every leaf key from each fragment's
   `defaults()` appears in `docs/config.md`.
7. Builder mode with no fleet config behaves as today. The existing render and frontend tests pass, and
   `/api/state` has the same shape apart from the added fields.

8. Security: every merged REVIEW-REQUIRED task has its SR report; no SR finding of High or Critical is open (an open one is listed first in MORNING.md and blocks the hub deploy); X6's packet `~/fleet-night/security/` exists.

Anything not met goes in the morning file as a **known gap** with the task id. It is not hidden.

## 8b. Security review tasks (SR1-SR20) and the handoff X6

Why: the agents writing `server/fleet/**` and `server/hub/**` tonight run on a builder, the least trusted machine, and the hub that will run their code holds the key to every builder (security review S1). The REVIEW-REQUIRED list is README 4.5.

- **Author tracking.** `state.json` records, per task, the agent session (tmux `lb-<id>`, the Claude session id) that authored each commit. `dispatch SRn` refuses a session that authored the reviewed task or any task owning one of the same files, and always starts a fresh session (no `--resume`).
- **SR card.** Inputs: `git diff <merge>^1..<merge> -- <REVIEW-REQUIRED paths of the reviewed task>` (the coordinator pastes the merge sha), the section text, `SECURITY-FIXES.md`, §2 2.11. Checklist: does the code do exactly what the card says and nothing else (no extra endpoints, no new callers of `signEnvelope`/`signRead`, no network calls, no `eval`/`Function`/dynamic `import()` of data, no `child_process` outside the listed modules, no new dependencies, no env-var backdoors such as a debug bypass); every refusal path in the fix list has a test that fails if the check is removed (the reviewer may delete the check locally in a scratch worktree and run the test, then discard); classification, scope, remote-only and replay checks cannot be skipped by a header, method, path-encoding or upgrade variant. Output: `~/fleet-night/reviews/SRn.md` with `VERDICT: pass|fix-needed`, findings `{severity, file:line, what, suggested test}`. Owns no repo path; pushes nothing; marker `DONE: SRn` or `NEED-FIX: SRn <severity>`.
- **Fix loop.** `NEED-FIX` with Medium or worse → the coordinator writes card `<id>-fix` (files: the reviewed task's owned files; done-when: the reviewer's suggested tests pass) and dispatches it to a third fresh session, never the reviewer. The reviewer re-reviews the fix diff once (`SRn` re-opened). Dependents of the SR (A8, F8a after SR7) wait for the fix. A fix that would collide with a later owner already running is appended to that owner's card instead; failing both, it is a known gap. Low findings go to the packet only.
- **X6 security handoff** (deps all SR tasks and X3; owns `~/fleet-night/security/**`, no repo path): `CHECKLIST.md` (per REVIEW-REQUIRED file: owner task, SR report link, verdict, open findings, the `SECURITY-FIXES.md` ids it implements, what the human should verify), `critical.diff` (`git diff main...fleet/main -- <every REVIEW-REQUIRED path>`), `critical-files.txt`, and a proposed split (`git checkout -b fleet/security-core main && git checkout fleet/main -- $(cat critical-files.txt)`) so the human can review those paths as their own PR. It also records the `fleet/main` SHA reviewed, which the human may later pin as the hub's deploy commit (homelab runbook).

## 9. Coordinator operation

State lives on disk so a restarted or compacted coordinator can resume:
`~/fleet-night/state.json` = `{tasks: {<id>: {wave, deps, status: queued|running|done|merged|bounced|blocked|stalled, slot, sha, mergedAs, bounces, startedAt}}, slotsInUse, lastTick}`.
Scripts in `~/fleet-night/bin/`, all plain bash, outside every repo: `dispatch <id>`, `ownership-check <id>`,
`smoke`, `merge <id>`, `tick`, `watchdog`.

Tick, every 10 min:
1. Read `.status` files and `/api/markers`.
2. Merge everything `DONE`, in DAG order.
3. Check health: `MemAvailable`, `df`, and rate-limit state.
4. Dispatch queued tasks with merged deps while `slots < 8`.
5. Detect stalls.
6. Append to `~/fleet-night/log.md`.

`watchdog` runs in tmux `fleet-watchdog` as a dumb loop. If the coordinator pane has been at an idle
prompt for 15 min, it types `tick`. That is how the night survives the coordinator's own rate-limit
pause. It never types into agent panes.

Bounce: append `## BOUNCED <reason>` plus the failing output (last 60 lines) to the card, then send
`"Re-read docs/plans/<id>.md: bounced"` to `lb-<id>`, at most 2 bounces per task. On the third failure
the task is `blocked` and its dependents are skipped. Those dependents are recorded, not improvised.

## 10. Risk register

| Risk | Detection | Coordinator rule |
|---|---|---|
| **Agent diverges** (edits outside ownership, invents contract variants) | `ownership-check`; grep of new exports against the card's "Interfaces you provide" | Refuse the merge and bounce. A second divergence means `blocked`. The coordinator never hand-fixes a task branch, except for a one-line rebase conflict in a file the task owns. |
| **Contract drift between parallel tasks** | e2e and fake-builder tests are contract tests; `test/keys.test.mjs` | The 00-conventions contract wins. A task that needs a change prints `NEED-HUMAN` and stops. No agent edits 00-conventions. |
| **Test flakiness** | A red run passes on an immediate rerun | Rerun once under the lock. If green, log `FLAKY <test>` in the morning file and continue. If red twice, treat it as red. Cards forbid real sleeps over 100 ms; use injected clocks and reduced config timings. |
| **Quota / rate-limit exhaustion** | `limit` markers and Credit (`/api/credit`) on the live board; agents idle with "limit" text in the pane | When the 5 h window is above 85%, stop dispatching. When limited, record the reset time, dispatch nothing, and after the reset send `continue` once to each idle agent. Order the DAG so the critical path (w0 → §2 auth → §3 hub → e2e) runs first, so a short night still ends coherent. |
| **Memory pressure** | `MemAvailable` | Below 3 GB: no new dispatch. Below 1.5 GB: log it, and let the newest agent finish its stage without new work. Agents are never killed for memory. |
| **Disk** | `df ~` | Below 10 GB free: no dispatch. Below 5 GB: stop, `NEED-HUMAN`. Each worktree is a few MB thanks to the node_modules symlink. |
| **Bad merge found late** | Red full suite or e2e after later merges | `git bisect run` over `--first-parent fleet/main` with `npm test`, then `git revert -m 1 <merge>`, push, reopen the task as bounced. Never rewrite the pushed history. |
| **Merge conflict** | `git merge` fails | Abort, bounce `rebase`. The task agent resolves it in its worktree. Repeated conflicts on one file mean an ownership-map bug: record it and serialize the two tasks. |
| **Live service disturbed** | `/healthz` on 7777 pid or uptime changes | Agents and smoke never use 7777, the default tmux socket for servers, or `~/code/laneboard`. Boot helpers use `TMUX_TMPDIR`. If the live service restarts anyway, log it; restarting it is a HUMAN decision. |
| **Hygiene leak** (private names in fixtures, docs or comments) | `test/hygiene.test.mjs` on every merge | Bounce. Cards repeat the neutral names (`builder-a`, `example.invalid`, `/home/user`). Private material goes only into the §9 homelab repo task. |
| **Lost work** (no backup) | — | Agents push every stage, and the coordinator pushes fleet/main after every merge and state.json into the coordinator log. A task branch not pushed in 60 min with commits ahead triggers a nudge. |
| **Stall** (no commit, no pane change for 45 min, not rate-limited) | `git log -1 --format=%ct`, pane hash | Nudge with "print PROGRESS and continue". After two nudges, mark it `stalled`, keep the worktree and branch, and free the slot. |
| **Coordinator context exhaustion** | — | Everything lives in state.json and log.md. On restart, re-read them and continue. |
| **Accidental push to main / force-push** | — | Card rules. The coordinator verifies `git rev-parse origin/main` = baseline `9b2b7cc` (or the human's newer main) on every tick and halts all dispatch if it moved during the night. |

## 11. Morning handoff

The coordinator leaves `~/fleet-night/MORNING.md`, with the top screen first:
1. **Verdict line:** DoD items 1-7, each ✔ or ✘. fleet/main sha, pushed: yes/no.
2. **HUMAN steps, in order:** read the security packet (`~/fleet-night/security/CHECKLIST.md`, open SR findings first); open the PR (compare URL plus `PR.md`); review the `NEED-HUMAN` list;
   approve or reject any dep requests; generate a real hub key on the hub host (`laneboard fleet keygen`);
   pin it in each builder's `fleet.hubKeys` (bare string = read-only first; scopes later); set up `tailscale serve` on the ingress port
   (§2/§3 HUMAN items; app-capability grants stay optional); open the preview on 7790; once accepted, stop `fleet-preview` and `fleet-watchdog`
   and clean up worktrees (`git worktree remove` per merged task; branches stay on origin).
3. **Tasks table:** id, status, merge sha, bounces, flaky tests, minutes.
4. **Known gaps:** blocked and stalled tasks with their `## BLOCKED` text, skipped dependents, and DoD
   misses.
5. **Numbers:** test count from baseline to final, suite duration, peak MemAvailable low point, quota
   pauses.
6. **Screenshots** (`~/fleet-night/shots/`) if enabled, otherwise "none, preview on 7790".

`~/fleet-night/PR.md` holds: summary per section, the merge list
(`git log --first-parent --oneline main..fleet/main`), the DoD results, a "how to test" section (smoke
commands, `node test/tools/demo-fleet.mjs`), known gaps, and the HUMAN steps. It ends with the PR
attribution line from the session reminder.

## 12. Tests this section adds

`test/modules.test.mjs`, `test/config-fragments.test.mjs`, `test/keys.test.mjs`, `test/boot.test.mjs`,
`test/frontend-static.test.mjs` (§4 D4), `test/tokens.test.mjs` (§4 D1), `test/e2e-fleet.test.mjs`
(X3 = `s11-e2e`, deps H11, A8, X2), and helpers `test/helpers/{fakedom,boot,fake-builder}.mjs` (X2).

## 13. Open questions / HUMAN before leaving

- HUMAN: confirm the agent permission mode for unattended `claude` sessions. Without it every agent stops
  at its first permission prompt. Use a worktree-local `.claude/settings.local.json` (excluded, not
  committed) that allows `git`, `npm test`, `node --test`, `flock`, `curl` to `127.0.0.1` **test ports only (≥ 7790)**, never 7777/7778 (the live laneboard; security review S15), and edits within the
  worktree.
- HUMAN (before the hub ever runs this code): every REVIEW-REQUIRED path (README 4.5) is reviewed line by line with X6's packet, ideally as its own PR; the hub deploys a human-pinned, reviewed tag/SHA from a detached checkout, never an auto-pull (security review S1).
- HUMAN: set push quiet hours (`POST /api/push/quiet`) or accept night pushes for `NEED-HUMAN`.
- HUMAN: `QA_SCREENSHOTS=1` or not.
- HUMAN: authenticate `gh` if a PR should be opened automatically.

## 14. Dependencies on other sections

All sections are inputs. Each must give every task a `deps` list and a files-owned list consistent with §5.
Resolved: §1's wave 0 is X1, F3 (w0-keys), F4, A1, F1, X2 (w0-testkit). §4 D4 owns the
shell/stub/static-test work described in §5 and §7 here. §2 and §3 must provide config-driven timings
(stale/down) and a `HOME`-relative key path, so e2e runs fast and hermetically.

## PRIVATE (homelab repo)

Private details: homelab repo.
