/**
 * FILE: ui/src/api/execution-workspaces.ts
 * ABOUT: execution-workspaces.ts (api module).
 *
 * SECTIONS:
 *   [TAG: module] - execution-workspaces.ts (api module).
 */
// ==========================================
// [META: module]
// INTENT: execution-workspaces.ts (api module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/api/execution-workspaces.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type {
  ExecutionWorkspace,
  ExecutionWorkspaceSummary,
  ExecutionWorkspaceCloseReadiness,
  WorkspaceOperation,
  WorkspaceRuntimeControlTarget,
} from "@paperclipai/shared";
import { api } from "./client";
import { sanitizeWorkspaceRuntimeControlTarget } from "./workspace-runtime-control";

export const executionWorkspacesApi = {
  listSummaries: (
    companyId: string,
    filters?: {
      projectId?: string;
      projectWorkspaceId?: string;
      issueId?: string;
      status?: string;
      reuseEligible?: boolean;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.projectWorkspaceId) params.set("projectWorkspaceId", filters.projectWorkspaceId);
    if (filters?.issueId) params.set("issueId", filters.issueId);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.reuseEligible) params.set("reuseEligible", "true");
    params.set("summary", "true");
    const qs = params.toString();
    return api.get<ExecutionWorkspaceSummary[]>(
      `/companies/${companyId}/execution-workspaces${qs ? `?${qs}` : ""}`,
    );
  },
  list: (
    companyId: string,
    filters?: {
      projectId?: string;
      projectWorkspaceId?: string;
      issueId?: string;
      status?: string;
      reuseEligible?: boolean;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.projectWorkspaceId) params.set("projectWorkspaceId", filters.projectWorkspaceId);
    if (filters?.issueId) params.set("issueId", filters.issueId);
    if (filters?.status) params.set("status", filters.status);
    if (filters?.reuseEligible) params.set("reuseEligible", "true");
    const qs = params.toString();
    return api.get<ExecutionWorkspace[]>(`/companies/${companyId}/execution-workspaces${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<ExecutionWorkspace>(`/execution-workspaces/${id}`),
  getCloseReadiness: (id: string) =>
    api.get<ExecutionWorkspaceCloseReadiness>(`/execution-workspaces/${id}/close-readiness`),
  listWorkspaceOperations: (id: string) =>
    api.get<WorkspaceOperation[]>(`/execution-workspaces/${id}/workspace-operations`),
  controlRuntimeServices: (
    id: string,
    action: "start" | "stop" | "restart",
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ExecutionWorkspace; operation: WorkspaceOperation }>(
      `/execution-workspaces/${id}/runtime-services/${action}`,
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  controlRuntimeCommands: (
    id: string,
    action: "start" | "stop" | "restart" | "run",
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ExecutionWorkspace; operation: WorkspaceOperation }>(
      `/execution-workspaces/${id}/runtime-commands/${action}`,
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  update: (id: string, data: Record<string, unknown>) => api.patch<ExecutionWorkspace>(`/execution-workspaces/${id}`, data),
};
// [END: module]
