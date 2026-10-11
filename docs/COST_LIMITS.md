# Usage and cost limits

## What is enforced today

One limit is implemented: a **weekly credit in won**, per account, reset every Monday at 00:00
Korean time. It is checked before a run starts and converts both meters — model tokens and
Browserbase seconds — into one figure through a single rate card, so a person with one budget
cannot be stopped by one meter while spending freely on the other.

| Limit | Default | Where it is set |
| --- | ---: | --- |
| Weekly credit per account | ₩2,000 | Deployment default, `deployment_settings.weeklyCreditKrw` |
| Weekly credit for one account | — | Per-account override, `user.weeklyCreditKrw` (null follows the default) |
| Deployment owner | no limit | Always: they receive the provider invoices |
| Maximum task runtime | 600 seconds | `BROWSERBASE_TASK_TIMEOUT_SECONDS` |
| Idle session timeout | 180 seconds | `SANDBOX_IDLE_MS` |

The owner sets both figures in Settings → 사용량 → 사용자별 한도 관리. Every account sees its own
balance on the pill beside its name, and the detail behind it names the rate card the figure came
from.

The rate card lives in `packages/core/src/credit.ts` with an effective date. It is the only place
a price is written down, and changing one changes every figure in the app at once.

**Checked before a run, not during one.** A run already under way keeps its session: killing it
halfway spends the money without finishing the job. A week can therefore end a little over its
limit, and the overspend comes out of the following check rather than out of a half-done task.

**Fails open.** If the usage tables cannot be read the run is allowed and the error is logged. A
budget is a cost control, not a safety control, and a database blip must not stop every bot in the
deployment.

## Not implemented

The limits below are a design, not behaviour. The environment variables named here are read by
nothing — do not set them and expect an effect.

| Limit | Intended default | Environment variable |
| --- | ---: | --- |
| Global concurrent Chrome sessions | 3 | `BROWSERBASE_MAX_CONCURRENT_SESSIONS` |
| Concurrent Chrome sessions per user | 1 | `BROWSERBASE_MAX_SESSIONS_PER_USER` |
| Browser time per user per day | 1,200 seconds | `BROWSERBASE_DAILY_SECONDS_PER_USER` |
| Monthly warning | 288,000 seconds (80 hours) | `BROWSERBASE_MONTHLY_WARNING_SECONDS` |
| Monthly hard stop | 342,000 seconds (95 hours) | `BROWSERBASE_MONTHLY_HARD_LIMIT_SECONDS` |

Until a concurrency cap exists, the weekly credit bounds what a deployment can spend over a week
but not what it can spend at once. Set a spend limit at the provider as well.

## Enforcement design for the rest

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
