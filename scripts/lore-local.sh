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
  npm run local         Prompt for the one PAT, configure, verify, and start Lore
  npm run local:setup   Create .env when missing and generate a session secret
  npm run local:up      Preflight, build, migrate, and start every service
  npm run local:start   Start existing images without rebuilding
  npm run local:check   Verify the running web/API/database/queue stack
  npm run local:status  Show container state
  npm run local:logs    Follow API and worker logs
  npm run local:down    Stop containers without deleting persistent data
  npm run local:backup  Save a timestamped PostgreSQL backup under backups/
  npm run local:install Install a macOS login service so Lore starts on boot
  npm run local:uninstall Remove the macOS login service (data is preserved)
  npm run cli:install   Build and globally link the lore terminal command
  npm run cli:check     Verify which lore command is on PATH
  npm run cli:uninstall Remove only the global terminal command

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
      const original = readFileSync(path, "utf8");
      const current = new Map(
        original.split(/\r?\n/).flatMap((line) => {
          const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
          return match ? [[match[1], match[2]]] : [];
        })
      );
      let value = readFileSync(".env.example", "utf8");
      const read = (name) => value.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
      const set = (name, next) => {
        const line = `${name}=${next}`;
        value = new RegExp(`^${name}=.*$`, "m").test(value)
          ? value.replace(new RegExp(`^${name}=.*$`, "m"), line)
          : `${value.trimEnd()}\n${line}\n`;
      };
      for (const [name, configured] of current) {
        if (configured.trim() && new RegExp(`^${name}=.*$`, "m").test(value)) set(name, configured);
      }
      set("NODE_ENV", "production");
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
  local configured_token github_token
  configured_token=$(env_value GITHUB_TOKEN)
  if [[ -z "$configured_token" && -t 0 ]]; then
    printf '\nGitHub PAT (hidden; press Enter to configure it later): '
    IFS= read -r -s github_token
    printf '\n'
    if [[ -n "$github_token" ]]; then
      [[ ${#github_token} -ge 20 && ! "$github_token" =~ [[:space:]] ]] || die "the GitHub PAT must be at least 20 characters with no whitespace."
      printf '%s' "$github_token" | (cd "$repo_root" && node --input-type=module -e '
        import { readFileSync, writeFileSync } from "node:fs";
        const token = readFileSync(0, "utf8").trim();
        const path = ".env";
        const value = readFileSync(path, "utf8").replace(/^GITHUB_TOKEN=.*$/m, () => `GITHUB_TOKEN=${token}`);
        writeFileSync(path, value, { mode: 0o600 });
      ')
      unset github_token
      configured_token=configured
      printf 'Saved GITHUB_TOKEN to owner-only .env (value hidden).\n'
    fi
  fi

  if [[ -n "$configured_token" ]]; then
    printf '\n✓ Local GitHub credential is configured (value hidden).\n'
    printf '  Repository access is discovered and selected inside Lore.\n'
  else
    cat <<'EOF'

Before starting, add the only required local GitHub credential to .env:

   GITHUB_TOKEN=github_pat_...

Then run: npm run local:up
EOF
  fi
}

quickstart() {
  setup_environment
  start_stack
}

preflight() {
  require_command docker
  require_command curl
  ensure_dependencies
  [[ -f "$repo_root/.env" ]] || die "run npm run local:setup first."
  (cd "$repo_root" && env NODE_ENV=production LORE_DEPLOYMENT_MODE=local npm run setup:check -- --docker --github --ai)
  prepare_docker_cli
  docker info >/dev/null 2>&1 || die "the Docker daemon is not running. Start Docker Desktop or Colima, then retry."

  if [[ "$(env_value LORE_AI_PREFLIGHT)" != "false" ]]; then
    (cd "$repo_root" && npm run ai:check)
  fi
  compose config --quiet
}

wait_for_stack() {
  local ready=false
  for _attempt in $(seq 1 120); do
    if curl -fsS "$api_url/readyz" >/dev/null 2>&1 && \
      curl -fsS "$app_url/healthz" >/dev/null 2>&1 && \
      curl -fsS "$app_url" 2>/dev/null | grep -q '<div id="root"'; then
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
  local health readiness proxy_health
  health=$(curl -fsS "$api_url/healthz") || die "API health check failed at $api_url/healthz."
  readiness=$(curl -fsS "$api_url/readyz") || die "API readiness check failed at $api_url/readyz."
  proxy_health=$(curl -fsS "$app_url/healthz") || die "Web-to-API proxy check failed at $app_url/healthz."
  curl -fsS "$app_url" | grep -q '<div id="root"' || die "built web application is not available at $app_url."
  printf '✓ API health     %s\n' "$health"
  printf '✓ Dependencies   %s\n' "$readiness"
  printf '✓ Web API proxy  %s\n' "$proxy_health"
  printf '✓ Built web app  %s\n' "$app_url"
  printf '✓ Runtime        persistent local-production mode\n'
}

start_stack() {
  preflight
  printf '\nBuilding and starting Lore local production...\n'
  printf 'Temporarily stopping existing containers to give the Docker builder enough memory...\n'
  compose stop
  compose up --build --detach --remove-orphans
  wait_for_stack
  printf '\n'
  check_stack
  cat <<EOF

Lore is live locally: $app_url

Next:
  1. Open Lore; your GitHub profile and private local workspace are created automatically.
  2. Open Repositories and select one, many, or all accessible repositories.
  3. Lore imports each repository's merged PR evidence and keeps it synchronised.
  4. Review AI-generated candidates before promoting them to active knowledge.

Logs: npm run local:logs
Stop: npm run local:down
EOF
}

start_existing_stack() {
  require_command docker
  prepare_docker_cli
  docker info >/dev/null 2>&1 || die "the Docker daemon is not running."
  compose up --detach --remove-orphans
  wait_for_stack
  check_stack
}

backup_database() {
  require_command docker
  local backup_dir backup_path timestamp
  backup_dir="$repo_root/backups"
  timestamp=$(date -u +%Y%m%dT%H%M%SZ)
  backup_path="$backup_dir/lore-$timestamp.dump"
  mkdir -p "$backup_dir"
  compose exec -T postgres pg_dump -U lore -d lore -Fc > "$backup_path"
  chmod 600 "$backup_path"
  printf '✓ PostgreSQL backup saved: %s\n' "$backup_path"
}

install_boot_service() {
  [[ "$(uname -s)" == "Darwin" ]] || die "automatic boot installation currently supports macOS; use the documented systemd unit on Linux."
  local agent_dir log_dir plist_path label
  label="dev.lore.local"
  agent_dir="$HOME/Library/LaunchAgents"
  log_dir="$HOME/Library/Logs/Lore"
  plist_path="$agent_dir/$label.plist"
  mkdir -p "$agent_dir" "$log_dir"
  node --input-type=module -e '
    import { writeFileSync } from "node:fs";
    const [path, label, bootScript, workdir, stdout, stderr, inheritedPath] = process.argv.slice(1);
    const esc = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${esc(label)}</string>\n<key>ProgramArguments</key><array><string>/bin/bash</string><string>${esc(bootScript)}</string></array>\n<key>WorkingDirectory</key><string>${esc(workdir)}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(inheritedPath)}</string></dict>\n<key>RunAtLoad</key><true/>\n<key>ProcessType</key><string>Background</string>\n<key>StandardOutPath</key><string>${esc(stdout)}</string>\n<key>StandardErrorPath</key><string>${esc(stderr)}</string>\n</dict></plist>\n`;
    writeFileSync(path, plist, { mode: 0o600 });
  ' "$plist_path" "$label" "$script_dir/lore-boot.sh" "$repo_root" "$log_dir/launch.log" "$log_dir/launch-error.log" "$PATH"
  launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$plist_path"
  launchctl enable "gui/$UID/$label"
  printf '✓ Lore will start at login through %s\n' "$plist_path"
  printf '  Logs: %s\n' "$log_dir"
}

uninstall_boot_service() {
  [[ "$(uname -s)" == "Darwin" ]] || die "automatic boot uninstallation currently supports macOS."
  local label plist_path
  label="dev.lore.local"
  plist_path="$HOME/Library/LaunchAgents/$label.plist"
  launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
  [[ ! -f "$plist_path" ]] || rm "$plist_path"
  printf '✓ Lore login service removed. PostgreSQL, Redis, and backups were not deleted.\n'
}

require_command node
require_command npm

case "$command_name" in
  quickstart) quickstart ;;
  setup) setup_environment ;;
  up) start_stack ;;
  start) start_existing_stack ;;
  check) check_stack ;;
  status) compose ps ;;
  logs) compose logs --follow api worker web ;;
  down) compose down ;;
  backup) backup_database ;;
  install) install_boot_service ;;
  uninstall) uninstall_boot_service ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown command '$command_name'." ;;
esac
