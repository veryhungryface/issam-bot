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
| Idle session timeout | 180 seconds | `BROWSERBASE_IDLE_TIMEOUT_SECONDS` |
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
operator emergency stop blocks creation, cancels safe active work, and terminates all known sessions.

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
