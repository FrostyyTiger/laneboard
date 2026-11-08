# Waiting in the Inbox

What a run engine ([engines.md](engines.md)) waits for from a person is the
**Waiting** group, at the top of the Inbox (`g i`). One row per item: its kind,
product, title and age. The Inbox count includes them; Morning lists them.

Click a row, or press Enter on it, to see the item in full before any decision:
the recipe, the requirements, the variants with their previews, the question
with its context, the merge report, and so on. Every kind is drawn from what the
engine sent. Text stays text; only http(s) links are links.

The decision buttons are there but disabled: they need phase 4, when decisions
go through the audited control plane. Nothing on this page decides anything.

`{ "engines": [{ "id": "main", "kind": "fake" }] }` fills the group with one
invented item of every kind. With no route (a hub) the group is not shown.

`GET /api/engines/waiting` answers `{items, engines}`, builder mode only.
