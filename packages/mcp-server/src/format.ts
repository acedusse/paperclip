/**
 * FILE: packages/mcp-server/src/format.ts
 * ABOUT: format.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - format.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: format.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/mcp-server/src/format.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { PaperclipApiError } from "./client.js";

type McpTextResponse = {
  content: Array<{ type: "text"; text: string }>;
};

export function formatTextResponse(value: unknown): McpTextResponse {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function formatErrorResponse(error: unknown): McpTextResponse {
  if (error instanceof PaperclipApiError) {
    return formatTextResponse({
      error: error.message,
      status: error.status,
      method: error.method,
      path: error.path,
      body: error.body,
    });
  }
  return formatTextResponse({
    error: error instanceof Error ? error.message : String(error),
  });
}
// [END: module]
