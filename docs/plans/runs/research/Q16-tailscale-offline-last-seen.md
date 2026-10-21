# Q16 — Tailscale offline devices and last seen

## Answer
- `tailscale status --json` peers carry `Online` (bool, "whether node is connected to the control plane"),
  `LastSeen` ("last seen to tailcontrol; only present if offline") and `Active` ("whether the node was
  recently active": a packet sent to the peer in the past two minutes; definition "subject to change").
- Online and active are different: an online peer is often not `Active`. Offline is `Online == false`.
  Use `Online`, never `Active`, for reachability.
- `LastSeen` is a Go `time.Time`, so an absent value is Go's zero time, which `encoding/json` writes as
  `"0001-01-01T00:00:00Z"` (Go behaviour I know; I did not see a live output). Treat any year < 2000 as "none".
- The CLI table prints `offline` plus a last-seen suffix for offline peers; the admin console wording
  ("Last seen", "Connected") and Netdata / Uptime Kuma behaviour could **not** be confirmed.

## Details
- Struct fields (ipn/ipnstate `PeerStatus`, main branch): `Online bool`, `Active bool`, `LastSeen time.Time`,
  `LastHandshake time.Time` ("with local wireguard"), `LastWrite time.Time` ("time last packet sent"). The
  fields have no JSON tags, so JSON keys are the Go names (`Online`, `LastSeen`, …), under `Peer` (a map keyed
  by node key) and `Self`.
- CLI (`cmd/tailscale/cli/status.go`, `printPS`): if `!ps.Online` the row gets `; offline` + `lastSeenFmt(LastSeen)`
  appended to `idle`/`active` states; an offline peer with no traffic shows `offline` + last seen; a peer
  never used shows `-`. I could not read `lastSeenFmt`, so its text and zero-time handling are unconfirmed.
- The CLI docs page says `--json` output is "WARNING: format subject to change"; the docs never name
  `Online`/`LastSeen`. Table statuses: `active`, `idle`, `-` ("no traffic has ever been sent/received").
- Caveat from a community thread (search snippet only): `LastSeen` is not updated regularly, so do not use it
  as the only offline signal.
- A page https://tailscale.com/kb/1329/… I fetched was an unrelated vendor's page; ignore it. The KB page
  for "Last seen" was not found. No page tried to instruct me.

## What laneboard could take (T4)
- Read `Online === false` as offline; show "last seen <relative>" only when `LastSeen` parses to a year ≥ 2000.
- Never colour "offline" alarm-red by itself; offline-but-expected = a quiet, grey, shape-marked state with
  the last-seen time (this matches the repo's grey-unless-abnormal rule from Q14). Alarm only for a device
  the owner marked as must-be-up, if such a flag exists; default `none`.
- Parse defensively: missing `Online` → unknown, not offline.
- Not confirmed: Netdata, Uptime Kuma, admin console wording. Re-ask as a new question if T4 needs it.

## Sources
- https://raw.githubusercontent.com/tailscale/tailscale/main/ipn/ipnstate/ipnstate.go (read 2026-10-21)
- https://raw.githubusercontent.com/tailscale/tailscale/main/cmd/tailscale/cli/status.go (read 2026-10-21)
- https://tailscale.com/kb/1080/cli (read 2026-10-21)
- https://forum.tailscale.com/t/api-to-check-if-a-node-is-online/5165 (search snippet only, 2026-10-21)
