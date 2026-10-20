# Q1: `claude -p --output-format stream-json`: `result` and `rate_limit_event`

## Answer

- The last line of the stream is a `result` message. Documented fields: `type:"result"`,
  `subtype` (`success` or `error_max_turns` / `error_during_execution` / `error_max_budget_usd` /
  `error_max_structured_output_retries`), `session_id`, `duration_ms`, `duration_api_ms`,
  `is_error`, `num_turns`, `result` (text, success only), `stop_reason`, `total_cost_usd`,
  `usage`, `modelUsage`, `permission_denials`. Error results have `errors: string[]` instead of `result`.
- `total_cost_usd` is a client-side estimate in USD (a float), not billing data. For a resumed
  session it is the whole session's total, not the one call's.
- `rate_limit_event` is documented only partly: `rate_limit_info.status`
  (`allowed` | `allowed_warning` | `rejected`), `resetsAt`, `utilization`, plus three
  credits fields. **`unifiedWindows` and `isUsingOverage`, which `run.sh` reads, are not in the
  official docs.** I could not confirm them from a primary source.
- **`resetsAt` unit is not confirmed.** The official page gives only `resetsAt?: number`. A
  third-party SDK wrapper says Unix **milliseconds**; a third-party note on the status-line JSON
  says epoch **seconds**. The parser should accept both (see below).

## Details for the builder

### `result` (success variant, from the SDK TypeScript reference)

| Field | Type | Notes |
| - | - | - |
| `type` | `"result"` | |
| `subtype` | `"success"` | |
| `uuid`, `session_id` | string | `session_id` ties the round to the transcript |
| `duration_ms`, `duration_api_ms` | number | wall time and time in API calls, ms |
| `is_error` | boolean | |
| `api_error_status` | number or null, optional | HTTP status of a failed call |
| `num_turns` | number | |
| `result` | string | final text; `run.sh` clips it to 200 chars |
| `stop_reason` | string or null | |
| `total_cost_usd` | number | estimate; subagents included |
| `usage` | object | `BetaUsage`: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, …; **excludes subagents** |
| `modelUsage` | `{model: ModelUsage}` | per model: `inputTokens`, `outputTokens`, `thinkingTokens?`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `webSearchRequests`, `costUSD`, `contextWindow`, `maxOutputTokens`, `costBasis?` (`list`/`managed`/`unknown`); includes subagents |
| `permission_denials` | array | |
| `structured_output`, `terminal_reason`, `fast_mode_state`, `origin`, timing fields (`ttft_ms`, …) | optional | many optional fields; ignore unknown ones |

Error variant: same core fields minus `result`, plus `errors: string[]` (and optional
`startup_failure_reason`). Cost fields are present on error results too, but after a session
crash (`error_during_execution`) they may all be zero. On `error_max_budget_usd`, `usage` leaves out the
response that crossed the budget while `total_cost_usd` and `modelUsage` include it. So: read the
cost from `total_cost_usd`, on every subtype, never from `usage`.

Per-step `output_tokens` on assistant messages is a placeholder; only `result.usage` has the real
output count. Not needed by laneboard (it needs cost only).

### `rate_limit_event` (documented shape)

```
{ "type": "rate_limit_event",
  "rate_limit_info": { "status": "allowed|allowed_warning|rejected",
                       "resetsAt": <number>, "utilization": <number>,
                       "errorCode": "credits_required",       // only on that rejection
                       "canUserPurchaseCredits": bool, "hasChargeableSavedPaymentMethod": bool },
  "uuid": "...", "session_id": "..." }
```

`errorCode: "credits_required"` (Claude Code v2.1.181+) means a subscription's included usage is
exhausted and the session cannot go on until credits are bought. Good extra signal for "limited"
next to the status check in `run.sh`.

### Fields seen only in third-party sources / in `run.sh`, unconfirmed by the docs

