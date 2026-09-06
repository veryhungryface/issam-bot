#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRET_ENV="${SECRET_ENV:-/opt/issam-bot/secret.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/issam-bot}"
STAMP="${1:-$(date -u +%Y%m%dT%H%M%SZ)}"
APPDATA_VOLUME="${APPDATA_VOLUME:-issam-bot-appdata}"

read_secret() {
  local key="$1"
  [[ -r "$SECRET_ENV" ]] || return 1
  sed -n "s/^${key}=//p" "$SECRET_ENV" | tail -n 1 | tr -d '\r'
}

DATABASE_URL="${DATABASE_URL:-$(read_secret DATABASE_URL || true)}"
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL is not set and was not found in $SECRET_ENV" >&2
  exit 1
fi

for command in docker pg_dump pg_restore realpath sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command is missing: $command" >&2
    exit 1
  }
done

if [[ ! "$STAMP" =~ ^[A-Za-z0-9._-]+$ || "$STAMP" == "." || "$STAMP" == ".." ]]; then
  echo "Backup label may contain only letters, numbers, dot, underscore, and hyphen." >&2
  exit 1
fi
if [[ ! "${BACKUP_RETENTION_DAYS:-7}" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi
BACKUP_ROOT="$(realpath -m "$BACKUP_ROOT")"
case "${BACKUP_ROOT%/}" in
  ""|/|/var|/var/backups|"$ROOT")
    echo "Refusing unsafe BACKUP_ROOT: $BACKUP_ROOT" >&2
    exit 1
    ;;
esac
OUT="${BACKUP_ROOT}/${STAMP}"
if [[ -e "$OUT" ]]; then
  echo "Refusing to overwrite an existing backup: $OUT" >&2
  exit 1
fi

install -d -m 700 "$OUT"
pg_dump --format=custom --no-owner --no-privileges --file="$OUT/database.dump" "$DATABASE_URL"
pg_restore --list "$OUT/database.dump" >/dev/null

if docker volume inspect "$APPDATA_VOLUME" >/dev/null 2>&1; then
  docker run --rm --read-only \
    -v "${APPDATA_VOLUME}:/source:ro" \
    -v "${OUT}:/backup" \
    alpine:3.20 \
    tar -C /source -czf /backup/appdata.tgz .
else
  echo "App data volume $APPDATA_VOLUME does not exist; database-only backup created." >&2
fi

(
  cd "$OUT"
  checksum_files=(database.dump)
  [[ -f appdata.tgz ]] && checksum_files+=(appdata.tgz)
  sha256sum "${checksum_files[@]}" > SHA256SUMS
)

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  command -v aws >/dev/null 2>&1 || {
    echo "BACKUP_S3_URI is set but the aws CLI is unavailable." >&2
    exit 1
  }
  aws s3 sync --only-show-errors "$OUT/" "${BACKUP_S3_URI%/}/${STAMP}/"
fi

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS:-7}" -print -exec rm -r -- {} +
echo "Backup verified: $OUT"
