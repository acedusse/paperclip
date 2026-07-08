/**
 * FILE: server/src/adapters/http/index.ts
 * ABOUT: index.ts (http module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (http module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/adapters/http/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const httpAdapter: ServerAdapterModule = {
  type: "http",
  execute,
  testEnvironment,
  models: [],
  agentConfigurationDoc: `# http agent configuration

Adapter: http

Core fields:
- url (string, required): endpoint to invoke
- method (string, optional): HTTP method, default POST
- headers (object, optional): request headers
- payloadTemplate (object, optional): JSON payload template
- timeoutSec (number, optional): request timeout in seconds
`,
};
// [END: module]
