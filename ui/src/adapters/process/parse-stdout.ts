/**
 * FILE: ui/src/adapters/process/parse-stdout.ts
 * ABOUT: parse-stdout.ts (process module).
 *
 * SECTIONS:
 *   [TAG: module] - parse-stdout.ts (process module).
 */
// ==========================================
// [META: module]
// INTENT: parse-stdout.ts (process module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/process/parse-stdout.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { TranscriptEntry } from "../types";

export function parseProcessStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return [{ kind: "stdout", ts, text: line }];
}
// [END: module]
