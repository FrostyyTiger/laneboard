# Stranger review, round 50

Walk: README as written, server on :7790 with the five variables, `curl` on every API row and every
view, the CLI against the copy, the run protocol with `--post`. No browser tool, so views were
fetched, not looked at. Everything in the README's API table answered as described.

1. **`morning --window 3d` exits 1, README says exit 2 is a usage error.** An unknown window is a
   usage error by the README's own definition; found by `laneboard morning --window 3d; echo $?`.
2. **The README's CLI block lists about half the commands.** `laneboard --help` also has `keys`,
   `events`, `cost`, `dirs`, `job`, `spawn`, `restart`, `kill` and `feed`. `feed` is how the Map's
   "pushing a feed" works, and a README reader never learns it exists (docs/map.md only).
   Found by diffing the README block with `--help`.
3. **`/api/map` on a fresh copy is titled `run-runs-n1`, with a builder `run-runs-n1` / code `RRN`.**
   No config, so the name comes from the host; the README does not say where a builder's id
   comes from without a fleet block.
4. **`laneboard run needs --post` with no text is accepted and stores `text: null`.** An open need
   nobody can read in `/api/runs`. `run round` and `run score` refuse missing flags, `needs` does not.
5. **`laneboard ls` on the "clean" copy lists the host's real session (`loop`).** The README warns
   about it; the table itself gives no hint the rows are not the copy's. Minor.
6. **The startup log's first line is a WARN** (`fleet auth: no fleet.ingressPort ...`) on the
   documented no-config start. The README does not say it is expected.
7. **The README paragraph on which CLI commands write outside the state dir is the hardest to
   read in the file** (one long block mixing `run`, `fleet keygen`, `fleet pubkey`). A list would do.
