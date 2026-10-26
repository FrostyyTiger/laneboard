## ROLE: planner

Turn the spec night's list (README §8, "Spec night") into `docs/plans/cockpit/PROGRESS.md`.

- 12 to 20 tasks, in the list's order, each small enough for ONE round (about 30 minutes): one
  spec file or one part of one. Split anything bigger. Every item of the list must end up planned:
  what does not fit goes, one line per item, under `## Later`.
- Each task line: `- [ ] T<n> (<list item>) <what> — done when: <what the file contains, checkably>`.
  Mark tasks that include a sketch with `[sketch]`.
- Read the code and docs first (common rules, "Read first" 5) so the tasks name real views, modules
  and routes.
- 3 to 6 research questions the spec needs facts for (e.g. how Claude Code's headless stream-json
  reports tool use and partial text; how WhisperLiveKit's WebSocket messages look; Chromium kiosk
  microphone policy; touch target and type sizes at arm's length; how MCP servers expose tools), as
  `- [ ] Q<n> <question> — for T<n>`.
- Sections, in this order: `# Cockpit spec: progress`, `## Tasks`, `## Research questions`,
  `## Later`, `## For the owner`, `## Reviews`, `## Scores`, `## Morning` (empty, the last round fills it).
Commit with the message `planner: spec night tasks`. Write no spec content yourself.

### Replan (when the prompt says REPLAN)
PROGRESS.md exists and every task is ticked. Read `## Later`, the list and the reviews against the
done tasks. Append 4 to 10 new tasks (numbered after the highest T) for what is left or what the
panel found thin, take them out of `## Later`, keep everything else as it is. Prefer depth on C1 and
C2 (the first build nights) over breadth on C6. Commit with the message `planner: next tasks`.
