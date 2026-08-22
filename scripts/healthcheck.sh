#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1}}"
EXPECTED_REVISION="${EXPECTED_REVISION:-}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-15}"

command -v curl >/dev/null 2>&1 || {
  echo "Required command is missing: curl" >&2
  exit 1
}

BASE_URL="${BASE_URL%/}"
case "$BASE_URL" in
  http://*|https://*) ;;
  *)
    echo "Health URL must begin with http:// or https://" >&2
    exit 2
    ;;
esac

response="$(curl --fail --silent --show-error \
  --connect-timeout 5 \
  --max-time "$TIMEOUT_SECONDS" \
  --retry 2 \
  --retry-all-errors \
  "$BASE_URL/health")"

if [[ "$response" != *'"ok":true'* ]]; then
  echo "Health endpoint returned an unexpected body." >&2
  exit 1
fi

if [[ -n "$EXPECTED_REVISION" && "$response" != *"\"revision\":\"$EXPECTED_REVISION\""* ]]; then
  echo "Health endpoint revision does not match EXPECTED_REVISION." >&2
  exit 1
fi

echo "Healthy: $BASE_URL"
