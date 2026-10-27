# Review, round 73: the owner

Read: `spec-input.md`, plan, `PROGRESS.md` (tasks, morning report), `spec/README.md` (budget),
`slices.md` §1, §3.1, §3.4, §3.7, `QUESTIONS.md` (the morning fourteen), `c1-talk.md` §1-§2, §8,
`c2-voice.md` §1-§4, §8. Sketches shot at 1368 dark: `c1-pane.html`, `screens-split.html`,
`c2-states.html` (`$RUN_DIR/shots/73-*`). My earlier reviews are `21-owner.md` and `52-owner.md`;
what they asked and has been done (freeze, `slices.md`, C1 sees the night, Jobs before C6, the
morning list cut) is not repeated. Quotes in "…" are from `spec-input.md`.

## Findings, worst first

1. **C1 is still written for interrupt while you recommend steer.** (`c1-talk.md` §8, S-C1-16,
   `c2-voice.md` §2 "During a running turn this send stops the turn first", S-C2-09, D32/D33.)
   Q-O1 recommends d) because research Q8 found my terminal steers. §8 still says "Written for
   Q-O1's recommendation a)", and the hint `SENDING STOPS THE ANSWER` teaches me the opposite of
   what I do every day. A builder night reads §8, not the question, and builds the kill. Fix: T85
   and T88 are the next spec round, before any other task. §8's first line names d); the hint
   becomes `SENDING ADDS TO THE ANSWER` (or nothing); S-C1-16 is rewritten with the `· QUEUED`
   label and a fake-agent `next` priority.

2. **The night ended with ~25 "before a C1 night" tasks open, and asks me for another spec night.**
   (`PROGRESS.md` morning report, `slices.md` §7.) The deadline is 20:00 today; rounds are still
   running. Every panel review now (this one included) adds tasks nobody does. Fix: a priority
   note in PROGRESS.md: no new review and no new chapter until `slices.md` §7 is empty. Order:
   T85/T88, T57, T86, T40/T94, T96/T97/T100, T89/T90/T92, T33/T34/T36/T76/T93, T68, T91. Then the
   sketch round of finding 5. Then C2's list.

3. **"Shut this off in 3 hours" is still not something the Jobs slice can do.** (`slices.md` §3.7,
   D115.) My example in §3 is shutting something off. Jobs can remind, or run a script from
   `cockpit.jobs.scripts`, and "a job that changes another machine waits for C6", with the reply
   `I can remind you at 15:10, but stopping builder-b needs the act step (C6).` So I get an alarm
   clock, and C6 has no date. A script I listed myself in the room's config, from the infra repo,
   is already my yes. Fix: an owner question (extend Q-O23 or a new Q-O): a) as written; b) a
   listed script may touch other machines (it is mine, reviewed in the repo), created and
   cancelled only through the confirm card, one audit line per fire. Recommend b). The agent's
   line then reads `I can run stop-builder-b at 15:10. Confirm?`. Also: Jobs needs `c5-c6.md`
   (T14) for the confirm card, which is unwritten; say so in `slices.md` §1's "Needs first" (it
   does) and in the morning report's "Not written" as blocking Jobs.

4. **Text I read while holding the button is still 13 px.** (`c2-voice.md` §3: hint line 13 px,
   `CANCEL` 13 px; `c1-talk.md` §8 13 px.) I said this in round 52 (finding 9); T43 has been open
   since round 32. At arm's length on a slanted screen I cannot read 13 px while speaking. Fix: T43
   before C2, and the C2 slice's done-when names the text-floor test (no instruction under 18 px).

5. **The pictures still show another product.** (Sketches, unchanged since round 52.) `c1-pane`:
   `● ANSWERING` (spec `● WORKING`), placeholder `Type, or hold TALK` (spec `Type or hold to
   talk`), no `CHAT`, no `NEW`, and a reply promising `Say "show me" and I fly to it.` that C1
   cannot keep. `screens-split`: an `AGENT` button, no conversation column (D78/D117), and a
   sketch note about "the AGENT button". I will decide Q-O11 and Q-O12 by looking at these. Fix:
   one round redraws `c1-pane.html` and `screens-split.html` (T47, T25, T82, T101) right after
   finding 2's list, and the morning list points at the two shots next to Q-O11 and Q-O22.

6. **Nothing tells me whether it feels like the terminal on my real setup.** (`spec/README.md`
   budget.) B2 (first word ≤ 1.0 s) holds only against the fake speech; the real figure is
   "measured, not promised", and T67's B9 (prompt → first reply sentence) is open. Fast is the one
   thing I asked for twice. Fix: the C1 and C2 done-whens each end with one measured run on the
   real screen, real speech, real agent, the B2/B3/B9 measures pasted into PROGRESS.md. Not a test
   gate, a number for me in the morning.

7. **The DE/EN choice is hidden by default.** (`c2-voice.md` §8, D48.) Default
   `cockpit.stt.language: "en"`; the language button appears only with a list. I said "a DE/EN
   choice in the UI". Fix: default `["en", "de"]`, so the button is there out of the box; a
   one-language user sets one code. Update D48 and S-C2-13's Given.

8. **`MICROPHONE OFF` still goes after 5 s.** (`c2-voice.md` §4 "One hint", D45; T84 open.) After
   the 30 s silence close I look back from the main monitor and the screen just reads idle. Fix:
   T84 before C2, as written.

9. **Q-O6 should not cost me a minute of the morning.** (`QUESTIONS.md` Q-O6.) b) and c) break
   "never an empty screen" and hide a fault; there is nothing to choose. Fix: close it as a D-line
   (a), strike to reopen) and the list is thirteen.

10. **The speak-up marker is asked before its loudness.** (Q-O11 c) in the morning list, Q-O5 under
    "Can wait", Speak slice §3.4 with zero scenarios.) I can answer c) only knowing the marker is
    quiet (no sound, no flash). Fix: one sentence in Q-O11 c): "the marker is a static 8 px dot on
    the talk button, no sound; loudness beyond that is Q-O5".

## Decided where it should have been my call, or against what I said

- **D115 / `slices.md` §3.7**: "a job that changes another machine waits for C6" takes "shut this
  off in 3 hours" (§3) away with no date; should be an owner question (finding 3).
- **D48 default `"en"`**: against "a DE/EN choice in the UI" (finding 7).
- **`c1-talk.md` §8 written for a)** while the question recommends d): not my call to reverse, but
  the spec must follow its own recommendation (finding 1).
- **Q-O6** is asked though `product.md` decides it (finding 9, the other direction).
- Fine as decided: the slice order with the night in C1 and Jobs before C6 (my round-52 asks), Q-O22
  b), Q-O2 d), Q-O23 a) for C1, D29 (listen on press), the 400 ms hold, D20 (no keyboard on open).

## Scores

score spec concrete 8
score spec complete 4
score spec consistent 4
score spec testable 7
score spec ownerfit 6
score spec simple 4
score spec safe 7
