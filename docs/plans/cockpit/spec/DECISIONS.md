# Cockpit spec: decisions

Small, reversible choices made while writing the spec or building it. The owner may overrule any of
them; the overrule part says what changes then. Taste, one-way doors and anything security-relevant
go to `QUESTIONS.md` instead.

Format, one line each, numbered in order and never renumbered:

`D<n> <choice> — because <why> — overrule: <what changes if the owner disagrees>`

## List

- D1 In the spec "room" means the cockpit room; a Map node with `kind: room` is a "room node" — because laneboard already uses "room" for a Map node kind (`docs/map.md`) and the plan uses it for the agent's machine, so one word needs a qualifier — overrule: pick another name for the agent's machine (e.g. "cockpit host") and replace it across `spec/`; no code exists yet.
