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

# The public /health is a constant body now. The revision lives on /internal/health,
# which the edge does not route, so check it against the API port on the host itself.
if [[ -n "$EXPECTED_REVISION" ]]; then
  details="$(curl --fail --silent --show-error \
    --connect-timeout 5 \
    --max-time "$TIMEOUT_SECONDS" \
    "${INTERNAL_HEALTH_URL:-http://127.0.0.1:3100/internal/health}" || true)"
  response="$details"
fi

if [[ -n "$EXPECTED_REVISION" && "$response" != *"\"revision\":\"$EXPECTED_REVISION\""* ]]; then
  echo "Internal health revision does not match EXPECTED_REVISION." >&2
  exit 1
fi

echo "Healthy: $BASE_URL"
