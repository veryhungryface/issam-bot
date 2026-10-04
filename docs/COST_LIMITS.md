# Usage and cost limits

The application enforces limits before Browserbase session creation, not only in the provider
dashboard. Limits are configurable in the server secret environment or an audited administrator
setting. Lowering a limit takes effect for new work and asks active work to stop at its next safe
checkpoint.

| Limit | Default | Environment variable |
| --- | ---: | --- |
| Global concurrent Chrome sessions | 3 | `BROWSERBASE_MAX_CONCURRENT_SESSIONS` |
| Concurrent Chrome sessions per user | 1 | `BROWSERBASE_MAX_SESSIONS_PER_USER` |
| Maximum task runtime | 600 seconds | `BROWSERBASE_TASK_TIMEOUT_SECONDS` |
| Idle session timeout | 180 seconds | `BROWSERBASE_IDLE_TIMEOUT_SECONDS` (or `SANDBOX_IDLE_MS=180000`) |
| Browser time per user per day | 1,200 seconds | `BROWSERBASE_DAILY_SECONDS_PER_USER` |
| Monthly warning | 288,000 seconds (80 hours) | `BROWSERBASE_MONTHLY_WARNING_SECONDS` |
| Monthly hard stop | 342,000 seconds (95 hours) | `BROWSERBASE_MONTHLY_HARD_LIMIT_SECONDS` |

## Enforcement

Quota checking and slot acquisition must be one atomic database operation. Count active leases and
committed usage inside the same transaction to prevent concurrent requests from exceeding the cap.
Use UTC calendar boundaries, record the timezone shown to administrators, and never delete usage
records when a task is deleted.

The worker writes one usage record per attempt with queued/start/end timestamps, browser seconds,
model tokens and latency, tool/screenshot/human takeover/approval counts, status, failure reason,
and estimated cost. Browser time runs until Browserbase confirms termination, including human
control and cleanup delay. Failed sessions are billable if the provider reports runtime.

At 80 hours, alert operators and show an admin warning. At 95 hours, reject new browser sessions and
leave queued tasks paused with a clear reason; running sessions still receive orderly cleanup. An
operator emergency stop blocks creation, cancels active work, and shuts down all known sessions
(see [Emergency stop](#emergency-stop)).

## Emergency stop

The deployment owner can stop every bot at once from **Settings → 긴급 정지**. It is for when
something is going wrong or the meter is running away, and it is deliberately blunt:

- Every active run, in every space, is cancelled. The worker notices within a second and stops.
  Each affected thread gets a line saying the work was stopped by the administrator, and a sign-in
  sheet left open on a stopped run is closed.
- Every awake browser is put to sleep immediately instead of after its idle timeout, including a
  screen a user was holding. Sleep keeps each browser's Context, so sign-ins survive.
- While the stop is on, a run never starts: a message from any surface (web, phone, messaging,
  webhook, another bot) is answered with a notice instead. Routines and check-ins skip their slot
  and stay armed for the next one. History compaction is skipped.
- Turning it off lets work start again. Nothing that was cancelled or skipped is replayed; people
  ask again.

The switch is a row in `deployment_settings` (`agentsPausedAt`), so it holds across restarts and
deploys. If the web app itself is unreachable, the same stop can be applied in SQL:

```sql
UPDATE deployment_settings SET "agentsPausedAt" = now() WHERE id = 'default';
UPDATE runs SET status = 'cancelled', "completedAt" = now(), error = 'Emergency stop'
  WHERE status IN ('queued', 'leased', 'running', 'waiting_input', 'waiting_takeover');
```

That path skips the thread notices and the immediate browser shutdown; browsers then sleep after
their idle timeout. Turn it off with
`UPDATE deployment_settings SET "agentsPausedAt" = NULL, "agentsPausedBy" = NULL WHERE id = 'default';`.

## Cost calculation

Provider prices change, so store rate-card values with an effective date instead of hard-coding a
currency amount in task logic:

```text
browser_cost = browser_seconds / 3600 × browser_hour_rate
model_input_cost = input_tokens / 1,000,000 × input_million_token_rate
model_output_cost = output_tokens / 1,000,000 × output_million_token_rate
storage_cost = retained_gb_month × storage_gb_month_rate
estimated_cost = browser_cost + model_input_cost + model_output_cost + storage_cost
```

Persist the rate-card version and currency on each usage record so historical estimates do not
change when pricing changes. Reconcile monthly totals against Browserbase, model-provider, database,
and object-storage invoices. Do not claim exact billing when provider usage data is missing.

## Queue behavior

FIFO within a workspace is the default, with fair scheduling across users so one account cannot
occupy all three global slots. Queue position is advisory because cancellations, quota changes, and
operator pauses can alter order. Expired or duplicate queue leases must be reclaimed after worker
restart.
