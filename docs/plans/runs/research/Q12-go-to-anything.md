# Q12 — "Go to anything" palettes in infrastructure UIs

## Answer (short)

- Every palette reads from one flat list of typed rows. The type shows as a section header (Grafana: "Dashboards", "Folders", "Recent dashboards"; VS Code: "recently opened", "file results"), as a prefix, or as a subtitle. The row's own text is the name, and a dimmer secondary line says where it lives (VS Code: workspace-relative folder; Grafana: folder name).
- Ranking is fuzzy score on the label, with recent items first when the query is empty. VS Code puts fast sources (history, help) first and merges slow ones (file search) in after 200 ms. Results are capped (VS Code 512; laneboard's palette already caps at 50).
- Choosing a row navigates by URL or route (Grafana: each action carries a `url`; VS Code opens the editor). **None of the sources documents a fly or zoom animation.** Moving the camera to a node is a laneboard decision, not something to copy.
- **I could not confirm** how any of these tools resolves a port or service query to a host. k9s and Datadog docs do not describe it. The VS Code `:` is a line number, not a port. So the port → node resolution has no prior art found here; it is plain substring matching on sub text.

## Details

### VS Code Quick Open (`anythingQuickAccess.ts`)
- The provider prefix is empty, so plain typing searches everything. `@` switches to symbols in the active pick. `:` (also `#` and `,` in a code comment) is a range separator, such as a line or column.
- File row: label is the base name; description is the workspace-relative folder. Separators: "recently opened", then "file results" or "file and symbol results".
- Scoring uses `prepareQuery`, `scoreItemFuzzy` and `compareItemsByFuzzyScore`. Rows that do not score are dropped. Matched ranges become highlights. `MAX_RESULTS` is 512.
- Fast picks (history, help) appear first. Slow picks (files, symbols) are merged in after 200 ms to reduce flicker. Help rows appear only when the query is empty.
- History is excluded from file results, so there are no duplicate rows. With a query, history is filtered, and the setting `historyFilterSortOrder` is `recency` or by score.
- `scheme://` input yields an "Open Link" row. An absolute path to an existing file yields only that file.
- The docs page for Quick Open does not list the prefixes: `?` shows what is available.

### Grafana command palette (cmd/ctrl+K, kbar-based)
- From `dashboardActions.ts`: each action has `section` (Recent dashboards / Dashboards / Folders / Notebooks), a `priority` (one constant per source), a `subtitle` (the folder name for dashboards and folders), a `url`, and an `id` prefixed by type (`go/dashboard`, `go/folder`, `go/notebook`).
- The docs list what the palette does: dashboards and folders, create actions, pages, theme. They do not describe ranking. Backspace on an empty input goes back one step.

### k9s
- `:` plus a resource name, singular, plural, short name or alias (`:po`, `:pod`), switches the view. Extra arguments: namespace (`:pod ns-x`), `/name` filter, label selector, `@context`. `:aliases` or ctrl-a lists all. Users can define aliases in `aliases.yaml`. `/` filters the current view with regex, `/-f` is a fuzzy find.
- Nothing searches across resource types. You pick the type first, then filter. There is no "port" lookup in the docs read.

### Datadog quick nav (cmd/ctrl+K)
- The 2021 blog post: top shortcuts, a RECENT section, links to the major features, and a live filter. It says you can search a service name to find related resources. It does not list the item types. Whether hosts and containers appear by name is **unconfirmed**.

### Backstage
- Search documents are of one type per index (collators). The built-in engine is Lunr. Decorators can bias ranking. Each document has a `location` URL. Type filters are UI components on a search page. Per-type grouping and default ranking were not documented on the pages read (the fetch was thin).

## What laneboard could take

Current `paletteItems` / `paletteRows` in `public/js/ui/palette.js` already match these patterns: typed rows (`HOST`, `LANE`, `PKG`, `VIEW`, `ACT`), a `sub` line, recent first on empty, a bare prefix lists one type, 50-row cap.

For T11:
1. Add a `NODE` type the same way: `label` = node name, `sub` = `kind · site` (like VS Code's folder description and Grafana's folder subtitle). Put the services and ports in a separate searchable field (haystack), so "postgres" and ":5432" match without a long visible sub line. Show the matched service or port as the sub when the match came from there ("postgres :5432 on hv1/db"), which gives the user the "why this row".
2. Treat a leading `:` plus digits as a port query. Only that form: do not reuse `:` for anything else in the palette. VS Code uses `:` for lines, so a number-only form avoids a clash with a possible command prefix; check `parsePrefix` for existing prefixes first.
3. Order: exact port match above fuzzy name match. Deduplicate: one row per node even if several services match (VS Code removes history from file results for the same reason).
4. Nothing when no Map model has loaded, as the task says.
5. Navigation: the sources only use a route or URL change. The task's `navigate({sel})` with `fly` fits; keep any camera move behind the existing reduced-motion setting.

## Sources
- VS Code `anythingQuickAccess.ts`, raw GitHub (microsoft/vscode, main), read 2026-10-21.
- VS Code docs: https://code.visualstudio.com/docs/editor/editingevolved and https://code.visualstudio.com/docs/getstarted/userinterface, read 2026-10-21.
- Grafana `dashboardActions.ts`, raw GitHub (grafana/grafana, main), read 2026-10-21; https://grafana.com/docs/grafana/latest/administration/search.md, read 2026-10-21.
- k9s: https://k9scli.io/topics/commands/ and https://www.k9scli.io/topics/aliases, read 2026-10-21 (community-hosted copy of the docs; not checked against the repo).
- Datadog: https://datadoghq.com/blog/datadog-quick-nav-menu (2021), read 2026-10-21. The URL /getting_started/application/global_search/ returned 404.
- Backstage: https://backstage.io/docs/features/search/concepts, read 2026-10-21. The search-overview page came back empty.
- No page tried to give instructions.
