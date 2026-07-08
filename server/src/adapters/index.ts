/**
 * FILE: server/src/adapters/index.ts
 * ABOUT: index.ts (adapters module).
 *
 * SECTIONS:
 *   [TAG: module] - index.ts (adapters module).
 */
// ==========================================
// [META: module]
// INTENT: index.ts (adapters module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/adapters/index.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export {
  getServerAdapter,
  listAdapterModels,
  refreshAdapterModels,
  listServerAdapters,
  findServerAdapter,
  findActiveServerAdapter,
  detectAdapterModel,
  listAdapterModelProfiles,
  registerServerAdapter,
  unregisterServerAdapter,
  requireServerAdapter,
} from "./registry.js";
export type {
  ServerAdapterModule,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterInvocationMeta,
  AdapterModelProfileDefinition,
  AdapterEnvironmentCheckLevel,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestStatus,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentTestContext,
  AdapterSessionCodec,
  UsageSummary,
  AdapterAgent,
  AdapterRuntime,
} from "@paperclipai/adapter-utils";
export { runningProcesses } from "./utils.js";
// [END: module]
