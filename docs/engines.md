# Run engines

A **run** is one loop working on one goal for hours or days. A **run engine**
is the program that starts and drives runs. laneboard does not drive runs; it
reads an engine and shows what it reads. It knows an engine only through a
small interface, never by name, so any engine that speaks the contract (or
writes today's run files) shows up the same way.

The Runs view reads this layer ([runs-home.md](runs-home.md)); Products, Inbox
and Knowledge will too (the runs-first plan). It also answers the read-only
routes below and `laneboard engine check`.

| Kind | What it reads | Needs config |
| --- | --- | --- |
| `jsonl` | the run files of [runs.md](runs.md), through the runs collector's store | no: always on, id `jsonl` |
| `none` | nothing; says so | an entry |
| `fake` | the contract's published example answers (an invented shop), for tests and the demo | an entry |
| `foundry-cli` | an engine's CLI, `<verb> --json`, through `execFile` | an entry with `bin` and `config` |

```
server/engine/
  index.mjs        the table, the configured engines, allRuns() across them
  adapter.mjs      createContractEngine: handshake, checks, timeout, last good answer, status
  contract.mjs     laneboard shapes, the envelope and version check, the per-verb mapping
  exec.mjs         how a CLI engine is called: execFile, timeout, output cap
  none.mjs  jsonl.mjs  fake.mjs  foundry-cli.mjs
```

## The interface

Every engine has every member; one it lacks answers `{ok: false, code: 'unsupported'}`.

| Member | Answers |
| --- | --- |
| `id`, `kind`, `capabilities` | its config id (`main`), its kind, the members it really has |
| `hello()` | the contract version it speaks, its own version, the oldest contract it serves |
| `health()` | foreman heartbeat, hosts and their states, queue length, the account usage windows |
| `products()` | products, their goals, readiness per goal with reasons that link |
| `runs()` | run rows: product, goal, state, stop reason, current node, rooms, usage, PR |
| `run(id)` | one run: its row plus the tree, gates, PRs and report (`tree: null` for a run-file run). The recipe keeps `patterns` and `loop` (its loop numbers) and a node its `phase` when the engine sends them ([run-loop.md](run-loop.md)) |
| `events(runId, since)` | the events after `since`, plus `next` to pass next time |
| `waiting(filter)` | what waits for a person: gates and questions with their content and revision |
| `knowledge(product, filter)` | claims, questions, requirements, source headers (never raw sources); filter by `kind`, `status`, `id`, `limit`, `cursor` |
| `act(verb, args, meta)` | one decision, `meta = {requestId, user, via}`; called only by the actions in [decisions.md](decisions.md) (decisions go through the control plane, phase 4) |
| `status()` | `up`, `stale`, `down`, `degraded`, `incompatible`, `unknown` or `off`, with the reason |

A read answers `{ok: true, data, at, stale, age, dropped}` or `{ok: false,
code, reason}`. `data` is a **laneboard shape** (`SHAPES` in `contract.mjs`):
camelCase, times in epoch ms, only the fields laneboard knows. The engine's
own JSON never reaches the browser. `act` answers the engine's result (`ok`,
`verb`, `target`, `request`, `by`, `via`, `replayed`, then `result` or `code`
and `reason`). Refusal codes are the engine's (`not-found`, `already-decided`,
`stale-revision`, `refused`, `busy`, `engine-error`) or laneboard's own
(`engine-down`, `incompatible`, `degraded`, `unsupported`, `bad-request`).

The `jsonl` engine has `runs`, `run` and `act('ack')`, which writes the same
`needs.ack` line as `laneboard run ack`. `GET /api/runs` does not go through
it and answers exactly as before.

## Config

```json
{ "engines": [{ "id": "main", "kind": "fake" }] }
```

A real engine:

```json
{ "engines": [{ "id": "main", "kind": "foundry-cli", "bin": "/opt/foundry/runtime/bin/foundry", "config": "/etc/foundry/config.json" }] }
```

The child's environment is exactly `PATH` and `FOUNDRY_CONFIG` (`config`).
The Box view shows each engine's state, contract and version.

