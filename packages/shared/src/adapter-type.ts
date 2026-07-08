/**
 * FILE: packages/shared/src/adapter-type.ts
 * ABOUT: adapter-type.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - adapter-type.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: adapter-type.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/adapter-type.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";
import { AGENT_ADAPTER_TYPES } from "./constants.js";

export const agentAdapterTypeSchema = z
  .string()
  .trim()
  .min(1)
  .default("process")
  .describe(`Known built-in adapters: ${AGENT_ADAPTER_TYPES.join(", ")}. External adapters may register additional non-empty string types at runtime.`);

export const optionalAgentAdapterTypeSchema = z
  .string()
  .trim()
  .min(1)
  .optional();
// [END: module]
