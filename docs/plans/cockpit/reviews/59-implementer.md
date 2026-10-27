# Review, round 59: the implementer

Read: `spec/protocols.md` (all, new since round 26), `DECISIONS.md` (D10, D11, D24-D33, D44-D46,
D50, D56, D58, D61, D76, D79-D99), `c1-talk.md` (structure, §6/§14 scenarios, stand-in use),
`screens.md` (§6-§7 attributes), `PROGRESS.md`, `reviews/26-implementer.md`. Shot `c1-pane.html`
at 1368 (dark). Checked names against the code: `server/ws.mjs` (`helloMessage`, ping every 30 s),
`server/security.mjs` (`checkRequest`, `checkUpgrade`, `checkOrigin`, `checkCsrf`),
`server/hub/client-ws.mjs` (`fleet` frame, `LIMITS.frameBytes/bufferedBytes/inboundPerSec`),
`server/config/mode.mjs`, `public/js/core/net.js` (`nextBackoff`). All names in `protocols.md`
exist and mean what the spec says. The question for every part: could I build it tonight, against
stand-ins, without asking anyone?

`protocols.md` part 1 is the first part I could mostly build as written: every message has a type,
a direction, an example and an error. The findings below are what still stops me.

## Findings, worst first

1. **D89 and D92 disagree on who serves the page, and neither fits `mode.mjs`.** (`DECISIONS.md`
   D89, D92; `protocols.md` §1.) D89: the room "also serves the cockpit page and `/api/cockpit/*`".
   D92: "the laneboard that serves the page answers everything but `/api/cockpit/*`", and D92's own
   overrule lists "the room serves the whole page" as the rejected option. And
   `server/config/mode.mjs` says a process is `builder` or `hub` because `server/state.mjs` and
   `server/ws.mjs` are module singletons. "A laneboard server with a `cockpit` section" on port
   7778 next to a hub: which `mode` is it? With `builder` it starts collectors, its own `/ws`, its
   own board on 7778. Is `cockpit` a third mode, a flag that turns the board off, or an add-on to a
   `builder` (the one-box case)? Fix: rewrite D89 to D92's split; add one D-line: "the room is
   `mode: builder` plus a `cockpit` section (one box), or `mode: cockpit` (a room alone: no
   collectors, no `/ws`, only `/api/cockpit/*` and MCP)", with the `MODES` change and the boot file
   (`server/boot/cockpit.mjs`) named. Also list the room's ports in one place: page/board `7777`,
   room `7778`, MCP `7790` (D58).

2. **The tests run against "the stand-in room", so the real room is never tested.** (`protocols.md`
   §9; `c1-talk.md` §6 "the stand-in room and the fake agent", S-C1-17, S-C1-18, S-C1-23;
   `c3-see.md` §9.) If the room is a stand-in, then the 5 s forced stop (D32), once-only `clientId`
   (D95), replay vs snapshot (D94), the limits (D99) and the fake agent behind it are all stand-in
   code, and the C1 night ships a page plus a fake. If "stand-in room" means "the real room with a
   fake agent and a fake board", say so. S-C1-18 needs a room that "drops the next prompt" (a fault
   injector), which is neither. Fix: in `stand-ins.md` (T18) define three things: the real room
   process started by the test with `cockpit.agent.kind: fake` and a script; the fake agent (a
   bridge-side stand-in replaying a script); a fault hook on the real room (`POST /__test/drop`,
   only with `LANEBOARD_TEST=1`). Replace "stand-in room" everywhere with the right one of those.

3. **C1 and the protocol are written for two Q-O1 answers at once.** (`protocols.md` §3.1
   `delivery`, §3.3, §3.4; `c1-talk.md` §8, S-C1-16; D32; T85 open.) `c1-talk.md` §8 and S-C1-16
   are still a) "send stops the turn"; `protocols.md` has `queued`, `prompt.taken` and
   `cancelled` for d), with "T85 specifies the times". The rules say write for the recommendation
   (d). As it stands I cannot write S-C1-16's test or the room's handler. Also the `snapshot` cannot
   hold d): a turn has one `prompt`, so a prompt queued into a running turn has no place in
   `turns[].items` and vanishes on reload. Fix: do T85 before any C1 night; add an item kind
   `{"kind":"prompt","clientId":…,"text":…,"state":"queued|taken|cancelled"}` to §2.2's `items`;
   give the resend timer (10 s after `result`) a message or say it is room-internal.

