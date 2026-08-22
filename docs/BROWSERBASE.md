# Browserbase integration

Browserbase is the only Chrome runtime in this deployment. API and worker containers create and
control remote sessions; Caddy and the VPS never proxy video or run Chrome/Chromium, Xvfb, VNC, or a
desktop container.

## Server configuration

Store these values in `/opt/issam-bot/secret.env` and never expose them through a `PUBLIC_` variable:

```dotenv
SANDBOX_PROVIDER=browserbase
BROWSERBASE_API_KEY=replace-on-server
BROWSERBASE_PROJECT_ID=replace-on-server
BROWSERBASE_MAX_CONCURRENT_SESSIONS=3
BROWSERBASE_MAX_SESSIONS_PER_USER=1
BROWSERBASE_TASK_TIMEOUT_SECONDS=600
BROWSERBASE_IDLE_TIMEOUT_SECONDS=180
BROWSERBASE_DAILY_SECONDS_PER_USER=1200
BROWSERBASE_MONTHLY_WARNING_SECONDS=288000
BROWSERBASE_MONTHLY_HARD_LIMIT_SECONDS=342000
```

Application limits deliberately remain below the provider plan. Changing a provider dashboard limit
does not change the product limit; both must be reviewed explicitly.

## Session lifecycle

1. Authenticate the user and authorize workspace membership.
2. Validate the task URL policy, daily/monthly quota, per-user concurrency, and global concurrency.
3. Enqueue when no slot is available; expose queue position based on committed queue state.
4. Acquire an idempotent task lease, then load or create the workspace-owned Browserbase Context.
5. Create one Browserbase session attached to that Context and persist its external ID immediately.
6. Connect the worker over Playwright/CDP and prefer DOM, text, role, and ARIA selectors.
7. Request a short-lived Live View capability server-side and return it only to an authenticated
   member. The user's browser connects directly to Browserbase.
8. On human takeover, atomically transfer the controller lease and wait for in-flight agent actions
   to finish or cancel before enabling user input.
9. On return to the bot, snapshot the current URL/DOM, transfer the lease, and resume from a
   checkpoint rather than replaying the last click.
10. On completion, cancellation, timeout, disconnect, or failure, attempt session termination in a
    `finally` path, persist usage, release the slot, and wake the next queued task.

Contexts preserve login state between sessions. A Context ID is never accepted directly from a
client and is never shared across workspaces. Passwords, MFA values, and CAPTCHA input are entered by
the user and excluded from prompts, screenshots, and long-term storage.

## Failure handling

Session creation and task execution are retryable only before a non-idempotent side effect. Use a
stable task attempt ID and store the Browserbase session ID as soon as it exists. A retry must first
check whether the previous session is still active.

Handle at least these terminal paths:

- Browserbase API/session creation error
- CDP connection failure or unresponsive Chrome
- Live View failure or user network disconnect
- model timeout, malformed tool call, or cancelled stream
- task/idle timeout or user cancellation
- browser closed by the user
- worker or VPS restart
- duplicate delivery or lost task lease

A periodic reconciler compares database `running` sessions with Browserbase active sessions. It
terminates orphaned provider sessions, marks missing sessions failed or recoverable, closes expired
human-control leases, and releases charged concurrency slots. Usage uses provider timestamps when
available and a monotonic local timer as a fallback.

## Live View controls

The API returns a short-lived URL or capability, never the Browserbase API key. The page embeds Live
View in a constrained iframe and displays task/controller state separately from the iframe. The URL
must expire quickly and be reissued only after authorization. Do not store it in analytics, browser
history, error tracking, or audit payloads.

Direct user-to-Browserbase transport is intentional: proxying the stream through the 2 GB VPS would
increase bandwidth, latency, and the blast radius of a credential leak.

### Korean and other IME input

Browserbase Live View forwards desktop key events, but cross-origin remote keyboard input does not
reliably preserve browser IME composition. Direct Korean typing can therefore arrive as separated
jamo. While the user holds computer control, the full-screen viewer exposes a local **한글/IME
입력** field. The user first clicks the desired field in the remote browser, composes text locally,
then presses Enter or **입력**. The server sends the completed Unicode string through Playwright's
`keyboard.insertText()` over the existing authenticated computer-input endpoint. This does not
depend on clipboard permission or page origin. Input is capped at 10,000 characters and remains
subject to the active takeover lease.

ASCII keyboard input, pointer actions, and scrolling continue to use Live View directly.

## Login context scope

- **Shared login** (the default, internally `team`) uses one persistent Browserbase Context for all
  bots in the same workspace.
- **Bot-only login** (internally `dedicated`) assigns a separate persistent Context to that bot.
- Context IDs are stored only in the server-side computer provider reference and every lookup is
  constrained by the authenticated workspace and user.
- Stopping or idling a session ends the Browserbase session but retains its Context.

## Validation checklist

- Create a Context, create a session, navigate to `https://example.com`, and read the page title.
- Display Live View on desktop and mobile without exposing the API key.
- Take control for login, return control, and continue the same task.
- Terminate the session, create a new session with the same Context, and verify login persistence.
- Run three concurrent users; queue the fourth; reject a second concurrent task for one user.
- Force-close the worker and provider session and verify reconciliation removes stuck `running`
  state and releases usage.
- Verify all blocked network ranges directly and through redirects/DNS aliases.
- Confirm every terminal path attempts Browserbase cleanup and writes one usage record.
