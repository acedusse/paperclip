"""Tests for the paperclip nav codebase-map sync worker.

Ground truth: this repo uses a degenerate V3 map — exactly one `module`
section per file, wrapped in comment-style [START: module]/[END: module]
tags, with a [META: module] block above it. The worker must reproduce the
existing nav/ledger.db + nav/index.json + nav/tests/index.json shapes.
"""
import json
from pathlib import Path

import pytest

import sync_codebase_map as scm


def test_extract_module_section_ts(tmp_path: Path) -> None:
    f = tmp_path / "sample.ts"
    f.write_text(
        "// [META: module]\n"
        "// INTENT: sample\n"
        "// [START: module]\n"
        "export const x = 1;\n"
        "export const y = 2;\n"
        "// [END: module]\n"
    )
    body = scm.extract_module_section(f)
    # Exact byte slice between the tags, trailing newline preserved.
    assert body == "export const x = 1;\nexport const y = 2;\n"


def test_extract_module_section_untagged_returns_none(tmp_path: Path) -> None:
    f = tmp_path / "plain.ts"
    f.write_text("export const x = 1;\n")
    assert scm.extract_module_section(f) is None


def test_build_intent_flattens_header_and_truncates_to_80() -> None:
    header = (
        "/**\n"
        " * FILE: cli/src/__tests__/access-parity.test.ts\n"
        " * ABOUT: access-parity.test.ts (__tests__ module).\n"
        " *\n"
        " * SECTIONS:\n"
        " *   [TAG: module] - access-parity.test.ts (__tests__ module).\n"
        " */\n"
    )
    intent = scm.build_intent(header)
    assert len(intent) == 80
    assert intent == (
        "FILE: cli/src/__tests__/access-parity.test.ts "
        "ABOUT: access-parity.test.ts (__te"
    )


def test_build_intent_short_header_not_padded() -> None:
    header = "# FILE: a.py\n# ABOUT: tiny.\n"
    assert scm.build_intent(header) == "FILE: a.py ABOUT: tiny."


def test_build_summary_uses_basename_and_parent_dir() -> None:
    assert scm.build_summary("cli/src/version.ts") == "version.ts (src module)."
    assert scm.build_summary("ui/index.html") == "index.html (ui module)."
    assert (
        scm.build_summary(".agents/skills/pr-report/assets/x.html")
        == "x.html (assets module)."
    )


def test_derive_intent_html_uses_summary_others_use_header() -> None:
    js_header = (
        "/**\n * FILE: cli/src/version.ts\n"
        " * ABOUT: version.ts (src module).\n"
        " *\n * SECTIONS:\n *   [TAG: module] - version.ts (src module).\n */\n"
    )
    assert scm.derive_intent("cli/src/version.ts", js_header) == (
        "FILE: cli/src/version.ts ABOUT: version.ts (src module). "
        "SECTIONS: [TAG: module]"
    )
    html_header = (
        "<!--\nFILE: ui/index.html\nABOUT: index.html (ui module).\n"
        "\nSECTIONS:\n  [TAG: module] - index.html (ui module).\n-->\n"
    )
    assert scm.derive_intent("ui/index.html", html_header) == "index.html (ui module)."


def test_ledger_fields_pseudocode_is_constant_and_json_flow_minimal() -> None:
    assert scm.PSEUDOCODE == (
        "1. Load dependencies. 2. Define module members. 3. Export public API."
    )
    assert scm.build_json_flow("cli/src/version.ts") == '{"file": "cli/src/version.ts"}'


def test_section_hash_is_sha256_of_body() -> None:
    import hashlib

    body = "export const x = 1;"
    assert scm.section_hash(body) == hashlib.sha256(body.encode()).hexdigest()


def test_is_test_file_rules() -> None:
    assert scm.is_test_file("cli/src/__tests__/access-parity.test.ts")
    assert scm.is_test_file("cli/src/foo.spec.ts")
    assert scm.is_test_file("scripts/link-plugin-dev-sdk.test.js")
    assert scm.is_test_file("tests/e2e/playwright.config.ts")
    assert scm.is_test_file("packages/x/__tests__/helpers/zip.ts")
    assert not scm.is_test_file("cli/src/version.ts")
    assert not scm.is_test_file("packages/x/latest.ts")  # 'test' must be a full segment


def test_is_source_file_extension_filter() -> None:
    assert scm.is_source_file("cli/src/version.ts")
    assert scm.is_source_file("ui/App.tsx")
    assert scm.is_source_file("a/b.html")
    assert not scm.is_source_file("README.md")
    assert not scm.is_source_file("nav/ledger.db")


def test_ensure_tags_injects_into_untagged_ts_file(tmp_path: Path) -> None:
    src = tmp_path / "cli" / "src" / "run-admission.ts"
    src.parent.mkdir(parents=True)
    src.write_text("export const cap = 10;\n")

    changed = scm.ensure_tags(src, "cli/src/run-admission.ts")

    assert changed is True
    text = src.read_text()
    # Original body preserved and now wrapped
    assert scm.extract_module_section(src) == "export const cap = 10;\n"
    assert "// [META: module]" in text
    assert "FILE: cli/src/run-admission.ts" in text
    intent = scm.derive_intent("cli/src/run-admission.ts", text)
    assert len(intent) == 80
    assert intent.startswith(
        "FILE: cli/src/run-admission.ts ABOUT: run-admission.ts (src module)."
    )


