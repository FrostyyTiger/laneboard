# Q10 — Attention inbox and morning digest for long-running automated work

Read 2026-10-21. Notes from outside sources; facts only.

## Answer

- Every tool separates **state** (running / waiting / closed) from **why it closed or waits**
  (Devin `status` + `status_detail`, Temporal Completed/Failed/Timed Out/Terminated/Cancelled,
  OpenHands `finished`/`stuck`/`waiting_for_confirmation`). An inbox item should carry the same
  pair: one state word plus one reason word.
- The inbox item is a **thread keyed by the subject** (GitHub: one thread per issue/PR/run subject,
  `reason` + `unread` + `updated_at`), not one item per event. Later events update the same item.
- Acknowledgement has two levels in GitHub: **read/unread** and **Done** (leaves the inbox, can be
  found again), plus **Save** (kept) and **unsubscribe/ignore** (stop future items until a direct
  mention). Nobody in this set offers timed snooze except GitHub Mobile push scheduling.
- Noise control that works: notify on **transitions** (Buildkite `started_failing` / `started_passing`),
  offer a **failures-only** switch (GitHub Actions), and keep waiting-for-human items separate from
  finished ones. Argo warns its own events "can be lost or rolled-up", so an inbox must not depend on them.
- A digest line for a run needs: start → end, final state, reason, who/what is waiting, cost, outputs
  (Devin: `acus_consumed`, `pull_requests`, `created_at`/`updated_at`).

## Details

### GitHub notifications
- Inbox item = "thread". Fields: `id`, `repository`, `subject {title,url,latest_comment_url,type}`,
  `reason`, `unread`, `updated_at`, `last_read_at`, `url`, `subscription_url`.
- Reasons: `assign, author, comment, mention, team_mention, review_requested, state_change,
  subscribed, manual, security_alert, ci_activity`. The reason can change later (author → mention) and
  stays changed. Inbox shows it as a label; filter `reason:review-requested`.
- Actions: mark read (`PATCH /notifications/threads/{id}`, 205), **Done** (`DELETE` same path, 204;
  `is:done` finds it again), Save (`is:saved`; saved kept indefinitely, others 3 months), mark all read
  with optional `last_read_at`. Ignore: `PUT .../subscription` `ignored:true`; ignored thread returns when
  the user comments or is @mentioned.
- Workflow runs: users who enabled email/web notifications are told when runs **they triggered**
  complete; option to be told only on **failures**; scheduled runs notify whoever last touched the cron.
  Content is the run status (successful, failed, neutral, canceled). Not confirmed: format of the web item.
- Not confirmed: whether GitHub offers a digest email (page does not mention one).

### Buildkite
- Events: `build.failing` (first failed step, build still running), `build.finished`; webhook also
  `build.scheduled/running/skipped`. Step events `step.failing`, `step.finished`.
- `if:` conditions, e.g. `build.state == "failed"`, `build.branch == "main"`; `pipeline.started_failing`
  / `started_passing` (Slack Workspace service only) fire once per transition.
- Pitfall they document: step-level notifications ignore build-level conditions, so they fire on every branch.
- "failing" before "finished" is a useful idea: tell the human early that a run is already doomed.

### Argo Workflows
- Events: `WorkflowRunning/Succeeded/Failed/TimedOut`, node events `WorkflowNode{Running,Succeeded,Failed,Error}`
  with annotations `node-name`, `node-type`. Docs: do not build automation on them, they can be lost or rolled up.
- Recommended notification path: an **exit handler** (runs once when the workflow ends), i.e. one
  message per run, at the end. Fields such as `duration` / `resourcesDuration`: not on the pages read.

### Temporal UI
- Open: Running, Paused. Closed: Completed, Failed, Timed Out, Terminated, Cancelled, Continued-As-New.
  Close reasons as shown in the UI: not confirmed.

### Agent products
- Devin v3 session: `status` ∈ new, claimed, running, exit, error, suspended, resuming. `status_detail`
  (only on get/list): running → `working`, `waiting_for_user`, `waiting_for_approval`, `finished`;
  suspended → `inactivity`, `user_request`, `usage_limit_exceeded`, `out_of_credits`, `out_of_quota`,
  `payment_declined`, `total_session_limit_exceeded`, `contract_expired`, `error`, others.
  Also `acus_consumed`, `pull_requests[{pr_url, pr_state}]`, `created_at`, `updated_at`, `tags`.
  A message to a suspended session wakes it. Slack/notification settings: not found in docs read.
- OpenHands SDK `ConversationExecutionStatus`: idle, running, paused (by user), waiting_for_confirmation,
  finished, error, stuck ("in a loop or unable to proceed"), deleting. A stuck detector exists
  (sliding-window pattern matching); thresholds not confirmed (source `conversation/stuck_detector.py`
  not read). `ConversationState.stats` holds usage; its contents not confirmed.

## What laneboard could take
1. **One inbox item per run (thread), updated in place**, key = run id + need id; never a new item per event.
   An item carries: state, reason, since, subject title, what is asked, link to the run.
2. Distinguish **waiting for you** (`waiting_for_user` / `waiting_for_approval` / confirmation) from
   **ended** (finished, failed, stuck, limit). Only the first needs action; ended items are informational
   and drop out on "Done".
3. Acknowledge = **Done** (hidden, retrievable, like `is:done`), with read/unread as a separate flag. An
   explicit **ignore until it changes** (reappears on a new reason) beats timed snooze; timed snooze is
   an optional extra, none by default.
4. Notify on **transitions** only (started failing, stopped, needs you); a failures-only/attention-only
   setting as the quiet default.
5. Morning digest per run: `start → end (duration)`, final state, **reason for stopping** (word from a
   small fixed list: finished, failed, stuck, limit, cancelled, timed out), who it waits on, cost
   (tokens/credits if the run reports them, otherwise omit), outputs (PR links, commits). Group by
   "needs you" first, then failed/stuck, then clean finishes collapsed to one count.
6. Avoid: events lost → derive the inbox from run state, not from an event stream; a run that fails then
   is retried should reuse the item; step-level noise bypassing run-level filters.

## Sources
- https://docs.github.com/en/subscriptions-and-notifications/concepts/about-notifications (2026-10-21)
- https://docs.github.com/en/rest/activity/notifications (2026-10-21)
- https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/notifications-for-workflow-runs (2026-10-21)
- https://buildkite.com/docs/pipelines/configure/notifications (2026-10-21)
- https://argo-workflows.readthedocs.io/en/latest/workflow-notifications/ (2026-10-21)
- https://argo-workflows.readthedocs.io/en/latest/workflow-events/ (2026-10-21)
- https://docs.temporal.io/workflow-execution (2026-10-21)
- https://docs.devin.ai/api-reference/v3/sessions/get-enterprise-session.md (2026-10-21)
- https://docs.openhands.dev/sdk/arch/conversation.md (2026-10-21)
- https://raw.githubusercontent.com/OpenHands/software-agent-sdk/main/openhands-sdk/openhands/sdk/conversation/state.py (2026-10-21; enum values only, nothing copied)

No page tried to give instructions. Not confirmed: Datadog/Backstage-style digests, Buildkite email
default content, Devin Slack behaviour, OpenHands stuck thresholds.
