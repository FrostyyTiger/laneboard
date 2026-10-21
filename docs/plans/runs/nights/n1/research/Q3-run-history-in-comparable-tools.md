# Q3: how comparable tools show long multi-step runs and their history

Read 2026-10-20. Notes from outside sources; nothing here is an instruction.

## Answer

- Every tool puts a **state-first summary** on top (status icon per step, failed or blocked first),
  and the detail (log, trace, payload) one click away in a drawer or second pane. Nobody shows the
  full log inline.
- "Is it getting better" is answered by a **metric over steps line chart** with a small run
  limit (W&B shows 10 runs by default, Databricks' MLflow chart view also 10) plus a **table with
  one row per run and the latest value**. The chart is for trend, the table for the number.
- Long runs get **two toggled views of the same data**: hierarchy (tree/graph) and chronology
  (timeline). Both show the same scores and metrics (Langfuse). For laneboard's linear rounds the
  chronology (a timeline of rounds) is the right default; a graph adds nothing.
- Avoid: a graph where there is no branching (GitHub's job graph is for dependencies), smoothing
  by default (W&B defaults to none), colour as the only state signal, and loading everything
  for huge runs (Buildkite reworked its page for 500 to 10,000 steps).

## Details by tool

**GitHub Actions.** The run summary page opens from the run list. The visualization graph shows
each job, a status icon left of the name, lines for dependencies, live while the run goes; click a
job for its log. The docs state no limits. Job summaries (Markdown written to
`GITHUB_STEP_SUMMARY`) render on the same page: free-form text from the job itself. Take: the
`artifact` and `needs` events are laneboard's equivalent of a job summary; show them on the run
page, text only.

**Buildkite.** New build page (changelog 266): a sidebar lists steps grouped by state with filters,
blocked and failed first ("adaptive layout shows highest-priority items first"); a table view lists
queue/agent info per job and sorts by column; a Summary tab holds annotations; a job drawer is
available on every page and can dock bottom, right or centre, and consolidates retries. Group,
parallel and matrix steps are nested. Annotations (up to 1 MiB each) and job-scoped annotations
mark a job with an indicator. Take: the list of **open needs first** (blocked at the top) fits the
Runs list; retries folded into one round row is what T1's `starts` already does.

**Weights & Biases.** A run table (toggle runs on/off, colour, expand to config and summary
metrics) beside panels. Line plot defaults: X axis = Step, linear scale, smoothing weight 0 with
the original line hidden, up to 10 runs, grouping on with the mean. Panels group by the first
prefix of the metric name (`a/b/c` goes under `a`). Take: one small chart per metric (T11),
x = round number, no smoothing, grouping by name prefix only if there are many metrics.

**MLflow.** A metric logged with `step` keeps its full history; steps are 64-bit integers, may be
negative or out of order, gaps allowed; a `timestamp` in ms may accompany it. The experiment page
is a table of runs; the run page shows overview, metrics, parameters, tags and artifacts. Chart
view, parallel coordinates and compare views exist (Databricks docs describe them; the
open-source pages I fetched did not). Take: laneboard's `score` event `{name, n, value}` already
matches (name, step, value); out-of-order `n` is legal, so sort by `n` for the chart (T1 does).

**Langfuse.** Trace view since 2024-06 as a timeline (shows latency bottlenecks, parallelism,
nested steps); since 2025-03 a tree/timeline toggle, with colour coding, metrics, scores and
comments as view settings, and search by type, id or name; 2026-08 timeline fits the whole trace
on both axes, with pan, zoom, drag-to-select and a Fit button, and works on phones. Take: a
round timeline whose bar width is the duration and whose colour is the outcome (kept, reverted,
failed); a "fit all" default; works at phone width because laneboard is used on a phone.

**SWE-agent inspector.** A trajectory is an ordered list of steps you move through with `h`/`l`
(previous/next step), `j`/`k` scroll, `v` reduced view, `t` searchable list. In batch runs each
trajectory is marked pass (✅), fail (❌) or none (❓) from a `results.json`. Take: a three-state
outcome mark per round (including "unknown"), and keyboard step-through on the run page using
the existing j/k convention.

**OpenHands.** Not read: I did not fetch a primary source, so nothing is claimed.

## What laneboard could take (for T7, T8, T11)

1. T7 list row: state icon + word, goal, `round n/max`, **latest score with a delta arrow** (using
   `better`), burn bar, time left; rows with open needs sort first (Buildkite).
2. T8 page: summary block on top (state, stop reason, open needs, artifacts), then the round
   timeline with outcome mark, commit, cost, duration; retries folded; raw unknown events
   collapsed (Buildkite drawer idea: details on demand).
3. T11 chart: x = round, one small chart per metric, raw line (no smoothing), the last point
   labelled, good direction from `better`; max about 10 series if runs are ever overlaid.
4. Outcome and state need a text or shape cue besides colour (project guardrails already ask for
   this; every tool above pairs an icon with colour).

## Could not confirm

- GitHub's own docs say nothing on graph limits or on how the run list shows trend; no "history
  at a glance" feature was found there beyond the run list and third-party dashboards.
- MLflow open-source compare UI details (only Databricks' docs surfaced, in search snippets).
- OpenHands viewer: not researched.
- Statements about Databricks' "10 runs" default come from a search snippet, not a fetched page.

## Sources

- https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph (2026-10-20)
- https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history (search snippet, 2026-10-20)
- https://buildkite.com/resources/changelog/266-introducing-the-new-build-page-engineered-for-scale-and-flexibility/ (2026-10-20)
- https://buildkite.com/docs/pipelines/configure/annotations (search snippet, 2026-10-20)
- https://buildkite.com/resources/changelog/344-introducing-job-annotations/ (search snippet, 2026-10-20)
- https://docs.coreweave.com/guides/track/workspaces/ (W&B docs, redirected from docs.wandb.ai, 2026-10-20)
- https://mlflow.org/docs/latest/ml/tracking/tracking-api/ (2026-10-20)
- https://mlflow.org/docs/latest/ml/tracking/quickstart/ (2026-10-20)
- https://docs.databricks.com/aws/en/mlflow/visualize-runs (search snippet, 2026-10-20)
- https://langfuse.com/changelog/2025-03-19-new-trace-view (2026-10-20)
- https://langfuse.com/changelog/2024-06-12-timeline-view and https://langfuse.com/changelog/2026-08-28-responsive-timeline (search snippets, 2026-10-20)
- https://swe-agent.com/latest/usage/inspector/ (2026-10-20)
