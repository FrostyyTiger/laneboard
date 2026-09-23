# Providers

Everything site-specific in laneboard lives behind one of three small
interfaces, and each of them has a `none` implementation that does nothing and
says so. The point is not extensibility for its own sake: it is that a
laneboard on a machine with no agent stack, nothing live next to it and no
forge is the **default**, and still works.

| Interface | `none` | The real one |
| --- | --- | --- |
| **slots** | no slots; `launch` and `retire` refuse | `agent-stack` |
| **guard** | nothing is watched | `ports` |
| **ci** | no PR chips, no queue | `gh` |

They are chosen in the config file (`slots.provider`, `guard.provider`,
`ci.provider` — see `docs/config.md`), resolved once in
`server/providers/index.mjs`, and imported from there by name. Nothing else in
the server knows which one it is talking to.

```
server/providers/
  index.mjs              the table, and the chosen three
  slots/{none,agent-stack}.mjs
  guard/{none,ports}.mjs
  ci/{none,gh}.mjs
```

## Adding one

1. Write a module next to its siblings with the exports below.
2. Add it to `TABLE` in `server/providers/index.mjs`.
3. Add its name to the same kind's list in `validate()` in `server/config.mjs`.

Nothing else changes. A provider is plain ESM with no base class and no
registration call; `_set(kind, impl)` swaps one at runtime, which is how the
launch and retire tests run against a fake that starts nothing.

Two rules hold for every implementation:

- **Read-only unless asked.** Only `up`, `down` and `dropVolumes` may change
  anything, and only inside `launch` and `retire`, which a human starts. A
  collector calling a provider must not have side effects.
- **A failure is a value, not an exception.** Return `{ ok: false, error }`
  and let the caller decide; a provider that throws takes a collector down
  with it.

---

## SlotProvider

A slot is a private database (and whatever else) for one lane, so that two
lanes running test suites cannot drop each other's tenants.

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | What the Box shows. |
| `available` | `boolean` | `false` means `launch` refuses before touching anything. |
| `slotCount` | `number` | How many slots the Box has rows for. `0` for none. |
| `ports(n)` | `-> {pg, redis, s3} \| null` | The host ports a slot exposes, for the Box. |
| `envCommand(n, quote)` | `-> string` | A shell fragment prefixed to a lane session's command so the session starts with the slot's environment. `quote` is the shell quoter to use on anything from config. `''` for none. |
| `list()` | `-> {ok, bySlot: Map(n -> {containers[], up, createdAt})}` | Read-only; what exists right now. |
| `existing()` | `-> number[] \| null` | The slots that exist. **`null` means "cannot tell", and a launch refuses rather than guessing** — two lanes on one slot is exactly what slots prevent. |
| `up(n, {cwd, env})` | `-> {ok, stdout, stderr, code, signal, error?}` | Bring a slot up. May take minutes. `signal` matters: a child killed by a restart is an interruption, not a failure. |
| `env(n)` | `-> {ok, ports: {pgPort, redisPort, s3Port}, error?}` | The slot's ports. **Never returns credentials**: `launch` writes what comes back into a job record. |
| `down(n)` | `-> {ok, error?}` | Stop a slot. |
| `dropVolumes(n)` | `-> {ok, removed[], skipped[], error?}` | Delete that slot's persistent data. The one destructive call in the program: `retire` checks the slot is a lane slot first, and the provider should check again that every name it deletes belongs to that slot. |

## GuardProvider

Something live sits next to the agents — a shared database, a staging stack —
and the guard's job is to notice when one of them is about to touch it. It
**flags and pushes; it never acts.**

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | |
| `active` | `boolean` | `false` means the collector never starts and the Box shows no guard block. |
| `forbiddenPorts()` | `-> number[]` | Ports nothing of ours may reach. |
| `healthProbes()` | `-> [{name, url}]` | Shown on the Box. |
| `containerFilter()` | `-> string` | A `docker ps --filter name=` prefix, or `''`. |
| `health()` | `-> [{name, ok, status, ms, error?}]` | One entry per probe. HTTP GETs, nothing else. |
| `containers()` | `-> {ok, list}` | `list` is `[{name, state, status}]`. |
| `preventive(sessions)` | `-> [{session, lane, pid, reason}]` | Looking for trouble before it happens — the `ports` provider reads each session's `/proc/<pid>/environ`. |
| `detective(laneOf)` | `-> [{session, lane, pid, comm, port, reason}] \| null` | Trouble that already happened. **`null` means the check could not run**, which the Box shows as a state rather than an all-clear. `laneOf(sessionName)` maps a finding onto a card. |

Every finding becomes a `danger` marker: first in the attention order, pushed
at once, never coalesced, never silenced by quiet hours.

## CiProvider

| Export | Signature | Contract |
| --- | --- | --- |
| `name` | `string` | |
| `active` | `boolean` | `false` means the collector never starts. |
| `prForBranch({repo, branch})` | `-> summary \| {none:true} \| {auth:false} \| {error}` | Four outcomes, and they are not interchangeable: `none` is "no PR yet", `auth` makes the caller back off for ten minutes and say `NEED-HUMAN` once, `error` is shown on the card. |
| `runs({repo})` | `-> {ok, queue} \| {auth:false}` | `queue` is `{runs[], queued, running, repo}`. |

A `summary` is:

```js
{
  number, url, state,          // OPEN | CLOSED | MERGED
  isDraft, mergeable, headSha,
  checks: { passed, failed, pending, total, failedNames[] },
  verdict,                     // red | pending | green | none
}
```

`verdict` drives the chip and the `blocked` marker: red raises one marker per
head commit, and green after red dismisses it.
