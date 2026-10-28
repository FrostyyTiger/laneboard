# Review, round 18: the owner

Run `cockpit-c1`, 18:41. Branch head `deadc10` (T14). Ticked since the last review: T1-T14 (there was
no earlier review). Looked at: `PROGRESS.md`, `DECISIONS-c1.md`, the loop's `run.jsonl`, the stills in
`$RUN_DIR/shots/r17-pane/` (round 17, **reverted**), `server/cockpit/redact.mjs`, the spec lines cited
below. I made no new stills: there is no pane on this branch to shoot (`public/js/cockpit/` and `e2e/`
do not exist).

## What I tried at "07:00"

Open the pane, type "how did the night go?", read, stop, new, close. **I can't do any of it.** There is
no cockpit button, no pane, no Playwright harness. 14 of 44 tasks done after 17 rounds, all of them
room-side. If I sat down at 07:00 with the branch as it is, the screen would look exactly like it did
yesterday. That is the whole review, really; everything below is about getting a pane onto the
screen by morning.

## Findings, worst first

### 1. The pane was built and then thrown away by the loop's own package guard
- Seen: `run.jsonl`, round 17: `wanted to change fenced files: package.json/package-lock.json
  (package-lock.json: churn beyond @playwright/test (top-level fields))`, outcome `no-task-done`.
  Round 17 had `public/js/cockpit/`, `public/css/cockpit.css`, `e2e/`, the link client and stills
  (r17-pane). All reverted.
- Cause (reproduced in a temp dir, not the repo): `npm install -D --save-exact @playwright/test@1.56.1`
  adds the four allowed packages **and** `"license": "MIT"` to the lockfile's root entry
  `packages[""]`, because `package.json` has `license` and the current lock does not. `pkg_guard` in
  `loop-build/run.sh` compares `packages[""]` whole, so it fails. Its message says "top-level fields"
  because the differing key is `""` and `", ".join([""])` is empty. So the message pointed the builder
  at the wrong place.
- Proof: same install, then `packages[""].license` removed → the guard returns 0.
- Why it matters to me: every T15 attempt fails the same way. The `[ui]` tasks T16-T42 all sit behind
  T15. This one line can cost the whole night's pane.
- Fix, next builder round (T15): after the install, delete `"license": "MIT",` from
  `packages[""]` in `package-lock.json` (only that line), then run the same guard locally (copy
  `pkg_guard` out of `run.sh` and feed it the old and new files) before committing. Don't hand-edit
  anything else in the lock.
- Fix, for me (fenced, the loop): `pkg_guard` should print `<root>.<field>` names when `""` differs.
  Or I add `license` to the lock on `main` once, so a clean install leaves it alone.

### 2. The night is behind, and only room work has landed
- 14/44 after ~10 h of rounds; ~12 rounds left before 07:00 at 60 min each. Even with T15 fixed on
  the first try, the best case is about T26 (end of C1a). C1b (errors, status line, the MCP tools,
  "how did the night go?" end to end in T39, the demo) won't happen tonight.
- Why it matters: what I want to use is a pane that answers from the board. The room, link, store and
  bridge are the right foundation, but none of it reaches the screen yet.
