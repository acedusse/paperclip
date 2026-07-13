/**
 * FILE: server/src/services/run-changeset.ts
 * ABOUT: run-changeset.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - run-changeset.ts (services module).
 */
// ==========================================
// [META: module]
// INTENT: run-changeset.ts (services module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/services/run-changeset.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { promises as fs } from "node:fs";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  runChangesets,
  workspaceOperations,
  executionWorkspaces,
  type RunChangesetFile,
  type RunChangesetCommand,
} from "@paperclipai/db";
import { computeGitChangeset } from "./git-changeset.js";

export function runChangesetService(db: Db) {
  async function resolveWorkspace(runId: string) {
    const op = await db
      .select({ wsId: workspaceOperations.executionWorkspaceId })
      .from(workspaceOperations)
      .where(and(eq(workspaceOperations.heartbeatRunId, runId), isNotNull(workspaceOperations.executionWorkspaceId)))
      .orderBy(desc(workspaceOperations.startedAt))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!op?.wsId) return null;
    return db.select().from(executionWorkspaces).where(eq(executionWorkspaces.id, op.wsId)).then((r) => r[0] ?? null);
  }

  async function loadCommands(runId: string): Promise<RunChangesetCommand[]> {
    const rows = await db
      .select({ command: workspaceOperations.command, status: workspaceOperations.status, exitCode: workspaceOperations.exitCode })
      .from(workspaceOperations)
      .where(eq(workspaceOperations.heartbeatRunId, runId));
    return rows
      .filter((r) => r.command)
      .map((r) => ({ command: r.command as string, status: r.status, exitCode: r.exitCode ?? null }));
  }

  async function persist(input: {
    runId: string; companyId: string; baseRef: string | null; headRef: string | null;
    files: RunChangesetFile[]; commands: RunChangesetCommand[]; warning?: string;
  }) {
    const summaryStats = {
      filesChanged: input.files.length,
      additions: input.files.reduce((s, f) => s + f.additions, 0),
      deletions: input.files.reduce((s, f) => s + f.deletions, 0),
    };
    const inserted = await db
      .insert(runChangesets)
      .values({
        companyId: input.companyId, heartbeatRunId: input.runId,
        baseRef: input.baseRef, headRef: input.headRef,
        files: input.files, commands: input.commands, summaryStats, warning: input.warning ?? null,
      })
      .onConflictDoNothing() // one changeset per run; first capture wins
      .returning()
      .then((r) => r[0] ?? null);
    if (inserted) return inserted;
    // race lost: a concurrent capture already persisted the row — return the winner's row
    // so idempotent callers never see a spurious null when a changeset in fact exists.
    return db
      .select()
      .from(runChangesets)
      .where(eq(runChangesets.heartbeatRunId, input.runId))
      .then((r) => r[0] ?? null);
  }

  return {
    getForRun: (runId: string) =>
      db.select().from(runChangesets).where(eq(runChangesets.heartbeatRunId, runId)).then((r) => r[0] ?? null),

    async captureForRun(runId: string) {
      const existing = await db
        .select({ id: runChangesets.id })
        .from(runChangesets)
        .where(eq(runChangesets.heartbeatRunId, runId))
        .then((r) => r[0] ?? null);
      if (existing) return db.select().from(runChangesets).where(eq(runChangesets.id, existing.id)).then((r) => r[0]);

      const ws = await resolveWorkspace(runId);
      const commands = await loadCommands(runId);
      const companyId = ws?.companyId;
      if (!companyId) return null;

      const path = ws.providerRef ?? ws.cwd ?? null;
      const pathOk = path ? await fs.stat(path).then(() => true).catch(() => false) : false;
      if (!path || !pathOk) {
        return persist({ runId, companyId, baseRef: ws.baseRef ?? null, headRef: null, files: [], commands, warning: "workspace path unavailable at capture time" });
      }

      const { files, headRef, warning } = await computeGitChangeset(path, ws.baseRef ?? null);
      return persist({ runId, companyId, baseRef: ws.baseRef ?? null, headRef, files, commands, warning });
    },
  };
}
// [END: module]
