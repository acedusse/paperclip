/**
 * FILE: packages/mcp-server/src/stdio.ts
 * ABOUT: stdio.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - stdio.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: stdio.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/mcp-server/src/stdio.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
#!/usr/bin/env node
import { runServer } from "./index.js";

void runServer().catch((error) => {
  console.error("Failed to start Paperclip MCP server:", error);
  process.exit(1);
});
// [END: module]
