# Q5: `tailscale status --json` shape

**Answer.** The output is the JSON encoding of Go's `ipnstate.Status`. It has `Self` (one node), `Peer`
(an object keyed by the peer's **node public key**, `nodekey:…`, not by name), `User` (keyed by
numeric user id), `CurrentTailnet`, `MagicDNSSuffix` (deprecated copy), `Health`, `BackendState`,
`TailscaleIPs` and more. Each node is a `PeerStatus`. For a feeder, use `HostName`, `DNSName`,
`OS`, `Online`, `Tags`, `TailscaleIPs`, `LastSeen`, `ExitNode`/`ExitNodeOption`, `KeyExpiry`/`Expired`.
Go has no stable-JSON promise for this struct: read every field defensively (missing = unknown).

## Top level (`Status`)

| field | type | note |
|---|---|---|
| `Version` | string | daemon long version |
| `BackendState` | string | `NoState`, `NeedsLogin`, `NeedsMachineAuth`, `Stopped`, `Starting`, `Running`. A feeder should treat anything but `Running` as "no data" (peers may be empty or stale) |
| `TailscaleIPs` | string[] | this node's IPs |
| `Self` | PeerStatus | this node; **may be null** when not logged in |
| `Peer` | object | key = node public key; value PeerStatus. Absent/null when no peers |
| `User` | object | key = user id (string of a number); value `tailcfg.UserProfile` (`LoginName`, `DisplayName`…). Contains real login names: do not copy into a feed |
| `CurrentTailnet` | object or null | `Name`, `StableID`, `MagicDNSSuffix` (no dots around it), `MagicDNSEnabled` |
| `MagicDNSSuffix` | string | legacy name of `CurrentTailnet.MagicDNSSuffix` |
| `Health` | string[] | health problems; empty = fine |
| `CertDomains`, `ExtraRecords`, `AuthURL`, `ExitNodeStatus`, `ClientVersion`, `TUN`, `HaveNodeKey` | | not needed |

## Per node (`PeerStatus`)

- `ID` (stable node id string), `NodeID` (number), `PublicKey`.
- `HostName`: "HostInfo's Hostname (not a DNS name or necessarily unique)".
- `DNSName`: FQDN **ending with a dot**, `host.<MagicDNSSuffix>.`. The MagicDNS label can differ from
  `HostName` (de-duplicated as `host-1`, or renamed in the admin console). Prefer the first label of
  `DNSName` as the node name (it is what `ssh host` resolves) and fall back to `HostName`.
- `OS`: HostInfo.OS (`linux`, `macOS`, `windows`, `iOS`, `android`, …).
- `UserID`, `AltSharerUserID` (set when the node was shared in by another user; omitted otherwise).
- `TailscaleIPs`: array of IPv4 + IPv6 strings (100.x and fd7a:115c:a1e0::…).
- `AllowedIPs`, `PrimaryRoutes`: arrays of prefixes, omitted when empty. `PrimaryRoutes` = subnet routes this
  node currently serves (a subnet router).
- `Tags`: array of `tag:foo`, **omitted** (not `[]`) when the node has none. A tagged node has no
  user owner in the admin console.
- `Online`: bool, "connected to the control plane". **This is the field for up/down.**
- `Active`: bool, "recently active" = a packet was sent to the peer in about the last two minutes. Not
  the same as online; do not use it for status.
- `LastSeen`: Go `time.Time`, RFC 3339. Comment in the source: "last seen to tailcontrol; **only present if
  offline**". A Go struct `time.Time` is never dropped by `encoding/json`, so for online peers it normally
  appears as the zero time `"0001-01-01T00:00:00Z"` (my reading of Go semantics and what the CLI
  is commonly seen to print; **not verified against a live node this round**). Feeder rule: parse; a year < 1971 or
  unparsable = "no value".
- `LastWrite`, `LastHandshake`: same encoding, zero when never.
- `Created`: time registered with control.
- `ExitNode` (bool): this peer is the exit node currently selected; `ExitNodeOption` (bool): offers and is approved as an exit node.
- `KeyExpiry`: RFC 3339 or omitted; `Expired`: bool, omitted when false.
- `ShareeNode`: omitted unless true; "should be hidden by `tailscale status` by default". The CLI's
  human output hides them; a feeder should skip peers with `ShareeNode: true`.
- `Relay` (DERP region name, "" when direct), `CurAddr`, `Addrs`, `RxBytes`, `TxBytes`, `PeerAPIURL`, `sshHostKeys`
  (lower-case json name), `Capabilities` (deprecated), `CapMap`, `Location`: not needed.
- `InNetworkMap`/`InMagicSock`/`InEngine`: internal bookkeeping.

Documented vs stable: the Go comments above are the only documentation; the Tailscale CLI docs
(`tailscale status --json`) say it prints "in JSON format" and mark it **"unstable/subject to change"** in the
`--help` text (see sources; the help text was not fetched, so treat this sentence as unconfirmed). Fields
listed above have been in the struct for years (`Online`, `Tags`, `DNSName`, `TailscaleIPs`, `OS`).

## What the feeder should do (suggestion for T4)

1. If `BackendState !== "Running"` or `Self` is null: `{ok:false, error:"tailscale is <state>"}`. Do not emit an empty "all offline" feed.
2. Host = `Self` (name, os, ips). Guests = `Object.values(Peer)` minus `ShareeNode`, sorted by name; `status = Online ? "running" : "stopped"`.
3. Name: first label of `DNSName`, lowercase, no trailing dot; fall back to `HostName`.
4. No secrets in the output: leave out `User` (login names), `PublicKey`, `sshHostKeys`, `AuthURL`. The `Tags` and `OS` are fine.
5. Last seen: from `LastSeen` only when parseable and after 1971; otherwise omit.
6. Expect `Peer` missing, `Tags` missing, `Self.Tags` missing; tolerate unknown fields.
7. `tailscale status --json` exits non-zero when the daemon is not running and prints a message on stderr, not JSON. `--peers=false` exists but we want peers. CLI binary path varies (`/usr/bin/tailscale`, `/Applications/Tailscale.app/Contents/MacOS/Tailscale`); a `--socket` flag exists. A `ENOENT` = `{ok:false}`.

## What others do

- The local-only API (`localapi` `/localapi/v0/status`) returns the same struct; Prometheus/Homepage-style
  integrations mostly call the control-plane API (`GET /api/v2/tailnet/-/devices`, needs an API key) instead. Laneboard
  deliberately uses the local CLI: no key, no network egress. The cost: it only sees what this node sees (ACLs can hide peers).

## Could not confirm

- The live zero-time encoding for online peers (above).
- Whether the CLI help still says "unstable".
- Licence: `tailscale/tailscale` is BSD-3-Clause; I copied no code, only field names.

## Sources

- https://raw.githubusercontent.com/tailscale/tailscale/main/ipn/ipnstate/ipnstate.go (read 2026-10-20): struct definitions and comments for `Status`, `PeerStatus`, `TailnetStatus`, `ExitNodeStatus`.