def test_ensure_tags_injects_into_untagged_html_file(tmp_path: Path) -> None:
    src = tmp_path / "ui" / "page.html"
    src.parent.mkdir(parents=True)
    src.write_text("<!doctype html>\n<html></html>\n")

    scm.ensure_tags(src, "ui/page.html")

    text = src.read_text()
    # The doctype must remain the very first bytes so the browser doesn't fall
    # into quirks mode; the nav block follows it.
    assert text.startswith("<!doctype html>")
    assert "<!-- [META: module] -->" in text
    # The doctype is a preamble outside the module section; the section wraps the body.
    assert scm.extract_module_section(src) == "<html></html>\n"
    assert scm.derive_intent("ui/page.html", text) == "page.html (ui module)."


def test_ensure_tags_keeps_shebang_on_line_1(tmp_path: Path) -> None:
    src = tmp_path / "scripts" / "run.ts"
    src.parent.mkdir(parents=True)
    src.write_text("#!/usr/bin/env -S node --import tsx\nexport const x = 1;\n")

    changed = scm.ensure_tags(src, "scripts/run.ts")

    assert changed is True
    text = src.read_text()
    # A shebang not on line 1 is a syntax error — it must remain the first bytes,
    # with the nav header following it (mirrors the <!doctype> handling for HTML).
    assert text.startswith("#!/usr/bin/env -S node --import tsx\n")
    assert "// [META: module]" in text
    # The shebang is a preamble outside the module section; the section wraps the body.
    assert scm.extract_module_section(src) == "export const x = 1;\n"
    # Idempotent: an already-tagged file (shebang + tags) is not rewritten.
    assert scm.ensure_tags(src, "scripts/run.ts") is False


def test_ensure_tags_keeps_use_client_directive_on_line_1(tmp_path: Path) -> None:
    src = tmp_path / "ui" / "c.tsx"
    src.parent.mkdir(parents=True)
    src.write_text('"use client";\nexport function C() { return null; }\n')

    changed = scm.ensure_tags(src, "ui/c.tsx")

    assert changed is True
    text = src.read_text()
    # A directive prologue ("use client"/"use server") only takes effect as the
    # first statement, so it must lead the file with the nav header after it.
    assert text.startswith('"use client";\n')
    assert "// [META: module]" in text
    assert scm.extract_module_section(src) == "export function C() { return null; }\n"


def test_ensure_tags_keeps_shebang_and_directive_together(tmp_path: Path) -> None:
    src = tmp_path / "cli.ts"
    src.write_text('#!/usr/bin/env node\n"use strict";\nconst y = 2;\n')

    scm.ensure_tags(src, "cli.ts")

    text = src.read_text()
    # Both leading lines are preserved, in order, ahead of the nav header.
    assert text.startswith('#!/usr/bin/env node\n"use strict";\n')
    assert "// [START: module]" in text
    assert scm.extract_module_section(src) == "const y = 2;\n"


def test_ensure_tags_skips_non_utf8_file_without_corrupting(tmp_path: Path) -> None:
    src = tmp_path / "weird.ts"
    raw = b"const x = 1; // \xff\xfe not utf8\n"
    src.write_bytes(raw)

    changed = scm.ensure_tags(src, "weird.ts")

    # Non-UTF-8 files are skipped, not lossily rewritten with U+FFFD.
    assert changed is False
    assert src.read_bytes() == raw


def test_now_z_is_naive_iso_with_z_suffix() -> None:
    import datetime

    z = scm._now_z()
    assert z.endswith("Z")
    assert "+" not in z  # no timezone offset — matches the committed shim format
    datetime.datetime.fromisoformat(z[:-1])  # parseable


def test_ensure_tags_idempotent_on_already_tagged(tmp_path: Path) -> None:
    src = tmp_path / "a.ts"
    src.write_text("export const cap = 10;\n")
    scm.ensure_tags(src, "a.ts")
    first = src.read_text()

    changed = scm.ensure_tags(src, "a.ts")

    assert changed is False
    assert src.read_text() == first


def test_compute_row_produces_full_ledger_fields(tmp_path: Path) -> None:
    src = tmp_path / "cli" / "src" / "run-admission.ts"
    src.parent.mkdir(parents=True)
    src.write_text("export const cap = 10;\n")
    scm.ensure_tags(src, "cli/src/run-admission.ts")

    row = scm.compute_row(src, "cli/src/run-admission.ts")

    assert row["file_path"] == "cli/src/run-admission.ts"
    assert row["section_tag"] == "module"
    assert row["pseudocode"] == scm.PSEUDOCODE
    assert row["json_flow"] == '{"file": "cli/src/run-admission.ts"}'
    assert row["code_hash"] == scm.section_hash("export const cap = 10;\n")


