#!/usr/bin/env bash
#
# FILE: scripts/start-dev.sh
# ABOUT: start-dev.sh (scripts module).
#
# SECTIONS:
#   [TAG: module] - start-dev.sh (scripts module).
#
# ==========================================
# [META: module]
# INTENT: Start Paperclip local app without paperclipai CLI.
# PSEUDOCODE: 1. Ensure pnpm. 2. Install if needed. 3. Stop existing runner. 4. Run pnpm dev.
# JSON_FLOW: {"file": "scripts/start-dev.sh", "imports": "pnpm", "exports": "dev server"}
# ==========================================
# [START: module]
#
# Start the Paperclip local app without the paperclipai CLI.
#
# Usage:
#   ./scripts/start-dev.sh
#   ./scripts/start-dev.sh --bind lan
#   ./start.sh                 # root convenience wrapper
#
# Stops any managed runner already registered for this repo, installs
# dependencies when node_modules is missing, then runs `pnpm dev`.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "error: pnpm is required (Node.js 20+, pnpm 9+)." >&2
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "node_modules missing — running pnpm install..."
  pnpm install
fi

echo "Stopping any existing Paperclip dev runner for this repo..."
pnpm dev:stop || true

echo "Starting Paperclip (pnpm dev)..."
echo "  API + UI: http://localhost:3100 (or next free port)"
exec pnpm dev "$@"
# [END: module]
