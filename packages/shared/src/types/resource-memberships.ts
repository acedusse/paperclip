/**
 * FILE: packages/shared/src/types/resource-memberships.ts
 * ABOUT: resource-memberships.ts (types module).
 *
 * SECTIONS:
 *   [TAG: module] - resource-memberships.ts (types module).
 */
// ==========================================
// [META: module]
// INTENT: resource-memberships.ts (types module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/types/resource-memberships.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export const RESOURCE_MEMBERSHIP_STATES = ["joined", "left"] as const;

export type ResourceMembershipState = (typeof RESOURCE_MEMBERSHIP_STATES)[number];
export type ResourceMembershipResourceType = "project" | "agent";

export interface ResourceMemberships {
  projectMemberships: Record<string, ResourceMembershipState>;
  agentMemberships: Record<string, ResourceMembershipState>;
  updatedAt: Date | null;
}

export interface UpdateResourceMembership {
  state: ResourceMembershipState;
}

export interface ResourceMembershipUpdateResult {
  resourceType: ResourceMembershipResourceType;
  resourceId: string;
  state: ResourceMembershipState;
  updatedAt: Date;
}
// [END: module]
