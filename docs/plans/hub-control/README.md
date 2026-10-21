# Hub control plan: steer every builder from one board, safely

**Status: agreed with the owner 2026-10-21; built in a session, not by an unattended loop.**
Every file this plan changes is security core (fenced for loops). The deployment side (which
devices, which builder first) is private and lives in the owner's homelab repo.

## 1. Goal
One laneboard, the hub, where the owner sees **and controls** every builder: approve or deny a
prompt, answer a lane, pause, stop, run a script, kill. Builder boards stay as a local fallback.
`fleet.hubControl` is off everywhere today; this plan is what has to be true before it goes on.

## 2. Why it is not on yet
The fleet build (see `docs/plans/fleet/`) went through 21 adversarial reviews; the cross-machine
boundary holds: a builder cannot make another builder or the hub act, signatures bind each command
to one builder and one use, routing never comes from builder data. A review on 2026-10-21 of the
deployed tree found three things that change what switching control on would mean:

1. **`control` is as strong as a shell today.** Free text from the hub can be typed into any pane,
   not only a Claude prompt, and lanes end in a shell. Leaving out the `term` scope does not limit
   much. `docs/fleet/auth.md` and `SECURITY.md` say otherwise.
2. **The hub cannot tell the owner's browser from a program running as the owner.** Its identity
   comes from the tailnet login, which is per user, not per device. Any process on a device logged
   in as the owner (agents run on those devices) can ask the hub to act, the way the browser does.
3. **A builder's kill switch depends on its audit log.** One corrupt line makes kill, pause and
   interrupt answer 503 on that builder.

Together, 1 and 2 would let an agent that goes wrong on the owner's laptop reach a shell on every
builder with control on. The work below closes that before control goes on anywhere.

## 3. Work (in order)
Each item lands with tests that fail before it. Item ids are referenced by the reviews.

**HC1. Control is not a shell.**
- From the hub (`kind: 'hub'`), `send-text` is always guarded: only into a pane whose command is a
  proven Claude process at a ready prompt (`assertTypable`), never into a shell. The UI's free-text
  send uses the same path.
- Text whose first non-space character is `!` (Claude Code's bash mode) is refused from the hub.
- `send-keys` from the hub: `C-c`/`C-d` and other control keys only into a Claude pane.
- `spawn` from the hub only with the builder's allowed modes and a prompt; never a bare shell.
- A paused builder refuses every hub `send-text`/`send-keys`, not only guarded ones.
- What remains a shell (`run-script` with builder-configured commands, terminals) is named as such.

**HC2. Step-up for control: the owner proves presence with a passkey.**
- The hub registers one or more **passkeys** (WebAuthn, platform authenticator: Touch ID, Face ID,
  a phone) for the owner. Registration starts from the hub's own CLI (`laneboard fleet passkey
  add`), which prints a one-time link that is valid for 5 minutes on the hub's origin.
- Before the first control action, the browser asks for the passkey (`navigator.credentials.get`
  with a hub challenge, user verification required). The hub verifies the assertion and opens a
  **control window** for that browser session: an HttpOnly, Secure, SameSite=Strict cookie bound
  to the hub origin, valid 15 minutes, ended by idle (5 min without a control action) or by
  "lock". Kill `*`, broadcast and `run-script` ask for the passkey every time (§6 D1).
- Every control route on the hub requires an open window; reads do not. Without one the answer is
  `403 step-up-required` and the UI offers "Unlock control".
- No new dependency: WebAuthn verification with `node:crypto` (ES256 and Ed25519 COSE keys, "none"
  attestation, a small in-tree CBOR reader limited to what authData and COSE keys use, with size
  and depth caps and its own fuzz test).
- The audit entry of each hub action records which passkey opened the window.

**HC3. The kill path does not depend on the audit log.** With a corrupt audit log, kill, pause
and interrupt still run and are recorded in a side log (`audit-fallback.jsonl`); everything else
still answers 503. `laneboard audit verify` reports the corruption and the side-log entries.

**HC4. Small fixes from the reviews.**
- A lane's `pr.url` from a builder is filtered on the hub like the Morning's links (`httpsUrl()`).
- `reach.unresolved` is never sent to clients (a count only).
- The hub service gets a memory limit in the documented unit (a hostile reconnect peaks ~170 MB).
- Before `term` is ever enabled: a link must not be able to open builder Y's terminal with the
  keyboard focus in it (review SR8 L5), and the terminal's web-links addon is decided.

**HC5. Docs say what is true.** `docs/fleet/auth.md`, `docs/fleet/control.md`, `SECURITY.md`:
what `read`, `control` and `term` allow after HC1; the passkey step-up; that whoever holds the hub
and an open control window can steer every builder with control on; the out-of-band kill runbook.

**HC6. Checks on a real builder** (no code): what `tmux list-panes` shows as the command of a
lane running Claude (HC1's "proven Claude process" depends on it); `install-claude` still installs
the hooks with the `_laneboard` field; a read of `gate.sh`; `laneboard audit verify` clean.

## 4. How it is built
- In a session with the owner, not a loop: agents implement HC1-HC5 on a branch `fleet/hub-control`,
  one item per commit, full `npm test` and the hygiene test green.
- Then **two fresh adversarial agent reviews** of the branch (one on HC1 + HC3, one on HC2), with
  the same threat model as `docs/plans/fleet/SECURITY-FIXES.md`. Findings are fixed and re-reviewed
  until both pass. The owner chose agent reviews over a line-by-line human read (2026-10-21).
- Merged to `main`, pinned on the hub by SHA (`git checkout --detach`, `npm ci --ignore-scripts`).

## 5. Rollout (the generic shape; names in the homelab repo)
1. The hub on the reviewed SHA; passkeys registered; reads unchanged.
2. **One builder** with scopes `read` + `control` (no `term`) and `hubControl: true`,
   `ingressPeerUid`, `allowedUsers` and `hubAddrs` set. Try every action once, including a kill
   and the out-of-band runbook. A few days of daily use.
3. The other builders, one at a time.
4. `term` only after HC4's terminal items, as its own decision.

## 6. Decisions
- **D1 (2026-10-21, decided):** a 15-minute control window opened by a passkey, ended by idle
  (5 min) or lock; kill `*`, broadcast and `run-script` ask every time.
- **D2 (2026-10-21):** agent reviews, no line-by-line human review (owner's choice); fresh
  reviewers for each item, and the rollout starts with one builder.
- **D3 (2026-10-21):** `term` stays off until it is decided on its own.
