/**
 * FILE: ui/src/lib/comment-submit-draft.test.ts
 * ABOUT: comment-submit-draft.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - comment-submit-draft.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: comment-submit-draft.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/comment-submit-draft.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { restoreSubmittedCommentDraft } from "./comment-submit-draft";

describe("restoreSubmittedCommentDraft", () => {
  it("restores the submitted body when the editor is still empty after a failed request", () => {
    expect(
      restoreSubmittedCommentDraft({
        currentBody: "",
        submittedBody: "Retry me",
      }),
    ).toBe("Retry me");
  });

  it("treats whitespace-only input as empty when restoring a failed draft", () => {
    expect(
      restoreSubmittedCommentDraft({
        currentBody: "   ",
        submittedBody: "Retry me",
      }),
    ).toBe("Retry me");
  });

  it("preserves newer input when the user has already typed again", () => {
    expect(
      restoreSubmittedCommentDraft({
        currentBody: "new draft",
        submittedBody: "Retry me",
      }),
    ).toBe("new draft");
  });
});
// [END: module]
