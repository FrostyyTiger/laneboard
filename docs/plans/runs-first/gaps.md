# Runs-first plan: what the contract v0 lacks

What laneboard needs from the run engine's contract (foundry's `docs/contract.md`, v0 draft of
2026-11-01) that v0 does not say yet. A list for the engine's owner; this plan does not change
the engine. Part of `README.md` in this folder. Phase 0 can start without any of them (the
fake engine assumes the recommended answer); the phase that needs each one is in brackets.

| # | Gap | What laneboard needs | Phase |
| --- | --- | --- | --- |
| G1 | **Version handshake** | A read verb (`version` or `hello`) answering the contract version, the engine version, and the oldest contract version still served. Plus a rule for what a minor and a major change are, and how long an old major stays. | 0 |
| G2 | **Output schemas and ids** | A JSON schema (or exact field table) per verb: stable ids for products, goals, runs, nodes, gates, questions, claims, intent items; timestamps in one format; an `updatedAt` per object so a poll can tell what changed. | 0 |
| G3 | **Variant choice** | `approve <gate>` has no argument for which variant was picked. A `--choice <variant-id>` (or a `pick` verb), and `waiting` listing each variant with a title and a preview link. | 3 |
| G4 | **What is being approved, and its revision** | `waiting` should carry the gate's content or a pointer the page can render (recipe text, intent item ids, the question with its context) and a revision or hash. `approve` takes `--expect <revision>` and refuses if the item changed since the person read it. | 3, 4 |
| G5 | **Who decided, and retries** | Write verbs take `--by <user>`, `--via <consumer>` and `--request-id <uuid>`; the same request id twice applies once and answers the first result. The contract says writes are logged with who; it does not say how a consumer passes who. | 4 |
| G6 | **Rooms per run** | `runs` / `run` should name the rooms (machines) a run uses, with state and expiry, by the name the room provider gives them, so the Map can hang a run on its rooms. | 7 |
| G7 | **Write results and refusal codes** | A fixed result shape and a closed list of codes: `not-found`, `already-decided`, `stale-revision`, `refused` (with reason), `busy`, `engine-error`. Exit codes for the CLI. | 4 |
| G8 | **Change feed** | Either a `events <run> --since <cursor>` verb or the path of each run's event file in `run <id>`, so the page can stay live between polls without re-reading whole trees. | 1 |
| G9 | **Event fields for the tree** | The `level` / `node` extension of `run.jsonl` also needs `parent`, a node title, and a `check` event (level, name, pass/fail, counts, link to output), so a tree can be built from events alone while the CLI is down. | 1 |
| G10 | **Structured readiness reasons** | `not ready` reasons as `{kind, ref, text}` (`question Q-4 open`, `intent I-2 not approved`), not only text, so the page links each reason. | 2 |
| G11 | **Usage and cost shape** | `runs` says "usage" without a shape. Needs tokens and USD per run, per role and per tier, and the account windows (5 h / 7 d) with reset times, so Credit and the run page agree with the engine. | 1 |
| G12 | **Health** | A cheap read that says whether the foreman is alive (last heartbeat), separate from "no runs", so laneboard can tell down from idle. | 0 |
| G13 | **Remote transport** | CLI and MCP are local by default. If the adapter cannot run on the engine's machine, the contract needs a remote transport with authentication; otherwise it should say "local only" and laneboard plans for that (Q4, Q5). | 9 |
| G14 | **Published examples** | Example output per verb per contract version, in the engine's repo, which consumers run their contract tests against. Today the contract promises consumer-runnable tests but not their data. | 0 (later replaces hand-made fixtures) |
| G15 | **Knowledge privacy and size** | Whether `knowledge` ever returns raw source content or personal data (the engine's decisions say raw sources with personal data are referenced, not committed); paging and filters for a large knowledge home. The page shows claims and references only. | 5 |
| G16 | **Addressee** | Waiting items and questions should say whom they are for, once more than one person works on a run, so each person's Inbox shows theirs. | 3 |
| G17 | **State and stop vocabulary** | A table mapping the run states (`waiting-approval`, `running`, `paused`, `at-gate`, `done`, `stopped`) and stop reasons to their meaning, closed lists, so laneboard can map them onto its own (`docs/runs.md` "States", "Stop reasons"). | 1 |
| G18 | **Links** | Web URLs for PRs, recipe files and knowledge entries where they exist, since a repo path on the engine's machine means nothing in a browser. | 1 |