def test_list_source_files_filters_git_tracked_by_ext(tmp_path: Path) -> None:
    import subprocess

    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    for rel in ("keep.ts", "ui/app.tsx", "page.html", "README.md", "data.json"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("x\n")
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)

    got = set(scm.list_source_files(tmp_path))

    assert got == {"keep.ts", "ui/app.tsx", "page.html"}


# --- orchestration -------------------------------------------------------

import sqlite3
import subprocess


def _tmp_git_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    for rel, content in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    return tmp_path


def test_reconcile_ledger_injects_upserts_and_prunes(tmp_path: Path) -> None:
    root = _tmp_git_repo(
        tmp_path,
        {
            "cli/src/a.ts": "export const a = 1;\n",
            "cli/src/__tests__/a.test.ts": "test('a', () => {});\n",
            "README.md": "ignored\n",
        },
    )
    ledger = root / "nav" / "ledger.db"
    ledger.parent.mkdir(parents=True)

    stats = scm.reconcile_ledger(root, ledger, inject=True)

    conn = sqlite3.connect(ledger)
    rows = conn.execute(
        "SELECT file_path, section_tag FROM sections ORDER BY file_path"
    ).fetchall()
    conn.close()
    assert rows == [
        ("cli/src/__tests__/a.test.ts", "module"),
        ("cli/src/a.ts", "module"),
    ]
    assert stats["inserted"] == 2
    # Tags were injected into source
    assert "[START: module]" in (root / "cli/src/a.ts").read_text()

    # Remove a file, commit, re-run → its row is pruned
    (root / "cli/src/a.ts").unlink()
    subprocess.run(["git", "add", "-A"], cwd=root, check=True)
    scm.reconcile_ledger(root, ledger, inject=True)
    conn = sqlite3.connect(ledger)
    remaining = [r[0] for r in conn.execute("SELECT file_path FROM sections")]
    conn.close()
    assert remaining == ["cli/src/__tests__/a.test.ts"]


def test_reconcile_is_idempotent_no_op_on_unchanged_repo(tmp_path: Path) -> None:
    root = _tmp_git_repo(tmp_path, {"cli/src/a.ts": "export const a = 1;\n"})
    ledger = root / "nav" / "ledger.db"
    ledger.parent.mkdir(parents=True)

    scm.reconcile_ledger(root, ledger, inject=True)
    conn = sqlite3.connect(ledger)
    ts_first = conn.execute(
        "SELECT updated_at FROM sections WHERE file_path='cli/src/a.ts'"
    ).fetchone()[0]
    conn.close()

    stats = scm.reconcile_ledger(root, ledger, inject=True)

    assert stats["inserted"] == 0
    assert stats["updated"] == 0
    assert stats["unchanged"] == 1
    conn = sqlite3.connect(ledger)
    ts_second = conn.execute(
        "SELECT updated_at FROM sections WHERE file_path='cli/src/a.ts'"
    ).fetchone()[0]
    conn.close()
    assert ts_second == ts_first  # unchanged rows are not re-stamped


def test_write_index_and_tests_index_shapes(tmp_path: Path) -> None:
    root = _tmp_git_repo(
        tmp_path,
        {
            "cli/src/a.ts": "export const a = 1;\n",
            "cli/src/__tests__/a.test.ts": "test('a', () => {});\n",
        },
    )
    (root / "nav" / "tests").mkdir(parents=True)

    scm.write_index(root)
    scm.write_tests_index(root)

    idx = json.loads((root / "nav" / "index.json").read_text())
    assert idx["schema"] == "v3-shim"
    assert idx["ledger"] == "nav/ledger.db"
    assert idx["file_count"] == 2
    assert idx["files"] == [
        {"path": "cli/src/__tests__/a.test.ts", "tags": ["module"]},
        {"path": "cli/src/a.ts", "tags": ["module"]},
    ]
    t = json.loads((root / "nav" / "tests" / "index.json").read_text())
    assert t["schema"] == "v3-shim"
    assert t["test_count"] == 1
    assert t["tests"] == ["cli/src/__tests__/a.test.ts"]


# --- fidelity against the committed paperclip nav artifacts --------------

REPO_ROOT = Path(__file__).resolve().parents[2]
_HAVE_REPO = (REPO_ROOT / "nav" / "ledger.db").is_file()


@pytest.mark.skipif(not _HAVE_REPO, reason="not in the paperclip repo")
def test_computed_rows_match_committed_ledger() -> None:
    """Read-only: the worker's computed rows must equal the committed ledger."""
    conn = sqlite3.connect(REPO_ROOT / "nav" / "ledger.db")
    committed = {
        r[0]: r
        for r in conn.execute(
            "SELECT file_path, intent, pseudocode, json_flow, code_hash FROM sections"
        )
    }
    conn.close()

    mismatches = []
    for fp in scm.list_source_files(REPO_ROOT):
        path = REPO_ROOT / fp
        if not path.is_file() or fp not in committed:
            continue
        row = scm.compute_row(path, fp)
        want = committed[fp]
        got = (fp, row["intent"], row["pseudocode"], row["json_flow"], row["code_hash"])
        if got != want:
            mismatches.append((fp, want, got))

    assert not mismatches, mismatches[:5]

