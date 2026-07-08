/**
 * FILE: ui/src/lib/comment-submit-draft.ts
 * ABOUT: comment-submit-draft.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - comment-submit-draft.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: comment-submit-draft.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/comment-submit-draft.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function restoreSubmittedCommentDraft(params: {
  currentBody: string;
  submittedBody: string;
}) {
  return params.currentBody.trim() ? params.currentBody : params.submittedBody;
}
// [END: module]
