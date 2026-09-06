# VPS deployment

This deployment profile is for a small Ubuntu VPS with about 2 GB RAM. The VPS runs only Caddy,
the web server, API, and worker. PostgreSQL is managed externally, Browserbase runs Chrome, and the
model provider runs inference. The VPS must never build the application image or run Chrome, Xvfb,
VNC, or a database container.

## Prerequisites

- A key-only `deploy` account with narrowly scoped `sudo` access
- Docker Engine and Docker Compose v2
- TCP 80 and 443 allowed; SSH restricted to the chosen administration port
- A managed PostgreSQL 16-compatible connection using TLS (Supabase Session Pooler works on IPv4)
- A prebuilt, immutable application image in a private registry
- Browserbase project credentials and a server-side model provider key
- A domain pointing at the VPS before login or Live View is exposed to beta users

With no domain, set `APP_ADDRESS=:80` and perform only an IP-based health check. Authentication,
cookies, and Browserbase Live View should not be offered publicly until HTTPS is available.

## Server layout

Install the tracked deployment files under `/opt/issam-bot/app` and keep secrets separately:

```text
/opt/issam-bot/
├── app/                 # public Git checkout
│   ├── Caddyfile
│   └── docker-compose.yml
└── secret.env           # mode 0600, never committed
```

Create the secret file without printing its values to terminal logs. The values below are
placeholders only. Percent-encode special characters in the PostgreSQL password.

```dotenv
ISSAM_BOT_IMAGE=ghcr.io/example/issam-bot@sha256:replace-with-image-digest
GIT_SHA=replace-with-git-commit
APP_ADDRESS=agent.example.com
RAKAZO_HOST=agent.example.com
DATABASE_URL=postgresql://user:password@managed-db.example.com:5432/postgres?sslmode=verify-full
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
ENCRYPTION_KEY=replace-with-a-long-random-secret
BETTER_AUTH_URL=https://agent.example.com
WEB_ORIGIN=https://agent.example.com
API_URL=https://agent.example.com
SIGNUPS_ENABLED=true
SIGNUP_ALLOWLIST=owner@example.com
SANDBOX_PROVIDER=browserbase
BROWSERBASE_API_KEY=replace-on-server
BROWSERBASE_PROJECT_ID=replace-on-server
BROWSERBASE_REGION=ap-southeast-1
BROWSERBASE_MAX_CONCURRENT_SESSIONS=3
BROWSERBASE_MAX_SESSIONS_PER_USER=1
BROWSERBASE_TASK_TIMEOUT_SECONDS=600
BROWSERBASE_IDLE_TIMEOUT_SECONDS=180
BROWSERBASE_DAILY_SECONDS_PER_USER=1200
BROWSERBASE_MONTHLY_WARNING_SECONDS=288000
BROWSERBASE_MONTHLY_HARD_LIMIT_SECONDS=342000
PI_DEFAULT_PROVIDER=openai
PI_DEFAULT_MODEL=gpt-5.6-luna
OPENAI_API_KEY=replace-on-server
OPENAI_MODEL_ID=gpt-5.6-luna
DATA_DIR=/data
WAKEUP_DRIVER=graphile
AGENT_RUNTIME=pi
```

Apply permissions and validate the rendered Compose model:

```bash
sudo chown deploy:deploy /opt/issam-bot/secret.env
sudo chmod 600 /opt/issam-bot/secret.env
cd /opt/issam-bot/app
docker compose --env-file /opt/issam-bot/secret.env config --quiet
```

The full file is read only by the API and worker. Compose passes the web container only its host and
shared screen-capability secret, and passes Caddy only the public address. Provider keys, the database
URL, and encryption key are never added to the web container or compiled into its browser bundle.

## Deploy

The image must be built and tested in CI, pushed under an immutable digest, and then referenced by
`ISSAM_BOT_IMAGE`. Pull and start without `--build`:

```bash
cd /opt/issam-bot/app
docker compose --env-file /opt/issam-bot/secret.env pull
docker compose --env-file /opt/issam-bot/secret.env up -d
./scripts/healthcheck.sh https://agent.example.com
docker compose --env-file /opt/issam-bot/secret.env ps
```

The API container runs `prisma migrate deploy` before accepting traffic. A migration failure keeps
the API unhealthy and prevents the worker from starting. The only public container ports are
Caddy's 80/443. API port 3100 and web port 5173 exist only on the Compose network.

The application image includes the pinned Supabase Root 2021 CA and starts Node with the system CA
store enabled. Keep hostname verification enabled and rotate the pinned CA before its expiry.

## Upgrade and rollback

1. Back up the managed database and app data with `sudo ./scripts/prod-backup.sh`.
2. Update the Git checkout and set `ISSAM_BOT_IMAGE` to the new immutable image digest.
3. Run `docker compose ... pull` and `docker compose ... up -d`.
4. Set `EXPECTED_REVISION` and run the health check.
5. Inspect API and worker logs without printing the secret environment.

```bash
EXPECTED_REVISION=<commit> ./scripts/healthcheck.sh https://agent.example.com
docker compose --env-file /opt/issam-bot/secret.env logs --since=10m api worker
```

For an application rollback, restore the previous image digest and redeploy. Database rollback is
not automatic: use a tested compatible backup only when a migration cannot roll forward.

The VPS deployment workflow starts a candidate revision with temporary Compose environment
overrides, leaving the image and revision persisted in `secret.env` unchanged until `/health`
reports the exact requested Git SHA. A pull or startup failure restores the persisted Compose
configuration, and a revision/health timeout re-creates the previous services from that
configuration. Database migrations remain forward-only, so releases with incompatible migrations
still require the tested database backup procedure above.

Only after exact-revision health verification succeeds does the workflow persist the new immutable
image reference and run `docker image prune -a -f`. Docker limits this command to images unused by
every container, so the running release and images referenced by stopped containers are retained.
The workflow never prunes containers or volumes. It prints `docker system df`, filesystem usage, and
Docker's reclaimed-space result before and after cleanup so disk pressure remains auditable.

## Backup and restore

Install the PostgreSQL client tools on the host. Backups default to `/var/backups/issam-bot`, use
mode `0700`, contain a verified custom-format DB dump and the `issam-bot-appdata` volume, and retain
seven days. Set `BACKUP_S3_URI=s3://bucket/prefix` to copy each verified snapshot off-host with the
AWS CLI. Configure the S3/R2 credentials outside the repository.

```bash
sudo /opt/issam-bot/app/scripts/prod-backup.sh
sudo /opt/issam-bot/app/scripts/prod-restore.sh /var/backups/issam-bot/<timestamp> --confirm
```

Restore is destructive and stops the API and worker first. Test restore into a disposable managed
database before relying on the procedure in production.

## Operations

- Use `docker compose ps` for container health and `./scripts/healthcheck.sh` for end-to-end health.
- Configure an external monitor for `/health`; do not treat a running container as proof of service.
- Alert on queue depth, stuck running tasks, Browserbase usage, model failures, disk pressure, and
  backup age.
- Rotate exposed credentials immediately and redeploy containers after rotation.
- Upgrade Ubuntu 20.04 before a public beta and keep unattended security updates active.
