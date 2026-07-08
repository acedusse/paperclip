/**
 * FILE: server/src/adapters/types.ts
 * ABOUT: types.ts (adapters module).
 *
 * SECTIONS:
 *   [TAG: module] - types.ts (adapters module).
 */
// ==========================================
// [META: module]
// INTENT: types.ts (adapters module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/adapters/types.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
// Re-export all types from the shared adapter-utils package.
// This file is kept as a convenience shim so existing in-tree
// imports (process/, http/, heartbeat.ts) don't need rewriting.
export type {
  AdapterAgent,
  AdapterSessionManagement,
  AdapterRuntime,
  UsageSummary,
  AdapterExecutionResult,
  AdapterInvocationMeta,
  AdapterExecutionContext,
  AdapterEnvironmentCheckLevel,
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestStatus,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentTestContext,
  AdapterSkillSyncMode,
  AdapterSkillState,
  AdapterSkillOrigin,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
  AdapterSkillContext,
  AdapterSessionCodec,
  AdapterModel,
  AdapterModelProfileKey,
  AdapterModelProfileDefinition,
  NativeContextManagement,
  ResolvedSessionCompactionPolicy,
  SessionCompactionPolicy,
  ConfigFieldOption,
  ConfigFieldSchema,
  AdapterConfigSchema,
  AdapterRuntimeCommandSpec,
  ServerAdapterModule,
} from "@paperclipai/adapter-utils";
// [END: module]
