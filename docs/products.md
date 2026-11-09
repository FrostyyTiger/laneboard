# Products

`#/products` (`g p`; Packages moved to `g k`) answers: is each product ready for
its next goal, and if not, why? One card per product, from every run engine
([engines.md](engines.md)). A ready goal has a Start button ([decisions.md](decisions.md)).

Each goal shows `ready` or `not ready`, its title (a link to the goal's file)
and its runs (links to the run page). A goal that is not ready lists its
reasons. Each reason names what it is about:

| Kind | Means | Links to |
| --- | --- | --- |
| `question` | a question is still open | the question |
| `requirement` | a requirement is not approved | the requirement |
| `claim` | it rests on a low-confidence claim | the claim |
| `budget` | the usage window is too tight | nothing |

Links open that item in the [Knowledge](knowledge.md) view. Refreshes every 60 s.

## Try it

`{ "engines": [{ "id": "main", "kind": "fake" }] }` shows the invented shop; goal
`G4` is not ready and lists all four kinds. With no engine the page says how to
add one. A hub has no engine data yet and says so.

`GET /api/engines/products` answers `{products, engines}`, builder mode only.

Not yet: last PRs and CI on main per product.
