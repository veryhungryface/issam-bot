#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET_ENV="${SECRET_ENV:-/opt/issam-bot/secret.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
APPDATA_VOLUME="${APPDATA_VOLUME:-issam-bot-appdata}"
SRC="${1:-}"

if [[ -z "$SRC" || "${2:-}" != "--confirm" ]]; then
  echo "Usage: $0 /absolute/path/to/backup --confirm" >&2
  echo "This replaces the target database and, when present, the app data volume." >&2
  exit 2
fi
SRC="$(cd "$SRC" 2>/dev/null && pwd)" || {
  echo "Backup directory not found: $SRC" >&2
  exit 1
}

read_secret() {
  local key="$1"
  [[ -r "$SECRET_ENV" ]] || return 1
  sed -n "s/^${key}=//p" "$SECRET_ENV" | tail -n 1 | tr -d '\r'
}

DATABASE_URL="${DATABASE_URL:-$(read_secret DATABASE_URL || true)}"
ISSAM_BOT_IMAGE="${ISSAM_BOT_IMAGE:-$(read_secret ISSAM_BOT_IMAGE || true)}"
if [[ -z "$DATABASE_URL" || -z "$ISSAM_BOT_IMAGE" ]]; then
  echo "DATABASE_URL and ISSAM_BOT_IMAGE must be set or present in $SECRET_ENV" >&2
  exit 1
fi
export DATABASE_URL ISSAM_BOT_IMAGE

for command in docker pg_restore sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is missing: $command" >&2
    exit 1
  }
done

[[ -f "$SRC/database.dump" && -f "$SRC/SHA256SUMS" ]] || {
  echo "Backup is missing database.dump or SHA256SUMS." >&2
  exit 1
}
(
  cd "$SRC"
  sha256sum --check SHA256SUMS
)
pg_restore --list "$SRC/database.dump" >/dev/null

compose=(docker compose --env-file "$SECRET_ENV" -f "$COMPOSE_FILE")
"${compose[@]}" stop api worker
restart_services=true
trap 'if [[ "$restart_services" == true ]]; then "${compose[@]}" up -d api worker web caddy >/dev/null 2>&1 || true; fi' EXIT

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname="$DATABASE_URL" "$SRC/database.dump"

if [[ -f "$SRC/appdata.tgz" ]]; then
  docker volume inspect "$APPDATA_VOLUME" >/dev/null 2>&1 || docker volume create "$APPDATA_VOLUME" >/dev/null
  docker run --rm \
    -v "${APPDATA_VOLUME}:/target" \
    -v "${SRC}:/backup:ro" \
    alpine:3.20 \
    sh -eu -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -C /target -xzf /backup/appdata.tgz'
fi

"${compose[@]}" up -d api worker web caddy
restart_services=false
trap - EXIT
echo "Restore complete from $SRC"
