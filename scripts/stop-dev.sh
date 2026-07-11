#!/usr/bin/env bash
#
# FILE: scripts/stop-dev.sh
# ABOUT: stop-dev.sh (scripts module).
#
# SECTIONS:
#   [TAG: module] - stop-dev.sh (scripts module).
#
# ==========================================
# [META: module]
# INTENT: Stop Paperclip local app without paperclipai CLI.
# PSEUDOCODE: 1. Ensure pnpm. 2. Stop managed runner. 3. Optionally kill leftovers.
# JSON_FLOW: {"file": "scripts/stop-dev.sh", "imports": "pnpm,kill-dev.sh", "exports": "stopped"}
# ==========================================
# [START: module]
#
# Stop the Paperclip local app without the paperclipai CLI.
#
# Usage:
#   ./scripts/stop-dev.sh          # stop managed runner for this repo
#   ./scripts/stop-dev.sh --all    # also kill leftover Paperclip node/pg/browser procs
#   ./stop.sh                      # root convenience wrapper
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

KILL_ALL=false
for arg in "$@"; do
  case "$arg" in
    --all|--clean|-a)
      KILL_ALL=true
      ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown option: $arg (try --all)" >&2
      exit 1
      ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is required (Node.js 20+, pnpm 9+)." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "No node_modules — nothing to stop via the managed runner."
else
  echo "Stopping managed Paperclip dev runner for this repo..."
  pnpm dev:stop
fi

if [[ "$KILL_ALL" == true ]]; then
  echo "Killing leftover Paperclip processes (scripts/kill-dev.sh)..."
  "$SCRIPT_DIR/kill-dev.sh"
fi

echo "Done."
# [END: module]
