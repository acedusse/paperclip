/**
 * FILE: server/src/adapters/process/index.ts
 * ABOUT: index.ts (process module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (process module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (process module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/adapters/process/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { ServerAdapterModule } from "../types.js";
import { execute } from "./execute.js";
import { testEnvironment } from "./test.js";

export const processAdapter: ServerAdapterModule = {
  type: "process",
  execute,
  testEnvironment,
  models: [],
  agentConfigurationDoc: `# process agent configuration

Adapter: process

Core fields:
- command (string, required): command to execute
- args (string[] | string, optional): command arguments
- cwd (string, optional): absolute working directory
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds
`,
};
// [END: module]
