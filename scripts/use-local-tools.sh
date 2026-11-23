#!/bin/sh
set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_ROOT="$PROJECT_ROOT/.local-tools/node-v24.22.3-darwin-arm64/bin"
FORGE_ROOT="$PROJECT_ROOT/.local-tools/npm-global/bin"
GITHUB_ROOT="$PROJECT_ROOT/.local-tools/gh_2.104.0_macOS_arm64/bin"

if [ ! -x "$NODE_ROOT/node" ]; then
  echo "Local Node.js 24 is missing. See DEVELOPMENT.md."
  exit 1
fi

PATH="$NODE_ROOT:$FORGE_ROOT:$GITHUB_ROOT:$PATH"
export PATH

if [ "${1:-}" = "forge" ] && command -v security >/dev/null 2>&1; then
  FORGE_TOKEN=$(security find-generic-password -w -a "raginixnarang@gmail.com" -s "payer-correction-review-forge-token" 2>/dev/null || true)
  if [ -n "$FORGE_TOKEN" ]; then
    FORGE_EMAIL="raginixnarang@gmail.com"
    FORGE_API_TOKEN="$FORGE_TOKEN"
    export FORGE_EMAIL FORGE_API_TOKEN
    unset FORGE_TOKEN
  fi
fi

exec "$@"
