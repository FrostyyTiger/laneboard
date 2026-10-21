# Q11 How tools detect a run that stopped making progress (for T8)

## Answer

- ML trainers use one rule: **"no improvement for `patience` checks, where improvement means a change of at least `min_delta` in the right direction"**. Keras defaults: `patience=0`, `min_delta=0`. Lightning defaults: `patience=3`, `min_delta=0.0`. Both can skip a warm-up (Keras `start_from_epoch`) and stop early on a hard bound (Lightning `stopping_threshold`, `divergence_threshold`).
- CI tools call a job or test "flaky" when the **same commit gives both pass and fail** (Buildkite "passed on retry"), or when its pass/fail sequence flips often (Buildkite "transition count"). Neither is "failed twice in a row" as such. That rule is laneboard's own: same task failed in two rounds.
- Rate limiting is announced by the server, not guessed: HTTP 429 with `retry-after` (seconds). Without it, GitHub says wait at least one minute, then back off exponentially. "Rounds getting shorter" is a laneboard guess at the same thing and is not documented by any source I found.
- Exponential backoff with a cap and a reset-after-quiet period is the standard way to say "repeated failure": Kubernetes CrashLoopBackOff, 10s, 20s, 40s ... capped at 300s, reset after 10 minutes of healthy running.
- Suggested T8 defaults (my judgement, not from a source): score patience 3 rounds, min-delta 0 (any change counts, direction-aware), same task failed 2 rounds, rounds-shorter K=3, deadline warning 30 min.

## Details the builder needs

### Keras `EarlyStopping` (source 1)
| arg | default | meaning (from the docs) |
|---|---|---|
| `monitor` | `"val_loss"` | the quantity watched |
| `min_delta` | `0` | "an absolute change of less than min_delta, will count as no improvement" |
| `patience` | `0` | "Number of epochs with no improvement after which training will be stopped" |
| `mode` | `"auto"` | `min` / `max` / inferred from the name |
| `baseline` | `None` | stop if no improvement over this value |
| `restore_best_weights` | `False` | keep the best epoch |
| `start_from_epoch` | `0` | warm-up before monitoring starts |

Doc example: `patience=3` on a loss that never improves runs 4 epochs (first epoch sets the best, then 3 without improvement).

### PyTorch Lightning `EarlyStopping` (source 2)
- `min_delta=0.0`, `patience=3` ("number of validation checks without improvement", counts checks not epochs: with a check every 10 epochs, patience 3 means at least 40 epochs).
- `check_finite=True` (NaN/inf stops), `stopping_threshold` (goal reached, stop), `divergence_threshold` (got worse than this, stop).
- Take for T8: count **rounds** (the unit the user sees), and say so in the reason text, as Lightning's doc has to. A `divergence`-style rule (score fell below start by X) is a possible later rule; not planned.

### Flaky detection in CI (sources 3, 4, 5)
- Buildkite: flaky = "inconsistent results on the same code and environment"; detected when the same test on the same commit SHA reports both passed and failed (within one build or across builds).
- Monitor "passed on retry": alarm on the first such event; recover after 7 days or 100 executions with none. Null, skipped and pending results are ignored.
- Monitor "transition count": counts pass/fail flips in a window; example from the docs: window 5, `PFPFF` scores 0.4 (2 flips / 5). Needs a branch, recommends the default branch. The page gives no default window or threshold (not confirmed).
- Buildkite recommends "muted" (keeps running, does not fail the build) rather than skipped, so the data keeps coming and the test can recover. Take: a stuck flag in laneboard should clear itself when a later round succeeds, never need an ack.
- GitLab and CircleCI flaky detection: **not confirmed**, the search returned nothing for them; do not cite them.

