# Q18 — progress when the total grows

## Answer
- Tools that handle moving scope keep **two series**: done and total. Jira's burnup draws "Work scope" as its own line, and a rising line is what the docs call scope creep. They do not hide the move by rescaling a single percentage.
- Design systems advise against a percentage or estimate whose basis is unknown or moving (Visa, Astro). A plain count is the honest fallback.
- Recommendation for T5: print `done/total` counts (`7/12`), never a bare percentage. When the total changed since the last line, mark it (for example `7/12 (total was 10)` or `+2`). Draw the bar against the current total, and show the growth as a distinct tick or segment. Don't draw it as a bar that moves backwards without a word.
- Thin sources: I could not read Linear's cycle-graph docs. GitHub Projects and Actions docs say nothing about a changing denominator.

## Details

**Jira (Scrum burnup).** Two lines: completed work and "Work scope", the work planned for the sprint. Docs: "If this line increases throughout the sprint, it's a sign of scope creep." The unit can be story points, issue count or estimate. Sub-task points are excluded. The page does not say whether removing work lowers the line (not confirmed). Appfire's third-party Jira reports instead stack columns (total height = scope) and suggest manual annotations to mark a mid-sprint jump. Guides on burnup charts in general say the scope line has to be adjusted when tasks are added or removed.

**Linear.** The cycle page says only that the details view has "a chart showing effort and scope over time". It also says completed-cycle graphs are frozen snapshots and can differ from the live issue list. Whether the scope line is dotted or how added issues are drawn: **not confirmed**. Two searches found nothing primary.

**GitHub Projects.** Board columns show a count and, optionally, field sums, "highlighted when the current count exceeds the limit" (WIP limit). The sub-issue progress field only says it shows "how many sub-issues have been completed". The docs don't describe the display or what happens when sub-issues are added (not confirmed).

**GitHub Actions matrices.** The matrix can be built at run time (`fromJSON` of a job output), so the job count is known only once the defining job has finished. The docs I read give no total or progress counter. A third-party source (not primary) gives 256 jobs as the per-workflow cap. The UI shows jobs as they are created, so the list grows with no stated denominator.

**Generic progress-bar guidance (design systems).** Use determinate indicators only when the amount of completion is known. Estimates can mislead or frustrate. Indeterminate indicators can turn determinate once information is available. "N processed so far" is a count-only fallback (my inference, not stated by the sources).

## What laneboard could take
1. Keep `done` and `total` as separate numbers in the model. Store the previous total so a change can be detected.
2. Text first: `7/12` always. Add the percentage only when the total has not moved during the run.
3. Mark a moved total with a delta (`+2`) on the line where it moved, as Jira's separate scope line does.
4. If the total is unknown, show only the count done (`7 done`), not a bar.
5. A shrinking total (work dropped) should be shown the same way (`-1`). The Jira page is silent here.
6. When a run ends, the final `done/total` is the record, like Linear's frozen snapshot.

## Sources (read 2026-10-21)
- Jira burnup chart: https://support.atlassian.com/jira-software-cloud/docs/view-and-understand-the-burnup-chart/
- Appfire burn up charts (via search result): https://appfire.atlassian.net/wiki/spaces/dataplane/pages/455869555/Burn+up+charts
- Linear cycles: https://linear.app/docs/use-cycles
- GitHub Projects board layout: https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/customizing-the-board-layout
- GitHub sub-issue progress field: https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-parent-issue-and-sub-issue-progress-fields
- GitHub Actions job variations: https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations
- Visa progress usage: https://design.visa.com/components/progress/usage/
- Astro progress: https://www.astrouxds.com/components/progress/
- Dynamic matrix article (256 cap, secondary): https://oneuptime.com/blog/post/2025-12-20-dynamic-matrix-github-actions/markdown