- Fix: no task reordering (the plan's order is fine and the spec is the contract). But T15's builder
  must get it through on the first try (finding 1). Rounds should stay one task each, not
  get stuck redoing a task.

### 3. Lower-case `bearer` in a reply is not redacted (B71)
- Seen: `server/cockpit/redact.mjs:33`, `SCHEME_TEXT` is case-sensitive. Checked with
  `createRedactor({secrets:[]}).text(...)`:
  - `authorization: bearer hunter2pass` → unchanged, **the secret goes to the screen and the file**
  - `Authorization: Bearer hunter2pass` → `Bearer [redacted]`
  Long tokens are caught by another rule; short ones are not.
- Why it matters: agents paste curl lines and headers in lower case all the time. The point of
  redaction is that I don't have to think about it.
- B71 made the rule case-sensitive to keep `The token in /etc/acme/env is …` (S-SEC-02) readable.
  That only needs the word **token** to be case-sensitive. `bearer` and `basic` in lower case
  are never ordinary prose followed by a secret.
- Fix: in reply text, match `bearer|basic` case-insensitively, keep `Token|TOKEN` as now. Add the
  lower-case `bearer` line above as a case in `test/cockpit-redact.test.mjs`. This is
  security-relevant: I review it anyway, but I'd take the fix now.
- Build vs spec: §5.3 says case-insensitive and D211's scenario needs "token" left alone. I'd
  follow both: the narrower exception, not the blanket one.

### 4. The reverted pane (r17 stills), for whoever rebuilds it
These are not on the branch. They show what T15 will probably produce again, so here is what I'd want different:
- `connecting-dark-1368.png` and `roomdown-dark-1368.png`: the header reads `READY` at full
  brightness while the pane says `Connecting to the cockpit room…` / `Cockpit room unreachable`.
  The spec says `READY` greyed (`c1-talk.md` §5.1, line 576). A bright READY next to "unreachable"
  is a lie on my desk. Fix: grey it (`--text-3`) whenever `data-cockpit` is not `live`.
- `roomdown-dark-1368.png`: the line `Sending and voice come back with the room.` above the input
  row is missing (`screens.md` §7, S-SCR-17). Without it the greyed `SEND` gives no reason. It's
  T32's scenario, but the line costs nothing once the state exists.
- `open-dark-1368.png`: two `CLOSE` buttons, the header one and the corner opener at (1288, 760),
  which floats over the conversation. Per spec (`c1-talk.md` §1, D117), so I won't fight it, but it
  looks like a stray button. Keep text ending at y ≤ 744 as the spec says; in this still it does.
- `open-light-800.png`: at 800 wide the pane is not the whole width and the Map shows a sliver.
  The spec says whole width, `inert` Map (`c1-talk.md` §1.2, S-C1-46). That's T17; noted so nobody
  ships the sliver.
- Reply text: mono 28 px reads well at arm's length, and so do the labels `YOU · 18:22` /
  `AGENT · 18:22`. The input holds 21 characters a line. "how did the night go?" is exactly 21, so
  any real sentence wraps. That is spec (pending Q-O18), and my answer will be the 22 px option.

### 5. Decisions I would not have made
- **B96** `welcome.lookedAt` = the room's `now` when it has no look: after a tablet reload at 07:00
  nothing counts as "new since you looked", which is exactly the morning question. Acceptable for C1
  (no `looked.json` yet), but the overrule should be the conversation's last turn I saw, not
  `now`. I'll answer it with the owner questions.
- **B71**: see finding 3.
- **B95** the screen named `board`: fine.
- **B81** `new` during a turn waits up to 5 s for the stop: fine, but `NEW` must show it's
  working (`● STOPPING`) the moment I tap. Otherwise I'll tap it twice.
- The flaky `queued next-tool-end` test (For the owner, round 14): widen `endAt` now. A flake in
  `npm test` is how a good round gets reverted.

### 6. Speed, from what exists
No end-to-end path exists to time. Room side: B102's ping and heartbeat choices are sensible.
`STOP` to `READY` is ≤ 5.5 s by spec. In my terminal, Esc stops at once; the pane must show
`● STOPPING` in the first frame (S-C1-41) or it will feel broken.

## Build vs spec
- Finding 3: the build is narrower than §5.3 (case-sensitive). The spec is right for `bearer`/
  `basic`, and D211 is right for `token`. Build both.
- Finding 4, header `READY` during connecting: the spec is right.
- Nothing else on the branch disagrees with the spec as far as I can see. The disagreements already
  under For the owner (B37 prefix, T7 audit-dir walk, T14 guard/4403) are mine to answer.

## Rubric

score pane spec 2
score pane tests 1
score pane legibility 4
score pane touch 2
score pane speed 2
score pane safety 5
score room spec 7
score room tests 7
score room legibility 6
score room touch 4
score room speed 6
score room safety 6

Notes on the pane scores: there is no pane on the branch. Legibility 4 and safety 5 are guesses
from the reverted r17 stills, not from anything I can open.

## console.txt read

`$RUN_DIR/shots/r17-pane/console.txt`, every line (it holds one empty line):

```

```
