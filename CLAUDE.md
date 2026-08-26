# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Rakazo — an open-source platform for persistent AI teammates (bots with conversations, memory, routines, and computer access). This checkout is the **issam-bot deployment profile**: a Browserbase-only web/API/worker stack (see `docs/ARCHITECTURE.md`, `docs/BROWSERBASE.md`, `docs/DEPLOYMENT.md`). In this profile the only Chrome runtime is remote Browserbase sessions — the server never runs Chrome, Xvfb, VNC, or a desktop container — the model provider is company Qwen (temporarily OpenAI, `docs/QWEN_PROVIDER.md`), and the web app is served from Vercel (`vercel.json` rewrites `/api`, `/rpc`, `/health` to the VPS).

This is a **public repository**. Never commit secrets, `.env` files, private URLs, or real production data; use placeholders. Review the staged diff before committing.

## Commands

Requires Node 22+, pnpm 9, Docker Desktop. Monorepo managed by pnpm workspaces + Turbo; ESM throughout.

```bash
# First-time setup
cp .env.example .env   # set BETTER_AUTH_SECRET and ENCRYPTION_KEY
docker compose --env-file .env -f infra/compose/docker-compose.yml up postgres -d
pnpm install && pnpm db:generate && pnpm db:migrate && pnpm sandbox:build

pnpm dev               # api + worker + web + sandbox-supervisor (web at http://127.0.0.1:5173)
pnpm lint              # Biome lint + format check (pnpm format to write fixes)
pnpm check             # tsc --noEmit across the monorepo (via turbo)
pnpm build             # turbo build

# Database (Prisma, packages/db)
pnpm db:generate
pnpm db:migrate                                # migrate deploy
pnpm --filter @rakazo/db migrate:dev           # create a new migration
```

### Tests

Vitest config lives at the repo root; tests are colocated `*.test.ts` files next to source.

```bash
pnpm test                                      # unit/property/in-process contract tests (offline, deterministic)
pnpm vitest run packages/core/src/cron.test.ts # single test file
pnpm vitest run packages/core/src/cron.test.ts -t "name"  # single test by name
pnpm test:integration    # Postgres via Testcontainers, Graphile jobs, LISTEN/NOTIFY (needs Docker)
pnpm test:e2e            # Playwright against the emulated stack (needs Docker)
pnpm test:e2e -- --sandbox=e2b|daytona|box     # same suite against a real provider (needs keys)
pnpm test:topology       # Docker computer + Graphile worker recovery (not PR CI)
pnpm test:canary         # live OpenRouter/E2B/Box canaries (needs keys, not PR CI)
```

CI runs `lint`, `check`, production builds, `test`, `test:integration`, and `test:e2e` on every PR.

## Architecture

Layering (dependency direction is downward):

- **`packages/contracts`** — the source of truth for the API surface: Zod schemas, oRPC contract (`rpc.ts`), domain types, IDs, and realtime event shapes. Web, desktop, mobile, api, and worker all consume it; change contracts here first.
- **`packages/core`** — pure, deterministic domain logic (run state, cron, screen leases, secrets guard, sandbox command policy, etc.). No I/O.
- **`packages/adapter-kit`** — interfaces, registry, and background-job types that adapters implement.
- **`packages/adapters`** — all integrations: the Pi agent runtime (`pi-runtime.ts`, `executor.ts`), sandbox providers (Browserbase, E2B, Daytona, Box, Docker, fake) each with a matching **emulator** and shared conformance tests (`sandbox-conformance.test.ts`), Composio connector, voice providers (ElevenLabs/OpenAI/Cartesia), Graphile background-job handlers, realtime (Postgres LISTEN/NOTIFY), wakeup drivers, and memory context.
- **`packages/db`** (Prisma schema + migrations), **`packages/auth`** (Better Auth), **`packages/memory`**, **`packages/testkit`** (test harness CLIs + integration/e2e suites).
- **UI**: `packages/chat-ui`, `packages/ui-web`, `packages/ui-tokens` — shared React 19 components.

Apps are thin hosts over the shared packages:

- **`apps/api`** — Hono + oRPC server (runs under tsx), plus HTTP-edge concerns: screen proxy, voice, search, artifact serving.
- **`apps/worker`** — Graphile Worker entry point; executes agent runs and background jobs via adapters.
- **`apps/web`** — Vite + React 19 + Tailwind PWA. **`apps/desktop`** (Electron) and **`apps/mobile`** (Expo) are clients of the same API — consider every surface when changing features or contracts. **`apps/www`** — Astro marketing site.
- **`infra/sandboxes/supervisor`** — `@rakazo/sandbox-supervisor`, the host-side service for local Docker computers (part of `pnpm dev`).

### Product path vs. test emulation

The product path is **Pi + Docker/Browserbase + Graphile**. Emulator settings (`AGENT_RUNTIME=scripted`, `SANDBOX_PROVIDER=fake`, `WAKEUP_DRIVER=memory`) are for tests only. Keep tests deterministic and offline by default; live-key suites are the explicit canary/computer commands.

### Security invariants (this deployment)

- Every query must be workspace-scoped; Browserbase Context IDs are stored per workspace.
- Provider credentials stay in API/worker server env, never in the browser bundle (no `PUBLIC_` secrets).
- The worker allows browser actions only, and must reject shell/terminal/arbitrary code and localhost, RFC1918, link-local, and cloud-metadata targets.
- Live View control uses a task-level lease — one holder per session.
- Product session limits are deliberately below Browserbase plan limits; both are changed explicitly, never inferred from the provider dashboard.
- Treat auth, secret handling, sandbox boundaries, host commands, and integrations as security-sensitive.

## Conventions

- Prefer shared packages for domain logic, contracts, API behavior, and reusable UI; keep only genuinely native navigation/storage/permissions platform-specific.
- Biome enforces formatting/linting (`biome.json`); run `pnpm format` rather than hand-formatting.
- After opening a PR, stay with it until CI **and** automated review bots finish: poll checks, review threads, and comments (~60s intervals), fix every actionable issue, and repeat until nothing actionable remains. Passing checks alone do not mean review is complete. Do not merge while bots are pending.
