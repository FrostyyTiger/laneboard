# What the cockpit's agent can read

The cockpit's agent reads the board through three tools. All three only read:
there is no tool that approves, rejects, starts or stops anything.

| Tool | Answers | Arguments |
| --- | --- | --- |
| `waiting` | what waits for you on every engine, oldest first | `product` |
| `runs` | the runs: product, goal, state, node, cost; with `run`, its tree and gates | `run` (id or `engine/id`), `state` |
| `focus` | what you were looking at when you asked: view, selected node, open run | `screen`, `when` (`prompt` or `now`) |

The server runs inside the room, on `127.0.0.1` only (`cockpit.mcp.port`). Each
request needs the token the room makes at every start. A request from a browser
is refused. The agent gets the token in `LANEBOARD_MCP_TOKEN`; the file `mcp.json`
holds only the variable's name.

Tool answers copy named fields, cut to length. Long requirement and recipe text
is left out. At most 60 reads a minute, 4 at once; a read is cached for 5 s.

**Decisions** (confirm cards) are not built. They wait for the security review of
the control plane.

If the port is in use, the room still runs and the pane says the agent cannot
read the board.
