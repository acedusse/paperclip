#!/usr/bin/env python3
"""Sync the paperclip nav codebase-map (V3 shim) with the live codebase.

This repo uses a degenerate V3 map: exactly one `module` section per tracked
file. Each file carries a comment-style [META: module] block and a
[START: module]/[END: module] tag pair wrapping its body. This worker
reconciles nav/ledger.db, nav/index.json, and nav/tests/index.json against
those files.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

SOURCE_EXTS = (".ts", ".tsx", ".js", ".jsx", ".html")
TEST_DIR_SEGMENTS = {"__tests__", "tests", "test"}
TEST_NAME_RE = re.compile(r"\.(test|spec)\.(ts|tsx|js|jsx)$")
INTENT_MAX = 80
PSEUDOCODE = "1. Load dependencies. 2. Define module members. 3. Export public API."

START = re.compile(r"\[START:\s*module\s*\]")
END = re.compile(r"\[END:\s*module\s*\]")
META = re.compile(r"\[META:\s*module\s*\]")
# Comment markers stripped when flattening a file header into `intent`.
_COMMENT_MARKERS = re.compile(r"^\s*(/\*\*|\*/|\*|//|#|<!--|-->)+\s*|\s*-->\s*$")


def is_source_file(path: str) -> bool:
    return path.endswith(SOURCE_EXTS)


def is_test_file(path: str) -> bool:
    segments = path.split("/")
    if any(seg in TEST_DIR_SEGMENTS for seg in segments[:-1]):
        return True
    return bool(TEST_NAME_RE.search(segments[-1]))


def build_intent(header_text: str) -> str:
    """Flatten a file-header docstring to a single truncated intent string."""
    tokens: list[str] = []
    for line in header_text.splitlines():
        if META.search(line) or START.search(line):
            break
        stripped = _COMMENT_MARKERS.sub("", line).strip()
        if stripped:
            tokens.append(stripped)
    flattened = re.sub(r"\s+", " ", " ".join(tokens)).strip()
    return flattened[:INTENT_MAX]


def build_summary(file_path: str) -> str:
    """`<basename> (<parent-dir-name> module).` — the ABOUT/INTENT text."""
    p = Path(file_path)
    parent = p.parent.name or "root"
    return f"{p.name} ({parent} module)."


def derive_intent(file_path: str, header_text: str) -> str:
    """HTML stores the bare summary; other styles store the flattened header."""
    if file_path.endswith(".html"):
        return build_summary(file_path)
    return build_intent(header_text)


def build_json_flow(file_path: str) -> str:
    return json.dumps({"file": file_path})


def section_hash(body: str) -> str:
    return hashlib.sha256(body.encode()).hexdigest()


def _render_tags(file_path: str, body: str) -> str:
    """Render a fully-tagged file body from the fixed template."""
    summary = build_summary(file_path)
    rich_flow = json.dumps(
        {"file": file_path, "imports": "see code", "exports": "see code"}
    )
    if file_path.endswith(".html"):
        # Keep a leading <!doctype ...> as the very first bytes so the browser
        # does not fall into quirks mode; the nav block and module section follow
        # it as a preamble-then-body.
        preamble = ""
        rest = body
        first, sep, remainder = body.partition("\n")
        if first.lstrip().lower().startswith("<!doctype"):
            preamble = first + "\n"
            rest = remainder
        return (
            preamble
            + "<!--\n"
            f"FILE: {file_path}\n"
            f"ABOUT: {summary}\n"
            "\n"
            "SECTIONS:\n"
            f"  [TAG: module] - {summary}\n"
            "-->\n"
            "<!-- ========================================== -->\n"
            "<!-- [META: module] -->\n"
            f"<!-- INTENT: {summary} -->\n"
            f"<!-- PSEUDOCODE: {PSEUDOCODE} -->\n"
            f"<!-- JSON_FLOW: {rich_flow} -->\n"
            "<!-- ========================================== -->\n"
            "<!-- [START: module] -->\n"
            f"{rest}\n"
            "<!-- [END: module] -->\n"
        )
    # Keep any leading shebang and/or directive prologue ("use client",
    # "use strict", …) as the very first line(s) so the nav header does not push
    # them off line 1. A shebang not on line 1 is a syntax error, and a directive
    # only takes effect as the first statement — same reasoning as the <!doctype>
    # preamble above.
    preamble, body = _split_leading_directives(body)
    return (
        preamble
        + "/**\n"
        f" * FILE: {file_path}\n"
        f" * ABOUT: {summary}\n"
        " *\n"
        " * SECTIONS:\n"
        f" *   [TAG: module] - {summary}\n"
        " */\n"
        "// ==========================================\n"
        "// [META: module]\n"
        f"// INTENT: {summary}\n"
        f"// PSEUDOCODE: {PSEUDOCODE}\n"
        f"// JSON_FLOW: {rich_flow}\n"
        "// ==========================================\n"
        "// [START: module]\n"
        f"{body}\n"
        "// [END: module]\n"
    )


# A JS/TS directive prologue statement: a bare single- or double-quoted string
# literal like "use client"; / 'use strict'.
_DIRECTIVE_RE = re.compile(r"""^(["'])use [a-z-]+\1;?$""")


def _split_leading_directives(body: str) -> tuple[str, str]:
    """Split off a leading shebang and/or directive prologue from ``body``.

    Returns ``(preamble, rest)`` where ``preamble`` is the newline-terminated
    lines that must stay at the top of the file (empty string if none) and
    ``rest`` is the remaining body to wrap in the module section.
    """
    lines = body.split("\n")
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        is_shebang = i == 0 and stripped.startswith("#!")
        is_directive = _DIRECTIVE_RE.match(stripped) is not None
        if is_shebang or is_directive:
            i += 1
        else:
            break
    if i == 0:
        return "", body
    preamble = "\n".join(lines[:i]) + "\n"
    rest = "\n".join(lines[i:])
    return preamble, rest


def ensure_tags(path: Path, file_path: str) -> bool:
    """Inject header/META/[START/END] tags if the file is untagged.

    Returns True if the file was modified. A no-op on already-tagged files.
    """
    try:
        original = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Never lossily rewrite a non-UTF-8 file (errors="replace" would
        # substitute U+FFFD and destroy bytes). Skip injection instead.
        return False
    if START.search(original):
        return False
    path.write_text(_render_tags(file_path, original.rstrip("\n")), encoding="utf-8")
    return True


def compute_row(path: Path, file_path: str) -> dict[str, str]:
    """Compute the full ledger row for an already-tagged file."""
    text = path.read_text(encoding="utf-8", errors="replace")
    body = extract_module_section(path) or ""
    return {
        "file_path": file_path,
        "section_tag": "module",
        "intent": derive_intent(file_path, text),
        "pseudocode": PSEUDOCODE,
        "json_flow": build_json_flow(file_path),
        "code_hash": section_hash(body),
    }


def list_source_files(root: Path) -> list[str]:
    """Git-tracked files under `root` filtered to nav source extensions."""
    import subprocess

    out = subprocess.run(
        ["git", "ls-files"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    return [p for p in out if is_source_file(p)]


def _init_ledger(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sections (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          file_path   TEXT NOT NULL,
          section_tag TEXT NOT NULL,
          intent      TEXT,
          pseudocode  TEXT,
          json_flow   TEXT,
          code_hash   TEXT,
          updated_at  TEXT DEFAULT (datetime('now')),
          UNIQUE(file_path, section_tag)
        );
        CREATE INDEX IF NOT EXISTS idx_file ON sections(file_path);
        CREATE INDEX IF NOT EXISTS idx_tag  ON sections(section_tag);
        """
    )


def reconcile_ledger(root: Path, ledger_path: Path, inject: bool = True) -> dict:
    """Sync the ledger at `ledger_path` against source files under `root`."""
    import datetime
    import sqlite3

    sources = list_source_files(root)
    live = set(sources)

    conn = sqlite3.connect(ledger_path)
    _init_ledger(conn)
    cur = conn.cursor()

    deleted = 0
    for (fp,) in cur.execute("SELECT file_path FROM sections").fetchall():
        if fp not in live:
            cur.execute("DELETE FROM sections WHERE file_path = ?", (fp,))
            deleted += 1

    inserted = updated = unchanged = 0
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None).isoformat()
    for fp in sources:
        path = root / fp
        if inject:
            ensure_tags(path, fp)
        if not START.search(path.read_text(encoding="utf-8", errors="replace")):
            continue  # untagged and injection disabled — skip
        row = compute_row(path, fp)
        stored = cur.execute(
            "SELECT intent, pseudocode, json_flow, code_hash FROM sections "
            "WHERE file_path = ? AND section_tag = 'module'",
            (fp,),
        ).fetchone()
        if stored is None:
            cur.execute(
                "INSERT INTO sections "
                "(file_path, section_tag, intent, pseudocode, json_flow, code_hash, updated_at) "
                "VALUES (?, 'module', ?, ?, ?, ?, ?)",
                (fp, row["intent"], row["pseudocode"], row["json_flow"], row["code_hash"], now),
            )
            inserted += 1
        elif tuple(stored) != (
            row["intent"],
            row["pseudocode"],
            row["json_flow"],
            row["code_hash"],
        ):
            cur.execute(
                "UPDATE sections SET intent=?, pseudocode=?, json_flow=?, code_hash=?, "
                "updated_at=? WHERE file_path=? AND section_tag='module'",
                (row["intent"], row["pseudocode"], row["json_flow"], row["code_hash"], now, fp),
            )
            updated += 1
        else:
            unchanged += 1

    conn.commit()
    conn.close()
    return {"deleted": deleted, "inserted": inserted, "updated": updated, "unchanged": unchanged}


def _now_z() -> str:
    import datetime

    return (
        datetime.datetime.now(datetime.timezone.utc)
        .replace(tzinfo=None, microsecond=0)
        .isoformat()
        + "Z"
    )


def write_index(root: Path) -> int:
    sources = sorted(list_source_files(root))
    payload = {
        "schema": "v3-shim",
        "generated_at": _now_z(),
        "root": str(root),
        "ledger": "nav/ledger.db",
        "file_count": len(sources),
        "files": [{"path": p, "tags": ["module"]} for p in sources],
    }
    (root / "nav" / "index.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    return len(sources)


def write_tests_index(root: Path) -> int:
    tests = sorted(p for p in list_source_files(root) if is_test_file(p))
    payload = {
        "schema": "v3-shim",
        "generated_at": _now_z(),
        "test_count": len(tests),
        "tests": tests,
    }
    (root / "nav" / "tests" / "index.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )
    return len(tests)


REPO_ROOT = Path(__file__).resolve().parents[2]


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=str(REPO_ROOT))
    parser.add_argument(
        "--no-inject",
        action="store_true",
        help="Do not add tags to untagged files; reconcile tagged files only.",
    )
    args = parser.parse_args(argv)
    root = Path(args.repo_root).resolve()

    ledger = root / "nav" / "ledger.db"
    ledger.parent.mkdir(parents=True, exist_ok=True)
    (root / "nav" / "tests").mkdir(parents=True, exist_ok=True)

    stats = reconcile_ledger(root, ledger, inject=not args.no_inject)
    file_count = write_index(root)
    test_count = write_tests_index(root)

    print("codebase-map sync complete")
    print(
        f"  ledger: inserted={stats['inserted']} updated={stats['updated']} "
        f"deleted={stats['deleted']} unchanged={stats['unchanged']}"
    )
    print(f"  index.json: {file_count} files")
    print(f"  tests/index.json: {test_count} tests")
    return 0


def extract_module_section(path: Path) -> str | None:
    """Return the exact text between the [START: module] and [END: module] tags.

    Preserves original newlines (including the trailing one before [END]),
    matching the byte range the committed `code_hash` was computed over.
    """
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
    body: list[str] = []
    inside = False
    for line in lines:
        if START.search(line):
            inside = True
            continue
        if END.search(line):
            return "".join(body)
        if inside:
            body.append(line)
    return None


if __name__ == "__main__":
    raise SystemExit(main())
