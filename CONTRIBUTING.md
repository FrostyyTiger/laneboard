# Contributing

```bash
npm ci        # node-pty compiles; you need a C++ toolchain
npm test      # everything, in about a second
```

Node 24 or newer. No build step, no bundler, no TypeScript, and **no new
dependencies** — the six that are here earn their place and a seventh has to
earn it against the whole list.

## The shape of a change

- **One commit per change**, with a message that says what and why. The body
  is where the reasoning goes; the reader a year from now is the audience.
- **`npm test` is green before every commit.** The suite runs in about a
  second, so there is no excuse.
- **Every change comes with its test.** A fix comes with the test that would
  have caught it.

## The hygiene gate

`test/hygiene.test.mjs` walks every tracked file and fails on anything that
names a host, a person or a private address — laneboard was extracted from a
private repository, and nothing from it may come back. If it fails, it names
the file and the line. Do not add an exception; change the line.

Fixtures use neutral names throughout: `example-repo`, `example-org`,
`/home/user`, `example.invalid`, and documentation addresses
(`203.0.113.0/24`) where an address is needed.

## Things that are deliberate

- **Nothing destructive happens on its own.** `retire` refuses a live session
  always, and a dirty or unmerged lane without `--force` plus the lane id
  typed back. Collectors are read-only: `git fetch` and `git worktree
  add/remove` run only inside `launch` and `retire`, which a human starts. The
  guard flags and pushes; it never acts. A patch that loosens any of this
  needs a very good reason in its commit message.
- **The server binds loopback.** laneboard has no login and can type into
  terminals. See `SECURITY.md`.
- **Site-specific code lives behind a provider**, never in a collector. If a
  change would put a hostname, a container name or a vendor CLI into
  `server/collector/`, it belongs in `server/providers/` instead —
  `docs/providers.md` says how.
- **Attention ordering is the product.** The board is sorted by what most
  needs a person. A change that sorts by anything else — recency, name, lane —
  is changing what laneboard is for.

## Where things are

| | |
| --- | --- |
| `server/` | the one process: collectors, state, the HTTP and WebSocket API |
| `server/providers/` | everything site-specific, behind three small interfaces |
| `public/` | the page: no framework, no build |
| `bin/` | the CLI and the service control |
| `docs/` | `install.md`, `config.md`, `providers.md` |
| `test/` | one file per area; `node --test`, no runner |
