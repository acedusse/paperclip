/**
 * FILE: packages/shared/src/validators/text.ts
 * ABOUT: text.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - text.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: text.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/text.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";

export function normalizeEscapedLineBreaks(value: string): string {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

export const multilineTextSchema = z.string().transform(normalizeEscapedLineBreaks);
// [END: module]