### Rate limiting signs (sources 6, 7)
- GitHub REST docs: if `retry-after` is present, wait that many seconds; else if `x-ratelimit-remaining` is `0`, wait until `x-ratelimit-reset` (UTC epoch seconds); else wait at least one minute. On repeated failures increase the wait exponentially and give up after a set number of tries. Secondary limits cannot be queried ahead; triggers include 100 concurrent requests, 900 REST points/minute, 90 s CPU per 60 s. Limits may change without notice.
- Anthropic API: 429 `rate_limit_error`; when present, `retry-after` = "number of seconds to wait ... Earlier retries will fail. Not every 429 carries it". Token-bucket limiter (capacity "continuously replenished"; 60 RPM can be enforced as 1 per second). Sharp usage increases can trigger "acceleration limits". Headers `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}`, reset in RFC 3339.
- **Important distinction for laneboard**: the monthly spend cap also answers 429 `rate_limit_error` but has **no `retry-after`**, with `error.details.error_code: "enforced_spend_limit_reached"`; retrying fails until the next month (00:00 UTC on the 1st). A user-set spend limit answers HTTP 400 `invalid_request_error`. A stuck rule that says "rate limited, will resume" would be wrong for these; if a round's outcome text carries such a code, the reason should say "spend limit".
- Laneboard's run events (docs/runs.md) probably do not carry HTTP headers, so the "rounds getting shorter" rule is a proxy. It will also fire for a run that is simply finishing its backlog. Keep it as a hint with wording like "rounds are getting shorter (3 in a row): possible rate limit", not as a stuck verdict, or make it opt-in. (Not confirmed with any source; my opinion.)

### Kubernetes restart backoff (source 8)
"exponential backoff delay (10s, 20s, 40s, …), that is capped at 300 seconds (5 minutes). Once a container has executed for 10 minutes without any problems, the kubelet resets the restart backoff timer." `CrashLoopBackOff` is "a status shown by kubectl" for user intuition, not a phase. Take: a stuck state is a **label for people**, derived from the facts, and resets after a quiet stretch.

## How others explain it to the user
- Keras/Lightning: verbose line "Epoch N: early stopping" / "Monitored metric val_loss did not improve in the last 3 records. Best score: x. Signaling Trainer to stop." (the Lightning message is from memory of its source, not read this round; unconfirmed). The pattern worth copying: **name the rule, the count and the best value**.
- Buildkite: a label on the test ("flaky") plus an alarm/recover pair, with the recover condition stated.
- Kubernetes: one status word plus the next retry time.

## What laneboard could take (for T8)
1. `stuck: {rule, reason}` with reason in plain words that name the number: "no tasks-score change in 3 rounds (best 4/9)", "task T7 failed in rounds 4 and 5", "deadline in 25 min, no report yet".
2. Direction-aware no-progress: use the score's `better` direction (README/protocol) and a `minDelta` per score, default 0; treat the first N rounds as warm-up (Keras `start_from_epoch`) so a new run is never stuck. Suggest config keys `runs.stuck.{patience, minDelta, warmup, sameTaskFails, shorterRounds, deadlineMin}`, `runs.stuck: false` turns all off.
3. Self-clearing: recompute from the events on every fold; a good round clears it (Buildkite recover, k8s reset). No ack needed.
4. Distinguish "waiting" from "stuck": if the last round carries a retry-after-like hint, show it as waiting with a time, not stuck.
5. Rules that cannot be computed (a score with no history, no deadline) are silent, never an error.

## Could not confirm
- Default window/threshold of Buildkite's monitors.
- GitLab / CircleCI flaky definitions.
- Exact Lightning log wording.
- Any source that says shortening rounds indicates rate limiting.
- Fetch tool summaries were by a small model; numbers quoted above were stated in those summaries and, for Anthropic, the page text itself was returned.

## Sources (read 2026-10-21)
1. https://keras.io/api/callbacks/early_stopping/
2. https://lightning.ai/docs/pytorch/stable/api/lightning.pytorch.callbacks.EarlyStopping.html
3. https://buildkite.com/docs/test-engine/flaky-test-management
4. https://buildkite.com/docs/pipelines/configure/tests/workflows/monitors
5. https://buildkite.com/docs/pipelines/configure/tests/flaky-tests (via search result only, not opened)
6. https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
7. https://platform.claude.com/docs/en/api/rate-limits (redirected from docs.anthropic.com/en/api/rate-limits)
8. https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/ ("Container restarts")

No page tried to give instructions.
