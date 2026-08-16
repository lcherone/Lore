#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)

if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1; then
    colima start
  elif [[ -d /Applications/Docker.app ]]; then
    open -gj -a Docker
  fi
fi

for _attempt in $(seq 1 120); do
  docker info >/dev/null 2>&1 && exec /bin/bash "$repo_root/scripts/lore-local.sh" start
  sleep 1
done

printf 'Lore boot service: Docker did not become ready within 120 seconds.\n' >&2
exit 1
