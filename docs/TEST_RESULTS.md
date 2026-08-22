# Test results

This file distinguishes observed results from required future tests. A checklist entry is not proof
that the behavior exists.

## Phase 0 evidence available

| Area | Result | Evidence/limit |
| --- | --- | --- |
| VPS read-only audit | Pass | Recorded in `docs/VPS_AUDIT.md`; 1 vCPU, 1.9 GiB RAM, external services required. |
| Browserbase session canary | Pass, previously observed | A cloud session navigated to `example.com`, returned the title, exposed Live View, terminated, and its temporary Context was deleted. Re-run after every credential rotation. |
| Browserbase URL policy unit tests | Pass, previously observed | Eight adapter URL-policy tests passed. Full DNS-rebinding and redirect coverage remains a release gate. |
| Managed PostgreSQL connectivity | Pass, previously observed | TLS connection through the IPv4 Session Pooler was confirmed. Schema migration and restore remain separate checks. |
| OpenAI temporary provider | Pass, previously observed | `gpt-5.6-luna` returned a Responses API result and token usage. Agent tool loop is not proven by this canary. |
| Company Qwen provider | Blocked | Source-IP allowlisting was not available; no production capability claim is made. |
| Supabase Data API isolation | Pass | All 35 application tables have RLS enabled; `anon` and `authenticated` retain access to 0 tables. |
| IP-based VPS deployment | Pass | The immutable release served API/Web/Worker/Caddy, reported its exact revision from `/health`, and passed the deployment workflow. HTTPS remains blocked on a domain. |
| Signup and bot onboarding | Pass | A disposable user signed up through the deployed web UI, selected the deployment model without entering a client key, and created a Korean-named Browserbase bot. |
| OpenAI + Browserbase browser action | Pass | The deployment model interpreted a Korean instruction, opened `https://example.com` in Browserbase, and returned `Example Domain` in the chat. |
| Browserbase Live View and takeover | Pass | The deployed UI embedded the active Browserbase address bar/screencast, entered human-control mode, and returned control to the bot. |
| Browserbase idle cleanup | Pass | After the configured 180 seconds, the worker completed `computer.sleep`; the provider reported 0 active sessions and the newest session as `COMPLETED`. |
| Account deletion | Pass | The enabled Better Auth deletion endpoint removed the disposable user, its personal workspace/bot data and Browserbase Context, cleared the owner pointer, and revoked the session. The web menu now exposes this path behind confirmation and password re-entry. |
| Public HTTPS web deployment | Not run | A domain is not configured. IP-based access is for technical testing only. |

Previously observed results above are operational notes from Phase 0 and are not reproduced by this
documentation-only change. Provider secrets are intentionally absent from the repository.

## Deployment artifact validation

Validation performed for this change:

| Check | Result |
| --- | --- |
| `bash -n` for healthcheck, backup, and restore scripts | Pass |
| YAML parse and exact service set (`api`, `worker`, `web`, `caddy`) | Pass |
| Healthcheck against a local JSON health endpoint, including revision match | Pass |
| `git diff --check` | Pass |
| Full monorepo TypeScript checks | Pass; 19/19 Turbo tasks |
| Unit/integration tests | Pass; the latest adapters run passed 330 tests with 7 skipped, and the earlier full monorepo run passed 654 with 53 environment-dependent tests skipped |
| Production Vite web build | Pass; 2,331 modules transformed |
| Docker Compose render on the target VPS | Pass with Docker Compose 2.27.1 |
| Caddy container configuration validation on the target VPS | Pass with Caddy 2.10.2 |

Run these checks in CI or from a clean checkout:

```bash
bash -n scripts/healthcheck.sh scripts/backup.sh scripts/restore.sh
ISSAM_BOT_IMAGE=example.invalid/issam-bot:test \
  docker compose --env-file /path/to/placeholder.env config --quiet
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e APP_ADDRESS=:80 caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile
```

The placeholder environment must contain syntactically valid fake values only. Do not inject real
secrets into CI logs.

## Phase 0 completion gate

Phase 0 is complete only after one reproducible run records all of the following against the image
and commit intended for deployment:

- database migration succeeds against an empty and an existing schema;
- API, worker, web, and Caddy are healthy on the 2 GB profile;
- Browserbase creates a Context/session, Live View loads, one model-decided DOM action succeeds, and
  the session is confirmed terminated;
- browser seconds and model usage are stored once;
- `/health` returns the deployed Git revision;
- no Chrome/GUI/database container exists on the VPS.

## MVP tests not yet evidenced

- Signup/login/logout/account deletion and workspace isolation
- Bot/thread creation and mobile/desktop web synchronization
- Qwen text, streaming, structured output, tool calling, vision, Korean, long-context, latency,
  concurrency, and token-usage matrix
- Human login/takeover/return and Context login persistence
- Risk approval approve/deny/take-control paths
- Three global sessions, fourth queued, and per-user duplicate rejection
- Worker/VPS restart, provider termination, model timeout, browser close, duplicate delivery, and
  orphan reconciliation
- Backup upload and clean restore into a disposable environment
- Security, load, retention, deletion, and monthly hard-stop tests

Record commands, timestamps, commit/image digest, sanitized output, and failure reasons when these
tests are run. Never mark an unexecuted scenario as passed.
