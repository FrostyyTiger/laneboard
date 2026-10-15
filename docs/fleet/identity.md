# Fleet identity

Every laneboard has a fleet identity: a builder id, a short code for the UI,
and the list of extra browser origins it accepts. The keys live in
`server/config/fleet.mjs` and follow the usual layers (defaults, then the
config file, then `LANEBOARD_*` env vars, which always win).

In `builder` mode with no `fleet` keys, behaviour is exactly as before: the
defaults below are computed, but nothing outside the fleet features reads them.

| Key | Default | Env | What |
| --- | --- | --- | --- |
| `fleet.id` | the hostname, sanitized (lowercased, anything outside `a-z0-9-` becomes `-`, cut to 24 chars) | `LANEBOARD_FLEET_ID` | This builder's id in the fleet, e.g. `builder-a`. It prefixes every fleet key (`builder-a/web`). Must match `^[a-z0-9-]{1,24}$`; a value that does not is refused at start, never silently rewritten. |
| `fleet.code` | `""`, which means derived from `fleet.id` (`builder-a` → `BA`, `ci-2` → `C2`, `hub` → `HU`) | `LANEBOARD_FLEET_CODE` | The 2-3 character tag the UI shows next to this builder's sessions. Uppercased; must then match `^[A-Z0-9]{2,3}$`. |
| `fleet.allowedOrigins` | `[]` | `LANEBOARD_ALLOWED_ORIGINS` (comma list) | Browser origins allowed on WebSocket upgrades and mutating routes in addition to the board's own origin, e.g. `https://hub.example.invalid`. Each entry must be an exact origin (`scheme://host[:port]`, no path, no trailing slash, lowercase, no default port) and use `https`, or `http` only on loopback (`127.0.0.0/8`, `localhost`, `[::1]`). Matching is exact, never same-site. |

`mode` (`builder` or `hub`) is a separate key, see `server/config/mode.mjs`.
The fleet auth keys (`fleet.hubKeys`, `fleet.ingressPort`, ...) and the hub's
`fleet.builders` list are documented with their own features.

Example:

```json
{
  "fleet": {
    "id": "builder-a",
    "allowedOrigins": ["https://hub.example.invalid"]
  }
}
```
