/**
 * FILE: packages/shared/src/api.ts
 * ABOUT: api.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - api.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: api.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/shared/src/api.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
export const API_PREFIX = "/api";

export const API = {
  health: `${API_PREFIX}/health`,
  companies: `${API_PREFIX}/companies`,
  agents: `${API_PREFIX}/agents`,
  projects: `${API_PREFIX}/projects`,
  issues: `${API_PREFIX}/issues`,
  issueWatchdog: `${API_PREFIX}/issues/:issueId/watchdog`,
  issueTreeControl: `${API_PREFIX}/issues/:issueId/tree-control`,
  issueTreeHolds: `${API_PREFIX}/issues/:issueId/tree-holds`,
  goals: `${API_PREFIX}/goals`,
  approvals: `${API_PREFIX}/approvals`,
  secrets: `${API_PREFIX}/secrets`,
  secretProviderConfigs: `${API_PREFIX}/secret-provider-configs`,
  secretProviderConfigDiscoveryPreview: `${API_PREFIX}/companies/:companyId/secret-provider-configs/discovery/preview`,
  costs: `${API_PREFIX}/costs`,
  activity: `${API_PREFIX}/activity`,
  dashboard: `${API_PREFIX}/dashboard`,
  sidebarBadges: `${API_PREFIX}/sidebar-badges`,
  sidebarPreferences: `${API_PREFIX}/sidebar-preferences`,
  resourceMemberships: `${API_PREFIX}/resource-memberships`,
  invites: `${API_PREFIX}/invites`,
  joinRequests: `${API_PREFIX}/join-requests`,
  members: `${API_PREFIX}/members`,
  admin: `${API_PREFIX}/admin`,
} as const;
// [END: module]
