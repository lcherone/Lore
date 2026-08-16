#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
command_name=${1:-check}

die() {
  printf 'Lore CLI: %s\n' "$*" >&2
  exit 1
}

check_cli() {
  local executable version
  executable=$(command -v lore 2>/dev/null || true)
  [[ -n "$executable" ]] || die "the global command is not installed. Run 'npm run cli:install' from $repo_root."
  version=$(lore --version)
  printf '✓ Lore CLI %s\n' "$version"
  printf '✓ Command: %s\n' "$executable"
  printf '✓ Package: %s\n' "$repo_root"
}

install_cli() {
  command -v node >/dev/null 2>&1 || die "Node.js is required."
  command -v npm >/dev/null 2>&1 || die "npm is required."
  (cd "$repo_root" && npm run build)
  printf '\nInstalling the global lore command for the active Node.js installation...\n'
  (cd "$repo_root" && npm link --no-audit --no-fund)
  hash -r 2>/dev/null || true
  check_cli
  cat <<'EOF'

The command is ready. From a connected checkout, try:

  lore status
  lore prepare "TICKET-123 task description"
  lore context

If you change Node versions through nvm, run `npm run cli:install` again for
that Node version.
EOF
}

uninstall_cli() {
  command -v npm >/dev/null 2>&1 || die "npm is required."
  (cd "$repo_root" && npm unlink --global lore --no-audit --no-fund)
  hash -r 2>/dev/null || true
  if command -v lore >/dev/null 2>&1; then
    die "a different lore executable is still present at $(command -v lore)."
  fi
  printf '✓ Removed the global lore command. Lore application data and services were not changed.\n'
}

case "$command_name" in
  install) install_cli ;;
  check) check_cli ;;
  uninstall) uninstall_cli ;;
  *) die "unknown command '$command_name' (use install, check, or uninstall)." ;;
esac
