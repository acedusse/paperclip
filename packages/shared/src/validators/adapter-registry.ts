/**
 * FILE: packages/shared/src/validators/adapter-registry.ts
 * ABOUT: adapter-registry.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - adapter-registry.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: adapter-registry.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/adapter-registry.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";

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

export type AdapterRegistryEntryParsed = z.infer<typeof adapterRegistryEntrySchema>;
// [END: module]
