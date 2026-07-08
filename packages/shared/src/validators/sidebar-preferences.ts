/**
 * FILE: packages/shared/src/validators/sidebar-preferences.ts
 * ABOUT: sidebar-preferences.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - sidebar-preferences.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: sidebar-preferences.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/sidebar-preferences.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";

const sidebarOrderedIdSchema = z.string().uuid();

export const sidebarOrderPreferenceSchema = z.object({
  orderedIds: z.array(sidebarOrderedIdSchema),
  updatedAt: z.coerce.date().nullable(),
});

export const upsertSidebarOrderPreferenceSchema = z.object({
  orderedIds: z.array(sidebarOrderedIdSchema),
});

export type UpsertSidebarOrderPreference = z.infer<typeof upsertSidebarOrderPreferenceSchema>;
// [END: module]
