#!/usr/bin/env bash
#
# FILE: start.sh
# ABOUT: start.sh (root module).
#
# SECTIONS:
#   [TAG: module] - start.sh (root module).
#
# ==========================================
# [META: module]
# INTENT: Root wrapper that execs scripts/start-dev.sh.
# PSEUDOCODE: 1. Resolve repo root. 2. Exec start-dev.sh with args.
# JSON_FLOW: {"file": "start.sh", "imports": "scripts/start-dev.sh", "exports": "dev server"}
# ==========================================
# [START: module]
# Convenience wrapper — see scripts/start-dev.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/start-dev.sh" "$@"
# [END: module]
