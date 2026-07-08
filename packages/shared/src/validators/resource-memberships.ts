/**
 * FILE: packages/shared/src/validators/resource-memberships.ts
 * ABOUT: resource-memberships.ts (validators module).
 *
 * SECTIONS:
 *   [TAG: module] - resource-memberships.ts (validators module).
 */
// ==========================================
// [META: module]
// INTENT: resource-memberships.ts (validators module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/validators/resource-memberships.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { z } from "zod";
import { RESOURCE_MEMBERSHIP_STATES } from "../types/resource-memberships.js";

export const resourceMembershipStateSchema = z.enum(RESOURCE_MEMBERSHIP_STATES);

export const updateResourceMembershipSchema = z.object({
  state: resourceMembershipStateSchema,
});

export type UpdateResourceMembership = z.infer<typeof updateResourceMembershipSchema>;
// [END: module]
