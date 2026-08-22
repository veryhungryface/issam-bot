# Security baseline

Issam Bot is a multi-tenant service that controls third-party browsers. Browser control, persistent
profiles, model prompts, provider secrets, and approval decisions are security boundaries, not
ordinary application data.

## Tenant isolation

- Every API and repository operation must derive the workspace from the authenticated membership;
  a caller-provided workspace ID is not sufficient authorization.
- `browser_context_id`, session IDs, tasks, messages, artifacts, approvals, usage, and audit records
  must be workspace-scoped in every read and write.
- A Browserbase Context belongs to exactly one user or workspace. Never look it up by Context ID
  without also checking the owner.
- Task leases and idempotency keys prevent two workers from controlling one session or charging the
  same job twice.
- Account deletion revokes active sessions, terminates browsers, removes contexts and artifacts,
  and queues deletion of retained records according to policy.

Authorization and row-level isolation require application tests even when managed PostgreSQL RLS is
also enabled. Database service credentials can bypass RLS, so RLS is defense in depth rather than a
replacement for server authorization.

## Secret handling

- Real provider keys, database URLs, auth secrets, and private endpoints belong only in
  `/opt/issam-bot/secret.env` with mode `0600`, or in a production secret manager.
- Never put secrets in Git, image layers, client bundles, screenshots, support messages, command
  arguments visible to other users, or structured logs.
- Encrypt per-user provider credentials at rest with `ENCRYPTION_KEY`; decrypt only inside the API or
  worker process that needs the credential.
- Live View URLs are bearer capabilities. Issue them to an authenticated workspace member, make them
  short-lived, and never persist or log the full URL.
- Rotate any value disclosed in chat or logs. Removing it from a later commit does not remove it from
  Git history.

## Browser egress and SSRF

Resolve and validate every navigation target before session creation and again after redirects.
Block literal and resolved loopback, private, link-local, multicast, reserved, and cloud metadata
addresses, including:

```text
localhost
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1/128
fc00::/7
fe80::/10
```

Also deny the VPS management address, database hosts, internal DNS names, non-HTTP(S) schemes, and
URLs containing credentials. DNS rebinding defenses must compare all resolved addresses and
revalidate at connection time. Browserbase network controls should repeat the deny policy because
application validation alone cannot police every subresource.

The public VPS must never execute user-provided shell commands or code. If code execution becomes a
product requirement, use a separately authenticated and isolated sandbox such as E2B or Daytona;
do not mount the Docker socket into API or worker containers.

## Human control and approvals

An agent must pause immediately when the human takes control. A single server-side lease identifies
the current controller, and stale commands are rejected after a lease change. MFA, CAPTCHA,
password entry, payment details, and private messages are entered by the user through Live View and
must not be sent to the model.

Sending, posting, purchasing, confirming a reservation, deleting data, changing account/security
settings, submitting personal information, or changing external sharing requires a just-in-time
approval. The approval display records the site, account, exact change/content, expected effect, and
the user's approve/deny/take-control decision. Approval is bound to the specific task step and
expires when the page or proposed action changes.

## Web and host controls

- Enforce HTTPS, secure/HttpOnly/SameSite cookies, CSRF checks, exact CORS origins, input validation,
  output encoding, and rate limits on login and task creation.
- Keep signup allowlisted for beta. Provide session revocation and operator-wide pause controls.
- Caddy is the only public container. PostgreSQL, API, worker, and web ports are not published.
- Containers drop Linux capabilities, set `no-new-privileges`, use bounded process/memory limits,
  and have bounded logs. No container receives the Docker socket.
- UFW exposes only the verified SSH port plus 80/443. Keep fail2ban, unattended upgrades, audit logs,
  and key-only SSH enabled; root and password SSH remain disabled.
- Backups are mode `0600`/`0700`, encrypted off-host, retention-limited, and restore-tested.

## Logging and retention

Audit authentication, task state changes, Browserbase session lifecycle, controller changes,
approvals, operator actions, and usage counters. Record identifiers and outcomes, not model/provider
keys, authorization headers, cookies, Live View URLs, password fields, or full sensitive page text.
Redact query strings and request bodies at the edge.

Default ordinary execution history to 30 days. Do not retain sensitive screenshots. Keep only the
minimum screenshots required to explain important task steps, and allow the user to delete their
data. Provider recordings follow the shorter of the configured Browserbase retention or product
retention.

## Release gate

Before public access, complete tenant-crossing authorization tests, SSRF/redirect tests, CSRF/XSS
tests, rate-limit tests, approval bypass tests, credential scanning, dependency review, backup
restore, worker/VPS restart recovery, and concurrent-session accounting. A feature is not considered
secure merely because its UI is hidden.
