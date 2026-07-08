/**
 * FILE: packages/shared/src/validators/asset.ts
 * ABOUT: asset.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - asset.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: asset.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/asset.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";

export const createAssetImageMetadataSchema = z.object({
  namespace: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9/_-]+$/)
    .optional(),
});

export type CreateAssetImageMetadata = z.infer<typeof createAssetImageMetadataSchema>;
// [END: module]