- `rate_limit_info.rateLimitType` (`five_hour`, `seven_day`, `overage`), `overageStatus`,
  `overageResetsAt`, `overageDisabledReason`, `isUsingOverage`, `surpassedThreshold`: from an
  Elixir SDK wrapper's docs, which say `resetsAt` and `overageResetsAt` are Unix **ms** and
  `utilization` a **0.0 to 1.0 fraction**.
- `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt}`: used by
  `docs/plans/runs/loop/run.sh` (lines 119-125). No public source found. It works for the loop
  today (the loop read `utilization * 100`, i.e. a 0-1 fraction, consistent with the wrapper docs).
- Other, documented surfaces use other scales: `SDKUsageReport.rate_limits.limits[]` has
  `percent` (0-100) and `resets_at` as an **ISO 8601 string**; the status-line JSON reportedly has
  `rate_limits.five_hour|seven_day.{used_percentage (0-100), resets_at (epoch seconds)}`. So the
  same concept comes in three scales and three time formats depending on the surface.

### What the parser should do (T1/T9)

- Normalise `resetsAt`: a finite number below `1e11` is epoch seconds, otherwise milliseconds
  (1e11 s is year 5138; 1e11 ms is 1973). Accept an ISO string too. Store as ms or ISO in one place.
- Normalise utilization: a value in 0..1 is a fraction; do not guess for values above 1 (treat as
  percent). `run.sh` already stores `fiveHourPct` as a rounded integer percent, so the `usage` loop
  event is already in percent; only `resetsAt` needs the unit guess.
- Every field optional; unknown fields ignored; a new `status` value is "not limited" only if it is
  `allowed` or `allowed_warning`, as in `run.sh`.
- Cost from `total_cost_usd` of the last `result` of the round. If the round was resumed, it is a
  session total, so per-round cost via difference is wrong; `run.sh` starts a fresh `claude -p`
  each round, so the plain value is right there.

## What others do / what laneboard could take

- Anthropic's own SDK treats these numbers as estimates and says not to trigger financial decisions
  from them. Laneboard should label cost "est." in the run view and in docs/runs.md.
- The SDK doc's advice, "account from `total_cost_usd`, not `usage`", fits the loop's `cost` event.
- Take the window-limit signal from the stream and keep a dedicated `usage` event (as the loop does)
  rather than asking laneboard to parse Claude output itself: the format is only partly documented
  and has changed across versions (many fields are marked with the version that added them).

## Not confirmed

- Official docs for `unifiedWindows`, `isUsingOverage`, `rateLimitType` on `rate_limit_event`.
- The `resetsAt` unit (ms vs seconds) in the stream; I had no real stream output (the file tools are
  confined to the repo). A builder or a loop round that has a real `claude -p` output file can
  settle it by looking at one `rate_limit_event` line.
- How often the event is emitted (once per message? only near limits?). Not documented.
- The SDK reference page is 290 kB; I read the result message, rate-limit event, ModelUsage,
  NonNullableUsage and SDKUsageReport sections. I did not read the chunk after offset 200000 for
  anything but those.

## Sources

- https://code.claude.com/docs/en/headless (stream-json overview, `system/init`, `api_retry`; read 2026-10-20)
- https://code.claude.com/docs/en/agent-sdk/typescript (`SDKResultMessage`, `SDKRateLimitEvent`, `ModelUsage`, `NonNullableUsage`, `SDKUsageReport`; read 2026-10-20)
- https://code.claude.com/docs/en/agent-sdk/cost-tracking (cost caveats, error results, resume totals; read 2026-10-20)
- https://claude-code.hexdocs.pm/ClaudeCode.Message.RateLimitEvent.html (third-party Elixir wrapper; units and extra fields; read 2026-10-20)
- https://wmedia.es/en/tips/claude-code-usage-limit-status-line (via search summary only, not opened; status-line `rate_limits` in epoch seconds, 0-100; 2026-10-20)
- Repo: `docs/plans/runs/loop/run.sh` lines 107-130 (how the loop reads the stream)

No page tried to give instructions.
