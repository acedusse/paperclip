/**
 * FILE: packages/adapters/openclaw-gateway/src/shared/stream.ts
 * ABOUT: stream.ts (shared module).
 *
 * SECTIONS:
 *   [TAG: module] - stream.ts (shared module).
 */
// ==========================================
// [META: module]
// INTENT: stream.ts (shared module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapters/openclaw-gateway/src/shared/stream.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export function normalizeOpenClawGatewayStreamLine(rawLine: string): {
  stream: "stdout" | "stderr" | null;
  line: string;
} {
  const trimmed = rawLine.trim();
  if (!trimmed) return { stream: null, line: "" };

  const prefixed = trimmed.match(/^(stdout|stderr)\s*[:=]?\s*(.*)$/i);
  if (!prefixed) {
    return { stream: null, line: trimmed };
  }

  const stream = prefixed[1]?.toLowerCase() === "stderr" ? "stderr" : "stdout";
  const line = (prefixed[2] ?? "").trim();
  return { stream, line };
}
// [END: module]
