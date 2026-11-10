# Runs-first plan: consuming a run engine

How laneboard reads from and decides through a run engine, without knowing which one it is.
Part of `README.md` in this folder.

## 1. The interface

A run engine sits behind a small interface in `server/engine/`, chosen in config like the other
providers (`docs/providers.md`), with a `none` implementation that does nothing and says so.

```
server/engine/
  index.mjs          the table, the configured engines, merge across them
  none.mjs           no engine: no products, no waiting, runs only from jsonl
  jsonl.mjs          today's run.jsonl protocol (wraps server/collector/runs.mjs)
  fake.mjs           replays fixtures: test/fixtures/engine/v<N>/*.json (also the demo)
  foundry-cli.mjs    `foundry <verb> --json` through execFile (phase 9)
  contract.mjs       the shapes laneboard accepts, per contract version; the version check
```

Each engine exports:

| Member | Returns / does |
| --- | --- |
| `id`, `kind` | config id (`main`) and implementation (`fake`, `foundry-cli` …) |
| `hello()` | `{contract, engine, version, up}`: the contract version it speaks; run once at start and on every reconnect |
| `products()` | products with readiness per goal |
| `runs()` | run rows: id, product, goal, recipe, state, current node, usage, cost, rooms, updatedAt |
| `run(id)` | one run: tree, checks, events, stop, PRs |
| `waiting()` | gates and questions waiting for a person |
| `knowledge(product, filter)` | claims, questions, intent items and links |
| `act(verb, args, meta)` | one decision; `meta` = `{requestId, user, via}`; returns `{ok, result}` or a refusal code |
| `capabilities` | which members it has: `jsonl` has `runs`/`run` only and `act` for `ack`; `none` has nothing |

laneboard's own shapes (what the views and the MCP read) are defined once in `contract.mjs` as
**laneboard shapes**, not as the engine's raw output. Each adapter maps its engine's answer into
them and drops anything it does not know. The engine's raw JSON never reaches the browser.

**Several engines at once.** Config holds a list, `engines: [{id, kind, ...}]`, default `[]`. Run
ids are shown per engine (`main/<run>`); the `jsonl` engine is always on when `runs.files` or
`runs.lanes` would read anything today, so old loops need no new config. One engine is the
expected case.

**Where it runs.** The adapter runs in a **builder-mode** laneboard on the machine where the
engine's CLI works (Q4). Its engine data rides the builder's existing signed stream to the hub,
like lanes and runs do today; the hub serves it from `/api/fleet/engine/*` and gains no new
reach. A laneboard with no `fleet` block reads its engine directly.

## 2. Contract version check

- `hello()` returns the engine's contract version (gap G1). `contract.mjs` lists the versions
  laneboard speaks. While the contract is a v0 draft, laneboard accepts exactly the v0 revisions it
  has fixtures for; from v1 on, the same major with any minor (minors only add fields).
- On a mismatch the engine is **incompatible**: no reads, no writes, a Box line and a banner on
  Runs/Products/Inbox naming both versions. laneboard never guesses at an unknown shape.
- Each answer is checked against its shape. A row that fails is dropped and counted (as
  `run.jsonl` lines are today); a whole answer that fails marks the engine `degraded` with the
  reason. Nothing an engine sends makes laneboard throw.
- `laneboard engine check [--engine id]` prints the engine's version, laneboard's accepted range
  and the result of one call per read verb.

## 3. Contract tests

- `test/engine-contract.test.mjs` is one suite that takes an engine factory. It runs against
  `fake` always, and against a real engine when `LANEBOARD_ENGINE_BIN` points at its CLI
  (skipped otherwise, never in CI by default).
- It checks each read verb's answer against laneboard's shapes, the version handshake, every
  refusal code of `act`, idempotency (the same `requestId` twice decides once) and behaviour
  when the engine hangs or exits non-zero.
- Fixtures: `test/fixtures/engine/v0/` holds one JSON file per verb, made from the contract's v0
  shape for an invented product (`acme-shop`, goals, a run with a tree three levels deep, one gate
  of each kind, a question, ten claims). Once the engine publishes its own example outputs (gap
  G14), they replace the hand-made ones; a diff between them is a contract change.
