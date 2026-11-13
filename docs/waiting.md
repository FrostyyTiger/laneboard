# Waiting in the Inbox

What a run engine ([engines.md](engines.md)) waits for from a person is the
**Waiting** group, at the top of the Inbox (`g i`). One row per item: its kind,
product, title and age. The Inbox count includes them; Morning lists them.

Click a row, or press Enter on it, to see the item in full before any decision:
the recipe, the requirements, the variants with their previews, the question
with its context, the merge report, and so on. Every kind is drawn from what the
engine sent. Text stays text; only http(s) links are links.

The buttons decide, through the control plane. See [decisions.md](decisions.md).

## A blocked run: kind `needs`

When a run is blocked (a round hit its stop rule, a check could not run), the
engine may list it as an item of kind `needs`, with `content {node, reason}`. It
is the same block the Runs view finds on its own (at a gate with nothing to
decide), so it shows the same way:

- its row says **blocked**, its content the node and the reason;
- its buttons are **Resume** and a small **Stop** (it asks first), never Approve
  or Reject: there is nothing to approve. Fix the cause, then Resume;
- on Runs it is the blocked card in Needs you, not a gate; the run page shows it
  in the callout under the loop;
- it counts in the Inbox and on the phone bar like every waiting item.

laneboard accepts the kind today; it appears once foundry lists blocked runs in
`waiting`.

`{ "engines": [{ "id": "main", "kind": "fake" }] }` fills the group with one
invented item of every kind. With no route (a hub) the group is not shown.

`GET /api/engines/waiting` answers `{items, engines}`, builder mode only.
