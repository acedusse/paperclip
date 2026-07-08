/**
 * FILE: ui/src/lib/markdownPaste.ts
 * ABOUT: markdownPaste.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - markdownPaste.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: markdownPaste.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/markdownPaste.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
const BLOCK_MARKER_PATTERNS = [
  /^#{1,6}\s+/m,
  /^>\s+/m,
  /^[-*+]\s+/m,
  /^\d+\.\s+/m,
  /^```/m,
  /^~~~/m,
  /^\|.+\|$/m,
  /^---$/m,
  /^\*\*\*$/m,
  /^___$/m,
];

export function normalizePastedMarkdown(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function looksLikeMarkdownPaste(text: string): boolean {
  const normalized = normalizePastedMarkdown(text).trim();
  if (!normalized) return false;

  return BLOCK_MARKER_PATTERNS.some((pattern) => pattern.test(normalized));
}
// [END: module]
