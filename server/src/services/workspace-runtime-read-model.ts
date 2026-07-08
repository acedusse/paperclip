/**
 * FILE: server/src/services/workspace-runtime-read-model.ts
 * ABOUT: workspace-runtime-read-model.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - workspace-runtime-read-model.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: workspace-runtime-read-model.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/workspace-runtime-read-model.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Db } from "@paperclipai/db";
import { workspaceRuntimeServices } from "@paperclipai/db";
import { and, desc, eq, inArray } from "drizzle-orm";

type WorkspaceRuntimeServiceRow = typeof workspaceRuntimeServices.$inferSelect;

function runtimeServiceIdentityKey(row: WorkspaceRuntimeServiceRow) {
  if (row.reuseKey) return row.reuseKey;
  return [
    row.scopeType,
    row.scopeId ?? "",
    row.projectWorkspaceId ?? "",
    row.executionWorkspaceId ?? "",
    row.serviceName,
    row.command ?? "",
    row.cwd ?? "",
  ].join(":");
}

export function selectCurrentRuntimeServiceRows(rows: WorkspaceRuntimeServiceRow[]) {
  const current = new Map<string, WorkspaceRuntimeServiceRow>();
  for (const row of rows) {
    const identity = runtimeServiceIdentityKey(row);
    if (!current.has(identity)) current.set(identity, row);
  }
  return [...current.values()];
}

export async function listCurrentRuntimeServicesForProjectWorkspaces(
  db: Db,
  companyId: string,
  projectWorkspaceIds: string[],
) {
  if (projectWorkspaceIds.length === 0) return new Map<string, WorkspaceRuntimeServiceRow[]>();

  const rows = await db
    .select()
    .from(workspaceRuntimeServices)
    .where(
      and(
        eq(workspaceRuntimeServices.companyId, companyId),
        inArray(workspaceRuntimeServices.projectWorkspaceId, projectWorkspaceIds),
        eq(workspaceRuntimeServices.scopeType, "project_workspace"),
      ),
    )
    .orderBy(desc(workspaceRuntimeServices.updatedAt), desc(workspaceRuntimeServices.createdAt));

  const grouped = new Map<string, WorkspaceRuntimeServiceRow[]>();
  for (const row of rows) {
    if (!row.projectWorkspaceId) continue;
    const existing = grouped.get(row.projectWorkspaceId) ?? [];
    existing.push(row);
    grouped.set(row.projectWorkspaceId, existing);
  }

  return new Map(
    Array.from(grouped.entries()).map(([workspaceId, workspaceRows]) => [
      workspaceId,
      selectCurrentRuntimeServiceRows(workspaceRows),
    ]),
  );
}

export async function listCurrentRuntimeServicesForExecutionWorkspaces(
  db: Db,
  companyId: string,
  executionWorkspaceIds: string[],
) {
  if (executionWorkspaceIds.length === 0) return new Map<string, WorkspaceRuntimeServiceRow[]>();

  const rows = await db
    .select()
    .from(workspaceRuntimeServices)
    .where(
      and(
        eq(workspaceRuntimeServices.companyId, companyId),
        inArray(workspaceRuntimeServices.executionWorkspaceId, executionWorkspaceIds),
      ),
    )
    .orderBy(desc(workspaceRuntimeServices.updatedAt), desc(workspaceRuntimeServices.createdAt));

  const grouped = new Map<string, WorkspaceRuntimeServiceRow[]>();
  for (const row of rows) {
    if (!row.executionWorkspaceId) continue;
    const existing = grouped.get(row.executionWorkspaceId) ?? [];
    existing.push(row);
    grouped.set(row.executionWorkspaceId, existing);
  }

  return new Map(
    Array.from(grouped.entries()).map(([workspaceId, workspaceRows]) => [
      workspaceId,
      selectCurrentRuntimeServiceRows(workspaceRows),
    ]),
  );
}
// [END: module]