`engines` defaults to `[]`: then the table holds only `jsonl`, and nothing
changes. Each entry takes `timeoutMs`, `staleMs`, `downMs` and `freshMs`; a `fake` takes
`dir`. Every key is in [config.md](config.md#engines--run-engines).

## The version check

laneboard speaks contract **1.x**: major 1, any minor, since a minor only adds
fields. `hello` runs before the first read and again after the engine did not
answer. Any other major (`2.0`, `0.9`) makes the engine **incompatible**: no
reads, no writes, and the reason names both versions. Every answer's envelope
(`{contract, engine, at, data}`) is checked again.

Each answer is then mapped into its shape. A row without its id or the fields
it is listed by (a run's product, goal and state) is dropped and counted in
`status().dropped`; a waiting item whose `revision` is not the hash of its
content is dropped too. A whole answer that is not its verb's shape makes the
engine **degraded** for that verb until it answers well again. Nothing an
engine sends makes laneboard throw.

## When the engine is down

| Engine | Reads | `status()` |
| --- | --- | --- |
| answers | live | `up` |
| no good answer for `staleMs` | the last good answer, `stale: true` with its `age` | `stale` |
| no good answer for `downMs`, never one, or the CLI cannot start | the last good answer if any, else `engine-down` | `down` |
| another major / a broken answer | none / what passed | `incompatible` / `degraded` |

Every call has a timeout (`timeoutMs`). Two reads of the same verb never run
at once: a slow one is waited out, not stacked. A decision is never queued: an
engine that does not answer refuses it with `engine-down`. A CLI engine is
called with `execFile`, never a shell, a fixed argument list, a 4 MiB output
cap and only the environment it is given (`exec.mjs`).

## How often laneboard asks

Each read of a CLI engine starts a process. The Runs view alone asks for runs,
products, health and waiting every 5 s, and the Inbox and the Map ask too. So
the adapter keeps a short memory:

| Read | Served again without a call for |
| --- | --- |
| runs, run, events, health, waiting | `freshMs` (default 4 s) |
| products, knowledge | 30 s (`SLOW_FRESH_MS`) |

- An answer from memory is the same answer, with its own `at` and `cached: true`.
- Any decision (`act`) ends the memory, so the next read shows what it changed.
- A failed call ends it too: after a failure the engine is asked again, and the
  last good answer comes back only as `stale`, never as fresh.
- `status().calls` counts the calls really made per verb (`GET /api/engines`).

`freshMs: 0` turns the memory off. A `fake` engine has it off unless set.

## Routes

Read-only, builder mode, behind the usual request guards.

| Route | Answers |
| --- | --- |
| `GET /api/engines` | `{accepts, engines: [status + capabilities]}`, after one `hello` each |
| `GET /api/engines/runs` | every engine's runs but `jsonl`'s, for the Runs view ([runs-home.md](runs-home.md)) |
| `GET /api/engine/<id>/hello` `health` `products` `runs` `waiting?for=` | `{engine, at, stale, age, dropped, data}` |
| `GET /api/engine/<id>/run/<run>` `events/<run>?since=` `knowledge/<product>?kind=&status=&id=&limit=&cursor=` | the same |

Refusals are `{error, code}`: 400 `bad-request`; 404 unknown engine,
`not-found` or `unsupported`; 502 `incompatible` or `degraded`; 503
`engine-down`.

`laneboard engine check [--engine <id>]` prints each engine's version,
laneboard's accepted range and one line per read verb.

## The contract suite

`test/engine-contract.test.mjs` is one suite that takes an engine and holds
each read verb against the shapes. It runs against `fake`, `jsonl` and `none`
always. On `fake` it also checks the version handshake, every refusal code of
`act`, that the same request id decides once, and an engine that hangs, exits
non-zero, answers garbage or sends bad rows.

```sh
node --test test/engine-contract.test.mjs
LANEBOARD_ENGINE_BIN=/path/to/engine-cli FOUNDRY_CONFIG=/path/to/config.json node --test test/engine-contract.test.mjs   # also a real engine: reads, and refusals that change nothing
```

The fixtures in `test/fixtures/engine/v1/` are the engine's published
examples, copied verbatim; their README names the upstream commit. A diff
against upstream is a contract change.
