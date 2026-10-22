# Q17 — PR state from `gh pr view` and the REST API, mapped to open/merged/closed

## Answer

- `gh pr view --json state` prints the GraphQL `PullRequestState` enum, upper case: `OPEN`, `CLOSED`
  or `MERGED`. There is no `DRAFT` state: a draft is `state: "OPEN"` with `isDraft: true`.
- REST `GET /repos/{o}/{r}/pulls/{n}` gives `state` as lower case `open` or `closed` only. A merged
  PR is `state: "closed"` with `merged: true` and a non-null `merged_at`. Also `draft` (bool),
  `closed_at` (date-time or null).
- Mapping for the protocol: `MERGED` (gh) or `merged_at != null` (REST) → `merged`; else
  `CLOSED`/`closed` → `closed`; else `OPEN`/`open` → `open` (draft stays `open`; keep `isDraft`
  separately if shown). Compare case-insensitively and test merged first.

## Details for the builder

- gh JSON fields named in the manual: `state`, `isDraft`, `closed`, `closedAt`, `mergedAt`, `title`,
  `url`, `mergeStateStatus`. The manual does not list the `state` values; they come from the GraphQL
  enum (docs: CLOSED "closed without being merged", MERGED "closed by being merged", OPEN "still
  open").
- gh's own code (`api/queries_pr.go`) keeps `State` as the raw string and tests `State == "OPEN"`
  exactly (case-sensitive). `pkg/cmd/pr/shared/display.go` shows "Draft" only when `State == "OPEN"
  && IsDraft`; a closed draft is shown as Closed.
- Expected JSON shapes (from the above, not run here): open `{"state":"OPEN","isDraft":false,
  "mergedAt":null,"closedAt":null}`; draft same with `isDraft:true`; merged `{"state":"MERGED",
  "mergedAt":"<ts>","closedAt":"<ts>"}`; closed `{"state":"CLOSED","mergedAt":null,"closedAt":"<ts>"}`.
  Timestamps are ISO 8601 UTC. `closedAt` is also set on merge, so `closedAt` alone must not mean
  "closed".
- REST docs list `state` enum `open`/`closed` (also `all` as a list filter only). The merge-check
  endpoint `GET .../pulls/{n}/merge` returns 204 if merged, 404 if not; it is a fallback only.
- Robustness: an unknown or missing state should map to "unknown / leave as is", not `closed`.
  A `gh` failure (no auth, offline, PR deleted) must not be turned into `closed`.

## What laneboard can take

A tiny pure function `prState({state, mergedAt, merged_at})` that lowercases, checks merged first,
and returns `open|merged|closed|null`. Unit-test the four shapes plus draft and garbage input.

## Not confirmed

I did not run `gh` (no shell); the exact output shapes above are inferred from the type definitions
and docs, not captured. The `state` field of `gh pr view --json` being passed through unchanged
from GraphQL is from reading `queries_pr.go`, not from a captured run. Dates read 2026-10-21.

## Sources

- https://cli.github.com/manual/gh_pr_view (2026-10-21)
- https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request (2026-10-21)
- https://docs.github.com/en/graphql/reference/pulls — PullRequestState (2026-10-21)
- https://raw.githubusercontent.com/cli/cli/trunk/api/queries_pr.go (2026-10-21)
- https://raw.githubusercontent.com/cli/cli/trunk/pkg/cmd/pr/shared/display.go (2026-10-21)
