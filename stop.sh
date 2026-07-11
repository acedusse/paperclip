#!/usr/bin/env bash
#
# FILE: stop.sh
# ABOUT: stop.sh (root module).
#
# SECTIONS:
#   [TAG: module] - stop.sh (root module).
#
# ==========================================
# [META: module]
# INTENT: Root wrapper that execs scripts/stop-dev.sh.
# PSEUDOCODE: 1. Resolve repo root. 2. Exec stop-dev.sh with args.
# JSON_FLOW: {"file": "stop.sh", "imports": "scripts/stop-dev.sh", "exports": "stopped"}
# ==========================================
# [START: module]
# Convenience wrapper — see scripts/stop-dev.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/stop-dev.sh" "$@"
# [END: module]
