/**
 * FILE: ui/src/components/WorkspaceFileMarkdownBody.test.tsx
 * ABOUT: WorkspaceFileMarkdownBody.test.tsx (components module).
 *
 * SECTIONS:
 *   [TAG: module] - WorkspaceFileMarkdownBody.test.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: WorkspaceFileMarkdownBody.test.tsx (components module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/components/WorkspaceFileMarkdownBody.test.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { linkWorkspaceFileInlineCode } from "./WorkspaceFileMarkdownBody";

describe("linkWorkspaceFileInlineCode", () => {
  it("links workspace file refs in inline code to the current issue file viewer", () => {
    const markdown = linkWorkspaceFileInlineCode(
      "Check `ui/src/pages/IssueDetail.tsx:42` please.",
      "/issues/PAP-1",
      "?tab=chat",
      "#comment-1",
    );

    expect(markdown).toContain("[`ui/src/pages/IssueDetail.tsx:42`](");
    expect(markdown).toContain("workspace-file:?path=ui%2Fsrc%2Fpages%2FIssueDetail.tsx&line=42");
  });

  it("leaves non-file inline code unchanged", () => {
    expect(linkWorkspaceFileInlineCode("Run `pnpm test`.", "/issues/PAP-1", "", "")).toBe("Run `pnpm test`.");
  });

  it("links trailing-slash folder refs to the workspace browser", () => {
    const markdown = linkWorkspaceFileInlineCode(
      "Open `content-os/cases/active/2026-06-06-pap-10199-bundled-skills/`.",
      "/issues/PAP-1",
      "",
      "",
    );

    expect(markdown).toContain("kind=directory");
    expect(markdown).toContain("path=content-os%2Fcases%2Factive%2F2026-06-06-pap-10199-bundled-skills%2F");
  });
});
// [END: module]
