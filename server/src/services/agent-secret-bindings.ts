/**
 * FILE: server/src/services/agent-secret-bindings.ts
 * ABOUT: agent-secret-bindings.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - agent-secret-bindings.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: agent-secret-bindings.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/agent-secret-bindings.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
interface AgentSecretBindingSyncService {
  syncEnvBindingsForTarget?: (
    companyId: string,
    target: { targetType: "agent"; targetId: string; pathPrefix?: string },
    envValue: unknown,
  ) => Promise<unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function syncAgentAdapterEnvBindings(input: {
  secretsSvc: AgentSecretBindingSyncService;
  companyId: string;
  agentId: string;
  adapterConfig: unknown;
}) {
  const envValue = asRecord(asRecord(input.adapterConfig)?.env);
  await input.secretsSvc.syncEnvBindingsForTarget?.(
    input.companyId,
    { targetType: "agent", targetId: input.agentId },
    envValue,
  );
}
// [END: module]
