#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
command_name=${1:-run}
demo_url=${LORE_DEMO_URL:-http://localhost:5173}
api_url=${LORE_DEMO_API_URL:-http://127.0.0.1:3001}

die() {
  printf 'Lore demo: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Lore local demo

Usage:
  npm run demo          Start the interactive demo
  npm run demo:check    Start it temporarily and prove API + web readiness

No database, Redis, GitHub credential, or AI key is required. The demo uses
realistic in-memory data and never imports a local repository automatically.
It is an explicit development-only preview; normal local starts never use it.
EOF
}

require_runtime() {
  command -v node >/dev/null 2>&1 || die "Node.js 22 or newer is required."
  command -v npm >/dev/null 2>&1 || die "npm is required."
  command -v curl >/dev/null 2>&1 || die "curl is required."

  local node_major
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
  (( node_major >= 22 )) || die "Node.js 22 or newer is required; found $(node --version)."
}

ensure_dependencies() {
  if [[ ! -x "$repo_root/node_modules/.bin/concurrently" ]]; then
    printf 'Installing Lore dependencies...\n'
    (cd "$repo_root" && npm install)
  fi
}

demo_environment=(
  NODE_ENV=development
  DEMO_MODE=true
  DEMO_REQUIRE_LOGIN=true
  GITHUB_AUTH_MODE=disabled
  GITHUB_TOKEN=
  AI_PROVIDER=mock
  OPENAI_API_KEY=
  API_HOST=127.0.0.1
  APP_URL=http://localhost:5173
  WEB_ORIGIN=http://localhost:5173
)

run_demo() {
  printf '\n'
  printf '  Lore — engineering memory that can show its work.\n'
  printf '  Demo: %s\n' "$demo_url"
  printf '  Stop: Ctrl+C\n\n'
  cd "$repo_root"
  exec env "${demo_environment[@]}" npm run dev
}

check_demo() {
  local check_root
  local api_pid=""
  local web_pid=""
  check_root=$(mktemp -d "${TMPDIR:-/tmp}/lore-demo-check.XXXXXX")

  cleanup() {
    if [[ -n "$web_pid" ]]; then kill "$web_pid" >/dev/null 2>&1 || true; fi
    if [[ -n "$api_pid" ]]; then kill "$api_pid" >/dev/null 2>&1 || true; fi
    rm -rf "$check_root"
  }
  trap cleanup EXIT INT TERM

  cd "$repo_root"
  env "${demo_environment[@]}" npm run dev:api >"$check_root/api.log" 2>&1 &
  api_pid=$!
  env "${demo_environment[@]}" npm run dev:web >"$check_root/web.log" 2>&1 &
  web_pid=$!

  local ready=false
  for _attempt in $(seq 1 90); do
    if curl -fsS "$api_url/healthz" >/dev/null 2>&1 && \
      curl -fsS "$demo_url" 2>/dev/null | grep -q '<div id="root"></div>'; then
      ready=true
      break
    fi
    sleep .25
  done

  if [[ "$ready" != true ]]; then
    printf '%s\n' '--- API log ---' >&2
    tail -30 "$check_root/api.log" >&2 || true
    printf '%s\n' '--- Web log ---' >&2
    tail -30 "$check_root/web.log" >&2 || true
    die "the demo did not become ready."
  fi

  local health
  health=$(curl -fsS "$api_url/healthz")
  printf '✓ API ready  %s  %s\n' "$api_url/healthz" "$health"
  printf '✓ Web ready  %s\n' "$demo_url"
  printf '✓ Demo mode  no PostgreSQL, Redis, GitHub credential, or AI key used\n'
  printf '\nLore demo check passed.\n'
  cleanup
  trap - EXIT INT TERM
}

require_runtime
ensure_dependencies

case "$command_name" in
  run|up) run_demo ;;
  check) check_demo ;;
  help|-h|--help) usage ;;
  *) usage >&2; die "unknown command '$command_name'." ;;
esac