- The same fixtures feed the demo, so every new view has demo data from the day it lands.

## 4. When the engine is down

Same rules as a builder link (`docs/fleet.md` "How they connect"):

| Engine | Reads | Writes | Shown |
| --- | --- | --- | --- |
| up | live, polled (runs and waiting every 5 s, products and knowledge every 60 s, Q6) | allowed | nothing extra |
| stale (no good answer for `engine.staleMs`) | last good snapshot, greyed with its age | allowed (the engine answers or refuses) | age on rows, Box line |
| down (`engine.downMs`, or the CLI cannot start) | last good snapshot, greyed | refused with 503 `engine-down`, never queued | DOWN tile counts it, Box line, banner |
| incompatible / degraded | none / what passed | refused | banner with the reason |

`run.jsonl` files the engine's runs write keep being tailed by the `jsonl` engine while the CLI is
down, so a running run's events stay live even when the foreman's CLI does not answer. When both
sources know a run, the engine's answer wins for state and tree, the file adds events between
polls.

The CLI is called with `execFile` (no shell), a fixed argument list per verb, a timeout
(`engine.timeoutMs`, default 10 s), an output cap (4 MiB) and a working directory from config.
Calls never overlap per verb; a slow call is waited out, not stacked.

## 5. Writes go through the audited control plane

Every decision a person makes on the page is a control-plane action
(`server/fleet/dispatch.mjs`, `docs/fleet/control.md`), never a direct call from a route:

| Action | Engine verb | Tier | Remote-only | Notes |
| --- | --- | --- | --- | --- |
| `engine.approve` | `approve <gate>` | confirm | yes | the confirm card shows what is approved (recipe, intent items, variant) and its revision (gap G4) |
| `engine.reject` | `reject <gate> --why` | confirm | yes | `why` required |
| `engine.pick` | `approve <gate> --choice` | confirm | yes | variants (gap G3) |
| `engine.answer` | `answer <question> --text` | click | yes | the text is shown back before sending |
| `engine.start` | `start <product> <goal>` | ask | yes | only asks for a recipe; nothing runs until `engine.approve` |
| `engine.pause` / `engine.resume` / `engine.stop` | same | click / click / confirm | no | gentle: the engine finishes its current step |

- **Remote-only** for decisions, for the same reason as `approve`/`deny` today: an agent on the
  box where the adapter runs must not approve its own recipe through the loopback API.
- The envelope's `id` goes to the engine as the request id, the authenticated user as who
  decided (gap G5). The builder's audit chain records the action before it is sent; the engine's
  answer is recorded as the action's result.
- These need a new target kind (`gate`, `run`, `product`) in `TARGET_KINDS`, which is part of the
  fenced security core. Phase 4 is therefore an attended session with a security review, not
  unattended work.
- A hub relays them like any action (`control` scope, `fleet.hubControl` on). The Wall and kiosk
  device tokens cannot send them.
- `add-source` is left out for now (Q9).

## 6. The cockpit

Two doors stay two doors: **open-ended talking** happens in the engine's own repo; the cockpit is
for talking about **what the page shows**.

- The laneboard MCP server (built by #28, C1b build 18) gets engine tools named after the
  contract's read verbs and returning laneboard's shapes: `products`, `runs` (now from the engine
  interface, old runs included), `run`, `waiting`, `knowledge`. One vocabulary for the person, the
  page and the agent.
- `focus` adds the open run, the selected tree node and the selected Inbox row, so "why is this
  stuck?" needs no description.
- Show commands get run targets (`fly_to` a run's rooms on the Map, `pin` a node's check result).
- **Decisions are proposals.** The agent may draft `approve`, `reject`, `pick`, `answer`,
  `pause` or `stop`; each appears as a confirm card on the screen and, on yes, becomes the
  `engine.*` action above, sent as the person who tapped. This is C6 (`docs/plans/cockpit/README.md`
  §3) and waits for its review like the rest of C6.
- The cockpit agent never gets the engine's write MCP of its own, and does not mount the engine's
  MCP for reads either (Q10): one door, one audit trail.
