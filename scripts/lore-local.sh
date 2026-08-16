#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
command_name=${1:-up}
app_url=${LORE_LOCAL_URL:-http://localhost:5173}
api_url=${LORE_LOCAL_API_URL:-http://127.0.0.1:3001}
lore_docker_config_ready=false
lore_temporary_docker_config=""

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
identity, repository discovery, and PR evidence all use one GITHUB_TOKEN.
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

prepare_docker_cli() {
  [[ "$lore_docker_config_ready" == true ]] && return
  lore_docker_config_ready=true
  local source_config credential_store helper docker_host
  source_config="${DOCKER_CONFIG:-${HOME}/.docker}/config.json"
  credential_store=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    try { process.stdout.write(JSON.parse(readFileSync(process.argv[1], "utf8")).credsStore ?? ""); } catch {}
  ' "$source_config")
  [[ -z "$credential_store" ]] && return
  helper="docker-credential-${credential_store}"
  command -v "$helper" >/dev/null 2>&1 && return

  docker_host=$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
  [[ -n "$docker_host" ]] || die "Docker credential helper '$helper' is missing and the active context could not be resolved."
  lore_temporary_docker_config=$(mktemp -d "${TMPDIR:-/tmp}/lore-docker-config.XXXXXX")
  chmod 700 "$lore_temporary_docker_config"
  node --input-type=module -e '
    import { existsSync, writeFileSync } from "node:fs";
    const target = process.argv[1];
    const candidates = process.argv.slice(2).filter(existsSync);
    writeFileSync(target, JSON.stringify({ auths: {}, cliPluginsExtraDirs: candidates }, null, 2), { mode: 0o600 });
  ' "$lore_temporary_docker_config/config.json" \
    "${HOME}/.docker/cli-plugins" \
    /opt/homebrew/lib/docker/cli-plugins \
    /usr/local/lib/docker/cli-plugins
  export DOCKER_CONFIG="$lore_temporary_docker_config"
  export DOCKER_HOST="$docker_host"
  trap '[[ -n "$lore_temporary_docker_config" ]] && rm -rf "$lore_temporary_docker_config"' EXIT
  printf "Using an isolated Docker client config because credential helper '%s' is unavailable.\n" "$helper"
}

compose() {
  prepare_docker_cli
  (cd "$repo_root" && docker compose -f docker-compose.yml "$@")
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
      set("LORE_DEPLOYMENT_MODE", "local");
      const sessionSecret = read("SESSION_SECRET");
      const generated = sessionSecret.length < 32 || sessionSecret.startsWith("replace-with");
      if (generated) set("SESSION_SECRET", randomBytes(48).toString("base64url"));
      if (read("OPENAI_API_KEY") && (!read("AI_PROVIDER") || read("AI_PROVIDER") === "mock")) {
        set("AI_PROVIDER", "openai");
      }
      if (read("AI_PROVIDER") === "openai" && (!read("OPENAI_MODEL") || read("OPENAI_MODEL") === "gpt-4")) set("OPENAI_MODEL", "gpt-4.1-mini");
      writeFileSync(path, value, { mode: 0o600 });
      process.stdout.write(generated ? "Generated a secure SESSION_SECRET.\n" : "Preserved the configured SESSION_SECRET.\n");
    ')
  chmod 600 "$repo_root/.env"
  cat <<'EOF'

Before starting, add one GitHub credential to .env:

   GITHUB_TOKEN=github_pat_...

Optional live setup target:

   LORE_TEST_REPOSITORY=D3R/soho-home

Then run: npm run local:up
EOF
}

preflight() {
  require_command docker
  require_command curl
  ensure_dependencies
  [[ -f "$repo_root/.env" ]] || die "run npm run local:setup first."
  (cd "$repo_root" && env NODE_ENV=production DEMO_MODE=false LORE_DEPLOYMENT_MODE=local npm run setup:check -- --docker --github-repository --ai)
  prepare_docker_cli
  docker info >/dev/null 2>&1 || die "the Docker daemon is not running. Start Docker Desktop or Colima, then retry."

  local target
  target=$(env_value LORE_TEST_REPOSITORY)
  if [[ -n "$target" && "$(env_value LORE_GITHUB_PREFLIGHT)" != "false" ]]; then
    (cd "$repo_root" && npm run github:check -- "$target")
  fi
  if [[ "$(env_value LORE_AI_PREFLIGHT)" != "false" ]]; then
    (cd "$repo_root" && npm run ai:check)
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
  1. Open Lore; your GitHub profile and private local workspace are created automatically.
  2. Open Repositories and select D3R/soho-home from the token-backed picker.
  3. Lore imports all merged PR evidence immediately and keeps it synchronised.
  4. Review AI-generated candidates before promoting them to active knowledge.

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
