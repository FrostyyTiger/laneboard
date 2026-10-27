# Cockpit spec: decisions

Small, reversible choices made while writing the spec or building it. The owner may overrule any of
them; the overrule part says what changes then. Taste, one-way doors and anything security-relevant
go to `QUESTIONS.md` instead.

Format, one line each, numbered in order and never renumbered:

`D<n> <choice> — because <why> — overrule: <what changes if the owner disagrees>`

## List

- D1 In the spec "room" means the cockpit room; a Map node with `kind: room` is a "room node" — because laneboard already uses "room" for a Map node kind (`docs/map.md`) and the plan uses it for the agent's machine, so one word needs a qualifier — overrule: pick another name for the agent's machine (e.g. "cockpit host") and replace it across `spec/`; no code exists yet.
- D2 The Wall page has four layouts, `wall`, `canvas`, `split`, `switch`; the app's views get only the cockpit button, no canvas — because the Wall is the screen's idle page and the plan keeps the app's views unchanged (Wall plan D1) — overrule: add a canvas to the app shell as well, `screens.md` §1 gains a row.
- D3 A screen's layout is stored on the screen (`localStorage` `cockpit.layout`), the URL `?layout=` wins over it — because a kiosk sets its start URL once and a layout is about one display, not the room — overrule: store it in the room per device token (T3), so a reset browser keeps its layout.
- D4 Opening the pane, a running turn and an open microphone pause the Wall's 60 s idle timer; opening the pane stops the tour where the camera is — because the tour must not fly away from what the owner and the agent are talking about — overrule: let the tour run under the pane; `screens.md` §2 table changes.
- D5 The pane closes itself after 300 s without touch, never during a turn or with the microphone open — because an open pane over a touring Wall hides it from across the room — overrule: change the constant, or 0 for never.
- D6 The idle and layout numbers (60 s, 300 s, 1280 px, 608 px) are named constants in one client module — because research Q1 asks that thresholds live in one place for the owner to change — overrule: move them into config (`cockpit.*`).
- D7 The cockpit button reads `AGENT`, 64x64 px, bottom right — because it names what the tap reaches, and "talk" is the talk button inside the pane (C2) — overrule: rename the label; one string in the client.
- D8 In `split` the pane opens over the canvas half, never over the wall half — because the agent's show commands move the wall's camera and the owner must see it — overrule: open it over the wall half; S-SCR-11 changes.
- D9 In `split` the canvas is a fixed 608 px column and the wall half takes the rest — because the card grid (T11) then has one size on every split screen — overrule: a 50/50 split; T11's grid scales with it.
- D10 A lost room link shows on screen only after a 5 s grace; the room sends a heartbeat every 10 s and the link counts as lost after 25 s without a frame — because short blips should not flash a warning across a desk screen (written back by the final round: round 18 cited D10-D17 in `screens.md` §6-7 but its decision lines were lost) — overrule: change the three constants; S-SCR-17/18 change.
- D11 The room link retries with the board socket's backoff (500 ms × 1.8 up to 15 s, the same `nextBackoff`) — because one retry rule is easier to reason about and test — overrule: give the room its own backoff constants.
- D12 A draft typed while the room is down is never sent on its own when the room comes back — because a stale instruction sent minutes later can do the wrong thing — overrule: send it on reconnect; S-SCR-19 changes.
- D13 Pairing codes are 6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, valid 300 s, at most 10 open per room (the 11th request gets 429, retry after 30 s) — because short enough to read across a desk and too many to guess within 300 s under the cap (security-adjacent: see Q-O10 and T17) — overrule: change length, lifetime or cap; S-SCR-15 changes.
- D14 A screen keeps the conversation and the cards in memory only, never in browser storage — because a screen should hold nothing worth stealing (plan §2) (security-adjacent; T17 decides where the device token itself lives) — overrule: cache them in storage so a reload while the room is down still shows them.
- D15 With the board down, the tour keeps flying over the grey snapshot without "flies to trouble" — because a grey map has no trouble to rank, and a moving Wall shows the screen is alive — overrule: stop the tour while the board is down; S-SCR-21 changes.
- D16 A board that never loaded shows `Waiting for the board at <origin>…`, a retry countdown and `SHOW DEMO` (reloads with `?demo=1`) — because never an empty screen (`docs/plans/product.md`) — overrule: drop the demo button; S-SCR-22 changes.
- D17 Without `cockpit.url` in config the cockpit is unconfigured: no cockpit button, no canvas half, the board as today — because a stranger without a room must see a normal laneboard (product rule: never tied to one) — overrule: show the button with a "not set up" pane instead.
