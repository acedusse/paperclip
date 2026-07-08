/**
 * FILE: packages/plugins/sandbox-providers/kubernetes/src/adapter-registry.ts
 * ABOUT: adapter-registry.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - adapter-registry.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: adapter-registry.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/kubernetes/src/adapter-registry.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";

/**
 * One declarative agent-harness ("adapter") entry. Governs picker availability
 * and, for sandboxed (Kubernetes) runs, the runtime wiring.
 *
 * NOTE: this shape is intentionally duplicated across the package boundary. It
 * MUST stay structurally in sync with:
 *   - server `@paperclipai/shared` `adapterRegistryEntrySchema` (the parser side)
 *   - operator `AdapterRegistryEntry` Go struct (PAPERCLIP_ADAPTERS emitter)
 * The duplication is deliberate: this plugin is standalone-installable and must
 * not pull in heavy workspace packages at runtime.
 */
export const adapterRegistryEntrySchema = z
  .object({
    adapterType: z.string().min(1),
    enabled: z.boolean().default(true),
    runtimeImage: z.string().optional(),
    envKeys: z.array(z.string()).optional(),
    allowFqdns: z.array(z.string()).optional(),
    probeCommand: z.array(z.string()).optional(),
    defaultEnv: z.record(z.string()).optional(),
  })
  .strict();

export const adapterRegistrySchema = z.array(adapterRegistryEntrySchema);

export type AdapterRegistryEntry = z.infer<typeof adapterRegistryEntrySchema>;
// [END: module]
