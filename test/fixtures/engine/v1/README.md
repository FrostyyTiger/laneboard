# Engine fixtures, contract v1

The published example answers of the run engine's contract v1, copied **verbatim** from the
engine's repo (`contract/examples/v1/`). They describe one invented world: products `acme-shop`
and `acme-returns`, hosts `steady-1` and `heavy-1`, links on `*.example.com`, one moment
(`2026-11-01T10:45:00Z`). Nothing in them is a real product, person or machine.

- Source: the engine repo's `contract/examples/v1/`, commit `a28a84ce579a40f185313e4207a214846e77bf8a`.
- Read by the `fake` engine (`server/engine/fake.mjs`) and by `test/engine-contract.test.mjs`.
- Never edit them here. A diff against upstream is a **contract change**: copy the new files over
  in one commit that names the new upstream commit, and fix whatever the contract suite then says.

Files: one answer per read verb (`hello`, `health`, `products`, `runs`, `run`, `events`,
`waiting`, `knowledge`), `result-ok.json` plus one `result-<code>.json` per refusal code, and
`events.jsonl` (one run's event file, no envelope).
