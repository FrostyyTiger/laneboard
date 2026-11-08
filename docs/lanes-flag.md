# The lanes flag

`lanes.enabled` in the config (env `LANEBOARD_LANES=1` or `0`). **Default off.**
Runs, Products and the Inbox are the main way in; lanes are the old way.

With it off:

| What | Effect |
| --- | --- |
| Board, Packages, Diff (and the Board's archive) | no tab, no palette row; a link lands on Runs and says "Lanes are off" |
| `g b`, `g k` | same, they land on Runs |
| `/api/lanes`, `/api/packages`, `/api/v1/archive`, `/api/fleet/archive`, `/api/v1/lanes/:id/diff` | 404 |
| actions `launch`, `retire` | not registered, dispatch refuses them; `laneboard launch` and `retire` fail |
| Inbox groups Review, Paused, Stale | not shown |

Nothing is deleted. Turn lanes back on with:

```json
{ "lanes": { "enabled": true } }
```

and restart. The page asks `GET /api/features` (`{lanes: bool}`) before its first
route. A server that does not answer counts as lanes on.

Still running with it off: the lane and session collectors, because Map, Box,
Morning and session approvals read them. Map's lane nodes are phase 7's job.
