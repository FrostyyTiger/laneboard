# What the cockpit's agent can read and propose

The cockpit's agent reads the board through three tools and can propose a
decision through a fourth. It never decides: only your yes sends a decision.

| Tool | Answers | Arguments |
| --- | --- | --- |
| `waiting` | what waits for you on every engine, oldest first | `product` |
| `runs` | the runs: product, goal, state, node, cost; with `run`, its tree and gates | `run` (id or `engine/id`), `state` |
| `focus` | what you were looking at when you asked: view, selected node, open run | `screen`, `when` (`prompt` or `now`) |
| `propose` | puts a decision card on your screen and waits up to 2 min for your answer | `item` or `run`, `decision`, `choice`, `text`, `why` |

The server runs inside the room, on `127.0.0.1` only (`cockpit.mcp.port`). Each
request needs the token the room makes at every start. A request from a browser
is refused. The agent gets the token in `LANEBOARD_MCP_TOKEN`; the file `mcp.json`
holds only the variable's name.

Tool answers copy named fields, cut to length. Long requirement and recipe text
is left out. At most 60 reads a minute, 4 at once; a read is cached for 5 s.

## Proposals

The agent may propose `approve`, `reject`, `pick` or `answer` for a waiting item,
and `pause`, `resume` or `stop` for a run. It may not propose `start`.

1. The room checks the proposal against the board: the item still waits, the
   decision fits its kind, a pick names one of its options, the run's state
   allows it. Otherwise the agent gets one sentence and no card opens.
2. The card opens on the screen that sent the last prompt (else the screen heard
   from last). One at a time; a second one is refused while one is open.
3. Your page reads the item fresh from the board and shows the same card as the
   board's own button, plus `Asked by the agent` and the agent's why. A reason or
   answer the agent wrote is in the text box, for you to change.
4. On your yes, **your page** sends the decision through the board's dispatcher,
   signed in as you (`docs/decisions.md`). The room never sends one. So the
   usual rules hold: a page opened from the machine itself is refused, and the
   audit log names you.
5. The agent hears the outcome: done, `The owner said no.`, no answer within
   2 min, the screen went away, or the dispatcher's refusal.

The room writes one `cockpit.propose` audit line per proposal, with how it ended.
The Wall cannot answer a proposal.

If the port is in use, the room still runs and the pane says the agent cannot
read the board.
