# Runs-first plan: open questions for the owner

Each has a recommendation; a phase builds the recommendation where nothing is answered. Part of
`README.md` in this folder.

1. **Home view: Runs or Map?** Recommendation: **Runs** is home in the app (it is the main unit
   now); the Map stays one key away (`g m`) and stays the Wall's picture.
2. **Lanes: flag or delete?** Recommendation: a `lanes.enabled` flag, default off from phase 6, for
   one release; then a separate, reviewed PR deletes what nobody turned back on. Keeps existing
   installs and the public README story working while the new views settle.
3. **Packages view.** Recommendation: retire it with the lanes flag. CI on main moves to the
   product page; per-package conflict prediction goes away with lanes.
4. **Where the adapter runs.** Recommendation: a builder-mode laneboard on the machine where the
   engine's CLI runs (its control room); the hub reads it through the existing signed stream. The
   hub keeps its narrow reach and its security review stays valid.
5. **CLI or MCP for the adapter.** Recommendation: CLI with `--json` first (execFile, no shell,
   easy to fake and test). MCP only if the adapter ever has to run on another machine than the
   engine (gap G13).
6. **Poll rates.** Recommendation: runs and waiting every 5 s, products and knowledge every 60 s,
   plus tailing the runs' `run.jsonl` files for live events. Revisit once the engine has a change
   feed (gap G8).
7. **Where decisions may be made.** Recommendation: a signed-in person on a phone or laptop, and the
   hub with `control` scope; never the Wall or a kiosk device token; the cockpit only through
   confirm cards (C6).
8. **How heavy is a recipe approval?** Recommendation: a confirm card that shows the recipe and its
   revision, one tap to approve, no typing. Reject always asks why. Starting a goal is a lighter
   `ask`, since it only asks for a recipe.
9. **`add-source` from the page?** Recommendation: not now. Uploads bring files and personal data
   onto the page's path; sources go in through the engine's repo or its own tools. Answers to
   questions are enough for the page.
10. **Should the cockpit agent mount the engine's MCP directly?** Recommendation: no. It reads the
    engine through laneboard's MCP (same verbs, laneboard's shapes, focus-aware) and decides only
    through confirm cards, so there is one door and one audit trail.
11. **Update `docs/plans/product.md`?** Its one-liner ("agents that work while you sleep") and its
    sequence predate runs-first. Recommendation: yes, in phase 0's PR: "mission control for agent
    runs and the machines they run on", and put this plan's phases 0-3 after the Wall and C1b merges
    in its sequence. The owner approves the wording.
12. **Who builds the phases?** The old loops are frozen once their planned runs finish.
    Recommendation: phase 0 as an attended session (small, sets the interface); phases 1-3 and 5
    as early runs of the new engine once it can build (laneboard as its first public, low-risk
    product); phase 4 always attended because it touches the fenced core.
13. **Old `run.jsonl` runs: for how long?** Recommendation: forever. The `jsonl` engine is the
    generic way for anyone's loop to show up on the page (product.md: never tied to one); only its
    lane-binding parts follow the lanes flag.
14. **Knowledge on shared screens.** Recommendation: the Knowledge view only for signed-in people,
    never on the Wall or a kiosk token; it shows claims and source references, never raw sources.
15. **Morning's `tonight`.** Recommendation: the UI label becomes "since 18:00" (or "since you last
    looked", once the page remembers that per person); the API keeps `tonight` as an accepted
    value so scripts do not break.
