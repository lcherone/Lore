#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
command_name=${1:-up}
app_url=${LORE_LOCAL_URL:-http://localhost:5173}
api_url=${LORE_LOCAL_API_URL:-http://127.0.0.1:3001}

die() {
  printf 'Lore local production: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Lore local-production stack

Usage:
  npm run local:setup   Create .env when missing and generate a session secret
  npm run local:up      Preflight, build, migrate, and start every service
  npm run local:check   Verify the running web/API/database/queue stack
  npm run local:status  Show container state
  npm run local:logs    Follow API and worker logs
  npm run local:down    Stop containers without deleting persistent data

The stack is bound only to localhost. It runs production-built web assets,
PostgreSQL, Redis, migrations, the API, and the background worker. GitHub user
login and repository access use separate credentials in .env.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required."
}

ensure_dependencies() {
  if [[ ! -x "$repo_root/node_modules/.bin/tsx" ]]; then
    printf 'Installing Lore dependencies...\n'
    (cd "$repo_root" && npm install)
  fi
}

env_value() {
  local key=$1
  (cd "$repo_root" && node --input-type=module -e '
    import "dotenv/config";
    const key = process.argv[1];
    process.stdout.write(process.env[key]?.trim() ?? "");
  ' "$key")
}

compose() {
  local mode
  local -a files
  mode=$(env_value GITHUB_AUTH_MODE)
  files=(-f docker-compose.yml)
  if [[ "$mode" == "token" && -n "$(env_value GITHUB_TOKEN_FILE)" ]]; then
    files+=(-f docker-compose.github-token.yml)
  elif [[ "$mode" == "app" && -n "$(env_value GITHUB_PRIVATE_KEY_FILE)" ]]; then
    files+=(-f docker-compose.github.yml)
  fi
  (cd "$repo_root" && docker compose "${files[@]}" "$@")
}

setup_environment() {
  require_command node
  if [[ ! -f "$repo_root/.env" ]]; then
    cp "$repo_root/.env.example" "$repo_root/.env"
    printf 'Created .env from .env.example.\n'
  else
    printf 'Found existing .env; configured credentials will be preserved.\n'
  fi
  (cd "$repo_root" && node --input-type=module -e '
      import { randomBytes } from "node:crypto";
      import { readFileSync, writeFileSync } from "node:fs";
      const path = ".env";
      let value = readFileSync(path, "utf8");
      const read = (name) => value.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
      const set = (name, next) => {
        const line = `${name}=${next}`;
        value = new RegExp(`^${name}=.*$`, "m").test(value)
          ? value.replace(new RegExp(`^${name}=.*$`, "m"), line)
          : `${value.trimEnd()}\n${line}\n`;
      };
      set("NODE_ENV", "production");
      set("DEMO_MODE", "false");
      set("LOCAL_DEV_AUTH", "false");
      const sessionSecret = read("SESSION_SECRET");
      const generated = sessionSecret.length < 32 || sessionSecret.startsWith("replace-with");
      if (generated) set("SESSION_SECRET", randomBytes(48).toString("base64url"));
      if (!read("GITHUB_OAUTH_CALLBACK_URL")) {
        set("GITHUB_OAUTH_CALLBACK_URL", "http://localhost:5173/api/auth/github/callback");
      }
      writeFileSync(path, value, { mode: 0o600 });
      process.stdout.write(generated ? "Generated a secure SESSION_SECRET.\n" : "Preserved the configured SESSION_SECRET.\n");
    ')
  chmod 600 "$repo_root/.env"
  cat <<'EOF'

Before starting, add both credential groups to .env:

1. GitHub OAuth App for human login
   GITHUB_OAUTH_CLIENT_ID=...
   GITHUB_OAUTH_CLIENT_SECRET=...
   GITHUB_OAUTH_CALLBACK_URL=http://localhost:5173/api/auth/github/callback

2. Fine-grained PAT for repository history
   GITHUB_AUTH_MODE=token
   GITHUB_TOKEN_FILE=/absolute/host/path/to/github-token
   LORE_TEST_REPOSITORY=D3R/soho-home

Then run: npm run local:up
EOF
}

preflight() {
  require_command docker
  require_command curl
  ensure_dependencies
  [[ -f "$repo_root/.env" ]] || die "run npm run local:setup first."
  (cd "$repo_root" && env NODE_ENV=production DEMO_MODE=false LOCAL_DEV_AUTH=false npm run setup:check -- --docker --github-login --github-repository)
  docker info >/dev/null 2>&1 || die "the Docker daemon is not running. Start Docker Desktop or Colima, then retry."

  local mode target
  mode=$(env_value GITHUB_AUTH_MODE)
  target=$(env_value LORE_TEST_REPOSITORY)
  if [[ "$mode" == "token" && -n "$target" && "$(env_value LORE_GITHUB_PREFLIGHT)" != "false" ]]; then
    (cd "$repo_root" && npm run github:check -- "$target")
  fi
  compose config --quiet
}

wait_for_stack() {
  local ready=false
  for _attempt in $(seq 1 120); do
    if curl -fsS "$api_url/readyz" >/dev/null 2>&1 && \
      curl -fsS "$app_url" 2>/dev/null | grep -q '<div id="root"></div>'; then
      ready=true
      break
    fi
    sleep 1
  done
  if [[ "$ready" != true ]]; then
    compose ps >&2 || true
    compose logs --tail=80 api worker web migrate >&2 || true
    die "the stack did not become ready within 120 seconds."
  fi
}

check_stack() {
  require_command curl
  local health readiness
  health=$(curl -fsS "$api_url/healthz") || die "API health check failed at $api_url/healthz."
  readiness=$(curl -fsS "$api_url/readyz") || die "API readiness check failed at $api_url/readyz."
  curl -fsS "$app_url" | grep -q '<div id="root"></div>' || die "built web application is not available at $app_url."
  printf '✓ API health     %s\n' "$health"
  printf '✓ Dependencies   %s\n' "$readiness"
  printf '✓ Built web app  %s\n' "$app_url"
  printf '✓ Runtime        persistent local-production mode\n'
}

start_stack() {
  preflight
  printf '\nBuilding and starting Lore local production...\n'
  compose up --build --detach --remove-orphans
  wait_for_stack
  printf '\n'
  check_stack
  cat <<EOF

Lore is live locally: $app_url

Next:
  1. Continue with GitHub.
  2. Create or select your organisation.
  3. Open Repositories and paste https://github.com/D3R/soho-home.
  4. Set retention, import 50 PRs first, review results, then expand deliberately.

Logs: npm run local:logs
Stop: npm run local:down
EOF
}

require_command node
require_command npm

case "$command_name" in
  setup) setup_environment ;;
  up) start_stack ;;
  check) check_stack ;;
  status) compose ps ;;
  logs) compose logs --follow api worker web ;;
  down) compose down ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown command '$command_name'." ;;
esac
