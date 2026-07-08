/**
 * FILE: ui/src/api/resourceMemberships.ts
 * ABOUT: resourceMemberships.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - resourceMemberships.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: resourceMemberships.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/resourceMemberships.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type {
  ResourceMemberships,
  ResourceMembershipUpdateResult,
  UpdateResourceMembership,
} from "@paperclipai/shared";
import { api } from "./client";

export const resourceMembershipsApi = {
  listMine: (companyId: string) =>
    api.get<ResourceMemberships>(`/companies/${companyId}/resource-memberships/me`),
  updateProject: (companyId: string, projectId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/companies/${companyId}/resource-memberships/me/projects/${projectId}`,
      data,
    ),
  updateAgent: (companyId: string, agentId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/companies/${companyId}/resource-memberships/me/agents/${agentId}`,
      data,
    ),
};
// [END: module]
