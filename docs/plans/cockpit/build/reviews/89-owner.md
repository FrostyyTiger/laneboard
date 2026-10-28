# Review, round 89: the owner

Run `cockpit-c1`, 10:40. Branch head `7636776` (T25). Ticked since the last review (35): T22, T23,
T23b, T24, T24b, T25, plus fixes B140/B191 (S-C1-04) and S-C1-18's timing. Looked at: `PROGRESS.md`,
`DECISIONS-c1.md` B130-B199, `run.jsonl`, the round 88 stills and filmstrip (`88-queue`,
`88-queue-film`), `85-corner/console.txt`, `e2e/cockpit/c1-queue.spec.mjs`, `server/cockpit/redact.mjs`,
`server/cockpit/bridge.mjs`, `c1-talk.md` §1, §8, `screens.md` §4.

I did the 07:00 run myself, touch only, in a headless Chromium at 1368x912 at 2x (`hasTouch`), dark and
light. It ran against a room under test with the fake agent: `c1-voice`'s `night go` turn plus a long
turn of my own for STOP, 4 seeded turns. Stills: `$RUN_DIR/shots/89-owner/{dark,light}-*.png`. The
script and room are in `$RUN_DIR/r89/`, not in the repo.

## What I did at "07:00", and how it felt

| step | what happened | measured |
| --- | --- | --- |
| tap `CHAT` | pane slides in, yesterday's turns, pinned to the end | `data-pane=open` 68 ms after the tap |
| tap the input, type `how did the night go?`, tap `SEND` | block at once, `● WORKING`, a tool line, then text streams with a cursor | thinking +37 ms, first text +375 ms (the fake writes at 300), idle +3.2 s |
| keyboard after `SEND` | stays up, focus stays in the input | `focus: true` throughout (T49's point is solved by B182) |
| `tell me everything`, `■ STOP` at 3 s | `● STOPPING` in the header, then `READY` | stopping +50 ms, `READY` +365 ms |
| tap `NEW` | nothing. It is disabled (B111, waits for T29) | tap timed out |
| tap `CLOSE` | pane gone | 53 ms |

**Speed is right.** This is as fast as my terminal, maybe faster. Nothing waited on the screen. The text is
big enough to read from my chair (28 px mono replies, the `YOU`/`AGENT` rows). Would I use it daily?
For asking, yes, already. But I can't start fresh in the morning, a stop leaves a half sentence with no
explanation, and opening the pane hides my fleet. Those three are what I'd hit every morning.

## Findings, worst first

### 1. The night lost 7 hours to the network, and the review tasks are still waiting
- Seen: `run.jsonl` rounds 44-82 (22:54 to 05:34), all 39 builder rounds `api-error`, each one
  `API Error: Can't reach the API server — check your internet or DNS (EAI_AGAIN)` after ~6 min. Only 29 of
  60 tasks are done and 36 of 73 ids have a test. C1a (T26) is not finished at 10:40.
- Why it matters: deadline 23:00, about 12 rounds of 60 min. That is enough for T26-T30 and the review
  fixes. It is not enough for C1b (MCP, `morning`, "how did the night go?" for real in T39, the demo).
- Fix: none in code. For the loop (fenced, mine): after 3 network errors in a row, back off to 30 min
  and write one line to `owner-notes`. 39 identical 10-minute rounds told me nothing the first 3 didn't.
- Order for the rest of today: T26 (stop), then **T45, T53, T52** (security, small, see finding 4),
  then T27-T29 (errors, status line, new conversation). Then stop at the C1a/C1b line (README §9). I'd
  rather have C1a solid and the security fixes in than T30-T34 half done.

### 2. Opening the pane hides almost the whole fleet on the Map
- Seen: `89-owner/dark-1-closed.png`: hub, hv1, vm-a/b/c, ci and builder-a sit at x 560-1250.
  `dark-2-open.png`, `dark-5-answered.png`: the pane covers x 760-1368, so only `SCRATCH` and `BACKUP`
  are left in sight. The hub's centre is under the pane.
- Why it matters: this is the opposite of what I asked for. I open the pane to ask about the fleet,
  and the fleet goes away (spec-input §1: "If there's no visual overview, it's hard for me to come up
  with new ideas"). I want the picture and the answer side by side.
- Build vs spec: the build is right. `c1-talk.md` §1 says only that the Map "pans and selects" in the
  part in sight, and that show commands centre in x 0-759. It says nothing about re-fitting on open.
- Fix: a question for me under `## For the owner`, not a builder change: "on open (and close), with
  nothing selected, the Map re-fits into x 0-759 (and back), in the pane's slide time". My answer will
  be yes. Until then the builder should leave it as it is.

### 3. STOP leaves a cut-off sentence and claims an age
- Seen: `dark-7-stopped.png`: the reply ends at `…one by one, in far`, no line under it. The `AGENT`
  row reads `09:42 · 0:03`, the same as a finished answer. `READY` comes 365 ms after the tap, which is
  good. But the screen does not say that I stopped it. `c1-talk.md` §8 wants `STOPPED AT 09:42`
  (`[data-turn-stopped]`, `--text-3`).
- Why it matters: next morning I scroll up and see half a sentence. Was it a crash, or me? This is T26
  (S-C1-17), not yet built, so it is not a wrong build. I list it because it is the next task, and it
  is what I'd notice first.
- Fix: T26 as written, including the forced `(FORCED)` variant. Also add one step to S-C1-17: after the
  stop, the turn's last child is the `STOPPED AT` line, under the cut text.

### 4. Two security fixes from earlier reviews are still not in, 70 rounds later
- Seen: `server/cockpit/redact.mjs:33` is still case-sensitive.
  `createRedactor({secrets:[]}).text('authorization: bearer hunter2pass')` still returns the string
  unchanged (T45, from my round 18). `server/cockpit/bridge.mjs:216` still pushes raw stderr lines
  (`cut(line)`, T53, review 35). T52 (loopback for `local`) is open too.
- Why it matters: the whole point of redaction is that I never have to think about it. The DNS outage
  is not the cause here: these sat below the feature tasks by triage.
- Fix: run T45 and T53 right after T26, then T52. Each is under 20 lines with a test. I review them
  anyway (fenced.txt's last block), so the sooner they're on the branch the better.

### 5. `NEW` is drawn, looks tappable, and does nothing
- Seen: `light-6-long.png`: `NEW` in `--text-3` = `oklch(46% …)` on white, next to `CLOSE` in
  `oklch(15% …)`, same border, same size. In light the two read almost alike. In dark the difference is
  clearer (`62%` vs `96%`). A tap does nothing, with no pressed state.
- Why it matters: "start a new conversation" is one of my five morning moves. A dead button in the
  header feels like a toy. B111 drew it to keep its rect, which is fine for layout.
- Fix: T29 makes it real; that's the fix. Until then, at least give `.ck-btn:disabled` a dimmer border
  (`--line` instead of `--line-strong`) so it reads as off in light too (the spec's `:disabled` look is
  silent, B-line). Same for `SEND` in `wait` (`data-send="wait"` has the same issue for the 1.0 s).

### 6. The 1.0 s grey `SEND` after sending is fine
- Seen: my run: `SEND` reads `wait` from +37 ms to +1045 ms, then `■ STOP`. That is D268 and I agree
  with it: no stop under my sending finger.
- What I'd watch: during that second the header says `● WORKING` and the slot says a greyed `SEND`.
  Nothing on the screen says "you can stop in a second". I won't ask for a hint (D121 says no hint
  line). Noted only so nobody adds one without asking me.

### 7. The tool line of a failed call does not look failed
- Seen: `dark-7-stopped.png`: `read the Morning for tonight · 1 failed` has, by eye, the same colour and weight as
  the successful lines in `88-queue`. The only signal is the words ` · 1 failed`. Opened, the row ends
  `failed` in the same grey.
- Why it matters: in the morning, a failed read of the Morning means the answer below it is a guess.
  (Here the fake agent then says "One run is stuck" anyway. That's the script, but a real agent may do
  the same.)
- Build vs spec: `c1-talk.md` §4-§5.1 says "a failure grey", and every tool line is grey, so the build
  follows the spec to the letter. I think the spec is right not to use red (D25: red is for my
  attention, not the agent's errors). It is a question for me, not the builder: is ` · 1 failed`
  enough? For now, yes.

### 8. Decisions I would not have made (B130-B199)
- **B194** a prompt sent during a turn gets its own `SENDING` block at the end: right, that's how my
  terminal shows it.
- **B182** D132 for every pane button, not only `SEND`: right. The keyboard staying up is what makes
  typing two questions in a row feel natural.
- **B192** `SEND` in the talk button's rect with `stt.url: none`: fine for C1, it's where my thumb goes.
- **B173** `RETRY`/`EDIT` 96x48: fine.
- **B111** (older, finding 5): drawing a dead `NEW` is acceptable only until T29.
- Nothing here I'd overrule.

### 9. The steer film (round 88) reads well
- Seen: `88-queue-film/sheet.png`: `SENDING`, then `QUEUED` in grey text, then the queued block stays
  last while the tool runs. When the agent takes it, it slides into place without the view jumping
  (B197). The worst gap of 20 466 ms in `perf.json` is the film's setup, not a frame drop. The frames
  at 20.6-27.1 s are 400-500 ms apart, as asked.
- No finding. This is the behaviour I wanted from Q-O1's steer.

## Build vs spec
- Finding 2 (the Map behind the pane): the build follows the spec, and the spec is silent. My question
  goes under `## For the owner`; I expect to want the re-fit.
- Finding 3: the build is behind the spec (T26 not yet built), not against it.
- Finding 5: the spec gives the disabled look only as `--text-3`. Light theme needs more than a text
  shade. That's a spec gap, B-line level.
- Finding 7: the build and the spec agree. I think the spec is right.
- Finding 4: the build is behind the spec (`c1-talk.md` §5.3 says case-insensitive). The spec is right.

## Rubric

score pane spec 7
score pane tests 7
score pane legibility 7
score pane touch 6
score pane speed 9
score pane safety 7
score room spec 7
score room tests 7
score room legibility 6
score room touch 6
score room speed 8
score room safety 5

## Console lines read

`$RUN_DIR/shots/85-corner/console.txt`:
```
dark 1368: no errors
dark 800: no errors
light 1368: no errors
light 800: no errors
```

`$RUN_DIR/shots/88-queue-film/console.txt`: empty (0 bytes).

`$RUN_DIR/shots/89-owner/dark-console.txt` (mine: the script's log; page errors and console
errors/warnings would be listed here, there were none):
```
1.15s pane open attr after 68 ms (tap incl.)
1.66s focused after open: <button class="ck-btn ck-open" type="button" data-cockpit-open="" aria-label="Cl
2.70s +37 ms {"turn":"thinking","send":"wait","focus":true}
2.76s +99 ms {"turn":"working","send":"wait","focus":true}
3.04s +375 ms {"turn":"answering","send":"wait","focus":true}
3.71s +1045 ms {"turn":"answering","send":"stop","focus":true}
5.84s +3175 ms {"turn":"idle","send":"send","focus":true}
10.46s slot before stop: stop "■STOP" {"x":1280,"y":824,"width":64,"height":64,"top":824,"right":1344,"bottom":888,"left":1280}
10.51s stop +50 ms {"turn":"stopping","send":"send","status":"COCKPIT● STOPPINGNEWCLOSE"}
10.83s stop +365 ms {"turn":"idle","send":"send","status":"COCKPITREADYNEWCLOSE"}
11.25s NEW: disabled=true
12.75s NEW tap failed: locator.tap: Timeout 1500ms exceeded.
13.41s pane closed after 53 ms
14.03s buttons: NEW@0,0 0x0 | CLOSE@0,0 0x0 | RETRY NOW@0,0 0x0 | read the Morning for tonight · 1 failedmorning  {"window":"tonight"}  210 ms  failed@0,0 0x0 | looked at the runs · 1 failed@0,0 0x0 | ↓ NEW@0,0 0x0 | SEND@0,0 0x0 | CHAT@1288,760 48x48
```

`$RUN_DIR/shots/89-owner/light-console.txt`:
```
1.18s pane open attr after 68 ms (tap incl.)
1.70s focused after open: <button class="ck-btn ck-open" type="button" data-cockpit-open="" aria-label="Cl
2.74s +38 ms {"turn":"thinking","send":"wait","focus":true}
2.80s +100 ms {"turn":"working","send":"wait","focus":true}
3.08s +376 ms {"turn":"answering","send":"wait","focus":true}
3.74s +1040 ms {"turn":"answering","send":"stop","focus":true}
5.86s +3158 ms {"turn":"idle","send":"send","focus":true}
10.45s slot before stop: stop "■STOP" {"x":1280,"y":824,"width":64,"height":64,"top":824,"right":1344,"bottom":888,"left":1280}
10.49s stop +36 ms {"turn":"stopping","send":"send","status":"COCKPIT● STOPPINGNEWCLOSE"}
10.80s stop +349 ms {"turn":"idle","send":"send","status":"COCKPITREADYNEWCLOSE"}
11.22s NEW: disabled=true
12.72s NEW tap failed: locator.tap: Timeout 1500ms exceeded.
13.39s pane closed after 52 ms
14.00s buttons: NEW@0,0 0x0 | CLOSE@0,0 0x0 | RETRY NOW@0,0 0x0 | read the Morning for tonight · 1 failed@0,0 0x0 | looked at the runs · 1 failed@0,0 0x0 | read the Morning for tonight · 1 failedmorning  {"window":"tonight"}  210 ms  failed@0,0 0x0 | looked at the runs · 1 failed@0,0 0x0 | ↓ NEW@0,0 0x0 | SEND@0,0 0x0 | CHAT@1288,760 48x48
```
