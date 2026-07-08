/**
 * FILE: ui/src/lib/clipboard.ts
 * ABOUT: clipboard.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - clipboard.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: clipboard.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/clipboard.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for environments where the Clipboard API exists but is blocked.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const success = document.execCommand("copy");
    if (!success) throw new Error("execCommand copy failed");
  } finally {
    document.body.removeChild(textarea);
  }
}
// [END: module]