4. **The browser cannot see an HTTP 403 on an upgrade, so "no retry" is not buildable.**
   (`protocols.md` §2.3 row "(HTTP 403)", §8 "33rd upgrade gets HTTP 503".) A refused upgrade gives
   the page `error` then `close` with code 1006, exactly like a down room. The page cannot read
   the body, so it cannot show `bad-origin` in the console or skip the retry. Fix: either accept
   the upgrade and close at once with new codes (`4403 bad-origin`, `4503 too-many-links`) so the
   page can tell; or say the page treats it as room-down and retries with backoff, and only the
   room's log names the reason. The first is testable with `framereceived`/`close` in Playwright;
   I would pick it. Same check for `4401`: the room must accept the upgrade first to send it;
   say that.

5. **Two close reasons share 4401 and the page must parse the reason text.** (§2.3 `unpaired` vs
   `revoked <time>`.) Parsing free text is fragile and a reason is limited to 123 bytes. Fix:
   `4401 unpaired`, `4402 revoked`, and the revoke time in a last `{"type":"revoked","at":…}` text
   frame before the close (D-line).

6. **Fixture extraction (D98) has no rule, and most messages have no required-field list.**
   (§9, D98.) "Every fenced `json` block and every example cell": but `stop`, `new`, `history`,
   `history.turns`, `undo`, `show.undo`, `prompt.taken`, `audio.cancel`, `touched`, `talk`,
   `talk.state` are inline code spans in prose, neither fenced nor in a cell, so the reverse check
   ("every type has an example here") fails for them on day one. The "drop one required field fails"
   test needs a required/optional list per type; only `hello`, `welcome` and `prompt` have field
   tables. Is `sentAt` on `text.delta` required? `detail` on `turn.end` `error`? `why` on
   `show.result`? Fix: state the extraction rule ("every code span or fenced block that parses as
   a JSON object with a string `type`"), and add one table at the end of §2: type, direction,
   `seq` yes/no, required fields, optional fields. Also: a test in `npm test` reading
   `docs/plans/cockpit/spec/protocols.md` breaks when the plan folder is archived; say the build
   night copies the file to `docs/cockpit/protocol.md` and the test reads that.

7. **Where the conversation lives across a room restart is unspecified.** (§2.2 `snapshot` after
   "room restart"; `c1-talk.md` §11 "same session id"; D85 covers cards only; Q-O24 open.) After a
   restart the snapshot must hold "the last 50 turns" and the room must resume the agent's session.
   From memory? From a file? Which session id, kept where? I would guess
   `<stateDir>/cockpit/conversation.jsonl` (0600) of the room's messages plus `session.json`, but
   that is a retention choice (Q-O24). Fix: write for Q-O24's recommendation, `(pending Q-O24)`,
   with the file names, and one scenario: room restarts mid-conversation, page reconnects, gets a
   `snapshot` with the 23 turns, the next prompt goes to the same session.

8. **`cockpit.url` is a path that can only have one value.** (§1 D93.) The page gets
   `"cockpit":"/api/cockpit"` whatever `cockpit.url` says, and the room's routes are fixed at
   `/api/cockpit/*`. A user who sets `/agent` breaks the page. And in the one-box case the same
   process has both `cockpit.url` (board side) and the room's `cockpit` section: one key or two?
   Fix: replace `cockpit.url` with a boolean (`cockpit.enabled`, or "the board has a room
   behind it": `cockpit.front: true`); the hello field becomes `"cockpit":true|false`. Update D17.

9. **Utterance lifetime is open.** (§6.1.) Does the utterance close at `audio.stop` or at
   `stt.final`/`stt.error`? A quick second press 0.5 s after a release sends `audio.start` while
   the room waits for the final: `not-now` (the press does nothing) or a second open utterance?
   And with `config.languages` `["auto"]`, what is `audio.start.lang`, and which `lang` does the
   spoken `prompt` carry (`stt.final` has no detected language)? Fix: "an utterance closes at
   `audio.stop`/`audio.cancel`; its final may arrive after a new one opened (keyed by
   `utterance`)"; `lang:"auto"` allowed; `stt.final` gains `lang`.

10. **The 25 s and the 5 s grace do not compose clearly.** (§2.2 "lost after 25 s without any
    frame, shows it after the 5 s grace"; D10.) On a clean close, is the strip shown at 5 s? On a
    silent link, at 25 s or at 30 s? S-SCR-18/19 assert times. Fix: one sentence: "the grace
    starts at the `close` event or at the 25 s mark, whichever comes first; the strip shows 5 s
    later".

11. **The protocol has no demo path.** (`docs/plans/product.md` rule 2; T36/T76 open.) The static
    demo build has no room. Does `?demo=1` run a protocol stand-in in the page (a fake link
    emitting `welcome`, `snapshot`, scripted turn events), or a separate demo pane? With the
    protocol now fixed, the cheapest answer is a client-side fake link replaying fixture messages
    from §10. Fix: say that in T76, and that the demo link sets `hello.cockpit` itself.

12. **Still open from round 26, and each still stops me.** The cockpit button has two specs
    (`screens.md` §4 `[data-cockpit-button]` `AGENT` vs `c1-talk.md` §2 `[data-cockpit-open]` +
    `[data-talk]`; T26/T41). `split`'s conversation column has no rects (T27); `split` is the
    default layout. S-SCR-19's retry series is still wrong against `nextBackoff` (T28). No Wall
    contract (T31). No stand-in control API (T32/T18). No `data-*` table (T33). The Markdown
    renderer is undecided (T34). That is seven of my fourteen round-26 findings with no edit yet.

13. **The bridge side does not exist.** (T16 open; `protocols.md` §3.2 "part 2".) The room's
    `turn.state` `working` vs `answering`, `turn.retrying`, `agent-exited` vs `agent-down`,
    `forced` all come from bridge events with no mapping yet. A C1 night can build the screen half
    against fixtures, not the room half. Fix: T16 next, as the priority note says, and in
    `slices.md` say the C1 night needs T16 and T18 done.

14. **Small guesses.**
    - `hello.page` values: `wall` and `app` only? The Map's route is in `focus.route`.
    - `snapshot` parts: does every part repeat `seq` and `conversation`? Do events with a higher
      `seq` arriving between parts wait until the last part (they must)?
    - `history.turns` while a reconnect replays: can the answer interleave with replayed events?
      (It has no `seq`; say it is applied to the older-turns list only.)
    - `show` "to each target link": which links are targets is `c4-show-canvas.md`'s; name the
      section.
    - `card.close` held while room-down: if the card was replaced meanwhile, does the close apply
      to the new version? (`unknown-id` will not fire; the id is the same.)
    - `welcome.now` skew "logged once": logged where on a kiosk with no console? `?perf=1` is
      being dropped (T53).
    - Sketch `c1-pane.html` still draws `● ANSWERING`, no `NEW`, and "Say \"show me\" and I fly to
      it." (T47/T70/T82 open); a builder copying it gets the wrong header.

## Contradictions with `spec-input.md`, and what should be owner questions

- **D92 departs from the plan's "room → hub → screens"** and needs a reverse proxy or
  `tailscale serve --set-path` in front of the board on every two-process setup. That is a
  deployment one-way door for anyone not on one box; it is correctly flagged under "For the owner"
  but is a D-line, not a Q-O. It should be a Q-O with the D92 choice as the recommendation.
- **D89 and D91 are security-relevant and were closed as D-lines** (T55). The rules send
  security-relevant choices to `QUESTIONS.md`. D91's own text says "security-relevant".
- **Conversation storage on disk** (finding 7) is retention of the owner's spoken words: Q-O24's
  ground. It must not be decided silently by the build night.
- **`spec-input.md` §7.1 is answered two ways** in the same spec (finding 3).

## Rubric

score spec concrete 8
score spec complete 4
score spec consistent 4
score spec testable 5
score spec ownerfit 6
score spec simple 5
score spec safe 6
