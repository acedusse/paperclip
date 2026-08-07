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
# INTENT: Root wrapper that execs scripts/start-dev.sh, in a terminal if needed.
# PSEUDOCODE: 1. Resolve repo root. 2. Re-launch in a terminal when started from a GUI. 3. Exec start-dev.sh.
# JSON_FLOW: {"file": "start.sh", "imports": "scripts/start-dev.sh", "exports": "dev server"}
# ==========================================
# [START: module]
# Convenience wrapper — see scripts/start-dev.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$REPO_ROOT/scripts/start-dev.sh"

# Double-clicking this file in a file manager runs it with no terminal
# attached, so every line it prints — including failures — is discarded and
# nothing appears to happen. Detect that case and re-launch inside a terminal
# emulator so the dev server and its errors are actually visible.
needs_terminal() {
  if [[ "${PAPERCLIP_NO_TERMINAL_RELAUNCH:-}" == "1" ]]; then return 1; fi
  # A real terminal on either stdin or stdout means we already have one.
  if [[ -t 0 ]] || [[ -t 1 ]]; then return 1; fi
  # No graphical session (CI, cron, ssh without X) — stay in the foreground.
  if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then return 1; fi
  return 0
}

if needs_terminal; then
  # Quote the command so paths with spaces survive the trip through bash -c,
  # and hold the window open afterwards so a failure stays readable.
  inner="$(printf '%q' "$TARGET")"
  for arg in "$@"; do inner+=" $(printf '%q' "$arg")"; done
  script="${inner}; status=\$?; echo; echo \"[start.sh exited with status \$status]\"; read -n 1 -r -s -p 'Press any key to close...'; echo"

  for term in gnome-terminal konsole xfce4-terminal mate-terminal tilix kitty alacritty xterm x-terminal-emulator; do
    command -v "$term" >/dev/null 2>&1 || continue
    case "$term" in
      # These take the command after a bare --.
      gnome-terminal|tilix)
        exec "$term" -- bash -c "$script"
        ;;
      # kitty takes the command directly.
      kitty)
        exec "$term" bash -c "$script"
        ;;
      # The rest use -e.
      *)
        exec "$term" -e bash -c "$script"
        ;;
    esac
  done

  # No terminal emulator found; fall through and run in the foreground so the
  # work still happens even though the output has nowhere to go.
fi

exec "$TARGET" "$@"
# [END: module]
