#!/usr/bin/env bash
set -euo pipefail

secret_file=${SECRET_FILE:-/opt/issam-bot/secret.env}
if [[ ! -r "$secret_file" ]]; then
  printf 'Cannot read existing secret file: %s\n' "$secret_file" >&2
  exit 1
fi

stty -echo
printf 'Browserbase API key: ' >&2
IFS= read -r browserbase_key
printf '\nOpenAI API key: ' >&2
IFS= read -r openai_key
stty echo
printf '\n' >&2

database_url=$(sudo -n sed -n 's/^DATABASE_URL=//p' "$secret_file")
auth_secret=$(openssl rand -base64 48 | tr -d '\n')
encryption_key=$(openssl rand -hex 32)
temp_file=$(mktemp)
trap 'rm -f "$temp_file"' EXIT
chmod 600 "$temp_file"

{
  printf 'NODE_ENV=production\n'
  printf 'ISSAM_BOT_IMAGE=ghcr.io/veryhungryface/issam-bot:latest\n'
  printf 'GIT_SHA=\n'
  printf 'APP_ADDRESS=:80\n'
  printf 'RAKAZO_HOST=172.245.30.225\n'
  printf 'DATABASE_URL=%s\n' "$database_url"
  printf 'REALTIME_DATABASE_URL=%s\n' "$database_url"
  printf 'BETTER_AUTH_SECRET=%s\n' "$auth_secret"
  printf 'ENCRYPTION_KEY=%s\n' "$encryption_key"
  printf 'BETTER_AUTH_URL=http://172.245.30.225\n'
  printf 'WEB_ORIGIN=http://172.245.30.225\n'
  printf 'API_URL=http://api:3100\n'
  printf 'SIGNUPS_ENABLED=true\n'
  printf 'DATA_DIR=/data\n'
  printf 'SANDBOX_PROVIDER=browserbase\n'
  printf 'BROWSERBASE_API_KEY=%s\n' "$browserbase_key"
  printf 'BROWSERBASE_PROJECT_ID=7419d7dc-f773-4176-9418-0c0d339a3c6a\n'
  printf 'BROWSERBASE_MAX_CONCURRENT_SESSIONS=3\n'
  printf 'BROWSERBASE_MAX_SESSIONS_PER_USER=1\n'
  printf 'BROWSERBASE_TASK_TIMEOUT_SECONDS=600\n'
  printf 'BROWSERBASE_IDLE_TIMEOUT_SECONDS=180\n'
  printf 'OPENAI_API_KEY=%s\n' "$openai_key"
  printf 'PI_DEFAULT_PROVIDER=openai\n'
  printf 'PI_DEFAULT_MODEL=gpt-5.6-luna\n'
  printf 'AGENT_RUNTIME=pi\n'
  printf 'WAKEUP_DRIVER=graphile\n'
  printf 'LOG_LEVEL=info\n'
} > "$temp_file"

sudo -n install -o root -g root -m 600 "$temp_file" "$secret_file"
unset browserbase_key openai_key database_url auth_secret encryption_key
sudo -n stat -c '%U:%G %a %n' "$secret_file"
