#!/usr/bin/env python3
"""Done-gate nav endhook — sync the codebase-map ledger + JSON shims.

Thin wrapper around sync_codebase_map.main so gate runners / CI can invoke a
stable entrypoint. Run at the end of a TDD Done gate (or in CI) to keep
nav/ledger.db, nav/index.json, and nav/tests/index.json in sync with source.

    python3 scripts/nav/nav_endhook.py [--repo-root .] [--no-inject]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from sync_codebase_map import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
