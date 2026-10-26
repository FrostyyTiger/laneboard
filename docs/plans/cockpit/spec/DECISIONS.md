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
